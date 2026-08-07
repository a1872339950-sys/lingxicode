/**
 * IPC路由注册模块
 * 统一注册所有IPC通道
 */

const { dialog } = require('electron')
const skills = require('./skills')
const plugins = require('./plugins')
const projects = require('./projects')
const windows = require('./windows')
const aiChat = require('./ai-chat')
const git = require('./git')
const plans = require('./plans')
const config = require('./config')
const storageConfig = require('./storage-config')  // 存储配置模块
const changeSessions = require('./change-sessions')
const tools = require('./tools')
const terminalSessions = require('./terminal-sessions')
const blenderControl = require('./blender-control')
const pathPermissions = require('./path-permissions')
const softwareAccess = require('./software-access')
const observability = require('./observability')
const lingxiUpdater = require('./lingxi-updater')
const agentCollaboration = require('./agent-collaboration')
const agentCollaborationReports = require('./agent-collaboration-reports')
const aiOperationMemoIpc = require('./ai-operation-memos/ipc')
const projectSkillDrafts = require('./project-skill-drafts')
const recoveryPoints = require('./recovery-points')
const mcpIntegration = require('./mcp-integration')
const projectErrorScan = require('./project-error-scan')
const assetLibrary = require('./asset-library')
const agentWorkflows = require('./agent-workflows')
const projectWorktrees = require('./project-worktrees')
const cloudTokenUsage = require('./cloud-token-usage')
const modelConnectionTest = require('./model-connection-test')

/**
 * 注册所有IPC handlers
 */
