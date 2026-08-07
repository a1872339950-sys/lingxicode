/**
 * 媒体生成工具处理器
 * 包含：generate_music, generate_video 工具及相关辅助函数
 */

const fs = require('fs')
const path = require('path')
const { execFile } = require('child_process')
const { promisify } = require('util')
const sharp = require('sharp')
const config = require('../config')
const projects = require('../projects')
const storageConfig = require('../storage-config')
const { resolveApiKey } = require('../api-key')
const { normalizeTimestampForFile } = require('./screenshot')
const { normalizeGenerationPrompt } = require('./image-gen')
const { findMusicGenerationModel, findVideoGenerationModel } = require('./vision')
const { sendThinkingEvent } = require('../thinking-event-sender')

const execFileAsync = promisify(execFile)
let ffmpegPath = ''
try {
  ffmpegPath = require('@ffmpeg-installer/ffmpeg').path
} catch {
  ffmpegPath = ''
}

const GENERATED_MEDIA_MAX_AGE_MS = 24 * 60 * 60 * 1000
const GENERATED_MEDIA_CLEANUP_INTERVAL_MS = 10 * 60 * 1000
let lastGeneratedMediaCleanupAt = 0

// sleep 的本地副本（避免与 command.js 的循环依赖）
function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error('operation aborted'))
      return
    }
    const timer = setTimeout(resolve, Math.max(0, ms))
    signal?.addEventListener?.('abort', () => {
      clearTimeout(timer)
      reject(new Error('operation aborted'))
    }, { once: true })
  })
}

function ensureGeneratedMediaDir(kind = 'media') {
  const safeKind = String(kind || 'media').replace(/[^a-z0-9_-]/gi, '-').toLowerCase() || 'media'
  const mediaDir = path.join(storageConfig.getCacheDir(), 'generated-media', safeKind)
  if (!fs.existsSync(mediaDir)) {
    fs.mkdirSync(mediaDir, { recursive: true })
  }
  cleanupExpiredGeneratedMedia(path.join(storageConfig.getCacheDir(), 'generated-media'))
  return mediaDir
}

function assertFfmpegAvailable() {
  if (!ffmpegPath) throw new Error('媒体处理失败：内置 FFmpeg 不可用')
  return ffmpegPath
}

function assertReadableMediaPath(filePath = '') {
  const resolved = path.resolve(String(filePath || ''))
  if (!filePath || !fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
    throw new Error(`媒体文件不存在: ${resolved}`)
  }
  return resolved
}

function normalizeFrameTimestamps(value) {
  const list = Array.isArray(value) ? value : (value === undefined || value === null || value === '' ? [] : [value])
  return [...new Set(list.map(item => Number(item)).filter(item => Number.isFinite(item) && item >= 0))].slice(0, 60)
}

async function runFfmpeg(args = [], options = {}) {
  const timeout = Math.max(10000, Math.min(Number(options.timeout || options.timeoutMs || 180000), 1800000))
  try {
    const result = await execFileAsync(assertFfmpegAvailable(), args, {
      windowsHide: true,
      timeout,
      maxBuffer: 8 * 1024 * 1024
    })
    return { stdout: result.stdout || '', stderr: result.stderr || '' }
  } catch (error) {
    const detail = String(error.stderr || error.stdout || error.message || error).slice(-2000)
    throw new Error(`FFmpeg 执行失败: ${detail}`)
  }
}

