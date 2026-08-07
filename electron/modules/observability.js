const DEFAULT_MAX_EVENTS = 500
const DEFAULT_SLOW_IPC_MS = 1500
const DEFAULT_SLOW_TOOL_MS = 5000
const DEFAULT_SLOW_AI_MS = 30000

const state = {
  startedAt: Date.now(),
  events: [],
  counters: new Map()
}

function readNumber(value, fallback) {
  const number = Number(value)
  return Number.isFinite(number) ? number : fallback
}

function isEnabled() {
  return String(process.env.LINGXI_OBSERVABILITY || '1') !== '0'
}

function getMaxEvents() {
  return Math.max(50, Math.min(readNumber(process.env.LINGXI_OBSERVABILITY_MAX_EVENTS, DEFAULT_MAX_EVENTS), 5000))
}

function getThreshold(type) {
  if (type === 'ipc') return readNumber(process.env.LINGXI_SLOW_IPC_MS, DEFAULT_SLOW_IPC_MS)
  if (type === 'tool') return readNumber(process.env.LINGXI_SLOW_TOOL_MS, DEFAULT_SLOW_TOOL_MS)
  if (type === 'ai_request') return readNumber(process.env.LINGXI_SLOW_AI_MS, DEFAULT_SLOW_AI_MS)
  return 0
}

function incCounter(key) {
  state.counters.set(key, (state.counters.get(key) || 0) + 1)
}

function compactMeta(meta = {}) {
  const output = {}
  for (const [key, value] of Object.entries(meta || {})) {
    if (value === undefined || typeof value === 'function') continue
    if (typeof value === 'string') output[key] = value.length > 300 ? `${value.slice(0, 300)}...` : value
    else if (typeof value === 'number' || typeof value === 'boolean' || value === null) output[key] = value
    else if (Array.isArray(value)) output[key] = { type: 'array', length: value.length }
    else if (value && typeof value === 'object') output[key] = { type: 'object', keys: Object.keys(value).slice(0, 20) }
  }
  return output
}

function recordEvent(event = {}) {
  if (!isEnabled()) return null
  const now = Date.now()
  const normalized = {
    id: `${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    ts: now,
    type: String(event.type || 'event'),
    name: String(event.name || 'unknown'),
    projectId: event.projectId || null,
    status: event.status || 'ok',
    durationMs: Number.isFinite(Number(event.durationMs)) ? Math.round(Number(event.durationMs)) : null,
    error: event.error ? String(event.error).slice(0, 500) : null,
    meta: compactMeta(event.meta)
  }

  state.events.push(normalized)
  while (state.events.length > getMaxEvents()) state.events.shift()

  incCounter(`${normalized.type}.total`)
  incCounter(`${normalized.type}.${normalized.status}`)

  const threshold = getThreshold(normalized.type)
  if (threshold > 0 && normalized.durationMs !== null && normalized.durationMs >= threshold) {
    normalized.slow = true
    incCounter(`${normalized.type}.slow`)
    console.warn(`[Observability] slow ${normalized.type}:`, normalized.name, `${normalized.durationMs}ms`, normalized.error || '')
  }

  return normalized
}

function startOperation(type, name, meta = {}) {
  const startedAt = Date.now()
  return (result = {}) => {
    const durationMs = Date.now() - startedAt
    return recordEvent({
      type,
      name,
      projectId: result.projectId || meta.projectId || null,
      status: result.status || (result.error ? 'error' : 'ok'),
      durationMs,
      error: result.error,
      meta: { ...meta, ...(result.meta || {}) }
    })
  }
}

function recordAiRequestStart(meta = {}) {
  return startOperation('ai_request', meta.modelName || meta.modelId || 'ai-request', meta)
}

function wrapIpcMain(ipcMain) {
  if (!ipcMain || typeof ipcMain.handle !== 'function') return ipcMain
  return new Proxy(ipcMain, {
    get(target, prop) {
      if (prop !== 'handle') {
        const value = target[prop]
        return typeof value === 'function' ? value.bind(target) : value
      }
      return (channel, handler) => {
        return target.handle(channel, async (event, ...args) => {
          const finish = startOperation('ipc', channel, {
            argCount: args.length,
            senderId: event?.sender?.id || null
          })
          try {
            const result = await handler(event, ...args)
            finish({ status: result?.error ? 'error' : 'ok' })
            return result
          } catch (error) {
            finish({ status: 'error', error: error.message })
            throw error
          }
        })
      }
    }
  })
}

function getSnapshot(options = {}) {
  const limit = Math.max(1, Math.min(Number(options.limit) || 100, getMaxEvents()))
  const recent = state.events.slice(-limit).reverse()
  const slow = state.events.filter(event => event.slow).slice(-50).reverse()
  const memory = process.memoryUsage()
  return {
    enabled: isEnabled(),
    startedAt: state.startedAt,
    uptimeMs: Date.now() - state.startedAt,
    counters: Object.fromEntries(state.counters.entries()),
    memory: {
      rss: memory.rss,
      heapTotal: memory.heapTotal,
      heapUsed: memory.heapUsed,
      external: memory.external,
      arrayBuffers: memory.arrayBuffers
    },
    eventCount: state.events.length,
    recent,
    slow
  }
}

function registerIPC(ipcMain) {
  ipcMain.handle('observability:getSnapshot', async (event, options = {}) => getSnapshot(options))
  ipcMain.handle('observability:clear', async () => {
    state.events = []
    state.counters.clear()
    return { success: true }
  })
}

module.exports = {
  recordEvent,
  startOperation,
  recordAiRequestStart,
  wrapIpcMain,
  getSnapshot,
  registerIPC
}
