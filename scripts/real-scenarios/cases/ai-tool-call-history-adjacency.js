const path = require('path')

module.exports = {
  id: 'ai-tool-call-history-adjacency',
  title: 'Repair misordered tool results in interrupted AI history',
  tags: ['ai-chat', 'history', 'tools'],
  changedFilePatterns: [
    /^electron\/modules\/ai-chat\.js$/i
  ],

  async run(ctx) {
    const aiChat = require(path.join(ctx.root, 'electron/modules/ai-chat'))
    const repairToolCallAdjacency = aiChat.__test && aiChat.__test.repairToolCallAdjacency
    ctx.assert.ok(typeof repairToolCallAdjacency === 'function', 'repairToolCallAdjacency should be testable')

    const history = [
      { role: 'user', content: 'fix this' },
      {
        role: 'assistant',
        content: '',
        tool_calls: [
          { id: 'call_a', type: 'function', function: { name: 'read_file', arguments: '{}' } },
          { id: 'call_b', type: 'function', function: { name: 'check_syntax', arguments: '{}' } }
        ]
      },
      { role: 'assistant', content: 'interrupted before tool results were adjacent' },
      { role: 'tool', tool_call_id: 'call_b', content: '{"ok":"b"}' },
      { role: 'tool', tool_call_id: 'call_a', content: '{"ok":"a"}' }
    ]

    const changed = repairToolCallAdjacency(history, {
      error: 'interrupted',
      aborted: true
    })

    ctx.assert.equal(changed, true, 'misordered tool results should be repaired')
    ctx.assert.equal(history[1].role, 'assistant')
    ctx.assert.equal(history[2].role, 'tool')
    ctx.assert.equal(history[2].tool_call_id, 'call_a')
    ctx.assert.equal(history[3].role, 'tool')
    ctx.assert.equal(history[3].tool_call_id, 'call_b')
    ctx.assert.equal(history[4].role, 'assistant')

    const missingHistory = [
      { role: 'assistant', content: '', tool_calls: [{ id: 'missing_call', type: 'function', function: { name: 'x', arguments: '{}' } }] }
    ]
    repairToolCallAdjacency(missingHistory, { error: 'interrupted', aborted: true })
    ctx.assert.equal(missingHistory[1].role, 'tool')
    ctx.assert.equal(missingHistory[1].tool_call_id, 'missing_call')
    ctx.assert.ok(/"synthetic":true/.test(String(missingHistory[1].content || '')), 'synthetic tool result should be marked')
  }
}
