const { execFile } = require('child_process')
const crypto = require('crypto')
const { Agent, ProxyAgent } = require('undici')
const { resolveApiKey } = require('./api-key')
const { MODEL_TOOLS_SCHEMA } = require('./schemas')
const {
  detectWorkbenchMentions,
  detectMcpMentions,
  getDisabledWorkbenchTools,
  getDisabledMcpTools
} = require('./system-prompt-builder')
const capabilityTiers = require('./capability-tiers')
const {
  applyPromptCacheBodyHints,
  applyPromptCacheHeaderHints,
  getPromptCacheCapability,
  isPromptCacheOptimizeEnabled
} = require('./prompt-cache-capabilities')
const { stableJsonStringify } = require('./prompt-stability')

const proxyAgentCache = new Map()
const stickyModelAgentCache = new Map()
const MAX_STICKY_MODEL_AGENTS = 32

// Tool pack membership is defined in capability-tiers.js.
const TOOL_PACKS = capabilityTiers.TOOL_PACKS
const OPTIONAL_MODEL_TOOLS = capabilityTiers.OPTIONAL_MODEL_TOOLS
const hasAnyPattern = capabilityTiers.hasAnyPattern

function shouldUseAdaptiveToolVisibility(options = {}) {
  if (options.adaptiveToolVisibility === false) return false
  const value = options.modelConfig?.adaptiveToolVisibility ?? options.adaptiveToolVisibility
  if (value === false || value === 'false' || value === 'off') return false
  if (value === true || value === 'true' || value === 'on') return true
  if (!isPromptCacheOptimizeEnabled(options.modelConfig || {}, options)) return true
  return !shouldPinFullToolSchemaForPromptCache(options.modelConfig || {}, options)
}

function shouldPinFullToolSchemaForPromptCache(modelConfig = {}, options = {}) {
  const explicit = modelConfig.promptCacheToolSchemaStrategy ?? modelConfig.prompt_cache_tool_schema_strategy ??
    options.promptCacheToolSchemaStrategy ?? options.prompt_cache_tool_schema_strategy
  const value = String(explicit || '').trim().toLowerCase()
  if (['full', 'all', 'pinned', 'stable-full'].includes(value)) return true
  if (['adaptive', 'trim', 'trimmed', 'light', 'lite'].includes(value)) return false

  const endpoint = options.endpoint || modelConfig.apiUrl || ''
  const modelId = options.modelId || modelConfig.modelId || modelConfig.model || ''
  const capability = getPromptCacheCapability(modelConfig, endpoint, modelId)
  // 缓存优化开启时固定完整工具表。首轮会多发送一些 schema，但后续请求不会因
  // 用户消息关键词变化而改写前缀；自动、显式和 keyed 缓存都依赖这个稳定边界。
  return capability.mode !== 'unknown'
}

function shouldUseFixedToolSchema(modelConfig = {}, modelId = '', options = {}) {
  const endpoint = options.endpoint || modelConfig.apiUrl || ''
  const capability = getPromptCacheCapability(modelConfig, endpoint, modelId)
  if (capability.id === 'deepseek') return true
  const modelText = String(modelId || modelConfig?.modelName || modelConfig?.model || '').toLowerCase()
  return /deepseek/.test(modelText)
}

function shouldUseGrokPromptCacheLayout(modelConfig = {}, modelId = '', options = {}) {
  const endpoint = options.endpoint || modelConfig.apiUrl || ''
  const capability = getPromptCacheCapability(modelConfig, endpoint, modelId)
  return capability.id === 'xai' && isPromptCacheOptimizeEnabled(modelConfig, options)
}

function shouldNormalizeDeepSeekMessages(modelConfig = {}, modelId = '', options = {}) {
  const endpoint = options.endpoint || modelConfig.apiUrl || ''
  const capability = getPromptCacheCapability(modelConfig, endpoint, modelId)
  if (capability.id === 'deepseek') return true
  const modelText = String(modelId || modelConfig?.modelName || modelConfig?.model || '').toLowerCase()
  return /deepseek/.test(modelText)
}

function normalizeDeepSeekChatMessage(message = {}) {
  const role = String(message?.role || '')
  const next = {
    role,
    content: message?.content ?? ''
  }
  if (message?.name) next.name = message.name
  if (role === 'assistant' && Array.isArray(message?.tool_calls) && message.tool_calls.length) {
    // DeepSeek 官方要求：思考模式下发生工具调用时，后续所有请求必须完整回传
    // 该 assistant 消息的 reasoning_content，否则工具调用链和缓存单元都无法匹配。
    if (typeof message.reasoning_content === 'string' && message.reasoning_content) {
      next.reasoning_content = message.reasoning_content
    }
    next.tool_calls = message.tool_calls.map(toolCall => ({
      id: String(toolCall?.id || ''),
      type: toolCall?.type || 'function',
      function: {
        name: String(toolCall?.function?.name || ''),
        arguments: String(toolCall?.function?.arguments || '{}')
      }
    })).filter(toolCall => toolCall.id && toolCall.function.name)
  }
  if (role === 'tool' && message?.tool_call_id) {
    next.tool_call_id = String(message.tool_call_id)
  }
  return next
}

function normalizeOpenAIChatContent(content) {
  if (content === null || content === undefined) return ''
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content.map(block => {
      if (!block || typeof block !== 'object') return null
      if (block.type === 'text' && typeof block.text === 'string') return { type: 'text', text: block.text }
      if (typeof block.text === 'string') return { type: 'text', text: block.text }
      if ((block.type === 'image_url' || block.image_url) && block.image_url?.url) {
        return { type: 'image_url', image_url: { url: String(block.image_url.url) } }
      }
      return null
    }).filter(Boolean)
  }
  if (typeof content === 'object') {
    try {
      return JSON.stringify(content)
    } catch {
      return String(content)
    }
  }
  return String(content)
}

function normalizeOpenAIChatToolCalls(toolCalls = []) {
  if (!Array.isArray(toolCalls)) return []
  return toolCalls.map(toolCall => {
    const id = String(toolCall?.id || '').trim()
    const name = String(toolCall?.function?.name || '').trim()
    if (!id || !name) return null
    return {
      id,
      type: 'function',
      function: {
        name,
        arguments: typeof toolCall?.function?.arguments === 'string'
          ? toolCall.function.arguments
          : JSON.stringify(toolCall?.function?.arguments || {})
      }
    }
  }).filter(Boolean)
}

function normalizeOpenAIChatMessage(message = {}, modelConfig = {}, modelId = '') {
  const role = String(message?.role || '')
  const next = {
    role,
    content: normalizeOpenAIChatContent(message?.content)
  }
  if (message?.name) next.name = String(message.name)

  if (role === 'assistant') {
    const toolCalls = normalizeOpenAIChatToolCalls(message?.tool_calls)
    if (toolCalls.length) {
      next.tool_calls = toolCalls
      // GLM 等模型要求 assistant 带 tool_calls 时 content 不能为 null/undefined，必须是字符串
      if (next.content === null || next.content === undefined || next.content === '') {
        next.content = ''
      }
    }
    // 过滤掉 error/interrupted 等内部标记字段，不让它们进入请求体
    if (isMiniMaxM3Model(modelConfig, modelId) && Array.isArray(message?.reasoning_details)) {
      next.reasoning_details = message.reasoning_details
    }
  } else if (role === 'tool') {
    if (message?.tool_call_id) next.tool_call_id = String(message.tool_call_id)
    next.content = typeof next.content === 'string' ? next.content : JSON.stringify(next.content || '')
  }
  return next
}

function getAdaptiveToolAllowSet(latestUserText = '', options = {}) {
  return capabilityTiers.getAdaptiveToolAllowSet(latestUserText, options)
}

function getAdaptiveDisabledTools(latestUserText = '', options = {}) {
  if (!shouldUseAdaptiveToolVisibility(options)) return new Set()
  return capabilityTiers.getAdaptiveDisabledTools(latestUserText, options)
}

function isLocalOllamaModelConfig(modelConfig = {}) {
  const url = String(modelConfig?.apiUrl || '').toLowerCase()
  return /(^http:\/\/(127\.0\.0\.1|localhost):11434)(\/|$)/.test(url) || modelConfig?.provider === 'ollama' || modelConfig?.apiType === 'ollama'
}

function buildOllamaOpenAiEndpoint(apiUrl = '') {
  const raw = String(apiUrl || 'http://127.0.0.1:11434').trim() || 'http://127.0.0.1:11434'
  const base = raw.replace(/\/+$/, '')
  if (/\/v1\/chat\/completions$/i.test(base)) return base
  if (/\/api\/chat$/i.test(base)) return base.replace(/\/api\/chat$/i, '/v1/chat/completions')
  if (/\/chat\/completions$/i.test(base)) return base.replace(/\/chat\/completions$/i, '/v1/chat/completions')
  if (/\/v1$/i.test(base)) return `${base}/chat/completions`
  if (/\/api$/i.test(base)) return base.replace(/\/api$/i, '/v1/chat/completions')
  return `${base}/v1/chat/completions`
}

function getOllamaKeepAlive(modelConfig = {}) {
  if (!isLocalOllamaModelConfig(modelConfig)) return null
  const value = String(modelConfig.keepAlive || modelConfig.keep_alive || '30s').trim()
  return value || '30s'
}

function getReasoningEffort(modelConfig = {}) {
  return String(modelConfig.reasoning_effort || modelConfig.reasoningEffort || '').trim().toLowerCase()
}

function getModelProviderText(modelConfig = {}, modelId = '') {
  return [
    modelConfig.apiUrl,
    modelConfig.provider,
    modelConfig.apiType,
    modelConfig.modelName,
    modelConfig.modelId,
    modelId
  ].filter(Boolean).join(' ').toLowerCase()
}

function isGlmThinkingModel(modelConfig = {}, modelId = '') {
  return /open\.bigmodel\.cn|bigmodel|zhipu|智谱|glm-/.test(getModelProviderText(modelConfig, modelId))
}

function isDeepSeekReasoningModel(modelConfig = {}, modelId = '') {
  return /deepseek/.test(getModelProviderText(modelConfig, modelId))
}

function isQwenThinkingModel(modelConfig = {}, modelId = '') {
  return /dashscope|aliyuncs|qwen|通义|千问/.test(getModelProviderText(modelConfig, modelId))
}

