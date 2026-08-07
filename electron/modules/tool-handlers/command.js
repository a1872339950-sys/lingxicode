/**
 * 命令执行工具处理器
 * 包含：shell_run, run_command, terminal_run, terminal_status, terminal_stop 工具
 */

const { exec, execFile } = require('child_process')
const { promisify } = require('util')
const path = require('path')
const fs = require('fs')
const config = require('../config')
const projects = require('../projects')
const terminalSessions = require('../terminal-sessions')
const changeSessions = require('../change-sessions')
const { safelyRecordChange } = require('./file-ops')
const { sendThinkingEvent } = require('../thinking-event-sender')
const { getRgPath } = require('../rg-path')
const { runCommandInRunner } = require('../command-runner-client')

const execFileAsync = promisify(execFile)
const TERMINAL_AGENT_STATUS_INTERVAL_MS = 60 * 1000
// Short commands still run in a child process, but their captured output must not
// be able to consume enough memory to stall the Electron process.
const RUN_COMMAND_MAX_BUFFER = 2 * 1024 * 1024
const terminalAgentStatusReads = new Map()
const NODE_CHECK_EXTENSIONS = new Set(['.js', '.mjs', '.cjs'])
const SEARCH_IGNORE_DIRS = new Set([
  '.git', '.hg', '.svn', 'node_modules', 'dist', 'build', 'out', 'release', 'releases',
  '.next', '.nuxt', '.vite', '.turbo', '.cache', 'coverage', 'tmp', 'temp', '.tmp',
  '.temp', 'logs', 'log', '__pycache__', '.pytest_cache', '.gradle', 'target',
  'vendor', 'packages-cache', 'codemap'
])
const SEARCH_TEXT_EXTENSIONS = new Set([
  '.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs', '.json', '.html', '.css', '.scss',
  '.less', '.vue', '.svelte', '.py', '.md', '.mdx', '.txt', '.yml', '.yaml', '.xml',
  '.java', '.go', '.rs', '.cs', '.cpp', '.cc', '.c', '.h', '.hpp', '.php', '.rb',
  '.swift', '.kt', '.kts', '.sql', '.sh', '.bat', '.ps1', '.toml', '.ini'
])

function stripBellCharacters(text = '') {
  return String(text ?? '').replace(/\x07/g, '')
}

function isBenignNoMatchCommand(command = '', output = {}) {
  const text = String(command || '').trim().toLowerCase()
  const stderr = String(output.stderr || '').trim()
  const errorText = String(output.error || '')
  const code = output.code
  const isNoMatchExit = code === 1 || /exited with code 1|exit code 1/i.test(errorText)
  if (!isNoMatchExit) return false
  if (/^(where|where\.exe)\b/.test(text)) {
    return !stderr || /could not find files|given pattern|找不到|无法找到|找不到文件/i.test(stderr)
  }
  if (stderr) return false
  if (/^(findstr|findstr\.exe)\b/.test(text)) return true
  if (/^(rg|rg\.exe|ripgrep)\b/.test(text)) return true
  if (/\b(rg|rg\.exe|ripgrep)\b/.test(text)) return true
  if (/^(grep|grep\.exe)\b/.test(text)) return true
  return false
}

