const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const projects = require('./projects')
const storageConfig = require('./storage-config')
const workflowIndex = require('./agent-workflow-index')
const workflowPolicy = require('./agent-workflow-policy')

const WORKFLOW_VERSION = 1
const { MAX_WORKFLOWS, MAX_NODES, MAX_EDGES } = workflowPolicy
let ipcRegistered = false
const migratedLegacyProjects = new Set()
let projectListMigrationDone = false


function createId(prefix = 'workflow') {
  return `${prefix}-${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`
}

function getProjectRoot(projectId) {
  const instance = projects.getProjectInstance(projectId)
  const root = instance?.projectPath ? path.resolve(instance.projectPath) : ''
  if (!root || !fs.existsSync(root)) throw new Error('项目路径不存在，无法保存工作流')
  return root
}

function getProjectRootFromList(item = {}) {
  const projectPath = item.projectPath || item.path || ''
  const root = projectPath ? path.resolve(projectPath) : ''
  return root && fs.existsSync(root) ? root : ''
}

function getLegacyWorkflowDir(projectId) {
  return path.join(getProjectRoot(projectId), '.lingxi', 'workflows')
}

function getLegacyWorkflowDirFromRoot(root) {
  return path.join(root, '.lingxi', 'workflows')
}

function getWorkflowDir() {
  const dir = path.join(storageConfig.getConfigDir(), 'agent-workflows')
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

function getWorkflowIndexPath() {
  return path.join(storageConfig.getConfigDir(), 'agent-workflows-index.json')
}

function getArchivedLegacyWorkflowDir(projectId) {
  const safeProjectId = cleanId(projectId || 'unknown-project', 'project')
  const dir = path.join(storageConfig.getConfigDir(), 'agent-workflows-legacy-migrated', safeProjectId)
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

function getUniqueArchivePath(dir, fileName) {
  let target = path.join(dir, fileName)
  if (!fs.existsSync(target)) return target
  const ext = path.extname(fileName)
  const base = path.basename(fileName, ext)
  for (let index = 1; index < 1000; index += 1) {
    target = path.join(dir, `${base}-${index}${ext}`)
    if (!fs.existsSync(target)) return target
  }
  return path.join(dir, `${base}-${Date.now()}${ext}`)
}

function migrateLegacyDir(projectKey, legacyDir) {
  if (!legacyDir || !fs.existsSync(legacyDir)) return
  const globalDir = getWorkflowDir()
  const archivedDir = getArchivedLegacyWorkflowDir(projectKey)
  for (const entry of fs.readdirSync(legacyDir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue
    const legacyPath = path.join(legacyDir, entry.name)
    try {
      const workflow = normalizeWorkflow(JSON.parse(fs.readFileSync(legacyPath, 'utf8')))
      let targetPath = path.join(globalDir, `${cleanId(workflow.id, 'workflow')}.json`)
      if (fs.existsSync(targetPath)) {
        const nextId = cleanId(`${workflow.id}-${projectKey}`, 'workflow')
        workflow.id = nextId
        workflow.name = `${workflow.name}（迁移）`
        targetPath = path.join(globalDir, `${nextId}.json`)
      }
      if (fs.existsSync(targetPath)) {
        workflow.id = createId('workflow')
        workflow.name = `${workflow.name}（迁移）`
        targetPath = path.join(globalDir, `${workflow.id}.json`)
      }
      writeJsonAtomic(targetPath, workflow)
      workflowIndex.invalidate()
      fs.renameSync(legacyPath, getUniqueArchivePath(archivedDir, entry.name))
    } catch (error) {
      console.warn('[AgentWorkflows] 迁移旧项目工作流失败:', error.message)
    }
  }
}

function migrateProjectListWorkflows() {
  if (projectListMigrationDone) return
  projectListMigrationDone = true
  const result = storageConfig.getProjectsList?.()
  const list = result?.success && Array.isArray(result.data) ? result.data : []
  for (const item of list) {
    const projectKey = cleanId(item.id || item.projectId || item.path || item.projectPath, 'project')
    if (!projectKey || migratedLegacyProjects.has(projectKey)) continue
    const root = getProjectRootFromList(item)
    if (!root) continue
    migratedLegacyProjects.add(projectKey)
    migrateLegacyDir(projectKey, getLegacyWorkflowDirFromRoot(root))
  }
}

function migrateLegacyProjectWorkflows(projectId = '') {
  const projectKey = String(projectId || '').trim()
  if (!projectKey || migratedLegacyProjects.has(projectKey)) return
  let legacyDir = ''
  try {
    legacyDir = getLegacyWorkflowDir(projectKey)
  } catch {
    return
  }
  migratedLegacyProjects.add(projectKey)
  migrateLegacyDir(projectKey, legacyDir)
}

function cleanText(value, limit = 4000) {
  return String(value == null ? '' : value).replace(/\0/g, '').trim().slice(0, limit)
}

function cleanId(value, fallbackPrefix = 'item') {
  const cleaned = cleanText(value, 100).replace(/[^a-zA-Z0-9_-]/g, '-').replace(/-+/g, '-')
  return cleaned || createId(fallbackPrefix)
}

function normalizeNode(node = {}, index = 0) {
  const type = ['input', 'work', 'output'].includes(String(node.type || '')) ? String(node.type) : 'work'
  return {
    id: cleanId(node.id, type),
    type,
    name: cleanText(node.name || (type === 'input' ? '工作流输入' : type === 'output' ? '交付结果' : `Work ${index + 1}`), 120),
    task: cleanText(node.task, 12000),
    outputRule: cleanText(node.outputRule, 4000),
    modelKey: cleanText(node.modelKey, 180),
    modelName: cleanText(node.modelName, 180),
    x: Math.max(0, Math.min(3000, Number(node.x) || 0)),
    y: Math.max(0, Math.min(2000, Number(node.y) || 0))
  }
}

function normalizeEdge(edge = {}, nodeIds = new Set()) {
  const source = cleanId(edge.source, 'source')
  const target = cleanId(edge.target, 'target')
  if (!nodeIds.has(source) || !nodeIds.has(target) || source === target) return null
  return {
    id: cleanId(edge.id || `${source}-${target}`, 'edge'),
    source,
    target
  }
}

function normalizeWorkflow(input = {}) {
  const nodes = (Array.isArray(input.nodes) ? input.nodes : []).slice(0, MAX_NODES).map(normalizeNode)
  const nodeIds = new Set(nodes.map(node => node.id))
  const seenEdges = new Set()
  const edges = (Array.isArray(input.edges) ? input.edges : [])
    .slice(0, MAX_EDGES)
    .map(edge => normalizeEdge(edge, nodeIds))
    .filter(edge => {
      if (!edge) return false
      const key = `${edge.source}->${edge.target}`
      if (seenEdges.has(key)) return false
      seenEdges.add(key)
      return true
    })
  const now = new Date().toISOString()
  return {
    version: WORKFLOW_VERSION,
    id: cleanId(input.id, 'workflow'),
    name: cleanText(input.name || '未命名工作流', 160),
    description: cleanText(input.description, 2000),
    enabled: input.enabled !== false,
    nodes,
    edges,
    createdAt: cleanText(input.createdAt, 80) || now,
    updatedAt: cleanText(input.updatedAt, 80) || now
  }
}

function getWorkflowPath(projectId, workflowId) {
  migrateLegacyProjectWorkflows(projectId)
  return path.join(getWorkflowDir(), `${cleanId(workflowId, 'workflow')}.json`)
}

function writeJsonAtomic(filePath, value) {
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`
  fs.writeFileSync(tempPath, JSON.stringify(value, null, 2), 'utf8')
  fs.renameSync(tempPath, filePath)
}

function listWorkflows(projectId, options = {}) {
  migrateProjectListWorkflows()
  migrateLegacyProjectWorkflows(projectId)
  const dir = getWorkflowDir()
  const all = workflowIndex.list(getWorkflowIndexPath(), dir).slice(0, MAX_WORKFLOWS)
  const page = Math.max(0, Number(options.page) || 0)
  const limit = Math.max(1, Math.min(MAX_WORKFLOWS, Number(options.limit) || MAX_WORKFLOWS))
  const start = page * limit
  return {
    items: all.slice(start, start + limit),
    total: all.length,
    page,
    limit,
    hasMore: start + limit < all.length
  }
}

function readWorkflow(projectId, workflowId) {
  const filePath = getWorkflowPath(projectId, workflowId)
  if (!fs.existsSync(filePath)) return null
  return normalizeWorkflow(JSON.parse(fs.readFileSync(filePath, 'utf8')))
}

function saveWorkflow(projectId, input = {}) {
  workflowPolicy.assertWorkflowPayload(input)
  const workflow = normalizeWorkflow(input)
  workflow.updatedAt = new Date().toISOString()
  const filePath = getWorkflowPath(projectId, workflow.id)
  if (fs.existsSync(filePath)) {
    try {
      const previous = JSON.parse(fs.readFileSync(filePath, 'utf8'))
      workflow.createdAt = cleanText(previous.createdAt, 80) || workflow.createdAt
    } catch {}
  }
  writeJsonAtomic(filePath, workflow)
  workflowIndex.upsert(getWorkflowIndexPath(), getWorkflowDir(), workflow)
  return workflow
}

function deleteWorkflow(projectId, workflowId) {
  const filePath = getWorkflowPath(projectId, workflowId)
  if (!fs.existsSync(filePath)) return false
  fs.unlinkSync(filePath)
  workflowIndex.remove(getWorkflowIndexPath(), getWorkflowDir(), cleanId(workflowId, 'workflow'))
  return true
}

function setWorkflowEnabled(projectId, workflowId, enabled) {
  const workflow = readWorkflow(projectId, workflowId)
  if (!workflow) throw new Error('工作流不存在')
  workflow.enabled = enabled !== false
  return saveWorkflow(projectId, workflow)
}

function registerIPC(ipcMain) {
  if (ipcRegistered) return
  ipcRegistered = true
  ipcMain.handle('agent-workflow:list', async (event, projectId, options = {}) => ({
    success: true,
    ...listWorkflows(projectId, options)
  }))
  ipcMain.handle('agent-workflow:get', async (event, projectId, workflowId) => ({
    success: true,
    workflow: readWorkflow(projectId, workflowId)
  }))
  ipcMain.handle('agent-workflow:save', async (event, projectId, workflow = {}) => ({
    success: true,
    workflow: saveWorkflow(projectId, workflow)
  }))
  ipcMain.handle('agent-workflow:delete', async (event, projectId, workflowId) => ({
    success: true,
    deleted: deleteWorkflow(projectId, workflowId)
  }))
  ipcMain.handle('agent-workflow:set-enabled', async (event, projectId, workflowId, enabled) => ({
    success: true,
    workflow: setWorkflowEnabled(projectId, workflowId, enabled)
  }))
}

module.exports = {
  assertWorkflowPayload: workflowPolicy.assertWorkflowPayload,
  validateWorkflowPayload: workflowPolicy.validateWorkflowPayload,
  normalizeWorkflow,
  listWorkflows,
  readWorkflow,
  saveWorkflow,
  deleteWorkflow,
  setWorkflowEnabled,
  registerIPC
}
