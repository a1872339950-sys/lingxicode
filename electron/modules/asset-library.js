const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { shell } = require('electron')
const storageConfig = require('./storage-config')

const VERSION = 1
const LIBRARY_DIR = 'library'
const INDEX_FILE = 'asset-index.json'
const MAX_RECORDS = 2000

const EXTENSION_TYPES = {
  image: new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp', '.ico', '.avif', '.svg']),
  video: new Set(['.mp4', '.webm', '.mov', '.mkv', '.avi']),
  audio: new Set(['.mp3', '.wav', '.m4a', '.aac', '.ogg', '.flac']),
  document: new Set(['.md', '.txt', '.pdf', '.doc', '.docx']),
  presentation: new Set(['.ppt', '.pptx']),
  spreadsheet: new Set(['.xls', '.xlsx', '.csv']),
  model3d: new Set(['.glb', '.gltf', '.blend', '.fbx', '.obj']),
  code: new Set(['.html', '.css', '.js', '.ts', '.json'])
}

function nowIso() {
  return new Date().toISOString()
}

function shortHash(value = '') {
  return crypto.createHash('sha1').update(String(value || ''), 'utf8').digest('hex').slice(0, 12)
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

function readJson(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return fallback
    return JSON.parse(fs.readFileSync(filePath, 'utf8'))
  } catch {
    return fallback
  }
}

function writeJson(filePath, data) {
  ensureDir(path.dirname(filePath))
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8')
}

function getRootDir(options = {}) {
  if (options.rootDir) return path.resolve(options.rootDir)
  const base = options.baseDir || storageConfig.getAssetsDir?.() || path.join(storageConfig.getBasePath?.() || process.cwd(), 'assets')
  return path.join(path.resolve(base), LIBRARY_DIR)
}

function getIndexPath(options = {}) {
  return path.join(getRootDir(options), INDEX_FILE)
}

function normalizePath(value = '') {
  if (!value) return ''
  try {
    return path.resolve(String(value))
  } catch {
    return String(value)
  }
}

function inferType(filePath = '', fallback = '') {
  const explicit = String(fallback || '').toLowerCase()
  if (explicit) {
    if (explicit === 'generated_image' || explicit === 'screenshot') return 'image'
    if (explicit === 'generated_music' || explicit === 'audio') return 'audio'
    if (explicit === 'generated_video' || explicit === 'video') return 'video'
    if (explicit.includes('ppt') || explicit.includes('presentation')) return 'presentation'
    if (explicit.includes('blender') || explicit.includes('3d') || explicit.includes('model')) return 'model3d'
    if (explicit.includes('design')) return 'design_style'
    if (explicit.includes('artifact') || explicit.includes('detail')) return 'document'
  }
  const ext = path.extname(String(filePath || '')).toLowerCase()
  for (const [type, set] of Object.entries(EXTENSION_TYPES)) {
    if (set.has(ext)) return type
  }
  return ext ? 'file' : 'asset'
}

function safeStat(filePath = '') {
  try {
    if (!filePath || !fs.existsSync(filePath)) return null
    const stat = fs.statSync(filePath)
    return {
      exists: true,
      size: stat.size,
      mtimeMs: stat.mtimeMs,
      isFile: stat.isFile(),
      isDirectory: stat.isDirectory()
    }
  } catch {
    return null
  }
}

function refreshRecordAvailability(record = {}) {
  const stat = safeStat(record.path)
  return {
    ...record,
    exists: Boolean(stat?.isFile),
    size: stat?.isFile ? stat.size : (record.size || 0)
  }
}

function loadIndex(options = {}) {
  const data = readJson(getIndexPath(options), { version: VERSION, updatedAt: null, records: [] }) || {}
  return {
    version: VERSION,
    updatedAt: data.updatedAt || null,
    records: Array.isArray(data.records) ? data.records : []
  }
}

function saveIndex(index, options = {}) {
  const next = {
    version: VERSION,
    updatedAt: nowIso(),
    records: Array.isArray(index?.records) ? index.records.slice(0, MAX_RECORDS) : []
  }
  writeJson(getIndexPath(options), next)
  return next
}

