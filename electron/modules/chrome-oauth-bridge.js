/**
 * 用本机真实 Chrome 完成 Google OAuth，再把回调 URL 交回 Electron
 *
 * 原因：
 * - stock Electron 即使剥掉 UA，Google OAuth（GeneralOAuthFlow）仍常直接「无法登录」
 * - Codex 靠 Owl 壳默认无 Electron 身份；我们没有定制壳
 * - 标准桌面做法：系统/真浏览器跑 OAuth，应用只收 redirect
 *
 * 流程：
 * 1. 启动本机 chrome.exe（独立 user-data-dir + remote debugging）
 * 2. 打开 Google OAuth URL，用户在真 Chrome 里登录
 * 3. CDP 监视导航；一旦到达 accounts.x.ai（或 redirect_uri 主机）立即把完整 URL 交回
 * 4. 关掉临时 Chrome，在 Electron 同 partition 打开回调 URL（完成 xAI exchange）
 */

const { spawn } = require('child_process')
const http = require('http')
const path = require('path')
const fs = require('fs')
const os = require('os')
const { shell } = require('electron')

let activeBridge = null

function findChromeExecutable() {
  const candidates = [
    process.env.CHROME_PATH,
    path.join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'Bin', 'chrome.exe'),
    path.join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(process.env.PROGRAMFILES || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(process.env['PROGRAMFILES(X86)'] || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    path.join(process.env.PROGRAMFILES || '', 'Microsoft', 'Edge', 'Application', 'msedge.exe')
  ].filter(Boolean)
  for (const c of candidates) {
    try { if (c && fs.existsSync(c)) return c } catch (_) { /* ignore */ }
  }
  return null
}

function httpGetJson(url, timeoutMs = 3000) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, (res) => {
      let raw = ''
      res.setEncoding('utf8')
      res.on('data', (c) => { raw += c })
      res.on('end', () => {
        try { resolve(JSON.parse(raw)) } catch (e) { reject(e) }
      })
    })
    req.on('error', reject)
    req.setTimeout(timeoutMs, () => req.destroy(new Error('timeout')))
  })
}

async function waitForDevtools(port, timeoutMs = 25000) {
  const start = Date.now()
  let lastErr = null
  while (Date.now() - start < timeoutMs) {
    try {
      const version = await httpGetJson(`http://127.0.0.1:${port}/json/version`)
      if (version?.webSocketDebuggerUrl) return version
      const list = await httpGetJson(`http://127.0.0.1:${port}/json/list`)
      if (Array.isArray(list) && list[0]?.webSocketDebuggerUrl) {
        return { webSocketDebuggerUrl: list[0].webSocketDebuggerUrl, list }
      }
    } catch (e) {
      lastErr = e
    }
    await new Promise((r) => setTimeout(r, 250))
  }
  throw new Error(`Chrome DevTools 未就绪: ${lastErr?.message || 'timeout'}`)
}

function createCdpClient(wsUrl) {
  const WebSocket = require('ws')
  let nextId = 1
  const pending = new Map()
  const eventHandlers = new Map()
  const socket = new WebSocket(wsUrl)

  const ready = new Promise((resolve, reject) => {
    socket.on('open', resolve)
    socket.on('error', reject)
  })

  socket.on('message', (data) => {
    let msg
    try { msg = JSON.parse(String(data)) } catch { return }
    if (msg.id != null && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id)
      pending.delete(msg.id)
      if (msg.error) reject(new Error(msg.error.message || JSON.stringify(msg.error)))
      else resolve(msg.result)
      return
    }
    if (msg.method) {
      const list = eventHandlers.get(msg.method) || []
      for (const fn of list) {
        try { fn(msg.params || {}) } catch (_) { /* ignore */ }
      }
    }
  })

  function send(method, params = {}, timeoutMs = 20000) {
    const id = nextId++
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id)
        reject(new Error(`CDP timeout ${method}`))
      }, timeoutMs)
      pending.set(id, {
        resolve: (v) => { clearTimeout(timer); resolve(v) },
        reject: (e) => { clearTimeout(timer); reject(e) }
      })
      socket.send(JSON.stringify({ id, method, params }))
    })
  }

  function on(method, fn) {
    if (!eventHandlers.has(method)) eventHandlers.set(method, [])
    eventHandlers.get(method).push(fn)
  }

  function close() {
    try { socket.close() } catch (_) { /* ignore */ }
  }

  return { ready, send, on, close }
}

function extractRedirectHosts(oauthUrl) {
  const hosts = new Set(['accounts.x.ai'])
  try {
    const u = new URL(oauthUrl)
    const redirect = u.searchParams.get('redirect_uri')
    if (redirect) {
      try {
        const r = new URL(redirect)
        hosts.add(r.hostname.toLowerCase())
      } catch (_) { /* ignore */ }
    }
  } catch (_) { /* ignore */ }
  return hosts
}

function isReturnNavigation(url, redirectHosts) {
  try {
    const u = new URL(url)
    const host = u.hostname.toLowerCase()
    if (host.includes('google.') || host.includes('gstatic.') || host.includes('youtube.')) return false
    if (redirectHosts.has(host)) return true
    if (host.endsWith('.x.ai')) return true
    if (/\/exchange-token|\/oauth\/callback|\/auth\/callback/i.test(u.pathname)) return true
    if (u.searchParams.has('code') || u.searchParams.has('id_token')) return true
    return false
  } catch {
    return false
  }
}

