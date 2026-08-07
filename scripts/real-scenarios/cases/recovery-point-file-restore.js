const fs = require('fs')
const path = require('path')

module.exports = {
  id: 'recovery-point.file-restore',
  title: 'AI task recovery points restore files without creating Git commits',
  tags: ['recovery-point', 'rollback', 'filesystem'],
  changedFilePatterns: [
    /^electron\/modules\/recovery-points\.js$/i,
    /^electron\/modules\/tools\.js$/i,
    /^electron\/modules\/change-sessions\.js$/i,
    /^electron\/modules\/ipc\.js$/i,
    /^electron\/preload\.js$/i
  ],

  async run(ctx) {
    const workspace = ctx.createWorkspace(this.id)
    const config = require(path.join(ctx.root, 'electron/modules/config'))
    const recoveryPoints = require(path.join(ctx.root, 'electron/modules/recovery-points'))
    const changeSessions = require(path.join(ctx.root, 'electron/modules/change-sessions'))
    const tools = require(path.join(ctx.root, 'electron/modules/tools'))
    const gitSafety = require(path.join(ctx.root, 'electron/modules/git'))

    const projectId = `scenario-${Date.now()}-${Math.random().toString(16).slice(2)}`
    const filePath = path.join(workspace.projectPath, 'src', 'target.txt')
    const before = `BEFORE\n${'A'.repeat(1024 * 32)}\nEND_BEFORE\n`
    const after = `AFTER\n${'B'.repeat(1024 * 32)}\nEND_AFTER\n`

    fs.mkdirSync(workspace.projectPath, { recursive: true })
    fs.mkdirSync(workspace.storagePath, { recursive: true })
    config.setProjectInstance(projectId, { storagePath: workspace.storagePath })

    try {
      ctx.writeText(filePath, before)

      const point = await recoveryPoints.createFileRecoveryPoint(projectId, workspace.projectPath, {
        phase: 'before',
        source: 'ai_auto',
        paths: [filePath],
        retention: { maxAutoPoints: 5, maxAutoBytes: 20 * 1024 * 1024 }
      })
      ctx.assert.ok(point.success, point.error || 'recovery point should be created')
      ctx.assert.equal(point.fileCount, 1, 'one file should be snapshotted')

      ctx.writeText(filePath, after)
      const restored = await recoveryPoints.restoreRecoveryPoint(projectId, point.id)
      ctx.assert.ok(restored.success, restored.error || 'recovery point restore should succeed')
      ctx.assert.equal(fs.readFileSync(filePath, 'utf-8'), before, 'file content should be restored exactly')

      const legacyId = `legacy-${Date.now()}`
      const legacyDir = path.join(workspace.storagePath, 'recovery-points', legacyId)
      const legacySnapshot = path.join(legacyDir, 'files', 'target.bin')
      fs.mkdirSync(path.dirname(legacySnapshot), { recursive: true })
      fs.writeFileSync(legacySnapshot, before)
      fs.writeFileSync(path.join(legacyDir, 'manifest.json'), JSON.stringify({
        id: legacyId,
        kind: 'file-snapshot',
        source: 'ai_auto',
        phase: 'before',
        projectId,
        projectPath: workspace.projectPath,
        createdAt: new Date().toISOString(),
        files: [{
          path: filePath,
          relativePath: 'src/target.txt',
          existed: true,
          type: 'file',
          snapshot: 'files/target.bin'
        }],
        fileCount: 1
      }, null, 2))
      ctx.writeText(filePath, after)
      const legacyRestore = await recoveryPoints.restoreRecoveryPoint(projectId, legacyId, { transactionProtection: false })
      ctx.assert.ok(legacyRestore.success, legacyRestore.error || 'legacy recovery point should remain readable')
      ctx.assert.equal(fs.readFileSync(filePath, 'utf-8'), before, 'legacy recovery point should restore its file')
      const legacyDelete = await recoveryPoints.deleteRecoveryPoint(projectId, legacyId)
      ctx.assert.ok(legacyDelete.success, 'legacy recovery point should be deletable')

      const originalCreateAiSafetySnapshot = gitSafety.createAiSafetySnapshot
      let gitSnapshotCalls = 0
      const originalConsoleError = console.error
      const originalConsoleLog = console.log
      const toolSession = changeSessions.startChangeSession(projectId, workspace.projectPath, {
        scenario: `${this.id}:tool-fallback`
      })
      try {
        gitSafety.createAiSafetySnapshot = async () => {
          gitSnapshotCalls += 1
          throw new Error('AI flow must not call Git snapshots')
        }
        console.error = (...args) => {
          if (String(args[0] || '').includes('[GitSafety]')) return
          originalConsoleError(...args)
        }
        console.log = (...args) => {
          if (String(args[0] || '').includes('[Tool]')) return
          originalConsoleLog(...args)
        }
        const readResult = await tools.executeToolForProject(
          'read_file',
          { path: 'src/target.txt' },
          workspace.projectPath,
          item => path.resolve(workspace.projectPath, item || ''),
          null,
          projectId
        )
        ctx.assert.ok(readResult.success, readResult.error || 'read_file should establish the write baseline')
        const toolResult = await tools.executeToolForProject(
          'write_file',
          { path: 'src/target.txt', content: after },
          workspace.projectPath,
          item => path.resolve(workspace.projectPath, item || ''),
          null,
          projectId,
          null,
          { userMessage: 'scenario recovery point fallback' }
        )
        ctx.assert.ok(toolResult.success, toolResult.error || 'write_file should still succeed with fallback recovery point')

        changeSessions.finalizeChangeSession(projectId, toolSession.id, 'completed')
        const taskPointResult = await recoveryPoints.createAiTaskRecoveryPoint(projectId, workspace.projectPath, toolSession.id)
        ctx.assert.ok(taskPointResult.success, taskPointResult.error || 'task recovery point should be created')
        const duplicate = await recoveryPoints.createAiTaskRecoveryPoint(projectId, workspace.projectPath, toolSession.id)
        ctx.assert.ok(duplicate.reused, 'same task should reuse its single recovery point')
        ctx.assert.equal(gitSnapshotCalls, 0, 'AI file writes must not call Git snapshot commits')

        const fallbackList = recoveryPoints.listRecoveryPoints(projectId)
        const fallbackPoint = fallbackList.points.find(item => item.changeSessionId === toolSession.id)
        ctx.assert.ok(fallbackPoint, 'completed task should create one recovery point')

        ctx.writeText(filePath, 'USER_EDIT_AFTER_TASK\n')
        const conflict = await recoveryPoints.restoreRecoveryPoint(projectId, fallbackPoint.id)
        ctx.assert.ok(conflict.conflict, 'restore should report files modified after the task')
        ctx.assert.equal(fs.readFileSync(filePath, 'utf-8'), 'USER_EDIT_AFTER_TASK\n', 'conflict detection must not overwrite the file')
        ctx.writeText(filePath, after)
        const fallbackRestore = await recoveryPoints.restoreRecoveryPoint(projectId, fallbackPoint.id)
        ctx.assert.ok(fallbackRestore.success, fallbackRestore.error || 'fallback recovery point should restore')
        ctx.assert.equal(fs.readFileSync(filePath, 'utf-8'), before, 'task recovery point should restore original content')
      } finally {
        console.log = originalConsoleLog
        console.error = originalConsoleError
        gitSafety.createAiSafetySnapshot = originalCreateAiSafetySnapshot
        if (changeSessions.getActiveSession(projectId)?.id === toolSession.id) {
          changeSessions.finalizeChangeSession(projectId, toolSession.id, 'completed')
        }
      }

      for (let index = 0; index < 7; index++) {
        await recoveryPoints.createFileRecoveryPoint(projectId, workspace.projectPath, {
          phase: 'before',
          source: 'ai_auto',
          paths: [filePath],
          retention: { maxAutoPoints: 3, maxAutoBytes: 20 * 1024 * 1024 }
        })
      }

      const list = recoveryPoints.listRecoveryPoints(projectId)
      ctx.assert.ok(list.success, 'recovery point list should succeed')
      const autoPoints = list.points.filter(item => item.source === 'ai_auto')
      ctx.assert.ok(autoPoints.length <= 3, `automatic recovery points should be cleaned, got ${autoPoints.length}`)

      const namedManual = await recoveryPoints.createManualRecoveryPoint(projectId, workspace.projectPath, {
        name: 'Named manual point',
        retention: { maxAutoPoints: 3, maxManualPoints: 3 }
      })
      ctx.assert.ok(namedManual.success, namedManual.error || 'manual project recovery point should be created')
      for (let index = 0; index < 4; index++) {
        await recoveryPoints.createFileRecoveryPoint(projectId, workspace.projectPath, {
          phase: 'manual',
          source: 'manual',
          paths: [filePath],
          retention: { maxAutoPoints: 3, maxManualPoints: 3 }
        })
      }
      const separated = recoveryPoints.listRecoveryPoints(projectId).points
      ctx.assert.ok(separated.filter(item => item.source === 'ai_auto').length <= 3, 'manual points must not evict AI quota independently')
      ctx.assert.ok(separated.filter(item => item.source === 'manual').length <= 3, 'manual points should use their own retention limit')

      const deleteTarget = autoPoints[0]
      ctx.assert.ok(deleteTarget?.id, 'there should be a recovery point to delete')
      const deleteResult = await recoveryPoints.deleteRecoveryPoint(projectId, deleteTarget.id)
      ctx.assert.ok(deleteResult.success, deleteResult.error || 'recovery point delete should succeed')
      const afterDelete = recoveryPoints.listRecoveryPoints(projectId)
      ctx.assert.ok(!afterDelete.points.some(item => item.id === deleteTarget.id), 'deleted recovery point should be absent from list')
    } finally {
      await changeSessions.flushPendingSessionWrites()
      config.deleteProjectInstance(projectId)
      workspace.cleanup()
    }
  }
}
