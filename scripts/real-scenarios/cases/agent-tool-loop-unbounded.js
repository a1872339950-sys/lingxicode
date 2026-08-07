const fs = require('fs')
const path = require('path')

module.exports = {
  id: 'agent-tool-loop.unbounded',
  title: 'Agent tool loops do not stop at an artificial tool-call cap',
  tags: ['agent', 'tools', 'runtime'],
  changedFilePatterns: [
    /^electron\/modules\/ai-chat\.js$/i,
    /^electron\/modules\/agent-sub-runner\.js$/i
  ],

  async run(ctx) {
    const aiChat = fs.readFileSync(path.join(ctx.root, 'electron/modules/ai-chat.js'), 'utf8')
    const subRunner = fs.readFileSync(path.join(ctx.root, 'electron/modules/agent-sub-runner.js'), 'utf8')

    ctx.assert.ok(
      aiChat.includes('while (continueLoop)'),
      'main chat should continue tool rounds until the model stops returning tools'
    )
    ctx.assert.ok(
      !/maxLoops|loopCount\s*<\s*maxLoops|工具调用循环达到上限|tool call limit reached/i.test(aiChat),
      'main chat should not have an artificial total tool-loop cap'
    )
    ctx.assert.ok(
      subRunner.includes('while (true)') && subRunner.includes('loop += 1'),
      'collaboration work sessions should not be bounded by a fixed loop count'
    )
    ctx.assert.ok(
      !/DEFAULT_MAX_LOOPS|MAX_WORK_SESSION_TOOL_CALLS|工具调用已达上限|tool call limit reached/i.test(subRunner),
      'collaboration work sessions should not have an artificial tool-call cap'
    )
    ctx.assert.ok(
      /signal\?\.aborted|throwIfAborted\(signal\)/.test(`${aiChat}\n${subRunner}`),
      'user interruption must remain available after removing artificial caps'
    )
    const recovery = fs.readFileSync(path.join(ctx.root, 'electron/modules/tool-failure-recovery.js'), 'utf8')
    ctx.assert.ok(recovery.includes('consecutiveFailures >= 5'), 'repeated failures should stop a no-progress tool loop')
    ctx.assert.ok(recovery.includes("kindCount >= 3"), 'repeated invalid path or argument failures should restrict write tools')
    ctx.assert.ok(recovery.includes('kindCount >= 2'), 'repeated path or argument failures should return recovery guidance')

    const { createToolFailureRecoveryTracker } = require(path.join(ctx.root, 'electron/modules/tool-failure-recovery.js'))
    const tracker = createToolFailureRecoveryTracker()
    const missingPath = { success: false, error_type: 'missing_path', error: 'path is required' }
    const first = tracker.record('edit_file', missingPath)
    const second = tracker.record('edit_file', missingPath)
    const third = tracker.record('edit_file', missingPath)
    ctx.assert.ok(!first.guidance && second.guidance, 'second matching failure should include recovery guidance')
    ctx.assert.ok(third.writeRestricted && tracker.shouldBlock('edit_file'), 'third matching failure should temporarily restrict write tools')
    tracker.record('read_file', { success: true })
    ctx.assert.ok(!tracker.shouldBlock('edit_file'), 'a successful tool result should restore normal write access')

    const stopTracker = createToolFailureRecoveryTracker()
    for (let index = 0; index < 5; index += 1) stopTracker.record('read_file', { success: false, error_type: 'read_error', error: 'temporary failure' })
    ctx.assert.ok(stopTracker.isStopRequested(), 'five consecutive failures should request a tool-loop stop')
    ctx.assert.ok(
      aiChat.includes('includeTools: true') &&
      !aiChat.includes('includeTools: !toolFailureRecovery.isStopRequested()'),
      'failure recovery must keep the tool schema stable instead of deleting the cached prefix'
    )
    const stoppedResult = stopTracker.getStopBlockResult('read_file')
    ctx.assert.equal(stoppedResult.internal, true, 'post-stop tool calls should be paired with an internal blocked result')
    ctx.assert.equal(stoppedResult.error_type, 'recovery_tool_loop_stopped', 'post-stop tool calls need an explicit recovery result')
  }
}