function registerAllIPC(ipcMain) {
  const observedIpcMain = observability.wrapIpcMain(ipcMain)
  cloudTokenUsage.registerIPC(observedIpcMain)
  modelConnectionTest.registerIPC(observedIpcMain)

  // 技能系统 IPC
  skills.registerSkillsIPC(observedIpcMain)

  // 插件商城 IPC
  plugins.registerPluginsIPC(observedIpcMain)

  // 桌宠 IPC
  try {
    require('./desktop-pet').registerDesktopPetIPC(observedIpcMain)
  } catch (e) {
    console.warn('[IPC] desktop-pet register failed:', e.message)
  }

  // 桌面操控（开关 / 授权 / 状态层）
  try {
    require('./desktop-control').registerDesktopControlIPC(observedIpcMain)
  } catch (e) {
    console.warn('[IPC] desktop-control register failed:', e.message)
  }

  // 能力开关（用户可见总控）
  try {
    require('./feature-settings').registerFeatureSettingsIPC(observedIpcMain)
  } catch (e) {
    console.warn('[IPC] feature-settings register failed:', e.message)
  }

  // 对话内可视化
  try {
    require('./inline-visualize').registerInlineVisualizeIPC(observedIpcMain)
  } catch (e) {
    console.warn('[IPC] inline-visualize register failed:', e.message)
  }

  // 项目管理 IPC
  projects.registerProjectsIPC(observedIpcMain)

  // 窗口管理 IPC
  windows.registerWindowIPC(observedIpcMain)

  // AI对话 IPC
  aiChat.registerChatIPC(observedIpcMain)

  // 智能执行询问回传 IPC
  tools.registerToolAskIPC(observedIpcMain)

  // Git版本管理 IPC
  git.registerGitIPC(observedIpcMain)

  // 方案管理 IPC
  plans.registerPlansIPC(observedIpcMain)

  // AI 本轮文件修改记录 IPC
  changeSessions.registerChangeSessionIPC(observedIpcMain)
  terminalSessions.registerTerminalIPC(observedIpcMain)
  blenderControl.registerBlenderIPC(observedIpcMain)
  pathPermissions.registerIPC(observedIpcMain, dialog)
  softwareAccess.registerIPC(observedIpcMain, dialog)
  lingxiUpdater.registerIPC(observedIpcMain)
  agentCollaboration.registerIPC(observedIpcMain)
  agentCollaborationReports.registerIPC(observedIpcMain)
  aiOperationMemoIpc.registerIPC(observedIpcMain)
  projectSkillDrafts.registerIPC(observedIpcMain)
  recoveryPoints.registerIPC(observedIpcMain)
  mcpIntegration.registerIPC(observedIpcMain)
  projectErrorScan.registerIPC(observedIpcMain)
  assetLibrary.registerIPC(observedIpcMain)
  agentWorkflows.registerIPC(observedIpcMain)
  projectWorktrees.registerIPC(observedIpcMain)

  // 存储配置 IPC（统一路径管理）
  storageConfig.registerIPC(observedIpcMain, dialog)
  observability.registerIPC(observedIpcMain)

  // 杂项 IPC
  // 消息注入：前端把排队消息发送到聊天区后，通知主进程注入运行时上下文
  // payload: { projectId, itemId, content, createdAt }
  // ai-chat.js 会维护 pendingInterjectMap，在下一次模型继续请求前消费
  ipcMain.on('notify-interject-message', (event, payload = {}) => {
    try {
      const { projectId, itemId, content, createdAt } = payload || {}
      if (!projectId || !content) return
      if (typeof aiChat.enqueueInterjectMessage === 'function') {
        aiChat.enqueueInterjectMessage({ projectId, itemId, content, createdAt })
        console.log(`[IPC] notify-interject-message dispatched project=${projectId} itemId=${itemId}`)
      } else {
        console.warn(`[IPC] notify-interject-message enqueueInterjectMessage is not a function, type=${typeof aiChat.enqueueInterjectMessage}, aiChat keys=${Object.keys(aiChat||{}).filter(k => k.includes('nterject')).join(',')}`)
      }
    } catch (e) {
      console.warn('[IPC] notify-interject-message failed:', e.message)
    }
  })

  // i18n：用户切换界面语言
  // 前端通过 window.api.setLanguage(lang) 触发，影响后续 system prompt
  ipcMain.handle('set-language', (event, lang) => {
    if (typeof aiChat.setUserLanguage === 'function') {
      const ok = aiChat.setUserLanguage(lang)
      console.log('[IPC] set-language:', lang, ok ? 'OK' : 'INVALID')
      return { ok, lang: aiChat.getUserLanguage ? aiChat.getUserLanguage() : 'zh-CN' }
    }
    return { ok: false, lang: 'zh-CN' }
  })

  // 行为风格：用户在设置界面切换 AI 思考/回复风格
  // 前端通过 window.api.getBehaviorStyle()/setBehaviorStyle(cfg) 调用
  if (typeof aiChat.readBehaviorStyleConfig === 'function') {
    try { aiChat.readBehaviorStyleConfig() } catch (_) { /* 行为风格配置读取失败 */ }
  }
  ipcMain.handle('get-behavior-style', () => {
    try {
      return { ok: true, data: aiChat.readBehaviorStyleConfig() }
    } catch (e) {
      return { ok: false, error: e.message, data: { enabled: false, style: 'standard' } }
    }
  })
  ipcMain.handle('set-behavior-style', (event, cfg) => {
    try {
      const data = aiChat.applyBehaviorStyleConfig(cfg || {})
      console.log('[IPC] set-behavior-style:', JSON.stringify(data))
      return { ok: true, data }
    } catch (e) {
      return { ok: false, error: e.message }
    }
  })

  // ===== 远程桥接管理 IPC =====
  ipcMain.handle('remote-bridge:status', () => {
    const remoteBridge = require('./remote-bridge')
    return remoteBridge.getStatus()
  })
  ipcMain.handle('remote-bridge:generate-pin', () => {
    const remoteBridge = require('./remote-bridge')
    return remoteBridge.generatePin()
  })
  ipcMain.handle('remote-bridge:start', (_, options) => {
    const remoteBridge = require('./remote-bridge')
    remoteBridge.start(options)
    return remoteBridge.getStatus()
  })
  ipcMain.handle('remote-bridge:stop', () => {
    const remoteBridge = require('./remote-bridge')
    remoteBridge.stop()
    return { running: false }
  })
  ipcMain.handle('remote-bridge:attach', () => {
    const remoteBridge = require('./remote-bridge')
    const mainWindow = config.getMainWindow()
    if (mainWindow?.webContents) {
      remoteBridge.attachWebContents(mainWindow.webContents)
    }
    return remoteBridge.getStatus()
  })
  ipcMain.handle('remote-bridge:list-devices', () => {
    const remoteBridge = require('./remote-bridge')
    return remoteBridge.listDevices()
  })
  ipcMain.handle('remote-bridge:revoke-device', (_, tokenPrefix) => {
    const remoteBridge = require('./remote-bridge')
    return remoteBridge.revokeDevice(tokenPrefix)
  })

  // 强制把主窗口焦点拉回渲染进程，修复系统 confirm 关闭后输入框无法点选
  ipcMain.handle('window:focus-main', (event) => {
    try {
      const { BrowserWindow } = require('electron')
      const win = BrowserWindow.fromWebContents(event.sender) || config.getMainWindow()
      if (!win || win.isDestroyed()) return { success: false, error: 'window missing' }
      if (win.isMinimized()) win.restore()
      if (!win.isVisible()) win.show()
      win.focus()
      try { win.webContents?.focus?.() } catch (_) {}
      return { success: true }
    } catch (error) {
      return { success: false, error: error?.message || String(error) }
    }
  })

  // 右侧外部 webview 使用的标准 Chrome UA（与主进程伪装一致）
  ipcMain.handle('webview:get-chrome-user-agent', () => {
    try {
      const externalWebviewSession = require('./external-webview-session')
      return {
        success: true,
        userAgent: externalWebviewSession.getChromeLikeUserAgent(),
        chromeVersion: externalWebviewSession.getChromeVersion()
      }
    } catch (error) {
      return { success: false, error: error?.message || String(error) }
    }
  })

  // Google 登录：应用内顶层窗口（同 partition，非系统浏览器）
  try {
    require('./google-login-window').registerGoogleLoginIPC(ipcMain)
  } catch (error) {
    console.warn('[IPC] google-login-window register failed:', error.message)
  }

  // 对照 Codex profile importer：从本机 Chrome 导入 Google Cookie 到右侧 webview
  try {
    require('./browser-profile-import').registerBrowserProfileImportIPC(ipcMain)
  } catch (error) {
    console.warn('[IPC] browser-profile-import register failed:', error.message)
  }

  // 书签管理
  try {
    require('./bookmarks').registerBookmarksIPC(ipcMain)
  } catch (error) {
    console.warn('[IPC] bookmarks register failed:', error.message)
  }

  // 在外部浏览器中打开 URL
  ipcMain.handle('shell:open-external', (event, url) => {
    try {
      const { shell } = require('electron')
      if (!url || typeof url !== 'string') return { success: false, error: '无效的 URL' }
      shell.openExternal(url)
      return { success: true }
    } catch (error) {
      return { success: false, error: error?.message || String(error) }
    }
  })

  console.log('[IPC] 所有IPC通道已注册')
}

module.exports = {
  registerAllIPC
}