async function extractVideoFrames(args = {}, resolvePath = input => input) {
  const inputPath = assertReadableMediaPath(resolvePath(args.path || args.input_path || args.inputPath || args.video_path || args.videoPath))
  const timestamps = normalizeFrameTimestamps(args.timestamps || args.timestamp_seconds || args.timestampSeconds)
  const maxFrames = Math.max(1, Math.min(Number(args.max_frames || args.maxFrames || 12), 120))
  const intervalSeconds = Math.max(0.1, Math.min(Number(args.interval_seconds || args.intervalSeconds || 1), 3600))
  const width = Math.max(0, Math.min(Number(args.width || 0), 7680))
  const sessionDir = path.join(
    ensureGeneratedMediaDir('frames'),
    `frames-${normalizeTimestampForFile()}-${Math.random().toString(36).slice(2, 8)}`
  )
  fs.mkdirSync(sessionDir, { recursive: true })
  const scaleFilter = width > 0 ? `scale=${width}:-2:flags=lanczos` : ''
  const framePaths = []

  if (timestamps.length) {
    for (let index = 0; index < timestamps.length; index += 1) {
      const outputPath = path.join(sessionDir, `frame-${String(index + 1).padStart(4, '0')}-${timestamps[index].toFixed(3).replace('.', '_')}s.png`)
      const ffmpegArgs = ['-hide_banner', '-loglevel', 'error', '-ss', String(timestamps[index]), '-i', inputPath, '-frames:v', '1']
      if (scaleFilter) ffmpegArgs.push('-vf', scaleFilter)
      ffmpegArgs.push('-y', outputPath)
      await runFfmpeg(ffmpegArgs, args)
      if (fs.existsSync(outputPath)) framePaths.push(outputPath)
    }
  } else {
    const outputPattern = path.join(sessionDir, 'frame-%04d.png')
    const filters = [`fps=1/${intervalSeconds}`]
    if (scaleFilter) filters.push(scaleFilter)
    await runFfmpeg([
      '-hide_banner', '-loglevel', 'error', '-i', inputPath,
      '-vf', filters.join(','), '-frames:v', String(maxFrames), '-y', outputPattern
    ], args)
    framePaths.push(...fs.readdirSync(sessionDir)
      .filter(fileName => /^frame-\d+\.png$/i.test(fileName))
      .sort()
      .map(fileName => path.join(sessionDir, fileName)))
  }

  if (!framePaths.length) throw new Error('视频抽帧完成但没有生成可用帧')
  const firstMetadata = await sharp(framePaths[0]).metadata().catch(() => ({}))
  return {
    success: true,
    kind: 'video_frames',
    file_type: 'image_sequence',
    input_path: inputPath,
    output_dir: sessionDir,
    frames: framePaths,
    frame_count: framePaths.length,
    width: firstMetadata.width || null,
    height: firstMetadata.height || null,
    timestamps: timestamps.length ? timestamps : undefined,
    interval_seconds: timestamps.length ? undefined : intervalSeconds,
    message: `已从视频提取 ${framePaths.length} 帧: ${sessionDir}`
  }
}

