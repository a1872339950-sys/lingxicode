// 清理历史中超过 N 轮的「模型侧」图片上下文：
// - 剥离 content 里的 image_url（base64，体积大，防止越聊越卡）
// - 剥离 visionAnalysis 长摘要
// - 保留 path/name/type 轻量字段，供 UI 历史缩略图懒加载（不进模型上下文）
function stripImageAttachments(message) {
  if (!message) return false
  let changed = false
  if (Array.isArray(message.content)) {
    const filtered = message.content.filter(function (part) { return !(part && part.type === 'image_url') })
    if (filtered.length !== message.content.length) changed = true
    message.content = filtered.length > 0
      ? filtered
      : [{ type: 'text', text: '[图片上下文已过期]' }]
  }
  if (Array.isArray(message.attachments)) {
    for (let i = 0; i < message.attachments.length; i++) {
      const att = message.attachments[i]
      if (!att || typeof att !== 'object') continue
      if (att.visionAnalysis) {
        delete att.visionAnalysis
        changed = true
      }
      // 绝不把 dataUrl/base64 写进历史；若旧数据残留则清掉
      if (att.thumb || att.dataUrl || att.data) {
        delete att.thumb
        delete att.dataUrl
        delete att.data
        changed = true
      }
    }
  }
  return changed
}

function pruneExpiredImageAttachments(messagesHistory, keepRecentUserMessages = 4, state = null) {
  if (!Array.isArray(messagesHistory) || messagesHistory.length === 0) return false
  if (!Number.isFinite(keepRecentUserMessages) || keepRecentUserMessages <= 0) return false
  let userCount = 0
  let firstKeptUserIndex = -1
  for (let i = messagesHistory.length - 1; i >= 0; i--) {
    if (messagesHistory[i] && messagesHistory[i].role === 'user') {
      userCount++
      if (userCount === keepRecentUserMessages) {
        firstKeptUserIndex = i
        break
      }
    }
  }
  if (firstKeptUserIndex <= 0) return false

  const previousBoundary = state && state.history === messagesHistory
    ? Number(state.firstKeptUserIndex)
    : NaN
  const scanStart = Number.isInteger(previousBoundary) && previousBoundary >= 0 && previousBoundary <= firstKeptUserIndex
    ? previousBoundary
    : 0
  let changed = false
  for (let i = scanStart; i < firstKeptUserIndex; i++) {
    changed = stripImageAttachments(messagesHistory[i]) || changed
  }
  if (state && typeof state === 'object') {
    state.history = messagesHistory
    state.firstKeptUserIndex = firstKeptUserIndex
  }
  return changed
}

// 按当前模型能力规范化历史中的图片上下文：
// - 视觉模型：保留 image_url
// - 非视觉模型：把 image_url 替换为持久化的 visionAnalysis.summary；没有摘要则降级为占位
// currentHistoryIndex 指向本次请求的当前消息，已经被专门处理过，这里跳过。
function normalizeFullHistoryForModel(fullHistory, currentModelHasVision, currentHistoryIndex) {
  if (!Array.isArray(fullHistory)) return
  for (let i = 0; i < fullHistory.length; i++) {
    if (i === currentHistoryIndex) continue
    const msg = fullHistory[i]
    if (!msg || !Array.isArray(msg.content)) continue
    const hasImageUrl = msg.content.some(function (part) { return part && part.type === 'image_url' })
    if (!hasImageUrl) continue
    if (currentModelHasVision) continue
    const attachments = Array.isArray(msg.attachments) ? msg.attachments : []
    const imageAnalyses = attachments
      .filter(function (att) { return att && att.kind === 'image' && att.visionAnalysis && att.visionAnalysis.summary })
      .map(function (att) {
        const va = att.visionAnalysis
        const modelTag = va.model ? '（分析模型：' + va.model + '）' : ''
        return '【图片分析】' + modelTag + '\n' + va.summary
      })
    if (imageAnalyses.length > 0) {
      const analysisText = imageAnalyses.join('\n\n')
      let textReplaced = false
      msg.content = msg.content.map(function (part) {
        if (part && part.type === 'image_url') {
          if (!textReplaced) {
            textReplaced = true
            return { type: 'text', text: analysisText }
          }
          return null
        }
        return part
      }).filter(Boolean)
    } else {
      msg.content = msg.content.filter(function (part) { return !(part && part.type === 'image_url') })
      if (msg.content.length === 0) {
        msg.content = [{ type: 'text', text: '[图片]' }]
      }
    }
  }
}

module.exports = { pruneExpiredImageAttachments, normalizeFullHistoryForModel }
