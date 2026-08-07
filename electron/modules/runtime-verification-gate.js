/**
 * 条件性运行时验证硬门禁（L1）
 * 纯归约：根据 toolCalls / 任务类型 / 诊断 flags 判断是否允许 start_final_reply。
 * 不执行启动或 runtime_verify，只消费已有工具结果。
 */

const MAX_RUNTIME_GATE_RECOVERY = 2

// 目录锚定 + 明确 UI 扩展；不把任意 main.js/index.js/app.js 当 UI 面（避免后端入口误触发）
const UI_SURFACE_PATH_PATTERN = new RegExp(
  [
    '\\.(html?|css|scss|sass|less|vue|svelte|jsx|tsx)$',
    '(^|[/\\\\])(frontend|renderer|views?|pages?|components?|public|static|styles?|ui|webview)([/\\\\]|$)',
    '(^|[/\\\\])preload\\.(js|cjs|mjs|ts)$',
    // 仅在 UI 目录下的场景/入口脚本
    '(^|[/\\\\])(frontend|renderer|views?|pages?|components?|public|static|ui|webview)[/\\\\][^\\n]*\\.(js|ts|mjs|cjs|json)$'
  ].join('|'),
  'i'
)

const UI_RUNTIME_INTENT_PATTERN =
  /(点击|白屏|空白|无响应|弹窗|下拉|F12|控制台|console\s*error|界面|前端|UI|页面|预览|runtime_verify|不显示|看不见|layout|css|hover|modal|dropdown)/i

const WRITE_TOOL_NAMES = new Set([
  'write_file', 'edit_file', 'text_edit', 'apply_patch', 'json_edit',
  'copy_file', 'move_file', 'delete_file', 'create_directory',
  'file_manage', 'file_write_session'
])

const WRITE_EXEMPT_TOOLS = new Set([
  'create_directory', 'render_svg_asset', 'file_manage', 'media_process'
])

const RECOVERABLE_INCOMPLETE_TYPES = new Set([
  'runtime_target_unavailable',
  'runtime_target_ambiguous',
  'runtime_target_blank_or_wrong',
  'unsupported_runtime_verify_arguments',
  'invalid_semantic_interaction',
  'ui_precondition_missing'
])

const UNRECOVERABLE_INCOMPLETE_TYPES = new Set([
  'unsupported_runtime_capability'
])

function clean(value = '') {
  return String(value == null ? '' : value).trim()
}

function isUiSurfacePath(filePath = '') {
  const text = clean(filePath).replace(/\\/g, '/')
  if (!text) return false
  if (/\.(md|markdown|txt|license)$/i.test(text)) return false
  if (/\.test\.(js|ts|mjs|cjs)$/i.test(text) || /\.spec\.(js|ts|mjs|cjs)$/i.test(text)) return false
  return UI_SURFACE_PATH_PATTERN.test(text)
}

function extractPathsFromCall(call = {}) {
  const args = call.args || call.arguments || {}
  const result = call.result || {}
  const paths = []
  const push = value => {
    if (!value) return
    if (Array.isArray(value)) {
      value.forEach(push)
      return
    }
    if (typeof value === 'string') {
      paths.push(value)
      return
    }
    if (typeof value === 'object') {
      if (value.path) paths.push(value.path)
      if (value.file) paths.push(value.file)
      if (value.file_path) paths.push(value.file_path)
    }
  }
  push(args.path)
  push(args.file)
  push(args.file_path)
  push(args.paths)
  push(args.files)
  push(args.edits)
  push(result.changed_files)
  push(result.changedFiles)
  push(result.files)
  push(result.path)
  if (typeof args.patch === 'string') {
    for (const match of String(args.patch).matchAll(/^\+\+\+\s+[ab]\/(.+)$/gm)) {
      if (match[1]) paths.push(match[1])
    }
    for (const match of String(args.patch).matchAll(/^\*\*\*\s+(?:Update|Add|Delete)\s+File:\s+(.+)$/gm)) {
      if (match[1]) paths.push(match[1].trim())
    }
  }
  return paths.map(clean).filter(Boolean)
}

function isWriteLikeCall(call = {}) {
  const name = clean(call.name || call.toolName)
  if (!WRITE_TOOL_NAMES.has(name)) return false
  if (WRITE_EXEMPT_TOOLS.has(name)) return false
  if (name === 'file_manage') {
    const action = clean(argsAction(call)).toLowerCase()
    return /write|edit|create|delete|move|copy|rename/.test(action)
  }
  return true
}

function argsAction(call = {}) {
  const args = call.args || call.arguments || {}
  return args.action || args.mode || ''
}

