const crypto = require('crypto')

const lastReports = new Map()

function normalizeForStableJson(value, seen = new WeakSet()) {
  if (value === null) return null
  if (value instanceof Date) return value.toJSON()
  const valueType = typeof value
  if (valueType === 'string' || valueType === 'number' || valueType === 'boolean') return value
  if (valueType === 'bigint') return value.toString()
  if (valueType === 'undefined' || valueType === 'function' || valueType === 'symbol') return undefined

  if (Array.isArray(value)) {
    return value.map(item => {
      const normalized = normalizeForStableJson(item, seen)
      return normalized === undefined ? null : normalized
    })
  }

  if (valueType === 'object') {
    if (seen.has(value)) throw new TypeError('Cannot stable stringify circular structure')
    seen.add(value)
    const result = {}
    for (const key of Object.keys(value).sort()) {
      const normalized = normalizeForStableJson(value[key], seen)
      if (normalized !== undefined) result[key] = normalized
    }
    seen.delete(value)
    return result
  }

  return value
}

function stableJsonStringify(value) {
  return JSON.stringify(normalizeForStableJson(value))
}

function hashText(text = '') {
  return crypto.createHash('sha256').update(String(text || '')).digest('hex')
}

function fingerprintPromptBody(body = {}) {
  const json = stableJsonStringify(body)
  return {
    hash: hashText(json),
    bytes: Buffer.byteLength(json, 'utf-8')
  }
}

function shortHash(hash = '') {
  return String(hash || '').slice(0, 12)
}

function getOpenAiSystemMessages(messages = []) {
  return Array.isArray(messages)
    ? messages.filter(message => message?.role === 'system').map(message => message.content)
    : []
}

function getNonSystemMessages(messages = []) {
  return Array.isArray(messages)
    ? messages.filter(message => message?.role !== 'system')
    : []
}

function getMessageRole(message = {}) {
  return String(message?.role || 'unknown')
}

function getMessageSize(message = {}) {
  return Buffer.byteLength(stableJsonStringify(message || {}), 'utf-8')
}

function compactMessageForTimeline(message = {}, index = 0) {
  return {
    index,
    role: getMessageRole(message),
    size: getMessageSize(message),
    hasToolCalls: Array.isArray(message?.tool_calls) && message.tool_calls.length > 0,
    toolCallId: message?.tool_call_id ? String(message.tool_call_id) : ''
  }
}

function getRequestParameters(body = {}) {
  const parameters = {}
  for (const [key, value] of Object.entries(body || {})) {
    if (['messages', 'system', 'tools'].includes(key)) continue
    parameters[key] = value
  }
  return parameters
}

function fingerprintSegment(name, value) {
  const json = stableJsonStringify(value)
  return {
    name,
    hash: hashText(json),
    shortHash: shortHash(hashText(json)),
    bytes: Buffer.byteLength(json, 'utf-8')
  }
}

function getCommonPrefixBytes(left = '', right = '') {
  const leftBuffer = Buffer.from(String(left || ''), 'utf-8')
  const rightBuffer = Buffer.from(String(right || ''), 'utf-8')
  const limit = Math.min(leftBuffer.length, rightBuffer.length)
  let index = 0
  while (index < limit && leftBuffer[index] === rightBuffer[index]) index += 1
  return index
}

function buildCacheSequence(body = {}) {
  const sequence = []
  const push = (name, value) => {
    const serialized = stableJsonStringify(value)
    sequence.push({
      name,
      hash: hashText(serialized),
      shortHash: shortHash(hashText(serialized)),
      bytes: Buffer.byteLength(serialized, 'utf-8'),
      serialized
    })
  }

  const tools = Array.isArray(body.tools)
    ? body.tools
    : (Array.isArray(body.tool_config?.tools) ? body.tool_config.tools : [])
  if (tools.length) push('tools', tools)

  if (body.system !== undefined && body.system !== null) {
    const system = Array.isArray(body.system) ? body.system : [body.system]
    system.forEach((value, index) => push(`system.${index + 1}`, value))
  }

  const messages = Array.isArray(body.messages)
    ? body.messages
    : (Array.isArray(body.input) ? body.input : [])
  messages.forEach((message, index) => push(`message.${index + 1}.${getMessageRole(message)}`, message))
  return sequence
}

