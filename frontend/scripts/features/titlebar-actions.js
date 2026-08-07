// 标题栏/菜单动作模块
// 负责菜单项归一化、项目打开/导入/导出和聊天清空等操作。
// 通过 window.TitlebarActions.bind(deps) 注入依赖后使用。

(function () {
  let deps = {}

  function normalizeMenuAction(action, text = '') {
    const value = String(action || text || '')
    if (value.includes('打开项目')) return 'file:open-project'
    if (value.includes('导入聊天记录')) return 'file:import-history'
    if (value.includes('导出聊天记录')) return 'file:export-history'
    if (value.includes('清空聊天')) return 'edit:clear-chat'
    if (value.includes('清空上下文')) return 'edit:clear-context'

    if (value.includes('关于')) return 'app:about'
    if (value.includes('退出')) return 'app:exit'
    return value
  }

  function openAboutPanel() {
    const aboutPanel = deps.getAboutPanel ? deps.getAboutPanel() : document.getElementById('aboutPanel')
    if (!aboutPanel) return
    aboutPanel.classList.toggle('show')
    if (aboutPanel.classList.contains('show')) {
      deps.titlebarUI?.resetAboutPosition?.(aboutPanel)
    }
  }

  async function openProjectFromMenu() {
    if (!window.api?.selectProjectPath) {
      deps.showToast('当前客户端不支持打开项目', 'error')
      return
    }
    const result = await window.api.selectProjectPath()
    if (result?.canceled || !result?.path) return

    localStorage.setItem('lastProjectPath', result.path)
    const existingId = deps.generateProjectId(result.path)
    const existing = deps.getProjects().find(project => project.path === result.path || project.id === existingId)
    if (existing) {
      await deps.switchProject(existing.id)
      return
    }

    const createResult = await window.api.createProject(result.path)
    if (!createResult?.success || !createResult?.projectId) {
      deps.showToast(createResult?.error || '打开项目失败', 'error')
      return
    }

    const project = deps.createProject(result.path, {
      id: createResult.projectId,
      storagePath: createResult.storagePath || '',
      folderMtimeMs: createResult.folderMtimeMs || 0,
      lastProjectPath: result.path
    })
    deps.syncAiStateToProject()
    // 与新建项目入口保持一致：走 switchProject 统一拉取后端历史与会话列表，
    // 确保 project.chatSessionId / project.chatSessions 被同步，
    // 否则首条消息发出后侧栏不会出现会话标题（仅显示项目名）。
    await deps.switchProject(project.id)
    deps.setCurrentSkill(project.skillName || null)
    deps.updateSkillButton()

    const modelName = deps.getProjectModelName(project)
    const status = await window.api.getContextStatus(project.id, modelName)
    project.contextStatus = status
    deps.loadGitStatusForProject(project)
    deps.updateSidebarProject()

    // 打开后若暂无消息，展示欢迎页引导（与新建项目流程一致）
    if (!Array.isArray(project.messagesHistory) || project.messagesHistory.length === 0) {
      const chatMessages = deps.getChatMessages()
      if (chatMessages && !chatMessages.querySelector('.message')) {
        window.renderWelcomeEmptyState?.({ keepProject: true })
        window.setChatInputVisible?.(true)
      }
    }
  }

  async function exportActiveProjectHistory() {
    const project = deps.getActiveProject()
    if (!project) {
      deps.showToast('请先选择项目', 'warning')
      return
    }
    let messages = Array.isArray(project.history) ? project.history : []
    if (window.api?.exportChatHistory) {
      const result = await window.api.exportChatHistory(project.id)
      if (result?.success && Array.isArray(result.messages)) {
        messages = result.messages
      }
    }
    if (messages.length === 0) {
      deps.showToast('当前项目暂无聊天记录可导出', 'warning')
      return
    }
    const payload = {
      exportedAt: new Date().toISOString(),
      project: {
        id: project.id || '',
        name: project.name || '',
        path: project.path || ''
      },
      messages
    }
    const safeName = String(project.name || project.title || '聊天记录').replace(/[<>:"/\\|?*\x00-\x1F]+/g, '_')
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `${safeName}-聊天记录.json`
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
    deps.showToast('聊天记录已导出', 'success')
  }

  function pickJsonFile() {
    return new Promise(resolve => {
      const input = document.createElement('input')
      input.type = 'file'
      input.accept = 'application/json,.json'
      input.style.display = 'none'
      let settled = false
      const finish = file => {
        if (settled) return
        settled = true
        input.remove()
        resolve(file || null)
      }
      input.addEventListener('change', () => {
        const file = input.files?.[0] || null
        finish(file)
      }, { once: true })
      input.addEventListener('cancel', () => finish(null), { once: true })
      window.addEventListener('focus', () => {
        setTimeout(() => {
          if (!input.files || input.files.length === 0) finish(null)
        }, 300)
      }, { once: true })
      document.body.appendChild(input)
      input.click()
    })
  }

  function readTextFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result || ''))
      reader.onerror = () => reject(reader.error || new Error('读取文件失败'))
      reader.readAsText(file, 'utf-8')
    })
  }

  function extractImportedMessages(payload) {
    if (Array.isArray(payload)) return payload
    if (Array.isArray(payload?.messages)) return payload.messages
    if (Array.isArray(payload?.messagesHistory)) return payload.messagesHistory
    if (Array.isArray(payload?.history)) return payload.history
    return []
  }

  async function importActiveProjectHistory() {
    const project = deps.getActiveProject()
    if (!project) {
      deps.showToast('请先选择项目', 'warning')
      return
    }
    if (project.isRunning) {
      deps.showToast('AI 正在执行，完成或中断后再导入聊天记录', 'warning')
      return
    }
    if (!window.api?.replaceChatHistory) {
      deps.showToast('当前客户端不支持导入聊天记录', 'error')
      return
    }

    const file = await pickJsonFile()
    if (!file) return

    try {
      const raw = await readTextFile(file)
      const payload = JSON.parse(raw)
      const messages = extractImportedMessages(payload)
      if (!Array.isArray(messages) || messages.length === 0) {
        deps.showToast('导入文件中没有可用聊天记录', 'error')
        return
      }
      if (!window.confirm(`导入会覆盖当前项目的聊天记录。\n\n确定导入 ${messages.length} 条历史消息吗？`)) {
        return
      }

      const result = await window.api.replaceChatHistory(project.id, messages)
      if (!result?.success) {
        deps.showToast(result?.error || '导入聊天记录失败', 'error')
        return
      }

      const restored = Array.isArray(result.messages) ? result.messages : (Array.isArray(result.messagesHistory) ? result.messagesHistory : [])
      project.messagesHistory = restored
      project.history = deps.mapMessagesHistoryForProject(restored)
      const firstUserMsg = restored.find(msg => msg?.role === 'user' && !msg.hidden)
      if (firstUserMsg) {
        project.branchTitle = result.branchTitle || (firstUserMsg.displayContent || firstUserMsg.content || '').substring(0, 30)
      }
      deps.getChatMessages().innerHTML = ''
      if (restored.length > 0) {
        if (window.ChatHistoryPaginator && result.range) {
          window.ChatHistoryPaginator.reset({
            container: deps.getChatMessages(),
            renderer: deps.getChatRenderer?.(),
            messagesHistory: restored,
            projectId: project.id,
            projectPath: project.path,
            range: result.range,
            nextCursor: result.nextCursor,
            hasMore: result.hasMore,
            scrollTo: 'bottom'
          })
        } else {
          deps.restoreChatHistory(restored, { projectPath: project.path })
        }
      }
      deps.renderChatHistory()
      deps.renderProjectList()
      await deps.saveProjectsList(project.path || '')
      deps.loadContextStatus()
      deps.showToast('聊天记录已导入', 'success')
    } catch (error) {
      console.error('[Frontend] import chat history failed:', error)
      deps.showToast(`导入聊天记录失败：${error?.message || error}`, 'error')
    }
  }

  async function clearVisibleChatFromMenu() {
    const project = deps.getActiveProject()
    if (!project) {
      deps.showToast('请先选择项目', 'warning')
      return
    }
    if (project.isRunning) {
      deps.showToast('AI 正在执行，完成或中断后再清空聊天', 'warning')
      return
    }
    project.history = []
    project.aiOperations = []
    deps.getChatMessages().innerHTML = ''
    deps.initProgressIndicator()
    if (window.api?.clearContext) {
      await window.api.clearContext(project.id)
    }
    await deps.saveProjectsList(project.path || '')
    deps.renderProjectList()
    deps.loadContextStatus()
    deps.showToast('聊天记录已清空', 'success')
  }

  async function clearContextFromMenu() {
    const project = deps.getActiveProject()
    if (!project) {
      deps.showToast('请先选择项目', 'warning')
      return
    }
    if (project.isRunning) {
      deps.showToast('AI 正在执行，完成或中断后再清空上下文', 'warning')
      return
    }
    if (window.api?.clearContext) {
      await window.api.clearContext(project.id)
    }
    deps.loadContextStatus()
    deps.showToast('上下文已清空', 'success')
  }


  function bind(depsObj = {}) {
    deps = depsObj
  }

  window.TitlebarActions = {
    bind,
    normalizeMenuAction,
    openAboutPanel,
    openProjectFromMenu,
    exportActiveProjectHistory,
    pickJsonFile,
    readTextFile,
    extractImportedMessages,
    importActiveProjectHistory,
    clearVisibleChatFromMenu,
    clearContextFromMenu,
  }
})()
