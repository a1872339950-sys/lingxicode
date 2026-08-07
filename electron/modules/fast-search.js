/**
 * 统一高速搜索内核（ripgrep）
 * - 内容搜 / 文件列表 都走 rg
 * - 严格超时、结果上限、忽略目录、max-filesize
 * - 禁止「整库 JS 扫盘」作为默认回退（那是间歇性极慢的根因）
 */

const path = require('path')
const fs = require('fs')
const { spawn } = require('child_process')
const { getRgPath } = require('./rg-path')

/** 默认忽略（与 Codex 类似：噪声目录不进索引） */
const DEFAULT_IGNORE_GLOBS = [
  '!**/.git/**',
  '!**/node_modules/**',
  '!**/dist/**',
  '!**/build/**',
  '!**/out/**',
  '!**/release/**',
  '!**/releases/**',
  '!**/.next/**',
  '!**/.nuxt/**',
  '!**/.vite/**',
  '!**/.turbo/**',
  '!**/.cache/**',
  '!**/coverage/**',
  '!**/tmp/**',
  '!**/temp/**',
  '!**/.tmp/**',
  '!**/logs/**',
  '!**/__pycache__/**',
  '!**/.pytest_cache/**',
  '!**/codemap/**',
  '!**/change-sessions/**',
  '!**/recovery-points/**',
  '!**/.lingxi-temp-artifacts/**',
  '!**/vendor/**',
  '!**/*.min.js',
  '!**/*.map',
  '!**/*.png',
  '!**/*.jpg',
  '!**/*.jpeg',
  '!**/*.gif',
  '!**/*.webp',
  '!**/*.ico',
  '!**/*.woff',
  '!**/*.woff2',
  '!**/*.pdf',
  '!**/*.zip'
]

const DEFAULT_CONTENT_TIMEOUT_MS = 12000
const DEFAULT_FILES_TIMEOUT_MS = 10000
const DEFAULT_MAX_OUTPUT_BYTES = 2 * 1024 * 1024

function unique(list = []) {
  return [...new Set(list.filter(Boolean))]
}

function pushIgnoreArgs(args, extraGlobs = []) {
  for (const g of unique([...DEFAULT_IGNORE_GLOBS, ...extraGlobs])) {
    args.push('--glob', g)
  }
}

function normalizeSearchRoot(projectPath = '', searchPath = '') {
  const root = path.resolve(projectPath || process.cwd())
  if (!searchPath) return { cwd: root, target: '.' }
  const resolved = path.isAbsolute(searchPath)
    ? path.resolve(searchPath)
    : path.resolve(root, searchPath)
  // 尽量让 cwd=project，target 用相对路径，便于相对输出
  try {
    const rel = path.relative(root, resolved)
    if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) {
      return { cwd: root, target: rel.replace(/\\/g, '/') || '.' }
    }
  } catch { /* ignore */ }
  return { cwd: path.dirname(resolved), target: path.basename(resolved) || '.' }
}

/**
 * 跑一次 rg，带超时与输出上限
 * @returns {Promise<{ok:boolean, code:number|null, stdout:string, stderr:string, timedOut:boolean, engine:string, rgPath:string, error?:string}>}
 */
function runRg(args = [], options = {}) {
  const timeoutMs = Math.max(500, Math.min(60000, Number(options.timeoutMs) || DEFAULT_CONTENT_TIMEOUT_MS))
  const maxOutputBytes = Math.max(64 * 1024, Number(options.maxOutputBytes) || DEFAULT_MAX_OUTPUT_BYTES)
  const cwd = options.cwd || process.cwd()
  const rgPath = getRgPath()

  return new Promise(resolve => {
    let stdout = ''
    let stderr = ''
    let stdoutBytes = 0
    let done = false
    let timedOut = false
    let child

    const finish = (result) => {
      if (done) return
      done = true
      try { clearTimeout(timer) } catch { /* ignore */ }
      try { child?.removeAllListeners() } catch { /* ignore */ }
      resolve({
        engine: 'ripgrep',
        rgPath,
        ...result
      })
    }

    try {
      child = spawn(rgPath, args, {
        cwd,
        windowsHide: true,
        shell: false,
        stdio: ['ignore', 'pipe', 'pipe']
      })
    } catch (error) {
      return finish({
        ok: false,
        code: null,
        stdout: '',
        stderr: error.message,
        timedOut: false,
        error: error.message
      })
    }

    const timer = setTimeout(() => {
      timedOut = true
      try { child.kill() } catch { /* ignore */ }
    }, timeoutMs)

    child.stdout.on('data', chunk => {
      if (stdoutBytes >= maxOutputBytes) return
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk))
      const remain = maxOutputBytes - stdoutBytes
      const slice = buf.subarray(0, remain)
      stdoutBytes += slice.length
      stdout += slice.toString('utf8')
    })
    child.stderr.on('data', chunk => {
      if (stderr.length < 8000) stderr += chunk.toString()
    })
    child.once('error', error => {
      finish({
        ok: false,
        code: null,
        stdout,
        stderr: error.message,
        timedOut: false,
        error: error.message
      })
    })
    child.once('close', code => {
      // rg: 0=有匹配, 1=无匹配, 2+=错误
      const ok = code === 0 || code === 1
      finish({
        ok,
        code,
        stdout,
        stderr,
        timedOut,
        error: timedOut
          ? `rg timed out after ${timeoutMs}ms`
          : (!ok ? (stderr || `rg exited with code ${code}`) : undefined)
      })
    })
  })
}

