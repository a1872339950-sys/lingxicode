const crypto = require('crypto')
const fs = require('fs')
const path = require('path')

const config = require('./config')
const storageConfig = require('./storage-config')

const INDEX_VERSION = 1
const DEFAULT_MAX_OBJECT_BYTES = 50 * 1024 * 1024
const DEFAULT_MAX_OWNER_BYTES = 512 * 1024 * 1024
const DEFAULT_MAX_PROJECT_BYTES = 5 * 1024 * 1024 * 1024
const indexLocks = new Map()

function sanitizeName(value) {
  return String(value || 'unknown').replace(/[<>:"/\\|?*]/g, '_')
}

function getProjectStorageDir(projectId) {
  const instance = config.getProjectInstance(projectId)
  if (instance?.storagePath) return instance.storagePath
  const basePath = storageConfig.getBasePath?.() || config.getLinguaBasePath?.() || config.getAppDataPath?.() || process.cwd()
  return path.join(basePath, 'projects', sanitizeName(projectId))
}

function getStorePaths(projectId) {
  const root = getProjectStorageDir(projectId)
  return {
    root,
    objectsDir: path.join(root, 'objects'),
    indexPath: path.join(root, 'indexes', 'content-objects.json')
  }
}

function hashBuffer(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex')
}

function assertHash(hash) {
  if (!/^[a-f0-9]{64}$/i.test(String(hash || ''))) throw new Error('Invalid content object hash')
}

function getObjectPath(projectId, hash) {
  assertHash(hash)
  const { objectsDir } = getStorePaths(projectId)
  return path.join(objectsDir, hash.slice(0, 2), hash)
}

function createReferenceId({ kind, ownerId, phase = '', filePath = '' }) {
  const pathDigest = crypto.createHash('sha256').update(path.resolve(String(filePath || '.'))).digest('hex').slice(0, 20)
  return `${sanitizeName(kind)}:${sanitizeName(ownerId)}:${sanitizeName(phase)}:${pathDigest}`
}

function emptyIndex(projectId) {
  return {
    version: INDEX_VERSION,
    projectId: String(projectId || ''),
    updatedAt: new Date().toISOString(),
    totalBytes: 0,
    objects: {},
    references: {}
  }
}

async function readIndex(projectId) {
  const { indexPath } = getStorePaths(projectId)
  try {
    const parsed = JSON.parse(await fs.promises.readFile(indexPath, 'utf-8'))
    if (!parsed || typeof parsed !== 'object' || parsed.version !== INDEX_VERSION) {
      throw new Error('Unsupported content object index version')
    }
    parsed.objects = parsed.objects && typeof parsed.objects === 'object' ? parsed.objects : {}
    parsed.references = parsed.references && typeof parsed.references === 'object' ? parsed.references : {}
    parsed.totalBytes = Number(parsed.totalBytes) || 0
    return parsed
  } catch (error) {
    if (error.code === 'ENOENT') return emptyIndex(projectId)
    throw error
  }
}

async function atomicWriteJson(filePath, value) {
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true })
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.${crypto.randomBytes(3).toString('hex')}.tmp`
  try {
    await fs.promises.writeFile(tempPath, JSON.stringify(value, null, 2), 'utf-8')
    await fs.promises.rename(tempPath, filePath)
  } finally {
    await fs.promises.rm(tempPath, { force: true }).catch(() => {})
  }
}

async function writeIndex(projectId, index) {
  index.updatedAt = new Date().toISOString()
  index.totalBytes = Object.values(index.objects).reduce((sum, item) => sum + (Number(item.size) || 0), 0)
  await atomicWriteJson(getStorePaths(projectId).indexPath, index)
}

async function withIndexLock(projectId, operation) {
  const key = String(projectId || '')
  const previous = indexLocks.get(key) || Promise.resolve()
  const current = previous.catch(() => {}).then(operation)
  indexLocks.set(key, current)
  try {
    return await current
  } finally {
    if (indexLocks.get(key) === current) indexLocks.delete(key)
  }
}

function getLimits(options = {}) {
  const policy = storageConfig.getRecoveryPointConfig?.() || {}
  return {
    maxObjectBytes: Number(options.maxObjectBytes) || Number(policy.maxObjectBytes) || Number(policy.maxFileBytes) || DEFAULT_MAX_OBJECT_BYTES,
    maxOwnerBytes: Number(options.maxOwnerBytes) || Number(policy.maxOwnerBytes) || Number(policy.maxTaskBytes) || DEFAULT_MAX_OWNER_BYTES,
    maxProjectBytes: Number(options.maxProjectBytes) || Number(policy.maxProjectBytes) || DEFAULT_MAX_PROJECT_BYTES
  }
}

function getOwnerBytesAfterReference(index, reference, nextHash, nextSize) {
  if (!reference) return 0
  const ownerReferences = Object.values(index.references).filter(item => (
    item.kind === String(reference.kind) && item.ownerId === String(reference.ownerId) && item.id !== reference.id
  ))
  const hashes = new Set(ownerReferences.map(item => item.hash).filter(Boolean))
  hashes.add(nextHash)
  return [...hashes].reduce((sum, objectHash) => {
    if (objectHash === nextHash && !index.objects[objectHash]) return sum + nextSize
    return sum + (Number(index.objects[objectHash]?.size) || 0)
  }, 0)
}

async function writeObjectIfMissing(projectId, hash, buffer) {
  const objectPath = getObjectPath(projectId, hash)
  if (await fs.promises.stat(objectPath).then(stat => stat.isFile()).catch(() => false)) return false
  await fs.promises.mkdir(path.dirname(objectPath), { recursive: true })
  const tempPath = `${objectPath}.${process.pid}.${Date.now()}.tmp`
  await fs.promises.writeFile(tempPath, buffer, { flag: 'wx' })
  try {
    await fs.promises.rename(tempPath, objectPath)
    return true
  } catch (error) {
    const exists = await fs.promises.stat(objectPath).then(stat => stat.isFile()).catch(() => false)
    if (!exists) throw error
    return false
  } finally {
    await fs.promises.rm(tempPath, { force: true }).catch(() => {})
  }
}

function normalizeReference(reference, hash) {
  if (!reference) return null
  const id = reference.id || createReferenceId(reference)
  if (!id || !reference.kind || !reference.ownerId) throw new Error('Content object reference requires kind and ownerId')
  return {
    id,
    hash,
    kind: String(reference.kind),
    ownerId: String(reference.ownerId),
    phase: String(reference.phase || ''),
    path: String(reference.filePath || reference.path || ''),
    createdAt: reference.createdAt || new Date().toISOString()
  }
}

async function putBuffer(projectId, value, options = {}) {
  if (!projectId) throw new Error('projectId is required')
  const buffer = Buffer.isBuffer(value) ? value : Buffer.from(value)
  const hash = hashBuffer(buffer)
  const limits = getLimits(options)
  if (buffer.length > limits.maxObjectBytes) {
    const error = new Error(`Content object exceeds ${limits.maxObjectBytes} byte limit`)
    error.code = 'CONTENT_OBJECT_TOO_LARGE'
    throw error
  }

  return withIndexLock(projectId, async () => {
    const index = await readIndex(projectId)
    const existing = index.objects[hash]
    if (!existing && index.totalBytes + buffer.length > limits.maxProjectBytes) {
      const error = new Error(`Project content object quota exceeds ${limits.maxProjectBytes} bytes`)
      error.code = 'CONTENT_OBJECT_PROJECT_QUOTA'
      throw error
    }
    const pendingReference = normalizeReference(options.reference, hash)
    if (pendingReference) {
      const ownerBytes = getOwnerBytesAfterReference(index, pendingReference, hash, buffer.length)
      if (ownerBytes > limits.maxOwnerBytes) {
        const error = new Error(`Content object owner quota exceeds ${limits.maxOwnerBytes} bytes`)
        error.code = 'CONTENT_OBJECT_OWNER_QUOTA'
        throw error
      }
    }

    let objectCreated = false
    let indexCommitted = false
    try {
      objectCreated = await writeObjectIfMissing(projectId, hash, buffer)
      if (!index.objects[hash]) {
        index.objects[hash] = {
          hash,
          size: buffer.length,
          createdAt: new Date().toISOString(),
          lastReferencedAt: null
        }
      }
      const reference = pendingReference
      let staleObjectHash = ''
      if (reference) {
        const previous = index.references[reference.id]
        if (previous && previous.hash !== hash) {
          index.objects[previous.hash] && (index.objects[previous.hash].lastReferencedAt = new Date().toISOString())
        }
        index.references[reference.id] = reference
        index.objects[hash].lastReferencedAt = new Date().toISOString()
        if (previous && previous.hash !== hash) {
          const stillReferenced = Object.values(index.references).some(item => item.hash === previous.hash)
          if (!stillReferenced && index.objects[previous.hash]) staleObjectHash = previous.hash
        }
      }
      await writeIndex(projectId, index)
      indexCommitted = true
      if (staleObjectHash) {
        try {
          await fs.promises.rm(getObjectPath(projectId, staleObjectHash), { force: true })
          delete index.objects[staleObjectHash]
          await writeIndex(projectId, index)
        } catch (error) {
          console.warn('[ContentObjectStore] deferred stale object cleanup:', error.message)
        }
      }
      return { hash, size: buffer.length, created: objectCreated, referenceId: reference?.id || '' }
    } catch (error) {
      if (objectCreated && !indexCommitted) await fs.promises.rm(getObjectPath(projectId, hash), { force: true }).catch(() => {})
      throw error
    }
  })
}

async function addReference(projectId, hash, reference) {
  assertHash(hash)
  return withIndexLock(projectId, async () => {
    const index = await readIndex(projectId)
    if (!index.objects[hash] || !await fs.promises.stat(getObjectPath(projectId, hash)).then(stat => stat.isFile()).catch(() => false)) {
      throw new Error(`Content object not found: ${hash}`)
    }
    const normalized = normalizeReference(reference, hash)
    index.references[normalized.id] = normalized
    index.objects[hash].lastReferencedAt = new Date().toISOString()
    await writeIndex(projectId, index)
    return normalized
  })
}

async function releaseReferences(projectId, predicate) {
  return withIndexLock(projectId, async () => {
    const index = await readIndex(projectId)
    const removed = []
    for (const [id, reference] of Object.entries(index.references)) {
      if (predicate(reference)) {
        delete index.references[id]
        removed.push(reference)
      }
    }
    await writeIndex(projectId, index)
    return removed
  })
}

async function releaseOwner(projectId, kind, ownerId) {
  return releaseReferences(projectId, reference => reference.kind === kind && reference.ownerId === String(ownerId))
}

async function garbageCollect(projectId) {
  return withIndexLock(projectId, async () => {
    const index = await readIndex(projectId)
    const referenced = new Set(Object.values(index.references).map(reference => reference.hash))
    const deleted = []
    let reclaimedBytes = 0
    for (const [hash, object] of Object.entries(index.objects)) {
      if (referenced.has(hash)) continue
      await fs.promises.rm(getObjectPath(projectId, hash), { force: true })
      reclaimedBytes += Number(object.size) || 0
      deleted.push(hash)
      delete index.objects[hash]
    }
    if (deleted.length) await writeIndex(projectId, index)
    return { success: true, deleted, reclaimedBytes, totalBytes: index.totalBytes }
  })
}

async function getStatus(projectId) {
  const index = await readIndex(projectId)
  return {
    success: true,
    projectId,
    objectCount: Object.keys(index.objects).length,
    referenceCount: Object.keys(index.references).length,
    totalBytes: index.totalBytes,
    updatedAt: index.updatedAt
  }
}

function getStatusSync(projectId) {
  const { indexPath } = getStorePaths(projectId)
  try {
    const index = JSON.parse(fs.readFileSync(indexPath, 'utf-8'))
    return {
      success: true,
      projectId,
      objectCount: Object.keys(index.objects || {}).length,
      referenceCount: Object.keys(index.references || {}).length,
      totalBytes: Number(index.totalBytes) || 0,
      updatedAt: index.updatedAt || null
    }
  } catch (error) {
    if (error.code === 'ENOENT') {
      return { success: true, projectId, objectCount: 0, referenceCount: 0, totalBytes: 0, updatedAt: null }
    }
    return { success: false, projectId, objectCount: 0, referenceCount: 0, totalBytes: 0, error: error.message }
  }
}

async function readBuffer(projectId, hash) {
  const buffer = await fs.promises.readFile(getObjectPath(projectId, hash))
  if (hashBuffer(buffer) !== hash) throw new Error(`Content object checksum mismatch: ${hash}`)
  return buffer
}

function readBufferSync(projectId, hash) {
  const buffer = fs.readFileSync(getObjectPath(projectId, hash))
  if (hashBuffer(buffer) !== hash) throw new Error(`Content object checksum mismatch: ${hash}`)
  return buffer
}

module.exports = {
  addReference,
  createReferenceId,
  garbageCollect,
  getObjectPath,
  getStatus,
  getStatusSync,
  putBuffer,
  readBuffer,
  readBufferSync,
  releaseOwner,
  releaseReferences
}
