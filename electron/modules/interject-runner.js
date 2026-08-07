/**
 * 消息注入机制 - 队列 + 运行状态中枢
 * 每个项目维护独立的 pendingInterjectMap 与 runStateMap（按 projectId 隔离）。
 * ai-chat.js 的 handleSendMessage 通过本模块读取待注入消息并跟踪运行状态。
 */

const config = require('./config')

const pendingInterjectMap = new Map() // projectId -> [{ itemId, content, createdAt }]
const runStateMap = new Map() // projectId -> 'idle' | 'thinking' | 'tools' | 'streaming'

function enqueueInterject(payload = {}) {
  const { projectId, itemId, content, createdAt } = payload || {}
  if (!projectId || !content) {
    return { ok: false, reason: 'missing_projectId_or_content' }
  }
  if (!pendingInterjectMap.has(projectId)) pendingInterjectMap.set(projectId, [])
  const queue = pendingInterjectMap.get(projectId)
  const entry = {
    itemId: itemId || `interject-${Date.now()}-${queue.length}`,
    content: String(content),
    createdAt: createdAt || Date.now()
  }
  queue.push(entry)

  // 任何非 idle 状态都立即 abort 当前 AI，让外层 handleSendMessage 尽快重启 continue，
  // 从而把插队消息塞进下一轮 messages。
  const runState = runStateMap.get(projectId) || 'idle'
  const abortController = config.getAbortController?.(projectId)
  let interrupted = false
  if ((runState === 'streaming' || runState === 'thinking' || runState === 'tools') && abortController && !abortController.signal.aborted) {
    try {
      abortController.abort('interject')
      interrupted = true
      console.log(`[Interject] interrupted runState=${runState} project=${projectId}`)
    } catch (e) {
      console.warn('[Interject] abort failed:', e.message)
    }
  }

  console.log(`[Interject] queued project=${projectId} pending=${queue.length} itemId=${entry.itemId} runState=${runState} interrupted=${interrupted}`)
  return { ok: true, queued: queue.length, runState, interrupted, itemId: entry.itemId }
}

function takePendingInterjectMessages(projectId) {
  const queue = pendingInterjectMap.get(projectId)
  if (!queue || !queue.length) return []
  pendingInterjectMap.delete(projectId)
  return queue.slice()
}

function peekPendingInterjectMessages(projectId) {
  const queue = pendingInterjectMap.get(projectId)
  return queue ? queue.slice() : []
}

function clearPendingInterjectMessages(projectId) {
  pendingInterjectMap.delete(projectId)
}

function getRunState(projectId) {
  return runStateMap.get(projectId) || 'idle'
}

function setRunState(projectId, state) {
  if (!projectId || !state) return
  runStateMap.set(projectId, state)
}

module.exports = {
  enqueueInterject,
  takePendingInterjectMessages,
  peekPendingInterjectMessages,
  clearPendingInterjectMessages,
  getRunState,
  setRunState
}