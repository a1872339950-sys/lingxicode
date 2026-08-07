/**
 * AI对话处理模块
 * 负责系统提示生成、消息处理、工具调用循环
 *
 * 多会话窗口仅支持用户手动对话，不向主聊天 AI 暴露任务指派能力。
 *
 * 上下文管理优化：
 * - 大部分工具结果按类型压缩；命令输出保留完整结果
 * - 发送给API时按工具类型控制上下文体积
 */

const fs = require('fs')
const path = require('path')
const config = require('./config')
const projects = require('./projects')
const { executeToolForProject } = require('./tools')
const { parseToolArgs, buildToolArgsParseErrorResult } = require('./tool-args-parser')
const { createToolFailureRecoveryTracker } = require('./tool-failure-recovery')
const { buildContextPayload } = require('../tools/context-builder')
const changeSessions = require('./change-sessions')
const {
  buildTaskFocusPrompt,
  isWebUiTask,
  detectTaskType
} = require('./agent-runtime')
const { buildPrimaryRolePrompt } = require('./agents/agent-router')
const { hasCapability, normalizeModel } = require('./model-capabilities')
const { analyzeImagesWithVisionModel, buildImageMetadataNote, prepareImages, probeImageDimensions } = require('./vision-relay')
const artifacts = require('./artifacts')
const taskRuns = require('./task-runs')
const contextCompression = require('./context-compression')
const requestHistoryWindow = require('./request-history-window')
const { resolveModelContextLimit, buildContextBudget } = require('./model-context-policy')
const taskLedger = require('./task-ledger')
const workerModel = require('./worker-model')
const memoryOrganizer = require('./memory-organizer')
const designStyleMemory = require('./design-style-memory')
const storageConfig = require('./storage-config')
const { hasApiKey } = require('./api-key')
const observability = require('./observability')
const careReminder = require('./care-reminder')
const backgroundReplySound = require('./background-reply-sound')
const aiOperationMemos = require('./ai-operation-memos')
const { stableJsonStringify, observePromptStability } = require('./prompt-stability')
const {
  estimateModelCost: estimateModelCostForUsage,
  getModelCostProfile: getModelCostProfileForUsage
} = require('./model-cost-estimator')
const cloudTokenUsage = require('./cloud-token-usage')
const {
  isMiniMaxM3Model,
  expectsNativeReasoningStream,
  getApiFormat,
  buildApiEndpoint,
  buildApiHeaders,
  buildApiFetchOptions,
  shouldAvoidPersistentModelConnection,
  isPreResponseSocketCloseError,
  retryPreResponseSocketClose,
  buildModelRequestBody,
  formatModelTransportError,
  createAnthropicStreamState,
  parseGeminiStreamPayload,
  parseModelStreamEvent,
  extractModelResponseContent,
  stopLocalOllamaModelAfterReply
} = require('./model-api-adapter')
const interjectRunner = require('./interject-runner')
const { normalizePromptCacheUsage, getPromptCacheCapability, calculatePromptCacheRate } = require('./prompt-cache-capabilities')
const systemPromptBuilder = require('./system-prompt-builder')
const {
  getExecutionModeDesc,
  getExecutionModeRules,
  setUserLanguage,
  getUserLanguage,
  buildBehaviorStylePrompt,
  detectWorkbenchMentions,
  getDisabledWorkbenchTools,
  formatPromptCacheTimeBucket,
  getRuntimeContextPrompt,
  getSystemPrompt,
  WORKBENCH_TOOL_NAMES
} = systemPromptBuilder
const { buildTurnWorkflowPrompt } = require('./workflow-playbooks')
const { hasInternalInstructionLeak, stripInternalInstructionLeaks } = require('./internal-instruction-filter')
const progressNarration = require('./progress-narration')
const { sendThinkingEvent } = require('./thinking-event-sender')

const CONTEXT_STATUS_CACHE_TTL_MS = 30000
// 默认关闭高频日志，避免长跑时主进程日志拖慢事件循环。需要时设 LINGXI_AI_CHAT_VERBOSE=1
const AI_CHAT_VERBOSE = process.env.LINGXI_AI_CHAT_VERBOSE === '1'
function chatVerboseLog(...args) {
  if (AI_CHAT_VERBOSE) console.log(...args)
}

function estimateChars(value) {
  if (value === null || value === undefined) return 0
  if (typeof value === 'string') return value.length
  try {
    return stableJsonStringify(value).length
  } catch {
    try {
      return JSON.stringify(value).length
    } catch {
      return String(value).length
    }
  }
}

function countRequestTools(body = {}) {
  if (Array.isArray(body.tools)) return body.tools.length
  if (Array.isArray(body.tool_config?.tools)) return body.tool_config.tools.length
  return 0
}

function buildRequestBodyProfile(body = {}) {
  const requestChars = estimateChars(body)
  const toolChars = estimateChars(body.tools || body.tool_config?.tools || [])
  const requestMessages = Array.isArray(body.messages) ? body.messages : []
  const reasoningReplayMessages = requestMessages.filter(item => typeof item?.reasoning_content === 'string' && item.reasoning_content).length
  const reasoningReplayChars = requestMessages.reduce((sum, item) => sum + String(item?.reasoning_content || '').length, 0)
  return {
    requestChars,
    requestEstTokens: Math.ceil(requestChars / 4),
    toolCount: countRequestTools(body),
    toolSchemaChars: toolChars,
    toolSchemaEstTokens: Math.ceil(toolChars / 4),
    reasoningReplayMessages,
    reasoningReplayChars
  }
}

function appendGuidanceToLatestUserMessage(messages = [], guidance = '') {
  const text = String(guidance || '').trim()
  if (!text || !Array.isArray(messages)) return false
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message?.role !== 'user') continue
    const suffix = `\n\n【本轮动态执行上下文】\n${text}`
    if (Array.isArray(message.content)) {
      message.content = [...message.content, { type: 'text', text: suffix.trim() }]
    } else {
      message.content = `${String(message.content || '')}${suffix}`
    }
    return true
  }
  return false
}

function waitForCacheSettle(delayMs = 0, signal = null) {
  const waitMs = Math.max(0, Number(delayMs) || 0)
  if (!waitMs) return Promise.resolve()
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener?.('abort', onAbort)
      resolve()
    }, waitMs)
    const onAbort = () => {
      clearTimeout(timer)
      reject(createAbortError())
    }
    if (signal?.aborted) return onAbort()
    signal?.addEventListener?.('abort', onAbort, { once: true })
  })
}

function getDeepSeekCacheSettleTargetMs(modelConfig = {}, cacheRate = null) {
  const configuredBase = Number(modelConfig.deepSeekCacheSettleMs ?? modelConfig.deepseek_cache_settle_ms)
  const configuredLowHit = Number(modelConfig.deepSeekLowHitCacheSettleMs ?? modelConfig.deepseek_low_hit_cache_settle_ms)
  const baseMs = Number.isFinite(configuredBase)
    ? Math.max(0, Math.min(15000, configuredBase))
    : 3000
  if (!baseMs) return 0

  const lowHitMs = Number.isFinite(configuredLowHit)
    ? Math.max(baseMs, Math.min(15000, configuredLowHit))
    : Math.max(baseMs, 5000)
  const rate = Number(cacheRate)
  return Number.isFinite(rate) && rate < 90 ? lowHitMs : baseMs
}

function shouldBridgeDeepSeekMultiToolBatch(modelConfig = {}, endpoint = '', modelId = '', toolCalls = []) {
  const explicit = modelConfig.deepSeekMultiToolCacheBridge ?? modelConfig.deepseek_multi_tool_cache_bridge
  if (explicit === false || explicit === 'false' || explicit === 'off' || explicit === 'disabled') return false
  return getPromptCacheCapability(modelConfig, endpoint, modelId).id === 'deepseek' &&
    Array.isArray(toolCalls) && toolCalls.length > 1
}

function clipDeepSeekToolBatchItem(value, maxChars = 12000) {
  const text = JSON.stringify(value)
  if (text.length <= maxChars) return text
  const tailChars = 2400
  const headChars = maxChars - tailChars - 80
  return `${text.slice(0, headChars)}\n...[tool result clipped ${text.length - headChars - tailChars} chars]...\n${text.slice(-tailChars)}`
}

function buildDeepSeekMultiToolCacheBridge(items = []) {
  const batch = Array.isArray(items) ? items.filter(Boolean) : []
  // hidden: never show in chat UI / history panel as user text.
  // _deepseekBridge: keep in model context for DeepSeek prefix cache continuity.
  return [
    {
      role: 'assistant',
      content: `Lingxi executed ${batch.length} requested tools in parallel and consolidated their results for continuation.`,
      hidden: true,
      _deepseekBridge: true
    },
    {
      role: 'user',
      content: [
        '[Lingxi internal parallel tool batch results]',
        'These are actual tool results from the current task. Continue from them without repeating completed calls.',
        ...batch.map((item, index) => clipDeepSeekToolBatchItem({ index, ...item }))
      ].join('\n'),
      hidden: true,
      _deepseekBridge: true
    }
  ]
}

// 提问信号识别：低信号/纯寒暄/能力问询类消息不需要加载项目上下文。
const NAVIGATION_NEEDED_RE = /查看|看看|检查|定位|搜索|查找|找出|修复|改进|优化|实现|增加|接入|清理|删除|重构|构建|打包|测试|验证|运行|启动|报错|错误|失败|崩溃|卡死|白屏|项目|代码|文件|函数|调用链|工具|前端|UI|界面|设置|模型|diff|history|render|bug|error|crash|build|test|verify|code|file|tool|frontend|setting|model/i
const LOW_SIGNAL_RE = /^(你好|您好|谢谢|感谢|继续|好的|嗯|行|可以|为什么|是什么|区别|大白话说|你觉得呢|是真的吗|对吗|上下文容量是多少|官方.*上下文|how much|what is|why)$/i

function shouldSkipNavigation(userMessage = '') {
  const text = String(userMessage || '').trim()
  if (!text) return true
  if (NAVIGATION_NEEDED_RE.test(text)) return false
  if (text.length <= 24 && LOW_SIGNAL_RE.test(text)) return true
  if (text.length <= 100 && /上下文容量|官方.*上下文|轮和条.*区别|条和轮.*区别/.test(text)) return true
  if (text.length <= 80 && /^(为什么|是什么|区别|怎么理解|大白话|你觉得|是真的吗|对吗)/.test(text)) return true
  return false
}

function shouldUseProjectContext(userMessage = '') {
  if (shouldSkipNavigation(userMessage)) return false
  return true
}

// 会话级上下文加载粘性：一旦某会话加载过设计风格/历史项目上下文，后续请求保持加载，
// 避免关键词变化导致前缀波动、prefix cache 失效。
const sessionContextStickyFlags = new WeakMap()

function getStickyFlags(instance) {
  if (!instance || typeof instance !== 'object') return null
  let flags = sessionContextStickyFlags.get(instance)
  if (!flags) {
    flags = { designStyle: false, historicalProject: false }
    sessionContextStickyFlags.set(instance, flags)
  }
  return flags
}

function shouldUseDesignStyleContext(userMessage = '', instance = null) {
  const text = String(userMessage || '')
  const matched = /UI|界面|前端|网页|网站|页面|样式|设计|美化|布局|主题|暗色|浅色|颜色|视觉|复刻|资源中心|资产|缩略图|website|frontend|design|style|layout|theme|visual/i.test(text)
  // 粘性：一旦本会话命中过设计风格关键词，后续保持加载
  const sticky = getStickyFlags(instance)
  if (sticky) {
    if (matched) sticky.designStyle = true
    return sticky.designStyle
  }
  return matched
}

function shouldProbeStreamUsageByDefault(modelConfig = {}, endpoint = '', modelId = '', apiFormat = '') {
  const explicit = modelConfig.streamUsage ?? modelConfig.stream_usage ?? modelConfig.includeUsage ?? modelConfig.include_usage
  if (explicit === false || explicit === 'false' || explicit === 'off' || explicit === 'disabled') return false
  if (explicit === true || explicit === 'true' || explicit === 'on' || explicit === 'enabled') return true
  if (apiFormat && apiFormat !== 'openai') return true
  const capability = getPromptCacheCapability(modelConfig, endpoint, modelId)
  return [
    'openai',
    'deepseek',
    'qwen',
    'glm',
    'volcengine',
    'moonshot',
    'minimax',
    'mimo',
    'anthropic',
    'tencent-tokenhub',
    'apikey-fun',
    'xai'
  ].includes(capability.id)
}

const contextStatusCache = new Map()

function getContextStatusCacheKey(projectId, modelName, instance) {
  const history = Array.isArray(instance?.messagesHistory) ? instance.messagesHistory : []
  const last = history[history.length - 1] || null
  const lastStamp = [
    history.length,
    last?.role || '',
    last?.time || last?.completedAt || last?.createdAt || '',
    String(last?.content || last?.displayContent || '').length
  ].join(':')
  return `${projectId || ''}|${modelName || ''}|${lastStamp}`
}

function clearContextStatusCache(projectId) {
  if (!projectId) {
    contextStatusCache.clear()
    return
  }
  const prefix = `${projectId}|`
  for (const key of contextStatusCache.keys()) {
    if (key.startsWith(prefix)) contextStatusCache.delete(key)
  }
}

const {
  isUserRequestRestatement,
  isNonProgressNarration,
  normalizeProgressStatus,
  normalizeProgressNarration,
  summarizeProgressText,
  createProgressStatusParser,
  createProgressNarrationTracker,
  createToolArgumentProgressTracker,
  isProcessOnlyContinuationText
} = progressNarration
const {
  sanitizeFinalContent,
  normalizeCacheUsage,
  PLAN_CONTROL_TOOLS,
  parseToolArgsSafe,
  isProgressToolCall,
  getProgressToolStatus,
  emitProgressToolStatus,
  isInternalUiOnlyToolName
} = require('./chat-helpers')

// 拆分到 chat/ 目录的子模块
const {
  createAbortError, createApiTimeoutError, isApiTimeoutError, isAbortError,
  throwIfAborted, stripHtmlErrorBody, formatApiHttpError, clampTimeoutMs,
  getApiTimeouts, formatTimeoutSeconds, createApiTimeoutWatchdog
} = require('./chat/api-error-timeout')
const { runBackgroundTask } = require('./chat/background-tasks')
const {
  isToolStatusOnlyFinalContent, isReviewOnlyFinalContent, actionLabel,
  fileBaseName, buildChangeSessionFinalFallback, ensureUsableFinalContent
} = require('./chat/change-session-fallback')
const {
  normalizeReferences, clipReferenceText, buildReferencedContextBlock, sanitizeUserVisibleContent
} = require('./chat/reference-context')
const { pruneExpiredImageAttachments, normalizeFullHistoryForModel } = require('./chat/history-normalizer')
const {
  getToolTargetText, hasTouchedPreviousChangeDomain,
  summarizePostEditDiagnostics
} = require('./chat/diagnostics-summarizer')
const {
  summarizeToolResult, summarizeToolResultForHistory, summarizeToolResultForModel
} = require('./chat/tool-result-summarizer')
const { buildCurrentModelCapabilityPrompt } = require('./chat/model-capability-prompt')
const {
  normalizeToolPath, getToolTargetPath, isCrossFileSearchCall, isWriteLikeToolCall,
  isLargeEntryRead, isEntryOrAssemblyPath, getReadContentSample, hasAssemblyLayerSignals,
  getRecentEntryAssemblyDrift, getRecentRepeatedReadTarget, isFailedPreciseEdit,
  getRecentPreciseEditFailure, extractSearchLiteral, getRecentFragmentedSearch,
  buildExplorationStrategyNudge
} = require('./chat/exploration-strategy')
const {
  safeJsonStringify, summarizeToolArgsForRunLog, readFiniteNumber
} = require('./chat/json-utils')
const {
  getLedgerContextMaxItems, shouldIncludeHistoricalProjectContext, createAiSafetySnapshot
} = require('./chat/intent-safety')
const {
  NAVIGATION_FIRST_TOOLS, MANUAL_LOCATION_TOOLS, WRITE_LIKE_TOOLS,
  PRECISE_MODIFICATION_TOOLS, EDIT_GROUNDING_TOOLS,
  hasWriteToolCall, getToolCallName, parseToolCallArgs, hasExplicitSingleFileTarget,
  shouldRerouteManualLocationFirst,
  buildNavigationFirstRerouteInstruction,
  isSourceLikePath, collectToolArgPaths, getModificationTargetPaths,
  hasPriorEditGrounding, hasDirectUserProvidedEdit, shouldReroutePrematureModification,
  shouldSplitLargeToolBatch, shouldSplitToolSectionBatch,
  shouldRerouteToolStatusMismatch
} = require('./chat/modification-reroute')
const {
  uniqueRouteList, normalizeRoutePathValue, collectRoutePaths, getChangeSessionFiles,
  isSearchCommandText, isVerificationCommandText, buildTaskRouteRecord
} = require('./chat/task-route-tracker')
const {
  isExplicitBlenderPathIntent, hasBlenderToolPath, hasNoRelayIntent, hasNoBlenderIntent,
  get3DWorkflowRoute
} = require('./chat/workflow-3d-router')
const {
  getToolCallNames, hasSuccessfulToolCall, getLastSuccessfulToolResult, getLastToolCall,
  extractImagePathsFromImageData, isLocalImageReferencePath, extractGeneratedImagePath
} = require('./chat/tool-call-helpers')
const { registerFileIpcHandlers } = require('./chat/file-ipc-handlers')
const runtimeVerificationGate = require('./runtime-verification-gate')
const featureSettings = require('./feature-settings')

const unsupportedStreamUsageKeys = new Set()
const POST_WRITE_VERIFY_TOOLS = new Set(['check_syntax', 'check_project_syntax', 'post_change_verify', 'code_verify', 'dev_workflow'])
const POST_WRITE_VERIFY_EXEMPT_TOOLS = new Set(['create_directory', 'render_svg_asset', 'file_manage', 'media_process'])
const PROGRESS_PANEL_TOOLS = new Set(['complete_step'])

function createStreamPayloadError(json = {}) {
  const payload = json?.error || (json?.type === 'error' ? json.error : null)
  if (!payload) return null
  const code = String(payload.code || payload.type || json.code || 'MODEL_STREAM_ERROR').trim()
  const message = String(payload.message || payload.error || json.message || '模型上游返回流式错误').trim()
  const error = new Error(code ? `模型上游错误 (${code}): ${message}` : `模型上游错误: ${message}`)
  error.name = 'ModelStreamPayloadError'
  error.code = code || 'MODEL_STREAM_ERROR'
  error.isModelStreamPayloadError = true
  return error
}

function isProjectReviewIntent(message = '') {
  return /(审查项目|项目审查|扫描项目|整体审查|全项目|工程审查|代码库|仓库|repo|架构|模块化|安全审查|敏感信息|测试覆盖|自动测试)/i.test(String(message || ''))
}

function isBusinessToolName(name = '') {
  return name && !isInternalUiOnlyToolName(name) && !PROGRESS_PANEL_TOOLS.has(String(name || ''))
}

function hasPostWriteVerification(toolCalls = []) {
  let sawWrite = false
  for (const call of Array.isArray(toolCalls) ? toolCalls : []) {
    const name = String(call?.name || '')
    if (!sawWrite && hasWriteToolCall([call])) {
      sawWrite = true
      if (hasSuccessfulInlinePostEditDiagnostics(call)) return true
      continue
    }
    if (!sawWrite) continue
    if (hasWriteToolCall([call]) && hasSuccessfulInlinePostEditDiagnostics(call)) return true
    if (POST_WRITE_VERIFY_TOOLS.has(name)) {
      if (name === 'code_verify') {
        const action = String(call?.args?.action || call?.result?._tool_route?.action || '').toLowerCase()
        if (!action || /file|project|changes|verify|syntax/.test(action)) return true
        continue
      }
      if (name !== 'dev_workflow') return true
      const mode = String(call?.args?.mode || call?.result?.mode || '').toLowerCase()
      if (!mode || /verify|syntax|review|triage/.test(mode)) return true
    }
    if (name === 'shell_run' || name === 'run_command') {
      const command = String(call?.args?.command || call?.args?.cmd || '')
      if (/\bnode\s+--check\b|\bnpm\s+(?:run\s+)?(?:test|build|check|verify)\b|\btsc\b|\beslint\b|\bvitest\b|\bjest\b|\bpytest\b|\bpython\s+-m\s+py_compile\b/i.test(command)) return true
    }
  }
  return false
}

function hasSuccessfulInlinePostEditDiagnostics(call = {}) {
  const diagnostics = call?.result?.postEditDiagnostics
  if (!diagnostics || typeof diagnostics !== 'object') return false
  if (diagnostics.ok !== true) return false
  if (call?.result?.requires_fix === true || call?.result?.requires_runtime_review === true) return false
  if (Number(diagnostics.failed_count || 0) > 0) return false
  if (Array.isArray(diagnostics.failed_files) && diagnostics.failed_files.length > 0) return false
  if (Array.isArray(diagnostics.unknown_files) && diagnostics.unknown_files.length > 0) return false
  return true
}

function hasWriteToolNeedingPostVerification(toolCalls = []) {
  return (Array.isArray(toolCalls) ? toolCalls : []).some(call => {
    if (!hasWriteToolCall([call])) return false
    const name = String(call?.name || '')
    return !POST_WRITE_VERIFY_EXEMPT_TOOLS.has(name)
  })
}

function buildPostWriteVerifyNudge(toolCalls = []) {
  const changedPaths = getModificationTargetPaths(toolCalls)
  return [
    '改后复查要求：本轮已经写入或修改了文件，但还没有看到改后验证。',
    changedPaths.length ? `只验证这些改动目标：${changedPaths.slice(0, 8).join('、')}。` : '',
    '请只调用一次最窄的 code_verify（action=file/project/changes）或 dev_workflow mode=verify。',
    '不要重新理解需求、不要扩大搜索、不要重读无关文件；验证失败时才 file_read 错误行或 code_inspect action=git_diff。'
  ].filter(Boolean).join('\n')
}

function getRuntimeGateFeatureFlags() {
  try {
    return {
      runtime_verify: featureSettings.isFeatureEnabled('runtime_verify'),
      runtime_verify_hard_gate: featureSettings.isFeatureEnabled('runtime_verify_hard_gate')
    }
  } catch {
    return { runtime_verify: true, runtime_verify_hard_gate: true }
  }
}

function evaluateRuntimeGateForChat({
  taskType = '',
  userMessage = '',
  toolCalls = [],
  recoveryAttempts = 0
} = {}) {
  let webUi = false
  let resolvedTaskType = cleanTaskType(taskType)
  try {
    webUi = isWebUiTask(userMessage || '', '')
  } catch {
    webUi = false
  }
  if (!resolvedTaskType) {
    try {
      resolvedTaskType = detectTaskType(userMessage || '') || ''
    } catch {
      resolvedTaskType = ''
    }
  }
  return runtimeVerificationGate.classifyRuntimeGate({
    taskType: resolvedTaskType,
    userMessage,
    toolCalls,
    featureFlags: getRuntimeGateFeatureFlags(),
    isWebUiTask: webUi,
    recoveryAttempts
  })
}

function cleanTaskType(value = '') {
  return String(value == null ? '' : value).trim().toLowerCase()
}

