/**
 * 搜索工具处理器
 * 包含：glob_files, grep_code, find_references, search_project, discover_code 工具及相关辅助函数
 */

const fs = require('fs')
const path = require('path')
const { execFile } = require('child_process')
const { promisify } = require('util')
const changePlanner = require('../change-planner')
const { getRgPath } = require('../rg-path')
const fastSearch = require('../fast-search')
const { isInsideProject, collectProjectPathCandidates, scorePathCandidate } = require('../path-utils')
const { isLikelyTextBuffer, IMAGE_FILE_EXTENSIONS } = require('../text-edit-utils')

const execFileAsync = promisify(execFile)
const LOCATE_CODE_TIMEOUT_MS = 18000
const LOCATE_CODE_BRANCH_TIMEOUT_MS = 12000

const GLOB_IGNORE_DIRS = new Set([
  '.git', '.hg', '.svn', 'node_modules', 'dist', 'build', 'out', 'release', 'releases',
  '.next', '.nuxt', '.vite', '.turbo', '.cache', 'coverage', 'tmp', 'temp', '.tmp',
  '.temp', 'logs', 'log', '__pycache__', '.pytest_cache', '.gradle', 'target',
  'vendor', 'packages-cache', 'codemap'
])

const SEARCHABLE_CODE_EXTENSIONS = new Set([
  '.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs', '.html', '.css', '.scss', '.less',
  '.vue', '.svelte', '.json', '.jsonc', '.md', '.mdx', '.py', '.yml', '.yaml',
  '.xml', '.java', '.go', '.rs', '.cs', '.cpp', '.cc', '.c', '.h', '.hpp',
  '.php', '.rb', '.swift', '.kt', '.kts', '.sql', '.sh', '.ps1', '.bat',
  '.cmd', '.toml', '.ini', '.txt'
])

// normalizeRelativePathForTool 的本地副本（避免与 file-ops.js 的循环依赖）
function normalizeRelativePathForTool(filePath = '', rootPath = '') {
  try {
    const relative = path.relative(rootPath, filePath)
    if (relative && !relative.startsWith('..') && !path.isAbsolute(relative)) {
      return relative.replace(/\\/g, '/')
    }
  } catch { /* 路径计算失败 */ }
  return String(filePath || '').replace(/\\/g, '/')
}

function globPatternToRegExp(pattern = '') {
  const normalized = String(pattern || '').replace(/\\/g, '/').replace(/^\.\/+/, '')
  let source = ''
  for (let i = 0; i < normalized.length; i += 1) {
    const char = normalized[i]
    const next = normalized[i + 1]
    if (char === '*') {
      if (next === '*') {
        const after = normalized[i + 2]
        if (after === '/') {
          source += '(?:.*\\/)?'
          i += 2
        } else {
          source += '.*'
          i += 1
        }
      } else {
        source += '[^/]*'
      }
    } else if (char === '?') {
      source += '[^/]'
    } else {
      source += char.replace(/[|\\{}()[\]^$+?.]/g, '\\$&')
    }
  }
  return new RegExp(`^${source}$`, 'i')
}

function findFilesByGlob({ rootPath, basePath, pattern, limit = 100, includeHidden = false }) {
  const safeLimit = Math.max(1, Math.min(500, Number(limit) || 100))
  const regex = globPatternToRegExp(pattern)
  const patternText = String(pattern || '').replace(/\\/g, '/').replace(/^\.\/+/, '')
  const basenameOnly = patternText && !patternText.includes('/')
  const files = []
  const stack = [basePath]
  while (stack.length && files.length < safeLimit) {
    const dir = stack.pop()
    let entries = []
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      continue
    }
    entries.sort((a, b) => a.name.localeCompare(b.name))
    for (const entry of entries) {
      if (!entry || entry.isSymbolicLink?.()) continue
      if (!includeHidden && entry.name.startsWith('.')) continue
      const fullPath = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        if (!GLOB_IGNORE_DIRS.has(entry.name)) stack.push(fullPath)
        continue
      }
      if (!entry.isFile()) continue
      const relativePath = normalizeRelativePathForTool(fullPath, rootPath)
      const localRelativePath = normalizeRelativePathForTool(fullPath, basePath)
      const basename = entry.name
      if (regex.test(relativePath) || regex.test(localRelativePath) || (basenameOnly && regex.test(basename))) {
        files.push({ path: relativePath, absolutePath: fullPath })
        if (files.length >= safeLimit) break
      }
    }
  }
  return files
}

async function findFilesByGlobAsync({ rootPath, basePath, pattern, limit = 100, includeHidden = false }) {
  const safeLimit = Math.max(1, Math.min(500, Number(limit) || 100))
  const regex = globPatternToRegExp(pattern)
  const patternText = String(pattern || '').replace(/\\/g, '/').replace(/^\.\/+/, '')
  const basenameOnly = patternText && !patternText.includes('/')
  const files = []
  const stack = [basePath]

  while (stack.length && files.length < safeLimit) {
    const dir = stack.pop()
    const entries = await fs.promises.readdir(dir, { withFileTypes: true }).catch(() => [])
    entries.sort((a, b) => a.name.localeCompare(b.name))
    for (const entry of entries) {
      if (!entry || entry.isSymbolicLink?.()) continue
      if (!includeHidden && entry.name.startsWith('.')) continue
      const fullPath = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        if (!GLOB_IGNORE_DIRS.has(entry.name)) stack.push(fullPath)
        continue
      }
      if (!entry.isFile()) continue
      const relativePath = normalizeRelativePathForTool(fullPath, rootPath)
      const localRelativePath = normalizeRelativePathForTool(fullPath, basePath)
      if (regex.test(relativePath) || regex.test(localRelativePath) || (basenameOnly && regex.test(entry.name))) {
        files.push({ path: relativePath, absolutePath: fullPath })
        if (files.length >= safeLimit) break
      }
    }
  }
  return files
}

