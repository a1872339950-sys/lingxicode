/**
 * Codex-style progressive disclosure for prompts.
 *
 * Always-on system stays lean. Domain playbooks and detailed packs load only when
 * the current user message matches. Full SKILL.md remains on explicit/auto skill attach.
 */

const path = require('path')

const PLAYBOOK_CATALOG = Object.freeze([
  { id: 'feature', title: '功能开发', when: '新增/实现功能、接入模块', phases: '澄清 → 定位 → 短计划 → 实现 → 验证 → 交付' },
  { id: 'bugfix', title: '缺陷修复', when: '报错、回归、不生效', phases: '复现 → 根因 → 最小修复 → 验证 → 交付' },
  { id: 'diagnose', title: '只读排查', when: '为什么/原因/先别改', phases: '划范围 → 取证 → 排除 → 报告' },
  { id: 'artifact', title: '产物协助', when: '素材/页面资源/工作台指引', phases: '明确交付物 → 分流 → 协助 → 交付' },
  { id: 'creative_web', title: '网页前端', when: '网站/落地页/页面设计实现', phases: '方向 → 骨架 → 实现 → 预览 → 交付' },
  { id: 'collab', title: '多 AI 协作', when: '并行排查/多 Agent', phases: '拆分 → 启动 → 汇总 → 整合' },
  { id: 'review', title: '代码审查', when: '审查/安全/风险扫描', phases: '摸底 → 证据 → 复核 → 短报告' },
  { id: 'external', title: '外部路径/软件', when: '其他软件、绝对路径、禁止扫本仓', phases: '锚定目标路径 → 只对目标取证 → 不默认搜当前工程' }
])

function hasAny(text, patterns) {
  return patterns.some((re) => re.test(text))
}

