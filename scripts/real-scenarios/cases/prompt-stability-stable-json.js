const path = require('path')

module.exports = {
  id: 'prompt-stability.stable-json',
  title: 'Prompt request bodies use stable object key ordering without changing message order',
  tags: ['prompt-cache', 'prompt-stability', 'model-request'],
  changedFilePatterns: [
    /^electron\/modules\/prompt-stability\.js$/i,
    /^electron\/modules\/prompt-cache-capabilities\.js$/i,
    /^electron\/modules\/model-api-adapter\.js$/i,
    /^electron\/modules\/ai-chat\.js$/i,
    /^electron\/modules\/agent-sub-runner\.js$/i,
    /^electron\/modules\/ecosystem-navigation\.js$/i,
    /^electron\/modules\/worker-model\.js$/i
  ],

  async run(ctx) {
    const {
      stableJsonStringify,
      fingerprintPromptBody,
      buildCacheSequence,
      compareCacheSequence,
      observePromptStability,
      resetPromptStabilityReports
    } = require(path.join(ctx.root, 'electron/modules/prompt-stability'))
    const {
      buildApiEndpoint,
      buildModelRequestBody,
      extractModelResponseContent,
      parseModelStreamEvent,
      shouldAvoidPersistentModelConnection,
      shouldUseStickyPromptCacheConnection
    } = require(path.join(ctx.root, 'electron/modules/model-api-adapter'))
    const {
      buildPromptCacheKey,
      buildGrokConversationCacheKey,
      getPromptCacheCapability,
      normalizePromptCacheUsage,
      applyPromptCacheHeaderHints
    } = require(path.join(ctx.root, 'electron/modules/prompt-cache-capabilities'))
    const {
      getRuntimeContextPrompt,
      getSystemPrompt
    } = require(path.join(ctx.root, 'electron/modules/system-prompt-builder'))
    const first = {
      model: 'demo-model',
      messages: [
        { role: 'system', content: 'stable prefix' },
        { content: 'hello', role: 'user' }
      ],
      stream: true,
      tools: [
        { type: 'function', function: { name: 'read_file', parameters: { type: 'object', properties: { path: { type: 'string' } } } } }
      ]
    }
    const second = {
      tools: [
        { function: { parameters: { properties: { path: { type: 'string' } }, type: 'object' }, name: 'read_file' }, type: 'function' }
      ],
      stream: true,
      messages: [
        { content: 'stable prefix', role: 'system' },
        { role: 'user', content: 'hello' }
      ],
      model: 'demo-model'
    }

    const firstJson = stableJsonStringify(first)
    const secondJson = stableJsonStringify(second)
    ctx.assert.equal(firstJson, secondJson, 'semantically identical request bodies should serialize identically')

    const parsed = JSON.parse(firstJson)
    ctx.assert.equal(parsed.messages[0].role, 'system', 'stable serialization must preserve message array order')
    ctx.assert.equal(parsed.messages[1].role, 'user', 'stable serialization must preserve subsequent message order')
    ctx.assert.equal(fingerprintPromptBody(first).hash, fingerprintPromptBody(second).hash, 'fingerprint should match stable JSON')

    const anthropicConfig = { apiFormat: 'anthropic', apiUrl: 'https://api.anthropic.com/v1/messages' }
    const anthropicMessages = [
      { role: 'system', content: 'stable system' },
      { role: 'assistant', content: '', tool_calls: [{ type: 'function', function: { name: 'read_file', arguments: '{"path":"src/app.js"}' } }] }
    ]
    const anthropicFirst = buildModelRequestBody(anthropicConfig, 'claude-demo', anthropicMessages, {
      stream: true,
      includeTools: false,
      endpoint: anthropicConfig.apiUrl
    })
    const anthropicSecond = buildModelRequestBody(anthropicConfig, 'claude-demo', anthropicMessages, {
      stream: true,
      includeTools: false,
      endpoint: anthropicConfig.apiUrl
    })
    const firstToolId = anthropicFirst.messages[0]?.content?.find?.(part => part.type === 'tool_use')?.id
    const secondToolId = anthropicSecond.messages[0]?.content?.find?.(part => part.type === 'tool_use')?.id
    ctx.assert.ok(firstToolId && firstToolId.startsWith('toolu_'), 'anthropic fallback tool id should exist')
    ctx.assert.equal(firstToolId, secondToolId, 'anthropic fallback tool id should be stable across repeated builds')
    ctx.assert.equal(stableJsonStringify(anthropicFirst), stableJsonStringify(anthropicSecond), 'anthropic request body should remain byte-stable when tool ids are missing')

    const cacheableHistory = 'stable history '.repeat(120)
    const claudeCacheBody = buildModelRequestBody(anthropicConfig, 'claude-demo', [
      { role: 'system', content: 'stable system prompt '.repeat(80) },
      { role: 'user', content: cacheableHistory },
      { role: 'assistant', content: 'I will keep this response in the stable history.' },
      { role: 'user', content: 'new request' }
    ], {
      stream: true,
      includeTools: true,
      endpoint: anthropicConfig.apiUrl
    })
    const historyMarkers = claudeCacheBody.messages
      .flatMap(message => Array.isArray(message.content) ? message.content : [])
      .filter(block => block?.cache_control?.type === 'ephemeral')
    const systemMarkers = Array.isArray(claudeCacheBody.system)
      ? claudeCacheBody.system.filter(block => block?.cache_control?.type === 'ephemeral')
      : []
    const toolMarkers = (claudeCacheBody.tools || []).filter(tool => tool?.cache_control?.type === 'ephemeral')
    // Claude 允许最多 4 个 ephemeral 断点：system + 稳定长历史（可能含上一轮 user）均应被标记
    ctx.assert.ok(historyMarkers.length >= 1 && historyMarkers.length <= 2, 'Claude should mark stable long history text block(s) for cache reuse')
    ctx.assert.ok(
      historyMarkers.some(block => String(block.text || '').length >= 500),
      'at least one cache-marked history block should be the long stable prefix'
    )
    ctx.assert.ok(systemMarkers.length + toolMarkers.length + historyMarkers.length <= 4, 'Claude cache markers must stay within the provider limit')

    const apikeyFunConfig = { apiUrl: 'https://api.apikey.fun/v1/chat/completions', provider: 'api.apikey.fun' }
    const apikeyCapability = getPromptCacheCapability(apikeyFunConfig, apikeyFunConfig.apiUrl, 'gpt-5.5')
    ctx.assert.equal(apikeyCapability.bodyCacheKey, 'prompt_cache_key', 'api.apikey.fun should use a stable body cache key when the endpoint accepts it')
    const apikeyBody = buildModelRequestBody(apikeyFunConfig, 'gpt-5.5', [
      { role: 'system', content: 'stable base rules' },
      { role: 'user', content: 'hello' }
    ], {
      stream: true,
      endpoint: apikeyFunConfig.apiUrl,
      projectId: 'project-a',
      branchId: 'main'
    })
    ctx.assert.equal(
      apikeyBody.prompt_cache_key,
      buildPromptCacheKey({ projectId: 'project-a', branchId: 'main' }),
      'api.apikey.fun GPT-compatible request should carry the project-stable cache key'
    )
    const apikeyNoCacheBody = buildModelRequestBody(apikeyFunConfig, 'gpt-5.5', [
      { role: 'system', content: 'stable base rules' },
      { role: 'user', content: 'hello' }
    ], {
      stream: true,
      endpoint: apikeyFunConfig.apiUrl,
      promptCache: false,
      projectId: 'project-a',
      branchId: 'main'
    })
    ctx.assert.ok(!Object.prototype.hasOwnProperty.call(apikeyNoCacheBody, 'prompt_cache_key'), 'explicit promptCache false should remove api.apikey.fun body cache hints')
    const sessionAKey = buildPromptCacheKey({
      projectId: 'project-a',
      branchId: 'main',
      sessionId: 'chat-session-a',
      scope: 'session'
    })
    const sessionBKey = buildPromptCacheKey({
      projectId: 'project-a',
      branchId: 'main',
      sessionId: 'chat-session-b',
      scope: 'session'
    })
    ctx.assert.notEqual(sessionAKey, sessionBKey, 'same-project chat sessions must not share one prompt cache namespace')
    const sessionABody = buildModelRequestBody(apikeyFunConfig, 'gpt-5.5', [
      { role: 'system', content: 'stable base rules' },
      { role: 'user', content: 'hello' }
    ], {
      stream: true,
      endpoint: apikeyFunConfig.apiUrl,
      projectId: 'project-a',
      branchId: 'main',
      sessionId: 'chat-session-a'
    })
    const sessionBBody = buildModelRequestBody(apikeyFunConfig, 'gpt-5.5', [
      { role: 'system', content: 'stable base rules' },
      { role: 'user', content: 'hello' }
    ], {
      stream: true,
      endpoint: apikeyFunConfig.apiUrl,
      projectId: 'project-a',
      branchId: 'main',
      sessionId: 'chat-session-b'
    })
    ctx.assert.equal(sessionABody.prompt_cache_key, sessionAKey, 'request body should use the full session-scoped cache key')
    ctx.assert.equal(sessionBBody.prompt_cache_key, sessionBKey, 'second session request should use its own cache key')

    const deepSeekRelayConfig = {
      apiUrl: 'https://slb.apikey.fun/chat/completions',
      provider: 'api.apikey.fun'
    }
    ctx.assert.ok(
      shouldUseStickyPromptCacheConnection(deepSeekRelayConfig, deepSeekRelayConfig.apiUrl, 'deepseek-v4-flash'),
      'DeepSeek relay tool loops should keep one cache-affine connection by default'
    )
    ctx.assert.equal(
      shouldAvoidPersistentModelConnection(deepSeekRelayConfig, deepSeekRelayConfig.apiUrl, 'deepseek-v4-flash'),
      false,
      'DeepSeek cache affinity should override the relay-wide close-after-request fallback'
    )

    const grokConfig = { apiUrl: 'https://api.x.ai/v1/chat/completions', provider: 'xai' }
    const grokCapability = getPromptCacheCapability(grokConfig, grokConfig.apiUrl, 'grok-4')
    ctx.assert.equal(grokCapability.headerCacheKey, 'x-grok-conv-id', 'xAI should use the Grok conversation cache header')
    const grokScope = {
      projectId: 'project-a',
      branchId: 'main',
      sessionId: 'chat-session-a',
      grokCacheLayoutVersion: 'v2'
    }
    const grokHeaders = applyPromptCacheHeaderHints({}, grokConfig, grokConfig.apiUrl, 'grok-4', grokScope)
    ctx.assert.equal(
      grokHeaders['x-grok-conv-id'],
      buildGrokConversationCacheKey(grokScope, 'grok-4'),
      'Grok should use a stable per-branch, per-model conversation cache key'
    )
    const grokOtherModelHeaders = applyPromptCacheHeaderHints({}, grokConfig, grokConfig.apiUrl, 'grok-3', grokScope)
    ctx.assert.ok(grokHeaders['x-grok-conv-id'] !== grokOtherModelHeaders['x-grok-conv-id'], 'Grok cache scopes must not cross model versions')
    const grokOtherSessionHeaders = applyPromptCacheHeaderHints({}, grokConfig, grokConfig.apiUrl, 'grok-4', {
      ...grokScope,
      sessionId: 'chat-session-b'
    })
    ctx.assert.ok(
      grokHeaders['x-grok-conv-id'] !== grokOtherSessionHeaders['x-grok-conv-id'],
      'Grok cache scopes must not cross project chat sessions'
    )
    const grokBody = buildModelRequestBody(grokConfig, 'grok-4', [
      { role: 'system', content: 'stable system rules' },
      { role: 'user', content: 'first request' }
    ], {
      stream: true,
      includeTools: true,
      endpoint: grokConfig.apiUrl,
      ...grokScope
    })
    ctx.assert.ok(Object.keys(grokBody).indexOf('tools') < Object.keys(grokBody).indexOf('messages'), 'Grok should send stable tools before changing messages')
    const grokUiBody = buildModelRequestBody(grokConfig, 'grok-4', [
      { role: 'system', content: 'stable system rules' },
      { role: 'user', content: '检查前端 UI 截图并运行验证' }
    ], {
      stream: true,
      includeTools: true,
      endpoint: grokConfig.apiUrl,
      ...grokScope
    })
    ctx.assert.equal(
      stableJsonStringify(grokBody.tools),
      stableJsonStringify(grokUiBody.tools),
      'Grok should keep the complete tool schema byte-stable across task keywords'
    )

    const mimoConfig = { apiUrl: 'https://token-plan-cn.xiaomimimo.com/v1/chat/completions', provider: 'mimo' }
    const mimoCapability = getPromptCacheCapability(mimoConfig, mimoConfig.apiUrl, 'mimo-v2.5-pro')
    ctx.assert.equal(mimoCapability.id, 'mimo', 'Xiaomi MiMo should be recognized as a prompt-cache observable provider')
    ctx.assert.equal(mimoCapability.mode, 'auto', 'Xiaomi MiMo cache observation should not require synthetic request fields')
    const mimoUsage = normalizePromptCacheUsage({
      prompt_tokens: 100000,
      completion_tokens: 2000,
      prompt_tokens_details: {
        cached_tokens: 68000
      }
    })
    ctx.assert.equal(mimoUsage.cachedTokens, 68000, 'Xiaomi MiMo OpenAI-compatible cached_tokens should be read for hit-rate display')
    ctx.assert.equal(mimoUsage.inputTokens, 100000, 'Xiaomi MiMo prompt_tokens should be used as cache-rate denominator')

    const deepSeekConfig = {
      apiUrl: 'https://api.deepseek.com/chat/completions',
      provider: 'deepseek',
      reasoning_effort: 'high'
    }
    const deepSeekToolBody = buildModelRequestBody(deepSeekConfig, 'deepseek-v4-flash', [
      { role: 'user', content: 'inspect the project' },
      {
        role: 'assistant',
        content: null,
        reasoning_content: 'I need to inspect the project before editing.',
        tool_calls: [{
          id: 'call_deepseek_1',
          type: 'function',
          function: { name: 'locate_code', arguments: '{"query":"project"}' }
        }]
      },
      { role: 'tool', tool_call_id: 'call_deepseek_1', content: '{"success":true}' }
    ], {
      stream: true,
      includeTools: true,
      endpoint: deepSeekConfig.apiUrl
    })
    ctx.assert.equal(
      deepSeekToolBody.messages[1].reasoning_content,
      'I need to inspect the project before editing.',
      'DeepSeek thinking-mode tool calls must replay reasoning_content exactly as required by the official API'
    )
    const deepSeekPlainBody = buildModelRequestBody(deepSeekConfig, 'deepseek-v4-flash', [
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'hello', reasoning_content: 'private reasoning without tools' },
      { role: 'user', content: 'continue' }
    ], {
      stream: true,
      includeTools: false,
      endpoint: deepSeekConfig.apiUrl
    })
    ctx.assert.ok(
      !Object.prototype.hasOwnProperty.call(deepSeekPlainBody.messages[1], 'reasoning_content'),
      'DeepSeek reasoning without tool calls should remain omitted from later turns'
    )

    const apikeyClaudeConfig = { apiFormat: 'anthropic', apiUrl: 'https://api.apikey.fun/anthropic/v1/messages' }
    const longStableSystem = 'stable project rules '.repeat(80)
    const apikeyClaudeBody = buildModelRequestBody(apikeyClaudeConfig, 'claude-opus-4-8', [
      { role: 'system', content: longStableSystem },
      { role: 'user', content: 'hello' }
    ], {
      stream: true,
      includeTools: true,
      endpoint: apikeyClaudeConfig.apiUrl,
      projectId: 'project-a'
    })
    ctx.assert.ok(Array.isArray(apikeyClaudeBody.system), 'api.apikey.fun Claude Anthropic request should use cacheable system blocks')
    ctx.assert.deepEqual(apikeyClaudeBody.system[0].cache_control, { type: 'ephemeral' }, 'long stable Claude system prefix should be cache controlled')
    ctx.assert.equal(apikeyClaudeBody.system[0].text, longStableSystem.trim(), 'cache control must not rewrite the system text')
    ctx.assert.ok(apikeyClaudeBody.tools?.[apikeyClaudeBody.tools.length - 1]?.cache_control, 'Claude tool schema should mark a stable cache breakpoint')
    const apikeyClaudeNoCacheBody = buildModelRequestBody(apikeyClaudeConfig, 'claude-opus-4-8', [
      { role: 'system', content: longStableSystem },
      { role: 'user', content: 'hello' }
    ], {
      stream: true,
      includeTools: true,
      endpoint: apikeyClaudeConfig.apiUrl,
      promptCache: false,
      projectId: 'project-a'
    })
    ctx.assert.equal(typeof apikeyClaudeNoCacheBody.system, 'string', 'explicit promptCache false should keep Claude system content unannotated')
    ctx.assert.ok(!apikeyClaudeNoCacheBody.tools?.some(tool => tool.cache_control), 'explicit promptCache false should remove Claude tool cache breakpoints')

    const openAiReasoningConfig = {
      apiUrl: 'https://api.openai.com/v1',
      provider: 'openai',
      modelId: 'gpt-5.5',
      reasoning_effort: 'high'
    }
    const responsesEndpoint = buildApiEndpoint(openAiReasoningConfig)
    ctx.assert.equal(responsesEndpoint, 'https://api.openai.com/v1/responses', 'OpenAI GPT reasoning models should use the Responses API endpoint')
    const responsesBody = buildModelRequestBody(openAiReasoningConfig, 'gpt-5.5', [
      { role: 'system', content: 'stable coding rules' },
      { role: 'user', content: 'fix the bug' }
    ], {
      stream: true,
      includeTools: true,
      endpoint: responsesEndpoint,
      projectId: 'project-a'
    })
    ctx.assert.ok(Array.isArray(responsesBody.input), 'Responses API body should use input instead of chat messages')
    ctx.assert.ok(!Object.prototype.hasOwnProperty.call(responsesBody, 'messages'), 'Responses API body should not send chat messages')
    ctx.assert.deepEqual(responsesBody.reasoning, { effort: 'high' }, 'OpenAI GPT reasoning effort should be sent through reasoning.effort')
    ctx.assert.ok(responsesBody.tools?.every(tool => tool.type === 'function' && tool.name), 'Responses API tools should use flat function tool shape')
    const forcedChatBody = buildModelRequestBody(openAiReasoningConfig, 'gpt-5.5', [
      { role: 'system', content: 'stable coding rules' },
      { role: 'user', content: 'fix the bug' }
    ], {
      stream: true,
      endpoint: 'https://api.openai.com/v1/chat/completions',
      forceChatCompletions: true,
      disableReasoningOptions: true
    })
    ctx.assert.ok(Array.isArray(forcedChatBody.messages), 'Responses fallback should be able to build a chat-completions body')
    ctx.assert.ok(!forcedChatBody.reasoning && !forcedChatBody.reasoning_effort, 'fallback chat body should not keep Responses reasoning controls')
    const responsesStreamState = {}
    let responsesDelta = parseModelStreamEvent({
      type: 'response.output_text.delta',
      delta: 'done'
    }, responsesStreamState, 'openai-responses')
    ctx.assert.equal(responsesDelta.content, 'done', 'Responses output text deltas should map to visible content')
    responsesDelta = parseModelStreamEvent({
      type: 'response.output_item.added',
      output_index: 1,
      item: { type: 'function_call', id: 'fc_1', call_id: 'call_1', name: 'read_file' }
    }, responsesStreamState, 'openai-responses')
    ctx.assert.equal(responsesDelta.tool_calls[0].function.name, 'read_file', 'Responses function_call items should map to tool calls')
    responsesDelta = parseModelStreamEvent({
      type: 'response.function_call_arguments.delta',
      output_index: 1,
      delta: '{"path":"app.js"}'
    }, responsesStreamState, 'openai-responses')
    ctx.assert.equal(responsesDelta.tool_calls[0].function.arguments, '{"path":"app.js"}', 'Responses function arguments deltas should map to tool argument deltas')
    responsesDelta = parseModelStreamEvent({
      type: 'response.output_item.done',
      output_index: 1,
      item: { type: 'function_call', id: 'fc_1', call_id: 'call_1', name: 'read_file', arguments: '{"path":"app.js"}' }
    }, responsesStreamState, 'openai-responses')
    ctx.assert.equal(responsesDelta.tool_calls[0].function.arguments, '', 'Responses done events should not duplicate streamed function arguments')
    ctx.assert.equal(extractModelResponseContent({ output_text: 'ok' }, 'openai-responses'), 'ok', 'Responses non-stream output_text should be extracted')

    resetPromptStabilityReports()
    const firstReport = observePromptStability(first, { scopeKey: 'scenario:stable-json', label: 'first' })
    const secondReport = observePromptStability(second, { scopeKey: 'scenario:stable-json', label: 'second' })
    const changed = {
      ...second,
      messages: [
        ...second.messages,
        { role: 'user', content: 'new request' }
      ]
    }
    const thirdReport = observePromptStability(changed, { scopeKey: 'scenario:stable-json', label: 'third' })
    ctx.assert.equal(firstReport.firstSeen, true, 'first observation should be marked as firstSeen')
    ctx.assert.equal(secondReport.stable, true, 'same request body should be reported stable')
    ctx.assert.ok(thirdReport.changedSegments.some(segment => segment.name === 'messages.history'), 'message changes should be attributed to message history')
    ctx.assert.ok(thirdReport.cachePrefix.reusablePercent > 0, 'an appended message should preserve the prior logical cache prefix')
    ctx.assert.equal(thirdReport.cachePrefix.firstDifference?.previousName, '(end)', 'an appended message should first differ at the previous sequence end')

    resetPromptStabilityReports()
    const splitSystemFirst = {
      model: 'demo-model',
      messages: [
        { role: 'system', content: 'stable base rules' },
        { role: 'system', content: 'dynamic task A' },
        { role: 'user', content: 'hello' }
      ]
    }
    const splitSystemSecond = {
      model: 'demo-model',
      messages: [
        { role: 'system', content: 'stable base rules' },
        { role: 'system', content: 'dynamic task B' },
        { role: 'user', content: 'hello' }
      ]
    }
    observePromptStability(splitSystemFirst, { scopeKey: 'scenario:system-split' })
    const splitSystemReport = observePromptStability(splitSystemSecond, { scopeKey: 'scenario:system-split' })
    ctx.assert.ok(splitSystemReport.changedSegments.some(segment => segment.name === 'system.2'), 'system changes should be attributed to the changed system block')
    ctx.assert.ok(!splitSystemReport.changedSegments.some(segment => segment.name === 'system.1'), 'unchanged base system block should stay stable')
    ctx.assert.equal(splitSystemReport.cachePrefix.firstDifference?.currentName, 'message.2.system', 'dynamic system changes should identify the exact first changed message block')

    const stableTools = [{ type: 'function', function: { name: 'read_file', parameters: { type: 'object' } } }]
    const cacheFirst = buildCacheSequence({
      tools: stableTools,
      messages: [
        { role: 'system', content: 'stable base' },
        { role: 'user', content: 'first request' }
      ]
    })
    const cacheSecond = buildCacheSequence({
      tools: stableTools,
      messages: [
        { role: 'system', content: 'stable base' },
        { role: 'user', content: 'first request' },
        { role: 'assistant', content: 'first answer' },
        { role: 'user', content: 'second request' }
      ]
    })
    const appendComparison = compareCacheSequence(cacheSecond, cacheFirst)
    ctx.assert.equal(appendComparison.firstDifference?.previousName, '(end)', 'continuation should preserve all prior tool and message blocks')

    const changedTools = buildCacheSequence({
      tools: [...stableTools, { type: 'function', function: { name: 'inspect_image', parameters: { type: 'object' } } }],
      messages: [
        { role: 'system', content: 'stable base' },
        { role: 'user', content: 'second request' }
      ]
    })
    const toolComparison = compareCacheSequence(changedTools, cacheFirst)
    ctx.assert.equal(toolComparison.firstDifference?.currentName, 'tools', 'tool schema changes should be reported as the first cache-prefix break')

    const cachedProviderConfig = {
      apiUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
      provider: 'qwen'
    }
    const cachedPlainBody = buildModelRequestBody(cachedProviderConfig, 'qwen3-coder-plus', [
      { role: 'system', content: 'stable rules' },
      { role: 'user', content: '整理这段代码' }
    ], {
      stream: true,
      includeTools: true,
      endpoint: cachedProviderConfig.apiUrl,
      promptCache: true
    })
    const cachedUiBody = buildModelRequestBody(cachedProviderConfig, 'qwen3-coder-plus', [
      { role: 'system', content: 'stable rules' },
      { role: 'user', content: '检查前端 UI 截图并运行验证' }
    ], {
      stream: true,
      includeTools: true,
      endpoint: cachedProviderConfig.apiUrl,
      promptCache: true
    })
    ctx.assert.equal(
      stableJsonStringify(cachedPlainBody.tools),
      stableJsonStringify(cachedUiBody.tools),
      'cache-optimized providers should keep the complete tool schema stable across task keywords'
    )

    const adaptiveProviderConfig = {
      ...cachedProviderConfig,
      promptCacheToolSchemaStrategy: 'adaptive'
    }
    const adaptivePlainBody = buildModelRequestBody(adaptiveProviderConfig, 'qwen3-coder-plus', [
      { role: 'system', content: 'stable rules' },
      { role: 'user', content: '整理这段代码' }
    ], {
      stream: true,
      includeTools: true,
      endpoint: adaptiveProviderConfig.apiUrl,
      promptCache: true
    })
    ctx.assert.ok(
      adaptivePlainBody.tools.length < cachedPlainBody.tools.length,
      'an explicit adaptive tool strategy should retain the lower-cost trimmed schema option'
    )

    const stableFeatures = {
      blender: true,
      particle: true,
      ppt: true,
      any: true,
      cacheStableGate: true,
      mcp: { aidev: false, any: false, cacheStableGate: true },
      compactRuntimePrompt: false
    }
    const stableSystemFirst = getSystemPrompt('full', 'E:\\demo-a', false, 'zh-CN', stableFeatures)
    const stableSystemSecond = getSystemPrompt('full', 'E:\\demo-b', false, 'zh-CN', stableFeatures)
    ctx.assert.equal(stableSystemFirst, stableSystemSecond, 'stable system prompt must not embed the current project path')

    const bucketStart = getRuntimeContextPrompt('E:\\demo', new Date(2026, 6, 12, 14, 1))
    const bucketEnd = getRuntimeContextPrompt('E:\\demo', new Date(2026, 6, 12, 14, 29))
    const nextBucket = getRuntimeContextPrompt('E:\\demo', new Date(2026, 6, 12, 14, 30))
    ctx.assert.equal(bucketStart, bucketEnd, 'runtime time context should remain byte-stable within the same half-hour bucket')
    ctx.assert.ok(bucketStart !== nextBucket, 'runtime time context should rotate only at the next half-hour bucket')
  }
}
