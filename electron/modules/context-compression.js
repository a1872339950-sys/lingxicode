const crypto = require('crypto')
const fs = require('fs')
const path = require('path')
const historySourceLinks = require('./chat-history-source-links')

const SUMMARY_FILE = 'compression-summaries.json'
const SUMMARY_PREVIOUS_FILE = 'compression-summaries.previous.json'
const DEFAULT_TRIGGER_TOKENS = 80000
const DEFAULT_RETAIN_TOKENS = 36000
const SUMMARY_SCHEMA_VERSION = 4
const LEGACY_SUMMARY_SCHEMA_VERSIONS = new Set([3])
const DEFAULT_CONTEXT_SUMMARY_ITEMS = 3
const DEFAULT_CACHE_EPOCH_SUMMARIES = 1
const SUMMARY_CACHE_TTL_MS = 5000
const summaryFileCache = new Map()

const _ensureDirCache = new Set()

// 桥接消息是系统为缓存注入的合成消息，不应被当成真实历史内容。
function isBridgeMessage(message) {
  return Boolean(message && (message._deepseekBridge || message.deepseekBridge))
}
async function ensureDir(dirPath) {
  if (!dirPath) return
  if (_ensureDirCache.has(dirPath)) return
  await fs.promises.mkdir(dirPath, { recursive: true })
  _ensureDirCache.add(dirPath)
}

async function getSummaryFilePath(instance) {
  const storagePath = instance?.contextStoragePath || instance?.storagePath
  if (!storagePath) throw new Error('missing storagePath')
  await ensureDir(storagePath)
  return path.join(storagePath, SUMMARY_FILE)
}

async function getSummaryPreviousFilePath(instance) {
  const storagePath = instance?.contextStoragePath || instance?.storagePath
  if (!storagePath) throw new Error('missing storagePath')
  await ensureDir(storagePath)
  return path.join(storagePath, SUMMARY_PREVIOUS_FILE)
}

function cloneSummaries(summaries = []) {
  return Array.isArray(summaries) ? summaries.map(item => ({ ...item })) : []
}

function normalizeLoadedSummary(item) {
  const version = Number(item?.schemaVersion)
  if (version !== SUMMARY_SCHEMA_VERSION && !LEGACY_SUMMARY_SCHEMA_VERSIONS.has(version)) return null
  return {
    ...item,
    schemaVersion: SUMMARY_SCHEMA_VERSION,
    migratedFromSchemaVersion: version === SUMMARY_SCHEMA_VERSION ? undefined : version,
    startMessageId: String(item?.startMessageId || ''),
    endMessageId: String(item?.endMessageId || ''),
    startRoundId: String(item?.startRoundId || ''),
    endRoundId: String(item?.endRoundId || ''),
    coverageHash: String(item?.coverageHash || ''),
    turnIndex: Array.isArray(item?.turnIndex) ? item.turnIndex.map(t => ({
      turn: Number(t?.turn) || 0,
      userFirstLine: String(t?.userFirstLine || '').slice(0, 200)
    })).filter(t => t.turn > 0) : []   // 老数据没有 turnIndex，补空数组
  }
}

async function readSummaryFile(filePath) {
  const raw = await fs.promises.readFile(filePath, 'utf-8')
  const parsed = JSON.parse(raw)
  if (!Array.isArray(parsed)) throw new Error('summary file must contain an array')
  return parsed.map(normalizeLoadedSummary).filter(Boolean)
}

function getSummaryFileSignature(filePath) {
  try {
    if (!fs.existsSync(filePath)) return { exists: false, mtimeMs: 0, size: 0 }
    const stat = fs.statSync(filePath)
    return { exists: true, mtimeMs: stat.mtimeMs, size: stat.size }
  } catch {
    return { exists: false, mtimeMs: 0, size: 0 }
  }
}

function getCachedSummaries(filePath) {
  const cached = summaryFileCache.get(filePath)
  if (!cached) return null
  if (Date.now() - Number(cached.cachedAt || 0) > SUMMARY_CACHE_TTL_MS) return null
  const signature = getSummaryFileSignature(filePath)
  if (signature.exists !== cached.exists || signature.mtimeMs !== cached.mtimeMs || signature.size !== cached.size) return null
  return cloneSummaries(cached.summaries)
}

function setCachedSummaries(filePath, summaries = []) {
  const signature = getSummaryFileSignature(filePath)
  summaryFileCache.set(filePath, {
    ...signature,
    cachedAt: Date.now(),
    summaries: cloneSummaries(summaries)
  })
}

async function loadLocalSummaries(instance) {
  const filePath = await getSummaryFilePath(instance)
  try {
    const cached = getCachedSummaries(filePath)
    if (cached) {
      if (instance) instance.__compressionSummariesReadFailed = false
      return cached
    }
    if (!fs.existsSync(filePath)) {
      setCachedSummaries(filePath, [])
      return []
    }
    const summaries = await readSummaryFile(filePath)
    if (instance) instance.__compressionSummariesReadFailed = false
    setCachedSummaries(filePath, summaries)
    return cloneSummaries(summaries)
  } catch (error) {
    console.error('[ContextCompression] 加载压缩摘要失败:', error.message)
    if (instance) {
      instance.__compressionSummariesReadFailed = true
      instance.__compressionSummariesReadError = error.message
      instance.__compressionSummariesReadErrorAt = Date.now()
    }
    try {
      const fallback = await readSummaryFile(await getSummaryPreviousFilePath(instance))
      console.warn('[ContextCompression] using previous summary version after primary read failure')
      return cloneSummaries(fallback)
    } catch {
      return []
    }
  }
}

async function loadSummaries(instance, options = {}) {
  const local = await loadLocalSummaries(instance)
  if (!instance?.chatHistoryPath) return local

  const resolvedHistoryPath = path.resolve(instance.chatHistoryPath)
  const visited = new Set(options.visited || [])
  if (visited.has(resolvedHistoryPath)) return local
  visited.add(resolvedHistoryPath)

  const reference = await historySourceLinks.readReference(instance.chatHistoryPath).catch(() => null)
  if (!reference?.sourceChatHistoryPath) return local
  const sourceSummaries = await loadSummaries({
    chatHistoryPath: reference.sourceChatHistoryPath,
    contextStoragePath: path.dirname(reference.sourceChatHistoryPath)
  }, { visited: [...visited] })
  const cappedSourceSummaries = sourceSummaries
    .filter(summary => (Number(summary?.endTurn) || 0) <= Number(reference.sourceRoundCount || 0))
    .map(summary => ({
      ...summary,
      id: `source:${reference.sourceSessionId || 'session'}:${summary.id}`,
      inheritedFromSource: true,
      inheritedSourceSessionId: reference.sourceSessionId || ''
    }))
  return [...cappedSourceSummaries, ...local]
}

