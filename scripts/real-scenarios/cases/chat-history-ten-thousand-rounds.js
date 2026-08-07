const path = require('path')

module.exports = {
  id: 'chat-history.ten-thousand-rounds',
  title: 'Ten-thousand-round chats keep page reads and tail appends bounded',
  tags: ['chat-history', 'pagination', 'performance'],
  changedFilePatterns: [
    /^electron\/modules\/(?:chat-chunk-store|chat-message-identity|projects)\.js$/i
  ],

  async run(ctx) {
    const workspace = ctx.createWorkspace(this.id)
    const store = require(path.join(ctx.root, 'electron/modules/chat-chunk-store'))
    const historyPath = path.join(workspace.storagePath, 'large-session', 'chat-history.json')
    const messages = []
    for (let round = 1; round <= 10000; round++) {
      messages.push(
        { role: 'user', content: `user-${round}`, messageId: `user-${round}`, roundId: `round-${round}` },
        { role: 'assistant', content: `assistant-${round}`, messageId: `assistant-${round}`, roundId: `round-${round}` }
      )
    }

    try {
      await store.replaceAll(historyPath, messages, { sessionId: 'ten-thousand-rounds' })
      const manifest = await store.readManifest(historyPath)
      ctx.assert.equal(manifest.roundCount, 10000, 'all rounds should remain represented in the manifest')
      ctx.assert.ok(manifest.chunks.length >= 333 && manifest.chunks.length <= 334, 'history should be split into thirty-round chunks')

      const latestStartedAt = Date.now()
      const latest = await store.readPage(historyPath, { direction: 'older', pageChunks: 1 })
      const latestElapsedMs = Date.now() - latestStartedAt
      ctx.assert.equal(latest.messages.at(-1)?.messageId, 'assistant-10000', 'opening should read the latest page only')
      ctx.assert.ok(latest.messages.length <= 60, 'latest page payload should stay bounded to one chunk')
      ctx.assert.ok(latestElapsedMs < 2000, `latest page read should remain bounded, got ${latestElapsedMs}ms`)

      const oldest = await store.readPage(historyPath, { cursor: 0, direction: 'newer', pageChunks: 1 })
      ctx.assert.equal(oldest.messages[0]?.messageId, 'user-1', 'cursor paging should still reach the first round')

      const runtimeTail = messages.slice(-180).concat([
        { role: 'user', content: 'user-10001', messageId: 'user-10001', roundId: 'round-10001' },
        { role: 'assistant', content: 'assistant-10001', messageId: 'assistant-10001', roundId: 'round-10001' }
      ])
      const appendStartedAt = Date.now()
      const appended = await store.syncSnapshot(historyPath, runtimeTail, { sessionId: 'ten-thousand-rounds' })
      const appendElapsedMs = Date.now() - appendStartedAt
      ctx.assert.equal(appended.appendedCount, 2, 'a compact runtime tail should append only the new round')
      ctx.assert.equal(appended.manifest.messageCount, 20002, 'tail append must preserve all persisted raw history')
      ctx.assert.ok(appendElapsedMs < 2000, `tail append should remain bounded, got ${appendElapsedMs}ms`)
    } finally {
      workspace.cleanup()
    }
  }
}
