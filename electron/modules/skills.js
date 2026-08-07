/**
 * 技能系统模块
 * 负责技能加载、解析、启用/禁用
 */

const fs = require('fs')
const path = require('path')
const { dialog } = require('electron')
const config = require('./config')
const projectSkillDrafts = require('./project-skill-drafts')
const plugins = require('./plugins')

/**
 * 解析 SKILL.md 文件
 */
function parseSkillFile(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf-8')
    const skill = { path: filePath }

    // 解析 frontmatter（支持 value 中含冒号、引号）
    const frontmatterMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---/)
    if (frontmatterMatch) {
      const lines = frontmatterMatch[1].split(/\r?\n/)
      for (const line of lines) {
        if (!line.trim() || line.trim().startsWith('#')) continue
        const colonIdx = line.indexOf(':')
        if (colonIdx <= 0) continue
        const key = line.slice(0, colonIdx).trim()
        let value = line.slice(colonIdx + 1).trim()
        if (
          (value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))
        ) {
          value = value.slice(1, -1)
        }
        if (key) skill[key] = value
      }
    }

    // 获取技能内容（去掉 frontmatter 后的部分）
    const contentMatch = content.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n([\s\S]*)/)
    if (contentMatch) {
      skill.content = contentMatch[1].trim()
    } else {
      skill.content = content
    }

    // 确保 name 存在
    if (!skill.name) {
      const folderName = path.basename(path.dirname(filePath))
      skill.name = folderName
    }

    return skill
  } catch (e) {
    console.error('[Skills] 解析技能文件失败:', filePath, e.message)
    return null
  }
}

/**
 * 加载内置技能
 */
function loadBuiltinSkills() {
  // 修复路径：__dirname 是 electron/modules/，需要向上两级才能到达项目根目录的 skills/
  const builtinDir = path.join(__dirname, '../../skills')
  const skills = []

  try {
    if (!fs.existsSync(builtinDir)) return skills

    const folders = fs.readdirSync(builtinDir, { withFileTypes: true })
    for (const folder of folders) {
      if (folder.isDirectory()) {
        const skillPath = path.join(builtinDir, folder.name, 'SKILL.md')
        if (fs.existsSync(skillPath)) {
          const skill = parseSkillFile(skillPath)
          if (skill) {
            skill.builtin = true  // 标记为内置技能
            skills.push(skill)
          }
        }
      }
    }
  } catch (e) {
    console.error('[Skills] 加载内置技能失败:', e.message)
  }

  return skills
}

/**
 * 加载用户自定义技能
 */
function loadUserSkills() {
  const skillsDir = config.getSkillsDir()
  const skills = []

  try {
    if (!skillsDir || !fs.existsSync(skillsDir)) return skills

    const folders = fs.readdirSync(skillsDir, { withFileTypes: true })
    for (const folder of folders) {
      if (folder.isDirectory()) {
        const skillPath = path.join(skillsDir, folder.name, 'SKILL.md')
        if (fs.existsSync(skillPath)) {
          const skill = parseSkillFile(skillPath)
          if (skill) {
            skill.builtin = false  // 标记为用户自定义
            skills.push(skill)
          }
        }
      }
    }
  } catch (e) {
    console.error('[Skills] 加载用户技能失败:', e.message)
  }

  return skills
}

/**
 * 加载所有技能
 */
function loadProjectSkills(projectPath = '') {
  try {
    if (!projectPath) return []
    return projectSkillDrafts.listProjectSkills(projectPath)
  } catch (e) {
    console.error('[Skills] load project skills failed:', e.message)
    return []
  }
}

function loadAllSkills(projectPath = '') {
  const builtin = loadBuiltinSkills()
  const user = loadUserSkills()
  const project = loadProjectSkills(projectPath)
  let pluginSkills = []
  try {
    pluginSkills = plugins.loadInstalledPluginSkills()
  } catch (e) {
    console.warn('[Skills] load plugin skills failed:', e.message)
  }
  const allSkills = [...builtin, ...user, ...project, ...pluginSkills]
  config.setAllSkills(allSkills)
  console.log('[Skills] loaded skills:', allSkills.length, '(plugins:', pluginSkills.length + ')')
  return allSkills
}

/**
 * 按用户话术自动挂载流程类技能全文（类似渐进披露：命中才注入，不塞进主系统提示常驻段）
 */