async function writeLocalSummaries(instance, summaries) {
  const filePath = await getSummaryFilePath(instance)
  const previousPath = await getSummaryPreviousFilePath(instance)
  await ensureDir(path.dirname(filePath))
  const normalized = Array.isArray(summaries) ? summaries : []
  const payload = JSON.stringify(normalized, null, 2)
  const tempPath = `${filePath}.tmp-${Date.now()}-${Math.random().toString(36).slice(2)}`
  const previousTempPath = `${previousPath}.tmp-${Date.now()}-${Math.random().toString(36).slice(2)}`
  let writeSucceeded = false
  try {
    if (await fs.promises.stat(filePath).then(stat => stat.isFile()).catch(() => false)) {
      await fs.promises.copyFile(filePath, previousTempPath)
      await fs.promises.rename(previousTempPath, previousPath)
    }
    await fs.promises.writeFile(tempPath, payload, 'utf-8')
    await fs.promises.rename(tempPath, filePath)
    writeSucceeded = true
  } catch (e) {
    console.error('[Compression] 异步保存摘要失败:', e.message)
    await fs.promises.unlink(tempPath).catch(() => {})
    await fs.promises.unlink(previousTempPath).catch(() => {})
  }
  if (!writeSucceeded) return false
  setCachedSummaries(filePath, normalized)
  if (instance) {
    instance.__compressionSummariesReadFailed = false
    instance.__compressionSummariesReadError = ''
  }
  return true
}

async function saveSummaries(instance, summaries) {
  const local = (Array.isArray(summaries) ? summaries : [])
    .filter(summary => !summary?.inheritedFromSource)
  await writeLocalSummaries(instance, local)
}

async function materializeInheritedSummaries(chatHistoryPath) {
  const instance = {
    chatHistoryPath,
    contextStoragePath: path.dirname(chatHistoryPath)
  }
  const summaries = await loadSummaries(instance)
  if (!summaries.some(summary => summary?.inheritedFromSource)) return 0
  const materialized = summaries.map(summary => {
    const next = { ...summary }
    delete next.inheritedFromSource
    delete next.inheritedSourceSessionId
    return next
  })
  await writeLocalSummaries(instance, materialized)
  return materialized.length
}

function getVisibleUserIndices(history = [], startIndex = 0) {
  const indices = []
  for (let index = Math.max(0, Number(startIndex) || 0); index < history.length; index++) {
    const message = history[index]
    if (message && !message.hidden && message.type !== 'compression-divider' && message.role === 'user' && !isBridgeMessage(message)) {
      indices.push(index)
    }
  }
  return indices
}

function findLatestSummary(summaries = []) {
  return (Array.isArray(summaries) ? summaries : []).reduce((latest, item) => {
    if (!latest) return item
    return (Number(item?.endTurn) || 0) >= (Number(latest?.endTurn) || 0) ? item : latest
  }, null)
}

function findNextVisibleUserIndex(history = [], startIndex = 0) {
  for (let index = Math.max(0, startIndex); index < history.length; index++) {
    const message = history[index]
    if (message && !message.hidden && message.type !== 'compression-divider' && message.role === 'user' && !isBridgeMessage(message)) return index
  }
  return history.length
}

async function getCompressionPlan(instance, history = [], options = {}) {
  const triggerTokens = Math.max(8000, Number(options.triggerTokens) || DEFAULT_TRIGGER_TOKENS)
  const retainTokens = Math.max(4000, Math.min(triggerTokens - 1000, Number(options.retainTokens) || DEFAULT_RETAIN_TOKENS))
  const existing = await loadSummaries(instance)
  if (instance?.__compressionSummariesReadFailed) {
    return {
      shouldCreate: false,
      readFailed: true,
      readError: instance.__compressionSummariesReadError || '',
      pendingTokens: 0,
      triggerTokens,
      retainTokens,
      existing,
      coveredMessageIndex: -1
    }
  }
  const latest = findLatestSummary(existing)
  let coveredMessageIndex = -1
  let cursorMatched = false
  if (latest?.endMessageId) {
    coveredMessageIndex = history.findIndex(message => message?.messageId === latest.endMessageId)
    cursorMatched = coveredMessageIndex >= 0
  }
  if (!cursorMatched && Number.isInteger(latest?.endHistoryIndex)) {
    coveredMessageIndex = Math.min(history.length - 1, Math.max(-1, latest.endHistoryIndex - 1))
  }
  const tailStartIndex = Math.max(0, coveredMessageIndex + 1)
  const messageTokens = history.map(estimateHistoryMessageTokens)
  const pendingTokens = messageTokens.slice(tailStartIndex).reduce((sum, value) => sum + value, 0)
  const completedStarts = getCompressibleUserIndices(history).filter(index => index >= tailStartIndex)
  let remainingTokens = pendingTokens
  let endHistoryIndex = -1
  for (const startIndex of completedStarts) {
    const nextUserIndex = findNextVisibleUserIndex(history, startIndex + 1)
    const segmentTokens = messageTokens.slice(startIndex, nextUserIndex).reduce((sum, value) => sum + value, 0)
    remainingTokens -= segmentTokens
    endHistoryIndex = nextUserIndex
    if (remainingTokens <= retainTokens) break
  }
  const startHistoryIndex = completedStarts.length ? completedStarts[0] : -1
  const shouldCreate = pendingTokens >= triggerTokens && startHistoryIndex >= 0 && endHistoryIndex > startHistoryIndex
  const startTurn = startHistoryIndex >= 0 ? (getVisibleTurnIdByHistoryIndex(history, startHistoryIndex) || 1) : 1
  const endTurn = endHistoryIndex > 0 ? (getVisibleTurnIdByHistoryIndex(history, endHistoryIndex - 1) || startTurn) : startTurn
  return {
    shouldCreate,
    pendingTokens,
    triggerTokens,
    retainTokens,
    remainingTokens: Math.max(0, remainingTokens),
    existing,
    startTurn,
    endTurn,
    startHistoryIndex,
    endHistoryIndex,
    coveredMessageIndex,
    cursorMatched,
    tailStartIndex
  }
}

function estimateHistoryMessageTokens(message = {}) {
  try {
    return Math.max(4, Math.ceil(JSON.stringify(message).length / 4))
  } catch {
    return Math.max(4, Math.ceil(String(message?.content || '').length / 4))
  }
}

function buildCoverageMetadata(historySlice = []) {
  const visible = historySlice.filter(message => message && !message.hidden && message.type !== 'compression-divider')
  const first = visible[0] || null
  const last = visible[visible.length - 1] || null
  const hashPayload = visible.map(message => ({
    messageId: message.messageId || '',
    roundId: message.roundId || '',
    role: message.role || '',
    content: message.content ?? '',
    toolCallId: message.tool_call_id || '',
    toolCalls: message.tool_calls || null
  }))
  return {
    startMessageId: String(first?.messageId || ''),
    endMessageId: String(last?.messageId || ''),
    startRoundId: String(first?.roundId || ''),
    endRoundId: String(last?.roundId || ''),
    coverageHash: crypto.createHash('sha256').update(JSON.stringify(hashPayload)).digest('hex')
  }
}

