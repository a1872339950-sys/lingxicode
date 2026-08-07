/**
 * 诊断工具处理器
 * 包含：check_syntax 工具及相关辅助函数
 */

const path = require('path')
const fs = require('fs')
const syntaxChecker = require('../syntax-checker')
const { toProjectRelative } = require('../path-utils')
const runtimeDiagnostics = require('../runtime-diagnostics')
const { runProjectHealthScanInWorker } = require('../project-health-scan')
const { runRuntimeProbe } = require('../runtime-probe')
const { runRuntimeClosure } = require('../runtime-closure')
const { buildDiagnosticNavigation } = require('../diagnostic-navigator')

const DEFAULT_SCAN_ROOTS = ['.']
const DEFAULT_SCAN_CONCURRENCY = 6
const IGNORED_SCAN_SEGMENTS = new Set([
  'node_modules', 'dist', '.git', '__pycache__', '.tmp-real-scenarios', '.lingxi-temp-diagnostics',
  'change-sessions', 'codemap', 'release', 'releases', 'out', 'build',
  'tmp', 'temp', '.tmp', '.temp', 'logs', 'log', '.lingua', '.uploads', 'coverage'
])
const CHECKABLE_EXTENSIONS = new Set(['.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx', '.json', '.html', '.htm', '.css', '.scss', '.less', '.py'])

function summarizeRuntimeDiagnosticsSafe(options = {}) {
  try {
    // 透传 projectId/projectPath 给 runtime-diagnostics.summarize 做项目隔离过滤
    const result = runtimeDiagnostics.summarize(options)
    if (result && typeof result === 'object') return result
    return {
      success: false,
      ok: false,
      unavailable: true,
      error_count: 0,
      events: [],
      error: 'runtime diagnostics returned an invalid result'
    }
  } catch (error) {
    return {
      success: false,
      ok: false,
      unavailable: true,
      error_count: 0,
      events: [],
      error: `runtime diagnostics unavailable: ${error.message}`,
      next_action: 'continue_without_runtime_diagnostics'
    }
  }
}

function buildSyntaxWarningFromDiagnostics(diagnostics) {
  if (!diagnostics || diagnostics.ok === true) {
    const first = diagnostics?.results?.[0]
    return { valid: true, language: first?.language || 'unknown' }
  }
  const firstFailed = diagnostics.failed_files?.[0] || diagnostics.results?.find(item => item.valid === false)
  return {
    valid: false,
    language: firstFailed?.language || 'unknown',
    errors: firstFailed?.errors || [],
    hint: diagnostics.message || '文件写入成功但存在语法问题'
  }
}

function buildReadHintForSyntaxError(projectPath = '', filePath = '', error = {}) {
  const line = Number(error?.line || error?.loc?.line || 0)
  if (!Number.isFinite(line) || line <= 0) return null
  return {
    path: toProjectRelative(projectPath, filePath),
    start_line: Math.max(1, line - 8),
    end_line: line + 8,
    reason: `语法错误附近: L${line}${error?.column ? `:${error.column}` : ''}`
  }
}

function scanDelimiterStack(content = '', maxLine = Infinity) {
  const stack = []
  const pairs = { '{': '}', '[': ']', '(': ')' }
  const closers = new Set(['}', ']', ')'])
  let line = 1
  let column = 0
  let state = 'code'
  let escape = false
  let blockComment = false
  const text = String(content || '')

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]
    const next = text[index + 1]
    column += 1
    if (char === '\n') {
      line += 1
      column = 0
      if (state === 'line-comment') state = 'code'
      if (line > maxLine) break
      continue
    }
    if (line > maxLine) break

    if (state === 'line-comment') continue
    if (blockComment) {
      if (char === '*' && next === '/') {
        blockComment = false
        index += 1
        column += 1
      }
      continue
    }
    if (state === 'single' || state === 'double' || state === 'template') {
      if (escape) {
        escape = false
        continue
      }
      if (char === '\\') {
        escape = true
        continue
      }
      if ((state === 'single' && char === "'") || (state === 'double' && char === '"') || (state === 'template' && char === '`')) {
        state = 'code'
      }
      continue
    }

    if (char === '/' && next === '/') {
      state = 'line-comment'
      index += 1
      column += 1
      continue
    }
    if (char === '/' && next === '*') {
      blockComment = true
      index += 1
      column += 1
      continue
    }
    if (char === "'") {
      state = 'single'
      continue
    }
    if (char === '"') {
      state = 'double'
      continue
    }
    if (char === '`') {
      state = 'template'
      continue
    }
    if (pairs[char]) {
      stack.push({ char, expected: pairs[char], line, column })
      continue
    }
    if (closers.has(char)) {
      const last = stack[stack.length - 1]
      if (last?.expected === char) stack.pop()
    }
  }
  return stack
}

function getLineText(lines = [], line = 0) {
  return lines[Math.max(0, Number(line || 1) - 1)] || ''
}

function buildLikelyRepairHint(projectPath = '', filePath = '', error = {}) {
  if (path.extname(filePath).toLowerCase() !== '.js') return null
  let content = ''
  try {
    content = fs.readFileSync(filePath, 'utf8')
  } catch {
    return null
  }
  const lines = content.split(/\r\n|\r|\n/)
  const errorLine = Number(error?.line || error?.loc?.line || lines.length)
  const stack = scanDelimiterStack(content, Number.isFinite(errorLine) && errorLine > 0 ? errorLine : Infinity)
  const unclosed = stack
    .filter(item => item.char === '{' || item.char === '[' || item.char === '(')
    .slice(-6)
    .map(item => ({
      line: item.line,
      column: item.column,
      opener: item.char,
      expected: item.expected,
      text: getLineText(lines, item.line).trim().slice(0, 180)
    }))
  if (!unclosed.length) return null
  const primary = [...unclosed].reverse().find(item => item.opener === '{') || unclosed[unclosed.length - 1]
  const startLine = Math.max(1, primary.line - 8)
  const endLine = Math.min(lines.length, Math.max(errorLine, primary.line + 28))
  return {
    type: 'likely_unclosed_delimiter',
    path: toProjectRelative(projectPath, filePath),
    message: 'Parser reported the error later than the likely missing delimiter. Inspect the opener candidates before reading more ranges.',
    primary_candidate: primary,
    candidates: unclosed,
    focused_read_hint: {
      path: toProjectRelative(projectPath, filePath),
      start_line: startLine,
      end_line: endLine,
      reason: `likely unclosed ${primary.opener} from L${primary.line}; scanner reported L${errorLine}`
    },
    action: 'Try a minimal delimiter/comma repair around the primary candidate before repeatedly reading adjacent ranges.'
  }
}

function buildCodeFrameForSyntaxError(projectPath = '', filePath = '', error = {}, radius = 8) {
  const line = Number(error?.line || error?.loc?.line || 0)
  if (!Number.isFinite(line) || line <= 0) return null
  try {
    const content = fs.readFileSync(filePath, 'utf8')
    const lines = content.split(/\r\n|\r|\n/)
    const startLine = Math.max(1, line - radius)
    const endLine = Math.min(lines.length, line + radius)
    const numberWidth = String(endLine).length
    const numbered = []
    for (let current = startLine; current <= endLine; current += 1) {
      const marker = current === line ? '>' : ' '
      numbered.push(`${marker} ${String(current).padStart(numberWidth, ' ')} | ${lines[current - 1] || ''}`)
    }
    return {
      path: toProjectRelative(projectPath, filePath),
      start_line: startLine,
      end_line: endLine,
      error_line: line,
      error_column: Number(error?.column || error?.loc?.column || 0) || null,
      error_message: error?.message || '',
      repair_hint: buildLikelyRepairHint(projectPath, filePath, error),
      content: numbered.join('\n')
    }
  } catch {
    return null
  }
}

function getProjectRelativeParts(projectPath = '', filePath = '') {
  if (projectPath && isInsideProject(projectPath, filePath)) {
    return path.relative(path.resolve(projectPath), path.resolve(filePath)).split(/[\\/]+/).filter(Boolean)
  }
  return String(filePath || '').split(/[\\/]+/).filter(Boolean)
}

