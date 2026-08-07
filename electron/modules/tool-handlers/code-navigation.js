/**
 * Code navigation helpers for large source files.
 * Provides structure-first inspection without forcing a workflow gate.
 */

const fs = require('fs')
const path = require('path')
const { isInsideProject, toProjectRelative } = require('../path-utils')
const { isLikelyTextBuffer } = require('../text-edit-utils')
const { buildPathFailureResult } = require('./search')

const MAX_FILE_BYTES = 5 * 1024 * 1024
const SYMBOL_PREVIEW_CHARS = 160
const DEFAULT_OUTLINE_LIMIT = 80
const DEFAULT_SLICE_MAX_LINES = 260
const KEYWORDS = new Set([
  'if', 'for', 'while', 'switch', 'catch', 'function', 'return', 'else', 'do',
  'try', 'finally', 'class', 'new', 'typeof', 'await', 'async'
])

function clampInt(value, fallback, min, max) {
  const parsed = Number.parseInt(value, 10)
  if (!Number.isFinite(parsed)) return fallback
  return Math.max(min, Math.min(max, parsed))
}

function normalizePathForOutput(projectPath, targetPath) {
  return toProjectRelative(projectPath, targetPath).replace(/\\/g, '/')
}

function resolveSourceFile(args = {}, ctx = {}) {
  const requestedPath = String(args.path || args.file || '').trim()
  const projectPath = ctx.projectPath || ''
  if (!requestedPath) {
    return { success: false, error_type: 'missing_path', error: 'Missing file path.' }
  }

  const resolvedPath = ctx.resolvePath
    ? ctx.resolvePath(requestedPath)
    : path.resolve(projectPath || process.cwd(), requestedPath)

  if (projectPath && !isInsideProject(projectPath, resolvedPath)) {
    return {
      success: false,
      error_type: 'outside_project',
      error: 'code_navigate only inspects files inside the current project.',
      requested_path: requestedPath,
      resolved_path: resolvedPath,
      project_root: projectPath
    }
  }

  if (!fs.existsSync(resolvedPath)) {
    return buildPathFailureResult({
      requestedPath,
      resolvedPath,
      projectPath,
      kind: 'file'
    })
  }

  let stat
  try {
    stat = fs.statSync(resolvedPath)
  } catch (error) {
    return {
      success: false,
      error_type: 'stat_failed',
      error: error.message,
      requested_path: requestedPath,
      resolved_path: resolvedPath,
      project_root: projectPath
    }
  }

  if (!stat.isFile()) {
    return buildPathFailureResult({
      requestedPath,
      resolvedPath,
      projectPath,
      kind: 'file',
      errorType: 'not_a_file'
    })
  }
  if (stat.size > MAX_FILE_BYTES) {
    return {
      success: false,
      error_type: 'file_too_large',
      error: `File is too large for structural navigation: ${stat.size} bytes.`,
      requested_path: requestedPath,
      resolved_path: resolvedPath,
      max_bytes: MAX_FILE_BYTES
    }
  }

  const buffer = fs.readFileSync(resolvedPath)
  if (!isLikelyTextBuffer(buffer)) {
    return {
      success: false,
      error_type: 'binary_file',
      error: 'code_navigate only handles text source files.',
      requested_path: requestedPath,
      resolved_path: resolvedPath
    }
  }

  const content = buffer.toString('utf8')
  const lines = content.split(/\r\n|\r|\n/)
  return {
    success: true,
    requestedPath,
    filePath: resolvedPath,
    relativePath: normalizePathForOutput(projectPath, resolvedPath),
    content,
    lines,
    size: stat.size,
    ext: path.extname(resolvedPath).toLowerCase()
  }
}

function cleanPreview(line = '') {
  return String(line || '').trim().replace(/\s+/g, ' ').slice(0, SYMBOL_PREVIEW_CHARS)
}

function classifyLanguage(ext = '') {
  if (['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs'].includes(ext)) return 'javascript'
  if (['.py', '.pyw'].includes(ext)) return 'python'
  if (['.css', '.scss', '.less'].includes(ext)) return 'css'
  if (['.html', '.htm', '.vue', '.svelte'].includes(ext)) return 'markup'
  return 'generic'
}

