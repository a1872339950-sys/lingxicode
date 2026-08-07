const fs = require('fs')
const path = require('path')

module.exports = {
  id: 'temporary-agent.ui-performance',
  title: 'Temporary agent tool updates avoid heavy payloads and dock rebuilds',
  tags: ['ui', 'performance', 'agent-collaboration'],
  changedFilePatterns: [
    /^electron\/modules\/agent-collaboration\.js$/i,
    /^frontend\/scripts\/features\/agent-collaboration-ui\.js$/i
  ],

  async run(ctx) {
    const backend = fs.readFileSync(path.join(ctx.root, 'electron/modules/agent-collaboration.js'), 'utf8')
    const frontend = fs.readFileSync(path.join(ctx.root, 'frontend/scripts/features/agent-collaboration-ui.js'), 'utf8')

    ctx.assert.ok(
      /function compactPublicEvent\(event = \{\}, options = \{\}\)/.test(backend),
      'backend should compact temporary agent public events before sending session snapshots'
    )
    ctx.assert.ok(
      /publicAgent\.tools = \(Array\.isArray\(publicAgent\.tools\) \? publicAgent\.tools : \[\]\)\.slice\(-20\)\.map/.test(backend),
      'temporary public session snapshots should keep only recent compact tool events'
    )
    ctx.assert.ok(
      /const temporaryExecution = session\.temporaryExecution === true \|\| session\.executionKind === 'temporary_chat'/.test(backend),
      'public session serialization should detect temporary sessions explicitly'
    )

    ctx.assert.ok(
      /function syncTempAgentIcons\(session = \{\}\)/.test(frontend),
      'frontend should synchronize the temporary agent dock instead of rebuilding it on every session event'
    )
    const sessionListenerBlock = frontend.slice(frontend.indexOf('window.api?.onAgentCollaborationSession'), frontend.indexOf('function renderSession', frontend.indexOf('window.api?.onAgentCollaborationSession')))
    ctx.assert.ok(
      /syncTempAgentIcons\(session\)/.test(sessionListenerBlock),
      'temporary session updates should call syncTempAgentIcons'
    )
    ctx.assert.ok(
      !/clearTempAgentIcons\(\)\s+createTempAgentIcons\(session\)/.test(sessionListenerBlock),
      'temporary session updates should not clear and recreate icons repeatedly'
    )
    ctx.assert.ok(
      /function compactRuntimeToolResult\(result = \{\}\)/.test(frontend),
      'headless temporary runtimes should store compact tool result summaries'
    )
  }
}
