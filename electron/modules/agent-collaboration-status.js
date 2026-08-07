const TERMINAL_AGENT_STATUSES = new Set(['done', 'completed', 'cancelled', 'interrupted', 'error', 'failed', 'timeout'])
const ERROR_AGENT_STATUSES = new Set(['error', 'failed', 'timeout'])
const RUNNING_AGENT_STATUSES = new Set(['waiting', 'queued', 'running', 'active', 'working'])

function isTerminalAgentStatus(status) {
  return TERMINAL_AGENT_STATUSES.has(String(status || ''))
}

function isErrorAgentStatus(status) {
  return ERROR_AGENT_STATUSES.has(String(status || ''))
}

function isRunningAgentStatus(status) {
  return RUNNING_AGENT_STATUSES.has(String(status || ''))
}

function summarizeSession(session = {}) {
  const agents = Array.isArray(session.agents) ? session.agents : []
  const runningAgents = agents.filter(agent => isRunningAgentStatus(agent.status))
  const errorAgents = agents.filter(agent => isErrorAgentStatus(agent.status))
  const interruptedAgents = agents.filter(agent => String(agent.status || '') === 'interrupted')
  const doneAgents = agents.filter(agent => ['done', 'completed'].includes(String(agent.status || '')))
  const hasRunning = runningAgents.length > 0
  const hasErrors = errorAgents.length > 0
  const allInterrupted = agents.length > 0 && interruptedAgents.length === agents.length
  const allTerminal = agents.length > 0 && agents.every(agent => isTerminalAgentStatus(agent.status))

  let status = session.status || 'running'
  if (hasRunning) status = hasErrors ? 'running_with_errors' : 'running'
  else if (allInterrupted) status = 'interrupted'
  else if (allTerminal && hasErrors && doneAgents.length > 0) status = 'completed_with_errors'
  else if (allTerminal && hasErrors) status = 'error'
  else if (allTerminal) status = 'completed'

  return {
    status,
    runningAgents,
    errorAgents,
    interruptedAgents,
    doneAgents,
    hasRunning,
    hasErrors,
    allTerminal,
    requiresMainTakeover: hasErrors,
    takeoverReason: hasErrors
      ? errorAgents.map(agent => `${agent.name || agent.role || agent.id}: ${agent.error?.message || agent.statusText || '执行失败'}`).join('；')
      : '',
    recommendedAction: hasErrors
      ? '主窗口 AI 应读取失败协作 AI 的 error、lastEvents 和 partialReport，决定是自己接手、重新规划，还是向用户说明阻塞点。'
      : ''
  }
}

function buildAgentError(error, extra = {}) {
  const message = error?.message || String(error || '协作 AI 执行失败')
  const isTimeout = /timeout|超时|超过\s*\d+\s*秒|没有返回首包/i.test(message)
  return {
    message,
    stage: extra.stage || '',
    toolName: extra.toolName || '',
    retryable: extra.retryable !== false && !extra.interrupted,
    interrupted: extra.interrupted === true,
    timeout: isTimeout,
    stackSafe: error?.stack ? String(error.stack).split('\n').slice(0, 4).join('\n') : ''
  }
}

module.exports = {
  TERMINAL_AGENT_STATUSES,
  ERROR_AGENT_STATUSES,
  RUNNING_AGENT_STATUSES,
  isTerminalAgentStatus,
  isErrorAgentStatus,
  isRunningAgentStatus,
  summarizeSession,
  buildAgentError
}
