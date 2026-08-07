const storageConfig = require('./storage-config')
const workerModel = require('./worker-model')

const ASK = Object.freeze({ shouldAsk: true, confidence: 0, source: 'fallback' })

function buildAuthorizationSummary(input = {}) {
  const target = input.target || {}
  return {
    toolName: String(input.toolName || ''),
    operation: String(target.operation || input.toolName || ''),
    reason: String(target.reason || ''),
    path: String(target.path || ''),
    insideProject: !!input.insideProject,
    command: String(input.command || '').slice(0, 500),
    taskContext: String(input.taskContext || '').slice(0, 500)
  }
}

function normalizeDecision(value = {}) {
  if (!value || typeof value !== 'object' || typeof value.shouldAsk !== 'boolean') return ASK
  const confidence = Number(value.confidence)
  if (!Number.isFinite(confidence) || confidence < 0.7) return ASK
  return {
    shouldAsk: value.shouldAsk,
    confidence: Math.max(0, Math.min(1, confidence)),
    reason: String(value.reason || '').slice(0, 240),
    summary: String(value.summary || '').slice(0, 240),
    source: 'model'
  }
}

async function decideAuthorization(input = {}) {
  const settings = storageConfig.getSmartAuthorizationConfig()
  if (!settings.enabled || !settings.task || !settings.modelKey) return ASK
  const summary = buildAuthorizationSummary(input)
  const system = [
    '你是本地软件的授权提醒助手。你不允许拒绝、拦截或替用户做决定。',
    '只判断这次操作是否应弹窗询问用户；无法确定时应询问。',
    '只输出 JSON：{"shouldAsk":boolean,"confidence":0到1,"reason":"简短原因","summary":"面向用户的操作摘要"}。',
    '项目内、仅读取、无网络、低资源的明确操作通常无需询问；项目外路径、启动应用、写入删除、网络、安装、构建、长时间或高资源操作通常应询问。'
  ].join('\n')
  const user = `操作摘要：${JSON.stringify(summary)}`
  try {
    const result = await workerModel.summarizeJson({
      system,
      prompt: user,
      timeoutMs: settings.timeoutMs,
      task: 'smart_authorization',
      local: { enabled: false }
    })
    return normalizeDecision(result?.data || result)
  } catch (error) {
    return { ...ASK, error: error?.message || String(error) }
  }
}

module.exports = { decideAuthorization, buildAuthorizationSummary }