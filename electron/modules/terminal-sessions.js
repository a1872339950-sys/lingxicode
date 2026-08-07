/**
 * Project-scoped terminal sessions for long-running commands.
 */

const os = require('os')
const path = require('path')
const { spawn, fork } = require('child_process')
const config = require('./config')
const { getRgPath } = require('./rg-path')
const executionGate = require('./command-execution-gate')

const MAX_OUTPUT_CHUNKS = 800
const MAX_CHUNK_LENGTH = 6000
const MAX_SESSIONS_PER_PROJECT = 20
const COMPLETED_SESSION_TTL_MS = 30 * 60 * 1000
const OUTPUT_FLUSH_INTERVAL_MS = 150
const COMMAND_RUNNER_PATH = path.join(__dirname, 'command-runner.js')
const sessionsByProject = new Map()

function now() {
  return Date.now()
}

function makeSessionId() {
  return 'term-' + now().toString(36) + '-' + Math.random().toString(36).slice(2, 8)
}

function clipChunk(text) {
  const value = stripBellCharacters(text)
  if (value.length <= MAX_CHUNK_LENGTH) return value
  return value.slice(0, MAX_CHUNK_LENGTH) + '\n...[output clipped]\n'
}

function stripBellCharacters(text = '') {
  return String(text ?? '')
    .replace(/\x07/g, '')
    .replace(/\x1B(?:\[[0-?]*[ -\/]*[@-~]|\][^\x07]*(?:\x07|\x1B\\))/g, '')
}

function releaseExecutionSlot(session) {
  if (!session?.executionSlotHeld) return
  session.executionSlotHeld = false
  executionGate.release(session.projectId)
}

function getProjectState(projectId) {
  const key = String(projectId || 'default')
  if (!sessionsByProject.has(key)) {
    sessionsByProject.set(key, {
      activeSessionId: null,
      sessions: []
    })
  }
  return sessionsByProject.get(key)
}

function clearAutoStopTimer(session) {
  if (session?.autoStopTimer) {
    clearTimeout(session.autoStopTimer)
    session.autoStopTimer = null
  }
}

function clearOutputFlushTimer(session) {
  if (session?.outputFlushTimer) {
    clearTimeout(session.outputFlushTimer)
    session.outputFlushTimer = null
  }
  if (session) session.pendingOutputEvents = []
}

function pruneCompletedSessions(projectId) {
  const state = getProjectState(projectId)
  const current = now()
  state.sessions = state.sessions.filter(session => {
    if (session.status === 'running') return true
    const completedAt = session.completedAt || session.startedAt || current
    const keep = current - completedAt <= COMPLETED_SESSION_TTL_MS
    if (!keep) {
      clearAutoStopTimer(session)
      clearOutputFlushTimer(session)
    }
    return keep
  })

  const removable = state.sessions
    .filter(session => session.status !== 'running')
    .sort((a, b) => (a.completedAt || a.startedAt || 0) - (b.completedAt || b.startedAt || 0))
  while (state.sessions.length > MAX_SESSIONS_PER_PROJECT && removable.length) {
    const session = removable.shift()
    clearAutoStopTimer(session)
    const index = state.sessions.findIndex(item => item.id === session.id)
    if (index >= 0) state.sessions.splice(index, 1)
  }

  if (!state.sessions.some(session => session.id === state.activeSessionId)) {
    const active = [...state.sessions].reverse().find(session => session.status === 'running') || state.sessions[state.sessions.length - 1] || null
    state.activeSessionId = active?.id || null
  }
}

function createInternalSession(projectId, cwd = '', options = {}) {
  const state = getProjectState(projectId)
  pruneCompletedSessions(projectId)
  const resolvedCwd = cwd ? path.resolve(cwd) : process.cwd()
  const index = state.sessions.length + 1
  const session = {
    id: makeSessionId(),
    projectId,
    title: options.title || `Terminal ${index}`,
    command: '',
    cwd: resolvedCwd,
    status: 'idle',
    exitCode: null,
    signal: null,
    startedAt: now(),
    completedAt: now(),
    lastOutputAt: null,
    detectedUrls: [],
    errorSummary: '',
    commandKind: 'general',
    commandGroup: 'general',
    networkTask: false,
    remoteTask: false,
    downloadTask: false,
    output: [],
    child: null,
    autoStopAfterMs: null,
    autoStopAt: null,
    autoStopTimer: null,
    outputFlushTimer: null,
    pendingOutputEvents: []
  }
  state.sessions.push(session)
  state.activeSessionId = session.id
  return session
}