function buildAutoAttachedSkillPrompt(userMessage = '') {
  const text = String(userMessage || '')
  if (!text.trim()) return ''

  let featureSettings = null
  try {
    featureSettings = require('./feature-settings')
  } catch (_) {
    return ''
  }

  let all = typeof config.getAllSkills === 'function' ? config.getAllSkills() : []
  if (!all.length) {
    try {
      all = loadBuiltinSkills().concat(loadUserSkills())
    } catch (_) {
      all = []
    }
  }
  const byName = new Map(all.map(s => [s.name, s]))
  const parts = []

  const pushSkill = (name) => {
    let skill = byName.get(name)
    // 磁盘兜底：直接读内置 skills/<name>/SKILL.md
    if (!skill?.content) {
      try {
        const skillPath = path.join(__dirname, '../../skills', name, 'SKILL.md')
        skill = parseSkillFile(skillPath)
      } catch (_) { /* ignore */ }
    }
    if (!skill?.content) return
    parts.push(`### ${skill.title || skill.name}\n\n${skill.content}`)
  }

  // 对话内嵌可视化默认参与每轮判断：模型按技能中的“何时使用/何时不用”自行决定，用户无需手动选择。
  if (featureSettings.isFeatureEnabled?.('inline_visualize')) {
    pushSkill('inline-visual')
  }

  // 网页交付：明确建站意图
  if (
    featureSettings.isFeatureEnabled?.('website_delivery') &&
    /(落地页|官网|建站|门户|主页|网站首页|做一个网站|做个网站|站点交付|landing\s*page|homepage|build\s+(a\s+)?(site|website)|portfolio\s+site)/i.test(text)
  ) {
    pushSkill('website-delivery')
  }

  if (!parts.length) return ''
  return `===== 本轮自动能力决策（按能力开关挂载） =====
先判断下列流程是否真正适合本轮任务；不适合就不要使用。适合时完整遵循；对用户说话不要提技能名/工具名。

${parts.join('\n\n---\n\n')}`
}

/**
 * 加载已启用技能列表
 */
function loadEnabledSkills() {
  const linguaBasePath = config.getLinguaBasePath()
  const allSkills = config.getAllSkills()
  let enabledSkills = config.getEnabledSkills()

  try {
    const enabledPath = path.join(linguaBasePath, 'enabled-skills.json')
    if (fs.existsSync(enabledPath)) {
      enabledSkills = JSON.parse(fs.readFileSync(enabledPath, 'utf-8'))
      if (!Array.isArray(enabledSkills)) enabledSkills = []
      config.setEnabledSkills(enabledSkills)
      // 空列表合法：启用是可选池，不自动回填；模型仍只看输入框当前选中
    } else {
      // 首次：默认启用内置技能（进入可选池），输入框仍默认「无技能」不对模型注入
      enabledSkills = allSkills.filter(s => s.builtin).map(s => s.name)
      config.setEnabledSkills(enabledSkills)
      saveEnabledSkills()
      console.log('[Skills] 首次加载，默认启用内置技能（可选池）:', enabledSkills.length, '个')
    }
  } catch (e) {
    console.error('[Skills] 加载启用技能失败:', e.message)
    if (allSkills.length > 0 && (!enabledSkills || enabledSkills.length === 0)) {
      enabledSkills = allSkills.filter(s => s.builtin).map(s => s.name)
      config.setEnabledSkills(enabledSkills)
    }
  }

  // 必须在磁盘启用列表加载完成后再修复插件入口，避免空内存写盘冲掉原列表
  try {
    if (typeof plugins.ensureInstalledPluginsEnabled === 'function') {
      const newly = plugins.ensureInstalledPluginsEnabled()
      if (newly && newly.length) {
        console.log('[Skills] 已自动启用插件入口:', newly.join(', '))
      }
    }
  } catch (e) {
    console.warn('[Skills] ensure plugin skills enabled failed:', e.message)
  }
}

/**
 * 保存已启用技能列表
 */
function saveEnabledSkills() {
  const linguaBasePath = config.getLinguaBasePath()
  const enabledSkills = config.getEnabledSkills()

  try {
    const enabledPath = path.join(linguaBasePath, 'enabled-skills.json')
    fs.writeFileSync(enabledPath, JSON.stringify(enabledSkills, null, 2))
  } catch (e) {
    console.error('[Skills] 保存启用技能失败:', e.message)
  }
}

/**
 * 获取已启用的技能对象列表
 */
function getEnabledSkillObjects() {
  const allSkills = config.getAllSkills()
  const enabledSkills = config.getEnabledSkills()
  return allSkills.filter(s => enabledSkills.includes(s.name))
}

/**
 * 启用技能
 */
