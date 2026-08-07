const fs = require('fs')
const path = require('path')

module.exports = {
  id: 'settings.feature-categories',
  title: 'Feature settings are grouped, searchable, and filterable',
  tags: ['settings', 'feature-flags', 'ui'],
  changedFilePatterns: [
    /^electron\/modules\/feature-settings\.js$/i,
    /^frontend\/index\.html$/i,
    /^frontend\/scripts\/features\/feature-settings\.js$/i,
    /^frontend\/styles\/settings\.css$/i
  ],

  async run(ctx) {
    const settings = require(path.join(ctx.root, 'electron/modules/feature-settings'))
    const state = settings.getPublicState()
    const catalog = Array.isArray(state.catalog) ? state.catalog : []
    const categories = Array.isArray(state.categories) ? state.categories : []

    ctx.assert.ok(catalog.length > 0, 'feature catalog should not be empty')
    ctx.assert.ok(categories.length > 1, 'feature catalog should expose multiple categories')
    ctx.assert.equal(
      categories.reduce((sum, group) => sum + group.items.length, 0),
      catalog.length,
      'every capability should appear in exactly one category group'
    )
    ctx.assert.equal(
      new Set(categories.map(group => group.category)).size,
      categories.length,
      'category names should be unique'
    )
    for (const group of categories) {
      ctx.assert.ok(group.category, 'category name should not be empty')
      ctx.assert.ok(group.items.length > 0, `category ${group.category} should contain capabilities`)
      ctx.assert.ok(
        group.items.every(item => item.category === group.category),
        `category ${group.category} should only contain matching capabilities`
      )
    }

    const html = fs.readFileSync(path.join(ctx.root, 'frontend/index.html'), 'utf8')
    const script = fs.readFileSync(path.join(ctx.root, 'frontend/scripts/features/feature-settings.js'), 'utf8')
    const css = fs.readFileSync(path.join(ctx.root, 'frontend/styles/settings.css'), 'utf8')
    const categoryCssStart = css.indexOf('.feature-settings-category-tabs {')
    const categoryCssEnd = css.indexOf('.feature-settings-category-tab {', categoryCssStart)
    const categoryCss = css.slice(categoryCssStart, categoryCssEnd)

    ctx.assert.ok(html.includes('id="featureSettingsCategoryTabs"'), 'settings page needs category navigation')
    ctx.assert.ok(html.includes('id="featureSettingsSearchInput"'), 'settings page needs capability search')
    ctx.assert.ok(html.includes('data-feature-status-filter="enabled"'), 'settings page needs enabled filter')
    ctx.assert.ok(html.includes('data-feature-status-filter="disabled"'), 'settings page needs disabled filter')

    ctx.assert.ok(script.includes('function renderCategoryTabs'), 'renderer should build categories from backend state')
    ctx.assert.ok(script.includes('function matchesCurrentFilters'), 'renderer should filter capability content')
    ctx.assert.ok(script.includes("activeCategory = 'all'"), 'renderer should keep an all-categories view')
    ctx.assert.ok(script.includes("statusFilter === 'enabled'"), 'renderer should support enabled-only view')
    ctx.assert.ok(script.includes("statusFilter === 'disabled'"), 'renderer should support disabled-only view')
    ctx.assert.ok(script.includes('renderCategoryTabs(currentState)'), 'state updates should refresh category counts')

    ctx.assert.ok(css.includes('.feature-settings-category-tab.is-active'), 'active category needs a visible style')
    ctx.assert.ok(categoryCss.includes('flex-wrap: wrap'), 'category tabs should wrap instead of exposing a native scrollbar')
    ctx.assert.ok(!categoryCss.includes('overflow-x: auto'), 'category tabs should not create a horizontal scrollbar')
    ctx.assert.ok(css.includes('grid-template-columns: repeat(auto-fit, minmax(310px, 1fr))'), 'capability cards should use a responsive grid')
    ctx.assert.ok(css.includes('@media (max-width: 760px)'), 'capability layout should collapse on narrow windows')
  }
}
