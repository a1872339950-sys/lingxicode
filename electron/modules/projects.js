/**
 * 项目管理模块
 * 管理项目实例、聊天记录、上下文状态和项目文件访问。
 */

const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { execFileSync, execFile } = require('child_process')
const { promisify } = require('util')
const execFileAsync = promisify(execFile)
const { dialog, shell } = require('electron')
const sharp = require('sharp')
const config = require('./config')
const storageConfig = require('./storage-config')
const { ContextManager } = require('../tools/context-manager')
const { buildContextPayload } = require('../tools/context-builder')
const artifacts = require('./artifacts')
const contextCompression = require('./context-compression')
const { buildContextBudget } = require('./model-context-policy')
const taskLedger = require('./task-ledger')
const terminalSessions = require('./terminal-sessions')
const { invalidateProjectCache } = require('./git-probe-cache')
const taskRuns = require('./task-runs')
const agentCollaborationReports = require('./agent-collaboration-reports')
const chatChunkStore = require('./chat-chunk-store')
const chatMessageIdentity = require('./chat-message-identity')
const { getCompositeRoute, buildRoutedArgs } = require('./composite-tool-contracts')

const pendingChatHistorySaves = new Map()
const pendingChatHistoryReads = new Map()
// 已取消的历史写盘路径：删除会话后阻止异步队列把目录 mkdir 写回
const cancelledChatHistoryWrites = new Set()
/** root -> timeoutId，便于取消/刷新过期清理，避免孤立 setTimeout 堆积 */
const cancelledChatHistoryExpiryTimers = new Map()
const DEFAULT_HISTORY_PAGE_ROUNDS = 30
const RUNTIME_HISTORY_MAX_ROUNDS = 90
const STATELESS_SESSION_INDEX_FILE = 'stateless-sessions.json'
const STATELESS_SESSION_PAGE_SIZE = 30

let statelessSessionIndexCache = null
let statelessSessionIndexWriteTimer = null
let statelessSessionStorageReconciled = false

function getStatelessSessionsRoot() {
  return path.join(storageConfig.getProjectsDir(), 'stateless-chats')
}

function getStatelessSessionIndexPath() {
  return path.join(storageConfig.getConfigDir(), STATELESS_SESSION_INDEX_FILE)
}

function parseStatelessSessionCreatedAt(projectId) {
  const match = String(projectId || '').match(/^stateless-chat-([a-z0-9]+)-/i)
  const value = match ? Number.parseInt(match[1], 36) : 0
  return Number.isFinite(value) && value > 0 ? value : 0
}

function normalizeStatelessSessionEntry(entry = {}) {
  const id = String(entry.id || entry.projectId || '')
  if (!id.startsWith('stateless-chat-')) return null
  const createdAt = Number(entry.createdAt) || parseStatelessSessionCreatedAt(id) || Date.now()
  const storagePath = path.join(getStatelessSessionsRoot(), id)
  return {
    id,
    title: String(entry.title || '临时会话').trim().slice(0, 80) || '临时会话',
    createdAt,
    updatedAt: Number(entry.updatedAt) || createdAt,
    turnCount: Math.max(0, Number(entry.turnCount) || 0),
    lastMessageSummary: String(entry.lastMessageSummary || '').replace(/\s+/g, ' ').trim().slice(0, 120),
    storagePath
  }
}

function deriveLastMessageSummary(messagesHistory = [], fallback = '') {
  const messages = Array.isArray(messagesHistory) ? messagesHistory : []
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index]
    if (!message || message.hidden) continue
    const content = typeof message.displayContent === 'string'
      ? message.displayContent
      : (typeof message.content === 'string' ? message.content : '')
    const summary = content.replace(/\s+/g, ' ').trim()
    if (summary) return summary.slice(0, 120)
  }
  return String(fallback || '').replace(/\s+/g, ' ').trim().slice(0, 120)
}

function sortStatelessSessions(index) {
  index.sessions.sort((a, b) => b.updatedAt - a.updatedAt)
  return index
}

function readStatelessSessionIndex() {
  if (statelessSessionIndexCache) return statelessSessionIndexCache
  let sessions = []
  try {
    const parsed = JSON.parse(fs.readFileSync(getStatelessSessionIndexPath(), 'utf8'))
    const source = Array.isArray(parsed) ? parsed : parsed?.sessions
    if (Array.isArray(source)) sessions = source.map(normalizeStatelessSessionEntry).filter(Boolean)
  } catch (error) {
    if (error.code !== 'ENOENT') console.warn('[Projects] read stateless session index failed:', error.message)
  }
  statelessSessionIndexCache = sortStatelessSessions({ version: 1, sessions })
  return statelessSessionIndexCache
}

function writeStatelessSessionIndexNow() {
  if (statelessSessionIndexWriteTimer) {
    clearTimeout(statelessSessionIndexWriteTimer)
    statelessSessionIndexWriteTimer = null
  }
  const index = readStatelessSessionIndex()
  const filePath = getStatelessSessionIndexPath()
  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true })
    fs.writeFileSync(tmpPath, JSON.stringify(index, null, 2), 'utf8')
    fs.renameSync(tmpPath, filePath)
  } finally {
    try { if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath) } catch {}
  }
}

function scheduleStatelessSessionIndexWrite() {
  if (statelessSessionIndexWriteTimer) return
  statelessSessionIndexWriteTimer = setTimeout(() => {
    statelessSessionIndexWriteTimer = null
    try { writeStatelessSessionIndexNow() } catch (error) {
      console.warn('[Projects] write stateless session index failed:', error.message)
    }
  }, 400)
}

function upsertStatelessSession(instance, overrides = {}) {
  if (!instance?.projectId || !instance.stateless) return null
  const index = readStatelessSessionIndex()
  const existing = index.sessions.find(item => item.id === instance.projectId)
  const messages = Array.isArray(instance.messagesHistory) ? instance.messagesHistory : []
  const persistedHistory = instance.chatHistoryPath ? chatChunkStore.getStatSync(instance.chatHistoryPath) : null
  const createdAt = existing?.createdAt || parseStatelessSessionCreatedAt(instance.projectId) || Date.now()
  const derivedTitle = deriveChatTitle(messages, '')
  const next = normalizeStatelessSessionEntry({
    id: instance.projectId,
    title: overrides.title
      || (existing?.title && existing.title !== '临时会话' ? existing.title : '')
      || derivedTitle
      || instance.branchTitle
      || '临时会话',
    createdAt,
    updatedAt: overrides.updatedAt || existing?.updatedAt || createdAt,
    turnCount: Math.max(
      Number(existing?.turnCount) || 0,
      Number(persistedHistory?.roundCount) || 0,
      messages.filter(message => message?.role === 'user' && !message.hidden && !message.isInterject).length
    ),
    lastMessageSummary: deriveLastMessageSummary(messages, existing?.lastMessageSummary),
    storagePath: instance.rootStoragePath || instance.storagePath || existing?.storagePath
  })
  if (!next) return null
  const changed = !existing || ['title', 'createdAt', 'updatedAt', 'turnCount', 'lastMessageSummary', 'storagePath']
    .some(key => existing[key] !== next[key])
  if (existing) Object.assign(existing, next)
  else index.sessions.push(next)
  if (changed) {
    sortStatelessSessions(index)
    if (overrides.flush) writeStatelessSessionIndexNow()
    else scheduleStatelessSessionIndexWrite()
  }
  return next
}

function removeStatelessSessionFromIndex(projectId, options = {}) {
  const index = readStatelessSessionIndex()
  const previousLength = index.sessions.length
  index.sessions = index.sessions.filter(item => item.id !== projectId)
  if (index.sessions.length === previousLength) return false
  if (options.flush) writeStatelessSessionIndexNow()
  else scheduleStatelessSessionIndexWrite()
  return true
}

function readStatelessSessionDiskMetadata(storagePath) {
  const result = { title: '', updatedAt: 0, promoted: false }
  try {
    const branchRoot = path.join(storagePath, 'branch-sessions')
    const branches = fs.existsSync(branchRoot) ? fs.readdirSync(branchRoot, { withFileTypes: true }) : []
    for (const branch of branches) {
      if (!branch.isDirectory()) continue
      const branchDir = path.join(branchRoot, branch.name)
      try {
        const projectMeta = JSON.parse(fs.readFileSync(path.join(branchDir, 'project.json'), 'utf8'))
        if (String(projectMeta?.projectPath || '').trim()) result.promoted = true
      } catch {}
      try {
        const branchMeta = JSON.parse(fs.readFileSync(path.join(branchDir, 'branch-session.json'), 'utf8'))
        const updatedAt = Number(branchMeta?.updatedAt) || 0
        if (updatedAt >= result.updatedAt) {
          result.updatedAt = updatedAt
          result.title = String(branchMeta?.title || '').trim()
        }
      } catch {}
    }
  } catch (error) {
    console.warn('[Projects] read stateless session metadata failed:', error.message)
  }
  return result
}

function reconcileStatelessSessionStorage() {
  const index = readStatelessSessionIndex()
  const known = new Set(index.sessions.map(item => item.id))
  let changed = false

  if (!statelessSessionStorageReconciled) {
    statelessSessionStorageReconciled = true
    try {
      const root = getStatelessSessionsRoot()
      const entries = fs.existsSync(root) ? fs.readdirSync(root, { withFileTypes: true }) : []
      for (const entry of entries) {
        if (!entry.isDirectory() || !entry.name.startsWith('stateless-chat-')) continue
        const storagePath = path.join(root, entry.name)
        const stat = fs.statSync(storagePath)
        const diskMeta = readStatelessSessionDiskMetadata(storagePath)
        const existing = index.sessions.find(item => item.id === entry.name)
        if (diskMeta.promoted) {
          if (existing) {
            index.sessions = index.sessions.filter(item => item.id !== entry.name)
            known.delete(entry.name)
            changed = true
          }
          continue
        }
        if (existing) {
          if ((!existing.title || existing.title === '临时会话') && diskMeta.title) {
            existing.title = diskMeta.title.slice(0, 80)
            changed = true
          }
          if (diskMeta.updatedAt > existing.updatedAt) {
            existing.updatedAt = diskMeta.updatedAt
            changed = true
          }
          continue
        }
        index.sessions.push(normalizeStatelessSessionEntry({
          id: entry.name,
          title: diskMeta.title || '临时会话',
          createdAt: parseStatelessSessionCreatedAt(entry.name) || stat.birthtimeMs || stat.mtimeMs,
          updatedAt: diskMeta.updatedAt || stat.mtimeMs,
          storagePath
        }))
        known.add(entry.name)
        changed = true
      }
    } catch (error) {
      console.warn('[Projects] reconcile stateless session storage failed:', error.message)
    }
  }

  for (const instance of config.getProjectInstances().values()) {
    if (!instance?.stateless) continue
    const existed = known.has(instance.projectId)
    upsertStatelessSession(instance)
    if (!existed) {
      known.add(instance.projectId)
      changed = true
    }
  }
  if (changed) {
    sortStatelessSessions(index)
    scheduleStatelessSessionIndexWrite()
  }
  return index
}

const IMAGE_FILE_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp', '.ico', '.avif', '.tif', '.tiff'
])

const IMAGE_MIME_BY_EXT = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.bmp': 'image/bmp',
  '.ico': 'image/x-icon',
  '.avif': 'image/avif',
  '.tif': 'image/tiff',
  '.tiff': 'image/tiff'
}

function isSupportedImagePath(filePath) {
  return IMAGE_FILE_EXTENSIONS.has(path.extname(filePath || '').toLowerCase())
}

async function readImageDataUrl(filePath) {
  filePath = assertAllowedFileAccess(filePath, 'read image')
  if (!filePath) return { success: false, error: 'image does not exist' }
  try {
    const stat = await fs.promises.stat(filePath)
    if (!stat.isFile()) return { success: false, error: 'not a file' }
  } catch {
    return { success: false, error: 'image does not exist' }
  }
  if (!isSupportedImagePath(filePath)) {
    return { success: false, error: 'unsupported image format' }
  }

  const ext = path.extname(filePath).toLowerCase()
  const mime = IMAGE_MIME_BY_EXT[ext] || 'image/png'
  const [metadata, buffer] = await Promise.all([
    sharp(filePath).metadata().catch(() => ({})),
    fs.promises.readFile(filePath)
  ])
  return {
    success: true,
    path: filePath,
    dataUrl: `data:${mime};base64,${buffer.toString('base64')}`,
    mime,
    width: metadata.width || null,
    height: metadata.height || null,
    format: metadata.format || ext.replace('.', ''),
    size: buffer.length
  }
}
function assertProjectStoragePath(storagePath) {
  if (!storagePath) return null

  const resolvedStoragePath = path.resolve(storagePath)
  const resolvedProjectsDir = path.resolve(storageConfig.getProjectsDir())
  const relativePath = path.relative(resolvedProjectsDir, resolvedStoragePath)

  if (!relativePath || relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
    throw new Error('拒绝访问不在项目存储目录内的路径: ' + resolvedStoragePath)
  }

  return resolvedStoragePath
}

function isPathInside(parentPath, childPath) {
  if (!parentPath || !childPath) return false
  const relativePath = path.relative(path.resolve(parentPath), path.resolve(childPath))
  return relativePath === '' || (!!relativePath && !relativePath.startsWith('..') && !path.isAbsolute(relativePath))
}

function getAllowedFileAccessRoots() {
  const roots = []
  try {
    const basePath = storageConfig.getBasePath?.()
    if (basePath) roots.push(basePath)
  } catch { /* storageConfig 尚未初始化 */ }
  try {
    const reportsDir = agentCollaborationReports.getReportsDir?.()
    if (reportsDir) roots.push(reportsDir)
  } catch { /* 协作汇报目录尚未初始化 */ }
  for (const instance of config.getProjectInstances().values()) {
    if (instance?.projectPath) roots.push(instance.projectPath)
    if (instance?.storagePath) roots.push(instance.storagePath)
  }
  return [...new Set(roots.map(root => path.resolve(root)).filter(Boolean))]
}

function assertAllowedFileAccess(filePath, operation = 'file access') {
  if (!filePath) throw new Error('path is empty')
  const resolved = path.resolve(String(filePath))
  const allowed = getAllowedFileAccessRoots().some(root => isPathInside(root, resolved))
  if (!allowed) {
    throw new Error(`${operation} is outside allowed project paths: ${resolved}`)
  }
  return resolved
}

function assertManagedChildPath(targetPath, basePath, label = 'managed data') {
  if (!targetPath) return null

  const resolvedTarget = path.resolve(targetPath)
  const resolvedBase = path.resolve(basePath)
  const relativePath = path.relative(resolvedBase, resolvedTarget)

  if (!relativePath || relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
    throw new Error(`Refused to delete invalid ${label} directory: ${resolvedTarget}`)
  }

  return resolvedTarget
}

