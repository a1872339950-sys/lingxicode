/**
 * 文本编辑纯工具函数
 * 从 tools.js 提取，无外部模块依赖（仅 Node.js path）
 *
 * 包含：行计数、文本匹配、灵活范围查找、正则编译、文本编辑列表应用、
 *       全量重写守卫、文本缓冲区检测、行范围规范化、字符裁剪
 */

const path = require('path')

function countLines(content) {
  const value = String(content ?? '')
  if (!value) return 0
  return value.split(/\r\n|\r|\n/).length
}

function countTextOccurrences(content = '', needle = '') {
  const target = String(needle ?? '')
  if (!target) return 0
  let count = 0
  let index = String(content ?? '').indexOf(target)
  while (index >= 0) {
    count += 1
    index = String(content ?? '').indexOf(target, index + target.length)
  }
  return count
}

function normalizeTextWithMap(text = '') {
  const source = String(text ?? '')
  const chars = []
  const map = []
  for (let i = 0; i < source.length; i++) {
    const ch = source[i]
    if (ch === '\r') {
      if (source[i + 1] === '\n') {
        chars.push('\n')
        map.push(i)
        i += 1
      } else {
        chars.push('\n')
        map.push(i)
      }
    } else {
      chars.push(ch)
      map.push(i)
    }
  }
  return { text: chars.join(''), map }
}

function findFlexibleTextRange(content = '', needle = '') {
  const source = String(content ?? '')
  const target = String(needle ?? '')
  if (!target) return null
  const exact = source.indexOf(target)
  if (exact >= 0) return { start: exact, end: exact + target.length, mode: 'exact' }

  const normalizedSource = normalizeTextWithMap(source)
  const normalizedTarget = normalizeTextWithMap(target).text
  const normalizedIndex = normalizedSource.text.indexOf(normalizedTarget)
  if (normalizedIndex >= 0) {
    const start = normalizedSource.map[normalizedIndex]
    const lastNormalizedIndex = normalizedIndex + normalizedTarget.length - 1
    const lastOriginalIndex = normalizedSource.map[lastNormalizedIndex]
    const end = lastOriginalIndex + (source[lastOriginalIndex] === '\r' && source[lastOriginalIndex + 1] === '\n' ? 2 : 1)
    return { start, end, mode: 'line_endings' }
  }

  const looseTarget = normalizedTarget
    .split('\n')
    .map(line => line.trimEnd())
    .join('\n')
    .trim()
  if (looseTarget.length >= 12) {
    const normalizedLines = normalizedSource.text.split('\n')
    let offset = 0
    for (let startLine = 0; startLine < normalizedLines.length; startLine++) {
      let candidate = ''
      let candidateEndLine = startLine
      for (; candidateEndLine < normalizedLines.length && candidate.length <= looseTarget.length + 200; candidateEndLine++) {
        candidate += (candidate ? '\n' : '') + normalizedLines[candidateEndLine].trimEnd()
        if (candidate.trim() === looseTarget) {
          const start = normalizedSource.map[offset] ?? 0
          const endNormalized = offset + normalizedLines.slice(startLine, candidateEndLine + 1).join('\n').length
          const end = (normalizedSource.map[endNormalized] ?? source.length)
          return { start, end, mode: 'trailing_whitespace' }
        }
      }
      offset += normalizedLines[startLine].length + 1
    }
  }

  return null
}

function countFlexibleOccurrences(content = '', needle = '') {
  const target = String(needle ?? '')
  if (!target) return 0
  const exact = countTextOccurrences(content, target)
  if (exact > 0) return exact
  const normalizedSource = normalizeTextWithMap(content).text
  const normalizedTarget = normalizeTextWithMap(target).text
  const normalizedCount = countTextOccurrences(normalizedSource, normalizedTarget)
  if (normalizedCount > 0) return normalizedCount
  return findFlexibleTextRange(content, target) ? 1 : 0
}

function getLineStartOffsets(content = '') {
  const text = String(content ?? '')
  const offsets = [0]
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '\n') offsets.push(i + 1)
  }
  return offsets
}

function getLineRangeOffsets(content = '', startLine = 1, endLine = startLine) {
  const offsets = getLineStartOffsets(content)
  const totalLines = offsets.length
  const start = Math.max(1, Math.min(Number.parseInt(startLine, 10) || 1, totalLines))
  const end = Math.max(start, Math.min(Number.parseInt(endLine, 10) || start, totalLines))
  const startOffset = offsets[start - 1] ?? 0
  const endOffset = end >= totalLines ? String(content ?? '').length : offsets[end]
  return { startOffset, endOffset, startLine: start, endLine: end }
}

