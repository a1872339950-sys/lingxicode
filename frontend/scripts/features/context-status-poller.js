// 上下文状态轮询模块
// 负责定期查询当前项目的上下文使用状态并更新侧边栏。
// 通过 window.ContextStatusPoller.bind(deps) 注入依赖后使用。

(function () {
  let getActiveProjectFn = null
  let getProjectModelNameFn = null
  let updateSidebarContextFn = null
  let addThinkingFn = null

  let lastRatio = 0
  let lastContextStatusError = ''

  async function pollContextStatus() {
    const project = getActiveProjectFn ? getActiveProjectFn() : null
    if (!project) {
      lastRatio = 0
      if (updateSidebarContextFn) updateSidebarContextFn(0, 0)
      return
    }
    // AI 运行时跳过轮询，避免大量流式 IPC + 上下文状态 IPC 争抢渲染线程，导致输入法 composition 事件丢失
    if (project?.isRunning) return
    if (window.api) {
      let status
      try {
        const modelName = getProjectModelNameFn ? getProjectModelNameFn(project) : ''
        status = await window.api.getContextStatus(project.id, modelName)
      } catch (error) {
        status = { error: error?.message || String(error) }
      }
      const activeProject = getActiveProjectFn ? getActiveProjectFn() : null
      if (!activeProject || activeProject.id !== project.id) return
      if (status?.error) {
        project.contextStatus = status
        if (updateSidebarContextFn) updateSidebarContextFn(0, 0)
        if (project.isRunning && status.error !== lastContextStatusError) {
          lastContextStatusError = status.error
          if (addThinkingFn) addThinkingFn(`上下文状态读取失败：${status.error}`, { isProgressNarration: true, forceUpdate: true })
        }
        return
      }
      lastContextStatusError = ''
      const newRatio = status.contextRatio || 0

      lastRatio = newRatio
      project.contextStatus = status
      if (updateSidebarContextFn) updateSidebarContextFn(newRatio, status.estimatedTokens || 0)
    }
  }

  function bind(deps = {}) {
    if (typeof deps.getActiveProject === 'function') getActiveProjectFn = deps.getActiveProject
    if (typeof deps.getProjectModelName === 'function') getProjectModelNameFn = deps.getProjectModelName
    if (typeof deps.updateSidebarContext === 'function') updateSidebarContextFn = deps.updateSidebarContext
    if (typeof deps.addThinking === 'function') addThinkingFn = deps.addThinking
  }

  window.ContextStatusPoller = {
    bind,
    pollContextStatus,
    get lastRatio() { return lastRatio },
    set lastRatio(v) { lastRatio = v }
  }
})()
