const fs = require('fs/promises')
const path = require('path')
const { spawn } = require('child_process')
const { getRgPath } = require('./rg-path')

const ALLOWED_TASKS = new Set(['read_file', 'find_in_file', 'rg_search'])
const MAX_TASKS = 6
const MAX_CONCURRENCY = 2
const DEFAULT_TIMEOUT_MS = 15000
const MAX_READ_CHARS = 24000
const MAX_RESULTS = 60
const IGNORE_GLOBS = ['.git', 'node_modules', 'dist', 'build', 'out', 'coverage', 'temp', 'tmp', '.cache', 'codemap', 'change-sessions', '.lingxi-temp-artifacts', 'release', '__pycache__']

function normalizeTasks(tasks) {
  if (!Array.isArray(tasks)) return []
  return tasks.slice(0, MAX_TASKS).map((task, index) => ({
    id: String(task?.id || `task-${index + 1}`),
    kind: String(task?.kind || ''),
    args: task?.args && typeof task.args === 'object' ? task.args : {}
  }))
}

function validateTask(task) {
  if (!ALLOWED_TASKS.has(task.kind)) return `unsupported task kind: ${task.kind || '(empty)'}`
  if (!task.args || typeof task.args !== 'object') return 'task args must be an object'
  if (task.kind === 'rg_search' && !String(task.args.pattern || '').trim()) return 'rg_search requires pattern'
  if ((task.kind === 'read_file' || task.kind === 'find_in_file') && !String(task.args.path || '').trim()) return `${task.kind} requires path`
  if (task.kind === 'find_in_file' && !String(task.args.pattern || '').trim()) return 'find_in_file requires pattern'
  return ''
}

function clipText(text = '', limit = MAX_READ_CHARS) {
  const value = String(text || '')
  return value.length <= limit ? { text: value, truncated: false } : {
    text: `${value.slice(0, limit - 80)}\n...[output clipped]...`,
    truncated: true
  }
}

async function executeReadFile(args = {}, projectPath) {
  const filePath = path.resolve(String(args.path || ''))
  const stat = await fs.stat(filePath)
  if (!stat.isFile()) throw new Error('path is not a file')
  if (stat.size > 2 * 1024 * 1024) throw new Error('read_file exceeds the 2MB parallel research limit')
  const source = await fs.readFile(filePath, 'utf8')
  const lines = source.split(/\r?\n/)
  const startLine = Math.max(1, Number(args.start_line) || 1)
  const endLine = Math.max(startLine, Number(args.end_line) || lines.length)
  const clipped = clipText(lines.slice(startLine - 1, endLine).join('\n'), Math.min(MAX_READ_CHARS, Number(args.max_chars) || 12000))
  return { path: path.relative(projectPath, filePath).replace(/\\/g, '/'), content: clipped.text, start_line: startLine, end_line: Math.min(endLine, lines.length), truncated: clipped.truncated }
}

async function executeFindInFile(args = {}, projectPath) {
  const filePath = path.resolve(String(args.path || ''))
  const stat = await fs.stat(filePath)
  if (!stat.isFile()) throw new Error('path is not a file')
  if (stat.size > 2 * 1024 * 1024) throw new Error('find_in_file exceeds the 2MB parallel research limit')
  const source = await fs.readFile(filePath, 'utf8')
  const query = String(args.pattern || '')
  const matcher = args.regex ? new RegExp(query, args.case_sensitive ? 'g' : 'gi') : null
  const needle = args.case_sensitive ? query : query.toLowerCase()
  const lines = source.split(/\r?\n/)
  const context = Math.max(0, Math.min(4, Number(args.context_lines) || 0))
  const matches = []
  for (let index = 0; index < lines.length && matches.length < Math.min(MAX_RESULTS, Number(args.max_results) || 30); index += 1) {
    const line = lines[index]
    const hit = matcher ? (matcher.lastIndex = 0, matcher.test(line)) : (args.case_sensitive ? line : line.toLowerCase()).includes(needle)
    if (hit) matches.push({ line: index + 1, text: line, context: lines.slice(Math.max(0, index - context), index + context + 1).join('\n') })
  }
  return { path: path.relative(projectPath, filePath).replace(/\\/g, '/'), totalMatches: matches.length, matches }
}