function compileTextEditRegex(pattern = '', flags = '') {
  const source = String(pattern || '')
  if (!source) throw new Error('regex pattern is required')
  const safeFlags = [...new Set(String(flags || '').replace(/[^gimsuy]/g, '').split(''))].join('')
  return new RegExp(source, safeFlags.includes('g') ? safeFlags : `${safeFlags}g`)
}

function buildTextEditDiagnostics(content = '', target = '') {
  const normalizedTarget = normalizeTextWithMap(target).text.trim()
  const firstLine = normalizedTarget.split('\n').find(line => line.trim().length >= 4) || normalizedTarget.slice(0, 80)
  const lines = String(content ?? '').split(/\r\n|\r|\n/)
  const terms = [...new Set(String(firstLine || '').split(/[^A-Za-z0-9_$\u4e00-\u9fa5]+/).filter(item => item.length >= 3).slice(0, 8))]
  const candidates = []
  for (let index = 0; index < lines.length && candidates.length < 8; index++) {
    const line = lines[index]
    if (!terms.length ? line.includes(firstLine) : terms.some(term => line.includes(term))) {
      candidates.push({
        line: index + 1,
        preview: line.trim().slice(0, 180)
      })
    }
  }
  return {
    target_chars: String(target || '').length,
    hint: 'No exact match. Prefer regex/line-based text_edit or read the returned candidate lines instead of rewriting the whole file.',
    candidate_lines: candidates
  }
}

function countChangedLineUnits(text = '') {
  const value = String(text ?? '')
  if (!value) return 0
  return value.split(/\r\n|\r|\n/).filter((line, index, lines) => line || index < lines.length - 1).length || 1
}

