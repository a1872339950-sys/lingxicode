/**
 * 截图工具处理器
 * 包含：capture_screenshot 工具及相关辅助函数
 */

const fs = require('fs')
const path = require('path')
const { BrowserWindow, desktopCapturer } = require('electron')
const sharp = require('sharp')
const config = require('../config')
const storageConfig = require('../storage-config')
const runtimeTargets = require('../runtime-targets')

const SCREENSHOT_MAX_AGE_MS = 24 * 60 * 60 * 1000
const SCREENSHOT_CLEANUP_INTERVAL_MS = 10 * 60 * 1000
let lastScreenshotCleanupAt = 0

function ensureScreenshotDir() {
  const screenshotDir = path.join(storageConfig.getCacheDir(), 'screenshots')
  if (!fs.existsSync(screenshotDir)) {
    fs.mkdirSync(screenshotDir, { recursive: true })
  }
  cleanupExpiredScreenshots(screenshotDir)
  return screenshotDir
}

function cleanupExpiredScreenshots(screenshotDir) {
  const now = Date.now()
  if (now - lastScreenshotCleanupAt < SCREENSHOT_CLEANUP_INTERVAL_MS) return
  lastScreenshotCleanupAt = now

  try {
    for (const fileName of fs.readdirSync(screenshotDir)) {
      if (!/^screenshot-.*\.png$/i.test(fileName)) continue
      const filePath = path.join(screenshotDir, fileName)
      const stat = fs.statSync(filePath)
      if (!stat.isFile()) continue
      if (now - stat.mtimeMs > SCREENSHOT_MAX_AGE_MS) {
        fs.unlinkSync(filePath)
      }
    }
  } catch (error) {
    console.warn('[Tools] 清理过期截图缓存失败:', error.message)
  }
}

function imageDataUrl(filePath, mime = 'image/png') {
  return `data:${mime};base64,${fs.readFileSync(filePath).toString('base64')}`
}

function normalizeTimestampForFile(date = new Date()) {
  const pad = value => String(value).padStart(2, '0')
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    '-',
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds())
  ].join('')
}

async function buildImagePreviewPayload(filePath, options = {}) {
  const metadata = await sharp(filePath).metadata()
  const thumbWidth = Number(options.thumbWidth) || 420
  const thumbnailBuffer = await sharp(filePath)
    .rotate()
    .resize({ width: thumbWidth, withoutEnlargement: true })
    .png()
    .toBuffer()
  const thumbnailMetadata = await sharp(thumbnailBuffer).metadata()
  return {
    width: metadata.width || null,
    height: metadata.height || null,
    format: metadata.format || path.extname(filePath).replace('.', ''),
    thumbnailDataUrl: `data:image/png;base64,${thumbnailBuffer.toString('base64')}`,
    thumbnailWidth: thumbnailMetadata.width || null,
    thumbnailHeight: thumbnailMetadata.height || null
  }
}

function normalizeScreenshotUrl(args = {}, resolvePath = input => input) {
  if (args.url) return String(args.url)
  const htmlPath = args.html_path || args.htmlPath || args.path
  if (!htmlPath) return ''
  const resolved = resolvePath(htmlPath)
  if (!fs.existsSync(resolved)) {
    throw new Error(`目标 HTML 文件不存在: ${resolved}`)
  }
  return `file:///${resolved.replace(/\\/g, '/')}`
}

function hasRuntimeTargetSelector(args = {}) {
  return !!(
    args.runtime_id || args.runtimeId ||
    args.webContentsId || args.web_contents_id || args.target_web_contents_id ||
    args.target || args.window ||
    args.window_title || args.windowTitle || args.title_hint || args.titleHint ||
    args.runtime_url || args.runtimeUrl || args.url_hint || args.urlHint ||
    args.tab_id || args.tabId
  )
}

