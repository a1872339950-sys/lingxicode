const fs = require('fs')
const path = require('path')

function loadCases() {
  const casesDir = path.join(__dirname, 'cases')
  const loaded = []
  for (const name of fs.readdirSync(casesDir).filter(n => n.endsWith('.js')).sort()) {
    const filePath = path.join(casesDir, name)
    let mod
    try {
      mod = require(filePath)
    } catch (error) {
      console.error(`[real-scenarios] failed to load ${name}:`, error.message || error)
      continue
    }
    if (!mod || typeof mod !== 'object' || !mod.id || typeof mod.run !== 'function') {
      console.error(`[real-scenarios] skip invalid case module: ${name} (need exports.id + exports.run)`)
      continue
    }
    loaded.push(mod)
  }
  return loaded
}

function normalizePath(filePath = '') {
  return String(filePath || '').replace(/\\/g, '/')
}

function caseMatchesChangedFiles(testCase, changedFiles = []) {
  if (!Array.isArray(testCase.changedFilePatterns) || testCase.changedFilePatterns.length === 0) return false
  return changedFiles.some(file => {
    const normalized = normalizePath(file)
    return testCase.changedFilePatterns.some(pattern => pattern.test(normalized))
  })
}

function selectCases(cases, options = {}) {
  const filters = new Set((options.filters || []).map(item => String(item).toLowerCase()))
  if (options.all || filters.has('all')) return cases

  if (filters.size > 0) {
    return cases.filter(testCase =>
      filters.has(String(testCase.id).toLowerCase()) ||
      (testCase.tags || []).some(tag => filters.has(String(tag).toLowerCase()))
    )
  }

  const changedFiles = options.changedFiles || []
  if (changedFiles.length > 0) return cases.filter(testCase => caseMatchesChangedFiles(testCase, changedFiles))
  return cases
}

module.exports = { loadCases, selectCases, caseMatchesChangedFiles, normalizePath }
