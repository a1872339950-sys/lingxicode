/**
 * 图片生成工具处理器
 * 包含：generate_image, render_svg_asset 工具及相关辅助函数
 */

const fs = require('fs')
const path = require('path')
const sharp = require('sharp')
const { Resvg } = require('@resvg/resvg-js')
const config = require('../config')
const projects = require('../projects')
const storageConfig = require('../storage-config')
const { resolveApiKey } = require('../api-key')
const { ensureSafetyBaselineBeforeWrite } = require('./git-safety')
const { safelyRecordChange } = require('./file-ops')
const { buildImagePreviewPayload, normalizeTimestampForFile } = require('./screenshot')
const {
  findImageGenerationModel,
  askImageGenerationPermission,
  getCapabilityPolicies
} = require('./vision')
const { getResultLabel } = require('../ask-permission')
const { sendThinkingEvent } = require('../thinking-event-sender')

const GENERATED_IMAGE_MAX_AGE_MS = 24 * 60 * 60 * 1000
const GENERATED_IMAGE_CLEANUP_INTERVAL_MS = 10 * 60 * 1000
let lastGeneratedImageCleanupAt = 0

function getImageFormat(outputPath, requestedFormat) {
  const normalized = String(requestedFormat || '').toLowerCase()
  if (['png', 'webp', 'jpg', 'jpeg', 'avif', 'tiff'].includes(normalized)) {
    return normalized === 'jpg' ? 'jpeg' : normalized
  }
  const ext = path.extname(outputPath || '').toLowerCase().replace('.', '')
  if (ext === 'jpg') return 'jpeg'
  if (['png', 'webp', 'jpeg', 'avif', 'tiff'].includes(ext)) return ext
  return 'png'
}

async function renderSvgAsset(args, resolvePath) {
  const width = Number(args.width) || 1200
  const height = Number(args.height) || 800
  const scale = Number(args.scale) > 0 ? Number(args.scale) : 1
  const background = args.background || undefined
  const fit = ['contain', 'cover', 'fill', 'inside', 'outside'].includes(args.fit) ? args.fit : 'contain'
  const outputPath = resolvePath(args.output_path)
  const sourcePath = args.svg_path ? resolvePath(args.svg_path) : null
  const format = getImageFormat(outputPath, args.format)

  if (!args.svg_content && !sourcePath) {
    return { success: false, error: '缺少 svg_content 或 svg_path' }
  }

  let svgContent = args.svg_content
  if (!svgContent) {
    if (!fs.existsSync(sourcePath)) {
      return { success: false, error: `SVG 文件不存在: ${sourcePath}` }
    }
    svgContent = fs.readFileSync(sourcePath, 'utf-8')
  }

  if (!/<svg[\s>]/i.test(svgContent)) {
    return { success: false, error: '输入内容不是有效 SVG' }
  }

  const outputDir = path.dirname(outputPath)
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true })
  }

  const rendered = new Resvg(svgContent, {
    fitTo: {
      mode: 'width',
      value: Math.max(1, Math.round(width * scale))
    },
    background
  }).render()

  let pipeline = sharp(rendered.asPng()).resize({
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
    fit,
    background: background || { r: 0, g: 0, b: 0, alpha: 0 }
  })

  if (format === 'webp') pipeline = pipeline.webp({ quality: Number(args.quality) || 88 })
  else if (format === 'jpeg') pipeline = pipeline.jpeg({ quality: Number(args.quality) || 88 })
  else if (format === 'avif') pipeline = pipeline.avif({ quality: Number(args.quality) || 70 })
  else if (format === 'tiff') pipeline = pipeline.tiff()
  else pipeline = pipeline.png()

  await pipeline.toFile(outputPath)

  return {
    success: true,
    sourcePath,
    outputPath,
    format,
    width: Math.round(width * scale),
    height: Math.round(height * scale),
    message: `SVG 已渲染为 ${format.toUpperCase()}: ${outputPath}`
  }
}

function ensureGeneratedImageDir() {
  const imageDir = path.join(storageConfig.getCacheDir(), 'generated-images')
  if (!fs.existsSync(imageDir)) {
    fs.mkdirSync(imageDir, { recursive: true })
  }
  cleanupExpiredGeneratedImages(imageDir)
  return imageDir
}

