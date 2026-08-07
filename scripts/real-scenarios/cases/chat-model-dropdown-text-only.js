const fs = require('fs')
const path = require('path')

module.exports = {
  id: 'chat-model-dropdown-text-only',
  name: 'chat-model-dropdown-text-only',
  tags: ['model-dropdown', 'model-capabilities', 'chat-models'],
  changedFilePatterns: [
    /^frontend\/scripts\/features\/quick-model-settings\.js$/i,
    /^frontend\/scripts\/features\/models\.js$/i
  ],
  async run(ctx) {
    const source = fs.readFileSync(path.join(ctx.root, 'frontend', 'scripts', 'features', 'quick-model-settings.js'), 'utf8')

    ctx.assert.ok(
      /function\s+isChatSelectableModel\s*\(\s*model\s*\)/.test(source),
      'chat dropdown should have an explicit text-capability filter helper'
    )
    ctx.assert.ok(
      /normalizeCapabilities\?\.\(model\?\.capabilities\)/.test(source),
      'chat dropdown filter should use normalized model capabilities'
    )
    ctx.assert.ok(
      /return\s+capabilities\.text\s*===\s*true/.test(source),
      'chat dropdown should only treat text-capable models as selectable'
    )
    ctx.assert.ok(
      /\.map\(\(model,\s*index\)\s*=>\s*\(\{\s*model,\s*index\s*\}\)\)\s*[\r\n\s]*\.filter\(\(\{\s*model\s*\}\)\s*=>\s*isChatSelectableModel\(model\)\)/.test(source),
      'chat dropdown should filter model refs before source tabs/search while preserving original model indexes'
    )
    ctx.assert.ok(
      source.includes('暂无可聊天的文本模型'),
      'chat dropdown should show a clear empty state when only non-text generation models exist'
    )
  }
}
