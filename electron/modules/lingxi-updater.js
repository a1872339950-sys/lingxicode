/**
 * lingxi-updater.js
 * 检查灵犀客户端更新
 *
 * 服务器需提供的接口：
 *   POST  {apiBaseUrl}/update/check
 *   Headers:
 *     Content-Type: application/json
 *   Body:
 *     {
 *       currentVersion: "1.0.0",            // 客户端当前版本（package.json）
 *       platform: "win32" | "darwin" | "linux",
 *       arch:     "x64" | "arm64",
 *       channel:  "stable" | "beta",        // 预留通道，默认 stable
 *     }
 *   返回（成功）：
 *     {
 *       success: true,
 *       data: {
 *         hasUpdate: true | false,
 *         latestVersion: "1.0.1",
 *         downloadUrl:   "https://.../灵犀-1.0.1-setup.exe",
 *         releaseNotes:  "支持 xxx，修了 yyy",   // 可选，纯文本或 markdown
 *         releaseDate:   "2026-06-10",          // 可选
 *         forceUpdate:   false,                  // true 时前端不让用户跳过
 *         minVersion:    "0.9.0"                 // 可选，低于此版本必须更新
 *       }
 *     }
 *   返回（失败）：
 *     { success: false, error: "原因" }
 */

const { shell } = require('electron')
let cachedPackageVersion = ''

function getCurrentVersion() {
  if (cachedPackageVersion) return cachedPackageVersion
  try {
    const pkg = require('../../package.json')
    cachedPackageVersion = String(pkg.version || '0.0.0')
  } catch {
    cachedPackageVersion = '0.0.0'
  }
  return cachedPackageVersion
}

/** 版本号比较：a > b 返回 1，a < b 返回 -1，相等返回 0 */
function compareVersion(a = '', b = '') {
  const pa = String(a).replace(/^v/i, '').split(/[.-]/).map(x => Number(x) || 0)
  const pb = String(b).replace(/^v/i, '').split(/[.-]/).map(x => Number(x) || 0)
  const len = Math.max(pa.length, pb.length)
  for (let i = 0; i < len; i++) {
    const x = pa[i] || 0
    const y = pb[i] || 0
    if (x > y) return 1
    if (x < y) return -1
  }
  return 0
}

function buildPayload() {
  return {
    currentVersion: getCurrentVersion(),
    platform: process.platform,
    arch: process.arch,
    channel: 'stable'
  }
}

function getApiBaseUrl() {
  const base = String(process.env.LINGXI_UPDATE_API_BASE || '')
    .trim()
    .replace(/\/+$/, '')
  return base
}

function buildHeaders() {
  return { 'Content-Type': 'application/json; charset=utf-8' }
}

/**
 * 调用云端接口检查更新
 * @returns {Promise<{success:boolean, data?:object, error?:string}>}
 */
async function checkUpdate({ silent = false } = {}) {
  const currentVersion = getCurrentVersion()
  const apiBaseUrl = getApiBaseUrl()
  if (!apiBaseUrl) {
    return { success: false, error: '未配置更新服务', currentVersion }
  }
  const url = `${apiBaseUrl}/update/check`
  const payload = buildPayload()

  let response
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 10_000)
    response = await fetch(url, {
      method: 'POST',
      headers: buildHeaders(),
      body: JSON.stringify(payload),
      signal: controller.signal
    })
    clearTimeout(timer)
  } catch (err) {
    if (!silent) console.error('[LingxiUpdater] network error:', err?.message)
    return {
      success: false,
      error: '无法连接更新服务器，请检查网络',
      currentVersion
    }
  }

  let text = ''
  try { text = await response.text() } catch { /* 响应体读取失败 */ }
  let body = null
  try { body = text ? JSON.parse(text) : null } catch { body = null }

  if (!response.ok) {
    if (response.status === 404) {
      return {
        success: false,
        error: '更新服务尚未开放（接口 404），请联系管理员',
        currentVersion
      }
    }
    return {
      success: false,
      error: body?.error || `服务器返回 ${response.status}`,
      currentVersion
    }
  }

  if (body && body.success === false) {
    return { success: false, error: body.error || '检查更新失败', currentVersion }
  }

  const data = body?.data || body || {}
  const latestVersion = String(data.latestVersion || data.version || '').trim()
  if (!latestVersion) {
    return {
      success: false,
      error: '服务器响应缺少 latestVersion 字段',
      currentVersion
    }
  }

  // 客户端兜底比对，避免后端 hasUpdate 字段缺失
  const cmp = compareVersion(latestVersion, currentVersion)
  const hasUpdate = typeof data.hasUpdate === 'boolean' ? data.hasUpdate : cmp > 0

  // 是否必须强制更新（minVersion 高于当前版本，或后端显式 forceUpdate）
  const minVersion = String(data.minVersion || '').trim()
  const forceByMin = minVersion ? compareVersion(currentVersion, minVersion) < 0 : false
  const forceUpdate = !!data.forceUpdate || forceByMin

  return {
    success: true,
    data: {
      hasUpdate,
      currentVersion,
      latestVersion,
      downloadUrl: String(data.downloadUrl || data.url || '').trim(),
      releaseNotes: String(data.releaseNotes || data.notes || '').trim(),
      releaseDate: String(data.releaseDate || '').trim(),
      forceUpdate,
      minVersion
    }
  }
}

async function openDownloadUrl(url = '') {
  const target = String(url || '').trim()
  if (!target || !/^https?:\/\//i.test(target)) {
    return { success: false, error: '下载链接无效' }
  }
  try {
    await shell.openExternal(target)
    return { success: true }
  } catch (err) {
    return { success: false, error: err?.message || '无法打开浏览器' }
  }
}

function registerIPC(ipcMain) {
  ipcMain.handle('lingxi-update:check', async (_event, opts = {}) => checkUpdate(opts || {}))
  ipcMain.handle('lingxi-update:openDownload', async (_event, url) => openDownloadUrl(url))
  ipcMain.handle('lingxi-update:getCurrentVersion', async () => ({
    success: true,
    data: { currentVersion: getCurrentVersion() }
  }))
}

module.exports = {
  getCurrentVersion,
  compareVersion,
  checkUpdate,
  openDownloadUrl,
  registerIPC
}
