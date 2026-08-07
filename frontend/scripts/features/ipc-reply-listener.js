// IPC onReply 监听器模块
// 负责处理 AI 回复消息的监听与分发（流式内容记录、状态清理、DOM 更新等）。
// 通过 window.IpcReplyListener.bind(deps) 注入依赖后调用 register() 注册监听。

(function () {
  let deps = {}

  function normalizeSessionId(sessionId) {
    return String(sessionId || '').trim() || 'main'
  }

  function eventSessionId(project, data = {}) {
    return normalizeSessionId(data.chatSessionId || project?._runningSessionId || project?.chatSessionId)
  }

  function isEventForProjectSession(project, data = {}) {
    if (!project) return false
    const currentSessionId = window.RunningUiRestore?.currentSessionId?.(project)
      || normalizeSessionId(project.chatSessionId)
    return normalizeSessionId(currentSessionId) === eventSessionId(project, data)
  }

  function isEventForActiveSession(project, data = {}) {
    return project?.id === deps.getActiveProjectId?.() && isEventForProjectSession(project, data)
  }

  function register() {
    if (!window.api || !window.api.onReply) return
    window.api.onReply(data => {
      if (window.AgentCollaborationUI?.handleChatEvent?.('reply', data)) return
      const activeProjectId = deps.getActiveProjectId()
      const projects = deps.getProjects()
      AppLogger.debug('[Frontend] 收到回复, projectId:', data.projectId, 'activeProjectId:', activeProjectId, 'done:', data.done)

      // 查找回复所属项目
      const replyProject = data.projectId ? projects.find(p => p.id === data.projectId) : deps.getActiveProject()
      const replySessionId = eventSessionId(replyProject, data)
      // done 回包里的 content 有时会是后端重新整理后的版本。界面已经收到的 final-delta
      // 才是用户实际看见的正文；先在清理运行态前保存下来，历史和最终 DOM 都复用它。
      const completedStreamContent = data.done
        ? String(replyProject?.streamingContent || '')
        : ''
      const resolvedReplyContent = data.done && completedStreamContent.trim()
        ? completedStreamContent
        : String(data.content || '')
      // 新建会话后屏蔽旧任务残留回复，避免写进新会话历史/界面
      if (replyProject?.ignoreIncomingAiEvents) {
        if (data.done) {
          replyProject.isRunning = false
          replyProject.awaitingFinalReply = false
          replyProject.aiRunCompletedAt = 0
          if (replyProject._aiState) replyProject._aiState.aiRunCompletedAt = 0
          deps.clearProjectAiRunState?.(replyProject, { sessionId: replySessionId })
          deps.setProjectActivity?.(replyProject, '', {
            sessionId: replySessionId
          })
          deps.updateSendBtnState?.()
        }
        return
      }

      // 流式完成标志
      if (data.done) {
        if (replyProject) replyProject.isRunning = false
        if (replyProject) replyProject.awaitingFinalReply = false
        if (replyProject) {
          replyProject.aiRunCompletedAt = 0
          if (replyProject._aiState) replyProject._aiState.aiRunCompletedAt = 0
        }
      }

      // 始终将回复内容记录到对应项目的历史中
      if (resolvedReplyContent && replyProject && isEventForProjectSession(replyProject, data)) {
        const historyEntry = { role: 'assistant', content: resolvedReplyContent }
        if (Number.isFinite(Number(data.startedAt))) historyEntry.startedAt = Number(data.startedAt)
        if (Number.isFinite(Number(data.completedAt))) historyEntry.completedAt = Number(data.completedAt)
        if (Number.isFinite(Number(data.durationMs))) historyEntry.durationMs = Number(data.durationMs)
        // 保留 reasoning_content（DeepSeek Reasoner 等思考模型要求原样传回API）
        if (data.reasoningContent) {
          historyEntry.reasoning_content = data.reasoningContent
        }
        if (data.changeSession) {
          historyEntry.changeSession = data.changeSession
        }
        // 持久化本轮操作量快照到该条消息：切项目后历史回显仍可恢复 +N -N
        const sessionSnapshot = (window.aiChangePill?.getOperationSnapshot?.() || window.AiChangePill?.getActiveSnapshot?.() || null)
        if (sessionSnapshot && Array.isArray(sessionSnapshot.files) && sessionSnapshot.files.length) {
          historyEntry.operationSnapshot = {
            files: sessionSnapshot.files.map(file => ({
              path: file.path,
              action: file.action || 'modify',
              added: Math.max(0, Number(file.added) || 0),
              removed: Math.max(0, Number(file.removed) || 0)
            })),
            summary: sessionSnapshot.summary || null,
            sessionId: sessionSnapshot.sessionId || data.changeSession?.id || data.changeSession?.sessionId || '',
            metric: sessionSnapshot.metric || 'operation'
          }
        }
        replyProject.history.push(historyEntry)
        if (!Array.isArray(replyProject.messagesHistory)) replyProject.messagesHistory = []
        replyProject.messagesHistory.push({ ...historyEntry })
        window.ChatRuntimeHistoryCache?.compactProject?.(replyProject)
      }

      // 是否为当前激活项目
      const isActiveProject = isEventForActiveSession(replyProject, data)

      if (replyProject && data.done) {
        // 会话级指示：完成→绿点，错误→红点（不再清掉当前激活项目，否则多会话无法分辨）
        const activitySessionId = replySessionId
        deps.setProjectActivity(replyProject, data.error ? 'error' : 'done', {
          sessionId: activitySessionId
        })
        if (activitySessionId && String(replyProject._runningSessionId || '') === String(activitySessionId)) {
          replyProject._runningSessionId = ''
        }
      }

      if (!isActiveProject) {
        // 非当前项目的回复：记录到历史即可，不操作DOM
        // AI已完成，清空aiOperations（下次切换到该项目时从history恢复显示）
        const state = deps.getProjectAiState(data.projectId)
        if (state) { state.currentAiMsg = null; state.currentToolCount = 0; state.currentOpCount = 0 }
        if (data.done) deps.clearProjectAiRunState(replyProject, { sessionId: replySessionId })
        if (replyProject) {
          replyProject.streamingContent = ''
          replyProject.aiRunStartedAt = 0
          replyProject.aiRunCompletedAt = 0
          if (replyProject._aiState) {
            replyProject._aiState.aiRunStartedAt = 0
            replyProject._aiState.aiRunCompletedAt = 0
          }
        }
        // 非激活项目也刷新 Git 状态
        if (replyProject && data.done) {
          deps.cleanupCollabReportsAfterSuccessfulReply(replyProject, data)
          deps.loadGitStatusForProject(replyProject)
          if (data.operationMemo) {
            window.AiOperationMemoUI?.handleMemoPayload?.({
              ...data.operationMemo,
              projectId: data.projectId || replyProject.id
            })
          }
        }
        deps.updateSendBtnState()
        return
      }

      // 当前激活项目的回复：更新DOM
      deps.ensureCurrentAiMessageForProject(replyProject, { create: false })
      let currentAiMsg = deps.getCurrentAiMsg()
      if (!currentAiMsg) {
        const chatMessages = deps.getChatMessages()
        const aiMessages = chatMessages.querySelectorAll('.message.ai')
        currentAiMsg = aiMessages[aiMessages.length - 1] || null
        if (currentAiMsg) deps.setCurrentAiMsg(currentAiMsg)
      }
      if (data.error) {
        deps.finalizeAiFailure(replyProject, data.error)
      } else if (data.done) {
        deps.setCurrentChangeSession(data.changeSession || null)
        // 优先保留用户已经看见的流式正文，避免 done 回包把正文替换成另一版。
        const streamedFinalContent = currentAiMsg?.dataset?.finalStreamContent || completedStreamContent
        const finalContent = streamedFinalContent || resolvedReplyContent
        const finalArtifacts = Array.isArray(data.artifacts) ? data.artifacts : []
        // 先结束运行态和红色停止按钮。后面的 Markdown/附件渲染即使异常，界面也不能继续假装在执行。
        deps.clearProjectAiRunState(replyProject, { sessionId: replySessionId })
        deps.updateSendBtnState()
        // 先停止所有正在计时的思考块
        const currentThinkingBlock = deps.getCurrentThinkingBlock()
        if (currentThinkingBlock && !currentThinkingBlock.classList.contains('stopped')) {
          deps.finishThinkingBlock(currentThinkingBlock, 'done')
        }
        deps.setCurrentThinkingBlock(null)
        const aiMessageUI = deps.getAiMessageUI()
        aiMessageUI?.setWorkDuration?.(currentAiMsg, data.durationMs)
        deps.updateWorkStatus('done')
        // 清理动态区域中的 current-round 类
        if (currentAiMsg) {
          const dynamicArea = currentAiMsg.querySelector('.ai-dynamic-area')
          if (dynamicArea) {
            const currentRoundBlock = dynamicArea.querySelector('.intermediate-content-block.current-round')
            if (currentRoundBlock) {
              currentRoundBlock.classList.remove('current-round')
            }
          }
        }
        if (!currentAiMsg) {
          // currentAiMsg 已丢失（如DOM被清除），用简单消息代替
          deps.addAiMessageToUI(finalContent, { artifacts: finalArtifacts })
          // AI完成，隐藏Agent面板
          if (typeof AgentUI !== 'undefined') {
            AgentUI.hidePanel()
          }
        } else {
          deps.finishAiStreaming(finalContent, finalArtifacts)
          currentAiMsg.classList.remove('thinking')
          const opsEl = currentAiMsg.querySelector('.ai-operations')
          // 回复完成后：保持操作列表收起状态（用户可手动点击展开）
          // 收起所有操作详情
          if (opsEl) {
            const opIcons = deps.getOpIcons()
            opsEl.querySelectorAll('.op-detail').forEach(d => d.classList.remove('show'))
            opsEl.querySelectorAll('.op-toggle').forEach(t => { t.innerHTML = opIcons.step; t.parentElement.classList.remove('expanded') })
          }
          // 不自动展开 ai-stats（保持收起状态）
        }
        // 清空暂存的流式内容
        if (replyProject) replyProject.streamingContent = ''
        if (currentAiMsg) currentAiMsg.dataset.finalStreamContent = ''
      }
      // done: true 时清理状态
      if (data.done) {
        deps.cleanupCollabReportsAfterSuccessfulReply(replyProject, data)
        deps.cleanupTempFilesForProject(replyProject?.id || data.projectId)
        deps.setAutoFollowCurrentRun(false)
        deps.setCurrentAiMsg(null)
        deps.setCurrentToolCount(0)
        deps.setCurrentOpCount(0)
        // AI完成，清空该项目的aiOperations
        if (replyProject) {
          replyProject.aiOperations = []
          replyProject.aiRunStartedAt = 0
          if (replyProject._aiState) replyProject._aiState.aiRunStartedAt = 0
        }
        deps.syncAiStateToProject()
        deps.updateSendBtnState()
        // 更新上下文状态
        deps.pollContextStatus()        // 方案A：AI轮次完成后自动刷新历史压缩的「X轮」数字
        if (window.ContextCompressionStack?.refresh) {
          try { window.ContextCompressionStack.refresh({ retry: false }) } catch {}
        }
        // AI 完成后刷新 Git 状态（可能有文件修改）
        if (replyProject) {
          deps.loadGitStatusForProject(replyProject)
        }
        if (!data.projectId || data.projectId === activeProjectId) {
          const aiChangePill = deps.getAiChangePill()
          aiChangePill?.render?.(data.changeSession || null)
        }
        if (data.operationMemo) {
          window.AiOperationMemoUI?.handleMemoPayload?.({
            ...data.operationMemo,
            projectId: data.projectId || activeProjectId
          })
        }
      }
    })
  }

  function bind(depsObj = {}) {
    deps = depsObj
  }

  window.IpcReplyListener = {
    bind,
    register
  }
})()
