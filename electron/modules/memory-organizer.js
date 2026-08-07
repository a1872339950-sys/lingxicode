const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const storageConfig = require('./storage-config')
const workerModel = require('./worker-model')

const MEMORY_FILE = 'organized-memory.json'
const MEMORY_MD_FILE = 'organized-memory.md'
const VERSION = 2
const MEMORY_KEYS = ['preferences', 'rules', 'projectFacts', 'userProfile', 'openLoops', 'ignore']
const ACTIVE_MEMORY_KEYS = ['preferences', 'rules', 'projectFacts', 'userProfile', 'openLoops']
const MAX_ENTRIES = 240
const TYPE_TITLES = {
  preferences: '用户稳定偏好',
  rules: '长期规则/约束',
  projectFacts: '项目事实',
  userProfile: '用户画像',
  openLoops: '未完成/持续关注',
  ignore: '忽略项'
}

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true })
}

function getPaths(instance) {
  const storagePath = instance?.storagePath || instance?.contextManager?.storagePath
  if (!storagePath) throw new Error('missing storagePath')
  ensureDir(storagePath)
  return {
    json: path.join(storagePath, MEMORY_FILE),
    markdown: path.join(storagePath, MEMORY_MD_FILE)
  }
}

function readJson(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return fallback
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'))
  } catch {
    return fallback
  }
}

function normalizeList(value, limit = 80) {
  const list = Array.isArray(value) ? value : value ? [value] : []
  const seen = new Set()
  const result = []
  for (const item of list) {
    const text = String(item || '').replace(/\s+/g, ' ').trim()
    if (!text || seen.has(text)) continue
    seen.add(text)
    result.push(text.length > 220 ? `${text.slice(0, 217).trim()}...` : text)
    if (result.length >= limit) break
  }
  return result
}

function shortHash(text = '') {
  return crypto.createHash('sha1').update(String(text || '')).digest('hex').slice(0, 12)
}

function compactText(value = '', max = 260) {
  const text = String(value || '').replace(/\s+/g, ' ').trim()
  if (text.length <= max) return text
  return `${text.slice(0, max - 3).trim()}...`
}

function extractKeywords(text = '', limit = 80) {
  const tokens = []
  const matches = String(text || '').toLowerCase().match(/[\u4e00-\u9fff]{2,}|[a-z0-9_$.-]{2,}/g) || []
  for (const raw of matches) {
    const token = raw.trim()
    if (!token || /^\d+$/.test(token)) continue
    tokens.push(token)
    if (/[\u4e00-\u9fff]/.test(token)) {
      const chars = [...token]
      for (const size of [2, 3, 4]) {
        for (let i = 0; i <= chars.length - size; i += 1) tokens.push(chars.slice(i, i + size).join(''))
      }
    }
    if (tokens.length >= limit * 3) break
  }
  return [...new Set(tokens)].slice(0, limit)
}

function createMemoryEntry(type, content, extra = {}) {
  const normalizedType = MEMORY_KEYS.includes(type) ? type : 'projectFacts'
  const text = compactText(content, 260)
  if (!text) return null
  const now = Date.now()
  const id = extra.id || `mem_${normalizedType}_${shortHash(`${normalizedType}\n${text}`)}`
  return {
    id,
    type: normalizedType,
    title: compactText(extra.title || text, 64),
    content: text,
    keywords: normalizeList([...(extra.keywords || []), ...extractKeywords(text, 40)], 60),
    source: extra.source || 'organizer',
    confidence: Math.max(0, Math.min(1, Number(extra.confidence || 0.72))),
    status: extra.status || 'active',
    createdAt: Number(extra.createdAt) || now,
    updatedAt: Number(extra.updatedAt) || now,
    lastUsedAt: Number(extra.lastUsedAt) || 0,
    useCount: Number(extra.useCount) || 0
  }
}

function normalizeEntry(entry = {}) {
  if (!entry || typeof entry !== 'object') return null
  return createMemoryEntry(entry.type, entry.content || entry.text || entry.title, entry)
}