async function findPatternInFile(filePath, args = {}) {
  const ext = path.extname(filePath).toLowerCase()
  if (IMAGE_FILE_EXTENSIONS.has(ext)) {
    return { success: false, error: 'find_in_file 不处理图片文件，请使用 view_image/inspect_image。' }
  }
  const buffer = await fs.promises.readFile(filePath)
  if (!isLikelyTextBuffer(buffer)) {
    return { success: false, error: 'find_in_file 不处理二进制文件。' }
  }

  const content = buffer.toString('utf-8')
  const lines = content.split(/\r\n|\r|\n/)
  const pattern = String(args.pattern || '')
  const maxResults = Math.max(1, Math.min(100, Number(args.max_results || args.maxResults) || 30))
  const contextLines = Math.max(0, Math.min(8, Number(args.context_lines || args.contextLines) || 0))
  const flags = args.case_sensitive === true ? 'g' : 'gi'
  let matcher = null
  if (args.regex === true) {
    matcher = new RegExp(pattern, flags)
  }
  const needle = args.case_sensitive === true ? pattern : pattern.toLowerCase()
  const matches = []

  for (let index = 0; index < lines.length && matches.length < maxResults; index += 1) {
    const line = lines[index]
    const found = matcher
      ? (matcher.lastIndex = 0, matcher.test(line))
      : (args.case_sensitive === true ? line : line.toLowerCase()).includes(needle)
    if (!found) continue
    const start = Math.max(0, index - contextLines)
    const end = Math.min(lines.length - 1, index + contextLines)
    matches.push({
      line: index + 1,
      text: line.trim(),
      context_start: start + 1,
      context_end: end + 1,
      context: lines.slice(start, end + 1).join('\n')
    })
  }

  return {
    success: true,
    path: filePath,
    pattern,
    matches,
    count: matches.length,
    line_count: lines.length
  }
}

