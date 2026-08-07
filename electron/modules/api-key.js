// 密码框/占位符复制时常混入圆点掩码（• ● 等），HTTP 头只允许 Latin1，必须先清洗
function sanitizeApiKeyText(value = '') {
  return String(value || '')
    .replace(/[\u2022\u25CF\u25E6\u2219\u30FB\u00B7•●○∙·]/g, '')
    .split('')
    .filter(char => char.charCodeAt(0) <= 255)
    .join('')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .trim()
}

function resolveApiKey(value = '') {
  const raw = sanitizeApiKeyText(value)
  if (!raw) return ''

  const envMatch = raw.match(/^env:([A-Za-z_][A-Za-z0-9_]*)$/)
  if (envMatch) {
    return sanitizeApiKeyText(process.env[envMatch[1]] || '')
  }

  return raw
}

function hasApiKey(value = '') {
  return !!resolveApiKey(value)
}

module.exports = {
  sanitizeApiKeyText,
  resolveApiKey,
  hasApiKey
}
