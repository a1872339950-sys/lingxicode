const fs = require('fs')
const path = require('path')
const { spawn } = require('child_process')

module.exports = {
  id: 'runtime-verify-e2e',
  title: 'Runtime verify closes semantic inspection, interaction, visual evidence and F12 errors through one path',
  tags: ['runtime', 'electron', 'e2e', 'browser', 'interaction'],
  changedFilePatterns: [
    /^electron\/modules\/tool-handlers\/website-research\.js$/i,
    /^electron\/modules\/runtime-diagnostics\.js$/i,
    /^electron\/modules\/schemas\/screenshot-image\.js$/i
  ],

  async run(ctx) {
    const workspace = ctx.createWorkspace(this.id)
    const childPath = path.join(ctx.root, 'scripts', `.tmp-runtime-e2e-child-${process.pid}.js`)
    const resultPath = path.join(workspace.dir, 'result.json')
    const donePath = path.join(workspace.dir, 'done')
    const logPath = path.join(workspace.dir, 'stages.log')
    const pagePath = path.join(workspace.dir, 'runtime.html')
    const blankPath = path.join(workspace.dir, 'blank.html')
    ctx.writeText(pagePath, '<!doctype html><meta charset="utf-8"><style>body{font:16px Arial;padding:32px;background:#fff}#panel{display:none;margin-top:20px;padding:24px;background:#bdebd2}#panel.open{display:block}#hidden-parent{display:none}#hidden-child{display:block}#clip-parent{position:absolute;left:0;top:0;width:20px;height:20px;overflow:hidden}#clipped-child{position:absolute;left:80px;top:80px;width:20px;height:20px}</style><h1>Runtime before</h1><button id="open" aria-label="Open panel">Open panel</button><section id="panel"></section><div id="hidden-parent"><button id="hidden-action">Hidden action</button><div class="middle"><div id="hidden-child">Hidden child</div></div></div><div id="clip-parent"><div id="clipped-child">Clipped child</div></div><script>document.getElementById("open").onclick=()=>{const panel=document.getElementById("panel");panel.classList.add("open");setTimeout(()=>{panel.innerHTML="<div>Updated panel</div>"},450)}</script>')
    ctx.writeText(blankPath, '<!doctype html><title>Empty runtime</title>')
    const electronPath = require('electron')
    const rootLiteral = JSON.stringify(ctx.root)
    const storageLiteral = JSON.stringify(workspace.storagePath)
    const resultLiteral = JSON.stringify(resultPath)
    const doneLiteral = JSON.stringify(donePath)
    const logLiteral = JSON.stringify(logPath)
    const pageLiteral = JSON.stringify(pagePath)
    const blankLiteral = JSON.stringify(blankPath)

    ctx.writeText(childPath, `
      const fs = require('fs')
      const path = require('path')
      const { pathToFileURL } = require('url')
      const { app, BrowserWindow } = require('electron')
      const root = ${rootLiteral}
      const storagePath = ${storageLiteral}
      const resultPath = ${resultLiteral}
      const donePath = ${doneLiteral}
      const logPath = ${logLiteral}
      const pagePath = ${pageLiteral}
      const blankPath = ${blankLiteral}
      app.setPath('userData', path.join(storagePath, 'electron-user-data'))
      app.disableHardwareAcceleration()
      app.commandLine.appendSwitch('disable-gpu')
      app.commandLine.appendSwitch('disable-gpu-compositing')
      const loadFileReady = async (win, filePath, expectedSelector = '') => {
        const targetUrl = pathToFileURL(filePath).href
        try {
          await Promise.race([
            win.loadURL(targetUrl),
            new Promise((resolve, reject) => setTimeout(() => reject(new Error('load timeout: ' + targetUrl)), 8000))
          ])
        } catch (error) {
          await new Promise(resolve => setTimeout(resolve, 80))
          const selectorLiteral = JSON.stringify(expectedSelector)
          const stateScript = "({ ready: document.readyState === 'interactive' || document.readyState === 'complete', url: location.href, expected: " + selectorLiteral + " ? !!document.querySelector(" + selectorLiteral + ") : true })"
          const state = await win.webContents.executeJavaScript(stateScript).catch(() => ({ ready: false, url: '', expected: false }))
          if (!state.ready || state.url !== targetUrl || !state.expected) throw error
        }
      }
      const mark = label => fs.appendFileSync(logPath, new Date().toISOString() + ' ' + label + '\\n', 'utf8')
      mark('script-started')

      app.whenReady().then(async () => {
        mark('app-ready')
        try {
          const storageConfig = require(path.join(root, 'electron/modules/storage-config'))
          const { runtimeVerify } = require(path.join(root, 'electron/modules/tool-handlers/website-research'))
          const runtimeDiagnostics = require(path.join(root, 'electron/modules/runtime-diagnostics'))
          const runtimeTargets = require(path.join(root, 'electron/modules/runtime-targets'))
          storageConfig.init(storagePath, { isPackaged: true, getPath: () => path.dirname(storagePath) })
          runtimeDiagnostics.install(app)
          const liveWindow = new BrowserWindow({ show: false, width: 900, height: 600 })
          await loadFileReady(liveWindow, pagePath, '#open')
          mark('live-loaded')
          runtimeTargets.registerBrowserWindow(liveWindow, {
            runtimeId: 'runtime-e2e-live', projectId: 'runtime-e2e', source: 'scenario-live'
          })
          const hiddenTarget = await runtimeVerify({
            runtime_id: 'runtime-e2e-live', capture_evidence: false,
            interaction: { click_locator: { selector: '#hidden-action' }, wait_for_locator_ms: 0, wait_after_click_ms: 0 },
            observe_ms: 0
          }, { projectId: 'runtime-e2e', resolvePath: input => input })
          mark('hidden-finished')
          const missingTarget = await runtimeVerify({
            runtime_id: 'runtime-e2e-live', capture_evidence: false,
            interaction: { click_locator: { selector: '#missing-action' }, wait_for_locator_ms: 0, wait_after_click_ms: 0 },
            observe_ms: 0
          }, { projectId: 'runtime-e2e', resolvePath: input => input })
          mark('missing-finished')
          const blankWindow = new BrowserWindow({ show: false, width: 900, height: 600 })
          await loadFileReady(blankWindow, blankPath)
          runtimeTargets.registerBrowserWindow(blankWindow, {
            runtimeId: 'runtime-e2e-blank', projectId: 'runtime-e2e', source: 'scenario-blank'
          })
          const blankTarget = await runtimeVerify({
            runtime_id: 'runtime-e2e-blank', capture_evidence: false,
            interaction: { click_locator: { selector: '#missing-action' }, wait_for_locator_ms: 0, wait_after_click_ms: 0 },
            observe_ms: 0
          }, { projectId: 'runtime-e2e', resolvePath: input => input })
          mark('blank-finished')
          blankWindow.destroy()
          const inspection = await runtimeVerify({
            runtime_id: 'runtime-e2e-live', capture_evidence: false,
            claim: 'the registered development runtime exposes the inspected controls',
            assertions: [
              { selector: '#open', property: 'visible', operator: 'equals', expected: true }
            ],
            inspect_selectors: ['h1', '#open', '#panel', '#hidden-child', '#clipped-child'], observe_ms: 0
          }, {
            projectId: 'runtime-e2e', resolvePath: input => input
          })
          mark('inspection-finished')
          const incomplete = await runtimeVerify({
            runtime_id: 'runtime-e2e-live', capture_evidence: false, observe_ms: 0
          }, { projectId: 'runtime-e2e', resolvePath: input => input })
          mark('incomplete-finished')
          await liveWindow.webContents.executeJavaScript(\`
            document.body.style.background = '#eefaf3';
            document.querySelector('h1').textContent = 'Runtime after';
          \`)
          const passed = await runtimeVerify({
            runtime_id: 'runtime-e2e-live',
            claim: 'opening the panel renders visible non-zero detail content',
            assertions: [
              { selector: '#panel', property: 'visible', operator: 'equals', expected: true },
              { selector: '#panel', property: 'offsetHeight', operator: 'gt', expected: 0 },
              { selector: '#panel', property: 'display', operator: 'not_equals', expected: 'none' },
              { selector: '#panel', property: 'text', operator: 'includes', expected: 'Updated panel' }
            ],
            interaction: {
              click_locator: { role: 'button', name: 'Open panel' },
              input_mode: 'pointer',
              expected_visible_selector: '#panel',
              inspect_selectors: ['h1', '#open', '#panel'],
              require_visual_change: true
            }
          }, { projectId: 'runtime-e2e', resolvePath: input => input })
          mark('passed-finished')
          await liveWindow.webContents.executeJavaScript("console.error('Intentional F12 runtime failure')")
          await new Promise(resolve => setTimeout(resolve, 80))
          const failed = await runtimeVerify({
            runtime_id: 'runtime-e2e-live', runtime_since_ms: 60000, capture_evidence: false, observe_ms: 0
          }, { projectId: 'runtime-e2e', resolvePath: input => input })
          mark('live-error-finished')
          liveWindow.destroy()
          fs.writeFileSync(resultPath, JSON.stringify({ inspection, incomplete, failed, passed, hiddenTarget, missingTarget, blankTarget }), 'utf8')
        } catch (error) {
          fs.writeFileSync(resultPath, JSON.stringify({ fatal: error.stack || error.message }), 'utf8')
        } finally {
          fs.writeFileSync(donePath, 'done', 'utf8')
          app.quit()
        }
      })
    `)

    try {
      const child = spawn(electronPath, ['--disable-gpu', '--disable-gpu-compositing', childPath], {
        cwd: ctx.root,
        windowsHide: true,
        detached: false,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true', ELECTRON_DISABLE_GPU: '1' }
      })
      let childExit = null
      let childOutput = ''
      child.stdout.on('data', chunk => { childOutput += chunk.toString() })
      child.stderr.on('data', chunk => { childOutput += chunk.toString() })
      child.on('exit', (code, signal) => { childExit = { code, signal } })
      const deadline = Date.now() + 60000
      while (!fs.existsSync(donePath) && !childExit && Date.now() < deadline) {
        await new Promise(resolve => setTimeout(resolve, 100))
      }
      if (!fs.existsSync(donePath)) child.kill()
      const stageLog = fs.existsSync(logPath) ? fs.readFileSync(logPath, 'utf8').trim() : 'no stage log'
      ctx.assert.ok(fs.existsSync(donePath), `Electron runtime scenario should finish within 60 seconds; exit=${JSON.stringify(childExit)}; stages: ${stageLog}; output: ${childOutput.slice(-3000)}`)
      ctx.assert.ok(fs.existsSync(resultPath), 'Electron runtime scenario should write a result')
      const result = JSON.parse(fs.readFileSync(resultPath, 'utf8'))
      ctx.assert.equal(result.fatal, undefined, result.fatal || 'runtime scenario should not throw')
      ctx.assert.equal(result.inspection.verification_status, 'passed', 'live semantic inspection should pass before the UI change')
      ctx.assert.equal(result.failed.verification_status, 'failed', 'F12 console error should fail the interaction closure')
      ctx.assert.equal(result.incomplete.verification_status, 'incomplete', 'generic runtime health without a claim/assertion contract must not pass')
      ctx.assert.equal(result.incomplete.error_type, 'verification_assertions_missing', 'incomplete generic checks should explain the missing contract')
      ctx.assert.ok(result.failed.runtimeDiagnostics?.events?.some(item => /Intentional F12 runtime failure/.test(item.message)), 'the exact historical F12 error should be returned for the selected live window')
      ctx.assert.equal(result.passed.verification_status, 'passed', 'the same semantic interaction should pass after the runtime error is fixed')
      ctx.assert.equal(result.passed.visualChanges?.changed, true, 'semantic click should produce a measured visual change')
      ctx.assert.equal(result.passed.click?.role, 'button', 'semantic role/name locator should resolve the button')
      ctx.assert.equal(result.passed.click?.action_fidelity, 'native_pointer', 'pointer mode must use Electron native mouse input')
      ctx.assert.ok(result.passed.assertion_wait?.waited_ms >= 400, 'verification must wait for delayed detail content instead of checking immediately')
      ctx.assert.equal(result.passed.afterOpen?.selectors?.find(item => item.selector === '#panel')?.visible, true, 'the expected panel should be visible after semantic click')
      ctx.assert.equal(result.hiddenTarget.error_type, 'ui_element_not_interactable', 'a target hidden by an ancestor must not be flattened into generic not_found')
      ctx.assert.equal(result.hiddenTarget.diagnosis?.blocking_evidence?.hiddenBy?.node?.id, 'hidden-parent', 'click failure must carry the hidden ancestor into the locator result')
      ctx.assert.equal(result.hiddenTarget.failures?.length, 1, 'one locator root cause must not produce duplicate expected-state failures')
      ctx.assert.equal(result.missingTarget.error_type, 'ui_locator_not_found', 'a missing selector on a populated page must be distinguished from a wrong runtime')
      ctx.assert.ok(result.missingTarget.diagnosis?.nearby_candidates?.some(item => item.selector === '#open'), 'locator failure must return nearby interactive candidates')
      ctx.assert.equal(result.blankTarget.error_type, 'runtime_target_blank_or_wrong', 'an empty runtime must be reported as a wrong/blank target rather than selector not_found')
      ctx.assert.equal(result.blankTarget.retry_policy, 'do_not_repeat_same_call_without_changing_target_precondition_or_locator', 'blank runtime failures must prevent blind retries')
      const hiddenChild = result.inspection.domState?.selectors?.find(item => item.selector === '#hidden-child')
      ctx.assert.equal(hiddenChild?.selfVisible, true, 'a child can look visible from its own computed style')
      ctx.assert.equal(hiddenChild?.effectiveVisible, false, 'effective visibility should include hidden ancestors')
      ctx.assert.equal(hiddenChild?.hiddenBy?.node?.id, 'hidden-parent', 'the first blocking ancestor should be identified')
      ctx.assert.ok(hiddenChild?.ancestorChain?.some(item => item.node?.id === 'hidden-parent'), 'the complete ancestor chain should be returned')
      const clippedChild = result.inspection.domState?.selectors?.find(item => item.selector === '#clipped-child')
      ctx.assert.equal(clippedChild?.effectiveVisible, false, 'a fully clipped child should not be effectively visible')
      ctx.assert.equal(clippedChild?.clippingAncestor?.node?.id, 'clip-parent', 'the clipping ancestor should be identified')
    } finally {
      try { if (fs.existsSync(childPath)) fs.unlinkSync(childPath) } catch { /* best-effort cleanup */ }
      workspace.cleanup()
    }
  }
}
