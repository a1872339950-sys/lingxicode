/**
 * 存储路径配置模块（统一版）
 * - 统一管理所有数据存储路径
 * - 配置文件按运行通道隔离：开发版保留旧目录，安装版使用 Stable 专用目录
 * - API 配置也纳入统一管理
 *
 * 目录结构：
 * {basePath}/
 *   ├── skills/        技能文件
 *   ├── plans/         方案文件
 *   ├── projects/      项目数据（上下文、历史、记忆）
 *   ├── artifacts/     长回复详情
 *   ├── summaries/     项目账本、任务档案、方案纪要
 *   ├── cache/         缓存
 *   └── config/        配置文件
 *       └── api-config.json  API 配置（模型列表）
 *
 * 配置文件位置：
 *   开发版：C:\Users\{用户}\.lingua\lingua-config.json
 *   安装版：Electron userData\config\lingua-config.json
 */

const fs = require('fs')
const path = require('path')
const os = require('os')

const TRASH_RETENTION_DAYS = [1, 3, 7, 15, 30]
const DEFAULT_TRASH_RETENTION_DAYS = 15
const DEFAULT_RECOVERY_POINT_CONFIG = {
  enabled: true,
  maxAutoPoints: 30,
  maxManualPoints: 30,
  maxAutoBytes: 2 * 1024 * 1024 * 1024,
  maxFileBytes: 50 * 1024 * 1024,
  maxObjectBytes: 50 * 1024 * 1024,
  maxProjectBytes: 5 * 1024 * 1024 * 1024
}
const BEHAVIOR_STYLE_VALUES = ['standard', 'plain', 'human', 'savage', 'cute']
const DEFAULT_BEHAVIOR_STYLE = 'standard'
const DEFAULT_BEHAVIOR_STYLE_CONFIG = {
  enabled: false,
  style: DEFAULT_BEHAVIOR_STYLE
}
const DEFAULT_WORKER_MODEL_CONFIG = {
  enabled: true,
  timeoutMs: 90000,
  local: {
    enabled: true,
    provider: 'ollama',
    apiUrl: 'http://127.0.0.1:11434',
    model: 'gemma4:e4b',
    keepAlive: '30s'
  },
  cloud: {
    enabled: true,
    modelKey: ''
  },
  tasks: {
    ledger: true,
    memory: true,
    summary: true,
  }
}
const DEFAULT_AI_OPERATION_MEMO_CONFIG = {
  autoSave: false
}
const DEFAULT_SMART_AUTHORIZATION_CONFIG = {
  enabled: true,
  timeoutMs: 12000,
  task: true,
  modelKey: ''
}

// 配置文件名
const CONFIG_FILE = 'lingua-config.json'
const API_CONFIG_FILE = 'api-config.json'
const PROJECTS_LIST_FILE = 'projects-list.json'  // 项目列表配置
const MODEL_CONFIG_DIR_NAME = '.lingxicode'
const PACKAGED_MODEL_CONFIG_DIR_NAME = '.lingxicode-stable'

// 子目录名称（固定）
const SUB_DIRS = {
  skills: 'skills',
  plans: 'plans',
  projects: 'projects',
  artifacts: 'artifacts',
  assets: 'assets',
  summaries: 'summaries',
  cache: 'cache',
  config: 'config'
}

// 当前配置
let config = {
  basePath: null,      // 用户自定义的基础路径
  defaultPath: null,   // 默认路径（安装目录 data 或开发环境 userData）
  configPath: null,    // 配置文件路径（固定位置）
  modelConfigDir: null,
  app: null,
  trashRetentionDays: DEFAULT_TRASH_RETENTION_DAYS,
  recoveryPoint: normalizeRecoveryPointConfig(),
  behaviorStyle: normalizeBehaviorStyleConfig(),
  workerModel: normalizeWorkerModelConfig(),
  aiOperationMemo: normalizeAiOperationMemoConfig(),
  smartAuthorization: normalizeSmartAuthorizationConfig()
}

/**
 * 初始化配置
 * @param {string} defaultStoragePath 默认存储路径
 * @param {object} appInstance Electron app 实例（可选，用于判断开发模式）
 */
function init(defaultStoragePath, appInstance = null) {
  config.defaultPath = defaultStoragePath
  config.app = appInstance

  const linguaConfigDir = appInstance?.isPackaged
    ? path.join(appInstance.getPath('userData'), 'config')
    : path.join(os.homedir(), '.lingua')
  
  // 确保配置目录存在
  if (!fs.existsSync(linguaConfigDir)) {
    fs.mkdirSync(linguaConfigDir, { recursive: true })
    console.log('[StorageConfig] 创建配置目录:', linguaConfigDir)
  }
  
  config.configPath = path.join(linguaConfigDir, CONFIG_FILE)
  config.modelConfigDir = path.join(os.homedir(), appInstance?.isPackaged ? PACKAGED_MODEL_CONFIG_DIR_NAME : MODEL_CONFIG_DIR_NAME)
  console.log('[StorageConfig] 配置文件路径:', config.configPath)

  // 加载已保存的配置
  loadConfig()

  // 确保目录存在
  ensureDirectories()
  cleanupTrash({ force: false })

  const actualPath = getBasePath()
  console.log('[StorageConfig] 初始化完成:')
  console.log('  默认路径:', config.defaultPath)
  console.log('  基础路径:', actualPath)
  console.log('  项目数据:', getProjectsDir())
  console.log('  API配置:', getApiConfigPath())
}

/**
 * 加载配置文件
 */
