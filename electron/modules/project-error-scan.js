const path = require('path')
const { Worker } = require('worker_threads')
const diagnostics = require('./tool-handlers/diagnostics')
const { runProjectHealthScanInWorker } = require('./project-health-scan')

function compactFinding(item = {}) {
  return {
    severity: item.severity || 'warning',
    type: item.type || 'project-health-risk',
    category: item.category || 'logic',
    classification: item.classification || '',
    path: item.path || item.file || '',
    line: item.line || null,
    message: item.message || '',
    evidence: item.evidence || '',
    suggestion: item.suggestion || ''
  }
}

function compactHealthResult(raw = {}, options = {}) {
  const health = raw.health || {}
  const syntax = raw.syntax || {}
  const views = health.finding_views || {}
  const topFindings = Array.isArray(health.top_findings) ? health.top_findings : []
  const allHealthFindings = Array.isArray(health.findings) ? health.findings : []
  const evidenceFirst = Array.isArray(views.evidence_first) ? views.evidence_first : topFindings
  const productionFirst = Array.isArray(views.production_first) ? views.production_first : []
  const runtimeFindings = allHealthFindings
    .filter(item => item.category === 'runtime' || /runtime|console|f12|uncaught|rejection|log/i.test(String(item.type || item.source || '')))
  const full = options.full === true || options.fullScan === true
  const maxFindings = full ? Number.MAX_SAFE_INTEGER : Math.max(1, Number(options.maxFindings || 120) || 120)
  const maxProductionFindings = full ? Number.MAX_SAFE_INTEGER : Math.max(1, Number(options.maxProductionFindings || 80) || 80)
  const maxRuntimeFindings = full ? Number.MAX_SAFE_INTEGER : Math.max(1, Number(options.maxRuntimeFindings || 80) || 80)
  const displayFindings = full && allHealthFindings.length ? allHealthFindings : evidenceFirst

  return {
    success: raw.success !== false && health.success !== false,
    mode: options.runtime ? 'runtime' : 'static',
    scan_depth: options.deep ? 'deep' : 'fast',
    project_path: health.project_path || options.projectPath || '',
    scanned_at: new Date().toISOString(),
    syntax: {
      checked_count: syntax.checked_count || 0,
      total_candidates: syntax.total_candidates || syntax.checked_count || 0,
      failed_count: syntax.failed_count || 0,
      warning_count: syntax.warning_count || 0,
      failed_files: Array.isArray(syntax.failed_files) ? syntax.failed_files.slice(0, full ? syntax.failed_files.length : 20) : [],
      warning_files: Array.isArray(syntax.warning_files) ? syntax.warning_files.slice(0, full ? syntax.warning_files.length : 8) : []
    },
    summary: {
      finding_count: health.finding_count || 0,
      error_count: health.error_count || 0,
      warning_count: health.warning_count || 0,
      categories: health.categories || {},
      path_class_summary: health.path_class_summary || {}
    },
    evidence_policy: health.evidence_policy || null,
    findings: displayFindings.slice(0, maxFindings).map(compactFinding),
    production_findings: productionFirst.slice(0, maxProductionFindings).map(compactFinding),
    runtime_findings: runtimeFindings.slice(0, maxRuntimeFindings).map(compactFinding),
    evidence_bundle: health.evidence_bundle ? {
      manifest_path: health.evidence_bundle.manifest_path || '',
      counts: health.evidence_bundle.counts || {},
      cleanup: health.evidence_bundle.cleanup || null
    } : null,
    runtime: health.runtime || raw.runtimeDiagnostics || null,
    runtime_probe: raw.runtimeProbe || null,
    runtime_closure: raw.runtimeClosure || null,
    next_action: health.next_action || raw.next_action || ''
  }
}

