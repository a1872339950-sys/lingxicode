/**
 * 插件商城模块
 * - 读取仓库内 plugins/ 商城目录
 * - 安装到用户数据目录 {basePath}/plugins/
 * - 已安装插件的 Skill 注入技能系统（kind=plugin）
 */

const fs = require('fs')
const path = require('path')
const storageConfig = require('./storage-config')

const INSTALLED_FILE = 'installed.json'

function getMarketplaceRoot() {
  return path.join(__dirname, '../../plugins')
}

function getInstalledRoot() {
  return path.join(storageConfig.getBasePath(), 'plugins')
}

function ensureInstalledRoot() {
  const root = getInstalledRoot()
  if (!fs.existsSync(root)) {
    fs.mkdirSync(root, { recursive: true })
  }
  return root
}

function readJsonSafe(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return fallback
    return JSON.parse(fs.readFileSync(filePath, 'utf8'))
  } catch (e) {
    console.warn('[Plugins] read json failed:', filePath, e.message)
    return fallback
  }
}

function writeJson(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8')
}

function getInstalledIds() {
  const root = ensureInstalledRoot()
  const data = readJsonSafe(path.join(root, INSTALLED_FILE), { plugins: [] })
  return Array.isArray(data.plugins) ? data.plugins : []
}

function setInstalledIds(ids) {
  const root = ensureInstalledRoot()
  writeJson(path.join(root, INSTALLED_FILE), {
    plugins: Array.from(new Set(ids.filter(Boolean))),
    updatedAt: new Date().toISOString()
  })
}

function readPluginManifest(pluginDir) {
  const candidates = [
    path.join(pluginDir, '.codex-plugin', 'plugin.json'),
    path.join(pluginDir, 'plugin.json')
  ]
  for (const file of candidates) {
    if (fs.existsSync(file)) {
      const manifest = readJsonSafe(file, null)
      if (manifest && typeof manifest === 'object') return { manifest, file }
    }
  }
  return null
}

function normalizePluginSummary(manifest, extras = {}) {
  const iface = manifest.interface || {}
  return {
    id: manifest.name || extras.id || '',
    name: manifest.name || extras.id || '',
    version: manifest.version || '0.0.0',
    description: iface.shortDescription || manifest.description || '',
    longDescription: iface.longDescription || manifest.description || '',
    displayName: iface.displayName || manifest.name || extras.id || '',
    developerName: iface.developerName || manifest.author?.name || 'Unknown',
    category: iface.category || extras.category || 'General',
    brandColor: iface.brandColor || '#7C3AED',
    defaultPrompt: Array.isArray(iface.defaultPrompt) ? iface.defaultPrompt : [],
    capabilities: Array.isArray(iface.capabilities) ? iface.capabilities : [],
    logo: iface.logo || '',
    homepage: manifest.homepage || '',
    repository: typeof manifest.repository === 'string' ? manifest.repository : (manifest.repository?.url || ''),
    license: manifest.license || '',
    keywords: Array.isArray(manifest.keywords) ? manifest.keywords : [],
    websiteURL: iface.websiteURL || manifest.homepage || '',
    official: manifest.official !== false,
    thirdParty: manifest.thirdParty === true,
    ...extras
  }
}

function listMarketplaceCatalog() {
  const root = getMarketplaceRoot()
  const market = readJsonSafe(path.join(root, 'marketplace.json'), { plugins: [] })
  const installed = new Set(getInstalledIds())
  const entries = Array.isArray(market.plugins) ? market.plugins : []
  const list = []

  for (const entry of entries) {
    const pluginId = entry?.name
    if (!pluginId) continue
    const rel = entry.source?.path || `./${pluginId}`
    const pluginDir = path.resolve(root, rel)
    const loaded = readPluginManifest(pluginDir)
    if (!loaded) {
      list.push({
        id: pluginId,
        name: pluginId,
        displayName: pluginId,
        description: '插件清单缺失',
        category: entry.category || 'General',
        installed: installed.has(pluginId),
        available: false,
        error: 'plugin.json not found'
      })
      continue
    }
    list.push(normalizePluginSummary(loaded.manifest, {
      id: pluginId,
      category: entry.category || loaded.manifest.interface?.category || 'General',
      official: entry.official !== false && loaded.manifest.official !== false,
      thirdParty: entry.thirdParty === true || loaded.manifest.thirdParty === true,
      installed: installed.has(pluginId),
      available: true,
      policy: entry.policy || {},
      sourcePath: pluginDir
    }))
  }
  return {
    marketplace: {
      name: market.name || 'lingxi-official',
      displayName: market.interface?.displayName || '灵犀官方'
    },
    plugins: list
  }
}

