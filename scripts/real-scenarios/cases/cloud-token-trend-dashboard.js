const fs = require('fs')
const path = require('path')

module.exports = {
  id: 'cloud-token-usage.trend-dashboard',
  title: 'Cloud token trend uses a full-width adaptive analytics dashboard',
  tags: ['ui', 'settings', 'token', 'chart', 'theme'],
  paths: [
    'frontend/index.html',
    'frontend/scripts/features/cloud-token-usage-settings.js',
    'frontend/styles/cloud-token-usage.css'
  ],
  async run(ctx) {
    const html = fs.readFileSync(path.join(ctx.root, 'frontend/index.html'), 'utf8')
    const js = fs.readFileSync(path.join(ctx.root, 'frontend/scripts/features/cloud-token-usage-settings.js'), 'utf8')
    const css = fs.readFileSync(path.join(ctx.root, 'frontend/styles/cloud-token-usage.css'), 'utf8')

    ctx.assert.ok(html.includes('Token 使用趋势图'), 'settings panel must use the refreshed trend title')
    ctx.assert.ok(js.includes('function buildSmoothPath'), 'trend lines must use a smooth path builder')
    ctx.assert.ok(js.includes('function buildAreaPath'), 'input/output/total series must render as area lines')
    ctx.assert.ok(js.includes('cloud-token-trend-metrics'), 'selected range must expose metric cards')
    ctx.assert.ok(js.includes('cloud-token-chart-crosshair'), 'hover details must include a chart crosshair')
    ctx.assert.ok(js.includes('总 Token（累计）'), 'chart must include cumulative token trend')
    ctx.assert.ok(js.includes('data-token-range-preset'), 'chart must expose working range shortcuts')
    ctx.assert.ok(js.includes("addEventListener('pointerenter'"), 'chart points must respond to pointer hover')
    ctx.assert.ok(css.includes('.cloud-token-trend-metrics'), 'metric cards must have responsive styling')
    ctx.assert.ok(css.includes('grid-column: 1 / -1'), 'trend panel must span the analytics width')
    ctx.assert.ok(css.includes('var(--settings-glass-bg-strong)'), 'dashboard surfaces must follow theme tokens')
    ctx.assert.ok(css.includes('var(--text-primary)'), 'dashboard typography must follow theme tokens')
    ctx.assert.ok(css.includes('@media (max-width: 760px)'), 'dashboard must retain narrow-layout behavior')
  }
}
