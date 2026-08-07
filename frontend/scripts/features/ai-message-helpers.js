(function () {
  function bind(options = {}) {
    const getCurrentAiMsg = options.getCurrentAiMsg || function () { return null }
    const setCurrentAiMsg = options.setCurrentAiMsg || function () {}
    const getCurrentToolCount = options.getCurrentToolCount || function () { return 0 }
    const setCurrentToolCount = options.setCurrentToolCount || function () {}
    const getCurrentOpCount = options.getCurrentOpCount || function () { return 0 }
    const setCurrentOpCount = options.setCurrentOpCount || function () {}
    const getCurrentChangeSession = options.getCurrentChangeSession || function () { return null }
    const setCurrentChangeSession = options.setCurrentChangeSession || function () {}
    const getChatMessages = options.getChatMessages || function () { return null }
    const getActiveProjectId = options.getActiveProjectId || function () { return null }
    const getActiveProject = options.getActiveProject || function () { return null }
    const isProjectAiRunActive = options.isProjectAiRunActive || function () { return false }
    const getCachedAiRuntime = options.getCachedAiRuntime || function () { return null }
    const cacheAiRuntimeForProject = options.cacheAiRuntimeForProject || function () {}
    const restoreAiMessageFromSnapshot = options.restoreAiMessageFromSnapshot || function () { return null }
    const reattachProjectAiRuntime = options.reattachProjectAiRuntime || function () { return null }
    const replayProjectAiOperations = options.replayProjectAiOperations || function () {}
    const resumeRunningAiMessage = options.resumeRunningAiMessage || function () {}
    const createAiMessage = options.createAiMessage || function () { return null }
    const updateSendBtnState = options.updateSendBtnState || function () {}
    const syncAiStateToProject = options.syncAiStateToProject || function () {}

    function ensureCurrentAiMessageForProject(project, options = {}) {
      const shouldCreate = options.create !== false
      const cachedRuntime = getCachedAiRuntime(project)
      const chatMessages = getChatMessages()
      const currentAiMsg = getCurrentAiMsg()
      const currentSessionId = window.RunningUiRestore?.currentSessionId?.(project)
        || String(project?.chatSessionId || '').trim()
        || 'main'
      let candidate = cachedRuntime?.aiMsg || project?.savedAiMsg || project?._aiState?.currentAiMsg || null
      const currentBelongsToProject = currentAiMsg && (
        !project ||
        (currentAiMsg.dataset?.projectId === project.id && String(currentAiMsg.dataset?.chatSessionId || 'main') === currentSessionId) ||
        (document.contains(currentAiMsg) && !currentAiMsg.dataset?.projectId)
      )
      if (!candidate && currentBelongsToProject) candidate = currentAiMsg
      if (!candidate && project?.aiRunningState) {
        candidate = restoreAiMessageFromSnapshot(project)
      }

      if (candidate) {
        setCurrentAiMsg(candidate)
        setCurrentToolCount(cachedRuntime?.toolCount ?? project?.savedToolCount ?? project?._aiState?.currentToolCount ?? getCurrentToolCount())
        setCurrentOpCount(cachedRuntime?.opCount ?? project?.savedOpCount ?? project?._aiState?.currentOpCount ?? getCurrentOpCount())
        setCurrentChangeSession(cachedRuntime?.changeSession || project?._aiState?.currentChangeSession || getCurrentChangeSession())
        if (project) {
          candidate.dataset.projectId = project.id
          candidate.dataset.chatSessionId = currentSessionId
        }
        if (!document.contains(candidate)) {
          try { window.clearWelcomeEmptyState?.({ root: chatMessages }) } catch (_) { /* ignore */ }
          chatMessages.appendChild(candidate)
        }
        if (project?._aiState) project._aiState.currentAiMsg = candidate
        cacheAiRuntimeForProject(project, candidate)
        resumeRunningAiMessage(candidate)
        return candidate
      }

      if (!shouldCreate) return null
      const newMsg = createAiMessage()
      if (newMsg?.dataset) {
        newMsg.dataset.projectId = project?.id || ''
        newMsg.dataset.chatSessionId = currentSessionId
      }
      setCurrentAiMsg(newMsg)
      setCurrentToolCount(0)
      setCurrentOpCount(0)
      if (project) {
        project.isRunning = true
        cacheAiRuntimeForProject(project, newMsg)
        if (project._aiState) project._aiState.currentAiMsg = newMsg
      }
      updateSendBtnState()
      return newMsg
    }

    function getVisibleAiMessageForProject(project) {
      const chatMessages = getChatMessages()
      if (!project || !chatMessages) return null
      const currentAiMsg = getCurrentAiMsg()
      const currentSessionId = window.RunningUiRestore?.currentSessionId?.(project) || String(project.chatSessionId || '').trim() || 'main'
      if (currentAiMsg && document.contains(currentAiMsg) && currentAiMsg.dataset?.projectId === project.id && String(currentAiMsg.dataset?.chatSessionId || 'main') === currentSessionId) {
        return currentAiMsg
      }
      return Array.from(chatMessages.querySelectorAll('.message.ai'))
        .find(item => item.dataset?.projectId === project.id) || null
    }

    function applyProjectRunStartTime(project, aiMsg) {
      if (!project || !aiMsg) return
      const startedAt = Number(project.aiRunStartedAt || project._aiState?.aiRunStartedAt || 0)
      if (Number.isFinite(startedAt) && startedAt > 0) {
        aiMsg.dataset.workStartTime = String(startedAt)
      }
    }

    function isAiMessageShellEmpty(aiMsg) {
      if (typeof window.AiRuntimeCache?.isAiMessageShellEmpty === 'function') {
        return window.AiRuntimeCache.isAiMessageShellEmpty(aiMsg)
      }
      if (!aiMsg) return true
      const area = aiMsg.querySelector?.('.ai-dynamic-area')
      if (!area) return true
      if (area.children && area.children.length > 0) return false
      if (aiMsg.querySelector?.('.ai-deep-reasoning-block, .ai-thinking-block, .tool-call-group, .ai-work-segment')) {
        return false
      }
      return !String(area.textContent || '').trim()
    }

    function hasFrozenAiSnapshot(project) {
      return !!(project?.aiRunningState?.html || project?._frozenAiHtml)
    }

    function hasRunEvidence(project) {
      if (!project) return false
      return !!(
        project.isRunning ||
        project.awaitingFinalReply ||
        isProjectAiRunActive(project) ||
        hasFrozenAiSnapshot(project) ||
        project.savedAiMsg ||
        (Array.isArray(project.aiOperations) && project.aiOperations.length > 0)
      )
    }

    function ensureRunningAiBlockVisible(project, options = {}) {
      // 切回时 isRunning 可能短暂为 false，但快照/ops 仍在，必须恢复
      if (!project || !hasRunEvidence(project)) return null
      project.isRunning = true

      let visible = getVisibleAiMessageForProject(project)
      const forceSnapshot = options.forceSnapshot === true
      const shellEmpty = isAiMessageShellEmpty(visible)
      const totalOps = Array.isArray(project.aiOperations) ? project.aiOperations.length : 0
      const savedOps = Number(project.savedOperationCount || 0) || 0
      const missingOps = totalOps > savedOps

      // 可见且有内容：挂到底部，并补播切走期间新增 ops
      if (visible && !shellEmpty && !forceSnapshot) {
        const chatMessages = getChatMessages()
        if (chatMessages) {
          try { window.clearWelcomeEmptyState?.({ root: chatMessages }) } catch (_) { /* ignore */ }
          chatMessages.appendChild(visible)
        }
        setCurrentAiMsg(visible)
        if (project._aiState) project._aiState.currentAiMsg = visible
        resumeRunningAiMessage(visible)
        cacheAiRuntimeForProject(project, visible)
        if (options.replay !== false && missingOps) {
          replayProjectAiOperations(project, savedOps)
          project.savedOperationCount = totalOps
        }
        applyProjectRunStartTime(project, visible)
        return visible
      }

      // 空壳 / 强制快照：走 reattach（优先冻结 HTML）
      if (visible && shellEmpty) {
        project.savedOperationCount = 0
      }

      const restored = reattachProjectAiRuntime(project, {
        ...options,
        replay: options.replay !== false,
        forceSnapshot: forceSnapshot || shellEmpty
      })
      if (restored) {
        applyProjectRunStartTime(project, restored)
        updateSendBtnState()
        return restored
      }

      // 最后兜底：新建空壳 + 全量回放
      const newMsg = createAiMessage()
      setCurrentAiMsg(newMsg)
      if (!newMsg) return null
      newMsg.dataset.projectId = project.id
      newMsg.dataset.chatSessionId = window.RunningUiRestore?.currentSessionId?.(project) || String(project.chatSessionId || '').trim() || 'main'
      applyProjectRunStartTime(project, newMsg)
      setCurrentToolCount(project.savedToolCount || project._aiState?.currentToolCount || 0)
      setCurrentOpCount(project.savedOpCount || project._aiState?.currentOpCount || 0)
      if (project._aiState) project._aiState.currentAiMsg = newMsg

      const chatMessages = getChatMessages()
      if (chatMessages) {
        try { window.clearWelcomeEmptyState?.({ root: chatMessages }) } catch (_) { /* ignore */ }
        chatMessages.appendChild(newMsg)
      }

      replayProjectAiOperations(project, 0)
      project.savedOperationCount = Array.isArray(project.aiOperations) ? project.aiOperations.length : 0

      resumeRunningAiMessage(newMsg)
      cacheAiRuntimeForProject(project, newMsg)
      updateSendBtnState()
      return newMsg
    }

    function scheduleRunningAiBlockEnsure(project) {
      const projectId = project?.id
      if (!projectId) return
      window.setTimeout(() => {
        if (projectId !== getActiveProjectId()) return
        const activeProject = getActiveProject()
        if (!activeProject || activeProject.id !== projectId) return
        if (!(activeProject.isRunning || isProjectAiRunActive(activeProject))) return
        ensureRunningAiBlockVisible(activeProject, { replay: true })
        syncAiStateToProject()
      }, 60)
    }

    return {
      ensureCurrentAiMessageForProject,
      getVisibleAiMessageForProject,
      applyProjectRunStartTime,
      ensureRunningAiBlockVisible,
      scheduleRunningAiBlockEnsure
    }
  }

  window.AiMessageHelpers = { bind }
})()
