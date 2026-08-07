const fs = require('fs')
const path = require('path')

module.exports = {
  id: 'tool-argument.live-line-progress',
  title: 'Streamed write arguments update one tool card with real line counts',
  tags: ['ai-progress', 'tool-streaming', 'frontend'],
  changedFilePatterns: [
    /^electron\/modules\/progress-narration\.js$/i,
    /^electron\/preload\.js$/i,
    /^frontend\/scripts\/features\/ai-tool-renderer\.js$/i,
    /^frontend\/scripts\/features\/ipc-ai-stream-listeners\.js$/i,
    /^frontend\/scripts\/features\/ai-runtime-cache\.js$/i
  ],

  async run(ctx) {
    const progress = require(path.join(ctx.root, 'electron/modules/progress-narration'))
    const events = []
    const tracker = progress.createToolArgumentProgressTracker({
      send(name, payload) {
        events.push({ name, payload })
      }
    }, 'project-live', { chatSessionId: 'session-live' })

    const toolCall = {
      id: 'tool-live',
      function: {
        name: 'write_file',
        arguments: '{"path":"greenence-ai/index.html","content":"<main>\\n'
      }
    }
    tracker.update(toolCall)
    toolCall.function.arguments += '  <h1>Hello</h1>\\n  <p>World</p>\\n'
    tracker.update(toolCall)
    toolCall.function.arguments += '</main>"}'
    tracker.update(toolCall)
    tracker.complete(toolCall)

    ctx.assert.ok(events.length > 0, 'streamed tool arguments should emit runtime progress')
    ctx.assert.ok(events.every(event => event.name === 'tool-argument-progress'), 'progress must use a tool-only IPC event')
    const last = events[events.length - 1].payload
    ctx.assert.equal(last.path, 'greenence-ai/index.html', 'partial JSON should expose the target file early')
    ctx.assert.equal(last.addedLines, 4, 'line counter should reflect the received file content')
    ctx.assert.equal(last.chatSessionId, 'session-live', 'progress must remain isolated to the running chat session')
    ctx.assert.equal(last.complete, true, 'the final streamed argument update should be marked complete')

    const preload = fs.readFileSync(path.join(ctx.root, 'electron/preload.js'), 'utf8')
    const listeners = fs.readFileSync(path.join(ctx.root, 'frontend/scripts/features/ipc-ai-stream-listeners.js'), 'utf8')
    const renderer = fs.readFileSync(path.join(ctx.root, 'frontend/scripts/features/ai-tool-renderer.js'), 'utf8')
    const runtimeCache = fs.readFileSync(path.join(ctx.root, 'frontend/scripts/features/ai-runtime-cache.js'), 'utf8')
    ctx.assert.ok(preload.includes("onToolArgumentProgress") && preload.includes("'tool-argument-progress'"), 'preload should expose tool progress')
    ctx.assert.ok(listeners.includes('updateStreamingOperation') && listeners.includes('upsertPendingToolOp'), 'frontend should update rather than duplicate the pending tool card')
    ctx.assert.ok(renderer.includes('diff-live-number') && renderer.includes('updateLiveDiffNumber'), 'tool line count should animate in place')
    ctx.assert.ok(runtimeCache.includes('op.streaming') && runtimeCache.includes('updateStreamingOperation'), 'project switching should restore the live counter')
  }
}
