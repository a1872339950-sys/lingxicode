const fs = require('fs')
const path = require('path')
const vm = require('vm')

module.exports = {
  id: 'chat-history.runtime-cache',
  title: 'Runtime history cache stays round-bounded after complete chunk persistence',
  tags: ['chat-history', 'cache', 'persistence'],
  changedFilePatterns: [
    /^electron\/modules\/(?:projects|chat-chunk-store|chat-message-identity)\.js$/i,
    /^frontend\/scripts\/features\/(?:chat-runtime-history-cache|message-sender|ipc-reply-listener)\.js$/i,
    /^frontend\/index\.html$/i
  ],

  async run(ctx) {
    const workspace = ctx.createWorkspace(this.id)
    const projects = require(path.join(ctx.root, 'electron/modules/projects'))
    const chunkStore = require(path.join(ctx.root, 'electron/modules/chat-chunk-store'))
    const config = require(path.join(ctx.root, 'electron/modules/config'))
    const projectId = `runtime-cache-${Date.now()}`
    const sessionDir = path.join(workspace.storagePath, 'chat-sessions', 'cache-session')
    const historyPath = path.join(sessionDir, 'chat-history.json')
    const messagesHistory = buildRounds(120)
    const instance = {
      projectId,
      projectPath: workspace.projectPath,
      storagePath: workspace.storagePath,
      chatHistoryPath: historyPath,
      messagesHistory,
      branchTitle: '',
      stateless: false,
      _chatHistoryDirty: true,
      _activeChatRequestCount: 0
    }
    config.setProjectInstance(projectId, instance)

    try {
      await projects.saveProjectChatHistory(projectId)
      ctx.assert.equal(instance.messagesHistory.length, 180, 'backend runtime cache should retain ninety complete rounds')
      ctx.assert.equal(instance.messagesHistory[0].content, 'user-31', 'backend cache should trim only at a complete round boundary')
      const persisted = await chunkStore.readAll(historyPath)
      ctx.assert.equal(persisted.messages.length, 240, 'runtime cache compaction must not delete persisted raw history')

      instance.messagesHistory.push(
        { role: 'user', content: 'user-121' },
        { role: 'assistant', content: 'assistant-121' }
      )
      instance._chatHistoryDirty = true
      await projects.saveProjectChatHistory(projectId)
      const appended = await chunkStore.readAll(historyPath)
      ctx.assert.equal(appended.messages.length, 242, 'saving from the compacted tail should append only the new round')

      const source = fs.readFileSync(path.join(ctx.root, 'frontend/scripts/features/chat-runtime-history-cache.js'), 'utf8')
      const sandbox = { window: {} }
      vm.createContext(sandbox)
      vm.runInContext(source, sandbox)
      const frontendHistory = buildRounds(120)
      const compacted = sandbox.window.ChatRuntimeHistoryCache.compact(frontendHistory)
      ctx.assert.equal(compacted.length, 180, 'frontend cache should use the same ninety-round bound')
      ctx.assert.equal(compacted[0].content, 'user-31', 'frontend cache should not split the oldest retained round')
    } finally {
      config.deleteProjectInstance(projectId)
      workspace.cleanup()
    }
  }
}

function buildRounds(count) {
  const messages = []
  for (let turn = 1; turn <= count; turn++) {
    messages.push(
      { role: 'user', content: `user-${turn}` },
      { role: 'assistant', content: `assistant-${turn}` }
    )
  }
  return messages
}
