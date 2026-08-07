/**
 * 对话辅助函数
 * 从 ai-chat.js 的 handleSendMessage 内部提取，包含：
 *   - 思考块剥离与最终正文净化
 *   - 模型成本估算（DeepSeek / GLM 分层定价）
 *   - 缓存使用量规范化
 *
 * 这些函数均为纯函数或仅依赖已抽离的模块，不引用 handleSendMessage 闭包变量。
 */

const { stripInternalInstructionLeaks } = require('./internal-instruction-filter')
const { normalizePromptCacheUsage } = require('./prompt-cache-capabilities')
const { normalizeProgressStatus } = require('./progress-narration')

/**
 * 剥离模型把"思考/推理"块当成正文返回的情况
 * 覆盖 <think>...</think>、<thinking>、<reasoning>、<reflection>、<scratchpad>、<analysis>、<thought>
 * 以及流式中只有开头 <think> 而闭合标签缺失被截断的情况
 */
function stripThinkingArtifacts(text) {
  if (!text) return text
  let result = String(text)
  const tagNames = ['think', 'thinking', 'reasoning', 'reflection', 'scratchpad', 'analysis', 'thought']
  for (const tag of tagNames) {
    const blockRe = new RegExp('<' + tag + '\\b[^>]*>[\\s\\S]*?<\\/' + tag + '>', 'gi')
    result = result.replace(blockRe, '')
    const closingRe = new RegExp('<\\/' + tag + '>', 'i')
    const openOnlyRe = new RegExp('<' + tag + '\\b[^>]*>[\\s\\S]*$', 'i')
    if (!closingRe.test(result) && openOnlyRe.test(result)) {
      result = result.replace(openOnlyRe, '')
    }
    result = result.replace(new RegExp('<\\/?' + tag + '\\b[^>]*>', 'gi'), '')
  }
  // markdown 代码块包思考过程
  result = result.replace(/```(?:think|thinking|reasoning|reflection|analysis)\b[\s\S]*?```/gi, '')
  return result
}

function sanitizeFinalContent(content) {
  return stripInternalInstructionLeaks(stripThinkingArtifacts(String(content || '')), { preserveFormatting: true })
    .replace(/\[\[\s*(?:最终回复|final_reply|final response|final)\s*\]\]/gi, '')
    .replace(/用户指出最终质检未通过[，,。]?\s*/g, '')
    .replace(/用户指出内部质量门禁[，,。]?\s*/g, '')
    .replace(/根据(?:最终质检|统一工程工作流|内部工作流指令)[^。\n]*[。\n]/g, '')
    .replace(/根据内部质量门禁[^。\n]*[。\n]/g, '')
    .replace(/(?:最终质检未通过|统一工程工作流|内部工作流指令|内部质量门禁)[：:][^\n]*(?:\n|$)/g, '')
    .replace(/系统内部提醒说?["“]?[^。\n]*[。”"]?/g, '')
    .replace(/系统(?:提醒|提示|指令)说?["“]?[^。\n]*(?:[。”"\n]|$)/g, '')
    .replace(/内部软提醒[：:][^\n]*(?:\n|$)/g, '')
    .replace(/根据[^。\n]{0,80}(?:工作流|系统提醒|系统提示|代码地图|codemap|code\s*map)[^。\n]*(?:[。\n]|$)/gi, '')
    .replace(/(?:query_code_map|internal_next_instruction|start_final_reply|map[a-z0-9_-]{6,})[：:：]?[^\n]*(?:\n|$)/gi, '')
    .replace(/最终回复(?:里)?禁止提到[^。\n]*(?:[。\n]|$)/g, '')
    .replace(/最终回复不要提到这条内部提醒[。\n]?/g, '')
    .trim()
}

function normalizeCacheUsage(raw = {}) {
  return normalizePromptCacheUsage(raw)
}

function getProviderText(config = {}, currentModelId = '') {
  return [
    config.apiUrl,
    config.provider,
    config.apiType,
    config.modelName,
    config.modelId,
    currentModelId
  ].filter(Boolean).join(' ').toLowerCase()
}

