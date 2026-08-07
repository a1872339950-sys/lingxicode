const crypto = require('crypto')
const fs = require('fs')
const path = require('path')
const { execFile } = require('child_process')
const { nativeImage } = require('electron')
const runtimeTargets = require('./runtime-targets')
const adapterRegistry = require('./runtime-adapter-registry')

function resolveScriptPath(moduleDir = __dirname) {
  const sourcePath = path.join(moduleDir, '../powershell/windows-uia-runtime.ps1')
  const archiveSegment = `${path.sep}app.asar${path.sep}`
  if (sourcePath.includes(archiveSegment)) {
    return sourcePath.replace(archiveSegment, `${path.sep}app.asar.unpacked${path.sep}`)
  }
  return sourcePath
}

const SCRIPT_PATH = resolveScriptPath()
const sessions = new Map()

function encodePayload(payload = {}) {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64')
}

function flattenAccessibilityNodes(value, output = []) {
  if (Array.isArray(value)) {
    for (const item of value) flattenAccessibilityNodes(item, output)
    return output
  }
  if (value && typeof value === 'object') {
    const hasNodeShape = value.index !== undefined || value.name !== undefined ||
      value.role !== undefined || value.automation_id !== undefined || value.rect !== undefined
    if (hasNodeShape) output.push(value)
  }
  return output
}

function runPowerShell(action, payload = {}, timeout = 15000) {
  if (process.platform !== 'win32') return Promise.resolve({ success: false, unsupported: true, error: 'Windows UI Automation is only available on Windows' })
  if (!fs.existsSync(SCRIPT_PATH)) {
    return Promise.resolve({
      success: false,
      error_type: 'windows_uia_runtime_missing',
      error: `Windows UI Automation runtime script is missing: ${SCRIPT_PATH}`,
      script_path: SCRIPT_PATH
    })
  }
  return new Promise(resolve => {
    execFile('powershell.exe', [
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy', 'Bypass',
      '-File', SCRIPT_PATH,
      '-Action', action,
      '-PayloadBase64', encodePayload(payload)
    ], { windowsHide: true, timeout, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 }, (error, stdout, stderr) => {
      const lines = String(stdout || '').trim().split(/\r?\n/).filter(Boolean)
      try {
        const result = JSON.parse(lines[lines.length - 1] || '{}')
        resolve(result.success === false ? result : { success: true, ...result })
      } catch {
        resolve({ success: false, error: error?.message || String(stderr || stdout || 'Windows UI Automation returned no result') })
      }
    })
  })
}

function processAlive(pid) {
  try { process.kill(Number(pid), 0); return true } catch { return false }
}

function controllerId(handle) {
  const value = crypto.createHash('sha1').update(String(handle)).digest().readUInt32BE(0)
  return -(value || 1)
}

class WindowsUiaController {
  constructor(windowInfo = {}) {
    this.windowInfo = windowInfo
    this.windowId = Number(windowInfo.handle) || null
    this.processId = Number(windowInfo.process_id) || null
    this.id = controllerId(windowInfo.handle)
    this.isNativeRuntimeController = true
  }

  isDestroyed() { return !this.processId || !processAlive(this.processId) }
  isLoading() { return false }
  getType() { return 'windows-uia' }
  getURL() { return '' }
  getTitle() { return this.windowInfo.title || '' }
  async inspectAccessibility(options = {}) {
    const result = await runPowerShell(
      'inspect',
      { handle: this.windowInfo.handle, max_nodes: options.maxNodes || 400, max_depth: options.maxDepth || 8 },
      options.timeout || 20000
    )
    if (result?.success && result.nodes !== undefined) {
      result.nodes = flattenAccessibilityNodes(result.nodes)
    }
    return result
  }
  async performSemanticAction(locator = {}, options = {}) {
    return runPowerShell('action', {
      handle: this.windowInfo.handle,
      locator: {
        name: locator.name || locator.text || '',
        role: locator.role || '',
        automation_id: locator.automation_id || locator.automationId || locator.selector || ''
      },
      operation: options.operation || locator.operation || 'invoke',
      value: options.value ?? locator.value ?? '',
      wait_after_ms: options.waitAfterMs ?? 300
    }, options.timeout || 20000)
  }
  async capturePage() {
    const result = await runPowerShell('capture', { handle: this.windowInfo.handle }, 20000)
    if (!result.success || !result.png) throw new Error(result.error || 'Windows UI Automation capture failed')
    const png = Buffer.from(result.png, 'base64')
    const image = nativeImage.createFromBuffer(png)
    return { toPNG: () => png, getSize: () => image.getSize() }
  }
  async getRuntimeDiagnostics() {
    return { success: true, ok: true, total: 0, error_count: 0, warning_count: 0, events: [], limitations: ['Native application logs are not connected to Windows UI Automation.'] }
  }
}