async function upscaleMedia(args = {}, resolvePath = input => input) {
  const inputPath = assertReadableMediaPath(resolvePath(args.path || args.input_path || args.inputPath))
  const factor = Math.max(1, Math.min(Number(args.scale || args.factor || 2), 4))
  const ext = path.extname(inputPath).toLowerCase()
  const imageExtensions = new Set(['.png', '.jpg', '.jpeg', '.webp', '.avif', '.tif', '.tiff', '.bmp'])
  const requestedMethod = String(args.method || 'lanczos').toLowerCase()
  if (requestedMethod === 'ai') {
    return {
      success: false,
      error: '当前未配置本地 AI 超分模型。可先使用 method=lanczos 完成确定性高质量放大；AI 超分提供方接入后再启用 method=ai。',
      available_methods: ['lanczos']
    }
  }

  const outputDir = ensureGeneratedMediaDir('upscaled')
  const baseName = path.basename(inputPath, ext).replace(/[^a-zA-Z0-9_-]+/g, '_') || 'media'
  if (imageExtensions.has(ext)) {
    const metadata = await sharp(inputPath).metadata()
    const width = Math.max(1, Math.round((metadata.width || 1) * factor))
    const height = Math.max(1, Math.round((metadata.height || 1) * factor))
    const outputExt = ['.jpg', '.jpeg', '.webp', '.png'].includes(ext) ? ext : '.png'
    const outputPath = path.join(outputDir, `upscaled-${baseName}-${factor}x-${normalizeTimestampForFile()}${outputExt}`)
    let pipeline = sharp(inputPath)
      .rotate()
      .resize(width, height, { kernel: sharp.kernel.lanczos3, fit: 'fill' })
      .sharpen({ sigma: 0.8, m1: 0.8, m2: 1.4 })
    if (outputExt === '.jpg' || outputExt === '.jpeg') pipeline = pipeline.jpeg({ quality: Number(args.quality || 92), mozjpeg: true })
    if (outputExt === '.webp') pipeline = pipeline.webp({ quality: Number(args.quality || 92) })
    if (outputExt === '.png') pipeline = pipeline.png({ compressionLevel: 8 })
    await pipeline.toFile(outputPath)
    return {
      success: true,
      kind: 'upscaled_image',
      file_type: 'image',
      path: outputPath,
      input_path: inputPath,
      method: 'lanczos3+sharpen',
      scale: factor,
      width,
      height,
      message: `图片已高质量放大 ${factor}x: ${outputPath}`
    }
  }

  const outputPath = path.join(outputDir, `upscaled-${baseName}-${factor}x-${normalizeTimestampForFile()}.mp4`)
  const scaleFilter = `scale=trunc(iw*${factor}/2)*2:trunc(ih*${factor}/2)*2:flags=lanczos,unsharp=5:5:0.55:3:3:0.2`
  await runFfmpeg([
    '-hide_banner', '-loglevel', 'error', '-i', inputPath,
    '-vf', scaleFilter,
    '-c:v', 'libx264', '-preset', String(args.preset || 'medium'), '-crf', String(args.crf || 18),
    '-c:a', 'copy', '-movflags', '+faststart', '-y', outputPath
  ], args)
  return {
    success: true,
    kind: 'upscaled_video',
    file_type: 'video',
    path: outputPath,
    input_path: inputPath,
    method: 'ffmpeg-lanczos+unsharp',
    scale: factor,
    message: `视频已高质量放大 ${factor}x: ${outputPath}`
  }
}

function cleanupExpiredGeneratedMedia(mediaRoot) {
  const now = Date.now()
  if (now - lastGeneratedMediaCleanupAt < GENERATED_MEDIA_CLEANUP_INTERVAL_MS) return
  lastGeneratedMediaCleanupAt = now

  try {
    if (!fs.existsSync(mediaRoot)) return
    const stack = [mediaRoot]
    while (stack.length) {
      const dir = stack.pop()
      for (const fileName of fs.readdirSync(dir)) {
        const filePath = path.join(dir, fileName)
        const stat = fs.statSync(filePath)
        if (stat.isDirectory()) {
          stack.push(filePath)
          continue
        }
        if (!stat.isFile()) continue
        const generatedAsset = /^generated-(music|video)-.*\.(mp3|wav|mp4|m4a|aac)$/i.test(fileName)
        const processedAsset = /^(?:upscaled-|frame-).+\.(?:png|jpe?g|webp|avif|tiff?|bmp|mp4)$/i.test(fileName)
        if (!generatedAsset && !processedAsset) continue
        if (now - stat.mtimeMs > GENERATED_MEDIA_MAX_AGE_MS) {
          fs.unlinkSync(filePath)
        }
      }
    }
  } catch (error) {
    console.warn('[Tools] 清理过期生成媒体缓存失败:', error.message)
  }
}

