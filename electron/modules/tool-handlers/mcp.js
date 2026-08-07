const fs = require('fs')
const path = require('path')
const mcpIntegration = require('../mcp-integration')
const diagnostics = require('./diagnostics')
const { traceUiRootCause } = require('../ui-root-cause-tracer')

const CODE_EXTENSIONS = new Set([
  '.js', '.mjs', '.cjs', '.jsx', '.ts', '.tsx', '.py', '.html', '.css',
  '.json', '.md', '.yml', '.yaml', '.toml', '.txt', '.bat', '.ps1', '.sh'
])
const IGNORE_DIRS = new Set([
  '.git', 'node_modules', 'dist', 'build', 'out', '.next', '.vite', '.cache',
  '.venv', 'venv', '__pycache__', 'coverage', 'temp', 'tmp'
])
const MAX_LOCAL_EVIDENCE_FILES = 5000
const MAX_AUTO_INDEX_FILES = 5000
const MAX_SAMPLE_FILES = 30

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
}

function getServerId(args = {}) {
  return args?.server_id || args?.serverId || mcpIntegration.DEFAULT_SERVER_ID
}

async function call(ctx, name, args, options = {}) {
  const result = await mcpIntegration.callMcpTool(
    ctx.projectId || '',
    ctx.projectPath || '',
    getServerId(options),
    name,
    asObject(args),
    options
  )
  return {
    success: !!result.success,
    tool: name,
    serverId: result.serverId,
    serverName: result.serverName,
    projectPath: result.projectPath,
    data: result.data,
    text: result.text,
    isError: result.isError
  }
}

async function safeWorkflowCall(ctx, serverId, tool, args = {}, timeoutMs = 60000) {
  try {
    return await mcpIntegration.callMcpTool(
      ctx.projectId || '',
      ctx.projectPath || '',
      serverId,
      tool,
      asObject(args),
      { timeoutMs }
    )
  } catch (error) {
    return { success: false, tool, error: error.message }
  }
}

function getStepData(step = {}) {
  return asObject(step.data)
}

function getOverviewFileCount(step = {}) {
  const data = getStepData(step)
  const direct = Number(
    data.total_files ??
    data.totalFiles ??
    data.file_count ??
    data.fileCount ??
    data.summary?.total_files ??
    data.summary?.totalFiles ??
    data.summary?.file_count ??
    data.summary?.fileCount
  )
  if (Number.isFinite(direct)) return direct
  if (data.files && typeof data.files === 'object') return Object.keys(data.files).length
  return 0
}

function getOverviewLineCount(step = {}) {
  const data = getStepData(step)
  const direct = Number(
    data.total_lines ??
    data.totalLines ??
    data.line_count ??
    data.lineCount ??
    data.summary?.total_lines ??
    data.summary?.totalLines ??
    data.summary?.line_count ??
    data.summary?.lineCount
  )
  return Number.isFinite(direct) ? direct : 0
}

function isEmptyOverview(step = {}) {
  if (!step || step.success === false || step.isError) return false
  const data = getStepData(step)
  const fileCount = getOverviewFileCount(step)
  const lineCount = getOverviewLineCount(step)
  const languageCount = data.language_distribution && typeof data.language_distribution === 'object'
    ? Object.keys(data.language_distribution).length
    : 0
  const tagCount = data.tag_index && typeof data.tag_index === 'object'
    ? Object.keys(data.tag_index).length
    : 0
  return fileCount <= 0 && lineCount <= 0 && languageCount <= 0 && tagCount <= 0
}

function isEmptyFind(step = {}) {
  if (!step || step.success === false || step.isError) return false
  const data = step.data
  if (Array.isArray(data)) return data.length === 0
  if (data && typeof data === 'object') {
    for (const key of ['results', 'matches', 'items', 'files']) {
      if (Array.isArray(data[key])) return data[key].length === 0
    }
  }
  const text = String(step.text || '').trim()
  return text === '[]' || text === '{}' || text === ''
}

