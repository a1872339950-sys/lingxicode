/**
 * 灵犀 LingXiCode 主入口
 * 精简版 - 只负责初始化和模块组装
 */

const { app, BrowserWindow, protocol } = require('electron')
const path = require('path')
const fs = require('fs')

// 导入模块
const config = require('./modules/config')
const storageConfig = require('./modules/storage-config')
const skills = require('./modules/skills')
const projects = require('./modules/projects')
const windows = require('./modules/windows')
const ipc = require('./modules/ipc')
const runtimeDiagnostics = require('./modules/runtime-diagnostics')
const changeSessions = require('./modules/change-sessions')
const developmentRuntimeBridge = require('./modules/development-runtime-bridge')

const PACKAGED_CHANNEL_NAME = 'Stable'
const PACKAGED_USER_DATA_DIR_NAME = 'Lingxi LingXiCode Stable'

app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required')
// WebAuthn：拒绝 passkey/安全密钥，避免 Windows 弹「未验证 electron.exe」
// （Codex 用权限策略拒绝 publickey；此处命令行再加一层）
try {
  const disabled = new Set(
    String(app.commandLine.getSwitchValue('disable-features') || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
  )
  disabled.add('WebAuthentication')
  disabled.add('WebAuthenticationCable')
  disabled.add('WebAuthenticationHybridTransport')
  disabled.add('WebOTP')
  app.commandLine.appendSwitch('disable-features', [...disabled].join(','))
} catch (_) { /* ignore */ }

// 必须在 ready 之前去掉 Electron UA，否则右侧 webview 首次请求仍可能带 Electron 被 Google 拒绝
try {
  require('./modules/external-webview-session').applyEarlyUserAgentFallback()
} catch (error) {
  console.warn('[Main] early UA fallback failed:', error.message)
}

if (process.argv.includes('--check') && process.env.ELECTRON_RUN_AS_NODE !== '1') {
  console.warn('[Main] Ignored accidental app launch for node --check. Syntax checks must run with ELECTRON_RUN_AS_NODE=1.')
  app.exit(0)
  process.exit(0)
}

function resolveRoamingAppDataDir() {
  if (process.platform === 'win32' && process.env.APPDATA) return process.env.APPDATA
  return app.getPath('appData')
}

function configurePackagedRuntimeChannel() {
  if (!app.isPackaged) return
  const userDataPath = path.join(resolveRoamingAppDataDir(), PACKAGED_USER_DATA_DIR_NAME)
  app.setPath('userData', userDataPath)
  app.setAppUserModelId('com.lingxi.lingxicode.stable')
  process.env.LINGXI_RUNTIME_CHANNEL = PACKAGED_CHANNEL_NAME.toLowerCase()
  console.log('[Main] packaged runtime channel:', PACKAGED_CHANNEL_NAME, 'userData:', userDataPath)
}

configurePackagedRuntimeChannel()

function resolveAppProtocolPath(requestUrl) {
  const projectRoot = path.resolve(__dirname, '..')
  const parsedUrl = new URL(requestUrl)
  const decodedPath = decodeURIComponent(parsedUrl.pathname || '/')
  const targetPath = path.resolve(projectRoot, `.${decodedPath}`)
  const relativePath = path.relative(projectRoot, targetPath)

  if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
    throw new Error(`Blocked app:// path outside project root: ${decodedPath}`)
  }

  return targetPath
}

function getInstallRoot() {
  if (app.isPackaged) return path.dirname(process.execPath)
  return path.resolve(__dirname, '..')
}

function readInstallDataDir(installRoot) {
  const configPath = path.join(installRoot, 'lingxi-data-dir.txt')
  try {
    if (!fs.existsSync(configPath)) return ''
    const value = fs.readFileSync(configPath, 'utf-8').trim()
    return value ? path.resolve(value) : ''
  } catch (error) {
    console.warn('[Main] Failed to read install data dir:', error.message)
    return ''
  }
}

function resolveDefaultStoragePath() {
  const installRoot = getInstallRoot()
  const installDataDir = readInstallDataDir(installRoot)
  return installDataDir || path.join(installRoot, 'data')
}

// 注册 app:// 自定义协议（必须在 app.whenReady() 之前）
if (protocol && protocol.registerSchemesAsPrivileged) {
  protocol.registerSchemesAsPrivileged([
    { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true } }
  ])
}

// ========== 应用初始化 ==========