function listInstalledPlugins() {
  const installedIds = getInstalledIds()
  const root = ensureInstalledRoot()
  const list = []
  for (const id of installedIds) {
    const pluginDir = path.join(root, id)
    const loaded = readPluginManifest(pluginDir)
    if (!loaded) {
      list.push({
        id,
        name: id,
        displayName: id,
        description: '已安装但清单损坏',
        installed: true,
        broken: true
      })
      continue
    }
    const skills = listPluginSkills(pluginDir, id, loaded.manifest)
    list.push(normalizePluginSummary(loaded.manifest, {
      id,
      installed: true,
      broken: false,
      installPath: pluginDir,
      skillCount: skills.length,
      skills: skills.map(s => ({ name: s.name, title: s.title, description: s.description }))
    }))
  }
  return list
}

/**
 * 改进 frontmatter 解析：支持 value 中的冒号与引号
 */
function parseSkillFile(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf8')
    const skill = { path: filePath }
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
    const contentMatch = content.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n([\s\S]*)/)
    skill.content = contentMatch ? contentMatch[1].trim() : content
    if (!skill.name) {
      skill.name = path.basename(path.dirname(filePath))
    }
    return skill
  } catch (e) {
    console.error('[Plugins] parse skill failed:', filePath, e.message)
    return null
  }
}

function listPluginSkills(pluginDir, pluginId, manifest) {
  const skillsDir = path.join(pluginDir, 'skills')
  if (!fs.existsSync(skillsDir)) return []
  const displayName = manifest?.interface?.displayName || manifest?.name || pluginId
  const shortDesc =
    manifest?.interface?.shortDescription ||
    manifest?.description ||
    `${displayName} 插件`
  const childSkills = []
  const folders = fs.readdirSync(skillsDir, { withFileTypes: true })
  for (const folder of folders) {
    if (!folder.isDirectory()) continue
    const skillPath = path.join(skillsDir, folder.name, 'SKILL.md')
    if (!fs.existsSync(skillPath)) continue
    const skill = parseSkillFile(skillPath)
    if (!skill) continue
    const baseName = skill.name || folder.name
    const namespaced = `${pluginId}__${baseName}`
    childSkills.push({
      ...skill,
      name: namespaced,
      title: baseName === 'index' ? displayName : (skill.title || `${displayName} · ${baseName}`),
      description: skill.description || '',
      content: skill.content || '',
      builtin: false,
      kind: 'plugin',
      pluginId,
      pluginName: displayName,
      pluginSkill: baseName,
      isPluginRoot: false
    })
  }

  if (!childSkills.length) return []

  // 聚合入口：输入框下拉只需要启用这一项即可使用整包
  const combinedParts = childSkills.map(s => {
    const label = s.pluginSkill || s.name
    return [
      `===== Plugin Skill: ${label} =====`,
      s.description ? `说明: ${s.description}` : '',
      '',
      s.content || ''
    ].filter(Boolean).join('\n')
  })

  const rootSkill = {
    name: pluginId,
    title: displayName,
    description: shortDesc,
    content: [
      `你正在使用灵犀插件「${displayName}」（${pluginId}）。`,
      '以下包含该插件的完整 Skill 包；请按用户任务选择最合适的流程执行。',
      `子 Skill：${childSkills.map(s => s.pluginSkill).join(', ')}`,
      '',
      combinedParts.join('\n\n')
    ].join('\n'),
    path: path.join(pluginDir, '.codex-plugin', 'plugin.json'),
    builtin: false,
    kind: 'plugin',
    pluginId,
    pluginName: displayName,
    pluginSkill: 'root',
    isPluginRoot: true,
    childSkillNames: childSkills.map(s => s.name)
  }

  // 根入口放最前，便于默认启用与下拉展示
  return [rootSkill, ...childSkills]
}

