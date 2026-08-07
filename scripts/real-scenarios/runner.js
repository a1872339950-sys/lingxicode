const path = require('path')
const assert = require('./helpers/assert')
const { createScenarioWorkspace, writeText } = require('./helpers/temp-project')
const { loadCases, selectCases } = require('./registry')

const root = path.resolve(__dirname, '../..')

function parseArgs(argv) {
  const args = { filters: [], changedFiles: [], all: false, list: false }
  for (let index = 0; index < argv.length; index++) {
    const item = argv[index]
    if (item === '--all') args.all = true
    else if (item === '--list') args.list = true
    else if (item === '--changed') {
      while (argv[index + 1] && !argv[index + 1].startsWith('--')) {
        args.changedFiles.push(argv[++index])
      }
    } else if (item === '--case' && argv[index + 1]) {
      args.filters.push(argv[++index])
    } else if (!item.startsWith('--')) {
      args.filters.push(item)
    }
  }
  return args
}

async function runCase(testCase) {
  const startedAt = Date.now()
  const timeoutMs = Math.max(1000, Number(process.env.REAL_SCENARIO_TIMEOUT_MS) || 60000)
  const ctx = {
    root,
    assert,
    createWorkspace: scenarioId => createScenarioWorkspace(root, scenarioId),
    writeText
  }
  let timeoutId
  try {
    await Promise.race([
      testCase.run(ctx),
      new Promise((resolve, reject) => {
        timeoutId = setTimeout(() => reject(new Error(`Scenario timed out after ${timeoutMs}ms`)), timeoutMs)
      })
    ])
  } finally {
    if (timeoutId) clearTimeout(timeoutId)
  }
  return Date.now() - startedAt
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const cases = loadCases()

  if (args.list) {
    for (const testCase of cases) {
      console.log(`${testCase.id}  [${(testCase.tags || []).join(', ')}]`)
    }
    return
  }

  const selected = selectCases(cases, args)
  if (selected.length === 0) {
    console.log('No real scenarios selected.')
    return
  }

  const failures = []
  for (const testCase of selected) {
    try {
      const elapsedMs = await runCase(testCase)
      console.log(`[PASS] ${testCase.id} (${elapsedMs}ms)`)
    } catch (error) {
      failures.push({ testCase, error })
      console.error(`[FAIL] ${testCase.id}`)
      console.error(error.stack || error.message || String(error))
    }
  }

  if (failures.length > 0) {
    console.error(`\nReal scenario check failed: ${failures.length}/${selected.length}`)
    process.exit(1)
  }

  console.log(`Real scenario check passed: ${selected.length}/${selected.length}`)
  // Some scenarios intentionally exercise long-lived timers or servers.
  // All selected cases are complete here, so do not let leaked handles hang CI.
  process.exit(0)
}

main().catch(error => {
  console.error(error.stack || error.message || String(error))
  process.exit(1)
})
