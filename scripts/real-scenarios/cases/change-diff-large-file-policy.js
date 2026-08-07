const fs = require('fs')
const path = require('path')
const vm = require('vm')

module.exports = {
  id: 'change-diff.large-file-policy',
  title: 'Large file diff avoids quadratic frontend LCS and oversized DOM payloads',
  tags: ['diff', 'performance', 'frontend'],
  changedFilePatterns: [
    /^frontend\/scripts\/features\/(?:change-diff-policy|window-tabs)\.js$/i,
    /^electron\/modules\/content-object-store\.js$/i
  ],

  async run(ctx) {
    const source = fs.readFileSync(path.join(ctx.root, 'frontend/scripts/features/change-diff-policy.js'), 'utf8')
    const sandbox = { window: {}, console }
    vm.createContext(sandbox)
    vm.runInContext(source, sandbox)
    const policy = sandbox.window.ChangeDiffPolicy

    const before = Array.from({ length: 5000 }, (_, index) => `old-${index}`).join('\n')
    const after = Array.from({ length: 5000 }, (_, index) => `new-${index}`).join('\n')
    const startedAt = Date.now()
    const result = policy.compute(before, after)
    ctx.assert.equal(result.mode, 'linear', 'large line products should bypass exact LCS')
    ctx.assert.ok(Date.now() - startedAt < 500, 'near-linear diff planning should complete without a quadratic pause')
    ctx.assert.ok(result.hunks[0].changes.length <= 1602, 'large changed regions should cap rendered rows')

    const oversized = policy.compute('a'.repeat(1100000), 'b'.repeat(1100000))
    ctx.assert.equal(oversized.mode, 'summary', 'oversized text should stay out of the frontend diff body')

    const tabs = fs.readFileSync(path.join(ctx.root, 'frontend/scripts/features/window-tabs.js'), 'utf8')
    ctx.assert.ok(/models\.forEach\(model => model\.dispose\?\.\(\)\)/.test(tabs), 'closing a tab should dispose Monaco models as well as editors')
    ctx.assert.ok(/const summaryOnly = \/过大\|过多\|仅显示变更统计/.test(tabs), 'oversized fallback should render metadata without raw full text')
  }
}