function executeRgSearch(args = {}, projectPath, timeoutMs) {
  return new Promise(resolve => {
    const cwd = path.resolve(String(args.path || projectPath))
    const limit = Math.max(1, Math.min(MAX_RESULTS, Number(args.max_results) || 40))
    const rgArgs = ['--no-heading', '--line-number', '--color', 'never', '--max-count', String(limit), '--max-filesize', '2M']
    IGNORE_GLOBS.forEach(dir => rgArgs.push('--glob', `!${dir}/**`))
    if (!args.case_sensitive) rgArgs.push('-i')
    if (args.fixed_strings !== false) rgArgs.push('-F')
    rgArgs.push(String(args.pattern || ''), '.')
    const child = spawn(getRgPath(), rgArgs, { cwd, windowsHide: true, shell: false, stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    let done = false
    const finish = result => {
      if (done) return
      done = true
      clearTimeout(timer)
      child.removeAllListeners()
      resolve(result)
    }
    const timer = setTimeout(() => {
      child.kill()
      finish({ success: false, timeout: true, error: `rg_search timed out after ${timeoutMs}ms` })
    }, timeoutMs)
    child.stdout.on('data', chunk => { if (stdout.length < MAX_READ_CHARS) stdout += chunk.toString() })
    child.stderr.on('data', chunk => { if (stderr.length < 4000) stderr += chunk.toString() })
    child.once('error', error => finish({ success: false, error: error.message }))
    child.once('close', code => {
      if (code !== 0 && code !== 1) return finish({ success: false, error: stderr || `rg exited with code ${code}` })
      finish({ success: true, result: { pattern: args.pattern, cwd: path.relative(projectPath, cwd).replace(/\\/g, '/') || '.', matches: stdout.split(/\r?\n/).filter(Boolean).slice(0, limit) } })
    })
  })
}

async function executeTask(task, projectPath, timeoutMs) {
  if (task.kind === 'read_file') return { success: true, result: await executeReadFile(task.args, projectPath) }
  if (task.kind === 'find_in_file') return { success: true, result: await executeFindInFile(task.args, projectPath) }
  if (task.kind === 'rg_search') return executeRgSearch(task.args, projectPath, timeoutMs)
  return { success: false, error: `unsupported parallel research task: ${task.kind}` }
}

async function runWithConcurrency(items, limit, worker) {
  const results = new Array(items.length)
  let nextIndex = 0
  async function consume() {
    while (nextIndex < items.length) {
      const index = nextIndex++
      results[index] = await worker(items[index])
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, consume))
  return results
}

async function executeParallelResearch(args = {}, ctx = {}) {
  const tasks = normalizeTasks(args.tasks).map(task => ({
    ...task,
    args: task.args?.path ? { ...task.args, path: ctx.resolvePath ? ctx.resolvePath(task.args.path) : task.args.path } : task.args
  }))
  if (!tasks.length) return { success: false, error: 'tasks must contain at least one read-only task' }
  const timeoutMs = Math.max(1000, Math.min(60000, Number(args.timeout_ms) || DEFAULT_TIMEOUT_MS))
  const results = await runWithConcurrency(tasks, MAX_CONCURRENCY, async task => {
    const validationError = validateTask(task)
    if (validationError) return { id: task.id, kind: task.kind, success: false, error: validationError }
    if (ctx.signal?.aborted) return { id: task.id, kind: task.kind, success: false, aborted: true, error: 'parallel research task aborted' }
    const outcome = await executeTask(task, ctx.projectPath, timeoutMs)
    return outcome.success
      ? { id: task.id, kind: task.kind, success: true, result: outcome.result }
      : { id: task.id, kind: task.kind, ...outcome }
  })
  const succeeded = results.filter(item => item.success).length
  return {
    success: succeeded === results.length,
    partial: succeeded > 0 && succeeded < results.length,
    task_count: results.length,
    succeeded,
    failed: results.length - succeeded,
    results
  }
}

module.exports = { ALLOWED_TASKS, MAX_CONCURRENCY, executeParallelResearch }