(function () {
  function bind(options = {}) {
    const btnNewProject = document.getElementById('btnNewProject')
    const btnClearContext = document.getElementById('btnClearContext')
    const getProjects = options.getProjects || function () { return [] }
    const getActiveProject = options.getActiveProject || function () { return null }
    const generateProjectId = options.generateProjectId || function () {}
    const createProject = options.createProject || function () {}
    const switchProject = options.switchProject || async function () {}
    const loadContextStatus = options.loadContextStatus || function () {}
    const closeSkillPanel = options.closeSkillPanel || function () {}
    const enterNoProjectState = options.enterNoProjectState || async function () {}
    const showToast = options.showToast || ((message, type = 'info') => window.showToast?.(message, type))
    const showProjectTextInputDialog = options.showProjectTextInputDialog
      || window.ProjectBranchSession?.showProjectTextInputDialog

    const returnToChatMain = () => {
      // 与点击项目会话标题一致：先关闭设置/Git/资源中心等面板，再显示聊天区
      try { window.ProjectSwitcher?.returnToChatArea?.() } catch (_) {}
      try { window.returnToChatArea?.() } catch (_) {}
      try { closeSkillPanel?.() } catch (_) {}
    }

    const createProjectDirectory = async () => {
      AppLogger.debug('[Frontend] 欢迎页新建项目按钮点击')
      returnToChatMain()
      if (!window.api) return

      // 新建项目：选父目录 -> 命名 -> 创建文件夹 -> 进入项目
      if (!window.api.selectNewProjectParentPath || !window.api.createProjectFolder) {
        showToast?.('当前客户端不支持新建项目目录，请重启应用后再试', 'error')
        return
      }

      const parentResult = await window.api.selectNewProjectParentPath()
      AppLogger.debug('[Frontend] selectNewProjectParentPath 结果:', parentResult)
      if (parentResult?.canceled) return
      if (!parentResult?.success || !parentResult.path) {
        showToast?.(parentResult?.error || '选择新建位置失败', 'error')
        return
      }

      if (typeof showProjectTextInputDialog !== 'function') {
        showToast?.('当前版本缺少命名弹窗，无法新建项目', 'error')
        return
      }

      const projectName = await showProjectTextInputDialog({
        title: '新建项目',
        value: '',
        placeholder: '输入项目文件夹名称',
        confirmText: '创建'
      })
      if (projectName === null) return
      const trimmedName = String(projectName || '').trim()
      if (!trimmedName) {
        showToast?.('请输入项目名称', 'warning')
        return
      }

      const createResult = await window.api.createProjectFolder(parentResult.path, trimmedName)
      AppLogger.debug('[Frontend] createProjectFolder 结果:', createResult)
      if (!createResult?.success || !createResult.path || !createResult.projectId) {
        showToast?.(createResult?.error || '创建项目目录失败', 'error')
        return
      }

      localStorage.setItem('lastProjectPath', createResult.path)
      const existingId = createResult.projectId || generateProjectId(createResult.path)
      const existing = getProjects().find(p => p.path === createResult.path || p.id === existingId)
      if (existing) {
        await switchProject(existing.id)
        returnToChatMain()
        return
      }

      const project = createProject(createResult.path, {
        id: createResult.projectId,
        name: createResult.name || trimmedName,
        storagePath: createResult.storagePath || '',
        folderMtimeMs: createResult.folderMtimeMs || 0
      })
      await switchProject(project.id)
      // switchProject 会回聊天区；再显式兜底一次，避免面板关闭失败时仍停在旧界面
      returnToChatMain()
      // 新建后若暂无消息，展示欢迎页引导，并保持当前项目激活。
      if (!Array.isArray(project.messagesHistory) || project.messagesHistory.length === 0) {
        const chatMessages = document.getElementById('chatMessages')
        if (chatMessages && !chatMessages.querySelector('.message')) {
          window.renderWelcomeEmptyState?.({ keepProject: true })
          window.setChatInputVisible?.(true)
        }
      }
      showToast?.(`项目已创建：${createResult.name || trimmedName}`, 'success')
    }

    window.ProjectActions.createProjectDirectory = createProjectDirectory

    if (btnNewProject) btnNewProject.onclick = async () => {
      AppLogger.debug('[Frontend] 左侧新建项目按钮点击，进入无项目状态')
      // 进入无项目欢迎页（内部已处理UI切换）
      await enterNoProjectState()
    }

    if (btnClearContext) btnClearContext.onclick = async () => {
      const project = getActiveProject()
      if (window.api && project) {
        await window.api.clearContext(project.id)
        loadContextStatus()
      }
    }
  }

  window.ProjectActions = { bind, createProjectDirectory: async function () {} }
})()
