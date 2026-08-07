/**
 * 桌面操控用户配置：总开关、叠加层、应用白名单
 */

const fs = require('fs')
const path = require('path')
const storageConfig = require('../storage-config')

const FILE_NAME = 'desktop-control.json'
const VERSION = 1

const DEFAULTS = {
  version: VERSION,
  /** 是否允许模型使用 desktop_control（默认关闭，需用户在设置中开启） */
  enabled: false,
  /** 操控时是否显示全屏状态反馈 */
  showOverlay: true,
  /** 是否允许 Esc 中断本轮操控 */
  escToCancel: true,
  /** 始终允许的应用（executable path 或 process:path） */
  alwaysAllowedApps: [],
  /** 自定义状态文案 */
  strings: {
    usingComputer: '灵犀正在使用你的电脑',
    escToCancel: 'Esc 取消'
  },
  accentColor: '#6366f1'
}

function getStorePath() {
  try {
    const configDir = storageConfig.getConfigDir()
    if (configDir) return path.join(configDir, FILE_NAME)
  } catch (_) { /* not ready */ }
  return path.join(process.cwd(), '.lingxi', 'config', FILE_NAME)
}

function normalizeAppKey(value = '') {
  const raw = String(value || '').trim()
  if (!raw) return ''
  if (/^process:/i.test(raw)) {
    const rest = raw.slice('process:'.length).trim()
    return rest ? `process:${path.resolve(rest).toLowerCase()}` : ''
  }
  // bare exe name
  if (!/[\\/]/.test(raw) && /\.exe$/i.test(raw)) {
    return raw.toLowerCase()
  }
  try {
    return path.resolve(raw).toLowerCase()
  } catch {
    return raw.toLowerCase()
  }
}

function normalizeAppList(list = []) {
  const out = []
  const seen = new Set()
  for (const item of Array.isArray(list) ? list : []) {
    const key = normalizeAppKey(item)
    if (!key || seen.has(key)) continue
    seen.add(key)
    out.push(key)
  }
  return out
}

function readStore() {
  try {
    const filePath = getStorePath()
    if (!fs.existsSync(filePath)) return { ...DEFAULTS, alwaysAllowedApps: [] }
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'))
    return {
      ...DEFAULTS,
      ...data,
      version: VERSION,
      enabled: data.enabled === true,
      showOverlay: data.showOverlay !== false,
      escToCancel: data.escToCancel !== false,
      alwaysAllowedApps: normalizeAppList(data.alwaysAllowedApps),
      strings: {
        ...DEFAULTS.strings,
        ...(data.strings && typeof data.strings === 'object' ? data.strings : {})
      },
      accentColor: String(data.accentColor || DEFAULTS.accentColor)
    }
  } catch {
    return { ...DEFAULTS, alwaysAllowedApps: [] }
  }
}

function writeStore(store) {
  const filePath = getStorePath()
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  const payload = {
    version: VERSION,
    enabled: store.enabled === true,
    showOverlay: store.showOverlay !== false,
    escToCancel: store.escToCancel !== false,
    alwaysAllowedApps: normalizeAppList(store.alwaysAllowedApps),
    strings: {
      usingComputer: store.strings?.usingComputer || DEFAULTS.strings.usingComputer,
      escToCancel: store.strings?.escToCancel || DEFAULTS.strings.escToCancel
    },
    accentColor: String(store.accentColor || DEFAULTS.accentColor),
    updatedAt: Date.now()
  }
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), 'utf8')
  return payload
}

function getSettings() {
  return readStore()
}

function isEnabled() {
  return getSettings().enabled === true
}

function saveSettings(partial = {}) {
  const current = readStore()
  const next = {
    ...current,
    ...partial,
    alwaysAllowedApps: partial.alwaysAllowedApps != null
      ? normalizeAppList(partial.alwaysAllowedApps)
      : current.alwaysAllowedApps,
    strings: partial.strings
      ? { ...current.strings, ...partial.strings }
      : current.strings
  }
  return writeStore(next)
}

function setEnabled(enabled) {
  return saveSettings({ enabled: !!enabled })
}

function isAppAlwaysAllowed(appRef = '') {
  const key = normalizeAppKey(appRef)
  if (!key) return false
  const list = getSettings().alwaysAllowedApps || []
  if (list.includes(key)) return true
  // bare name match
  const base = path.basename(key.replace(/^process:/i, ''))
  return list.some(item => path.basename(String(item).replace(/^process:/i, '')) === base)
}

function allowAppAlways(appRef = '') {
  const key = normalizeAppKey(appRef)
  if (!key) return getSettings()
  const current = readStore()
  if (!current.alwaysAllowedApps.includes(key)) {
    current.alwaysAllowedApps.push(key)
  }
  return writeStore(current)
}

function revokeAppAlways(appRef = '') {
  const key = normalizeAppKey(appRef)
  const current = readStore()
  current.alwaysAllowedApps = (current.alwaysAllowedApps || []).filter(item => item !== key)
  return writeStore(current)
}

function clearAlwaysAllowed() {
  return saveSettings({ alwaysAllowedApps: [] })
}

module.exports = {
  DEFAULTS,
  getSettings,
  saveSettings,
  setEnabled,
  isEnabled,
  normalizeAppKey,
  isAppAlwaysAllowed,
  allowAppAlways,
  revokeAppAlways,
  clearAlwaysAllowed,
  getStorePath
}