function buildRecord(input = {}) {
  const filePath = normalizePath(input.path || input.filePath || input.outputPath || '')
  const stat = safeStat(filePath)
  const type = inferType(filePath, input.type || input.kind || input.file_type)
  const idBasis = filePath || `${input.sourceTool || 'asset'}:${input.title || ''}:${input.createdAt || ''}`
  const createdAt = input.createdAt || nowIso()
  return {
    version: VERSION,
    id: input.id || `asset-${type}-${shortHash(idBasis)}`,
    type,
    kind: input.kind || input.file_type || type,
    title: input.title || path.basename(filePath) || `${type} asset`,
    path: filePath,
    sourceTool: input.sourceTool || '',
    source: input.source || 'tool_result',
    projectId: input.projectId || '',
    projectPath: input.projectPath || '',
    prompt: input.prompt ? String(input.prompt).slice(0, 2000) : '',
    modelName: input.modelName || '',
    providerModelName: input.providerModelName || '',
    format: input.format || path.extname(filePath).replace(/^\./, '').toLowerCase(),
    width: input.width || null,
    height: input.height || null,
    duration: input.duration || null,
    metadata: input.metadata || {},
    exists: stat ? stat.exists : false,
    size: stat?.size || input.size || 0,
    createdAt,
    updatedAt: input.updatedAt || createdAt,
    lastSeenAt: nowIso()
  }
}

function upsertAsset(input = {}, options = {}) {
  const record = buildRecord(input)
  if (!record.path && !record.title) return { success: false, skipped: true, reason: 'missing asset identity' }
  const index = loadIndex(options)
  const existingIndex = index.records.findIndex(item => item.id === record.id || (item.path && record.path && item.path === record.path))
  if (existingIndex >= 0) {
    const previous = index.records[existingIndex]
    index.records.splice(existingIndex, 1)
    index.records.unshift({
      ...previous,
      ...record,
      createdAt: previous.createdAt || record.createdAt,
      updatedAt: nowIso()
    })
  } else {
    index.records.unshift(record)
  }
  saveIndex(index, options)
  return { success: true, record }
}

function isAssetFile(filePath = '') {
  const ext = path.extname(filePath).toLowerCase()
  if (!ext) return false
  return Object.values(EXTENSION_TYPES).some(set => set.has(ext))
}

function walkFiles(root = '', options = {}, out = []) {
  const maxFiles = Number(options.maxFiles || 800)
  const maxDepth = Number(options.maxDepth || 4)
  function visit(dir, depth) {
    if (!dir || out.length >= maxFiles || depth > maxDepth) return
    let entries = []
    try {
      if (!fs.existsSync(dir)) return
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (out.length >= maxFiles) break
      if (entry.name === LIBRARY_DIR || entry.name === 'node_modules' || entry.name === '.git') continue
      const filePath = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        visit(filePath, depth + 1)
      } else if (entry.isFile() && isAssetFile(filePath)) {
        out.push(filePath)
      }
    }
  }
  visit(root, 0)
  return out
}

function discoverKnownAssets(options = {}) {
  const roots = []
  if (options.storageBaseDir) {
    const baseDir = path.resolve(options.storageBaseDir)
    roots.push(path.join(baseDir, 'cache', 'generated-images'))
    roots.push(path.join(baseDir, 'cache', 'generated-media'))
    roots.push(path.join(baseDir, 'cache', 'screenshots'))
    roots.push(path.join(baseDir, 'cache', 'website-research'))
    roots.push(path.join(baseDir, 'design-styles', 'styles'))
    roots.push(path.join(baseDir, 'artifacts'))
  }
  try {
    const cacheDir = storageConfig.getCacheDir?.()
    if (cacheDir) {
      roots.push(path.join(cacheDir, 'generated-images'))
      roots.push(path.join(cacheDir, 'generated-media'))
      roots.push(path.join(cacheDir, 'screenshots'))
      roots.push(path.join(cacheDir, 'website-research'))
    }
  } catch {
    // ignore uninitialized storage
  }
  try {
    const baseDir = storageConfig.getBasePath?.()
    if (baseDir) {
      roots.push(path.join(baseDir, 'design-styles', 'styles'))
    }
  } catch {
    // ignore uninitialized storage
  }
  try {
    const artifactsDir = storageConfig.getArtifactsDir?.()
    if (artifactsDir) roots.push(artifactsDir)
  } catch {
    // ignore uninitialized storage
  }

  const files = []
  for (const root of roots) walkFiles(root, { maxFiles: 300, maxDepth: 4 }, files)
  return files.map(filePath => {
    const parent = path.basename(path.dirname(filePath)).toLowerCase()
    const base = path.basename(filePath)
    let sourceTool = 'discovered_storage'
    let kind = ''
    if (/generated-images/i.test(filePath) || /^generated-image-/i.test(base)) {
      sourceTool = 'generate_image'
      kind = 'generated_image'
    } else if (/generated-media[\\/]+music/i.test(filePath) || /^generated-music-/i.test(base)) {
      sourceTool = 'generate_music'
      kind = 'generated_music'
    } else if (/generated-media[\\/]+video/i.test(filePath) || /^generated-video-/i.test(base)) {
      sourceTool = 'generate_video'
      kind = 'generated_video'
    } else if (/screenshots/i.test(filePath)) {
      sourceTool = 'capture_screenshot'
      kind = 'screenshot'
    } else if (/design-styles/i.test(filePath)) {
      sourceTool = 'research_website_runtime'
      kind = 'website_design_style'
    } else if (/artifacts/i.test(filePath) || parent === 'artifacts') {
      sourceTool = 'final_reply_artifact'
      kind = 'artifact'
    }
    return buildRecord({
      path: filePath,
      sourceTool,
      source: 'discovered_storage',
      kind,
      title: base
    })
  })
}

