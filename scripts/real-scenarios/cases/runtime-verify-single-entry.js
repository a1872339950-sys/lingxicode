const fs = require('fs')
const path = require('path')

module.exports = {
  id: 'runtime-verify-single-entry',
  title: 'Models see one adaptive runtime verification tool',
  tags: ['runtime', 'tools', 'schema'],
  changedFilePatterns: [
    /^electron\/modules\/schemas\/index\.js$/i,
    /^electron\/modules\/schemas\/screenshot-image\.js$/i,
    /^electron\/modules\/model-api-adapter\.js$/i,
    /^electron\/modules\/chat\/tool-result-summarizer\.js$/i,
    /^electron\/modules\/ai-chat\.js$/i
  ],

  async run(ctx) {
    const { MODEL_TOOLS_SCHEMA } = require(path.join(ctx.root, 'electron/modules/schemas'))
    const names = MODEL_TOOLS_SCHEMA.map(tool => tool.function?.name).filter(Boolean)
    const legacy = [
      'list_runtime_targets',
      'capture_screenshot',
      'verify_runtime_smoke',
      'ui_smoke_check',
      'ui_interaction_check',
      'inspect_runtime_errors'
    ]
    ctx.assert.ok(names.includes('runtime_verify'), 'runtime_verify should be model-visible')
    const runtimeTool = MODEL_TOOLS_SCHEMA.find(tool => tool.function?.name === 'runtime_verify')
    ctx.assert.ok(/点击无响应/.test(runtimeTool.function.description), 'runtime_verify should advertise the UI no-response routing trigger')
    ctx.assert.ok(/hiddenBy/.test(runtimeTool.function.description), 'runtime_verify should advertise deep visibility diagnostics')
    const runtimeProperties = runtimeTool.function.parameters?.properties || {}
    for (const legacyParameter of ['action', 'level', 'url', 'html_path', 'webContentsId', 'source_id', 'target', 'include_desktop', 'baseline_id']) {
      ctx.assert.equal(Object.hasOwn(runtimeProperties, legacyParameter), false, `runtime_verify must not expose legacy routing parameter ${legacyParameter}`)
    }
    ctx.assert.ok(runtimeProperties.interaction, 'runtime_verify should expose the single optional semantic interaction contract')
    for (const name of legacy) {
      ctx.assert.equal(names.includes(name), false, `${name} should be hidden from the model tool list`)
    }
    const { summarizeToolResultForModel } = require(path.join(ctx.root, 'electron/modules/chat/tool-result-summarizer'))
    const summarized = summarizeToolResultForModel('runtime_verify', {
      success: false,
      error: 'ui interaction check failed',
      error_type: 'runtime_target_blank_or_wrong',
      retry_policy: 'do_not_repeat_same_call_without_changing_target_precondition_or_locator',
      next_action: 'choose a bound runtime',
      diagnosis: {
        category: 'blank_or_wrong_runtime_target',
        current_page: { url: 'file:///empty/index.html', interactiveElementCount: 0 },
        nearby_candidates: []
      },
      filler: 'x'.repeat(20000)
    })
    ctx.assert.equal(summarized.diagnosis?.category, 'blank_or_wrong_runtime_target', 'large runtime results must preserve structured diagnosis for the model')
    ctx.assert.equal(summarized.retry_policy, 'do_not_repeat_same_call_without_changing_target_precondition_or_locator', 'large runtime results must preserve retry policy')
    ctx.assert.equal(summarized.filler, undefined, 'unbounded runtime payload fields should be dropped from the model summary')
    ctx.assert.ok(Buffer.byteLength(JSON.stringify(summarized)) < 12000, 'runtime model summary should stay within a bounded context budget')
    const aiChatSource = fs.readFileSync(path.join(ctx.root, 'electron/modules/ai-chat.js'), 'utf8')
    ctx.assert.ok(/if \(result\.next_action\) return String\(result\.next_action\)/.test(aiChatSource), 'generic tool failure guidance must preserve runtime_verify next_action')
  }
}