function createSession(projectId, cwd = '', options = {}) {
  const session = createInternalSession(projectId, cwd, options)
  emit('terminal-status', { projectId, session: serializeSession(session, { includeOutput: false }), sessions: getStatus(projectId, session.id, { includeOutput: false }).sessions })
  return { success: true, session: serializeSession(session) }
}

function findSession(projectId, sessionId = null) {
  pruneCompletedSessions(projectId)
  const state = getProjectState(projectId)
  const id = sessionId || state.activeSessionId
  return state.sessions.find(session => session.id === id) || null
}

function serializeSession(session, options = {}) {
  if (!session) return null
  const includeOutput = options.includeOutput !== false
  return {
    id: session.id,
    projectId: session.projectId,
    title: session.title,
    command: session.command,
    cwd: session.cwd,
    status: session.status,
    exitCode: session.exitCode,
    signal: session.signal,
    startedAt: session.startedAt,
    completedAt: session.completedAt,
    lastOutputAt: session.lastOutputAt,
    durationMs: (session.completedAt || now()) - session.startedAt,
    detectedUrls: [...session.detectedUrls],
    errorSummary: session.errorSummary || '',
    commandKind: session.commandKind || 'general',
    commandGroup: session.commandGroup || 'general',
    networkTask: !!session.networkTask,
    remoteTask: !!session.remoteTask,
    downloadTask: !!session.downloadTask,
    autoStopAfterMs: session.autoStopAfterMs || null,
    autoStopAt: session.autoStopAt || null,
    requiresStop: session.status === 'running' && classifyTerminalCommand(session.command).persistent,
    output: includeOutput ? session.output.map(item => ({ ...item })) : undefined
  }
}

function getStatus(projectId, sessionId = null, options = {}) {
  pruneCompletedSessions(projectId)
  const state = getProjectState(projectId)
  return {
    projectId,
    activeSessionId: state.activeSessionId,
    sessions: state.sessions.map(session => serializeSession(session, { includeOutput: false })),
    activeSession: serializeSession(findSession(projectId, sessionId), {
      includeOutput: options.includeOutput !== false
    })
  }
}

function emit(eventName, payload) {
  const mainWindow = config.getMainWindow()
  mainWindow?.webContents?.send(eventName, payload)
}

function flushTerminalOutput(session) {
  if (!session) return
  const pending = session.pendingOutputEvents || []
  session.pendingOutputEvents = []
  clearOutputFlushTimer(session)
  if (!pending.length) return

  const groups = []
  for (const item of pending) {
    const last = groups[groups.length - 1]
    if (last && last.stream === item.chunk.stream) {
      last.text += item.chunk.text
      last.time = item.chunk.time
    } else {
      groups.push({
        stream: item.chunk.stream,
        text: item.chunk.text,
        time: item.chunk.time
      })
    }
  }

  const status = serializeSession(session, { includeOutput: false })
  for (const chunk of groups) {
    emit('terminal-output', {
      projectId: session.projectId,
      sessionId: session.id,
      chunk,
      status
    })
  }
}

function scheduleTerminalOutputFlush(session) {
  if (!session || session.outputFlushTimer) return
  session.outputFlushTimer = setTimeout(() => flushTerminalOutput(session), OUTPUT_FLUSH_INTERVAL_MS)
  session.outputFlushTimer.unref?.()
}

