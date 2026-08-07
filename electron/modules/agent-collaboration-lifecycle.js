const MAX_AGENT_EVENTS = 200
const COMPLETED_SESSION_TTL_MS = 15 * 60 * 1000
const MAX_COMPLETED_SESSIONS_PER_PROJECT = 20

const cleanupTimers = new Map()

function trimAgentEvents(agent = {}, maxEvents = MAX_AGENT_EVENTS) {
  const entries = [
    ...(Array.isArray(agent.thinking) ? agent.thinking : []).map((event, index) => ({ bucket: 'thinking', index, event })),
    ...(Array.isArray(agent.tools) ? agent.tools : []).map((event, index) => ({ bucket: 'tools', index, event }))
  ].sort((a, b) => Number(a.event?.createdAt || 0) - Number(b.event?.createdAt || 0))
  const retained = new Set(entries.slice(-Math.max(1, maxEvents)).map(entry => `${entry.bucket}:${entry.index}`))
  return {
    ...agent,
    thinking: (Array.isArray(agent.thinking) ? agent.thinking : []).filter((_, index) => retained.has(`thinking:${index}`)),
    tools: (Array.isArray(agent.tools) ? agent.tools : []).filter((_, index) => retained.has(`tools:${index}`))
  }
}

function compactCompletedSession(session = {}) {
  session.agents = (Array.isArray(session.agents) ? session.agents : []).map(agent => {
    const compact = trimAgentEvents(agent, 40)
    delete compact.abortController
    delete compact.upstreamContext
    delete compact.autoStartMessage
    compact.content = String(compact.content || '').slice(-2000)
    compact.thinking = compact.thinking.slice(-20)
    compact.tools = compact.tools.slice(-20)
    return compact
  })
  session.reports = (Array.isArray(session.reports) ? session.reports : []).map(report => ({
    agentId: report?.agentId || '',
    name: report?.name || '',
    role: report?.role || '',
    status: report?.status || '',
    reportFileName: report?.reportFileName || '',
    reportFilePath: report?.reportFilePath || '',
    completedAt: report?.completedAt || 0,
    error: report?.error ? {
      message: report.error.message || String(report.error),
      code: report.error.code || '',
      timeout: !!report.error.timeout
    } : null
  }))
  if (session.workflow && typeof session.workflow === 'object') {
    session.workflow = {
      id: session.workflow.id || '',
      name: session.workflow.name || '',
      nodeCount: Array.isArray(session.workflow.nodes) ? session.workflow.nodes.length : Number(session.workflow.nodeCount || 0)
    }
  }
  delete session.abortController
  session.compactedAt = Date.now()
  return session
}

function deleteSession(sessions, sessionId) {
  const timer = cleanupTimers.get(sessionId)
  if (timer) clearTimeout(timer)
  cleanupTimers.delete(sessionId)
  return sessions.delete(sessionId)
}

function pruneCompletedSessions(sessions, projectId) {
  const completed = [...sessions.values()]
    .filter(session => session.projectId === projectId && session.compactedAt)
    .sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0))
  for (const session of completed.slice(MAX_COMPLETED_SESSIONS_PER_PROJECT)) {
    deleteSession(sessions, session.id)
  }
}

function retainCompletedSession(sessions, session, options = {}) {
  compactCompletedSession(session)
  const ttlMs = Math.max(1000, Number(options.ttlMs) || COMPLETED_SESSION_TTL_MS)
  const existing = cleanupTimers.get(session.id)
  if (existing) clearTimeout(existing)
  const timer = setTimeout(() => {
    if (sessions.get(session.id) === session && session.compactedAt) sessions.delete(session.id)
    cleanupTimers.delete(session.id)
  }, ttlMs)
  timer.unref?.()
  cleanupTimers.set(session.id, timer)
  pruneCompletedSessions(sessions, session.projectId)
  return session
}

function reactivateSession(session) {
  if (!session?.id) return session
  const timer = cleanupTimers.get(session.id)
  if (timer) clearTimeout(timer)
  cleanupTimers.delete(session.id)
  delete session.compactedAt
  return session
}

function getStats(sessions) {
  return {
    sessions: sessions.size,
    completedSessions: [...sessions.values()].filter(session => session.compactedAt).length,
    cleanupTimers: cleanupTimers.size
  }
}

module.exports = {
  MAX_AGENT_EVENTS,
  COMPLETED_SESSION_TTL_MS,
  MAX_COMPLETED_SESSIONS_PER_PROJECT,
  trimAgentEvents,
  compactCompletedSession,
  retainCompletedSession,
  reactivateSession,
  deleteSession,
  getStats
}