/**
 * 从磁盘合并已启用列表到 config，避免内存为空时写盘冲掉用户原有启用项
 */
function hydrateEnabledSkillsFromDisk() {
  const config = require('./config')
  const linguaBasePath = config.getLinguaBasePath()
  if (!linguaBasePath) return
  const enabledPath = path.join(linguaBasePath, 'enabled-skills.json')
  if (!fs.existsSync(enabledPath)) return
  try {
    const fromDisk = JSON.parse(fs.readFileSync(enabledPath, 'utf8'))
    if (!Array.isArray(fromDisk)) return
    // 磁盘为准做并集，不丢内存里已有、也不丢磁盘已有
    const merged = Array.from(new Set([...(config.getEnabledSkills() || []), ...fromDisk]))
    config.setEnabledSkills(merged)
  } catch (e) {
    console.warn('[Plugins] hydrate enabled skills failed:', e.message)
  }
}

/**
 * 将插件 Skill 写入启用池（惰性引用 skills，避免循环依赖初始化问题）
 */
function enablePluginSkillNames(skillNames, { onlyIfNoneEnabled = false } = {}) {
  const names = (skillNames || []).filter(Boolean)
  if (!names.length) return { changed: false, enabled: [] }

  const config = require('./config')
  hydrateEnabledSkillsFromDisk()
  const enabled = config.getEnabledSkills() || []
  if (onlyIfNoneEnabled && names.some(n => enabled.includes(n))) {
    return { changed: false, enabled: [] }
  }

  let changed = false
  const newly = []
  for (const name of names) {
    if (!enabled.includes(name)) {
      config.addEnabledSkill(name)
      newly.push(name)
      changed = true
    }
  }
  if (changed) {
    try {
      const skillsMod = require('./skills')
      if (typeof skillsMod.saveEnabledSkills === 'function') {
        skillsMod.saveEnabledSkills()
      } else {
        const linguaBasePath = config.getLinguaBasePath()
        if (linguaBasePath) {
          const enabledPath = path.join(linguaBasePath, 'enabled-skills.json')
          fs.writeFileSync(enabledPath, JSON.stringify(config.getEnabledSkills(), null, 2), 'utf8')
        }
      }
    } catch (e) {
      console.warn('[Plugins] save enabled skills failed:', e.message)
    }
  }
  return { changed, enabled: newly }
}

/**
 * 安装后 / 启动修复：已安装插件若完全不在启用池，则启用聚合入口
 * （避免「装了但下拉看不到」；用户主动禁用全部后，下次启动会再次露出入口）
 */
function ensureInstalledPluginsEnabled() {
  const config = require('./config')
  const enabled = config.getEnabledSkills() || []
  const installedIds = getInstalledIds()
  const root = ensureInstalledRoot()
  const newly = []
  for (const pluginId of installedIds) {
    const pluginDir = path.join(root, pluginId)
    const loaded = readPluginManifest(pluginDir)
    if (!loaded) continue
    const skills = listPluginSkills(pluginDir, pluginId, loaded.manifest)
    const names = skills.map(s => s.name)
    const anyEnabled = names.some(n => enabled.includes(n))
    if (anyEnabled) continue
    const result = enablePluginSkillNames([pluginId])
    newly.push(...result.enabled)
  }
  return newly
}

function loadInstalledPluginSkills() {
  const installedIds = getInstalledIds()
  const root = ensureInstalledRoot()
  const all = []
  for (const id of installedIds) {
    const pluginDir = path.join(root, id)
    const loaded = readPluginManifest(pluginDir)
    if (!loaded) continue
    all.push(...listPluginSkills(pluginDir, id, loaded.manifest))
  }
  return all
}

