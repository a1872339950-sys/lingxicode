(function () {
  const MAX_CHILD_AGENTS = 2
  const MAX_TEMP_AGENTS = 10
  const TERMINAL_STATUSES = new Set(['done', 'completed', 'cancelled', 'interrupted', 'error', 'failed', 'timeout', 'completed_with_errors'])
  const RUNNING_STATUSES = new Set(['queued', 'thinking', 'streaming', 'using_tools', 'running', 'active', 'working', 'running_with_errors'])

  const sessionStore = new Map()
  const pollers = new Map()
  const promptedSessions = new Set()
  const sharedAskQueue = []
  const chatRuntimes = new Map()
  const autoStartedChats = new Set()
  const sessionPaneVisibility = new Map()
  const tempAgentIcons = new Map()
  const autoOpenedCanvasSessions = new Set()
  let getActiveProjectIdProvider = () => null
  let tempAgentProjectListenerBound = false
  let getModelsProvider = () => []
  let getActiveModelProvider = () => null
  let getSkillsProvider = () => []
  let getEnabledSkillsProvider = () => []
  let chatMenuDocumentClickBound = false
  let activeSharedAsk = null
  let elapsedTimer = null

  const sessionJanitor = window.AgentCollaborationLifecycle?.createJanitor?.({
    sessionStore,
    chatRuntimes,
    sessionPaneVisibility,
    autoOpenedSessions: autoOpenedCanvasSessions,
    stopPolling: sessionId => stopSessionPolling(sessionId),
    disposeRuntime: runtime => {
      try { runtime?.renderer?.destroy?.() } catch (_) {}
      try { runtime?.toolRenderer?.destroy?.() } catch (_) {}
      runtime.history = []
      runtime.restoredMessagesHistory = []
      runtime.collectedThinking = []
      runtime.collectedTools = []
      runtime.uploadedFiles = []
      runtime.currentAiMsg = null
      runtime.currentThinkingBlock = null
      runtime.pane = null
      runtime.messagesEl = null
      runtime.inputEl = null
      runtime.sendEl = null
    }
  })

  function clearElapsedTimer() {
    if (elapsedTimer) {
      clearInterval(elapsedTimer)
      elapsedTimer = null
    }
  }

  const escapeHtml = HtmlUtils.escapeHtml

  function escapeCssIdent(value = '') {
    if (window.CSS?.escape) return window.CSS.escape(String(value || ''))
    return String(value || '').replace(/["\\]/g, '\\$&')
  }

  function normalizeSteps(steps = []) {
    return (Array.isArray(steps) ? steps : [])
      .map((step, index) => {
        if (typeof step === 'string') return { title: step, status: index === 0 ? 'active' : 'pending' }
        return {
          title: step.title || step.name || step.task || `步骤 ${index + 1}`,
          detail: step.detail || step.description || '',
          status: step.status || (index === 0 ? 'active' : 'pending')
        }
      })
      .filter(step => String(step.title || '').trim())
  }

  function normalizeEvents(events = []) {
    return (Array.isArray(events) ? events : []).map((event, index) => ({
      id: event.id || `event-${index + 1}`,
      type: event.type || 'status',
      title: event.title || event.name || event.status || '状态更新',
      name: event.name || event.title || '',
      content: event.content || event.text || event.message || event.detail || '',
      args: event.args && typeof event.args === 'object' ? event.args : null,
      result: event.result && typeof event.result === 'object' ? event.result : null,
      toolCallId: event.toolCallId || event.tool_call_id || '',
      status: event.status || '',
      createdAt: event.createdAt || event.time || ''
    }))
  }

  function clipThinkingText(value = '', maxLength = Number.POSITIVE_INFINITY) {
    const text = String(value || '')
      .replace(/```[\s\S]*?```/g, ' ')
      .replace(/[#>*_`|~]+/g, ' ')
      .replace(/\s+/g, ' ')
      .replace(/^[\s,，:：;；.!！?？。、"'“”‘’()[\]{}<>《》]+/, '')
      .trim()
    if (!/[\p{L}\p{N}\u4e00-\u9fa5]/u.test(text)) return ''
    if (!text || text.length <= maxLength) return text
    const limited = text.slice(0, maxLength)
    const sentenceEnd = Math.max(limited.lastIndexOf('。'), limited.lastIndexOf('！'), limited.lastIndexOf('？'), limited.lastIndexOf('.'), limited.lastIndexOf('!'), limited.lastIndexOf('?'))
    if (sentenceEnd >= Math.floor(maxLength * 0.45)) return limited.slice(0, sentenceEnd + 1).trim()
    const clauseEnd = Math.max(limited.lastIndexOf('，'), limited.lastIndexOf(','), limited.lastIndexOf(';'), limited.lastIndexOf('；'))
    if (clauseEnd >= Math.floor(maxLength * 0.55)) return `${limited.slice(0, clauseEnd).trim()}。`
    return `${limited.trimEnd()}。`
  }

  function getThinkingDisplayText(event = {}, agent = {}) {
    const raw = event.content || event.title || agent.statusText || '正在处理'
    const summarizer = window.AiMessageUI?.summarizeThinkingStatus
    const summarized = typeof summarizer === 'function' ? summarizer(raw) : ''
    const maxLength = window.ThinkingDisplay?.PUBLIC_THINKING_MAX_LENGTH || Number.POSITIVE_INFINITY
    if (summarized) return window.AiMessageUI?.clipAtSentence?.(summarized, maxLength) || summarized
    return clipThinkingText(raw, maxLength)
  }

  function shouldDisplayThinkingEventText(value = '') {
    if (window.AiMessageUI?.shouldDisplayThinkingStatus) {
      return window.AiMessageUI.shouldDisplayThinkingStatus(value)
    }
    const maxLength = window.ThinkingDisplay?.PUBLIC_THINKING_MAX_LENGTH || Number.POSITIVE_INFINITY
    const text = clipThinkingText(value, maxLength)
    return text.replace(/[\s,，:：;；.!！?？。、"'“”‘’()[\]{}<>《》]/g, '').length > 10
  }

  function isPlaceholderThinkingEvent(event = {}) {
    const title = String(event.title || '').trim()
    const content = String(event.content || '').trim()
    return event.isProgressNarration === true ||
      (/^第\s*\d+\s*轮思考$/.test(title) && content === '正在思考中') ||
      (!event.type && !event.status && content === '正在思考中') ||
      (!!content && !shouldDisplayThinkingEventText(content))
  }
  function compactText(value = '', limit = 360) {
    const text = String(value || '').replace(/\s+/g, ' ').trim()
    return text.length > limit ? `${text.slice(0, limit)}...` : text
  }

  function getLatestPlanStep(steps = []) {
    const normalized = normalizeSteps(steps)
    if (!normalized.length) return null
    return [...normalized].reverse().find(step => step.status === 'active') ||
      normalized.find(step => step.status !== 'done') ||
      normalized[normalized.length - 1]
  }

  function getLatestThinking(agent = {}) {
    const events = normalizeEvents(agent.thinking || agent.thoughts || []).filter(event => !isPlaceholderThinkingEvent(event))
    return events[events.length - 1] || null
  }

  function getLatestTool(agent = {}) {
    const tools = normalizeEvents(agent.tools || agent.toolCalls || [])
    return tools[tools.length - 1] || null
  }

  function getReportMeta(agent = {}, session = {}) {
    const partial = agent.partialReport && typeof agent.partialReport === 'object' ? agent.partialReport : null
    const reports = Array.isArray(session.reports) ? session.reports : []
    const report = reports.find(item => {
      const agentId = String(agent.id || '')
      if (!agentId) return false
      return String(item?.agentId || item?.id || '') === agentId
    }) || null
    return {
      fileName: agent.reportFileName || partial?.reportFileName || report?.reportFileName || '',
      filePath: agent.reportFilePath || partial?.reportFilePath || report?.reportFilePath || '',
      content: agent.content || partial?.content || report?.content || ''
    }
  }

  const formatElapsed = FormatUtils.formatElapsedMs

  function isDone(status = '') {
    return TERMINAL_STATUSES.has(String(status || ''))
  }

  function isRunning(status = '') {
    return RUNNING_STATUSES.has(String(status || ''))
  }

  function isSessionComplete(session = {}) {
    const agents = Array.isArray(session.agents) ? session.agents : []
    return agents.length > 0 && agents.every(agent => isDone(agent.status))
  }

  function getSessionReportCount(session = {}) {
    return (Array.isArray(session.agents) ? session.agents : [])
      .filter(agent => {
        const report = getReportMeta(agent, session)
        return report.filePath || report.fileName || report.content
      })
      .length
  }

  function getSession(sessionId) {
    return sessionStore.get(sessionId) || null
  }

  function findActiveSession(projectId = '') {
    const sessions = Array.from(sessionStore.values())
      .filter(session => !projectId || session.projectId === projectId)
      .filter(session => !isDone(session.status))
    return sessions[sessions.length - 1] || null
  }

  function getAgentElapsedMs(agent = {}, session = {}) {
    if (Number(agent.elapsedMs) > 0) return Number(agent.elapsedMs)
    if (Number(agent.completedAt) > 0 && Number(agent.startedAt) > 0) {
      return Math.max(0, Number(agent.completedAt) - Number(agent.startedAt))
    }
    const start = Number(agent.startedAt || agent.createdAt || session.createdAt || 0)
    return start ? Math.max(0, Date.now() - start) : 0
  }

  function prettifyModelName(rawName = '', key = '', index = 0) {
    const value = String(rawName || key || '').trim()
    const cleaned = value
      .replace(/^lingxi-cloud-default-/i, '')
      .replace(/^lingxi-cloud-/i, '')
      .replace(/^cloud-default-/i, '')
      .replace(/^default-/i, '')
    if (/^mq[0-9a-z-]{8,}$/i.test(cleaned)) return `自定义模型 ${index + 1}`
    return cleaned || '当前模型'
  }

  function getAgentModelLabel(agent = {}) {
    return prettifyModelName(agent.modelName || agent.modelKey || '', agent.modelKey || '', 0)
  }

  function getModelKey(model = {}) {
    if (!model) return ''
    return String(model.modelKey || model.id || model.key || model.name || model.model || model.modelId || '')
  }

  function getModelDisplayName(model = {}, index = 0) {
    if (!model) return ''
    const key = getModelKey(model)
    return prettifyModelName(model.displayName || model.label || model.modelName || model.model || model.modelId || model.name || key, key, index)
  }

  function getConfiguredModels() {
    const list = getModelsProvider()
    return Array.isArray(list) ? list : []
  }

  function getConfiguredSkills() {
    const list = getSkillsProvider()
    const enabled = getEnabledSkillsProvider()
    const skills = Array.isArray(list) ? list : []
    const enabledNames = Array.isArray(enabled) ? enabled : []
    return enabledNames.length ? skills.filter(skill => enabledNames.includes(skill.name)) : skills
  }

  function findModelByKey(key = '') {
    const target = String(key || '')
    if (!target) return null
    return getConfiguredModels().find(model => getModelKey(model) === target) || null
  }

  function getAgentDisplayName(agent = {}, index = 0) {
    const values = [agent.name, agent.role, agent.title, agent.task]
      .map(value => String(value || '').trim())
      .filter(Boolean)
    const genericPattern = /^(ai|a|agent|assistant)\s*[\d一二三四五六七八九十]*$/i
    const value = values.find(item => !genericPattern.test(item)) || values[0]
    return value || `协作会话 ${index + 1}`
  }

  function getStatusLabel(status = '') {
    const labels = {
      waiting: '等待中',
      queued: '排队中',
      thinking: '执行中',
      running: '执行中',
      active: '执行中',
      working: '执行中',
      running_with_errors: '执行中',
      done: '已完成',
      completed: '已完成',
      completed_with_errors: '已完成',
      cancelled: '已停止',
      interrupted: '已中断',
      error: '出错',
      failed: '失败',
      timeout: '超时'
    }
    return labels[String(status || '')] || String(status || '等待中')
  }

  function renderAiContent(content = '') {
    if (window.AiMessageUI?.renderAiContent) return window.AiMessageUI.renderAiContent(content)
    return escapeHtml(content).replace(/\n/g, '<br>')
  }

  function renderTemporaryReportNotice(state = {}) {
    const filePath = state.reportFilePath || state.agent?.reportFilePath || ''
    const fileName = state.reportFileName || state.agent?.reportFileName || (filePath ? filePath.split(/[\\/]/).pop() : '')
    if (!filePath) return '<p>汇报内容已写入临时文件。</p>'
    const title = state.agent?.name || state.agent?.role || '临时 AI 汇报'
    return `
      <div class="agent-collab-temp-report-notice">
        <span>汇报内容已写入临时文件，文件路径为</span>
        <button type="button"
          class="agent-collab-report-file"
          data-collab-report-file
          data-report-path="${escapeHtml(filePath)}"
          data-report-title="${escapeHtml(title)}">${escapeHtml(fileName || filePath)}</button>
      </div>
    `
  }

  function toolLabel(name = '') {
    const labels = {
      read_file: '读取文件',
      write_file: '写入文件',
      edit_file: '编辑文件',
      delete_file: '删除文件',
      create_directory: '创建文件夹',
      list_files: '查看文件列表',
      discover_code: '发现代码',
      search_project: '搜索项目',
      grep_code: '搜索代码',
      run_command: '执行命令',
      inspect_image: '查看图片',
      capture_screenshot: '网页截图'
    }
    return labels[name] || name || '工具操作'
  }

  function findSessionForAsk(data = {}) {
    const sessionId = String(data.collaborationSessionId || '')
    if (sessionId && sessionStore.has(sessionId)) return sessionStore.get(sessionId)
    const projectId = String(data.projectId || '')
    for (const session of sessionStore.values()) {
      if (!projectId || String(session.projectId || '') === projectId) return session
    }
    return null
  }

  function renderNextSharedAsk() {
    if (activeSharedAsk || sharedAskQueue.length === 0) return
    const data = sharedAskQueue.shift()
    const session = findSessionForAsk(data)
    if (!session?.id) return false
    const view = document.querySelector(`[data-collab-session="${escapeCssIdent(session.id)}"]`)
    if (!view) return false
    const overlay = view.querySelector('[data-collab-shared-ask]')
    if (!overlay) return false
    activeSharedAsk = data
    const agentName = data.collaborationAgentName || data.collaborationAgentId || '右侧协作 AI'
    overlay.innerHTML = `
      <div class="agent-collab-shared-ask-card">
        <div class="agent-collab-shared-ask-kicker">右侧协作 AI 需要授权</div>
        <div class="agent-collab-shared-ask-title">${escapeHtml(agentName)} 正在请求访问项目外路径</div>
        <div class="agent-collab-shared-ask-paths">
          <div><span>项目</span><strong>${escapeHtml(data.projectPath || '')}</strong></div>
          <div><span>路径</span><strong>${escapeHtml(data.path || '')}</strong></div>
          <div><span>操作</span><strong>${escapeHtml(toolLabel(data.operation || data.toolName || ''))}</strong></div>
        </div>
        <div class="agent-collab-shared-ask-actions">
          <button type="button" data-ask-value="allow_once">允许本次</button>
          <button type="button" data-ask-value="allow_always">后续允许</button>
          <button type="button" data-ask-value="rejected">拒绝</button>
        </div>
      </div>
    `
    overlay.classList.add('show')
    overlay.querySelectorAll('[data-ask-value]').forEach(btn => {
      btn.addEventListener('click', () => {
        const value = btn.dataset.askValue || 'rejected'
        window.api?.sendAskPopupResponse?.({
          requestId: data.requestId,
          projectId: data.projectId || session.projectId || '',
          type: data.type || 'path_permission',
          value,
          answer: btn.textContent || value,
          selectedOption: { value, label: btn.textContent || value }
        })
        overlay.classList.remove('show')
        overlay.innerHTML = ''
        activeSharedAsk = null
        renderNextSharedAsk()
      }, { once: true })
    })
    return true
  }

  function handleSharedAsk(data = {}) {
    if (data.source !== 'agent_collaboration' && !data.collaborationSessionId) return false
    const session = findSessionForAsk(data)
    if (!session?.id) return false
    sharedAskQueue.push(data)
    return renderNextSharedAsk() !== false
  }

  function renderPlanPanel(steps = [], options = {}) {
    const normalized = normalizeSteps(steps)
    if (!normalized.length) return ''
    const prefix = options.prefix || 'ai'
    const current = [...normalized].reverse().find(step => step.status === 'active') ||
      normalized.find(step => step.status !== 'done') ||
      normalized[normalized.length - 1]
    const collapsed = options.collapsed !== false
    return `
      <div class="${prefix}-plan-panel" data-plan-panel>
        <div class="${prefix}-plan-header" data-plan-toggle>
          <span class="${prefix}-plan-title">${escapeHtml(options.title || '计划')}</span>
          <span class="${prefix}-plan-current">${escapeHtml(current?.title || '')}</span>
          <span class="${prefix}-plan-count">${normalized.length} 步</span>
        </div>
        <div class="${prefix}-plan-list ${collapsed ? 'collapsed' : ''}">
          ${normalized.map((step, index) => `
            <div class="${prefix}-plan-step ${escapeHtml(step.status || 'pending')}">
              <span>${index + 1}.</span>
              <span>${escapeHtml(step.title)}${step.detail ? `<br><small>${escapeHtml(step.detail)}</small>` : ''}</span>
            </div>
          `).join('')}
        </div>
      </div>
    `
  }

  function renderAgentSummary(agent = {}, session = {}) {
    const thinkingEvents = normalizeEvents(agent.thinking || agent.thoughts || []).filter(event => !isPlaceholderThinkingEvent(event))
    const toolEvents = normalizeEvents(agent.tools || agent.toolCalls || [])
    const latestThinking = getLatestThinking(agent)
    const latestTool = getLatestTool(agent)
    const latestPlan = getLatestPlanStep(agent.plan || session.plan || [])
    const reportMeta = getReportMeta(agent, session)
    const done = isDone(agent.status)
    const thinkingText = latestThinking ? getThinkingDisplayText(latestThinking, agent) : (agent.statusText || '等待思考内容')
    const toolText = latestTool ? compactText(latestTool.title || latestTool.name || latestTool.content || '工具调用', 120) : '等待工具调用'
    const planText = latestPlan ? compactText(latestPlan.title || latestPlan.detail || '计划步骤', 140) : '等待计划步骤'
    const reportTitle = agent.name || agent.role || getAgentModelLabel(agent) || '协作 AI 汇报'
    const reportContent = reportMeta.content || agent.content || ''
    return `
      <div class="agent-collab-summary agent-collab-report-body">
        ${reportContent ? `
          <div class="agent-collab-report-content">${renderAiContent(reportContent)}</div>
        ` : `
          <div class="agent-collab-report-placeholder">
            <div class="agent-collab-report-section-title">实时进展</div>
            <p>${escapeHtml(thinkingText)}</p>
          </div>
        `}
        <div class="agent-collab-report-divider"></div>
        <div class="agent-collab-summary-row">
          <span class="agent-collab-summary-label">思考</span>
          <span class="agent-collab-summary-text">${escapeHtml(thinkingText)}</span>
          <span class="agent-collab-summary-count">${thinkingEvents.length}</span>
        </div>
        <div class="agent-collab-summary-row">
          <span class="agent-collab-summary-label">工具</span>
          <span class="agent-collab-summary-text">${escapeHtml(toolText)}</span>
          <span class="agent-collab-summary-count">${toolEvents.length}</span>
        </div>
        <div class="agent-collab-summary-row">
          <span class="agent-collab-summary-label">计划</span>
          <span class="agent-collab-summary-text">${escapeHtml(planText)}</span>
          <span class="agent-collab-summary-count">${latestPlan?.status === 'done' ? '✓' : '·'}</span>
        </div>
        ${done ? `
          <div class="agent-collab-report-entry">
            <span>已作出汇报总结到主窗口 AI</span>
            ${reportMeta.fileName ? `
              <button type="button"
                class="agent-collab-report-file"
                data-collab-report-file
                data-report-path="${escapeHtml(reportMeta.filePath)}"
                data-report-title="${escapeHtml(reportTitle)}"
                data-report-content="${escapeHtml(reportMeta.content)}">${escapeHtml(reportMeta.fileName)}</button>
            ` : '<span class="agent-collab-report-missing">等待汇报文件</span>'}
          </div>
        ` : ''}
      </div>
    `
  }

  function bindPlanToggles(root = document) {
    root.querySelectorAll('[data-plan-toggle]').forEach(header => {
      if (header.dataset.bound === '1') return
      header.dataset.bound = '1'
      header.addEventListener('click', () => {
        const panel = header.closest('[data-plan-panel]')
        panel?.querySelector('.ai-plan-list, .agent-plan-list')?.classList.toggle('collapsed')
      })
    })
  }

  function bindStopActions(root = document) {
    root.querySelectorAll('[data-collab-stop-agent]').forEach(btn => {
      if (btn.dataset.bound === '1') return
      btn.dataset.bound = '1'
      btn.addEventListener('click', async event => {
        event.preventDefault()
        event.stopPropagation()
        const projectId = btn.dataset.projectId || ''
        const sessionId = btn.dataset.sessionId || ''
        const agentId = btn.dataset.agentId || ''
        const chatProjectId = btn.dataset.chatProjectId || ''
        if (!projectId || !sessionId || !agentId) return
        btn.disabled = true
        try {
          if (chatProjectId) window.api?.interruptAi?.(chatProjectId)
          const result = await window.api?.stopAgentCollaborationAi?.(projectId, sessionId, agentId, '用户停止了该协作 AI')
          if (result?.session) renderSessionIntoDom(result.session)
        } finally {
          btn.disabled = false
        }
      })
    })

    root.querySelectorAll('[data-collab-stop-all]').forEach(btn => {
      if (btn.dataset.bound === '1') return
      btn.dataset.bound = '1'
      btn.addEventListener('click', async event => {
        event.preventDefault()
        event.stopPropagation()
        const projectId = btn.dataset.projectId || ''
        const sessionId = btn.dataset.sessionId || ''
        if (!projectId || !sessionId) return
        btn.disabled = true
        try {
          const result = await window.api?.stopAgentCollaborationAll?.(projectId, sessionId, '用户停止了全部协作 AI')
          if (result?.session) renderSessionIntoDom(result.session)
        } finally {
          btn.disabled = false
        }
      })
    })
  }

  function applySessionPaneVisibility(session = {}, view = document) {
    const agents = getSessionAgents(session)
    const visibleIndexes = getVisiblePaneIndexes(session, agents)
    const visibleSet = new Set(visibleIndexes)
    const visibleCount = Math.max(1, Math.min(MAX_CHILD_AGENTS, visibleIndexes.length || 1))
    const grid = view.querySelector?.('.agent-collab-chat-grid')
    if (grid) {
      for (let i = 1; i <= 6; i++) grid.classList.remove(`agent-count-${i}`)
      grid.classList.add(`agent-count-${visibleCount}`)
      grid.dataset.visibleCount = String(visibleCount)
    }

    const toggleAction = visibleIndexes.length < agents.length ? 'expand' : 'collapse'
    const toggleTitle = toggleAction === 'expand' ? '展开第二个会话窗口' : '收起当前会话窗口'
    view.querySelectorAll?.('[data-collab-agent-index]').forEach(pane => {
      if (!pane.classList?.contains('agent-collab-chat-clone')) return
      const index = Number(pane.dataset.collabAgentIndex)
      const visible = visibleSet.has(index)
      pane.classList.toggle('agent-collab-chat-hidden', !visible)
      pane.setAttribute('aria-hidden', visible ? 'false' : 'true')
      const button = pane.querySelector('[data-collab-pane-toggle]')
      if (button) {
        button.dataset.collabPaneToggle = toggleAction
        button.innerHTML = getPaneToggleIcon(toggleAction)
        button.title = toggleTitle
        button.setAttribute('aria-label', toggleTitle)
      }
    })
  }

  function bindPaneVisibilityActions(root = document) {
    root.querySelectorAll?.('[data-collab-pane-toggle]').forEach(button => {
      if (button.dataset.bound === '1') return
      button.dataset.bound = '1'
      button.addEventListener('click', event => {
        event.preventDefault()
        event.stopPropagation()
        const view = button.closest('[data-collab-session]')
        const sessionId = view?.dataset?.collabSession || ''
        const session = sessionStore.get(sessionId)
        if (!session) return
        const agents = getSessionAgents(session)
        if (agents.length <= 1) return
        const visibleIndexes = getVisiblePaneIndexes(session, agents)
        const action = button.dataset.collabPaneToggle || 'expand'
        if (action === 'expand') {
          setVisiblePaneIndexes(session, agents.map((_, index) => index))
        } else {
          const index = Number(button.dataset.collabAgentIndex)
          const next = visibleIndexes.filter(item => item !== index)
          setVisiblePaneIndexes(session, next.length ? next : visibleIndexes.filter(item => item !== visibleIndexes[0]))
        }
        applySessionPaneVisibility(session, view)
      })
    })
  }

  function bindCollabInteractions(root = document) {
    bindPlanToggles(root)
    bindStopActions(root)
    bindReportActions(root)
    bindPaneVisibilityActions(root)
    bindChatPanes(root)
    ensureElapsedTimer()
  }

  function ensureReportModal() {
    let modal = document.getElementById('agentCollabReportModal')
    if (modal) return modal
    modal = document.createElement('div')
    modal.id = 'agentCollabReportModal'
    modal.className = 'agent-collab-report-modal'
    document.body.appendChild(modal)
    return modal
  }

  function ensureHandoffPrompt() {
    let prompt = document.getElementById('agentCollabHandoffPrompt')
    if (prompt) return prompt
    prompt = document.createElement('div')
    prompt.id = 'agentCollabHandoffPrompt'
    prompt.className = 'agent-collab-handoff'
    document.body.appendChild(prompt)
    return prompt
  }

  function buildHandoffLogoSvg() {
    return [
      '<img class="agent-collab-handoff-logo" src="assets/brand/lingxi-logo-transparent.png" alt="灵犀 LingXiCode">'
    ].join('')
  }

  function getSessionUserMessage(session = {}) {
    return String(session.userMessage || session.originalUserMessage || session.originalRequest || '').trim()
  }

  function buildReportDisplayTitle(session = {}, count = 0) {
    const source = getSessionUserMessage(session)
    const clipped = source.length > 48 ? source.slice(0, 48) + '...' : source
    return clipped
      ? `${clipped} 的汇报结果（${count || 0} 份）`
      : `右侧协作 AI 汇报结果（${count || 0} 份）`
  }

  function buildCleanProjectReportContext(projectId = '', session = {}) {
    const readReports = window.api?.readAgentCollaborationReports?.(projectId)
    if (!readReports || typeof readReports.then !== 'function') {
      return Promise.resolve({ success: false, error: '协作 AI 汇报读取接口不可用' })
    }
    return readReports.then(result => {
      if (!result?.success || !Array.isArray(result.reports) || result.reports.length === 0) {
        return { success: false, error: result?.error || '没有可发送的右侧协作 AI 汇报内容' }
      }
      const userMessage = getSessionUserMessage(session)
      const content = [
        '【右侧协作 AI 临时汇报】',
        userMessage ? `用户原始需求：${userMessage}` : '',
        '以下内容来自右侧协作 AI 已完成的临时汇报文件。请先阅读并理解这些汇报，再结合当前用户需求判断是否需要复核、总结、接手或继续执行。不要声称这些内容是你自己刚刚完成的操作；它们是后台协作 AI 的汇报。',
        '',
        ...result.reports.map((report, index) => [
          `## 汇报 ${index + 1}: ${report.fileName}`,
          report.content
        ].join('\n\n'))
      ].filter(Boolean).join('\n')
      return { success: true, content, count: result.reports.length, displayTitle: buildReportDisplayTitle(session, result.reports.length) }
    })
  }

  async function showCleanHandoffPrompt(session = {}, handlers = {}) {
    if (!session?.id || promptedSessions.has(session.id)) return
    if (!isSessionComplete(session) || getSessionReportCount(session) <= 0) return
    promptedSessions.add(session.id)

    // 协作 AI 的汇报统一自动交给主窗口 AI，不再询问用户是否转交。
    const isTemp = session.temporaryExecution || session.executionKind === 'temporary_chat'
    const context = await buildCleanProjectReportContext(session.projectId, session)
    if (!context.success) {
      handlers.showToast?.(context.error || (isTemp ? '临时 AI 汇报读取失败' : '右侧协作 AI 汇报读取失败'), 'error')
      return
    }

    const sent = await handlers.sendReportToMainAi?.(session.projectId, context.content, {
      sessionId: session.id,
      reportCount: context.count,
      displayTitle: context.displayTitle
    })
    if (sent === false) {
      handlers.showToast?.('协作 AI 汇报转交失败，请稍后查看协作汇报。', 'warning')
      return
    }
    dismissTemporarySessionIcons(session)
  }

  function hideHandoffPrompt(prompt) {
    if (!prompt) return
    prompt.classList.add('closing')
    setTimeout(() => {
      prompt.classList.remove('show', 'closing')
      prompt.innerHTML = ''
    }, 420)
  }

  function dismissTemporarySessionIcons(session = {}) {
    if (!(session?.temporaryExecution || session?.executionKind === 'temporary_chat')) return
    clearTempAgentIcons(session)
  }

  async function showReportModal(filePath = '', fallbackContent = '', title = '协作 AI 汇报') {
    const modal = ensureReportModal()
    modal.innerHTML = `
      <div class="agent-collab-report-dialog">
        <div class="agent-collab-report-head">
          <div>
            <div class="agent-collab-report-title">${escapeHtml(title)}</div>
            <div class="agent-collab-report-path">${escapeHtml(filePath || '临时汇报内容')}</div>
          </div>
          <button class="agent-collab-report-close" type="button" data-report-close>×</button>
        </div>
        <pre class="agent-collab-report-content">正在读取汇报内容...</pre>
      </div>
    `
    modal.classList.add('show')
    modal.querySelector('[data-report-close]')?.addEventListener('click', () => modal.classList.remove('show'))
    modal.addEventListener('click', event => {
      if (event.target === modal) modal.classList.remove('show')
    }, { once: true })

    const contentEl = modal.querySelector('.agent-collab-report-content')
    try {
      const result = filePath ? await window.api?.readAgentCollaborationReport?.(filePath) : null
      const content = result?.success ? result.content : (fallbackContent || result?.error || '汇报内容不存在或已清理。')
      if (contentEl) contentEl.textContent = content
    } catch (error) {
      if (contentEl) contentEl.textContent = fallbackContent || error?.message || '读取汇报失败。'
    }
  }

  function bindReportActions(root = document) {
    root.querySelectorAll('[data-collab-report-file]').forEach(btn => {
      if (btn.dataset.bound === '1') return
      btn.dataset.bound = '1'
      btn.addEventListener('click', event => {
        event.preventDefault()
        event.stopPropagation()
        showReportModal(btn.dataset.reportPath || '', btn.dataset.reportContent || '', btn.dataset.reportTitle || '协作 AI 汇报')
      })
    })
  }

  function refreshElapsedTimers(root = document) {
    root.querySelectorAll('[data-ai-session-start]').forEach(el => {
      const start = Number(el.dataset.aiSessionStart || 0)
      if (!start || el.dataset.done === '1') return
      el.textContent = `已用时${formatElapsed(Date.now() - start)}`
    })
  }

  function ensureElapsedTimer() {
    if (elapsedTimer) return
    elapsedTimer = setInterval(() => refreshElapsedTimers(document), 1000)
  }

  function hydrateSessionView(session = {}, root = document) {
    const isTemporaryExecution = session.temporaryExecution || session.executionKind === 'temporary_chat'
    const agents = (Array.isArray(session.agents) ? session.agents : []).slice(0, isTemporaryExecution ? MAX_TEMP_AGENTS : MAX_CHILD_AGENTS)
    agents.forEach(agent => hydrateAgentMessage(session, agent, root))
  }

  function hydrateAgentMessage(session = {}, agent = {}, root = document) {
    const msg = root.querySelector(`[data-ai-session-id="${escapeCssIdent(agent.id || '')}"]`)
    if (!msg) return

    const done = isDone(agent.status)
    msg.classList.toggle('thinking', !done)
    const titleEl = msg.querySelector('.work-detail-title')
    if (titleEl) titleEl.textContent = done ? '已思考完成' : '正在思考中'
    const dotsEl = msg.querySelector('.work-detail-dots')
    if (dotsEl) dotsEl.classList.toggle('thinking', !done)
    const timerEl = msg.querySelector('.work-detail-timer')
    if (timerEl) {
      timerEl.dataset.done = done ? '1' : '0'
      timerEl.textContent = `已用时${formatElapsed(getAgentElapsedMs(agent, session))}`
    }
    msg.dataset.collabStatus = agent.status || 'waiting'
    const statusEl = msg.querySelector('[data-agent-status-label]')
    if (statusEl) statusEl.textContent = getStatusLabel(agent.status)

    const dynamicArea = msg.querySelector('.ai-dynamic-area')
    const contentEl = msg.querySelector('.ai-content')
    if (contentEl) {
      contentEl.innerHTML = ''
      contentEl.hidden = true
    }
    if (!dynamicArea || !window.AiMessageUI || !window.AiToolRenderer) return

    const reportMeta = getReportMeta(agent)
    const signature = JSON.stringify({
      status: agent.status || '',
      statusText: agent.statusText || '',
      contentLength: String(agent.content || '').length,
      reportFileName: reportMeta.fileName,
      reportFilePath: reportMeta.filePath,
      task: agent.task || '',
      plan: normalizeSteps(agent.plan || session.plan || []).map(item => [
        item.title || '',
        item.detail || '',
        item.status || ''
      ].join('|')),
      thinking: (agent.thinking || agent.thoughts || []).filter(item => !isPlaceholderThinkingEvent(item)).map(item => [
        item.id || '',
        item.type || '',
        item.status || '',
        item.createdAt || '',
        getThinkingDisplayText(item, agent)
      ].join('|')),
      tools: (agent.tools || agent.toolCalls || []).map(item => [
        item.id || '',
        item.toolCallId || '',
        item.status || '',
        item.createdAt || '',
        item.title || item.name || '',
        item.content || ''
      ].join('|'))
    })
    if (msg.dataset.collabSignature === signature) return
    msg.dataset.collabSignature = signature

    dynamicArea.innerHTML = ''
    dynamicArea.innerHTML = renderAgentSummary(agent, session)
    bindReportActions(dynamicArea)
  }

  function mergeAgentEvents(previousAgent = {}, nextAgent = {}, bucket = 'thinking') {
    const merged = []
    const seen = new Set()
    ;[...(previousAgent[bucket] || []), ...(nextAgent[bucket] || [])].forEach(item => {
      if (!item) return
      const key = item.id || item.toolCallId || [item.type, item.title, item.name, item.content, item.createdAt].join('|')
      if (seen.has(key)) return
      seen.add(key)
      merged.push(item)
    })
    return merged.sort((a, b) => Number(a.createdAt || 0) - Number(b.createdAt || 0))
  }

  function mergeSessionSnapshot(previous = null, incoming = {}) {
    if (!previous || previous.id !== incoming.id) return incoming
    const previousAgents = new Map((previous.agents || []).map(agent => [String(agent.id || ''), agent]))
    const agents = (incoming.agents || []).map(agent => {
      const oldAgent = previousAgents.get(String(agent.id || ''))
      if (!oldAgent) return agent
      return {
        ...oldAgent,
        ...agent,
        thinking: mergeAgentEvents(oldAgent, agent, 'thinking'),
        tools: mergeAgentEvents(oldAgent, agent, 'tools')
      }
    })
    return {
      ...previous,
      ...incoming,
      workflowExecution: incoming.workflowExecution || previous.workflowExecution,
      executionKind: incoming.executionKind || previous.executionKind,
      workflow: incoming.workflow || previous.workflow || null,
      agents
    }
  }

  function renderSessionIntoDom(session = {}) {
    if (!session.id) return
    const mergedSession = mergeSessionSnapshot(sessionStore.get(session.id), session)
    ;(mergedSession.agents || []).forEach(agent => sessionJanitor?.trimAgentEvents?.(agent))
    sessionStore.set(mergedSession.id, mergedSession)
    sessionJanitor?.track?.(mergedSession)
    syncCanvasCollaborationSession(mergedSession)
    const view = document.querySelector(`[data-collab-session="${mergedSession.id}"]`)
    if (!view) return
    updateSessionChrome(mergedSession, view)
    hydrateSessionView(mergedSession, view)
    bindCollabInteractions(view)
  }
  function syncCanvasCollaborationSession(session = {}) {
    if (!session?.id) return
    const activeProjectId = getActiveProjectIdProvider()
    if (activeProjectId && session.projectId && session.projectId !== activeProjectId) return
    if (window.CanvasView && typeof window.CanvasView.updateSession === 'function') {
      window.CanvasView.updateSession(session)
    }
  }

  function updateSessionChrome(session = {}, view = document) {
    const agents = getSessionAgents(session)
    const isTemporaryExecution = session.temporaryExecution || session.executionKind === 'temporary_chat'
    const visibleIndexes = isTemporaryExecution ? agents.map((_, index) => index) : getVisiblePaneIndexes(session, agents)
    const activeCount = agents.filter(agent => isRunning(agent.status)).length
    const errorCount = agents.filter(agent => ['error', 'failed', 'timeout'].includes(String(agent.status || ''))).length
    const subtitle = view.querySelector('[data-collab-subtitle]')
    if (subtitle) subtitle.textContent = `${session.mode || 'serial'} · ${session.status || 'running'} · 最多 ${isTemporaryExecution ? MAX_TEMP_AGENTS : MAX_CHILD_AGENTS} 个工作会话`
    const count = view.querySelector('[data-collab-count]')
    if (count) count.textContent = `${visibleIndexes.length}/${agents.length} 个会话`
    const active = view.querySelector('[data-collab-active]')
    if (active) active.textContent = `${activeCount} 个执行中`
    const error = view.querySelector('[data-collab-errors]')
    if (error) {
      error.textContent = `${errorCount} 个出错`
      error.hidden = errorCount <= 0
    }
    agents.forEach(agent => {
      const panel = view.querySelector(`[data-ai-session-id="${escapeCssIdent(agent.id || '')}"]`)
      if (panel) panel.dataset.collabStatus = agent.status || 'waiting'
      const status = panel?.querySelector('[data-agent-status-label]')
      if (status) status.textContent = getStatusLabel(agent.status)
    })
    if (!isTemporaryExecution) applySessionPaneVisibility(session, view)
  }

  function stopSessionPolling(sessionId) {
    const timer = pollers.get(sessionId)
    if (timer) clearInterval(timer)
    pollers.delete(sessionId)
  }

  function ensureSessionPolling(session = {}) {
    if (!session?.id || pollers.has(session.id)) return
    const timer = setInterval(async () => {
      const current = sessionStore.get(session.id) || session
      if (isDone(current.status) || current.status === 'single_agent') {
        stopSessionPolling(session.id)
        return
      }
      const activeProjectId = getActiveProjectIdProvider()
      if (activeProjectId && current.projectId && current.projectId !== activeProjectId) {
        stopSessionPolling(session.id)
        return
      }
      try {
        const result = await window.api?.getAgentCollaboration?.(current.projectId, session.id)
        if (result?.session) renderSessionIntoDom(result.session)
      } catch (error) {
        console.warn('[AgentCollaborationUI] poll failed:', error)
      }
    }, 1500)
    pollers.set(session.id, timer)
  }

  function appendSessionEvent(projectId, event = {}) {
    const session = findActiveSession(projectId)
    if (!session) return false
    const agents = Array.isArray(session.agents) ? session.agents : []
    if (!agents.length) return false
    const preferred = String(event.agentRole || event.agentTitle || event.agentId || '').trim().toLowerCase()
    const agent = (preferred && agents.find(item => {
      const values = [item.id, item.role, item.name, item.title].map(value => String(value || '').toLowerCase())
      return values.some(value => value && (value === preferred || value.includes(preferred) || preferred.includes(value)))
    })) || agents.find(item => isRunning(item.status)) || agents[0]

    const nextEvent = {
      id: `${event.type || 'event'}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      type: event.type || 'status',
      title: event.title || event.name || '状态更新',
      name: event.name || event.title || '',
      content: event.content || event.message || '',
      args: event.args && typeof event.args === 'object' ? event.args : null,
      result: event.result && typeof event.result === 'object' ? event.result : null,
      toolCallId: event.toolCallId || '',
      status: event.status || '',
      createdAt: Date.now()
    }
    if (event.type === 'tool') agent.tools = [...(agent.tools || []), nextEvent]
    else {
      if (!shouldDisplayThinkingEventText(nextEvent.content || nextEvent.title)) return true
      agent.thinking = [...(agent.thinking || []), nextEvent]
    }
    sessionJanitor?.trimAgentEvents?.(agent)
    agent.statusText = nextEvent.content || nextEvent.title
    session.updatedAt = Date.now()
    renderSessionIntoDom(session)
    return true
  }

  function renderFallbackEvents(agent = {}) {
    return renderAgentSummary(agent)
  }

  function getAgentChatProjectId(agent = {}) {
    return agent.chatProjectId || agent.chat_project_id || ''
  }

  function getSessionAgents(session = {}) {
    const limit = session.temporaryExecution || session.executionKind === 'temporary_chat' ? MAX_TEMP_AGENTS : MAX_CHILD_AGENTS
    return (Array.isArray(session.agents) ? session.agents : [])
      .slice(0, limit)
      .filter(agent => agent.modelName || agent.task || agent.name || agent.role || agent.id)
  }

  function getVisiblePaneIndexes(session = {}, agents = getSessionAgents(session)) {
    if (!agents.length) return []
    const sessionId = String(session.id || '')
    const saved = sessionId ? sessionPaneVisibility.get(sessionId) : null
    const raw = Array.isArray(saved) && saved.length ? saved : [0]
    const normalized = [...new Set(raw
      .map(index => Number(index))
      .filter(index => Number.isInteger(index) && index >= 0 && index < agents.length))]
      .slice(0, MAX_CHILD_AGENTS)
    const visible = normalized.length ? normalized : [0]
    if (sessionId) sessionPaneVisibility.set(sessionId, visible)
    return visible
  }

  function setVisiblePaneIndexes(session = {}, indexes = []) {
    const agents = getSessionAgents(session)
    if (!agents.length) {
      sessionPaneVisibility.set(String(session.id || ''), [])
      return []
    }
    const visible = getVisiblePaneIndexes({ ...session, id: '' }, agents)
    const next = [...new Set((Array.isArray(indexes) ? indexes : visible)
      .map(index => Number(index))
      .filter(index => Number.isInteger(index) && index >= 0 && index < agents.length))]
      .slice(0, MAX_CHILD_AGENTS)
    sessionPaneVisibility.set(String(session.id || ''), next.length ? next : [0])
    return sessionPaneVisibility.get(String(session.id || '')) || [0]
  }

  function getAgentInitialModel(agent = {}) {
    return agent.modelConfig || findModelByKey(agent.modelKey) || getActiveModelProvider() || null
  }

  function buildExecModeMenuHtml(selected = 'ask') {
    const modes = [
      {
        value: 'ask',
        name: '询问授权',
        desc: '不在授权列表中的路径和应用会弹窗询问',
        icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="M9 12l2 2 4-4"/></svg>'
      },
      {
        value: 'full',
        name: '完整授权',
        desc: '完全控制本地电脑（高风险）',
        icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 9.9-1"/></svg>'
      }
    ]
    return modes.map(mode => `
      <div class="exec-mode-option ${mode.value === selected ? 'selected' : ''}" data-collab-exec-mode="${escapeHtml(mode.value)}">
        <span class="option-icon">${mode.icon}</span>
        <span class="option-info">
          <span class="option-name">${escapeHtml(mode.name)}</span>
          <span class="option-desc">${escapeHtml(mode.desc)}</span>
        </span>
      </div>
    `).join('')
  }

  function buildModelMenuHtml(selectedKey = '') {
    const models = getConfiguredModels()
    if (!models.length) return '<div class="model-option disabled">暂无可用模型</div>'
    return `<div class="model-menu-list">
      ${models.map((model, index) => {
        const key = getModelKey(model)
        const name = getModelDisplayName(model, index)
        return `
          <div class="model-option ${String(key) === String(selectedKey) ? 'selected' : ''}" data-collab-model-key="${escapeHtml(key)}">
            <span class="model-option-name">${escapeHtml(name)}</span>
          </div>
        `
      }).join('')}
    </div>`
  }

  function buildSkillMenuHtml(selectedName = '') {
    const skills = getConfiguredSkills()
    return `
      <input class="skill-menu-search" type="text" placeholder="搜索..." data-collab-skill-search>
      <div class="skill-menu-list" data-collab-skill-list>
        <div class="skill-menu-item ${!selectedName ? 'selected' : ''}" data-collab-skill-name="">
          <span class="skill-menu-item-none">无技能</span>
        </div>
        ${skills.map(skill => `
          <div class="skill-menu-item ${selectedName === skill.name ? 'selected' : ''}" data-collab-skill-name="${escapeHtml(skill.name)}">
            <span class="skill-menu-item-name">${escapeHtml(skill.title || skill.name)}</span>
          </div>
        `).join('')}
      </div>
    `
  }

  function getAgentTaskDescription(agent = {}, index = 0, displayName = '') {
    const genericPattern = /^(ai|a|agent|assistant|协作会话)\s*[\d一二三四五六七八九十]*$/i
    const taskRaw = String(agent.task || '').trim()
    const roleRaw = String(agent.role || '').trim()
    const nameRaw = String(agent.name || '').trim()
    // 找出有意义的任务描述（排除与名称重复的泛化文本）
    const task = taskRaw && !genericPattern.test(taskRaw) && taskRaw !== displayName ? taskRaw : ''
    const role = roleRaw && !genericPattern.test(roleRaw) && roleRaw !== displayName ? roleRaw : ''
    const focus = Array.isArray(agent.focusPaths) ? agent.focusPaths.filter(Boolean).slice(0, 3) : []
    const parts = []
    if (task) parts.push(task)
    if (role && role !== task) parts.push(role)
    if (focus.length) parts.push('关注: ' + focus.join(', '))
    return parts.join(' · ') || (nameRaw && !genericPattern.test(nameRaw) ? nameRaw : '')
  }

  function getPaneToggleIcon(action = 'expand') {
    if (action === 'collapse') {
      return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14"/></svg>'
    }
    return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14"/><path d="M5 12h14"/></svg>'
  }

  function getStopIcon() {
    return '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="7" y="7" width="10" height="10" rx="1.5"/></svg>'
  }

  function buildChatPaneHtml(session = {}, agent = {}, index = 0, visibility = {}) {
    const isTemporaryExecution = session.temporaryExecution || session.executionKind === 'temporary_chat'
    const chatProjectId = getAgentChatProjectId(agent)
    const displayName = getAgentDisplayName(agent, index)
    const initialModel = getAgentInitialModel(agent)
    const modelKey = getModelKey(initialModel) || agent.modelKey || ''
    const modelLabel = initialModel ? getModelDisplayName(initialModel) : getAgentModelLabel(agent)
    const execMode = agent.execMode || session.execMode || 'ask'
    const execModeLabel = execMode === 'full' ? '完整授权' : '询问授权'
    const selectedSkillName = agent.skillName || ''
    const taskDescription = getAgentTaskDescription(agent, index, displayName)
    const visibleCount = Number(visibility.visibleCount || 1)
    const totalCount = Number(visibility.totalCount || 1)
    const isVisible = visibility.visible !== false
    const toggleAction = visibleCount < totalCount ? 'expand' : 'collapse'
    const toggleTitle = toggleAction === 'expand' ? '展开第二个会话窗口' : '收起当前会话窗口'
    const canStop = isRunning(agent.status)
    return `
      <section class="agent-collab-chat-clone ${isTemporaryExecution ? 'agent-collab-temp-chat' : ''} ${isVisible ? '' : 'agent-collab-chat-hidden'}" data-collab-agent-index="${index}" data-collab-chat-project-id="${escapeHtml(chatProjectId)}" data-collab-agent-id="${escapeHtml(agent.id || '')}" aria-hidden="${isVisible ? 'false' : 'true'}">
        <div class="agent-collab-chat-titlebar">
          ${isTemporaryExecution ? `<button class="agent-collab-stop-agent-inline" type="button" data-collab-stop-agent data-project-id="${escapeHtml(session.projectId || '')}" data-session-id="${escapeHtml(session.id || '')}" data-agent-id="${escapeHtml(agent.id || '')}" data-chat-project-id="${escapeHtml(chatProjectId)}" title="停止此临时 AI" aria-label="停止此临时 AI" ${canStop ? '' : 'disabled'}>${getStopIcon()}</button>` : ''}
          <div class="agent-collab-chat-name">
            <strong>${escapeHtml(displayName)}</strong>
            <span data-collab-chat-model-label>${escapeHtml(modelLabel || '选择模型')}</span>
          </div>
          <div class="agent-collab-chat-actions">
            ${!isTemporaryExecution && totalCount > 1 ? `<button class="agent-collab-pane-toggle" type="button" data-collab-pane-toggle="${toggleAction}" data-collab-agent-index="${index}" title="${escapeHtml(toggleTitle)}" aria-label="${escapeHtml(toggleTitle)}">${getPaneToggleIcon(toggleAction)}</button>` : ''}
            <span class="agent-collab-chat-status" data-collab-chat-status>${escapeHtml(getStatusLabel(agent.status))}</span>
          </div>
        </div>
        ${taskDescription ? `<div class="agent-collab-chat-task">${escapeHtml(taskDescription)}</div>` : ''}
        <div class="agent-collab-chat-main">
          <div class="chat-messages agent-collab-chat-messages" data-collab-chat-messages></div>
          ${isTemporaryExecution ? '' : `
          <div class="chat-input-area agent-collab-chat-input-area">
            <div class="chat-input-wrapper agent-collab-chat-input-wrapper">
              <div class="uploaded-files-area agent-collab-uploaded-files" data-collab-uploaded-files></div>
              <div class="chat-input-row">
                <textarea class="chat-input-box agent-collab-chat-input" rows="1" placeholder="与 ${escapeHtml(displayName)} 对话..." data-collab-chat-input></textarea>
                <button class="send-btn agent-collab-chat-send" type="button" title="发送/中断" data-collab-chat-send>
                  <span class="send-icon"><svg viewBox="0 0 24 24"><polyline points="12 19 12 5"/><polyline points="5 12 12 5 19 12"/></svg></span>
                </button>
              </div>
              <div class="chat-input-footer agent-collab-chat-footer">
                <label class="file-upload-btn agent-collab-file-upload" title="上传文件">
                  <span class="upload-icon">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>
                  </span>
                  <input type="file" multiple accept="image/*,.svg,.ico,.txt,.md,.json,.js,.ts,.tsx,.jsx,.html,.css,.csv,.xml,.yaml,.yml,.log,.pdf,.doc,.docx,.xls,.xlsx" hidden data-collab-file-input>
                </label>
                <div class="exec-mode-dropdown" data-collab-exec-dropdown>
                  <div class="exec-mode-trigger" data-collab-exec-trigger>
                    <span class="exec-mode-icon" data-collab-exec-icon">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="M9 12l2 2 4-4"/></svg>
                    </span>
                    <span class="exec-mode-current" data-collab-exec-current>${escapeHtml(execModeLabel)}</span>
                    <span class="exec-mode-arrow"><svg viewBox="0 0 24 24"><polyline points="6 9 12 15 18 9"/></svg></span>
                  </div>
                  <div class="exec-mode-menu" data-collab-exec-menu>${buildExecModeMenuHtml(execMode)}</div>
                </div>
                <div class="model-dropdown" data-collab-model-dropdown>
                  <div class="model-dropdown-trigger" data-collab-model-trigger>
                    <span class="model-current" data-collab-model-current>${escapeHtml(modelLabel || '选择模型')}</span>
                    <span class="model-arrow"><svg viewBox="0 0 24 24"><polyline points="6 9 12 15 18 9"/></svg></span>
                  </div>
                  <div class="model-dropdown-menu" data-collab-model-menu data-selected-model-key="${escapeHtml(modelKey)}">${buildModelMenuHtml(modelKey)}</div>
                </div>
                <div class="skill-selector" data-collab-skill-selector>
                  <div class="skill-select-btn ${selectedSkillName ? 'active' : ''}" data-collab-skill-trigger>
                    <span class="skill-current" data-collab-skill-current>${escapeHtml(selectedSkillName || '技能')}</span>
                    <span class="skill-arrow"><svg viewBox="0 0 24 24"><polyline points="6 9 12 15 18 9"/></svg></span>
                  </div>
                  <div class="skill-select-menu" data-collab-skill-menu>${buildSkillMenuHtml(selectedSkillName)}</div>
                </div>
              </div>
            </div>
          </div>
          `}
        </div>
      </section>
    `
  }

  function setMenuOpen(menu, open) {
    if (!menu) return
    menu.classList.toggle('show', !!open)
  }

  function closeSiblingChatMenus(state, exceptMenu = null) {
    state.pane?.querySelectorAll('[data-collab-model-menu], [data-collab-exec-menu], [data-collab-skill-menu]').forEach(menu => {
      if (menu !== exceptMenu) menu.classList.remove('show')
    })
  }

  function refreshRuntimeModelLabel(state) {
    const label = state.modelConfig ? getModelDisplayName(state.modelConfig) : '选择模型'
    if (state.modelCurrentEl) state.modelCurrentEl.textContent = label
    if (state.modelLabelEl) state.modelLabelEl.textContent = label
    state.agent.modelConfig = state.modelConfig || null
    state.agent.modelName = state.modelConfig?.modelName || state.modelConfig?.displayName || state.modelConfig?.modelId || label
  }

  function renderRuntimeFiles(state) {
    if (!state.filesEl) return
    if (!state.uploadedFiles.length) {
      state.filesEl.classList.remove('show')
      state.filesEl.innerHTML = ''
      return
    }
    state.filesEl.classList.add('show')
    state.filesEl.innerHTML = state.uploadedFiles.map((file, index) => `
      <div class="agent-collab-file-chip" title="${escapeHtml(file.path || file.name || '')}">
        <span>${escapeHtml(file.name || file.path || `文件 ${index + 1}`)}</span>
        <button type="button" data-collab-remove-file="${index}">×</button>
      </div>
    `).join('')
    state.filesEl.querySelectorAll('[data-collab-remove-file]').forEach(button => {
      button.addEventListener('click', event => {
        event.preventDefault()
        const index = Number(button.dataset.collabRemoveFile)
        state.uploadedFiles.splice(index, 1)
        renderRuntimeFiles(state)
      })
    })
  }

  function filterSkillMenu(menu, keyword = '') {
    const text = String(keyword || '').trim().toLowerCase()
    menu?.querySelectorAll('[data-collab-skill-name]').forEach(item => {
      const name = String(item.dataset.collabSkillName || '').toLowerCase()
      const label = String(item.textContent || '').toLowerCase()
      item.style.display = !text || !name || name.includes(text) || label.includes(text) ? '' : 'none'
    })
  }

  function bindChatRuntimeControls(state) {
    const modelTrigger = state.pane?.querySelector('[data-collab-model-trigger]')
    const modelMenu = state.pane?.querySelector('[data-collab-model-menu]')
    const execTrigger = state.pane?.querySelector('[data-collab-exec-trigger]')
    const execMenu = state.pane?.querySelector('[data-collab-exec-menu]')
    const skillTrigger = state.pane?.querySelector('[data-collab-skill-trigger]')
    const skillMenu = state.pane?.querySelector('[data-collab-skill-menu]')
    const fileInput = state.pane?.querySelector('[data-collab-file-input]')

    refreshRuntimeModelLabel(state)
    if (!chatMenuDocumentClickBound) {
      chatMenuDocumentClickBound = true
      document.addEventListener('click', event => {
        if (event.target.closest('.agent-collab-chat-footer')) return
        document.querySelectorAll('[data-collab-model-menu], [data-collab-exec-menu], [data-collab-skill-menu]').forEach(menu => {
          menu.classList.remove('show')
        })
      })
    }

    modelTrigger?.addEventListener('click', event => {
      event.stopPropagation()
      modelMenu.innerHTML = buildModelMenuHtml(getModelKey(state.modelConfig))
      closeSiblingChatMenus(state, modelMenu)
      setMenuOpen(modelMenu, !modelMenu.classList.contains('show'))
    })

    modelMenu?.addEventListener('click', event => {
      const option = event.target.closest('[data-collab-model-key]')
      if (!option) return
      const model = findModelByKey(option.dataset.collabModelKey || '')
      if (!model) return
      state.modelConfig = model
      state.agent.modelConfig = model
      state.agent.modelKey = getModelKey(model)
      state.agent.modelName = model?.modelName || model?.displayName || ''
      refreshRuntimeModelLabel(state)
      modelMenu.querySelectorAll('.model-option').forEach(item => item.classList.remove('selected'))
      option.classList.add('selected')
      modelMenu.classList.remove('show')
    })

    execTrigger?.addEventListener('click', event => {
      event.stopPropagation()
      closeSiblingChatMenus(state, execMenu)
      setMenuOpen(execMenu, !execMenu.classList.contains('show'))
    })

    execMenu?.addEventListener('click', event => {
      const option = event.target.closest('[data-collab-exec-mode]')
      if (!option) return
      const value = option.dataset.collabExecMode || 'ask'
      state.executionMode = value
      state.agent.execMode = value
      // 同步到后端 path-permissions（持久化 + 设置页同步）
      window.api?.setPathPermissionMode?.(value).catch(() => {})
      if (state.execCurrentEl) state.execCurrentEl.textContent = option.querySelector('.option-name')?.textContent || '询问授权'
      execMenu.querySelectorAll('.exec-mode-option').forEach(item => item.classList.remove('selected'))
      option.classList.add('selected')
      execMenu.classList.remove('show')
    })

    skillTrigger?.addEventListener('click', event => {
      event.stopPropagation()
      skillMenu.innerHTML = buildSkillMenuHtml(state.skillName)
      closeSiblingChatMenus(state, skillMenu)
      setMenuOpen(skillMenu, !skillMenu.classList.contains('show'))
    })

    skillMenu?.addEventListener('input', event => {
      if (event.target.matches('[data-collab-skill-search]')) filterSkillMenu(skillMenu, event.target.value)
    })

    skillMenu?.addEventListener('click', event => {
      const option = event.target.closest('[data-collab-skill-name]')
      if (!option) return
      const skillName = option.dataset.collabSkillName || ''
      const skill = skillName ? getConfiguredSkills().find(item => item.name === skillName) : null
      state.skillName = skillName
      state.skillContent = skill?.content || null
      state.agent.skillName = skillName
      state.agent.skillContent = state.skillContent
      if (state.skillCurrentEl) state.skillCurrentEl.textContent = skill ? (skill.title || skill.name) : '技能'
      skillTrigger?.classList.toggle('active', !!skillName)
      skillMenu.querySelectorAll('.skill-menu-item').forEach(item => item.classList.remove('selected'))
      option.classList.add('selected')
      skillMenu.classList.remove('show')
      // 同步到 session store 保持一致性
      const stored = sessionStore.get(state.sessionId)
      if (stored?.agents) {
        const storedAgent = stored.agents.find(a => a.id === state.agentId)
        if (storedAgent) { storedAgent.skillName = skillName; storedAgent.skillContent = state.skillContent }
      }
    })

    fileInput?.addEventListener('change', () => {
      const files = Array.from(fileInput.files || []).map(file => ({
        name: file.name,
        path: file.path || '',
        type: file.type || '',
        size: file.size || 0
      }))
      state.uploadedFiles.push(...files)
      fileInput.value = ''
      renderRuntimeFiles(state)
    })
  }

  function bindRuntimeSendHandlers(state) {
    if (!state) return
    if (state.sendEl && state.sendEl.dataset.collabSendBound !== '1') {
      state.sendEl.dataset.collabSendBound = '1'
      state.sendEl.addEventListener('click', () => {
        if (state.running) interruptChatRuntime(state)
        else sendChatRuntimeMessage(state, state.inputEl?.value || '')
      })
    }
    if (state.inputEl && state.inputEl.dataset.collabInputBound !== '1') {
      state.inputEl.dataset.collabInputBound = '1'
      state.inputEl.addEventListener('keydown', event => {
        if (event.key === 'Enter' && !event.shiftKey) {
          event.preventDefault()
          if (!state.running) sendChatRuntimeMessage(state, state.inputEl.value || '')
        }
      })
    }
  }

  function syncRuntimeAgentToSession(state, patch = {}, report = null) {
    if (!state?.parentProjectId || !state.sessionId || !state.agentId) return
    const payload = {
      agentPatch: {
        agentId: state.agentId,
        ...patch
      }
    }
    if (report) payload.report = report
    window.api?.updateAgentCollaboration?.(state.parentProjectId, state.sessionId, payload)
      ?.catch?.(error => console.warn('[AgentCollaborationUI] sync runtime agent failed:', error))
  }

  function toRuntimeHistory(messagesHistory = []) {
    return (Array.isArray(messagesHistory) ? messagesHistory : [])
      .filter(message => message && (message.role === 'user' || message.role === 'assistant'))
      .map(message => ({
        role: message.role,
        content: String(message.content || message.displayContent || '')
      }))
      .filter(message => message.content)
  }

  async function restoreChatRuntimeHistory(state) {
    if (!state?.projectId || !state.renderer || !state.messagesEl) return
    if (state.historyRestoring) return

    const hasRenderedMessages = state.messagesEl.childNodes.length > 0
    if (state.historyRestored) {
      if (!hasRenderedMessages && state.restoredMessagesHistory?.length) {
        state.renderer.restoreChatHistory?.(state.restoredMessagesHistory, { projectPath: state.projectPath || '' })
        try { window.ChatStickyBottom?.forceStick?.(state.messagesEl) } catch (_) { state.messagesEl.scrollTop = state.messagesEl.scrollHeight }
      }
      return
    }

    state.historyRestoring = true
    try {
      const result = await window.api?.getChatHistory?.(state.projectId)
      if (result?.success === false) throw new Error(result.error || 'chat history unavailable')
      const messagesHistory = Array.isArray(result?.messagesHistory) ? result.messagesHistory : []
      state.restoredMessagesHistory = messagesHistory
      state.history = toRuntimeHistory(messagesHistory)
      state.historyRestored = true
      if (!state.messagesEl.childNodes.length && messagesHistory.length) {
        state.renderer.restoreChatHistory?.(messagesHistory, { projectPath: state.projectPath || '' })
        state.messagesEl.scrollTop = state.messagesEl.scrollHeight
      }
    } catch (error) {
      console.warn('[AgentCollaborationUI] restore chat history failed:', error)
    } finally {
      state.historyRestoring = false
    }
  }

  function attachChatRuntimeToPane(state, session = {}, agent = {}, pane) {
    if (!state || !pane) return state
    const previousMessagesEl = state.messagesEl
    const messagesEl = pane.querySelector('[data-collab-chat-messages]')
    if (previousMessagesEl && messagesEl && previousMessagesEl !== messagesEl && previousMessagesEl.childNodes.length && !messagesEl.childNodes.length) {
      while (previousMessagesEl.firstChild) messagesEl.appendChild(previousMessagesEl.firstChild)
    }

    state.parentProjectId = session.projectId || state.parentProjectId || ''
    state.sessionId = session.id || state.sessionId || ''
    state.projectPath = session.projectPath || state.projectPath || ''
    state.temporaryExecution = state.temporaryExecution || session.temporaryExecution || session.executionKind === 'temporary_chat'
    state.reportFilePath = agent.reportFilePath || state.reportFilePath || ''
    state.reportFileName = agent.reportFileName || state.reportFileName || ''
    state.agentId = agent.id || state.agentId || ''
    state.agent = agent || state.agent || {}
    state.pane = pane
    state.messagesEl = messagesEl
    state.inputEl = pane.querySelector('[data-collab-chat-input]')
    state.sendEl = pane.querySelector('[data-collab-chat-send]')
    state.statusEl = pane.querySelector('[data-collab-chat-status]')
    state.modelCurrentEl = pane.querySelector('[data-collab-model-current]')
    state.modelLabelEl = pane.querySelector('[data-collab-chat-model-label]')
    state.execCurrentEl = pane.querySelector('[data-collab-exec-current]')
    state.skillCurrentEl = pane.querySelector('[data-collab-skill-current]')
    state.filesEl = pane.querySelector('[data-collab-uploaded-files]')
    if (!state.modelConfig) state.modelConfig = getAgentInitialModel(agent)

    const getProjectPath = () => session.projectPath || ''
    state.toolRenderer = window.AiToolRenderer?.bind?.({
      getCurrentAiMsg: () => state.currentAiMsg,
      getCurrentProjectPath: getProjectPath,
      getOpIcons: () => window.AiMessageUI?.opIcons || {},
      getOpTypes: () => window.AiMessageUI?.opTypes || {},
      getFileName: path => window.AiMessageUI?.getFileName?.(path) || path || '',
      calculateEditLines: (oldStr, newStr) => window.AiMessageUI?.calculateEditLines?.(oldStr, newStr) || { add: 0, remove: 0 },
      sanitizeContent: content => window.AiMessageUI?.sanitizeAiContent?.(content) || escapeHtml(content)
    })
    state.renderer = window.ChatRenderer?.bind?.({
      getContainer: () => state.messagesEl,
      sanitizeContent: content => window.AiMessageUI?.sanitizeAiContent?.(content) || escapeHtml(content),
      renderAiContent: (content, options = {}) => renderAiContent(content, options),
      generateSummaryHtml: () => '',
      getOpIcons: () => window.AiMessageUI?.opIcons || {},
      getOpTypes: () => window.AiMessageUI?.opTypes || {}
    })
    if (!state.temporaryExecution) {
      window.TextInputUI?.bind?.(state.inputEl, {})?.autoResize?.()
      bindChatRuntimeControls(state)
      bindRuntimeSendHandlers(state)
    }
    setChatRuntimeStatus(state, state.running ? 'running' : (agent.status || 'waiting'))
    if (!state.temporaryExecution) restoreChatRuntimeHistory(state)
    return state
  }

  function createChatRuntime(session = {}, agent = {}, pane) {
    // 优先用独立的 chatProjectId（子级上下文），否则回退到父项目（共享项目路径）
    const projectId = getAgentChatProjectId(agent) || session.projectId || ''
    if (!projectId || !pane) return null
    const existing = chatRuntimes.get(projectId)
    if (existing) return attachChatRuntimeToPane(existing, session, agent, pane)

    const messagesEl = pane.querySelector('[data-collab-chat-messages]')
    const inputEl = pane.querySelector('[data-collab-chat-input]')
    const sendEl = pane.querySelector('[data-collab-chat-send]')
    const statusEl = pane.querySelector('[data-collab-chat-status]')
    const modelCurrentEl = pane.querySelector('[data-collab-model-current]')
    const modelLabelEl = pane.querySelector('[data-collab-chat-model-label]')
    const execCurrentEl = pane.querySelector('[data-collab-exec-current]')
    const skillCurrentEl = pane.querySelector('[data-collab-skill-current]')
    const filesEl = pane.querySelector('[data-collab-uploaded-files]')
    const state = {
      projectId,
      parentProjectId: session.projectId || '',
      projectPath: session.projectPath || '',
      temporaryExecution: session.temporaryExecution || session.executionKind === 'temporary_chat',
      reportFilePath: agent.reportFilePath || '',
      reportFileName: agent.reportFileName || '',
      sessionId: session.id || '',
      agentId: agent.id || '',
      agent,
      pane,
      messagesEl,
      inputEl,
      sendEl,
      statusEl,
      history: [],
      historyRestored: false,
      historyRestoring: false,
      restoredMessagesHistory: [],
      running: false,
      currentAiMsg: null,
      currentThinkingBlock: null,
      toolStats: { modified: [], created: [], read: [], commands: [] },
      modelConfig: getAgentInitialModel(agent),
      executionMode: agent.execMode || session.execMode || 'auto',
      skillName: agent.skillName || '',
      skillContent: agent.skillContent || null,
      uploadedFiles: [],
      modelCurrentEl,
      modelLabelEl,
      execCurrentEl,
      skillCurrentEl,
      filesEl
    }

    const getProjectPath = () => session.projectPath || ''
    state.toolRenderer = window.AiToolRenderer?.bind?.({
      getCurrentAiMsg: () => state.currentAiMsg,
      getCurrentProjectPath: getProjectPath,
      getOpIcons: () => window.AiMessageUI?.opIcons || {},
      getOpTypes: () => window.AiMessageUI?.opTypes || {},
      getFileName: path => window.AiMessageUI?.getFileName?.(path) || path || '',
      calculateEditLines: (oldStr, newStr) => window.AiMessageUI?.calculateEditLines?.(oldStr, newStr) || { add: 0, remove: 0 },
      sanitizeContent: content => window.AiMessageUI?.sanitizeAiContent?.(content) || escapeHtml(content)
    })
    state.renderer = window.ChatRenderer?.bind?.({
      getContainer: () => messagesEl,
      sanitizeContent: content => window.AiMessageUI?.sanitizeAiContent?.(content) || escapeHtml(content),
      renderAiContent: (content, options = {}) => renderAiContent(content, options),
      generateSummaryHtml: () => '',
      getOpIcons: () => window.AiMessageUI?.opIcons || {},
      getOpTypes: () => window.AiMessageUI?.opTypes || {}
    })
    if (!state.temporaryExecution) {
      const textInputBinding = window.TextInputUI?.bind?.(inputEl, {})
      textInputBinding?.autoResize?.()
      bindChatRuntimeControls(state)
      bindRuntimeSendHandlers(state)
    }

    chatRuntimes.set(projectId, state)
    if (!state.temporaryExecution) restoreChatRuntimeHistory(state)
    return state
  }

  function setChatRuntimeStatus(state, status) {
    if (!state) return
    const label = getStatusLabel(status)
    if (state.statusEl) state.statusEl.textContent = label
    state.pane?.setAttribute('data-collab-chat-status-value', status || '')
    state.sendEl?.classList.toggle('active', state.running)
  }

  function ensureRuntimeAiMessage(state) {
    if (!state || state.currentAiMsg && document.contains(state.currentAiMsg)) return state?.currentAiMsg || null
    const modelName = state.modelConfig?.modelName || state.modelConfig?.displayName || state.agent?.modelName || 'AI'
    state.currentAiMsg = window.AiMessageUI?.createAiMessage?.(modelName) || document.createElement('div')
    if (!state.currentAiMsg.classList.contains('message')) {
      state.currentAiMsg.className = 'message ai thinking'
      state.currentAiMsg.innerHTML = `<div class="ai-header">${escapeHtml(modelName)}</div><div class="ai-dynamic-area"></div><div class="ai-content"></div>`
    }
    state.messagesEl?.appendChild(state.currentAiMsg)
    if (state.messagesEl) state.messagesEl.scrollTop = state.messagesEl.scrollHeight
    return state.currentAiMsg
  }

  function finishRuntimeThinking(state, reason = 'done') {
    if (state?.currentThinkingBlock) {
      window.AiMessageUI?.finishThinkingBlock?.(state.currentThinkingBlock, reason)
      state.currentThinkingBlock = null
    }
  }

  async function sendChatRuntimeMessage(state, rawMessage = '', options = {}) {
    const message = String(rawMessage || '').trim()
    if (!state || (!message && !state.uploadedFiles.length) || state.running) return
    if (!state.modelConfig) state.modelConfig = getActiveModelProvider() || getConfiguredModels()[0] || null
    const fileParts = state.uploadedFiles
      .map(file => {
        const path = file.path || ''
        const name = file.name || path || 'file'
        return path ? `【文件】${name}\n路径: ${path}` : `【文件】${name}`
      })
      .join('\n\n')
    const messageForAi = [message, fileParts].filter(Boolean).join('\n\n')
    const displayMessage = options.displayContent || message || state.uploadedFiles.map(file => file.name || file.path).filter(Boolean).join('、')
    state.running = true
    setChatRuntimeStatus(state, 'running')
    syncRuntimeAgentToSession(state, {
      status: 'running',
      statusText: displayMessage,
      startedAt: Date.now()
    })
    if (!options.hideUserMessage && !state.headless) state.renderer?.addUserMessage?.(displayMessage, { scroll: true })
    state.history.push({ role: 'user', content: displayMessage })
    if (state.inputEl && !options.keepInput) state.inputEl.value = ''
    if (!options.keepInput) {
      state.uploadedFiles = []
      renderRuntimeFiles(state)
    }
    if (!state.headless) ensureRuntimeAiMessage(state)
    try {
      await window.api?.sendMessage?.(
        state.projectId,
        messageForAi,
        state.modelConfig,
        state.history,
        state.skillContent || null,
        state.executionMode || 'auto',
        true,
        [],
        displayMessage,
        !!options.hiddenToBackend,
        null,
        []
      )
    } catch (error) {
      handleChatEvent('reply', { projectId: state.projectId, error: error?.message || String(error || ''), done: true })
    }
  }

  function interruptChatRuntime(state) {
    if (!state?.projectId) return
    state.running = false
    window.api?.interruptAi?.(state.projectId)
    finishRuntimeThinking(state, 'interrupted')
    if (state.currentAiMsg) {
      window.AiMessageUI?.updateWorkStatus?.(state.currentAiMsg, 'interrupted')
    }
    setChatRuntimeStatus(state, 'interrupted')
  }

  function maybeAutoStartSessionChats(session = {}, root = document) {
    const agents = Array.isArray(session.agents) ? session.agents : []
    const startable = agents
      .map(agent => {
        const projectId = getAgentChatProjectId(agent) || session.projectId || ''
        return { agent, state: projectId ? chatRuntimes.get(projectId) : null }
      })
      .filter(item => item.state && item.agent.autoStartMessage && !autoStartedChats.has(item.state.projectId))
    if (!startable.length) return
    const isTemporaryExecution = session.temporaryExecution || session.executionKind === 'temporary_chat'
    const starters = (session.mode === 'parallel' || isTemporaryExecution) ? startable : startable.slice(0, 1)
    starters.forEach(({ agent, state }) => {
      autoStartedChats.add(state.projectId)
      sendChatRuntimeMessage(state, agent.autoStartMessage, {
        displayContent: agent.task || agent.autoStartMessage,
        keepInput: true,
        hideUserMessage: !!(session.temporaryExecution || session.executionKind === 'temporary_chat'),
        hiddenToBackend: !!(session.temporaryExecution || session.executionKind === 'temporary_chat')
      })
    })
  }

  function startNextSerialChat(sessionId = '') {
    const session = sessionStore.get(sessionId)
    if (!session || session.mode === 'parallel') return
    const next = (Array.isArray(session.agents) ? session.agents : [])
      .find(agent => {
        const projectId = getAgentChatProjectId(agent) || session.projectId || ''
        return projectId && agent.autoStartMessage && !autoStartedChats.has(projectId)
      })
    const state = next ? chatRuntimes.get(getAgentChatProjectId(next) || session.projectId || '') : null
    if (!state) return
    autoStartedChats.add(state.projectId)
    sendChatRuntimeMessage(state, next.autoStartMessage, {
      displayContent: next.task || next.autoStartMessage,
      keepInput: true,
      hideUserMessage: !!(session.temporaryExecution || session.executionKind === 'temporary_chat'),
      hiddenToBackend: !!(session.temporaryExecution || session.executionKind === 'temporary_chat')
    })
  }

  function bindChatPanes(root = document) {
    const view = root.querySelector?.('[data-collab-session]') || root.closest?.('[data-collab-session]') || root
    const sessionId = view?.dataset?.collabSession || ''
    const session = sessionStore.get(sessionId)
    if (!session) return
    const panes = Array.from(view.querySelectorAll('[data-collab-chat-project-id]'))
    const isTemporaryExecution = session.temporaryExecution || session.executionKind === 'temporary_chat'
    const agents = (Array.isArray(session.agents) ? session.agents : []).slice(0, isTemporaryExecution ? MAX_TEMP_AGENTS : MAX_CHILD_AGENTS)
    panes.forEach((pane, index) => {
      const htmlProjectId = pane.dataset.collabChatProjectId || ''
      // 优先用 chatProjectId 匹配，否则用 agent id 或按索引回退
      let agent = htmlProjectId ? agents.find(item => getAgentChatProjectId(item) === htmlProjectId) : null
      if (!agent) agent = agents.find(item => item.id && pane.dataset.collabAgentId === item.id) || agents[index] || null
      if (agent) createChatRuntime(session, agent, pane)
    })
    maybeAutoStartSessionChats(session, view)
  }

  /* ========== 临时 AI 图标化重构：headless runtime + 图标管理 ========== */

  function createHeadlessChatRuntimes(session = {}) {
    const agents = Array.isArray(session.agents) ? session.agents.slice(0, MAX_TEMP_AGENTS) : []
    agents.forEach(agent => {
      const projectId = getAgentChatProjectId(agent) || session.projectId || ''
      if (!projectId || chatRuntimes.has(projectId)) return
      const state = {
        projectId,
        parentProjectId: session.projectId || '',
        projectPath: session.projectPath || '',
        temporaryExecution: true,
        headless: true,
        reportFilePath: agent.reportFilePath || '',
        reportFileName: agent.reportFileName || '',
        sessionId: session.id || '',
        agentId: agent.id || '',
        agent,
        pane: null,
        messagesEl: null,
        inputEl: null,
        sendEl: null,
        statusEl: null,
        history: [],
        historyRestored: false,
        historyRestoring: false,
        restoredMessagesHistory: [],
        running: false,
        currentAiMsg: null,
        currentThinkingBlock: null,
        toolStats: { modified: [], created: [], read: [], commands: [] },
        modelConfig: getAgentInitialModel(agent),
        executionMode: agent.execMode || session.execMode || 'auto',
        skillName: agent.skillName || '',
        skillContent: agent.skillContent || null,
        uploadedFiles: [],
        collectedThinking: [],
        collectedTools: [],
        collectedContent: '',
        collectedReply: '',
        finalStreamContent: '',
        startedAt: 0,
        finishedAt: 0
      }
      chatRuntimes.set(projectId, state)
    })
    maybeAutoStartSessionChats(session, document)
  }

  function compactRuntimeToolResult(result = {}) {
    if (!result || typeof result !== 'object') return result
    const summary = {
      success: result.success,
      error: result.error,
      status: result.status,
      path: result.path,
      message: compactText(result.message || result.error || result.summary || result.text || '', 220)
    }
    if (typeof result.query === 'string') summary.query = result.query
    if (typeof result.url === 'string') summary.url = result.url
    if (Array.isArray(result.results)) {
      summary.count = result.results.length
      summary.results = result.results.slice(0, 5).map(item => ({
        title: compactText(item.title || item.name || item.url || item.link || '', 96),
        url: item.url || item.link || '',
        snippet: compactText(item.snippet || item.text || item.summary || '', 140)
      }))
    }
    return summary
  }

  function getToolStatusLabel(status = '', result = null) {
    if (result?.success === false || result?.error) return '失败'
    const value = String(status || '').toLowerCase()
    if (value === 'running') return '执行中'
    if (value === 'done' || value === 'completed' || result?.success === true) return '完成'
    return value || '工具调用'
  }

  function getToolSummaryText(event = {}) {
    const result = event.result && typeof event.result === 'object' ? event.result : null
    const args = event.args && typeof event.args === 'object' ? event.args : {}
    const target = result?.query || args.query || args.q || result?.url || args.url || result?.path || args.path || ''
    const count = Number(result?.count || 0)
    const message = result?.message || event.content || ''
    if (target && count) return `${target} · ${count} 条结果`
    if (target) return String(target)
    if (message) return compactText(message, 120)
    return getToolStatusLabel(event.status, result)
  }

  function renderToolResultPreview(event = {}) {
    const result = event.result && typeof event.result === 'object' ? event.result : null
    if (!result) return ''
    if (Array.isArray(result.results) && result.results.length) {
      return result.results.slice(0, 5).map((item, index) => {
        const title = item.title || item.url || item.link || `结果 ${index + 1}`
        const url = item.url || item.link || ''
        const snippet = item.snippet || item.text || item.summary || ''
        return `
          <div class="tool-event-result-row">
            <div class="tool-event-result-title">${index + 1}. ${escapeHtml(title)}</div>
            ${url ? `<div class="tool-event-result-url">${escapeHtml(url)}</div>` : ''}
            ${snippet ? `<div class="tool-event-result-snippet">${escapeHtml(snippet)}</div>` : ''}
          </div>
        `
      }).join('')
    }
    const text = result.message || result.error || result.path || result.url || event.content || ''
    return text ? `<div class="tool-event-result-text">${escapeHtml(compactText(text, 320))}</div>` : ''
  }

  function handleHeadlessEvent(state, type, data = {}) {
    if (type === 'status') {
      const wasRunning = state.running
      state.running = String(data.status || '') !== 'waiting' && isRunning(data.status)
      if (state.running && !wasRunning) {
        state.startedAt = Date.now()
        state.finishedAt = 0
      } else if (!state.running && wasRunning) {
        state.finishedAt = Date.now()
      }
      updateTempAgentIconStatus(state, data.status || (state.running ? 'running' : 'waiting'))
      return true
    }
    if (type === 'thinking-reset') {
      return true
    }
    if (type === 'thinking') {
      if (!data.content) return true
      state.collectedThinking.push({
        content: data.content,
        append: !!data.append,
        reuseOpenSegment: !!data.reuseOpenSegment,
        agentRole: data.agentRole || '',
        agentTitle: data.agentTitle || '',
        createdAt: Date.now()
      })
      syncThinkingToSessionAgent(state, data)
      return true
    }
    if (type === 'content-chunk' || type === 'intermediate-content') {
      if (!data.content) return true
      state.collectedContent += data.content
      return true
    }
    if (type === 'tool-start') {
      state.collectedTools.push({
        name: data.name,
        args: data.args || {},
        status: 'running',
        toolCallId: data.toolCallId || '',
        agentRole: data.agentRole || '',
        agentTitle: data.agentTitle || '',
        createdAt: Date.now()
      })
      syncToolToSessionAgent(state, data, 'running')
      return true
    }
    if (type === 'tool-result') {
      const pending = [...state.collectedTools].reverse().find(
        t => (t.toolCallId === (data.toolCallId || '') || t.name === data.name) && t.status === 'running'
      )
      if (pending) {
        pending.status = 'done'
        pending.result = compactRuntimeToolResult(data.result || {})
      }
      syncToolToSessionAgent(state, data, 'done')
      return true
    }
    if (type === 'final-delta') {
      if (data.reset) { state.finalStreamContent = ''; return true }
      const content = String(data.content || '')
      if (!content) return true
      state.finalStreamContent = `${state.finalStreamContent || ''}${content}`
      return true
    }
    if (type === 'reply') {
      if (data.content) state.collectedReply = data.content
      if (data.done) {
        state.running = false
        const finalStatus = data.error ? 'error' : 'done'
        updateTempAgentIconStatus(state, finalStatus)
        const finalContent = data.content || data.error || ''
        const completedAt = Number(data.completedAt || Date.now())
        syncRuntimeAgentToSession(state, {
          status: finalStatus,
          statusText: data.error || 'done',
          content: finalContent,
          completedAt,
          elapsedMs: Number(data.durationMs || 0)
        }, {
          agentId: state.agentId,
          name: state.agent?.name || state.agent?.role || state.agentId,
          role: state.agent?.role || '',
          task: state.agent?.task || '',
          status: finalStatus,
          content: finalContent,
          error: data.error ? { message: data.error } : null,
          completedAt,
          durationMs: Number(data.durationMs || 0)
        })
        startNextSerialChat(state.sessionId)
      }
      return true
    }
    return false
  }

  function syncThinkingToSessionAgent(state, data) {
    const session = sessionStore.get(state.sessionId)
    if (!session?.agents) return
    const agent = session.agents.find(a => a.id === state.agentId)
    if (!agent) return
    if (!agent.thinking) agent.thinking = []
    agent.thinking.push({
      id: `t-${Date.now()}`,
      type: 'status',
      status: 'active',
      content: data.content,
      createdAt: new Date().toISOString()
    })
    sessionJanitor?.trimAgentEvents?.(agent)
    syncCanvasCollaborationSession(session)
  }

  function syncToolToSessionAgent(state, data, status) {
    const session = sessionStore.get(state.sessionId)
    if (!session?.agents) return
    const agent = session.agents.find(a => a.id === state.agentId)
    if (!agent) return
    if (!agent.tools) agent.tools = []
    if (status === 'running') {
      agent.tools.push({
        id: data.toolCallId || `tool-${Date.now()}`,
        toolCallId: data.toolCallId || '',
        name: data.name || '',
        title: data.name || '',
        args: data.args || {},
        status: 'running',
        createdAt: new Date().toISOString()
      })
    } else {
      const tool = [...agent.tools].reverse().find(
        t => (t.toolCallId === (data.toolCallId || '') || t.name === data.name) && t.status === 'running'
      )
      if (tool) {
        tool.status = 'done'
        tool.result = compactRuntimeToolResult(data.result || {})
        tool.content = typeof data.result === 'string' ? data.result : compactText(data.result?.message || data.result?.error || data.result?.path || '', 300)
      }
    }
    sessionJanitor?.trimAgentEvents?.(agent)
    syncCanvasCollaborationSession(session)
  }

  function createTempAgentIcons(session = {}) {
    clearTempAgentIcons(session)
    syncCanvasCollaborationSession(session)
  }

  function syncTempAgentIcons(session = {}) {
    clearTempAgentIcons(session)
    syncCanvasCollaborationSession(session)
  }

  function getTempAgentIconKey(projectId = '', sessionId = '', agentId = '') {
    return `${projectId || 'project'}::${sessionId || 'session'}::${agentId || 'agent'}`
  }

  function updateTempAgentIconStatus(target, status) {
    const payload = typeof target === 'object' && target !== null ? target : { agentId: target }
    const sessionId = payload.sessionId || ''
    const agentId = payload.agentId || ''
    const session = sessionId ? sessionStore.get(sessionId) : null
    if (session?.agents?.length && agentId) {
      const agent = session.agents.find(item => item.id === agentId)
      if (agent) {
        agent.status = status || agent.status || 'waiting'
        agent.statusText = getStatusLabel(agent.status)
        if (payload.startedAt && !agent.startedAt) agent.startedAt = payload.startedAt
        if (payload.finishedAt) agent.finishedAt = payload.finishedAt
        if (payload.collectedThinking?.length) agent.thinking = payload.collectedThinking
        if (payload.collectedTools?.length) agent.tools = payload.collectedTools
        if (payload.collectedReply) agent.content = payload.collectedReply
        if (payload.reportFilePath) agent.reportFilePath = payload.reportFilePath
        if (payload.reportFileName) agent.reportFileName = payload.reportFileName
      }
    }
    if (session) syncCanvasCollaborationSession(session)
  }

  function clearTempAgentIcons(session = null) {
    const dock = document.getElementById('tempAgentsDock')
    if (!session) {
      if (dock) dock.innerHTML = ''
      tempAgentIcons.clear()
      return
    }
    const projectId = session.projectId || ''
    const sessionId = session.id || ''
    for (const [key, icon] of tempAgentIcons.entries()) {
      if ((!projectId || icon.dataset.projectId === projectId) && (!sessionId || icon.dataset.sessionId === sessionId)) {
        icon.remove()
        tempAgentIcons.delete(key)
      }
    }
    refreshTempAgentIconVisibility()
  }

  function refreshTempAgentIconVisibility() {
    const dock = document.getElementById('tempAgentsDock')
    if (dock) {
      dock.innerHTML = ''
      dock.hidden = true
    }
    tempAgentIcons.clear()
  }

  function showTempAgentDetail(sessionId, agentId) {
    const session = sessionStore.get(sessionId)
    if (!session) return
    const agent = (session.agents || []).find(a => a.id === agentId)
    if (!agent) return
    const projectId = getAgentChatProjectId(agent) || session.projectId || ''
    const state = projectId ? chatRuntimes.get(projectId) : null

    const thinkingEvents = (state?.collectedThinking?.length ? state.collectedThinking : null) || agent.thinking || []
    const toolEvents = (state?.collectedTools?.length ? state.collectedTools : null) || agent.tools || []
    const reportContent = state?.collectedReply || agent.content || ''
    const reportFilePath = agent.reportFilePath || state?.reportFilePath || ''
    const reportFileName = agent.reportFileName || state?.reportFileName || reportFilePath
    const statusRaw = agent.status || (state?.running ? 'running' : 'waiting')
    const statusLabel = getStatusLabel(statusRaw)
    const isAgentRunning = state?.running || isRunning(statusRaw)
    const elapsedMs = state?.startedAt
      ? ((state.finishedAt || Date.now()) - state.startedAt)
      : 0

    const overlay = document.createElement('div')
    overlay.className = 'temp-agent-detail-overlay'
    overlay.innerHTML = `
      <div class="temp-agent-detail-panel">
        <div class="temp-agent-detail-header">
          <span class="temp-agent-detail-title">${escapeHtml(agent.name || agent.role || '临时 AI')}</span>
          ${state?.startedAt
            ? `<span class="temp-agent-elapsed" data-agent-elapsed="1" data-started="${state.startedAt}" data-finished="${state.finishedAt || 0}">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                <span class="elapsed-text">${formatElapsed(elapsedMs)}</span>
              </span>`
            : ''
          }
          ${isAgentRunning
            ? `<button class="temp-agent-interrupt-btn" data-interrupt-agent title="中断执行">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>
                <span>中断</span>
              </button>`
            : ''
          }
          <span class="temp-agent-detail-status">${escapeHtml(statusLabel)}</span>
          <button class="temp-agent-detail-close" data-close-detail>&times;</button>
        </div>
        <div class="temp-agent-detail-body">
          <div class="temp-agent-detail-section">
            <div class="section-title">任务</div>
            <div class="section-content" style="font-size:13px;color:var(--text-primary,#e0e0e0);line-height:1.6;">${escapeHtml(agent.task || '未指定任务')}</div>
          </div>
          <div class="temp-agent-detail-section">
            <div class="section-title">思考过程 (${thinkingEvents.length})</div>
            <div class="thinking-events-list">
              ${thinkingEvents.filter(e => e && (e.content || typeof e === 'string')).map(e =>
                `<div class="thinking-event-item">${escapeHtml(typeof e === 'string' ? e : (e.content || ''))}</div>`
              ).join('') || '<div class="temp-agent-report-placeholder">暂无思考记录</div>'}
            </div>
          </div>
          <div class="temp-agent-detail-section">
            <div class="section-title">工具调用 (${toolEvents.length})</div>
            <div class="tool-events-list">
              ${toolEvents.map(e => `
                <div class="tool-event-item">
                  <div class="tool-event-head">
                    <span class="tool-name">${escapeHtml(toolLabel(e.name || e.title || '工具'))}</span>
                    <span class="tool-event-status">${escapeHtml(getToolStatusLabel(e.status, e.result))}</span>
                  </div>
                  <div class="tool-detail">${escapeHtml(getToolSummaryText(e))}</div>
                  ${renderToolResultPreview(e)}
                </div>
              `).join('') || '<div class="temp-agent-report-placeholder">暂无工具调用</div>'}
            </div>
          </div>
          <div class="temp-agent-detail-section">
            <div class="section-title">报告</div>
            <div class="section-content">
              ${reportFilePath
                ? `<button type="button" class="agent-collab-report-file" data-collab-report-file data-report-path="${escapeHtml(reportFilePath)}" data-report-title="${escapeHtml(agent.name || '报告')}">${escapeHtml(reportFileName)}</button>`
                : (reportContent
                  ? `<div style="font-size:13px;line-height:1.65;color:var(--text-primary,#e0e0e0);">${renderAiContent(reportContent)}</div>`
                  : '<div class="temp-agent-report-placeholder">报告生成中...</div>'
                )
              }
            </div>
          </div>
        </div>
      </div>
    `
    overlay.addEventListener('click', e => {
      if (e.target === overlay || e.target.closest('[data-close-detail]')) overlay.remove()
    })

    // 计时器自动更新
    const elapsedEl = overlay.querySelector('[data-agent-elapsed] .elapsed-text')
    if (elapsedEl && state?.startedAt && !state.finishedAt) {
      ensureElapsedTimer()
      const timerId = setInterval(() => {
        if (!document.contains(elapsedEl)) { clearInterval(timerId); return }
        if (state.finishedAt) {
          elapsedEl.textContent = formatElapsed(state.finishedAt - state.startedAt)
          clearInterval(timerId)
          return
        }
        elapsedEl.textContent = formatElapsed(Date.now() - state.startedAt)
      }, 1000)
    }

    // 中断按钮
    const interruptBtn = overlay.querySelector('[data-interrupt-agent]')
    if (interruptBtn && state) {
      interruptBtn.onclick = () => {
        interruptChatRuntime(state)
        interruptBtn.disabled = true
        interruptBtn.classList.add('disabled')
        interruptBtn.querySelector('span').textContent = '已中断'
        // 更新计时器
        const finalElapsed = overlay.querySelector('[data-agent-elapsed] .elapsed-text')
        if (finalElapsed && state.startedAt) {
          finalElapsed.textContent = formatElapsed((state.finishedAt || Date.now()) - state.startedAt)
        }
        // 更新状态标签
        const statusEl = overlay.querySelector('.temp-agent-detail-status')
        if (statusEl) statusEl.textContent = getStatusLabel('interrupted')
      }
    }

    bindReportActions(overlay)
    document.body.appendChild(overlay)
  }

  function handleChatEvent(type, data = {}) {
    const state = data.projectId ? chatRuntimes.get(data.projectId) : null
    if (!state) return false
    if ((type === 'tool-start' || type === 'tool-result') && ['report_progress', 'start_final_reply', 'show_thinking_note', 'complete_step'].includes(String(data.name || ''))) {
      return true
    }
    if (state.headless) {
      return handleHeadlessEvent(state, type, data)
    }
    if (type === 'status') {
      state.running = String(data.status || '') !== 'waiting' && isRunning(data.status)
      setChatRuntimeStatus(state, data.status || (state.running ? 'running' : 'waiting'))
      return true
    }
    if (type === 'thinking-reset') {
      finishRuntimeThinking(state, 'done')
      return true
    }
    if (type === 'thinking') {
      if (!data.content) return true
      if (window.AiMessageUI?.shouldDisplayThinkingStatus && !window.AiMessageUI.shouldDisplayThinkingStatus(data.content)) return true
      ensureRuntimeAiMessage(state)
      const created = window.AiMessageUI?.createNewThinkingBlock?.(state.currentAiMsg, state.currentThinkingBlock, {
        reuseOpenSegment: !!data.reuseOpenSegment,
        agentRole: data.agentRole || '',
        agentTitle: data.agentTitle || ''
      })
      state.currentThinkingBlock = created?.block || state.currentThinkingBlock
      if (state.currentThinkingBlock) {
        window.AiMessageUI?.updateThinkingProgress?.(state.currentThinkingBlock, data.content, {
          append: !!data.append,
          forceUpdate: !!data.forceUpdate,
          agentRole: data.agentRole || '',
          agentTitle: data.agentTitle || ''
        })
      }
      return true
    }
    if (type === 'content-chunk' || type === 'intermediate-content') {
      if (!data.content) return true
      ensureRuntimeAiMessage(state)
      finishRuntimeThinking(state, 'done')
      state.toolRenderer?.addIntermediateContent?.(data.content)
      return true
    }
    if (type === 'tool-start') {
      ensureRuntimeAiMessage(state)
      finishRuntimeThinking(state, 'done')
      state.toolRenderer?.preShowOperation?.(data.name, data.args || {}, {
        agentRole: data.agentRole || '',
        agentTitle: data.agentTitle || '',
        toolCallId: data.toolCallId || ''
      })
      return true
    }
    if (type === 'tool-result') {
      ensureRuntimeAiMessage(state)
      finishRuntimeThinking(state, 'done')
      state.toolRenderer?.addOperation?.(data.name, data.args || {}, data.result || {}, state.toolStats, {
        agentRole: data.agentRole || '',
        agentTitle: data.agentTitle || '',
        toolCallId: data.toolCallId || ''
      })
      return true
    }
    if (type === 'final-delta') {
      ensureRuntimeAiMessage(state)
      finishRuntimeThinking(state, 'done')
      const contentEl = state.currentAiMsg?.querySelector('.ai-content')
      if (!contentEl) return true
      if (data.reset) {
        state.finalStreamContent = ''
        contentEl.innerHTML = ''
        return true
      }
      const content = String(data.content || '')
      if (!content) return true
      state.finalStreamContent = `${state.finalStreamContent || ''}${content}`
      contentEl.innerHTML = `${escapeHtml(state.finalStreamContent).replace(/\n/g, '<br>')}<span class="typewriter-cursor" style="opacity: 0.7; animation: blink 0.8s infinite;">▌</span>`
      if (state.messagesEl) state.messagesEl.scrollTop = state.messagesEl.scrollHeight
      return true
    }
    if (type === 'reply') {
      if (data.error) {
        ensureRuntimeAiMessage(state)
        const contentEl = state.currentAiMsg?.querySelector('.ai-content')
        if (contentEl) contentEl.innerHTML = `<div class="error-message">${escapeHtml(data.error)}</div>`
      } else if (data.content) {
        ensureRuntimeAiMessage(state)
        const contentEl = state.currentAiMsg?.querySelector('.ai-content')
        if (contentEl) {
          contentEl.innerHTML = state.temporaryExecution && data.done
            ? renderTemporaryReportNotice(state)
            : renderAiContent(data.content)
          if (state.temporaryExecution && data.done) bindReportActions(contentEl)
        }
        state.finalStreamContent = ''
        if (data.done) state.history.push({ role: 'assistant', content: data.content })
      }
      if (data.done) {
        state.running = false
        finishRuntimeThinking(state, data.error ? 'error' : 'done')
        state.currentAiMsg?.classList.remove('thinking')
        if (state.currentAiMsg) {
          window.AiMessageUI?.setWorkDuration?.(state.currentAiMsg, data.durationMs)
          window.AiMessageUI?.collapseDynamicArea?.(state.currentAiMsg)
          window.AiMessageUI?.updateWorkStatus?.(state.currentAiMsg, data.error ? 'error' : 'done')
        }
        state.currentAiMsg = null
        state.toolStats = { modified: [], created: [], read: [], commands: [] }
        const finalStatus = data.error ? 'error' : 'done'
        setChatRuntimeStatus(state, finalStatus)
        const finalContent = data.content || data.error || ''
        const completedAt = Number(data.completedAt || Date.now())
        syncRuntimeAgentToSession(state, {
          status: finalStatus,
          statusText: data.error || 'done',
          content: finalContent,
          completedAt,
          elapsedMs: Number(data.durationMs || 0)
        }, {
          agentId: state.agentId,
          name: state.agent?.name || state.agent?.role || state.agentId,
          role: state.agent?.role || '',
          task: state.agent?.task || '',
          status: finalStatus,
          content: finalContent,
          error: data.error ? { message: data.error } : null,
          completedAt,
          durationMs: Number(data.durationMs || 0)
        })
        startNextSerialChat(state.sessionId)
      }
      if (state.messagesEl) state.messagesEl.scrollTop = state.messagesEl.scrollHeight
      return true
    }
    return false
  }

  function buildSessionHtml(session = {}) {
    const isTemporaryExecution = session.temporaryExecution || session.executionKind === 'temporary_chat'
    const agents = getSessionAgents(session)
    const visibleIndexes = isTemporaryExecution ? agents.map((_, index) => index) : getVisiblePaneIndexes(session, agents)
    const visibleSet = new Set(visibleIndexes)
    const visibleCount = Math.max(1, Math.min(isTemporaryExecution ? MAX_TEMP_AGENTS : MAX_CHILD_AGENTS, visibleIndexes.length || 1))
    const countClass = `agent-count-${visibleCount}`
    return `
      <div class="agent-collab-view ${isTemporaryExecution ? 'agent-collab-temp-view' : ''}" data-collab-session="${escapeHtml(session.id)}">
        <div class="agent-collab-shared-ask" data-collab-shared-ask></div>
        ${agents.length ? `<div class="agent-collab-chat-grid ${countClass}">
          ${agents.map((agent, index) => buildChatPaneHtml(session, agent, index, {
            visible: visibleSet.has(index),
            visibleCount,
            totalCount: agents.length
          })).join('')}
        </div>` : '<div class="agent-collab-empty-state">当前为单 AI 模式，未创建右侧协作会话。</div>'}
      </div>
    `
  }

  function getModelOptions(models = [], selectedKey = '') {
    const list = Array.isArray(models) ? models : []
    return [
      '<option value="">跟随主窗口 AI</option>',
      ...list.map((model, index) => {
        const key = model.modelKey || model.id || model.key || model.name || model.model
        const rawName = model.displayName || model.label || model.modelName || model.model || model.name || key
        const name = prettifyModelName(rawName, key, index)
        return `<option value="${escapeHtml(key)}" ${String(key) === String(selectedKey) ? 'selected' : ''}>${escapeHtml(name)}</option>`
      })
    ].join('')
  }

  function createModal() {
    let modal = document.getElementById('agentCollabModal')
    if (modal) return modal
    modal = document.createElement('div')
    modal.id = 'agentCollabModal'
    modal.className = 'agent-collab-modal'
    document.body.appendChild(modal)
    return modal
  }

  function bind(options = {}) {
    const getModels = options.getModels || (() => [])
    const getActiveProjectId = options.getActiveProjectId || (() => null)
    const getActiveModel = options.getActiveModel || (() => null)
    const getSkills = options.getSkills || options.getAllSkills || (() => [])
    const getEnabledSkills = options.getEnabledSkills || (() => [])
    const createCollabTab = options.createCollabTab || (() => {})
    const showToast = options.showToast || ((message, type) => window.ToastUI?.show?.(message, type))
    const isMainAiRunning = options.isMainAiRunning || (() => false)
    const sendReportToMainAi = options.sendReportToMainAi || (async () => false)
    getModelsProvider = getModels
    getActiveProjectIdProvider = getActiveProjectId
    getActiveModelProvider = getActiveModel
    getSkillsProvider = getSkills
    getEnabledSkillsProvider = getEnabledSkills
    if (!tempAgentProjectListenerBound) {
      tempAgentProjectListenerBound = true
      window.addEventListener('lingxi:active-project-changed', refreshTempAgentIconVisibility)
      window.addEventListener('lingxi:active-project-changed', () => {
        const activeProjectId = getActiveProjectId()
        pollers.forEach((timer, sessionId) => {
          const session = sessionStore.get(sessionId)
          if (session && session.projectId && session.projectId !== activeProjectId) {
            clearInterval(timer)
            pollers.delete(sessionId)
          }
        })
      })
    }

    function showRequest(proposal = {}) {
      if (proposal.projectId && proposal.projectId !== getActiveProjectId()) return
      const modal = createModal()
      const isTemporaryExecution = proposal.temporaryExecution || proposal.executionKind === 'temporary_chat'
      const agentLimit = isTemporaryExecution ? MAX_TEMP_AGENTS : MAX_CHILD_AGENTS
      const modes = [
        { key: 'single', name: '单 AI', desc: '由主窗口 AI 独立完成，适合小范围任务。' },
        { key: 'serial', name: '串行多 AI', desc: '按顺序执行，适合前后端联动和需要承接结果的任务。' },
        { key: 'parallel', name: '并行多 AI', desc: '多个 AI 会话同时跑，适合只读审查和互不冲突的任务。' }
      ]
      const recommendation = proposal.recommendation || (isTemporaryExecution ? 'parallel' : 'serial')
      const allAgents = Array.isArray(proposal.agents) ? proposal.agents : []
      const agents = allAgents.slice(0, agentLimit)
      const droppedCount = Math.max(0, allAgents.length - agents.length)

      modal.innerHTML = `
        <div class="agent-collab-dialog">
          <div class="agent-collab-dialog-header">
            <div>
              <div class="agent-collab-title">${isTemporaryExecution ? '启动临时多 AI？' : '启动协作任务？'}</div>
              <div class="agent-collab-subtitle">${escapeHtml(proposal.reason || (isTemporaryExecution ? '主窗口建议在协作画布中启动一次性多 AI 任务。' : '主窗口建议启动协作任务。'))}</div>
            </div>
            <button class="agent-collab-close" type="button" data-collab-cancel>×</button>
          </div>
          <div class="agent-collab-dialog-body">
            <div class="agent-collab-section">
              <div class="agent-collab-section-title">协作模式</div>
              <div class="agent-collab-mode-grid">
                ${modes.map(mode => `
                  <label class="agent-collab-mode">
                    <input type="radio" name="agentCollabMode" value="${mode.key}" ${mode.key === recommendation ? 'checked' : ''}>
                    <span class="agent-collab-mode-name">${mode.name}${mode.key === recommendation ? '<span class="agent-collab-recommend">推荐</span>' : ''}</span>
                    <span class="agent-collab-mode-desc">${mode.desc}</span>
                  </label>
                `).join('')}
              </div>
            </div>
            <div class="agent-collab-section">
              <div class="agent-collab-section-title">计划步骤</div>
              ${renderPlanPanel(proposal.plan || [], { title: '主窗口 AI 计划', prefix: 'ai' }) || '<div class="agent-collab-warning">主窗口 AI 暂未提供计划，启动后会按任务继续执行。</div>'}
            </div>
            <div class="agent-collab-section">
              <div class="agent-collab-section-title">AI 会话与模型（${agents.length}/${agentLimit}）</div>
              ${droppedCount ? `<div class="agent-collab-warning">主窗口 AI 提供了 ${allAgents.length} 个 AI 会话，当前最多支持 ${agentLimit} 个，已只保留前 ${agentLimit} 个。</div>` : ''}
              <div class="agent-collab-agent-list">
                ${agents.map((agent, index) => `
                  <div class="agent-collab-agent-row" data-agent-index="${index}">
                    <div>
                      <div class="agent-collab-agent-role">${escapeHtml(agent.name || agent.role || `AI ${index + 1}`)}</div>
                      <div class="agent-collab-agent-task">${escapeHtml(agent.role || '')}</div>
                    </div>
                    <div class="agent-collab-agent-task">${escapeHtml(agent.task || '')}</div>
                    <select class="agent-collab-agent-model">${getModelOptions(getModels(), agent.modelKey)}</select>
                  </div>
                `).join('') || '<div class="agent-collab-warning">没有可配置的右侧 AI 会话。可选择单 AI，或让主窗口 AI 重新规划。</div>'}
              </div>
            </div>
            ${proposal.risk ? `<div class="agent-collab-warning">${escapeHtml(proposal.risk)}</div>` : ''}
          </div>
          <div class="agent-collab-dialog-footer">
            <button class="agent-collab-btn" type="button" data-collab-cancel>取消</button>
            <button class="agent-collab-btn primary" type="button" data-collab-start>${isTemporaryExecution ? '启动临时多 AI' : '开始协作'}</button>
          </div>
        </div>
      `
      modal.classList.add('show')
      bindCollabInteractions(modal)

      modal.querySelectorAll('[data-collab-cancel]').forEach(btn => btn.addEventListener('click', async () => {
        modal.classList.remove('show')
        await window.api?.cancelAgentCollaboration?.(
          proposal.projectId || getActiveProjectId(),
          proposal.requestId,
          '用户取消了协作任务申请。'
        )
      }))

      modal.querySelector('[data-collab-start]')?.addEventListener('click', async () => {
        let mode = modal.querySelector('input[name="agentCollabMode"]:checked')?.value || recommendation
        if (mode !== 'single' && agents.length <= 1) mode = 'serial'
        const selectedAgents = agents.map((agent, index) => {
          const row = modal.querySelector(`[data-agent-index="${index}"]`)
          const select = row?.querySelector('.agent-collab-agent-model')
          const modelKey = select?.value || agent.modelKey || ''
          const modelConfig = modelKey
            ? getModels().find(model => String(model.modelKey || model.id || model.key || model.name || model.model) === String(modelKey))
            : null
          return {
            ...agent,
            modelKey,
            modelName: modelConfig?.modelName || modelConfig?.displayName || agent.modelName || '',
            modelConfig: modelConfig || null
          }
        })
        const payload = {
          requestId: proposal.requestId,
          mode,
          executionKind: isTemporaryExecution ? 'temporary_chat' : (proposal.executionKind || ''),
          plan: proposal.plan || [],
          agents: selectedAgents,
          fallbackModelConfig: getActiveModel() || null
        }
        const result = await window.api?.startAgentCollaboration?.(proposal.projectId || getActiveProjectId(), payload)
        if (result?.success && result.session) {
          modal.classList.remove('show')
          renderSession(result.session)
          const isTempStart = result.session.temporaryExecution || result.session.executionKind === 'temporary_chat'
          const isCanvasWorkflow = result.session.workflowExecution || result.session.executionKind === 'workflow'
          if (isTempStart) {
            clearTempAgentIcons({ projectId: result.session.projectId || getActiveProjectId() })
            createTempAgentIcons(result.session)
            createHeadlessChatRuntimes(result.session)
            // 临时多 AI 走画布，不再打开右侧“多会话窗口”
          } else if (!isCanvasWorkflow) {
            showToast('多会话窗口已下线，请使用临时多 AI 或左侧「新开会话」', 'warning')
          }
        } else {
          showToast(result?.error || '启动协作失败', 'error')
        }
      })
    }

    function renderSession(session = {}) {
      sessionStore.set(session.id, session)
      renderSessionIntoDom(session)
      ensureSessionPolling(session)
      showCleanHandoffPrompt(session, { showToast, isMainAiRunning, sendReportToMainAi })
    }

    function init() {
      window.api?.onAgentCollaborationRequest?.(proposal => {
        showRequest(proposal)
      })
      window.api?.onAgentCollaborationSession?.(session => {
        renderSession(session)
        const isTemp = session.temporaryExecution || session.executionKind === 'temporary_chat'
        const isCanvasWorkflow = session.workflowExecution || session.executionKind === 'workflow'
        const isActiveProject = !session.projectId || session.projectId === getActiveProjectId()
        if ((isTemp || isCanvasWorkflow) && isActiveProject && typeof window.openCanvasView === 'function' && !autoOpenedCanvasSessions.has(session.id)) {
          autoOpenedCanvasSessions.add(session.id)
          window.openCanvasView?.()
        }
        if (isTemp) {
          syncTempAgentIcons(session)
          if (!isDone(session.status)) createHeadlessChatRuntimes(session)
        }
        // 非临时、非工作流的右侧“多会话窗口”已下线，不再 createCollabTab
      })
    }

    return {
      init,
      showRequest,
      renderSession,
      handleChatEvent,
      buildSessionHtml,
      renderPlanPanel,
      bindCollabInteractions
    }
  }

  window.AgentCollaborationUI = {
    bind,
    renderSession: renderSessionIntoDom,
    renderPlanPanel,
    bindPlanToggles,
    bindCollabInteractions,
    buildSessionHtml,
    handleChatEvent,
    handleSharedAsk,
    findActiveSession,
    appendSessionEvent,
    getSession,
    ensureSessionPolling,
    stopSessionPolling,
    clearElapsedTimer
  }
})()