function buildMiniMaxEndpoint(apiUrl = '', endpointName = '') {
  const base = String(apiUrl || '').trim()
  if (!base) return ''
  const endpoint = String(endpointName || '').replace(/^\/+/, '')
  if (new RegExp(`/v\\d+/${endpoint}/?$`, 'i').test(base)) return base
  if (/\/anthropic\/v\d+\/messages\/?$/i.test(base)) return base.replace(/\/anthropic\/v\d+\/messages\/?$/i, `/v1/${endpoint}`)
  if (/\/v\d+\/(chat\/completions|messages|images\/generations|image_generation|music_generation|video_generation|query\/video_generation|files\/retrieve)\/?$/i.test(base)) {
    return base.replace(/\/v\d+\/(chat\/completions|messages|images\/generations|image_generation|music_generation|video_generation|query\/video_generation|files\/retrieve)\/?$/i, `/v1/${endpoint}`)
  }
  if (/\/v\d+\/?$/i.test(base)) return base.replace(/\/$/, '') + `/${endpoint}`
  return base.replace(/\/$/, '') + `/v1/${endpoint}`
}

function isMiniMaxModel(model = {}, capability = '') {
  return /minimax|api\.minimaxi\.com|api\.minimax\.io/i.test([
    model.provider,
    model.apiUrl,
    model.modelId,
    model.modelName,
    capability
  ].filter(Boolean).join(' '))
}

function normalizeAudioFormat(value = '') {
  const format = String(value || '').trim().toLowerCase()
  if (['wav', 'mp3', 'aac', 'm4a'].includes(format)) return format
  return 'mp3'
}

function extractMiniMaxAudioHex(payload = {}) {
  if (!payload || typeof payload !== 'object') return ''
  return payload.data?.audio || payload.audio || payload.data?.audio_hex || payload.audio_hex || ''
}

function extractMiniMaxAudioUrl(payload = {}) {
  if (!payload || typeof payload !== 'object') return ''
  return payload.data?.audio_url || payload.audio_url || payload.data?.download_url || payload.download_url || payload.data?.url || payload.url || ''
}

function getFileExtensionFromUrl(url = '', fallback = 'bin') {
  try {
    const pathname = new URL(String(url)).pathname
    const ext = path.extname(pathname).replace('.', '').toLowerCase()
    return ext || fallback
  } catch (error) {
    return fallback
  }
}

function sendProgressNarration(webContents, projectId, content) {
  sendThinkingEvent(webContents, projectId, {
    kind: 'progress',
    content
  })
}

async function downloadUrlToFile(url, filePath, signal) {
  const response = await fetch(url, { signal })
  if (!response.ok) {
    const errorText = await response.text().catch(() => '')
    throw new Error(`download failed HTTP ${response.status}: ${errorText.slice(0, 300)}`)
  }
  fs.writeFileSync(filePath, Buffer.from(await response.arrayBuffer()))
  return filePath
}