function copyDirRecursive(src, dest) {
  fs.mkdirSync(dest, { recursive: true })
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const from = path.join(src, entry.name)
    const to = path.join(dest, entry.name)
    if (entry.isDirectory()) {
      copyDirRecursive(from, to)
    } else if (entry.isFile()) {
      fs.copyFileSync(from, to)
    }
  }
}

function installPlugin(pluginId) {
  if (!pluginId || typeof pluginId !== 'string') {
    return { error: '无效的插件 ID' }
  }
  const catalog = listMarketplaceCatalog()
  const item = catalog.plugins.find(p => p.id === pluginId || p.name === pluginId)
  if (!item) return { error: `商城中未找到插件: ${pluginId}` }
  if (!item.available || !item.sourcePath) return { error: item.error || '插件源不可用' }

  const installedRoot = ensureInstalledRoot()
  const dest = path.join(installedRoot, pluginId)
  if (fs.existsSync(dest)) {
    fs.rmSync(dest, { recursive: true, force: true })
  }
  copyDirRecursive(item.sourcePath, dest)

  const ids = getInstalledIds()
  if (!ids.includes(pluginId)) ids.push(pluginId)
  setInstalledIds(ids)

  const loaded = readPluginManifest(dest)
  const skills = loaded ? listPluginSkills(dest, pluginId, loaded.manifest) : []
  // 默认只启用聚合入口，保证输入框下拉立即可见
  const rootName = pluginId
  enablePluginSkillNames([rootName])

  try {
    const skillsMod = require('./skills')
    skillsMod.loadAllSkills()
  } catch (_) { /* ignore */ }

  return {
    success: true,
    pluginId,
    displayName: loaded?.manifest?.interface?.displayName || pluginId,
    skillCount: skills.length,
    enabledSkills: [rootName],
    message: `已安装 ${loaded?.manifest?.interface?.displayName || pluginId}，已加入输入框可选技能`
  }
}

function uninstallPlugin(pluginId) {
  if (!pluginId) return { error: '无效的插件 ID' }
  const root = ensureInstalledRoot()
  const dest = path.join(root, pluginId)

  // 从启用池移除该插件全部 skill
  try {
    const loaded = readPluginManifest(dest)
    const skills = loaded ? listPluginSkills(dest, pluginId, loaded.manifest) : []
    const config = require('./config')
    for (const s of skills) {
      config.removeEnabledSkill(s.name)
    }
    config.removeEnabledSkill(pluginId)
    const skillsMod = require('./skills')
    if (typeof skillsMod.saveEnabledSkills === 'function') {
      skillsMod.saveEnabledSkills()
    }
  } catch (e) {
    console.warn('[Plugins] cleanup enabled skills failed:', e.message)
  }

  if (fs.existsSync(dest)) {
    fs.rmSync(dest, { recursive: true, force: true })
  }
  setInstalledIds(getInstalledIds().filter(id => id !== pluginId))

  try {
    const skillsMod = require('./skills')
    skillsMod.loadAllSkills()
  } catch (_) { /* ignore */ }

  return { success: true, pluginId, message: `已卸载 ${pluginId}` }
}

function registerPluginsIPC(ipcMain) {
  ipcMain.handle('plugins:listMarketplace', () => listMarketplaceCatalog())
  ipcMain.handle('plugins:listInstalled', () => listInstalledPlugins())
  ipcMain.handle('plugins:install', (event, pluginId) => installPlugin(pluginId))
  ipcMain.handle('plugins:uninstall', (event, pluginId) => uninstallPlugin(pluginId))
}

module.exports = {
  getMarketplaceRoot,
  getInstalledRoot,
  listMarketplaceCatalog,
  listInstalledPlugins,
  loadInstalledPluginSkills,
  ensureInstalledPluginsEnabled,
  enablePluginSkillNames,
  installPlugin,
  uninstallPlugin,
  registerPluginsIPC
}
