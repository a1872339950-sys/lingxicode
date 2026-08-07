/**
 * 桌面操控高风险动作确认
 */

const config = require('../config')
const projects = require('../projects')
const pathPermissions = require('../path-permissions')

const CONFIRMATION_TIMEOUT_MS = 90 * 1000

const HIGH_RISK_PATTERNS = [
  /删除|卸载|清空|格式化|wipe|delete|uninstall|remove\s+all|format/i,
  /安装|install|setup\.exe|msiexec/i,
  /支付|付款|转账|汇款|checkout|payment|purchase|subscribe|订阅/i,
  /发送|提交|发布|post|send|submit|tweet|发帖|邮件|email/i,
  /密码|password|api[_\s-]?key|token|secret|身份证|银行卡/i,
  /权限|管理员|administrator|uac|注册表|registry|组策略/i,
  /验证码|captcha/i
]

const ALWAYS_CONFIRM_OPERATIONS = new Set([
  'delete',
  'uninstall',
  'install',
  'submit',
  'send',
  'purchase'
])

function createAskRequestId(projectId, type) {
  return `${projectId || 'global'}:${type}:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 8)}`
}

function classifyRisk(input = {}) {
  const operation = String(input.operation || input.action || input.method || 'invoke').toLowerCase()
  const text = [
    input.name,
    input.text,
    input.value,
    input.key,
    input.confirm_reason,
    input.locator?.name,
    input.element?.name,
    operation
  ].filter(Boolean).join(' ')

  if (ALWAYS_CONFIRM_OPERATIONS.has(operation)) {
    return { level: 'always_confirm', reason: `operation=${operation}`, patterns: [operation] }
  }

  // Never allow Win/Meta injection as low-risk
  if (/(^|\+)(meta|super|win|windows|cmd|command|os)(\+|$)/i.test(String(input.key || ''))) {
    return { level: 'always_confirm', reason: 'blocked_windows_key', patterns: ['win/meta'] }
  }

  const matched = HIGH_RISK_PATTERNS.filter(re => re.test(text)).map(re => String(re))
  if (matched.length) {
    return { level: 'always_confirm', reason: 'matched_high_risk_keywords', patterns: matched }
  }

  if (input.force_confirm === true || input.require_confirmation === true) {
    return { level: 'always_confirm', reason: 'explicit_force_confirm', patterns: [] }
  }

  return { level: 'none', reason: 'low_risk_desktop_action', patterns: [] }
}

function waitForPopup(projectId, requestId, timeoutMs = CONFIRMATION_TIMEOUT_MS) {
  // 与 tools.js 的 ask-popup IPC 共用挂起表
  const tools = require('../tools')
  return tools.waitForAskResponse(projectId, requestId, timeoutMs)
}

async function ensureActionConfirmation(projectId, detail = {}) {
  const risk = classifyRisk(detail)
  if (pathPermissions.getSettings().mode === 'full') {
    return { success: true, skipped: true, reason: 'full_access_mode', risk }
  }
  if (risk.level === 'none') {
    return { success: true, skipped: true, risk }
  }

  const webContents = projectId
    ? projects.getWebContentsForProject(projectId)
    : config.getMainWindow()?.webContents
  if (!webContents || webContents.isDestroyed?.()) {
    return {
      success: false,
      rejected: true,
      error: '需要用户确认高风险桌面动作，但没有可用确认窗口',
      risk
    }
  }

  const requestId = createAskRequestId(projectId, 'desktop_control_confirm')
  const windowLabel = detail.window?.title || detail.window?.app || detail.window?.id || '未知窗口'
  const op = detail.operation || detail.action || 'invoke'
  const target = detail.name || detail.element_index != null
    ? `元素 ${detail.name || '#' + detail.element_index}`
    : '目标控件'

  const responsePromise = waitForPopup(projectId, requestId)
  webContents.send('show-ask-popup', {
    requestId,
    type: 'desktop_control_confirm',
    projectId,
    toolName: 'desktop_control',
    question: `AI 即将在「${windowLabel}」执行可能敏感的桌面操作（${op} / ${target}），是否允许？`,
    detail: {
      operation: op,
      window: windowLabel,
      reason: risk.reason,
      valuePreview: detail.value ? String(detail.value).slice(0, 80) : ''
    },
    options: [
      { label: '允许本次操作', value: 'allow_once', desc: '只允许这一次高风险动作。' },
      { label: '不允许', value: 'rejected', desc: '拒绝本次桌面操作。' }
    ],
    recommended: 'rejected'
  })

  let response
  try {
    response = await responsePromise
  } catch (error) {
    return {
      success: false,
      rejected: true,
      confirmation_timeout: true,
      retryable: true,
      error: '桌面操控敏感操作确认未完成：' + (error?.message || '等待确认响应超时'),
      next_action: 'tell_user_desktop_control_confirmation_was_not_received_then_retry',
      risk
    }
  }
  const value = String(response.value || response.answer || '')
  if (!response.success || value === 'rejected' || value === 'not_now') {
    return {
      success: false,
      rejected: true,
      error: '用户拒绝了高风险桌面操作',
      risk,
      response
    }
  }
  return { success: true, once: true, risk, response }
}

module.exports = {
  HIGH_RISK_PATTERNS,
  classifyRisk,
  ensureActionConfirmation
}
