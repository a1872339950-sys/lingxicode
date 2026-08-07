const fs = require('fs')
const path = require('path')

module.exports = {
  id: 'chat-history.stable-id-deletion',
  title: 'Paged chat deletion uses stable message IDs outside the runtime page',
  tags: ['chat-history', 'pagination', 'deletion'],
  changedFilePatterns: [
    /^electron\/modules\/(?:projects|chat-chunk-store)\.js$/i,
    /^frontend\/scripts\/(?:message-copy|features\/chat-renderer)\.js$/i
  ],

  async run(ctx) {
    const workspace = ctx.createWorkspace(this.id)
    const historyPath = path.join(workspace.storagePath, 'session', 'chat-history.json')
    const store = require(path.join(ctx.root, 'electron/modules/chat-chunk-store'))
    const messages = []
    for (let round = 1; round <= 60; round++) {
      messages.push({ role: 'user', content: `user-${round}`, messageId: `user-${round}`, roundId: `round-${round}` })
      messages.push({ role: 'assistant', content: `assistant-${round}`, messageId: `assistant-${round}`, roundId: `round-${round}` })
    }

    try {
      await store.replaceAll(historyPath, messages, { sessionId: 'stable-delete' })
      const latest = await store.readPage(historyPath, { direction: 'older', pageChunks: 1 })
      ctx.assert.ok(!latest.messages.some(message => message.messageId === 'user-1'), 'the backend runtime page should not contain the oldest message')

      await store.deleteMessages(historyPath, ['user-1'])
      const afterDelete = await store.readAll(historyPath)
      ctx.assert.ok(!afterDelete.messages.some(message => message.messageId === 'user-1'), 'a stable ID tombstone should delete a message outside the latest page')
      ctx.assert.ok(afterDelete.messages.some(message => message.messageId === 'assistant-1'), 'stable deletion should not remove adjacent messages')

      const rendererSource = fs.readFileSync(path.join(ctx.root, 'frontend/scripts/features/chat-renderer.js'), 'utf8')
      const actionsSource = fs.readFileSync(path.join(ctx.root, 'frontend/scripts/message-copy.js'), 'utf8')
      const projectsSource = fs.readFileSync(path.join(ctx.root, 'electron/modules/projects.js'), 'utf8')
      ctx.assert.ok(/dataset\.messageId\s*=\s*options\.messageId/.test(rendererSource), 'user message DOM should retain its stable message ID')
      ctx.assert.ok(/dataset\.messageIds\s*=\s*round\.aiSteps/.test(rendererSource), 'assistant DOM should retain all represented message IDs')
      ctx.assert.ok(/messageIds\s*}\)\s*=>\s*\(\{[^}]*messageIds/s.test(actionsSource), 'delete IPC should send stable message IDs')
      ctx.assert.ok(/selectedMessageIds[\s\S]*chatChunkStore\.deleteMessages/.test(projectsSource), 'backend deletion should tombstone selected stable IDs directly')
    } finally {
      workspace.cleanup()
    }
  }
}