function compactText(value = '', maxChars = 1200) {
  const text = String(value || '').trim()
  if (!text || text.length <= maxChars) return text
  return `${text.slice(0, maxChars)}...`
}

function compactArray(value, limit = 12) {
  return Array.isArray(value) ? value.slice(0, limit) : []
}

function compactObjectKeys(value, limit = 30) {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? Object.keys(value).slice(0, limit)
    : []
}

function compactFindData(data) {
  const filterItems = items => items
    .filter(item => {
      const file = typeof item === 'string' ? item : item?.file || item?.path
      return !file || isProjectRelativeFile(file)
    })
    .slice(0, 20)
  if (Array.isArray(data)) return filterItems(data)
  if (!data || typeof data !== 'object') return data
  const output = {}
  for (const key of ['results', 'matches', 'items', 'files']) {
    if (Array.isArray(data[key])) output[key] = filterItems(data[key])
  }
  for (const key of ['query', 'total', 'count', 'score', 'message']) {
    if (data[key] !== undefined) output[key] = data[key]
  }
  return Object.keys(output).length ? output : data
}

function compactStepData(tool, data) {
  if (!data || typeof data !== 'object') return data
  if (tool === 'lingxi_native_dev_workflow') return compactNativeDiscovery(data)
  if (tool === 'lingxi_logic_review') return compactLogicReview(data)
  if (tool === 'ui_root_cause_trace') return compactUiRootCauseTrace(data)
  if (tool === 'lingxi_local_project_evidence') {
    return {
      root: data.root,
      exists: data.exists,
      codeFileCount: data.codeFileCount,
      scannedFileCount: data.scannedFileCount,
      skippedFileCount: data.skippedFileCount,
      truncated: data.truncated,
      tooLargeForAutoIndex: data.tooLargeForAutoIndex,
      aimap: data.aimap,
      topLevelDirectories: compactArray(data.topLevelDirectories, 24),
      topLevelFiles: compactArray(data.topLevelFiles, 24),
      sampleFiles: compactArray(data.sampleFiles, 30),
      extensionDistribution: data.extensionDistribution
    }
  }
  if (tool === 'aidev_index') {
    return {
      ok: data.ok,
      directory: data.directory,
      files_indexed: data.files_indexed,
      total_files: data.total_files,
      tags: data.tags,
      message: data.message
    }
  }
  if (tool === 'aidev_project') {
    return {
      total_files: data.total_files ?? data.totalFiles ?? data.file_count ?? data.fileCount,
      total_lines: data.total_lines ?? data.totalLines ?? data.line_count ?? data.lineCount,
      health_score: data.health_score,
      health_level: data.health_level,
      language_distribution: data.language_distribution,
      tag_keys: compactObjectKeys(data.tag_index, 40),
      circular_dependencies: compactArray(data.circular_dependencies, 12),
      bloated_files: compactArray(data.bloated_files, 12),
      issues: compactArray(data.issues, 12),
      suggestion: data.suggestion
    }
  }
  if (tool === 'aidev_find') return compactFindData(data)
  if (tool === 'aidev_scan') {
    if (Array.isArray(data)) return data.slice(0, 20)
    return {
      results: compactArray(data.results || data.files || data.items, 20),
      count: data.count,
      total: data.total,
      message: data.message
    }
  }
  if (tool === 'aidev_perceive') {
    return {
      file: data.file || data.path,
      language: data.language,
      line_count: data.line_count,
      health: data.health,
      metadata: data.metadata,
      dependencies: compactArray(data.dependencies, 20),
      affects: compactArray(data.affects, 20),
      syntax: data.syntax,
      static: data.static,
      content_preview: data.content ? compactText(data.content, 1600) : undefined
    }
  }
  if (tool === 'aidev_check' || tool === 'aidev_static' || tool === 'aidev_affects') {
    return {
      file: data.file || data.path,
      ok: data.ok,
      valid: data.valid,
      language: data.language,
      errors: compactArray(data.errors, 12),
      warnings: compactArray(data.warnings, 12),
      findings: compactArray(data.findings, 12),
      affects: compactArray(data.affects || data.affected || data.files, 20),
      message: data.message
    }
  }
  return data
}

