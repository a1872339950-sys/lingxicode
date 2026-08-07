const fs = require('fs')
const path = require('path')

module.exports = {
  id: 'chat-history.migration-fallback',
  title: 'Legacy chat migration remains readable and retryable after atomic write failure',
  tags: ['chat-history', 'migration', 'recovery'],
  changedFilePatterns: [
    /^electron\/modules\/(?:chat-chunk-store|projects)\.js$/i
  ],

  async run(ctx) {
    const workspace = ctx.createWorkspace(this.id)
    const store = require(path.join(ctx.root, 'electron/modules/chat-chunk-store'))
    const historyPath = path.join(workspace.storagePath, 'legacy-session', 'chat-history.json')
    const manifestPath = path.join(path.dirname(historyPath), 'manifest.json')
    const legacyMessages = []
    for (let round = 1; round <= 45; round++) {
      legacyMessages.push(
        { role: 'user', content: `legacy-user-${round}` },
        { role: 'assistant', content: `legacy-assistant-${round}` }
      )
    }
    fs.mkdirSync(path.dirname(historyPath), { recursive: true })
    const legacyPayload = JSON.stringify(legacyMessages, null, 2)
    fs.writeFileSync(historyPath, legacyPayload, 'utf8')

    const originalRename = fs.promises.rename
    let injectedFailure = null
    try {
      fs.promises.rename = async function failManifestRename(source, target) {
        if (path.resolve(String(target)) === path.resolve(manifestPath)) {
          const error = new Error('intentional manifest replacement failure')
          error.code = 'EIO'
          throw error
        }
        return originalRename.call(this, source, target)
      }
      try {
        await store.migrateLegacy(historyPath, legacyMessages, { sessionId: 'legacy-fallback' })
      } catch (error) {
        injectedFailure = error
      }
      ctx.assert.ok(injectedFailure, 'migration failure should be observable to the caller')
      ctx.assert.equal(fs.readFileSync(historyPath, 'utf8'), legacyPayload, 'failed migration must not modify or delete the legacy history')
      ctx.assert.ok(!fs.existsSync(manifestPath), 'a failed manifest replacement must not publish a partial new store')

      fs.promises.rename = originalRename
      const manifest = await store.migrateLegacy(historyPath, legacyMessages, { sessionId: 'legacy-fallback' })
      ctx.assert.equal(manifest.messageCount, legacyMessages.length, 'migration should be retryable after the storage fault clears')
      const firstPage = await store.readPage(historyPath, { cursor: 0, direction: 'newer', pageChunks: 1 })
      ctx.assert.equal(firstPage.messages[0]?.content, 'legacy-user-1', 'the retried store should preserve the first message')
      ctx.assert.equal(fs.readFileSync(historyPath, 'utf8'), legacyPayload, 'successful migration should retain the legacy file as read-only fallback')

      const firstChunkPath = path.join(path.dirname(historyPath), 'chunks', manifest.chunks[0].file)
      fs.writeFileSync(firstChunkPath, '{corrupt-new-chunk', 'utf8')
      let checksumFailure = null
      try {
        await store.readPage(historyPath, { cursor: 0, direction: 'newer', pageChunks: 1 })
      } catch (error) {
        checksumFailure = error
      }
      ctx.assert.ok(checksumFailure, 'corrupt new-format data should fail closed instead of returning partial messages')
      ctx.assert.equal(JSON.parse(fs.readFileSync(historyPath, 'utf8')).length, legacyMessages.length, 'legacy fallback should remain independently readable after new-format corruption')
    } finally {
      fs.promises.rename = originalRename
      workspace.cleanup()
    }
  }
}
