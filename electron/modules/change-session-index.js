const fs = require('fs')
const path = require('path')

const VERSION = 1
const caches = new Map()

function atomicWrite(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`
  fs.writeFileSync(tempPath, JSON.stringify(value, null, 2), 'utf8')
  fs.renameSync(tempPath, filePath)
}

function metadataFromSession(session = {}, fallbackId = '') {
  return {
    id: String(session.id || fallbackId),
    status: String(session.status || ''),
    startedAt: String(session.startedAt || ''),
    finalizedAt: String(session.finalizedAt || ''),
    fileCount: Number.isFinite(Number(session.fileCount))
      ? Math.max(0, Number(session.fileCount))
      : (Array.isArray(session.fileOrder) ? session.fileOrder.length : Object.keys(session.files || {}).length),
    commandCount: Number.isFinite(Number(session.commandCount))
      ? Math.max(0, Number(session.commandCount))
      : (Array.isArray(session.commands) ? session.commands.length : 0)
  }
}

function rebuild(indexPath, sessionDir) {
  const items = fs.readdirSync(sessionDir, { withFileTypes: true })
    .filter(entry => entry.isFile() && entry.name.endsWith('.json') && path.resolve(path.join(sessionDir, entry.name)) !== path.resolve(indexPath))
    .map(entry => {
      try {
        const session = JSON.parse(fs.readFileSync(path.join(sessionDir, entry.name), 'utf8'))
        return session?.id ? metadataFromSession(session, entry.name.replace(/\.json$/i, '')) : null
      } catch {
        return null
      }
    })
    .filter(Boolean)
  const index = { version: VERSION, items, rebuiltAt: new Date().toISOString() }
  caches.set(path.resolve(indexPath), index)
  atomicWrite(indexPath, index)
  return index
}

function load(indexPath, sessionDir) {
  const key = path.resolve(indexPath)
  if (caches.has(key)) return caches.get(key)
  try {
    const parsed = JSON.parse(fs.readFileSync(indexPath, 'utf8'))
    if (parsed?.version === VERSION && Array.isArray(parsed.items)) {
      caches.set(key, parsed)
      return parsed
    }
  } catch {}
  fs.mkdirSync(sessionDir, { recursive: true })
  return rebuild(indexPath, sessionDir)
}

function list(indexPath, sessionDir) {
  return load(indexPath, sessionDir).items.slice().sort((a, b) => {
    return String(b.finalizedAt || b.startedAt).localeCompare(String(a.finalizedAt || a.startedAt))
  })
}

function upsert(indexPath, sessionDir, session) {
  const index = load(indexPath, sessionDir)
  const metadata = metadataFromSession(session)
  const position = index.items.findIndex(item => item.id === metadata.id)
  if (position >= 0) index.items[position] = metadata
  else index.items.push(metadata)
  atomicWrite(indexPath, index)
  return metadata
}

function remove(indexPath, sessionDir, sessionId) {
  const index = load(indexPath, sessionDir)
  index.items = index.items.filter(item => item.id !== sessionId)
  atomicWrite(indexPath, index)
}

function invalidate(indexPath) {
  if (indexPath) caches.delete(path.resolve(indexPath))
  else caches.clear()
}

module.exports = { invalidate, list, metadataFromSession, rebuild, remove, upsert }
