/**
 * desktop_control 工具：开关门禁 + 应用授权 + 屏幕反馈 + Esc 中断
 */

const service = require('../desktop-control/service')
const settings = require('../desktop-control/settings')
const session = require('../desktop-control/session')
const overlay = require('../desktop-control/overlay')
const { ensureActionConfirmation, classifyRisk } = require('../desktop-control/confirmations')
const { ensureAppApproval, resolveAppIdentity } = require('../desktop-control/app-approval')

const METHODS = [
  'list_windows',
  'list_apps',
  'launch_app',
  'activate_window',
  'get_window_state',
  'act',
  'set_value',
  'click',
  'drag',
  'scroll',
  'type_text',
  'press_key'
]

const MUTATING = new Set([
  'act',
  'set_value',
  'click',
  'drag',
  'scroll',
  'type_text',
  'press_key',
  'launch_app'
])

const NEEDS_APP_APPROVAL = new Set([
  'launch_app',
  'activate_window',
  'get_window_state',
  'act',
  'set_value',
  'click',
  'drag',
  'scroll',
  'type_text',
  'press_key'
])

function normalizeMethod(args = {}) {
  const raw = String(args.method || args.action || '').trim().toLowerCase()
  if (!raw) return ''
  if (raw === 'list') return 'list_windows'
  if (raw === 'launch') return 'launch_app'
  if (raw === 'activate') return 'activate_window'
  if (raw === 'state' || raw === 'snapshot' || raw === 'observe') return 'get_window_state'
  if (raw === 'action' || raw === 'invoke') return 'act'
  if (raw === 'type') return 'type_text'
  if (raw === 'key' || raw === 'hotkey' || raw === 'shortcut') return 'press_key'
  if (raw === 'mouse_click') return 'click'
  return raw
}

function windowArg(args = {}) {
  return args.window || args.window_id || args.id
}

function disabledResult() {
  return {
    success: false,
    disabled: true,
    error: '桌面操控已关闭。请在 设置 → 能力开关 中开启「桌面操控」。',
    next_action: 'ask_user_to_enable_desktop_control_in_settings'
  }
}

function interruptedResult() {
  const info = session.getInterruptInfo() || {}
  return {
    success: false,
    interrupted: true,
    error: info.message || '用户已停止桌面操控（Esc）。请勿继续调用 desktop_control。',
    reason: info.reason || 'escape',
    next_action: 'stop_desktop_control_and_explain_to_user'
  }
}

async function maybeConfirmRisk(ctx, method, actArgs) {
  if (!MUTATING.has(method)) return { success: true, skipped: true }
  const riskPreview = classifyRisk({ ...actArgs, method })
  if (riskPreview.level === 'none') return { success: true, skipped: true, risk: riskPreview }
  return ensureActionConfirmation(ctx.projectId, {
    ...actArgs,
    method,
    window: service.resolveWindowRef(actArgs.window).window || actArgs.window
  })
}

async function maybeApproveApp(ctx, method, args) {
  if (!NEEDS_APP_APPROVAL.has(method)) return { success: true, skipped: true }
  let identityInput = {
    method,
    confirm_reason: args.confirm_reason,
    path: args.path || args.executable || args.executable_path,
    app: args.app || args.name || args.query,
    name: args.name || args.app
  }
  if (method !== 'launch_app') {
    const resolved = service.resolveWindowRef(windowArg(args))
    if (resolved.success) identityInput.window = resolved.window
  }
  // list 不需要；无任何身份时跳过
  const identity = resolveAppIdentity(identityInput)
  if (!identity.appKey && !identity.executable && method === 'get_window_state') {
    return { success: true, skipped: true }
  }
  return ensureAppApproval(ctx.projectId, identityInput)
}

