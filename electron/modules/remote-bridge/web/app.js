'use strict';

/* ===== Action enum (mirror of protocol.js) ===== */
const Action = {
  REMOTE_AUTH: 'remote:auth',
  PROJECT_LIST: 'project:list',
  PROJECT_CREATE: 'project:create',
  PROJECT_SWITCH: 'project:switch',
  PROJECT_DELETE: 'project:delete',
  CHAT_SEND: 'chat:send',
  CHAT_INTERRUPT: 'chat:interrupt',
  CHAT_HISTORY: 'chat:history',
  CHAT_DELETE: 'chat:delete',
  GIT_STATUS: 'git:status',
  GIT_COMMIT: 'git:commit',
  GIT_LOG: 'git:log',
  GIT_PUSH: 'git:push',
  GIT_PULL: 'git:pull',
  GIT_BRANCHES: 'git:branches',
  CONFIG_GET: 'config:get',
  CONFIG_SAVE: 'config:save',
  SKILL_LIST: 'skill:list',
  SKILL_TOGGLE: 'skill:toggle',
  TERMINAL_RUN: 'terminal:run',
  CONTEXT_STATUS: 'context:status',
  CONTEXT_CLEAR: 'context:clear',
  DEVICE_LIST: 'device:list',
  DEVICE_REVOKE: 'device:revoke',
  MODEL_LIST: 'model:list',
  ASK_RESPONSE: 'ask:response',
};

/* ============================================================
 * BridgeClient — WebSocket 通信层
 * ============================================================ */
class BridgeClient {
  constructor() {
    this.ws = null;
    this.state = 'disconnected';
    this.token = localStorage.getItem('lingxi_token');
    this.pendingRequests = new Map();
    this.requestCounter = 0;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 10;
    this._reconnectTimer = null;
    this._pingTimer = null;
    this.onStateChange = null;
    this.onEvent = null;
    this._host = '';
    this._port = 9876;
  }

  connect(host, port, token) {
    if (this.ws) {
      this.ws.onclose = null;
      this.ws.close();
    }
    this._host = host || location.hostname;
    this._port = port || 9876;
    if (token) this.token = token;

    this._setState(this.token ? 'reconnecting' : 'connecting');

    const url = this.token
      ? `ws://${this._host}:${this._port}?token=${encodeURIComponent(this.token)}`
      : `ws://${this._host}:${this._port}`;

    try {
      this.ws = new WebSocket(url);
    } catch (e) {
      this._setState('disconnected');
      return;
    }

    this.ws.onopen = () => {
      this.reconnectAttempts = 0;
      this._setState('connected');
      this._startPing();
    };

    this.ws.onmessage = (evt) => this._handleMessage(evt.data);

    this.ws.onclose = () => {
      this._stopPing();
      if (this.state === 'connected') this._scheduleReconnect();
    };

    this.ws.onerror = () => {};
  }

  disconnect() {
    clearTimeout(this._reconnectTimer);
    this._stopPing();
    this.reconnectAttempts = this.maxReconnectAttempts;
    if (this.ws) {
      this.ws.onclose = null;
      this.ws.close();
      this.ws = null;
    }
    this._setState('disconnected');
  }

  async sendCommand(action, payload = {}) {
    if (this.state !== 'connected' || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('未连接');
    }
    const id = `req_${Date.now()}_${(++this.requestCounter)}`;
    const msg = { id, type: 'command', action, payload };

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error('请求超时'));
      }, 30000);

      this.pendingRequests.set(id, { resolve, reject, timer });
      this.ws.send(JSON.stringify(msg));
    });
  }

  _handleMessage(raw) {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    if (msg.type === 'response') {
      const pending = this.pendingRequests.get(msg.id);
      if (pending) {
        clearTimeout(pending.timer);
        this.pendingRequests.delete(msg.id);
        if (msg.success) pending.resolve(msg.data);
        else pending.reject(new Error(msg.error || '未知错误'));
      }
    } else if (msg.type === 'event') {
      if (this.onEvent) this.onEvent(msg);
    }
  }

  _scheduleReconnect() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      this._setState('disconnected');
      return;
    }
    this._setState('reconnecting');
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);
    this.reconnectAttempts++;
    this._reconnectTimer = setTimeout(() => {
      this.connect(this._host, this._port);
    }, delay);
  }

  _startPing() {
    this._stopPing();
    this._pingTimer = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: 'ping' }));
      }
    }, 25000);
  }

  _stopPing() {
    if (this._pingTimer) {
      clearInterval(this._pingTimer);
      this._pingTimer = null;
    }
  }

  _setState(state) {
    if (this.state !== state) {
      this.state = state;
      if (this.onStateChange) this.onStateChange(state);
    }
  }
}

/* ============================================================
 * App — UI 控制层
 * ============================================================ */
class App {
  constructor() {
    this.client = new BridgeClient();
    this.currentView = 'pairing';
    this.currentPage = 'home';
    this.messages = [];
    this.projects = [];
    this.filteredProjects = [];
    this.currentProjectId = null;
    this.aiStatus = 'idle';
    this.currentStreamingBubble = null;
    this.currentStreamingContent = '';
    this.currentStreamingProcessItems = [];
    this.processItemsByKey = new Map();
    this.processCounter = 0;
    this.deviceName = localStorage.getItem('lingxi_device_name') || '';
    this.models = [];
    this.currentModelIndex = 0;
    this.modelPanelOpen = false;
    this.skills = [];
    this._currentAskData = null;
    this.taskSearchOpen = false;
    this.taskQuery = '';
    this.showAllTasks = false;
    this._toastTimer = null;
    this.streamStartedAt = 0;

    this._bindElements();
    this._bindEvents();
    this._init();
  }

  _bindElements() {
    const $ = (id) => document.getElementById(id);
    this.elements = {
      connectionBar: $('connection-bar'),
      statusDot: $('status-dot'),
      statusText: $('status-text'),
      btnReconnect: $('btn-reconnect'),
      viewPairing: $('view-pairing'),
      viewMain: $('view-main'),
      inputPin: $('input-pin'),
      inputDeviceName: $('input-device-name'),
      btnPair: $('btn-pair'),
      pairingError: $('pairing-error'),
      pageHome: $('page-home'),
      pageChat: $('page-chat'),
      pageSettings: $('page-settings'),
      homeTitle: $('home-title'),
      btnHomeFilter: $('btn-home-filter'),
      btnHomeSearch: $('btn-home-search'),
      homeSearchBar: $('home-search-bar'),
      inputTaskSearch: $('input-task-search'),
      btnOpenSettings: $('btn-open-settings'),
      deviceAvatar: $('device-avatar'),
      taskList: $('task-list'),
      btnNewChat: $('btn-new-chat'),
      btnViewAllProjects: $('btn-view-all-projects'),
      btnViewAllHistory: $('btn-view-all-history'),
      btnImportProject: $('btn-import-project'),
      btnViewHistory: $('btn-view-history'),
      activeProjectList: $('active-project-list'),
      recentConversationList: $('recent-conversation-list'),
      activeProjectsCard: $('active-projects-card'),
      recentConversationsCard: $('recent-conversations-card'),
      dashboardModelButton: $('dashboard-model-button'),
      dashboardModelName: $('dashboard-model-name'),
      dashboardContextSize: $('dashboard-context-size'),
      dashboardRuntimeStatus: $('dashboard-runtime-status'),
      mobileToast: $('mobile-toast'),
      mobileTabs: Array.from(document.querySelectorAll('[data-mobile-page]')),
      homeActionButtons: Array.from(document.querySelectorAll('[data-home-action]')),
      headerTitle: $('header-title'),
      currentProjectPath: $('current-project-path'),
      btnBackHome: $('btn-back-home'),
      btnNewInChat: $('btn-new-in-chat'),
      btnChatMore: $('btn-chat-more'),
      aiStatusIndicator: $('ai-status-indicator'),
      modelSelectorBtn: $('model-selector-btn'),
      currentModelName: $('current-model-name'),
      modelPanel: $('model-panel'),
      modelList: $('model-list'),
      messageList: $('message-list'),
      inputMessage: $('input-message'),
      btnSend: $('btn-send'),
      btnInterrupt: $('btn-interrupt'),
      btnFileUpload: $('btn-file-upload'),
      btnVoice: $('btn-voice'),
      settingStatus: $('setting-status'),
      settingDevice: $('setting-device'),
      settingProject: $('setting-project'),
      btnDisconnect: $('btn-disconnect'),
      skillList: $('skill-list'),
      btnBackFromSettings: $('btn-back-from-settings'),
      askOverlay: $('ask-overlay'),
      askQuestion: $('ask-question'),
      askOptions: $('ask-options'),
      askCustomInput: $('ask-custom-input'),
      askSendBtn: $('ask-send-btn'),
      processSheet: $('process-sheet'),
      processSheetClose: $('process-sheet-close'),
      processSheetContent: $('process-sheet-content'),
    };
  }