function unquoteCommandToken(value = '') {
  return String(value || '').trim().replace(/^["']|["']$/g, '')
}

function extractNodeCheckTargets(command = '') {
  const text = String(command || '')
  const targets = []
  const pattern = /\bnode(?:\.exe)?(?:\s+--[^\s"'&|;]+)*\s+--check\s+("([^"]+)"|'([^']+)'|([^\s&|;]+))/ig
  for (const match of text.matchAll(pattern)) {
    const target = unquoteCommandToken(match[2] || match[3] || match[4] || '')
    if (target && !target.startsWith('-')) targets.push(target)
  }
  return targets
}

function buildWrongNodeCheckResult(command = '', cwd = '') {
  const targets = extractNodeCheckTargets(command)
  const invalidTargets = targets
    .map(target => ({ target, ext: path.extname(target).toLowerCase() }))
    .filter(item => item.ext && !NODE_CHECK_EXTENSIONS.has(item.ext))
  if (!invalidTargets.length) return null

  return {
    success: false,
    error_type: 'wrong_verification_tool',
    command,
    cwd,
    invalid_targets: invalidTargets,
    message: 'node --check only validates JavaScript/CommonJS/ESM files. Do not use it for HTML, CSS, JSON, Markdown, or other file types.',
    recommended_tool: {
      name: 'check_syntax',
      reason: 'check_syntax routes by file extension and supports HTML/CSS/JSON/JS without mixing validators.',
      args: invalidTargets.length === 1 ? { path: invalidTargets[0].target } : { paths: invalidTargets.map(item => item.target) }
    },
    next_action: 'Call check_syntax for these files, or run node --check only on .js/.mjs/.cjs files.'
  }
}

function buildMissingExecutableRecovery(command = '', output = {}) {
  const text = String(command || '').trim()
  const stderr = `${output.stderr || ''}\n${output.error || ''}`
  const match = text.match(/^\s*(rg|rg\.exe|ripgrep|grep|grep\.exe)\b/i)
  if (!match) return null
  if (!/not recognized|is not recognized|不是内部或外部命令|无法识别|command not found|ENOENT/i.test(stderr)) return null
  const toolName = match[1].toLowerCase().replace(/\.exe$/, '')
  return {
    reason: 'search_executable_missing',
    missing_command: toolName,
    do_not_repeat: `Do not repeat ${toolName} in this environment unless availability has changed.`,
    recommended_next_actions: process.platform === 'win32'
      ? [
          'Use grep_code or search_project for project-aware search; do not switch to findstr on Windows Chinese paths.',
          'If shell_run is used with rg, the tool will route it through bundled rg or an internal JS fallback automatically.',
          'After candidates appear, read only the small matching ranges.'
        ]
      : [
          'Use grep -RIn "termA|termB" <dirs> as a local fallback.',
          'Use search_project or grep_code for project-aware search when command-line search tools are unavailable.',
          'After candidates appear, read only the small matching ranges.'
        ]
  }
}

function extractSearchTerms(command = '') {
  const text = String(command || '')
  const terms = []
  for (const match of text.matchAll(/["']([^"'|]{2,120})["']/g)) {
    terms.push(match[1].trim())
  }
  const rg = text.match(/\b(?:rg|grep|findstr|select-string)\b[^\n]*?\s([A-Za-z0-9_$.\-\u4e00-\u9fa5]{2,80})(?:\s|$)/i)
  if (rg) terms.push(rg[1].trim())
  return [...new Set(terms
    .map(term => String(term || '').trim())
    .filter(term => term && !term.startsWith('-') && !/^(?:--?\w+)$/.test(term))
  )].slice(0, 8)
}

function buildSearchRecovery(command = '') {
  const searchedTerms = extractSearchTerms(command)
  return {
    reason: 'search_returned_no_matches',
    searched_terms: searchedTerms,
    do_not_repeat: searchedTerms.length
      ? `Do not repeat the same exact search for: ${searchedTerms.join(', ')}.`
      : 'Do not repeat the same no-match command without changing the search strategy.',
    recommended_next_actions: [
      'Combine user-visible text, DOM id/class, function name, IPC/API name, state field, and likely file name into one broader rg pattern.',
      'Use grep_code or search_project when a literal shell search misses twice.',
      'After candidates appear, read only the small matching ranges instead of rereading large entry files.'
    ],
    example: searchedTerms.length >= 2
      ? `rg -n "${searchedTerms.map(term => term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')}" frontend electron scripts`
      : 'rg -n "visibleText|domId|functionName|ipcChannel|stateField" frontend electron scripts'
  }
}

function prepareRunCommand(command = '') {
  const rawCommand = String(command || '')
  if (process.platform !== 'win32') return rawCommand

  const trimmed = rawCommand.trim()
  const PS_UTF8_PREFIX = "$ProgressPreference='SilentlyContinue';[Console]::OutputEncoding=New-Object System.Text.UTF8Encoding $false;$OutputEncoding=New-Object System.Text.UTF8Encoding $false"
  const psMatch = trimmed.match(/^(powershell(?:\.exe)?|pwsh(?:\.exe)?)\s+((?:-[Nn]o[Ll]ogo\s+)?(?:-[Nn]o[Pp]rofile\s+)?(?:-[Ee]xecution[Pp]olicy\s+\w+\s+)?-[Cc]ommand\s+")(.*)$/s)
  if (psMatch) {
    if (psMatch[3].includes('OutputEncoding')) return rawCommand
    return `${psMatch[1]} ${psMatch[2]}${PS_UTF8_PREFIX};${psMatch[3]}`
  }

  const looksLikePowerShell = /\b(Get-Content|Set-Content|Add-Content|Select-String|Select-Object|Where-Object|ForEach-Object|Get-ChildItem|Measure-Object|Out-File|New-Item|Remove-Item|Move-Item|Copy-Item|Rename-Item|Start-Process)\b/i.test(trimmed) ||
    /(^|[;&|\s])\$\w+/.test(trimmed) ||
    /\|\s*(select|where|foreach|sort|measure|format|out)-/i.test(trimmed)
  if (looksLikePowerShell) {
    const script = `${PS_UTF8_PREFIX};${rawCommand}`
    const encoded = Buffer.from(script, 'utf16le').toString('base64')
    return `powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -EncodedCommand ${encoded}`
  }

  if (/^(cmd|cmd\.exe)\b/i.test(trimmed) || /^chcp\s+65001\b/i.test(trimmed)) return rawCommand
  return `chcp 65001 >nul && ${rawCommand}`
}

function splitUnquotedPipes(command = '') {
  const text = String(command || '')
  const parts = []
  let current = ''
  let quote = null
  let escape = false
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]
    if (escape) {
      current += ch
      escape = false
      continue
    }
    if (ch === '\\' && quote) {
      current += ch
      escape = true
      continue
    }
    if ((ch === '"' || ch === "'")) {
      if (!quote) quote = ch
      else if (quote === ch) quote = null
      current += ch
      continue
    }
    if (ch === '|' && !quote) {
      parts.push(current.trim())
      current = ''
      continue
    }
    current += ch
  }
  parts.push(current.trim())
  return { parts: parts.filter(Boolean), closed: !quote }
}

function splitUnquotedDoubleAmpersand(command = '') {
  const text = String(command || '')
  const parts = []
  let current = ''
  let quote = null
  let escape = false
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]
    const next = text[i + 1]
    if (escape) {
      current += ch
      escape = false
      continue
    }
    if (ch === '\\' && quote && (next === quote || next === '\\')) {
      current += ch
      escape = true
      continue
    }
    if (ch === '"' || ch === "'") {
      if (!quote) quote = ch
      else if (quote === ch) quote = null
      current += ch
      continue
    }
    if (!quote && ch === '&' && next === '&') {
      parts.push(current.trim())
      current = ''
      i += 1
      continue
    }
    current += ch
  }
  parts.push(current.trim())
  return { parts: parts.filter(Boolean), closed: !quote }
}

function stripNullRedirections(command = '') {
  return String(command || '')
    .replace(/\s+(?:[12])?>\s*(?:nul|NUL|\/dev\/null)(?=\s|$)/g, '')
    .trim()
}

function isRgExecutableToken(token = '') {
  const normalized = path.basename(String(token || '').trim()).toLowerCase().replace(/\.exe$/, '')
  return normalized === 'rg' || normalized === 'ripgrep'
}

function parseCdSegment(segment = '') {
  const parsed = tokenizeShellLike(segment)
  if (!parsed.closed || !parsed.tokens.length) return null
  const first = String(parsed.tokens[0] || '').toLowerCase()
  if (first !== 'cd' && first !== 'chdir') return null
  const args = parsed.tokens.slice(1).filter(token => !/^\/d$/i.test(token))
  if (!args.length) return null
  return args[0]
}

function normalizeRgArgs(args = []) {
  const normalized = []
  for (let i = 0; i < args.length; i += 1) {
    const token = String(args[i] || '')
    if (!token || /^(?:[12])?>\s*(?:nul|NUL|\/dev\/null)$/i.test(token)) continue

    const includeEq = token.match(/^--include=(.+)$/i)
    if (includeEq) {
      normalized.push('-g', includeEq[1])
      continue
    }
    if (/^--include$/i.test(token)) {
      const pattern = args[i + 1]
      if (pattern) {
        normalized.push('-g', String(pattern))
        i += 1
      }
      continue
    }

    const excludeEq = token.match(/^--exclude=(.+)$/i)
    if (excludeEq) {
      normalized.push('-g', `!${excludeEq[1]}`)
      continue
    }
    if (/^--exclude$/i.test(token)) {
      const pattern = args[i + 1]
      if (pattern) {
        normalized.push('-g', `!${String(pattern)}`)
        i += 1
      }
      continue
    }

    normalized.push(token)
  }
  return normalized
}

function getRgSearchPathIndexes(args = []) {
  const indexes = []
  const optionsWithValue = new Set([
    '-g', '--glob', '-e', '--regexp', '-f', '--file', '--type', '-t', '--type-not', '-T',
    '--encoding', '--context', '-C', '--after-context', '-A', '--before-context', '-B',
    '--max-count', '-m', '--max-depth', '--threads', '-j', '--sort', '--sortr', '--path-separator'
  ])
  let skipNext = false
  let patternProvidedByOption = false
  let consumedPatternArg = false
  for (let i = 0; i < args.length; i += 1) {
    const token = String(args[i] || '')
    if (skipNext) {
      skipNext = false
      continue
    }
    if (token === '-e' || token === '--regexp' || token === '-f' || token === '--file') {
      patternProvidedByOption = true
      skipNext = true
      continue
    }
    if (optionsWithValue.has(token)) {
      skipNext = true
      continue
    }
    if (!token || token.startsWith('-')) continue
    if (!patternProvidedByOption && !consumedPatternArg) {
      consumedPatternArg = true
      continue
    }
    if (/[\\/]/.test(token)) indexes.push(i)
  }
  return indexes
}

function resolveExistingSearchPath(candidate = '', cwd = '') {
  const raw = String(candidate || '').trim()
  if (!raw) return null
  const absolute = path.isAbsolute(raw) ? raw : path.resolve(cwd || process.cwd(), raw)
  if (fs.existsSync(absolute)) return raw

  const normalized = raw.replace(/[\\/]+$/g, '')
  const parts = normalized.split(/[\\/]+/).filter(Boolean)
  const candidates = []
  if (parts.length > 1) candidates.push(parts.slice(1).join(path.sep))
  if (parts.length > 1) candidates.push(parts[parts.length - 1])

  for (const item of candidates) {
    if (!item) continue
    const resolved = path.resolve(cwd || process.cwd(), item)
    if (fs.existsSync(resolved)) return item
  }
  return null
}

function repairRgSearchPaths(args = [], cwd = '') {
  const repairedArgs = [...args]
  const repairs = []
  for (const index of getRgSearchPathIndexes(args)) {
    const original = String(args[index] || '')
    const resolved = resolveExistingSearchPath(original, cwd)
    if (resolved && resolved !== original) {
      repairedArgs[index] = resolved
      repairs.push({ from: original, to: resolved })
    }
  }
  return {
    args: repairedArgs,
    repairs,
    repaired: repairs.length > 0
  }
}

function normalizeLeadingShellCwd(command = '', cwd = '') {
  const split = splitUnquotedDoubleAmpersand(command)
  if (!split.closed || split.parts.length < 2) {
    return { command: String(command || ''), cwd, changed: false }
  }

  let effectiveCwd = cwd
  let changed = false
  let startIndex = 0
  for (; startIndex < split.parts.length; startIndex += 1) {
    const segment = stripNullRedirections(split.parts[startIndex])
    if (!segment) {
      changed = true
      continue
    }
    if (/^chcp\s+65001\b/i.test(segment)) {
      changed = true
      continue
    }
    const cdTarget = parseCdSegment(segment)
    if (cdTarget) {
      effectiveCwd = path.resolve(effectiveCwd || process.cwd(), cdTarget)
      changed = true
      continue
    }
    break
  }

  if (!changed || startIndex <= 0 || startIndex >= split.parts.length) {
    return { command: String(command || ''), cwd, changed: false }
  }

  return {
    command: split.parts.slice(startIndex).join(' && '),
    cwd: effectiveCwd,
    changed: true
  }
}

function globToRegExp(pattern = '') {
  const normalized = String(pattern || '').replace(/\\/g, '/').replace(/^\.\/+/, '')
  let source = ''
  for (let i = 0; i < normalized.length; i += 1) {
    const ch = normalized[i]
    const next = normalized[i + 1]
    if (ch === '*') {
      if (next === '*') {
        const after = normalized[i + 2]
        source += after === '/' ? '(?:.*\\/)?' : '.*'
        if (after === '/') i += 2
        else i += 1
      } else {
        source += '[^/]*'
      }
    } else if (ch === '?') {
      source += '[^/]'
    } else {
      source += ch.replace(/[|\\{}()[\]^$+?.]/g, '\\$&')
    }
  }
  return new RegExp(`^${source}$`, 'i')
}

function parseRgFallbackSpec(args = []) {
  const globs = []
  const patterns = []
  const nonOptions = []
  let caseInsensitive = false
  let listFiles = false
  let maxMatches = 1000
  const optionsWithValue = new Set([
    '-g', '--glob', '-e', '--regexp', '-f', '--file', '--type', '-t', '--type-not', '-T',
    '--encoding', '--context', '-C', '--after-context', '-A', '--before-context', '-B',
    '--max-count', '-m', '--max-depth', '--threads', '-j', '--sort', '--sortr', '--path-separator'
  ])
  for (let i = 0; i < args.length; i += 1) {
    const token = String(args[i] || '')
    if (!token) continue
    if (token === '-i' || token === '--ignore-case') {
      caseInsensitive = true
      continue
    }
    if (token === '-l' || token === '--files-with-matches') {
      listFiles = true
      continue
    }
    if (token === '-g' || token === '--glob') {
      if (args[i + 1]) globs.push(String(args[i + 1]))
      i += 1
      continue
    }
    if (token === '-e' || token === '--regexp') {
      if (args[i + 1]) patterns.push(String(args[i + 1]))
      i += 1
      continue
    }
    if (token === '-m' || token === '--max-count') {
      maxMatches = Math.max(1, Math.min(5000, Number(args[i + 1]) || maxMatches))
      i += 1
      continue
    }
    if (optionsWithValue.has(token)) {
      i += 1
      continue
    }
    if (token.startsWith('-')) continue
    nonOptions.push(token)
  }

  const pattern = patterns.join('|') || nonOptions.shift() || ''
  return {
    pattern,
    paths: nonOptions.length ? nonOptions : ['.'],
    globs,
    caseInsensitive,
    listFiles,
    maxMatches
  }
}

function shouldIncludeFallbackSearchFile(relativePath = '', globs = []) {
  const normalized = String(relativePath || '').replace(/\\/g, '/')
  const basename = path.basename(normalized)
  const ext = path.extname(normalized).toLowerCase()
  if (!SEARCH_TEXT_EXTENSIONS.has(ext)) return false

  const positive = []
  const negative = []
  for (const glob of globs) {
    const value = String(glob || '').trim()
    if (!value) continue
    if (value.startsWith('!')) negative.push(value.slice(1))
    else positive.push(value)
  }
  const matches = (glob) => {
    const regex = globToRegExp(glob)
    return regex.test(normalized) || regex.test(basename)
  }
  if (negative.some(matches)) return false
  if (positive.length && !positive.some(matches)) return false
  return true
}

function buildFallbackMatcher(pattern = '', caseInsensitive = false) {
  try {
    return new RegExp(pattern, caseInsensitive ? 'i' : '')
  } catch {
    const rawTerms = String(pattern || '')
      .split('|')
      .map(term => term.trim())
      .filter(term => term && !/^\?+$/.test(term))
    const terms = rawTerms.length ? rawTerms : [String(pattern || '')]
    const normalizedTerms = caseInsensitive ? terms.map(term => term.toLowerCase()) : terms
    return {
      test: (value) => {
        const haystack = caseInsensitive ? String(value || '').toLowerCase() : String(value || '')
        return normalizedTerms.some(term => haystack.includes(term))
      }
    }
  }
}

function runInternalRgFallback(parsed = {}, cwd = '') {
  const spec = parseRgFallbackSpec(parsed.rgArgs || [])
  if (!spec.pattern) return null
  const matcher = buildFallbackMatcher(spec.pattern, spec.caseInsensitive)
  const outputs = []
  const seenFiles = new Set()
  const roots = spec.paths
    .map(item => path.isAbsolute(item) ? item : path.resolve(cwd || process.cwd(), item))
    .filter(item => item && fs.existsSync(item))
  const stack = roots.length ? roots : [cwd || process.cwd()]

  while (stack.length && outputs.length < spec.maxMatches) {
    const current = stack.pop()
    let stat
    try {
      stat = fs.statSync(current)
    } catch {
      continue
    }
    if (stat.isDirectory()) {
      const name = path.basename(current)
      if (SEARCH_IGNORE_DIRS.has(name)) continue
      let entries = []
      try {
        entries = fs.readdirSync(current, { withFileTypes: true })
      } catch {
        continue
      }
      for (let i = entries.length - 1; i >= 0; i -= 1) {
        const entry = entries[i]
        if (!entry || entry.isSymbolicLink?.()) continue
        stack.push(path.join(current, entry.name))
      }
      continue
    }
    if (!stat.isFile() || stat.size > 1024 * 1024) continue
    const relativePath = path.relative(cwd || process.cwd(), current).replace(/\\/g, '/')
    if (!shouldIncludeFallbackSearchFile(relativePath, spec.globs)) continue
    let content = ''
    try {
      content = fs.readFileSync(current, 'utf8')
    } catch {
      continue
    }
    const lines = content.split(/\r\n|\r|\n/)
    for (let lineIndex = 0; lineIndex < lines.length && outputs.length < spec.maxMatches; lineIndex += 1) {
      if (!matcher.test(lines[lineIndex])) continue
      if (spec.listFiles) {
        if (!seenFiles.has(relativePath)) {
          seenFiles.add(relativePath)
          outputs.push(relativePath)
        }
        break
      }
      outputs.push(`${relativePath}:${lineIndex + 1}:${lines[lineIndex]}`)
    }
  }

  return {
    stdout: outputs.join('\n'),
    noMatches: outputs.length === 0
  }
}

function unwrapRgShellCommand(command = '', cwd = '') {
  const split = splitUnquotedDoubleAmpersand(command)
  if (!split.closed || !split.parts.length) return null

  let effectiveCwd = cwd
  let rgCommand = ''
  let shellPrefixRemoved = false
  let trailingShellIgnored = false

  for (let i = 0; i < split.parts.length; i += 1) {
    const segment = stripNullRedirections(split.parts[i])
    if (!segment) {
      shellPrefixRemoved = true
      continue
    }
    if (/^chcp\s+65001\b/i.test(segment)) {
      shellPrefixRemoved = true
      continue
    }
    const cdTarget = parseCdSegment(segment)
    if (cdTarget && !rgCommand) {
      effectiveCwd = path.resolve(effectiveCwd || process.cwd(), cdTarget)
      shellPrefixRemoved = true
      continue
    }

    const tokens = tokenizeShellLike(segment)
    if (tokens.closed && tokens.tokens.length && isRgExecutableToken(tokens.tokens[0])) {
      rgCommand = segment
      trailingShellIgnored = i < split.parts.length - 1
      break
    }
  }

  if (!rgCommand) {
    const single = stripNullRedirections(command)
    const tokens = tokenizeShellLike(single)
    if (!tokens.closed || !tokens.tokens.length || !isRgExecutableToken(tokens.tokens[0])) return null
    rgCommand = single
  }

  return {
    command: rgCommand,
    cwd: effectiveCwd,
    shellPrefixRemoved,
    trailingShellIgnored
  }
}

function tokenizeShellLike(command = '') {
  const text = String(command || '')
  const tokens = []
  let current = ''
  let quote = null
  let escape = false
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]
    const next = text[i + 1]
    if (escape) {
      current += ch
      escape = false
      continue
    }
    if (ch === '\\' && quote && (next === quote || next === '\\')) {
      escape = true
      continue
    }
    if ((ch === '"' || ch === "'")) {
      if (!quote) {
        quote = ch
        continue
      }
      if (quote === ch) {
        quote = null
        continue
      }
    }
    if (!quote && /\s/.test(ch)) {
      if (current) {
        tokens.push(current)
        current = ''
      }
      continue
    }
    current += ch
  }
  if (escape) current += '\\'
  if (current) tokens.push(current)
  return { tokens, closed: !quote }
}