function shouldSkipSyntaxScanPath(filePath = '', projectPath = '') {
  const parts = getProjectRelativeParts(projectPath, filePath)
  if (parts.some(part => IGNORED_SCAN_SEGMENTS.has(part))) return true
  const base = path.basename(String(filePath || '')).toLowerCase()
  const generatedFiles = new Set(['.aimap.json', 'package-lock.json', 'pnpm-lock.yaml', 'yarn.lock', 'composer.lock', 'cargo.lock', 'go.sum'])
  if (generatedFiles.has(base)) return true
  if (String(filePath || '').endsWith('.bak')) return true
  return false
}

function isInsideProject(projectPath = '', targetPath = '') {
  const projectRoot = path.resolve(projectPath)
  const resolvedTarget = path.resolve(targetPath)
  if (resolvedTarget === projectRoot) return true
  return resolvedTarget.startsWith(projectRoot + path.sep)
}

function collectCheckableSyntaxFiles(dir, out = [], projectPath = '') {
  if (!dir || !fs.existsSync(dir) || shouldSkipSyntaxScanPath(dir, projectPath)) return out
  let entries = []
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return out
  }
  entries.sort((a, b) => a.name.localeCompare(b.name))
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name)
    if (shouldSkipSyntaxScanPath(fullPath, projectPath)) continue
    if (entry.isDirectory()) {
      collectCheckableSyntaxFiles(fullPath, out, projectPath)
    } else if (entry.isFile() && CHECKABLE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
      out.push(fullPath)
    }
  }
  return out
}

function yieldToEventLoop() {
  return new Promise(resolve => setImmediate(resolve))
}

async function collectCheckableSyntaxFilesAsync(dir, out = [], projectPath = '') {
  if (!dir || shouldSkipSyntaxScanPath(dir, projectPath)) return out
  let entries = []
  try {
    entries = await fs.promises.readdir(dir, { withFileTypes: true })
  } catch {
    return out
  }
  entries.sort((a, b) => a.name.localeCompare(b.name))
  await yieldToEventLoop()
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name)
    if (shouldSkipSyntaxScanPath(fullPath, projectPath)) continue
    if (entry.isDirectory()) {
      await collectCheckableSyntaxFilesAsync(fullPath, out, projectPath)
    } else if (entry.isFile() && CHECKABLE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
      out.push(fullPath)
    }
  }
  return out
}

function getProjectSyntaxScanRoots(projectPath = '', roots = []) {
  const requestedRoots = Array.isArray(roots) && roots.length ? roots : DEFAULT_SCAN_ROOTS
  const resolved = []
  for (const item of requestedRoots) {
    const root = path.resolve(projectPath, String(item || '').replace(/^[/\\]+/, ''))
    if (!isInsideProject(projectPath, root)) continue
    if (fs.existsSync(root)) resolved.push(root)
  }
  if (resolved.length) return resolved
  return [projectPath]
}

async function runSyntaxChecksWithConcurrency(files = [], projectPath = '', options = {}) {
  const maxFailureArg = options.max_failures ?? options.maxFailures
  const wantsAllFailures = maxFailureArg === 'all' || maxFailureArg === Infinity || options.full === true || options.fullScan === true
  const maxFailures = wantsAllFailures
    ? Math.max(1, files.length || 1)
    : Math.max(1, Math.min(5000, Number(maxFailureArg) || 12))
  const concurrency = Math.max(1, Math.min(12, Number(options.concurrency) || DEFAULT_SCAN_CONCURRENCY))
  const failedFiles = []
  const warningFiles = []
  let checkedCount = 0
  let cursor = 0

  async function worker() {
    while (cursor < files.length && failedFiles.length < maxFailures) {
      const filePath = files[cursor++]
      checkedCount += 1
      const syntaxResult = await syntaxChecker.checkFileSyntaxAsync(filePath)
      if (syntaxResult.valid === false) {
        const errors = Array.isArray(syntaxResult.errors) ? syntaxResult.errors.slice(0, 6) : []
        const firstError = errors[0]
        failedFiles.push({
          path: filePath,
          relative_path: toProjectRelative(projectPath, filePath),
          language: syntaxResult.language,
          errors,
          warnings: Array.isArray(syntaxResult.warnings) ? syntaxResult.warnings.slice(0, 4) : [],
          read_hint: firstError ? buildReadHintForSyntaxError(projectPath, filePath, firstError) : null,
          code_frame: firstError ? buildCodeFrameForSyntaxError(projectPath, filePath, firstError) : null,
          repair_hint: firstError ? buildLikelyRepairHint(projectPath, filePath, firstError) : null,
          durationMs: syntaxResult.durationMs
        })
      } else if (Array.isArray(syntaxResult.warnings) && syntaxResult.warnings.length) {
        warningFiles.push({
          path: filePath,
          relative_path: toProjectRelative(projectPath, filePath),
          language: syntaxResult.language,
          warnings: syntaxResult.warnings.slice(0, 4)
        })
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, files.length) }, () => worker()))
  failedFiles.sort((a, b) => String(a.relative_path || a.path).localeCompare(String(b.relative_path || b.path)))
  warningFiles.sort((a, b) => String(a.relative_path || a.path).localeCompare(String(b.relative_path || b.path)))
  return { failedFiles: failedFiles.slice(0, maxFailures), warningFiles, checkedCount }
}

async function scanProjectSyntax(projectPath = '', options = {}) {
  const startedAt = Date.now()
  const roots = getProjectSyntaxScanRoots(projectPath, options.roots)
  const files = []
  for (const root of roots) {
    await collectCheckableSyntaxFilesAsync(root, files, projectPath)
  }
  files.sort()
  if (!files.length) {
    return {
      success: false,
      ok: false,
      valid: false,
      requires_fix: true,
      checked_count: 0,
      total_candidates: 0,
      failed_count: 0,
      warning_count: 0,
      failed_files: [],
      warning_files: [],
      read_hints: [],
      code_frames: [],
      repair_hints: [],
      roots: roots.map(root => toProjectRelative(projectPath, root) || root),
      error: 'Project syntax scan found 0 checkable files. The project path may be wrong, unreadable, encoded incorrectly, or outside the expected project root.',
      next_action: 'verify_project_path_before_claiming_no_errors',
      message: '项目语法扫描没有找到任何可检查文件。不要把 0 文件扫描当成通过；先确认项目路径是否正确。'
    }
  }
  const { failedFiles, warningFiles, checkedCount } = await runSyntaxChecksWithConcurrency(files, projectPath, options)

  const readHints = failedFiles.map(item => item.read_hint).filter(Boolean)
  const codeFrames = failedFiles.map(item => item.code_frame).filter(Boolean)
  const repairHints = failedFiles.map(item => item.repair_hint || item.code_frame?.repair_hint).filter(Boolean)
  return {
    success: true,
    ok: failedFiles.length === 0,
    valid: failedFiles.length === 0,
    requires_fix: failedFiles.length > 0,
    checked_count: checkedCount,
    total_candidates: files.length,
    failed_count: failedFiles.length,
    warning_count: warningFiles.length,
    failed_files: failedFiles,
    warning_files: warningFiles.slice(0, 8),
    read_hints: readHints,
    code_frames: codeFrames,
    repair_hints: repairHints,
    next_action: failedFiles.length ? 'fix_failed_files_from_code_frames_or_read_hints_then_run_check_project_syntax_again' : 'continue',
    message: failedFiles.length
      ? `项目语法扫描发现 ${failedFiles.length} 个文件需要修复；优先根据 code_frames 和 repair_hints 做最小修复；上下文不足时每个失败文件最多按 read_hints 读取一次，不要反复读同一文件。`
      : `项目语法扫描通过：${checkedCount}/${files.length} 个文件。`,
    durationMs: Date.now() - startedAt
  }
}

