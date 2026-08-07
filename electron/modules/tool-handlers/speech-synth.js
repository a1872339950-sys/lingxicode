/**
 * 语音合成工具处理器
 * 包含：text_to_speech 工具
 * 通用多厂商适配，支持火山引擎/阿里云/微软Azure/OpenAI/MiniMax等
 */

const fs = require('fs')
const path = require('path')
const storageConfig = require('../storage-config')
const { resolveApiKey } = require('../api-key')
const { hasCapability, normalizeModel } = require('../model-capabilities')
const { findCapabilityModel } = require('./vision')
const { detectProvider, pickAdapter } = require('./speech-adapters')
const { sendThinkingEvent } = require('../thinking-event-sender')
const { buildImagePreviewPayload, normalizeTimestampForFile } = require('./screenshot')

const GENERATED_AUDIO_MAX_AGE_MS = 24 * 60 * 60 * 1000
const GENERATED_AUDIO_CLEANUP_INTERVAL_MS = 10 * 60 * 1000
let lastGeneratedAudioCleanupAt = 0

function ensureGeneratedAudioDir() {
  const audioDir = path.join(storageConfig.getCacheDir(), 'generated-media', 'tts')
  if (!fs.existsSync(audioDir)) {
    fs.mkdirSync(audioDir, { recursive: true })
  }
  cleanupExpiredGeneratedAudio()
  return audioDir
}

function cleanupExpiredGeneratedAudio() {
  const now = Date.now()
  if (now - lastGeneratedAudioCleanupAt < GENERATED_AUDIO_CLEANUP_INTERVAL_MS) return
  lastGeneratedAudioCleanupAt = now
  try {
    const baseDir = path.join(storageConfig.getCacheDir(), 'generated-media', 'tts')
    if (!fs.existsSync(baseDir)) return
    for (const fileName of fs.readdirSync(baseDir)) {
      const filePath = path.join(baseDir, fileName)
      try {
        const stat = fs.statSync(filePath)
        if (stat.isFile() && now - stat.mtimeMs > GENERATED_AUDIO_MAX_AGE_MS) {
          fs.unlinkSync(filePath)
        }
      } catch {}
    }
  } catch {}
}

function toSpeechModelConfig(model) {
  if (!model) return null
  const normalized = normalizeModel(model)
  const modelId = normalized.modelId || normalized.modelName
  const hasCredential = !!resolveApiKey(normalized.apiKey)
  if (!normalized.apiUrl || !hasCredential || !modelId) return null
  return {
    ...normalized,
    modelId,
    modelName: normalized.modelName || modelId
  }
}

async function findSpeechSynthesisModel(currentModelConfig) {
  return findCapabilityModel('speechSynthesis', currentModelConfig)
}

async function generateSpeechWithModel(projectId, args, modelConfig) {
  const speechModel = await findSpeechSynthesisModel(modelConfig)
  if (!speechModel) {
    return {
      success: false,
      status: 'no_speech_model',
      message: '当前没有配置具备"语音合成"能力的模型。请在模型设置中添加 TTS 模型并勾选"语音合成"能力。'
    }
  }

  const apiKey = resolveApiKey(speechModel.apiKey)

  const audioDir = ensureGeneratedAudioDir()
  const provider = detectProvider(speechModel, args)
  const adapter = pickAdapter(provider)

  const ctx = {
    args,
    modelConfig: speechModel,
    apiKey,
    audioDir
  }

  const result = await adapter(ctx)
  const filePath = result.filePath
  const fileName = path.basename(filePath)
  const stat = fs.statSync(filePath)

  // 构建音频预览数据
  const preview = buildAudioPreviewPayload(filePath)

  return {
    success: true,
    kind: 'generated_speech',
    file_type: 'audio',
    path: filePath,
    file_path: filePath,
    file_name: fileName,
    format: result.format,
    provider: result.provider,
    model: speechModel.modelName || speechModel.modelId,
    voice: args.voice || 'default',
    size: stat.size,
    duration: null,
    thumbnailDataUrl: preview?.thumbnailDataUrl || null,
    message: `语音合成完成 (${result.provider}): ${fileName}`
  }
}

/**
 * 生成音频预览 payload（用于前端工具卡片展示）
 */
function buildAudioPreviewPayload(filePath) {
  try {
    const fileName = path.basename(filePath)
    const stat = fs.statSync(filePath)
    return {
      fileName,
      size: stat.size,
      thumbnailDataUrl: null
    }
  } catch {
    return null
  }
}

const handlers = {
  text_to_speech: async (args, ctx) => {
    const { projectId, modelConfig } = ctx
    try {
      // 发送思考事件
      const webContents = projectId ? require('../projects').getWebContentsForProject(projectId) : null
      if (webContents) {
        sendThinkingEvent(webContents, projectId, {
          kind: 'progress',
          content: `正在合成语音：${String(args.text || '').slice(0, 50)}...`
        })
      }

      if (!args.text || !String(args.text).trim()) {
        return { success: false, error: '缺少要合成的文本内容（text 参数）' }
      }

      return await generateSpeechWithModel(projectId, args, modelConfig)
    } catch (e) {
      return { success: false, error: e.message }
    }
  }
}

module.exports = {
  handlers,
  ensureGeneratedAudioDir,
  cleanupExpiredGeneratedAudio,
  findSpeechSynthesisModel,
  generateSpeechWithModel,
  toSpeechModelConfig
}
