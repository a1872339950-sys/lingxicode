const fs = require('fs')
const os = require('os')
const path = require('path')

function safeName(value = 'scenario') {
  return String(value || 'scenario').replace(/[^a-z0-9_.-]+/gi, '-').replace(/^-+|-+$/g, '') || 'scenario'
}

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, Math.max(0, ms))
}

function rmWithRetry(targetPath, options = {}) {
  const attempts = Math.max(1, options.attempts || 8)
  let lastError = null
  for (let index = 0; index < attempts; index++) {
    try {
      fs.rmSync(targetPath, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
      return
    } catch (error) {
      lastError = error
      if (!['EBUSY', 'ENOTEMPTY', 'EPERM'].includes(error?.code)) break
      sleepSync(Math.min(1000, 150 * (index + 1)))
    }
  }
  throw lastError
}

function createScenarioWorkspace(root, scenarioId) {
  const baseDir = path.join(root, '.tmp-real-scenarios')
  fs.mkdirSync(baseDir, { recursive: true })
  const dir = fs.mkdtempSync(path.join(baseDir, `${safeName(scenarioId)}-`))
  return {
    dir,
    projectPath: path.join(dir, 'project'),
    storagePath: path.join(dir, 'storage'),
    cleanup() {
      try {
        rmWithRetry(dir)
      } catch (error) {
        console.warn(`[WARN] Failed to cleanup scenario workspace: ${dir}`)
        console.warn(error?.message || String(error))
      }
      try {
        if (fs.existsSync(baseDir) && fs.readdirSync(baseDir).length === 0) {
          fs.rmdirSync(baseDir)
        }
      } catch {
        // Best-effort cleanup only.
      }
    }
  }
}

function writeText(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, content, 'utf-8')
}

module.exports = { createScenarioWorkspace, writeText, safeName }
