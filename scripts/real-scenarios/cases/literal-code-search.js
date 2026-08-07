const path = require('path')

module.exports = {
  id: 'literal-code-search.contract',
  title: 'Code location uses model-provided literal terms without semantic expansion',
  tags: ['tools', 'code-location', 'literal-search'],
  changedFilePatterns: [
    /^electron\/modules\/literal-code-search\.js$/i,
    /^electron\/modules\/change-planner\.js$/i,
    /^electron\/modules\/tool-handlers\/search\.js$/i
  ],

  async run(ctx) {
    const workspace = ctx.createWorkspace(this.id)
    const { handlers } = require(path.join(ctx.root, 'electron/modules/tool-handlers/search'))
    const changePlanner = require(path.join(ctx.root, 'electron/modules/change-planner'))

    try {
      ctx.writeText(path.join(workspace.projectPath, 'frontend', 'project-history.js'), [
        'function openProjectHistoryPanel() {',
        "  return document.getElementById('btnProjectHistory')",
        '}',
        'openProjectHistoryPanel()'
      ].join('\n'))
      ctx.writeText(path.join(workspace.projectPath, 'frontend', 'unrelated.js'), [
        '// 用户说点击项目以后历史消息不对，但这里没有目标符号',
        'function unrelatedHistoryCode() {}'
      ].join('\n'))

      const result = await handlers.locate_code({
        query: '点击项目以后历史消息不对，请自动理解中文需求',
        terms: ['btnProjectHistory', 'openProjectHistoryPanel'],
        limit: 10
      }, {
        projectPath: workspace.projectPath,
        projectId: 'literal-search-test'
      })

      ctx.assert.equal(result.success, true, result.error || 'literal locate should succeed')
      ctx.assert.deepEqual(result.terms, ['btnProjectHistory', 'openProjectHistoryPanel'], 'explicit terms must be authoritative')
      ctx.assert.ok(result.evidenceFiles.some(item => item.path === 'frontend/project-history.js'), 'literal terms should locate the implementation')
      ctx.assert.equal(result.evidenceFiles.some(item => item.path === 'frontend/unrelated.js'), false, 'natural-language query text must not be mixed into explicit terms')

      const impact = await changePlanner.analyzeImpact({
        projectPath: workspace.projectPath,
        symbols: ['openProjectHistoryPanel'],
        limit: 20
      })
      ctx.assert.equal(impact.success, true, impact.error || 'impact analysis should await literal search')
      ctx.assert.ok(impact.affectedFiles.some(item => item.path === 'frontend/project-history.js'), 'impact analysis should return symbol references')

      const references = await handlers.find_references({
        symbol: 'openProjectHistoryPanel',
        include_definitions: true
      }, {
        projectPath: workspace.projectPath,
        projectId: 'literal-search-test'
      })
      ctx.assert.equal(references.success, true, references.error || 'find_references should await impact analysis')
      ctx.assert.ok(references.definitions.some(item => item.path === 'frontend/project-history.js'), 'find_references should preserve definition evidence')
    } finally {
      workspace.cleanup()
    }
  }
}