function cleanupExpiredGeneratedImages(imageDir) {
  const now = Date.now()
  if (now - lastGeneratedImageCleanupAt < GENERATED_IMAGE_CLEANUP_INTERVAL_MS) return
  lastGeneratedImageCleanupAt = now

  try {
    for (const fileName of fs.readdirSync(imageDir)) {
      if (!/^generated-image-.*\.(png|jpg|jpeg|webp)$/i.test(fileName)) continue
      const filePath = path.join(imageDir, fileName)
      const stat = fs.statSync(filePath)
      if (!stat.isFile()) continue
      if (now - stat.mtimeMs > GENERATED_IMAGE_MAX_AGE_MS) {
        fs.unlinkSync(filePath)
      }
    }
  } catch (error) {
    console.warn('[Tools] 清理过期生成图片缓存失败:', error.message)
  }
}

function buildImageGenerationEndpoint(apiUrl = '') {
  const base = String(apiUrl || '').trim().replace(/\/v1(?=\/|$)/ig, '/v1')
  if (!base) return ''
  if (/\/v1\/image_generation\/?$/i.test(base)) return base
  if (/minimax/i.test(base)) {
    if (/\/v1\/?$/i.test(base)) return base.replace(/\/$/, '') + '/image_generation'
    if (/\/anthropic\/v\d+\/messages\/?$/i.test(base)) return base.replace(/\/anthropic\/v\d+\/messages\/?$/i, '/v1/image_generation')
    if (/\/v\d+\/(chat\/completions|messages|images\/generations|music_generation|video_generation)\/?$/i.test(base)) return base.replace(/\/v\d+\/(chat\/completions|messages|images\/generations|music_generation|video_generation)\/?$/i, '/v1/image_generation')
    return base.replace(/\/$/, '') + '/v1/image_generation'
  }
  if (/\/paas\/v4\/images\/generations\/?$/i.test(base)) return base
  if (/bigmodel\.cn/i.test(base)) {
    if (/\/paas\/v4\/?$/i.test(base)) return base.replace(/\/$/, '') + '/images/generations'
    return base.replace(/\/$/, '') + '/paas/v4/images/generations'
  }
  if (/\/images\/generations\/?$/i.test(base)) return base
  if (/\/images\/edits\/?$/i.test(base)) return base.replace(/\/images\/edits\/?$/i, '/images/generations')
  if (/\/(chat\/completions|responses)\/?$/i.test(base)) {
    return base.replace(/\/(chat\/completions|responses)\/?$/i, '/images/generations')
  }
  if (/\/v1\/?$/i.test(base)) return base.replace(/\/$/, '') + '/images/generations'
  return base.replace(/\/$/, '') + '/images/generations'
}

function buildImageGenerationRequestEndpoint(imageGenerationModel = {}, apiUrl = '') {
  if (imageGenerationModel.useFullUrl === true || imageGenerationModel.fullUrl === true || imageGenerationModel.apiUrlMode === 'full') {
    return String(apiUrl || imageGenerationModel.apiUrl || '').trim()
  }
  return buildImageGenerationEndpoint(apiUrl || imageGenerationModel.apiUrl)
}

function buildGenerationAuthHeaders(model = {}, extraHeaders = {}) {
  const headers = { ...extraHeaders }
  headers.Authorization = `Bearer ${resolveApiKey(model.apiKey)}`
  return headers
}

function getImageProviderKind(endpoint = '', modelName = '') {
  if (/\/v1\/image_generation/i.test(endpoint) || /minimax/i.test(`${endpoint} ${modelName}`)) {
    return 'minimax'
  }
  if (/\/paas\/v4\/images\/generations/i.test(endpoint) || /^(glm-image|cogview-)/i.test(String(modelName || ''))) {
    return 'bigmodel'
  }
  return 'openai'
}

function extractGeneratedImageBase64(payload) {
  if (!payload || typeof payload !== 'object') return ''
  if (payload.b64_json) return payload.b64_json
  if (payload.image?.b64_json) return payload.image.b64_json
  if (Array.isArray(payload.data?.image_base64) && payload.data.image_base64[0]) return payload.data.image_base64[0]
  if (Array.isArray(payload.image_base64) && payload.image_base64[0]) return payload.image_base64[0]
  if (Array.isArray(payload.data)) {
    for (const item of payload.data) {
      if (item?.b64_json) return item.b64_json
      if (item?.image?.b64_json) return item.image.b64_json
    }
  }
  if (payload.success === true && payload.data && typeof payload.data === 'object' && !Array.isArray(payload.data)) {
    const nested = extractGeneratedImageBase64(payload.data)
    if (nested) return nested
  }
  if (Array.isArray(payload.output)) {
    for (const item of payload.output) {
      if (item?.b64_json) return item.b64_json
      if (Array.isArray(item?.content)) {
        for (const content of item.content) {
          if (content?.b64_json) return content.b64_json
          if (content?.image?.b64_json) return content.image.b64_json
        }
      }
    }
  }
  if (typeof payload.image_base64 === 'string') return payload.image_base64
  if (typeof payload.data?.image_base64 === 'string') return payload.data.image_base64
  if (Array.isArray(payload.data?.image_urls)) return ''
  return ''
}

