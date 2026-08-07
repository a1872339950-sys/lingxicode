/**
 * 角色动画桌面悬浮预览（类似桌宠窗口）
 * - open / close / set_action / status
 * - 支持 spritesheet 图集 或 frames 序列
 */

const { BrowserWindow, screen } = require('electron')
const fs = require('fs')
const path = require('path')
const config = require('./config')

const PREVIEW_HTML = path.join(__dirname, 'character-animation-preview.html')

/** 通用 8 列×9 行角色图集默认动作行（仅当 character.json 未声明 actions 时使用） */
const DEFAULT_ATLAS_ACTIONS = [
  { id: 'idle', row: 0, frameCount: 6, durationsMs: [280, 110, 110, 140, 140, 320] },
  { id: 'running-right', row: 1, frameCount: 8, durationsMs: [120, 120, 120, 120, 120, 120, 120, 220] },
  { id: 'running-left', row: 2, frameCount: 8, durationsMs: [120, 120, 120, 120, 120, 120, 120, 220] },
  { id: 'waving', row: 3, frameCount: 4, durationsMs: [140, 140, 140, 280] },
  { id: 'jumping', row: 4, frameCount: 5, durationsMs: [140, 140, 140, 140, 280] },
  { id: 'failed', row: 5, frameCount: 8, durationsMs: [140, 140, 140, 140, 140, 140, 140, 240] },
  { id: 'waiting', row: 6, frameCount: 6, durationsMs: [150, 150, 150, 150, 150, 260] },
  { id: 'running', row: 7, frameCount: 6, durationsMs: [120, 120, 120, 120, 120, 220] },
  { id: 'review', row: 8, frameCount: 6, durationsMs: [150, 150, 150, 150, 150, 280] }
]

let previewWindow = null
let currentMeta = null

function exists(p) {
  try {
    return !!(p && fs.existsSync(p))
  } catch {
    return false
  }
}

function toFileUrl(filePath) {
  const resolved = path.resolve(filePath)
  let pathname = resolved.replace(/\\/g, '/')
  if (!pathname.startsWith('/')) pathname = '/' + pathname
  return encodeURI(`file://${pathname}`)
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'))
}

function resolveCharacterRoot(inputPath = '', projectPath = '') {
  let target = String(inputPath || '').trim()
  if (!target) {
    throw new Error('缺少 path：角色目录、character.json 或 spritesheet 路径')
  }
  if (!path.isAbsolute(target) && projectPath) {
    target = path.resolve(projectPath, target)
  } else {
    target = path.resolve(target)
  }
  if (!exists(target)) {
    throw new Error(`路径不存在: ${target}`)
  }

  const stat = fs.statSync(target)
  if (stat.isDirectory()) return target
  if (path.basename(target).toLowerCase() === 'character.json' || path.basename(target).toLowerCase() === 'pet.json') {
    return path.dirname(target)
  }
  // spritesheet file
  if (/\.(webp|png|gif|jpg|jpeg)$/i.test(target)) {
    return path.dirname(target)
  }
  return target
}

function listFrameUrls(dir) {
  if (!exists(dir)) return []
  return fs
    .readdirSync(dir)
    .filter(name => /\.(png|webp|gif|jpg|jpeg)$/i.test(name))
    .sort()
    .map(name => toFileUrl(path.join(dir, name)))
}

