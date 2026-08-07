const crypto = require('crypto')
const projects = require('./projects')
const config = require('./config')
const reportStore = require('./agent-collaboration-reports')
const lifecycle = require('./agent-collaboration-lifecycle')
const childRuntimes = require('./agent-collaboration-child-runtimes')
const agentWorkflows = require('./agent-workflows')
const {
  summarizeSession,
  buildAgentError,
  isRunningAgentStatus
} = require('./agent-collaboration-status')
const { runAgentSession } = require('./agent-sub-runner')

const sessions = new Map()
const pendingRequests = new Map()
const activeAgentRetries = new Set()
let ipcRegistered = false

const COLLAB_MODES = new Set(['single', 'serial', 'parallel', 'workflow'])
const REQUEST_TIMEOUT_MS = 30 * 60 * 1000
const MAX_CHILD_AGENTS = 2
const MAX_TEMP_AGENT_CHATS = 10
const MAX_WORKFLOW_AGENTS = 8

function createId(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}`
}

function logCollab(...args) {
  console.log('[AgentCollab]', ...args)
}

function normalizeMode(mode) {
  const value = String(mode || '').trim()
  return COLLAB_MODES.has(value) ? value : 'serial'
}

function getAgentLimit(executionKind = '') {
  if (executionKind === 'workflow') return MAX_WORKFLOW_AGENTS
  if (executionKind === 'temporary_chat') return MAX_TEMP_AGENT_CHATS
  return MAX_CHILD_AGENTS
}

function normalizePlanSteps(steps = []) {
  return (Array.isArray(steps) ? steps : [])
    .slice(0, 64)
    .map((step, index) => {
      if (typeof step === 'string') {
        return { id: `step-${index + 1}`, title: step.slice(0, 500), status: index === 0 ? 'active' : 'pending' }
      }
      return {
        id: String(step.id || `step-${index + 1}`).slice(0, 100),
        title: String(step.title || step.name || step.task || `步骤 ${index + 1}`),
        detail: String(step.detail || step.description || '').slice(0, 4000),
        status: String(step.status || (index === 0 ? 'active' : 'pending')).slice(0, 40)
      }
    })
    .map(step => ({ ...step, title: String(step.title || '').slice(0, 500) }))
    .filter(step => step.title.trim())
}

function boundStructuredEventValue(value, maxChars = 30000) {
  if (!value || typeof value !== 'object') return null
  try {
    const serialized = JSON.stringify(value)
    if (serialized.length <= maxChars) return value
    return { truncated: true, summary: serialized.slice(0, maxChars) }
  } catch {
    return { truncated: true, summary: '[unserializable event payload]' }
  }
}

function normalizeEvent(event = {}, fallbackId = 'event') {
  if (typeof event === 'string') {
    return { id: fallbackId, type: 'status', title: event.slice(0, 500), content: event.slice(0, 30000), createdAt: Date.now() }
  }
  const normalized = {
    id: String(event.id || fallbackId).slice(0, 160),
    type: String(event.type || 'status').slice(0, 80),
    title: String(event.title || event.name || event.status || '状态更新'),
    name: String(event.name || event.title || '').slice(0, 500),
    content: String(event.content || event.text || event.message || event.detail || '').slice(0, 30000),
    args: boundStructuredEventValue(event.args),
    result: boundStructuredEventValue(event.result),
    toolCallId: String(event.toolCallId || event.tool_call_id || '').slice(0, 200),
    status: String(event.status || '').slice(0, 80),
    createdAt: Number(event.createdAt || event.time || Date.now())
  }
  normalized.title = String(normalized.title || '').slice(0, 500)
  return normalized
}

function normalizeAgent(agent = {}, index = 0) {
  const thinking = Array.isArray(agent.thinking) ? agent.thinking : (Array.isArray(agent.thoughts) ? agent.thoughts : [])
  const tools = Array.isArray(agent.tools) ? agent.tools : (Array.isArray(agent.toolCalls) ? agent.toolCalls : [])
  return lifecycle.trimAgentEvents({
    id: String(agent.id || `agent-${index + 1}`),
    name: String(agent.name || agent.role || `AI ${index + 1}`).slice(0, 120),
    role: String(agent.role || agent.name || `AI ${index + 1}`).slice(0, 120),
    task: String(agent.task || agent.task_description || agent.description || '').slice(0, 12000),
    modelKey: String(agent.modelKey || agent.model_key || '').slice(0, 180),
    modelName: String(agent.modelName || agent.model_name || '').slice(0, 180),
    modelConfig: agent.modelConfig && typeof agent.modelConfig === 'object' ? agent.modelConfig : null,
    nodeId: String(agent.nodeId || agent.node_id || agent.id || `agent-${index + 1}`),
    dependsOn: Array.isArray(agent.dependsOn) ? [...new Set(agent.dependsOn.map(String).filter(Boolean))] : [],
    upstreamContext: String(agent.upstreamContext || '').slice(0, 30000),
    chatProjectId: String(agent.chatProjectId || agent.chat_project_id || ''),
    autoStartMessage: String(agent.autoStartMessage || agent.auto_start_message || ''),
    autoStarted: agent.autoStarted === true,
    focusPaths: (Array.isArray(agent.focusPaths) ? agent.focusPaths : (Array.isArray(agent.writeScope) ? agent.writeScope : [])).slice(0, 64).map(item => String(item).slice(0, 1000)),
    status: agent.status || 'waiting',
    statusText: String(agent.statusText || '').slice(0, 2000),
    content: String(agent.content || agent.finalContent || '').slice(-50000),
    error: agent.error && typeof agent.error === 'object' ? agent.error : null,
    partialReport: agent.partialReport && typeof agent.partialReport === 'object' ? agent.partialReport : null,
    reportFileName: String(agent.reportFileName || agent.report_file_name || '').slice(0, 260),
    reportFilePath: String(agent.reportFilePath || agent.report_file_path || '').slice(0, 2000),
    elapsedMs: Number(agent.elapsedMs) || 0,
    startedAt: Number(agent.startedAt || 0),
    completedAt: Number(agent.completedAt || 0),
    retryCount: Math.max(0, Number(agent.retryCount || agent.retry_count || 0)),
    lastRetriedAt: Number(agent.lastRetriedAt || agent.last_retried_at || 0),
    retryHistory: Array.isArray(agent.retryHistory) ? agent.retryHistory.slice(-5) : [],
    plan: normalizePlanSteps(agent.plan || agent.steps || []),
    thinking: thinking.map((item, itemIndex) => normalizeEvent(item, `thinking-${itemIndex + 1}`)),
    tools: tools.map((item, itemIndex) => normalizeEvent(item, `tool-${itemIndex + 1}`))
  })
}

function compactPublicText(value = '', maxLength = 900) {
  const text = String(value || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/[#>*_`|~]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (!text || text.length <= maxLength) return text
  const limited = text.slice(0, maxLength)
  const sentenceEnd = Math.max(
    limited.lastIndexOf('。'),
    limited.lastIndexOf('！'),
    limited.lastIndexOf('？'),
    limited.lastIndexOf('.'),
    limited.lastIndexOf('!'),
    limited.lastIndexOf('?')
  )
  if (sentenceEnd >= Math.floor(maxLength * 0.45)) return limited.slice(0, sentenceEnd + 1).trim()
  return `${limited.trimEnd()}。`
}

