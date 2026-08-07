/**
 * 窗口管理模块
 * 负责主窗口、子窗口、文件窗口的创建与控制
 */

const { app, BrowserWindow, Menu, screen, webContents: electronWebContents } = require('electron')
const path = require('path')
const fs = require('fs')
const config = require('./config')
const backgroundReplySound = require('./background-reply-sound')
const runtimeTargets = require('./runtime-targets')

const APP_PRELOAD = path.join(__dirname, '../preload.js')
const EXTERNAL_WEBVIEW_PRELOAD = path.join(__dirname, '../external-webview-preload.js')
const APP_ICON = path.join(__dirname, '../灵犀icon.png')
const EXTERNAL_WEBVIEW_PARTITION = 'persist:lingxi-external-webview'
const externalWebviewSession = require('./external-webview-session')
const googleLoginWindow = require('./google-login-window')
const APP_NAME = '灵犀 LingXiCode'
const MAIN_WINDOW_DEFAULT_WIDTH = 1295
const MAIN_WINDOW_DEFAULT_HEIGHT = 918
const MAIN_WINDOW_MIN_WIDTH = 900
const MAIN_WINDOW_MIN_HEIGHT = 620
let mainWindowNormalBounds = null
let workspaceBoundsTimer = null
let pendingWorkspaceExpanded = null

function areBoundsEqual(a = {}, b = {}) {
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height
}

function applyMainWindowWorkspaceExpanded(expanded = false) {
  const mainWindow = config.getMainWindow()
  if (!mainWindow || mainWindow.isDestroyed()) return
  if (mainWindow.isMaximized()) return

  if (expanded) {
    if (!mainWindowNormalBounds) mainWindowNormalBounds = mainWindow.getBounds()
    const currentBounds = mainWindow.getBounds()
    const workArea = screen.getDisplayMatching(currentBounds).workArea
    const targetWidth = Math.min(MAIN_WINDOW_DEFAULT_WIDTH, workArea.width)
    const targetHeight = Math.min(MAIN_WINDOW_DEFAULT_HEIGHT, workArea.height)
    const targetX = Math.max(workArea.x, Math.min(currentBounds.x, workArea.x + workArea.width - targetWidth))
    const targetY = Math.max(workArea.y, Math.min(currentBounds.y, workArea.y + workArea.height - targetHeight))
    const targetBounds = {
      x: targetX,
      y: targetY,
      width: targetWidth,
      height: targetHeight
    }
    if (!areBoundsEqual(currentBounds, targetBounds)) {
      mainWindow.setBounds(targetBounds, false)
    }
    return
  }

  if (mainWindowNormalBounds) {
    const currentBounds = mainWindow.getBounds()
    if (!areBoundsEqual(currentBounds, mainWindowNormalBounds)) {
      mainWindow.setBounds(mainWindowNormalBounds, false)
    }
    mainWindowNormalBounds = null
  }
}

function setMainWindowWorkspaceExpanded(expanded = false) {
  pendingWorkspaceExpanded = expanded === true
  if (workspaceBoundsTimer) clearTimeout(workspaceBoundsTimer)
  workspaceBoundsTimer = setTimeout(() => {
    workspaceBoundsTimer = null
    applyMainWindowWorkspaceExpanded(pendingWorkspaceExpanded)
  }, 60)
}

function getAppWebPreferences(options = {}) {
  return {
    preload: APP_PRELOAD,
    nodeIntegration: false,
    contextIsolation: true,
    webviewTag: options.webviewTag ?? false,
    webSecurity: true
  }
}

/**
 * 统一右键菜单处理函数
 */
function setupContextMenu(win) {
  win.webContents.on('context-menu', (event, params) => {
    const menuItems = []

    // 只有在可编辑区域才显示剪切/粘贴
    if (params.isEditable) {
      menuItems.push({
        label: '剪切',
        accelerator: 'Ctrl+X',
        role: 'cut'
      })
    }

    // 有选中文字时显示复制
    if (params.selectionText) {
      menuItems.push({
        label: '复制',
        accelerator: 'Ctrl+C',
        role: 'copy'
      })
    }

    // 可编辑区域显示粘贴
    if (params.isEditable) {
      menuItems.push({
        label: '粘贴',
        accelerator: 'Ctrl+V',
        role: 'paste'
      })
      menuItems.push({
        label: '全选',
        accelerator: 'Ctrl+A',
        role: 'selectAll'
      })
    }

    if (menuItems.length > 0) {
      const menu = Menu.buildFromTemplate(menuItems)
      menu.popup(win, params.x, params.y)
    }
  })
}