function entriesFromLists(memory = {}) {
  const entries = []
  for (const key of MEMORY_KEYS) {
    for (const item of normalizeList(memory[key])) {
      const entry = createMemoryEntry(key, item, {
        source: 'legacy-list',
        createdAt: Number(memory.updatedAt) || Date.now(),
        updatedAt: Number(memory.updatedAt) || Date.now()
      })
      if (entry) entries.push(entry)
    }
  }
  return entries
}

function mergeEntries(entries = [], limit = MAX_ENTRIES) {
  const byId = new Map()
  for (const raw of entries) {
    const entry = normalizeEntry(raw)
    if (!entry) continue
    const existing = byId.get(entry.id)
    if (!existing) {
      byId.set(entry.id, entry)
      continue
    }
    byId.set(entry.id, {
      ...existing,
      ...entry,
      keywords: normalizeList([...(existing.keywords || []), ...(entry.keywords || [])], 80),
      createdAt: Math.min(Number(existing.createdAt) || Date.now(), Number(entry.createdAt) || Date.now()),
      updatedAt: Math.max(Number(existing.updatedAt) || 0, Number(entry.updatedAt) || 0),
      lastUsedAt: Math.max(Number(existing.lastUsedAt) || 0, Number(entry.lastUsedAt) || 0),
      useCount: Math.max(Number(existing.useCount) || 0, Number(entry.useCount) || 0)
    })
  }
  return [...byId.values()]
    .sort((a, b) =>
      Number(b.lastUsedAt || 0) - Number(a.lastUsedAt || 0) ||
      Number(b.updatedAt || 0) - Number(a.updatedAt || 0) ||
      Number(b.confidence || 0) - Number(a.confidence || 0)
    )
    .slice(0, limit)
}

function normalizeMemory(memory = {}) {
  const entries = mergeEntries([
    ...(Array.isArray(memory.entries) ? memory.entries : []),
    ...entriesFromLists(memory)
  ])
  return {
    version: VERSION,
    updatedAt: Number(memory.updatedAt) || Date.now(),
    lastTurnId: Number(memory.lastTurnId) || 0,
    preferences: normalizeList(memory.preferences),
    rules: normalizeList(memory.rules),
    projectFacts: normalizeList(memory.projectFacts),
    userProfile: normalizeList(memory.userProfile),
    openLoops: normalizeList(memory.openLoops),
    ignore: normalizeList(memory.ignore),
    entries,
    sourceStats: memory.sourceStats && typeof memory.sourceStats === 'object' ? memory.sourceStats : {}
  }
}

// 进程内缓存：避免每次 load 都走同步文件 I/O 阻塞主进程事件循环
// 按 storagePath 隔离，防止切换项目时 A 项目的记忆被 B 项目命中（串项目根因）
const _memoryCache = new Map() // key: storagePath -> { data, time }
const MEMORY_CACHE_TTL_MS = 30000

function getCacheKey(instance) {
  const storagePath = instance?.storagePath || instance?.contextManager?.storagePath
  return storagePath || null
}

function load(instance, options = {}) {
  const now = Date.now()
  const key = getCacheKey(instance)
  if (key) {
    const cached = _memoryCache.get(key)
    if (options.forceRefresh !== true && cached && now - cached.time < MEMORY_CACHE_TTL_MS) {
      return cached.data
    }
  }
  const paths = getPaths(instance)
  const result = normalizeMemory(readJson(paths.json, { version: VERSION }))
  if (key) _memoryCache.set(key, { data: result, time: now })
  return result
}

function save(instance, memory) {
  const paths = getPaths(instance)
  const normalized = normalizeMemory({ ...memory, updatedAt: Date.now() })
  fs.writeFileSync(paths.json, JSON.stringify(normalized, null, 2), 'utf-8')
  fs.writeFileSync(paths.markdown, formatForContext(normalized, { mode: 'full' }), 'utf-8')
  // 保存后刷新对应项目的进程内缓存，避免下次 load 读到旧数据
  const key = getCacheKey(instance)
  if (key) _memoryCache.set(key, { data: normalized, time: Date.now() })
  return normalized
}

