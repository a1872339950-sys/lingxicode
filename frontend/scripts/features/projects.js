(function () {
  const projects = []
  let activeProjectId = null

  function generateProjectId(path) {
    let hash = 0
    for (let i = 0; i < path.length; i++) {
      hash = ((hash << 5) - hash) + path.charCodeAt(i)
    }
    return 'project-' + Math.abs(hash).toString(16).substring(0, 8)
  }

  function createProject(path, options = {}) {
    const now = Date.now()
    const id = options.id || generateProjectId(path)
    const name = options.name || path.split(/[\\/]/).pop() || ((window.i18n?.t?.('auto.js_projects_15_1') ?? '未命名'))
    const existing = findProjectById(id) || (path ? projects.find(p => p.path === path) : null)
    if (existing) {
      const nextSkillName = Object.prototype.hasOwnProperty.call(options, 'skillName')
        ? options.skillName
        : existing.skillName
      Object.assign(existing, {
        id,
        name: options.name || existing.name,
        title: options.title || existing.title,
        path,
        modelIndex: Number.isInteger(options.modelIndex) ? options.modelIndex : existing.modelIndex,
        modelKey: Object.prototype.hasOwnProperty.call(options, 'modelKey') ? options.modelKey : existing.modelKey,
        skillName: nextSkillName,
        storagePath: options.storagePath || existing.storagePath || '',
        branchName: Object.prototype.hasOwnProperty.call(options, 'branchName') ? options.branchName : existing.branchName || '',
        branchKey: Object.prototype.hasOwnProperty.call(options, 'branchKey') ? options.branchKey : existing.branchKey || '',
        branchTitle: Object.prototype.hasOwnProperty.call(options, 'branchTitle') ? options.branchTitle : existing.branchTitle || '',
        branchSessionPath: Object.prototype.hasOwnProperty.call(options, 'branchSessionPath') ? options.branchSessionPath : existing.branchSessionPath || '',
        branchSessions: Array.isArray(options.branchSessions) ? options.branchSessions : existing.branchSessions || [],
        pinned: Object.prototype.hasOwnProperty.call(options, 'pinned') ? !!options.pinned : !!existing.pinned,
        expanded: Object.prototype.hasOwnProperty.call(options, 'expanded') ? options.expanded !== false : existing.expanded !== false,
        archived: Object.prototype.hasOwnProperty.call(options, 'archived') ? !!options.archived : !!existing.archived,
        stateless: Object.prototype.hasOwnProperty.call(options, 'stateless') ? !!options.stateless : !!existing.stateless,
        workspaceOrigin: options.workspaceOrigin || existing.workspaceOrigin || '',
        workspaceBranch: options.workspaceBranch || existing.workspaceBranch || '',
        workspaceKind: options.workspaceKind || existing.workspaceKind || '',
        contextStatus: options.contextStatus || existing.contextStatus,
        createdAt: options.createdAt || existing.createdAt || now,
        updatedAt: options.updatedAt || existing.updatedAt || options.folderMtimeMs || existing.folderMtimeMs || now,
        lastOpenedAt: options.lastOpenedAt || existing.lastOpenedAt || 0,
        folderMtimeMs: options.folderMtimeMs || existing.folderMtimeMs || 0
      })
      return existing
    }

    const project = {
      id,
      name,
      title: options.title || name,
      path,
      storagePath: options.storagePath || '',
      branchName: options.branchName || '',
      branchKey: options.branchKey || '',
      branchTitle: options.branchTitle || '',
      branchSessionPath: options.branchSessionPath || '',
      branchSessions: Array.isArray(options.branchSessions) ? options.branchSessions : [],
      history: options.history || [],
      modelIndex: Number.isInteger(options.modelIndex) ? options.modelIndex : -1,
      modelKey: options.modelKey || null,
      skillName: options.skillName || null,
      pinned: !!options.pinned,
      expanded: options.expanded !== false,
      archived: !!options.archived,
      stateless: !!options.stateless,
      workspaceOrigin: options.workspaceOrigin || '',
      workspaceBranch: options.workspaceBranch || '',
      workspaceKind: options.workspaceKind || '',
      createdAt: options.createdAt || now,
      updatedAt: options.updatedAt || options.folderMtimeMs || now,
      lastOpenedAt: options.lastOpenedAt || 0,
      folderMtimeMs: options.folderMtimeMs || 0,
      isRunning: false,
      contextStatus: options.contextStatus || { tapeLength: 0, contextRatio: 0 },
      aiOperations: []
    }

    projects.push(project)
    return project
  }

  function addProject(project) {
    const existing = findProjectById(project.id) || (project.path ? projects.find(p => p.path === project.path) : null)
    if (existing) return existing

    projects.push(project)
    return project
  }

  function getProjects() {
    return projects
  }

  function findProjectById(projectId) {
    return projects.find(p => p.id === projectId) || null
  }

  function findProjectByPath(path) {
    if (!path) return null
    return projects.find(p => p.path === path) || findProjectById(generateProjectId(path))
  }

  function getActiveProjectId() {
    return activeProjectId
  }

  function setActiveProjectId(projectId) {
    const project = findProjectById(projectId) || projects.find(p => p.path === projectId)
    const nextId = project ? project.id : projectId
    const changed = activeProjectId !== nextId
    activeProjectId = nextId
    if (changed) {
      try {
        window.dispatchEvent(new CustomEvent('lingxi:active-project-changed', {
          detail: { projectId: activeProjectId || '' }
        }))
      } catch (_) { /* CustomEvent 不可用时静默忽略 */ }
    }
    return getActiveProject()
  }
  function getActiveProject() {
    if (!activeProjectId) return null
    return findProjectById(activeProjectId) || projects.find(p => p.path === activeProjectId) || null
  }

  function ensureActiveProject(preferredPath = '') {
    const active = getActiveProject()
    if (active && !active.archived) return active

    const fallback = preferredPath
      ? findProjectByPath(preferredPath) || projects.find(p => !p.archived)
      : projects.find(p => !p.archived)

    if (!fallback) {
      activeProjectId = null
      return null
    }

    activeProjectId = fallback.id
    return fallback
  }

  function removeProjectById(projectId, options = {}) {
    const index = projects.findIndex(p => p.id === projectId)
    if (index === -1) return null
    const removed = projects.splice(index, 1)[0]
    if (activeProjectId === projectId && options.selectNext !== false) {
      activeProjectId = projects.find(p => !p.archived)?.id || null
    }
    return removed
  }

  function removeProjectsByIdentity(identity = {}, options = {}) {
    const ids = new Set((identity.ids || []).filter(Boolean))
    const paths = new Set((identity.paths || []).filter(Boolean))
    if (identity.id) ids.add(identity.id)
    if (identity.path) paths.add(identity.path)

    if (paths.size > 0) {
      for (const projectPath of [...paths]) {
        ids.add(generateProjectId(projectPath))
      }
    }

    const removed = []
    for (let i = projects.length - 1; i >= 0; i--) {
      const project = projects[i]
      const matchedById = ids.has(project.id)
      const matchedByPath = project.path && paths.has(project.path)
      if (matchedById || matchedByPath) {
        removed.push(projects.splice(i, 1)[0])
      }
    }

    if (removed.some(project => project.id === activeProjectId) && options.selectNext !== false) {
      activeProjectId = projects.find(p => !p.archived)?.id || null
    }
    return removed.reverse()
  }

  function moveProject(draggedId, targetId) {
    const draggedIndex = projects.findIndex(p => p.id === draggedId)
    const targetIndex = projects.findIndex(p => p.id === targetId)
    if (draggedIndex === -1 || targetIndex === -1 || draggedIndex === targetIndex) {
      return false
    }

    const draggedProject = projects.splice(draggedIndex, 1)[0]
    projects.splice(targetIndex, 0, draggedProject)
    return true
  }

  function setProjectArchived(projectId, archived = true) {
    const project = findProjectById(projectId) || projects.find(p => p.path === projectId)
    if (!project) return null
    project.archived = !!archived
    if (project.archived && activeProjectId === project.id) {
      const next = projects.find(p => !p.archived && p.id !== project.id)
      activeProjectId = next?.id || null
    }
    return project
  }

  function getArchivedProjects() {
    return projects.filter(p => !!p.archived)
  }

  function serializeProjectList() {
    const seen = new Set()
    return projects.filter(p => !p.stateless).filter(p => {
      const key = p.id || generateProjectId(p.path)
      if (seen.has(key)) return false
      seen.add(key)
      return true
    }).map(p => ({
      id: p.id,
      name: p.name,
      title: p.title,
      path: p.path,
      storagePath: p.storagePath || '',
      modelIndex: p.modelIndex,
      modelKey: p.modelKey || null,
      skillName: p.skillName,
      pinned: !!p.pinned,
      expanded: p.expanded !== false,
      createdAt: p.createdAt || 0,
      updatedAt: p.updatedAt || 0,
      lastOpenedAt: p.lastOpenedAt || 0,
      folderMtimeMs: p.folderMtimeMs || 0,
      archived: !!p.archived,
      workspaceOrigin: p.workspaceOrigin || '',
      workspaceBranch: p.workspaceBranch || '',
      workspaceKind: p.workspaceKind || ''
    }))
  }

  async function saveList(lastProjectPath = '') {
    const projectList = serializeProjectList()

    if (window.api?.saveProjectsList) {
      try {
        const result = await window.api.saveProjectsList(projectList)
        if (result.success) {
          AppLogger.debug('[Frontend] 项目列表已保存到后端，共', projectList.length, '个项目')
          localStorage.setItem('lastProjectPath', lastProjectPath)
          return
        }
      } catch (e) {
        console.error('[Frontend] 保存项目列表到后端失败:', e)
      }
    }

    localStorage.setItem('savedProjects', JSON.stringify(projectList))
    localStorage.setItem('lastProjectPath', lastProjectPath)
  }

  async function loadList() {
    if (window.api?.getProjectsList) {
      try {
        const result = await window.api.getProjectsList()
        if (result.success && result.data && result.data.length > 0) {
          AppLogger.debug('[Frontend] 从后端加载项目列表，共', result.data.length, '个项目')
          return result.data
        }

        if (result.isNew && !result.isPackaged) {
          const saved = localStorage.getItem('savedProjects')
          if (saved) {
            try {
              const localProjects = JSON.parse(saved)
              if (Array.isArray(localProjects) && localProjects.length > 0) {
                const migrateResult = await window.api.migrateProjectsList(localProjects)
                if (migrateResult.success) {
                  AppLogger.debug('[Frontend] 已从 localStorage 迁移项目列表到后端')
                  localStorage.removeItem('savedProjects')
                  return localProjects
                }
              }
            } catch (e) {
              console.error('[Frontend] 迁移项目列表失败:', e)
            }
          }
        }
      } catch (e) {
        console.error('[Frontend] 从后端加载项目列表失败:', e)
      }
    }

    try {
      const status = window.api?.getStorageStatus ? await window.api.getStorageStatus().catch(() => null) : null
      if (!status?.isPackaged) {
        const saved = localStorage.getItem('savedProjects')
        if (saved) return JSON.parse(saved)
      }
    } catch (e) {
      console.error('[Frontend] 加载项目列表失败:', e)
    }
    return []
  }

  window.ProjectStore = {
    generateProjectId,
    createProject,
    addProject,
    getProjects,
    findProjectById,
    findProjectByPath,
    getActiveProjectId,
    setActiveProjectId,
    getActiveProject,
    ensureActiveProject,
    removeProjectById,
    removeProjectsByIdentity,
    moveProject,
    setProjectArchived,
    getArchivedProjects,
    serializeProjectList,
    saveList,
    loadList
  }
})()
