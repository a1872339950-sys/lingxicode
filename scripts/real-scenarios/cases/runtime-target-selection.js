const path = require('path')
const { EventEmitter } = require('events')

function createWebContents(id, title, url) {
  let destroyed = false
  const contents = new EventEmitter()
  return Object.assign(contents, {
    id,
    getTitle: () => title,
    getURL: () => url,
    getType: () => 'webview',
    isDestroyed: () => destroyed,
    destroyForTest: () => { destroyed = true },
  })
}

module.exports = {
  id: 'runtime-target-selection',
  title: 'Runtime targeting refuses to guess between multiple project windows',
  tags: ['runtime', 'screenshot', 'browser', 'window-targeting'],
  changedFilePatterns: [
    /^electron\/modules\/runtime-targets\.js$/i,
    /^electron\/modules\/tool-handlers\/screenshot\.js$/i,
    /^electron\/modules\/windows\.js$/i,
    /^frontend\/scripts\/features\/window-tabs\.js$/i
  ],

  async run(ctx) {
    const registry = require(path.join(ctx.root, 'electron/modules/runtime-targets'))
    const diagnostics = require(path.join(ctx.root, 'electron/modules/runtime-diagnostics'))
    registry.resetForTests()
    diagnostics.clear()

    const preview = createWebContents(91001, 'Lingxi preview', 'http://127.0.0.1:4173/settings')
    const admin = createWebContents(91002, 'Lingxi admin', 'http://127.0.0.1:4174/admin')
    registry.registerWebContents(preview, {
      runtimeId: 'runtime-project-a-preview',
      projectId: 'project-a',
      tabId: 'preview',
      active: true
    })
    registry.registerWebContents(admin, {
      runtimeId: 'runtime-project-a-admin',
      projectId: 'project-a',
      tabId: 'admin'
    })
    diagnostics.attachWebContents(admin, { source: 'scenario-window' })
    admin.emit('console-message', {}, 3, 'ReferenceError: visible runtime failed', 17, 'app.js')
    const exactErrors = diagnostics.summarize({ webContentsId: admin.id, projectId: 'project-a' })
    ctx.assert.equal(exactErrors.error_count, 1, 'late project binding should preserve exact F12 errors for the runtime')
    ctx.assert.equal(exactErrors.events[0].webContentsId, admin.id, 'runtime errors should stay scoped to the selected window')

    const ambiguous = registry.resolveRuntimeTarget({}, 'project-a')
    ctx.assert.equal(ambiguous.success, false, 'multiple project windows must not resolve silently')
    ctx.assert.equal(ambiguous.ambiguous, true, 'multiple matches should be reported as ambiguous')
    ctx.assert.equal(ambiguous.candidates.length, 2, 'all matching runtime candidates should be returned')

    const explicit = registry.resolveRuntimeTarget({ runtime_id: 'runtime-project-a-admin' }, 'project-a')
    ctx.assert.equal(explicit.success, true, 'runtime_id should select a single target')
    ctx.assert.equal(explicit.webContents.id, admin.id, 'runtime_id should resolve the requested window')
    const crossProject = registry.resolveRuntimeTarget({ runtime_id: 'runtime-project-a-admin' }, 'project-b')
    ctx.assert.equal(crossProject.success, false, 'an explicit runtime_id must not bypass project binding')
    ctx.assert.ok(/different project/.test(crossProject.error), 'cross-project rejection should explain the binding mismatch')
    const crossProjectWebContents = registry.resolveRuntimeTarget({ webContentsId: admin.id }, 'project-b')
    ctx.assert.equal(crossProjectWebContents.success, false, 'an explicit webContentsId must not bypass project binding')
    const unbound = createWebContents(91004, 'Unbound preview', 'http://127.0.0.1:4175/')
    registry.registerWebContents(unbound, { runtimeId: 'runtime-unbound-preview' })
    const unboundSelection = registry.resolveRuntimeTarget({ runtime_id: 'runtime-unbound-preview', workspacePath: 'E:/expected-workspace' }, '')
    ctx.assert.equal(unboundSelection.success, false, 'an unbound runtime must not be adopted by a workspace verification request')
    ctx.assert.ok(/not bound/.test(unboundSelection.error), 'unbound rejection should explain the missing project/workspace binding')

    const hinted = registry.resolveRuntimeTarget({ runtime_url: ':4173/settings' }, 'project-a')
    ctx.assert.equal(hinted.success, true, 'a unique URL hint should resolve a target')
    ctx.assert.equal(hinted.webContents.id, preview.id, 'URL hint should resolve the matching runtime')

    const installed = createWebContents(91003, 'Lingxi Stable', 'file:///installed/frontend/index.html')
    registry.registerWebContents(installed, {
      runtimeId: 'runtime-project-a-installed',
      projectId: 'project-a',
      buildType: 'installed',
      observationOnly: true,
      active: true
    })
    const eligibleTargets = registry.listRuntimeTargets({ projectId: 'project-a' })
    ctx.assert.equal(eligibleTargets.length, 2, 'installed targets must be excluded from verification candidates')
    const allTargets = registry.listRuntimeTargets({ projectId: 'project-a', includeObservationOnly: true })
    ctx.assert.equal(allTargets.length, 3, 'diagnostics may still list installed targets as observation-only')
    ctx.assert.equal(allTargets.find(item => item.runtime_id === 'runtime-project-a-installed')?.verification_eligible, false, 'installed target must be marked ineligible')
    const installedSelection = registry.resolveRuntimeTarget({ runtime_id: 'runtime-project-a-installed' }, 'project-a')
    ctx.assert.equal(installedSelection.success, false, 'even an explicit installed runtime id must not verify source changes')
    ctx.assert.equal(installedSelection.observation_only, true, 'installed rejection must explain that the target is observation-only')

    preview.destroyForTest()
    const remaining = registry.listRuntimeTargets({ projectId: 'project-a' })
    ctx.assert.equal(remaining.length, 1, 'destroyed runtime targets should be pruned')
    ctx.assert.equal(remaining[0].runtime_id, 'runtime-project-a-admin')
    registry.resetForTests()
    diagnostics.clear()
  }
}