function findMatchingBraceLine(lines, startIndex) {
  if (!String(lines[startIndex] || '').includes('{')) return startIndex + 1
  let depth = 0
  let started = false
  let inBlockComment = false
  let inString = null
  let escape = false

  for (let i = startIndex; i < lines.length; i += 1) {
    const line = lines[i]
    const scanStart = i === startIndex ? Math.max(0, line.lastIndexOf('{')) : 0
    let previousCodeChar = ''
    for (let j = scanStart; j < line.length; j += 1) {
      const ch = line[j]
      const next = line[j + 1]

      if (inBlockComment) {
        if (ch === '*' && next === '/') {
          inBlockComment = false
          j += 1
        }
        continue
      }

      if (inString) {
        if (escape) {
          escape = false
          continue
        }
        if (ch === '\\') {
          escape = true
          continue
        }
        if (ch === inString) inString = null
        continue
      }

      if (ch === '/' && next === '/') break
      if (ch === '/' && next === '*') {
        inBlockComment = true
        j += 1
        continue
      }
      if (ch === '/' && next && next !== '/' && isLikelyRegexStart(previousCodeChar, line, j)) {
        j = skipRegexLiteral(line, j)
        previousCodeChar = '/'
        continue
      }
      if (ch === '"' || ch === '\'' || ch === '`') {
        inString = ch
        continue
      }
      if (ch === '{') {
        depth += 1
        started = true
      } else if (ch === '}') {
        depth -= 1
        if (started && depth <= 0) return i + 1
      }
      if (!/\s/.test(ch)) previousCodeChar = ch
    }
  }
  return started ? lines.length : startIndex + 1
}

function isLikelyRegexStart(previousCodeChar, line, slashIndex) {
  if (!previousCodeChar) return true
  if ('=(:,[!&|?{};'.includes(previousCodeChar)) return true
  const prefix = line.slice(0, slashIndex).trim()
  return /\b(return|throw|case|delete|typeof|void|new|in|of|yield|await)$/.test(prefix)
}

function skipRegexLiteral(line, slashIndex) {
  let inClass = false
  let escape = false
  for (let i = slashIndex + 1; i < line.length; i += 1) {
    const ch = line[i]
    if (escape) {
      escape = false
      continue
    }
    if (ch === '\\') {
      escape = true
      continue
    }
    if (ch === '[') {
      inClass = true
      continue
    }
    if (ch === ']') {
      inClass = false
      continue
    }
    if (ch === '/' && !inClass) {
      while (/[a-z]/i.test(line[i + 1] || '')) i += 1
      return i
    }
  }
  return slashIndex
}

function findPythonBlockEnd(lines, startIndex) {
  const startIndent = (lines[startIndex].match(/^\s*/) || [''])[0].length
  let endIndex = startIndex
  for (let i = startIndex + 1; i < lines.length; i += 1) {
    const line = lines[i]
    if (!line.trim()) {
      endIndex = i
      continue
    }
    const indent = (line.match(/^\s*/) || [''])[0].length
    if (indent <= startIndent) break
    endIndex = i
  }
  return endIndex + 1
}

function pushSymbol(symbols, symbol) {
  if (!symbol || !symbol.name) return
  symbols.push({
    name: symbol.name,
    kind: symbol.kind || 'symbol',
    start_line: symbol.startLine,
    end_line: symbol.endLine || symbol.startLine,
    lines: Math.max(1, (symbol.endLine || symbol.startLine) - symbol.startLine + 1),
    exported: !!symbol.exported,
    preview: symbol.preview || ''
  })
}

