// IPC AI 流式监听器模块
// 负责注册 AI 流式相关的 IPC 监听器：onAiStatus、onAiThinkingReset、onAiThinking、
// onAiContentChunk、onAiFinalDelta、onAiCacheUsage、onAiIntermediateContent、onToolStart、onToolResult。
// 通过 window.IpcAiStreamListeners.bind(deps) 注入依赖后调用 register() 注册监听。

(function () {
  let deps = {}

  // aiOperations 数组上限，超出时裁剪旧记录避免内存无限增长
  const AI_OPS_MAX = 500
  const pendingProjectSyncs = new Map()
  let projectSyncFrame = 0

  function scheduleProjectSync(force = false) {
    if (force) {
      if (projectSyncFrame) {
        const cancelFrame = window.cancelAnimationFrame || clearTimeout
        cancelFrame(projectSyncFrame)
        projectSyncFrame = 0
      }
      pendingProjectSyncs.clear()
      deps.syncAiStateToProject(true)
      return
    }
    const projectId = deps.getActiveProjectId?.() || '__active__'
    pendingProjectSyncs.set(projectId, true)
    if (projectSyncFrame) return
    const requestFrame = window.requestAnimationFrame || (callback => setTimeout(callback, 16))
    projectSyncFrame = requestFrame(() => {
      projectSyncFrame = 0
      const projectIds = Array.from(pendingProjectSyncs.keys())
      pendingProjectSyncs.clear()
      if (projectIds.length && projectIds.includes(deps.getActiveProjectId?.() || '__active__')) {
        deps.syncAiStateToProject()
      }
    })
  }

  function pushAiOp(project, op) {
    if (!project) return
    if (!project.aiOperations) project.aiOperations = []
    project.aiOperations.push(op)
    if (project.aiOperations.length > AI_OPS_MAX) {
      project.aiOperations.splice(0, project.aiOperations.length - AI_OPS_MAX)
    }
  }

  function upsertPendingToolOp(project, op) {
    if (!project) return
    if (!project.aiOperations) project.aiOperations = []
    const toolCallId = String(op?.toolCallId || '')
    const existing = toolCallId
      ? project.aiOperations.findLast?.(item => item?.type === 'tool_pending' && String(item.toolCallId || '') === toolCallId)
      : null
    if (existing) {
      existing.name = op.name || existing.name
      existing.args = { ...(existing.args || {}), ...(op.args || {}) }
      existing.streaming = !!op.streaming
      return
    }
    pushAiOp(project, op)
  }

  function clearTransientUiPlaceholders() {
    deps.getAiMessageUI?.()?.clearTransientThinkingPlaceholders?.()
  }

  // 新建会话后短暂屏蔽旧任务残留事件，避免写到新会话界面
  function shouldIgnoreIncomingAiEvents(project, data = {}) {
    if (!project?.ignoreIncomingAiEvents) return false
    // 后端中断确认可放行，避免状态卡死
    if (data?.status === 'interrupted') return false
    const expectedSessionId = project.ignoreIncomingAiEventsUntilSessionId || ''
    if (expectedSessionId && data?.chatSessionId && data.chatSessionId !== expectedSessionId) {
      return true
    }
    return true
  }

  function normalizeSessionId(sessionId) {
    return String(sessionId || '').trim() || 'main'
  }

  function eventSessionId(project, data = {}) {
    return normalizeSessionId(data.chatSessionId || project?._runningSessionId || project?.chatSessionId)
  }

  function isEventForActiveSession(project, data = {}) {
    if (!project || project.id !== deps.getActiveProjectId?.()) return false
    const currentSessionId = window.RunningUiRestore?.currentSessionId?.(project)
      || normalizeSessionId(project.chatSessionId)
    return normalizeSessionId(currentSessionId) === eventSessionId(project, data)
  }

  function eventBelongsToRunningSession(project, data = {}) {
    const runningSessionId = String(project?._runningSessionId || '').trim()
    if (!runningSessionId) return false
    return normalizeSessionId(runningSessionId) === eventSessionId(project, data)
  }

  function register() {
    if (!window.api) return

    // 监听AI状态
    window.api.onAiStatus(data => {
      if (window.AgentCollaborationUI?.handleChatEvent?.('status', data)) return

      const projects = deps.getProjects()
      const activeProjectId = deps.getActiveProjectId()
      const targetProject = data.projectId ? projects.find(p => p.id === data.projectId) : null
      if (shouldIgnoreIncomingAiEvents(targetProject, data)) return

      // 是否为当前激活项目的事件
      const isActiveProject = isEventForActiveSession(targetProject, data)

      if (targetProject) {
        const activitySessionId = targetProject._runningSessionId
          || data.chatSessionId
          || targetProject.chatSessionId
          || ''
        const activityOpts = { sessionId: activitySessionId }
        if (data.status === 'thinking' || data.status === 'streaming' || data.status === 'using_tools') {
          deps.setProjectActivity(targetProject, 'running', activityOpts)
        } else if (data.status === 'done') {
          // 后端会先发 ai-status:done，再发 message-reply。这里保持运行态，避免切换项目时先渲染出"已完成"的历史快照。
          deps.setProjectActivity(targetProject, 'running', activityOpts)
        } else if (data.status === 'error') {
          // 会话级：错误始终标红，当前会话也能分辨
          deps.setProjectActivity(targetProject, 'error', activityOpts)
        } else if (data.status === 'interrupted') {
          deps.setProjectActivity(targetProject, '', activityOpts)
        }
      }

      if (data.status === 'thinking' || data.status === 'streaming') {
        const currentAiMsg = deps.getCurrentAiMsg()
        if (targetProject) {
          const isNewRound = !String(targetProject._runningSessionId || '').trim() && !targetProject.isRunning && !currentAiMsg
          targetProject.isRunning = isActiveProject || eventBelongsToRunningSession(targetProject, data) || data.projectId !== activeProjectId
          targetProject.awaitingFinalReply = false
          targetProject.aiRunCompletedAt = 0
          if (!targetProject.aiRunStartedAt) targetProject.aiRunStartedAt = Date.now()
          if (targetProject._aiState && !targetProject._aiState.aiRunStartedAt) {
            targetProject._aiState.aiRunStartedAt = targetProject.aiRunStartedAt
          }
          if (targetProject._aiState) targetProject._aiState.aiRunCompletedAt = 0
          if (isNewRound) targetProject.aiOperations = []  // 新AI轮次开始，清空旧的操作记录
        }
        if (isActiveProject) {
          // 只有第一次创建，后续轮次不重复创建
          if (!currentAiMsg) {
            deps.ensureCurrentAiMessageForProject(targetProject)
          }
          // 记录thinking开始
          if (!targetProject?.aiOperations?.some(op => op.type === 'thinking_start')) {
            pushAiOp(targetProject, { type: 'thinking_start' })
          }
          scheduleProjectSync()
        } else {
          // 非当前项目：记录到aiOperations
          const state = deps.getProjectAiState(data.projectId)
          if (state && !targetProject?.isRunning) { state.currentAiMsg = null; state.currentToolCount = 0; state.currentOpCount = 0 }
          if (!targetProject?.aiOperations?.some(op => op.type === 'thinking_start')) {
            pushAiOp(targetProject, { type: 'thinking_start' })
          }
        }
        deps.updateSendBtnState()
      }
      else if (data.status === 'using_tools') {
        if (targetProject) {
          targetProject.isRunning = isActiveProject || eventBelongsToRunningSession(targetProject, data) || data.projectId !== activeProjectId
          targetProject.awaitingFinalReply = false
          targetProject.aiRunCompletedAt = 0
          if (!targetProject.aiRunStartedAt) targetProject.aiRunStartedAt = Date.now()
          if (targetProject._aiState && !targetProject._aiState.aiRunStartedAt) {
            targetProject._aiState.aiRunStartedAt = targetProject.aiRunStartedAt
          }
          if (targetProject._aiState) targetProject._aiState.aiRunCompletedAt = 0
        }
        if (isActiveProject) {
          // 检测脱离DOM的currentAiMsg
          deps.ensureCurrentAiMessageForProject(targetProject)
          deps.startToolGroup()
          deps.setCurrentOpCount((deps.getCurrentOpCount() || 0) + 1)
          deps.updateAiStats()
          // 活跃项目也记录到aiOperations
          pushAiOp(targetProject, { type: 'using_tools', count: data.count })
          scheduleProjectSync()
        } else {
          const state = deps.getProjectAiState(data.projectId)
          if (state) state.currentOpCount++
          // 非活跃项目也记录到aiOperations
          if (targetProject) {
            pushAiOp(targetProject, { type: 'using_tools', count: data.count })
          }
        }
      }
      else if (data.status === 'done') {
        if (targetProject) {
          targetProject.awaitingFinalReply = true
          targetProject.aiRunCompletedAt = Date.now()
          if (targetProject._aiState) targetProject._aiState.aiRunCompletedAt = targetProject.aiRunCompletedAt
        }
        deps.updateSendBtnState()
      }
      else if (data.status === 'error') {
        // AI出错，隐藏Agent面板
        if (typeof AgentUI !== 'undefined') {
          AgentUI.hidePanel()
        }
        if (isActiveProject) {
          deps.finalizeAiFailure(targetProject, data.error || '', { renderError: false })
        } else if (targetProject) {
          deps.clearProjectAiRunState(targetProject)
        }
        deps.updateSendBtnState()
      }
      else if (data.status === 'interrupted') {
        if (targetProject) targetProject.isRunning = false
        // AI中断，隐藏Agent面板
        if (typeof AgentUI !== 'undefined') {
          AgentUI.hidePanel()
        }
        if (isActiveProject) {
          const currentAiMsg = deps.getCurrentAiMsg()
          if (currentAiMsg && document.contains(currentAiMsg)) {
            // 完成流式输出（包含思考块处理）
            deps.finishStreamingOnInterrupt()
            // 更新文字为"被打断了"
            deps.updateWorkStatus('interrupted')
          }
          scheduleProjectSync()
        }
        deps.updateSendBtnState()
      }
    })

    // 思考内容重置（每轮循环开始时）
    window.api.onAiThinkingReset?.(data => {
      if (window.AgentCollaborationUI?.handleChatEvent?.('thinking-reset', data)) return
      if (deps.routeAgentCollaborationEvent(data, 'thinking')) return
      const projects = deps.getProjects()
      const targetProject = data.projectId ? projects.find(p => p.id === data.projectId) : null
      if (shouldIgnoreIncomingAiEvents(targetProject, data)) return
      const activeProjectId = deps.getActiveProjectId()
      if (!isEventForActiveSession(targetProject, data)) {
        return
      }
      // 不结束当前思考块——动画保持到下一个思考块创建时才停止
      // 把上一轮的内容片段块标记为已完成（移除 current-round 类）
      const currentAiMsg = deps.getCurrentAiMsg()
      if (currentAiMsg) {
        const dynamicArea = currentAiMsg.querySelector('.ai-dynamic-area')
        if (dynamicArea) {
          const currentRoundBlock = dynamicArea.querySelector('.intermediate-content-block.current-round')
          if (currentRoundBlock) {
            currentRoundBlock.classList.remove('current-round')
          }
        }
      }
      scheduleProjectSync()
    })

    window.api.onAiThinking(data => {
      const eventType = String(data.eventType || data.type || '')
      if (eventType === 'reasoning-start' || eventType === 'reasoning-delta') {
        const projects = deps.getProjects()
        const targetProject = data.projectId ? projects.find(p => p.id === data.projectId) : null
        if (shouldIgnoreIncomingAiEvents(targetProject, data)) return
        const activeProjectId = deps.getActiveProjectId()
        if (!isEventForActiveSession(targetProject, data)) return
        let currentAiMsg = deps.getCurrentAiMsg()
        if (!currentAiMsg || !document.contains(currentAiMsg)) {
          currentAiMsg = deps.ensureCurrentAiMessageForProject(targetProject) || deps.getCurrentAiMsg()
        }
        if (currentAiMsg && data.content) {
          clearTransientUiPlaceholders()
          deps.updateWorkStatus?.('working')
          window.AiMessageUI?.updateDeepReasoningBlock?.(currentAiMsg, data.content, {
            append: eventType === 'reasoning-delta' || !!data.append,
            agentRole: data.agentRole || ''
          })
          scheduleProjectSync()
        }
        return
      }
      if (eventType === 'reasoning-end') {
        const currentAiMsg = deps.getCurrentAiMsg()
        window.AiMessageUI?.finishDeepReasoningBlock?.(currentAiMsg)
        scheduleProjectSync()
        return
      }
      if (!data.isStatus && !data.isProgressNarration && !data.isReasoningSummary) return
      if (window.AgentCollaborationUI?.handleChatEvent?.('thinking', data)) return
      const projects = deps.getProjects()
      const activeProjectId = deps.getActiveProjectId()
      const targetProject = data.projectId ? projects.find(p => p.id === data.projectId) : null
      if (shouldIgnoreIncomingAiEvents(targetProject, data)) return
      if (deps.routeAgentCollaborationEvent(data, 'thinking')) return
      const displayThinking = window.AiMessageUI?.shouldDisplayThinkingStatus
        ? window.AiMessageUI.shouldDisplayThinkingStatus(data.content)
        : !!String(data.content || '').trim()
      if (data.content && !data.forceUpdate && !displayThinking) return
      if (!isEventForActiveSession(targetProject, data)) {
        // 非活跃项目：只记录到aiOperations
        if (targetProject && data.content && (data.isStatus || data.isProgressNarration || data.isReasoningSummary)) {
          pushAiOp(targetProject, {
            type: 'thinking',
            content: data.content,
            isStatus: !!data.isStatus,
            isProgressNarration: !!data.isProgressNarration,
            isReasoningSummary: !!data.isReasoningSummary,
            eventType,
            append: !!data.append,
            reuseOpenSegment: data.reuseOpenSegment !== false,
            forceUpdate: !!data.forceUpdate,
            agentRole: data.agentRole || '',
            agentTitle: data.agentTitle || ''
          })
        }
        return
      }
      // 活跃项目：操作DOM + 记录到aiOperations
      if (data.content) {
        const currentAiMsg = deps.getCurrentAiMsg()
        if (!currentAiMsg || !document.contains(currentAiMsg)) {
          deps.ensureCurrentAiMessageForProject(targetProject)
        }
        clearTransientUiPlaceholders()
        deps.addThinking(data.content, {
          isStatus: !!data.isStatus,
          isProgressNarration: !!data.isProgressNarration,
          isReasoningSummary: !!data.isReasoningSummary,
          eventType,
          append: !!data.append,
          reuseOpenSegment: data.reuseOpenSegment !== false,
          forceUpdate: !!data.forceUpdate,
          agentRole: data.agentRole || '',
          agentTitle: data.agentTitle || ''
        })
        if (targetProject && (data.isStatus || data.isProgressNarration || data.isReasoningSummary)) {
          pushAiOp(targetProject, {
            type: 'thinking',
            content: data.content,
            isStatus: !!data.isStatus,
            isProgressNarration: !!data.isProgressNarration,
            isReasoningSummary: !!data.isReasoningSummary,
            eventType,
            append: !!data.append,
            reuseOpenSegment: data.reuseOpenSegment !== false,
            forceUpdate: !!data.forceUpdate,
            agentRole: data.agentRole || '',
            agentTitle: data.agentTitle || ''
          })
        }
        scheduleProjectSync()
      }
    })

    // 流式正文内容监听器（内容片段只显示在动态区域，不累积）
    window.api.onAiContentChunk(data => {
      if (window.AgentCollaborationUI?.handleChatEvent?.('content-chunk', data)) return
      const projects = deps.getProjects()
      const activeProjectId = deps.getActiveProjectId()
      const targetProject = data.projectId ? projects.find(p => p.id === data.projectId) : null
      if (shouldIgnoreIncomingAiEvents(targetProject, data)) return
      if (!isEventForActiveSession(targetProject, data)) {
        // 非活跃项目：只记录到aiOperations（不累积 streamingContent）
        if (targetProject && data.content) {
          pushAiOp(targetProject, { type: 'content', content: data.content })
        }
        return
      }
      // 活跃项目：流式追加正文内容到动态区域
      if (data.content) {
        clearTransientUiPlaceholders()
        deps.appendAiContentChunk(data.content, targetProject)
        // 记录到aiOperations（用于切换项目时回放）
        if (targetProject) {
          pushAiOp(targetProject, { type: 'content', content: data.content })
        }
        scheduleProjectSync()
      }
    })
    window.api.onAiFinalDelta?.(data => {
      if (window.AgentCollaborationUI?.handleChatEvent?.('final-delta', data)) return
      const projects = deps.getProjects()
      const activeProjectId = deps.getActiveProjectId()
      const targetProject = data.projectId ? projects.find(p => p.id === data.projectId) : null
      if (shouldIgnoreIncomingAiEvents(targetProject, data)) return
      if (!isEventForActiveSession(targetProject, data)) {
        if (targetProject) {
          targetProject.streamingContent = data.reset ? '' : `${targetProject.streamingContent || ''}${data.content || ''}`
        }
        return
      }
      if (data.reset) {
        deps.resetFinalStreamContent(targetProject)
        scheduleProjectSync()
        return
      }
      deps.appendAiFinalDelta(data.content || '', targetProject)
      scheduleProjectSync()
    })

    window.api.onAiCacheUsage?.(data => {
      deps.renderCacheUsage(data)
    })

    // 中间内容片段监听器（过程中的正文片段）
    window.api.onAiIntermediateContent?.(data => {
      if (window.AgentCollaborationUI?.handleChatEvent?.('intermediate-content', data)) return
      const projects = deps.getProjects()
      const targetProject = data.projectId ? projects.find(p => p.id === data.projectId) : null
      if (shouldIgnoreIncomingAiEvents(targetProject, data)) return
      const activeProjectId = deps.getActiveProjectId()
      if (!isEventForActiveSession(targetProject, data)) {
        return
      }
      // 活跃项目：显示中间内容片段
      if (data.content) {
        deps.ensureCurrentAiMessageForProject(targetProject)
        clearTransientUiPlaceholders()
        deps.addIntermediateContent(data.content)
        scheduleProjectSync()
      }
    })

    // 模型仍在流式生成写文件/补丁参数时，提前显示同一张工具卡并实时滚动行数。
    window.api.onToolArgumentProgress?.(data => {
      if (deps.isInternalUiOnlyTool(data.name)) return
      const projects = deps.getProjects()
      const targetProject = data.projectId ? projects.find(p => p.id === data.projectId) : null
      if (shouldIgnoreIncomingAiEvents(targetProject, data)) return
      const args = {
        path: data.path || '',
        file_path: data.path || '',
        _streamAddedLines: Math.max(0, Number(data.addedLines) || 0),
        _streamRemovedLines: Math.max(0, Number(data.removedLines) || 0),
        _streamReceivedChars: Math.max(0, Number(data.receivedChars) || 0)
      }
      upsertPendingToolOp(targetProject, {
        type: 'tool_pending',
        name: data.name,
        args,
        toolCallId: data.toolCallId || '',
        streaming: true
      })
      if (!isEventForActiveSession(targetProject, data)) return

      deps.ensureCurrentAiMessageForProject(targetProject)
      clearTransientUiPlaceholders()
      deps.getAiToolRenderer()?.updateStreamingOperation?.(data.name, data, {
        toolCallId: data.toolCallId || ''
      })
      scheduleProjectSync()
    })

    // 工具开始执行 - 预显示
    window.api.onToolStart?.(data => {
      if (window.AgentCollaborationUI?.handleChatEvent?.('tool-start', data)) return
      if (deps.isInternalUiOnlyTool(data.name)) return
      if (deps.routeAgentCollaborationEvent({
        ...data,
        content: data.name ? `开始调用 ${data.name}` : '开始调用工具'
      }, 'tool')) return
      const projects = deps.getProjects()
      const targetProject = data.projectId ? projects.find(p => p.id === data.projectId) : null
      if (shouldIgnoreIncomingAiEvents(targetProject, data)) return
      const activeProjectId = deps.getActiveProjectId()
      // 非活跃项目忽略
      if (!isEventForActiveSession(targetProject, data)) {
        if (targetProject) {
          upsertPendingToolOp(targetProject, {
            type: 'tool_pending',
            name: data.name,
            args: data.args || {},
            toolCallId: data.toolCallId || '',
            agentRole: data.agentRole || '',
            agentTitle: data.agentTitle || ''
          })
        }
        return
      }

      deps.ensureCurrentAiMessageForProject(targetProject)
      clearTransientUiPlaceholders()

      // 调用预显示
      const aiToolRenderer = deps.getAiToolRenderer()
      if (aiToolRenderer?.preShowOperation) {
        aiToolRenderer.preShowOperation(data.name, data.args || {}, {
          agentRole: data.agentRole || '',
          agentTitle: data.agentTitle || '',
          toolCallId: data.toolCallId || '',
          _parseError: data._parseError || false
        })
      }
      const aiChangePill = deps.getAiChangePill()
      aiChangePill?.recordToolStart?.(data.name, data.args || {}, {
        toolCallId: data.toolCallId || ''
      })
      if (targetProject) {
        upsertPendingToolOp(targetProject, {
          type: 'tool_pending',
          name: data.name,
          args: data.args || {},
          toolCallId: data.toolCallId || '',
          agentRole: data.agentRole || '',
          agentTitle: data.agentTitle || ''
        })
      }
      scheduleProjectSync()
    })

    // 工具执行结果
    window.api.onToolResult(data => {
      if (window.AgentCollaborationUI?.handleChatEvent?.('tool-result', data)) return
      if (deps.isInternalUiOnlyTool(data.name)) return
      if (deps.routeAgentCollaborationEvent(data, 'tool')) return
      const projects = deps.getProjects()
      const activeProjectId = deps.getActiveProjectId()
      // 查找工具结果所属项目
      const toolProject = data.projectId ? projects.find(p => p.id === data.projectId) : null
      if (shouldIgnoreIncomingAiEvents(toolProject, data)) return
      window.SkillDraftUI?.handleToolResult?.({
        ...data,
        projectPath: toolProject?.path || deps.getActiveProject?.()?.path || ''
      })

      // 非活跃项目：只记录到aiOperations，不操作DOM
      if (!isEventForActiveSession(toolProject, data)) {
        if (toolProject) {
          pushAiOp(toolProject, {
            type: 'tool',
            name: data.name,
            args: data.args,
            result: data.result,
            toolCallId: data.toolCallId || '',
            agentRole: data.agentRole || '',
            agentTitle: data.agentTitle || ''
          })
        }
        return
      }

      // 活跃项目：操作DOM + 记录到aiOperations
      deps.ensureCurrentAiMessageForProject(toolProject)
      deps.setCurrentToolCount((deps.getCurrentToolCount() || 0) + 1)
      deps.setCurrentOpCount((deps.getCurrentOpCount() || 0) + 1)
      deps.updateAiStats()
      const args = data.args || {}
      const windowTabsFeature = deps.getWindowTabsFeature()
      windowTabsFeature?.handleLivePreviewToolResult?.(data, {
        projectPath: toolProject?.path || deps.getActiveProject()?.path || ''
      })?.catch?.(error => console.warn('[LivePreview] 自动预览失败:', error))
      const aiChangePill = deps.getAiChangePill()
      aiChangePill?.recordToolResult?.(data.name, args, data.result || {}, {
        toolCallId: data.toolCallId || ''
      })
      deps.addOperation(data.name, args, data.result || {}, {
        agentRole: data.agentRole || '',
        agentTitle: data.agentTitle || '',
        toolCallId: data.toolCallId || ''
      })
      deps.refreshCurrentSummary?.()
      // 同步记录到aiOperations，切换项目时可以完整回放
      if (toolProject) {
        pushAiOp(toolProject, {
          type: 'tool',
          name: data.name,
          args: data.args,
          result: data.result,
          toolCallId: data.toolCallId || '',
          agentRole: data.agentRole || '',
          agentTitle: data.agentTitle || ''
        })
      }
      deps.syncAiStateToProject(true)
    })

    // 消息注入：后端已把注入消息塞进 AI 上下文，通知前端更新状态
    window.api.onInterjectConsumed(data => {
      if (!data || data.projectId !== deps.getActiveProjectId?.()) return
      const itemIds = Array.isArray(data.itemIds) ? data.itemIds : []
      if (!itemIds.length) return
      try {
        const messagesEl = document.getElementById('chatMessages')
        if (!messagesEl) return
        const placeInterjectNearLatestUser = (node) => {
          if (!node || node.parentNode !== messagesEl) return
          const userMessages = Array.from(messagesEl.querySelectorAll('.message.user:not(.message-user-interject)'))
          const latestUserMsg = userMessages[userMessages.length - 1]
          if (!latestUserMsg) return
          let insertBefore = latestUserMsg.nextSibling || null
          while (insertBefore && insertBefore.classList?.contains('message-user-interject') && insertBefore !== node) {
            insertBefore = insertBefore.nextSibling
          }
          if (insertBefore !== node) {
            messagesEl.insertBefore(node, insertBefore)
          }
        }

        // 把匹配的注入消息 DOM 状态从 queued 改成 consumed
        itemIds.forEach(itemId => {
          if (!itemId) return
          const node = messagesEl.querySelector(`.message-user-interject[data-item-id="${itemId}"]`)
          if (node) {
            node.setAttribute('data-interject-state', 'consumed')
            placeInterjectNearLatestUser(node)
          }
        })
        // 清理当前 AI 消息的折叠/stopped 状态，让续轮后思考、工具、计时连续可见
        const currentAiMsg = deps.getCurrentAiMsg?.()
        if (currentAiMsg) {
          window.MessageQueue?.prepareAiMessageForInterjectResume?.(currentAiMsg)
        }
      } catch (err) {
        console.warn('[IpcAiStreamListeners] onInterjectConsumed handler failed:', err)
      }
    })
  }

  function bind(depsObj = {}) {
    deps = depsObj
  }

  window.IpcAiStreamListeners = {
    bind,
    register
  }
})()
