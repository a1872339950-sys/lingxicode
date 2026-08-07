(function () {
  'use strict'

  const SETTLE_DELAYS_MS = [80, 220, 500]

  let generation = 0
  let timers = []

  function clearTimers() {
    for (const timer of timers) clearTimeout(timer)
    timers = []
  }

  function cancel() {
    generation += 1
    clearTimers()
  }

  function matchesActiveSession(options) {
    const getActiveProject = options.getActiveProject
    if (typeof getActiveProject !== 'function') return true
    const active = getActiveProject()
    if (!active) return false
    if (String(active.id || '') !== String(options.projectId || '')) return false
    if (String(active.chatSessionId || '') !== String(options.sessionId || '')) return false
    if (typeof options.isProjectRunning === 'function' && options.isProjectRunning(active)) return false
    return !active.isRunning
  }

  function forceBottom(container) {
    if (!container) return
    try {
      if (window.ChatStickyBottom?.forceStick) {
        window.ChatStickyBottom.forceStick(container)
      } else {
        container.scrollTop = container.scrollHeight
      }
    } catch (_) {
      container.scrollTop = container.scrollHeight
    }
  }

  function schedule(options = {}) {
    cancel()
    const currentGeneration = ++generation
    const container = options.container

    const apply = () => {
      if (currentGeneration !== generation || !matchesActiveSession(options)) return
      forceBottom(container)
    }

    apply()
    requestAnimationFrame(() => {
      apply()
      requestAnimationFrame(apply)
    })
    timers = SETTLE_DELAYS_MS.map(delay => setTimeout(apply, delay))
    return currentGeneration
  }

  window.ChatSessionScrollRestorer = {
    cancel,
    schedule
  }
})()