  _bindEvents() {
    const el = this.elements;

    el.inputPin.addEventListener('input', () => {
      el.inputPin.value = el.inputPin.value.replace(/[^0-9]/g, '');
      el.btnPair.disabled = el.inputPin.value.length !== 6;
    });
    el.btnPair.addEventListener('click', () => this._pair());
    el.inputPin.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !el.btnPair.disabled) this._pair();
    });

    el.btnReconnect.addEventListener('click', () => {
      this.client.reconnectAttempts = 0;
      this.client.connect();
    });

    el.btnSend.addEventListener('click', () => this._sendMessage());
    el.btnInterrupt.addEventListener('click', () => this._interruptAI());
    el.inputMessage.addEventListener('input', () => {
      this._autoGrowTextarea();
      el.btnSend.disabled = !el.inputMessage.value.trim();
    });
    el.inputMessage.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        if (el.inputMessage.value.trim()) this._sendMessage();
      }
    });

    el.messageList.addEventListener('click', (e) => {
      const processBtn = e.target.closest('[data-process-key]');
      if (processBtn) this._openProcessSheet(processBtn.dataset.processKey);
    });

    el.processSheetClose?.addEventListener('click', () => this._closeProcessSheet());
    el.processSheet?.addEventListener('click', (e) => {
      if (e.target.closest('[data-process-close]')) this._closeProcessSheet();
    });

    el.btnBackHome?.addEventListener('click', () => this._switchPage('home'));
    el.btnOpenSettings?.addEventListener('click', () => this._switchPage('settings'));
    el.btnBackFromSettings?.addEventListener('click', () => this._switchPage('home'));
    el.btnHomeSearch?.addEventListener('click', () => el.inputTaskSearch?.focus());
    el.inputTaskSearch?.addEventListener('input', () => {
      this.taskQuery = el.inputTaskSearch.value.trim();
      this._renderTasks();
    });
    el.btnNewChat?.addEventListener('click', () => this._startQuickChat());
    el.btnNewInChat?.addEventListener('click', () => el.inputMessage?.focus());
    el.btnChatMore?.addEventListener('click', () => this._switchPage('settings'));
    el.btnHomeFilter?.addEventListener('click', () => {
      this.showAllTasks = !this.showAllTasks;
      this._renderTasks();
    });

    el.btnViewAllProjects?.addEventListener('click', () => this._focusDashboardCard('active-projects-card'));
    el.btnViewAllHistory?.addEventListener('click', () => this._focusDashboardCard('recent-conversations-card'));
    el.btnViewHistory?.addEventListener('click', () => this._focusDashboardCard('recent-conversations-card'));
    el.btnImportProject?.addEventListener('click', () => this._showMobileToast('请先在桌面端导入项目，手机端会自动同步'));
    el.dashboardModelButton?.addEventListener('click', () => {
      this._switchPage('chat');
      this._toggleModelPanel();
    });

    el.mobileTabs.forEach((button) => {
      button.addEventListener('click', () => this._handleMobileNavigation(button.dataset.mobilePage));
    });

    el.homeActionButtons.forEach((button) => {
      button.addEventListener('click', () => this._handleHomeAction(button.dataset.homeAction));
    });

    el.modelSelectorBtn?.addEventListener('click', () => this._toggleModelPanel());

    el.btnDisconnect.addEventListener('click', () => {
      this.client.disconnect();
      localStorage.removeItem('lingxi_token');
      this.client.token = null;
      this._switchView('pairing');
      el.inputPin.value = '';
      el.btnPair.disabled = true;
    });

    el.askSendBtn.addEventListener('click', () => {
      const val = el.askCustomInput.value.trim();
      if (val) {
        this._submitAskResponse(val);
        el.askCustomInput.value = '';
      }
    });
    el.askCustomInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const val = el.askCustomInput.value.trim();
        if (val) {
          this._submitAskResponse(val);
          el.askCustomInput.value = '';
        }
      }
    });
  }

  _init() {
    this.client.onStateChange = (state) => this._updateConnectionState(state);
    this.client.onEvent = (event) => this._handleEvent(event);

    if (this.client.token) {
      this.deviceName = localStorage.getItem('lingxi_device_name') || '';
      this.client.connect();
    }

    if (this.elements.inputDeviceName && !this.elements.inputDeviceName.value) {
      this.elements.inputDeviceName.value = this._getDefaultDeviceName();
    }
    this._updateDeviceAvatar();
  }

  _updateDeviceAvatar() {
    const name = this.deviceName || this.elements.inputDeviceName?.value || '灵';
    if (this.elements.deviceAvatar) {
      this.elements.deviceAvatar.textContent = String(name).trim().slice(0, 1) || '灵';
    }
  }

  async _pair() {
    const el = this.elements;
    const pin = el.inputPin.value.trim();
    const deviceName = el.inputDeviceName.value.trim() || this._getDefaultDeviceName();

    el.btnPair.disabled = true;
    el.pairingError.classList.add('hidden');

    try {
      await new Promise((resolve, reject) => {
        const host = location.hostname;
        const port = parseInt(location.port) || 9876;
        const url = `ws://${host}:${port}`;
        const tempWs = new WebSocket(url);
        let settled = false;

        const cleanup = () => {
          tempWs.onopen = null;
          tempWs.onmessage = null;
          tempWs.onerror = null;
          tempWs.onclose = null;
          tempWs.close();
        };

        tempWs.onopen = () => {
          tempWs.send(JSON.stringify({
            id: 'pair_req_1',
            type: 'command',
            action: Action.REMOTE_AUTH,
            payload: { pin, deviceName },
          }));
        };

        tempWs.onmessage = (evt) => {
          if (settled) return;
          try {
            const msg = JSON.parse(evt.data);
            if (msg.type === 'response' && msg.id === 'pair_req_1') {
              settled = true;
              cleanup();
              if (msg.success && msg.data && msg.data.token) {
                const token = msg.data.token;
                localStorage.setItem('lingxi_token', token);
                localStorage.setItem('lingxi_device_name', deviceName);
                this.client.token = token;
                this.deviceName = deviceName;
                this._updateDeviceAvatar();
                this.client.connect();
                resolve();
              } else {
                reject(new Error(msg.error || '配对失败'));
              }
            }
          } catch { /* ignore */ }
        };

        tempWs.onerror = () => {
          if (!settled) {
            settled = true;
            cleanup();
            reject(new Error('无法连接服务器'));
          }
        };

        tempWs.onclose = () => {
          if (!settled) {
            settled = true;
            reject(new Error('连接已断开'));
          }
        };

        setTimeout(() => {
          if (!settled) {
            settled = true;
            cleanup();
            reject(new Error('配对超时'));
          }
        }, 15000);
      });
    } catch (err) {
      el.pairingError.textContent = err.message;
      el.pairingError.classList.remove('hidden');
      el.btnPair.disabled = false;
    }
  }

  _handleEvent(event) {
    const { channel, data } = event;
    if (!data) return;

    switch (channel) {
      case 'ai-status':
        this._updateAIStatus(data.status || data);
        this._scheduleProjectRefresh();
        break;
      case 'ai-thinking':
        this._appendThinking(data);
        break;
      case 'ai-thinking-reset':
        this._resetThinking();
        break;
      case 'ai-final-delta':
        this._handleStreamingDelta(data);
        break;
      case 'message-reply':
        this._handleAIReply(data);
        this._scheduleProjectRefresh();
        break;
      case 'tool-start':
        this._addToolCall(data);
        break;
      case 'tool-result':
        this._updateToolCall(data);
        break;
      case 'project-path-changed':
        if (this.currentView === 'main') this._loadProjects();
        break;
      case 'show-ask-popup':
        this._showAskPopup(data);
        break;
      default:
        break;
    }
  }

  _sendMessage() {
    const el = this.elements;
    const text = el.inputMessage.value.trim();
    if (!text) return;
    if (!this.currentProjectId) {
      this._appendMessage({ role: 'system', content: '请先从任务列表选择一个项目' });
      this._switchPage('home');
      return;
    }

    this._appendMessage({ role: 'user', content: text });
    el.inputMessage.value = '';
    el.btnSend.disabled = true;
    this._autoGrowTextarea();
    this.streamStartedAt = Date.now();

    this.client.sendCommand(Action.CHAT_SEND, {
      projectId: this.currentProjectId,
      message: text,
      config: this._getSelectedModelConfig(),
    }).catch(() => {
      this._appendMessage({ role: 'system', content: '发送失败，请检查连接' });
    });
  }

  _interruptAI() {
    this.client.sendCommand(Action.CHAT_INTERRUPT, {
      projectId: this.currentProjectId,
    }).catch(() => {});
  }

  _appendMessage(msg) {
    const list = this.elements.messageList;
    const normalized = this._normalizeMessage(msg);
    const row = document.createElement('div');
    row.className = `message ${normalized.role}`;

    if (normalized.role === 'user') {
      const bubble = document.createElement('div');
      bubble.className = 'user-message';
      bubble.textContent = normalized.content;
      row.appendChild(bubble);
    } else if (normalized.role === 'system') {
      const bubble = document.createElement('div');
      bubble.className = 'system-message';
      bubble.textContent = normalized.content;
      row.appendChild(bubble);
    } else {
      const brand = document.createElement('div');
      brand.className = 'ai-brand';
      brand.innerHTML = '<span class="ai-brand-mark">灵</span><span>灵犀 Code</span>';
      row.appendChild(brand);

      if (normalized.durationText) {
        const duration = document.createElement('div');
        duration.className = 'ai-duration';
        duration.textContent = `任务耗时 ${normalized.durationText}`;
        row.appendChild(duration);
      }

      const bubble = document.createElement('div');
      bubble.className = 'ai-content';
      bubble.innerHTML = this._renderMarkdown(normalized.content || '');
      row.appendChild(bubble);

      if (normalized.processItems.length) {
        const processKey = this._registerProcessItems(normalized.processItems, normalized.title || '执行过程');
        row.dataset.processKey = processKey;
        row.appendChild(this._createInlineProcessChips(processKey));
        row.appendChild(this._createProcessButton(processKey));
      }

      if (normalized.changeSummary) {
        row.appendChild(this._createChangeSummaryCard(normalized.changeSummary));
      }

      row.appendChild(this._createAiMetaRow());
    }

    list.appendChild(row);
    this._scrollToBottom();
    this.messages.push(normalized);
    return row.querySelector('.ai-content') || row.querySelector('.user-message');
  }

  _normalizeMessage(msg = {}) {
    const rawRole = String(msg.role || msg.type || '').toLowerCase();
    const role = rawRole === 'assistant' || rawRole === 'ai' ? 'ai'
      : rawRole === 'user' ? 'user'
      : rawRole === 'system' ? 'system'
      : 'ai';
    const content = msg.displayContent || msg.content || msg.message || msg.text || '';
    const durationMs = Number(msg.durationMs || msg.elapsedMs || msg.costMs || 0);
    return {
      ...msg,
      role,
      content,
      title: msg.title || msg.branchTitle || msg.summary || '',
      processItems: this._collectProcessItems(msg),
      changeSummary: this._extractChangeSummary(msg),
      durationText: durationMs > 0 ? this._formatDuration(durationMs) : '',
    };
  }

  _extractChangeSummary(msg = {}) {
    const snap = msg.operationSnapshot || msg.snapshot || msg.fileChanges || null;
    if (!snap) return null;
    const files = Number(snap.files || snap.fileCount || snap.changedFiles || (Array.isArray(snap.paths) ? snap.paths.length : 0) || 0);
    const added = Number(snap.added || snap.additions || snap.plus || 0);
    const removed = Number(snap.removed || snap.deletions || snap.minus || 0);
    if (!files && !added && !removed) return null;
    return {
      files: files || Math.max(1, (added > 0 || removed > 0) ? 1 : 0),
      added,
      removed,
      label: files > 0 ? `编辑 ${files} 个文件` : '代码变更'
    };
  }

  _collectProcessItems(msg = {}) {
    const items = [];
    const pushText = (type, title, value, status = '') => {
      if (Array.isArray(value)) {
        value.forEach(item => pushText(type, title, item, status));
        return;
      }
      const content = typeof value === 'string'
        ? value
        : (value?.content || value?.summary || value?.text || value?.message || value?.result || '');
      if (!content) return;
      items.push({ type, title, content: String(content), status: value?.status || status || '', id: value?.id || value?.toolId || value?.toolCallId || '' });
    };

    pushText('thinking', '思考过程', msg.thinkingContent || msg.thinking || msg.reasoning || msg.reasoningContent);

    const aiSteps = Array.isArray(msg.aiSteps) ? msg.aiSteps : [];
    aiSteps.forEach(step => {
      const name = step?.name || step?.toolName || step?.type || '';
      const isThinkingStep = /show_thinking_note|thinking|reasoning|report_progress/i.test(name || step?.type || '');
      if (isThinkingStep) {
        pushText('thinking', step.title || '思考过程', step.content || step.args?.content || step.result?.message || step.summary);
      }
      if (!isThinkingStep && (step?.toolCall || step?.toolName || step?.name || step?.result)) {
        const toolName = step.toolName || step.name || step.toolCall?.name || '工具调用';
        const detail = step.result?.message || step.result?.error || step.content || step.args || step.result || '';
        items.push({ type: 'tool', title: toolName, content: this._stringifyProcessDetail(detail), status: step.status || (step.result?.success === false ? 'error' : 'completed'), id: step.id || step.toolCallId || '' });
      }
    });

    const tools = msg.toolCalls || msg.tools || msg.operations || [];
    if (Array.isArray(tools)) {
      tools.forEach(tool => {
        const title = tool?.name || tool?.toolName || tool?.title || '工具调用';
        const detail = tool?.result?.message || tool?.result?.error || tool?.content || tool?.summary || tool?.args || tool?.result || '';
        items.push({ type: 'tool', title, content: this._stringifyProcessDetail(detail), status: tool?.status || (tool?.result?.success === false ? 'error' : 'completed'), id: tool?.id || tool?.toolId || tool?.toolCallId || '' });
      });
    }
    return items.filter(item => item.content || item.title);
  }

  _stringifyProcessDetail(value) {
    if (!value) return '';
    if (typeof value === 'string') return value;
    try { return JSON.stringify(value, null, 2); } catch { return String(value); }
  }

  _registerProcessItems(items = [], title = '过程') {
    const key = `process_${Date.now()}_${++this.processCounter}`;
    this.processItemsByKey.set(key, { title, items: items.slice() });
    return key;
  }

  _createProcessButton(processKey) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'process-entry-btn';
    button.dataset.processKey = processKey;
    const item = this.processItemsByKey.get(processKey);
    const count = item?.items?.length || 0;
    button.innerHTML = `
      <span class="card-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3a4 4 0 0 1 4 4v1h1a3 3 0 0 1 0 6h-1v1a4 4 0 0 1-8 0v-1H7a3 3 0 0 1 0-6h1V7a4 4 0 0 1 4-4Z"/><path d="M9 12h6"/></svg>
      </span>
      <span class="card-main">查看执行过程</span>
      <strong>${count}</strong>`;
    return button;
  }

  _createInlineProcessChips(processKey) {
    const wrap = document.createElement('div');
    wrap.className = 'inline-process-chips';
    wrap.dataset.processKey = processKey;
    const items = this.processItemsByKey.get(processKey)?.items || [];
    const tools = items.filter(i => i.type === 'tool').slice(0, 3);
    if (!tools.length) return wrap;
    wrap.innerHTML = tools.map(tool => {
      const title = this._humanizeToolTitle(tool.title);
      return `<span class="inline-process-chip"><span>${this._escapeHtml(title)}</span></span>`;
    }).join('');
    return wrap;
  }

  _createChangeSummaryCard(summary) {
    const card = document.createElement('div');
    card.className = 'change-summary-card';
    const add = summary.added > 0 ? `<span class="diff-add">+${summary.added}</span>` : '';
    const del = summary.removed > 0 ? `<span class="diff-del">-${summary.removed}</span>` : '';
    card.innerHTML = `
      <span class="card-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/></svg>
      </span>
      <span class="card-main">${this._escapeHtml(summary.label || '代码变更')}</span>
      <span class="diff-stats">${add}${del}</span>`;
    return card;
  }

  _createAiMetaRow() {
    const row = document.createElement('div');
    row.className = 'ai-meta-row';
    row.innerHTML = `
      <div class="ai-meta-actions">
        <button type="button" aria-label="有用" title="有用">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M7 11v10"/><path d="M15 21H8a2 2 0 0 1-2-2v-8l5-8a2 2 0 0 1 2 2v5h5a2 2 0 0 1 2 2l-1 9a2 2 0 0 1-2 2Z"/></svg>
        </button>
        <button type="button" aria-label="无用" title="无用">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 13V3"/><path d="M9 3h7a2 2 0 0 1 2 2v8l-5 8a2 2 0 0 1-2-2v-5H6a2 2 0 0 1-2-2l1-9a2 2 0 0 1 2-2Z"/></svg>
        </button>
        <button type="button" aria-label="复制" title="复制">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>
        </button>
      </div>
      <span class="ai-meta-divider"></span>
      <span>内容由 AI 生成</span>`;
    return row;
  }

  _humanizeToolTitle(name = '') {
    const raw = String(name || '');
    if (/write|edit|patch|text_edit|file_write/i.test(raw)) return '编辑文件';
    if (/shell|terminal|command|run/i.test(raw)) return '执行命令';
    if (/read|open|file_read/i.test(raw)) return '读取文件';
    if (/search|rg|grep|locate/i.test(raw)) return '搜索代码';
    if (/thinking/i.test(raw)) return '思考过程';
    return raw || '工具调用';
  }

  _ensureProcessForCurrentBubble() {
    if (!this.currentStreamingBubble) {
      this.currentStreamingContent = '';
      this.currentStreamingProcessItems = [];
      this.currentStreamingBubble = this._appendMessage({ role: 'ai', content: '' });
    }
    const row = this.currentStreamingBubble.closest('.message');
    if (!row) return null;
    if (!row.dataset.processKey) {
      const key = this._registerProcessItems([], '正在执行');
      row.dataset.processKey = key;
      row.appendChild(this._createInlineProcessChips(key));
      row.appendChild(this._createProcessButton(key));
    }
    return row.dataset.processKey;
  }

  _updateProcessButton(processKey) {
    const item = this.processItemsByKey.get(processKey);
    const button = this.elements.messageList.querySelector(`.process-entry-btn[data-process-key="${processKey}"]`);
    const countEl = button?.querySelector('strong');
    if (countEl) countEl.textContent = String(item?.items?.length || 0);

    const chips = this.elements.messageList.querySelector(`.inline-process-chips[data-process-key="${processKey}"]`);
    if (chips) {
      const tools = (item?.items || []).filter(i => i.type === 'tool').slice(0, 3);
      chips.innerHTML = tools.map(tool => {
        const title = this._humanizeToolTitle(tool.title);
        return `<span class="inline-process-chip"><span>${this._escapeHtml(title)}</span></span>`;
      }).join('');
    }
  }

  _handleStreamingDelta(data) {
    const delta = typeof data === 'string' ? data : (data.delta || data.content || '');
    if (!delta) return;

    if (!this.currentStreamingBubble) {
      this.currentStreamingContent = '';
      this.currentStreamingProcessItems = [];
      this.streamStartedAt = this.streamStartedAt || Date.now();
      this.currentStreamingBubble = this._appendMessage({ role: 'ai', content: '' });
      this.currentStreamingBubble.classList.add('streaming-cursor');
    }

    this.currentStreamingContent += delta;
    this.currentStreamingBubble.innerHTML = this._renderMarkdown(this.currentStreamingContent);
    this._scrollToBottom();
  }

  _handleAIReply(data) {
    const content = typeof data === 'string' ? data : (data.content || data.message || '');
    const isDone = (typeof data === 'object' && data !== null) ? !!data.done : false;
    const isError = (typeof data === 'object' && data !== null) ? !!data.error : false;

    if (this.currentStreamingBubble) {
      if (content) {
        this.currentStreamingContent = content;
        this.currentStreamingBubble.innerHTML = this._renderMarkdown(content);
      }
      this.currentStreamingBubble.classList.remove('streaming-cursor');

      const row = this.currentStreamingBubble.closest('.message');
      if (row && this.streamStartedAt && !row.querySelector('.ai-duration')) {
        const duration = this._formatDuration(Date.now() - this.streamStartedAt);
        const brand = row.querySelector('.ai-brand');
        const durationEl = document.createElement('div');
        durationEl.className = 'ai-duration';
        durationEl.textContent = `任务耗时 ${duration}`;
        if (brand) brand.insertAdjacentElement('afterend', durationEl);
        else row.insertBefore(durationEl, row.firstChild);
      }

      this.currentStreamingBubble = null;
      this.currentStreamingContent = '';
      this.currentStreamingProcessItems = [];
      this.streamStartedAt = 0;
    } else if (content) {
      this._appendMessage({ role: 'ai', content });
    }

    if (isDone) {
      this._updateAIStatus(isError ? 'error' : 'idle');
      this.elements.btnSend.disabled = !this.elements.inputMessage.value.trim();
    }

    this._scrollToBottom();
  }

  _appendThinking(data) {
    const eventType = data.eventType || '';
    if (eventType === 'reasoning-end') {
      this._resetThinking();
      return;
    }

    const text = typeof data === 'string' ? data : (data.content || data.summary || '');
    if (!text) return;

    if (!this.currentStreamingBubble) {
      this.currentStreamingContent = '';
      this.currentStreamingProcessItems = [];
      this.currentStreamingBubble = this._appendMessage({ role: 'ai', content: '' });
    }

    const processKey = this._ensureProcessForCurrentBubble();
    const bucket = this.processItemsByKey.get(processKey);
    const latest = bucket?.items?.slice().reverse().find(item => item.type === 'thinking' && item.status !== 'done');
    if (latest && data.append) latest.content += text;
    else bucket?.items?.push({ type: 'thinking', title: '思考过程', content: text, status: 'running' });
    this._updateProcessButton(processKey);
    this._scrollToBottom();
  }

  _resetThinking() {
    const processKey = this.currentStreamingBubble?.closest('.message')?.dataset?.processKey;
    const bucket = processKey ? this.processItemsByKey.get(processKey) : null;
    if (bucket?.items?.length) {
      bucket.items.forEach(item => { if (item.type === 'thinking') item.status = 'done'; });
      this._updateProcessButton(processKey);
    }
  }

  _openProcessSheet(processKey) {
    const record = this.processItemsByKey.get(processKey);
    if (!record || !this.elements.processSheet) return;
    this.elements.processSheetContent.innerHTML = record.items.length
      ? record.items.map(item => this._renderProcessItem(item)).join('')
      : '<div class="process-empty">暂无过程内容</div>';
    this.elements.processSheet.classList.remove('hidden');
    this.elements.processSheet.setAttribute('aria-hidden', 'false');
    document.body.classList.add('process-sheet-open');
  }

  _closeProcessSheet() {
    if (!this.elements.processSheet) return;
    this.elements.processSheet.classList.add('hidden');
    this.elements.processSheet.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('process-sheet-open');
  }

  _renderProcessItem(item = {}) {
    const status = String(item.status || '').toLowerCase();
    const type = item.type === 'tool' ? 'tool' : 'thinking';
    const label = type === 'tool' ? this._humanizeToolTitle(item.title) : '思考过程';
    const statusText = status === 'running' ? '执行中'
      : status === 'error' || status === 'failed' ? '失败'
      : status === 'done' || status === 'completed' ? '已完成'
      : '';
    return `
      <article class="process-item ${type} ${status}">
        <div class="process-item-rail"></div>
        <div class="process-item-main">
          <div class="process-item-head">
            <strong>${this._escapeHtml(label)}</strong>
            ${statusText ? `<em>${this._escapeHtml(statusText)}</em>` : ''}
          </div>
          <pre>${this._escapeHtml(item.content || '')}</pre>
        </div>
      </article>`;
  }

  _addToolCall(data) {
    if (!this.currentStreamingBubble) {
      this.currentStreamingContent = '';
      this.currentStreamingProcessItems = [];
      this.currentStreamingBubble = this._appendMessage({ role: 'ai', content: '' });
    }

    const toolName = data.toolName || data.name || data.tool || '工具';
    const processKey = this._ensureProcessForCurrentBubble();
    const bucket = this.processItemsByKey.get(processKey);
    bucket?.items?.push({
      type: 'tool',
      title: toolName,
      content: this._stringifyProcessDetail(data.args || data.input || data.payload || ''),
      status: 'running',
      id: data.toolId || data.id || data.toolCallId || ''
    });
    this._updateProcessButton(processKey);
    this._scrollToBottom();
  }

  _updateToolCall(data) {
    const toolId = data.toolId || data.id || '';
    const processKey = this.currentStreamingBubble?.closest('.message')?.dataset?.processKey;
    const bucket = processKey ? this.processItemsByKey.get(processKey) : null;
    if (bucket) {
      const item = [...bucket.items].reverse().find(entry => entry.type === 'tool' && (!toolId || entry.id === toolId));
      if (item) {
        item.status = data.error || data.status === 'error' ? 'error' : 'completed';
        item.content = this._stringifyProcessDetail(data.result || data.error || data.message || item.content);
      }
      this._updateProcessButton(processKey);
    }
  }

  _scheduleProjectRefresh() {
    clearTimeout(this._projectRefreshTimer);
    this._projectRefreshTimer = setTimeout(() => {
      if (this.currentView === 'main') this._loadProjects({ silent: true });
    }, 180);
  }

  async _loadProjects(options = {}) {
    const listEl = this.elements.taskList;
    if (listEl && !options.silent) listEl.innerHTML = '<div class="loading">加载中...</div>';

    try {
      const result = await this.client.sendCommand(Action.PROJECT_LIST);
      this.projects = (result && result.projects) || [];
      this.projects.sort((a, b) => {
        const ta = Number(a.updatedAt || a.lastOpenedAt || a.createdAt || a.lastActiveAt || 0);
        const tb = Number(b.updatedAt || b.lastOpenedAt || b.createdAt || b.lastActiveAt || 0);
        return tb - ta;
      });
      this._renderTasks();
      this._syncSettingProject();
    } catch {
      if (listEl && !options.silent) listEl.innerHTML = '<div class="loading">加载失败</div>';
    }
  }

  _toggleTaskSearch() {
    this.taskSearchOpen = !this.taskSearchOpen;
    this.elements.homeSearchBar?.classList.toggle('hidden', !this.taskSearchOpen);
    if (this.taskSearchOpen) this.elements.inputTaskSearch?.focus();
    else {
      this.taskQuery = '';
      if (this.elements.inputTaskSearch) this.elements.inputTaskSearch.value = '';
      this._renderTasks();
    }
  }

  _renderTasks() {
    const listEl = this.elements.taskList;
    if (!listEl) return;

    const query = String(this.taskQuery || '').toLowerCase();
    this.filteredProjects = this.projects.filter((p) => {
      if (!query) return true;
      const meta = this._getProjectListMeta(p);
      return `${meta.title} ${meta.subtitle} ${p.path || ''}`.toLowerCase().includes(query);
    });

    const taskEntries = this.projects
      .filter(project => project.active)
      .map(project => {
        const runs = Array.isArray(project.recentRuns) ? project.recentRuns : [];
        const run = runs.find(item => ['running', 'recoverable', 'paused', 'waiting'].includes(String(item?.status || '').toLowerCase())) || null;
        return { project, run };
      })
      .filter(({ project, run }) => {
        if (!query) return true;
        const content = [
          run?.metadata?.messagePreview,
          run?.metadata?.modelName,
          project?.name,
          project?.title,
          project?.path,
          project?.branchName,
        ].filter(Boolean).join(' ').toLowerCase();
        return content.includes(query);
      })
      .sort((a, b) => {
        const bTime = b.run?.updatedAt || b.run?.createdAt || b.project.lastOpenedAt || b.project.updatedAt;
        const aTime = a.run?.updatedAt || a.run?.createdAt || a.project.lastOpenedAt || a.project.updatedAt;
        return this._timestampValue(bTime) - this._timestampValue(aTime);
      });

    if (this.elements.homeTitle) {
      this.elements.homeTitle.textContent = taskEntries.length > 3
        ? (this.showAllTasks ? '收起' : '查看全部')
        : `${taskEntries.length} 项`;
    }

    if (!taskEntries.length) {
      const emptyText = query
        ? '没有匹配的当前任务'
        : (this.projects.length ? '当前没有桌面端活跃项目' : '尚未同步到桌面项目');
      listEl.innerHTML = `<div class="task-empty">${emptyText}</div>`;
      this._renderDashboardPanels();
      return;
    }

    listEl.innerHTML = '';
    const visibleEntries = this.showAllTasks || query ? taskEntries : taskEntries.slice(0, 3);
    visibleEntries.forEach(({ project, run }) => {
      const meta = this._getProjectListMeta(project);
      const status = this._runStatusMeta(run?.status || 'ready');
      const title = run?.metadata?.messagePreview || meta.title;
      const modelName = run?.metadata?.modelName || run?.metadata?.modelId || project.modelKey || '';
      const branchName = project.currentBranch || project.branchName || project.workspaceBranch || '';
      const updatedAt = run?.updatedAt || run?.createdAt || project.lastOpenedAt || project.updatedAt;
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'task-item' + (project.id === this.currentProjectId ? ' active' : '');
      item.dataset.id = project.id;
      item.innerHTML = `
        <span class="task-icon" aria-hidden="true">${meta.icon}</span>
        <span class="task-main">
          <span class="task-status ${status.className}">${status.label}</span>
          <span class="task-title">${this._escapeHtml(title)}</span>
          <span class="task-meta">
            <span class="task-meta-text">${this._escapeHtml([project.name || this._basename(project.path), branchName].filter(Boolean).join(' · '))}</span>
          </span>
        </span>
        <span class="task-progress">
          <span class="task-progress-head"><strong>${this._escapeHtml(modelName || status.label)}</strong><span>${this._escapeHtml(this._relativeProjectTime(updatedAt))}</span></span>
        </span>
        <span class="task-more" aria-hidden="true">···</span>`;
      item.addEventListener('click', () => this._switchProject(project.id));
      listEl.appendChild(item);
    });

    this._renderDashboardPanels();
  }

  _runStatusMeta(status = '') {
    const value = String(status || '').toLowerCase();
    if (value === 'ready' || value === 'idle') return { label: '就绪', className: 'ready' };
    if (value === 'recoverable') return { label: '待恢复', className: 'recoverable' };
    if (value === 'paused' || value === 'waiting') return { label: '等待中', className: 'waiting' };
    if (value === 'completed') return { label: '已完成', className: 'done' };
    if (value === 'failed' || value === 'error') return { label: '运行异常', className: 'error' };
    return { label: '运行中', className: '' };
  }

  _renderDashboardPanels() {
    const projectList = this.elements.activeProjectList;
    const conversationList = this.elements.recentConversationList;
    const items = this.filteredProjects.length || this.taskQuery ? this.filteredProjects : this.projects;
    const activeProjects = items.filter(project => project.active);
    const recentRuns = items
      .flatMap(project => (Array.isArray(project.recentRuns) ? project.recentRuns : [])
        .filter(run => !run?.metadata?.hidden)
        .map(run => ({ project, run })))
      .sort((a, b) => this._timestampValue(b.run.updatedAt || b.run.createdAt) - this._timestampValue(a.run.updatedAt || a.run.createdAt));

    if (projectList) {
      if (!activeProjects.length) {
        projectList.innerHTML = '<div class="task-empty">暂无活跃项目</div>';
      } else {
        projectList.innerHTML = '';
        activeProjects.slice(0, 3).forEach(project => {
          const meta = this._getProjectListMeta(project);
          const branch = project.branchName || project.workspaceBranch || '';
          const history = Number(project.historyLength || 0);
          const descriptor = [branch, history > 0 ? `${history} 条消息` : '已连接'].filter(Boolean).join(' · ');
          const button = document.createElement('button');
          button.type = 'button';
          button.className = 'compact-item';
          button.innerHTML = `
            <span class="compact-icon" aria-hidden="true">${meta.icon}</span>
            <span class="compact-copy"><strong>${this._escapeHtml(project.name || this._basename(project.path) || meta.title)}</strong><small>${this._escapeHtml(descriptor)}</small></span>
            <i class="compact-state-dot" aria-hidden="true"></i>`;
          button.addEventListener('click', () => this._switchProject(project.id));
          projectList.appendChild(button);
        });
      }
    }

    if (conversationList) {
      if (!recentRuns.length) {
        conversationList.innerHTML = '<div class="task-empty">暂无最近会话</div>';
      } else {
        conversationList.innerHTML = '';
        recentRuns.slice(0, 3).forEach(({ project, run }) => {
          const title = run?.metadata?.messagePreview || project.chatSessionTitle || project.branchTitle || project.name || this._basename(project.path);
          const modelName = this._shortModelName(run, project);
          const button = document.createElement('button');
          button.type = 'button';
          button.className = 'compact-item conversation-item';
          button.innerHTML = `
            <span class="compact-icon" aria-hidden="true"><svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.9"><path d="M21 12a8 8 0 0 1-11.5 7.2L4 20l1.1-4.2A8 8 0 1 1 21 12Z"/></svg></span>
            <span class="compact-copy"><strong>${this._escapeHtml(title || '未命名会话')}</strong><small>${this._escapeHtml(this._relativeProjectTime(run.updatedAt || run.createdAt))}</small></span>
            ${modelName ? `<span class="conversation-model">${this._escapeHtml(modelName)}</span>` : ''}`;
          button.addEventListener('click', () => this._switchProject(project.id));
          conversationList.appendChild(button);
        });
      }
    }
  }

  _timestampValue(value) {
    if (value == null || value === '') return 0;
    const numeric = Number(value);
    if (Number.isFinite(numeric) && numeric > 0) return numeric;
    const parsed = new Date(value).getTime();
    return Number.isFinite(parsed) ? parsed : 0;
  }

  _relativeProjectTime(value) {
    const timestamp = this._timestampValue(value);
    if (!timestamp) return '暂无时间';
    const date = new Date(timestamp);
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const day = 24 * 60 * 60 * 1000;
    const prefix = timestamp >= startOfToday ? '今天'
      : timestamp >= startOfToday - day ? '昨天'
      : `${String(date.getMonth() + 1).padStart(2, '0')}/${String(date.getDate()).padStart(2, '0')}`;
    return `${prefix} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
  }

  _shortModelName(run = {}, project = {}) {
    const name = run?.metadata?.modelName || run?.metadata?.modelId || project.modelKey || '';
    return name ? String(name).replace(/\s+/g, '-').slice(0, 18) : '';
  }

  _getProjectListMeta(project = {}) {
    const title = project.chatSessionTitle || project.branchTitle || project.title || project.name || project.id || '未命名项目';
    const typeLabel = this._projectTypeLabel(project);
    const projectName = project.name || this._basename(project.path) || project.id || '';
    const subtitle = [typeLabel, projectName].filter(Boolean).join(' · ');
    const timestamp = project.updatedAt || project.lastOpenedAt || project.createdAt || project.lastActiveAt || 0;
    return {
      title,
      subtitle,
      time: this._formatListTime(timestamp),
      icon: this._projectIcon(typeLabel)
    };
  }

  _projectTypeLabel(project = {}) {
    const raw = String(project.skillName || project.workflowName || project.executionMode || project.category || '');
    if (/work|评估|方案|文档/i.test(raw)) return 'Work';
    if (/review|审查/i.test(raw)) return 'Review';
    return raw;
  }

  _projectIcon(typeLabel = 'Code') {
    if (/work/i.test(typeLabel)) {
      return '<svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" stroke-width="1.8" fill="none"><rect x="3" y="7" width="18" height="13" rx="2"/><path d="M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2"/></svg>';
    }
    if (/review/i.test(typeLabel)) {
      return '<svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" stroke-width="1.8" fill="none"><path d="M4 19.5V5a2 2 0 0 1 2-2h9l5 5v11.5a1.5 1.5 0 0 1-1.5 1.5H5.5A1.5 1.5 0 0 1 4 19.5Z"/><path d="M14 3v5h5"/></svg>';
    }
    return '<svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" stroke-width="1.8" fill="none"><path d="m16 18 6-6-6-6"/><path d="m8 6-6 6 6 6"/></svg>';
  }

  _basename(path = '') {
    return String(path || '').split(/[\\/]/).filter(Boolean).pop() || '';
  }

  _formatListTime(value) {
    const ts = this._timestampValue(value);
    if (!ts) return '';
    const date = new Date(ts);
    if (!Number.isFinite(date.getTime())) return '';
    const now = new Date();
    const pad = n => String(n).padStart(2, '0');
    if (date.toDateString() === now.toDateString()) return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
    return `${pad(date.getMonth() + 1)}/${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }

  _formatDuration(ms) {
    const total = Math.max(0, Math.round(Number(ms || 0) / 1000));
    const m = Math.floor(total / 60);
    const s = total % 60;
    if (m <= 0) return `${s}s`;
    return `${m}m ${String(s).padStart(2, '0')}s`;
  }

  async _switchProject(projectId) {
    this.currentProjectId = projectId;
    this.messages = [];
    this.currentStreamingBubble = null;
    this.currentStreamingContent = '';
    this.currentStreamingProcessItems = [];
    this.processItemsByKey.clear();
    this.elements.messageList.innerHTML = '';
    this._renderTasks();

    try {
      await this.client.sendCommand(Action.PROJECT_SWITCH, { projectId });
      const history = await this.client.sendCommand(Action.CHAT_HISTORY, { projectId });
      const messages = Array.isArray(history?.messagesHistory) ? history.messagesHistory
        : Array.isArray(history?.messages) ? history.messages
        : [];
      messages.forEach((msg) => this._appendMessage(msg));
      this._updateChatHeader();
      this._syncSettingProject();
      this._switchPage('chat');
    } catch {
      this._appendMessage({ role: 'system', content: '切换项目失败' });
      this._switchPage('chat');
    }
  }

  _startQuickChat() {
    if (this.currentProjectId) {
      this._switchPage('chat');
      this.elements.inputMessage?.focus();
      return;
    }
    if (this.projects[0]?.id) {
      this._switchProject(this.projects[0].id);
      return;
    }
    if (this.elements.taskList) {
      this.elements.taskList.innerHTML = '<div class="task-empty">还没有可继续的任务，请先在桌面端打开项目</div>';
    }
  }

  _updateChatHeader() {
    const project = this.projects.find(p => p.id === this.currentProjectId);
    if (!project) {
      this.elements.headerTitle.textContent = '当前任务';
      if (this.elements.currentProjectPath) this.elements.currentProjectPath.textContent = '';
      return;
    }
    const meta = this._getProjectListMeta(project);
    this.elements.headerTitle.textContent = meta.title;
    if (this.elements.currentProjectPath) {
      const owner = this.deviceName || '本机';
      this.elements.currentProjectPath.textContent = `${owner} · ${project.name || this._basename(project.path) || project.id}`;
    }
  }

  _syncSettingProject() {
    const project = this.projects.find(p => p.id === this.currentProjectId);
    if (this.elements.settingProject) {
      this.elements.settingProject.textContent = project
        ? (project.name || this._basename(project.path) || project.id)
        : '未选择';
    }
  }

  _handleMobileNavigation(target) {
    if (target === 'home') {
      this._switchPage('home');
      this._setActiveMobileTab('home');
      return;
    }
    if (target === 'run') {
      this._setActiveMobileTab('run');
      this._startQuickChat();
      return;
    }
    if (target === 'projects') {
      this._switchPage('home');
      this._setActiveMobileTab('projects');
      requestAnimationFrame(() => this._focusDashboardCard('active-projects-card'));
      return;
    }
    if (target === 'files') {
      this._setActiveMobileTab('files');
      this._showMobileToast(this.currentProjectId ? '文件管理将在当前任务中打开' : '请先选择一个项目');
      setTimeout(() => this._setActiveMobileTab('home'), 900);
      return;
    }
    if (target === 'settings') {
      this._switchPage('settings');
      this._setActiveMobileTab('settings');
    }
  }

  _handleHomeAction(action) {
    if (action === 'run') {
      this._setActiveMobileTab('run');
      this._startQuickChat();
      return;
    }
    if (action === 'security') {
      this._showMobileToast('已定位到安全扫描入口，请在当前任务中确认执行');
      return;
    }
    if (action === 'report') {
      this._showMobileToast('性能分析将在当前任务中生成报告');
    }
  }

  _setActiveMobileTab(target) {
    this.elements.mobileTabs?.forEach((button) => {
      button.classList.toggle('active', button.dataset.mobilePage === target);
    });
  }

  _focusDashboardCard(id) {
    const card = document.getElementById(id);
    if (!card) return;
    card.scrollIntoView({ behavior: 'smooth', block: 'center' });
    card.classList.remove('attention');
    requestAnimationFrame(() => card.classList.add('attention'));
    setTimeout(() => card.classList.remove('attention'), 700);
  }

  _showMobileToast(message) {
    const toast = this.elements.mobileToast;
    if (!toast) return;
    clearTimeout(this._toastTimer);
    toast.textContent = String(message || '操作已完成');
    toast.classList.remove('hidden');
    this._toastTimer = setTimeout(() => toast.classList.add('hidden'), 1800);
  }

  _switchView(viewName) {
    this.currentView = viewName;
    this.elements.viewPairing.classList.toggle('active', viewName === 'pairing');
    this.elements.viewMain.classList.toggle('active', viewName === 'main');
  }

  _switchPage(pageName) {
    this.currentPage = pageName;
    const el = this.elements;
    el.pageHome?.classList.toggle('active', pageName === 'home');
    el.pageChat?.classList.toggle('active', pageName === 'chat');
    el.pageSettings?.classList.toggle('active', pageName === 'settings');
    if (el.viewMain) el.viewMain.dataset.page = pageName;

    if (pageName === 'home') this._setActiveMobileTab('home');
    else if (pageName === 'chat') this._setActiveMobileTab('run');
    else if (pageName === 'settings') this._setActiveMobileTab('settings');

    if (pageName === 'home') this._loadProjects();
    if (pageName === 'settings') this._loadSkills();
    if (pageName === 'chat') this._updateChatHeader();
  }

  _updateConnectionState(state) {
    const el = this.elements;
    const bar = el.connectionBar;

    if (state === 'connected') bar.classList.add('hidden');
    else bar.classList.remove('hidden');

    bar.classList.remove('connected', 'reconnecting', 'connecting');
    if (state === 'reconnecting') bar.classList.add('reconnecting');
    else if (state === 'connecting') bar.classList.add('connecting');
    else if (state === 'connected') bar.classList.add('connected');

    const texts = {
      disconnected: '连接断开',
      connecting: '连接中...',
      reconnecting: '重新连接中...',
      connected: '已连接',
    };
    el.statusText.textContent = texts[state] || state;
    el.settingStatus.textContent = texts[state] || state;
    el.settingDevice.textContent = this.deviceName;
    this._updateDeviceAvatar();

    if (state === 'connected' && this.currentView === 'pairing') {
      this._switchView('main');
      this._switchPage('home');
      this._loadProjects();
      this._loadModels();
    }
  }

  _updateAIStatus(status) {
    this.aiStatus = status || 'idle';
    const el = this.elements;
    if (el.aiStatusIndicator) {
      const labels = {
        idle: '空闲',
        thinking: '思考中',
        streaming: '输出中',
        error: '错误',
        interrupted: '已中断',
      };
      el.aiStatusIndicator.textContent = labels[this.aiStatus] || this.aiStatus;
    }

    const isBusy = this.aiStatus === 'thinking' || this.aiStatus === 'streaming';
    el.btnSend.classList.toggle('hidden', isBusy);
    el.btnInterrupt.classList.toggle('hidden', !isBusy);
    if (el.dashboardRuntimeStatus) {
      const dashboardLabels = {
        idle: '全部正常',
        thinking: '正在思考',
        streaming: '正在运行',
        error: '运行异常',
        interrupted: '已中断',
      };
      el.dashboardRuntimeStatus.textContent = dashboardLabels[this.aiStatus] || '全部正常';
    }
  }

  _autoGrowTextarea() {
    const ta = this.elements.inputMessage;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = Math.min(ta.scrollHeight, 110) + 'px';
  }

  _scrollToBottom() {
    const list = this.elements.messageList;
    if (!list) return;
    requestAnimationFrame(() => {
      list.scrollTop = list.scrollHeight;
    });
  }

  _escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str == null ? '' : String(str);
    return div.innerHTML;
  }

  _renderMarkdown(text) {
    if (!text) return '';
    let html = this._escapeHtml(text);

    html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => {
      const langTag = lang ? `<div class="ai-code-header"><span class="ai-code-lang">${lang}</span></div>` : '';
      return `<div class="ai-code-wrapper${lang ? ' has-lang' : ''}">${langTag}<pre class="ai-code-block"><code>${code.trim()}</code></pre></div>`;
    });
    html = html.replace(/```([\s\S]*?)```/g, (_, code) => {
      return `<div class="ai-code-wrapper"><pre class="ai-code-block"><code>${code.trim()}</code></pre></div>`;
    });
    html = html.replace(/`([^`]+)`/g, '<code class="ai-inline-code">$1</code>');
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
    html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
    html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');
    html = html.replace(/^- (.+)$/gm, '<li>$1</li>');
    html = html.replace(/(<li>.*<\/li>\n?)+/g, (match) => `<ul>${match}</ul>`);
    html = html.replace(/^---$/gm, '<hr>');

    const parts = html.split(/(<pre[\s\S]*?<\/pre>)/g);
    html = parts.map((part, i) => {
      if (i % 2 === 1) return part;
      return part.split(/\n\n+/)
        .map(p => p.trim() ? `<p>${p.replace(/\n/g, '<br>')}</p>` : '')
        .join('');
    }).join('');

    return html;
  }

  _getDefaultDeviceName() {
    const ua = navigator.userAgent;
    if (/iPhone/.test(ua)) return 'iPhone';
    if (/iPad/.test(ua)) return 'iPad';
    if (/Android/.test(ua)) {
      const m = ua.match(/;\s*([^;)]+)\s*Build/);
      return m ? m[1].trim() : 'Android';
    }
    return '移动设备';
  }

  async _loadModels() {
    try {
      const result = await this.client.sendCommand(Action.MODEL_LIST);
      this.models = (result && result.models) || [];
      this.currentModelIndex = (result && result.currentIndex) || 0;
      this._renderModelSelector();
    } catch { /* silent */ }
  }

  _renderModelSelector() {
    const el = this.elements;
    if (!el.currentModelName || !el.modelList) return;
    const currentModel = this.models[this.currentModelIndex];
    const currentName = currentModel
      ? (currentModel.modelName || currentModel.modelId || '未命名模型')
      : '未配置模型';
    el.currentModelName.textContent = currentName;
    if (el.dashboardModelName) el.dashboardModelName.textContent = currentName;
    if (el.dashboardContextSize) {
      const context = Number(currentModel?.contextWindow || currentModel?.contextLength || currentModel?.maxTokens || 0);
      el.dashboardContextSize.textContent = context > 0 ? `${Math.round(context / 1000)}K tokens` : '--';
    }

    el.modelList.innerHTML = '';
    if (!this.models.length) {
      el.modelList.innerHTML = '<button type="button" class="model-item">未配置模型</button>';
      return;
    }

    this.models.forEach((model, idx) => {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'model-item' + (idx === this.currentModelIndex ? ' active' : '');
      item.textContent = model.modelName || model.modelId || `模型 ${idx + 1}`;
      item.addEventListener('click', () => this._selectModel(idx));
      el.modelList.appendChild(item);
    });
  }

  _toggleModelPanel() {
    this.modelPanelOpen = !this.modelPanelOpen;
    this.elements.modelPanel?.classList.toggle('hidden', !this.modelPanelOpen);
    if (this.modelPanelOpen) {
      const closeHandler = (e) => {
        if (!this.elements.modelPanel.contains(e.target) && !this.elements.modelSelectorBtn.contains(e.target)) {
          this.modelPanelOpen = false;
          this.elements.modelPanel.classList.add('hidden');
          document.removeEventListener('click', closeHandler);
        }
      };
      setTimeout(() => document.addEventListener('click', closeHandler), 0);
    }
  }

  _selectModel(idx) {
    this.currentModelIndex = idx;
    this.modelPanelOpen = false;
    this.elements.modelPanel?.classList.add('hidden');
    this._renderModelSelector();
    this._renderDashboardPanels();
  }

  _getSelectedModelConfig() {
    const model = this.models[this.currentModelIndex];
    if (!model) return {};
    return {
      apiUrl: model.apiUrl,
      apiKey: model.apiKey,
      modelId: model.modelId,
      modelName: model.modelName,
      modelKey: model.modelKey,
    };
  }

  async _loadSkills() {
    const listEl = this.elements.skillList;
    if (!listEl) return;
    listEl.innerHTML = '<div class="loading">加载中...</div>';
    try {
      const project = this.projects.find(p => p.id === this.currentProjectId);
      const result = await this.client.sendCommand(Action.SKILL_LIST, {
        projectPath: project?.path || ''
      });
      const skills = Array.isArray(result) ? result
        : Array.isArray(result?.skills) ? result.skills
        : [];
      this.skills = skills;
      if (!skills.length) {
        listEl.innerHTML = '<div class="loading">暂无技能</div>';
        return;
      }
      listEl.innerHTML = skills.map((skill) => {
        const name = skill.name || skill.skillName || skill.id || '未命名技能';
        const enabled = skill.enabled !== false;
        return `<div class="skill-item"><span class="name">${this._escapeHtml(name)}</span><span class="value">${enabled ? '已启用' : '未启用'}</span></div>`;
      }).join('');
    } catch {
      listEl.innerHTML = '<div class="loading">加载失败</div>';
    }
  }

  _showAskPopup(data) {
    const el = this.elements;
    if (!el.askOverlay) return;
    this._currentAskData = data || {};
    el.askQuestion.textContent = data?.question || data?.prompt || 'AI 需要你确认';
    el.askOptions.innerHTML = '';
    const options = Array.isArray(data?.options) ? data.options : [];
    options.forEach((opt) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'ask-option-btn';
      btn.textContent = opt.label || opt.value || opt;
      btn.addEventListener('click', () => {
        this._submitAskResponse(opt.value || opt.label || opt, opt.value || opt.label || opt);
      });
      el.askOptions.appendChild(btn);
    });
    el.askOverlay.classList.remove('hidden');
  }

  _submitAskResponse(answer, value) {
    const requestId = this._currentAskData?.requestId || this._currentAskData?.id;
    this.client.sendCommand(Action.ASK_RESPONSE, {
      requestId,
      answer,
      value: value != null ? value : answer,
    }).catch(() => {});
    this.elements.askOverlay?.classList.add('hidden');
    this._currentAskData = null;
  }
}

document.addEventListener('DOMContentLoaded', () => {
  window.__lingxiRemoteApp = new App();
});
