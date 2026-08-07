const path = require('path')

module.exports = {
  id: 'anthropic-prompt-cache.breakpoints',
  title: 'Anthropic/Claude prompt cache breakpoints stay within limit and keep stable prefix',
  tags: ['prompt-cache', 'anthropic', 'claude', 'model-request'],
  changedFilePatterns: [
    /^electron\/modules\/model-api-adapter\.js$/i
  ],

  async run(ctx) {
    const adapter = require(path.join(ctx.root, 'electron/modules/model-api-adapter'))
    const long = (label, n = 1100) => `${label}:${'x'.repeat(n)}`
    const modelConfig = {
      apiUrl: 'https://api.anthropic.com/v1/messages',
      provider: 'anthropic',
      modelName: 'claude-sonnet-5',
      modelId: 'claude-sonnet-5',
      claudePromptCacheOptimize: true
    }

    const messages = [
      { role: 'system', content: long('sys-a') },
      { role: 'system', content: long('sys-b') },
      { role: 'user', content: long('u1') },
      { role: 'assistant', content: long('a1') },
      { role: 'user', content: long('u2') },
      { role: 'assistant', content: long('a2-tool-prefix') },
      {
        role: 'user',
        content: [
          { type: 'text', text: 'short follow-up' }
        ]
      }
    ]

    const body = adapter.buildAnthropicRequestBody(modelConfig, 'claude-sonnet-5', messages, {
      includeTools: false,
      stream: false,
      promptCache: true
    })

    const refs = adapter.collectAnthropicCacheMarkerRefs(body)
    ctx.assert.ok(Array.isArray(body.system), 'system should stay as content blocks for cache_control')
    ctx.assert.ok(refs.length > 0, 'should place at least one cache breakpoint')
    ctx.assert.ok(
      refs.length <= adapter.ANTHROPIC_CACHE_BREAKPOINT_LIMIT,
      `markers must be <= ${adapter.ANTHROPIC_CACHE_BREAKPOINT_LIMIT}, got ${refs.length}`
    )

    // 人为制造超限断点，验证 prune 会裁到上限且保留 system 首断点
    const bloated = {
      system: [
        { type: 'text', text: long('s0'), cache_control: { type: 'ephemeral' } },
        { type: 'text', text: long('s1'), cache_control: { type: 'ephemeral' } }
      ],
      tools: [
        { name: 't1', description: 'd', input_schema: {}, cache_control: { type: 'ephemeral' } },
        { name: 't2', description: 'd', input_schema: {}, cache_control: { type: 'ephemeral' } }
      ],
      messages: [
        { role: 'user', content: [{ type: 'text', text: long('m0'), cache_control: { type: 'ephemeral' } }] },
        { role: 'assistant', content: [{ type: 'text', text: long('m1'), cache_control: { type: 'ephemeral' } }] },
        { role: 'user', content: [{ type: 'text', text: long('m2'), cache_control: { type: 'ephemeral' } }] }
      ]
    }
    adapter.pruneAnthropicCacheMarkers(bloated, 4)
    const pruned = adapter.collectAnthropicCacheMarkerRefs(bloated)
    ctx.assert.equal(pruned.length, 4, 'prune should keep exactly 4 markers')
    ctx.assert.equal(
      bloated.system[0].cache_control?.type,
      'ephemeral',
      'first system marker should be preserved for stable prefix'
    )
    ctx.assert.equal(
      bloated.messages[2].content[0].cache_control?.type,
      'ephemeral',
      'newest trailing marker should be preserved'
    )

    // 尾部断点：最后一条可缓存内容应被标记（或在 prune 后仍保留靠后的断点）
    const trailing = adapter.applyAnthropicTrailingCacheBreakpoint(
      [
        { role: 'user', content: [{ type: 'text', text: long('old') }] },
        { role: 'assistant', content: [{ type: 'text', text: 'ok' }] },
        { role: 'user', content: [{ type: 'text', text: 'continue' }] }
      ],
      { promptCache: true, optimizeCache: true }
    )
    ctx.assert.equal(
      trailing[2].content[0].cache_control?.type,
      'ephemeral',
      'trailing breakpoint should land on the last message block'
    )
  }
}