async function rebuildSummariesFromHistory(instance, history = [], options = {}) {
  await saveSummaries(instance, [])
  const created = await createCompressionSummary(instance, history, options)
  return created.created ? created.summaries : []
}

function parseJsonSafely(value, fallback = {}) {
  if (!value) return fallback
  try {
    return typeof value === 'string' ? JSON.parse(value) : value
  } catch {
    return fallback
  }
}

function toPlainText(content) {
  if (content == null) return ''
  if (typeof content === 'string') return content
  if (typeof content === 'number' || typeof content === 'boolean') return String(content)
  if (Array.isArray(content)) {
    return content.map(part => {
      if (part == null) return ''
      if (typeof part === 'string') return part
      if (typeof part === 'number' || typeof part === 'boolean') return String(part)
      if (typeof part !== 'object') return ''
      if (typeof part.text === 'string') return part.text
      if (typeof part.content === 'string') return part.content
      if (typeof part.input_text === 'string') return part.input_text
      if (part.image_url || part.input_image || part.type === 'image_url' || part.type === 'input_image') return '[图片]'
      if (part.file || part.file_path || part.type === 'file') return '[文件]'
      return ''
    }).filter(Boolean).join('\n')
  }
  if (typeof content === 'object') {
    if (typeof content.text === 'string') return content.text
    if (typeof content.content === 'string') return content.content
    try {
      return JSON.stringify(content)
    } catch {
      return String(content)
    }
  }
  return String(content)
}

function clipText(text, maxLength = 220) {
  const value = String(text || '').replace(/\s+/g, ' ').trim()
  if (!value) return ''
  if (value.length <= maxLength) return value
  const limited = value.slice(0, maxLength)
  const sentenceEnd = Math.max(
    limited.lastIndexOf('。'),
    limited.lastIndexOf('！'),
    limited.lastIndexOf('？'),
    limited.lastIndexOf('!'),
    limited.lastIndexOf('?')
  )
  if (sentenceEnd >= Math.floor(maxLength * 0.45)) return limited.slice(0, sentenceEnd + 1).trim()
  const clauseEnd = Math.max(
    limited.lastIndexOf('，'),
    limited.lastIndexOf('；'),
    limited.lastIndexOf(';'),
    limited.lastIndexOf(',')
  )
  if (clauseEnd >= Math.floor(maxLength * 0.55)) return `${limited.slice(0, clauseEnd).trim()}。`
  return `${limited.trim()}...`
}

function isCompletedAssistantMessage(msg) {
  if (!msg || msg.role !== 'assistant') return false
  if (msg.hidden || msg.interrupted || msg.error) return false
  if (Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0) return false
  const text = toPlainText(msg.content).trim()
  return !!text && text !== '[已中断]'
}

function isCompressibleUserTurn(history = [], userIndex = -1) {
  if (!Number.isInteger(userIndex) || userIndex < 0) return false
  const user = history[userIndex]
  if (!user || user.role !== 'user' || user.hidden || isBridgeMessage(user)) return false
  for (let index = userIndex + 1; index < history.length; index++) {
    const msg = history[index]
    if (!msg || msg.hidden || msg.type === 'compression-divider' || isBridgeMessage(msg)) continue
    if (msg.role === 'user') return false
    if (isCompletedAssistantMessage(msg)) return true
  }
  return false
}

function getCompressibleUserIndices(history = []) {
  const indices = []
  let hasCompletedAssistantInTurn = false
  for (let index = history.length - 1; index >= 0; index--) {
    const msg = history[index]
    if (!msg || msg.hidden || msg.type === 'compression-divider' || isBridgeMessage(msg)) continue
    if (msg.role === 'user') {
      if (hasCompletedAssistantInTurn) indices.push(index)
      hasCompletedAssistantInTurn = false
      continue
    }
    if (isCompletedAssistantMessage(msg)) {
      hasCompletedAssistantInTurn = true
    }
  }
  indices.reverse()
  return indices
}

function countVisibleTurns(history = []) {
  return getCompressibleUserIndices(history).length
}

function getVisibleTurnIdByHistoryIndex(history = [], historyIndex = -1) {
  if (!Number.isInteger(historyIndex) || historyIndex < 0) return null
  const indices = getCompressibleUserIndices(history)
  let turnId = 0
  for (const index of indices) {
    if (index > historyIndex) break
    turnId++
  }
  return turnId > 0 ? turnId : null
}

function getHistoryIndexByVisibleTurn(history = [], turnId = 0) {
  if (!Number.isInteger(turnId) || turnId < 1) return -1
  const indices = getCompressibleUserIndices(history)
  return indices[turnId - 1] ?? -1
}

function buildToolEvidenceLines(historySlice = []) {
  const lines = []
  const toolNameById = new Map()
  for (const msg of historySlice) {
    if (msg?.role === 'assistant' && Array.isArray(msg.tool_calls)) {
      for (const tc of msg.tool_calls) {
        if (tc?.id) toolNameById.set(tc.id, tc.function?.name || 'tool')
      }
      continue
    }
    if (msg?.role !== 'tool') continue
    const toolName = toolNameById.get(msg.tool_call_id) || 'tool'
    const result = parseJsonSafely(msg.content, {})
    const statusText = []
    if (result?.path) statusText.push(result.path)
    if (result?.command) statusText.push(result.command)
    if (result?.error) statusText.push(`错误: ${result.error}`)
    else if (result?.message) statusText.push(result.message)
    else if (typeof result?.summary === 'string') statusText.push(result.summary)
    else if (typeof result?.preview === 'string') statusText.push(result.preview)
    const line = clipText([toolName, ...statusText].filter(Boolean).join(' - '), 180)
    if (line) lines.push(line)
    if (lines.length >= 5) break
  }
  return lines
}

function normalizeStringList(value, limit = 8, maxLength = 220) {
  const source = Array.isArray(value) ? value : value ? [value] : []
  const seen = new Set()
  const result = []
  for (const item of source) {
    const text = clipText(String(item || ''), maxLength)
    if (!text || seen.has(text)) continue
    seen.add(text)
    result.push(text)
    if (result.length >= limit) break
  }
  return result
}