function lastWriteIndex(toolCalls = []) {
  let index = -1
  for (let i = 0; i < toolCalls.length; i++) {
    if (isWriteLikeCall(toolCalls[i])) index = i
  }
  return index
}

function collectWritePaths(toolCalls = []) {
  const paths = []
  for (const call of toolCalls) {
    if (!isWriteLikeCall(call)) continue
    paths.push(...extractPathsFromCall(call))
  }
  return [...new Set(paths)]
}

function hasDiagnosticRuntimeRequirement(toolCalls = []) {
  for (const call of toolCalls) {
    const result = call?.result || {}
    if (result.requires_ui_behavior_verification === true) return true
    if (result.requires_runtime_review === true) return true
    if (result.postEditDiagnostics?.requires_ui_behavior_verification === true) return true
    if (result.logicReview?.requires_ui_behavior_verification === true) return true
    if (result.logic_review?.requires_ui_behavior_verification === true) return true
  }
  return false
}

function evaluateL1Trigger({
  taskType = '',
  userMessage = '',
  toolCalls = [],
  featureFlags = {},
  isWebUiTask = false
} = {}) {
  const reasons = []
  if (featureFlags.runtime_verify_hard_gate === false) {
    return { required: false, reasons: ['hard_gate_disabled'] }
  }

  const type = clean(taskType).toLowerCase()
  if (type === 'ui') reasons.push('task_type_ui')
  if (isWebUiTask === true) reasons.push('web_ui_task')
  if (UI_RUNTIME_INTENT_PATTERN.test(String(userMessage || ''))) reasons.push('user_runtime_intent')

  const writePaths = collectWritePaths(toolCalls)
  if (writePaths.some(isUiSurfacePath)) reasons.push('ui_surface_write')

  if (hasDiagnosticRuntimeRequirement(toolCalls)) reasons.push('diagnostic_requires_runtime')

  const hasWrites = lastWriteIndex(toolCalls) >= 0
  // 纯问答且无诊断 flags：不触发
  if (!hasWrites && !reasons.includes('diagnostic_requires_runtime') && !reasons.includes('user_runtime_intent')) {
    return { required: false, reasons: ['no_relevant_writes'] }
  }

  // 用户明确提 UI/F12 意图，即使尚未写入也要求在收尾前有 runtime（若本轮有写则更严）
  if (!hasWrites && reasons.includes('user_runtime_intent') && !reasons.includes('diagnostic_requires_runtime')) {
    // 仅意图、无写：不强制（避免闲聊被挡）
    return { required: false, reasons: ['intent_without_writes'] }
  }

  return {
    required: reasons.length > 0,
    reasons,
    writePaths
  }
}

function hasSpecificVerificationCoverage(result = {}) {
  return result.coverage?.specific === true ||
    result.verification_report?.coverage?.specific === true ||
    result.verificationReport?.coverage?.specific === true
}

function getVerificationStatus(call = {}) {
  const result = call?.result || {}
  const status = clean(result.verification_status || result.verificationStatus).toLowerCase()
  if (status === 'passed' && !hasSpecificVerificationCoverage(result)) return 'incomplete'
  return status
}

function isQualifiedRuntimeVerifyCall(call = {}) {
  if (clean(call?.name || call?.toolName) !== 'runtime_verify') return false
  const status = getVerificationStatus(call)
  return status === 'passed' || status === 'failed'
}

function findQualifiedRuntimeVerifyCalls(toolCalls = [], { afterLastWrite = true } = {}) {
  const list = Array.isArray(toolCalls) ? toolCalls : []
  const start = afterLastWrite ? Math.max(0, lastWriteIndex(list) + 1) : 0
  const qualified = []
  for (let i = start; i < list.length; i++) {
    if (isQualifiedRuntimeVerifyCall(list[i])) qualified.push({ index: i, call: list[i] })
  }
  return qualified
}

function findLatestRuntimeVerifyCall(toolCalls = [], { afterLastWrite = true } = {}) {
  const list = Array.isArray(toolCalls) ? toolCalls : []
  const start = afterLastWrite ? Math.max(0, lastWriteIndex(list) + 1) : 0
  for (let i = list.length - 1; i >= start; i--) {
    if (clean(list[i]?.name || list[i]?.toolName) === 'runtime_verify') {
      return { index: i, call: list[i] }
    }
  }
  return null
}

