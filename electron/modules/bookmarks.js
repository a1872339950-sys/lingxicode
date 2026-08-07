/**
 * 书签管理后端模块
 * 存储位置：app.getPath('userData')/bookmarks.json
 * 数据结构：[{ id, url, title, favicon, createdAt }]
 */

const fs = require('fs')
const path = require('path')
const { app } = require('electron')

const BOOKMARKS_FILE = 'bookmarks.json'
const MAX_TITLE_LEN = 200
const MAX_URL_LEN = 2048

let _cache = null
let _cacheMtime = 0

function getBookmarksFilePath() {
  return path.join(app.getPath('userData'), BOOKMARKS_FILE)
}

function normalizeUrl(url) {
  if (!url || typeof url !== 'string') return ''
  const trimmed = url.trim().slice(0, MAX_URL_LEN)
  return trimmed
}

function normalizeTitle(title) {
  if (!title) return ''
  return String(title).trim().slice(0, MAX_TITLE_LEN)
}

function readBookmarksFile() {
  const filePath = getBookmarksFilePath()
  try {
    if (!fs.existsSync(filePath)) return []
    const stat = fs.statSync(filePath)
    if (_cache && _cacheMtime === stat.mtimeMs) return _cache
    const raw = fs.readFileSync(filePath, 'utf-8')
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    _cache = parsed
    _cacheMtime = stat.mtimeMs
    return parsed
  } catch (error) {
    console.error('[Bookmarks] 读取失败:', error.message)
    return []
  }
}

function writeBookmarksFile(bookmarks) {
  const filePath = getBookmarksFilePath()
  try {
    const dir = path.dirname(filePath)
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
    const tempPath = `${filePath}.tmp-${Date.now()}-${Math.random().toString(36).slice(2)}`
    fs.writeFileSync(tempPath, JSON.stringify(bookmarks, null, 2), 'utf-8')
    fs.renameSync(tempPath, filePath)
    _cache = bookmarks
    try { _cacheMtime = fs.statSync(filePath).mtimeMs } catch (_) { /* ignore */ }
    return true
  } catch (error) {
    console.error('[Bookmarks] 写入失败:', error.message)
    return false
  }
}

function findBookmarkByUrl(url) {
  const normalized = normalizeUrl(url)
  if (!normalized) return null
  const bookmarks = readBookmarksFile()
  return bookmarks.find(b => b.url === normalized) || null
}

/**
 * 添加书签
 */
function addBookmark({ url, title, favicon }) {
  const normalizedUrl = normalizeUrl(url)
  if (!normalizedUrl) return { success: false, error: '无效的 URL' }

  const bookmarks = readBookmarksFile()
  // 已存在则更新
  const existing = bookmarks.find(b => b.url === normalizedUrl)
  if (existing) {
    existing.title = normalizeTitle(title) || existing.title
    existing.favicon = favicon || existing.favicon
    writeBookmarksFile(bookmarks)
    return { success: true, bookmark: existing, existed: true }
  }

  const newBookmark = {
    id: `bm-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    url: normalizedUrl,
    title: normalizeTitle(title) || normalizedUrl,
    favicon: favicon || '',
    createdAt: Date.now()
  }
  bookmarks.push(newBookmark)
  writeBookmarksFile(bookmarks)
  return { success: true, bookmark: newBookmark, existed: false }
}

/**
 * 移除书签
 */
function removeBookmark({ url, id }) {
  const bookmarks = readBookmarksFile()
  const normalizedUrl = url ? normalizeUrl(url) : ''
  const before = bookmarks.length
  const filtered = bookmarks.filter(b => {
    if (normalizedUrl && b.url === normalizedUrl) return false
    if (id && b.id === id) return false
    return true
  })
  if (filtered.length === before) {
    return { success: false, error: '未找到匹配的书签' }
  }
  writeBookmarksFile(filtered)
  return { success: true, removed: before - filtered.length }
}

/**
 * 查询 URL 是否已书签
 */
function hasBookmark({ url }) {
  const found = findBookmarkByUrl(url)
  return { success: true, bookmarked: !!found, bookmark: found }
}

/**
 * 列出所有书签
 */
function listBookmarks() {
  return { success: true, bookmarks: readBookmarksFile() }
}

/**
 * 重排序书签
 * @param {Array<string>} orderedIds - 按新顺序排列的书签 ID 数组
 */
function reorderBookmarks(orderedIds) {
  if (!Array.isArray(orderedIds)) return { success: false, error: '无效的排序数据' }
  const bookmarks = readBookmarksFile()
  const map = new Map(bookmarks.map(b => [b.id, b]))
  const reordered = []
  for (const id of orderedIds) {
    const b = map.get(id)
    if (b) {
      reordered.push(b)
      map.delete(id)
    }
  }
  // 保留未在 orderedIds 中的书签（追加到末尾）
  for (const b of map.values()) reordered.push(b)
  writeBookmarksFile(reordered)
  return { success: true, bookmarks: reordered }
}

/**
 * 注册 IPC
 */
function registerBookmarksIPC(ipcMain) {
  ipcMain.handle('bookmarks:list', () => listBookmarks())
  ipcMain.handle('bookmarks:add', (_event, data) => addBookmark(data || {}))
  ipcMain.handle('bookmarks:remove', (_event, data) => removeBookmark(data || {}))
  ipcMain.handle('bookmarks:has', (_event, data) => hasBookmark(data || {}))
  ipcMain.handle('bookmarks:reorder', (_event, data) => reorderBookmarks(data?.orderedIds || []))
}

module.exports = {
  addBookmark,
  removeBookmark,
  hasBookmark,
  listBookmarks,
  registerBookmarksIPC
}