function isOpenAIReasoningModel(modelConfig = {}, modelId = '') {
  const text = getModelProviderText(modelConfig, modelId)
  return /api\.openai\.com|openai|(^|[\s:])(o1|o3|o4|gpt-5|gpt-4\.1|gpt-4o)/.test(text)
}

function isAgnesModel(modelConfig = {}, modelId = '') {
  return /agnes-ai\.com|apihub\.agnes-ai\.com|agnes/.test(getModelProviderText(modelConfig, modelId))
}

function isClaudeThinkingModel(modelConfig = {}, modelId = '') {
  return /anthropic|claude/.test(getModelProviderText(modelConfig, modelId))
}

function isMiniMaxThinkingModel(modelConfig = {}, modelId = '') {
  return /minimax|abab|m1/.test(getModelProviderText(modelConfig, modelId))
}

function isMiniMaxM3Model(modelConfig = {}, modelId = '') {
  const text = getModelProviderText(modelConfig, modelId)
  return /minimax/.test(text) && /(^|[^a-z0-9])m3([^a-z0-9]|$)|minimax-m3/i.test(text)
}

function isKimiThinkingModel(modelConfig = {}, modelId = '') {
  const text = getModelProviderText(modelConfig, modelId)
  return /(kimi|moonshot).{0,40}thinking|thinking.{0,40}(kimi|moonshot)/.test(text)
}

function expectsNativeReasoningStream(modelConfig = {}, modelId = '') {
  const explicitThinkingType = String(modelConfig.thinking?.type || modelConfig.thinkingType || '').trim().toLowerCase()
  if (explicitThinkingType === 'disabled') return false
  if (explicitThinkingType === 'enabled') return true

  if (modelConfig.reasoning_split === true || modelConfig.reasoningSplit === true) return true
  if (isMiniMaxM3Model(modelConfig, modelId)) return true

  const reasoningEffort = getReasoningEffort(modelConfig)
  if (!reasoningEffort || reasoningEffort === 'low') return false

  return isGlmThinkingModel(modelConfig, modelId) ||
    isDeepSeekReasoningModel(modelConfig, modelId) ||
    isQwenThinkingModel(modelConfig, modelId) ||
    isClaudeThinkingModel(modelConfig, modelId) ||
    isMiniMaxThinkingModel(modelConfig, modelId) ||
    isKimiThinkingModel(modelConfig, modelId)
}

function getThinkingBudget(reasoningEffort) {
  if (reasoningEffort === 'xhigh') return 8192
  if (reasoningEffort === 'high') return 4096
  if (reasoningEffort === 'medium') return 2048
  if (reasoningEffort === 'low') return 1024
  return 0
}

function getOpenAiReasoningEffort(reasoningEffort) {
  if (reasoningEffort === 'xhigh') return 'high'
  if (['low', 'medium', 'high'].includes(reasoningEffort)) return reasoningEffort
  return ''
}

