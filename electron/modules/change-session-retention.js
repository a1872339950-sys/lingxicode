const DEFAULT_MAX_UNREFERENCED_SESSIONS = 80
const DEFAULT_UNREFERENCED_TTL_MS = 30 * 24 * 60 * 60 * 1000

function getSessionTime(session = {}) {
  return Date.parse(session.finalizedAt || session.startedAt || '') || 0
}

function selectExpiredSessions(sessions = [], referencedSessionIds = new Set(), options = {}) {
  const maxSessions = Math.max(1, Number(options.maxUnreferencedSessions) || DEFAULT_MAX_UNREFERENCED_SESSIONS)
  const ttlMs = Math.max(60 * 1000, Number(options.unreferencedTtlMs) || DEFAULT_UNREFERENCED_TTL_MS)
  const now = Number(options.now) || Date.now()
  const candidates = sessions
    .filter(session => session?.id && session.status !== 'active' && !referencedSessionIds.has(String(session.id)))
    .sort((a, b) => getSessionTime(b) - getSessionTime(a))
  const expired = new Set(candidates.slice(maxSessions).map(session => session.id))
  candidates
    .filter(session => now - getSessionTime(session) > ttlMs)
    .forEach(session => expired.add(session.id))
  return [...expired]
}

module.exports = {
  DEFAULT_MAX_UNREFERENCED_SESSIONS,
  DEFAULT_UNREFERENCED_TTL_MS,
  selectExpiredSessions
}
