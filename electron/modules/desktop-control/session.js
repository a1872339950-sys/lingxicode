/**
 * 桌面操控运行会话：活动状态、会话级授权、Esc 中断
 */

const path = require('path')
const settings = require('./settings')

/** @type {Map<string, true>} session-scoped allowed apps */
const sessionAllowedApps = new Map()

let active = false
let interrupted = false
let interruptReason = ''
let lastActivityAt = 0
let lastTargetLabel = ''
let lastAppKey = ''
let lastMethod = ''
let lastActionLabel = ''
let phase = 'idle'
let activityStartedAt = 0
let lastCompletedAt = 0
let lastSuccess = null
let lastError = ''
let idleTimer = null
let onInterruptedHandlers = []
let onActivityHandlers = []

const IDLE_HIDE_MS = 3200
const ERROR_HIDE_MS = 7000
const ACTION_STALE_MS = 60000

function normalizeAppKey(value = '') {
  return settings.normalizeAppKey(value)
}

function isInterrupted() {
  return interrupted === true
}

function getInterruptInfo() {
  if (!interrupted) return null
  return {
    interrupted: true,
    reason: interruptReason || 'user_stopped',
    message: interruptReason === 'escape'
      ? '用户按下 Esc 停止了桌面操控。请停止继续调用 desktop_control，并在最终回复中说明已中断。'
      : (interruptReason || '桌面操控已被中断')
  }
}

function clearInterrupt() {
  interrupted = false
  interruptReason = ''
  if (phase === 'interrupted') phase = 'idle'
}

function interrupt(reason = 'escape') {
  interrupted = true
  interruptReason = String(reason || 'user_stopped')
  active = false
  phase = 'interrupted'
  lastSuccess = false
  lastError = interruptReason === 'escape' ? '用户按下 Esc 停止了桌面操控' : '用户已停止桌面操控'
  lastActivityAt = Date.now()
  lastCompletedAt = lastActivityAt
  if (idleTimer) {
    clearTimeout(idleTimer)
    idleTimer = null
  }
  const info = { ...getInterruptInfo(), ...getStatus(), kind: 'interrupted', at: lastActivityAt }
  for (const fn of onInterruptedHandlers) {
    try { fn(info) } catch (_) { /* ignore */ }
  }
  return info
}

function isAppAllowed(appRef = '') {
  const key = normalizeAppKey(appRef)
  if (!key) return true // 无目标路径时不拦（list 等）
  if (settings.isAppAlwaysAllowed(key)) return true
  if (sessionAllowedApps.has(key)) return true
  // basename match for session
  const base = path.basename(key.replace(/^process:/i, ''))
  for (const k of sessionAllowedApps.keys()) {
    if (path.basename(String(k).replace(/^process:/i, '')) === base) return true
  }
  return false
}

function allowAppSession(appRef = '') {
  const key = normalizeAppKey(appRef)
  if (key) sessionAllowedApps.set(key, true)
  return key
}

function allowAppAlways(appRef = '') {
  const key = normalizeAppKey(appRef)
  if (key) {
    sessionAllowedApps.set(key, true)
    settings.allowAppAlways(key)
  }
  return key
}

function emitActivity(meta = {}) {
  const payload = { ...getStatus(), ...meta, at: meta.at || Date.now() }
  for (const fn of onActivityHandlers) {
    try { fn(payload) } catch (_) { /* ignore */ }
  }
}

function markActivity(meta = {}) {
  const wasActive = active
  active = true
  phase = String(meta.phase || 'working')
  lastActivityAt = Date.now()
  if (!wasActive || !activityStartedAt) activityStartedAt = lastActivityAt
  if (meta.app) lastAppKey = normalizeAppKey(meta.app)
  if (meta.label) lastTargetLabel = String(meta.label)
  if (meta.method) lastMethod = String(meta.method)
  if (meta.actionLabel) lastActionLabel = String(meta.actionLabel)
  lastSuccess = null
  lastError = ''
  emitActivity({ ...meta, kind: 'started', at: lastActivityAt })
  scheduleIdleHide(ACTION_STALE_MS)
}

function markResult(meta = {}) {
  active = false
  lastActivityAt = Date.now()
  lastCompletedAt = lastActivityAt
  if (meta.method) lastMethod = String(meta.method)
  if (meta.actionLabel) lastActionLabel = String(meta.actionLabel)
  lastSuccess = meta.success !== false
  lastError = lastSuccess ? '' : String(meta.error || '桌面操作失败')
  phase = lastSuccess ? 'completed' : 'error'
  emitActivity({ ...meta, kind: 'result', success: lastSuccess, error: lastError, at: lastActivityAt })
  scheduleIdleHide(lastSuccess ? IDLE_HIDE_MS : ERROR_HIDE_MS)
}

function scheduleIdleHide(delay = IDLE_HIDE_MS) {
  if (idleTimer) clearTimeout(idleTimer)
  const scheduledAt = lastActivityAt
  idleTimer = setTimeout(() => {
    idleTimer = null
    if (lastActivityAt !== scheduledAt) return
    active = false
    phase = 'idle'
    emitActivity({ kind: 'idle', idle: true, at: Date.now() })
  }, delay)
  if (typeof idleTimer.unref === 'function') idleTimer.unref()
}

function endActivity() {
  active = false
  phase = 'idle'
  if (idleTimer) {
    clearTimeout(idleTimer)
    idleTimer = null
  }
  emitActivity({ kind: 'ended', ended: true, at: Date.now() })
}

function isActive() {
  return active === true
}

function getStatus() {
  return {
    active,
    interrupted,
    interruptReason,
    lastActivityAt,
    lastTargetLabel,
    lastAppKey,
    lastMethod,
    lastActionLabel,
    phase,
    activityStartedAt,
    lastCompletedAt,
    lastSuccess,
    lastError,
    elapsedMs: activityStartedAt ? Math.max(0, Date.now() - activityStartedAt) : 0,
    sessionAllowedCount: sessionAllowedApps.size,
    enabled: settings.isEnabled()
  }
}

/** 新用户回合开始时调用：清中断、结束上一轮活动 */
function onUserTurnStart() {
  clearInterrupt()
  endActivity()
}

function onInterrupted(fn) {
  if (typeof fn === 'function') onInterruptedHandlers.push(fn)
  return () => {
    onInterruptedHandlers = onInterruptedHandlers.filter(h => h !== fn)
  }
}

function onActivity(fn) {
  if (typeof fn === 'function') onActivityHandlers.push(fn)
  return () => {
    onActivityHandlers = onActivityHandlers.filter(h => h !== fn)
  }
}

function clearSessionAllowlist() {
  sessionAllowedApps.clear()
}

function resetForTests() {
  sessionAllowedApps.clear()
  active = false
  interrupted = false
  interruptReason = ''
  lastActivityAt = 0
  lastTargetLabel = ''
  lastAppKey = ''
  lastMethod = ''
  lastActionLabel = ''
  phase = 'idle'
  activityStartedAt = 0
  lastCompletedAt = 0
  lastSuccess = null
  lastError = ''
  if (idleTimer) clearTimeout(idleTimer)
  idleTimer = null
}

module.exports = {
  isInterrupted,
  getInterruptInfo,
  clearInterrupt,
  interrupt,
  isAppAllowed,
  allowAppSession,
  allowAppAlways,
  markActivity,
  markResult,
  endActivity,
  isActive,
  getStatus,
  onUserTurnStart,
  onInterrupted,
  onActivity,
  clearSessionAllowlist,
  resetForTests,
  normalizeAppKey
}
