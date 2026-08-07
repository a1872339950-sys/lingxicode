(function () {
  'use strict'

  const MAX_CACHED_ROUNDS = 90

  function findRoundStarts(messages = []) {
    const starts = []
    for (let index = 0; index < messages.length; index++) {
      const message = messages[index]
      if (message?.role === 'user' && !message.hidden && !message.isInterject) starts.push(index)
    }
    return starts
  }

  function compact(messages = [], options = {}) {
    if (!Array.isArray(messages)) return []
    const maxRounds = Math.max(1, Number(options.maxRounds) || MAX_CACHED_ROUNDS)
    const starts = findRoundStarts(messages)
    if (starts.length <= maxRounds) return messages
    return messages.slice(starts[starts.length - maxRounds])
  }

  function compactProject(project) {
    if (!project) return project
    project.messagesHistory = compact(project.messagesHistory)
    project.history = compact(project.history)
    return project
  }

  window.ChatRuntimeHistoryCache = {
    MAX_CACHED_ROUNDS,
    compact,
    compactProject
  }
})()