function shouldUseOpenAIResponsesApi(modelConfig = {}, modelId = '', endpoint = '') {
  if (isLocalOllamaModelConfig(modelConfig)) return false
  const explicit = String(modelConfig.apiFormat || modelConfig.api_format || modelConfig.compatibility || modelConfig.apiType || '').trim().toLowerCase()
  if (['responses', 'openai_responses', 'openai-responses'].includes(explicit)) return true
  const url = String(endpoint || modelConfig.apiUrl || '').toLowerCase()
  if (/\/responses(?:\?|$|\/)/.test(url)) return true
  if (/\/anthropic\//.test(url) || /\/messages(?:\?|$|\/)/.test(url)) return false
  const reasoningEffort = getOpenAiReasoningEffort(getReasoningEffort(modelConfig))
  return Boolean(reasoningEffort && isOpenAIReasoningModel(modelConfig, modelId))
}

function getApiFormat(modelConfig = {}, endpoint = '') {
  const explicit = String(modelConfig.apiFormat || modelConfig.api_format || modelConfig.compatibility || modelConfig.apiType || '').trim().toLowerCase()
  if (['openai', 'openai_chat', 'openai-chat', 'chat_completions', 'chat-completions'].includes(explicit)) return 'openai'
  if (['gemini', 'gemini_native', 'gemini-native', 'google_gemini', 'google-gemini'].includes(explicit)) return 'gemini'
  if (['responses', 'openai_responses', 'openai-responses'].includes(explicit)) return 'openai-responses'
  if (/\/responses(?:\?|$|\/)/i.test(String(endpoint || modelConfig.apiUrl || ''))) return 'openai-responses'
  if (['anthropic', 'anthropic_messages', 'claude'].includes(explicit)) return 'anthropic'
  const text = [endpoint, modelConfig.apiUrl, modelConfig.provider].filter(Boolean).join(' ').toLowerCase()
  if (/generativelanguage\.googleapis\.com\/v\d+(?:beta)?\/openai(?:\/|$)/.test(text)) return 'openai'
  if (/generativelanguage\.googleapis\.com|googleapis\.com\/v\d+beta\/models\//.test(text)) return 'gemini'
  if (/\/anthropic\/v\d+\/messages(?:\?|$|\/)|\/anthropic\/v\d+(?:\?|$|\/)|api\.anthropic\.com\/v\d+\/messages|api\.anthropic\.com\/v\d+(?:\?|$|\/)/.test(text)) {
    return 'anthropic'
  }
  return 'openai'
}

function buildApiEndpoint(modelConfig = {}) {
  if (isLocalOllamaModelConfig(modelConfig)) {
    return buildOllamaOpenAiEndpoint(modelConfig.apiUrl)
  }
  let endpoint = String(modelConfig.apiUrl || '').trim()
  if (/generativelanguage\.googleapis\.com\/v\d+(?:beta)?\/openai\/?$/i.test(endpoint)) {
    return endpoint.replace(/\/+$/, '') + '/chat/completions'
  }
  if (modelConfig.useFullUrl === true || modelConfig.fullUrl === true || modelConfig.apiUrlMode === 'full') {
    return endpoint
  }
  const format = getApiFormat(modelConfig, endpoint)
  if (format === 'gemini') {
    const modelId = encodeURIComponent(String(modelConfig.modelId || modelConfig.modelName || modelConfig.model || '').trim())
    if (/:(streamGenerateContent|generateContent)$/i.test(endpoint)) return endpoint
    if (/\/models\/[^/:]+$/i.test(endpoint)) return endpoint.replace(/\/$/, '') + ':streamGenerateContent'
    const base = endpoint.replace(/\/$/, '') || 'https://generativelanguage.googleapis.com/v1beta'
    return `${base}/models/${modelId}:streamGenerateContent`
  }
  if (format === 'anthropic') {
    if (/\/messages\/?$/i.test(endpoint)) return endpoint
    return endpoint.replace(/\/$/, '') + '/messages'
  }
  if (format === 'openai-responses' || shouldUseOpenAIResponsesApi(modelConfig, modelConfig.modelId || modelConfig.modelName || modelConfig.model || '', endpoint)) {
    if (/\/responses\/?$/i.test(endpoint)) return endpoint
    if (/\/chat\/completions\/?$/i.test(endpoint)) return endpoint.replace(/\/chat\/completions\/?$/i, '/responses')
    if (/\/v1\/?$/i.test(endpoint)) return endpoint.replace(/\/?$/i, '/responses')
    return endpoint.replace(/\/$/, '') + '/responses'
  }
  if (/\/chat\/completions\/?$/i.test(endpoint)) {
    return endpoint.replace(/\/+$/, '')
  }
  if (!/\/chat\/completions$/i.test(endpoint)) {
    endpoint = endpoint.replace(/\/$/, '') + '/chat/completions'
  }
  return endpoint
}

function buildApiHeaders(modelConfig = {}, endpoint = '', options = {}) {
  const headers = {
    'Content-Type': 'application/json'
  }
  if (options.stream) headers.Accept = 'text/event-stream'
  const apiKey = resolveApiKey(modelConfig.apiKey)
  if (getApiFormat(modelConfig, endpoint) === 'anthropic' && /api\.anthropic\.com/i.test(endpoint)) {
    headers['x-api-key'] = apiKey
    headers['anthropic-version'] = modelConfig.anthropicVersion || modelConfig.anthropic_version || '2023-06-01'
  } else if (getApiFormat(modelConfig, endpoint) === 'gemini') {
    headers['x-goog-api-key'] = apiKey
  } else {
    headers.Authorization = `Bearer ${apiKey}`
  }
  applyPromptCacheHeaderHints(headers, modelConfig, endpoint, options.modelId || modelConfig.modelId || modelConfig.modelName || '', options)
  return headers
}

function getModelApiProxyUrl(modelConfig = {}) {
  const enabled = modelConfig.apiProxyEnabled === true ||
    modelConfig.proxyEnabled === true ||
    modelConfig.useProxy === true
  if (!enabled) return ''
  const proxyUrl = String(modelConfig.apiProxyUrl || modelConfig.proxyUrl || modelConfig.proxy || '').trim()
  if (!proxyUrl) return ''
  if (!/^https?:\/\//i.test(proxyUrl)) return ''
  return proxyUrl
}

function getProxyAgent(proxyUrl = '') {
  const key = String(proxyUrl || '').trim()
  if (!key) return null
  if (!proxyAgentCache.has(key)) {
    proxyAgentCache.set(key, new ProxyAgent(key))
  }
  return proxyAgentCache.get(key)
}

function shouldUseStickyPromptCacheConnection(modelConfig = {}, endpoint = '', modelId = '') {
  const explicit = modelConfig.promptCacheStickyConnection ?? modelConfig.prompt_cache_sticky_connection
  if (explicit === false || explicit === 'false' || explicit === 'off' || explicit === 'disabled') return false
  if (shouldAvoidPersistentModelConnection(modelConfig, endpoint, modelId)) return false
  return getPromptCacheCapability(modelConfig, endpoint, modelId).id === 'deepseek'
}

function getStickyModelAgent(endpoint = '', connectionScope = '') {
  let origin = ''
  try {
    origin = new URL(endpoint).origin
  } catch {
    return null
  }
  const scope = String(connectionScope || 'default')
  const key = `${origin}|${scope}`
  if (!stickyModelAgentCache.has(key)) {
    if (stickyModelAgentCache.size >= MAX_STICKY_MODEL_AGENTS) {
      const oldestKey = stickyModelAgentCache.keys().next().value
      const oldestAgent = stickyModelAgentCache.get(oldestKey)
      stickyModelAgentCache.delete(oldestKey)
      Promise.resolve(oldestAgent?.close?.()).catch(() => {})
    }
    stickyModelAgentCache.set(key, new Agent({
      connections: 1,
      pipelining: 1,
      keepAliveTimeout: 60000,
      keepAliveMaxTimeout: 600000
    }))
  }
  return stickyModelAgentCache.get(key)
}

async function closeStickyModelAgents() {
  const agents = [...stickyModelAgentCache.values()]
  stickyModelAgentCache.clear()
  await Promise.allSettled(agents.map(agent => agent.close()))
}

function buildApiFetchOptions(modelConfig = {}, endpoint = '', options = {}) {
  const {
    connectionScope = '',
    modelId = '',
    promptCache = true,
    ...fetchOptions
  } = options
  const init = { ...fetchOptions }
  const proxyUrl = getModelApiProxyUrl(modelConfig)
  const agent = getProxyAgent(proxyUrl)
  if (agent) {
    init.dispatcher = agent
  } else if (
    !init.dispatcher &&
    promptCache !== false &&
    shouldUseStickyPromptCacheConnection(modelConfig, endpoint, modelId)
  ) {
    init.dispatcher = getStickyModelAgent(endpoint, connectionScope)
  }
  return init
}

function shouldAvoidPersistentModelConnection(modelConfig = {}, endpoint = '', modelId = '') {
  const stickySetting = modelConfig.promptCacheStickyConnection ?? modelConfig.prompt_cache_sticky_connection
  const stickyDisabled = stickySetting === false || stickySetting === 'false' || stickySetting === 'off' || stickySetting === 'disabled'
  // DeepSeek 的自动前缀缓存很容易受中转负载均衡节点切换影响。即使端点是
  // api.apikey.fun，也先复用会话级单连接；已有的 socket-close 重试会在连接
  // 失效时改用 Connection: close 重试，不需要每个工具回合都主动换连接。
  if (!stickyDisabled && getPromptCacheCapability(modelConfig, endpoint, modelId).id === 'deepseek') {
    return false
  }
  const providerText = [endpoint, modelConfig.apiUrl, modelConfig.provider]
    .filter(Boolean)
    .join(' ')
  return /api\.apikey\.fun/i.test(providerText)
}

function getTransportErrorChain(error) {
  const chain = []
  const seen = new Set()
  let current = error
  while (current && typeof current === 'object' && !seen.has(current) && chain.length < 8) {
    seen.add(current)
    chain.push(current)
    current = current.cause
  }
  return chain
}

function isPreResponseSocketCloseError(error) {
  return getTransportErrorChain(error).some(item => {
    const code = String(item?.code || '').toUpperCase()
    const message = String(item?.message || '')
    if (code === 'ECONNRESET') return true
    return code === 'UND_ERR_SOCKET' && /other side closed|socket closed|socket hang up/i.test(message)
  })
}

function waitForTransportRetry(delayMs = 150) {
  return new Promise(resolve => setTimeout(resolve, Math.max(0, Number(delayMs) || 0)))
}

async function retryPreResponseSocketClose(request, options = {}) {
  const maxAttempts = Math.max(1, Math.min(4, Number(options.maxAttempts) || 2))
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await request({
        attempt,
        connectionClose: options.connectionClose === true || attempt > 1
      })
    } catch (error) {
      if (!isPreResponseSocketCloseError(error) || attempt >= maxAttempts) throw error
      options.onRetry?.(error, { attempt: attempt + 1, maxAttempts })
      const baseDelayMs = Math.max(0, Number(options.delayMs) || 0)
      await waitForTransportRetry(baseDelayMs * attempt)
    }
  }
}

function applyReasoningOptions(body, modelConfig = {}, modelId = '') {
  const explicitThinkingType = String(modelConfig.thinking?.type || modelConfig.thinkingType || '').trim().toLowerCase()
  if (explicitThinkingType === 'enabled' || explicitThinkingType === 'disabled') {
    if (isMiniMaxM3Model(modelConfig, modelId)) {
      body.thinking = { type: explicitThinkingType === 'disabled' ? 'disabled' : 'adaptive' }
      if (explicitThinkingType !== 'disabled') body.reasoning_split = true
      return
    }
    body.thinking = { type: explicitThinkingType }
    return
  }

  if (isMiniMaxM3Model(modelConfig, modelId)) {
    body.thinking = { type: 'adaptive' }
    body.reasoning_split = true
    return
  }

  const reasoningEffort = getReasoningEffort(modelConfig)
  if (!reasoningEffort) return

  if (isAgnesModel(modelConfig, modelId)) {
    if (reasoningEffort !== 'low') {
      body.chat_template_kwargs = {
        ...(body.chat_template_kwargs || {}),
        enable_thinking: true
      }
    }
    return
  }

  if (isGlmThinkingModel(modelConfig, modelId)) {
    body.thinking = { type: reasoningEffort === 'low' ? 'disabled' : 'enabled' }
    return
  }

  if (isQwenThinkingModel(modelConfig, modelId)) {
    body.enable_thinking = reasoningEffort !== 'low'
    if (body.enable_thinking) body.thinking_budget = getThinkingBudget(reasoningEffort)
    return
  }

  if (isDeepSeekReasoningModel(modelConfig, modelId)) {
    body.thinking = { type: reasoningEffort === 'low' ? 'disabled' : 'enabled' }
    if (reasoningEffort !== 'low') body.reasoning_effort = reasoningEffort === 'xhigh' ? 'max' : 'high'
    return
  }

  if (isClaudeThinkingModel(modelConfig, modelId)) {
    if (reasoningEffort !== 'low') body.thinking = { type: 'enabled', budget_tokens: getThinkingBudget(reasoningEffort) }
    return
  }

  if (isMiniMaxThinkingModel(modelConfig, modelId)) {
    if (reasoningEffort !== 'low' || isMiniMaxM3Model(modelConfig, modelId)) body.reasoning_split = true
    return
  }

  if (isKimiThinkingModel(modelConfig, modelId)) {
    body.thinking = { type: reasoningEffort === 'low' ? 'disabled' : 'enabled' }
    return
  }

  if (isOpenAIReasoningModel(modelConfig, modelId)) {
    const mapped = getOpenAiReasoningEffort(reasoningEffort)
    if (mapped) body.reasoning_effort = mapped
    return
  }

  const mapped = getOpenAiReasoningEffort(reasoningEffort)
  if (mapped) body.reasoning_effort = mapped
}

function parseJsonObject(text, fallback = {}) {
  try {
    const parsed = JSON.parse(String(text || '').trim() || '{}')
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : fallback
  } catch (error) {
    return fallback
  }
}

function stableShortHash(value = '') {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex').slice(0, 16)
}

function buildStableToolUseId(prefix = 'toolu', ...parts) {
  return `${prefix}_${stableShortHash(parts.map(part => {
    if (part && typeof part === 'object') {
      try {
        return stableJsonStringify(part)
      } catch {
        return String(part)
      }
    }
    return String(part ?? '')
  }).join('\n'))}`
}

function sanitizeAnthropicAssistantContentBlocks(blocks = []) {
  if (!Array.isArray(blocks)) return []
  const clean = []
  for (const block of blocks) {
    if (!block || typeof block !== 'object') continue
    if (block.type === 'text') {
      const text = String(block.text || '').trim()
      if (text) clean.push({ type: 'text', text })
      continue
    }
    if (block.type === 'tool_use') {
      const id = String(block.id || '').trim()
      const name = String(block.name || '').trim()
      if (!id || !name) continue
      clean.push({
        type: 'tool_use',
        id,
        name,
        input: block.input && typeof block.input === 'object' && !Array.isArray(block.input)
          ? block.input
          : parseJsonObject(block.input_json, {})
      })
    }
  }
  return clean
}

function dataUrlToAnthropicImageBlock(url = '') {
  const match = String(url || '').match(/^data:([^;,]+);base64,(.+)$/i)
  if (!match) return null
  return {
    type: 'image',
    source: {
      type: 'base64',
      media_type: match[1],
      data: match[2]
    }
  }
}

function toAnthropicContent(content) {
  if (Array.isArray(content)) {
    const blocks = []
    for (const part of content) {
      if (!part) continue
      if (part.type === 'text') {
        blocks.push({ type: 'text', text: String(part.text || '') })
      } else if (part.type === 'image_url') {
        const imageUrl = typeof part.image_url === 'string' ? part.image_url : part.image_url?.url
        const imageBlock = dataUrlToAnthropicImageBlock(imageUrl)
        if (imageBlock) blocks.push(imageBlock)
        else if (imageUrl) blocks.push({ type: 'text', text: `[image: ${imageUrl}]` })
      } else if (part.type === 'tool_result' || part.type === 'tool_use' || part.type === 'image') {
        blocks.push(part)
      } else if (part.text) {
        blocks.push({ type: 'text', text: String(part.text) })
      }
    }
    return blocks.length ? blocks : [{ type: 'text', text: ' ' }]
  }
  return String(content || '')
}

function toAnthropicTools(tools = [], options = {}) {
  if (!Array.isArray(tools)) return []
  const sourceTools = options.stableOrder
    ? [...tools].sort((left, right) => String(left?.function?.name || '').localeCompare(String(right?.function?.name || '')))
    : tools
  const mapped = sourceTools
    .map(tool => {
      const fn = tool?.function || {}
      if (!fn.name) return null
      return {
        name: fn.name,
        description: fn.description || '',
        input_schema: fn.parameters || { type: 'object', properties: {} }
      }
    })
    .filter(Boolean)
  if (options.promptCache && mapped.length) {
    try {
      const serialized = stableJsonStringify(mapped)
      if (serialized.length >= ANTHROPIC_HISTORY_CACHE_MIN_CHARS) {
        setAnthropicEphemeralMarker(mapped[mapped.length - 1])
      }
    } catch { /* JSON 序列化失败，跳过缓存标记 */ }
  }
  return mapped
}

function mergeAnthropicMessages(messages = []) {
  const merged = []
  const hasToolResult = content => Array.isArray(content) && content.some(part => part?.type === 'tool_result')
  const onlyToolResults = content => Array.isArray(content) && content.length > 0 && content.every(part => part?.type === 'tool_result')
  for (const msg of messages) {
    if (!msg || !msg.role) continue
    const last = merged[merged.length - 1]
    const content = Array.isArray(msg.content) ? msg.content : [{ type: 'text', text: String(msg.content || '') }]
    if (last && last.role === msg.role && Array.isArray(last.content) && (
      (!hasToolResult(last.content) && !hasToolResult(content)) ||
      (msg.role === 'user' && onlyToolResults(last.content) && onlyToolResults(content))
    )) {
      last.content.push(...content)
    } else {
      merged.push({ role: msg.role, content })
    }
  }
  return merged
}

function pruneInvalidAnthropicToolResults(messages = []) {
  const pendingToolUseIds = new Set()
  const pruned = []
  for (const msg of messages) {
    const content = Array.isArray(msg?.content) ? msg.content : []
    if (msg?.role === 'assistant') {
      for (const part of content) {
        if (part?.type === 'tool_use' && part.id) pendingToolUseIds.add(String(part.id))
      }
      pruned.push(msg)
      continue
    }
    if (msg?.role === 'user') {
      const toolResultContent = []
      const textContent = []
      for (const part of content) {
        if (part?.type !== 'tool_result') {
          textContent.push(part)
          continue
        }
        const toolUseId = String(part.tool_use_id || '')
        if (!toolUseId || !pendingToolUseIds.has(toolUseId)) continue
        pendingToolUseIds.delete(toolUseId)
        toolResultContent.push(part)
      }
      if (toolResultContent.length) pruned.push({ ...msg, content: toolResultContent })
      if (textContent.length) pruned.push({ ...msg, content: textContent })
      continue
    }
    pruned.push(msg)
  }
  // 过滤掉 content 为空的消息，防止 Anthropic API 报 400
  return pruned.filter(msg => {
    if (!msg?.content) return false
    if (Array.isArray(msg.content) && msg.content.length === 0) return false
    if (typeof msg.content === 'string' && !msg.content.trim()) return false
    return true
  })
}

function toAnthropicMessages(openAiMessages = []) {
  const systemParts = []
  const messages = []
  for (const msg of openAiMessages) {
    if (!msg || !msg.role) continue
    if (msg.role === 'system') {
      const text = Array.isArray(msg.content)
        ? msg.content.map(part => part?.text || '').filter(Boolean).join('\n')
        : String(msg.content || '')
      if (text.trim()) systemParts.push(text.trim())
      continue
    }
    if (msg.role === 'tool') {
      if (!msg.tool_call_id) continue
      messages.push({
        role: 'user',
        content: [{
          type: 'tool_result',
          tool_use_id: String(msg.tool_call_id || ''),
          content: [{ type: 'text', text: String(msg.content || '') }]
        }]
      })
      continue
    }
    if (msg.role === 'assistant') {
      const content = []
      if (Array.isArray(msg.anthropic_content) && msg.anthropic_content.length) {
        const cleanBlocks = sanitizeAnthropicAssistantContentBlocks(msg.anthropic_content)
        if (cleanBlocks.length) {
          messages.push({ role: 'assistant', content: cleanBlocks })
          continue
        }
      }
      const textContent = Array.isArray(msg.content) ? toAnthropicContent(msg.content) : String(msg.content || '')
      if (Array.isArray(textContent)) content.push(...textContent)
      else if (textContent.trim()) content.push({ type: 'text', text: textContent })
      if (Array.isArray(msg.tool_calls)) {
        for (const [toolIndex, tc] of msg.tool_calls.entries()) {
          const fn = tc?.function || {}
          if (!fn.name) continue
          const input = parseJsonObject(fn.arguments, {})
          content.push({
            type: 'tool_use',
            id: String(tc.id || buildStableToolUseId('toolu', msg.content, fn.name, fn.arguments, toolIndex)),
            name: fn.name,
            input
          })
        }
      }
      messages.push({ role: 'assistant', content: content.length ? content : [{ type: 'text', text: ' ' }] })
      continue
    }
    messages.push({
      role: msg.role === 'user' ? 'user' : 'assistant',
      content: toAnthropicContent(msg.content)
    })
  }
  return {
    systemParts,
    system: systemParts.join('\n\n'),
    messages: pruneInvalidAnthropicToolResults(mergeAnthropicMessages(messages))
  }
}

const ANTHROPIC_CACHE_BREAKPOINT_LIMIT = 4
const ANTHROPIC_HISTORY_CACHE_MIN_CHARS = 1024
const ANTHROPIC_EPHEMERAL_CACHE = Object.freeze({ type: 'ephemeral' })

function isAnthropicEphemeralMarker(value) {
  return value?.cache_control?.type === 'ephemeral' || value?.type === 'ephemeral'
}

function setAnthropicEphemeralMarker(block) {
  if (!block || typeof block !== 'object') return block
  if (block.cache_control?.type === 'ephemeral') return block
  block.cache_control = { ...ANTHROPIC_EPHEMERAL_CACHE }
  return block
}

function clearAnthropicEphemeralMarker(block) {
  if (!block || typeof block !== 'object' || !block.cache_control) return block
  delete block.cache_control
  return block
}

function isAnthropicCacheableHistoryBlock(block) {
  return block?.type === 'text' && typeof block.text === 'string' && block.text.length >= ANTHROPIC_HISTORY_CACHE_MIN_CHARS
}

function isAnthropicCacheableTrailingBlock(block) {
  if (!block || typeof block !== 'object') return false
  if (block.type === 'text' && typeof block.text === 'string' && block.text.length > 0) return true
  // tool_result 文本也允许作为尾部断点，把“本轮已完成的工具前缀”钉住
  if (block.type === 'tool_result') {
    const text = typeof block.content === 'string'
      ? block.content
      : Array.isArray(block.content)
        ? block.content.map(part => part?.text || '').join('')
        : ''
    return text.length > 0
  }
  return false
}

function hasAnthropicToolProtocolBlock(message) {
  return Array.isArray(message?.content) && message.content.some(block => block?.type === 'tool_use' || block?.type === 'tool_result')
}

function countAnthropicCacheMarkers(items) {
  if (!Array.isArray(items)) return 0
  return items.filter(item => item?.cache_control?.type === 'ephemeral').length
}

function collectAnthropicCacheMarkerRefs(body = {}) {
  const refs = []
  const pushBlock = (block, kind) => {
    if (!block || typeof block !== 'object') return
    if (block.cache_control?.type !== 'ephemeral') return
    refs.push({
      kind,
      clear: () => clearAnthropicEphemeralMarker(block)
    })
  }

  if (Array.isArray(body.system)) {
    for (const block of body.system) pushBlock(block, 'system')
  }
  if (Array.isArray(body.tools)) {
    for (const tool of body.tools) pushBlock(tool, 'tools')
  }
  if (Array.isArray(body.messages)) {
    for (const message of body.messages) {
      if (!Array.isArray(message?.content)) continue
      for (const block of message.content) pushBlock(block, 'message')
    }
  }
  return refs
}

// Claude 官方限制约 4 个 cache breakpoint。策略：
// 1) 尽量保留第一个 system 断点（最稳定前缀）
// 2) 其余名额留给“更靠后”的断点（历史/尾部），贴近 Cursor 只留最近断点
function pruneAnthropicCacheMarkers(body = {}, limit = ANTHROPIC_CACHE_BREAKPOINT_LIMIT) {
  const max = Math.max(1, Math.min(4, Number(limit) || ANTHROPIC_CACHE_BREAKPOINT_LIMIT))
  const refs = collectAnthropicCacheMarkerRefs(body)
  if (refs.length <= max) return body

  const keep = new Set()
  const firstSystem = refs.findIndex(item => item.kind === 'system')
  if (firstSystem >= 0) keep.add(firstSystem)
  for (let index = refs.length - 1; index >= 0 && keep.size < max; index -= 1) {
    keep.add(index)
  }
  refs.forEach((ref, index) => {
    if (!keep.has(index)) ref.clear()
  })
  return body
}

// Claude caches the request prefix through marked blocks. Keep one marker on the
// latest stable text-only turn before the current user input, without changing
// tool protocol messages.
function applyAnthropicHistoryCacheBreakpoint(messages = [], options = {}) {
  if (!options.promptCache || !options.optimizeCache || options.remainingMarkers < 1 || !Array.isArray(messages) || messages.length < 2) return messages
  const latestIndex = messages.length - 1
  for (let index = latestIndex - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (hasAnthropicToolProtocolBlock(message) || !Array.isArray(message?.content)) continue
    for (let blockIndex = message.content.length - 1; blockIndex >= 0; blockIndex -= 1) {
      const block = message.content[blockIndex]
      if (!isAnthropicCacheableHistoryBlock(block)) continue
      setAnthropicEphemeralMarker(block)
      return messages
    }
  }
  return messages
}

// 对齐 Cursor：在整段 messages 的最后可缓存块上再打一个尾部断点，
// 让“到当前轮为止”的前缀都能被下一轮读缓存；最终由 prune 控制总数。
function applyAnthropicTrailingCacheBreakpoint(messages = [], options = {}) {
  if (!options.promptCache || !options.optimizeCache || !Array.isArray(messages) || !messages.length) return messages
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (!Array.isArray(message?.content) || !message.content.length) continue
    for (let blockIndex = message.content.length - 1; blockIndex >= 0; blockIndex -= 1) {
      const block = message.content[blockIndex]
      if (!isAnthropicCacheableTrailingBlock(block)) continue
      // 不在 tool_use 上打断点，避免工具协议边界抖动
      if (block.type === 'tool_use') continue
      setAnthropicEphemeralMarker(block)
      return messages
    }
  }
  return messages
}

