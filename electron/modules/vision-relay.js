const fs = require('fs')
const fsp = require('fs/promises')
const path = require('path')
const sharp = require('sharp')
const { resolveApiKey, hasApiKey } = require('./api-key')

const MAX_INLINE_IMAGE_BYTES = 8 * 1024 * 1024
const MAX_SOURCE_IMAGE_BYTES = 30 * 1024 * 1024
const MAX_IMAGE_DIMENSION = 1800
const IMAGE_QUALITY = 82

const imageExtensionToMime = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.bmp': 'image/bmp',
  '.webp': 'image/webp'
}

function buildChatCompletionsEndpoint(apiUrl = '') {
  let apiEndpoint = String(apiUrl || '').trim()
  if (!apiEndpoint.endsWith('/chat/completions')) {
    apiEndpoint = apiEndpoint.replace(/\/$/, '') + '/chat/completions'
  }
  return apiEndpoint
}

function getImageMime(image) {
  if (image?.type && String(image.type).startsWith('image/')) return image.type
  const ext = path.extname(image?.name || image?.path || '').toLowerCase()
  return imageExtensionToMime[ext] || 'image/png'
}

function combineAbortSignals(...signals) {
  const controller = new AbortController()
  function abort() {
    if (!controller.signal.aborted) controller.abort()
  }
  signals.filter(Boolean).forEach(signal => {
    if (signal.aborted) abort()
    else signal.addEventListener('abort', abort, { once: true })
  })
  return controller.signal
}

async function imageToDataUri(image) {
  const mime = getImageMime(image)
  if (image?.data) {
    const estimatedBytes = Math.ceil(String(image.data).length * 0.75)
    if (estimatedBytes > MAX_INLINE_IMAGE_BYTES) {
      throw new Error(`图片超过 ${Math.round(MAX_INLINE_IMAGE_BYTES / 1024 / 1024)}MB，请使用文件路径或压缩后再发送`)
    }
    return {
      name: image.name || path.basename(image.path || 'image'),
      url: `data:${mime};base64,${image.data}`
    }
  }
  if (image?.path) {
    const absolutePath = path.resolve(image.path)
    const stat = await fsp.stat(absolutePath)
    const maxImageBytes = MAX_SOURCE_IMAGE_BYTES
    if (stat.size > maxImageBytes) {
      throw new Error(`图片超过 ${Math.round(maxImageBytes / 1024 / 1024)}MB，已拒绝读取`)
    }
    const sourceBuffer = await fsp.readFile(absolutePath)
    let buffer = sourceBuffer
    let outputMime = mime
    try {
      buffer = await sharp(sourceBuffer)
        .rotate()
        .resize({
          width: MAX_IMAGE_DIMENSION,
          height: MAX_IMAGE_DIMENSION,
          fit: 'inside',
          withoutEnlargement: true
        })
        .jpeg({ quality: IMAGE_QUALITY, mozjpeg: true })
        .toBuffer()
      outputMime = 'image/jpeg'
    } catch (error) {
      buffer = sourceBuffer
    }
    if (buffer.length > MAX_INLINE_IMAGE_BYTES) {
      throw new Error(`图片压缩后仍超过 ${Math.round(MAX_INLINE_IMAGE_BYTES / 1024 / 1024)}MB，已跳过视觉分析`)
    }
    return {
      name: image.name || path.basename(absolutePath),
      url: `data:${outputMime};base64,${buffer.toString('base64')}`
    }
  }
  return null
}

async function prepareImages(imageDataList = []) {
  const prepared = []
  for (const image of imageDataList) {
    try {
      prepared.push(await imageToDataUri(image))
    } catch (error) {
      prepared.push({
        name: image?.name || image?.path || 'unknown',
        error: error.message
      })
    }
  }
  return prepared.filter(Boolean)
}

