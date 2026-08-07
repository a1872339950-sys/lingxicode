const path = require('path')

module.exports = {
  id: 'agnes.model-adapter',
  title: 'Agnes OpenAI-compatible models use Agnes request fields',
  tags: ['model-request', 'provider-compatibility'],
  changedFilePatterns: [
    /^electron\/modules\/model-api-adapter\.js$/i,
    /^electron\/modules\/ai-chat\.js$/i,
    /^electron\/modules\/agent-sub-runner\.js$/i
  ],

  async run(ctx) {
    const {
      buildApiEndpoint,
      buildModelRequestBody,
      formatModelTransportError,
      getApiFormat,
      isAgnesModel
    } = require(path.join(ctx.root, 'electron/modules/model-api-adapter'))

    const exactConfig = {
      apiUrl: 'https://apihub.agnes-ai.com/v1/chat/completions/',
      modelId: 'agnes-2.0-flash',
      reasoning_effort: 'high'
    }
    const endpoint = buildApiEndpoint(exactConfig)
    ctx.assert.equal(endpoint, 'https://apihub.agnes-ai.com/v1/chat/completions', 'Agnes exact chat endpoint should not be duplicated when it has a trailing slash')
    ctx.assert.equal(getApiFormat(exactConfig, endpoint), 'openai', 'Agnes chat endpoint should stay OpenAI chat compatible')
    ctx.assert.equal(isAgnesModel(exactConfig, 'agnes-2.0-flash'), true, 'Agnes should be detected from URL or model name')

    const body = buildModelRequestBody(exactConfig, 'agnes-2.0-flash', [
      { role: 'system', content: 'stable rules' },
      { role: 'user', content: 'hello' }
    ], {
      stream: true,
      endpoint,
      includeTools: true,
      projectId: 'project-a'
    })
    ctx.assert.equal(body.model, 'agnes-2.0-flash', 'Agnes request should keep the configured model')
    ctx.assert.equal(body.stream, true, 'Agnes request should keep streaming enabled')
    ctx.assert.deepEqual(body.chat_template_kwargs, { enable_thinking: true }, 'Agnes thinking should use chat_template_kwargs.enable_thinking')
    ctx.assert.ok(!Object.prototype.hasOwnProperty.call(body, 'reasoning_effort'), 'Agnes request must not send OpenAI reasoning_effort')
    ctx.assert.ok(!Object.prototype.hasOwnProperty.call(body, 'thinking'), 'Agnes OpenAI-compatible request must not send Anthropic-style thinking')
    ctx.assert.ok(!Object.prototype.hasOwnProperty.call(body, 'stream_options'), 'Agnes request should not proactively send stream_options.include_usage')

    const v1Config = {
      apiUrl: 'https://apihub.agnes-ai.com/v1',
      modelName: 'agnes-2.0-flash',
      reasoningEffort: 'low'
    }
    ctx.assert.equal(buildApiEndpoint(v1Config), 'https://apihub.agnes-ai.com/v1/chat/completions', 'Agnes /v1 base URL should be expanded to chat completions')
    const lowBody = buildModelRequestBody(v1Config, 'agnes-2.0-flash', [
      { role: 'user', content: 'hello' }
    ], {
      stream: true,
      endpoint: buildApiEndpoint(v1Config)
    })
    ctx.assert.ok(!Object.prototype.hasOwnProperty.call(lowBody, 'chat_template_kwargs'), 'low reasoning should not force Agnes thinking on')
    ctx.assert.ok(!Object.prototype.hasOwnProperty.call(lowBody, 'reasoning_effort'), 'low reasoning should still avoid OpenAI reasoning_effort for Agnes')

    const transportMessage = formatModelTransportError(
      Object.assign(new Error('fetch failed'), { cause: Object.assign(new Error('ECONNRESET'), { code: 'ECONNRESET' }) }),
      endpoint,
      exactConfig
    )
    ctx.assert.ok(transportMessage.includes('apihub.agnes-ai.com'), 'transport errors should include the target host')
    ctx.assert.ok(transportMessage.includes('ECONNRESET'), 'transport errors should include the low-level cause code')
  }
}
