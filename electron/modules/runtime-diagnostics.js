const MAX_EVENTS = 500
const DEFAULT_LIMIT = 40

const events = []
const attachedWebContents = new WeakSet()
let consoleCaptureInstalled = false
let appCaptureInstalled = false
let nextSequence = 1

function nowIso() {
  return new Date().toISOString()
}

function clip(value, max = 2000) {
  const text = String(value == null ? '' : value)
  return text.length > max ? `${text.slice(0, max)}...[truncated ${text.length - max} chars]` : text
}

function normalizeConsoleLevel(level) {
  if (typeof level === 'number') {
    if (level >= 3) return 'error'
    if (level === 2) return 'warning'
    if (level === 1) return 'info'
    return 'debug'
  }
  const text = String(level || '').toLowerCase()
  if (/error|fatal|assert/.test(text)) return 'error'
  if (/warn/.test(text)) return 'warning'
  if (/info|log/.test(text)) return 'info'
  return text || 'debug'
}

function serializeArg(arg) {
  if (arg instanceof Error) return `${arg.message}\n${arg.stack || ''}`.trim()
  if (typeof arg === 'string') return arg
  try {
    return JSON.stringify(arg)
  } catch {
    return String(arg)
  }
}

function record(event = {}) {
  const item = {
    sequence: nextSequence++,
    time: nowIso(),
    source: event.source || 'unknown',
    severity: event.severity || 'info',
    type: event.type || 'event',
    message: clip(event.message || ''),
    detail: event.detail || undefined,
    webContentsId: event.webContentsId,
    url: event.url || '',
    title: event.title || '',
    line: event.line,
    sourceId: event.sourceId || '',
    projectId: event.projectId || ''
  }
  events.push(item)
  if (events.length > MAX_EVENTS) events.splice(0, events.length - MAX_EVENTS)
  return item
}

function attachWebContents(webContents, meta = {}) {
  if (!webContents || attachedWebContents.has(webContents)) return false
  attachedWebContents.add(webContents)

  const base = () => {
    let url = ''
    let title = ''
    try { url = webContents.getURL?.() || '' } catch (_) { /* webContents 已销毁 */ }
    try { title = webContents.getTitle?.() || '' } catch (_) { /* webContents 已销毁 */ }
    return {
      source: meta.source || 'webContents',
      webContentsId: webContents.id,
      url,
      title,
      projectId: getWebContentsProject(webContents.id) || meta.projectId || ''
    }
  }

  webContents.on('console-message', (event, level, message, line, sourceId) => {
    const severity = normalizeConsoleLevel(level)
    record({
      ...base(),
      severity,
      type: 'console-message',
      message,
      line,
      sourceId
    })
  })

  webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    record({
      ...base(),
      severity: 'error',
      type: 'did-fail-load',
      message: errorDescription || `load failed: ${errorCode}`,
      detail: { errorCode, validatedURL, isMainFrame }
    })
  })

  webContents.on('render-process-gone', (event, details) => {
    record({
      ...base(),
      severity: 'error',
      type: 'render-process-gone',
      message: `render process gone: ${details?.reason || 'unknown'}`,
      detail: details || {}
    })
  })

  webContents.on('unresponsive', () => {
    record({
      ...base(),
      severity: 'error',
      type: 'unresponsive',
      message: 'webContents became unresponsive'
    })
  })

  webContents.on('preload-error', (event, preloadPath, error) => {
    record({
      ...base(),
      severity: 'error',
      type: 'preload-error',
      message: error?.message || String(error || 'preload error'),
      detail: { preloadPath, stack: error?.stack || '' }
    })
  })

  webContents.on('destroyed', () => {
    record({
      ...base(),
      severity: 'info',
      type: 'webContents-destroyed',
      message: 'webContents destroyed'
    })
  })

  return true
}

// webContentsId -> projectId 反向映射，用于在 installAppCapture 时关联项目
const webContentsProjectMap = new Map()

function setWebContentsProject(webContentsId, projectId) {
  if (webContentsId == null) return
  if (projectId) webContentsProjectMap.set(webContentsId, projectId)
  else webContentsProjectMap.delete(webContentsId)
}

function getWebContentsProject(webContentsId) {
  return webContentsProjectMap.get(webContentsId) || ''
}

function installAppCapture(app) {
  if (!app || appCaptureInstalled) return false
  appCaptureInstalled = true
  app.on('web-contents-created', (event, webContents) => {
    // 尝试从反查映射里拿 projectId（独立 webContents 可精确关联）
    const projectId = getWebContentsProject(webContents.id) || ''
    attachWebContents(webContents, { source: 'electron-webContents', projectId })
  })
  return true
}

function installConsoleCapture() {
  if (consoleCaptureInstalled) return false
  consoleCaptureInstalled = true
  const originalError = console.error.bind(console)
  const originalWarn = console.warn.bind(console)

  console.error = (...args) => {
    record({
      source: 'main-process',
      severity: 'error',
      type: 'console.error',
      message: args.map(serializeArg).join(' ')
    })
    originalError(...args)
  }

  console.warn = (...args) => {
    record({
      source: 'main-process',
      severity: 'warning',
      type: 'console.warn',
      message: args.map(serializeArg).join(' ')
    })
    originalWarn(...args)
  }

  process.on('uncaughtException', error => {
    record({
      source: 'main-process',
      severity: 'error',
      type: 'uncaughtException',
      message: error?.message || String(error || ''),
      detail: { stack: error?.stack || '' }
    })
  })

  process.on('unhandledRejection', reason => {
    record({
      source: 'main-process',
      severity: 'error',
      type: 'unhandledRejection',
      message: reason?.message || String(reason || ''),
      detail: { stack: reason?.stack || '' }
    })
  })

  return true
}

