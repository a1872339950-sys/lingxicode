/**
 * 用户可见的「能力开关」统一配置
 *
 * 原则：
 * - 可选/高权限能力必须有前端开关，避免「有能力但找不到开关」
 * - 关闭后对应工具对模型不可见，并在执行层可二次拒绝
 * - 文案不出现竞品名称
 * - desktop_control 的总开关仍以 desktop-control/settings 为权威源（避免双份状态）
 */

const fs = require('fs')
const path = require('path')
const storageConfig = require('./storage-config')

const FILE_NAME = 'feature-settings.json'
const VERSION = 1

/**
 * @typedef {Object} FeatureDef
 * @property {string} id
 * @property {string} category
 * @property {string} title
 * @property {string} description
 * @property {boolean} defaultEnabled
 * @property {'low'|'medium'|'high'} [risk]
 * @property {string[]} tools
 * @property {boolean} [bridgeDesktopControl] 总开关桥接到桌面操控模块
 * @property {string} [hint] 额外说明
 */

function loadOptionalFeaturesSafe() {
  try {
    return require('./optional/loader').getOptionalFeatures() || []
  } catch (error) {
    console.warn('[FeatureSettings] optional features unavailable:', error.message)
    return []
  }
}

/** @type {FeatureDef[]} */
const FEATURE_CATALOG = Object.freeze([
  {
    id: 'long_text_paste_attachment',
    category: '输入与附件',
    title: '长文本粘贴自动转附件',
    description: '粘贴内容超过 4000 个字符或 120 行时，自动保存为 TXT 附件，避免长文本占满输入框。',
    defaultEnabled: true,
    tools: [],
    hint: '关闭后所有纯文本都按普通文字粘贴；图片和文件粘贴不受影响。'
  },
  {
    id: 'desktop_control',
    category: '本地自动化',
    title: '桌面操控',
    description: '允许 AI 操作 Windows 应用界面（控件、键鼠、滚动输入）。默认关闭，开启后仍会按应用询问授权。',
    defaultEnabled: false,
    risk: 'high',
    tools: ['desktop_control'],
    bridgeDesktopControl: true,
    hint: '详细选项（屏幕状态条、Esc 中断、始终允许列表）仍可在「个性化」中调整。'
  },
  {
    id: 'desktop_apps',
    category: '本地自动化',
    title: '本地软件启动',
    description: '允许 AI 查找并打开本机已安装的应用。',
    defaultEnabled: true,
    risk: 'medium',
    tools: ['desktop_app']
  },
  {
    id: 'shell_commands',
    category: '工程能力',
    title: '终端命令',
    description: '允许 AI 在项目环境执行终端命令。仍受 AI 授权策略与路径规则约束。',
    defaultEnabled: true,
    risk: 'medium',
    tools: ['shell_run']
  },
  {
    id: 'browser_preview',
    category: '网页与运行态',
    title: '浏览器预览',
    description: '允许 AI 打开右侧预览面板、浏览页面与抓取公开网页内容。',
    defaultEnabled: true,
    tools: ['lxweb']
  },
  {
    id: 'website_delivery',
    category: '网页与运行态',
    title: '网页交付',
    description: '落地页/站点交付工作流：脚手架骨架、设计三选一、右侧预览与收尾。默认开启。',
    defaultEnabled: true,
    tools: ['website_delivery'],
    hint: '关闭后模型无法使用 website_delivery；仍可用普通写文件方式改网页。'
  },
  {
    id: 'website_research',
    category: '网页与运行态',
    title: '网站运行调研',
    description: '允许 AI 对网站做运行态调研、结构分析与效果核对。',
    defaultEnabled: true,
    tools: ['research_website_runtime']
  },
  {
    id: 'runtime_verify',
    category: '网页与运行态',
    title: '运行验证',
    description: '允许 AI 做构建/预览/冒烟级运行验证与错误采集。',
    defaultEnabled: true,
    tools: ['runtime_verify']
  },
  {
    id: 'runtime_verify_hard_gate',
    category: '网页与运行态',
    title: '运行态验证硬门禁',
    description: 'UI/前端相关改动后，收尾前必须完成 runtime_verify（DOM+F12）。关闭后恢复为仅软提示。依赖「运行验证」能力开启。',
    defaultEnabled: true,
    tools: [],
    hint: '不强制每次写文件都验证；仅当改动触及前端/UI 面、诊断要求运行时验证、或任务类型为 UI 时生效。'
  },
  {
    id: 'parallel_research',
    category: '研究',
    title: '并行调研',
    description: '允许 AI 并行搜索与多源调研。',
    defaultEnabled: true,
    tools: ['parallel_research']
  },
  {
    id: 'media_generation',
    category: '创作',
    title: '媒体生成',
    description: '文生图、音乐、视频及媒体后处理能力。',
    defaultEnabled: true,
    tools: ['generate_image', 'generate_music', 'generate_video', 'media_process']
  },
  {
    id: 'speech_synthesis',
    category: '创作',
    title: '语音合成',
    description: '文本转语音播报。',
    defaultEnabled: true,
    tools: ['text_to_speech']
  },
  {
    id: 'character_animation',
    category: '创作',
    title: '角色动画预览',
    description: '角色动画预览与相关制作辅助。',
    defaultEnabled: true,
    tools: ['character_animation_preview']
  },
  {
    id: 'canvas_workflow',
    category: '创作',
    title: '画布工作流',
    description: '创建与管理画布工作流。',
    defaultEnabled: true,
    tools: ['create_canvas_workflow']
  },
  {
    id: 'inline_visualize',
    category: '创作',
    title: '对话内可视化',
    description: '允许 AI 每轮自行判断是否用可交互图表、模拟器或关系图帮助表达（沙箱渲染）。关闭后工具对模型不可见。',
    defaultEnabled: true,
    tools: ['create_inline_visual'],
    hint: '默认自动判断，不需要手动选择技能；只在图比文字明显更清楚时生成。'
  },
  {
    id: 'office_templates',
    category: '办公',
    title: 'Office 模板生成',
    description: '从模板创建 Word / Excel / PPT 等文档。',
    defaultEnabled: true,
    tools: ['office_from_template']
  },
  {
    id: 'agent_collaboration',
    category: '协作',
    title: '多 AI 协作',
    description: '允许发起临时多模型协作会话。',
    defaultEnabled: true,
    tools: ['request_agent_collaboration', 'get_agent_collaboration_status']
  },
  {
    id: 'external_mcp',
    category: '集成',
    title: '外部 MCP',
    description: '允许在用户明确 @MCP 后调用外部 MCP 工具。关闭后即使 @ 也不暴露。',
    defaultEnabled: true,
    risk: 'medium',
    tools: ['mcp']
  },
  // 可选模块（删除 electron/modules/optional/<dir> 后自动消失）
  ...loadOptionalFeaturesSafe()
])