function mergeMemory(current, incoming = {}) {
  const next = normalizeMemory(current)
  const incomingEntries = []
  for (const key of MEMORY_KEYS) {
    next[key] = normalizeList([...(next[key] || []), ...(incoming[key] || [])])
    for (const item of normalizeList(incoming[key] || [])) {
      const entry = createMemoryEntry(key, item, {
        source: incoming.provider ? `worker:${incoming.provider}` : 'worker',
        updatedAt: Date.now()
      })
      if (entry) incomingEntries.push(entry)
    }
  }
  next.entries = mergeEntries([
    ...(next.entries || []),
    ...(Array.isArray(incoming.entries) ? incoming.entries : []),
    ...incomingEntries
  ])
  if (Number(incoming.lastTurnId) > next.lastTurnId) next.lastTurnId = Number(incoming.lastTurnId)
  next.sourceStats = {
    ...(next.sourceStats || {}),
    lastProvider: incoming.provider || next.sourceStats?.lastProvider || '',
    lastOrganizedAt: Date.now()
  }
  return next
}

function formatSection(title, items = []) {
  if (!items.length) return ''
  return [`### ${title}`, ...items.slice(0, 16).map(item => `- ${item}`), ''].join('\n')
}

function scoreEntry(entry = {}, queryTokens = []) {
  if (!queryTokens.length || entry.status !== 'active') return 0
  const text = [
    entry.type,
    entry.title,
    entry.content,
    ...(entry.keywords || [])
  ].join(' ').toLowerCase()
  let score = 0
  for (const token of queryTokens) {
    if (text.includes(token)) score += token.length >= 4 ? 4 : 2
  }
  if (entry.type === 'rules') score += 2
  if (entry.type === 'openLoops') score += 1
  score += Math.min(3, Number(entry.useCount || 0))
  score += Math.max(0, Math.min(2, Number(entry.confidence || 0) * 2))
  return score
}

function searchMemory(memory = {}, query = '', options = {}) {
  const normalized = normalizeMemory(memory)
  const queryTokens = extractKeywords(query, 80)
  if (!queryTokens.length) return []
  const maxItems = Number.isInteger(options.maxItems) && options.maxItems > 0 ? options.maxItems : 10
  const minScore = Number.isFinite(options.minScore) ? options.minScore : 3
  return normalized.entries
    .map(entry => ({ entry, score: scoreEntry(entry, queryTokens) }))
    .filter(hit => hit.score >= minScore && hit.entry.type !== 'ignore')
    .sort((a, b) => b.score - a.score || Number(b.entry.updatedAt || 0) - Number(a.entry.updatedAt || 0))
    .slice(0, maxItems)
}

function formatEntries(title, hits = []) {
  if (!hits.length) return ''
  return [
    `### ${title}`,
    ...hits.map(hit => {
      const entry = hit.entry || hit
      const score = hit.score != null ? ` score:${Math.round(hit.score)}` : ''
      return `- [${TYPE_TITLES[entry.type] || entry.type}${score}] ${entry.content}`
    }),
    ''
  ].join('\n')
}

function formatForContext(memory = {}, options = {}) {
  const normalized = normalizeMemory(memory)
  const query = String(options.query || '').trim()
  if (query && options.mode !== 'full') {
    const coreRules = normalized.entries
      .filter(entry => entry.status === 'active' && ['rules', 'preferences'].includes(entry.type))
      .sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0))
      .slice(0, options.maxCore || 6)
    const related = searchMemory(normalized, query, { maxItems: options.maxRelated || 10 })
      .filter(hit => !coreRules.some(entry => entry.id === hit.entry.id))
    const body = [
      formatEntries('常驻核心记忆', coreRules),
      formatEntries('按需召回记忆', related)
    ].filter(Boolean).join('\n').trim()
    if (!body) return ''
    return [
      '【长期整理记忆】',
      '以下是按本轮需求从长期整理记忆中召回的稳定信息；它不是完整聊天历史，旧原文仍需 recall_history 查询。',
      '',
      body
    ].join('\n')
  }

  const body = [
    formatSection('用户稳定偏好', normalized.preferences),
    formatSection('长期规则/约束', normalized.rules),
    formatSection('项目事实', normalized.projectFacts),
    formatSection('用户画像', normalized.userProfile),
    formatSection('未完成/持续关注', normalized.openLoops)
  ].filter(Boolean).join('\n').trim()
  if (!body) return ''
  return [
    '【长期整理记忆】',
    '以下是从历史对话中提炼的稳定信息。旧聊天原文仍需通过 recall_history 查询，不要把这里当成完整事实来源。',
    '',
    body
  ].join('\n')
}