function buildPayloadFromRoot(rootDir, options = {}) {
  const jsonPath = [
    path.join(rootDir, 'character.json'),
    path.join(rootDir, 'pet.json')
  ].find(exists)

  let meta = {}
  if (jsonPath) {
    try {
      meta = readJson(jsonPath)
    } catch (e) {
      meta = {}
    }
  }

  const displayName = meta.displayName || meta.id || path.basename(rootDir)
  const id = meta.id || path.basename(rootDir)
  const scale = Number(options.scale) > 0 ? Number(options.scale) : 1.6

  // 1) frames/<action>/...
  const framesRoot = path.join(rootDir, 'frames')
  if (exists(framesRoot)) {
    const actionDirs = fs.readdirSync(framesRoot, { withFileTypes: true }).filter(d => d.isDirectory())
    const actions = []
    for (const d of actionDirs) {
      const urls = listFrameUrls(path.join(framesRoot, d.name))
      if (!urls.length) continue
      const declared = Array.isArray(meta.actions)
        ? meta.actions.find(a => a.id === d.name)
        : null
      actions.push({
        id: d.name,
        label: declared?.label || d.name,
        frameUrls: urls,
        fps: declared?.fps || 10,
        durationsMs: declared?.durationsMs
      })
    }
    if (actions.length) {
      const actionId = options.action || actions[0].id
      return {
        mode: 'frames',
        id,
        displayName,
        actionId,
        scale,
        actions,
        rootDir
      }
    }
  }

  // 2) character.json actions with relative frame paths
  if (Array.isArray(meta.actions) && meta.actions.some(a => Array.isArray(a.frames) && a.frames.length)) {
    const actions = meta.actions
      .map(a => {
        const frameUrls = (a.frames || [])
          .map(rel => {
            const abs = path.isAbsolute(rel) ? rel : path.join(rootDir, rel)
            return exists(abs) ? toFileUrl(abs) : null
          })
          .filter(Boolean)
        if (!frameUrls.length) return null
        return {
          id: a.id,
          label: a.label || a.id,
          frameUrls,
          fps: a.fps || 10,
          durationsMs: a.durationsMs
        }
      })
      .filter(Boolean)
    if (actions.length) {
      return {
        mode: 'frames',
        id,
        displayName,
        actionId: options.action || actions[0].id,
        scale,
        actions,
        rootDir
      }
    }
  }

  // 3) spritesheet atlas
  const sheetName = meta.spritesheetPath || 'spritesheet.webp'
  const sheetPath = path.isAbsolute(sheetName) ? sheetName : path.join(rootDir, sheetName)
  if (!exists(sheetPath)) {
    // try common names
    const fallback = ['spritesheet.webp', 'spritesheet.png', 'sheet.webp', 'sheet.png']
      .map(n => path.join(rootDir, n))
      .find(exists)
    if (!fallback) {
      throw new Error(`未找到可预览资源（frames/ 或 spritesheet）: ${rootDir}`)
    }
    return buildAtlasPayload(rootDir, fallback, meta, options, scale, id, displayName)
  }
  return buildAtlasPayload(rootDir, sheetPath, meta, options, scale, id, displayName)
}

function buildAtlasPayload(rootDir, sheetPath, meta, options, scale, id, displayName) {
  const cellWidth = meta.cellWidth || meta.cell_width || 192
  const cellHeight = meta.cellHeight || meta.cell_height || 208
  const columns = meta.columns || 8

  let actions
  if (Array.isArray(meta.atlasActions) && meta.atlasActions.length) {
    actions = meta.atlasActions.map(a => ({
      id: a.id,
      label: a.label || a.id,
      row: a.row ?? 0,
      frameCount: a.frameCount || a.frames || 6,
      durationsMs: a.durationsMs,
      fps: a.fps
    }))
  } else if (Array.isArray(meta.actions) && meta.actions.some(a => a.row != null)) {
    actions = meta.actions.map(a => ({
      id: a.id,
      label: a.label || a.id,
      row: a.row ?? 0,
      frameCount: a.frameCount || (Array.isArray(a.frames) ? a.frames.length : 6),
      durationsMs: a.durationsMs,
      fps: a.fps
    }))
  } else {
    actions = DEFAULT_ATLAS_ACTIONS.map(a => ({ ...a, label: a.id }))
  }

  return {
    mode: 'atlas',
    id,
    displayName,
    actionId: options.action || actions[0].id,
    scale,
    cellWidth,
    cellHeight,
    columns,
    sheetUrl: toFileUrl(sheetPath),
    actions,
    rootDir,
    sheetPath
  }
}

function ensureWindow() {
  if (previewWindow && !previewWindow.isDestroyed()) return previewWindow

  const display = screen.getPrimaryDisplay()
  const work = display.workArea
  // 预览窗可稍大以便看清控制条；桌宠用更小独立窗口
  const width = 300
  const height = 340
  const x = work.x + work.width - width - 24
  const y = work.y + work.height - height - 24

  previewWindow = new BrowserWindow({
    width,
    height,
    x,
    y,
    show: false,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: false,
    hasShadow: false,
    title: '角色动画预览',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: false
    }
  })

  previewWindow.setAlwaysOnTop(true, 'floating')
  previewWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })

  previewWindow.on('closed', () => {
    previewWindow = null
    currentMeta = null
  })

  return previewWindow
}

async function openPreview(args = {}, ctx = {}) {
  const projectPath = ctx.projectPath || args.projectPath || ''
  const rootDir = resolveCharacterRoot(args.path || args.character_path || args.dir, projectPath)
  const payload = buildPayloadFromRoot(rootDir, {
    action: args.action || args.action_id || '',
    scale: args.scale || 1.2
  })
  // 预览模式：显示底栏；桌宠模式由 desktop-pet 单独窗口处理
  payload.petMode = false

  const win = ensureWindow()
  await win.loadFile(PREVIEW_HTML)
  await win.webContents.executeJavaScript(`window.boot(${JSON.stringify(payload)})`)
  if (!win.isVisible()) win.show()
  win.focus()

  currentMeta = {
    rootDir: payload.rootDir,
    displayName: payload.displayName,
    id: payload.id,
    actionId: payload.actionId,
    mode: payload.mode,
    actions: payload.actions.map(a => a.id)
  }

  return {
    success: true,
    open: true,
    message: `已打开角色动画预览：${payload.displayName}（${payload.actionId}）`,
    path: payload.rootDir,
    displayName: payload.displayName,
    action: payload.actionId,
    actions: currentMeta.actions,
    mode: payload.mode
  }
}

