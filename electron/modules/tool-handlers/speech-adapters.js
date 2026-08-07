/**
 * 语音合成适配器模块
 * 每个厂商一个 adapter 函数，统一输入输出接口。
 * 新增厂商只需在此添加 adapter 并在 pickAdapter 中注册。
 */

const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

/**
 * 从模型配置和参数推断厂商类型
 */
function detectProvider(modelConfig, args = {}) {
  const apiUrl = String(modelConfig?.apiUrl || '').toLowerCase()
  const modelId = String(modelConfig?.modelId || modelConfig?.modelName || '').toLowerCase()
  const provider = String(modelConfig?.provider || '').toLowerCase()

  // 火山引擎：openspeech / volcengine / bytedance
  if (/volcengine|bytedance|openspeech/.test(apiUrl + provider)) return 'volcengine'
  // 阿里云
  if (/dashscope|aliyun|alibaba/.test(apiUrl + provider)) return 'aliyun'
  // 微软 Azure
  if (/azure|microsoft/.test(apiUrl + provider)) return 'azure'
  // OpenAI TTS
  if (/openai|api\.openai/.test(apiUrl + provider)) return 'openai'
  // MiniMax
  if (/minimax/.test(apiUrl + provider)) return 'minimax'
  // 腾讯云
  if (/tencent|tcloud/.test(apiUrl + provider)) return 'tencent'
  // 通用兼容：如果 URL 包含 /audio/speech 走 openai 兼容
  if (/\/audio\/speech/.test(apiUrl)) return 'openai'
  // 默认走 openai 兼容
  return 'openai'
}

/**
 * 统一的音频保存函数
 */
function saveAudioFile(audioDir, buffer, format = 'mp3') {
  const ext = String(format).toLowerCase().replace(/[^a-z0-9]/g, '') || 'mp3'
  const fileName = `tts-${Date.now()}-${crypto.randomBytes(4).toString('hex')}.${ext}`
  const filePath = path.join(audioDir, fileName)
  fs.writeFileSync(filePath, buffer)
  return filePath
}

/**
 * 下载 URL 音频到本地
 */
async function downloadAudio(url, audioDir, format, apiKey) {
  const https = require('https')
  const http = require('http')
  const client = url.startsWith('https') ? https : http

  return new Promise((resolve, reject) => {
    const options = {}
    if (apiKey) options.headers = { Authorization: `Bearer ${apiKey}` }
    client.get(url, options, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return downloadAudio(res.headers.location, audioDir, format, apiKey).then(resolve).catch(reject)
      }
      if (res.statusCode !== 200) {
        reject(new Error(`音频下载失败: HTTP ${res.statusCode}`))
        return
      }
      const chunks = []
      res.on('data', chunk => chunks.push(chunk))
      res.on('end', () => {
        const buffer = Buffer.concat(chunks)
        resolve(saveAudioFile(audioDir, buffer, format))
      })
      res.on('error', reject)
    }).on('error', reject)
  })
}

// ============================================================
// 厂商适配器
// ============================================================

/**
 * OpenAI 兼容 TTS（也适用于其他 OpenAI 兼容接口）
 * POST /v1/audio/speech
 */
async function openaiAdapter(ctx) {
  const { args, modelConfig, apiKey, audioDir } = ctx
  const apiUrl = modelConfig.apiUrl.replace(/\/$/, '')
  const endpoint = /\/audio\/speech$/.test(apiUrl) ? apiUrl
    : /\/v1\/?$/.test(apiUrl) ? apiUrl.replace(/\/?$/, '') + '/audio/speech'
    : /\/(chat\/completions|responses)$/.test(apiUrl) ? apiUrl.replace(/\/(chat\/completions|responses)$/, '/audio/speech')
    : apiUrl.replace(/\/?$/, '') + '/v1/audio/speech'

  const body = {
    model: modelConfig.modelId || modelConfig.modelName || args.model || 'tts-1',
    input: String(args.text || '').slice(0, 4096),
    voice: args.voice || 'alloy',
    response_format: args.format || 'mp3',
    speed: Number(args.speed) || 1
  }
  if (args.instructions) body.instructions = String(args.instructions).slice(0, 500)

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {})
    },
    body: JSON.stringify(body)
  })

  if (!res.ok) {
    const errText = await res.text().catch(() => '')
    throw new Error(`语音合成失败 (OpenAI兼容): HTTP ${res.status} ${errText.slice(0, 500)}`)
  }

  const buffer = Buffer.from(await res.arrayBuffer())
  return {
    filePath: saveAudioFile(audioDir, buffer, body.response_format),
    format: body.response_format,
    provider: 'openai'
  }
}