function applyTextEditList(originalContent = '', edits = []) {
  let nextContent = String(originalContent ?? '')
  const applied = []
  if (!Array.isArray(edits) || edits.length === 0) {
    throw new Error('text_edit requires at least one edit')
  }

  for (const edit of edits) {
    const op = String(edit?.op || '').trim()
    if (!['replace', 'replace_all', 'insert_before', 'insert_after', 'delete', 'replace_regex', 'insert_before_regex', 'insert_after_regex', 'delete_regex', 'replace_lines', 'insert_at_line'].includes(op)) {
      throw new Error(`Unsupported text_edit op: ${op || '(empty)'}`)
    }

    let replaced = 0
    let addedLines = 0
    let removedLines = 0

    if (op === 'replace_lines') {
      const { startOffset, endOffset, startLine, endLine } = getLineRangeOffsets(nextContent, edit.start_line ?? edit.startLine, edit.end_line ?? edit.endLine ?? edit.start_line ?? edit.startLine)
      const replacement = String(edit.new_content ?? edit.content ?? '')
      const oldText = nextContent.slice(startOffset, endOffset)
      nextContent = nextContent.slice(0, startOffset) + replacement + nextContent.slice(endOffset)
      replaced = 1
      addedLines = countChangedLineUnits(replacement)
      removedLines = countChangedLineUnits(oldText)
      applied.push({ op, occurrences: replaced, start_line: startLine, end_line: endLine, added_lines: addedLines, removed_lines: removedLines })
      continue
    }

    if (op === 'insert_at_line') {
      const line = Math.max(1, Number.parseInt(edit.line ?? edit.line_number ?? edit.lineNumber ?? 1, 10) || 1)
      const offsets = getLineStartOffsets(nextContent)
      const insertAt = offsets[Math.min(line - 1, offsets.length)] ?? nextContent.length
      const insertion = String(edit.content ?? '')
      nextContent = nextContent.slice(0, insertAt) + insertion + nextContent.slice(insertAt)
      replaced = 1
      addedLines = countChangedLineUnits(insertion)
      applied.push({ op, occurrences: replaced, line, added_lines: addedLines, removed_lines: 0 })
      continue
    }

    if (op.endsWith('_regex') || op === 'replace_regex') {
      const regex = compileTextEditRegex(edit.pattern ?? edit.regex, edit.flags)
      const matches = [...nextContent.matchAll(regex)]
      const expected = Number.isInteger(edit.expected_occurrences) ? edit.expected_occurrences : null
      if (expected !== null && matches.length !== expected) {
        const error = new Error(`text_edit ${op} expected ${expected} regex matches but found ${matches.length}`)
        error.diagnostics = { pattern: String(edit.pattern ?? edit.regex ?? ''), match_count: matches.length }
        throw error
      }
      if (matches.length <= 0) {
        const error = new Error(`text_edit ${op} regex target not found`)
        error.diagnostics = { pattern: String(edit.pattern ?? edit.regex ?? ''), match_count: 0 }
        throw error
      }
      if (matches.length !== 1 && expected === null && op !== 'delete_regex') {
        const error = new Error(`text_edit ${op} found ${matches.length} regex matches; set expected_occurrences`)
        error.diagnostics = { pattern: String(edit.pattern ?? edit.regex ?? ''), match_count: matches.length }
        throw error
      }

      if (op === 'replace_regex') {
        const replacement = String(edit.new_content ?? '')
        nextContent = nextContent.replace(regex, replacement)
        replaced = matches.length
        addedLines = countChangedLineUnits(replacement) * matches.length
        removedLines = matches.reduce((sum, match) => sum + countChangedLineUnits(match[0]), 0)
      } else if (op === 'delete_regex') {
        nextContent = nextContent.replace(regex, '')
        replaced = matches.length
        removedLines = matches.reduce((sum, match) => sum + countChangedLineUnits(match[0]), 0)
      } else {
        const insertion = String(edit.content ?? '')
        const first = matches[0]
        const index = first.index ?? 0
        const insertAt = op === 'insert_before_regex' ? index : index + first[0].length
        nextContent = nextContent.slice(0, insertAt) + insertion + nextContent.slice(insertAt)
        replaced = 1
        addedLines = countChangedLineUnits(insertion)
      }
      applied.push({ op, occurrences: replaced, added_lines: addedLines, removed_lines: removedLines, match_mode: 'regex' })
      continue
    }

    const target = op.startsWith('insert_') ? String(edit.anchor ?? '') : String(edit.old_content ?? '')
    if (!target) throw new Error(`text_edit ${op} requires ${op.startsWith('insert_') ? 'anchor' : 'old_content'}`)
    const occurrences = countFlexibleOccurrences(nextContent, target)
    const expected = Number.isInteger(edit.expected_occurrences) ? edit.expected_occurrences : null
    if (expected !== null && occurrences !== expected) {
      const error = new Error(`text_edit ${op} expected ${expected} occurrences but found ${occurrences}`)
      error.diagnostics = buildTextEditDiagnostics(nextContent, target)
      throw error
    }
    if (occurrences <= 0) {
      const error = new Error(`text_edit ${op} target not found`)
      error.diagnostics = buildTextEditDiagnostics(nextContent, target)
      throw error
    }
    if ((op === 'replace' || op.startsWith('insert_') || op === 'delete') && occurrences !== 1 && expected === null) {
      const error = new Error(`text_edit ${op} found ${occurrences} occurrences; set expected_occurrences or use replace_all`)
      error.diagnostics = buildTextEditDiagnostics(nextContent, target)
      throw error
    }

    const range = findFlexibleTextRange(nextContent, target)
    if (!range && op !== 'replace_all') {
      const error = new Error(`text_edit ${op} target not found`)
      error.diagnostics = buildTextEditDiagnostics(nextContent, target)
      throw error
    }

    if (op === 'replace') {
      const replacement = String(edit.new_content ?? '')
      const oldText = nextContent.slice(range.start, range.end)
      nextContent = nextContent.slice(0, range.start) + replacement + nextContent.slice(range.end)
      replaced = 1
      addedLines = countChangedLineUnits(replacement)
      removedLines = countChangedLineUnits(oldText || target)
    } else if (op === 'replace_all') {
      const replacement = String(edit.new_content ?? '')
      nextContent = nextContent.split(target).join(replacement)
      replaced = occurrences
      addedLines = countChangedLineUnits(replacement) * occurrences
      removedLines = countChangedLineUnits(target) * occurrences
    } else if (op === 'delete') {
      nextContent = nextContent.slice(0, range.start) + nextContent.slice(range.end)
      replaced = 1
      removedLines = countChangedLineUnits(target)
    } else {
      const insertion = String(edit.content ?? '')
      const insertAt = op === 'insert_before' ? range.start : range.end
      nextContent = nextContent.slice(0, insertAt) + insertion + nextContent.slice(insertAt)
      replaced = 1
      addedLines = countChangedLineUnits(insertion)
    }

    applied.push({ op, occurrences: replaced, added_lines: addedLines, removed_lines: removedLines, match_mode: range?.mode || 'exact' })
  }

  return { content: nextContent, applied }
}

