const fs = require('fs')
const path = require('path')
const { spawn } = require('child_process')

module.exports = {
  id: 'browser-runtime-adapter',
  title: 'Browser adapter verifies a non-Electron development server',
  tags: ['runtime', 'browser', 'web', 'adapter', 'interaction'],
  changedFilePatterns: [
    /^electron\/modules\/runtime-adapter-registry\.js$/i,
    /^electron\/modules\/browser-runtime-adapter\.js$/i,
    /^electron\/modules\/terminal-sessions\.js$/i,
    /^electron\/modules\/runtime-targets\.js$/i
  ],

  async run(ctx) {
    const workspace = ctx.createWorkspace(this.id)
    const childPath = path.join(ctx.root, 'scripts', `.tmp-browser-adapter-child-${process.pid}.js`)
    const resultPath = path.join(workspace.dir, 'result.json')
    const donePath = path.join(workspace.dir, 'done')
    const electronPath = require('electron')

    ctx.writeText(childPath, `
      const fs = require('fs')
      const http = require('http')
      const path = require('path')
      const { app } = require('electron')
      const root = ${JSON.stringify(ctx.root)}
      const storagePath = ${JSON.stringify(workspace.storagePath)}
      const resultPath = ${JSON.stringify(resultPath)}
      const donePath = ${JSON.stringify(donePath)}
      app.setPath('userData', path.join(storagePath, 'electron-user-data'))

      app.whenReady().then(async () => {
        const storageConfig = require(path.join(root, 'electron/modules/storage-config'))
        const runtimeTargets = require(path.join(root, 'electron/modules/runtime-targets'))
        const runtimeDiagnostics = require(path.join(root, 'electron/modules/runtime-diagnostics'))
        const browserAdapter = require(path.join(root, 'electron/modules/browser-runtime-adapter'))
        const adapterRegistry = require(path.join(root, 'electron/modules/runtime-adapter-registry'))
        const { runtimeVerify } = require(path.join(root, 'electron/modules/tool-handlers/website-research'))
        storageConfig.init(storagePath, { isPackaged: false, getPath: () => path.dirname(storagePath) })
        runtimeDiagnostics.install(app)
        const server = http.createServer((req, res) => {
          if (req.url === '/api/fail') {
            res.writeHead(503, { 'content-type': 'application/json' })
            res.end('{"error":"service unavailable"}')
            return
          }
          res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
          res.end('<!doctype html><style>#panel{display:none;padding:30px;background:#bdebd2}#panel.open{display:block}</style><h1>Web stack</h1><button id="open">Open</button><section id="panel">Verified web app</section><script>document.querySelector("#open").onclick=()=>document.querySelector("#panel").classList.add("open")<\\/script>')
        })
        server.on('upgrade', (req, socket) => socket.destroy())
        await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
        const url = 'http://127.0.0.1:' + server.address().port + '/'
        try {
          const registration = await browserAdapter.registerBrowserDevelopmentTarget({
            projectId: 'web-project',
            workspacePath: root,
            processId: process.pid,
            sessionId: 'web-dev-session',
            title: 'Web development server',
            url
          })
          const targets = runtimeTargets.listRuntimeTargets({ projectId: 'web-project', workspacePath: root })
          const interaction = await runtimeVerify({
            runtime_id: registration.runtime_id,
            interaction: {
              click_locator: { selector: '#open' },
              expected_visible_selector: '#panel',
              require_visual_change: true
            },
            observe_ms: 0
          }, { projectId: 'web-project', resolvePath: input => path.resolve(root, input) })
          const resolution = runtimeTargets.resolveRuntimeTarget({ runtime_id: registration.runtime_id, workspacePath: root }, 'web-project')
          await resolution.webContents.executeJavaScript(
            "history.pushState({}, '', '/settings');" +
            "fetch('/api/fail').catch(() => {});" +
            "new Promise(resolve => {" +
              "const socket = new WebSocket('ws://127.0.0.1:" + server.address().port + "/socket');" +
              "socket.onerror = () => resolve();" +
              "setTimeout(resolve, 600);" +
            "});"
          )
          await resolution.webContents.executeJavaScript("console.error('Browser adapter console failure')")
          await new Promise(resolve => setTimeout(resolve, 800))
          const live = await runtimeVerify({ runtime_id: registration.runtime_id, runtime_since_ms: 60000, observe_ms: 0, capture_evidence: false }, {
            projectId: 'web-project', resolvePath: input => path.resolve(root, input)
          })
          browserAdapter.unregisterBrowserSession('web-dev-session')
          const afterStop = runtimeTargets.listRuntimeTargets({ projectId: 'web-project', workspacePath: root })
          fs.writeFileSync(resultPath, JSON.stringify({ registration, targets, interaction, live, afterStop, adapters: adapterRegistry.listRuntimeAdapters() }), 'utf8')
        } finally {
          server.close()
          browserAdapter.resetForTests()
        }
      }).catch(error => fs.writeFileSync(resultPath, JSON.stringify({ fatal: error.stack || error.message }), 'utf8')).finally(() => {
        fs.writeFileSync(donePath, 'done', 'utf8')
        app.quit()
      })
    `)

    try {
      const child = spawn(electronPath, [childPath], { cwd: ctx.root, windowsHide: true, stdio: 'ignore', env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true' } })
      const deadline = Date.now() + 60000
      while (!fs.existsSync(donePath) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 100))
      if (!fs.existsSync(donePath)) child.kill()
      ctx.assert.ok(fs.existsSync(donePath), 'browser adapter scenario must finish')
      const result = JSON.parse(fs.readFileSync(resultPath, 'utf8'))
      ctx.assert.equal(result.fatal, undefined, result.fatal || 'browser adapter scenario should not throw')
      ctx.assert.equal(result.registration.success, true, 'local web server should register as a runtime target')
      ctx.assert.equal(result.targets[0].adapter, 'browser', 'target must identify the browser adapter')
      ctx.assert.equal(result.targets[0].capabilities.dom, true, 'browser target must declare DOM capability')
      ctx.assert.equal(result.interaction.success, true, 'browser adapter must complete semantic interaction')
      ctx.assert.equal(result.interaction.visualChanges.changed, true, 'browser adapter must compare pixels')
      ctx.assert.equal(result.live.verification_status, 'failed', 'browser console errors must fail live verification')
      ctx.assert.ok(result.live.runtimeDiagnostics.events.some(item => /Browser adapter console failure/.test(item.message)), 'browser console error must be returned exactly')
      ctx.assert.ok(result.live.runtimeDiagnostics.events.some(item => item.type === 'network-http-failure' && /api\/fail/.test(item.message)), 'HTTP failures must be captured by the browser adapter')
      ctx.assert.ok(result.live.runtimeDiagnostics.events.some(item => /websocket/i.test(item.type)), 'WebSocket failures must be captured by the browser adapter')
      ctx.assert.ok(/\/settings$/.test(result.live.runtime_target.url), 'SPA route changes must update the runtime target URL')
      ctx.assert.equal(result.live.verification_report.protocol, 'lingxi-runtime-verification/v1', 'all adapters must return the unified verification report')
      ctx.assert.equal(result.live.verification_report.target.adapter, 'browser', 'unified report must preserve adapter identity')
      ctx.assert.ok(result.live.verification_report.diagnostics.network_error_count >= 1, 'unified report must summarize network errors')
      ctx.assert.equal(result.afterStop.length, 0, 'browser target must disappear when its terminal session stops')
      ctx.assert.ok(result.adapters.some(adapter => adapter.id === 'electron') && result.adapters.some(adapter => adapter.id === 'browser'), 'registry must expose both implemented adapters')
      const terminalSource = fs.readFileSync(path.join(ctx.root, 'electron/modules/terminal-sessions.js'), 'utf8')
      ctx.assert.ok(terminalSource.includes('registerBrowserDevelopmentTarget'), 'terminal URL detection must register browser development targets automatically')
      ctx.assert.ok(terminalSource.includes('unregisterBrowserSession'), 'terminal shutdown must remove browser development targets')
    } finally {
      try { if (fs.existsSync(childPath)) fs.unlinkSync(childPath) } catch { /* best effort */ }
      workspace.cleanup()
    }
  }
}
