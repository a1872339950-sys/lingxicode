const { app, nativeImage } = require('electron')
const config = require('./config')

let lastPlayedAt = 0
let unreadReplyCount = 0
let flashStopTimer = null
const MIN_INTERVAL_MS = 1200
const FLASH_STOP_MS = 4500

function shouldPlayForMainWindow(win) {
  if (!win || win.isDestroyed?.()) return false
  try {
    return win.isMinimized?.() === true || win.isVisible?.() === false
  } catch (error) {
    return false
  }
}

function createUnreadOverlayIcon(count) {
  const safeCount = Math.max(1, Math.min(99, Number(count) || 1))
  const label = safeCount > 9 ? '9+' : String(safeCount)
  const fontSize = label.length > 1 ? 17 : 20
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">
      <circle cx="16" cy="16" r="15" fill="#e11d48"/>
      <circle cx="16" cy="16" r="14" fill="none" stroke="rgba(255,255,255,0.9)" stroke-width="2"/>
      <text x="16" y="22" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="${fontSize}" font-weight="700" fill="#ffffff">${label}</text>
    </svg>`
  return nativeImage.createFromBuffer(Buffer.from(svg))
}

function updateTaskbarUnreadBadge(win = config.getMainWindow()) {
  if (!win || win.isDestroyed?.()) return false
  if (process.platform === 'darwin') {
    app.setBadgeCount(unreadReplyCount)
    return true
  }
  if (process.platform === 'win32' && typeof win.setOverlayIcon === 'function') {
    const icon = unreadReplyCount > 0 ? createUnreadOverlayIcon(unreadReplyCount) : null
    const description = unreadReplyCount > 0 ? `${unreadReplyCount} 条 AI 回复已完成` : ''
    win.setOverlayIcon(icon, description)
    return true
  }
  return false
}

function stopTaskbarFlash(win = config.getMainWindow()) {
  if (flashStopTimer) {
    clearTimeout(flashStopTimer)
    flashStopTimer = null
  }
  if (!win || win.isDestroyed?.() || typeof win.flashFrame !== 'function') return false
  win.flashFrame(false)
  return true
}

function brieflyFlashTaskbar(win = config.getMainWindow()) {
  if (!win || win.isDestroyed?.() || typeof win.flashFrame !== 'function') return false
  stopTaskbarFlash(win)
  win.flashFrame(true)
  flashStopTimer = setTimeout(() => {
    stopTaskbarFlash(win)
  }, FLASH_STOP_MS)
  if (typeof flashStopTimer.unref === 'function') flashStopTimer.unref()
  return true
}

function clearUnreadReplyBadge() {
  unreadReplyCount = 0
  stopTaskbarFlash()
  return updateTaskbarUnreadBadge()
}

function bindWindowBadgeReset(win) {
  if (!win || win.isDestroyed?.() || win.__lingxiReplyBadgeResetBound) return
  win.__lingxiReplyBadgeResetBound = true
  const reset = () => clearUnreadReplyBadge()
  win.on('focus', reset)
  win.on('restore', reset)
  win.on('show', reset)
}

function notifyFinalReplyDone(payload = {}) {
  const now = Date.now()
  if (now - lastPlayedAt < MIN_INTERVAL_MS) return false
  const win = config.getMainWindow()
  if (!shouldPlayForMainWindow(win)) return false
  lastPlayedAt = now
  unreadReplyCount += 1
  updateTaskbarUnreadBadge(win)
  brieflyFlashTaskbar(win)
  win.webContents?.send('background-reply-sound', {
    projectId: payload.projectId || '',
    completedAt: payload.completedAt || now
  })
  return true
}

module.exports = {
  notifyFinalReplyDone,
  shouldPlayForMainWindow,
  clearUnreadReplyBadge,
  bindWindowBadgeReset,
  updateTaskbarUnreadBadge,
  brieflyFlashTaskbar,
  stopTaskbarFlash
}
