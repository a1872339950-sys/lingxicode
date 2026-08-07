const fs = require('fs')
const path = require('path')

module.exports = {
  id: 'recovery-point.cleanup-failure-tolerance',
  title: 'Recovery point creation survives quota cleanup failure with a pending marker',
  tags: ['recovery-point', 'cleanup', 'fault-injection'],
  changedFilePatterns: [
    /^electron\/modules\/(?:ai-task-recovery-points|recovery-points|content-object-store)\.js$/i
  ],

  async run(ctx) {
    const workspace = ctx.createWorkspace(this.id)
    const config = require(path.join(ctx.root, 'electron/modules/config'))
    const changeSessions = require(path.join(ctx.root, 'electron/modules/change-sessions'))
    const taskRecovery = require(path.join(ctx.root, 'electron/modules/ai-task-recovery-points'))
    const manifests = require(path.join(ctx.root, 'electron/modules/recovery-point-manifests'))
    const objectStore = require(path.join(ctx.root, 'electron/modules/content-object-store'))
    const projectId = `cleanup-failure-${Date.now()}`
    const filePath = path.join(workspace.projectPath, 'src', 'app.js')
    fs.mkdirSync(path.dirname(filePath), { recursive: true })
    fs.writeFileSync(filePath, 'after-content', 'utf8')
    config.setProjectInstance(projectId, { projectId, projectPath: workspace.projectPath, storagePath: workspace.storagePath })

    const originalSnapshot = changeSessions.getRecoverySnapshot
    try {
      changeSessions.getRecoverySnapshot = () => ({
        id: 'change-session-fault',
        projectId,
        projectPath: workspace.projectPath,
        status: 'completed',
        files: [{
          path: filePath,
          action: 'modify',
          existedBefore: true,
          existsAfter: true,
          beforeHash: 'before-hash',
          afterHash: 'after-hash',
          beforeContent: 'before-content',
          beforeSize: 14,
          beforeUnsupported: false,
          afterUnsupported: false
        }]
      })
      const result = await taskRecovery.create({
        projectId,
        projectPath: workspace.projectPath,
        changeSessionId: 'change-session-fault',
        listPoints: async () => [],
        cleanup: async () => { throw new Error('intentional retention cleanup failure') },
        isPathInside: () => true
      })
      ctx.assert.ok(result.success, 'cleanup failure must not roll back a valid recovery point')
      ctx.assert.ok(result.cleanup?.pending, 'cleanup failure should be recorded as pending work')
      ctx.assert.ok(manifests.read(projectId, result.id), 'the recovery manifest should remain durable')
      ctx.assert.equal((await objectStore.getStatus(projectId)).referenceCount, 1, 'the retained manifest should keep its content reference')

      await manifests.remove(projectId, result.id)
      await objectStore.releaseOwner(projectId, 'recovery-point', result.id)
      await objectStore.garbageCollect(projectId)
    } finally {
      changeSessions.getRecoverySnapshot = originalSnapshot
      config.deleteProjectInstance(projectId)
      workspace.cleanup()
    }
  }
}
