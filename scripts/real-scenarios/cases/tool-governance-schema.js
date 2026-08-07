const path = require('path')

module.exports = {
  id: 'tool-governance.schema',
  title: 'Model-visible tools use current unified diagnostic and navigation entry points',
  tags: ['tools', 'tool-governance', 'schema'],
  changedFilePatterns: [
    /^electron\/modules\/schemas\//i,
    /^electron\/modules\/tool-registry\.js$/i,
    /^electron\/modules\/tool-self-check\.js$/i,
    /^electron\/modules\/system-prompt-builder\.js$/i
  ],

  async run(ctx) {
    const schemas = require(path.join(ctx.root, 'electron/modules/schemas'))
    const registry = require(path.join(ctx.root, 'electron/modules/tool-registry'))
    const allNames = new Set(schemas.TOOLS_SCHEMA.map(tool => tool.function?.name).filter(Boolean))
    const visibleNames = new Set(schemas.MODEL_TOOLS_SCHEMA.map(tool => tool.function?.name).filter(Boolean))

    const requiredVisible = [
      'shell_run',
      'file_search',
      'code_inspect',
      'code_verify',
      'project_history',
      'image_analyze',
      'dev_workflow',
      'runtime_verify',
      'tool_self_check'
    ]
    for (const name of requiredVisible) {
      ctx.assert.ok(visibleNames.has(name), `${name} should be visible to the model`)
    }

    const hiddenLegacy = [
      'browser_search',
      'browser_fetch',
      'browser_open',
      'list_runtime_targets',
      'capture_screenshot',
      'inspect_runtime_errors',
      'discover_code',
      'search_project',
      'grep_code',
      'find_references',
      'run_command',
      'terminal_run',
      'terminal_status',
      'terminal_stop',
      'glob_files',
      'locate_code',
      'trace_call_chain',
      'check_project_syntax',
      'post_change_verify',
      'inspect_image',
      'view_image'
    ]
    for (const name of hiddenLegacy) {
      ctx.assert.ok(allNames.has(name), `${name} should remain in the backend schema for compatibility`)
      ctx.assert.equal(visibleNames.has(name), false, `${name} should be hidden from the model tool list`)
    }
    for (const name of ['verify_runtime_smoke', 'ui_smoke_check', 'ui_interaction_check', 'query_code_map']) {
      ctx.assert.equal(allNames.has(name), false, `${name} must be removed instead of retained as runtime compatibility routing`)
    }

    const validation = registry.validateToolRegistry()
    ctx.assert.equal(validation.success, true, validation.errors.join('\n') || 'tool registry should be valid')
    ctx.assert.deepEqual(validation.modelVisibleWithoutExecutable, [], 'every model-visible tool should have an executable handler')

    const runtimeTool = schemas.MODEL_TOOLS_SCHEMA.find(tool => tool.function?.name === 'runtime_verify')
    const imageAnalyzeTool = schemas.MODEL_TOOLS_SCHEMA.find(tool => tool.function?.name === 'image_analyze')
    const selfCheckTool = schemas.MODEL_TOOLS_SCHEMA.find(tool => tool.function?.name === 'tool_self_check')
    const codeInspectTool = schemas.MODEL_TOOLS_SCHEMA.find(tool => tool.function?.name === 'code_inspect')
    ctx.assert.ok(/点击无响应/.test(runtimeTool?.function?.description || ''), 'runtime_verify should advertise UI failure triggers')
    const runtimeProperties = runtimeTool?.function?.parameters?.properties || {}
    ctx.assert.equal(Object.hasOwn(runtimeProperties, 'action'), false, 'runtime_verify must not expose action routing')
    ctx.assert.equal(Object.hasOwn(runtimeProperties, 'level'), false, 'runtime_verify must not expose implementation levels')
    ctx.assert.equal(Object.hasOwn(imageAnalyzeTool?.function?.parameters?.properties || {}, 'action'), false, 'image_analyze must not require a fixed no-op action')
    ctx.assert.deepEqual(imageAnalyzeTool?.function?.parameters?.required || [], ['path'], 'image_analyze should require only the image path')
    const { dispatchComposite } = require(path.join(ctx.root, 'electron/modules/tool-handlers/composite-tools'))
    let dispatched = null
    const imageResult = await dispatchComposite('image_analyze', { path: 'sample.png', question: 'inspect' }, {
      dispatch: async (name, args) => {
        dispatched = { name, args }
        return { success: true }
      }
    })
    ctx.assert.equal(imageResult.success, true, 'image_analyze should dispatch without an action argument')
    ctx.assert.equal(dispatched?.name, 'inspect_image', 'image_analyze should use the single current image inspection handler')
    ctx.assert.ok(/工具突然缺失/.test(selfCheckTool?.function?.description || ''), 'tool_self_check should advertise tool-system failure triggers')
    ctx.assert.ok(/调用链/.test(codeInspectTool?.function?.description || ''), 'code_inspect should advertise its current call-chain capability')
    const codeInspectActions = codeInspectTool?.function?.parameters?.properties?.action?.enum || []
    ctx.assert.ok(codeInspectActions.includes('grep'), 'code_inspect must expose action=grep for Codex-style content search')
    ctx.assert.ok(codeInspectActions.includes('find_references'), 'code_inspect must expose action=find_references')
    const { getCompositeRoute } = require(path.join(ctx.root, 'electron/modules/composite-tool-contracts'))
    ctx.assert.equal(
      getCompositeRoute('code_inspect', { action: 'grep' })?.tool,
      'grep_code',
      'code_inspect action=grep should route to grep_code'
    )
    ctx.assert.equal(
      getCompositeRoute('code_inspect', { action: 'find_references' })?.tool,
      'find_references',
      'code_inspect action=find_references should route to find_references'
    )
  }
}
