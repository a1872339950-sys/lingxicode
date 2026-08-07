const path = require('path')

module.exports = {
  id: 'runtime-contract.verify',
  title: 'Post-change verification catches cross-file runtime API contract errors',
  tags: ['verification', 'runtime-contract', 'tools'],
  changedFilePatterns: [
    /^electron\/modules\/change-planner\.js$/i,
    /^electron\/modules\/tools\.js$/i,
    /^electron\/modules\/tools-schema\.js$/i
  ],

  async run(ctx) {
    const workspace = ctx.createWorkspace(this.id)
    try {
      ctx.writeText(path.join(workspace.projectPath, 'frontend/scripts/app.js'), [
        'const contextUI = window.ContextUI',
        'function updateContextIndicatorImpl(status) {',
        '  contextUI.updateIndicator(status)',
        '}',
        'updateContextIndicatorImpl({ count: 1 })',
        ''
      ].join('\n'))

      ctx.writeText(path.join(workspace.projectPath, 'frontend/scripts/features/context-ui.js'), [
        'function updateSidebar(status) {',
        '  return status',
        '}',
        'window.ContextUI = {',
        '  updateSidebar',
        '}',
        ''
      ].join('\n'))

      const changePlanner = require(path.join(ctx.root, 'electron/modules/change-planner'))
      // generateVerifyReport 现为 async，必须 await
      const callerOnlyReport = await changePlanner.generateVerifyReport({
        projectPath: workspace.projectPath,
        changedFiles: ['frontend/scripts/app.js']
      })

      ctx.assert.equal(callerOnlyReport.success, true, 'verify report should be generated')
      ctx.assert.equal(callerOnlyReport.overallStatus, 'errors', 'missing object API method should fail verification')
      ctx.assert.ok(
        callerOnlyReport.runtimeContracts.issues.some(issue =>
          issue.module === 'ContextUI' &&
          issue.method === 'updateIndicator' &&
          issue.caller === 'frontend/scripts/app.js' &&
          issue.providerFiles.includes('frontend/scripts/features/context-ui.js')
        ),
        'runtime contract scan should connect the caller to the window.ContextUI provider'
      )

      const providerOnlyReport = await changePlanner.generateVerifyReport({
        projectPath: workspace.projectPath,
        changedFiles: ['frontend/scripts/features/context-ui.js']
      })
      ctx.assert.equal(providerOnlyReport.overallStatus, 'errors', 'changed provider should scan existing callers')
      ctx.assert.ok(providerOnlyReport.summary.includes('runtime contract issue'), 'summary should mention runtime contract issues')

      ctx.writeText(path.join(workspace.projectPath, 'frontend/scripts/features/context-ui.js'), [
        'function updateSidebar(status) {',
        '  return status',
        '}',
        'function updateIndicator(status) {',
        '  return status',
        '}',
        'window.ContextUI = {',
        '  updateSidebar,',
        '  updateIndicator',
        '}',
        ''
      ].join('\n'))

      const fixedReport = await changePlanner.generateVerifyReport({
        projectPath: workspace.projectPath,
        changedFiles: ['frontend/scripts/app.js', 'frontend/scripts/features/context-ui.js']
      })
      ctx.assert.equal(fixedReport.runtimeContracts.issues.length, 0, 'runtime contract issue should clear after exporting the method')
      ctx.assert.equal(fixedReport.overallStatus, 'clean', 'fixed runtime contract should verify cleanly')

      ctx.writeText(path.join(workspace.projectPath, 'frontend/scripts/broken-import.js'), [
        'import missing from "./missing-module"',
        'console.log(missing)',
        ''
      ].join('\n'))
      const importReport = await changePlanner.generateVerifyReport({
        projectPath: workspace.projectPath,
        changedFiles: ['frontend/scripts/broken-import.js']
      })
      ctx.assert.equal(importReport.overallStatus, 'errors', 'missing relative imports should fail verification')
      ctx.assert.ok(importReport.importLinks.issues.some(issue => issue.request === './missing-module'), 'missing relative import should be reported')

      ctx.writeText(path.join(workspace.projectPath, 'frontend/scripts/provider.js'), [
        'export function existingApi() {',
        '  return true',
        '}',
        ''
      ].join('\n'))
      ctx.writeText(path.join(workspace.projectPath, 'frontend/scripts/named-import.js'), [
        'import { missingApi } from "./provider"',
        'console.log(missingApi)',
        ''
      ].join('\n'))
      const namedImportReport = await changePlanner.generateVerifyReport({
        projectPath: workspace.projectPath,
        changedFiles: ['frontend/scripts/named-import.js']
      })
      ctx.assert.equal(namedImportReport.overallStatus, 'errors', 'missing named exports should fail verification')
      ctx.assert.ok(
        namedImportReport.importLinks.issues.some(issue =>
          issue.type === 'missing-named-export' &&
          issue.importedName === 'missingApi' &&
          issue.provider === 'frontend/scripts/provider.js'
        ),
        'missing named export should identify caller import and provider file'
      )
    } finally {
      workspace.cleanup()
    }
  }
}
