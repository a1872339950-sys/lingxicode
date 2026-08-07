/**
 * 视觉工具处理器
 * 包含：inspect_image, view_image 工具及相关辅助函数
 */

const fs = require('fs')
const path = require('path')
const config = require('../config')
const projects = require('../projects')
const storageConfig = require('../storage-config')
const { analyzeImagesWithVisionModel } = require('../vision-relay')
const { hasCapability, normalizeModel } = require('../model-capabilities')
const { hasApiKey } = require('../api-key')
const {
  createAskRequestId,
  waitForAskResponse,
  getResultLabel
} = require('../ask-permission')
const { IMAGE_FILE_EXTENSIONS } = require('../text-edit-utils')
const { buildImagePreviewPayload } = require('./screenshot')
const { sendThinkingEvent } = require('../thinking-event-sender')

function isImagePath(filePath) {
  return IMAGE_FILE_EXTENSIONS.has(path.extname(filePath || '').toLowerCase())
}

function toVisionModelConfig(model) {
  if (!model) return null
  const normalized = normalizeModel(model)
  const modelId = normalized.modelId || normalized.modelName
  const hasCredential = hasApiKey(normalized.apiKey)
  if (!normalized.apiUrl || !hasCredential || !modelId) return null
  return {
    ...normalized,
    modelId,
    modelName: normalized.modelName || modelId
  }
}

function getModelRoutingKey(model) {
  if (!model || typeof model !== 'object') return ''
  if (model.modelKey && String(model.modelKey).trim()) return String(model.modelKey).trim()
  const parts = [
    model.provider,
    model.apiUrl,
    model.modelId || model.modelName,
    model.modelName
  ].filter(value => value !== undefined && value !== null && String(value).trim() !== '')
  return parts.map(value => String(value).trim()).join('::')
}

async function findCapabilityModel(capabilityKey, currentModelConfig) {
  const apiConfig = storageConfig.getApiConfig()
  const customModels = apiConfig?.success && Array.isArray(apiConfig.data?.models) ? apiConfig.data.models : []
  const routing = apiConfig?.success && apiConfig.data?.capabilityRouting && typeof apiConfig.data.capabilityRouting === 'object'
    ? apiConfig.data.capabilityRouting
    : {}
  const configuredOrder = Array.isArray(routing[capabilityKey]) ? routing[capabilityKey].map(value => String(value || '').trim()).filter(Boolean) : []
  const normalizedModels = customModels.map(toVisionModelConfig)
    .filter(model => model && hasCapability(model, capabilityKey))

  if (configuredOrder.length > 0) {
    const byKey = new Map(normalizedModels.map(model => [getModelRoutingKey(model), model]))
    for (const modelKey of configuredOrder) {
      const model = byKey.get(modelKey)
      if (model) return model
    }
    return normalizedModels[0] || null
  }

  const current = toVisionModelConfig(currentModelConfig)
  if (current && hasCapability(current, capabilityKey)) return current
  return normalizedModels[0] || null
}

async function findVisionModel(currentModelConfig) {
  return findCapabilityModel('vision', currentModelConfig)
}

async function findImageGenerationModel(currentModelConfig) {
  return findCapabilityModel('imageGeneration', currentModelConfig)
}

async function findMusicGenerationModel(currentModelConfig) {
  return findCapabilityModel('musicGeneration', currentModelConfig)
}

async function findVideoGenerationModel(currentModelConfig) {
  return findCapabilityModel('videoGeneration', currentModelConfig)
}

function getCapabilityPolicies() {
  const apiConfig = storageConfig.getApiConfig()
  const policies = apiConfig?.success && apiConfig.data?.capabilityPolicies && typeof apiConfig.data.capabilityPolicies === 'object'
    ? apiConfig.data.capabilityPolicies
    : {}
  return {
    imageGenerationConfirm: policies.imageGenerationConfirm === 'always' ? 'always' : 'never',
    visionConfirm: policies.visionConfirm === 'always' ? 'always' : 'never'
  }
}

function isCurrentVisionModel(currentModelConfig, visionModel) {
  const current = toVisionModelConfig(currentModelConfig)
  if (!current || !visionModel) return false
  const currentKey = getModelRoutingKey(current) || `${current.apiUrl}::${current.modelId}`
  const visionKey = getModelRoutingKey(visionModel) || `${visionModel.apiUrl}::${visionModel.modelId}`
  return currentKey === visionKey
}

async function askVisionPermission(projectId, imagePath, visionModel, question) {
  const webContents = projectId ? projects.getWebContentsForProject(projectId) : config.getMainWindow()?.webContents
  if (!webContents) {
    return { success: false, status: 'user_rejected', message: '无法显示视觉模型授权弹窗' }
  }

  const requestId = createAskRequestId(projectId, 'vision')
  const modelName = visionModel.modelName || visionModel.modelId
  sendThinkingEvent(webContents, projectId, {
    kind: 'progress',
    content: `需要调用视觉模型「${modelName}」分析图片，等待你确认。`
  })
  webContents.send('show-ask-popup', {
    requestId,
    type: 'plan',
    projectId,
    question: `是否允许调用视觉模型「${modelName}」分析图片「${path.basename(imagePath)}」？`,
    options: [
      {
        label: '允许分析',
        value: 'approved',
        desc: question ? `重点：${String(question).slice(0, 80)}` : '把图片内容转成文字结论给当前模型使用'
      },
      {
        label: '不调用',
        value: 'rejected',
        desc: '只保留图片路径和元数据，不读取图片视觉内容'
      }
    ],
    recommended: 'approved'
  })
  return waitForAskResponse(projectId, requestId)
}

