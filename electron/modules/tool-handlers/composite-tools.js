const crypto = require('crypto')
const {
  getCompositeAction,
  getCompositeRoute,
  buildRoutedArgs,
  getCompositeActionMap,
  normalizeCompositeArgs,
  repairCompositeArgs,
  argsSignature
} = require('../composite-tool-contracts')

const ACTIONS = getCompositeActionMap()

function validateArgs(toolName, action, args) {
  if (toolName === 'file_read' && action === 'one' && !args.path) return 'action=one 需要 path'
  if (toolName === 'file_read' && action === 'many' && !Array.isArray(args.files)) return 'action=many 需要 files 数组'
  if (toolName === 'file_write_session' && action === 'start' && !args.path) return 'action=start 需要 path'
  if (toolName === 'file_write_session' && action !== 'start' && !args.session_id) return `action=${action} 需要 session_id`
  if (toolName === 'file_manage' && ['copy', 'move'].includes(action) && (!args.source || !args.destination)) return `action=${action} 需要 source 和 destination`
  if (toolName === 'file_manage' && ['create_directory', 'delete'].includes(action) && !args.path) return `action=${action} 需要 path`
  if (toolName === 'code_verify' && action === 'file' && !args.path) return 'action=file 需要 path'
  if (toolName === 'code_inspect' && action === 'grep') {
    const hasPattern = !!(args.pattern || (Array.isArray(args.patterns) && args.patterns.length))
    if (!hasPattern) return 'action=grep 需要 pattern 或 patterns'
  }
  if (toolName === 'code_inspect' && action === 'locate' && !args.query) return 'action=locate 需要 query'
  if (toolName === 'code_inspect' && action === 'find_in_file' && (!args.path || !args.pattern)) return 'action=find_in_file 需要 path 和 pattern'
  if (toolName === 'code_inspect' && action === 'navigate' && !args.path) return 'action=navigate 需要 path'
  if (toolName === 'code_inspect' && action === 'find_references' && !args.symbol) return 'action=find_references 需要 symbol'
  if (toolName === 'code_inspect' && action === 'trace_call_chain' && !args.symbol) return 'action=trace_call_chain 需要 symbol'
  if (toolName === 'project_history' && ['recall', 'search_memos'].includes(action) && !args.query) return `action=${action} 需要 query`
  if (toolName === 'project_history' && action === 'ledger' && !args.entry_id) return 'action=ledger 需要 entry_id'
  if (toolName === 'project_history' && action === 'read_memo' && !args.memo_id) return 'action=read_memo 需要 memo_id'
  if (toolName === 'image_analyze' && !args.path) return '需要 path'
  if (toolName === 'mcp' && action === 'call' && !args.name) return 'action=call 需要 name'
  if (toolName === 'media_process' && action === 'render_svg' && !args.output_path) return 'action=render_svg 需要 output_path'
  if (toolName === 'media_process' && action !== 'render_svg' && !args.path) return `action=${action} 需要 path`
  if (toolName === 'desktop_app' && ['find', 'open'].includes(action) && !args.name && !args.path) {
    return `action=${action} 需要 name 或 path`
  }
  return ''
}

function noRouteError(toolName, action) {
  const hint = toolName === 'file_read'
    ? '请传 path（自动 action=one）或 files（自动 action=many）。'
    : '请补全 action，或提供足以推断 action 的参数（如 path / pattern / query）。'
  return {
    success: false,
    error: `${toolName} 不支持 action=${action || '(empty)'}。${hint}`,
    error_type: 'invalid_tool_args',
    recoverable: true,
    next_action: 'fix_tool_args_then_retry'
  }
}

function validationErrorResult(message) {
  return {
    success: false,
    error: message,
    error_type: 'invalid_tool_args',
    recoverable: true,
    next_action: 'fix_tool_args_then_retry'
  }
}

