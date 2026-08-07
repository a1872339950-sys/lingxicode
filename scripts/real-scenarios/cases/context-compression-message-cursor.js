const path = require('path')

module.exports = {
  id: 'context-compression.message-cursor',
  title: 'Context compression is triggered by token weight and advances by message cursor',
  tags: ['context-compression', 'cursor', 'token-budget'],
  changedFilePatterns: [/^electron\/modules\/context-compression\.js$/i],

  async run(ctx) {
    const workspace = ctx.createWorkspace(this.id)
    const compression = require(path.join(ctx.root, 'electron/modules/context-compression'))
    const identity = require(path.join(ctx.root, 'electron/modules/chat-message-identity'))
    const instance = { storagePath: workspace.storagePath }
    try {
      const tiny = []
      for (let index = 0; index < 40; index++) tiny.push({ role: 'user', content: '短' }, { role: 'assistant', content: '好' })
      identity.assignMessageIdentity(tiny, { sessionId: 'tiny', deterministic: true })
      const tinyPlan = await compression.getCompressionPlan(instance, tiny, { triggerTokens: 10000, retainTokens: 4000 })
      ctx.assert.equal(tinyPlan.shouldCreate, false, 'many short turns must not trigger count-based compression')

      const heavy = [
        { role: 'user', content: '需求'.repeat(5000) },
        { role: 'assistant', content: '结果'.repeat(5000) },
        { role: 'user', content: '第二个需求'.repeat(4000) },
        { role: 'assistant', content: '第二个结果'.repeat(4000) },
        { role: 'user', content: '继续' }
      ]
      identity.assignMessageIdentity(heavy, { sessionId: 'heavy', deterministic: true })
      const plan = await compression.getCompressionPlan(instance, heavy, { triggerTokens: 8000, retainTokens: 4000 })
      ctx.assert.ok(plan.shouldCreate, 'two heavy completed turns should trigger compression immediately')
      ctx.assert.ok(plan.pendingTokens >= 8000, 'plan should expose measured pending tokens')

      const first = await compression.createCompressionSummary(instance, heavy, { triggerTokens: 8000, retainTokens: 4000 })
      ctx.assert.ok(first.created, 'heavy history should create a summary')
      ctx.assert.ok(first.summary.endMessageId, 'summary should persist a stable message cursor')
      ctx.assert.ok(first.summary.sourceTokenEstimate > 0, 'summary should record source token weight')

      const nextHistory = heavy.concat([
        { role: 'assistant', content: '当前完成' },
        { role: 'user', content: '新增'.repeat(5000) },
        { role: 'assistant', content: '新增结果'.repeat(5000) }
      ])
      identity.assignMessageIdentity(nextHistory, { sessionId: 'heavy', deterministic: true })
      const next = await compression.getCompressionPlan(instance, nextHistory, { triggerTokens: 8000, retainTokens: 4000 })
      ctx.assert.ok(next.cursorMatched, 'next compression must continue from the saved message cursor')
      ctx.assert.ok(next.startHistoryIndex > first.summary.startHistoryIndex, 'covered messages must not be summarized again')
    } finally {
      workspace.cleanup()
    }
  }
}
