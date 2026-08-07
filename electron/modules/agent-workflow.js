/**
 * 统一工程工作流控制器
 * 这里不生成大段系统提示，而是根据真实工具调用记录判断下一步该做什么。
 */

const PROGRAMMING_TASKS = new Set(['review', 'bugfix', 'feature', 'refactor', 'ui', 'ops'])
const CHANGE_TASKS = new Set(['bugfix', 'feature', 'refactor', 'ui'])
const READ_TOOLS = new Set([
  'read_file',
  'read_many_files',
  'list_files',
  'grep',
  'glob',
  'locate_code',
  'grep_code',
  'search_project',
  'discover_code',
  'find_references',
  'recall_history',
  'read_task_ledger_entry'
])
const WRITE_TOOLS = new Set([
  'write_file',
  'edit_file',
  'text_edit',
  'apply_patch',
  'json_edit',
  'copy_file',
  'move_file',
  'delete_file',
  'create_directory',
  'render_svg_asset'
])
const diagnosticWorkflow = require('./diagnostic-workflow')

const READ_COMMAND_PATTERN = /\b(rg|grep|findstr|select-string|get-content|cat|type)\b|git\s+(diff|show|grep|status|ls-files)/i
const SEARCH_COMMAND_PATTERN = /\b(rg|grep|findstr|select-string)\b|git\s+grep/i
const DIFF_COMMAND_PATTERN = /git\s+diff|git\s+show/i
const VERIFY_COMMAND_PATTERN = /(node --check|tsc|npm|pnpm|yarn|bun|build|test|lint|electron|pytest|cargo test|go test|mvn test|gradle test)/i
const REVIEW_COMMAND_PATTERN = /git\s+diff|\b(rg|grep|findstr|select-string|get-content|cat|type)\b/i
const ELECTRON_PATTERN = /electron|ipcmain|ipcrenderer|preload|contextbridge|nodeintegration|websecurity|browserwindow|shell\.openexternal/
const CODE_FILE_PATTERN = /\.(js|jsx|ts|tsx|mjs|cjs|vue|svelte|py|java|go|rs|cs|php|rb|swift|kt|kts|html|css|scss|sass|less)$/i
const ENTRY_FILE_PATTERN = /(^|[\\/])(index|app|main|server|router|routes|bootstrap|entry)\.(js|jsx|ts|tsx|mjs|cjs|py|html|css)$/i
const FILE_SIZE_BOUNDARY_PATTERN = /2000\s*行|两千行|行数|line_count|wc\s+-l|measure-object|Get-Content.*Measure-Object|模块拆分|拆成.*模块|拆分.*文件|入口.*装配|入口.*接线|import|export|require|引用声明|组合层|composition/i
const IMPACT_CONTEXT_PATTERN = /影响|调用链|调用方|被调用|入口|接入|状态|数据流|导出|绑定|初始化|同类|现有|相邻|依赖|模块|样式|事件|ipc|api|旧入口|兼容|回归|保持|不破坏|原有/i
const REGRESSION_EVIDENCE_PATTERN = /回归|保持|不破坏|原有|现有|旧入口|兼容|行为不变|首屏|第一(?:个)?场景|logo|canvas|webgl|scene|scroll|particle|particles|renderer|入口|导出|事件绑定|状态来源|空引用|重复入口/i
const WEB_SCENE_REGRESSION_PATTERN = /logo|首屏|第一(?:个)?场景|scene|scene\.js|app\.js|index\.html|styles?\.css|canvas|webgl|three|particle|particles|scroll|renderer|camera|shader|galaxy|银河|粒子|主视觉/i
const WEB_SCENE_REGRESSION_DETAIL_PATTERN = /logo|首屏|第一(?:个)?场景|canvas|webgl|three|particle|particles|scroll|renderer|camera|shader|galaxy|银河|粒子|主视觉|形态|progress/i
const WEB_SCENE_PATH_PATTERN = /(^|[\\/])(scene|app|index|main|styles?|canvas|renderer|shader|particles?)[^\\/]*\.(js|ts|mjs|html|css|scss|json)$/i
const WEBSITE_REFERENCE_PATTERN = /(参考|借鉴|复刻|仿|模仿|学习|分析).{0,30}(https?:\/\/|网站|网页|官网|设计风格|active\s*theory|spline|webgl|canvas|动效|滚动)|https?:\/\/\S+/i
const IMMERSIVE_HTML_ENTRY_PATTERN = /\.(html|htm)$/i
const IMMERSIVE_MODULE_PATH_PATTERN = /(^|[\\/])(scene|app|styles?|assets|media|audio|video|shader|particles?|components?)[^\\/]*\.(js|ts|mjs|css|scss|svg|json|png|jpe?g|webp|avif|mp4|webm|mp3|wav)$/i

function getCommandText(call) {
  return String(call?.args?.command || call?.args?.cmd || '')
}

function normalizePath(value) {
  return String(value || '').replace(/\\/g, '/').toLowerCase()
}

function getToolText(call) {
  try {
    return JSON.stringify({ name: call.name, args: call.args, result: call.result }).toLowerCase()
  } catch {
    return `${call?.name || ''} ${String(call?.args || '')} ${String(call?.result || '')}`.toLowerCase()
  }
}

