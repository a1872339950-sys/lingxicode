/**
 * 统一封装 ai-thinking 事件发送，规范所有发送点的字段语义。
 *
 * 之前 10 个发送点参数结构不一致，导致前端两道 isStatus 过滤门误杀工具进度播报：
 *   - 类型 A（reasoning 摘要）：isStatus + isReasoningSummary + reuseOpenSegment
 *   - 类型 B（工具进度播报）：仅 isProgressNarration
 *   - 类型 C（协作子 Agent 状态）：isStatus + agentRole + agentTitle
 *
 * 前端 ipc-ai-stream-listeners.js 和 ai-stream-renderer.js 历史上要求 isStatus 才放行，
 * 因此类型 B 全部被丢弃。本封装通过 kind 参数强制规范字段，避免再有人漏写字段。
 *
 * kind 取值：
 *   - 'reasoning' : 模型原生推理摘要（isStatus + isReasoningSummary + reuseOpenSegment）
 *   - 'progress'  : 工具进度播报（isProgressNarration）
 *   - 'status'    : 协作子 Agent 状态播报（isStatus + agentRole + agentTitle）
 *   - 'generic'   : 默认通用思考（isStatus）
 */

function sendThinkingEvent(webContents, projectId, payload = {}) {
  if (!webContents) return false
  const content = String(payload.content ?? '').trim()
  if (!content) return false

  const kind = payload.kind || 'generic'
  const base = {
    projectId,
    content,
    append: payload.append ?? false
  }
  if (payload.eventType) base.eventType = payload.eventType
  if (payload.type) base.type = payload.type

  switch (kind) {
    case 'reasoning':
      base.isStatus = true
      base.isReasoningSummary = true
      base.reuseOpenSegment = payload.reuseOpenSegment ?? true
      base.forceUpdate = payload.forceUpdate ?? false
      break
    case 'progress':
      base.isProgressNarration = true
      break
    case 'status':
      base.isStatus = true
      base.reuseOpenSegment = payload.reuseOpenSegment ?? false
      break
    default:
      base.isStatus = true
  }

  if (payload.agentRole) base.agentRole = payload.agentRole
  if (payload.agentTitle) base.agentTitle = payload.agentTitle

  try {
    webContents.send('ai-thinking', base)
    // 桌宠托盘：仅同步深度思考；短状态/进度块不展示
    try {
      const desktopPet = require('./desktop-pet')
      if (typeof desktopPet.notifyThinking === 'function') {
        desktopPet.notifyThinking(content, {
          kind,
          append: !!base.append,
          isReasoningSummary: !!base.isReasoningSummary,
          label: kind === 'reasoning' ? '深度思考' : undefined
        })
      }
    } catch (_) { /* 桌宠未加载时忽略 */ }
    return true
  } catch (err) {
    console.warn('[thinking-event-sender] send failed:', err?.message || err)
    return false
  }
}

module.exports = { sendThinkingEvent }