async function buildPostEditDiagnostics(filePaths = [], projectPath = '') {
  const uniquePaths = [...new Set((Array.isArray(filePaths) ? filePaths : [filePaths])
    .filter(Boolean)
    .map(item => path.resolve(item)))]
  const startedAt = Date.now()
  const results = []

  for (const filePath of uniquePaths) {
    try {
      const syntaxResult = await syntaxChecker.checkFileSyntaxAsync(filePath)
      const firstError = Array.isArray(syntaxResult.errors) ? syntaxResult.errors[0] : null
      const readHint = firstError ? buildReadHintForSyntaxError(projectPath, filePath, firstError) : null
      const codeFrame = firstError ? buildCodeFrameForSyntaxError(projectPath, filePath, firstError) : null
      const repairHint = firstError ? buildLikelyRepairHint(projectPath, filePath, firstError) : null
      results.push({
        path: filePath,
        relative_path: toProjectRelative(projectPath, filePath),
        valid: syntaxResult.valid,
        language: syntaxResult.language,
        errors: Array.isArray(syntaxResult.errors) ? syntaxResult.errors.slice(0, 6) : [],
        warnings: Array.isArray(syntaxResult.warnings) ? syntaxResult.warnings.slice(0, 6) : [],
        read_hint: readHint,
        code_frame: codeFrame,
        repair_hint: repairHint,
        durationMs: syntaxResult.durationMs
      })
    } catch (error) {
      results.push({
        path: filePath,
        relative_path: toProjectRelative(projectPath, filePath),
        valid: null,
        language: 'unknown',
        errors: [{ message: error.message }],
        warnings: [],
        read_hint: null,
        durationMs: 0
      })
    }
  }

  const failedFiles = results.filter(item => item.valid === false)
  const unknownFiles = results.filter(item => item.valid === null)
  const transientUnknownFiles = unknownFiles.filter(item => isTransientDiagnosticFailure(item))
  const blockingUnknownFiles = unknownFiles.filter(item => !isTransientDiagnosticFailure(item))
  const ok = failedFiles.length === 0 && blockingUnknownFiles.length === 0
  const readHints = results.map(item => item.read_hint).filter(Boolean)
  const codeFrames = results.map(item => item.code_frame).filter(Boolean)
  const repairHints = results.map(item => item.repair_hint || item.code_frame?.repair_hint).filter(Boolean)

  return {
    ok,
    requires_fix: !ok,
    blocking: !ok,
    checked_count: results.length,
    checked_files: results.map(item => item.relative_path || item.path),
    passed_files: results.filter(item => item.valid === true).map(item => item.relative_path || item.path),
    failed_files: failedFiles,
    unknown_files: blockingUnknownFiles,
    diagnostic_warnings: transientUnknownFiles.map(item => ({
      path: item.relative_path || item.path,
      message: item.errors?.[0]?.message || 'post-edit diagnostic unavailable'
    })),
    read_hints: readHints,
    code_frames: codeFrames,
    repair_hints: repairHints,
    next_action: ok
      ? 'continue'
      : 'fix_post_edit_diagnostics_from_code_frames_before_final_reply',
    message: ok
      ? `编辑后诊断通过：${results.length} 个文件`
      : `编辑后诊断发现 ${failedFiles.length + unknownFiles.length} 个文件需要修复；先根据 code_frames 和 repair_hints 修复；上下文不足时每个失败文件最多按 read_hints 读取一次。`,
    durationMs: Date.now() - startedAt,
    results
  }
}

async function attachPostEditDiagnostics(result, filePaths = [], projectPath = '', runtimeCursor = null) {
  const diagnostics = await buildPostEditDiagnostics(filePaths, projectPath)
  result.postEditDiagnostics = diagnostics
  result.requires_fix = diagnostics.requires_fix
  result.next_action = diagnostics.next_action
  result.syntaxWarning = buildSyntaxWarningFromDiagnostics(diagnostics)
  const runtime = runtimeCursor
    ? runtimeDiagnostics.classifySinceMark(runtimeCursor, {
      limit: 40,
      projectId: runtimeCursor.projectId || '',
      projectPath: runtimeCursor.projectPath || projectPath
    })
    : {
      success: true,
      ok: true,
      total: 0,
      error_count: 0,
      warning_count: 0,
      events: [],
      summary: 'Post-edit runtime attribution unavailable because no pre-edit cursor was captured.',
      cursor: null,
      introduced: [],
      persisting: [],
      resolved: [],
      unrelated: summarizeRuntimeDiagnosticsSafe({ since_ms: 5 * 60 * 1000, limit: 40, projectPath }).events || [],
      introduced_error_count: 0,
      persisting_error_count: 0,
      resolved_requires_active_recheck: true,
      attribution: 'no-pre-edit-cursor'
    }
  result.runtimeDiagnostics = runtime
  const actionableRuntimeErrors = Number(runtime.introduced_error_count || 0) + Number(runtime.persisting_error_count || 0)
  if (!diagnostics.requires_fix && actionableRuntimeErrors > 0) {
    result.requires_runtime_review = true
    result.next_action = 'run_runtime_verify_live_and_fix_visible_runtime_failures_before_final_reply'
  }
  return result
}

function isTransientDiagnosticFailure(item = {}) {
  const text = [
    item.errors?.[0]?.message,
    item.error,
    item.message
  ].filter(Boolean).join('\n')
  return /EPIPE|service is no longer running|write EPIPE|closed pipe|broken pipe/i.test(text)
}

function normalizeWorkflowMode(value = '') {
  const mode = String(value || '').trim().toLowerCase()
  if (['health', 'project_health', 'full', 'full_scan', 'comprehensive', 'diagnose', 'diagnostic'].includes(mode)) return 'health'
  if (['syntax', 'check_syntax', 'repair_syntax', 'project_syntax'].includes(mode)) return 'syntax'
  if (['verify', 'post_change_verify', 'after_edit', 'post_edit'].includes(mode)) return 'verify'
  if (['review', 'quality', 'logic', 'fix_quality', 'logic_review'].includes(mode)) return 'review'
  if (['locate', 'search', 'discover', 'find'].includes(mode)) return 'locate'
  return 'triage'
}

function capturePostEditRuntimeBaseline(projectId = '', projectPath = '') {
  const cursor = runtimeDiagnostics.mark()
  const baseline = summarizeRuntimeDiagnosticsSafe({
    since_ms: 5 * 60 * 1000,
    limit: 40,
    projectId,
    projectPath
  })
  return { ...cursor, projectId, projectPath, baselineEvents: baseline.events || [] }
}

function isExplicitDeepDiagnostic(args = {}, maxFailures = 10) {
  return args.deep === true
    || args.full === true
    || args.fullScan === true
    || args.scope === 'deep'
    || args.scope === 'full'
    || maxFailures === 'all'
}

async function measureDiagnosticStep(result, key, fn) {
  const startedAt = Date.now()
  try {
    return await fn()
  } finally {
    result.timings_ms[key] = Date.now() - startedAt
  }
}

function buildSkippedDeepDiagnostics(deepDiagnostic = false) {
  if (deepDiagnostic) return []
  return [
    'project_syntax_scan',
    'default_logic_review',
    'project_health_scan'
  ]
}

function summarizeSyntaxScan(scan = {}, options = {}) {
  const failedFiles = Array.isArray(scan.failed_files) ? scan.failed_files : []
  const frames = Array.isArray(scan.code_frames) ? scan.code_frames : []
  const repairHints = Array.isArray(scan.repair_hints) ? scan.repair_hints : []
  const readHints = Array.isArray(scan.read_hints) ? scan.read_hints : []
  const limit = options.full === true || options.fullScan === true ? Number.MAX_SAFE_INTEGER : 10
  return {
    ok: !!scan.ok,
    checked_count: scan.checked_count || scan.checked || scan.total || 0,
    total_candidates: scan.total_candidates || scan.checked_count || scan.checked || scan.total || 0,
    failed_count: failedFiles.length,
    warning_count: scan.warning_count || 0,
    warning_files: Array.isArray(scan.warning_files) ? scan.warning_files.slice(0, limit) : [],
    failed_files: failedFiles.slice(0, limit),
    code_frames: frames.slice(0, limit),
    repair_hints: repairHints.slice(0, limit),
    read_hints: readHints.slice(0, limit),
    next_action: failedFiles.length
      ? '先按 code_frames/repair_hints 对失败文件做最小修复，再重新调用 dev_workflow mode=syntax 验证。不要反复读同一文件相邻片段。'
      : '语法扫描通过；如果本轮改过文件，继续 mode=verify 做改后综合验证。'
  }
}

function summarizeDiscovery(result = {}) {
  const candidates = Array.isArray(result.candidates) ? result.candidates : []
  const files = Array.isArray(result.files) ? result.files : []
  const readHints = Array.isArray(result.readHints) ? result.readHints : []
  const focusedSnippets = Array.isArray(result.focusedSnippets) ? result.focusedSnippets : []
  const relatedFiles = Array.isArray(result.relatedFiles) ? result.relatedFiles : []
  return {
    query: result.query || '',
    mode: 'evidence_search',
    quality: result.quality || null,
    evidenceFiles: candidates.slice(0, 10),
    files: files.slice(0, 10),
    evidenceRefs: readHints.slice(0, 10),
    focusedSnippets: focusedSnippets.slice(0, 8),
    relatedFiles: relatedFiles.slice(0, 8),
    next_action: 'This is factual evidence only. The model must decide relevance from source, imports, runtime behavior, and counter-evidence.'
  }
}