function compactWorkflowStep(step = {}) {
  return {
    success: !!step.success,
    tool: step.tool,
    data: compactStepData(step.tool, step.data),
    text: compactText(step.text, 1200),
    error: step.error,
    isError: step.isError
  }
}

function compactNativeDiscovery(data = {}) {
  const discovery = data.discovery || data
  const candidates = Array.isArray(discovery.candidates) ? discovery.candidates : []
  const readHints = Array.isArray(discovery.readHints) ? discovery.readHints : []
  const focusedSnippets = Array.isArray(discovery.focusedSnippets) ? discovery.focusedSnippets : []
  return {
    mode: discovery.mode,
    quality: discovery.quality,
    candidates: candidates.slice(0, 12),
    readHints: readHints.slice(0, 12),
    focusedSnippets: focusedSnippets.slice(0, 8),
    next_action: discovery.next_action || data.next_action
  }
}

function compactLogicReview(data = {}) {
  return {
    ok: !!data.ok,
    scope: data.scope,
    reviewed_count: data.reviewed_count,
    error_count: data.error_count || 0,
    warning_count: data.warning_count || 0,
    findings: Array.isArray(data.findings) ? data.findings.slice(0, 12) : [],
    requires_ui_behavior_verification: !!data.requires_ui_behavior_verification,
    ui_behavior_verification: Array.isArray(data.ui_behavior_verification)
      ? data.ui_behavior_verification.slice(0, 6)
      : [],
    read_hints: Array.isArray(data.read_hints) ? data.read_hints.slice(0, 12) : [],
    next_action: data.next_action
  }
}

function compactUiRootCauseTrace(data = {}) {
  return {
    success: !!data.success,
    query: data.query,
    quality: data.quality,
    counts: data.counts,
    analyzedFiles: Array.isArray(data.analyzedFiles) ? data.analyzedFiles.slice(0, 24) : [],
    chains: Array.isArray(data.chains) ? data.chains.slice(0, 8) : [],
    lifecycleFindings: Array.isArray(data.lifecycleFindings) ? data.lifecycleFindings.slice(0, 8) : [],
    eventBindings: Array.isArray(data.eventBindings) ? data.eventBindings.slice(0, 12) : [],
    selectorLookups: Array.isArray(data.selectorLookups) ? data.selectorLookups.slice(0, 12) : [],
    next_action: data.next_action
  }
}

function buildWorkflowSummary({ serverId, mode, query, files, recovery, unreliable, steps }) {
  const overviewStep = steps.find(step => step.tool === 'aidev_project')
  const findStep = [...steps].reverse().find(step => step.tool === 'aidev_find')
  const indexStep = steps.find(step => step.tool === 'aidev_index')
  const nativeStep = steps.find(step => step.tool === 'lingxi_native_dev_workflow')
  const logicReviewStep = steps.find(step => step.tool === 'lingxi_logic_review')
  const uiRootCauseStep = steps.find(step => step.tool === 'ui_root_cause_trace')
  const evidenceStep = steps.find(step => step.tool === 'lingxi_local_project_evidence')
  const evidence = recovery?.evidence || evidenceStep?.data || null
  return {
    serverId,
    mode,
    query,
    files,
    degraded: !!unreliable,
    index: {
      ensured: !!recovery?.ensured,
      recovered: !!recovery?.recovered,
      reason: recovery?.reason || '',
      requestedBy: recovery?.requestedBy || '',
      localCodeFileCount: evidence?.codeFileCount || 0,
      localScanTruncated: !!evidence?.truncated,
      tooLargeForAutoIndex: !!evidence?.tooLargeForAutoIndex,
      aimapFileCount: evidence?.aimap?.fileCount || 0,
      indexStep: indexStep ? compactStepData('aidev_index', indexStep.data) : null
    },
    overview: overviewStep ? compactStepData('aidev_project', overviewStep.data) : null,
    find: findStep ? compactStepData('aidev_find', findStep.data) : null,
    nativeDiscovery: nativeStep ? compactNativeDiscovery(nativeStep.data) : null,
    logicReview: logicReviewStep ? compactLogicReview(logicReviewStep.data) : null,
    uiRootCauseTrace: uiRootCauseStep ? compactUiRootCauseTrace(uiRootCauseStep.data) : null,
    inspectedFiles: steps
      .filter(step => ['aidev_perceive', 'aidev_static', 'aidev_affects', 'aidev_check'].includes(step.tool))
      .map(step => step.data?.file || step.data?.path)
      .filter(Boolean)
      .slice(0, 20),
    nextAction: unreliable
      ? 'MCP project graph is degraded. Use returned local evidence, sample files, or read targeted files; do not assume the empty overview means the project is empty.'
      : 'Use the compact MCP summary and only call narrower MCP/file tools for missing details.'
  }
}

