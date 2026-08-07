function normalizeToolArguments(rawArguments) {
  if (rawArguments === undefined || rawArguments === null || rawArguments === '') return '{}'
  return typeof rawArguments === 'string' ? rawArguments : JSON.stringify(rawArguments)
}

// 检测 JSON 是否在字符串中间被截断
function detectTruncation(raw) {
  if (!raw || typeof raw !== 'string') return { truncated: false }
  const trimmed = raw.trim()
  if (!trimmed) return { truncated: false }

  // 必须以 { 开头才算工具参数
  if (!trimmed.startsWith('{')) return { truncated: false }

  let inString = false
  let escaped = false
  let depth = 0
  let lastSignificant = ''

  for (let i = 0; i < trimmed.length; i++) {
    const ch = trimmed[i]
    if (escaped) { escaped = false; continue }
    if (ch === '\\') { escaped = true; continue }
    if (ch === '"') { inString = !inString; continue }
    if (inString) continue
    if (ch === '{' || ch === '[') { depth++; lastSignificant = ch }
    else if (ch === '}' || ch === ']') { depth--; lastSignificant = ch }
    else if (ch !== ' ' && ch !== '\t' && ch !== '\n' && ch !== '\r' && ch !== ':' && ch !== ',') {
      lastSignificant = ch
    }
  }

  // 扫描完还在字符串内，说明字符串没闭合 → 截断
  if (inString) {
    return { truncated: true, reason: 'unterminated_string', position: trimmed.length }
  }

  // 括号没闭合 → 截断
  if (depth > 0) {
    return { truncated: true, reason: 'unclosed_brackets', position: trimmed.length }
  }

  return { truncated: false }
}

// 检测是否包含大文本特征
function detectLargeTextRisk(raw) {
  if (!raw || typeof raw !== 'string') return false
  if (raw.length > 8000) return true
  const markers = ['<!DOCTYPE html', '<html', '<svg', '</svg>', 'function ', 'class=', '<style', '<script', '*** Begin Patch', '*** End Patch']
  const lower = raw.toLowerCase()
  return markers.some(m => lower.includes(m.toLowerCase()))
}

// 根据工具名生成修复建议
function getRepairHint(toolName, isLargeTextRisk) {
  if (!isLargeTextRisk) return '请重新生成合法 JSON 参数。'
  switch (toolName) {
    case 'write_file':
      return '大内容请拆成较小文件块，或先写骨架再用 text_edit/apply_patch 补充。'
    case 'apply_patch':
      return '请缩小 patch 范围，分多次提交补丁。'
    case 'text_edit':
    case 'edit_file':
      return '请缩短 old_content/new_content，用更小锚点替换。'
    case 'shell_run':
      return '复杂脚本不要直接塞进 command，先写脚本文件再执行。'
    case 'render_svg_asset':
      return '大 SVG 不要放 svg_content，先写 .svg 文件，再传 svg_path。'
    case 'artifact_workflow':
      return '大脚本请分段，或先落成脚本文件再执行。'
    default:
      return '请重新生成合法 JSON 参数；大内容请拆分或改用文件路径。'
  }
}

function parseToolArgs(rawArguments, options = {}) {
  const fallback = options.fallback && typeof options.fallback === 'object' && !Array.isArray(options.fallback)
    ? options.fallback
    : {}
  if (rawArguments && typeof rawArguments === 'object' && !Array.isArray(rawArguments)) {
    return { ok: true, args: rawArguments, raw: normalizeToolArguments(rawArguments), error: null }
  }

  const raw = normalizeToolArguments(rawArguments)
  try {
    const parsed = JSON.parse(String(raw).trim() || '{}')
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {
        ok: false,
        args: fallback,
        raw,
        error: `工具参数必须是 JSON 对象，实际为 ${Array.isArray(parsed) ? '数组' : typeof parsed}`
      }
    }
    return { ok: true, args: parsed, raw, error: null }
  } catch (error) {
    const parseMessage = error?.message || String(error)
    const rawLength = raw.length
    const rawPreview = raw.length > 400
      ? `${raw.slice(0, 200)}...${raw.slice(-200)}`
      : raw
    const isLargeTextRisk = detectLargeTextRisk(raw)
    const truncation = detectTruncation(raw)
    const toolName = options.toolName || ''
    const repairHint = getRepairHint(toolName, isLargeTextRisk)

    return {
      ok: false,
      args: fallback,
      raw,
      error: {
        code: 'invalid_tool_arguments',
        category: 'tool_argument_format',
        reason: truncation.truncated ? 'json_truncated' : 'json_parse_failed',
        toolName,
        message: truncation.truncated
          ? `工具参数因传输中断被截断，JSON 不完整（${truncation.reason}）。工具未执行。`
          : `工具参数不是合法 JSON，工具未执行。`,
        rawLength,
        rawPreview,
        parseMessage,
        isLargeTextRisk,
        recoverable: true,
        next_action: truncation.truncated
          ? 'retry_with_valid_json_arguments'
          : 'retry_with_valid_json_arguments',
        repairHint
      }
    }
  }
}

function parseToolCallArgs(call = {}, options = {}) {
  if (call?.args && typeof call.args === 'object' && !Array.isArray(call.args)) {
    return parseToolArgs(call.args, options)
  }
  return parseToolArgs(call?.function?.arguments, options)
}

function buildToolArgsParseErrorResult(toolName, parseResult = {}) {
  const raw = String(parseResult.raw || '')
  const error = parseResult.error || {}

  // 如果 error 已经是结构化对象（新格式），直接用
  if (typeof error === 'object' && error.code) {
    return {
      success: false,
      tool_error: true,
      code: error.code,
      category: error.category,
      recoverable: true,
      tool_name: toolName || error.toolName,
      message: error.message || '工具参数不是合法 JSON，工具未执行。',
      next_action: error.repairHint || '请重新生成合法 JSON 参数；大内容请拆分或改用文件路径。',
      raw_length: error.rawLength,
      is_large_text_risk: error.isLargeTextRisk,
      raw_arguments_preview: error.rawPreview || (raw.length > 500 ? `${raw.slice(0, 500)}...(${raw.length} chars)` : raw)
    }
  }

  // 兼容旧格式（error 是字符串）
  return {
    success: false,
    tool_error: true,
    code: 'invalid_tool_arguments',
    category: 'tool_argument_format',
    recoverable: true,
    tool_name: toolName,
    message: `${toolName || '工具'} 的参数不是合法 JSON 对象，已拒绝执行，避免把空参数传给工具。`,
    next_action: '请重新生成合法 JSON 参数；大内容请拆分或改用文件路径。',
    raw_arguments_preview: raw.length > 500 ? `${raw.slice(0, 500)}...(${raw.length} chars)` : raw
  }
}

module.exports = {
  parseToolArgs,
  parseToolCallArgs,
  buildToolArgsParseErrorResult
}