function extractGeneratedImageUrl(payload) {
  if (!payload || typeof payload !== 'object') return ''
  if (payload.url) return payload.url
  if (payload.image_url) return payload.image_url
  if (Array.isArray(payload.data)) {
    for (const item of payload.data) {
      if (item?.url) return item.url
      if (item?.image_url) return item.image_url
    }
  }
  if (payload.success === true && payload.data && typeof payload.data === 'object' && !Array.isArray(payload.data)) {
    const nested = extractGeneratedImageUrl(payload.data)
    if (nested) return nested
  }
  if (Array.isArray(payload.image_urls) && payload.image_urls[0]) {
    const item = payload.image_urls[0]
    return typeof item === 'string' ? item : (item?.url || item?.image_url || '')
  }
  if (Array.isArray(payload.data?.image_urls) && payload.data.image_urls[0]) {
    const item = payload.data.image_urls[0]
    return typeof item === 'string' ? item : (item?.url || item?.image_url || '')
  }
  if (payload.data?.image_url) return payload.data.image_url
  return ''
}

function normalizeGenerationPrompt(value, fallback = '') {
  if (typeof value === 'string') return value.trim()
  if (value && typeof value === 'object') {
    const parts = []
    for (const key of ['prompt', 'description', 'task', 'context', 'style', 'requirements', 'negative_prompt', 'negativePrompt']) {
      if (value[key] !== undefined && value[key] !== null) {
        const text = typeof value[key] === 'string' ? value[key] : JSON.stringify(value[key])
        if (text && text.trim()) parts.push(`${key}: ${text.trim()}`)
      }
    }
    if (parts.length) return parts.join('\n')
    try {
      return JSON.stringify(value, null, 2)
    } catch (error) {
      return String(value || '').trim()
    }
  }
  return String(fallback || '').trim()
}

async function readImageGenerationResponse(response) {
  const contentType = response.headers.get('content-type') || ''
  if (!contentType.includes('text/event-stream')) {
    const text = await response.text()
    if (!/\bjson\b/i.test(contentType)) {
      const preview = text.replace(/\s+/g, ' ').trim().slice(0, 180)
      throw new Error(`Image generation endpoint returned ${contentType || 'an unknown content type'} instead of JSON.${preview ? ` Response starts with: ${preview}` : ''}`)
    }
    let payload
    try {
      payload = text ? JSON.parse(text) : {}
    } catch (_) {
      const preview = text.replace(/\s+/g, ' ').trim().slice(0, 180)
      throw new Error(`Image generation endpoint returned invalid JSON.${preview ? ` Response starts with: ${preview}` : ''}`)
    }
    return {
      base64: extractGeneratedImageBase64(payload),
      url: extractGeneratedImageUrl(payload)
    }
  }

  const decoder = new TextDecoder()
  const reader = response.body.getReader()
  let buffer = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const frames = buffer.split('\n\n')
    buffer = frames.pop() || ''
    for (const frame of frames) {
      const data = frame.split(/\r?\n/)
        .filter(line => line.startsWith('data:'))
        .map(line => line.slice(5).trim())
        .join('\n')
        .trim()
      if (!data || data === '[DONE]') continue
      const event = JSON.parse(data)
      const image = extractGeneratedImageBase64(event)
      const imageUrl = extractGeneratedImageUrl(event)
      if ((image || imageUrl) && (event.type === 'image_generation.completed' || event.type === 'completed' || event.b64_json || event.data)) {
        return { base64: image, url: imageUrl }
      }
    }
  }
  return { base64: '', url: '' }
}