function isAnthropicPromptCacheOptimizeEnabled(modelConfig = {}) {
  const explicit = modelConfig.claudePromptCacheOptimize ?? modelConfig.claude_prompt_cache_optimize
  if (explicit === false || explicit === 'false' || explicit === 'disabled') return false
  return isPromptCacheOptimizeEnabled(modelConfig)
}

function shouldUseStableToolOrder(modelConfig = {}, options = {}) {
  return isPromptCacheOptimizeEnabled(modelConfig, options)
}

function sortToolsByName(tools = []) {
  if (!Array.isArray(tools)) return []
  return [...tools].sort((left, right) => String(left?.function?.name || '').localeCompare(String(right?.function?.name || '')))
}

function shouldSendParallelToolCalls(modelConfig = {}, modelId = '', endpoint = '') {
  if (getPromptCacheCapability(modelConfig, endpoint, modelId).id === 'deepseek') return false
  const explicit = modelConfig.parallelToolCalls ?? modelConfig.parallel_tool_calls
  if (explicit === false || explicit === 'false' || explicit === 'off' || explicit === 'disabled') return false
  if (explicit === true || explicit === 'true' || explicit === 'on' || explicit === 'enabled') return true
  if (isLocalOllamaModelConfig(modelConfig) || isAgnesModel(modelConfig, modelId)) return false
  const format = getApiFormat(modelConfig, endpoint)
  if (format !== 'openai' && format !== 'openai-responses') return false
  return /api\.openai\.com|openai|chatgpt/i.test(getModelProviderText(modelConfig, modelId))
}

