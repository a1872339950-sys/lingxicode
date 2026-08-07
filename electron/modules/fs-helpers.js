/**
 * 公共文件系统工具模块
 * 提取自多处重复实现，提供统一的文件操作、路径处理和常量。
 */

const fs = require('fs')
const path = require('path')

/**
 * 确保目录存在（递归创建）
 */
function ensureDir(dir) {
  if (!dir) return
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
}

/**
 * 路径标准化：反斜杠转正斜杠，绝对路径转相对路径，去除前缀 ./
 * 项目文件遍历的共享实现
 */
function normalizePath(filePath = '', projectPath = '') {
  let value = String(filePath || '').replace(/\\/g, '/')
  const root = String(projectPath || '').replace(/\\/g, '/').replace(/\/+$/, '')
  if (/^[a-z]:\//i.test(value) && root) {
    try {
      const relative = path.relative(root, value).replace(/\\/g, '/')
      if (relative && !relative.startsWith('..') && !path.isAbsolute(relative)) value = relative
    } catch { /* 路径计算失败 */ }
  }
  return value.replace(/^\.\/+/, '')
}

/**
 * 安全读取 JSON 文件，失败时返回 fallback
 */
function readJsonFile(filePath, fallback = null) {
  try {
    if (!fs.existsSync(filePath)) return fallback
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'))
  } catch (e) {
    return fallback
  }
}

/**
 * 安全写入 JSON 文件
 */
function writeJsonFile(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8')
}

/**
 * 文本截断（通用版）
 */
function clipText(text, maxLen = 200) {
  if (!text) return ''
  const value = String(text)
  if (value.length <= maxLen) return value
  return value.substring(0, maxLen) + '...'
}

/**
 * 图片文件扩展名常量
 */
const IMAGE_FILE_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp', '.ico', '.avif', '.tif', '.tiff'
])

/**
 * 忽略目录常量（按文件工具、诊断和项目扫描的共同需求取并集）
 */
const IGNORE_DIRS = new Set([
  '.git', '.hg', '.svn',
  'node_modules', 'dist', 'build', 'out', 'release', 'releases',
  '.next', '.nuxt', '.vite', '.turbo', '.cache', 'coverage',
  'tmp', 'temp', '.tmp', '.temp', 'logs', 'log',
  '__pycache__', '.pytest_cache', '.gradle', 'target',
  'vendor', 'packages-cache',
  'codemap', 'change-sessions', 'recovery-points',
  '.tmp-real-scenarios', '.lingxi-temp-diagnostics',
  '.venv', 'venv',
  '.lingua', '.uploads'
])

module.exports = {
  ensureDir,
  normalizePath,
  readJsonFile,
  writeJsonFile,
  clipText,
  IMAGE_FILE_EXTENSIONS,
  IGNORE_DIRS
}