async function generateImageWithModel(projectId, args = {}, modelConfig = null) {
  const imageGenerationModel = await findImageGenerationModel(modelConfig)
  if (!imageGenerationModel) {
    return {
      success: false,
      error: '未找到已启用“图片生成”能力的模型。请在模型设置里添加模型、勾选“图片生成”并保存。'
    }
  }

  const prompt = normalizeGenerationPrompt(args.prompt ?? args.description, args.description || '')
  if (!prompt) return { success: false, error: 'Image generation failed: missing prompt.' }

  const capabilityPolicies = getCapabilityPolicies()
  if (capabilityPolicies.imageGenerationConfirm === 'always' && args.skipPermission !== true) {
    const permission = await askImageGenerationPermission(projectId, prompt, imageGenerationModel)
    const permissionValue = getResultLabel(permission)
    if (!permission.success || permissionValue === 'rejected') {
      return {
        success: false,
        status: 'user_rejected',
        message: '用户取消了本次图片生成。'
      }
    }
  }

  const endpoint = buildImageGenerationRequestEndpoint(imageGenerationModel, args.api_url || args.apiUrl || imageGenerationModel.apiUrl)
  const imageModel = args.model || args.image_model || args.imageModel || imageGenerationModel.imageModel || imageGenerationModel.modelId || imageGenerationModel.modelName || 'gpt-image-2'
  const providerKind = getImageProviderKind(endpoint, imageModel)
  const size = args.size || '1024x1024'
  const n = Math.max(1, Math.min(Number(args.n || 1), 4))
  const body = providerKind === 'minimax'
    ? {
        model: imageModel,
        prompt,
        aspect_ratio: args.aspect_ratio || args.aspectRatio || (size === '1024x1536' ? '2:3' : size === '1536x1024' ? '3:2' : '1:1'),
        n,
        prompt_optimizer: args.prompt_optimizer !== undefined ? !!args.prompt_optimizer : true,
        response_format: args.response_format || args.responseFormat || 'url'
      }
    : providerKind === 'bigmodel'
      ? {
        model: imageModel,
        prompt,
        quality: args.quality || 'hd',
        size,
        // GLM-Image 默认关闭水印。若用户未签署免责声明，API 会返回错误，
        // 此时在错误处理中提示用户前往「个人中心-安全管理-去水印管理」签署。
        watermark_enabled: args.watermark_enabled !== undefined ? !!args.watermark_enabled : false,
        ...(args.user_id || args.userId ? { user_id: String(args.user_id || args.userId) } : {})
      }
      : {
        model: imageModel,
        prompt,
        n,
        size,
        // OpenAI-compatible relays often support the image endpoint but not
        // its optional SSE mode. Use synchronous JSON unless explicitly asked.
        stream: args.stream === true,
        response_format: 'b64_json'
      }
  if (providerKind === 'minimax') {
    const subjectReference = args.subject_reference || args.subjectReference
    if (subjectReference) {
      body.subject_reference = Array.isArray(subjectReference)
        ? subjectReference
        : [{ type: args.subject_type || args.subjectType || 'character', image_file: String(subjectReference) }]
    }
  }

  const webContents = projectId ? projects.getWebContentsForProject(projectId) : config.getMainWindow()?.webContents
  sendThinkingEvent(webContents, projectId, {
    kind: 'progress',
    content: `Generating image with ${imageGenerationModel.modelName || imageGenerationModel.modelId || imageModel}: ${prompt.slice(0, 80)}${prompt.length > 80 ? '...' : ''}`
  })

  const timeoutMs = Math.max(10000, Math.min(Number(args.timeout_ms || args.timeoutMs || args.timeout || 300000), 900000))
  const timeoutSignal = AbortSignal.timeout(timeoutMs)
  const projectSignal = projectId ? config.getAbortController(projectId)?.signal : undefined
  const requestSignal = projectSignal ? AbortSignal.any([projectSignal, timeoutSignal]) : timeoutSignal

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: buildGenerationAuthHeaders(imageGenerationModel, {
      'Content-Type': 'application/json',
      'Accept': body.stream && providerKind !== 'minimax' ? 'text/event-stream' : 'application/json'
    }),
    body: JSON.stringify(body),
    signal: requestSignal
  })

  if (!response.ok) {
    const contentType = response.headers.get('content-type') || ''
    const errorText = await response.text().catch(() => '')
    let upstreamMessage = ''
    if (/\bjson\b/i.test(contentType) && errorText) {
      try {
        const payload = JSON.parse(errorText)
        upstreamMessage = payload?.error?.message || payload?.message || payload?.error || ''
      } catch (_) { /* use compact raw response below */ }
    }
    if (!upstreamMessage) upstreamMessage = errorText.replace(/\s+/g, ' ').trim().slice(0, 300)
    if (response.status === 502) {
      return {
        success: false,
        status: 'upstream_error',
        error: `Image generation upstream failed (HTTP 502). The gateway received the request but its image-model provider failed.${upstreamMessage ? ` ${upstreamMessage}` : ''}`
      }
    }
    // GLM-Image 去水印被拒：用户未签署免责声明
    if (providerKind === 'bigmodel' && /watermark|水印|免责声明|disclaimer/i.test(upstreamMessage)) {
      return {
        success: false,
        status: 'watermark_disclaimer_required',
        error: `关闭水印需要先签署免责声明。请前往智谱开放平台「个人中心 → 安全管理 → 去水印管理」签署后再试。${upstreamMessage ? ` (API: ${upstreamMessage})` : ''}`
      }
    }
    return { success: false, status: 'request_failed', error: `Image generation failed: HTTP ${response.status}${upstreamMessage ? ` ${upstreamMessage}` : ''}` }
  }

  const imageResult = await readImageGenerationResponse(response)
  if (!imageResult.base64 && !imageResult.url) {
    return { success: false, error: 'Image generation failed: response did not contain image data.' }
  }

  const imageDir = ensureGeneratedImageDir()
  const suffix = Math.random().toString(36).slice(2, 8)
  const filePath = path.join(imageDir, `generated-image-${normalizeTimestampForFile()}-${suffix}.png`)
  if (imageResult.base64) {
    fs.writeFileSync(filePath, Buffer.from(imageResult.base64, 'base64'))
  } else {
    const imageResponse = await fetch(imageResult.url, {
      signal: requestSignal
    })
    if (!imageResponse.ok) {
      const errorText = await imageResponse.text().catch(() => '')
      return { success: false, error: `Image generation failed: image URL download HTTP ${imageResponse.status} ${errorText.slice(0, 300)}` }
    }
    fs.writeFileSync(filePath, Buffer.from(await imageResponse.arrayBuffer()))
  }
  const preview = await buildImagePreviewPayload(filePath, { thumbWidth: 420 })

  return {
    success: true,
    file_type: 'image',
    kind: 'generated_image',
    path: filePath,
    modelName: imageModel,
    providerModelName: imageGenerationModel.modelName || imageGenerationModel.modelId || imageModel,
    prompt,
    width: preview.width || null,
    height: preview.height || null,
    format: 'png',
    thumbnailDataUrl: preview.thumbnailDataUrl,
    thumbnailWidth: preview.thumbnailWidth,
    thumbnailHeight: preview.thumbnailHeight,
    message: `Image generated: ${filePath}`
  }
}

