const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const storageConfig = require('./storage-config')
const assetLibrary = require('./asset-library')

const VERSION = 1
const STORE_DIR = 'design-styles'
const INDEX_FILE = 'index.json'

function nowIso() {
  return new Date().toISOString()
}

function clipString(value = '', maxChars = 2000) {
  const text = String(value || '')
  return text.length > maxChars ? `${text.slice(0, maxChars)}\n...[truncated ${text.length - maxChars} chars]` : text
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

function shortHash(value = '') {
  return crypto.createHash('sha1').update(String(value || ''), 'utf8').digest('hex').slice(0, 10)
}

function slugify(value = '', fallback = 'website') {
  const text = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/[^a-z0-9\u4e00-\u9fa5._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
  return text || fallback
}

function getRootDir(options = {}) {
  if (options.rootDir) return path.resolve(options.rootDir)
  const base = options.baseDir || storageConfig.getBasePath?.() || storageConfig.getCacheDir?.() || process.cwd()
  return path.join(path.resolve(base), STORE_DIR)
}

function getPaths(options = {}) {
  const root = getRootDir(options)
  const stylesDir = path.join(root, 'styles')
  return {
    root,
    stylesDir,
    indexPath: path.join(root, INDEX_FILE)
  }
}

function normalizeList(items, maxItems = 12, maxChars = 160) {
  return (Array.isArray(items) ? items : [])
    .map(item => {
      if (item && typeof item === 'object') {
        return {
          ...item,
          value: item.value !== undefined ? clipString(item.value, maxChars) : item.value,
          text: item.text !== undefined ? clipString(item.text, maxChars) : item.text,
          sample: item.sample !== undefined ? clipString(item.sample, maxChars) : item.sample
        }
      }
      return clipString(item, maxChars)
    })
    .slice(0, maxItems)
}

function compactDesignTokens(result = {}) {
  const refined = result.refinedDesignTokens || {}
  const legacy = result.designTokens || {}
  return {
    colors: normalizeList(refined.colors || legacy.colors, 18, 120),
    fontFamilies: normalizeList(refined.fontFamilies || legacy.fonts || legacy.fontFamilies, 10, 120),
    typographyScale: normalizeList(refined.typographyScale, 12, 120),
    radiiScale: normalizeList(refined.radiiScale || legacy.radii, 10, 120),
    shadowScale: normalizeList(refined.shadowScale || legacy.shadows, 8, 180)
  }
}

function compactComponents(componentSystem = {}) {
  const out = {}
  for (const [name, value] of Object.entries(componentSystem || {})) {
    if (!value || typeof value !== 'object') continue
    const count = Number(value.count || 0)
    if (count <= 0) continue
    out[name] = {
      count,
      layout: clipString(value.layout, 160),
      typography: clipString(value.typography, 160),
      color: clipString(value.color, 160),
      background: clipString(value.background, 160),
      radius: clipString(value.radius, 80),
      spacing: clipString(value.spacing, 120),
      example: clipString(value.example, 220)
    }
  }
  return out
}

function compactComponentVariants(componentVariants = {}) {
  const out = {}
  for (const [name, variants] of Object.entries(componentVariants || {})) {
    if (!Array.isArray(variants) || !variants.length) continue
    out[name] = variants.slice(0, 6).map(item => ({
      count: Number(item?.count || 0),
      layout: clipString(item?.layout, 120),
      background: clipString(item?.background, 80),
      color: clipString(item?.color, 80),
      radius: clipString(item?.radius, 80),
      shadow: clipString(item?.shadow, 140),
      spacing: clipString(item?.spacing, 100),
      font: clipString(item?.font, 160),
      examples: normalizeList(item?.examples, 4, 100)
    }))
  }
  return out
}

function compactSections(sections = []) {
  return (Array.isArray(sections) ? sections : [])
    .map(item => ({
      role: item?.role || item?.tag || 'section',
      y: item?.y,
      height: item?.height,
      layout: clipString(item?.layout, 140),
      text: clipString(item?.text, 220),
      background: clipString(item?.background, 80),
      color: clipString(item?.color, 80),
      density: item?.density
    }))
    .slice(0, 20)
}

function collectKeywords(result = {}) {
  const words = new Set()
  const target = String(result.target || result.url || '')
  try {
    const host = new URL(target).hostname
    host.split(/[.\-]+/).forEach(part => part && words.add(part.toLowerCase()))
  } catch {
    // ignore non-url targets
  }
  const title = result.summary?.title || result.title || ''
  String(title).split(/[\s,，。|/\\:：\-]+/).forEach(part => {
    const value = part.trim().toLowerCase()
    if (value && value.length >= 2) words.add(value)
  })
  for (const section of result.sectionAnalysis || []) {
    const role = String(section?.role || section?.tag || '').trim().toLowerCase()
    if (role) words.add(role)
  }
  return Array.from(words).slice(0, 24)
}

function normalizeRecord(result = {}, options = {}, previous = null) {
  const target = String(result.target || result.url || '').trim()
  const title = String(result.summary?.title || result.title || target || 'Website Design Style').trim()
  const idBasis = target || title
  const id = previous?.id || `style-${slugify(title || target)}-${shortHash(idBasis)}`
  const createdAt = previous?.createdAt || nowIso()
  const updatedAt = nowIso()
  const colorRoles = result.visualPriority?.colorRoles || {}

  return {
    version: VERSION,
    id,
    title,
    target,
    source: options.source || 'research_website_runtime',
    createdAt,
    updatedAt,
    lastUsedAt: updatedAt,
    useCount: Number(previous?.useCount || 0) + 1,
    projectPath: options.projectPath || previous?.projectPath || '',
    keywords: collectKeywords(result),
    summary: result.summary || {},
    colorRoles,
    designTokens: compactDesignTokens(result),
    visualPriority: result.visualPriority || {},
    layoutSystem: result.layoutSystem || {},
    sectionAnalysis: compactSections(result.sectionAnalysis),
    componentSystem: compactComponents(result.componentSystem),
    componentVariants: compactComponentVariants(result.componentVariants),
    animationSystem: result.animationSystem || {},
    designDna: result.designDna || {},
    replicationBrief: clipString(result.replicationBrief, 6000)
  }
}

function loadIndex(options = {}) {
  const { indexPath } = getPaths(options)
  const index = readJson(indexPath, { version: VERSION, updatedAt: null, records: [] }) || {}
  return {
    version: VERSION,
    updatedAt: index.updatedAt || null,
    records: Array.isArray(index.records) ? index.records : []
  }
}

function compactIndexRecord(record = {}) {
  return {
    id: record.id,
    title: record.title,
    target: record.target,
    source: record.source,
    updatedAt: record.updatedAt,
    lastUsedAt: record.lastUsedAt,
    useCount: record.useCount,
    keywords: record.keywords,
    colorRoles: record.colorRoles,
    summary: {
      scrollHeight: record.summary?.scrollHeight,
      sectionCount: record.summary?.sectionCount,
      componentGroups: record.summary?.componentGroups,
      technologySignals: record.summary?.technologySignals
    },
    designDna: record.designDna ? {
      visualCharacter: clipString(record.designDna.visualCharacter, 260),
      hierarchy: clipString(record.designDna.hierarchy, 260),
      composition: clipString(record.designDna.composition, 260),
      replicationChecklist: normalizeList(record.designDna.replicationChecklist, 8, 180),
      avoid: normalizeList(record.designDna.avoid, 6, 180)
    } : undefined,
    replicationBriefPreview: clipString(record.replicationBrief || record.replicationBriefPreview, 700),
    files: record.files
  }
}

function writeIndex(records = [], options = {}) {
  const { indexPath } = getPaths(options)
  const index = {
    version: VERSION,
    updatedAt: nowIso(),
    records: records.map(compactIndexRecord)
  }
  writeJson(indexPath, index)
  return index
}

function buildMarkdown(record = {}) {
  const lines = []
  lines.push(`# ${record.title || record.id}`)
  lines.push('')
  if (record.target) lines.push(`- Source: ${record.target}`)
  lines.push(`- Updated: ${record.updatedAt}`)
  lines.push(`- Use count: ${record.useCount || 1}`)
  if (record.keywords?.length) lines.push(`- Keywords: ${record.keywords.join(', ')}`)
  lines.push('')
  lines.push('## Color Roles')
  const roles = record.colorRoles || {}
  for (const [name, item] of Object.entries(roles)) {
    if (item?.value) lines.push(`- ${name}: ${item.value}${item.reason ? ` (${item.reason})` : ''}`)
  }
  lines.push('')
  lines.push('## Component System')
  for (const [name, item] of Object.entries(record.componentSystem || {})) {
    lines.push(`- ${name}: ${item.count} samples; ${[item.layout, item.typography, item.color, item.background, item.radius, item.spacing].filter(Boolean).join('; ')}`)
  }
  if (Object.keys(record.componentVariants || {}).length) {
    lines.push('')
    lines.push('## Component Variants')
    for (const [name, variants] of Object.entries(record.componentVariants || {})) {
      lines.push(`- ${name}: ${variants.map(item => [item.layout, item.background, item.radius, item.spacing].filter(Boolean).join(' / ')).slice(0, 4).join(' | ')}`)
    }
  }
  if (record.designDna && Object.keys(record.designDna).length) {
    lines.push('')
    lines.push('## Design DNA')
    if (record.designDna.visualCharacter) lines.push(`- Visual character: ${record.designDna.visualCharacter}`)
    if (record.designDna.hierarchy) lines.push(`- Hierarchy: ${record.designDna.hierarchy}`)
    if (record.designDna.composition) lines.push(`- Composition: ${record.designDna.composition}`)
    if (record.designDna.contentTone) lines.push(`- Content tone: ${record.designDna.contentTone}`)
    if (Array.isArray(record.designDna.replicationChecklist)) {
      for (const item of record.designDna.replicationChecklist.slice(0, 10)) lines.push(`- Checklist: ${item}`)
    }
    if (Array.isArray(record.designDna.avoid)) {
      for (const item of record.designDna.avoid.slice(0, 8)) lines.push(`- Avoid: ${item}`)
    }
  }
  lines.push('')
  lines.push('## Section Structure')
  for (const item of record.sectionAnalysis || []) {
    lines.push(`- ${item.role}: ${item.layout || 'block'} ${item.text ? `- ${item.text}` : ''}`.trim())
  }
  lines.push('')
  lines.push('## Replication Brief')
  lines.push('')
  lines.push(record.replicationBrief || 'No replication brief captured.')
  lines.push('')
  return lines.join('\n')
}

function saveFromWebsiteResearchResult(result = {}, options = {}) {
  if (!result || result.success === false) {
    return { success: false, skipped: true, reason: 'research failed or empty result' }
  }
  const { root, stylesDir, indexPath } = getPaths(options)
  ensureDir(stylesDir)
  const index = loadIndex(options)
  const target = String(result.target || result.url || '').trim()
  const existing = index.records.find(item => item.target && item.target === target)
  const previous = existing?.files?.json ? readJson(path.join(root, existing.files.json), existing) : existing
  const record = normalizeRecord(result, options, previous)
  record.files = {
    json: path.join('styles', `${record.id}.json`),
    markdown: path.join('styles', `${record.id}.md`)
  }

  const jsonPath = path.join(root, record.files.json)
  const markdownPath = path.join(root, record.files.markdown)
  writeJson(jsonPath, record)
  fs.writeFileSync(markdownPath, buildMarkdown(record), 'utf8')
  try {
    assetLibrary.upsertAsset({
      path: markdownPath,
      type: 'design_style',
      kind: 'website_design_style',
      title: record.title,
      sourceTool: 'research_website_runtime',
      source: 'design_style_memory',
      projectPath: options.projectPath || '',
      prompt: record.replicationBrief,
      metadata: {
        target: record.target,
        jsonPath,
        keywords: record.keywords,
        colorRoles: record.colorRoles,
        designDna: record.designDna
      }
    })
  } catch (error) {
    // The design memory is authoritative; asset indexing must never fail the research tool.
  }

  const nextRecords = [
    compactIndexRecord(record),
    ...index.records.filter(item => item.id !== record.id && item.target !== record.target)
  ].slice(0, 200)
  writeIndex(nextRecords, options)

  return {
    success: true,
    id: record.id,
    title: record.title,
    target: record.target,
    root,
    indexPath,
    jsonPath,
    markdownPath,
    updated: !!existing,
    useCount: record.useCount
  }
}

function tokenize(value = '') {
  return String(value || '')
    .toLowerCase()
    .split(/[^a-z0-9\u4e00-\u9fa5]+/g)
    .map(item => item.trim())
    .filter(item => item.length >= 2)
    .slice(0, 80)
}

function scoreRecord(record = {}, query = '') {
  const tokens = tokenize(query)
  if (!tokens.length) return Number(record.useCount || 0)
  const haystack = [
    record.title,
    record.target,
    ...(record.keywords || []),
    record.replicationBriefPreview,
    Object.values(record.colorRoles || {}).map(item => item?.value || '').join(' ')
  ].join(' ').toLowerCase()
  let score = Number(record.useCount || 0) * 0.2
  for (const token of tokens) {
    if (haystack.includes(token)) score += 3
  }
  return score
}

function list(options = {}) {
  const index = loadIndex(options)
  return index.records
}

function loadRecord(id, options = {}) {
  if (!id) return null
  const { root } = getPaths(options)
  const index = loadIndex(options)
  const item = index.records.find(record => record.id === id)
  if (!item?.files?.json) return null
  return readJson(path.join(root, item.files.json), null)
}

function formatForContext(options = {}) {
  const maxItems = Math.max(1, Math.min(Number(options.maxItems || 3), 6))
  const query = options.query || ''
  const records = loadIndex(options).records
    .map(record => ({ ...record, _score: scoreRecord(record, query) }))
    .sort((a, b) => {
      if (b._score !== a._score) return b._score - a._score
      return String(b.updatedAt || '').localeCompare(String(a.updatedAt || ''))
    })
    .slice(0, maxItems)

  if (!records.length) return ''
  const lines = [
    '===== 全局设计风格记忆 =====',
    '以下是 research_website_runtime 沉淀的全局网站设计风格，可作为 UI 复刻/改造参考；当前用户需求和项目现有设计优先。'
  ]
  for (const record of records) {
    const colorRoles = record.colorRoles || {}
    const colors = Object.entries(colorRoles)
      .filter(([, item]) => item?.value)
      .slice(0, 8)
      .map(([name, item]) => `${name}:${item.value}`)
      .join(', ')
    lines.push(`- ${record.title || record.id}${record.target ? ` (${record.target})` : ''}`)
    if (colors) lines.push(`  Colors: ${colors}`)
    if (record.designDna?.visualCharacter) lines.push(`  Character: ${record.designDna.visualCharacter}`)
    if (record.designDna?.composition) lines.push(`  Composition: ${record.designDna.composition}`)
    if (Array.isArray(record.designDna?.replicationChecklist) && record.designDna.replicationChecklist.length) {
      lines.push(`  Checklist: ${record.designDna.replicationChecklist.slice(0, 5).join(' | ')}`)
    }
    if (Array.isArray(record.designDna?.avoid) && record.designDna.avoid.length) {
      lines.push(`  Avoid: ${record.designDna.avoid.slice(0, 4).join(' | ')}`)
    }
    if (record.replicationBriefPreview) lines.push(`  Brief: ${clipString(record.replicationBriefPreview, 900).replace(/\n+/g, ' ')}`)
    if (record.files?.markdown) lines.push(`  Document: ${path.join(getRootDir(options), record.files.markdown)}`)
  }
  return clipString(lines.join('\n'), Number(options.maxChars || 4200))
}

module.exports = {
  STORE_DIR,
  getRootDir,
  getPaths,
  loadIndex,
  list,
  loadRecord,
  saveFromWebsiteResearchResult,
  formatForContext
}
