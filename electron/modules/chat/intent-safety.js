const recoveryPoints = require('../recovery-points')

function isChangeIntent(message = '') {
  return /(修|修复|改|修改|实现|增加|新增|开发|做一个|优化|美化|重构|删除|移除|接入|支持|调整|替换|生成|创建)/i.test(String(message || ''))
}

function getLedgerContextMaxItems(message = '') {
  const text = String(message || '')
  if (/(账本|ledger|纪要|摘要编号|task-|discussion-|继续(刚刚|之前|上次|前面|那个)|接着(刚刚|之前|上次|前面|那个)|之前的(任务|方案|讨论)|上次的(任务|方案|讨论)|旧任务|旧方案|历史任务|历史方案)/i.test(text)) return 5
  return 3
}

function shouldIncludeHistoricalProjectContext(message = '') {
  const text = String(message || '').trim()
  if (!text) return false
  // 继续/接着/恢复/按 必须搭配明确的历史指向词才注入旧任务账本索引；
  // 否则"恢复默认样式""继续保持这个配色"等全新需求会误触发，注入历史索引淹没当轮需求。
  return /(账本|ledger|纪要|摘要编号|task-[\w-]+|discussion-[\w-]+|(继续|接着|恢复|回到|按)(刚刚|刚才|之前|上次|上一[轮步次]|前面|那个|前一次|上面|以前|历史|旧)|之前的(任务|方案|讨论)|上次的(任务|方案|讨论)|旧任务|旧方案|历史任务|历史方案)/i.test(text)
}

async function createAiSafetySnapshot(projectPath, options = {}) {
  const projectId = options.projectId || options.changeSession?.projectId
  const changeSessionId = options.changeSessionId || options.changeSession?.id
  if (!projectPath || !projectId || !changeSessionId) return null
  try {
    const result = await recoveryPoints.createAiTaskRecoveryPoint(projectId, projectPath, changeSessionId, options)
    console.log('[RecoveryPoints] AI 任务恢复点:', result)
    return result
  } catch (error) {
    console.error('[RecoveryPoints] AI 任务恢复点失败:', error)
    return { success: false, error: String(error?.message || error) }
  }
}

module.exports = {
  isChangeIntent,
  getLedgerContextMaxItems,
  shouldIncludeHistoricalProjectContext,
  createAiSafetySnapshot
}
