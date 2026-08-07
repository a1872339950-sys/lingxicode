/**
 * Google / xAI OAuth 登录
 *
 * 对 GeneralOAuthFlow（如 accounts.x.ai 的 Google 登录）：
 * 使用本机真实 Chrome 完成授权（Google 不拦真 Chrome），
 * CDP 捕获跳回 accounts.x.ai 的 URL，再在 Electron 同 partition 打开以完成 exchange。
 *
 * 这不是「伪装 Electron」，而是标准桌面 OAuth：真浏览器登录 + 应用收回调。
 */

const { BrowserWindow } = require('electron')
const config = require('./config')
const externalWebviewSession = require('./external-webview-session')
const chromeOAuthBridge = require('./chrome-oauth-bridge')

const PARTITION = externalWebviewSession.EXTERNAL_WEBVIEW_PARTITION
let activeLoginWindow = null
/** @type {Electron.WebContents | null} */
let sourceWebviewContents = null
let lastTakeOverUrl = ''
let lastTakeOverAt = 0
let handoffDone = false

function isGoogleAccountsUrl(url) {
  try {
    const u = new URL(String(url || ''))
    const host = u.hostname.toLowerCase()
    const path = `${u.pathname}${u.search}`
    if (host === 'accounts.google.com' || host.endsWith('.accounts.google.com')) return true
    if (host.includes('google.') && /\/(?:signin|o\/oauth2|AccountChooser|ServiceLogin|AddSession|Lifecycle)/i.test(path)) {
      return true
    }
    if (/accounts\.youtube\.com/i.test(host)) return true
    return false
  } catch {
    return false
  }
}

function isGoogleOAuthUrl(url) {
  try {
    const u = new URL(String(url || ''))
    if (!isGoogleAccountsUrl(url)) return false
    return /\/o\/oauth2|\/oauth|flowName=GeneralOAuthFlow|redirect_uri=/i.test(u.pathname + u.search)
  } catch {
    return false
  }
}

/** 仅当前页面主机为业务回调站时才算完成（不扫 query 防误伤） */
function isOAuthReturnUrl(url) {
  try {
    const u = new URL(String(url || ''))
    const host = u.hostname.toLowerCase()
    const path = u.pathname || ''
    if (
      host === 'accounts.google.com' ||
      host.endsWith('.accounts.google.com') ||
      host.includes('google.') ||
      host.includes('gstatic.com') ||
      host.includes('youtube.com')
    ) {
      return false
    }
    if (host === 'accounts.x.ai' || host.endsWith('.x.ai')) return true
    if (/\/exchange-token|\/oauth\/callback|\/auth\/callback/i.test(path)) return true
    if (u.searchParams.has('code') || u.searchParams.has('id_token')) return true
    return false
  } catch {
    return false
  }
}

function safeLater(fn, delayMs = 0) {
  const run = () => {
    try { fn() } catch (error) {
      console.warn('[GoogleLoginWindow] deferred task failed:', error?.message || error)
    }
  }
  if (delayMs > 0) setTimeout(run, delayMs)
  else setImmediate(run)
}

function prepareAuthSession() {
  try {
    const { session } = require('electron')
    const ses = session.fromPartition(PARTITION)
    externalWebviewSession.configureSession?.(ses)
    return ses
  } catch (_) {
    return null
  }
}

function stopWebviewLater(contents) {
  safeLater(() => {
    if (!contents || contents.isDestroyed()) return
    try { contents.stop?.() } catch (_) { /* ignore */ }
    safeLater(() => {
      if (!contents || contents.isDestroyed()) return
      try {
        const current = String(contents.getURL?.() || '')
        if (isGoogleAccountsUrl(current) || /accounts\.google\./i.test(current)) {
          contents.loadURL('about:blank').catch(() => {})
        }
      } catch (_) { /* ignore */ }
    }, 80)
  }, 0)
}

function notifyAuthCompleted(detail = {}) {
  try {
    const main = config.getMainWindow?.()
    if (main && !main.isDestroyed()) {
      main.webContents.send('external-webview-auth-completed', {
        provider: 'google',
        ...detail
      })
    }
  } catch (_) { /* ignore */ }
}

function showToastInMain(message) {
  try {
    const main = config.getMainWindow?.()
    if (main && !main.isDestroyed()) {
      main.webContents.send('app-toast', { message, type: 'info' })
    }
  } catch (_) { /* ignore */ }
  console.log('[GoogleLoginWindow]', message)
}

