/**
 * 桌面操控公共入口：配置 IPC + overlay 绑定
 */

const { BrowserWindow } = require('electron')
const settings = require('./settings')
const session = require('./session')
const overlay = require('./overlay')
const service = require('./service')
const { ensureActionConfirmation, classifyRisk } = require('./confirmations')
const { ensureAppApproval, resolveAppIdentity } = require('./app-approval')

let registered = false
let activityBroadcastBound = false

function broadcastActivity(extra = {}) {
  const payload = { ...session.getStatus(), ...extra }
  for (const win of BrowserWindow.getAllWindows()) {
    try {
      if (!win || win.isDestroyed() || win.webContents?.isDestroyed()) continue
      win.webContents.send('desktop-control:activity', payload)
    } catch (_) { /* a closing window may reject sends */ }
  }
  return payload
}

function bindActivityBroadcast() {
  if (activityBroadcastBound) return
  activityBroadcastBound = true
  session.onActivity(evt => broadcastActivity(evt))
  session.onInterrupted(evt => broadcastActivity(evt))
}

function registerDesktopControlIPC(ipcMain) {
  if (registered) return
  registered = true
  overlay.bindSession()
  bindActivityBroadcast()

  ipcMain.handle('desktop-control:getSettings', () => ({
    success: true,
    data: settings.getSettings(),
    status: session.getStatus()
  }))

  ipcMain.handle('desktop-control:saveSettings', async (event, partial = {}) => {
    const prev = settings.getSettings()
    const data = settings.saveSettings(partial || {})
    if (prev.enabled && data.enabled === false) {
      session.endActivity()
      await overlay.hide({ destroy: true })
    }
    if (!data.showOverlay) {
      await overlay.hide()
    }
    const status = broadcastActivity({ kind: 'settings_changed' })
    return { success: true, data, status }
  })

  ipcMain.handle('desktop-control:setEnabled', async (event, enabled) => {
    const data = settings.setEnabled(!!enabled)
    if (!data.enabled) {
      session.endActivity()
      await overlay.hide({ destroy: true })
    }
    const status = broadcastActivity({ kind: 'settings_changed' })
    return { success: true, data, status }
  })

  ipcMain.handle('desktop-control:getStatus', () => ({
    success: true,
    data: session.getStatus(),
    settings: settings.getSettings()
  }))

  ipcMain.handle('desktop-control:interrupt', () => {
    const info = session.interrupt('manual')
    overlay.hide({ force: true }).catch(() => {})
    return { success: true, data: info }
  })

  ipcMain.handle('desktop-control:clearInterrupt', () => {
    session.clearInterrupt()
    return { success: true, data: session.getStatus() }
  })

  ipcMain.handle('desktop-control:revokeApp', (event, appRef = '') => {
    const data = settings.revokeAppAlways(appRef)
    return { success: true, data }
  })

  ipcMain.handle('desktop-control:clearAllowlist', () => {
    const data = settings.clearAlwaysAllowed()
    session.clearSessionAllowlist()
    return { success: true, data }
  })
}

function onUserTurnStart() {
  session.onUserTurnStart()
  overlay.hide().catch(() => {})
}

function getDisabledToolsIfNeeded() {
  if (settings.isEnabled()) return []
  return ['desktop_control']
}

module.exports = {
  registerDesktopControlIPC,
  onUserTurnStart,
  getDisabledToolsIfNeeded,
  settings,
  session,
  overlay,
  service,
  ensureActionConfirmation,
  classifyRisk,
  ensureAppApproval,
  resolveAppIdentity,
  isEnabled: () => settings.isEnabled()
}
