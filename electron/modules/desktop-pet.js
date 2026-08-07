/**
 * 灵犀桌宠
 * - 设置里开关 / 选角色 / 调大小
 * - 桌面置顶悬浮窗播放 2D 角色动画
 * - 跟随 AI 会话状态切换动作，并在角色上方显示状态托盘
 * - 角色来源：data/characters、项目 assets/characters
 */

const { BrowserWindow, screen, ipcMain } = require('electron')
const fs = require('fs')
const path = require('path')
const storageConfig = require('./storage-config')
const previewCore = require('./character-animation-preview')

const PREVIEW_HTML = path.join(__dirname, 'character-animation-preview.html')
const CONFIG_NAME = 'desktop-pet.json'

/** 图集单元格设计尺寸（宽×高），用于换算显示比例 */
const SPRITE_CELL_W = 192
const SPRITE_CELL_H = 208

/** 角色显示宽度（px）：默认 112，可调 80–224 */
const MASCOT_WIDTH_DEFAULT = 112
const MASCOT_WIDTH_MIN = 80
const MASCOT_WIDTH_MAX = 224

/**
 * AI 会话状态 → 桌宠动作 + 托盘文案
 * 动作名对应角色图集/帧序列；托盘与角色分离展示。
 */
const STATUS_PRESENTATION = {
  idle: {
    action: 'idle',
    tone: 'idle',
    label: null,
    body: null
  },
  running: {
    action: 'running',
    tone: 'busy',
    label: '忙碌中',
    body: '思考中'
  },
  thinking: {
    action: 'running',
    tone: 'busy',
    label: '忙碌中',
    body: '思考中'
  },
  tools: {
    action: 'running',
    tone: 'busy',
    label: '忙碌中',
    body: '处理中'
  },
  streaming: {
    action: 'running',
    tone: 'busy',
    label: '忙碌中',
    body: '回复中'
  },
  waiting: {
    action: 'waiting',
    tone: 'wait',
    label: '需要确认',
    body: '等待你的输入'
  },
  failed: {
    action: 'failed',
    tone: 'error',
    label: '受阻',
    body: '任务遇到问题'
  },
  error: {
    action: 'failed',
    tone: 'error',
    label: '受阻',
    body: '任务遇到问题'
  },
  review: {
    action: 'review',
    tone: 'done',
    label: '已完成',
    body: '可以查看结果'
  },
  done: {
    action: 'review',
    tone: 'done',
    label: '已完成',
    body: '可以查看结果'
  },
  waving: {
    action: 'waving',
    tone: 'idle',
    label: null,
    body: null
  }
}

const STATUS_ACTION_MAP = Object.fromEntries(
  Object.entries(STATUS_PRESENTATION).map(([k, v]) => [k, v.action])
)

let petWindow = null
let petMeta = null
let currentStatus = 'idle'
let registered = false
let thinkingBuffer = ''
let thinkingFlushTimer = null
let trayVisible = false
/** 拖拽 / 点击跳跃期间暂不让 AI 状态抢动作 */
let interactionLock = null // 'drag' | 'jump' | null
let settleTimer = null
let dragSession = null

function clampMascotWidth(value) {
  const n = Number(value)
  if (!Number.isFinite(n)) return MASCOT_WIDTH_DEFAULT
  return Math.round(Math.min(MASCOT_WIDTH_MAX, Math.max(MASCOT_WIDTH_MIN, n)))
}

function scaleFromMascotWidth(widthPx) {
  return clampMascotWidth(widthPx) / SPRITE_CELL_W
}

function mascotHeightFromWidth(widthPx) {
  const w = clampMascotWidth(widthPx)
  return Math.round(w * (SPRITE_CELL_H / SPRITE_CELL_W))
}

function defaultConfig() {
  return {
    enabled: false,
    characterId: '',
    characterPath: '',
    followAiStatus: true,
    mascotWidthPx: MASCOT_WIDTH_DEFAULT,
    // 兼容旧字段：若只有 scale 会在 load 时换算
    scale: scaleFromMascotWidth(MASCOT_WIDTH_DEFAULT),
    bounds: null
  }
}

function getConfigPath() {
  return path.join(storageConfig.getConfigDir(), CONFIG_NAME)
}

