const DEFAULT_MAX_AI_POINTS = 30
const DEFAULT_MAX_MANUAL_POINTS = 30
const DEFAULT_TRANSACTION_TTL_MS = 24 * 60 * 60 * 1000

function getCategory(point) {
  if (point?.source === 'ai_auto') return 'ai'
  if (point?.source === 'manual' || point?.source === 'user_manual') return 'manual'
  if (point?.source === 'restore_transaction') return 'transaction'
  return 'other'
}

function selectExpiredPoints(points, options = {}) {
  const maxAiPoints = Number(options.maxAiPoints ?? options.maxAutoPoints) || DEFAULT_MAX_AI_POINTS
  const maxManualPoints = Number(options.maxManualPoints) || DEFAULT_MAX_MANUAL_POINTS
  const transactionTtlMs = Number(options.transactionTtlMs) || DEFAULT_TRANSACTION_TTL_MS
  const now = Number(options.now) || Date.now()
  const deleted = new Set()

  for (const [category, limit] of [['ai', maxAiPoints], ['manual', maxManualPoints]]) {
    const categoryPoints = points
      .filter(point => getCategory(point) === category)
      .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))
    categoryPoints.slice(limit).forEach(point => deleted.add(point.id))
  }

  points
    .filter(point => getCategory(point) === 'transaction')
    .filter(point => now - new Date(point.createdAt || 0).getTime() > transactionTtlMs)
    .forEach(point => deleted.add(point.id))

  return [...deleted]
}

module.exports = {
  DEFAULT_MAX_AI_POINTS,
  DEFAULT_MAX_MANUAL_POINTS,
  getCategory,
  selectExpiredPoints
}
