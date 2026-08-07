const path = require('path')

module.exports = {
  id: 'request-history.fixed-window',
  title: 'AI request history is bounded by token weight without turn-count trimming',
  tags: ['ai-chat', 'history', 'performance'],
  changedFilePatterns: [
    /^electron\/modules\/ai-chat\.js$/i,
    /^electron\/modules\/request-history-window\.js$/i
  ],

  async run(ctx) {
    const windowing = require(path.join(ctx.root, 'electron/modules/request-history-window'))
    const contextCompression = require(path.join(ctx.root, 'electron/modules/context-compression'))

    const tinyHistory = []
    for (let index = 1; index <= 80; index++) {
      tinyHistory.push({ role: 'user', content: `u${index}` }, { role: 'assistant', content: `a${index}` })
    }
    const tiny = windowing.buildRequestHistoryWindow(tinyHistory, tinyHistory.length - 1, { tokenBudget: 10000 })
    ctx.assert.equal(tiny.startIndex, 0, 'many tiny messages must not be trimmed merely because there are many turns')

    const heavyHistory = [
      { role: 'user', content: 'A'.repeat(12000) },
      { role: 'assistant', content: 'B'.repeat(12000) },
      { role: 'user', content: 'current' }
    ]
    const heavy = windowing.buildRequestHistoryWindow(heavyHistory, 2, { tokenBudget: 1000 })
    ctx.assert.equal(heavy.history.at(-1)?.content, 'current', 'the current request must remain')
    ctx.assert.ok(heavy.trimmedCount > 0, 'a small number of heavy messages must be trimmed by weight')

    const epochHistory = [
      { messageId: 'm1', role: 'user', content: 'old' },
      { messageId: 'm2', role: 'assistant', content: 'done' },
      { messageId: 'm3', role: 'user', content: 'new' },
      { messageId: 'm4', role: 'assistant', content: 'working' }
    ]
    const epoch = windowing.buildCompressionEpochHistory(epochHistory, 3, {
      coveredMessageId: 'm2',
      summaryBlock: 'stable summary',
      tokenBudget: 10000
    })
    ctx.assert.equal(epoch.history[0].content, 'stable summary', 'summary should lead the new cache epoch')
    ctx.assert.equal(epoch.history[1].content, 'new', 'epoch must begin after the covered message cursor')
    ctx.assert.ok(epoch.epochTokens > 0, 'epoch should report token weight')

    const summaries = [{ id: 'summary-1', endMessageId: 'm2', endHistoryIndex: 2, summaryText: 's' }]
    const selected = contextCompression.selectCacheEpochSummaries(summaries)
    ctx.assert.equal(selected.coveredMessageId, 'm2', 'cache epoch should use a stable message cursor')
    ctx.assert.equal(selected.coveredMessageIndex, 1, 'message cursor index should be zero-based')
    ctx.assert.equal(windowing.DEFAULT_HISTORY_TOKEN_BUDGET, 80000, 'fallback history budget should be token based')
  }
}