/**
 * 创建主窗口
 */
function createMainWindow() {
  const mainWindow = new BrowserWindow({
    width: MAIN_WINDOW_DEFAULT_WIDTH,
    height: MAIN_WINDOW_DEFAULT_HEIGHT,
    minWidth: MAIN_WINDOW_MIN_WIDTH,
    minHeight: MAIN_WINDOW_MIN_HEIGHT,
    title: APP_NAME,
    icon: APP_ICON,
    frame: false,  // 无边框，使用自定义标题栏
    roundedCorners: true,
    webPreferences: getAppWebPreferences({ webviewTag: true })
  })
  mainWindow.loadFile(path.join(__dirname, '../../frontend/index.html'))
  Menu.setApplicationMenu(null)
  if (!app.isPackaged || process.env.LINGXI_DEVTOOLS === '1' || process.argv.includes('--devtools')) {
    mainWindow.webContents.openDevTools()
  }

  // 添加右键菜单
  setupContextMenu(mainWindow)

  const notifyMaximizedState = () => {
    if (!mainWindow.isDestroyed()) {
      mainWindow.webContents.send('main-window-maximized-change', { maximized: mainWindow.isMaximized() })
    }
  }
  mainWindow.on('maximize', notifyMaximizedState)
  mainWindow.on('unmaximize', notifyMaximizedState)
  mainWindow.webContents.once('did-finish-load', notifyMaximizedState)

  // 无边框窗口从其它应用切回时，Chromium 有时不会把焦点交还给 webContents，
  // 导致第一次点击只激活窗口、输入框要点第二次才可用。窗口激活即回焦渲染进程修复。
  mainWindow.on('focus', () => {
    if (mainWindow.isDestroyed()) return
    try { mainWindow.webContents?.focus?.() } catch (_) {}
  })
  // 点 X 关闭主窗口时主动触发 app.quit()，由 main.js 的 before-quit 统一清理所有窗口（含桌宠）后退出
  // 否则桌宠等独立窗口会阻止 window-all-closed 触发，导致进程无法退出
  mainWindow.on('close', (e) => {
    if (!mainWindow.isDestroyed()) {
      e.preventDefault()
      app.quit()
    }
  })
  backgroundReplySound.bindWindowBadgeReset(mainWindow)

  // 保存到配置中心
  config.setMainWindow(mainWindow)
  runtimeTargets.registerBrowserWindow(mainWindow, {
    runtimeId: 'runtime-lingxi-main',
    kind: 'lingxi-main',
    source: 'main-window',
    buildType: app.isPackaged ? 'installed' : 'development',
    workspacePath: app.isPackaged ? '' : path.resolve(__dirname, '../..'),
    executablePath: process.execPath,
    processId: process.pid,
    observationOnly: app.isPackaged
  })

  config.setMainWindow(mainWindow)
  return mainWindow
}

/**
 * 设置热重载
 */
function setupHotReload() {
  if (app.isPackaged) return
  const mainWindow = config.getMainWindow()
  const frontendPath = path.join(__dirname, '../../frontend')
  fs.watch(frontendPath, { recursive: true }, (eventType, filename) => {
    if (filename && mainWindow) mainWindow.reload()
  })
}

/**
 * 注册窗口控制 IPC handlers
 */
