const crypto = require('crypto')
const fs = require('fs')
const path = require('path')

function hashFile(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex')
}

module.exports = {
  id: 'chat-history.chunk-pagination',
  title: 'Chat history migrates to immutable round chunks and reads older pages by cursor',
  tags: ['chat-history', 'pagination', 'migration'],
  changedFilePatterns: [
    /^electron\/modules\/chat-(?:chunk-store|message-identity)\.js$/i,
    /^electron\/modules\/projects\.js$/i,
    /^electron\/preload\.js$/i
  ],

  async run(ctx) {
    const workspace = ctx.createWorkspace(this.id)
    const chunkStore = require(path.join(ctx.root, 'electron/modules/chat-chunk-store'))
    const projects = require(path.join(ctx.root, 'electron/modules/projects'))
    const config = require(path.join(ctx.root, 'electron/modules/config'))
    const sessionDir = path.join(workspace.storagePath, 'chat-sessions', 'session-a')
    const legacyPath = path.join(sessionDir, 'chat-history.json')
    const legacyMessages = []
    for (let round = 0; round < 75; round++) {
      legacyMessages.push(
        { role: 'user', content: `question-${round}` },
        { role: 'assistant', content: '', tool_calls: [{ id: `call-${round}`, function: { name: 'read_file', arguments: '{}' } }] },
        { role: 'tool', tool_call_id: `call-${round}`, content: `result-${round}` },
        { role: 'assistant', content: `answer-${round}` }
      )
    }
    fs.mkdirSync(sessionDir, { recursive: true })
    fs.writeFileSync(legacyPath, JSON.stringify({ messages: legacyMessages, hasArchive: false }, null, 2))
    const legacyHash = hashFile(legacyPath)

    try {
      const manifest = await chunkStore.migrateLegacy(legacyPath, legacyMessages, { sessionId: 'session-a' })
      ctx.assert.equal(manifest.chunks.length, 3, '75 complete rounds should create three chunks')
      ctx.assert.equal(manifest.messageCount, 300, 'manifest should count every migrated message')
      ctx.assert.equal(manifest.roundCount, 75, 'manifest should count complete rounds')
      ctx.assert.ok(manifest.chunks.slice(0, -1).every(chunk => chunk.sealed), 'all non-active chunks should be sealed')

      const collected = []
      let cursor = null
      let pageCount = 0
      do {
        const page = await chunkStore.readPage(legacyPath, { cursor, pageChunks: 1 })
        collected.unshift(...page.messages)
        cursor = page.nextCursor
        pageCount += 1
        if (!page.hasMore) break
      } while (pageCount < 10)
      ctx.assert.equal(pageCount, 3, 'history should be available through three cursor pages')
      ctx.assert.equal(collected.length, 300, 'pagination should recover the complete original history')
      ctx.assert.equal(new Set(collected.map(message => message.messageId)).size, 300, 'every migrated message should have a stable unique ID')
      ctx.assert.equal(new Set(collected.map(message => message.roundId)).size, 75, 'tool calls and results should share their complete round ID')

      const fullSnapshotRepeat = await chunkStore.syncSnapshot(legacyPath, collected, { sessionId: 'session-a' })
      ctx.assert.equal(fullSnapshotRepeat.appendedCount, 0, 'a full in-memory snapshot should not duplicate history already stored in chunks')
      ctx.assert.equal(fullSnapshotRepeat.manifest.messageCount, 300, 'full snapshot reconciliation should preserve the stored message count')

      const forwardCollected = []
      let forwardCursor = null
      let forwardPageCount = 0
      do {
        const page = await chunkStore.readPage(legacyPath, {
          cursor: forwardCursor,
          direction: 'newer',
          pageChunks: 1
        })
        forwardCollected.push(...page.messages)
        forwardCursor = page.nextCursor
        forwardPageCount += 1
        if (!page.hasMore) break
      } while (forwardPageCount < 10)
      ctx.assert.equal(forwardPageCount, 3, 'evicted pages should be reloadable in the newer direction')
      ctx.assert.deepEqual(
        forwardCollected.map(message => message.messageId),
        collected.map(message => message.messageId),
        'newer pagination should reconstruct history in chronological order'
      )

      for (const chunk of manifest.chunks) {
        const chunkPage = await chunkStore.readPage(legacyPath, {
          cursor: manifest.chunks.indexOf(chunk),
          pageChunks: 1
        })
        const roundIds = new Set(chunkPage.messages.map(message => message.roundId))
        for (const roundId of roundIds) {
          const allRoundMessages = collected.filter(message => message.roundId === roundId)
          const pageRoundMessages = chunkPage.messages.filter(message => message.roundId === roundId)
          ctx.assert.equal(pageRoundMessages.length, allRoundMessages.length, 'a complete tool round must not be split across chunks')
        }
      }

      const recentSnapshot = collected.slice(-80).map(message => ({ ...message }))
      recentSnapshot.push({ role: 'user', content: 'new-question' }, { role: 'assistant', content: 'new-answer' })
      const appended = await chunkStore.syncSnapshot(legacyPath, recentSnapshot, { sessionId: 'session-a' })
      ctx.assert.equal(appended.appendedCount, 2, 'sync should append only the new round')
      const repeated = await chunkStore.syncSnapshot(legacyPath, recentSnapshot, { sessionId: 'session-a' })
      ctx.assert.equal(repeated.appendedCount, 0, 'repeated save should be idempotent')
      ctx.assert.equal(repeated.manifest.messageCount, 302, 'repeated save must not duplicate messages')

      const projectId = `chunk-project-${Date.now()}`
      const projectMessages = recentSnapshot.concat([
        { role: 'user', content: 'project-writer-question' },
        { role: 'assistant', content: 'project-writer-answer' }
      ])
      config.setProjectInstance(projectId, {
        projectId,
        projectPath: workspace.projectPath,
        storagePath: workspace.storagePath,
        chatHistoryPath: legacyPath,
        messagesHistory: projectMessages,
        branchTitle: '',
        stateless: false
      })
      await projects.saveProjectChatHistory(projectId)
      const projectWrite = await chunkStore.readManifest(legacyPath)
      ctx.assert.equal(projectWrite.messageCount, 304, 'projects save path should append through the chunk store')
      const chunkFiles = fs.readdirSync(path.join(sessionDir, 'chunks')).filter(name => name.endsWith('.json'))
      ctx.assert.equal(chunkFiles.length, projectWrite.chunks.length, 'superseded active chunk revisions should be reclaimed after manifest commit')
      config.deleteProjectInstance(projectId)

      const deletedId = collected[0].messageId
      await chunkStore.deleteMessages(legacyPath, [deletedId])
      const afterDelete = await chunkStore.readAll(legacyPath)
      ctx.assert.equal(afterDelete.messages.length, 303, 'explicit tombstone should hide only the selected message')
      ctx.assert.ok(!afterDelete.messages.some(message => message.messageId === deletedId), 'deleted message should stay hidden without rewriting sealed chunks')
      ctx.assert.equal(hashFile(legacyPath), legacyHash, 'legacy JSON must remain unchanged after migration')
    } finally {
      for (const [projectId] of config.getProjectInstances()) {
        if (String(projectId).startsWith('chunk-project-')) config.deleteProjectInstance(projectId)
      }
      workspace.cleanup()
    }
  }
}
