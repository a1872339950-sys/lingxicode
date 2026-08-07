const fs = require('fs')
const path = require('path')
const vm = require('vm')

module.exports = {
  id: 'change-session.single-fact-source',
  title: 'Completed operation summaries and diffs use persisted change-session facts',
  tags: ['change-session', 'diff', 'operation-summary'],
  changedFilePatterns: [
    /^electron\/modules\/(?:change-sessions|ai-task-recovery-points)\.js$/i,
    /^frontend\/scripts\/features\/(?:operation-summary|window-tabs|change-diff-policy)\.js$/i
  ],

  async run(ctx) {
    const source = fs.readFileSync(path.join(ctx.root, 'frontend/scripts/features/operation-summary.js'), 'utf8')
    const sandbox = { window: { getActiveProject: () => ({ path: 'C:/project' }) }, console }
    vm.createContext(sandbox)
    vm.runInContext(source, sandbox)

    const html = sandbox.window.OperationSummary.generate({}, {
      changeSession: {
        id: 'persisted-change-session',
        files: [{ path: 'C:/project/src/app.js', action: 'modify', additions: 7, deletions: 3 }]
      },
      operationSnapshot: {
        sessionId: 'stale-live-snapshot',
        files: [{ path: 'C:/project/src/app.js', action: 'modify', added: 99, removed: 88 }]
      }
    })
    ctx.assert.ok(html.includes('+7') && html.includes('-3'), 'completed summary should use persisted change-session line facts')
    ctx.assert.ok(!html.includes('+99') && !html.includes('-88'), 'stale live pill statistics must not override persisted facts')
    ctx.assert.ok(html.includes('persisted-change-session'), 'diff actions should carry the canonical change-session ID')

    ctx.assert.ok(/normalizeSessionFilesForDiff\(result\.session\)/.test(source), 'diff loading should use persisted session files without live-stat overlays')
    const recoverySource = fs.readFileSync(path.join(ctx.root, 'electron/modules/ai-task-recovery-points.js'), 'utf8')
    ctx.assert.ok(/changeSessions\.getRecoverySnapshot\(projectId, changeSessionId\)/.test(recoverySource), 'recovery points should read the same change-session record')
  }
}
