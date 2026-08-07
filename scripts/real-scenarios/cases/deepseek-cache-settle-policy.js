const path = require('path')

module.exports = {
  id: 'deepseek-cache.settle-policy',
  title: 'DeepSeek tool continuations allow each newly extended prefix to settle',
  tags: ['prompt-cache', 'deepseek', 'model-request'],
  changedFilePatterns: [
    /^electron\/modules\/ai-chat\.js$/i,
    /^electron\/modules\/prompt-cache-capabilities\.js$/i
  ],

  async run(ctx) {
    const aiChat = require(path.join(ctx.root, 'electron/modules/ai-chat'))
    const { getPromptCacheCapability } = require(path.join(ctx.root, 'electron/modules/prompt-cache-capabilities'))
    const getTarget = aiChat.__test.getDeepSeekCacheSettleTargetMs
    const shouldBridgeBatch = aiChat.__test.shouldBridgeDeepSeekMultiToolBatch
    const buildBatchBridge = aiChat.__test.buildDeepSeekMultiToolCacheBridge

    ctx.assert.equal(getTarget({}, 99), 3000, 'a high previous hit must still wait for the newly appended prefix')
    ctx.assert.equal(getTarget({}, 77), 5000, 'a low previous hit should receive a longer soft settle window')
    ctx.assert.equal(getTarget({ deepSeekCacheSettleMs: 0 }, 20), 0, 'explicit zero should disable settle waiting')
    ctx.assert.equal(
      getTarget({ deepSeekCacheSettleMs: 1800, deepSeekLowHitCacheSettleMs: 3200 }, 89),
      3200,
      'custom low-hit settle time should be honored'
    )

    const gatewayCapability = getPromptCacheCapability(
      { modelName: 'deepseek-v4-pro', provider: 'lingxi' },
      'https://ark.cn-beijing.volces.com/api/coding/v3/chat/completions',
      'deepseek-v4-pro'
    )
    ctx.assert.equal(gatewayCapability.id, 'deepseek', 'DeepSeek behind the Lingxi gateway must use the DeepSeek cache policy')

    ctx.assert.equal(
      shouldBridgeBatch({}, 'https://api.deepseek.com/chat/completions', 'deepseek-v4-pro', [{ id: 'a' }, { id: 'b' }]),
      true,
      'DeepSeek multi-tool batches should use the cache-safe request bridge'
    )
    ctx.assert.equal(
      shouldBridgeBatch({}, 'https://api.deepseek.com/chat/completions', 'deepseek-v4-pro', [{ id: 'a' }]),
      false,
      'single DeepSeek tool calls should retain the native reasoning/tool replay path'
    )
    const bridge = buildBatchBridge([
      { tool_call_id: 'a', name: 'shell_run', arguments: { command: 'one' }, result: { success: true, stdout: 'one' } },
      { tool_call_id: 'b', name: 'shell_run', arguments: { command: 'two' }, result: { success: true, stdout: 'two' } }
    ])
    ctx.assert.equal(bridge.length, 2, 'cache-safe parallel results should become one assistant/user bridge pair')
    ctx.assert.ok(!bridge.some(message => Array.isArray(message.tool_calls)), 'cache bridge must not replay the multi-tool structure')
    ctx.assert.ok(bridge[1].content.includes('shell_run') && bridge[1].content.includes('one') && bridge[1].content.includes('two'), 'cache bridge must retain every parallel tool result')
    ctx.assert.ok(bridge.every(message => message.hidden === true && message._deepseekBridge === true), 'bridge messages must be UI-hidden but kept for model context')

    const historyWindow = require(path.join(ctx.root, 'electron/modules/request-history-window'))
    const sampleHistory = [
      { role: 'user', content: 'real user request' },
      bridge[0],
      bridge[1],
      { role: 'user', content: 'follow up' }
    ]
    ctx.assert.equal(historyWindow.isUserTurnMessage(bridge[1]), false, 'bridge user message must not count as a user turn')
    ctx.assert.equal(historyWindow.isVisibleMessage(bridge[1]), true, 'bridge message must stay in model context despite hidden')
    const epoch = historyWindow.buildCompressionEpochHistory(sampleHistory, sampleHistory.length - 1, { tokenBudget: 80000 })
    ctx.assert.ok(epoch.history.some(m => m._deepseekBridge), 'epoch history must retain bridge for DeepSeek cache')
    ctx.assert.ok(!epoch.history.some(m => m._deepseekBridge && !m.hidden && m.role === 'user' && String(m.content || '').includes('[Lingxi internal')), 'bridge content is model-only metadata')
  }
}