async function closePreview() {
  if (previewWindow && !previewWindow.isDestroyed()) {
    previewWindow.close()
  }
  previewWindow = null
  currentMeta = null
  return { success: true, open: false, message: '已关闭角色动画预览' }
}

async function setAction(args = {}) {
  if (!previewWindow || previewWindow.isDestroyed()) {
    return { success: false, open: false, message: '预览窗口未打开，请先 open' }
  }
  const actionId = String(args.action || args.action_id || '').trim()
  if (!actionId) return { success: false, message: '缺少 action' }
  const result = await previewWindow.webContents.executeJavaScript(
    `window.setPreviewAction(${JSON.stringify(actionId)})`
  )
  if (currentMeta) currentMeta.actionId = actionId
  return {
    success: true,
    open: true,
    action: actionId,
    result,
    message: `已切换动作：${actionId}`
  }
}

function getStatus() {
  const open = !!(previewWindow && !previewWindow.isDestroyed())
  return {
    success: true,
    open,
    ...(currentMeta || {}),
    message: open ? `预览中：${currentMeta?.displayName || ''} / ${currentMeta?.actionId || ''}` : '预览未打开'
  }
}

async function handlePreviewTool(args = {}, ctx = {}) {
  const action = String(args.action || args.op || 'open').trim().toLowerCase()
  try {
    if (action === 'open' || action === 'show' || action === 'start') {
      return await openPreview(args, ctx)
    }
    if (action === 'close' || action === 'hide' || action === 'stop') {
      return await closePreview()
    }
    if (action === 'set_action' || action === 'action' || action === 'switch') {
      return await setAction(args)
    }
    if (action === 'status' || action === 'state') {
      return getStatus()
    }
    return { success: false, message: `未知 action: ${action}（可用 open/close/set_action/status）` }
  } catch (e) {
    return { success: false, message: e.message || String(e) }
  }
}

/**
 * 写入角色动画产物后自动打开预览（防抖，避免连写多次狂弹窗）
 * 触发：character.json / pet.json / spritesheet.(webp|png)
 */
let autoOpenTimer = null
let lastAutoOpenKey = ''
function maybeAutoOpenFromWrittenFile(filePath, projectPath = '') {
  try {
    if (!filePath || typeof filePath !== 'string') return
    const abs = path.resolve(filePath)
    const base = path.basename(abs).toLowerCase()
    const isMeta = base === 'character.json' || base === 'pet.json'
    const isSheet = /^(spritesheet|sheet)\.(webp|png)$/i.test(base)
    if (!isMeta && !isSheet) return

    const rootDir = path.dirname(abs)
    // 元数据写入时若还没有 sheet/frames，稍后再开；sheet 写入即可开
    if (isMeta) {
      const sheetCandidates = [
        path.join(rootDir, 'spritesheet.webp'),
        path.join(rootDir, 'spritesheet.png'),
        path.join(rootDir, 'sheet', 'spritesheet.webp'),
        path.join(rootDir, 'sheet', 'spritesheet.png')
      ]
      const framesDir = path.join(rootDir, 'frames')
      const hasSheet = sheetCandidates.some(exists)
      const hasFrames = exists(framesDir)
      if (!hasSheet && !hasFrames) return
    }

    const key = rootDir.toLowerCase()
    lastAutoOpenKey = key
    if (autoOpenTimer) clearTimeout(autoOpenTimer)
    autoOpenTimer = setTimeout(() => {
      autoOpenTimer = null
      if (lastAutoOpenKey !== key) return
      openPreview({ path: rootDir }, { projectPath: projectPath || '' }).catch((err) => {
        console.warn('[CharacterAnimationPreview] auto-open failed:', err.message)
      })
    }, 600)
  } catch (e) {
    console.warn('[CharacterAnimationPreview] auto-open schedule failed:', e.message)
  }
}

module.exports = {
  openPreview,
  closePreview,
  setAction,
  getStatus,
  handlePreviewTool,
  maybeAutoOpenFromWrittenFile,
  resolveCharacterRoot,
  buildPayloadFromRoot
}
