const fs = require('fs')
const path = require('path')

module.exports = {
  id: 'context-builder.stable-oversized-refs',
  title: 'Context builder keeps oversized message references stable for identical content',
  tags: ['context-builder', 'prompt-cache', 'filesystem'],
  changedFilePatterns: [
    /^electron\/tools\/context-builder\.js$/i
  ],

  async run(ctx) {
    const workspace = ctx.createWorkspace(this.id)
    const { buildContextPayload } = require(path.join(ctx.root, 'electron/tools/context-builder'))
    const longText = `BEFORE\n${'A'.repeat(18000)}\nEND_BEFORE`
    const contextManager = {
      storagePath: workspace.storagePath
    }

    try {
      const first = buildContextPayload({
        contextManager,
        systemPrompt: 'stable system prompt',
        history: [{ role: 'user', content: longText }],
        policy: {
          inputBudgetTokens: 1000,
          maxSingleMessageChars: 2000,
          minSingleMessageChars: 2000,
          inputBudgetTokens: 20000,
          includeBehaviorSummary: false,
          includeDynamicCompressedHistory: false
        }
      })

      const second = buildContextPayload({
        contextManager,
        systemPrompt: 'stable system prompt',
        history: [{ role: 'user', content: longText }],
        policy: {
          inputBudgetTokens: 1000,
          maxSingleMessageChars: 2000,
          minSingleMessageChars: 2000,
          inputBudgetTokens: 20000,
          includeBehaviorSummary: false,
          includeDynamicCompressedHistory: false
        }
      })

      ctx.assert.equal(first.oversizedRefs.length, 1, 'first build should create one oversized reference')
      ctx.assert.equal(second.oversizedRefs.length, 1, 'second build should create one oversized reference')
      ctx.assert.equal(first.oversizedRefs[0], second.oversizedRefs[0], 'same long content should reuse the same reference path')
      ctx.assert.equal(fs.readFileSync(first.oversizedRefs[0], 'utf-8'), longText, 'oversized reference should keep the full original content')
    } finally {
      workspace.cleanup()
    }
  }
}
