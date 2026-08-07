/**
 * 路径工具纯函数
 * 从 tools.js 提取，仅依赖 Node.js 内置 fs/path
 *
 * 包含：路径规范化、路径 token 拆分、项目内外判断、项目相对路径转换、
 *       文件系统扫描候选、路径候选打分
 */

const fs = require('fs')
const path = require('path')

const PATH_CANDIDATE_SKIP_DIRS = new Set([
  '.git', 'node_modules', 'dist', 'build', 'out', '.next', '.nuxt', 'coverage',
  '.cache', 'cache', 'tmp', 'temp', '.vite', '.turbo', '.idea', '.vscode'
])

function normalizeComparablePath(value = '') {
  return String(value || '').replace(/\\/g, '/').replace(/^\.\/+/, '').toLowerCase()
}

function getPathTokens(value = '') {
  return normalizeComparablePath(value)
    .split(/[^a-z0-9_\-\u4e00-\u9fa5]+/i)
    .map(item => item.trim())
    .filter(item => item.length > 1 && !['src', 'lib', 'app', 'index', 'main'].includes(item))
    .slice(0, 12)
}

function isInsideProject(projectPath = '', targetPath = '') {
  if (!projectPath || !targetPath) return false
  const relative = path.relative(path.resolve(projectPath), path.resolve(targetPath))
  return relative === '' || (!!relative && !relative.startsWith('..') && !path.isAbsolute(relative))
}

function toProjectRelative(projectPath = '', targetPath = '') {
  if (!projectPath || !targetPath || !isInsideProject(projectPath, targetPath)) {
    return String(targetPath || '').replace(/\\/g, '/')
  }
  return path.relative(path.resolve(projectPath), path.resolve(targetPath)).replace(/\\/g, '/')
}

function collectProjectPathCandidates(projectPath = '', kind = 'file', maxVisited = 8000) {
  const root = path.resolve(projectPath || '')
  if (!root || !fs.existsSync(root)) return []
  const results = []
  const stack = [{ dir: root, depth: 0 }]
  let visited = 0

  while (stack.length && visited < maxVisited) {
    const current = stack.pop()
    let entries = []
    try {
      entries = fs.readdirSync(current.dir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      if (visited >= maxVisited) break
      const fullPath = path.join(current.dir, entry.name)
      visited += 1
      if (entry.isDirectory()) {
        if (PATH_CANDIDATE_SKIP_DIRS.has(entry.name)) continue
        if (kind === 'directory') results.push(fullPath)
        if (current.depth < 10) stack.push({ dir: fullPath, depth: current.depth + 1 })
      } else if (kind !== 'directory' && entry.isFile()) {
        results.push(fullPath)
      }
    }
  }
  return results
}

function scorePathCandidate(candidatePath, requestedPath = '', projectPath = '', source = 'scan') {
  const relative = toProjectRelative(projectPath, candidatePath)
  const relativeNorm = normalizeComparablePath(relative)
  const requestedNorm = normalizeComparablePath(requestedPath)
  const requestedBase = normalizeComparablePath(path.basename(requestedPath || ''))
  const candidateBase = normalizeComparablePath(path.basename(candidatePath || ''))
  const reasons = []
  let score = source === 'codemap' ? 12 : 0

  if (requestedNorm && relativeNorm === requestedNorm) {
    score += 120
    reasons.push('exact_relative_path')
  } else if (requestedNorm && relativeNorm.endsWith('/' + requestedNorm)) {
    score += 95
    reasons.push('relative_path_suffix')
  } else if (requestedNorm && relativeNorm.includes(requestedNorm)) {
    score += 70
    reasons.push('relative_path_contains')
  }

  if (requestedBase && candidateBase === requestedBase) {
    score += 80
    reasons.push('same_basename')
  } else if (requestedBase && candidateBase.includes(requestedBase)) {
    score += 30
    reasons.push('basename_contains')
  }

  const requestedExt = path.extname(requestedPath || '').toLowerCase()
  if (requestedExt && requestedExt === path.extname(candidatePath || '').toLowerCase()) {
    score += 8
    reasons.push('same_extension')
  }

  for (const token of getPathTokens(requestedPath)) {
    if (relativeNorm.includes(token)) {
      score += candidateBase.includes(token) ? 12 : 6
      reasons.push(`token:${token}`)
    }
  }

  if (source === 'codemap') reasons.push('codemap_history')
  return { score, reasons: [...new Set(reasons)], relative }
}

module.exports = {
  PATH_CANDIDATE_SKIP_DIRS,
  normalizeComparablePath,
  getPathTokens,
  isInsideProject,
  toProjectRelative,
  collectProjectPathCandidates,
  scorePathCandidate
}
