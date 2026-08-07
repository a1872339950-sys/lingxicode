function safeJsonStringify(value) {
  try {
    return JSON.stringify(value)
  } catch (error) {
    return String(value || '')
  }
}

function summarizeToolArgsForRunLog(args = {}) {
  const summary = {}
  for (const [key, value] of Object.entries(args || {})) {
    if (typeof value === 'string') {
      if (['content', 'old_content', 'new_content', 'old_string', 'new_string', 'replacement', 'patch'].includes(key)) {
        summary[key] = { chars: value.length, lines: value ? value.split(/\r\n|\r|\n/).length : 0 }
      } else {
        summary[key] = value.length > 240 ? `${value.slice(0, 240)}...(${value.length} chars)` : value
      }
    } else if (Array.isArray(value)) {
      summary[key] = { type: 'array', length: value.length }
    } else if (value && typeof value === 'object') {
      summary[key] = { type: 'object', keys: Object.keys(value).slice(0, 20) }
    } else {
      summary[key] = value
    }
  }
  return summary
}

function readFiniteNumber(value) {
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

module.exports = { safeJsonStringify, summarizeToolArgsForRunLog, readFiniteNumber }
