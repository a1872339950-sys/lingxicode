const fs = require('fs')
const path = require('path')
const memoPaths = require('./paths')

function readableSlug(value = '') {
  return memoPaths.safeFilePart(String(value || '')
    .replace(/[，。！？、；：]/g, ' ')
    .replace(/\s+/g, '-')
    .trim())
    .replace(/^-+|-+$/g, '')
    .slice(0, 56) || 'AI操作备忘录'
}

function makeId(facts = {}) {
  const now = new Date()
  const pad = n => String(n).padStart(2, '0')
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`
  const firstLocation = facts.modelMemo?.changes?.[0]?.path || facts.files?.[0]?.path || ''
  const firstFunction = facts.modelMemo?.changes?.[0]?.functions?.[0] || ''
  return `${stamp}-${readableSlug(facts.title || facts.userMessage || firstFunction || firstLocation || '')}`
}

function uniqueDraftId(projectPath = '', baseId = '') {
  const base = memoPaths.safeFilePart(baseId || 'AI操作备忘录')
  let id = base
  let index = 2
  while (
    fs.existsSync(path.join(memoPaths.getDraftsDir(projectPath), `${id}.md`)) ||
    fs.existsSync(path.join(memoPaths.getTimelineDir(projectPath), `${id}.md`))
  ) {
    id = `${base}-${index}`
    index += 1
  }
  return id
}

function readJson(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return fallback
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'))
  } catch {
    return fallback
  }
}

function writeJson(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8')
}

function relativeToProject(projectPath = '', filePath = '') {
  return memoPaths.getRelativeProjectPath(projectPath, filePath) || filePath
}

function getIndex(projectPath = '') {
  const indexPath = memoPaths.getIndexPath(projectPath)
  const data = readJson(indexPath, null)
  if (data && Array.isArray(data.items)) return data
  return {
    version: 1,
    projectPath: path.resolve(projectPath),
    items: []
  }
}

function saveIndex(projectPath = '', index = {}) {
  const data = {
    version: 1,
    projectPath: path.resolve(projectPath),
    items: Array.isArray(index.items) ? index.items : []
  }
  writeJson(memoPaths.getIndexPath(projectPath), data)
  return data
}

function resolveMemoFilePath(projectPath = '', item = {}) {
  const filePath = path.resolve(projectPath, item.filePath || '')
  const memoRoot = memoPaths.getMemoRoot(projectPath)
  if (!memoPaths.isInsidePath(memoRoot, filePath)) return ''
  return filePath
}

function memoFileExists(projectPath = '', item = {}) {
  const filePath = resolveMemoFilePath(projectPath, item)
  return !!filePath && fs.existsSync(filePath)
}

function pruneMissingItems(projectPath = '', index = null) {
  const data = index || getIndex(projectPath)
  const items = Array.isArray(data.items) ? data.items : []
  const existingItems = items.filter(item => memoFileExists(projectPath, item))
  if (existingItems.length !== items.length) {
    data.items = existingItems
    saveIndex(projectPath, data)
  }
  return data
}

function listExistingItems(projectPath = '', status = 'saved') {
  const index = pruneMissingItems(projectPath)
  return index.items.filter(item => item.status === status)
}

function createIndexItem(projectPath = '', facts = {}, filePath = '', status = 'draft') {
  return {
    id: facts.id,
    title: facts.title || 'AI 操作备忘录',
    createdAt: facts.createdAt,
    savedAt: status === 'saved' ? new Date().toISOString() : '',
    status,
    filePath: relativeToProject(projectPath, filePath),
    summary: facts.finalSummary ? String(facts.finalSummary).replace(/\s+/g, ' ').trim().slice(0, 220) : '',
    modelSummary: facts.modelMemo?.summary ? String(facts.modelMemo.summary).replace(/\s+/g, ' ').trim().slice(0, 220) : '',
    stats: facts.stats || {},
    files: (facts.files || []).map(file => ({
      path: file.path,
      status: file.status,
      additions: file.additions || 0,
      deletions: file.deletions || 0
    })),
    codeLocations: (facts.modelMemo?.changes || []).map(change => ({
      path: change.path,
      module: change.module || '',
      purpose: change.purpose || '',
      functions: change.functions || [],
      lineRanges: change.lineRanges || []
    })).slice(0, 20),
    changeSessionId: facts.changeSessionId || '',
    requestId: facts.requestId || '',
    modelName: facts.modelName || '',
    snapshot: facts.snapshot || null
  }
}

function createDraft(projectPath = '', facts = {}, markdown = '') {
  memoPaths.ensureMemoDirs(projectPath)
  const id = uniqueDraftId(projectPath, facts.id || makeId(facts))
  const nextFacts = {
    ...facts,
    id,
    createdAt: facts.createdAt || new Date().toISOString()
  }
  const fileName = `${memoPaths.safeFilePart(id)}.md`
  const filePath = path.join(memoPaths.getDraftsDir(projectPath), fileName)
  fs.writeFileSync(filePath, markdown, 'utf-8')
  const indexItem = createIndexItem(projectPath, nextFacts, filePath, 'draft')
  const index = getIndex(projectPath)
  index.items = [indexItem, ...index.items.filter(item => item.id !== id)]
  saveIndex(projectPath, index)
  return {
    success: true,
    id,
    status: 'draft',
    projectPath,
    fileName,
    filePath,
    relativePath: relativeToProject(projectPath, filePath),
    facts: nextFacts,
    indexItem
  }
}

function saveDraft(projectPath = '', draftId = '') {
  memoPaths.ensureMemoDirs(projectPath)
  const safeId = memoPaths.safeFilePart(draftId)
  const draftPath = memoPaths.assertInsideMemoRoot(projectPath, path.join(memoPaths.getDraftsDir(projectPath), `${safeId}.md`))
  if (!fs.existsSync(draftPath)) return { success: false, error: '备忘录草稿不存在' }
  const timelinePath = path.join(memoPaths.getTimelineDir(projectPath), `${safeId}.md`)
  fs.mkdirSync(path.dirname(timelinePath), { recursive: true })
  fs.renameSync(draftPath, timelinePath)

  const index = getIndex(projectPath)
  const existing = index.items.find(item => item.id === draftId) || {}
  const item = {
    ...existing,
    id: draftId,
    status: 'saved',
    savedAt: new Date().toISOString(),
    filePath: relativeToProject(projectPath, timelinePath)
  }
  index.items = [item, ...index.items.filter(entry => entry.id !== draftId)]
  saveIndex(projectPath, index)
  return { success: true, id: draftId, status: 'saved', filePath: timelinePath, relativePath: item.filePath, item }
}

function saveCreatedDraft(projectPath = '', draft = {}) {
  const index = getIndex(projectPath)
  const item = {
    ...(draft.indexItem || {}),
    status: 'saved',
    savedAt: new Date().toISOString()
  }
  const draftPath = draft.filePath
  const timelinePath = path.join(memoPaths.getTimelineDir(projectPath), path.basename(draftPath))
  fs.mkdirSync(path.dirname(timelinePath), { recursive: true })
  fs.renameSync(draftPath, timelinePath)
  item.filePath = relativeToProject(projectPath, timelinePath)
  index.items = [item, ...index.items.filter(entry => entry.id !== draft.id)]
  saveIndex(projectPath, index)
  return { success: true, id: draft.id, status: 'saved', filePath: timelinePath, relativePath: item.filePath, item }
}

function deleteDraft(projectPath = '', draftId = '') {
  const safeId = memoPaths.safeFilePart(draftId)
  const draftPath = memoPaths.assertInsideMemoRoot(projectPath, path.join(memoPaths.getDraftsDir(projectPath), `${safeId}.md`))
  if (fs.existsSync(draftPath)) fs.rmSync(draftPath, { force: true })
  const index = getIndex(projectPath)
  index.items = index.items.filter(item => item.id !== draftId)
  saveIndex(projectPath, index)
  return { success: true, id: draftId, deleted: true }
}

function listTimeline(projectPath = '') {
  return { success: true, projectPath, items: listExistingItems(projectPath, 'saved') }
}

function readMemo(projectPath = '', memoId = '') {
  const index = pruneMissingItems(projectPath)
  const item = index.items.find(entry => entry.id === memoId)
  if (!item) return { success: false, error: '备忘录不存在' }
  const filePath = resolveMemoFilePath(projectPath, item)
  if (!filePath) return { success: false, error: '备忘录路径无效' }
  if (!fs.existsSync(filePath)) return { success: false, error: '备忘录文件不存在', item }
  return {
    success: true,
    item,
    content: fs.readFileSync(filePath, 'utf-8'),
    filePath,
    relativePath: relativeToProject(projectPath, filePath)
  }
}

module.exports = {
  createDraft,
  saveDraft,
  saveCreatedDraft,
  deleteDraft,
  listTimeline,
  listExistingItems,
  readMemo,
  pruneMissingItems,
  getIndex,
  saveIndex
}
