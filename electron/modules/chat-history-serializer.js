const path = require('path')
const { Worker } = require('worker_threads')

let worker = null
let workerIdleTimer = null
let nextRequestId = 1
const pending = new Map()
const inFlightHistorySerializations = new WeakMap()

function rejectPending(error) {
  for (const { reject } of pending.values()) reject(error)
  pending.clear()
}

function resetWorker(error = null) {
  const current = worker
  worker = null
  if (workerIdleTimer) clearTimeout(workerIdleTimer)
  workerIdleTimer = null
  if (error) rejectPending(error)
  if (current) current.terminate().catch(() => {})
}

function scheduleWorkerIdleShutdown() {
  if (workerIdleTimer) clearTimeout(workerIdleTimer)
  if (!worker || pending.size > 0) return
  // 空闲 8 秒再回收 worker，避免短时间连续写历史反复拉起线程
  workerIdleTimer = setTimeout(() => resetWorker(), 8000)
  workerIdleTimer.unref?.()
}

function ensureWorker() {
  if (workerIdleTimer) clearTimeout(workerIdleTimer)
  workerIdleTimer = null
  if (worker) return worker
  const nextWorker = new Worker(path.join(__dirname, 'chat-history-serializer-worker.js'))
  nextWorker.unref()
  nextWorker.on('message', message => {
    const request = pending.get(message?.id)
    if (!request) return
    pending.delete(message.id)
    if (message.success) {
      const receivedAt = performance.now()
      const result = message.result
      if (result && typeof result === 'object') {
        result.metrics = {
          ...(result.metrics || {}),
          workerCloneMs: Math.max(0, (message.workerReceivedAt || receivedAt) - request.postedAt),
          roundTripMs: Math.max(0, receivedAt - request.postedAt)
        }
      }
      request.resolve(result)
    }
    else request.reject(new Error(message.error || 'chat history serialization failed'))
    scheduleWorkerIdleShutdown()
  })
  nextWorker.on('error', error => resetWorker(error))
  nextWorker.on('exit', code => {
    if (worker !== nextWorker) return
    const error = code === 0 && pending.size === 0
      ? null
      : new Error(`chat history serializer exited with code ${code}`)
    resetWorker(error)
  })
  worker = nextWorker
  return worker
}

function serializeOnMainThread(messages = [], options = {}) {
  return new Promise((resolve, reject) => {
    setImmediate(() => {
      try {
        const serializeStartedAt = performance.now()
        const data = Array.isArray(messages)
          ? messages.filter(item => item?.type !== 'compression-divider')
          : []
        const archiveThreshold = Number(options.archiveThreshold) || 500
        const recentCount = Number(options.recentCount) || 200
        if (data.length > archiveThreshold) {
          const result = {
            mainJson: JSON.stringify({ messages: data.slice(-recentCount), hasArchive: true }),
            archiveJson: JSON.stringify({ messages: data.slice(0, -recentCount) }),
            hasArchive: true
          }
          result.metrics = { workerCloneMs: 0, serializeMs: performance.now() - serializeStartedAt }
          resolve(result)
          return
        }
        resolve({
          mainJson: JSON.stringify(data),
          archiveJson: null,
          hasArchive: false,
          metrics: { workerCloneMs: 0, serializeMs: performance.now() - serializeStartedAt }
        })
      } catch (error) {
        reject(error)
      }
    })
  })
}

async function serializeChatHistory(messages = [], options = {}) {
  if (messages && typeof messages === 'object') {
    const archiveThreshold = Number(options.archiveThreshold) || 500
    const recentCount = Number(options.recentCount) || 200
    const requestKey = `${archiveThreshold}:${recentCount}`
    let requests = inFlightHistorySerializations.get(messages)
    if (!requests) {
      requests = new Map()
      inFlightHistorySerializations.set(messages, requests)
    }
    const existing = requests.get(requestKey)
    if (existing) return existing
    const request = _serializeChatHistory(messages, { archiveThreshold, recentCount })
    requests.set(requestKey, request)
    try {
      return await request
    } finally {
      if (requests.get(requestKey) === request) requests.delete(requestKey)
      if (requests.size === 0) inFlightHistorySerializations.delete(messages)
    }
  }
  return _serializeChatHistory(messages, options)
}

async function _serializeChatHistory(messages = [], options = {}) {
  const id = nextRequestId++
  try {
    const activeWorker = ensureWorker()
    return await new Promise((resolve, reject) => {
      const request = { resolve, reject, postedAt: performance.now() }
      pending.set(id, request)
      try {
        activeWorker.postMessage({
          id,
          kind: 'chat-history',
          messages,
          archiveThreshold: Number(options.archiveThreshold) || 500,
          recentCount: Number(options.recentCount) || 200
        })
      } catch (error) {
        pending.delete(id)
        reject(error)
      }
    })
  } catch (error) {
    console.warn('[ChatHistorySerializer] worker unavailable, using deferred fallback:', error.message)
    return await serializeOnMainThread(messages, options)
  }
}

async function serializeJson(value, options = {}) {
  const id = nextRequestId++
  const space = Math.max(0, Math.min(8, Number(options.space) || 0))
  try {
    const activeWorker = ensureWorker()
    return await new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject })
      try {
        activeWorker.postMessage({ id, kind: 'json', value, space })
      } catch (error) {
        pending.delete(id)
        reject(error)
      }
    })
  } catch (error) {
    console.warn('[ChatHistorySerializer] JSON worker unavailable, using deferred fallback:', error.message)
    return await new Promise((resolve, reject) => {
      setImmediate(() => {
        try {
          resolve(JSON.stringify(value, null, space))
        } catch (fallbackError) {
          reject(fallbackError)
        }
      })
    })
  }
}

module.exports = {
  serializeChatHistory,
  serializeJson
}