function hasUnsafeRgShellControl(command = '') {
  const text = String(command || '')
  let quote = null
  let escape = false
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]
    const next = text[i + 1]
    if (escape) {
      escape = false
      continue
    }
    if (ch === '\\' && quote && (next === quote || next === '\\')) {
      escape = true
      continue
    }
    if (ch === '"' || ch === "'") {
      if (!quote) quote = ch
      else if (quote === ch) quote = null
      continue
    }
    if (!quote && /[<>&]/.test(ch)) return true
  }
  return false
}

function parseHeadPipeLimit(pipeCommand = '') {
  const text = String(pipeCommand || '').trim()
  if (!text) return null
  let match = text.match(/^head(?:\.exe)?\s+-(\d{1,5})$/i)
  if (match) return Math.max(1, Math.min(5000, Number(match[1]) || 80))
  match = text.match(/^head(?:\.exe)?\s+-n\s+(\d{1,5})$/i)
  if (match) return Math.max(1, Math.min(5000, Number(match[1]) || 80))
  match = text.match(/^Select-Object\s+-First\s+(\d{1,5})$/i)
  if (match) return Math.max(1, Math.min(5000, Number(match[1]) || 80))
  return null
}

function parseSafeRgCommand(command = '', cwd = '') {
  const unwrapped = unwrapRgShellCommand(command, cwd)
  const trimmed = String(unwrapped?.command || command || '').trim()
  if (!trimmed) return null
  const pipeSplit = splitUnquotedPipes(trimmed)
  if (!pipeSplit.closed || pipeSplit.parts.length < 1 || pipeSplit.parts.length > 2) return null
  const limit = pipeSplit.parts.length === 2 ? parseHeadPipeLimit(pipeSplit.parts[1]) : null
  if (pipeSplit.parts.length === 2 && !limit) return null
  const rgCommand = pipeSplit.parts[0]
  if (hasUnsafeRgShellControl(rgCommand)) return null
  const parsed = tokenizeShellLike(rgCommand)
  if (!parsed.closed || parsed.tokens.length < 2) return null
  const executable = String(parsed.tokens[0] || '').toLowerCase().replace(/\.exe$/, '')
  if (!['rg', 'ripgrep'].includes(executable)) return null
  return {
    rgArgs: normalizeRgArgs(parsed.tokens.slice(1)),
    cwd: unwrapped?.cwd || cwd,
    limit,
    pipeRemoved: pipeSplit.parts.length === 2,
    shellPrefixRemoved: !!unwrapped?.shellPrefixRemoved,
    trailingShellIgnored: !!unwrapped?.trailingShellIgnored
  }
}