function normalizeReviewFiles(files = [], projectPath = '') {
  return (Array.isArray(files) ? files : [])
    .map(item => String(item || '').trim())
    .filter(Boolean)
    .map(item => path.isAbsolute(item) ? item : path.join(projectPath, item))
    .filter(filePath => fs.existsSync(filePath) && fs.statSync(filePath).isFile())
    .slice(0, 30)
}

function addLogicFinding(findings, item = {}) {
  findings.push({
    severity: item.severity || 'warning',
    type: item.type || 'logic-risk',
    path: item.path || '',
    line: item.line || null,
    message: item.message || '',
    evidence: item.evidence || '',
    suggestion: item.suggestion || ''
  })
}

function findLineNumber(content = '', index = 0) {
  return String(content || '').slice(0, Math.max(0, index)).split(/\r\n|\r|\n/).length
}

function collectUiStateReviewFiles(projectPath = '') {
  const files = []
  collectCheckableSyntaxFiles(path.join(projectPath, 'frontend'), files, projectPath)
  return files
    .filter(filePath => ['.js', '.html', '.htm', '.css', '.scss', '.less'].includes(path.extname(filePath).toLowerCase()))
    .slice(0, 1000)
}

async function collectUiStateReviewFilesAsync(projectPath = '') {
  const files = []
  await collectCheckableSyntaxFilesAsync(path.join(projectPath, 'frontend'), files, projectPath)
  return files
    .filter(filePath => ['.js', '.html', '.htm', '.css', '.scss', '.less'].includes(path.extname(filePath).toLowerCase()))
    .slice(0, 1000)
}

async function readTextForReview(filePath = '') {
  try {
    return await fs.promises.readFile(filePath, 'utf8')
  } catch (error) {
    return { __readError: error }
  }
}

