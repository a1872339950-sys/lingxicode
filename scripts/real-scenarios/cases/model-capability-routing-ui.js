const fs = require('fs')
const path = require('path')

module.exports = {
  id: 'settings.model-capability-routing-ui',
  title: 'Model capability routing keeps the reference layout and real interactions',
  tags: ['settings', 'models', 'routing', 'ui', 'theme'],
  changedFilePatterns: [
    /^frontend\/index\.html$/i,
    /^frontend\/scripts\/features\/settings-main\.js$/i,
    /^frontend\/styles\/settings\.css$/i
  ],

  async run(ctx) {
    const html = fs.readFileSync(path.join(ctx.root, 'frontend/index.html'), 'utf8')
    const script = fs.readFileSync(path.join(ctx.root, 'frontend/scripts/features/settings-main.js'), 'utf8')
    const css = fs.readFileSync(path.join(ctx.root, 'frontend/styles/settings.css'), 'utf8')

    ctx.assert.ok(html.includes('settings-routing-title-icon'), 'routing page should show the branded title icon')
    ctx.assert.ok(html.includes('id="settingsRoutingSummary"'), 'routing page should expose summary counters')
    ctx.assert.ok(html.indexOf('settingsRoutingSaveBtn') < html.indexOf('settingsRoutingResetBtn'), 'save action should appear before reset')
    ctx.assert.ok(script.includes('const primaryName = routedModels[0]'), 'capability cards should show the current primary model')
    ctx.assert.ok(script.includes('settings-routing-nav-content'), 'capability cards should use the two-row reference structure')
    ctx.assert.ok(script.includes('setupCapabilityRoutingDragSort'), 'model priority must remain draggable')
    ctx.assert.ok(script.includes("showToast('调度设置已保存'"), 'save action must retain feedback')
    ctx.assert.ok(css.includes('Model capability routing reference refresh 2026-07-22'), 'reference layout overrides should be present')
    ctx.assert.ok(css.includes('grid-template-columns: clamp(250px, 27%, 300px) minmax(0, 1fr)'), 'routing workspace should use the reference split layout')
    ctx.assert.ok(css.includes('var(--settings-glass-bg-strong)'), 'routing surfaces should follow active theme tokens')
    ctx.assert.ok(css.includes('@media (max-width: 680px)'), 'routing page should adapt to narrow settings windows')
  }
}
