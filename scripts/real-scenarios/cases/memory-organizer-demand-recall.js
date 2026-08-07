const path = require('path')

module.exports = {
  id: 'memory-organizer.demand-recall',
  title: 'Organized memory keeps legacy lists but recalls relevant entries by current request',
  tags: ['memory-organizer', 'memory', 'context'],
  changedFilePatterns: [
    /^electron\/modules\/memory-organizer\.js$/i,
    /^electron\/modules\/ai-chat\.js$/i,
    /^electron\/tools\/context-manager\.js$/i
  ],

  async run(ctx) {
    const workspace = ctx.createWorkspace(this.id)
    const memoryOrganizer = require(path.join(ctx.root, 'electron/modules/memory-organizer'))
    const instance = { storagePath: workspace.storagePath }

    try {
      const saved = memoryOrganizer.save(instance, {
        preferences: ['用户喜欢直接实现，不要只给方案'],
        rules: ['修改文件前必须先确认相关文件上下文'],
        projectFacts: [
          '右侧协作窗口主要在 frontend/scripts/features/agent-collaboration-ui.js',
          '本地应用栏主要在 frontend/scripts/features/local-apps.js'
        ],
        openLoops: ['继续优化记忆系统的按需召回能力']
      })

      ctx.assert.ok(Array.isArray(saved.entries) && saved.entries.length >= 4, 'legacy list memory should be mirrored into entries')

      const context = memoryOrganizer.formatForContext(saved, {
        query: '协作窗口打开后没有活动，检查右侧多会话窗口',
        maxCore: 2,
        maxRelated: 3
      })
      ctx.assert.ok(context.includes('【长期整理记忆】'), 'memory context block should be present')
      ctx.assert.ok(context.includes('按需召回记忆'), 'memory context should use demand recall')
      ctx.assert.ok(context.includes('agent-collaboration-ui.js'), 'related collaboration memory should be recalled')
      ctx.assert.ok(!context.includes('local-apps.js'), 'unrelated local apps memory should not be injected for this request')

      const hits = memoryOrganizer.searchMemory(saved, '本地应用图标点击没反应', { maxItems: 2 })
      ctx.assert.ok(hits.some(hit => hit.entry.content.includes('local-apps.js')), 'searchMemory should find related local apps memory')
    } finally {
      workspace.cleanup()
    }
  }
}