function compactPublicEvent(event = {}, options = {}) {
  const compact = {
    ...event,
    content: compactPublicText(event.content, options.contentLimit || 260)
  }
  if (compact.args && typeof compact.args === 'object') {
    compact.args = {
      summary: compactPublicText(JSON.stringify(compact.args), options.argsLimit || 240)
    }
  }
  if (compact.result && typeof compact.result === 'object') {
    compact.result = {
      success: compact.result.success,
      error: compact.result.error,
      status: compact.result.status,
      path: compact.result.path,
      message: compactPublicText(compact.result.message || compact.result.error || '', 220)
    }
  }
  return compact
}

function toPublicAgent(agent = {}, options = {}) {
  const { modelConfig, abortController, upstreamContext, ...publicAgent } = agent || {}
  if (modelConfig && typeof modelConfig === 'object') {
    publicAgent.modelName = publicAgent.modelName || modelConfig.modelName || modelConfig.displayName || modelConfig.modelId || ''
    publicAgent.modelKey = publicAgent.modelKey || modelConfig.modelKey || modelConfig.id || modelConfig.key || ''
    publicAgent.modelConfig = modelConfig
  }
  publicAgent.thinking = (Array.isArray(publicAgent.thinking) ? publicAgent.thinking : []).map(event => {
    if (!['reasoning_delta', 'reasoning_final'].includes(String(event?.type || ''))) return event
    return {
      ...event,
      content: compactPublicText(event.content, 900)
    }
  })
  if (options.temporaryExecution) {
    publicAgent.thinking = publicAgent.thinking.slice(-12).map(event => compactPublicEvent(event, { contentLimit: 320 }))
    publicAgent.tools = (Array.isArray(publicAgent.tools) ? publicAgent.tools : []).slice(-20).map(event => compactPublicEvent(event, {
      contentLimit: 220,
      argsLimit: 220
    }))
  }
  if (publicAgent.reportFilePath) {
    publicAgent.reportFileName = publicAgent.reportFileName || String(publicAgent.reportFilePath).split(/[\\/]/).pop()
  }
  return publicAgent
}

function buildAgentChatPrompt(session, agent) {
  return [
    `你是右侧多会话窗口中的独立 AI：${agent.name || agent.role || agent.id}。`,
    `你的角色：${agent.role || agent.name || '协作 AI'}`,
    `你的任务：${agent.task || '请根据主窗口分配的任务独立完成工作。'}`,
    session.coordinationNote ? `协作说明：${session.coordinationNote}` : '',
    Array.isArray(agent.focusPaths) && agent.focusPaths.length ? `重点路径：\n${agent.focusPaths.map(item => `- ${item}`).join('\n')}` : '',
    '',
    '请像主聊天窗口 AI 一样完整执行：可以思考、调用工具、读取/修改文件、运行命令并最终给出结果。不要把自己当作报告面板；你就是一个独立聊天窗口中的 AI。'
  ].filter(Boolean).join('\n')
}

function buildTemporaryAgentChatPrompt(session, agent) {
  const reportFilePath = session.reportFilePath || agent.reportFilePath || ''
  return [
    `你是主聊天窗口在协作画布中启动的一个临时 AI 执行节点：${agent.name || agent.role || agent.id}。`,
    `你的角色：${agent.role || agent.name || '临时 AI'}`,
    `你的任务：${agent.task || '请根据主窗口分配的任务独立完成工作。'}`,
    session.coordinationNote ? `协作说明：${session.coordinationNote}` : '',
    Array.isArray(agent.focusPaths) && agent.focusPaths.length ? `重点路径：\n${agent.focusPaths.map(item => `- ${item}`).join('\n')}` : '',
    '',
    '你复用主聊天窗口的后端执行链路：可以思考、查询代码地图、读取/修改项目文件、运行检查/测试/语法校验等本地命令，并调用允许的工具。',
    '禁止下载或安装任何东西：不要 npm/pnpm/yarn/bun install/add/i/ci，不要 pip/poetry/uv install/add/sync，不要 curl/wget/iwr/Invoke-WebRequest/Start-BitsTransfer 下载，不要 git clone/go get/go install/cargo install。确实需要依赖或下载时，只能写入汇报交给主窗口 AI/用户决定。',
    '这是一次性临时执行实例：不要依赖历史消息，不要要求用户在此窗口继续对话。',
    `最终汇报文件路径：${reportFilePath || '未指定'}`,
    '完成任务后必须调用 write_file，把完整 Markdown 汇报写入最终汇报文件路径。',
    '汇报必须包含：已做什么、关键发现、涉及文件/行号或命令证据、修改内容、验证结果、风险和建议。',
    '你的最终正文回复只能是一句话：汇报内容已写入临时文件，文件路径为 <最终汇报文件路径>。',
    '不要在最终正文里展开汇报内容；汇报内容只写入临时文件。'
  ].filter(Boolean).join('\n')
}

