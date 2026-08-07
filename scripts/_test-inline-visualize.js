const { MODEL_TOOLS_SCHEMA } = require('../electron/modules/schemas')
const iv = require('../electron/modules/inline-visualize')
const reg = require('../electron/modules/tool-registry')
const featureSettings = require('../electron/modules/feature-settings')

const names = MODEL_TOOLS_SCHEMA.map(t => t.function && t.function.name)
console.log('tool in schema', names.includes('create_inline_visual'))
console.log('handler', reg.hasToolHandler('create_inline_visual'))
console.log('feature on', featureSettings.isFeatureEnabled('inline_visualize'))

const html = [
  '<div id="demo" class="card">',
  '<strong>Hello Viz</strong>',
  '<button class="btn" id="b">Go</button>',
  '<script>document.getElementById("b").onclick=function(){this.textContent="ok"}</script>',
  '</div>'
].join('')

const saved = iv.saveVisual({
  projectId: 'test-vis-project',
  title: 'demo-chart',
  html
})
console.log('save', saved.success, saved.directive)

const loaded = iv.readVisual({ projectId: 'test-vis-project', id: saved.id })
const loadedHtml = loaded.html || ''
console.log('read', loaded.success, loadedHtml.includes('Hello Viz'), loadedHtml.includes('Content-Security-Policy'))
console.log('theme dark default', loadedHtml.includes('data-viz-theme="dark"'), !loadedHtml.includes('light-dark('))
console.log('theme tokens', loadedHtml.includes('--on-series'), loadedHtml.includes('lingxi-vis-theme'))

const blocked = iv.saveVisual({
  projectId: 'test-vis-project',
  title: 'evil',
  html: '<script src="https://evil.example.com/x.js"></script><div>x</div>'
})
console.log('blocked host still saves?', blocked.success, (blocked.path && require('fs').readFileSync(blocked.path, 'utf8').includes('evil.example')) === false)

// handler path
const handlers = require('../electron/modules/tool-handlers/inline-visualize').handlers
handlers.create_inline_visual({ html, title: 'via-handler' }, { projectId: 'test-vis-project' })
  .then(r => {
    console.log('handler ok', r.success, !!r.directive)
    console.log('ALL DONE')
  })
  .catch(err => {
    console.error(err)
    process.exit(1)
  })
