const path = require('path')

module.exports = {
  id: 'post-edit-runtime.attribution',
  title: 'Post-edit diagnostics attribute only events emitted after the write cursor',
  tags: ['tools', 'runtime', 'diagnostics'],
  changedFilePatterns: [
    /^electron\/modules\/runtime-diagnostics\.js$/i,
    /^electron\/modules\/tool-handlers\/diagnostics\.js$/i,
    /^electron\/modules\/tool-handlers\/(?:file-ops|text-edit)\.js$/i
  ],

  async run(ctx) {
    const workspace = ctx.createWorkspace(this.id)
    const runtimeDiagnostics = require(path.join(ctx.root, 'electron/modules/runtime-diagnostics'))
    const diagnostics = require(path.join(ctx.root, 'electron/modules/tool-handlers/diagnostics'))
    try {
      const projectId = 'runtime-attribution-test'
      const filePath = path.join(workspace.projectPath, 'sample.js')
      ctx.writeText(filePath, 'module.exports = true\n')
      runtimeDiagnostics.clear()
      runtimeDiagnostics.record({ projectId, severity: 'error', source: 'renderer', type: 'console-message', message: 'existing failure' })
      runtimeDiagnostics.record({ projectId, severity: 'warning', source: 'renderer', type: 'console-message', message: 'old unrelated warning' })
      const cursor = diagnostics.capturePostEditRuntimeBaseline(projectId, workspace.projectPath)
      runtimeDiagnostics.record({ projectId, severity: 'error', source: 'renderer', type: 'console-message', message: 'existing failure' })
      runtimeDiagnostics.record({ projectId, severity: 'error', source: 'renderer', type: 'console-message', message: 'new failure' })
      runtimeDiagnostics.record({ projectId: 'another-project', severity: 'error', source: 'renderer', type: 'console-message', message: 'other project failure' })

      const result = { success: true }
      await diagnostics.attachPostEditDiagnostics(result, [filePath], workspace.projectPath, cursor)
      ctx.assert.equal(result.runtimeDiagnostics.introduced_error_count, 1)
      ctx.assert.equal(result.runtimeDiagnostics.persisting_error_count, 1)
      ctx.assert.ok(result.runtimeDiagnostics.introduced.some(item => item.message === 'new failure'))
      ctx.assert.ok(result.runtimeDiagnostics.persisting.some(item => item.message === 'existing failure'))
      ctx.assert.ok(result.runtimeDiagnostics.unrelated.some(item => item.message === 'old unrelated warning'))
      ctx.assert.equal(result.runtimeDiagnostics.introduced.some(item => item.message === 'other project failure'), false)
      ctx.assert.deepEqual(result.runtimeDiagnostics.resolved, [])
      ctx.assert.equal(result.runtimeDiagnostics.resolved_requires_active_recheck, true)
    } finally {
      runtimeDiagnostics.clear()
      workspace.cleanup()
    }
  }
}