const TEXT_FILE_EXTENSIONS = new Set([
  '.txt', '.md', '.markdown', '.json', '.jsonc', '.js', '.jsx', '.ts', '.tsx',
  '.mjs', '.cjs', '.css', '.scss', '.sass', '.less', '.html', '.htm', '.xml',
  '.svg', '.vue', '.svelte', '.py', '.pyw', '.java', '.c', '.h', '.cpp', '.hpp',
  '.cs', '.go', '.rs', '.php', '.rb', '.swift', '.kt', '.kts', '.sh', '.bash',
  '.zsh', '.ps1', '.bat', '.cmd', '.yml', '.yaml', '.toml', '.ini', '.env',
  '.gitignore', '.dockerignore', '.editorconfig', '.sql', '.prisma', '.graphql',
  '.gql', '.csv', '.tsv', '.log'
])

const SOURCE_REWRITE_GUARD_EXTENSIONS = new Set([
  '.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs', '.css', '.scss', '.sass', '.less',
  '.html', '.htm', '.vue', '.svelte', '.py', '.java', '.cs', '.go', '.rs', '.php',
  '.rb', '.swift', '.kt', '.kts', '.sh', '.ps1', '.bat', '.cmd'
])

function shouldBlockFullSourceRewrite(filePath = '', oldContent = '', newContent = '', args = {}) {
  if (args.allow_full_rewrite === true || args.allowFullRewrite === true) return false
  const ext = path.extname(filePath).toLowerCase()
  if (!SOURCE_REWRITE_GUARD_EXTENSIONS.has(ext)) return false
  const oldLines = countLines(oldContent)
  const newLines = countLines(newContent)
  if (oldLines < 80 && newLines < 80) return false
  const oldLength = String(oldContent || '').length
  const newLength = String(newContent || '').length
  if (oldLength < 2000 && newLength < 2000) return false
  return true
}

const IMAGE_FILE_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp', '.ico', '.avif', '.tif', '.tiff'
])

function isLikelyTextBuffer(buffer) {
  if (!buffer || buffer.length === 0) return true
  if (buffer.includes(0)) return false

  const sample = buffer.subarray(0, Math.min(buffer.length, 4096))
  let suspicious = 0
  for (const byte of sample) {
    if (byte === 9 || byte === 10 || byte === 13) continue
    if (byte >= 32 && byte <= 126) continue
    if (byte >= 128) continue
    suspicious++
  }
  return suspicious / sample.length < 0.08
}

function normalizeLineRange(args = {}, totalLines = 0) {
  const startRaw = args.start_line ?? args.startLine
  const endRaw = args.end_line ?? args.endLine
  const startLine = Math.max(1, Number.parseInt(startRaw || 1, 10) || 1)
  const endLine = Math.max(startLine, Number.parseInt(endRaw || totalLines || startLine, 10) || totalLines || startLine)
  return {
    startLine: Math.min(startLine, Math.max(totalLines, 1)),
    endLine: Math.min(endLine, Math.max(totalLines, 1)),
    hasRange: startRaw !== undefined || endRaw !== undefined
  }
}

function clipTextByChars(text, maxChars) {
  const limit = Number.parseInt(maxChars, 10)
  if (!Number.isFinite(limit) || limit <= 0 || text.length <= limit) {
    return { text, truncated: false }
  }
  return {
    text: `${text.slice(0, Math.max(0, limit - 80))}\n...[truncated ${text.length - limit} chars; use start_line/end_line to read more]`,
    truncated: true
  }
}

module.exports = {
  countLines,
  countTextOccurrences,
  normalizeTextWithMap,
  findFlexibleTextRange,
  countFlexibleOccurrences,
  getLineStartOffsets,
  getLineRangeOffsets,
  compileTextEditRegex,
  buildTextEditDiagnostics,
  countChangedLineUnits,
  applyTextEditList,
  shouldBlockFullSourceRewrite,
  isLikelyTextBuffer,
  normalizeLineRange,
  clipTextByChars,
  TEXT_FILE_EXTENSIONS,
  SOURCE_REWRITE_GUARD_EXTENSIONS,
  IMAGE_FILE_EXTENSIONS
}