function normalizeProposal(input = {}) {
  const executionKind = String(input.executionKind || input.kind || '')
  const agents = (Array.isArray(input.agents) ? input.agents : [])
    .slice(0, getAgentLimit(executionKind))
    .map(normalizeAgent)
  return {
    requestId: input.requestId || createId('collab-request'),
    projectId: input.projectId || null,
    reason: String(input.reason || '当前任务可能需要多个 AI 工作会话协作。'),
    recommendation: normalizeMode(input.recommendation || input.mode || 'serial'),
    executionKind,
    userMessage: String(input.userMessage || input.originalUserMessage || input.originalRequest || ''),
    risk: String(input.risk || ''),
    coordinationNote: String(input.coordinationNote || ''),
    modes: ['single', 'serial', 'parallel'],
    agentLimit: getAgentLimit(executionKind),
    agentCount: agents.length,
    plan: normalizePlanSteps(input.plan || input.steps || []),
    agents
  }
}

function toPublicSession(session) {
  if (!session) return null
  const summary = summarizeSession(session)
  const temporaryExecution = session.temporaryExecution === true || session.executionKind === 'temporary_chat'
  const publicAgents = Array.isArray(session.agents)
    ? session.agents.map(agent => toPublicAgent(agent, { temporaryExecution }))
    : []
  return {
    id: session.id,
    projectId: session.projectId,
    mode: session.mode,
    status: summary.status,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    plan: session.plan,
    agents: publicAgents,
    reports: session.reports,
    coordinationNote: session.coordinationNote || '',
    executionKind: session.executionKind || '',
    temporaryExecution,
    workflowExecution: session.workflowExecution === true || session.executionKind === 'workflow',
    userMessage: session.userMessage || '',
    agentLimit: getAgentLimit(session.executionKind),
    workflow: session.workflow || null,
    requiresMainTakeover: summary.requiresMainTakeover,
    takeoverReason: summary.takeoverReason,
    recommendedAction: summary.recommendedAction
  }
}

function sendToProject(projectId, channel, payload = {}) {
  const webContents = (projectId ? projects.getWebContentsForProject(projectId) : null) || config.getMainWindow()?.webContents
  if (!webContents || webContents.isDestroyed?.()) {
    logCollab('send:miss', { projectId, channel })
    return false
  }
  webContents.send(channel, { ...payload, projectId })
  return true
}

function isTerminalStatus(status) {
  return ['done', 'completed', 'cancelled', 'interrupted', 'error', 'failed', 'timeout'].includes(String(status || ''))
}

function patchAgent(session, agentId, patch = {}) {
  if (!session || !agentId) return
  session.agents = session.agents.map((agent, index) => {
    if (String(agent.id) !== String(agentId)) return agent
    const runtimePatch = {}
    if (Object.prototype.hasOwnProperty.call(patch, 'abortController')) runtimePatch.abortController = patch.abortController
    else if (agent.abortController) runtimePatch.abortController = agent.abortController
    return { ...normalizeAgent({ ...agent, ...patch, id: agent.id }, index), ...runtimePatch }
  })
  session.updatedAt = Date.now()
}

function pushAgentEvent(session, agentId, bucket, event = {}) {
  if (!session || !agentId) return
  session.agents = session.agents.map((agent, index) => {
    if (String(agent.id) !== String(agentId)) return agent
    const runtimePatch = agent.abortController ? { abortController: agent.abortController } : {}
    const next = normalizeAgent(agent, index)
    const normalizedEvent = normalizeEvent({
      id: event.id || `${bucket}-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`,
      type: event.type || bucket,
      title: event.title || event.name || event.status || '状态更新',
      name: event.name || event.title || '',
      content: event.content || event.message || '',
      args: event.args || null,
      result: event.result || null,
      toolCallId: event.toolCallId || '',
      status: event.status || '',
      createdAt: event.createdAt || Date.now()
    })
    if (bucket === 'tool') next.tools = [...next.tools, normalizedEvent]
    else next.thinking = [...next.thinking, normalizedEvent]
    if (bucket !== 'tool' && event.status && isTerminalStatus(event.status)) next.status = event.status
    if (event.content || event.title) next.statusText = event.content || event.title
    return { ...next, ...runtimePatch }
  })
  session.updatedAt = Date.now()
}

function getAgentById(session, agentId) {
  return Array.isArray(session?.agents)
    ? session.agents.find(agent => String(agent.id) === String(agentId))
    : null
}

function updateSessionPlanForAgent(session, agentId, status = 'active') {
  if (!session || !Array.isArray(session.plan) || !session.plan.length) return
  const index = (Array.isArray(session.agents) ? session.agents : []).findIndex(agent => String(agent.id) === String(agentId))
  if (index < 0) return
  session.plan = session.plan.map((step, stepIndex) => {
    if (status === 'active') {
      return {
        ...step,
        status: stepIndex < index ? 'done' : (stepIndex === index ? 'active' : (step.status === 'done' ? 'done' : 'pending'))
      }
    }
    if (status === 'done') {
      if (stepIndex < index || stepIndex === index) return { ...step, status: 'done' }
      const hasActiveAhead = stepIndex === index + 1
      return { ...step, status: hasActiveAhead ? 'active' : (step.status === 'done' ? 'done' : 'pending') }
    }
    if (['error', 'failed', 'timeout', 'interrupted'].includes(String(status))) {
      return stepIndex === index ? { ...step, status: 'blocked' } : step
    }
    return step
  })
}

function updateAgentReasoningEvent(session, agentId, event = {}) {
  if (!session || !agentId) return
  session.agents = session.agents.map((agent, index) => {
    if (String(agent.id) !== String(agentId)) return agent
    const runtimePatch = agent.abortController ? { abortController: agent.abortController } : {}
    const next = normalizeAgent(agent, index)
    const existingIndex = next.thinking.findIndex(item => item.type === 'reasoning_delta' || item.type === 'reasoning_final')
    const previous = existingIndex >= 0 ? next.thinking[existingIndex] : null
    const previousContent = previous?.content || ''
    const content = event.final ? String(event.content || previousContent || '') : `${previousContent}${event.content || ''}`
    const normalized = normalizeEvent({
      id: previous?.id || `reasoning-${agentId}`,
      type: event.final ? 'reasoning_final' : 'reasoning_delta',
      title: event.title || '模型推理',
      content,
      status: event.status || '',
      createdAt: previous?.createdAt || event.createdAt || Date.now()
    })
    if (existingIndex >= 0) next.thinking[existingIndex] = normalized
    else next.thinking.push(normalized)
    next.statusText = normalized.content || normalized.title
    return { ...next, ...runtimePatch }
  })
  session.updatedAt = Date.now()
}
function getAgentLastEvents(agent = {}, limit = 8) {
  const thinking = Array.isArray(agent.thinking) ? agent.thinking : []
  const tools = Array.isArray(agent.tools) ? agent.tools : []
  return [...thinking, ...tools]
    .sort((a, b) => Number(a.createdAt || 0) - Number(b.createdAt || 0))
    .slice(-limit)
}

