// AI运行时缓存与快照模块
// 负责项目AI运行时状态的缓存、快照捕获/恢复、运行时重连和操作重放。
// 通过 window.AiRuntimeCache.bind(deps) 注入依赖后使用。

(function () {
  const projectAiRuntimeCache = new Map()
  let deps = {}

  function getProjectRuntimeKey(project, sessionId) {
    if (!project) return ''
    if (window.RunningUiRestore?.scopeKey) {
      return window.RunningUiRestore.scopeKey(project, sessionId)
    }
    const pid = project?.id || project?.path || ''
    const sid = String(sessionId ?? project?.chatSessionId ?? '').trim() || 'main'
    return pid ? `${pid}\u001f${sid}` : ''
  }

  function getCachedAiRuntime(project, sessionId) {
    const key = getProjectRuntimeKey(project, sessionId)
    return key ? projectAiRuntimeCache.get(key) || null : null
  }

  function isAiMessageShellEmpty(aiMsg) {
    if (!aiMsg) return true
    const area = aiMsg.querySelector?.('.ai-dynamic-area')
    if (!area) return true
    if (area.children && area.children.length > 0) return false
    // 深度思考块可能挂在 dynamic-area 外的兄弟节点上
    if (aiMsg.querySelector?.('.ai-deep-reasoning-block, .ai-thinking-block, .tool-call-group, .ai-work-segment')) {
      return false
    }
    return !String(area.textContent || '').trim()
  }

  function countAiVisualNodes(aiMsg) {
    if (!aiMsg) return 0
    return aiMsg.querySelectorAll?.(
      '.ai-dynamic-area > *, .ai-deep-reasoning-block, .ai-thinking-block, .tool-call-group, .ai-work-segment, .intermediate-content-block'
    )?.length || 0
  }

  function cacheAiRuntimeForProject(project, aiMsg) {
    const currentAiMsg = aiMsg || (deps.getCurrentAiMsg ? deps.getCurrentAiMsg() : null)
    const sessionId = window.RunningUiRestore?.runningSessionId?.(
      project,
      currentAiMsg?.dataset?.chatSessionId
    ) || String(project?._runningSessionId || project?.chatSessionId || '').trim() || 'main'
    const key = getProjectRuntimeKey(project, sessionId)
    if (!key || !currentAiMsg) return null
    if (project?.id) currentAiMsg.dataset.projectId = project.id
    currentAiMsg.dataset.chatSessionId = sessionId
    const hasDomContent = !isAiMessageShellEmpty(currentAiMsg)
    // 仅当 DOM 已有可视化内容时，才把 operationCount 记为全量；
    // 否则切回后会「空壳 + startIndex=length」跳过回放
    const opLen = Array.isArray(project?.aiOperations) ? project.aiOperations.length : 0
    const prev = projectAiRuntimeCache.get(key)
    const operationCount = hasDomContent
      ? opLen
      : Math.min(opLen, Number(prev?.operationCount ?? project?.savedOperationCount ?? 0) || 0)
    const runtime = {
      aiMsg: currentAiMsg,
      toolCount: (deps.getCurrentToolCount ? deps.getCurrentToolCount() : 0) || 0,
      opCount: (deps.getCurrentOpCount ? deps.getCurrentOpCount() : 0) || 0,
      changeSession: (deps.getCurrentChangeSession ? deps.getCurrentChangeSession() : null) || null,
      operationCount,
      visualCount: countAiVisualNodes(currentAiMsg)
    }
    projectAiRuntimeCache.set(key, runtime)
    if (project) {
      project.savedAiMsg = currentAiMsg
      project.savedToolCount = runtime.toolCount
      project.savedOpCount = runtime.opCount
      if (hasDomContent) project.savedOperationCount = runtime.operationCount
    }
    return runtime
  }

  function clearAiRuntimeForProject(projectOrId, sessionId) {
    if (!projectOrId) return
    if (typeof projectOrId === 'string' && sessionId === undefined) {
      const prefix = `${projectOrId}\u001f`
      for (const key of projectAiRuntimeCache.keys()) {
        if (key === projectOrId || key.startsWith(prefix)) projectAiRuntimeCache.delete(key)
      }
      return
    }
    const key = typeof projectOrId === 'string'
      ? `${projectOrId}\u001f${String(sessionId || '').trim() || 'main'}`
      : getProjectRuntimeKey(projectOrId, sessionId)
    if (key) projectAiRuntimeCache.delete(key)
  }

  /**
   * 捕获运行中 AI 消息的独立 HTML 快照（字符串，不依赖 live DOM）。
   * force=true 时绕过节流，用于切项目离开瞬间。
   */
  function captureRunningAiSnapshot(project, aiMsg, options = {}) {
    const currentAiMsg = aiMsg || (deps.getCurrentAiMsg ? deps.getCurrentAiMsg() : null)
    if (!project || !currentAiMsg) return
    cacheAiRuntimeForProject(project, currentAiMsg)
    const currentToolCount = deps.getCurrentToolCount ? deps.getCurrentToolCount() : 0
    const currentOpCount = deps.getCurrentOpCount ? deps.getCurrentOpCount() : 0
    project.savedAiMsg = currentAiMsg
    project.savedToolCount = currentToolCount || 0
    project.savedOpCount = currentOpCount || 0

    const force = options.force === true
    const now = Date.now()
    if (!project._lastSnapshotHtmlAt) project._lastSnapshotHtmlAt = 0
    if (!project._lastSnapshotHtml) project._lastSnapshotHtml = ''
    let html = project._lastSnapshotHtml
    const maxSnapshotChars = 400000
    if (force || now - project._lastSnapshotHtmlAt >= 1500 || !html) {
      // 优先完整 innerHTML；过大时截断但仍尽量保留过程区
      const nextHtml = currentAiMsg.innerHTML || ''
      html = nextHtml.length > maxSnapshotChars
        ? nextHtml.slice(0, maxSnapshotChars)
        : nextHtml
      project._lastSnapshotHtml = html
      project._lastSnapshotHtmlAt = now
    }

    // 冻结字符串副本，切项目后 DOM 被 destroy 也不丢
    project._frozenAiHtml = html
    project._frozenAiClassName = currentAiMsg.className || 'message ai thinking'
    project._frozenAiDataset = { ...currentAiMsg.dataset }
    project._frozenAiVisualCount = countAiVisualNodes(currentAiMsg)
    project._frozenAt = now
    const opLenAtFreeze = Array.isArray(project.aiOperations) ? project.aiOperations.length : 0
    project._frozenOpCount = opLenAtFreeze

    project.aiRunningState = {
      html,
      className: project._frozenAiClassName,
      dataset: project._frozenAiDataset,
      toolCount: currentToolCount || 0,
      opCount: currentOpCount || 0,
      visualCount: project._frozenAiVisualCount || 0,
      _opCountAtFreeze: opLenAtFreeze
    }
    if (!isAiMessageShellEmpty(currentAiMsg)) {
      project.savedOperationCount = opLenAtFreeze
    }
    // 同步写入独立快照仓，避免只靠 project 字段
    try {
      if (force || !isAiMessageShellEmpty(currentAiMsg)) {
        window.RunningUiRestore?.freezeFromElement?.(project, currentAiMsg, {
          toolCount: currentToolCount || 0,
          opCount: currentOpCount || 0
        })
      }
    } catch (_) { /* ignore */ }
  }

  function restoreAiMessageFromSnapshot(project) {
    if (window.RunningUiRestore?.isCurrentSessionRunning && !window.RunningUiRestore.isCurrentSessionRunning(project)) return null
    const snapshot = project?.aiRunningState
    const html = snapshot?.html || project?._frozenAiHtml || ''
    if (!html) return null
    const aiMsgEl = document.createElement('div')
    aiMsgEl.className = snapshot?.className || project?._frozenAiClassName || 'message ai thinking'
    try {
      aiMsgEl.innerHTML = html
    } catch (error) {
      console.warn('[AiRuntimeCache] restore snapshot html failed:', error)
      return null
    }
    const dataset = (snapshot?.dataset && typeof snapshot.dataset === 'object')
      ? snapshot.dataset
      : (project?._frozenAiDataset || {})
    Object.entries(dataset).forEach(([key, value]) => {
      if (value != null) aiMsgEl.dataset[key] = value
    })
    if (project?.id) aiMsgEl.dataset.projectId = project.id
    aiMsgEl.dataset.chatSessionId = window.RunningUiRestore?.currentSessionId?.(project) || String(project?.chatSessionId || '').trim() || 'main'
    return aiMsgEl
  }

  function resumeRunningAiMessage(aiMsg) {
    if (!aiMsg) return
    aiMsg.classList.add('thinking')
    deps.updateWorkStatus?.('working')
    const aiMessageUI = deps.getAiMessageUI ? deps.getAiMessageUI() : null
    if (aiMsg.dataset.workDone !== 'true') {
      if (!aiMsg.dataset.workStartTime) aiMsg.dataset.workStartTime = String(Date.now())
      aiMessageUI?.startWorkTimer?.(aiMsg)
      aiMessageUI?.updateWorkElapsed?.(aiMsg)
    }
    const activeBlocks = aiMsg.querySelectorAll('.ai-thinking-block.active:not(.stopped)')
    const lastBlock = activeBlocks.length ? activeBlocks[activeBlocks.length - 1] : null
    if (deps.setCurrentThinkingBlock) deps.setCurrentThinkingBlock(lastBlock)
    if (lastBlock) {
      if (deps.setCurrentThinkingStartTime) deps.setCurrentThinkingStartTime(parseInt(lastBlock.dataset.startTime || '', 10) || Date.now())
      aiMessageUI?.startBlockTimer?.(lastBlock)
    }
  }

  function reattachProjectAiRuntime(project, options = {}) {
    if (!project) return null
    if (window.RunningUiRestore?.isCurrentSessionRunning && !window.RunningUiRestore.isCurrentSessionRunning(project)) return null
    // 切回时 isRunning 可能被异步状态短暂清掉，但只要有快照/ops 仍应恢复
    const hasRunEvidence = !!(
      project.isRunning ||
      project.awaitingFinalReply ||
      project.aiRunningState?.html ||
      project._frozenAiHtml ||
      project.savedAiMsg ||
      (Array.isArray(project.aiOperations) && project.aiOperations.length > 0) ||
      deps.isProjectAiRunActive?.(project)
    )
    if (!hasRunEvidence) return null
    project.isRunning = true

    const cachedRuntime = getCachedAiRuntime(project)
    let renderedOperationCount = Number(
      cachedRuntime?.operationCount ?? project.savedOperationCount ?? 0
    ) || 0
    let aiMsg = cachedRuntime?.aiMsg || project.savedAiMsg || project._aiState?.currentAiMsg || null
    const forceSnapshot = options.forceSnapshot === true
    const liveEmpty = isAiMessageShellEmpty(aiMsg)
    const liveInDom = !!(aiMsg && document.contains(aiMsg))
    const liveDetachedOrMissing = !aiMsg || !liveInDom
    const frozenHtml = project.aiRunningState?.html || project._frozenAiHtml || ''
    const liveVisual = countAiVisualNodes(aiMsg)
    const frozenVisual = Number(project._frozenAiVisualCount || project.aiRunningState?.visualCount || 0) || 0
    // 仅当：空壳 / 不在 DOM / 强制且 live 比冻结快照更空 时，才用冻结 HTML 重建
    // 避免多次 forceSnapshot 把「切走期间已回放」的内容冲掉
    const shouldRebuildFromFrozen = !!frozenHtml && (
      liveEmpty ||
      liveDetachedOrMissing ||
      (forceSnapshot && liveVisual < Math.max(1, frozenVisual))
    )

    if (shouldRebuildFromFrozen) {
      const restored = restoreAiMessageFromSnapshot(project)
      if (restored && !isAiMessageShellEmpty(restored)) {
        aiMsg = restored
        // 冻结快照对应「离开时」的 op 水位；切走期间新增 ops 由后续 replay 补上
        // 注意：不要用已经涨到 length 的 savedOperationCount，否则会跳过补播
        const leaveWatermark = Number(
          project._frozenOpCount
          ?? project.aiRunningState?._opCountAtFreeze
          ?? renderedOperationCount
        ) || 0
        renderedOperationCount = Math.min(leaveWatermark, Array.isArray(project.aiOperations) ? project.aiOperations.length : 0)
      }
    }

    if (!aiMsg && frozenHtml) {
      aiMsg = restoreAiMessageFromSnapshot(project)
    }
    if (!aiMsg) return null

    const shellEmpty = isAiMessageShellEmpty(aiMsg)
    if (shellEmpty) {
      renderedOperationCount = 0
      project.savedOperationCount = 0
      if (cachedRuntime) cachedRuntime.operationCount = 0
    }

    const chatMessages = deps.getChatMessages ? deps.getChatMessages() : null
    if (deps.setCurrentAiMsg) deps.setCurrentAiMsg(aiMsg)
    if (deps.setCurrentToolCount) {
      deps.setCurrentToolCount(
        cachedRuntime?.toolCount
          ?? project.savedToolCount
          ?? project._aiState?.currentToolCount
          ?? project.aiRunningState?.toolCount
          ?? 0
      )
    }
    if (deps.setCurrentOpCount) {
      deps.setCurrentOpCount(
        cachedRuntime?.opCount
          ?? project.savedOpCount
          ?? project._aiState?.currentOpCount
          ?? project.aiRunningState?.opCount
          ?? 0
      )
    }
    if (deps.setCurrentChangeSession) {
      deps.setCurrentChangeSession(
        cachedRuntime?.changeSession
          || project._aiState?.currentChangeSession
          || (deps.getCurrentChangeSession ? deps.getCurrentChangeSession() : null)
      )
    }
    if (deps.setCurrentThinkingBlock) deps.setCurrentThinkingBlock(null)
    if (deps.setCurrentThinkingStartTime) deps.setCurrentThinkingStartTime(null)
    if (project.id) aiMsg.dataset.projectId = project.id
    aiMsg.dataset.chatSessionId = window.RunningUiRestore?.currentSessionId?.(project) || String(project.chatSessionId || '').trim() || 'main'
    if (chatMessages) {
      try { window.clearWelcomeEmptyState?.({ root: chatMessages }) } catch (_) { /* ignore */ }
      // 若已在容器内先移出再挂到底部，避免重复节点
      if (aiMsg.parentNode && aiMsg.parentNode !== chatMessages) {
        try { aiMsg.parentNode.removeChild(aiMsg) } catch (_) { /* ignore */ }
      }
      chatMessages.appendChild(aiMsg)
    }
    project.savedAiMsg = aiMsg
    if (project._aiState) project._aiState.currentAiMsg = aiMsg
    resumeRunningAiMessage(aiMsg)

    // 默认回放：空壳全量；有快照则从离开时进度续播（含切走期间新增 ops）
    const shouldReplay = options.replay !== false || shellEmpty || forceSnapshot
    if (shouldReplay) {
      const startIndex = shellEmpty ? 0 : renderedOperationCount
      replayProjectAiOperations(project, startIndex)
      project.savedOperationCount = Array.isArray(project.aiOperations) ? project.aiOperations.length : 0
    }

    const runtime = cacheAiRuntimeForProject(project, aiMsg)
    if (options.replay === false && !shellEmpty && !forceSnapshot && runtime) {
      runtime.operationCount = renderedOperationCount
      project.savedOperationCount = renderedOperationCount
    }
    return aiMsg
  }

  function replayProjectAiOperations(project, startIndex = 0) {
    const operations = Array.isArray(project?.aiOperations)
      ? project.aiOperations.slice(Math.max(0, startIndex))
      : []
    for (const op of operations) {
      if (op.type === 'thinking_start') {
        continue
      } else if (op.type === 'thinking') {
        deps.addThinking?.(op.content, {
          isStatus: !!op.isStatus,
          isProgressNarration: !!op.isProgressNarration,
          isReasoningSummary: !!op.isReasoningSummary,
          eventType: op.eventType || '',
          append: !!op.append,
          reuseOpenSegment: !!op.reuseOpenSegment,
          forceUpdate: !!op.forceUpdate,
          agentRole: op.agentRole || '',
          agentTitle: op.agentTitle || ''
        })
      } else if (op.type === 'content') {
        deps.appendAiContentChunk?.(op.content || '')
      } else if (op.type === 'tool_pending') {
        if (op.streaming) {
          deps.updateStreamingOperation?.(op.name, {
            toolCallId: op.toolCallId || '',
            path: op.args?.path || op.args?.file_path || '',
            addedLines: op.args?._streamAddedLines || 0,
            removedLines: op.args?._streamRemovedLines || 0,
            receivedChars: op.args?._streamReceivedChars || 0
          }, {
            agentRole: op.agentRole || '',
            agentTitle: op.agentTitle || '',
            toolCallId: op.toolCallId || ''
          })
        } else {
          deps.preShowOperation?.(op.name, op.args || {}, {
            agentRole: op.agentRole || '',
            agentTitle: op.agentTitle || '',
            toolCallId: op.toolCallId || ''
          })
        }
      } else if (op.type === 'tool') {
        if (deps.setCurrentToolCount) deps.setCurrentToolCount((deps.getCurrentToolCount ? deps.getCurrentToolCount() : 0) + 1)
        if (deps.setCurrentOpCount) deps.setCurrentOpCount((deps.getCurrentOpCount ? deps.getCurrentOpCount() : 0) + 1)
        const args = op.args || {}
        const detail = args.query || args.url || ''
        if (detail || op.result) {
          deps.addOperation?.(op.name, args, op.result, {
            agentRole: op.agentRole || '',
            agentTitle: op.agentTitle || '',
            toolCallId: op.toolCallId || ''
          })
        }
      } else if (op.type === 'using_tools') {
        deps.startToolGroup?.()
        if (deps.setCurrentOpCount) deps.setCurrentOpCount((deps.getCurrentOpCount ? deps.getCurrentOpCount() : 0) + 1)
      }
    }
    deps.updateAiStats?.()
  }

  function bind(depsObj = {}) {
    deps = depsObj
  }

  window.AiRuntimeCache = {
    bind,
    getProjectRuntimeKey,
    getCachedAiRuntime,
    cacheAiRuntimeForProject,
    clearAiRuntimeForProject,
    captureRunningAiSnapshot,
    restoreAiMessageFromSnapshot,
    resumeRunningAiMessage,
    reattachProjectAiRuntime,
    replayProjectAiOperations,
    isAiMessageShellEmpty
  }
})()