function outlineJavaScript(lines) {
  const symbols = []
  const patterns = [
    { kind: 'class', regex: /^\s*(?:export\s+default\s+|export\s+)?class\s+([A-Za-z_$][\w$]*)\b/ },
    { kind: 'function', regex: /^\s*(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/ },
    { kind: 'function', regex: /^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?function\b/ },
    { kind: 'function', regex: /^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/ },
    { kind: 'object-method', regex: /^\s*([A-Za-z_$][\w$]*)\s*:\s*(?:async\s*)?(?:function\s*)?\([^)]*\)\s*(?:=>)?\s*\{/ },
    { kind: 'method', regex: /^\s*(?:async\s+)?([A-Za-z_$][\w$]*)\s*\([^;{}]*\)\s*\{/ }
  ]

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    for (const pattern of patterns) {
      const match = line.match(pattern.regex)
      if (!match || KEYWORDS.has(match[1])) continue
      const startLine = index + 1
      const endLine = findMatchingBraceLine(lines, index)
      pushSymbol(symbols, {
        name: match[1],
        kind: pattern.kind,
        startLine,
        endLine,
        exported: /\bexport\b/.test(line),
        preview: cleanPreview(line)
      })
      break
    }
  }
  return dedupeSymbols(symbols)
}

function outlinePython(lines) {
  const symbols = []
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    const match = line.match(/^\s*(async\s+def|def|class)\s+([A-Za-z_][\w]*)\b/)
    if (!match) continue
    const kind = match[1].includes('class') ? 'class' : 'function'
    pushSymbol(symbols, {
      name: match[2],
      kind,
      startLine: index + 1,
      endLine: findPythonBlockEnd(lines, index),
      preview: cleanPreview(line)
    })
  }
  return dedupeSymbols(symbols)
}

function outlineCss(lines) {
  const symbols = []
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    const match = line.match(/^\s*([^@{}][^{]{1,160})\s*\{/)
    if (!match) continue
    const name = match[1].trim()
    if (!name || name.includes(';')) continue
    pushSymbol(symbols, {
      name,
      kind: 'selector',
      startLine: index + 1,
      endLine: findMatchingBraceLine(lines, index),
      preview: cleanPreview(line)
    })
  }
  return dedupeSymbols(symbols)
}

function outlineMarkup(lines) {
  const symbols = []
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    const match = line.match(/<([A-Za-z][\w:-]*)([^>]*)>/)
    if (!match || match[1].startsWith('/')) continue
    const attrs = match[2] || ''
    const id = attrs.match(/\bid=["']([^"']+)["']/)
    const cls = attrs.match(/\bclass=["']([^"']+)["']/)
    if (!['script', 'style', 'template', 'section', 'main', 'header', 'footer', 'nav', 'div'].includes(match[1]) && !id && !cls) continue
    pushSymbol(symbols, {
      name: id ? `#${id[1]}` : cls ? `.${cls[1].split(/\s+/)[0]}` : match[1],
      kind: `tag:${match[1]}`,
      startLine: index + 1,
      endLine: index + 1,
      preview: cleanPreview(line)
    })
  }
  return dedupeSymbols(symbols)
}

function outlineGeneric(lines) {
  const symbols = []
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    const match = line.match(/^\s*(?:function|class|def)\s+([A-Za-z_$][\w$]*)\b/)
    if (!match) continue
    pushSymbol(symbols, {
      name: match[1],
      kind: 'symbol',
      startLine: index + 1,
      endLine: index + 1,
      preview: cleanPreview(line)
    })
  }
  return dedupeSymbols(symbols)
}

