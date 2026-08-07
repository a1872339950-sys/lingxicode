const crypto = require('crypto')

const DEFAULT_HISTORY_TOKEN_BUDGET = 80000

function isDeepSeekBridgeMessage(message) {
  return Boolean(message && (message._deepseekBridge || message.deepseekBridge))
}

/**
 * Messages that belong in the model context window.
 * DeepSeek multi-tool bridge messages are UI-hidden but must stay for prefix cache.
 */
function isVisibleMessage(message) {
  if (!message || message.type === 'compression-divider') return false
  if (isDeepSeekBridgeMessage(message)) return true
  return !message.hidden
}

/** Real user turns only (exclude bridge synthetic user messages). */
function isUserTurnMessage(message) {
  return Boolean(
    message &&
    message.role === 'user' &&
    isVisibleMessage(message) &&
    !isDeepSeekBridgeMessage(message) &&
    !message.hidden
  )
}

function estimateMessageTokens(message = {}) {
  try {
    return Math.max(4, Math.ceil(JSON.stringify(message).length / 4))
  } catch {
    return Math.max(4, Math.ceil(String(message?.content || '').length / 4))
  }
}

function findTokenBudgetStartIndex(history = [], currentIndex, tokenBudget = DEFAULT_HISTORY_TOKEN_BUDGET) {
  if (!Array.isArray(history) || history.length === 0) return 0
  const safeCurrentIndex = Math.max(0, Math.min(Number(currentIndex) || 0, history.length - 1))
  const budget = Math.max(1000, Number(tokenBudget) || DEFAULT_HISTORY_TOKEN_BUDGET)
  let usedTokens = 0
  let startIndex = safeCurrentIndex
  for (let index = safeCurrentIndex; index >= 0; index--) {
    const message = history[index]
    if (!isVisibleMessage(message)) continue
    const nextTokens = estimateMessageTokens(message)
    if (index < safeCurrentIndex && usedTokens + nextTokens > budget) break
    usedTokens += nextTokens
    startIndex = index
  }
  // 不从一组 tool result 中间切开；向前扩到最近一个真实用户边界。
  while (startIndex > 0 && !isUserTurnMessage(history[startIndex])) startIndex--
  return startIndex
}

function buildRequestHistoryWindow(history = [], currentIndex, options = {}) {
  if (!Array.isArray(history) || history.length === 0) {
    return { history: [], startIndex: 0, trimmedCount: 0 }
  }
  const safeCurrentIndex = Math.max(0, Math.min(Number(currentIndex) || 0, history.length - 1))
  const startIndex = findTokenBudgetStartIndex(history, safeCurrentIndex, options.tokenBudget)
  const before = history.slice(startIndex, safeCurrentIndex)
  const current = history[safeCurrentIndex] ? { ...history[safeCurrentIndex] } : null

  // Only strip adjacent real user turns; keep DeepSeek bridge synthetic user messages.
  while (before.length && isUserTurnMessage(before[before.length - 1])) before.pop()

  return {
    history: current ? [...before, current] : before,
    startIndex,
    trimmedCount: startIndex
  }
}

function buildSummarySafeHistory(windowResult, summaryBlock = '') {
  const recentHistory = Array.isArray(windowResult?.history) ? windowResult.history : []
  const summary = String(summaryBlock || '').trim()
  return summary
    ? [{ role: 'system', content: summary }, ...recentHistory]
    : recentHistory.slice()
}

function hasMessageContent(message = {}) {
  if (typeof message.content === 'string') return message.content.trim().length > 0
  if (Array.isArray(message.content)) return message.content.some(part => {
    if (typeof part === 'string') return part.trim().length > 0
    return typeof part?.text === 'string' && part.text.trim().length > 0
  })
  return message.content !== null && message.content !== undefined
}

function isCompletedFinalAssistantMessage(message = {}) {
  if (!message || message.role !== 'assistant') return false
  if (isDeepSeekBridgeMessage(message)) return false
  if (Array.isArray(message.tool_calls) && message.tool_calls.length > 0) return false
  if (
    message.interrupted ||
    message.error ||
    message.timeout ||
    message.aborted ||
    message.unfinished ||
    message.interjectPause
  ) return false
  return hasMessageContent(message)
}

function toCompletedFinalMessage(message = {}) {
  return {
    role: 'assistant',
    content: message.content,
    modelName: message.modelName,
    modelId: message.modelId,
    modelCacheIdentity: message.modelCacheIdentity
  }
}

function normalizeModelAlias(value = '') {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, ' ')
}