/**
 * 火山引擎 TTS
 * 支持 HTTP REST 方式调用
 * 文档参考: https://docs.volcengine.com/docs/82379/2516286
 */
async function volcengineAdapter(ctx) {
  const { args, modelConfig, apiKey, audioDir } = ctx
  const apiUrl = String(modelConfig.apiUrl || '').replace(/\/$/, '')

  // 火山引擎 TTS 有两种常见调用方式：
  // 1. WebSocket 方式（需要鉴权签名，较复杂）
  // 2. HTTP REST 方式（部分模型支持）
  // 这里优先走 HTTP REST，如果 URL 不匹配则回退到 OpenAI 兼容格式
  let endpoint = apiUrl
  if (!/\/api\/v1\/tts/.test(apiUrl) && !/\/audio\/speech/.test(apiUrl)) {
    // 尝试拼接为 OpenAI 兼容的 audio/speech 端点
    endpoint = apiUrl.replace(/\/?$/, '') + '/api/v1/tts'
  }

  const body = {
    app: {
      appid: args.app_id || modelConfig.appId || '',
      token: apiKey || '',
      cluster: args.cluster || modelConfig.cluster || 'volcano_tts'
    },
    user: { uid: args.uid || 'lingxi' },
    audio: {
      voice_type: args.voice || args.voice_type || 'BV001_streaming',
      encoding: args.format || 'mp3',
      speed_ratio: Number(args.speed) || 1.0,
      volume_ratio: Number(args.volume) || 1.0,
      pitch_ratio: Number(args.pitch) || 1.0
    },
    request: {
      reqid: crypto.randomUUID(),
      text: String(args.text || '').slice(0, 1024),
      text_type: 'plain',
      operation: 'query'
    }
  }

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer;${apiKey || ''}`
    },
    body: JSON.stringify(body)
  })

  if (!res.ok) {
    const errText = await res.text().catch(() => '')
    throw new Error(`语音合成失败 (火山引擎): HTTP ${res.status} ${errText.slice(0, 500)}`)
  }

  const result = await res.json()
  // 火山引擎返回 base64 音频
  if (result.data) {
    const buffer = Buffer.from(result.data, 'base64')
    return {
      filePath: saveAudioFile(audioDir, buffer, body.audio.encoding),
      format: body.audio.encoding,
      provider: 'volcengine'
    }
  }
  throw new Error(`火山引擎 TTS 未返回音频数据: ${JSON.stringify(result).slice(0, 300)}`)
}

/**
 * 阿里云 DashScope TTS（CosyVoice / Sambert）
 * 参考: https://help.aliyun.com/zh/dashscope/developer-reference/voice-generation
 */
async function aliyunAdapter(ctx) {
  const { args, modelConfig, apiKey, audioDir } = ctx
  const apiUrl = String(modelConfig.apiUrl || '').replace(/\/$/, '')

  // 阿里云 DashScope 语音合成有两种模式：
  // 1. 同步调用（CosyVoice 等）
  // 2. 异步任务轮询
  // 优先走同步，部分模型支持 WebSocket 但这里走 REST
  const endpoint = /\/api\/v1\/services\/audio\/tts/.test(apiUrl)
    ? apiUrl
    : apiUrl + '/api/v1/services/audio/tts/generation'

  const body = {
    model: modelConfig.modelId || modelConfig.modelName || args.model || 'cosyvoice-v1',
    input: {
      text: String(args.text || '').slice(0, 5000)
    },
    parameters: {
      voice: args.voice || 'longxiaochun',
      format: args.format || 'mp3',
      sample_rate: Number(args.sample_rate) || 22050,
      volume: Number(args.volume) || 50,
      speech_rate: Number(args.speed) || 1.0,
      pitch_rate: Number(args.pitch) || 1.0
    }
  }

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey || ''}`,
      'X-DashScope-DataInspection': 'enable'
    },
    body: JSON.stringify(body)
  })

  if (!res.ok) {
    const errText = await res.text().catch(() => '')
    throw new Error(`语音合成失败 (阿里云): HTTP ${res.status} ${errText.slice(0, 500)}`)
  }

  const result = await res.json()

  // 阿里云同步返回 audio.url 或 base64
  if (result.output?.audio?.url) {
    const filePath = await downloadAudio(result.output.audio.url, audioDir, body.parameters.format, apiKey)
    return { filePath, format: body.parameters.format, provider: 'aliyun' }
  }
  if (result.output?.audio?.data) {
    const buffer = Buffer.from(result.output.audio.data, 'base64')
    return {
      filePath: saveAudioFile(audioDir, buffer, body.parameters.format),
      format: body.parameters.format,
      provider: 'aliyun'
    }
  }
  throw new Error(`阿里云 TTS 未返回音频数据: ${JSON.stringify(result).slice(0, 300)}`)
}