function resolveTargetWebContents(args = {}) {
  const target = String(args.target || args.window || '').toLowerCase()
  const mainWebContents = config.getMainWindow()?.webContents || null
  const mainFallback = ['current_project', 'project', 'current'].includes(target)
  return runtimeTargets.resolveRuntimeTarget(args, args.projectId || args.project_id || '', {
    mainWebContents,
    mainFallback
  })
}

function getTargetWebContents(args = {}) {
  if (!hasRuntimeTargetSelector(args)) return null
  return resolveTargetWebContents(args).webContents || null
}

function isDesktopScreenshotTarget(args = {}) {
  const target = String(args.target || args.window || '').toLowerCase()
  return ['screen', 'desktop', 'display', 'active_window', 'active-window', 'window', 'external_window', 'external-window', 'list_sources', 'list-sources'].includes(target)
}

async function listDesktopCaptureSources(args = {}) {
  const thumbnailWidth = Math.max(160, Math.min(Number(args.thumbnail_width || args.thumbnailWidth || 360), 900))
  const thumbnailHeight = Math.max(90, Math.min(Number(args.thumbnail_height || args.thumbnailHeight || 220), 600))
  const target = String(args.target || '').toLowerCase()
  const types = target === 'screen'
    ? ['screen']
    : target === 'window' || target === 'external_window' || target === 'external-window'
      ? ['window']
      : ['window', 'screen']
  const sources = await desktopCapturer.getSources({
    types,
    thumbnailSize: { width: thumbnailWidth, height: thumbnailHeight },
    fetchWindowIcons: true
  })
  return sources.map(source => {
    const thumb = source.thumbnail && !source.thumbnail.isEmpty()
      ? source.thumbnail.resize({ width: Math.min(thumbnailWidth, 260) }).toDataURL()
      : ''
    return {
      id: source.id,
      name: source.name,
      display_id: source.display_id || '',
      appIcon: source.appIcon && !source.appIcon.isEmpty() ? source.appIcon.toDataURL() : '',
      thumbnailDataUrl: thumb
    }
  })
}

function scoreDesktopSource(source, args = {}) {
  const name = String(source.name || '').toLowerCase()
  const id = String(source.id || '').toLowerCase()
  const query = String(args.window_title || args.windowTitle || args.title || args.app || args.name || '').toLowerCase().trim()
  let score = 0
  if (id.startsWith('screen:')) score += String(args.target || '').toLowerCase() === 'screen' ? 30 : -30
  if (id.startsWith('window:')) score += 10
  if (query) {
    if (name === query) score += 100
    else if (name.includes(query)) score += 70
    else {
      const parts = query.split(/\s+/).filter(Boolean)
      score += parts.filter(part => name.includes(part)).length * 12
    }
  }
  if (/灵犀|lingxi|lingxicode|codex|chatgpt/i.test(source.name || '') && !query) score -= 80
  if (/录屏|record|screen/i.test(source.name || '')) score += 8
  return score
}