// 工具失败时生成针对性修复引导，写入 tool 结果的 next_action 字段
// 避免模型盲目重试同一失败工具或直接放弃
function buildToolFailureGuidance(toolName, result) {
  if (!result || result.success !== false) return ''
  if (result.next_action) return String(result.next_action)
  const errorType = result.error_type || ''
  const errorMsg = String(result.error || result.message || '')

  // 超时类：引导改用 shell_run 缩小范围
  if (errorType === 'command_timeout' || /timeout|timed out|ETIMEDOUT/i.test(errorMsg)) {
    return `${toolName} 超时。若是长任务（dev/build/test），用 shell_run 缩小命令范围或拆分步骤；不要原样重试。`
  }
  // 命令不存在：引导改用项目内搜索工具
  if (errorType === 'command_not_available' || /not recognized|command not found|ENOENT|不是内部或外部命令/i.test(errorMsg)) {
    return `${toolName} 命令不存在。改用 code_inspect action=grep/locate 或 file_search action=glob 完成事实定位，不要重试该命令。`
  }
  // 路径无效：引导先定位
  if (errorType === 'not_a_file' || errorType === 'not_found' || /no such file|not a file|不存在|无法找到/i.test(errorMsg)) {
    return `${toolName} 路径无效。先用 code_inspect action=locate 或 file_search action=glob 定位正确路径，再重试。`
  }
  // 精确编辑匹配失败：引导先读取当前内容
  if (['edit_file', 'text_edit', 'apply_patch', 'json_edit'].includes(toolName) ||
      /old_content|not\s+found|no\s+match|does\s+not\s+contain|未找到|找不到|不包含|没有找到/i.test(errorMsg)) {
    return `${toolName} 匹配失败。先用 file_read action=one 读取目标文件当前内容（按行段），用最新内容重新构造 old_content，再重试。不要用记忆中的旧片段。`
  }
  // 验证工具错误：引导改用正确验证工具
  if (errorType === 'wrong_verification_tool') {
    return result.recommended_tool
      ? `改用 ${result.recommended_tool.name} 验证这些文件。`
      : '改用 code_verify action=file 按文件扩展名路由验证。'
  }
  // 权限拒绝：引导说明而非重试
  if (errorType === 'permission_denied' || /permission|denied|EACCES|权限/i.test(errorMsg)) {
    return `${toolName} 权限不足。不要重试；在最终回复里说明权限阻塞，建议用户手动授权或调整路径。`
  }
  // 用户拒绝：不重试
  if (result.status === 'user_rejected') {
    return `${toolName} 被用户拒绝。不要重试；基于已有结果继续处理或收尾。`
  }
  // 通用：建议换策略而非重试
  if (errorMsg) {
    return `${toolName} 失败：${errorMsg.slice(0, 200)}。请分析错误原因后调整参数或换用替代工具，不要原样重试。`
  }
  return ''
}

function isOperationMemoBackfillMessage(message = '') {
  return String(message || '').includes('【AI操作备忘录补录任务】')
}

/**
 * 注册AI对话 IPC handlers
 */