async function generateMusicWithModel(projectId, args = {}, modelConfig = null) {
  const musicModel = await findMusicGenerationModel(modelConfig)
  if (!musicModel) {
    return {
      success: false,
      error: 'Music generation failed: no configured model is marked with music generation capability.'
    }
  }
  if (!isMiniMaxModel(musicModel, 'musicGeneration')) {
    return {
      success: false,
      error: 'Music generation currently supports MiniMax-compatible models. Mark a MiniMax music model with music generation capability.'
    }
  }

  const prompt = normalizeGenerationPrompt(args.prompt ?? args.description ?? args.lyrics, args.description || '')
  if (!prompt) return { success: false, error: 'Music generation failed: missing prompt or lyrics.' }

  const endpoint = buildMiniMaxEndpoint(args.api_url || args.apiUrl || musicModel.apiUrl, 'music_generation')
  const modelName = args.model || args.music_model || args.musicModel || musicModel.musicModel || musicModel.modelId || musicModel.modelName || 'music-01'
  const audioFormat = normalizeAudioFormat(args.format || args.audio_format || args.audioFormat)
  const outputFormat = String(args.output_format || args.outputFormat || 'hex').trim().toLowerCase() === 'url' ? 'url' : 'hex'
  const lyrics = args.lyrics || args.lyric || ''
  const body = {
    model: modelName,
    prompt,
    lyrics,
    audio_setting: {
      sample_rate: Number(args.sample_rate || args.sampleRate || 44100),
      bitrate: Number(args.bitrate || 128000),
      format: audioFormat
    },
    output_format: outputFormat
  }
  if (args.refer_voice || args.referVoice) body.refer_voice = args.refer_voice || args.referVoice
  if (args.refer_audio || args.referAudio) body.refer_audio = args.refer_audio || args.referAudio
  if (args.is_instrumental !== undefined || args.instrumental !== undefined) body.is_instrumental = !!(args.is_instrumental ?? args.instrumental)
  if (args.auto_lyrics !== undefined || args.autoLyrics !== undefined) body.auto_lyrics = !!(args.auto_lyrics ?? args.autoLyrics)
  if (args.style) body.style = String(args.style)
  if (args.duration) body.duration = Number(args.duration)
  if (args.instruments) body.instruments = Array.isArray(args.instruments) ? args.instruments : String(args.instruments).split(',').map(item => item.trim()).filter(Boolean)

  const webContents = projectId ? projects.getWebContentsForProject(projectId) : config.getMainWindow()?.webContents
  const musicProgressText = `Generating music with MiniMax: ${prompt.slice(0, 80)}${prompt.length > 80 ? '...' : ''}`
  sendProgressNarration(webContents, projectId, musicProgressText)

  const signal = projectId ? config.getAbortController(projectId)?.signal : undefined
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${resolveApiKey(musicModel.apiKey)}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body),
    signal
  })
  if (!response.ok) {
    const errorText = await response.text().catch(() => '')
    return { success: false, error: `Music generation failed: HTTP ${response.status} ${errorText.slice(0, 500)}` }
  }
  const payload = await response.json()
  const audioHex = extractMiniMaxAudioHex(payload)
  const audioUrl = extractMiniMaxAudioUrl(payload)
  if (!audioHex && !audioUrl) {
    return { success: false, error: 'Music generation failed: response did not contain audio data or audio URL.', raw: payload }
  }
  const mediaDir = ensureGeneratedMediaDir('music')
  const filePath = path.join(mediaDir, `generated-music-${normalizeTimestampForFile()}-${Math.random().toString(36).slice(2, 8)}.${audioFormat}`)
  if (audioHex) {
    fs.writeFileSync(filePath, Buffer.from(audioHex, 'hex'))
  } else {
    await downloadUrlToFile(audioUrl, filePath, signal)
  }
  return {
    success: true,
    file_type: 'audio',
    kind: 'generated_music',
    path: filePath,
    modelName,
    providerModelName: musicModel.modelName || musicModel.modelId || modelName,
    prompt,
    format: audioFormat,
    outputFormat,
    message: `Music generated: ${filePath}`
  }
}

function extractMiniMaxTaskId(payload = {}) {
  return payload.task_id || payload.taskId || payload.data?.task_id || payload.data?.taskId || ''
}

function extractMiniMaxVideoStatus(payload = {}) {
  return String(payload.status || payload.data?.status || payload.base_resp?.status_msg || '').trim()
}

function extractMiniMaxFileId(payload = {}) {
  return payload.file_id || payload.fileId || payload.data?.file_id || payload.data?.fileId || payload.data?.file?.file_id || ''
}

function extractMiniMaxDownloadUrl(payload = {}) {
  return payload.download_url || payload.downloadUrl || payload.file?.download_url || payload.data?.download_url || payload.data?.downloadUrl || payload.data?.file?.download_url || ''
}

async function queryMiniMaxVideoTask(apiUrl, apiKey, taskId, signal) {
  const baseQueryEndpoint = buildMiniMaxEndpoint(apiUrl, 'query/video_generation')
  const url = `${baseQueryEndpoint}?task_id=${encodeURIComponent(taskId)}`
  const response = await fetch(url, {
    method: 'GET',
    headers: { 'Authorization': `Bearer ${resolveApiKey(apiKey)}` },
    signal
  })
  if (!response.ok) {
    const errorText = await response.text().catch(() => '')
    throw new Error(`video query HTTP ${response.status}: ${errorText.slice(0, 300)}`)
  }
  return response.json()
}

