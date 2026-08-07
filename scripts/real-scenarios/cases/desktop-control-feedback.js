const fs = require('fs')
const path = require('path')

module.exports = {
  id: 'desktop-control-feedback',
  title: 'Desktop control: observed target evidence and live user feedback',
  tags: ['desktop', 'vision', 'feedback', 'ipc'],
  changedFilePatterns: [
    /^electron\/modules\/desktop-control\//i,
    /^electron\/modules\/tool-handlers\/desktop-control\.js$/i,
    /^electron\/modules\/schemas\/desktop-control\.js$/i,
    /^electron\/modules\/chat\/tool-result-summarizer\.js$/i,
    /^electron\/modules\/capability-tiers\.js$/i,
    /^electron\/preload\.js$/i,
    /^frontend\/scripts\/features\/desktop-control-settings\.js$/i,
    /^frontend\/scripts\/features\/(ask-popup-handler|ipc-exec-system-listeners)\.js$/i,
    /^frontend\/styles\/desktop-control\.css$/i,
    /^frontend\/index\.html$/i
  ],

  async run(ctx) {
    const schemaCatalog = require(path.join(ctx.root, 'electron/modules/schemas'))
    const desktopSchema = schemaCatalog.MODEL_TOOLS_SCHEMA.find(item => item.function?.name === 'desktop_control')
    const description = String(desktopSchema?.function?.description || '')
    ctx.assert.ok(description.includes('观察 → 定位 → 动作 → 再观察验证'), 'schema must require observe-first workflow')
    ctx.assert.ok(description.includes('image_analyze'), 'schema must direct screenshot analysis when UIA is insufficient')
    ctx.assert.ok(description.includes('禁止猜坐标'), 'schema must forbid blind coordinate guesses')

    const summarizer = require(path.join(ctx.root, 'electron/modules/chat/tool-result-summarizer'))
    const tree = Array.from({ length: 2200 }, (_, index) => `[${index}] button: control-${index}`).join('\n')
    const state = summarizer.summarizeToolResultForModel('desktop_control', {
      success: true,
      method: 'get_window_state',
      screenshots: [{ path: 'C:/temp/desktop-window.png' }],
      accessibility: {
        tree,
        nodes: Array.from({ length: 220 }, (_, index) => ({ index, name: `control-${index}`, role: 'button' })),
        node_count: 220,
        document_text: 'x'.repeat(9000)
      }
    })
    ctx.assert.ok(!state.preview, 'desktop state must not collapse to generic 150-char preview')
    ctx.assert.ok(state.accessibility.tree.length > 150, 'desktop tree evidence must remain available to the model')
    ctx.assert.equal(state.accessibility.nodes.length, 160, 'node preview must retain a useful bounded set')
    ctx.assert.equal(state.observation_guidance.screenshot_path, 'C:/temp/desktop-window.png')
    ctx.assert.ok(state.observation_guidance.instruction.includes('禁止猜坐标'))

    const settings = require(path.join(ctx.root, 'electron/modules/desktop-control/settings'))
    const originalIsEnabled = settings.isEnabled
    settings.isEnabled = () => true
    try {
      const capabilityTiers = require(path.join(ctx.root, 'electron/modules/capability-tiers'))
      const allow = capabilityTiers.getAdaptiveToolAllowSet('继续桌面任务')
      ctx.assert.ok(allow.has('image_analyze'), 'vision bridge must be visible while desktop control is enabled')
    } finally {
      settings.isEnabled = originalIsEnabled
    }

    const service = require(path.join(ctx.root, 'electron/modules/desktop-control/service'))
    service.resetForTests()
    service.rememberWindows([{ id: 'test-window', handle: '123', title: '测试窗口', app: 'test.exe' }])
    const unobserved = service.getObservationStatus({ id: 'test-window' })
    ctx.assert.equal(unobserved.success, true)
    ctx.assert.equal(unobserved.observed, false, 'mutating actions must not treat an unseen window as observed')

    const uiaAdapter = require(path.join(ctx.root, 'electron/modules/windows-uia-runtime-adapter'))
    const originalRunPowerShell = uiaAdapter.runPowerShell
    const inputCalls = []
    try {
      uiaAdapter.runPowerShell = async (action, payload = {}) => {
        inputCalls.push({ action, payload: { ...payload } })
        if (action === 'inspect') {
          return {
            success: true,
            nodes: [[{
              index: 0,
              role: 'window',
              name: 'NetEase Cloud Music',
              enabled: true,
              offscreen: false,
              focusable: false,
              rect: { x: 831, y: 152, width: 1058, height: 752 }
            }]]
          }
        }
        if (action === 'bounds') {
          return { success: true, left: 831, top: 152, width: 1058, height: 752 }
        }
        if (action === 'click') {
          return { success: true, performed: 'click', x: payload.x, y: payload.y }
        }
        if (action === 'press_key') {
          if (payload.key === 'Control_L+f') {
            return {
              success: true,
              performed: 'press_key',
              key: payload.key,
              key_injected: true,
              effect_verified: false,
              after_minimized: true,
              unexpected_window_state_change: true,
              recovered: true
            }
          }
          return { success: true, performed: 'press_key', key: payload.key, key_injected: true, effect_verified: false }
        }
        if (action === 'type_text') {
          return { success: true, performed: 'type_text', length: String(payload.text || '').length }
        }
        return { success: true }
      }

      await service.getWindowState({
        window: { id: 'test-window' },
        include_text: true,
        include_screenshot: false
      })
      const correctedClick = await service.click({
        window: { id: 'test-window' },
        x: 1254,
        y: 192,
        coordinate_verified: true
      })
      ctx.assert.equal(correctedClick.success, true)
      ctx.assert.equal(correctedClick.coordinate_conversion?.converted?.x, 423, 'screen x must convert to window-relative x')
      ctx.assert.equal(correctedClick.coordinate_conversion?.converted?.y, 40, 'screen y must convert to window-relative y')
      const clickCall = inputCalls.find(call => call.action === 'click')
      ctx.assert.equal(clickCall?.payload?.x, 423)
      ctx.assert.equal(clickCall?.payload?.y, 40)

      inputCalls.length = 0
      const searched = await service.typeText({
        window: { id: 'test-window' },
        x: 423,
        y: 40,
        coordinate_verified: true,
        text: '周杰伦',
        submit: true
      })
      ctx.assert.equal(searched.success, true)
      ctx.assert.equal(searched.submitted, true)
      ctx.assert.equal(searched.targeting_method, 'verified_coordinate')
      ctx.assert.equal(
        inputCalls.filter(call => ['click', 'type_text', 'press_key'].includes(call.action))
          .map(call => call.action + ':' + (call.payload.key || call.payload.text || (call.payload.x + ',' + call.payload.y))).join('|'),
        'click:423,40|type_text:周杰伦|press_key:Return',
        'verified coordinate click, text and submit must execute as one bounded sequence'
      )

      inputCalls.length = 0
      const focusResult = await service.pressKey({ window: { id: 'test-window' }, key: 'Control_L+f' })
      ctx.assert.equal(focusResult.success, false, 'unexpected minimization must fail the shortcut action')
      ctx.assert.equal(focusResult.key_injected, true, 'failure must distinguish injected key from verified effect')
      ctx.assert.equal(focusResult.effect_verified, false)
      ctx.assert.equal(focusResult.unexpected_window_state_change, true)
      ctx.assert.equal(focusResult.window_recovered, true)
      ctx.assert.ok(focusResult.error.includes('已阻止后续盲目输入'))

      const blindType = await service.typeText({
        window: { id: 'test-window' },
        text: '林俊杰',
        use_current_focus: true
      })
      ctx.assert.equal(blindType.success, false, 'a key injection must never create a reusable focus lease')
      ctx.assert.equal(blindType.target_required, true)
    } finally {
      uiaAdapter.runPowerShell = originalRunPowerShell
      service.resetForTests()
    }

    const session = require(path.join(ctx.root, 'electron/modules/desktop-control/session'))
    session.resetForTests()

    const originalDesktopEnabled = settings.isEnabled
    settings.isEnabled = () => true
    try {
      service.resetForTests()
      service.rememberWindows([{
        handle: 321,
        title: '未观察测试窗口',
        app: 'notepad.exe',
        executable_path: 'C:/Windows/notepad.exe'
      }])
      session.allowAppSession('C:/Windows/notepad.exe')
      const desktopHandler = require(path.join(ctx.root, 'electron/modules/tool-handlers/desktop-control'))
      const blindClick = await desktopHandler.runDesktopControl({
        method: 'click',
        window: { id: '321' },
        x: 10,
        y: 10
      }, { projectId: 'desktop-control-feedback-test' })
      ctx.assert.equal(blindClick.observation_required, true, 'unobserved click must be rejected before input injection')
    } finally {
      settings.isEnabled = originalDesktopEnabled
      service.resetForTests()
      session.resetForTests()
    }
    const events = []
    const unsubscribe = session.onActivity(event => events.push(event))
    try {
      session.markActivity({
        method: 'click',
        actionLabel: '正在点击「登录」',
        label: 'Chrome · 登录',
        phase: 'acting'
      })
      ctx.assert.equal(session.getStatus().active, true)
      ctx.assert.equal(events.at(-1).kind, 'started')
      ctx.assert.equal(events.at(-1).lastActionLabel, '正在点击「登录」')

      session.markResult({
        method: 'click',
        actionLabel: '正在点击「登录」',
        success: true
      })
      ctx.assert.equal(session.getStatus().phase, 'completed')
      ctx.assert.equal(events.at(-1).kind, 'result')
      ctx.assert.equal(events.at(-1).success, true)
    } finally {
      unsubscribe()
      session.resetForTests()
    }

    const pathPermissions = require(path.join(ctx.root, 'electron/modules/path-permissions'))
    const projects = require(path.join(ctx.root, 'electron/modules/projects'))
    const tools = require(path.join(ctx.root, 'electron/modules/tools'))
    const appApproval = require(path.join(ctx.root, 'electron/modules/desktop-control/app-approval'))
    const confirmations = require(path.join(ctx.root, 'electron/modules/desktop-control/confirmations'))
    const originalGetPermissionSettings = pathPermissions.getSettings
    const originalGetProjectWebContents = projects.getWebContentsForProject
    const originalWaitForAskResponse = tools.waitForAskResponse
    const originalIsAppAllowed = session.isAppAllowed
    try {
      pathPermissions.getSettings = () => ({ mode: 'full', rules: [] })
      const fullAppApproval = await appApproval.ensureAppApproval('desktop-control-feedback-test', { app: 'notepad.exe' })
      ctx.assert.equal(fullAppApproval.reason, 'full_access_mode', 'full authorization must skip per-app popup')
      const fullRiskApproval = await confirmations.ensureActionConfirmation('desktop-control-feedback-test', {
        operation: 'delete',
        name: 'delete item'
      })
      ctx.assert.equal(fullRiskApproval.reason, 'full_access_mode', 'full authorization must skip risk popup')

      let waiterRegistered = false
      let sentPopup = null
      pathPermissions.getSettings = () => ({ mode: 'ask', rules: [] })
      session.isAppAllowed = () => false
      tools.waitForAskResponse = () => {
        waiterRegistered = true
        return Promise.resolve({ success: true, value: 'once' })
      }
      projects.getWebContentsForProject = () => ({
        isDestroyed: () => false,
        send: (channel, payload) => {
          ctx.assert.equal(waiterRegistered, true, 'ask waiter must be registered before popup is sent')
          ctx.assert.equal(channel, 'show-ask-popup')
          sentPopup = payload
        }
      })
      const asked = await appApproval.ensureAppApproval('desktop-control-feedback-test', { app: 'notepad.exe' })
      ctx.assert.equal(asked.success, true)
      ctx.assert.equal(sentPopup?.type, 'desktop_control_app_approval')
    } finally {
      pathPermissions.getSettings = originalGetPermissionSettings
      projects.getWebContentsForProject = originalGetProjectWebContents
      tools.waitForAskResponse = originalWaitForAskResponse
      session.isAppAllowed = originalIsAppAllowed
    }

    const preload = fs.readFileSync(path.join(ctx.root, 'electron/preload.js'), 'utf8')
    const frontend = fs.readFileSync(path.join(ctx.root, 'frontend/scripts/features/desktop-control-settings.js'), 'utf8')
    const askListener = fs.readFileSync(path.join(ctx.root, 'frontend/scripts/features/ipc-exec-system-listeners.js'), 'utf8')
    const askHandler = fs.readFileSync(path.join(ctx.root, 'frontend/scripts/features/ask-popup-handler.js'), 'utf8')
    const handler = fs.readFileSync(path.join(ctx.root, 'electron/modules/tool-handlers/desktop-control.js'), 'utf8')
    const desktopSchemaSource = fs.readFileSync(path.join(ctx.root, 'electron/modules/schemas/desktop-control.js'), 'utf8')
    const css = fs.readFileSync(path.join(ctx.root, 'frontend/styles/desktop-control.css'), 'utf8')
    ctx.assert.ok(preload.includes('onDesktopControlActivity'), 'preload must expose live activity listener')
    ctx.assert.ok(frontend.includes('desktopControlLiveStatus'), 'frontend must render a live desktop-control banner')
    ctx.assert.ok(askListener.includes("data?.requestId && data?.question && Array.isArray(data?.options)"), 'generic authorization events must render a visible popup')
    ctx.assert.ok(askHandler.includes("type: meta?.type || 'plan'"), 'popup response must preserve desktop authorization type')
    ctx.assert.ok(frontend.includes('interruptDesktopControl'), 'live banner must provide a stop action')
    ctx.assert.ok(handler.includes('executeControlUi'), 'all desktop actions must share start/result feedback')
    ctx.assert.ok(!handler.includes('keyboardContinuation'), 'keyboard injection must never bypass the fresh-observation gate')
    ctx.assert.ok(!desktopSchemaSource.includes('focus_shortcut'), 'schema must not teach guessed shortcut focus')
    ctx.assert.ok(desktopSchemaSource.includes('禁止猜 Ctrl+F/Ctrl+K/Ctrl+L'), 'schema must explicitly reject app-specific shortcut guessing')
    ctx.assert.ok(desktopSchemaSource.includes('coordinate_verified=true, text, submit=true'), 'schema must teach the verified-coordinate one-call input flow')
    ctx.assert.ok(desktopSchemaSource.includes('不能把 window.rect 的 x/y 加进去') || desktopSchemaSource.includes('绝对不要加 window.rect.x'), 'schema must prevent screen/window coordinate mixing')
    ctx.assert.ok(handler.includes('observation_required'), 'mutating actions must reject blind clicks')
    ctx.assert.ok(handler.includes('invalidateObservation'), 'each mutating action must require a fresh observation')
    ctx.assert.ok(css.includes('.desktop-control-live-status'), 'live banner must have dedicated styles')
  }
}
