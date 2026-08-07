(function () {
  const escapeHtml = window.HtmlUtils?.escapeHtml || function (value) {
    return String(value ?? '').replace(/[&<>"']/g, char => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    }[char]))
  }

  function normalizePathKey(filePath = '') {
    return String(filePath || '').replace(/\\/g, '/').replace(/\/+/g, '/').toLowerCase()
  }

  function isSamePathLike(left = '', right = '') {
    const a = normalizePathKey(left)
    const b = normalizePathKey(right)
    if (!a || !b) return false
    return a === b || a.endsWith('/' + b) || b.endsWith('/' + a)
  }

  function getDisplayPath(filePath = '', projectPath = '') {
    // 操作摘要文件列表显示完整路径，不再截成最后两段
    const raw = String(filePath || '').trim()
    if (!raw) return ''
    const isAbs = /^[A-Za-z]:[\\/]/.test(raw) || raw.startsWith('\\') || raw.startsWith('/')
    let full = raw
    if (!isAbs && projectPath) {
      const root = String(projectPath || '').replace(/[\\/]+$/, '')
      full = `${root}\\${raw.replace(/^[\\/]+/, '')}`
    }
    return full.replace(/\\/g, '/')
  }

  function isSamePathLikeLoose(left = '', right = '') {
    return isSamePathLike(left, right)
  }

  function computeLineDelta(beforeText, afterText) {
    if (window.AiMessageUI?.calculateEditLines) {
      const delta = window.AiMessageUI.calculateEditLines(beforeText, afterText)
      return {
        add: Math.max(0, Number(delta?.add) || 0),
        remove: Math.max(0, Number(delta?.remove) || 0)
      }
    }
    const before = beforeText == null ? '' : String(beforeText)
    const after = afterText == null ? '' : String(afterText)
    if (before === after) return { add: 0, remove: 0 }
    const oldLines = before.split(/\r\n|\r|\n/)
    const newLines = after.split(/\r\n|\r|\n/)
    if (oldLines.length > 5000 || newLines.length > 5000) {
      return {
        add: Math.max(0, newLines.length - oldLines.length),
        remove: Math.max(0, oldLines.length - newLines.length)
      }
    }
    let prefix = 0
    const maxPrefix = Math.min(oldLines.length, newLines.length)
    while (prefix < maxPrefix && oldLines[prefix] === newLines[prefix]) prefix++
    let suffix = 0
    const maxSuffix = Math.min(oldLines.length - prefix, newLines.length - prefix)
    while (
      suffix < maxSuffix &&
      oldLines[oldLines.length - 1 - suffix] === newLines[newLines.length - 1 - suffix]
    ) suffix++
    return {
      add: Math.max(0, newLines.length - prefix - suffix),
      remove: Math.max(0, oldLines.length - prefix - suffix)
    }
  }

  function resolveAction(file = {}) {
    const raw = String(file.action || '').toLowerCase()
    if (raw === 'create' || raw === 'add' || raw === 'write') return 'create'
    if (raw === 'delete' || raw === 'remove') return 'delete'
    if (file.existedBefore === false && file.existsAfter !== false) return 'create'
    if (file.existedBefore && file.existsAfter === false) return 'delete'
    return 'modify'
  }

  function getOperationSnapshotFiles(options = {}, changeSession = null) {
    // 优先使用消息级持久化快照：切项目后内存胶囊被清空，历史回显仍可恢复操作量
    const persisted = options.operationSnapshot
    if (persisted && Array.isArray(persisted.files) && persisted.files.length) {
      return persisted.files.map(file => ({
        path: file.path,
        action: file.action || 'modify',
        added: Math.max(0, Number(file.added) || 0),
        removed: Math.max(0, Number(file.removed) || 0)
      }))
    }
    // 实时态：从内存胶囊取同口径操作量
    const sessionId = String(
      options.sessionId ||
      changeSession?.id ||
      changeSession?.sessionId ||
      ''
    ).trim()
    const snapshot = window.aiChangePill?.getOperationSnapshot?.({ sessionId })
      || window.AiChangePill?.getActiveSnapshot?.({ sessionId })
      || null
    if (!snapshot || !Array.isArray(snapshot.files) || !snapshot.files.length) return null
    return snapshot.files.map(file => ({
      path: file.path,
      action: file.action || 'modify',
      added: Math.max(0, Number(file.added) || 0),
      removed: Math.max(0, Number(file.removed) || 0)
    }))
  }

  function buildFileEntries(stats = {}, changeSession = null, options = {}) {
    const canonicalSessionFiles = Array.isArray(changeSession?.files)
      ? changeSession.files
      : (changeSession?.files && typeof changeSession.files === 'object' ? Object.values(changeSession.files) : [])
    if (canonicalSessionFiles.length) {
      return canonicalSessionFiles.map(file => ({
        path: file?.path || file?.file || file?.file_path || '',
        action: resolveAction(file || {}),
        added: Math.max(0, Number(file?.additions ?? file?.added) || 0),
        removed: Math.max(0, Number(file?.deletions ?? file?.removed) || 0)
      })).filter(file => file.path)
    }
    // 优先使用胶囊同口径的“工具操作量”，避免全文 diff 把数字放大
    const operationFiles = getOperationSnapshotFiles(options, changeSession)
    if (operationFiles?.length) return operationFiles

    const map = new Map()

    const upsert = (pathValue, patch = {}) => {
      const filePath = String(pathValue || '').trim()
      if (!filePath) return
      let key = normalizePathKey(filePath)
      for (const [existingKey, existing] of map.entries()) {
        if (isSamePathLike(existing.path, filePath)) {
          key = existingKey
          map.set(key, {
            ...existing,
            ...patch,
            path: existing.path.length >= filePath.length ? existing.path : filePath,
            added: Math.max(Number(existing.added) || 0, Number(patch.added) || 0),
            removed: Math.max(Number(existing.removed) || 0, Number(patch.removed) || 0),
            action: existing.action === 'create' || patch.action === 'create'
              ? 'create'
              : (existing.action === 'delete' || patch.action === 'delete' ? 'delete' : (patch.action || existing.action || 'modify'))
          })
          return
        }
      }
      map.set(key, {
        path: filePath,
        action: patch.action || 'modify',
        added: Math.max(0, Number(patch.added) || 0),
        removed: Math.max(0, Number(patch.removed) || 0)
      })
    }

    ;(Array.isArray(stats.modified) ? stats.modified : []).forEach(pathValue => {
      upsert(pathValue, { action: 'modify' })
    })
    ;(Array.isArray(stats.created) ? stats.created : []).forEach(pathValue => {
      upsert(pathValue, { action: 'create' })
    })

    // 兜底：只有拿不到操作量时，才退回 session 文件列表，且不计算全文 diff
    const sessionFiles = Array.isArray(changeSession?.files)
      ? changeSession.files
      : (changeSession?.files && typeof changeSession.files === 'object'
        ? Object.values(changeSession.files)
        : [])

    sessionFiles.forEach(file => {
      const filePath = file?.path || file?.file || file?.file_path || ''
      if (!filePath) return
      const action = resolveAction(file)
      upsert(filePath, {
        action,
        added: 0,
        removed: 0
      })
    })

    return Array.from(map.values())
  }

  function renderDiffStat(added, removed) {
    const add = Math.max(0, Number(added) || 0)
    const remove = Math.max(0, Number(removed) || 0)
    if (add <= 0 && remove <= 0) {
      return '<span class="summary-diff-stat muted">·</span>'
    }
    return [
      add > 0 ? `<span class="summary-diff-add">+${add}</span>` : '',
      remove > 0 ? `<span class="summary-diff-remove">-${remove}</span>` : ''
    ].filter(Boolean).join('')
  }

  function generate(stats = {}, options = {}) {
    const actionHtml = options.actionHtml || ''
    const changeSession = options.changeSession || null
    const operationSnapshot = options.operationSnapshot || null
    const projectPath = options.projectPath || window.getActiveProject?.()?.path || ''
    // 生成文件条目时透传持久化快照，保证历史回显也能拿到操作量
    const files = buildFileEntries(stats, changeSession, { ...options, operationSnapshot })
    if (!files.length && !actionHtml) return ''

    const totalAdded = files.reduce((sum, file) => sum + (Number(file.added) || 0), 0)
    const totalRemoved = files.reduce((sum, file) => sum + (Number(file.removed) || 0), 0)
    const sessionId = String(changeSession?.id || changeSession?.sessionId || operationSnapshot?.sessionId || '')
    // 默认只显示前 3 个文件，其余点击“展开”后显示，可再收起
    const visibleLimit = 3
    const rows = files.map((file, index) => {
      const isExtra = index >= visibleLimit
      const rowClass = isExtra ? 'summary-file-row is-extra is-collapsed' : 'summary-file-row'
      const hiddenAttr = isExtra ? ' hidden' : ''
      const fullPath = getDisplayPath(file.path, projectPath)
      const hasDiff = (Number(file.added) || 0) > 0 || (Number(file.removed) || 0) > 0
      const diffHtml = renderDiffStat(file.added, file.removed)
      // 仅文件行右侧 +N -N 可点，顶部总统计不可点
      const diffControl = hasDiff
        ? `<button type="button" class="summary-file-diff is-clickable" data-path="${encodeURIComponent(file.path)}" data-session-id="${encodeURIComponent(sessionId)}" onclick="openSummaryFileDiff(event, this)" title="查看改前改后">${diffHtml}</button>`
        : `<span class="summary-file-diff">${diffHtml}</span>`
      return `
        <div class="${rowClass}"${hiddenAttr}>
          <button type="button" class="summary-file-path" title="${escapeHtml(fullPath)}" data-path="${encodeURIComponent(file.path)}" onclick="openFilePreviewFromData(this)" oncontextmenu="showSummaryFileMenu(event, this)">
            ${escapeHtml(fullPath)}
          </button>
          ${diffControl}
        </div>
      `
    }).join('')
    const remaining = Math.max(0, files.length - visibleLimit)
    const moreHtml = remaining > 0
      ? `<button type="button" class="summary-more-files" data-remaining="${remaining}" aria-expanded="false" onclick="expandSummaryMore(event, this)">展开其余 ${remaining} 个文件</button>`
      : ''

    return `
      <div class="ai-summary compact-diff" data-session-id="${encodeURIComponent(sessionId)}">
        <div class="summary-header">
          <div class="summary-title-block">
            <div class="summary-title">
              <span class="summary-title-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
              </span>
              <span>已编辑 ${files.length} 个文件</span>
            </div>
            <div class="summary-total-diff">${renderDiffStat(totalAdded, totalRemoved)}</div>
          </div>
          ${actionHtml}
        </div>
        ${files.length ? `<div class="summary-file-list" data-session-id="${encodeURIComponent(sessionId)}">${rows}${moreHtml}</div>` : ''}
      </div>
    `
  }

  function normalizeSessionFilesForDiff(session = {}, operationFiles = null) {
    const raw = Array.isArray(session.files)
      ? session.files
      : (session.files && typeof session.files === 'object' ? Object.values(session.files) : [])
    const opMap = new Map()
    ;(Array.isArray(operationFiles) ? operationFiles : []).forEach(file => {
      const key = normalizePathKey(file.path || '')
      if (!key) return
      opMap.set(key, file)
    })

    // 有操作量时：展示数字以操作量为准；全文内容仅用于预览
    if (opMap.size) {
      const sessionMap = new Map()
      raw.forEach(file => {
        const pathValue = file?.path || file?.file || file?.file_path || ''
        if (!pathValue) return
        sessionMap.set(normalizePathKey(pathValue), file)
      })
      return Array.from(opMap.values()).map(opFile => {
        const sessionFile = sessionMap.get(normalizePathKey(opFile.path)) || {}
        const beforeText = sessionFile?.beforeText ?? sessionFile?.beforeContent ?? opFile.beforeText ?? ''
        const afterText = sessionFile?.afterText ?? sessionFile?.afterContent ?? opFile.afterText ?? ''
        return {
          path: opFile.path,
          action: opFile.action || resolveAction(sessionFile || {}) || 'modify',
          added: Math.max(0, Number(opFile.added) || 0),
          removed: Math.max(0, Number(opFile.removed) || 0),
          beforeText,
          afterText,
          previewMode: (beforeText || afterText) ? 'full' : (opFile.previewMode || 'summary'),
          canApplyFix: Boolean(opFile.canApplyFix || sessionFile?.canApplyFix)
        }
      }).filter(item => item.path)
    }

    return raw.map(file => {
      const pathValue = file?.path || file?.file || file?.file_path || ''
      const action = resolveAction(file || {})
      const beforeText = file?.beforeText ?? file?.beforeContent ?? ''
      const afterText = file?.afterText ?? file?.afterContent ?? ''
      return {
        path: pathValue,
        action,
        added: Math.max(0, Number(file?.additions ?? file?.added) || 0),
        removed: Math.max(0, Number(file?.deletions ?? file?.removed) || 0),
        beforeText,
        afterText,
        previewMode: (beforeText || afterText) ? 'full' : 'summary',
        canApplyFix: Boolean(file?.canApplyFix)
      }
    }).filter(item => item.path)
  }

  async function openSummaryFileDiff(event, el) {
    try {
      if (event && typeof event.stopPropagation === 'function') event.stopPropagation()
      if (event && typeof event.preventDefault === 'function') event.preventDefault()
      if (!el) return

      const filePath = decodeURIComponent(el.dataset.path || '')
      if (!filePath) return

      const root = el.closest('.ai-summary')
      const sessionId = decodeURIComponent(
        el.dataset.sessionId ||
        root?.dataset.sessionId ||
        root?.querySelector('.summary-actions')?.dataset.sessionId ||
        root?.querySelector('.summary-file-list')?.dataset.sessionId ||
        ''
      )

      const project = window.getActiveProject?.() || null
      let files = []
      let loadedChangeSession = false
      let summary = { added: 0, removed: 0, fileCount: 0 }
      const operationSnapshot = window.aiChangePill?.getOperationSnapshot?.({ sessionId })
        || window.AiChangePill?.getActiveSnapshot?.({ sessionId })
        || null
      const operationFiles = Array.isArray(operationSnapshot?.files) ? operationSnapshot.files : null

      if (project?.id && sessionId && window.api?.getChangeSession) {
        try {
          const result = await window.api.getChangeSession(project.id, sessionId)
          if (result?.success && result.session) {
            files = normalizeSessionFilesForDiff(result.session)
            loadedChangeSession = true
          }
        } catch (_err) { /* fall through */ }
      }

      // 优先直接用操作量快照，避免会话全文数字污染
      if (!files.length && operationFiles?.length) {
        files = operationFiles.map(file => ({
          path: file.path,
          action: file.action || 'modify',
          added: Math.max(0, Number(file.added) || 0),
          removed: Math.max(0, Number(file.removed) || 0),
          beforeText: file.beforeText || '',
          afterText: file.afterText || '',
          previewMode: file.previewMode || 'summary',
          canApplyFix: Boolean(file.canApplyFix)
        }))
      }

      // 会话拉不到时，至少用当前卡片路径占位打开
      if (!files.length) {
        files = [{
          path: filePath,
          action: 'modify',
          added: 0,
          removed: 0,
          beforeText: '',
          afterText: '',
          previewMode: 'summary'
        }]
      }

      if (!loadedChangeSession && operationSnapshot?.summary) {
        summary.fileCount = Number(operationSnapshot.summary.fileCount) || files.length
        summary.added = Number(operationSnapshot.summary.added) || 0
        summary.removed = Number(operationSnapshot.summary.removed) || 0
      } else {
        summary.fileCount = files.length
        summary.added = files.reduce((sum, file) => sum + (Number(file.added) || 0), 0)
        summary.removed = files.reduce((sum, file) => sum + (Number(file.removed) || 0), 0)
      }

      let selectedIndex = files.findIndex(file => isSamePathLikeLoose(file.path, filePath))
      if (selectedIndex < 0) selectedIndex = 0

      const openTab = window.windowTabsFeature?.createChangeDiffTab
        || window.WindowTabs?.createChangeDiffTab
        || null

      // app.js 通常把 createChangeDiffTab 挂在 windowTabsFeature 上
      if (typeof window.openSummaryChangeDiff === 'function') {
        window.openSummaryChangeDiff({
          title: 'AI 本轮改动',
          files,
          summary,
          selectedPath: filePath,
          selectedIndex
        })
        return
      }

      if (typeof openTab === 'function') {
        openTab({
          title: 'AI 本轮改动',
          files,
          summary,
          selectedPath: filePath,
          selectedIndex
        })
        return
      }

      window.showToast?.('右侧 diff 面板暂不可用', 'error')
    } catch (error) {
      window.showToast?.(error?.message || '打开文件 diff 失败', 'error')
    }
  }

  function expandSummaryMore(event, el) {
    try {
      if (event && typeof event.stopPropagation === 'function') event.stopPropagation()
      if (event && typeof event.preventDefault === 'function') event.preventDefault()
      if (!el) return
      const container = el.closest('.summary-file-list') || el.parentNode
      if (!container) return

      const extras = container.querySelectorAll('.summary-file-row.is-extra')
      const remaining = Number(el.dataset.remaining) || extras.length
      const expanded = el.getAttribute('aria-expanded') === 'true'

      if (expanded) {
        // 收起：只保留前 3 个可见
        extras.forEach(node => {
          node.setAttribute('hidden', '')
          node.classList.add('is-collapsed')
        })
        el.setAttribute('aria-expanded', 'false')
        el.textContent = `展开其余 ${remaining} 个文件`
      } else {
        // 展开：显示全部文件
        extras.forEach(node => {
          node.removeAttribute('hidden')
          node.classList.remove('is-collapsed')
        })
        el.setAttribute('aria-expanded', 'true')
        el.textContent = '收起'
      }
    } catch (_err) { /* noop */ }
  }

  // 兼容旧折叠接口
  function toggleSummarySection(event, headEl) {
    try {
      if (event && typeof event.stopPropagation === 'function') event.stopPropagation()
      const section = headEl && headEl.parentNode
      if (!section || !section.classList) return
      section.classList.toggle('expanded')
    } catch (_err) { /* noop */ }
  }

  window.toggleSummarySection = toggleSummarySection
  window.expandSummaryMore = expandSummaryMore
  window.openSummaryFileDiff = openSummaryFileDiff
  window.OperationSummary = { generate, openSummaryFileDiff }
})()
