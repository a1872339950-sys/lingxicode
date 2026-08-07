const crypto = require('crypto')

function digest(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex')
}

function makeId(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${crypto.randomBytes(5).toString('hex')}`
}

function messageFingerprint(message = {}) {
  const comparable = {
    role: message.role || '',
    type: message.type || '',
    content: message.content ?? null,
    tool_call_id: message.tool_call_id || message.toolCallId || '',
    tool_calls: message.tool_calls || null,
    time: message.time || '',
    startedAt: message.startedAt || null
  }
  try {
    return digest(JSON.stringify(comparable))
  } catch {
    return digest(`${comparable.role}:${String(comparable.content || '')}`)
  }
}

function assignMessageIdentity(messages, options = {}) {
  const sessionId = String(options.sessionId || 'session')
  const deterministic = !!options.deterministic
  let currentRoundId = options.previousRoundId || ''
  return (Array.isArray(messages) ? messages : []).map((message, index) => {
    const item = message && typeof message === 'object' ? message : { role: 'assistant', content: String(message || '') }
    if (item.role === 'user' && !item.hidden && !item.isInterject) {
      currentRoundId = item.roundId || (deterministic
        ? `round-${digest(`${sessionId}:${index}:${messageFingerprint(item)}`).slice(0, 24)}`
        : makeId('round'))
    } else if (!currentRoundId) {
      currentRoundId = deterministic ? `round-${digest(`${sessionId}:orphan`).slice(0, 24)}` : makeId('round')
    }
    if (!item.roundId) item.roundId = currentRoundId
    if (!item.messageId) {
      item.messageId = deterministic
        ? `msg-${digest(`${sessionId}:${index}:${messageFingerprint(item)}`).slice(0, 28)}`
        : makeId('msg')
    }
    return item
  })
}

function applyStoredIdentityOverlap(storedMessages, snapshotMessages) {
  const stored = Array.isArray(storedMessages) ? storedMessages : []
  const snapshot = Array.isArray(snapshotMessages) ? snapshotMessages : []
  const max = Math.min(stored.length, snapshot.length)
  let overlap = 0
  for (let size = max; size > 0; size--) {
    const storedStart = stored.length - size
    let matches = true
    for (let index = 0; index < size; index++) {
      if (messageFingerprint(stored[storedStart + index]) !== messageFingerprint(snapshot[index])) {
        matches = false
        break
      }
    }
    if (matches) {
      overlap = size
      for (let index = 0; index < size; index++) {
        snapshot[index].messageId = stored[storedStart + index].messageId
        snapshot[index].roundId = stored[storedStart + index].roundId
      }
      break
    }
  }
  return overlap
}

function findPersistedPrefixLength(storedMessages, snapshotMessages) {
  const stored = Array.isArray(storedMessages) ? storedMessages : []
  const snapshot = Array.isArray(snapshotMessages) ? snapshotMessages : []
  const overlap = applyStoredIdentityOverlap(stored, snapshot)
  if (overlap > 0 || !stored.length || !snapshot.length) return overlap

  const lastStoredId = stored[stored.length - 1]?.messageId
  if (!lastStoredId) return 0
  for (let index = snapshot.length - 1; index >= 0; index--) {
    if (snapshot[index]?.messageId === lastStoredId) return index + 1
  }
  return 0
}

function groupByRound(messages) {
  const groups = []
  for (const message of Array.isArray(messages) ? messages : []) {
    const roundId = message.roundId || 'round-unknown'
    const last = groups[groups.length - 1]
    if (last?.roundId === roundId) last.messages.push(message)
    else groups.push({ roundId, messages: [message] })
  }
  return groups
}

module.exports = {
  applyStoredIdentityOverlap,
  assignMessageIdentity,
  findPersistedPrefixLength,
  groupByRound,
  messageFingerprint
}
