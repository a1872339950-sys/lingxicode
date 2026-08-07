const fs = require('fs')
const path = require('path')
const storageConfig = require('./storage-config')
const { normalizeCacheUsage } = require('./chat-helpers')

const USAGE_FILE = 'cloud-token-usage.json'
const MAX_RECORDS = 5000

function getUsageFilePath() {
  const dir = storageConfig.getConfigDir()
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  return path.join(dir, USAGE_FILE)
}

function readStore() {
  try {
    const file = getUsageFilePath()
    if (!fs.existsSync(file)) return { records: [] }
    const parsed = JSON.parse(fs.readFileSync(file, 'utf-8'))
    return { records: Array.isArray(parsed.records) ? parsed.records : [] }
  } catch (error) {
    console.warn('[CloudTokenUsage] read failed:', error.message)
    return { records: [] }
  }
}

function writeStore(store = {}) {
  const file = getUsageFilePath()
  const records = Array.isArray(store.records) ? store.records.slice(-MAX_RECORDS) : []
  fs.writeFileSync(file, JSON.stringify({ records }, null, 2), 'utf-8')
}

function isLocalModelConfig(modelConfig = {}) {
  const text = [
    modelConfig.provider,
    modelConfig.apiType,
    modelConfig.apiUrl,
    modelConfig.baseUrl,
    modelConfig.modelName,
    modelConfig.modelId,
    modelConfig.model
  ].filter(Boolean).join(' ').toLowerCase()
  return /ollama|lm\s*studio|localhost|127\.0\.0\.1|0\.0\.0\.0|host\.docker\.internal/.test(text)
}

function getModelKey(modelConfig = {}, fallbackModelId = '') {
  return String(modelConfig.modelKey || modelConfig.key || modelConfig.id || modelConfig.modelId || modelConfig.model || fallbackModelId || modelConfig.modelName || '').trim()
}

function getModelName(modelConfig = {}, fallbackModelId = '') {
  return String(modelConfig.modelName || modelConfig.name || modelConfig.modelId || modelConfig.model || fallbackModelId || '云端模型').trim()
}

function getModelUsageName(modelConfig = {}, fallbackModelId = '') {
  return String(modelConfig.modelId || modelConfig.model || fallbackModelId || modelConfig.modelName || modelConfig.name || '云端模型').trim()
}

function getModelUsageKey(modelConfig = {}, fallbackModelId = '') {
  const provider = getProvider(modelConfig)
  const apiUrl = String(modelConfig.apiUrl || modelConfig.baseUrl || '').trim()
  const actualModelId = String(modelConfig.modelId || modelConfig.model || fallbackModelId || '').trim()
  const displayName = getModelUsageName(modelConfig, fallbackModelId)
  return [provider, apiUrl, actualModelId || displayName].filter(Boolean).join('::') || getModelKey(modelConfig, fallbackModelId)
}

function getModelDisplayGroupKey(record = {}) {
  const name = String(record.modelName || '').trim()
  if (name) return name.toLowerCase()
  return String(record.modelKey || record.configModelKey || 'unknown').trim().toLowerCase() || 'unknown'
}

function mergeModelMeta(target = {}, record = {}) {
  const modelName = String(record.modelName || '').trim()
  if (modelName && (!target.modelName || target.modelName === target.modelKey || modelName.length < String(target.modelName).length)) {
    target.modelName = modelName
  }
  const modelKey = String(record.modelKey || '').trim()
  if (modelKey && !target.modelKeys.includes(modelKey)) target.modelKeys.push(modelKey)
  const configModelKey = String(record.configModelKey || '').trim()
  if (configModelKey && !target.configModelKeys.includes(configModelKey)) target.configModelKeys.push(configModelKey)
  const provider = String(record.provider || '').trim()
  if (provider && !target.providers.includes(provider)) target.providers.push(provider)
  target.provider = target.providers[0] || target.provider || ''
}

function getProvider(modelConfig = {}) {
  return String(modelConfig.provider || modelConfig.apiType || '').trim() || 'cloud'
}

