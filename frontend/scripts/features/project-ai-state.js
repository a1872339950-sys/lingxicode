(function () {
  function bind(options = {}) {
    const getProjects = options.getProjects || function () { return [] }
    const getActiveProjectId = options.getActiveProjectId || function () { return null }
    const getCurrentAiMsg = options.getCurrentAiMsg || function () { return null }
    const setCurrentAiMsg = options.setCurrentAiMsg || function () {}
    const getCurrentToolCount = options.getCurrentToolCount || function () { return 0 }
    const setCurrentToolCount = options.setCurrentToolCount || function () {}
    const getCurrentOpCount = options.getCurrentOpCount || function () { return 0 }
    const setCurrentOpCount = options.setCurrentOpCount || function () {}
    const getCurrentChangeSession = options.getCurrentChangeSession || function () { return null }
    const setCurrentChangeSession = options.setCurrentChangeSession || function () {}
    const getCurrentToolStats = options.getCurrentToolStats || function () { return { modified: [], created: [], read: [], commands: [] } }
    const setCurrentToolStats = options.setCurrentToolStats || function () {}
    const getChatMessages = options.getChatMessages || function () { return null }
    const syncChatBottomInset = options.syncChatBottomInset || function () {}
    const getActiveProject = options.getActiveProject || function () { return null }
    const isProjectAiRunActive = options.isProjectAiRunActive || function () { return false }
    const captureRunningAiSnapshot = options.captureRunningAiSnapshot || function () {}
    const getChangeSessionActions = options.getChangeSessionActions || function () { return null }
    const getOpIcons = options.getOpIcons || function () { return {} }
    const getFileName = options.getFileName || function () { return '' }

    // ===== 按项目隔离的AI状态 =====
    // 每个项目独立持有 currentAiMsg / currentToolCount / currentOpCount
    // 通过 getProjectAiState / setProjectAiState 访问
    function getProjectAiState(projectId) {
      const project = getProjects().find(p => p.id === projectId)
      if (!project) return null
      if (!project._aiState) {
        project._aiState = { currentAiMsg: null, currentToolCount: 0, currentOpCount: 0 }
      }
      return project._aiState
    }

    // 获取当前激活项目的AI状态
    function getActiveAiState() {
      const activeProjectId = getActiveProjectId()
      return activeProjectId ? getProjectAiState(activeProjectId) : null
    }

    function scrollChatToBottomNow() {
      const chatMessages = getChatMessages()
      if (!chatMessages) return
      try { window.ChatStickyBottom?.forceStick?.(chatMessages) } catch (_) { chatMessages.scrollTop = chatMessages.scrollHeight }
    }

    function followChatToBottom(force = false) {
      if (!force) return
      syncChatBottomInset()
      requestAnimationFrame(() => {
        scrollChatToBottomNow()
        requestAnimationFrame(scrollChatToBottomNow)
      })
    }

    // 同步全局变量到当前激活项目（rAF 节流：一帧内多次调用只执行一次）
    let _syncRafId = 0
    let _syncProjectId = ''
    function syncAiStateToProject(immediate = false) {
      if (!immediate) {
        if (_syncRafId) return
        _syncProjectId = String(getActiveProjectId() || '')
        _syncRafId = requestAnimationFrame(() => {
          const scheduledProjectId = _syncProjectId
          _syncRafId = 0
          _syncProjectId = ''
          if (!scheduledProjectId || scheduledProjectId !== String(getActiveProjectId() || '')) return
          syncAiStateToProject(true)
        })
        return
      }
      if (_syncRafId) {
        cancelAnimationFrame(_syncRafId)
        _syncRafId = 0
        _syncProjectId = ''
      }
      const state = getActiveAiState()
      if (state) {
        state.currentAiMsg = getCurrentAiMsg()
        state.currentToolCount = getCurrentToolCount()
        state.currentOpCount = getCurrentOpCount()
        state.currentChangeSession = getCurrentChangeSession()
      }
      const project = getActiveProject()
      if (project && isProjectAiRunActive(project) && getCurrentAiMsg()) {
        captureRunningAiSnapshot(project, getCurrentAiMsg())
      }
    }

    // 从项目恢复全局变量
    function syncAiStateFromProject() {
      const state = getActiveAiState()
      if (state) {
        setCurrentAiMsg(state.currentAiMsg)
        setCurrentToolCount(state.currentToolCount)
        setCurrentOpCount(state.currentOpCount)
        setCurrentChangeSession(state.currentChangeSession || null)
      } else {
        setCurrentAiMsg(null)
        setCurrentToolCount(0)
        setCurrentOpCount(0)
        setCurrentChangeSession(null)
      }
    }

    // 生成操作摘要
    function generateSummaryHtml(stats, changeSession, operationSnapshot = null) {
      const session = changeSession !== undefined ? changeSession : getCurrentChangeSession()
      const changeSessionActions = getChangeSessionActions()
      const actionHtml = changeSessionActions?.generate(session) || ''
      return window.OperationSummary?.generate(stats, {
        opIcons: getOpIcons(),
        getFileName: getFileName,
        actionHtml,
        changeSession: session,
        operationSnapshot,
        projectPath: getActiveProject?.()?.path || ''
      }) || ''
    }

    // 清空工具调用统计
    function clearToolStats() {
      setCurrentToolStats({ modified: [], created: [], read: [], commands: [] })
      setCurrentChangeSession(null)
    }

    return {
      getProjectAiState,
      getActiveAiState,
      scrollChatToBottomNow,
      followChatToBottom,
      syncAiStateToProject,
      syncAiStateFromProject,
      generateSummaryHtml,
      clearToolStats
    }
  }

  window.ProjectAiState = { bind }
})()