function handoffReturnUrlToWebview(returnUrl) {
  if (handoffDone) return
  if (!returnUrl || !isOAuthReturnUrl(returnUrl)) {
    console.warn('[GoogleLoginWindow] refuse handoff non-return url:', String(returnUrl || '').slice(0, 120))
    return
  }
  handoffDone = true
  console.log('[GoogleLoginWindow] handoff return URL:', returnUrl.slice(0, 220))

  prepareAuthSession()

  // 优先：来源 webview 打开回调（xAI exchange 需要在这个 browsing context 完成）
  if (sourceWebviewContents && !sourceWebviewContents.isDestroyed()) {
    try {
      sourceWebviewContents.loadURL(returnUrl).catch((error) => {
        console.warn('[GoogleLoginWindow] webview load return failed:', error.message)
        openReturnInElectronWindow(returnUrl)
      })
    } catch (error) {
      console.warn('[GoogleLoginWindow] handoff failed:', error.message)
      openReturnInElectronWindow(returnUrl)
    }
  } else {
    openReturnInElectronWindow(returnUrl)
  }

  notifyAuthCompleted({ returnUrl, via: 'chrome-oauth-bridge' })
  showToastInMain('Google 授权完成，正在回到应用…')
}

function openReturnInElectronWindow(returnUrl) {
  try {
    const ua = externalWebviewSession.getChromeLikeUserAgent()
    prepareAuthSession()
    const win = new BrowserWindow({
      width: 520,
      height: 800,
      show: true,
      autoHideMenuBar: true,
      title: '登录完成',
      backgroundColor: '#ffffff',
      webPreferences: {
        partition: PARTITION,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webviewTag: false
      }
    })
    try { win.webContents.setUserAgent(ua) } catch (_) { /* ignore */ }
    win.loadURL(returnUrl, { userAgent: ua }).catch(() => {})
    // exchange 完成后用户可关；30s 后尝试自动关
    setTimeout(() => {
      try { if (!win.isDestroyed()) win.close() } catch (_) { /* ignore */ }
    }, 30000)
  } catch (error) {
    console.warn('[GoogleLoginWindow] openReturnInElectronWindow failed:', error.message)
  }
}

/**
 * Google OAuth → 真 Chrome；完成后回调进 Electron
 */
async function openGoogleLoginViaChrome(oauthUrl, options = {}) {
  if (options.sourceWebContents) {
    sourceWebviewContents = options.sourceWebContents
  }
  handoffDone = false
  prepareAuthSession()

  showToastInMain('正在用本机 Chrome 打开 Google 登录…')

  const result = await chromeOAuthBridge.startChromeOAuthBridge(oauthUrl, {
    onReturnUrl: (url) => {
      handoffReturnUrlToWebview(url)
    },
    onError: (err) => {
      console.warn('[GoogleLoginWindow] chrome bridge error:', err?.message || err)
      showToastInMain('Chrome 登录失败：' + (err?.message || String(err)))
    }
  })

  console.log('[GoogleLoginWindow] chrome bridge result:', result)
  return result
}

/** 非 OAuth 的 accounts.google 普通页：仍可用 Electron 窗（探针可用） */
function openGoogleLoginWindow(targetUrl, options = {}) {
  if (!targetUrl || !/^https?:\/\//i.test(targetUrl)) {
    return { success: false, error: 'invalid url' }
  }

  // OAuth 一律走真 Chrome
  if (isGoogleOAuthUrl(targetUrl)) {
    openGoogleLoginViaChrome(targetUrl, options).catch((e) => {
      console.error('[GoogleLoginWindow] chrome oauth failed:', e)
    })
    return { success: true, mode: 'chrome-oauth-bridge' }
  }

  if (options.sourceWebContents) {
    sourceWebviewContents = options.sourceWebContents
  }

  prepareAuthSession()
  const ua = externalWebviewSession.getChromeLikeUserAgent()

  if (activeLoginWindow && !activeLoginWindow.isDestroyed()) {
    try {
      activeLoginWindow.show()
      activeLoginWindow.focus()
    } catch (_) { /* ignore */ }
    return { success: true, reused: true }
  }

  handoffDone = false
  let win
  try {
    win = new BrowserWindow({
      width: 520,
      height: 800,
      show: false,
      autoHideMenuBar: true,
      title: 'Google 登录',
      backgroundColor: '#ffffff',
      webPreferences: {
        partition: PARTITION,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webviewTag: false
      }
    })
  } catch (error) {
    // BrowserWindow 失败则也走 Chrome
    openGoogleLoginViaChrome(targetUrl, options).catch(() => {})
    return { success: true, mode: 'chrome-fallback' }
  }

  activeLoginWindow = win
  try {
    externalWebviewSession.configureSession?.(win.webContents.session)
    win.webContents.setUserAgent(ua)
  } catch (_) { /* ignore */ }

  win.once('ready-to-show', () => {
    try {
      if (!win.isDestroyed()) {
        win.show()
        win.focus()
      }
    } catch (_) { /* ignore */ }
  })

  win.on('closed', () => {
    if (activeLoginWindow === win) activeLoginWindow = null
    notifyAuthCompleted({ closed: true })
  })

  // 若 Electron 窗里仍出现拦截页 → 立刻升级到真 Chrome
  win.webContents.on('did-finish-load', async () => {
    try {
      const blocked = await win.webContents.executeJavaScript(
        `/不安全|无法登录|may not be secure/i.test(document.body && document.body.innerText || '')`,
        true
      )
      const url = win.webContents.getURL?.() || targetUrl
      console.log('[GoogleLoginWindow][Diag]', { blocked, url: String(url).slice(0, 120) })
      if (blocked) {
        console.warn('[GoogleLoginWindow] Electron window blocked by Google → escalate to real Chrome')
        try { if (!win.isDestroyed()) win.close() } catch (_) { /* ignore */ }
        openGoogleLoginViaChrome(url, options).catch(() => {})
      }
    } catch (_) { /* ignore */ }
  })

  win.loadURL(targetUrl, { userAgent: ua }).catch((e) => {
    console.warn('[GoogleLoginWindow] loadURL failed:', e.message)
    openGoogleLoginViaChrome(targetUrl, options).catch(() => {})
  })

  return { success: true, mode: 'electron-window' }
}

