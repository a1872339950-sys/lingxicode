// 归档面板模块
// 负责项目归档、恢复、归档列表面板的渲染与交互。
// 通过 window.ArchivePanel.bind(deps) 注入依赖后使用。

(function () {
  let deps = {}

  function getArchiveElements() {
    return {
      button: document.getElementById('btnExcel'),
      panel: document.getElementById('archivePanel'),
      back: document.getElementById('archivePanelBack'),
      search: document.getElementById('archiveSearchInput'),
      list: document.getElementById('archiveProjectList')
    }
  }

  async function archiveProject(projectId) {
    deps.syncProjectState()
    const projects = deps.getProjects()
    const project = projects.find(p => p.id === projectId)
    if (!project) return
    deps.projectStore.setProjectArchived?.(project.id, true)
    deps.syncProjectState()

    const visibleProjects = deps.getProjects().filter(p => !p.archived)
    if (visibleProjects.length === 0) {
      await deps.enterNoProjectState()
      deps.showToast(`已归档项目：${project.name || project.path}`, 'success')
      return
    }
    if (deps.getActiveProjectId() === project.id && visibleProjects.length > 0) {
      await deps.switchProject(visibleProjects[0].id)
    } else {
      await deps.saveProjectsList(deps.getActiveProject()?.path || project.path || '')
      deps.renderProjectList()
    }
    deps.showToast(`已归档项目：${project.name || project.path}`, 'success')
  }

  async function restoreArchivedProject(projectId, shouldSwitch = false) {
    deps.syncProjectState()
    const projects = deps.getProjects()
    const project = projects.find(p => p.id === projectId)
    if (!project) return
    deps.projectStore.setProjectArchived?.(project.id, false)
    deps.syncProjectState()
    await deps.saveProjectsList(deps.getActiveProject()?.path || project.path || '')
    deps.renderProjectList()
    renderArchivePanel()
    deps.showToast(`已放回项目列表：${project.name || project.path}`, 'success')
    if (shouldSwitch) await deps.switchProject(project.id)
  }

  function renderArchivePanel(filter = '') {
    const els = getArchiveElements()
    if (!els.list) return
    deps.syncProjectState()
    const keyword = String(filter || els.search?.value || '').trim().toLowerCase()
    const archivedProjects = deps.getProjects().filter(project => {
      if (!project.archived) return false
      return !keyword || deps.getProjectSearchName(project).includes(keyword)
    })
    if (archivedProjects.length === 0) {
      els.list.innerHTML = ((window.i18n?.t?.('auto.js_app_429_5') ?? '<div class="archive-empty">暂无归档项目</div>'))
      return
    }
    els.list.innerHTML = archivedProjects.map(project => `
      <div class="archive-project-card" data-id="${deps.escapeHtml(project.id)}" title="${deps.escapeHtml(project.path || '')}">
        <div class="archive-project-name">${deps.escapeHtml(project.name || ((window.i18n?.t?.('auto.js_app_434_6') ?? '未命名项目')))}</div>
        <div class="archive-project-path">${deps.escapeHtml(project.path || '')}</div>
        <div class="archive-project-actions">
          <button class="archive-restore-btn" type="button" data-id="${deps.escapeHtml(project.id)}">放回列表</button>
        </div>
      </div>
    `).join('')
    els.list.querySelectorAll('.archive-restore-btn').forEach(button => {
      button.addEventListener('click', event => {
        event.stopPropagation()
        restoreArchivedProject(button.dataset.id)
      })
    })
    els.list.querySelectorAll('.archive-project-card').forEach(card => {
      card.addEventListener('dblclick', () => restoreArchivedProject(card.dataset.id, true))
    })
  }

  function closeArchivePanel() {
    getArchiveElements().panel?.classList.remove('show')
  }

  function openArchivePanel() {
    const els = getArchiveElements()
    window.LingxiPanelManager?.openExclusive?.('archive')
    if (els.search) els.search.value = ''
    renderArchivePanel()
  }

  function bindArchivePanel() {
    const els = getArchiveElements()
    if (!els.button) return
    els.button.onclick = openArchivePanel
    els.back?.addEventListener('click', closeArchivePanel)
    els.search?.addEventListener('input', () => renderArchivePanel(els.search.value))
    els.button.addEventListener('dragover', event => {
      event.preventDefault()
      els.button.classList.add('drag-over')
    })
    els.button.addEventListener('dragleave', () => {
      els.button.classList.remove('drag-over')
    })
    els.button.addEventListener('drop', event => {
      event.preventDefault()
      els.button.classList.remove('drag-over')
      els.button.classList.remove('drag-ready')
      const projectId = event.dataTransfer.getData('text/plain')
      if (projectId) archiveProject(projectId)
    })
    window.addEventListener('lingxi-project-drag-start', () => {
      els.button.classList.add('drag-ready')
    })
    window.addEventListener('lingxi-project-drag-end', () => {
      els.button.classList.remove('drag-ready')
      els.button.classList.remove('drag-over')
    })
  }

  function bind(depsObj = {}) {
    deps = depsObj
  }

  window.ArchivePanel = {
    bind,
    getArchiveElements,
    archiveProject,
    restoreArchivedProject,
    renderArchivePanel,
    closeArchivePanel,
    openArchivePanel,
    bindArchivePanel
  }
})()