function registerWindowIPC(ipcMain) {
  ipcMain.handle('runtime-target:register', (event, payload = {}) => {
    const webContentsId = Number(payload.webContentsId || payload.web_contents_id)
    const targetWebContents = webContentsId > 0 ? electronWebContents.fromId(webContentsId) : event.sender
    return runtimeTargets.registerWebContents(targetWebContents, {
      ...payload,
      source: payload.source || 'renderer-registration'
    })
  })

  ipcMain.handle('runtime-target:touch', (event, payload = {}) => {
    const key = payload.runtimeId || payload.runtime_id || payload.webContentsId || payload.web_contents_id
    return { success: true, target: runtimeTargets.touchRuntimeTarget(key, payload) }
  })

  ipcMain.handle('runtime-target:list', (event, payload = {}) => ({
    success: true,
    targets: runtimeTargets.listRuntimeTargets(payload)
  }))

  ipcMain.handle('runtime-target:unregister', (event, payload = {}) => ({
    success: true,
    removed: runtimeTargets.unregisterRuntimeTarget(payload.runtimeId || payload.runtime_id || payload.webContentsId || payload.web_contents_id)
  }))

  // 主窗口控制（自定义标题栏）
  ipcMain.on('main-window-minimize', () => {
    const mainWindow = config.getMainWindow()
    if (mainWindow) mainWindow.minimize()
  })

  ipcMain.on('main-window-maximize', () => {
    const mainWindow = config.getMainWindow()
    if (mainWindow) {
      if (mainWindow.isMaximized()) mainWindow.unmaximize()
      else mainWindow.maximize()
      mainWindow.webContents.send('main-window-maximized-change', { maximized: mainWindow.isMaximized() })
    }
  })

  ipcMain.on('main-window-close', () => {
    const mainWindow = config.getMainWindow()
    if (mainWindow) mainWindow.close()
  })

  ipcMain.on('main-window-workspace-expanded', (event, expanded) => {
    setMainWindowWorkspaceExpanded(expanded === true)
  })

}

/**
 * 设置 webcontents 创建监听（拦截 webview 新窗口）
 */
function setupWebContentsHandler(app) {
  app.on('web-contents-created', (event, contents) => {
    const type = contents.getType()

    contents.on('will-attach-webview', (event, webPreferences, params) => {
      const src = String(params.src || '')
      const isMusicStudio = src.startsWith('file://') && src.includes('agent-music-studio.html')
      delete webPreferences.preloadURL
      webPreferences.nodeIntegration = false
      webPreferences.nodeIntegrationInSubFrames = false
      webPreferences.contextIsolation = true
      webPreferences.webSecurity = true
      webPreferences.allowRunningInsecureContent = false

      if (isMusicStudio) {
        webPreferences.preload = APP_PRELOAD
        webPreferences.sandbox = false
        params.partition = 'persist:lingxi-music-studio'
        params.preload = APP_PRELOAD
      } else {
        // 对齐 Codex OL/kL + 实测可用配置：
        // - 无业务 preload（避免污染页面）
        // - allowpopups（OAuth 真实弹窗）
        // - 干净 Chrome UA（见 external-webview-session，禁止 CDP debugger）
        delete webPreferences.preload
        webPreferences.sandbox = true
        webPreferences.nodeIntegration = false
        webPreferences.nodeIntegrationInSubFrames = false
        webPreferences.contextIsolation = true
        webPreferences.webSecurity = true
        webPreferences.allowRunningInsecureContent = false
        webPreferences.webviewTag = false
        webPreferences.plugins = false
        params.partition = params.partition || EXTERNAL_WEBVIEW_PARTITION
        if (params.preload) delete params.preload
        delete params.disablewebsecurity
        delete params.webpreferences
        params.allowpopups = ''
        // 在 attach 前确保 partition session 已配置（UA + 权限 + headers）
        try {
          externalWebviewSession.configureSession?.(
            require('electron').session.fromPartition(params.partition)
          )
        } catch (_) { /* ignore */ }
        externalWebviewSession.applyUserAgentToWebviewParams(params)
      }
    })

    // 右侧 webview 的所有网页新开请求都转为当前右栏中的标签页。
    if (type === 'webview') {
      externalWebviewSession.disguiseWebContentsAsChrome(contents)
      googleLoginWindow.attachGoogleLoginFallback(contents)
      runtimeTargets.registerWebContents(contents, {
        kind: 'embedded-webview',
        source: 'web-contents-created'
      })

      contents.setWindowOpenHandler(({ url }) => {
        // 危险/受限协议仍拒绝
        if (url && !/^(https?:|about:blank)/i.test(url) && url !== '') {
          return { action: 'deny' }
        }

        const mainWindow = config.getMainWindow()
        if (url && mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('right-webview-open-request', { url, title: '' })
        }
        return { action: 'deny' }
      })
    }
  })
}

module.exports = {
  setupContextMenu,
  createMainWindow,
  setupHotReload,
  registerWindowIPC,
  setupWebContentsHandler,
  EXTERNAL_WEBVIEW_PARTITION
}