function normalizeWorkerSummary(value = {}) {
  const source = value && typeof value === 'object' ? value : {}
  return {
    topic: clipText(source.topic || source.theme || source.title || '', 32),
    aiDid: normalizeStringList(source.aiDid || source.ai_did || source.done || source.completed, 8),
    keyInfo: normalizeStringList(source.keyInfo || source.key_info || source.keyPoints || source.findings || source.decisions, 8),
    openItems: normalizeStringList(source.openItems || source.open_items || source.pending || source.unfinished || source.openQuestions, 6),
    // Handoff fields for the next model turn (Codex-style continuation, structured for 灵犀).
    nextActions: normalizeStringList(source.nextActions || source.next_actions || source.nextSteps || source.next_steps || source.handoff, 6),
    constraints: normalizeStringList(source.constraints || source.constraint || source.limits || source.userPreferences || source.user_preferences, 6),
    criticalPaths: normalizeStringList(source.criticalPaths || source.critical_paths || source.paths || source.keyFiles || source.key_files, 8)
  }
}

function isWeakTopicTitle(value) {
  const text = String(value || '').trim()
  if (!text) return true
  if (text.length > 32) return true
  if (/^(请|帮|需要|我想|能不能|可以|麻烦|你|你帮|继续|然后|这个|那个)/.test(text)) return true
  if (/(不要|不能|你好|你自己|看看还有没有|现在不是|不会比较好|常的正文内容)/.test(text)) return true
  if (/[？?！!。；;]/.test(text)) return true
  return false
}