function removeManagedDirectory(targetPath, basePath, label) {
  const safePath = assertManagedChildPath(targetPath, basePath, label)
  if (!safePath || !fs.existsSync(safePath)) {
    return { deleted: false, path: safePath || targetPath || null }
  }

  fs.rmSync(safePath, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
  console.log(`[Projects] Deleted ${label}:`, safePath)
  return { deleted: true, path: safePath }
}

async function removeManagedDirectoryAsync(targetPath, basePath, label) {
  const safePath = assertManagedChildPath(targetPath, basePath, label)
  if (!safePath) {
    return { deleted: false, path: targetPath || null }
  }

  try {
    await fs.promises.access(safePath)
  } catch {
    return { deleted: false, path: safePath }
  }

  // 会话目录可能包含较大的历史和上下文文件。异步删除避免 rmSync 的
  // 重试等待阻塞 Electron 主进程，造成删除后输入框短暂无法响应。
  await fs.promises.rm(safePath, {
    recursive: true,
    force: true,
    maxRetries: 3,
    retryDelay: 100
  })
  console.log(`[Projects] Deleted ${label}:`, safePath)
  return { deleted: true, path: safePath }
}

function sanitizeProjectKeyForData(instance = {}) {
  const raw = instance.projectId || instance.id || instance.projectPath || instance.storagePath || 'default'
  const safe = String(raw)
    .replace(/[^a-zA-Z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '')
  return safe || 'default'
}

function findProjectListMatches(projectId, projectPath = '') {
  const result = storageConfig.getProjectsList()
  const list = result?.success && Array.isArray(result.data) ? result.data : []
  const normalizedProjectPath = projectPath ? path.resolve(projectPath).toLowerCase() : ''

  return list.filter(item => {
    if (!item) return false
    const itemPath = item.path || item.projectPath || ''
    const itemId = item.id || item.projectId || (itemPath ? generateProjectId(itemPath) : '')
    return (
      (!!projectId && itemId === projectId) ||
      (!!projectId && itemPath && generateProjectId(itemPath) === projectId) ||
      (!!normalizedProjectPath && itemPath && path.resolve(itemPath).toLowerCase() === normalizedProjectPath)
    )
  })
}

function removeProjectListEntries(projectId, projectPath = '') {
  const result = storageConfig.getProjectsList()
  if (!result?.success || !Array.isArray(result.data)) {
    return {
      removedCount: 0,
      removedIds: [],
      removedPaths: [],
      saveResult: result?.success === false ? result : { success: true }
    }
  }

  const removed = []
  const normalizedProjectPath = projectPath ? path.resolve(projectPath).toLowerCase() : ''
  const next = result.data.filter(item => {
    if (!item) return false
    const itemPath = item.path || item.projectPath || ''
    const itemId = item.id || item.projectId || (itemPath ? generateProjectId(itemPath) : '')
    const matched = (
      (!!projectId && itemId === projectId) ||
      (!!projectId && itemPath && generateProjectId(itemPath) === projectId) ||
      (!!normalizedProjectPath && itemPath && path.resolve(itemPath).toLowerCase() === normalizedProjectPath)
    )
    if (matched) removed.push(item)
    return !matched
  })

  if (removed.length === 0) {
    return { removedCount: 0, removedIds: [], removedPaths: [], saveResult: { success: true } }
  }

  const saveResult = storageConfig.saveProjectsList(next)
  return {
    removedCount: removed.length,
    removedIds: [...new Set(removed.map(item => item.id || item.projectId).filter(Boolean))],
    removedPaths: [...new Set(removed.map(item => item.path || item.projectPath).filter(Boolean))],
    saveResult
  }
}

function buildDeleteTarget(projectId, instance) {
  if (instance) return instance

  const matches = findProjectListMatches(projectId)
  const projectPath = matches.find(item => item?.path || item?.projectPath)?.path || matches.find(item => item?.projectPath)?.projectPath || ''
  const storagePath = projectPath ? getProjectStoragePath(projectPath) : ''
  return {
    projectId,
    projectPath,
    storagePath,
    chatHistoryPath: storagePath ? path.join(storagePath, 'chat-history.json') : ''
  }
}

function deleteProjectManagedData(instance) {
  const result = {
    deletedProjectData: false,
    deletedLedgerData: false,
    deletedArtifactData: false,
    storagePath: instance?.storagePath || null,
    ledgerPath: null,
    artifactPath: null
  }

  if (instance?.storagePath && fs.existsSync(instance.storagePath)) {
    const safeStoragePath = assertProjectStoragePath(instance.storagePath)
    fs.rmSync(safeStoragePath, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
    console.log('[Projects] Deleted project internal data:', safeStoragePath)
    result.deletedProjectData = true
    result.storagePath = safeStoragePath
  }

  const projectKey = sanitizeProjectKeyForData(instance)
  const ledgerDelete = removeManagedDirectory(path.join(storageConfig.getSummariesDir(), projectKey), storageConfig.getSummariesDir(), 'project ledger data')
  result.deletedLedgerData = ledgerDelete.deleted
  result.ledgerPath = ledgerDelete.path

  const artifactDelete = removeManagedDirectory(path.join(storageConfig.getArtifactsDir(), projectKey), storageConfig.getArtifactsDir(), 'project artifact data')
  result.deletedArtifactData = artifactDelete.deleted
  result.artifactPath = artifactDelete.path

  return result
}

function makeTrashPath(projectPath) {
  const trashRoot = storageConfig.getProjectTrashDir()
  const safeName = String(path.basename(projectPath) || 'project').replace(/[<>:"/\\|?*]/g, '_')
  const suffix = new Date().toISOString().replace(/[:.]/g, '-')
  fs.mkdirSync(trashRoot, { recursive: true })
  return path.join(trashRoot, `${safeName}-${suffix}`)
}

async function moveProjectToTrash(projectPath) {
  const resolvedProjectPath = path.resolve(projectPath)
  const resolvedStorageBase = path.resolve(storageConfig.getBasePath())
  const rootPath = path.parse(resolvedProjectPath).root

  if (!fs.existsSync(resolvedProjectPath)) {
    return { moved: false, trashPath: null }
  }
  if (resolvedProjectPath === rootPath) {
    throw new Error('refuse to delete drive root')
  }
  if (isPathInside(resolvedStorageBase, resolvedProjectPath)) {
    throw new Error('refuse to delete storage root as project')
  }
  if (isPathInside(resolvedProjectPath, resolvedStorageBase)) {
    throw new Error('refuse to delete project containing storage root')
  }

  const trashPath = makeTrashPath(resolvedProjectPath)
  try {
    fs.renameSync(resolvedProjectPath, trashPath)
    return { moved: true, trashPath, systemTrash: false }
  } catch (error) {
    if (error.code !== 'EXDEV') throw error
    await shell.trashItem(resolvedProjectPath)
    return { moved: true, trashPath: null, systemTrash: true }
  }
}

function getDirectoryMtimeMs(projectPath) {
  try {
    if (!projectPath || !fs.existsSync(projectPath)) return 0
    const stat = fs.statSync(projectPath)
    return stat.isDirectory() ? stat.mtimeMs : 0
  } catch {
    return 0
  }
}

function sanitizeProjectFolderName(name = '') {
  const trimmed = String(name || '').trim()
  if (!trimmed) throw new Error('项目名称不能为空')
  if (/[<>:"/\\|?*\x00-\x1F]/.test(trimmed)) {
    throw new Error('项目名称不能包含 <>:"/\\|?* 等非法字符')
  }
  if (/^\.+$/.test(trimmed)) {
    throw new Error('项目名称不能只包含点号')
  }
  if (/[. ]$/.test(trimmed)) {
    throw new Error('项目名称不能以空格或点号结尾')
  }
  return trimmed
}

function renameProjectFolder(projectId, nextName) {
  if (!projectId) return { success: false, error: 'Missing projectId' }
  const instance = config.getProjectInstance(projectId)
  const matches = findProjectListMatches(projectId)
  const oldPath = instance?.projectPath || matches.find(item => item?.path || item?.projectPath)?.path || matches.find(item => item?.projectPath)?.projectPath || ''
  if (!oldPath) return { success: false, error: 'project path not found' }

  const resolvedOldPath = path.resolve(oldPath)
  if (!fs.existsSync(resolvedOldPath)) {
    return { success: false, error: '项目目录不存在，无法重命名' }
  }
  if (!fs.statSync(resolvedOldPath).isDirectory()) {
    return { success: false, error: '项目路径不是文件夹，无法重命名' }
  }

  const safeName = sanitizeProjectFolderName(nextName)
  const currentName = path.basename(resolvedOldPath)
  if (safeName === currentName) {
    return {
      success: true,
      projectId,
      path: resolvedOldPath,
      name: currentName,
      storagePath: instance?.storagePath || '',
      unchanged: true,
      folderMtimeMs: getDirectoryMtimeMs(resolvedOldPath)
    }
  }

  const targetPath = path.join(path.dirname(resolvedOldPath), safeName)
  if (fs.existsSync(targetPath)) {
    return { success: false, error: '同级目录已存在同名项目文件夹' }
  }

  try {
    fs.renameSync(resolvedOldPath, targetPath)
    if (instance) {
      instance.projectPath = targetPath
      if (instance.contextManager) instance.contextManager.projectPath = targetPath
    }

    const mainWindow = config.getMainWindow()
    if (mainWindow) {
      mainWindow.webContents.send('project-path-changed', {
        projectId,
        path: targetPath,
        storagePath: instance?.storagePath || '',
        status: instance?.contextManager?.getStatus?.() || null
      })
    }

    return {
      success: true,
      projectId,
      path: targetPath,
      oldPath: resolvedOldPath,
      name: safeName,
      storagePath: instance?.storagePath || '',
      folderMtimeMs: getDirectoryMtimeMs(targetPath)
    }
  } catch (error) {
    return { success: false, error: '重命名项目目录失败: ' + error.message }
  }
}

function clearProjectRuntimeData(instance, projectId) {
  if (!instance) return

  instance.messagesHistory = []
  instance.autoExecSteps = []
  instance.autoExecStepIndex = 0

  try {
    instance.contextManager?.clearAll?.()
  } catch (error) {
    console.warn('[Projects] clear project runtime context failed:', error.message)
  }

  // 清理空闲终端会话
  if (projectId) {
    try {
      terminalSessions.clearProject(projectId)
    } catch (error) {
      console.warn('[Projects] clear terminal sessions failed:', error.message)
    }
  }
}

/**
 * Generate a stable project id from a project path.
 */
function generateProjectId(inputPath) {
  let hash = 0
  for (let i = 0; i < inputPath.length; i++) {
    hash = ((hash << 5) - hash) + inputPath.charCodeAt(i)
  }
  return 'project-' + Math.abs(hash).toString(16).substring(0, 8)
}

/**
 * Resolve the managed storage directory for a project.
 * The base directory is provided by storageConfig.
 */
function getProjectStoragePath(projectPath, projectIdOverride = '') {
  const hash = projectIdOverride || generateProjectId(projectPath)
  const projectName = path.basename(projectPath) || 'default'
  // Keep project data under the configured projects directory.
  const projectsDir = storageConfig.getProjectsDir()
  return path.join(projectsDir, `${projectName}-${hash}`)
}

function hashScope(value) {
  return crypto.createHash('sha1').update(String(value || 'workspace')).digest('hex')
}

function safeScopeName(value) {
  const safe = String(value || 'workspace')
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1F]+/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80)
  return safe || 'workspace'
}



async function resolveBranchNameForSessionAsync(instance) {
  const detectedBranchName = await getCurrentBranchName(instance?.projectPath)
  const previousBranchName = String(instance?.branchName || '').trim()
  if (
    detectedBranchName === 'workspace' &&
    previousBranchName &&
    previousBranchName !== 'workspace' &&
    instance?.branchSessionPath
  ) {
    console.warn('[Projects] branch detection fell back to workspace; keeping previous branch session:', instance.projectId, previousBranchName)
    return previousBranchName
  }
  if (
    previousBranchName &&
    detectedBranchName !== previousBranchName &&
    config.getAbortController(instance?.projectId)
  ) {
    console.warn('[Projects] branch changed while AI is running; keeping current branch session:', instance.projectId, previousBranchName, 'detected:', detectedBranchName)
    return previousBranchName
  }
  return detectedBranchName
}

function getBranchKey(branchName) {
  return `${safeScopeName(branchName)}-${hashScope(branchName).slice(0, 8)}`
}


async function getCurrentBranchName(projectPath) {
  if (!projectPath) return 'workspace'
  try {
    const { stdout } = await execFileAsync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
      cwd: projectPath, encoding: 'utf8', timeout: 3000, windowsHide: true
    })
    const branch = stdout.trim()
    if (branch && branch !== 'HEAD') return branch
    const { stdout: hashOut } = await execFileAsync('git', ['rev-parse', '--short', 'HEAD'], {
      cwd: projectPath, encoding: 'utf8', timeout: 3000, windowsHide: true
    })
    const hash = hashOut.trim()
    return hash ? `detached:${hash}` : 'workspace'
  } catch { return 'workspace' }
}

async function getMainBranchName(projectPath) {
  if (!projectPath) return ''
  try {
    const { stdout } = await execFileAsync('git', ['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD'], {
      cwd: projectPath, encoding: 'utf8', timeout: 3000, windowsHide: true
    })
    const remoteBranch = stdout.trim().replace(/^origin\//, '')
    if (remoteBranch) return remoteBranch
  } catch { /* 远程 origin/HEAD 未设置 */ }
  for (const name of ['main', 'master']) {
    try {
      await execFileAsync('git', ['show-ref', '--verify', '--quiet', `refs/heads/${name}`], {
        cwd: projectPath, timeout: 3000, windowsHide: true, stdio: 'ignore'
      })
      return name
    } catch { /* 该默认分支不存在 */ }
  }
  return ''
}

async function getLocalBranchNames(projectPath) {
  if (!projectPath) return []
  try {
    const { stdout } = await execFileAsync('git', ['branch', '--format=%(refname:short)'], {
      cwd: projectPath, encoding: 'utf8', timeout: 3000, windowsHide: true
    })
    return stdout.split(/\r?\n/).map(n => String(n || '').trim()).filter(Boolean)
  } catch { return [] }
}

async function readChatHistoryAsync(chatHistoryPath) {
  if (!chatHistoryPath) return []
  const pendingRead = pendingChatHistoryReads.get(chatHistoryPath)
  if (pendingRead) return pendingRead

  const readPromise = _readChatHistoryAsync(chatHistoryPath)
  pendingChatHistoryReads.set(chatHistoryPath, readPromise)
  try {
    return await readPromise
  } finally {
    if (pendingChatHistoryReads.get(chatHistoryPath) === readPromise) {
      pendingChatHistoryReads.delete(chatHistoryPath)
    }
  }
}

async function _readChatHistoryAsync(chatHistoryPath) {
  try {
    const chunkHistory = await chatChunkStore.readAll(chatHistoryPath)
    if (chunkHistory) {
      return contextCompression.removeTransientDividerMessages(chunkHistory.messages)
    }
  } catch (error) {
    console.warn('[Projects] chunk history unavailable, falling back to legacy history:', error.message)
  }
  try {
    const data = await fs.promises.readFile(chatHistoryPath, 'utf-8')
    const parsed = JSON.parse(data)
    // 新格式：{ messages, hasArchive } —— 合并归档文件
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed) && Array.isArray(parsed.messages)) {
      let messages = parsed.messages
      if (parsed.hasArchive) {
        try {
          const archivePath = path.join(
            path.dirname(chatHistoryPath),
            `${path.basename(chatHistoryPath, path.extname(chatHistoryPath))}-archive${path.extname(chatHistoryPath)}`
          )
          const archiveData = await fs.promises.readFile(archivePath, 'utf-8')
          const archiveParsed = JSON.parse(archiveData)
          const archiveMessages = Array.isArray(archiveParsed) ? archiveParsed
            : (archiveParsed && Array.isArray(archiveParsed.messages) ? archiveParsed.messages : [])
          messages = archiveMessages.concat(messages)
        } catch (archiveErr) {
          if (archiveErr.code !== 'ENOENT') {
            console.warn('[Projects] read archive chat history failed:', archiveErr.message)
          }
        }
      }
      const normalized = contextCompression.removeTransientDividerMessages(messages)
      await chatChunkStore.migrateLegacy(chatHistoryPath, normalized).catch(error => {
        console.warn('[Projects] legacy chat migration deferred:', error.message)
      })
      return normalized
    }
    const normalized = contextCompression.removeTransientDividerMessages(Array.isArray(parsed) ? parsed : [])
    await chatChunkStore.migrateLegacy(chatHistoryPath, normalized).catch(error => {
      console.warn('[Projects] legacy chat migration deferred:', error.message)
    })
    return normalized
  } catch (e) {
    if (e.code !== 'ENOENT') console.error('[Projects] load chat history failed:', e.message)
    return []
  }
}

async function readLatestChatHistoryPage(instance, options = {}) {
  if (!instance?.chatHistoryPath) {
    return { messages: [], nextCursor: null, hasMore: false, direction: 'older', range: null, manifest: null }
  }

  try {
    if (!await chatChunkStore.readManifest(instance.chatHistoryPath)) {
      await readChatHistoryAsync(instance.chatHistoryPath)
    }
    const page = await chatChunkStore.readPage(instance.chatHistoryPath, {
      cursor: options.cursor,
      pageChunks: options.pageChunks,
      direction: options.direction
    })
    if (page) {
      return {
        ...page,
        messages: contextCompression.removeTransientDividerMessages(page.messages || [])
      }
    }
  } catch (error) {
    console.warn('[Projects] paged chat history unavailable:', error.message)
  }

  const messages = await readChatHistoryAsync(instance.chatHistoryPath)
  const recentGroups = chatMessageIdentity.groupByRound(messages).slice(-DEFAULT_HISTORY_PAGE_ROUNDS)
  return {
    messages: recentGroups.flatMap(group => group.messages),
    nextCursor: null,
    hasMore: false,
    direction: 'older',
    range: null,
    manifest: null,
    fallback: true
  }
}

function applyHistoryPageToInstance(instance, page) {
  const messages = contextCompression.removeTransientDividerMessages(page?.messages || [])
  instance.messagesHistory = messages
  const pageRounds = chatMessageIdentity.groupByRound(messages).length
  const totalRounds = Math.max(pageRounds, Number(page?.manifest?.roundCount) || pageRounds)
  instance._runtimeHistoryStartTurn = Math.max(1, totalRounds - pageRounds + 1)
  return messages
}

function toPagedHistoryResult(page) {
  return {
    messages: page?.messages || [],
    messagesHistory: page?.messages || [],
    nextCursor: page?.nextCursor ?? null,
    hasMore: !!page?.hasMore,
    direction: page?.direction || 'older',
    range: page?.range || null,
    paged: !!page?.range
  }
}
// 写入队列——同一路径短时间内多次写入只保留最后一次
const _chatWriteQueue = new Map()

function normalizeChatHistoryPathKey(filePath = '') {
  return String(filePath || '').replace(/[\\/]+/g, path.sep).replace(/[\\/]+$/, '')
}

function isChatHistoryWriteCancelled(filePath = '') {
  const key = normalizeChatHistoryPathKey(filePath)
  if (!key) return false
  if (cancelledChatHistoryWrites.has(key)) return true
  for (const cancelled of cancelledChatHistoryWrites) {
    if (key === cancelled || key.startsWith(cancelled + path.sep)) return true
  }
  return false
}

function cancelChatHistoryWritesForSessionPath(sessionPath = '') {
  const root = normalizeChatHistoryPathKey(sessionPath)
  if (!root) return
  cancelledChatHistoryWrites.add(root)
  const historyPath = path.join(root, 'chat-history.json')
  const archivePath = historyPath.replace(/\.json$/i, '-archive.json')
  cancelledChatHistoryWrites.add(normalizeChatHistoryPathKey(historyPath))
  cancelledChatHistoryWrites.add(normalizeChatHistoryPathKey(archivePath))

  for (const [filePath, entry] of Array.from(_chatWriteQueue.entries())) {
    const key = normalizeChatHistoryPathKey(filePath)
    if (key === root || key.startsWith(root + path.sep) || key === normalizeChatHistoryPathKey(historyPath)) {
      if (entry) entry.cancelled = true
      _chatWriteQueue.delete(filePath)
    }
  }
  for (const filePath of Array.from(pendingChatHistoryReads.keys())) {
    const key = normalizeChatHistoryPathKey(filePath)
    if (key === root || key.startsWith(root + path.sep)) {
      pendingChatHistoryReads.delete(filePath)
    }
  }

  // 短生命周期标记，避免永久膨胀；给在途写盘一点时间识别取消
  const historyKey = normalizeChatHistoryPathKey(historyPath)
  const archiveKey = normalizeChatHistoryPathKey(archivePath)
  const prevTimer = cancelledChatHistoryExpiryTimers.get(root)
  if (prevTimer) clearTimeout(prevTimer)
  const timer = setTimeout(() => {
    cancelledChatHistoryExpiryTimers.delete(root)
    cancelledChatHistoryWrites.delete(root)
    cancelledChatHistoryWrites.delete(historyKey)
    cancelledChatHistoryWrites.delete(archiveKey)
  }, 15000)
  cancelledChatHistoryExpiryTimers.set(root, timer)
}

function writeChatHistory(chatHistoryPath, messagesHistory = [], instance = null) {
  if (!chatHistoryPath) return Promise.resolve()
  if (isChatHistoryWriteCancelled(chatHistoryPath)) return Promise.resolve()

  // 只记录最新来源。真正轮到序列化时才创建快照，避免每次保存请求都复制完整历史。
  const existing = _chatWriteQueue.get(chatHistoryPath)
  if (existing) {
    if (existing.cancelled) return Promise.resolve()
    existing.messagesSource = messagesHistory
    existing.instance = instance
    existing.version += 1
    return existing.promise
  }
  const entry = { messagesSource: messagesHistory, instance, version: 1, promise: null, cancelled: false }
  const p = _processQueuedChatWrite(chatHistoryPath, entry)
  entry.promise = p
  _chatWriteQueue.set(chatHistoryPath, entry)
  return p
}

async function _processQueuedChatWrite(filePath, entry) {
  try {
    while (true) {
      if (entry?.cancelled || isChatHistoryWriteCancelled(filePath)) {
        console.log('[Projects] skip cancelled chat history write:', filePath)
        break
      }
      const version = entry.version
      const snapshotStartedAt = performance.now()
      const messages = Array.isArray(entry.messagesSource) ? entry.messagesSource.slice() : []
      const snapshotMs = performance.now() - snapshotStartedAt
      if (!await chatChunkStore.readManifest(filePath)) {
        const legacyExists = await fs.promises.stat(filePath).then(stat => stat.isFile()).catch(() => false)
        if (legacyExists) {
          const legacyMessages = await _readChatHistoryAsync(filePath)
          await chatChunkStore.migrateLegacy(filePath, legacyMessages)
        }
      }
      if (entry?.cancelled || isChatHistoryWriteCancelled(filePath)) {
        console.log('[Projects] skip cancelled chat history write before append:', filePath)
        break
      }
      if (version !== entry.version) continue
      const writeStartedAt = performance.now()
      const result = await chatChunkStore.syncSnapshot(filePath, messages, {
        sessionId: entry.instance?.chatSessionId || entry.instance?.branchKey || entry.instance?.projectId || path.basename(path.dirname(filePath))
      })
      const writeMs = performance.now() - writeStartedAt
      if (version !== entry.version) continue
      if (process.env.LINGXI_CHAT_HISTORY_PERF === '1' || snapshotMs > 80 || writeMs > 120) {
        console.log('[ChatHistoryPerf]', {
          snapshotMessages: messages.length,
          appendedMessages: result.appendedCount,
          persistedMessages: result.manifest.messageCount,
          chunks: result.manifest.chunks.length,
          snapshotMs: Number(snapshotMs.toFixed(2)),
          appendMs: Number(writeMs.toFixed(2))
        })
      }
      pendingChatHistoryReads.delete(filePath)
      if (entry.instance) entry.instance._chatHistoryDirty = false
      break
    }
  } catch (e) {
    console.error('[Projects] async serialize/write chat history failed:', e.message)
  } finally {
    if (_chatWriteQueue.get(filePath) === entry) _chatWriteQueue.delete(filePath)
  }
}

/** 等待所有异步聊天历史写入完成（窗口关闭前调用） */
async function flushPendingChatWrites() {
  // 清掉取消标记的过期定时器，避免退出时残留 pending timeout
  for (const timer of cancelledChatHistoryExpiryTimers.values()) {
    try { clearTimeout(timer) } catch (_) { /* ignore */ }
  }
  cancelledChatHistoryExpiryTimers.clear()

  // 先把所有待延迟保存的定时器立即触发，确保最新消息进入写入队列
  const pendingEntries = Array.from(pendingChatHistorySaves.entries())
  for (const [saveKey, pending] of pendingEntries) {
    try { saveProjectChatHistory(pending?.target || saveKey) } catch (e) {
      console.error('[Projects] flush deferred save failed:', saveKey, e.message)
    }
  }
  // 等待队列里的写入完成
  const promises = []
  for (const [, entry] of _chatWriteQueue) {
    if (entry.promise) promises.push(entry.promise)
  }
  // 同时 flush 所有项目实例的 memory 和 summary 延迟保存
  const projectInstances = config.getProjectInstances()
  for (const [, instance] of projectInstances) {
    if (instance?.contextManager?.memory?.flush) {
      promises.push(instance.contextManager.memory.flush())
    }
    if (instance?.contextManager?.summary?._flushSave) {
      promises.push(instance.contextManager.summary._flushSave())
    }
  }
  await Promise.allSettled(promises)
  if (statelessSessionIndexCache) {
    try { writeStatelessSessionIndexNow() } catch (error) {
      console.warn('[Projects] flush stateless session index failed:', error.message)
    }
  }
}

function deriveChatTitle(messagesHistory = [], fallback = '') {
  const firstUser = (Array.isArray(messagesHistory) ? messagesHistory : [])
    .find(msg => msg?.role === 'user' && !msg.hidden)
  const raw = String(firstUser?.displayContent || firstUser?.content || '').replace(/\s+/g, ' ').trim()
  if (!raw) return fallback || ''
  return raw.length > 30 ? `${raw.slice(0, 30)}...` : raw
}

function deriveBranchFallbackTitle(branchName, isMainline = false) {
  if (isMainline) return '主线会话'
  const raw = String(branchName || '').trim()
  return raw ? `${raw} 分支会话` : ''
}

function getBranchSessionMetaPath(branchStoragePath) {
  return path.join(branchStoragePath, 'branch-session.json')
}

async function writeBranchSessionMetaAsync(instance) {
  if (!instance?.branchSessionPath) return
  const meta = {
    branchName: instance.branchName || 'workspace',
    branchKey: instance.branchKey || getBranchKey(instance.branchName || 'workspace'),
    title: instance.branchTitle || deriveChatTitle(instance.messagesHistory || [], ''),
    updatedAt: Date.now()
  }
  await taskRuns.atomicWriteJsonAsync(getBranchSessionMetaPath(instance.branchSessionPath), meta)
}

async function setBranchSessionTitle(projectId, title = '') {
  const instance = await ensureProjectBranchSession(projectId)
  if (!instance) return { success: false, error: 'project does not exist' }
  const nextTitle = String(title || '').replace(/\s+/g, ' ').trim()
  if (!nextTitle) return { success: false, error: '标题不能为空' }

  // 分支标题只写 branch-session 元数据，不覆盖同分支下的 chatSessionTitle
  instance.branchTitle = nextTitle.length > 30 ? `${nextTitle.slice(0, 30)}...` : nextTitle
  await writeBranchSessionMetaAsync(instance)
  return {
    success: true,
    projectId: instance.projectId,
    branchName: instance.branchName || '',
    branchKey: instance.branchKey || '',
    branchTitle: instance.branchTitle || '',
    chatSessionTitle: instance.chatSessionTitle || '',
    branchSessions: await listBranchSessions(instance)
  }
}

async function listBranchSessions(instance) {
  if (!instance?.rootStoragePath) return []
  const sessionsDir = path.join(instance.rootStoragePath, 'branch-sessions')
  const sessionsByName = new Map()
  const [mainBranchName, localBranchNames, currentBranchName] = await Promise.all([
    getMainBranchName(instance.projectPath),
    getLocalBranchNames(instance.projectPath),
    getCurrentBranchName(instance.projectPath)
  ])
  const localBranchSet = new Set(localBranchNames)
  const shouldKeepBranch = branchName => {
    if (!branchName) return false
    if (localBranchSet.size === 0) return branchName !== 'workspace' || currentBranchName === 'workspace'
    return localBranchSet.has(branchName)
  }
  const addSession = session => {
    const branchName = String(session?.branchName || '').trim()
    if (!shouldKeepBranch(branchName)) return
    const branchKey = String(session?.branchKey || getBranchKey(branchName))
    const isMainline = mainBranchName ? branchName === mainBranchName : /^(main|master)$/i.test(branchName)
    const existing = sessionsByName.get(branchName)
    const nextTitle = String(session?.title || '').trim()
    const next = {
      branchName,
      branchKey,
      title: nextTitle || (isMainline ? '主线会话' : ''),
      updatedAt: Number(session?.updatedAt || 0),
      isMainline,
      current: branchKey === instance.branchKey || branchName === currentBranchName
    }
    if (!existing || next.updatedAt >= (existing.updatedAt || 0) || next.current) {
      // 合并时保留已有非空标题，防止 current/本地分支空标题覆盖 branch-session.json
      const mergedTitle = next.title || existing?.title || (isMainline ? '主线会话' : '')
      sessionsByName.set(branchName, {
        ...existing,
        ...next,
        title: mergedTitle,
        updatedAt: Math.max(Number(existing?.updatedAt || 0), Number(next.updatedAt || 0))
      })
    }
  }

  try {
    let entries = []
    try { entries = await fs.promises.readdir(sessionsDir, { withFileTypes: true }) } catch { /* sessions 目录不存在 */ }
    await Promise.all(entries
      .filter(e => e.isDirectory())
      .map(async dirent => {
        const dir = path.join(sessionsDir, dirent.name)
        const metaPath = getBranchSessionMetaPath(dir)
        let meta = null
        try {
          const raw = await fs.promises.readFile(metaPath, 'utf-8')
          meta = JSON.parse(raw)
        } catch { /* 会话元数据读取或解析失败 */ }
        const branchKey = String(meta?.branchKey || dirent.name)
        const branchName = String(meta?.branchName || dirent.name.replace(/-[a-f0-9]{8}$/i, '') || '').trim()
        if (!shouldKeepBranch(branchName)) return
      const chatHistoryPath = path.join(dir, 'chat-history.json')
        const stat = chatChunkStore.getStatSync(chatHistoryPath)
        const isMainline = mainBranchName ? branchName === mainBranchName : /^(main|master)$/i.test(branchName)
        addSession({
          branchName,
          branchKey,
          title: String(meta?.title || deriveBranchFallbackTitle(branchName, isMainline)),
          updatedAt: Number(meta?.updatedAt || stat.mtimeMs || 0)
        })
      })
    )
  } catch (e) {
    console.warn('[Projects] list branch sessions failed:', e.message)
  }

  for (const branchName of localBranchNames) {
    addSession({
      branchName,
      branchKey: getBranchKey(branchName),
      title: branchName === mainBranchName || /^(main|master)$/i.test(branchName) ? '主线会话' : '',
      updatedAt: 0
    })
  }

  if (mainBranchName) {
    addSession({
      branchName: mainBranchName,
      branchKey: getBranchKey(mainBranchName),
      title: '主线会话',
      updatedAt: 0
    })
  }

  return [...sessionsByName.values()].sort((a, b) =>
    Number(b.isMainline) - Number(a.isMainline) ||
    Number(b.current) - Number(a.current) ||
    (b.updatedAt || 0) - (a.updatedAt || 0) ||
    String(a.branchName || '').localeCompare(String(b.branchName || ''), 'zh-Hans-CN')
  )
}
async function cleanupProjectBranchData(projectId, branchName) {
  const instance = typeof projectId === 'string' ? config.getProjectInstance(projectId) : projectId
  if (!instance) return { success: false, error: 'project not found' }

  const targetBranchName = String(branchName || '').trim()
  if (!targetBranchName) return { success: false, error: '分支名称不能为空' }
  if (/^(main|master)$/i.test(targetBranchName)) {
    return { success: false, error: '主线分支不能删除' }
  }
  const currentBranchName = await getCurrentBranchName(instance.projectPath)
  if (targetBranchName === currentBranchName) {
    return { success: false, error: '当前正在使用的分支不能删除，请先切换到主线或其他分支' }
  }

  const rootStoragePath = instance.rootStoragePath || instance.storagePath
  if (!rootStoragePath) return { success: true, deleted: false, reason: 'no storage path' }

  const sessionsDir = path.join(rootStoragePath, 'branch-sessions')
  const branchKey = getBranchKey(targetBranchName)
  const targetPath = path.join(sessionsDir, branchKey)
  await chatChunkStore.prepareStorageDeletion(targetPath)
  const deletedBranchSession = removeManagedDirectory(targetPath, sessionsDir, 'project branch session data')

  return {
    success: true,
    branchName: targetBranchName,
    branchKey,
    deletedBranchSession: deletedBranchSession.deleted,
    path: deletedBranchSession.path,
    branchSessions: await listBranchSessions(instance)
  }
}

function isBranchSessionEligible(instance) {
  return !!instance &&
    !instance.isDispatch &&
    !instance.isCollaborationChat &&
    !instance.isTemporaryAgentChat &&
    typeof instance.projectPath === 'string' &&
    instance.projectPath.trim() !== ''
}

function getChatSessionsRoot(instance) {
  const rootStoragePath = instance?.rootStoragePath || instance?.storagePath
  if (!rootStoragePath) return ''
  return path.join(rootStoragePath, 'chat-sessions')
}

function getChatSessionMetaPath(sessionPath) {
  return path.join(sessionPath, 'chat-session.json')
}

function createChatSessionId() {
  return `chat-${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`
}

// 从会话 id 解析创建时间，避免 meta 缺失时退回 chat-history mtime（保存历史会改 mtime 导致排序乱跳）
function parseChatSessionCreatedAt(sessionId = '') {
  const id = String(sessionId || '').trim()
  if (!id) return 0
  if (id === 'main') return 1
  const match = id.match(/^chat-([0-9a-z]+)-/i)
  if (!match) return 0
  const parsed = parseInt(match[1], 36)
  if (!Number.isFinite(parsed) || parsed < 1e11 || parsed > 2e13) return 0
  return parsed
}

function resolveChatSessionCreatedAt(sessionId = '', meta = null, dirStat = null) {
  const fromMeta = Number(meta?.createdAt || 0)
  if (fromMeta > 0) return fromMeta
  const fromId = parseChatSessionCreatedAt(sessionId)
  if (fromId > 0) return fromId
  const fromBirth = Number(dirStat?.birthtimeMs || 0)
  if (fromBirth > 0) return fromBirth
  const fromDirMtime = Number(dirStat?.mtimeMs || 0)
  if (fromDirMtime > 0) return fromDirMtime
  return Date.now()
}

function isChatSessionEligible(instance) {
  return !!instance &&
    !instance.isDispatch &&
    !instance.isCollaborationChat &&
    !instance.isTemporaryAgentChat &&
    typeof instance.projectPath === 'string' &&
    instance.projectPath.trim() !== '' &&
    !instance.stateless
}

function buildChatSessionPayload(instance, session = {}, options = {}) {
  const sessionId = String(session.sessionId || instance?.chatSessionId || '').trim()
  const title = String(
    session.title ||
    instance?.chatSessionTitle ||
    instance?.branchTitle ||
    deriveChatTitle(instance?.messagesHistory || [], '新会话')
  ).trim() || '新会话'
  const createdAt = Number(
    session.createdAt ||
    parseChatSessionCreatedAt(sessionId) ||
    Date.now()
  )
  return {
    sessionId,
    title,
    updatedAt: Number(session.updatedAt || createdAt || Date.now()),
    createdAt,
    isPrimary: options.isPrimary === true || session.isPrimary === true || sessionId === 'main',
    current: options.current === true || sessionId === String(instance?.chatSessionId || '').trim()
  }
}

async function writeChatSessionMetaAsync(instance, options = {}) {
  if (!instance?.chatSessionPath || !instance?.chatSessionId) return
  const now = Date.now()
  const meta = buildChatSessionPayload(instance, {
    sessionId: instance.chatSessionId,
    title: instance.chatSessionTitle || instance.branchTitle || '',
    createdAt: instance.chatSessionCreatedAt || now,
    // 标题更新默认不改 updatedAt，避免列表排序被“更新时间”影响
    updatedAt: options.touchUpdatedAt === false
      ? Number(instance.chatSessionUpdatedAt || instance.chatSessionCreatedAt || now)
      : now
  })
  if (options.touchUpdatedAt !== false) {
    instance.chatSessionUpdatedAt = meta.updatedAt
  }
  await taskRuns.atomicWriteJsonAsync(getChatSessionMetaPath(instance.chatSessionPath), meta)
}

async function updateProjectChatSessionTitle(projectId, sessionId, title) {
  const instance = config.getProjectInstance(projectId)
  if (!instance) return { success: false, error: 'project does not exist' }
  if (!isChatSessionEligible(instance)) {
    return { success: false, error: '当前项目不支持同项目多会话' }
  }

  const nextTitle = String(title || '').trim()
  if (!nextTitle) return { success: false, error: '标题不能为空' }

  const targetId = String(sessionId || instance.chatSessionId || '').trim()
  if (!targetId) return { success: false, error: 'sessionId 不能为空' }

  // 当前会话：直接改内存并写 meta
  if (targetId === String(instance.chatSessionId || '').trim()) {
    instance.chatSessionTitle = nextTitle
    // 仅当分支标题仍是占位/空时才同步，避免覆盖分支消息前缀标题
    if (!String(instance.branchTitle || '').trim() || instance.branchTitle === '新会话') {
      instance.branchTitle = nextTitle
      try { await writeBranchSessionMetaAsync(instance) } catch {}
    }
    await writeChatSessionMetaAsync(instance, { touchUpdatedAt: false })
    instance.chatSessions = await listChatSessions(instance)
    return {
      success: true,
      projectId: instance.projectId,
      chatSessionId: instance.chatSessionId,
      chatSessionTitle: nextTitle,
      branchTitle: instance.branchTitle || '',
      chatSessions: instance.chatSessions
    }
  }

  // 非当前会话：只改磁盘 meta，不切换会话
  const sessionsDir = getChatSessionsRoot(instance)
  const sessionPath = path.join(sessionsDir, targetId)
  const metaPath = getChatSessionMetaPath(sessionPath)
  let meta = null
  try {
    meta = JSON.parse(await fs.promises.readFile(metaPath, 'utf-8'))
  } catch {
    meta = {
      sessionId: targetId,
      title: nextTitle,
      createdAt: Date.now(),
      updatedAt: Date.now()
    }
  }
  meta.sessionId = targetId
  meta.title = nextTitle
  if (!meta.createdAt) meta.createdAt = Date.now()
  if (!meta.updatedAt) meta.updatedAt = meta.createdAt
  await taskRuns.atomicWriteJsonAsync(metaPath, meta)
  instance.chatSessions = await listChatSessions(instance)
  return {
    success: true,
    projectId: instance.projectId,
    chatSessionId: targetId,
    chatSessionTitle: nextTitle,
    chatSessions: instance.chatSessions
  }
}

async function listChatSessionsSafe(instance) {
  try {
    return await listChatSessions(instance)
  } catch (e) {
    console.warn('[Projects] listChatSessionsSafe failed:', e.message)
    return []
  }
}

async function listChatSessions(instance) {
  const sessionsDir = getChatSessionsRoot(instance)
  if (!sessionsDir) return []

  const sessions = []
  let entries = []
  try {
    entries = await fs.promises.readdir(sessionsDir, { withFileTypes: true })
  } catch {
    entries = []
  }

  await Promise.all(entries
    .filter(entry => entry.isDirectory())
    .map(async dirent => {
      const sessionPath = path.join(sessionsDir, dirent.name)
      const metaPath = getChatSessionMetaPath(sessionPath)
      let meta = null
      try {
        meta = JSON.parse(await fs.promises.readFile(metaPath, 'utf-8'))
      } catch {
        meta = null
      }
      const chatHistoryPath = path.join(sessionPath, 'chat-history.json')
      const historyStat = chatChunkStore.getStatSync(chatHistoryPath)
      const dirStat = await fs.promises.stat(sessionPath).catch(() => null)
      // 目录名优先，避免 meta.sessionId 与目录不一致时出现“同内容多条”
      const sessionId = String(dirent.name || meta?.sessionId || '').trim()
      if (!sessionId) return

      // 关键：createdAt 绝不优先用 chat-history mtime。
      // 新建会话前会保存旧会话，mtime 会变成“现在”，旧会话会被错误顶到第一。
      const createdAt = resolveChatSessionCreatedAt(sessionId, meta, dirStat)
      const updatedAt = Number(meta?.updatedAt || historyStat.mtimeMs || createdAt || Date.now())

      // meta 缺 createdAt 时回写一次，后续排序稳定
      if (!Number(meta?.createdAt || 0) || Number(meta.createdAt) !== createdAt) {
        const healed = {
          sessionId,
          title: String(meta?.title || '').trim(),
          createdAt,
          updatedAt
        }
        taskRuns.atomicWriteJsonAsync(metaPath, healed).catch(() => {})
        meta = healed
      }

      sessions.push(buildChatSessionPayload(instance, {
        sessionId,
        title: meta?.title || '',
        createdAt,
        updatedAt
      }))
    }))

  // sessionId 去重
  const deduped = []
  const seen = new Set()
  for (const item of sessions) {
    const id = String(item.sessionId || '').trim()
    if (!id || seen.has(id)) continue
    seen.add(id)
    deduped.push(item)
  }

  // 按创建时间正序：先创建的在上，后创建的在下；点击切换只改选中态，不重排
  deduped.sort((a, b) =>
    (Number(a.createdAt || 0) - Number(b.createdAt || 0)) ||
    String(a.sessionId || '').localeCompare(String(b.sessionId || ''), 'zh-Hans-CN')
  )

  // 固定主会话标记：优先 main；否则最早创建的那条。图标/排序都用这个，不靠 index 猜。
  const primaryId = deduped.find(item => item.sessionId === 'main')?.sessionId ||
    deduped[0]?.sessionId ||
    ''
  for (const item of deduped) {
    item.isPrimary = item.sessionId === primaryId
  }
  return deduped
}

async function ensureProjectChatSession(projectId, options = {}) {
  const instance = typeof projectId === 'string' ? config.getProjectInstance(projectId) : projectId
  if (!isChatSessionEligible(instance)) return instance || null

  // 先确保分支会话目录就绪，chat-session 建在项目存储下，不改代码树。
  await ensureProjectBranchSession(instance, options)

  const rootStoragePath = instance.rootStoragePath || instance.storagePath
  if (!rootStoragePath) return instance

  const sessionsDir = getChatSessionsRoot(instance)
  await fs.promises.mkdir(sessionsDir, { recursive: true })

  let sessionId = String(options.sessionId || instance.chatSessionId || '').trim()
  if (!sessionId) {
    const existing = await listChatSessions(instance)
    sessionId = existing.find(item => item.current)?.sessionId || existing[0]?.sessionId || 'main'
  }

  const sessionPath = path.join(sessionsDir, sessionId)
  const chatHistoryPath = path.join(sessionPath, 'chat-history.json')
  const sameSession =
    instance.chatSessionId === sessionId &&
    instance.chatSessionPath === sessionPath &&
    instance.chatHistoryPath === chatHistoryPath &&
    instance.contextStoragePath === sessionPath

  if (sameSession) {
    if (!Array.isArray(instance.chatSessions) || !instance.chatSessions.length) {
      instance.chatSessions = await listChatSessions(instance)
    }
    return instance
  }

  // 切到新会话前，先保存“当前会话”到它自己的路径；不要把当前历史写进目标会话。
  // 删除当前会话时必须 skipSave=true，否则会把已删会话写回磁盘。
  try {
    if (
      !options.skipSave &&
      !options.createEmpty &&
      instance.chatHistoryPath &&
      instance.chatSessionPath &&
      instance.chatSessionId
    ) {
      clearPendingChatHistorySave(instance.projectId)
      await writeChatHistory(instance.chatHistoryPath, instance.messagesHistory || [], instance)
      await writeChatSessionMetaAsync(instance, { touchUpdatedAt: false })
    }
  } catch (error) {
    console.warn('[Projects] save previous chat session failed:', error.message)
  }

  await fs.promises.mkdir(sessionPath, { recursive: true })

  // 仅首次把“默认 main”从分支历史迁移一次；
  // 禁止用 sessionId === instance.chatSessionId 再拷贝，否则每次切换/新建都会复制旧会话。
  if (sessionId === 'main' && !options.createEmpty && !options.forceEmpty) {
    if (!await chatChunkStore.exists(chatHistoryPath)) {
      const legacyPath = instance.branchSessionPath
        ? path.join(instance.branchSessionPath, 'chat-history.json')
        : (instance.rootStoragePath ? path.join(instance.rootStoragePath, 'chat-history.json') : '')
      if (legacyPath && legacyPath !== chatHistoryPath) {
        try {
          await fs.promises.access(legacyPath)
          await fs.promises.copyFile(legacyPath, chatHistoryPath)
          console.log('[Projects] migrated branch chat history to chat session: main')
        } catch {
          // ignore
        }
      }
    }
  }

  // 必须在改 instance.chatSessionId 之前记录，否则新建/切换会话会 ReferenceError
  const previousSessionId = instance.chatSessionId || ''
  instance.chatSessionId = sessionId
  instance.chatSessionPath = sessionPath

  // 读取已有 meta 的 createdAt；切换会话时不要用 Date.now() 覆盖
  let existingMetaCreatedAt = 0
  try {
    const existingMeta = JSON.parse(await fs.promises.readFile(getChatSessionMetaPath(sessionPath), 'utf-8'))
    existingMetaCreatedAt = Number(existingMeta?.createdAt || 0)
  } catch {
    existingMetaCreatedAt = 0
  }
  instance.chatSessionCreatedAt = Number(
    options.createdAt ||
    (previousSessionId === sessionId ? instance.chatSessionCreatedAt : 0) ||
    existingMetaCreatedAt ||
    parseChatSessionCreatedAt(sessionId) ||
    Date.now()
  )
  instance.contextStoragePath = sessionPath
  instance.chatHistoryPath = chatHistoryPath
  instance.contextManager = new ContextManager(sessionPath, instance.projectPath, { deferredInit: true })
  await instance.contextManager.ensureLoaded()

  const historyExists = await chatChunkStore.exists(chatHistoryPath)

  if (options.createEmpty || options.forceEmpty) {
    // 新开会话：永远空历史 + 占位标题，禁止继承旧会话 messagesHistory
    // 注意：chatSessionTitle 与 branchTitle 解耦，避免“新会话”污染分支行标题
    instance.messagesHistory = []
    instance.chatSessionTitle = String(options.title || '新会话')
    await writeChatHistory(chatHistoryPath, [], instance)
  } else if (historyExists) {
    applyHistoryPageToInstance(instance, await readLatestChatHistoryPage(instance, { pageChunks: 1, direction: 'older' }))
    const metaTitle = await readChatSessionTitleAsync(sessionPath)
    instance.chatSessionTitle = metaTitle || deriveChatTitle(instance.messagesHistory, options.title || instance.chatSessionTitle || '新会话')
  } else if (sessionId === 'main' && (instance.messagesHistory || []).length > 0) {
    // 仅默认 main 首次允许用内存历史落盘；其他 session 绝不复制
    instance.chatSessionTitle = deriveChatTitle(instance.messagesHistory, options.title || instance.chatSessionTitle || '主线会话')
    // 主线首会话：若分支标题仍空，才用会话标题回填一次
    if (!String(instance.branchTitle || '').trim()) {
      instance.branchTitle = instance.chatSessionTitle
    }
    await writeChatHistory(chatHistoryPath, instance.messagesHistory || [], instance)
  } else {
    instance.messagesHistory = []
    instance.chatSessionTitle = String(options.title || '新会话')
  }

  await writeChatSessionMetaAsync(instance, {
    touchUpdatedAt: options.createEmpty ? false : true
  })
  instance.chatSessions = await listChatSessions(instance)
  console.log('[Projects] switched chat session:', instance.projectId, previousSessionId, '->', sessionId, sessionPath)
  return instance
}

async function readChatSessionTitleAsync(sessionPath) {
  try {
    const meta = JSON.parse(await fs.promises.readFile(getChatSessionMetaPath(sessionPath), 'utf-8'))
    return String(meta?.title || '').trim()
  } catch {
    return ''
  }
}

async function bootstrapDefaultChatSessionIfNeeded(instance) {
  if (!isChatSessionEligible(instance)) return instance
  const existing = await listChatSessions(instance)
  if (existing.length > 0) {
    // 已有会话时，只绑定当前会话，绝不重新迁移/复制历史
    const currentId = instance.chatSessionId || existing.find(item => item.current)?.sessionId || existing[0].sessionId
    return ensureProjectChatSession(instance, {
      sessionId: currentId,
      skipSave: false,
      forceEmpty: false
    })
  }

  // 磁盘还没有 chat-sessions，但内存已有 chatSessionId：
  // 只把当前会话落盘，禁止再额外创建 main 副本（否则侧栏会多一条“之前的会话”）
  if (instance.chatSessionId && instance.chatSessionId !== 'main') {
    return ensureProjectChatSession(instance, {
      sessionId: instance.chatSessionId,
      forceEmpty: false,
      createdAt: Number(instance.chatSessionCreatedAt || Date.now())
    })
  }

  // 真正首次：只创建 main 一次，承接当前/分支历史
  return ensureProjectChatSession(instance, {
    sessionId: 'main',
    forceEmpty: false,
    createdAt: Date.now()
  })
}

async function createProjectChatSession(projectId, options = {}) {
  let instance = typeof projectId === 'string' ? config.getProjectInstance(projectId) : projectId
  if (!instance) return { success: false, error: 'project does not exist' }
  if (!isChatSessionEligible(instance)) {
    return { success: false, error: '当前项目不支持同项目多会话' }
  }

  // 1) 确保已有默认会话（最多创建 main 一次），不要在每次新建时复制旧会话
  instance = await bootstrapDefaultChatSessionIfNeeded(instance)
  if (!instance) return { success: false, error: 'project does not exist' }

  // 2) 把“当前会话”标题/历史落盘（仅当前路径）
  // 只保护 chatSessionTitle；branchTitle 保持分支级标题，不随“新会话”改写
  const preservedBranchTitle = String(instance.branchTitle || '').trim()
  const preservedTitle =
    String(instance.chatSessionTitle || '').trim() ||
    deriveChatTitle(instance.messagesHistory || [], preservedBranchTitle || '主线会话') ||
    preservedBranchTitle ||
    '主线会话'
  instance.chatSessionTitle = preservedTitle
  if (!preservedBranchTitle && preservedTitle) {
    instance.branchTitle = preservedTitle
  }
  try {
    if (instance.chatSessionId && instance.chatSessionPath && instance.chatHistoryPath) {
      clearPendingChatHistorySave(instance.projectId)
      await writeChatHistory(instance.chatHistoryPath, instance.messagesHistory || [], instance)
      await writeChatSessionMetaAsync(instance, { touchUpdatedAt: false })
      if (!preservedBranchTitle && instance.branchTitle) {
        await writeBranchSessionMetaAsync(instance)
      }
    }
  } catch (error) {
    console.warn('[Projects] preserve previous chat session title failed:', error.message)
  }

  // 3) 只新增一个空会话，禁止任何历史复制
  const sessionId = createChatSessionId()
  const title = String(options.title || '新会话').trim() || '新会话'
  const createdAt = Date.now()
  const branchTitleBeforeCreate = String(instance.branchTitle || preservedBranchTitle || '').trim()
  await ensureProjectChatSession(instance, {
    sessionId,
    title,
    createEmpty: true,
    forceEmpty: true,
    skipSave: true, // 上一步已保存当前会话，这里禁止再写旧历史
    createdAt
  })
  // 新建会话后恢复分支标题，防止被“新会话”覆盖
  if (branchTitleBeforeCreate) {
    instance.branchTitle = branchTitleBeforeCreate
  }

  // 4) 清理历史误生成的 main 克隆（同标题重复）
  await pruneAccidentalMainClone(instance)

  instance.chatSessions = await listChatSessions(instance)
  const historyPage = await readLatestChatHistoryPage(instance, { pageChunks: 1, direction: 'older' })
  return {
    success: true,
    projectId: instance.projectId,
    chatSessionId: instance.chatSessionId,
    chatSessionPath: instance.chatSessionPath,
    chatSessionTitle: instance.chatSessionTitle || title,
    chatSessions: instance.chatSessions,
    branchName: instance.branchName || '',
    branchKey: instance.branchKey || '',
    branchTitle: instance.branchTitle || branchTitleBeforeCreate || '',
    branchSessionPath: instance.branchSessionPath || '',
    branchSessions: await listBranchSessions(instance),
    ...toPagedHistoryResult(historyPage)
  }
}

// 删除误创建的 main 克隆：当前不在 main，且存在与 main 同标题的其他会话时，main 视为重复副本
async function pruneAccidentalMainClone(instance) {
  try {
    if (!isChatSessionEligible(instance)) return
    const sessionsDir = getChatSessionsRoot(instance)
    if (!sessionsDir) return
    const sessions = await listChatSessions(instance)
    if (sessions.length < 2) return
    const main = sessions.find(item => item.sessionId === 'main')
    if (!main) return
    if (String(instance.chatSessionId || '') === 'main') return
    const mainTitle = String(main.title || '').trim()
    if (!mainTitle) return
    const hasSameTitlePeer = sessions.some(item =>
      item.sessionId !== 'main' && String(item.title || '').trim() === mainTitle
    )
    if (!hasSameTitlePeer) return
    const mainPath = path.join(sessionsDir, 'main')
    removeManagedDirectory(mainPath, sessionsDir, 'project chat session data')
    console.log('[Projects] pruned accidental main clone for project:', instance.projectId)
  } catch (error) {
    console.warn('[Projects] pruneAccidentalMainClone failed:', error.message)
  }
}

async function switchProjectChatSession(projectId, sessionId) {
  const instance = config.getProjectInstance(projectId)
  if (!instance) return { success: false, error: 'project does not exist', messagesHistory: [] }
  const targetId = String(sessionId || '').trim()
  if (!targetId) return { success: false, error: 'sessionId 不能为空', messagesHistory: [] }

  await ensureProjectChatSession(instance, { sessionId: targetId })
  const historyPage = await readLatestChatHistoryPage(instance, { pageChunks: 1, direction: 'older' })
  return {
    success: true,
    projectId: instance.projectId,
    chatSessionId: instance.chatSessionId,
    chatSessionPath: instance.chatSessionPath,
    chatSessionTitle: instance.chatSessionTitle || deriveChatTitle(historyPage.messages, '新会话'),
    chatSessions: instance.chatSessions || await listChatSessions(instance),
    branchName: instance.branchName || '',
    branchKey: instance.branchKey || '',
    branchTitle: instance.branchTitle || '',
    branchSessionPath: instance.branchSessionPath || '',
    branchSessions: await listBranchSessions(instance),
    ...toPagedHistoryResult(historyPage)
  }
}

async function deleteProjectChatSession(projectId, sessionId) {
  const instance = config.getProjectInstance(projectId)
  if (!instance) return { success: false, error: 'project does not exist' }
  if (!isChatSessionEligible(instance)) return { success: false, error: '当前项目不支持同项目多会话' }

  const targetId = String(sessionId || '').trim()
  if (!targetId) return { success: false, error: 'sessionId 不能为空' }

  const sessionsDir = getChatSessionsRoot(instance)
  if (!sessionsDir) return { success: false, error: '会话目录不存在' }

  // 删当前会话前，先挑一个可切过去的会话（按创建时间正序）
  const deletingCurrent = targetId === String(instance.chatSessionId || '').trim()
  let fallbackSessionId = ''
  if (deletingCurrent) {
    const beforeSessions = await listChatSessions(instance)
    const candidates = beforeSessions
      .filter(item => item?.sessionId && item.sessionId !== targetId)
      .sort((a, b) =>
        (Number(a.createdAt || 0) - Number(b.createdAt || 0)) ||
        String(a.sessionId || '').localeCompare(String(b.sessionId || ''), 'zh-Hans-CN')
      )
    fallbackSessionId = candidates[0]?.sessionId || ''
    if (!fallbackSessionId) {
      return { success: false, error: '至少保留一个会话，不能删除最后一个会话' }
    }
  }

  // 关键：删会话前先取消该路径的异步写盘，避免 mkdir 写回已删目录。
  // 删当前会话时，还必须先切断实例对目标路径的引用，再删目录。
  const targetPath = path.join(sessionsDir, targetId)
  await chatChunkStore.prepareStorageDeletion(targetPath)
  clearPendingChatHistorySave(instance.projectId)
  cancelChatHistoryWritesForSessionPath(targetPath)

  if (deletingCurrent) {
    // 先把 chatHistoryPath 指到空，阻断任何残留写回
    instance.chatHistoryPath = ''
    instance.chatSessionPath = ''
    instance.chatSessionId = ''
    instance.messagesHistory = []
    instance._chatHistoryDirty = false

    // 先切到 fallback，再删目标目录；且 skipSave，禁止保存被删会话
    await ensureProjectChatSession(instance, {
      sessionId: fallbackSessionId,
      forceEmpty: false,
      skipSave: true
    })
    // 切走后再次取消，防止 ensure 过程中又排队写回旧路径
    cancelChatHistoryWritesForSessionPath(targetPath)
  }

  const deleted = await removeManagedDirectoryAsync(targetPath, sessionsDir, 'project chat session data')
  // 删除后再取消一次：挡住“删除瞬间刚完成 serialize、马上 rename 落盘”的竞态
  cancelChatHistoryWritesForSessionPath(targetPath)

  instance.chatSessions = await listChatSessions(instance)
  // 再保险：列表里不应再出现刚删的 sessionId
  instance.chatSessions = (instance.chatSessions || []).filter(item => item?.sessionId !== targetId)

  // 若磁盘仍存在目标目录，视为删除失败，不要假装成功
  let stillExists = false
  try {
    await fs.promises.access(targetPath)
    stillExists = true
  } catch {
    stillExists = false
  }
  if (stillExists) {
    return {
      success: false,
      error: '会话目录删除失败，请重试',
      projectId: instance.projectId,
      sessionId: targetId,
      deleted: false,
      switched: deletingCurrent,
      chatSessionId: instance.chatSessionId || '',
      chatSessions: instance.chatSessions
    }
  }

  const historyPage = deletingCurrent
    ? await readLatestChatHistoryPage(instance, { pageChunks: 1, direction: 'older' })
    : null
  return {
    success: true,
    projectId: instance.projectId,
    sessionId: targetId,
    deleted: true,
    switched: deletingCurrent,
    chatSessionId: instance.chatSessionId || '',
    chatSessionPath: instance.chatSessionPath || '',
    chatSessionTitle: instance.chatSessionTitle || '',
    chatSessions: instance.chatSessions,
    branchName: instance.branchName || '',
    branchKey: instance.branchKey || '',
    branchTitle: instance.branchTitle || instance.chatSessionTitle || '',
    branchSessionPath: instance.branchSessionPath || '',
    ...(historyPage
      ? toPagedHistoryResult(historyPage)
      : { messages: [], messagesHistory: [], nextCursor: null, hasMore: false, range: null, paged: false })
  }
}

async function ensureProjectBranchSession(projectId, options = {}) {
  const instance = typeof projectId === 'string' ? config.getProjectInstance(projectId) : projectId
  if (!isBranchSessionEligible(instance)) return instance || null
  // chat-session 已经接管时，不再把 chatHistoryPath 改回分支路径，
  // 否则会覆盖同项目多会话刚切换好的 chat-session 路径，导致 get-chat-history 读回旧分支历史。
  if (!options.forceBranch && instance.chatSessionPath && instance.chatSessionId) {
    return instance
  }

  const branchName = await resolveBranchNameForSessionAsync(instance)
  const branchKey = getBranchKey(branchName)
  const rootStoragePath = instance.rootStoragePath || instance.storagePath
  const branchStoragePath = path.join(rootStoragePath, 'branch-sessions', branchKey)
  const chatHistoryPath = path.join(branchStoragePath, 'chat-history.json')

  if (
    instance.branchKey === branchKey &&
    instance.chatHistoryPath === chatHistoryPath &&
    instance.contextStoragePath === branchStoragePath
  ) {
    return instance
  }

  try {
    if (!options.skipSave && instance.chatHistoryPath) {
      clearPendingChatHistorySave(instance.projectId)
      await writeChatHistory(instance.chatHistoryPath, instance.messagesHistory || [], instance)
    }
  } catch (e) {
    console.warn('[Projects] save old branch chat history before switch failed:', e.message)
  }

  await fs.promises.mkdir(branchStoragePath, { recursive: true })
  const legacyChatHistoryPath = path.join(rootStoragePath, 'chat-history.json')
  const mainBranchName = await getMainBranchName(instance.projectPath)
  const shouldMigrateLegacyHistory = !mainBranchName || branchName === mainBranchName
  if (shouldMigrateLegacyHistory) {
    if (!await chatChunkStore.exists(chatHistoryPath)) {
      try {
        await fs.promises.access(legacyChatHistoryPath)
        await fs.promises.copyFile(legacyChatHistoryPath, chatHistoryPath)
        console.log('[Projects] migrated legacy chat history to branch session:', branchName)
      } catch {
        // legacy file doesn't exist or copy failed, skip
      }
    }
  }
  instance.rootStoragePath = rootStoragePath
  instance.branchName = branchName
  instance.branchKey = branchKey
  instance.branchSessionPath = branchStoragePath
  instance.contextStoragePath = branchStoragePath
  instance.chatHistoryPath = chatHistoryPath
  instance.contextManager = new ContextManager(branchStoragePath, instance.projectPath, { deferredInit: true })
  await instance.contextManager.ensureLoaded()
  // 保护已有历史：如果新路径没有历史文件但内存中有历史（从旧路径读取或迁移而来），
  // 保留内存历史并写入新路径，避免分支切换时历史被空数组覆盖
  // forceBranch + skipSave 模式：调用方已经准备好 instance.messagesHistory，不要再用磁盘覆盖
  const existingHistory = instance.messagesHistory || []
  const branchHistoryExists = await chatChunkStore.exists(chatHistoryPath)
  if (options.forceBranch && options.skipSave && !options.loadFromDisk) {
    // 调用方已经控制 messagesHistory，不在这里重新读盘
  } else if (!branchHistoryExists && existingHistory.length > 0) {
    instance.messagesHistory = existingHistory
    try {
      await writeChatHistory(chatHistoryPath, existingHistory, instance)
      console.log('[Projects] preserved existing history on branch switch:', instance.projectId, branchName, existingHistory.length, 'messages')
    } catch (e) {
      console.warn('[Projects] preserve history on branch switch failed:', e.message)
    }
  } else {
    applyHistoryPageToInstance(instance, await readLatestChatHistoryPage(instance, { pageChunks: 1, direction: 'older' }))
  }
  // 优先保留 branch-session.json 中的自定义标题（例如消息前缀标题）
  // forceBranch 时若调用方已设置 branchTitle，不要用磁盘旧标题覆盖
  let savedBranchTitle = ''
  try {
    const metaRaw = await fs.promises.readFile(getBranchSessionMetaPath(branchStoragePath), 'utf8')
    const meta = JSON.parse(metaRaw)
    savedBranchTitle = String(meta?.title || '').trim()
  } catch {}
  if (!(options.forceBranch && String(instance.branchTitle || '').trim())) {
    instance.branchTitle = savedBranchTitle || deriveChatTitle(instance.messagesHistory, '')
  }
  await writeBranchSessionMetaAsync(instance)

  const summaries = await contextCompression.loadSummaries(instance)
  if (summaries.length > 0) {
    for (const summaryRecord of summaries) {
      instance.messagesHistory = contextCompression.ensureDividerInHistory(instance.messagesHistory, summaryRecord)
    }
  }

  console.log('[Projects] switched branch session:', instance.projectId, branchName, branchStoragePath)
  return instance
}

/**
 * Resolve the WebContents that should receive events for a project id.
 */
function getWebContentsForProject(projectId) {
  const mainWindow = config.getMainWindow()
  return mainWindow?.webContents
}

/**
 * Create or reuse a project instance.
 */
async function createProjectInstance(projectPath, options = {}) {
  const projectId = options.projectId || generateProjectId(projectPath)
  const projectInstances = config.getProjectInstances()

  // Reuse the in-memory instance when it already exists.
  if (projectInstances.has(projectId)) {
    const instance = projectInstances.get(projectId)
    if (projectPath && instance.projectPath !== projectPath) {
      instance.projectPath = projectPath
      if (instance.contextManager) instance.contextManager.projectPath = projectPath
    }
    if (Object.prototype.hasOwnProperty.call(options, 'stateless')) instance.stateless = !!options.stateless
    if (Object.prototype.hasOwnProperty.call(options, 'workspaceOrigin')) instance.workspaceOrigin = options.workspaceOrigin || ''
    await ensureProjectBranchSession(instance)
    return { projectId, instance, existing: true }
  }

  const storagePath = options.storagePath
    ? assertProjectStoragePath(options.storagePath)
    : getProjectStoragePath(projectPath, options.projectId || '')
  const contextManager = new ContextManager(storagePath, projectPath, { deferredInit: true })

  // 先用根路径创建基本 instance，由 ensureProjectBranchSession 确定最终分支路径
  const chatHistoryPath = path.join(storagePath, 'chat-history.json')

  const instance = {
    projectId,
    contextManager,
    projectPath,
    storagePath,
    rootStoragePath: storagePath,
    branchName: '',
    branchKey: '',
    branchTitle: '',
    branchSessionPath: '',
    contextStoragePath: storagePath,
    chatHistoryPath,
    messagesHistory: [],
    autoExecSteps: [],
    autoExecStepIndex: 0,
    stateless: !!options.stateless,
    workspaceOrigin: options.workspaceOrigin || ''
  }

  config.setProjectInstance(projectId, instance)
  // ensureProjectBranchSession 会设置正确的分支路径并加载分支历史
  await ensureProjectBranchSession(instance, { skipSave: true })

  // 无项目会话不进入 Git 分支会话逻辑，历史直接保存在根存储目录。
  if (!isBranchSessionEligible(instance)) {
    if (chatChunkStore.existsSync(instance.chatHistoryPath)) {
      applyHistoryPageToInstance(instance, await readLatestChatHistoryPage(instance, { pageChunks: 1, direction: 'older' }))
      instance.branchTitle = deriveChatTitle(instance.messagesHistory, instance.branchTitle || '')
    }
    instance._standaloneHistoryLoaded = true
  }

  // ensureProjectBranchSession 已从最终分支路径加载历史，避免再次读取完整文件
  if (instance.messagesHistory.length > 0) {
    console.log('[Projects] loaded chat history from branch:', instance.messagesHistory.length, 'messages')
  }

  const summaries = await contextCompression.loadSummaries(instance)
  if (summaries.length > 0) {
    for (const summaryRecord of summaries) {
      instance.messagesHistory = contextCompression.ensureDividerInHistory(instance.messagesHistory, summaryRecord)
    }
  }

  taskRuns.markStaleRunningRuns(projectId)
  taskRuns.cleanupOldRunsDeferred(projectId)
  console.log('[Projects] created project instance:', projectId, 'path:', projectPath, 'storage:', storagePath)

  return { projectId, instance, existing: false }
}

async function createCollaborationChatInstance(parentProjectId, sessionId, agent = {}, userProjectPath = '') {
  const projectInstances = config.getProjectInstances()
  const safeSessionId = String(sessionId || 'session').replace(/[^a-zA-Z0-9_-]+/g, '_')
  const safeAgentId = String(agent.id || agent.name || 'agent').replace(/[^a-zA-Z0-9_-]+/g, '_')
  const parent = parentProjectId ? await ensureProjectBranchSession(parentProjectId) : null
  const branchKey = parent?.branchKey || getBranchKey(await getCurrentBranchName(parent?.projectPath || userProjectPath))
  const safeBranchKey = String(branchKey || 'workspace').replace(/[^a-zA-Z0-9_-]+/g, '_')
  const projectId = `collab-chat-${safeBranchKey}-${safeSessionId}-${safeAgentId}`

  if (projectInstances.has(projectId)) {
    return { success: true, projectId, instance: projectInstances.get(projectId), existing: true }
  }

  const actualProjectPath = userProjectPath || parent?.projectPath || ''
  const baseStoragePath = parent?.branchSessionPath || parent?.storagePath || path.join(storageConfig.getProjectsDir(), 'collaboration-chats')
  const storagePath = path.join(baseStoragePath, 'collaboration-chats', safeSessionId, safeAgentId)
  await fs.promises.mkdir(storagePath, { recursive: true })

  const contextManager = new ContextManager(storagePath, actualProjectPath, { deferredInit: true })
  await contextManager.ensureLoaded()
  const chatHistoryPath = path.join(storagePath, 'chat-history.json')
  const messagesHistory = []

  const instance = {
    projectId,
    parentProjectId,
    parentBranchKey: branchKey,
    parentBranchName: parent?.branchName || '',
    collaborationSessionId: sessionId,
    collaborationAgentId: agent.id || '',
    collaborationAgentName: agent.name || agent.role || '',
    contextManager,
    projectPath: actualProjectPath,
    storagePath,
    chatHistoryPath,
    messagesHistory,
    autoExecSteps: [],
    autoExecStepIndex: 0,
    isCollaborationChat: true
  }

  applyHistoryPageToInstance(instance, await readLatestChatHistoryPage(instance, { pageChunks: 1, direction: 'older' }))

  projectInstances.set(projectId, instance)
  taskRuns.markStaleRunningRuns(projectId)
  taskRuns.cleanupOldRunsDeferred(projectId)
  console.log('[Projects] created collaboration chat instance:', projectId, 'parent:', parentProjectId)
  return { success: true, projectId, instance, existing: false }
}

async function createTemporaryAgentChatInstance(parentProjectId, sessionId, agent = {}, userProjectPath = '') {
  const projectInstances = config.getProjectInstances()
  const safeSessionId = String(sessionId || 'session').replace(/[^a-zA-Z0-9_-]+/g, '_')
  const safeAgentId = String(agent.id || agent.name || 'agent').replace(/[^a-zA-Z0-9_-]+/g, '_')
  const parent = parentProjectId ? await ensureProjectBranchSession(parentProjectId) : null
  const branchKey = parent?.branchKey || getBranchKey(await getCurrentBranchName(parent?.projectPath || userProjectPath))
  const safeBranchKey = String(branchKey || 'workspace').replace(/[^a-zA-Z0-9_-]+/g, '_')
  const projectId = `temp-agent-chat-${safeBranchKey}-${safeSessionId}-${safeAgentId}`

  if (projectInstances.has(projectId)) {
    return { success: true, projectId, instance: projectInstances.get(projectId), existing: true }
  }

  const actualProjectPath = userProjectPath || parent?.projectPath || ''
  const baseStoragePath = parent?.branchSessionPath || parent?.storagePath || path.join(storageConfig.getProjectsDir(), 'temporary-agent-chats')
  const storagePath = path.join(baseStoragePath, 'temporary-agent-chats', safeSessionId, safeAgentId)
  await fs.promises.mkdir(storagePath, { recursive: true })

  const sessionForReport = { id: `${safeBranchKey}-${sessionId}`, projectId: parentProjectId, branchKey, branchName: parent?.branchName || '' }
  const reportDir = agentCollaborationReports.ensureReportsDir(sessionForReport)
  const reportFilePath = agentCollaborationReports.getAgentReportFilePath(sessionForReport, agent)

  const instance = {
    projectId,
    parentProjectId,
    parentBranchKey: branchKey,
    parentBranchName: parent?.branchName || '',
    collaborationSessionId: sessionId,
    collaborationAgentId: agent.id || '',
    collaborationAgentName: agent.name || agent.role || '',
    contextManager: new ContextManager(storagePath, actualProjectPath, { deferredInit: true }),
    projectPath: actualProjectPath,
    storagePath,
    chatHistoryPath: null,
    messagesHistory: [],
    autoExecSteps: [],
    autoExecStepIndex: 0,
    isTemporaryAgentChat: true,
    isCollaborationChat: true,
    collaborationReportDir: reportDir,
    collaborationReportFilePath: reportFilePath
  }

  await instance.contextManager.ensureLoaded()
  projectInstances.set(projectId, instance)
  taskRuns.markStaleRunningRuns(projectId)
  taskRuns.cleanupOldRunsDeferred(projectId)
  console.log('[Projects] created temporary agent chat instance:', projectId, 'parent:', parentProjectId)
  return { success: true, projectId, instance, reportDir, reportFilePath, existing: false }
}

function releaseCollaborationChatInstances(sessionId) {
  const releases = []
  for (const [projectId, instance] of config.getProjectInstances().entries()) {
    if (!instance?.isCollaborationChat || String(instance.collaborationSessionId || '') !== String(sessionId || '')) continue
    try { config.getAbortController(projectId)?.abort?.(new Error('collaboration session completed')) } catch {}
    config.deleteAbortController(projectId)
    clearPendingChatHistorySave(projectId)
    config.deleteProjectInstance(projectId)
    releases.push(Promise.allSettled([
      instance.contextManager?.memory?.flush?.(),
      instance.contextManager?.summary?._flushSave?.()
    ].filter(Boolean)))
  }
  return Promise.allSettled(releases).then(() => ({ released: releases.length }))
}

function compactRuntimeHistoryCache(messagesHistory = [], options = {}) {
  if (!Array.isArray(messagesHistory)) return []
  const maxRounds = Math.max(1, Number(options.maxRounds) || RUNTIME_HISTORY_MAX_ROUNDS)
  const groups = chatMessageIdentity.groupByRound(messagesHistory)
  if (groups.length <= maxRounds) return messagesHistory
  const removedRounds = groups.length - maxRounds
  const retained = groups.slice(-maxRounds).flatMap(group => group.messages)
  messagesHistory.splice(0, messagesHistory.length, ...retained)
  if (options.instance) {
    options.instance._runtimeHistoryStartTurn = Math.max(
      1,
      Number(options.instance._runtimeHistoryStartTurn || 1) + removedRounds
    )
  }
  return messagesHistory
}

/**
 * Save project chat history.
 */
function resolveChatHistorySaveTarget(projectOrInstance) {
  const instance = projectOrInstance && typeof projectOrInstance === 'object'
    ? projectOrInstance
    : config.getProjectInstance(projectOrInstance)
  const projectId = String(instance?.projectId || projectOrInstance || '')
  const saveKey = projectOrInstance && typeof projectOrInstance === 'object'
    ? `session:${String(instance?.chatHistoryPath || `${projectId}:${instance?.chatSessionId || 'main'}`)}`
    : projectId
  return { instance, projectId, saveKey }
}

async function saveProjectChatHistory(projectOrInstance) {
  const { instance, projectId, saveKey } = resolveChatHistorySaveTarget(projectOrInstance)
  if (!instance || !instance.chatHistoryPath) return Promise.resolve()

  try {
    clearPendingChatHistorySave(saveKey)
    const writePromise = writeChatHistory(instance.chatHistoryPath, instance.messagesHistory, instance)
    instance.branchTitle = deriveChatTitle(instance.messagesHistory, instance.branchTitle || '')
    await writeBranchSessionMetaAsync(instance)
    if (instance.stateless) upsertStatelessSession(instance, { updatedAt: Date.now() })
    console.log('[Projects] saved chat history:', projectId, instance.messagesHistory.length, 'messages')
    await writePromise
    if (
      !instance._chatHistoryDirty &&
      Number(instance._activeChatRequestCount || 0) === 0 &&
      Array.isArray(instance.messagesHistory)
    ) {
      instance.messagesHistory = compactRuntimeHistoryCache(instance.messagesHistory, { instance })
    }
  } catch (e) {
    console.error('[Projects] save chat history failed:', e.message)
  }
}

function clearPendingChatHistorySave(projectId) {
  const pending = pendingChatHistorySaves.get(projectId)
  if (!pending) return false
  clearTimeout(pending.timer)
  pendingChatHistorySaves.delete(projectId)
  return true
}

function saveProjectChatHistoryDeferred(projectOrInstance, delayMs = 120) {
  const { instance, saveKey } = resolveChatHistorySaveTarget(projectOrInstance)
  if (!instance || !instance.chatHistoryPath) return
  // 脏标记：没有变化不写入
  if (!instance._chatHistoryDirty) return
  if (pendingChatHistorySaves.has(saveKey)) return
  const timer = setTimeout(() => {
    pendingChatHistorySaves.delete(saveKey)
    saveProjectChatHistory(instance)
  }, Math.max(20, Math.min(Number(delayMs) || 120, 1000)))
  pendingChatHistorySaves.set(saveKey, { timer, target: instance })
}

/**
 * Build delete ranges from selected messages.
 */
function getDeleteRangesForSelections(history, selections) {
  const ranges = []
  const selectedTurns = new Map()

  for (const item of Array.isArray(selections) ? selections : []) {
    const historyStart = Number(item?.historyStart)
    const historyEnd = Number(item?.historyEnd)
    if (
      Number.isInteger(historyStart) &&
      Number.isInteger(historyEnd) &&
      historyStart >= 0 &&
      historyEnd > historyStart &&
      historyStart < history.length
    ) {
      ranges.push({
        start: historyStart,
        end: Math.min(historyEnd, history.length),
        turnId: Number(item?.turnId) || null,
        part: item?.part === 'assistant' ? 'assistant' : 'user'
      })
      continue
    }

    const turnId = Number(item?.turnId)
    const part = item?.part === 'assistant' ? 'assistant' : 'user'
    if (!Number.isInteger(turnId) || turnId < 1) continue
    const current = selectedTurns.get(turnId) || { user: false, assistant: false }
    current[part] = true
    selectedTurns.set(turnId, current)
  }

  if (selectedTurns.size === 0) return ranges

  let visibleTurnId = 0
  for (let i = 0; i < history.length; i++) {
    const msg = history[i]
    if (msg.role !== 'user' || msg.hidden) continue

    visibleTurnId++
    const selection = selectedTurns.get(visibleTurnId)
    if (!selection) continue

    let end = i + 1
    while (end < history.length) {
      const next = history[end]
      if (next.role === 'user' && !next.hidden) break
      end++
    }

    if (selection.user) {
      ranges.push({ start: i, end, turnId: visibleTurnId, part: 'user' })
    } else if (selection.assistant && end > i + 1) {
      ranges.push({ start: i + 1, end, turnId: visibleTurnId, part: 'assistant' })
    }
  }

  return mergeDeleteRanges(ranges)
}

function mergeDeleteRanges(ranges) {
  const normalized = ranges
    .filter(range => Number.isInteger(range.start) && Number.isInteger(range.end) && range.end > range.start)
    .sort((a, b) => a.start - b.start || a.end - b.end)
  const merged = []
  for (const range of normalized) {
    const last = merged[merged.length - 1]
    if (last && range.start <= last.end) {
      last.end = Math.max(last.end, range.end)
      last.part = last.part === range.part ? last.part : 'mixed'
      continue
    }
    merged.push({ ...range })
  }
  return merged
}

function filterHistoryByRanges(history, ranges) {
  if (!Array.isArray(history) || !Array.isArray(ranges) || ranges.length === 0) {
    return Array.isArray(history) ? history.slice() : []
  }

  // 合并区间后用双指针一次遍历，避免 O(n × m) 嵌套比较
  const sorted = ranges
    .map(r => ({ start: r.start, end: r.end }))
    .sort((a, b) => a.start - b.start)
  const merged = []
  for (const r of sorted) {
    const last = merged[merged.length - 1]
    if (last && r.start <= last.end) {
      last.end = Math.max(last.end, r.end)
    } else {
      merged.push({ start: r.start, end: r.end })
    }
  }
  const result = []
  let ri = 0
  for (let i = 0; i < history.length; i++) {
    while (ri < merged.length && merged[ri].end <= i) ri++
    if (ri < merged.length && i >= merged[ri].start) continue
    result.push(history[i])
  }
  return result
}

async function rebuildContextFromHistory(instance, options = {}) {
  if (!instance?.contextManager) return

  const deleteMemory = !!options.deleteMemory
  if (deleteMemory) {
    instance.contextManager.clearAll?.()
  } else {
    instance.contextManager.clearContext?.()
  }

  let currentUser = null
  let aiContent = ''
  let modelName = 'AI'
  let toolCalls = []
  let pendingToolCalls = new Map()
  let turnCounter = 0

  const flushTurn = () => {
    if (!currentUser || !aiContent) return
    if (deleteMemory) {
      instance.contextManager.recordTurn(currentUser.content || '', aiContent, modelName, toolCalls)
    }
  }

  for (const msg of instance.messagesHistory || []) {
    if (msg.role === 'user' && !msg.hidden) {
      flushTurn()
      currentUser = msg
      aiContent = ''
      modelName = 'AI'
      toolCalls = []
      pendingToolCalls = new Map()
      turnCounter++
      // 每 3 轮 yield 一次，避免长时间阻塞主进程事件循环
      if (turnCounter % 3 === 0) {
        await new Promise(r => setImmediate(r))
      }
      continue
    }

    if (!currentUser) continue

    if (msg.role === 'assistant') {
      if (msg.modelName) modelName = msg.modelName
      if (Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0) {
        for (const tc of msg.tool_calls) {
          let args = {}
          try {
            args = JSON.parse(tc.function?.arguments || '{}')
          } catch (error) {
            args = {}
          }
          pendingToolCalls.set(tc.id, { tool_call_id: tc.id, name: tc.function?.name || '', args, result: null })
        }
      } else if (msg.content) {
        aiContent = msg.content
      }
    } else if (msg.role === 'tool') {
      const record = pendingToolCalls.get(msg.tool_call_id)
      if (!record) continue
      try {
        record.result = JSON.parse(msg.content || '{}')
      } catch (error) {
        record.result = { text: msg.content || '' }
      }
      toolCalls.push(record)
      pendingToolCalls.delete(msg.tool_call_id)
    }
  }

  flushTurn()

  // 重建结束后统一 flush 保存，避免逐轮写入
  try {
    await instance.contextManager.memory?.flush?.()
    await instance.contextManager.summary?._flushSave?.()
  } catch (e) {
    console.error('[Projects] flush after rebuild failed:', e.message)
  }
}

async function rebuildCompressionSummariesFromHistory(instance) {
  if (!instance) return []
  const budget = buildContextBudget(instance.currentModelName || '')
  return await contextCompression.rebuildSummariesFromHistory(instance, instance.messagesHistory || [], {
    triggerTokens: Math.floor(budget.inputBudgetTokens * 0.75),
    retainTokens: Math.floor(budget.inputBudgetTokens * 0.35)
  })
}

async function deleteProjectMessages(projectId, selections, options = {}) {
  const instance = await ensureProjectBranchSession(projectId)
  if (!instance) {
    return { success: false, error: 'project does not exist' }
  }

  const history = Array.isArray(instance.messagesHistory) ? instance.messagesHistory : []
  const selectedMessageIds = new Set(
    (Array.isArray(selections) ? selections : [])
      .flatMap(selection => Array.isArray(selection?.messageIds) ? selection.messageIds : [])
      .map(value => String(value || '').trim())
      .filter(Boolean)
  )
  const legacySelections = (Array.isArray(selections) ? selections : [])
    .filter(selection => !Array.isArray(selection?.messageIds) || selection.messageIds.length === 0)
  const ranges = getDeleteRangesForSelections(history, legacySelections)
  if (ranges.length === 0 && selectedMessageIds.size === 0) {
    return { success: false, error: 'no messages to delete' }
  }

  const beforeCount = history.length
  const deleteMemory = !!options.deleteMemory
  const deletedMessageIds = [...selectedMessageIds]
  for (const range of ranges) {
    for (const message of history.slice(range.start, range.end)) {
      if (message?.messageId) deletedMessageIds.push(message.messageId)
    }
  }
  if (deletedMessageIds.length && instance.chatHistoryPath) {
    await chatChunkStore.deleteMessages(instance.chatHistoryPath, deletedMessageIds)
  }
  instance.messagesHistory = filterHistoryByRanges(history, ranges)
    .filter(message => !selectedMessageIds.has(message?.messageId))
  instance._chatHistoryDirty = true
  saveProjectChatHistoryDeferred(projectId)

  // 异步重建上下文和压缩摘要，不阻塞前端
  setImmediate(async () => {
    try {
      await rebuildContextFromHistory(instance, { deleteMemory })
      await rebuildCompressionSummariesFromHistory(instance)
      console.log('[Projects] 异步重建上下文完成')
    } catch (e) {
      console.error('[Projects] 异步重建上下文失败:', e)
    }
  })

  await saveProjectChatHistory(projectId)
  const latestPage = await readLatestChatHistoryPage(instance, { pageChunks: 1, direction: 'older' })
  applyHistoryPageToInstance(instance, latestPage)

  return {
    success: true,
    deletedCount: Math.max(beforeCount - instance.messagesHistory.length, selectedMessageIds.size),
    memoryDeleted: deleteMemory,
    deletedTurns: ranges.map(range => ({ turnId: range.turnId, part: range.part })),
    ...toPagedHistoryResult(latestPage)
  }
}

function getProjectInstance(projectId) {
  return config.getProjectInstance(projectId) || null
}

/**
 * Get all active projects for IPC.
 */
async function getAllProjectsForIPC(options = {}) {
  const includeHistory = !!options.includeHistory
  const projects = []
  const projectInstances = config.getProjectInstances()
  for (const [projectId, instance] of projectInstances) {
    await ensureProjectBranchSession(instance)
    if (pendingChatHistorySaves.has(projectId)) {
      await saveProjectChatHistory(projectId)
    }
    projects.push({
      id: projectId,
      path: instance.projectPath,
      storagePath: instance.storagePath,
      rootStoragePath: instance.rootStoragePath || instance.storagePath,
      branchName: instance.branchName || '',
      branchKey: instance.branchKey || '',
      branchTitle: instance.branchTitle || deriveChatTitle(instance.messagesHistory || [], ''),
      branchSessionPath: instance.branchSessionPath || '',
      branchSessions: await listBranchSessions(instance),
      chatSessionId: (() => { try { return isChatSessionEligible(instance) ? (instance.chatSessionId || '') : '' } catch { return '' } })(),
      chatSessionTitle: (() => { try { return isChatSessionEligible(instance) ? (instance.chatSessionTitle || '') : '' } catch { return '' } })(),
      chatSessions: await listChatSessionsSafe(instance),
      status: instance.contextManager.getStatus(),
      historyLength: Array.isArray(instance.messagesHistory) ? instance.messagesHistory.length : 0,
      stateless: !!instance.stateless,
      workspaceOrigin: instance.workspaceOrigin || '',
      messagesHistory: includeHistory ? instance.messagesHistory : undefined
    })
  }
  console.log('[Projects] getAllProjects:', projects.length, 'projects')
  return projects
}

/**
 * Delete a project.
 */
async function deleteProject(projectId, mode = 'light') {
  console.log('[Projects] deleting project, projectId:', projectId, 'mode:', mode)

  const instance = config.getProjectInstance(projectId)
  if (!instance) {
    console.log('[Projects] project already deleted:', projectId)
    config.deleteAbortController(projectId)
    return {
      success: true,
      projectId,
      mode,
      alreadyDeleted: true,
      deletedProjectData: true,
      deletedProjectFolder: false,
      message: '项目已不存在，已清理当前会话中的残留状态。'
    }
  }

  const { storagePath, chatHistoryPath, projectPath } = instance
  console.log('[Projects] project paths:', { storagePath, chatHistoryPath, projectPath })

  try {
    let trashedProject = null
    config.getAbortController(projectId)?.abort()
    config.deleteAbortController(projectId)
    clearProjectRuntimeData(instance, projectId)

    if (storagePath && fs.existsSync(storagePath)) {
      const safeStoragePath = assertProjectStoragePath(storagePath)
      await chatChunkStore.prepareStorageDeletion(safeStoragePath)
      fs.rmSync(safeStoragePath, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
      console.log('[Projects] deleted managed project data:', safeStoragePath)
    }
    // Full delete also moves the user project folder to trash.
    if (mode === 'full' && projectPath && fs.existsSync(projectPath)) {
      // Move the original project directory instead of deleting it directly.
      trashedProject = await moveProjectToTrash(projectPath)
      console.log('[Projects] moved project folder to trash:', projectPath)
    }

    // Remove the in-memory instance after files are handled.
    config.deleteProjectInstance(projectId)
    console.log('[Projects] removed project instance:', projectId)

    return {
      success: true,
      projectPath,
      mode,
      storagePath,
      deletedProjectData: true,
      deletedProjectFolder: mode === 'full',
      trashPath: trashedProject?.trashPath || null,
      systemTrash: !!trashedProject?.systemTrash
    }
  } catch (e) {
    console.error('[Projects] delete project failed:', e.message)
    return { error: e.message }
  }
}

/**
 * Remove project list entries that point to a project path.
 */
async function deleteProjectCoordinated(projectId, mode = 'light') {
  console.log('[Projects] delete request, projectId:', projectId, 'mode:', mode)

  if (!projectId) {
    return { success: false, error: 'Missing projectId' }
  }

  const instance = config.getProjectInstance(projectId)
  const deleteTarget = buildDeleteTarget(projectId, instance)
  const alreadyDeleted = !instance

  if (!instance) {
    console.log('[Projects] project instance missing, cleaning saved data by project list:', projectId)
  }

  const { storagePath, chatHistoryPath, projectPath } = deleteTarget
  console.log('[Projects] delete target paths:', { storagePath, chatHistoryPath, projectPath })

  try {
    config.getAbortController(projectId)?.abort()
    config.deleteAbortController(projectId)
    if (instance) clearProjectRuntimeData(instance, projectId)

    if (storagePath && fs.existsSync(storagePath)) {
      await chatChunkStore.prepareStorageDeletion(assertProjectStoragePath(storagePath))
    }
    const managedData = deleteProjectManagedData(deleteTarget)
    let trashedProject = null

    if (mode === 'full' && projectPath && fs.existsSync(projectPath)) {
      trashedProject = await moveProjectToTrash(projectPath)
      console.log('[Projects] moved user project folder:', projectPath)
    }

    const listCleanup = removeProjectListEntries(projectId, projectPath)
    if (!listCleanup.saveResult?.success) {
      throw new Error(listCleanup.saveResult?.error || 'Failed to update saved project list')
    }

    config.deleteProjectInstance(projectId)
    console.log('[Projects] removed project instance:', projectId)

    return {
      success: true,
      projectId,
      projectPath,
      mode,
      storagePath,
      alreadyDeleted,
      deletedProjectData: managedData.deletedProjectData,
      deletedLedgerData: managedData.deletedLedgerData,
      deletedArtifactData: managedData.deletedArtifactData,
      deletedProjectFolder: !!trashedProject?.moved,
      trashPath: trashedProject?.trashPath || null,
      systemTrash: !!trashedProject?.systemTrash,
      removedProjectListEntries: listCleanup.removedCount,
      removedProjectListIds: listCleanup.removedIds,
      removedProjectListPaths: listCleanup.removedPaths,
      cleanup: managedData
    }
  } catch (e) {
    console.error('[Projects] delete project failed:', e.message)
    return { success: false, error: e.message }
  }
}

async function setProjectPath(projectId, newPath) {
  // Generate a project id when callers only provide a path.
  if (!projectId) {
    projectId = generateProjectId(newPath)
  }

  if (!newPath) {
    return { error: 'path is empty' }
  }

  // Create the target directory when it does not exist.
  if (!fs.existsSync(newPath)) {
    try {
      fs.mkdirSync(newPath, { recursive: true })
    } catch (e) {
      return { error: '创建项目目录失败: ' + e.message }
    }
  }

  // Create or reuse the project instance.
  const result = await createProjectInstance(newPath)

  // Notify the renderer.
  const mainWindow = config.getMainWindow()
  if (mainWindow) {
    mainWindow.webContents.send('project-path-changed', {
      projectId: result.projectId,
      path: newPath,
      storagePath: result.instance.storagePath,
      status: result.instance.contextManager.getStatus()
    })
  }

  return { success: true, projectId: result.projectId, path: newPath }
}

const statelessWorkspacePromises = new Map()
const STATELESS_MUTATION_TOOLS = new Set([
  'write_file', 'edit_file', 'delete_file', 'text_edit', 'json_edit', 'apply_patch',
  'copy_file', 'move_file', 'create_directory', 'create_file_session',
  'blender_run_script', 'blender_create_demo_model',
  'blender_modify_scene', 'blender_import_asset'
])
const STATELESS_READ_TOOLS = new Set([
  'read_file', 'read_many_files', 'find_in_file', 'glob_files', 'list_files',
  'list_directory', 'check_syntax', 'check_project_syntax', 'post_change_verify',
  'locate_code', 'code_navigate', 'trace_call_chain', 'git_status', 'git_diff', 'git_log'
])
const STATELESS_COMMAND_TOOLS = new Set(['run_command', 'terminal_run', 'shell_run'])

function isReadOnlyWorkspaceCommand(command = '') {
  const text = String(command || '').trim()
  if (!text) return true
  if (/[>]|\b(Set-Content|Add-Content|Out-File|Remove-Item|Move-Item|Copy-Item|New-Item|mkdir|rmdir|rm|mv|cp|touch|del|ren|npm\s+(?:install|i)|pnpm\s+(?:install|add)|yarn\s+add|git\s+(?:add|commit|checkout|switch|merge|rebase|reset|clean))\b/i.test(text)) {
    return false
  }
  return /^(?:pwd|cd\b|dir\b|ls\b|Get-ChildItem\b|Get-Content\b|Select-String\b|rg\b|findstr\b|where\b|git\s+(?:status|diff|log|show|branch\b)|node\s+--check\b)/i.test(text)
}

function getStatelessToolKind(name, args = {}) {
  const compositeRoute = getCompositeRoute(name, args)
  if (compositeRoute && ['read', 'mutation'].includes(compositeRoute.statelessKind)) {
    return compositeRoute.statelessKind
  }
  if (STATELESS_MUTATION_TOOLS.has(name)) return 'mutation'
  if (STATELESS_READ_TOOLS.has(name)) return 'read'
  if (STATELESS_COMMAND_TOOLS.has(name)) {
    return isReadOnlyWorkspaceCommand(args.command) ? 'read' : 'mutation'
  }
  return 'none'
}

function hasRequiredMutationTarget(name, args = {}) {
  const compositeRoute = getCompositeRoute(name, args)
  if (compositeRoute?.statelessKind === 'mutation') {
    return hasRequiredMutationTarget(
      compositeRoute.tool,
      buildRoutedArgs(name, compositeRoute.action, args)
    )
  }
  if (['write_file', 'edit_file', 'delete_file', 'text_edit', 'json_edit', 'create_directory', 'create_file_session'].includes(name)) {
    return !!String(args.path || '').trim()
  }
  if (['append_file_chunk', 'finish_file_session'].includes(name)) {
    return !!String(args.session_id || '').trim()
  }
  if (name === 'apply_patch') return !!String(args.patch || '').trim()
  if (['copy_file', 'move_file'].includes(name)) {
    return !!String(args.source || '').trim() && !!String(args.destination || '').trim()
  }
  if (name === 'render_svg_asset') return !!String(args.output_path || '').trim()
  if (['extract_video_frames', 'upscale_media'].includes(name)) return !!String(args.path || '').trim()
  if (STATELESS_COMMAND_TOOLS.has(name)) return !!String(args.command || '').trim()
  return true
}

function collectAbsolutePathCandidates(args = {}, userMessage = '') {
  const candidates = []
  const seen = new Set()
  const push = value => {
    const text = String(value || '').trim().replace(/^['"]|['"]$/g, '')
    if (!text || !path.isAbsolute(text) || seen.has(text.toLowerCase())) return
    seen.add(text.toLowerCase())
    candidates.push(text)
  }
  const visit = (value, key = '') => {
    if (typeof value === 'string') {
      if (/^(?:path|cwd|file|folder|directory|source|destination|target)/i.test(key)) push(value)
      if (/^(?:patch|command|message)$/i.test(key)) {
        for (const match of value.matchAll(/[A-Za-z]:[\\/][^\s\r\n"'<>|?*，。；;]+/g)) push(match[0].trim())
      }
      return
    }
    if (Array.isArray(value)) {
      value.forEach(item => visit(item, key))
      return
    }
    if (value && typeof value === 'object') {
      Object.entries(value).forEach(([childKey, childValue]) => visit(childValue, childKey))
    }
  }
  visit(args)
  visit(String(userMessage || ''), 'message')
  return candidates
}

function resolveExistingDirectory(candidate = '') {
  if (!candidate || !path.isAbsolute(candidate)) return ''
  let current = path.resolve(candidate)
  try {
    if (fs.existsSync(current) && fs.statSync(current).isFile()) current = path.dirname(current)
  } catch {
    current = path.dirname(current)
  }
  while (current && !fs.existsSync(current)) {
    const parent = path.dirname(current)
    if (parent === current) return ''
    current = parent
  }
  try {
    return fs.statSync(current).isDirectory() ? current : ''
  } catch {
    return ''
  }
}

function getLargestWritableRoot() {
  if (process.platform === 'win32') {
    try {
      const script = "[System.IO.DriveInfo]::GetDrives() | Where-Object { $_.DriveType -eq [System.IO.DriveType]::Fixed -and $_.IsReady } | Select-Object Name,AvailableFreeSpace | ConvertTo-Json -Compress"
      const output = execFileSync('powershell.exe', ['-NoProfile', '-Command', script], {
        encoding: 'utf8', windowsHide: true, timeout: 5000
      })
      const parsed = JSON.parse(String(output || '[]').trim() || '[]')
      const drives = (Array.isArray(parsed) ? parsed : [parsed])
        .map(item => ({ root: String(item.Name || ''), freeBytes: Number(item.AvailableFreeSpace) || 0 }))
        .filter(item => {
          if (!item.root || !fs.existsSync(item.root)) return false
          try {
            fs.accessSync(item.root, fs.constants.W_OK)
            return true
          } catch {
            return false
          }
        })
        .sort((a, b) => b.freeBytes - a.freeBytes)
      if (drives[0]?.root) return drives[0].root
    } catch {}
  }
  const home = require('os').homedir?.() || ''
  return home && fs.existsSync(home) ? home : path.join(__dirname, '..')
}

function createAutomaticWorkspaceDirectory() {
  const root = getLargestWritableRoot()
  const baseDir = path.join(root, 'LingXiCode Workspaces')
  fs.mkdirSync(baseDir, { recursive: true })
  const now = new Date()
  const pad = value => String(value).padStart(2, '0')
  const baseName = `工作区-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`
  let name = baseName
  let workspacePath = path.join(baseDir, name)
  let suffix = 1
  while (fs.existsSync(workspacePath)) {
    name = `${baseName}-${suffix++}`
    workspacePath = path.join(baseDir, name)
  }
  fs.mkdirSync(workspacePath, { recursive: false })
  return { path: workspacePath, name, root }
}

function bindStatelessWorkspace(instance, workspacePath, workspaceOrigin) {
  instance.projectPath = workspacePath
  instance.stateless = false
  instance.workspaceOrigin = workspaceOrigin
  instance.observedExternalRoot = ''
  removeStatelessSessionFromIndex(instance.projectId)
  if (instance.contextManager) instance.contextManager.projectPath = workspacePath

  const mainWindow = config.getMainWindow()
  mainWindow?.webContents.send('project-path-changed', {
    projectId: instance.projectId,
    path: workspacePath,
    storagePath: instance.storagePath || '',
    stateless: false,
    workspaceOrigin,
    status: instance.contextManager?.getStatus?.() || null
  })
}

async function prepareStatelessToolContext(projectId, toolName, args = {}, options = {}) {
  const instance = getProjectInstance(projectId)
  if (!instance?.stateless) {
    return { success: true, projectPath: instance?.projectPath || '', stateless: false }
  }

  const kind = getStatelessToolKind(toolName, args)
  if (kind === 'none') return { success: true, projectPath: '', stateless: true }

  const argumentRoot = collectAbsolutePathCandidates(args, '')
    .map(resolveExistingDirectory)
    .find(Boolean) || ''
  const messageTargetsExistingPath = /(修改|改进|修复|编辑|更新|重构|检查|查看|读取|分析).{0,24}(目录|文件|项目|代码)|(?:目录|文件|项目|代码).{0,24}(修改|改进|修复|编辑|更新|重构|检查|查看|读取|分析)/i.test(String(options.userMessage || ''))
  const messageRoot = messageTargetsExistingPath
    ? collectAbsolutePathCandidates({}, options.userMessage).map(resolveExistingDirectory).find(Boolean) || ''
    : ''
  const explicitRoot = argumentRoot || messageRoot

  if (kind === 'read') {
    if (explicitRoot) {
      instance.observedExternalRoot = explicitRoot
      return { success: true, projectPath: '', stateless: true, externalRoot: explicitRoot }
    }
    return {
      success: false,
      stateless: true,
      error_type: 'workspace_required',
      error: '当前是无项目会话。读取已有文件时请使用绝对路径，系统不会为只读操作自动创建工作区。'
    }
  }

  if (!hasRequiredMutationTarget(toolName, args)) {
    return {
      success: false,
      stateless: true,
      error_type: 'invalid_tool_arguments',
      error: `${toolName} 缺少必要的目标参数，未创建工作区。`
    }
  }

  if (statelessWorkspacePromises.has(projectId)) return statelessWorkspacePromises.get(projectId)
  const pending = (async () => {
    const latest = getProjectInstance(projectId)
    if (!latest?.stateless) return { success: true, projectPath: latest?.projectPath || '', stateless: false }

    const existingRoot = explicitRoot || latest.observedExternalRoot || ''
    let automaticWorkspace = null
    try {
      if (existingRoot) {
        bindStatelessWorkspace(latest, existingRoot, 'existing')
      } else {
        automaticWorkspace = createAutomaticWorkspaceDirectory()
        bindStatelessWorkspace(latest, automaticWorkspace.path, 'auto_created')
      }
      return {
        success: true,
        projectPath: latest.projectPath,
        stateless: false,
        workspaceOrigin: latest.workspaceOrigin,
        created: latest.workspaceOrigin === 'auto_created'
      }
    } catch (error) {
      if (automaticWorkspace?.path) {
        try { fs.rmdirSync(automaticWorkspace.path) } catch {}
      }
      return { success: false, error: error.message || '准备工作区失败' }
    }
  })()
  statelessWorkspacePromises.set(projectId, pending)
  try {
    return await pending
  } finally {
    statelessWorkspacePromises.delete(projectId)
  }
}

/**
 * Register project IPC handlers.
 */
function registerProjectsIPC(ipcMain) {
  // ===== project list IPC =====

  // Recall memory by semantic query.
  ipcMain.handle('recall-memory', async (event, projectId, query, maxResults = 10) => {
    const instance = await ensureProjectBranchSession(projectId)
    if (!instance) {
      return { success: false, error: 'project does not exist' }
    }
    return instance.contextManager.recallHistory(query, maxResults)
  })

  // Add a project directory selected by the user.
  ipcMain.handle('recall-memory-by-time', async (event, projectId, startTime, endTime, maxResults = 20) => {
    const instance = await ensureProjectBranchSession(projectId)
    if (!instance) {
      return { success: false, error: 'project does not exist' }
    }
    return instance.contextManager.recallByTime(startTime, endTime, maxResults)
  })

  // Return project list entries.
  ipcMain.handle('recall-memory-by-turn-range', async (event, projectId, startTurn, endTurn, maxResults = 20) => {
    const instance = await ensureProjectBranchSession(projectId)
    if (!instance) {
      return { success: false, error: 'project does not exist' }
    }
    return instance.contextManager.recallByTurnRange(startTurn, endTurn, maxResults)
  })

  // Memory status is kept for the context status panel; full tape history is no longer exposed to the renderer.
  ipcMain.handle('memory-get-status', async (event, projectId) => {
    const instance = await ensureProjectBranchSession(projectId)
    if (!instance) {
      return { success: false, error: 'project does not exist' }
    }
    try {
      const status = instance.contextManager.memory.getStatus()
      return { success: true, data: status }
    } catch (error) {
      return { success: false, error: error.message }
    }
  })

  // Save visible context boundary.
  ipcMain.handle('get-visibility-boundary', async (event, projectId) => {
    const instance = await ensureProjectBranchSession(projectId)
    if (!instance) {
      return { error: 'project does not exist' }
    }
    const boundary = instance.contextManager.getVisibilityBoundary()
    const stats = instance.contextManager.window.getVisibilityStats(instance.messagesHistory)
    return {
      success: true,
      startIndex: boundary,
      stats
    }
  })

  // Update visible context boundary.
  ipcMain.handle('set-visibility-boundary', async (event, projectId, newIndex) => {
    const instance = await ensureProjectBranchSession(projectId)
    if (!instance) {
      return { error: 'project does not exist' }
    }
    // Persist the boundary in the context window.
    instance.contextManager.window.visibleStartIndex = newIndex
    instance.contextManager.window._saveWindow()
    console.log('[Projects] updated visibility boundary:', projectId, '->', newIndex)
    // Notify the renderer.
    const webContents = getWebContentsForProject(projectId)
    if (webContents) {
      webContents.send('visibility-boundary-changed', {
        projectId,
        startIndex: newIndex
      })
    }
    return { success: true, newIndex }
  })

  // Reset visible context boundary.
  ipcMain.handle('reset-visibility-boundary', async (event, projectId) => {
    const instance = await ensureProjectBranchSession(projectId)
    if (!instance) {
      return { error: 'project does not exist' }
    }
    const result = instance.contextManager.resetVisibilityBoundary()
    // Notify the renderer after reset.
    const webContents = getWebContentsForProject(projectId)
    if (webContents) {
      webContents.send('visibility-boundary-changed', {
        projectId,
        startIndex: 0,
        reset: true
      })
    }
    return result
  })

  // Get project memory stats.
  ipcMain.handle('get-behavior-summary', async (event, projectId) => {
    const instance = config.getProjectInstance(projectId)
    if (!instance) {
      return { error: 'project does not exist' }
    }
    const summaryText = instance.contextManager.summary.formatForAPI()
    const status = instance.contextManager.summary.getStatus()
    return {
      success: true,
      summaryText,
      status
    }
  })

  // Get context status for the current project.
  ipcMain.handle('get-context-status', async (event, projectId, modelName = null) => {
    try {
    const instance = await ensureProjectBranchSession(projectId)
    if (!instance) {
      return { error: 'project does not exist' }
    }

    const messagesHistory = instance.messagesHistory || []

    const budget = buildContextBudget(modelName)
    const payload = buildContextPayload({
      contextManager: instance.contextManager,
      systemPrompt: '',
      history: messagesHistory,
      policy: budget
    })
    const estimatedTokens = payload.estimatedTokens
    const limit = payload.maxContextTokens
    const contextRatio = Math.min(estimatedTokens / limit, 1)

    // Include memory and summary state for the context status panel.
    const memoryStatus = instance.contextManager.memory.getStatus()
    const summaryStatus = instance.contextManager.summary.getStatus()

    // console.log removed: avoid per-query log spam

    return {
      // Current context estimate.
      estimatedTokens: Math.round(estimatedTokens),
      contextRatio: contextRatio,
      modelLimit: limit,
      historyLength: messagesHistory.length,

      // Full history estimate.
      fullHistoryTokens: memoryStatus.tapeLength > 0 ? Math.round(estimatedTokens * 2) : Math.round(estimatedTokens),
      memoryTapeLength: memoryStatus.tapeLength,
      memoryIndexSize: memoryStatus.indexSize,

      // Summary state.
      summary: {
        completedCount: summaryStatus.completedCount,
        inProgressCount: summaryStatus.inProgressCount,
        pendingCount: summaryStatus.pendingCount,
        filesCreatedCount: summaryStatus.filesCreatedCount
      },

      // Project paths.
      projectPath: instance.projectPath,
      storagePath: instance.storagePath
    }
    } catch (error) {
      console.error('[Projects] get-context-status failed:', error)
      return {
        estimatedTokens: 0,
        contextRatio: 0,
        modelLimit: buildContextBudget(modelName).maxContextTokens,
        historyLength: 0,
        fullHistoryTokens: 0,
        memoryTapeLength: 0,
        memoryIndexSize: 0,
        summary: {
          completedCount: 0,
          inProgressCount: 0,
          pendingCount: 0,
          filesCreatedCount: 0
        },
        error: error.message
      }
    }
  })

  // Get persisted chat history for a concrete chat instance.
  ipcMain.handle('get-chat-history-page', async (event, projectId, options = {}) => {
    try {
      let instance = await ensureProjectBranchSession(projectId)
      if (!instance) return { success: false, error: 'project does not exist', messages: [] }
      if (isChatSessionEligible(instance)) {
        instance = await bootstrapDefaultChatSessionIfNeeded(instance) || instance
      }
      if (isChatSessionEligible(instance) && instance.chatSessionId) {
        instance = await ensureProjectChatSession(instance, {
          sessionId: instance.chatSessionId,
          skipSave: true
        }) || instance
      }
      if (pendingChatHistorySaves.has(projectId)) await saveProjectChatHistory(projectId)
      const page = await readLatestChatHistoryPage(instance, options)
      const includeMetadata = options.includeMetadata !== false
      const metadata = includeMetadata
        ? {
            chatSessions: await listChatSessionsSafe(instance),
            branchSessions: await listBranchSessions(instance)
          }
        : {}
      return {
        success: true,
        projectId,
        chatSessionId: instance.chatSessionId || '',
        chatSessionPath: instance.chatSessionPath || '',
        chatSessionTitle: instance.chatSessionTitle || '',
        branchName: instance.branchName || '',
        branchKey: instance.branchKey || '',
        branchTitle: instance.branchTitle || instance.chatSessionTitle || '',
        branchSessionPath: instance.branchSessionPath || '',
        ...metadata,
        messages: page?.messages || [],
        nextCursor: page?.nextCursor ?? null,
        hasMore: !!page?.hasMore,
        direction: page?.direction || 'older',
        range: page?.range || null,
        manifest: page?.manifest || null,
        legacyFallback: !!page?.fallback
      }
    } catch (error) {
      console.error('[Projects] get-chat-history-page failed:', error)
      return { success: false, error: error.message, messages: [] }
    }
  })

  // The history menu needs a lightweight, complete list of user prompts without
  // keeping every chat chunk mounted in the renderer.
  ipcMain.handle('get-chat-history-index', async (event, projectId) => {
    try {
      let instance = await ensureProjectBranchSession(projectId)
      if (!instance) return { success: false, error: 'project does not exist', entries: [] }
      if (isChatSessionEligible(instance)) {
        instance = await bootstrapDefaultChatSessionIfNeeded(instance) || instance
      }
      if (isChatSessionEligible(instance) && instance.chatSessionId) {
        instance = await ensureProjectChatSession(instance, {
          sessionId: instance.chatSessionId,
          skipSave: true
        }) || instance
      }
      if (pendingChatHistorySaves.has(projectId)) await saveProjectChatHistory(projectId)

      const entries = []
      let cursor = null
      let page = null
      do {
        page = await readLatestChatHistoryPage(instance, {
          cursor,
          direction: 'newer',
          pageChunks: 1
        })
        const chunkIndex = Number(page?.range?.startIndex) || 0
        for (const message of page?.messages || []) {
          if (message?.role !== 'user' || message.hidden || message._deepseekBridge || message.deepseekBridge) continue
          const content = message.displayContent || message.content || ''
          if (
            String(content).includes('[Lingxi internal parallel tool batch results]') ||
            /^Lingxi executed \d+ requested tools in parallel/i.test(String(content))
          ) continue
          entries.push({
            messageId: message.messageId || '',
            content,
            time: message.time || message.timestamp || message.createdAt || message.completedAt || '',
            chunkIndex
          })
        }
        cursor = page?.nextCursor
      } while (page?.hasMore && cursor !== null)

      return { success: true, projectId, entries }
    } catch (error) {
      console.error('[Projects] get-chat-history-index failed:', error)
      return { success: false, error: error.message, entries: [] }
    }
  })

  ipcMain.handle('export-chat-history', async (event, projectId) => {
    try {
      const instance = await ensureProjectBranchSession(projectId)
      if (!instance) return { success: false, error: 'project does not exist', messages: [] }
      if (pendingChatHistorySaves.has(projectId)) await saveProjectChatHistory(projectId)
      const stored = await chatChunkStore.readAll(instance.chatHistoryPath)
      const messages = stored?.messages || await readChatHistoryAsync(instance.chatHistoryPath)
      return { success: true, projectId, messages: contextCompression.removeTransientDividerMessages(messages) }
    } catch (error) {
      return { success: false, error: error.message, messages: [] }
    }
  })

  ipcMain.handle('get-chat-history', async (event, projectId) => {
    try {
      let instance = await ensureProjectBranchSession(projectId)
      if (!instance) {
        return { success: false, error: 'project does not exist', messagesHistory: [] }
      }
      // 普通项目和独立工作区首次进入时就创建默认 main 会话。
      // 不能等点击“新建会话”才初始化，否则首次消息标题没有 chat-session 可写入侧栏。
      if (isChatSessionEligible(instance)) {
        instance = await bootstrapDefaultChatSessionIfNeeded(instance) || instance
      }
      // 同项目多会话：确保读到当前 chat-session，而不是旧分支路径半状态
      if (isChatSessionEligible(instance) && instance.chatSessionId) {
        instance = await ensureProjectChatSession(instance, {
          sessionId: instance.chatSessionId,
          skipSave: true
        }) || instance
      }
      if (pendingChatHistorySaves.has(projectId)) await saveProjectChatHistory(projectId)
      const latestPage = await readLatestChatHistoryPage(instance, { direction: 'older', pageChunks: 1 })
      const messagesHistory = latestPage.messages
      const chatSessions = await listChatSessionsSafe(instance)
      instance.chatSessions = chatSessions
      return {
        success: true,
        projectId,
        chatSessionId: instance.chatSessionId || '',
        chatSessionPath: instance.chatSessionPath || '',
        chatSessionTitle: instance.chatSessionTitle || '',
        chatSessions,
        branchName: instance.branchName || '',
        branchKey: instance.branchKey || '',
        branchTitle: instance.branchTitle || instance.chatSessionTitle || deriveChatTitle(messagesHistory, ''),
        branchSessions: await listBranchSessions(instance),
        ...toPagedHistoryResult(latestPage)
      }
    } catch (error) {
      console.error('[Projects] get-chat-history failed:', error)
      return { success: false, error: error.message, messagesHistory: [] }
    }
  })
  ipcMain.handle('switch-branch-chat-session', async (event, projectId, branchName) => {
    try {
      const instance = config.getProjectInstance(projectId)
      if (!instance) {
        return { success: false, error: 'project does not exist', messagesHistory: [] }
      }
      const targetBranch = String(branchName || '').trim()
      if (!targetBranch) {
        return { success: false, error: 'branchName is required', messagesHistory: [] }
      }

      // 先保存当前普通会话，再解除 chat-session 接管，让分支历史路径成为唯一数据源。
      if (instance.chatSessionPath && instance.chatSessionId) {
        clearPendingChatHistorySave(instance.projectId)
        await writeChatHistory(instance.chatSessionPath, instance.messagesHistory || [], instance)
      }
      instance.chatSessionId = ''
      instance.chatSessionPath = ''
      instance.chatSessionTitle = ''
      instance.messagesHistory = []

      const switched = await ensureProjectBranchSession(instance, {
        forceBranch: true,
        skipSave: true,
        loadFromDisk: true
      })
      if (!switched || switched.branchName !== targetBranch) {
        return {
          success: false,
          error: `当前 Git 分支为「${switched?.branchName || ''}」，无法打开「${targetBranch}」分支会话`,
          messagesHistory: []
        }
      }

      const historyPage = await readLatestChatHistoryPage(switched, { pageChunks: 1, direction: 'older' })
      return {
        success: true,
        projectId,
        chatSessionId: '',
        chatSessionPath: '',
        chatSessionTitle: '',
        chatSessions: Array.isArray(switched.chatSessions) ? switched.chatSessions : await listChatSessionsSafe(switched),
        branchName: switched.branchName || '',
        branchKey: switched.branchKey || '',
        branchTitle: switched.branchTitle || deriveChatTitle(historyPage.messages, ''),
        branchSessionPath: switched.branchSessionPath || '',
        branchSessions: await listBranchSessions(switched),
        ...toPagedHistoryResult(historyPage)
      }
    } catch (error) {
      console.error('[Projects] switch branch chat session failed:', error)
      return { success: false, error: error.message, messagesHistory: [] }
    }
  })
  ipcMain.handle('chat-history:create-source-reference', async (event, targetProjectId, sourceProjectId, options = {}) => {
    try {
      let source = await ensureProjectBranchSession(sourceProjectId)
      let target = await ensureProjectBranchSession(targetProjectId)
      if (!source || !target) return { success: false, error: 'source or target project does not exist' }
      if (source.projectId === target.projectId) return { success: false, error: 'source and target project must differ' }

      if (isChatSessionEligible(source)) source = await bootstrapDefaultChatSessionIfNeeded(source) || source
      if (isChatSessionEligible(target)) target = await bootstrapDefaultChatSessionIfNeeded(target) || target
      if (pendingChatHistorySaves.has(source.projectId)) await saveProjectChatHistory(source.projectId)

      const reference = await chatChunkStore.createSourceReference(target.chatHistoryPath, source.chatHistoryPath, {
        sourceProjectId: source.projectId,
        sourceSessionId: source.chatSessionId || source.branchKey || '',
        targetProjectId: target.projectId,
        targetSessionId: target.chatSessionId || target.branchKey || ''
      })
      const page = await readLatestChatHistoryPage(target, { direction: 'older', pageChunks: 1 })
      target.messagesHistory = page.messages
      target._runtimeHistoryStartTurn = Math.max(
        1,
        Number(reference.sourceRoundCount || 0) - chatMessageIdentity.groupByRound(page.messages).length + 1
      )
      const preferredTitle = String(options.preferredTitle || options.title || '').replace(/\s+/g, ' ').trim()
      if (preferredTitle) target.branchTitle = preferredTitle.slice(0, 30)
      await writeBranchSessionMetaAsync(target)
      return {
        success: true,
        projectId: target.projectId,
        sourceProjectId: source.projectId,
        sourceSessionId: reference.sourceSessionId,
        forkMessageId: reference.forkMessageId,
        forkRoundId: reference.forkRoundId,
        branchName: target.branchName || '',
        branchKey: target.branchKey || '',
        branchTitle: target.branchTitle || '',
        ...toPagedHistoryResult(page)
      }
    } catch (error) {
      console.error('[Projects] create chat history source reference failed:', error)
      return { success: false, error: error.message, messages: [], messagesHistory: [] }
    }
  })
  ipcMain.handle('chat-history:replace', async (event, projectId, messagesHistory = [], options = {}) => {
    try {
      const instance = await ensureProjectBranchSession(projectId)
      if (!instance) {
        return { success: false, error: 'project does not exist', messagesHistory: [] }
      }
      if (!Array.isArray(messagesHistory)) {
        return { success: false, error: 'messagesHistory must be an array', messagesHistory: [] }
      }

      // 支持指定目标分支：让后端先把 branch 切到目标，再写历史
      const targetBranch = String(options?.branchName || '').trim()
      if (targetBranch && targetBranch !== instance.branchName) {
        // 创建/切换分支会话时退出普通 chat-session 模式，避免历史继续写回主会话目录。
        if (instance.chatSessionPath && instance.chatSessionId) {
          clearPendingChatHistorySave(instance.projectId)
          await writeChatHistory(instance.chatSessionPath, instance.messagesHistory || [], instance)
        }
        instance.chatSessionId = ''
        instance.chatSessionPath = ''
        instance.chatSessionTitle = ''
        try {
          await execFileAsync('git', ['checkout', targetBranch], {
            cwd: instance.projectPath, windowsHide: true, encoding: 'utf8', timeout: 5000
          })
        } catch (checkoutError) {
          console.warn('[Projects] chat-history:replace switch branch failed:', checkoutError.message)
        }
        // 重新拉 instance 到新分支路径
        const switched = await ensureProjectBranchSession(instance, { forceBranch: true, skipSave: true })
        if (switched) {
          switched.branchName = targetBranch
          switched.branchKey = getBranchKey(targetBranch)
        }
      }

      const targetInstance = config.getProjectInstance(projectId) || instance
      const normalized = messagesHistory
        .filter(msg => msg && typeof msg === 'object')
        .map(msg => ({ ...msg }))
        .filter(msg => typeof msg.role === 'string' || msg.type === 'compression-divider')

      targetInstance.messagesHistory = contextCompression.removeTransientDividerMessages(normalized)
      const preferredTitle = String(options?.preferredTitle || options?.title || '').replace(/\s+/g, ' ').trim()
      if (preferredTitle) {
        targetInstance.branchTitle = preferredTitle.length > 30 ? `${preferredTitle.slice(0, 30)}...` : preferredTitle
      } else if (!String(targetInstance.branchTitle || '').trim()) {
        // 仅在分支标题为空时才从历史推导，避免覆盖已有消息前缀标题
        targetInstance.branchTitle = deriveChatTitle(targetInstance.messagesHistory, '')
      }
      // 不把 branchTitle 同步到 chatSessionTitle，避免污染同分支下的会话标题
      targetInstance.contextManager?.clearContext?.()
      await contextCompression.clearSummaries(targetInstance)
      await chatChunkStore.replaceAll(targetInstance.chatHistoryPath, targetInstance.messagesHistory, {
        sessionId: targetInstance.chatSessionId || targetInstance.branchKey || targetInstance.projectId
      })
      const latestPage = await readLatestChatHistoryPage(targetInstance, { pageChunks: 1, direction: 'older' })
      applyHistoryPageToInstance(targetInstance, latestPage)
      targetInstance._chatHistoryDirty = false
      await writeBranchSessionMetaAsync(targetInstance)

      return {
        success: true,
        projectId,
        branchName: targetInstance.branchName || '',
        branchKey: targetInstance.branchKey || '',
        branchTitle: targetInstance.branchTitle || '',
        branchSessions: await listBranchSessions(targetInstance),
        ...toPagedHistoryResult(latestPage)
      }
    } catch (error) {
      console.error('[Projects] chat-history:replace failed:', error)
      return { success: false, error: error.message, messagesHistory: [] }
    }
  })

  ipcMain.handle('branch-session:set-title', async (event, projectId, title = '') => {
    try {
      return await setBranchSessionTitle(projectId, title)
    } catch (error) {
      console.error('[Projects] branch-session:set-title failed:', error)
      return { success: false, error: error.message }
    }
  })

  // ===== delete IPC handlers =====

  // Delete project.
  ipcMain.handle('delete-project', async (event, projectId, mode = 'light') => {
    return await deleteProjectCoordinated(projectId, mode)
  })

  // Select project path.
  ipcMain.handle('messages:delete', async (event, projectId, selections = [], options = {}) => {
    try {
      return await deleteProjectMessages(projectId, selections, options)
    } catch (error) {
      console.error('[Projects] messages:delete failed:', error)
      return { success: false, error: error.message }
    }
  })

  // 右侧预览读取上限：避免超大文件同步进主进程导致短暂未响应
  const MAX_PREVIEW_TEXT_BYTES = 2 * 1024 * 1024

  ipcMain.handle('read-file-content', async (event, filePath) => {
    try {
      filePath = assertAllowedFileAccess(filePath, 'read file')
      let stat
      try {
        stat = await fs.promises.stat(filePath)
      } catch (err) {
        if (err && (err.code === 'ENOENT' || err.code === 'ENOTDIR')) {
          return { error: 'file does not exist' }
        }
        throw err
      }
      if (stat.isDirectory()) {
        return {
          success: true,
          isDirectory: true,
          file_type: 'directory',
          path: filePath,
          message: 'This is a directory and cannot be previewed as file content.'
        }
      }
      if (isSupportedImagePath(filePath)) {
        return await readImageDataUrl(filePath)
      }
      if (stat.size > MAX_PREVIEW_TEXT_BYTES) {
        return {
          success: false,
          error: `文件过大（${Math.ceil(stat.size / 1024)}KB），预览上限 ${Math.floor(MAX_PREVIEW_TEXT_BYTES / 1024)}KB`,
          tooLarge: true,
          size: stat.size,
          maxSize: MAX_PREVIEW_TEXT_BYTES,
          path: filePath
        }
      }
      const content = await fs.promises.readFile(filePath, 'utf-8')
      return {
        success: true,
        content,
        size: stat.size,
        path: filePath
      }
    } catch (err) {
      return { error: err.message }
    }
  })

  ipcMain.handle('read-image-data-url', async (event, filePath) => {
    try {
      return await readImageDataUrl(filePath)
    } catch (err) {
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('save-image-as', async (event, filePath) => {
    try {
      filePath = assertAllowedFileAccess(filePath, 'save image source')
      if (!filePath || !fs.existsSync(filePath)) return { success: false, error: 'image does not exist or was cleaned up' }
      if (!isSupportedImagePath(filePath)) return { success: false, error: 'unsupported image format' }
      const defaultPath = path.basename(filePath)
      const result = await dialog.showSaveDialog(config.getMainWindow(), {
        title: 'Save image',
        defaultPath,
        filters: [
          { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'] },
          { name: 'All files', extensions: ['*'] }
        ]
      })
      if (result.canceled || !result.filePath) return { success: false, canceled: true }
      fs.copyFileSync(filePath, result.filePath)
      return { success: true, path: result.filePath }
    } catch (err) {
      return { success: false, error: err.message }
    }
  })

  // Open project path.
  ipcMain.handle('write-file-content', async (event, filePath, content) => {
    try {
      filePath = assertAllowedFileAccess(filePath, 'write file')
      fs.writeFileSync(filePath, content, 'utf-8')
      return { success: true }
    } catch (err) {
      return { error: err.message }
    }
  })

  // Open a project file or folder with the system shell.
  ipcMain.handle('open-project-folder', async (event, filePath) => {
    try {
      filePath = assertAllowedFileAccess(filePath, 'open path')
      if (!filePath) return { error: 'path is empty' }
      if (!fs.existsSync(filePath)) {
        return { error: 'path does not exist' }
      }
      const error = await shell.openPath(filePath)
      if (error) return { error }
      return { success: true }
    } catch (err) {
      return { error: err.message }
    }
  })


  ipcMain.handle('show-item-in-folder', async (event, filePath) => {
    try {
      filePath = assertAllowedFileAccess(filePath, 'show item in folder')
      if (!filePath) return { error: 'path is empty' }
      if (!fs.existsSync(filePath)) return { error: 'path does not exist' }
      const stat = fs.statSync(filePath)
      if (stat.isDirectory()) {
        const error = await shell.openPath(filePath)
        if (error) return { error }
      } else {
        shell.showItemInFolder(filePath)
      }
      return { success: true }
    } catch (err) {
      return { error: err.message }
    }
  })
  // Create project instance.
  ipcMain.handle('create-project', async (event, projectPath, options = {}) => {
    const result = await createProjectInstance(projectPath, {
      projectId: options?.projectId || options?.id || '',
      storagePath: options?.storagePath || ''
    })
    return {
      success: true,
      projectId: result.projectId,
      existing: result.existing,
      projectPath,
      storagePath: result.instance?.storagePath,
      folderMtimeMs: getDirectoryMtimeMs(projectPath)
    }
  })

  ipcMain.handle('rename-project-folder', async (event, projectId, nextName) => {
    return renameProjectFolder(projectId, nextName)
  })

  // Get all project instances.
  ipcMain.handle('get-all-projects', async (event, options = {}) => {
    return await getAllProjectsForIPC(options)
  })
  // 同项目多会话（不新建分支，共享项目路径/权限/快照，独立聊天上下文与历史）
  ipcMain.handle('create-project-chat-session', async (event, projectId, options = {}) => {
    try {
      return await createProjectChatSession(projectId, options)
    } catch (err) {
      console.error('[Projects] create chat session failed:', err)
      return { success: false, error: err?.message || '新建会话失败' }
    }
  })

  ipcMain.handle('switch-project-chat-session', async (event, projectId, sessionId) => {
    try {
      return await switchProjectChatSession(projectId, sessionId)
    } catch (err) {
      console.error('[Projects] switch chat session failed:', err)
      return { success: false, error: err?.message || '切换会话失败', messagesHistory: [] }
    }
  })

  ipcMain.handle('delete-project-chat-session', async (event, projectId, sessionId) => {
    try {
      return await deleteProjectChatSession(projectId, sessionId)
    } catch (err) {
      console.error('[Projects] delete chat session failed:', err)
      return { success: false, error: err?.message || '删除会话失败' }
    }
  })

  ipcMain.handle('list-project-chat-sessions', async (event, projectId) => {
    const instance = getProjectInstance(projectId)
    if (!instance) return { success: false, error: 'project does not exist', chatSessions: [] }
    try {
      const chatSessions = await listChatSessions(instance)
      return { success: true, chatSessions }
    } catch (err) {
      console.error('[Projects] list chat sessions failed:', err)
      return { success: false, error: err?.message || '加载会话列表失败', chatSessions: [] }
    }
  })

  ipcMain.handle('update-project-chat-session-title', async (event, projectId, sessionId, title) => {
    try {
      return await updateProjectChatSessionTitle(projectId, sessionId, title)
    } catch (err) {
      console.error('[Projects] update chat session title failed:', err)
      return { success: false, error: err?.message || '更新会话标题失败' }
    }
  })


  ipcMain.handle('artifact:get', async (event, projectId, artifactId) => {
    const instance = getProjectInstance(projectId)
    if (!instance) return { success: false, error: 'project does not exist' }
    return artifacts.readArtifact(instance, artifactId)
  })

  ipcMain.handle('task-ledger:index', async (event, projectId) => {
    const instance = getProjectInstance(projectId)
    if (!instance) return { success: false, error: 'project does not exist' }
    return { success: true, index: taskLedger.loadIndex(instance) }
  })

  ipcMain.handle('task-ledger:get', async (event, projectId, entryId) => {
    const instance = getProjectInstance(projectId)
    if (!instance) return { success: false, error: 'project does not exist' }
    return taskLedger.getEntry(instance, entryId)
  })

  ipcMain.handle('task-runs:list', async (event, projectId) => {
    if (!getProjectInstance(projectId)) return { success: false, error: 'project not found' }
    return { success: true, runs: taskRuns.listRuns(projectId) }
  })

  ipcMain.handle('task-runs:recoverable', async (event, projectId) => {
    if (!getProjectInstance(projectId)) return { success: false, error: 'project not found' }
    return { success: true, runs: taskRuns.getRecoverableRuns(projectId) }
  })

  // Set the active project path.
  ipcMain.handle('set-project-path', async (event, projectId, newPath) => {
    return setProjectPath(projectId, newPath)
  })

  function getProjectDialogDefaultPath() {
    const projectInstances = config.getProjectInstances()
    let defaultPath = path.join(__dirname, '..')
    if (projectInstances.size > 0) {
      const firstInstance = projectInstances.values().next().value
      if (firstInstance?.projectPath) defaultPath = firstInstance.projectPath
    }
    return defaultPath
  }

  // 打开已有项目目录。
  ipcMain.handle('select-project-path', async () => {
    const mainWindow = config.getMainWindow()
    const result = await dialog.showOpenDialog(mainWindow, {
      title: '打开已有项目目录',
      defaultPath: getProjectDialogDefaultPath(),
      properties: ['openDirectory']
    })

    if (result.canceled || result.filePaths.length === 0) {
      return { canceled: true }
    }

    return { success: true, path: result.filePaths[0] }
  })

  // 选择新建项目的父目录（仅选位置，不创建）。
  ipcMain.handle('select-new-project-parent-path', async () => {
    const mainWindow = config.getMainWindow()
    const result = await dialog.showOpenDialog(mainWindow, {
      title: '选择新建项目的位置',
      defaultPath: getProjectDialogDefaultPath(),
      properties: ['openDirectory']
    })

    if (result.canceled || result.filePaths.length === 0) {
      return { canceled: true }
    }

    return { success: true, path: result.filePaths[0] }
  })

  // 在父目录下按名称创建新项目文件夹，并初始化项目实例。
  ipcMain.handle('create-project-folder', async (event, parentPath, projectName) => {
    try {
      const parent = String(parentPath || '').trim()
      if (!parent) return { success: false, error: '请先选择新建位置' }
      if (!fs.existsSync(parent)) return { success: false, error: '所选位置不存在' }
      if (!fs.statSync(parent).isDirectory()) return { success: false, error: '所选位置不是文件夹' }

      let safeName
      try {
        safeName = sanitizeProjectFolderName(projectName)
      } catch (error) {
        return { success: false, error: error.message }
      }

      const projectPath = path.join(parent, safeName)
      if (fs.existsSync(projectPath)) {
        return { success: false, error: '该位置已存在同名文件夹' }
      }

      fs.mkdirSync(projectPath, { recursive: false })
      const result = await createProjectInstance(projectPath)
      return {
        success: true,
        projectId: result.projectId,
        existing: result.existing,
        path: projectPath,
        name: safeName,
        projectPath,
        storagePath: result.instance?.storagePath,
        folderMtimeMs: getDirectoryMtimeMs(projectPath)
      }
    } catch (error) {
      console.error('[Projects] create-project-folder failed:', error)
      return { success: false, error: error.message || '创建项目目录失败' }
    }
  })

  // 无项目发送时只创建聊天实例，不创建任何工作目录。
  ipcMain.handle('create-stateless-chat-project', async () => {
    try {
      const projectId = `stateless-chat-${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}`
      const storagePath = path.join(storageConfig.getProjectsDir(), 'stateless-chats', projectId)
      const result = await createProjectInstance('', {
        projectId,
        storagePath,
        stateless: true,
        workspaceOrigin: 'none'
      })
      const session = upsertStatelessSession(result.instance, { flush: true })
      return {
        success: true,
        projectId: result.projectId,
        storagePath: result.instance?.storagePath,
        stateless: true,
        session
      }
    } catch (error) {
      console.error('[Projects] create-stateless-chat-project failed:', error)
      return { success: false, error: error.message || '创建无项目会话失败' }
    }
  })

  ipcMain.handle('stateless-chat-sessions:list', async (event, options = {}) => {
    try {
      const index = reconcileStatelessSessionStorage()
      const page = Math.max(0, Number(options.page) || 0)
      const limit = Math.max(1, Math.min(100, Number(options.limit) || STATELESS_SESSION_PAGE_SIZE))
      const query = String(options.query || '').trim().toLowerCase()
      const sessions = query
        ? index.sessions.filter(session => (
          String(session.title || '').toLowerCase().includes(query)
          || String(session.id || '').toLowerCase().includes(query)
          || String(session.lastMessageSummary || '').toLowerCase().includes(query)
        ))
        : index.sessions
      const start = page * limit
      return {
        success: true,
        sessions: sessions.slice(start, start + limit).map(({ storagePath, ...metadata }) => metadata),
        total: sessions.length,
        overallTotal: index.sessions.length,
        page,
        limit,
        hasMore: start + limit < sessions.length
      }
    } catch (error) {
      return { success: false, error: error.message || '读取临时会话失败', sessions: [], total: 0 }
    }
  })

  ipcMain.handle('stateless-chat-sessions:open', async (event, projectId) => {
    try {
      const index = reconcileStatelessSessionStorage()
      const entry = index.sessions.find(item => item.id === projectId)
      if (!entry) return { success: false, error: '临时会话不存在' }
      const storagePath = assertManagedChildPath(entry.storagePath, getStatelessSessionsRoot(), 'stateless session')
      const result = await createProjectInstance('', {
        projectId: entry.id,
        storagePath,
        stateless: true,
        workspaceOrigin: 'none'
      })
      const session = upsertStatelessSession(result.instance, { flush: true })
      return {
        success: true,
        projectId: result.projectId,
        storagePath: result.instance.storagePath,
        stateless: true,
        session
      }
    } catch (error) {
      return { success: false, error: error.message || '打开临时会话失败' }
    }
  })

  ipcMain.handle('stateless-chat-sessions:release', async (event, projectId) => {
    try {
      const instance = getProjectInstance(projectId)
      if (!instance?.stateless) return { success: true, released: false }
      const controller = config.getAbortController(projectId)
      if (controller && !controller.signal.aborted) return { success: true, released: false, running: true }
      if (
        !instance._standaloneHistoryLoaded &&
        (!Array.isArray(instance.messagesHistory) || instance.messagesHistory.length === 0) &&
        instance.chatHistoryPath &&
        chatChunkStore.existsSync(instance.chatHistoryPath)
      ) {
        applyHistoryPageToInstance(instance, await readLatestChatHistoryPage(instance, { pageChunks: 1, direction: 'older' }))
      }
      await saveProjectChatHistory(projectId)
      await Promise.allSettled([
        instance.contextManager?.memory?.flush?.(),
        instance.contextManager?.summary?._flushSave?.()
      ].filter(Boolean))
      const session = upsertStatelessSession(instance, { updatedAt: Date.now(), flush: true })
      config.deleteProjectInstance(projectId)
      return { success: true, released: true, session }
    } catch (error) {
      return { success: false, error: error.message || '释放临时会话失败' }
    }
  })

  ipcMain.handle('stateless-chat-sessions:delete', async (event, projectId) => {
    try {
      const index = reconcileStatelessSessionStorage()
      const entry = index.sessions.find(item => item.id === projectId)
      if (!entry) return { success: true, deleted: false }
      const controller = config.getAbortController(projectId)
      if (controller && !controller.signal.aborted) return { success: false, error: '会话正在运行，暂时无法删除' }
      const instance = getProjectInstance(projectId)
      if (instance) {
        await deleteProject(projectId, 'light')
      } else {
        const storagePath = assertManagedChildPath(entry.storagePath, getStatelessSessionsRoot(), 'stateless session')
        await chatChunkStore.prepareStorageDeletion(storagePath)
        deleteProjectManagedData({ projectId, storagePath, projectPath: '' })
      }
      removeStatelessSessionFromIndex(projectId, { flush: true })
      return { success: true, deleted: true }
    } catch (error) {
      return { success: false, error: error.message || '删除临时会话失败' }
    }
  })

  // Ensure collaboration chat sub-instance (shares parent project path, isolated context).
  ipcMain.handle('ensure-collaboration-chat-instance', async (event, parentProjectId, sessionId, agent = {}) => {
    if (!parentProjectId || !sessionId) {
      return { success: false, error: 'parentProjectId and sessionId are required' }
    }
    const parent = config.getProjectInstance(parentProjectId)
    if (!parent) {
      return { success: false, error: `parent project not found: ${parentProjectId}` }
    }
    try {
      const result = await createCollaborationChatInstance(parentProjectId, sessionId, agent || {}, parent.projectPath || '')
      return result
    } catch (err) {
      return { success: false, error: err?.message || String(err) }
    }
  })
}

/**
 * 增量 token 估算：缓存上次计算结果，仅计算新增消息。
 * 适用于 context-status 等高频查询场景，避免每次遍历整个 messagesHistory。
 */
function estimateTokensIncremental(instance) {
  if (!instance) return 0
  const messages = instance.messagesHistory || []
  // 历史被截断或重置时，重新计算
  if (messages.length < (instance._lastTokenCalcLength || 0)) {
    instance._cachedTokenCount = 0
    instance._lastTokenCalcLength = 0
  }
  const estimate = instance.contextManager?.estimateTokens?.bind(instance.contextManager)
    || ((text) => Math.ceil(String(text || '').length / 4))
  for (let i = instance._lastTokenCalcLength || 0; i < messages.length; i++) {
    instance._cachedTokenCount = (instance._cachedTokenCount || 0) + estimate(messages[i].content || '')
  }
  instance._lastTokenCalcLength = messages.length
  return instance._cachedTokenCount || 0
}
module.exports = {
  generateProjectId,
  getProjectStoragePath,
  getWebContentsForProject,
  createProjectInstance,
  createCollaborationChatInstance,
  createTemporaryAgentChatInstance,
  releaseCollaborationChatInstances,
  prepareStatelessToolContext,
  saveProjectChatHistory,
  saveProjectChatHistoryDeferred,
  getProjectInstance,
  ensureProjectBranchSession,
  cleanupProjectBranchData,
  getAllProjectsForIPC,
  deleteProject: deleteProjectCoordinated,
  setProjectPath,
  registerProjectsIPC,
  flushPendingChatWrites,
  estimateTokensIncremental,
  // ── 远程桥接直调接口 ──
  remoteBridgeHandlers: {
    'get-all-projects': (options = {}) => getAllProjectsForIPC(options),
    'task-runs:list': (projectId, options = {}) => options?.storagePath
      ? taskRuns.listRunsFromStoragePath(options.storagePath, options)
      : taskRuns.listRuns(projectId, options),
    'create-project': async (projectPath, options = {}) => {
      const result = await createProjectInstance(projectPath, {
        projectId: options?.projectId || options?.id || '',
        storagePath: options?.storagePath || ''
      })
      return {
        success: true,
        projectId: result.projectId,
        existing: result.existing,
        projectPath,
        storagePath: result.instance?.storagePath,
        folderMtimeMs: getDirectoryMtimeMs(projectPath)
      }
    },
    'delete-project': (projectId, mode = 'light') => deleteProjectCoordinated(projectId, mode),
    'get-chat-history': async (projectId) => {
      try {
        const instance = await ensureProjectBranchSession(projectId)
        if (!instance) {
          return { success: false, error: 'project does not exist', messagesHistory: [] }
        }
        const latestPage = await readLatestChatHistoryPage(instance, { pageChunks: 1, direction: 'older' })
        const messagesHistory = contextCompression.removeTransientDividerMessages(latestPage.messages || [])
        return {
          success: true,
          projectId,
          branchName: instance.branchName || '',
          branchKey: instance.branchKey || '',
          branchTitle: instance.branchTitle || deriveChatTitle(messagesHistory, ''),
          branchSessions: await listBranchSessions(instance),
          ...toPagedHistoryResult({ ...latestPage, messages: messagesHistory })
        }
      } catch (error) {
        console.error('[Projects] remote get-chat-history failed:', error)
        return { success: false, error: error.message, messagesHistory: [] }
      }
    },
    'messages:delete': async (projectId, selections = [], options = {}) => {
      try {
        return await deleteProjectMessages(projectId, selections, options)
      } catch (error) {
        console.error('[Projects] remote messages:delete failed:', error)
        return { success: false, error: error.message }
      }
    },
  }
}
