const {
  buildApiEndpoint,
  buildApiHeaders,
  buildApiFetchOptions,
  buildModelRequestBody
} = require('./model-api-adapter')

const DEFAULT_TIMEOUT_MS = 20000

function normalizeMessage(value, fallback = '连接失败') {
  const text = String(value || '').replace(/\s+/g, ' ').trim()
  return text ? text.slice(0, 280) : fallback
}

function getResponseError(text = '', status = 0) {
  try {
    const data = JSON.parse(text)
    return normalizeMessage(
      data?.error?.message || data?.error?.detail || data?.message || data?.detail,
      `接口返回 HTTP ${status}`
    )
  } catch (_) {
    return normalizeMessage(text, `接口返回 HTTP ${status}`)
  }
}

async function testConnection(input = {}, options = {}) {
  const modelId = String(input.modelId || input.model || '').trim()
  const apiUrl = String(input.apiUrl || '').trim()
  const apiKey = String(input.apiKey || '').trim()
  if (!modelId || !apiUrl || !apiKey) {
    return { success: false, error: '请填写模型 ID、API URL 和 API Key。' }
  }
  try {
    new URL(apiUrl)
  } catch (_) {
    return { success: false, error: 'API URL 格式不正确。' }
  }

  const modelConfig = {
    modelId,
    modelName: String(input.modelName || modelId).trim(),
    apiUrl,
    apiKey,
    useFullUrl: input.useFullUrl === true,
    maxTokens: 8,
    max_tokens: 8,
    temperature: 0
  }
  const endpoint = buildApiEndpoint(modelConfig)
  const controller = new AbortController()
  const timeoutMs = Math.max(3000, Math.min(Number(options.timeoutMs) || DEFAULT_TIMEOUT_MS, 60000))
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  const startedAt = Date.now()

  try {
    const body = buildModelRequestBody(
      modelConfig,
      modelId,
      [{ role: 'user', content: 'Reply with OK.' }],
      { endpoint, stream: false, includeTools: false }
    )
    const response = await fetch(endpoint, buildApiFetchOptions(modelConfig, endpoint, {
      method: 'POST',
      headers: buildApiHeaders(modelConfig, endpoint, { stream: false, modelId }),
      body: JSON.stringify(body),
      signal: controller.signal,
      promptCache: false,
      modelId
    }))
    const responseText = await response.text()
    if (!response.ok) {
      return {
        success: false,
        status: response.status,
        endpoint,
        error: getResponseError(responseText, response.status)
      }
    }
    return {
      success: true,
      status: response.status,
      endpoint,
      latencyMs: Date.now() - startedAt
    }
  } catch (error) {
    const aborted = error?.name === 'AbortError'
    return {
      success: false,
      endpoint,
      error: aborted ? `连接测试超时（${Math.round(timeoutMs / 1000)} 秒）。` : normalizeMessage(error?.message)
    }
  } finally {
    clearTimeout(timer)
  }
}

function registerIPC(ipcMain) {
  ipcMain.handle('models:testConnection', async (_event, input = {}, options = {}) => {
    return testConnection(input, options)
  })
}

module.exports = {
  registerIPC,
  testConnection,
  getResponseError
}