async function askImageGenerationPermission(projectId, prompt, generationModel) {
  const webContents = projectId ? projects.getWebContentsForProject(projectId) : config.getMainWindow()?.webContents
  if (!webContents) {
    return { success: false, status: 'user_rejected', message: 'Unable to show image generation permission popup' }
  }

  const requestId = createAskRequestId(projectId, 'image_generation')
  const modelName = generationModel.modelName || generationModel.modelId || 'image model'
  sendThinkingEvent(webContents, projectId, {
    kind: 'progress',
    content: `需要生成图片，等待你确认是否调用文生图模型「${modelName}」。`
  })
  webContents.send('show-ask-popup', {
    requestId,
    type: 'plan',
    projectId,
    question: `是否允许调用文生图模型「${modelName}」生成图片？`,
    options: [
      {
        label: '允许生成',
        value: 'approved',
        desc: prompt ? `提示词：${String(prompt).slice(0, 80)}` : '按当前需求生成图片'
      },
      {
        label: '不生成',
        value: 'rejected',
        desc: '跳过本次图片生成'
      }
    ],
    recommended: 'approved'
  })
  return waitForAskResponse(projectId, requestId)
}

async function inspectImageWithPermission(projectId, args = {}, resolvePath, modelConfig) {
  const imagePath = resolvePath(args.path)
  if (!fs.existsSync(imagePath)) {
    return { success: false, error: `图片不存在: ${imagePath}` }
  }
  if (!fs.statSync(imagePath).isFile()) {
    return { success: false, error: `不是文件: ${imagePath}` }
  }
  if (!isImagePath(imagePath)) {
    return { success: false, error: `不是支持的图片格式: ${imagePath}` }
  }

  const visionModel = await findVisionModel(modelConfig)
  if (!visionModel) {
    return {
      success: false,
      status: 'no_vision_model',
      path: imagePath,
      message: '当前没有配置具备“视觉理解”能力的模型，无法分析图片内容。请在模型设置中标注视觉模型能力。'
    }
  }

  const usingCurrentVisionModel = isCurrentVisionModel(modelConfig, visionModel)
  const capabilityPolicies = getCapabilityPolicies()
  const shouldAskVisionPermission = !usingCurrentVisionModel && args.skipPermission !== true && capabilityPolicies.visionConfirm === 'always'
  if (shouldAskVisionPermission) {
    const permission = await askVisionPermission(projectId, imagePath, visionModel, args.question || '')
    const permissionValue = getResultLabel(permission)
    if (!permission.success || permissionValue === 'rejected') {
      return {
        success: false,
        status: 'user_rejected',
        path: imagePath,
        message: '用户拒绝调用视觉模型，未读取图片视觉内容。'
      }
    }
  } else {
    const webContents = projectId ? projects.getWebContentsForProject(projectId) : config.getMainWindow()?.webContents
    sendThinkingEvent(webContents, projectId, {
      kind: 'progress',
      content: `当前模型具备视觉理解，正在直接分析图片「${path.basename(imagePath)}」。`
    })
  }

  const signal = projectId ? config.getAbortController(projectId)?.signal : undefined
  const analysis = await analyzeImagesWithVisionModel({
    visionModelConfig: visionModel,
    imageDataList: [{ path: imagePath, name: path.basename(imagePath) }],
    userMessage: args.question || '请分析这张图片中可见的 UI、布局、文字、颜色、错位或异常。',
    signal
  })
  const preview = await buildImagePreviewPayload(imagePath, { thumbWidth: 360 }).catch(() => ({}))

  return {
    success: true,
    file_type: 'image_analysis',
    kind: 'vision_inspection',
    path: imagePath,
    modelName: analysis.modelName || visionModel.modelName || visionModel.modelId,
    imageNames: analysis.imageNames || [path.basename(imagePath)],
    summary: analysis.summary,
    thumbnailDataUrl: preview.thumbnailDataUrl || null,
    width: preview.width || null,
    height: preview.height || null,
    format: preview.format || path.extname(imagePath).replace('.', ''),
    message: '视觉分析完成'
  }
}

const handlers = {
  inspect_image: async (args, ctx) => {
    const { resolvePath, projectId, modelConfig } = ctx
    try {
      return await inspectImageWithPermission(projectId, args, resolvePath, modelConfig)
    } catch (e) {
      return { success: false, error: e.message }
    }
  },

  view_image: async (args, ctx) => {
    const { resolvePath, projectId, modelConfig } = ctx
    try {
      return await inspectImageWithPermission(projectId, args, resolvePath, modelConfig)
    } catch (e) {
      return { success: false, error: e.message }
    }
  }
}

module.exports = {
  handlers,
  isImagePath,
  toVisionModelConfig,
  getModelRoutingKey,
  findCapabilityModel,
  findVisionModel,
  findImageGenerationModel,
  findMusicGenerationModel,
  findVideoGenerationModel,
  getCapabilityPolicies,
  isCurrentVisionModel,
  askVisionPermission,
  askImageGenerationPermission,
  inspectImageWithPermission
}
