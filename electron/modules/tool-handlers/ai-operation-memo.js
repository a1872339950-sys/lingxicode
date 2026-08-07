const aiOperationMemos = require('../ai-operation-memos')
const changeSessions = require('../change-sessions')

function normalizeList(value, limit = 16) {
  return (Array.isArray(value) ? value : [])
    .map(item => String(item || '').trim())
    .filter(Boolean)
    .slice(0, limit)
}

const handlers = {
  search_ai_operation_memos: async (args = {}, ctx = {}) => {
    const projectPath = String(ctx.projectPath || '').trim()
    if (!projectPath) return { success: false, error: 'projectPath is required' }
    return {
      ...aiOperationMemos.searchTimeline(projectPath, args.query || '', {
        terms: args.terms,
        limit: args.limit || args.max_results
      }),
      tool: 'search_ai_operation_memos',
      factsOnly: true,
      contract: 'Memo results are reference material only, not candidates, not proof, and not edit instructions.'
    }
  },

  read_ai_operation_memo: async (args = {}, ctx = {}) => {
    const projectPath = String(ctx.projectPath || '').trim()
    if (!projectPath) return { success: false, error: 'projectPath is required' }
    const memoId = String(args.memo_id || args.memoId || args.id || '').trim()
    if (!memoId) return { success: false, error: 'memo_id is required' }
    const result = aiOperationMemos.readMemo(projectPath, memoId)
    return {
      ...result,
      tool: 'read_ai_operation_memo',
      factsOnly: true,
      contract: 'This memo is model-authored reference material. Verify current source files before editing.'
    }
  },

  record_ai_operation_memo: async (args = {}, ctx = {}) => {
    const projectPath = String(ctx.projectPath || '').trim()
    if (!projectPath) return { success: false, error: 'projectPath is required' }
    const activeSession = ctx.projectId ? changeSessions.getActiveSession(ctx.projectId) : null
    const requestedSessionId = String(args.change_session_id || args.changeSessionId || '').trim()
    const referencedSession = (ctx.projectId && requestedSessionId)
      ? changeSessions.getChangeSession(ctx.projectId, requestedSessionId, { includeContent: true })
      : null
    const changeSession = referencedSession || activeSession || {
      projectId: ctx.projectId || '',
      projectPath,
      id: requestedSessionId || '',
      files: [],
      commands: [],
      warnings: []
    }
    const result = aiOperationMemos.createModelDraftForRun({
      projectId: ctx.projectId || changeSession?.projectId || '',
      projectPath,
      requestId: ctx.options?.requestId || '',
      userMessage: ctx.options?.userMessage || '',
      modelName: ctx.modelConfig?.modelName || ctx.modelConfig?.modelId || '',
      title: args.title,
      intent: args.intent,
      summary: args.summary,
      changes: Array.isArray(args.changes) ? args.changes : [],
      verification: normalizeList(args.verification),
      followUps: normalizeList(args.follow_ups || args.followUps, 12),
      uncertainty: normalizeList(args.uncertainty, 12),
      startedAt: changeSession?.startedAt || activeSession?.startedAt || '',
      completedAt: new Date().toISOString(),
      changeSession
    })
    return {
      ...result,
      tool: 'record_ai_operation_memo',
      internal: true,
      operationMemo: true,
      factsOnly: true,
      note: 'Saved as a model-authored memo draft. This memo is reference material only; future agents must verify source files before editing.'
    }
  }
}

module.exports = {
  handlers
}
