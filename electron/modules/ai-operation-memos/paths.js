const fs = require('fs')
const path = require('path')

const MEMO_DIR = path.join('.lingxi', 'ai-memos')
const DRAFTS_DIR = 'drafts'
const TIMELINE_DIR = 'timeline'
const INDEX_FILE = 'index.json'

const EXCLUDED_DIRS = new Set([
  '.git',
  'node_modules',
  'dist',
  'build',
  '.lingxi/ai-memos',
  '.lingxi\\ai-memos'
])

function resolveProjectPath(projectPath = '') {
  return path.resolve(String(projectPath || ''))
}

function safeFilePart(value = '') {
  return String(value || 'memo')
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .trim()
    .slice(0, 96) || 'memo'
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

function getMemoRoot(projectPath = '') {
  const root = resolveProjectPath(projectPath)
  return path.join(root, MEMO_DIR)
}

function getDraftsDir(projectPath = '') {
  return path.join(getMemoRoot(projectPath), DRAFTS_DIR)
}

function getTimelineDir(projectPath = '') {
  return path.join(getMemoRoot(projectPath), TIMELINE_DIR)
}

function getIndexPath(projectPath = '') {
  return path.join(getMemoRoot(projectPath), INDEX_FILE)
}

function ensureMemoDirs(projectPath = '') {
  const root = getMemoRoot(projectPath)
  ensureDir(root)
  ensureDir(getDraftsDir(projectPath))
  ensureDir(getTimelineDir(projectPath))
  return root
}

function isInsidePath(parentPath = '', childPath = '') {
  if (!parentPath || !childPath) return false
  const parent = path.resolve(parentPath)
  const child = path.resolve(childPath)
  const relative = path.relative(parent, child)
  return relative === '' || (!!relative && !relative.startsWith('..') && !path.isAbsolute(relative))
}

function getRelativeProjectPath(projectPath = '', targetPath = '') {
  if (!isInsidePath(projectPath, targetPath)) return ''
  return path.relative(resolveProjectPath(projectPath), path.resolve(targetPath)).replace(/\\/g, '/')
}

function isExcludedRelativePath(relativePath = '') {
  const normalized = String(relativePath || '').replace(/\\/g, '/').replace(/^\/+/, '')
  if (!normalized) return true
  const lower = normalized.toLowerCase()
  if (lower === '.lingxi/ai-memos' || lower.startsWith('.lingxi/ai-memos/')) return true
  const first = lower.split('/')[0]
  if (EXCLUDED_DIRS.has(first)) return true
  return [...EXCLUDED_DIRS].some(dir => {
    const value = String(dir).replace(/\\/g, '/').toLowerCase()
    return lower === value || lower.startsWith(value + '/')
  })
}

function isProjectBusinessPath(projectPath = '', targetPath = '') {
  const relativePath = getRelativeProjectPath(projectPath, targetPath)
  return !!relativePath && !isExcludedRelativePath(relativePath)
}

function assertInsideMemoRoot(projectPath = '', targetPath = '') {
  const memoRoot = getMemoRoot(projectPath)
  const resolved = path.resolve(String(targetPath || ''))
  if (!isInsidePath(memoRoot, resolved)) throw new Error('无效的备忘录路径')
  return resolved
}

module.exports = {
  MEMO_DIR,
  DRAFTS_DIR,
  TIMELINE_DIR,
  INDEX_FILE,
  safeFilePart,
  ensureDir,
  ensureMemoDirs,
  getMemoRoot,
  getDraftsDir,
  getTimelineDir,
  getIndexPath,
  isInsidePath,
  getRelativeProjectPath,
  isProjectBusinessPath,
  assertInsideMemoRoot
}