async function runOnce(toolName, args, ctx) {
  const action = getCompositeAction(toolName, args)
  const route = getCompositeRoute(toolName, args)
  if (!route) {
    return { ok: false, stage: 'no_route', action, result: noRouteError(toolName, action) }
  }
  const validationError = validateArgs(toolName, action, args)
  if (validationError) {
    return { ok: false, stage: 'validation', action, result: validationErrorResult(validationError) }
  }
  const targetArgs = buildRoutedArgs(toolName, action, args)
  const childTraceId = crypto.randomUUID()
  const result = await ctx.dispatch(route.tool, targetArgs, {
    toolTraceId: childTraceId,
    parentToolTraceId: ctx.options?.toolTraceId || '',
    parentToolName: toolName,
    requestedTool: toolName,
    requestedAction: action
  })
  const normalized = result && typeof result === 'object' ? result : { success: true, value: result }
  const failed = normalized.success === false || !!normalized.error
  return {
    ok: !failed,
    stage: failed ? 'execution' : 'success',
    action,
    route,
    childTraceId,
    result: normalized
  }
}

function buildRouteMeta(toolName, last, ctx, autoRepairs, extra = {}) {
  return {
    requested_tool: toolName,
    action: last.action || '',
    routed_tool: last.route?.tool || null,
    trace_id: ctx.options?.toolTraceId || '',
    child_trace_id: last.childTraceId || '',
    auto_repairs: autoRepairs,
    ...extra
  }
}

/**
 * 合成工具调度：
 * 1) 规范化别名 + 推断 action
 * 2) 路由 / 校验 / 执行
 * 3) 失败时自动纠参并重试一次（不会无限循环）
 */
async function dispatchComposite(toolName, rawArgs = {}, ctx = {}) {
  const originalArgs = rawArgs && typeof rawArgs === 'object' && !Array.isArray(rawArgs) ? rawArgs : {}
  let args = normalizeCompositeArgs(toolName, originalArgs)
  const autoRepairs = []
  if (Array.isArray(args._normalized_notes) && args._normalized_notes.length) {
    autoRepairs.push({ stage: 'normalize', notes: args._normalized_notes.slice() })
  }

  let last = await runOnce(toolName, args, ctx)
  if (last.ok) {
    return {
      ...last.result,
      _tool_route: buildRouteMeta(toolName, last, ctx, autoRepairs, {
        inferred_action: !originalArgs.action,
        action_source: originalArgs.action ? 'explicit' : 'inferred'
      })
    }
  }

  const repaired = repairCompositeArgs(toolName, args, {
    reason: last.stage,
    action: last.action,
    error: last.result?.error,
    result: last.result
  })

  if (repaired && argsSignature(repaired) !== argsSignature(args)) {
    autoRepairs.push({
      stage: 'repair_retry',
      from_action: last.action,
      to_action: getCompositeAction(toolName, repaired),
      notes: repaired._repair_notes || [],
      previous_error: last.result?.error || ''
    })
    args = repaired
    last = await runOnce(toolName, args, ctx)
    if (last.ok) {
      return {
        ...last.result,
        _tool_route: buildRouteMeta(toolName, last, ctx, autoRepairs, {
          inferred_action: true,
          action_source: 'repair_retry'
        }),
        model_facing_hint: `参数已自动纠正后成功（${autoRepairs.map(item => item.stage).join(' → ')}）。`
      }
    }
  }

  return {
    ...last.result,
    error_type: last.result?.error_type || 'invalid_tool_args',
    recoverable: last.result?.recoverable !== false,
    _tool_route: buildRouteMeta(toolName, last, ctx, autoRepairs, {
      action: last.action || getCompositeAction(toolName, args)
    }),
    model_facing_hint: autoRepairs.length
      ? `已自动尝试纠参仍失败，请根据错误调整参数，不要原样重试。上一错误：${last.result?.error || ''}`
      : (last.result?.model_facing_hint || '')
  }
}

module.exports = {
  handlers: Object.fromEntries(Object.keys(ACTIONS).map(name => [name, (args, ctx) => dispatchComposite(name, args, ctx)])),
  ACTIONS,
  dispatchComposite,
  validateArgs
}
