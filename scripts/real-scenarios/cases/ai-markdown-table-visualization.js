const fs = require('fs')
const path = require('path')

module.exports = {
  id: 'ai-markdown-table-visualization',
  title: 'AI final content: robust Markdown tables and automatic visualization choice',
  tags: ['frontend', 'chat', 'markdown', 'visualization'],
  changedFilePatterns: [
    /^frontend\/scripts\/features\/(markdown-table-parser|ai-message-ui)\.js$/i,
    /^frontend\/styles\/chat\.css$/i,
    /^frontend\/index\.html$/i,
    /^electron\/modules\/(skills|feature-settings)\.js$/i,
    /^skills\/inline-visual\/SKILL\.md$/i
  ],

  async run(ctx) {
    const parser = require(path.join(ctx.root, 'frontend/scripts/features/markdown-table-parser'))
    const input = [
      '前面的说明没有强制空一行。',
      '项目 | 完成率 | 备注',
      ':--- | ---: | :---:',
      'A | 35% | 正常',
      'B | 80% | 含有\\|竖线',
      '表格后的正文也没有强制空一行。'
    ].join('\n')
    const extracted = parser.extractTables(input)
    ctx.assert.equal(extracted.tables.length, 1, 'a valid GFM table must be recognized without surrounding blank lines')
    ctx.assert.ok(extracted.content.includes('\u0000MTB0\u0000'), 'table must be replaced by a stable structured placeholder')
    ctx.assert.ok(extracted.content.includes('前面的说明'))
    ctx.assert.ok(extracted.content.includes('表格后的正文'))
    ctx.assert.deepEqual(extracted.tables[0].header, ['项目', '完成率', '备注'])
    ctx.assert.deepEqual(extracted.tables[0].alignments, ['left', 'right', 'center'])
    ctx.assert.equal(extracted.tables[0].rows[1][2], '含有|竖线', 'escaped cell pipes must not split the column')

    const chart = parser.getChartModel(extracted.tables[0])
    ctx.assert.ok(chart, 'numeric comparison tables must expose a chart model')
    ctx.assert.equal(chart.series.length, 1)
    ctx.assert.deepEqual(chart.series[0].values, [35, 80])

    const textOnly = parser.extractTables('项目 | 说明\n--- | ---\nA | 正常\nB | 完成').tables[0]
    ctx.assert.equal(parser.getChartModel(textOnly), null, 'plain text comparison tables must stay tables instead of decorative charts')

    const index = fs.readFileSync(path.join(ctx.root, 'frontend/index.html'), 'utf8')
    const ui = fs.readFileSync(path.join(ctx.root, 'frontend/scripts/features/ai-message-ui.js'), 'utf8')
    const css = fs.readFileSync(path.join(ctx.root, 'frontend/styles/chat.css'), 'utf8')
    const parserIndex = index.indexOf('markdown-table-parser.js')
    const messageUiIndex = index.indexOf('ai-message-ui.js')
    ctx.assert.ok(parserIndex >= 0 && parserIndex < messageUiIndex, 'table parser must load before AI message rendering')
    ctx.assert.ok(ui.includes('renderStructuredMarkdownTable'), 'final content renderer must use structured tables')
    ctx.assert.ok(ui.includes('data-ai-table-view="chart"'), 'numeric tables must provide a chart view')
    ctx.assert.ok(css.includes('.ai-table-chart-bar'), 'chart view must have responsive visual styles')

    const featureSettings = require(path.join(ctx.root, 'electron/modules/feature-settings'))
    const skills = require(path.join(ctx.root, 'electron/modules/skills'))
    const originalIsFeatureEnabled = featureSettings.isFeatureEnabled
    try {
      featureSettings.isFeatureEnabled = id => id === 'inline_visualize'
      const autoPrompt = skills.buildAutoAttachedSkillPrompt('请简单回答今天星期几')
      ctx.assert.ok(autoPrompt.includes('对话内嵌可视化'), 'visual decision guidance must be available without explicit user skill selection')
      ctx.assert.ok(autoPrompt.includes('不得为了填满正文空白'), 'automatic choice must reject decorative visualization')
    } finally {
      featureSettings.isFeatureEnabled = originalIsFeatureEnabled
    }
  }
}