function shouldUseAnthropicPromptCache(modelConfig = {}, modelId = '') {
  const explicit = modelConfig.promptCache ?? modelConfig.prompt_cache ?? modelConfig.cacheControl ?? modelConfig.cache_control
  if (explicit === false || explicit === 'false' || explicit === 'disabled') return false
  if (explicit === true || explicit === 'true' || explicit === 'enabled') return true
  const text = getModelProviderText(modelConfig, modelId)
  if (/api\.anthropic\.com/i.test(String(modelConfig.apiUrl || ''))) return true
  return /api\.apikey\.fun|apikey\.fun/i.test(String(modelConfig.apiUrl || '')) && /claude|anthropic/i.test(text)
}

function buildAnthropicSystemContent(systemParts = [], modelConfig = {}, modelId = '', options = {}) {
  const parts = Array.isArray(systemParts)
    ? systemParts.map(part => String(part || '').trim()).filter(Boolean)
    : []
  if (!parts.length) return ''
  if (options.promptCache === false || !shouldUseAnthropicPromptCache(modelConfig, modelId)) {
    return parts.join('\n\n')
  }
  const optimizeCache = isAnthropicPromptCacheOptimizeEnabled(modelConfig)
  // 命中优先：system 只在最长的前 1～2 个大块上打断点，避免碎块浪费 4 个名额
  return parts.map((text, index) => {
    const block = { type: 'text', text }
    if (text.length >= ANTHROPIC_HISTORY_CACHE_MIN_CHARS && (index === 0 || (optimizeCache && index === 1))) {
      setAnthropicEphemeralMarker(block)
    }
    return block
  })
}

function readFiniteNumber(value) {
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

function extractContentText(content) {
  if (!content) return ''
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content.map(part => extractContentText(part)).filter(Boolean).join('\n')
  }
  if (typeof content === 'object') {
    return [
      content.text,
      content.content,
      content.input_text
    ].map(item => extractContentText(item)).filter(Boolean).join('\n')
  }
  return String(content || '')
}

function getLatestUserMessageText(messages = []) {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i]
    if (message?.role === 'user') return extractContentText(message.content)
  }
  return ''
}

function getEffectiveDisabledTools(messages = [], options = {}) {
  if (shouldUseFixedToolSchema(options.modelConfig || {}, options.modelId || '', options)) return new Set()
  if (
    isPromptCacheOptimizeEnabled(options.modelConfig || {}, options) &&
    shouldPinFullToolSchemaForPromptCache(options.modelConfig || {}, options)
  ) return new Set()
  const disabledTools = new Set(options.disabledTools || [])
  if (options.enableWorkbenchToolGate === false) return disabledTools
  const latestUserText = options.latestUserText || options.userMessage || getLatestUserMessageText(messages)
  for (const name of getAdaptiveDisabledTools(latestUserText, options)) disabledTools.add(name)
  const features = detectWorkbenchMentions(latestUserText)
  for (const name of getDisabledWorkbenchTools(features)) disabledTools.add(name)
  // 默认隐藏外部 MCP（aidev-prototype 等），仅在用户显式 @MCP/@aidev 时解禁
  const mcpFeatures = detectMcpMentions(latestUserText)
  for (const name of getDisabledMcpTools(mcpFeatures)) disabledTools.add(name)
  // 用户关闭的「能力开关」对应工具一律隐藏（含桌面操控等）
  try {
    const featureSettings = require('./feature-settings')
    for (const name of featureSettings.getDisabledTools()) disabledTools.add(name)
  } catch (_) { /* optional module */ }
  return disabledTools
}

function filterModelToolsForRequest(messages = [], options = {}) {
  const disabledTools = getEffectiveDisabledTools(messages, options)
  const tools = MODEL_TOOLS_SCHEMA.filter(tool => !disabledTools.has(tool.function?.name))
  return options.stableToolOrder ? sortToolsByName(tools) : tools
}

function applyAnthropicThinkingOptions(body, modelConfig = {}, modelId = '') {
  const explicitThinkingType = String(modelConfig.thinking?.type || modelConfig.thinkingType || '').trim().toLowerCase()
  if (explicitThinkingType === 'enabled' || explicitThinkingType === 'disabled') {
    body.thinking = explicitThinkingType === 'enabled'
      ? { type: 'enabled', budget_tokens: getThinkingBudget(getReasoningEffort(modelConfig)) || 1024 }
      : { type: 'disabled' }
    return
  }
  const reasoningEffort = getReasoningEffort(modelConfig)
  if (!reasoningEffort || reasoningEffort === 'low') return
  if (/claude|api\.anthropic\.com/i.test(getModelProviderText(modelConfig, modelId))) {
    body.thinking = { type: 'enabled', budget_tokens: getThinkingBudget(reasoningEffort) || 1024 }
  }
}

function buildAnthropicRequestBody(modelConfig, modelId, messages, options = {}) {
  const converted = toAnthropicMessages(messages)
  const promptCache = options.promptCache !== false && shouldUseAnthropicPromptCache(modelConfig, modelId)
  const optimizeCache = promptCache && isAnthropicPromptCacheOptimizeEnabled(modelConfig)
  const maxTokens = readFiniteNumber(modelConfig.max_tokens ?? modelConfig.maxTokens) || 4096
  // Claude：system 块用结构化数组时才能带 cache_control；保持数组形态
  const systemContent = buildAnthropicSystemContent(converted.systemParts, modelConfig, modelId, {
    ...options,
    promptCache
  })
  let tools = []
  if (options.includeTools) {
    // 缓存开启时始终稳定排序工具，避免“本轮关键词变化→工具表变化→前缀打穿”
    tools = toAnthropicTools(
      filterModelToolsForRequest(messages, {
        ...options,
        modelConfig,
        modelId,
        stableToolOrder: promptCache || options.stableToolOrder
      }),
      { promptCache, stableOrder: promptCache || optimizeCache }
    )
  }
  const usedMarkers = countAnthropicCacheMarkers(systemContent) + countAnthropicCacheMarkers(tools)
  if (optimizeCache) {
    applyAnthropicHistoryCacheBreakpoint(converted.messages, {
      promptCache,
      optimizeCache,
      remainingMarkers: ANTHROPIC_CACHE_BREAKPOINT_LIMIT - usedMarkers
    })
    // 尾部断点：把“当前轮之前+当前轮已有内容”纳入可缓存前缀（多轮 tool 循环尤其重要）
    applyAnthropicTrailingCacheBreakpoint(converted.messages, {
      promptCache,
      optimizeCache
    })
  }
  const body = {
    model: modelId,
    max_tokens: maxTokens,
    messages: converted.messages,
    stream: options.stream !== false
  }
  if (systemContent) body.system = systemContent
  if (tools.length) body.tools = tools
  const temperature = readFiniteNumber(modelConfig.temperature)
  const topP = readFiniteNumber(modelConfig.top_p ?? modelConfig.topP)
  if (temperature !== null) body.temperature = temperature
  if (topP !== null) body.top_p = topP
  applyAnthropicThinkingOptions(body, modelConfig, modelId)
  // 最终裁剪：保证不超过 Claude 的 breakpoint 上限，并优先保住 system 首断点 + 最新断点
  if (promptCache) pruneAnthropicCacheMarkers(body, ANTHROPIC_CACHE_BREAKPOINT_LIMIT)
  return body
}

function toResponsesInputContent(content) {
  if (Array.isArray(content)) {
    return content.map(part => {
      if (!part || typeof part !== 'object') return { type: 'input_text', text: String(part || '') }
      if (part.type === 'text') return { type: 'input_text', text: String(part.text || '') }
      if (part.type === 'image_url') {
        const imageUrl = typeof part.image_url === 'string' ? part.image_url : part.image_url?.url
        return imageUrl ? { type: 'input_image', image_url: imageUrl } : { type: 'input_text', text: '' }
      }
      return { type: 'input_text', text: String(part.text || part.content || '') }
    }).filter(part => part.text || part.image_url)
  }
  return String(content || '')
}

function toOpenAIResponsesInput(messages = []) {
  const input = []
  for (const msg of messages) {
    if (!msg || !msg.role) continue
    if (msg.role === 'tool') {
      if (!msg.tool_call_id) continue
      input.push({
        type: 'function_call_output',
        call_id: String(msg.tool_call_id),
        output: String(msg.content || '')
      })
      continue
    }
    const role = msg.role === 'system' ? 'developer' : (msg.role === 'assistant' ? 'assistant' : 'user')
    const content = toResponsesInputContent(msg.content)
    if ((typeof content === 'string' && content.trim()) || (Array.isArray(content) && content.length)) {
      input.push({ role, content })
    }
    if (Array.isArray(msg.tool_calls)) {
      for (const [toolIndex, tc] of msg.tool_calls.entries()) {
        const fn = tc?.function || {}
        if (!fn.name) continue
        input.push({
          type: 'function_call',
          call_id: String(tc.id || buildStableToolUseId('call', msg.content, fn.name, fn.arguments, toolIndex)),
          name: String(fn.name),
          arguments: String(fn.arguments || '{}')
        })
      }
    }
  }
  return input
}