function enableSkill(skillName) {
  const enabledSkills = config.getEnabledSkills()
  if (!enabledSkills.includes(skillName)) {
    config.addEnabledSkill(skillName)
    saveEnabledSkills()
  }
  return { success: true }
}

/**
 * 禁用技能
 */
function disableSkill(skillName) {
  config.removeEnabledSkill(skillName)
  saveEnabledSkills()
  return { success: true }
}

/**
 * 删除自定义技能
 */
function deleteSkill(skillName) {
  const allSkills = config.getAllSkills()
  const skill = allSkills.find(s => s.name === skillName && !s.builtin)
  if (!skill) {
    return { error: '只能删除自定义技能' }
  }
  if (skill.pluginId || skill.kind === 'plugin') {
    return { error: '插件技能请到「插件 · 已安装」中卸载整个插件' }
  }

  const skillFolder = path.dirname(skill.path)
  if (fs.existsSync(skillFolder)) {
    fs.rmSync(skillFolder, { recursive: true })
  }

  // 从启用列表移除
  config.removeEnabledSkill(skillName)
  saveEnabledSkills()

  // 重新加载技能
  loadAllSkills()

  return { success: true }
}

/**
 * 上传自定义技能
 */
function uploadSkill(skillData) {
  const skillsDir = config.getSkillsDir()
  const { name, title, description, content } = skillData
  const skillFolder = path.join(skillsDir, name)

  // 确保技能目录存在
  if (!fs.existsSync(skillsDir)) {
    fs.mkdirSync(skillsDir, { recursive: true })
  }

  // 创建技能文件夹
  if (!fs.existsSync(skillFolder)) {
    fs.mkdirSync(skillFolder, { recursive: true })
  }

  // 写入 SKILL.md 文件
  const skillContent = `---
name: ${name}
title: ${title || name}
description: ${description || ''}
---

${content || ''}
`
  fs.writeFileSync(path.join(skillFolder, 'SKILL.md'), skillContent)

  // 重新加载技能
  loadAllSkills()

  return { success: true, skillName: name }
}

/**
 * 获取所有技能列表（用于IPC响应）
 */
function getAllSkillsForIPC(projectPath = '') {
  const allSkills = projectPath ? loadAllSkills(projectPath) : config.getAllSkills()
  const enabledSkills = config.getEnabledSkills()
  return allSkills.map(s => ({
    name: s.name,
    title: s.title || s.name,
    description: s.description || '',
    content: s.content,
    builtin: s.builtin,
    projectSkill: !!s.projectSkill,
    kind: s.kind || (s.pluginId ? 'plugin' : 'skill'),
    pluginId: s.pluginId || null,
    pluginName: s.pluginName || null,
    pluginSkill: s.pluginSkill || null,
    isPluginRoot: !!s.isPluginRoot,
    scope: s.scope || (s.projectSkill ? 'project' : 'global'),
    enabled: !!s.projectSkill || enabledSkills.includes(s.name)
  }))
}

/**
 * 获取已启用技能列表（用于IPC响应）
 */
function getEnabledSkillsForIPC(projectPath = '') {
  const enabled = projectPath
    ? loadAllSkills(projectPath).filter(s => s.projectSkill || config.getEnabledSkills().includes(s.name))
    : getEnabledSkillObjects()
  return enabled.map(s => ({
    name: s.name,
    title: s.title || s.name,
    description: s.description || '',
    content: s.content,
    builtin: s.builtin,
    projectSkill: !!s.projectSkill,
    kind: s.kind || (s.pluginId ? 'plugin' : 'skill'),
    pluginId: s.pluginId || null,
    pluginName: s.pluginName || null,
    pluginSkill: s.pluginSkill || null,
    isPluginRoot: !!s.isPluginRoot,
    scope: s.scope || (s.projectSkill ? 'project' : 'global')
  }))
}

/**
 * 注册技能系统 IPC handlers
 */
