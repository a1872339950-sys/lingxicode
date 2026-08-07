const path = require('path')
const { fork } = require('child_process')
const executionGate = require('./command-execution-gate')

const COMMAND_RUNNER_PATH = path.join(__dirname, 'command-runner.js')

function runCommandInRunner(options = {}) {
  return new Promise(resolve => {
    if (!executionGate.tryAcquire(options.projectId)) {
      const gateStatus = executionGate.getStatus(options.projectId)
      const projectLimitReached = gateStatus.projectRunning >= gateStatus.projectLimit
      resolve({
        error: projectLimitReached
          ? `this project already has ${gateStatus.projectLimit} commands running`
          : `the application already has ${gateStatus.limit} commands running`,
        error_type: 'command_queue_busy',
        limit_scope: projectLimitReached ? 'project' : 'global',
        limit: projectLimitReached ? gateStatus.projectLimit : gateStatus.limit,
        code: null,
        stdout: '',
        stderr: '',
        queued: true,
        retryable: true
      })
      return
    }
    const child = fork(COMMAND_RUNNER_PATH, [], {
      cwd: options.cwd || process.cwd(),
      windowsHide: true,
      silent: true,
      env: options.env || process.env
    })
    let settled = false
    let stdout = ''
    let stderr = ''
    let runnerError = ''
    let exit = null
    const finish = result => {
      if (settled) return
      settled = true
      options.signal?.removeEventListener?.('abort', onAbort)
      executionGate.release(options.projectId)
      resolve(result)
    }
    const onAbort = () => {
      child.send?.({ type: 'stop', reason: 'aborted' })
      finish({ error: 'command aborted', stdout, stderr, aborted: true })
    }
    child.on('message', message => {
      if (!message || typeof message !== 'object') return
      if (message.type === 'output') {
        if (message.stream === 'stderr') stderr += String(message.text || '')
        else stdout += String(message.text || '')
      }
      if (message.type === 'error') runnerError = String(message.error || 'command runner failed')
      if (message.type === 'exit') exit = message
    })
    child.stderr?.on('data', data => { runnerError += String(data || '') })
    child.once('error', error => finish({ error: error.message || String(error), stdout, stderr }))
    child.once('close', code => {
      if (settled) return
      const error = runnerError || (exit?.stopped ? 'command stopped' : (code === 0 ? '' : `command exited with code ${exit?.code ?? code}`))
      finish({
        error: error || undefined,
        code: exit?.code ?? code,
        stdout,
        stderr,
        timeout: exit?.signal === 'SIGTERM' && exit?.stopped ? undefined : false,
        clipped: !!exit?.clipped,
        aborted: !!exit?.stopped
      })
    })
    options.signal?.addEventListener?.('abort', onAbort, { once: true })
    child.send({
      type: 'run',
      command: options.command,
      cwd: options.cwd,
      env: options.env,
      timeoutMs: options.timeoutMs
    })
  })
}

module.exports = { runCommandInRunner }