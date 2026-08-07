/**
 * Lightweight project recovery points.
 *
 * This is the non-Git fallback for AI safety snapshots. It stores only the
 * known target paths before an AI mutation, under app-managed project storage.
 */

const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const config = require('./config')
const storageConfig = require('./storage-config')
const objectStore = require('./content-object-store')
const manifests = require('./recovery-point-manifests')
const retention = require('./recovery-point-retention')
const aiTaskRecoveryPoints = require('./ai-task-recovery-points')

const DEFAULT_MAX_AUTO_POINTS = 30
const DEFAULT_MAX_MANUAL_POINTS = 30
const DEFAULT_MAX_FILE_BYTES = 50 * 1024 * 1024
const aiTaskRecoveryLocks = new Map()

const IGNORE_PARTS = new Set([
  '.git',
  'node_modules',
  'dist',
  'build',
  '.vite',
  '.next',
  '.nuxt',
  'coverage',
  '.tmp-real-scenarios',
  '.lingxi-temp-diagnostics',
  'change-sessions',
  'recovery-points',
  '__pycache__'
])

const IGNORE_EXTENSIONS = new Set([
  '.log',
  '.tmp',
  '.temp',
  '.cache'
])

function makeId(prefix = 'rp') {
  return `${prefix}-${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}`
}

function hashBuffer(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex')
}

function isPathInside(parentPath, childPath) {
  if (!parentPath || !childPath) return false
  const relative = path.relative(path.resolve(parentPath), path.resolve(childPath))
  return relative === '' || (!!relative && !relative.startsWith('..') && !path.isAbsolute(relative))
}

function getPointDir(projectId, pointId) {
  return manifests.getLegacyPointDir(projectId, pointId)
}

function normalizeCandidatePaths(paths) {
  return (Array.isArray(paths) ? paths : [paths])
    .map(item => String(item || '').trim())
    .filter(Boolean)
}

function shouldIgnorePath(projectPath, absolutePath) {
  const relative = path.relative(path.resolve(projectPath), path.resolve(absolutePath))
  if (relative.startsWith('..') || path.isAbsolute(relative)) return true
  if (!relative) return false
  const normalized = relative.replace(/\\/g, '/')
  const parts = normalized.split('/').filter(Boolean)
  if (parts.some(part => IGNORE_PARTS.has(part))) return true
  if (parts.some(part => part.startsWith('.lingxi-temp-'))) return true
  return IGNORE_EXTENSIONS.has(path.extname(normalized).toLowerCase())
}

async function collectDirectoryFilesAsync(projectPath, directoryPath, warnings, options = {}) {
  const maxFiles = Number(options.maxDirectoryFiles) || 200
  const files = []
  const stack = [directoryPath]

  while (stack.length > 0) {
    const current = stack.pop()
    let entries = []
    try {
      entries = await fs.promises.readdir(current, { withFileTypes: true })
    } catch (error) {
      warnings.push({ path: current, reason: 'read_directory_failed', error: error.message })
      continue
    }

    for (const entry of entries) {
      const fullPath = path.join(current, entry.name)
      if (!isPathInside(projectPath, fullPath) || shouldIgnorePath(projectPath, fullPath)) continue
      if (entry.isDirectory()) {
        stack.push(fullPath)
      } else if (entry.isFile()) {
        files.push(fullPath)
        if (files.length >= maxFiles) {
          warnings.push({ path: directoryPath, reason: 'directory_file_limit', limit: maxFiles })
          return files
        }
      }
    }
  }

  return files
}

async function expandSnapshotTargetsAsync(projectPath, paths, warnings, options = {}) {
  const seen = new Set()
  const targets = []

  for (const item of normalizeCandidatePaths(paths)) {
    const absolutePath = path.isAbsolute(item) ? path.resolve(item) : path.resolve(projectPath, item)
    if (!isPathInside(projectPath, absolutePath)) {
      warnings.push({ path: item, reason: 'outside_project' })
      continue
    }
    if (shouldIgnorePath(projectPath, absolutePath)) {
      warnings.push({ path: absolutePath, reason: 'ignored_path' })
      continue
    }

    const stat = await fs.promises.stat(absolutePath).catch(() => null)
    if (!stat) {
      const key = path.resolve(absolutePath).toLowerCase()
      if (!seen.has(key)) {
        seen.add(key)
        targets.push({ path: absolutePath, type: 'missing' })
      }
      continue
    }

    if (stat.isDirectory()) {
      const directoryFiles = await collectDirectoryFilesAsync(projectPath, absolutePath, warnings, options)
      if (directoryFiles.length === 0) {
        const key = path.resolve(absolutePath).toLowerCase()
        if (!seen.has(key)) {
          seen.add(key)
          targets.push({ path: absolutePath, type: 'directory', empty: true })
        }
      }
      for (const filePath of directoryFiles) {
        const key = path.resolve(filePath).toLowerCase()
        if (!seen.has(key)) {
          seen.add(key)
          targets.push({ path: filePath, type: 'file' })
        }
      }
    } else if (stat.isFile()) {
      const key = path.resolve(absolutePath).toLowerCase()
      if (!seen.has(key)) {
        seen.add(key)
        targets.push({ path: absolutePath, type: 'file' })
      }
    } else {
      warnings.push({ path: absolutePath, reason: 'unsupported_file_type' })
    }
  }

  return targets
}

