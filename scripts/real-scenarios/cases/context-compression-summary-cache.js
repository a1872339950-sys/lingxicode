const fs = require('fs')
const path = require('path')

module.exports = {
  id: 'context-compression.summary-cache',
  title: 'Context compression summaries use a short read cache and refresh after save',
  tags: ['context-compression', 'cache', 'filesystem'],
  changedFilePatterns: [
    /^electron\/modules\/context-compression\.js$/i
  ],

  async run(ctx) {
    const workspace = ctx.createWorkspace(this.id)
    const contextCompression = require(path.join(ctx.root, 'electron/modules/context-compression'))
    const instance = { storagePath: workspace.storagePath }
    const filePath = path.join(workspace.storagePath, 'compression-summaries.json')
    const originalReadFileSync = fs.readFileSync

    try {
      fs.mkdirSync(workspace.storagePath, { recursive: true })
      fs.writeFileSync(filePath, JSON.stringify([
        makeSummary('summary-0001', 1, 8, 'cached first', 3)
      ], null, 2), 'utf-8')

      const first = await contextCompression.loadSummaries(instance)
      ctx.assert.equal(first[0]?.summaryText, 'cached first', 'initial summary should load from disk')
      ctx.assert.equal(first[0]?.schemaVersion, 4, 'legacy v3 summaries should normalize to the cursor-aware schema')
      ctx.assert.equal(first[0]?.migratedFromSchemaVersion, 3, 'legacy summary origin should remain visible for migration diagnostics')

      let readCount = 0
      fs.readFileSync = function patchedReadFileSync(...args) {
        if (path.resolve(String(args[0])) === path.resolve(filePath)) readCount++
        return originalReadFileSync.apply(this, args)
      }
      const cached = await contextCompression.loadSummaries(instance)
      await contextCompression.loadSummaries(instance)
      fs.readFileSync = originalReadFileSync
      ctx.assert.equal(cached[0]?.summaryText, 'cached first', 'short TTL should reuse in-memory summaries')
      ctx.assert.equal(readCount, 0, 'cached summary reads should not hit disk during TTL')

      await contextCompression.saveSummaries(instance, [
        makeSummary('summary-0002', 9, 16, 'saved refresh')
      ])
      const refreshed = await contextCompression.loadSummaries(instance)
      ctx.assert.equal(refreshed.length, 1, 'save should refresh the cache immediately')
      ctx.assert.equal(refreshed[0]?.summaryText, 'saved refresh', 'saved cache should return newest summaries')

      await contextCompression.saveSummaries(instance, [
        makeSummary('summary-0003', 17, 24, 'newest summary')
      ])
      const previousPath = path.join(workspace.storagePath, 'compression-summaries.previous.json')
      ctx.assert.ok(fs.existsSync(previousPath), 'summary persistence should retain exactly one previous version')
      fs.writeFileSync(filePath, '{broken-primary-summary', 'utf-8')
      const fallback = await contextCompression.loadSummaries(instance)
      ctx.assert.equal(fallback[0]?.summaryText, 'saved refresh', 'a corrupt primary summary should fall back to the immediately previous version')
      ctx.assert.ok(instance.__compressionSummariesReadFailed, 'fallback reads should pause new compression until the primary file is repaired')
    } finally {
      fs.readFileSync = originalReadFileSync
      workspace.cleanup()
    }
  }
}

function makeSummary(id, startTurn, endTurn, summaryText, schemaVersion = 4) {
  return {
    id,
    type: 'compression_summary',
    schemaVersion,
    startTurn,
    endTurn,
    startHistoryIndex: 0,
    endHistoryIndex: 1,
    summary: { turns: [] },
    summaryText,
    workerProvider: 'scenario',
    workerError: '',
    createdAt: Date.now()
  }
}
