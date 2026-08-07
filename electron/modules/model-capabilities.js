const capabilityDefinitions = [
  { key: 'text', label: '文本' },
  { key: 'vision', label: '视觉理解' },
  { key: 'imageGeneration', label: '图片生成' },
  { key: 'musicGeneration', label: '音乐生成' },
  { key: 'videoGeneration', label: '视频生成' },
  { key: 'speechSynthesis', label: '语音合成' },
  { key: 'toolCalling', label: '工具调用' }
]

const defaultCapabilities = {
  text: true,
  vision: false,
  imageGeneration: false,
  musicGeneration: false,
  videoGeneration: false,
  speechSynthesis: false,
  toolCalling: true
}

function normalizeCapabilities(capabilities) {
  const source = capabilities && typeof capabilities === 'object' ? capabilities : null
  const normalized = { ...defaultCapabilities }
  if (source) {
    normalized.text = source.text !== undefined ? !!source.text : normalized.text
    normalized.vision = source.vision !== undefined ? !!source.vision : normalized.vision
    normalized.imageGeneration = source.imageGeneration !== undefined ? !!source.imageGeneration : !!source.imageGen
    normalized.musicGeneration = source.musicGeneration !== undefined ? !!source.musicGeneration : !!source.musicGen
    normalized.videoGeneration = source.videoGeneration !== undefined ? !!source.videoGeneration : !!source.videoGen
    normalized.speechSynthesis = source.speechSynthesis !== undefined ? !!source.speechSynthesis : !!source.speechSynth
    normalized.toolCalling = source.toolCalling !== undefined ? !!source.toolCalling : normalized.toolCalling
  }
  if (!Object.values(normalized).some(Boolean)) return { ...defaultCapabilities }
  return normalized
}

function hasCapability(model, key) {
  if (!model || !key) return false
  return !!normalizeCapabilities(model.capabilities)[key]
}

function normalizeModel(model) {
  const nextModel = model && typeof model === 'object' ? { ...model } : {}
  nextModel.capabilities = normalizeCapabilities(nextModel.capabilities)
  return nextModel
}

module.exports = {
  capabilityDefinitions,
  defaultCapabilities,
  normalizeCapabilities,
  normalizeModel,
  hasCapability
}
