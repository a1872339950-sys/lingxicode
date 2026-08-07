const fs = require('fs')
const os = require('os')
const path = require('path')

module.exports = {
  id: 'ui-root-cause-hidden-display',
  title: 'UI root-cause tracer detects display:none not restored by show class',
  tags: ['ui', 'diagnostics', 'css'],
  changedFilePatterns: [
    /^electron\/modules\/ui-root-cause-tracer\.js$/i
  ],

  async run(ctx) {
    const { traceUiRootCause } = require(path.join(ctx.root, 'electron/modules/ui-root-cause-tracer'))
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lingxi-ui-root-cause-'))
    try {
      fs.mkdirSync(path.join(root, 'frontend', 'scripts'), { recursive: true })
      fs.mkdirSync(path.join(root, 'frontend', 'styles'), { recursive: true })

      fs.writeFileSync(path.join(root, 'frontend', 'index.html'), `
<div class="chat-input-area">
  <div class="model-dropdown" id="modelDropdown">
    <button id="modelTrigger">model</button>
    <div class="model-dropdown-menu" id="modelMenu">menu</div>
  </div>
</div>
`, 'utf8')

      fs.writeFileSync(path.join(root, 'frontend', 'scripts', 'quick-model-settings.js'), `
const modelDropdown = document.getElementById('modelDropdown')
const modelTrigger = document.getElementById('modelTrigger')
modelTrigger.onclick = event => {
  event.stopPropagation()
  modelDropdown.classList.toggle('show')
}
`, 'utf8')

      fs.writeFileSync(path.join(root, 'frontend', 'styles', 'modals.css'), `
.model-dropdown-menu {
  display: none;
}
.model-dropdown-menu.show {
  display: block;
}
`, 'utf8')

      fs.writeFileSync(path.join(root, 'frontend', 'styles', 'glass-liquid.css'), `
.chat-input-area .model-dropdown.show .model-dropdown-menu {
  opacity: 1;
  visibility: visible;
  pointer-events: auto;
}
`, 'utf8')

      const result = traceUiRootCause(root, {
        query: 'model dropdown cannot open display none',
        files: ['frontend/scripts/quick-model-settings.js']
      })

      ctx.assert.equal(result.quality.level, 'root-cause-candidate', 'tracer should produce a root-cause candidate')
      ctx.assert.ok(
        result.chains.some(chain =>
          chain.issues.some(issue =>
            issue.type === 'hidden-property-not-restored' &&
            issue.affected === '.model-dropdown-menu' &&
            issue.missing.includes('display')
          )
        ),
        'expected hidden-property-not-restored for .model-dropdown-menu display'
      )
    } finally {
      try { fs.rmSync(root, { recursive: true, force: true }) } catch (_) { /* ignore */ }
    }
  }
}
