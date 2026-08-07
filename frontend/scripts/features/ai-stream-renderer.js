// AI 流式渲染模块
// 负责AI消息的流式内容渲染：思考块管理、内容片段追加、最终流式输出、打字机效果等。
// 通过 window.AiStreamRenderer.bind(deps) 注入依赖后使用。

(function () {
  let deps = {}

  // 创建AI消息框架
  function createAiMessage() {
    const aiMessageUI = deps.getAiMessageUI()
    const msg = aiMessageUI?.createAiMessage(deps.getModelDisplayName())
    if (!msg) return null
    const project = deps.getActiveProject()
    if (project?.id) msg.dataset.projectId = project.id
    const userMsgCount = project ? project.history.filter(m => m.role === 'user' && !m.hidden).length : 0
    if (userMsgCount > 0) {
      msg.dataset.turnId = userMsgCount
    }
    msg.dataset.messagePart = 'assistant'
    deps.getChatMessages().appendChild(msg)
    deps.scrollToLatestAiMessage()

    // 重置交替显示相关状态
    deps.setCurrentThinkingBlock(null)
    deps.setCurrentThinkingStartTime(null)
    deps.setToolCallCount(0)

    return msg
  }

  // 创建新的独立思考块
  function createNewThinkingBlock(options = {}) {
    const currentAiMsg = deps.getCurrentAiMsg()
    if (!currentAiMsg) return
    const aiMessageUI = deps.getAiMessageUI()
    const result = aiMessageUI?.createNewThinkingBlock(currentAiMsg, deps.getCurrentThinkingBlock(), options)
    if (!result) return

    deps.setCurrentThinkingBlock(result.block)
    deps.setCurrentThinkingStartTime(Date.now())
    deps.setCurrentThinkingTimerId(result.timerId)

    return result.block
  }

  // 结束思考块计时
  function stopThinkingTimer(aiMsg) {
    if (!aiMsg) return
    aiMsg.querySelectorAll('.ai-thinking-block.active').forEach(block => {
      deps.finishThinkingBlock(block, 'done')
    })
  }

  // 设置AI状态播报（动画生命周期：当前块保持动画直到新块创建时才停止）
  function addThinking(content, options = {}) {
    const currentAiMsg = deps.getCurrentAiMsg()
    if (currentAiMsg && content) {
      if (!options.isStatus && !options.isProgressNarration && !options.isReasoningSummary) return

      deps.updateWorkStatus('working')

      // 记录当前块，用于判断是否创建了新块
      const previousBlock = deps.getCurrentThinkingBlock()
      const isPublicNote = !!(options.isStatus || options.isProgressNarration)
      const isReasoningBlock = !!options.isReasoningSummary
      const previousKind = previousBlock?.dataset?.thinkingKind || ''

      if (isPublicNote && previousBlock && previousKind === 'reasoning' && !previousBlock.classList.contains('stopped')) {
        deps.finishThinkingBlock(previousBlock, 'reasoning-end')
        deps.setCurrentThinkingBlock(null)
      }

      createNewThinkingBlock({
        ...options,
        reuseOpenSegment: isPublicNote ? false : options.reuseOpenSegment
      })

      const currentThinkingBlock = deps.getCurrentThinkingBlock()

      // 新块创建时才停止旧块动画（而非立即停止）
      if (currentThinkingBlock && currentThinkingBlock !== previousBlock && previousBlock) {
        if (!previousBlock.classList.contains('stopped')) {
          deps.finishThinkingBlock(previousBlock, isReasoningBlock ? 'done' : (previousKind === 'reasoning' ? 'reasoning-end' : 'done'))
        }
      }

      if (currentThinkingBlock) {
        const aiMessageUI = deps.getAiMessageUI()
        aiMessageUI?.updateThinkingProgress(currentThinkingBlock, content, {
          append: !!options.append,
          forceUpdate: !!options.forceUpdate,
          isReasoningSummary: !!options.isReasoningSummary,
          agentRole: options.agentRole || '',
          agentTitle: options.agentTitle || ''
        })
        // 不再在此处立即 finish——动画保持到下一个思考块创建时才停止
      }
    }
  }

  // 流式追加AI正文内容（内容片段显示在动态区域）
  function appendAiContentChunk(content, targetProject = null) {
    AppLogger.debug('[Frontend] appendAiContentChunk:', content?.substring(0, 30))
    let currentAiMsg = deps.getCurrentAiMsg()
    if (!currentAiMsg || !document.contains(currentAiMsg)) {
      currentAiMsg = deps.ensureCurrentAiMessageForProject(targetProject) || deps.getCurrentAiMsg()
    }
    if (currentAiMsg && document.contains(currentAiMsg) && content) {
      // 不结束当前思考块——动画保持到下一个思考块创建时才停止
      deps.updateWorkStatus('done')

      // 内容片段放在动态区域（作为过程记录）
      const dynamicArea = currentAiMsg.querySelector('.ai-dynamic-area')
      if (dynamicArea) {
        // 查找或创建当前轮次的内容片段块
        let contentBlock = dynamicArea.querySelector('.intermediate-content-block.current-round')
        if (!contentBlock) {
          contentBlock = document.createElement('div')
          contentBlock.className = 'intermediate-content-block current-round'
          dynamicArea.appendChild(contentBlock)
        }
        // 流式追加内容
        contentBlock.textContent += content

        // 过程内容更新不强制滚动，用户可手动查看最新内容。
      }
    }
  }

  function resetFinalStreamContent(targetProject = null) {
    let currentAiMsg = deps.getCurrentAiMsg()
    if (targetProject) targetProject.streamingContent = ''
    if (!currentAiMsg || !document.contains(currentAiMsg)) {
      currentAiMsg = deps.ensureCurrentAiMessageForProject(targetProject, { create: false }) || deps.getCurrentAiMsg()
    }
    if (!currentAiMsg || !document.contains(currentAiMsg)) return
    const streamState = currentAiMsg._finalStreamState
    if (streamState?.timer) {
      clearInterval(streamState.timer)
    }
    if (streamState?.rafId) {
      cancelAnimationFrame(streamState.rafId)
    }
    currentAiMsg._finalStreamState = {
      target: '',
      rendered: '',
      timer: null,
      rafId: 0,
      finalize: null,
      _lastFullParseLen: 0,
      _lastDomUpdateAt: 0,
      _stableText: '',
      _tailText: '',
      _openCodeFence: false
    }
    const contentEl = currentAiMsg.querySelector('.ai-content')
    if (contentEl) {
      contentEl.innerHTML = ''
      contentEl.removeAttribute('data-stream-mode')
    }
    currentAiMsg.dataset.finalStreamContent = ''
    currentAiMsg.dataset.finalStreamRendered = ''
    currentAiMsg.dataset.finalStreamStarted = ''
    currentAiMsg.dataset.finalReplyCompleted = ''
  }

  function getFinalStreamState(aiMsg) {
    if (!aiMsg._finalStreamState) {
      aiMsg._finalStreamState = {
        target: aiMsg.dataset.finalStreamContent || '',
        rendered: aiMsg.dataset.finalStreamRendered || '',
        timer: null,
        rafId: 0,
        finalize: null,
        _lastFullParseLen: (aiMsg.dataset.finalStreamRendered || '').length,
        _lastDomUpdateAt: 0,
        _stableText: '',
        _tailText: '',
        _openCodeFence: false
      }
    }
    return aiMsg._finalStreamState
  }

  function countFenceMarkers(text = '') {
    return String(text || '').match(/```/g)?.length || 0
  }

  function findStableStreamBoundary(text = '') {
    const source = String(text || '')
    if (!source) return 0

    // 未闭合代码块时，只把完整 fence 段当稳定区，避免半段代码被 markdown 误拆。
    if (countFenceMarkers(source) % 2 === 1) {
      const lastOpen = source.lastIndexOf('```')
      return Math.max(0, lastOpen)
    }

    const doubleBreak = source.lastIndexOf('\n\n')
    if (doubleBreak >= 0) return doubleBreak + 2

    // 没有自然分段时，保留尾部 180 字做增量，避免每帧全量重解析。
    if (source.length > 280) return source.length - 180
    return 0
  }

  function ensureStreamDomScaffold(contentEl) {
    if (!contentEl) return null
    if (contentEl.dataset.streamMode === '1'
      && contentEl.querySelector('.ai-stream-stable')
      && contentEl.querySelector('.ai-stream-tail')) {
      return {
        stableEl: contentEl.querySelector('.ai-stream-stable'),
        tailEl: contentEl.querySelector('.ai-stream-tail')
      }
    }
    contentEl.dataset.streamMode = '1'
    contentEl.innerHTML = '<div class="ai-stream-stable"></div><div class="ai-stream-tail"></div>'
    return {
      stableEl: contentEl.querySelector('.ai-stream-stable'),
      tailEl: contentEl.querySelector('.ai-stream-tail')
    }
  }

  function updateStreamingDom(contentEl, state) {
    const scaffold = ensureStreamDomScaffold(contentEl)
    if (!scaffold) return

    const rendered = String(state.rendered || '')
    const boundary = findStableStreamBoundary(rendered)
    const nextStable = rendered.slice(0, boundary)
    const nextTail = rendered.slice(boundary)

    if (nextStable !== state._stableText) {
      scaffold.stableEl.innerHTML = nextStable ? deps.sanitizeAiContent(nextStable) : ''
      state._stableText = nextStable
    }

    // 尾部用纯文本增量，避免半段 markdown 被反复全量重解析成碎片段落。
    if (nextTail !== state._tailText) {
      scaffold.tailEl.textContent = nextTail
      state._tailText = nextTail
    }
    state._openCodeFence = countFenceMarkers(rendered) % 2 === 1
  }

  function finalizeFinalStreamState(aiMsg, state) {
    if (!state?.finalize || !aiMsg || !document.contains(aiMsg)) return
    const contentEl = aiMsg.querySelector('.ai-content')
    if (!contentEl) return
    const summaryHtml = deps.generateSummaryHtml(deps.getCurrentToolStats())
    contentEl.removeAttribute('data-stream-mode')
    contentEl.innerHTML = deps.renderAiContent(state.finalize.content || state.target || '', {
      summaryHtml,
      artifacts: state.finalize.artifacts || []
    })
    aiMsg.dataset.finalStreamRendered = state.finalize.content || state.target || ''
    aiMsg.dataset.finalReplyCompleted = 'true'
    state.finalize = null
    state._stableText = ''
    state._tailText = ''
    state._openCodeFence = false
    deps.clearToolStats()
    window.CopyButton?.refresh?.(aiMsg)
  }

  function refreshCurrentSummary(aiMsg = deps.getCurrentAiMsg(), options = {}) {
    if (!aiMsg || !document.contains(aiMsg)) return false
    if (!options.force && aiMsg.dataset.finalReplyCompleted !== 'true') return false
    const contentEl = aiMsg.querySelector('.ai-content')
    if (!contentEl) return false
    const summaryHtml = deps.generateSummaryHtml(deps.getCurrentToolStats())
    const existing = contentEl.querySelector('.ai-summary')
    if (!summaryHtml) {
      if (options.removeEmpty && existing) existing.remove()
      return false
    }
    if (existing) {
      const wrapper = document.createElement('div')
      wrapper.innerHTML = summaryHtml
      const next = wrapper.firstElementChild
      if (next) existing.replaceWith(next)
    } else {
      contentEl.insertAdjacentHTML('beforeend', summaryHtml)
    }
    window.CopyButton?.refresh?.(aiMsg)
    return true
  }

  function renderFinalStreamFrame(aiMsg, targetProject = null) {
    const contentEl = aiMsg?.querySelector?.('.ai-content')
    const state = aiMsg ? getFinalStreamState(aiMsg) : null
    if (!contentEl || !state) return false

    const remaining = state.target.length - state.rendered.length
    if (remaining <= 0) {
      finalizeFinalStreamState(aiMsg, state)
      return false
    }
    // 大步快推：先推进文本状态，再按稳定边界做增量 DOM 更新。
    const batchSize = remaining > 2000 ? 768 : remaining > 600 ? 384 : remaining > 120 ? 192 : 96
    state.rendered += state.target.slice(state.rendered.length, state.rendered.length + batchSize)
    aiMsg.dataset.finalStreamRendered = state.rendered
    if (targetProject) targetProject.streamingContent = state.target

    const reachedEnd = state.rendered.length >= state.target.length
    const deltaSinceLastParse = state.rendered.length - (state._lastFullParseLen || 0)
    const now = Date.now()
    const elapsedSinceDomUpdate = now - Number(state._lastDomUpdateAt || 0)
    // 流式过程中降低 DOM 刷新频率；结束帧必须立刻落地。
    if ((deltaSinceLastParse < 120 || elapsedSinceDomUpdate < 48) && !reachedEnd) {
      return true
    }

    updateStreamingDom(contentEl, state)
    state._lastDomUpdateAt = now
    state._lastFullParseLen = state.rendered.length

    if (reachedEnd) {
      finalizeFinalStreamState(aiMsg, state)
      return false
    }
    return true
  }

  function startFinalStreamPump(aiMsg, targetProject = null) {
    const state = getFinalStreamState(aiMsg)
    if (state.rafId || state.timer) return
    const step = () => {
      state.rafId = 0
      if (!document.contains(aiMsg)) {
        return
      }
      const hasMore = renderFinalStreamFrame(aiMsg, targetProject)
      if (hasMore) {
        state.rafId = requestAnimationFrame(step)
      }
    }
    state.rafId = requestAnimationFrame(step)
  }

  function completeFinalStreamPump(aiMsg, fullContent = '', artifacts = []) {
    if (!aiMsg) return false
    const state = aiMsg._finalStreamState
    if (!state && !aiMsg.dataset.finalStreamStarted) return false
    const streamState = getFinalStreamState(aiMsg)
    if (fullContent && fullContent.length >= streamState.target.length) {
      streamState.target = fullContent
      aiMsg.dataset.finalStreamContent = fullContent
    }
    streamState.finalize = { content: fullContent || streamState.target || aiMsg.dataset.finalStreamContent || '', artifacts }
    renderFinalStreamFrame(aiMsg)
    startFinalStreamPump(aiMsg)
    return true
  }

  function appendAiFinalDelta(content, targetProject = null) {
    if (!content) return
    deps.ensureCurrentAiMessageForProject(targetProject)
    const currentAiMsg = deps.getCurrentAiMsg()
    if (!currentAiMsg) return

    const currentThinkingBlock = deps.getCurrentThinkingBlock()
    if (currentThinkingBlock && !currentThinkingBlock.classList.contains('stopped')) {
      deps.finishThinkingBlock(currentThinkingBlock, 'done')
    }
    deps.setCurrentThinkingBlock(null)
    currentAiMsg.classList.remove('thinking')
    // 最终正文开始流式输出时，统一收起之前所有深度思考推理块
    window.AiMessageUI?.collapseAllDeepReasoningBlocks?.(currentAiMsg)

    const contentEl = currentAiMsg.querySelector('.ai-content')
    if (!contentEl) return
    const streamState = getFinalStreamState(currentAiMsg)
    streamState.target += content
    currentAiMsg.dataset.finalStreamStarted = 'true'
    currentAiMsg.dataset.finalReplyCompleted = ''
    currentAiMsg.dataset.finalStreamContent = streamState.target
    if (targetProject) targetProject.streamingContent = streamState.target
    renderFinalStreamFrame(currentAiMsg, targetProject)
    deps.collapseDynamicArea()
    // 最终正文开始、思考工具区收起时，把隐藏的注入消息重定位到最近一条用户消息下面
    try { window.MessageQueue?.relocatePendingInterjectMessages?.() } catch (_) {}
    deps.updateWorkStatus('done')
    startFinalStreamPump(currentAiMsg, targetProject)
  }

  // 完成流式输出（最终处理）
  function finishAiStreaming(fullContent, artifacts = []) {
    // 主AI回复正文完成，隐藏Agent面板
    if (typeof AgentUI !== 'undefined') {
      AgentUI.hidePanel()
    }
    const currentAiMsg = deps.getCurrentAiMsg()
    if (currentAiMsg) {
      deps.updateWorkStatus('done')
      // 最终正文落地时统一收起深度思考推理块
      window.AiMessageUI?.collapseAllDeepReasoningBlocks?.(currentAiMsg)
      const contentEl = currentAiMsg.querySelector('.ai-content')
      if (contentEl && fullContent) {
        const alreadyStreamed = completeFinalStreamPump(currentAiMsg, fullContent, artifacts)
        if (!alreadyStreamed) {
          currentAiMsg.dataset.finalReplyCompleted = ''
          deps.startTypewriterEffect(contentEl, fullContent, {
            artifacts,
            onFirstFrame: () => {
              deps.collapseDynamicArea()
              try { window.MessageQueue?.relocatePendingInterjectMessages?.() } catch (_) {}
            }
          })
        } else if (fullContent) {
          deps.collapseDynamicArea()
          try { window.MessageQueue?.relocatePendingInterjectMessages?.() } catch (_) {}
        }
      }
      currentAiMsg.classList.remove('thinking')
      window.CopyButton?.refresh?.(currentAiMsg)
    }
  }

  // 更新当前AI消息的统计
  function updateAiStats() {
    const currentAiMsg = deps.getCurrentAiMsg()
    if (currentAiMsg) {
      const statsEl = currentAiMsg.querySelector('.ai-stats')
      if (statsEl) statsEl.textContent = `${deps.getCurrentToolCount()}个工具调用，${deps.getCurrentOpCount()}条操作消息`
    }
  }

  // 完成流式输出（中断时）
  function finishStreamingOnInterrupt() {
    const currentThinkingBlock = deps.getCurrentThinkingBlock()
    // 先结束当前思考块（如果有）
    if (currentThinkingBlock && !currentThinkingBlock.classList.contains('stopped')) {
      deps.finishThinkingBlock(currentThinkingBlock, 'interrupted')
    }

    const currentAiMsg = deps.getCurrentAiMsg()
    if (currentAiMsg) {
      // 停止深度思考块的计时器，避免中断后计时还在跑
      window.AiMessageUI?.finishDeepReasoningBlock?.(currentAiMsg)
      window.AiMessageUI?.collapseAllDeepReasoningBlocks?.(currentAiMsg)
      // 结束"已用时"会话计时（final=true 会设置 workDone='true' 并 clearWorkTimer）
      window.AiMessageUI?.updateWorkElapsed?.(currentAiMsg, true)
      currentAiMsg.classList.remove('thinking')
      deps.updateWorkStatus('interrupted')
      deps.collapseDynamicArea()
      try { window.MessageQueue?.relocatePendingInterjectMessages?.() } catch (_) {}
      const contentEl = currentAiMsg.querySelector('.ai-content')
      if (contentEl) {
        // 获取当前已流式显示的纯文本内容，渲染为Markdown
        const currentText = contentEl.textContent || ''
        const summaryHtml = deps.generateSummaryHtml(deps.getCurrentToolStats())
        contentEl.innerHTML = deps.renderAiContent(currentText, { summaryHtml })
      }
      deps.clearToolStats()
    }
  }

  function isInternalUiOnlyTool(name = '') {
    return ['report_progress', 'start_final_reply', 'show_thinking_note', 'complete_step', 'create_inline_visual'].includes(String(name || ''))
  }

  // 添加操作记录（交替显示模式）
  function addOperation(name, args, result, meta = {}) {
    if (isInternalUiOnlyTool(name)) return
    const currentAiMsg = deps.getCurrentAiMsg()
    if (currentAiMsg) {
      // 不结束当前思考块——动画保持到下一个思考块创建时才停止
      const aiToolRenderer = deps.getAiToolRenderer()
      const card = aiToolRenderer?.addOperation(name, args || {}, result || {}, deps.getCurrentToolStats(), meta)
      if (!card) return
      deps.setToolCallCount(deps.getToolCallCount() + 1)
      refreshCurrentSummary(currentAiMsg)
    }
  }

  // 添加中间内容片段（过程中的正文片段）
  function addIntermediateContent(content) {
    const currentAiMsg = deps.getCurrentAiMsg()
    if (currentAiMsg && content) {
      // 不结束当前思考块——动画保持到下一个思考块创建时才停止
      const aiToolRenderer = deps.getAiToolRenderer()
      const contentBlock = aiToolRenderer?.addIntermediateContent(content)
    }
  }

  function bind(depsObj = {}) {
    deps = depsObj
  }

  window.AiStreamRenderer = {
    bind,
    createAiMessage,
    createNewThinkingBlock,
    stopThinkingTimer,
    addThinking,
    appendAiContentChunk,
    resetFinalStreamContent,
    appendAiFinalDelta,
    finishAiStreaming,
    refreshCurrentSummary,
    updateAiStats,
    finishStreamingOnInterrupt,
    isInternalUiOnlyTool,
    addOperation,
    addIntermediateContent
  }
})()