function refreshDiscoveredAssets(options = {}) {
  const discovered = discoverKnownAssets(options)
  if (!discovered.length) return { success: true, count: 0 }
  const index = loadIndex(options)
  const byKey = new Map()
  for (const record of index.records) {
    byKey.set(record.path || record.id, record)
  }
  for (const record of discovered) {
    const key = record.path || record.id
    const previous = byKey.get(key)
    byKey.set(key, previous ? {
      ...previous,
      exists: record.exists,
      size: record.size,
      lastSeenAt: nowIso()
    } : record)
  }
  const records = Array.from(byKey.values())
    .sort((a, b) => String(b.updatedAt || b.createdAt || '').localeCompare(String(a.updatedAt || a.createdAt || '')))
    .slice(0, MAX_RECORDS)
  saveIndex({ records }, options)
  return { success: true, count: discovered.length }
}

function collectPathCandidates(value, out = [], seen = new Set()) {
  if (!value || out.length >= 24) return out
  if (typeof value === 'string') {
    const text = value.trim()
    if (
      text &&
      /[\\/]/.test(text) &&
      /\.(png|jpe?g|webp|gif|svg|mp3|wav|m4a|aac|mp4|webm|mov|pptx?|pdf|docx?|xlsx?|csv|md|txt|html|css|js|json|glb|gltf|blend)$/i.test(text) &&
      !seen.has(text)
    ) {
      seen.add(text)
      out.push({ path: text })
    }
    return out
  }
  if (Array.isArray(value)) {
    for (const item of value) collectPathCandidates(item, out, seen)
    return out
  }
  if (typeof value !== 'object') return out
  const keys = ['path', 'filePath', 'outputPath', 'previewPath', 'reportPath', 'markdownPath', 'jsonPath', 'glbPath', 'blendPath', 'pptPath']
  for (const key of keys) {
    if (typeof value[key] === 'string') {
      const p = value[key].trim()
      if (p && !seen.has(p)) {
        seen.add(p)
        out.push({ path: p, key, sourceObject: value })
      }
    }
  }
  for (const key of ['screenshots', 'assets', 'files', 'outputs', 'steps', 'result', 'results', 'designStyleMemory']) {
    if (value[key]) collectPathCandidates(value[key], out, seen)
  }
  return out
}

const ASSET_PRODUCER_TOOLS = new Set([
  'generate_image',
  'generate_music',
  'generate_video',
  'text_to_speech',
  'capture_screenshot',
  'render_svg_asset',
  'media_process',
  'artifact_workflow',
  'office_workflow',
  'office_from_template',
  'research_website_runtime',
  'website_research'
])

function shouldRegisterTool(toolName = '', result = {}) {
  if (!result || result.success === false) return false
  const normalizedTool = String(toolName || '').trim().toLowerCase()
  if (ASSET_PRODUCER_TOOLS.has(normalizedTool) || normalizedTool.startsWith('blender_')) {
    return true
  }
  const producedKind = String(result.kind || result.file_type || '').trim().toLowerCase()
  return /^(generated_(?:image|music|video)|website_design_style|artifact|presentation|model3d)$/.test(producedKind)
}

function isResourceCenterAsset(record = {}) {
  if (record.source === 'discovered_storage') return true
  if (record.sourceTool === 'final_reply_artifact') return true
  return shouldRegisterTool(record.sourceTool, {
    success: true,
    kind: record.kind,
    file_type: record.type
  })
}