function countFailedLaunches(toolCalls = []) {
  let count = 0
  for (const call of toolCalls) {
    const name = clean(call?.name || call?.toolName)
    if (!['shell_run', 'run_command', 'terminal_run'].includes(name)) continue
    const cmd = clean(call?.args?.command || call?.args?.cmd || call?.arguments?.command)
    if (!/\b(npm|pnpm|yarn|bun)\s+(?:run\s+)?(?:start|dev|serve|preview)\b|electron/i.test(cmd)) continue
    const result = call?.result || {}
    if (result.success === false || result.error || Number(result.code) > 0) count += 1
  }
  return count
}

function classifyIncomplete(call, { recoveryAttempts = 0, toolCalls = [] } = {}) {
  const result = call?.result || {}
  const errorType = clean(result.error_type || result.errorType)
  if (UNRECOVERABLE_INCOMPLETE_TYPES.has(errorType)) {
    return { status: 'blocked', blocked_reason: errorType || 'unsupported_runtime_capability' }
  }
  if (errorType === 'runtime_target_ambiguous' || errorType === 'unsupported_runtime_verify_arguments') {
    return { status: 'incomplete', blocked_reason: null }
  }
  if (errorType === 'runtime_target_unavailable') {
    const launches = countFailedLaunches(toolCalls)
    if (recoveryAttempts >= MAX_RUNTIME_GATE_RECOVERY || launches >= 2) {
      return { status: 'blocked', blocked_reason: launches >= 2 ? 'launch_failed' : 'max_recovery_attempts' }
    }
    return { status: 'incomplete', blocked_reason: null }
  }
  if (RECOVERABLE_INCOMPLETE_TYPES.has(errorType)) {
    if (recoveryAttempts >= MAX_RUNTIME_GATE_RECOVERY) {
      return { status: 'blocked', blocked_reason: 'max_recovery_attempts' }
    }
    return { status: 'incomplete', blocked_reason: null }
  }
  if (recoveryAttempts >= MAX_RUNTIME_GATE_RECOVERY) {
    return { status: 'blocked', blocked_reason: 'max_recovery_attempts' }
  }
  return { status: 'incomplete', blocked_reason: null }
}

function buildRuntimeGatePlaybook(gate = {}) {
  const status = gate.status || 'missing'
  const lines = [
    '【运行时验证门禁】收尾前必须完成 runtime_verify（DOM+F12），进程存活不算通过。',
    '1) shell_run 启动开发实例；Electron 秒退时确认未继承 ELECTRON_RUN_AS_NODE。',
    '2) 等待本地 URL/窗口就绪（系统会登记 browser/electron target）。',
    '3) 调用 runtime_verify（可先省略 interaction 做 live+console；交互 bug 再加 click_locator）。',
    '4) verification_status=passed 可收尾；failed 可收尾但禁止声称已修好；incomplete 按 next_action 修 target/runtime_id。',
    '5) 多实例时用 candidates 的 runtime_id。禁止用 desktop_control 坐标、仅截图、仅 npm start、仅 code_verify 代替。'
  ]
  if (status === 'incomplete' && gate.latestErrorType) {
    lines.push(`当前 incomplete: ${gate.latestErrorType}${gate.latestError ? ` — ${String(gate.latestError).slice(0, 160)}` : ''}`)
  }
  if (status === 'missing') {
    lines.push('本轮尚无合格 runtime_verify（passed|failed）。')
  }
  if (Array.isArray(gate.reasons) && gate.reasons.length) {
    lines.push(`触发原因: ${gate.reasons.join(', ')}`)
  }
  return lines.join('\n').slice(0, 800)
}

/**
 * @typedef {'not_required'|'missing'|'incomplete'|'passed'|'failed'|'blocked'} RuntimeGateStatus
 */