function isSearchableCodePath(filePath = '') {
  const normalized = String(filePath || '').replace(/\\/g, '/')
  if (/(^|\/)(node_modules|dist|build|release|coverage|codemap|change-sessions)\//i.test(normalized)) return false
  return SEARCHABLE_CODE_EXTENSIONS.has(path.extname(normalized).toLowerCase())
}

/**
 * 极窄兜底：仅当 rg 完全不可用时，在有限文件集合内做 JS 扫描。
 * 禁止再扫 6000+ 文件（历史间歇性极慢根因）。
 */
async function grepProjectFilesFallback(projectPath = '', terms = [], limit = 40) {
  if (!projectPath || !terms.length) return []
  const started = Date.now()
  const budgetMs = 2500
  const files = (await listProjectFilesForLocate(projectPath, 2500))
    .filter(isSearchableCodePath)
    .slice(0, 250)
  const loweredTerms = terms
    .map(term => ({ term: String(term || ''), lower: String(term || '').toLowerCase(), type: classifyLocateTerm(term) }))
    .filter(item => item.lower.length >= 2)
  const results = []
  for (const relativePath of files) {
    if (results.length >= limit) break
    if (Date.now() - started > budgetMs) break
    const absolutePath = path.join(projectPath, relativePath)
    let buffer
    try {
      const stat = fs.statSync(absolutePath)
      if (!stat.isFile() || stat.size > 512 * 1024) continue
      buffer = fs.readFileSync(absolutePath)
    } catch {
      continue
    }
    if (!isLikelyTextBuffer(buffer)) continue
    const lines = buffer.toString('utf8').split(/\r\n|\r|\n/)
    for (let index = 0; index < lines.length && results.length < limit; index += 1) {
      const line = lines[index]
      const lowerLine = line.toLowerCase()
      const matched = loweredTerms.find(item => lowerLine.includes(item.lower))
      if (!matched) continue
      let score = getLocateTermStrength(matched.term, matched.type === 'ui_text' ? 'ui_text' : matched.type === 'symbol' ? 'symbol' : 'content')
      if (/\b(function|class|const|let|var|export|import|querySelector|getElementById|addEventListener|onclick)\b/.test(line)) score += 8
      results.push({
        path: relativePath,
        line: index + 1,
        type: matched.type === 'ui_text' ? 'ui_text' : matched.type === 'symbol' ? 'symbol' : 'content',
        source: 'js-fallback-grep-limited',
        term: matched.term,
        score,
        preview: line.trim().slice(0, 300)
      })
    }
  }
  return results
}

function parseGrepCodeOutput(stdout = '', input = {}) {
  const {
    projectPath = '',
    searchPath = '',
    maxResults = 25,
    contextLines = 0
  } = input
  const normalizedSearchPath = searchPath ? changePlanner.normalizePath(searchPath, projectPath) : ''
  const searchPathIsFile = !!searchPath && fs.existsSync(searchPath) && fs.statSync(searchPath).isFile()
  const matches = []
  const seen = new Set()
  for (const rawLine of String(stdout || '').split(/\r?\n/)) {
    if (!rawLine || matches.length >= maxResults) continue
    let filePath = ''
    let lineNumber = 0
    let content = ''
    const fullMatch = rawLine.match(/^(.+?):(\d+):(.*)$/)
    if (fullMatch) {
      filePath = fullMatch[1]
      lineNumber = Number(fullMatch[2]) || 0
      content = fullMatch[3] || ''
    } else if (searchPathIsFile) {
      const singleFileMatch = rawLine.match(/^(\d+):(.*)$/)
      if (!singleFileMatch) continue
      filePath = normalizedSearchPath
      lineNumber = Number(singleFileMatch[1]) || 0
      content = singleFileMatch[2] || ''
    } else {
      continue
    }
    if (!lineNumber) continue
    const normalizedPath = changePlanner.normalizePath(filePath, projectPath)
    const key = `${normalizedPath}:${lineNumber}:${content}`
    if (seen.has(key)) continue
    seen.add(key)
    matches.push({
      path: normalizedPath,
      line: lineNumber,
      content: String(content || '').trim().slice(0, 300)
    })
  }
  if (contextLines > 0) return matches.slice(0, maxResults)
  return matches.slice(0, maxResults)
}

function getPathLikeSearchTerms(pattern = '') {
  const text = String(pattern || '').trim()
  if (!text || text.length > 240) return []
  if (text.includes('|') || text.includes('\n')) return []
  return text
    .split(/\s+/)
    .map(item => item.trim().replace(/^['"`]+|['"`]+$/g, '').replace(/^[./\\]+/, ''))
    .filter(item => {
      if (!item || item.length > 160) return false
      if (/[\\/:]/.test(item) && /[A-Za-z0-9_.-]/.test(item)) return true
      return /\.(?:js|jsx|ts|tsx|mjs|cjs|html|css|scss|json|py|md|vue|svelte|yml|yaml)$/i.test(item)
    })
}

function findPathMatchesForGrep({ projectPath = '', searchPath = '', pattern = '', maxResults = 25 } = {}) {
  if (!projectPath || !fs.existsSync(projectPath)) return []
  const terms = getPathLikeSearchTerms(pattern)
  if (!terms.length) return []
  let basePath = projectPath
  try {
    if (searchPath && fs.existsSync(searchPath) && fs.statSync(searchPath).isDirectory()) basePath = searchPath
  } catch { /* ignore path stat races */ }
  const byPath = new Map()
  for (const term of terms) {
    const normalized = term.replace(/\\/g, '/')
    const patterns = normalized.includes('/')
      ? [normalized, `**/${normalized}`]
      : [normalized, `**/${normalized}`]
    for (const globPattern of patterns) {
      const files = findFilesByGlob({
        rootPath: projectPath,
        basePath,
        pattern: globPattern,
        limit: maxResults
      })
      for (const file of files) {
        const key = normalizeRelativePathForTool(file.absolutePath || file.path, projectPath)
        if (!key || byPath.has(key)) continue
        const lowerPath = key.toLowerCase()
        const lowerTerm = normalized.toLowerCase()
        let score = 0
        if (lowerPath === lowerTerm) score += 120
        if (lowerPath.endsWith(`/${lowerTerm}`) || path.basename(lowerPath) === lowerTerm) score += 90
        if (/^(frontend|electron|src|app|lib|services|scripts)\//.test(lowerPath)) score += 20
        if (/\/(?:scripts|features|modules)\//.test(lowerPath)) score += 18
        if (/\/i18n\//.test(lowerPath)) score -= 25
        if (/^(docs|temp|tmp|scripts\/real-scenarios)\//.test(lowerPath)) score -= 35
        score -= key.split('/').length
        byPath.set(key, {
          path: key,
          line: null,
          content: `file-name/path match: ${key}`,
          reason: 'file-name/path match',
          score
        })
      }
    }
  }
  return [...byPath.values()]
    .sort((a, b) => Number(b.score || 0) - Number(a.score || 0) || String(a.path).localeCompare(String(b.path)))
    .slice(0, maxResults)
}

function withTimeout(promise, timeoutMs, fallback) {
  let timer = null
  return Promise.race([
    Promise.resolve(promise).finally(() => {
      if (timer) clearTimeout(timer)
    }),
    new Promise(resolve => {
      timer = setTimeout(() => resolve(fallback), timeoutMs)
    })
  ])
}

async function runLimitedParallel(items = [], limit = 4, worker = async () => null) {
  const results = []
  const workerCount = Math.max(1, Math.min(Number(limit) || 4, items.length || 1))
  const workers = new Array(workerCount)
    .fill(null)
    .map(async (_, workerIndex) => {
      for (let index = workerIndex; index < items.length; index += workerCount) {
        results[index] = await worker(items[index], index)
      }
    })
  await Promise.all(workers)
  return results
}

function escapeRegex(value = '') {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function extractLocateTerms(query = '') {
  const text = String(query || '')
  const terms = []
  const push = value => {
    const term = String(value || '').trim().replace(/^['"`“”‘’]+|['"`“”‘’.,，。:：;；!?！？]+$/g, '')
    if (!term || term.length < 2 || term.length > 120) return
    const lower = term.toLowerCase()
    if (terms.some(item => item.toLowerCase() === lower)) return
    terms.push(term)
  }
  for (const match of text.matchAll(/[`"'“”‘’]([^`"'“”‘’]{2,120})[`"'“”‘’]/g)) push(match[1])
  for (const match of text.matchAll(/[A-Za-z_$][\w$.-]{2,}/g)) push(match[0])
  for (const match of text.matchAll(/[A-Za-z_$][\w$.-]{2,}/g)) {
    const token = String(match[0])
    if (/[._\-]/.test(token)) continue
    if (/[a-z0-9][A-Z]/.test(token) && token.length >= 6) {
      if (token.length >= 20) {
        const parts = token
          .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
          .split(/\s+/)
          .filter(part => part.length >= 6)
        parts.forEach(push)
      } else {
        push(token.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase())
        push(token.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase())
      }
    }
  }
  for (const match of text.matchAll(/[\u4e00-\u9fff][\u4e00-\u9fffA-Za-z0-9_ -]{1,24}/g)) push(match[0])
  for (const piece of text.split(/[\s,，。;；:：/\\|()[\]{}<>]+/)) push(piece)
  return terms.slice(0, 16)
}

function classifyLocateTerm(term = '') {
  const value = String(term || '')
  const lower = value.toLowerCase()
  if (/^(model|models|menu|trigger|dropdown|setting|settings|modal|dialog|custom|console)$/i.test(lower) && !/[A-Z]/.test(value)) return 'keyword'
  if (/\.(?:js|jsx|ts|tsx|mjs|cjs|html|css|scss|json|py|md|vue|svelte|yml|yaml)$/i.test(value) || /[\\/]/.test(value)) return 'path'
  if (/^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*$/.test(value) || /[a-z0-9][A-Z]/.test(value)) return 'symbol'
  if (/[\u4e00-\u9fff]/.test(value)) return 'ui_text'
  return 'keyword'
}

function splitSearchIdentifier(value = '') {
  return String(value || '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[\\/_\-.:\s]+/)
    .map(part => part.trim().toLowerCase())
    .filter(part => part.length >= 4)
}

function isWeakLocateTerm(term = '') {
  const value = String(term || '').trim()
  const lower = value.toLowerCase()
  return /^(model|models|menu|trigger|dropdown|setting|settings|modal|dialog|custom|console)$/i.test(lower) ||
    /^(data|value|item|items|name|list|code|file|files|path|type|size|count|index|error|errors|event|events|state|props|config|option|options|result|results|key|text|html|css|json|func|call|load|init|test|util|utils|main|self|this|that|here|true|false|null|undefined|return|const|class)$/i.test(lower) ||
    ['弹窗', '按钮', '菜单', '模型', '设置', '界面', '页面', '输入框', '下拉', '新增', '添加', '打开', '显示', '点击'].includes(value)
}

function getLocateTermStrength(term = '', type = '') {
  const value = String(term || '').trim()
  const lower = value.toLowerCase()
  const genericUiTerms = new Set(['弹窗', '按钮', '菜单', '模型', '设置', '界面', '页面', '输入框', '下拉', '新增', '添加', '打开', '显示', '点击'])
  if (!value) return 0
  if (type === 'symbol') return value.length >= 8 || /[A-Z]/.test(value) ? 44 : 34
  if (type === 'path') return 46
  if (type === 'ui_text') {
    if (genericUiTerms.has(value)) return 8
    if (value.length >= 8) return 48
    if (value.length >= 5) return 38
    if (value.length >= 4) return 28
    return 12
  }
  if (/^(model|settings?|dropdown|trigger|menu|modal|dialog|console|custom)$/i.test(lower)) return 12
  return value.length >= 8 ? 26 : 18
}

function normalizeLocateEvidencePath(filePath = '', projectPath = '') {
  return normalizeRelativePathForTool(filePath, projectPath).replace(/^\.\/+/, '')
}

function getLocatePathPenalty(filePath = '') {
  const normalized = String(filePath || '').replace(/\\/g, '/').toLowerCase()
  let penalty = 0
  if (/^(docs|temp|tmp|coverage|codemap|change-sessions)\//.test(normalized)) penalty += 80
  if (/^scripts\/real-scenarios\//.test(normalized)) penalty += 110
  if (/^frontend\/design-preview\.html$/.test(normalized)) penalty += 30
  if (/^electron\/modules\/schemas\//.test(normalized)) penalty += 22
  if (/\/(?:__tests__|test|tests|fixtures|mock|mocks)\//.test(normalized)) penalty += 24
  if (/\/i18n\//.test(normalized)) penalty += 18
  if (/\.(?:md|txt)$/.test(normalized)) penalty += 50
  return penalty
}

function getLocatePathBoost(filePath = '') {
  const normalized = String(filePath || '').replace(/\\/g, '/').toLowerCase()
  let boost = 0
  if (/^(frontend|electron|src|app|lib|services)\//.test(normalized)) boost += 18
  if (/\/(?:features|modules|components|handlers|stores|styles)\//.test(normalized)) boost += 12
  if (/\/(?:app|main|index)\.(?:js|ts|tsx|html)$/.test(normalized)) boost += 6
  return boost
}

function makeLocateSnippet(item = {}) {
  return {
    type: item.type || 'evidence',
    term: item.term || '',
    line: item.line || null,
    preview: String(item.preview || item.content || item.reason || '').trim().slice(0, 240),
    score: item.score || 0,
    source: item.source || ''
  }
}

function addLocateEvidence(byPath, item = {}, projectPath = '') {
  const normalizedPath = normalizeLocateEvidencePath(item.path || item.file || '', projectPath)
  if (!normalizedPath) return
  const current = byPath.get(normalizedPath) || {
    path: normalizedPath,
    score: 0,
    confidence: 0,
    evidenceTypes: [],
    sources: [],
    snippets: [],
    bestLine: null,
    penalty: getLocatePathPenalty(normalizedPath)
  }
  const type = item.type || 'evidence'
  const source = item.source || type
  const score = Number(item.score || 0)
  current.score += score
  if (!current.evidenceTypes.includes(type)) current.evidenceTypes.push(type)
  if (!current.sources.includes(source)) current.sources.push(source)
  if (item.line && !current.bestLine) current.bestLine = Number(item.line) || null
  if (current.snippets.length < 8) current.snippets.push(makeLocateSnippet({ ...item, score, source }))
  byPath.set(normalizedPath, current)
}

function finalizeLocateCandidates(byPath, limit = 18) {
  return [...byPath.values()]
    .map(item => {
      const normalizedPath = String(item.path || '').replace(/\\/g, '/').toLowerCase()
      const isReferencePath = /^(docs|temp|tmp|coverage|codemap|change-sessions|scripts\/real-scenarios)\//.test(normalizedPath) ||
        /^frontend\/design-preview\.html$/.test(normalizedPath) ||
        /\/i18n\//.test(normalizedPath) ||
        /\.(?:md|txt)$/.test(normalizedPath)
      const multiEvidenceBoost = Math.max(0, item.evidenceTypes.length - 1) * 10
      const score = Math.max(0, Number(item.score || 0) + multiEvidenceBoost + getLocatePathBoost(item.path) - Number(item.penalty || 0))
      const hasStrongEvidence = item.snippets.some(snippet => (
        snippet.type === 'path' ||
        snippet.type === 'symbol' ||
        (snippet.type === 'ui_text' && String(snippet.term || '').trim().length >= 4 && Number(snippet.score || 0) >= 28)
      ))
      const strongHitCount = item.snippets.filter(snippet => (
        (snippet.type === 'symbol' || snippet.type === 'ui_text') &&
        Number(snippet.score || 0) >= 34
      )).length
      let confidence = Math.max(0, Math.min(95, Math.round(score)))
      if (item.evidenceTypes.length === 1 && !item.evidenceTypes.includes('path')) {
        confidence = Math.min(confidence, !isReferencePath && strongHitCount >= 2 ? 86 : 64)
      }
      if (item.evidenceTypes.length === 1 && item.evidenceTypes.includes('codemap')) confidence = Math.min(confidence, 46)
      if (isReferencePath) confidence = Math.min(confidence, 60)
      let band = 'low'
      if (confidence >= 70 && item.evidenceTypes.length >= 2 && hasStrongEvidence) band = 'high'
      else if (confidence >= 82 && item.evidenceTypes.includes('path')) band = 'high'
      else if (confidence >= 45) band = 'medium'
      return {
        path: item.path,
        score,
        sortPathPriority: item.evidenceTypes.includes('path') ? 1 : 0,
        confidence,
        band,
        evidenceTypes: item.evidenceTypes,
        sources: item.sources,
        bestLine: item.bestLine,
        snippets: item.snippets,
        caution: item.penalty ? '命中文档、测试、i18n 或临时目录时已降权；请读取源码片段确认。' : undefined
      }
    })
    .sort((a, b) => b.confidence - a.confidence || b.sortPathPriority - a.sortPathPriority || b.score - a.score || a.path.localeCompare(b.path))
    .slice(0, limit)
}

function getParallelImplementationKey(filePath = '') {
  const normalized = String(filePath || '').replace(/\\/g, '/')
  const dir = path.dirname(normalized).replace(/\\/g, '/')
  const ext = path.extname(normalized).toLowerCase()
  const stem = path.basename(normalized, ext).toLowerCase()
  if (!stem || !ext) return null
  const baseStem = stem
    .replace(/(?:^|[-_.])(v\d+|ver\d+|version\d+|new|old|legacy|classic|main|shell|page|view|panel|backup|bak|copy|draft|refactor|rewrite)$/i, '')
    .replace(/[-_.]+$/g, '')
  if (!baseStem) return null
  return `${dir}/${baseStem}${ext}`
}

function getParallelImplementationVariantReason(filePath = '', relatedPath = '') {
  const getStem = value => path.basename(String(value || '').replace(/\\/g, '/'), path.extname(String(value || ''))).toLowerCase()
  const stems = [getStem(filePath), getStem(relatedPath)].filter(Boolean)
  const joined = stems.join(' ')
  if (/(^|[-_.])v\d+\b|\bver\d+\b|\bversion\d+\b/.test(joined)) return '同目录同扩展名存在版本后缀文件，可能是新版/旧版平行实现。'
  if (/(^|[-_.])(new|old|legacy|classic)\b/.test(joined)) return '同目录同扩展名存在新旧命名文件，可能是迁移残留或平行实现。'
  if (/(^|[-_.])(main|shell|page|view|panel)\b/.test(joined)) return '同目录同扩展名存在主入口/视图变体文件，修改前需要确认真实加载链路。'
  return '同目录同扩展名存在疑似变体文件，修改前需要确认真实入口。'
}

async function detectParallelImplementationRisks(projectPath = '', evidenceFiles = [], limit = 8, projectFiles = null) {
  if (!projectPath || !Array.isArray(evidenceFiles) || !evidenceFiles.length) return []
  const files = Array.isArray(projectFiles)
    ? projectFiles
    : await listProjectFilesForLocate(projectPath, 700)
  if (!files.length) return []
  const byVariantKey = new Map()
  for (const filePath of files) {
    const key = getParallelImplementationKey(filePath)
    if (!key) continue
    const group = byVariantKey.get(key) || []
    group.push(filePath)
    byVariantKey.set(key, group)
  }
  for (const [key, group] of [...byVariantKey.entries()]) {
    if (group.length < 2) byVariantKey.delete(key)
  }
  const risks = []
  const seen = new Set()
  for (const evidenceFile of evidenceFiles.slice(0, Math.max(limit, 12))) {
    const evidencePath = String(evidenceFile.path || '').replace(/\\/g, '/')
    const key = getParallelImplementationKey(evidencePath)
    if (!key) continue
    const relatedFiles = (byVariantKey.get(key) || [])
      .filter(filePath => filePath !== evidencePath)
      .slice(0, 6)
    if (!relatedFiles.length) continue
    const riskKey = [evidencePath, ...relatedFiles].sort().join('|').toLowerCase()
    if (seen.has(riskKey)) continue
    seen.add(riskKey)
    risks.push({
      type: 'parallel_implementation',
      evidencePath,
      relatedFiles,
      reason: getParallelImplementationVariantReason(evidencePath, relatedFiles[0]),
      verification: '读取事实命中文件及相关变体文件，确认当前运行入口、import/link/script 引用或样式加载顺序。'
    })
    if (risks.length >= limit) break
  }
  return risks
}

async function listProjectFilesForLocate(projectPath = '', timeoutMs = 8000, limit = 2500) {
  if (!projectPath) return []
  const result = await fastSearch.searchFiles({
    projectPath,
    pattern: '',
    limit: Math.max(100, Math.min(2500, Number(limit) || 2500)),
    timeoutMs
  })
  return (result.files || []).map(file => normalizeLocateEvidencePath(file.path || file.absolutePath, projectPath)).filter(Boolean)
}

async function runLocatePathBranch(projectPath = '', terms = [], limit = 40, projectFiles = null) {
  const files = Array.isArray(projectFiles)
    ? projectFiles
    : await listProjectFilesForLocate(projectPath)
  const weakPathTokens = new Set(['model', 'models', 'menu', 'trigger', 'dropdown', 'setting', 'settings', 'modal', 'dialog', 'custom', 'console', 'feature', 'features', 'main'])
  const pathTerms = terms
    .filter(term => ['path', 'symbol', 'keyword'].includes(classifyLocateTerm(term)))
    .filter(term => {
      const lower = String(term || '').toLowerCase()
      return classifyLocateTerm(term) === 'path' || (lower.length >= 6 && !weakPathTokens.has(lower))
    })
    .slice(0, 12)
  const results = []
  for (const filePath of files) {
    const lowerPath = filePath.toLowerCase()
    const base = path.basename(lowerPath)
    const pathParts = new Set(splitSearchIdentifier(lowerPath))
    for (const term of pathTerms) {
      const lowerTerm = String(term || '').replace(/\\/g, '/').toLowerCase()
      if (!lowerTerm) continue
      const termParts = splitSearchIdentifier(lowerTerm).filter(part => !weakPathTokens.has(part))
      const overlapCount = termParts.filter(part => pathParts.has(part) || lowerPath.includes(part)).length
      let score = 0
      if (lowerPath === lowerTerm) score = 180
      else if (lowerPath.endsWith(`/${lowerTerm}`)) score = 160
      else if (base === lowerTerm) score = 145
      else if (/[-_]/.test(lowerTerm) && (base.includes(lowerTerm) || lowerPath.includes(lowerTerm))) score = 96
      else if ((lowerTerm.includes('/') || lowerTerm.includes('.')) && lowerPath.includes(lowerTerm)) score = 45
      else if (termParts.length >= 2 && overlapCount >= 2) score = 34 + overlapCount * 8
      if (!score) continue
      results.push({
        path: filePath,
        type: 'path',
        source: 'path-index',
        term,
        score,
        preview: `path match: ${filePath}`
      })
      break
    }
  }
  return results
    .sort((a, b) => b.score - a.score || a.path.localeCompare(b.path))
    .slice(0, limit)
}

async function runLocateGrepBranch(projectPath = '', terms = [], limit = 80) {
  const rawTerms = terms
    .filter(term => classifyLocateTerm(term) !== 'path')
    .filter(term => String(term || '').length >= 2)
  const strongTerms = rawTerms.filter(term => !isWeakLocateTerm(term))
  const selected = (strongTerms.length ? strongTerms : rawTerms).slice(0, 12)
  if (!projectPath || !selected.length) return []
  const symbolTerms = selected.filter(term => classifyLocateTerm(term) === 'symbol' && !isWeakLocateTerm(term))
  const otherTerms = selected.filter(term => classifyLocateTerm(term) !== 'symbol' || isWeakLocateTerm(term))
  const primaryTerms = symbolTerms.length ? symbolTerms : selected
  const primaryPerLimit = Math.max(10, Math.ceil(limit / Math.max(1, Math.min(primaryTerms.length, 6))))
  const seen = new Set()
  const merged = []
  let rgHadFailure = false
  const searchTermsWithRg = async (termsToSearch, perTermLimit, scoreMultiplier = 1) => {
    // 一次 rg 多 -e，避免 N 次进程启动抖动
    const content = await fastSearch.searchContent({
      projectPath,
      patterns: termsToSearch,
      caseSensitive: false,
      fixedStrings: true,
      maxResults: Math.min(200, perTermLimit * Math.max(1, termsToSearch.length)),
      timeoutMs: LOCATE_CODE_BRANCH_TIMEOUT_MS
    })
    if (content.timedOut || (content.error && !content.stdout)) rgHadFailure = true
    const matches = fastSearch.parseContentMatches(content.stdout || '', {
      projectPath,
      maxResults: Math.min(200, perTermLimit * Math.max(1, termsToSearch.length))
    })
    for (const item of matches) {
      const matchedTerm = termsToSearch.find(term =>
        String(item.content || '').toLowerCase().includes(String(term).toLowerCase())
      ) || termsToSearch[0]
      const key = `${item.path}:${item.line}:${matchedTerm}`
      if (seen.has(key)) continue
      seen.add(key)
      const termType = classifyLocateTerm(matchedTerm)
      let score = getLocateTermStrength(matchedTerm, termType === 'ui_text' ? 'ui_text' : termType === 'symbol' ? 'symbol' : 'content')
      if (/\b(function|class|const|let|var|export|import|querySelector|getElementById|addEventListener|onclick)\b/.test(item.content || '')) score += 8
      if (String(item.content || '').includes(matchedTerm)) score += 6
      score = Math.floor(score * scoreMultiplier)
      merged.push({
        path: item.path,
        line: item.line,
        type: termType === 'ui_text' ? 'ui_text' : termType === 'symbol' ? 'symbol' : 'content',
        source: 'literal-grep',
        term: matchedTerm,
        score,
        preview: item.content
      })
    }
  }
  await searchTermsWithRg(primaryTerms, primaryPerLimit, 1)
  if (merged.length < Math.ceil(limit / 2) && otherTerms.length) {
    const otherPerLimit = Math.max(4, Math.ceil(primaryPerLimit / 2))
    await searchTermsWithRg(otherTerms, otherPerLimit, 0.5)
  }
  // 仅当 rg 完全不可用且零命中时才走极窄 JS 兜底（禁止再扫全库）
  const needFallback = rgHadFailure && !merged.length && !fastSearch.isRgAvailable()
  return merged
    .concat(needFallback ? await grepProjectFilesFallback(projectPath, selected, Math.min(limit, 40)) : [])
    .sort((a, b) => Number(b.score || 0) - Number(a.score || 0) || String(a.path).localeCompare(String(b.path)) || Number(a.line || 0) - Number(b.line || 0))
    .slice(0, limit)
}
function findNearestPathCandidates(input = {}) {
  const requestedPath = String(input.requestedPath || '').trim()
  const projectPath = String(input.projectPath || '').trim()
  const kind = input.kind || 'file'
  const limit = Math.max(1, Math.min(12, Number.parseInt(input.limit, 10) || 8))
  if (!requestedPath || !projectPath || !fs.existsSync(projectPath)) return []

  const byPath = new Map()
  const addCandidate = (candidatePath, source) => {
    if (!candidatePath) return
    const absolute = path.isAbsolute(candidatePath) ? path.resolve(candidatePath) : path.resolve(projectPath, candidatePath)
    if (!isInsideProject(projectPath, absolute) || !fs.existsSync(absolute)) return
    let stat
    try {
      stat = fs.statSync(absolute)
    } catch {
      return
    }
    if (kind === 'directory' ? !stat.isDirectory() : !stat.isFile()) return
    const scored = scorePathCandidate(absolute, requestedPath, projectPath, source)
    if (scored.score < 35) return
    const key = path.resolve(absolute).toLowerCase()
    const existing = byPath.get(key)
    if (!existing || scored.score > existing.score) {
      byPath.set(key, {
        path: absolute,
        relativePath: scored.relative,
        score: scored.score,
        reasons: scored.reasons,
        source
      })
    }
  }

  collectProjectPathCandidates(projectPath, kind).forEach(candidate => addCandidate(candidate, 'scan'))
  return [...byPath.values()]
    .sort((a, b) => b.score - a.score || a.relativePath.localeCompare(b.relativePath))
    .slice(0, limit)
}

function buildPathFailureResult(input = {}) {
  const requestedPath = String(input.requestedPath || '').trim()
  const resolvedPath = String(input.resolvedPath || '').trim()
  const projectPath = String(input.projectPath || '').trim()
  const errorType = input.errorType || 'path_not_found'
  const kind = input.kind || 'file'
  const candidates = findNearestPathCandidates({ requestedPath, projectPath, kind, limit: input.limit || 8 })
  return {
    success: false,
    error_type: errorType,
    error: errorType === 'not_a_file'
      ? `Resolved path is not a file: ${resolvedPath}`
      : errorType === 'not_a_directory'
        ? `Resolved path is not a directory: ${resolvedPath}`
        : `Path not found: ${resolvedPath}`,
    requested_path: requestedPath,
    resolved_path: resolvedPath,
    project_root: projectPath,
    expected_type: kind,
    nearest_candidates: candidates,
    candidate_count: candidates.length
  }
}

const handlers = {
  locate_code: async (args, ctx) => {
    const { projectPath, projectId } = ctx
    const startedAt = Date.now()
    try {
      const query = String(args.query || args.pattern || '').trim()
      const explicitTerms = Array.isArray(args.terms)
        ? args.terms.map(term => String(term || '').trim()).filter(Boolean)
        : []
      if (!query && !explicitTerms.length) return { success: false, error: 'Missing locate query or terms' }
      const limit = Math.max(4, Math.min(24, Number(args.limit || args.max_results) || 12))
      const terms = (explicitTerms.length ? explicitTerms : extractLocateTerms(query))
        .filter(Boolean)
        .filter((term, index, list) => list.findIndex(item => item.toLowerCase() === term.toLowerCase()) === index)
        .slice(0, 24)
      const projectFilesPromise = listProjectFilesForLocate(projectPath, LOCATE_CODE_BRANCH_TIMEOUT_MS)
      const branches = [
        {
          name: 'path-index',
          run: async () => runLocatePathBranch(projectPath, terms, 60, await projectFilesPromise)
        },
        {
          name: 'literal-grep',
          run: () => runLocateGrepBranch(projectPath, terms, 120)
        }
      ]
      const settled = await withTimeout(
        Promise.all(branches.map(branch => withTimeout(
          Promise.resolve().then(branch.run),
          LOCATE_CODE_BRANCH_TIMEOUT_MS,
          { __timeout: true }
        ).then(result => ({ name: branch.name, result })))),
        LOCATE_CODE_TIMEOUT_MS,
        branches.map(branch => ({ name: branch.name, result: { __timeout: true } }))
      )
      const byPath = new Map()
      const branchStats = []
      for (const branch of settled) {
        const result = branch.result
        if (Array.isArray(result)) {
          branchStats.push({ name: branch.name, count: result.length, timedOut: false })
          result.forEach(item => addLocateEvidence(byPath, item, projectPath))
        } else {
          branchStats.push({ name: branch.name, count: 0, timedOut: !!result?.__timeout })
        }
      }
      const evidenceFiles = finalizeLocateCandidates(byPath, limit)
      const implementationRisks = await detectParallelImplementationRisks(projectPath, evidenceFiles, 8, await projectFilesPromise)
      const highConfidence = evidenceFiles.filter(file => file.band === 'high')
      const mediumConfidence = evidenceFiles.filter(file => file.band === 'medium')
      const lowConfidence = evidenceFiles.filter(file => file.band === 'low')
      return {
        success: true,
        tool: 'locate_code',
        query,
        terms,
        mode: 'literal_evidence',
        contract: 'Facts only: this tool does not interpret natural language, recommend files, or choose an implementation path. It only reports literal path/content evidence for the keywords supplied by the model.',
        evidenceFiles,
        highConfidence,
        mediumConfidence,
        lowConfidence,
        implementationRisks,
        duplicateImplementationRisks: implementationRisks,
        parallel: {
          branchCount: branches.length,
          branches: branchStats,
          elapsedMs: Date.now() - startedAt,
          bounded: true,
          branchTimeoutMs: LOCATE_CODE_BRANCH_TIMEOUT_MS,
          totalTimeoutMs: LOCATE_CODE_TIMEOUT_MS
        },
        readPlan: [],
        batchReadPlan: null,
        nextActions: [],
        accuracyContract: implementationRisks.length
          ? 'Facts only. Similar new/old or parallel implementation files were found; verify real import/link/script/runtime loading before editing.'
          : 'Facts only. The model must decide relevance by reading actual source and loading paths.',
        factsOnly: true
      }
    } catch (e) {
      return { success: false, error: e.message }
    }
  },

  glob_files: async (args, ctx) => {
    const { resolvePath, projectPath } = ctx
    try {
      const basePath = resolvePath(args.path || '')
      if (!fs.existsSync(basePath)) {
        return buildPathFailureResult({
          requestedPath: args.path || '',
          resolvedPath: basePath,
          projectPath,
          kind: 'directory'
        })
      }
      if (!fs.statSync(basePath).isDirectory()) {
        return buildPathFailureResult({
          requestedPath: args.path || '',
          resolvedPath: basePath,
          projectPath,
          kind: 'directory',
          errorType: 'not_a_directory'
        })
      }
      const limit = args.limit ?? args.max_results ?? args.maxResults
      // 优先 rg --files（大项目远快于 JS 遍历）；失败再回退 JS
      const fast = await fastSearch.searchFiles({
        projectPath: projectPath || basePath,
        searchPath: basePath,
        pattern: args.pattern || '',
        limit,
        timeoutMs: 10000
      })
      let files = fast.files || []
      let engine = 'ripgrep'
      if ((!files.length && (fast.timedOut || fast.error)) || !fastSearch.isRgAvailable()) {
        files = await findFilesByGlobAsync({
          rootPath: projectPath || basePath,
          basePath,
          pattern: args.pattern || '',
          limit,
          includeHidden: args.include_hidden === true
        })
        engine = files.length ? 'js-walk' : (fast.engine || 'ripgrep')
      }
      return {
        success: true,
        pattern: args.pattern || '',
        path: basePath,
        files,
        count: files.length,
        engine,
        elapsedMs: fast.elapsedMs,
        timedOut: !!fast.timedOut
      }
    } catch (e) {
      return { success: false, error_type: 'glob_error', error: e.message, requested_path: args.path || '', pattern: args.pattern || '', project_root: projectPath }
    }
  },

  grep_code: async (args, ctx) => {
    const { resolvePath, projectPath } = ctx
    try {
      const rawPatterns = [
        args.pattern,
        ...(Array.isArray(args.patterns) ? args.patterns : [])
      ]
      const patterns = []
      const seenPatterns = new Set()
      for (const value of rawPatterns) {
        const pattern = String(value || '').trim().slice(0, 500)
        const key = pattern.toLowerCase()
        if (!pattern || seenPatterns.has(key)) continue
        seenPatterns.add(key)
        patterns.push(pattern)
        if (patterns.length >= 10) break
      }
      if (!patterns.length) {
        return { success: false, error: 'Missing search pattern' }
      }
      const maxResults = Math.min(Math.max(Number(args.max_results) || 25, 1), 100)
      const contextLines = Math.min(Math.max(Number(args.context_lines) || 0, 0), 5)
      const caseSensitive = !!args.case_sensitive
      // 默认固定字符串（快且安全）；仅 regex:true 时走正则
      const useRegex = args.regex === true
      const fileType = args.file_type || ''
      const searchPath = args.path ? resolvePath(args.path) : projectPath
      const startedAt = Date.now()

      // 单次 rg 多 -e 并行语义（比 N 次 spawn 更稳、更快）
      const contentResult = await fastSearch.searchContent({
        projectPath,
        searchPath,
        patterns,
        caseSensitive,
        fixedStrings: !useRegex,
        regex: useRegex,
        contextLines,
        maxResults,
        fileType,
        timeoutMs: 12000
      })

      let contentMatches = fastSearch.parseContentMatches(contentResult.stdout || '', {
        projectPath,
        maxResults
      }).map(item => ({ ...item, matchedPattern: patterns[0] }))

      // 若输出未标明是哪个 pattern，用简单包含关系标注
      if (patterns.length > 1) {
        contentMatches = contentMatches.map(item => {
          const hit = patterns.find(p => String(item.content || '').toLowerCase().includes(String(p).toLowerCase()))
          return { ...item, matchedPattern: hit || patterns[0] }
        })
      }

      // 路径名命中：用 rg --files 快路径，避免 JS 全库 walk
      const pathMatchLists = await runLimitedParallel(patterns.slice(0, 5), 5, async pattern => {
        const pathLike = getPathLikeSearchTerms(pattern)
        if (!pathLike.length) return []
        const collected = []
        for (const term of pathLike.slice(0, 3)) {
          const files = await fastSearch.searchFiles({
            projectPath,
            searchPath,
            pattern: term.includes('/') || term.includes('*') ? term : `*${term}*`,
            limit: Math.min(20, maxResults),
            timeoutMs: 6000
          })
          for (const f of files.files || []) {
            collected.push({
              path: f.path,
              line: null,
              content: `file-name/path match: ${f.path}`,
              reason: 'file-name/path match',
              matchedPattern: pattern,
              score: 80
            })
          }
        }
        return collected
      })
      const allPathMatches = pathMatchLists.flat()

      let usedFallback = false
      // 仅 rg 二进制不可用时才 JS 兜底；超时/错误不再扫全库
      if (!contentMatches.length && contentResult.timedOut === false && contentResult.error && !fastSearch.isRgAvailable()) {
        usedFallback = true
        const fallbackResults = await grepProjectFilesFallback(projectPath, patterns, maxResults)
        contentMatches = fallbackResults.map(item => ({
          path: item.path,
          line: item.line,
          content: String(item.preview || '').slice(0, 300),
          source: item.source,
          matchedPattern: item.term || patterns[0]
        }))
      }

      const seen = new Set()
      const matches = []
      for (const item of [...allPathMatches, ...contentMatches]) {
        const key = `${item.path}:${item.line || ''}:${item.content || ''}`
        if (seen.has(key)) continue
        seen.add(key)
        matches.push(item)
        if (matches.length >= maxResults) break
      }

      const engine = usedFallback
        ? 'js-fallback-limited'
        : (allPathMatches.length ? 'ripgrep+path' : 'ripgrep')

      return {
        success: true,
        pattern: patterns[0],
        patterns,
        path: searchPath,
        matches,
        totalMatches: matches.length,
        truncated: matches.length >= maxResults || !!contentResult.timedOut,
        engine,
        pathMatches: allPathMatches.slice(0, maxResults),
        parallelism: 1,
        elapsedMs: Date.now() - startedAt,
        timedOut: !!contentResult.timedOut,
        hint: contentResult.timedOut
          ? '搜索超时已截断。请缩小 path、提高关键词具体性，或减少 patterns。'
          : (matches.length === 0 && contentResult.error
            ? `rg 未返回命中或出错：${contentResult.error}。请换更具体关键词或限定 path。`
            : undefined)
      }
    } catch (e) {
      return { success: false, error: e.message }
    }
  },

  find_references: async (args, ctx) => {
    const { projectPath, projectId } = ctx
    try {
      const symbol = String(args.symbol || '').trim()
      if (!symbol) {
        return { success: false, error: 'Missing symbol name' }
      }
      const includeDefinitions = args.include_definitions !== false
      const impact = await changePlanner.analyzeImpact({
        projectId,
        projectPath,
        symbols: [symbol],
        limit: 30
      })
      if (!impact.success) {
        return { success: false, error: impact.error || 'Impact analysis failed' }
      }
      const symbolInfo = impact.symbols[0] || {}
      const definitions = []
      const references = []
      if (impact.affectedFiles) {
        for (const file of impact.affectedFiles) {
          for (const ref of file.referenceLines || []) {
            if (ref.isDefinition && includeDefinitions) {
              definitions.push({ path: file.path, line: ref.line, preview: ref.preview })
            } else if (!ref.isDefinition) {
              references.push({ path: file.path, line: ref.line, preview: ref.preview })
            }
          }
        }
      }
      return {
        success: true,
        symbol,
        definitions,
        references,
        ipcChannels: symbolInfo.ipcChannels || [],
        totalReferences: references.length,
        totalDefinitions: definitions.length,
        riskAssessment: symbolInfo.riskLevel || 'low',
        guidance: references.length > 0
          ? `修改此符号需要同步更新 ${references.length} 个引用位置`
          : '未找到外部引用，修改影响范围仅限定义文件'
      }
    } catch (e) {
      return { success: false, error: e.message }
    }
  },

  search_project: async (args, ctx) => {
    const result = await handlers.locate_code({
      query: args.query || args.pattern || '',
      terms: args.terms,
      limit: args.limit || args.max_results
    }, ctx)
    return { ...result, tool: 'search_project', compatibilityAlias: 'locate_code' }
  },

  discover_code: async (args, ctx) => {
    const result = await handlers.locate_code({
      query: args.query || args.userMessage || args.pattern || '',
      terms: args.terms,
      limit: args.limit || args.max_results
    }, ctx)
    return { ...result, tool: 'discover_code', compatibilityAlias: 'locate_code', deprecated: true }
  }
}

module.exports = {
  handlers,
  GLOB_IGNORE_DIRS,
  normalizeRelativePathForTool,
  globPatternToRegExp,
  findFilesByGlob,
  findPatternInFile,
  parseGrepCodeOutput,
  findPathMatchesForGrep,
  findNearestPathCandidates,
  buildPathFailureResult
}
