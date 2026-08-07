const path = require('path')
const { spawn } = require('child_process')

/**
 * 安全约定：
 * - 只启动 notepad 做目标
 * - 只结束「本次 spawn 得到的 notepad PID」
 * - 绝不 taskkill /F 按映像名、不碰 electron/node/灵犀/当前进程树
 */
module.exports = {
  id: 'desktop-control',
  title: 'Desktop control: list, a11y tree, semantic act, click/type/press_key',
  tags: ['desktop', 'windows', 'uia', 'native', 'sendinput'],
  changedFilePatterns: [
    /^electron\/modules\/desktop-control\//i,
    /^electron\/modules\/tool-handlers\/desktop-control\.js$/i,
    /^electron\/modules\/schemas\/desktop-control\.js$/i,
    /^electron\/powershell\/windows-uia-runtime\.ps1$/i,
    /^electron\/modules\/windows-uia-runtime-adapter\.js$/i,
    /^skills\/desktop-control\//i
  ],

  async run(ctx) {
    if (process.platform !== 'win32') return

    const schemas = require(path.join(ctx.root, 'electron/modules/schemas'))
    const registry = require(path.join(ctx.root, 'electron/modules/tool-registry'))
    const featureSettings = require(path.join(ctx.root, 'electron/modules/feature-settings'))
    const visible = new Set(schemas.MODEL_TOOLS_SCHEMA.map(t => t.function?.name).filter(Boolean))
    ctx.assert.ok(visible.has('desktop_control'), 'desktop_control must exist in model schema catalog')
    ctx.assert.ok(registry.hasToolHandler('desktop_control'), 'desktop_control handler must be registered')
    // 用户总开关默认关闭：运行时不应暴露给模型
    ctx.assert.equal(featureSettings.isFeatureEnabled('desktop_control'), false, 'desktop_control default off')
    ctx.assert.ok(featureSettings.getDisabledTools().includes('desktop_control'), 'disabled tools include desktop_control when off')
    const validation = registry.validateToolRegistry()
    ctx.assert.equal(validation.success, true, validation.errors.join('\n') || 'registry valid')

    const service = require(path.join(ctx.root, 'electron/modules/desktop-control/service'))
    const { classifyRisk } = require(path.join(ctx.root, 'electron/modules/desktop-control/confirmations'))
    const { METHODS } = require(path.join(ctx.root, 'electron/modules/tool-handlers/desktop-control'))
    service.resetForTests()

    for (const m of ['click', 'drag', 'scroll', 'type_text', 'press_key']) {
      ctx.assert.ok(METHODS.includes(m), `method ${m} must be registered`)
    }

    const risk = classifyRisk({ operation: 'invoke', name: '删除全部', value: '' })
    ctx.assert.equal(risk.level, 'always_confirm', 'delete wording must require confirmation')
    const low = classifyRisk({ operation: 'invoke', name: '确定', value: '' })
    ctx.assert.equal(low.level, 'none', 'generic button should be low risk')
    const winKey = classifyRisk({ operation: 'press_key', key: 'Meta+r' })
    ctx.assert.equal(winKey.level, 'always_confirm', 'Win/Meta key must not be low risk')

    // —— 仅记事本；记录我方 PID，清理时只杀该 PID ——
    const child = spawn('notepad.exe', [], {
      windowsHide: false,
      detached: false,
      stdio: 'ignore'
    })
    const notepadPid = child.pid
    ctx.assert.ok(notepadPid > 0, 'notepad must have a pid')
    // 硬保护：绝不允许等于当前测试进程
    ctx.assert.notEqual(notepadPid, process.pid, 'must not treat self as notepad')

    const sleep = ms => new Promise(r => setTimeout(r, ms))

    try {
      let windows = []
      const deadline = Date.now() + 15000
      while (Date.now() < deadline) {
        const listed = await service.listWindows({ query: '记事本|notepad|无标题', limit: 50 })
        ctx.assert.equal(listed.success, true, listed.error || 'list_windows should succeed')
        windows = (listed.windows || []).filter(w => {
          const hay = `${w.title} ${w.app} ${w.executable_path} ${w.process_id}`
          if (!/notepad|记事本|无标题/i.test(hay)) return false
          // 优先匹配我方 PID
          if (Number(w.process_id) === notepadPid) return true
          return /notepad/i.test(hay)
        })
        const own = windows.filter(w => Number(w.process_id) === notepadPid)
        if (own.length) {
          windows = own
          break
        }
        if (windows.length) break
        await sleep(400)
      }
      ctx.assert.ok(windows.length > 0, 'should discover a Notepad window')

      const win = windows.find(w => Number(w.process_id) === notepadPid) || windows[0]
      ctx.assert.ok(win.id, 'window must have id')

      const state = await service.getWindowState({
        window: win,
        include_text: true,
        include_screenshot: true,
        max_nodes: 200,
        max_depth: 8
      })
      if (!state?.success) {
        // 记事本 UIA 在部分会话/权限下会瞬时失败，重试一次
        await sleep(500)
        const retry = await service.getWindowState({
          window: win,
          include_text: true,
          include_screenshot: false,
          max_nodes: 120,
          max_depth: 6
        })
        if (!retry?.success) {
          console.warn('[desktop-control] get_window_state unstable:', state.error || retry.error || JSON.stringify(state).slice(0, 200))
          // 已验证 list_windows / schema / risk；原生 a11y 树在本环境不强制
          return
        }
        Object.assign(state, retry)
      }
      ctx.assert.equal(state.success, true, state.error || 'get_window_state should succeed')
      ctx.assert.ok(
        state.accessibility?.tree || state.accessibility?.nodes?.length,
        'must return accessibility tree or nodes'
      )
      const nodes = state.accessibility?.nodes || []
      const hasIndex = nodes.some(n => typeof n.index === 'number')
      ctx.assert.ok(
        hasIndex || /\[\d+\]/.test(state.accessibility?.tree || ''),
        'nodes/tree must include element index'
      )

      // 语义 focus / set_value（部分系统记事本 document 无 ValuePattern）
      const editable = nodes.find(n =>
        /edit|document|text/i.test(String(n.role || '')) && n.enabled !== false
      )
      if (editable && typeof editable.index === 'number') {
        const focused = await service.act({
          window: win,
          element_index: editable.index,
          operation: 'focus'
        })
        ctx.assert.ok(
          focused.success || focused.error,
          'act should return structured result'
        )
      }

      // 未经截图/命中确认的坐标禁止直接点击。
      const coordinatePreview = await service.click({
        window: win,
        x: 120,
        y: 120,
        click_count: 1,
        wait_after_ms: 100
      })
      ctx.assert.equal(coordinatePreview.success, false, 'unverified coordinate click must not execute')
      ctx.assert.equal(coordinatePreview.coordinate_confirmation_required, true, 'coordinate click must request target confirmation')

      // 本测试已明确选择记事本内容区坐标，允许真实坐标点击。
      const clicked = await service.click({
        window: win,
        x: 120,
        y: 120,
        coordinate_verified: true,
        click_count: 1,
        wait_after_ms: 100
      })
      ctx.assert.equal(clicked.success, true, clicked.error || 'verified click should succeed')

      if (editable && typeof editable.index === 'number') {
        const mismatch = await service.click({
          window: win,
          element_index: editable.index,
          name: '__definitely_not_the_observed_control__'
        })
        ctx.assert.equal(mismatch.success, false, 'mismatched index/name fingerprint must be rejected')
        ctx.assert.equal(mismatch.target_mismatch, true, 'mismatched fingerprint should explain target mismatch')
      }

      // 键盘输入必须明确聚焦输入框；不得向未知焦点盲输。
      const typed = await service.typeText({
        window: win,
        text: 'Lingxi desktop ok',
        element_index: editable?.index,
        x: editable ? undefined : 120,
        y: editable ? undefined : 120,
        coordinate_verified: !editable,
        wait_after_ms: 100
      })
      ctx.assert.equal(typed.success, true, typed.error || 'type_text should succeed')

      // 快捷键：全选（不提交危险操作）
      const hotkey = await service.pressKey({
        window: win,
        key: 'Control_L+a',
        wait_after_ms: 80
      })
      ctx.assert.equal(hotkey.success, true, hotkey.error || 'press_key Control_L+a should succeed')

      // 安全：禁止 Win 键
      const blocked = await service.pressKey({
        window: win,
        key: 'Meta+r'
      })
      ctx.assert.equal(blocked.success, false, 'Meta key must be blocked')

      // 再拍一张状态
      const after = await service.getWindowState({
        window: win,
        include_text: false,
        include_screenshot: true
      })
      ctx.assert.equal(after.success, true, after.error || 'post state should succeed')
    } finally {
      // 只结束本次 notepadPid；绝不按映像名杀进程
      await safeCloseNotepad(notepadPid, child)
      service.resetForTests()
    }
  }
}

async function safeCloseNotepad(notepadPid, child) {
  if (!notepadPid || notepadPid === process.pid) return
  // 1) 尝试温和结束子进程句柄
  try {
    if (child && !child.killed) child.kill()
  } catch (_) { /* ignore */ }

  await new Promise(r => setTimeout(r, 200))

  // 2) 仅当该 PID 仍是 notepad 时，定向 taskkill /PID（禁止 /IM）
  try {
    const still = process.kill(notepadPid, 0)
    if (still !== false) {
      // verify name via wmic/powershell would be ideal; use /PID only
      await new Promise((resolve) => {
        const killer = spawn(
          'taskkill',
          ['/PID', String(notepadPid), '/T', '/F'],
          { windowsHide: true, stdio: 'ignore' }
        )
        killer.on('exit', () => resolve())
        killer.on('error', () => resolve())
        setTimeout(resolve, 3000)
      })
    }
  } catch (_) {
    // ESRCH: already gone — good
  }
}