function toRelative(rootPath, filePath) {
  return path.relative(rootPath, filePath).replace(/\\/g, '/')
}

function readAimMapSummary(rootPath) {
  const indexPath = path.join(rootPath, '.aimap.json')
  const summary = {
    path: indexPath,
    exists: false,
    fileCount: 0,
    generated: '',
    project: ''
  }
  if (!fs.existsSync(indexPath)) return summary
  summary.exists = true
  try {
    const parsed = JSON.parse(fs.readFileSync(indexPath, 'utf8'))
    summary.fileCount = parsed?.files && typeof parsed.files === 'object'
      ? Object.keys(parsed.files).length
      : 0
    summary.generated = parsed?.generated || ''
    summary.project = parsed?.project || ''
  } catch (error) {
    summary.error = error.message
  }
  return summary
}

function collectProjectEvidence(rootPath = '') {
  const root = path.resolve(rootPath || process.cwd())
  const evidence = {
    root,
    exists: false,
    codeFileCount: 0,
    scannedFileCount: 0,
    skippedFileCount: 0,
    truncated: false,
    tooLargeForAutoIndex: false,
    topLevelDirectories: [],
    topLevelFiles: [],
    sampleFiles: [],
    extensionDistribution: {},
    aimap: readAimMapSummary(root)
  }
  if (!fs.existsSync(root)) return evidence
  evidence.exists = true

  try {
    const top = fs.readdirSync(root, { withFileTypes: true })
    evidence.topLevelDirectories = top
      .filter(entry => entry.isDirectory())
      .map(entry => entry.name)
      .slice(0, 40)
    evidence.topLevelFiles = top
      .filter(entry => entry.isFile())
      .map(entry => entry.name)
      .slice(0, 40)
  } catch { /* 读取根目录失败 */ }

  const queue = [root]
  while (queue.length && !evidence.truncated) {
    const dir = queue.shift()
    let entries = []
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.') && entry.name !== '.env') continue
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        if (IGNORE_DIRS.has(entry.name)) continue
        queue.push(full)
        continue
      }
      if (!entry.isFile()) continue
      evidence.scannedFileCount += 1
      const ext = path.extname(entry.name).toLowerCase()
      if (!CODE_EXTENSIONS.has(ext)) {
        evidence.skippedFileCount += 1
        continue
      }
      evidence.codeFileCount += 1
      evidence.extensionDistribution[ext || '[no-ext]'] = (evidence.extensionDistribution[ext || '[no-ext]'] || 0) + 1
      if (evidence.sampleFiles.length < MAX_SAMPLE_FILES) {
        evidence.sampleFiles.push(toRelative(root, full))
      }
      if (evidence.codeFileCount > MAX_LOCAL_EVIDENCE_FILES) {
        evidence.truncated = true
        break
      }
    }
  }
  evidence.tooLargeForAutoIndex = evidence.truncated || evidence.codeFileCount > MAX_AUTO_INDEX_FILES
  return evidence
}