function normalizeUsage(rawUsage = {}) {
  const normalized = normalizeCacheUsage(rawUsage) || {}
  const inputTokens = Math.max(0, Number(normalized.inputTokens || rawUsage.input_tokens || rawUsage.prompt_tokens || rawUsage.promptTokenCount || 0))
  const outputTokens = Math.max(0, Number(normalized.outputTokens || rawUsage.output_tokens || rawUsage.completion_tokens || rawUsage.candidatesTokenCount || 0))
  const totalTokens = Math.max(0, Number(normalized.totalTokens || rawUsage.total_tokens || rawUsage.totalTokenCount || inputTokens + outputTokens || 0))
  const cachedTokens = Math.max(0, Number(normalized.cachedTokens || 0))
  const cacheWriteTokens = Math.max(0, Number(normalized.cacheWriteTokens || 0))
  let cacheMissTokens = Math.max(0, Number(normalized.cacheMissTokens || 0))
  // 部分模型只回传 input/cached，未单独给 miss 时，用输入减去命中与写入推算
  if (!cacheMissTokens && inputTokens > 0) {
    cacheMissTokens = Math.max(0, inputTokens - cachedTokens - cacheWriteTokens)
  }
  return {
    inputTokens,
    outputTokens,
    totalTokens,
    cachedTokens,
    cacheWriteTokens,
    cacheMissTokens
  }
}

function recordUsage(payload = {}) {
  const modelConfig = payload.modelConfig || {}
  if (isLocalModelConfig(modelConfig)) return { success: true, skipped: true, reason: 'local_model' }
  const usage = normalizeUsage(payload.usage || payload.rawUsage || {})
  if (!usage.totalTokens && !usage.inputTokens && !usage.outputTokens) {
    return { success: true, skipped: true, reason: 'empty_usage' }
  }

  const record = {
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: new Date().toISOString(),
    projectId: payload.projectId || '',
    sessionId: payload.sessionId || '',
    requestId: payload.requestId || '',
    taskType: payload.taskType || 'chat',
    source: payload.source || 'chat',
    provider: getProvider(modelConfig),
    modelKey: getModelUsageKey(modelConfig, payload.modelId),
    configModelKey: getModelKey(modelConfig, payload.modelId),
    modelName: getModelUsageName(modelConfig, payload.modelId),
    usage,
    accuracy: 'api_usage',
    cloudOnly: true
  }

  const store = readStore()
  store.records.push(record)
  writeStore(store)
  return { success: true, record }
}

function startOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate())
}

function startOfWeek(date) {
  const day = date.getDay() || 7
  const result = startOfDay(date)
  result.setDate(result.getDate() - day + 1)
  return result
}

function startOfMonth(date) {
  return new Date(date.getFullYear(), date.getMonth(), 1)
}

function addDays(date, count) {
  const result = new Date(date)
  result.setDate(result.getDate() + count)
  return result
}

function addMonths(date, count) {
  return new Date(date.getFullYear(), date.getMonth() + count, date.getDate())
}

function addHours(date, count) {
  const result = new Date(date)
  result.setHours(result.getHours() + count, 0, 0, 0)
  return result
}

function endOfDay(date) {
  const result = startOfDay(date)
  result.setDate(result.getDate() + 1)
  return result
}

function startOfHour(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), date.getHours())
}