function registerChatIPC(ipcMain) {
  // 发送消息（支持多项目并行，支持图片）
  ipcMain.on('send-message', async (event, requestId, projectId, message, modelConfig, history = [], skillContent = null, executionMode = 'auto', agentMode = false, imageDataList = [], displayContent = null, hidden = false, visionRelayConfig = null, references = [], directiveBadges = []) => {
    chatVerboseLog('[AIChat] 收到消息请求, projectId:', projectId, 'message:', message?.substring(0, 50), 'skill:', skillContent ? '有' : '无', 'mode:', executionMode, 'agentMode:', agentMode, 'images:', imageDataList.length)
    
    // 后端防重入：检查是否已有正在运行的会话
    const existingController = config.getAbortController(projectId)
    if (existingController && !existingController.signal.aborted) {
      console.warn('[AIChat] ⚠️ 防重入：项目已有运行中的会话，先中断旧的再启动新的, projectId:', projectId)
      try {
        existingController.abort(createAbortError('被新的会话请求替换'))
      } catch { /* AbortController 已中止 */ }
    }
    
    // 详细输出技能内容（便于调试）
    if (skillContent) {
      chatVerboseLog('[AIChat] 技能内容预览 (前500字符):')
      chatVerboseLog(skillContent.substring(0, 500))
      chatVerboseLog('[AIChat] 技能总长度:', skillContent.length, '字符')
    }

    // 获取项目实例
    const instance = await projects.ensureProjectBranchSession(projectId) || projects.getProjectInstance(projectId)
    const webContents = projects.getWebContentsForProject(projectId)
    if (!instance) {
      console.log('[AIChat] 项目不存在:', projectId)
      webContents?.send('ai-status', { projectId, status: 'error' })
      webContents?.send('message-reply', { projectId, error: `项目不存在 (ID: ${projectId})，请重新选择项目`, done: true })
      event.reply('send-message-response', { requestId, projectId, error: '项目不存在' })
      return
    }

    const { contextManager, projectPath } = instance

    // 使用 modelId 发送API请求（如果没有 modelId 则使用 modelName）
    const effectiveModelId = modelConfig?.modelId || modelConfig?.modelName
    const hasModelCredential = hasApiKey(modelConfig?.apiKey)
    if (!modelConfig?.apiUrl || !hasModelCredential || !effectiveModelId) {
      webContents?.send('ai-status', { projectId, status: 'error' })
      const errorMessage = '请先配置API'
      webContents?.send('message-reply', { projectId, error: errorMessage, done: true })
      event.reply('send-message-response', { requestId, projectId, error: errorMessage })
      return
    }

    // 异步处理，不阻塞其他项目的请求。必须兜底捕获，否则 handleSendMessage
    // 在内部 try 之前抛错时，前端会一直停在“正在思考中”。
    runTrackedSendMessage(event, requestId, projectId, message, modelConfig, history, skillContent, executionMode, agentMode, instance, webContents, contextManager, projectPath, effectiveModelId, imageDataList, displayContent, hidden, visionRelayConfig, references, directiveBadges)
      .catch(error => {
        const messageText = error?.message || String(error || '未知错误')
        console.error('[AIChat] ⚠️ handleSendMessage outer catch 诊断:',
          '\n  err.name:', error?.name,
          '\n  err.message:', error?.message,
          '\n  err.code:', error?.code,
          '\n  stack:', error?.stack?.split('\n').slice(0, 5).join('\n    ')
        )
        const timedOut = isApiTimeoutError(error)
        const aborted = !timedOut && isAbortError(error)
        if (aborted) {
          webContents?.send('ai-status', { projectId, status: 'interrupted' })
          event.reply('send-message-response', { requestId, projectId, success: true, interrupted: true })
          return
        }
        webContents?.send('ai-status', { projectId, status: 'error', error: messageText })
        webContents?.send('message-reply', {
          projectId,
          error: messageText,
          done: true,
          completedAt: Date.now()
        })
        event.reply('send-message-response', { requestId, projectId, error: messageText })
      })
  })

  // 中断AI操作
  ipcMain.on('interrupt-ai', (event, projectId) => {
    console.log('[AIChat] interrupt-ai IPC 收到, projectId:', projectId, '来源:', event.sender?.getURL?.() || 'unknown')
    const controller = config.getAbortController(projectId)
    const webContents = projects.getWebContentsForProject(projectId)
    if (controller) {
      if (!controller.signal.aborted) {
        controller.abort(createAbortError('用户已中断本轮 AI 操作'))
      }
      webContents?.send('ai-status', { projectId, status: 'interrupted' })
      console.log('[AIChat] AI操作已中断:', projectId)
    }
  })

  // 文件相关 IPC handlers（选择文件、保存粘贴图片、删除临时文件）
  registerFileIpcHandlers(ipcMain)

  // 上下文管理 IPC
  // ===== 上下文状态（修复：返回压缩后的实际大小） =====
  ipcMain.handle('context-status', (event, projectId, modelName = null) => {
    try {
      const instance = projects.getProjectInstance(projectId)
      if (!instance) {
        return { error: '项目不存在' }
      }

      const cacheKey = getContextStatusCacheKey(projectId, modelName, instance)
      const cached = contextStatusCache.get(cacheKey)
      if (cached && Date.now() - cached.createdAt < CONTEXT_STATUS_CACHE_TTL_MS) {
        return { ...cached.status, cached: true }
      }

      // 增量 token 估算：避免每次遍历整个 messagesHistory
      const messagesHistory = instance.messagesHistory || []
      const contextManager = instance.contextManager

      const estimatedTokens = projects.estimateTokensIncremental(instance)
      const limit = resolveModelContextLimit(modelName)
      const contextRatio = Math.min(estimatedTokens / limit, 1)

      // 记忆系统状态（完整历史统计）
      const memoryStatus = contextManager.memory.getStatus()
      const summaryStatus = contextManager.summary.getStatus()

      const status = {
        // ===== 实际上下文（发送给API的大小） =====
        estimatedTokens: Math.round(estimatedTokens),
        contextRatio: contextRatio,
        modelLimit: limit,
        historyLength: messagesHistory.length,

        // ===== 对话轮数统计 =====
        tapeLength: messagesHistory.filter(m => m.role === 'user').length,  // 用户消息数 = 对话轮数
        indexSize: memoryStatus.indexSize,  // 关键词数

        // ===== 摘要状态 =====
        summaryCount: summaryStatus.completedCount + summaryStatus.inProgressCount + summaryStatus.pendingCount,

        // ===== 压缩策略说明 =====
        compressionStrategy: '按模型真实窗口和请求 Token 重量自动整理，完整历史保留',

        // 项目路径
        projectPath: instance.projectPath,
        storagePath: instance.storagePath
      }
      contextStatusCache.set(cacheKey, { createdAt: Date.now(), status })
      return status
    } catch (error) {
      console.error('[AIChat] context-status failed:', error)
      return {
        estimatedTokens: 0,
        contextRatio: 0,
        modelLimit: resolveModelContextLimit(modelName),
        historyLength: 0,
        tapeLength: 0,
        indexSize: 0,
        summaryCount: 0,
        compressionStrategy: '上下文状态读取失败，已降级显示',
        error: error.message
      }
    }
  })

  ipcMain.handle('context-clear', (event, projectId) => {
    const instance = projects.getProjectInstance(projectId)
    if (!instance) {
      return { error: '项目不存在' }
    }
    instance.contextManager.clear()
    instance.messagesHistory = []  // 同时清空后端维护的完整消息历史
    instance._chatHistoryDirty = true
    instance._cachedTokenCount = 0
    instance._lastTokenCalcLength = 0
    clearContextStatusCache(projectId)
    contextCompression.clearSummaries(instance).catch(e => console.warn('[AIChat] clearSummaries failed:', e.message))
    if (projects.saveProjectChatHistoryDeferred) projects.saveProjectChatHistoryDeferred(projectId)
    else projects.saveProjectChatHistory(projectId)
    return { success: true }
  })

  ipcMain.handle('context-compression-stack', async (event, projectId, modelDescriptor = null) => {
    try {
      const instance = projects.getProjectInstance(projectId)
      if (!instance) return { success: false, error: '项目不存在' }

      const history = Array.isArray(instance.messagesHistory) ? instance.messagesHistory : []
      const descriptor = modelDescriptor && typeof modelDescriptor === 'object'
        ? modelDescriptor
        : { modelName: String(modelDescriptor || '') }
      const lastAuthoredMessage = [...history].reverse().find(message => (
        message?.role === 'assistant' && (message.modelName || message.modelId || message.modelCacheIdentity)
      )) || null
      const modelName = String(
        descriptor.modelName || descriptor.displayName || descriptor.modelId ||
        instance.currentModelName || lastAuthoredMessage?.modelName || lastAuthoredMessage?.modelId || ''
      ).trim()
      const modelId = String(descriptor.modelId || descriptor.model || modelName).trim()
      const configuredLimit = descriptor.contextWindow || descriptor.contextLength || descriptor.maxContextTokens || 0
      const budget = buildContextBudget(modelName || modelId, configuredLimit)
      const apiEndpoint = descriptor.apiUrl ? buildApiEndpoint(descriptor) : ''
      const apiFormat = getApiFormat(descriptor, apiEndpoint)
      const modelCacheIdentity = requestHistoryWindow.buildModelCacheIdentity({
        provider: descriptor.provider || descriptor.platform || descriptor.source,
        apiEndpoint,
        apiFormat,
        modelId,
        modelName
      })
      const projectionOptions = {
        collapseAll: false,
        currentIdentity: modelCacheIdentity,
        currentAliases: [modelId, modelName, descriptor.modelId, descriptor.modelName]
      }
      const rawProjection = requestHistoryWindow.projectCompletedTurnsForModel(history, projectionOptions)
      const modelScopedProjectionNeeded = rawProjection.collapsedTurns > 0
      const rawVisibleTokens = history
        .filter(requestHistoryWindow.isVisibleMessage)
        .reduce((sum, message) => sum + requestHistoryWindow.estimateMessageTokens(message), 0)
      const modelProjectedTokens = rawProjection.history
        .reduce((sum, message) => sum + requestHistoryWindow.estimateMessageTokens(message), 0)

      const stack = await contextCompression.getUiCompressionStack(instance, history, {
        triggerTokens: Math.floor(budget.inputBudgetTokens * 0.75),
        retainTokens: Math.floor(budget.inputBudgetTokens * 0.35)
      })

      let epochContext = null
      let requestWindow = null
      try {
        epochContext = await contextCompression.buildCacheEpochContext(instance, {
          summariesPerEpoch: contextCompression.DEFAULT_CACHE_EPOCH_SUMMARIES,
          maxItems: contextCompression.DEFAULT_CONTEXT_SUMMARY_ITEMS
        })
        const windowOptions = {
          coveredMessageId: epochContext.coveredMessageId,
          coveredMessageIndex: epochContext.coveredMessageIndex,
          summaryBlock: epochContext.summaryBlock,
          tokenBudget: budget.inputBudgetTokens,
          projectionOptions
        }
        requestWindow = modelScopedProjectionNeeded
          ? requestHistoryWindow.buildModelSwitchHistory(history, Math.max(0, history.length - 1), windowOptions)
          : requestHistoryWindow.buildCompressionEpochHistory(history, Math.max(0, history.length - 1), windowOptions)
      } catch (error) {
        requestWindow = modelScopedProjectionNeeded
          ? requestHistoryWindow.buildModelSwitchHistory(history, Math.max(0, history.length - 1), {
              tokenBudget: budget.inputBudgetTokens,
              projectionOptions
            })
          : requestHistoryWindow.buildRequestHistoryWindow(history, Math.max(0, history.length - 1), {
              tokenBudget: budget.inputBudgetTokens
            })
      }

      const visibleRequestHistory = Array.isArray(requestWindow?.history) ? requestWindow.history : []
      const estimatedInputTokens = visibleRequestHistory
        .reduce((sum, message) => sum + requestHistoryWindow.estimateMessageTokens(message), 0)
      let latestTurnStart = -1
      visibleRequestHistory.forEach((message, index) => {
        if (requestHistoryWindow.isUserTurnMessage(message) && !message.interject) latestTurnStart = index
      })
      const latestTurnTokens = latestTurnStart >= 0
        ? visibleRequestHistory.slice(latestTurnStart)
          .reduce((sum, message) => sum + requestHistoryWindow.estimateMessageTokens(message), 0)
        : 0
      const usageRatio = budget.inputBudgetTokens > 0 ? estimatedInputTokens / budget.inputBudgetTokens : 0
      // 与真正发送路径保持一致：切换模型后，如果“用户需求 + 最终正文”投影已经足够小，
      // 指示器不能继续拿旧模型的完整工具链假报即将压缩。
      const effectivePendingTokens = modelScopedProjectionNeeded
        ? modelProjectedTokens
        : Math.max(0, Number(stack.pendingTokens) || 0)
      const compressionRatio = stack.triggerTokens > 0
        ? Math.min(1, Math.max(0, effectivePendingTokens / stack.triggerTokens))
        : 0
      const status = usageRatio >= 0.9
        ? 'urgent'
        : usageRatio >= 0.75
          ? 'compressing'
          : usageRatio >= 0.6
            ? 'watch'
            : 'safe'
      const summariesPerEpoch = Math.max(1, Number(contextCompression.DEFAULT_CACHE_EPOCH_SUMMARIES) || 1)
      const compressionEpoch = stack.summaryCount > 0
        ? Math.floor((stack.summaryCount - 1) / summariesPerEpoch) + 1
        : 1

      return {
        ...stack,
        pendingTokens: effectivePendingTokens,
        modelName: modelName || modelId || '默认模型',
        modelId,
        maxContextTokens: budget.maxContextTokens,
        inputBudgetTokens: budget.inputBudgetTokens,
        hardInputTokens: budget.hardInputTokens,
        outputReserveTokens: budget.outputReserveTokens,
        safetyTokens: budget.safetyTokens,
        estimatedInputTokens,
        latestTurnTokens,
        rawVisibleTokens,
        modelProjectedTokens,
        crossModelSavedTokens: Math.max(0, rawVisibleTokens - modelProjectedTokens),
        epochSavedTokens: Math.max(0, rawVisibleTokens - estimatedInputTokens),
        collapsedForeignTurns: rawProjection.collapsedTurns || 0,
        removedToolMessages: rawProjection.removedToolMessages || 0,
        removedReasoningChars: rawProjection.removedReasoningChars || 0,
        modelScopedProjectionNeeded,
        usageRatio,
        compressionRatio,
        status,
        compressionEpoch,
        summariesPerEpoch
      }
    } catch (error) {
      console.error('[AIChat] context-compression-stack failed:', error)
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle('execute-relay-task', async (event, projectId, userMessage, modelConfig) => {
    return {
      success: false,
      disabled: true,
      status: 'disabled',
      error: '接力工作流已停用。请使用普通聊天/Agent 工具流程继续。'
    }
  })

  ipcMain.handle('get-relay-status', async (event, projectId) => {
    return { status: 'disabled', disabled: true }
  })

  ipcMain.on('interrupt-relay', (event, projectId) => {
    console.log('[AIChat] 接力工作流已停用，忽略中断:', projectId)
  })
}

/**
 * Repair persisted chat history so every assistant tool_call is immediately
 * followed by its tool result. API providers reject histories with orphan or
 * misplaced tool messages.
 */
function repairToolCallAdjacency(historyList, options = {}) {
  if (!Array.isArray(historyList) || historyList.length === 0) return false
  const tailOnly = options.tailOnly === true
  let scanStart = 0
  if (tailOnly) {
    scanStart = historyList.length
    while (scanStart > 0 && historyList[scanStart - 1]?.role === 'tool') scanStart--
    if (scanStart > 0 && historyList[scanStart - 1]?.role === 'assistant' && Array.isArray(historyList[scanStart - 1].tool_calls)) {
      scanStart--
    } else {
      return false
    }
  }
  const toolResultsById = new Map()
  for (let i = scanStart; i < historyList.length; i++) {
    const msg = historyList[i]
    if (msg?.role !== 'tool' || !msg.tool_call_id) continue
    const id = String(msg.tool_call_id)
    if (!toolResultsById.has(id)) toolResultsById.set(id, msg)
  }

  const repaired = tailOnly ? historyList.slice(0, scanStart) : []
  let changed = false
  const syntheticError = options.error || '工具调用未正常返回，已写入合成失败结果以修复历史结构'

  for (let i = scanStart; i < historyList.length; i += 1) {
    const msg = historyList[i]
    if (msg?.role !== 'assistant' || !Array.isArray(msg.tool_calls) || msg.tool_calls.length === 0) {
      if (msg?.role === 'tool') {
        changed = true
        continue
      }
      repaired.push(msg)
      continue
    }

    repaired.push(msg)
    const expectedIds = msg.tool_calls
      .map(tc => String(tc?.id || ''))
      .filter(Boolean)

    for (const id of expectedIds) {
      const existingToolResult = toolResultsById.get(id)
      if (existingToolResult) {
        repaired.push(existingToolResult)
      } else {
        changed = true
        repaired.push({
          role: 'tool',
          tool_call_id: id,
          content: JSON.stringify({ success: false, error: syntheticError, aborted: !!options.aborted, synthetic: true })
        })
      }
    }
  }

  if (repaired.length !== historyList.length) changed = true
  for (let i = scanStart; !changed && i < historyList.length; i += 1) {
    if (historyList[i] !== repaired[i]) changed = true
  }
  if (!changed) return false
  historyList.splice(scanStart, historyList.length - scanStart, ...repaired.slice(scanStart))
  return true
}

/**
 * 消息处理核心逻辑（异步）
 */
async function runTrackedSendMessage(...args) {
  const projectId = args[2]
  const sourceInstance = args[9]
  // 一轮请求固定绑定它开始时的 chat-session。新建/切换同项目会话会修改全局实例，
  // 但不能把正在运行的 A 会话历史、路径和上下文一起切到 B 会话。
  const instance = sourceInstance
    ? Object.assign(Object.create(Object.getPrototypeOf(sourceInstance)), sourceInstance, {
      messagesHistory: sourceInstance.messagesHistory
    })
    : null
  if (instance) args[9] = instance
  if (instance) instance._activeChatRequestCount = Number(instance._activeChatRequestCount || 0) + 1
  try {
    return await handleSendMessage(...args)
  } finally {
    if (instance) {
      instance._activeChatRequestCount = Math.max(0, Number(instance._activeChatRequestCount || 1) - 1)
      if (instance._activeChatRequestCount === 0) {
        await projects.saveProjectChatHistory(instance).catch(error => {
          console.warn('[AIChat] final history cache compaction save failed:', error.message)
        })
      }
    }
  }
}

async function handleSendMessage(event, requestId, projectId, message, modelConfig, history, skillContent, executionMode, agentMode, instance, webContents, contextManager, projectPath, effectiveModelId, imageDataList = [], displayContent = null, hidden = false, visionRelayConfig = null, references = [], directiveBadges = []) {
  // 新用户回合：清除桌面操控 Esc 中断标记与上一轮叠加态
  try {
    require('./desktop-control').onUserTurnStart()
  } catch (_) { /* optional */ }
  chatVerboseLog('[AIChat] handleSendMessage 开始, agentMode:', agentMode, 'images:', imageDataList.length)
  chatVerboseLog('[AIChat] projectId:', projectId)
  chatVerboseLog('[AIChat] instance:', instance ? '存在' : '不存在')
  chatVerboseLog('[AIChat] contextManager:', contextManager ? '存在' : '不存在')
  chatVerboseLog('[AIChat] contextManager.memory:', contextManager?.memory ? '存在' : '不存在')
  chatVerboseLog('[AIChat] memory tape length:', contextManager?.memory?.getLength())
  const requestStartedAt = Date.now()
  const modelName = modelConfig.modelName
  const modelId = effectiveModelId
  const apiEndpoint = buildApiEndpoint(modelConfig)
  const apiFormat = getApiFormat(modelConfig, apiEndpoint)
  const modelCacheIdentity = requestHistoryWindow.buildModelCacheIdentity({
    provider: modelConfig.provider || modelConfig.platform || modelConfig.source,
    apiEndpoint,
    apiFormat,
    modelId,
    modelName
  })
  const assistantModelMetadata = { modelName, modelId, modelCacheIdentity }
  const perfProfile = {
    requestId,
    projectId,
    startedAt: requestStartedAt,
    navigationMs: 0,
    contextBuildMs: 0,
    initialRequestProfile: null,
    initialHeadersMs: 0,
    initialFirstChunkMs: 0,
    continueProfiles: []
  }
  const finishAiObservation = observability.recordAiRequestStart({
    projectId,
    modelId: effectiveModelId,
    modelName: modelConfig?.modelName || modelConfig?.modelId || effectiveModelId,
    executionMode,
    agentMode,
    imageCount: imageDataList.length
  })

  let changeSession = null
  let finalizedChangeSession = null
  let reviewChangeSession = null
  try {
    changeSession = changeSessions.startChangeSession(projectId, projectPath, {
      requestId,
      messagePreview: typeof message === 'string' ? message.substring(0, 200) : '',
      startedBy: 'ai-chat'
    })
  } catch (error) {
    console.error('[ChangeSession] 启动本轮修改记录失败:', error.message)
  }

  const previousChangeDiagnostic = changeSessions.buildPreviousChangeDiagnosticPrompt(projectId, message)

  function finishChangeSession(status) {
    if (!changeSession) return null
    try {
      return changeSessions.finalizeChangeSession(projectId, changeSession.id, status)
    } catch (error) {
      console.error('[ChangeSession] 结束本轮修改记录失败:', error.message)
      return null
    }
  }

  const abortController = new AbortController()
  config.setAbortController(projectId, abortController)
  const signal = abortController.signal
  const requestIsCurrent = () => config.getAbortController(projectId) === abortController
  const deleteAbortControllerIfCurrent = () => {
    if (requestIsCurrent()) config.deleteAbortController(projectId)
  }
  const abortWithReason = (reason) => {
    const reasonText = reason instanceof Error ? `${reason.name}: ${reason.message}` : String(reason)
    console.log('[AIChat] abortWithReason 被调用:', reasonText, 'projectId:', projectId, new Error().stack?.split('\n').slice(1, 4).join(' | '))
    try {
      abortController.abort(reason instanceof Error ? reason : createAbortError(reason))
    } catch {
      abortController.abort()
    }
  }
  const apiTimeouts = getApiTimeouts(modelConfig)
  let activeApiWatchdog = null
  const startApiWatchdog = (label) => {
    if (activeApiWatchdog) activeApiWatchdog.stop()
    activeApiWatchdog = createApiTimeoutWatchdog({
      webContents,
      projectId,
      abortWithReason,
      label,
      firstResponseMs: apiTimeouts.firstResponseMs,
      streamIdleMs: apiTimeouts.streamIdleMs
    })
    return activeApiWatchdog
  }
  const stopApiWatchdog = (watchdog = activeApiWatchdog) => {
    if (!watchdog) return
    watchdog.stop()
    if (watchdog === activeApiWatchdog) activeApiWatchdog = null
  }

  const previewedToolCallIds = new Set()
  const visibleProgressHeartbeatMs = 12000
  const visibleProgressHeartbeatGapMs = 15000
  let lastVisibleProgressAt = Date.now()
  let lastStreamActivityAt = Date.now()
  let lastVisibleHeartbeatAt = 0

  const visibleProgressHeartbeatTimers = new Set()
  let visibleProgressHeartbeatAbortBound = false

  function markStreamActivity() {
    lastStreamActivityAt = Date.now()
  }

  function markVisibleProgress() {
    lastVisibleProgressAt = Date.now()
  }

  function normalizePublicThinkingNote(content) {
    let text = String(content || '').replace(/\r\n/g, '\n').trim()
    if (!text) return ''
    if (hasInternalInstructionLeak(text)) {
      text = stripInternalInstructionLeaks(text, { preserveFormatting: true })
    }
    text = text
      .split('\n')
      .map(line => line.replace(/[ \t]+/g, ' ').trim())
      .filter(Boolean)
      .join('\n')
      .trim()
    if (!text || hasInternalInstructionLeak(text)) return ''
    return text
  }

  function sendVisibleProgressStatus(content, extra = {}) {
    const status = extra.preserveContent ? normalizePublicThinkingNote(content) : normalizeProgressStatus(content)
    if (!status) return false
    webContents?.send('ai-thinking', {
      projectId,
      content: status,
      append: !!extra.append,
      isStatus: true,
      isProgressNarration: true,
      reuseOpenSegment: true,
      forceUpdate: !!extra.forceUpdate,
      isHeartbeat: !!extra.isHeartbeat
    })
    markVisibleProgress()
    return true
  }

  function hasMeaningfulToolCallDelta(toolCalls) {
    return Array.isArray(toolCalls) && toolCalls.some(tc => {
      if (!tc || typeof tc !== 'object') return false
      return Boolean(
        tc.id ||
        tc.type ||
        tc.function?.name ||
        tc.function?.arguments
      )
    })
  }

  let nativeReasoningStreamActive = false

  function sendNativeReasoningDelta(content) {
    const text = String(content || '')
    if (!text.trim()) return false
    if (!nativeReasoningStreamActive) {
      nativeReasoningStreamActive = true
      sendThinkingEvent(webContents, projectId, {
        kind: 'reasoning',
        eventType: 'reasoning-start',
        content: text,
        append: false,
        reuseOpenSegment: true,
        forceUpdate: true
      })
      markVisibleProgress()
      return true
    }
    sendThinkingEvent(webContents, projectId, {
      kind: 'reasoning',
      eventType: 'reasoning-delta',
      content: text,
      append: true,
      reuseOpenSegment: true,
      forceUpdate: true
    })
    markVisibleProgress()
    return true
  }

  function finishNativeReasoningStream() {
    if (!nativeReasoningStreamActive) return false
    nativeReasoningStreamActive = false
    webContents?.send('ai-thinking', {
      projectId,
      eventType: 'reasoning-end',
      type: 'reasoning-end',
      isReasoningSummary: true
    })
    return true
  }


  // 同一 signal 只绑一次 abort 清理，避免重复 addEventListener
  if (signal && !visibleProgressHeartbeatAbortBound) {
    visibleProgressHeartbeatAbortBound = true
    try {
      signal.addEventListener('abort', () => {
        stopAllVisibleProgressHeartbeats()
      }, { once: true })
    } catch (_) { /* ignore */ }
  }

  function startVisibleProgressHeartbeat(label = '') {
    const timer = setInterval(() => {
      if (signal?.aborted) {
        clearInterval(timer)
        visibleProgressHeartbeatTimers.delete(timer)
        return
      }
      const now = Date.now()
      if (now - lastVisibleProgressAt < visibleProgressHeartbeatMs) return
      if (now - lastVisibleHeartbeatAt < visibleProgressHeartbeatGapMs) return
      lastVisibleHeartbeatAt = now
      const recentlyStreaming = now - lastStreamActivityAt < visibleProgressHeartbeatGapMs
      // Runtime heartbeats intentionally do not create thinking blocks.
      webContents?.send('ai-status', {
        projectId,
        status: recentlyStreaming ? 'streaming' : 'thinking',
        heartbeat: true,
        label
      })
    }, 1000)
    timer.unref?.() // 不阻止进程退出
    visibleProgressHeartbeatTimers.add(timer)
    return timer
  }

  function stopVisibleProgressHeartbeat(timer) {
    if (!timer) return
    clearInterval(timer)
    visibleProgressHeartbeatTimers.delete(timer)
  }

  function stopAllVisibleProgressHeartbeats() {
    for (const timer of visibleProgressHeartbeatTimers) clearInterval(timer)
    visibleProgressHeartbeatTimers.clear()
  }

  function isVisibleToolName(name = '') {
    const value = String(name || '')
    return !!value && !isInternalUiOnlyToolName(value)
  }

  function previewStreamingToolCall(toolCall) {
    const toolName = toolCall?.function?.name || ''
    const toolCallId = toolCall?.id || ''
    if (!isVisibleToolName(toolName) || !toolCallId || previewedToolCallIds.has(toolCallId)) return
    previewedToolCallIds.add(toolCallId)
    // Stream assembly only records the previewed id; real tool-start is sent during execution.
    // Visible thinking is driven by show_thinking_note.
    previewedToolCallIds.add(toolCallId)
    markVisibleProgress()
  }

  webContents?.send('ai-status', { projectId, status: 'thinking' })

  // ===== 构建用户消息（支持多模态） =====
  let userMessageContent
  let effectiveMessage = message
  const originalMessage = message
  // 全部图片元数据（含 forHistoryOnly：只为历史缩略图落盘，不参与视觉/多模态）
  const allImageDataList = Array.isArray(imageDataList) ? imageDataList : []
  let effectiveImageDataList = allImageDataList.filter(img => !img?.forHistoryOnly)
  const originalImageDataList = effectiveImageDataList.slice()
  const runRef = taskRuns.startRun(projectId, requestId, {
    messagePreview: String(message || '').slice(0, 300),
    modelName: modelConfig.modelName,
    modelId: effectiveModelId,
    executionMode,
    hidden: !!hidden,
    hasImages: effectiveImageDataList.length > 0
  })
  if (previousChangeDiagnostic.enabled) {
    taskRuns.event(runRef, 'previous_change_diagnostic_attached', {
      sessionId: previousChangeDiagnostic.sessionId,
      changedPaths: previousChangeDiagnostic.changedPaths
    })
  }
  const normalizedReferences = normalizeReferences(references)
  const referencedContextBlock = buildReferencedContextBlock(instance, normalizedReferences)
  if (referencedContextBlock) {
    effectiveMessage = [
      effectiveMessage,
      '',
      referencedContextBlock
    ].join('\n\n')
  }
  const currentModelConfig = normalizeModel(modelConfig)
  const currentModelHasVision = hasCapability(currentModelConfig, 'vision')

  let visionResultForHistory = null
  let visionRelayToolUi = null
  try {
    throwIfAborted(signal)
    if (effectiveImageDataList.length > 0 && !currentModelHasVision) {
      if (visionRelayConfig?.approved && visionRelayConfig?.visionModelConfig) {
        const firstVisionImage = effectiveImageDataList[0] || {}
        const firstVisionPath = String(firstVisionImage.path || '')
        const firstVisionData = String(firstVisionImage.data || firstVisionImage.url || '')
        const firstVisionMime = String(firstVisionImage.type || 'image/png')
        const firstVisionPreview = firstVisionData
          ? (firstVisionData.startsWith('data:image/')
              ? firstVisionData
              : `data:${firstVisionMime};base64,${firstVisionData}`)
          : null
        const firstVisionDims = await probeImageDimensions({
          path: firstVisionPath,
          data: firstVisionData,
          url: firstVisionPreview
        }).catch(() => ({ width: null, height: null }))
        visionRelayToolUi = {
          id: `vision-relay-${requestId}`,
          args: {
            path: firstVisionPath,
            question: message,
            image_count: effectiveImageDataList.length,
            // P4 · pending 舞台可直接用 dataUrl 渲染源图（粘贴图无 path 时不再 360×360 空盒）
            dataUrl: firstVisionPreview || undefined,
            width: firstVisionDims.width || undefined,
            height: firstVisionDims.height || undefined
          },
          preview: firstVisionPreview,
          width: firstVisionDims.width,
          height: firstVisionDims.height
        }
        webContents?.send('tool-start', {
          projectId,
          name: 'inspect_image',
          args: visionRelayToolUi.args,
          toolCallId: visionRelayToolUi.id
        })
        const visionResult = await analyzeImagesWithVisionModel({
          visionModelConfig: normalizeModel(visionRelayConfig.visionModelConfig),
          imageDataList: effectiveImageDataList,
          userMessage: message,
          signal
        })
        visionResultForHistory = visionResult
        webContents?.send('tool-result', {
          projectId,
          name: 'inspect_image',
          args: visionRelayToolUi.args,
          toolCallId: visionRelayToolUi.id,
          result: {
            success: true,
            file_type: 'image_analysis',
            kind: 'vision_inspection',
            path: firstVisionPath,
            modelName: visionResult.modelName,
            imageNames: visionResult.imageNames,
            summary: visionResult.summary,
            thumbnailDataUrl: visionRelayToolUi.preview,
            width: visionRelayToolUi.width || null,
            height: visionRelayToolUi.height || null,
            message: '视觉分析完成'
          }
        })
        visionRelayToolUi.completed = true
        effectiveMessage = [
          message,
          '',
          '【视觉模型分析结果】',
          `分析模型：${visionResult.modelName}`,
          `图片：${visionResult.imageNames.join('、')}`,
          visionResult.summary,
          '',
          '请基于以上图片分析和用户需求回答；不要声称当前模型直接看到了图片。'
        ].join('\n')
        effectiveImageDataList = []
      } else {
        const metadataNote = buildImageMetadataNote(effectiveImageDataList)
        effectiveMessage = `${message}\n\n${metadataNote}`
        effectiveImageDataList = []
      }
    }
  } catch (err) {
    if (visionRelayToolUi && !visionRelayToolUi.completed) {
      webContents?.send('tool-result', {
        projectId,
        name: 'inspect_image',
        args: visionRelayToolUi.args,
        toolCallId: visionRelayToolUi.id,
        result: {
          success: false,
          error: err.message || '视觉分析失败'
        }
      })
    }
    stopApiWatchdog()
    const requestWasCurrent = requestIsCurrent()
    deleteAbortControllerIfCurrent()
    const timedOut = isApiTimeoutError(err, signal)
    const aborted = !timedOut && isAbortError(err, signal)
    console.error('[AIChat] ⚠️ 视觉/附件准备 catch 诊断:',
      '\n  err.name:', err?.name, '\n  err.message:', err?.message,
      '\n  signal.aborted:', signal?.aborted, '\n  timedOut:', timedOut, '\n  aborted:', aborted
    )
    finalizedChangeSession = finishChangeSession(aborted ? 'interrupted' : 'error')
    if (aborted) {
      taskRuns.finishRun(runRef, 'interrupted', {
        stage: 'vision_or_attachment_prepare',
        error: err.message,
        changeSessionId: finalizedChangeSession?.id || null
      })
      if (requestWasCurrent) webContents?.send('ai-status', { projectId, status: 'interrupted' })
      event.reply('send-message-response', { requestId, projectId, success: true, interrupted: true, changeSession: finalizedChangeSession })
    } else {
      taskRuns.finishRun(runRef, 'failed', {
        stage: 'vision_or_attachment_prepare',
        error: err.message,
        changeSessionId: finalizedChangeSession?.id || null
      })
      if (requestWasCurrent) {
        webContents?.send('ai-status', { projectId, status: 'error' })
        webContents?.send('message-reply', { projectId, error: err.message, done: true, changeSession: finalizedChangeSession })
      }
      event.reply('send-message-response', { requestId, projectId, error: err.message, changeSession: finalizedChangeSession })
    }
    stopLocalOllamaModelAfterReply(modelConfig, effectiveModelId)
    return
  }

  if (effectiveImageDataList && effectiveImageDataList.length > 0) {
    // 有图片：构建多模态内容（OpenAI格式）
    const preparedImages = await prepareImages(effectiveImageDataList)
    const validImages = preparedImages.filter(item => item.url)
    const failedImages = preparedImages.filter(item => item.error)
    if (validImages.length === 0) {
      const failureNote = failedImages.length
        ? '\n\n【图片读取失败】' + failedImages.map(item => `\n- ${item.name}: ${item.error}`).join('')
        : ''
      userMessageContent = `${effectiveMessage}\n\n${buildImageMetadataNote(effectiveImageDataList)}${failureNote}`
      chatVerboseLog('[AIChat] 图片读取失败，已降级为元数据')
    } else {
      userMessageContent = []
      // 添加文本部分
      if (effectiveMessage) {
        userMessageContent.push({ type: 'text', text: effectiveMessage })
      }
      if (failedImages.length > 0) {
        userMessageContent.push({
          type: 'text',
          text: '以下图片读取失败，未参与视觉分析：' + failedImages.map(item => `${item.name}: ${item.error}`).join('；')
        })
      }
      // 添加图片部分（OpenAI格式：data URI）
      for (const img of validImages) {
        userMessageContent.push({
          type: 'image_url',
          image_url: {
            url: img.url
          }
        })
      }
      chatVerboseLog('[AIChat] 多模态消息: 文本 +', validImages.length, '张图片')
    }
  } else {
    // 无图片：纯文本
    userMessageContent = effectiveMessage
  }

  // ===== 核心修复：使用后端完整历史，而非前端传来的 =====
  // 前端传来的 history 可能不完整或不正确
  // 使用 instance.messagesHistory 作为真实历史源

  const requestUserMessageContent = userMessageContent
  const visibleUserMessageContent = sanitizeUserVisibleContent(
    typeof displayContent === 'string' && displayContent.trim()
      ? displayContent
      : originalMessage
  )
  let historyUserMessageContent
  if (Array.isArray(userMessageContent)) {
    historyUserMessageContent = userMessageContent.map(part => {
      if (part && part.type === 'text') return { ...part, text: visibleUserMessageContent }
      return part
    })
  } else if (typeof userMessageContent === 'string') {
    historyUserMessageContent = visibleUserMessageContent
  } else {
    historyUserMessageContent = visibleUserMessageContent || userMessageContent
  }

  // 当前用户消息每次都追加；持久历史只保存原始消息与引用 ID，不保存引用详情全文。
  const userHistoryEntry = { role: 'user', content: historyUserMessageContent, time: new Date().toISOString() }
  // UI 回显用轻量附件：path/name/type only。来源：imageDataList（含 forHistoryOnly）+ 消息里的「路径:」行。
  // 不写 base64，避免历史膨胀；切项目后靠 path 懒加载缩略图。
  const uiImageAttachments = []
  const pushUiAttachment = (raw = {}) => {
    const filePath = String(raw.path || '').trim()
    const name = String(raw.name || (filePath ? path.basename(filePath) : '')).trim()
    if (!name && !filePath) return
    const ext = filePath ? path.extname(filePath).slice(1).toLowerCase() : ''
    const looksImage = raw.type
      ? String(raw.type).startsWith('image/')
      : /\.(png|jpe?g|gif|bmp|webp|svg|ico)$/i.test(name || filePath)
    if (!looksImage) return
    const baseKey = (name || path.basename(filePath)).toLowerCase()
    const pathKey = filePath.toLowerCase()
    // 同文件去重：优先保留带 path 的那条，避免「缩略图 + 文件名大圆占位」双显示
    const existing = uiImageAttachments.find(item => {
      if (pathKey && item.path && String(item.path).toLowerCase() === pathKey) return true
      return String(item.name || '').toLowerCase() === baseKey
    })
    if (existing) {
      if (!existing.path && filePath) existing.path = filePath
      if (!existing.type && raw.type) existing.type = String(raw.type)
      return
    }
    uiImageAttachments.push({
      kind: 'image',
      name: name || (filePath ? path.basename(filePath) : 'image'),
      path: filePath,
      type: String(raw.type || '').trim() || (ext ? `image/${ext === 'jpg' ? 'jpeg' : ext}` : 'image/*')
    })
  }
  for (const img of allImageDataList) pushUiAttachment(img)
  // 无视觉 payload 时 imageDataList 可能为空，从正文「路径:」恢复（不要单独加无 path 的【文件】名，易重复占位）
  {
    const textForPaths = String(originalMessage || '')
    const pathRe = /路径:\s*([^\r\n]+)/g
    let m
    while ((m = pathRe.exec(textForPaths)) !== null) {
      const filePath = String(m[1] || '').trim()
      if (!filePath) continue
      pushUiAttachment({ path: filePath, name: path.basename(filePath) })
    }
  }
  if (uiImageAttachments.length > 0) {
    if (visionResultForHistory && visionResultForHistory.summary) {
      uiImageAttachments[0].visionAnalysis = {
        model: visionResultForHistory.modelName || '',
        summary: visionResultForHistory.summary,
        imageNames: Array.isArray(visionResultForHistory.imageNames) ? visionResultForHistory.imageNames : [],
        analyzedAt: Date.now()
      }
    }
    userHistoryEntry.attachments = uiImageAttachments
  } else if (visionResultForHistory && visionResultForHistory.summary) {
    userHistoryEntry.attachments = [{
      kind: 'image',
      visionAnalysis: {
        model: visionResultForHistory.modelName || '',
        summary: visionResultForHistory.summary,
        imageNames: Array.isArray(visionResultForHistory.imageNames) ? visionResultForHistory.imageNames : [],
        analyzedAt: Date.now()
      }
    }]
  }
  if (hidden) userHistoryEntry.hidden = true
  if (displayContent) userHistoryEntry.displayContent = displayContent
  if (Array.isArray(directiveBadges) && directiveBadges.length > 0) {
    userHistoryEntry.directiveBadges = directiveBadges
      .filter(item => item && (item.token || item.label))
      .map(item => ({
        token: String(item.token || item.label || '').slice(0, 120),
        label: String(item.label || item.token || '').slice(0, 120),
        desc: String(item.desc || '').slice(0, 240),
        kind: String(item.kind || '').slice(0, 80)
      }))
  }
  if (normalizedReferences.length > 0) {
    userHistoryEntry.references = normalizedReferences
  }
  instance._imagePruneState = instance._imagePruneState || {}
  const prunedImages = pruneExpiredImageAttachments(instance.messagesHistory, 4, instance._imagePruneState)
  if (repairToolCallAdjacency(instance.messagesHistory, { tailOnly: true }) || prunedImages) {
    if (projects.saveProjectChatHistoryDeferred) projects.saveProjectChatHistoryDeferred(instance)
    else projects.saveProjectChatHistory(instance)
  }
  let currentHistoryIndex = instance.messagesHistory.length
  instance.messagesHistory.push(userHistoryEntry)
  instance._chatHistoryDirty = true
  if (projects.saveProjectChatHistoryDeferred) projects.saveProjectChatHistoryDeferred(instance)
  else projects.saveProjectChatHistory(instance)

  taskRuns.event(runRef, 'user_message_saved', {
    historyIndex: currentHistoryIndex,
    hasImages: Array.isArray(originalImageDataList) && originalImageDataList.length > 0,
    references: userHistoryEntry.references || []
  })

  // 获取完整历史。当前请求使用带引用全文的临时消息，持久历史仍只保存原始消息。
  function isUnfinishedAssistantTail(message) {
    if (!message || message.role !== 'assistant') return false
    const content = String(message.content || '')
    return !!(
      message.interrupted ||
      message.error ||
      message.timeout ||
      /模型接口超过\s*\d+\s*秒没有返回响应|任务未完整完成|未收到模型的有效最终回复|operation aborted|aborted/i.test(content)
    )
  }

  function isExplicitContinuationRequest(text = '') {
    const value = String(text || '').trim()
    if (!value) return false
    return /^(继续|接着|继续吧|接着来|恢复|继续执行|继续处理|按刚才|按上面|上一个|刚才那个|继续刚才|接着刚才|resume\b|continue\b)/i.test(value)
  }

  function toContinuationSnippet(content = '', maxChars = 900) {
    const text = sanitizeUserVisibleContent(content).replace(/\s+/g, ' ').trim()
    if (!text) return ''
    return text.length > maxChars ? `${text.slice(0, maxChars - 3).trim()}...` : text
  }

  function isLowSignalContinuationText(text = '') {
    return /^(继续|接着|继续吧|接着来|继续执行|继续处理|恢复|resume|continue)$/i.test(String(text || '').trim())
  }

  function findContinuationTarget(historyList, currentIndex) {
    if (!Array.isArray(historyList) || currentIndex <= 0) return null
    const lowerBound = Math.max(0, currentIndex - 12)
    let assistantIndex = -1

    for (let i = currentIndex - 1; i >= lowerBound; i--) {
      const item = historyList[i]
      if (!item) continue
      if (isUnfinishedAssistantTail(item)) {
        assistantIndex = i
        break
      }
      if (item.role === 'assistant' && item.content && !isUnfinishedAssistantTail(item)) {
        const content = String(item.content || '')
        if (/完成了|已完成|解决了|可以了|成功|最终回复|验证通过/.test(content)) break
      }
    }

    if (assistantIndex < 0) return null

    let userIndex = -1
    for (let i = assistantIndex - 1; i >= lowerBound; i--) {
      const item = historyList[i]
      if (!item || item.role !== 'user') continue
      const content = sanitizeUserVisibleContent(item.content)
      if (isLowSignalContinuationText(content)) continue
      userIndex = i
      break
    }

    const failedAssistant = historyList[assistantIndex]
    const originalUser = userIndex >= 0 ? historyList[userIndex] : null
    return {
      assistantIndex,
      userIndex,
      originalUserText: toContinuationSnippet(originalUser?.content || ''),
      failedAssistantText: toContinuationSnippet(failedAssistant?.content || '', 700)
    }
  }

  function buildContinuationTargetPrompt(target) {
    if (!target) return ''
    const lines = [
      '===== 继续任务恢复线索 =====',
      '用户本轮是在说“继续/接着处理”。下面是系统从最近历史中提取的未完成任务线索，优先据此恢复旧任务，不要回答“不确定你要继续什么”。'
    ]
    if (target.originalUserText) {
      lines.push('', '最近未完成任务的原始用户请求：', target.originalUserText)
    }
    if (target.failedAssistantText) {
      lines.push('', '最近一次中断/失败的 AI 输出摘要：', target.failedAssistantText)
    }
    lines.push('', '处理要求：先承接这个任务；如果线索仍不足，再只问一个最关键的问题。')
    return lines.join('\n')
  }

  const previousHistoryEntry = instance.messagesHistory[currentHistoryIndex - 1] || null
  const previousRunWasUnfinished = isUnfinishedAssistantTail(previousHistoryEntry)
  const currentMessageContinuesPreviousRun = isExplicitContinuationRequest(requestUserMessageContent || message)
  const continuationTarget = currentMessageContinuesPreviousRun
    ? findContinuationTarget(instance.messagesHistory, currentHistoryIndex)
    : null
  let fullHistory = []

  let compressionResult = null
  const modelTransition = requestHistoryWindow.detectModelTransition(
    instance.messagesHistory,
    currentHistoryIndex,
    {
      identity: modelCacheIdentity,
      aliases: [modelId, modelName, modelConfig.modelId, modelConfig.modelName]
    }
  )
  const modelProjectionOptions = {
    collapseAll: false,
    currentIdentity: modelCacheIdentity,
    currentAliases: [modelId, modelName, modelConfig.modelId, modelConfig.modelName]
  }
  const requestContextBudget = buildContextBudget(
    modelConfig.modelName || effectiveModelId || modelId,
    modelConfig.contextWindow || modelConfig.contextLength || modelConfig.maxContextTokens
  )
  const modelSwitchProjectionPreview = requestHistoryWindow.projectCompletedTurnsForModel(
    instance.messagesHistory,
    modelProjectionOptions
  )
  const modelScopedProjectionNeeded = modelSwitchProjectionPreview.collapsedTurns > 0
  const modelSwitchProjectedTokens = modelSwitchProjectionPreview
    ? modelSwitchProjectionPreview.history.reduce((sum, item) => sum + requestHistoryWindow.estimateMessageTokens(item), 0)
    : 0
  try {
    throwIfAborted(signal)
    const compressionOptions = {
      triggerTokens: Math.floor(requestContextBudget.inputBudgetTokens * 0.75),
      retainTokens: Math.floor(requestContextBudget.inputBudgetTokens * 0.35)
    }
    // 换模型后先按“用户需求 + 最终正文”估算；投影已经足够小时，不为旧模型的
    // 工具链和深度思考额外创建压缩摘要。投影本身仍不会修改完整历史。
    const skipCompressionForModelSwitch = modelScopedProjectionNeeded && modelSwitchProjectedTokens < compressionOptions.triggerTokens
    let compressionPlan = skipCompressionForModelSwitch
      ? { shouldCreate: false, coveredMessageIndex: -1, pendingTokens: modelSwitchProjectedTokens }
      : await contextCompression.getCompressionPlan(instance, instance.messagesHistory, compressionOptions)
    if (compressionPlan.shouldCreate) {
      webContents?.send('context-compression-start', {
        projectId,
        status: 'running',
        message: '正在进行上下文压缩'
      })
      compressionResult = await contextCompression.createCompressionSummary(instance, instance.messagesHistory, {
        ...compressionOptions,
        userRequest: message,
        summarizeWithWorker: async ({ prompt }) => workerModel.summarizeJson({
          system: '你是上下文压缩整理员，只输出 JSON。',
          prompt
        })
      })
      throwIfAborted(signal)
    } else {
      compressionResult = {
        created: false,
        coveredMessageIndex: compressionPlan.coveredMessageIndex,
        pendingTokens: compressionPlan.pendingTokens
      }
    }
    throwIfAborted(signal)
    if (compressionResult?.created) {
      const dividerInsertIndex = Number.isInteger(compressionResult.summary?.endHistoryIndex)
        ? compressionResult.summary.endHistoryIndex
        : instance.messagesHistory.length
      instance.messagesHistory = contextCompression.ensureDividerInHistory(instance.messagesHistory, compressionResult.summary)
      if (dividerInsertIndex <= currentHistoryIndex) currentHistoryIndex += 1
      instance._chatHistoryDirty = true
      projects.saveProjectChatHistory(instance)
      webContents?.send('context-split', {
        projectId,
        splitIndex: compressionResult.splitTurn,
        summary: compressionResult.summary?.summaryText || '',
        estimatedTokens: 0,
        budgetTokens: 0,
        oversizedRefs: [],
        coveredTokens: compressionResult.sourceTokenEstimate || 0,
        compressionSummaryId: compressionResult.summary?.id || null
      })
      webContents?.send('context-compression-start', {
        projectId,
        status: 'done',
        message: '上下文压缩完成',
        compressionSummaryId: compressionResult.summary?.id || null
      })
    }
  } catch (error) {
    throwIfAborted(signal)
    console.error('[ContextCompression] 创建滑动摘要失败:', error.message)
    webContents?.send('context-compression-start', {
      projectId,
      status: 'failed',
      message: '上下文压缩失败'
    })
  }

  // 压缩纪元内只追加消息，不滑动删除最旧轮次。缓存前缀仅在新摘要生成时重建。
  let epochWindow = null
  let cacheEpochContext = null
  let historyProjection = {
    applied: false,
    reason: 'same-model-or-unknown',
    collapsedTurns: 0,
    removedMessages: 0,
    removedToolMessages: 0,
    removedReasoningChars: 0
  }
  try {
    cacheEpochContext = await contextCompression.buildCacheEpochContext(instance, {
      summariesPerEpoch: contextCompression.DEFAULT_CACHE_EPOCH_SUMMARIES,
      maxItems: 3
    })
    const historyWindowOptions = {
      coveredMessageId: cacheEpochContext.coveredMessageId,
      coveredMessageIndex: cacheEpochContext.coveredMessageIndex,
      summaryBlock: cacheEpochContext.summaryBlock,
      tokenBudget: requestContextBudget.inputBudgetTokens,
      projectionOptions: modelProjectionOptions
    }
    epochWindow = modelScopedProjectionNeeded
      ? requestHistoryWindow.buildModelSwitchHistory(instance.messagesHistory, currentHistoryIndex, historyWindowOptions)
      : requestHistoryWindow.buildCompressionEpochHistory(instance.messagesHistory, currentHistoryIndex, historyWindowOptions)
    fullHistory = epochWindow.history
    if (modelScopedProjectionNeeded) {
      historyProjection = {
        applied: true,
        reason: modelTransition.switched ? 'model-switch' : 'foreign-model-history',
        collapsedTurns: epochWindow.collapsedTurns || 0,
        removedMessages: epochWindow.removedMessages || 0,
        removedToolMessages: epochWindow.removedToolMessages || 0,
        removedReasoningChars: epochWindow.removedReasoningChars || 0
      }
    }
  } catch (trimError) {
    epochWindow = modelScopedProjectionNeeded
      ? requestHistoryWindow.buildModelSwitchHistory(instance.messagesHistory, currentHistoryIndex, {
          tokenBudget: requestContextBudget.inputBudgetTokens,
          projectionOptions: modelProjectionOptions
        })
      : requestHistoryWindow.buildRequestHistoryWindow(instance.messagesHistory, currentHistoryIndex, { tokenBudget: requestContextBudget.inputBudgetTokens })
    fullHistory = epochWindow.history
    if (modelScopedProjectionNeeded) {
      historyProjection = {
        applied: true,
        reason: modelTransition.switched ? 'model-switch-fallback' : 'foreign-model-history-fallback',
        collapsedTurns: epochWindow.collapsedTurns || 0,
        removedMessages: epochWindow.removedMessages || 0,
        removedToolMessages: epochWindow.removedToolMessages || 0,
        removedReasoningChars: epochWindow.removedReasoningChars || 0
      }
    }
    console.warn('[ContextTrim] 压缩纪元读取失败，安全降级为近期窗口:', trimError.message)
  }
  const requestCurrentHistoryIndex = fullHistory.length - 1
  fullHistory[requestCurrentHistoryIndex] = {
    ...fullHistory[requestCurrentHistoryIndex],
    content: requestUserMessageContent
  }
  // 按当前模型能力规范化历史中的图片上下文：视觉模型直读图片，非视觉模型用持久化的分析摘要
  normalizeFullHistoryForModel(fullHistory, currentModelHasVision, requestCurrentHistoryIndex)
  chatVerboseLog(`[ContextTrim] 压缩纪元保留约 ${epochWindow?.epochTokens || 0} tokens、${fullHistory.length} 条，跳过 ${epochWindow?.trimmedCount || 0} 条旧历史`)

  // 按当前模型的真实窗口和安全余量构建 API 消息。
  const requestHistory = fullHistory
  const promptCacheScope = {
    projectId,
    branchId: instance?.branchKey || instance?.parentBranchKey || instance?.branchName || instance?.parentBranchName || '',
    // 项目内聊天会话必须拥有独立的缓存命名空间。
    // sessionId 不得回退到 branchKey，否则同项目同分支的多个 chat-sessions 会共用 cache key，
    // 交替请求时互相冲掉前缀。如果没有 chatSessionId，使用 instance 引用的稳定 hash 作为兜底。
    sessionId: instance?.chatSessionId || instance?.collaborationSessionId || '',
    grokCacheLayoutVersion: 'v2'
  }
  // 兜底：如果 sessionId 为空，基于 instance 对象生成稳定唯一 ID（不回退到 branchKey）
  if (!promptCacheScope.sessionId && instance) {
    const instanceStableKey = require('crypto').createHash('sha256')
      .update([projectId, instance?.branchKey || '', String(instance?.createdAt || instance?.startedAt || Date.now())].join(':'))
      .digest('hex').slice(0, 16)
    promptCacheScope.sessionId = instanceStableKey
  }

  // 构建系统提示
  const workbenchFeatures = detectWorkbenchMentions(message)
  const disabledWorkbenchTools = getDisabledWorkbenchTools(workbenchFeatures)
  // Codex-aligned: lean always-on system (compact runtime + progressive disclosure).
  // Domain packs / task focus / playbook short-chain inject per turn, not into stable system.
  const stablePromptFeatures = {
    blender: true,
    ppt: true,
    music: true,
    any: true,
    cacheStableGate: true,
    mcp: { aidev: false, any: false, cacheStableGate: true },
    compactRuntimePrompt: true
  }
  let baseSystemPrompt = getSystemPrompt(executionMode, projectPath, agentMode, 'zh-CN', {
    ...stablePromptFeatures
  })
  const isDeepSeekPromptCacheTarget = getPromptCacheCapability(modelConfig, apiEndpoint, modelId).id === 'deepseek'
  if (isDeepSeekPromptCacheTarget) {
    baseSystemPrompt = `${baseSystemPrompt}

===== DeepSeek 工具调用策略 =====
- 每轮只发起一个原生工具调用。多个互不依赖的只读任务（读取已知文件、文件内查找、rg 文本搜索）必须合并为一次 parallel_research 调用。
- parallel_research 的子任务不得彼此依赖，结果按 tasks 输入顺序返回；不要把写入、删除、构建、启动服务、网络副作用或“先搜索再读取搜索结果”放入其中。
- 需要修改工程、运行构建或依赖前一步结果时，继续使用普通工具调用，拿到结果后再决定下一步。`
  }

  let systemPrompt
  if (skillContent) {
    // 技能只补充任务做法，不能覆盖基础行为和回复风格
    systemPrompt = `${baseSystemPrompt}

===== 当前启用技能 =====
当前有技能激活。技能指导用于补充任务处理方法，但不能覆盖上面的回复风格、执行模式、等待用户、路径处理和安全规则。

---

${skillContent}
`
    chatVerboseLog('[AIChat] 技能已添加到系统提示开头, 长度:', skillContent.length)
  } else {
    systemPrompt = baseSystemPrompt
    chatVerboseLog('[AIChat] 无技能内容')
  }

  // Codex 风格：流程细则按意图自动挂载（不常驻主提示），避免「主提示堆工作流」
  try {
    const autoSkillPrompt = require('./skills').buildAutoAttachedSkillPrompt(message)
    if (autoSkillPrompt) {
      systemPrompt = `${systemPrompt}

${autoSkillPrompt}
`
      chatVerboseLog('[AIChat] 已自动挂载流程技能, 长度:', autoSkillPrompt.length)
    }
  } catch (e) {
    console.warn('[AIChat] auto skill attach failed:', e.message)
  }

  systemPrompt = `${systemPrompt}

${buildCurrentModelCapabilityPrompt(modelConfig)}`

  if (expectsNativeReasoningStream(modelConfig, effectiveModelId)) {
    systemPrompt = `${systemPrompt}

===== 原生深度思考展示约束 =====
原生 reasoning/thinking 会展示给用户，必须短、准、不循环：
- 只写：目标一句、关键判断、选哪个工具/下一步；禁止复述用户原话、寒暄、自我打气、模板过渡句。
- 同一判断不要换措辞重说两遍；信息不够就去调工具，不要空想补戏。
- 简单问答/小改动：思考尽量短；复杂多步任务才允许稍长，但仍用条目，不写长文。
- 思考是给自己指路的，最终交付靠正文与工具结果，不要把长推理当最终回复。`
  }

  const turnWorkflowPrompt = buildTurnWorkflowPrompt(message, {
    skillHint: skillContent ? String(skillContent).slice(0, 80) : '',
    compact: true
  })
  let taskAnchorPrompt = ''
  let intentDisclosurePrompt = ''
  try {
    const disclosure = require('./prompt-disclosure')
    taskAnchorPrompt = disclosure.buildTaskAnchorPrompt(message, { projectPath })
    intentDisclosurePrompt = disclosure.buildIntentDisclosurePrompt(message)
  } catch (e) {
    console.warn('[AIChat] prompt disclosure failed:', e.message)
  }
  const runtimeSystemMessages = [
    taskAnchorPrompt,
    buildTaskFocusPrompt(message, { projectPath, compact: true, maxBullets: 5 }),
    turnWorkflowPrompt,
    intentDisclosurePrompt
  ].filter(Boolean)

  if (instance.stateless) {
    runtimeSystemMessages.push(`===== 无项目会话规则 =====
当前会话尚未绑定工作目录。普通问答和方案讨论直接回复，不要为了聊天创建目录。
- 查看已有文件或目录：工具参数必须使用用户明确提供的绝对路径；只读操作不会创建或绑定工作区。
- 修改已有目录：先使用该目录的绝对路径调用工具。系统会在首次写入前把现有目录绑定到当前项目 ID。
- 创建新成果：不要先用相对路径执行只读扫描，直接以相对路径发起首个写入操作；系统会在剩余空间最大的可写磁盘创建工作区并绑定当前项目 ID。
- 不得猜测或虚构已有路径。用户只要求查看而路径不明确时，应请用户提供或选择目录。`)
  }

  if (previousRunWasUnfinished || continuationTarget) {
    runtimeSystemMessages.push(currentMessageContinuesPreviousRun
      ? '上一轮任务被中断或失败，但用户本轮明确要求继续/接着处理。你可以参考上一轮上下文继续完成旧任务，同时仍以本轮用户补充要求为最高优先级。'
      : '上一轮任务被中断或失败，只能作为背景信息。除非用户本轮明确要求继续，否则不要自动续做上一轮未完成任务；必须以本轮最新用户消息为最高优先级。如果本轮只是问候或新问题，就直接回应本轮消息。')
  }

  const continuationTargetPrompt = currentMessageContinuesPreviousRun
    ? buildContinuationTargetPrompt(continuationTarget)
    : ''
  if (continuationTargetPrompt) {
    runtimeSystemMessages.push(continuationTargetPrompt)
  }

  if (previousChangeDiagnostic.enabled) {
    runtimeSystemMessages.push(previousChangeDiagnostic.prompt)
  }

  const primaryRolePrompt = buildPrimaryRolePrompt(message)
  if (primaryRolePrompt) {
    runtimeSystemMessages.push(primaryRolePrompt)
  }

  perfProfile.navigationMs = 0

  chatVerboseLog('[AIChat] 系统提示总长度:', systemPrompt.length, '字符')

  const includeProjectContext = shouldUseProjectContext(message)
  const includeDesignStyleContext = includeProjectContext && shouldUseDesignStyleContext(message, instance)
  const includeHistoricalProjectContext = shouldIncludeHistoricalProjectContext(message)
  const stableLedgerIndexContext = includeHistoricalProjectContext
    ? taskLedger.formatIndexForContext(instance, { maxItems: getLedgerContextMaxItems(message) })
    : ''
  const routeRecallContext = ''
  const memoryContext = includeProjectContext
    ? memoryOrganizer.formatForContext(memoryOrganizer.load(instance), { query: message })
    : ''
  const designStyleContext = includeDesignStyleContext
    ? designStyleMemory.formatForContext({ query: message, maxItems: 2, maxChars: 2600 })
    : ''
  const dynamicRuntimeMessages = [
    getRuntimeContextPrompt(projectPath),
    stableLedgerIndexContext,
    ...runtimeSystemMessages,
    routeRecallContext,
    memoryContext,
    designStyleContext,
    careReminder.buildCareSituationHint(careReminder.getCareContext({ userMessage: message, now: Date.now() }))
  ].filter(Boolean)

  // Keep the stable system/cache prefix unchanged. Clearly labeled per-turn
  // runtime guidance belongs at the request tail, after all reusable history.
  const contextTailGuidance = dynamicRuntimeMessages.join('\n\n')
  appendGuidanceToLatestUserMessage(requestHistory, contextTailGuidance)

  // 注入压缩摘要块（含轮次索引行）到 system messages
  // 修复：buildContextSummaryBlock 原本定义了但从未接入主流程，导致压缩后模型完全看不到摘要内容
  let compressionSummaryBlock = ''
  if (includeProjectContext) {
    try {
      compressionSummaryBlock = await contextCompression.buildContextSummaryBlock(instance, { maxItems: 3 })
    } catch (e) {
      chatVerboseLog('[AIChat] buildContextSummaryBlock 失败:', e.message)
    }
  }
  const contextExtraSystemMessages = [compressionSummaryBlock].filter(Boolean)
  const contextPrioritySystemMessages = [buildBehaviorStylePrompt()].filter(Boolean)

  const contextBuildStartedAt = Date.now()
  const contextPayload = buildContextPayload({
    contextManager,
    systemPrompt,
    history: requestHistory,
    policy: {
      ...requestContextBudget,
      includeDynamicCompressedHistory: false,
      includeBehaviorSummary: false,
      preserveCachePrefix: true,
      behaviorSummaryMaxChars: 2400
    },
    prioritySystemMessages: contextPrioritySystemMessages,
    extraSystemMessages: contextExtraSystemMessages
  })
  perfProfile.contextBuildMs = Date.now() - contextBuildStartedAt

  const messages = contextPayload.messages

  if (contextPayload.compressed) {
    webContents?.send('context-split', {
      projectId,
      splitIndex: contextPayload.splitIndex,
      summary: contextPayload.summary,
      estimatedTokens: contextPayload.estimatedTokens,
      budgetTokens: contextPayload.budgetTokens,
      oversizedRefs: contextPayload.oversizedRefs || [],
      coveredTokens: compressionResult?.sourceTokenEstimate || 0,
      compressionSummaryId: compressionResult?.summary?.id || null
    })
  }

  chatVerboseLog('[AIChat] 最终消息数:', messages.length, '预估tokens:', contextManager.estimateHistoryTokens(messages), '上下文构建:', perfProfile.contextBuildMs, 'ms')
  taskRuns.event(runRef, 'model_context_profile', {
    messageCount: messages.length,
    estimatedTokens: contextManager.estimateHistoryTokens(messages),
    contextBuildMs: perfProfile.contextBuildMs,
    systemPromptChars: systemPrompt.length,
    extraSystemCount: contextExtraSystemMessages.length,
    runtimePromptMode: 'stable-full',
    includeProjectContext,
    includeDesignStyleContext,
    promptCacheLayout: 'stable-system-tail-runtime',
    cachePrefixPreserved: contextPayload.policy?.preserveCachePrefix === true,
    cachePrefixFallback: contextPayload.policy?.cachePrefixFallback === true,
    historyWindowMode: 'compression-epoch',
    historyEpochTokens: epochWindow?.epochTokens || 0,
    historyCoveredMessageIndex: epochWindow?.coveredMessageIndex ?? -1,
    historyCacheEpochSummaryId: cacheEpochContext?.anchorSummary?.id || null,
    historyCacheEpochSummaryCount: cacheEpochContext?.summaryCount || 0,
    historyTrimmedMessages: epochWindow?.trimmedCount || 0,
    completedTurnProjectionApplied: historyProjection.applied,
    completedTurnProjectionReason: historyProjection.reason,
    modelTransitionDetected: modelTransition.detected,
    modelTransitionSwitched: modelTransition.switched,
    previousModel: modelTransition.previousModel || '',
    currentModel: modelId || modelName || '',
    completedTurnsCollapsed: historyProjection.collapsedTurns,
    completedTurnMessagesRemoved: historyProjection.removedMessages,
    completedTurnToolMessagesRemoved: historyProjection.removedToolMessages,
    completedTurnReasoningCharsRemoved: historyProjection.removedReasoningChars,
    tailGuidanceCount: dynamicRuntimeMessages.length,
    extraSystemChars: 0,
    tailGuidanceChars: contextTailGuidance.length
  })

  // 记录工具调用
  const toolCallsRecord = []
  let modelAuthoredOperationMemo = null
  const explorationNudgeKeys = new Set()
  let activeApiFormat = apiFormat
  function pushInternalInstruction(messages, content) {
    if (apiFormat === 'anthropic') {
      const text = [
        '【内部工作流指令】',
        '这是系统给你的执行控制指令，不是用户发言。最终回复里禁止提到内部机制。',
        content
      ].join('\n')
      const last = messages[messages.length - 1]
      if (last && last.role === 'tool') {
        try {
          const payload = JSON.parse(String(last.content || '{}'))
          last.content = JSON.stringify({ ...payload, internal_next_instruction: content })
        } catch {
          last.content = `${String(last.content || '')}\n\ninternal_next_instruction: ${content}`.trim()
        }
        return
      }
      const lastHasToolResult = last && last.role === 'user' && Array.isArray(last.content) && last.content.some(part => part?.type === 'tool_result')
      if (last && last.role === 'user' && !lastHasToolResult) {
        if (Array.isArray(last.content)) {
          last.content.push({ type: 'text', text })
        } else {
          last.content = `${String(last.content || '')}\n\n${text}`.trim()
        }
      } else {
        messages.push({ role: 'user', content: text })
      }
      return
    }
    messages.push({
      role: 'system',
      content: [
        '【内部工作流指令】',
        '这是系统给你的执行控制指令，不是用户发言。',
        '最终回复里禁止提到“用户指出”“最终质检未通过”“统一工程工作流”“内部指令”等内部机制。',
        content
      ].join('\n')
    })
  }

  function consumeInterjectBeforeContinue() {
    const interjectItems = interjectRunner.takePendingInterjectMessages(projectId)
    if (!interjectItems.length) return false
    const contentLines = interjectItems
      .map(item => String(item.content || '').trim())
      .filter(Boolean)
    if (!contentLines.length) return false
    const injectedContent = [
      '【消息注入】用户在当前 AI 执行过程中追加了新的指令。',
      '请先尊重已经完成的工具结果，不要重启整轮任务；从下一步开始吸收这些指令，必要时调整后续工具选择、修改范围和最终回复。',
      ...contentLines.map((text, index) => `注入消息 ${index + 1}：${text}`)
    ].join('\n')
    const oldestCreatedAt = interjectItems.reduce((earliest, item) => {
      const t = Number(item.createdAt || 0)
      return t > 0 && t < earliest ? t : earliest
    }, Date.now())
    const entry = {
      role: 'user',
      content: injectedContent,
      interject: true,
      itemIds: interjectItems.map(item => item.itemId),
      enqueuedAt: Date.now(),
      time: oldestCreatedAt
    }
    messages.push(entry)
    instance.messagesHistory.push(entry)
    instance._chatHistoryDirty = true
    if (projects.saveProjectChatHistoryDeferred) projects.saveProjectChatHistoryDeferred(instance)
    else projects.saveProjectChatHistory(instance)
    try {
      const mainWindow = config.getMainWindow?.() || config.mainWindow
      mainWindow?.webContents?.send('interject-consumed', {
        projectId,
        itemIds: interjectItems.map(item => item.itemId)
      })
    } catch (_) { /* 主窗口发送插队消费通知失败 */ }
    taskRuns.event(runRef, 'interject_consumed_before_continue', {
      count: interjectItems.length,
      itemIds: interjectItems.map(item => item.itemId)
    })
    console.log(`[AIChat] interject consumed before continue project=${projectId}, count=${interjectItems.length}`)
    return true
  }

  function resetAutoExecContinuationState() {
    instance.autoExecContinuationKey = ''
    instance.autoExecContinuationCount = 0
  }

  function normalizeChoiceOption(option, index) {
    if (!option || typeof option !== 'object' || Array.isArray(option)) return null
    const label = String(option.label ?? '').trim()
    const value = String(option.value ?? '').trim()
    const desc = String(option.desc ?? option.description ?? '').trim()
    const isGeneric = value => /^(?:选项|方案)\s*[#：:]?\s*\d+$|^choice[_-]?\d+$/i.test(String(value || '').trim())
    if (!label || isGeneric(label) || !value || desc.length < 6) return null
    return {
      ...option,
      label,
      value,
      desc
    }
  }

  /** 只透传模型明确给出的完整选项，不从 value 猜标题或说明。 */
  function normalizeWebUiChoiceArgs(args = {}) {
    if (!args || typeof args !== 'object') return args
    if (!Array.isArray(args.options)) {
      return { ...args, options: [], _choiceValidation: { valid: false, reason: 'options 必须是数组' } }
    }
    const normalized = args.options.map(normalizeChoiceOption)
    const invalidIndexes = normalized.map((item, index) => item ? -1 : index).filter(index => index >= 0)
    const options = normalized.filter(Boolean)
    const valid = args._choiceValidation?.valid !== false && invalidIndexes.length === 0 && options.length >= 2 && options.length <= 3
    return {
      ...args,
      options,
      _choiceValidation: {
        valid,
        invalidIndexes,
        reason: valid ? '' : '每个选项都必须由模型提供非占位 label、value，以及至少 6 个字的 desc（做什么、影响或取舍理由）；选项总数必须为 2 到 3 个。'
      }
    }
  }

  function normalizeWebUiPlanArgs(args = {}) {
    return args
  }

  function normalizeToolCallForPlanWorkflow(tc) {
    const toolName = tc?.function?.name || ''
    if (toolName !== 'ask_user_choice' && toolName !== 'confirm_plan') return tc
    const toolArgs = parseToolArgs(tc?.function?.arguments, { fallback: {} }).args
    const normalizedArgs = toolName === 'ask_user_choice'
      ? normalizeWebUiChoiceArgs(toolArgs)
      : normalizeWebUiPlanArgs(toolArgs)
    return {
      ...tc,
      function: {
        ...tc.function,
        arguments: JSON.stringify(normalizedArgs)
      }
    }
  }

  let latestPromptStability = null

  function createCacheUsageTracker() {
    const total = {
      requests: 0,
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      cachedTokens: 0,
      cacheWriteTokens: 0,
      cacheMissTokens: 0
    }
    let current = null
    let latest = null

    function makePayload(phase, extra = {}) {
      const currentUsage = extra.current && typeof extra.current === 'object' ? extra.current : {}
      const currentRequestRate = calculatePromptCacheRate(currentUsage)
      const latestRequestRate = currentRequestRate === null ? latest?.cacheRate : currentRequestRate
      const effective = { ...total }
      for (const key of ['inputTokens', 'outputTokens', 'totalTokens', 'cachedTokens', 'cacheWriteTokens', 'cacheMissTokens']) {
        effective[key] += Number(currentUsage[key] || 0)
      }
      const calculatedCacheRate = calculatePromptCacheRate(effective)
      const cacheRate = calculatedCacheRate === null ? null : Math.round(calculatedCacheRate)
      const costEstimate = estimateModelCostForUsage(effective, modelConfig, modelId)
      return {
        projectId,
        phase,
        ...total,
        cacheRate,
        latestRequestCacheRate: Number.isFinite(latestRequestRate) ? Math.round(latestRequestRate) : null,
        latestRequestCachedTokens: Number(currentUsage.cachedTokens || latest?.cachedTokens || 0),
        latestRequestInputTokens: Number(currentUsage.inputTokens || latest?.inputTokens || 0),
        costEstimate,
        costSupported: !!getModelCostProfileForUsage(modelConfig, modelId, effective),
        supported: total.cachedTokens > 0 || total.cacheWriteTokens > 0 || total.cacheMissTokens > 0,
        ...extra
      }
    }

    function send(phase, extra = {}) {
      webContents?.send('ai-cache-usage', makePayload(phase, extra))
    }

    return {
      start(label = '') {
        current = {
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
          cachedTokens: 0,
          cacheWriteTokens: 0,
          cacheMissTokens: 0
        }
        send('request-start', { label })
      },
      record(rawUsage, label = '') {
        const normalized = normalizeCacheUsage(rawUsage)
        if (!normalized || !current) return
        for (const key of Object.keys(current)) {
          current[key] = Math.max(current[key], normalized[key] || 0)
        }
        send('request-usage', { label, current: { ...current } })
      },
      finish(label = '') {
        if (!current) return
        const inputTokens = Number(current.inputTokens || 0)
        const cachedTokens = Number(current.cachedTokens || 0)
        const requestCacheRate = calculatePromptCacheRate(current)
        taskRuns.event(runRef, 'model_cache_usage', {
          label,
          ...current,
          cacheRate: requestCacheRate === null ? null : Number(requestCacheRate.toFixed(2))
        })
        const localPrefixRate = Number(latestPromptStability?.cachePrefix?.reusablePercent)
        if (
          Number.isFinite(localPrefixRate) &&
          localPrefixRate >= 90 &&
          Number.isFinite(requestCacheRate) &&
          requestCacheRate < 30
        ) {
          taskRuns.event(runRef, 'prompt_cache_route_anomaly', {
            label,
            localPrefixRate: Number(localPrefixRate.toFixed(2)),
            upstreamCacheRate: Number(requestCacheRate.toFixed(2)),
            inputTokens,
            cachedTokens,
            diagnosis: 'stable_local_prefix_but_low_upstream_cache'
          })
        }
        latest = {
          label,
          inputTokens,
          cachedTokens,
          cacheRate: requestCacheRate,
          observedAt: Date.now()
        }
        try {
          cloudTokenUsage.recordUsage({
            usage: current,
            modelConfig,
            modelId,
            projectId,
            requestId,
            taskType: label === 'tool-loop' ? 'tool_loop' : 'chat',
            source: 'ai-chat'
          })
        } catch (error) {
          console.warn('[AIChat] cloud token usage record failed:', error.message)
        }
        total.requests += 1
        for (const key of ['inputTokens', 'outputTokens', 'totalTokens', 'cachedTokens', 'cacheWriteTokens', 'cacheMissTokens']) {
          total[key] += current[key] || 0
        }
        current = null
        send('request-done', { label })
      },
      getLatest() {
        return latest ? { ...latest } : null
      },
      final() {
        send('done')
      },
      fail(error = '') {
        send('error', { error })
      }
    }
  }

  const cacheUsageTracker = createCacheUsageTracker()
  const toolFailureRecovery = createToolFailureRecoveryTracker()

  function buildStreamRequestBody(includeUsage = true, includePromptCache = true) {
    return buildModelRequestBody(modelConfig, modelId, messages, {
      stream: true,
      // 工具表属于缓存前缀。连续失败后如果把 tools 整段删除，会让下一次
      // 请求从前部发生变化，直接击穿已经建立的前缀缓存。
      // 停止执行由运行时拦截和末尾恢复指令负责，工具 schema 始终保持稳定。
      includeTools: true,
      endpoint: apiEndpoint,
      disabledTools: disabledWorkbenchTools,
      includeUsage,
      promptCache: includePromptCache,
      userMessage: message,
      ...promptCacheScope
    })
  }

  function estimateRequestBodyTokens(body) {
    const serialized = stableJsonStringify(body)
    return contextManager?.estimateTokens
      ? contextManager.estimateTokens(serialized)
      : Math.ceil(serialized.length / 4)
  }

  function compactSameTurnForBudget(label = '') {
    const beforeBody = buildStreamRequestBody(false, true)
    const beforeTokens = estimateRequestBodyTokens(beforeBody)
    if (beforeTokens <= requestContextBudget.hardInputTokens) return { compacted: false, beforeTokens }

    let latestUserIndex = -1
    for (let index = messages.length - 1; index >= 0; index--) {
      if (messages[index]?.role === 'user' && !messages[index]?._deepseekBridge) {
        latestUserIndex = index
        break
      }
    }
    if (latestUserIndex < 0) return { compacted: false, beforeTokens }

    const stablePrefix = messages.slice(0, latestUserIndex).filter(item => item?.role === 'system')
    const currentUser = messages[latestUserIndex]
    const ledger = []
    for (const item of messages.slice(latestUserIndex + 1)) {
      if (item?.role === 'assistant' && Array.isArray(item.tool_calls)) {
        for (const call of item.tool_calls) {
          const name = call?.function?.name || 'tool'
          const args = String(call?.function?.arguments || '{}').slice(0, 600)
          ledger.push(`调用 ${name}：${args}`)
        }
      } else if (item?.role === 'tool') {
        ledger.push(`结果 ${item.tool_call_id || ''}：${String(item.content || '').slice(0, 1200)}`)
      } else if (item?.role === 'system' && item.content) {
        ledger.push(`运行约束：${String(item.content).slice(0, 800)}`)
      }
      if (ledger.length >= 40) break
    }
    const checkpoint = {
      role: 'system',
      content: [
        '【本轮执行检查点】',
        '请求已接近当前模型的上下文硬上限。系统只压缩发给模型的执行过程，完整聊天和工具记录仍保存在本地。',
        '继续完成最新用户任务；以下为本轮已执行证据，不要重复已成功的操作：',
        ...ledger.map(line => `- ${line}`)
      ].join('\n')
    }
    messages.splice(0, messages.length, ...stablePrefix, currentUser, checkpoint)
    const afterTokens = estimateRequestBodyTokens(buildStreamRequestBody(false, true))
    taskRuns.event(runRef, 'model_context_checkpoint', {
      label,
      modelContextTokens: requestContextBudget.maxContextTokens,
      hardInputTokens: requestContextBudget.hardInputTokens,
      beforeTokens,
      afterTokens,
      toolEvidenceCount: ledger.length
    })
    chatVerboseLog('[ContextBudget] 本轮执行检查点:', label, beforeTokens, '->', afterTokens)
    return { compacted: true, beforeTokens, afterTokens }
  }

  function buildChatCompletionsFallbackEndpoint() {
    if (!/\/responses\/?$/i.test(apiEndpoint)) return ''
    return apiEndpoint.replace(/\/responses\/?$/i, '/chat/completions')
  }

  function isUnsupportedResponsesEndpointError(text = '') {
    return /\/responses|responses api|response endpoint|unsupported endpoint|not found|404|unknown url|unknown path|invalid endpoint/i.test(String(text || ''))
  }

  // 会话级 fallback 记忆：一旦某端点+模型组合触发了 responses -> openai 的 fallback，
  // 后续请求直接使用 openai 格式，避免每次都先尝试 responses 再 fallback 导致 cache 完全失效。
  const responsesFallbackMemory = new Map()
  function shouldSkipResponsesFormat() {
    const key = `${apiEndpoint}|${modelId || modelConfig?.modelId || modelConfig?.modelName || ''}`
    return responsesFallbackMemory.get(key) === true
  }
  function rememberResponsesFallback() {
    const key = `${apiEndpoint}|${modelId || modelConfig?.modelId || modelConfig?.modelName || ''}`
    responsesFallbackMemory.set(key, true)
  }

  function getStreamUsageSupportKey() {
    return [
      String(apiEndpoint || '').replace(/[?#].*$/, '').toLowerCase(),
      String(modelId || modelConfig?.modelId || modelConfig?.modelName || '').toLowerCase()
    ].join('|')
  }

  function getPromptStabilityScopeKey() {
    return [
      String(apiEndpoint || '').replace(/[?#].*$/, '').toLowerCase(),
      String(modelId || modelConfig?.modelId || modelConfig?.modelName || '').toLowerCase(),
      String(promptCacheScope.projectId || ''),
      String(promptCacheScope.branchId || ''),
      String(promptCacheScope.sessionId || '')
    ].join('|')
  }

  function emitPromptStability(body, label = '') {
    try {
      const stability = observePromptStability(body, {
        scopeKey: getPromptStabilityScopeKey(),
        label
      })
      latestPromptStability = stability
      taskRuns.event(runRef, 'prompt_stability', {
        label,
        firstSeen: stability.firstSeen,
        stable: stability.stable,
        changedSegments: stability.changedSegments,
        cachePrefix: stability.cachePrefix
      })
      webContents?.send('ai-cache-usage', {
        projectId,
        phase: 'stability',
        label,
        stability
      })
    } catch (error) {
      console.warn('[PromptStability] observe failed:', error.message)
    }
  }

  async function fetchModelStream(label = '') {
    compactSameTurnForBudget(label)
    const usageSupportKey = getStreamUsageSupportKey()
    activeApiFormat = apiFormat
    async function request(includeUsage, includePromptCache = true, override = {}) {
      const endpoint = override.endpoint || apiEndpoint
      const body = override.body || buildStreamRequestBody(includeUsage, includePromptCache)
      const bodyProfile = buildRequestBodyProfile(body)
      if (label === 'initial' && !perfProfile.initialRequestProfile) {
        perfProfile.initialRequestProfile = bodyProfile
      } else if (label && label.startsWith('continue-')) {
        perfProfile.continueProfiles.push({ label, ...bodyProfile })
      }
      taskRuns.event(runRef, 'model_request_body_profile', {
        label,
        endpointFormat: activeApiFormat,
        includeUsage,
        includePromptCache,
        ...bodyProfile
      })
      emitPromptStability(body, label)
      const serializedBody = stableJsonStringify(body)
      const avoidPersistentConnection = shouldAvoidPersistentModelConnection(modelConfig, endpoint, modelId)
      try {
        return await retryPreResponseSocketClose(async ({ attempt, connectionClose }) => {
          const headers = buildApiHeaders(modelConfig, endpoint, {
            stream: true,
            modelId,
            promptCache: includePromptCache,
            ...promptCacheScope
          })
          if (avoidPersistentConnection || connectionClose) headers.connection = 'close'
          return fetch(endpoint, buildApiFetchOptions(modelConfig, endpoint, {
            method: 'POST',
            headers,
            body: serializedBody,
            connectionScope: getPromptStabilityScopeKey(),
            modelId,
            promptCache: includePromptCache,
            signal
          }))
        }, {
          delayMs: 150,
          maxAttempts: avoidPersistentConnection ? 3 : 2,
          connectionClose: avoidPersistentConnection,
          onRetry: (error, retry) => {
            taskRuns.event(runRef, 'model_pre_response_socket_retry', {
              label,
              endpointFormat: activeApiFormat,
              attempt: retry.attempt,
              maxAttempts: retry.maxAttempts,
              requestProfile: bodyProfile
            })
          }
        })
      } catch (error) {
        throwIfAborted(signal)
        throw new Error(formatModelTransportError(error, endpoint, modelConfig), { cause: error })
      }
    }
    async function requestChatFallback(includeUsage, includePromptCache = true) {
      const fallbackEndpoint = buildChatCompletionsFallbackEndpoint()
      if (!fallbackEndpoint) return null
      const body = buildModelRequestBody(modelConfig, modelId, messages, {
        stream: true,
        includeTools: true,
        endpoint: fallbackEndpoint,
        disabledTools: disabledWorkbenchTools,
        includeUsage,
        promptCache: includePromptCache,
        userMessage: message,
        forceChatCompletions: true,
        disableReasoningOptions: true,
        ...promptCacheScope
      })
      return request(includeUsage, includePromptCache, { endpoint: fallbackEndpoint, body })
    }
    const usageProbeEnabled = shouldProbeStreamUsageByDefault(modelConfig, apiEndpoint, modelId, apiFormat)
    const shouldProbeUsage = usageProbeEnabled && !unsupportedStreamUsageKeys.has(usageSupportKey)
    taskRuns.event(runRef, 'model_stream_usage_probe', {
      label,
      usageProbeEnabled,
      shouldProbeUsage,
      usageSupportKey
    })
    if (!shouldProbeUsage) {
      webContents?.send('ai-cache-usage', {
        projectId,
        phase: 'unsupported',
        label,
        supported: false,
        message: '当前模型接口未返回缓存用量'
      })
    }
    let res
    try {
      // 如果之前已触发过 responses -> openai fallback，直接使用 chat completions 格式
      if (apiFormat === 'openai-responses' && shouldSkipResponsesFormat()) {
        const preFallbackRes = await requestChatFallback(shouldProbeUsage, true)
        if (preFallbackRes?.ok) {
          activeApiFormat = 'openai'
          taskRuns.event(runRef, 'model_responses_preemptive_chat_fallback', {
            label,
            endpointFormat: 'openai-responses',
            fallbackFormat: 'openai',
            reason: 'remembered_fallback'
          })
          return preFallbackRes
        }
      }
      res = await request(shouldProbeUsage, true)
    } catch (requestError) {
      if (apiFormat === 'openai-responses' && isPreResponseSocketCloseError(requestError)) {
        const fallbackRes = await requestChatFallback(shouldProbeUsage, true)
        if (fallbackRes?.ok) {
          activeApiFormat = 'openai'
          rememberResponsesFallback()
          taskRuns.event(runRef, 'model_responses_socket_chat_fallback', {
            label,
            endpointFormat: 'openai-responses',
            fallbackFormat: 'openai',
            requestProfile: label === 'initial'
              ? perfProfile.initialRequestProfile
              : (perfProfile.continueProfiles.at(-1) || null)
          })
          return fallbackRes
        }
        if (fallbackRes) {
          const fallbackErrorText = await fallbackRes.text()
          throw new Error(formatApiHttpError(fallbackRes.status, fallbackErrorText, modelConfig), { cause: requestError })
        }
      }
      throw requestError
    }
    if (!res.ok) {
      const errorText = await res.text()
      if (apiFormat === 'openai-responses' && isUnsupportedResponsesEndpointError(errorText)) {
        const fallbackRes = await requestChatFallback(shouldProbeUsage, true)
        if (fallbackRes?.ok) {
          activeApiFormat = 'openai'
          rememberResponsesFallback()
          return fallbackRes
        }
        if (fallbackRes) {
          const fallbackErrorText = await fallbackRes.text()
          throw new Error(formatApiHttpError(fallbackRes.status, fallbackErrorText, modelConfig))
        }
      }
      if (shouldProbeUsage && /stream_options|include_usage|unknown parameter|unsupported parameter|extra inputs/i.test(errorText)) {
        unsupportedStreamUsageKeys.add(usageSupportKey)
        res = await request(false, true)
        if (!res.ok) {
          const retryErrorText = await res.text()
          if (/prompt_cache_key|x-grok-conv-id|cache key|cache_key|unknown parameter|unsupported parameter|extra inputs/i.test(retryErrorText)) {
            res = await request(false, false)
            if (res.ok) return res
          }
          throw new Error(formatApiHttpError(res.status, retryErrorText, modelConfig))
        }
        webContents?.send('ai-cache-usage', {
          projectId,
          phase: 'unsupported',
          label,
          supported: false,
          message: '当前模型接口未返回缓存用量'
        })
        return res
      }
      if (/prompt_cache_key|x-grok-conv-id|cache key|cache_key/i.test(errorText)) {
        res = await request(shouldProbeUsage, false)
        if (res.ok) return res
      }
      // GLM / OpenAI 返回 400 InvalidParameter：可能是 tool_calls 与 tool 结果不配对导致。
      // 尝试清理 messages 中悬挂的 tool_calls 后重试一次。
      if (res.status === 400 && /InvalidParameter|invalid_parameter|tool_call|tool_calls/i.test(errorText)) {
        console.warn('[AIChat] 收到 400 InvalidParameter，尝试清理 tool_calls 配对后重试')
        try {
          repairToolCallAdjacency(instance.messagesHistory, {
            error: '模型接口返回 400，工具调用历史可能不配对，已自动修复',
            aborted: false
          })
          if (projects.saveProjectChatHistoryDeferred) projects.saveProjectChatHistoryDeferred(instance)
          else projects.saveProjectChatHistory(instance)
          // 重新构建请求体并重试一次
          const retryRes = await request(shouldProbeUsage, true)
          if (retryRes.ok) return retryRes
          const retryErrorText = await retryRes.text()
          throw new Error(formatApiHttpError(retryRes.status, retryErrorText, modelConfig))
        } catch (retryErr) {
          if (retryErr.message && retryErr.message.startsWith('API错误')) throw retryErr
          console.warn('[AIChat] 400 重试失败:', retryErr.message)
        }
      }
      throw new Error(formatApiHttpError(res.status, errorText, modelConfig))
    }
    return res
  }

  const resolvePath = (inputPath) => {
    if (!inputPath) return projectPath
    // 标准化路径：将正斜杠转为反斜杠（Windows）
    let normalizedPath = inputPath.replace(/\//g, '\\')
    chatVerboseLog('[AIChat] resolvePath 输入:', inputPath, '标准化:', normalizedPath)
    if (path.isAbsolute(normalizedPath)) return normalizedPath
    return path.join(projectPath, normalizedPath)
  }

  // 注入触发标志：catch 块里检测到 interject 中断 + 队列非空时置 true，
  // finally 正常清理后异步重启 handleSendMessage，让 consumeInterjectBeforeContinue 消费注入消息。
  let pendingInterjectRestart = false

  try {
    throwIfAborted(signal)
    // 构建 API URL
    // API endpoint is resolved before the request so Anthropic-compatible URLs are not forced into /chat/completions.

    // 初始请求前也消费待注入消息；避免 AI 在第一轮 thinking/工具时用户插队却等不到 continue。
    consumeInterjectBeforeContinue()
    interjectRunner.setRunState(projectId, 'streaming')
    // ===== 流式API请求 =====
    const initialApiWatchdog = startApiWatchdog('模型接口')
    const initialProgressHeartbeat = startVisibleProgressHeartbeat('initial')
    let response
    try {
      cacheUsageTracker.start('initial')
      response = await fetchModelStream('initial')
      perfProfile.initialHeadersMs = Date.now() - requestStartedAt
      taskRuns.event(runRef, 'model_initial_response_headers', {
        headersMs: perfProfile.initialHeadersMs,
        requestProfile: perfProfile.initialRequestProfile
      })
      initialApiWatchdog.touch('stream')
    } catch (error) {
      stopApiWatchdog(initialApiWatchdog)
      stopVisibleProgressHeartbeat(initialProgressHeartbeat)
      throwIfAborted(signal)
      cacheUsageTracker.fail(error.message)
      throw error
    }

    // 处理流式响应
    const reader = response.body.getReader()
    const decoder = new TextDecoder()

    let fullContent = ''
    let fullReasoningContent = ''
    let fullReasoningDetails = []
    let latestAnthropicContentBlocks = null
    let toolCallsData = []
    let buffer = ''
    let rawInitialGeminiStream = ''
    let hasToolCalls = false
    let streamState = createAnthropicStreamState()
    const allowContentAsProgressNarration = false
    let progressParser = createProgressStatusParser(status => {
      sendVisibleProgressStatus(status)
    })
    let progressNarration = createProgressNarrationTracker(webContents, projectId)
    let toolArgumentProgress = createToolArgumentProgressTracker(webContents, projectId, {
      chatSessionId: instance?.chatSessionId || instance?.collaborationSessionId || ''
    })
    let finalReplyArmed = false
    let finalStreamActive = false
    let initialFirstChunkSeen = false

    function sendFinalDelta(content) {
      const text = String(content || '')
      if (!text) return
      finalStreamActive = true
      webContents?.send('ai-final-delta', { projectId, content: text })
    }

    function resetFinalDelta() {
      if (!finalStreamActive) return
      finalStreamActive = false
      webContents?.send('ai-final-delta', { projectId, reset: true })
    }

    function consumeVisibleContentForFinalStream(visibleContent = '') {
      const text = String(visibleContent || '')
      if (!text) return
      fullContent += text
      if (finalReplyArmed) sendFinalDelta(text)
    }

    webContents?.send('ai-status', { projectId, status: 'streaming' })
    try { require('./desktop-pet').notifyAiStatus('running') } catch (_) { /* ignore */ }

    while (true) {
      throwIfAborted(signal)
      const { done, value } = await reader.read()
      if (done) break
      markStreamActivity()
      initialApiWatchdog.touch('stream')
      if (!initialFirstChunkSeen) {
        initialFirstChunkSeen = true
        perfProfile.initialFirstChunkMs = Date.now() - requestStartedAt
        taskRuns.event(runRef, 'model_initial_first_chunk', {
          firstChunkMs: perfProfile.initialFirstChunkMs,
          headersMs: perfProfile.initialHeadersMs,
          requestProfile: perfProfile.initialRequestProfile
        })
      }

      const decodedInitialChunk = decoder.decode(value, { stream: true })
      if (activeApiFormat === 'gemini') rawInitialGeminiStream += decodedInitialChunk
      buffer += decodedInitialChunk

      // 处理 SSE 数据
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''

      for (const line of lines) {
        if (!line.trim() || !line.startsWith('data:')) continue

        const data = line.slice(5).trim()
        if (data === '[DONE]') continue

        try {
          const json = JSON.parse(data)
          const streamError = createStreamPayloadError(json)
          if (streamError) throw streamError
          const delta = parseModelStreamEvent(json, streamState, activeApiFormat)

          if (!delta) continue
          markStreamActivity()
          if (delta.usage) cacheUsageTracker.record(delta.usage, 'initial')
          if (isMiniMaxM3Model(modelConfig, modelId) && Array.isArray(delta.reasoning_details)) {
            fullReasoningDetails.push(...delta.reasoning_details)
          }
          if (isMiniMaxM3Model(modelConfig, modelId) && Array.isArray(delta.content_blocks)) {
            latestAnthropicContentBlocks = delta.content_blocks
          }

          if (delta.reasoning_content) {
            fullReasoningContent += delta.reasoning_content
            sendNativeReasoningDelta(delta.reasoning_content)
          }

          // 流式发送正文内容
          if (delta.content) {
            const visibleContent = progressParser.process(delta.content)
            if (visibleContent) {
              consumeVisibleContentForFinalStream(visibleContent)
            }
          }

          // 处理工具调用（流式累积）
          if (hasMeaningfulToolCallDelta(delta.tool_calls)) {
            finishNativeReasoningStream()
            resetFinalDelta()
            finalReplyArmed = false
            if (!hasToolCalls) {
              progressNarration.flush({ discard: progressParser.hasEmittedStatus() })
              if (allowContentAsProgressNarration && !progressParser.hasEmittedStatus() && !progressNarration.hasProgress() && fullContent.trim()) {
                progressNarration.markFromText(fullContent)
                fullContent = ''
              }
            }
            hasToolCalls = true
            for (const tc of delta.tool_calls) {
              const idx = tc.index ?? toolCallsData.length
              while (toolCallsData.length <= idx) {
                toolCallsData.push({ id: '', type: 'function', function: { name: '', arguments: '' } })
              }
              if (tc.id) toolCallsData[idx].id = tc.id
              if (tc.function?.name) toolCallsData[idx].function.name = tc.function.name
              if (tc.function?.arguments) {
                toolCallsData[idx].function.arguments += tc.function.arguments
                toolArgumentProgress.update(toolCallsData[idx])
              }
              previewStreamingToolCall(toolCallsData[idx])
            }
          }
        } catch (e) {
          if (e?.isModelStreamPayloadError) throw e
          // 忽略解析错误
        }
      }
    }
    if (activeApiFormat === 'gemini' && rawInitialGeminiStream.trim()) {
      for (const json of parseGeminiStreamPayload(rawInitialGeminiStream)) {
        const streamError = createStreamPayloadError(json)
        if (streamError) throw streamError
        const delta = parseModelStreamEvent(json, streamState, activeApiFormat)
        if (!delta) continue
        markStreamActivity()
        if (delta.usage) cacheUsageTracker.record(delta.usage, 'initial')
        if (delta.reasoning_content) {
          fullReasoningContent += delta.reasoning_content
          sendNativeReasoningDelta(delta.reasoning_content)
        }
        if (delta.content) {
          const visibleContent = progressParser.process(delta.content)
          if (visibleContent) consumeVisibleContentForFinalStream(visibleContent)
        }
      }
    }
    stopApiWatchdog(initialApiWatchdog)
    stopVisibleProgressHeartbeat(initialProgressHeartbeat)
    cacheUsageTracker.finish('initial')

    interjectRunner.setRunState(projectId, 'idle')
    // 工具轮间隙保持忙碌态，不在此把桌宠打回 idle
    try {
      require('./desktop-pet').notifyAiStatus(hasToolCalls ? 'tools' : 'streaming')
    } catch (_) { /* ignore */ }
    progressNarration.flush({ discard: progressParser.hasEmittedStatus() || !hasToolCalls })
    const remainingInitialContent = progressParser.flush()
    if (remainingInitialContent) {
      consumeVisibleContentForFinalStream(remainingInitialContent)
    }
    if (allowContentAsProgressNarration && toolCallsData.length > 0 && fullContent.trim()) {
      resetFinalDelta()
      finalReplyArmed = false
      progressNarration.markFromText(fullContent)
      fullContent = ''
    }
    toolCallsData.forEach(tc => toolArgumentProgress.complete(tc))
    chatVerboseLog('[AIChat] 流式结束, hasToolCalls:', hasToolCalls, 'content长度:', fullContent.length)

    // 循环处理工具调用（直到AI不再返回工具调用）
    let continueLoop = hasToolCalls && toolCallsData.length > 0
    let loopCount = 0
    let noToolQualityRetryCount = 0
    let lastModelReplyHadNoToolCalls = false
    let postWriteVerifyRetryUsed = false
    let runtimeGateContinuationUsed = false
    const projectReviewTask = isProjectReviewIntent(message)
    let currentToolSectionStatus = ''
    let currentToolSectionRealToolCount = 0
    while (true) {
    while (continueLoop) {
      throwIfAborted(signal)
      loopCount++
      chatVerboseLog('[AIChat] 工具调用循环第', loopCount, '次, 工具数量:', toolCallsData.length)

      // 每轮重置进度状态，确保强制校验不被旧状态蒙蔽
      progressParser.resetLastStatus()

      // 普通正文不提前发到展开区，避免最终正文重复显示。

      const progressStatusFromTool = emitProgressToolStatus(toolCallsData, progressParser)
      let progressStatusBeforeTools = progressStatusFromTool || progressParser.getLastStatus() || progressNarration.getLastNarration()
      const hasRealToolCallsInBatch = toolCallsData.some(tc => isBusinessToolName(tc?.function?.name || ''))
      if (progressStatusBeforeTools && progressStatusBeforeTools !== currentToolSectionStatus) {
        currentToolSectionStatus = progressStatusBeforeTools
        currentToolSectionRealToolCount = 0
      }

      if (toolCallsData.length > 0 && hasRealToolCallsInBatch) {
        if (shouldRerouteToolStatusMismatch(toolCallsData, progressStatusBeforeTools)) {
          taskRuns.event(runRef, 'tool_status_mismatch_observed', {
            loopCount,
            progressStatus: progressStatusBeforeTools,
            tools: toolCallsData.map(tc => tc?.function?.name).filter(Boolean)
          })
        }
        if (shouldRerouteManualLocationFirst(toolCallsData, toolCallsRecord, message)) {
          taskRuns.event(runRef, 'navigation_first_observed', {
            loopCount,
            tools: toolCallsData.map(tc => tc?.function?.name).filter(Boolean)
          })
        }
        if (shouldReroutePrematureModification(toolCallsData, toolCallsRecord, message)) {
          taskRuns.event(runRef, 'modification_preflight_observed', {
            loopCount,
            tools: toolCallsData.map(tc => tc?.function?.name).filter(Boolean)
          })
        }
      }

      if (toolCallsData.length > 0) {
        const realToolCountInBatch = toolCallsData.filter(tc => {
          const name = tc?.function?.name || ''
          return isBusinessToolName(name)
        }).length
        noToolQualityRetryCount = 0
        lastModelReplyHadNoToolCalls = false
        if (realToolCountInBatch > 0) {
          webContents?.send('ai-status', { projectId, status: 'using_tools', count: realToolCountInBatch })
        }
        toolCallsData = toolCallsData.map(normalizeToolCallForPlanWorkflow)

        // 保存到历史消息时不包含正文片段（避免AI后续重复输出）
        const assistantMsg = {
          role: 'assistant',
          content: null,  // 正文片段已通过 ai-intermediate-content 显示，不保存到历史
          ...assistantModelMetadata,
          time: new Date().toISOString(),
          tool_calls: toolCallsData.filter(tc => tc.id).map(tc => ({
            id: tc.id,
            type: 'function',
            function: { name: tc.function.name, arguments: tc.function.arguments }
          }))
        }
        if (fullReasoningContent) assistantMsg.reasoning_content = fullReasoningContent
        if (isMiniMaxM3Model(modelConfig, modelId) && fullReasoningDetails.length) assistantMsg.reasoning_details = fullReasoningDetails
        if (isMiniMaxM3Model(modelConfig, modelId) && activeApiFormat === 'anthropic' && latestAnthropicContentBlocks) assistantMsg.anthropic_content = latestAnthropicContentBlocks
        const progressStatus = progressParser.getLastStatus() || progressNarration.getLastNarration() || progressStatusBeforeTools
        if (progressStatus) assistantMsg.progressStatus = progressStatus
        const requestMessageCountBeforeToolBatch = messages.length
        const historyBaseLen = instance.messagesHistory.length
        const bridgeDeepSeekMultiToolBatch = shouldBridgeDeepSeekMultiToolBatch(
          modelConfig,
          apiEndpoint,
          modelId,
          assistantMsg.tool_calls
        )
        messages.push(assistantMsg)
        instance.messagesHistory.push(assistantMsg)
        instance._chatHistoryDirty = true
        if (projects.saveProjectChatHistoryDeferred) projects.saveProjectChatHistoryDeferred(instance)
        else projects.saveProjectChatHistory(instance)
        taskRuns.event(runRef, 'assistant_tool_calls', {
          loopCount,
          toolCount: assistantMsg.tool_calls.length,
          tools: assistantMsg.tool_calls.map(tc => tc.function?.name).filter(Boolean),
          progressStatus,
          reasoningChars: String(assistantMsg.reasoning_content || '').length
        })

        // 并行执行所有工具调用
        const toolPromises = toolCallsData.filter(tc => tc.id).map(async (tc) => {
          const toolName = tc.function.name
          const toolArgsParseResult = parseToolArgs(tc.function.arguments, { fallback: {}, toolName })
          let toolArgs = toolArgsParseResult.args
          if (!toolArgsParseResult.ok) {
            const result = buildToolArgsParseErrorResult(toolName, toolArgsParseResult)
            // 尝试从原始参数中提取命令用于显示
            const rawStr = String(tc.function.arguments || '')
            let previewArgs = {}
            if (toolName === 'shell_run' || toolName === 'run_command') {
              // 尝试提取 command 字段
              const cmdMatch = rawStr.match(/"command"\s*:\s*"([^"]*)"/)
              if (cmdMatch) previewArgs = { command: cmdMatch[1] }
            }
            webContents?.send('tool-start', {
              projectId,
              name: toolName,
              args: previewArgs,
              toolCallId: tc.id,
              _parseError: true
            })
            taskRuns.event(runRef, 'tool_argument_parse_failed', {
              loopCount,
              toolCallId: tc.id,
              name: toolName,
              error: toolArgsParseResult.error,
              is_large_text_risk: result.is_large_text_risk || false
            })
            return { tc, toolName, toolArgs: {}, result, error: null }
          }
        if (toolName === 'ask_user_choice') toolArgs = normalizeWebUiChoiceArgs(toolArgs)
        if (toolName === 'confirm_plan') toolArgs = normalizeWebUiPlanArgs(toolArgs)

          if (toolFailureRecovery.isStopRequested() || toolFailureRecovery.shouldBlock(toolName)) {
            const result = toolFailureRecovery.isStopRequested()
              ? toolFailureRecovery.getStopBlockResult(toolName)
              : toolFailureRecovery.getBlockResult(toolName)
            webContents?.send('tool-start', {
              projectId,
              name: toolName,
              args: toolArgs,
              toolCallId: tc.id,
              _recoveryBlocked: true,
              _toolLoopStopped: toolFailureRecovery.isStopRequested()
            })
            return { tc, toolName, toolArgs, result, error: null }
          }

          if (shouldRerouteManualLocationFirst([tc], toolCallsRecord, message)) {
            taskRuns.event(runRef, 'tool_navigation_first_hint_skipped_block', {
              loopCount,
              toolCallId: tc.id,
              name: toolName
            })
          }

          try {
            throwIfAborted(signal)

            if (toolName === 'report_progress' || toolName === 'show_thinking_note') {
              const rawStatus = toolArgs.status || toolArgs.message || toolArgs.content || toolArgs.progress || toolArgs.note || ''
              const status = toolName === 'show_thinking_note'
                ? normalizePublicThinkingNote(rawStatus)
                : normalizeProgressStatus(rawStatus)
              if (status) {
                if (toolName === 'show_thinking_note') {
                  sendVisibleProgressStatus(status, {
                    preserveContent: true,
                    forceUpdate: true,
                    append: !!toolArgs.append
                  })
                } else {
                  progressParser.emitStatus(status)
                }
              }
              return {
                tc,
                toolName,
                toolArgs,
                result: {
                  success: true,
                  internal: true,
                  thinkingNote: toolName === 'show_thinking_note',
                  progressStatus: status,
                  message: toolName === 'show_thinking_note' ? 'Thinking note displayed.' : 'Progress status accepted.'
                },
                error: null
              }
            }

            if (toolName === 'start_final_reply') {
              const gate = evaluateRuntimeGateForChat({
                taskType: instance.taskType || instance.inferredTaskType || '',
                userMessage: message,
                toolCalls: toolCallsRecord,
                recoveryAttempts: Number(instance.runtimeGateRecoveryAttempts || 0)
              })
              const decision = runtimeVerificationGate.assertStartFinalReplyAllowed(gate)
              if (!decision.allowed) {
                instance.runtimeGateRecoveryAttempts = Number(instance.runtimeGateRecoveryAttempts || 0) + 1
                instance.runtimeGateOutcome = gate
                console.log('[AIChat] runtime gate blocked start_final_reply:', gate.status, gate.reasons)
                return {
                  tc,
                  toolName,
                  toolArgs,
                  result: {
                    ...decision.resultPatch,
                    recovery_attempts: instance.runtimeGateRecoveryAttempts
                  },
                  error: null
                }
              }
              instance.runtimeGateOutcome = gate
              return {
                tc,
                toolName,
                toolArgs,
                result: {
                  success: true,
                  internal: true,
                  finalReplyArmed: true,
                  runtime_gate: gate.status,
                  blocked_reason: gate.blocked_reason || undefined,
                  claim_policy: decision.resultPatch?.claim_policy,
                  message: gate.status === 'blocked'
                    ? `Final reply armed under degradation: ${gate.blocked_reason || 'blocked'}`
                    : gate.status === 'failed'
                      ? 'Final reply armed after runtime_verify failed. Explain failures; do not claim the issue is fixed.'
                      : 'Final reply stream is armed. Continue with the final answer and do not call more tools.'
                },
                error: null
              }
            }

            // 发送 tool-start 事件（前端预显示）。
            // 流式阶段不再发送预览，统一在此处发送，确保 thinking 块先于工具块。
            webContents?.send('tool-start', {
              projectId,
              name: toolName,
              args: toolArgs,
              toolCallId: tc.id
            })
            taskRuns.event(runRef, 'tool_started', {
            loopCount,
            toolCallId: tc.id,
            name: toolName,
            args: summarizeToolArgsForRunLog(toolArgs)
            })

            // 传递完整的 modelConfig 给工具执行
            const toolModelConfig = {
            apiUrl: modelConfig.apiUrl,
            apiKey: modelConfig.apiKey,
            modelName: modelConfig.modelName,
            modelId: effectiveModelId,
            modelKey: modelConfig.modelKey,
            apiFormat: modelConfig.apiFormat || modelConfig.api_format || modelConfig.apiType,
            capabilities: modelConfig.capabilities
            }

            chatVerboseLog('[AIChat] 执行工具:', toolName, 'modelConfig:', JSON.stringify({
            apiUrl: toolModelConfig.apiUrl,
            apiKey: toolModelConfig.apiKey ? '有' : '无',
            modelName: toolModelConfig.modelName,
            modelId: toolModelConfig.modelId
            }))

            const activeProjectPath = instance.projectPath || projectPath
            const result = await executeToolForProject(toolName, toolArgs, activeProjectPath, resolvePath, instance.contextManager || contextManager, projectId, toolModelConfig, {
              signal,
              userMessage: message,
              collaborationSessionId: instance.collaborationSessionId || '',
              collaborationAgentId: instance.collaborationAgentId || '',
              collaborationAgentName: instance.collaborationAgentName || '',
              collaborationReportFilePath: instance.collaborationReportFilePath || '',
              requestId
            })
            throwIfAborted(signal)
            return { tc, toolName, toolArgs, result, error: null }
          } catch (err) {
            // 工具执行失败（异常 / 中断 / 资源缺失 / 超时 等）→ 返回合成失败结果，
            // 仍然推一条 tool 消息进 messages 和 messagesHistory，保证 assistant(tool_calls)
            // 不会留下悬挂 tool_call_id。
            const isAbort = err && err.name === 'AbortError' || (signal && signal.aborted)
            const errorMessage = err && err.message ? String(err.message) : (err ? String(err) : '工具执行失败')
            const errorResult = {
              success: false,
              error: errorMessage,
              aborted: isAbort
            }
            chatVerboseLog('[AIChat] 工具执行失败:', toolName, 'id:', tc.id, isAbort ? '(已中断)' : '', 'error:', errorMessage)
            return { tc, toolName, toolArgs, result: errorResult, error: err }
          }
        })

        interjectRunner.setRunState(projectId, 'tools')
        // 用 allSettled 兜底：现在每个 promise 都不会 reject（每个 .map 内部已 try/catch），但保留保险
        const settled = await Promise.allSettled(toolPromises)
        const toolResults = []
        const cacheSafeBatchResults = []
        for (const s of settled) {
          if (s.status === 'rejected') {
            // 兜底分支：理论上不会到这里（每个 .map 内部已 try/catch）
            console.error('[AIChat] 工具 promise rejected（异常）:', s.reason)
            continue
          }
          toolResults.push(s.value)
        }
        // 注意：不在这里 throwIfAborted。即使已中断，也必须先把工具结果写入 messagesHistory，
        // 保证 assistant(tool_calls) 不会留下悬挂的 tool_call_id（Anthropic API 400 错误 2013）。

        // 处理所有结果
        let stopToolLoopForFailures = false
        for (const { tc, toolName, toolArgs, result } of toolResults) {
          if (toolName === 'start_final_reply' && result?.success !== false) {
            finalReplyArmed = true
          } else if (!isInternalUiOnlyToolName(toolName)) {
            finalReplyArmed = false
          }
          const recordEntry = { tool_call_id: tc.id, name: toolName, args: toolArgs, result }
          if (toolName === 'record_ai_operation_memo' && result?.success && !result?.skipped) {
            modelAuthoredOperationMemo = result
          }
          const modelResult = result
          toolCallsRecord.push(recordEntry)

          const modelVisibleResult = summarizeToolResultForModel(toolName, modelResult)
          const recovery = toolFailureRecovery.record(toolName, result)
          if (recovery.guidance) {
            modelVisibleResult.recovery_guidance = recovery.guidance
          }
          if (recovery.writeRestricted) {
            modelVisibleResult.recovery_mode = 'write_restricted_until_successful_read'
          }
          if (recovery.stopRequested) {
            stopToolLoopForFailures = true
          }
          // 工具失败时，在返回给模型的结果里追加修复引导，避免模型盲目重试或放弃
          if (result?.success === false && !result?.internal && !result?.aborted) {
            const fixGuidance = buildToolFailureGuidance(toolName, result)
            if (fixGuidance) {
              modelVisibleResult.next_action = fixGuidance
            }
          }
          cacheSafeBatchResults.push({
            tool_call_id: tc.id,
            name: toolName,
            arguments: toolArgs,
            result: modelVisibleResult
          })
          const toolMsg = { role: 'tool', tool_call_id: tc.id, content: JSON.stringify(modelVisibleResult) }
          messages.push(toolMsg)

          const summaryResult = summarizeToolResultForHistory(toolName, result)
          const toolMsgForHistory = { role: 'tool', tool_call_id: tc.id, content: JSON.stringify(summaryResult) }
          instance.messagesHistory.push(toolMsgForHistory)
          instance._chatHistoryDirty = true
          interjectRunner.setRunState(projectId, 'idle')
          projects.saveProjectChatHistoryDeferred?.(projectId)
          if (result?.internal) {
            continue
          }
          taskRuns.event(runRef, 'tool_finished', {
            loopCount,
            toolCallId: tc.id,
            name: toolName,
            success: result?.success !== false,
            result: summaryResult
          })

          webContents?.send('tool-result', { projectId, name: toolName, args: toolArgs, result, toolCallId: tc.id })

          if (result.status === 'user_rejected') {
            pushInternalInstruction(messages, [
              `工具 ${toolName} 被用户拒绝或取消：${result.message || '用户未授权执行。'}`,
              '这不是最终回复。请基于已完成的真实工具结果继续处理或收尾。',
              '如果本轮已经修改了文件，最终回复必须简洁说明改了什么；不要只复述这个工具状态。'
            ].join('\n'))
          } else if (result.executionMode) {
            pushInternalInstruction(messages, `用户已将后续执行模式切换为：${getExecutionModeDesc(result.executionMode)}。后续必须遵守以下规则：\n${getExecutionModeRules(result.executionMode)}`)
          }
        }
        if (stopToolLoopForFailures) {
          pushInternalInstruction(messages, toolFailureRecovery.getStopInstruction())
        }
        if (bridgeDeepSeekMultiToolBatch && cacheSafeBatchResults.length > 1) {
          const bridgeMessages = buildDeepSeekMultiToolCacheBridge(cacheSafeBatchResults)
          messages.splice(requestMessageCountBeforeToolBatch, messages.length - requestMessageCountBeforeToolBatch, ...bridgeMessages)
          // 同步替换 messagesHistory：把原始 assistant(tool_calls) + N 条 tool 消息
          // 替换成桥接后的两条消息，保证下一轮 buildContextPayload 重建前缀时
          // 与本轮发给 API 的消息逐字节一致，避免 DeepSeek 前缀缓存击穿。
          // 标记 hidden：前端不渲染为用户气泡；_deepseekBridge：上下文窗口仍保留给模型。
          const historyRemoveCount = instance.messagesHistory.length - historyBaseLen
          const bridgeMessagesForHistory = bridgeMessages.map(m => ({
            role: m.role,
            content: m.content,
            hidden: true,
            _deepseekBridge: true
          }))
          instance.messagesHistory.splice(historyBaseLen, historyRemoveCount, ...bridgeMessagesForHistory)
          instance._chatHistoryDirty = true
          projects.saveProjectChatHistoryDeferred?.(projectId)
          taskRuns.event(runRef, 'deepseek_multi_tool_cache_bridge', {
            loopCount,
            toolCount: cacheSafeBatchResults.length,
            tools: cacheSafeBatchResults.map(item => item.name),
            bridgeChars: bridgeMessages.reduce((sum, item) => sum + String(item.content || '').length, 0),
            historySynced: true,
            uiHidden: true
          })
        }
        // 工具结果已全部写入 messagesHistory，现在可以安全地检查中断
        throwIfAborted(signal)
        currentToolSectionRealToolCount += realToolCountInBatch

        const explorationNudge = buildExplorationStrategyNudge({
          userMessage: message,
          toolCallsRecord,
          emittedKeys: explorationNudgeKeys
        })
        if (explorationNudge) {
          explorationNudgeKeys.add(explorationNudge.key)
          taskRuns.event(runRef, 'exploration_strategy_nudge', {
            loopCount,
            key: explorationNudge.key
          })
          pushInternalInstruction(messages, explorationNudge.content)
          continueLoop = true
        }

        if (!continueLoop) {
          break
        }
      }

      // 继续请求（检查是否有新的工具调用）
      throwIfAborted(signal)
      consumeInterjectBeforeContinue()
      chatVerboseLog('[AIChat] 发送继续请求...')

      // 发送状态：等待模型继续输出真实过程播报或最终结果。
      taskRuns.event(runRef, 'model_continue_prepare', {
        loopCount,
        messageCount: messages.length,
        toolCallCount: toolCallsRecord.length
      })
      const latestCacheUsage = cacheUsageTracker.getLatest()
      const deepSeekCachePacingEnabled = modelConfig.deepSeekCachePacing !== false && modelConfig.deepseek_cache_pacing !== false
      const cacheCapability = getPromptCacheCapability(modelConfig, apiEndpoint, modelId)
      const isDeepSeekCacheProvider = cacheCapability.id === 'deepseek'
      if (deepSeekCachePacingEnabled && isDeepSeekCacheProvider && latestCacheUsage?.observedAt) {
        const cacheRate = Number(latestCacheUsage.cacheRate)
        // A high hit rate only proves that the old prefix was cached. The assistant/tool
        // messages appended by this request still need seconds to become a new cache unit.
        const targetSettleMs = getDeepSeekCacheSettleTargetMs(modelConfig, cacheRate)
        const elapsedSinceUsageMs = Math.max(0, Date.now() - latestCacheUsage.observedAt)
        const remainingSettleMs = Math.max(0, targetSettleMs - elapsedSinceUsageMs)
        if (remainingSettleMs > 0) {
          taskRuns.event(runRef, 'deepseek_cache_settle_wait', {
            loopCount,
            provider: cacheCapability.id,
            cacheRate: Number.isFinite(cacheRate) ? Number(cacheRate.toFixed(2)) : null,
            targetSettleMs,
            elapsedSinceUsageMs,
            waitMs: remainingSettleMs
          })
          await waitForCacheSettle(remainingSettleMs, signal)
        }
      }
      webContents?.send('ai-status', { projectId, status: 'thinking' })
      webContents?.send('ai-thinking-reset', { projectId })

      const continueApiWatchdog = startApiWatchdog('模型继续接口')
      const continueProgressHeartbeat = startVisibleProgressHeartbeat(`continue-${loopCount}`)
      let continueResponse
      const continueStartedAt = Date.now()
      let continueHeadersMs = 0
      let continueFirstChunkSeen = false
      try {
        cacheUsageTracker.start(`continue-${loopCount}`)
        taskRuns.event(runRef, 'model_continue_request_start', { loopCount })
        interjectRunner.setRunState(projectId, 'streaming')
        continueResponse = await fetchModelStream(`continue-${loopCount}`)
        continueHeadersMs = Date.now() - continueStartedAt
        taskRuns.event(runRef, 'model_continue_response_started', {
          loopCount,
          headersMs: continueHeadersMs,
          requestProfile: perfProfile.continueProfiles[perfProfile.continueProfiles.length - 1] || null
        })
        continueApiWatchdog.touch('stream')
      } catch (error) {
        stopApiWatchdog(continueApiWatchdog)
        stopVisibleProgressHeartbeat(continueProgressHeartbeat)
        throwIfAborted(signal)
        cacheUsageTracker.fail(error.message)
        throw error
      }

      const continueReader = continueResponse.body.getReader()
      let continueBuffer = ''
      toolCallsData = []  // 重置工具调用数据
      hasToolCalls = false
      fullContent = ''    // 重置内容
      fullReasoningContent = ''  // 重置思考内容，只保留本轮
      finishNativeReasoningStream()
      fullReasoningDetails = []
      latestAnthropicContentBlocks = null
      streamState = createAnthropicStreamState()
      progressParser = createProgressStatusParser(status => {
        sendVisibleProgressStatus(status)
      })
      progressNarration = createProgressNarrationTracker(webContents, projectId)
      toolArgumentProgress = createToolArgumentProgressTracker(webContents, projectId, {
        chatSessionId: instance?.chatSessionId || instance?.collaborationSessionId || ''
      })

      while (true) {
        throwIfAborted(signal)
        const { done: cd, value: cv } = await continueReader.read()
        if (cd) break
        markStreamActivity()
        continueApiWatchdog.touch('stream')
        if (!continueFirstChunkSeen) {
          continueFirstChunkSeen = true
          taskRuns.event(runRef, 'model_continue_first_chunk', {
            loopCount,
            firstChunkMs: Date.now() - continueStartedAt,
            headersMs: continueHeadersMs,
            requestProfile: perfProfile.continueProfiles[perfProfile.continueProfiles.length - 1] || null
          })
        }
        continueBuffer += decoder.decode(cv, { stream: true })
        const clines = continueBuffer.split('\n')
        continueBuffer = clines.pop() || ''
        for (const cline of clines) {
          if (!cline.trim() || !cline.startsWith('data:')) continue
          const cdata = cline.slice(5).trim()
          if (cdata === '[DONE]') continue
          try {
            const cjson = JSON.parse(cdata)
            const streamError = createStreamPayloadError(cjson)
            if (streamError) throw streamError
            const cdelta = parseModelStreamEvent(cjson, streamState, activeApiFormat)
            if (cdelta) markStreamActivity()
            if (cdelta?.usage) cacheUsageTracker.record(cdelta.usage, `continue-${loopCount}`)
            if (isMiniMaxM3Model(modelConfig, modelId) && Array.isArray(cdelta?.reasoning_details)) {
              fullReasoningDetails.push(...cdelta.reasoning_details)
            }
            if (isMiniMaxM3Model(modelConfig, modelId) && Array.isArray(cdelta?.content_blocks)) {
              latestAnthropicContentBlocks = cdelta.content_blocks
            }
            if (cdelta?.reasoning_content) {
              fullReasoningContent += cdelta.reasoning_content
              sendNativeReasoningDelta(cdelta.reasoning_content)
            }
            if (cdelta?.content) {
              const visibleContent = progressParser.process(cdelta.content)
              if (visibleContent) {
                consumeVisibleContentForFinalStream(visibleContent)
              }
            }
            // 检查新的工具调用
            if (hasMeaningfulToolCallDelta(cdelta?.tool_calls)) {
              finishNativeReasoningStream()
              resetFinalDelta()
              finalReplyArmed = false
              if (!hasToolCalls) {
                progressNarration.flush({ discard: progressParser.hasEmittedStatus() })
                if (allowContentAsProgressNarration && !progressParser.hasEmittedStatus() && !progressNarration.hasProgress() && fullContent.trim()) {
                  progressNarration.markFromText(fullContent)
                  fullContent = ''
                }
              }
              hasToolCalls = true
              for (const tc of cdelta.tool_calls) {
                const idx = tc.index ?? toolCallsData.length
                while (toolCallsData.length <= idx) {
                  toolCallsData.push({ id: '', type: 'function', function: { name: '', arguments: '' } })
                }
                if (tc.id) toolCallsData[idx].id = tc.id
                if (tc.function?.name) toolCallsData[idx].function.name = tc.function.name
                if (tc.function?.arguments) {
                  toolCallsData[idx].function.arguments += tc.function.arguments
                  toolArgumentProgress.update(toolCallsData[idx])
                }
                previewStreamingToolCall(toolCallsData[idx])
              }
            }
          } catch (e) {
            if (e?.isModelStreamPayloadError) throw e
          }
        }
      }
      stopApiWatchdog(continueApiWatchdog)
      stopVisibleProgressHeartbeat(continueProgressHeartbeat)
      cacheUsageTracker.finish(`continue-${loopCount}`)

      progressNarration.flush({ discard: progressParser.hasEmittedStatus() || !hasToolCalls })
      const remainingContinueContent = progressParser.flush()
      if (remainingContinueContent) {
        consumeVisibleContentForFinalStream(remainingContinueContent)
      }
      if (allowContentAsProgressNarration && hasToolCalls && toolCallsData.length > 0 && fullContent.trim()) {
        resetFinalDelta()
        finalReplyArmed = false
        progressNarration.markFromText(fullContent)
        fullContent = ''
      }
      toolCallsData.forEach(tc => toolArgumentProgress.complete(tc))
      const hasNewToolCalls = hasToolCalls && toolCallsData.length > 0
      lastModelReplyHadNoToolCalls = !hasNewToolCalls && fullContent.trim().length > 0
      continueLoop = hasNewToolCalls
      chatVerboseLog('[AIChat] 继续响应完成, 有新工具调用:', hasNewToolCalls, '本轮正文:', fullContent.length)
    }

    if (Array.isArray(instance.autoExecSteps) && instance.autoExecSteps.length > 0) {
      instance.autoExecSteps = []
      instance.autoExecStepIndex = 0
      instance.autoExecStepEvidenceIndex = 0
      resetAutoExecContinuationState()
    }

    if (isProcessOnlyContinuationText(fullContent)) {
      fullContent = sanitizeFinalContent(fullContent)
    }

    const needsPostWriteVerifyContinuation = hasWriteToolNeedingPostVerification(toolCallsRecord) &&
      !hasPostWriteVerification(toolCallsRecord) &&
      !postWriteVerifyRetryUsed
    const continuationNudge = needsPostWriteVerifyContinuation ? buildPostWriteVerifyNudge(toolCallsRecord) : ''
    if (continuationNudge) {
      throwIfAborted(signal)
      const hasMeaningfulContent = fullContent.trim().length > 0
      if (!projectReviewTask && lastModelReplyHadNoToolCalls && noToolQualityRetryCount >= 1) {
        chatVerboseLog('[AIChat] 改后复查续跑没有产生工具调用，接受当前正文以避免空转')
      } else if (hasMeaningfulContent && lastModelReplyHadNoToolCalls) {
        // 模型已输出最终回复但未验证：追加警告到正文，不再强制清空重跑
        console.log('[AIChat] 改后未验证但已有最终回复，追加警告而非强制续跑')
        postWriteVerifyRetryUsed = true
        const verifyWarning = '\n\n---\n改后复查提醒：本轮已修改文件但未执行验证（code_verify / dev_workflow mode=verify）。如需确认改动安全，请单独触发验证。'
        fullContent = sanitizeFinalContent(fullContent) + verifyWarning
      } else {
        if (lastModelReplyHadNoToolCalls) noToolQualityRetryCount++
        postWriteVerifyRetryUsed = true
        pushInternalInstruction(messages, continuationNudge)
        resetFinalDelta()
        fullContent = ''
        continueLoop = true
        continue
      }
    }

    // L1 运行态硬门禁续跑：UI 面改动后必须有合格 runtime_verify 才允许静默收尾
    const runtimeGate = evaluateRuntimeGateForChat({
      taskType: instance.taskType || instance.inferredTaskType || '',
      userMessage: message,
      toolCalls: toolCallsRecord,
      recoveryAttempts: Number(instance.runtimeGateRecoveryAttempts || 0)
    })
    instance.runtimeGateOutcome = runtimeGate
    if (
      runtimeGate.required === true &&
      (runtimeGate.status === 'missing' || runtimeGate.status === 'incomplete')
    ) {
      throwIfAborted(signal)
      const attempts = Number(instance.runtimeGateRecoveryAttempts || 0)
      if (attempts < runtimeVerificationGate.MAX_RUNTIME_GATE_RECOVERY) {
        instance.runtimeGateRecoveryAttempts = attempts + 1
        runtimeGateContinuationUsed = true
        const runtimeNudge = runtimeVerificationGate.buildRuntimeGateContinuationNudge(runtimeGate)
        console.log('[AIChat] runtime gate continuation:', runtimeGate.status, runtimeGate.reasons, 'attempt', instance.runtimeGateRecoveryAttempts)
        pushInternalInstruction(messages, runtimeNudge)
        resetFinalDelta()
        fullContent = ''
        finalReplyArmed = false
        continueLoop = true
        continue
      }
      // 超过恢复次数：诚实降级，允许收尾但禁止宣称已验证
      const degrade = evaluateRuntimeGateForChat({
        taskType: instance.taskType || instance.inferredTaskType || '',
        userMessage: message,
        toolCalls: toolCallsRecord,
        recoveryAttempts: attempts
      })
      instance.runtimeGateOutcome = degrade
      console.log('[AIChat] runtime gate degraded to blocked:', degrade.blocked_reason || degrade.status)
      if (fullContent.trim() && !fullContent.includes('运行态验证')) {
        fullContent = sanitizeFinalContent(fullContent) +
          `\n\n---\n运行态验证未完成（${degrade.blocked_reason || degrade.status}）：不得宣称 UI/运行问题已验证通过。`
      }
    }

    break
    }

    // 最终完成：只输出最后一轮正文（AI的任务完成总结）
    // 过程中的正文片段已经通过 ai-intermediate-content 显示
    throwIfAborted(signal)
    finalizedChangeSession = finishChangeSession('completed')
    let reviewResult = null

    let baseFinalContent = ensureUsableFinalContent(sanitizeFinalContent(fullContent), {
      userMessage: message,
      changeSession: finalizedChangeSession,
      toolCalls: toolCallsRecord
    })
    // 运行态门禁降级/失败时，附带不可宣称已修好的约束（防模型空口收尾）
    try {
      const outcome = instance.runtimeGateOutcome || evaluateRuntimeGateForChat({
        taskType: instance.taskType || instance.inferredTaskType || '',
        userMessage: message,
        toolCalls: toolCallsRecord,
        recoveryAttempts: Number(instance.runtimeGateRecoveryAttempts || 0)
      })
      if (outcome?.required && (outcome.status === 'failed' || outcome.status === 'blocked')) {
        const note = outcome.status === 'failed'
          ? '\n\n---\n运行态验证结果：failed。以上结论不得写成“已修好/已验证通过”；请以 runtime_verify 失败证据为准。'
          : `\n\n---\n运行态验证未完成（${outcome.blocked_reason || 'blocked'}）。不得宣称 UI/运行问题已验证通过。`
        if (!baseFinalContent.includes('运行态验证')) {
          baseFinalContent = `${baseFinalContent}${note}`
        }
      }
    } catch (_) { /* gate is best-effort on final content */ }
    // 内嵌可视化：模型漏写 directive 时自动补到最终回复，保证自然呈现
    try {
      const { appendMissingVisualDirectives } = require('./inline-visualize')
      baseFinalContent = appendMissingVisualDirectives(baseFinalContent, toolCallsRecord)
    } catch (_) { /* optional */ }
    const fullFinalContent = baseFinalContent
    const effectiveProjectPath = instance.projectPath || projectPath || instance.storagePath
    const finalContent = fullFinalContent
    const artifactPayload = artifacts.maybeCreateLongTextArtifact(instance, finalContent, {
      taskMeta: {
        userMessage: message,
        toolCallsRecord,
        reviewResult,
        hasChangeSession: !!(finalizedChangeSession?.fileCount || finalizedChangeSession?.mutatingCommandCount)
      }
    })
    const requestCompletedAt = Date.now()
    finishNativeReasoningStream()
    const durationMs = Math.max(0, requestCompletedAt - requestStartedAt)
    const finalAssistantMsg = {
      role: 'assistant',
      content: artifactPayload.content,
      ...assistantModelMetadata,
      startedAt: requestStartedAt,
      completedAt: requestCompletedAt,
      durationMs,
      time: new Date().toISOString()
    }
    if (artifactPayload.artifacts.length > 0) finalAssistantMsg.artifacts = artifactPayload.artifacts
    if (fullReasoningContent) finalAssistantMsg.reasoning_content = fullReasoningContent
    if (isMiniMaxM3Model(modelConfig, modelId) && fullReasoningDetails.length) finalAssistantMsg.reasoning_details = fullReasoningDetails
    if (isMiniMaxM3Model(modelConfig, modelId) && activeApiFormat === 'anthropic' && latestAnthropicContentBlocks) finalAssistantMsg.anthropic_content = latestAnthropicContentBlocks
    if (finalizedChangeSession?.fileCount || finalizedChangeSession?.mutatingCommandCount) {
      finalAssistantMsg.changeSession = finalizedChangeSession
    }
    instance.messagesHistory.push(finalAssistantMsg)
    instance._chatHistoryDirty = true
    if (projects.saveProjectChatHistoryDeferred) projects.saveProjectChatHistoryDeferred(instance)
    else projects.saveProjectChatHistory(instance)

    let operationMemo = null
    try {
      if (modelAuthoredOperationMemo?.success && !modelAuthoredOperationMemo.skipped) {
        operationMemo = modelAuthoredOperationMemo
      } else if ((finalizedChangeSession?.fileCount || finalizedChangeSession?.mutatingCommandCount) && !isOperationMemoBackfillMessage(message)) {
        const memoChangeSession = changeSessions.getChangeSession(projectId, finalizedChangeSession.id, { includeContent: true }) || finalizedChangeSession
        operationMemo = aiOperationMemos.buildBackfillPayload({
          projectId,
          projectPath: effectiveProjectPath,
          requestId,
          userMessage: message,
          finalSummary: artifactPayload.content,
          modelName,
          changeSession: memoChangeSession,
          startedAt: requestStartedAt,
          completedAt: requestCompletedAt,
          durationMs
        })
      }
    } catch (memoError) {
      console.warn('[AIOperationMemo] 创建备忘录失败:', memoError.message)
      operationMemo = { success: false, error: memoError.message }
    }

    const requestWasCurrent = requestIsCurrent()
    deleteAbortControllerIfCurrent()
    if (requestWasCurrent) webContents?.send('ai-status', { projectId, status: 'done' })
    cacheUsageTracker.final()
    taskRuns.event(runRef, 'model_perf_profile', {
      durationMs,
      navigationMs: perfProfile.navigationMs,
      contextBuildMs: perfProfile.contextBuildMs,
      initialHeadersMs: perfProfile.initialHeadersMs,
      initialFirstChunkMs: perfProfile.initialFirstChunkMs,
      initialRequestProfile: perfProfile.initialRequestProfile,
      continueProfiles: perfProfile.continueProfiles
    })
    finishAiObservation({
      status: 'ok',
      projectId,
      meta: {
        toolCallCount: toolCallsRecord.length,
        artifactCount: artifactPayload.artifacts.length,
        historyLength: instance.messagesHistory.length,
        changeSessionId: finalizedChangeSession?.id || null
      }
    })
    if (finalizedChangeSession?.fileCount) {
      try {
        if (!signal.aborted) {
          const afterSafetySnapshot = await createAiSafetySnapshot(effectiveProjectPath, {
            phase: 'after',
            projectId,
            userMessage: message,
            changeSession: finalizedChangeSession
          })
          changeSessions.setRecoveryPoint(projectId, finalizedChangeSession.id, 'after', afterSafetySnapshot)
          finalizedChangeSession.recoveryPoints = {
            ...(finalizedChangeSession.recoveryPoints || {}),
            after: afterSafetySnapshot
          }
        }
      } catch (recoveryPointError) {
        console.warn('[RecoveryPoints] 创建 AI 任务恢复点失败:', recoveryPointError.message)
      }
    }
    webContents?.send('message-reply', { projectId, content: artifactPayload.content, artifacts: artifactPayload.artifacts, reasoningContent: fullReasoningContent, done: true, changeSession: finalizedChangeSession, operationMemo, startedAt: requestStartedAt, completedAt: requestCompletedAt, durationMs })
    backgroundReplySound.notifyFinalReplyDone({ projectId, completedAt: requestCompletedAt })
    event.reply('send-message-response', { requestId, projectId, success: true, changeSession: finalizedChangeSession })

    runBackgroundTask('TaskLedger', async () => {
      if (signal.aborted) return
      const ledgerEvidence = {
        hasToolCalls: toolCallsRecord.length > 0,
        hasFileChanges: !!(finalizedChangeSession?.fileCount),
        hasCommands: !!(finalizedChangeSession?.commandCount),
        hasMutatingCommands: !!(finalizedChangeSession?.mutatingCommandCount),
        hasHandoff: !!reviewResult?.results?.length
      }
      const ledgerType = taskLedger.classifyConversation(message, ledgerEvidence)
      if (ledgerType !== 'casual' || toolCallsRecord.length > 0) {
        const ruleFacts = ledgerType === 'discussion'
          ? taskLedger.extractDiscussionFacts(`${message}\n\n${artifactPayload.content}`)
          : {}
        let workerFacts = null
        let workerProvider = ''
        try {
          const workerResult = await workerModel.summarizeLedger({
            type: ledgerType,
            userRequest: message,
            finalSummary: artifactPayload.content,
            evidence: ledgerEvidence
          })
          if (workerResult?.success) {
            workerFacts = workerResult.facts || null
            workerProvider = workerResult.provider || ''
          } else if (workerResult?.error) {
            console.log('[WorkerModel] 账本整理降级为规则提取:', workerResult.error)
          }
        } catch (workerError) {
          console.log('[WorkerModel] 账本整理失败，已降级:', workerError.message)
        }
        const discussionFacts = workerFacts || ruleFacts
        const routeRecord = buildTaskRouteRecord({
          userMessage: message,
          finalSummary: artifactPayload.content,
          toolCallsRecord,
          changeSession: finalizedChangeSession,
          projectPath: effectiveProjectPath
        })
        const ledgerResult = taskLedger.createLedgerEntry(instance, {
          type: ledgerType,
          title: message,
          userRequest: message,
          completed: ledgerType === 'action'
            ? (discussionFacts.completed?.length ? discussionFacts.completed : [artifactPayload.content].filter(Boolean))
            : (discussionFacts.completed || []),
          findings: ledgerType === 'action'
            ? (discussionFacts.findings?.length ? discussionFacts.findings : (reviewResult?.summary ? [reviewResult.summary] : []))
            : (discussionFacts.findings || []),
          decisions: discussionFacts.decisions || [],
          rejected: discussionFacts.rejected || [],
          constraints: discussionFacts.constraints || [],
          openQuestions: discussionFacts.openQuestions || [],
          changedFiles: finalizedChangeSession?.files || [],
          commands: finalizedChangeSession?.commands || [],
          unfinished: discussionFacts.unfinished || [],
          artifacts: artifactPayload.artifacts.map(item => item.id),
          finalSummary: artifactPayload.content,
          evidence: ledgerEvidence,
          route: routeRecord,
          extraJson: workerProvider ? { workerModel: { provider: workerProvider } } : null
        })
        console.log('[TaskLedger] 已写入账本:', ledgerResult.entry.id, ledgerResult.dir)
      }
    })

    instance.autoExecSteps = []
    instance.autoExecStepIndex = 0
    instance.autoExecStepEvidenceIndex = 0

    contextManager.recordTurn(message, artifactPayload.content, modelName, toolCallsRecord)
    runBackgroundTask('MemoryOrganizer', async () => {
      if (signal.aborted) return
      const result = await memoryOrganizer.organize(instance)
      if (result?.success) {
        console.log('[MemoryOrganizer] 已整理长期记忆:', result.provider, 'turns:', result.addedTurnCount)
      } else if (result && !result.skipped) {
        console.log('[MemoryOrganizer] 记忆整理跳过/失败:', result.error || result.reason)
      }
    })
    taskRuns.finishRun(runRef, 'completed', {
      historyLength: instance.messagesHistory.length,
      toolCallCount: toolCallsRecord.length,
      changeSessionId: finalizedChangeSession?.id || null,
      artifactCount: artifactPayload.artifacts.length
    })
    try { require('./desktop-pet').notifyTurnComplete({ success: true }) } catch (_) { /* ignore */ }

  } catch (err) {
    const requestWasCurrent = requestIsCurrent()
    deleteAbortControllerIfCurrent()
    const timedOut = isApiTimeoutError(err, signal)
    const aborted = !timedOut && isAbortError(err, signal)
    // 注入触发检测：interject-runner.abort('interject') 传字符串 reason，
    // isAbortError 已识别 'interject' 字符串 → aborted=true。
    // 再用队列非空确认是 interject 场景（其他中断方式不会往 interject 队列塞消息）。
    const hasPendingInterject = aborted && interjectRunner.peekPendingInterjectMessages(projectId).length > 0
    const interjectTriggered = hasPendingInterject
    // 诊断日志：记录中断的详细信息，帮助定位自动中断的根因
    console.error('[AIChat] ⚠️ 主循环 catch 诊断:',
      '\n  err.name:', err?.name,
      '\n  err.message:', err?.message,
      '\n  err.code:', err?.code,
      '\n  signal.aborted:', signal?.aborted,
      '\n  signal.reason:', signal?.reason?.name, ':', signal?.reason?.message,
      '\n  timedOut:', timedOut,
      '\n  aborted:', aborted,
      '\n  loopCount:', typeof loopCount !== 'undefined' ? loopCount : 'N/A',
      '\n  duration:', Date.now() - requestStartedAt, 'ms',
      '\n  stack:', err?.stack?.split('\n').slice(0, 5).join('\n    ')
    )
    finalizedChangeSession = finalizedChangeSession || finishChangeSession(aborted ? 'interrupted' : 'error')
    if (finalizedChangeSession?.fileCount) {
      try {
        const failedTaskRecoveryPoint = await createAiSafetySnapshot(instance.projectPath || projectPath || instance.storagePath, {
          phase: 'after',
          projectId,
          userMessage: message,
          changeSession: finalizedChangeSession,
          metadata: { partialWrite: true, interrupted: aborted }
        })
        changeSessions.setRecoveryPoint(projectId, finalizedChangeSession.id, 'after', failedTaskRecoveryPoint)
      } catch (recoveryPointError) {
        console.warn('[RecoveryPoints] 创建失败任务恢复点失败:', recoveryPointError.message)
      }
    }
    cacheUsageTracker.fail(err?.message || String(err || ''))

    // 安全兜底：检查 messagesHistory 中是否有悬挂的 tool_calls（没有对应 tool 结果），
    // 补写合成失败结果，防止下次发消息时 Anthropic API 报 400 错误 2013。
    try {
      if (repairToolCallAdjacency(instance.messagesHistory, {
        error: '操作已中断，工具未执行完成',
        aborted: true
      })) {
        if (projects.saveProjectChatHistoryDeferred) projects.saveProjectChatHistoryDeferred(instance)
        else projects.saveProjectChatHistory(instance)
      }
    } catch (patchErr) {
      console.error('[AIChat] 兜底补充 tool 结果时出错:', patchErr.message)
    }

    if (aborted) {
      const requestCompletedAt = Date.now()
      if (hasPendingInterject) {
        // 消息注入导致的中断：不推 [已中断] 到历史（避免污染上下文），
        // 不发 interrupted status（保持前端运行态），只记录轻量中断标记。
        // pendingInterjectRestart 置 true，finally 清理后异步重启 handleSendMessage。
        pendingInterjectRestart = true
        console.log('[AIChat] interject 中断，将在 finally 后异步重启以消费注入消息')
        if (requestWasCurrent) {
          instance.messagesHistory.push({ role: 'assistant', content: '[注入中断，续轮中]', ...assistantModelMetadata, interrupted: true, interjectPause: true, startedAt: requestStartedAt, completedAt: requestCompletedAt, durationMs: Math.max(0, requestCompletedAt - requestStartedAt), time: new Date().toISOString() })
          instance._chatHistoryDirty = true
          if (projects.saveProjectChatHistoryDeferred) projects.saveProjectChatHistoryDeferred(instance)
          else projects.saveProjectChatHistory(instance)
        }
        taskRuns.finishRun(runRef, 'interrupted', {
          error: 'interject',
          changeSessionId: finalizedChangeSession?.id || null
        })
        finishAiObservation({
          status: 'aborted',
          error: 'interject',
          projectId,
          meta: {
            toolCallCount: toolCallsRecord.length,
            changeSessionId: finalizedChangeSession?.id || null
          }
        })
        // 不发 interrupted status，保持前端"运行中"态；不 reply interrupted，前端不显示中断
        event.reply('send-message-response', { requestId, projectId, success: true, interrupted: false, interjectRestart: true, changeSession: finalizedChangeSession })
      } else {
        if (requestWasCurrent) {
          instance.messagesHistory.push({ role: 'assistant', content: '[已中断]', ...assistantModelMetadata, interrupted: true, chatSessionId: instance?.chatSessionId || '', startedAt: requestStartedAt, completedAt: requestCompletedAt, durationMs: Math.max(0, requestCompletedAt - requestStartedAt), time: new Date(requestCompletedAt).toISOString() })
          instance._chatHistoryDirty = true
          if (projects.saveProjectChatHistoryDeferred) projects.saveProjectChatHistoryDeferred(instance)
          else projects.saveProjectChatHistory(instance)
        }
        taskRuns.finishRun(runRef, 'interrupted', {
          error: err.message,
          changeSessionId: finalizedChangeSession?.id || null
        })
        finishAiObservation({
          status: 'aborted',
          error: err.message,
          projectId,
          meta: {
            toolCallCount: toolCallsRecord.length,
            changeSessionId: finalizedChangeSession?.id || null
          }
        })
        if (requestWasCurrent) webContents?.send('ai-status', { projectId, status: 'interrupted' })
        try { require('./desktop-pet').notifyAiStatus('idle') } catch (_) { /* ignore */ }
        event.reply('send-message-response', { requestId, projectId, success: true, interrupted: true, changeSession: finalizedChangeSession })
      }
    } else {
      const requestCompletedAt = Date.now()
      instance.messagesHistory.push({ role: 'assistant', content: err.message, ...assistantModelMetadata, error: true, startedAt: requestStartedAt, completedAt: requestCompletedAt, durationMs: Math.max(0, requestCompletedAt - requestStartedAt) })
      instance._chatHistoryDirty = true
      if (projects.saveProjectChatHistoryDeferred) projects.saveProjectChatHistoryDeferred(instance)
      else projects.saveProjectChatHistory(instance)
      taskRuns.finishRun(runRef, 'failed', {
        error: err.message,
        changeSessionId: finalizedChangeSession?.id || null
      })
      finishAiObservation({
        status: timedOut ? 'timeout' : 'error',
        error: err.message,
        projectId,
        meta: {
          toolCallCount: toolCallsRecord.length,
          changeSessionId: finalizedChangeSession?.id || null
        }
      })
      if (requestWasCurrent) webContents?.send('ai-status', { projectId, status: 'error' })
      try { require('./desktop-pet').notifyTurnComplete({ success: false }) } catch (_) { /* ignore */ }
      if (requestWasCurrent) webContents?.send('message-reply', { projectId, error: err.message, done: true, changeSession: finalizedChangeSession, startedAt: requestStartedAt, completedAt: requestCompletedAt, durationMs: Math.max(0, requestCompletedAt - requestStartedAt) })
      event.reply('send-message-response', { requestId, projectId, error: err.message, changeSession: finalizedChangeSession })
    }
  } finally {
    stopApiWatchdog()
    stopAllVisibleProgressHeartbeats()
    interjectRunner.setRunState(projectId, 'idle')
    // 成功/失败收束已在 try/catch 里由 notifyTurnComplete 处理；注入重启中勿抢状态
    if (!finalizedChangeSession) {
      finalizedChangeSession = finishChangeSession('completed')
    }
    if (!pendingInterjectRestart) {
      stopLocalOllamaModelAfterReply(modelConfig, effectiveModelId)
    }
    deleteAbortControllerIfCurrent()
  }

  // 消息注入异步重启：finally 已完成清理（runState=idle、AbortController 已删除），
  // 现在用 setImmediate 异步触发一次新的 handleSendMessage，让 consumeInterjectBeforeContinue 消费注入消息。
  // 复用原 event 对象发送 IPC reply；新 requestId 避免和已 reply 的旧 requestId 冲突。
  // message 改为续轮指令（避免重复推入原始 user message），hidden=true 避免前端显示续轮指令气泡。
  if (pendingInterjectRestart) {
    const restartRequest = async () => {
      try {
        const newRequestId = `${requestId}-interject-${Date.now()}`
        const restartMessage = '[续轮] 上一轮因消息注入中断，请继续执行原任务并吸收注入的用户指令。'
        console.log('[AIChat] interject 异步重启 handleSendMessage, newRequestId:', newRequestId)
        // 保持前端"运行中"态，consumeInterjectBeforeContinue 会在 try 块开头消费注入消息
        webContents?.send('ai-status', { projectId, status: 'thinking' })
        await runTrackedSendMessage(event, newRequestId, projectId, restartMessage, modelConfig, history, skillContent, executionMode, agentMode, instance, webContents, contextManager, projectPath, effectiveModelId, [], '[续轮] 消息注入中断后继续', true, visionRelayConfig, [], [])
      } catch (restartErr) {
        console.error('[AIChat] interject 异步重启失败:', restartErr?.message || restartErr)
        webContents?.send('ai-status', { projectId, status: 'error' })
        webContents?.send('message-reply', { projectId, error: restartErr?.message || '注入重启失败', done: true })
      }
    }
    setImmediate(restartRequest)
  }
}

function applyBehaviorStyleConfig(next = {}) {
  const saved = storageConfig.saveBehaviorStyleConfig(next)
  const data = (saved && saved.data) ? saved.data : storageConfig.getBehaviorStyleConfig()
  systemPromptBuilder.setBehaviorStyle(data)
  return data
}

function readBehaviorStyleConfig() {
  const data = storageConfig.getBehaviorStyleConfig()
  systemPromptBuilder.setBehaviorStyle(data)
  return data
}

module.exports = {
  getExecutionModeDesc,
  getExecutionModeRules,
  formatPromptCacheTimeBucket,
  getSystemPrompt,
  setUserLanguage,
  getUserLanguage,
  applyBehaviorStyleConfig,
  readBehaviorStyleConfig,
  registerChatIPC,
  handleSendMessage,
  enqueueInterjectMessage: interjectRunner.enqueueInterject,
  takePendingInterjectMessages: interjectRunner.takePendingInterjectMessages,
  peekPendingInterjectMessages: interjectRunner.peekPendingInterjectMessages,
  clearPendingInterjectMessages: interjectRunner.clearPendingInterjectMessages,
  // ── 远程桥接直调接口 ──
  remoteBridgeHandlers: {
    'context-status': (projectId, modelName = null) => {
      try {
        const instance = projects.getProjectInstance(projectId)
        if (!instance) return { error: '项目不存在' }
        const cacheKey = getContextStatusCacheKey(projectId, modelName, instance)
        const cached = contextStatusCache.get(cacheKey)
        if (cached && Date.now() - cached.createdAt < CONTEXT_STATUS_CACHE_TTL_MS) {
          return { ...cached.status, cached: true }
        }
        const messagesHistory = instance.messagesHistory || []
        const contextManager = instance.contextManager
        const estimatedTokens = projects.estimateTokensIncremental(instance)
        const limit = resolveModelContextLimit(modelName)
        const contextRatio = Math.min(estimatedTokens / limit, 1)
        const memoryStatus = contextManager.memory.getStatus()
        const summaryStatus = contextManager.summary.getStatus()
        const status = {
          estimatedTokens: Math.round(estimatedTokens),
          contextRatio,
          modelLimit: limit,
          historyLength: messagesHistory.length,
          tapeLength: messagesHistory.filter(m => m.role === 'user').length,
          indexSize: memoryStatus.indexSize,
          summaryCount: summaryStatus.completedCount + summaryStatus.inProgressCount + summaryStatus.pendingCount,
          compressionStrategy: '按模型真实窗口和请求 Token 重量自动整理，完整历史保留',
          projectPath: instance.projectPath,
          storagePath: instance.storagePath
        }
        contextStatusCache.set(cacheKey, { createdAt: Date.now(), status })
        return status
      } catch (error) {
        console.error('[AIChat] remote context-status failed:', error)
        return {
          estimatedTokens: 0, contextRatio: 0, modelLimit: resolveModelContextLimit(modelName),
          historyLength: 0, tapeLength: 0, indexSize: 0, summaryCount: 0,
          compressionStrategy: '上下文状态读取失败，已降级显示',
          error: error.message
        }
      }
    },
    'context-clear': (projectId) => {
      const instance = projects.getProjectInstance(projectId)
      if (!instance) return { error: '项目不存在' }
      instance.contextManager.clear()
      instance.messagesHistory = []
      instance._chatHistoryDirty = true
      instance._cachedTokenCount = 0
      instance._lastTokenCalcLength = 0
      clearContextStatusCache(projectId)
      contextCompression.clearSummaries(instance).catch(e => console.warn('[AIChat] clearSummaries failed:', e.message))
      if (projects.saveProjectChatHistoryDeferred) projects.saveProjectChatHistoryDeferred(projectId)
      else projects.saveProjectChatHistory(projectId)
      return { success: true }
    },
    // 远程桥接直调：发送消息（绕过 ipcMain.on，直接调用 handleSendMessage）
    'send-message': async (payload) => {
      const {
        projectId, message, config: modelConfig = {}, history = [],
        skillContent = null, executionMode = 'normal', agentMode = false,
        imageDataList = [], displayContent = null, hidden = false,
        visionRelayConfig = null, references = [], directiveBadges = []
      } = payload || {}
      const requestId = `remote_${Date.now().toString(36)}_${Math.random().toString(36).substr(2, 5)}`

      // ★ 如果远程桥接未传 modelConfig 或关键字段缺失，自动从存储中获取已保存的默认模型配置
      const storageConfig = require('./storage-config')
      let effectiveConfig = modelConfig
      if (!modelConfig?.apiUrl || (!modelConfig?.apiKey && !modelConfig?.modelId)) {
        const savedConfig = storageConfig.getApiConfig()
        if (savedConfig.success && savedConfig.data?.models?.length > 0) {
          const idx = savedConfig.data.currentIndex || 0
          const savedModel = savedConfig.data.models[idx] || savedConfig.data.models[0]
          if (savedModel) {
            effectiveConfig = {
              ...savedModel,
              ...modelConfig  // 保留用户显式传入的字段
            }
          }
        }
      }

      // 后端防重入
      const existingController = config.getAbortController(projectId)
      if (existingController && !existingController.signal.aborted) {
        try { existingController.abort(createAbortError('被新的会话请求替换')) } catch {}
      }

      const instance = await projects.ensureProjectBranchSession(projectId) || projects.getProjectInstance(projectId)
      const webContents = projects.getWebContentsForProject(projectId)
      if (!instance) {
        webContents?.send('ai-status', { projectId, status: 'error' })
        webContents?.send('message-reply', { projectId, error: '项目不存在', done: true })
        return { error: '项目不存在' }
      }

      const { contextManager, projectPath } = instance
      const effectiveModelId = effectiveConfig?.modelId || effectiveConfig?.modelName
      const hasModelCredential = hasApiKey(effectiveConfig?.apiKey)
      if (!effectiveConfig?.apiUrl || !hasModelCredential || !effectiveModelId) {
        webContents?.send('ai-status', { projectId, status: 'error' })
        const errorMessage = '请先配置API'
        webContents?.send('message-reply', { projectId, error: errorMessage, done: true })
        return { error: errorMessage }
      }

      // 远程桥接发送用户消息通知：让桌面端前端渲染用户在手机端发的消息
      if (!hidden && webContents) {
        webContents.send('remote-user-message', {
          projectId,
          content: displayContent || message,
          timestamp: Date.now()
        })
      }

      // 远程桥接用 mock event：reply 走 ipcMain 通道对远程客户端无意义，
      // AI 流式事件通过 webContents.send → EventMirror 广播到 WS 客户端
      const mockEvent = { reply: () => {} }
      runTrackedSendMessage(
        mockEvent, requestId, projectId, message, effectiveConfig, history,
        skillContent, executionMode, agentMode, instance, webContents,
        contextManager, projectPath, effectiveModelId, imageDataList,
        displayContent, hidden, visionRelayConfig, references, directiveBadges
      ).catch(err => {
        console.error('[AIChat] remote send-message error:', err?.message || err)
        webContents?.send('ai-status', { projectId, status: 'error', error: err?.message })
        webContents?.send('message-reply', { projectId, error: err?.message, done: true })
      })

      return { success: true, requestId }
    },
    // 远程桥接直调：中断 AI（绕过 ipcMain.on，直接调用 abort 逻辑）
    'interrupt-ai': (payload) => {
      const projectId = payload?.projectId
      const controller = config.getAbortController(projectId)
      const webContents = projects.getWebContentsForProject(projectId)
      if (controller) {
        if (!controller.signal.aborted) {
          controller.abort(createAbortError('用户已中断本轮 AI 操作'))
        }
        webContents?.send('ai-status', { projectId, status: 'interrupted' })
        console.log('[AIChat] 远程桥接 AI操作已中断:', projectId)
      }
      return { success: true, interrupted: true }
    },
  },
  __test: {
    isUserRequestRestatement,
    isNonProgressNarration,
    normalizeProgressStatus,
    normalizeProgressNarration,
    summarizeProgressText,
    summarizeToolResultForModel,
    shouldRerouteManualLocationFirst,
    buildNavigationFirstRerouteInstruction,
    shouldReroutePrematureModification,
    shouldSplitLargeToolBatch,
    shouldSplitToolSectionBatch,
    shouldRerouteToolStatusMismatch,
    isBusinessToolName,
    hasPostWriteVerification,
    buildPostWriteVerifyNudge,
    evaluateRuntimeGateForChat,
    getRuntimeGateFeatureFlags,
    repairToolCallAdjacency,
    buildTaskRouteRecord,
    getDeepSeekCacheSettleTargetMs,
    shouldBridgeDeepSeekMultiToolBatch,
    buildDeepSeekMultiToolCacheBridge
  }
}