function analyzeOutput(session, text) {
  const value = String(text || '')
  const urlMatches = value.match(/https?:\/\/[^\s"'<>]+/g) || []
  for (const rawUrl of urlMatches) {
    const url = rawUrl.replace(/[),.;]+$/, '')
    if (!session.detectedUrls.includes(url)) {
      session.detectedUrls.push(url)
      if (session.commandKind === 'persistent-service') {
        try {
          const browserRuntimeAdapter = require('./browser-runtime-adapter')
          if (browserRuntimeAdapter.isLocalDevelopmentUrl(url)) {
            browserRuntimeAdapter.registerBrowserDevelopmentTarget({
              projectId: session.projectId,
              workspacePath: session.cwd,
              processId: session.child?.pid,
              sessionId: session.id,
              title: session.title,
              url
            }).then(result => {
              if (result.success === false && !result.ignored) {
                appendOutput(session, 'system', `[runtime adapter] Browser target registration failed: ${result.error}\n`)
              }
            }).catch(error => appendOutput(session, 'system', `[runtime adapter] Browser target registration failed: ${error.message}\n`))
          }
        } catch (error) {
          console.warn('[Terminal] browser runtime adapter unavailable:', error.message)
        }
      }
    }
  }

  const errorLine = value.split(/\r?\n/).find(line =>
    /(npm ERR!|error:|failed|exception|traceback|eaddrinuse|permission denied|cannot find module|not recognized)/i.test(line)
  )
  if (errorLine) session.errorSummary = errorLine.slice(0, 500)
}

function appendOutput(session, stream, text) {
  const safeText = stripBellCharacters(text)
  if (!safeText) return
  const chunk = {
    stream,
    text: clipChunk(safeText),
    time: now()
  }
  session.output.push(chunk)
  if (session.output.length > MAX_OUTPUT_CHUNKS) {
    session.output.splice(0, session.output.length - MAX_OUTPUT_CHUNKS)
  }
  session.lastOutputAt = chunk.time
  analyzeOutput(session, chunk.text)
  session.pendingOutputEvents.push({ chunk })
  scheduleTerminalOutputFlush(session)
}

function getShellCommand(command) {
  if (os.platform() === 'win32') {
    const trimmed = String(command || '').trim()
    if (/^(cmd|cmd\.exe|powershell|powershell\.exe|pwsh|pwsh\.exe)\b/i.test(trimmed)) {
      return {
        file: 'cmd.exe',
        args: ['/d', '/s', '/c', trimmed]
      }
    }
    if (looksLikePowerShellCommand(trimmed)) {
      const utf8Prefix = '[Console]::OutputEncoding=[Text.UTF8Encoding]::new();$OutputEncoding=[Text.UTF8Encoding]::new()'
      const encoded = Buffer.from(`${utf8Prefix};${trimmed}`, 'utf16le').toString('base64')
      return {
        file: 'powershell.exe',
        args: ['-NoLogo', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded]
      }
    }
    return {
      file: 'cmd.exe',
      args: ['/d', '/s', '/c', `chcp 65001 >nul && ${trimmed}`]
    }
  }
  return {
    file: process.env.SHELL || '/bin/sh',
    args: ['-lc', command]
  }
}

function getTerminalExecutionEnv() {
  const env = { ...process.env }
  // 用户项目终端：剥离宿主 ELECTRON_RUN_AS_NODE，避免 npm start / electron 以 Node 模式秒退
  delete env.ELECTRON_RUN_AS_NODE
  const rgPath = getRgPath()
  if (!rgPath || /^rg(?:\.exe)?$/i.test(String(rgPath))) return env
  const rgDir = path.dirname(rgPath)
  if (!rgDir) return env
  const pathKey = Object.keys(env).find(key => key.toLowerCase() === 'path') || 'Path'
  const currentPath = String(env[pathKey] || '')
  const parts = currentPath.split(path.delimiter).filter(Boolean)
  if (!parts.some(item => path.resolve(item).toLowerCase() === path.resolve(rgDir).toLowerCase())) {
    env[pathKey] = [rgDir, currentPath].filter(Boolean).join(path.delimiter)
  }
  return env
}

function looksLikePowerShellCommand(command = '') {
  const text = String(command || '').trim()
  return /\b(Get-Content|Set-Content|Add-Content|Select-String|Select-Object|Where-Object|ForEach-Object|Get-ChildItem|Measure-Object|Out-File|New-Item|Remove-Item|Move-Item|Copy-Item|Rename-Item|Start-Process)\b/i.test(text) ||
    /(^|[;&|\s])\$\w+/.test(text) ||
    /\|\s*(select|where|foreach|sort|measure|format|out)-/i.test(text)
}

function isPersistentCommand(command = '') {
  return classifyTerminalCommand(command).persistent
}

function classifyTerminalCommand(command = '') {
  const text = String(command || '').trim().toLowerCase()
  const info = {
    kind: 'general',
    group: 'general',
    networkTask: false,
    remoteTask: false,
    downloadTask: false,
    persistent: false,
    shouldUseTerminal: false
  }
  if (!text) return info

  const set = updates => Object.assign(info, updates, { shouldUseTerminal: true })

  if (/\b(curl|curl\.exe|wget|wget\.exe|aria2c|aria2c\.exe)\b/.test(text) ||
      /\b(invoke-webrequest|iwr|invoke-restmethod|irm|start-bitstransfer|bitsadmin)\b/.test(text)) {
    set({ kind: 'download', group: 'network', networkTask: true, downloadTask: true })
  }

  if (/\b(git|git\.exe)\s+(clone|fetch|pull|submodule\s+update)\b/.test(text)) {
    set({ kind: 'git-network', group: 'network', networkTask: true, downloadTask: /clone|submodule\s+update/.test(text) })
  }

  if (/\b(docker|docker\.exe)\s+(pull|build|compose\s+up|run)\b/.test(text)) {
    set({ kind: 'container', group: 'network', networkTask: /\bpull|build|compose\s+up|run\b/.test(text), persistent: /\b(compose\s+up|run)\b/.test(text) })
  }

  if (/\b(ssh|ssh\.exe)\b/.test(text) && !/\b(ssh|ssh\.exe)\s+(-v|--version|-h|--help|\?)\b/.test(text)) {
    set({ kind: 'ssh', group: 'remote', networkTask: true, remoteTask: true, persistent: true })
  }

  if (/\b(scp|scp\.exe|sftp|sftp\.exe|rsync|rsync\.exe)\b/.test(text)) {
    set({ kind: 'remote-transfer', group: 'remote', networkTask: true, remoteTask: true, downloadTask: true })
  }

  if (/\b(npm|pnpm|yarn|bun)\s+(install|add|i|ci|update|upgrade|create)\b/.test(text)) {
    set({ kind: 'dependency-install', group: 'package', networkTask: true, downloadTask: true })
  }

  if (/\b(npm|pnpm|yarn|bun)\s+(?:run\s+)?(dev|start|serve|watch|preview)\b/.test(text) ||
      /\b(vite|next|nuxt|webpack-dev-server|nodemon|electron)\b/.test(text) ||
      /\b(python|py|node)\b.*\b(app|server|dev|serve)\b/.test(text) ||
      /\b(uvicorn|flask|streamlit|gunicorn)\b/.test(text) ||
      /\b(--watch|watch)\b/.test(text)) {
    set({ kind: 'persistent-service', group: 'service', persistent: true })
  }

  if (/\b(npm|pnpm|yarn|bun)\s+run\s+(build|test|lint)\b/.test(text) ||
      /\b(pytest|playwright|cargo|mvn|gradle)\b/.test(text) ||
      /\bgo\s+(test|run|build)\b/.test(text)) {
    set({ kind: 'long-check', group: 'verification' })
  }

  return info
}

function scheduleAutoStop(projectId, session, autoStopAfterMs) {
  clearAutoStopTimer(session)
  const ms = Number(autoStopAfterMs)
  if (!Number.isFinite(ms) || ms <= 0) {
    session.autoStopAfterMs = null
    session.autoStopAt = null
    return
  }
  const safeMs = Math.min(Math.max(ms, 1000), 24 * 60 * 60 * 1000)
  session.autoStopAfterMs = safeMs
  session.autoStopAt = now() + safeMs
  session.autoStopTimer = setTimeout(() => {
    const latest = findSession(projectId, session.id)
    if (latest?.status === 'running') {
      stopSession(projectId, session.id, { reason: 'auto_stop_after_ms' })
    }
  }, safeMs)
  session.autoStopTimer.unref?.()
}

function startSession(projectId, command, cwd = '', sessionId = null, options = {}) {
  const trimmedCommand = String(command || '').trim()
  if (!trimmedCommand) {
    return { success: false, error: 'command is required' }
  }

  const resolvedCwd = cwd ? path.resolve(cwd) : process.cwd()
  const shell = getShellCommand(trimmedCommand)
  const state = getProjectState(projectId)
  const duplicate = !sessionId
    ? state.sessions.find(item =>
      item.status === 'running' &&
      item.command === trimmedCommand &&
      path.resolve(item.cwd || '') === resolvedCwd
    )
    : null
  if (duplicate) {
    return {
      success: true,
      reused: true,
      session: serializeSession(duplicate)
    }
  }

  if (!executionGate.tryAcquire(projectId)) {
    const gateStatus = executionGate.getStatus(projectId)
    const projectLimitReached = gateStatus.projectRunning >= gateStatus.projectLimit
    return {
      success: false,
      error: projectLimitReached
        ? `this project already has ${gateStatus.projectLimit} commands running`
        : `the application already has ${gateStatus.limit} commands running`,
      error_type: 'command_queue_busy',
      limit_scope: projectLimitReached ? 'project' : 'global',
      limit: projectLimitReached ? gateStatus.projectLimit : gateStatus.limit,
      retryable: true
    }
  }

  const activeSession = sessionId ? findSession(projectId, sessionId) : findSession(projectId, null)
  const session = (!sessionId && activeSession?.status === 'running')
    ? createInternalSession(projectId, resolvedCwd)
    : (activeSession || createInternalSession(projectId, resolvedCwd))
  if (session.status === 'running') {
    executionGate.release(projectId)
    return { success: false, error: 'terminal session is already running', session: serializeSession(session) }
  }
  session.command = trimmedCommand
  session.title = trimmedCommand.length > 28 ? trimmedCommand.slice(0, 28) + '...' : trimmedCommand
  session.cwd = resolvedCwd
  session.status = 'running'
  session.exitCode = null
  session.signal = null
  session.startedAt = now()
  session.completedAt = null
  session.lastOutputAt = null
  session.detectedUrls = []
  session.errorSummary = ''
  const commandInfo = classifyTerminalCommand(trimmedCommand)
  session.commandKind = commandInfo.kind
  session.commandGroup = commandInfo.group
  session.networkTask = commandInfo.networkTask
  session.remoteTask = commandInfo.remoteTask
  session.downloadTask = commandInfo.downloadTask
  session.output = []
  session.child = null
  session.executionSlotHeld = true
  scheduleAutoStop(projectId, session, options.autoStopAfterMs ?? options.auto_stop_after_ms)
  state.activeSessionId = session.id

  try {
    const child = fork(COMMAND_RUNNER_PATH, [], {
      cwd: resolvedCwd,
      windowsHide: true,
      silent: true,
      env: getTerminalExecutionEnv()
    })
    child.unref?.() // 不阻止父进程退出
    session.child = child
    const shouldBindNativeRuntime = commandInfo.persistent || /\b(dotnet\s+run|cargo\s+run|flutter\s+run|start-process|[a-z0-9_.-]+\.exe)\b/i.test(trimmedCommand)
    appendOutput(session, 'system', `> ${trimmedCommand}\n`)

    child.on('message', message => {
      if (!message || typeof message !== 'object') return
      if (message.type === 'started') {
        session.runnerPid = child.pid
        session.commandPid = message.pid || null
        if (shouldBindNativeRuntime && message.pid) {
          try {
            require('./windows-uia-runtime-adapter').bindTerminalSession({
              projectId,
              workspacePath: resolvedCwd,
              rootProcessId: message.pid,
              sessionId: session.id
            })
          } catch (error) {
            console.warn('[Terminal] Windows UI Automation adapter unavailable:', error.message)
          }
        }
        return
      }
      if (message.type === 'output') appendOutput(session, message.stream || 'stdout', message.text || '')
      if (message.type === 'error') appendOutput(session, 'stderr', `${message.error || 'command runner failed'}\n`)
      if (message.type === 'stopping') appendOutput(session, 'system', `\n[${message.reason || 'stop requested'}]\n`)
    })
    child.stderr?.on('data', data => appendOutput(session, 'stderr', `[command runner] ${data}`))
    child.send({
      type: 'run',
      command: trimmedCommand,
      cwd: resolvedCwd,
      env: getTerminalExecutionEnv(),
      timeoutMs: options.timeoutMs || options.timeout_ms || (commandInfo.persistent ? 24 * 60 * 60 * 1000 : 3 * 60 * 1000)
    })

    child.on('error', error => {
      session.status = 'error'
      session.completedAt = now()
      session.child = null
      releaseExecutionSlot(session)
      clearAutoStopTimer(session)
      session.errorSummary = error.message
      appendOutput(session, 'stderr', error.message + '\n')
      flushTerminalOutput(session)
      emit('terminal-status', { projectId, session: serializeSession(session, { includeOutput: false }) })
      try { require('./browser-runtime-adapter').unregisterBrowserSession(session.id) } catch { /* adapter may be unavailable */ }
      try { require('./windows-uia-runtime-adapter').unregisterWindowsSession(session.id) } catch { /* adapter may be unavailable */ }
    })

    child.on('close', (code, signal) => {
      if (session.status === 'stopped') {
        session.exitCode = code
        session.signal = signal || session.signal
      } else {
        session.status = code === 0 ? 'success' : 'failed'
        session.exitCode = code
        session.signal = signal
      }
      session.completedAt = now()
      session.child = null
      releaseExecutionSlot(session)
      clearAutoStopTimer(session)
      appendOutput(session, 'system', `\n[process ${session.status}, exit code ${code ?? 'null'}]\n`)
      flushTerminalOutput(session)
      emit('terminal-status', { projectId, session: serializeSession(session, { includeOutput: false }) })
      try { require('./browser-runtime-adapter').unregisterBrowserSession(session.id) } catch { /* adapter may be unavailable */ }
      try { require('./windows-uia-runtime-adapter').unregisterWindowsSession(session.id) } catch { /* adapter may be unavailable */ }
    })

    emit('terminal-status', { projectId, session: serializeSession(session, { includeOutput: false }) })
    return { success: true, session: serializeSession(session) }
  } catch (error) {
    session.status = 'error'
    session.completedAt = now()
    releaseExecutionSlot(session)
    clearAutoStopTimer(session)
    session.errorSummary = error.message
    state.activeSessionId = session.id
    appendOutput(session, 'stderr', error.message + '\n')
    flushTerminalOutput(session)
    return { success: false, error: error.message, session: serializeSession(session) }
  }
}

function activateSession(projectId, sessionId) {
  const state = getProjectState(projectId)
  const session = findSession(projectId, sessionId)
  if (!session) return { success: false, error: 'terminal session not found' }
  state.activeSessionId = session.id
  emit('terminal-status', { projectId, session: serializeSession(session, { includeOutput: false }), sessions: getStatus(projectId, session.id, { includeOutput: false }).sessions })
  return { success: true, session: serializeSession(session) }
}

function killProcessTree(session) {
  if (os.platform() === 'win32' && session.child?.pid) {
    const killer = spawn('taskkill.exe', ['/PID', String(session.child.pid), '/T', '/F'], {
      windowsHide: true,
      stdio: 'ignore'
    })
    killer.unref?.()
  } else {
    session.child?.kill('SIGTERM')
  }
}

function stopSession(projectId, sessionId = null, options = {}) {
  const session = findSession(projectId, sessionId)
  if (!session) return { success: false, error: 'terminal session not found' }
  if (session.status !== 'running') return { success: true, session: serializeSession(session) }

  session.status = 'stopped'
  session.signal = 'SIGTERM'
  clearAutoStopTimer(session)
  try {
    const child = session.child
    child?.send?.({ type: 'stop', reason: options.reason || 'cancelled' })
    killProcessTree(session)
    child?.stdin?.destroy?.()
    child?.stdout?.destroy?.()
    child?.stderr?.destroy?.()
    child?.unref?.()
  } catch (error) {
    session.errorSummary = error.message
  }
  const reason = options.reason === 'auto_stop_after_ms' ? 'auto stop requested' : 'stop requested'
  appendOutput(session, 'system', `\n[${reason}]\n`)
  flushTerminalOutput(session)
  emit('terminal-status', { projectId, session: serializeSession(session, { includeOutput: false }) })
  try { require('./browser-runtime-adapter').unregisterBrowserSession(session.id) } catch { /* adapter may be unavailable */ }
  try { require('./windows-uia-runtime-adapter').unregisterWindowsSession(session.id) } catch { /* adapter may be unavailable */ }
  return { success: true, session: serializeSession(session) }
}

function deleteSession(projectId, sessionId) {
  const state = getProjectState(projectId)
  const index = state.sessions.findIndex(session => session.id === sessionId)
  if (index === -1) return { success: false, error: 'terminal session not found' }
  const session = state.sessions[index]
  if (session.status === 'running') {
    try {
      killProcessTree(session)
    } catch (error) {
      session.errorSummary = error.message
    }
  }
  clearAutoStopTimer(session)
  clearOutputFlushTimer(session)
  try { require('./browser-runtime-adapter').unregisterBrowserSession(session.id) } catch { /* adapter may be unavailable */ }
  try { require('./windows-uia-runtime-adapter').unregisterWindowsSession(session.id) } catch { /* adapter may be unavailable */ }
  state.sessions.splice(index, 1)
  if (state.activeSessionId === sessionId) {
    const nextSession = state.sessions[Math.max(0, index - 1)] || state.sessions[0] || null
    state.activeSessionId = nextSession?.id || null
  }
  const activeSession = findSession(projectId)
  emit('terminal-status', {
    projectId,
    deletedSessionId: sessionId,
    session: activeSession ? serializeSession(activeSession, { includeOutput: false }) : null,
    sessions: getStatus(projectId, state.activeSessionId, { includeOutput: false }).sessions
  })
  return {
    success: true,
    deletedSessionId: sessionId,
    activeSession: serializeSession(activeSession)
  }
}

function clearProject(projectId) {
  const state = getProjectState(projectId)
  for (const session of state.sessions) {
    if (session.status === 'running') continue // 保留正在执行的终端
    clearOutputFlushTimer(session)
    clearAutoStopTimer(session)
  }
  // 只保留 running 的会话
  state.sessions = state.sessions.filter(s => s.status === 'running')
  if (! state.sessions.find(s => s.id === state.activeSessionId)) {
    state.activeSessionId = state.sessions[0]?.id || null
  }
  emit('terminal-status', { projectId, session: null, cleared: true })
  return { success: true }
}

function registerTerminalIPC(ipcMain) {
  ipcMain.handle('terminal:create', async (event, projectId, cwd, options = {}) => createSession(projectId, cwd, options))
  ipcMain.handle('terminal:activate', async (event, projectId, sessionId) => activateSession(projectId, sessionId))
  ipcMain.handle('terminal:run', async (event, projectId, command, cwd, sessionId = null) => startSession(projectId, command, cwd, sessionId))
  ipcMain.handle('terminal:status', async (event, projectId, sessionId = null, options = {}) => getStatus(projectId, sessionId, options))
  ipcMain.handle('terminal:stop', async (event, projectId, sessionId = null) => stopSession(projectId, sessionId))
  ipcMain.handle('terminal:delete', async (event, projectId, sessionId) => deleteSession(projectId, sessionId))
  ipcMain.handle('terminal:clear', async (event, projectId) => clearProject(projectId))
}

module.exports = {
  startSession,
  createSession,
  activateSession,
  stopSession,
  deleteSession,
  getStatus,
  clearProject,
  registerTerminalIPC,
  stripBellCharacters,
  classifyTerminalCommand,
  isPersistentCommand
}
