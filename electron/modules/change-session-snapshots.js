const fs = require('fs')

const objectStore = require('./content-object-store')

function buildReference(session, filePath, phase) {
  return {
    kind: 'change-session',
    ownerId: session.id,
    phase,
    filePath
  }
}

async function captureTextFile(session, filePath, phase) {
  let stat
  try {
    stat = await fs.promises.stat(filePath)
  } catch (error) {
    if (error.code === 'ENOENT') return { exists: false, content: null, hash: null, objectHash: null, size: 0, mtimeMs: null }
    throw error
  }
  if (!stat.isFile()) {
    return { exists: true, content: null, hash: null, objectHash: null, size: stat.size, mtimeMs: stat.mtimeMs, unsupported: true }
  }

  const buffer = await fs.promises.readFile(filePath)
  if (buffer.includes(0)) {
    return { exists: true, content: null, hash: null, objectHash: null, size: stat.size, mtimeMs: stat.mtimeMs, unsupported: true }
  }

  try {
    const stored = await objectStore.putBuffer(session.projectId, buffer, {
      reference: buildReference(session, filePath, phase)
    })
    return {
      exists: true,
      content: null,
      hash: stored.hash,
      objectHash: stored.hash,
      contentAddressed: true,
      size: stat.size,
      mtimeMs: stat.mtimeMs
    }
  } catch (error) {
    if (!['CONTENT_OBJECT_TOO_LARGE', 'CONTENT_OBJECT_OWNER_QUOTA', 'CONTENT_OBJECT_PROJECT_QUOTA'].includes(error.code)) throw error
    return {
      exists: true,
      content: null,
      hash: null,
      objectHash: null,
      size: stat.size,
      mtimeMs: stat.mtimeMs,
      unsupported: true,
      unsupportedReason: error.code
    }
  }
}

function readStoredText(session, file, phase, readLegacySnapshot) {
  const inlineKey = phase === 'before' ? 'beforeContent' : 'afterContent'
  const objectKey = phase === 'before' ? 'beforeObjectHash' : 'afterObjectHash'
  const legacyRefKey = phase === 'before' ? 'beforeSnapshotRef' : 'afterSnapshotRef'
  if (file?.[inlineKey] !== null && file?.[inlineKey] !== undefined) return file[inlineKey]
  if (file?.[objectKey]) return objectStore.readBufferSync(session.projectId, file[objectKey]).toString('utf-8')
  return readLegacySnapshot(file?.[legacyRefKey])
}

async function releaseFile(session, filePath) {
  const normalized = String(filePath || '')
  return objectStore.releaseReferences(session.projectId, reference => (
    reference.kind === 'change-session' &&
    reference.ownerId === String(session.id) &&
    reference.path === normalized
  ))
}

module.exports = { captureTextFile, readStoredText, releaseFile }