async function retrieveMiniMaxFile(apiUrl, apiKey, fileId, signal) {
  const retrieveEndpoint = buildMiniMaxEndpoint(apiUrl, 'files/retrieve')
  const url = `${retrieveEndpoint}?file_id=${encodeURIComponent(fileId)}`
  const response = await fetch(url, {
    method: 'GET',
    headers: { 'Authorization': `Bearer ${resolveApiKey(apiKey)}` },
    signal
  })
  if (!response.ok) {
    const errorText = await response.text().catch(() => '')
    throw new Error(`file retrieve HTTP ${response.status}: ${errorText.slice(0, 300)}`)
  }
  return response.json()
}

async function generateVideoWithModel(projectId, args = {}, modelConfig = null) {
  const videoModel = await findVideoGenerationModel(modelConfig)
  if (!videoModel) {
    return {
      success: false,
      error: 'Video generation failed: no configured model is marked with video generation capability.'
    }
  }
  if (!isMiniMaxModel(videoModel, 'videoGeneration')) {
    return {
      success: false,
      error: `Video generation model "${videoModel.modelName || videoModel.modelId || 'unknown'}" is not supported by the local adapter. Configure a MiniMax-compatible video model.`
    }
  }
  const prompt = normalizeGenerationPrompt(args.prompt ?? args.description, args.description || '')
  if (!prompt) return { success: false, error: 'Video generation failed: missing prompt.' }

  const endpoint = buildMiniMaxEndpoint(args.api_url || args.apiUrl || videoModel.apiUrl, 'video_generation')
  const modelName = args.model || args.video_model || args.videoModel || videoModel.videoModel || videoModel.modelId || videoModel.modelName || 'video-01'
  const body = {
    model: modelName,
    prompt
  }
  if (args.first_frame_image) body.first_frame_image = args.first_frame_image
  if (args.firstFrameImage) body.first_frame_image = args.firstFrameImage
  if (args.last_frame_image) body.last_frame_image = args.last_frame_image
  if (args.lastFrameImage) body.last_frame_image = args.lastFrameImage
  if (args.subject_reference) body.subject_reference = args.subject_reference
  if (args.subjectReference) body.subject_reference = args.subjectReference
  if (args.callback_url) body.callback_url = args.callback_url
  if (args.callbackUrl) body.callback_url = args.callbackUrl
  if (args.prompt_optimizer !== undefined) body.prompt_optimizer = !!args.prompt_optimizer
  if (args.duration) body.duration = Number(args.duration)
  if (args.resolution) body.resolution = String(args.resolution)

  const webContents = projectId ? projects.getWebContentsForProject(projectId) : config.getMainWindow()?.webContents
  const videoProgressText = `Generating video with MiniMax: ${prompt.slice(0, 80)}${prompt.length > 80 ? '...' : ''}`
  sendProgressNarration(webContents, projectId, videoProgressText)

  const signal = projectId ? config.getAbortController(projectId)?.signal : undefined
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${resolveApiKey(videoModel.apiKey)}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body),
    signal
  })
  if (!response.ok) {
    const errorText = await response.text().catch(() => '')
    return { success: false, error: `Video generation failed: HTTP ${response.status} ${errorText.slice(0, 500)}` }
  }
  const startPayload = await response.json()
  const taskId = extractMiniMaxTaskId(startPayload)
  if (!taskId) {
    return { success: false, error: 'Video generation failed: response did not contain task_id.', raw: startPayload }
  }

  const maxWaitMs = Math.max(10000, Math.min(Number(args.timeout || args.timeoutMs || 600000), 1800000))
  const pollIntervalMs = Math.max(2000, Math.min(Number(args.pollInterval || args.poll_interval || 5000), 30000))
  const startedAt = Date.now()
  let lastPayload = startPayload
  let fileId = extractMiniMaxFileId(startPayload)
  while (!fileId && Date.now() - startedAt < maxWaitMs) {
    await sleep(pollIntervalMs, signal)
    lastPayload = await queryMiniMaxVideoTask(videoModel.apiUrl, videoModel.apiKey, taskId, signal)
    const status = extractMiniMaxVideoStatus(lastPayload).toLowerCase()
    fileId = extractMiniMaxFileId(lastPayload)
    sendProgressNarration(webContents, projectId, `MiniMax video generation: ${status || 'processing'}, task ${taskId}`)
    if (/fail|error|failed/i.test(status)) {
      return { success: false, error: `Video generation failed: ${status}`, taskId, raw: lastPayload }
    }
  }
  if (!fileId) {
    return { success: false, status: 'timeout', error: `Video generation timed out before file_id was ready. task_id=${taskId}`, taskId, raw: lastPayload }
  }
  const filePayload = await retrieveMiniMaxFile(videoModel.apiUrl, videoModel.apiKey, fileId, signal)
  const downloadUrl = extractMiniMaxDownloadUrl(filePayload)
  if (!downloadUrl) {
    return { success: false, error: 'Video generation failed: file retrieve response did not contain download_url.', taskId, fileId, raw: filePayload }
  }
  const ext = getFileExtensionFromUrl(downloadUrl, 'mp4')
  const mediaDir = ensureGeneratedMediaDir('video')
  const filePath = path.join(mediaDir, `generated-video-${normalizeTimestampForFile()}-${Math.random().toString(36).slice(2, 8)}.${ext}`)
  await downloadUrlToFile(downloadUrl, filePath, signal)
  return {
    success: true,
    file_type: 'video',
    kind: 'generated_video',
    path: filePath,
    modelName,
    providerModelName: videoModel.modelName || videoModel.modelId || modelName,
    prompt,
    taskId,
    fileId,
    format: ext,
    message: `Video generated: ${filePath}`
  }
}