async function writeFileSnapshotAsync(target, projectPath, warnings, options = {}) {
  const relativePath = path.relative(path.resolve(projectPath), path.resolve(target.path)).replace(/\\/g, '/')
  const base = {
    path: target.path,
    relativePath,
    existed: target.type !== 'missing',
    type: target.type
  }

  if (target.type === 'missing') return base
  if (target.type === 'directory') return { ...base, empty: !!target.empty }

  const stat = await fs.promises.stat(target.path)
  const maxFileBytes = Number(options.maxFileBytes) || DEFAULT_MAX_FILE_BYTES
  if (stat.size > maxFileBytes) {
    warnings.push({ path: target.path, reason: 'file_too_large', size: stat.size, limit: maxFileBytes })
    return {
      ...base,
      skipped: true,
      skipReason: 'file_too_large',
      size: stat.size,
      mtimeMs: stat.mtimeMs
    }
  }

  const buffer = await fs.promises.readFile(target.path)
  const digest = hashBuffer(buffer)
  let stored
  try {
    stored = await objectStore.putBuffer(options.projectId, buffer, {
      maxObjectBytes: maxFileBytes,
      reference: {
        kind: 'recovery-point',
        ownerId: options.pointId,
        phase: options.phase || 'before',
        filePath: target.path
      }
    })
  } catch (error) {
    warnings.push({ path: target.path, reason: error.code || 'object_store_failed', error: error.message })
    return { ...base, skipped: true, skipReason: error.code || 'object_store_failed', size: stat.size, mtimeMs: stat.mtimeMs }
  }

  return {
    ...base,
    size: stat.size,
    mtimeMs: stat.mtimeMs,
    mode: stat.mode,
    hash: digest,
    objectHash: stored.hash
  }
}

function readManifest(projectId, pointId) {
  return manifests.read(projectId, pointId)
}

function listRecoveryPoints(projectId) {
  return { success: true, points: manifests.list(projectId) }
}

async function listRecoveryPointsAsync(projectId) {
  return { success: true, points: await manifests.listAsync(projectId) }
}

function getKnownProjectIds() {
  const ids = new Set()
  for (const id of config.getProjectInstances().keys()) {
    if (id) ids.add(String(id))
  }
  try {
    const result = storageConfig.getProjectsList?.()
    const projects = Array.isArray(result) ? result : (Array.isArray(result?.data) ? result.data : [])
    if (Array.isArray(projects)) {
      projects.forEach(project => {
        if (project?.id) ids.add(String(project.id))
      })
    }
  } catch {
    // Best effort only.
  }
  return [...ids]
}

function getRecoveryPointStatus(projectIds = null) {
  const ids = Array.isArray(projectIds) && projectIds.length ? projectIds : getKnownProjectIds()
  const policy = storageConfig.getRecoveryPointConfig?.() || {}
  const projects = []
  let totalBytes = 0
  let totalCount = 0
  let autoCount = 0
  let manualCount = 0

  for (const projectId of ids) {
    const list = listRecoveryPoints(projectId)
    if (!list.success) continue
    const objectStatus = objectStore.getStatusSync(projectId)
    const projectBytes = objectStatus.totalBytes
    const projectAutoCount = list.points.filter(point => point.source === 'ai_auto').length
    const projectManualCount = list.points.filter(point => ['manual', 'user_manual'].includes(point.source)).length
    projects.push({
      projectId,
      count: list.points.length,
      autoCount: projectAutoCount,
      manualCount: projectManualCount,
      bytes: projectBytes,
      objectCount: objectStatus.objectCount,
      referenceCount: objectStatus.referenceCount
    })
    totalCount += list.points.length
    autoCount += projectAutoCount
    manualCount += projectManualCount
    totalBytes += projectBytes
  }

  return {
    success: true,
    policy,
    totalBytes,
    totalCount,
    autoCount,
    manualCount,
    projectCount: projects.length,
    projects
  }
}

