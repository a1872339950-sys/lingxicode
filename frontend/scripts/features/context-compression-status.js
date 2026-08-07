// 上下文压缩状态卡
// 监听后端 context-compression-start / context-split 事件，
// 在 chatMessages 容器里渲染"正在整理上下文中 / 上下文已压缩完成"状态卡。
// 保证在 AI 思考/工具调用/回复卡片出现之前完成展示并淡出。

(function () {
  let card = null
  let cardProjectId = null
  let timerId = null
  let startTime = 0
  let hideTimeout = null
  let lastSummaryId = null
  let inFlight = false
  let listeners = []
  let bound = false

  function notifyInFlight() {
    for (const listener of listeners) {
      try { listener(inFlight) } catch (err) { console.error('[ContextCompressionStatus] listener error', err) }
    }
  }

  const formatElapsed = FormatUtils.formatElapsedMs

  function ensureCard(container) {
    if (card && card.parentNode === container) return card
    removeCard()
    card = document.createElement('div')
    card.className = 'cc-status-card running'
    card.setAttribute('data-cc-status', 'true')
    card.innerHTML = `
      <div class="cc-icon">
        <span class="cc-spinner"></span>
      </div>
      <div class="cc-body">
        <div class="cc-status">正在整理上下文中</div>
        <div class="cc-meta">准备中…</div>
      </div>
    `
    container.appendChild(card)
    return card
  }

  function removeCard() {
    if (card && card.parentNode) card.parentNode.removeChild(card)
    card = null
    if (timerId) {
      clearInterval(timerId)
      timerId = null
    }
    if (hideTimeout) {
      clearTimeout(hideTimeout)
      hideTimeout = null
    }
  }

  function setIcon(iconHtml) {
    if (!card) return
    const iconEl = card.querySelector('.cc-icon')
    if (iconEl) iconEl.innerHTML = iconHtml
  }

  function startRunning(container, projectId, payload) {
    cardProjectId = projectId
    startTime = Date.now()
    lastSummaryId = payload?.compressionSummaryId || null
    inFlight = true
    notifyInFlight()
    const c = ensureCard(container)
    c.classList.remove('done', 'failed', 'fade-out')
    c.classList.add('running')
    setIcon('<span class="cc-spinner"></span>')
    c.querySelector('.cc-status').textContent = (window.i18n?.t?.('auto.js_context_compression_status_72_0') ?? ((window.i18n?.t?.('auto.js_context_compression_status_72_1') ?? '正在整理上下文中')))
    c.querySelector('.cc-meta').textContent = (window.i18n?.t?.('auto.js_context_compression_status_73_1') ?? ((window.i18n?.t?.('auto.js_context_compression_status_73_2') ?? '准备中…')))
    if (hideTimeout) { clearTimeout(hideTimeout); hideTimeout = null }
    if (timerId) clearInterval(timerId)
    timerId = setInterval(() => {
      if (!card) return
      const meta = card.querySelector('.cc-meta')
      if (meta) meta.textContent = `已整理 ${formatElapsed(Date.now() - startTime)}`
    }, 200)
    // 让 chatMessages 自动滚到最底（仅在用户尚未主动向上滚时）
    try {
      if (!window.ChatStickyBottom?.isEscaped?.(container)) {
        container.scrollTop = container.scrollHeight
      }
    } catch (e) { /* ignore */ }
  }

  function finishDone(container, projectId, payload) {
    cardProjectId = projectId
    const total = Date.now() - startTime
    inFlight = false
    notifyInFlight()
    if (payload?.compressionSummaryId) lastSummaryId = payload.compressionSummaryId
    const c = ensureCard(container)
    c.classList.remove('running', 'failed', 'fade-out')
    c.classList.add('done')
    setIcon('<span class="cc-check"><svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg></span>')
    c.querySelector('.cc-status').textContent = (window.i18n?.t?.('auto.js_context_compression_status_94_2') ?? ((window.i18n?.t?.('auto.js_context_compression_status_94_3') ?? '上下文已压缩完成')))
    c.querySelector('.cc-meta').textContent = `用时 ${formatElapsed(total)}`
    if (timerId) { clearInterval(timerId); timerId = null }
    if (hideTimeout) clearTimeout(hideTimeout)
    // 1.5s 后淡出
    hideTimeout = setTimeout(() => {
      if (card && card.classList.contains('done')) {
        c.classList.add('fade-out')
        setTimeout(() => {
          // 只有在不是 running 状态下才彻底移除（防止 running 中途重入）
          if (card && !card.classList.contains('running')) {
            removeCard()
          }
        }, 400)
      }
    }, 1500)
  }

  function finishFailed(container, projectId, payload) {
    cardProjectId = projectId
    const total = Date.now() - startTime
    inFlight = false
    notifyInFlight()
    if (payload?.compressionSummaryId) lastSummaryId = payload.compressionSummaryId
    const c = ensureCard(container)
    c.classList.remove('running', 'done', 'fade-out')
    c.classList.add('failed')
    setIcon('<span class="cc-warn">!</span>')
    c.querySelector('.cc-status').textContent = (window.i18n?.t?.('auto.js_context_compression_status_121_3') ?? ((window.i18n?.t?.('auto.js_context_compression_status_121_4') ?? '上下文压缩失败，已跳过')))
    c.querySelector('.cc-meta').textContent = `用时 ${formatElapsed(total)}`
    if (timerId) { clearInterval(timerId); timerId = null }
    if (hideTimeout) clearTimeout(hideTimeout)
    // 0.8s 后淡出
    hideTimeout = setTimeout(() => {
      if (card && card.classList.contains('failed')) {
        c.classList.add('fade-out')
        setTimeout(() => {
          if (card && !card.classList.contains('running')) {
            removeCard()
          }
        }, 400)
      }
    }, 800)
  }

  function bind(options = {}) {
    if (bound) return
    bound = true
    const getContainer = options.getContainer || (() => document.getElementById('chatMessages'))
    const getActiveProjectId = options.getActiveProjectId || (() => null)
    const onSplit = typeof options.onSplit === 'function' ? options.onSplit : null

    if (window.api && typeof window.api.onContextCompression === 'function') {
      window.api.onContextCompression((data) => {
        try {
          if (!data) return
          const projectId = data.projectId
          const activeId = getActiveProjectId()
          if (!activeId || (projectId && projectId !== activeId)) return
          const container = getContainer()
          if (!container) return
          if (data.status === 'running') startRunning(container, projectId, data)
          else if (data.status === 'done') finishDone(container, projectId, data)
          else if (data.status === 'failed') finishFailed(container, projectId, data)
        } catch (err) {
          console.error('[ContextCompressionStatus] compression event error', err)
        }
      })
    }

    if (window.api && typeof window.api.onContextSplit === 'function') {
      window.api.onContextSplit((data) => {
        try {
          if (!data) return
          const activeId = getActiveProjectId()
          if (!activeId || (data.projectId && data.projectId !== activeId)) return
          if (onSplit) onSplit(data)
          // context-split 通常在 done 之后发出，状态卡已经 done 准备淡出
          // 如果是 running 中突发的 split（理论上不会），保持原状
        } catch (err) {
          console.error('[ContextCompressionStatus] split event error', err)
        }
      })
    }
  }

  function clearForProjectSwitch() {
    inFlight = false
    notifyInFlight()
    removeCard()
    cardProjectId = null
    lastSummaryId = null
  }

  // 用户发新消息前调用一次：把上一轮可能残留的卡片立即清掉
  function resetBeforeNewTurn() {
    inFlight = false
    notifyInFlight()
    removeCard()
  }

  function onInFlightChange(listener) {
    if (typeof listener !== 'function') return function () {}
    listeners.push(listener)
    return () => {
      listeners = listeners.filter(item => item !== listener)
    }
  }

  window.ContextCompressionStatus = {
    bind,
    clearForProjectSwitch,
    resetBeforeNewTurn,
    onInFlightChange,
    get isInFlight() { return inFlight }
  }
})()