function emitSession(session) {
  if (!session) return
  sendToProject(session.projectId, 'agent-collaboration-session', toPublicSession(session))
}

function finalizeSessionRuntime(session) {
  if (!session || session.compactedAt) return
  Promise.resolve(projects.releaseCollaborationChatInstances?.(session.id)).catch(error => {
    logCollab('child-runtime:release-failed', { sessionId: session.id, error: error.message })
  })
  lifecycle.retainCompletedSession(sessions, session)
}

function getProjectRuntime(projectId) {
  const instance = projects.getProjectInstance(projectId)
  return {
    instance,
    projectPath: instance?.projectPath || '',
    contextManager: instance?.contextManager || instance?.context || null
  }
}

function isUsableModelConfig(modelConfig = {}) {
  return !!(modelConfig && typeof modelConfig === 'object' && modelConfig.apiUrl && (modelConfig.modelId || modelConfig.modelName || modelConfig.model))
}

function resolveAgentModelConfig(agent = {}, fallbackModelConfig = null) {
  if (isUsableModelConfig(agent.modelConfig)) return { modelConfig: agent.modelConfig, source: 'agent' }
  if (isUsableModelConfig(fallbackModelConfig)) return { modelConfig: fallbackModelConfig, source: 'fallback' }
  return { modelConfig: null, source: 'missing' }
}

function buildAgentRunOptions(session, agent, fallbackModelConfig, signal) {
  const runtime = getProjectRuntime(session.projectId)
  const resolvedModel = resolveAgentModelConfig(agent, fallbackModelConfig)
  const reportDir = reportStore.ensureReportsDir(session)
  const reportFilePath = reportStore.getAgentReportFilePath(session, agent)
  return {
    projectId: session.projectId,
    sessionId: session.id,
    agent,
    mode: session.mode,
    mainPlan: session.plan,
    projectPath: runtime.projectPath,
    contextManager: runtime.contextManager,
    modelConfig: resolvedModel.modelConfig,
    modelSource: resolvedModel.source,
    reportDir,
    reportFilePath,
    coordinationNote: session.coordinationNote || '',
    signal,
    emit: event => handleAgentSessionEvent(session.id, event)
  }
}

function handleAgentSessionEvent(sessionId, event = {}) {
  const session = sessions.get(sessionId)
  if (!session || isTerminalStatus(session.status)) return
  const agentId = event.agentId
  reportStore.appendRuntimeEvent(session, agentId, event).catch(error => {
    logCollab('event:append-failed', { sessionId, agentId, error: error.message })
  })

  if (event.type === 'tool_start') {
    pushAgentEvent(session, agentId, 'tool', {
      title: event.title || '工具调用',
      name: event.name || event.title || '',
      content: event.content || '',
      args: event.args || null,
      toolCallId: event.toolCallId || '',
      status: 'running',
      createdAt: event.createdAt
    })
  } else if (event.type === 'tool_result') {
    pushAgentEvent(session, agentId, 'tool', {
      title: `${event.title || '工具调用'} 完成`,
      name: event.name || event.title || '',
      content: event.content || '',
      args: event.args || null,
      result: event.result || null,
      toolCallId: event.toolCallId || '',
      status: event.result?.error ? 'error' : 'done',
      createdAt: event.createdAt
    })
  } else if (event.type === 'agent_status') {
    const patch = {
      status: event.status || 'running',
      statusText: event.content || event.title || ''
    }
    if (event.report?.content) patch.content = event.report.content
    patchAgent(session, agentId, patch)
    if (event.report && !session.reports.some(item => item?.agentId === event.report.agentId)) {
      session.reports.push(event.report)
    }
  } else if (event.type === 'content_delta') {
    const agent = getAgentById(session, agentId)
    patchAgent(session, agentId, {
      content: `${agent?.content || ''}${event.content || ''}`,
      statusText: '正在生成正文'
    })
  } else if (event.type === 'content') {
    patchAgent(session, agentId, {
      content: event.content || '',
      statusText: '正文已生成'
    })
  } else if (event.type === 'reasoning_delta') {
    updateAgentReasoningEvent(session, agentId, event)
  } else if (event.type === 'reasoning_final') {
    updateAgentReasoningEvent(session, agentId, { ...event, final: true })
  } else if (event.isProgressNarration === true) {
    patchAgent(session, agentId, {
      status: event.status || 'running',
      statusText: event.content || event.title || '正在处理'
    })
  } else {
    pushAgentEvent(session, agentId, 'thinking', {
      title: event.title || '思考块',
      content: event.content || '',
      status: event.status,
      createdAt: event.createdAt
    })
  }

  logCollab('event', {
    sessionId,
    agentId,
    type: event.type,
    title: event.title,
    status: event.status
  })
  emitSession(session)
}

