/**
 * 统一上下文构建器
 * - 按当前模型的真实上下文窗口计算预算
 * - 按请求 token 重量压缩旧消息，不按轮次数量裁剪
 * - 超长消息转存为本地引用，不要求用户手动分段
 * - 只影响发给 AI 的上下文，不删除完整聊天记录
 */

const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

const DEFAULT_CONTEXT_POLICY = {
  maxContextTokens: 128000,
  inputBudgetTokens: 100000,
  outputReserveTokens: 20000,
  safetyTokens: 8000,

  behaviorSummaryMaxChars: 8000,
  includeBehaviorSummary: true,
  compressedHistoryMaxChars: 8000,
  includeDynamicCompressedHistory: true,
  maxSingleMessageChars: 12000,
  minSingleMessageChars: 2000,
  maxToolResultChars: 1200,

  oversizedDirName: 'oversized-inputs'
}

function buildContextPayload(options = {}) {
  let policy = { ...DEFAULT_CONTEXT_POLICY, ...(options.policy || {}) }
  const contextManager = options.contextManager
  const systemPrompt = options.systemPrompt || ''
  const history = Array.isArray(options.history) ? options.history : []
  const prioritySystemMessages = Array.isArray(options.prioritySystemMessages)
    ? dedupeSystemMessages(options.prioritySystemMessages)
    : []
  const extraSystemMessages = Array.isArray(options.extraSystemMessages)
    ? dedupeSystemMessages(options.extraSystemMessages)
    : []

  let compressedHistory = policy.preserveCachePrefix === true
    ? history.map(msg => ({ ...msg }))
    : (contextManager?.compressHistory
        ? contextManager.compressHistory(history)
        : history.map(msg => ({ ...msg })))

  let maxSingleMessageChars = policy.maxSingleMessageChars
  let built = buildOnce({
    contextManager,
    systemPrompt,
    prioritySystemMessages,
    extraSystemMessages,
    history: compressedHistory,
    policy,
    maxSingleMessageChars
  })

  // 同一模型的稳定视图优先逐字节保留历史前缀。只有稳定前缀本身已经超过
  // 当前输入预算时，才降级到工具结果/超长消息压缩；避免每个新用户轮都改写旧前缀。
  if (policy.preserveCachePrefix === true && built && built.estimatedTokens > policy.inputBudgetTokens) {
    policy = { ...policy, preserveCachePrefix: false, cachePrefixFallback: true }
    compressedHistory = contextManager?.compressHistory
      ? contextManager.compressHistory(history)
      : history.map(msg => ({ ...msg }))
    maxSingleMessageChars = policy.maxSingleMessageChars
    built = buildOnce({
      contextManager,
      systemPrompt,
      prioritySystemMessages,
      extraSystemMessages,
      history: compressedHistory,
      policy,
      maxSingleMessageChars
    })
  }

  while (built && built.estimatedTokens > policy.inputBudgetTokens && maxSingleMessageChars > policy.minSingleMessageChars) {
    maxSingleMessageChars = Math.max(policy.minSingleMessageChars, Math.floor(maxSingleMessageChars / 2))
    built = buildOnce({
      contextManager,
      systemPrompt,
      prioritySystemMessages,
      extraSystemMessages,
      history: compressedHistory,
      policy,
      maxSingleMessageChars
    })
  }

  if (built && built.estimatedTokens > policy.inputBudgetTokens) {
    built = buildEmergencyPayload({
      contextManager,
      systemPrompt,
      prioritySystemMessages,
      extraSystemMessages,
      history: compressedHistory,
      policy
    })
  }

  return built
}

function dedupeSystemMessages(messages = []) {
  const seen = new Set()
  const result = []
  for (const item of messages) {
    const text = typeof item === 'string' ? item : String(item || '')
    const trimmed = text.trim()
    if (!trimmed) continue
    const key = trimmed.replace(/\s+/g, ' ')
    if (seen.has(key)) continue
    seen.add(key)
    result.push(trimmed)
  }
  return result
}

function hashStableText(value = '') {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex').slice(0, 16)
}