function inferSummaryTitle(summaryRecord) {
  const summary = summaryRecord?.summary || {}
  const details = [
    ...(Array.isArray(summary.aiDid) ? summary.aiDid : []),
    ...(Array.isArray(summary.keyInfo) ? summary.keyInfo : [])
  ].map(item => String(item || '')).filter(Boolean)
  const combined = details.join(' ')
  const action = /审查|残余|死代码|废弃/.test(combined) ? '审查'
    : /修复|根因|错误|问题/.test(combined) ? '修复'
      : /优化|性能|卡顿|虚拟滚动/.test(combined) ? '优化'
        : /打包|安装包|构建/.test(combined) ? '构建'
          : /新增|添加|增加/.test(combined) ? '新增'
            : /修改|改动|调整|改进/.test(combined) ? '改进'
              : '整理'

  const codeTokens = [...combined.matchAll(/`([^`\r\n]{2,100})`/g)]
    .map(match => match[1].trim())
    .filter(token => /(?:\.[a-z0-9]{1,8}$|^[a-z_][a-z0-9_-]{3,}$)/i.test(token))
  if (codeTokens.length) {
    const token = codeTokens.find(item => /\.[a-z0-9]{1,8}$/i.test(item)) || codeTokens[0]
    return clipText(`${action} ${path.basename(token)}`, 32)
  }

  const semanticPatterns = [
    /历史消息(?:虚拟滚动|加载|渲染)?/,
    /上下文压缩(?:摘要|标题)?/,
    /项目残余代码|残余代码|死代码|废弃文件/,
    /工具卡片|操作摘要|侧边栏|流式输出|打字机|错误扫描|多AI协作|设置界面|模型配置|项目切换/
  ]
  for (const pattern of semanticPatterns) {
    const match = combined.match(pattern)
    if (match?.[0]) return clipText(`${action}${match[0]}`, 32)
  }
  return summaryRecord?.workerProvider === 'local-rebuild' ? '本地重建摘要' : '历史压缩摘要'
}

function pickSummaryTitle(summaryRecord) {
  const summary = summaryRecord?.summary || {}
  const candidates = [
    summary.topic,
    summary.theme,
    summary.title,
    summary.task,
    summary.outcome
  ]
  for (const candidate of candidates) {
    if (!isWeakTopicTitle(candidate)) return clipText(candidate, 32)
  }
  return inferSummaryTitle(summaryRecord)
}

function getSummarySourceMeta(summaryRecord = {}) {
  const provider = String(summaryRecord.workerProvider || '').trim()
  const workerError = String(summaryRecord.workerError || '').trim()
  if (provider === 'cloud') return { source: 'cloud', sourceLabel: '云端整理', sourceError: '' }
  if (provider === 'ollama') return { source: 'ollama', sourceLabel: '本地模型', sourceError: '' }
  if (provider === 'local-rebuild') return { source: 'local-rebuild', sourceLabel: '本地重建', sourceError: '' }
  if (workerError) return { source: 'local-fallback', sourceLabel: '云端失败后降级', sourceError: workerError }
  return { source: 'unknown', sourceLabel: '来源未知', sourceError: '' }
}

function collectFinalConversationRounds(historySlice = []) {
  const rounds = []
  let current = null

  for (const msg of historySlice) {
    if (!msg || msg.hidden || msg.type === 'compression-divider' || isBridgeMessage(msg)) continue
    if (msg.role === 'user') {
      if (current) rounds.push(current)
      current = {
        user: clipText(toPlainText(msg.content), 1200),
        aiMessages: []
      }
      continue
    }
    if (!current || msg.role !== 'assistant') continue
    if (Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0) continue
    const text = clipText(toPlainText(msg.content), 1800)
    if (text) current.aiMessages.push(text)
  }

  if (current) rounds.push(current)
  return rounds
    .map(round => ({
      user: round.user,
      ai: round.aiMessages.length ? round.aiMessages[round.aiMessages.length - 1] : ''
    }))
    .filter(round => round.user || round.ai)
}

/**
 * 构建轮次索引行（类似 git log --oneline）
 * 压缩时保留每轮的第一句用户消息，让模型一眼能看到每轮在说什么，而不只是看到压缩后的结论
 * @param {Array} historySlice 被压缩的 history 切片
 * @param {number} startTurn 本切片的起始轮次 ID（与 summary.startTurn 一致）
 * @returns {Array<{turn, userFirstLine}>} 轮次索引行列表
 */
function buildTurnIndex(historySlice = [], startTurn = 1) {
  const indices = getCompressibleUserIndices(historySlice)
  const lines = []
  for (let i = 0; i < indices.length; i++) {
    const msg = historySlice[indices[i]]
    if (!msg) continue
    const fullText = toPlainText(msg.content).replace(/\s+/g, ' ').trim()
    const firstLine = clipText(fullText, 120)           // 取首句/首行，最多 120 字
    lines.push({
      turn: startTurn + i,                               // 全局一致的 turn ID
      userFirstLine: firstLine || '(空消息)'
    })
  }
  return lines
}

function buildWorkerPrompt(rounds = [], options = {}) {
  const payload = rounds.map((round, index) => ({
    turn: index + 1,
    user: round.user,
    ai_final_reply: round.ai
  }))
  return [
    '你是上下文压缩整理员，负责生成“交接摘要（handoff）”，供后续同一会话的 AI 接续工作。',
    '只根据用户消息和 AI 最终正文回复做摘要，不要分析工具调用，不要复盘工具流水账。',
    '目标：让后续 AI 在看不到旧原文时仍能接上：主题、已做事项、关键事实、未完成项，以及明确的下一步、约束与关键路径。',
    '只输出 JSON，不要 Markdown。',
    'JSON 字段固定：',
    '{',
    '  "topic": "短主题标题，6-14 个中文字符，像备忘录标题；不要照抄用户原话，不要问句，不要带请/帮我/需要/继续/这个/那个，不要超过 18 个汉字",',
    '  "aiDid": ["AI实际说明/交付/修改/决策了什么，提取关键内容"],',
    '  "keyInfo": ["后续继续任务需要知道的关键事实、结论、模型/方案说明"],',
    '  "openItems": ["还没完成、待确认、用户明确不满意或要后续处理的点"],',
    '  "nextActions": ["给下一任 AI 的明确下一步，按优先级 1-3 条；可执行、可验证，不要空话"],',
    '  "constraints": ["用户偏好、硬约束、禁止事项、授权边界、必须保留的行为"],',
    '  "criticalPaths": ["关键文件/目录/入口路径，尽量具体，例如 electron/modules/foo.js"]',
    '}',
    '要求：',
    '- topic 必须概括任务对象和动作，例如“修复历史消息标题”“优化任务日志清理”“排查窗口短暂卡顿”；不要编造；如果只是闲聊也要简短说明；每项短句，最多 8 条。',
    '- nextActions 必须像交接清单：优先未完成目标与验证；没有明确下一步时写“按用户最新消息继续”，不要编造新需求。',
    '- constraints / criticalPaths 没有依据时用空数组 []，不要填“无”之类占位。',
    '',
    `压缩范围：第 ${options.startTurn || '?'}-${options.endTurn || '?'} 轮`,
    JSON.stringify(payload, null, 2)
  ].join('\n')
}

function hasConcreteTaskSignal(historySlice = []) {
  return historySlice.some(msg => {
    const text = toPlainText(msg?.content)
    if (msg?.role === 'tool') return true
    if (msg?.role === 'assistant' && Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0) return true
    if (msg?.role !== 'user') return false
    return /修复|优化|实现|新增|删除|检查|审查|运行|测试|报错|bug|代码|文件|项目|页面|接口|模型|配置|终端|Blender|图片|截图|文生图|agent/i.test(text)
  })
}

const TOPIC_ACTION_PATTERNS = [
  { re: /(?:请|帮|需要|想)?\s*[帮把]?\s*(修复|排查|解决|处理)\s*(了|一下|这个|那个)?/i, action: '修复' },
  { re: /(?:请|帮|需要|想)?\s*[帮把]?\s*(实现|完成|做|开发|编写|写)\s*(了|一下|一个|这个|那个)?/i, action: '实现' },
  { re: /(?:请|帮|需要|想)?\s*[帮把]?\s*(添加|新增|增加|创建|新建|生成)\s*(了|一下|一个|这个|那个)?/i, action: '新增' },
  { re: /(?:请|帮|需要|想)?\s*[帮把]?\s*(删除|移除|清理|去掉|废弃)\s*(了|一下|这个|那个)?/i, action: '删除' },
  { re: /(?:请|帮|需要|想)?\s*[帮把]?\s*(检查|查看|审查|确认|验证|运行|测试|试下|试下看)\s*(了|一下|这个|那个)?/i, action: '检查' },
  { re: /(?:请|帮|需要|想)?\s*[帮把]?\s*(配置|设置|调整|修改|更新|升级|改成|改为|优化|重构)\s*(了|一下|这个|那个)?/i, action: '配置' },
  { re: /(?:请|帮|需要|想)?\s*[帮把]?\s*(打包|构建|编译|发布|部署|导出|安装)\s*(了|一下|这个|那个)?/i, action: '打包' },
  { re: /(?:请|帮|需要|想)?\s*[帮把]?\s*(继续|接着|继续完成|继续处理|继续实现)\s*(这个|那个)?/i, action: '继续' }
]

const TOPIC_OBJECT_PATTERNS = [
  /[“"']([^"']{2,30}?)["'"]/,
  /([\w\-.\/\\]+\.(?:js|ts|jsx|tsx|py|html|css|scss|json|md|txt|exe|ico|png|jpg|svg|blend|glb|gltf))/i,
  /([\u4e00-\u9fa5]{2,8}(?:模块|组件|页面|功能|接口|服务|路由|类|函数|脚本|配置|依赖|目录|项目|窗口|数据库|表|字段|代码))/g,
  /([\u4e00-\u9fa5]{2,8})/g
]

function extractObjectAfterAction(text, actionIndex) {
  const after = String(text || '').slice(actionIndex, actionIndex + 80)
  for (const pattern of TOPIC_OBJECT_PATTERNS) {
    const match = after.match(pattern)
    if (match && match[1]) {
      const candidate = match[1].trim()
      if (candidate.length >= 2 && !/^这个|那个|一下|一个|什么|怎么|为什么|请|帮|需要|想$/i.test(candidate)) {
        return candidate
      }
    }
  }
  return ''
}

function stripNoiseForTopic(text) {
  return String(text || '')
    .replace(/^\s*@(?:skill:\/\/)?[a-zA-Z0-9_-]+\s*/g, '')
    .replace(/^\s*(?:请你?|帮我?|请帮我?|需要|想|能不能|可以|麻烦)\s*[把让帮]?\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function extractTopicFromRounds(rounds = [], hasTaskSignal = false, options = {}) {
  const userTexts = rounds.map(round => stripNoiseForTopic(round.user)).filter(Boolean)
  const aiTexts = rounds.map(round => String(round.ai || '')).filter(Boolean)
  const allUserText = userTexts.join(' ')

  let bestAction = ''
  let bestObject = ''
  let bestScore = 0

  for (const { re, action } of TOPIC_ACTION_PATTERNS) {
    const match = allUserText.match(re)
    if (match && match.index != null) {
      const obj = extractObjectAfterAction(allUserText, match.index + match[0].length)
      const score = 10 + (obj ? 8 : 0) + (action === '继续' ? -2 : 0)
      if (score > bestScore) {
        bestAction = action
        bestObject = obj
        bestScore = score
      }
    }
  }

  if (!bestAction && userTexts.length) {
    const firstUser = userTexts[0]
    if (/^继续\s*[。.!！]?\s*$/i.test(firstUser)) {
      bestAction = '继续'
    } else if (/^打包\s*[。.!！]?\s*$/i.test(firstUser)) {
      bestAction = '打包'
    }
  }

  if (!bestObject && bestAction) {
    for (const pattern of TOPIC_OBJECT_PATTERNS) {
      const match = allUserText.match(pattern)
      if (match && match[1]) {
        const candidate = match[1].trim()
        if (candidate.length >= 2 && !/^这个|那个|一下|一个$/i.test(candidate)) {
          bestObject = candidate
          break
        }
      }
    }
  }

  if (!bestObject && aiTexts.length) {
    const donePatterns = [/完成([^，。；.!?！？]{2,20})/, /修复([^，。；.!?！？]{2,20})/, /新增([^，。；.!?！？]{2,20})/, /实现([^，。；.!?！？]{2,20})/, /配置([^，。；.!?！？]{2,20})/, /打包([^，。；.!?！？]{2,20})/]
    for (const text of aiTexts) {
      for (const pattern of donePatterns) {
        const match = text.match(pattern)
        if (match && match[1]) {
          bestObject = match[1].trim()
          if (!bestAction) bestAction = '完成'
          break
        }
      }
      if (bestObject) break
    }
  }

  if (bestAction) {
    if (bestObject) {
      const topic = clipText(`${bestAction}${bestObject}`, 24)
      if (topic.length >= 4) return topic
    }
    const shortUser = clipText(allUserText.replace(/[。！？.!?]\s*/g, '；'), 22)
    return clipText(`${bestAction}：${shortUser}`, 24)
  }

  if (options.userRequest) {
    const request = stripNoiseForTopic(options.userRequest)
    if (request) return clipText(`处理${request.replace(/[？?！!。；;].*$/, '')}`, 24)
  }

  return hasTaskSignal ? '围绕项目任务进行处理。' : '普通聊天或状态确认。'
}

function extractHighSignalLines(text, patterns, maxItems = 4) {
  const clean = String(text || '').replace(/\r/g, '')
  const lines = clean
    .split(/\n+/)
    .map(line => line.replace(/^[-*#\s>]+/, '').trim())
    .filter(Boolean)
  const picked = []
  for (const line of lines) {
    if (line.length < 8) continue
    if (!patterns.some(pattern => pattern.test(line))) continue
    if (/随时待命|有什么需要帮忙|直接说需求|不想说|你好|哈哈|谢谢|挺好的/.test(line)) continue
    picked.push(clipText(line, 180))
    if (picked.length >= maxItems) break
  }
  return picked
}

function extractCriticalPathsFromText(text = '', maxItems = 6) {
  const source = String(text || '')
  const hits = []
  const patterns = [
    /(?:[A-Za-z]:)?[\\/]?(?:[\w.-]+[\\/]){1,8}[\w.-]+\.(?:js|ts|tsx|jsx|mjs|cjs|py|json|md|css|html|vue|rs|go|java|toml|yml|yaml)\b/g,
    /\b(?:electron|frontend|scripts|services|skills|docs|src|lib|app|modules)(?:[\\/][\w.-]+){1,6}\b/g
  ]
  for (const re of patterns) {
    let match
    while ((match = re.exec(source)) && hits.length < maxItems * 2) {
      const token = String(match[0] || '').replace(/[，。；;,]+$/, '').trim()
      if (token.length >= 6) hits.push(clipText(token, 120))
    }
  }
  return [...new Set(hits)].slice(0, maxItems)
}

function buildCompressionSummary(historySlice = [], options = {}) {
  const rounds = collectFinalConversationRounds(historySlice)
  const done = []
  const keyInfo = []
  const pending = []
  const constraints = []
  const criticalPaths = []
  const hasTaskSignal = hasConcreteTaskSignal(historySlice)

  for (const round of rounds) {
    if (round.user) {
      constraints.push(...extractHighSignalLines(round.user, [/不要|禁止|必须|只能|别|不要改|保持|优先|记住|约定/], 2))
      criticalPaths.push(...extractCriticalPathsFromText(round.user, 3))
    }
    if (round.ai) {
      done.push(...extractHighSignalLines(round.ai, [/完成/, /已/, /修复/, /新增/, /实现/, /配置/, /改成/, /改为/, /支持/, /验证/, /检查/, /发现/, /原因/, /结论/], 3))
      keyInfo.push(...extractHighSignalLines(round.ai, [/文件/, /路径/, /模型/, /配置/, /接口/, /规则/, /方案/, /限制/, /原因/, /问题/, /风险/, /结论/], 3))
      pending.push(...extractHighSignalLines(round.ai, [/未完成/, /待确认/, /待验证/, /还需要/, /后续/, /没做/, /不能/, /限制/, /风险/], 2))
      constraints.push(...extractHighSignalLines(round.ai, [/不要|禁止|必须|只能|用户要求|约定|边界|授权/], 2))
      criticalPaths.push(...extractCriticalPathsFromText(round.ai, 4))
    }
  }

  const unique = list => [...new Set(list.filter(Boolean))].slice(0, 6)
  const completedItems = unique(done)
  const keyItems = unique(keyInfo)
  const pendingItems = unique(pending)
  const constraintItems = unique(constraints)
  const pathItems = unique(criticalPaths)
  const topic = extractTopicFromRounds(rounds, hasTaskSignal, options)

  const fallbackDone = hasTaskSignal
    ? (options.userRequest
        ? [`围绕“${clipText(options.userRequest, 80)}”完成了一段处理。`]
        : ['完成了一段处理。'])
    : ['这 8 轮主要是闲聊或状态确认，没有执行具体项目操作。']

  const lastUser = [...rounds].reverse().find(round => round.user)?.user || options.userRequest || ''
  const nextActions = pendingItems.length
    ? pendingItems.slice(0, 3)
    : (hasTaskSignal && lastUser
        ? [`按用户最新目标继续：${clipText(lastUser, 100)}`]
        : ['按用户最新消息继续'])

  return {
    topic,
    aiDid: completedItems.length ? completedItems : fallbackDone,
    keyInfo: keyItems.length ? keyItems : (hasTaskSignal ? ['暂无新的关键事实。'] : ['未形成具体项目上下文。']),
    openItems: pendingItems.length ? pendingItems : ['暂无明确未完成项。'],
    nextActions,
    constraints: constraintItems,
    criticalPaths: pathItems
  }
}

function formatSummaryText(summary = {}) {
  const topic = summary.topic || '未命名主题'
  const aiDid = Array.isArray(summary.aiDid) && summary.aiDid.length ? summary.aiDid : ['完成了一段处理。']
  const keyInfo = Array.isArray(summary.keyInfo) && summary.keyInfo.length ? summary.keyInfo : ['暂无新的关键事实。']
  const openItems = Array.isArray(summary.openItems) && summary.openItems.length ? summary.openItems : ['暂无明确未完成项。']
  const nextActions = Array.isArray(summary.nextActions) ? summary.nextActions.filter(Boolean) : []
  const constraints = Array.isArray(summary.constraints) ? summary.constraints.filter(Boolean) : []
  const criticalPaths = Array.isArray(summary.criticalPaths) ? summary.criticalPaths.filter(Boolean) : []
  const lines = [
    `主题：${topic}`,
    '',
    'AI做了什么：',
    ...aiDid.map(item => `- ${item}`),
    '',
    '关键信息：',
    ...keyInfo.map(item => `- ${item}`),
    '',
    '未完成/待确认：',
    ...openItems.map(item => `- ${item}`)
  ]
  if (nextActions.length) {
    lines.push('', '下一步交接：', ...nextActions.map(item => `- ${item}`))
  }
  if (constraints.length) {
    lines.push('', '约束/偏好：', ...constraints.map(item => `- ${item}`))
  }
  if (criticalPaths.length) {
    lines.push('', '关键路径：', ...criticalPaths.map(item => `- ${item}`))
  }
  return lines.join('\n')
}

async function createCompressionSummary(instance, history = [], options = {}) {
  const plan = await getCompressionPlan(instance, history, options)
  const { existing, startTurn, endTurn } = plan
  if (!plan.shouldCreate) {
    return {
      created: false,
      summaries: existing,
      coveredMessageIndex: plan.coveredMessageIndex,
      pendingTokens: plan.pendingTokens
    }
  }

  const startHistoryIndex = Number.isInteger(plan.startHistoryIndex) && plan.startHistoryIndex >= 0
    ? plan.startHistoryIndex
    : getHistoryIndexByVisibleTurn(history, startTurn)
  const endHistoryIndexExclusive = Number.isInteger(plan.endHistoryIndex) && plan.endHistoryIndex >= 0
    ? plan.endHistoryIndex
    : (() => {
        const nextHistoryIndex = getHistoryIndexByVisibleTurn(history, endTurn + 1)
        return nextHistoryIndex >= 0 ? nextHistoryIndex : history.length
      })()
  const slice = history.slice(Math.max(0, startHistoryIndex), Math.max(Math.max(0, startHistoryIndex), endHistoryIndexExclusive))
  if (slice.length === 0) {
    return { created: false, summaries: existing, coveredMessageIndex: plan.coveredMessageIndex, pendingTokens: plan.pendingTokens }
  }

  const id = `summary-${String(existing.length + 1).padStart(4, '0')}`
  let summary = null
  let workerProvider = ''
  let workerError = ''
  if (typeof options.summarizeWithWorker === 'function') {
    try {
      const rounds = collectFinalConversationRounds(slice)
      const workerResult = await options.summarizeWithWorker({
        prompt: buildWorkerPrompt(rounds, { startTurn, endTurn }),
        rounds,
        startTurn,
        endTurn
      })
      if (workerResult?.success) {
        summary = normalizeWorkerSummary(workerResult.data || workerResult.facts || {})
        workerProvider = workerResult.provider || ''
      } else {
        workerError = workerResult?.error || ''
      }
    } catch (error) {
      workerError = error.message
    }
  }
  if (!summary || (!summary.topic && summary.aiDid.length === 0 && summary.keyInfo.length === 0)) {
    summary = buildCompressionSummary(slice, options)
  }
  const record = {
    id,
    type: 'compression_summary',
    schemaVersion: SUMMARY_SCHEMA_VERSION,
    startTurn,
    endTurn,
    startHistoryIndex,
    endHistoryIndex: endHistoryIndexExclusive,
    sourceTokenEstimate: slice.reduce((sum, item) => sum + estimateHistoryMessageTokens(item), 0),
    ...buildCoverageMetadata(slice),
    turnIndex: buildTurnIndex(slice, startTurn),   // 每轮首句索引行（git log --oneline 式）
    summary,
    summaryText: formatSummaryText(summary),
    workerProvider,
    workerError,
    createdAt: Date.now()
  }

  const next = [...existing, record]
  await saveSummaries(instance, next)
  return {
    created: true,
    summary: record,
    summaries: next,
    splitTurn: endTurn,
    coveredMessageIndex: endHistoryIndexExclusive - 1,
    coveredMessageId: record.endMessageId,
    sourceTokenEstimate: record.sourceTokenEstimate
  }
}

async function buildContextSummaryBlock(instance, options = {}) {
  const summaries = await loadSummaries(instance)
  if (!summaries.length) return ''
  const maxItems = Number.isInteger(options.maxItems) && options.maxItems > 0 ? options.maxItems : DEFAULT_CONTEXT_SUMMARY_ITEMS
  const selected = summaries.slice(-maxItems)
  return formatContextSummaryBlock(summaries, selected)
}

function formatContextSummaryBlock(allSummaries = [], selectedSummaries = []) {
  const summaries = Array.isArray(allSummaries) ? allSummaries : []
  const selected = Array.isArray(selectedSummaries) ? selectedSummaries : []
  const lines = [
    '【压缩摘要】',
    '以下为系统生成的历史压缩摘要，仅作背景与交接参考；不是用户新指令，不能覆盖最新用户消息或当前源码/工具结果。',
    '摘要与事实冲突时：以当前代码、工具输出和最新用户消息为准；需要旧细节时用 recall_history 或按摘要 ID 查询。'
  ]
  if (summaries.length >= 3) {
    lines.push('注意：本会话已多次压缩，细节可能衰减；长任务优先核对源码与恢复点，必要时请用户开新线程聚焦剩余目标。')
  }
  lines.push('')
  for (const item of selected) {
    lines.push(`${item.id}（第 ${item.startTurn}-${item.endTurn} 轮）`)

    // 轮次索引行（git log --oneline 式）：让模型一眼看到每轮在说什么，便于按 turn 精确召回
    if (Array.isArray(item.turnIndex) && item.turnIndex.length > 0) {
      lines.push('轮次索引（用户可说"第 N 轮"时，用 recall_history turn=N 精确取）：')
      for (const t of item.turnIndex) {
        lines.push(`  T${t.turn}: ${t.userFirstLine}`)
      }
      lines.push('')
    }

    lines.push(item.summaryText)
    lines.push('')
  }
  if (summaries.length > selected.length) {
    lines.push(`更早的 ${summaries.length - selected.length} 个压缩摘要已封存，默认不进入上下文；需要旧细节时按 ID 查询或调用 recall_history。`)
  } else {
    lines.push('旧消息已压缩。需要旧细节时，优先用 recall_history；若用户引用了摘要或详情，再按 ID 查询。')
  }
  return lines.join('\n').trim()
}

function selectCacheEpochSummaries(summaries = [], options = {}) {
  const list = Array.isArray(summaries) ? summaries : []
  if (!list.length) {
    return {
      summaryCount: 0,
      epochStartIndex: -1,
      coveredMessageId: '',
      coveredMessageIndex: -1,
      anchorSummary: null,
      eligibleSummaries: [],
      selectedSummaries: []
    }
  }
  const summariesPerEpoch = Math.max(1, Number(options.summariesPerEpoch) || DEFAULT_CACHE_EPOCH_SUMMARIES)
  const maxItems = Math.max(1, Number(options.maxItems) || DEFAULT_CONTEXT_SUMMARY_ITEMS)
  const epochStartIndex = Math.floor((list.length - 1) / summariesPerEpoch) * summariesPerEpoch
  const anchorSummary = list[epochStartIndex]
  const eligibleSummaries = list.slice(0, epochStartIndex + 1)
  return {
    summaryCount: list.length,
    summariesPerEpoch,
    epochStartIndex,
    coveredMessageId: String(anchorSummary?.endMessageId || ''),
    coveredMessageIndex: Number.isInteger(anchorSummary?.endHistoryIndex) ? anchorSummary.endHistoryIndex - 1 : -1,
    anchorSummary,
    eligibleSummaries,
    selectedSummaries: eligibleSummaries.slice(-maxItems)
  }
}

async function buildCacheEpochContext(instance, options = {}) {
  const summaries = await loadSummaries(instance)
  const selected = selectCacheEpochSummaries(summaries, options)
  return {
    ...selected,
    summaryBlock: selected.selectedSummaries.length
      ? formatContextSummaryBlock(selected.eligibleSummaries, selected.selectedSummaries)
      : ''
  }
}

function buildUiSummaryText(summaryRecord) {
  if (!summaryRecord) return ''
  return [
    `以上 ${Math.max(1, (summaryRecord.endTurn || 0) - (summaryRecord.startTurn || 1) + 1)}轮对话已自动压缩为摘要`,
    '完整聊天记录仍保留在当前窗口；AI 后续会通过摘要和记忆查询继续工作。'
  ].join('\n')
}

function buildCompressionDividerMessage(summaryRecord) {
  if (!summaryRecord) return null
  return {
    role: 'system',
    type: 'compression-divider',
    hidden: true,
    compressionSummaryId: summaryRecord.id,
    startTurn: summaryRecord.startTurn,
    endTurn: summaryRecord.endTurn,
    content: buildUiSummaryText(summaryRecord),
    summaryText: summaryRecord.summaryText,
    createdAt: summaryRecord.createdAt
  }
}

function ensureDividerInHistory(history = [], summaryRecord) {
  if (!summaryRecord) return history
  const exists = history.some(item => item?.type === 'compression-divider' && item?.compressionSummaryId === summaryRecord.id)
  if (exists) return history
  const divider = buildCompressionDividerMessage(summaryRecord)
  const insertIndex = Number.isInteger(summaryRecord.endHistoryIndex) ? summaryRecord.endHistoryIndex : history.length
  const next = history.slice()
  next.splice(Math.max(0, Math.min(insertIndex, next.length)), 0, divider)
  return next
}

function removeTransientDividerMessages(history = []) {
  return history.filter(item => item?.type !== 'compression-divider')
}

async function getSummaryReference(instance, summaryId) {
  const summaries = await loadSummaries(instance)
  return summaries.find(item => item.id === summaryId) || null
}

async function clearSummaries(instance) {
  await saveSummaries(instance, [])
}

async function getUiCompressionStack(instance, history = [], options = {}) {
  const triggerTokens = Math.max(8000, Number(options.triggerTokens) || DEFAULT_TRIGGER_TOKENS)
  const retainTokens = Math.max(4000, Number(options.retainTokens) || DEFAULT_RETAIN_TOKENS)
  const injectedSummaryItems = Math.max(0, Number.isInteger(options.contextSummaryItems) && options.contextSummaryItems > 0
    ? options.contextSummaryItems
    : DEFAULT_CONTEXT_SUMMARY_ITEMS)
  const turnCount = countVisibleTurns(history)
  const summaries = (await loadSummaries(instance)).sort((a, b) => (Number(a.startTurn) || 0) - (Number(b.startTurn) || 0))
  const layers = []
  const palette = ['#64748b', '#3b82f6', '#14b8a6', '#22c55e', '#f59e0b', '#ef4444']
  let coveredRangeEnd = 0

  summaries.forEach((summary, index) => {
    const startTurn = Number(summary.startTurn) || 0
    const endTurn = Number(summary.endTurn) || startTurn
    if (endTurn > coveredRangeEnd) coveredRangeEnd = endTurn
    const sourceMeta = getSummarySourceMeta(summary)
    layers.push({
      id: summary.id || `summary-${index + 1}`,
      kind: 'summary',
      color: palette[index % palette.length],
      startTurn,
      endTurn,
      title: pickSummaryTitle(summary),
      ...sourceMeta,
      tokenEstimate: Math.max(0, Math.round((summary.summaryText || '').length / 1.8)),
      createdAt: summary.createdAt || null
    })
  })

  const recentStartTurn = Math.max(1, coveredRangeEnd + 1)
  if (turnCount >= recentStartTurn) {
    layers.push({
      id: 'recent-original',
      kind: 'recent',
      color: '#f97316',
      startTurn: recentStartTurn,
      endTurn: turnCount,
      title: '最近保留原文',
      tokenEstimate: null,
      active: true
    })
  }

  const plan = await getCompressionPlan(instance, history, { triggerTokens, retainTokens })
  const pendingTokens = Math.max(0, Number(plan.pendingTokens) || 0)
  if (pendingTokens > 0) {
    const pendingTitle = pendingTokens >= triggerTokens
      ? `已达到整理线（约 ${Math.round(pendingTokens / 1000)}K Token）`
      : `当前约 ${Math.round(pendingTokens / 1000)}K / ${Math.round(triggerTokens / 1000)}K Token`
    layers.push({
      id: 'pending-buffer',
      kind: 'pending',
      color: '#a78bfa',
      startTurn: Math.max(1, coveredRangeEnd + 1),
      endTurn: turnCount,
      title: pendingTitle,
      tokenEstimate: pendingTokens
    })
  }

  return {
    success: true,
    turnCount,
    coveredRangeEnd,
    triggerTokens,
    retainTokens,
    pendingTokens,
    injectedSummaryItems,
    sealedSummaryCount: Math.max(0, summaries.length - injectedSummaryItems),
    summaryCount: summaries.length,
    layers,
    readFailed: !!instance?.__compressionSummariesReadFailed,
    readError: instance?.__compressionSummariesReadError || ''
  }
}

module.exports = {
  DEFAULT_TRIGGER_TOKENS,
  DEFAULT_RETAIN_TOKENS,
  DEFAULT_CONTEXT_SUMMARY_ITEMS,
  DEFAULT_CACHE_EPOCH_SUMMARIES,
  SUMMARY_SCHEMA_VERSION,
  loadSummaries,
  saveSummaries,
  materializeInheritedSummaries,
  getCompressionPlan,
  rebuildSummariesFromHistory,
  createCompressionSummary,
  buildCompressionSummary,
  buildContextSummaryBlock,
  selectCacheEpochSummaries,
  buildCacheEpochContext,
  buildUiSummaryText,
  buildCompressionDividerMessage,
  ensureDividerInHistory,
  removeTransientDividerMessages,
  getSummaryReference,
  getUiCompressionStack,
  getVisibleTurnIdByHistoryIndex,
  clearSummaries,
  toPlainText
}