async function runAgentAndCapture(session, agent, fallbackModelConfig, groupSignal) {
  const resolvedModel = resolveAgentModelConfig(agent, fallbackModelConfig)
  const agentController = new AbortController()
  const stopAgentOnGroupAbort = () => {
    try { agentController.abort(groupSignal?.reason || new Error('协作组已停止')) } catch { /* AbortController.abort 不应抛出 */ }
  }

  if (groupSignal?.aborted) stopAgentOnGroupAbort()
  else groupSignal?.addEventListener?.('abort', stopAgentOnGroupAbort, { once: true })

  patchAgent(session, agent.id, {
    abortController: agentController,
    startedAt: Date.now(),
    status: 'running',
    statusText: resolvedModel.source === 'fallback'
      ? '该协作 AI 未单独配置模型，已跟随主窗口当前模型执行'
      : '正在执行真实协作 AI 任务'
  })
  updateSessionPlanForAgent(session, agent.id, 'active')

  logCollab('agent:start', {
    sessionId: session.id,
    projectId: session.projectId,
    agentId: agent.id,
    name: agent.name,
    model: resolvedModel.modelConfig?.modelName || resolvedModel.modelConfig?.modelId || agent.modelName || '',
    modelSource: resolvedModel.source
  })
  emitSession(session)

  try {
    if (!resolvedModel.modelConfig) throw new Error('协作 AI 没有可用模型配置')
    const report = await runAgentSession(buildAgentRunOptions(session, agent, fallbackModelConfig, agentController.signal))
    const reportFile = reportStore.writeAgentReport(session, agent, report)
    report.reportFileName = reportFile.fileName
    report.reportFilePath = reportFile.filePath
    patchAgent(session, agent.id, {
      status: 'done',
      statusText: '已完成',
      content: report.content || '',
      reportFileName: reportFile.fileName,
      reportFilePath: reportFile.filePath,
      completedAt: Date.now(),
      abortController: null
    })
    updateSessionPlanForAgent(session, agent.id, 'done')
    if (!session.reports.some(item => item?.agentId === report.agentId)) session.reports.push(report)
    logCollab('agent:done', {
      sessionId: session.id,
      agentId: agent.id,
      toolCount: Array.isArray(report.toolCalls) ? report.toolCalls.length : 0,
      durationMs: report.durationMs
    })
    emitSession(session)
    return report
  } catch (error) {
    const interrupted = agentController.signal?.aborted === true || groupSignal?.aborted === true
    const currentAgent = getAgentById(session, agent.id) || agent
    const errorInfo = buildAgentError(error, { interrupted })
    const partialReport = {
      agentId: agent.id,
      name: agent.name,
      role: agent.role,
      task: agent.task,
      status: interrupted ? 'interrupted' : 'error',
      error: errorInfo,
      lastEvents: getAgentLastEvents(currentAgent),
      completedAt: Date.now()
    }
    const reportFile = reportStore.writeAgentReport(session, agent, partialReport)
    partialReport.reportFileName = reportFile.fileName
    partialReport.reportFilePath = reportFile.filePath
    patchAgent(session, agent.id, {
      status: interrupted ? 'interrupted' : (errorInfo.timeout ? 'timeout' : 'error'),
      statusText: errorInfo.message,
      error: interrupted ? null : errorInfo,
      partialReport,
      reportFileName: reportFile.fileName,
      reportFilePath: reportFile.filePath,
      completedAt: Date.now(),
      abortController: null
    })
    updateSessionPlanForAgent(session, agent.id, interrupted ? 'interrupted' : (errorInfo.timeout ? 'timeout' : 'error'))
    logCollab('agent:error', {
      sessionId: session.id,
      agentId: agent.id,
      error: error?.message || String(error || '')
    })
    emitSession(session)
    if (!session.reports.some(item => item?.agentId === partialReport.agentId && item?.completedAt === partialReport.completedAt)) {
      session.reports.push(partialReport)
    }
    return partialReport
  } finally {
    groupSignal?.removeEventListener?.('abort', stopAgentOnGroupAbort)
  }
}

async function runSession(sessionId, fallbackModelConfig = null) {
  const session = sessions.get(sessionId)
  if (!session || session.mode === 'single' || !session.agents.length) return

  logCollab('session:start', {
    sessionId,
    projectId: session.projectId,
    mode: session.mode,
    agents: session.agents.map(agent => agent.name || agent.id)
  })

  const controller = new AbortController()
  session.abortController = controller
  session.status = 'running'
  emitSession(session)

  const signal = controller.signal
  const agents = session.agents.slice()
  try {
    if (session.mode === 'workflow') {
      const agentIds = new Set(agents.map(agent => String(agent.id)))
      const pending = new Map(agents.map(agent => [String(agent.id), agent]))
      const completed = new Set()
      while (pending.size && !signal.aborted) {
        const ready = [...pending.values()].filter(agent => {
          const dependencies = (agent.dependsOn || []).filter(id => agentIds.has(String(id)))
          return dependencies.every(id => completed.has(String(id)))
        })
        if (!ready.length) {
          for (const agent of pending.values()) {
            patchAgent(session, agent.id, {
              status: 'error',
              statusText: '节点依赖存在循环或无法解析'
            })
          }
          session.status = 'error'
          emitSession(session)
          break
        }
        await Promise.allSettled(ready.map(agent => {
          pending.delete(String(agent.id))
          const dependencies = (agent.dependsOn || []).map(String)
          const upstreamContext = dependencies.map(dependencyId => {
            const upstream = getAgentById(session, dependencyId)
            if (!upstream) return ''
            const content = String(upstream.content || upstream.partialReport?.error?.message || upstream.statusText || '').slice(0, 10000)
            return [`### ${upstream.name || upstream.id}`, content || '上游节点没有正文交付。'].join('\n')
          }).filter(Boolean).join('\n\n').slice(0, 30000)
          const effectiveAgent = { ...agent, upstreamContext }
          patchAgent(session, agent.id, { upstreamContext })
          return runAgentAndCapture(session, effectiveAgent, fallbackModelConfig, signal)
            .finally(() => completed.add(String(agent.id)))
        }))
      }
    } else if (session.mode === 'parallel') {
      await Promise.allSettled(agents.map(agent => runAgentAndCapture(session, agent, fallbackModelConfig, signal)))
    } else {
      for (const agent of agents) {
        if (signal.aborted) break
        const current = getAgentById(session, agent.id)
        if (current && String(current.status || '') === 'interrupted') continue
        await runAgentAndCapture(session, agent, fallbackModelConfig, signal)
      }
    }
    session.status = signal.aborted ? 'interrupted' : summarizeSession(session).status
  } catch (error) {
    session.status = signal.aborted ? 'interrupted' : 'error'
    logCollab('session:error', { sessionId, error: error?.message || String(error || '') })
  } finally {
    session.updatedAt = Date.now()
    delete session.abortController
    session.agents = session.agents.map((agent, index) => normalizeAgent({ ...agent, abortController: null }, index))
    logCollab('session:finish', {
      sessionId,
      status: session.status,
      reports: session.reports.length
    })
    emitSession(session)
    finalizeSessionRuntime(session)
  }
}

