const fs = require('fs')
const path = require('path')

module.exports = {
  id: 'inline-visual.structure',
  title: 'Inline visualization uses semantic kinds and real graph structure',
  tags: ['frontend', 'chat', 'visualization'],
  changedFilePatterns: [
    /^electron\/modules\/inline-visualize\.js$/i,
    /^electron\/modules\/schemas\/inline-visualize\.js$/i,
    /^electron\/modules\/tool-handlers\/inline-visualize\.js$/i,
    /^frontend\/scripts\/features\/(ai-message-ui|inline-visualize-ui)\.js$/i,
    /^frontend\/styles\/chat\.css$/i,
    /^skills\/inline-visual\/SKILL\.md$/i
  ],

  async run(ctx) {
    const storageConfig = require(path.join(ctx.root, 'electron/modules/storage-config'))
    const inlineVisual = require(path.join(ctx.root, 'electron/modules/inline-visualize'))

    ctx.assert.equal(
      inlineVisual.inferVisualKind('diag-priority-map', ''),
      'relation',
      'priority maps must be classified as relation diagrams'
    )
    ctx.assert.equal(
      inlineVisual.inferVisualKind('request flow', ''),
      'flow',
      'plain flow titles must be classified as flow diagrams'
    )

    const cardsOnly = [
      '<section class="card">P0 压缩索引偏移</section>',
      '<section class="card">P1 气泡异常</section>',
      '<section class="card">P1 欢迎页绕过</section>'
    ].join('')
    const invalid = inlineVisual.validateVisualStructure('relation', cardsOnly)
    ctx.assert.equal(invalid.ok, false, 'a stacked card list must not pass as a relation diagram')
    ctx.assert.ok(invalid.error.includes('.viz-node'), 'recovery guidance must name the node contract')
    ctx.assert.equal(
      inlineVisual.validateVisualStructure('flow', '<div class="viz-flow"><div class="viz-node">Only nodes</div></div>').ok,
      false,
      'node styling without an edge contract must still be rejected'
    )

    const graph = [
      '<div class="viz-flow">',
      '<article class="viz-node" data-priority="P0"><strong>压缩索引偏移</strong><small>定位历史窗口</small></article>',
      '<div class="viz-connector"><span>导致</span></div>',
      '<div class="viz-branches">',
      '<article class="viz-branch viz-node" data-priority="P1"><strong>气泡异常</strong><small>正文被污染</small></article>',
      '<article class="viz-branch viz-node" data-priority="P1"><strong>欢迎页绕过</strong><small>插入位置错误</small></article>',
      '</div>',
      '</div>'
    ].join('')
    ctx.assert.equal(
      inlineVisual.validateVisualStructure('relation', graph).ok,
      true,
      'semantic nodes, connectors, and branches must pass validation'
    )

    const workspace = ctx.createWorkspace('inline-visual-structure')
    const originalGetBasePath = storageConfig.getBasePath
    const originalGetProjectDataDir = storageConfig.getProjectDataDir
    try {
      storageConfig.getBasePath = () => workspace.storagePath
      storageConfig.getProjectDataDir = projectId => path.join(workspace.storagePath, 'projects', projectId)
      const saved = inlineVisual.saveVisual({
        projectId: 'visual-project',
        id: 'ignored-on-create',
        title: '三条主链路缺陷关系',
        kind: 'relation',
        html: graph
      })
      ctx.assert.equal(saved.success, true, 'a structured relation diagram must save')
      ctx.assert.equal(saved.kind, 'relation')

      const read = inlineVisual.readVisual({ projectId: 'visual-project', id: saved.id })
      ctx.assert.equal(read.success, true)
      ctx.assert.equal(read.kind, 'relation', 'kind must survive storage and readback')
      ctx.assert.ok(read.html.includes('data-viz-kind="relation"'), 'standalone HTML must expose its semantic kind')
      ctx.assert.ok(read.html.includes('data-viz-contract="2"'), 'standalone HTML must expose the current rendering contract')
      ctx.assert.ok(read.html.includes('.viz-connector'), 'standalone HTML must include the shared connector system')

      const legacyId = 'legacy-priority-map'
      const legacyRoot = path.join(workspace.storagePath, 'visualizations', '_by_id')
      fs.mkdirSync(legacyRoot, { recursive: true })
      fs.writeFileSync(path.join(legacyRoot, `${legacyId}.fragment.html`), cardsOnly, 'utf8')
      fs.writeFileSync(path.join(legacyRoot, `${legacyId}.html`), '<!doctype html><html><body>old cards</body></html>', 'utf8')
      fs.writeFileSync(path.join(legacyRoot, `${legacyId}.json`), JSON.stringify({
        id: legacyId,
        title: 'diag-priority-map'
      }), 'utf8')
      const upgraded = inlineVisual.readVisual({ id: legacyId })
      ctx.assert.equal(upgraded.kind, 'relation', 'legacy priority maps must infer their semantic kind')
      ctx.assert.ok(upgraded.html.includes('data-viz-contract="2"'), 'legacy visuals must be upgraded at read time')
      ctx.assert.ok(
        upgraded.html.includes('html[data-viz-kind="relation"] #viz-root > .card > .viz-grid'),
        'legacy relation card lists must receive the compatibility relationship layout'
      )
    } finally {
      storageConfig.getBasePath = originalGetBasePath
      storageConfig.getProjectDataDir = originalGetProjectDataDir
      workspace.cleanup()
    }

    const ui = fs.readFileSync(path.join(ctx.root, 'frontend/scripts/features/inline-visualize-ui.js'), 'utf8')
    const messageUi = fs.readFileSync(path.join(ctx.root, 'frontend/scripts/features/ai-message-ui.js'), 'utf8')
    const skill = fs.readFileSync(path.join(ctx.root, 'skills/inline-visual/SKILL.md'), 'utf8')
    ctx.assert.ok(ui.includes("relation: { label: '关系图'"), 'toolbar must label relation diagrams semantically')
    ctx.assert.ok(ui.includes("diagram: { label: '可视化'"), 'unknown legacy visuals must use a neutral label')
    ctx.assert.ok(messageUi.includes('lingxi-inline-vis-kind-icon'), 'initial placeholder must reserve the kind icon')
    ctx.assert.ok(skill.includes('不要把普通卡片列表命名为“流程图”'), 'generation guidance must explicitly reject fake flowcharts')
    ctx.assert.ok(skill.includes('.viz-connector'), 'generation guidance must require the shared edge contract')
  }
}
