const fs = require('fs')
const path = require('path')

module.exports = {
  id: 'change-session.retention-index',
  title: 'Change sessions use an index and reclaim only unreferenced expired records',
  tags: ['change-session', 'retention', 'content-object-store'],
  changedFilePatterns: [
    /^electron\/modules\/change-session(?:s|-index|-retention|-snapshots)?\.js$/i,
    /^electron\/modules\/content-object-store\.js$/i,
    /^electron\/modules\/recovery-point-manifests\.js$/i
  ],

  async run(ctx) {
    const workspace = ctx.createWorkspace(this.id)
    const config = require(path.join(ctx.root, 'electron/modules/config'))
    const objectStore = require(path.join(ctx.root, 'electron/modules/content-object-store'))
    const changeSessions = require(path.join(ctx.root, 'electron/modules/change-sessions'))
    const changeSessionIndex = require(path.join(ctx.root, 'electron/modules/change-session-index'))
    const retention = require(path.join(ctx.root, 'electron/modules/change-session-retention'))
    const recoveryManifests = require(path.join(ctx.root, 'electron/modules/recovery-point-manifests'))
    const projectId = `change-retention-${Date.now()}`
    const sessionDir = path.join(workspace.storagePath, 'change-sessions')
    const indexPath = path.join(sessionDir, '_index.json')
    config.setProjectInstance(projectId, {
      projectId,
      projectPath: workspace.projectPath,
      storagePath: workspace.storagePath
    })

    const expiredSession = makeSession(projectId, workspace.projectPath, 'expired-session', '2020-01-01T00:00:00.000Z')
    const referencedSession = makeSession(projectId, workspace.projectPath, 'referenced-session', '2020-01-02T00:00:00.000Z')
    try {
      fs.mkdirSync(sessionDir, { recursive: true })
      ctx.writeText(path.join(sessionDir, `${expiredSession.id}.json`), JSON.stringify(expiredSession))
      ctx.writeText(path.join(sessionDir, `${referencedSession.id}.json`), JSON.stringify(referencedSession))
      changeSessionIndex.upsert(indexPath, sessionDir, expiredSession)
      changeSessionIndex.upsert(indexPath, sessionDir, referencedSession)

      await objectStore.putBuffer(projectId, Buffer.from('expired-content'), {
        reference: { kind: 'change-session', ownerId: expiredSession.id, phase: 'before', filePath: 'expired.txt' }
      })
      await objectStore.putBuffer(projectId, Buffer.from('referenced-content'), {
        reference: { kind: 'change-session', ownerId: referencedSession.id, phase: 'before', filePath: 'referenced.txt' }
      })
      await recoveryManifests.atomicWrite(projectId, {
        id: 'recovery-keeps-session',
        source: 'ai_auto',
        changeSessionId: referencedSession.id,
        createdAt: new Date().toISOString(),
        files: []
      })

      const result = await changeSessions.cleanupChangeSessions(projectId, {
        now: Date.now(),
        unreferencedTtlMs: 60 * 1000,
        maxUnreferencedSessions: 1
      })
      ctx.assert.ok(result.removed.includes(expiredSession.id), 'expired unreferenced session should be removed')
      ctx.assert.ok(!fs.existsSync(path.join(sessionDir, `${expiredSession.id}.json`)), 'expired session file should be deleted')
      ctx.assert.ok(fs.existsSync(path.join(sessionDir, `${referencedSession.id}.json`)), 'a formal recovery point should retain its change session')
      ctx.assert.ok(!changeSessionIndex.list(indexPath, sessionDir).some(item => item.id === expiredSession.id), 'index should update after record deletion')
      const objectStatus = await objectStore.getStatus(projectId)
      ctx.assert.equal(objectStatus.objectCount, 1, 'cleanup should reclaim only the unreferenced change-session object')

      const sessions = Array.from({ length: 100 }, (_, index) => makeSession(projectId, workspace.projectPath, `session-${index}`, new Date(index + 1).toISOString()))
      const expired = new Set(retention.selectExpiredSessions(sessions, new Set(), { now: 1000, unreferencedTtlMs: 10 ** 12 }))
      ctx.assert.equal(sessions.filter(session => !expired.has(session.id)).length, retention.DEFAULT_MAX_UNREFERENCED_SESSIONS, 'capacity cleanup should retain only the newest bounded unreferenced sessions')
    } finally {
      config.deleteProjectInstance(projectId)
      workspace.cleanup()
    }
  }
}

function makeSession(projectId, projectPath, id, finalizedAt) {
  return {
    id,
    projectId,
    projectPath,
    status: 'completed',
    startedAt: finalizedAt,
    finalizedAt,
    files: {},
    fileOrder: [],
    commands: []
  }
}