function loadConfig() {
  try {
    if (fs.existsSync(config.configPath)) {
      const data = fs.readFileSync(config.configPath, 'utf-8')
      const saved = JSON.parse(data)
      const savedBasePath = resolveStoredPath(saved.basePath, saved.installDataDir)
      const savedDefaultPath = resolveStoredPath(saved.defaultPath, saved.installDefaultDataDir)
      config.trashRetentionDays = normalizeTrashRetentionDays(saved.trashRetentionDays)
      config.recoveryPoint = normalizeRecoveryPointConfig(saved.recoveryPoint)
      config.behaviorStyle = normalizeBehaviorStyleConfig(saved.behaviorStyle)
      config.workerModel = normalizeWorkerModelConfig(saved.workerModel)
      config.aiOperationMemo = normalizeAiOperationMemoConfig(saved.aiOperationMemo)
      config.smartAuthorization = normalizeSmartAuthorizationConfig(saved.smartAuthorization)

      if (savedDefaultPath && (!config.app?.isPackaged || fs.existsSync(savedDefaultPath))) {
        config.defaultPath = savedDefaultPath
      } else if (savedDefaultPath && config.app?.isPackaged) {
        console.log('[StorageConfig] 已保存的安装版默认路径不可用，继续使用安装器数据指针:', config.defaultPath)
      }

      if (savedBasePath) {
        config.basePath = savedBasePath
        console.log('[StorageConfig] 使用自定义路径:', savedBasePath)
      } else if (saved.basePath) {
        console.log('[StorageConfig] 自定义路径不可用，使用默认路径')
      }
      
      // 检查是否需要从旧的 userData 位置迁移配置
      if (saved.migratedFromUserData) {
        console.log('[StorageConfig] 已从旧位置迁移配置')
      }
    }
  } catch (e) {
    console.error('[StorageConfig] 加载配置失败:', e.message)
  }
}

function resolveStoredPath(value, fallback = '') {
  const text = String(value || '').trim()
  if (!text) return ''
  const envMatch = text.match(/^%([^%]+)%$/)
  if (envMatch) {
    return process.env[envMatch[1]] || fallback || ''
  }
  return text
}

function normalizeTrashRetentionDays(value) {
  const days = Number.parseInt(value, 10)
  return TRASH_RETENTION_DAYS.includes(days) ? days : DEFAULT_TRASH_RETENTION_DAYS
}

function normalizeRecoveryPointConfig(value = {}) {
  const source = value && typeof value === 'object' ? value : {}
  const mb = 1024 * 1024
  const gb = 1024 * mb
  return {
    enabled: source.enabled !== undefined ? !!source.enabled : DEFAULT_RECOVERY_POINT_CONFIG.enabled,
    maxAutoPoints: Math.max(3, Math.min(200, Number.parseInt(source.maxAutoPoints, 10) || DEFAULT_RECOVERY_POINT_CONFIG.maxAutoPoints)),
    maxManualPoints: Math.max(3, Math.min(200, Number.parseInt(source.maxManualPoints, 10) || DEFAULT_RECOVERY_POINT_CONFIG.maxManualPoints)),
    maxAutoBytes: Math.max(128 * mb, Math.min(50 * gb, Number.parseInt(source.maxAutoBytes, 10) || DEFAULT_RECOVERY_POINT_CONFIG.maxAutoBytes)),
    maxFileBytes: Math.max(1 * mb, Math.min(1024 * mb, Number.parseInt(source.maxFileBytes, 10) || DEFAULT_RECOVERY_POINT_CONFIG.maxFileBytes)),
    maxObjectBytes: Math.max(1 * mb, Math.min(1024 * mb, Number.parseInt(source.maxObjectBytes, 10) || DEFAULT_RECOVERY_POINT_CONFIG.maxObjectBytes)),
    maxProjectBytes: Math.max(128 * mb, Math.min(100 * gb, Number.parseInt(source.maxProjectBytes, 10) || DEFAULT_RECOVERY_POINT_CONFIG.maxProjectBytes))
  }
}

function getRecoveryPointConfig() {
  config.recoveryPoint = normalizeRecoveryPointConfig(config.recoveryPoint)
  return JSON.parse(JSON.stringify(config.recoveryPoint))
}

function saveRecoveryPointConfig(nextConfig = {}) {
  config.recoveryPoint = normalizeRecoveryPointConfig(nextConfig)
  const result = saveConfig()
  return { ...result, data: getRecoveryPointConfig() }
}

function normalizeBehaviorStyleConfig(value = {}) {
  const source = value && typeof value === 'object' ? value : {}
  const style = BEHAVIOR_STYLE_VALUES.includes(source.style) ? source.style : DEFAULT_BEHAVIOR_STYLE
  return {
    enabled: source.enabled !== undefined ? !!source.enabled : DEFAULT_BEHAVIOR_STYLE_CONFIG.enabled,
    style
  }
}

function getBehaviorStyleConfig() {
  config.behaviorStyle = normalizeBehaviorStyleConfig(config.behaviorStyle)
  return JSON.parse(JSON.stringify(config.behaviorStyle))
}

function saveBehaviorStyleConfig(nextConfig = {}) {
  config.behaviorStyle = normalizeBehaviorStyleConfig(nextConfig)
  const result = saveConfig()
  return { ...result, data: getBehaviorStyleConfig() }
}