function getStableMessageSuffix(message = {}, index = '') {
  const role = String(message?.role || 'message').replace(/[^a-z0-9_-]/gi, '') || 'message'
  const text = toPlainText(message?.content || '')
  return `${index}-${role}-${hashStableText(text)}`
}

function buildOnce({ contextManager, systemPrompt, prioritySystemMessages = [], extraSystemMessages = [], history, policy, maxSingleMessageChars }) {
  const oversizedRefs = []

  const messages = [{ role: 'system', content: systemPrompt }]
  for (const content of prioritySystemMessages) {
    messages.push({ role: 'system', content })
  }
  for (const content of extraSystemMessages) {
    messages.push({ role: 'system', content })
  }

  const behaviorSummary = policy.includeBehaviorSummary === false
    ? ''
    : getBehaviorSummary(contextManager, policy.behaviorSummaryMaxChars)
  if (behaviorSummary) {
    messages.push({ role: 'system', content: `【项目行为摘要】\n${behaviorSummary}` })
  }

  const normalizedHistory = history.map((msg, index) => normalizeMessage(msg, {
    contextManager,
    policy,
    maxSingleMessageChars,
    oversizedRefs,
    suffix: getStableMessageSuffix(msg, index)
  }))
  const baseTokens = estimateMessages(contextManager, messages)
  const summaryReserveTokens = policy.includeDynamicCompressedHistory === false
    ? 0
    : Math.ceil(policy.compressedHistoryMaxChars / 3)
  const historyBudgetTokens = Math.max(1000, policy.inputBudgetTokens - baseTokens - summaryReserveTokens)
  const split = splitHistoryByTokenBudget(normalizedHistory, historyBudgetTokens, contextManager)
  const omittedMessageCount = split.oldHistory.length
  const compressedSummary = policy.includeDynamicCompressedHistory === false
    ? ''
    : buildCompressedHistorySummary(split.oldHistory, omittedMessageCount, policy.compressedHistoryMaxChars)
  if (compressedSummary) {
    messages.push({ role: 'system', content: compressedSummary })
  }

  messages.push(...split.recentHistory)

  const estimatedTokens = estimateMessages(contextManager, messages)

  return {
    messages,
    estimatedTokens,
    budgetTokens: policy.inputBudgetTokens,
    maxContextTokens: policy.maxContextTokens,
    compressed: omittedMessageCount > 0 || oversizedRefs.length > 0,
    splitIndex: omittedMessageCount,
    summary: compressedSummary,
    oversizedRefs,
    retainedHistoryTokens: split.retainedTokens,
    omittedHistoryTokens: split.omittedTokens,
    policy
  }
}

function buildEmergencyPayload({ contextManager, systemPrompt, prioritySystemMessages = [], extraSystemMessages = [], history, policy }) {
  const oversizedRefs = []

  const messages = [{ role: 'system', content: systemPrompt }]
  for (const content of prioritySystemMessages) {
    messages.push({ role: 'system', content })
  }
  for (const content of extraSystemMessages) {
    messages.push({ role: 'system', content })
  }
  const behaviorSummary = policy.includeBehaviorSummary === false
    ? ''
    : getBehaviorSummary(contextManager, Math.floor(policy.behaviorSummaryMaxChars / 2))
  if (behaviorSummary) messages.push({ role: 'system', content: `【项目行为摘要】\n${behaviorSummary}` })

  const compressedSummary = policy.includeDynamicCompressedHistory === false
    ? ''
    : buildCompressedHistorySummary(history.slice(0, -1), Math.max(0, history.length - 1), Math.floor(policy.compressedHistoryMaxChars / 2))
  if (compressedSummary) messages.push({ role: 'system', content: compressedSummary })

  const lastMessage = history[history.length - 1]
  if (lastMessage) {
    messages.push(normalizeMessage(lastMessage, {
      contextManager,
      policy,
      maxSingleMessageChars: policy.minSingleMessageChars,
      oversizedRefs,
      suffix: getStableMessageSuffix(lastMessage, 'last')
    }))
  }

  return {
    messages,
    estimatedTokens: estimateMessages(contextManager, messages),
    budgetTokens: policy.inputBudgetTokens,
    maxContextTokens: policy.maxContextTokens,
    compressed: true,
    splitIndex: Math.max(0, history.length - 1),
    summary: compressedSummary,
    oversizedRefs,
    emergency: true,
    policy
  }
}