const CATALOG_BY_ID = new Map(FEATURE_CATALOG.map(item => [item.id, item]))

function getStorePath() {
  try {
    const configDir = storageConfig.getConfigDir()
    if (configDir) return path.join(configDir, FILE_NAME)
  } catch (_) { /* not ready */ }
  return path.join(process.cwd(), '.lingxi', 'config', FILE_NAME)
}

function defaultFeatureMap() {
  const features = {}
  for (const item of FEATURE_CATALOG) {
    features[item.id] = item.defaultEnabled === true
  }
  return features
}

function normalizeFeatureMap(raw = {}) {
  const defaults = defaultFeatureMap()
  const source = raw && typeof raw === 'object' ? raw : {}
  const features = { ...defaults }
  for (const item of FEATURE_CATALOG) {
    if (Object.prototype.hasOwnProperty.call(source, item.id)) {
      features[item.id] = source[item.id] === true
    }
  }
  return features
}

function readStore() {
  try {
    const filePath = getStorePath()
    if (!fs.existsSync(filePath)) {
      return { version: VERSION, features: defaultFeatureMap() }
    }
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'))
    return {
      version: VERSION,
      features: normalizeFeatureMap(data.features || data),
      updatedAt: data.updatedAt || null
    }
  } catch {
    return { version: VERSION, features: defaultFeatureMap() }
  }
}

function syncBridgeInto(features = {}) {
  const next = normalizeFeatureMap(features)
  for (const item of FEATURE_CATALOG) {
    if (!item.bridgeDesktopControl) continue
    const bridge = getDesktopControlBridge()
    if (bridge?.isEnabled) next[item.id] = bridge.isEnabled() === true
  }
  return next
}

function writeStore(features) {
  const filePath = getStorePath()
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  const payload = {
    version: VERSION,
    features: syncBridgeInto(features),
    updatedAt: Date.now()
  }
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), 'utf8')
  return payload
}

function getDesktopControlBridge() {
  try {
    return require('./desktop-control')
  } catch {
    return null
  }
}

function isFeatureEnabled(featureId) {
  const def = CATALOG_BY_ID.get(featureId)
  if (!def) return true
  if (def.bridgeDesktopControl) {
    const bridge = getDesktopControlBridge()
    if (bridge?.isEnabled) return bridge.isEnabled() === true
  }
  const store = readStore()
  if (Object.prototype.hasOwnProperty.call(store.features, featureId)) {
    return store.features[featureId] === true
  }
  return def.defaultEnabled === true
}