function normalizeWorkerModelConfig(value = {}) {
  const source = value && typeof value === 'object' ? value : {}
  const local = source.local && typeof source.local === 'object' ? source.local : {}
  const cloud = source.cloud && typeof source.cloud === 'object' ? source.cloud : {}
  const tasks = source.tasks && typeof source.tasks === 'object' ? source.tasks : {}
  return {
    enabled: source.enabled !== undefined ? !!source.enabled : DEFAULT_WORKER_MODEL_CONFIG.enabled,
    timeoutMs: Math.max(10000, Math.min(300000, Number.parseInt(source.timeoutMs, 10) || DEFAULT_WORKER_MODEL_CONFIG.timeoutMs)),
    local: {
      enabled: local.enabled !== undefined ? !!local.enabled : DEFAULT_WORKER_MODEL_CONFIG.local.enabled,
      provider: 'ollama',
      apiUrl: String(local.apiUrl || DEFAULT_WORKER_MODEL_CONFIG.local.apiUrl).trim(),
      model: String(local.model || DEFAULT_WORKER_MODEL_CONFIG.local.model).trim(),
      keepAlive: String(local.keepAlive || DEFAULT_WORKER_MODEL_CONFIG.local.keepAlive).trim()
    },
    cloud: {
      enabled: cloud.enabled !== undefined ? !!cloud.enabled : DEFAULT_WORKER_MODEL_CONFIG.cloud.enabled,
      modelKey: String(cloud.modelKey || '').trim()
    },
    tasks: {
      ledger: tasks.ledger !== undefined ? !!tasks.ledger : DEFAULT_WORKER_MODEL_CONFIG.tasks.ledger,
      memory: tasks.memory !== undefined ? !!tasks.memory : DEFAULT_WORKER_MODEL_CONFIG.tasks.memory,
      summary: tasks.summary !== undefined ? !!tasks.summary : DEFAULT_WORKER_MODEL_CONFIG.tasks.summary,
    }
  }
}

function getWorkerModelConfig() {
  config.workerModel = normalizeWorkerModelConfig(config.workerModel)
  return JSON.parse(JSON.stringify(config.workerModel))
}

function saveWorkerModelConfig(nextConfig = {}) {
  config.workerModel = normalizeWorkerModelConfig(nextConfig)
  const result = saveConfig()
  return { ...result, data: getWorkerModelConfig() }
}

function normalizeAiOperationMemoConfig(value = {}) {
  const source = value && typeof value === 'object' ? value : {}
  return {
    autoSave: source.autoSave !== undefined ? !!source.autoSave : DEFAULT_AI_OPERATION_MEMO_CONFIG.autoSave
  }
}

function getAiOperationMemoConfig() {
  config.aiOperationMemo = normalizeAiOperationMemoConfig(config.aiOperationMemo)
  return { ...config.aiOperationMemo }
}

function saveAiOperationMemoConfig(nextConfig = {}) {
  config.aiOperationMemo = normalizeAiOperationMemoConfig(nextConfig)
  const result = saveConfig()
  return { ...result, data: getAiOperationMemoConfig() }
}

function normalizeSmartAuthorizationConfig(value = {}) {
  const source = value && typeof value === 'object' ? value : {}
  return {
    enabled: source.enabled !== undefined ? !!source.enabled : DEFAULT_SMART_AUTHORIZATION_CONFIG.enabled,
    timeoutMs: Math.max(3000, Math.min(30000, Number.parseInt(source.timeoutMs, 10) || DEFAULT_SMART_AUTHORIZATION_CONFIG.timeoutMs)),
    task: source.task !== undefined ? !!source.task : DEFAULT_SMART_AUTHORIZATION_CONFIG.task,
    modelKey: String(source.modelKey || '').trim()
  }
}

function getSmartAuthorizationConfig() {
  config.smartAuthorization = normalizeSmartAuthorizationConfig(config.smartAuthorization)
  return { ...config.smartAuthorization }
}

function saveSmartAuthorizationConfig(nextConfig = {}) {
  config.smartAuthorization = normalizeSmartAuthorizationConfig(nextConfig)
  const result = saveConfig()
  return { ...result, data: getSmartAuthorizationConfig() }
}

function normalizeOllamaBaseUrl(apiUrl = '') {
  return String(apiUrl || DEFAULT_WORKER_MODEL_CONFIG.local.apiUrl || 'http://127.0.0.1:11434')
    .trim()
    .replace(/\/+$/, '')
}

async function scanLocalModels(options = {}) {
  const workerConfig = getWorkerModelConfig()
  const apiUrl = normalizeOllamaBaseUrl(options.apiUrl || workerConfig.local?.apiUrl)
  const controller = new AbortController()
  const timeoutMs = Math.max(3000, Math.min(Number(options.timeoutMs || 8000), 30000))
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(`${apiUrl}/api/tags`, { signal: controller.signal })
    if (!response.ok) {
      const text = await response.text().catch(() => '')
      throw new Error(`Ollama ${response.status}: ${text || response.statusText}`)
    }
    const data = await response.json()
    const models = (Array.isArray(data?.models) ? data.models : [])
      .map(item => ({
        name: String(item.name || item.model || '').trim(),
        model: String(item.model || item.name || '').trim(),
        size: Number(item.size || 0),
        modifiedAt: item.modified_at || item.modifiedAt || '',
        digest: item.digest || '',
        details: item.details || {}
      })
)
      .filter(item => item.name)
    return { success: true, apiUrl, models }
  } finally {
    clearTimeout(timer)
  }
}

function getTrashDir() {
  return path.join(getCacheDir(), 'trash')
}

function getProjectTrashDir() {
  return path.join(getTrashDir(), 'projects')
}

function getTrashRetentionDays() {
  config.trashRetentionDays = normalizeTrashRetentionDays(config.trashRetentionDays)
  return config.trashRetentionDays
}

function setTrashRetentionDays(days) {
  config.trashRetentionDays = normalizeTrashRetentionDays(days)
  return saveConfig()
}

function walkDirStats(dir) {
  const stats = { size: 0, count: 0, oldestMtimeMs: null }
  if (!fs.existsSync(dir)) return stats

  const entries = fs.readdirSync(dir, { withFileTypes: true })
  for (const entry of entries) {
    const target = path.join(dir, entry.name)
    const stat = fs.statSync(target)
    stats.count += 1
    stats.oldestMtimeMs = stats.oldestMtimeMs === null
      ? stat.mtimeMs
      : Math.min(stats.oldestMtimeMs, stat.mtimeMs)
    if (entry.isDirectory()) {
      const child = walkDirStats(target)
      stats.size += child.size
      stats.count += child.count
      if (child.oldestMtimeMs !== null) {
        stats.oldestMtimeMs = Math.min(stats.oldestMtimeMs, child.oldestMtimeMs)
      }
    } else {
      stats.size += stat.size
    }
  }
  return stats
}

