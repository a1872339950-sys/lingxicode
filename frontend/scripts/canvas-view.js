/**
 * CanvasView - 多 worker 任务执行画布
 * 支持真实多 Agent 协作 session 数据驱动
 */
(function () {
  'use strict';

  const MIN_STAGE_WIDTH = 1400;
  const MIN_STAGE_HEIGHT = 820;
  const STAGE_PADDING = 320;
  const NODE_WIDTH = 260;
  const NODE_HEIGHT = 126;
  const FLOW_TASK_LEFT = 88;
  const FLOW_TASK_TOP = 306;
  const FLOW_TASK_WIDTH = 330;
  const FLOW_TASK_HEIGHT = 128;
  const FLOW_WORKER_LEFT = 600;
  const FLOW_WORKER_WIDTH = 380;
  const FLOW_WORKER_HEIGHT = 126;
  const FLOW_WORKER_GAP = 184;
  const MIN_ZOOM = 0.55;
  const MAX_ZOOM = 1.5;
  const TERMINAL_STATUSES = new Set(['done', 'completed', 'cancelled', 'interrupted', 'completed_with_errors']);
  const ERROR_STATUSES = new Set(['error', 'failed', 'timeout']);
  const RUNNING_STATUSES = new Set(['queued', 'thinking', 'streaming', 'using_tools', 'running', 'active', 'working', 'running_with_errors']);

  let container = null;
  let root = null;
  let viewport = null;
  let stage = null;
  let zoom = 0.88;
  let panX = 0;
  let panY = 0;
  let isPanning = false;
  let panStartX = 0;
  let panStartY = 0;
  let panBaseX = 0;
  let panBaseY = 0;
  let currentSession = null;
  let currentWorkers = [];
  let viewMode = 'design';
  let selectedNodeId = '';
  let draggedNodeId = '';
  let dragStartX = 0;
  let dragStartY = 0;
  let dragNodeX = 0;
  let dragNodeY = 0;
  let hasDraggedNode = false;
  let workflowEventsBound = false;
  let workflowReady = false;

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function compactText(value, limit) {
    const text = String(value || '').replace(/\s+/g, ' ').trim();
    if (!text) return '';
    return text.length > limit ? text.slice(0, limit - 1) + '…' : text;
  }

  function getStatusLabel(status) {
    const labels = {
      waiting: '等待中',
      queued: '排队中',
      thinking: '思考中',
      streaming: '输出中',
      using_tools: '调用工具',
      running: '执行中',
      active: '执行中',
      working: '执行中',
      running_with_errors: '执行中 · 有错误',
      done: '已完成',
      completed: '已完成',
      completed_with_errors: '已完成 · 有错误',
      cancelled: '已取消',
      interrupted: '已中断',
      error: '失败',
      failed: '失败',
      timeout: '超时'
    };
    return labels[String(status || '')] || String(status || '等待中');
  }

  function formatElapsed(agent) {
    const started = Number(agent.startedAt || agent.createdAt || (currentSession && currentSession.createdAt) || 0);
    const ended = Number(agent.finishedAt || agent.completedAt || 0);
    if (!started) return '';
    const ms = Math.max(0, (ended || Date.now()) - started);
    const seconds = Math.floor(ms / 1000);
    if (seconds < 60) return seconds + 's';
    const minutes = Math.floor(seconds / 60);
    return minutes + 'm ' + (seconds % 60) + 's';
  }

  function getLatestEvent(events) {
    return Array.isArray(events) && events.length ? events[events.length - 1] : null;
  }

  function getAgentNote(agent) {
    const status = String(agent.status || 'waiting');
    const latestTool = getLatestEvent(agent.tools || agent.toolCalls);
    const latestThinking = getLatestEvent(agent.thinking || agent.thoughts);
    const reportFile = agent.reportFileName || agent.reportFilePath || '';
    if (ERROR_STATUSES.has(status)) return compactText((agent.error && agent.error.message) || agent.statusText || '执行失败', 96);
    if (reportFile && TERMINAL_STATUSES.has(status)) return '已生成汇报 · ' + compactText(reportFile, 52);
    if (latestTool) return compactText(latestTool.title || latestTool.name || latestTool.content || '正在调用工具', 96);
    if (latestThinking) return compactText(latestThinking.content || latestThinking.title || latestThinking.message || '正在思考', 96);
    return compactText(agent.statusText || agent.task || agent.role || agent.name || '等待实时进展', 96);
  }

  function normalizeSessionWorkers(session) {
    const agents = Array.isArray(session && session.agents) ? session.agents.slice(0, 10) : [];
    const workflowNodes = new Map((session?.workflow?.nodes || []).map(node => [String(node.id), node]));
    if (!agents.length) return [];
    return agents.map(function (agent, index) {
      const status = String(agent.status || 'waiting');
      const elapsed = formatElapsed(agent);
      const name = agent.name || agent.role || agent.id || ('Worker ' + (index + 1));
      const statusType = ERROR_STATUSES.has(status)
        ? 'error'
        : TERMINAL_STATUSES.has(status)
          ? 'done'
          : RUNNING_STATUSES.has(status)
            ? 'running'
            : 'waiting';
      return {
        key: agent.id || ('agent-' + index),
        nodeId: agent.nodeId || agent.id || ('agent-' + index),
        name,
        mark: String(name).trim().slice(0, 1) || String(index + 1),
        status: getStatusLabel(status) + (elapsed ? ' · ' + elapsed : ''),
        note: getAgentNote(agent),
        rawStatus: status,
        left: Number(workflowNodes.get(String(agent.nodeId || agent.id))?.x) || FLOW_WORKER_LEFT,
        top: Number(workflowNodes.get(String(agent.nodeId || agent.id))?.y) || (54 + index * FLOW_WORKER_GAP),
        statusType
      };
    });
  }

  function getSessionTaskSummary() {
    if (currentSession && currentSession.summary) return compactText(currentSession.summary, 120);
    if (currentSession && currentSession.task) return compactText(currentSession.task, 120);
    if (currentSession && currentSession.prompt) return compactText(currentSession.prompt, 120);
    return currentWorkers.length
      ? currentWorkers.length + ' 个 worker：' + currentWorkers.map(worker => worker.name).join('、')
      : '当前协作任务尚未创建执行节点';
  }

  function icon(name) {
    const icons = {
      user: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21a8 8 0 0 0-16 0"></path><circle cx="12" cy="7" r="4"></circle></svg>',
      fit: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M8 3H5a2 2 0 0 0-2 2v3"></path><path d="M16 3h3a2 2 0 0 1 2 2v3"></path><path d="M8 21H5a2 2 0 0 1-2-2v-3"></path><path d="M16 21h3a2 2 0 0 0 2-2v-3"></path></svg>',
      minus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12h14"></path></svg>',
      plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14"></path><path d="M5 12h14"></path></svg>',
      workers: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M22 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path></svg>',
      retry: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 6v5h-5"></path><path d="M19 11a8 8 0 1 0 1 5"></path></svg>'
    };
    return icons[name] || '';
  }

  function applyTransform() {
    if (stage) stage.style.transform = 'translate(' + panX + 'px, ' + panY + 'px) scale(' + zoom + ')';
  }

  function getStageBounds(workflow = null) {
    const nodes = workflow?.nodes || [];
    let minX = 0;
    let minY = 0;
    let maxX = MIN_STAGE_WIDTH;
    let maxY = MIN_STAGE_HEIGHT;
    if (nodes.length) {
      nodes.forEach(function (node) {
        const x = Number(node.x || 0);
        const y = Number(node.y || 0);
        minX = Math.min(minX, x - STAGE_PADDING);
        minY = Math.min(minY, y - STAGE_PADDING);
        maxX = Math.max(maxX, x + NODE_WIDTH + STAGE_PADDING);
        maxY = Math.max(maxY, y + NODE_HEIGHT + STAGE_PADDING);
      });
    } else if (currentWorkers.length) {
      minX = Math.min(minX, FLOW_TASK_LEFT - STAGE_PADDING);
      minY = Math.min(minY, FLOW_TASK_TOP - STAGE_PADDING);
      maxX = Math.max(maxX, FLOW_TASK_LEFT + FLOW_TASK_WIDTH + STAGE_PADDING);
      maxY = Math.max(maxY, FLOW_TASK_TOP + FLOW_TASK_HEIGHT + STAGE_PADDING);
      currentWorkers.forEach(function (worker) {
        const x = Number(worker.left || 0);
        const y = Number(worker.top || 0);
        minX = Math.min(minX, x - STAGE_PADDING);
        minY = Math.min(minY, y - STAGE_PADDING);
        maxX = Math.max(maxX, x + FLOW_WORKER_WIDTH + STAGE_PADDING);
        maxY = Math.max(maxY, y + 136 + STAGE_PADDING);
      });
    }
    return {
      minX: Math.floor(minX),
      minY: Math.floor(minY),
      width: Math.ceil(maxX - minX),
      height: Math.ceil(maxY - minY)
    };
  }

  function applyStageBounds(workflow = null) {
    if (!stage) return getStageBounds(workflow);
    const bounds = getStageBounds(workflow);
    stage.style.width = bounds.width + 'px';
    stage.style.height = bounds.height + 'px';
    stage.dataset.minX = String(bounds.minX);
    stage.dataset.minY = String(bounds.minY);
    return bounds;
  }

  function getRenderOffset(bounds = null) {
    const currentBounds = bounds || {
      minX: Number(stage?.dataset.minX || 0),
      minY: Number(stage?.dataset.minY || 0)
    };
    return {
      x: -Number(currentBounds.minX || 0),
      y: -Number(currentBounds.minY || 0)
    };
  }

  function fitView() {
    if (!viewport) return;
    const rect = viewport.getBoundingClientRect();
    const scale = clamp(Math.min(rect.width / 1100, rect.height / 720), MIN_ZOOM, 1.05);
    zoom = scale;
    const bounds = getStageBounds(window.CanvasWorkflows?.getWorkflow?.());
    panX = (rect.width - bounds.width * zoom) / 2 - bounds.minX * zoom;
    panY = (rect.height - bounds.height * zoom) / 2 - bounds.minY * zoom;
    applyTransform();
  }

  function setZoom(nextZoom) {
    zoom = clamp(nextZoom, MIN_ZOOM, MAX_ZOOM);
    applyTransform();
  }

  function updateToolbarTitle() {
    const title = document.getElementById('canvasToolbarTitle');
    if (!title) return;
    const workflow = getVisibleWorkflow();
    if (workflow && (viewMode === 'design' || currentSession?.workflowExecution || !currentSession)) {
      const workCount = workflow.nodes.filter(node => node.type === 'work').length;
      const runningCount = currentWorkers.filter(worker => worker.statusType === 'running').length;
      title.innerHTML = '<strong>' + escapeHtml(workflow.name || '未命名工作流') + '</strong><span>' +
        (currentSession ? `${runningCount} 个运行中 · ${workCount} 个 Work` : `${workCount} 个 Work`) +
        '</span>';
      return;
    }
    if (!currentWorkers.length) {
      title.innerHTML = '<span>暂无运行中的多 Agent 协作</span>';
      return;
    }
    const names = currentWorkers.map(worker => worker.name).join('、');
    title.innerHTML = '<strong>' + currentWorkers.length + ' 个 worker：</strong><span>' + escapeHtml(names) + '</span>';
  }

  function createEmptyState() {
    const empty = document.createElement('section');
    empty.className = 'canvas-flow-empty';
    empty.innerHTML =
      '<div class="canvas-flow-empty-icon">' + icon('workers') + '</div>' +
      '<div class="canvas-flow-empty-title">暂无协作任务</div>' +
      '<div class="canvas-flow-empty-text">发起多 Agent 协作后，真实执行节点会显示在这里</div>';
    return empty;
  }

  function createTaskCard() {
    const card = document.createElement('section');
    card.className = 'canvas-flow-card canvas-flow-task';
    card.innerHTML =
      '<div class="canvas-flow-card-head">' +
        '<div class="canvas-flow-avatar">' + icon('user') + '</div>' +
        '<div>' +
          '<div class="canvas-flow-card-title">你的任务</div>' +
          '<div class="canvas-flow-subtitle">对话发起</div>' +
        '</div>' +
      '</div>' +
      '<div class="canvas-flow-summary">' + escapeHtml(getSessionTaskSummary()) + '</div>';
    return card;
  }

  function createWorkerCard(worker, offset = getRenderOffset()) {
    const card = document.createElement('section');
    card.className = 'canvas-flow-card canvas-flow-worker';
    card.dataset.nodeId = worker.nodeId || worker.key;
    card.dataset.status = worker.statusType;
    card.style.left = (worker.left + offset.x) + 'px';
    card.style.top = (worker.top + offset.y) + 'px';
    const noteClass = worker.statusType === 'error'
      ? 'canvas-flow-error'
      : worker.statusType === 'running'
        ? 'canvas-flow-writing'
        : 'canvas-flow-muted';
    card.innerHTML =
      '<div class="canvas-flow-card-head">' +
        '<div class="canvas-flow-avatar">' + escapeHtml(worker.mark) + '</div>' +
        '<div class="canvas-flow-card-title">' + escapeHtml(worker.name) + '</div>' +
      '</div>' +
      '<div class="canvas-flow-status canvas-flow-status-' + escapeHtml(worker.statusType) + '"><span class="canvas-flow-status-dot"></span>' + escapeHtml(worker.status) + '</div>' +
      '<div class="canvas-flow-note ' + noteClass + '">' + escapeHtml(worker.note) + '</div>' +
      (worker.statusType === 'error'
        ? '<button type="button" class="canvas-flow-retry" data-retry-node="' + escapeHtml(worker.nodeId || worker.key) + '" title="重试此节点">' + icon('retry') + '<span>重试</span></button>'
        : '');
    return card;
  }

  function getRuntimeWorker(nodeId) {
    return currentWorkers.find(worker => String(worker.nodeId || worker.key) === String(nodeId)) || null;
  }

  function getVisibleWorkflow() {
    if (currentSession?.workflowExecution && currentSession?.workflow) return currentSession.workflow;
    return window.CanvasWorkflows?.getWorkflow?.() || null;
  }

  function createWorkflowNodeCard(node, offset = getRenderOffset()) {
    const runtime = getRuntimeWorker(node.id);
    const card = document.createElement('section');
    card.className = 'canvas-workflow-node canvas-workflow-node-' + node.type;
    if (runtime && RUNNING_STATUSES.has(runtime.rawStatus || runtime.statusType)) card.classList.add('is-running');
    if (selectedNodeId === node.id) card.classList.add('is-selected');
    card.dataset.nodeId = node.id;
    card.dataset.nodeType = node.type;
    card.dataset.status = runtime?.statusType || 'idle';
    card.style.left = (Number(node.x || 0) + offset.x) + 'px';
    card.style.top = (Number(node.y || 0) + offset.y) + 'px';
    const modelText = node.type === 'work'
      ? (node.modelName || '跟随当前模型')
      : (node.type === 'input' ? '接收用户输入' : '整理最终交付');
    const description = runtime?.note || node.task || node.outputRule ||
      (node.type === 'work' ? '在右侧检查器中配置任务' : node.type === 'input' ? '定义工作流目标和输入' : '汇总上游节点结果');
    card.innerHTML =
      '<div class="canvas-workflow-node-head">' +
        '<span class="canvas-workflow-node-kind">' + (node.type === 'work' ? 'WORK' : node.type === 'input' ? 'IN' : 'OUT') + '</span>' +
        '<strong>' + escapeHtml(node.name) + '</strong>' +
      '</div>' +
      '<div class="canvas-workflow-node-model">' + escapeHtml(modelText) + '</div>' +
      '<div class="canvas-workflow-node-task">' + escapeHtml(compactText(description, 92)) + '</div>' +
      (runtime
        ? '<div class="canvas-workflow-node-status canvas-flow-status-' + escapeHtml(runtime.statusType) + '"><span></span>' + escapeHtml(runtime.status) + '</div>'
        : '') +
      (runtime?.statusType === 'error'
        ? '<button type="button" class="canvas-workflow-node-retry" data-retry-node="' + escapeHtml(runtime.nodeId || runtime.key) + '" title="重试此 Work">' + icon('retry') + '</button>'
        : '');
    return card;
  }

  function dot(x, y) {
    const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    circle.setAttribute('cx', x);
    circle.setAttribute('cy', y);
    circle.setAttribute('r', '7');
    return circle;
  }

  function createLines(bounds = null, offset = null) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'canvas-flow-lines');
    const currentBounds = bounds || getStageBounds();
    const currentOffset = offset || getRenderOffset(currentBounds);
    svg.setAttribute('viewBox', `0 0 ${currentBounds.width} ${currentBounds.height}`);
    const taskSource = {
      x: FLOW_TASK_LEFT + FLOW_TASK_WIDTH,
      y: FLOW_TASK_TOP + FLOW_TASK_HEIGHT / 2
    };
    const workerPoints = currentWorkers.map(function (worker, index) {
      return {
        x: Number(worker.left || FLOW_WORKER_LEFT) + currentOffset.x,
        y: Number(worker.top || 0) + FLOW_WORKER_HEIGHT / 2 + currentOffset.y,
        index
      };
    });
    if (!workerPoints.length) return svg;
    const firstWorkerX = Math.min(...workerPoints.map(point => point.x));
    const hubX = Math.min(taskSource.x + 110, firstWorkerX - 90);
    const hub = {
      x: Math.max(taskSource.x, hubX),
      y: taskSource.y
    };
    const trunk = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    trunk.setAttribute('class', 'canvas-flow-worker-link canvas-flow-worker-link-trunk' +
      (currentWorkers.some(worker => RUNNING_STATUSES.has(worker.rawStatus || worker.statusType)) ? ' is-running' : ''));
    trunk.setAttribute('d', 'M ' + taskSource.x + ' ' + taskSource.y + ' L ' + hub.x + ' ' + hub.y);
    svg.appendChild(trunk);
    svg.appendChild(dot(taskSource.x, taskSource.y));
    svg.appendChild(dot(hub.x, hub.y));
    workerPoints.forEach(function (point) {
      const curve = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      const worker = currentWorkers[point.index];
      const horizontalDistance = Math.max(160, point.x - hub.x);
      const bend = Math.max(78, Math.min(160, horizontalDistance * 0.46));
      curve.setAttribute('class', 'canvas-flow-worker-link canvas-flow-worker-link-' + point.index +
        (worker && RUNNING_STATUSES.has(worker.rawStatus || worker.statusType) ? ' is-running' : ''));
      curve.setAttribute(
        'd',
        'M ' + hub.x + ' ' + hub.y +
        ' C ' + (hub.x + bend) + ' ' + hub.y +
        ', ' + (point.x - bend) + ' ' + point.y +
        ', ' + point.x + ' ' + point.y
      );
      svg.appendChild(curve);
      svg.appendChild(dot(point.x, point.y));
    });
    return svg;
  }

  function createWorkflowLines(workflow) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'canvas-flow-lines canvas-workflow-lines');
    const bounds = getStageBounds(workflow);
    const offset = getRenderOffset(bounds);
    svg.setAttribute('viewBox', `0 0 ${bounds.width} ${bounds.height}`);
    const nodes = new Map((workflow.nodes || []).map(node => [node.id, node]));
    const runningNodeIds = new Set(currentWorkers
      .filter(worker => RUNNING_STATUSES.has(worker.rawStatus || worker.statusType))
      .map(worker => String(worker.nodeId || worker.key)));
    (workflow.edges || []).forEach(function (edge) {
      const source = nodes.get(edge.source);
      const target = nodes.get(edge.target);
      if (!source || !target) return;
      const startX = Number(source.x || 0) + offset.x + NODE_WIDTH;
      const startY = Number(source.y || 0) + offset.y + NODE_HEIGHT / 2;
      const endX = Number(target.x || 0) + offset.x;
      const endY = Number(target.y || 0) + offset.y + NODE_HEIGHT / 2;
      const bend = Math.max(70, Math.abs(endX - startX) * 0.42);
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      if (runningNodeIds.has(String(edge.target))) path.classList.add('is-running');
      path.setAttribute('d', `M ${startX} ${startY} C ${startX + bend} ${startY}, ${endX - bend} ${endY}, ${endX} ${endY}`);
      svg.appendChild(path);
      svg.appendChild(dot(startX, startY));
      svg.appendChild(dot(endX, endY));
    });
    return svg;
  }

  function createControls() {
    const controls = document.createElement('div');
    controls.className = 'canvas-flow-controls';
    controls.innerHTML =
      '<div class="canvas-flow-control-group">' +
        '<button class="canvas-flow-control" type="button" data-action="workers" title="Worker 视图">' + icon('workers') + '</button>' +
      '</div>' +
      '<div class="canvas-flow-control-group">' +
        '<button class="canvas-flow-control" type="button" data-action="zoom-in" title="放大">' + icon('plus') + '</button>' +
        '<button class="canvas-flow-control" type="button" data-action="zoom-out" title="缩小">' + icon('minus') + '</button>' +
        '<button class="canvas-flow-control" type="button" data-action="fit" title="适配视图">' + icon('fit') + '</button>' +
      '</div>';
    controls.addEventListener('click', function (event) {
      const button = event.target.closest('button[data-action]');
      if (!button) return;
      const action = button.getAttribute('data-action');
      if (action === 'zoom-in') setZoom(zoom + 0.1);
      if (action === 'zoom-out') setZoom(zoom - 0.1);
      if (action === 'fit' || action === 'workers') fitView();
    });
    return controls;
  }

  function isWorkflowRunning() {
    return currentSession?.workflowExecution === true &&
      !TERMINAL_STATUSES.has(String(currentSession.status || '')) &&
      !ERROR_STATUSES.has(String(currentSession.status || ''));
  }

  function isWorkflowSessionLocked() {
    return !!(currentSession?.workflowExecution && isWorkflowRunning());
  }

  function isCollaborationActive() {
    return !!currentSession?.id &&
      !TERMINAL_STATUSES.has(String(currentSession.status || '')) &&
      !ERROR_STATUSES.has(String(currentSession.status || ''));
  }

  function createWorkflowActions() {
    const actions = document.createElement('div');
    actions.className = 'canvas-workflow-actions';
    actions.innerHTML =
      '<div class="canvas-workflow-mode">' +
        '<button type="button" data-workflow-action="new">新增</button>' +
        '<button type="button" data-workflow-action="clear">清空</button>' +
      '</div>' +
      '<select class="canvas-workflow-select" data-workflow-select title="选择已启用工作流"></select>' +
      '<button type="button" data-workflow-action="add">+ Work</button>' +
      '<button type="button" data-workflow-action="save">保存</button>' +
      '<button type="button" class="is-danger" data-workflow-action="stop-all">全部停止</button>' +
      '<button type="button" class="is-primary" data-workflow-action="run">运行</button>';
    actions.addEventListener('change', async function (event) {
      const select = event.target.closest('[data-workflow-select]');
      if (!select || !select.value) return;
      try {
        select.disabled = true;
        viewMode = 'design';
        await window.CanvasWorkflows.selectWorkflow(select.value);
        selectedNodeId = '';
        renderStageContent();
        window.ToastUI?.show?.('已切换工作流设计', 'success');
      } catch (error) {
        window.ToastUI?.show?.(error?.message || '工作流切换失败', 'error');
      } finally {
        select.disabled = false;
      }
    });
    actions.addEventListener('click', async function (event) {
      const button = event.target.closest('[data-workflow-action]');
      if (!button) return;
      const action = button.dataset.workflowAction;
      try {
        button.disabled = true;
        if (action === 'new') {
          viewMode = 'design';
          window.CanvasWorkflows.createNewWorkflow();
          selectedNodeId = '';
          renderStageContent();
          window.ToastUI?.show?.('已新建工作流设计', 'success');
        }
        if (action === 'clear') {
          viewMode = 'design';
          window.CanvasWorkflows.clearDesign();
          selectedNodeId = '';
          renderStageContent();
          window.ToastUI?.show?.('当前工作流设计已清空', 'success');
        }
        if (action === 'add') {
          viewMode = 'design';
          const node = window.CanvasWorkflows.addWork(selectedNodeId);
          selectedNodeId = node.id;
          renderStageContent();
          openNodeInspector(node.id);
        }
        if (action === 'save') {
          await window.CanvasWorkflows.save();
          window.ToastUI?.show?.('工作流已保存', 'success');
          renderStageContent();
        }
        if (action === 'run') {
          if (isWorkflowRunning()) throw new Error('当前工作流仍在运行');
          if (currentSession && !currentSession.workflowExecution) throw new Error('当前画布正在显示多 agent 协作，不能同时运行自定义工作流');
          currentSession = await window.CanvasWorkflows.run();
          currentWorkers = normalizeSessionWorkers(currentSession);
          viewMode = 'runtime';
          renderStageContent();
          window.ToastUI?.show?.('工作流已在画布中启动', 'success');
        }
        if (action === 'stop-all') {
          if (!isCollaborationActive()) throw new Error('当前没有运行中的协作任务');
          const projectId = window.ProjectStore?.getActiveProjectId?.() || currentSession.projectId || '';
          const result = await window.api?.stopAgentCollaborationAll?.(projectId, currentSession.id, '用户从画布停止全部节点');
          if (!result?.success) throw new Error(result?.error || '全部停止失败');
          window.ToastUI?.show?.('已请求停止全部节点', 'success');
        }
      } catch (error) {
        window.ToastUI?.show?.(error?.message || '画布操作失败', 'error');
      } finally {
        button.disabled = false;
      }
    });
    return actions;
  }

  function syncWorkflowActions() {
    const actions = root?.querySelector('.canvas-workflow-actions');
    if (!actions) return;
    actions.querySelector('[data-workflow-action="new"]')?.classList.toggle('is-active', viewMode === 'design' && !currentSession);
    const workflow = getVisibleWorkflow();
    const workflowItems = window.CanvasWorkflows?.getWorkflowItems?.() || [];
    const select = actions.querySelector('[data-workflow-select]');
    if (select) {
      let hasSavedWorkflow = false;
      const enabledWorkflowItems = [];
      for (const item of workflowItems) {
        if (workflow?.id && item.id === workflow.id) hasSavedWorkflow = true;
        if (item.enabled !== false) enabledWorkflowItems.push(item);
      }
      const runtimeWorkflowOnly = !!(isWorkflowRunning() && workflow?.id && !hasSavedWorkflow);
      const visibleWorkflowItems = runtimeWorkflowOnly
        ? [{ id: workflow.id, name: workflow.name || '当前运行的工作流' }]
        : enabledWorkflowItems;
      const currentId = workflow?.id || '';
      const options = visibleWorkflowItems.length
        ? visibleWorkflowItems.map(item => '<option value="' + escapeHtml(item.id) + '">' + escapeHtml(item.name || '未命名工作流') + '</option>').join('')
        : '<option value="">暂无已启用工作流</option>';
      let hasVisibleCurrentWorkflow = false;
      for (const item of visibleWorkflowItems) {
        if (item.id === currentId) hasVisibleCurrentWorkflow = true;
      }
      select.innerHTML = options;
      select.value = hasVisibleCurrentWorkflow ? currentId : '';
      select.disabled = !workflowReady || !visibleWorkflowItems.length || isWorkflowSessionLocked();
    }
    ['add', 'save', 'new', 'clear', 'run'].forEach(function (action) {
      const button = actions.querySelector(`[data-workflow-action="${action}"]`);
      if (button) button.disabled = !workflowReady || isWorkflowSessionLocked();
    });
    const runButton = actions.querySelector('[data-workflow-action="run"]');
    if (runButton) runButton.disabled = !workflowReady || isWorkflowRunning() || !!(currentSession && !currentSession.workflowExecution);
    const stopAllButton = actions.querySelector('[data-workflow-action="stop-all"]');
    if (stopAllButton) stopAllButton.disabled = !isCollaborationActive();
  }

  function openNodeInspector(nodeId) {
    if (!nodeId) return;
    selectedNodeId = nodeId;
    window.showCanvasInspector?.({ nodeId, session: currentSession });
  }

  function renderStageContent() {
    if (!stage) return;
    stage.innerHTML = '';
    const workflow = getVisibleWorkflow();
    const showWorkflow = !!workflow && (viewMode === 'design' || currentSession?.workflowExecution || !currentSession);
    applyStageBounds(showWorkflow ? workflow : null);
    if (showWorkflow) {
      stage.appendChild(createWorkflowLines(workflow));
      workflow.nodes.forEach(node => stage.appendChild(createWorkflowNodeCard(node)));
      updateToolbarTitle();
      syncWorkflowActions();
      return;
    }
    if (!currentSession && !currentWorkers.length) {
      stage.appendChild(createEmptyState());
      updateToolbarTitle();
      syncWorkflowActions();
      return;
    }
    const bounds = applyStageBounds(null);
    const offset = getRenderOffset(bounds);
    stage.appendChild(createLines(bounds, offset));
    stage.appendChild(createTaskCard());
    currentWorkers.forEach(worker => stage.appendChild(createWorkerCard(worker, offset)));
    updateToolbarTitle();
    syncWorkflowActions();
  }

  function onWheel(event) {
    event.preventDefault();
    const oldZoom = zoom;
    const delta = event.deltaY > 0 ? -0.08 : 0.08;
    zoom = clamp(zoom + delta, MIN_ZOOM, MAX_ZOOM);
    const rect = viewport.getBoundingClientRect();
    const mouseX = event.clientX - rect.left;
    const mouseY = event.clientY - rect.top;
    panX = mouseX - (mouseX - panX) * (zoom / oldZoom);
    panY = mouseY - (mouseY - panY) * (zoom / oldZoom);
    applyTransform();
  }

  function onMouseDown(event) {
    if (event.button !== 0 || event.target.closest('button')) return;
    const node = event.target.closest('[data-node-id]');
    if (node) {
      const nodeId = node.dataset.nodeId;
      if (event.detail >= 2) {
        event.preventDefault();
        event.stopPropagation();
        openNodeInspector(nodeId);
        return;
      }
      selectedNodeId = nodeId;
      stage?.querySelectorAll('.is-selected').forEach(item => item.classList.remove('is-selected'));
      node.classList.add('is-selected');
      if (node.classList.contains('canvas-workflow-node')) {
        draggedNodeId = nodeId;
        hasDraggedNode = false;
        dragStartX = event.clientX;
        dragStartY = event.clientY;
        const workflowNode = window.CanvasWorkflows?.getNode?.(nodeId);
        dragNodeX = Number(workflowNode?.x || 0);
        dragNodeY = Number(workflowNode?.y || 0);
        node.classList.add('is-dragging');
      }
      return;
    }
    isPanning = true;
    viewport.classList.add('is-panning');
    panStartX = event.clientX;
    panStartY = event.clientY;
    panBaseX = panX;
    panBaseY = panY;
  }

  function onMouseMove(event) {
    if (draggedNodeId) {
      const nodeEl = stage?.querySelector(`[data-node-id="${CSS.escape(draggedNodeId)}"]`);
      if (!nodeEl) return;
      const moved = Math.abs(event.clientX - dragStartX) > 3 || Math.abs(event.clientY - dragStartY) > 3;
      if (moved) hasDraggedNode = true;
      const nextX = dragNodeX + (event.clientX - dragStartX) / zoom;
      const nextY = dragNodeY + (event.clientY - dragStartY) / zoom;
      const offset = getRenderOffset();
      nodeEl.style.left = (nextX + offset.x) + 'px';
      nodeEl.style.top = (nextY + offset.y) + 'px';
      nodeEl.dataset.dragX = String(Math.round(nextX));
      nodeEl.dataset.dragY = String(Math.round(nextY));
      return;
    }
    if (!isPanning) return;
    panX = panBaseX + (event.clientX - panStartX);
    panY = panBaseY + (event.clientY - panStartY);
    applyTransform();
  }

  function onMouseUp() {
    if (draggedNodeId) {
      const completedNodeId = draggedNodeId;
      const shouldSavePosition = hasDraggedNode;
      const nodeEl = stage?.querySelector(`[data-node-id="${CSS.escape(draggedNodeId)}"]`);
      const x = Number(nodeEl?.dataset.dragX);
      const y = Number(nodeEl?.dataset.dragY);
      nodeEl?.classList.remove('is-dragging');
      if (shouldSavePosition && Number.isFinite(x) && Number.isFinite(y)) {
        window.CanvasWorkflows?.updateNode?.(completedNodeId, { x, y });
      }
      draggedNodeId = '';
      hasDraggedNode = false;
      if (shouldSavePosition) renderStageContent();
      return;
    }
    if (!isPanning) return;
    isPanning = false;
    if (viewport) viewport.classList.remove('is-panning');
  }

  function onDoubleClick(event) {
    const node = event.target.closest('[data-node-id]');
    if (!node) return;
    event.preventDefault();
    event.stopPropagation();
    selectedNodeId = node.dataset.nodeId;
    stage?.querySelectorAll('.is-selected').forEach(item => item.classList.remove('is-selected'));
    node.classList.add('is-selected');
    openNodeInspector(node.dataset.nodeId);
  }

  async function retryNode(nodeId, button = null) {
    const agent = currentSession?.agents?.find(item => String(item.nodeId || item.id) === String(nodeId))
    if (!currentSession?.id || !agent?.id) throw new Error('没有找到此节点对应的运行实例')
    const projectId = window.ProjectStore?.getActiveProjectId?.() || currentSession.projectId || ''
    if (button) button.disabled = true
    try {
      const result = await window.api?.retryAgentCollaborationAi?.(projectId, currentSession.id, agent.id)
      if (!result?.success) throw new Error(result?.error || '节点重试失败')
      if (result.session) updateSession(result.session)
      window.ToastUI?.show?.(`已重试 ${agent.name || agent.role || '此节点'}`, 'success')
    } finally {
      if (button?.isConnected) button.disabled = false
    }
  }

  function onCanvasAction(event) {
    const retryButton = event.target.closest('[data-retry-node]')
    if (!retryButton) return
    event.preventDefault()
    event.stopPropagation()
    retryNode(retryButton.dataset.retryNode, retryButton).catch(error => {
      window.ToastUI?.show?.(error?.message || '节点重试失败', 'error')
    })
  }

  function render() {
    root = document.createElement('div');
    root.className = 'canvas-flow-root';
    viewport = document.createElement('div');
    viewport.className = 'canvas-flow-viewport';
    stage = document.createElement('div');
    stage.className = 'canvas-flow-stage';
    renderStageContent();
    viewport.appendChild(stage);
    root.appendChild(viewport);
    root.appendChild(createControls());
    root.appendChild(createWorkflowActions());
    container.appendChild(root);
    viewport.addEventListener('wheel', onWheel, { passive: false });
    viewport.addEventListener('mousedown', onMouseDown);
    viewport.addEventListener('dblclick', onDoubleClick);
    viewport.addEventListener('click', onCanvasAction);
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
    window.addEventListener('resize', fitView);
    requestAnimationFrame(fitView);
  }

  function updateSession(session) {
    if (!session || !session.id) return;
    const mergedSession = currentSession && currentSession.id === session.id
      ? {
          ...currentSession,
          ...session,
          workflowExecution: session.workflowExecution || currentSession.workflowExecution,
          executionKind: session.executionKind || currentSession.executionKind,
          workflow: session.workflow || currentSession.workflow || null
        }
      : session;
    currentSession = mergedSession;
    currentWorkers = normalizeSessionWorkers(mergedSession);
    viewMode = 'runtime';
    renderStageContent();
    window.CanvasInspector?.refresh?.(mergedSession);
  }

  function init(containerEl) {
    if (!containerEl) return;
    if (container === containerEl && root) {
      renderStageContent();
      return;
    }
    destroy();
    container = containerEl;
    render();
    if (!workflowEventsBound) {
      workflowEventsBound = true;
      window.addEventListener('lingxi:active-project-changed', handleProjectChange);
      window.addEventListener('lingxi:canvas-workflow-changed', refreshWorkflow);
    }
    window.CanvasWorkflows?.load?.().then(function () {
      if (!stage) return;
      workflowReady = true;
      currentSession = null;
      currentWorkers = [];
      viewMode = 'design';
      selectedNodeId = '';
      renderStageContent();
      requestAnimationFrame(fitView);
    }).catch(function (error) {
      window.ToastUI?.show?.(error?.message || '工作流加载失败', 'error');
    });
  }

  function handleProjectChange() {
    currentSession = null;
    currentWorkers = [];
    viewMode = 'design';
    selectedNodeId = '';
    workflowReady = false;
    window.closeCanvasInspector?.();
    window.CanvasWorkflows?.load?.().then(function () {
      workflowReady = true;
      refreshWorkflow();
    }).catch(function () {});
  }

  function refreshWorkflow() {
    if (!stage) return;
    renderStageContent();
  }

  function destroy() {
    window.CanvasWorkflows?.flushPendingSave?.()?.catch?.(function () {});
    window.CanvasInspector?.destroy?.();
    if (viewport) {
      viewport.removeEventListener('wheel', onWheel);
      viewport.removeEventListener('mousedown', onMouseDown);
      viewport.removeEventListener('dblclick', onDoubleClick);
      viewport.removeEventListener('click', onCanvasAction);
    }
    document.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('mouseup', onMouseUp);
    window.removeEventListener('resize', fitView);
    if (root && root.parentNode) root.parentNode.removeChild(root);
    container = null;
    root = null;
    viewport = null;
    stage = null;
    isPanning = false;
    draggedNodeId = '';
    currentSession = null;
    currentWorkers = [];
    selectedNodeId = '';
  }

  window.CanvasView = {
    init,
    destroy,
    fitView,
    updateSession,
    refreshWorkflow,
    getSession: function () { return currentSession; },
    getZoom: function () { return zoom; },
    setZoom,
    onBack: null
  };
})();