function getPendingKey(projectId, requestId) {
  return `${projectId || 'global'}:${requestId}`
}

function settlePendingRequest(projectId, requestId, result) {
  const key = getPendingKey(projectId, requestId)
  const pending = pendingRequests.get(key)
  if (!pending) return false
  clearTimeout(pending.timer)
  pendingRequests.delete(key)
  pending.resolve(result)
  return true
}

function requestCollaboration(projectId, payload = {}) {
  const proposal = normalizeProposal({
    ...payload,
    projectId,
    recommendation: payload.recommendation || payload.mode || 'parallel',
    executionKind: 'temporary_chat'
  })
  sendToProject(projectId, 'agent-collaboration-request', proposal)

  return new Promise(resolve => {
    const key = getPendingKey(projectId, proposal.requestId)
    const timer = setTimeout(() => {
      pendingRequests.delete(key)
      resolve({
        success: true,
        requestId: proposal.requestId,
        status: 'expired',
        message: '临时多 AI 启动申请已超时，用户没有做出选择。'
      })
    }, REQUEST_TIMEOUT_MS)
    pendingRequests.set(key, { proposal, resolve, timer })
  })
}

async function startSession(projectId, payload = {}) {
  const pendingKey = getPendingKey(projectId, payload.requestId)
  const pending = pendingRequests.get(pendingKey)
  let executionKind = String(payload.executionKind || payload.kind || pending?.proposal?.executionKind || '')
  // 旧右侧“多会话窗口”已下线：非 workflow 一律按临时多 AI 处理
  if (executionKind !== 'workflow' && executionKind !== 'temporary_chat') {
    executionKind = 'temporary_chat'
  }
  const isTemporaryChat = executionKind === 'temporary_chat'
  const isWorkflow = executionKind === 'workflow'
  const request = pending?.proposal || normalizeProposal({ ...payload, projectId, executionKind })
  const requestedMode = normalizeMode(payload.mode || request.recommendation)
  const selectedAgents = (Array.isArray(payload.agents) && payload.agents.length
    ? payload.agents
    : request.agents
  ).slice(0, getAgentLimit(executionKind)).map(normalizeAgent)
  const selectedMode = selectedAgents.length === 0
    ? 'single'
    : isWorkflow
      ? 'workflow'
    : (isTemporaryChat && requestedMode !== 'single'
        ? 'parallel'
        : (requestedMode !== 'single' && selectedAgents.length <= 1 ? 'serial' : requestedMode))
  if (isTemporaryChat && selectedMode !== 'single') {
    try {
      reportStore.cleanupExpiredReports(projectId)
    } catch (error) {
      logCollab('report:cleanup-before-new-temporary-failed', {
        projectId,
        error: error?.message || String(error || '')
      })
    }
  }
  let normalizedWorkflow = null
  if (isWorkflow && payload.workflow && typeof payload.workflow === 'object') {
    agentWorkflows.assertWorkflowPayload(payload.workflow)
    normalizedWorkflow = agentWorkflows.normalizeWorkflow(payload.workflow)
  }
  const sessionId = createId('collab')
  const sessionAgents = selectedMode === 'single' ? [] : await childRuntimes.createChildRuntimes({
    agents: selectedAgents,
    mode: selectedMode,
    executionKind,
    projectId,
    sessionId,
    fallbackModelConfig: payload.fallbackModelConfig || null,
    coordinationNote: String(payload.coordinationNote || request.coordinationNote || ''),
    createChat: isTemporaryChat
      ? projects.createTemporaryAgentChatInstance
      : projects.createCollaborationChatInstance,
    releaseSession: projects.releaseCollaborationChatInstances,
    buildPrompt: context => isTemporaryChat
      ? buildTemporaryAgentChatPrompt({
          id: context.sessionId,
          projectId: context.projectId,
          coordinationNote: context.coordinationNote,
          reportFilePath: context.reportFilePath
        }, context.agent)
      : buildAgentChatPrompt({
          id: context.sessionId,
          projectId: context.projectId,
          coordinationNote: context.coordinationNote
        }, context.agent)
  })
  const session = {
    id: sessionId,
    projectId,
    mode: selectedMode,
    executionKind: isTemporaryChat ? 'temporary_chat' : (isWorkflow ? 'workflow' : ''),
    temporaryExecution: isTemporaryChat,
    workflowExecution: isWorkflow,
    workflow: normalizedWorkflow,
    status: selectedMode === 'single' ? 'single_agent' : 'running',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    userMessage: String(payload.userMessage || payload.originalUserMessage || request.userMessage || ''),
    plan: normalizePlanSteps(payload.plan || request.plan),
    agents: sessionAgents,
    reports: [],
    coordinationNote: String(payload.coordinationNote || request.coordinationNote || '')
  }

  sessions.set(session.id, session)
  sendToProject(projectId, 'agent-collaboration-session', toPublicSession(session))
  logCollab('session:created', {
    sessionId: session.id,
    projectId,
    mode: selectedMode,
    agentCount: session.agents.length
  })

  logCollab(isTemporaryChat ? 'session:temporary-chat-runtime' : (isWorkflow ? 'session:workflow-runtime' : 'session:temporary-chat-runtime'), {
    sessionId: session.id,
    projectId,
    agentCount: session.agents.length
  })
  if (isWorkflow && session.agents.length > 0) {
    setImmediate(() => {
      runSession(session.id, payload.fallbackModelConfig || null).catch(error => {
        const current = sessions.get(session.id)
        if (!current) return
        current.status = 'error'
        current.updatedAt = Date.now()
        current.reports.push({
          error: error?.message || String(error || '协作 AI 执行失败'),
          completedAt: Date.now()
        })
        emitSession(current)
        finalizeSessionRuntime(current)
      })
    })
  }

  const result = {
    success: true,
    status: 'accepted',
    continueRequired: false,
    waitRequired: false,
    nextAction: selectedMode === 'single' ? 'continue_work' : (isWorkflow ? 'canvas_workflow_running' : 'canvas_running'),
    session: toPublicSession(session),
    message: selectedMode === 'single'
      ? '用户选择单 AI 模式。请由主窗口 AI 继续真实执行、复核并最终回复。'
      : '协作任务已在画布中启动。多个临时 AI 会按画布关系执行，并把最终汇报写入临时文件。主窗口 AI 只需告知画布正在运行。'
  }
  result.message = selectedMode === 'single'
    ? '用户选择单 AI 模式。请由主窗口 AI 继续真实执行、复核并最终回复。'
    : (isWorkflow
        ? '工作流已在画布中启动。各 Work 节点会按连接关系分层执行，下游节点会收到上游交付。'
        : '协作任务已在画布中启动。多个临时 AI 会按画布关系执行，并把最终汇报写入临时文件。主窗口 AI 只需告知画布正在运行。')

  if (payload.requestId) settlePendingRequest(projectId, payload.requestId, result)
  if (selectedMode === 'single') finalizeSessionRuntime(session)
  return result
}