async function executeSafeRgCommand(originalCommand = '', cwd = '', timeoutMs = 30000) {
  const parsed = parseSafeRgCommand(originalCommand, cwd)
  if (!parsed) return null
  const effectiveCwd = parsed.cwd || cwd
  const pathRepair = repairRgSearchPaths(parsed.rgArgs, effectiveCwd)
  const rgArgs = pathRepair.args
  try {
    const result = await execFileAsync(getRgPath(), rgArgs, {
      cwd: effectiveCwd,
      timeout: timeoutMs,
      encoding: 'utf8',
      windowsHide: true,
      env: getCommandExecutionEnv(),
      maxBuffer: RUN_COMMAND_MAX_BUFFER
    })
    let stdout = stripBellCharacters(result.stdout || '')
    if (parsed.limit) stdout = stdout.split(/\r?\n/).slice(0, parsed.limit).join('\n')
    return {
      success: true,
      command: originalCommand,
      cwd: effectiveCwd,
      stdout,
      stderr: stripBellCharacters(result.stderr || ''),
      exit_code: 0,
      execution_engine: 'execFile:rg',
      shell_bypassed: true,
      pipe_removed: parsed.pipeRemoved,
      shell_prefix_removed: parsed.shellPrefixRemoved,
      trailing_shell_ignored: parsed.trailingShellIgnored,
      search_path_repaired: pathRepair.repaired || undefined,
      search_path_repairs: pathRepair.repaired ? pathRepair.repairs : undefined,
      applied_output_limit: parsed.limit || undefined
    }
  } catch (error) {
    const stdout = stripBellCharacters(error.stdout || '')
    const stderr = stripBellCharacters(error.stderr || '')
    const noMatches = error.code === 1 && !stderr
    const regexParseError = /regex parse error|repetition operator missing expression|unclosed character class|unclosed group/i.test(stderr || error.message || '')
    const executableMissing = error.code === 'ENOENT' || /spawn\s+rg\s+ENOENT|ENOENT/i.test(error.message || '')
    if (executableMissing || regexParseError) {
      const fallback = runInternalRgFallback({ ...parsed, rgArgs }, effectiveCwd)
      if (fallback) {
        let fallbackStdout = stripBellCharacters(fallback.stdout || '')
        if (parsed.limit) fallbackStdout = fallbackStdout.split(/\r?\n/).slice(0, parsed.limit).join('\n')
        return {
          success: true,
          command: originalCommand,
          cwd: effectiveCwd,
          stdout: fallbackStdout,
          stderr: '',
          exit_code: fallback.noMatches ? 1 : 0,
          noMatches: fallback.noMatches || undefined,
          result_type: fallback.noMatches ? 'no_matches' : undefined,
          message: fallback.noMatches ? 'No matches found' : undefined,
          execution_engine: 'internal:js-search',
          rg_missing_fallback: executableMissing || undefined,
          rg_regex_fallback: regexParseError || undefined,
          shell_bypassed: true,
          pipe_removed: parsed.pipeRemoved,
          shell_prefix_removed: parsed.shellPrefixRemoved,
          trailing_shell_ignored: parsed.trailingShellIgnored,
          search_path_repaired: pathRepair.repaired || undefined,
          search_path_repairs: pathRepair.repaired ? pathRepair.repairs : undefined,
          applied_output_limit: parsed.limit || undefined,
          search_recovery: fallback.noMatches ? buildSearchRecovery(originalCommand) : undefined
        }
      }
    }
    if (noMatches) {
      return {
        success: true,
        command: originalCommand,
        cwd: effectiveCwd,
        stdout,
        stderr,
        exit_code: error.code,
        noMatches: true,
        result_type: 'no_matches',
        message: 'No matches found',
        execution_engine: 'execFile:rg',
        shell_bypassed: true,
        pipe_removed: parsed.pipeRemoved,
        shell_prefix_removed: parsed.shellPrefixRemoved,
        trailing_shell_ignored: parsed.trailingShellIgnored,
        search_path_repaired: pathRepair.repaired || undefined,
        search_path_repairs: pathRepair.repaired ? pathRepair.repairs : undefined,
        applied_output_limit: parsed.limit || undefined,
        search_recovery: buildSearchRecovery(originalCommand)
      }
    }
    return {
      success: false,
      error_type: /TIMED OUT|ETIMEDOUT|timeout/i.test(error.message || '') ? 'command_timeout' : 'command_failed',
      command: originalCommand,
      cwd: effectiveCwd,
      error: stripBellCharacters(error.message || ''),
      exit_code: error.code,
      stdout,
      stderr,
      execution_engine: 'execFile:rg',
      shell_bypassed: true,
      pipe_removed: parsed.pipeRemoved,
      shell_prefix_removed: parsed.shellPrefixRemoved,
      trailing_shell_ignored: parsed.trailingShellIgnored,
      search_path_repaired: pathRepair.repaired || undefined,
      search_path_repairs: pathRepair.repaired ? pathRepair.repairs : undefined,
      applied_output_limit: parsed.limit || undefined
    }
  }
}