function classifyRuntimeGate({
  taskType = '',
  userMessage = '',
  toolCalls = [],
  featureFlags = {},
  isWebUiTask = false,
  recoveryAttempts = 0
} = {}) {
  const flags = {
    runtime_verify: featureFlags.runtime_verify !== false,
    runtime_verify_hard_gate: featureFlags.runtime_verify_hard_gate !== false
  }

  if (!flags.runtime_verify_hard_gate) {
    return {
      status: 'not_required',
      required: false,
      reasons: ['hard_gate_disabled'],
      qualifiedCall: null,
      playbook: '',
      blocked_reason: null
    }
  }

  const trigger = evaluateL1Trigger({
    taskType,
    userMessage,
    toolCalls,
    featureFlags: flags,
    isWebUiTask
  })

  if (!trigger.required) {
    return {
      status: 'not_required',
      required: false,
      reasons: trigger.reasons,
      writePaths: trigger.writePaths || [],
      qualifiedCall: null,
      playbook: '',
      blocked_reason: null
    }
  }

  if (!flags.runtime_verify) {
    const gate = {
      status: 'blocked',
      required: true,
      reasons: [...trigger.reasons, 'runtime_verify_feature_disabled'],
      writePaths: trigger.writePaths || [],
      qualifiedCall: null,
      blocked_reason: 'feature_disabled'
    }
    gate.playbook = buildRuntimeGatePlaybook(gate)
    return gate
  }

  const qualified = findQualifiedRuntimeVerifyCalls(toolCalls, { afterLastWrite: true })
  if (qualified.length) {
    const last = qualified[qualified.length - 1]
    const status = getVerificationStatus(last.call)
    const gate = {
      status,
      required: true,
      reasons: trigger.reasons,
      writePaths: trigger.writePaths || [],
      qualifiedCall: last.call,
      blocked_reason: null
    }
    gate.playbook = status === 'failed'
      ? 'runtime_verify 已 failed：可 start_final_reply，但必须说明失败证据，禁止声称 UI/运行问题已修好。'
      : ''
    return gate
  }

  const latest = findLatestRuntimeVerifyCall(toolCalls, { afterLastWrite: true })
  if (latest) {
    const status = getVerificationStatus(latest.call)
    const errorType = clean(latest.call?.result?.error_type || latest.call?.result?.errorType)
    const error = clean(latest.call?.result?.error || latest.call?.result?.message)
    if (status === 'incomplete' || !status) {
      const classified = classifyIncomplete(latest.call, { recoveryAttempts, toolCalls })
      const gate = {
        status: classified.status,
        required: true,
        reasons: trigger.reasons,
        writePaths: trigger.writePaths || [],
        qualifiedCall: null,
        latestErrorType: errorType,
        latestError: error,
        blocked_reason: classified.blocked_reason
      }
      gate.playbook = buildRuntimeGatePlaybook(gate)
      return gate
    }
  }

  if (recoveryAttempts >= MAX_RUNTIME_GATE_RECOVERY) {
    const gate = {
      status: 'blocked',
      required: true,
      reasons: trigger.reasons,
      writePaths: trigger.writePaths || [],
      qualifiedCall: null,
      blocked_reason: 'max_recovery_attempts'
    }
    gate.playbook = buildRuntimeGatePlaybook(gate)
    return gate
  }

  const gate = {
    status: 'missing',
    required: true,
    reasons: trigger.reasons,
    writePaths: trigger.writePaths || [],
    qualifiedCall: null,
    blocked_reason: null
  }
  gate.playbook = buildRuntimeGatePlaybook(gate)
  return gate
}

function assertStartFinalReplyAllowed(gate = {}) {
  if (!gate || gate.required !== true) {
    return { allowed: true, resultPatch: { runtime_gate: gate?.status || 'not_required' } }
  }
  if (gate.status === 'passed' || gate.status === 'failed' || gate.status === 'blocked') {
    return {
      allowed: true,
      resultPatch: {
        runtime_gate: gate.status,
        blocked_reason: gate.blocked_reason || undefined,
        claim_policy: gate.status === 'passed'
          ? undefined
          : 'Do not claim the UI/runtime issue is fixed or fully verified.'
      }
    }
  }
  // missing | incomplete
  return {
    allowed: false,
    resultPatch: {
      success: false,
      internal: true,
      finalReplyArmed: false,
      error_type: 'runtime_verification_gate_blocked',
      runtime_gate: gate.status,
      required: true,
      reasons: gate.reasons || [],
      playbook: gate.playbook || buildRuntimeGatePlaybook(gate),
      next_action: gate.playbook || buildRuntimeGatePlaybook(gate),
      blocked_reason: gate.blocked_reason || undefined,
      message: 'Cannot arm final reply: runtime verification gate not satisfied.',
      claim_policy: 'Do not claim the UI/runtime issue is fixed or verified.'
    }
  }
}

function buildRuntimeGateContinuationNudge(gate = {}) {
  return gate.playbook || buildRuntimeGatePlaybook(gate)
}

module.exports = {
  MAX_RUNTIME_GATE_RECOVERY,
  UI_SURFACE_PATH_PATTERN,
  UI_RUNTIME_INTENT_PATTERN,
  isUiSurfacePath,
  isWriteLikeCall,
  isQualifiedRuntimeVerifyCall,
  evaluateL1Trigger,
  findQualifiedRuntimeVerifyCalls,
  classifyRuntimeGate,
  assertStartFinalReplyAllowed,
  buildRuntimeGatePlaybook,
  buildRuntimeGateContinuationNudge,
  collectWritePaths,
  lastWriteIndex
}
