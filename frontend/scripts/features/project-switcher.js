// 项目切换模块
// 负责项目切换、分支会话同步、聊天历史恢复等。
// 通过 window.ProjectSwitcher.bind(deps) 注入依赖后使用。

(function () {
  let deps = {}
  let projectSwitchSeq = 0
  let runningFocusSeq = 0

  function returnToChatArea() {
    window.closeCanvasView?.()
    deps.closeSkillPanel()
    window.LingxiPanelManager?.closeMany?.([
      'archive',
      'integration',
      'localApps',
      'settings',
      'git',
      'gitHistory',
      'gitBranch',

      'remoteBridge'
    ])
    const chatMessages = deps.getChatMessages()
    if (chatMessages) chatMessages.style.display = 'block'
  }

  function normalizeUserContent(value) {
    if (Array.isArray(value)) {
      return value.map(part => {
        if (part && typeof part === 'object' && part.type === 'text') return part.text || ''
        return typeof part === 'string' ? part : ''
      }).filter(Boolean).join('\n')
    }
    return String(value || '')
  }

  function currentScopeSessionId(project) {
    return window.RunningUiRestore?.currentSessionId?.(project)
      || String(project?.chatSessionId || '').trim()
      || 'main'
  }

  /**
   * 切回运行中的项目/会话后，立即定位到当前执行轮。
   * 同步定位保证首屏不先露出旧历史；随后只在两个布局帧内校正，
   * 覆盖虚拟滚动器把占位轮替换成真实 DOM 时产生的高度变化。
   */
  function focusRunningTurn(project, aiMsg, options = {}) {
    const container = options.container || deps.getChatMessages?.()
    if (!project || !container || !aiMsg) return false
    const projectId = String(project.id || '')
    const sessionId = currentScopeSessionId(project)
    const focusSeq = ++runningFocusSeq
    const scheduleFrame = typeof requestAnimationFrame === 'function'
      ? requestAnimationFrame
      : callback => setTimeout(callback, 0)

    const stillCurrent = () => {
      if (focusSeq !== runningFocusSeq) return false
      if (projectId && String(deps.getActiveProjectId?.() || '') !== projectId) return false
      if (currentScopeSessionId(project) !== sessionId) return false
      if (window.RunningUiRestore?.isCurrentSessionRunning &&
          !window.RunningUiRestore.isCurrentSessionRunning(project)) return false
      return true
    }

    const resolveLiveNode = () => {
      if (container.contains?.(aiMsg)) return aiMsg
      return window.RunningUiRestore?.findLiveRunningAiMsg?.(container, project) || null
    }

    const applyFocus = () => {
      if (!stillCurrent()) return false
      const live = resolveLiveNode()
      if (!live) return false
      const previousBehavior = container.style?.scrollBehavior || ''
      if (container.style) container.style.scrollBehavior = 'auto'
      try {
        window.ChatStickyBottom?.forceStick?.(container)
        container.scrollTop = container.scrollHeight
        const gap = container.scrollHeight - container.scrollTop - container.clientHeight
        if (gap > 8 && typeof live.scrollIntoView === 'function') {
          live.scrollIntoView({ block: 'end', inline: 'nearest', behavior: 'auto' })
        }
      } finally {
        if (container.style) container.style.scrollBehavior = previousBehavior
      }
      return true
    }

    // 先同步贴底，避免切回瞬间显示旧轮次；两帧校正只处理本次恢复产生的布局变化。
    applyFocus()
    scheduleFrame(() => {
      if (!applyFocus()) return
      scheduleFrame(applyFocus)
    })
    return true
  }

  // 纯图片/仅附件消息 content 可能为空，但仍应视为可见用户消息（运行中切项目恢复依赖此判断）
  function userSnapshotIsVisible(snapshot) {
    if (!snapshot || snapshot.role !== 'user') return false
    if (String(snapshot.content || snapshot.displayContent || '').trim()) return true
    if (Array.isArray(snapshot.attachments) && snapshot.attachments.some(item => item && (item.path || item.name || item.thumb))) return true
    if (Array.isArray(snapshot.directiveBadges) && snapshot.directiveBadges.length > 0) return true
    if (Array.isArray(snapshot.references) && snapshot.references.length > 0) return true
    return false
  }

  function getLatestVisibleUserSnapshot(project) {
    if (!project) return null
    const scopeSessionId = currentScopeSessionId(project)
    const pickLatest = (history, source) => {
      if (!Array.isArray(history)) return null
      let latest = null
      let visibleUserIndex = 0
      for (let i = 0; i < history.length; i += 1) {
        const msg = history[i]
        if (!msg || msg.role !== 'user') continue
        const index = Number.isFinite(Number(msg.index)) ? Number(msg.index) : visibleUserIndex
        if (!msg.hidden) visibleUserIndex += 1
        if (msg.hidden) continue
        latest = {
          role: 'user',
          content: normalizeUserContent(msg.displayContent || msg.content),
          rawContent: msg.content,
          displayContent: msg.displayContent,
          attachments: msg.attachments,
          directiveBadges: msg.directiveBadges,
          references: msg.references,
          time: msg.time || '',
          messageId: msg.messageId || '',
          index,
          turnId: index + 1,
          historyIndex: source === 'messagesHistory' ? i : Number.isFinite(Number(msg.historyIndex)) ? Number(msg.historyIndex) : null,
          source,
          order: i,
          chatSessionId: scopeSessionId
        }
      }
      return userSnapshotIsVisible(latest) ? latest : null
    }
    if (project.isRunning || deps.isProjectAiRunActive(project)) {
      const scopedSaved = project.savedLatestUserMsgBySession?.[scopeSessionId]
      const legacySaved = project.savedLatestUserMsg
      const candidate = scopedSaved || (String(legacySaved?.chatSessionId || 'main') === scopeSessionId ? legacySaved : null)
      if (candidate?.role === 'user') {
        const saved = { ...candidate, source: 'saved', order: Number.MAX_SAFE_INTEGER }
        if (userSnapshotIsVisible(saved)) return saved
      }
    }
    return pickLatest(project.messagesHistory, 'messagesHistory') || pickLatest(project.history, 'history')
  }

  function rememberLatestVisibleUserMessage(project) {
    const latest = getLatestVisibleUserSnapshot(project)
    if (latest) {
      const sessionId = currentScopeSessionId(project)
      const snapshot = { ...latest, chatSessionId: sessionId }
      if (!project.savedLatestUserMsgBySession || typeof project.savedLatestUserMsgBySession !== 'object') {
        project.savedLatestUserMsgBySession = {}
      }
      project.savedLatestUserMsgBySession[sessionId] = snapshot
      project.savedLatestUserMsg = snapshot
    }
    return latest
  }

  function getUserSnapshotKey(project, snapshot) {
    return [
      project?.id || '',
      snapshot?.chatSessionId || currentScopeSessionId(project),
      snapshot?.turnId ?? '',
      snapshot?.historyIndex ?? '',
      String(snapshot?.content || '').replace(/\s+/g, ' ').trim().slice(0, 500)
    ].join('\u001f')
  }

  function normalizeSnapshotText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim()
  }

  function getUserMessageNodeText(node) {
    if (!node) return ''
    const full = node.querySelector?.('.user-message-full')
    if (full && !full.hidden) return normalizeSnapshotText(full.textContent || '')
    const preview = node.querySelector?.('.user-message-preview')
    if (preview && !preview.hidden) return normalizeSnapshotText(preview.textContent || '').replace(/\.\.\.$/, '')
    const text = node.querySelector?.('.user-message-text')
    return normalizeSnapshotText(text?.textContent || '')
  }

  function getUserMessageNodeAttachmentPaths(node) {
    if (!node) return []
    return Array.from(node.querySelectorAll?.('[data-path]') || [])
      .map(el => String(el.getAttribute('data-path') || el.dataset?.path || '').trim())
      .filter(Boolean)
  }

  // 防止仅靠 historyIndex 误匹配到更早的用户气泡（切回运行中会话时会把旧消息挪到最新下面）
  function userNodeMatchesSnapshot(node, snapshot) {
    if (!node || !snapshot || !node.classList?.contains('user')) return false
    if (node.classList.contains('message-user-interject')) return false
    const snapshotMessageId = String(snapshot.messageId || '').trim()
    const nodeMessageId = String(node.dataset?.messageId || '').trim()
    if (snapshotMessageId && nodeMessageId) return snapshotMessageId === nodeMessageId
    const snapText = normalizeSnapshotText(snapshot.content || snapshot.displayContent || '')
    const nodeText = getUserMessageNodeText(node)
    if (snapText) {
      if (nodeText === snapText) return true
      // 长文折叠时节点可能只有预览
      if (nodeText && (snapText.startsWith(nodeText) || nodeText.startsWith(snapText.slice(0, Math.min(40, snapText.length))))) {
        return true
      }
      return false
    }
    // 纯附件消息：用 path 对齐
    const snapPaths = (Array.isArray(snapshot.attachments) ? snapshot.attachments : [])
      .map(item => String(item?.path || '').trim())
      .filter(Boolean)
    if (snapPaths.length) {
      const nodePaths = new Set(getUserMessageNodeAttachmentPaths(node))
      if (snapPaths.some(path => nodePaths.has(path))) return true
    }
    if (Number.isFinite(Number(snapshot.historyIndex))
      && Number(node.dataset?.historyIndex) === Number(snapshot.historyIndex)
      && !nodeText) {
      return true
    }
    return false
  }

  function findRenderedUserSnapshot(project, snapshot) {
    const chatMessages = deps.getChatMessages?.()
    if (!chatMessages || !project || !snapshot) return null
    const key = getUserSnapshotKey(project, snapshot)
    const scopeKey = window.RunningUiRestore?.scopeKey?.(project) || `${project.id}\u001f${currentScopeSessionId(project)}`
    const userNodes = Array.from(chatMessages.querySelectorAll('.message.user:not(.message-user-interject)'))

    const anchored = userNodes.find(node =>
      node.dataset?.runningUserAnchor === scopeKey
      && node.dataset?.runningUserKey === key
      && userNodeMatchesSnapshot(node, snapshot)
    )
    if (anchored) return anchored

    const snapshotMessageId = String(snapshot.messageId || '').trim()
    if (snapshotMessageId) {
      const byMessageId = userNodes.find(node => String(node.dataset?.messageId || '').trim() === snapshotMessageId)
      if (byMessageId) return byMessageId
    }

    if (Number.isFinite(Number(snapshot.historyIndex))) {
      const byHistoryIndex = userNodes.find(node =>
        Number(node.dataset?.historyIndex) === Number(snapshot.historyIndex)
      )
      if (byHistoryIndex) return byHistoryIndex
    }

    // 内容/附件优先，避免 historyIndex 指到旧气泡
    const byBody = [...userNodes].reverse().find(node => userNodeMatchesSnapshot(node, snapshot))
    if (byBody) return byBody
    if (project.isRunning || deps.isProjectAiRunActive(project)) return null
    if (Number.isFinite(Number(snapshot.turnId))) {
      const byTurn = userNodes.find(node =>
        Number(node.dataset?.turnId) === Number(snapshot.turnId)
        && userNodeMatchesSnapshot(node, snapshot)
      )
      if (byTurn) return byTurn
    }
    return null
  }

  function placeLatestRunningUserMessageBeforeAi(project, aiMsg) {
    const chatMessages = deps.getChatMessages?.()
    if (!project || !chatMessages || !(project.isRunning || deps.isProjectAiRunActive(project))) return null
    const snapshot = getLatestVisibleUserSnapshot(project)
    if (!snapshot) return null

    // 未完成轮现在由虚拟历史稳定渲染；这里只复用并定位现有气泡，绝不再创建第二份。
    let userMsg = findRenderedUserSnapshot(project, snapshot)
    if (!userMsg) return null

    // 只清理同 messageId/historyIndex 或旧版临时创建的重复气泡；相同文案的历史轮不能误删。
    Array.from(chatMessages.querySelectorAll('.message.user:not(.message-user-interject)')).forEach(node => {
      if (node === userMsg) return
      const sameMessageId = snapshot.messageId && String(node.dataset?.messageId || '') === String(snapshot.messageId)
      const sameHistoryIndex = Number.isFinite(Number(snapshot.historyIndex)) &&
        Number(node.dataset?.historyIndex) === Number(snapshot.historyIndex)
      const legacyCreatedDuplicate = node.dataset?.runningUserCreated === '1' && userNodeMatchesSnapshot(node, snapshot)
      if (sameMessageId || sameHistoryIndex || legacyCreatedDuplicate) {
        try { node.remove() } catch (_) { /* ignore */ }
      }
    })

    const scopeKey = window.RunningUiRestore?.scopeKey?.(project) || `${project.id}\u001f${currentScopeSessionId(project)}`
    userMsg.dataset.runningUserAnchor = scopeKey
    userMsg.dataset.runningUserKey = getUserSnapshotKey(project, snapshot)
    userMsg.dataset.chatSessionId = currentScopeSessionId(project)
    delete userMsg.dataset.runningUserCreated

    // 把运行中这一整轮放到末尾：用户消息 → 本轮注入消息 → AI 执行块。
    // 不能只搬 user + ai，否则恢复/补挂时会把注入消息甩到 AI 块外面。
    try {
      if (aiMsg && chatMessages.contains(aiMsg)) {
        chatMessages.insertBefore(userMsg, aiMsg)
        const userTurnId = Number(userMsg.dataset?.turnId)
        const userMessageId = String(userMsg.dataset?.messageId || '').trim()
        const userHistoryIndex = Number(userMsg.dataset?.historyIndex)
        const interjects = Array.from(chatMessages.querySelectorAll('.message-user-interject')).filter(node => {
          const anchorMessageId = String(node.dataset?.anchorMessageId || '').trim()
          if (userMessageId && anchorMessageId) return userMessageId === anchorMessageId
          const anchorHistoryIndex = Number(node.dataset?.anchorHistoryIndex)
          if (Number.isFinite(userHistoryIndex) && Number.isFinite(anchorHistoryIndex)) {
            return userHistoryIndex === anchorHistoryIndex
          }
          return Number.isFinite(userTurnId) && Number(node.dataset?.anchorTurnId || node.dataset?.turnId) === userTurnId
        })
        interjects.forEach(node => chatMessages.insertBefore(node, aiMsg))
        chatMessages.appendChild(aiMsg)
      } else if (userMsg.parentNode !== chatMessages || chatMessages.lastElementChild !== userMsg) {
        chatMessages.appendChild(userMsg)
      }
    } catch (_) { /* ignore */ }
    return userMsg
  }

  function markLastRenderedUserAsRunningAnchor(project, snapshot = null) {
    // 不再把「当前 DOM 最后一个用户」标成 running anchor：
    // 历史尚未 mount 完时最后一个可能是旧轮，会污染后续匹配。
    // running anchor 只由 placeLatestRunningUserMessageBeforeAi 在确认最新快照后写入。
    return null
  }

  function restoreRunningInterjectMessages(project) {
    if (!project) return 0
    try {
      // 切回运行中会话时，历史/虚拟列表可能尚未把用户节点挂进 DOM。
      // 先用持久化的本轮用户快照重绑锚点，避免 renderInjectedUserMessage 找不到节点后
      // 降级 append 到容器末尾（即 AI 执行块下方）。只处理本轮开始后产生的注入消息。
      const snapshot = getLatestVisibleUserSnapshot(project)
      const sessionId = currentScopeSessionId(project)
      const runStartedAt = Number(project.aiRunStartedAt || project._aiState?.aiRunStartedAt || 0)
      if (snapshot && runStartedAt > 0 && Array.isArray(project._injectedInterjectMessages)) {
        project._injectedInterjectMessages.forEach(item => {
          if (String(item?.chatSessionId || 'main') !== sessionId) return
          if (Number(item?.injectedAt || 0) + 1000 < runStartedAt) return
          if (snapshot.messageId) item.anchorMessageId = String(snapshot.messageId)
          if (Number.isFinite(Number(snapshot.historyIndex))) item.anchorHistoryIndex = Number(snapshot.historyIndex)
          if (Number.isFinite(Number(snapshot.turnId)) && Number(snapshot.turnId) > 0) item.anchorTurnId = Number(snapshot.turnId)
        })
      }
      return window.MessageQueue?.restoreInjectedMessagesForProject?.(
        project.id,
        currentScopeSessionId(project),
        { minInjectedAt: runStartedAt }
      ) || 0
    } catch (error) {
      console.warn('[ProjectSwitcher] restore injected messages failed:', error)
      return 0
    }
  }

  function restoreDeps() {
    return {
      setCurrentAiMsg: v => deps.setCurrentAiMsg?.(v),
      setCurrentToolCount: v => deps.setCurrentToolCount?.(v),
      setCurrentOpCount: v => deps.setCurrentOpCount?.(v),
      resumeRunningAiMessage: (...a) => deps.resumeRunningAiMessage?.(...a),
      cacheAiRuntimeForProject: (...a) => deps.cacheAiRuntimeForProject?.(...a),
      replayProjectAiOperations: (...a) => window.AiRuntimeCache?.replayProjectAiOperations?.(...a),
      createAiMessage: (...a) => deps.createAiMessage?.(...a) || window.AiMessageUI?.createAiMessage?.(...a),
      getActiveProjectId: () => deps.getActiveProjectId?.()
    }
  }

  function hasRunningUiEvidence(project) {
    if (!project) return false
    if (window.RunningUiRestore?.isCurrentSessionRunning && !window.RunningUiRestore.isCurrentSessionRunning(project)) return false
    if (window.RunningUiRestore?.hasEvidence?.(project)) return true
    return !!(
      project.isRunning ||
      project.awaitingFinalReply ||
      deps.isProjectAiRunActive?.(project) ||
      project.aiRunningState?.html ||
      project._frozenAiHtml ||
      project.savedAiMsg ||
      project._pendingRunningUiRestore ||
      (Array.isArray(project.aiOperations) && project.aiOperations.length > 0)
    )
  }

  function placeRunningAiBlockAtEnd(project, options = {}) {
    const chatMessages = deps.getChatMessages?.()
    if (!project || !chatMessages || !hasRunningUiEvidence(project)) return null
    project.isRunning = true

    // 优先走独立恢复模块（冻结 HTML Map + ops 补播）
    let aiMsg = null
    if (window.RunningUiRestore?.restoreToContainer) {
      aiMsg = window.RunningUiRestore.restoreToContainer(project, {
        container: chatMessages,
        deps: restoreDeps(),
        replay: options.replay !== false,
        forceRebuild: options.forceSnapshot === true
      })
    }
    if (!aiMsg) {
      aiMsg = deps.ensureRunningAiBlockVisible?.(project, {
        replay: options.replay !== false,
        forceSnapshot: options.forceSnapshot === true
      }) || null
    }
    if (!aiMsg) return null
    if (project.id) aiMsg.dataset.projectId = project.id
    aiMsg.dataset.chatSessionId = window.RunningUiRestore?.currentSessionId?.(project) || String(project.chatSessionId || '').trim() || 'main'
    // 先保证 AI 在容器内，再放最新用户消息到其正上方
    if (aiMsg.parentNode !== chatMessages || chatMessages.lastElementChild !== aiMsg) {
      chatMessages.appendChild(aiMsg)
    }
    placeLatestRunningUserMessageBeforeAi(project, aiMsg)
    // DOM 恢复可能由分页器和运行态快照交错完成；在 AI 块落位后再次按持久锚点归位。
    window.MessageQueue?.relocatePendingInterjectMessages?.()
    // placeLatest 后再次确保 AI 仍在最底部（用户气泡紧贴其前）
    if (aiMsg.parentNode === chatMessages && chatMessages.lastElementChild !== aiMsg) {
      chatMessages.appendChild(aiMsg)
    }
    aiMsg.classList?.add('thinking')
    deps.setCurrentAiMsg?.(aiMsg)
    deps.resumeRunningAiMessage?.(aiMsg)
    if (project._aiState) project._aiState.currentAiMsg = aiMsg
    focusRunningTurn(project, aiMsg, { container: chatMessages })
    return aiMsg
  }

  function freezeLeavingProjectUi(currentProject, chatMessages) {
    if (!currentProject) return null
    const hasLiveRun = !!(
      currentProject.isRunning ||
      currentProject.awaitingFinalReply ||
      (Number(currentProject.aiRunStartedAt || currentProject._aiState?.aiRunStartedAt || 0) > 0
        && Number(currentProject.aiRunCompletedAt || currentProject._aiState?.aiRunCompletedAt || 0) <= 0)
    )
    // 已完成的最后一条 AI 正文不能被重新冻结成“运行中”快照。
    if (!hasLiveRun) return null
    const pointedAiMsg = deps.getCurrentAiMsg?.() || null
    const pointerBelongsToLeavingProject = !!(
      pointedAiMsg &&
      document.contains(pointedAiMsg) &&
      (!pointedAiMsg.dataset?.projectId || pointedAiMsg.dataset.projectId === currentProject.id)
    )
    const leavingAiMsg = (pointerBelongsToLeavingProject ? pointedAiMsg : null)
      || window.RunningUiRestore?.findLiveRunningAiMsg?.(chatMessages, currentProject)
      || chatMessages?.querySelector?.('.message.ai.thinking')
      || null

    currentProject.savedAiMsg = leavingAiMsg || currentProject.savedAiMsg || null
    currentProject.savedToolCount = deps.getCurrentToolCount?.() || 0
    currentProject.savedOpCount = deps.getCurrentOpCount?.() || 0

    if (leavingAiMsg && document.contains(leavingAiMsg)) {
      const dyn = leavingAiMsg.querySelector?.('.ai-dynamic-area')
      const hasDomContent = !!(dyn && (dyn.children?.length || String(dyn.textContent || '').trim()))
        || !!leavingAiMsg.querySelector?.('.ai-deep-reasoning-block, .ai-thinking-block, .tool-call-group')
      currentProject.savedOperationCount = hasDomContent
        ? (Array.isArray(currentProject.aiOperations) ? currentProject.aiOperations.length : 0)
        : 0
    }

    // 独立 Map 冻结（不依赖 live DOM / project 字段是否被清）
    const snap = window.RunningUiRestore?.freezeLeavingProject?.(currentProject, {
      container: chatMessages,
      aiMsg: leavingAiMsg,
      toolCount: currentProject.savedToolCount,
      opCount: currentProject.savedOpCount,
      force: false
    }) || null

    if (leavingAiMsg) {
      deps.cacheAiRuntimeForProject?.(currentProject, leavingAiMsg)
      currentProject._lastSnapshotHtmlAt = 0
      deps.captureRunningAiSnapshot?.(currentProject, leavingAiMsg, { force: true })
    }

    if (snap || leavingAiMsg || hasRunningUiEvidence(currentProject)) {
      currentProject.isRunning = true
      currentProject._pendingRunningUiRestore = true
    }
    return snap
  }

  // 切换项目（保存当前状态，恢复目标项目状态）
  async function switchProject(projectId) {
    const projects = deps.getProjects()
    const activeProjectId = deps.getActiveProjectId()
    const inputBox = deps.getInputBox()
    const chatMessages = deps.getChatMessages()
    returnToChatArea()
    deps.syncProjectState()
    const project = projects.find(p => p.id === projectId || p.path === projectId)
    if (!project) return
    if (project.id === activeProjectId) {
      deps.setActiveProject(project.id)
      deps.clearViewedProjectActivity(project, { sessionId: project.chatSessionId || '' })
      project.lastOpenedAt = Date.now()
      deps.setChatInputVisible(!project.stateless)
      deps.setCurrentProjectPath(project.path)
      deps.renderProjectList()
      deps.updateProjectDisplay()
      deps.renderActiveCacheUsageStrip()
      if (hasRunningUiEvidence(project)) {
        project.isRunning = true
        restoreRunningInterjectMessages(project)
        placeRunningAiBlockAtEnd(project, { replay: true, forceSnapshot: true })
        window.RunningUiRestore?.armGuard?.(project, {
          container: deps.getChatMessages?.(),
          deps: restoreDeps(),
          durationMs: 2000
        })
        deps.syncAiStateToProject()
      }
      deps.updateSendBtnState()
      return
    }
    const switchSeq = ++projectSwitchSeq

    // 保存当前项目的输入框内容 + 冻结运行中 AI UI（必须在 leave 清空 DOM 之前）
    const currentProject = deps.getActiveProject()
    if (currentProject) {
      currentProject.inputDraft = inputBox.value || ''
      currentProject.execMode = deps.getExecutionMode()
      rememberLatestVisibleUserMessage(currentProject)
      freezeLeavingProjectUi(currentProject, chatMessages)
    }

    // 保存当前项目的AI UI状态（立即同步，避免 rAF 时 active 已切走）
    // 注意：sync 可能再次 capture；冻结 Map 已在上方写好，这里不要清掉
    deps.syncAiStateToProject(true)
    deps.setCurrentAiMsg(null)
    deps.setCurrentToolCount(0)
    deps.setCurrentOpCount(0)
    deps.setCurrentThinkingBlock(null)
    deps.setCurrentThinkingStartTime(null)
    deps.setCurrentChangeSession(null)

    // 切换激活项目
    deps.setActiveProject(project.id)
    deps.clearViewedProjectActivity(project, { sessionId: project.chatSessionId || '' })
    project.lastOpenedAt = Date.now()
    deps.getAiChangePill()?.clear?.()
    deps.setCurrentProjectPath(project.path)
    deps.renderProjectList()
    deps.updateProjectDisplay()
    deps.renderActiveCacheUsageStrip()
    deps.updateSendBtnState()
    deps.saveProjectsList(project.path).catch(err => console.warn('[Frontend] saveProjectsList on switch failed:', err))

    // 恢复目标项目的输入框内容
    deps.setChatInputVisible(!project.stateless)
    inputBox.value = project.inputDraft || ''
    deps.updateWorkbenchMentionHighlight()

    // 恢复目标项目的授权模式（与设置页 AI 授权同步）
    // 旧值 auto/critical 映射为 ask（更安全），smart/full 保留。
    let permissionMode = 'ask'
    try {
      const permissions = await window.api?.getPathPermissions?.()
      permissionMode = ['ask', 'smart', 'full'].includes(permissions?.mode) ? permissions.mode : 'ask'
    } catch (error) {}
    project.execMode = permissionMode
    deps.setExecutionMode(permissionMode)
    deps.updateExecModeUI(permissionMode)

    // 保留执行计划状态，并恢复输入框上方待办面板。
    deps.setCurrentPhase(project.progressPhase || 'normal')
    deps.setPlanSteps(project.progressSteps || [])
    deps.setCurrentStepIndex(project.progressStepIndex || 0)
    deps.setIsProgressExpanded?.(!!project.progressExpanded)
    deps.updateExecutionProgress?.({
      steps: project.progressSteps || [],
      currentStepIndex: project.progressStepIndex || 0,
      phase: project.progressPhaseLabel || ''
    })

    // 切换 Agent 面板到新项目
    if (typeof AgentUI !== 'undefined') {
      AgentUI.setActiveProject(project.id)
    }

    // 清理上下文压缩状态卡（切项目时清掉）
    if (window.ContextCompressionStatus?.clearForProjectSwitch) {
      window.ContextCompressionStatus.clearForProjectSwitch()
    }

    // 离开旧项目：销毁虚拟滚动/分页，压缩旧项目内存历史，再清空 DOM
    // 注意：此处 active 已切到新项目，离开的对象用上方保存的 currentProject
    if (window.ChatSessionCleanup?.leaveProject) {
      window.ChatSessionCleanup.leaveProject({ container: chatMessages, project: currentProject })
    } else {
      window.ChatVirtualScroller?.destroy?.(chatMessages)
      window.ChatHistoryPaginator?.destroy?.()
      chatMessages.innerHTML = ''
    }
    const shouldRestoreRunningUi = hasRunningUiEvidence(project)
    if (shouldRestoreRunningUi) {
      project.isRunning = true
      project._pendingRunningUiRestore = true
    }

    const restoreRunningUi = (reason = '', opts = {}) => {
      if (switchSeq !== projectSwitchSeq || project.id !== deps.getActiveProjectId()) return null
      if (!hasRunningUiEvidence(project) && !opts.force) return null
      project.isRunning = true
      markLastRenderedUserAsRunningAnchor(project, getLatestVisibleUserSnapshot(project))
      restoreRunningInterjectMessages(project)
      const aiMsg = placeRunningAiBlockAtEnd(project, {
        replay: true,
        forceSnapshot: opts.forceSnapshot === true
      })
      deps.syncAiStateToProject?.(true)
      deps.updateSendBtnState?.()
      project._lastRunningUiRestoreAt = Date.now()
      project._lastRunningUiRestoreReason = reason
      runningUiRestored = !!aiMsg
      // 启动短时 DOM 守卫：scroller/历史若再清空会自动挂回
      window.RunningUiRestore?.armGuard?.(project, {
        container: chatMessages,
        deps: restoreDeps(),
        durationMs: 1000
      })
      return aiMsg
    }
    // 从后端获取目标项目的完整历史消息并恢复显示
    // 如果 AI 正在运行，恢复用户消息但排除可能不完整的 AI 回复
    let historyRenderPending = false
    let runningUiRestored = false
    if (window.api) {
      const targetData = window.api.getChatHistoryPage
        ? await window.api.getChatHistoryPage(project.id, { pageChunks: 1, direction: 'older' })
        : await window.api.getChatHistory(project.id)
      if (switchSeq !== projectSwitchSeq || project.id !== deps.getActiveProjectId()) return
      const remoteMessages = targetData?.messages || targetData?.messagesHistory || []
      // 运行中强制保留本地 tail，避免远端尚未落盘导致用户消息/过程锚点丢失
      const targetMessagesHistory = mergeProjectMessagesHistory(project, remoteMessages, {
        branchSessionPath: targetData?.branchSessionPath || '',
        currentChatSessionId: project.chatSessionId,
        incomingChatSessionId: targetData?.chatSessionId,
        preserveLocalTail: true
      })
      if (targetData) syncProjectBranchSession(project, { ...targetData, messagesHistory: targetMessagesHistory, preserveLocalTail: true })
      const hasActiveAiRun = hasRunningUiEvidence(project)
      if (targetMessagesHistory.length > 0) {
        let historyToRestore = targetMessagesHistory
        if (hasActiveAiRun) {
          project.isRunning = true
          historyToRestore = deps.stripActiveRunHistory(historyToRestore)
        }
        // 兜底：strip 后仍空但本地有用户消息时，用本地 strip 结果
        if ((!historyToRestore || !historyToRestore.length) && Array.isArray(project.messagesHistory) && project.messagesHistory.length) {
          historyToRestore = hasActiveAiRun
            ? deps.stripActiveRunHistory(project.messagesHistory)
            : project.messagesHistory
        }
        if (historyToRestore.length > 0) {
          const paginator = window.ChatHistoryPaginator
          const renderer = deps.getChatRenderer ? deps.getChatRenderer() : null
          if (paginator && renderer && (targetData?.range || historyToRestore.length)) {
            const range = targetData?.range || {
              startIndex: 0,
              endIndex: historyToRestore.length,
              totalChunks: 1
            }
            historyRenderPending = !!hasActiveAiRun
            paginator.reset({
              container: chatMessages,
              renderer,
              messagesHistory: historyToRestore,
              projectId: project.id,
              projectPath: project.path,
              range,
              nextCursor: targetData?.nextCursor,
              hasMore: targetData?.hasMore,
              scrollTo: 'bottom',
              afterRender: () => {
                historyRenderPending = false
                if (!hasActiveAiRun) return
                // scroller onReady 后强制恢复运行中 UI
                restoreRunningUi('after-history-ready', { forceSnapshot: true })
              }
            })
          } else {
            deps.restoreChatHistory(historyToRestore, { projectPath: project.path, source: 'replace' })
            if (hasActiveAiRun) restoreRunningUi('after-history-sync', { forceSnapshot: true })
          }
        }
        // 同步恢复 project.history（排除运行中的最后一轮）
        project.history = deps.mapMessagesHistoryForProject(historyToRestore)
      } else {
        // 远端空历史：若本地仍有消息（运行中常见），用本地渲染
        const localHistory = Array.isArray(project.messagesHistory) ? project.messagesHistory : []
        if (localHistory.length > 0) {
          const historyToRestore = hasActiveAiRun
            ? deps.stripActiveRunHistory(localHistory)
            : localHistory
          if (historyToRestore.length > 0) {
            deps.restoreChatHistory(historyToRestore, { projectPath: project.path, source: 'replace' })
            project.history = deps.mapMessagesHistoryForProject(historyToRestore)
          } else {
            project.history = []
          }
        } else {
          project.history = []
        }
      }
    }

    // 历史已经绑定到目标项目，此时立即刷新压缩数字；不要等待其他状态请求。
    window.ContextCompressionStack?.refresh?.({
      retry: false,
      projectId: project.id,
      __tag: 'project-history-ready'
    })

    // 恢复保存的 AI 消息框架（直接恢复引用，不重新创建）
    const hasActiveAiRun = hasRunningUiEvidence(project)
    if (hasActiveAiRun) {
      project.isRunning = true
      project._pendingRunningUiRestore = true
    } else {
      // 恢复目标项目的AI UI状态
      deps.syncAiStateFromProject()
      // 非运行项目不需要aiOperations（已在onReply时清空）
    }

    if (hasActiveAiRun && !historyRenderPending && !runningUiRestored) {
      restoreRunningUi('history-stable', { forceSnapshot: true })
    }

    // 更新模型选择显示
    const projectModel = deps.getProjectModel(project)
    if (projectModel) {
      deps.getModelCurrent().textContent = projectModel.modelName
    }

    // 更新技能选择显示（跟随项目切换）
    deps.setCurrentSkill(project.skillName || null)
    deps.updateSkillButton()

    // 更新上下文状态显示

    // 更新项目路径
    deps.setCurrentProjectPath(project.path)

    // 更新项目列表UI
    deps.renderProjectList()

    // 按当前项目过滤右侧协作 tab，并自动展开/收起右侧面板
    deps.getWindowTabsFeature()?.setActiveProjectCollabFilter?.(project.id)

    // 更新发送按钮状态
    deps.updateSendBtnState()

    if (!historyRenderPending && !runningUiRestored) deps.scrollToLatestAiMessage()

    // 从主进程获取该项目的最新上下文状态
    if (window.api) {
      const modelName = deps.getProjectModelName(project)
      const status = await window.api.getContextStatus(project.id, modelName)
      if (switchSeq !== projectSwitchSeq || project.id !== deps.getActiveProjectId()) return
      project.contextStatus = status

      // 加载 Git 状态
      deps.loadGitStatusForProject(project)
      deps.getTerminalPanel()?.refresh?.(project.id)
    }
  }

  function deriveBranchTitle(messagesHistory, fallback = '') {
    const firstUserMsg = (messagesHistory || []).find(msg => msg?.role === 'user' && !msg.hidden)
    const raw = String(firstUserMsg?.displayContent || firstUserMsg?.content || '').replace(/\s+/g, ' ').trim()
    if (!raw) return fallback || ''
    return raw.length > 30 ? `${raw.slice(0, 30)}...` : raw
  }

  function normalizeBranchName(branchName = '') {
    const value = String(branchName || '').trim()
    return value && !['workspace', '-', '未开启', '未选择'].includes(value) ? value : ''
  }

  function normalizeHistoryContent(message = {}) {
    return String(message.displayContent || message.content || '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 2000)
  }

  function historyMessageFingerprint(message = {}) {
    return [
      message.role || '',
      normalizeHistoryContent(message),
      message.hidden ? 'hidden' : 'visible',
      message.name || '',
      message.tool_call_id || message.toolCallId || ''
    ].join('\u001f')
  }

  function shouldPreserveLocalHistory(project) {
    if (window.RunningUiRestore?.isCurrentSessionRunning && !window.RunningUiRestore.isCurrentSessionRunning(project)) return false
    return !!(
      project?.isRunning ||
      project?.awaitingFinalReply ||
      project?.aiRunningState?.html ||
      project?._frozenAiHtml ||
      project?._pendingRunningUiRestore ||
      project?.savedAiMsg ||
      window.RunningUiRestore?.hasSnapshot?.(project) ||
      (Array.isArray(project?.aiOperations) && project.aiOperations.length > 0) ||
      deps.isProjectAiRunActive?.(project)
    )
  }

  function mergeMessagesHistory(remoteMessages = [], localMessages = [], options = {}) {
    const remote = Array.isArray(remoteMessages) ? remoteMessages.slice() : []
    const local = Array.isArray(localMessages) ? localMessages.slice() : []
    if (!local.length) return remote
    if (!remote.length) return options.preserveLocal ? local : remote

    // 同指纹消息：远程缺 attachments 时用本地补上（避免切项目丢缩略图元数据）
    const localByFingerprint = new Map()
    for (const message of local) {
      localByFingerprint.set(historyMessageFingerprint(message), message)
    }
    const mergedRemote = remote.map(message => {
      const localMsg = localByFingerprint.get(historyMessageFingerprint(message))
      if (!localMsg) return message
      const remoteAtt = Array.isArray(message.attachments) ? message.attachments : []
      const localAtt = Array.isArray(localMsg.attachments) ? localMsg.attachments : []
      if (localAtt.length > 0 && remoteAtt.length === 0) {
        return { ...message, attachments: localAtt }
      }
      if (localAtt.length > 0 && remoteAtt.length > 0) {
        const hasPath = (list) => list.some(item => item && item.path)
        if (!hasPath(remoteAtt) && hasPath(localAtt)) {
          return { ...message, attachments: localAtt }
        }
      }
      return message
    })

    if (!options.preserveLocal) return mergedRemote

    const remoteKeys = new Set(mergedRemote.map(historyMessageFingerprint))
    let lastCommonLocalIndex = -1
    for (let i = local.length - 1; i >= 0; i -= 1) {
      if (remoteKeys.has(historyMessageFingerprint(local[i]))) {
        lastCommonLocalIndex = i
        break
      }
    }

    if (lastCommonLocalIndex < 0) return mergedRemote

    const localTail = local.slice(lastCommonLocalIndex + 1)
    const missingTail = []
    for (const message of localTail) {
      const key = historyMessageFingerprint(message)
      if (!remoteKeys.has(key)) {
        missingTail.push(message)
        remoteKeys.add(key)
      }
    }

    return missingTail.length > 0 ? mergedRemote.concat(missingTail) : mergedRemote
  }

  function mergeProjectMessagesHistory(project, remoteMessages = [], options = {}) {
    const currentBranchSessionPath = options.currentBranchSessionPath ?? project?.branchSessionPath ?? ''
    const incomingBranchSessionPath = options.branchSessionPath || ''
    const sameBranchSession = !currentBranchSessionPath || !incomingBranchSessionPath || currentBranchSessionPath === incomingBranchSessionPath
    const currentChatSessionId = String(options.currentChatSessionId ?? project?.chatSessionId ?? '').trim() || 'main'
    const incomingChatSessionId = String(options.incomingChatSessionId ?? currentChatSessionId).trim() || 'main'
    const sameChatSession = currentChatSessionId === incomingChatSessionId
    const preserveLocalTail = sameBranchSession && sameChatSession && options.preserveLocalTail !== false
    return mergeMessagesHistory(remoteMessages, project?.messagesHistory || [], {
      preserveLocal: sameBranchSession && sameChatSession && (
        preserveLocalTail || shouldPreserveLocalHistory(project)
      )
    })
  }

  function syncProjectBranchSession(project, payload = {}) {
    if (!project || !payload) return
    const currentBranchSessionPath = project.branchSessionPath || ''
    const currentChatSessionId = String(project.chatSessionId || '').trim() || 'main'
    project.branchName = normalizeBranchName(payload.branchName || project.gitStatus?.branch || project.branchName || '')
    project.branchKey = payload.branchKey || project.branchKey || ''
    project.branchSessionPath = payload.branchSessionPath || project.branchSessionPath || ''
    // 后端空标题不能覆盖本地已有分支标题（例如消息前缀标题）
    const incomingBranchTitle = String(payload.branchTitle || '').trim()
    if (incomingBranchTitle) {
      project.branchTitle = incomingBranchTitle
    } else if (!String(project.branchTitle || '').trim()) {
      project.branchTitle = deriveBranchTitle(payload.messagesHistory || [], '')
    }
    if (Array.isArray(payload.branchSessions)) {
      const localByName = new Map(
        (project.branchSessions || [])
          .filter(item => item?.branchName)
          .map(item => [String(item.branchName), item])
      )
      project.branchSessions = payload.branchSessions.map(session => {
        const local = localByName.get(String(session?.branchName || ''))
        const remoteTitle = String(session?.title || '').trim()
        const localTitle = String(local?.title || '').trim()
        return {
          ...local,
          ...session,
          title: remoteTitle || localTitle || (session?.isMainline ? '主线会话' : '')
        }
      })
    }
    // 同步同项目多会话列表，保证侧栏能同时显示原会话 + 新会话
    if (Array.isArray(payload.chatSessions)) {
      project.chatSessions = payload.chatSessions
    }
    if (Object.prototype.hasOwnProperty.call(payload, 'chatSessionId')) project.chatSessionId = payload.chatSessionId || ''
    if (Object.prototype.hasOwnProperty.call(payload, 'chatSessionTitle')) project.chatSessionTitle = payload.chatSessionTitle || ''
    if (Object.prototype.hasOwnProperty.call(payload, 'chatSessionPath')) project.chatSessionPath = payload.chatSessionPath || ''
    if (Array.isArray(payload.messagesHistory)) {
      project.messagesHistory = mergeProjectMessagesHistory(project, payload.messagesHistory, {
        branchSessionPath: payload.branchSessionPath || '',
        currentBranchSessionPath,
        currentChatSessionId,
        incomingChatSessionId: payload.chatSessionId,
        preserveLocalTail: payload.preserveLocalTail !== false
      })
    }
  }

  async function reloadActiveBranchSession(options = {}) {
    const project = deps.getActiveProject()
    const chatMessages = deps.getChatMessages()
    if (!project || !window.api?.getChatHistory) return null
    if (hasRunningUiEvidence(project) && !options.force) return null

    const result = options.result || (window.api.getChatHistoryPage
      ? await window.api.getChatHistoryPage(project.id, { pageChunks: 1, direction: 'older' })
      : await window.api.getChatHistory(project.id))
    if (!result?.success) {
      deps.showToast(result?.error || '加载分支会话失败', 'error')
      return result
    }

    const messagesHistory = mergeProjectMessagesHistory(project, result.messages || result.messagesHistory || [], {
      branchSessionPath: result.branchSessionPath || '',
      currentChatSessionId: project.chatSessionId,
      incomingChatSessionId: result.chatSessionId,
      preserveLocalTail: !options.force
    })
    syncProjectBranchSession(project, { ...result, messagesHistory, preserveLocalTail: !options.force })
    const hasActiveAiRun = hasRunningUiEvidence(project)
    const historyToRestore = hasActiveAiRun ? deps.stripActiveRunHistory(messagesHistory) : messagesHistory
    project.history = deps.mapMessagesHistoryForProject(historyToRestore)
    let historyRenderPending = false
    if (window.ChatSessionCleanup?.destroyChatViews) {
      window.ChatSessionCleanup.destroyChatViews(chatMessages)
    } else {
      window.ChatVirtualScroller?.destroy?.(chatMessages)
      window.ChatHistoryPaginator?.destroy?.()
      chatMessages.innerHTML = ''
    }
    let runningUiRestored = false
    if (hasActiveAiRun) {
      project.isRunning = true
      project._pendingRunningUiRestore = true
    }
    const restoreStableRunningUi = () => {
      if (!hasActiveAiRun || runningUiRestored || !hasRunningUiEvidence(project)) return null
      if (project.id !== deps.getActiveProjectId?.()) return null
      markLastRenderedUserAsRunningAnchor(project, getLatestVisibleUserSnapshot(project))
      restoreRunningInterjectMessages(project)
      const aiMsg = placeRunningAiBlockAtEnd(project, { replay: true, forceSnapshot: true })
      if (!aiMsg) return null
      runningUiRestored = true
      deps.syncAiStateToProject(true)
      window.RunningUiRestore?.armGuard?.(project, {
        container: chatMessages,
        deps: restoreDeps(),
        durationMs: 1000
      })
      return aiMsg
    }
    if (historyToRestore.length > 0) {
      const renderer = deps.getChatRenderer ? deps.getChatRenderer() : null
      const paginator = window.ChatHistoryPaginator
      if (paginator && renderer && result.range) {
        historyRenderPending = !!hasActiveAiRun
        paginator.reset({
          container: chatMessages,
          renderer,
          messagesHistory: historyToRestore,
          projectId: project.id,
          projectPath: project.path,
          range: result.range,
          nextCursor: result.nextCursor,
          hasMore: result.hasMore,
          scrollTo: 'bottom',
          afterRender: hasActiveAiRun ? () => {
                historyRenderPending = false
                restoreStableRunningUi()
              } : null
        })
      } else {
        deps.restoreChatHistory(historyToRestore, { projectPath: project.path })
      }
    } else {
      deps.renderChatHistory()
    }
    if (hasActiveAiRun && !historyRenderPending) restoreStableRunningUi()
    deps.renderProjectList()
    if (!historyRenderPending && !runningUiRestored) deps.scrollToLatestAiMessage()
    deps.loadContextStatus()
    return result
  }

  function bind(depsObj = {}) {
    deps = depsObj
  }

  window.ProjectSwitcher = {
    bind,
    returnToChatArea,
    focusRunningTurn,
    switchProject,
    deriveBranchTitle,
    mergeMessagesHistory,
    syncProjectBranchSession,
    reloadActiveBranchSession
  }
})()
