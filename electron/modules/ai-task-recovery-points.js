const crypto = require('crypto')
const path = require('path')

const objectStore = require('./content-object-store')
const manifests = require('./recovery-point-manifests')

function makeId() {
  return `ai-rp-${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}`
}

async function create(options) {
  const {
    projectId,
    projectPath,
    changeSessionId,
    recoveryOptions = {},
    listPoints,
    cleanup,
    isPathInside
  } = options
  if (!projectId || !changeSessionId) return { success: false, error: 'projectId and changeSessionId are required' }

  const existing = (await listPoints()).find(point => (
    point.source === 'ai_auto' && point.changeSessionId === changeSessionId
  ))
  if (existing) return { success: true, ...existing, reused: true }

  const changeSessions = require('./change-sessions')
  const snapshot = changeSessions.getRecoverySnapshot(projectId, changeSessionId)
  if (!snapshot) return { success: false, error: 'Change session not found' }
  const changedFiles = snapshot.files.filter(file => (
    file.existedBefore !== file.existsAfter || file.beforeHash !== file.afterHash
  ))
  if (!changedFiles.length) return { success: false, skipped: true, reason: 'no_changed_files' }

  const pointId = recoveryOptions.id || makeId()
  const warnings = []
  const files = []
  try {
    for (const file of changedFiles) {
      const targetPath = path.resolve(file.path)
      if (!isPathInside(projectPath, targetPath)) {
        warnings.push({ path: file.path, reason: 'outside_project' })
        continue
      }
      const item = {
        path: targetPath,
        relativePath: path.relative(path.resolve(projectPath), targetPath).replace(/\\/g, '/'),
        existed: !!file.existedBefore,
        type: file.existedBefore ? 'file' : 'missing',
        size: Number(file.beforeSize) || 0,
        mtimeMs: file.beforeMtimeMs ?? null,
        hash: file.beforeHash || null,
        expectedExists: !!file.existsAfter,
        expectedHash: file.afterHash || null
      }
      if (file.beforeUnsupported || file.afterUnsupported) {
        item.skipped = true
        item.skipReason = 'unsupported_file'
        warnings.push({ path: targetPath, reason: item.skipReason })
      } else if (file.existedBefore) {
        if (file.beforeObjectHash) {
          await objectStore.addReference(projectId, file.beforeObjectHash, {
            kind: 'recovery-point', ownerId: pointId, phase: 'before', filePath: targetPath
          })
          item.objectHash = file.beforeObjectHash
        } else if (file.beforeContent !== null && file.beforeContent !== undefined) {
          const stored = await objectStore.putBuffer(projectId, Buffer.from(file.beforeContent, 'utf-8'), {
            reference: { kind: 'recovery-point', ownerId: pointId, phase: 'before', filePath: targetPath }
          })
          item.objectHash = stored.hash
        } else {
          item.skipped = true
          item.skipReason = 'snapshot_missing'
          warnings.push({ path: targetPath, reason: item.skipReason })
        }
      }
      files.push(item)
    }

    if (!files.some(file => !file.skipped)) {
      await objectStore.releaseOwner(projectId, 'recovery-point', pointId)
      await objectStore.garbageCollect(projectId)
      return { success: false, skipped: true, reason: 'no_recoverable_files', warnings }
    }

    const manifest = {
      id: pointId,
      kind: 'file-snapshot',
      source: 'ai_auto',
      phase: 'task',
      projectId,
      projectPath: path.resolve(projectPath),
      changeSessionId,
      createdAt: new Date().toISOString(),
      message: recoveryOptions.message || '',
      metadata: { ...(recoveryOptions.metadata || {}), taskStatus: snapshot.status },
      files,
      fileCount: files.length,
      skippedFileCount: files.filter(file => file.skipped).length,
      totalBytes: files.reduce((sum, file) => sum + (file.skipped ? 0 : Number(file.size) || 0), 0),
      warnings
    }
    await manifests.atomicWrite(projectId, manifest)
    const cleanupResult = await cleanup(recoveryOptions.retention || {}).catch(error => ({
      success: false,
      pending: true,
      error: error.message
    }))
    return { success: true, ...manifest, cleanup: cleanupResult }
  } catch (error) {
    await manifests.remove(projectId, pointId).catch(() => {})
    await objectStore.releaseOwner(projectId, 'recovery-point', pointId).catch(() => {})
    await objectStore.garbageCollect(projectId).catch(() => {})
    throw error
  }
}

module.exports = { create }
