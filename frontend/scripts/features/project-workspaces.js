(function () {
  let deps = {}

  function bind(nextDeps = {}) {
    deps = { ...deps, ...nextDeps }
  }

  async function createFromProject(project, options = {}) {
    if (!project?.path || !window.api?.createProjectWorktree) {
      deps.showToast?.('当前客户端不支持独立工作区', 'error')
      return null
    }
    const branchName = String(options.branchName || '').trim()
    if (!branchName) return null

    const result = await window.api.createProjectWorktree({
      projectPath: project.path,
      branchName
    })
    if (!result?.success) {
      deps.showToast?.(result?.error || '创建独立工作区失败', 'error', 6000)
      return null
    }

    const createResult = await window.api.createProject(result.worktreePath)
    if (!createResult?.success) {
      deps.showToast?.('工作树已创建，但项目实例注册失败', 'error', 6000)
      return null
    }

    const title = String(options.title || branchName).trim()
    const workspace = deps.createProject?.(result.worktreePath, {
      id: createResult.projectId,
      name: `${project.name} · ${title}`,
      title,
      storagePath: createResult.storagePath || '',
      workspaceOrigin: project.workspaceOrigin || project.path,
      workspaceBranch: branchName,
      workspaceKind: 'worktree',
      modelIndex: project.modelIndex,
      modelKey: project.modelKey || null,
      skillName: project.skillName || null,
      skipSave: true
    })
    if (!workspace) return null

    if (options.contextMode === 'with_context') {
      const historyResult = await window.api?.createChatHistorySourceReference?.(
        workspace.id,
        project.id,
        { preferredTitle: title }
      )
      if (!historyResult?.success) {
        deps.showToast?.(historyResult?.error || '创建分支上下文引用失败', 'error', 6000)
        return null
      }
      workspace.messagesHistory = historyResult.messages || historyResult.messagesHistory || []
    }

    await deps.saveProjectsList?.(result.worktreePath)
    await deps.switchProject?.(workspace.id)
    deps.renderProjectList?.()
    deps.unlockChatComposer?.({ clearValue: false, focus: true })
    deps.showToast?.(`已在独立工作区打开「${title}」`, 'success')
    return { success: true, project: workspace, ...result }
  }

  async function merge(project) {
    if (!project?.workspaceOrigin || !project?.workspaceBranch) return null
    const result = await window.api?.mergeProjectWorktree?.({
      projectPath: project.workspaceOrigin,
      branchName: project.workspaceBranch
    })
    if (!result?.success) {
      deps.showToast?.(result?.error || '合并失败', 'error', 6000)
      return null
    }
    deps.showToast?.(`已将「${project.workspaceBranch}」合并回 ${result.mainBranchName}`, 'success')
    return result
  }

  async function remove(project) {
    if (!project?.workspaceOrigin || !project?.path) return null
    const confirmed = window.BranchDangerDialog?.show
      ? await window.BranchDangerDialog.show({
          title: '删除分支',
          targetName: project.name,
          targetLabel: '目标分支',
          subtitle: '这会删除该分支的独立工作区和项目记录。',
          tags: ['独立工作区', '项目记录'],
          note: '未提交的改动会阻止删除，请先提交或自行处理。',
          confirmText: '确认删除'
        })
      : window.confirm(`确定删除独立工作区「${project.name}」？\n未提交的改动会阻止删除。`)
    if (!confirmed) {
      deps.unlockChatComposer?.({ clearValue: false, focus: true })
      return null
    }
    const result = await window.api?.removeProjectWorktree?.({
      projectPath: project.workspaceOrigin,
      worktreePath: project.path,
      force: false
    })
    if (!result?.success) {
      deps.showToast?.(result?.error || '删除独立工作区失败', 'error', 6000)
      return null
    }
    const unregisterResult = await window.api?.deleteProject?.(project.id, 'light')
    if (unregisterResult && !unregisterResult.success) {
      console.warn('[ProjectWorkspaces] unregister project instance failed:', unregisterResult.error)
    }
    deps.projectStore?.removeProjectById?.(project.id, { selectNext: true })
    await deps.saveProjectsList?.(deps.projectStore?.getActiveProject?.()?.path || '')
    const next = deps.projectStore?.getActiveProject?.()
    if (next) await deps.switchProject?.(next.id)
    deps.renderProjectList?.()
    deps.unlockChatComposer?.({ clearValue: false, focus: true })
    deps.showToast?.('独立工作区已删除', 'success')
    return result
  }

  async function handleAction(project, action) {
    if (action === 'workspace-merge') return merge(project)
    if (action === 'workspace-delete') return remove(project)
    return null
  }

  window.ProjectWorkspaces = { bind, createFromProject, merge, remove, handleAction }
})()