function reviewUiClassStateContracts(files = [], projectPath = '', contentByPath = null) {
  const findings = []
  const idClassMutations = []
  const gatedSelectors = []
  const directSelectors = new Set()

  for (const filePath of files) {
    let content = ''
    try {
      content = contentByPath && contentByPath.has(filePath)
        ? contentByPath.get(filePath)
        : fs.readFileSync(filePath, 'utf8')
    } catch (_) {
      continue
    }
    if (typeof content !== 'string') continue
    const relativePath = toProjectRelative(projectPath, filePath)
    const ext = path.extname(filePath).toLowerCase()

    if (['.js', '.html', '.htm'].includes(ext)) {
      const variableIds = new Map()
      for (const match of content.matchAll(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*document\.getElementById\(\s*['"]([^'"]+)['"]\s*\)/g)) {
        variableIds.set(match[1], match[2])
      }
      for (const match of content.matchAll(/\b([A-Za-z_$][\w$]*)\.classList\.(add|toggle|remove)\(\s*['"]([A-Za-z0-9_-]+)['"]/g)) {
        const id = variableIds.get(match[1])
        if (!id) continue
        idClassMutations.push({
          id,
          className: match[3],
          path: relativePath,
          line: findLineNumber(content, match.index),
          evidence: match[0]
        })
      }
      for (const match of content.matchAll(/document\.getElementById\(\s*['"]([^'"]+)['"]\s*\)\.classList\.(add|toggle|remove)\(\s*['"]([A-Za-z0-9_-]+)['"]/g)) {
        idClassMutations.push({
          id: match[1],
          className: match[3],
          path: relativePath,
          line: findLineNumber(content, match.index),
          evidence: match[0]
        })
      }
    }

    if (['.css', '.scss', '.less', '.html', '.htm'].includes(ext)) {
      for (const match of content.matchAll(/([^{}]+)\{[^{}]*\}/g)) {
        const selectors = String(match[1] || '').split(',').map(item => item.trim()).filter(Boolean)
        for (const selector of selectors) {
          for (const target of selector.matchAll(/#([A-Za-z0-9_-]+)/g)) {
            const id = target[1]
            if (new RegExp(`#${id}\\.show\\b`).test(selector)) {
              directSelectors.add(`${id}:show`)
            }
            if (/\.show\b/.test(selector) && !new RegExp(`#${id}\\.show\\b`).test(selector) && selector.indexOf('.show') < target.index) {
              gatedSelectors.push({
                id,
                className: 'show',
                selector,
                path: relativePath,
                line: findLineNumber(content, match.index)
              })
            }
          }
        }
      }
    }
  }

  for (const mutation of idClassMutations) {
    const gated = gatedSelectors.find(item => item.id === mutation.id && item.className === mutation.className)
    if (!gated || directSelectors.has(`${mutation.id}:${mutation.className}`)) continue
    addLogicFinding(findings, {
      severity: 'warning',
      type: 'ui-class-state-owner-mismatch',
      path: mutation.path,
      line: mutation.line,
      message: `JS toggles .${mutation.className} on #${mutation.id}, but CSS has a descendant gate for #${mutation.id} that expects .${mutation.className} on an ancestor.`,
      evidence: `${mutation.evidence} | CSS: ${gated.selector}`,
      suggestion: `Trace DOM -> JS -> CSS -> computed style. Either toggle .${mutation.className} on the selector owner used by CSS, or add a direct #${mutation.id}.${mutation.className} rule. Then verify with runtime_verify semantic interaction.`
    })
  }

  return findings
}

function inferClickSelectorCandidates(targetId = '') {
  const id = String(targetId || '').trim()
  if (!id) return []
  const candidates = []
  const push = value => {
    if (value && !candidates.includes(value)) candidates.push(value)
  }
  if (/menu$/i.test(id)) push(`#${id.replace(/menu$/i, 'Trigger')}`)
  if (/panel$/i.test(id)) push(`#${id.replace(/panel$/i, 'Trigger')}`)
  if (/dropdown$/i.test(id)) push(`#${id.replace(/dropdown$/i, 'Trigger')}`)
  push(`[aria-controls="${id}"]`)
  push(`[data-target="#${id}"]`)
  push(`[data-toggle-target="#${id}"]`)
  return candidates
}

function buildUiBehaviorVerificationAdvice(findings = []) {
  return (Array.isArray(findings) ? findings : [])
    .filter(item => item.type === 'ui-class-state-owner-mismatch')
    .slice(0, 8)
    .map(item => {
      const sourceText = `${item.message || ''} ${item.evidence || ''}`
      const targetId = sourceText.match(/#([A-Za-z0-9_-]+)/)?.[1] || ''
      const className = sourceText.match(/\.([A-Za-z0-9_-]+)/)?.[1] || 'show'
      const selectorOwner = String(item.evidence || '').match(/CSS:\s*([^|]+)$/)?.[1]?.trim() || ''
      const clickSelectors = inferClickSelectorCandidates(targetId)
      const inspectSelectors = [
        targetId ? `#${targetId}` : '',
        selectorOwner,
        ...clickSelectors
      ].filter(Boolean)
      return {
        reason: item.message,
        source: { path: item.path, line: item.line },
        state_class: className,
        target_selector: targetId ? `#${targetId}` : '',
        selector_owner: selectorOwner,
        suggested_click_selectors: clickSelectors,
        suggested_tool: 'runtime_verify',
        suggested_args: {
          target: 'main_window',
          click_selector: clickSelectors[0] || '',
          expected_visible_selector: targetId ? `#${targetId}` : '',
          inspect_selectors: [...new Set(inspectSelectors)],
          close_selector: 'body',
          repeat_open: true,
          wait_after_click_ms: 500,
          observe_ms: 1500,
          fail_on_console_error: true
        },
        lifecycle_to_verify: ['open', 'keep-visible-after-open', 'close', 'repeat-open', 'console-errors-after-observation']
      }
    })
}

function reviewFileLogicQuality(filePath = '', projectPath = '', contentOverride = undefined) {
  const findings = []
  const relativePath = toProjectRelative(projectPath, filePath)
  let content = ''
  try {
    content = typeof contentOverride === 'string'
      ? contentOverride
      : fs.readFileSync(filePath, 'utf8')
  } catch (error) {
    addLogicFinding(findings, {
      severity: 'warning',
      type: 'read-failed',
      path: relativePath,
      message: '无法读取文件做逻辑审查。',
      evidence: error.message
    })
    return findings
  }

  for (const match of content.matchAll(/Promise[.]resolve[(][)]\s*[.]catch\s*[(]/g)) {
    addLogicFinding(findings, {
      severity: 'error',
      type: 'dead-error-handler',
      path: relativePath,
      line: findLineNumber(content, match.index),
      message: '已完成的 Promise 后面接 catch 不会进入错误分支，错误处理逻辑实际不会触发。',
      evidence: 'resolved Promise followed by catch',
      suggestion: '如果这里要进入错误分支，应显式设置错误状态或抛出/传入真实 Promise；不要用已 resolve 的 Promise 伪造错误处理。'
    })
  }

  for (const match of content.matchAll(/current\.exists\s*&&\s*current\.hash\s*!==\s*file\.beforeHash/g)) {
    addLogicFinding(findings, {
      severity: 'error',
      type: 'rollback-conflict-hash-contract',
      path: relativePath,
      line: findLineNumber(content, match.index),
      message: 'Rollback conflict detection compares the current file with beforeHash. After an AI edit, the current file should match afterHash; comparing with beforeHash makes valid rollback look conflicted.',
      evidence: match[0],
      suggestion: 'Compare current.hash with file.afterHash when checking whether the file changed after the AI edit.'
    })
  }

  if (/function\s+readLocalAppsCache\s*\(/.test(content) &&
      /readCustomApps\s*\(/.test(content) &&
      /apps\s*:\s*filterDisplayableApps\s*\(\s*data\.apps\s*\)/.test(content)) {
    const index = content.search(/apps\s*:\s*filterDisplayableApps\s*\(\s*data\.apps\s*\)/)
    addLogicFinding(findings, {
      severity: 'error',
      type: 'custom-app-cache-merge-lost',
      path: relativePath,
      line: findLineNumber(content, index),
      message: 'Local app cache hit returns only cached scanned apps and drops custom apps.',
      evidence: 'apps: filterDisplayableApps(data.apps)',
      suggestion: 'Merge cached scanned apps with readCustomApps() before filtering displayable apps.'
    })
  }

  for (const match of content.matchAll(/\.sort\s*\(\s*\(\s*a\s*,\s*b\s*\)\s*=>\s*a\.score\s*-\s*b\.score/g)) {
    addLogicFinding(findings, {
      severity: 'error',
      type: 'candidate-score-sort-inverted',
      path: relativePath,
      line: findLineNumber(content, match.index),
      message: 'Candidate ranking sorts lower scores first, so weak matches can outrank strong evidence.',
      evidence: match[0],
      suggestion: 'Sort by b.score - a.score for descending relevance.'
    })
  }

  for (const match of content.matchAll(/data\.status\s*===\s*['"]done['"][\s\S]{0,180}awaitingFinalReply\s*=\s*false/g)) {
    addLogicFinding(findings, {
      severity: 'error',
      type: 'final-reply-awaiting-state-cleared',
      path: relativePath,
      line: findLineNumber(content, match.index),
      message: 'The done status clears awaitingFinalReply before the final message arrives. This can collapse the thinking/tool block too early or lose the smooth handoff to the final reply.',
      evidence: match[0].replace(/\s+/g, ' ').slice(0, 180),
      suggestion: 'When backend sends ai-status:done before message-reply, keep awaitingFinalReply=true until the reply listener finalizes the run.'
    })
  }

  for (const match of content.matchAll(/function\s+readCapabilities\s*\([\s\S]{0,700}toolCalling\s*:\s*false/g)) {
    addLogicFinding(findings, {
      severity: 'error',
      type: 'tool-capability-forced-disabled',
      path: relativePath,
      line: findLineNumber(content, match.index),
      message: 'Model capability saving forces toolCalling to false, so a model configured with tool support can silently lose tools after saving settings.',
      evidence: 'readCapabilities() -> toolCalling: false',
      suggestion: 'Read the checkbox/model capability state instead of hardcoding false.'
    })
  }

  if (/^frontend[\\/]/i.test(relativePath) && /(?:const|let|var)\s+contextUI\s*=\s*window\.ContextUI/.test(content)) {
    for (const match of content.matchAll(/contextUI\.updateIndicator\s*\(/g)) {
      addLogicFinding(findings, {
        severity: 'warning',
        type: 'context-ui-contract-risk',
        path: relativePath,
        line: findLineNumber(content, match.index),
        message: 'contextUI.updateIndicator is called. Verify ContextUI actually exports updateIndicator; a missing export causes a runtime TypeError that syntax checks will not catch.',
        evidence: match[0],
        suggestion: 'Align the caller with ContextUI exports, or add the missing exported method with the expected signature.'
      })
    }
  }

  for (const match of content.matchAll(/const\s+cachedInputCost\s*=\s*cachedTokens[^\n\r]*profile\.missInputPerMillion/g)) {
    addLogicFinding(findings, {
      severity: 'error',
      type: 'cached-cost-rate-swapped',
      path: relativePath,
      line: findLineNumber(content, match.index),
      message: 'Cached input cost uses the cache-miss price tier, which inflates or distorts budget estimates.',
      evidence: match[0].replace(/\s+/g, ' ').slice(0, 160),
      suggestion: 'Use profile.cachedInputPerMillion for cached tokens and profile.missInputPerMillion for uncached tokens.'
    })
  }

  for (const match of content.matchAll(/const\s+missInputCost\s*=\s*missTokens[^\n\r]*profile\.cachedInputPerMillion/g)) {
    addLogicFinding(findings, {
      severity: 'error',
      type: 'miss-cost-rate-swapped',
      path: relativePath,
      line: findLineNumber(content, match.index),
      message: 'Uncached input cost uses the cached price tier, so budget estimates undercount cache misses.',
      evidence: match[0].replace(/\s+/g, ' ').slice(0, 160),
      suggestion: 'Use profile.missInputPerMillion for uncached tokens.'
    })
  }

  for (const match of content.matchAll(/\b[A-Za-z_$][\w$]*\.length\s*<\s*0(?!\s*\.\d|\d)/g)) {
    addLogicFinding(findings, {
      severity: 'error',
      type: 'impossible-length-condition',
      path: relativePath,
      line: findLineNumber(content, match.index),
      message: '数组/字符串 length 小于 0 永远为 false。',
      evidence: match[0],
      suggestion: '需要判断为空时使用 length <= 0 或 length === 0，并确认后续分支真的会执行。'
    })
  }

  for (const match of content.matchAll(/const\s+(\w*key\w*|\w*Key\w*)\s*=\s*projectId\s*\|\|\s*fallback\b(?!\s*\|\|)/g)) {
    addLogicFinding(findings, {
      severity: 'warning',
      type: 'weak-project-state-key',
      path: relativePath,
      line: findLineNumber(content, match.index),
      message: '项目隔离状态 key 只使用 projectId || fallback，缺少最终 default/String 兜底时容易出现 undefined key 或非字符串 key。',
      evidence: match[0],
      suggestion: '建议使用 String(projectId || fallback || "default")，避免不同项目状态串扰或 undefined key。'
    })
  }

  if (/cacheUsageViewStates/.test(content) && /const\s+key\s*=\s*projectId\s*\|\|\s*fallback\b(?!\s*\|\|)/.test(content)) {
    addLogicFinding(findings, {
      severity: 'warning',
      type: 'cache-state-isolation-regression',
      path: relativePath,
      line: findLineNumber(content, content.search(/const\s+key\s*=\s*projectId\s*\|\|\s*fallback\b/)),
      message: '缓存命中率 UI 的项目隔离 key 缺少 default/String 兜底，可能导致状态隔离不稳。',
      evidence: 'cacheUsageViewStates + const key = projectId || fallback',
      suggestion: '恢复为 String(projectId || fallback || "default")。'
    })
  }

  for (const match of content.matchAll(/normalizedTarget\s*\.startsWith\s*\(\s*normalizePath\s*\(\s*rule\.path\s*\)\s*\)/g)) {
    addLogicFinding(findings, {
      severity: 'error',
      type: 'unsafe-path-prefix-boundary',
      path: relativePath,
      line: findLineNumber(content, match.index),
      message: '目录授权退化成字符串前缀匹配，容易把同名前缀目录误判为授权目录内。',
      evidence: match[0],
      suggestion: '使用 path.relative 或统一的 isInsideProject/isInsideDirectory 边界判断，确保相等或以路径分隔符进入子目录。'
    })
  }

  for (const match of content.matchAll(/const\s+shouldRender\s*=\s*[^;\n]*data\.projectId\s*!==\s*activeProjectId[^\n;]*/g)) {
    addLogicFinding(findings, {
      severity: 'error',
      type: 'project-visibility-inversion',
      path: relativePath,
      line: findLineNumber(content, match.index),
      message: '项目隔离显示条件被反转，可能把当前项目的缓存/费用状态隐藏，把其他项目状态显示出来。',
      evidence: match[0],
      suggestion: '当前项目应匹配 projectId 后显示，非当前项目应跳过；同时 key 使用项目隔离兜底。'
    })
  }

  for (const match of content.matchAll(/actualProjectPath\s*=[\s\S]{0,160}parent\?\.storagePath/g)) {
    addLogicFinding(findings, {
      severity: 'error',
      type: 'project-path-storage-path-confusion',
      path: relativePath,
      line: findLineNumber(content, match.index),
      message: '子会话的实际项目路径使用了存储路径，可能污染协作/临时 Agent 的工作目录。',
      evidence: match[0].replace(/\s+/g, ' ').slice(0, 180),
      suggestion: '实际项目路径应来自 parent.projectPath/userProjectPath；storagePath 只用于历史和会话文件存储。'
    })
  }

  for (const match of content.matchAll(/reloadActiveBranchSession[\s\S]{0,1200}ensureRunningAiBlockVisible\s*\([\s\S]{0,260}replay\s*:\s*true/g)) {
    addLogicFinding(findings, {
      severity: 'error',
      type: 'running-operation-duplicate-replay',
      path: relativePath,
      line: findLineNumber(content, match.index),
      message: '分支/会话刷新时对运行中 AI 块强制 replay，可能重复回放已经显示过的工具和进度。',
      evidence: match[0].replace(/\s+/g, ' ').slice(0, 180),
      suggestion: '刷新运行态时应区分首次恢复和运行中续接，已有 operationCount 时不要 replay 已消费记录。'
    })
  }

  for (const match of content.matchAll(/options\.replay\s*===\s*false[\s\S]{0,500}runtime\.operationCount\s*=\s*project\.aiOperations\.length/g)) {
    addLogicFinding(findings, {
      severity: 'error',
      type: 'running-operation-missed-replay',
      path: relativePath,
      line: findLineNumber(content, match.index),
      message: '禁用 replay 时把 operationCount 直接推进到历史末尾，切回运行中项目可能漏掉进度/工具回放。',
      evidence: match[0].replace(/\s+/g, ' ').slice(0, 180),
      suggestion: '禁用 replay 只应影响本次主动重放，不应吞掉之后需要续接的运行记录。'
    })
  }

  return findings
}

async function reviewFileLogicQualityAsync(filePath = '', projectPath = '') {
  const content = await readTextForReview(filePath)
  if (typeof content !== 'string') return reviewFileLogicQuality(filePath, projectPath)
  return reviewFileLogicQuality(filePath, projectPath, content)
}

function collectDefaultReviewFiles(projectPath = '') {
  const files = []
  for (const root of DEFAULT_SCAN_ROOTS) {
    const fullRoot = path.join(projectPath, root)
    collectCheckableSyntaxFiles(fullRoot, files, projectPath)
  }
  return files
    .filter(filePath => ['.js', '.mjs', '.cjs'].includes(path.extname(filePath).toLowerCase()))
    .slice(0, 800)
}

async function collectDefaultReviewFilesAsync(projectPath = '') {
  const files = []
  for (const root of DEFAULT_SCAN_ROOTS) {
    const fullRoot = path.join(projectPath, root)
    await collectCheckableSyntaxFilesAsync(fullRoot, files, projectPath)
  }
  return files
    .filter(filePath => ['.js', '.mjs', '.cjs'].includes(path.extname(filePath).toLowerCase()))
    .slice(0, 800)
}

function buildLogicReviewReadHints(findings = []) {
  return findings
    .filter(item => item.path && item.line)
    .slice(0, 12)
    .map(item => ({
      path: item.path,
      start_line: Math.max(1, Number(item.line || 1) - 8),
      end_line: Number(item.line || 1) + 12,
      reason: `${item.type}: ${item.message}`
    }))
}

function buildLogicReviewResult({ explicitFiles = [], resolvedFiles = [], includeUiStateContracts = false, uiStateReviewedCount = 0, findings = [] } = {}) {
  const uiBehaviorVerification = buildUiBehaviorVerificationAdvice(findings)
  const errorCount = findings.filter(item => item.severity === 'error').length
  const warningCount = findings.filter(item => item.severity !== 'error').length
  return {
    ok: errorCount === 0,
    scope: explicitFiles.length ? 'specified_files' : 'default_production_scan',
    reviewed_count: resolvedFiles.length,
    ui_state_reviewed_count: uiStateReviewedCount,
    skipped_ui_state_contracts: !includeUiStateContracts,
    error_count: errorCount,
    warning_count: warningCount,
    findings,
    requires_ui_behavior_verification: uiBehaviorVerification.length > 0,
    ui_behavior_verification: uiBehaviorVerification,
    read_hints: buildLogicReviewReadHints(findings),
    next_action: errorCount
      ? 'Fix severity=error logic_review findings first, then rerun dev_workflow mode=review.'
      : (uiBehaviorVerification.length
          ? 'Verify UI state risks with runtime_verify semantic interaction before final reply.'
          : (warningCount ? 'Review warnings against the user-visible scenario before deciding whether to fix.' : 'No obvious fake-fix pattern found.'))
  }
}

function reviewFixQuality(files = [], projectPath = '', options = {}) {
  const explicitFiles = normalizeReviewFiles(files, projectPath)
  const skipDefaultScan = options.skipDefaultScan === true && explicitFiles.length === 0
  const resolvedFiles = explicitFiles.length
    ? explicitFiles
    : (skipDefaultScan ? [] : collectDefaultReviewFiles(projectPath))
  const includeUiStateContracts = !skipDefaultScan && (options.includeUiStateContracts === true || options.deep === true || explicitFiles.length === 0)
  const findings = []
  for (const filePath of resolvedFiles) {
    findings.push(...reviewFileLogicQuality(filePath, projectPath))
  }
  let uiStateReviewedCount = 0
  if (includeUiStateContracts) {
    const uiStateFiles = collectUiStateReviewFiles(projectPath)
    uiStateReviewedCount = uiStateFiles.length
    findings.push(...reviewUiClassStateContracts(uiStateFiles, projectPath))
  }
  const uiBehaviorVerification = buildUiBehaviorVerificationAdvice(findings)
  const errorCount = findings.filter(item => item.severity === 'error').length
  const warningCount = findings.filter(item => item.severity !== 'error').length
  return {
    ok: errorCount === 0,
    scope: explicitFiles.length ? 'specified_files' : 'default_production_scan',
    reviewed_count: resolvedFiles.length,
    ui_state_reviewed_count: uiStateReviewedCount,
    skipped_ui_state_contracts: !includeUiStateContracts,
    error_count: errorCount,
    warning_count: warningCount,
    findings,
    requires_ui_behavior_verification: uiBehaviorVerification.length > 0,
    ui_behavior_verification: uiBehaviorVerification,
    read_hints: buildLogicReviewReadHints(findings),
    next_action: errorCount
      ? '先修复 logic_review 中 severity=error 的假修复/无效分支，再重新调用 dev_workflow mode=review。'
      : (uiBehaviorVerification.length
          ? 'UI 状态类风险需要用 runtime_verify 做语义 DOM 交互闭环：打开、保持、关闭、重复打开，并观察 console/runtime error 后再回复。'
          : (warningCount ? '有 warning 时先判断是否会影响用户场景；影响则修复，不影响可在最终回复说明风险。' : '未发现明显假修复模式。'))
  }
}

async function reviewFixQualityAsync(files = [], projectPath = '', options = {}) {
  const explicitFiles = normalizeReviewFiles(files, projectPath)
  const skipDefaultScan = options.skipDefaultScan === true && explicitFiles.length === 0
  const resolvedFiles = explicitFiles.length
    ? explicitFiles
    : (skipDefaultScan ? [] : await collectDefaultReviewFilesAsync(projectPath))
  const includeUiStateContracts = !skipDefaultScan && (options.includeUiStateContracts === true || options.deep === true || explicitFiles.length === 0)
  const findings = []

  for (let index = 0; index < resolvedFiles.length; index += 1) {
    findings.push(...await reviewFileLogicQualityAsync(resolvedFiles[index], projectPath))
    if (index % 20 === 19) await yieldToEventLoop()
  }

  let uiStateReviewedCount = 0
  if (includeUiStateContracts) {
    const uiStateFiles = await collectUiStateReviewFilesAsync(projectPath)
    uiStateReviewedCount = uiStateFiles.length
    const contentByPath = new Map()
    for (let index = 0; index < uiStateFiles.length; index += 1) {
      const filePath = uiStateFiles[index]
      const content = await readTextForReview(filePath)
      if (typeof content === 'string') contentByPath.set(filePath, content)
      if (index % 25 === 24) await yieldToEventLoop()
    }
    findings.push(...reviewUiClassStateContracts(uiStateFiles, projectPath, contentByPath))
  }

  return buildLogicReviewResult({
    explicitFiles,
    resolvedFiles,
    includeUiStateContracts,
    uiStateReviewedCount,
    findings
  })
}

async function runDevWorkflow(args = {}, ctx = {}) {
  const { projectId } = ctx
  const requestedProjectPath = args.project_path || args.projectPath || args.root_path || args.rootPath || ''
  const projectPath = requestedProjectPath
    ? path.resolve(String(requestedProjectPath))
    : ctx.projectPath
  const mode = normalizeWorkflowMode(args.mode || args.action)
  const query = String(args.query || args.userMessage || ctx.options?.userMessage || '').trim()
  const maxFailureArg = args.max_failures ?? args.maxFailures
  const maxFailures = (maxFailureArg === 'all' || args.full === true || args.fullScan === true)
    ? 'all'
    : Math.min(5000, Math.max(1, Number(maxFailureArg || 10) || 10))
  const fullScan = args.full === true || args.fullScan === true || maxFailures === 'all'
  const deepDiagnostic = isExplicitDeepDiagnostic(args, maxFailures)
  const explicitFiles = Array.isArray(args.files) && args.files.length ? args.files : []
  const result = {
    success: true,
    tool: 'dev_workflow',
    mode,
    query,
    integrated: true,
    diagnostic_depth: deepDiagnostic ? 'deep' : 'quick',
    skipped_deep_diagnostics: buildSkippedDeepDiagnostics(deepDiagnostic),
    timings_ms: {},
    next_action_policy: 'legacy_next_action_is_a_hint_not_an_instruction; use diagnostic_navigation, source reads, counter-evidence, and verification before deciding',
    integrated_steps: []
  }
  let triageSyntax = null
  const attachNavigation = () => {
    result.diagnostic_navigation = buildDiagnosticNavigation(result, { query })
    return result
  }

  if (mode === 'locate') {
    if (query) {
      result.summary = 'dev_workflow mode=locate 已降级：不再做自然语言候选定位。请由模型自行提炼具体关键词、DOM id、函数名、错误文本、文件名或路径片段，再使用事实搜索/读取工具。'
      result.factsOnly = true
      return result
    } else {
      return { success: false, tool: 'dev_workflow', mode, error: 'mode=locate 需要 query' }
    }
  }

  if (mode === 'health') {
    let syntax = null
    if (deepDiagnostic) {
      syntax = await measureDiagnosticStep(result, 'syntax_ms', () => scanProjectSyntax(projectPath, {
        roots: args.roots,
        max_failures: maxFailures,
        full: fullScan
      }))
      result.integrated_steps.push('check_project_syntax')
      result.syntax = summarizeSyntaxScan(syntax || {}, { full: fullScan })
    } else if (explicitFiles.length) {
      const postEditSyntax = await measureDiagnosticStep(result, 'specified_files_syntax_ms', () => buildPostEditDiagnostics(explicitFiles, projectPath))
      result.integrated_steps.push('specified_files_syntax')
      result.syntax = {
        ok: !!postEditSyntax.ok,
        checked_count: postEditSyntax.checked_count || 0,
        failed_count: Array.isArray(postEditSyntax.failed_files) ? postEditSyntax.failed_files.length : 0,
        warning_count: 0,
        failed_files: postEditSyntax.failed_files || [],
        read_hints: postEditSyntax.read_hints || [],
        code_frames: postEditSyntax.code_frames || [],
        repair_hints: postEditSyntax.repair_hints || [],
        message: postEditSyntax.message
      }
    }

    let logicReview = null
    if (deepDiagnostic || explicitFiles.length) {
      logicReview = await measureDiagnosticStep(result, 'logic_review_ms', () => reviewFixQualityAsync(explicitFiles, projectPath, {
        deep: deepDiagnostic,
        skipDefaultScan: !deepDiagnostic
      }))
      result.integrated_steps.push('logic_review')
      result.logic_review = logicReview
    }

    const runtime = await measureDiagnosticStep(result, 'runtime_diagnostics_ms', () => summarizeRuntimeDiagnosticsSafe({
      since_ms: args.runtime_since_ms || args.runtimeSinceMs || 10 * 60 * 1000,
      limit: args.runtime_limit || args.runtimeLimit || 80,
      projectId,
      projectPath
    }))
    result.integrated_steps.push('inspect_runtime_errors')
    result.runtimeDiagnostics = runtime

    let runtimeProbe = null
    if (args.runtime_probe === true || args.runtimeProbe === true) {
      runtimeProbe = await measureDiagnosticStep(result, 'runtime_probe_ms', () => runRuntimeProbe(projectPath, {
        command: args.runtime_command || args.runtimeCommand,
        script: args.runtime_script || args.runtimeScript || args.npm_script || args.npmScript,
        launch_if_needed: args.launch_if_needed === true || args.launchIfNeeded === true,
        timeout_ms: args.runtime_timeout_ms || args.runtimeTimeoutMs || args.timeout_ms || args.timeoutMs
      }))
      result.integrated_steps.push('runtime_probe')
      result.runtimeProbe = runtimeProbe
    }

    let runtimeClosure = null
    const uiChecks = Array.isArray(args.ui_checks || args.uiChecks) ? (args.ui_checks || args.uiChecks) : []
    const wantsRuntimeClosure = args.runtime_closure === true || args.runtimeClosure === true
      || args.runtime_url || args.runtimeUrl || args.html_path || args.htmlPath || uiChecks.length
    if (wantsRuntimeClosure) {
      try {
        runtimeClosure = await measureDiagnosticStep(result, 'runtime_closure_ms', () => runRuntimeClosure(projectPath, {
          ...args,
          projectId,
          ui_checks: uiChecks
        }, runtimeProbe || {}))
      } catch (error) {
        runtimeClosure = {
          success: false,
          ok: false,
          error: error.message,
          events: []
        }
      }
      result.integrated_steps.push('runtime_closure')
      result.runtimeClosure = runtimeClosure
    }

    if (deepDiagnostic) {
      const health = await measureDiagnosticStep(result, 'health_worker_ms', () => runProjectHealthScanInWorker({
        projectPath,
        query,
        userMessage: query,
        diagnostics: {
          syntax,
          logicReview,
          runtime,
          runtimeProbe,
          runtimeClosure
        },
        include_ipc: args.include_ipc !== false,
        full: fullScan,
        fullScan,
        top_limit: args.top_limit || args.topLimit || (fullScan ? 5000 : 20)
      }))
      result.integrated_steps.push('project_health_scan')
      result.health = health
      result.summary = health.ok
        ? '项目综合诊断未发现高优先级错误。'
        : `项目综合诊断发现 ${health.error_count} 个错误、${health.warning_count} 个警告。`
      result.next_action = health.next_action
    } else {
      result.summary = Number(runtime.error_count || 0) > 0
        ? `快速诊断捕获 ${runtime.error_count} 个近期运行态错误；深度项目扫描已跳过。`
        : '快速诊断完成：未发现近期运行态错误；深度项目扫描已跳过。'
      result.next_action = explicitFiles.length
        ? 'Review specified file diagnostics and run dev_workflow mode=health deep=true only if a full project scan is needed.'
        : 'Use deep=true, full=true, or fullScan=true only when a full project scan is needed.'
    }
    return attachNavigation()
  }

  if (mode === 'syntax' || (mode === 'triage' && deepDiagnostic)) {
    triageSyntax = await measureDiagnosticStep(result, 'syntax_ms', () => scanProjectSyntax(projectPath, {
      roots: args.roots,
      max_failures: maxFailures,
      full: fullScan
    }))
    result.integrated_steps.push('check_project_syntax')
    result.syntax = summarizeSyntaxScan(triageSyntax || {}, { full: fullScan })
    if (mode === 'syntax') {
      result.summary = result.syntax.ok ? '项目语法扫描通过。' : `发现 ${result.syntax.failed_count} 个语法失败文件，已返回可直接修复的 code_frames。`
      return attachNavigation()
    }
  }

  if (mode === 'triage') {
    const logicReview = await measureDiagnosticStep(result, 'logic_review_ms', () => reviewFixQualityAsync(explicitFiles, projectPath, {
      deep: deepDiagnostic,
      skipDefaultScan: !deepDiagnostic
    }))
    result.logic_review = logicReview
    result.integrated_steps.push('logic_review')
    const runtime = await measureDiagnosticStep(result, 'runtime_diagnostics_ms', () => summarizeRuntimeDiagnosticsSafe({
      since_ms: args.runtime_since_ms || args.runtimeSinceMs || 10 * 60 * 1000,
      limit: args.runtime_limit || args.runtimeLimit || 80,
      projectId,
      projectPath
    }))
    result.runtimeDiagnostics = runtime
    result.integrated_steps.push('inspect_runtime_errors')

    if (deepDiagnostic) {
      const health = await measureDiagnosticStep(result, 'health_worker_ms', () => runProjectHealthScanInWorker({
        projectPath,
        query,
        userMessage: query,
        diagnostics: {
          syntax: triageSyntax,
          logicReview,
          runtime,
          runtimeProbe: null,
          runtimeClosure: null
        },
        include_ipc: args.include_ipc !== false,
        full: fullScan,
        fullScan,
        top_limit: args.top_limit || args.topLimit || (fullScan ? 5000 : 20)
      }))
      result.integrated_steps.push('project_health_scan')
      result.health = health
      result.summary = health.ok
        ? '项目综合诊断未发现高优先级错误。'
        : `项目综合诊断发现 ${health.error_count} 个错误、${health.warning_count} 个警告。`
      result.next_action = health.next_action
    } else {
      result.summary = Number(runtime.error_count || 0) > 0
        ? `快速排查捕获 ${runtime.error_count} 个近期运行态错误；项目健康扫描已跳过。`
        : '快速排查完成：未发现近期运行态错误；项目健康扫描已跳过。'
      result.next_action = 'Use deep=true, full=true, or fullScan=true only when project-wide diagnosis is required.'
    }
    return attachNavigation()
  }

  if (mode === 'verify') {
    const verify = await ctx.dispatch?.('post_change_verify', { files: args.files || [] })
    result.integrated_steps.push('post_change_verify')
    result.verify = verify || { success: false, error: 'post_change_verify unavailable' }
    if (Array.isArray(args.files) && args.files.length) {
      result.logic_review = await reviewFixQualityAsync(args.files, projectPath, {
        deep: args.deep === true || args.full === true || args.scope === 'deep'
      })
      result.integrated_steps.push('logic_review')
    }
    result.runtimeDiagnostics = summarizeRuntimeDiagnosticsSafe({ since_ms: 10 * 60 * 1000, limit: 20, projectId, projectPath })
    result.integrated_steps.push('inspect_runtime_errors')
    result.summary = verify?.success === false ? '改后综合验证未通过。' : '改后综合验证完成。'
    return attachNavigation()
  }

  if (mode === 'review') {
    result.logic_review = await reviewFixQualityAsync(args.files || [], projectPath, {
      deep: args.deep !== false
    })
    result.integrated_steps.push('logic_review')
    result.summary = result.logic_review.ok
      ? '修复质量审查未发现明显假修复模式。'
      : `修复质量审查发现 ${result.logic_review.error_count} 个高风险问题。`
    result.next_action = result.logic_review.next_action
    return attachNavigation()
  }

  result.summary = '集成诊断完成。'
  result.next_action = result.syntax?.failed_count
    ? result.syntax.next_action
    : (result.discovery?.next_action || '根据返回的候选和验证结果继续。')
  return attachNavigation()
}

const handlers = {
  inspect_runtime_errors: async (args, ctx = {}) => {
    const projectId = ctx.projectId || args?.projectId || args?.project_id || ''
    const projectPath = ctx.projectPath || args?.projectPath || args?.project_path || ''
    // 1. 先读已有运行时事件（按 projectId/projectPath 过滤，避免串项目）
    const result = summarizeRuntimeDiagnosticsSafe({
      ...(args || {}),
      projectId,
      projectPath
    })
    result.tool = 'inspect_runtime_errors'

    // 2. 如果已有事件为空且项目路径有效，主动跑一次 runtime probe 拉起进程捕获错误
    //    避免进程未启动时拿不到任何运行时证据
    const shouldProbe = Number(result.error_count || 0) === 0
      && Number(result.warning_count || 0) === 0
      && projectPath
      && (args?.launch_if_needed === true || args?.launchIfNeeded === true
          || args?.auto_probe === true || args?.autoProbe === true
          || args?.probe === true)
    if (shouldProbe) {
      try {
        const probe = await runRuntimeProbe(projectPath, {
          command: args?.runtime_command || args?.runtimeCommand,
          script: args?.runtime_script || args?.runtimeScript || args?.npm_script || args?.npmScript,
          launch_if_needed: true,
          timeout_ms: args?.runtime_timeout_ms || args?.runtimeTimeoutMs || args?.timeout_ms || args?.timeoutMs || 20000
        })
        result.runtimeProbe = probe
        result.integrated_steps = ['runtime_probe']
        // 把 probe 捕获的错误合并进 events
        if (Array.isArray(probe?.events) && probe.events.length) {
          result.events = [...(result.events || []), ...probe.events]
          result.error_count = (Number(result.error_count) || 0) + probe.events.length
          result.ok = result.error_count === 0
          result.summary = result.error_count
            ? `Runtime diagnostics found ${result.error_count} error(s) (incl. ${probe.events.length} from runtime probe).`
            : result.summary
        }
      } catch (probeErr) {
        result.runtimeProbe = { success: false, error: probeErr?.message || String(probeErr) }
      }
    }

    result.next_action = Number(result.error_count || 0) > 0
      ? 'use_runtime_error_stack_or_console_message_to_trace_dom_js_css_backend_cause'
      : (result.next_action || 'continue')
    return result
  },

  dev_workflow: async (args, ctx) => {
    try {
      return await runDevWorkflow(args || {}, ctx || {})
    } catch (e) {
      return { success: false, tool: 'dev_workflow', error: e.message }
    }
  },

  check_project_syntax: async (args, ctx) => {
    const { projectPath } = ctx
    try {
      return await scanProjectSyntax(projectPath, args || {})
    } catch (e) {
      return { success: false, ok: false, valid: false, error: e.message }
    }
  },

  check_syntax: async (args, ctx) => {
    const { resolvePath, projectPath } = ctx
    try {
      const filePath = resolvePath(args.path)
      const fs = require('fs')
      if (!fs.existsSync(filePath)) {
        const { buildPathFailureResult } = require('./search')
        return buildPathFailureResult({
          requestedPath: args.path,
          resolvedPath: filePath,
          projectPath,
          kind: 'file'
        })
      }
      const syntaxResult = await syntaxChecker.checkFileSyntaxAsync(filePath)
      return {
        success: true,
        ...syntaxResult,
        path: filePath
      }
    } catch (e) {
      return { success: false, error: e.message }
    }
  }
}

module.exports = {
  handlers,
  buildSyntaxWarningFromDiagnostics,
  buildReadHintForSyntaxError,
  buildCodeFrameForSyntaxError,
  scanProjectSyntax,
  collectCheckableSyntaxFiles,
  collectCheckableSyntaxFilesAsync,
  shouldSkipSyntaxScanPath,
  buildPostEditDiagnostics,
  attachPostEditDiagnostics,
  capturePostEditRuntimeBaseline,
  summarizeRuntimeDiagnosticsSafe,
  reviewFixQuality,
  reviewFixQualityAsync,
  buildUiBehaviorVerificationAdvice
}