/**
 * 微软 Azure TTS
 * 参考: https://learn.microsoft.com/azure/ai-services/speech-service/
 */
async function azureAdapter(ctx) {
  const { args, modelConfig, apiKey, audioDir } = ctx
  const apiUrl = String(modelConfig.apiUrl || '').replace(/\/$/, '')

  const region = args.region || modelConfig.region || 'eastus'
  const endpoint = `https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`

  const ssml = `<speak version='1.0' xml:lang='${args.language || 'zh-CN'}'>
    <voice name='${args.voice || 'zh-CN-XiaoxiaoNeural'}'>
      ${String(args.text || '').replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c])).slice(0, 5000)}
    </voice>
  </speak>`

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/ssml+xml',
      'X-Microsoft-OutputFormat': `audio-${args.format || 'mp3'}-22050hz-32kbitrate-mono`,
      'Ocp-Apim-Subscription-Key': apiKey || ''
    },
    body: ssml
  })

  if (!res.ok) {
    const errText = await res.text().catch(() => '')
    throw new Error(`语音合成失败 (Azure): HTTP ${res.status} ${errText.slice(0, 500)}`)
  }

  const buffer = Buffer.from(await res.arrayBuffer())
  return {
    filePath: saveAudioFile(audioDir, buffer, args.format || 'mp3'),
    format: args.format || 'mp3',
    provider: 'azure'
  }
}

/**
 * MiniMax TTS
 * 参考: https://www.minimaxi.com/document/T2A%20V2
 */
async function minimaxAdapter(ctx) {
  const { args, modelConfig, apiKey, audioDir } = ctx
  const apiUrl = String(modelConfig.apiUrl || '').replace(/\/$/, '')

  const endpoint = /\/v1\/t2a_v2/.test(apiUrl)
    ? apiUrl
    : apiUrl.replace(/\/?$/, '') + '/v1/t2a_v2'

  const body = {
    model: modelConfig.modelId || modelConfig.modelName || args.model || 'speech-01-turbo',
    text: String(args.text || '').slice(0, 5000),
    stream: false,
    voice_setting: {
      voice_id: args.voice || 'male-qn-qingse',
      speed: Number(args.speed) || 1.0,
      vol: Number(args.volume) || 1.0,
      pitch: Number(args.pitch) || 0
    },
    audio_setting: {
      sample_rate: Number(args.sample_rate) || 32000,
      bitrate: Number(args.bitrate) || 128000,
      format: args.format || 'mp3',
      channel: 1
    }
  }

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey || ''}`
    },
    body: JSON.stringify(body)
  })

  if (!res.ok) {
    const errText = await res.text().catch(() => '')
    throw new Error(`语音合成失败 (MiniMax): HTTP ${res.status} ${errText.slice(0, 500)}`)
  }

  const result = await res.json()

  if (result.data?.audio) {
    const buffer = Buffer.from(result.data.audio, 'hex')
    return {
      filePath: saveAudioFile(audioDir, buffer, body.audio_setting.format),
      format: body.audio_setting.format,
      provider: 'minimax'
    }
  }
  if (result.data?.audio_url) {
    const filePath = await downloadAudio(result.data.audio_url, audioDir, body.audio_setting.format, apiKey)
    return { filePath, format: body.audio_setting.format, provider: 'minimax' }
  }
  throw new Error(`MiniMax TTS 未返回音频数据: ${JSON.stringify(result).slice(0, 300)}`)
}

/**
 * 腾讯云 TTS
 * 参考: https://cloud.tencent.com/document/product/1073
 * 注意：腾讯云通常需要 SDK 签名，这里走简化 HTTP 接口
 */
async function tencentAdapter(ctx) {
  // 腾讯云需要复杂签名，回退到 OpenAI 兼容方式
  return openaiAdapter(ctx)
}

// ============================================================
// 适配器选择
// ============================================================

const ADAPTERS = {
  openai: openaiAdapter,
  volcengine: volcengineAdapter,
  aliyun: aliyunAdapter,
  azure: azureAdapter,
  minimax: minimaxAdapter,
  tencent: tencentAdapter
}

function pickAdapter(provider) {
  return ADAPTERS[provider] || openaiAdapter
}

module.exports = {
  detectProvider,
  pickAdapter,
  saveAudioFile,
  downloadAudio,
  ADAPTERS
}
