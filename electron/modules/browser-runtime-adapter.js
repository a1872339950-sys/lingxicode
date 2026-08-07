const crypto = require('crypto')
const path = require('path')
const { BrowserWindow, session } = require('electron')
const runtimeTargets = require('./runtime-targets')
const adapterRegistry = require('./runtime-adapter-registry')
const runtimeDiagnostics = require('./runtime-diagnostics')

const instances = new Map()

function isLocalDevelopmentUrl(input = '') {
  try {
    const url = new URL(String(input))
    return ['http:', 'https:'].includes(url.protocol) && ['localhost', '127.0.0.1', '0.0.0.0', '::1', '[::1]'].includes(url.hostname)
  } catch {
    return false
  }
}

function normalizedUrl(input = '') {
  const url = new URL(String(input))
  if (url.hostname === '0.0.0.0') url.hostname = '127.0.0.1'
  return url.toString()
}

function instanceKey(input = {}) {
  return `${input.projectId || 'unscoped'}:${input.sessionId || 'session'}:${normalizedUrl(input.url)}`
}

function runtimeIdFor(input = {}) {
  const hash = crypto.createHash('sha1').update(instanceKey(input)).digest('hex').slice(0, 10)
  return `runtime-browser-${String(input.projectId || 'unscoped').replace(/[^a-z0-9_-]+/gi, '-').slice(0, 32)}-${hash}`
}

function networkSeverity(details = {}) {
  const status = Number(details.statusCode || 0)
  if (status >= 500) return 'error'
  if (status >= 400 && ['mainFrame', 'script', 'stylesheet', 'xhr', 'fetch', 'webSocket'].includes(details.resourceType)) return 'error'
  return status >= 400 ? 'warning' : 'info'
}

function attachBrowserDiagnostics(win, input, runtimeId, isolatedSession) {
  const base = details => ({
    source: 'browser-runtime-adapter',
    webContentsId: win.webContents.id,
    projectId: input.projectId || '',
    url: details?.url || win.webContents.getURL() || '',
    title: win.webContents.getTitle() || input.title || ''
  })
  isolatedSession.webRequest.onCompleted({ urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'] }, details => {
    const severity = networkSeverity(details)
    if (severity === 'info') return
    runtimeDiagnostics.record({
      ...base(details),
      severity,
      type: details.resourceType === 'webSocket' ? 'websocket-http-failure' : 'network-http-failure',
      message: `${details.method || 'GET'} ${details.url} returned HTTP ${details.statusCode}`,
      detail: { statusCode: details.statusCode, method: details.method, resourceType: details.resourceType }
    })
  })
  isolatedSession.webRequest.onErrorOccurred({ urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'] }, details => {
    runtimeDiagnostics.record({
      ...base(details),
      severity: 'error',
      type: details.resourceType === 'webSocket' ? 'websocket-connection-failure' : 'network-request-failure',
      message: `${details.method || 'GET'} ${details.url} failed: ${details.error || 'unknown network error'}`,
      detail: { error: details.error, method: details.method, resourceType: details.resourceType }
    })
  })
  const updateRoute = (_event, url) => {
    runtimeTargets.touchRuntimeTarget(runtimeId, {
      url: url || win.webContents.getURL(),
      title: win.webContents.getTitle() || input.title || '',
      active: true
    })
    runtimeDiagnostics.record({
      ...base({ url: url || win.webContents.getURL() }),
      severity: 'info',
      type: 'route-change',
      message: `route changed to ${url || win.webContents.getURL()}`
    })
  }
  win.webContents.on('did-navigate', updateRoute)
  win.webContents.on('did-navigate-in-page', updateRoute)
}

async function registerBrowserDevelopmentTarget(input = {}) {
  if (!isLocalDevelopmentUrl(input.url)) return { success: false, ignored: true, error: 'only local development URLs can be registered' }
  const key = instanceKey(input)
  const existing = instances.get(key)
  if (existing && !existing.window.isDestroyed()) return { success: true, reused: true, runtime_id: existing.runtimeId }

  const url = normalizedUrl(input.url)
  const partition = `lingxi-browser-runtime-${crypto.createHash('sha1').update(key).digest('hex').slice(0, 16)}`
  const isolatedSession = session.fromPartition(partition, { cache: false })
  const win = new BrowserWindow({
    show: false,
    width: Math.max(320, Number(input.width) || 1440),
    height: Math.max(240, Number(input.height) || 900),
    webPreferences: {
      offscreen: true,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      partition
    }
  })
  const runtimeId = runtimeIdFor(input)
  attachBrowserDiagnostics(win, input, runtimeId, isolatedSession)
  instances.set(key, { window: win, runtimeId, sessionId: input.sessionId || '', projectId: input.projectId || '' })
  try {
    let loadError = null
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        await win.loadURL(url)
        loadError = null
        break
      } catch (error) {
        loadError = error
        if (attempt < 4) await new Promise(resolve => setTimeout(resolve, 400 * (attempt + 1)))
      }
    }
    if (loadError) throw loadError
    const adapter = adapterRegistry.getRuntimeAdapter('browser')
    const registration = runtimeTargets.registerBrowserWindow(win, {
      runtimeId,
      projectId: input.projectId || '',
      projectPath: input.workspacePath || '',
      workspacePath: input.workspacePath ? path.resolve(input.workspacePath) : '',
      processId: Number(input.processId) || null,
      buildType: 'development',
      kind: 'browser-development-server',
      source: 'terminal-detected-url',
      adapter: adapter.id,
      capabilities: adapter.capabilities,
      title: input.title || win.getTitle() || url,
      url,
      active: true
    })
    win.once('closed', () => instances.delete(key))
    return { ...registration, runtime_id: runtimeId }
  } catch (error) {
    instances.delete(key)
    if (!win.isDestroyed()) win.destroy()
    return { success: false, error: error.message || String(error) }
  }
}

function unregisterBrowserSession(sessionId = '') {
  for (const [key, instance] of instances) {
    if (instance.sessionId !== sessionId) continue
    runtimeTargets.unregisterRuntimeTarget(instance.runtimeId)
    if (!instance.window.isDestroyed()) instance.window.destroy()
    instances.delete(key)
  }
}

function resetForTests() {
  for (const instance of instances.values()) {
    if (!instance.window.isDestroyed()) instance.window.destroy()
  }
  instances.clear()
}

module.exports = {
  isLocalDevelopmentUrl,
  registerBrowserDevelopmentTarget,
  resetForTests,
  unregisterBrowserSession
}