function getControlActionLabel(method, args = {}) {
  const name = String(args.name || '').trim().slice(0, 60)
  switch (method) {
    case 'list_windows': return '正在查找已打开的窗口'
    case 'list_apps': return '正在查找可用应用'
    case 'launch_app': return `正在启动${name ? '「' + name + '」' : '应用'}`
    case 'activate_window': return '正在切换到目标窗口'
    case 'get_window_state': return '正在观察界面和控件'
    case 'click':
      return name
        ? `正在点击「${name}」`
        : (Number.isFinite(Number(args.x)) && Number.isFinite(Number(args.y))
            ? `正在点击坐标（${Math.round(Number(args.x))}, ${Math.round(Number(args.y))}）`
            : '正在点击控件')
    case 'drag': return '正在拖动'
    case 'scroll': return '正在滚动界面'
    case 'type_text': return `正在输入文字（${String(args.text ?? args.value ?? '').length} 字）`
    case 'press_key': return `正在按键${args.key ? '「' + String(args.key).slice(0, 40) + '」' : ''}`
    case 'set_value': return `正在填写${name ? '「' + name + '」' : '控件'}`
    case 'act': {
      const operation = String(args.operation || 'invoke')
      return `正在操作${name ? '「' + name + '」' : '控件'}（${operation}）`
    }
    default: return '正在执行桌面操作'
  }
}

async function beginControlUi(method, args, resultMeta = {}) {
  const resolved = service.resolveWindowRef(windowArg(args))
  const win = resolved.success ? resolved.window : null
  const label = win
    ? `${win.app || win.title || '窗口'}${win.title && win.app ? ' · ' + win.title : ''}`
    : (args.name || args.app || args.query || method)
  const actionLabel = getControlActionLabel(method, args)
  session.markActivity({
    app: win?.executable_path || args.path || args.app || '',
    label: String(label).slice(0, 80),
    method,
    actionLabel,
    phase: method === 'get_window_state' || method.startsWith('list_') ? 'observing' : 'acting',
    showOverlay: !method.startsWith('list_')
  })
  return { ...resultMeta, actionLabel }
}

function finishControlUi(method, args, result = {}) {
  session.markResult({
    method,
    actionLabel: getControlActionLabel(method, args),
    success: result?.success !== false,
    error: result?.error || '',
    showOverlay: !method.startsWith('list_')
  })
  return result
}

async function executeControlUi(method, args, task) {
  if (MUTATING.has(method) && method !== 'launch_app') {
    const observation = service.getObservationStatus(windowArg(args))
    if (!observation.success || !observation.observed) {
      return {
        success: false,
        method,
        observation_required: true,
        error: '目标窗口缺少近期观察结果。请先调用 get_window_state(include_text=true, include_screenshot=true)，定位到目标后再操作，禁止猜坐标。',
        window: observation.window || null,
        next_action: 'call_get_window_state_before_acting'
      }
    }
  }
  await beginControlUi(method, args)
  try {
    const result = await task()
    if (MUTATING.has(method) && method !== 'launch_app') service.invalidateObservation(windowArg(args))
    return finishControlUi(method, args, result)
  } catch (error) {
    if (MUTATING.has(method) && method !== 'launch_app') service.invalidateObservation(windowArg(args))
    finishControlUi(method, args, { success: false, error: error.message || String(error) })
    throw error
  }
}