function normalizeConfig(raw = {}) {
  const base = defaultConfig()
  const merged = { ...base, ...raw }
  if (raw.mascotWidthPx == null && Number.isFinite(Number(raw.scale)) && Number(raw.scale) > 0) {
    merged.mascotWidthPx = clampMascotWidth(Number(raw.scale) * SPRITE_CELL_W)
  } else {
    merged.mascotWidthPx = clampMascotWidth(merged.mascotWidthPx)
  }
  merged.scale = scaleFromMascotWidth(merged.mascotWidthPx)
  merged.followAiStatus = merged.followAiStatus !== false
  return merged
}

function loadConfig() {
  try {
    const p = getConfigPath()
    if (!fs.existsSync(p)) return defaultConfig()
    const data = JSON.parse(fs.readFileSync(p, 'utf8'))
    return normalizeConfig(data)
  } catch {
    return defaultConfig()
  }
}

function saveConfig(partial = {}) {
  const next = normalizeConfig({ ...loadConfig(), ...partial })
  const dir = storageConfig.getConfigDir()
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(getConfigPath(), JSON.stringify(next, null, 2), 'utf8')
  return next
}

function exists(p) {
  try {
    return !!(p && fs.existsSync(p))
  } catch {
    return false
  }
}

function readCharacterMeta(dir) {
  for (const name of ['character.json', 'pet.json']) {
    const fp = path.join(dir, name)
    if (!exists(fp)) continue
    try {
      return JSON.parse(fs.readFileSync(fp, 'utf8'))
    } catch {
      /* ignore */
    }
  }
  return null
}

function hasPlayableAssets(dir) {
  if (!exists(dir)) return false
  const sheet = ['spritesheet.webp', 'spritesheet.png', 'sheet.webp', 'sheet.png']
    .map(n => path.join(dir, n))
    .some(exists)
  if (sheet) return true
  if (exists(path.join(dir, 'sheet', 'spritesheet.webp'))) return true
  if (exists(path.join(dir, 'frames'))) return true
  const meta = readCharacterMeta(dir)
  if (meta?.spritesheetPath) {
    const sp = path.isAbsolute(meta.spritesheetPath)
      ? meta.spritesheetPath
      : path.join(dir, meta.spritesheetPath)
    if (exists(sp)) return true
  }
  return false
}

function scanCharactersDir(baseDir, source) {
  if (!exists(baseDir)) return []
  const out = []
  for (const name of fs.readdirSync(baseDir, { withFileTypes: true })) {
    if (!name.isDirectory()) continue
    const dir = path.join(baseDir, name.name)
    if (!hasPlayableAssets(dir)) continue
    const meta = readCharacterMeta(dir) || {}
    out.push({
      id: meta.id || name.name,
      displayName: meta.displayName || meta.id || name.name,
      description: meta.description || '',
      path: dir,
      source
    })
  }
  return out
}

