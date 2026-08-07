const fs = require('fs')
const path = require('path')

module.exports = {
  id: 'image-generation.transport-contract',
  title: 'Image generation uses compatible synchronous transport and bounded waits',
  tags: ['media', 'image', 'transport', 'timeout'],
  paths: ['electron/modules/tool-handlers/image-gen.js'],
  async run(ctx) {
    const modulePath = path.join(ctx.root, 'electron/modules/tool-handlers/image-gen.js')
    const source = fs.readFileSync(modulePath, 'utf8')
    const imageGen = require(modulePath)

    ctx.assert.equal(
      imageGen.buildImageGenerationEndpoint('https://api.example.com/V1'),
      'https://api.example.com/v1/images/generations',
      'uppercase API version must be normalized before endpoint routing'
    )
    ctx.assert.equal(
      imageGen.buildImageGenerationEndpoint('https://api.example.com/V1/images/generations'),
      'https://api.example.com/v1/images/generations',
      'a full uppercase image endpoint must also be normalized'
    )

    const jsonResult = await imageGen.readImageGenerationResponse(new Response(JSON.stringify({
      data: [{ b64_json: 'aGVsbG8=' }]
    }), { headers: { 'content-type': 'application/json' } }))
    ctx.assert.equal(jsonResult.base64, 'aGVsbG8=', 'JSON image data must remain readable')

    let htmlError = null
    try {
      await imageGen.readImageGenerationResponse(new Response('<!doctype html><title>wrong route</title>', {
        headers: { 'content-type': 'text/html; charset=utf-8' }
      }))
    } catch (error) {
      htmlError = error
    }
    ctx.assert.ok(htmlError, 'HTML success responses must be rejected')
    ctx.assert.match(htmlError.message, /instead of JSON/i, 'HTML error must explain the protocol mismatch')

    ctx.assert.ok(source.includes('stream: args.stream === true'), 'image generation must be synchronous unless streaming is explicitly requested')
    ctx.assert.ok(!source.includes('stream: args.stream !== false'), 'the old default-stream behavior must not return')
    ctx.assert.ok(source.includes('AbortSignal.timeout(timeoutMs)'), 'the whole image request must have a bounded timeout')
    ctx.assert.ok(source.includes("status: 'upstream_error'"), 'HTTP 502 must be classified as an upstream error')
    ctx.assert.ok(source.includes("status: 'timeout'"), 'timeout must finish with a terminal tool result')
  }
}
