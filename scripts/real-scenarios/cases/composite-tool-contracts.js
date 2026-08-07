const path = require('path')

const EXPECTED_ACTIONS = {
  file_read: { one: 'read_file', many: 'read_many_files' },
  file_manage: { create_directory: 'create_directory', copy: 'copy_file', move: 'move_file', delete: 'delete_file' },
  file_write_session: { start: 'create_file_session', append: 'append_file_chunk', finish: 'finish_file_session' },
  file_search: { directory: 'list_files', glob: 'glob_files' },
  code_verify: { file: 'check_syntax', project: 'check_project_syntax', changes: 'post_change_verify' },
  code_inspect: {
    grep: 'grep_code',
    locate: 'locate_code',
    find_in_file: 'find_in_file',
    navigate: 'code_navigate',
    find_references: 'find_references',
    trace_call_chain: 'trace_call_chain',
    git_diff: 'git_diff'
  },
  project_history: { recall: 'recall_history', ledger: 'read_task_ledger_entry', latest_change: 'get_latest_change_session', rollback_latest_change: 'rollback_latest_change_session', search_memos: 'search_ai_operation_memos', read_memo: 'read_ai_operation_memo' },
  skill_manage: { draft: 'create_skill_draft', install: 'install_skill_draft', list: 'list_skill_drafts' },
  desktop_app: { find: 'find_software', open: 'open_software' },
  image_analyze: { analyze: 'inspect_image' },
  mcp: { diagnose: 'mcp_aidev_workflow', list_tools: 'mcp_list_tools', call: 'mcp_call_tool' },
  media_process: { render_svg: 'render_svg_asset', extract_frames: 'extract_video_frames', upscale: 'upscale_media' }
}

function visibleToolNames(adapter, text) {
  return new Set(adapter.filterModelToolsForRequest(
    [{ role: 'user', content: text }],
    { adaptiveToolVisibility: true }
  ).map(tool => tool.function?.name).filter(Boolean))
}