function deletePoint(projectId, pointId) {
  manifests.removeSync(projectId, pointId)
  objectStore.releaseOwner(projectId, 'recovery-point', pointId)
    .then(() => objectStore.garbageCollect(projectId))
    .catch(error => console.warn('[RecoveryPoints] 延迟回收对象失败:', error.message))
}

async function deletePointAsync(projectId, pointId) {
  await manifests.remove(projectId, pointId)
  await objectStore.releaseOwner(projectId, 'recovery-point', pointId)
  await objectStore.garbageCollect(projectId)
}

async function deleteRecoveryPoint(projectId, pointId) {
  const manifest = readManifest(projectId, pointId)
  if (!manifest) return { success: false, error: 'Recovery point not found' }
  await deletePointAsync(projectId, pointId)
  return { success: true, deleted: pointId }
}

function cleanupRecoveryPoints(projectId, options = {}) {
  const policy = storageConfig.getRecoveryPointConfig?.() || {}
  const maxAutoPoints = Number(options.maxAutoPoints) || Number(policy.maxAutoPoints) || DEFAULT_MAX_AUTO_POINTS
  const maxManualPoints = Number(options.maxManualPoints) || Number(policy.maxManualPoints) || DEFAULT_MAX_MANUAL_POINTS
  const list = listRecoveryPoints(projectId)
  if (!list.success) return list
  const deleted = retention.selectExpiredPoints(list.points, { ...options, maxAutoPoints, maxManualPoints })
  deleted.forEach(pointId => deletePoint(projectId, pointId))
  return { success: true, deleted }
}

async function cleanupRecoveryPointsAsync(projectId, options = {}) {
  const policy = storageConfig.getRecoveryPointConfig?.() || {}
  const maxAutoPoints = Number(options.maxAutoPoints) || Number(policy.maxAutoPoints) || DEFAULT_MAX_AUTO_POINTS
  const maxManualPoints = Number(options.maxManualPoints) || Number(policy.maxManualPoints) || DEFAULT_MAX_MANUAL_POINTS
  const list = await listRecoveryPointsAsync(projectId)
  const deleted = retention.selectExpiredPoints(list.points, { ...options, maxAutoPoints, maxManualPoints })
  for (const pointId of deleted) await deletePointAsync(projectId, pointId)
  const objectStatus = await objectStore.getStatus(projectId)
  return { success: true, deleted, totalBytes: objectStatus.totalBytes }
}

function cleanupAllRecoveryPoints(options = {}) {
  const ids = getKnownProjectIds()
  const results = []
  let deletedCount = 0

  for (const projectId of ids) {
    const result = cleanupRecoveryPoints(projectId, options)
    results.push({ projectId, ...result })
    deletedCount += result.deleted?.length || 0
  }

  const status = getRecoveryPointStatus(ids)
  return {
    success: true,
    deletedCount,
    results,
    status
  }
}