function registerSkillsIPC(ipcMain) {
  // 获取所有技能列表
  ipcMain.handle('get-all-skills', (event, projectPath = '') => {
    return getAllSkillsForIPC(projectPath)
  })

  // 获取已启用的技能列表
  ipcMain.handle('get-enabled-skills', (event, projectPath = '') => {
    return getEnabledSkillsForIPC(projectPath)
  })

  // 刷新技能列表
  ipcMain.handle('reload-skills', (event, projectPath = '') => {
    loadAllSkills(projectPath)
    return getAllSkillsForIPC(projectPath)
  })

  // 启用技能
  ipcMain.handle('enable-skill', (event, skillName) => {
    return enableSkill(skillName)
  })

  // 禁用技能
  ipcMain.handle('disable-skill', (event, skillName) => {
    return disableSkill(skillName)
  })

  // 上传自定义技能
  ipcMain.handle('upload-skill', async (event, skillData) => {
    return uploadSkill(skillData)
  })

  // 删除自定义技能
  ipcMain.handle('delete-skill', (event, skillName) => {
    return deleteSkill(skillName)
  })

  // 选择技能文件上传
  ipcMain.handle('select-skill-file', async () => {
    const mainWindow = config.getMainWindow()
    const skillsDir = config.getSkillsDir()

    const result = await dialog.showOpenDialog(mainWindow, {
      title: '选择技能文件',
      filters: [
        { name: '技能包', extensions: ['zip'] },
        { name: 'Markdown', extensions: ['md'] }
      ],
      properties: ['openFile']
    })

    if (result.canceled || result.filePaths.length === 0) {
      return { canceled: true }
    }

    const filePath = result.filePaths[0]

    // 判断文件类型
    if (filePath.endsWith('.zip')) {
      try {
        const skillName = path.basename(filePath, '.zip')
        const extractPath = path.join(skillsDir, skillName + '_temp')

        // 使用 PowerShell 解压（异步，不阻塞主进程）
        const { execFile } = require('child_process')
        const { promisify } = require('util')
        const execFileAsync = promisify(execFile)
        const psCmd = `Expand-Archive -Path "${filePath}" -DestinationPath "${extractPath}" -Force`
        await execFileAsync('powershell', ['-Command', psCmd], { encoding: 'utf8', timeout: 30000 })

        // 查找 SKILL.md 文件
        const findSkillMd = (dir) => {
          const items = fs.readdirSync(dir, { withFileTypes: true })
          for (const item of items) {
            const fullPath = path.join(dir, item.name)
            if (item.isDirectory()) {
              const found = findSkillMd(fullPath)
              if (found) return found
            } else if (item.name.toLowerCase() === 'skill.md') {
              return fullPath
            }
          }
          return null
        }

        const skillMdPath = findSkillMd(extractPath)

        if (skillMdPath && fs.existsSync(skillMdPath)) {
          const skillDir = path.dirname(skillMdPath)
          const finalPath = path.join(skillsDir, skillName)

          if (skillDir !== extractPath) {
            if (fs.existsSync(finalPath)) {
              fs.rmSync(finalPath, { recursive: true })
            }
            fs.renameSync(skillDir, finalPath)
            fs.rmSync(extractPath, { recursive: true })
          } else {
            if (fs.existsSync(finalPath)) {
              fs.rmSync(finalPath, { recursive: true })
            }
            fs.renameSync(extractPath, finalPath)
          }

          const skill = parseSkillFile(path.join(finalPath, 'SKILL.md'))
          if (skill) {
            loadAllSkills()
            return { success: true, skill, message: `技能 "${skill.title || skill.name}" 导入成功` }
          }
        }

        if (fs.existsSync(extractPath)) {
          fs.rmSync(extractPath, { recursive: true })
        }
        return { error: '压缩包中未找到 SKILL.md 文件' }
      } catch (e) {
        console.error('[Skills] 解压失败:', e.message)
        return { error: '解压失败: ' + e.message }
      }
    } else if (filePath.endsWith('.md')) {
      const skill = parseSkillFile(filePath)
      if (skill) {
        const skillName = skill.name || path.basename(filePath, '.md')
        const destFolder = path.join(skillsDir, skillName)
        if (!fs.existsSync(destFolder)) {
          fs.mkdirSync(destFolder, { recursive: true })
        }
        fs.copyFileSync(filePath, path.join(destFolder, 'SKILL.md'))
        loadAllSkills()
        return { success: true, skill, message: `技能 "${skill.title || skill.name}" 导入成功` }
      } else {
        return { error: '解析技能文件失败' }
      }
    } else {
      return { error: '不支持的文件格式，请选择 .zip 或 .md 文件' }
    }
  })

  // 获取技能目录路径
  ipcMain.handle('get-skills-dir', () => {
    return config.getSkillsDir()
  })
}

module.exports = {
  parseSkillFile,
  loadBuiltinSkills,
  loadUserSkills,
  loadAllSkills,
  loadEnabledSkills,
  saveEnabledSkills,
  getEnabledSkillObjects,
  enableSkill,
  disableSkill,
  deleteSkill,
  uploadSkill,
  getAllSkillsForIPC,
  getEnabledSkillsForIPC,
  buildAutoAttachedSkillPrompt,
  registerSkillsIPC
}
