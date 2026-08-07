const path = require('path')

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function waitForStatus(terminalSessions, projectId, predicate, timeoutMs = 6000) {
  const deadline = Date.now() + timeoutMs
  let latest = null
  while (Date.now() < deadline) {
    latest = terminalSessions.getStatus(projectId, null, { includeOutput: true }).activeSession
    if (latest && predicate(latest)) return latest
    await wait(100)
  }
  return latest
}

module.exports = {
  id: 'terminal.lifecycle',
  title: 'Shell command facade supports Windows command chains and cleans up background sessions',
  tags: ['tools', 'terminal', 'lifecycle'],
  changedFilePatterns: [
    /^electron\/modules\/terminal-sessions\.js$/i,
    /^electron\/modules\/tool-handlers\/command\.js$/i,
    /^electron\/modules\/schemas\/command\.js$/i,
    /^electron\/modules\/tools\.js$/i,
    /^electron\/modules\/tools-schema\.js$/i
  ],

  async run(ctx) {
    const workspace = ctx.createWorkspace(this.id)
    const terminalSessions = require(path.join(ctx.root, 'electron/modules/terminal-sessions'))
    const commandHandler = require(path.join(ctx.root, 'electron/modules/tool-handlers/command'))
    const tools = require(path.join(ctx.root, 'electron/modules/tools'))
    const nodeBin = process.execPath
    const projectId = `scenario-${Date.now()}-${Math.random().toString(36).slice(2)}`

    try {
      ctx.writeText(path.join(workspace.projectPath, 'package.json'), '{"name":"terminal-lifecycle"}\n')
      ctx.writeText(path.join(workspace.projectPath, 'src', 'quick-check.js'), 'const ok = true\nconsole.log(ok)\n')

      ctx.assert.equal(commandHandler.shouldUseTerminalSession('curl -L https://example.com/archive.zip -o archive.zip'), true, 'curl downloads should use terminal sessions')
      ctx.assert.equal(commandHandler.shouldUseTerminalSession('Invoke-WebRequest https://example.com/a.zip -OutFile a.zip'), true, 'PowerShell downloads should use terminal sessions')
      ctx.assert.equal(commandHandler.shouldUseTerminalSession('ssh user@example.com'), true, 'ssh sessions should use terminal sessions')
      ctx.assert.equal(commandHandler.shouldUseTerminalSession('scp user@example.com:/tmp/a ./a'), true, 'remote transfers should use terminal sessions')
      ctx.assert.equal(commandHandler.shouldUseTerminalSession('ssh -V'), false, 'ssh version checks should stay finite')
      const sshInfo = terminalSessions.classifyTerminalCommand('ssh user@example.com')
      ctx.assert.equal(sshInfo.kind, 'ssh', 'ssh commands should be classified as remote terminal tasks')
      ctx.assert.equal(sshInfo.remoteTask, true, 'ssh commands should expose remoteTask metadata')
      ctx.assert.equal(sshInfo.persistent, true, 'ssh sessions should be treated as persistent until stopped')
      const downloadInfo = terminalSessions.classifyTerminalCommand('curl -L https://example.com/archive.zip -o archive.zip')
      ctx.assert.equal(downloadInfo.downloadTask, true, 'download commands should expose downloadTask metadata')
      ctx.assert.equal(downloadInfo.networkTask, true, 'download commands should expose networkTask metadata')

      const finiteResult = await tools.executeToolForProject(
        'shell_run',
        {
          command: `"${nodeBin}" --check "src/quick-check.js"`,
          cwd: workspace.projectPath,
          background: true
        },
        workspace.projectPath,
        item => path.resolve(workspace.projectPath, item || ''),
        null,
        projectId,
        null,
        { userMessage: 'scenario finite syntax command should stay hidden' }
      )
      ctx.assert.equal(finiteResult.success, true, finiteResult.error || 'finite syntax command should succeed')
      ctx.assert.equal(finiteResult.shellRun?.delegatedTool, 'run_command', 'node --check should not create a terminal session even if background=true')

      const bellProjectId = `${projectId}-bell`
      const bellCommand = `"${nodeBin}" -e "process.stdout.write('\\x07hello-from-bell\\n')"`
      const bellResult = terminalSessions.startSession(bellProjectId, bellCommand, workspace.projectPath, null, {
        autoStopAfterMs: 5000
      })
      ctx.assert.equal(bellResult.success, true, bellResult.error || 'bell command should start')
      const bellDone = await waitForStatus(terminalSessions, bellProjectId, session => session.status === 'success' || session.status === 'failed')
      const bellOutput = (bellDone.output || []).map(item => item.text).join('\n')
      ctx.assert.ok(bellOutput.includes('hello-from-bell'), 'terminal should keep normal output text')
      ctx.assert.ok(!bellOutput.includes('\x07'), 'terminal output should strip bell characters before storing/emitting output')

      const chainedCommand = `"${nodeBin}" -e "console.log('first-check')" && "${nodeBin}" -e "console.log('second-check')"`
      const chainResult = terminalSessions.startSession(projectId, chainedCommand, workspace.projectPath, null, {
        autoStopAfterMs: 5000
      })
      ctx.assert.equal(chainResult.success, true, chainResult.error || 'chained command should start')
      const chainedDone = await waitForStatus(terminalSessions, projectId, chain => chain.status === 'success' || chain.status === 'failed')
      ctx.assert.equal(chainedDone.status, 'success', 'terminal command chains should work without PowerShell && failure')
      const outputText = (chainedDone.output || []).map(item => item.text).join('\n')
      ctx.assert.ok(outputText.includes('first-check') && outputText.includes('second-check'), 'chained command should run both checks')

      const longProjectId = `${projectId}-auto-stop`
      const longCommand = `"${nodeBin}" -e "console.log('server started'); setInterval(function(){ console.log('tick') }, 100)"`
      const longResult = terminalSessions.startSession(longProjectId, longCommand, workspace.projectPath, null, {
        autoStopAfterMs: 1000
      })
      ctx.assert.equal(longResult.success, true, longResult.error || 'long command should start')
      const duplicateResult = terminalSessions.startSession(longProjectId, longCommand, workspace.projectPath, null, {
        autoStopAfterMs: 1000
      })
      ctx.assert.equal(duplicateResult.success, true, duplicateResult.error || 'duplicate long command should return the active session')
      ctx.assert.equal(duplicateResult.reused, true, 'duplicate long command should reuse the existing running session')
      ctx.assert.equal(duplicateResult.session.id, longResult.session.id, 'duplicate long command should not create another terminal session')
      ctx.assert.equal(longResult.session.autoStopAfterMs, 1000, 'auto stop metadata should be exposed')
      ctx.assert.equal(longResult.session.requiresStop, true, 'persistent commands should tell the caller they require stop')
      const stopped = await waitForStatus(terminalSessions, longProjectId, session => session.status === 'stopped', 7000)
      ctx.assert.equal(stopped.status, 'stopped', 'auto_stop_after_ms should stop persistent background sessions')
      const stoppedOutput = (stopped.output || []).map(item => item.text).join('\n')
      ctx.assert.ok(stoppedOutput.includes('auto stop requested'), 'auto stop should be visible in terminal output')
    } finally {
      terminalSessions.clearProject(projectId)
      terminalSessions.clearProject(`${projectId}-bell`)
      terminalSessions.clearProject(`${projectId}-auto-stop`)
      await wait(500)
      workspace.cleanup()
    }
  }
}