function setFeatureEnabled(featureId, enabled) {
  const def = CATALOG_BY_ID.get(featureId)
  if (!def) {
    return { success: false, error: `未知能力：${featureId}` }
  }
  const on = enabled === true

  if (def.bridgeDesktopControl) {
    const bridge = getDesktopControlBridge()
    if (!bridge?.settings?.setEnabled) {
      return { success: false, error: '桌面操控模块不可用' }
    }
    bridge.settings.setEnabled(on)
    if (!on) {
      try {
        bridge.session?.endActivity?.()
        bridge.overlay?.hide?.({ destroy: true })
      } catch (_) { /* ignore cleanup errors */ }
    }
    // 同步写入统一配置，便于备份/迁移时看到完整清单
    const store = readStore()
    store.features[featureId] = on
    writeStore(store.features)
    return {
      success: true,
      data: getPublicState()
    }
  }

  const store = readStore()
  store.features[featureId] = on
  writeStore(store.features)
  return {
    success: true,
    data: getPublicState()
  }
}

function saveFeatures(partial = {}) {
  const input = partial && typeof partial === 'object' ? partial : {}
  const nextMap = { ...readStore().features }

  for (const [id, value] of Object.entries(input)) {
    if (!CATALOG_BY_ID.has(id)) continue
    nextMap[id] = value === true
  }

  // 桥接桌面操控：权威源在 desktop-control/settings
  for (const item of FEATURE_CATALOG) {
    if (!item.bridgeDesktopControl) continue
    if (!Object.prototype.hasOwnProperty.call(input, item.id)) continue
    const bridge = getDesktopControlBridge()
    bridge?.settings?.setEnabled?.(input[item.id] === true)
  }

  // 统一文件写入当前完整快照（桥接项以 isFeatureEnabled 为准）
  for (const item of FEATURE_CATALOG) {
    if (item.bridgeDesktopControl) {
      nextMap[item.id] = isFeatureEnabled(item.id)
    }
  }
  writeStore(nextMap)

  return { success: true, data: getPublicState() }
}

function getDisabledTools() {
  const disabled = []
  for (const item of FEATURE_CATALOG) {
    if (!isFeatureEnabled(item.id)) {
      for (const tool of item.tools || []) {
        if (tool) disabled.push(tool)
      }
    }
  }
  return disabled
}

function getFeatureForTool(toolName = '') {
  const name = String(toolName || '').trim()
  if (!name) return null
  return FEATURE_CATALOG.find(item => (item.tools || []).includes(name)) || null
}

function isToolAllowedByFeatures(toolName = '') {
  const feature = getFeatureForTool(toolName)
  if (!feature) return true
  return isFeatureEnabled(feature.id)
}

function getPublicState() {
  const features = {}
  const items = FEATURE_CATALOG.map(item => {
    const enabled = isFeatureEnabled(item.id)
    features[item.id] = enabled
    return {
      id: item.id,
      category: item.category,
      title: item.title,
      description: item.description,
      risk: item.risk || 'low',
      defaultEnabled: item.defaultEnabled === true,
      enabled,
      tools: [...(item.tools || [])],
      hint: item.hint || '',
      bridgeDesktopControl: item.bridgeDesktopControl === true
    }
  })

  const byCategory = []
  const seen = new Set()
  for (const item of items) {
    if (seen.has(item.category)) continue
    seen.add(item.category)
    byCategory.push({
      category: item.category,
      items: items.filter(x => x.category === item.category)
    })
  }

  return {
    version: VERSION,
    features,
    catalog: items,
    categories: byCategory,
    disabledTools: getDisabledTools()
  }
}

function registerFeatureSettingsIPC(ipcMain) {
  ipcMain.handle('feature-settings:get', () => ({
    success: true,
    data: getPublicState()
  }))

  ipcMain.handle('feature-settings:set', (event, featureId, enabled) => {
    return setFeatureEnabled(String(featureId || ''), enabled === true)
  })

  ipcMain.handle('feature-settings:save', (event, partial = {}) => {
    return saveFeatures(partial || {})
  })

  ipcMain.handle('feature-settings:resetDefaults', () => {
    const defaults = defaultFeatureMap()
    writeStore(defaults)
    const bridge = getDesktopControlBridge()
    const desktopDefault = CATALOG_BY_ID.get('desktop_control')?.defaultEnabled === true
    bridge?.settings?.setEnabled?.(desktopDefault)
    return { success: true, data: getPublicState() }
  })
}

module.exports = {
  VERSION,
  FEATURE_CATALOG,
  getStorePath,
  getPublicState,
  isFeatureEnabled,
  setFeatureEnabled,
  saveFeatures,
  getDisabledTools,
  getFeatureForTool,
  isToolAllowedByFeatures,
  registerFeatureSettingsIPC
}