function getTrashStatus() {
  const trashDir = getTrashDir()
  const projectTrashDir = getProjectTrashDir()
  const stats = walkDirStats(trashDir)
  return {
    path: trashDir,
    projectTrashPath: projectTrashDir,
    retentionDays: getTrashRetentionDays(),
    allowedRetentionDays: TRASH_RETENTION_DAYS,
    size: stats.size,
    count: stats.count,
    oldestMtimeMs: stats.oldestMtimeMs
  }
}

function cleanupTrash(options = {}) {
  const force = !!options.force
  const trashDir = getTrashDir()
  const projectTrashDir = getProjectTrashDir()
  if (!fs.existsSync(projectTrashDir)) return { success: true, removedCount: 0, freedBytes: 0 }

  const cutoff = Date.now() - getTrashRetentionDays() * 24 * 60 * 60 * 1000
  let removedCount = 0
  let freedBytes = 0

  for (const name of fs.readdirSync(projectTrashDir)) {
    const target = path.join(projectTrashDir, name)
    const stat = fs.statSync(target)
    if (!force && stat.mtimeMs > cutoff) continue
    const before = walkDirStats(target)
    fs.rmSync(target, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
    removedCount += 1
    freedBytes += before.size
  }

  return { success: true, removedCount, freedBytes, trashDir }
}

/**
 * 保存配置文件
 */
function saveConfig() {
  try {
    const data = {
      basePath: config.basePath,
      defaultPath: config.defaultPath,
      trashRetentionDays: normalizeTrashRetentionDays(config.trashRetentionDays),
      recoveryPoint: getRecoveryPointConfig(),
      behaviorStyle: getBehaviorStyleConfig(),
      workerModel: getWorkerModelConfig(),
      aiOperationMemo: getAiOperationMemoConfig(),
      smartAuthorization: getSmartAuthorizationConfig(),
      timestamp: Date.now(),
      version: '2.0'  // 新版本标记
    }
    fs.writeFileSync(config.configPath, JSON.stringify(data, null, 2))
    console.log('[StorageConfig] 配置已保存:', config.configPath)
    return { success: true }
  } catch (e) {
    console.error('[StorageConfig] 保存配置失败:', e.message)
    return { success: false, error: e.message }
  }
}

/**
 * 确保所有目录存在
 */
function ensureDirectories() {
  const dirs = [getSkillsDir(), getPlansDir(), getProjectsDir(), getArtifactsDir(), getAssetsDir(), getSummariesDir(), getCacheDir(), getConfigDir()]
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true })
      console.log('[StorageConfig] 创建目录:', dir)
    }
  }
  const modelConfigDir = getModelConfigDir()
  if (!fs.existsSync(modelConfigDir)) {
    fs.mkdirSync(modelConfigDir, { recursive: true })
    console.log('[StorageConfig] Created model config directory:', modelConfigDir)
  }
}

/**
 * 获取实际使用的基础路径
 */
function getBasePath() {
  return config.basePath || config.defaultPath
}

/**
 * 获取配置目录
 */
function getConfigDir() {
  return path.join(getBasePath(), SUB_DIRS.config)
}

function getModelConfigDir() {
  return config.modelConfigDir || path.join(os.homedir(), MODEL_CONFIG_DIR_NAME)
}

function getLegacyApiConfigPath() {
  return path.join(getConfigDir(), API_CONFIG_FILE)
}

function migrateLegacyApiConfigIfNeeded() {
  const nextPath = getApiConfigPath()
  const legacyPath = getLegacyApiConfigPath()
  try {
    if (fs.existsSync(nextPath) || !fs.existsSync(legacyPath)) {
      return { migrated: false }
    }
    const modelConfigDir = getModelConfigDir()
    if (!fs.existsSync(modelConfigDir)) fs.mkdirSync(modelConfigDir, { recursive: true })
    fs.copyFileSync(legacyPath, nextPath)
    console.log('[StorageConfig] Migrated API model config to user profile:', nextPath)
    return { migrated: true, from: legacyPath, to: nextPath }
  } catch (e) {
    console.error('[StorageConfig] migrate legacy API config failed:', e.message)
    return { migrated: false, error: e.message }
  }
}

/**
 * 获取 API 配置文件路径
 */
function getApiConfigPath() {
  return path.join(getModelConfigDir(), API_CONFIG_FILE)
}

/**
 * 获取项目列表配置文件路径
 */
function getProjectsListPath() {
  return path.join(getConfigDir(), PROJECTS_LIST_FILE)
}

/**
 * 设置基础路径（统一设置所有路径）
 * @param {string} newPath 新的基础路径
 * @param {boolean} migrate 是否迁移旧数据（默认 true）
 */
function setBasePath(newPath, migrate = true) {
  const oldPath = getBasePath()
  const resolvedOldPath = path.resolve(oldPath)
  const resolvedNewPath = path.resolve(newPath)

  // 如果路径相同，不做任何操作
  if (resolvedOldPath === resolvedNewPath) {
    return { success: true, message: '路径未改变' }
  }

  // 如果需要迁移数据
  let migrateResult = { success: true, migratedCount: 0, removedCount: 0, retainedCount: 0 }
  if (migrate && oldPath) {
    migrateResult = migrateData(oldPath, newPath)
    if (!migrateResult.success) {
      console.error('[StorageConfig] 数据迁移失败:', migrateResult.error)
      return migrateResult
    }
  }

  config.basePath = newPath
  ensureDirectories()
  const result = saveConfig()

  return {
    ...result,
    migrated: migrate,
    migration: migrateResult,
    oldPath,
    newPath
  }
}