async function captureDesktopSourceToFile(filePath, args = {}) {
  const target = String(args.target || '').toLowerCase()
  const listOnly = ['list_sources', 'list-sources'].includes(target)
  const sources = await listDesktopCaptureSources(args)
  if (listOnly) {
    return { listOnly: true, sources }
  }

  const sourceId = args.source_id || args.sourceId || args.desktop_source_id || args.desktopSourceId
  let selected = sourceId
    ? sources.find(source => source.id === sourceId)
    : null
  if (sourceId && !selected) {
    const error = new Error('指定的窗口 source_id 已失效或窗口当前不可捕获。请重新用 target=list_sources 获取目标；不会退回截取屏幕。')
    error.code = 'DESKTOP_SOURCE_NOT_FOUND'
    throw error
  }
  if (!selected) {
    const ranked = sources
      .map(source => ({ source, score: scoreDesktopSource(source, args) }))
      .sort((a, b) => b.score - a.score)
    const query = String(args.window_title || args.windowTitle || args.title || args.app || args.name || '').trim()
    const windowCandidates = ranked.filter(item => String(item.source.id || '').startsWith('window:'))
    const top = ranked[0]
    const tied = top ? ranked.filter(item => item.score === top.score) : []
    if ((!query && windowCandidates.length > 1 && target !== 'screen') || tied.length > 1) {
      const error = new Error('桌面截图目标不明确：存在多个候选窗口。请先用 target=list_sources 获取 source_id，或提供精确 window_title。')
      error.code = 'AMBIGUOUS_DESKTOP_TARGET'
      error.candidates = (tied.length > 1 ? tied : windowCandidates).slice(0, 12).map(item => ({
        id: item.source.id,
        name: item.source.name,
        score: item.score
      }))
      throw error
    }
    if (query && (!top || top.score < 70)) {
      const error = new Error(`未找到标题匹配“${query}”的窗口。请先用 target=list_sources 获取精确 source_id；不会退回截取屏幕。`)
      error.code = 'DESKTOP_WINDOW_NOT_FOUND'
      error.candidates = windowCandidates.slice(0, 12).map(item => ({
        id: item.source.id,
        name: item.source.name,
        score: item.score
      }))
      throw error
    }
    selected = top?.source
  }
  if (!selected) throw new Error('未找到可截图的桌面窗口或屏幕')

  const wantsWindow = ['window', 'external_window', 'external-window', 'active_window', 'active-window'].includes(target)
  if (wantsWindow && !String(selected.id || '').startsWith('window:')) {
    const error = new Error('指定窗口截图拒绝使用屏幕源。请重新选择窗口 source_id。')
    error.code = 'WINDOW_CAPTURE_SCREEN_FALLBACK_BLOCKED'
    throw error
  }

  const rawSources = await desktopCapturer.getSources({
    types: selected.id.startsWith('screen:') ? ['screen'] : ['window'],
    thumbnailSize: {
      width: Math.max(640, Math.min(Number(args.viewport_width || args.viewportWidth || 1920), 7680)),
      height: Math.max(360, Math.min(Number(args.viewport_height || args.viewportHeight || 1080), 4320))
    },
    fetchWindowIcons: false
  })
  const raw = rawSources.find(source => source.id === selected.id)
  if (!raw || !raw.thumbnail || raw.thumbnail.isEmpty()) {
    const error = new Error(`目标窗口当前没有可用画面，可能已最小化或应用已暂停渲染: ${selected.name || selected.id}。工具不会改截其他窗口或桌面。`)
    error.code = 'WINDOW_FRAME_UNAVAILABLE'
    throw error
  }

  let image = raw.thumbnail
  if (args.x !== undefined || args.y !== undefined || args.width !== undefined || args.height !== undefined) {
    const rect = {
      x: Math.max(0, Number(args.x || 0)),
      y: Math.max(0, Number(args.y || 0)),
      width: Math.max(1, Number(args.width || 0)),
      height: Math.max(1, Number(args.height || 0))
    }
    image = image.crop(rect)
  }
  const size = image.getSize()
  if (wantsWindow && (size.width < 2 || size.height < 2)) {
    const error = new Error(`目标窗口返回了无效画面，可能已最小化: ${selected.name || selected.id}。工具不会改截其他窗口或桌面。`)
    error.code = 'WINDOW_FRAME_UNAVAILABLE'
    throw error
  }
  fs.writeFileSync(filePath, image.toPNG())
  return {
    width: size.width,
    height: size.height,
    source: selected,
    sources
  }
}

