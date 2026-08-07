/**
 * 方案管理模块
 * 负责方案的存储、读取、删除
 */

const fs = require('fs')
const path = require('path')
const config = require('./config')

/**
 * 获取所有方案列表
 */
function getAllPlans() {
  const plansDir = config.getPlansDir()
  try {
    if (!plansDir || !fs.existsSync(plansDir)) {
      return []
    }
    const files = fs.readdirSync(plansDir).filter(f => f.endsWith('.md'))
    const plans = files.map(file => {
      const filePath = path.join(plansDir, file)
      const content = fs.readFileSync(filePath, 'utf-8')
      const stats = fs.statSync(filePath)
      // 从文件名提取标题（去掉时间戳前缀）
      const fileName = file.replace('.md', '')
      // 尝试从内容中提取标题（第一行如果是 # 标题）
      let title = fileName
      let sourcePath = null
      let displayContent = content

      // 解析元数据：<!-- sourcePath: xxx -->
      const sourceMatch = content.match(/<!-- sourcePath: (.+?) -->/)
      if (sourceMatch) {
        sourcePath = sourceMatch[1]
        // 移除元数据行，只保留实际内容
        displayContent = content.replace(/<!-- sourcePath: .+? -->\n*/, '').trim()
      }

      const firstLine = displayContent.split('\n')[0]
      if (firstLine.startsWith('# ')) {
        title = firstLine.substring(2).trim()
      }
      return {
        id: fileName,
        title,
        content: displayContent,
        sourcePath,
        date: stats.mtime.toLocaleDateString('zh-CN') + ' ' + stats.mtime.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }),
        filePath
      }
    })
    // 按修改时间排序（最新的在前）
    plans.sort((a, b) => new Date(b.date) - new Date(a.date))
    return plans
  } catch (e) {
    console.error('[Plans] 获取方案列表失败:', e)
    return []
  }
}

/**
 * 保存方案
 */
function savePlan(planData) {
  const plansDir = config.getPlansDir()
  try {
    if (!plansDir) {
      return { error: '方案目录未初始化' }
    }
    if (!fs.existsSync(plansDir)) {
      fs.mkdirSync(plansDir, { recursive: true })
    }

    const { id, title, content, sourcePath } = planData
    // 生成文件名：时间戳 + 标题（清理特殊字符）
    const timestamp = Date.now().toString(36)
    const safeTitle = (title || 'plan').replace(/[\\/:*?"<>|]/g, '_').substring(0, 50)
    const fileName = id || `${timestamp}_${safeTitle}`
    const filePath = path.join(plansDir, fileName + '.md')

    // 构建文件内容：添加元数据头
    let finalContent = content
    if (sourcePath) {
      // 在内容开头添加元数据（sourcePath）
      finalContent = `<!-- sourcePath: ${sourcePath} -->\n\n${content}`
    }
    // 如果内容中没有标题行，添加标题
    if (!content.startsWith('# ')) {
      finalContent = sourcePath
        ? `<!-- sourcePath: ${sourcePath} -->\n\n# ${title}\n\n${content}`
        : `# ${title}\n\n${content}`
    }

    fs.writeFileSync(filePath, finalContent, 'utf-8')
    console.log('[Plans] 方案已保存:', filePath)
    return { success: true, id: fileName, filePath }
  } catch (e) {
    console.error('[Plans] 保存方案失败:', e)
    return { error: e.message }
  }
}

/**
 * 删除方案
 */
function deletePlan(planId) {
  const plansDir = config.getPlansDir()
  try {
    if (!plansDir) return { error: '方案目录未初始化' }
    const filePath = path.join(plansDir, planId + '.md')
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath)
      console.log('[Plans] 方案已删除:', filePath)
      return { success: true }
    }
    return { error: '方案文件不存在' }
  } catch (e) {
    return { error: e.message }
  }
}

/**
 * 注册方案管理 IPC handlers
 */
function registerPlansIPC(ipcMain) {
  // 获取方案目录路径
  ipcMain.handle('get-plans-dir', () => {
    return config.getPlansDir()
  })

  // 获取所有方案列表
  ipcMain.handle('get-all-plans', async () => {
    return getAllPlans()
  })

  // 保存方案
  ipcMain.handle('save-plan', async (event, planData) => {
    return savePlan(planData)
  })

  // 删除方案
  ipcMain.handle('delete-plan', async (event, planId) => {
    return deletePlan(planId)
  })
}

module.exports = {
  getAllPlans,
  savePlan,
  deletePlan,
  registerPlansIPC
}