function normalizeApiEndpoint(value = '') {
  const raw = String(value || '').trim()
  if (!raw) return ''
  try {
    const parsed = new URL(raw)
    return `${parsed.protocol}//${parsed.host}${parsed.pathname}`.replace(/\/+$/, '').toLowerCase()
  } catch (_) {
    return raw.split(/[?#]/, 1)[0].replace(/\/+$/, '').toLowerCase()
  }
}

function buildModelCacheIdentity(options = {}) {
  const payload = [
    normalizeModelAlias(options.provider || options.platform || options.source || 'custom'),
    normalizeApiEndpoint(options.apiEndpoint || options.apiUrl),
    normalizeModelAlias(options.apiFormat || 'openai'),
    normalizeModelAlias(options.modelId || options.modelName)
  ].join('\u001f')
  return crypto.createHash('sha256').update(payload).digest('hex').slice(0, 24)
}

function detectModelTransition(history = [], currentIndex = history.length, current = {}) {
  const currentIdentity = String(current.identity || '').trim()
  const currentAliases = new Set((Array.isArray(current.aliases) ? current.aliases : [])
    .map(normalizeModelAlias)
    .filter(Boolean))
  const end = Math.max(0, Math.min(Number(currentIndex) || 0, history.length))

  for (let index = end - 1; index >= 0; index--) {
    const message = history[index]
    if (!message || message.role !== 'assistant' || isDeepSeekBridgeMessage(message)) continue
    const previousIdentity = String(message.modelCacheIdentity || '').trim()
    const previousAlias = normalizeModelAlias(message.modelId || message.modelName)
    if (!previousIdentity && !previousAlias) continue
    if (previousIdentity && currentIdentity) {
      return {
        detected: true,
        switched: previousIdentity !== currentIdentity,
        previousIdentity,
        previousModel: message.modelId || message.modelName || '',
        historyIndex: index
      }
    }
    return {
      detected: true,
      switched: previousAlias ? !currentAliases.has(previousAlias) : false,
      previousIdentity,
      previousModel: message.modelId || message.modelName || '',
      historyIndex: index,
      legacy: true
    }
  }

  return {
    detected: false,
    switched: false,
    previousIdentity: '',
    previousModel: '',
    historyIndex: -1
  }
}

/**
 * Build the model-visible projection of recent history.
 *
 * Persisted chat history remains untouched. Completed user turns only need the
 * user request and final assistant reply because detailed mutations are already
 * available through AI operation memos/change sessions. Interrupted or otherwise
 * unfinished turns retain their complete assistant/tool chain so a later request
 * can resume from the exact failure state.
 */
function projectCompletedTurnsForModel(history = [], options = {}) {
  if (!Array.isArray(history) || history.length === 0) {
    return {
      history: [],
      collapsedTurns: 0,
      removedMessages: 0,
      removedReasoningChars: 0,
      removedToolMessages: 0
    }
  }

  const projected = []
  let currentTurn = null
  let collapsedTurns = 0
  let removedMessages = 0
  let removedReasoningChars = 0
  let removedToolMessages = 0
  const collapseAll = options.collapseAll !== false
  const currentIdentity = String(options.currentIdentity || '').trim()
  const currentAliases = new Set((Array.isArray(options.currentAliases) ? options.currentAliases : [])
    .map(normalizeModelAlias)
    .filter(Boolean))

  function shouldCollapseTurn(messages = []) {
    if (collapseAll) return true
    const authored = [...messages].reverse().find(message => (
      message?.role === 'assistant' && (message.modelCacheIdentity || message.modelId || message.modelName)
    ))
    if (!authored) return false
    const authoredIdentity = String(authored.modelCacheIdentity || '').trim()
    if (authoredIdentity && currentIdentity) return authoredIdentity !== currentIdentity
    const authoredAlias = normalizeModelAlias(authored.modelId || authored.modelName)
    return authoredAlias ? !currentAliases.has(authoredAlias) : false
  }

  function appendTurn() {
    if (!currentTurn) return
    const messages = currentTurn.messages
    const tail = messages[messages.length - 1]
    if (!isCompletedFinalAssistantMessage(tail)) {
      projected.push(...messages)
      currentTurn = null
      return
    }
    // 当前模型自己已经完成的轮次保持原始前缀；只压缩其他模型留下的完成轮。
    // 这样模型 B 的第二轮不会重新带回模型 A 的过程，也不会破坏模型 B 自己刚建立的缓存。
    if (!shouldCollapseTurn(messages)) {
      projected.push(...messages)
      currentTurn = null
      return
    }

    // 模型切换时，完成轮只交接用户需求（含执行中追加的用户注入）和最终正文。
    // 工具调用、工具结果、深度思考必须整组移除；完整历史仍保存在磁盘和聊天界面。
    const retained = messages
      .slice(0, -1)
      .filter((message, index) => index === 0 || (message?.role === 'user' && !isDeepSeekBridgeMessage(message) && !message.hidden))
    for (const message of messages) {
      if (message?.reasoning_content) removedReasoningChars += String(message.reasoning_content).length
    }
    retained.push(toCompletedFinalMessage(tail))

    collapsedTurns += 1
    removedMessages += messages.length - retained.length
    removedToolMessages += messages.filter(message => message?.role === 'tool').length - retained.filter(message => message?.role === 'tool').length
    projected.push(...retained)
    currentTurn = null
  }

  for (const message of history) {
    // 执行中的消息注入仍属于原始用户轮次，不能把它误当成新轮边界；
    // 否则原用户消息之后的工具链会被误判为“未完成”并残留在模型交接历史里。
    if (isUserTurnMessage(message) && !message.interject) {
      appendTurn()
      currentTurn = { messages: [message] }
      continue
    }
    if (currentTurn) currentTurn.messages.push(message)
    else projected.push(message)
  }
  appendTurn()

  return {
    history: projected,
    collapsedTurns,
    removedMessages,
    removedReasoningChars,
    removedToolMessages
  }
}

function buildModelSwitchHistory(history = [], currentIndex, options = {}) {
  if (!Array.isArray(history) || history.length === 0) {
    return {
      history: [],
      startIndex: 0,
      trimmedCount: 0,
      epochTokens: 0,
      coveredMessageIndex: -1,
      collapsedTurns: 0,
      removedMessages: 0,
      removedReasoningChars: 0,
      removedToolMessages: 0
    }
  }

  const safeCurrentIndex = Math.max(0, Math.min(Number(currentIndex) || 0, history.length - 1))
  let coveredMessageIndex = Number.isInteger(options.coveredMessageIndex) ? options.coveredMessageIndex : -1
  if (options.coveredMessageId) {
    const matchedIndex = history.findIndex(message => message?.messageId === options.coveredMessageId)
    if (matchedIndex >= 0) coveredMessageIndex = matchedIndex
  }
  const rawStartIndex = Math.max(0, Math.min(safeCurrentIndex, coveredMessageIndex + 1))
  const rawWindow = history.slice(rawStartIndex, safeCurrentIndex + 1).filter(isVisibleMessage)
  const projection = projectCompletedTurnsForModel(rawWindow, options.projectionOptions || options)
  const tokenBudget = Math.max(1000, Number(options.tokenBudget) || DEFAULT_HISTORY_TOKEN_BUDGET)
  let projectedHistory = projection.history
  let projectedTokens = projectedHistory.reduce((sum, message) => sum + estimateMessageTokens(message), 0)
  let projectedTrimmedCount = 0
  if (projectedTokens > tokenBudget && projectedHistory.length > 0) {
    const fallback = buildRequestHistoryWindow(projectedHistory, projectedHistory.length - 1, { tokenBudget })
    projectedHistory = fallback.history
    projectedTrimmedCount = fallback.trimmedCount
    projectedTokens = projectedHistory.reduce((sum, message) => sum + estimateMessageTokens(message), 0)
  }

  const summary = String(options.summaryBlock || '').trim()
  return {
    ...projection,
    history: summary ? [{ role: 'system', content: summary }, ...projectedHistory] : projectedHistory,
    startIndex: rawStartIndex,
    trimmedCount: rawStartIndex + projectedTrimmedCount,
    epochTokens: projectedTokens,
    coveredMessageIndex
  }
}

function buildCompressionEpochHistory(history = [], currentIndex, options = {}) {
  if (!Array.isArray(history) || history.length === 0) {
    return { history: [], startIndex: 0, trimmedCount: 0, epochTokens: 0, coveredMessageIndex: -1 }
  }
  const safeCurrentIndex = Math.max(0, Math.min(Number(currentIndex) || 0, history.length - 1))
  let coveredMessageIndex = Number.isInteger(options.coveredMessageIndex) ? options.coveredMessageIndex : -1
  if (options.coveredMessageId) {
    const matchedIndex = history.findIndex(message => message?.messageId === options.coveredMessageId)
    if (matchedIndex >= 0) coveredMessageIndex = matchedIndex
  }
  let startIndex = Math.max(0, coveredMessageIndex + 1)
  if (startIndex > safeCurrentIndex) startIndex = safeCurrentIndex
  let epochHistory = history.slice(startIndex, safeCurrentIndex + 1).filter(isVisibleMessage).map(message => ({ ...message }))
  let epochTokens = epochHistory.reduce((sum, message) => sum + estimateMessageTokens(message), 0)
  const tokenBudget = Math.max(1000, Number(options.tokenBudget) || DEFAULT_HISTORY_TOKEN_BUDGET)
  if (epochTokens > tokenBudget) {
    const fallback = buildRequestHistoryWindow(history, safeCurrentIndex, { tokenBudget })
    epochHistory = fallback.history
    startIndex = fallback.startIndex
    epochTokens = epochHistory.reduce((sum, message) => sum + estimateMessageTokens(message), 0)
  }

  const summary = String(options.summaryBlock || '').trim()
  return {
    history: summary ? [{ role: 'system', content: summary }, ...epochHistory] : epochHistory,
    startIndex,
    trimmedCount: Math.max(0, startIndex),
    epochTokens,
    coveredMessageIndex
  }
}

module.exports = {
  DEFAULT_HISTORY_TOKEN_BUDGET,
  isDeepSeekBridgeMessage,
  isVisibleMessage,
  isUserTurnMessage,
  estimateMessageTokens,
  findTokenBudgetStartIndex,
  buildRequestHistoryWindow,
  buildSummarySafeHistory,
  buildCompressionEpochHistory,
  buildModelSwitchHistory,
  isCompletedFinalAssistantMessage,
  projectCompletedTurnsForModel,
  buildModelCacheIdentity,
  detectModelTransition
}
