(function () {
  'use strict'

  const state = {
    container: null,
    payload: null,
    interactionDepth: 0,
    pendingSession: null,
    refreshTimer: null
  }

  const RUNNING_STATUSES = new Set(['waiting', 'queued', 'running', 'thinking', 'using_tools', 'streaming', 'active', 'working', 'running_with_errors'])

  function escapeHtml(value = '') {
    if (window.HtmlUtils?.escapeHtml) return window.HtmlUtils.escapeHtml(value)
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;')
  }

  function showToast(message, type = 'info') {
    window.ToastUI?.show?.(message, type)
  }

  async function openReportFile(filePath = '') {
    const targetPath = String(filePath || '').trim()
    if (!targetPath) return
    try {
      let result = await window.api?.openProjectFolder?.(targetPath)
      if (!result?.success && window.api?.showItemInFolder) {
        result = await window.api.showItemInFolder(targetPath)
      }
      if (!result?.success) showToast(result?.error || '交付文件打开失败', 'error')
    } catch (error) {
      showToast(error?.message || '交付文件打开失败', 'error')
    }
  }

  function getModels() {
    return window.ModelStore?.getModels?.() || []
  }

  function getModelKey(model = {}) {
    return String(model.modelKey || model.id || model.key || model.name || model.model || '')
  }

  function getModelName(model = {}) {
    return String(model.displayName || model.modelName || model.modelId || model.name || '未命名模型')
  }

  function getAgent(session, nodeId) {
    return Array.isArray(session?.agents)
      ? session.agents.find(agent => agent.nodeId === nodeId || agent.id === nodeId) || null
      : null
  }

  function getStatusLabel(status = '') {
    const labels = {
      waiting: '等待上游',
      queued: '排队中',
      running: '执行中',
      thinking: '思考中',
      using_tools: '调用工具',
      done: '已完成',
      completed: '已完成',
      error: '失败',
      failed: '失败',
      timeout: '超时',
      interrupted: '已停止'
    }
    return labels[status] || status || '未运行'
  }

  function isAgentRunning(agent = null) {
    return !!agent && RUNNING_STATUSES.has(String(agent.status || ''))
  }

  function isAgentRetryable(agent = null) {
    return !!agent && ['error', 'failed', 'timeout', 'interrupted'].includes(String(agent.status || ''))
  }

  function isEditingElement(element) {
    const tagName = String(element?.tagName || '').toLowerCase()
    return tagName === 'select' || tagName === 'input' || tagName === 'textarea'
  }

  function normalizeEvents(events = []) {
    return (Array.isArray(events) ? events : []).map((event, index) => {
      if (typeof event === 'string') {
        return { id: `event-${index + 1}`, content: event, createdAt: index }
      }
      return {
        id: event?.id || event?.toolCallId || event?.tool_call_id || `event-${index + 1}`,
        type: event?.type || 'status',
        title: event?.title || event?.name || event?.status || '',
        name: event?.name || event?.toolName || event?.title || '',
        content: event?.content || event?.text || event?.message || event?.detail || '',
        args: event?.args && typeof event.args === 'object' ? event.args : {},
        result: event?.result && typeof event.result === 'object' ? event.result : null,
        toolCallId: event?.toolCallId || event?.tool_call_id || event?.id || '',
        status: event?.status || '',
        createdAt: event?.createdAt || event?.time || index
      }
    })
  }

  function getEventTime(event = {}) {
    const numeric = Number(event.createdAt || 0)
    if (Number.isFinite(numeric) && numeric > 0) return numeric
    const parsed = Date.parse(event.createdAt || event.time || '')
    return Number.isFinite(parsed) ? parsed : 0
  }

  function isToolRunning(event = {}) {
    const status = String(event.status || '').toLowerCase()
    return ['queued', 'running', 'active', 'working', 'pending'].includes(status)
  }

  function isToolError(event = {}) {
    const status = String(event.status || '').toLowerCase()
    return ['error', 'failed', 'timeout'].includes(status) || event.result?.success === false || !!event.result?.error
  }

  function compactText(value = '', limit = 800) {
    const text = String(value || '').replace(/\s+/g, ' ').trim()
    return text.length > limit ? `${text.slice(0, limit)}...` : text
  }

  function getThinkingDisplayText(event = {}, agent = {}) {
    const raw = event.content || event.title || agent.statusText || '正在处理'
    const summarized = window.AiMessageUI?.summarizeThinkingStatus?.(raw) || compactText(raw, 180)
    return window.AiMessageUI?.clipAtSentence?.(summarized, 180) || summarized
  }

  function renderThinkingEvents(agent = {}) {
    const events = normalizeEvents(agent.thinking || agent.thoughts || [])
      .map(event => ({ ...event, content: getThinkingDisplayText(event, agent) }))
      .filter(event => event.content && (window.AiMessageUI?.shouldDisplayThinkingStatus?.(event.content) ?? event.content.length > 4))
    if (!events.length) return ''
    const active = isAgentRunning(agent)
    return `
      <div class="ai-work-segment">
        <div class="ai-thinking-block ${active ? 'active' : 'stopped'}">
          <span class="ai-thinking-pulse-icon">
            <span class="pulse-ring"></span>
            <svg class="pulse-core" viewBox="0 0 16 16" width="14" height="14"><path d="M8 0 L9.2 6.8 L16 8 L9.2 9.2 L8 16 L6.8 9.2 L0 8 L6.8 6.8 Z" fill="currentColor"/></svg>
          </span>
          <div class="ai-thinking-header-row ${active ? '' : 'stopped'}">
            <div class="ai-thinking-timeline">
              ${events.map((event, index) => `
                <div class="ai-thinking-line ${active && index === events.length - 1 ? 'active' : ''}">
                  <span class="ai-thinking-status">${escapeHtml(event.content)}</span>
                </div>
              `).join('')}
            </div>
          </div>
        </div>
      </div>
    `
  }

  function createToolResult(event = {}) {
    if (event.result) return event.result
    if (isToolError(event)) return { success: false, error: event.content || event.title || '工具调用失败' }
    return { success: true, message: event.content || event.title || '工具调用完成' }
  }

  function renderToolsWithChatUi(agent = {}, session = {}) {
    const tools = normalizeEvents(agent.tools || agent.toolCalls || [])
      .filter(event => event.name || event.title)
      .sort((a, b) => getEventTime(a) - getEventTime(b))
    if (!tools.length || !window.AiToolRenderer?.bind) return ''

    const proxyMsg = document.createElement('div')
    proxyMsg.className = 'message ai'
    proxyMsg.innerHTML = '<div class="ai-dynamic-area"></div>'
    const stats = { modified: [], created: [], read: [], commands: [] }
    const renderer = window.AiToolRenderer.bind({
      getCurrentAiMsg: () => proxyMsg,
      getCurrentProjectPath: () => session?.projectPath || '',
      getOpIcons: () => window.AiMessageUI?.opIcons || {},
      getOpTypes: () => window.AiMessageUI?.opTypes || {},
      getFileName: path => window.AiMessageUI?.getFileName?.(path) || String(path || '').split(/[\\/]/).slice(-2).join('/'),
      calculateEditLines: (...args) => window.AiMessageUI?.calculateEditLines?.(...args) || { add: 0, remove: 0, modified: false },
      sanitizeContent: content => window.AiMessageUI?.sanitizeAiContent?.(content) || escapeHtml(content)
    })

    tools.forEach(event => {
      const name = event.name || event.title || 'tool'
      const meta = { toolCallId: event.toolCallId || event.id || '', agentRole: agent.role || agent.name || '' }
      if (isToolRunning(event)) {
        renderer.preShowOperation?.(name, event.args || {}, meta)
      } else {
        renderer.addOperation?.(name, event.args || {}, createToolResult(event), stats, meta)
      }
    })

    const keepActive = isAgentRunning(agent)
    proxyMsg.querySelectorAll('.tool-call-group').forEach(group => {
      group.dataset.active = keepActive ? (group.dataset.active || 'true') : 'false'
    })
    return proxyMsg.querySelector('.ai-dynamic-area')?.innerHTML || ''
  }

  function renderRuntimeDynamicArea(session, agent) {
    const thinkingHtml = renderThinkingEvents(agent)
    const toolsHtml = renderToolsWithChatUi(agent, session)
    if (!thinkingHtml && !toolsHtml) return '<div class="canvas-inspector-muted">暂时没有工具或思考更新</div>'
    return `
      <div class="canvas-inspector-runtime-message">
        <div class="ai-dynamic-area">
          ${thinkingHtml}${toolsHtml}
        </div>
      </div>
    `
  }

  function getVisibleWorkflow(session) {
    return session?.workflow || window.CanvasWorkflows?.getWorkflow?.() || null
  }

  function scheduleDeferredRefresh() {
    clearTimeout(state.refreshTimer)
    state.refreshTimer = setTimeout(() => {
      if (!state.container || !state.payload || state.interactionDepth > 0) return
      const session = state.pendingSession || state.payload.session
      state.pendingSession = null
      if (updateRuntimeAreas(session)) {
        state.payload = { ...state.payload, session }
        return
      }
      render(state.container, { ...state.payload, session })
    }, 140)
  }

  function renderRuntime(session, agent) {
    if (!session || !agent) return ''
    const reportPath = agent.reportFilePath || ''
    return `
      <section class="canvas-inspector-section canvas-inspector-runtime">
        <div class="canvas-inspector-section-head">
          <h3>运行状态</h3>
          <span class="canvas-inspector-status" data-status="${escapeHtml(agent.status || '')}">${escapeHtml(getStatusLabel(agent.status))}</span>
        </div>
        <div class="canvas-inspector-progress">${escapeHtml(agent.statusText || '等待执行信息')}</div>
        ${renderRuntimeDynamicArea(session, agent)}
        ${reportPath ? `<button type="button" class="canvas-inspector-link" data-open-report="${escapeHtml(reportPath)}">打开交付文件</button>` : ''}
      </section>
    `
  }

  function renderRuntimeShell(session, agent) {
    return `<div data-inspector-runtime>${renderRuntime(session, agent)}</div>`
  }

  function renderTopActions(agent) {
    if (isAgentRunning(agent)) {
      return '<button type="button" class="canvas-inspector-danger canvas-inspector-top-stop" data-stop-node>停止此节点</button>'
    }
    if (isAgentRetryable(agent)) {
      return '<button type="button" class="canvas-inspector-retry canvas-inspector-top-retry" data-retry-node>重试此节点</button>'
    }
    return ''
  }

  function renderWorkflowFields(workflow, node) {
    if (node.type === 'input') {
      return `
        <label class="canvas-inspector-field">
          <span>工作流名称</span>
          <input type="text" data-field="workflowName" value="${escapeHtml(workflow.name || '')}" maxlength="160">
        </label>
        <label class="canvas-inspector-field">
          <span>工作流说明</span>
          <textarea data-field="workflowDescription" rows="5" placeholder="说明输入、目标和交付边界">${escapeHtml(workflow.description || '')}</textarea>
        </label>
      `
    }

    const incomingIds = new Set((workflow.edges || []).filter(edge => edge.target === node.id).map(edge => edge.source))
    const possibleSources = workflow.nodes.filter(item => item.id !== node.id && item.type !== 'output')

    if (node.type === 'output') {
      return `
        <label class="canvas-inspector-field">
          <span>节点名称</span>
          <input type="text" data-field="name" value="${escapeHtml(node.name || '')}" maxlength="120">
        </label>
        <label class="canvas-inspector-field">
          <span>交付规则</span>
          <textarea data-field="outputRule" rows="7" placeholder="说明最终结果应如何整理或写入">${escapeHtml(node.outputRule || '')}</textarea>
        </label>
        <fieldset class="canvas-inspector-upstream">
          <legend>上游输入</legend>
          ${possibleSources.map(source => `
            <label>
              <input type="checkbox" data-upstream="${escapeHtml(source.id)}" ${incomingIds.has(source.id) ? 'checked' : ''}>
              <span>${escapeHtml(source.name)}</span>
            </label>
          `).join('') || '<div class="canvas-inspector-muted">没有可连接的上游节点</div>'}
        </fieldset>
      `
    }

    const models = getModels()
    return `
      <div class="canvas-inspector-field-grid">
        <label class="canvas-inspector-field">
          <span>Work 名称</span>
          <input type="text" data-field="name" value="${escapeHtml(node.name || '')}" maxlength="120">
        </label>
        <label class="canvas-inspector-field">
          <span>执行模型</span>
          <select data-field="modelKey">
            <option value="">跟随当前模型</option>
            ${models.map(model => {
              const key = getModelKey(model)
              return `<option value="${escapeHtml(key)}" ${key === node.modelKey ? 'selected' : ''}>${escapeHtml(getModelName(model))}</option>`
            }).join('')}
          </select>
        </label>
      </div>
      <label class="canvas-inspector-field">
        <span>节点任务</span>
        <textarea data-field="task" rows="8" placeholder="明确这个 Agent 要完成什么">${escapeHtml(node.task || '')}</textarea>
      </label>
      <label class="canvas-inspector-field">
        <span>输出要求</span>
        <textarea data-field="outputRule" rows="4" placeholder="例如：输出 JSONL，并列出质量指标">${escapeHtml(node.outputRule || '')}</textarea>
      </label>
      <fieldset class="canvas-inspector-upstream">
        <legend>上游输入</legend>
        ${possibleSources.map(source => `
          <label>
            <input type="checkbox" data-upstream="${escapeHtml(source.id)}" ${incomingIds.has(source.id) ? 'checked' : ''}>
            <span>${escapeHtml(source.name)}</span>
          </label>
        `).join('') || '<div class="canvas-inspector-muted">没有可连接的上游节点</div>'}
      </fieldset>
    `
  }

  function renderRuntimeTask(agent = {}) {
    return `
      <div class="canvas-inspector-readonly">
        <span>负责模型</span>
        <strong>${escapeHtml(agent.modelName || '跟随主模型')}</strong>
      </div>
      <div class="canvas-inspector-readonly">
        <span>节点任务</span>
        <p>${escapeHtml(agent.task || '未提供任务说明')}</p>
      </div>
    `
  }

  function bind(container, workflow, node, session, agent) {
    bindCommonActions(container, session, agent)

    container.querySelector('[data-save-node]')?.addEventListener('click', async () => {
      try {
        if (node.type === 'input') {
          window.CanvasWorkflows.updateWorkflow({
            name: container.querySelector('[data-field="workflowName"]')?.value.trim() || '未命名工作流',
            description: container.querySelector('[data-field="workflowDescription"]')?.value.trim() || ''
          })
        } else {
          const patch = {
            name: container.querySelector('[data-field="name"]')?.value.trim() || node.name,
            outputRule: container.querySelector('[data-field="outputRule"]')?.value.trim() || ''
          }
          if (node.type === 'work') {
            const modelSelect = container.querySelector('[data-field="modelKey"]')
            const selectedModel = getModels().find(model => getModelKey(model) === modelSelect?.value)
            patch.task = container.querySelector('[data-field="task"]')?.value.trim() || ''
            patch.modelKey = modelSelect?.value || ''
            patch.modelName = selectedModel ? getModelName(selectedModel) : ''
          }
          if (node.type === 'work' || node.type === 'output') {
            const upstream = [...container.querySelectorAll('[data-upstream]:checked')].map(input => input.dataset.upstream)
            window.CanvasWorkflows.setIncoming(node.id, upstream)
          }
          window.CanvasWorkflows.updateNode(node.id, patch)
        }
        showToast(node.type === 'input' ? '工作流配置已应用' : '节点配置已应用', 'success')
        window.CanvasView?.refreshWorkflow?.()
      } catch (error) {
        showToast(error?.message || (node.type === 'input' ? '工作流配置应用失败' : '节点配置应用失败'), 'error')
      }
    })

    container.querySelector('[data-delete-node]')?.addEventListener('click', async () => {
      if (!window.CanvasWorkflows.removeNode(node.id)) return
      window.closeCanvasInspector?.()
      window.CanvasView?.refreshWorkflow?.()
    })

  }

  function bindCommonActions(container, session, agent) {
    container.querySelectorAll('[data-stop-node]').forEach(button => button.addEventListener('click', async () => {
      const projectId = window.ProjectStore?.getActiveProjectId?.() || session?.projectId || ''
      const result = await window.api?.stopAgentCollaborationAi?.(projectId, session?.id, agent?.id, '用户从画布停止此节点')
      if (!result?.success) showToast(result?.error || '节点停止失败', 'error')
    }))

    container.querySelectorAll('[data-retry-node]').forEach(button => button.addEventListener('click', async () => {
      const projectId = window.ProjectStore?.getActiveProjectId?.() || session?.projectId || ''
      button.disabled = true
      try {
        const result = await window.api?.retryAgentCollaborationAi?.(projectId, session?.id, agent?.id)
        if (!result?.success) throw new Error(result?.error || '节点重试失败')
        showToast(`已重试 ${agent?.name || agent?.role || '此节点'}`, 'success')
        if (result.session) window.CanvasView?.updateSession?.(result.session)
      } catch (error) {
        showToast(error?.message || '节点重试失败', 'error')
        button.disabled = false
      }
    }))

    container.querySelector('[data-open-report]')?.addEventListener('click', event => {
      const filePath = event.currentTarget.dataset.openReport
      openReportFile(filePath)
    })
  }

  function updateRuntimeAreas(session) {
    if (!state.container || !state.payload) return false
    const workflow = getVisibleWorkflow(session)
    const savedNode = workflow?.nodes?.find(item => item.id === state.payload.nodeId)
    const runtimeAgent = getAgent(session, state.payload.nodeId)
    const nodeId = savedNode?.id || runtimeAgent?.id || state.payload.nodeId
    const agent = getAgent(session, nodeId)
    if (!agent) return false
    const runtimeEl = state.container.querySelector('[data-inspector-runtime]')
    const topActions = state.container.querySelector('[data-inspector-top-actions]')
    if (!runtimeEl || !topActions) return false
    runtimeEl.innerHTML = renderRuntime(session, agent)
    topActions.innerHTML = renderTopActions(agent)
    bindCommonActions(state.container, session, agent)
    return true
  }

  function bindInteractionGuard(container) {
    if (container.dataset.inspectorInteractionGuard === 'true') return
    container.dataset.inspectorInteractionGuard = 'true'
    container.addEventListener('focusin', event => {
      if (!isEditingElement(event.target)) return
      state.interactionDepth += 1
    })
    container.addEventListener('focusout', event => {
      if (!isEditingElement(event.target)) return
      state.interactionDepth = Math.max(0, state.interactionDepth - 1)
      scheduleDeferredRefresh()
    })
    container.addEventListener('pointerdown', event => {
      if (!isEditingElement(event.target)) return
      state.interactionDepth += 1
      clearTimeout(state.refreshTimer)
    }, true)
    container.addEventListener('pointerup', event => {
      if (!isEditingElement(event.target)) return
      state.interactionDepth = Math.max(0, state.interactionDepth - 1)
      scheduleDeferredRefresh()
    }, true)
  }

  function render(container, payload = {}) {
    if (!container) return
    const previousScroller = container.querySelector('.canvas-inspector')
    const previousScrollTop = previousScroller ? previousScroller.scrollTop : 0
    state.container = container
    state.payload = payload
    const session = payload.session || window.CanvasView?.getSession?.() || null
    const workflow = getVisibleWorkflow(session)
    const runtimeAgent = getAgent(session, payload.nodeId)
    const savedNode = workflow?.nodes?.find(item => item.id === payload.nodeId)
    const runtimeOnly = !savedNode && !!runtimeAgent
    const node = savedNode || (runtimeAgent ? {
      id: runtimeAgent.id,
      type: 'work',
      name: runtimeAgent.name || runtimeAgent.role || '协作节点'
    } : null)
    if (!node) {
      container.innerHTML = '<div class="canvas-inspector-empty">请选择一个画布节点</div>'
      return
    }
    const agent = getAgent(session, node.id)
    container.innerHTML = `
      <div class="canvas-inspector">
        <header class="canvas-inspector-header">
          <div class="canvas-inspector-heading">
            <span class="canvas-inspector-eyebrow">${node.type === 'work' ? 'WORK 节点' : node.type === 'input' ? '工作流' : '交付节点'}</span>
            <h2>${escapeHtml(node.name)}</h2>
            ${agent?.retryCount ? `<small>已重试 ${Number(agent.retryCount)} 次</small>` : ''}
          </div>
          <div class="canvas-inspector-header-actions">
            <span class="canvas-inspector-kind">${escapeHtml(node.type)}</span>
            <div class="canvas-inspector-top-actions" data-inspector-top-actions>${renderTopActions(agent)}</div>
          </div>
        </header>
        ${renderRuntimeShell(session, agent)}
        <section class="canvas-inspector-section canvas-inspector-config-section">
          <div class="canvas-inspector-section-head"><h3>${runtimeOnly ? '节点任务' : '节点配置'}</h3><span>属性</span></div>
          ${runtimeOnly ? renderRuntimeTask(runtimeAgent) : renderWorkflowFields(workflow, node)}
        </section>
        ${runtimeOnly ? '' : `<footer class="canvas-inspector-actions">
          ${node.type === 'work' ? '<button type="button" class="canvas-inspector-delete" data-delete-node>删除节点</button>' : '<span></span>'}
          <button type="button" class="canvas-inspector-save" data-save-node>保存配置</button>
        </footer>`}
      </div>
    `
    if (!runtimeOnly) bind(container, workflow, node, session, agent)
    else {
      bindCommonActions(container, session, runtimeAgent)
    }
    bindInteractionGuard(container)
    const nextScroller = container.querySelector('.canvas-inspector')
    if (nextScroller && previousScrollTop > 0) {
      requestAnimationFrame(() => {
        nextScroller.scrollTop = Math.min(previousScrollTop, nextScroller.scrollHeight - nextScroller.clientHeight)
      })
    }
  }

  function refresh(session = null) {
    if (!state.container || !state.payload) return
    const nextSession = session || state.payload.session
    state.pendingSession = nextSession
    if (state.interactionDepth > 0) return
    state.pendingSession = null
    if (updateRuntimeAreas(nextSession)) {
      state.payload = { ...state.payload, session: nextSession }
      return
    }
    render(state.container, { ...state.payload, session: nextSession })
  }

  function destroy() {
    clearTimeout(state.refreshTimer)
    state.container = null
    state.payload = null
    state.pendingSession = null
    state.interactionDepth = 0
    state.refreshTimer = null
  }

  window.CanvasInspector = { render, refresh, destroy }
})()
