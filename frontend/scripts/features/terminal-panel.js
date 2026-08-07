(function () {
  const TEXT = {
    terminal: '\u7ec8\u7aef',
    noProject: '\u7ec8\u7aef \u00b7 \u672a\u9009\u62e9\u9879\u76ee',
    idle: '\u7ec8\u7aef \u00b7 \u672a\u8fd0\u884c',
    running: '\u8fd0\u884c\u4e2d',
    success: '\u5904\u7406\u5b8c\u6210',
    failed: '\u8fd0\u884c\u5931\u8d25',
    error: '\u8fd0\u884c\u9519\u8bef',
    stopped: '\u5df2\u505c\u6b62',
    elapsed: '\u5df2\u7528\u65f6',
    detectedService: '\u68c0\u6d4b\u5230\u670d\u52a1',
    foundIssue: '\u53d1\u73b0\u95ee\u9898',
    stillRunning: '\u4ecd\u5728\u8fd0\u884c',
    noNewOutput: '\u6682\u65e0\u65b0\u8f93\u51fa',
    expand: '\u5c55\u5f00\u7ec8\u7aef',
    collapse: '\u6536\u8d77\u7ec8\u7aef',
    readFailed: '\u7ec8\u7aef\u72b6\u6001\u8bfb\u53d6\u5931\u8d25: ',
    startFailed: '\u7ec8\u7aef\u542f\u52a8\u5931\u8d25: ',
    stopFailed: '\u505c\u6b62\u5931\u8d25: ',
    clearFailed: '\u6e05\u7a7a\u5931\u8d25: ',
    copyOk: '\u590d\u5236\u6210\u529f',
    analyzePrompt: '\u8bf7\u5206\u6790\u8fd9\u4e2a\u7ec8\u7aef\u8f93\u51fa',
    command: '\u547d\u4ee4',
    status: '\u72b6\u6001',
    cwd: '\u76ee\u5f55',
    output: '\u8f93\u51fa'
  }

  function formatDuration(ms) {
    const total = Math.max(0, Math.floor((Number(ms) || 0) / 1000))
    const minutes = Math.floor(total / 60)
    const seconds = total % 60
    return minutes > 0 ? `${minutes}\u5206${seconds}\u79d2` : `${seconds}\u79d2`
  }

  function normalizeText(output = []) {
    return output.map(item => item.text || '').join('')
  }

  const escapeHtml = HtmlUtils.escapeHtml

  function getPrompt(projectPath = '') {
    return `(base) PS ${projectPath || ''}> `
  }

  function bind(options = {}) {
    const api = options.api
    const getProject = options.getProject || function () { return null }
    const showToast = options.showToast || function () {}
    const onSendToAi = options.onSendToAi || function () {}
    const els = {
      panel: document.getElementById('terminalPanel'),
      head: document.getElementById('terminalHead'),
      output: document.getElementById('terminalOutput'),
      statusText: document.getElementById('terminalStatusText'),
      tabs: document.getElementById('terminalTabs'),
      newTab: document.getElementById('terminalNewTabBtn'),
      toggle: document.getElementById('toolbarTerminalBtn'),
      statusLabel: document.getElementById('terminalStatusLabel'),
      stop: document.getElementById('terminalStopBtn'),
      clear: document.getElementById('terminalClearBtn'),
      copy: document.getElementById('terminalCopyBtn'),
      send: document.getElementById('terminalSendBtn'),
      input: document.getElementById('terminalCommandInput'),
      prompt: document.getElementById('terminalPrompt'),
      run: document.getElementById('terminalRunBtn')
    }

    const stateByProject = new Map()
    let expanded = false
    let tickTimer = null
    let hideTimer = null // 自动隐藏定时器

    function getProjectState(projectId) {
      if (!stateByProject.has(projectId)) stateByProject.set(projectId, { activeSession: null, sessions: [] })
      return stateByProject.get(projectId)
    }

    function getActiveProjectId() {
      return getProject()?.id || null
    }

    function getActiveState() {
      const projectId = getActiveProjectId()
      return projectId ? getProjectState(projectId) : null
    }

    function getSessionLabel(session, index) {
      if (!session) return `${TEXT.terminal} ${index + 1}`
      if (session.title) return session.title
      if (session.command) return session.command.length > 20 ? session.command.slice(0, 20) + '...' : session.command
      return `${TEXT.terminal} ${index + 1}`
    }

    function getLatestOutputLine(session) {
      const chunks = [...(session?.output || [])].reverse()
      for (const chunk of chunks) {
        if (!chunk?.text || chunk.stream === 'system') continue
        const lines = String(chunk.text).split(/\r?\n/).map(line => line.trim()).filter(Boolean)
        if (lines.length > 0) return lines[lines.length - 1]
      }
      return ''
    }

    // 自动隐藏相关函数
    function clearAutoHideTimer() {
      if (hideTimer) {
        clearTimeout(hideTimer)
        hideTimer = null
      }
    }

    function startAutoHideTimer() {
      clearAutoHideTimer()
      hideTimer = setTimeout(() => {
        // 30 秒后检查是否仍然没有运行中的命令
        const session = getActiveState()?.activeSession
        if (session?.status !== 'running') {
          expanded = false
          render()
        }
        hideTimer = null
      }, 30000) // 30 秒
    }

    function buildStatusText(project, session) {
      if (!project) return TEXT.noProject
      if (!session) return TEXT.idle
      if (session && !expanded) {
        const statusText = {
          running: TEXT.running,
          success: TEXT.success,
          failed: TEXT.failed,
          error: TEXT.error,
          stopped: TEXT.stopped
        }[session.status] || session.status
        const label = session.command || getSessionLabel(session, 0)
        if (session.status === 'running') {
          const latestLine = getLatestOutputLine(session)
          if (latestLine) return `${label} · ${latestLine}`
          return `${label} · ${TEXT.running}`
        }
        if (session.errorSummary) return `${label} · ${session.errorSummary}`
        return `${label} · ${statusText}`
      }
      const statusText = {
        running: TEXT.running,
        success: TEXT.success,
        failed: TEXT.failed,
        error: TEXT.error,
        stopped: TEXT.stopped
      }[session.status] || session.status

      if (session.errorSummary) return `${TEXT.foundIssue} ${session.errorSummary}`
      if (session.detectedUrls?.length && session.status === 'running') return `${TEXT.detectedService} ${session.detectedUrls[0]}`

      const latestLine = getLatestOutputLine(session)
      if (latestLine && session.status === 'running') return latestLine

      if (session.status === 'running') {
        const idleMs = Date.now() - (session.lastOutputAt || session.startedAt || Date.now())
        if (idleMs > 60000) return `${TEXT.stillRunning}\uff0c${Math.floor(idleMs / 60000)}\u5206\u949f${TEXT.noNewOutput}`
        return `${TEXT.stillRunning}`
      }
      return `${session.command || getSessionLabel(session, 0)} \u00b7 ${statusText}`
    }

    function getOutputText(project, session) {
      const prompt = getPrompt(project?.path || '')
      if (!session) return prompt
      const output = normalizeText(session.output || [])
      return output + (session.status === 'running' ? '' : `\n${getPrompt(project?.path || session.cwd || '')}`)
    }

    function render() {
      if (!els.panel) return
      const project = getProject()
      const projectState = project ? getProjectState(project.id) : null
      const session = projectState?.activeSession || null
      const sessions = projectState?.sessions || []
      const isRunning = session?.status === 'running'
      const hasSession = !!session

      els.panel.classList.toggle('has-session', hasSession)
      els.panel.classList.toggle('running', isRunning)
      els.panel.classList.toggle('expanded', expanded)

      if (els.statusText) els.statusText.textContent = buildStatusText(project, session)
      if (els.toggle) {
        const statusText = buildStatusText(project, session)
        const toggleText = expanded ? TEXT.collapse : TEXT.expand
        els.toggle.title = `${statusText} · ${toggleText}`
        els.toggle.setAttribute('aria-label', toggleText)
        els.toggle.classList.toggle('active', expanded)
        els.toggle.classList.toggle('running', isRunning)
      }
      if (els.statusLabel) {
        const statusText = buildStatusText(project, session)
        els.statusLabel.textContent = statusText
        els.statusLabel.classList.toggle('visible', hasSession && !expanded)
      }
      if (els.stop) els.stop.disabled = !isRunning
      if (els.copy) els.copy.disabled = !hasSession
      if (els.send) els.send.disabled = !hasSession
      if (els.clear) els.clear.disabled = !hasSession
      if (els.prompt) els.prompt.textContent = getPrompt(project?.path || '')
      if (els.output) els.output.textContent = getOutputText(project, session)
      renderTabs(project, sessions, session)

      if (expanded) {
        requestAnimationFrame(() => {
          if (els.output) els.output.scrollTop = els.output.scrollHeight
        })
      }
    }

    function renderTabs(project, sessions, activeSession) {
      if (!els.tabs) return
      if (!project || sessions.length === 0) {
        els.tabs.innerHTML = ''
        return
      }
      els.tabs.innerHTML = sessions.map((item, index) => `
        <button class="terminal-tab ${item.id === activeSession?.id ? 'active' : ''}" data-session-id="${item.id}" title="${item.command || item.title || TEXT.terminal}">
          <span class="terminal-tab-dot ${item.status === 'running' ? 'running' : ''}"></span>
          <span class="terminal-tab-label">${escapeHtml(getSessionLabel(item, index))}</span>
          <span class="terminal-tab-close" data-close-session-id="${item.id}" title="\u5220\u9664\u7ec8\u7aef">×</span>
        </button>
      `).join('')
      els.tabs.querySelectorAll('.terminal-tab').forEach(tab => {
        tab.onclick = event => {
          event.stopPropagation()
          activateSession(tab.dataset.sessionId)
        }
      })
      els.tabs.querySelectorAll('.terminal-tab-close').forEach(close => {
        close.onclick = event => {
          event.stopPropagation()
          deleteSession(close.dataset.closeSessionId)
        }
      })
    }

    async function refresh(projectId = getActiveProjectId()) {
      if (!api?.terminalStatus || !projectId) return
      try {
        const status = await api.terminalStatus(projectId, null, { includeOutput: true })
        const projectState = getProjectState(projectId)
        projectState.activeSession = status.activeSession || null
        projectState.sessions = status.sessions || []
        if (projectId === getActiveProjectId()) render()
      } catch (error) {
        showToast(TEXT.readFailed + error.message, 'error')
      }
    }

    async function runCommand() {
      const project = getProject()
      const command = els.input?.value?.trim()
      if (!project || !command || !api?.terminalRun) return
      try {
        clearAutoHideTimer() // 取消自动隐藏定时器
        expanded = true
        let session = getProjectState(project.id).activeSession
        if (!session && api?.terminalCreate) {
          const created = await api.terminalCreate(project.id, project.path)
          session = created?.session || null
        }
        const result = await api.terminalRun(project.id, command, project.path, session?.id || null)
        if (!result?.success) throw new Error(result?.error || TEXT.startFailed)
        els.input.value = ''
        const projectState = getProjectState(project.id)
        projectState.activeSession = result.session || null
        await refresh(project.id)
        render()
      } catch (error) {
        showToast(TEXT.startFailed + error.message, 'error')
      }
    }

    async function createNewSession() {
      const project = getProject()
      if (!project || !api?.terminalCreate) return
      try {
        expanded = true
        const result = await api.terminalCreate(project.id, project.path)
        if (!result?.success) throw new Error(result?.error || TEXT.startFailed)
        await refresh(project.id)
      } catch (error) {
        showToast(TEXT.startFailed + error.message, 'error')
      }
    }

    async function activateSession(sessionId) {
      const project = getProject()
      if (!project || !sessionId || !api?.terminalActivate) return
      try {
        await api.terminalActivate(project.id, sessionId)
        await refresh(project.id)
      } catch (error) {
        showToast(TEXT.readFailed + error.message, 'error')
      }
    }

    async function deleteSession(sessionId) {
      const project = getProject()
      if (!project || !sessionId || !api?.terminalDelete) return
      try {
        await api.terminalDelete(project.id, sessionId)
        await refresh(project.id)
      } catch (error) {
        showToast(TEXT.clearFailed + error.message, 'error')
      }
    }

    async function stopActive() {
      const project = getProject()
      const session = getActiveState()?.activeSession
      if (!project || !session || !api?.terminalStop) return
      try {
        await api.terminalStop(project.id, session.id)
        await refresh(project.id)
      } catch (error) {
        showToast(TEXT.stopFailed + error.message, 'error')
      }
    }

    async function clearActive() {
      const project = getProject()
      if (!project || !api?.terminalClear) return
      try {
        await api.terminalClear(project.id)
        const projectState = getProjectState(project.id)
        projectState.activeSession = null
        projectState.sessions = []
        render()
      } catch (error) {
        showToast(TEXT.clearFailed + error.message, 'error')
      }
    }

    async function copyOutput() {
      const session = getActiveState()?.activeSession
      if (!session) return
      await navigator.clipboard.writeText(normalizeText(session.output || []))
      showToast(TEXT.copyOk, 'success')
    }

    async function sendOutputToAi() {
      const session = getActiveState()?.activeSession
      if (!session) return
      const text = normalizeText(session.output || []).slice(-12000)
      try {
        const sent = await onSendToAi(`${TEXT.analyzePrompt}\uff1a\n\n${TEXT.command}\uff1a${session.command}\n${TEXT.status}\uff1a${session.status}\n${TEXT.cwd}\uff1a${session.cwd}\n\n${TEXT.output}\uff1a\n${text}`)
        if (sent !== false) showToast('终端输出已发送给 AI', 'success')
      } catch (error) {
        showToast(`发送终端输出失败：${error.message || error}`, 'error')
      }
    }

    if (els.toggle) {
      els.toggle.onclick = event => {
        event.stopPropagation()
        clearAutoHideTimer() // 取消自动隐藏定时器
        expanded = !expanded
        render()
      }
    }
    if (els.head) {
      els.head.onclick = event => {
        if (event.target.closest('button')) return
        clearAutoHideTimer() // 取消自动隐藏定时器
        expanded = true
        render()
      }
    }
    if (els.stop) els.stop.onclick = stopActive
    if (els.clear) els.clear.onclick = clearActive
    if (els.copy) els.copy.onclick = copyOutput
    if (els.send) els.send.onclick = sendOutputToAi
    if (els.run) els.run.onclick = runCommand
    if (els.newTab) els.newTab.onclick = event => {
      event.stopPropagation()
      createNewSession()
    }
    if (els.input) {
      els.input.onkeydown = event => {
        if (event.key === 'Enter') {
          event.preventDefault()
          runCommand()
        }
      }
    }

    api?.onTerminalOutput?.(data => {
      if (!data?.projectId) return
      const projectState = getProjectState(data.projectId)
      if (!projectState.activeSession || projectState.activeSession.id !== data.sessionId) {
        projectState.activeSession = { ...(data.status || {}), output: [] }
      }
      projectState.activeSession = {
        ...projectState.activeSession,
        ...(data.status || {}),
        output: [...(projectState.activeSession.output || []), data.chunk].filter(Boolean).slice(-800)
      }
      const idx = projectState.sessions.findIndex(item => item.id === data.sessionId)
      if (idx >= 0) projectState.sessions[idx] = { ...projectState.sessions[idx], ...(data.status || {}) }
      if (data.projectId === getActiveProjectId()) render()
    })

    api?.onTerminalStatus?.(data => {
      if (!data?.projectId) return
      const projectState = getProjectState(data.projectId)
      if (data.cleared) {
        projectState.activeSession = null
        projectState.sessions = []
        clearAutoHideTimer() // 清除自动隐藏定时器
      } else if (data.deletedSessionId) {
        projectState.sessions = Array.isArray(data.sessions)
          ? data.sessions
          : projectState.sessions.filter(item => item.id !== data.deletedSessionId)
        projectState.activeSession = data.session ? { ...data.session, output: data.session.output || [] } : null
      } else if (data.session) {
        const existingOutput = projectState.activeSession?.id === data.session.id
          ? projectState.activeSession.output || []
          : []
        projectState.activeSession = { ...data.session, output: data.session.output || existingOutput }
        if (Array.isArray(data.sessions)) {
          projectState.sessions = data.sessions
        } else {
          const index = projectState.sessions.findIndex(item => item.id === data.session.id)
          if (index >= 0) projectState.sessions[index] = { ...projectState.sessions[index], ...data.session }
          else projectState.sessions.push(data.session)
        }
        // 检查命令是否结束，如果是则启动自动隐藏定时器
        if (data.session.status && data.session.status !== 'running') {
          startAutoHideTimer()
        }
      }
      if (data.projectId === getActiveProjectId()) render()
    })

    tickTimer = setInterval(() => {
      const session = getActiveState()?.activeSession
      if (session?.status === 'running') render()
    }, 1000)
    render()

    return {
      render,
      refresh,
      destroy() {
        clearAutoHideTimer()
        if (tickTimer) clearInterval(tickTimer)
      }
    }
  }

  window.TerminalPanel = { bind }
})()
