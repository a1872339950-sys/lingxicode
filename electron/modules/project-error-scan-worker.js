const { parentPort, workerData } = require('worker_threads')
const diagnostics = require('./tool-handlers/diagnostics')

async function runStaticDiagnostics(projectPath, args = {}) {
  const maxFailureArg = args.max_failures ?? args.maxFailures
  const maxFailures = maxFailureArg === 'all' || args.full === true || args.fullScan === true
    ? 'all'
    : Math.min(5000, Math.max(1, Number(maxFailureArg || 6) || 6))
  const syntax = await diagnostics.scanProjectSyntax(projectPath, {
    roots: args.roots,
    max_failures: maxFailures,
    full: args.full === true || args.fullScan === true
  })
  const deepReview = args.deep === true || args.full === true || args.fullScan === true
  const reviewFiles = Array.isArray(args.files) && args.files.length
    ? args.files
    : (deepReview ? [] : (Array.isArray(syntax.failed_files) ? syntax.failed_files.map(item => item.path).filter(Boolean) : []))
  const logicReview = deepReview || reviewFiles.length
    ? await diagnostics.reviewFixQualityAsync(reviewFiles, projectPath, {
        deep: deepReview,
        skipDefaultScan: !deepReview
      })
    : null
  return { syntax, logicReview }
}

;(async () => {
  const result = await runStaticDiagnostics(workerData?.projectPath || '', workerData?.args || {})
  if (result.syntax?.success === false) {
    parentPort.postMessage({ success: false, error: result.syntax.error || result.syntax.message || 'Project syntax scan failed.' })
    return
  }
  parentPort.postMessage({ success: true, result })
})().catch(error => {
  parentPort.postMessage({
    success: false,
    error: error?.message || String(error),
    stack: error?.stack || ''
  })
})