function registerToolResult(toolName = '', args = {}, result = {}, context = {}, options = {}) {
  if (!shouldRegisterTool(toolName, result)) return { success: true, skipped: true, reason: 'not an asset-producing tool', assets: [] }
  const candidates = collectPathCandidates(result)
  if (!candidates.length) return { success: true, skipped: true, reason: 'no asset path in result', assets: [] }
  const assets = []
  for (const candidate of candidates) {
    const source = candidate.sourceObject || result
    const saved = upsertAsset({
      path: candidate.path,
      sourceTool: toolName,
      source: 'tool_result',
      projectId: context.projectId,
      projectPath: context.projectPath,
      kind: source.kind || result.kind,
      file_type: source.file_type || result.file_type,
      title: source.title || source.name || path.basename(candidate.path),
      prompt: source.prompt || result.prompt || args.prompt || args.description || args.goal || '',
      modelName: source.modelName || result.modelName || '',
      providerModelName: source.providerModelName || result.providerModelName || '',
      format: source.format || result.format || '',
      width: source.width || result.width || null,
      height: source.height || result.height || null,
      metadata: {
        resultKey: candidate.key || '',
        taskId: source.taskId || result.taskId || '',
        videoId: source.videoId || result.videoId || '',
        fileId: source.fileId || result.fileId || ''
      }
    }, options)
    if (saved.success) assets.push(saved.record)
  }
  return { success: true, assets, count: assets.length }
}

function queryAssets(input = {}, options = {}) {
  if (input.scan !== false) refreshDiscoveredAssets(options)
  const index = loadIndex(options)
  const query = String(input.query || '').trim().toLowerCase()
  const type = String(input.type || '').trim().toLowerCase()
  const projectId = String(input.projectId || '').trim()
  const limit = Math.max(1, Math.min(Number(input.limit || 80), 300))
  const verifiedRecords = index.records.map(refreshRecordAvailability)
  const existingRecords = verifiedRecords.filter(item => item.exists)
  const availableRecords = existingRecords.filter(isResourceCenterAsset)
  const missingCount = verifiedRecords.length - existingRecords.length
  const nonAssetCount = existingRecords.length - availableRecords.length
  const shouldPruneInvalid = (missingCount > 0 || nonAssetCount > 0) &&
    input.includeMissing !== true &&
    input.pruneMissing !== false
  if (shouldPruneInvalid) {
    saveIndex({ records: availableRecords }, options)
  }
  let records = input.includeMissing === true
    ? verifiedRecords
    : availableRecords
  if (type) records = records.filter(item => String(item.type || '').toLowerCase() === type || String(item.kind || '').toLowerCase() === type)
  if (projectId) records = records.filter(item => String(item.projectId || '') === projectId)
  if (query) {
    records = records.filter(item => [
      item.title,
      item.path,
      item.prompt,
      item.sourceTool,
      item.modelName,
      item.providerModelName,
      item.type,
      item.kind
    ].join('\n').toLowerCase().includes(query))
  }
  return {
    success: true,
    root: getRootDir(options),
    total: records.length,
    hiddenMissing: input.includeMissing === true ? 0 : missingCount,
    hiddenNonAsset: input.includeMissing === true ? 0 : nonAssetCount,
    assets: records.slice(0, limit)
  }
}

async function deleteAsset(id = '', options = {}) {
  const assetId = String(id || '').trim()
  if (!assetId) return { success: false, error: 'asset id is required' }

  const index = loadIndex(options)
  const record = index.records.find(item => String(item.id || '') === assetId)
  if (!record) return { success: false, error: 'asset not found' }

  const filePath = normalizePath(record.path)
  try {
    if (filePath && fs.existsSync(filePath)) await shell.trashItem(filePath)
    saveIndex({ records: index.records.filter(item => String(item.id || '') !== assetId) }, options)
    return { success: true, asset: record, trashed: Boolean(filePath) }
  } catch (error) {
    return { success: false, error: error?.message || 'failed to move asset to recycle bin' }
  }
}

function registerIPC(ipcMain) {
  ipcMain.handle('asset-library:list', async (event, input = {}) => queryAssets(input || {}))
  ipcMain.handle('asset-library:get', async (event, id = '') => {
    const index = loadIndex()
    const record = index.records.find(item => item.id === id)
    return record ? { success: true, asset: record } : { success: false, error: 'asset not found' }
  })
  ipcMain.handle('asset-library:delete', async (event, id = '') => deleteAsset(id))
}

module.exports = {
  getRootDir,
  getIndexPath,
  loadIndex,
  saveIndex,
  upsertAsset,
  registerToolResult,
  queryAssets,
  deleteAsset,
  registerIPC,
  refreshDiscoveredAssets,
  inferType
}