function getRecentUnorganizedTurns(instance, limit = 4) {
  const memory = load(instance)
  const tape = instance?.contextManager?.memory?.tape || []
  const recent = tape
    .filter(turn => Number(turn?.id) > memory.lastTurnId)
    .slice(-limit)
  return { memory, turns: recent }
}

function buildPrompt(currentMemory, turns) {
  const compactTurns = turns.map(turn => ({
    id: turn.id,
    user: String(turn.user || '').slice(0, 2000),
    ai: String(turn.ai || '').slice(0, 3000),
    toolCount: Array.isArray(turn.toolCalls) ? turn.toolCalls.length : 0,
    model: turn.model || ''
  }))
  return [
    '你是长期记忆整理员。你的任务是从新对话里提取“以后还值得记住”的稳定信息。',
    '不要记录普通寒暄、临时测试、一次性报错、已经完成且不再有价值的流水账。',
    '不要覆盖原始历史，原始历史由 recall_history 查询。',
    '只输出 JSON，不要 Markdown。',
    '字段固定：preferences, rules, projectFacts, userProfile, openLoops, ignore, lastTurnId。',
    'preferences：用户长期偏好；rules：用户明确要求长期遵守的规则；projectFacts：项目长期事实；userProfile：用户工作方式/环境偏好；openLoops：还要继续关注的未完成事项；ignore：明确不该进入长期记忆的内容。',
    '',
    `当前已有整理记忆：${JSON.stringify(currentMemory)}`,
    '',
    `新对话：${JSON.stringify(compactTurns)}`
  ].join('\n')
}

async function organize(instance, options = {}) {
  const config = storageConfig.getWorkerModelConfig()
  if (config.enabled === false || config.tasks?.memory !== true) {
    return { success: false, skipped: true, reason: 'memory organizer disabled' }
  }
  const { memory, turns } = getRecentUnorganizedTurns(instance, options.limit || 4)
  if (!turns.length) return { success: false, skipped: true, reason: 'no new turns' }

  const prompt = buildPrompt(memory, turns)
  const result = await workerModel.summarizeJson({
    system: '你是长期记忆整理员。只输出 JSON。',
    prompt,
    local: config.local,
    timeoutMs: config.timeoutMs,
    cloud: config.cloud
  })
  if (!result.success) return result

  const incoming = {
    ...result.data,
    provider: result.provider,
    lastTurnId: Number(result.data?.lastTurnId) || Math.max(...turns.map(turn => Number(turn.id) || 0))
  }
  const next = mergeMemory(memory, incoming)
  save(instance, next)
  return { success: true, provider: result.provider, memory: next, addedTurnCount: turns.length }
}

function clear(instance) {
  const paths = getPaths(instance)
  if (fs.existsSync(paths.json)) fs.rmSync(paths.json, { force: true })
  if (fs.existsSync(paths.markdown)) fs.rmSync(paths.markdown, { force: true })
  // 清理对应项目的缓存条目（按 storagePath 隔离，不影响其他项目）
  const key = getCacheKey(instance)
  if (key) _memoryCache.delete(key)
}

module.exports = {
  MEMORY_FILE,
  MEMORY_MD_FILE,
  load,
  save,
  clear,
  organize,
  formatForContext,
  searchMemory,
  normalizeMemory
}
