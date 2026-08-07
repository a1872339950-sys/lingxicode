const fs = require('fs')
const path = require('path')
const vm = require('vm')

module.exports = {
  id: 'cache-usage.hit-rate-bounds',
  title: 'Cache hit rate uses hit plus miss and never exceeds 100 percent',
  tags: ['prompt-cache', 'usage', 'ui', 'lingxi-cloud'],
  paths: [
    'electron/modules/prompt-cache-capabilities.js',
    'electron/modules/ai-chat.js',
    'frontend/scripts/features/cache-usage-renderer.js'
  ],
  async run(ctx) {
    const cacheModule = require(path.join(ctx.root, 'electron/modules/prompt-cache-capabilities'))
    const { normalizePromptCacheUsage, calculatePromptCacheRate } = cacheModule

    const lingxiUsage = normalizePromptCacheUsage({
      input_tokens: 31000,
      output_tokens: 1200,
      cached_tokens: 122000
    })
    ctx.assert.equal(lingxiUsage.cacheMissTokens, 31000, 'input smaller than cached must be treated as uncached input')
    ctx.assert.equal(lingxiUsage.inputTokens, 153000, 'canonical input must include cached and uncached tokens')
    ctx.assert.equal(Math.round(calculatePromptCacheRate(lingxiUsage)), 80, '122K hit plus 31K miss should be about 80%, not 394%')
    ctx.assert.ok(calculatePromptCacheRate(lingxiUsage) <= 100, 'backend cache rate must be bounded at 100%')

    const openAiUsage = normalizePromptCacheUsage({
      prompt_tokens: 100000,
      completion_tokens: 2000,
      prompt_tokens_details: { cached_tokens: 68000 }
    })
    ctx.assert.equal(openAiUsage.inputTokens, 100000, 'OpenAI total-input semantics must remain unchanged')
    ctx.assert.equal(openAiUsage.cacheMissTokens, 32000, 'OpenAI cache miss must be inferred from total input')
    ctx.assert.equal(Math.round(calculatePromptCacheRate(openAiUsage)), 68, 'OpenAI cache rate must retain its normal denominator')

    const rendererSource = fs.readFileSync(path.join(ctx.root, 'frontend/scripts/features/cache-usage-renderer.js'), 'utf8')
    const sandbox = { window: {}, console }
    vm.runInNewContext(rendererSource, sandbox, { filename: 'cache-usage-renderer.js' })
    const calculateUiRate = sandbox.window.CacheUsageRenderer.calculateCacheHitRate
    ctx.assert.equal(calculateUiRate(122000, 31000, 0, 394), 80, 'UI must repair invalid upstream rates using hit plus miss')
    ctx.assert.equal(calculateUiRate(100000, 100000, 0, 394), 100, 'UI must never display more than 100%')
    const formatStability = sandbox.window.CacheUsageRenderer.formatPromptStabilityText
    ctx.assert.equal(
      formatStability({ firstSeen: false, cachePrefix: { reusablePercent: 98.88 } }),
      '本地前缀 99%',
      'UI should distinguish local prefix stability from upstream cache hits'
    )
    ctx.assert.equal(
      formatStability({ firstSeen: true, cachePrefix: { reusablePercent: 0 } }),
      '',
      'first request should not pretend that a reusable prefix already exists'
    )
  }
}
