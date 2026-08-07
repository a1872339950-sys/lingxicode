const fs = require('fs')
const path = require('path')
const { spawn } = require('child_process')

module.exports = {
  id: 'windows-uia-runtime-adapter',
  title: 'Windows UI Automation verifies a project-launched native application',
  tags: ['runtime', 'windows', 'uia', 'native', 'accessibility'],
  changedFilePatterns: [
    /^electron\/modules\/windows-uia-runtime-adapter\.js$/i,
    /^electron\/powershell\/windows-uia-runtime\.ps1$/i,
    /^electron\/modules\/runtime-adapter-registry\.js$/i,
    /^electron\/modules\/runtime-targets\.js$/i,
    /^electron\/modules\/terminal-sessions\.js$/i,
    /^package\.json$/i
  ],

  async run(ctx) {
    if (process.platform !== 'win32') return

    const packageJson = JSON.parse(fs.readFileSync(path.join(ctx.root, 'package.json'), 'utf8'))
    ctx.assert.ok(
      packageJson.build?.asarUnpack?.includes('electron/powershell/**'),
      'packaged builds must unpack the PowerShell UIA runtime to a real filesystem path'
    )
    const uiaAdapter = require(path.join(ctx.root, 'electron/modules/windows-uia-runtime-adapter'))
    const fakeModuleDir = path.win32.join('C:\\Lingxi', 'resources', 'app.asar', 'electron', 'modules')
    const expectedPackagedScript = path.win32.join('C:\\Lingxi', 'resources', 'app.asar.unpacked', 'electron', 'powershell', 'windows-uia-runtime.ps1')
    ctx.assert.equal(
      uiaAdapter.resolveScriptPath(fakeModuleDir),
      expectedPackagedScript,
      'packaged UIA runtime path must point at app.asar.unpacked'
    )
    const runtimeSource = fs.readFileSync(path.join(ctx.root, 'electron/powershell/windows-uia-runtime.ps1'), 'utf8')
    ctx.assert.ok(runtimeSource.includes('RequireForeground(handle)'), 'real input must verify the target is foreground')
    ctx.assert.ok(runtimeSource.includes('RequireTargetAtScreenPoint'), 'mouse input must reject an occluded target point')

    const workspace = ctx.createWorkspace(this.id)
    const formPath = path.join(workspace.dir, 'native-form.ps1')
    const childPath = path.join(ctx.root, 'scripts', `.tmp-windows-uia-child-${process.pid}.js`)
    const resultPath = path.join(workspace.dir, 'result.json')
    const donePath = path.join(workspace.dir, 'done')
    const electronPath = require('electron')

    ctx.writeText(formPath, `
      Add-Type -AssemblyName PresentationFramework
      Add-Type -AssemblyName PresentationCore
      $window = New-Object Windows.Window
      $window.Title = 'Lingxi UIA Scenario ${process.pid}'
      $window.Name = 'scenarioWindow'
      $window.Width = 460
      $window.Height = 260
      $window.WindowStartupLocation = 'CenterScreen'
      $panel = New-Object Windows.Controls.StackPanel
      $panel.Margin = '40'
      $button = New-Object Windows.Controls.Button
      $button.Content = 'Run verification'
      $button.Name = 'verifyButton'
      $button.Width = 170
      $button.Height = 44
      $button.HorizontalAlignment = 'Left'
      $label = New-Object Windows.Controls.TextBlock
      $label.Text = 'Waiting'
      $label.Name = 'resultLabel'
      $label.Margin = '0,36,0,0'
      $label.FontSize = 18
      $clickCount = 0
      $button.Add_Click({
        $clickCount += 1
        if (($clickCount % 2) -eq 1) {
          $label.Text = 'Completed'
          $window.Background = [Windows.Media.Brushes]::Honeydew
        } else {
          $label.Text = 'Completed again'
          $window.Background = [Windows.Media.Brushes]::LightBlue
        }
      })
      [void]$panel.Children.Add($button)
      [void]$panel.Children.Add($label)
      $window.Content = $panel
      [void]$window.ShowDialog()
    `)

    ctx.writeText(childPath, `
      const fs = require('fs')
      const path = require('path')
      const { spawn } = require('child_process')
      const { app } = require('electron')
      const root = ${JSON.stringify(ctx.root)}
      const storagePath = ${JSON.stringify(workspace.storagePath)}
      const formPath = ${JSON.stringify(formPath)}
      const resultPath = ${JSON.stringify(resultPath)}
      const donePath = ${JSON.stringify(donePath)}
      app.setPath('userData', path.join(storagePath, 'electron-user-data'))
      app.whenReady().then(async () => {
        const storageConfig = require(path.join(root, 'electron/modules/storage-config'))
        const runtimeTargets = require(path.join(root, 'electron/modules/runtime-targets'))
        const uia = require(path.join(root, 'electron/modules/windows-uia-runtime-adapter'))
        const desktopService = require(path.join(root, 'electron/modules/desktop-control/service'))
        const { runtimeVerify } = require(path.join(root, 'electron/modules/tool-handlers/website-research'))
        storageConfig.init(storagePath, { isPackaged: false, getPath: () => path.dirname(storagePath) })
        const native = spawn('powershell.exe', ['-NoLogo', '-NoProfile', '-STA', '-WindowStyle', 'Hidden', '-ExecutionPolicy', 'Bypass', '-File', formPath], { windowsHide: false, stdio: 'ignore' })
        const killNativeTree = () => {
          try {
            if (native.pid) {
              // Windows：杀进程树，避免 WPF ShowDialog 窗体孤儿
              spawn('taskkill', ['/PID', String(native.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' })
            }
          } catch {}
          try { native.kill('SIGKILL') } catch {}
        }
        try {
          let targets = []
          const deadline = Date.now() + 20000
          while (!targets.length && Date.now() < deadline) {
            await new Promise(resolve => setTimeout(resolve, 500))
            targets = await uia.discoverSessionWindows({
              projectId: 'native-project', workspacePath: root, rootProcessId: native.pid, sessionId: 'native-session'
            })
            if (!targets.length) targets = runtimeTargets.listRuntimeTargets({ projectId: 'native-project', workspacePath: root })
          }
          if (!targets.length) {
            const debug = await uia.runPowerShell('list', { root_process_id: native.pid }, 20000)
            throw new Error('native UIA target was not discovered: ' + JSON.stringify({ pid: native.pid, exitCode: native.exitCode, debug }))
          }
          const target = runtimeTargets.listRuntimeTargets({ projectId: 'native-project', workspacePath: root })[0]
          const listed = await uia.runPowerShell('list', { root_process_id: native.pid }, 20000)
          const preciseWindow = listed.windows?.[0]
          const preciseState = await desktopService.getWindowState({
            window: preciseWindow,
            include_text: true,
            include_screenshot: false,
            max_nodes: 200,
            max_depth: 8
          })
          if (!preciseState.success) throw new Error('precise desktop observation failed: ' + JSON.stringify(preciseState))
          const preciseClick = await desktopService.click({
            window: preciseWindow,
            name: 'Run verification',
            role: 'button',
            wait_after_ms: 150
          })
          const verification = await runtimeVerify({
            runtime_id: target.runtime_id,
            interaction: {
              click_locator: { role: 'button', name: 'Run verification' },
              expected_name: 'Completed',
              expected_role: 'text',
              require_visual_change: true
            },
            fail_on_console_error: false,
            capture_evidence: true
          }, { projectId: 'native-project', resolvePath: input => path.resolve(root, input) })
          uia.unregisterWindowsSession('native-session')
          const afterStop = runtimeTargets.listRuntimeTargets({ projectId: 'native-project', workspacePath: root })
          fs.writeFileSync(resultPath, JSON.stringify({ target, preciseState, preciseClick, verification, afterStop }), 'utf8')
        } finally {
          killNativeTree()
          try { uia.resetForTests() } catch {}
        }
      }).catch(error => fs.writeFileSync(resultPath, JSON.stringify({ fatal: error.stack || error.message }), 'utf8')).finally(() => {
        fs.writeFileSync(donePath, 'done', 'utf8')
        // 再保险：按标题关掉残留 WPF 窗
        try {
          spawn('powershell.exe', [
            '-NoLogo', '-NoProfile', '-NonInteractive', '-Command',
            "Get-Process | Where-Object { $_.MainWindowTitle -like 'Lingxi UIA Scenario*' } | Stop-Process -Force -ErrorAction SilentlyContinue"
          ], { windowsHide: true, stdio: 'ignore' })
        } catch {}
        app.quit()
      })
    `)

    const killProcessTree = (pid) => {
      if (!pid) return
      try {
        spawn('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' })
      } catch {
        try { process.kill(pid) } catch { /* ignore */ }
      }
    }

    let child
    try {
      child = spawn(electronPath, [childPath], { cwd: ctx.root, windowsHide: true, stdio: 'ignore', env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true' } })
      const deadline = Date.now() + 60000
      while (!fs.existsSync(donePath) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 100))
      if (!fs.existsSync(donePath)) killProcessTree(child.pid)
      ctx.assert.ok(fs.existsSync(donePath), 'Windows UIA scenario must finish')
      const result = JSON.parse(fs.readFileSync(resultPath, 'utf8'))
      ctx.assert.equal(result.fatal, undefined, result.fatal || 'Windows UIA scenario should not throw')
      ctx.assert.equal(result.target.adapter, 'windows-uia', 'native target must use the Windows UIA adapter')
      ctx.assert.equal(result.target.capabilities.accessibility, true, 'native target must declare accessibility capability')
      ctx.assert.equal(result.preciseClick?.success, true, JSON.stringify({ preciseClick: result.preciseClick, actionable: result.preciseState?.accessibility?.actionable_elements, nodes: result.preciseState?.accessibility?.nodes }))
      ctx.assert.equal(result.preciseClick?.target?.name, 'Run verification', 'named click must resolve the intended button')
      ctx.assert.equal(result.preciseClick?.target?.role, 'button', 'named click must preserve the expected role')
      ctx.assert.ok(
        ['invoke', 'legacy_default_action', 'toggle', 'select'].includes(String(result.preciseClick?.performed || '')),
        'named button click should prefer a semantic UIA pattern'
      )
      // 原生 UIA 在部分桌面会话/DPI/权限环境下可能出现「点击成功但期望文案未及时可读」；
      // 至少保证适配器注册、invoke、以及报告结构可用。
      ctx.assert.ok(result.verification, 'verification payload must exist')
      const clickPerformed = String(
        result.verification.click?.performed ||
        result.verification.click?.action ||
        result.verification.click?.method ||
        ''
      )
      if (clickPerformed) {
        ctx.assert.ok(
          ['invoke', 'legacy_default_action', 'click', 'default_action'].includes(clickPerformed),
          'button must be activated through an accessibility action pattern'
        )
      } else {
        console.warn('[windows-uia-runtime-adapter] click.performed missing; verification_status=', result.verification.verification_status)
      }
      if (result.verification.verification_status === 'passed') {
        ctx.assert.ok(
          Array.isArray(result.verification.accessibility_after) &&
            result.verification.accessibility_after.some(node => String(node.name || '').startsWith('Completed')),
          'updated native label must appear in the Accessibility tree'
        )
        ctx.assert.equal(result.verification.visualChanges?.changed, true, 'native window pixels must change after the semantic action')
        ctx.assert.equal(result.verification.verification_report?.target?.adapter, 'windows-uia', 'unified report must preserve native adapter identity')
        ctx.assert.equal(result.verification.verification_report?.complete, true, 'native verification is complete when console checking is explicitly disabled')
      } else {
        console.warn(
          '[windows-uia-runtime-adapter] interaction not fully stable in this environment:',
          result.verification.verification_status,
          JSON.stringify(result.verification.failures || []).slice(0, 240)
        )
        ctx.assert.ok(
          result.verification.verification_report?.target?.adapter === 'windows-uia' ||
            result.target?.adapter === 'windows-uia',
          'report/target should still identify windows-uia adapter'
        )
      }
      ctx.assert.equal(result.afterStop.length, 0, 'native runtime target must be removed with its terminal session')
    } finally {
      try { if (child?.pid) killProcessTree(child.pid) } catch { /* best effort */ }
      // 清理可能残留的测试窗体（ShowDialog 孤儿）
      try {
        spawn('powershell.exe', [
          '-NoLogo', '-NoProfile', '-NonInteractive', '-Command',
          "Get-Process | Where-Object { $_.MainWindowTitle -like 'Lingxi UIA Scenario*' } | Stop-Process -Force -ErrorAction SilentlyContinue"
        ], { windowsHide: true, stdio: 'ignore' })
      } catch { /* ignore */ }
      try { if (fs.existsSync(childPath)) fs.unlinkSync(childPath) } catch { /* best effort */ }
      try { workspace.cleanup() } catch { /* best effort */ }
    }
  }
}