module.exports = {
  id: 'composite-tool.contracts',
  title: 'Composite tools preserve routing, visibility, recovery, and result evidence contracts',
  tags: ['tools', 'composite', 'routing', 'evidence'],
  changedFilePatterns: [
    /^electron\/modules\/composite-tool-contracts\.js$/i,
    /^electron\/modules\/tool-handlers\/composite-tools\.js$/i,
    /^electron\/modules\/model-api-adapter\.js$/i,
    /^electron\/modules\/tool-failure-recovery\.js$/i,
    /^electron\/modules\/chat\/tool-result-summarizer\.js$/i
  ],

  async run(ctx) {
    const contracts = require(path.join(ctx.root, 'electron/modules/composite-tool-contracts'))
    const { dispatchComposite } = require(path.join(ctx.root, 'electron/modules/tool-handlers/composite-tools'))
    const adapter = require(path.join(ctx.root, 'electron/modules/model-api-adapter'))
    const { createToolFailureRecoveryTracker } = require(path.join(ctx.root, 'electron/modules/tool-failure-recovery'))
    const { summarizeToolResultForModel } = require(path.join(ctx.root, 'electron/modules/chat/tool-result-summarizer'))

    ctx.assert.deepEqual(contracts.getCompositeActionMap(), EXPECTED_ACTIONS, 'all public composite actions should route through the single contract source')
    const actionCount = Object.values(EXPECTED_ACTIONS).reduce((count, actions) => count + Object.keys(actions).length, 0)
    ctx.assert.equal(actionCount, 39, 'the routing contract should cover all current composite actions')
    ctx.assert.equal(contracts.getCompositeAction('image_analyze', { path: 'sample.png' }), 'analyze', 'image analysis should have one implicit default action')
    ctx.assert.equal(contracts.getCompositeRoute('desktop_app', { action: 'open' }).statelessKind, 'none', 'opening software should not create a workspace')
    ctx.assert.equal(contracts.getCompositeRoute('project_history', { action: 'recall' }).statelessKind, 'none', 'stored history access should not require a filesystem workspace')
    ctx.assert.equal(contracts.getCompositeRoute('mcp', { action: 'diagnose' }).statelessKind, 'none', 'MCP calls should manage their own project requirements')
    ctx.assert.equal(contracts.getCompositeRoute('skill_manage', { action: 'draft' }).statelessKind, 'none', 'global skill drafts should not create a workspace')
    ctx.assert.equal(contracts.getCompositeRoute('skill_manage', { action: 'draft', scope: 'project' }).statelessKind, 'mutation', 'project skill drafts should bind a workspace')
    ctx.assert.equal(contracts.getCompositeRoute('skill_manage', { action: 'list', scope: 'project' }).statelessKind, 'read', 'project skill listing should require an existing workspace')
    ctx.assert.equal(contracts.getCompositeRoute('media_process', { action: 'render_svg' }).statelessKind, 'mutation', 'media output should bind a production workspace')

    for (const [toolName, actions] of Object.entries(EXPECTED_ACTIONS)) {
      for (const [action, routedTool] of Object.entries(actions)) {
        let dispatched = null
        const args = {
          action,
          path: 'sample.txt',
          files: ['sample.txt'],
          session_id: 'session-1',
          source: 'source.txt',
          destination: 'destination.txt',
          query: 'sample',
          pattern: 'sample',
          symbol: 'sampleSymbol',
          entry_id: 'entry-1',
          memo_id: 'memo-1',
          name: 'sample_tool',
          output_path: 'output.svg',
          navigate_action: 'find_references'
        }
        const result = await dispatchComposite(toolName, args, {
          options: { toolTraceId: 'parent-trace' },
          async dispatch(name, routedArgs, toolOptions) {
            dispatched = { name, routedArgs, toolOptions }
            return { success: true, evidence: `${toolName}:${action}` }
          }
        })
        ctx.assert.equal(dispatched?.name, routedTool, `${toolName}.${action} should dispatch to ${routedTool}`)
        ctx.assert.equal(Object.hasOwn(dispatched?.routedArgs || {}, 'action'), toolName === 'code_inspect' && action === 'navigate', 'only code navigation should translate its nested action')
        ctx.assert.equal(result._tool_route?.requested_tool, toolName, 'result should retain the requested public tool')
        ctx.assert.equal(result._tool_route?.routed_tool, routedTool, 'result should retain the atomic routed tool')
        ctx.assert.equal(result._tool_route?.trace_id, 'parent-trace', 'result should retain the parent trace id')
        ctx.assert.ok(result._tool_route?.child_trace_id, 'result should include a child trace id')
        ctx.assert.equal(dispatched?.toolOptions?.parentToolTraceId, 'parent-trace', 'atomic dispatch should inherit the parent trace id')
        ctx.assert.equal(dispatched?.toolOptions?.toolTraceId, result._tool_route.child_trace_id, 'atomic dispatch and result should share the child trace id')
      }
    }

    const ordinary = visibleToolNames(adapter, 'Explain the current architecture.')
    for (const name of ['image_analyze', 'desktop_app', 'skill_manage', 'media_process', 'mcp']) {
      ctx.assert.equal(ordinary.has(name), false, `${name} should stay out of unrelated requests`)
    }
    ctx.assert.ok(visibleToolNames(adapter, 'Analyze this image screenshot.').has('image_analyze'), 'vision requests should expose image_analyze')
    ctx.assert.ok(visibleToolNames(adapter, 'Open software on this computer.').has('desktop_app'), 'software requests should expose desktop_app')
    ctx.assert.ok(visibleToolNames(adapter, 'Install a skill for this workflow.').has('skill_manage'), 'skill requests should expose skill_manage')
    ctx.assert.ok(visibleToolNames(adapter, 'Generate video assets.').has('media_process'), 'media requests should expose media_process')
    ctx.assert.ok(visibleToolNames(adapter, '@MCP diagnose this project.').has('mcp'), 'explicit MCP requests should expose the unified mcp tool')

    const recovery = createToolFailureRecoveryTracker()
    const failure = { success: false, error_type: 'missing_path', error: 'missing required path' }
    recovery.record('file_manage', failure)
    recovery.record('file_manage', failure)
    recovery.record('file_manage', failure)
    ctx.assert.equal(recovery.shouldBlock('file_manage'), true, 'file_manage should participate in existing write recovery')
    ctx.assert.equal(recovery.shouldBlock('file_write_session'), true, 'file_write_session should participate in existing write recovery')

    const largeContent = `HEAD_EVIDENCE\n${'middle evidence\n'.repeat(1200)}TAIL_EVIDENCE`
    const route = {
      requested_tool: 'file_read',
      action: 'one',
      routed_tool: 'read_file',
      trace_id: 'outer-trace',
      child_trace_id: 'inner-trace'
    }
    const summary = summarizeToolResultForModel('file_read', {
      success: true,
      path: 'large.txt',
      file_type: 'text',
      content: largeContent,
      _tool_route: route
    })
    ctx.assert.ok(summary.content.includes('HEAD_EVIDENCE'), 'large composite reads should preserve leading evidence')
    ctx.assert.ok(summary.content.includes('TAIL_EVIDENCE'), 'large composite reads should preserve trailing evidence')
    ctx.assert.ok(summary.content.length > 5000, 'large composite reads should use the atomic read evidence budget')
    ctx.assert.equal(summary.preview, undefined, 'large composite reads should not collapse to the generic preview')
    ctx.assert.deepEqual(summary._tool_route, route, 'summarization should preserve route provenance')
  }
}