async function waitForScreenshotTarget(wc, args = {}, options = {}) {
  const waitUntil = String(args.wait_until || args.waitUntil || 'dom-ready')
  const alreadyLoaded = !!options.alreadyLoaded
  if (alreadyLoaded) {
    const delayMs = Number(args.delay_ms || args.delayMs || 500)
    if (delayMs > 0) {
      await new Promise(resolve => setTimeout(resolve, Math.min(delayMs, 10000)))
    }
    return
  }
  if (!wc.isLoading?.()) {
    const delayMs = Number(args.delay_ms || args.delayMs || 500)
    if (delayMs > 0) {
      await new Promise(resolve => setTimeout(resolve, Math.min(delayMs, 10000)))
    }
    return
  }
  if (waitUntil === 'networkidle') {
    await new Promise(resolve => {
      let timer = setTimeout(resolve, Number(args.timeout_ms || args.timeoutMs || 15000))
      const done = () => {
        clearTimeout(timer)
        resolve()
      }
      wc.once('did-stop-loading', done)
    })
  } else if (waitUntil === 'load') {
    if (wc.isLoading()) {
      await new Promise(resolve => wc.once('did-finish-load', resolve))
    }
  } else if (waitUntil === 'dom-ready') {
    await new Promise(resolve => wc.once('dom-ready', resolve))
  }
  const delayMs = Number(args.delay_ms || args.delayMs || 500)
  if (delayMs > 0) {
    await new Promise(resolve => setTimeout(resolve, Math.min(delayMs, 10000)))
  }
}

async function captureWebContentsToFile(wc, filePath, args = {}) {
  if (!wc || wc.isDestroyed?.()) {
    throw new Error('目标窗口不存在或已销毁，无法截图')
  }
  const rect = args.x !== undefined || args.y !== undefined || args.width !== undefined || args.height !== undefined
    ? {
        x: Number(args.x || 0),
        y: Number(args.y || 0),
        width: Number(args.width || 0),
        height: Number(args.height || 0)
      }
    : undefined
  const image = rect && rect.width > 0 && rect.height > 0
    ? await wc.capturePage(rect)
    : await wc.capturePage()
  const size = image.getSize()
  fs.writeFileSync(filePath, image.toPNG())
  return size
}

async function captureHiddenPage(url, filePath, args = {}) {
  const width = Math.max(320, Math.min(Number(args.viewport_width || args.viewportWidth || 1440), 7680))
  const height = Math.max(240, Math.min(Number(args.viewport_height || args.viewportHeight || 900), 4320))
  const win = new BrowserWindow({
    show: false,
    width,
    height,
    webPreferences: {
      offscreen: true,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: false
    }
  })
  try {
    await win.loadURL(url)
    await waitForScreenshotTarget(win.webContents, args, { alreadyLoaded: true })
    return await captureWebContentsToFile(win.webContents, filePath, args)
  } finally {
    if (!win.isDestroyed()) win.destroy()
  }
}

