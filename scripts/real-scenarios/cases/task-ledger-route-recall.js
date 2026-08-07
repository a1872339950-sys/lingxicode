const fs = require('fs')
const path = require('path')

module.exports = {
  id: 'task-ledger.route-recall',
  title: 'Historical task context is opt-in and route recall remains available',
  tags: ['task-ledger', 'route-memory', 'code-location', 'intent-isolation'],
  changedFilePatterns: [
    /^electron\/modules\/task-ledger\.js$/i,
    /^electron\/modules\/ai-chat\.js$/i,
    /^electron\/modules\/chat\/intent-safety\.js$/i
  ],

  async run(ctx) {
    const workspace = ctx.createWorkspace(this.id)
    const storageConfig = require(path.join(ctx.root, 'electron/modules/storage-config'))
    const taskLedger = require(path.join(ctx.root, 'electron/modules/task-ledger'))
    const { shouldIncludeHistoricalProjectContext } = require(path.join(ctx.root, 'electron/modules/chat/intent-safety'))
    const projectId = `scenario-route-${Date.now()}-${Math.random().toString(16).slice(2)}`

    try {
      fs.mkdirSync(workspace.projectPath, { recursive: true })
      storageConfig.init(workspace.storagePath, {
        isPackaged: true,
        getPath: () => workspace.dir
      })
      const instance = { projectId, projectPath: workspace.projectPath, storagePath: workspace.storagePath }
      const oldRequest = '本地应用点击没反应，local-apps.js 报错，图标也不对'
      const newRequest = '为什么本地应用点击后没有反应，图标显示错误'

      taskLedger.createLedgerEntry(instance, {
        type: 'action',
        title: oldRequest,
        userRequest: oldRequest,
        completed: ['修复本地应用渲染和启动逻辑'],
        changedFiles: ['frontend/scripts/features/local-apps.js'],
        route: {
          userRequest: oldRequest,
          routeSummary: 'Files: frontend/scripts/features/local-apps.js, electron/modules/software-access.js',
          routeFiles: ['frontend/scripts/features/local-apps.js', 'electron/modules/software-access.js'],
          searchQueries: ['rg -n "local-apps|launch|icon" frontend electron'],
          verification: ['passed | node --check frontend/scripts/features/local-apps.js']
        }
      })

      const recall = taskLedger.formatRouteRecallForContext(instance, newRequest, { maxItems: 2 })
      ctx.assert.ok(recall.includes('【相似任务路线记忆】'), 'route recall block should be injected')
      ctx.assert.ok(recall.includes('frontend/scripts/features/local-apps.js'), 'route recall should include the prior target file')
      ctx.assert.ok(recall.includes('electron/modules/software-access.js'), 'route recall should include related backend file')
      ctx.assert.equal(
        shouldIncludeHistoricalProjectContext('检查模型为什么会答非所问'),
        false,
        'a new request must not receive recent task ledger summaries'
      )
      ctx.assert.equal(
        shouldIncludeHistoricalProjectContext('继续上次的本地应用问题'),
        true,
        'an explicit continuation may receive historical task context'
      )
    } finally {
      workspace.cleanup()
    }
  }
}