function getDayKey(date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function getInclusiveEndDayKey(date) {
  const adjusted = new Date(date)
  adjusted.setMilliseconds(adjusted.getMilliseconds() - 1)
  return getDayKey(adjusted)
}

function getHourKey(date) {
  return `${getDayKey(date)} ${String(date.getHours()).padStart(2, '0')}:00`
}

function getMonthKey(date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  return `${year}-${month}`
}

function getWeekKey(date) {
  const start = startOfWeek(date)
  return getDayKey(start)
}

function getTrendLabel(key = '', granularity = 'day') {
  if (!key) return ''
  if (granularity === 'hour') return key.slice(5).replace('-', '/').replace(' ', ' ')
  if (granularity === 'week') return `${key.slice(5).replace('-', '/')}周`
  if (granularity === 'month') return key.replace('-', '/')
  return key.slice(5).replace('-', '/')
}

function normalizeDateInput(value, fallback) {
  if (!value) return fallback
  const normalized = String(value).replace(/\//g, '-')
  const date = new Date(normalized)
  return Number.isNaN(date.getTime()) ? fallback : date
}

function resolveRange(options = {}, now = new Date()) {
  const preset = options.preset || ''
  const explicitDays = Number(options.days || 0)
  const todayStart = startOfDay(now)
  let start
  let end
  let label
  if (preset === 'today') {
    start = todayStart
    end = endOfDay(now)
    label = '今天'
  } else if (preset === 'yesterday') {
    start = addDays(todayStart, -1)
    end = todayStart
    label = '昨天'
  } else if (preset === 'last24h') {
    start = new Date(now.getTime() - 24 * 60 * 60 * 1000)
    end = now
    label = '近 24 小时'
  } else if (preset === 'thisMonth') {
    start = startOfMonth(now)
    end = addMonths(start, 1)
    label = '本月'
  } else if (preset === 'lastMonth') {
    end = startOfMonth(now)
    start = addMonths(end, -1)
    label = '上月'
  } else if (preset === 'singleDay') {
    start = startOfDay(normalizeDateInput(options.startDate || options.endDate, todayStart))
    end = endOfDay(start)
    label = '单日查询'
  } else if (preset === 'custom') {
    start = startOfDay(normalizeDateInput(options.startDate, addDays(todayStart, -6)))
    end = endOfDay(normalizeDateInput(options.endDate, now))
    label = '自定义'
  } else {
    const days = preset === '14d' ? 14 : preset === '30d' ? 30 : preset === '90d' ? 90 : Math.min(180, Math.max(1, explicitDays || 7))
    start = addDays(todayStart, -days + 1)
    end = endOfDay(now)
    label = `近 ${days} 天`
  }
  if (end <= start) end = endOfDay(start)
  return { start, end, label }
}

function getTrendKey(date, granularity = 'day') {
  if (granularity === 'hour') return getHourKey(date)
  if (granularity === 'week') return getWeekKey(date)
  if (granularity === 'month') return getMonthKey(date)
  return getDayKey(date)
}

function nextBucketDate(date, granularity = 'day') {
  if (granularity === 'hour') return addHours(date, 1)
  if (granularity === 'week') return addDays(date, 7)
  if (granularity === 'month') return addMonths(date, 1)
  return addDays(date, 1)
}

function alignBucketStart(date, granularity = 'day') {
  if (granularity === 'hour') return startOfHour(date)
  if (granularity === 'week') return startOfWeek(date)
  if (granularity === 'month') return startOfMonth(date)
  return startOfDay(date)
}

function createEmptyTrend(options = {}) {
  const granularity = normalizeGranularity(options.granularity)
  const range = resolveRange(options)
  const map = new Map()
  const start = alignBucketStart(range.start, granularity)
  for (let cursor = new Date(start); cursor < range.end; cursor = nextBucketDate(cursor, granularity)) {
    const key = getTrendKey(cursor, granularity)
    if (!map.has(key)) map.set(key, { key, date: key, label: getTrendLabel(key, granularity), ...emptyBucket(), cacheHitRate: 0 })
  }
  return { ...range, granularity, map }
}

function normalizeGranularity(value = 'day') {
  if (value === 'hour' || value === 'week' || value === 'month') return value
  return 'day'
}

function resolveUsageParts(usage = {}) {
  const inputTokens = Math.max(0, Number(usage.inputTokens || 0))
  const cachedTokens = Math.max(0, Number(usage.cachedTokens || 0))
  const cacheWriteTokens = Math.max(0, Number(usage.cacheWriteTokens || 0))
  let cacheMissTokens = Math.max(0, Number(usage.cacheMissTokens || 0))
  if (!cacheMissTokens && inputTokens > 0) {
    cacheMissTokens = Math.max(0, inputTokens - cachedTokens - cacheWriteTokens)
  }
  return {
    inputTokens,
    outputTokens: Math.max(0, Number(usage.outputTokens || 0)),
    totalTokens: Math.max(0, Number(usage.totalTokens || 0)),
    cachedTokens,
    cacheWriteTokens,
    cacheMissTokens
  }
}

function addUsage(target, usage = {}) {
  const parts = resolveUsageParts(usage)
  target.inputTokens += parts.inputTokens
  target.outputTokens += parts.outputTokens
  target.totalTokens += parts.totalTokens
  target.cachedTokens += parts.cachedTokens
  target.cacheWriteTokens += parts.cacheWriteTokens
  target.cacheMissTokens += parts.cacheMissTokens
  target.requests += 1
}

function emptyBucket() {
  return { inputTokens: 0, outputTokens: 0, totalTokens: 0, cachedTokens: 0, cacheWriteTokens: 0, cacheMissTokens: 0, requests: 0 }
}

function getUsageSummary(options = {}) {
  const now = new Date()
  const todayStart = startOfDay(now)
  const weekStart = startOfWeek(now)
  const monthStart = startOfMonth(now)
  const granularity = normalizeGranularity(options.granularity || 'day')
  const trendRange = createEmptyTrend({ ...options, granularity })
  const rangeDays = Math.max(1, Math.ceil((trendRange.end - trendRange.start) / (24 * 60 * 60 * 1000)))
  const store = readStore()
  const records = store.records
    .map(record => ({ ...record, date: new Date(record.createdAt) }))
    .filter(record => !Number.isNaN(record.date.getTime()))

  const summary = {
    today: emptyBucket(),
    week: emptyBucket(),
    month: emptyBucket(),
    total: emptyBucket(),
    daily: [],
    byModel: [],
    byTask: [],
    recent: [],
    trend: [],
    range: {
      days: rangeDays,
      granularity,
      preset: options.preset || '',
      label: trendRange.label,
      startDate: getDayKey(trendRange.start),
      endDate: getInclusiveEndDayKey(trendRange.end)
    }
  }
  const dailyMap = new Map()
  const modelMap = new Map()
  const taskMap = new Map()
  const rangeRecords = []

  for (const record of records) {
    addUsage(summary.total, record.usage)
    if (record.date >= todayStart) addUsage(summary.today, record.usage)
    if (record.date >= weekStart) addUsage(summary.week, record.usage)
    if (record.date >= monthStart) addUsage(summary.month, record.usage)

    const dayKey = record.createdAt.slice(0, 10)
    if (!dailyMap.has(dayKey)) dailyMap.set(dayKey, { date: dayKey, ...emptyBucket() })
    addUsage(dailyMap.get(dayKey), record.usage)

    const inSelectedRange = record.date >= trendRange.start && record.date < trendRange.end
    if (inSelectedRange) {
      rangeRecords.push(record)
      const trendKey = getTrendKey(record.date, granularity)
      if (!trendRange.map.has(trendKey)) trendRange.map.set(trendKey, { key: trendKey, date: trendKey, label: getTrendLabel(trendKey, granularity), ...emptyBucket(), cacheHitRate: 0 })
      addUsage(trendRange.map.get(trendKey), record.usage)

      const modelKey = getModelDisplayGroupKey(record)
      if (!modelMap.has(modelKey)) {
        modelMap.set(modelKey, {
          modelKey,
          modelName: record.modelName || record.modelKey || '云端模型',
          provider: record.provider || '',
          providers: [],
          modelKeys: [],
          configModelKeys: [],
          ...emptyBucket()
        })
      }
      const modelBucket = modelMap.get(modelKey)
      mergeModelMeta(modelBucket, record)
      addUsage(modelBucket, record.usage)

      const taskType = record.taskType || 'chat'
      if (!taskMap.has(taskType)) taskMap.set(taskType, { taskType, ...emptyBucket() })
      addUsage(taskMap.get(taskType), record.usage)
    }
  }

  summary.daily = Array.from(dailyMap.values()).sort((a, b) => a.date.localeCompare(b.date)).slice(-30)
  const withCacheRate = item => {
    const cached = Number(item.cachedTokens || 0)
    const miss = Number(item.cacheMissTokens || 0)
    const write = Number(item.cacheWriteTokens || 0)
    // 命中率按「命中 / (命中+未命中)」；写入单独展示，不稀释命中率
    const base = cached + miss
    return {
      ...item,
      cacheHitRate: base > 0 ? (cached / base) * 100 : 0,
      cacheWriteTokens: write
    }
  }
  summary.trend = Array.from(trendRange.map.values()).sort((a, b) => a.key.localeCompare(b.key)).map(withCacheRate)
  summary.byModel = Array.from(modelMap.values()).sort((a, b) => b.totalTokens - a.totalTokens).slice(0, 20).map(withCacheRate)
  summary.byTask = Array.from(taskMap.values()).sort((a, b) => b.totalTokens - a.totalTokens).map(withCacheRate)
  summary.rangeTotal = rangeRecords.reduce((acc, record) => {
    addUsage(acc, record.usage || {})
    return acc
  }, emptyBucket())
  summary.rangeTotal = withCacheRate(summary.rangeTotal)
  summary.recent = rangeRecords.slice(-12).reverse().map(record => ({
    id: record.id,
    createdAt: record.createdAt,
    modelName: record.modelName,
    provider: record.provider,
    taskType: record.taskType,
    usage: resolveUsageParts(record.usage || {})
  }))
  // 日历卡也补命中率，便于 KPI 副文案
  summary.today = withCacheRate(summary.today)
  summary.week = withCacheRate(summary.week)
  summary.month = withCacheRate(summary.month)
  summary.total = withCacheRate(summary.total)
  return { success: true, data: summary }
}

function registerIPC(ipcMain) {
  ipcMain.handle('cloud-token-usage:getSummary', async (event, options = {}) => getUsageSummary(options))
}

module.exports = {
  recordUsage,
  getUsageSummary,
  registerIPC,
  isLocalModelConfig,
  normalizeUsage
}
