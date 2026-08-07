(function () {
  'use strict'

  const MAX_AGENT_EVENTS = 200
  const MAX_COMPLETED_SESSIONS_PER_PROJECT = 20
  const COMPLETED_SESSION_TTL_MS = 15 * 60 * 1000

  function trimAgentEvents(agent = {}, maxEvents = MAX_AGENT_EVENTS) {
    const entries = [
      ...(Array.isArray(agent.thinking) ? agent.thinking : []).map((event, index) => ({ bucket: 'thinking', index, event })),
      ...(Array.isArray(agent.tools) ? agent.tools : []).map((event, index) => ({ bucket: 'tools', index, event }))
    ].sort((a, b) => Number(new Date(a.event?.createdAt || 0)) - Number(new Date(b.event?.createdAt || 0)))
    const retained = new Set(entries.slice(-Math.max(1, maxEvents)).map(entry => `${entry.bucket}:${entry.index}`))
    agent.thinking = (Array.isArray(agent.thinking) ? agent.thinking : []).filter((_, index) => retained.has(`thinking:${index}`))
    agent.tools = (Array.isArray(agent.tools) ? agent.tools : []).filter((_, index) => retained.has(`tools:${index}`))
    return agent
  }

  function isTerminal(session = {}) {
    return ['done', 'completed', 'completed_with_errors', 'cancelled', 'interrupted', 'error', 'failed', 'timeout', 'single_agent']
      .includes(String(session.status || ''))
  }

  function createJanitor(options = {}) {
    const timers = new Map()
    const sessionStore = options.sessionStore

    function releaseRuntime(sessionId) {
      options.stopPolling?.(sessionId)
      for (const [projectId, runtime] of options.chatRuntimes?.entries?.() || []) {
        if (String(runtime?.sessionId || '') !== String(sessionId || '')) continue
        options.disposeRuntime?.(runtime)
        options.chatRuntimes.delete(projectId)
      }
    }

    function releaseSession(sessionId) {
      const timer = timers.get(sessionId)
      if (timer) clearTimeout(timer)
      timers.delete(sessionId)
      releaseRuntime(sessionId)
      sessionStore?.delete?.(sessionId)
      options.sessionPaneVisibility?.delete?.(sessionId)
      options.autoOpenedSessions?.delete?.(sessionId)
      document.querySelector?.(`[data-collab-session="${String(sessionId).replace(/"/g, '\\"')}"]`)?.remove?.()
    }

    function prune(projectId) {
      const completed = [...(sessionStore?.values?.() || [])]
        .filter(session => session.projectId === projectId && isTerminal(session))
        .sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0))
      completed.slice(MAX_COMPLETED_SESSIONS_PER_PROJECT).forEach(session => releaseSession(session.id))
    }

    function track(session = {}) {
      if (!session.id) return
      ;(session.agents || []).forEach(agent => trimAgentEvents(agent))
      const existing = timers.get(session.id)
      if (!isTerminal(session)) {
        if (existing) clearTimeout(existing)
        timers.delete(session.id)
        return
      }
      releaseRuntime(session.id)
      if (existing) clearTimeout(existing)
      const timer = setTimeout(() => releaseSession(session.id), COMPLETED_SESSION_TTL_MS)
      timers.set(session.id, timer)
      prune(session.projectId)
    }

    return { track, releaseSession, releaseRuntime, trimAgentEvents, timers }
  }

  window.AgentCollaborationLifecycle = { createJanitor, trimAgentEvents, isTerminal }
})()
