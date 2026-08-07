const { normalizeModel } = require('../model-capabilities')

function buildCurrentModelCapabilityPrompt(modelConfig = {}) {
  const normalized = normalizeModel(modelConfig)
  const capabilities = normalized.capabilities || {}
  const labels = {
    text: '文本',
    vision: '视觉理解',
    imageGeneration: '图片生成',
    musicGeneration: '音乐生成',
    videoGeneration: '视频生成',
    speechSynthesis: '语音合成',
    toolCalling: '工具调用'
  }
  const enabled = []
  const disabled = []
  for (const [key, label] of Object.entries(labels)) {
    if (capabilities[key]) enabled.push(label)
    else disabled.push(label)
  }
  return [
    '===== 当前模型能力标注 =====',
    `当前模型：${normalized.modelName || normalized.modelId || '未命名模型'}`,
    `已标注具备：${enabled.join('、') || '无'}`,
    `未标注具备：${disabled.join('、') || '无'}`,
    '- 回答“我是否具备视觉/图片/音乐/视频能力”时，必须以这里的能力标注为准。',
    '- 如果“视觉理解”已标注具备：用户上传图片会直接发给当前模型分析。',
    '- 如果“视觉理解”未标注具备：需要理解图片时，只能在用户确认后借用已配置的视觉模型。'
  ].join('\n')
}

module.exports = { buildCurrentModelCapabilityPrompt }
