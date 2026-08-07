const path = require('path')

module.exports = {
  id: 'ipc-consistency.closure',
  title: 'IPC consistency follows handler, preload, and frontend evidence across the project',
  tags: ['tools', 'ipc', 'verification'],
  changedFilePatterns: [
    /^electron\/modules\/ipc-consistency-checker\.js$/i,
    /^electron\/modules\/change-planner\.js$/i,
    /^electron\/preload\.js$/i
  ],

  async run(ctx) {
    const workspace = ctx.createWorkspace(this.id)
    const { checkIpcConsistency } = require(path.join(ctx.root, 'electron/modules/ipc-consistency-checker'))
    const changePlanner = require(path.join(ctx.root, 'electron/modules/change-planner'))
    try {
      const handlerPath = path.join(workspace.projectPath, 'electron', 'sample-ipc.js')
      const preloadPath = path.join(workspace.projectPath, 'electron', 'preload.js')
      const frontendPath = path.join(workspace.projectPath, 'frontend', 'sample.js')
      ctx.writeText(handlerPath, "ipcMain.handle('sample:load', async () => ({ ok: true }))")
      ctx.writeText(preloadPath, [
        "contextBridge.exposeInMainWorld('api', {",
        "  loadSample: () => ipcRenderer.invoke('sample:load'),",
        "  missingSample: () => ipcRenderer.invoke('sample:missing')",
        '})'
      ].join('\n'))
      ctx.writeText(frontendPath, 'window.api.loadSample()')

      const complete = checkIpcConsistency({
        projectPath: workspace.projectPath,
        changedFiles: [handlerPath],
        sourceFiles: [handlerPath, preloadPath, frontendPath]
      })
      ctx.assert.equal(complete.issues, 0, 'a caller in unchanged preload must satisfy a changed handler')
      const channel = complete.channels.find(item => item.channel === 'sample:load')
      ctx.assert.ok(channel?.preloadExposures.some(item => item.endsWith('#loadSample')), 'preload API method should be part of the closure')
      ctx.assert.ok(channel?.frontendCallerFiles.includes('frontend/sample.js'), 'frontend window.api caller should be linked to the IPC channel')

      const report = await changePlanner.generateVerifyReportAsync({
        projectPath: workspace.projectPath,
        changedFiles: [handlerPath]
      })
      ctx.assert.equal(report.ipcConsistency.issues, 0, 'post-change verification should use the full IPC closure')

      const missing = checkIpcConsistency({
        projectPath: workspace.projectPath,
        changedFiles: [preloadPath],
        sourceFiles: [handlerPath, preloadPath, frontendPath]
      })
      ctx.assert.equal(missing.channels.find(item => item.channel === 'sample:missing')?.issue, 'No handler registered')
      ctx.assert.equal(missing.scope, 'changed-channels/full-project-closure')
      ctx.assert.ok(missing.scannedFileCount >= 3)
    } finally {
      workspace.cleanup()
    }
  }
}
