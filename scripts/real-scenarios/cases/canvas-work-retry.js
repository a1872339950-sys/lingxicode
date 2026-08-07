const path = require('path')

async function waitFor(check, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const value = check()
    if (value) return value
    await new Promise(resolve => setTimeout(resolve, 20))
  }
  return null
}

module.exports = {
  id: 'canvas-work-retry',
  title: 'A failed canvas work retries independently without rerunning completed work',
  tags: ['canvas', 'workflow', 'agent-collaboration', 'retry'],
  changedFilePatterns: [
    /^electron\/modules\/agent-collaboration\.js$/i,
    /^electron\/preload\.js$/i,
    /^frontend\/scripts\/canvas-view\.js$/i,
    /^frontend\/scripts\/features\/canvas-inspector\.js$/i
  ],

  async run(ctx) {
    const modulePaths = {
      projects: require.resolve(path.join(ctx.root, 'electron/modules/projects')),
      config: require.resolve(path.join(ctx.root, 'electron/modules/config')),
      reports: require.resolve(path.join(ctx.root, 'electron/modules/agent-collaboration-reports')),
      runner: require.resolve(path.join(ctx.root, 'electron/modules/agent-sub-runner')),
      collaboration: require.resolve(path.join(ctx.root, 'electron/modules/agent-collaboration'))
    }
    const originals = new Map(Object.values(modulePaths).map(filePath => [filePath, require.cache[filePath]]))
    const calls = new Map()
    const setStub = (filePath, exports) => {
      require.cache[filePath] = { id: filePath, filename: filePath, loaded: true, exports }
    }

    try {
      setStub(modulePaths.projects, {
        createCollaborationChatInstance: async () => ({ projectId: 'child', reportFilePath: '' }),
        createTemporaryAgentChatInstance: async () => ({ projectId: 'child', reportFilePath: '' }),
        getProjectInstance: () => ({ projectPath: ctx.root }),
        getWebContentsForProject: () => null
      })
      setStub(modulePaths.config, { getMainWindow: () => null })
      setStub(modulePaths.reports, {
        cleanupReports: () => {},
        ensureReportsDir: () => ctx.root,
        getAgentReportFilePath: (session, agent) => path.join(ctx.root, `${session.id}-${agent.id}.md`),
        writeAgentReport: (session, agent) => ({
          fileName: `${session.id}-${agent.id}.md`,
          filePath: path.join(ctx.root, `${session.id}-${agent.id}.md`)
        })
      })
      setStub(modulePaths.runner, {
        runAgentSession: async options => {
          const agentId = options.agent.id
          const count = (calls.get(agentId) || 0) + 1
          calls.set(agentId, count)
          if (agentId === 'work-fail' && count === 1) throw new Error('intentional first attempt failure')
          return { agentId, content: `${agentId} completed on attempt ${count}`, toolCalls: [], durationMs: 1 }
        }
      })
      delete require.cache[modulePaths.collaboration]
      const collaboration = require(modulePaths.collaboration)
      const modelConfig = { apiUrl: 'http://scenario.invalid/v1', modelId: 'scenario-model' }
      const started = await collaboration.startSession('project-retry', {
        executionKind: 'workflow',
        mode: 'workflow',
        workflow: { id: 'workflow-retry', nodes: [], edges: [] },
        agents: [
          { id: 'work-fail', nodeId: 'work-fail', name: 'Fail once', task: 'retry me', modelConfig },
          { id: 'work-done', nodeId: 'work-done', name: 'Stay done', task: 'run once', modelConfig }
        ]
      })
      const sessionId = started.session.id
      const failedSession = await waitFor(() => {
        const session = collaboration.getSession('project-retry', sessionId)
        return session?.agents?.find(agent => agent.id === 'work-fail')?.status === 'error' ? session : null
      })
      ctx.assert.ok(failedSession, 'the first work attempt should fail')
      ctx.assert.equal(calls.get('work-done'), 1, 'the successful sibling should run once')

      const accepted = collaboration.retryAgent('project-retry', sessionId, 'work-fail')
      ctx.assert.equal(accepted.success, true, accepted.error || 'retry should be accepted')
      const completedSession = await waitFor(() => {
        const session = collaboration.getSession('project-retry', sessionId)
        return session?.agents?.find(agent => agent.id === 'work-fail')?.status === 'done' ? session : null
      })
      ctx.assert.ok(completedSession, 'the failed work should complete after retry')
      const retried = completedSession.agents.find(agent => agent.id === 'work-fail')
      ctx.assert.equal(retried.retryCount, 1, 'retry count should be retained')
      ctx.assert.equal(retried.retryHistory.length, 1, 'the failed attempt should remain available as history')
      ctx.assert.equal(calls.get('work-fail'), 2, 'only the failed work should execute a second time')
      ctx.assert.equal(calls.get('work-done'), 1, 'completed work must not rerun')
    } finally {
      for (const [filePath, cached] of originals) {
        if (cached) require.cache[filePath] = cached
        else delete require.cache[filePath]
      }
    }
  }
}