app.whenReady().then(() => {
  runtimeDiagnostics.install(app)

  // 右侧外部 webview：伪装为标准 Chrome，支持 Google 等站点在内嵌页登录
  try {
    const externalWebviewSession = require('./modules/external-webview-session')
    externalWebviewSession.setupExternalWebviewSession()
    // 清掉历史 partition 里 Google 在旧 UA 下留下的拒绝态，避免一直「无法登录」
    externalWebviewSession.clearGoogleAuthSiteData().catch((error) => {
      console.warn('[Main] clear Google auth site data failed:', error.message)
    })
  } catch (error) {
    console.warn('[Main] external webview session setup failed:', error.message)
  }

  // 注册 app:// 自定义协议处理器（用于 webview 加载本地页面）
  protocol.registerFileProtocol('app', (request, callback) => {
    try {
      const filePath = resolveAppProtocolPath(request.url)
      console.log('[Main] app:// request:', request.url, '->', path.normalize(filePath))
      callback({ path: path.normalize(filePath) })
      return
    } catch (error) {
      console.warn('[Main] app:// blocked:', error.message)
      callback({ error: -10 })
      return
    }
  })

  // 初始化应用数据目录
  const userDataPath = app.getPath('userData')
  const defaultStoragePath = resolveDefaultStoragePath()
  const runtimeChannel = app.isPackaged ? PACKAGED_CHANNEL_NAME : 'Development'

  // ===== 初始化存储配置模块（统一管理所有路径） =====
  storageConfig.init(defaultStoragePath, app)

  // 从 storage-config 获取路径（支持用户自定义）
  const skillsDir = storageConfig.getSkillsDir()
  const plansDir = storageConfig.getPlansDir()
  const projectsDir = storageConfig.getProjectsDir()

  // 确保数据目录存在
  storageConfig.ensureDirectories()

  // 清理已废弃的生态导航数据（功能下线后留下的孤儿文件）
  try {
    const legacyConfigPath = path.join(storageConfig.getConfigDir(), 'ecosystem-navigation-config.json')
    const legacySummariesPath = path.join(storageConfig.getSummariesDir(), 'ecosystem-navigation')
    if (fs.existsSync(legacyConfigPath)) {
      fs.unlinkSync(legacyConfigPath)
      console.log('[Main] 清理遗留配置:', legacyConfigPath)
    }
    if (fs.existsSync(legacySummariesPath)) {
      fs.rmSync(legacySummariesPath, { recursive: true, force: true })
      console.log('[Main] 清理遗留数据:', legacySummariesPath)
    }
  } catch (error) {
    console.warn('[Main] 清理遗留数据失败:', error.message)
  }

  // 设置配置中心（兼容旧代码）
  config.setAppDataPath(userDataPath)
  config.setLinguaBasePath(projectsDir)  // 项目数据目录
  config.setSkillsDir(skillsDir)
  config.setPlansDir(plansDir)

  // 加载技能
  skills.loadAllSkills()
  skills.loadEnabledSkills()

  // 创建主窗口
  windows.createMainWindow()

  // 注册所有 IPC
  ipc.registerAllIPC(require('electron').ipcMain)

  // 恢复桌宠（若用户已启用）
  try {
    const desktopPet = require('./modules/desktop-pet')
    setTimeout(() => {
      desktopPet.restoreIfEnabled().catch((err) => {
        console.warn('[Main] desktop pet restore failed:', err.message)
      })
    }, 1200)
  } catch (e) {
    console.warn('[Main] desktop pet init failed:', e.message)
  }

  // 启动远程桥接服务（移动端远程操控）
  const remoteBridge = require('./modules/remote-bridge')
  const mainWindow = config.getMainWindow()
  remoteBridge.start({
    webContents: mainWindow?.webContents || null,
  })

  // 设置热重载（开发模式）
  if (!app.isPackaged) {
    windows.setupHotReload()
  }

  // 设置 webContents 创建监听
  windows.setupWebContentsHandler(app)

  if (!app.isPackaged) {
    developmentRuntimeBridge.startDevelopmentRuntimeBridge({
      workspacePath: path.resolve(__dirname, '..'),
      runtimeTargets: require('./modules/runtime-targets'),
      runtimeDiagnostics
    }).catch(error => console.warn('[RuntimeBridge] start failed:', error.message))
  }

  console.log('[Main] 灵犀 LingXiCode 已启动:', {
    runtimeChannel,
    userDataPath,
    defaultStoragePath,
    projectsDir
  })
})

// ========== 应用生命周期 ==========

// 统一的退出流程：销毁所有窗口（含桌宠/overlay等）→ flush 写入 → 强制退出
// 加 3 秒超时兜底，避免子进程/worker 卡住导致进程假死
let _quitting = false
async function performQuit() {
  if (_quitting) return
  _quitting = true

  // 1. 先销毁所有 BrowserWindow（桌宠、overlay 等独立窗口会阻止 window-all-closed 触发）
  try {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.destroy()
    }
  } catch (_) { /* ignore */ }

  // 2. 停止后台服务
  try { developmentRuntimeBridge.stopDevelopmentRuntimeBridge() } catch (_) { /* ignore */ }
  try { require('./modules/remote-bridge').stop() } catch (_) { /* ignore */ }
  try { require('./modules/desktop-pet').hidePet() } catch (_) { /* ignore */ }

  // 3. 等待异步写入完成（最多 3 秒）
  try {
    const flushTimeout = new Promise(resolve => setTimeout(resolve, 3000).unref?.())
    await Promise.race([
      Promise.allSettled([
        projects.flushPendingChatWrites(),
        changeSessions.flushPendingSessionWrites()
      ]),
      flushTimeout
    ])
  } catch (e) {
    console.error('[Main] flush writes on quit failed:', e.message)
  }

  // 4. 强制退出
  app.exit(0)
}

// 主窗口点 X 时，windows.js 会调用 app.quit() 触发 before-quit
// before-quit 里做完整清理：销毁所有窗口（含桌宠）+ flush + 强制退出
app.on('before-quit', async (event) => {
  if (_quitting) return
  event.preventDefault()
  await performQuit()
})

// 兜底：若所有窗口都自然关闭了（如桌宠未启用），也走退出流程
app.on('window-all-closed', async () => {
  if (_quitting) return
  await performQuit()
})
app.on('activate', () => {
  // macOS: 点击 dock 图标时重新创建窗口
  const mainWindow = config.getMainWindow()
  if (mainWindow === null) {
    windows.createMainWindow()
  }
})

// ========== 错误处理 ==========

process.on('uncaughtException', (error) => {
  console.error('[Main] 未捕获异常:', error)
})

process.on('unhandledRejection', (reason, promise) => {
  console.error('[Main] 未处理的 Promise 拒绝:', reason)
})
