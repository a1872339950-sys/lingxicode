const crypto = require('crypto')
const fs = require('fs')
const path = require('path')

const config = require('./config')
const storageConfig = require('./storage-config')

function sanitizeName(value) {
  return String(value || 'unknown').replace(/[<>:"/\\|?*]/g, '_')
}

function getBaseDir(projectId) {
  const instance = config.getProjectInstance(projectId)
  if (instance?.storagePath) return path.join(instance.storagePath, 'recovery-points')
  const basePath = storageConfig.getBasePath?.() || config.getLinguaBasePath?.() || config.getAppDataPath?.() || process.cwd()
  return path.join(basePath, 'recovery-points', sanitizeName(projectId))
}

function getManifestPath(projectId, pointId) {
  return path.join(getBaseDir(projectId), `${sanitizeName(pointId)}.json`)
}

function getLegacyPointDir(projectId, pointId) {
  return path.join(getBaseDir(projectId), sanitizeName(pointId))
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'))
  } catch {
    return null
  }
}

function read(projectId, pointId) {
  return readJson(getManifestPath(projectId, pointId)) || readJson(path.join(getLegacyPointDir(projectId, pointId), 'manifest.json'))
}

async function readJsonAsync(filePath) {
  try {
    return JSON.parse(await fs.promises.readFile(filePath, 'utf-8'))
  } catch {
    return null
  }
}

function list(projectId) {
  const baseDir = getBaseDir(projectId)
  if (!fs.existsSync(baseDir)) return []
  const points = fs.readdirSync(baseDir, { withFileTypes: true }).map(entry => {
    if (entry.isFile() && entry.name.endsWith('.json')) return readJson(path.join(baseDir, entry.name))
    if (entry.isDirectory()) return readJson(path.join(baseDir, entry.name, 'manifest.json'))
    return null
  }).filter(Boolean)
  return [...new Map(points.map(point => [point.id, point])).values()]
    .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))
}

async function listAsync(projectId) {
  const baseDir = getBaseDir(projectId)
  const entries = await fs.promises.readdir(baseDir, { withFileTypes: true }).catch(() => [])
  const points = (await Promise.all(entries.map(entry => {
    if (entry.isFile() && entry.name.endsWith('.json')) return readJsonAsync(path.join(baseDir, entry.name))
    if (entry.isDirectory()) return readJsonAsync(path.join(baseDir, entry.name, 'manifest.json'))
    return null
  }))).filter(Boolean)
  return [...new Map(points.map(point => [point.id, point])).values()]
    .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))
}

async function atomicWrite(projectId, manifest) {
  const filePath = getManifestPath(projectId, manifest.id)
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true })
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.${crypto.randomBytes(3).toString('hex')}.tmp`
  try {
    await fs.promises.writeFile(tempPath, JSON.stringify(manifest, null, 2), 'utf-8')
    await fs.promises.rename(tempPath, filePath)
  } finally {
    await fs.promises.rm(tempPath, { force: true }).catch(() => {})
  }
}

async function remove(projectId, pointId) {
  await fs.promises.rm(getManifestPath(projectId, pointId), { force: true })
  await fs.promises.rm(getLegacyPointDir(projectId, pointId), { recursive: true, force: true })
}

function removeSync(projectId, pointId) {
  fs.rmSync(getManifestPath(projectId, pointId), { force: true })
  fs.rmSync(getLegacyPointDir(projectId, pointId), { recursive: true, force: true })
}

module.exports = {
  atomicWrite,
  getBaseDir,
  getLegacyPointDir,
  getManifestPath,
  list,
  listAsync,
  read,
  remove,
  removeSync
}