function splitHistoryByTokenBudget(history, budgetTokens, contextManager) {
  if (!Array.isArray(history) || history.length === 0) {
    return { oldHistory: [], recentHistory: [], retainedTokens: 0, omittedTokens: 0 }
  }
  const groups = buildAtomicHistoryGroups(history)
  const selected = []
  let retainedTokens = 0
  for (let index = groups.length - 1; index >= 0; index--) {
    const group = groups[index]
    const groupTokens = estimateMessages(contextManager, group.messages)
    if (selected.length > 0 && retainedTokens + groupTokens > budgetTokens) break
    selected.unshift(group)
    retainedTokens += groupTokens
  }
  const startIndex = selected.length ? selected[0].startIndex : history.length - 1
  const oldHistory = history.slice(0, startIndex)
  return {
    oldHistory,
    recentHistory: history.slice(startIndex),
    retainedTokens,
    omittedTokens: estimateMessages(contextManager, oldHistory)
  }
}

function buildAtomicHistoryGroups(history = []) {
  const groups = []
  let current = null
  history.forEach((message, index) => {
    // 用户消息是一个新任务边界；这只是防止截断工具调用配对，不参与“保留几轮”的决策。
    if (!current || (message?.role === 'user' && !message?._deepseekBridge)) {
      current = { startIndex: index, messages: [] }
      groups.push(current)
    }
    current.messages.push(message)
  })
  return groups
}

function normalizeMessage(message, options) {
  const msg = pickApiMessageFields(message)

  if (options.policy.preserveCachePrefix === true) return msg

  // DeepSeek 并行工具桥接消息：内容已由 buildDeepSeekMultiToolCacheBridge 裁剪，
  // 必须逐字节原样透传，不能被 normalizeTextContent 转存或改写，否则下一轮重建前缀
  // 时与上一轮发给 API 的内容不一致，直接击穿 DeepSeek 前缀缓存。
  if (msg._deepseekBridge) {
    return msg
  }

  if (msg.role === 'tool') {
    msg.content = truncateText(toPlainText(msg.content), options.policy.maxToolResultChars)
    return msg
  }

  if (typeof msg.content === 'string') {
    msg.content = normalizeTextContent(msg.content, msg.role, options)
    return msg
  }

  if (Array.isArray(msg.content)) {
    msg.content = msg.content.map((part, index) => {
      if (part?.type === 'text' && typeof part.text === 'string') {
        return {
          ...part,
          text: normalizeTextContent(part.text, msg.role, { ...options, suffix: `${options.suffix}-${index}` })
        }
      }
      return part
    })
  }

  return msg
}

function pickApiMessageFields(message = {}) {
  const msg = {
    role: message.role,
    content: message.content
  }

  if (message.name) msg.name = message.name
  if (message.tool_call_id) msg.tool_call_id = message.tool_call_id
  if (message.tool_calls) {
    msg.tool_calls = message.tool_calls.map(toolCall => ({
      id: toolCall.id,
      type: toolCall.type || 'function',
      function: {
        name: toolCall.function?.name || '',
        arguments: toolCall.function?.arguments || '{}'
      }
    }))
  }
  if (message.reasoning_content) msg.reasoning_content = message.reasoning_content
  if (message.reasoning_details) msg.reasoning_details = message.reasoning_details
  if (message.anthropic_content) msg.anthropic_content = message.anthropic_content
  if (message._deepseekBridge) msg._deepseekBridge = true

  return msg
}

function normalizeTextContent(text, role, options) {
  if (!text || text.length <= options.maxSingleMessageChars) return text

  const refPath = storeOversizedText(text, role, options)
  if (refPath) {
    options.oversizedRefs.push(refPath)
    return [
      '[内容过长，系统已自动转存完整内容]',
      `完整内容路径: ${refPath}`,
      '以下是自动摘要:',
      summarizeText(text, options.maxSingleMessageChars)
    ].join('\n')
  }

  return summarizeText(text, options.maxSingleMessageChars)
}