function runStaticDiagnosticsInWorker(projectPath, args = {}) {
  return new Promise((resolve, reject) => {
    const timeoutMs = Math.max(10000, Math.min(300000, Number(args.worker_timeout_ms || args.workerTimeoutMs || 120000) || 120000))
    const worker = new Worker(path.join(__dirname, 'project-error-scan-worker.js'), {
      workerData: { projectPath, args }
    })
    let settled = false
    const finish = (callback, value) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      worker.removeAllListeners()
      worker.terminate().catch(() => {})
      callback(value)
    }
    const timer = setTimeout(() => {
      worker.terminate().catch(() => {})
      finish(reject, new Error(`Project error scan worker timed out after ${timeoutMs}ms.`))
    }, timeoutMs)
    worker.once('message', message => {
      if (message?.success === false) {
        finish(reject, new Error(message.error || 'Project error scan worker failed.'))
        return
      }
      finish(resolve, message?.result || {})
    })
    worker.once('error', error => finish(reject, error))
    worker.once('exit', code => {
      if (!settled) finish(reject, new Error(`Project error scan worker exited before returning a result (code ${code}).`))
    })
  })
}

async function runFastErrorScan(projectPath, args = {}) {
  const maxFailures = Math.min(10, Math.max(1, Number(args.max_failures || args.maxFailures || 6) || 6))
  const staticDiagnostics = await runStaticDiagnosticsInWorker(projectPath, {
    ...args,
    max_failures: maxFailures
  })
  const syntax = staticDiagnostics.syntax || {}
  const logicReview = staticDiagnostics.logicReview || {
        ok: true,
        scope: 'fast_syntax_runtime_only',
        reviewed_count: 0,
        error_count: 0,
        warning_count: 0,
        findings: [],
        requires_ui_behavior_verification: false,
        ui_behavior_verification: [],
        read_hints: [],
        next_action: 'Fast scan skipped full logic review to keep the UI responsive. Use deep/full scan for project-wide logic, IPC, CSS/DOM, and residue analysis.'
      }
  const runtime = diagnostics.summarizeRuntimeDiagnosticsSafe({
    since_ms: args.runtime_since_ms || args.runtimeSinceMs || 10 * 60 * 1000,
    limit: args.runtime_limit || args.runtimeLimit || 40
  })
  const logicFindings = Array.isArray(logicReview.findings) ? logicReview.findings : []
  const syntaxFindings = (Array.isArray(syntax.failed_files) ? syntax.failed_files : []).map(item => ({
    severity: 'error',
    type: 'syntax-error',
    category: 'syntax',
    path: item.relative_path || item.path,
    line: item.errors?.[0]?.line || null,
    message: item.errors?.[0]?.message || 'Syntax check failed',
    evidence: item.code_frame?.snippet || '',
    suggestion: item.repair_hint || item.code_frame?.repair_hint || ''
  }))
  const runtimeFindings = (Array.isArray(runtime.recent_errors) ? runtime.recent_errors : []).map(item => ({
    severity: 'error',
    type: item.type || 'runtime-error',
    category: 'runtime',
    path: item.path || item.file || '',
    line: item.line || null,
    message: item.message || item.error || '',
    evidence: item.stack || item.source || '',
    suggestion: ''
  }))
  const findings = [...syntaxFindings, ...logicFindings, ...runtimeFindings]
  const errorCount = findings.filter(item => item.severity === 'error').length
  const warningCount = findings.filter(item => item.severity !== 'error').length
  const categories = findings.reduce((acc, item) => {
    const key = item.category || item.type || 'other'
    acc[key] = (acc[key] || 0) + 1
    return acc
  }, {})

  return {
    success: true,
    mode: 'static',
    scan_depth: 'fast',
    project_path: projectPath,
    scanned_at: new Date().toISOString(),
    syntax: {
      checked_count: syntax.checked_count || 0,
      total_candidates: syntax.total_candidates || syntax.checked_count || 0,
      failed_count: syntax.failed_count || 0,
      failed_files: Array.isArray(syntax.failed_files) ? syntax.failed_files.slice(0, 20) : []
    },
    summary: {
      finding_count: findings.length,
      error_count: errorCount,
      warning_count: warningCount,
      categories,
      path_class_summary: {}
    },
    evidence_policy: {
      depth: 'fast',
      note: 'Fast scan runs syntax, lightweight logic review, and existing runtime log summary. Use deep/full or runtime scan for worker-based health and live F12/runtime closure.'
    },
    findings: findings.slice(0, 120).map(compactFinding),
    production_findings: findings.slice(0, 80).map(compactFinding),
    runtime_findings: runtimeFindings.slice(0, 80).map(compactFinding),
    evidence_bundle: null,
    runtime,
    runtime_probe: null,
    runtime_closure: null,
    next_action: errorCount
      ? 'Inspect the top findings and verify suspected issues against source before fixing.'
      : 'Fast scan found no high-priority issue. Use deep/full scan when you need heavier residue, IPC, CSS/DOM, and cross-file health analysis.'
  }
}

