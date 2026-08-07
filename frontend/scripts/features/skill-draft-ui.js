(function () {
  let deps = {}

  function escapeHtml(value = '') {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;')
  }

  function showToast(message, type = 'info') {
    if (deps.showToast) return deps.showToast(message, type)
    if (window.showToast) return window.showToast(message, type)
  }

  function getActiveProjectId() {
    return deps.getActiveProjectId?.() || window.ProjectStore?.getActiveProjectId?.() || ''
  }

  function getProjectPath(projectId = '') {
    const project = deps.getProjectById?.(projectId) || deps.getActiveProject?.()
    return project?.path || ''
  }

  function getDraft(result = {}) {
    return result?.draft || result?.skillDraft || null
  }

  function getDraftPath(result = {}, draft = {}) {
    return result.path || draft.skillPath || draft.path || ''
  }

  function normalizeScope(value = '') {
    return String(value || '').trim().toLowerCase() === 'project' ? 'project' : 'global'
  }

  function renderDraftBody(draft = {}, result = {}) {
    const description = draft.description || result.description || ''
    const source = draft.sourceSummary || draft.source_summary || ''
    const relatedFiles = Array.isArray(draft.relatedFiles) ? draft.relatedFiles : []
    const bits = []
    if (description) bits.push(`<span>${escapeHtml(description)}</span>`)
    if (source) bits.push(`<span>${escapeHtml(source)}</span>`)
    if (relatedFiles.length) {
      bits.push(`<span>${escapeHtml(relatedFiles.slice(0, 3).join('、'))}${relatedFiles.length > 3 ? ' ...' : ''}</span>`)
    }
    return bits.length ? bits.join('') : ''
  }

  async function installDraftToScope(item = {}, targetScope = 'global') {
    const scope = normalizeScope(targetScope)
    const result = await window.api?.installProjectSkillDraft?.(item.projectPath, item.draftId, {
      scope,
      draft_scope: normalizeScope(item.scope || item.draftScope || 'global')
    })
    if (!result?.success) {
      showToast(result?.error || '技能安装失败', 'error')
      return false
    }
    const scopeLabel = scope === 'project' ? '项目' : '全局'
    showToast(`已保存为${scopeLabel}技能：${result.skill?.title || result.skill?.name || item.title}`, 'success')
    await deps.reloadSkills?.()
    return true
  }

  async function installGlobalDraft(item = {}) {
    return installDraftToScope(item, 'global')
  }

  async function installProjectDraft(item = {}) {
    return installDraftToScope(item, 'project')
  }

  async function deleteDraft(item = {}) {
    const result = await window.api?.deleteProjectSkillDraft?.(item.projectPath, item.draftId, {
      scope: normalizeScope(item.scope || item.draftScope || 'global')
    })
    if (!result?.success) {
      showToast(result?.error || '技能草稿删除失败', 'error')
      return false
    }
    showToast('已丢弃本次技能草稿', 'info')
    return true
  }

  async function openDraft(item = {}) {
    const filePath = item.path || ''
    if (!filePath) return false
    if (window.openFilePreviewFromData) {
      const el = document.createElement('span')
      el.dataset.path = filePath
      window.openFilePreviewFromData(el)
      return false
    }
    await window.api?.showItemInFolder?.(filePath)
    return false
  }

  function enqueueDraft({ projectId = '', projectPath = '', result = {} } = {}) {
    const draft = getDraft(result)
    if (!draft?.id) return
    const resolvedProjectPath = projectPath || getProjectPath(projectId)
    const scope = normalizeScope(draft.scope || result.scope || 'global')
    const title = draft.title || draft.name || '经验技能草稿'
    const filePath = getDraftPath(result, draft)
    const actions = [
      { id: 'install-global', label: '保存到全局技能库', kind: 'primary', handler: installGlobalDraft }
    ]
    if (resolvedProjectPath) {
      actions.push({ id: 'install-project', label: '仅此项目', kind: 'secondary', handler: installProjectDraft })
    }
    actions.push(
      { id: 'open', label: '打开草稿', kind: 'secondary', handler: openDraft },
      { id: 'delete', label: '丢弃草稿', kind: 'danger', handler: deleteDraft }
    )

    window.HandoffConfirmationQueue?.enqueue?.({
      id: `skill-draft:${projectId || getActiveProjectId()}:${draft.id}`,
      type: 'project-skill-draft',
      projectId: projectId || getActiveProjectId(),
      projectPath: resolvedProjectPath,
      draftId: draft.id,
      scope,
      path: filePath,
      title,
      className: 'skill-draft-handoff',
      meta: `${scope === 'project' ? '已生成项目技能草稿' : '已生成全局技能草稿'} · ${draft.name || draft.id}`,
      bodyHtml: renderDraftBody(draft, result),
      actions
    })
  }

  function handleToolResult(data = {}) {
    if (data.name !== 'create_skill_draft') return
    const result = data.result || {}
    if (!result.success || !result.draft?.id) return
    enqueueDraft({
      projectId: data.projectId || '',
      projectPath: data.projectPath || '',
      result
    })
  }

  function bind(nextDeps = {}) {
    deps = nextDeps || {}
  }

  window.SkillDraftUI = {
    bind,
    handleToolResult,
    enqueueDraft
  }
})()
