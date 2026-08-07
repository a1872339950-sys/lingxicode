const crypto = require('crypto')
const fs = require('fs')
const http = require('http')
const os = require('os')
const path = require('path')
const { EventEmitter } = require('events')

const BRIDGE_DIR = path.join(os.tmpdir(), 'lingxi-development-runtimes')
const MAX_BODY_BYTES = 2 * 1024 * 1024
let bridgeServer = null
let bridgeFile = ''
let heartbeatTimer = null

function ensureBridgeDir() {
  fs.mkdirSync(BRIDGE_DIR, { recursive: true })
  return BRIDGE_DIR
}

function processAlive(pid) {
  try {
    process.kill(Number(pid), 0)
    return true
  } catch {
    return false
  }
}

function writeJsonAtomic(filePath, value) {
  const tempPath = `${filePath}.${process.pid}.tmp`
  fs.writeFileSync(tempPath, JSON.stringify(value), 'utf8')
  fs.renameSync(tempPath, filePath)
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', chunk => {
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        reject(new Error('runtime bridge request is too large'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}) } catch (error) { reject(error) }
    })
    req.on('error', reject)
  })
}

function sendJson(res, statusCode, value) {
  const body = Buffer.from(JSON.stringify(value))
  res.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': body.length,
    'cache-control': 'no-store'
  })
  res.end(body)
}

function targetFromRegistry(runtimeTargets, runtimeId) {
  const resolution = runtimeTargets.resolveRuntimeTarget({ runtime_id: runtimeId }, '')
  if (!resolution.success || !resolution.webContents) throw new Error(resolution.error || 'development runtime target not found')
  return resolution.webContents
}

async function startDevelopmentRuntimeBridge(options = {}) {
  if (bridgeServer) return bridgeServer.address()
  const runtimeTargets = options.runtimeTargets
  if (!runtimeTargets) throw new Error('runtimeTargets is required')
  const runtimeDiagnostics = options.runtimeDiagnostics
  const token = crypto.randomBytes(32).toString('hex')
  const bridgeId = `dev-${process.pid}-${crypto.randomBytes(4).toString('hex')}`
  const workspacePath = path.resolve(options.workspacePath || process.cwd())
  const startedAt = new Date().toISOString()

  bridgeServer = http.createServer(async (req, res) => {
    if (req.headers.authorization !== `Bearer ${token}`) {
      sendJson(res, 401, { success: false, error: 'unauthorized' })
      return
    }
    try {
      if (req.method === 'GET' && req.url === '/health') {
        sendJson(res, 200, { success: true, bridge_id: bridgeId, process_id: process.pid, workspace_path: workspacePath })
        return
      }
      if (req.method === 'GET' && req.url === '/targets') {
        sendJson(res, 200, { success: true, targets: runtimeTargets.listRuntimeTargets({ includeUnscoped: true }) })
        return
      }
      const body = await readBody(req)
      const webContents = targetFromRegistry(runtimeTargets, body.runtime_id)
      if (req.method === 'POST' && req.url === '/execute') {
        const value = await webContents.executeJavaScript(String(body.code || ''), body.user_gesture === true)
        sendJson(res, 200, { success: true, value })
        return
      }
      if (req.method === 'POST' && req.url === '/capture') {
        const rect = body.rect && Number(body.rect.width) > 0 && Number(body.rect.height) > 0 ? body.rect : undefined
        const image = rect ? await webContents.capturePage(rect) : await webContents.capturePage()
        sendJson(res, 200, { success: true, png: image.toPNG().toString('base64'), size: image.getSize() })
        return
      }
      if (req.method === 'POST' && req.url === '/diagnostics') {
        const summary = runtimeDiagnostics?.summarize?.({
          webContentsId: webContents.id,
          projectId: body.project_id || '',
          since_ms: body.since_ms,
          limit: body.limit,
          include_info: false
        }) || { error_count: 0, events: [] }
        sendJson(res, 200, { success: true, value: summary })
        return
      }
      sendJson(res, 404, { success: false, error: 'not found' })
    } catch (error) {
      sendJson(res, 500, { success: false, error: error.message || String(error) })
    }
  })

  await new Promise((resolve, reject) => {
    bridgeServer.once('error', reject)
    bridgeServer.listen(0, '127.0.0.1', resolve)
  })
  bridgeServer.unref()
  const port = bridgeServer.address().port
  ensureBridgeDir()
  bridgeFile = path.join(BRIDGE_DIR, `${bridgeId}.json`)
  const writeRegistration = () => writeJsonAtomic(bridgeFile, {
    protocol: 2,
    runtime_protocol: 'lingxi-runtime-target/v1',
    bridge_id: bridgeId,
    build_type: 'development',
    workspace_path: workspacePath,
    executable_path: process.execPath,
    process_id: process.pid,
    port,
    token,
    targets: runtimeTargets.listRuntimeTargets({ includeUnscoped: true }),
    started_at: startedAt,
    heartbeat_at: new Date().toISOString()
  })
  writeRegistration()
  heartbeatTimer = setInterval(() => {
    try { writeRegistration() } catch (error) { console.warn('[RuntimeBridge] heartbeat failed:', error.message) }
  }, 3000)
  heartbeatTimer.unref?.()
  console.log('[RuntimeBridge] development runtime registered:', { bridgeId, workspacePath, processId: process.pid, port })
  return { bridgeId, workspacePath, processId: process.pid, port }
}

