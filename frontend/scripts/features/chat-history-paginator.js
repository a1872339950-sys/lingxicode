(function () {
  'use strict'

  const MAX_CACHED_PAGES = 6
  const EDGE_LOAD_PX = 96

  let generation = 0
  let state = null

  function pageKey(range = {}) {
    return `${range.startIndex ?? 0}:${range.endIndex ?? 0}`
  }

  function uniqueMessages(pages) {
    const seen = new Set()
    const messages = []
    for (const page of pages) {
      for (const message of page.messages || []) {
        const key = message?.messageId || `${message?.role || ''}:${message?.time || ''}:${messages.length}`
        if (seen.has(key)) continue
        seen.add(key)
        messages.push(message)
      }
    }
    return messages
  }

  function createIndicator(position) {
    const indicator = document.createElement('div')
    indicator.className = 'chat-history-paginator-indicator'
    indicator.dataset.position = position
    indicator.setAttribute('aria-hidden', 'true')
    indicator.style.height = '1px'
    indicator.style.pointerEvents = 'none'
    return indicator
  }

  function installIndicators(current) {
    if (!current?.container) return
    current.container.querySelector?.('.chat-history-paginator-indicator[data-position="top"]')?.remove?.()
    current.container.querySelector?.('.chat-history-paginator-indicator[data-position="bottom"]')?.remove?.()
    if (current.hasOlder) {
      const top = createIndicator('top')
      current.container.insertBefore(top, current.container.firstChild)
    }
    if (current.hasNewer) current.container.appendChild(createIndicator('bottom'))
  }

  function renderWithVirtualScroller(current, options = {}) {
    const scroller = window.ChatVirtualScroller
    if (!scroller?.reset || !current.container || !current.renderer) return false

    const previousHeight = current.container.scrollHeight || 0
    const previousTop = current.container.scrollTop || 0
    const preserveScroll = (options.prepended || options.appended) && !options.scrollToBottom
      ? { top: previousTop, height: previousHeight }
      : null

    let afterRenderFired = false
    const fireAfterRender = (meta = {}) => {
      if (afterRenderFired) return
      afterRenderFired = true
      if (typeof current.afterRender === 'function') {
        try {
          current.afterRender({
            container: current.container,
            state: current,
            virtual: true,
            ready: true,
            ...meta
          })
        } catch (err) {
          console.warn('[ChatHistoryPaginator] afterRender failed:', err)
        }
      }
    }

    scroller.reset({
      container: current.container,
      renderer: current.renderer,
      messagesHistory: current.messagesHistory,
      projectPath: current.projectPath,
      scrollTo: options.scrollToBottom ? 'bottom' : undefined,
      preserveScroll,
      eagerMountRounds: 14,
      // 等占位/首批 mount 完成后再 afterRender，避免运行中 AI 块被二次清空
      onReady: (meta) => fireAfterRender(meta || {})
    })
    current.domSeeded = true
    current.useVirtual = true
    // 兜底：仅当 onReady 长时间未触发时再回调（不能用 rAF，会抢在占位构建前开火）
    setTimeout(() => {
      if (!afterRenderFired) fireAfterRender({ fallback: true, delayed: true })
    }, 480)
    return true
  }

  function render(current, options = {}) {
    if (!current || current.generation !== generation || !current.container || !current.renderer) return
    const previousHeight = current.container.scrollHeight || 0
    const previousTop = current.container.scrollTop || 0
    current.pages.sort((a, b) => a.range.startIndex - b.range.startIndex)
    current.messagesHistory = uniqueMessages(current.pages)

    // 优先走虚拟滚动：只挂载视口附近轮次，分页只负责内存里的 pages
    if (renderWithVirtualScroller(current, options)) {
      return
    }

    const page = options.page
    const canIncremental = current.domSeeded
      && page
      && Array.isArray(page.messages)
      && page.messages.length > 0
      && !options.evicted
      && !options.forceReplace

    if (canIncremental && options.prepended) {
      current.renderer.restoreChatHistory(page.messages, {
        projectPath: current.projectPath,
        source: 'prepend',
        start: 0,
        end: page.messages.length
      })
    } else if (canIncremental && options.appended) {
      current.renderer.restoreChatHistory(page.messages, {
        projectPath: current.projectPath,
        source: 'append',
        start: 0,
        end: page.messages.length
      })
    } else {
      current.renderer.restoreChatHistory(current.messagesHistory, {
        projectPath: current.projectPath,
        source: 'replace',
        start: 0,
        end: current.messagesHistory.length
      })
      current.domSeeded = true
    }

    installIndicators(current)
    if (options.prepended) {
      const nextHeight = current.container.scrollHeight || previousHeight
      current.container.scrollTop = previousTop + Math.max(0, nextHeight - previousHeight)
    } else if (options.scrollToBottom) {
      current.container.scrollTop = current.container.scrollHeight || 0
    }
    if (typeof current.afterRender === 'function') {
      current.afterRender({ container: current.container, state: current })
    }
  }

  function evictFarPages(current, direction) {
    let removed = 0
    while (current.pages.length > MAX_CACHED_PAGES) {
      current.pages.sort((a, b) => a.range.startIndex - b.range.startIndex)
      if (direction === 'older') {
        const page = current.pages.pop()
        current.hasNewer = true
        current.newerCursor = page.range.startIndex
        removed += 1
      } else {
        const page = current.pages.shift()
        current.hasOlder = true
        current.olderCursor = page.range.endIndex
        removed += 1
      }
    }
    return removed > 0
  }

  async function requestPage(current, direction) {
    if (!current || current.loading || current.generation !== generation || !current.projectId) return
    const isOlder = direction === 'older'
    if (isOlder ? !current.hasOlder : !current.hasNewer) return
    const cursor = isOlder ? current.olderCursor : current.newerCursor
    current.loading = true
    try {
      const loader = current.loadPage || ((projectId, pageOptions) => window.api?.getChatHistoryPage?.(projectId, pageOptions))
      const result = await loader(current.projectId, {
        cursor,
        direction,
        pageChunks: 1,
        includeMetadata: false
      })
      if (current.generation !== generation || !result?.success || !result.range) return
      const page = { range: result.range, messages: result.messages || [] }
      const already = current.pages.some(item => pageKey(item.range) === pageKey(page.range))
      if (!already) current.pages.push(page)
      if (isOlder) {
        current.hasOlder = !!result.hasMore
        current.olderCursor = result.nextCursor
      } else {
        current.hasNewer = !!result.hasMore
        current.newerCursor = result.nextCursor
      }
      const pageCountBeforeEvict = current.pages.length
      const evicted = evictFarPages(current, direction)
      // 发生淘汰时 DOM 与 pages 不再一一对应，退回全量 replace
      const forceReplace = evicted || current.pages.length < pageCountBeforeEvict
      if (already) {
        // 重复页不重绘
      } else {
        render(current, {
          prepended: isOlder,
          appended: !isOlder,
          page,
          evicted: forceReplace
        })
      }
    } catch (error) {
      console.warn('[ChatHistoryPaginator] page load failed:', error?.message || error)
    } finally {
      if (current.generation === generation) current.loading = false
    }
  }

  function onScroll() {
    const current = state
    if (!current?.container || current.loading) return
    if (current.container.scrollTop <= EDGE_LOAD_PX && current.hasOlder) {
      requestPage(current, 'older')
      return
    }
    const distanceToBottom = current.container.scrollHeight - current.container.scrollTop - current.container.clientHeight
    if (distanceToBottom <= EDGE_LOAD_PX && current.hasNewer) requestPage(current, 'newer')
  }

  function detach() {
    if (state?.container) state.container.removeEventListener?.('scroll', onScroll)
    state = null
  }

  function reset(options = {}) {
    detach()
    const currentGeneration = ++generation
    const {
      container,
      renderer,
      messagesHistory = [],
      projectId = '',
      projectPath = '',
      range = null,
      nextCursor = null,
      hasMore = false,
      loadPage = null,
      afterRender = null,
      scrollTo = ''
    } = options
    const normalizedRange = range || {
      startIndex: 0,
      endIndex: 0,
      totalChunks: messagesHistory.length ? 1 : 0
    }
    state = {
      generation: currentGeneration,
      container,
      renderer,
      projectId,
      projectPath,
      pages: [{ range: normalizedRange, messages: messagesHistory }],
      messagesHistory,
      olderCursor: nextCursor,
      newerCursor: null,
      hasOlder: !!hasMore,
      hasNewer: false,
      loading: false,
      loadPage,
      afterRender,
      domSeeded: false
    }
    container?.addEventListener?.('scroll', onScroll, { passive: true })
    requestAnimationFrame(() => {
      if (!state || state.generation !== currentGeneration || currentGeneration !== generation) return
      render(state, { scrollToBottom: scrollTo === 'bottom', forceReplace: true })
    })
    return state
  }

  function destroy() {
    generation++
    detach()
  }

  window.ChatHistoryPaginator = {
    destroy,
    getState: () => state,
    loadOlder: () => requestPage(state, 'older'),
    loadNewer: () => requestPage(state, 'newer'),
    reset
  }
})()
