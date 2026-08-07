const fs = require('fs')
const path = require('path')

module.exports = {
  id: 'ui-interaction-timeout-guard',
  title: 'Runtime interaction steps have bounded timeouts',
  tags: ['runtime', 'interaction', 'timeout', 'schema'],
  changedFilePatterns: [
    /^electron\/modules\/tool-handlers\/website-research\.js$/i,
    /^electron\/modules\/schemas\/screenshot-image\.js$/i
  ],

  async run(ctx) {
    const handlerPath = path.join(ctx.root, 'electron', 'modules', 'tool-handlers', 'website-research.js')
    const schemaPath = path.join(ctx.root, 'electron', 'modules', 'schemas', 'screenshot-image.js')
    const handler = fs.readFileSync(handlerPath, 'utf8')
    const schema = fs.readFileSync(schemaPath, 'utf8')

    ctx.assert.ok(handler.includes('UI_INTERACTION_TIMEOUT'), 'runtime_verify should return timeout errors instead of hanging')
    ctx.assert.ok(handler.includes('getUiInteractionTimeouts'), 'runtime_verify should centralize total/step timeout settings')
    ctx.assert.ok(handler.includes("stepRun('wait target ready'"), 'target-ready wait must be step-timeout guarded')
    ctx.assert.ok(handler.includes("stepRun('collect before state'"), 'executeJavaScript state collection must be step-timeout guarded')
    ctx.assert.ok(handler.includes('runtime_verify semantic interaction'), 'the single semantic interaction executor must have a total timeout guard')
    ctx.assert.ok(schema.includes('"timeout_ms"'), 'runtime_verify schema should expose timeout_ms')
    ctx.assert.ok(schema.includes('"step_timeout_ms"'), 'runtime_verify schema should expose step_timeout_ms')
  }
}
