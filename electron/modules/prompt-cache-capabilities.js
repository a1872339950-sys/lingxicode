const crypto = require('crypto')

const PROVIDERS = [
  {
    id: 'deepseek',
    match: /deepseek|api\.deepseek\.com/i,
    mode: 'auto'
  },
  {
    id: 'mimo',
    match: /mimo|xiaomi|xiaomimimo|token-plan-cn\.xiaomimimo\.com|mimo\.mi\.com/i,
    mode: 'auto'
  },
  {
    id: 'apikey-fun',
    match: /api\.apikey\.fun|apikey\.fun/i,
    mode: 'keyed',
    bodyCacheKey: 'prompt_cache_key'
  },
  {
    id: 'openai',
    match: /api\.openai\.com|openai|gpt-|(^|[^a-z])o[1345]([^a-z]|$)/i,
    mode: 'auto'
  },
  {
    id: 'anthropic',
    match: /anthropic|claude|api\.anthropic\.com/i,
    mode: 'explicit'
  },
  {
    id: 'gemini',
    match: /gemini|generativelanguage|aiplatform\.googleapis|googleapis\.com/i,
    mode: 'auto'
  },
  {
    id: 'qwen',
    match: /dashscope|aliyuncs|qwen|tongyi|bailian/i,
    mode: 'auto'
  },
  {
    id: 'glm',
    match: /bigmodel|zhipu|glm-|open\.bigmodel\.cn/i,
    mode: 'auto'
  },
  {
    id: 'baidu',
    match: /baidu|qianfan|wenxin|ernie/i,
    mode: 'auto'
  },
  {
    id: 'volcengine',
    match: /volcengine|ark\.cn-beijing|doubao|bytedance/i,
    mode: 'auto'
  },
  {
    id: 'moonshot',
    match: /moonshot|kimi|api\.moonshot\.cn/i,
    mode: 'keyed',
    bodyCacheKey: 'prompt_cache_key'
  },
  {
    id: 'mistral',
    match: /mistral|api\.mistral\.ai/i,
    mode: 'keyed',
    bodyCacheKey: 'prompt_cache_key'
  },
  {
    id: 'tencent-tokenhub',
    match: /tokenhub|lkeap|hunyuan|tencent|cloud\.tencent/i,
    mode: 'keyed',
    bodyCacheKey: 'prompt_cache_key'
  },
  {
    id: 'xai',
    match: /xai|grok|api\.x\.ai/i,
    mode: 'keyed',
    headerCacheKey: 'x-grok-conv-id'
  },
  {
    id: 'minimax',
    match: /minimax|abab|api\.minimax/i,
    mode: 'auto'
  },
  {
    id: 'bedrock',
    match: /bedrock|amazonaws/i,
    mode: 'explicit'
  }
]

function providerText(modelConfig = {}, endpoint = '', modelId = '') {
  return [
    endpoint,
    modelConfig.apiUrl,
    modelConfig.provider,
    modelConfig.apiType,
    modelConfig.apiFormat,
    modelConfig.model,
    modelConfig.modelId,
    modelConfig.modelName,
    modelId
  ].filter(Boolean).join(' ').toLowerCase()
}

function modelIdentityText(modelConfig = {}, modelId = '') {
  return [
    modelConfig.provider,
    modelConfig.apiType,
    modelConfig.apiFormat,
    modelConfig.model,
    modelConfig.modelId,
    modelConfig.modelName,
    modelId
  ].filter(Boolean).join(' ').toLowerCase()
}

function getPromptCacheCapability(modelConfig = {}, endpoint = '', modelId = '') {
  const text = providerText(modelConfig, endpoint, modelId)
  const identityText = modelIdentityText(modelConfig, modelId)
  if (/anthropic|claude/.test(identityText)) {
    return {
      id: 'anthropic',
      mode: 'explicit',
      supportsUsage: true,
      bodyCacheKey: '',
      headerCacheKey: ''
    }
  }
  const matched = PROVIDERS.find(provider => provider.match.test(text))
  const explicit = modelConfig.promptCache ?? modelConfig.prompt_cache
  if (!matched) {
    return {
      id: 'generic',
      mode: explicit === true || explicit === 'true' || explicit === 'enabled' ? 'auto' : 'unknown',
      supportsUsage: true,
      bodyCacheKey: '',
      headerCacheKey: ''
    }
  }
  return {
    id: matched.id,
    mode: matched.mode,
    supportsUsage: true,
    bodyCacheKey: matched.bodyCacheKey || '',
    headerCacheKey: matched.headerCacheKey || ''
  }
}