/**
 * @param {string} oauthUrl
 * @param {{ onReturnUrl: (url: string) => void, onError?: (err: Error) => void }} handlers
 */
async function startChromeOAuthBridge(oauthUrl, handlers = {}) {
  if (activeBridge) {
    try { activeBridge.dispose() } catch (_) { /* ignore */ }
    activeBridge = null
  }

  const chromeExe = findChromeExecutable()
  if (!chromeExe) {
    // 没有 Chrome：退回系统默认浏览器（用户可完成登录，但 cookie 不共享；回调 URL 无法自动收回）
    console.warn('[ChromeOAuthBridge] chrome not found, shell.openExternal fallback')
    await shell.openExternal(oauthUrl)
    return {
      success: true,
      mode: 'system-default',
      message: '已用系统浏览器打开 Google 登录（未检测到 Chrome 可执行文件）'
    }
  }

  const port = 9333 + Math.floor(Math.random() * 400)
  const userDataDir = path.join(os.tmpdir(), `lingxi-oauth-chrome-${Date.now()}`)
  fs.mkdirSync(userDataDir, { recursive: true })

  const args = [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userDataDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-features=Translate,MediaRouter',
    `--app=${oauthUrl}` // 应用模式窗口，更像登录弹窗
  ]

  console.log('[ChromeOAuthBridge] launching', chromeExe, 'port', port)
  const child = spawn(chromeExe, args, {
    stdio: 'ignore',
    windowsHide: false
  })

  let disposed = false
  let cdp = null
  const redirectHosts = extractRedirectHosts(oauthUrl)

  const dispose = () => {
    if (disposed) return
    disposed = true
    try { cdp?.close() } catch (_) { /* ignore */ }
    try {
      if (child && !child.killed) {
        child.kill()
        try {
          spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
            stdio: 'ignore',
            windowsHide: true
          })
        } catch (_) { /* ignore */ }
      }
    } catch (_) { /* ignore */ }
    setTimeout(() => {
      try { fs.rmSync(userDataDir, { recursive: true, force: true }) } catch (_) { /* ignore */ }
    }, 2000)
    if (activeBridge?.dispose === dispose) activeBridge = null
  }

  activeBridge = { dispose, child, port }

  try {
    const version = await waitForDevtools(port)
    // 优先用 page target
    let wsUrl = version.webSocketDebuggerUrl
    try {
      const list = await httpGetJson(`http://127.0.0.1:${port}/json/list`)
      const page = (list || []).find((t) => t.type === 'page' && t.webSocketDebuggerUrl)
      if (page?.webSocketDebuggerUrl) wsUrl = page.webSocketDebuggerUrl
    } catch (_) { /* ignore */ }

    cdp = createCdpClient(wsUrl)
    await cdp.ready
    await cdp.send('Page.enable')
    await cdp.send('Network.enable').catch(() => ({}))

    let returned = false
    const handleUrl = (url) => {
      if (returned || disposed) return
      if (!url || !isReturnNavigation(url, redirectHosts)) return
      returned = true
      console.log('[ChromeOAuthBridge] return url captured:', url.slice(0, 220))
      try { handlers.onReturnUrl?.(url) } catch (e) {
        console.warn('[ChromeOAuthBridge] onReturnUrl failed:', e.message)
      }
      // 稍等再关，避免截断
      setTimeout(dispose, 400)
    }

    cdp.on('Page.frameNavigated', (params) => {
      const url = params?.frame?.url
      if (params?.frame?.parentId) return // 只要主 frame
      handleUrl(url)
    })
    cdp.on('Page.navigatedWithinDocument', (params) => {
      handleUrl(params?.url)
    })
    cdp.on('Network.requestWillBeSent', (params) => {
      if (params?.type === 'Document') handleUrl(params?.request?.url)
    })

    // 确保打开 OAuth（app 模式有时已打开）
    try {
      await cdp.send('Page.navigate', { url: oauthUrl })
    } catch (_) { /* ignore */ }

    // 超时清理（10 分钟）
    setTimeout(() => {
      if (!disposed) {
        console.warn('[ChromeOAuthBridge] timeout, disposing')
        dispose()
        handlers.onError?.(new Error('Google 登录超时'))
      }
    }, 10 * 60 * 1000)

    child.on('exit', () => {
      if (!disposed && !returned) {
        console.log('[ChromeOAuthBridge] chrome exited without return url')
        dispose()
      }
    })

    return {
      success: true,
      mode: 'chrome-app',
      port,
      message: '已用本机 Chrome 打开 Google 登录，请在 Chrome 窗口完成授权'
    }
  } catch (error) {
    console.error('[ChromeOAuthBridge] failed:', error)
    dispose()
    // 最后手段：系统浏览器
    try {
      await shell.openExternal(oauthUrl)
      return {
        success: true,
        mode: 'system-default-fallback',
        message: 'Chrome 调试启动失败，已改用系统浏览器打开'
      }
    } catch (e2) {
      handlers.onError?.(error)
      return { success: false, error: error.message }
    }
  }
}

function stopChromeOAuthBridge() {
  try { activeBridge?.dispose?.() } catch (_) { /* ignore */ }
  activeBridge = null
}

module.exports = {
  findChromeExecutable,
  startChromeOAuthBridge,
  stopChromeOAuthBridge,
  isReturnNavigation,
  extractRedirectHosts
}