function getDeepSeekCostProfile(config = {}, currentModelId = '') {
  const providerText = getProviderText(config, currentModelId)
  if (!/deepseek|api\.deepseek\.com/.test(providerText)) return null
  const isPro = /deepseek-v4-pro|v4-pro/.test(providerText)
  return isPro
    ? { provider: 'deepseek', tier: 'pro', currency: 'CNY', cachedInputPerMillion: 0.025, missInputPerMillion: 3, outputPerMillion: 6 }
    : { provider: 'deepseek', tier: 'flash', currency: 'CNY', cachedInputPerMillion: 0.02, missInputPerMillion: 1, outputPerMillion: 2 }
}

function getMimoCostProfile(config = {}, currentModelId = '') {
  const providerText = getProviderText(config, currentModelId)
  if (!/mimo|xiaomi|xiaomimimo|token-plan-cn\.xiaomimimo\.com|mimo\.mi\.com/.test(providerText)) return null
  const isPro = /mimo-v?2(?:\.5)?-pro|v?2(?:\.5)?-pro/.test(providerText)
  return isPro
    ? { provider: 'mimo', tier: 'v2.5-pro', currency: 'CNY', cachedInputPerMillion: 0.025, missInputPerMillion: 3, outputPerMillion: 6 }
    : { provider: 'mimo', tier: 'v2.5', currency: 'CNY', cachedInputPerMillion: 0.02, missInputPerMillion: 1, outputPerMillion: 2 }
}

function getGlmCostProfile(config = {}, currentModelId = '', usage = {}) {
  const providerText = [
    config.provider,
    config.modelName,
    config.modelId,
    currentModelId
  ].filter(Boolean).join(' ').toLowerCase()
  const endpointText = getProviderText(config, currentModelId)
  if (!/open\.bigmodel\.cn|bigmodel|zhipu|glm-|智谱/.test(endpointText)) return null

  const inputTokens = Math.max(0, Number(usage.inputTokens || 0))
  const longContext = inputTokens >= 32000
  const makeTiered = (shortProfile, longProfile) => longContext ? longProfile : shortProfile

  if (/glm-5\.2/.test(providerText)) {
    return { provider: 'glm', tier: '5.2', currency: 'CNY', cachedInputPerMillion: 2, missInputPerMillion: 8, outputPerMillion: 28 }
  }
  if (/glm-5\.1/.test(providerText)) {
    return makeTiered(
      { provider: 'glm', tier: '5.1-short', currency: 'CNY', cachedInputPerMillion: 1.3, missInputPerMillion: 6, outputPerMillion: 24 },
      { provider: 'glm', tier: '5.1-long', currency: 'CNY', cachedInputPerMillion: 2, missInputPerMillion: 8, outputPerMillion: 28 }
    )
  }
  if (/glm-5-turbo/.test(providerText)) {
    return makeTiered(
      { provider: 'glm', tier: '5-turbo-short', currency: 'CNY', cachedInputPerMillion: 1.2, missInputPerMillion: 5, outputPerMillion: 22 },
      { provider: 'glm', tier: '5-turbo-long', currency: 'CNY', cachedInputPerMillion: 1.8, missInputPerMillion: 7, outputPerMillion: 26 }
    )
  }
  if (/glm-5(?![\d.])/.test(providerText)) {
    return makeTiered(
      { provider: 'glm', tier: '5-short', currency: 'CNY', cachedInputPerMillion: 1, missInputPerMillion: 4, outputPerMillion: 18 },
      { provider: 'glm', tier: '5-long', currency: 'CNY', cachedInputPerMillion: 1.5, missInputPerMillion: 6, outputPerMillion: 22 }
    )
  }
  return null
}

function getModelCostProfile(config = {}, currentModelId = '', usage = {}) {
  return getDeepSeekCostProfile(config, currentModelId) ||
    getMimoCostProfile(config, currentModelId) ||
    getGlmCostProfile(config, currentModelId, usage)
}

