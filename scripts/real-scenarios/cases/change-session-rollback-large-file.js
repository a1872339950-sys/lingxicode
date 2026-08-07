const fs = require('fs')
const path = require('path')

module.exports = {
  id: 'change-session.rollback-large-file',
  title: 'Change session can rollback a large text file from disk snapshots',
  tags: ['change-session', 'rollback', 'large-file', 'filesystem'],
  changedFilePatterns: [
    /^electron\/modules\/change-sessions\.js$/i,
    /^electron\/preload\.js$/i,
    /^frontend\/scripts\/features\/change-session-actions\.js$/i
  ],

  async run(ctx) {
    const workspace = ctx.createWorkspace(this.id)
    const config = require(path.join(ctx.root, 'electron/modules/config'))
    const changeSessions = require(path.join(ctx.root, 'electron/modules/change-sessions'))

    const projectId = `scenario-${Date.now()}-${Math.random().toString(16).slice(2)}`
    const filePath = path.join(workspace.projectPath, 'large.txt')
    const before = `BEFORE\n${'A'.repeat(2 * 1024 * 1024 + 4096)}\nEND_BEFORE\n`
    const after = `AFTER\n${'B'.repeat(2 * 1024 * 1024 + 4096)}\nEND_AFTER\n`
    const progress = []

    fs.mkdirSync(workspace.projectPath, { recursive: true })
    fs.mkdirSync(workspace.storagePath, { recursive: true })
    config.setProjectInstance(projectId, { storagePath: workspace.storagePath })

    try {
      ctx.writeText(filePath, before)
      const session = changeSessions.startChangeSession(projectId, workspace.projectPath, { scenario: this.id })
      changeSessions.recordFileBefore(projectId, filePath, 'modify')
      ctx.writeText(filePath, after)
      changeSessions.recordFileAfter(projectId, filePath, 'modify')
      const summary = changeSessions.finalizeChangeSession(projectId, session.id, 'completed')

      ctx.assert.equal(summary.fileCount, 1, 'change session should record one changed file')

      const result = await changeSessions.rollbackChangeSession(projectId, session.id, {
        onProgress: item => progress.push(item.percent)
      })

      ctx.assert.ok(result.success, result.error || 'rollback should succeed')
      ctx.assert.equal(result.rolledBack.length, 1, 'rollback should restore one file')
      ctx.assert.equal(fs.readFileSync(filePath, 'utf-8'), before, 'large file content should be restored exactly')
      ctx.assert.deepEqual(progress, [0, 100], 'rollback should emit start and completion progress')

      const firstSessionId = session.id
      for (let i = 0; i < 90; i++) {
        const extra = changeSessions.startChangeSession(projectId, workspace.projectPath, { scenario: this.id, index: i })
        changeSessions.finalizeChangeSession(projectId, extra.id, 'completed')
      }
      const reloaded = changeSessions.getChangeSession(projectId, firstSessionId)
      ctx.assert.equal(reloaded?.id, firstSessionId, 'evicted cache entry should still reload from disk')
      ctx.assert.equal((Array.isArray(reloaded.files) ? reloaded.files : Object.values(reloaded.files || {})).length, 1, 'reloaded session should preserve file metadata')
    } finally {
      await changeSessions.flushPendingSessionWrites()
      config.deleteProjectInstance(projectId)
      workspace.cleanup()
    }
  }
}