function attachGoogleLoginFallback(contents) {
  if (!contents || contents.isDestroyed?.() || contents.__lingxiGoogleLoginFallback) return
  contents.__lingxiGoogleLoginFallback = true

  const takeOver = (url, reason) => {
    if (!url || !isGoogleAccountsUrl(url)) return false
    const now = Date.now()
    if (url === lastTakeOverUrl && now - lastTakeOverAt < 2500) return true
    lastTakeOverUrl = url
    lastTakeOverAt = now

    console.log('[GoogleLoginWindow] schedule take over:', reason, url.slice(0, 140))

    safeLater(() => {
      stopWebviewLater(contents)
      // OAuth → Chrome；普通 Google 页 → Electron 窗（被拦再升 Chrome）
      openGoogleLoginWindow(url, { sourceWebContents: contents })
    }, 0)

    return true
  }

  contents.on('will-navigate', (event, url) => {
    if (!isGoogleAccountsUrl(url)) return
    try { event.preventDefault() } catch (_) { /* ignore */ }
    takeOver(url, 'will-navigate')
  })

  contents.on('will-redirect', (event, url) => {
    if (!isGoogleAccountsUrl(url)) return
    try { event.preventDefault() } catch (_) { /* ignore */ }
    takeOver(url, 'will-redirect')
  })

  contents.on('did-start-navigation', (_event, url, isInPlace, isMainFrame) => {
    if (!isMainFrame || isInPlace) return
    if (!isGoogleAccountsUrl(url)) return
    takeOver(url, 'did-start-navigation')
  })

  contents.on('did-finish-load', () => {
    safeLater(async () => {
      try {
        if (contents.isDestroyed()) return
        const url = contents.getURL?.() || ''
        if (!isGoogleAccountsUrl(url)) return
        const blocked = await pageLooksLikeGoogleBrowserBlocked(contents)
        if (blocked) takeOver(url, 'blocked-page')
      } catch (_) { /* ignore */ }
    }, 300)
  })
}

async function pageLooksLikeGoogleBrowserBlocked(contents) {
  if (!contents || contents.isDestroyed()) return false
  try {
    return await contents.executeJavaScript(`(() => {
      try {
        const t = ((document.body && document.body.innerText) || '') + ' ' + (document.title || '');
        return /此浏览器或应用可能不安全|may not be secure|无法登录|Couldn't sign you in|disallowed_useragent/i.test(t);
      } catch (e) { return false; }
    })()`, true)
  } catch {
    return false
  }
}

function safeLater(fn, delayMs = 0) {
  const run = () => {
    try { fn() } catch (error) {
      console.warn('[GoogleLoginWindow] deferred task failed:', error?.message || error)
    }
  }
  if (delayMs > 0) setTimeout(run, delayMs)
  else setImmediate(run)
}

function registerGoogleLoginIPC(ipcMain) {
  ipcMain.handle('google-login:open-window', (_event, url) =>
    openGoogleLoginWindow(url || 'https://accounts.google.com/', {})
  )
}

module.exports = {
  isGoogleAccountsUrl,
  isGoogleOAuthUrl,
  isOAuthReturnUrl,
  openGoogleLoginWindow,
  openGoogleLoginViaChrome: openGoogleLoginViaChrome,
  attachGoogleLoginFallback,
  registerGoogleLoginIPC,
  pageLooksLikeGoogleBrowserBlocked
}
