const { spawnSync } = require('child_process')
const path = require('path')
const { loadCases, selectCases } = require('./real-scenarios/registry')

const root = path.resolve(__dirname, '..')

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: 'inherit',
    shell: false,
    ...options
  })
  if (result.status !== 0) process.exit(result.status || 1)
}

function capture(command, args) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  })
  if (result.status !== 0) return ''
  return result.stdout || ''
}

function getChangedFiles() {
  const tracked = capture('git', ['diff', '--name-only', '--diff-filter=ACMRTUB'])
    .split(/\r?\n/)
    .filter(Boolean)
  const untracked = capture('git', ['ls-files', '--others', '--exclude-standard'])
    .split(/\r?\n/)
    .filter(Boolean)
  return [...new Set([...tracked, ...untracked])]
}

function parseArgs(argv) {
  return {
    all: argv.includes('--all'),
    list: argv.includes('--list')
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  const cases = loadCases()
  if (args.list) {
    run(process.execPath, ['scripts/real-scenarios/runner.js', '--list'])
    return
  }

  const changedFiles = getChangedFiles()
  const selected = selectCases(cases, { all: args.all, changedFiles })

  console.log(`[verify-change] Changed files: ${changedFiles.length}`)
  run(process.execPath, ['scripts/check-syntax.js'])

  if (selected.length === 0) {
    console.log('[verify-change] No matching real scenario. Syntax check is the selected verification.')
    return
  }

  console.log(`[verify-change] Running real scenarios: ${selected.map(item => item.id).join(', ')}`)
  run(process.execPath, ['scripts/real-scenarios/runner.js', ...selected.flatMap(item => ['--case', item.id])])
}

main()
