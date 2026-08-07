// 协作面板模块
// 负责手动打开多会话协作面板、事件路由和主计划面板渲染。
// 通过 window.CollaborationPreview.bind(deps) 注入依赖后使用。

(function () {
  let deps = {}

  function createCollaborationPreviewSession(projectIdOverride = '') {
    const now = Date.now()
    const projectId = projectIdOverride || (deps.getActiveProjectId ? deps.getActiveProjectId() : '') || ''
    const sessionProjectKey = String(projectId || 'default').replace(/[^a-zA-Z0-9_-]/g, '-')
    return {
      id: `collab-preview-${sessionProjectKey}`,
      projectId,
      mode: 'preview',
      status: 'running',
      createdAt: now,
      updatedAt: now,
      plan: [],
      reports: [],
      agents: Array.from({ length: 2 }, (_, i) => ({
        id: 'preview-' + (i + 1),
        name: '',
        role: '',
        task: '',
        modelName: '',
        status: 'waiting',
        chatProjectId: '',
        thinking: [],
        tools: []
      }))
    }
  }

  async function ensureCollaborationPreviewChatInstances(session) {
    if (!session?.projectId || !Array.isArray(session.agents)) return false
    const api = window.api?.ensureCollaborationChatInstance
    if (typeof api !== 'function') return false
    let allOk = true
    for (const agent of session.agents) {
      if (agent.chatProjectId) continue
      try {
        const result = await api(session.projectId, session.id, { id: agent.id, name: agent.name || '' })
        if (result?.success && result.projectId) {
          agent.chatProjectId = result.projectId
        } else {
          allOk = false
          console.warn('[CollabPreview] ensure chat instance failed:', result?.error)
        }
      } catch (err) {
        allOk = false
        console.warn('[CollabPreview] ensure chat instance error:', err?.message || err)
      }
    }
    return allOk
  }

  // 旧“多会话窗口”入口已下线：同项目多会话改走侧栏「新开会话」；
  // 临时多 AI 走协作画布，不再打开右侧手动多会话窗。
  async function openCurrentProjectCollaborationPanel() {
    deps.showToast?.('多会话窗口已下线，请使用左侧项目上的「新开会话」；临时多 AI 请用 @多agent协作。', 'info')
    return null
  }

  function routeAgentCollaborationEvent(data = {}, type = 'status') {
    const projectId = data.projectId || (deps.getActiveProjectId ? deps.getActiveProjectId() : '')
    const hasAgentMarker = data.collaborationSessionId || data.agentId || data.agentRole || data.agentTitle
    if (!hasAgentMarker) return false
    const hasActiveSession = window.AgentCollaborationUI?.findActiveSession?.(projectId)
    if (!hasActiveSession) return false
    let content = data.content || data.message || ''
    if (!content && data.args) {
      try { content = JSON.stringify(data.args).slice(0, 1200) } catch { content = String(data.name || '') }
    }
    if (!content && data.result) {
      try { content = JSON.stringify(data.result).slice(0, 1200) } catch { content = String(data.name || '') }
    }
    if (!content && !data.title && !data.name) return false
    return window.AgentCollaborationUI?.appendSessionEvent?.(projectId, {
      type,
      title: data.title || data.name || (type === 'tool' ? '工具调用' : '思考块'),
      name: data.name || data.title || '',
      content,
      args: data.args || null,
      result: data.result || null,
      toolCallId: data.toolCallId || '',
      status: data.status || '',
      agentRole: data.agentRole || '',
      agentTitle: data.agentTitle || '',
      agentId: data.agentId || ''
    }) === true
  }

  function renderMainPlanPanel(steps = [], title = '计划') {
    const currentAiMsg = deps.getCurrentAiMsg ? deps.getCurrentAiMsg() : null
    if (!currentAiMsg || !Array.isArray(steps) || steps.length === 0) return
    const dynamicArea = currentAiMsg.querySelector('.ai-dynamic-area')
    if (!dynamicArea) return
    dynamicArea.classList.remove('collapsed')
    let panel = dynamicArea.querySelector('[data-main-plan-panel]')
    if (!panel) {
      panel = document.createElement('div')
      panel.dataset.mainPlanPanel = '1'
      dynamicArea.appendChild(panel)
    }
    panel.innerHTML = window.AgentCollaborationUI?.renderPlanPanel?.(steps, { title, prefix: 'ai' }) || ''
    window.AgentCollaborationUI?.bindPlanToggles?.(panel)
  }

  function bind(depsObj = {}) {
    deps = depsObj
  }

  window.CollaborationPreview = {
    bind,
    createCollaborationPreviewSession,
    ensureCollaborationPreviewChatInstances,
    openCurrentProjectCollaborationPanel,
    routeAgentCollaborationEvent,
    renderMainPlanPanel
  }
})()