function hashCachePart(value = '') {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex').slice(0, 32)
}

function normalizeCacheKey(value = '') {
  const text = String(value || '').trim()
  if (!text) return ''
  return text.replace(/[^a-zA-Z0-9_.:-]/g, '_').slice(0, 128)
}

function buildPromptCacheKey(options = {}) {
  const explicit = normalizeCacheKey(options.promptCacheKey || options.prompt_cache_key || options.cacheKey || '')
  if (explicit) return explicit
  const projectId = String(options.projectId || options.project_id || '').trim()
  if (!projectId) return ''
  const optimize = options.scope !== 'session' && isPromptCacheOptimizeEnabled(options)
  const branchId = String(options.branchId || options.branch_id || '').trim()
  const sessionId = String(options.sessionId || options.session_id || '').trim()
  const scopeParts = [projectId]
  if (branchId) scopeParts.push(branchId)
  // session 作用域必须真的包含 sessionId。旧逻辑在 branchId 存在时会忽略
  // sessionId，导致同项目同分支的不同会话共用 cache key、互相冲掉前缀。
  if (!optimize && sessionId) scopeParts.push(sessionId)
  const namespace = scopeParts.join(':')
  return `lx-${hashCachePart(namespace)}`
}

// xAI uses the conversation header as the cache namespace. Keep it stable for
// one project chat session and model, but never let another session/model reuse it.
function buildGrokConversationCacheKey(options = {}, modelId = '') {
  const explicit = normalizeCacheKey(
    options.grokConversationId || options.grok_conversation_id ||
    options.xGrokConvId || options.x_grok_conv_id ||
    options.promptCacheKey || options.prompt_cache_key || options.cacheKey || ''
  )
  if (explicit) return explicit
  const projectId = String(options.projectId || options.project_id || '').trim()
  if (!projectId) return ''
  const branchId = String(options.branchId || options.branch_id || '').trim()
  const sessionId = String(options.sessionId || options.session_id || '').trim()
  const modelScope = String(modelId || options.modelId || options.model_id || options.model || '').trim().toLowerCase()
  const layoutVersion = String(options.grokCacheLayoutVersion || options.grok_cache_layout_version || 'v2').trim()
  return `lx-grok-${hashCachePart([layoutVersion, projectId, branchId, sessionId, modelScope].join(':'))}`
}

function isPromptCacheOptimizeEnabled(...sources) {
  for (const source of sources) {
    if (!source || typeof source !== 'object') continue
    const explicit = source.promptCacheOptimize ?? source.prompt_cache_optimize ?? source.cacheOptimize ?? source.cache_optimize
    if (explicit === false || explicit === 'false' || explicit === 'disabled') return false
    if (explicit === true || explicit === 'true' || explicit === 'enabled') return true
  }
  return true
}

function applyPromptCacheBodyHints(body = {}, modelConfig = {}, endpoint = '', modelId = '', options = {}) {
  if (!body || typeof body !== 'object') return body
  if (options.promptCache === false || options.prompt_cache === false) return body
  const capability = getPromptCacheCapability(modelConfig, endpoint, modelId)
  if (!capability.bodyCacheKey) return body
  const key = buildPromptCacheKey({ ...options, scope: 'session' })
  if (key) body[capability.bodyCacheKey] = key
  return body
}

function applyPromptCacheHeaderHints(headers = {}, modelConfig = {}, endpoint = '', modelId = '', options = {}) {
  if (!headers || typeof headers !== 'object') return headers
  if (options.promptCache === false || options.prompt_cache === false) return headers
  const capability = getPromptCacheCapability(modelConfig, endpoint, modelId)
  if (!capability.headerCacheKey) return headers
  const key = capability.id === 'xai'
    ? buildGrokConversationCacheKey(options, modelId)
    : buildPromptCacheKey(options)
  if (key) headers[capability.headerCacheKey] = key
  return headers
}

function readUsageNumber(...values) {
  for (const value of values) {
    const number = Number(value)
    if (Number.isFinite(number) && number >= 0) return number
  }
  return 0
}

function calculatePromptCacheRate(usage = {}) {
  const cachedTokens = Math.max(0, Number(usage.cachedTokens || 0))
  const cacheMissTokens = Math.max(0, Number(usage.cacheMissTokens || 0))
  const inputTokens = Math.max(0, Number(usage.inputTokens || 0))
  let baseTokens = 0
  if (cachedTokens > 0 || cacheMissTokens > 0) {
    baseTokens = cachedTokens + cacheMissTokens
  } else if (inputTokens > 0) {
    baseTokens = inputTokens
  }
  if (baseTokens <= 0) return null
  return Math.min(100, Math.max(0, (cachedTokens / baseTokens) * 100))
}

