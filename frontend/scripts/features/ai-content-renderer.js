(function () {
  function bind(options = {}) {
    const getCurrentAiMsg = options.getCurrentAiMsg || function () { return null }
    const getAiMessageUI = options.getAiMessageUI || function () { return null }
    const getChatMessages = options.getChatMessages || function () { return null }
    const getCurrentToolStats = options.getCurrentToolStats || function () { return { modified: [], created: [], read: [], commands: [] } }
    const generateSummaryHtml = options.generateSummaryHtml || function () { return '' }
    const clearToolStats = options.clearToolStats || function () {}
    const stopThinkingTimer = options.stopThinkingTimer || function () {}
    const updateWorkStatus = options.updateWorkStatus || function () {}

    // 设置AI内容（流式打字机效果）
    function setAiContent(content) {
      const currentAiMsg = getCurrentAiMsg()
      const aiMessageUI = getAiMessageUI()
      if (!currentAiMsg) return

      const contentEl = currentAiMsg.querySelector('.ai-content')
      if (!contentEl) return

      // 停止思考计时器
      stopThinkingTimer(currentAiMsg)
      updateWorkStatus('done')

      // 收起思考内容（AI开始输出正文）
      const blockEl = currentAiMsg.querySelector('.ai-thinking-block')
      if (blockEl) {
        const thinkingContentEl = blockEl.querySelector('.ai-thinking-content')
        const thinkingHeaderRowEl = blockEl.querySelector('.ai-thinking-header-row')
        const toggleEl = thinkingHeaderRowEl?.querySelector('.ai-thinking-toggle')
        if (thinkingContentEl) thinkingContentEl.classList.add('collapsed')
        if (thinkingHeaderRowEl) thinkingHeaderRowEl.classList.add('collapsed')
        if (toggleEl) toggleEl.textContent = '▸'
      }

      // 移除 thinking 类（思考结束）
      currentAiMsg.classList.remove('thinking')
      window.CopyButton?.refresh?.(currentAiMsg)

      // 启动打字机效果
      startTypewriterEffect(contentEl, content)
    }

    // 打字机效果
    function startTypewriterEffect(targetEl, fullContent, options = {}) {
      const aiMessageUI = getAiMessageUI()
      return aiMessageUI?.startTypewriterEffect(targetEl, fullContent, {
        scrollContainer: getChatMessages(),
        sanitizeContent: sanitizeAiContent,
        getSummaryHtml: () => generateSummaryHtml(getCurrentToolStats()),
        onFirstFrame: options.onFirstFrame,
        artifacts: options.artifacts || [],
        onComplete: clearToolStats
      })
    }

    // 立即完成打字机效果（用于中断等情况）
    function finishTypewriterEffect() {
      const aiMessageUI = getAiMessageUI()
      return aiMessageUI?.finishTypewriterEffect({
        sanitizeContent: sanitizeAiContent,
        getSummaryHtml: () => generateSummaryHtml(getCurrentToolStats()),
        onComplete: clearToolStats
      })
    }

    // 旧版本的 setAiContent（保留兼容，用于历史恢复等场景）
    function setAiContentImmediate(content) {
      const currentAiMsg = getCurrentAiMsg()
      if (currentAiMsg) {
        const contentEl = currentAiMsg.querySelector('.ai-content')
        if (contentEl) {
          const summaryHtml = generateSummaryHtml(getCurrentToolStats())
          contentEl.innerHTML = renderAiContent(content, { summaryHtml })
        }
        window.CopyButton?.refresh?.(currentAiMsg)
        // AI有正文回复时，自动收起执行进度
        if (content && content.trim().length > 0) {
          const execProgress = currentAiMsg.querySelector('.execution-progress')
          if (execProgress && execProgress.classList.contains('expanded')) {
            execProgress.classList.remove('expanded')
            const toggleEl = execProgress.querySelector('.progress-toggle')
            if (toggleEl) toggleEl.textContent = ((window.i18n?.t?.('auto.js_app_2498_4') ?? ((window.i18n?.t?.('auto.js_app_2498_26') ?? '展开'))))
          }
        }
        // 清空统计（摘要已生成）
        clearToolStats()
      }
    }

    // 净化AI内容，防止CSS/JS影响全局
    function sanitizeAiContent(content) {
      const aiMessageUI = getAiMessageUI()
      return aiMessageUI?.sanitizeAiContent(content) ?? content
    }

    function normalizeRenderOptions(options = {}) {
      if (typeof options === 'string') {
        return { summaryHtml: options }
      }
      return options || {}
    }

    function renderAiContent(content, options = {}) {
      const aiMessageUI = getAiMessageUI()
      const normalized = normalizeRenderOptions(options)
      const summaryHtml = normalized.summaryHtml || ''
      return aiMessageUI?.renderAiContent(content, normalized) ?? (sanitizeAiContent(content) + summaryHtml)
    }

    return {
      setAiContent,
      startTypewriterEffect,
      finishTypewriterEffect,
      setAiContentImmediate,
      sanitizeAiContent,
      normalizeRenderOptions,
      renderAiContent
    }
  }

  window.AiContentRenderer = { bind }
})()