function toOpenAIResponsesTools(tools = []) {
  if (!Array.isArray(tools)) return []
  return tools
    .map(tool => {
      const fn = tool?.function || {}
      if (!fn.name) return null
      return {
        type: 'function',
        name: fn.name,
        description: fn.description || '',
        parameters: fn.parameters || { type: 'object', properties: {} }
      }
    })
    .filter(Boolean)
}

function buildOpenAIResponsesRequestBody(modelConfig, modelId, messages, options = {}) {
  const body = {
    model: modelId,
    input: toOpenAIResponsesInput(messages),
    stream: options.stream !== false
  }
  if (options.includeTools) {
    const tools = toOpenAIResponsesTools(filterModelToolsForRequest(messages, {
      ...options,
      modelConfig,
      modelId,
      stableToolOrder: shouldUseStableToolOrder(modelConfig, options)
    }))
    if (tools.length) {
      body.tools = tools
      if (shouldSendParallelToolCalls(modelConfig, modelId, options.endpoint || modelConfig.apiUrl || '')) {
        body.parallel_tool_calls = true
      }
    }
  }
  const temperature = readFiniteNumber(modelConfig.temperature)
  const topP = readFiniteNumber(modelConfig.top_p ?? modelConfig.topP)
  const maxTokens = readFiniteNumber(modelConfig.max_tokens ?? modelConfig.maxTokens)
  if (temperature !== null) body.temperature = temperature
  if (topP !== null) body.top_p = topP
  if (maxTokens !== null) body.max_output_tokens = maxTokens
  const reasoningEffort = getOpenAiReasoningEffort(getReasoningEffort(modelConfig))
  if (reasoningEffort) body.reasoning = { effort: reasoningEffort }
  applyPromptCacheBodyHints(body, modelConfig, options.endpoint || modelConfig.apiUrl || '', modelId, options)
  return body
}

/**
 * 跨消息级别清洗：保证 assistant(tool_calls) 与 tool 结果严格配对。
 * 移除孤立的 tool 结果（没有对应 assistant tool_calls 的），
 * 为缺少 tool 结果的 assistant tool_calls 补写合成失败结果。
 * 这样发送给 GLM / OpenAI / Anthropic 等模型的请求体不会因不配对历史导致 400。
 */
function sanitizeToolCallPairs(messages = []) {
  if (!Array.isArray(messages) || messages.length === 0) return messages

  // 收集所有 tool_call_id -> tool 结果的映射
  const toolResultIds = new Set()
  for (const msg of messages) {
    if (msg?.role === 'tool' && msg.tool_call_id) {
      toolResultIds.add(String(msg.tool_call_id))
    }
  }

  // 收集所有 assistant 声明的 tool_call id
  const declaredToolCallIds = new Set()
  for (const msg of messages) {
    if (msg?.role === 'assistant' && Array.isArray(msg.tool_calls)) {
      for (const tc of msg.tool_calls) {
        const id = String(tc?.id || '')
        if (id) declaredToolCallIds.add(id)
      }
    }
  }

  // 快速路径：没有 tool_calls 也没有 tool 结果，无需处理
  if (declaredToolCallIds.size === 0 && toolResultIds.size === 0) return messages

  const result = []
  const usedToolResultIds = new Set() // 跟踪已经被配对消费的 tool 结果

  for (let i = 0; i < messages.length; i += 1) {
    const msg = messages[i]

    if (msg?.role === 'tool') {
      const id = String(msg.tool_call_id || '')
      // 只保留有对应 assistant tool_calls 的 tool 结果
      if (declaredToolCallIds.has(id) && !usedToolResultIds.has(id)) {
        usedToolResultIds.add(id)
        result.push(msg)
      }
      // 否则丢弃孤立的 tool 结果
      continue
    }

    if (msg?.role === 'assistant' && Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0) {
      result.push(msg)
      // 为每个 tool_call 找到对应的 tool 结果，按声明顺序补位
      for (const tc of msg.tool_calls) {
        const id = String(tc?.id || '')
        if (!id) continue
        if (!usedToolResultIds.has(id)) {
          // 在原始消息中查找对应的 tool 结果
          let found = null
          for (let j = i + 1; j < messages.length; j += 1) {
            if (messages[j]?.role === 'tool' && String(messages[j].tool_call_id || '') === id) {
              found = messages[j]
              break
            }
          }
          if (found) {
            usedToolResultIds.add(id)
            result.push(found)
          } else {
            // 补写合成失败结果
            usedToolResultIds.add(id)
            result.push({
              role: 'tool',
              tool_call_id: id,
              content: JSON.stringify({ success: false, error: '工具调用结果缺失，已自动补写合成失败结果', synthetic: true })
            })
          }
        }
      }
      continue
    }

    result.push(msg)
  }

  return result
}

function buildChatRequestBody(modelConfig, modelId, messages, options = {}) {
  const normalizedMessages = shouldNormalizeDeepSeekMessages(modelConfig, modelId, options)
    ? messages.map(normalizeDeepSeekChatMessage)
    : messages.map(message => normalizeOpenAIChatMessage(message, modelConfig, modelId))
  // 跨消息级别清洗：保证 tool_calls 与 tool 结果严格配对，避免 GLM 400 InvalidParameter
  const requestMessages = sanitizeToolCallPairs(normalizedMessages)
  const cacheFirstToolLayout = shouldUseFixedToolSchema(modelConfig, modelId, options) ||
    shouldUseGrokPromptCacheLayout(modelConfig, modelId, options)
  const toolList = options.includeTools
    ? filterModelToolsForRequest(messages, {
        ...options,
        modelConfig,
        modelId,
        stableToolOrder: shouldUseStableToolOrder(modelConfig, options)
      })
    : []
  const hasParallelToolCalls = toolList.length && shouldSendParallelToolCalls(modelConfig, modelId, options.endpoint || modelConfig.apiUrl || '')
  const streamEnabled = options.stream !== false
  const hasStreamUsage = streamEnabled && options.includeUsage !== false && !isLocalOllamaModelConfig(modelConfig) && !isAgnesModel(modelConfig, modelId)

  // DeepSeek 与 Grok 都把稳定工具表放在会变化的消息历史前面。
  // Grok 通过 x-grok-conv-id 维持会话缓存，这个顺序能避免最新消息变化时
  // 将整段工具 schema 排除在可复用前缀之外。
  const body = { model: modelId }
  if (cacheFirstToolLayout) {
    body.stream = streamEnabled
    if (hasStreamUsage) body.stream_options = { include_usage: true }
    if (toolList.length) {
      body.tools = toolList
      if (hasParallelToolCalls) body.parallel_tool_calls = true
    }
    body.messages = requestMessages
  } else {
    body.messages = requestMessages
    body.stream = streamEnabled
    if (hasStreamUsage) body.stream_options = { include_usage: true }
    if (toolList.length) {
      body.tools = toolList
      if (hasParallelToolCalls) body.parallel_tool_calls = true
    }
  }
  const temperature = readFiniteNumber(modelConfig.temperature)
  const topP = readFiniteNumber(modelConfig.top_p ?? modelConfig.topP)
  const maxTokens = readFiniteNumber(modelConfig.max_tokens ?? modelConfig.maxTokens)
  if (temperature !== null) body.temperature = temperature
  if (topP !== null) body.top_p = topP
  if (maxTokens !== null) body.max_tokens = maxTokens
  if (!options.disableReasoningOptions) applyReasoningOptions(body, modelConfig, modelId)
  applyPromptCacheBodyHints(body, modelConfig, options.endpoint || modelConfig.apiUrl || '', modelId, options)
  const keepAlive = getOllamaKeepAlive(modelConfig)
  if (keepAlive) body.keep_alive = keepAlive
  return body
}

function toGeminiRole(role = '') {
  return String(role || '').toLowerCase() === 'assistant' ? 'model' : 'user'
}

function toGeminiParts(content) {
  if (Array.isArray(content)) {
    const parts = []
    for (const item of content) {
      if (!item || typeof item !== 'object') continue
      if (typeof item.text === 'string') parts.push({ text: item.text })
      else if (typeof item.content === 'string') parts.push({ text: item.content })
      else if (item.type === 'text' && typeof item.text === 'string') parts.push({ text: item.text })
      else if ((item.type === 'image_url' || item.image_url) && item.image_url?.url) {
        const imageBlock = dataUrlToAnthropicImageBlock(item.image_url.url)
        if (imageBlock?.source?.data) {
          parts.push({ inline_data: { mime_type: imageBlock.source.media_type, data: imageBlock.source.data } })
        }
      }
    }
    return parts.length ? parts : [{ text: '' }]
  }
  return [{ text: String(content ?? '') }]
}

function buildGeminiRequestBody(modelConfig, modelId, messages, options = {}) {
  const systemParts = []
  const contents = []
  for (const message of messages || []) {
    if (!message || typeof message !== 'object') continue
    if (message.role === 'system') {
      systemParts.push(...toGeminiParts(message.content))
      continue
    }
    const parts = toGeminiParts(message.content)
    if (!parts.length) continue
    contents.push({ role: toGeminiRole(message.role), parts })
  }
  const body = { contents }
  if (systemParts.length) body.system_instruction = { parts: systemParts }
  const temperature = readFiniteNumber(modelConfig.temperature)
  const topP = readFiniteNumber(modelConfig.top_p ?? modelConfig.topP)
  const maxTokens = readFiniteNumber(modelConfig.max_tokens ?? modelConfig.maxTokens)
  const generationConfig = {}
  if (temperature !== null) generationConfig.temperature = temperature
  if (topP !== null) generationConfig.topP = topP
  if (maxTokens !== null) generationConfig.maxOutputTokens = maxTokens
  if (Object.keys(generationConfig).length) body.generationConfig = generationConfig
  return body
}

function buildModelRequestBody(modelConfig, modelId, messages, options = {}) {
  const endpoint = options.endpoint || modelConfig.apiUrl || ''
  if (getApiFormat(modelConfig, endpoint) === 'gemini') {
    return buildGeminiRequestBody(modelConfig, modelId, messages, options)
  }
  if (getApiFormat(modelConfig, endpoint) === 'anthropic') {
    return buildAnthropicRequestBody(modelConfig, modelId, messages, options)
  }
  if (!options.forceChatCompletions && (getApiFormat(modelConfig, endpoint) === 'openai-responses' || shouldUseOpenAIResponsesApi(modelConfig, modelId, endpoint))) {
    return buildOpenAIResponsesRequestBody(modelConfig, modelId, messages, options)
  }
  return buildChatRequestBody(modelConfig, modelId, messages, options)
}