function storeOversizedText(text, role, options) {
  const storagePath = options.contextManager?.storagePath
  if (!storagePath) return null

  try {
    const dir = path.join(storagePath, options.policy.oversizedDirName)
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
    const safeRole = String(role || 'message').replace(/[^a-z0-9_-]/gi, '')
    const filePath = path.join(dir, `${safeRole}-${options.suffix}.txt`)
    fs.writeFileSync(filePath, text, 'utf-8')
    return filePath
  } catch (e) {
    console.error('[ContextBuilder] 超长内容转存失败:', e.message)
    return null
  }
}

function getBehaviorSummary(contextManager, maxChars) {
  try {
    const text = contextManager?.summary?.formatForAPI?.()
    if (!text || text.trim().length < 20) return ''
    return truncateText(text, maxChars)
  } catch (e) {
    console.error('[ContextBuilder] 读取行为摘要失败:', e.message)
    return ''
  }
}

function buildCompressedHistorySummary(oldHistory, omittedMessageCount, maxChars) {
  if (!oldHistory || oldHistory.length === 0 || omittedMessageCount <= 0) return ''

  const lines = [
    '【已自动压缩的历史上下文】',
    `较早的 ${omittedMessageCount} 条消息因达到 token 预算已压缩为摘要，完整聊天记录仍保存在本地界面和项目记忆中。`,
    '如果后续任务涉及这些旧对话的具体细节，必须先调用 recall_history 查询当前项目记忆，不要凭摘要猜。',
    ''
  ]

  const rounds = []
  let current = null
  for (const msg of oldHistory) {
    if (msg.role === 'user') {
      if (current) rounds.push(current)
      current = { user: toPlainText(msg.content), ai: '' }
    } else if (current && msg.role === 'assistant' && msg.content) {
      current.ai = toPlainText(msg.content)
    }
  }
  if (current) rounds.push(current)

  rounds.slice(-12).forEach((round, index) => {
    lines.push(`- 历史片段 ${index + 1}: 用户=${truncateText(round.user, 180)}${round.ai ? `; AI=${truncateText(round.ai, 180)}` : ''}`)
  })

  return truncateText(lines.join('\n'), maxChars)
}

function summarizeText(text, maxChars) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim()
  if (clean.length <= maxChars) return clean

  const headSize = Math.floor(maxChars * 0.65)
  const tailSize = Math.max(200, maxChars - headSize - 80)
  return `${clean.slice(0, headSize)}\n...[中间内容已自动压缩]...\n${clean.slice(-tailSize)}`
}

function truncateText(text, maxChars) {
  const str = String(text || '')
  if (str.length <= maxChars) return str
  return `${str.slice(0, Math.max(0, maxChars - 30))}\n...[已压缩]`
}

function toPlainText(content) {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content.map(part => {
      if (part?.type === 'text') return part.text || ''
      if (part?.type === 'image_url') return '[图片]'
      return ''
    }).join('\n')
  }
  if (content === null || content === undefined) return ''
  try {
    return JSON.stringify(content)
  } catch (e) {
    return String(content)
  }
}

function estimateMessages(contextManager, messages) {
  return (Array.isArray(messages) ? messages : []).reduce((sum, msg) => {
    let serialized = ''
    try {
      serialized = JSON.stringify({
        role: msg?.role,
        content: msg?.content,
        name: msg?.name,
        tool_call_id: msg?.tool_call_id,
        tool_calls: msg?.tool_calls,
        reasoning_content: msg?.reasoning_content,
        reasoning_details: msg?.reasoning_details,
        anthropic_content: msg?.anthropic_content
      })
    } catch {
      serialized = toPlainText(msg?.content)
    }
    const estimated = contextManager?.estimateTokens
      ? contextManager.estimateTokens(serialized)
      : Math.ceil(serialized.length / 4)
    return sum + Math.max(4, estimated)
  }, 0)
}

module.exports = {
  DEFAULT_CONTEXT_POLICY,
  buildContextPayload
}
