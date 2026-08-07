async function createChildRuntimes(options = {}) {
  const {
    agents = [],
    mode = 'parallel',
    executionKind = '',
    projectId = '',
    sessionId = '',
    fallbackModelConfig = null,
    coordinationNote = '',
    createChat,
    releaseSession,
    buildPrompt
  } = options
  if (typeof createChat !== 'function') throw new Error('createChat is required')

  try {
    return await Promise.all(agents.map(async (agent, index) => {
      const effectiveAgent = {
        ...agent,
        modelConfig: agent.modelConfig || fallbackModelConfig || null,
        modelName: agent.modelName || fallbackModelConfig?.modelName || fallbackModelConfig?.displayName || fallbackModelConfig?.modelId || ''
      }
      const chat = await createChat(projectId, sessionId, effectiveAgent)
      const reportFilePath = chat.reportFilePath || chat.instance?.collaborationReportFilePath || ''
      return {
        ...effectiveAgent,
        chatProjectId: chat.projectId,
        reportFilePath,
        reportFileName: reportFilePath ? String(reportFilePath).split(/[\\/]/).pop() : '',
        autoStartMessage: buildPrompt?.({
          sessionId,
          projectId,
          executionKind,
          coordinationNote,
          reportFilePath,
          agent: effectiveAgent
        }) || '',
        status: mode === 'parallel' || (mode === 'serial' && index === 0) ? 'running' : 'waiting'
      }
    }))
  } catch (error) {
    await Promise.resolve(releaseSession?.(sessionId)).catch(() => {})
    throw error
  }
}

module.exports = { createChildRuntimes }
