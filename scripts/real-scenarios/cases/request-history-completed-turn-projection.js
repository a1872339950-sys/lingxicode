const fs = require('fs')
const path = require('path')

module.exports = {
  id: 'request-history.completed-turn-projection',
  title: 'Completed turns hide tool internals while interrupted turns keep resumable state',
  tags: ['ai-chat', 'history', 'context', 'performance'],
  changedFilePatterns: [
    /^electron\/modules\/ai-chat\.js$/i,
    /^electron\/modules\/request-history-window\.js$/i,
    /^electron\/tools\/context-builder\.js$/i
  ],

  async run(ctx) {
    const windowing = require(path.join(ctx.root, 'electron/modules/request-history-window'))
    const history = [
      { role: 'system', content: 'older turns summary' },
      { role: 'user', content: 'finish the implementation' },
      {
        role: 'assistant',
        content: null,
        reasoning_content: 'inspect before editing',
        tool_calls: [{ id: 'done-call', type: 'function', function: { name: 'file_read', arguments: '{}' } }]
      },
      { role: 'tool', tool_call_id: 'done-call', content: '{"success":true}' },
      { role: 'assistant', content: 'Implemented and verified.', reasoning_content: 'private final reasoning', modelName: 'model-a', modelId: 'model-a' },
      { role: 'user', content: 'continue the interrupted diagnosis' },
      {
        role: 'assistant',
        content: null,
        reasoning_content: 'must remain for resumption',
        tool_calls: [{ id: 'open-call', type: 'function', function: { name: 'shell_run', arguments: '{}' } }]
      },
      { role: 'tool', tool_call_id: 'open-call', content: '{"success":false,"error":"timeout"}' },
      { role: 'assistant', content: '[interrupted]', interrupted: true, modelName: 'model-a', modelId: 'model-a' },
      { role: 'user', content: 'current request' }
    ]

    const result = windowing.projectCompletedTurnsForModel(history)
    ctx.assert.equal(result.collapsedTurns, 1, 'only the completed turn should collapse')
    ctx.assert.equal(result.removedMessages, 2, 'completed assistant tool call and tool result should be removed')
    ctx.assert.equal(result.removedToolMessages, 1, 'completed tool result should be counted as removed')
    ctx.assert.equal(
      result.removedReasoningChars,
      'inspect before editing'.length + 'private final reasoning'.length,
      'all completed-turn reasoning should be removed from the request projection'
    )

    const completedUserIndex = result.history.findIndex(message => message.content === 'finish the implementation')
    ctx.assert.equal(
      result.history[completedUserIndex + 1]?.content,
      'Implemented and verified.',
      'completed final reply should remain adjacent to its user request'
    )
    ctx.assert.ok(
      !Object.prototype.hasOwnProperty.call(result.history[completedUserIndex + 1], 'reasoning_content'),
      'completed final reply must not replay private reasoning'
    )
    ctx.assert.ok(
      !result.history.some(message =>
        message?.tool_call_id === 'done-call' ||
        message?.tool_calls?.some(call => call.id === 'done-call')
      ),
      'completed tool call pairs should be removed atomically'
    )

    const interruptedUserIndex = result.history.findIndex(message => message.content === 'continue the interrupted diagnosis')
    const interruptedSlice = result.history.slice(interruptedUserIndex, interruptedUserIndex + 4)
    ctx.assert.equal(interruptedSlice[1]?.tool_calls?.[0]?.id, 'open-call', 'interrupted assistant tool call should remain')
    ctx.assert.equal(interruptedSlice[2]?.tool_call_id, 'open-call', 'interrupted tool result should remain paired')
    ctx.assert.equal(interruptedSlice[1]?.reasoning_content, 'must remain for resumption', 'interrupted reasoning should remain resumable')
    ctx.assert.equal(interruptedSlice[3]?.interrupted, true, 'interruption marker should remain')
    ctx.assert.equal(result.history.at(-1)?.content, 'current request', 'current unfinished turn should remain unchanged')
    ctx.assert.equal(history[2].reasoning_content, 'inspect before editing', 'request projection must not mutate persisted reasoning')
    ctx.assert.equal(history[3].tool_call_id, 'done-call', 'request projection must not mutate persisted tool history')

    const completedWithInterject = windowing.projectCompletedTurnsForModel([
      { role: 'user', content: 'initial request' },
      { role: 'assistant', content: null, reasoning_content: 'before injection', tool_calls: [{ id: 'before-inject', type: 'function', function: { name: 'file_read', arguments: '{}' } }] },
      { role: 'tool', tool_call_id: 'before-inject', content: '{"success":true}' },
      { role: 'user', content: 'additional instruction', interject: true },
      { role: 'assistant', content: null, reasoning_content: 'after injection', tool_calls: [{ id: 'after-inject', type: 'function', function: { name: 'file_write', arguments: '{}' } }] },
      { role: 'tool', tool_call_id: 'after-inject', content: '{"success":true}' },
      { role: 'assistant', content: 'finished after injection', modelName: 'model-a' }
    ])
    ctx.assert.deepEqual(
      completedWithInterject.history.map(message => [message.role, message.content]),
      [
        ['user', 'initial request'],
        ['user', 'additional instruction'],
        ['assistant', 'finished after injection']
      ],
      'an injected user message should remain part of its completed turn while both surrounding tool chains are removed'
    )

    const identityA = windowing.buildModelCacheIdentity({
      provider: 'provider-a',
      apiEndpoint: 'https://example.test/v1/chat/completions',
      apiFormat: 'openai',
      modelId: 'model-a'
    })
    const identityB = windowing.buildModelCacheIdentity({
      provider: 'provider-a',
      apiEndpoint: 'https://example.test/v1/chat/completions',
      apiFormat: 'openai',
      modelId: 'model-b'
    })
    const identityHistory = history.map(message => (
      message?.role === 'assistant' && message.modelId === 'model-a'
        ? { ...message, modelCacheIdentity: identityA }
        : message
    ))
    const sameModel = windowing.detectModelTransition(identityHistory, identityHistory.length - 1, {
      identity: identityA,
      aliases: ['model-a']
    })
    const switchedModel = windowing.detectModelTransition(identityHistory, identityHistory.length - 1, {
      identity: identityB,
      aliases: ['model-b']
    })
    ctx.assert.equal(sameModel.switched, false, 'the same provider/endpoint/format/model identity should keep the cache-stable history')
    ctx.assert.equal(switchedModel.switched, true, 'a different actual model identity should trigger completed-turn projection')

    const modelScopedHistory = [
      { role: 'user', content: 'model A request' },
      { role: 'assistant', content: null, reasoning_content: 'A reasoning', modelId: 'model-a', modelCacheIdentity: identityA, tool_calls: [{ id: 'a-call', type: 'function', function: { name: 'file_read', arguments: '{}' } }] },
      { role: 'tool', tool_call_id: 'a-call', content: '{"success":true}' },
      { role: 'assistant', content: 'model A final', modelId: 'model-a', modelCacheIdentity: identityA },
      { role: 'user', content: 'model B first request' },
      { role: 'assistant', content: null, reasoning_content: 'B reasoning', modelId: 'model-b', modelCacheIdentity: identityB, tool_calls: [{ id: 'b-call', type: 'function', function: { name: 'file_write', arguments: '{}' } }] },
      { role: 'tool', tool_call_id: 'b-call', content: '{"success":true}' },
      { role: 'assistant', content: 'model B final', modelId: 'model-b', modelCacheIdentity: identityB },
      { role: 'user', content: 'model B second request' }
    ]
    const modelBView = windowing.projectCompletedTurnsForModel(modelScopedHistory, {
      collapseAll: false,
      currentIdentity: identityB,
      currentAliases: ['model-b']
    })
    ctx.assert.ok(
      !modelBView.history.some(message => message?.tool_call_id === 'a-call' || message?.tool_calls?.some(call => call.id === 'a-call')),
      'a subsequent model B request must not resurrect completed model A internals'
    )
    ctx.assert.ok(
      modelBView.history.some(message => message?.tool_call_id === 'b-call') &&
        modelBView.history.some(message => message?.tool_calls?.some(call => call.id === 'b-call')),
      'model B should keep its own completed tool prefix for same-model cache reuse'
    )
    ctx.assert.ok(
      modelBView.history.some(message => message.reasoning_content === 'B reasoning'),
      'model B should keep its own reasoning prefix while continuing with the same model'
    )

    const { buildContextPayload } = require(path.join(ctx.root, 'electron/tools/context-builder'))
    const exactToolResult = JSON.stringify({ success: true, output: 'x'.repeat(1800) })
    const exactContext = buildContextPayload({
      contextManager: {
        compressHistory: list => list.map(message => message.role === 'tool' ? { ...message, content: 'compressed-result' } : { ...message }),
        estimateTokens: value => Math.ceil(String(value || '').length / 4)
      },
      systemPrompt: 'stable system',
      history: [
        { role: 'user', content: 'same model request' },
        { role: 'assistant', content: null, tool_calls: [{ id: 'exact-call', type: 'function', function: { name: 'shell_run', arguments: '{}' } }] },
        { role: 'tool', tool_call_id: 'exact-call', content: exactToolResult }
      ],
      policy: {
        maxContextTokens: 10000,
        inputBudgetTokens: 8000,
        preserveCachePrefix: true,
        includeBehaviorSummary: false,
        includeDynamicCompressedHistory: false
      }
    })
    ctx.assert.equal(
      exactContext.messages.find(message => message.role === 'tool')?.content,
      exactToolResult,
      'same-model context building should keep the exact prior tool result instead of rewriting the cached prefix'
    )
    ctx.assert.equal(exactContext.policy.preserveCachePrefix, true, 'the exact-prefix path should remain active while within budget')

    const switchWindow = windowing.buildModelSwitchHistory(identityHistory, identityHistory.length - 1, { tokenBudget: 100000 })
    ctx.assert.ok(
      !switchWindow.history.some(message => message?.tool_call_id === 'done-call' || message?.tool_calls?.some(call => call.id === 'done-call')),
      'model-switch request windows should remove completed tool pairs without changing persisted history'
    )
    ctx.assert.equal(
      switchWindow.history.find(message => message.reasoning_content === 'must remain for resumption')?.reasoning_content,
      'must remain for resumption',
      'unfinished turns must keep their reasoning and tool chain even during model handoff'
    )

    const aiChatSource = fs.readFileSync(path.join(ctx.root, 'electron/modules/ai-chat.js'), 'utf8')
    ctx.assert.ok(
      aiChatSource.includes('const modelTransition = requestHistoryWindow.detectModelTransition(') &&
        aiChatSource.includes('? requestHistoryWindow.buildModelSwitchHistory(instance.messagesHistory, currentHistoryIndex, historyWindowOptions)') &&
        aiChatSource.includes(': requestHistoryWindow.buildCompressionEpochHistory(instance.messagesHistory, currentHistoryIndex, historyWindowOptions)'),
      'AI request assembly should project completed turns only when the actual model cache identity changes'
    )
    ctx.assert.ok(
      aiChatSource.includes('const assistantModelMetadata = { modelName, modelId, modelCacheIdentity }') &&
        aiChatSource.includes('...assistantModelMetadata'),
      'assistant history entries should persist the stable model identity needed by the next handoff'
    )
    const tailGuidanceIndex = aiChatSource.indexOf('appendGuidanceToLatestUserMessage(requestHistory, contextTailGuidance)')
    const contextBuildIndex = aiChatSource.indexOf('const contextPayload = buildContextPayload({')
    ctx.assert.ok(tailGuidanceIndex >= 0, 'dynamic runtime guidance should be appended to the latest user message')
    ctx.assert.ok(contextBuildIndex > tailGuidanceIndex, 'tail guidance must be attached before model context is built')
    ctx.assert.ok(
      aiChatSource.includes('const contextExtraSystemMessages = []'),
      'per-turn runtime guidance must not invalidate the stable system prompt prefix'
    )
    ctx.assert.ok(
      aiChatSource.includes("promptCacheLayout: 'stable-system-tail-runtime'"),
      'cache telemetry should identify the stable-prefix layout'
    )
  }
}
