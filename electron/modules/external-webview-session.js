/**
 * 右侧外部网页 webview 会话
 *
 * 2026-07 对照本机 Codex + 实测探针结论：
 *
 * 1) Codex Owl 的 chrome.dll UA 模板是纯 Chromium 格式：
 *    Mozilla/5.0 (%s) AppleWebKit/537.36 (KHTML, like Gecko) %s Safari/537.36
 *    stock Electron 模板硬编码 `Chrome/%s Electron/%s` —— 必须剥掉 Electron 产品段
 *
 * 2) 实测（_probe_webview_vs_window / _probe_ua_simple）：
 *    仅用 setUserAgent(去Electron) + sec-ch-ua 请求头 + Codex 权限策略，
 *    BrowserWindow 与 <webview> 均可打开 accounts.google.com 登录页（blocked=false）
 *    不要 attach CDP debugger —— 复杂注入反而引入变量
 *
 * 3) Codex BrowserSession 权限：只放行 clipboard-sanitized-write（拒绝 passkey/WebAuthn）
 */

const { session, app } = require('electron')

const EXTERNAL_WEBVIEW_PARTITION = 'persist:lingxi-external-webview'
const MUSIC_STUDIO_PARTITION = 'persist:lingxi-music-studio'

let configured = false
let earlyFallbackApplied = false

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function getChromeVersion() {
  return String(process.versions.chrome || '0.0.0.0').trim() || '0.0.0.0'
}

function getChromeMajor(version = getChromeVersion()) {
  const major = String(version).split('.')[0]
  return /^\d+$/.test(major) ? major : '150'
}

function getExcludedProducts() {
  const list = ['Electron']
  try {
    const name = app.getName?.()
    if (name) list.push(name)
  } catch (_) { /* ignore */ }
  list.push('灵犀 LingXiCode', 'lingxi-lingxicode', 'LingXiCode', '灵犀')
  return list
}

/** Codex D6：剥除 Product/version 段 */
function stripUserAgentProducts(userAgent, products = getExcludedProducts()) {
  return products
    .filter(Boolean)
    .reduce(
      (ua, product) => ua.replace(new RegExp(`\\s${escapeRegExp(product)}/[^\\s]+`, 'gi'), ''),
      String(userAgent || '')
    )
    .replace(/\s{2,}/g, ' ')
    .trim()
}

function getChromeLikeUserAgent(ses = null) {
  let base = ''
  try {
    if (ses?.getUserAgent) base = ses.getUserAgent()
  } catch (_) { /* ignore */ }
  if (!base) {
    try { base = String(app.userAgentFallback || '') } catch (_) { base = '' }
  }
  if (!base) {
    try { base = session.defaultSession?.getUserAgent?.() || '' } catch (_) { base = '' }
  }
  if (!base) {
    const chrome = getChromeVersion()
    base = `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chrome} Safari/537.36`
  }
  return stripUserAgentProducts(base)
}

function buildSecChUa(userAgent = getChromeLikeUserAgent()) {
  const major = /\b(?:Chrome|Chromium)\/(\d+)/.exec(userAgent)?.[1] || getChromeMajor()
  // 与探针成功配置一致
  return `"Not;A=Brand";v="8", "Google Chrome";v="${major}", "Chromium";v="${major}"`
}

function buildAcceptLanguage() {
  try {
    const langs = typeof app.getPreferredSystemLanguages === 'function'
      ? app.getPreferredSystemLanguages()
      : []
    const list = langs.length > 0 ? langs : [app.getLocale?.() || 'zh-CN']
    return list
      .map((lang, i) => (i === 0 ? lang : `${lang};q=${Math.max(1 - i * 0.1, 0.1).toFixed(1)}`))
      .join(',')
  } catch (_) {
    return 'zh-CN,zh;q=0.9,en;q=0.8'
  }
}