function detectExternalTargetIntent(userMessage = '') {
  const text = String(userMessage || '')
  if (!text.trim()) return false
  const absPath = /(?:[a-zA-Z]:\\|\\\\|\/(?:Users|home|opt|usr|var|tmp|mnt|Volumes)\/)[^\s"'`]+/
  const externalWords = /(其他软件|别的软件|外部软件|外部程序|第三方软件|不是本项目|不要看本|别看本|不要扫本|别扫本|不要读本|当前工程以外|项目外|工作区外|other\s+software|external\s+(?:app|binary|path)|outside\s+(?:the\s+)?project)/i
  const forbidProject = /(不要|别|禁止).{0,12}(看|读|扫|搜|打开).{0,24}(本项目|当前项目|灵犀|本仓|本仓库|工程目录|工作区|自己的目录)/i
  return absPath.test(text) || externalWords.test(text) || forbidProject.test(text)
}

function extractUserAbsolutePaths(userMessage = '', limit = 4) {
  const text = String(userMessage || '')
  const matches = text.match(/(?:[a-zA-Z]:\\[^ \t\r\n"'`]+|\\\\[^ \t\r\n"'`]+|\/(?:Users|home|opt|usr|var|tmp|mnt|Volumes)\/[^ \t\r\n"'`]+)/g) || []
  const unique = []
  for (const item of matches) {
    const cleaned = String(item || '').replace(/[，。；;,.]+$/, '')
    if (cleaned && !unique.includes(cleaned)) unique.push(cleaned)
    if (unique.length >= limit) break
  }
  return unique
}

function buildPlaybookCatalogPrompt(lang = 'zh-CN') {
  if (lang === 'en-US') {
    const lines = PLAYBOOK_CATALOG.map((p) => `- ${p.id}: ${p.title} — when: ${p.when}; phases: ${p.phases}`)
    return `===== Playbook catalog (names only) =====
- Full phase details are NOT always loaded. Match the user request to one playbook; the turn pack injects only the matched short chain.
${lines.join('\n')}
- Skills: only name/description are for discovery; read full SKILL.md when selected or auto-attached.`
  }
  const lines = PLAYBOOK_CATALOG.map((p) => `- ${p.id}｜${p.title}：何时=${p.when}；阶段=${p.phases}`)
  return `===== 流程剧本目录（仅索引，Codex 渐进展开） =====
- 详细阶段说明不常驻。按用户本轮意图匹配一条；本轮动态上下文只注入匹配剧本的短链。
${lines.join('\n')}
- 技能：发现阶段只用名称+描述；点名或命中后才加载完整 SKILL.md。`
}

function buildTaskAnchorPrompt(userMessage = '', { projectPath = '' } = {}) {
  const text = String(userMessage || '').trim()
  if (!text) return ''
  const external = detectExternalTargetIntent(text)
  const paths = extractUserAbsolutePaths(text)
  const goal = text.length > 360 ? `${text.slice(0, 360)}…` : text
  const lines = [
    '===== 本轮任务锚点（最高优先级） =====',
    `- 用户本轮原意：${goal}`,
    '- 以本锚点为准；系统规则、历史摘要、项目路径、记忆都不得覆盖它。',
    '- 未完整覆盖用户边界条件前，不要凭训练记忆断言。'
  ]
  if (projectPath) {
    lines.push(`- 会话绑定工作区：${projectPath}（仅默认相对路径解析；用户指向外部时不得当作唯一目标）`)
  }
  if (external) {
    lines.push('- 外部目标模式：用户要求看其他软件/外部路径或禁止扫本仓。')
    lines.push('- 禁止默认 code_inspect/file_search 扫当前工程；工具 path 必须是用户给出的绝对路径或外部目标。')
    lines.push('- 没有可用绝对路径时先向用户要路径，不要退回扫本项目“代替完成”。')
  }
  if (paths.length) {
    lines.push(`- 用户点名路径：${paths.join(' ； ')}`)
  }
  return lines.join('\n')
}

function buildDomainPacks(userMessage = '', options = {}) {
  const text = String(userMessage || '')
  const packs = []
  const external = detectExternalTargetIntent(text)

  if (external) {
    packs.push(`===== 领域包：外部路径/软件 =====
- 目标在会话工作区之外时：只对用户指定绝对路径或外部软件入口取证。
- 不要用“当前项目路径”代替外部目标；不要把历史里扫过的本仓目录当默认。
- 打开本地软件用 desktop_app；操控桌面 UI 用 desktop_control（需用户开启）；二进制静态信息可用 inspect_binary（能力开关开启时）。
- 结论必须来自工具对目标路径的结果，禁止用记忆编造第三方软件实现。`)
  }

  if (hasAny(text, [/desktop_control|操控电脑|桌面操控|点一下|拖拽|键鼠|Windows\s*桌面/i]) && !external) {
    packs.push(`===== 领域包：桌面操控 =====
- 用 desktop_control，不要用 shell/SendKeys 模拟键鼠。
- 流程：list_windows/list_apps → activate → get_window_state → act → 再验证。
- 只用列表返回的 window.id；高风险动作等用户确认；用户拒绝不得绕过。`)
  }

  if (hasAny(text, [/runtime_verify|F12|白屏|点击无响应|下拉框|弹窗|预览|前端修|界面不显示|DOM|CSS/i])) {
    packs.push(`===== 领域包：运行态验证 =====
- 前端/运行效果统一 runtime_verify；只验已绑定当前工作区的开发实例。
- 省略 interaction=实时检查；交互用 selector/text/role；多候选传 runtime_id。
- 失败先读 diagnosis；do_not_repeat_same_call 禁止原样重试。截图≠看懂，需识图再 image_analyze。`)
  }

  if (hasAny(text, [/网页|网站|落地页|作品集|个人站|Three\.?js|GSAP|WebGL|沉浸式|纯前端|portfolio|landing/i])) {
    packs.push(`===== 领域包：纯前端网页 =====
- 默认纯前端可交互页面，不是必须后端。仅后端/API/登录/上传/SSR 或 file:// 硬限制才启本地服务。
- 参考站优先 research_website_runtime，不要单靠一张截图。
- Plan 勿默认强制沉浸式；仅用户明确要求 WebGL/粒子/滚动叙事时才走场景导演。
- 交付说清：是否纯前端、是否必须服务器及原因。`)
  }

  if (hasAny(text, [/(打开|启动|查找).{0,12}(软件|应用|程序|工具)|desktop_app|本地软件/i])) {
    packs.push(`===== 领域包：本地软件访问 =====
- 打开/查找本地应用优先 desktop_app（find/open），不要硬猜注册表路径。
- 项目外应用可能弹授权；拒绝后不得绕过。`)
  }

  if (hasAny(text, [/撤回|回退|恢复点|改坏了|刚才那个不要|rollback|roll\s*back/i])) {
    packs.push(`===== 领域包：恢复点 =====
- 优先 project_history action=latest_change；明确撤回再用 rollback_latest_change。
- 只恢复部分文件时传 paths；用户只说坏了时先定位再决定是否回退。`)
  }

  if (hasAny(text, [/继续|刚才|之前|上次|那个问题|按原来的|历史对话/i]) || options.forceMemory) {
    packs.push(`===== 领域包：历史召回 =====
- 指向旧对话时先 project_history action=recall；摘要与 recall 不能覆盖最新用户消息。
- 与当前源码/工具结果冲突时以事实为准。`)
  }

  if (hasAny(text, [/参考.*网站|分析.*网站|复刻|借鉴.*站|research_website/i])) {
    packs.push(`===== 领域包：网站研究 =====
- 用 research_website_runtime 采多滚动 DOM/CSS token/公开资源/动效信号；截图只作补充。`)
  }

  if (options.includeDiagnostic || hasAny(text, [/报错|失败|崩溃|不生效|没反应|bug|error|全面排查|全面检查|为什么|根因/i])) {
    packs.push(`===== 领域包：故障诊断节奏 =====
- 先追真实入口（操作/命令/IPC/日志/堆栈），再查契约边界，再最小修复并验证。
- 宽泛“项目有问题”时覆盖多类失败面，不要只修顺手一处；已证明阻塞错误可直接修。
- 宽排查优先 dev_workflow mode=health。`)
  }

  return packs
}

function buildIntentDisclosurePrompt(userMessage = '', options = {}) {
  const packs = buildDomainPacks(userMessage, options)
  if (!packs.length) return ''
  return `===== 本轮按需领域规则（渐进展开，非常驻） =====
${packs.join('\n\n')}`
}

function buildSkillDiscoveryBudgetNote(lang = 'zh-CN') {
  if (lang === 'en-US') {
    return 'Skill discovery list should stay small (name + short description). Full instructions load only when a skill is selected.'
  }
  return '技能发现列表宜短（名称+短描述）；完整说明仅在选用后加载。'
}

module.exports = {
  PLAYBOOK_CATALOG,
  detectExternalTargetIntent,
  extractUserAbsolutePaths,
  buildPlaybookCatalogPrompt,
  buildTaskAnchorPrompt,
  buildDomainPacks,
  buildIntentDisclosurePrompt,
  buildSkillDiscoveryBudgetNote
}