async function createFileRecoveryPoint(projectId, projectPath, options = {}) {
  if (!projectId) return { success: false, error: 'projectId is required' }
  if (!projectPath || !fs.existsSync(projectPath) || !fs.statSync(projectPath).isDirectory()) {
    return { success: false, error: 'projectPath is invalid' }
  }
  const policy = storageConfig.getRecoveryPointConfig?.() || {}
  const source = options.source || 'ai_auto'
  if (source === 'ai_auto' && policy.enabled === false) {
    return {
      success: false,
      kind: 'file-snapshot',
      skipped: true,
      disabled: true,
      reason: 'recovery_points_disabled'
    }
  }

  const warnings = []
  const snapshotOptions = {
    ...options,
    maxFileBytes: options.maxFileBytes || policy.maxFileBytes || DEFAULT_MAX_FILE_BYTES
  }
  const targets = await expandSnapshotTargetsAsync(projectPath, options.paths || [], warnings, snapshotOptions)
  if (targets.length === 0) {
    return {
      success: false,
      kind: 'file-snapshot',
      skipped: true,
      reason: 'no_snapshot_targets',
      warnings
    }
  }

  const pointId = options.id || makeId('rp')
  const createdAt = new Date().toISOString()

  const files = []
  try {
    for (const target of targets) {
      files.push(await writeFileSnapshotAsync(target, projectPath, warnings, {
        ...snapshotOptions,
        projectId,
        pointId,
        phase: options.phase || 'before'
      }))
    }
  } catch (error) {
    await objectStore.releaseOwner(projectId, 'recovery-point', pointId).catch(() => {})
    await objectStore.garbageCollect(projectId).catch(() => {})
    throw error
  }
  const totalBytes = files.reduce((sum, file) => sum + (file.skipped ? 0 : Number(file.size) || 0), 0)
  const manifest = {
    id: pointId,
    kind: 'file-snapshot',
    source,
    phase: options.phase || 'before',
    projectId,
    projectPath: path.resolve(projectPath),
    changeSessionId: options.changeSessionId || '',
    createdAt,
    message: options.message || '',
    metadata: options.metadata || {},
    files,
    fileCount: files.length,
    skippedFileCount: files.filter(file => file.skipped).length,
    totalBytes,
    warnings
  }

  try {
    await manifests.atomicWrite(projectId, manifest)
  } catch (error) {
    await objectStore.releaseOwner(projectId, 'recovery-point', pointId).catch(() => {})
    await objectStore.garbageCollect(projectId).catch(() => {})
    throw error
  }
  const cleanup = await cleanupRecoveryPointsAsync(projectId, options.retention || {}).catch(error => ({
    success: false,
    pending: true,
    error: error.message
  }))

  return {
    success: true,
    ...manifest,
    cleanup
  }
}

async function createAiTaskRecoveryPoint(projectId, projectPath, changeSessionId, options = {}) {
  const lockKey = `${projectId}:${changeSessionId}`
  if (aiTaskRecoveryLocks.has(lockKey)) return aiTaskRecoveryLocks.get(lockKey)
  const promise = aiTaskRecoveryPoints.create({
    projectId,
    projectPath,
    changeSessionId,
    recoveryOptions: options,
    listPoints: async () => (await listRecoveryPointsAsync(projectId)).points,
    cleanup: retentionOptions => cleanupRecoveryPointsAsync(projectId, retentionOptions),
    isPathInside
  })
  aiTaskRecoveryLocks.set(lockKey, promise)
  try {
    return await promise
  } finally {
    if (aiTaskRecoveryLocks.get(lockKey) === promise) aiTaskRecoveryLocks.delete(lockKey)
  }
}

async function createManualRecoveryPoint(projectId, projectPath, options = {}) {
  return createFileRecoveryPoint(projectId, projectPath, {
    ...options,
    source: 'manual',
    phase: 'manual',
    paths: options.paths?.length ? options.paths : ['.'],
    maxDirectoryFiles: options.maxDirectoryFiles || 2000,
    message: options.name || options.message || '',
    metadata: {
      ...(options.metadata || {}),
      name: options.name || '',
      description: options.description || ''
    }
  })
}

async function getCurrentFileState(filePath) {
  try {
    const stat = await fs.promises.stat(filePath)
    if (!stat.isFile()) return { exists: true, hash: null, unsupported: true }
    const buffer = await fs.promises.readFile(filePath)
    return { exists: true, hash: hashBuffer(buffer) }
  } catch (error) {
    if (error.code === 'ENOENT') return { exists: false, hash: null }
    throw error
  }
}