function pushLocalEvidenceStep(steps, evidence) {
  steps.push({
    success: evidence.exists,
    tool: 'lingxi_local_project_evidence',
    data: evidence,
    text: evidence.exists
      ? `Local project evidence: ${evidence.codeFileCount}${evidence.truncated ? '+' : ''} code/text files found; aimap files=${evidence.aimap?.fileCount || 0}.`
      : 'Local project evidence: project path does not exist.'
  })
}

async function scanSampleFiles(ctx, serverId, steps, evidence) {
  const sampleTargets = evidence.sampleFiles.slice(0, 12)
  if (sampleTargets.length) {
    steps.push(await safeWorkflowCall(ctx, serverId, 'aidev_scan', { files: sampleTargets }))
  }
}

function isProjectRelativeFile(value = '') {
  const normalized = String(value || '').replace(/\\/g, '/').replace(/^\.\/+/, '')
  if (!normalized || normalized.startsWith('../') || normalized.includes('/../')) return false
  if (/^[a-z]:\//i.test(normalized) || normalized.startsWith('/')) return false
  const first = normalized.split('/')[0]
  return !IGNORE_DIRS.has(first) && CODE_EXTENSIONS.has(path.extname(normalized).toLowerCase())
}

function addCandidateFile(out, value = '') {
  const normalized = String(value || '').replace(/\\/g, '/').replace(/^\.\/+/, '')
  if (!isProjectRelativeFile(normalized)) return
  if (!out.includes(normalized)) out.push(normalized)
}

function extractFindFiles(step = {}) {
  const files = []
  const data = step.data
  const lists = []
  if (Array.isArray(data)) lists.push(data)
  if (data && typeof data === 'object') {
    for (const key of ['matches', 'results', 'items', 'files']) {
      if (Array.isArray(data[key])) lists.push(data[key])
    }
  }
  for (const list of lists) {
    for (const item of list) {
      addCandidateFile(files, typeof item === 'string' ? item : item?.file || item?.path)
    }
  }
  return files
}

function extractNativeDiscoveryFiles(step = {}) {
  const files = []
  const discovery = step.data?.discovery || step.data
  const candidates = Array.isArray(discovery?.candidates) ? discovery.candidates : []
  for (const item of candidates) addCandidateFile(files, item?.path || item?.file)
  const hints = Array.isArray(discovery?.readHints) ? discovery.readHints : []
  for (const item of hints) addCandidateFile(files, item?.path || item?.file)
  return files
}

function scoreInspectCandidate(file = '', query = '') {
  const normalized = String(file || '').replace(/\\/g, '/').toLowerCase()
  let score = 0
  if (/^frontend\/scripts\//.test(normalized)) score += 24
  if (/^frontend\/styles\//.test(normalized)) score += 20
  if (normalized === 'frontend/index.html') score += 16
  if (/^electron\/modules\//.test(normalized)) score += 8
  if (/\/i18n\//.test(normalized)) score -= 28
  if (/^(docs|skills|scripts\/real-scenarios)\//.test(normalized)) score -= 18
  if (/^electron\/modules\/(?:tool-handlers|schemas)\//.test(normalized)) score -= 8

  const tokens = String(query || '').toLowerCase().match(/[\u4e00-\u9fff]{2,}|[a-z0-9_-]{3,}/g) || []
  const uniqueTokens = [...new Set(tokens)]
  for (const token of uniqueTokens) {
    const compactToken = token.replace(/[_-]+/g, '')
    const compactPath = normalized.replace(/[_-]+/g, '')
    if (compactPath.includes(compactToken)) score += 8
    else if (normalized.includes(token)) score += 5
  }
  return score
}

function rankInspectFiles(files = [], query = '') {
  return files
    .map((file, index) => ({ file, index, score: scoreInspectCandidate(file, query) }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map(item => item.file)
}

function buildAutoInspectFiles({ explicitFiles = [], explicitFile = '', findStep = null, nativeStep = null, query = '', limit = 6 }) {
  const files = []
  for (const item of explicitFiles) addCandidateFile(files, item)
  addCandidateFile(files, explicitFile)
  for (const item of extractNativeDiscoveryFiles(nativeStep || {})) addCandidateFile(files, item)
  for (const item of extractFindFiles(findStep || {})) addCandidateFile(files, item)
  const explicitCount = files.length && (explicitFiles.length || explicitFile) ? Math.max(1, explicitFiles.length + (explicitFile ? 1 : 0)) : 0
  const explicit = files.slice(0, explicitCount)
  const discovered = rankInspectFiles(files.slice(explicitCount), query)
  return [...explicit, ...discovered].slice(0, limit)
}

async function runNativeWorkflow(ctx, query, mode, limit) {
  if (!query || !diagnostics?.handlers?.dev_workflow) return null
  const nativeMode = mode === 'overview' ? 'locate' : mode === 'verify' ? 'review' : 'locate'
  try {
    const data = await diagnostics.handlers.dev_workflow({
      mode: nativeMode,
      query,
      limit: limit || 10
    }, ctx || {})
    return {
      success: data?.success !== false,
      tool: 'lingxi_native_dev_workflow',
      data,
      text: data?.summary || data?.discovery?.next_action || ''
    }
  } catch (error) {
    return { success: false, tool: 'lingxi_native_dev_workflow', error: error.message }
  }
}

async function runLogicReview(files = [], projectPath = '') {
  try {
    const review = diagnostics.reviewFixQualityAsync || diagnostics.reviewFixQuality
    return {
      success: true,
      tool: 'lingxi_logic_review',
      data: await review(files, projectPath, {
        deep: !Array.isArray(files) || files.length === 0
      }),
      text: 'Local fix-quality and UI state contract review completed.'
    }
  } catch (error) {
    return { success: false, tool: 'lingxi_logic_review', error: error.message }
  }
}

async function ensureProjectIndex(ctx, serverId, steps, reason) {
  const evidence = collectProjectEvidence(ctx.projectPath || '')
  pushLocalEvidenceStep(steps, evidence)

  if (!evidence.exists || evidence.codeFileCount <= 0) {
    return { ensured: false, recovered: false, evidence, reason: 'no_local_project_files', requestedBy: reason }
  }

  if (evidence.aimap?.fileCount > 0) {
    return { ensured: true, recovered: true, evidence, reason: 'existing_index', requestedBy: reason }
  }

  if (evidence.tooLargeForAutoIndex) {
    await scanSampleFiles(ctx, serverId, steps, evidence)
    return {
      ensured: false,
      recovered: false,
      evidence,
      reason: 'project_too_large_for_safe_auto_index',
      requestedBy: reason,
      message: 'Project has no usable .aimap.json, but the local root is too large for safe automatic full indexing. Returned readonly evidence and sample scan instead.'
    }
  }

  const indexStep = await safeWorkflowCall(
    ctx,
    serverId,
    'aidev_index',
    { directory: evidence.root },
    120000
  )
  steps.push(indexStep)

  if (!indexStep.success) {
    await scanSampleFiles(ctx, serverId, steps, evidence)
    return { ensured: false, recovered: false, evidence, reason: 'index_failed', requestedBy: reason }
  }

  mcpIntegration.stopMcpClients()
  const refreshed = collectProjectEvidence(ctx.projectPath || '')
  return {
    ensured: true,
    recovered: true,
    evidence: refreshed,
    reason: 'indexed_before_workflow',
    requestedBy: reason
  }
}

async function recoverEmptyProjectOverview(ctx, serverId, steps, reason) {
  const evidence = collectProjectEvidence(ctx.projectPath || '')
  pushLocalEvidenceStep(steps, evidence)

  if (!evidence.exists || evidence.codeFileCount <= 0) {
    return { recovered: false, evidence, reason: 'no_local_project_files' }
  }

  if (evidence.tooLargeForAutoIndex) {
    await scanSampleFiles(ctx, serverId, steps, evidence)
    return {
      recovered: false,
      evidence,
      reason: 'project_too_large_for_safe_auto_index',
      message: 'MCP overview was empty, but the local root contains many files. Full recursive MCP indexing was skipped to avoid a long blocking scan; use a narrower project root or pass candidate files.'
    }
  }

  const indexStep = await safeWorkflowCall(
    ctx,
    serverId,
    'aidev_index',
    { directory: evidence.root },
    120000
  )
  steps.push(indexStep)
  if (!indexStep.success) {
    await scanSampleFiles(ctx, serverId, steps, evidence)
    return { recovered: false, evidence, reason: 'index_failed' }
  }

  mcpIntegration.stopMcpClients()
  const retryOverview = await safeWorkflowCall(ctx, serverId, 'aidev_project', {})
  steps.push(retryOverview)
  return {
    recovered: retryOverview.success && !isEmptyOverview(retryOverview),
    evidence,
    reason: retryOverview.success && !isEmptyOverview(retryOverview) ? 'indexed_and_reloaded' : 'overview_still_empty_after_index'
  }
}

const handlers = {
  mcp_list_tools: async (args, ctx) => {
    try {
      return await mcpIntegration.listMcpTools(
        ctx.projectId || '',
        ctx.projectPath || '',
        getServerId(args)
      )
    } catch (error) {
      return { success: false, error: error.message, tools: [] }
    }
  },

  mcp_call_tool: async (args, ctx) => {
    try {
      return await call(ctx, args?.name || args?.tool || '', args?.arguments || args?.args || {}, {
        server_id: getServerId(args),
        timeoutMs: args?.timeout_ms || args?.timeoutMs
      })
    } catch (error) {
      return { success: false, error: error.message }
    }
  },

  mcp_aidev_workflow: async (args, ctx) => {
    const serverId = getServerId(args)
    const mode = args?.mode || 'auto'
    const query = args?.query || ''
    const files = Array.isArray(args?.files) ? args.files.filter(Boolean).slice(0, 12) : []
    const file = args?.file || args?.path || files[0] || ''
    const steps = []

    let overviewRecovery = null
    let unreliable = false
    let nativeStep = null
    let findStep = null
    const needsProjectGraph = mode === 'auto' || mode === 'overview' || mode === 'locate' || mode === 'diagnose'

    if (needsProjectGraph) {
      overviewRecovery = await ensureProjectIndex(ctx, serverId, steps, 'before_workflow')
      unreliable = !overviewRecovery.recovered
    }

    if (query && (mode === 'auto' || mode === 'locate' || mode === 'diagnose')) {
      nativeStep = await runNativeWorkflow(ctx, query, mode, args?.limit || 10)
      if (nativeStep) steps.push(nativeStep)
    }

    if (mode === 'auto' || mode === 'overview' || mode === 'diagnose') {
      const overview = await safeWorkflowCall(ctx, serverId, 'aidev_project', {})
      steps.push(overview)
      if (isEmptyOverview(overview) && !overviewRecovery?.recovered) {
        overviewRecovery = await recoverEmptyProjectOverview(ctx, serverId, steps, 'empty_overview')
        unreliable = !overviewRecovery.recovered
      }
    }
    if (query && (mode === 'auto' || mode === 'locate' || mode === 'diagnose')) {
      findStep = await safeWorkflowCall(ctx, serverId, 'aidev_find', {
        query,
        limit: args?.limit || 10
      })
      steps.push(findStep)
      if (isEmptyFind(findStep) && !overviewRecovery?.recovered) {
        overviewRecovery = await recoverEmptyProjectOverview(ctx, serverId, steps, 'empty_find')
        unreliable = !overviewRecovery.recovered
        if (overviewRecovery.recovered) {
          steps.push(await safeWorkflowCall(ctx, serverId, 'aidev_find', {
            query,
            limit: args?.limit || 10
          }))
        }
      }
    }

    const autoInspectFiles = buildAutoInspectFiles({
      explicitFiles: files,
      explicitFile: file,
      findStep,
      nativeStep,
      query,
      limit: args?.inspect_limit || args?.inspectLimit || 6
    })

    if (autoInspectFiles.length && (mode === 'auto' || mode === 'inspect' || mode === 'verify' || mode === 'diagnose')) {
      steps.push(await safeWorkflowCall(ctx, serverId, 'aidev_scan', { files: autoInspectFiles }))
    }

    const primaryFile = file || autoInspectFiles[0] || ''
    if (primaryFile && (mode === 'auto' || mode === 'inspect' || mode === 'diagnose')) {
      steps.push(await safeWorkflowCall(ctx, serverId, 'aidev_perceive', {
        file: primaryFile,
        with_content: !!args?.with_content
      }))
      steps.push(await safeWorkflowCall(ctx, serverId, 'aidev_static', { file: primaryFile }))
      steps.push(await safeWorkflowCall(ctx, serverId, 'aidev_affects', { file: primaryFile }))
    }
    if (autoInspectFiles.length && (mode === 'auto' || mode === 'verify' || mode === 'diagnose')) {
      const targets = autoInspectFiles
      for (const target of targets.slice(0, 8)) {
        steps.push(await safeWorkflowCall(ctx, serverId, 'aidev_check', { file: target }))
      }
    }
    if ((mode === 'auto' || mode === 'diagnose' || mode === 'verify') && (autoInspectFiles.length || query)) {
      steps.push(await runLogicReview(autoInspectFiles, ctx.projectPath || ''))
    }
    if ((mode === 'auto' || mode === 'diagnose' || mode === 'inspect' || mode === 'verify') && autoInspectFiles.length) {
      try {
        const trace = traceUiRootCause(ctx.projectPath || '', {
          query,
          files: autoInspectFiles
        })
        steps.push({
          success: trace.success !== false,
          tool: 'ui_root_cause_trace',
          data: trace,
          text: trace.next_action || ''
        })
      } catch (error) {
        steps.push({ success: false, tool: 'ui_root_cause_trace', error: error.message })
      }
    }

    const hasUsefulFallback = !!overviewRecovery?.evidence?.codeFileCount
    const summary = buildWorkflowSummary({ serverId, mode, query, files, recovery: overviewRecovery, unreliable, steps })
    return {
      success: steps.some(step => step.success) && (!unreliable || hasUsefulFallback),
      serverId,
      mode,
      query,
      files,
      degraded: unreliable,
      recovery: overviewRecovery,
      summary,
      steps: steps.map(compactWorkflowStep)
    }
  },

  mcp_aidev_project: async (args, ctx) => call(ctx, 'aidev_project', {}, args),
  mcp_aidev_perceive: async (args, ctx) => call(ctx, 'aidev_perceive', {
    file: args?.file || args?.path || '',
    with_content: !!args?.with_content
  }, args),
  mcp_aidev_scan: async (args, ctx) => call(ctx, 'aidev_scan', {
    files: Array.isArray(args?.files) ? args.files : []
  }, args),
  mcp_aidev_check: async (args, ctx) => call(ctx, 'aidev_check', {
    file: args?.file || args?.path || ''
  }, args),
  mcp_aidev_static: async (args, ctx) => call(ctx, 'aidev_static', {
    file: args?.file || args?.path || ''
  }, args),
  mcp_aidev_find: async (args, ctx) => call(ctx, 'aidev_find', {
    query: args?.query || '',
    limit: args?.limit
  }, args),
  mcp_aidev_affects: async (args, ctx) => call(ctx, 'aidev_affects', {
    file: args?.file || args?.path || ''
  }, args),
  mcp_aidev_logs: async (args, ctx) => call(ctx, 'aidev_logs', asObject(args), args),
  mcp_aidev_sync: async (args, ctx) => call(ctx, 'aidev_sync', {
    file: args?.file || args?.path || '',
    check_only: !!args?.check_only
  }, args)
}

module.exports = {
  handlers
}
