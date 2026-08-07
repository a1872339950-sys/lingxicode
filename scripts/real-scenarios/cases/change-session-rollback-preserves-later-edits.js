const fs = require('fs')
const path = require('path')

module.exports = {
  id: 'change-session.rollback-preserves-later-edits',
  title: 'Change session rollback preserves later edits and aborts atomically on overlap',
  tags: ['change-session', 'rollback', 'three-way-merge', 'data-safety'],
  changedFilePatterns: [
    /^electron\/modules\/change-sessions\.js$/i,
    /^frontend\/scripts\/features\/change-session-actions\.js$/i
  ],

  async run(ctx) {
    const workspace = ctx.createWorkspace(this.id)
    const config = require(path.join(ctx.root, 'electron/modules/config'))
    const changeSessions = require(path.join(ctx.root, 'electron/modules/change-sessions'))
    const projectId = `scenario-${Date.now()}-${Math.random().toString(16).slice(2)}`

    fs.mkdirSync(workspace.projectPath, { recursive: true })
    fs.mkdirSync(workspace.storagePath, { recursive: true })
    config.setProjectInstance(projectId, { storagePath: workspace.storagePath })

    const recordChange = (filePath, before, after) => {
      ctx.writeText(filePath, before)
      changeSessions.recordFileBefore(projectId, filePath, 'modify')
      ctx.writeText(filePath, after)
      changeSessions.recordFileAfter(projectId, filePath, 'modify')
    }

    try {
      // 后续修改与 AI 改动不重叠：只撤销 AI 的行，同时保留用户后来改的行。
      const mergeFile = path.join(workspace.projectPath, 'merge-safe.txt')
      const mergeBefore = [
        'header',
        'user-setting: old',
        'keep-1',
        'keep-2',
        'ai-target: original',
        'footer',
        ''
      ].join('\n')
      const mergeAfter = mergeBefore.replace('ai-target: original', 'ai-target: changed-by-ai')
      const mergeCurrent = mergeAfter.replace('user-setting: old', 'user-setting: improved-by-user')

      const mergeSession = changeSessions.startChangeSession(projectId, workspace.projectPath, { scenario: this.id })
      recordChange(mergeFile, mergeBefore, mergeAfter)
      changeSessions.finalizeChangeSession(projectId, mergeSession.id, 'completed')
      ctx.writeText(mergeFile, mergeCurrent)

      const merged = await changeSessions.rollbackChangeSession(projectId, mergeSession.id)
      ctx.assert.ok(merged.success, merged.error || 'non-overlapping later edit should merge safely')
      ctx.assert.equal(merged.rolledBack[0]?.action, 'reverse_merge', 'rollback should use reverse three-way merge')
      ctx.assert.equal(
        fs.readFileSync(mergeFile, 'utf-8'),
        mergeBefore.replace('user-setting: old', 'user-setting: improved-by-user'),
        'rollback should preserve later user edit while undoing only the AI edit'
      )

      // 同一位置发生后续修改：即使旧调用传 force=true，也必须拒绝覆盖。
      const conflictFile = path.join(workspace.projectPath, 'overlap.txt')
      const conflictSession = changeSessions.startChangeSession(projectId, workspace.projectPath, { scenario: this.id })
      recordChange(conflictFile, 'value: original\n', 'value: changed-by-ai\n')
      changeSessions.finalizeChangeSession(projectId, conflictSession.id, 'completed')
      ctx.writeText(conflictFile, 'value: improved-by-user\n')

      const conflict = await changeSessions.rollbackChangeSession(projectId, conflictSession.id, { force: true })
      ctx.assert.ok(conflict.conflict, 'overlapping later edit should report a conflict')
      ctx.assert.ok(conflict.noFilesChanged, 'conflict result should promise that no files changed')
      ctx.assert.ok(conflict.forceIgnored, 'legacy force flag must be ignored')
      ctx.assert.equal(
        fs.readFileSync(conflictFile, 'utf-8'),
        'value: improved-by-user\n',
        'overlapping later user edit must never be overwritten'
      )

      // 一批文件中只要有一个冲突，连本可安全回退的文件也不能先被写掉。
      const atomicCleanFile = path.join(workspace.projectPath, 'atomic-clean.txt')
      const atomicConflictFile = path.join(workspace.projectPath, 'atomic-conflict.txt')
      const atomicSession = changeSessions.startChangeSession(projectId, workspace.projectPath, { scenario: this.id })
      recordChange(atomicCleanFile, 'clean: before\n', 'clean: after-ai\n')
      recordChange(atomicConflictFile, 'shared: before\n', 'shared: after-ai\n')
      changeSessions.finalizeChangeSession(projectId, atomicSession.id, 'completed')
      ctx.writeText(atomicConflictFile, 'shared: after-user\n')

      const atomic = await changeSessions.rollbackChangeSession(projectId, atomicSession.id)
      ctx.assert.ok(atomic.conflict, 'one overlapping file should stop the whole rollback')
      ctx.assert.ok(atomic.noFilesChanged, 'atomic conflict should leave every file untouched')
      ctx.assert.equal(fs.readFileSync(atomicCleanFile, 'utf-8'), 'clean: after-ai\n', 'safe file must not be partially rolled back')
      ctx.assert.equal(fs.readFileSync(atomicConflictFile, 'utf-8'), 'shared: after-user\n', 'conflicting user file must remain untouched')
    } finally {
      await changeSessions.flushPendingSessionWrites()
      config.deleteProjectInstance(projectId)
      workspace.cleanup()
    }
  }
}
