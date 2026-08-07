const config = require('../config')

function createManagedUploadPath(originalName = 'attachment') {
  const fs = require('fs')
  const path = require('path')
  const storageConfig = require('../storage-config')
  const dir = path.join(storageConfig.getCacheDir(), 'uploaded-files')
  fs.mkdirSync(dir, { recursive: true })
  const safeName = path.basename(String(originalName || 'attachment'))
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
    .replace(/^\.+$/, 'attachment')
    .slice(-180) || 'attachment'
  const stamp = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14)
  const suffix = Math.random().toString(36).slice(2, 8)
  return path.join(dir, `${stamp}-${suffix}-${safeName}`)
}

function stageSelectedFile(sourcePath) {
  const fs = require('fs')
  const path = require('path')
  const stat = fs.statSync(sourcePath)
  if (!stat.isFile()) throw new Error('选择的内容不是文件')
  const targetPath = createManagedUploadPath(path.basename(sourcePath))
  fs.copyFileSync(sourcePath, targetPath)
  return {
    path: targetPath,
    name: path.basename(sourcePath),
    size: stat.size,
    type: 'application/octet-stream',
    pathSource: 'temporary',
    temporary: true
  }
}

/**
 * 注册文件相关 IPC handlers（从 registerChatIPC 中拆出）
 * @param {import('electron').IpcMain} ipcMain
 */
function registerFileIpcHandlers(ipcMain) {
  // 选择文件（返回完整路径）
  ipcMain.handle('select-files', async (event) => {
    const { dialog } = require('electron')
    const mainWindow = config.getMainWindow()
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: '所有文件', extensions: ['*'] },
        { name: '文本文件', extensions: ['txt', 'md', 'json', 'js', 'ts', 'py', 'html', 'css', 'csv', 'xml', 'yaml', 'log'] },
        { name: 'Office文件', extensions: ['xlsx', 'xls', 'pptx', 'ppt', 'docx', 'doc'] },
        { name: '图片', extensions: ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp'] }
      ]
    })
    if (result.canceled) {
      return { canceled: true, files: [] }
    }
    // 返回文件路径列表
    const files = result.filePaths.map(stageSelectedFile)
    console.log('[AIChat] 选择文件并复制到受管缓存:', files.map(f => f.path))
    return { canceled: false, files }
  })

  // 浏览器 File、拖放文件先复制到应用自己的缓存目录。预览和模型读取都只接触受管副本，
  // 不扩大项目路径白名单，也不长期持有桌面、图片等用户目录的读取权限。
  ipcMain.handle('save-uploaded-file', async (event, payload = {}) => {
    try {
      const fs = require('fs')
      const raw = String(payload.data || '')
      const comma = raw.indexOf(',')
      const base64 = comma >= 0 ? raw.slice(comma + 1) : raw
      if (!base64) return { success: false, error: '没有文件数据' }
      const buffer = Buffer.from(base64, 'base64')
      const maxBytes = 100 * 1024 * 1024
      if (!buffer.length) return { success: false, error: '文件内容为空' }
      if (buffer.length > maxBytes) return { success: false, error: '单个附件不能超过 100MB' }

      const filePath = createManagedUploadPath(payload.name)
      fs.writeFileSync(filePath, buffer)
      return {
        success: true,
        path: filePath,
        name: String(payload.name || require('path').basename(filePath)),
        type: String(payload.type || 'application/octet-stream'),
        size: buffer.length,
        temporary: true
      }
    } catch (err) {
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('save-pasted-image', async (event, payload = {}) => {
    try {
      const fs = require('fs')
      const path = require('path')
      const storageConfig = require('../storage-config')
      const base64 = String(payload.data || '').replace(/^data:image\/[a-z0-9.+-]+;base64,/i, '')
      if (!base64) return { success: false, error: '没有图片数据' }

      const mime = String(payload.type || 'image/png').toLowerCase()
      const extMap = {
        'image/png': 'png',
        'image/jpeg': 'jpg',
        'image/jpg': 'jpg',
        'image/webp': 'webp',
        'image/gif': 'gif',
        'image/bmp': 'bmp'
      }
      const ext = extMap[mime] || 'png'
      const dir = path.join(storageConfig.getCacheDir(), 'pasted-images')
      fs.mkdirSync(dir, { recursive: true })
      const stamp = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14)
      const suffix = Math.random().toString(36).slice(2, 8)
      const filePath = path.join(dir, `pasted-${stamp}-${suffix}.${ext}`)
      fs.writeFileSync(filePath, Buffer.from(base64, 'base64'))
      return {
        success: true,
        path: filePath,
        name: path.basename(filePath),
        type: mime,
        temporary: true
      }
    } catch (err) {
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('save-pasted-text', async (event, payload = {}) => {
    try {
      const fs = require('fs')
      const path = require('path')
      const storageConfig = require('../storage-config')
      const text = String(payload.text || '').replace(/\u0000/g, '')
      if (!text) return { success: false, error: '没有文本内容' }

      const bytes = Buffer.byteLength(text, 'utf8')
      const MAX_PASTED_TEXT_BYTES = 2 * 1024 * 1024
      if (bytes > MAX_PASTED_TEXT_BYTES) {
        return { success: false, error: '粘贴文本超过 2MB，请拆分后重试' }
      }

      const dir = path.join(storageConfig.getCacheDir(), 'pasted-text')
      fs.mkdirSync(dir, { recursive: true })
      const stamp = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14)
      const suffix = Math.random().toString(36).slice(2, 8)
      const filePath = path.join(dir, `粘贴内容-${stamp}-${suffix}.txt`)
      fs.writeFileSync(filePath, text, 'utf8')
      return {
        success: true,
        path: filePath,
        name: path.basename(filePath),
        type: 'text/plain',
        size: bytes,
        temporary: true
      }
    } catch (err) {
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('delete-temp-files', async (event, filePaths = []) => {
    const fs = require('fs')
    const path = require('path')
    const storageConfig = require('../storage-config')
    const roots = ['pasted-images', 'pasted-text', 'uploaded-files']
      .map(name => path.resolve(path.join(storageConfig.getCacheDir(), name)))
    let removed = 0
    for (const filePath of Array.isArray(filePaths) ? filePaths : []) {
      try {
        const resolved = path.resolve(String(filePath || ''))
        const allowed = roots.some(root =>
          resolved.toLowerCase().startsWith(root.toLowerCase() + path.sep)
        )
        if (!allowed) continue
        if (fs.existsSync(resolved) && fs.statSync(resolved).isFile()) {
          fs.unlinkSync(resolved)
          removed++
        }
      } catch (err) {
        console.warn('[AIChat] 删除临时粘贴附件失败:', err.message)
      }
    }
    return { success: true, removed }
  })
}

module.exports = { registerFileIpcHandlers }
