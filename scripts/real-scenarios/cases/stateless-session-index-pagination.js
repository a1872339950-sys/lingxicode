const fs = require('fs')
const path = require('path')

module.exports = {
  id: 'stateless-session.index-pagination',
  title: 'Temporary session list stays metadata-only and loads on scroll',
  tags: ['stateless', 'pagination', 'performance'],
  changedFilePatterns: [
    /^electron\/modules\/projects\.js$/i,
    /^frontend\/scripts\/features\/stateless-sessions\.js$/i
  ],

  async run(ctx) {
    const backend = fs.readFileSync(path.join(ctx.root, 'electron/modules/projects.js'), 'utf8')
    const frontend = fs.readFileSync(path.join(ctx.root, 'frontend/scripts/features/stateless-sessions.js'), 'utf8')
    const loadBlock = frontend.slice(frontend.indexOf('async function loadSessions'), frontend.indexOf('async function openPopover'))

    ctx.assert.ok(/const PAGE_SIZE = 30/.test(frontend), 'temporary session UI should request bounded pages')
    ctx.assert.ok(!/await loadSessions\(\{ reset: false \}\)/.test(loadBlock), 'one list request must not recursively fetch every remaining page')
    ctx.assert.ok(/els\.list\.addEventListener\('scroll'/.test(frontend), 'older temporary sessions should load only when the list reaches its boundary')
    ctx.assert.ok(/query: requestedQuery/.test(loadBlock), 'search should be handled by the paged backend index')
    ctx.assert.ok(/\.map\(\(\{ storagePath, \.\.\.metadata \}\) => metadata\)/.test(backend), 'list payload should omit managed storage paths and return metadata only')
    ctx.assert.ok(/lastMessageSummary/.test(backend), 'temporary session index should retain a compact final message summary')
  }
}
