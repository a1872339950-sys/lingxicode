(function () {
  const WRITE_TOOLS = new Set([
    'write_file',
    'edit_file',
    'delete_file',
    'create_directory',
    'render_svg_asset',
    'apply_patch',
    'text_edit',
    'json_edit',
    'copy_file',
    'move_file'
  ])

  // 媒体产物会在工具卡中单独展示，不能作为代码 diff 或文件编辑统计。
  const MEDIA_TOOL_NAMES = new Set([
    'generate_image',
    'generate_video',
    'generate_music',
    'text_to_speech',
    'media_process',
    'render_svg_asset'
  ])

  const MEDIA_FILE_EXTENSIONS = new Set([
    'png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'ico', 'avif', 'tif', 'tiff',
    'mp3', 'wav', 'aac', 'm4a', 'flac', 'ogg', 'opus',
    'mp4', 'webm', 'mov', 'avi', 'mkv', 'm4v'
  ])

  function isMediaPath(filePath = '') {
    const cleanPath = String(filePath || '').trim().split(/[?#]/, 1)[0]
    const match = cleanPath.match(/\.([a-z0-9]+)$/i)
    return Boolean(match && MEDIA_FILE_EXTENSIONS.has(match[1].toLowerCase()))
  }

  function isMediaArtifact(name = '', args = {}, result = {}) {
    if (MEDIA_TOOL_NAMES.has(String(name || '').trim())) return true
    return isMediaPath(getFilePath(args, result))
  }

  function getFilePath(args = {}, result = {}) {
    return args.path ||
      args.filePath ||
      args.file_path ||
      args.outputPath ||
      args.output_path ||
      args.destination ||
      args.to ||
      result.path ||
      result.filePath ||
      result.file_path ||
      result.destination ||
      ''
  }

  function getEditOldContent(args = {}) {
    return args.old_content ?? args.old_string ?? args.old ?? ''
  }

  function getEditNewContent(args = {}) {
    return args.new_content ?? args.new_string ?? args.new ?? args.content ?? args.svg_content ?? ''
  }

  function countLines(value) {
    const text = String(value || '')
    if (!text) return 0
    return Math.max(1, text.split(/\r\n|\r|\n/).length)
  }

  function countEditLineUnits(value) {
    const text = String(value || '')
    if (!text) return 0
    const lines = text.split(/\r\n|\r|\n/)
    if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop()
    return Math.max(1, lines.length)
  }

  function calculateLineDelta(oldText, newText) {
    // Prefer the shared diff algorithm; fall back to a local prefix/suffix delta.
    if (window.AiMessageUI?.calculateEditLines) {
      return window.AiMessageUI.calculateEditLines(oldText, newText)
    }
    return computeLocalLineDelta(oldText, newText)
  }

  function computeLocalLineDelta(oldText, newText) {
    const oldSource = oldText == null ? '' : String(oldText)
    const newSource = newText == null ? '' : String(newText)
    if (oldSource === newSource) return { add: 0, remove: 0 }
    const oldLines = oldSource.split(/\r\n|\r|\n/)
    const newLines = newSource.split(/\r\n|\r|\n/)
    // 大文件回退到简单行数差，避免 O(n²) 内存/算力压力
    const HARD_LIMIT = 5000
    if (oldLines.length > HARD_LIMIT || newLines.length > HARD_LIMIT) {
      const add = Math.max(0, newLines.length - oldLines.length)
      const remove = Math.max(0, oldLines.length - newLines.length)
      return { add, remove }
    }
    const n = oldLines.length
    const m = newLines.length
    let prefix = 0
    const maxPrefix = Math.min(n, m)
    while (prefix < maxPrefix && oldLines[prefix] === newLines[prefix]) prefix++
    let suffix = 0
    const maxSuffix = Math.min(n - prefix, m - prefix)
    while (
      suffix < maxSuffix &&
      oldLines[n - 1 - suffix] === newLines[m - 1 - suffix]
    ) suffix++
    const removed = Math.max(0, n - prefix - suffix)
    const added = Math.max(0, m - prefix - suffix)
    if (added === 0 && removed === 0) return { add: 1, remove: 1 }
    return { add: added, remove: removed }
  }

  function parsePatchFileDeltas(patch = '') {
    const map = new Map()
    let currentPath = ''
    const ensure = pathValue => {
      const key = String(pathValue || '').trim()
      if (!key) return null
      if (!map.has(key)) map.set(key, { path: key, add: 0, remove: 0 })
      return map.get(key)
    }
    String(patch || '').split(/\r\n|\r|\n/).forEach(line => {
      const addMatch = line.match(/^\*\*\* Add File:\s*(.+)$/)
      const updateMatch = line.match(/^\*\*\* Update File:\s*(.+)$/)
      const deleteMatch = line.match(/^\*\*\* Delete File:\s*(.+)$/)
      const moveMatch = line.match(/^\*\*\* Move to:\s*(.+)$/)
      if (addMatch || updateMatch || deleteMatch) {
        currentPath = (addMatch || updateMatch || deleteMatch)[1].trim()
        ensure(currentPath)
        return
      }
      if (moveMatch) {
        currentPath = moveMatch[1].trim()
        ensure(currentPath)
        return
      }
      if (!currentPath || line.startsWith('***') || line.startsWith('@@')) return
      const item = ensure(currentPath)
      if (!item) return
      if (line.startsWith('+')) item.add += 1
      else if (line.startsWith('-')) item.remove += 1
    })
    return map
  }

  function parsePatchFilePreviews(patch = '') {
    const files = []
    let current = null
    const pushCurrent = () => {
      if (!current?.path) return
      const beforeText = current.beforeLines.join('\n')
      const afterText = current.afterLines.join('\n')
      files.push({
        path: current.path,
        action: current.action || 'modify',
        added: current.added,
        removed: current.removed,
        beforeText,
        afterText,
        previewMode: beforeText || afterText ? 'snippet' : 'summary',
        canApplyFix: false
      })
    }

    String(patch || '').split(/\r\n|\r|\n/).forEach(line => {
      const addMatch = line.match(/^\*\*\* Add File:\s*(.+)$/)
      const updateMatch = line.match(/^\*\*\* Update File:\s*(.+)$/)
      const deleteMatch = line.match(/^\*\*\* Delete File:\s*(.+)$/)
      const moveMatch = line.match(/^\*\*\* Move to:\s*(.+)$/)
      if (addMatch || updateMatch || deleteMatch) {
        pushCurrent()
        current = {
          path: (addMatch || updateMatch || deleteMatch)[1].trim(),
          action: addMatch ? 'create' : deleteMatch ? 'delete' : 'modify',
          beforeLines: [],
          afterLines: [],
          added: 0,
          removed: 0
        }
        return
      }
      if (!current) return
      if (moveMatch) {
        current.path = moveMatch[1].trim()
        return
      }
      if (/^@@/.test(line) || /^\*\*\*/.test(line) || line === '\\ No newline at end of file') return
      const marker = line[0]
      const text = line.slice(1)
      if (marker === '+') {
        current.afterLines.push(text)
        current.added += 1
      } else if (marker === '-') {
        current.beforeLines.push(text)
        current.removed += 1
      } else if (marker === ' ') {
        current.beforeLines.push(text)
        current.afterLines.push(text)
      }
    })
    pushCurrent()
    return files
  }

  function getPatchFileChanges(args = {}, result = {}) {
    const deltas = parsePatchFileDeltas(args.patch || '')
    const files = Array.isArray(result.files) ? result.files : []
    const paths = new Set()
    files.forEach(item => {
      const filePath = item.path || item.file || item.to || item.destination || ''
      if (filePath) paths.add(filePath)
    })
    deltas.forEach((_, filePath) => paths.add(filePath))
    return [...paths].map(filePath => {
      const file = files.find(item => (item.path || item.file || item.to || item.destination || '') === filePath) || {}
      const delta = deltas.get(filePath) || {}
      const action = String(file.action || 'modify').toLowerCase()
      return {
        path: filePath,
        action: action === 'add' ? 'create' : action === 'delete' ? 'delete' : 'modify',
        added: Math.max(0, Number(file.added || file.additions || file.add || delta.add || (action === 'add' ? file.line_count : 0) || 0)),
        removed: Math.max(0, Number(file.removed || file.deletions || file.remove || delta.remove || (action === 'delete' ? file.line_count : 0) || 0))
      }
    }).filter(item => item.path)
  }

  function getResultLineDelta(result = {}) {
    const added = Number(result.added_lines ?? result.addedLines ?? result.added ?? result.additions)
    const removed = Number(result.removed_lines ?? result.removedLines ?? result.removed ?? result.deletions)
    if (Number.isFinite(added) || Number.isFinite(removed)) {
      return {
        add: Math.max(0, Number.isFinite(added) ? added : 0),
        remove: Math.max(0, Number.isFinite(removed) ? removed : 0)
      }
    }
    return null
  }

  function summarizeTextEditArgs(args = {}) {
    const edits = Array.isArray(args.edits) ? args.edits : []
    if (!edits.length) return null
    let added = 0
    let removed = 0
    const beforeParts = []
    const afterParts = []
    edits.forEach(edit => {
      const op = String(edit?.op || '').trim()
      const oldText = String(edit.old_content ?? edit.old ?? '')
      const newText = String(edit.new_content ?? edit.content ?? '')
      if (op === 'replace' || op === 'replace_all' || op === 'replace_lines' || op === 'replace_regex') {
        const delta = calculateLineDelta(oldText, newText)
        added += Number(delta.add) || 0
        removed += Number(delta.remove) || 0
        beforeParts.push(oldText)
        afterParts.push(newText)
      } else if (op === 'delete' || op === 'delete_regex') {
        removed += countEditLineUnits(oldText || edit.pattern || edit.regex || '')
        beforeParts.push(oldText || String(edit.pattern || edit.regex || ''))
      } else if (op.startsWith('insert_') || op === 'insert_at_line') {
        added += countEditLineUnits(newText)
        afterParts.push(newText)
      }
    })
    return {
      add: Math.max(0, added),
      remove: Math.max(0, removed),
      beforeText: beforeParts.filter(Boolean).join('\n\n'),
      afterText: afterParts.filter(Boolean).join('\n\n')
    }
  }

  function classifyTool(name, args = {}) {
    if (name === 'write_file' || name === 'render_svg_asset') return 'create'
    if (name === 'delete_file') return 'delete'
    if (name === 'create_directory') return 'folder'
    if (name === 'edit_file') return 'modify'
    if (args.content || args.svg_content) return 'create'
    return 'modify'
  }

  function summarizeFiles(files) {
    const totals = { added: 0, removed: 0, fileCount: 0, commandCount: 0 }
    files.forEach(file => {
      totals.added += Number(file.added) || 0
      totals.removed += Number(file.removed) || 0
    })
    totals.fileCount = files.length
    return totals
  }

  function stableToolKey(name, args = {}, meta = {}) {
    if (meta.toolCallId) return String(meta.toolCallId)
    const stable = value => {
      if (value === null || value === undefined) return ''
      if (typeof value !== 'object') return String(value)
      if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`
      return `{${Object.keys(value).sort().map(key => `${key}:${stable(value[key])}`).join(',')}}`
    }
    return `${name}:${stable(args)}`
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

  function applyFileContribution(state, file = {}) {
    if (!file.path) return
    const existing = state.files.get(file.path)
    // pending-tool 是临时态，tool 是终态；同 key 的 pending-tool 已经被 removePendingContribution
    // 减回去了，这里如果再出现 pending-tool 是新的 key。同 path 多次 pending-tool 仍按累加处理，
    // 但 pending-tool 不应该与已有 tool 结果累加（那样会翻倍）。
    const existingSource = existing?.source || ''
    const incomingSource = file.source || 'tool'
    const shouldAccumulate = Boolean(existing) && incomingSource !== 'session' && (
      existingSource === incomingSource ||
      existingSource === 'tool' ||
      (existingSource === 'pending-tool' && incomingSource === 'pending-tool')
    )
    const baseAdded = shouldAccumulate ? (existing?.added || 0) : 0
    const baseRemoved = shouldAccumulate ? (existing?.removed || 0) : 0
    const nextAction = existingSource === 'pending-tool' && incomingSource === 'tool'
      ? (file.action || existing?.action || 'modify')
      : (existing?.action === 'create' ? 'create' : (file.action || existing?.action || 'modify'))
    state.files.set(file.path, {
      path: file.path,
      action: nextAction,
      added: Math.max(0, baseAdded + (Number(file.added) || 0)),
      removed: Math.max(0, baseRemoved + (Number(file.removed) || 0)),
      beforeText: file.beforeText || existing?.beforeText || '',
      afterText: file.afterText || existing?.afterText || '',
      previewMode: existing?.previewMode === 'full' ? 'full' : (file.previewMode || existing?.previewMode || 'summary'),
      canApplyFix: Boolean(existing?.canApplyFix || file.canApplyFix),
      source: incomingSource
    })
  }

  function removeFileContribution(state, file = {}) {
    if (!file.path) return
    const existing = state.files.get(file.path)
    if (!existing) return
    const added = Math.max(0, (existing.added || 0) - (Number(file.added) || 0))
    const removed = Math.max(0, (existing.removed || 0) - (Number(file.removed) || 0))
    if (added <= 0 && removed <= 0 && existing.source === 'pending-tool') {
      state.files.delete(file.path)
      return
    }
    state.files.set(file.path, { ...existing, added, removed })
  }

  function removePendingContribution(state, key) {
    const pending = state.pendingTools.get(key)
    if (!pending) return
    pending.files.forEach(file => removeFileContribution(state, file))
    state.commandCount = Math.max(0, state.commandCount - (Number(pending.commandCount) || 0))
    state.pendingTools.delete(key)
  }

  function collectToolChanges(name, args = {}, result = {}, source = 'tool') {
    if (!WRITE_TOOLS.has(name) || isMediaArtifact(name, args, result) || result?.success === false || result?.error) return { files: [], commandCount: 0 }
    if (name === 'apply_patch') {
      const previews = parsePatchFilePreviews(args.patch || result.patch || '')
      const fallbackDeltas = getPatchFileChanges(args, result)
      const files = previews.length ? previews : fallbackDeltas
      return {
        files: files.map(file => ({
          ...file,
          beforeText: file.beforeText || '',
          afterText: file.afterText || '',
          previewMode: file.previewMode || 'summary',
          canApplyFix: false,
          source
        })),
        commandCount: 0
      }
    }
    if (name === 'json_edit') {
      const filePath = getFilePath(args, result)
      return {
        files: filePath ? [{
          path: filePath,
          action: 'modify',
          added: 1,
          removed: 1,
          beforeText: '',
          afterText: '',
          previewMode: 'summary',
          canApplyFix: false,
          source
        }] : [],
        commandCount: 0
      }
    }
    const filePath = getFilePath(args, result)
    const action = classifyTool(name, args)
    if (action === 'folder') return { files: [], commandCount: 1 }
    if (!filePath) return { files: [], commandCount: 0 }

    const textEditSummary = name === 'text_edit' ? summarizeTextEditArgs(args) : null
    const beforeText = action === 'delete' ? (result.content || result.oldContent || '') : (textEditSummary?.beforeText || getEditOldContent(args))
    const afterText = action === 'delete' ? '' : (textEditSummary?.afterText || getEditNewContent(args))
    const resultDelta = source === 'tool' ? getResultLineDelta(result) : null
    const delta = resultDelta || (name === 'text_edit' && textEditSummary
      ? textEditSummary
      : action === 'modify'
        ? calculateLineDelta(beforeText, afterText)
      : {
          add: action === 'create' ? countLines(afterText) : 0,
          remove: action === 'delete' ? Math.max(1, countLines(beforeText)) : 0
        })
    const previewMode = action === 'create' ? 'full' : 'snippet'
    return {
      files: [{
        path: filePath,
        action,
        added: Number(delta.add) || 0,
        removed: Number(delta.remove) || 0,
        beforeText,
        afterText,
        previewMode,
        canApplyFix: previewMode === 'full' && !!afterText,
        source
      }],
      commandCount: 0
    }
  }

  function normalizeSessionFile(file = {}) {
    const beforeSize = Number(file.beforeSize) || 0
    const afterSize = Number(file.afterSize) || 0
    const action = String(file.action || 'modify').toLowerCase()
    const beforeText = file.beforeText ?? file.beforeContent ?? ''
    const afterText = file.afterText ?? file.afterContent ?? ''
    let added = 0
    let removed = 0
    if (beforeText || afterText) {
      const delta = action === 'create'
        ? { add: countLines(afterText), remove: 0 }
        : action === 'delete'
          ? { add: 0, remove: countLines(beforeText) }
          : calculateLineDelta(beforeText, afterText)
      added = Math.max(0, Number(delta.add) || 0)
      removed = Math.max(0, Number(delta.remove) || 0)
    } else if (action === 'create') added = Math.max(1, Math.round(afterSize / 42))
    else if (action === 'delete') removed = Math.max(1, Math.round(beforeSize / 42))
    else {
      const delta = afterSize - beforeSize
      if (delta > 0) added = Math.max(1, Math.round(delta / 42))
      if (delta < 0) removed = Math.max(1, Math.round(Math.abs(delta) / 42))
    }
    return {
      path: file.path || '',
      action: action === 'create' || action === 'delete' ? action : 'modify',
      added,
      removed,
      beforeText,
      afterText,
      previewMode: (beforeText || afterText) ? 'full' : 'summary',
      canApplyFix: Boolean(file.canApplyFix),
      source: 'session'
    }
  }

  function mergeSessionTextIntoFiles(files = [], session = {}) {
    const sessionFiles = Array.isArray(session.files) ? session.files.map(normalizeSessionFile) : []
    if (!sessionFiles.length) return files
    return files.map(file => {
      const detail = sessionFiles.find(item => isSamePathLike(item.path, file.path))
      if (!detail || (!detail.beforeText && !detail.afterText)) return file
      // 只借全文内容做 diff 预览，数字始终保持工具操作量
      return {
        ...file,
        action: detail.action || file.action,
        beforeText: detail.beforeText,
        afterText: detail.afterText,
        previewMode: detail.previewMode || 'full',
        canApplyFix: Boolean(file.canApplyFix || detail.canApplyFix)
      }
    })
  }
  function mergeSessionFiles(state, session = {}) {
    const files = Array.isArray(session.files) ? session.files : []
    files.forEach(file => {
      const normalized = normalizeSessionFile(file)
      if (!normalized.path) return
      if (isMediaPath(normalized.path)) return
      const existing = state.files.get(normalized.path)
      if (existing?.source === 'tool') return
      applyFileContribution(state, normalized)
    })
    state.commandCount = Math.max(state.commandCount, Number(session.mutatingCommandCount) || 0)
  }

  function renderDiffNumber(value, direction = 'up') {
    const text = String(Math.max(0, Number(value) || 0))
    const digits = text.split('').map((digit, index) => (
      `<span class="diff-roll-digit" style="--roll-index:${index}">${digit}</span>`
    )).join('')
    return `<span class="diff-roll-number" data-roll-dir="${direction}" aria-label="${text}">${digits}</span>`
  }

  function buildPillHtml(summary) {
    const addText = summary.added > 0 ? `<span class="ai-change-pill-add">+${renderDiffNumber(summary.added, 'up')}</span>` : ''
    const removeText = summary.removed > 0 ? `<span class="ai-change-pill-remove">-${renderDiffNumber(summary.removed, 'down')}</span>` : ''
    const fileText = summary.fileCount > 0 ? `<span class="ai-change-pill-meta ai-change-pill-meta-file">${summary.fileCount} 文件</span>` : ''
    const commandText = summary.commandCount > 0 ? `<span class="ai-change-pill-meta ai-change-pill-meta-cmd">${summary.commandCount} 命令</span>` : ''
    return `
      <button class="ai-change-pill" type="button" title="查看本轮 AI 改动">
        <span class="ai-change-pill-label">审查</span>
        ${addText}
        ${removeText}
        ${fileText}
        ${commandText}
      </button>
    `
  }

  let activePill = null

  function bind(options = {}) {
    const root = options.root || document.getElementById('aiChangePillArea')
    const openInRightView = options.openInRightView || function () {}
    const state = {
      files: new Map(),
      commandCount: 0,
      lastSession: null,
      pendingTools: new Map(),
      prevAdded: 0,
      prevRemoved: 0,
      rollTimers: { add: null, remove: null }
    }

    function getFiles() {
      return Array.from(state.files.values())
    }

    function getSummary() {
      const summary = summarizeFiles(getFiles())
      summary.commandCount = state.commandCount
      return summary
    }

    function animateRollValue(el, from, to, dir, timerKey) {
      if (!el || from === to) { if (el) el.textContent = Math.max(0, to); return }
      if (state.rollTimers[timerKey]) clearInterval(state.rollTimers[timerKey])
      const duration = 520, stepMs = 30
      const totalSteps = Math.max(1, Math.round(duration / stepMs))
      let step = 0
      const renderTick = () => {
        step++
        const val = step >= totalSteps ? to : Math.round(from + (to - from) * (step / totalSteps))
        el.textContent = Math.max(0, val)
        if (step >= totalSteps) { state.rollTimers[timerKey] = null; clearInterval(timer) }
      }
      const timer = setInterval(renderTick, stepMs)
      state.rollTimers[timerKey] = timer
      renderTick()
    }

    function rerender() {
      if (!root) return
      const summary = getSummary()
      if (summary.fileCount <= 0 && summary.commandCount <= 0) {
        root.innerHTML = ''
        state.prevAdded = 0
        state.prevRemoved = 0
        return
      }
      const pill = root.querySelector('.ai-change-pill')
      if (pill) {
        /* ── Subsequent render: update numbers with rolling animation ── */
        const fileEl = pill.querySelector('.ai-change-pill-meta-file')
        if (fileEl) fileEl.textContent = summary.fileCount + ' 文件'
        const cmdEl = pill.querySelector('.ai-change-pill-meta-cmd')
        if (cmdEl) cmdEl.textContent = summary.commandCount + ' 命令'

        const addSpan = pill.querySelector('.ai-change-pill-add')
        if (summary.added > 0) {
          if (!addSpan) {
            const s = document.createElement('span')
            s.className = 'ai-change-pill-add'
            s.innerHTML = '+' + renderDiffNumber(summary.added, 'up')
            const removeSpan = pill.querySelector('.ai-change-pill-remove')
            const metaFile = pill.querySelector('.ai-change-pill-meta-file')
            pill.insertBefore(s, removeSpan || metaFile || null)
          } else {
            updateRollNumber(addSpan, state.prevAdded, summary.added, 'up', 'add')
          }
        } else if (addSpan) {
          addSpan.remove()
        }

        const removeSpan = pill.querySelector('.ai-change-pill-remove')
        if (summary.removed > 0) {
          if (!removeSpan) {
            const s = document.createElement('span')
            s.className = 'ai-change-pill-remove'
            s.innerHTML = '-' + renderDiffNumber(summary.removed, 'down')
            const metaFile = pill.querySelector('.ai-change-pill-meta-file')
            pill.insertBefore(s, metaFile || null)
          } else {
            updateRollNumber(removeSpan, state.prevRemoved, summary.removed, 'down', 'remove')
          }
        } else if (removeSpan) {
          removeSpan.remove()
        }
      } else {
        /* ── First render: full HTML insert (CSS slide-in handles animation) ── */
        root.innerHTML = buildPillHtml(summary)
        const newPill = root.querySelector('.ai-change-pill')
        if (newPill) bindPillClick(newPill, summary)
      }
      state.prevAdded = summary.added
      state.prevRemoved = summary.removed
    }

    function updateRollNumber(span, from, to, dir, timerKey) {
      const numEl = span.querySelector('.diff-roll-number')
      if (!numEl) return
      const digits = numEl.querySelectorAll('.diff-roll-digit')
      const fromStr = String(Math.max(0, from))
      const toStr = String(Math.max(0, to))
      if (fromStr.length !== toStr.length) {
        /* digit count changed (e.g. 9→10): rebuild the number */
        const digitsHtml = toStr.split('').map((d, i) =>
          `<span class="diff-roll-digit" style="--roll-index:${i}">${d}</span>`
        ).join('')
        numEl.innerHTML = digitsHtml
        numEl.setAttribute('data-roll-dir', dir)
        numEl.setAttribute('aria-label', toStr)
        return
      }
      for (let i = 0; i < digits.length; i++) {
        animateRollValue(digits[i], parseInt(fromStr[i], 10), parseInt(toStr[i], 10), dir, timerKey)
      }
    }

    function bindPillClick(pill, summary) {
      pill.onclick = async () => {
        let files = getFiles()
        let openSummary = summary
        const project = options.getActiveProject?.()
        const sessionId = state.lastSession?.id || ''
        if (project?.id && sessionId && options.api?.getChangeSession) {
          try {
            const result = await options.api.getChangeSession(project.id, sessionId)
            if (result?.success && result.session) {
              mergeSessionFiles(state, result.session)
              files = mergeSessionTextIntoFiles(getFiles(), result.session)
              openSummary = summarizeFiles(files)
              openSummary.commandCount = state.commandCount
            }
          } catch (error) {
            options.showToast?.(`读取完整 diff 快照失败: ${error.message}`, 'warning')
          }
        }
        openInRightView({
          title: 'AI 本轮改动',
          files,
          summary: openSummary
        })
      }
    }

    function clear() {
      state.files.clear()
      state.commandCount = 0
      state.lastSession = null
      state.pendingTools.clear()
      state.prevAdded = 0
      state.prevRemoved = 0
      if (state.rollTimers.add) clearInterval(state.rollTimers.add)
      if (state.rollTimers.remove) clearInterval(state.rollTimers.remove)
      state.rollTimers.add = null
      state.rollTimers.remove = null
      if (root) root.innerHTML = ''
    }

    function recordToolStart(name, args = {}, meta = {}) {
      const key = stableToolKey(name, args, meta)
      if (state.pendingTools.has(key)) return
      const change = collectToolChanges(name, args, {}, 'pending-tool')
      if (!change.files.length && !change.commandCount) return
      change.files.forEach(file => applyFileContribution(state, file))
      state.commandCount += Number(change.commandCount) || 0
      state.pendingTools.set(key, change)
      rerender()
    }

    function recordToolResult(name, args = {}, result = {}, meta = {}) {
      const key = stableToolKey(name, args, meta)
      removePendingContribution(state, key)
      const change = collectToolChanges(name, args, result, 'tool')
      if (!change.files.length && !change.commandCount) {
        rerender()
        return
      }
      change.files.forEach(file => applyFileContribution(state, file))
      state.commandCount += Number(change.commandCount) || 0
      rerender()
    }

    function render(session) {
      if (session) {
        state.lastSession = session
        mergeSessionFiles(state, session)
      }
      rerender()
    }

    function getOperationSnapshot(options = {}) {
      const preferSessionId = String(options.sessionId || '').trim()
      const lastSessionId = String(state.lastSession?.id || state.lastSession?.sessionId || '').trim()
      if (preferSessionId && lastSessionId && preferSessionId !== lastSessionId) {
        return null
      }
      const files = getFiles().map(file => ({
        path: file.path,
        action: file.action || 'modify',
        added: Math.max(0, Number(file.added) || 0),
        removed: Math.max(0, Number(file.removed) || 0),
        beforeText: file.beforeText || '',
        afterText: file.afterText || '',
        previewMode: file.previewMode || 'summary',
        canApplyFix: Boolean(file.canApplyFix),
        source: file.source || 'tool'
      }))
      if (!files.length) return null
      const summary = summarizeFiles(files)
      return {
        files,
        summary: {
          added: summary.added,
          removed: summary.removed,
          fileCount: summary.fileCount,
          commandCount: state.commandCount
        },
        sessionId: lastSessionId || preferSessionId || '',
        metric: 'operation'
      }
    }

    const api = {
      clear,
      render,
      recordToolStart,
      recordToolResult,
      getOperationSnapshot
    }
    activePill = api
    return api
  }

  window.AiChangePill = {
    bind,
    getActiveSnapshot(options = {}) {
      return activePill?.getOperationSnapshot?.(options) || null
    }
  }
})()