async function runDesktopControl(args = {}, ctx = {}) {
  if (process.platform !== 'win32') {
    return {
      success: false,
      unsupported: true,
      error: 'desktop_control 目前仅支持 Windows',
      supported_methods: METHODS
    }
  }

  if (!settings.isEnabled()) return disabledResult()
  if (session.isInterrupted()) return interruptedResult()

  // 确保 overlay 订阅已绑定（主进程 IPC 注册时也会绑）
  try { overlay.bindSession() } catch (_) { /* ignore */ }

  const method = normalizeMethod(args)
  if (!method) {
    return {
      success: false,
      error: '需要 method 参数',
      supported_methods: METHODS,
      hint: 'list_windows → get_window_state(include_text=true) → act/click/type_text → 再 state 验证'
    }
  }

  if (!METHODS.includes(method)) {
    return {
      success: false,
      error: `不支持的 method: ${method}`,
      supported_methods: METHODS
    }
  }

  try {
    if (method === 'list_windows') {
      return await executeControlUi(method, args, () => service.listWindows({
        query: args.query || args.name || args.title || '',
        limit: args.limit,
        root_process_id: args.root_process_id || args.rootProcessId
      }))
    }

    if (method === 'list_apps') {
      return await executeControlUi(method, args, () => service.listApps({
        query: args.query || args.name || args.app || '',
        path: args.path,
        limit: args.limit
      }))
    }

    // 中断检查（list 之后的动作）
    if (session.isInterrupted()) return interruptedResult()

    if (method === 'launch_app') {
      const confirm = await maybeConfirmRisk(ctx, method, {
        operation: 'launch',
        name: args.name || args.app || args.query || args.path || '',
        confirm_reason: args.confirm_reason
      })
      if (!confirm.success) return confirm
      const approval = await maybeApproveApp(ctx, method, args)
      if (!approval.success) return approval
      if (session.isInterrupted()) return interruptedResult()
      return await executeControlUi(method, args, () => service.launchApp({
        name: args.name || args.app || args.query || '',
        path: args.path || args.executable || args.executable_path || '',
        args: args.args,
        cwd: args.cwd,
        visible: args.visible
      }))
    }

    if (method === 'activate_window') {
      const approval = await maybeApproveApp(ctx, method, args)
      if (!approval.success) return approval
      if (session.isInterrupted()) return interruptedResult()
      return await executeControlUi(method, args, () => service.activateWindow({ window: windowArg(args) }))
    }

    if (method === 'get_window_state') {
      const approval = await maybeApproveApp(ctx, method, args)
      if (!approval.success) return approval
      if (session.isInterrupted()) return interruptedResult()
      return await executeControlUi(method, args, () => service.getWindowState({
        window: windowArg(args),
        include_screenshot: args.include_screenshot,
        include_text: args.include_text !== false,
        max_nodes: args.max_nodes,
        max_depth: args.max_depth,
        activate: args.activate,
        node_preview: args.node_preview
      }))
    }

    if (method === 'click') {
      const actArgs = {
        window: windowArg(args),
        element_index: args.element_index ?? args.elementIndex,
        x: args.x,
        y: args.y,
        mouse_button: args.mouse_button || args.button,
        click_count: args.click_count || args.clickCount,
        wait_after_ms: args.wait_after_ms ?? args.waitAfterMs,
        name: args.name || args.target_name || args.targetName,
        role: args.role,
        automation_id: args.automation_id || args.automationId,
        coordinate_verified: args.coordinate_verified === true || args.coordinateVerified === true,
        coordinate_space: args.coordinate_space || args.coordinateSpace,
        confirm_reason: args.confirm_reason,
        operation: 'click'
      }
      const confirm = await maybeConfirmRisk(ctx, method, actArgs)
      if (!confirm.success) return confirm
      const approval = await maybeApproveApp(ctx, method, args)
      if (!approval.success) return approval
      if (session.isInterrupted()) return interruptedResult()
      return await executeControlUi(method, actArgs, () => service.click(actArgs))
    }

    if (method === 'drag') {
      const actArgs = {
        window: windowArg(args),
        from_x: args.from_x ?? args.fromX,
        from_y: args.from_y ?? args.fromY,
        to_x: args.to_x ?? args.toX,
        to_y: args.to_y ?? args.toY,
        wait_after_ms: args.wait_after_ms ?? args.waitAfterMs,
        confirm_reason: args.confirm_reason,
        operation: 'drag'
      }
      const confirm = await maybeConfirmRisk(ctx, method, actArgs)
      if (!confirm.success) return confirm
      const approval = await maybeApproveApp(ctx, method, args)
      if (!approval.success) return approval
      if (session.isInterrupted()) return interruptedResult()
      return await executeControlUi(method, actArgs, () => service.drag(actArgs))
    }

    if (method === 'scroll') {
      const actArgs = {
        window: windowArg(args),
        x: args.x,
        y: args.y,
        scrollX: args.scrollX ?? args.scroll_x,
        scrollY: args.scrollY ?? args.scroll_y,
        wait_after_ms: args.wait_after_ms ?? args.waitAfterMs,
        confirm_reason: args.confirm_reason,
        operation: 'scroll'
      }
      const confirm = await maybeConfirmRisk(ctx, method, actArgs)
      if (!confirm.success) return confirm
      const approval = await maybeApproveApp(ctx, method, args)
      if (!approval.success) return approval
      if (session.isInterrupted()) return interruptedResult()
      return await executeControlUi(method, actArgs, () => service.scroll(actArgs))
    }

    if (method === 'type_text') {
      const actArgs = {
        window: windowArg(args),
        text: args.text ?? args.value,
        element_index: args.element_index ?? args.elementIndex,
        name: args.name || args.target_name || args.targetName,
        role: args.role,
        automation_id: args.automation_id || args.automationId,
        x: args.x,
        y: args.y,
        coordinate_verified: args.coordinate_verified === true || args.coordinateVerified === true,
        coordinate_space: args.coordinate_space || args.coordinateSpace,
        submit: args.submit === true,
        submit_wait_after_ms: args.submit_wait_after_ms ?? args.submitWaitAfterMs,
        wait_after_ms: args.wait_after_ms ?? args.waitAfterMs,
        confirm_reason: args.confirm_reason,
        operation: 'type_text',
        value: args.text ?? args.value
      }
      const confirm = await maybeConfirmRisk(ctx, method, actArgs)
      if (!confirm.success) return confirm
      const approval = await maybeApproveApp(ctx, method, args)
      if (!approval.success) return approval
      if (session.isInterrupted()) return interruptedResult()
      return await executeControlUi(method, actArgs, () => service.typeText(actArgs))
    }

    if (method === 'press_key') {
      const actArgs = {
        window: windowArg(args),
        key: args.key,
        wait_after_ms: args.wait_after_ms ?? args.waitAfterMs,
        confirm_reason: args.confirm_reason,
        operation: 'press_key',
        name: args.key
      }
      const confirm = await maybeConfirmRisk(ctx, method, actArgs)
      if (!confirm.success) return confirm
      const approval = await maybeApproveApp(ctx, method, args)
      if (!approval.success) return approval
      if (session.isInterrupted()) return interruptedResult()
      return await executeControlUi(method, actArgs, () => service.pressKey(actArgs))
    }

    // act / set_value
    const operation = method === 'set_value'
      ? 'set_value'
      : (args.operation || args.op || 'invoke')

    const actArgs = {
      window: windowArg(args),
      element_index: args.element_index ?? args.elementIndex,
      name: args.name || args.text,
      role: args.role,
      automation_id: args.automation_id || args.automationId,
      operation,
      value: args.value,
      wait_after_ms: args.wait_after_ms ?? args.waitAfterMs,
      locator: args.locator,
      force_confirm: args.force_confirm,
      require_confirmation: args.require_confirmation,
      confirm_reason: args.confirm_reason
    }

    const confirm = await maybeConfirmRisk(ctx, method, actArgs)
    if (!confirm.success) return confirm
    const approval = await maybeApproveApp(ctx, method, args)
    if (!approval.success) return approval
    if (session.isInterrupted()) return interruptedResult()
    return await executeControlUi(method, actArgs, () => service.act(actArgs))
  } catch (error) {
    return {
      success: false,
      method,
      error: error.message || String(error)
    }
  }
}

const handlers = {
  desktop_control: runDesktopControl
}

module.exports = {
  handlers,
  runDesktopControl,
  METHODS
}