/**
 * 迁移数据到新路径（包括 API 配置）
 * @param {string} oldPath 旧路径
 * @param {string} newPath 新路径
 */
function migrateData(oldPath, newPath) {
  try {
    console.log('[StorageConfig] 开始迁移数据:', oldPath, '→', newPath)

    const resolvedOldPath = path.resolve(oldPath)
    const resolvedNewPath = path.resolve(newPath)
    if (resolvedOldPath === resolvedNewPath) {
      return { success: true, migratedCount: 0, removedCount: 0, retainedCount: 0, message: '路径未改变' }
    }
    if (resolvedNewPath.startsWith(resolvedOldPath + path.sep)) {
      return { success: false, error: '新路径不能是旧路径的子目录，避免迁移时递归复制自身' }
    }

    const dirsToMigrate = ['skills', 'plans', 'projects', 'artifacts', 'summaries', 'cache', 'config']
    let migratedCount = 0
    let removedCount = 0
    let retainedCount = 0

    for (const dirName of dirsToMigrate) {
      const oldDir = path.join(oldPath, dirName)
      const newDir = path.join(newPath, dirName)

      // 检查旧目录是否存在且有内容
      if (!fs.existsSync(oldDir)) {
        console.log('[StorageConfig] 跳过（不存在）:', oldDir)
        continue
      }

      // 检查旧目录是否有文件
      const files = fs.readdirSync(oldDir)
      if (files.length === 0) {
        console.log('[StorageConfig] 跳过（空目录）:', oldDir)
        continue
      }

      // 确保新目录存在
      if (!fs.existsSync(newDir)) {
        fs.mkdirSync(newDir, { recursive: true })
      }

      // 复制文件（不覆盖已存在的），成功复制后清理旧文件，避免旧路径长期残留。
      for (const file of files) {
        const oldFile = path.join(oldDir, file)
        const newFile = path.join(newDir, file)
        if (dirName === SUB_DIRS.config && file === API_CONFIG_FILE) {
          console.log('[StorageConfig] 跳过模型 API 配置迁移:', oldFile)
          retainedCount++
          continue
        }

        // 如果新路径已存在同名文件，跳过
        if (fs.existsSync(newFile)) {
          console.log('[StorageConfig] 跳过已存在:', newFile)
          retainedCount++
          continue
        }

        // 复制文件或目录
        if (fs.statSync(oldFile).isDirectory()) {
          copyDirectoryRecursive(oldFile, newFile)
        } else {
          fs.copyFileSync(oldFile, newFile)
        }
        migratedCount++
        console.log('[StorageConfig] 已复制:', file)

        removePathRecursive(oldFile)
        removedCount++
        console.log('[StorageConfig] 已清理旧数据:', oldFile)
      }

      removeEmptyDirs(oldDir)
    }

    console.log('[StorageConfig] 迁移完成，共复制', migratedCount, '项，清理', removedCount, '项，保留', retainedCount, '项')
    return { success: true, migratedCount, removedCount, retainedCount }

  } catch (e) {
    console.error('[StorageConfig] 迁移失败:', e.message)
    return { success: false, error: e.message }
  }
}

/**
 * 递归复制目录
 */
function copyDirectoryRecursive(src, dest) {
  if (!fs.existsSync(dest)) {
    fs.mkdirSync(dest, { recursive: true })
  }

  const entries = fs.readdirSync(src, { withFileTypes: true })

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name)
    const destPath = path.join(dest, entry.name)

    if (entry.isDirectory()) {
      copyDirectoryRecursive(srcPath, destPath)
    } else {
      // 不覆盖已存在的文件
      if (!fs.existsSync(destPath)) {
        fs.copyFileSync(srcPath, destPath)
      }
    }
  }
}

function removePathRecursive(targetPath) {
  if (!fs.existsSync(targetPath)) return
  fs.rmSync(targetPath, { recursive: true, force: true })
}

function removeEmptyDirs(dir) {
  let current = dir
  const base = path.resolve(getBasePath())

  while (current && path.resolve(current).startsWith(base)) {
    if (!fs.existsSync(current)) return
    const entries = fs.readdirSync(current)
    if (entries.length > 0) return
    fs.rmdirSync(current)
    if (path.resolve(current) === base) return
    current = path.dirname(current)
  }
}

/**
 * 重置为默认路径（同时迁移数据回默认路径）
 */
function resetToDefault() {
  const oldPath = getBasePath()
  const newPath = config.defaultPath

  // 如果有自定义路径，迁移数据回默认路径
  if (config.basePath && oldPath !== newPath) {
    const result = migrateData(oldPath, newPath)
    if (!result.success) return result
  }

  config.basePath = null
  ensureDirectories()
  return saveConfig()
}

// ===== API 配置管理 =====

/**
 * 获取 API 配置
 * @returns {object} { success, data?, error? }
 */