function createAnthropicStreamState() {
  return {
    toolCallsByIndex: new Map(),
    openAiToolCallsByKey: new Map(),
    openAiToolCallsByIndex: new Map(),
    contentBlocks: new Map()
  }
}

function parseAnthropicStreamEvent(json, state) {
  const result = { content: '', reasoning_content: '', tool_calls: [], content_blocks: null }
  if (!json || typeof json !== 'object') return result
  if (json.usage || json.message?.usage) result.usage = json.usage || json.message.usage
  if (json.type === 'content_block_start') {
    const index = json.index ?? 0
    const block = json.content_block || {}
    if (block && typeof block === 'object') {
      state.contentBlocks.set(index, { ...block })
      result.content_blocks = Array.from(state.contentBlocks.entries()).sort((a, b) => a[0] - b[0]).map(item => item[1])
    }
    if (block.type === 'text' && block.text) {
      result.content += block.text
    } else if (block.type === 'thinking' && block.thinking) {
      result.reasoning_content += block.thinking
    } else if (block.type === 'tool_use') {
      const toolCall = {
        index,
        id: block.id || buildStableToolUseId('toolu', block.name || '', index, block.input || block.input_json || ''),
        type: 'function',
        function: {
          name: block.name || '',
          arguments: ''
        }
      }
      state.toolCallsByIndex.set(index, toolCall)
      result.tool_calls.push(toolCall)
    }
    return result
  }
  if (json.type === 'content_block_delta') {
    const index = json.index ?? 0
    const delta = json.delta || {}
    let block = state.contentBlocks.get(index)
    if (block) {
      if (delta.type === 'text_delta' && delta.text) block.text = String(block.text || '') + delta.text
      if ((delta.type === 'thinking_delta' || delta.type === 'reasoning_delta') && (delta.thinking || delta.text)) {
        block.thinking = String(block.thinking || '') + (delta.thinking || delta.text)
      }
      if (delta.type === 'input_json_delta' && delta.partial_json) {
        block.input_json = String(block.input_json || '') + delta.partial_json
      }
      result.content_blocks = Array.from(state.contentBlocks.entries()).sort((a, b) => a[0] - b[0]).map(item => item[1])
    }
    if (delta.type === 'text_delta' && delta.text) {
      result.content += delta.text
    } else if ((delta.type === 'thinking_delta' || delta.type === 'reasoning_delta') && (delta.thinking || delta.text)) {
      result.reasoning_content += delta.thinking || delta.text
    } else if (delta.type === 'input_json_delta' && delta.partial_json) {
      let toolCall = state.toolCallsByIndex.get(index)
      if (!toolCall) {
        toolCall = { index, id: '', type: 'function', function: { name: '', arguments: '' } }
        state.toolCallsByIndex.set(index, toolCall)
      }
      result.tool_calls.push({
        index,
        id: toolCall.id,
        type: 'function',
        function: {
          name: toolCall.function.name,
          arguments: delta.partial_json
        }
      })
    }
    return result
  }
  if (json.type === 'message_delta') {
    const stopReason = json.delta?.stop_reason || ''
    if (stopReason === 'tool_use') result.stop_reason = 'tool_use'
  }
  if (json.type === 'content_block_stop') {
    const index = json.index ?? 0
    const block = state.contentBlocks.get(index)
    if (block?.type === 'tool_use' && block.input_json && block.input === undefined) {
      block.input = parseJsonObject(block.input_json, {})
      delete block.input_json
    }
    result.content_blocks = Array.from(state.contentBlocks.entries()).sort((a, b) => a[0] - b[0]).map(item => item[1])
  }
  return result
}

function getOpenAIStreamToolState(state = {}, toolCall = {}, fallbackIndex = 0) {
  if (!state.openAiToolCallsByKey) state.openAiToolCallsByKey = new Map()
  if (!state.openAiToolCallsByIndex) state.openAiToolCallsByIndex = new Map()
  const index = Number.isInteger(toolCall.index) ? toolCall.index : fallbackIndex
  const id = String(toolCall.id || toolCall.call_id || '')
  const key = id || `index_${index}`
  let stateItem = (id && state.openAiToolCallsByKey.get(id)) || state.openAiToolCallsByIndex.get(index) || state.openAiToolCallsByKey.get(key)
  if (!stateItem) {
    stateItem = {
      index,
      id,
      type: 'function',
      function: { name: '', arguments: '' },
      pendingArguments: ''
    }
  }
  if (id) stateItem.id = id
  if (Number.isInteger(toolCall.index)) stateItem.index = toolCall.index
  state.openAiToolCallsByKey.set(key, stateItem)
  if (stateItem.id) state.openAiToolCallsByKey.set(stateItem.id, stateItem)
  state.openAiToolCallsByIndex.set(stateItem.index, stateItem)
  const functionPayload = toolCall.function && typeof toolCall.function === 'object' ? toolCall.function : {}
  const name = functionPayload.name || toolCall.name || ''
  if (name) stateItem.function.name = String(name)
  return stateItem
}

function extractReasoningDetailsDelta(reasoningDetails, state = {}) {
  if (!Array.isArray(reasoningDetails) || reasoningDetails.length === 0) return ''
  if (!state.reasoningDetailsTextByKey) state.reasoningDetailsTextByKey = new Map()
  let output = ''
  reasoningDetails.forEach((detail, index) => {
    if (!detail || typeof detail !== 'object') return
    const text = typeof detail.text === 'string'
      ? detail.text
      : typeof detail.thinking === 'string'
        ? detail.thinking
        : typeof detail.reasoning === 'string'
          ? detail.reasoning
          : typeof detail.content === 'string'
            ? detail.content
            : ''
    if (!text) return
    const key = String(detail.id || detail.type || detail.index || index)
    const previous = state.reasoningDetailsTextByKey.get(key) || ''
    let delta = ''
    if (!previous) delta = text
    else if (text.startsWith(previous)) delta = text.slice(previous.length)
    else if (!previous.startsWith(text)) delta = text
    state.reasoningDetailsTextByKey.set(key, text)
    output += delta
  })
  return output
}

function parseOpenAIStreamEvent(json, state = {}) {
  const delta = json?.choices?.[0]?.delta || null
  const reasoningDetails = delta?.reasoning_details || null
  const reasoningContent = delta?.reasoning_content || extractReasoningDetailsDelta(reasoningDetails, state)
  const rawToolCalls = Array.isArray(delta?.tool_calls) ? delta.tool_calls : []
  const toolCalls = rawToolCalls.map((toolCall, index) => {
    const stateItem = getOpenAIStreamToolState(state, toolCall, index)
    const functionPayload = toolCall?.function && typeof toolCall.function === 'object' ? toolCall.function : {}
    const rawArguments = functionPayload.arguments ?? toolCall?.arguments ?? ''
    let argumentsDelta = ''
    if (typeof rawArguments === 'string') {
      argumentsDelta = rawArguments
    } else if (rawArguments !== undefined && rawArguments !== null) {
      try {
        argumentsDelta = JSON.stringify(rawArguments)
      } catch {
        argumentsDelta = String(rawArguments)
      }
    }
    if (argumentsDelta) stateItem.function.arguments += argumentsDelta
    if (!stateItem.function.name) {
      if (argumentsDelta) stateItem.pendingArguments = String(stateItem.pendingArguments || '') + argumentsDelta
      return null
    }
    const emittedArguments = String(stateItem.pendingArguments || '') + argumentsDelta
    stateItem.pendingArguments = ''
    return {
      index: stateItem.index,
      id: stateItem.id,
      type: 'function',
      function: {
        name: stateItem.function.name,
        arguments: emittedArguments
      }
    }
  }).filter(Boolean)
  return {
    content: delta?.content || '',
    reasoning_content: reasoningContent,
    reasoning_details: reasoningDetails,
    tool_calls: toolCalls,
    usage: json?.usage || null
  }
}

function getResponsesToolState(state, json = {}, item = {}) {
  if (!state.responsesToolCallsByKey) state.responsesToolCallsByKey = new Map()
  const rawKey = Number.isInteger(json.output_index) ? `output_${json.output_index}` : (json.item_id || item.id || item.call_id || '')
  const key = String(rawKey || '')
  const index = Number.isInteger(json.output_index) ? json.output_index : state.responsesToolCallsByKey.size
  if (!key && !Number.isInteger(index)) return null
  const stateKey = key || `output_${index}`
  if (!state.responsesToolCallsByKey.has(stateKey)) {
    state.responsesToolCallsByKey.set(stateKey, {
      index,
      id: item.call_id || item.id || '',
      type: 'function',
      function: {
        name: item.name || '',
        arguments: ''
      }
    })
  }
  const toolCall = state.responsesToolCallsByKey.get(stateKey)
  if (item.call_id || item.id) toolCall.id = item.call_id || item.id
  if (item.name) toolCall.function.name = item.name
  if (typeof item.arguments === 'string' && !toolCall.function.arguments) toolCall.function.arguments = item.arguments
  return toolCall
}