function listCharacters(projectPath = '') {
  const list = []
  try {
    const dataChars = path.join(storageConfig.getBasePath(), 'characters')
    list.push(...scanCharactersDir(dataChars, 'lingxi-data'))
  } catch (_) { /* ignore */ }

  if (projectPath) {
    const candidates = [
      path.join(projectPath, 'assets', 'characters'),
      path.join(projectPath, 'characters')
    ]
    for (const c of candidates) {
      list.push(...scanCharactersDir(c, 'project'))
    }
  }

  const seen = new Set()
  return list.filter(item => {
    const key = path.resolve(item.path).toLowerCase()
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function resolveActiveCharacterPath(cfg = loadConfig(), projectPath = '') {
  if (cfg.characterPath && exists(cfg.characterPath)) return cfg.characterPath
  const chars = listCharacters(projectPath)
  if (cfg.characterId) {
    const hit = chars.find(c => c.id === cfg.characterId)
    if (hit) return hit.path
  }
  if (chars.length) return chars[0].path
  return ''
}

function pickActionForStatus(status, availableActions = []) {
  const key = String(status || 'idle').toLowerCase()
  const preferred = STATUS_ACTION_MAP[key] || 'idle'
  if (availableActions.includes(preferred)) return preferred
  const fallbacks = {
    running: ['running', 'running-right', 'idle'],
    waiting: ['waiting', 'idle'],
    failed: ['failed', 'idle'],
    review: ['review', 'idle'],
    waving: ['waving', 'idle'],
    idle: ['idle']
  }
  const chain = fallbacks[preferred] || ['idle']
  for (const a of chain) {
    if (availableActions.includes(a)) return a
  }
  return availableActions[0] || 'idle'
}

function getPresentation(status) {
  const key = String(status || 'idle').toLowerCase()
  return STATUS_PRESENTATION[key] || STATUS_PRESENTATION.idle
}

/**
 * 合成窗口尺寸：
 * - 角色区：按 mascot 宽高 + 边距
 * - 托盘展开时：上方预留状态条区域
 */
function computeWindowSize(mascotWidthPx, { tray = false } = {}) {
  const mw = clampMascotWidth(mascotWidthPx)
  const mh = mascotHeightFromWidth(mw)
  const padX = 16
  const padY = 12
  const trayH = tray ? 88 : 0
  const trayW = tray ? Math.max(220, Math.min(320, mw + 140)) : 0
  const width = Math.max(mw + padX * 2, trayW + padX)
  const height = mh + padY * 2 + trayH + (tray ? 8 : 0)
  return { width, height, mascotWidth: mw, mascotHeight: mh }
}

function ensurePetWindow() {
  if (petWindow && !petWindow.isDestroyed()) return petWindow

  const cfg = loadConfig()
  const display = screen.getPrimaryDisplay()
  const work = display.workArea
  const size = computeWindowSize(cfg.mascotWidthPx, { tray: false })
  let x = work.x + work.width - size.width - 20
  let y = work.y + work.height - size.height - 20

  const old = cfg.bounds
  // 忽略过大的历史窗口，只保留位置
  if (old && Number.isFinite(old.x) && Number.isFinite(old.y)) {
    x = old.x
    y = old.y
  }

  const preloadPath = path.join(__dirname, 'desktop-pet-preload.js')
  petWindow = new BrowserWindow({
    width: size.width,
    height: size.height,
    x,
    y,
    show: false,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    hasShadow: false,
    title: '灵犀桌宠',
    webPreferences: {
      preload: preloadPath,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: false,
      backgroundThrottling: false
    }
  })

  petWindow.setAlwaysOnTop(true, 'floating')
  petWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  petWindow.setMinimumSize(100, 120)

  petWindow.on('moved', () => {
    if (!petWindow || petWindow.isDestroyed()) return
    // 程序改 bounds 时也会触发；仅在非拖拽会话时持久化，避免高频写盘
    if (dragSession) return
    const b = petWindow.getBounds()
    saveConfig({ bounds: { ...b } })
  })
  petWindow.on('closed', () => {
    petWindow = null
    petMeta = null
    trayVisible = false
    interactionLock = null
    dragSession = null
    if (settleTimer) {
      clearTimeout(settleTimer)
      settleTimer = null
    }
  })

  return petWindow
}

function pickDragAction(dx, availableActions = []) {
  const right = 'running-right'
  const left = 'running-left'
  const generic = 'running'
  if (dx >= 0) {
    if (availableActions.includes(right)) return right
    if (availableActions.includes(generic)) return generic
  } else {
    if (availableActions.includes(left)) return left
    if (availableActions.includes(generic)) return generic
  }
  return pickActionForStatus(currentStatus, availableActions)
}

async function restoreActionAfterInteraction() {
  interactionLock = null
  if (!petWindow || petWindow.isDestroyed()) return
  const actions = petMeta?.actions || []
  const actionId = pickActionForStatus(currentStatus, actions)
  try {
    await setPetAction(actionId, { force: true })
  } catch (_) { /* ignore */ }
}

/**
 * 处理渲染进程自定义拖拽：按位移播 running-left/right；单击播 jumping
 */
function handlePetDragMessage(payload = {}) {
  if (!petWindow || petWindow.isDestroyed()) return
  const phase = String(payload.phase || '')
  const screenX = Number(payload.screenX)
  const screenY = Number(payload.screenY)
  const actions = petMeta?.actions || []

  if (phase === 'start') {
    const b = petWindow.getBounds()
    dragSession = {
      offsetX: Number.isFinite(screenX) ? screenX - b.x : 0,
      offsetY: Number.isFinite(screenY) ? screenY - b.y : 0,
      lastScreenX: screenX,
      moved: false
    }
    return
  }

  if (phase === 'move' && dragSession) {
    if (!Number.isFinite(screenX) || !Number.isFinite(screenY)) return
    const dxTotal = screenX - (dragSession.lastScreenX || screenX)
    const nextX = Math.round(screenX - dragSession.offsetX)
    const nextY = Math.round(screenY - dragSession.offsetY)
    const b = petWindow.getBounds()
    if (Math.abs(nextX - b.x) > 1 || Math.abs(nextY - b.y) > 1) {
      dragSession.moved = true
      interactionLock = 'drag'
      petWindow.setBounds({
        x: nextX,
        y: nextY,
        width: b.width,
        height: b.height
      }, false)
      const actionId = pickDragAction(dxTotal || (nextX - b.x), actions)
      setPetAction(actionId, { force: true }).catch(() => {})
      dragSession.lastScreenX = screenX
    }
    return
  }

  if (phase === 'end') {
    const moved = !!(dragSession && dragSession.moved)
    if (dragSession) {
      const b = petWindow.getBounds()
      saveConfig({ bounds: { ...b } })
    }
    dragSession = null

    if (moved) {
      restoreActionAfterInteraction()
      return
    }

    // 单击：跳跃后回到当前会话态动作
    if (actions.includes('jumping')) {
      interactionLock = 'jump'
      setPetAction('jumping', { force: true }).catch(() => {})
      setTimeout(() => {
        restoreActionAfterInteraction()
      }, 700)
    } else {
      restoreActionAfterInteraction()
    }
  }
}

function applyWindowSize({ tray = trayVisible } = {}) {
  if (!petWindow || petWindow.isDestroyed()) return
  const cfg = loadConfig()
  const size = computeWindowSize(cfg.mascotWidthPx, { tray })
  const b = petWindow.getBounds()
  // 右下锚点，扩展/收缩时角色脚底不漂移
  const x = b.x + b.width - size.width
  const y = b.y + b.height - size.height
  petWindow.setBounds({
    x,
    y,
    width: size.width,
    height: size.height
  }, true)
  trayVisible = !!tray
}

async function pushActivityTray(payload) {
  if (!petWindow || petWindow.isDestroyed()) return { ok: false }
  const hasContent = !!(payload && (payload.label || payload.body))
  applyWindowSize({ tray: hasContent })
  try {
    await petWindow.webContents.executeJavaScript(
      `window.setActivityTray && window.setActivityTray(${JSON.stringify(payload || null)})`
    )
  } catch (e) {
    console.warn('[DesktopPet] setActivityTray failed:', e.message)
  }
  return { ok: true }
}

async function showPet(options = {}) {
  const cfg = loadConfig()
  const projectPath = options.projectPath || ''
  const charPath = options.path || resolveActiveCharacterPath(cfg, projectPath)
  if (!charPath) {
    return {
      success: false,
      message: '没有可用角色。请先用「角色动画」插件制作并放到 data/characters 或项目 assets/characters'
    }
  }

  const mascotWidthPx = clampMascotWidth(options.mascotWidthPx || cfg.mascotWidthPx)
  const scale = scaleFromMascotWidth(mascotWidthPx)

  const rootDir = previewCore.resolveCharacterRoot(charPath, projectPath)
  const payload = previewCore.buildPayloadFromRoot(rootDir, {
    action: options.action || pickActionForStatus(currentStatus),
    scale
  })
  payload.petMode = true
  payload.displayName = payload.displayName || '灵犀桌宠'
  payload.mascotWidthPx = mascotWidthPx
  payload.cellWidth = payload.cellWidth || SPRITE_CELL_W
  payload.cellHeight = payload.cellHeight || SPRITE_CELL_H

  const win = ensurePetWindow()
  trayVisible = false
  applyWindowSize({ tray: false })
  await win.loadFile(PREVIEW_HTML)
  await win.webContents.executeJavaScript(`window.boot(${JSON.stringify(payload)})`)
  if (!win.isVisible()) {
    if (typeof win.showInactive === 'function') win.showInactive()
    else win.show()
  }

  petMeta = {
    rootDir: payload.rootDir,
    displayName: payload.displayName,
    id: payload.id,
    actionId: payload.actionId,
    actions: payload.actions.map(a => a.id)
  }

  // 恢复后若有当前状态，立刻刷一次托盘
  const presentation = getPresentation(currentStatus)
  if (presentation.label || presentation.body) {
    await setPetAction(pickActionForStatus(currentStatus, petMeta.actions))
    await pushActivityTray({
      label: presentation.label,
      body: presentation.body,
      tone: presentation.tone
    })
  }

  const nextCfg = saveConfig({
    enabled: true,
    characterId: payload.id,
    characterPath: payload.rootDir,
    mascotWidthPx,
    scale,
    bounds: win.getBounds()
  })

  return {
    success: true,
    open: true,
    message: `桌宠已开启：${payload.displayName}`,
    config: nextCfg,
    character: petMeta
  }
}

async function hidePet({ persistDisable = false } = {}) {
  if (petWindow && !petWindow.isDestroyed()) {
    petWindow.close()
  }
  petWindow = null
  petMeta = null
  trayVisible = false
  thinkingBuffer = ''
  if (thinkingFlushTimer) {
    clearTimeout(thinkingFlushTimer)
    thinkingFlushTimer = null
  }
  if (persistDisable) {
    saveConfig({ enabled: false })
  }
  return {
    success: true,
    open: false,
    message: persistDisable ? '桌宠已关闭' : '桌宠窗口已隐藏',
    config: loadConfig()
  }
}

async function setPetAction(actionId, options = {}) {
  if (!petWindow || petWindow.isDestroyed()) {
    return { success: false, open: false, message: '桌宠未打开' }
  }
  // 拖拽/跳跃中，AI 状态切换不抢动作（强制除外）
  if (interactionLock && !options.force) {
    return { success: true, open: true, skipped: true, reason: 'interaction-lock', action: actionId }
  }
  const id = String(actionId || '').trim()
  if (!id) return { success: false, message: '缺少 action' }
  await petWindow.webContents.executeJavaScript(
    `window.setPreviewAction(${JSON.stringify(id)})`
  )
  if (petMeta) petMeta.actionId = id
  return { success: true, open: true, action: id }
}

function getStatus() {
  const cfg = loadConfig()
  const open = !!(petWindow && !petWindow.isDestroyed())
  return {
    success: true,
    open,
    enabled: !!cfg.enabled,
    followAiStatus: cfg.followAiStatus !== false,
    characterId: cfg.characterId,
    characterPath: cfg.characterPath,
    mascotWidthPx: cfg.mascotWidthPx,
    status: currentStatus,
    actionId: petMeta?.actionId || null,
    config: cfg,
    character: petMeta
  }
}

async function setEnabled(enabled, options = {}) {
  if (enabled) {
    return showPet(options)
  }
  return hidePet({ persistDisable: true })
}

async function selectCharacter(characterPathOrId, projectPath = '') {
  const chars = listCharacters(projectPath)
  let hit = chars.find(c => c.path === characterPathOrId || c.id === characterPathOrId)
  if (!hit && characterPathOrId && exists(characterPathOrId)) {
    hit = {
      id: path.basename(characterPathOrId),
      path: characterPathOrId,
      displayName: path.basename(characterPathOrId)
    }
  }
  if (!hit) {
    return { success: false, message: `未找到角色: ${characterPathOrId}` }
  }
  saveConfig({
    characterId: hit.id,
    characterPath: hit.path
  })
  const cfg = loadConfig()
  if (cfg.enabled || (petWindow && !petWindow.isDestroyed())) {
    return showPet({ path: hit.path, projectPath })
  }
  return { success: true, message: `已选择角色：${hit.displayName || hit.id}`, config: cfg, character: hit }
}

function clearSettleTimer() {
  if (settleTimer) {
    clearTimeout(settleTimer)
    settleTimer = null
  }
}

/**
 * 回合结束：完成/失败展示一段时间后回到 idle 并收起托盘
 */
function scheduleSettleToIdle(delayMs = 4500) {
  clearSettleTimer()
  settleTimer = setTimeout(async () => {
    settleTimer = null
    if (currentStatus === 'done' || currentStatus === 'review' || currentStatus === 'failed') {
      thinkingBuffer = ''
      await notifyAiStatus('idle')
      await clearThinkingText()
    }
  }, Math.max(800, delayMs))
}

/**
 * 最终回复完成或失败后的桌宠收束
 * success=true → review/已完成；false → 受阻（若尚未是 failed 则写入）
 */
async function notifyTurnComplete(options = {}) {
  const success = options.success !== false
  clearSettleTimer()
  thinkingBuffer = ''
  if (thinkingFlushTimer) {
    clearTimeout(thinkingFlushTimer)
    thinkingFlushTimer = null
  }

  if (success) {
    await notifyAiStatus('done')
    scheduleSettleToIdle(options.holdMs || 4800)
  } else {
    if (currentStatus !== 'failed' && currentStatus !== 'error') {
      await notifyAiStatus('failed')
    } else {
      // 已是失败态，确保托盘仍在
      await notifyAiStatus('failed')
    }
    scheduleSettleToIdle(options.holdMs || 6500)
  }
  return { ok: true, success }
}

async function notifyAiStatus(status) {
  currentStatus = String(status || 'idle').toLowerCase()
  // 新忙碌态取消「完成后回 idle」定时器，避免迟到清空
  if (currentStatus === 'running' || currentStatus === 'thinking' || currentStatus === 'tools' || currentStatus === 'streaming' || currentStatus === 'waiting') {
    clearSettleTimer()
  }

  const cfg = loadConfig()
  if (!cfg.enabled || cfg.followAiStatus === false) return { ok: true, skipped: true }
  if (!petWindow || petWindow.isDestroyed()) {
    return { ok: true, skipped: true, reason: 'window-closed' }
  }

  const presentation = getPresentation(currentStatus)
  const actions = petMeta?.actions || []
  const actionId = pickActionForStatus(currentStatus, actions)

  try {
    await setPetAction(actionId)

    if (presentation.label || presentation.body) {
      // 忙碌态：有深度思考缓冲时用缓冲正文；完成/失败用固定文案
      const busy = currentStatus === 'running' || currentStatus === 'thinking' || currentStatus === 'tools' || currentStatus === 'streaming'
      const body = busy && thinkingBuffer
        ? (thinkingBuffer.length > 120 ? '…' + thinkingBuffer.slice(-110) : thinkingBuffer)
        : presentation.body
      await pushActivityTray({
        label: presentation.label,
        body,
        tone: presentation.tone,
        // 完成/失败托盘稍长驻留；忙碌由思考流持续刷新
        ttlMs: (currentStatus === 'done' || currentStatus === 'review' || currentStatus === 'failed')
          ? 12000
          : 16000
      })
    } else if (currentStatus === 'idle') {
      // idle：立刻收起托盘
      await clearThinkingText()
    }

    return { ok: true, actionId, status: currentStatus }
  } catch (e) {
    return { ok: false, error: e.message }
  }
}

async function clearThinkingText() {
  thinkingBuffer = ''
  if (thinkingFlushTimer) {
    clearTimeout(thinkingFlushTimer)
    thinkingFlushTimer = null
  }
  if (!petWindow || petWindow.isDestroyed()) return { ok: true }
  await pushActivityTray(null)
  return { ok: true }
}

/**
 * 是否把文案送进桌宠托盘：
 * - 仅深度思考（reasoning）
 * - 短状态句 / 工具进度播报不展示
 */
function shouldShowThinkingOnPet(text, options = {}) {
  const kind = options.kind || 'generic'
  const chunk = String(text || '').trim()
  if (!chunk) return false
  // 深度思考：始终展示
  if (kind === 'reasoning' || options.isReasoningSummary === true) return true
  // 进度、协作状态、短 generic：不进托盘
  if (kind === 'progress' || kind === 'status') return false
  // 其它：过短视为短思考块，忽略
  if (chunk.length < 40) return false
  // 明显是 UI 短状态模板
  if (/^(思考中|正在|处理中|请稍候|加载中)/.test(chunk) && chunk.length < 64) return false
  return false
}

/**
 * 深度思考文案 → 状态托盘正文（短思考块会被过滤）
 */
function notifyThinking(text, options = {}) {
  const cfg = loadConfig()
  if (!cfg.enabled || cfg.followAiStatus === false) return { ok: true, skipped: true }
  if (!petWindow || petWindow.isDestroyed()) return { ok: true, skipped: true }

  if (!shouldShowThinkingOnPet(text, options)) {
    return { ok: true, skipped: true, reason: 'filtered-short-or-non-deep' }
  }

  const chunk = String(text || '').trim()
  const append = options.append === true
  if (append) thinkingBuffer = (thinkingBuffer + chunk).slice(-420)
  else thinkingBuffer = chunk.slice(-420)

  const display = thinkingBuffer.length > 140
    ? '…' + thinkingBuffer.slice(-130)
    : thinkingBuffer

  const label = options.label || '深度思考'
  const tone = options.tone || 'busy'

  if (thinkingFlushTimer) clearTimeout(thinkingFlushTimer)
  thinkingFlushTimer = setTimeout(async () => {
    thinkingFlushTimer = null
    if (!petWindow || petWindow.isDestroyed()) return
    // 思考中自动切到忙碌动作
    if (currentStatus === 'idle' || currentStatus === 'done' || currentStatus === 'review') {
      currentStatus = 'thinking'
      const actionId = pickActionForStatus('thinking', petMeta?.actions || [])
      try { await setPetAction(actionId) } catch (_) { /* ignore */ }
    }
    await pushActivityTray({ label, body: display, tone, ttlMs: 16000 })
  }, 80)

  return { ok: true }
}

async function restoreIfEnabled() {
  const cfg = loadConfig()
  if (!cfg.enabled) return { restored: false }
  try {
    await showPet({})
    return { restored: true }
  } catch (e) {
    console.warn('[DesktopPet] restore failed:', e.message)
    return { restored: false, error: e.message }
  }
}

function registerDesktopPetIPC(ipcMainRef = ipcMain) {
  if (registered) return
  registered = true
  ipcMainRef.handle('desktop-pet:getConfig', () => ({ ok: true, data: loadConfig() }))
  ipcMainRef.handle('desktop-pet:setConfig', async (event, partial) => {
    const data = saveConfig(partial || {})
    // 已打开时即时应用尺寸
    if (petWindow && !petWindow.isDestroyed() && partial && partial.mascotWidthPx != null) {
      try {
        await showPet({})
      } catch (_) { /* ignore */ }
    }
    return { ok: true, data }
  })
  ipcMainRef.handle('desktop-pet:listCharacters', (event, projectPath = '') => {
    return { ok: true, characters: listCharacters(projectPath || '') }
  })
  ipcMainRef.handle('desktop-pet:getStatus', () => getStatus())
  ipcMainRef.handle('desktop-pet:setEnabled', async (event, enabled, options = {}) => {
    return setEnabled(!!enabled, options || {})
  })
  ipcMainRef.handle('desktop-pet:selectCharacter', async (event, characterPathOrId, projectPath = '') => {
    return selectCharacter(characterPathOrId, projectPath)
  })
  ipcMainRef.handle('desktop-pet:show', async (event, options = {}) => showPet(options || {}))
  ipcMainRef.handle('desktop-pet:hide', async (event, persistDisable = false) => hidePet({ persistDisable: !!persistDisable }))
  ipcMainRef.handle('desktop-pet:setAction', async (event, actionId) => setPetAction(actionId))
  ipcMainRef.handle('desktop-pet:notifyStatus', async (event, status) => notifyAiStatus(status))
  ipcMainRef.handle('desktop-pet:notifyThinking', async (event, text, options = {}) => notifyThinking(text, options || {}))
  ipcMainRef.handle('desktop-pet:notifyTurnComplete', async (event, options = {}) => notifyTurnComplete(options || {}))
  ipcMainRef.on('desktop-pet:drag', (event, payload) => {
    try {
      // 仅接受桌宠窗发来的拖拽
      if (!petWindow || petWindow.isDestroyed()) return
      if (event.sender !== petWindow.webContents) return
      handlePetDragMessage(payload || {})
    } catch (e) {
      console.warn('[DesktopPet] drag handle failed:', e.message)
    }
  })
}

module.exports = {
  loadConfig,
  saveConfig,
  listCharacters,
  showPet,
  hidePet,
  setEnabled,
  selectCharacter,
  setPetAction,
  getStatus,
  notifyAiStatus,
  notifyThinking,
  notifyTurnComplete,
  clearThinkingText,
  restoreIfEnabled,
  registerDesktopPetIPC,
  shouldShowThinkingOnPet,
  // 测试/内部
  clampMascotWidth,
  MASCOT_WIDTH_DEFAULT,
  MASCOT_WIDTH_MIN,
  MASCOT_WIDTH_MAX,
  STATUS_PRESENTATION
}
