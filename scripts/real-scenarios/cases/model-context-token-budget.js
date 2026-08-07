const path = require('path')

module.exports = {
  id: 'model-context.token-budget',
  title: 'Model context limits and media payloads use the token-budget policy',
  tags: ['context', 'models', 'media'],
  changedFilePatterns: [
    /^electron\/modules\/model-context-policy\.js$/i,
    /^electron\/modules\/chat\/tool-result-summarizer\.js$/i
  ],

  async run(ctx) {
    const policy = require(path.join(ctx.root, 'electron/modules/model-context-policy'))
    const summarizer = require(path.join(ctx.root, 'electron/modules/chat/tool-result-summarizer'))

    ctx.assert.equal(policy.resolveModelContextLimit('GPT-5.6 Sol'), 500000)
    ctx.assert.equal(policy.resolveModelContextLimit('gpt-5.6-terra'), 500000)
    ctx.assert.equal(policy.resolveModelContextLimit('GPT-5.6 Luna'), 500000)
    ctx.assert.equal(policy.resolveModelContextLimit('GPT-5.5'), 1000000)
    ctx.assert.equal(policy.resolveModelContextLimit('Claude Opus 4.8'), 1000000)
    ctx.assert.equal(policy.resolveModelContextLimit('Grok 4 Fast'), 2000000)
    ctx.assert.equal(policy.resolveModelContextLimit('unknown-model'), 128000)

    const terra = policy.buildContextBudget('gpt-5.6-terra')
    ctx.assert.equal(terra.maxContextTokens, 500000)
    ctx.assert.ok(terra.inputBudgetTokens < terra.hardInputTokens)
    ctx.assert.ok(terra.hardInputTokens < terra.maxContextTokens)

    const base64 = `data:image/png;base64,${'A'.repeat(500000)}`
    const image = summarizer.summarizeToolResultForModel('generate_image', {
      success: true,
      path: 'assets/generated.png',
      width: 1024,
      height: 1024,
      thumbnailDataUrl: base64
    })
    const serialized = JSON.stringify(image)
    ctx.assert.ok(!serialized.includes('base64,'), 'generated image Base64 must never be returned to the model')
    ctx.assert.equal(image.path, 'assets/generated.png', 'the durable image path should remain')

    const inspected = summarizer.summarizeToolResultForModel('inspect_image', {
      success: true,
      path: 'assets/generated.png',
      summary: '画面分析结论',
      thumbnailDataUrl: base64
    })
    ctx.assert.ok(!JSON.stringify(inspected).includes('base64,'), 'vision thumbnails must not leak into later requests')
    ctx.assert.equal(inspected.summary, '画面分析结论')
  }
}