function getApiConfig() {
  try {
    migrateLegacyApiConfigIfNeeded()
    const configPath = getApiConfigPath()
    
    if (!fs.existsSync(configPath)) {
      // 返回默认配置
      return { 
        success: true, 
        data: {
          models: [],
          currentIndex: 0,
          capabilityRouting: {}
        },
        isNew: true
      }
    }

    const data = fs.readFileSync(configPath, 'utf-8')
    const savedData = JSON.parse(data)
    
    // 返回实际的模型数据（兼容新旧格式）
    // 新格式: { models: [...], currentIndex: ..., lastModified: ... }
    // 旧格式: { models: [...], currentIndex: ... }
    const models = savedData.models || []
    const parsedIndex = Number.isInteger(savedData.currentIndex)
      ? savedData.currentIndex
      : parseInt(savedData.currentIndex, 10)
    const currentIndex = Number.isFinite(parsedIndex) ? parsedIndex : (models.length > 0 ? 0 : -1)
    
    console.log('[StorageConfig] 读取 API 配置成功，共', models.length, '个模型')
    
    const capabilityRouting = savedData.capabilityRouting && typeof savedData.capabilityRouting === 'object'
      ? savedData.capabilityRouting
      : {}
    const capabilityPolicies = savedData.capabilityPolicies && typeof savedData.capabilityPolicies === 'object'
      ? savedData.capabilityPolicies
      : {}
    const currentModelKey = String(savedData.currentModelKey || '').trim()
    return { success: true, data: { models, currentIndex, currentModelKey, capabilityRouting, capabilityPolicies } }
  } catch (e) {
    console.error('[StorageConfig] 读取 API 配置失败:', e.message)
    return { success: false, error: e.message }
  }
}

/**
 * 保存 API 配置
 * @param {object} apiConfig API 配置对象 { models, currentIndex }
 * @returns {object} { success, error? }
 */
function saveApiConfig(apiConfig) {
  try {
    const configDir = getModelConfigDir()
    
    // 确保配置目录存在
    if (!fs.existsSync(configDir)) {
      fs.mkdirSync(configDir, { recursive: true })
    }
    
    const configPath = getApiConfigPath()
    
    const data = {
      ...apiConfig,
      lastModified: Date.now()
    }
    
    fs.writeFileSync(configPath, JSON.stringify(data, null, 2))
    console.log('[StorageConfig] API 配置已保存:', configPath)
    
    return { success: true }
  } catch (e) {
    console.error('[StorageConfig] 保存 API 配置失败:', e.message)
    return { success: false, error: e.message }
  }
}

/**
 * 从 localStorage 格式迁移 API 配置
 * @param {object} localStorageData { savedModels, currentModelIndex }
 * @returns {object} { success, migratedCount? }
 */
function migrateFromLocalStorage(localStorageData) {
  try {
    const { savedModels, currentModelIndex, capabilityRouting, capabilityPolicies } = localStorageData
    
    if (!savedModels || savedModels.length === 0) {
      return { success: true, message: '没有需要迁移的数据' }
    }
    
    // 检查是否已有配置
    const existing = getApiConfig()
    if (existing.success && existing.data?.models?.length > 0) {
      console.log('[StorageConfig] API 配置已存在，跳过迁移')
      return { success: true, message: '配置已存在，跳过迁移' }
    }
    
    // 迁移数据
    const apiConfig = {
      models: savedModels,
      currentIndex: Number.isInteger(currentModelIndex) ? currentModelIndex : 0,
      capabilityRouting: capabilityRouting && typeof capabilityRouting === 'object' ? capabilityRouting : {},
      capabilityPolicies: capabilityPolicies && typeof capabilityPolicies === 'object' ? capabilityPolicies : {}
    }
    
    const result = saveApiConfig(apiConfig)
    
    if (result.success) {
      console.log('[StorageConfig] 已从 localStorage 迁移 API 配置，共', savedModels.length, '个模型')
      return { success: true, migratedCount: savedModels.length }
    }
    
    return result
  } catch (e) {
    console.error('[StorageConfig] 迁移 API 配置失败:', e.message)
    return { success: false, error: e.message }
  }
}

// ===== 项目列表配置管理 =====

/**
 * 获取项目列表配置
 * @returns {object} { success, data?, error? }
 */
function getProjectsList() {
  try {
    const listPath = getProjectsListPath()
    
    if (!fs.existsSync(listPath)) {
      // 返回空列表
      return { 
        success: true, 
        data: [],
        isNew: true
      }
    }

    const data = fs.readFileSync(listPath, 'utf-8')
    const savedData = JSON.parse(data)
    
    // 返回实际的项目数组（兼容新旧格式）
    // 新格式: { projects: [...], lastModified: ... }
    // 旧格式: [...] (直接数组)
    const projects = savedData.projects || savedData || []
    
    console.log('[StorageConfig] 读取项目列表成功，共', projects.length, '个项目')
    
    return { success: true, data: projects }
  } catch (e) {
    console.error('[StorageConfig] 读取项目列表失败:', e.message)
    return { success: false, error: e.message }
  }
}

/**
 * 保存项目列表配置
 * @param {array} projectsList 项目列表 [{ id, path, modelIndex, skillName }]
 * @returns {object} { success, error? }
 */
function saveProjectsList(projectsList) {
  try {
    const configDir = getConfigDir()
    
    // 确保配置目录存在
    if (!fs.existsSync(configDir)) {
      fs.mkdirSync(configDir, { recursive: true })
    }
    
    const listPath = getProjectsListPath()
    
    const data = {
      projects: projectsList,
      lastModified: Date.now()
    }
    
    fs.writeFileSync(listPath, JSON.stringify(data, null, 2))
    console.log('[StorageConfig] 项目列表已保存:', listPath, '共', projectsList.length, '个项目')
    
    return { success: true }
  } catch (e) {
    console.error('[StorageConfig] 保存项目列表失败:', e.message)
    return { success: false, error: e.message }
  }
}

/**
 * 从 localStorage 格式迁移项目列表
 * @param {array} localStorageProjects localStorage 中存储的项目列表
 * @returns {object} { success, migratedCount? }
 */