function getCommandExecutionEnv(options = {}) {
  const env = { ...process.env }
  // 默认剥离：宿主 Electron 常带 ELECTRON_RUN_AS_NODE=1（syntax-check 注入），
  // 若不删除，用户项目 npm start / electron 会以 Node 模式秒退。
  if (options.keepElectronRunAsNode !== true) {
    delete env.ELECTRON_RUN_AS_NODE
  }
  const rgPath = getRgPath()
  if (!rgPath || /^rg(?:\.exe)?$/i.test(String(rgPath))) return env
  const rgDir = path.dirname(rgPath)
  if (!rgDir) return env
  const pathKey = Object.keys(env).find(key => key.toLowerCase() === 'path') || 'Path'
  const currentPath = String(env[pathKey] || '')
  const parts = currentPath.split(path.delimiter).filter(Boolean)
  if (!parts.some(item => path.resolve(item).toLowerCase() === path.resolve(rgDir).toLowerCase())) {
    env[pathKey] = [rgDir, currentPath].filter(Boolean).join(path.delimiter)
  }
  return env
}

function isClearlyFiniteCommand(command = '') {
  const text = String(command || '').trim().toLowerCase()
  if (!text) return false
  return /node(?:\.exe)?["']?\s+--check\b/.test(text) ||
    /\b(?:python|py)(?:\.exe)?\s+-m\s+py_compile\b/.test(text) ||
    /\btsc(?:\.cmd|\.exe)?\s+--noemit\b/.test(text) ||
    /\b(?:ssh|ssh\.exe|scp|scp\.exe|sftp|sftp\.exe|curl|curl\.exe|wget|wget\.exe)\s+(?:-v|--version|-h|--help|\?)\b/.test(text) ||
    /\b(?:rg|rg\.exe|ripgrep|findstr|where|where\.exe|git\s+(?:status|diff|ls-files|show|grep))\b/.test(text)
}

// 按命令类型动态计算超时：长任务给足时间，短任务保持快速失败
function getCommandTimeoutMs(command = '') {
  const text = String(command || '').trim().toLowerCase()
  if (!text) return 30000
  // 搜索/枚举类：保持 30 秒快速失败
  if (/\b(?:rg|rg\.exe|ripgrep|findstr|where|where\.exe|grep|grep\.exe|select-string)\b/.test(text)) return 30000
  if (/^git\s+(?:status|diff|ls-files|show|grep|log|branch)\b/.test(text)) return 30000
  // node --check / py_compile / tsc --noemit：语法检查给 60 秒
  if (/node(?:\.exe)?["']?\s+--check\b/.test(text)) return 60000
  if (/\b(?:python|py)(?:\.exe)?\s+-m\s+py_compile\b/.test(text)) return 60000
  if (/\btsc(?:\.cmd|\.exe)?\s+--noemit\b/.test(text)) return 90000
  // 构建/测试/安装类：给 180 秒
  if (/\b(?:npm|pnpm|yarn|bun)\s+(?:install|add|i|ci|update|upgrade|create)\b/.test(text)) return 180000
  if (/\b(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?(?:build|test|lint|eslint|vitest|jest)\b/.test(text)) return 180000
  if (/\b(?:pytest|cargo\s+test|cargo\s+build|mvn|gradle)\b/.test(text)) return 180000
  if (/\bgo\s+(?:test|build)\b/.test(text)) return 180000
  // dev/serve/watch 类：不应走 run_command（应走 terminal_run），但兜底给 60 秒
  if (/\b(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?(?:dev|start|serve|watch|preview)\b/.test(text)) return 60000
  // 默认：60 秒（比原 30 秒更宽容，避免误杀中等耗时命令）
  return 60000
}

function shouldUseTerminalSession(command = '', forceBackground = false) {
  const text = String(command || '').trim().toLowerCase()
  if (!text) return false
  if (isClearlyFiniteCommand(text)) return false
  if (forceBackground) return true
  const terminalInfo = terminalSessions.classifyTerminalCommand(text)
  if (terminalInfo.shouldUseTerminal) return true
  const longTaskPatterns = [
    /\b(npm|pnpm|yarn|bun)\s+(install|add|i|ci|update|upgrade|create)\b/,
    /\b(npm|pnpm|yarn|bun)\s+run\s+(dev|start|serve|watch|build|test|lint|preview)\b/,
    /\b(npx|pnpx|yarn\s+dlx|bunx)\b.*\b(vite|next|nuxt|webpack|electron|playwright|create-)/,
    /\b(vite|webpack|next|nuxt|electron)\b/,
    /\b(pytest|playwright|cargo|mvn|gradle)\b/,
    /\b(go)\s+(test|run|build)\b/,
    /\b(python|py|node)\b.*\b(app|server|dev|start|serve)\b/,
    /\b(uvicorn|flask|streamlit|gunicorn|nodemon|ts-node-dev)\b/,
    /\b(watch|--watch|--watchAll|--serve)\b/
  ]
  return longTaskPatterns.some(pattern => pattern.test(text))
}

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error('operation aborted'))
      return
    }
    const timer = setTimeout(resolve, Math.max(0, ms))
    signal?.addEventListener?.('abort', () => {
      clearTimeout(timer)
      reject(new Error('operation aborted'))
    }, { once: true })
  })
}