function stopDevelopmentRuntimeBridge() {
  if (heartbeatTimer) clearInterval(heartbeatTimer)
  heartbeatTimer = null
  if (bridgeServer) bridgeServer.close()
  bridgeServer = null
  if (bridgeFile) {
    try { fs.unlinkSync(bridgeFile) } catch { /* stale registrations are pruned by clients */ }
  }
  bridgeFile = ''
}

function discoverDevelopmentBridges() {
  ensureBridgeDir()
  const now = Date.now()
  const bridges = []
  for (const name of fs.readdirSync(BRIDGE_DIR)) {
    if (!name.endsWith('.json')) continue
    const filePath = path.join(BRIDGE_DIR, name)
    try {
      const item = JSON.parse(fs.readFileSync(filePath, 'utf8'))
      const heartbeat = Date.parse(item.heartbeat_at || '')
      if (item.build_type !== 'development' || !item.port || !item.token || !processAlive(item.process_id) || !heartbeat || now - heartbeat > 12000) {
        fs.unlinkSync(filePath)
        continue
      }
      bridges.push(item)
    } catch {
      try { fs.unlinkSync(filePath) } catch { /* ignore */ }
    }
  }
  return bridges
}

function requestJson(bridge, method, route, body) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? null : Buffer.from(JSON.stringify(body))
    const req = http.request({
      host: '127.0.0.1',
      port: bridge.port,
      path: route,
      method,
      headers: {
        authorization: `Bearer ${bridge.token}`,
        ...(payload ? { 'content-type': 'application/json', 'content-length': payload.length } : {})
      },
      timeout: 15000
    }, res => {
      const chunks = []
      res.on('data', chunk => chunks.push(chunk))
      res.on('end', () => {
        try {
          const value = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
          if (res.statusCode >= 400 || value.success === false) reject(new Error(value.error || `runtime bridge HTTP ${res.statusCode}`))
          else resolve(value)
        } catch (error) { reject(error) }
      })
    })
    req.on('timeout', () => req.destroy(new Error('development runtime bridge timeout')))
    req.on('error', reject)
    if (payload) req.write(payload)
    req.end()
  })
}

class RemoteWebContents extends EventEmitter {
  constructor(bridge, target, id) {
    super()
    this.bridge = bridge
    this.target = target
    this.id = id
    this.isRemoteDevelopmentTarget = true
  }

  isDestroyed() { return false }
  isLoading() { return false }
  getType() { return 'remote-development-webcontents' }
  getURL() { return this.target.url || '' }
  getTitle() { return this.target.title || '' }
  async executeJavaScript(code, userGesture = false) {
    const result = await requestJson(this.bridge, 'POST', '/execute', { runtime_id: this.target.runtime_id, code, user_gesture: userGesture })
    return result.value
  }
  async capturePage(rect) {
    const result = await requestJson(this.bridge, 'POST', '/capture', { runtime_id: this.target.runtime_id, rect })
    const png = Buffer.from(result.png, 'base64')
    return { toPNG: () => png, getSize: () => result.size || { width: 0, height: 0 } }
  }
  async getRuntimeDiagnostics(args = {}) {
    const result = await requestJson(this.bridge, 'POST', '/diagnostics', {
      runtime_id: this.target.runtime_id,
      project_id: args.projectId || args.project_id || '',
      since_ms: args.runtime_since_ms || args.runtimeSinceMs || 10 * 60 * 1000,
      limit: args.runtime_limit || args.runtimeLimit || 80
    })
    return result.value
  }
}

async function fetchBridgeTargets(bridge) {
  const result = await requestJson(bridge, 'GET', '/targets')
  return Array.isArray(result.targets) ? result.targets : []
}

module.exports = {
  BRIDGE_DIR,
  RemoteWebContents,
  discoverDevelopmentBridges,
  fetchBridgeTargets,
  startDevelopmentRuntimeBridge,
  stopDevelopmentRuntimeBridge
}
