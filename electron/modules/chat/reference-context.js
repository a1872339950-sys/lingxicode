const contextCompression = require('../context-compression')

function normalizeReferences(references = []) {
  if (!Array.isArray(references)) return []
  const normalized = []
  const seen = new Set()
  for (const item of references) {
    if (!item) continue
    const type = item.type || (item.summaryId ? 'summary' : item.turnId ? 'message' : '')
    let ref = null
    if (type === 'summary' && item.summaryId) {
      ref = {
        type: 'summary',
        summaryId: String(item.summaryId),
        title: item.title || '',
        preview: item.preview || ''
      }
    } else if (type === 'message' && item.turnId && item.part) {
      ref = {
        type: 'message',
        turnId: Number(item.turnId),
        part: item.part === 'assistant' ? 'assistant' : 'user',
        title: item.title || '',
        preview: item.preview || ''
      }
    }
    if (!ref) continue
    const key = ref.type === 'summary'
        ? `summary:${ref.summaryId}`
        : `message:${ref.part}:${ref.turnId}`
    if (seen.has(key)) continue
    seen.add(key)
    normalized.push(ref)
  }
  return normalized
}

function clipReferenceText(text = '', maxChars = 240) {
  const value = String(text || '').trim()
  if (!value) return ''
  if (value.length <= maxChars) return value
  return value.slice(0, maxChars) + '...(已截断)'
}

function buildReferencedContextBlock(instance, references = []) {
  if (!instance || !Array.isArray(references) || references.length === 0) return ''
  const lines = [
    '【用户引用上下文】',
    '用户本轮显式引用了旧消息/摘要。引用只提供定位信息；如果回答需要引用目标的具体内容，必须先调用 recall_history 查询对应消息，不要只根据标题或短预览猜。'
  ]
  for (const ref of references) {
    if (ref.type === 'summary') {
      const summaryRecord = contextCompression.getSummaryReference(instance, ref.summaryId)
      if (!summaryRecord) continue
      lines.push(`- summary ${summaryRecord.id}（第 ${summaryRecord.startTurn}-${summaryRecord.endTurn} 轮）`)
      lines.push(`  摘要：${summaryRecord.summaryText}`)
      lines.push(`  查询建议：recall_history query="${summaryRecord.id} ${clipReferenceText(summaryRecord.summaryText, 120)}"`)
      continue
    }
    if (ref.type === 'message') {
      lines.push(`- message ${ref.part === 'user' ? '用户' : 'AI'} 第 ${ref.turnId} 轮`)
      lines.push(`  线索：${clipReferenceText(ref.preview || ref.title || '用户主动引用了这一轮消息。')}`)
      lines.push(`  查询建议：recall_history query="第 ${ref.turnId} 轮 ${ref.part === 'user' ? '用户消息' : 'AI回复'} ${clipReferenceText(ref.preview || ref.title || '', 120)}"`)
    }
  }
  return lines.length > 1 ? lines.join('\n') : ''
}

function stripInjectedAttachmentBlocks(content = '') {
  let text = String(content || '')
  // 发给模型的附件注入，不应出现在用户气泡正文里
  text = text
    .replace(/【文件(?::[^\】]*)?】[^\n]*(?:\n路径:\s*[^\n]*)?/g, '')
    .replace(/【图片(?::[^\】]*)?】[^\n]*/g, '')
    .replace(/(?:^|\n)路径:\s*(?:[A-Za-z]:\\|\/)[^\n]*/g, '\n')
    .replace(/(?:^|\n)【图片处理】[^\n]*/g, '\n')
    .replace(/(?:^|\n)【图片读取失败】[^\n]*/g, '\n')
  return text.replace(/\n{3,}/g, '\n\n').trim()
}

function sanitizeUserVisibleContent(content = '') {
  let text = String(content || '')
  const marker = '【视觉模型分析结果】'
  const markerIndex = text.indexOf(marker)
  if (markerIndex >= 0) {
    text = text.slice(0, markerIndex)
  }
  text = stripInjectedAttachmentBlocks(text)
  text = text.replace(/\n{3,}/g, '\n\n').trim()
  return text
}

module.exports = {
  normalizeReferences,
  clipReferenceText,
  buildReferencedContextBlock,
  stripInjectedAttachmentBlocks,
  sanitizeUserVisibleContent
}