function getTerminalStatusReadKey(projectId, sessionId) {
  return `${String(projectId || 'default')}::${String(sessionId || 'active')}`
}

function normalizeStringArray(value) {
  if (!value) return []
  const list = Array.isArray(value) ? value : [value]
  return list.map(item => String(item || '').trim()).filter(Boolean)
}

async function waitForAgentTerminalStatusInterval(projectId, sessionId, signal, webContents, forceRefresh = false) {
  const initialStatus = terminalSessions.getStatus(projectId, sessionId, { includeOutput: false })
  const activeSession = initialStatus.activeSession
  if (!activeSession || activeSession.status !== 'running') return { skipped: true, reason: 'no_running_session' }

  const key = getTerminalStatusReadKey(projectId, activeSession.id)
  const lastReadAt = terminalAgentStatusReads.get(key) || 0
  const elapsedMs = lastReadAt ? Date.now() - lastReadAt : TERMINAL_AGENT_STATUS_INTERVAL_MS

  if (!forceRefresh && lastReadAt && elapsedMs < TERMINAL_AGENT_STATUS_INTERVAL_MS) {
    const waitMs = TERMINAL_AGENT_STATUS_INTERVAL_MS - elapsedMs
    const waitSeconds = Math.max(1, Math.ceil(waitMs / 1000))
    return { throttled: true, waitMs, waitSeconds, activeSessionId: activeSession.id }
  }

  terminalAgentStatusReads.set(key, Date.now())
  return { throttled: false, activeSessionId: activeSession.id }
}