function dedupeSymbols(symbols) {
  const seen = new Set()
  return symbols.filter(symbol => {
    const key = `${symbol.name}:${symbol.kind}:${symbol.start_line}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function buildOutline(source) {
  const language = classifyLanguage(source.ext)
  if (language === 'javascript') return { language, symbols: outlineJavaScript(source.lines) }
  if (language === 'python') return { language, symbols: outlinePython(source.lines) }
  if (language === 'css') return { language, symbols: outlineCss(source.lines) }
  if (language === 'markup') return { language, symbols: outlineMarkup(source.lines) }
  return { language, symbols: outlineGeneric(source.lines) }
}

function scoreSymbol(symbol, query) {
  const name = String(symbol.name || '').toLowerCase()
  const needle = String(query || '').toLowerCase()
  if (!needle) return 0
  if (name === needle) return 100
  if (name.endsWith(needle) || name.startsWith(needle)) return 82
  if (name.includes(needle)) return 65
  if (String(symbol.preview || '').toLowerCase().includes(needle)) return 45
  return 0
}

function findSymbolMatches(source, query, limit) {
  const { language, symbols } = buildOutline(source)
  const structural = symbols
    .map(symbol => ({ ...symbol, score: scoreSymbol(symbol, query), match_type: 'definition' }))
    .filter(symbol => symbol.score > 0)

  const needle = String(query || '').trim()
  const needleLower = needle.toLowerCase()
  const lineHits = []
  if (needleLower) {
    for (let index = 0; index < source.lines.length && lineHits.length < limit; index += 1) {
      const text = source.lines[index]
      if (!text.toLowerCase().includes(needleLower)) continue
      const isDefinition = structural.some(symbol => symbol.start_line === index + 1)
      lineHits.push({
        name: needle,
        kind: isDefinition ? 'definition-line' : classifyLineHit(text),
        start_line: index + 1,
        end_line: index + 1,
        lines: 1,
        exported: /\bexport\b/.test(text),
        preview: cleanPreview(text),
        score: isDefinition ? 70 : 35,
        match_type: isDefinition ? 'definition' : 'reference'
      })
    }
  }

  const merged = [...structural, ...lineHits]
  const seen = new Set()
  return {
    language,
    matches: merged
      .filter(item => {
        const key = `${item.match_type}:${item.start_line}:${item.preview}`
        if (seen.has(key)) return false
        seen.add(key)
        return true
      })
      .sort((a, b) => b.score - a.score || a.start_line - b.start_line)
      .slice(0, limit)
  }
}

function classifyLineHit(line = '') {
  if (/\b(ipcMain|ipcRenderer|handle|invoke|send)\b/.test(line)) return 'ipc-hit'
  if (/\baddEventListener\b|querySelector|getElementById/.test(line)) return 'dom-hit'
  if (/\brequire\s*\(|\bimport\b/.test(line)) return 'import-hit'
  if (/\bfunction\b|=>|class\s+/.test(line)) return 'code-hit'
  return 'text-hit'
}

function pickSymbol(source, args) {
  const symbolQuery = String(args.symbol || args.query || '').trim()
  const requestedLine = args.line || args.start_line || args.startLine
  const outline = buildOutline(source)
  if (requestedLine) {
    const line = clampInt(requestedLine, 1, 1, source.lines.length)
    const containing = outline.symbols
      .filter(symbol => symbol.start_line <= line && symbol.end_line >= line)
      .sort((a, b) => (a.end_line - a.start_line) - (b.end_line - b.start_line))[0]
    if (containing) return { language: outline.language, symbol: containing, reason: 'contains_line' }
    return { language: outline.language, symbol: null, reason: 'line_window', line }
  }

  if (!symbolQuery) return { language: outline.language, symbol: null, reason: 'missing_symbol' }

  const ranked = outline.symbols
    .map(symbol => ({ ...symbol, score: scoreSymbol(symbol, symbolQuery) }))
    .filter(symbol => symbol.score > 0)
    .sort((a, b) => b.score - a.score || a.start_line - b.start_line)
  return { language: outline.language, symbol: ranked[0] || null, reason: ranked[0] ? 'symbol_match' : 'not_found' }
}

function formatSlice(lines, startLine, endLine, maxLines) {
  const safeStart = Math.max(1, startLine)
  const safeEnd = Math.min(lines.length, endLine)
  const clippedEnd = Math.min(safeEnd, safeStart + maxLines - 1)
  return {
    start_line: safeStart,
    end_line: clippedEnd,
    requested_end_line: safeEnd,
    truncated: clippedEnd < safeEnd,
    content: lines
      .slice(safeStart - 1, clippedEnd)
      .map((line, index) => `${safeStart + index}: ${line}`)
      .join('\n')
  }
}

async function codeNavigate(args = {}, ctx = {}) {
  const action = String(args.action || 'outline_file').trim()
  const source = resolveSourceFile(args, ctx)
  if (!source.success) return source

  if (action === 'outline_file') {
    const limit = clampInt(args.limit || args.max_results || args.maxResults, DEFAULT_OUTLINE_LIMIT, 1, 300)
    const minLines = clampInt(args.min_lines || args.minLines, 1, 1, 10000)
    const outline = buildOutline(source)
    const filtered = outline.symbols.filter(symbol => symbol.lines >= minLines)
    const topLargeSymbols = [...outline.symbols]
      .sort((a, b) => b.lines - a.lines)
      .slice(0, 8)
      .filter(symbol => symbol.lines >= 80)
    return {
      success: true,
      action,
      path: source.relativePath,
      absolute_path: source.filePath,
      language: outline.language,
      line_count: source.lines.length,
      size_bytes: source.size,
      symbol_count: outline.symbols.length,
      returned: Math.min(filtered.length, limit),
      truncated: filtered.length > limit,
      symbols: filtered.slice(0, limit),
      large_symbols: topLargeSymbols
    }
  }

  if (action === 'find_symbol') {
    const query = String(args.symbol || args.query || '').trim()
    if (!query) return { success: false, error_type: 'missing_symbol', error: 'Missing symbol/query.', path: source.relativePath }
    const limit = clampInt(args.limit || args.max_results || args.maxResults, 30, 1, 120)
    const result = findSymbolMatches(source, query, limit)
    return {
      success: true,
      action,
      path: source.relativePath,
      absolute_path: source.filePath,
      language: result.language,
      query,
      matches: result.matches,
      count: result.matches.length,
      line_count: source.lines.length
    }
  }

  if (action === 'slice_by_symbol') {
    const picked = pickSymbol(source, args)
    if (!picked.symbol && picked.reason === 'line_window') {
      const contextLines = clampInt(args.context_lines || args.contextLines, 30, 0, 200)
      const maxLines = clampInt(args.max_lines || args.maxLines, DEFAULT_SLICE_MAX_LINES, 20, 1000)
      const startLine = Math.max(1, picked.line - contextLines)
      const endLine = Math.min(source.lines.length, picked.line + contextLines)
      const slice = formatSlice(source.lines, startLine, endLine, maxLines)
      return {
        success: true,
        action,
        path: source.relativePath,
        absolute_path: source.filePath,
        language: picked.language,
        symbol: {
          name: `line:${picked.line}`,
          kind: 'line-window',
          start_line: slice.start_line,
          end_line: slice.end_line,
          lines: slice.end_line - slice.start_line + 1,
          exported: false,
          preview: cleanPreview(source.lines[picked.line - 1])
        },
        reason: 'line_window',
        requested_line: picked.line,
        ...slice
      }
    }
    if (!picked.symbol) {
      return {
        success: false,
        error_type: picked.reason,
        error: picked.reason === 'missing_symbol' ? 'Missing symbol/query or line.' : 'Symbol not found.',
        path: source.relativePath,
        language: picked.language,
        available_symbols: buildOutline(source).symbols.slice(0, 30)
      }
    }
    const contextLines = clampInt(args.context_lines || args.contextLines, 0, 0, 30)
    const maxLines = clampInt(args.max_lines || args.maxLines, DEFAULT_SLICE_MAX_LINES, 20, 1000)
    const slice = formatSlice(
      source.lines,
      picked.symbol.start_line - contextLines,
      picked.symbol.end_line + contextLines,
      maxLines
    )
    return {
      success: true,
      action,
      path: source.relativePath,
      absolute_path: source.filePath,
      language: picked.language,
      symbol: picked.symbol,
      reason: picked.reason,
      ...slice
    }
  }

  return {
    success: false,
    error_type: 'unknown_action',
    error: `Unknown code_navigate action: ${action}`,
    allowed_actions: ['outline_file', 'find_symbol', 'slice_by_symbol']
  }
}

module.exports = {
  handlers: {
    code_navigate: codeNavigate
  },
  buildOutline,
  findSymbolMatches,
  pickSymbol
}
