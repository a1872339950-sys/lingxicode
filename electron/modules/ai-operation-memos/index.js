const storageConfig = require('../storage-config')
const collector = require('./collector')
const markdown = require('./markdown')
const store = require('./store')

function getSettings() {
  return storageConfig.getAiOperationMemoConfig()
}

function saveSettings(config = {}) {
  return storageConfig.saveAiOperationMemoConfig(config)
}

function buildPublicPayload(result = {}) {
  if (!result?.success) return result
  const item = result.item || result.indexItem || {}
  return {
    success: true,
    id: result.id,
    status: result.status,
    autoSaved: !!result.autoSaved,
    projectPath: result.projectPath,
    filePath: result.filePath,
    relativePath: result.relativePath,
    title: item.title || result.facts?.title || 'AI 操作备忘录',
    summary: item.summary || '',
    stats: item.stats || result.facts?.stats || {},
    files: item.files || result.facts?.files || [],
    commands: result.facts?.commands || []
  }
}

function buildBackfillPayload(options = {}) {
  const facts = collector.collectMemoFacts(options)
  if (!facts.shouldCreate) return null
  return {
    success: true,
    needsModelBackfill: true,
    projectId: facts.projectId,
    projectPath: facts.projectPath,
    requestId: facts.requestId,
    userMessage: facts.userMessage,
    finalSummary: facts.finalSummary,
    modelName: facts.modelName,
    changeSessionId: facts.changeSessionId,
    stats: facts.stats || {},
    files: facts.files || [],
    commands: facts.commands || [],
    meta: {
      reason: '有项目文件改动或项目内修改命令，但模型未手写 AI 操作备忘录。'
    }
  }
}

function createDraftForRun(options = {}) {
  const facts = collector.collectMemoFacts(options)
  if (!facts.shouldCreate) {
    return { success: true, skipped: true, reason: facts.reason, outsideProjectOps: facts.outsideProjectOps || 0 }
  }
  const content = markdown.buildMemoMarkdown(facts)
  const draft = store.createDraft(facts.projectPath, facts, content)
  const settings = getSettings()
  if (settings.autoSave) {
    const saved = store.saveCreatedDraft(facts.projectPath, draft)
    return buildPublicPayload({ ...saved, facts, autoSaved: true, projectPath: facts.projectPath })
  }
  return buildPublicPayload({ ...draft, facts, autoSaved: false })
}

function createModelDraftForRun(options = {}) {
  const facts = collector.collectMemoFacts({
    ...options,
    title: options.title,
    modelMemo: {
      intent: options.intent,
      summary: options.summary,
      changes: options.changes,
      verification: options.verification,
      followUps: options.followUps || options.follow_ups,
      uncertainty: options.uncertainty
    }
  })
  if (!facts.shouldCreate) {
    return { success: true, skipped: true, reason: facts.reason, outsideProjectOps: facts.outsideProjectOps || 0 }
  }
  const content = markdown.buildMemoMarkdown(facts)
  const draft = store.createDraft(facts.projectPath, facts, content)
  const settings = getSettings()
  if (settings.autoSave) {
    const saved = store.saveCreatedDraft(facts.projectPath, draft)
    return buildPublicPayload({ ...saved, facts, autoSaved: true, projectPath: facts.projectPath })
  }
  return buildPublicPayload({ ...draft, facts, autoSaved: false })
}

function saveDraft(projectPath = '', memoId = '') {
  return buildPublicPayload(store.saveDraft(projectPath, memoId))
}

function deleteDraft(projectPath = '', memoId = '') {
  return store.deleteDraft(projectPath, memoId)
}

function listTimeline(projectPath = '') {
  return store.listTimeline(projectPath)
}

function searchTimeline(projectPath = '', query = '', options = {}) {
  const text = String(query || '').toLowerCase().trim()
  const terms = [
    ...String(query || '').split(/\s+/),
    ...(Array.isArray(options.terms) ? options.terms : [])
  ].map(item => String(item || '').toLowerCase().trim()).filter(Boolean)
  const limit = Math.max(1, Math.min(20, Number(options.limit) || 8))
  const saved = store.listExistingItems(projectPath, 'saved')
  const scored = saved.map(item => {
    const haystack = [
      item.id,
      item.title,
      item.summary,
      item.modelSummary,
      ...(item.files || []).map(file => file.path),
      ...(item.codeLocations || []).flatMap(location => [
        location.path,
        location.module,
        location.purpose,
        ...(location.functions || []),
        ...(location.lineRanges || [])
      ])
    ].join('\n').toLowerCase()
    const score = terms.length
      ? terms.reduce((sum, term) => sum + (haystack.includes(term) ? Math.max(1, term.length) : 0), 0)
      : (text && haystack.includes(text) ? text.length : 0)
    return { item, score }
  }).filter(hit => hit.score > 0)
    .sort((a, b) => b.score - a.score || String(b.item.savedAt || b.item.createdAt || '').localeCompare(String(a.item.savedAt || a.item.createdAt || '')))
    .slice(0, limit)
  return {
    success: true,
    query,
    terms,
    count: scored.length,
    results: scored.map(hit => ({
      id: hit.item.id,
      title: hit.item.title,
      filePath: hit.item.filePath,
      summary: hit.item.modelSummary || hit.item.summary || '',
      files: hit.item.files || [],
      codeLocations: hit.item.codeLocations || [],
      score: hit.score,
      caution: 'AI 操作备忘录只作参考；修改前必须读取当前源码和运行入口确认。'
    }))
  }
}

function readMemo(projectPath = '', memoId = '') {
  return store.readMemo(projectPath, memoId)
}

module.exports = {
  getSettings,
  saveSettings,
  createDraftForRun,
  createModelDraftForRun,
  buildBackfillPayload,
  saveDraft,
  deleteDraft,
  listTimeline,
  searchTimeline,
  readMemo
}
