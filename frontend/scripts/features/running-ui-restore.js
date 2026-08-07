// 运行中 AI UI 的跨项目切换恢复
// 独立于 project 对象与 live DOM：用 projectId -> 冻结快照 Map 存盘，
// 切回后可在历史/虚拟滚动多次清空容器后反复重建。
(function () {
  'use strict'

  /** @type {Map<string, object>} */
  const snapshots = new Map()
  /** @type {Map<string, { observer: MutationObserver, timer: any }>} */
  const guards = new Map()

  function projectKey(projectOrId) {
    if (!projectOrId) return ''
    if (typeof projectOrId === 'string') return projectOrId
    return String(projectOrId.id || projectOrId.path || '')
  }

  function normalizeSessionId(sessionId) {
    return String(sessionId || '').trim() || 'main'
  }

  function currentSessionId(project) {
    if (!project) return 'main'
    const direct = String(project.chatSessionId || '').trim()
    if (direct) return direct
    const sessions = Array.isArray(project.chatSessions) ? project.chatSessions : []
    const current = sessions.find(item => item?.current)?.sessionId
      || sessions.find(item => item?.isPrimary)?.sessionId
      || sessions.find(item => item?.sessionId === 'main')?.sessionId
    return normalizeSessionId(current)
  }

  function runningSessionId(project, explicitSessionId) {
    if (explicitSessionId !== undefined && explicitSessionId !== null) {
      return normalizeSessionId(explicitSessionId)
    }
    return normalizeSessionId(project?._runningSessionId || currentSessionId(project))
  }

  function scopeKey(projectOrId, sessionId) {
    const pid = projectKey(projectOrId)
    if (!pid) return ''
    const sid = typeof projectOrId === 'object'
      ? (sessionId === undefined ? currentSessionId(projectOrId) : normalizeSessionId(sessionId))
      : normalizeSessionId(sessionId)
    return `${pid}\u001f${sid}`
  }

  function isCurrentSessionRunning(project) {
    if (!project) return false
    const runningRaw = String(project._runningSessionId || '').trim()
    if (runningRaw && normalizeSessionId(runningRaw) !== currentSessionId(project)) return false
    const startedAt = Number(project.aiRunStartedAt || project._aiState?.aiRunStartedAt || 0)
    const completedAt = Number(project.aiRunCompletedAt || project._aiState?.aiRunCompletedAt || 0)
    return !!(project.isRunning || project.awaitingFinalReply || (startedAt > 0 && completedAt <= 0))
  }

  function isShellEmpty(aiMsg) {
    if (!aiMsg) return true
    const area = aiMsg.querySelector?.('.ai-dynamic-area')
    if (area && area.children && area.children.length > 0) return false
    if (aiMsg.querySelector?.('.ai-deep-reasoning-block, .ai-thinking-block, .tool-call-group, .ai-work-segment, .intermediate-content-block')) {
      return false
    }
    if (area && String(area.textContent || '').trim()) return false
    // header + empty area 也算空壳
    return true
  }

  function findLiveRunningAiMsg(container, project) {
    if (!container) return null
    const pid = project?.id || ''
    const sid = currentSessionId(project)
    const all = Array.from(container.querySelectorAll?.('.message.ai') || [])
    const belongs = el => (!pid || el.dataset?.projectId === pid) && normalizeSessionId(el.dataset?.chatSessionId) === sid
    // 优先：带 projectId 且 thinking
    let hit = all.find(el => el.classList?.contains('thinking') && belongs(el))
    if (hit) return hit
    if (pid) {
      const same = all.filter(belongs)
      const running = same.find(el => el.classList?.contains('thinking'))
      if (running) return running
      return same.length ? same[same.length - 1] : null
    }
    hit = all.find(el => el.classList?.contains('thinking'))
    if (hit) return hit
    // 最后：同项目最新 AI 块
    if (pid) {
      const same = all.filter(belongs)
      if (same.length) return same[same.length - 1]
    }
    return all.length ? all[all.length - 1] : null
  }

  function freezeFromElement(project, aiMsg, extras = {}) {
    const sessionId = runningSessionId(project, extras.sessionId ?? aiMsg?.dataset?.chatSessionId)
    const key = scopeKey(project, sessionId)
    if (!key || !aiMsg) return null
    if (project?.id) aiMsg.dataset.projectId = project.id
    aiMsg.dataset.chatSessionId = sessionId
    const html = aiMsg.innerHTML || ''
    if (!html || html.length < 20) {
      // 空壳也记下来，至少保留 class/header 结构
    }
    const opCount = Array.isArray(project.aiOperations) ? project.aiOperations.length : 0
    const snap = {
      projectId: projectKey(project),
      chatSessionId: sessionId,
      html,
      className: aiMsg.className || 'message ai thinking',
      dataset: { ...(aiMsg.dataset || {}) },
      toolCount: Number(extras.toolCount ?? project.savedToolCount ?? 0) || 0,
      opCount: Number(extras.opCount ?? project.savedOpCount ?? 0) || 0,
      frozenOpCount: opCount,
      isRunning: true,
      workStartTime: aiMsg.dataset?.workStartTime || String(project.aiRunStartedAt || Date.now()),
      frozenAt: Date.now(),
      visualHint: !isShellEmpty(aiMsg)
    }
    snapshots.set(key, snap)

    // 同步写回 project，兼容旧路径
    project._frozenAiHtml = snap.html
    project._frozenAiClassName = snap.className
    project._frozenAiDataset = { ...snap.dataset }
    project._frozenOpCount = snap.frozenOpCount
    project._frozenAt = snap.frozenAt
    project._pendingRunningUiRestore = true
    project.aiRunningState = {
      html: snap.html,
      className: snap.className,
      dataset: { ...snap.dataset },
      toolCount: snap.toolCount,
      opCount: snap.opCount,
      _opCountAtFreeze: snap.frozenOpCount
    }
    project.savedOperationCount = snap.frozenOpCount
    project.savedAiMsg = aiMsg
    project.savedToolCount = snap.toolCount
    project.savedOpCount = snap.opCount
    return snap
  }

  /**
   * 离开项目前冻结运行中 UI。
   * 即使 getCurrentAiMsg() 为空，也会从 DOM 里找 thinking 块。
   */
  function freezeLeavingProject(project, options = {}) {
    if (!project) return null
    const container = options.container || document.getElementById('chatMessages')
    let aiMsg = options.aiMsg || null
    if (!aiMsg || !aiMsg.querySelector) {
      aiMsg = findLiveRunningAiMsg(container, project)
    }
    // 无 live 节点时，若已有旧冻结且仍 running，保留旧快照
    if (!aiMsg) {
      const existing = snapshots.get(scopeKey(project, options.sessionId))
      if (existing && (project.isRunning || project.awaitingFinalReply || (project.aiOperations || []).length)) {
        project._pendingRunningUiRestore = true
        return existing
      }
      return null
    }
    const shouldFreeze = !!(
      project.isRunning ||
      project.awaitingFinalReply ||
      options.force ||
      aiMsg.classList?.contains('thinking') ||
      !isShellEmpty(aiMsg) ||
      (Array.isArray(project.aiOperations) && project.aiOperations.length > 0)
    )
    if (!shouldFreeze) return null
    project.isRunning = true
    return freezeFromElement(project, aiMsg, {
      toolCount: options.toolCount,
      opCount: options.opCount,
      sessionId: options.sessionId
    })
  }

  function getSnapshot(projectOrId, sessionId) {
    const key = scopeKey(projectOrId, sessionId)
    if (!key) return null
    return snapshots.get(key) || null
  }

  function hasSnapshot(projectOrId, sessionId) {
    const snap = getSnapshot(projectOrId, sessionId)
    if (snap?.html) return true
    const p = typeof projectOrId === 'object' ? projectOrId : null
    if (!p || !isCurrentSessionRunning(p)) return false
    const datasetSession = p?._frozenAiDataset?.chatSessionId || p?.aiRunningState?.dataset?.chatSessionId
    return (!datasetSession || normalizeSessionId(datasetSession) === currentSessionId(p)) && !!(p?._frozenAiHtml || p?.aiRunningState?.html)
  }

  function buildElementFromSnapshot(project, snap) {
    const html = snap?.html || project?._frozenAiHtml || project?.aiRunningState?.html || ''
    if (!html) return null
    const el = document.createElement('div')
    el.className = snap?.className || project?._frozenAiClassName || project?.aiRunningState?.className || 'message ai thinking'
    try {
      el.innerHTML = html
    } catch (e) {
      console.warn('[RunningUiRestore] parse snapshot failed', e)
      return null
    }
    const dataset = snap?.dataset || project?._frozenAiDataset || project?.aiRunningState?.dataset || {}
    Object.entries(dataset).forEach(([k, v]) => {
      if (v != null) el.dataset[k] = v
    })
    if (project?.id) el.dataset.projectId = project.id
    el.dataset.chatSessionId = snap?.chatSessionId || currentSessionId(project)
    el.classList.add('thinking')
    if (!el.dataset.workStartTime) {
      el.dataset.workStartTime = String(project.aiRunStartedAt || snap?.workStartTime || Date.now())
    }
    return el
  }

  function replayOps(project, startIndex, deps) {
    if (!deps?.replayProjectAiOperations) return
    const start = Math.max(0, Number(startIndex) || 0)
    deps.replayProjectAiOperations(project, start)
    project.savedOperationCount = Array.isArray(project.aiOperations) ? project.aiOperations.length : start
  }

  /**
   * 把冻结的运行中 AI UI 挂回 chatMessages 底部。
   * 可重复调用：容器被 scroller 清空后再次调用仍可恢复。
   */
  function restoreToContainer(project, options = {}) {
    if (!project) return null
    if (!isCurrentSessionRunning(project)) return null
    const container = options.container || document.getElementById('chatMessages')
    if (!container) return null

    const key = scopeKey(project)
    const snap = getSnapshot(project) || {
      html: project._frozenAiHtml || project.aiRunningState?.html || '',
      className: project._frozenAiClassName || project.aiRunningState?.className,
      dataset: project._frozenAiDataset || project.aiRunningState?.dataset,
      frozenOpCount: project._frozenOpCount ?? project.aiRunningState?._opCountAtFreeze ?? project.savedOperationCount ?? 0,
      toolCount: project.savedToolCount || 0,
      opCount: project.savedOpCount || 0
    }

    const deps = options.deps || {}
    project.isRunning = true
    project._pendingRunningUiRestore = true

    // 若容器里已有非空同项目过程块，只补 ops 并置底
    let existing = findLiveRunningAiMsg(container, project)
    if (existing && !isShellEmpty(existing) && options.forceRebuild !== true) {
      if (existing.parentNode !== container || container.lastElementChild !== existing) container.appendChild(existing)
      if (deps.setCurrentAiMsg) deps.setCurrentAiMsg(existing)
      project.savedAiMsg = existing
      if (project._aiState) project._aiState.currentAiMsg = existing
      deps.resumeRunningAiMessage?.(existing)
      const watermark = Number(project.savedOperationCount || snap.frozenOpCount || 0) || 0
      const total = Array.isArray(project.aiOperations) ? project.aiOperations.length : 0
      if (options.replay !== false && total > watermark) {
        replayOps(project, watermark, deps)
      }
      deps.cacheAiRuntimeForProject?.(project, existing)
      return existing
    }

    // 从快照重建
    let aiMsg = buildElementFromSnapshot(project, snap)
    if (!aiMsg) {
      // 无快照：新建空壳 + 全量回放
      aiMsg = deps.createAiMessage?.() || null
      if (!aiMsg) {
        aiMsg = document.createElement('div')
        aiMsg.className = 'message ai thinking'
        aiMsg.innerHTML = '<div class="ai-header">灵犀LingXiCode</div><div class="ai-dynamic-area"></div><div class="ai-content"></div>'
      }
      if (project.id) aiMsg.dataset.projectId = project.id
      aiMsg.dataset.chatSessionId = currentSessionId(project)
      if (deps.setCurrentAiMsg) deps.setCurrentAiMsg(aiMsg)
      project.savedAiMsg = aiMsg
      if (project._aiState) project._aiState.currentAiMsg = aiMsg
      try { window.clearWelcomeEmptyState?.({ root: container }) } catch (_) {}
      container.appendChild(aiMsg)
      if (options.replay !== false) replayOps(project, 0, deps)
      deps.resumeRunningAiMessage?.(aiMsg)
      deps.cacheAiRuntimeForProject?.(project, aiMsg)
      return aiMsg
    }

    // 移除旧的同项目空壳，避免重复
    Array.from(container.querySelectorAll('.message.ai')).forEach(el => {
      if (el === aiMsg) return
      if (project.id && el.dataset?.projectId && el.dataset.projectId !== project.id) return
      if (el.classList?.contains('thinking') || isShellEmpty(el)) {
        try { el.remove() } catch (_) {}
      }
    })

    if (deps.setCurrentAiMsg) deps.setCurrentAiMsg(aiMsg)
    if (deps.setCurrentToolCount) deps.setCurrentToolCount(snap.toolCount || project.savedToolCount || 0)
    if (deps.setCurrentOpCount) deps.setCurrentOpCount(snap.opCount || project.savedOpCount || 0)
    project.savedAiMsg = aiMsg
    if (project._aiState) project._aiState.currentAiMsg = aiMsg

    try { window.clearWelcomeEmptyState?.({ root: container }) } catch (_) {}
    container.appendChild(aiMsg)

    // 从冻结水位补播切走期间 ops
    const leaveWatermark = Number(snap.frozenOpCount ?? project._frozenOpCount ?? 0) || 0
    if (options.replay !== false) {
      replayOps(project, leaveWatermark, deps)
    }

    deps.resumeRunningAiMessage?.(aiMsg)
    deps.cacheAiRuntimeForProject?.(project, aiMsg)

    if (!isShellEmpty(aiMsg)) {
      project._pendingRunningUiRestore = false
    }
    return aiMsg
  }

  /** 在历史/scroller 反复清空时，短暂守卫：节点被摘掉就立刻挂回 */
  function armGuard(project, options = {}) {
    if (!isCurrentSessionRunning(project)) return
    const key = scopeKey(project)
    const guardedSessionId = currentSessionId(project)
    const container = options.container || document.getElementById('chatMessages')
    if (!key || !container) return
    disarmGuard(key)

    const deps = options.deps || {}
    const durationMs = Number(options.durationMs) || 2500
    const observer = new MutationObserver(() => {
      if (deps.getActiveProjectId?.() !== project.id || currentSessionId(project) !== guardedSessionId || !isCurrentSessionRunning(project)) {
        // 已切到别的项目，停止守卫
        disarmGuard(key)
        return
      }
      const live = findLiveRunningAiMsg(container, project)
      if (!live || isShellEmpty(live) || !container.contains(live)) {
        restoreToContainer(project, { container, deps, forceRebuild: !live || isShellEmpty(live) })
      } else if (container.lastElementChild !== live) {
        // 仅把运行中 AI 沉底；其前的 running-user 气泡跟着移到 AI 正上方，不触碰其它历史轮
        try {
          const scopePrefix = project?.id ? `${project.id}\u001f` : ''
          const runningUser = Array.from(container.querySelectorAll('.message.user[data-running-user-anchor]'))
            .find(node => {
              const anchor = String(node.dataset?.runningUserAnchor || '')
              return scopePrefix ? anchor.startsWith(scopePrefix) : !!anchor
            })
          if (runningUser && container.contains(runningUser)) {
            container.insertBefore(runningUser, live)
          }
          container.appendChild(live)
        } catch (_) { /* ignore */ }
      }
    })
    observer.observe(container, { childList: true, subtree: false })
    const timer = setTimeout(() => disarmGuard(key), durationMs)
    guards.set(key, { observer, timer })
  }

  function disarmGuard(projectOrId) {
    const key = guards.has(String(projectOrId || '')) ? String(projectOrId || '') : scopeKey(projectOrId)
    const g = guards.get(key)
    if (!g) return
    try { g.observer.disconnect() } catch (_) {}
    try { clearTimeout(g.timer) } catch (_) {}
    guards.delete(key)
  }

  function clearSnapshot(projectOrId, sessionId) {
    const key = scopeKey(projectOrId, sessionId)
    if (key) snapshots.delete(key)
    disarmGuard(key)
  }

  function hasEvidence(project) {
    if (!project) return false
    if (!isCurrentSessionRunning(project)) return false
    return !!(
      project.isRunning ||
      project.awaitingFinalReply ||
      project._pendingRunningUiRestore ||
      hasSnapshot(project) ||
      (Array.isArray(project.aiOperations) && project.aiOperations.length > 0) ||
      project.savedAiMsg
    )
  }

  window.RunningUiRestore = {
    freezeLeavingProject,
    freezeFromElement,
    getSnapshot,
    hasSnapshot,
    hasEvidence,
    restoreToContainer,
    armGuard,
    disarmGuard,
    clearSnapshot,
    isShellEmpty,
    findLiveRunningAiMsg,
    currentSessionId,
    runningSessionId,
    scopeKey,
    isCurrentSessionRunning,
    snapshots // debug
  }
})()
