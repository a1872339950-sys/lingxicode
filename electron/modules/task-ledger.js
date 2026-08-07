const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const storageConfig = require('./storage-config')

const LEDGER_DIR = 'summaries'
const INDEX_FILE = 'index.json'

function ensureDir(dirPath) {
  if (!dirPath) return
  if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true })
}

function safeSlug(text = '', fallback = 'summary', maxChars = 28) {
  const cleaned = String(text || '')
    .replace(/\s+/g, '-')
    .replace(/[\\/:*?"<>|#{}[\]^`]+/g, '')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, maxChars)
  return cleaned || fallback
}

function shortHash(text = '') {
  return crypto.createHash('sha1').update(String(text || '')).digest('hex').slice(0, 8)
}

function timestampId() {
  return new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)
}

function projectKeyOf(instance = {}) {
  return String(instance.projectId || instance.projectPath || instance.storagePath || 'default')
    .replace(/[^a-zA-Z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'default'
}

function getRoot(instance) {
  const baseDir = typeof storageConfig.getSummariesDir === 'function'
    ? storageConfig.getSummariesDir()
    : path.join(instance?.storagePath || process.cwd(), LEDGER_DIR)
  const root = path.join(baseDir, projectKeyOf(instance))
  ensureDir(root)
  ensureDir(path.join(root, 'action'))
  ensureDir(path.join(root, 'discussion'))
  ensureDir(path.join(root, 'casual'))
  return root
}

function getIndexPath(instance) {
  return path.join(getRoot(instance), INDEX_FILE)
}

function readJson(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return fallback
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'))
  } catch {
    return fallback
  }
}

function writeJson(filePath, data) {
  ensureDir(path.dirname(filePath))
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8')
}

function loadIndex(instance) {
  const data = readJson(getIndexPath(instance), { version: 1, items: [] })
  return {
    version: 1,
    items: Array.isArray(data.items) ? data.items : []
  }
}

function saveIndex(instance, index) {
  writeJson(getIndexPath(instance), {
    version: 1,
    updatedAt: Date.now(),
    items: Array.isArray(index.items) ? index.items : []
  })
}

function containsAny(text = '', keywords = []) {
  const value = String(text || '').toLowerCase()
  return keywords.some(keyword => value.includes(String(keyword).toLowerCase()))
}

function classifyConversation(text = '', evidence = {}) {
  if (evidence.hasToolCalls || evidence.hasFileChanges || evidence.hasCommands || evidence.hasHandoff) return 'action'
  if (isLedgerReadOnlyQuery(text)) return 'casual'
  if (containsAny(text, [
    '方案', '设计', '架构', '机制', '规则', '工作流', '怎么做', '如何做',
    '你觉得', '取舍', '优先级', '讨论', '决策', '约束', '规划', '路线',
    '上下文', 'token', '记忆', '摘要', '账本', '交接池'
  ])) return 'discussion'
  return 'casual'
}

function isLedgerReadOnlyQuery(text = '') {
  const value = String(text || '')
  const mentionsLedger = containsAny(value, ['账本', '项目账本', '账本索引', '摘要', '记忆系统'])
  const readOnlyIntent = containsAny(value, ['能看到哪些', '你能看到', '给我看看', '查看', '列出', '有哪些', '是什么', '不要查记忆'])
  const designIntent = containsAny(value, ['方案', '设计', '机制', '规则', '工作流', '怎么做', '如何做', '优化', '实现'])
  return mentionsLedger && readOnlyIntent && !designIntent
}

function summarizeUserRequest(text = '', maxChars = 220) {
  const value = String(text || '').replace(/\s+/g, ' ').trim()
  if (value.length <= maxChars) return value
  return `${value.slice(0, maxChars - 3).trim()}...`
}

function summarizeForLedger(text = '', maxChars = 260) {
  const value = String(text || '')
    .replace(/完整详情内容[\s\S]*$/u, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  if (value.length <= maxChars) return value
  return `${value.slice(0, maxChars - 3).trim()}...`
}

function uniqueList(items = [], limit = 20) {
  return [...new Set(items.filter(Boolean).map(item => String(item)))].slice(0, limit)
}

function extractRouteKeywords(text = '', limit = 80) {
  const value = String(text || '').toLowerCase()
  const tokens = []
  const matches = value.match(/[\u4e00-\u9fff]+|[a-z0-9_$-]{2,}/g) || []
  for (const raw of matches) {
    const token = raw.trim()
    if (!token) continue
    if (/^[\u4e00-\u9fff]+$/.test(token)) {
      if (token.length <= 12) tokens.push(token)
      for (let size = 2; size <= 4; size += 1) {
        for (let i = 0; i <= token.length - size; i += 1) tokens.push(token.slice(i, i + size))
      }
    } else if (!/^\d+$/.test(token)) {
      tokens.push(token)
    }
    if (tokens.length >= limit * 3) break
  }
  return uniqueList(tokens, limit)
}

function normalizeRouteRecord(route = {}) {
  if (!route || typeof route !== 'object') return null
  const textForKeywords = [
    route.userRequest,
    route.routeSummary,
    ...(Array.isArray(route.routeFiles) ? route.routeFiles : []),
    ...(Array.isArray(route.changedFiles) ? route.changedFiles : []),
    ...(Array.isArray(route.searchQueries) ? route.searchQueries : []),
  ].join('\n')
  const routeKeywords = uniqueList([
    ...(Array.isArray(route.routeKeywords) ? route.routeKeywords : []),
    ...extractRouteKeywords(textForKeywords, 80)
  ], 100)
  return {
    routeSummary: summarizeForLedger(route.routeSummary || '', 360),
    routeKeywords,
    routeFiles: uniqueList(route.routeFiles || [], 40),
    changedFiles: uniqueList(route.changedFiles || [], 40),
    routeTools: uniqueList(route.routeTools || [], 30),
    searchQueries: uniqueList(route.searchQueries || [], 12).map(item => summarizeForLedger(item, 220)),
    verification: uniqueList(route.verification || [], 12).map(item => summarizeForLedger(item, 220))
  }
}

function extractDiscussionFacts(text = '') {
  const lines = String(text || '')
    .replace(/\r/g, '')
    .split(/\n+/)
    .map(line => line.replace(/^[-*#\d.\s、]+/, '').trim())
    .filter(line => line.length >= 8)
  const decisions = []
  const rejected = []
  const constraints = []
  const openQuestions = []

  for (const line of lines) {
    if (containsAny(line, ['不再', '不要', '不能', '禁止', '避免', '不采用', '不是', '先不做', '暂时不做'])) rejected.push(line)
    else if (containsAny(line, ['必须', '需要', '只允许', '默认', '规则', '原则', '约束', '保留', '不可', '应该'])) constraints.push(line)
    else if (containsAny(line, ['待定', '问题', '风险', '后续', '还要', '下一步', '是否', '需要确认'])) openQuestions.push(line)
    else if (containsAny(line, ['决定', '采用', '改成', '设计', '方案', '核心', '目标', '结构', '归档', '索引', '账本'])) decisions.push(line)
    if (decisions.length + rejected.length + constraints.length + openQuestions.length >= 24) break
  }

  return {
    decisions: uniqueList(decisions, 10),
    rejected: uniqueList(rejected, 8),
    constraints: uniqueList(constraints, 10),
    openQuestions: uniqueList(openQuestions, 8)
  }
}

function createLedgerEntry(instance, options = {}) {
  const type = options.type || classifyConversation(options.userRequest || '', options.evidence || {})
  const title = options.title || summarizeUserRequest(options.userRequest || '', 48) || (type === 'action' ? '任务行动' : type === 'discussion' ? '方案讨论' : '闲聊')
  const id = `${type === 'action' ? 'task' : type}-${timestampId()}-${safeSlug(title, type)}-${shortHash(options.userRequest || title)}`
  const root = getRoot(instance)
  const dir = path.join(root, type, id)
  ensureDir(dir)

  const entry = {
    id,
    type,
    title,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    projectId: instance.projectId || '',
    projectPath: instance.projectPath || '',
    userRequestPreview: summarizeUserRequest(options.userRequest || ''),
    completed: uniqueList(options.completed || [], 12).map(item => summarizeForLedger(item)),
    findings: uniqueList(options.findings || [], 12).map(item => summarizeForLedger(item)),
    decisions: uniqueList(options.decisions || [], 12),
    rejected: uniqueList(options.rejected || [], 12),
    constraints: uniqueList(options.constraints || [], 12),
    openQuestions: uniqueList(options.openQuestions || [], 12),
    changedFiles: Array.isArray(options.changedFiles) ? options.changedFiles.slice(0, 30) : [],
    commands: uniqueList(options.commands || [], 20),
    unfinished: uniqueList(options.unfinished || [], 12),
    artifacts: uniqueList(options.artifacts || [], 20),
    git: options.git || null,
    route: normalizeRouteRecord(options.route),
    relativePath: path.relative(root, dir).replace(/\\/g, '/')
  }

  writeJson(path.join(dir, 'index.json'), entry)
  fs.writeFileSync(path.join(dir, 'user-request.txt'), String(options.userRequest || ''), 'utf-8')
  if (options.finalSummary) fs.writeFileSync(path.join(dir, 'final-summary.txt'), String(options.finalSummary), 'utf-8')
  if (options.extraJson) writeJson(path.join(dir, 'extra.json'), options.extraJson)

  const index = loadIndex(instance)
  index.items = [entry, ...index.items.filter(item => item.id !== entry.id)].slice(0, 200)
  saveIndex(instance, index)
  return { entry, dir }
}

function formatIndexForContext(instance, options = {}) {
  const index = loadIndex(instance)
  const maxItems = Number.isInteger(options.maxItems) && options.maxItems > 0 ? options.maxItems : 8
  const items = index.items.slice(0, maxItems)
  if (!items.length) return ''

  const lines = [
    '【项目账本索引】',
    '旧聊天全文默认不进入模型上下文。需要旧任务或旧方案细节时，先调用 read_task_ledger_entry(entry_id) 按 task/discussion 编号读取详情；只有账本没有相关记录时再查询记忆。'
  ]
  for (const item of items) {
    lines.push(`- ${item.id} | ${item.type} | ${item.title}`)
    if (item.userRequestPreview) lines.push(`  需求：${item.userRequestPreview}`)
    const summary = item.completed?.[0] || item.decisions?.[0] || item.findings?.[0] || ''
    if (summary) lines.push(`  摘要：${summary}`)
    if (item.unfinished?.length) lines.push(`  未完成：${item.unfinished[0]}`)
  }
  return lines.join('\n')
}

function scoreRouteEntry(item = {}, queryTokens = [], queryText = '') {
  const route = item.route || {}
  const routeText = [
    item.title,
    item.userRequestPreview,
    ...(item.completed || []),
    ...(item.findings || []),
    ...(item.changedFiles || []),
    ...(item.commands || []),
    route.routeSummary,
    ...(route.routeKeywords || []),
    ...(route.routeFiles || []),
    ...(route.changedFiles || []),
    ...(route.searchQueries || []),
  ].join('\n').toLowerCase()
  if (!routeText.trim()) return 0
  const routeTokens = new Set(extractRouteKeywords(routeText, 180))
  let score = 0
  for (const token of queryTokens) {
    if (routeTokens.has(token)) score += token.length >= 4 ? 4 : 2
    else if (token.length >= 3 && routeText.includes(token)) score += 1
  }
  const compactQuery = String(queryText || '').trim().toLowerCase()
  if (compactQuery && routeText.includes(compactQuery.slice(0, 80))) score += 12
  if (Array.isArray(route.routeFiles) && route.routeFiles.length) score += 2
  const ageDays = Math.max(0, (Date.now() - Number(item.createdAt || 0)) / 86400000)
  return score + Math.max(0, 4 - Math.floor(ageDays / 7))
}

function recallSimilarRoutes(instance, query = '', options = {}) {
  const index = loadIndex(instance)
  const queryTokens = extractRouteKeywords(query, 100)
  if (!queryTokens.length) return []
  const maxItems = Number.isInteger(options.maxItems) && options.maxItems > 0 ? options.maxItems : 3
  const minScore = Number.isFinite(options.minScore) ? options.minScore : 6
  return index.items
    .filter(item => item && item.type === 'action')
    .map(item => ({ item, score: scoreRouteEntry(item, queryTokens, query) }))
    .filter(hit => hit.score >= minScore)
    .sort((a, b) => b.score - a.score || Number(b.item.createdAt || 0) - Number(a.item.createdAt || 0))
    .slice(0, maxItems)
}

function formatRouteRecallForContext(instance, query = '', options = {}) {
  const hits = recallSimilarRoutes(instance, query, options)
  if (!hits.length) return ''
  const lines = [
    '【相似任务路线记忆】',
    '系统已按本轮自然语言需求自动召回同项目里的相似任务路线。先验证这些候选文件的小片段；如果不匹配，再做跨文件搜索。不要因为上下文压缩就重新从大入口文件反复翻找。'
  ]
  for (const { item, score } of hits) {
    const route = item.route || {}
    lines.push(`- ${item.id} | score:${Math.round(score)} | ${item.title || item.userRequestPreview || '旧任务'}`)
    if (item.userRequestPreview) lines.push(`  旧需求：${item.userRequestPreview}`)
    if (route.routeSummary) lines.push(`  路线：${route.routeSummary}`)
    const files = uniqueList([...(route.routeFiles || []), ...(route.changedFiles || []), ...(item.changedFiles || [])], 14)
    if (files.length) lines.push(`  优先验证文件：${files.join('、')}`)
    if (route.searchQueries?.length) lines.push(`  旧搜索：${route.searchQueries.slice(0, 3).join(' | ')}`)
    if (route.verification?.length) lines.push(`  验证：${route.verification.slice(0, 3).join(' | ')}`)
  }
  return lines.join('\n')
}

function getEntry(instance, entryId) {
  if (!entryId) return { success: false, error: '缺少账本编号' }
  const index = loadIndex(instance)
  const item = index.items.find(entry => entry.id === entryId)
  if (!item) return { success: false, error: '账本条目不存在' }
  const root = getRoot(instance)
  const dir = path.join(root, item.relativePath || path.join(item.type, item.id))
  const entry = readJson(path.join(dir, 'index.json'), item)
  const userRequestPath = path.join(dir, 'user-request.txt')
  const finalSummaryPath = path.join(dir, 'final-summary.txt')
  const handoffDir = path.join(dir, 'handoff-pool')
  const handoffPackets = fs.existsSync(handoffDir)
    ? fs.readdirSync(handoffDir)
      .filter(name => name.endsWith('.json') && name !== 'meta.json')
      .sort()
      .map(name => readJson(path.join(handoffDir, name), null))
      .filter(Boolean)
    : []

  return {
    success: true,
    entry,
    userRequest: fs.existsSync(userRequestPath) ? fs.readFileSync(userRequestPath, 'utf-8') : '',
    finalSummary: fs.existsSync(finalSummaryPath) ? fs.readFileSync(finalSummaryPath, 'utf-8') : '',
    handoffPackets
  }
}

module.exports = {
  LEDGER_DIR,
  getRoot,
  loadIndex,
  createLedgerEntry,
  formatIndexForContext,
  recallSimilarRoutes,
  formatRouteRecallForContext,
  getEntry,
  classifyConversation,
  extractDiscussionFacts,
  extractRouteKeywords
}
