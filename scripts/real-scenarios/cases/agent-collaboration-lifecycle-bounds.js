const fs = require('fs')
const path = require('path')

module.exports = {
  id: 'agent-collaboration.lifecycle-bounds',
  title: 'Completed collaboration sessions and runtime events remain bounded',
  tags: ['agent-collaboration', 'lifecycle', 'performance'],
  changedFilePatterns: [
    /^electron\/modules\/agent-collaboration(?:-lifecycle|-reports|-child-runtimes)?\.js$/i,
    /^electron\/modules\/projects\.js$/i,
    /^frontend\/scripts\/features\/agent-collaboration(?:-lifecycle|-ui)?\.js$/i
  ],

  async run(ctx) {
    const lifecycle = require(path.join(ctx.root, 'electron/modules/agent-collaboration-lifecycle'))
    const childRuntimes = require(path.join(ctx.root, 'electron/modules/agent-collaboration-child-runtimes'))
    const agent = {
      thinking: Array.from({ length: 260 }, (_, index) => ({ id: `thinking-${index}`, createdAt: index })),
      tools: Array.from({ length: 260 }, (_, index) => ({ id: `tool-${index}`, createdAt: index + 0.5 }))
    }
    const trimmed = lifecycle.trimAgentEvents(agent)
    ctx.assert.equal(trimmed.thinking.length + trimmed.tools.length, lifecycle.MAX_AGENT_EVENTS, 'runtime event memory should have a single total cap')

    const sessions = new Map()
    for (let index = 0; index < 100; index++) {
      const session = {
        id: `session-${index}`,
        projectId: 'project-lifecycle',
        status: 'completed',
        updatedAt: index,
        agents: [{ content: 'x'.repeat(5000), thinking: agent.thinking, tools: agent.tools }],
        reports: []
      }
      sessions.set(session.id, session)
      lifecycle.retainCompletedSession(sessions, session)
    }
    ctx.assert.equal(sessions.size, lifecycle.MAX_COMPLETED_SESSIONS_PER_PROJECT, 'completed sessions should be pruned by project quota before TTL')
    ctx.assert.ok([...sessions.values()].every(session => session.agents[0].content.length <= 2000), 'completed sessions should release large response text')

    for (const sessionId of [...sessions.keys()]) lifecycle.deleteSession(sessions, sessionId)
    ctx.assert.equal(lifecycle.getStats(sessions).cleanupTimers, 0, 'session cleanup should release its timers')

    let releasedSessionId = ''
    let creationError = null
    try {
      await childRuntimes.createChildRuntimes({
        agents: [{ id: 'created' }, { id: 'fails' }],
        projectId: 'project-lifecycle',
        sessionId: 'partially-created-session',
        createChat: async (projectId, sessionId, runtimeAgent) => {
          if (runtimeAgent.id === 'fails') throw new Error('intentional child creation failure')
          return { projectId: `${projectId}:${runtimeAgent.id}` }
        },
        releaseSession: async sessionId => { releasedSessionId = sessionId }
      })
    } catch (error) {
      creationError = error
    }
    ctx.assert.ok(creationError, 'partial child creation should preserve the original failure')
    ctx.assert.equal(releasedSessionId, 'partially-created-session', 'partial child creation should release every child by session ID')

    const frontendLifecycle = fs.readFileSync(path.join(ctx.root, 'frontend/scripts/features/agent-collaboration-lifecycle.js'), 'utf8')
    const frontendUi = fs.readFileSync(path.join(ctx.root, 'frontend/scripts/features/agent-collaboration-ui.js'), 'utf8')
    ctx.assert.ok(/const MAX_AGENT_EVENTS = 200/.test(frontendLifecycle), 'frontend event state should use the same bounded event policy')
    ctx.assert.ok(/sessionJanitor\?\.track\?\.\(mergedSession\)/.test(frontendUi), 'frontend session snapshots should enter lifecycle governance')
    ctx.assert.ok(/if \(!isDone\(session\.status\)\) createHeadlessChatRuntimes\(session\)/.test(frontendUi), 'terminal snapshots must not recreate released headless runtimes')
  }
}