const handlers = {
  shell_run: async (args, ctx) => {
    const { resolvePath, projectPath, projectId, modelConfig, options, contextManager, dispatch } = ctx
    try {
      const action = String(args.action || 'run').toLowerCase()
      const sessionId = args.session_id || args.sessionId || null
      if (action === 'status') {
        return await dispatch('terminal_status', {
          session_id: sessionId,
          include_output: args.include_output,
          force_refresh: args.force_refresh
        }, { source: options.source || 'shell_run' })
      }
      if (action === 'stop') {
        return await dispatch('terminal_stop', {
          session_id: sessionId
        }, { source: options.source || 'shell_run' })
      }
      if (action !== 'run') {
        return { success: false, error: `Unsupported shell_run action: ${action}` }
      }
      const command = String(args.command || '')
      if (!command.trim()) {
        return { success: false, error: 'Missing command' }
      }
      const useTerminal = shouldUseTerminalSession(command, args.background === true)
      const result = await dispatch(useTerminal ? 'terminal_run' : 'run_command', {
        command,
        cwd: args.cwd,
        session_id: sessionId,
        auto_stop_after_ms: args.auto_stop_after_ms ?? args.autoStopAfterMs
      }, { source: options.source || 'shell_run' })
      if (result && typeof result === 'object') {
        const delegatedTool = result.terminalRun?.delegatedTool || (useTerminal ? 'terminal_run' : 'run_command')
        const background = delegatedTool === 'terminal_run'
        const requiresStop = !!(background && result.session?.requiresStop)
        result.shellRun = {
          delegatedTool,
          background,
          sessionId: result.session?.id || null,
          requiresStop,
          stopAction: requiresStop ? { action: 'stop', session_id: result.session?.id || null } : null,
          lifecycleNote: requiresStop
            ? 'This background command looks persistent. Stop it with shell_run action=stop when verification is finished.'
            : undefined
        }
        // 明确告知模型实际执行路径，避免重复调用错误的工具
        result.model_facing_hint = background
          ? `命令已通过 terminal_run 在后台会话执行（sessionId: ${result.session?.id || 'N/A'}）。查看输出用 shell_run action=status 或 terminal_status；停止用 shell_run action=stop。不要重复启动同一命令。`
          : `命令已通过 run_command 同步执行完成（超时按命令类型动态计算）。若需长时间运行，改用 shell_run background=true。`
      }
      return result
    } catch (e) {
      return { success: false, error: e.message }
    }
  },

  run_command: async (args, ctx) => {
    const { resolvePath, projectId, signal } = ctx
    try {
      const requestedCwd = resolvePath(args.cwd || '')
      const originalCommand = String(args.command || '')
      const shellCwd = normalizeLeadingShellCwd(originalCommand, requestedCwd)
      const cwd = shellCwd.cwd || requestedCwd
      const executionCommand = shellCwd.changed ? shellCwd.command : originalCommand
      const wrongNodeCheck = buildWrongNodeCheckResult(executionCommand, cwd)
      if (wrongNodeCheck) {
        wrongNodeCheck.original_command = shellCwd.changed ? originalCommand : undefined
        wrongNodeCheck.shell_cwd_normalized = shellCwd.changed || undefined
        if (projectId) {
          safelyRecordChange(() => changeSessions.recordCommand(projectId, originalCommand, cwd, wrongNodeCheck))
        }
        return wrongNodeCheck
      }
      const commandTimeoutMs = getCommandTimeoutMs(executionCommand)
      const safeRgResult = await executeSafeRgCommand(originalCommand, requestedCwd, commandTimeoutMs)
      if (safeRgResult) {
        if (shellCwd.changed) safeRgResult.shell_cwd_normalized = true
        if (projectId) {
          safelyRecordChange(() => changeSessions.recordCommand(projectId, originalCommand, cwd, safeRgResult))
        }
        return safeRgResult
      }
      const command = prepareRunCommand(executionCommand)
      if (signal?.aborted) {
        const result = { success: false, error: 'command aborted before start', command: originalCommand, cwd, aborted: true }
        if (projectId) {
          safelyRecordChange(() => changeSessions.recordCommand(projectId, originalCommand, cwd, result))
        }
        return result
      }
      const runnerOutput = await runCommandInRunner({
        projectId,
        command,
        cwd,
        timeoutMs: commandTimeoutMs,
        env: getCommandExecutionEnv(),
        signal
      })
      const output = {
        ...runnerOutput,
        stdout: stripBellCharacters(runnerOutput.stdout),
        stderr: stripBellCharacters(runnerOutput.stderr),
        error: runnerOutput.error ? stripBellCharacters(runnerOutput.error) : undefined
      }
      let result
      if (output.error && isBenignNoMatchCommand(originalCommand, output)) {
        result = {
          success: true,
          command: originalCommand,
          cwd,
          stdout: output.stdout,
          stderr: output.stderr,
          exit_code: output.code,
          noMatches: true,
          result_type: 'no_matches',
          message: 'No matches found',
          search_recovery: buildSearchRecovery(originalCommand)
        }
      } else if (output.error) {
        const missingExecutableRecovery = buildMissingExecutableRecovery(executionCommand, output)
        const isTimeout = /TIMED OUT|ETIMEDOUT|timeout/i.test(output.error) && !output.aborted
        result = {
          success: false,
          error_type: output.aborted ? 'command_aborted' : (missingExecutableRecovery ? 'command_not_available' : (isTimeout ? 'command_timeout' : 'command_failed')),
          command: originalCommand,
          cwd,
          executed_command: shellCwd.changed ? executionCommand : undefined,
          shell_cwd_normalized: shellCwd.changed || undefined,
          error: output.error,
          exit_code: output.code,
          timeout_ms: isTimeout ? commandTimeoutMs : undefined,
          stdout: output.stdout,
          stderr: output.stderr,
          aborted: !!output.aborted,
          search_recovery: missingExecutableRecovery || undefined,
          next_action: missingExecutableRecovery
            ? 'Switch to the recommended fallback instead of retrying the same missing command.'
            : (isTimeout
                ? `Command timed out after ${Math.round(commandTimeoutMs / 1000)}s. If this is a long-running task (dev server, watch, build), use terminal_run instead of run_command. Otherwise narrow the command scope or split into smaller steps.`
                : undefined)
        }
      } else {
        result = {
          success: true,
          command: originalCommand,
          cwd,
          executed_command: shellCwd.changed ? executionCommand : undefined,
          shell_cwd_normalized: shellCwd.changed || undefined,
          stdout: output.stdout,
          stderr: output.stderr,
          exit_code: 0
        }
      }
      if (projectId) {
        safelyRecordChange(() => changeSessions.recordCommand(projectId, originalCommand, cwd, result))
      }
      return result
    } catch (e) {
      return { success: false, error: e.message }
    }
  },

  terminal_run: async (args, ctx) => {
    const { resolvePath, projectPath, projectId, dispatch, options } = ctx
    try {
      const cwd = args.cwd ? resolvePath(args.cwd) : projectPath
      const command = String(args.command || '')
      if (isClearlyFiniteCommand(command)) {
        const result = await dispatch('run_command', {
          command,
          cwd
        }, { source: options.source || 'terminal_run' })
        if (result && typeof result === 'object') {
          result.terminalRun = {
            delegatedTool: 'run_command',
            background: false,
            reason: 'finite_command'
          }
        }
        return result
      }
      return terminalSessions.startSession(projectId, command, cwd, args.session_id || args.sessionId || null, {
        autoStopAfterMs: args.auto_stop_after_ms ?? args.autoStopAfterMs
      })
    } catch (e) {
      return { success: false, error: e.message }
    }
  },

  terminal_status: async (args, ctx) => {
    const { projectId, signal } = ctx
    try {
      const webContents = projectId ? projects.getWebContentsForProject(projectId) : config.getMainWindow()?.webContents
      const intervalState = await waitForAgentTerminalStatusInterval(
        projectId,
        args.session_id || args.sessionId || null,
        signal,
        webContents,
        args.force_refresh === true || args.forceRefresh === true
      )
      return {
        success: true,
        agentStatusIntervalMs: TERMINAL_AGENT_STATUS_INTERVAL_MS,
        statusRead: intervalState,
        ...terminalSessions.getStatus(projectId, args.session_id || args.sessionId || null, {
          includeOutput: args.include_output !== false && args.includeOutput !== false
        })
      }
    } catch (e) {
      return { success: false, error: e.message }
    }
  },

  terminal_stop: async (args, ctx) => {
    const { projectId } = ctx
    try {
      return terminalSessions.stopSession(projectId, args.session_id || args.sessionId || null)
    } catch (e) {
      return { success: false, error: e.message }
    }
  }
}

module.exports = {
  handlers,
  isBenignNoMatchCommand,
  prepareRunCommand,
  shouldUseTerminalSession,
  isClearlyFiniteCommand,
  stripBellCharacters,
  sleep,
  getTerminalStatusReadKey,
  normalizeStringArray,
  waitForAgentTerminalStatusInterval,
  TERMINAL_AGENT_STATUS_INTERVAL_MS,
  terminalAgentStatusReads,
  getCommandExecutionEnv,
  parseSafeRgCommand,
  executeSafeRgCommand
}