function formatCnyCost(value) {
  const amount = Number(value || 0)
  if (!Number.isFinite(amount) || amount <= 0) return '¥0'
  if (amount < 0.0001) return '<¥0.0001'
  if (amount < 0.01) return `¥${amount.toFixed(4)}`
  if (amount < 1) return `¥${amount.toFixed(3)}`
  return `¥${amount.toFixed(2)}`
}

function estimateModelCost(usage = {}, config = {}, currentModelId = '') {
  const profile = getModelCostProfile(config, currentModelId, usage)
  if (!profile) return null
  const cachedTokens = Math.max(0, Number(usage.cachedTokens || 0))
  const inputTokens = Math.max(0, Number(usage.inputTokens || 0))
  const explicitMissTokens = Math.max(0, Number(usage.cacheMissTokens || 0))
  const missTokens = explicitMissTokens || Math.max(0, inputTokens - cachedTokens)
  const outputTokens = Math.max(0, Number(usage.outputTokens || 0))
  const cachedInputCost = cachedTokens / 1000000 * profile.cachedInputPerMillion
  const missInputCost = missTokens / 1000000 * profile.missInputPerMillion
  const outputCost = outputTokens / 1000000 * profile.outputPerMillion
  const amount = cachedInputCost + missInputCost + outputCost
  return {
    provider: profile.provider,
    tier: profile.tier,
    currency: profile.currency,
    amount,
    amountText: formatCnyCost(amount),
    cachedInputCost,
    missInputCost,
    outputCost,
    cachedTokens,
    missTokens,
    outputTokens
  }
}

/**
 * 工具调用相关纯函数（从 handleSendMessage 内部提取）
 */

const PLAN_CONTROL_TOOLS = new Set([
  'enter_plan_mode',
  'ask_user_choice',
  'confirm_plan',
  'enter_auto_mode',
  'ask_step_confirm',
  'complete_step',
  'start_final_reply',
  'record_ai_operation_memo',
  'report_progress',
  'show_thinking_note'
])

const INTERNAL_UI_ONLY_TOOLS = new Set([
  'start_final_reply',
  'record_ai_operation_memo',
  'report_progress',
  'show_thinking_note',
  'complete_step',
  // 内嵌可视化：对用户不展示工具卡，只在最终回复中自然呈现
  'create_inline_visual'
])

function parseToolArgsSafe(toolCall) {
  try {
    return JSON.parse(toolCall?.function?.arguments || '{}')
  } catch {
    return {}
  }
}

function isProgressToolCall(toolCall) {
  return toolCall?.function?.name === 'report_progress'
}

function getProgressToolStatus(toolCalls = []) {
  for (const toolCall of toolCalls) {
    if (!isProgressToolCall(toolCall)) continue
    const args = parseToolArgsSafe(toolCall)
    const status = normalizeProgressStatus(args.status || args.message || args.content || args.progress || args.note || '')
    if (status) return status
  }
  return ''
}

function emitProgressToolStatus(toolCalls = [], parser = null) {
  const status = getProgressToolStatus(toolCalls)
  if (!status) return ''
  parser?.emitStatus?.(status)
  return parser?.getLastStatus?.() || status
}

function hasUserVisibleToolCalls(toolCalls = []) {
  return toolCalls.some(tc => {
    const name = tc?.function?.name || ''
    return name && !INTERNAL_UI_ONLY_TOOLS.has(name)
  })
}

function isInternalUiOnlyToolName(name = '') {
  return INTERNAL_UI_ONLY_TOOLS.has(String(name || ''))
}

module.exports = {
  stripThinkingArtifacts,
  sanitizeFinalContent,
  normalizeCacheUsage,
  getProviderText,
  getDeepSeekCostProfile,
  getMimoCostProfile,
  getGlmCostProfile,
  getModelCostProfile,
  formatCnyCost,
  estimateModelCost,
  PLAN_CONTROL_TOOLS,
  INTERNAL_UI_ONLY_TOOLS,
  isInternalUiOnlyToolName,
  parseToolArgsSafe,
  isProgressToolCall,
  getProgressToolStatus,
  emitProgressToolStatus,
  hasUserVisibleToolCalls
}
