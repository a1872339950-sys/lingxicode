const fs = require('fs')
const path = require('path')

module.exports = {
  id: 'asset-library.expired-media-hidden',
  title: 'Expired asset files do not occupy resource center cards',
  tags: ['resource-center', 'assets', 'media'],
  changedFilePatterns: [
    /^electron\/modules\/asset-library\.js$/i,
    /^frontend\/scripts\/features\/integration-market\.js$/i
  ],

  async run(ctx) {
    const workspace = ctx.createWorkspace('asset-library-expired-media-hidden')
    try {
      const assetLibrary = require(path.join(ctx.root, 'electron/modules/asset-library'))
      const options = { rootDir: path.join(workspace.dir, 'asset-library') }
      const validPath = path.join(workspace.dir, 'valid-image.png')
      const missingPath = path.join(workspace.dir, 'expired-image.png')
      const inspectedPath = path.join(workspace.dir, 'inspected-input.png')
      ctx.writeText(validPath, 'valid image fixture')
      ctx.writeText(inspectedPath, 'inspected image fixture')

      assetLibrary.upsertAsset({
        path: validPath,
        title: 'valid-image.png',
        kind: 'screenshot',
        sourceTool: 'capture_screenshot'
      }, options)
      assetLibrary.upsertAsset({
        path: missingPath,
        title: 'expired-image.png',
        kind: 'screenshot',
        sourceTool: 'capture_screenshot'
      }, options)
      assetLibrary.upsertAsset({
        path: inspectedPath,
        title: 'inspected-input.png',
        kind: 'image',
        sourceTool: 'inspect_image'
      }, options)

      const diagnostic = assetLibrary.queryAssets({ scan: false, limit: 20, includeMissing: true }, options)
      ctx.assert.equal(diagnostic.assets.length, 3, 'diagnostic queries may explicitly include missing and non-asset records')
      const stale = diagnostic.assets.find(item => item.path === path.resolve(missingPath))
      ctx.assert.ok(stale, 'missing record should remain available for diagnostics')
      ctx.assert.equal(stale.exists, false, 'missing record should be marked unavailable')

      const visible = assetLibrary.queryAssets({ scan: false, limit: 20, pruneMissing: false }, options)
      ctx.assert.equal(visible.success, true, 'asset query should succeed')
      ctx.assert.equal(visible.assets.length, 1, 'missing files and inspected inputs should be hidden from the resource center')
      ctx.assert.equal(visible.assets[0].path, path.resolve(validPath), 'existing file should remain visible')
      ctx.assert.equal(visible.assets[0].exists, true, 'existing record should be refreshed as available')
      ctx.assert.equal(visible.hiddenMissing, 1, 'query should report one hidden stale record')
      ctx.assert.equal(visible.hiddenNonAsset, 1, 'query should report one inspected input excluded from assets')

      const pruned = assetLibrary.queryAssets({ scan: false, limit: 20 }, options)
      ctx.assert.equal(pruned.assets.length, 1, 'normal resource refresh should preserve the valid file')
      ctx.assert.equal(assetLibrary.loadIndex(options).records.length, 1, 'normal refresh should remove stale and non-producing records from the index')

      fs.unlinkSync(validPath)
      const afterDelete = assetLibrary.queryAssets({ scan: false, limit: 20 }, options)
      ctx.assert.equal(afterDelete.assets.length, 0, 'a file deleted after indexing should disappear on the next refresh')
      ctx.assert.equal(assetLibrary.loadIndex(options).records.length, 0, 'deleted file record should also be pruned from the index')

      const frontend = fs.readFileSync(path.join(ctx.root, 'frontend/scripts/features/integration-market.js'), 'utf8')
      const removeFallback = "onerror=\"this.closest('.asset-library-card')?.remove()\""
      ctx.assert.equal(
        frontend.split(removeFallback).length - 1,
        2,
        'image and video load races should remove the whole stale card instead of rendering a placeholder'
      )
    } finally {
      workspace.cleanup()
    }
  }
}
