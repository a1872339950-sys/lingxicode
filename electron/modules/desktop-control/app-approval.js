/**
 * 桌面操控：首次触达应用时的授权（一次 / 本会话 / 始终）
 */

const path = require('path')
const config = require('../config')
const projects = require('../projects')
const pathPermissions = require('../path-permissions')
const session = require('./session')
const settings = require('./settings')

const APPROVAL_TIMEOUT_MS = 90 * 1000

function createAskRequestId(projectId, type) {
  return `${projectId || 'global'}:${type}:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 8)}`
}

function resolveAppIdentity(input = {}) {
  const windowRef = input.window || {}
  const executable = String(
    input.executable_path
    || input.executablePath
    || input.path
    || windowRef.executable_path
    || windowRef.executablePath
    || ''
  ).trim()
  const appName = String(
    input.app
    || input.name
    || windowRef.app
    || (executable ? path.basename(executable) : '')
    || windowRef.title
    || ''
  ).trim()
  const appKey = executable
    ? settings.normalizeAppKey(executable)
    : settings.normalizeAppKey(appName)
  return {
    appKey,
    executable,
    displayName: appName || (executable ? path.basename(executable) : '未知应用')
  }
}

async function ensureAppApproval(projectId, input = {}) {
  const identity = resolveAppIdentity(input)
  if (pathPermissions.getSettings().mode === 'full') {
    return { success: true, skipped: true, reason: 'full_access_mode', app: identity }
  }
  if (!identity.appKey && !identity.executable && !identity.displayName) {
    return { success: true, skipped: true, reason: 'no_app_identity' }
  }

  // 系统常见安全目标（记事本等）仍走授权，但 list 不调用本函数
  if (session.isAppAllowed(identity.appKey || identity.executable || identity.displayName)) {
    return {
      success: true,
      skipped: true,
      reason: 'already_allowed',
      app: identity
    }
  }

  const webContents = projectId
    ? projects.getWebContentsForProject(projectId)
    : config.getMainWindow()?.webContents
  if (!webContents || webContents.isDestroyed?.()) {
    return {
      success: false,
      rejected: true,
      error: '需要用户授权操控该应用，但没有可用确认窗口',
      app: identity
    }
  }

  const requestId = createAskRequestId(projectId, 'desktop_control_app')
  const label = identity.displayName || identity.executable || identity.appKey
  const tools = require('../tools')
  const responsePromise = tools.waitForAskResponse(projectId, requestId, APPROVAL_TIMEOUT_MS)
  webContents.send('show-ask-popup', {
    requestId,
    type: 'desktop_control_app_approval',
    projectId,
    toolName: 'desktop_control',
    question: `AI 请求操控应用「${label}」，是否允许？`,
    detail: {
      app: label,
      executable: identity.executable || identity.appKey,
      reason: input.confirm_reason || input.method || ''
    },
    options: [
      { label: '仅本次', value: 'once', desc: '只允许这一次动作。' },
      { label: '本会话允许', value: 'session', desc: '当前对话会话内不再询问此应用。' },
      { label: '始终允许', value: 'always', desc: '以后默认允许操控此应用。' },
      { label: '不允许', value: 'rejected', desc: '拒绝本次桌面操控。' }
    ],
    recommended: 'session'
  })

  let response
  try {
    response = await responsePromise
  } catch (error) {
    return {
      success: false,
      rejected: true,
      approval_timeout: true,
      retryable: true,
      error: '桌面操控应用授权未完成：' + (error?.message || '等待授权响应超时'),
      next_action: 'tell_user_desktop_control_approval_was_not_received_then_retry',
      app: identity
    }
  }
  const value = String(response.value || response.answer || '')
  if (!response.success || value === 'rejected' || value === 'not_now' || !value) {
    return {
      success: false,
      rejected: true,
      error: `用户拒绝操控应用「${label}」`,
      app: identity,
      response
    }
  }

  const appRef = identity.executable || identity.appKey || identity.displayName
  if (value === 'always') {
    session.allowAppAlways(appRef)
  } else if (value === 'session') {
    session.allowAppSession(appRef)
  }
  // once: 不写入 allowlist，仅本次放行

  return {
    success: true,
    once: value === 'once',
    session: value === 'session',
    always: value === 'always',
    app: identity,
    response
  }
}

module.exports = {
  resolveAppIdentity,
  ensureAppApproval
}