const handlers = {
  extract_video_frames: async (args, ctx = {}) => {
    try {
      return await extractVideoFrames(args, ctx.resolvePath || (input => input))
    } catch (e) {
      return { success: false, error: e.message }
    }
  },

  upscale_media: async (args, ctx = {}) => {
    try {
      return await upscaleMedia(args, ctx.resolvePath || (input => input))
    } catch (e) {
      return { success: false, error: e.message }
    }
  },

  generate_music: async (args, ctx) => {
    const { projectId, modelConfig } = ctx
    try {
      return await generateMusicWithModel(projectId, args, modelConfig)
    } catch (e) {
      return { success: false, error: e.message }
    }
  },

  generate_video: async (args, ctx) => {
    const { projectId, modelConfig } = ctx
    try {
      return await generateVideoWithModel(projectId, args, modelConfig)
    } catch (e) {
      return { success: false, error: e.message }
    }
  }
}

module.exports = {
  handlers,
  ensureGeneratedMediaDir,
  cleanupExpiredGeneratedMedia,
  buildMiniMaxEndpoint,
  isMiniMaxModel,
  normalizeAudioFormat,
  extractMiniMaxAudioHex,
  extractMiniMaxAudioUrl,
  getFileExtensionFromUrl,
  sendProgressNarration,
  downloadUrlToFile,
  runFfmpeg,
  extractVideoFrames,
  upscaleMedia,
  generateMusicWithModel,
  extractMiniMaxTaskId,
  extractMiniMaxVideoStatus,
  extractMiniMaxFileId,
  extractMiniMaxDownloadUrl,
  queryMiniMaxVideoTask,
  retrieveMiniMaxFile,
  generateVideoWithModel
}