function parseOpenAIResponsesStreamEvent(json, state = {}) {
  const result = { content: '', reasoning_content: '', reasoning_details: null, tool_calls: [], usage: null }
  if (!json || typeof json !== 'object') return result
  const type = String(json.type || '')
  if (type === 'response.output_text.delta' && json.delta) {
    result.content += String(json.delta || '')
    return result
  }
  if ((type === 'response.reasoning_summary_text.delta' || type === 'response.reasoning_text.delta') && json.delta) {
    result.reasoning_content += String(json.delta || '')
    return result
  }
  if (type === 'response.output_item.added' && json.item?.type === 'function_call') {
    const toolCall = getResponsesToolState(state, json, json.item)
    if (toolCall) result.tool_calls.push({ ...toolCall, function: { ...toolCall.function, arguments: '' } })
    return result
  }
  if (type === 'response.function_call_arguments.delta') {
    const toolCall = getResponsesToolState(state, json, {})
    if (toolCall) {
      const delta = String(json.delta || '')
      toolCall.function.arguments += delta
      result.tool_calls.push({
        index: toolCall.index,
        id: toolCall.id,
        type: 'function',
        function: {
          name: toolCall.function.name,
          arguments: delta
        }
      })
    }
    return result
  }
  if (type === 'response.output_item.done' && json.item?.type === 'function_call') {
    const previous = getResponsesToolState(state, json, {})
    const hadArguments = Boolean(previous?.function?.arguments)
    const toolCall = getResponsesToolState(state, json, json.item)
    if (toolCall) {
      result.tool_calls.push({
        index: toolCall.index,
        id: toolCall.id,
        type: 'function',
        function: {
          name: toolCall.function.name,
          arguments: hadArguments ? '' : toolCall.function.arguments
        }
      })
    }
    return result
  }
  if ((type === 'response.completed' || type === 'response.incomplete') && json.response?.usage) {
    result.usage = json.response.usage
    return result
  }
  if (json.usage) result.usage = json.usage
  return result
}

function parseGeminiStreamPayload(text = '') {
  const raw = String(text || '').trim()
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : [parsed]
  } catch { /* 整体 JSON 解析失败，尝试分段解析 */ }
  const trimmed = raw.replace(/^\[/, '').replace(/\]$/, '')
  const chunks = trimmed.split(/\\n\\s*,\\s*\\n|\\r?\\n,\\r?\\n/g).map(item => item.trim()).filter(Boolean)
  const events = []
  for (const chunk of chunks) {
    try {
      events.push(JSON.parse(chunk.replace(/^,\s*/, '').replace(/,\s*$/, '')))
    } catch { /* 分片解析失败，跳过该条目 */ }
  }
  return events
}

function parseGeminiStreamEvent(json) {
  const parts = json?.candidates?.[0]?.content?.parts || []
  return {
    content: Array.isArray(parts) ? parts.map(part => part.text || '').join('') : '',
    reasoning_content: '',
    reasoning_details: null,
    tool_calls: [],
    usage: json?.usageMetadata || null
  }
}

function normalizeStreamToolCall(toolCall = {}, index = 0, apiFormat = 'openai') {
  const functionPayload = toolCall.function && typeof toolCall.function === 'object' ? toolCall.function : {}
  const rawName = functionPayload.name || toolCall.name || ''
  const rawArguments = functionPayload.arguments ?? toolCall.arguments ?? ''
  let argsText = ''
  if (typeof rawArguments === 'string') {
    argsText = rawArguments
  } else if (rawArguments === undefined || rawArguments === null) {
    argsText = ''
  } else {
    try {
      argsText = JSON.stringify(rawArguments)
    } catch {
      argsText = String(rawArguments)
    }
  }
  return {
    index: Number.isInteger(toolCall.index) ? toolCall.index : index,
    id: String(toolCall.id || toolCall.call_id || buildStableToolUseId('tool', rawName, index, argsText)),
    type: 'function',
    function: {
      name: String(rawName || ''),
      arguments: argsText
    }
  }
}

function normalizeStreamToolCalls(toolCalls = [], apiFormat = 'openai') {
  if (!Array.isArray(toolCalls) || toolCalls.length === 0) return { tool_calls: [], diagnostics: [] }
  const diagnostics = []
  const normalized = []
  toolCalls.forEach((toolCall, index) => {
    if (!toolCall || typeof toolCall !== 'object') {
      diagnostics.push({ index, apiFormat, reason: 'tool_call_not_object' })
      return
    }
    const item = normalizeStreamToolCall(toolCall, index, apiFormat)
    if (!item.function.name) diagnostics.push({ index: item.index, apiFormat, id: item.id, reason: 'missing_function_name' })
    if (typeof item.function.arguments !== 'string') diagnostics.push({ index: item.index, apiFormat, id: item.id, reason: 'arguments_not_string' })
    normalized.push(item)
  })
  return { tool_calls: normalized, diagnostics }
}

function parseModelStreamEvent(json, state, apiFormat = 'openai') {
  const result = apiFormat === 'gemini'
    ? parseGeminiStreamEvent(json)
    : apiFormat === 'anthropic'
      ? parseAnthropicStreamEvent(json, state)
      : apiFormat === 'openai-responses'
        ? parseOpenAIResponsesStreamEvent(json, state)
        : parseOpenAIStreamEvent(json, state)
  const normalized = normalizeStreamToolCalls(result.tool_calls, apiFormat)
  result.tool_calls = normalized.tool_calls
  if (normalized.diagnostics.length) {
    result.tool_call_diagnostics = normalized.diagnostics
    console.warn('[ModelApiAdapter] 工具调用归一化发现异常:', normalized.diagnostics.slice(0, 3))
  }
  return result
}

function extractGeminiContent(payload) {
  if (Array.isArray(payload)) {
    return payload.map(item => extractGeminiContent(item)).join('')
  }
  return payload?.candidates?.[0]?.content?.parts?.map(part => part.text || '').join('') || ''
}

function extractModelResponseContent(data, apiFormat = 'openai') {
  const payload = data?.success === true && data.data ? data.data : data
  if (apiFormat === 'gemini') {
    return extractGeminiContent(payload)
  }
  if (apiFormat === 'anthropic') {
    if (typeof payload?.content === 'string') return payload.content
    if (Array.isArray(payload?.content)) {
      return payload.content
        .filter(block => block?.type === 'text' || block?.text)
        .map(block => block.text || '')
        .join('')
    }
    return ''
  }
  if (apiFormat === 'openai-responses') {
    if (typeof payload?.output_text === 'string') return payload.output_text
    if (Array.isArray(payload?.output)) {
      return payload.output
        .flatMap(item => Array.isArray(item?.content) ? item.content : [])
        .filter(part => part?.type === 'output_text' || part?.type === 'text' || part?.text)
        .map(part => part.text || '')
        .join('')
    }
    return ''
  }
  return payload?.choices?.[0]?.message?.content || ''
}

function shouldStopLocalOllamaAfterReply(modelConfig = {}) {
  if (!isLocalOllamaModelConfig(modelConfig)) return false
  if (modelConfig.stopAfterReply === false || modelConfig.autoStop === false) return false
  return true
}

function stopLocalOllamaModelAfterReply(modelConfig = {}, modelId = '') {
  if (!shouldStopLocalOllamaAfterReply(modelConfig)) return
  const model = String(modelId || modelConfig.modelId || modelConfig.modelName || '').trim()
  if (!model || /[\r\n]/.test(model)) return
  execFile('ollama', ['stop', model], { windowsHide: true, timeout: 30000 }, (error) => {
    if (error) {
      console.warn('[AIChat] ollama stop failed:', model, error.message)
    } else {
      console.log('[AIChat] ollama model stopped:', model)
    }
  })
}

function formatModelTransportError(error, endpoint = '', modelConfig = {}) {
  const urlText = String(endpoint || modelConfig.apiUrl || '').trim()
  const proxyUrl = getModelApiProxyUrl(modelConfig)
  let host = ''
  try {
    host = urlText ? new URL(urlText).host : ''
  } catch { /* URL 解析失败 */ }
  const cause = error?.cause || {}
  const parts = [
    'Model API transport error: request did not reach a valid HTTP response.',
    host ? `host=${host}` : '',
    proxyUrl ? `proxy=${proxyUrl}` : '',
    error?.code ? `code=${error.code}` : '',
    cause?.code ? `cause=${cause.code}` : '',
    cause?.message ? `causeMessage=${cause.message}` : '',
    error?.message ? `message=${error.message}` : ''
  ].filter(Boolean)
  return `${parts.join(' ')} Check API URL, proxy/TLS/network, and whether this provider supports the request body fields.`
}

module.exports = {
  isLocalOllamaModelConfig,
  buildOllamaOpenAiEndpoint,
  getOllamaKeepAlive,
  getReasoningEffort,
  getModelProviderText,
  isGlmThinkingModel,
  isDeepSeekReasoningModel,
  isQwenThinkingModel,
  isOpenAIReasoningModel,
  isAgnesModel,
  isClaudeThinkingModel,
  isMiniMaxThinkingModel,
  isMiniMaxM3Model,
  isKimiThinkingModel,
  expectsNativeReasoningStream,
  getThinkingBudget,
  getOpenAiReasoningEffort,
  shouldUseOpenAIResponsesApi,
  getApiFormat,
  buildApiEndpoint,
  buildApiHeaders,
  buildApiFetchOptions,
  shouldUseStickyPromptCacheConnection,
  closeStickyModelAgents,
  shouldAvoidPersistentModelConnection,
  isPreResponseSocketCloseError,
  retryPreResponseSocketClose,
  applyReasoningOptions,
  parseJsonObject,
  sanitizeAnthropicAssistantContentBlocks,
  dataUrlToAnthropicImageBlock,
  toAnthropicContent,
  toAnthropicTools,
  mergeAnthropicMessages,
  pruneInvalidAnthropicToolResults,
  toAnthropicMessages,
  applyAnthropicHistoryCacheBreakpoint,
  applyAnthropicTrailingCacheBreakpoint,
  pruneAnthropicCacheMarkers,
  collectAnthropicCacheMarkerRefs,
  countAnthropicCacheMarkers,
  shouldUseAnthropicPromptCache,
  buildAnthropicSystemContent,
  applyAnthropicThinkingOptions,
  buildAnthropicRequestBody,
  ANTHROPIC_CACHE_BREAKPOINT_LIMIT,
  buildOpenAIResponsesRequestBody,
  buildChatRequestBody,
  buildGeminiRequestBody,
  buildModelRequestBody,
  extractContentText,
  formatModelTransportError,
  getLatestUserMessageText,
  getEffectiveDisabledTools,
  filterModelToolsForRequest,
  createAnthropicStreamState,
  parseAnthropicStreamEvent,
  parseOpenAIStreamEvent,
  parseOpenAIResponsesStreamEvent,
  parseGeminiStreamEvent,
  parseGeminiStreamPayload,
  extractGeminiContent,
  parseModelStreamEvent,
  extractModelResponseContent,
  shouldStopLocalOllamaAfterReply,
  stopLocalOllamaModelAfterReply
}
