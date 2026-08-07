const { readFiniteNumber } = require('./json-utils')

function createAbortError(message = 'AI operation interrupted') {
  const error = new Error(message)
  error.name = 'AbortError'
  return error
}

function createApiTimeoutError(message = '模型接口调用超时') {
  const error = new Error(message)
  error.name = 'ApiTimeoutError'
  error.isApiTimeout = true
  return error
}

function isApiTimeoutError(error, signal = null) {
  return error?.name === 'ApiTimeoutError' ||
    error?.isApiTimeout === true ||
    signal?.reason?.name === 'ApiTimeoutError' ||
    signal?.reason?.isApiTimeout === true
}

function isAbortError(error, signal = null) {
  if (error?.name === 'AbortError') return true
  // 仅当 signal 已 abort 且错误本身像是由 abort 引起的才算。
  // 避免 signal 因其他原因 abort 后，把不相关的网络错误也误判为"已中断"。
  if (signal?.aborted === true) {
    const reason = signal.reason
    // interject-runner.abort('interject') 传字符串 reason，直接识别为 abort
    if (reason === 'interject') return true
    if (reason?.name === 'AbortError' || reason?.name === 'ApiTimeoutError' ||
        reason?.isApiTimeout === true || error?.code === 'ABORT_ERR' ||
        error?.name === 'AbortError') {
      return true
    }
    // signal 被 abort 了但 error 不是 AbortError 类型 → 不视为用户中断
    // 而是视为真实错误（网络断开等），只是恰好 signal 也被 abort 了
    return false
  }
  return false
}

function throwIfAborted(signal) {
  if (!signal?.aborted) return
  const reason = signal.reason
  if (reason instanceof Error) throw reason
  throw createAbortError(reason?.message || reason || 'AI operation interrupted')
}

function stripHtmlErrorBody(text = '') {
  return String(text || '')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function formatApiHttpError(status, body = '', modelConfig = {}) {
  const rawBody = String(body || '')
  const cleanBody = stripHtmlErrorBody(rawBody).slice(0, 300)
  if (status === 403 && /only allows Codex official clients/i.test(rawBody)) {
    const modelName = modelConfig?.modelName || modelConfig?.modelId || '当前模型'
    const apiUrl = modelConfig?.apiUrl ? `（${modelConfig.apiUrl}）` : ''
    return `API错误 403：你正在使用的 GPT 模型「${modelName}」所在自定义接口${apiUrl}返回“只允许 Codex 官方客户端”。这说明当前 API Key、账号或中转路由没有开放给第三方客户端调用，并不是灵犀把 GPT 禁用了。请检查该 GPT 接口的 Key 权限、账号类型、模型路由和是否支持普通 Chat Completions 调用。`
  }
  return `API错误 ${status}: ${cleanBody || body || `HTTP ${status}`}`
}

function clampTimeoutMs(value, fallback, max = 30 * 60 * 1000) {
  const number = readFiniteNumber(value)
  if (number === null) return fallback
  return Math.max(15000, Math.min(number, max))
}

function getApiTimeouts(modelConfig = {}) {
  const base = modelConfig.apiTimeoutMs ?? modelConfig.requestTimeoutMs ?? modelConfig.timeoutMs
  return {
    firstResponseMs: clampTimeoutMs(modelConfig.firstResponseTimeoutMs ?? modelConfig.firstTokenTimeoutMs ?? base, 120000, 5 * 60 * 1000),
    streamIdleMs: clampTimeoutMs(modelConfig.streamIdleTimeoutMs ?? modelConfig.idleTimeoutMs ?? base, 180000, 10 * 60 * 1000)
  }
}

function formatTimeoutSeconds(ms) {
  return `${Math.round(ms / 1000)}秒`
}

function createApiTimeoutWatchdog({ webContents, projectId, abortWithReason, label = '模型接口', firstResponseMs = 120000, streamIdleMs = 180000 }) {
  let timer = null
  let stopped = false
  let phase = 'first'

  const clear = () => {
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
  }

  const schedule = () => {
    clear()
    if (stopped) return
    const timeoutMs = phase === 'first' ? firstResponseMs : streamIdleMs
    timer = setTimeout(() => {
      if (stopped) return
      const reason = phase === 'first'
        ? `${label}超过 ${formatTimeoutSeconds(timeoutMs)} 没有返回响应`
        : `${label}超过 ${formatTimeoutSeconds(timeoutMs)} 没有新的流式输出`
      const message = `${reason}，已停止本轮请求。请检查网络、代理、API地址或模型服务状态。`
      abortWithReason(createApiTimeoutError(message))
    }, timeoutMs)
  }

  schedule()

  return {
    touch(nextPhase) {
      if (nextPhase) phase = nextPhase
      schedule()
    },
    stop() {
      stopped = true
      clear()
    }
  }
}

module.exports = {
  createAbortError,
  createApiTimeoutError,
  isApiTimeoutError,
  isAbortError,
  throwIfAborted,
  stripHtmlErrorBody,
  formatApiHttpError,
  clampTimeoutMs,
  getApiTimeouts,
  formatTimeoutSeconds,
  createApiTimeoutWatchdog
}
