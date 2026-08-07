const fs = require('fs')
const path = require('path')

module.exports = {
  id: 'chat-history.source-reference',
  title: 'Forked chat history references source chunks and stores only its own appended rounds',
  tags: ['chat-history', 'branch', 'reference'],
  changedFilePatterns: [
    /^electron\/modules\/chat-(?:chunk-store|history-source-links|message-identity)\.js$/i,
    /^electron\/modules\/context-compression\.js$/i,
    /^electron\/modules\/projects\.js$/i,
    /^frontend\/scripts\/features\/(?:project-workspaces|project-branch-session)\.js$/i
  ],

  async run(ctx) {
    const workspace = ctx.createWorkspace(this.id)
    const store = require(path.join(ctx.root, 'electron/modules/chat-chunk-store'))
    const compression = require(path.join(ctx.root, 'electron/modules/context-compression'))
    const sourceDir = path.join(workspace.storagePath, 'source')
    const targetDir = path.join(workspace.storagePath, 'target')
    const sourcePath = path.join(sourceDir, 'chat-history.json')
    const targetPath = path.join(targetDir, 'chat-history.json')
    const sourceMessages = buildRounds(75)

    try {
      await store.replaceAll(sourcePath, sourceMessages, { sessionId: 'source-session' })
      await compression.saveSummaries({
        chatHistoryPath: sourcePath,
        contextStoragePath: sourceDir
      }, [buildSummary('source-summary', 1, 60)])
      const sourceManifestBefore = await store.readManifest(sourcePath)
      const sourceChunkFilesBefore = fs.readdirSync(path.join(sourceDir, 'chunks')).sort()
      const reference = await store.createSourceReference(targetPath, sourcePath, {
        sourceProjectId: 'source-project',
        sourceSessionId: 'source-session',
        targetProjectId: 'target-project',
        targetSessionId: 'target-session'
      })

      const targetManifestBefore = await store.readManifest(targetPath)
      ctx.assert.equal(targetManifestBefore.chunks.length, 0, 'creating a fork should not copy source chunks into the target')
      ctx.assert.equal(reference.sourceChunkCount, 3, 'reference should freeze the source chunk boundary at fork time')
      ctx.assert.ok(reference.forkMessageId, 'reference should persist the exact fork message cursor')

      const targetCompressionInstance = {
        chatHistoryPath: targetPath,
        contextStoragePath: targetDir
      }
      const inheritedSummaries = await compression.loadSummaries(targetCompressionInstance)
      ctx.assert.equal(inheritedSummaries.length, 1, 'fork should reuse source compression summaries without copying them')
      ctx.assert.ok(inheritedSummaries[0].inheritedFromSource, 'reused source summaries should remain identifiable as references')
      await compression.saveSummaries(targetCompressionInstance, [
        ...inheritedSummaries,
        buildSummary('target-summary', 61, 70)
      ])
      const targetLocalSummaryFile = path.join(targetDir, 'compression-summaries.json')
      ctx.assert.equal(JSON.parse(fs.readFileSync(targetLocalSummaryFile, 'utf8')).length, 1, 'target summary file should store only target-owned summaries')

      const latest = await store.readPage(targetPath, { direction: 'older', pageChunks: 1 })
      ctx.assert.equal(latest.range.totalChunks, 3, 'an empty fork should expose source chunks through composite pagination')
      ctx.assert.equal(latest.messages.at(-1).content, 'assistant-75', 'latest composite page should end at the fork point')

      const targetSnapshot = latest.messages.concat([
        { role: 'user', content: 'target-user-76' },
        { role: 'assistant', content: 'target-assistant-76' }
      ])
      const appended = await store.syncSnapshot(targetPath, targetSnapshot, { sessionId: 'target-session' })
      ctx.assert.equal(appended.appendedCount, 2, 'the fork should append only messages after the source cursor')
      ctx.assert.equal(appended.manifest.messageCount, 2, 'target manifest should count only target-owned messages')
      ctx.assert.equal(appended.manifest.chunks.length, 1, 'target should own one incremental chunk after its first round')

      const composite = await store.readAll(targetPath)
      ctx.assert.equal(composite.messages.length, 152, 'composite history should contain source prefix plus target increment')
      ctx.assert.equal(composite.messages.at(-1).content, 'target-assistant-76', 'target increment should follow the referenced source prefix')
      ctx.assert.equal(composite.manifest.messageCount, 152, 'composite metadata should report the visible total')

      const sourceWithLaterRound = (await store.readAll(sourcePath)).messages.concat([
        { role: 'user', content: 'source-user-76' },
        { role: 'assistant', content: 'source-assistant-76' }
      ])
      await store.syncSnapshot(sourcePath, sourceWithLaterRound, { sessionId: 'source-session' })
      const frozenFork = await store.readAll(targetPath)
      ctx.assert.ok(!frozenFork.messages.some(message => message.content === 'source-assistant-76'), 'source messages created after the fork must stay outside the branch')
      ctx.assert.equal(frozenFork.messages.length, 152, 'source growth should not change the fixed branch prefix')

      const sourceFirstMessageId = (await store.readPage(sourcePath, { cursor: 0, direction: 'newer', pageChunks: 1 })).messages[0].messageId
      await store.deleteMessages(sourcePath, [sourceFirstMessageId])
      const sourceAfterDelete = await store.readAll(sourcePath)
      const branchAfterSourceDelete = await store.readAll(targetPath)
      ctx.assert.equal(sourceAfterDelete.messages.length, 151, 'source deletion should remain visible in the source session')
      ctx.assert.equal(branchAfterSourceDelete.messages.length, 152, 'source deletions after the fork must not rewrite branch history')

      ctx.assert.deepEqual(
        fs.readdirSync(path.join(sourceDir, 'chunks')).filter(file => sourceChunkFilesBefore.slice(0, -1).includes(file)).sort(),
        sourceChunkFilesBefore.slice(0, -1),
        'source growth should preserve every sealed chunk referenced by the branch'
      )
      ctx.assert.equal(sourceManifestBefore.messageCount, 150, 'source manifest baseline should remain independently countable')

      const detached = await store.detachSourceConsumers(sourcePath)
      ctx.assert.equal(detached.length, 1, 'source deletion preparation should find the dependent branch')
      ctx.assert.ok(detached[0].materialized, 'dependent branch should materialize only when its source is being deleted')
      fs.rmSync(sourceDir, { recursive: true, force: true })
      const detachedView = await store.readAll(targetPath)
      ctx.assert.equal(detachedView.messages.length, 152, 'materialized branch should remain complete after source storage is removed')
      ctx.assert.ok(!await store.readSourceReference(targetPath), 'materialization should release the source reference')
      const detachedSummaries = await compression.loadSummaries(targetCompressionInstance)
      ctx.assert.equal(detachedSummaries.length, 2, 'source summaries should materialize with history before source deletion')
      ctx.assert.ok(detachedSummaries.every(summary => !summary.inheritedFromSource), 'materialized summaries should become target-owned')
    } finally {
      workspace.cleanup()
    }
  }
}

function buildSummary(id, startTurn, endTurn) {
  return {
    id,
    type: 'compression_summary',
    schemaVersion: 4,
    startTurn,
    endTurn,
    startMessageId: '',
    endMessageId: '',
    startRoundId: '',
    endRoundId: '',
    coverageHash: '',
    summary: { topic: id, aiDid: [], keyInfo: [], openItems: [] },
    summaryText: id,
    createdAt: Date.now()
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