/**
 * 内容搜索（对应 grep_code 主路径）
 */
async function searchContent({
  projectPath,
  searchPath = '',
  patterns = [],
  caseSensitive = false,
  fixedStrings = true,
  regex = false,
  contextLines = 0,
  maxResults = 40,
  fileType = '',
  extraGlobs = [],
  timeoutMs = DEFAULT_CONTENT_TIMEOUT_MS
} = {}) {
  const list = unique((Array.isArray(patterns) ? patterns : [patterns])
    .map(p => String(p || '').trim())
    .filter(Boolean)
    .slice(0, 10))
  if (!list.length) {
    return { success: false, error: 'Missing search pattern', engine: 'none', matches: [] }
  }

  const { cwd, target } = normalizeSearchRoot(projectPath, searchPath)
  const perPattern = Math.max(4, Math.ceil(Math.min(100, maxResults) / Math.min(list.length, 5)))
  const args = [
    '-n',
    '--no-heading',
    '--color', 'never',
    '--max-filesize', '2M',
    '-m', String(Math.min(80, perPattern))
  ]
  pushIgnoreArgs(args, extraGlobs)
  if (!caseSensitive) args.push('-i')
  if (fixedStrings && !regex) args.push('-F')
  else args.push('-S') // smart case when regex
  if (contextLines > 0) args.push('-C', String(Math.min(5, contextLines)))
  if (fileType) args.push('-t', String(fileType).replace(/^\./, ''))
  for (const p of list) args.push('-e', p)
  args.push('--', target === '.' ? '.' : target)

  const started = Date.now()
  const result = await runRg(args, { cwd, timeoutMs })
  return {
    success: result.ok || result.code === 1,
    engine: 'ripgrep',
    rgPath: result.rgPath,
    timedOut: result.timedOut,
    error: result.error,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    elapsedMs: Date.now() - started,
    patterns: list,
    cwd,
    target
  }
}

/**
 * 列文件（对应 glob / 路径发现快路径）
 * pattern 支持简易 glob，如 `**\/*.js`、`*handler*`
 */
async function searchFiles({
  projectPath,
  searchPath = '',
  pattern = '',
  limit = 100,
  extraGlobs = [],
  timeoutMs = DEFAULT_FILES_TIMEOUT_MS
} = {}) {
  const { cwd, target } = normalizeSearchRoot(projectPath, searchPath)
  const safeLimit = Math.max(1, Math.min(500, Number(limit) || 100))
  const args = ['--files', '--color', 'never']
  pushIgnoreArgs(args, extraGlobs)

  const pat = String(pattern || '').trim().replace(/\\/g, '/')
  if (pat && pat !== '**/*' && pat !== '*') {
    // rg --glob 使用类似 gitignore 的规则
    let g = pat
    if (!g.includes('/') && !g.startsWith('*')) g = `**/${g}`
    args.push('--glob', g)
  }
  args.push(target === '.' ? '.' : target)

  const started = Date.now()
  const result = await runRg(args, { cwd, timeoutMs, maxOutputBytes: 1024 * 1024 })
  const files = String(result.stdout || '')
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
    .slice(0, safeLimit)
    .map(filePath => {
      const absolute = path.isAbsolute(filePath) ? filePath : path.resolve(cwd, filePath)
      let relative = filePath
      try {
        relative = path.relative(projectPath || cwd, absolute).replace(/\\/g, '/')
      } catch { /* ignore */ }
      return { path: relative, absolutePath: absolute }
    })

  return {
    success: result.ok || result.code === 1 || files.length > 0,
    engine: 'ripgrep',
    rgPath: result.rgPath,
    timedOut: result.timedOut,
    error: result.timedOut ? result.error : (files.length ? undefined : result.error),
    files,
    count: files.length,
    elapsedMs: Date.now() - started
  }
}

/**
 * 解析 rg -n 输出为结构化 matches
 */
function parseContentMatches(stdout = '', {
  projectPath = '',
  maxResults = 40
} = {}) {
  const matches = []
  const seen = new Set()
  for (const rawLine of String(stdout || '').split(/\r?\n/)) {
    if (!rawLine || matches.length >= maxResults) continue
    // path:line:content  — Windows 盘符 C:\... 需宽松匹配
    const m = rawLine.match(/^(.*?):(\d+):(.*)$/)
    if (!m) continue
    let filePath = m[1]
    const lineNumber = Number(m[2]) || 0
    const content = m[3] || ''
    if (!lineNumber) continue
    let relative = filePath
    try {
      if (projectPath && path.isAbsolute(filePath)) {
        relative = path.relative(projectPath, filePath).replace(/\\/g, '/')
      } else {
        relative = String(filePath || '').replace(/\\/g, '/')
      }
    } catch {
      relative = String(filePath || '').replace(/\\/g, '/')
    }
    const key = `${relative}:${lineNumber}:${content}`
    if (seen.has(key)) continue
    seen.add(key)
    matches.push({
      path: relative,
      line: lineNumber,
      content: String(content).trim().slice(0, 300)
    })
  }
  return matches
}

function isRgAvailable() {
  const p = getRgPath()
  if (!p) return false
  if (p === 'rg' || p === 'rg.exe') return true
  try { return fs.existsSync(p) } catch { return false }
}

module.exports = {
  DEFAULT_IGNORE_GLOBS,
  runRg,
  searchContent,
  searchFiles,
  parseContentMatches,
  isRgAvailable,
  getRgPath
}
