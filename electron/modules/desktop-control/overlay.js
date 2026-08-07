/**
 * 桌面操控全屏状态反馈：边缘脉冲 + 顶部状态胶囊
 * 鼠标事件穿透，Esc 通过 globalShortcut 捕获
 */

const { BrowserWindow, screen, globalShortcut } = require('electron')
const path = require('path')
const settings = require('./settings')
const session = require('./session')

const OVERLAY_HTML = path.join(__dirname, 'overlay.html')

let overlayWindows = []
let escRegistered = false
let visible = false
let bound = false

function destroyWindows() {
  for (const win of overlayWindows) {
    try {
      if (win && !win.isDestroyed()) win.destroy()
    } catch (_) { /* ignore */ }
  }
  overlayWindows = []
}

function ensureWindows() {
  // 清理已销毁的
  overlayWindows = overlayWindows.filter(w => w && !w.isDestroyed())
  if (overlayWindows.length) return overlayWindows

  const displays = screen.getAllDisplays()
  for (const display of displays) {
    const { x, y, width, height } = display.bounds
    const win = new BrowserWindow({
      x,
      y,
      width,
      height,
      show: false,
      frame: false,
      transparent: true,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      hasShadow: false,
      focusable: false,
      title: '灵犀桌面操控',
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        backgroundThrottling: false
      }
    })
    win.setIgnoreMouseEvents(true, { forward: true })
    win.setAlwaysOnTop(true, 'screen-saver')
    try {
      win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
    } catch (_) { /* ignore */ }
    win.loadFile(OVERLAY_HTML).catch(() => {})
    win.on('closed', () => {
      overlayWindows = overlayWindows.filter(w => w !== win)
    })
    overlayWindows.push(win)
  }
  return overlayWindows
}

function buildPayload(extra = {}) {
  const cfg = settings.getSettings()
  return {
    visible: true,
    accentColor: cfg.accentColor,
    usingComputer: cfg.strings?.usingComputer || '灵犀正在使用你的电脑',
    escToCancel: cfg.escToCancel !== false,
    escLabel: cfg.strings?.escToCancel || '取消',
    targetLabel: extra.targetLabel || session.getStatus().lastTargetLabel || '',
    actionLabel: extra.actionLabel || session.getStatus().lastActionLabel || '',
    phase: extra.phase || session.getStatus().phase || 'working',
    ...extra
  }
}

async function paint(payload) {
  const wins = ensureWindows()
  const js = `window.applyOverlayState && window.applyOverlayState(${JSON.stringify(payload)})`
  await Promise.all(wins.map(async win => {
    if (!win || win.isDestroyed()) return
    try {
      if (win.webContents.isLoading()) {
        await new Promise(resolve => {
          win.webContents.once('did-finish-load', resolve)
          setTimeout(resolve, 800)
        })
      }
      await win.webContents.executeJavaScript(js)
    } catch (_) { /* ignore */ }
  }))
}

function registerEsc() {
  const cfg = settings.getSettings()
  if (cfg.escToCancel === false) return
  if (escRegistered) return
  try {
    const ok = globalShortcut.register('Escape', () => {
      session.interrupt('escape')
      hide({ force: true })
    })
    escRegistered = !!ok
    if (!ok) console.warn('[DesktopControl] failed to register Escape shortcut')
  } catch (error) {
    console.warn('[DesktopControl] Escape register error:', error.message)
  }
}

function unregisterEsc() {
  if (!escRegistered) return
  try {
    globalShortcut.unregister('Escape')
  } catch (_) { /* ignore */ }
  escRegistered = false
}

async function show(meta = {}) {
  const cfg = settings.getSettings()
  if (cfg.enabled === false) return { ok: false, reason: 'disabled' }
  if (cfg.showOverlay === false) {
    // 仍注册 Esc（若开启），但不显示层
    if (cfg.escToCancel !== false) registerEsc()
    visible = false
    return { ok: true, overlay: false }
  }

  ensureWindows()
  const payload = buildPayload({
    targetLabel: meta.targetLabel || meta.label || '',
    actionLabel: meta.actionLabel || '',
    phase: meta.phase || 'working',
    visible: true
  })
  for (const win of overlayWindows) {
    if (!win || win.isDestroyed()) continue
    if (!win.isVisible()) {
      if (typeof win.showInactive === 'function') win.showInactive()
      else win.show()
    }
  }
  await paint(payload)
  registerEsc()
  visible = true
  return { ok: true, overlay: true }
}

async function hide(options = {}) {
  unregisterEsc()
  visible = false
  const payload = buildPayload({ visible: false })
  try {
    await paint(payload)
  } catch (_) { /* ignore */ }
  for (const win of overlayWindows) {
    try {
      if (win && !win.isDestroyed() && win.isVisible()) win.hide()
    } catch (_) { /* ignore */ }
  }
  if (options.destroy) destroyWindows()
  return { ok: true }
}

function isVisible() {
  return visible
}

function bindSession() {
  if (bound) return
  bound = true
  session.onActivity((evt) => {
    if (evt?.idle || evt?.ended) {
      hide().catch(() => {})
      return
    }
    if (settings.getSettings().enabled === false) return
    if (evt?.showOverlay === false) {
      if (visible) hide().catch(() => {})
      return
    }
    show({
      targetLabel: evt?.label || evt?.targetLabel || '',
      actionLabel: evt?.actionLabel || '',
      phase: evt?.phase || 'working'
    }).catch(() => {})
  })
  session.onInterrupted(() => {
    hide({ force: true }).catch(() => {})
  })
  try {
    screen.on('display-added', () => {
      if (visible) {
        destroyWindows()
        show().catch(() => {})
      }
    })
    screen.on('display-removed', () => {
      if (visible) {
        destroyWindows()
        show().catch(() => {})
      }
    })
  } catch (_) { /* ignore */ }
}

function dispose() {
  unregisterEsc()
  destroyWindows()
  visible = false
}

module.exports = {
  show,
  hide,
  isVisible,
  bindSession,
  dispose,
  registerEsc,
  unregisterEsc
}