function install(app) {
  installConsoleCapture()
  installAppCapture(app)
}

function getRecent(options = {}) {
  const limit = Math.max(1, Math.min(Number(options.limit || DEFAULT_LIMIT) || DEFAULT_LIMIT, 200))
  const sinceMs = Math.max(0, Number(options.since_ms || options.sinceMs || 0) || 0)
  const minTime = sinceMs > 0 ? Date.now() - sinceMs : 0
  const includeInfo = options.include_info === true || options.includeInfo === true
  const severities = new Set(Array.isArray(options.severities)
    ? options.severities.map(item => String(item).toLowerCase())
    : [])
  const urlContains = String(options.url_contains || options.urlContains || '').toLowerCase()
  // 项目隔离过滤：
  // - 传入 projectId 时，只返回该项目的事件 + projectId 为空的事件（主窗口共享 webContents 兜底）
  // - 不传 projectId 时，返回所有事件（兼容旧行为）
  const filterProjectId = String(options.projectId || options.project_id || '').trim()
  const projectPathHint = String(options.projectPath || options.project_path || '').toLowerCase().trim()
  const filterWebContentsId = Number(options.webContentsId || options.web_contents_id || 0)
  const afterSequence = Math.max(0, Number(options.after_sequence || options.afterSequence || 0) || 0)

  const filtered = events.filter(item => {
    if (afterSequence > 0 && Number(item.sequence || 0) <= afterSequence) return false
    if (filterWebContentsId > 0 && Number(item.webContentsId) !== filterWebContentsId) return false
    if (!includeInfo && !['error', 'warning'].includes(item.severity)) return false
    if (severities.size && !severities.has(item.severity)) return false
    if (minTime && Date.parse(item.time) < minTime) return false
    if (urlContains && !String(item.url || '').toLowerCase().includes(urlContains)) return false
    if (filterProjectId) {
      // 精确匹配 projectId 的优先保留
      if (item.projectId === filterProjectId) return true
      // projectId 为空的事件：主窗口共享 webContents 产生，无法精确归属
      // 用 URL/title/message 里的项目路径线索做兜底匹配
      if (!item.projectId) {
        if (!projectPathHint) return true // 没给路径线索就兜底保留
        const hay = `${item.url || ''}\n${item.title || ''}\n${item.message || ''}`.toLowerCase()
        return hay.includes(projectPathHint)
      }
      // projectId 非空但不匹配 → 丢弃（这是别的项目的事件）
      return false
    }
    return true
  })

  return filtered.slice(-limit).reverse()
}

function summarize(options = {}) {
  const recent = getRecent(options)
  const errors = recent.filter(item => item.severity === 'error')
  const warnings = recent.filter(item => item.severity === 'warning')
  return {
    success: true,
    ok: errors.length === 0,
    total: recent.length,
    error_count: errors.length,
    warning_count: warnings.length,
    events: recent,
    summary: errors.length
      ? `Runtime diagnostics found ${errors.length} error(s) and ${warnings.length} warning(s).`
      : warnings.length
        ? `Runtime diagnostics found ${warnings.length} warning(s).`
        : 'Runtime diagnostics found no recent errors.'
  }
}

function clear() {
  events.splice(0, events.length)
  return { success: true, cleared: true }
}

function mark() {
  return {
    time: nowIso(),
    index: events.length,
    sequence: nextSequence - 1
  }
}

function eventFingerprint(item = {}) {
  return [item.severity, item.source, item.type, item.message, item.sourceId, item.line]
    .map(value => String(value == null ? '' : value))
    .join('|')
}

function classifySinceMark(cursor = {}, options = {}) {
  const baselineEvents = Array.isArray(cursor.baselineEvents) ? cursor.baselineEvents : []
  const baselineFingerprints = new Set(baselineEvents.map(eventFingerprint))
  const recent = getRecent({ ...options, after_sequence: cursor.sequence || 0 })
  const introduced = []
  const persisting = []
  const repeatedFingerprints = new Set()

  for (const event of recent) {
    const fingerprint = eventFingerprint(event)
    repeatedFingerprints.add(fingerprint)
    if (baselineFingerprints.has(fingerprint)) persisting.push(event)
    else introduced.push(event)
  }

  return {
    success: true,
    ok: introduced.every(item => item.severity !== 'error') && persisting.every(item => item.severity !== 'error'),
    total: recent.length,
    error_count: recent.filter(item => item.severity === 'error').length,
    warning_count: recent.filter(item => item.severity === 'warning').length,
    events: recent,
    summary: recent.length
      ? `Post-edit runtime diagnostics attributed ${introduced.length} introduced and ${persisting.length} persisting event(s).`
      : 'Post-edit runtime diagnostics found no events after the write cursor.',
    cursor: { time: cursor.time || '', sequence: Number(cursor.sequence || 0) },
    introduced,
    persisting,
    resolved: [],
    unrelated: baselineEvents.filter(event => !repeatedFingerprints.has(eventFingerprint(event))),
    introduced_error_count: introduced.filter(item => item.severity === 'error').length,
    persisting_error_count: persisting.filter(item => item.severity === 'error').length,
    resolved_requires_active_recheck: true
  }
}

module.exports = {
  install,
  installConsoleCapture,
  installAppCapture,
  attachWebContents,
  setWebContentsProject,
  getWebContentsProject,
  record,
  getRecent,
  summarize,
  classifySinceMark,
  mark,
  clear
}
