const { parentPort, workerData } = require('worker_threads')
const { runProjectHealthScan } = require('./project-health-scan')

;(async () => {
  const result = await runProjectHealthScan({
    ...(workerData?.options || {}),
    disable_worker: true
  })
  parentPort.postMessage({ success: true, result })
})().catch(error => {
  parentPort.postMessage({
    success: false,
    error: error?.message || String(error),
    stack: error?.stack || ''
  })
})
