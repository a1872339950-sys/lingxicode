const fs = require('fs')
const path = require('path')
const vm = require('vm')

module.exports = {
  id: 'project-switch.running-ai-persistence',
  title: 'Switching projects preserves the active AI run in the modularized frontend',
  tags: ['project-switch', 'ai-state', 'persistence'],
  changedFilePatterns: [
    /^frontend\/scripts\/app\.js$/i,
    /^frontend\/scripts\/features\/project-state-helpers\.js$/i,
    /^frontend\/scripts\/features\/project-ai-state\.js$/i,
    /^frontend\/scripts\/features\/project-switcher\.js$/i,
    /^frontend\/scripts\/features\/message-sender\.js$/i,
    /^frontend\/scripts\/features\/ipc-reply-listener\.js$/i,
    /^frontend\/scripts\/features\/chat-history-paginator\.js$/i,
    /^frontend\/scripts\/features\/chat-virtual-scroller\.js$/i,
    /^frontend\/scripts\/features\/ai-runtime-cache\.js$/i,
    /^frontend\/scripts\/features\/running-ui-restore\.js$/i,
    /^frontend\/scripts\/features\/ai-stream-renderer\.js$/i,
    /^frontend\/scripts\/features\/ipc-ai-stream-listeners\.js$/i,
    /^frontend\/scripts\/features\/ai-message-ui\.js$/i,
    /^frontend\/scripts\/features\/ai-message-helpers\.js$/i,
    /^frontend\/scripts\/features\/message-queue\.js$/i,
    /^frontend\/scripts\/features\/chat-renderer\.js$/i,
    /^frontend\/scripts\/features\/ask-popup\.js$/i,
    /^electron\/modules\/projects\.js$/i,
    /^electron\/modules\/ai-chat\.js$/i,
    /^electron\/modules\/ask-permission\.js$/i,
    /^electron\/modules\/tools\.js$/i
  ],

  async run(ctx) {
    const read = rel => fs.readFileSync(path.join(ctx.root, rel), 'utf8')
    const appSource = read('frontend/scripts/app.js')
    const senderSource = read('frontend/scripts/features/message-sender.js')
    const replyListenerSource = read('frontend/scripts/features/ipc-reply-listener.js')
    const stateSource = read('frontend/scripts/features/project-state-helpers.js')
    const projectAiStateSource = read('frontend/scripts/features/project-ai-state.js')
    const switcherSource = read('frontend/scripts/features/project-switcher.js')
    const paginatorSource = read('frontend/scripts/features/chat-history-paginator.js')
    const runtimeSource = read('frontend/scripts/features/ai-runtime-cache.js')
    const runningRestoreSource = read('frontend/scripts/features/running-ui-restore.js')
    const streamRendererSource = read('frontend/scripts/features/ai-stream-renderer.js')
    const streamListenersSource = read('frontend/scripts/features/ipc-ai-stream-listeners.js')
    const aiMessageUiSource = read('frontend/scripts/features/ai-message-ui.js')
    const helperSource = read('frontend/scripts/features/ai-message-helpers.js')
    const messageQueueSource = read('frontend/scripts/features/message-queue.js')
    const rendererSource = read('frontend/scripts/features/chat-renderer.js')
    const projectsSource = read('electron/modules/projects.js')
    const aiChatSource = read('electron/modules/ai-chat.js')
    const askPermissionSource = read('electron/modules/ask-permission.js')
    const toolsSource = read('electron/modules/tools.js')
    const askPopupSource = read('frontend/scripts/features/ask-popup.js')
    const planAskSchemaSource = read('electron/modules/schemas/plan-ask.js')
    const systemPromptSource = read('electron/modules/system-prompt-builder.js')

    ctx.assert.ok(
      stateSource.includes('function isProjectAiRunActive(project)'),
      'project-state-helpers should own the unified active AI run detector'
    )
    ctx.assert.ok(
      stateSource.includes("if (aiMsg.dataset?.workDone === 'true') return false") &&
        stateSource.includes("if (aiMsg.dataset?.finalStreamStarted === 'true' || aiMsg.dataset?.finalStreamContent) return false"),
      'completed assistant messages should never be treated as active running AI blocks'
    )
    ctx.assert.ok(
      stateSource.includes('function stripActiveRunHistory(messagesHistory = [])'),
      'project-state-helpers should strip unfinished assistant/tool history while a project run is active'
    )

    ctx.assert.ok(
      switcherSource.includes('function freezeLeavingProjectUi(currentProject, chatMessages)') &&
        switcherSource.includes('pointerBelongsToLeavingProject') &&
        switcherSource.includes('if (!hasLiveRun) return null') &&
        switcherSource.includes('force: false'),
      'switching away should freeze only a genuinely running AI DOM, never the previous completed answer'
    )
    ctx.assert.ok(
      /deps\.syncAiStateToProject\?\.\(true\)|deps\.syncAiStateToProject\(true\)/.test(switcherSource) &&
        /deps\.setCurrentAiMsg\(null\)[\s\S]{0,260}deps\.setActiveProject\(project\.id\)/.test(switcherSource),
      'switching projects should synchronously save the old project before activating the target'
    )
    ctx.assert.ok(
      switcherSource.includes("restoreRunningUi('history-stable', { forceSnapshot: true })") &&
        !switcherSource.includes("restoreRunningUi('before-history-load'") &&
        !switcherSource.includes('delayed-'),
      'switching back should restore once after history is stable instead of repeatedly moving live nodes'
    )
    ctx.assert.ok(
      switcherSource.includes('const remoteMessages = targetData?.messages || targetData?.messagesHistory || []') &&
        switcherSource.includes('const targetMessagesHistory = mergeProjectMessagesHistory(project, remoteMessages, {') &&
        switcherSource.includes('syncProjectBranchSession(project, { ...targetData, messagesHistory: targetMessagesHistory, preserveLocalTail: true })'),
      'switching to a running project should merge stale backend history with local unsaved messages before rendering'
    )
    ctx.assert.ok(
      /const hasActiveAiRun = hasRunningUiEvidence\(project\)[\s\S]{0,220}deps\.stripActiveRunHistory\(historyToRestore\)/.test(switcherSource),
      'switching back should strip unfinished run history before restoring chat history'
    )
    ctx.assert.ok(
      switcherSource.includes("restoreRunningUi('after-history-ready', { forceSnapshot: true })") &&
        switcherSource.includes('let runningUiRestored = false') &&
        !switcherSource.includes('[0, 48, 120, 240') &&
        !switcherSource.includes('[0, 32, 80, 160'),
      'history readiness should place the live AI block once without visible delayed reordering'
    )
    ctx.assert.ok(
      /async function reloadActiveBranchSession[\s\S]*const hasActiveAiRun = hasRunningUiEvidence\(project\)[\s\S]*historyToRestore = hasActiveAiRun \? deps\.stripActiveRunHistory\(messagesHistory\) : messagesHistory[\s\S]*placeRunningAiBlockAtEnd\(project, \{ replay: true/.test(switcherSource),
      'clicking a project chat/session title should preserve the running AI block'
    )
    ctx.assert.ok(
      /async function reloadActiveBranchSession[\s\S]*preserveLocalTail: !options\.force[\s\S]*syncProjectBranchSession\(project, \{ \.\.\.result, messagesHistory, preserveLocalTail: !options\.force \}\)/.test(switcherSource),
      'branch reload should not discard local unsaved messages'
    )
    ctx.assert.ok(
      /async function reloadActiveBranchSession[\s\S]*const restoreStableRunningUi = \(\) =>[\s\S]*placeRunningAiBlockAtEnd\(project, \{ replay: true[\s\S]*if \(hasActiveAiRun && !historyRenderPending\) restoreStableRunningUi\(\)/.test(switcherSource) &&
        !switcherSource.includes('window.setTimeout(deps.scrollToLatestAiMessage, 80)'),
      'branch reload should focus the running turn as part of stable placement'
    )
    ctx.assert.ok(
      switcherSource.includes('function focusRunningTurn(project, aiMsg, options = {})') &&
        switcherSource.includes('applyFocus()') &&
        switcherSource.includes('scheduleFrame(applyFocus)') &&
        switcherSource.includes('focusRunningTurn(project, aiMsg, { container: chatMessages })') &&
        switcherSource.includes('if (!historyRenderPending && !runningUiRestored) deps.scrollToLatestAiMessage()'),
      'switching back to a running project should synchronously focus the active turn and avoid a second generic scroll'
    )
    ctx.assert.ok(
      runtimeSource.includes('function reattachProjectAiRuntime(project, options = {})') &&
        runtimeSource.includes('const shouldRebuildFromFrozen = !!frozenHtml') &&
        runtimeSource.includes('const startIndex = shellEmpty ? 0 : renderedOperationCount'),
      'running AI restore should rebuild detached shells and replay the correct watermark'
    )
    ctx.assert.ok(
      runtimeSource.includes('project._frozenAiDataset = { ...currentAiMsg.dataset }') && runtimeSource.includes('Object.entries(dataset)'),
      'running AI snapshots should preserve dataset fields such as workStartTime'
    )
    ctx.assert.ok(
      runtimeSource.includes('project.savedOperationCount = Array.isArray(project.aiOperations) ? project.aiOperations.length : 0') &&
        runtimeSource.includes('replayProjectAiOperations(project, startIndex)'),
      'switching back should replay only operations added while the project was inactive'
    )
    ctx.assert.ok(
      projectAiStateSource.includes("_syncProjectId = String(getActiveProjectId() || '')") &&
        projectAiStateSource.includes("scheduledProjectId !== String(getActiveProjectId() || '')") &&
        projectAiStateSource.includes('cancelAnimationFrame(_syncRafId)'),
      'deferred AI state sync must not write a cleared pointer into a newly active project'
    )
    ctx.assert.ok(
      streamRendererSource.includes('function appendAiContentChunk(content, targetProject = null)') &&
        streamRendererSource.includes('currentAiMsg = deps.ensureCurrentAiMessageForProject(targetProject)') &&
        streamListenersSource.includes('deps.appendAiContentChunk(data.content, targetProject)'),
      'all streamed content should reattach the project AI node before mutating DOM'
    )
    ctx.assert.ok(
      runningRestoreSource.includes('function scopeKey(projectOrId, sessionId)') &&
        runningRestoreSource.includes('function isCurrentSessionRunning(project)') &&
        runningRestoreSource.includes('normalizeSessionId(el.dataset?.chatSessionId) === sid'),
      'running UI lookup and snapshots must be isolated by project plus chat session'
    )
    ctx.assert.ok(
      switcherSource.includes('savedLatestUserMsgBySession') &&
        senderSource.includes('project.savedLatestUserMsgBySession[sessionId] = latestUserSnapshot') &&
        switcherSource.includes('const sameChatSession = currentChatSessionId === incomingChatSessionId') &&
        messageQueueSource.includes('restoreInjectedMessagesForProject(projectId, sessionId, options = {})'),
      'the just-sent user message, local history tails, and injected bubbles must stay in their own session'
    )
    const createSessionStart = appSource.indexOf('async function handleCreateProjectChatSession(project)')
    const createSessionEnd = appSource.indexOf('async function handleSwitchProjectChatSession', createSessionStart)
    const createSessionSource = appSource.slice(createSessionStart, createSessionEnd)
    ctx.assert.ok(
      createSessionSource.includes('const leavingSessionRunning = window.RunningUiRestore?.isCurrentSessionRunning?.(active) === true') &&
        createSessionSource.includes('window.RunningUiRestore?.freezeLeavingProject?.(active, {') &&
        !createSessionSource.includes('interruptAi?.()') &&
        !createSessionSource.includes('window.api.interruptAi(active.id)') &&
        !createSessionSource.includes('clearProjectAiRunState(active)'),
      'opening session B must freeze session A without interrupting or clearing its active run'
    )
    ctx.assert.ok(
      /const sourceInstance = args\[9\][\s\S]{0,500}Object\.assign\(Object\.create\(Object\.getPrototypeOf\(sourceInstance\)\), sourceInstance/.test(aiChatSource) &&
        aiChatSource.includes('await projects.saveProjectChatHistory(instance)') &&
        projectsSource.includes('function resolveChatHistorySaveTarget(projectOrInstance)') &&
        projectsSource.includes('pending?.target || saveKey'),
      'a running backend request must keep a stable session instance even when the project opens another chat session'
    )
    ctx.assert.ok(
      streamListenersSource.includes('function isEventForActiveSession(project, data = {})') &&
        replyListenerSource.includes('function isEventForActiveSession(project, data = {})') &&
        appSource.includes('const targetSessionRunning = window.RunningUiRestore?.isCurrentSessionRunning?.(active) === true'),
      'stream events, final replies, and session switching must all use the visible chat session scope'
    )

    ctx.assert.ok(
      helperSource.includes('function ensureCurrentAiMessageForProject(project, options = {})') &&
        helperSource.includes('function ensureRunningAiBlockVisible(project, options = {})') &&
        helperSource.includes('function applyProjectRunStartTime(project, aiMsg)'),
      'active run events should use a project-aware AI message restore path with stable timers'
    )
    ctx.assert.ok(
      helperSource.includes('const restored = reattachProjectAiRuntime(project, {') &&
        !/currentAiMsg && !document\.contains\(currentAiMsg\)\) \{\s*currentAiMsg = createAiMessage\(\)/.test(helperSource),
      'detached live AI messages should be reattached, not replaced with a fresh timer'
    )

    ctx.assert.ok(
      appSource.includes('function clearProjectAiRunState(project, options = {})') &&
        appSource.includes('window.RunningUiRestore?.clearSnapshot?.(project, sessionId)') &&
        appSource.includes('project.savedAiMsg = null') &&
        appSource.includes('project.aiRunningState = null') &&
        appSource.includes('project.savedOperationCount = 0'),
      'completion cleanup should remove stale saved AI DOM, snapshots, and replay counters'
    )
    const finalContentIndex = replyListenerSource.indexOf('const finalContent = streamedFinalContent || resolvedReplyContent')
    const earlyClearIndex = replyListenerSource.indexOf(
      'deps.clearProjectAiRunState(replyProject, { sessionId: replySessionId })',
      finalContentIndex
    )
    const earlyButtonIndex = replyListenerSource.indexOf('deps.updateSendBtnState()', earlyClearIndex)
    const finalRenderIndex = replyListenerSource.indexOf('deps.finishAiStreaming(finalContent, finalArtifacts)', earlyButtonIndex)
    ctx.assert.ok(
      replyListenerSource.includes('deps.clearProjectAiRunState(replyProject, { sessionId: replySessionId })') &&
        finalContentIndex >= 0 &&
        earlyClearIndex > finalContentIndex &&
        earlyButtonIndex > earlyClearIndex &&
        finalRenderIndex > earlyButtonIndex &&
        replyListenerSource.includes('replyProject.aiRunCompletedAt = 0') &&
        senderSource.includes('project.aiRunCompletedAt = 0'),
      'final replies should preserve the visible streamed body and clear the red running state before risky final rendering'
    )

    let replyHandler = null
    const replyEvents = []
    const replyProject = {
      id: 'project-a',
      chatSessionId: 'session-a',
      _runningSessionId: 'session-a',
      isRunning: true,
      awaitingFinalReply: true,
      streamingContent: '屏幕上已经完整显示的正文',
      history: [],
      messagesHistory: [],
      aiOperations: [],
      _aiState: {}
    }
    const replySandbox = {
      window: {
        api: { onReply: handler => { replyHandler = handler } },
        RunningUiRestore: { currentSessionId: project => project.chatSessionId },
        ChatRuntimeHistoryCache: { compactProject() {} }
      },
      console,
      AppLogger: { debug() {} },
      document: {}
    }
    vm.createContext(replySandbox)
    vm.runInContext(replyListenerSource, replySandbox)
    const noop = () => {}
    replySandbox.window.IpcReplyListener.bind({
      getActiveProjectId: () => 'project-a',
      getProjects: () => [replyProject],
      getActiveProject: () => replyProject,
      getProjectAiState: () => null,
      setProjectActivity: noop,
      ensureCurrentAiMessageForProject: noop,
      getCurrentAiMsg: () => null,
      getChatMessages: () => ({ querySelectorAll: () => [] }),
      setCurrentAiMsg: noop,
      setCurrentChangeSession: noop,
      getCurrentThinkingBlock: () => null,
      setCurrentThinkingBlock: noop,
      getAiMessageUI: () => null,
      updateWorkStatus: noop,
      clearProjectAiRunState: project => {
        replyEvents.push('clear-run')
        project.isRunning = false
        project.awaitingFinalReply = false
        project.streamingContent = ''
      },
      updateSendBtnState: () => replyEvents.push('update-button'),
      addAiMessageToUI: content => replyEvents.push(`render:${content}`),
      cleanupCollabReportsAfterSuccessfulReply: noop,
      cleanupTempFilesForProject: noop,
      setAutoFollowCurrentRun: noop,
      setCurrentToolCount: noop,
      setCurrentOpCount: noop,
      syncAiStateToProject: noop,
      pollContextStatus: noop,
      loadGitStatusForProject: noop,
      getAiChangePill: () => null,
      getOpIcons: () => ({ step: '' }),
      finalizeAiFailure: noop
    })
    replySandbox.window.IpcReplyListener.register()
    replyHandler({
      projectId: 'project-a',
      chatSessionId: 'session-a',
      done: true,
      content: '后端完成回包里的另一版正文'
    })
    ctx.assert.equal(
      replyProject.history[0]?.content,
      '屏幕上已经完整显示的正文',
      'completion should persist the already-visible streamed body instead of replacing it'
    )
    ctx.assert.deepEqual(
      replyEvents.slice(0, 3),
      ['clear-run', 'update-button', 'render:屏幕上已经完整显示的正文'],
      'completion should stop the red running button before rendering the final body'
    )

    ctx.assert.ok(
      rendererSource.includes('function hasFinalAssistantContent(aiSteps = [])'),
      'history renderer should detect whether an AI round has a real final assistant reply'
    )
    ctx.assert.ok(
      rendererSource.includes('未完成轮也必须进入虚拟列表') &&
        !rendererSource.includes('if (!hasAiContent && interjectSteps.length === 0) {'),
      'virtual history must keep a user-only unfinished round so switching cannot erase the latest user message'
    )
    ctx.assert.ok(
      rendererSource.includes('function isInterruptedRound(aiSteps = [])') &&
        rendererSource.includes('renderToolDetails: isInterruptedRound(round.aiSteps)'),
      'interrupted history rounds should restore their saved reasoning and tool process cards'
    )
    ctx.assert.ok(
      /if \(!hasFinalAssistantContent\(round\.aiSteps\)\) \{[\s\S]{0,120}continue/.test(rendererSource),
      'history renderer should skip unfinished tool-call-only rounds instead of displaying them as completed AI messages'
    )
    ctx.assert.ok(
      rendererSource.includes("} else if (source === 'append') {") &&
        rendererSource.includes('insertAfterNode = chatMessages.lastChild') &&
        /else if \(insertAfterNode && insertAfterNode\.parentNode === chatMessages\) \{[\s\S]{0,260}chatMessages\.appendChild\(batchFragment\)/.test(rendererSource) &&
        /if \(source === 'append' \|\| insertAfterNode\) \{[\s\S]{0,160}insertAfterNode = children\[children\.length - 1\]/.test(rendererSource),
      'append-mode history rendering should advance its insertion anchor so restored history is not locally reversed'
    )
    ctx.assert.ok(
      rendererSource.includes('function groupRounds(messagesHistory, baseIndex = 0)') &&
        rendererSource.includes('_historyIndex: baseIndex + index') &&
        rendererSource.includes('const rounds = groupRounds(sliceMessages, sliceStart)') &&
        rendererSource.includes('const baseUserCount = messagesHistory.slice(0, sliceStart).filter') &&
        rendererSource.includes('let turnId = baseUserCount + 1'),
      'sliced history rendering should keep global history indexes and turn ids for ordering, jump, and live-run anchors'
    )
    ctx.assert.ok(
      rendererSource.includes('if (options.itemId !== null && options.itemId !== undefined) msg.dataset.itemId = options.itemId') &&
        rendererSource.includes("if (options.isInterject)") &&
        rendererSource.includes("msg.classList.add('message-user-interject')"),
      'history-rendered injection bubbles should keep data-item-id so project-switch snapshot restore does not duplicate them'
    )

    const rendererSandbox = {
      window: {},
      console,
      HtmlUtils: {
        escapeHtml: value => String(value || ''),
        displayText: value => String(value || ''),
        displayCount: value => String(value || ''),
        clipText: value => String(value || ''),
        formatFileList: value => String(value || ''),
        formatMatches: value => String(value || ''),
        formatSearchCandidates: value => String(value || ''),
        formatPathFailureDetail: value => String(value || '')
      },
      setTimeout,
      clearTimeout,
      requestAnimationFrame: callback => { callback(); return 1 },
      cancelAnimationFrame() {},
      performance: { now: () => Date.now() },
      MutationObserver: function () { this.observe = () => {}; this.disconnect = () => {} }
    }
    vm.createContext(rendererSandbox)
    vm.runInContext(rendererSource, rendererSandbox)
    const renderer = rendererSandbox.window.ChatRenderer.bind()
    const unfinishedRounds = renderer.precomputeRounds([
      { role: 'user', content: '刚发送、尚未完成的用户消息', messageId: 'user-latest' }
    ])
    ctx.assert.equal(unfinishedRounds.length, 1, 'a user-only unfinished turn must remain in virtual history')
    ctx.assert.equal(unfinishedRounds[0].hasAiContent, false, 'unfinished user turn must not invent a completed AI message')

    const interruptMarkerIndex = appSource.indexOf('rememberInterruptedTurn(project, interruptedSessionId)')
    const clearRunningIndex = appSource.indexOf('project.isRunning = false', interruptMarkerIndex)
    ctx.assert.ok(
      appSource.includes('function rememberInterruptedTurn(project, sessionId)') &&
        interruptMarkerIndex >= 0 && clearRunningIndex > interruptMarkerIndex,
      'manual interrupt should persist a recoverable terminal marker before clearing runtime state'
    )
    ctx.assert.ok(
      /const requestWasCurrent = requestIsCurrent\(\)[\s\S]{0,100}deleteAbortControllerIfCurrent\(\)[\s\S]{0,180}status: 'done'/.test(aiChatSource) &&
        /catch \(err\) \{\s*const requestWasCurrent = requestIsCurrent\(\)\s*deleteAbortControllerIfCurrent\(\)/.test(aiChatSource) &&
        aiChatSource.includes("content: '[已中断]'") &&
        aiChatSource.includes("if (requestWasCurrent) webContents?.send('ai-status', { projectId, status: 'interrupted' })"),
      'backend completion and interrupt must remember request ownership before deleting its controller'
    )

    for (const source of [aiChatSource, askPermissionSource, toolsSource]) {
      ctx.assert.ok(
        !source.includes('label: `选项 ${index + 1}`') &&
          source.includes('只透传模型明确给出的完整选项，不从 value 猜标题或说明') &&
          source.includes('desc.length < 6') &&
          source.includes('_choiceValidation'),
        'choice normalization must reject incomplete model output instead of inventing or guessing user-facing choices'
      )
    }
    ctx.assert.ok(
      askPopupSource.includes('const normalizedOptions = (Array.isArray(options) ? options : [])') &&
        askPopupSource.includes('desc.length < 6') &&
        askPopupSource.includes('index: displayOptions.length + 1'),
      'ask popup should defensively hide malformed empty choices instead of rendering fake cards'
    )
    const askPermission = require(path.join(ctx.root, 'electron/modules/ask-permission.js'))
    const completeChoice = askPermission.normalizeChoiceOption({
      label: '先构建后预览',
      value: 'build',
      desc: '先执行正式构建并检查产物，结果更接近发布环境，但需要等待构建完成。'
    }, 0)
    ctx.assert.equal(completeChoice.label, '先构建后预览', 'the model-provided user-facing title should pass through unchanged')
    ctx.assert.equal(completeChoice.value, 'build', 'internal values should remain values and never become visible titles')
    ctx.assert.ok(completeChoice.desc.includes('发布环境'), 'the model-provided impact and tradeoff should remain visible')
    ctx.assert.equal(
      askPermission.normalizeChoiceOption({ label: 'build', value: 'build', desc: '' }, 1),
      null,
      'bare internal values without an explanation must be rejected instead of shown to the user'
    )
    ctx.assert.ok(
      toolsSource.includes('invalid_options: true') &&
        toolsSource.includes('不要把 build/dev 等内部值直接当标题') &&
        planAskSchemaSource.includes("required: ['label', 'value', 'desc']") &&
        planAskSchemaSource.includes('minLength: 6') &&
        systemPromptSource.includes('value 才能放 build/dev 等内部值'),
      'the tool schema, runtime validator, and system prompt must all require user-facing titles plus concrete reasons'
    )
    const placeUserStart = switcherSource.indexOf('function placeLatestRunningUserMessageBeforeAi')
    const placeUserEnd = switcherSource.indexOf('function markLastRenderedUserAsRunningAnchor', placeUserStart)
    const placeUserSource = switcherSource.slice(placeUserStart, placeUserEnd)
    ctx.assert.ok(
      placeUserSource.includes('这里只复用并定位现有气泡，绝不再创建第二份') &&
        !placeUserSource.includes('renderer?.addUserMessage?.(') &&
        placeUserSource.includes('sameMessageId || sameHistoryIndex || legacyCreatedDuplicate'),
      'running restore must reuse the paginator user bubble instead of creating a duplicate'
    )

    const projectSwitchRafQueue = []
    const sandbox = {
      window: {},
      console,
      setTimeout,
      requestAnimationFrame: callback => {
        projectSwitchRafQueue.push(callback)
        return projectSwitchRafQueue.length
      }
    }
    vm.createContext(sandbox)
    vm.runInContext(switcherSource, sandbox)
    const merge = sandbox.window.ProjectSwitcher.mergeMessagesHistory
    const remoteHistory = [
      { role: 'user', content: 'older question' },
      { role: 'assistant', content: 'older answer' }
    ]
    const localHistory = [
      ...remoteHistory,
      { role: 'user', content: 'new running question', time: '12:00' }
    ]
    const merged = merge(remoteHistory, localHistory, { preserveLocal: true })
    ctx.assert.equal(merged.length, 3, 'stale backend history should keep the local running user tail')
    ctx.assert.equal(merged[2].content, 'new running question', 'the latest local user message should still render after switching back')
    const backendWins = merge([...remoteHistory, { role: 'assistant', content: 'final answer' }], localHistory, { preserveLocal: false })
    ctx.assert.equal(backendWins.length, 3, 'non-running reloads should keep backend history authoritative')
    const unrelatedLocal = merge([{ role: 'user', content: 'branch B starts here' }], localHistory, { preserveLocal: true })
    ctx.assert.equal(unrelatedLocal.length, 1, 'unrelated histories without a shared prefix should not be merged')

    let focusedProjectId = 'project-a'
    const focusedContainer = {
      scrollTop: 240,
      scrollHeight: 1200,
      clientHeight: 300,
      style: {},
      contains: node => node === focusedAiNode
    }
    const focusedAiNode = {
      dataset: { projectId: 'project-a', chatSessionId: 'session-a' },
      scrollIntoView() {}
    }
    const focusedProject = {
      id: 'project-a',
      chatSessionId: 'session-a',
      _runningSessionId: 'session-a',
      isRunning: true
    }
    sandbox.window.RunningUiRestore = {
      currentSessionId: project => project.chatSessionId,
      isCurrentSessionRunning: () => true,
      findLiveRunningAiMsg: () => focusedAiNode
    }
    sandbox.window.ChatStickyBottom = {
      forceStick: container => { container.scrollTop = container.scrollHeight }
    }
    sandbox.window.ProjectSwitcher.bind({
      getActiveProjectId: () => focusedProjectId,
      getChatMessages: () => focusedContainer
    })
    ctx.assert.equal(
      sandbox.window.ProjectSwitcher.focusRunningTurn(focusedProject, focusedAiNode),
      true,
      'running turn focus should accept the active project and session'
    )
    ctx.assert.equal(
      focusedContainer.scrollTop,
      1200,
      'switching back must focus the running turn synchronously instead of showing old history first'
    )
    focusedContainer.scrollHeight = 1320
    projectSwitchRafQueue.shift()?.()
    ctx.assert.equal(
      focusedContainer.scrollTop,
      1320,
      'the first layout frame should correct virtual-scroller height changes'
    )
    focusedProjectId = 'project-b'
    focusedContainer.scrollHeight = 1500
    while (projectSwitchRafQueue.length) projectSwitchRafQueue.shift()?.()
    ctx.assert.equal(
      focusedContainer.scrollTop,
      1320,
      'stale focus frames must not pull a different project to the previous project run'
    )

    const stateProjects = [
      { id: 'project-a', _aiState: { currentAiMsg: 'node-a', currentToolCount: 1, currentOpCount: 1 } },
      { id: 'project-b', _aiState: { currentAiMsg: 'node-b', currentToolCount: 2, currentOpCount: 2 } }
    ]
    let stateActiveProjectId = 'project-a'
    let stateCurrentAiMsg = 'node-a'
    const stateRafQueue = []
    const stateSandbox = {
      window: {},
      console,
      requestAnimationFrame: callback => {
        stateRafQueue.push(callback)
        return stateRafQueue.length
      },
      cancelAnimationFrame: id => {
        if (id > 0 && id <= stateRafQueue.length) stateRafQueue[id - 1] = null
      }
    }
    vm.createContext(stateSandbox)
    vm.runInContext(projectAiStateSource, stateSandbox)
    const projectAiState = stateSandbox.window.ProjectAiState.bind({
      getProjects: () => stateProjects,
      getActiveProjectId: () => stateActiveProjectId,
      getActiveProject: () => stateProjects.find(item => item.id === stateActiveProjectId),
      getCurrentAiMsg: () => stateCurrentAiMsg,
      getCurrentToolCount: () => 0,
      getCurrentOpCount: () => 0,
      getCurrentChangeSession: () => null,
      isProjectAiRunActive: () => false
    })
    projectAiState.syncAiStateToProject()
    stateActiveProjectId = 'project-b'
    stateCurrentAiMsg = null
    while (stateRafQueue.length) stateRafQueue.shift()?.()
    ctx.assert.equal(
      stateProjects[1]._aiState.currentAiMsg,
      'node-b',
      'a deferred sync from the previous project must not clear the newly active project AI pointer'
    )

    const wrongProjectNode = { dataset: { projectId: 'project-a' }, classList: { contains: () => true } }
    const rightProjectNode = { dataset: { projectId: 'project-b' }, classList: { contains: () => false } }
    const runningSandbox = { window: {}, console, setTimeout, clearTimeout }
    vm.createContext(runningSandbox)
    vm.runInContext(runningRestoreSource, runningSandbox)
    const isolatedHit = runningSandbox.window.RunningUiRestore.findLiveRunningAiMsg(
      { querySelectorAll: () => [wrongProjectNode, rightProjectNode] },
      { id: 'project-b' }
    )
    ctx.assert.equal(isolatedHit, rightProjectNode, 'running UI restore must never borrow another project AI node')

    const sameProjectSessionA = { dataset: { projectId: 'project-b', chatSessionId: 'session-a' }, classList: { contains: () => true } }
    const sameProjectSessionB = { dataset: { projectId: 'project-b', chatSessionId: 'session-b' }, classList: { contains: () => true } }
    const sessionProject = {
      id: 'project-b',
      chatSessionId: 'session-a',
      _runningSessionId: 'session-a',
      isRunning: true,
      aiOperations: []
    }
    const sessionHitA = runningSandbox.window.RunningUiRestore.findLiveRunningAiMsg(
      { querySelectorAll: () => [sameProjectSessionB, sameProjectSessionA] },
      sessionProject
    )
    ctx.assert.equal(sessionHitA, sameProjectSessionA, 'session A must not borrow session B live AI DOM')
    const frozenNodeA = {
      innerHTML: '<div class="ai-dynamic-area"><span>A running</span></div>',
      className: 'message ai thinking',
      dataset: { projectId: 'project-b', chatSessionId: 'session-a' },
      querySelector: () => null
    }
    runningSandbox.window.RunningUiRestore.freezeFromElement(sessionProject, frozenNodeA)
    sessionProject.chatSessionId = 'session-b'
    sessionProject.isRunning = false
    ctx.assert.equal(
      runningSandbox.window.RunningUiRestore.hasEvidence(sessionProject),
      false,
      'idle session B must not inherit session A running evidence or spinner state'
    )
    ctx.assert.equal(
      runningSandbox.window.RunningUiRestore.getSnapshot(sessionProject),
      null,
      'session B must not read session A frozen UI snapshot'
    )
    sessionProject.chatSessionId = 'session-a'
    sessionProject.isRunning = true
    ctx.assert.ok(
      runningSandbox.window.RunningUiRestore.getSnapshot(sessionProject)?.html.includes('A running'),
      'switching back to session A should recover only session A snapshot'
    )

    let streamAttached = false
    let streamEnsureProject = null
    const streamChildren = []
    const streamDynamicArea = {
      querySelector: () => null,
      appendChild: child => streamChildren.push(child)
    }
    const streamAiMsg = {
      querySelector: selector => selector === '.ai-dynamic-area' ? streamDynamicArea : null
    }
    const streamSandbox = {
      window: {},
      console,
      AppLogger: { debug() {} },
      document: {
        contains: node => node === streamAiMsg && streamAttached,
        createElement: () => ({ className: '', textContent: '' })
      }
    }
    vm.createContext(streamSandbox)
    vm.runInContext(streamRendererSource, streamSandbox)
    const streamProject = { id: 'project-b' }
    streamSandbox.window.AiStreamRenderer.bind({
      getCurrentAiMsg: () => streamAiMsg,
      ensureCurrentAiMessageForProject: project => {
        streamEnsureProject = project
        streamAttached = true
        return streamAiMsg
      },
      updateWorkStatus() {}
    })
    streamSandbox.window.AiStreamRenderer.appendAiContentChunk('visible chunk', streamProject)
    ctx.assert.equal(
      streamEnsureProject,
      streamProject,
      'a normal content chunk should reattach the current project AI node before rendering'
    )
    ctx.assert.equal(streamChildren.length, 1, 'reattached content should create a visible intermediate block')
    ctx.assert.equal(streamChildren[0].textContent, 'visible chunk', 'the triggering chunk must not be dropped during reattach')

    const rafQueue = []
    const createNode = () => {
      const node = {
        children: [],
        parentNode: null,
        style: {},
        dataset: {},
        className: '',
        textContent: '',
        firstChild: null,
        setAttribute(name, value) {
          this[name] = value
          if (name === 'data-position') this.dataset.position = value
        },
        addEventListener() {},
        removeEventListener() {},
        querySelector() { return null },
        scrollIntoView() {},
        classList: {
          contains(cls) {
            return String(node.className || '').split(/\s+/).includes(cls)
          }
        },
        appendChild(child) {
          if (child.parentNode) child.parentNode.removeChild(child)
          child.parentNode = this
          this.children.push(child)
          this.firstChild = this.children[0] || null
        },
        insertBefore(child, before) {
          if (child.parentNode) child.parentNode.removeChild(child)
          child.parentNode = this
          const index = this.children.indexOf(before)
          if (index >= 0) this.children.splice(index, 0, child)
          else this.children.push(child)
          this.firstChild = this.children[0] || null
        },
        removeChild(child) {
          this.children = this.children.filter(item => item !== child)
          child.parentNode = null
          this.firstChild = this.children[0] || null
        }
      }
      return node
    }
    const container = createNode()
    container.querySelector = selector => {
      const position = /data-position="([^"]+)"/.exec(selector)?.[1]
      return container.children.find(child =>
        String(child.className || '').includes('chat-history-paginator-indicator') &&
        (!position || child.dataset.position === position)
      ) || null
    }
    const paginatorSandbox = {
      window: {},
      document: { createElement: createNode },
      console,
      setTimeout,
      requestAnimationFrame: cb => rafQueue.push(cb)
    }
    vm.createContext(paginatorSandbox)
    vm.runInContext(paginatorSource, paginatorSandbox)
    const paginator = paginatorSandbox.window.ChatHistoryPaginator
    const rendered = []
    paginator.reset({
      container,
      renderer: { restoreChatHistory: () => rendered.push('old') },
      messagesHistory: [{ role: 'user', content: 'old' }],
      start: 0,
      end: 1,
      total: 1,
      source: 'switch'
    })
    paginator.reset({
      container,
      renderer: { restoreChatHistory: () => rendered.push('new') },
      messagesHistory: [{ role: 'user', content: 'new' }],
      start: 0,
      end: 1,
      total: 1,
      source: 'switch'
    })
    while (rafQueue.length) rafQueue.shift()()
    ctx.assert.deepEqual(rendered, ['new'], 'stale paginator reset callbacks should not render old project history after a newer reset')

    ctx.assert.ok(
      paginatorSource.includes('afterRender = null') &&
        paginatorSource.includes('onReady: (meta) => fireAfterRender(meta || {})') &&
        paginatorSource.includes('if (!afterRenderFired) fireAfterRender') &&
        switcherSource.includes('function placeRunningAiBlockAtEnd(project, options = {})') &&
        switcherSource.includes('function placeLatestRunningUserMessageBeforeAi(project, aiMsg)') &&
        switcherSource.includes('chatMessages.insertBefore(userMsg, aiMsg)') &&
        switcherSource.includes("restoreRunningUi('after-history-ready', { forceSnapshot: true })"),
      'running AI blocks and their latest local user message should be moved after restored history instead of being buried above async history rendering'
    )
    ctx.assert.ok(
      messageQueueSource.includes('function rememberInjectedInterject(project, item, state =') &&
        messageQueueSource.includes('project._injectedInterjectMessages') &&
        messageQueueSource.includes('rememberInjectedInterject(project, item,') &&
        messageQueueSource.includes('anchorMessageId') &&
        messageQueueSource.includes("const pending = messagesEl.querySelectorAll('.message-user-interject')") &&
        messageQueueSource.includes('function restoreInjectedMessagesForProject(projectId, sessionId, options = {})') &&
        messageQueueSource.includes('Number(item?.injectedAt || 0) + 1000 < minInjectedAt') &&
        switcherSource.includes('{ minInjectedAt: runStartedAt }') &&
        messageQueueSource.includes('restoreInjectedMessagesForProject'),
      'message injection bubbles should keep their user-message anchor and restore only current-run items; historical injections must stay owned by history rendering'
    )
    ctx.assert.ok(
      switcherSource.includes('用户消息 → 本轮注入消息 → AI 执行块') &&
        switcherSource.includes("chatMessages.querySelectorAll('.message-user-interject')") &&
        switcherSource.includes('interjects.forEach(node => chatMessages.insertBefore(node, aiMsg))'),
      'running UI restore should move the user message, its injections, and the AI block as one ordered turn'
    )
    ctx.assert.ok(
      switcherSource.includes('Number(project.aiRunStartedAt || project._aiState?.aiRunStartedAt || 0)') &&
        switcherSource.includes('Number(item?.injectedAt || 0) + 1000 < runStartedAt') &&
        switcherSource.includes('item.anchorMessageId = String(snapshot.messageId)') &&
        /placeLatestRunningUserMessageBeforeAi\(project, aiMsg\)[\s\S]{0,220}relocatePendingInterjectMessages/.test(switcherSource),
      'switching back during a run should rebind current-run injections to the persisted user anchor and enforce user -> injection -> AI ordering'
    )
    ctx.assert.ok(
      aiMessageUiSource.includes('startWorkTimer,') &&
        aiMessageUiSource.includes('clearWorkTimer,') &&
        runtimeSource.includes('aiMessageUI?.startWorkTimer?.(aiMsg)') &&
        runtimeSource.includes('aiMessageUI?.updateWorkElapsed?.(aiMsg)'),
      'reattaching a running AI message should restart the live elapsed timer before the final reply arrives'
    )

    const orderContainer = createNode()
    orderContainer.querySelector = selector => {
      const position = /data-position="([^"]+)"/.exec(selector)?.[1]
      return orderContainer.children.find(child =>
        String(child.className || '').includes('chat-history-paginator-indicator') &&
        (!position || child.dataset.position === position)
      ) || null
    }
    const liveNode = createNode()
    liveNode.id = 'live'
    const historyNode = createNode()
    paginatorSandbox.window.ChatVirtualScroller = {
      reset: options => {
        orderContainer.children = []
        orderContainer.firstChild = null
        rafQueue.push(() => {
          orderContainer.appendChild(historyNode)
          options.onReady?.({ asyncHistoryReady: true })
        })
      }
    }
    historyNode.id = 'history'
    paginator.reset({
      container: orderContainer,
      renderer: { restoreChatHistory: () => orderContainer.appendChild(historyNode) },
      messagesHistory: [{ role: 'user', content: 'new' }],
      start: 0,
      end: 1,
      total: 1,
      source: 'switch',
      afterRender: () => orderContainer.appendChild(liveNode)
    })
    orderContainer.appendChild(liveNode)
    while (rafQueue.length) rafQueue.shift()()
    ctx.assert.deepEqual(
      orderContainer.children.filter(child => child.id).map(child => child.id),
      ['history', 'live'],
      'afterRender should move the live AI operation block below asynchronously restored history'
    )

    ctx.assert.ok(
      projectsSource.includes('async function resolveBranchNameForSessionAsync(instance)') &&
        projectsSource.includes('branch detection fell back to workspace; keeping previous branch session') &&
        projectsSource.includes('const branchName = await resolveBranchNameForSessionAsync(instance)'),
      'backend branch-session resolution should not fall back from a known git branch to the stale workspace history on transient git failures'
    )
    ctx.assert.ok(
      /if \(!options\.skipSave && instance\.chatHistoryPath\) \{[\s\S]{0,120}clearPendingChatHistorySave\(instance\.projectId\)[\s\S]{0,180}writeChatHistory\(instance\.chatHistoryPath, instance\.messagesHistory \|\| \[\], instance\)/.test(projectsSource),
      'switching branch sessions should clear deferred saves before writing the old branch history'
    )
    ctx.assert.ok(
      projectsSource.includes("if (pendingChatHistorySaves.has(projectId)) await saveProjectChatHistory(projectId)") &&
        /async function getAllProjectsForIPC\(options = \{\}\)[\s\S]{0,320}if \(pendingChatHistorySaves\.has\(projectId\)\) \{[\s\S]{0,80}saveProjectChatHistory\(projectId\)/.test(projectsSource),
      'history IPC reads should flush pending chat-history saves before returning messagesHistory'
    )
  }
}