async function captureScreenshot(projectId, args = {}, resolvePath = input => input) {
  if (isDesktopScreenshotTarget(args)) {
    const target = String(args.target || '').toLowerCase()
    const listOnly = ['list_sources', 'list-sources'].includes(target)
    const screenshotDir = ensureScreenshotDir()
    const suffix = Math.random().toString(36).slice(2, 8)
    const filePath = path.join(screenshotDir, `screenshot-${normalizeTimestampForFile()}-${suffix}.png`)
    const desktopResult = await captureDesktopSourceToFile(filePath, args)
    if (desktopResult.listOnly) {
      return {
        success: true,
        kind: 'screenshot_sources',
        source: 'desktopCapturer',
        sources: desktopResult.sources,
        message: '已列出可截图的窗口/屏幕。请用 source_id 或 window_title 指定目标后再截图。'
      }
    }
    const preview = await buildImagePreviewPayload(filePath, { thumbWidth: 420 })
    return {
      success: true,
      file_type: 'image',
      kind: 'screenshot',
      path: filePath,
      width: preview.width || desktopResult.width,
      height: preview.height || desktopResult.height,
      format: 'png',
      thumbnailDataUrl: preview.thumbnailDataUrl,
      thumbnailWidth: preview.thumbnailWidth,
      thumbnailHeight: preview.thumbnailHeight,
      source: 'desktopCapturer',
      target: desktopResult.source?.name || desktopResult.source?.id || 'desktop',
      sourceId: desktopResult.source?.id || '',
      reason: args.reason || '',
      message: `已截取桌面目标：${desktopResult.source?.name || desktopResult.source?.id || 'desktop'}`
    }
  }

  const targetUrl = normalizeScreenshotUrl(args, resolvePath)
  const targetResolution = hasRuntimeTargetSelector(args)
    ? resolveTargetWebContents({ ...args, projectId })
    : { success: false, webContents: null, candidates: [] }
  if (hasRuntimeTargetSelector(args) && !targetResolution.success && !targetUrl) {
    return {
      success: false,
      error: `截图失败：${targetResolution.error}`,
      ambiguous: !!targetResolution.ambiguous,
      candidates: targetResolution.candidates || [],
      next_action: targetResolution.ambiguous ? 'choose_runtime_id_and_retry' : 'start_and_bind_development_runtime_or_provide_screenshot_url'
    }
  }
  const targetWc = targetResolution.webContents || null
  if (!targetWc && !targetUrl) {
    return {
      success: false,
      error: '截图失败：缺少明确目标。网页/HTML 请提供 url 或 html_path；右侧预览请提供 webContentsId；外部软件请先用 target=list_sources，或用 target=window + window_title/source_id；只有截图灵犀自身窗口才用 target=current_project/main_window。'
    }
  }

  const screenshotDir = ensureScreenshotDir()
  const suffix = Math.random().toString(36).slice(2, 8)
  const filePath = path.join(screenshotDir, `screenshot-${normalizeTimestampForFile()}-${suffix}.png`)
  const source = targetWc ? 'webContents' : 'hidden_page'
  const target = targetWc ? `webContents:${targetWc.id}` : targetUrl
  const size = targetWc
    ? await captureWebContentsToFile(targetWc, filePath, args)
    : await captureHiddenPage(targetUrl, filePath, args)

  const preview = await buildImagePreviewPayload(filePath, { thumbWidth: 420 })
  return {
    success: true,
    file_type: 'image',
    kind: 'screenshot',
    path: filePath,
    width: preview.width || size.width,
    height: preview.height || size.height,
    format: 'png',
    thumbnailDataUrl: preview.thumbnailDataUrl,
    thumbnailWidth: preview.thumbnailWidth,
    thumbnailHeight: preview.thumbnailHeight,
    source,
    target,
    runtime_target: targetResolution.target || undefined,
    reason: args.reason || '',
    message: `目标截图已保存: ${filePath}`
  }
}

const handlers = {
  list_runtime_targets: async (args, ctx) => {
    const projectId = args.project_id || args.projectId || ctx.projectId || ''
    const workspacePath = ctx.resolvePath ? path.resolve(ctx.resolvePath('.')) : ''
    const listOptions = {
      projectId,
      workspacePath,
      includeUnscoped: args.include_unscoped === true || args.includeUnscoped === true
    }
    return {
      success: true,
      project_id: projectId,
      workspace_path: workspacePath,
      targets: runtimeTargets.listRuntimeTargets(listOptions),
      observation_only_targets: runtimeTargets.listRuntimeTargets({ ...listOptions, includeObservationOnly: true }).filter(target => target.observation_only),
      adapters: require('../runtime-adapter-registry').listRuntimeAdapters(),
      message: '已按当前工作区列出可验证运行实例。根据 adapter/capabilities 选择验证方式，多个候选时请用 runtime_id 精确指定。'
    }
  },
  capture_screenshot: async (args, ctx) => {
    const { resolvePath, projectId } = ctx
    try {
      return await captureScreenshot(projectId, args, resolvePath)
    } catch (e) {
      return { success: false, error: e.message, code: e.code, candidates: e.candidates || [] }
    }
  }
}

module.exports = {
  handlers,
  ensureScreenshotDir,
  cleanupExpiredScreenshots,
  imageDataUrl,
  normalizeTimestampForFile,
  buildImagePreviewPayload,
  normalizeScreenshotUrl,
  hasRuntimeTargetSelector,
  resolveTargetWebContents,
  getTargetWebContents,
  isDesktopScreenshotTarget,
  listDesktopCaptureSources,
  scoreDesktopSource,
  captureDesktopSourceToFile,
  waitForScreenshotTarget,
  captureWebContentsToFile,
  captureScreenshot,
  captureHiddenPage
}