function cancelRequest(projectId, requestId, reason = 'cancelled') {
  const settled = settlePendingRequest(projectId, requestId, {
    success: true,
    requestId,
    status: 'cancelled',
    message: reason || '用户取消了协作任务申请。'
  })
  return settled
    ? { success: true, status: 'cancelled' }
    : { success: false, error: '协作申请不存在或已处理' }
}
function updateSession(projectId, sessionId, patch = {}) {
  const session = sessions.get(sessionId)
  if (!session || session.projectId !== projectId) return { success: false, error: '协作会话不存在' }
  if (patch.status) session.status = String(patch.status)
  if (['interrupted', 'cancelled', 'error'].includes(String(patch.status || ''))) {
    try { session.abortController?.abort?.(new Error(String(patch.status))) } catch { /* AbortController.abort 不应抛出 */ }
  }
  if (Array.isArray(patch.plan)) session.plan = normalizePlanSteps(patch.plan)
  if (Array.isArray(patch.agents)) session.agents = patch.agents.slice(0, getAgentLimit(session.executionKind)).map(normalizeAgent)
  if (patch.agentPatch && patch.agentPatch.agentId) {
    patchAgent(session, String(patch.agentPatch.agentId), patch.agentPatch)
  }
  if (patch.report && typeof patch.report === 'object') {
    const report = { ...patch.report }
    if (report.content && !report.reportFilePath) {
      const reportAgent = getAgentById(session, report.agentId) || { id: report.agentId || 'agent', name: report.name || report.role || 'agent' }
      try {
        const reportFile = reportStore.writeAgentReport(session, reportAgent, report)
        report.reportFileName = reportFile.fileName
        report.reportFilePath = reportFile.filePath
      } catch (error) {
        logCollab('report:write-failed', { sessionId, agentId: report.agentId, error: error?.message || String(error || '') })
      }
    }
    const existingReportIndex = session.reports.findIndex(item => String(item?.agentId || '') === String(report.agentId || ''))
    if (existingReportIndex >= 0) session.reports[existingReportIndex] = report
    else session.reports.push(report)
  }
  session.updatedAt = Date.now()
  emitSession(session)
  if (isTerminalStatus(session.status)) finalizeSessionRuntime(session)
  return { success: true, session: toPublicSession(session) }
}

function stopAgent(projectId, sessionId, agentId, reason = '用户停止了该协作 AI') {
  const session = sessions.get(sessionId)
  if (!session || session.projectId !== projectId) return { success: false, error: '协作会话不存在' }
  const agent = getAgentById(session, agentId)
  if (!agent) return { success: false, error: '协作 AI 会话不存在' }
  if (!isRunningAgentStatus(agent.status)) {
    return { success: true, skipped: true, session: toPublicSession(session) }
  }
  try { agent.abortController?.abort?.(new Error(reason || '用户停止了该协作 AI')) } catch { /* AbortController.abort 不应抛出 */ }
  patchAgent(session, agentId, {
    status: 'interrupted',
    statusText: reason || '用户停止了该协作 AI',
    completedAt: Date.now(),
    abortController: null
  })
  session.updatedAt = Date.now()
  session.status = summarizeSession(session).status
  emitSession(session)
  if (isTerminalStatus(session.status)) finalizeSessionRuntime(session)
  return { success: true, session: toPublicSession(session) }
}

function stopSession(projectId, sessionId, reason = '用户停止了全部协作 AI') {
  const session = sessions.get(sessionId)
  if (!session || session.projectId !== projectId) return { success: false, error: '协作会话不存在' }
  try { session.abortController?.abort?.(new Error(reason || '用户停止了全部协作 AI')) } catch { /* AbortController.abort 不应抛出 */ }
  session.agents = session.agents.map((agent, index) => {
    if (!isRunningAgentStatus(agent.status)) return agent
    try { agent.abortController?.abort?.(new Error(reason || '用户停止了全部协作 AI')) } catch { /* AbortController.abort 不应抛出 */ }
    return normalizeAgent({
      ...agent,
      status: 'interrupted',
      statusText: reason || '用户停止了全部协作 AI',
      completedAt: Date.now(),
      abortController: null
    }, index)
  })
  session.status = 'interrupted'
  session.updatedAt = Date.now()
  emitSession(session)
  finalizeSessionRuntime(session)
  return { success: true, session: toPublicSession(session) }
}