async function restoreRecoveryPoint(projectId, pointId, options = {}) {
  const manifest = readManifest(projectId, pointId)
  if (!manifest) return { success: false, error: 'Recovery point not found' }

  const projectPath = path.resolve(options.projectPath || manifest.projectPath || '')
  if (!projectPath || !fs.existsSync(projectPath)) return { success: false, error: 'Project path is unavailable' }

  const restored = []
  const skipped = []
  const requestedPaths = (Array.isArray(options.paths) ? options.paths : [])
    .map(item => path.resolve(projectPath, item))
  const selectedFiles = (manifest.files || []).filter(file => {
    if (!requestedPaths.length) return true
    const targetPath = path.resolve(projectPath, file.relativePath || '')
    return requestedPaths.some(requested => requested === targetPath)
  })

  const conflicts = []
  if (!options.force) {
    for (const file of selectedFiles) {
      if (file.expectedExists === undefined) continue
      const targetPath = path.resolve(projectPath, file.relativePath || '')
      const current = await getCurrentFileState(targetPath)
      if (current.exists !== file.expectedExists || (current.exists && file.expectedHash && current.hash !== file.expectedHash)) {
        conflicts.push({ path: targetPath, reason: 'modified_after_recovery_point' })
      }
    }
  }
  if (conflicts.length) return { success: false, conflict: true, conflicts }

  let transactionPoint = null
  if (options.transactionProtection !== false && selectedFiles.length) {
    transactionPoint = await createFileRecoveryPoint(projectId, projectPath, {
      phase: 'before_restore',
      source: 'restore_transaction',
      paths: selectedFiles.map(file => file.relativePath),
      message: `Restore protection for ${pointId}`,
      metadata: { restorePointId: pointId }
    }).catch(error => ({ success: false, error: error.message }))
  }

  for (const file of selectedFiles) {
    const targetPath = path.resolve(projectPath, file.relativePath || '')
    if (!isPathInside(projectPath, targetPath)) {
      skipped.push({ path: file.path, reason: 'outside_project' })
      continue
    }
    if (file.skipped) {
      skipped.push({ path: targetPath, reason: file.skipReason || 'snapshot_skipped' })
      continue
    }

    if (!file.existed) {
      if (fs.existsSync(targetPath)) {
        const stat = fs.statSync(targetPath)
        if (stat.isDirectory()) {
          const entries = fs.readdirSync(targetPath)
          if (entries.length === 0 || options.force) {
            fs.rmSync(targetPath, { recursive: true, force: true })
            restored.push({ path: targetPath, action: 'delete_directory' })
          } else {
            skipped.push({ path: targetPath, reason: 'directory_not_empty' })
          }
        } else {
          fs.unlinkSync(targetPath)
          restored.push({ path: targetPath, action: 'delete_file' })
        }
      }
      continue
    }

    if (file.type === 'directory') {
      fs.mkdirSync(targetPath, { recursive: true })
      restored.push({ path: targetPath, action: 'ensure_directory' })
      continue
    }

    let buffer
    if (file.objectHash) {
      try {
        buffer = await objectStore.readBuffer(projectId, file.objectHash)
      } catch (error) {
        skipped.push({ path: targetPath, reason: 'snapshot_missing', error: error.message })
        continue
      }
    } else {
      const pointDir = getPointDir(projectId, pointId)
      const snapshotPath = path.resolve(pointDir, file.snapshot || '')
      if (!isPathInside(pointDir, snapshotPath) || !fs.existsSync(snapshotPath)) {
        skipped.push({ path: targetPath, reason: 'snapshot_missing' })
        continue
      }
      buffer = await fs.promises.readFile(snapshotPath)
    }
    fs.mkdirSync(path.dirname(targetPath), { recursive: true })
    await fs.promises.writeFile(targetPath, buffer)
    restored.push({ path: targetPath, action: 'restore_file' })
  }

  const success = skipped.length === 0
  if (success && transactionPoint?.success) {
    await deletePointAsync(projectId, transactionPoint.id)
  }

  return {
    success,
    point: manifest,
    restored,
    skipped,
    partial: skipped.length > 0,
    transactionProtection: transactionPoint?.success
      ? { id: transactionPoint.id, retained: !success }
      : null
  }
}

function registerIPC(ipcMain) {
  ipcMain.handle('recovery-points-list', async (event, projectId) => listRecoveryPoints(projectId))
  ipcMain.handle('recovery-points-create-manual', async (event, projectId, projectPath, options = {}) => {
    try {
      return await createManualRecoveryPoint(projectId, projectPath, options)
    } catch (error) {
      return { success: false, error: error.message }
    }
  })
  ipcMain.handle('recovery-points-status', async () => getRecoveryPointStatus())
  ipcMain.handle('recovery-points-cleanup', async (event, options = {}) => {
    try {
      return cleanupAllRecoveryPoints(options)
    } catch (error) {
      return { success: false, error: error.message }
    }
  })
  ipcMain.handle('recovery-points-restore', async (event, projectId, pointId, options = {}) => {
    try {
      return await restoreRecoveryPoint(projectId, pointId, options)
    } catch (error) {
      return { success: false, error: error.message }
    }
  })
  ipcMain.handle('recovery-points-delete', async (event, projectId, pointId) => {
    try {
      return await deleteRecoveryPoint(projectId, pointId)
    } catch (error) {
      return { success: false, error: error.message }
    }
  })
}

module.exports = {
  createAiTaskRecoveryPoint,
  createFileRecoveryPoint,
  createManualRecoveryPoint,
  listRecoveryPoints,
  getRecoveryPointStatus,
  restoreRecoveryPoint,
  deleteRecoveryPoint,
  cleanupRecoveryPoints,
  cleanupAllRecoveryPoints,
  registerIPC,
  isPathInside
}