function setHeader(headers, name, value) {
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === name.toLowerCase()) delete headers[key]
  }
  headers[name] = value
}

function applyRequestHeaders(requestHeaders, ua) {
  const headers = { ...requestHeaders }
  const cleaned = stripUserAgentProducts(ua || getChromeLikeUserAgent())
  setHeader(headers, 'User-Agent', cleaned)
  setHeader(headers, 'Accept-Language', buildAcceptLanguage())
  setHeader(headers, 'sec-ch-ua', buildSecChUa(cleaned))
  setHeader(headers, 'sec-ch-ua-mobile', '?0')
  setHeader(headers, 'sec-ch-ua-platform', process.platform === 'darwin' ? '"macOS"' : process.platform === 'linux' ? '"Linux"' : '"Windows"')
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === 'x-requested-with' && /webview|electron|lingxi/i.test(String(headers[key] || ''))) {
      delete headers[key]
    }
  }
  return headers
}

function applyEarlyUserAgentFallback() {
  if (earlyFallbackApplied) return getChromeLikeUserAgent()
  earlyFallbackApplied = true
  try {
    const cleaned = stripUserAgentProducts(String(app.userAgentFallback || ''))
    if (cleaned) app.userAgentFallback = cleaned
  } catch (error) {
    console.warn('[ExternalWebview] early UA fallback failed:', error.message)
  }
  return getChromeLikeUserAgent()
}

/**
 * Codex 权限策略：只允许 clipboard-sanitized-write
 * → Google 无法申请 publickey-credentials，不会弹 USB 安全密钥
 */
function applyCodexPermissionPolicy(ses) {
  if (!ses || ses.__lingxiPermPolicy) return
  ses.__lingxiPermPolicy = true
  try {
    ses.setPermissionRequestHandler((_wc, permission, callback) => {
      callback(permission === 'clipboard-sanitized-write')
    })
  } catch (_) { /* ignore */ }
  try {
    ses.setPermissionCheckHandler((_wc, permission) => permission === 'clipboard-sanitized-write')
  } catch (_) { /* ignore */ }
  try { ses.setDevicePermissionHandler?.(() => false) } catch (_) { /* ignore */ }
}

function configureSession(ses) {
  if (!ses || ses.__lingxiBrowserSessionConfigured) return ses
  ses.__lingxiBrowserSessionConfigured = true

  const ua = getChromeLikeUserAgent(ses)
  const acceptLanguage = buildAcceptLanguage()

  applyCodexPermissionPolicy(ses)

  try {
    ses.setUserAgent(ua, acceptLanguage)
  } catch (_) {
    try { ses.setUserAgent(ua) } catch (__) { /* ignore */ }
  }

  try {
    ses.webRequest.onBeforeSendHeaders(
      { urls: ['http://*/*', 'https://*/*'] },
      (details, callback) => {
        try {
          let base = ''
          try { base = ses.getUserAgent() } catch (_) { base = ua }
          if (!base || /Electron/i.test(base)) base = ua
          callback({
            cancel: false,
            requestHeaders: applyRequestHeaders(details.requestHeaders || {}, base)
          })
        } catch (_) {
          callback({ cancel: false, requestHeaders: details.requestHeaders })
        }
      }
    )
  } catch (error) {
    console.warn('[ExternalWebview] onBeforeSendHeaders failed:', error.message)
  }

  return ses
}

function setupExternalWebviewSession() {
  applyEarlyUserAgentFallback()
  if (configured) return getChromeLikeUserAgent()
  configured = true

  configureSession(session.fromPartition(EXTERNAL_WEBVIEW_PARTITION))
  configureSession(session.fromPartition(MUSIC_STUDIO_PARTITION))
  try { configureSession(session.defaultSession) } catch (_) { /* ignore */ }

  const ua = getChromeLikeUserAgent()
  console.log('[ExternalWebview] ready (minimal Codex-compatible policy)', {
    chrome: getChromeVersion(),
    electron: process.versions.electron,
    userAgent: ua,
    secChUa: buildSecChUa(ua),
    note: 'no CDP debugger; strip Electron product token only'
  })
  return ua
}