const handlers = {
  generate_image: async (args, ctx) => {
    const { projectId, modelConfig } = ctx
    try {
      return await generateImageWithModel(projectId, args, modelConfig)
    } catch (e) {
      if (e?.name === 'TimeoutError') {
        const seconds = Math.round(Math.max(10000, Math.min(Number(args.timeout_ms || args.timeoutMs || args.timeout || 300000), 900000)) / 1000)
        return { success: false, status: 'timeout', error: `Image generation timed out after ${seconds} seconds. The request was cancelled.` }
      }
      if (e?.name === 'AbortError') {
        return { success: false, status: 'aborted', aborted: true, error: 'Image generation was cancelled.' }
      }
      return { success: false, error: e.message }
    }
  },

  render_svg_asset: async (args, ctx) => {
    const { resolvePath, projectId, projectPath } = ctx
    try {
      const outputPath = resolvePath(args.output_path)
      await ensureSafetyBaselineBeforeWrite(projectId, projectPath, [outputPath])
      const existedBefore = fs.existsSync(outputPath)
      if (projectId) {
        await safelyRecordChange(() => require('../change-sessions').recordFileBeforeAsync(projectId, outputPath, existedBefore ? 'modify' : 'create'))
      }
      const result = await renderSvgAsset(args, resolvePath)
      if (projectId && result?.success) {
        await safelyRecordChange(() => require('../change-sessions').recordFileAfterAsync(projectId, outputPath, existedBefore ? 'modify' : 'create'))
      }
      return result
    } catch (e) {
      return { success: false, error: e.message }
    }
  }
}

module.exports = {
  handlers,
  getImageFormat,
  renderSvgAsset,
  ensureGeneratedImageDir,
  cleanupExpiredGeneratedImages,
  buildImageGenerationEndpoint,
  buildImageGenerationRequestEndpoint,
  buildGenerationAuthHeaders,
  getImageProviderKind,
  extractGeneratedImageBase64,
  extractGeneratedImageUrl,
  normalizeGenerationPrompt,
  readImageGenerationResponse,
  generateImageWithModel
}
