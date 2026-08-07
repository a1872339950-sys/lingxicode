const MAX_CONCURRENT_COMMANDS = 5
const MAX_CONCURRENT_COMMANDS_PER_PROJECT = 3
let running = 0
const runningByProject = new Map()

function getProjectKey(projectId) {
  return String(projectId || 'default')
}

function tryAcquire(projectId) {
  const projectKey = getProjectKey(projectId)
  const projectRunning = runningByProject.get(projectKey) || 0
  if (running >= MAX_CONCURRENT_COMMANDS) return false
  if (projectRunning >= MAX_CONCURRENT_COMMANDS_PER_PROJECT) return false
  running += 1
  runningByProject.set(projectKey, projectRunning + 1)
  return true
}

function release(projectId) {
  const projectKey = getProjectKey(projectId)
  const projectRunning = runningByProject.get(projectKey) || 0
  if (projectRunning <= 0) return
  running = Math.max(0, running - 1)
  if (projectRunning === 1) runningByProject.delete(projectKey)
  else runningByProject.set(projectKey, projectRunning - 1)
}

function getStatus(projectId) {
  const projectKey = getProjectKey(projectId)
  return {
    running,
    limit: MAX_CONCURRENT_COMMANDS,
    projectRunning: runningByProject.get(projectKey) || 0,
    projectLimit: MAX_CONCURRENT_COMMANDS_PER_PROJECT
  }
}

module.exports = {
  tryAcquire,
  release,
  getStatus,
  MAX_CONCURRENT_COMMANDS,
  MAX_CONCURRENT_COMMANDS_PER_PROJECT
}