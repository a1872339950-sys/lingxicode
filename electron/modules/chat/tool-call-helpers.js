function getToolCallNames(toolCalls = []) {
  return new Set(toolCalls.map(call => call?.name).filter(Boolean))
}

function hasSuccessfulToolCall(toolCalls = [], toolName) {
  return toolCalls.some(call => call?.name === toolName && call.result?.success !== false && !call.result?.error)
}

function getLastSuccessfulToolResult(toolCalls = [], toolName) {
  for (let i = toolCalls.length - 1; i >= 0; i--) {
    const call = toolCalls[i]
    if (call?.name === toolName && call.result?.success !== false && !call.result?.error) return call.result
  }
  return null
}

function getLastToolCall(toolCalls = [], toolName) {
  for (let i = toolCalls.length - 1; i >= 0; i--) {
    const call = toolCalls[i]
    if (call?.name === toolName) return call
  }
  return null
}

function extractImagePathsFromImageData(imageDataList = []) {
  if (!Array.isArray(imageDataList)) return []
  const paths = []
  for (const item of imageDataList) {
    const value = item?.path || item?.filePath || item?.localPath || item?.sourcePath
    if (value && typeof value === 'string') paths.push(value)
  }
  return paths
}

function isLocalImageReferencePath(value = '') {
  const text = String(value || '').trim()
  if (!text) return false
  if (/^https?:\/\//i.test(text) || /^data:/i.test(text)) return false
  return /\.(png|jpe?g|webp|gif|bmp)$/i.test(text) || /^[a-z]:[\\/]/i.test(text) || text.startsWith('\\\\') || text.startsWith('/')
}

function extractGeneratedImagePath(result) {
  if (!result || result.success === false) return ''
  const candidates = [
    result.path,
    result.filePath,
    result.localPath,
    result.outputPath,
    result.savedPath,
    result.imagePath,
    result.url
  ]
  if (Array.isArray(result.images)) {
    for (const image of result.images) {
      candidates.push(image?.path, image?.filePath, image?.localPath, image?.outputPath, image?.savedPath, image?.url)
    }
  }
  if (Array.isArray(result.data)) {
    for (const image of result.data) {
      candidates.push(image?.path, image?.filePath, image?.localPath, image?.outputPath, image?.savedPath, image?.url)
    }
  }
  return candidates.find(isLocalImageReferencePath) || ''
}

module.exports = {
  getToolCallNames,
  hasSuccessfulToolCall,
  getLastSuccessfulToolResult,
  getLastToolCall,
  extractImagePathsFromImageData,
  isLocalImageReferencePath,
  extractGeneratedImagePath
}