/**
 * guest webContents 创建后立刻套策略（禁止 debugger）
 */
function disguiseWebContentsAsChrome(contents) {
  if (!contents || contents.isDestroyed?.()) return
  if (contents.__lingxiDisguised) return
  contents.__lingxiDisguised = true

  try { configureSession(contents.session) } catch (_) { /* ignore */ }

  const ua = getChromeLikeUserAgent(contents.session)
  try { contents.setUserAgent(ua) } catch (error) {
    console.warn('[ExternalWebview] setUserAgent failed:', error.message)
  }

  // 轻量诊断（不 attach debugger）
  try {
    contents.on('did-finish-load', () => {
      const url = contents.getURL?.() || ''
      if (!/accounts\.google\.|google\.[^/]+\/(?:signin|o\/oauth2|AccountChooser)/i.test(url)) return
      contents.executeJavaScript(`({
        ua: navigator.userAgent,
        brands: navigator.userAgentData && navigator.userAgentData.brands && navigator.userAgentData.brands.map(b => b.brand + '/' + b.version),
        hasElectron: /Electron/i.test(navigator.userAgent),
        blocked: /不安全|may not be secure|无法登录|Couldn't sign you in/i.test(document.body && document.body.innerText || ''),
        title: document.title
      })`, true).then((info) => {
        console.log('[ExternalWebview][GoogleLoginDiag]', info)
      }).catch(() => {})
    })
  } catch (_) { /* ignore */ }
}

function applyUserAgentToWebviewParams(params = {}) {
  params.useragent = getChromeLikeUserAgent()
  return params
}

async function clearGoogleAuthSiteData() {
  const partitions = [EXTERNAL_WEBVIEW_PARTITION, MUSIC_STUDIO_PARTITION]
  const origins = [
    'https://accounts.google.com',
    'https://www.google.com',
    'https://google.com',
    'https://apis.google.com',
    'https://oauth2.googleapis.com'
  ]
  for (const partition of partitions) {
    try {
      const ses = session.fromPartition(partition)
      for (const origin of origins) {
        await ses.clearStorageData?.({
          origin,
          storages: ['cookies', 'localstorage', 'indexdb', 'cachestorage', 'serviceworkers']
        }).catch(() => {})
      }
      await ses.clearCache?.().catch(() => {})
    } catch (_) { /* ignore */ }
  }
  return { success: true }
}

/**
 * 清除指定 partition 的所有存储数据（解决存储配额满问题）
 */
async function clearPartitionStorage(partition) {
  try {
    const ses = session.fromPartition(partition)
    await ses.clearStorageData?.({
      storages: ['cookies', 'localstorage', 'indexdb', 'cachestorage', 'serviceworkers', 'shadercache', 'websql']
    }).catch(() => {})
    await ses.clearCache?.().catch(() => {})
    console.log(`[ExternalWebview] cleared all storage for partition: ${partition}`)
    return { success: true }
  } catch (e) {
    console.warn(`[ExternalWebview] clearPartitionStorage failed:`, e.message)
    return { success: false, error: e.message }
  }
}

// 兼容旧调用名
function applyCdpUserAgentOverride() {
  return Promise.resolve(false)
}

module.exports = {
  EXTERNAL_WEBVIEW_PARTITION,
  MUSIC_STUDIO_PARTITION,
  getChromeVersion,
  getChromeMajor,
  getChromeLikeUserAgent,
  buildSecChUa,
  applyEarlyUserAgentFallback,
  setupExternalWebviewSession,
  disguiseWebContentsAsChrome,
  applyUserAgentToWebviewParams,
  clearGoogleAuthSiteData,
  clearPartitionStorage,
  applyCdpUserAgentOverride,
  configureSession
}