async function analyzeImagesWithVisionModel({ visionModelConfig, imageDataList, userMessage, signal }) {
  if (!visionModelConfig?.apiUrl || !hasApiKey(visionModelConfig?.apiKey)) {
    throw new Error('视觉模型配置不完整')
  }

  const modelId = visionModelConfig.modelId || visionModelConfig.modelName
  if (!modelId) throw new Error('视觉模型缺少模型 ID')

  const preparedImages = await prepareImages(imageDataList)
  const validImages = preparedImages.filter(image => image.url)
  if (validImages.length === 0) {
    const failures = preparedImages.filter(image => image.error).map(image => `${image.name}: ${image.error}`).join('; ')
    throw new Error(failures || '没有可分析的图片')
  }

  const content = [
    {
      type: 'text',
      text: [
        '请分析用户上传的图片，输出给另一个文本模型使用的中立事实摘要。',
        '要求：',
        '- 不要替用户完成最终任务，只描述图片中能确认的内容。',
        '- 包含构图、主体、文字、颜色、界面元素、可见路径或文件名。',
        '- 对不确定内容明确写“不确定”。',
        '- 使用中文，控制在 500 字以内。',
        '',
        `用户原始需求：${userMessage || '未提供'}`
      ].join('\n')
    },
    ...validImages.map(image => ({
      type: 'image_url',
      image_url: { url: image.url }
    }))
  ]

  const timeoutMs = Number.isFinite(visionModelConfig.timeoutMs) ? visionModelConfig.timeoutMs : 60000
  const timeoutController = new AbortController()
  const timeoutId = setTimeout(() => timeoutController.abort(), timeoutMs)
  const requestSignal = combineAbortSignals(signal, timeoutController.signal)

  let response
  try {
    const headers = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${resolveApiKey(visionModelConfig.apiKey)}`
    }

    response = await fetch(buildChatCompletionsEndpoint(visionModelConfig.apiUrl), {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: modelId,
      messages: [{ role: 'user', content }],
      stream: false
    }),
      signal: requestSignal
    })
  } catch (error) {
    if (timeoutController.signal.aborted && !signal?.aborted) {
      throw new Error(`视觉模型调用超时（${Math.round(timeoutMs / 1000)}秒）`)
    }
    throw error
  } finally {
    clearTimeout(timeoutId)
  }

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`视觉模型调用失败 ${response.status}: ${errorText.substring(0, 200)}`)
  }

  const data = await response.json()
  const summary = data?.choices?.[0]?.message?.content
  if (!summary) throw new Error('视觉模型未返回有效分析内容')

  return {
    modelName: visionModelConfig.modelName || modelId,
    imageNames: validImages.map(image => image.name),
    summary
  }
}

function buildImageMetadataNote(imageDataList = []) {
  if (!imageDataList.length) return ''
  const lines = imageDataList.map((image, index) => {
    const name = image.name || path.basename(image.path || '') || `image-${index + 1}`
    const source = image.path ? `路径: ${image.path}` : '来源: 浏览器上传'
    return `- ${name}（${source}）`
  })
  return [
    '【图片说明】',
    '当前主模型未接收图片视觉内容，仅能看到以下图片元数据。不要声称已经理解图片画面。',
    ...lines
  ].join('\n')
}

/**
 * 读取图片真实宽高，供工具 UI 舞台比例使用（避免默认 1:1 上下 letterbox）。
 * 支持本地路径、data URL、纯 base64。
 */
async function probeImageDimensions(image = {}) {
  try {
    let input = null
    const filePath = String(image.path || '').trim()
    if (filePath) {
      const absolutePath = path.resolve(filePath)
      if (fs.existsSync(absolutePath)) input = absolutePath
    }
    if (!input) {
      const raw = String(image.data || image.url || image.preview || '').trim()
      if (!raw) return { width: null, height: null }
      const base64 = raw.includes('base64,') ? raw.split('base64,').pop() : raw
      if (!base64) return { width: null, height: null }
      input = Buffer.from(base64, 'base64')
    }
    const meta = await sharp(input).rotate().metadata()
    return {
      width: meta.width || null,
      height: meta.height || null
    }
  } catch {
    return { width: null, height: null }
  }
}

module.exports = {
  analyzeImagesWithVisionModel,
  buildImageMetadataNote,
  prepareImages,
  probeImageDimensions
}
