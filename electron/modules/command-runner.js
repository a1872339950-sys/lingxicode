/**
 * Isolated command host. This process owns the shell and every child it starts;
 * Electron only receives bounded output messages through IPC.
 */

const os = require('os')
const { spawn } = require('child_process')

const MAX_OUTPUT_BYTES = 2 * 1024 * 1024
const DEFAULT_TIMEOUT_MS = 30 * 1000
const MAX_TIMEOUT_MS = 10 * 60 * 1000

let activeChild = null
let activeTimer = null
let stopping = false

function send(type, payload = {}) {
  if (process.send) process.send({ type, ...payload })
}

function resolveShell(command) {
  const text = String(command || '').trim()
  if (os.platform() === 'win32') {
    if (/^(cmd|cmd\.exe|powershell|powershell\.exe|pwsh|pwsh\.exe)\b/i.test(text)) {
      return { file: 'cmd.exe', args: ['/d', '/s', '/c', text], windowsVerbatimArguments: true }
    }
    return { file: 'cmd.exe', args: ['/d', '/s', '/c', `chcp 65001 >nul && ${text}`], windowsVerbatimArguments: true }
  }
  return { file: process.env.SHELL || '/bin/sh', args: ['-lc', text], windowsVerbatimArguments: false }
}

function stopTree(reason = 'cancelled') {
  if (!activeChild?.pid || stopping) return
  stopping = true
  clearTimeout(activeTimer)
  if (os.platform() === 'win32') {
    const killer = spawn('taskkill.exe', ['/PID', String(activeChild.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' })
    killer.unref?.()
  } else {
    activeChild.kill('SIGTERM')
  }
  send('stopping', { reason })
}

function sanitizeSpawnEnv(env = {}) {
  const next = { ...env }
  // Never inherit host ELECTRON_RUN_AS_NODE into user project shells.
  delete next.ELECTRON_RUN_AS_NODE
  return next
}

function run(payload = {}) {
  const command = String(payload.command || '').trim()
  if (!command) throw new Error('command is required')
  const timeoutMs = Math.max(1000, Math.min(MAX_TIMEOUT_MS, Number(payload.timeoutMs) || DEFAULT_TIMEOUT_MS))
  const shell = resolveShell(command)
  const child = spawn(shell.file, shell.args, {
    cwd: payload.cwd || process.cwd(),
    env: sanitizeSpawnEnv({ ...process.env, ...(payload.env || {}) }),
    windowsHide: true,
    windowsVerbatimArguments: shell.windowsVerbatimArguments,
    stdio: ['ignore', 'pipe', 'pipe']
  })
  activeChild = child
  let outputBytes = 0
  let clipped = false
  const forward = stream => chunk => {
    if (clipped) return
    const text = String(chunk || '')
    outputBytes += Buffer.byteLength(text)
    if (outputBytes > MAX_OUTPUT_BYTES) {
      clipped = true
      send('output', { stream: 'system', text: '\n[output limit reached; remaining output suppressed]\n' })
      return
    }
    send('output', { stream, text })
  }
  child.stdout?.on('data', forward('stdout'))
  child.stderr?.on('data', forward('stderr'))
  child.once('error', error => send('error', { error: error.message || String(error) }))
  child.once('close', (code, signal) => {
    clearTimeout(activeTimer)
    send('exit', { code, signal, stopped: stopping, outputBytes, clipped })
    activeChild = null
    process.exit(code === 0 || stopping ? 0 : 1)
  })
  activeTimer = setTimeout(() => stopTree('timeout'), timeoutMs)
  activeTimer.unref?.()
  send('started', { pid: child.pid, timeoutMs })
}

process.on('message', message => {
  if (!message || typeof message !== 'object') return
  if (message.type === 'stop') stopTree(message.reason || 'cancelled')
  if (message.type === 'run' && !activeChild) {
    try {
      run(message)
    } catch (error) {
      send('error', { error: error.message || String(error) })
      process.exit(1)
    }
  }
})

process.on('disconnect', () => stopTree('parent_disconnected'))