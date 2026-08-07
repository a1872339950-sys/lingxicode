// 聊天会话 UI 清理：切项目/关会话时统一销毁滚动器、分页器并压缩内存中的历史引用。
(function () {
  'use strict'

  function clearChatDom(container) {
    if (!container) return
    try {
      container.innerHTML = ''
    } catch (_) { /* ignore */ }
  }

  function destroyChatViews(container) {
    try {
      window.ChatVirtualScroller?.destroy?.(container)
    } catch (_) { /* ignore */ }
    try {
      window.ChatHistoryPaginator?.destroy?.()
    } catch (_) { /* ignore */ }
    clearChatDom(container)
  }

  function compactProjectMemory(project) {
    if (!project) return project
    try {
      window.ChatRuntimeHistoryCache?.compactProject?.(project)
    } catch (_) { /* ignore */ }
    return project
  }

  /**
   * 离开当前项目前调用：销毁 UI。
   * 默认不压缩 messagesHistory，避免切回时本地短历史盖住磁盘完整记录。
   * 仅当 options.compactMemory === true 时才压缩。
   */
  function leaveProject(options = {}) {
    const container = options.container || document.getElementById('chatMessages')
    const leavingProject = options.project || null
    destroyChatViews(container)
    if (leavingProject && options.compactMemory === true) {
      compactProjectMemory(leavingProject)
    }
  }

  window.ChatSessionCleanup = {
    clearChatDom,
    destroyChatViews,
    compactProjectMemory,
    leaveProject
  }
})()
