// 项目分支会话管理模块
// 负责分支会话切换、创建、删除以及项目置顶/重命名等操作。
// 通过 window.ProjectBranchSession.bind(deps) 注入依赖后使用。

(function () {
  let deps = {}
  let branchSwitchInFlight = ''

  function isValidProjectBranchName(branchName = '') {
    const value = String(branchName || '').trim()
    if (!value) return false
    if (value.startsWith('/') || value.endsWith('/') || value.endsWith('.')) return false
    if (value.includes('..') || value.includes('//') || value.includes('@{')) return false
    return !/[\s~^:?*[\]\\\x00-\x1F]/.test(value)
  }

  function showProjectTextInputDialog(options = {}) {
    return new Promise(resolve => {
      document.querySelector('.project-rename-backdrop')?.remove()
      const title = options.title || '输入'
      const currentValue = options.value || ''
      const placeholder = options.placeholder || ''
      const confirmText = options.confirmText || '确定'
      const escapeHtml = deps.escapeHtml || (v => String(v || ''))
      const backdrop = document.createElement('div')
      backdrop.className = 'project-rename-backdrop'
      backdrop.innerHTML = `
        <div class="project-rename-dialog" role="dialog" aria-modal="true">
          <div class="project-rename-title">${escapeHtml(title)}</div>
          <input class="project-rename-input" type="text" value="${escapeHtml(currentValue)}" placeholder="${escapeHtml(placeholder)}" spellcheck="false">
          <div class="project-rename-actions">
            <button class="project-rename-btn" type="button" data-action="cancel">取消</button>
            <button class="project-rename-btn primary" type="button" data-action="confirm">${escapeHtml(confirmText)}</button>
          </div>
        </div>
      `
      document.body.appendChild(backdrop)
      const input = backdrop.querySelector('.project-rename-input')
      const close = value => {
        backdrop.remove()
        document.removeEventListener('keydown', onKeydown, true)
        resolve(value)
      }
      const onKeydown = event => {
        if (event.key === 'Escape') close(null)
        if (event.key === 'Enter') close(input.value)
      }
      backdrop.addEventListener('click', event => {
        if (event.target === backdrop || event.target.dataset.action === 'cancel') close(null)
        if (event.target.dataset.action === 'confirm') close(input.value)
      })
      document.addEventListener('keydown', onKeydown, true)
      requestAnimationFrame(() => {
        input.focus()
        input.select()
      })
    })
  }

  function showProjectRenameDialog(currentName = '') {
    return showProjectTextInputDialog({
      title: '重命名项目',
      value: currentName,
      confirmText: '确定'
    })
  }

  async function switchBranchSession(project, session = {}) {
    if (!project) return
    const branchName = session.branchName || ''
    const activeProject = deps.getActiveProject?.()
    const isActiveProject = activeProject?.id === project.id
    const switchKey = `${project.id || project.path || ''}\u001f${branchName || '__mainline__'}`
    if (branchSwitchInFlight === switchKey) return
    branchSwitchInFlight = switchKey
    if (!branchName) {
      try {
        if (isActiveProject) {
          window.ProjectSwitcher?.returnToChatArea?.()
          deps.renderProjectList?.()
          deps.updateProjectDisplay?.()
        } else {
          await deps.switchProject(project.id)
        }
      } finally {
        if (branchSwitchInFlight === switchKey) branchSwitchInFlight = ''
      }
      return
    }
    try {
      const currentBranchName = String(project.branchName || project.gitStatus?.branch || '').trim()
      const shouldCheckout = branchName !== currentBranchName
      const shouldLoadBranchSession = shouldCheckout || !!project.chatSessionId
      if (shouldCheckout && window.api?.gitCheckout) {
        const result = await window.api.gitCheckout(project.path, branchName)
        if (!result?.success) {
          const errorText = String(result?.error || '')
          if (/local changes.*would be overwritten|commit your changes or stash/i.test(errorText)) {
            deps.showToast('当前项目有未提交改动，Git 为了保护文件已阻止切换分支。请先创建恢复点或提交当前改动，再打开主线/分支会话。', 'warning', 6000)
            clearBranchSwitchLock(switchKey)
            return
          }
          deps.showToast(result?.error || '切换分支会话失败', 'error')
          clearBranchSwitchLock(switchKey)
          return
        }
        project.branchName = branchName
        project.branchKey = session.branchKey || project.branchKey || branchName
        project.branchTitle = session.title || (session.isMainline || /^(main|master)$/i.test(branchName) ? '主线会话' : '')
        project.branchSessions = (project.branchSessions || []).map(item =>
          item?.branchName === branchName
            ? { ...item, current: true, title: item.title || project.branchTitle }
            : { ...item, current: false }
        )
      }
      if (isActiveProject) {
        deps.renderProjectList?.()
        deps.updateProjectDisplay?.()
        if (shouldLoadBranchSession) {
          if (!window.api?.switchBranchChatSession) {
            deps.showToast('当前客户端不支持切换分支会话', 'error')
            clearBranchSwitchLock(switchKey)
            return
          }
          const sessionResult = await window.api.switchBranchChatSession(project.id, branchName)
          if (!sessionResult?.success) {
            deps.showToast(sessionResult?.error || '加载分支会话失败', 'error')
            clearBranchSwitchLock(switchKey)
            return
          }
          project.chatSessionId = ''
          project.chatSessionPath = ''
          project.chatSessionTitle = ''
          await deps.reloadActiveBranchSession({ force: true, result: sessionResult })
        } else {
          window.ProjectSwitcher?.returnToChatArea?.()
        }
      } else {
        await deps.switchProject(project.id)
      }
      await deps.loadGitStatusForProject(project)
      clearBranchSwitchLock(switchKey)
    } catch (error) {
      console.error('[Frontend] switch branch session failed:', error)
      clearBranchSwitchLock(switchKey)
      deps.showToast(`切换分支会话失败：${error?.message || error}`, 'error')
    }
  }

  function clearBranchSwitchLock(switchKey) {
    if (branchSwitchInFlight === switchKey) branchSwitchInFlight = ''
  }

  async function handleProjectListAction(project, action) {
    if (!project || !action) return
    if (action.startsWith('workspace-')) {
      await window.ProjectWorkspaces?.handleAction?.(project, action)
      return
    }
    if (action === 'pin') {
      toggleProjectPinned(project.id)
    } else if (action === 'open') {
      deps.openProjectFolder(project.path)
    } else if (action === 'rename') {
      await renameProject(project.id)
    } else if (action === 'archive') {
      await deps.archiveProject(project.id)
    } else if (action === 'remove') {
      await deps.closeProject(project.id)
    }
  }

  function showCreateBranchDialog(options = {}) {
    return new Promise(resolve => {
      document.querySelector('.project-create-branch-backdrop')?.remove()
      const escapeHtml = deps.escapeHtml || (v => String(v || ''))
      const defaultBranchName = String(options.defaultBranchName || '').trim()
      const backdrop = document.createElement('div')
      backdrop.className = 'project-rename-backdrop project-create-branch-backdrop'
      backdrop.innerHTML = `
        <div class="project-rename-dialog project-create-branch-dialog" role="dialog" aria-modal="true">
          <div class="project-rename-title">创建独立工作区</div>
          <div class="project-create-branch-hint">新方向使用独立目录、独立分支和独立 AI 会话，可与主工作区并行开发</div>
          <input class="project-rename-input" type="text" value="${escapeHtml(defaultBranchName)}" placeholder="例如 feature-ui-test" spellcheck="false">
          <div class="project-create-branch-mode-list" role="radiogroup" aria-label="上下文模式">
            <label class="project-create-branch-mode-item">
              <input type="radio" name="create-branch-context-mode" value="empty" checked>
              <span class="project-create-branch-mode-copy">
                <strong>不带上下文</strong>
                <em>新分支会话默认空对话</em>
              </span>
            </label>
            <label class="project-create-branch-mode-item">
              <input type="radio" name="create-branch-context-mode" value="with_context">
              <span class="project-create-branch-mode-copy">
                <strong>带当前上下文</strong>
                <em>复制此刻之前的对话到新分支</em>
              </span>
            </label>
          </div>
          <div class="project-rename-actions">
            <button class="project-rename-btn" type="button" data-action="cancel">取消</button>
            <button class="project-rename-btn primary" type="button" data-action="confirm">创建并打开</button>
          </div>
        </div>
      `
      document.body.appendChild(backdrop)
      const input = backdrop.querySelector('.project-rename-input')
      const close = value => {
        backdrop.remove()
        document.removeEventListener('keydown', onKeydown, true)
        resolve(value)
      }
      const collect = () => {
        const mode = backdrop.querySelector('input[name="create-branch-context-mode"]:checked')?.value || 'empty'
        return {
          branchName: String(input?.value || '').trim(),
          contextMode: mode === 'with_context' ? 'with_context' : 'empty'
        }
      }
      const onKeydown = event => {
        if (event.key === 'Escape') close(null)
        if (event.key === 'Enter') close(collect())
      }
      backdrop.addEventListener('click', event => {
        if (event.target === backdrop || event.target.dataset.action === 'cancel') close(null)
        if (event.target.dataset.action === 'confirm') close(collect())
      })
      document.addEventListener('keydown', onKeydown, true)
      requestAnimationFrame(() => {
        input?.focus()
        input?.select?.()
      })
    })
  }

  async function createBranchWithContext(project, options = {}) {
    if (!project?.path) {
      deps.showToast('请先选择项目', 'warning')
      return null
    }
    if (!window.ProjectWorkspaces?.createFromProject) {
      deps.showToast('当前客户端不支持独立工作区', 'error')
      return null
    }
    if (project.isRunning || deps.isProjectAiRunActive?.(project)) {
      deps.showToast('当前会话仍在输出，请稍后再创建分支', 'warning')
      return null
    }

    let trimmedBranchName = String(options.branchName || '').trim()
    let contextMode = options.contextMode === 'with_context' ? 'with_context' : 'empty'

    if (!options.skipDialog) {
      const dialogResult = await showCreateBranchDialog({
        defaultBranchName: trimmedBranchName || `feature-${new Date().toISOString().slice(5, 16).replace(/[-:T]/g, '')}`
      })
      if (!dialogResult) return null
      trimmedBranchName = String(dialogResult.branchName || '').trim()
      contextMode = dialogResult.contextMode === 'with_context' ? 'with_context' : 'empty'
    }

    if (!trimmedBranchName) {
      deps.showToast('请输入分支名称', 'warning')
      return null
    }
    if (!isValidProjectBranchName(trimmedBranchName)) {
      deps.showToast('分支名称不能包含空格、中文标点或 Git 保留字符', 'warning', 5000)
      return null
    }

    const preferredTitle = normalizeBranchTitle(options.preferredTitle || options.sourceMessageText || '')
    const sourceTitle = preferredTitle
      || String(project.branchTitle || project.chatSessionTitle || project.title || '').trim()

    try {
      const nextTitle = preferredTitle || (contextMode === 'with_context' ? (sourceTitle || '') : '')
      return await window.ProjectWorkspaces.createFromProject(project, {
        branchName: trimmedBranchName,
        title: nextTitle || trimmedBranchName,
        contextMode,
        createdFrom: options.createdFrom || 'message_inline_copy'
      })
    } catch (error) {
      console.error('[Frontend] create branch with context failed:', error)
      deps.showToast(`新建分支失败：${error?.message || error}`, 'error')
      return null
    }
  }

  function normalizeBranchTitle(text = '') {
    const raw = String(text || '').replace(/\s+/g, ' ').trim()
    if (!raw) return ''
    return raw.length > 20 ? `${raw.slice(0, 20)}...` : raw
  }

  function getBranchKeyClient(branchName = '') {
    // 与后端 getBranchKey 保持一致：sha1(branchName) 截前 16
    if (!branchName) return ''
    let hash = 0
    for (let i = 0; i < branchName.length; i++) {
      hash = ((hash << 5) - hash) + branchName.charCodeAt(i)
      hash |= 0
    }
    return Math.abs(hash).toString(16).padStart(8, '0').slice(0, 16)
  }

  async function persistBranchTitle(project, title = '') {
    const nextTitle = normalizeBranchTitle(title)
    if (!project?.id || !nextTitle) return
    project.branchTitle = nextTitle
    project.branchSessions = (project.branchSessions || []).map(item => (
      item?.current ? { ...item, title: nextTitle } : item
    ))
    if (typeof window.api?.setBranchSessionTitle === 'function') {
      try {
        await window.api.setBranchSessionTitle(project.id, nextTitle)
      } catch (error) {
        console.warn('[Frontend] setBranchSessionTitle failed:', error)
      }
    }
    if (typeof deps.saveProjectsList === 'function') {
      try {
        await deps.saveProjectsList(project.path || '')
      } catch {}
    }
  }

  // 兼容旧调用名：统一走双模式创建服务
  async function createProjectBranch(project, options = {}) {
    return createBranchWithContext(project, {
      ...options,
      createdFrom: options.createdFrom || 'legacy_entry'
    })
  }

  async function openCreateBranchFromChatToolbar() {
    // 兼容旧入口：统一转发到消息级创建
    return openCreateBranchFromMessage({ createdFrom: 'chat_toolbar' })
  }

  async function openCreateBranchFromMessage(options = {}) {
    const project = deps.getActiveProject?.()
    if (!project?.path) {
      deps.showToast('请先选择项目', 'warning')
      return null
    }
    return createBranchWithContext(project, {
      preferredTitle: options.preferredTitle || '',
      sourceMessageText: options.sourceMessageText || '',
      createdFrom: options.createdFrom || 'message_inline_copy'
    })
  }

  function bindCreateBranchToolbar() {
    // 分支创建入口已迁移到消息内联复制按钮左侧，输入栏不再绑定
  }

  async function deleteProjectBranch(project, session = {}) {
    const branchName = String(session.branchName || '').trim()
    if (!project || !branchName) return
    if (/^(main|master)$/i.test(branchName) || session.isMainline) {
      deps.showToast('主线分支不能删除', 'warning')
      return
    }
    if (branchName === project.branchName || session.current) {
      deps.showToast('当前正在使用的分支不能删除，请先切换到主线会话', 'warning')
      return
    }
    if (!window.api?.gitDeleteBranch) {
      deps.showToast('当前客户端不支持删除分支', 'error')
      return
    }

    const confirmed = window.BranchDangerDialog
      ? await window.BranchDangerDialog.show({ branchName })
      : window.confirm(`将删除分支「${branchName}」及其聊天会话、上下文、协作记录、临时 AI 记录和项目路线数据。\n\n如果该分支代码尚未合并到主线，将无法再从这个分支继续找回。\n\n确定删除吗？`)
    if (!confirmed) return

    try {
      const result = await window.api.gitDeleteBranch(project.id, project.path, branchName)
      if (!result?.success) {
        deps.showToast(result?.error || '删除分支失败', 'error', 5000)
        return
      }
      const allProjectData = await window.api.getAllProjects?.()
      if (Array.isArray(allProjectData)) {
        const latest = allProjectData.find(item => item.id === project.id)
        if (latest && deps.syncProjectBranchSession) deps.syncProjectBranchSession(project, latest)
      } else {
        project.branchSessions = (project.branchSessions || []).filter(item => item.branchName !== branchName)
      }
      await deps.loadGitStatusForProject(project)
      deps.renderProjectList()
      deps.showToast(`已删除分支「${branchName}」及其所有分支数据`, 'success')
    } catch (error) {
      console.error('[Frontend] delete project branch failed:', error)
      deps.showToast(`删除分支失败：${error?.message || error}`, 'error', 5000)
    }
  }

  async function toggleProjectPinned(projectId) {
    deps.syncProjectState()
    const project = deps.getProjects().find(item => item.id === projectId)
    if (!project) return
    project.pinned = !project.pinned
    project.updatedAt = Date.now()
    await deps.saveProjectsList(deps.getActiveProject()?.path || project.path || '')
    deps.renderProjectList()
  }

  async function renameProject(projectId) {
    deps.syncProjectState()
    const project = deps.getProjects().find(item => item.id === projectId)
    if (!project) return
    const nextName = await showProjectRenameDialog(project.name || '')
    if (nextName === null) return
    const trimmed = nextName.trim()
    if (!trimmed || trimmed === project.name) return
    project.name = trimmed
    project.updatedAt = Date.now()
    await deps.saveProjectsList(deps.getActiveProject()?.path || project.path || '')
    deps.renderProjectList()
    deps.updateProjectDisplay()
    deps.showToast('项目已重命名', 'success')
  }

  function bind(depsObj = {}) {
    deps = depsObj
    bindCreateBranchToolbar()
  }

  window.ProjectBranchSession = {
    bind,
    switchBranchSession,
    handleProjectListAction,
    createProjectBranch,
    createBranchWithContext,
    openCreateBranchFromChatToolbar,
    openCreateBranchFromMessage,
    bindCreateBranchToolbar,
    deleteProjectBranch,
    toggleProjectPinned,
    renameProject,
    showProjectTextInputDialog,
    showProjectRenameDialog,
    showCreateBranchDialog,
    isValidProjectBranchName
  }
})()