function runtimeIdFor(sessionId, windowInfo) {
  const hash = crypto.createHash('sha1').update(`${sessionId}:${windowInfo.handle}:${windowInfo.process_id}`).digest('hex').slice(0, 10)
  return `runtime-windows-uia-${hash}`
}

async function discoverSessionWindows(input = {}) {
  if (process.platform !== 'win32' || !input.rootProcessId) return []
  const result = await runPowerShell('list', { root_process_id: Number(input.rootProcessId) }, 20000)
  if (!result.success) return []
  const state = sessions.get(input.sessionId) || { runtimeIds: new Set(), timer: null, stopped: false }
  sessions.set(input.sessionId, state)
  const adapter = adapterRegistry.getRuntimeAdapter('windows-uia')
  const registered = []
  for (const windowInfo of Array.isArray(result.windows) ? result.windows : []) {
    const runtimeId = runtimeIdFor(input.sessionId, windowInfo)
    if (state.runtimeIds.has(runtimeId)) continue
    const controller = new WindowsUiaController(windowInfo)
    const registration = runtimeTargets.registerRuntimeController(controller, {
      runtimeId,
      projectId: input.projectId || '',
      projectPath: input.workspacePath || '',
      workspacePath: input.workspacePath || '',
      processId: windowInfo.process_id,
      executablePath: windowInfo.executable_path || '',
      buildType: 'development',
      kind: 'native-application-window',
      source: 'terminal-process-tree',
      adapter: adapter.id,
      capabilities: adapter.capabilities,
      title: windowInfo.title,
      active: true
    })
    if (registration.success) {
      state.runtimeIds.add(runtimeId)
      registered.push(registration.target)
    }
  }
  return registered
}

function bindTerminalSession(input = {}) {
  if (process.platform !== 'win32' || !input.sessionId || !input.rootProcessId) return
  unregisterWindowsSession(input.sessionId)
  const state = { runtimeIds: new Set(), timer: null, stopped: false, attempts: 0 }
  sessions.set(input.sessionId, state)
  const poll = async () => {
    if (state.stopped) return
    state.attempts += 1
    await discoverSessionWindows(input).catch(() => {})
    if (!state.stopped && state.attempts < 12 && state.runtimeIds.size === 0) {
      state.timer = setTimeout(poll, 1000)
      state.timer.unref?.()
    }
  }
  state.timer = setTimeout(poll, 600)
  state.timer.unref?.()
}

function unregisterWindowsSession(sessionId = '') {
  const state = sessions.get(sessionId)
  if (!state) return
  state.stopped = true
  if (state.timer) clearTimeout(state.timer)
  for (const runtimeId of state.runtimeIds) runtimeTargets.unregisterRuntimeTarget(runtimeId)
  sessions.delete(sessionId)
}

function resetForTests() {
  for (const sessionId of [...sessions.keys()]) unregisterWindowsSession(sessionId)
}

module.exports = {
  SCRIPT_PATH,
  WindowsUiaController,
  bindTerminalSession,
  flattenAccessibilityNodes,
  discoverSessionWindows,
  resetForTests,
  resolveScriptPath,
  runPowerShell,
  unregisterWindowsSession
}