function retryAgent(projectId, sessionId, agentId) {
  const session = sessions.get(sessionId)
  if (!session || session.projectId !== projectId) return { success: false, error: '协作会话不存在' }
  const agent = getAgentById(session, agentId)
  if (!agent) return { success: false, error: '协作 AI 会话不存在' }
  const status = String(agent.status || '')
  if (!['error', 'failed', 'timeout', 'interrupted'].includes(status)) {
    return { success: false, error: isRunningAgentStatus(status) ? '此节点仍在运行' : '只有失败、超时或已中断的节点可以重试' }
  }
  const retryKey = `${sessionId}:${agentId}`
  if (activeAgentRetries.has(retryKey)) return { success: false, error: '此节点已经在重试中' }
  lifecycle.reactivateSession(session)

  const previousAttempt = {
    status,
    statusText: agent.statusText || '',
    error: agent.error || agent.partialReport?.error || null,
    reportFilePath: agent.reportFilePath || '',
    completedAt: agent.completedAt || Date.now()
  }
  const retryCount = Math.max(0, Number(agent.retryCount || 0)) + 1
  session.reports = (session.reports || []).filter(report => String(report?.agentId || '') !== String(agentId))
  patchAgent(session, agentId, {
    status: 'queued',
    statusText: `准备第 ${retryCount} 次重试`,
    error: null,
    partialReport: null,
    content: '',
    reportFileName: '',
    reportFilePath: '',
    completedAt: 0,
    retryCount,
    lastRetriedAt: Date.now(),
    retryHistory: [...(agent.retryHistory || []), previousAttempt].slice(-5)
  })
  updateSessionPlanForAgent(session, agentId, 'active')
  session.status = 'running'
  session.updatedAt = Date.now()
  activeAgentRetries.add(retryKey)
  emitSession(session)

  setImmediate(async () => {
    try {
      const current = getAgentById(session, agentId)
      if (!current) return
      const dependencies = (current.dependsOn || []).map(String)
      const upstreamContext = dependencies.map(dependencyId => {
        const upstream = getAgentById(session, dependencyId)
        if (!upstream) return ''
        const content = String(upstream.content || upstream.partialReport?.error?.message || upstream.statusText || '').slice(0, 10000)
        return [`### ${upstream.name || upstream.id}`, content || '上游节点没有正文交付。'].join('\n')
      }).filter(Boolean).join('\n\n').slice(0, 30000)
      const retryController = new AbortController()
      patchAgent(session, agentId, { upstreamContext })
      await runAgentAndCapture(session, { ...current, upstreamContext }, current.modelConfig || null, retryController.signal)
      session.status = summarizeSession(session).status
    } catch (error) {
      session.status = summarizeSession(session).status
      logCollab('agent:retry-error', { sessionId, agentId, error: error?.message || String(error || '') })
    } finally {
      activeAgentRetries.delete(retryKey)
      session.updatedAt = Date.now()
      emitSession(session)
      if (isTerminalStatus(session.status)) finalizeSessionRuntime(session)
    }
  })

  return {
    success: true,
    status: 'accepted',
    retryCount,
    session: toPublicSession(session),
    message: '失败节点已重新排队；已完成节点不会重复执行。'
  }
}

function getSession(projectId, sessionId = null) {
  if (sessionId) {
    const session = sessions.get(sessionId)
    return session && session.projectId === projectId ? toPublicSession(session) : null
  }
  const list = Array.from(sessions.values()).filter(session => session.projectId === projectId)
  return toPublicSession(list[list.length - 1])
}

function getStatus(projectId, sessionId = null) {
  const session = getSession(projectId, sessionId)
  if (!session) return { success: false, error: '协作会话不存在' }
  const summary = summarizeSession(session)
  const running = ['running', 'queued', 'working', 'running_with_errors'].includes(String(summary.status || ''))

  logCollab('status:read', {
    projectId,
    sessionId: session.id,
    status: summary.status,
    reports: Array.isArray(session.reports) ? session.reports.length : 0
  })

  const result = {
    success: true,
    status: summary.status,
    ready: !running,
    waitRequired: running,
    shouldPollLater: running,
    requiresMainTakeover: summary.requiresMainTakeover,
    takeoverReason: summary.takeoverReason,
    recommendedAction: summary.recommendedAction,
    message: running
      ? '协作 AI 仍在执行。不要连续调用本工具刷状态；等待右侧协作完成事件，或稍后只查询一次。'
      : (summary.requiresMainTakeover
          ? '协作 AI 已结束但存在错误。主窗口 AI 应读取错误详情、部分结果和最近事件，决定是否接手。'
          : '协作 AI 已结束，可读取 reports 并由主窗口 AI 复核汇总。'),
    session
  }
  result.message = running
    ? '协作 AI 仍在执行。不要连续调用本工具刷状态；等待右侧协作完成事件，或稍后只查询一次。'
    : (summary.requiresMainTakeover
        ? '协作 AI 已结束但存在错误。主窗口 AI 可读取错误详情、部分结果和最近事件，决定是否接手。'
        : '协作 AI 已结束，系统已把结构化报告保存为临时汇报文件。是否发送给主窗口 AI 分析总结，必须等待用户在界面中点击确认。')
  return result
}

function registerIPC(ipcMain) {
  if (ipcRegistered) return
  ipcRegistered = true

  ipcMain.handle('agent-collaboration:start', async (event, projectId, payload = {}) => startSession(projectId, payload))
  ipcMain.handle('agent-collaboration:cancel', async (event, projectId, requestId, reason = '') => cancelRequest(projectId, requestId, reason))
  ipcMain.handle('agent-collaboration:get', async (event, projectId, sessionId = null) => ({ success: true, session: getSession(projectId, sessionId) }))
  ipcMain.handle('agent-collaboration:update', async (event, projectId, sessionId, patch = {}) => updateSession(projectId, sessionId, patch))
  ipcMain.handle('agent-collaboration:stop-agent', async (event, projectId, sessionId, agentId, reason = '') => stopAgent(projectId, sessionId, agentId, reason))
  ipcMain.handle('agent-collaboration:retry-agent', async (event, projectId, sessionId, agentId) => retryAgent(projectId, sessionId, agentId))
  ipcMain.handle('agent-collaboration:stop-all', async (event, projectId, sessionId, reason = '') => stopSession(projectId, sessionId, reason))
  ipcMain.handle('agent-collaboration:request', async (event, projectId, payload = {}) => requestCollaboration(projectId, payload))
  ipcMain.handle('agent-collaboration:complexity', async (event, projectId, userMessage) => {
    const text = String(userMessage || '')
    const complex = /(全项目|全面|重构|前端|后端|数据库|多个|所有|审查|安全|性能|架构|并行|协作|多\s*(agent|ai))/i.test(text)
    return {
      isComplex: complex,
      recommendation: complex ? 'serial' : 'single',
      agentTypes: ['规划 AI', '前端 AI', '后端 AI', '验证 AI']
    }
  })
}

module.exports = {
  MAX_CHILD_AGENTS,
  MAX_TEMP_AGENT_CHATS,
  MAX_WORKFLOW_AGENTS,
  requestCollaboration,
  startSession,
  cancelRequest,
  updateSession,
  stopAgent,
  retryAgent,
  stopSession,
  getSession,
  getStatus,
  registerIPC
}