function migrateProjectsFromLocalStorage(localStorageProjects) {
  try {
    if (!localStorageProjects || localStorageProjects.length === 0) {
      return { success: true, message: '没有需要迁移的项目' }
    }
    
    // 检查是否已有配置（检查实际的 projects 数组长度）
    const existing = getProjectsList()
    if (existing.success && existing.data && existing.data.length > 0) {
      console.log('[StorageConfig] 项目列表已存在，跳过迁移')
      return { success: true, message: '项目列表已存在，跳过迁移' }
    }
    
    // 迁移数据
    const result = saveProjectsList(localStorageProjects)
    
    if (result.success) {
      console.log('[StorageConfig] 已从 localStorage 迁移项目列表，共', localStorageProjects.length, '个项目')
      return { success: true, migratedCount: localStorageProjects.length }
    }
    
    return result
  } catch (e) {
    console.error('[StorageConfig] 迁移项目列表失败:', e.message)
    return { success: false, error: e.message }
  }
}

// ===== 获取路径 =====

function getSkillsDir() {
  return path.join(getBasePath(), SUB_DIRS.skills)
}

function getPlansDir() {
  return path.join(getBasePath(), SUB_DIRS.plans)
}

function getProjectsDir() {
  return path.join(getBasePath(), SUB_DIRS.projects)
}

function getArtifactsDir() {
  return path.join(getBasePath(), SUB_DIRS.artifacts)
}

function getAssetsDir() {
  return path.join(getBasePath(), SUB_DIRS.assets)
}

