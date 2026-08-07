const fs = require('fs')
const path = require('path')

module.exports = {
  id: 'ai-progress.stream-visibility',
  title: 'Streaming AI requests append reasoning entries without heartbeat thinking pollution',
  tags: ['ai-progress', 'streaming', 'frontend'],
  changedFilePatterns: [
    /^electron\/modules\/ai-chat\.js$/i,
    /^frontend\/scripts\/features\/ipc-ai-stream-listeners\.js$/i,
    /^frontend\/scripts\/features\/ai-runtime-cache\.js$/i,
    /^frontend\/scripts\/features\/project-switcher\.js$/i,
    /^frontend\/scripts\/app\.js$/i
  ],

  async run(ctx) {
    const read = rel => fs.readFileSync(path.join(ctx.root, rel), 'utf8')
    const aiChat = read('electron/modules/ai-chat.js')
    const ipcListeners = read('frontend/scripts/features/ipc-ai-stream-listeners.js')
    const runtimeCache = read('frontend/scripts/features/ai-runtime-cache.js')
    const projectSwitcher = read('frontend/scripts/features/project-switcher.js')
    const app = read('frontend/scripts/app.js')

    ctx.assert.ok(
      aiChat.includes("toolName === 'show_thinking_note'") &&
        aiChat.includes('preserveContent: true') &&
        aiChat.includes('sendVisibleProgressStatus(status') &&
        !aiChat.includes('sendReasoningThinkingChunk(delta.reasoning_content)') &&
        !aiChat.includes('sendReasoningThinkingChunk(cdelta.reasoning_content)'),
      'ai-chat should emit visible thinking from model-authored [[状态: ...]] public text, not raw reasoning entries'
    )
    ctx.assert.ok(
      aiChat.includes('stopAllVisibleProgressHeartbeats()') &&
        /finally\s*\{[\s\S]{0,160}stopAllVisibleProgressHeartbeats\(\)/.test(aiChat),
      'runtime heartbeat timers should still be cleaned up in the request finally block'
    )
    ctx.assert.ok(
      aiChat.includes('Runtime heartbeats intentionally do not create thinking blocks') &&
        !aiChat.includes('正在等待模型返回下一步') &&
        !aiChat.includes('正在接收模型返回的下一步'),
      'runtime heartbeats should not manufacture visible thinking status templates'
    )
    ctx.assert.ok(
      aiChat.includes('function previewStreamingToolCall') &&
        aiChat.includes('previewedToolCallIds') &&
        (
          aiChat.includes("webContents?.send('tool-start'") ||
          aiChat.includes('webContents?.send(\'tool-start\'') ||
          /send\(\s*['"]tool-start['"]/.test(aiChat)
        ) &&
        (
          aiChat.includes('previewedToolCallIds.has(tc.id)') ||
          aiChat.includes('previewedToolCallIds.has(toolCallId)')
        ),
      'tool-start should be previewed or deduped during streamed tool-call assembly before execution'
    )
    ctx.assert.ok(
      aiChat.includes('show_thinking_note') &&
        aiChat.includes('thinkingNote') &&
        aiChat.includes('progressStatus: status'),
      'model-authored status markers should drive visible thinking blocks'
    )

    ctx.assert.ok(
      ipcListeners.includes("type: 'tool_pending'") &&
        ipcListeners.includes('aiToolRenderer.preShowOperation'),
      'frontend should persist tool-start events as pending operations before tool results arrive'
    )
    ctx.assert.ok(
      runtimeCache.includes("op.type === 'tool_pending'") &&
        runtimeCache.includes('deps.preShowOperation?.(op.name'),
      'runtime cache replay should restore pending tool cards'
    )
    // 项目切换可能复用 runtime cache 路径；至少要有一处把 tool_pending 回放到 preShowOperation
    ctx.assert.ok(
      (
        projectSwitcher.includes("op.type === 'tool_pending'") &&
        projectSwitcher.includes('deps.preShowOperation?.(op.name')
      ) ||
      (
        runtimeCache.includes("op.type === 'tool_pending'") &&
        runtimeCache.includes('deps.preShowOperation?.(op.name')
      ),
      'project switching or runtime cache replay should restore pending tool cards'
    )
    ctx.assert.ok(
      app.includes('preShowOperation:') &&
        app.includes('aiToolRenderer?.preShowOperation'),
      'app should expose pending tool rendering for runtime replay modules'
    )
  }
}