function normalizePromptCacheUsage(raw = {}) {
  if (!raw || typeof raw !== 'object') return null
  const promptDetails = raw.prompt_tokens_details || raw.promptTokensDetails || {}
  const inputDetails = raw.input_tokens_details || raw.inputTokensDetails || {}
  const cacheDetails = raw.cache_creation || raw.cacheCreation || {}
  const anthropicCacheReadTokens = readUsageNumber(raw.cache_read_input_tokens, raw.cacheReadInputTokens)
  const anthropicCacheWriteTokens = readUsageNumber(raw.cache_creation_input_tokens, raw.cacheCreationInputTokens)
  const hasAnthropicPromptCacheUsage = anthropicCacheReadTokens > 0 || anthropicCacheWriteTokens > 0
  const cachedTokens = readUsageNumber(
    promptDetails.cached_tokens,
    promptDetails.cachedTokens,
    inputDetails.cached_tokens,
    inputDetails.cachedTokens,
    raw.cache_read_input_tokens,
    raw.cacheReadInputTokens,
    raw.cache_hit_tokens,
    raw.cacheHitTokens,
    raw.cache_read_tokens,
    raw.cacheReadTokens,
    raw.prompt_cache_hit_tokens,
    raw.promptCacheHitTokens,
    raw.prompt_cached_tokens,
    raw.promptCachedTokens,
    raw.prompt_cache_cached_tokens,
    raw.promptCacheCachedTokens,
    raw.cached_tokens,
    raw.cachedTokens,
    raw.cacheHitInputTokens,
    raw.cached_input_tokens,
    raw.cachedInputTokens
  )
  const cacheWriteTokens = readUsageNumber(
    raw.cache_creation_input_tokens,
    raw.cacheCreationInputTokens,
    raw.cache_write_input_tokens,
    raw.cacheWriteInputTokens,
    raw.cache_write_tokens,
    raw.cacheWriteTokens,
    raw.prompt_cache_write_tokens,
    raw.promptCacheWriteTokens,
    cacheDetails.input_tokens,
    cacheDetails.inputTokens
  )
  let cacheMissTokens = readUsageNumber(
    raw.prompt_cache_miss_tokens,
    raw.promptCacheMissTokens,
    raw.cache_miss_tokens,
    raw.cacheMissTokens,
    raw.cache_miss_input_tokens,
    raw.cacheMissInputTokens,
    promptDetails.cache_miss_tokens,
    promptDetails.cacheMissTokens,
    inputDetails.cache_miss_tokens,
    inputDetails.cacheMissTokens
  )
  let inputTokens = readUsageNumber(raw.prompt_tokens, raw.promptTokens, raw.input_tokens, raw.inputTokens)
  if (hasAnthropicPromptCacheUsage) inputTokens += cachedTokens + cacheWriteTokens
  // OpenAI 的 input/prompt_tokens 通常已经包含 cached；部分云端中转则只返回未命中的 input。
  // 当 cached > input 时，input 不可能是总输入，只能按未命中部分解释。
  if (!cacheMissTokens && inputTokens > 0) {
    cacheMissTokens = inputTokens >= cachedTokens + cacheWriteTokens
      ? Math.max(0, inputTokens - cachedTokens - cacheWriteTokens)
      : inputTokens
  }
  const canonicalInputTokens = cachedTokens + cacheWriteTokens + cacheMissTokens
  inputTokens = Math.max(inputTokens, canonicalInputTokens)
  if (!inputTokens && (cachedTokens || cacheMissTokens)) inputTokens = cachedTokens + cacheMissTokens
  const outputTokens = readUsageNumber(raw.completion_tokens, raw.completionTokens, raw.output_tokens, raw.outputTokens)
  const totalTokens = Math.max(readUsageNumber(raw.total_tokens, raw.totalTokens), inputTokens + outputTokens)
  if (!inputTokens && !outputTokens && !totalTokens && !cachedTokens && !cacheWriteTokens && !cacheMissTokens) return null
  return { inputTokens, outputTokens, totalTokens, cachedTokens, cacheWriteTokens, cacheMissTokens }
}

module.exports = {
  PROVIDERS,
  getPromptCacheCapability,
  buildPromptCacheKey,
  buildGrokConversationCacheKey,
  isPromptCacheOptimizeEnabled,
  applyPromptCacheBodyHints,
  applyPromptCacheHeaderHints,
  normalizePromptCacheUsage,
  calculatePromptCacheRate
}