function getProjectAssetsDir(projectId = 'common') {
  const safeProjectId = String(projectId || 'common').replace(/[<>:"/\\|?*\x00-\x1f]/g, '-')
  return path.join(getAssetsDir(), safeProjectId || 'common')
}

function getSummariesDir() {
  return path.join(getBasePath(), SUB_DIRS.summaries)
}

function getCacheDir() {
  return path.join(getBasePath(), SUB_DIRS.cache)
}

function getProjectDataDir(projectId) {
  return path.join(getProjectsDir(), projectId)
}

/**
 * 获取配置状态
 */
function getDiskUsage(targetPath = getBasePath()) {
  try {
    const stats = fs.statfsSync(targetPath)
    const total = Number(stats.blocks || 0) * Number(stats.bsize || 0)
    const free = Number(stats.bavail ?? stats.bfree ?? 0) * Number(stats.bsize || 0)
    return { total, free, used: Math.max(0, total - free) }
  } catch (_) {
    return { total: 0, free: 0, used: 0 }
  }
}

function getManagedDataUsage() {
  try {
    const stats = walkDirStats(getBasePath())
    return {
      size: Number(stats.size || 0),
      count: Number(stats.count || 0)
    }
  } catch (error) {
    console.warn('[StorageConfig] Failed to calculate managed data usage:', error.message)
    return { size: 0, count: 0 }
  }
}

function getStatus() {
  return {
    basePath: getBasePath(),
    isCustom: config.basePath !== null,
    defaultPath: config.defaultPath,
    configPath: config.configPath,
    modelConfigPath: getApiConfigPath(),
    modelConfigDir: getModelConfigDir(),
    isPackaged: !!config.app?.isPackaged,
    disk: getDiskUsage(),
    managedData: getManagedDataUsage(),
    paths: {
      skills: getSkillsDir(),
      plans: getPlansDir(),
      projects: getProjectsDir(),
      artifacts: getArtifactsDir(),
      assets: getAssetsDir(),
      summaries: getSummariesDir(),
      cache: getCacheDir(),
      config: getConfigDir()
    }
  }
}

/**
 * 注册存储配置的 IPC 处理函数
 * @param {object} ipcMain Electron 的 ipcMain 对象
 * @param {object} dialog Electron 的 dialog 对象
 */
function registerIPC(ipcMain, dialog) {
  // ===== 存储路径相关 =====
  
  // 获取存储状态
  ipcMain.handle('storage:getStatus', async (event) => {
    try {
      return { success: true, ...getStatus() }
    } catch (e) {
      console.error('[StorageConfig] getStatus 失败:', e.message)
      return { success: false, error: e.message }
    }
  })

  // 设置新的存储路径
  ipcMain.handle('storage:setPath', async (event, newPath, migrate = true) => {
    try {
      const result = setBasePath(newPath, migrate)
      return { success: true, ...result }
    } catch (e) {
      console.error('[StorageConfig] setPath 失败:', e.message)
      return { success: false, error: e.message }
    }
  })

  // 重置为默认路径
  ipcMain.handle('storage:resetPath', async (event) => {
    try {
      const result = resetToDefault()
      return { success: true, ...result }
    } catch (e) {
      console.error('[StorageConfig] resetPath 失败:', e.message)
      return { success: false, error: e.message }
    }
  })

  // 打开路径选择对话框
  ipcMain.handle('storage:selectPath', async (event) => {
    try {
      const result = await dialog.showOpenDialog({
        title: '选择数据存储路径',
        message: '选择一个文件夹来存储灵犀的数据（技能、方案、上下文、记忆、配置等）',
        properties: ['openDirectory', 'createDirectory'],
        buttonLabel: '选择此文件夹'
      })
      
      if (result.canceled || result.filePaths.length === 0) {
        return { success: false, canceled: true }
      }
      
      return { success: true, path: result.filePaths[0] }
    } catch (e) {
      console.error('[StorageConfig] selectPath 失败:', e.message)
      return { success: false, error: e.message }
    }
  })

  // ===== API 配置相关 =====
  
  // 获取 API 配置
  ipcMain.handle('storage:getTrashStatus', async () => {
    try {
      return { success: true, ...getTrashStatus() }
    } catch (e) {
      console.error('[StorageConfig] getTrashStatus failed:', e.message)
      return { success: false, error: e.message }
    }
  })

  ipcMain.handle('storage:setTrashRetentionDays', async (event, days) => {
    try {
      const result = setTrashRetentionDays(days)
      return { success: true, retentionDays: getTrashRetentionDays(), ...result }
    } catch (e) {
      console.error('[StorageConfig] setTrashRetentionDays failed:', e.message)
      return { success: false, error: e.message }
    }
  })

  ipcMain.handle('storage:cleanupTrash', async (event, options = {}) => {
    try {
      return cleanupTrash(options)
    } catch (e) {
      console.error('[StorageConfig] cleanupTrash failed:', e.message)
      return { success: false, error: e.message }
    }
  })

  ipcMain.handle('storage:getWorkerModelConfig', async () => {
    try {
      return { success: true, data: getWorkerModelConfig() }
    } catch (e) {
      console.error('[StorageConfig] getWorkerModelConfig failed:', e.message)
      return { success: false, error: e.message }
    }
  })

  ipcMain.handle('storage:saveWorkerModelConfig', async (event, workerModelConfig) => {
    try {
      return saveWorkerModelConfig(workerModelConfig)
    } catch (e) {
      console.error('[StorageConfig] saveWorkerModelConfig failed:', e.message)
      return { success: false, error: e.message }
    }
  })

  ipcMain.handle('storage:getSmartAuthorizationConfig', async () => ({ success: true, data: getSmartAuthorizationConfig() }))
  ipcMain.handle('storage:saveSmartAuthorizationConfig', async (event, nextConfig = {}) => saveSmartAuthorizationConfig(nextConfig))

  ipcMain.handle('storage:getRecoveryPointConfig', async () => {
    try {
      return { success: true, data: getRecoveryPointConfig() }
    } catch (e) {
      console.error('[StorageConfig] getRecoveryPointConfig failed:', e.message)
      return { success: false, error: e.message }
    }
  })

  ipcMain.handle('storage:saveRecoveryPointConfig', async (event, recoveryPointConfig) => {
    try {
      return saveRecoveryPointConfig(recoveryPointConfig)
    } catch (e) {
      console.error('[StorageConfig] saveRecoveryPointConfig failed:', e.message)
      return { success: false, error: e.message }
    }
  })

  ipcMain.handle('storage:getAiOperationMemoConfig', async () => {
    try {
      return { success: true, data: getAiOperationMemoConfig() }
    } catch (e) {
      console.error('[StorageConfig] getAiOperationMemoConfig failed:', e.message)
      return { success: false, error: e.message }
    }
  })

  ipcMain.handle('storage:saveAiOperationMemoConfig', async (event, memoConfig) => {
    try {
      return saveAiOperationMemoConfig(memoConfig)
    } catch (e) {
      console.error('[StorageConfig] saveAiOperationMemoConfig failed:', e.message)
      return { success: false, error: e.message }
    }
  })

  ipcMain.handle('storage:testWorkerModel', async (event, workerModelConfig, options = {}) => {
    try {
      const workerModel = require('./worker-model')
      return await workerModel.testConfig(workerModelConfig || getWorkerModelConfig(), options || {})
    } catch (e) {
      console.error('[StorageConfig] testWorkerModel failed:', e.message)
      return { success: false, error: e.message }
    }
  })

  ipcMain.handle('storage:scanLocalModels', async (event, options = {}) => {
    try {
      return await scanLocalModels(options || {})
    } catch (e) {
      console.error('[StorageConfig] scanLocalModels failed:', e.message)
      return { success: false, error: e.message, models: [] }
    }
  })

  ipcMain.handle('storage:getApiConfig', async (event) => {
    return getApiConfig()
  })

  // 保存 API 配置
  ipcMain.handle('storage:saveApiConfig', async (event, apiConfig) => {
    return saveApiConfig(apiConfig)
  })

  // 从 localStorage 迁移 API 配置
  ipcMain.handle('storage:migrateApiConfig', async (event, localStorageData) => {
    return migrateFromLocalStorage(localStorageData)
  })

  // ===== 项目列表配置相关 =====
  
  // 获取项目列表
  ipcMain.handle('storage:getProjectsList', async (event) => {
    return getProjectsList()
  })

  // 保存项目列表
  ipcMain.handle('storage:saveProjectsList', async (event, projectsList) => {
    return saveProjectsList(projectsList)
  })

  // 从 localStorage 迁移项目列表
  ipcMain.handle('storage:migrateProjectsList', async (event, localStorageProjects) => {
    return migrateProjectsFromLocalStorage(localStorageProjects)
  })

  console.log('[StorageConfig] IPC 已注册')
}

module.exports = {
  init,
  setBasePath,
  resetToDefault,
  getBasePath,
  getSkillsDir,
  getPlansDir,
  getProjectsDir,
  getArtifactsDir,
  getAssetsDir,
  getProjectAssetsDir,
  getSummariesDir,
  getCacheDir,
  getTrashDir,
  getProjectTrashDir,
  getTrashRetentionDays,
  setTrashRetentionDays,
  getTrashStatus,
  cleanupTrash,
  normalizeWorkerModelConfig,
  normalizeRecoveryPointConfig,
  normalizeBehaviorStyleConfig,
  normalizeAiOperationMemoConfig,
  getRecoveryPointConfig,
  saveRecoveryPointConfig,
  getBehaviorStyleConfig,
  saveBehaviorStyleConfig,
  getWorkerModelConfig,
  saveWorkerModelConfig,
  getSmartAuthorizationConfig,
  saveSmartAuthorizationConfig,
  getAiOperationMemoConfig,
  saveAiOperationMemoConfig,
  scanLocalModels,
  getConfigDir,
  getModelConfigDir,
  getProjectDataDir,
  getApiConfigPath,
  getLegacyApiConfigPath,
  getProjectsListPath,
  ensureDirectories,
  getStatus,
  migrateData,
  getApiConfig,
  saveApiConfig,
  migrateFromLocalStorage,
  getProjectsList,
  saveProjectsList,
  migrateProjectsFromLocalStorage,
  registerIPC
}