async function runErrorScan(args = {}) {
  const projectPath = path.resolve(String(args.projectPath || args.project_path || ''))
  if (!projectPath) return { success: false, error: 'missing_project_path' }
  const runtime = args.runtime === true || args.mode === 'runtime'
  const full = args.full === true || args.fullScan === true || args.scope === 'full' || args.mode === 'full'
  const deep = runtime || full || args.deep === true || args.scope === 'deep'
  if (!deep) {
    return runFastErrorScan(projectPath, args)
  }
  const query = runtime
    ? '只扫描当前项目。执行运行态错误扫描，抓取后端日志、F12/浏览器错误、运行时异常，并结合语法、逻辑、CSS DOM、IPC、路径污染、状态同步做综合诊断。'
    : '只扫描当前项目。执行错误扫描，覆盖语法、逻辑、CSS DOM、IPC、路径污染、状态同步、安全风险和已有运行时错误，不要跨项目。'

  if (!runtime) {
    const staticDiagnostics = await runStaticDiagnosticsInWorker(projectPath, {
      ...args,
      deep: true,
      full,
      fullScan: full,
      max_failures: full ? 'all' : 50
    })
    const runtimeDiagnostics = diagnostics.summarizeRuntimeDiagnosticsSafe({
      since_ms: args.runtime_since_ms || args.runtimeSinceMs || 10 * 60 * 1000,
      limit: args.runtime_limit || args.runtimeLimit || 80,
      projectId: args.projectId || args.project_id || '',
      projectPath
    })
    const health = await runProjectHealthScanInWorker({
      projectPath,
      query,
      userMessage: query,
      diagnostics: {
        syntax: staticDiagnostics.syntax || null,
        logicReview: staticDiagnostics.logicReview || null,
        runtime: runtimeDiagnostics,
        runtimeProbe: null,
        runtimeClosure: null
      },
      include_ipc: args.include_ipc !== false,
      full,
      fullScan: full,
      top_limit: full ? 5000 : 80
    })
    return compactHealthResult({
      success: health?.success !== false,
      syntax: staticDiagnostics.syntax || {},
      health,
      runtimeDiagnostics
    }, { projectPath, runtime: false, deep: true, full })
  }

  const raw = await diagnostics.handlers.dev_workflow({
    mode: deep ? 'health' : 'triage',
    project_path: projectPath,
    query,
    top_limit: full ? 5000 : (deep ? 80 : 40),
    max_failures: full ? 'all' : (deep ? 50 : 12),
    full,
    runtime_probe: runtime,
    runtime_closure: runtime,
    launch_if_needed: runtime,
    runtime_timeout_ms: args.timeoutMs || args.timeout_ms || 15000
  }, {
    projectPath,
    projectId: args.projectId || args.project_id || '',
    options: { userMessage: query }
  })

  return compactHealthResult(raw, { projectPath, runtime, deep, full })
}

function registerIPC(ipcMain) {
  ipcMain.handle('project-error-scan:run', async (event, args = {}) => {
    try {
      return await runErrorScan(args || {})
    } catch (error) {
      return { success: false, error: error.message || String(error) }
    }
  })
}

module.exports = {
  registerIPC,
  runErrorScan,
  runStaticDiagnosticsInWorker,
  compactHealthResult
}