function getImmersiveWebTemplateSmells(activity) {
  const text = String(activity?.text || '')
  const smells = []
  const add = (label, pattern) => {
    if (pattern.test(text) && !smells.includes(label)) smells.push(label)
  }

  add('普通 hero/标题副标题结构', /(?:class(?:name)?=["'][^"']*\bhero\b|\.hero\b|hero-title|hero-subtitle|<section[^>]+class=["'][^"']*hero)/i)
  add('卡片网格内容结构', /feature-card|feature-grid|pricing-card|service-card|testimonial-card|card-grid|cards-grid|\.feature-card|\.feature-grid/i)
  add('玻璃卡片或纯渐变凑视觉', /backdrop-filter\s*:\s*blur|glassmorphism|glass-card|linear-gradient\([^)]*(?:#0ff|#00f|purple|violet|cyan|blue)|gradient blob|渐变光球|玻璃卡片/i)
  add('随机 Three.js 几何体冒充主视觉', /(?:IcosahedronGeometry|TorusGeometry|SphereGeometry|OctahedronGeometry|DodecahedronGeometry|BoxGeometry|ConeGeometry).{0,160}(?:productMesh|core|ring|random|Math\.random|wireframe)|(?:productMesh|core|ring|random|Math\.random|wireframe).{0,160}(?:IcosahedronGeometry|TorusGeometry|SphereGeometry|OctahedronGeometry|DodecahedronGeometry|BoxGeometry|ConeGeometry)/is)
  add('滚动只做浅层显隐或镜头 z 位移', /scrollProgress.{0,120}camera\.position\.z|camera\.position\.z.{0,120}scrollProgress|querySelectorAll\([^)]*(?:feature-card|hero-title|hero-subtitle|section-title)|\.visible\b.{0,120}scroll/i)
  add('按钮是假交互', /onclick=["']alert\(|alert\(['"`]/i)
  add('依赖 CDN 冒充内嵌创意依赖', /https?:\/\/(?:unpkg|cdn\.jsdelivr|esm\.sh|skypack)\.[^"'`]+(?:three|gsap|anime|pixi|matter)/i)

  return smells
}

function hasImmersiveWebModuleSplitEvidence(activity) {
  const changedPaths = Array.isArray(activity?.changedPaths) ? activity.changedPaths : []
  const changedCodePaths = Array.isArray(activity?.changedCodePaths) ? activity.changedCodePaths : []
  const hasSceneRuntime = changedPaths.some(path => /(^|[\\/])scene[^\\/]*\.(js|ts|mjs)$/i.test(String(path || '')))
  const hasAppRuntime = changedPaths.some(path => /(^|[\\/])app[^\\/]*\.(js|ts|mjs)$/i.test(String(path || '')))
  const hasStyleLayer = changedPaths.some(path => /(^|[\\/])styles?[^\\/]*\.(css|scss|sass|less)$/i.test(String(path || '')))
  const hasAssetLayer = changedPaths.some(path => /(^|[\\/])assets?([\\/]|$)|\.(svg|png|jpe?g|webp|avif|gif|mp4|webm|mp3|wav|json)$/i.test(String(path || '')))
  const hasNamedModulePaths = changedPaths.filter(path => IMMERSIVE_MODULE_PATH_PATTERN.test(String(path || ''))).length >= 2
  return changedCodePaths.length >= 3 || hasNamedModulePaths || (hasSceneRuntime && (hasAppRuntime || hasStyleLayer || hasAssetLayer))
}

function hasSingleFileImmersiveImplementation(activity) {
  const changedCodePaths = Array.isArray(activity?.changedCodePaths) ? activity.changedCodePaths : []
  if (changedCodePaths.length !== 1) return false
  if (!IMMERSIVE_HTML_ENTRY_PATTERN.test(String(changedCodePaths[0] || ''))) return false
  const text = String(activity?.text || '')
  return /<style[\s\S]*<script|<script[\s\S]*<style|type=["']module["']|new\s+THREE\.|WebGLRenderer|canvas|ShaderMaterial|BufferGeometry/i.test(text)
}

function hasEmojiIconInWrittenContent(activity) {
  return /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/iu.test(activity.text) ||
    /&#x?(?:1f[0-9a-f]{3}|2[6-7][0-9a-f]{2}|12[0-9]{3});/i.test(activity.text) ||
    /\\u(?:d83[cd]|d84[0-9a-f])\\u[d-f][0-9a-f]{3}/i.test(activity.text)
}

function hasRealImageAssetEvidence(activity) {
  return hasText(activity, /<img\b|<picture\b|background-image|srcset|image|picture|screenshot|mockup|产品截图|界面截图|真实图片|现成图片|视觉资产|图片/) ||
    activity.changedPaths.some(path => /\.(png|jpe?g|webp|avif|gif)$/i.test(String(path || '')))
}

function hasWebAssetInventoryEvidence(activity) {
  return hasText(activity, /logo|assets?|image|img|video|audio|music|font|svg|png|webp|avif|mp4|webm|mp3|wav|素材|资产|图片|视频|音乐|字体|品牌|主视觉|现有素材|生成素材/) ||
    activity.changedPaths.some(path => /\.(svg|png|jpe?g|webp|avif|gif|mp4|webm|mp3|wav|json)$/i.test(String(path || '')))
}

function hasImmersiveWebSceneEvidence(activity) {
  return hasText(activity, /three|webgl|canvas|shader|particles?|particle|gsap|scrolltrigger|camera|scene|renderer|mesh|material|geometry|postprocessing|spline|粒子|场景|镜头|灯光|材质|滚动驱动|鼠标跟随|沉浸|银河|主视觉|视差|媒体层|视觉对象|代码建模/)
}

function hasWebSceneStateMachineEvidence(activity) {
  return hasText(activity, /state machine|scene state|scroll|pointer|mouse|touch|keyboard|interaction|progress|enter|exit|timeline|lerp|状态机|场景状态|滚动|鼠标|触摸|键盘|交互|进入|退出|进度|时间线|下拉|跟随/)
}

function hasWebLocalDependencyEvidence(activity) {
  return hasText(activity, /three|gsap|sharp|resvg|@resvg|ffmpeg|esbuild|render_svg_asset|webgl|canvas|svg|dependency|dependencies|package\.json|依赖|内嵌依赖|转图|转图片|视频|音频/) ||
    hasPath(activity, /package\.json$/)
}

function hasWebPreviewFallbackEvidence(activity) {
  return hasText(activity, /index\.html|file:\/\/|直接打开|本地打开|dev server|localhost|fallback|low-power|reduced-motion|webgl.*不可用|降级|预览|preview|canvas.*非空|webgl.*非空/)
}

function hasWebInteractionAudioEvidence(activity) {
  return hasText(activity, /audio|music|mp3|wav|sound|click|pointerdown|touchstart|keydown|first interaction|autoplay|音频|音乐|点击|首次交互|自动播放|滤波|混响|音量|声音|播放/)
}

function hasWebsiteRuntimeResearchEvidence(activity) {
  return activity.toolCalls.some(call => call?.name === 'research_website_runtime') ||
    hasText(activity, /research_website_runtime|runtime-dom-css-assets-animation-analysis|多滚动位置|scrollRuntime|designTokens|Canvas\/WebGL|公开 JS\/CSS|运行态/)
}

function isWebUiPayloadText(text = '') {
  return /(网页|网站|官网|落地页|landing|homepage|个人主页|个人介绍页|个人介绍页面|个人简介页|个人简历页|简历页|作品集|个人站|个人网站|portfolio|profile|about page|前端页面|页面设计|沉浸式网页工作流)/i.test(String(text || ''))
}

function getWebUiWorkflowChoice(toolCalls = []) {
  for (let index = toolCalls.length - 1; index >= 0; index--) {
    const call = toolCalls[index]
    if (call?.name !== 'ask_user_choice') continue
    const result = call.result || {}
    const selectedValue = String(result.value || result.workflowChoice || '').toLowerCase()
    const selectedAnswer = String(result.answer || '').toLowerCase()
    const selectedOptionText = result.selectedOption ? JSON.stringify(result.selectedOption).toLowerCase() : ''
    const resultText = `${selectedValue}\n${selectedAnswer}\n${selectedOptionText}`
    if (/immersive_web_workflow/.test(selectedValue)) {
      return 'immersive'
    }
    if (/simple|minimal|normal|standard|basic|static|glass|glassmorphism/.test(selectedValue) ||
        /普通|简单|极简|基础|静态|内容页|玻璃|渐变|卡片|轻量/.test(selectedAnswer)) {
      return 'standard'
    }
    if (/沉浸式网页工作流|沉浸|webgl|\bthree\b|\bgsap\b|\bcanvas\b|\bparticle\b|\bparticles\b|粒子|场景|滚动叙事|代码建模|视频\/媒体|状态机/.test(resultText)) {
      return 'immersive'
    }
    if (selectedValue || selectedAnswer || isWebUiPayloadText(`${JSON.stringify(call.args || {})}\n${resultText}`)) return 'standard'
  }
  return ''
}

function isEmptyInventoryCall(call) {
  if (!call) return false
  const name = call.name || ''
  const result = call.result || {}
  if (name === 'list_files') {
    if (Array.isArray(result.files)) return result.files.length === 0
    if (Number(result.count) === 0) return true
  }
  if (name !== 'run_command') return false
  const command = getCommandText(call)
  if (!/(rg\s+--files|git\s+ls-files|dir\s+\/b|get-childitem)/i.test(command)) return false
  const output = `${result.stdout || ''}\n${result.output || ''}\n${result.text || ''}`.trim()
  return !output || /找不到文件|no files|0\s+items|目录为空|empty/i.test(output)
}

function isReadLikeCall(call) {
  const name = call?.name || ''
  return READ_TOOLS.has(name) || (name === 'run_command' && READ_COMMAND_PATTERN.test(getCommandText(call)))
}

function isWriteLikeCall(call) {
  return WRITE_TOOLS.has(call?.name || '')
}

function isStaticVerificationCall(call) {
  const name = call?.name || ''
  if (name === 'code_verify') {
    const action = String(call?.args?.action || call?.result?._tool_route?.action || '').toLowerCase()
    return !action || /file|project|changes|verify|syntax/.test(action)
  }
  return ['check_syntax', 'check_project_syntax', 'post_change_verify'].includes(name) ||
    (name === 'dev_workflow' && /verify|syntax|check|review/i.test(String(call?.args?.mode || call?.args?.workflow || ''))) ||
    ((name === 'run_command' || name === 'shell_run') && VERIFY_COMMAND_PATTERN.test(getCommandText(call)))
}

function isRuntimeVerificationCall(call) {
  return (call?.name || '') === 'runtime_verify'
}

function isQualifiedRuntimeVerificationCall(call) {
  if (!isRuntimeVerificationCall(call)) return false
  const status = String(call?.result?.verification_status || call?.result?.verificationStatus || '').toLowerCase()
  return status === 'passed' || status === 'failed'
}

function isVerificationCall(call) {
  // 统计口径：静态验证 + 运行时验证均算 verify 活动；门禁语义见 runtime-verification-gate
  return isStaticVerificationCall(call) || isRuntimeVerificationCall(call)
}

function isSearchCall(call) {
  return call?.name === 'run_command' && SEARCH_COMMAND_PATTERN.test(getCommandText(call))
}

function isDiffCall(call) {
  return call?.name === 'run_command' && DIFF_COMMAND_PATTERN.test(getCommandText(call))
}

function isFailedCommandCall(call) {
  if (call?.name !== 'run_command') return false
  const result = call.result || {}
  if (result.noMatches === true) return false
  const output = `${result.error || ''}\n${result.stderr || ''}\n${result.stdout || ''}`
  if (result.success === false || result.error) return true
  return /(failed|failure|error|exception|eslint.*error|type error|compile error|构建失败|编译失败|检查失败|测试失败|报错|错误)/i.test(output)
}

function isFailedVerificationCall(call) {
  return isVerificationCall(call) && isFailedCommandCall(call)
}

function isPostWriteReviewCall(call) {
  if (isReadLikeCall(call)) return true
  return call?.name === 'run_command' && REVIEW_COMMAND_PATTERN.test(getCommandText(call))
}

function extractPath(call) {
  return call?.args?.path || call?.args?.file || call?.args?.cwd || ''
}

function isCodePath(filePath) {
  return CODE_FILE_PATTERN.test(String(filePath || ''))
}

function isEntryCodePath(filePath) {
  return ENTRY_FILE_PATTERN.test(String(filePath || ''))
}

function pathsLookRelated(left, right) {
  const a = normalizePath(left)
  const b = normalizePath(right)
  if (!a || !b) return false
  if (a === b) return true
  const aName = a.split('/').pop()
  const bName = b.split('/').pop()
  if (aName && bName && aName === bName) return true
  return a.endsWith(`/${b}`) || b.endsWith(`/${a}`)
}

function callsContainPattern(calls, pattern) {
  return calls.some(call => pattern.test(getToolText(call)) || pattern.test(getCommandText(call)))
}

function callResultContainsPattern(call, pattern) {
  const result = call?.result || {}
  const output = [
    result.content,
    result.stdout,
    result.stderr,
    result.output,
    result.text,
    result.preview
  ].filter(value => value !== undefined && value !== null).join('\n')
  return pattern.test(output)
}

function callsResultOrSearchOutputContainsPattern(calls, pattern) {
  return calls.some(call => {
    if (callResultContainsPattern(call, pattern)) return true
    if (isSearchCall(call) || isDiffCall(call) || isVerificationCall(call)) {
      return pattern.test(getCommandText(call))
    }
    return false
  })
}

function getResultLineCount(call) {
  const result = call?.result || {}
  const value = Number(result.line_count ?? result.lineCount ?? result.lines)
  return Number.isFinite(value) && value >= 0 ? value : 0
}

function getArgumentLineCount(call) {
  const value = call?.args?.content ?? call?.args?.new_content ?? call?.args?.newContent
  if (typeof value !== 'string') return 0
  if (!value) return 0
  return value.split(/\r\n|\r|\n/).length
}

function getWriteLineRecords(writeCalls) {
  return writeCalls
    .map(call => {
      const filePath = extractPath(call)
      const lineCount = Math.max(getResultLineCount(call), getArgumentLineCount(call))
      return {
        path: filePath,
        lineCount,
        isCode: isCodePath(filePath),
        isEntry: isEntryCodePath(filePath)
      }
    })
    .filter(item => item.path)
}

function analyzeToolCalls(toolCalls = []) {
  const text = toolCalls.map(getToolText).join('\n')
  const readCalls = toolCalls.filter(isReadLikeCall)
  const writeCalls = toolCalls.filter(isWriteLikeCall)
  const verifyCalls = toolCalls.filter(isVerificationCall)
  const failedVerifyCalls = toolCalls.filter(isFailedVerificationCall)
  const commandCalls = toolCalls.filter(call => call.name === 'run_command')
  const commandText = commandCalls.map(getCommandText).join('\n').toLowerCase()
  const firstWriteIndex = toolCalls.findIndex(isWriteLikeCall)
  const lastWriteIndex = toolCalls.reduce((lastIndex, call, index) => (
    isWriteLikeCall(call) ? index : lastIndex
  ), -1)
  const lastFailedVerifyIndex = toolCalls.reduce((lastIndex, call, index) => (
    isFailedVerificationCall(call) ? index : lastIndex
  ), -1)
  const preWriteCalls = firstWriteIndex >= 0 ? toolCalls.slice(0, firstWriteIndex) : toolCalls
  const postWriteCalls = lastWriteIndex >= 0 ? toolCalls.slice(lastWriteIndex + 1) : []
  const preWriteReadCalls = preWriteCalls.filter(isReadLikeCall)
  const preWriteSearchCalls = preWriteCalls.filter(isSearchCall)
  const postWriteReadCalls = postWriteCalls.filter(isReadLikeCall)
  const postWriteSearchCalls = postWriteCalls.filter(isSearchCall)
  const postWriteDiffCalls = postWriteCalls.filter(isDiffCall)
  const postWriteVerifyCalls = postWriteCalls.filter(isStaticVerificationCall)
  const postWriteRuntimeVerifyCalls = postWriteCalls.filter(isRuntimeVerificationCall)
  const postWriteQualifiedRuntimeVerifyCalls = postWriteCalls.filter(isQualifiedRuntimeVerificationCall)
  const postWriteReviewCount = lastWriteIndex >= 0
    ? postWriteCalls.filter(isPostWriteReviewCall).length
    : 0
  const postFailureCalls = lastFailedVerifyIndex >= 0 ? toolCalls.slice(lastFailedVerifyIndex + 1) : []
  const postFailureText = postFailureCalls.map(getToolText).join('\n')
  const changedPaths = writeCalls.map(extractPath).filter(Boolean)
  const readPaths = readCalls.map(extractPath).filter(Boolean)
  const preWriteReadPaths = preWriteReadCalls.map(extractPath).filter(Boolean)
  const postWriteReadPaths = postWriteReadCalls.map(extractPath).filter(Boolean)
  const postWriteDirectReadPaths = postWriteReadCalls
    .filter(call => call.name !== 'run_command')
    .map(extractPath)
    .filter(Boolean)
  const postWriteSceneReads = postWriteReadCalls.filter(call => WEB_SCENE_PATH_PATTERN.test(String(extractPath(call) || '')))
  const writeLineRecords = getWriteLineRecords(writeCalls)
  const changedCodePaths = changedPaths.filter(isCodePath)
  const changedEntryCodePaths = changedPaths.filter(isEntryCodePath)
  const oversizedCodeFiles = writeLineRecords.filter(item => item.isCode && item.lineCount > 2000)
  const largeCodeFiles = writeLineRecords.filter(item => item.isCode && item.lineCount >= 1600)
  const hasEmptyProjectEvidence = toolCalls.some(isEmptyInventoryCall)
  const postWriteReviewTouchesChangedPath =
    postWriteDiffCalls.length > 0 ||
    changedPaths.length === 0 ||
    changedPaths.some(changedPath => postWriteReadPaths.some(readPath => pathsLookRelated(changedPath, readPath)))
  const postWriteExternalRead =
    postWriteDirectReadPaths.some(readPath => !changedPaths.some(changedPath => pathsLookRelated(changedPath, readPath)))
  const postWriteEntryRead = postWriteDirectReadPaths.some(isEntryCodePath)
  const postWriteImpactEvidence =
    hasEmptyProjectEvidence ||
    postWriteSearchCalls.length > 0 ||
    postWriteExternalRead ||
    postWriteEntryRead ||
    callsResultOrSearchOutputContainsPattern(postWriteCalls, IMPACT_CONTEXT_PATTERN) ||
    callsResultOrSearchOutputContainsPattern(postWriteCalls, REGRESSION_EVIDENCE_PATTERN)
  const isWebSceneChange =
    changedPaths.some(path => WEB_SCENE_PATH_PATTERN.test(String(path || ''))) ||
    callsResultOrSearchOutputContainsPattern(toolCalls, WEB_SCENE_REGRESSION_PATTERN)
  const hasWebSceneRegressionEvidence =
    !isWebSceneChange ||
    postWriteSceneReads.some(call => callResultContainsPattern(call, WEB_SCENE_REGRESSION_DETAIL_PATTERN)) ||
    postWriteSearchCalls.some(call => callResultContainsPattern(call, WEB_SCENE_REGRESSION_DETAIL_PATTERN)) ||
    verifyCalls.some(call => callResultContainsPattern(call, WEB_SCENE_REGRESSION_DETAIL_PATTERN))
  const hasCompensatingPreWriteAudit =
    firstWriteIndex < 0 ||
    preWriteReadCalls.length > 0 ||
    (postWriteReviewTouchesChangedPath && postWriteImpactEvidence && (postWriteReadCalls.length > 0 || postWriteDiffCalls.length > 0 || postWriteSearchCalls.length > 0))
  const hasSufficientPreWriteContext =
    firstWriteIndex < 0 ||
    hasEmptyProjectEvidence ||
    preWriteReadCalls.length >= 2 ||
    preWriteSearchCalls.length > 0 ||
    (postWriteReviewTouchesChangedPath && postWriteImpactEvidence)
  const hasFileSizeBoundaryEvidence =
    FILE_SIZE_BOUNDARY_PATTERN.test(text) ||
    FILE_SIZE_BOUNDARY_PATTERN.test(commandText) ||
    writeLineRecords.some(item => item.lineCount > 0)
  const webUiWorkflowChoice = getWebUiWorkflowChoice(toolCalls)
  const immersiveWebTemplateSmells = getImmersiveWebTemplateSmells({ text, changedPaths, changedCodePaths })
  const hasImmersiveWebModuleSplit = hasImmersiveWebModuleSplitEvidence({ text, changedPaths, changedCodePaths })
  const isSingleFileImmersiveImplementation = hasSingleFileImmersiveImplementation({ text, changedPaths, changedCodePaths })

  return {
    text,
    readCount: readCalls.length,
    writeCount: writeCalls.length,
    verifyCount: verifyCalls.length,
    failedVerifyCount: failedVerifyCalls.length,
    commandCount: commandCalls.length,
    firstWriteIndex,
    lastWriteIndex,
    preWriteReadCount: preWriteReadCalls.length,
    preWriteSearchCount: preWriteSearchCalls.length,
    postWriteReadCount: postWriteReadCalls.length,
    postWriteSearchCount: postWriteSearchCalls.length,
    postWriteDiffCount: postWriteDiffCalls.length,
    postWriteVerifyCount: postWriteVerifyCalls.length,
    postWriteReviewCount,
    hasPreWriteRead: firstWriteIndex < 0 || preWriteReadCalls.length > 0,
    hasPreWriteSearch: firstWriteIndex < 0 || preWriteSearchCalls.length > 0,
    hasCompensatingPreWriteAudit,
    hasSufficientPreWriteContext,
    hasPostWriteRead: lastWriteIndex < 0 || postWriteReadCalls.length > 0,
    hasPostWriteDiff: lastWriteIndex < 0 || postWriteDiffCalls.length > 0,
    hasPostWriteVerification: lastWriteIndex < 0 || postWriteVerifyCalls.length > 0,
    hasPostWriteRuntimeVerification: lastWriteIndex < 0 || postWriteQualifiedRuntimeVerifyCalls.length > 0,
    postWriteRuntimeVerifyCount: postWriteRuntimeVerifyCalls.length,
    lastRuntimeVerificationStatus: (() => {
      const last = [...postWriteRuntimeVerifyCalls].reverse()[0]
      return last
        ? String(last?.result?.verification_status || last?.result?.verificationStatus || '').toLowerCase() || null
        : null
    })(),
    hasPostWriteReview: lastWriteIndex < 0 || (postWriteReviewCount > 0 && postWriteReviewTouchesChangedPath),
    hasPostWriteReviewTouchesChangedPath: lastWriteIndex < 0 || postWriteReviewTouchesChangedPath,
    hasPostWriteImpactEvidence: lastWriteIndex < 0 || postWriteImpactEvidence,
    isWebSceneChange,
    hasWebSceneRegressionEvidence,
    hasWebsiteRuntimeResearchEvidence: hasWebsiteRuntimeResearchEvidence({ text, toolCalls, changedPaths }),
    hasFailedVerification: failedVerifyCalls.length > 0,
    hasPostFailureAnalysis: lastFailedVerifyIndex < 0 || postFailureCalls.some(call => isReadLikeCall(call) || (call.name === 'run_command' && READ_COMMAND_PATTERN.test(getCommandText(call)))),
    hasPostFailureWrite: lastFailedVerifyIndex >= 0 && postFailureCalls.some(isWriteLikeCall),
    hasSuccessfulVerificationAfterFailure: lastFailedVerifyIndex >= 0 && postFailureCalls.some(call => isVerificationCall(call) && !isFailedCommandCall(call)),
    postFailureText,
    changedPaths,
    changedCodePaths,
    changedEntryCodePaths,
    writeLineRecords,
    oversizedCodeFiles,
    largeCodeFiles,
    hasChangedCodeFiles: changedCodePaths.length > 0,
    hasChangedEntryCodeFiles: changedEntryCodePaths.length > 0,
    hasFileSizeBoundaryEvidence,
    immersiveWebTemplateSmells,
    hasImmersiveWebTemplateSmells: immersiveWebTemplateSmells.length > 0,
    hasImmersiveWebModuleSplit,
    isSingleFileImmersiveImplementation,
    readPaths,
    preWriteReadPaths,
    postWriteReadPaths,
    postWriteDirectReadPaths,
    commandText,
    hasInventoryEvidence: toolCalls.some(call => call.name === 'list_files') || /(rg\s+--files|git\s+ls-files|dir\s+\/|get-childitem)/i.test(commandText),
    hasEmptyProjectEvidence,
    hasSearchEvidence: commandCalls.some(call => SEARCH_COMMAND_PATTERN.test(getCommandText(call))),
    hasGitEvidence: /git\s+(ls-files|status|diff|show)|\.gitignore/.test(text),
    hasFailureEvidence: /(error|exception|failed|失败|报错|错误|异常|崩溃|undefined|not defined|cannot|enoent)/i.test(text),
    isElectronProject: ELECTRON_PATTERN.test(text),
    webUiWorkflowChoice,
    // 仅当用户明确选择沉浸式方向时才强制沉浸式质检门槛
    enforceImmersiveWeb: webUiWorkflowChoice === 'immersive'
  }
}

function getFailureCheckpoint(taskType, activity) {
  if (!activity.hasFailedVerification) return null

  if (!activity.hasPostFailureAnalysis) {
    return makeCheckpoint(
      `${taskType}:failed-verification-analysis:${activity.failedVerifyCount}:${activity.commandCount}`,
      '验证失败，先分析失败原因和影响级别。',
      '验证命令失败：不能直接总结，也不能笼统说“代码质量问题”。下一步必须根据失败输出继续调用工具，读取报错指向的文件或配置，区分阻塞错误、普通警告、环境限制和是否由本次改动引入；能修就继续修。'
    )
  }

  const postFailureLooksClassified =
    /(warning|warn|警告|eslint|lint|type|typescript|syntax|compile|build|test|env|environment|permission|timeout|阻塞|非阻塞|环境|权限|超时|语法|类型|构建|测试|警告)/i.test(activity.postFailureText)

  if (!postFailureLooksClassified) {
    return makeCheckpoint(
      `${taskType}:failed-verification-classify:${activity.failedVerifyCount}:${activity.readCount}:${activity.commandCount}`,
      '验证失败已补查，但还没分清阻塞级别。',
      '需要把验证失败分级：哪些是阻塞运行/发布的错误，哪些只是警告或风格问题，哪些是环境限制。请继续调用工具补查输出和相关文件，不能把失败简单归类成“代码质量问题”。'
    )
  }

  if (CHANGE_TASKS.has(taskType) && activity.hasPostFailureWrite && !activity.hasSuccessfulVerificationAfterFailure) {
    return makeCheckpoint(
      `${taskType}:failed-verification-reverify:${activity.failedVerifyCount}:${activity.writeCount}:${activity.commandCount}`,
      '验证失败后已修过，必须重新验证。',
      '验证失败后又修改了代码。下一步必须重新运行相关语法、类型、测试、构建或启动检查；不能在未重新验证时总结。'
    )
  }

  return null
}

function getReviewCoverage(text) {
  return {
    structure: /package\.json|项目结构|目录|入口|dockerfile|list_files/.test(text),
    secrets: /api[_-]?key|token|secret|密码|smtp|\.env|authorization/.test(text),
    auth: /auth|login|register|session|cookie|权限|管理员|admin|用户/.test(text),
    authorization: /越权|无权|owner|user_id|belongs|findbyid|delete|update|patch|put/.test(text),
    fileIo: /upload|avatar|file|path\.join|文件上传|路径|目录穿越|read_file|write_file/.test(text),
    deploy: /dockerfile|docker-compose|deploy|systemd|nginx|build-deploy|gzip|部署|构建/.test(text),
    aiExternal: /fetch\(|abortcontroller|timeout|超时|限流|rate limit|ai api|model-config|gateway/.test(text),
    electronSecurity: /electron|preload|contextbridge|ipcmain|ipcrenderer|nodeintegration|websecurity|browserwindow/.test(text),
    toolPermission: /run_command|executeTool|read_file|write_file|delete_file|resolvePath|工具|命令执行|文件访问|白名单|权限/.test(text),
    projectIsolation: /projectId|projectPath|activeProject|contextManager|storagePath|项目隔离|多窗口|windowId|session/.test(text)
  }
}

function getDistinctReviewEvidenceCount(activity) {
  const buckets = new Set()
  for (const path of activity.readPaths) {
    const normalized = String(path || '').replace(/\\/g, '/').toLowerCase()
    if (!normalized) continue
    if (normalized.includes('package.json')) buckets.add('package')
    else if (normalized.includes('main.js') || normalized.includes('preload')) buckets.add('electron-entry')
    else if (normalized.includes('/modules/') || normalized.includes('modules/')) buckets.add('modules')
    else if (normalized.includes('/tools') || normalized.includes('tools')) buckets.add('tools')
    else if (normalized.includes('/frontend') || normalized.includes('frontend')) buckets.add('frontend')
    else if (normalized.includes('/skills') || normalized.includes('skills')) buckets.add('skills')
    else if (normalized.includes('config') || normalized.includes('.env')) buckets.add('config')
    else if (normalized.includes('deploy') || normalized.includes('docker') || normalized.includes('.bat') || normalized.includes('.ps1')) buckets.add('deploy')
    else buckets.add(normalized.split('/').slice(0, 2).join('/'))
  }
  return buckets.size
}

function getChangeEvidenceMatrix(taskType, activity) {
  const categories = [
    ['target', '目标文件/报错位置', activity.readCount > 0],
    ['search', '搜索调用方或同类实现', activity.hasSearchEvidence],
    ['entry', '入口/事件/API/IPC 接入点', hasText(activity, /入口|init|初始化|addEventListener|onclick|ipcmain|ipcrenderer|handle\(|invoke\(|route|api|command|register|入口|事件|绑定/)],
    ['stateData', '状态流/数据流/配置来源', hasText(activity, /state|store|context|projectid|projectpath|config|storage|cache|session|data|model|状态|数据流|配置|上下文/)],
    ['adjacentPattern', '相邻实现或既有模式', activity.readCount >= 2 || hasText(activity, /similar|同类|相邻|已有|现有|pattern|模块|component|renderer|handler/)],
    ['fileSizeBoundary', '代码文件 2000 行边界/模块拆分', !activity.hasChangedCodeFiles || activity.hasFileSizeBoundaryEvidence],
    ['write', '实际代码修改', activity.writeCount > 0],
    ['preWriteContext', '改前上下文/补救式影响面审查', activity.hasSufficientPreWriteContext],
    ['postReview', '改后复查改动文件/diff', activity.hasPostWriteReview],
    ['postRegression', '改后回归旧行为/入口', activity.hasPostWriteImpactEvidence],
    ['verification', '改后语法/类型/构建/测试验证', activity.hasPostWriteVerification]
  ]

  if (taskType === 'bugfix') {
    categories.push(
      ['failureEvidence', '报错/异常证据', activity.hasFailureEvidence || hasText(activity, /error|exception|undefined|not defined|失败|报错|错误|异常|崩溃/)],
      ['rootCauseTrace', '根因链路证据', hasText(activity, /调用链|根因|导致|from|stack|trace|原因|触发|undefined|not defined|状态流|数据流/)]
    )
  }

  if (taskType === 'ui') {
    categories.push(
      ['styleSystem', '样式体系/主题变量', hasText(activity, /css|style|class|theme|颜色|变量|hover|active|responsive|响应式|样式|主题/)],
      ['interactionState', '交互状态', hasText(activity, /hover|active|focus|click|disabled|loading|empty|error|modal|panel|弹窗|关闭|加载|空态|错误态/)],
      ['webAssetInventory', '网页资产盘点/生成素材', hasWebAssetInventoryEvidence(activity)],
      ['webSceneConcept', '沉浸式场景/主视觉对象', hasImmersiveWebSceneEvidence(activity)],
      ['webSceneStateMachine', '滚动/鼠标/触摸场景状态机', hasWebSceneStateMachineEvidence(activity)],
      ['webLocalDependencies', '内嵌创意依赖/资产处理', hasWebLocalDependencyEvidence(activity)],
      ['webPreviewFallback', 'index.html 预览/WebGL 降级', hasWebPreviewFallbackEvidence(activity)],
      ['webInteractionAudio', '首次交互音频策略', hasWebInteractionAudioEvidence(activity)],
      ['webResponsive', '网页响应式/移动端', hasText(activity, /media\s*\(|@media|breakpoint|responsive|mobile|desktop|tablet|viewport|clamp|minmax|grid|flex|响应式|移动端|窄屏|桌面|断点/)],
      ['webModernNoAiTaste', '现代化且避免 AI 味', hasText(activity, /modern|premium|editorial|minimal|density|spacing|tokens|cinematic|immersive|interactive|现代|高级|克制|质感|避免ai|ai味|沉浸|交互|粒子|场景|渐变|光球|emoji|抽象/)],
      ['webTimePolicy', '年份/时间规则', hasText(activity, /new Date\(\)\.getFullYear|getFullYear|current year|copyright|©|版权|年份|当前年份|2026|不要硬编码|动态年份/)]
    )
  }

  if (taskType === 'refactor') {
    categories.push(
      ['compatibility', '旧入口/导出兼容', hasText(activity, /module\.exports|exports|window\.|global|旧入口|转发|兼容|导出|调用方|初始化|循环依赖/)],
      ['behaviorPreserved', '行为不变证据', hasText(activity, /行为不变|兼容|转发|保持|不改变|same behavior|no behavior change/)]
    )
  }

  if (taskType === 'feature') {
    categories.push(
      ['modularDesign', '模块化设计/目录骨架', hasText(activity, /module|modules|component|components|service|services|controller|controllers|router|routes|store|stores|shared|utils|lib|feature|features|frontend|backend|模块化|模块边界|目录结构|骨架|分层/)],
      ['contract', '前后端/API/IPC 契约', hasText(activity, /api|ipc|route|endpoint|fetch\(|invoke\(|handle\(|preload|contextbridge|request|response|params|payload|schema|契约|接口|参数|返回值|前端|后端/)],
      ['realLogic', '真实业务逻辑而非摆设', hasText(activity, /save|load|persist|storage|database|fs\.|write|read|state|store|service|handler|实际逻辑|真实逻辑|落盘|保存|读取|调用后端|不是摆设/)],
      ['designSystem', '设计系统/SVG 图标/主题变量', hasText(activity, /svg|icon|lucide|heroicons|class|css|theme|variable|token|color|layout|设计系统|图标|主题|变量|颜色|布局|现代化|emoji/)],
      ['uiStates', '加载/空态/错误态/禁用态', hasText(activity, /loading|empty|error|disabled|pending|success|failure|fallback|加载|空态|错误态|禁用|失败|成功|提示/)],
      ['persistenceOrBoundary', '持久化/权限/边界', hasText(activity, /storage|persist|save|load|permission|projectid|projectpath|持久化|保存|加载|权限|隔离|边界/)]
    )
  }

  const found = categories.filter(([, , ok]) => !!ok)
  const missing = categories.filter(([, , ok]) => !ok).map(([, label]) => label)
  return {
    categories,
    found,
    missing,
    foundCount: found.length,
    requiredCount: categories.length
  }
}

function hasPath(activity, pattern) {
  return activity.readPaths.some(path => pattern.test(normalizePath(path)))
}

function hasText(activity, pattern) {
  return pattern.test(activity.text)
}

function getReviewCorrectnessTracks(activity) {
  const tracks = [
    ['syntaxRuntime', '语法/类型/运行错误', /syntax|parse|compile|typeerror|referenceerror|undefined|not defined|cannot read|cannot find|eslint|tsc|node --check|build|test|lint|语法|类型|运行错误|报错|崩溃|失败/i],
    ['importsExports', '导入/导出/模块接线', /import|export|require|module\.exports|exports\.|not exported|cannot find module|循环依赖|导入|导出|模块|入口|旧入口|转发|初始化/i],
    ['callChain', '调用链/API/事件接线', /调用链|调用方|被调用|handler|route|api|ipcmain|ipcrenderer|handle\(|invoke\(|addEventListener|onclick|事件|绑定|接入|入口|主流程|流程/i],
    ['stateDataFlow', '状态/数据/配置流', /state|store|context|projectid|projectpath|config|storage|cache|session|database|sqlite|model|data|状态|数据流|上下文|配置|持久化|缓存/i],
    ['asyncLifecycle', '异步/生命周期/竞态', /async|await|promise|then\(|catch\(|settimeout|setinterval|abortcontroller|timeout|race|cleanup|destroy|dispose|removeeventlistener|异步|生命周期|竞态|清理|超时|取消/i],
    ['nullBoundary', '空值/边界/默认值', /null|undefined|optional|default|fallback|validate|schema|empty|edge|boundary|空引用|空值|默认值|边界|校验|异常路径/i],
    ['configDependency', '配置/依赖/启动匹配', /package\.json|scripts|dependencies|devdependencies|env|docker|vite|webpack|electron-builder|requirements|pyproject|启动|依赖|配置|构建|打包/i],
    ['duplicateImplementation', '重复实现/残留代码', /duplicate|legacy|deprecated|todo|fixme|重复|残留|旧代码|旧入口|双实现|多套|可维护|模块化/i]
  ]

  return tracks
    .filter(([, , pattern]) => hasText(activity, pattern))
    .map(([key, label]) => ({ key, label }))
}

function getReviewRiskTracks(activity) {
  const tracks = [
    ['secrets', '密钥/凭证', /api[_-]?key|token|secret|password|密码|smtp|authorization|\.env|sk-[a-z0-9]/i],
    ['auth', '认证/会话', /auth|login|register|session|cookie|jwt|oauth|验证码|send-code|password|用户/i],
    ['authorization', '权限/数据归属', /owner|user_id|userid|belongs|permission|role|admin|管理员|越权|无权|delete|update|patch|put|处理举报|日志/i],
    ['fileBoundary', '上传/文件路径', /upload|avatar|file|path\.join|readfile|writefile|fs\.|resolvepath|目录穿越|路径|read_file|write_file|delete_file/i],
    ['deployRuntime', '部署/启动链路', /docker|dockerfile|docker-compose|deploy|systemd|nginx|build|start|gzip|bat|ps1|sh|构建|部署|启动/i],
    ['externalApi', '外部接口/超时限流', /fetch\(|axios|abortcontroller|timeout|rate limit|限流|ai api|model|gateway|smtp|email|邮件/i],
    ['dataBoundary', '数据库/数据串写', /sql|sqlite|supabase|prisma|database|db\.|redis|storage|chapter|workid|post|share|relationship|数据/i],
    ['electronAgent', 'Electron/Agent 权限边界', /electron|ipcmain|ipcrenderer|preload|contextbridge|nodeintegration|websecurity|run_command|executeTool|tool|resolvepath|projectid|projectpath|多窗口|项目隔离|上下文/i]
  ]

  return tracks
    .filter(([, , pattern]) => hasText(activity, pattern))
    .map(([key, label]) => ({ key, label }))
}

function hasReviewAuthSurface(activity) {
  return hasText(activity, /auth|login|register|session|cookie|jwt|oauth|验证码|user|用户|admin|管理员|owner|user_id|userid|role|permission/)
}

function getReviewLayerCoverage(activity) {
  const layers = [
    ['entry', '入口/启动层', /package\.json|scripts|main|index|app|server|router|route|入口|启动|bootstrap|electron|preload|ipcmain|ipcrenderer/],
    ['architecture', '架构/模块边界', /架构|模块|目录|service|controller|handler|component|store|renderer|preload|ipc|api|database|client|server|分层|边界/],
    ['businessCore', '核心业务流', /核心|业务|work|chapter|post|order|task|agent|chat|message|project|context|skill|model|dispatch|session|流程|状态机|主流程/],
    ['dataState', '数据/状态/持久化', /database|sqlite|sql|prisma|supabase|redis|storage|store|state|cache|session|context|projectid|user_id|workid|数据|状态|持久化|缓存/],
    ['boundarySecurity', '边界/权限/输入输出', /auth|login|permission|owner|role|admin|upload|file|path|fetch\(|api|ipc|run_command|resolvepath|validate|sanitize|schema|权限|越权|上传|路径|输入|输出/],
    ['errorHandling', '错误处理/异常路径', /try|catch|throw|error|exception|failed|timeout|abort|fallback|retry|warning|错误|异常|失败|超时|重试|降级/],
    ['runtimeDeploy', '运行/部署/依赖', /docker|deploy|build|start|dev|test|lint|tsc|npm|pnpm|yarn|requirements|pyproject|env|config|nginx|systemd|bat|ps1|运行|部署|构建|依赖/],
    ['testsValidation', '测试/验证', /test|spec|jest|vitest|pytest|lint|tsc|node --check|build|coverage|测试|验证|检查/],
    ['maintainability', '可维护性/重复实现', /duplicate|重复|legacy|兼容|deprecated|todo|fixme|any|循环依赖|残留|旧入口|模块化|可维护|命名|类型/]
  ]

  const covered = layers.filter(([, , pattern]) => hasText(activity, pattern))
  const missing = layers.filter(([, , pattern]) => !hasText(activity, pattern)).map(([, label]) => label)
  return {
    covered,
    missing,
    coveredCount: covered.length,
    requiredCount: layers.length
  }
}

function getReviewWorkflowState(activity) {
  const distinctEvidenceCount = getDistinctReviewEvidenceCount(activity)
  const correctnessTracks = getReviewCorrectnessTracks(activity)
  const riskTracks = getReviewRiskTracks(activity)
  const riskTrackKeys = new Set(riskTracks.map(item => item.key))
  const hasAuthSurface = hasReviewAuthSurface(activity)
  const layerCoverage = getReviewLayerCoverage(activity)

  return {
    distinctEvidenceCount,
    layerCoverage,
    layerCoverageCount: layerCoverage.coveredCount,
    correctnessTracks,
    correctnessTrackCount: correctnessTracks.length,
    riskTracks,
    riskTrackCount: riskTracks.length,
    hasProjectPurpose: activity.hasInventoryEvidence ||
      hasPath(activity, /package\.json$|readme|pyproject|requirements|cargo\.toml|go\.mod|pom\.xml/) ||
      hasText(activity, /项目.*(用途|做什么|类型|入口)|scripts|dependencies|electron|vite|next|express|fastapi|django|flask|spring|tauri|cli/),
    hasArchitectureView: distinctEvidenceCount >= 2 &&
      hasText(activity, /架构|模块|目录|入口|调用|路由|ipc|组件|renderer|preload|main process|server|client|database|service|controller|handler|api|store|state/),
    hasCodeCorrectnessScan: correctnessTracks.length >= 2 ||
      activity.hasSearchEvidence ||
      activity.verifyCount > 0 ||
      hasText(activity, /语法|类型|运行错误|报错|undefined|not defined|cannot|import|export|require|调用链|入口|状态|数据流|配置|异常路径/),
    hasCoreCallChainReview: distinctEvidenceCount >= 3 &&
      hasText(activity, /核心|关键|main|app|route|api|handler|service|controller|store|renderer|preload|ipc|tools|调用链|调用方|被调用|事件|绑定|接入|入口|主流程/),
    hasStateDataFlowReview: hasText(activity, /state|store|context|projectid|projectpath|config|storage|cache|session|database|sqlite|model|data|状态|数据流|上下文|配置|持久化|缓存|读取|保存|加载/),
    hasRuntimeErrorPathReview: activity.hasSearchEvidence ||
      activity.verifyCount > 0 ||
      hasText(activity, /try|catch|throw|error|exception|failed|timeout|fallback|retry|warning|todo|fixme|undefined|not defined|cannot|语法|类型|错误|报错|失败|异常|超时|降级/),
    hasMaintainabilityReview: hasText(activity, /duplicate|重复|legacy|旧入口|残留|deprecated|todo|fixme|any|循环依赖|模块化|可维护|命名|导出|兼容|多套|同类实现/),
    hasRiskFocus: riskTracks.length >= (activity.isElectronProject ? 3 : 2) ||
      hasText(activity, /重点.*(密钥|权限|上传|部署|接口|数据库|文件|命令|隔离)|高风险|硬编码|越权|泄露|部署失败|线上不稳定/),
    hasErrorScan: activity.hasSearchEvidence ||
      activity.verifyCount > 0 ||
      hasText(activity, /error|exception|failed|warning|todo|fixme|undefined|not defined|cannot|eslint|tsc|node --check|lint|build|test|语法|类型|错误|报错|失败/),
    hasOwnershipDeepDive: !hasAuthSurface ||
      riskTrackKeys.has('authorization') ||
      hasText(activity, /用户a|用户A|别人|自己的|owner|user_id|userid|belongs|归属|越权|无权|管理员|admin|role|permission|处理举报|日志|delete|update|patch|put/),
    hasCoreCodeReview: distinctEvidenceCount >= 3 &&
      hasText(activity, /核心|关键|main|app|route|api|handler|service|controller|store|renderer|preload|ipc|tools|auth|database|状态|上下文|权限|文件|命令/),
    hasLayeredReview: layerCoverage.coveredCount >= 6 &&
      hasText(activity, /入口|启动|架构|模块|核心|业务|数据|状态|权限|边界|错误|异常|部署|构建|测试|验证|可维护|重复/),
    hasSourceConfirmation: activity.hasSearchEvidence ||
      activity.hasGitEvidence ||
      hasText(activity, /确认|定位|证据|第\s*\d+\s*行|line\s*\d+|文件.*行|源码|route\.|\.ts|\.js|\.py|\.tsx|\.jsx|\.json|\.yml|\.yaml|\.ps1|\.bat/),
    hasIssueVerification: activity.verifyCount > 0 ||
      activity.hasGitEvidence ||
      hasText(activity, /验证|确认|复现|证明|核对|git status|git ls-files|node --check|tsc|build|test|无法验证|未发现/),
    hasEnoughDepth: activity.readCount >= 8 &&
      distinctEvidenceCount >= 3 &&
      correctnessTracks.length >= 3 &&
      layerCoverage.coveredCount >= 6 &&
      (activity.hasSearchEvidence || activity.commandCount > 0)
  }
}

function getChangeWorkflowState(taskType, userMessage, activity) {
  const text = String(userMessage || '')
  const isBugfix = taskType === 'bugfix'
  const isFeature = taskType === 'feature'
  const isUi = taskType === 'ui'
  const isWebUiTask = (isUi || isFeature) && /(网页|网站|官网|落地页|landing|web\s?page|homepage|home\s?page|个人主页|个人介绍页|个人介绍页面|个人简介页|个人简历页|简历页|作品集|作品集页面|个人站|个人网站|portfolio|profile\s?page|about\s?page|前端页面|页面设计|hero|首屏|响应式|移动端|博客|作品页|电商|文档站|内容站)/i.test(text)
  const looksLikePreviousChangeBug = isBugfix && /(刚刚|之前|上一步|上一轮|依旧|还是|没有修复|又|现在|语法错误|报错|错误|失败|没反应|不生效)/i.test(text)
  const referencesTargetWebsite = isWebUiTask && WEBSITE_REFERENCE_PATTERN.test(text)
  const hasModuleBoundaryEvidence =
    hasText(activity, /module|modules|component|components|service|services|controller|controllers|router|routes|store|stores|shared|utils|lib|feature|features|frontend|backend|模块化|模块边界|目录结构|骨架|分层/) ||
    activity.changedPaths.some(path => /(^|[\\/])(frontend|backend|shared|modules|components|services|routes|controllers|stores|utils|lib|features)([\\/]|$)/i.test(String(path || '')))
  const hasContractEvidence =
    hasText(activity, /api|ipc|route|endpoint|fetch\(|invoke\(|handle\(|preload|contextbridge|request|response|params|payload|schema|契约|接口|参数|返回值|前端|后端/) ||
    activity.changedPaths.some(path => /(^|[\\/])(api|routes|controllers|services|electron|preload|backend)([\\/]|$)/i.test(String(path || '')))
  const hasRealLogicEvidence =
    hasText(activity, /save|load|persist|storage|database|fs\.|write|read|state|store|service|handler|actual|真实逻辑|实际逻辑|落盘|保存|读取|调用后端|不是摆设/)
  const hasDesignSystemEvidence =
    hasText(activity, /svg|icon|lucide|heroicons|class|css|theme|variable|token|color|layout|设计系统|图标|主题|变量|颜色|布局|现代化|emoji|three|gsap|canvas|webgl|scene|场景|粒子|交互/)
  const hasUiStatesEvidence =
    hasText(activity, /loading|empty|error|disabled|pending|success|failure|fallback|加载|空态|错误态|禁用|失败|成功|提示/)
  const enforceImmersiveWeb = activity.enforceImmersiveWeb !== false
  const hasWebAssetInventory = !isWebUiTask || !enforceImmersiveWeb || hasWebAssetInventoryEvidence(activity)
  const hasWebSceneConcept = !isWebUiTask || !enforceImmersiveWeb || hasImmersiveWebSceneEvidence(activity)
  const hasWebSceneStateMachine = !isWebUiTask || !enforceImmersiveWeb || hasWebSceneStateMachineEvidence(activity)
  const hasWebLocalDependencies = !isWebUiTask || !enforceImmersiveWeb || hasWebLocalDependencyEvidence(activity)
  const hasWebPreviewFallback = !isWebUiTask || hasWebPreviewFallbackEvidence(activity)
  const hasWebInteractionAudio = !isWebUiTask || !enforceImmersiveWeb || hasWebInteractionAudioEvidence(activity)
  const hasImmersiveWebQuality = !isWebUiTask || !enforceImmersiveWeb ||
    (!activity.hasImmersiveWebTemplateSmells && !activity.isSingleFileImmersiveImplementation && activity.hasImmersiveWebModuleSplit)
  const hasWebResponsiveEvidence =
    !isWebUiTask || hasText(activity, /media\s*\(|@media|breakpoint|responsive|mobile|desktop|tablet|viewport|clamp|minmax|grid|flex|响应式|移动端|窄屏|桌面|断点/)
  const hasWebTimePolicyEvidence =
    !isWebUiTask || hasText(activity, /new Date\(\)\.getFullYear|getFullYear|current year|copyright|©|版权|年份|当前年份|2026|不要硬编码|动态年份/)
  const hasModuleSplitEvidence =
    activity.changedCodePaths.length >= 2 ||
    hasText(activity, /模块拆分|拆成.*模块|拆分.*文件|入口.*装配|入口.*接线|引用声明|组合层|composition|import|export|require/)
  return {
    isWebUiTask,
    referencesTargetWebsite,
    enforceImmersiveWeb,
    isEmptyProject: activity.hasEmptyProjectEvidence && activity.readCount <= 2,
    looksLikePreviousChangeBug,
    hasTargetContext: activity.readCount > 0 || activity.hasSearchEvidence,
    hasPreWriteContext: activity.hasPreWriteRead || activity.hasEmptyProjectEvidence,
    hasSufficientPreWriteContext: activity.hasSufficientPreWriteContext,
    hasCompensatingPreWriteAudit: activity.hasCompensatingPreWriteAudit,
    hasPriorChangeTrace: !looksLikePreviousChangeBug ||
      activity.hasGitEvidence ||
      activity.hasSearchEvidence ||
      activity.readCount >= 2 ||
      hasText(activity, /diff|最近|上次|上一轮|改动|修改|根因|原因|导致|调用链|回退|变更/),
    hasImpactContext: activity.readCount >= 2 ||
      hasText(activity, /影响|调用链|入口|接入|状态|数据流|导出|绑定|初始化|同类|现有|相邻|依赖|模块|样式|事件|ipc|api/),
    hasExistingCodeBasis: activity.hasEmptyProjectEvidence ||
      activity.hasSearchEvidence ||
      activity.readCount >= 2 ||
      hasText(activity, /已有|现有|同类|相邻|复用|原代码|原有|入口|模块|不要新建|避免重复|残留/),
    hasModulePlan: !isFeature || hasModuleBoundaryEvidence,
    hasFileSizeBoundary: !activity.hasChangedCodeFiles || activity.hasFileSizeBoundaryEvidence,
    hasOversizedCodeFiles: activity.oversizedCodeFiles.length > 0,
    hasLargeEntryCodeFiles: activity.largeCodeFiles.some(item => item.isEntry),
    hasModuleSplitEvidence,
    oversizedCodeFiles: activity.oversizedCodeFiles,
    largeCodeFiles: activity.largeCodeFiles,
    hasContractPlan: !isFeature || hasContractEvidence,
    hasRealLogic: !isFeature || hasRealLogicEvidence,
    hasDesignSystem: !isFeature || hasDesignSystemEvidence,
    hasUiStates: !isFeature || hasUiStatesEvidence,
    hasWebAssetInventory,
    hasWebSceneConcept,
    hasWebSceneStateMachine,
    hasWebLocalDependencies,
    hasWebPreviewFallback,
    hasWebInteractionAudio,
    hasImmersiveWebQuality,
    immersiveWebTemplateSmells: activity.immersiveWebTemplateSmells,
    hasImmersiveWebModuleSplit: activity.hasImmersiveWebModuleSplit,
    isSingleFileImmersiveImplementation: activity.isSingleFileImmersiveImplementation,
    hasWebsiteRuntimeResearch: !referencesTargetWebsite || activity.hasWebsiteRuntimeResearchEvidence,
    hasEmojiIconInWrittenContent: isWebUiTask && hasEmojiIconInWrittenContent(activity),
    hasWebResponsive: hasWebResponsiveEvidence,
    hasWebTimePolicy: hasWebTimePolicyEvidence,
    hasWrite: activity.writeCount > 0,
    hasPostWriteReview: activity.hasPostWriteReview,
    hasPostWriteImpactEvidence: activity.hasPostWriteImpactEvidence,
    hasPostWriteVerification: activity.hasPostWriteVerification,
    hasPostWriteRuntimeVerification: activity.hasPostWriteRuntimeVerification,
    lastRuntimeVerificationStatus: activity.lastRuntimeVerificationStatus,
    isWebSceneChange: activity.isWebSceneChange,
    hasWebSceneRegressionEvidence: activity.hasWebSceneRegressionEvidence,
    hasVerification: activity.verifyCount > 0
  }
}

function getReviewEvidenceMatrix(activity) {
  const electronCategories = [
    ['inventory', '项目文件清单', activity.hasInventoryEvidence],
    ['packageConfig', '包管理和启动脚本', hasPath(activity, /package\.json$/) || hasText(activity, /package\.json|scripts|dependencies/)],
    ['electronEntry', 'Electron 主进程/preload', hasPath(activity, /(electron\/)?(main|preload)\.js$/) || hasText(activity, /browserwindow|preload|contextbridge|ipcmain|ipcrenderer|nodeintegration|websecurity/)],
    ['ipcBoundary', 'IPC 暴露边界', hasPath(activity, /preload|ipc|tools-schema|tools\.js/) || hasText(activity, /contextbridge|ipcmain|ipcrenderer|handle\(|invoke\(|executeToolForProject/)],
    ['toolPermission', 'AI 工具权限边界', hasText(activity, /run_command|read_file|write_file|delete_file|resolvepath|exec\(|spawn\(|shell|命令执行|文件访问|白名单|权限/)],
    ['renderer', '前端渲染入口和状态', hasPath(activity, /frontend|renderer|index\.html|app\.js|chat-renderer/) || hasText(activity, /activeproject|projectid|dom|addEventListener|render/)],
    ['projectIsolation', '项目/窗口/上下文隔离', hasPath(activity, /projects|context|storage|window|config/) || hasText(activity, /projectid|projectpath|activeproject|contextmanager|storagepath|windowid|多窗口|项目隔离/)],
    ['secretsConfig', '密钥/API 配置', hasPath(activity, /\.env|config|model/) || hasText(activity, /apikey|api[_-]?key|token|secret|password|密码|smtp|modelconfig|authorization/)],
    ['externalApi', '外部 API 超时和限流', hasText(activity, /fetch\(|axios|chat\/completions|abortcontroller|timeout|超时|rate limit|限流|apiurl|lxweb|browser_search|browser_fetch/)],
    ['fileIo', '文件读写和路径边界', hasText(activity, /fs\.|readfilesync|writefilesync|unlink|rm\(|path\.join|resolvepath|upload|read_file|write_file|delete_file|目录穿越|路径/)],
    ['startupDeploy', '启动/部署/打包脚本', hasPath(activity, /\.bat$|\.ps1$|docker|deploy|builder|forge/) || hasText(activity, /electron-builder|npm run|pnpm|docker|deploy|打包|启动|构建/)],
    ['gitState', 'Git 跟踪状态', activity.hasGitEvidence],
    ['verification', '语法/类型/构建验证', activity.verifyCount > 0]
  ]

  const genericCategories = [
    ['inventory', '项目文件清单', activity.hasInventoryEvidence],
    ['packageConfig', '包管理和入口配置', hasPath(activity, /package\.json$|pyproject|requirements|cargo\.toml|go\.mod|pom\.xml/) || hasText(activity, /package\.json|dependencies|scripts|requirements|pyproject/)],
    ['secretsConfig', '密钥/Token/环境变量', hasPath(activity, /\.env|config/) || hasText(activity, /apikey|api[_-]?key|token|secret|password|密码|smtp|authorization/)],
    ['auth', '登录认证/会话', hasText(activity, /auth|login|register|session|cookie|jwt|oauth|管理员|admin|用户/)],
    ['authorization', '用户越权/数据归属', hasText(activity, /owner|user_id|userid|belongs|permission|role|delete|update|patch|put|越权|无权|权限/)],
    ['fileIo', '上传/路径读写', hasText(activity, /upload|file|path\.join|readfile|writefile|fs\.|目录穿越|路径/)],
    ['dataStorage', '数据库/存储', hasText(activity, /sql|sqlite|prisma|database|db\.|redis|storage|数据库|存储/)],
    ['externalApi', '外部 API 超时和限流', hasText(activity, /fetch\(|axios|timeout|abortcontroller|rate limit|限流|api/)],
    ['startupDeploy', '部署/构建脚本', hasPath(activity, /docker|deploy|\.ps1$|\.sh$|\.bat$/) || hasText(activity, /docker|deploy|nginx|systemd|build|构建|部署/)],
    ['gitState', 'Git 跟踪状态', activity.hasGitEvidence],
    ['verification', '语法/类型/构建验证', activity.verifyCount > 0]
  ]

  const categories = activity.isElectronProject ? electronCategories : genericCategories
  const found = categories.filter(([, , ok]) => !!ok)
  const missing = categories.filter(([, , ok]) => !ok).map(([, label]) => label)
  return {
    categories,
    found,
    missing,
    foundCount: found.length,
    requiredCount: categories.length
  }
}

function makeCheckpoint(key, status, content) {
  return { key, status, content }
}

function getChangeTaskCheckpoint(taskType, userMessage, activity) {
  const failureCheckpoint = getFailureCheckpoint(taskType, activity)
  if (failureCheckpoint) return failureCheckpoint

  const diagnosticStage = diagnosticWorkflow.getDiagnosticStage({ userMessage, activity })
  if (diagnosticStage) {
    return diagnosticWorkflow.buildDiagnosticCheckpoint(diagnosticStage, taskType)
  }

  const wantsChange = /(修|修复|改|修改|实现|增加|新增|开发|做一个|优化|美化|重构|拆分|删除|移除|接入|支持|调整)/i.test(String(userMessage || ''))
  const taskName = {
    bugfix: '修 BUG',
    feature: '新增功能',
    refactor: '重构',
    ui: 'UI 修改'
  }[taskType] || '代码任务'
  const matrix = getChangeEvidenceMatrix(taskType, activity)
  const workflow = getChangeWorkflowState(taskType, userMessage, activity)

  if (activity.writeCount > 0 && !workflow.hasCompensatingPreWriteAudit) {
    const changed = activity.changedPaths.slice(-4).join('、') || '刚改过的文件'
    return makeCheckpoint(
      `${taskType}:post-write-compensating-audit:${activity.writeCount}:${activity.preWriteReadCount}:${activity.postWriteReadCount}:${activity.postWriteDiffCount}`,
      '已经动了代码，但缺少写前上下文，先补救式自审。',
      `执行要求：检测到已经修改 ${changed}，但写前没有足够读取目标上下文。下一步必须调用工具回读改动文件、相关入口/调用方/相邻实现或查看 git diff，确认这次修改没有破坏原有功能；如发现破坏，必须继续修。不能直接总结。`
    )
  }

  if (activity.writeCount > 0 && !workflow.hasSufficientPreWriteContext) {
    return makeCheckpoint(
      `${taskType}:post-write-impact-audit:${activity.writeCount}:${activity.preWriteReadCount}:${activity.preWriteSearchCount}:${activity.postWriteReviewCount}`,
      '改动影响面还没查实，继续补调用链。',
      '执行要求：写代码任务不能只看一个文件或只凭最终文字自证。下一步必须调用工具查看调用链、入口、状态/数据流、同类实现或相邻模块，确认新增/修改不会导致顾头不顾尾、重复实现或旧功能损坏。'
    )
  }

  if (activity.writeCount === 0) {
    if (!workflow.hasTargetContext) {
      return makeCheckpoint(
        `${taskType}:target-context:${activity.readCount}:${activity.commandCount}`,
        '先看要改的位置，不能凭空写代码。',
        `执行要求：这是${taskName}。增加、修改或修复前，必须先调用工具读取目标区域相关代码，弄清这段代码现在做什么；不要直接新建一套实现，也不要直接总结。`
      )
    }

    if (workflow.isWebUiTask && workflow.enforceImmersiveWeb && !workflow.hasWebAssetInventory) {
      return makeCheckpoint(
        `${taskType}:web-asset-inventory:${activity.readCount}:${matrix.foundCount}`,
        '先盘点网页可用资产。',
        '执行要求：这是网页前端 UI 设计任务。下一步必须先调用工具确认可用资产：logo、图片、视频、音乐、字体、品牌色、已有素材和可生成素材；不要直接写 hero、卡片或渐变背景。'
      )
    }

    if (workflow.referencesTargetWebsite && !workflow.hasWebsiteRuntimeResearch) {
      return makeCheckpoint(
        `${taskType}:website-runtime-research:${activity.readCount}:${matrix.foundCount}`,
        '先研究目标网站的运行态结构。',
        '执行要求：用户要求参考/借鉴/复刻目标网站。下一步必须优先调用 research_website_runtime，采集多滚动位置 DOM、CSS token、公开 JS/CSS、资源、动画、Canvas/WebGL 和技术栈信号；不要先用 capture_screenshot 或静态图片分析网站设计。'
      )
    }

    if (workflow.isWebUiTask && workflow.enforceImmersiveWeb && !workflow.hasWebSceneConcept) {
      return makeCheckpoint(
        `${taskType}:web-scene-concept:${activity.readCount}:${matrix.foundCount}`,
        '先确定沉浸式场景和主视觉。',
        '执行要求：网页 UI 默认采用沉浸式场景优先。下一步必须明确主视觉对象、场景空间、镜头、灯光、材质、粒子/媒体层和内容如何进入场景；不能套普通 hero + 卡片模板。'
      )
    }

    if (workflow.isWebUiTask && workflow.enforceImmersiveWeb && !workflow.hasWebLocalDependencies) {
      return makeCheckpoint(
        `${taskType}:web-local-dependencies:${activity.readCount}:${matrix.foundCount}`,
        '先确认可用创意依赖。',
        '执行要求：本项目已有 three、gsap、sharp、@resvg/resvg-js、@ffmpeg-installer/ffmpeg、esbuild。下一步必须基于这些内嵌依赖规划 Three.js/WebGL、GSAP 过渡、SVG 转图、视频/音频处理或构建方式；不要误判为必须重新下载，也不要回到纯静态模板。'
      )
    }

    if (workflow.isWebUiTask && workflow.enforceImmersiveWeb && !workflow.hasWebSceneStateMachine) {
      return makeCheckpoint(
        `${taskType}:web-scene-state-machine:${activity.readCount}:${matrix.foundCount}`,
        '先设计滚动和交互状态机。',
        '执行要求：沉浸式网页必须有状态机。下一步必须确认滚动进度、鼠标/触摸/键盘、进入/退出场景如何改变镜头、粒子、媒体层、灯光或音频；不能只是静态视觉页面。'
      )
    }

    if (workflow.isWebUiTask && !workflow.hasWebTimePolicy) {
      return makeCheckpoint(
        `${taskType}:web-time-policy:${activity.readCount}:${matrix.foundCount}`,
        '先确认网页中的年份和时间规则。',
        '执行要求：网页设计不能凭模型记忆硬写旧年份。涉及版权年份优先使用 new Date().getFullYear() 动态生成；需要固定日期时必须来自用户输入或可验证来源。当前日期是 2026-05-31，不要写 2024/2025 当当前年份。'
      )
    }

    if (taskType === 'feature' && workflow.isEmptyProject && !workflow.isWebUiTask && !workflow.hasModulePlan) {
      return makeCheckpoint(
        `${taskType}:empty-project-architecture:${activity.readCount}:${activity.commandCount}`,
        '这是空白项目，先搭模块化骨架。',
        '执行要求：当前像是空白新项目。下一步必须先设计并创建最小可运行的模块化骨架：前端/后端或主进程/渲染进程、共享模块、样式/设计系统、配置和入口脚本。不要直接把所有代码堆进一个文件。'
      )
    }

    if (workflow.looksLikePreviousChangeBug && !workflow.hasPriorChangeTrace) {
      return makeCheckpoint(
        `${taskType}:prior-change-trace:${activity.readCount}:${activity.commandCount}`,
        '先反推上一轮改动，再修 BUG。',
        '执行要求：这是修 BUG，而且像是之前改动引起或未修干净。下一步必须调用工具查看最近改动、相关文件、错误指向位置或 diff，从上一步改动往回反推根因；不要只猜，也不要直接另起一套代码。'
      )
    }

    if (!workflow.hasImpactContext) {
      return makeCheckpoint(
        `${taskType}:impact-context:${activity.readCount}:${matrix.foundCount}`,
        '还没看清影响面，先补调用链和相邻实现。',
        `执行要求：这是${taskName}。下一步必须继续调用工具查看目标代码前后文、调用方/被调用方、入口、状态/数据流或同类实现，判断新增或修改会影响什么；不要在影响面不清楚时动代码。`
      )
    }

    if (!workflow.hasExistingCodeBasis) {
      return makeCheckpoint(
        `${taskType}:existing-basis:${activity.readCount}:${matrix.foundCount}`,
        '先基于已有代码接入，避免重复实现残留。',
        `执行要求：这是${taskName}。下一步必须找现有入口、模块、状态或同类功能，优先在已有代码上修改；不要为了新增/修改功能而创建一套并行的重复实现。`
      )
    }

    if (taskType === 'feature' && !workflow.hasModulePlan) {
      return makeCheckpoint(
        `${taskType}:module-plan:${activity.readCount}:${matrix.foundCount}`,
        '先明确模块边界，再开发。',
        '执行要求：新增功能必须走模块化设计。下一步必须确认功能属于哪个模块、前端组件/状态/API 调用和后端服务/路由/存储分别放在哪里；已有项目要接入现有结构，空白项目要先建清晰骨架。单个代码文件不得超过 2000 行，index/app/main/server/router 这类入口文件只做导入、装配、路由注册和启动接线。'
      )
    }

    if (taskType === 'feature' && !workflow.hasContractPlan) {
      return makeCheckpoint(
        `${taskType}:contract-plan:${activity.readCount}:${matrix.foundCount}`,
        '先确认前后端契约，避免摆设功能。',
        '执行要求：这个功能需要确认闭环：前端事件调用什么接口/IPC/服务，参数是什么，返回值是什么，失败时如何显示。下一步必须调用工具查看或创建对应契约；不要只写前端按钮和页面。'
      )
    }

    if (wantsChange) {
      const action = taskType === 'bugfix'
        ? '先用一句话确认根因，再做最小修复。'
        : taskType === 'refactor'
          ? '先确认旧入口/导出/调用方，再小步迁移。'
          : taskType === 'ui'
            ? '先确认交互入口和样式体系，再做最小 UI 改动。'
            : '先确认接入点、状态归属和数据流，再实现。'
      return makeCheckpoint(
        `${taskType}:implement`,
        '证据够进入实现阶段，下一步做最小正确改动。',
        `执行要求：进入实现阶段。${action}请继续调用 write_file/edit_file 等工具完成实际修改；不要停在解释或方案。`
      )
    }
  }

  if (activity.writeCount > 0 && !workflow.hasPostWriteReview) {
    const changed = activity.changedPaths.slice(-4).join('、') || '刚改过的文件'
    return makeCheckpoint(
      `${taskType}:post-write-review:${activity.writeCount}:${activity.postWriteReadCount}:${activity.postWriteDiffCount}`,
      '代码已改，下一步必须复查改动文件。',
      `执行要求：进入改后自审阶段，已经改动 ${changed}。下一步必须调用工具复读改过的文件或查看 git diff，确认实际落盘内容、导入导出、事件绑定、状态来源、空引用和重复入口；不能只靠总结文字。`
    )
  }

  if (activity.writeCount > 0 && !workflow.hasPostWriteImpactEvidence) {
    return makeCheckpoint(
      `${taskType}:post-write-regression:${activity.writeCount}:${activity.postWriteReviewCount}`,
      '代码已改，还缺原有行为回归检查。',
      '执行要求：新增或修改完成后必须确认旧功能没有被破坏。下一步调用工具复查相关入口、调用方、旧场景/旧按钮/旧接口/旧状态流或 git diff，重点找漏导出、漏绑定、重复入口、空引用和原有行为消失。发现问题继续修，不能直接总结。'
    )
  }

  if (workflow.isWebUiTask && activity.writeCount > 0 && workflow.isWebSceneChange && !workflow.hasWebSceneRegressionEvidence) {
    return makeCheckpoint(
      `${taskType}:post-write-web-scene-regression:${activity.writeCount}:${activity.postWriteReviewCount}`,
      '网页场景已改，必须确认原有主视觉没被破坏。',
      '执行要求：检测到网页/Three/WebGL/场景相关改动。下一步必须调用工具复查 scene/app/index/styles/assets 等相关代码，确认首屏、logo、canvas/WebGL、滚动进度、粒子/场景状态仍存在；不能只新增第二场景却让第一场景消失。'
    )
  }

  if (taskType === 'feature' && activity.writeCount > 0 && !workflow.hasContractPlan) {
    return makeCheckpoint(
      `${taskType}:post-write-contract:${activity.writeCount}:${activity.readCount}`,
      '功能已写，但还要确认前后端真的接通。',
      '执行要求：已经修改代码，但还缺前后端/API/IPC/服务契约证据。下一步必须复查前端入口是否调用了真实后端逻辑，后端是否有对应处理和返回值；不能留下摆设性功能。'
    )
  }

  if (taskType === 'feature' && activity.writeCount > 0 && !workflow.hasRealLogic) {
    return makeCheckpoint(
      `${taskType}:post-write-real-logic:${activity.writeCount}:${activity.readCount}`,
      '功能已写，但还要确认不是只有界面。',
      '执行要求：新增功能不能只有前端展示。下一步必须调用工具复查真实业务逻辑、状态更新、持久化/文件/数据库/后端处理或 IPC 调用是否存在；如果功能本来纯前端，也要确认真实状态变化和用户反馈。'
    )
  }

  if (taskType === 'feature' && activity.writeCount > 0 && !workflow.hasUiStates) {
    return makeCheckpoint(
      `${taskType}:post-write-ui-states:${activity.writeCount}:${activity.readCount}`,
      '功能已写，补齐加载、空态和错误态。',
      '执行要求：新增功能需要覆盖真实使用状态。下一步必须复查或补齐加载态、空态、错误态、禁用态或失败提示，避免只写成功路径。'
    )
  }

  if (activity.writeCount > 0 && workflow.hasOversizedCodeFiles) {
    const oversized = workflow.oversizedCodeFiles
      .slice(0, 4)
      .map(item => `${item.path}(${item.lineCount}行)`)
      .join('、')
    return makeCheckpoint(
      `${taskType}:post-write-file-size-oversized:${activity.writeCount}:${activity.readCount}`,
      '代码文件超过 2000 行，必须先拆分模块。',
      `执行要求：检测到改动后的代码文件超过 2000 行：${oversized}。下一步必须把大文件拆成模块/组件/服务/路由/状态/工具文件，并通过 import/export/require 或项目既有引用声明接回入口；入口文件只保留组合和接线逻辑，拆完后再复查行数。`
    )
  }

  if (activity.writeCount > 0 && workflow.hasLargeEntryCodeFiles) {
    const largeEntries = workflow.largeCodeFiles
      .filter(item => item.isEntry)
      .slice(0, 4)
      .map(item => `${item.path}(${item.lineCount}行)`)
      .join('、')
    return makeCheckpoint(
      `${taskType}:post-write-entry-file-size:${activity.writeCount}:${activity.readCount}`,
      '入口文件已经偏大，继续拆成装配层。',
      `执行要求：检测到入口类代码文件已经偏大：${largeEntries}。下一步必须确认它只做导入、导出、路由注册、依赖装配和启动接线；如果里面包含大量业务实现、组件细节、状态细节或工具函数，必须拆到模块/组件/服务/状态/工具文件，再由入口引用。`
    )
  }

  if (activity.writeCount > 0 && activity.hasChangedCodeFiles && !workflow.hasFileSizeBoundary) {
    const changed = activity.changedCodePaths.slice(-4).join('、') || '改动过的代码文件'
    return makeCheckpoint(
      `${taskType}:post-write-file-size-check:${activity.writeCount}:${activity.readCount}`,
      '代码已改，继续检查文件行数和模块边界。',
      `执行要求：已经改动 ${changed}。下一步必须复查这些代码文件的行数和职责边界：单个代码文件不得超过 2000 行；入口/index/app/main/server/router 文件不能承载大量业务实现，只做装配和引用声明。若文件接近或超过 2000 行，必须拆分模块后再继续。`
    )
  }

  if (workflow.isWebUiTask && activity.writeCount > 0 && workflow.hasEmojiIconInWrittenContent) {
    return makeCheckpoint(
      `${taskType}:post-write-web-emoji-icons:${activity.writeCount}:${activity.readCount}`,
      '网页里还残留 emoji 图标。',
      '执行要求：网页 UI 不能把 emoji 当正式图标、卡片图标、列表图标、导航图标、状态图标或视觉资产。下一步必须把 emoji 替换为内联 SVG、图标库 SVG、Canvas/WebGL 绘制元素，或自绘 SVG 后用 @resvg/resvg-js + sharp 转出的图片。'
    )
  }

  if (workflow.isWebUiTask && workflow.enforceImmersiveWeb && activity.writeCount > 0 && !workflow.hasImmersiveWebQuality) {
    const smells = workflow.immersiveWebTemplateSmells.slice(0, 4).join('、') || '普通模板痕迹'
    return makeCheckpoint(
      `${taskType}:post-write-web-immersive-quality:${activity.writeCount}:${activity.readCount}:${activity.changedPaths.length}`,
      '沉浸式网页质量门禁未通过。',
      `执行要求：当前输出仍像普通网页模板披了一层 WebGL 外衣，问题包括：${smells}。下一步必须重做结构：拆出 scene.js/app.js/styles.css/assets，让内容成为场景节点、轨迹、媒体平面或数据光带；首屏必须是可交互主视觉对象；不能用 hero + feature-card + 玻璃/渐变/随机几何体冒充沉浸式体验。`
    )
  }

  if (workflow.isWebUiTask && workflow.enforceImmersiveWeb && activity.writeCount > 0 && !workflow.hasWebSceneConcept) {
    return makeCheckpoint(
      `${taskType}:post-write-web-scene:${activity.writeCount}:${activity.readCount}`,
      '网页已写，但还要确认沉浸式场景成立。',
      '执行要求：网页 UI 不能只有普通 hero、抽象渐变、玻璃卡片和空洞文案。下一步必须复查主视觉对象、场景、镜头、灯光、粒子/媒体层或 WebGL/Canvas 效果是否真实接入。'
    )
  }

  if (workflow.isWebUiTask && workflow.enforceImmersiveWeb && activity.writeCount > 0 && !workflow.hasWebSceneStateMachine) {
    return makeCheckpoint(
      `${taskType}:post-write-web-state-machine:${activity.writeCount}:${activity.readCount}`,
      '网页已写，但还要确认交互状态机。',
      '执行要求：沉浸式网页不能只是静态画面。下一步必须复查滚动、鼠标/触摸/键盘、进入/退出场景是否会改变镜头、粒子、媒体层、灯光、声音或 UI 状态。'
    )
  }

  if (workflow.isWebUiTask && activity.writeCount > 0 && !workflow.hasWebPreviewFallback) {
    return makeCheckpoint(
      `${taskType}:post-write-web-preview-fallback:${activity.writeCount}:${activity.readCount}`,
      '网页已写，还要确认本地预览和降级。',
      '执行要求：下一步必须确认 index.html 直接打开是否能看到基础效果；如果必须 dev server 才能加载模块或资源，要说明原因和启动方式。同时补齐 WebGL 不可用、低性能或 reduced-motion 降级。'
    )
  }

  if (workflow.isWebUiTask && workflow.enforceImmersiveWeb && activity.writeCount > 0 && !workflow.hasWebInteractionAudio) {
    return makeCheckpoint(
      `${taskType}:post-write-web-audio:${activity.writeCount}:${activity.readCount}`,
      '网页已写，还要确认交互音频策略。',
      '执行要求：浏览器通常禁止自动播放。下一步必须复查音乐/音效是否在首次点击、滚动、触摸或键盘后启动，并确认场景进入/退出时的音量、滤波、混响或低频变化有明确逻辑。'
    )
  }

  if (workflow.isWebUiTask && activity.writeCount > 0 && !workflow.hasWebResponsive) {
    return makeCheckpoint(
      `${taskType}:post-write-web-responsive:${activity.writeCount}:${activity.readCount}`,
      '网页已写，继续检查响应式。',
      '执行要求：网页 UI 写完后必须复查桌面、窄屏、移动端布局证据：断点、网格/flex、文字溢出、按钮挤压、首屏高度和区块遮挡。不能只适配一个桌面宽度。'
    )
  }

  if (workflow.isWebUiTask && activity.writeCount > 0 && !workflow.hasWebTimePolicy) {
    return makeCheckpoint(
      `${taskType}:post-write-web-time:${activity.writeCount}:${activity.readCount}`,
      '网页已写，继续复查年份和时间。',
      '执行要求：复查网页内所有年份、版权、活动日期和时间表达。版权年份优先动态生成；不能把训练截止年份或旧年份写成当前年份。当前日期是 2026-05-31。'
    )
  }

  if (activity.writeCount > 0 && !workflow.hasImpactContext) {
    return makeCheckpoint(
      `${taskType}:post-write-impact:${activity.writeCount}:${activity.readCount}`,
      '代码已改，但还要复查影响面。',
      '执行要求：已经修改代码。下一步必须调用工具复查与改动相关的入口、调用链、状态/数据流、导出或事件绑定，确认没有顾头不顾尾、重复实现、漏接入口或破坏项目隔离；不能直接总结。'
    )
  }

  if (activity.writeCount > 0 && !workflow.hasPostWriteVerification) {
    return makeCheckpoint(
      `${taskType}:verify:${activity.writeCount}:${activity.postWriteVerifyCount}`,
      '代码已复查，下一步必须跑可用验证。',
      '执行要求：进入验证阶段。请继续调用工具运行和本次改动相关、且发生在改动之后的语法、类型、测试、构建或启动检查；如果环境限制导致跑不了，必须给出具体命令和失败原因。'
    )
  }

  // L1：UI/网页改动在静态验证之后，要求合格 runtime_verify（passed|failed）
  try {
    const runtimeGate = require('./runtime-verification-gate')
    const syntheticWrites = (activity.changedPaths || []).map(filePath => ({
      name: 'write_file',
      args: { path: filePath },
      result: { success: true }
    }))
    const trigger = runtimeGate.evaluateL1Trigger({
      taskType,
      userMessage,
      toolCalls: syntheticWrites,
      featureFlags: { runtime_verify: true, runtime_verify_hard_gate: true },
      isWebUiTask: workflow.isWebUiTask === true
    })
    const needsRuntime =
      trigger.required === true ||
      workflow.isWebUiTask === true ||
      taskType === 'ui'
    if (needsRuntime && activity.writeCount > 0 && !activity.hasPostWriteRuntimeVerification) {
      return makeCheckpoint(
        `${taskType}:runtime-verify:${activity.writeCount}:${activity.postWriteRuntimeVerifyCount || 0}`,
        '静态检查已完成，下一步必须做运行时验证。',
        '执行要求：进入运行态验证。请启动开发实例后调用 runtime_verify（可先省略 interaction 做 live+F12；进程存活/code_verify 不算通过）。verification_status 为 passed 或 failed 后才可收尾；incomplete 时按 next_action 修 target/runtime_id，禁止原样空转。'
      )
    }
  } catch (_) { /* gate module optional during partial boots */ }

  return null
}

function getReviewCheckpoint(activity) {
  const failureCheckpoint = getFailureCheckpoint('review', activity)
  if (failureCheckpoint) return failureCheckpoint

  const workflow = getReviewWorkflowState(activity)

  if (!workflow.hasProjectPurpose) {
    return makeCheckpoint(
      `review:project-purpose:${activity.readCount}:${activity.commandCount}`,
      '先弄清这个项目是做什么的。',
      '执行要求：这是代码审查。第一步还没完成：必须先调用工具查看项目结构、入口、README、package/配置或启动脚本，弄清项目类型、主要功能和运行方式；不要直接总结。'
    )
  }

  if (!workflow.hasArchitectureView) {
    return makeCheckpoint(
      `review:architecture:${activity.readCount}:${workflow.distinctEvidenceCount}`,
      '继续看架构和模块关系。',
      '执行要求：代码审查第二步还没完成：必须继续调用工具查看主要目录、入口文件、模块边界、前后端/主渲染进程/API/数据层关系。目标是判断架构大概怎么样，不是固定检查某几个文件；不要直接总结。'
    )
  }

  if (!workflow.hasCodeCorrectnessScan) {
    return makeCheckpoint(
      `review:code-correctness:${activity.readCount}:${workflow.correctnessTrackCount}`,
      '先查代码本身会不会错。',
      '执行要求：代码审查主线是代码正确性。下一步必须调用工具检查语法/类型/运行错误、导入导出、入口接线、调用链、空值边界、配置依赖或明显异常线索；不要先把审查带偏成只看安全和部署。'
    )
  }

  if (!workflow.hasCoreCallChainReview) {
    return makeCheckpoint(
      `review:core-call-chain:${activity.readCount}:${workflow.distinctEvidenceCount}`,
      '继续追核心代码和调用链。',
      '执行要求：代码正确性主线还没走完。下一步必须继续调用工具查看核心入口、关键业务流、调用方/被调用方、事件/API/IPC 接线，确认代码是真接上了，不是只看配置或目录就总结。'
    )
  }

  if (!workflow.hasStateDataFlowReview) {
    return makeCheckpoint(
      `review:state-data-flow:${activity.readCount}:${workflow.correctnessTrackCount}`,
      '继续看状态、数据和配置怎么流动。',
      '执行要求：代码正确性审查不能只看函数名。下一步必须调用工具查看状态来源、数据读写、上下文/项目 ID、配置加载、缓存/持久化或模型/会话数据流，确认不会出现状态串线、配置不生效、读写错位置或上下文错用。'
    )
  }

  if (!workflow.hasRuntimeErrorPathReview) {
    return makeCheckpoint(
      `review:error-path:${activity.readCount}:${activity.commandCount}`,
      '继续查错误处理和异常路径。',
      '执行要求：代码正确性审查还缺异常路径。下一步必须调用搜索、读取或可用检查命令，查 try/catch、超时、失败返回、空值、TODO/FIXME、构建/依赖问题和明显运行错误；不要只看正常流程。'
    )
  }

  if (!workflow.hasMaintainabilityReview) {
    return makeCheckpoint(
      `review:maintainability:${activity.readCount}:${workflow.correctnessTrackCount}`,
      '继续查重复实现和残留代码。',
      '执行要求：代码正确性审查还要看项目是否有多套实现、旧入口残留、导出兼容问题、循环依赖、同类逻辑重复或明显不可维护点。下一步必须调用工具围绕这些线索搜索或读取源码；不要只盯安全点。'
    )
  }

  if (!workflow.hasRiskFocus) {
    return makeCheckpoint(
      `review:risk-branches:${activity.readCount}:${workflow.riskTrackCount}`,
      '代码主线看完后，再查安全和线上风险分支。',
      '执行要求：现在进入审查分支。下一步根据项目类型调用工具查看安全与线上风险：密钥/凭证、认证/会话、权限/数据归属、上传/路径、部署/启动、外部接口/超时限流、数据库/数据串写、Electron/Agent 工具权限边界。它们是分支，不要覆盖代码正确性主线。'
    )
  }

  if (!workflow.hasOwnershipDeepDive) {
    return makeCheckpoint(
      `review:ownership:${activity.readCount}:${workflow.riskTrackCount}`,
      '继续深挖权限和数据归属。',
      '执行要求：项目里已经出现用户、认证、管理员、资源修改或数据接口线索。下一步必须调用工具抽查“用户 A 能不能改到/看到用户 B 的数据”、普通用户能不能访问管理接口、关联对象是否属于同一资源。没有这一步不要下权限结论。'
    )
  }

  if (!workflow.hasLayeredReview) {
    const missingLayers = workflow.layerCoverage.missing.slice(0, 5).join('、')
    return makeCheckpoint(
      `review:layered:${workflow.layerCoverageCount}:${activity.readCount}`,
      '审查层次还不够，继续分层抽查。',
      `执行要求：所有项目代码审查一律按大型项目原则处理，不能只查几个风险点就结束。当前分层覆盖还不够，缺少 ${missingLayers || '关键层次'}。下一步必须继续调用工具分层抽查入口/启动、架构模块、核心业务流、数据/状态/持久化、边界/权限、错误处理、运行部署、测试验证或可维护性。`
    )
  }

  if (!workflow.hasSourceConfirmation) {
    const trackText = [
      ...workflow.correctnessTracks.map(item => item.label),
      ...workflow.riskTracks.map(item => item.label)
    ].slice(0, 4).join('、') || '已发现问题'
    return makeCheckpoint(
      `review:source-confirm:${activity.readCount}:${workflow.correctnessTrackCount}:${workflow.riskTrackCount}`,
      '把问题逐个用源码证据确认。',
      `执行要求：已经看到 ${trackText} 等问题线索。下一步必须调用工具回到源码逐个确认具体文件、位置、调用路径或命令输出；不要把猜测写成结论，也不要把本地存在误说成已提交。`
    )
  }

  if (!workflow.hasIssueVerification || !workflow.hasEnoughDepth) {
    return makeCheckpoint(
      `review:verify:${activity.readCount}:${workflow.distinctEvidenceCount}:${activity.verifyCount}:${activity.commandCount}`,
      '还需要验证问题是否真实存在。',
      '执行要求：代码审查最后还缺验证。必须对发现的问题做一次验证：能跑构建/类型/语法/测试就跑；遇到 PowerShell 策略、权限或超时时，要换可行命令或说明这是环境限制；也可以用 git/status/搜索/反向读取确认问题确实存在。不要在未验证时下最终结论。'
    )
  }

  return null
}

function getOpsCheckpoint(activity) {
  const failureCheckpoint = getFailureCheckpoint('ops', activity)
  if (failureCheckpoint) return failureCheckpoint

  if (activity.readCount === 0) {
    return makeCheckpoint(
      `ops:read-config:${activity.readCount}`,
      '运行排错先读配置和脚本。',
      '还没到排错结论阶段：请先调用工具读取 package.json、启动脚本、构建脚本、配置文件或错误日志，再判断是环境问题还是项目问题。'
    )
  }

  if (activity.commandCount === 0) {
    return makeCheckpoint(
      `ops:run-command:${activity.commandCount}:${activity.readCount}`,
      '需要执行命令验证真实错误。',
      '运行排错必须有命令证据。请调用工具运行相关启动、构建、检查或诊断命令；如果不能运行，说明具体限制。'
    )
  }

  return null
}

function getEngineeringWorkflowCheckpoint(options = {}) {
  const taskType = options.taskType
  if (!PROGRAMMING_TASKS.has(taskType)) return null

  const toolCalls = Array.isArray(options.toolCallsRecord) ? options.toolCallsRecord : []
  if (toolCalls.length === 0) return null

  const activity = analyzeToolCalls(toolCalls)
  if (taskType === 'review') return getReviewCheckpoint(activity)
  if (CHANGE_TASKS.has(taskType)) return getChangeTaskCheckpoint(taskType, options.userMessage || '', activity)
  if (taskType === 'ops') return getOpsCheckpoint(activity)
  return null
}

module.exports = {
  getEngineeringWorkflowCheckpoint,
  analyzeToolCalls,
  getReviewEvidenceMatrix,
  getChangeEvidenceMatrix,
  getDistinctReviewEvidenceCount,
  getImmersiveWebTemplateSmells,
  hasImmersiveWebModuleSplitEvidence,
  hasSingleFileImmersiveImplementation,
  isStaticVerificationCall,
  isRuntimeVerificationCall,
  isQualifiedRuntimeVerificationCall,
  isVerificationCall
}