function compareCacheSequence(current = [], previous = []) {
  const currentBytes = current.reduce((sum, item) => sum + item.bytes, 0)
  const previousBytes = previous.reduce((sum, item) => sum + item.bytes, 0)
  const limit = Math.min(current.length, previous.length)
  let commonPrefixBytes = 0
  let commonBlocks = 0
  let firstDifference = null

  for (let index = 0; index < limit; index += 1) {
    const currentBlock = current[index]
    const previousBlock = previous[index]
    if (currentBlock.name === previousBlock.name && currentBlock.hash === previousBlock.hash) {
      commonPrefixBytes += currentBlock.bytes
      commonBlocks += 1
      continue
    }
    const partialBytes = currentBlock.name === previousBlock.name
      ? getCommonPrefixBytes(currentBlock.serialized, previousBlock.serialized)
      : 0
    commonPrefixBytes += partialBytes
    firstDifference = {
      index,
      currentName: currentBlock.name,
      previousName: previousBlock.name,
      currentBytes: currentBlock.bytes,
      previousBytes: previousBlock.bytes,
      partialPrefixBytes: partialBytes
    }
    break
  }

  if (!firstDifference && current.length !== previous.length) {
    firstDifference = {
      index: limit,
      currentName: current[limit]?.name || '(end)',
      previousName: previous[limit]?.name || '(end)',
      currentBytes: current[limit]?.bytes || 0,
      previousBytes: previous[limit]?.bytes || 0,
      partialPrefixBytes: 0
    }
  }

  return {
    cacheableBytes: currentBytes,
    previousCacheableBytes: previousBytes,
    commonPrefixBytes,
    commonBlocks,
    reusablePercent: currentBytes > 0 ? Number(((commonPrefixBytes / currentBytes) * 100).toFixed(2)) : 100,
    firstDifference
  }
}

function buildPromptSegments(body = {}) {
  const messages = Array.isArray(body.messages) ? body.messages : []
  const nonSystemMessages = getNonSystemMessages(messages)
  const latestMessage = nonSystemMessages.length ? nonSystemMessages[nonSystemMessages.length - 1] : null
  const historyMessages = latestMessage ? nonSystemMessages.slice(0, -1) : nonSystemMessages
  const historyTimeline = historyMessages.map((message, index) => compactMessageForTimeline(message, index))
  const systemMessages = body.system
    ? (Array.isArray(body.system) ? body.system : [body.system])
    : getOpenAiSystemMessages(messages)
  const systemSegments = systemMessages.map((content, index) => fingerprintSegment(`system.${index + 1}`, content))
  return [
    ...systemSegments,
    fingerprintSegment('tools', body.tools || []),
    fingerprintSegment('messages.history', historyMessages),
    fingerprintSegment('messages.latest', latestMessage || null),
    fingerprintSegment('messages.timeline', historyTimeline),
    fingerprintSegment('parameters', getRequestParameters(body))
  ]
}

function compareSegments(current = [], previous = []) {
  const previousByName = new Map(previous.map(segment => [segment.name, segment]))
  return current.map(segment => {
    const old = previousByName.get(segment.name)
    return {
      ...segment,
      changed: !!old && old.hash !== segment.hash,
      previousShortHash: old?.shortHash || '',
      previousBytes: old?.bytes || 0
    }
  })
}

function observePromptStability(body = {}, options = {}) {
  const scopeKey = String(options.scopeKey || 'default')
  const fingerprint = fingerprintPromptBody(body)
  const segments = buildPromptSegments(body)
  const cacheSequence = buildCacheSequence(body)
  const previous = lastReports.get(scopeKey)
  const comparedSegments = previous ? compareSegments(segments, previous.segments) : segments.map(segment => ({
    ...segment,
    changed: false,
    previousShortHash: '',
    previousBytes: 0
  }))
  const changedSegments = comparedSegments.filter(segment => segment.changed)
  const cachePrefix = previous
    ? compareCacheSequence(cacheSequence, previous.cacheSequence || [])
    : {
        cacheableBytes: cacheSequence.reduce((sum, item) => sum + item.bytes, 0),
        previousCacheableBytes: 0,
        commonPrefixBytes: 0,
        commonBlocks: 0,
        reusablePercent: 0,
        firstDifference: null
      }
  const report = {
    scopeKey,
    label: String(options.label || ''),
    hash: fingerprint.hash,
    shortHash: shortHash(fingerprint.hash),
    bytes: fingerprint.bytes,
    firstSeen: !previous,
    stable: !!previous && changedSegments.length === 0,
    changedCount: changedSegments.length,
    changedSegments: changedSegments.map(segment => ({
      name: segment.name,
      bytes: segment.bytes,
      previousBytes: segment.previousBytes,
      shortHash: segment.shortHash,
      previousShortHash: segment.previousShortHash
    })),
    cachePrefix,
    cacheSequence: cacheSequence.map(item => ({
      name: item.name,
      bytes: item.bytes,
      shortHash: item.shortHash
    })),
    segments: comparedSegments.map(segment => ({
      name: segment.name,
      bytes: segment.bytes,
      shortHash: segment.shortHash,
      changed: segment.changed
    }))
  }
  lastReports.set(scopeKey, {
    hash: fingerprint.hash,
    bytes: fingerprint.bytes,
    segments,
    cacheSequence,
    observedAt: Date.now()
  })
  return report
}

function resetPromptStabilityReports() {
  lastReports.clear()
}

module.exports = {
  normalizeForStableJson,
  stableJsonStringify,
  fingerprintPromptBody,
  buildPromptSegments,
  buildCacheSequence,
  compareCacheSequence,
  observePromptStability,
  resetPromptStabilityReports
}
