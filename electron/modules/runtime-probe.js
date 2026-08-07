const fs = require('fs')
const path = require('path')
const { spawn } = require('child_process')

const ERROR_PATTERN = /(ReferenceError|TypeError|SyntaxError|UnhandledPromiseRejection|uncaughtException|unhandledRejection|ERR_|Error:|Cannot find module|EADDRINUSE|failed|exception)/i

function clip(value = '', max = 3000) {
  const text = String(value == null ? '' : value)
  return text.length > max ? `${text.slice(0, max)}...[truncated ${text.length - max} chars]` : text
}

function readPackageScript(projectPath = '', scriptName = 'start') {
  try {
    const packagePath = path.join(projectPath, 'package.json')
    const data = JSON.parse(fs.readFileSync(packagePath, 'utf8'))
    return data?.scripts?.[scriptName] || ''
  } catch (_) {
    return ''
  }
}

function inferRuntimeCommand(projectPath = '', options = {}) {
  const explicit = String(options.command || options.runtime_command || options.runtimeCommand || '').trim()
  if (explicit) return explicit
  const scriptName = String(options.script || options.npm_script || options.npmScript || 'start').trim() || 'start'
  if (readPackageScript(projectPath, scriptName)) return `npm run ${scriptName}`
  if (fs.existsSync(path.join(projectPath, '启动.bat'))) return '启动.bat'
  return ''
}

function splitCommand(command = '') {
  if (process.platform === 'win32') {
    return {
      command: 'cmd.exe',
      args: ['/d', '/s', '/c', command]
    }
  }
  return {
    command: 'sh',
    args: ['-lc', command]
  }
}

function collectErrorEvents(chunks = [], projectPath = '') {
  const events = []
  for (const chunk of chunks) {
    const lines = String(chunk.text || '').split(/\r\n|\r|\n/)
    lines.forEach((line, index) => {
      if (!ERROR_PATTERN.test(line)) return
      events.push({
        severity: 'error',
        category: 'runtime',
        type: 'runtime-probe-log-error',
        path: '',
        line: null,
        message: line.trim(),
        evidence: clip(lines.slice(Math.max(0, index - 1), Math.min(lines.length, index + 3)).join('\n')),
        source: `runtime-probe:${chunk.stream || 'output'}`
      })
    })
  }
  return events
}

function killChild(child) {
  if (!child || child.killed) return
  try {
    if (process.platform === 'win32' && child.pid) {
      spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], { windowsHide: true })
    } else {
      child.kill('SIGTERM')
      setTimeout(() => {
        try { if (!child.killed) child.kill('SIGKILL') } catch (_) { /* 进程可能已退出 */ }
      }, 1500).unref?.()
    }
  } catch (_) { /* 进程可能已退出 */ }
}

async function runRuntimeProbe(projectPath = '', options = {}) {
  const resolvedProjectPath = path.resolve(projectPath || '')
  if (!resolvedProjectPath || !fs.existsSync(resolvedProjectPath)) {
    return {
      success: false,
      ok: false,
      skipped: true,
      error: 'runtime probe skipped: project path does not exist',
      project_path: resolvedProjectPath
    }
  }

  const launchIfNeeded = options.launch_if_needed === true || options.launchIfNeeded === true
  const commandText = inferRuntimeCommand(resolvedProjectPath, options)
  if (!launchIfNeeded) {
    return {
      success: true,
      ok: true,
      skipped: true,
      launched_process: false,
      command: commandText,
      message: 'runtime probe skipped launch because launch_if_needed is false'
    }
  }
  if (!commandText) {
    return {
      success: false,
      ok: false,
      skipped: true,
      launched_process: false,
      error: 'runtime probe could not infer a launch command'
    }
  }

  const timeoutMs = Math.max(5000, Math.min(Number(options.timeout_ms || options.timeoutMs || 25000), 120000))
  const startedAt = Date.now()
  const chunks = []
  const command = splitCommand(commandText)

  return await new Promise(resolve => {
    let settled = false
    const probeEnv = { ...process.env, LINGXI_HEALTH_PROBE: '1' }
    // 避免宿主 ELECTRON_RUN_AS_NODE 污染用户 Electron 启动
    delete probeEnv.ELECTRON_RUN_AS_NODE
    const child = spawn(command.command, command.args, {
      cwd: resolvedProjectPath,
      windowsHide: true,
      env: probeEnv
    })

    const finish = result => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      const errors = collectErrorEvents(chunks, resolvedProjectPath)
      resolve({
        success: true,
        ok: errors.length === 0 && result.exit_code === 0,
        launched_process: true,
        stopped_own_process: !!result.stopped_own_process,
        command: commandText,
        project_path: resolvedProjectPath,
        duration_ms: Date.now() - startedAt,
        exit_code: result.exit_code,
        signal: result.signal,
        timed_out: !!result.timed_out,
        error_count: errors.length,
        events: errors,
        output_tail: clip(chunks.slice(-12).map(item => `[${item.stream}] ${item.text}`).join(''), 6000),
        message: errors.length
          ? `runtime probe captured ${errors.length} runtime error line(s)`
          : 'runtime probe captured no runtime error lines'
      })
    }

    const timer = setTimeout(() => {
      killChild(child)
      finish({ timed_out: true, stopped_own_process: true, exit_code: null, signal: 'timeout' })
    }, timeoutMs)
    timer.unref?.()

    child.stdout?.on('data', data => chunks.push({ stream: 'stdout', text: data.toString('utf8') }))
    child.stderr?.on('data', data => chunks.push({ stream: 'stderr', text: data.toString('utf8') }))
    child.on('error', error => {
      chunks.push({ stream: 'error', text: error.message })
      finish({ exit_code: 1, signal: null })
    })
    child.on('close', (code, signal) => {
      finish({ exit_code: code, signal })
    })
  })
}

module.exports = {
  runRuntimeProbe,
  inferRuntimeCommand,
  collectErrorEvents
}
