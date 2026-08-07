const path = require('path')

module.exports = {
  id: 'model-api-transport-retry',
  title: 'Model transport retries one pre-response socket close with a fresh connection',
  tags: ['model-api', 'transport', 'retry'],
  changedFilePatterns: [
    /^electron\/modules\/model-api-adapter\.js$/i,
    /^electron\/modules\/ai-chat\.js$/i
  ],

  async run(ctx) {
    const {
      isPreResponseSocketCloseError,
      retryPreResponseSocketClose,
      shouldAvoidPersistentModelConnection,
      shouldUseStickyPromptCacheConnection
    } = require(path.join(ctx.root, 'electron/modules/model-api-adapter'))

    const socketError = Object.assign(new Error('fetch failed'), {
      cause: Object.assign(new Error('other side closed'), { code: 'UND_ERR_SOCKET' })
    })
    ctx.assert.equal(isPreResponseSocketCloseError(socketError), true, 'closed Undici sockets should be retryable before response headers')
    ctx.assert.equal(isPreResponseSocketCloseError(new Error('wrapped', { cause: socketError })), true, 'wrapped socket errors should remain detectable by fallback logic')
    ctx.assert.equal(isPreResponseSocketCloseError(Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' })), true, 'connection resets before response headers should be retryable')
    ctx.assert.equal(isPreResponseSocketCloseError(Object.assign(new Error('timeout'), { cause: { code: 'UND_ERR_CONNECT_TIMEOUT' } })), false, 'connect timeouts must not be retried by this recovery path')
    ctx.assert.equal(isPreResponseSocketCloseError(Object.assign(new Error('rate limited'), { cause: { code: 'UND_ERR_SOCKET', message: 'different failure' } })), false, 'unrelated socket errors must not be retried')

    const calls = []
    let retryCount = 0
    const response = await retryPreResponseSocketClose(async options => {
      calls.push(options)
      if (options.attempt === 1) throw socketError
      return { ok: true }
    }, {
      delayMs: 0,
      onRetry: () => { retryCount += 1 }
    })
    ctx.assert.equal(response.ok, true, 'the second request should return the recovered response')
    ctx.assert.equal(retryCount, 1, 'a closed socket should trigger exactly one retry')
    ctx.assert.equal(calls.length, 2, 'the recovery path should issue only one additional request')
    ctx.assert.equal(calls[1].connectionClose, true, 'the recovery request must avoid reusing the failed connection')

    const threeAttemptCalls = []
    const recoveredOnThird = await retryPreResponseSocketClose(async options => {
      threeAttemptCalls.push(options)
      if (options.attempt < 3) throw socketError
      return { ok: true }
    }, { delayMs: 0, maxAttempts: 3, connectionClose: true })
    ctx.assert.equal(recoveredOnThird.ok, true, 'provider-specific recovery should allow a bounded third attempt')
    ctx.assert.equal(threeAttemptCalls.length, 3, 'bounded recovery should stop after the configured attempt count')
    ctx.assert.ok(threeAttemptCalls.every(call => call.connectionClose), 'unstable provider recovery should use fresh connections for every attempt')
    ctx.assert.equal(shouldAvoidPersistentModelConnection({}, 'https://api.apikey.fun/v1/responses'), true, 'api.apikey.fun should avoid pooled persistent sockets')
    ctx.assert.equal(shouldAvoidPersistentModelConnection({}, 'https://api.openai.com/v1/responses'), false, 'other providers should retain normal connection pooling')
    ctx.assert.equal(
      shouldUseStickyPromptCacheConnection({}, 'https://api.deepseek.com/chat/completions', 'deepseek-v4-pro'),
      true,
      'official DeepSeek requests should retain one cache-affine connection'
    )
    ctx.assert.equal(
      shouldUseStickyPromptCacheConnection({}, 'https://ark.cn-beijing.volces.com/api/coding/v3/chat/completions', 'deepseek-v4-pro'),
      true,
      'DeepSeek models behind a compatible gateway should retain one cache-affine connection'
    )
    ctx.assert.equal(
      shouldUseStickyPromptCacheConnection({ promptCacheStickyConnection: false }, 'https://api.deepseek.com/chat/completions', 'deepseek-v4-pro'),
      false,
      'sticky cache connections should remain explicitly configurable'
    )

    let httpCalls = 0
    await retryPreResponseSocketClose(async () => {
      httpCalls += 1
      throw Object.assign(new Error('bad request'), { cause: { code: 'UND_ERR_INVALID_ARG', message: 'bad request' } })
    }, { delayMs: 0 }).then(
      () => ctx.assert.ok(false, 'non-retryable errors should remain failures'),
      () => ctx.assert.equal(httpCalls, 1, 'non-retryable errors must not be retried')
    )
  }
}
