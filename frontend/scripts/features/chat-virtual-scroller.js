// 聊天历史虚拟滚动器
// 只渲染视口附近的轮次，远离视口的轮次用占位符替代
// 用户无感知地快速滚动，跳转消息时秒开
(function () {
  'use strict'

  const ESTIMATED_HEIGHT = 220
  const MIN_ESTIMATED_HEIGHT = 120
  const MAX_ESTIMATED_HEIGHT = 900
  const ROOT_MARGIN = '800px 0px 800px 0px'
  // 收紧保留窗口：长会话时更快把远处轮次卸成占位，降低 DOM 常驻成本。
  const NORMAL_KEEP_AROUND_ROUNDS = 10
  const FAST_KEEP_AROUND_ROUNDS = 16
  const FAST_SCROLL_DELTA_PX = 900
  const UNMOUNT_IDLE_DELAY = 4000
  const UNMOUNT_BATCH_SIZE = 12
  const MOUNT_BATCH_SIZE = 3
  const PLACEHOLDER_BATCH_SIZE = 80
  // 切换会话粘底时，等待底部最后几轮 mount 完成再精确贴底
  const STICKY_BOTTOM_TAIL_ROUNDS = 6
  // 首次/重置时只主动挂载少量轮次，其余交给 IntersectionObserver
  const DEFAULT_EAGER_MOUNT_ROUNDS = 12
  const MAX_HEIGHT_CACHE = 400

  // --- 内部状态 ---
  let roundsData = []
  let placeholders = []
  let heightCache = new Map()
  let observer = null
  let container = null
  let renderer = null
  let projectPath = ''
  let isDestroyed = true
  let currentKeepAroundRounds = NORMAL_KEEP_AROUND_ROUNDS
  let lastScrollTop = 0
  let anchorRoundIndex = 0
  let trimTimer = 0
  let trimRaf = 0
  let mountRaf = 0
  let mountQueue = new Set()
  let isJumping = false
  let resetGeneration = 0
  // 切换会话粘底：记录底部待 mount 轮次，全部 mount 完成后再精确粘底
  let stickyBottomGen = 0
  let stickyBottomPending = new Set()
  let stickyBottomTimers = []

  function rememberHeight(index, height) {
    heightCache.set(index, height)
    if (heightCache.size <= MAX_HEIGHT_CACHE) return
    // Map 保序：删最旧项，避免 heightCache 无限涨
    const oldest = heightCache.keys().next().value
    if (oldest !== undefined) heightCache.delete(oldest)
  }

  function isActiveFor(el) {
    return !isDestroyed && !!container && (!el || container === el)
  }

  function normalizeHistoryIndex(value) {
    if (value === null || value === undefined || value === '') return null
    const index = Number(value)
    return Number.isInteger(index) && index >= 0 ? index : null
  }

  function buildPlaceholdersInBatches(generation, priorityEnd, onComplete) {
    placeholders = new Array(roundsData.length)
    let nextIndex = 0

    function appendRange(start, end) {
      const fragment = document.createDocumentFragment()
      for (let i = start; i < end; i++) {
        const placeholder = createPlaceholder(i)
        placeholders[i] = placeholder
        fragment.appendChild(placeholder)
      }
      container.appendChild(fragment)
    }

    // 首批同步建立目标窗口之前的高度和目标窗口本身，保证首次定位正确。
    const priorityLimit = Math.min(roundsData.length, Math.max(priorityEnd, PLACEHOLDER_BATCH_SIZE))
    appendRange(0, priorityLimit)
    nextIndex = priorityLimit

    function buildNextBatch() {
      if (isDestroyed || generation !== resetGeneration || !container) return
      const end = Math.min(roundsData.length, nextIndex + PLACEHOLDER_BATCH_SIZE)
      appendRange(nextIndex, end)
      nextIndex = end
      if (nextIndex < roundsData.length) {
        requestAnimationFrame(buildNextBatch)
        return
      }
      onComplete()
    }

    if (nextIndex < roundsData.length) requestAnimationFrame(buildNextBatch)
    else onComplete()
  }

  function clearMountWork() {
    if (mountRaf) {
      cancelAnimationFrame(mountRaf)
      mountRaf = 0
    }
    mountQueue.clear()
  }

  function flushMountQueue() {
    mountRaf = 0
    if (isDestroyed) {
      mountQueue.clear()
      return
    }
    let mounted = 0
    for (const index of mountQueue) {
      mountQueue.delete(index)
      mountRound(index)
      mounted++
      if (mounted >= MOUNT_BATCH_SIZE) break
    }
    if (mountQueue.size) {
      mountRaf = requestAnimationFrame(flushMountQueue)
    }
  }

  function scheduleMount(index) {
    if (isDestroyed || index < 0 || index >= roundsData.length) return
    if (!isPlaceholder(placeholders[index])) return
    mountQueue.add(index)
    if (!mountRaf) mountRaf = requestAnimationFrame(flushMountQueue)
  }

  function clampHeight(height) {
    return Math.max(MIN_ESTIMATED_HEIGHT, Math.min(MAX_ESTIMATED_HEIGHT, height || ESTIMATED_HEIGHT))
  }

  function estimateTextHeight(text) {
    const length = String(text || '').length
    if (!length) return 0
    const softLines = Math.ceil(length / 34)
    const hardLines = String(text || '').split('\n').length
    return Math.max(softLines, hardLines) * 22
  }

  function estimateRoundHeight(roundData) {
    if (!roundData || roundData.isDivider) return 86
    const user = roundData.round?.user || {}
    const aiSteps = roundData.round?.aiSteps || []
    let height = 74 + estimateTextHeight(user.displayContent || user.content)
    if (Array.isArray(user.attachments) && user.attachments.length) {
      height += Math.min(180, user.attachments.length * 54)
    }
    for (const step of roundData.interjectSteps || []) {
      height += 58 + estimateTextHeight(step.displayContent || step.content)
    }
    if (roundData.hasAiContent) {
      let aiHeight = 92
      for (const step of aiSteps) {
        if (step.role === 'assistant') {
          aiHeight += estimateTextHeight(step.displayContent || step.content)
        } else if (step.role === 'tool') {
          aiHeight += 72
        }
      }
      height += aiHeight
    }
    return clampHeight(height)
  }

  // --- 占位符管理 ---
  function createPlaceholder(index) {
    const el = document.createElement('div')
    el.className = 'chat-virtual-placeholder'
    el.dataset.roundIndex = index
    el.style.height = (heightCache.get(index) || estimateRoundHeight(roundsData[index])) + 'px'
    el.style.overflow = 'hidden'
    return el
  }

  function isPlaceholder(el) {
    return el && el.classList && el.classList.contains('chat-virtual-placeholder')
  }

  function isWrapper(el) {
    return el && el.classList && el.classList.contains('chat-virtual-round')
  }

  // --- 挂载单轮 ---
  function mountRound(index) {
    if (index < 0 || index >= roundsData.length) return
    const placeholder = placeholders[index]
    if (!placeholder || !isPlaceholder(placeholder)) return
    if (!placeholder.parentNode) return

    const oldHeight = placeholder.offsetHeight
    const oldTop = placeholder.getBoundingClientRect().top
    const roundData = roundsData[index]
    const fragment = renderer.renderRound(roundData, projectPath)

    const wrapper = document.createElement('div')
    wrapper.className = 'chat-virtual-round'
    wrapper.dataset.roundIndex = index
    wrapper.appendChild(fragment)

    container.replaceChild(wrapper, placeholder)
    placeholders[index] = wrapper

    // 用户图片缩略图在 fragment 阶段可能未 hydrate；挂载后再补一次
    if (typeof window.hydrateLazyImagePreviews === 'function') {
      window.hydrateLazyImagePreviews(wrapper)
    }

    const newHeight = wrapper.offsetHeight
    rememberHeight(index, newHeight)

    // 滚动补偿：如果被替换元素在视口上方，高度变化会把后面的视口内容推偏。
    // 补偿高度差，保持视口内容不变。跳转模式下跳过补偿。
    if (!isJumping) {
      const heightDelta = newHeight - oldHeight
      if (heightDelta && oldTop < 0) {
        container.scrollTop += heightDelta
      }
    }

    // 通知粘底任务：底部轮次 mount 完成
    notifyStickyBottomMount(index)

    // 重新观察
    if (observer) {
      observer.unobserve(placeholder)
      observer.observe(wrapper)
    }
  }

  function clearTrimWork() {
    if (trimTimer) {
      clearTimeout(trimTimer)
      trimTimer = 0
    }
    if (trimRaf) {
      cancelAnimationFrame(trimRaf)
      trimRaf = 0
    }
  }

  // 清理粘底任务（切换会话/销毁时调用）
  function clearStickyBottom() {
    stickyBottomGen++
    stickyBottomPending.clear()
    for (const t of stickyBottomTimers) clearTimeout(t)
    stickyBottomTimers = []
  }

  // 启动粘底任务：底部最后几轮全部 mount 完成后精确粘底，避免占位符高度估算
  // 偏差导致停在最新消息之前。仅作用于本次 reset，切会话即作废，不常驻监听。
  function startStickyBottom(generation, bufferStart, bufferEnd) {
    clearStickyBottom()
    if (isDestroyed || !container) return
    stickyBottomGen = generation

    // 底部待 mount 的轮次：只统计当前仍是占位符的，已同步 mount 的视为完成
    const tailStart = Math.max(bufferStart, Math.min(bufferEnd, roundsData.length) - STICKY_BOTTOM_TAIL_ROUNDS)
    for (let i = tailStart; i < Math.min(bufferEnd, roundsData.length); i++) {
      if (i >= 0 && isPlaceholder(placeholders[i])) {
        stickyBottomPending.add(i)
      }
    }

    applyStickyBottom(generation)

    // 递减兜底：覆盖代码块/图片/Mermaid 异步渲染完导致的高度回涨。
    // 命中 generation 即停，不无限续期。
    const delays = [60, 140, 300, 600]
    for (const delay of delays) {
      const t = setTimeout(() => {
        applyStickyBottom(generation)
      }, delay)
      stickyBottomTimers.push(t)
    }
  }

  // 执行一次粘底：仅当仍属于当前 generation 时生效
  function applyStickyBottom(generation) {
    if (isDestroyed || !container) return
    if (generation !== stickyBottomGen || generation !== resetGeneration) return
    if (stickyBottomPending.size > 0) return
    container.scrollTop = container.scrollHeight
  }

  // mountRound 完成后调用：若属于粘底任务的底部轮次，标记完成并尝试粘底
  function notifyStickyBottomMount(index) {
    if (!stickyBottomPending.size) return
    if (stickyBottomPending.delete(index)) {
      if (stickyBottomPending.size === 0) {
        applyStickyBottom(stickyBottomGen)
      }
    }
  }

  function trimMountedRounds() {
    if (isDestroyed || !container) return
    trimRaf = 0
    const centerIndex = Math.max(0, Math.min(placeholders.length - 1, anchorRoundIndex))
    const keep = currentKeepAroundRounds
    let unmounted = 0
    for (let i = 0; i < placeholders.length; i++) {
      if (Math.abs(i - centerIndex) <= keep) continue
      if (isWrapper(placeholders[i])) {
        unmountRound(i)
        unmounted++
        if (unmounted >= UNMOUNT_BATCH_SIZE) break
      }
    }
    if (unmounted >= UNMOUNT_BATCH_SIZE) {
      trimRaf = requestAnimationFrame(trimMountedRounds)
    }
  }

  function scheduleTrimMountedRounds(delay = UNMOUNT_IDLE_DELAY) {
    if (isDestroyed) return
    if (trimTimer) clearTimeout(trimTimer)
    trimTimer = setTimeout(() => {
      trimTimer = 0
      currentKeepAroundRounds = NORMAL_KEEP_AROUND_ROUNDS
      if (!trimRaf) trimRaf = requestAnimationFrame(trimMountedRounds)
    }, delay)
  }

  function handleScrollForTrim() {
    if (isDestroyed || !container) return
    const top = container.scrollTop
    const delta = Math.abs(top - lastScrollTop)
    lastScrollTop = top
    currentKeepAroundRounds = delta >= FAST_SCROLL_DELTA_PX
      ? FAST_KEEP_AROUND_ROUNDS
      : NORMAL_KEEP_AROUND_ROUNDS
    scheduleTrimMountedRounds()
  }

  // --- 卸载单轮 ---
  function unmountRound(index) {
    if (index < 0 || index >= roundsData.length) return
    const wrapper = placeholders[index]
    if (!wrapper || !isWrapper(wrapper)) return
    if (!wrapper.parentNode) return

    const currentHeight = wrapper.offsetHeight
    rememberHeight(index, currentHeight)

    const placeholder = createPlaceholder(index)
    container.replaceChild(placeholder, wrapper)
    placeholders[index] = placeholder

    if (observer) {
      observer.unobserve(wrapper)
      observer.observe(placeholder)
    }
  }

  // --- IntersectionObserver 回调 ---
  function handleIntersection(entries) {
    if (isDestroyed) return
    for (const entry of entries) {
      const el = entry.target
      const index = parseInt(el.dataset.roundIndex, 10)
      if (isNaN(index)) continue

      if (entry.isIntersecting) {
        anchorRoundIndex = index
        if (isPlaceholder(el)) {
          scheduleMount(index)
        }
      }
    }
  }

  // --- 创建 Observer ---
  function createObserver() {
    if (observer) {
      observer.disconnect()
    }
    observer = new IntersectionObserver(handleIntersection, {
      root: container,
      rootMargin: ROOT_MARGIN,
      threshold: 0
    })
  }

  // --- 初始化/重置 ---
  function reset(options = {}) {
    const {
      container: chatMessages,
      renderer: chatRenderer,
      messagesHistory,
      projectPath: pPath = '',
      scrollTo,
      targetTurnId,
      targetHistoryIndex,
      startRound,
      endRound,
      preserveScroll = null,
      eagerMountRounds = DEFAULT_EAGER_MOUNT_ROUNDS,
      onReady = null
    } = options

    // 销毁旧实例
    destroy()

    container = chatMessages
    renderer = chatRenderer
    projectPath = pPath
    isDestroyed = false
    currentKeepAroundRounds = NORMAL_KEEP_AROUND_ROUNDS
    anchorRoundIndex = Math.max(0, Number(startRound) || 0)

    if (!container || !renderer) {
      if (typeof onReady === 'function') {
        try { onReady({ empty: true, reason: 'no-container-or-renderer' }) } catch (_) {}
      }
      return
    }

    // 清空容器
    container.innerHTML = ''

    // 预计算轮次
    roundsData = renderer.precomputeRounds(messagesHistory || [])

    const initialStart = Math.max(0, Number(startRound) || 0)
    const initialEnd = Math.min(roundsData.length, Number(endRound) || roundsData.length)
    // 占位符仍覆盖全量轮次（轻量），但只预挂载一小段，避免 reset 时挂满 DOM
    const eager = Math.max(4, Math.min(40, Number(eagerMountRounds) || DEFAULT_EAGER_MOUNT_ROUNDS))
    let eagerStart
    let eagerEnd
    if (scrollTo === 'bottom' || preserveScroll) {
      eagerEnd = roundsData.length
      eagerStart = Math.max(0, eagerEnd - eager)
    } else if (scrollTo === 'target') {
      // 目标轮附近稍后 jumpToTarget 会同步 mount；这里先挂底部/中部一小段作底
      eagerEnd = Math.min(roundsData.length, Math.max(initialEnd, initialStart + 1) + 2)
      eagerStart = Math.max(0, Math.min(initialStart, eagerEnd) - 2)
    } else {
      eagerStart = Math.max(0, initialStart - 2)
      eagerEnd = Math.min(roundsData.length, Math.max(initialEnd, eagerStart + eager))
    }
    const generation = ++resetGeneration
    const fireReady = (meta = {}) => {
      if (typeof onReady !== 'function') return
      if (isDestroyed || generation !== resetGeneration) return
      try { onReady({ container, generation, ...meta }) } catch (err) {
        console.warn('[ChatVirtualScroller] onReady failed:', err)
      }
    }
    // priorityEnd 用全量 length，保证占位高度链完整；真正 mount 只用 eager 窗口
    buildPlaceholdersInBatches(generation, roundsData.length, () => {
      if (isDestroyed) return
      lastScrollTop = container.scrollTop
      container.addEventListener('scroll', handleScrollForTrim, { passive: true })

      const syncMountEnd = Math.min(eagerEnd, eagerStart + MOUNT_BATCH_SIZE)
      for (let i = eagerStart; i < syncMountEnd; i++) mountRound(i)
      for (let i = syncMountEnd; i < eagerEnd; i++) scheduleMount(i)

      createObserver()
      for (const placeholder of placeholders) {
        if (placeholder) observer.observe(placeholder)
      }

      if (preserveScroll && Number.isFinite(Number(preserveScroll.top))) {
        const prevHeight = Number(preserveScroll.height) || 0
        const nextHeight = container.scrollHeight || 0
        container.scrollTop = Math.max(0, Number(preserveScroll.top) + Math.max(0, nextHeight - prevHeight))
        lastScrollTop = container.scrollTop
        anchorRoundIndex = Math.max(0, Math.min(roundsData.length - 1, eagerStart))
      } else if (scrollTo === 'bottom') {
        container.scrollTop = container.scrollHeight
        startStickyBottom(generation, eagerStart, eagerEnd)
      } else if (scrollTo === 'target' && (targetTurnId || targetHistoryIndex != null)) {
        jumpToTarget(targetTurnId, targetHistoryIndex)
      } else if (typeof startRound === 'number' && startRound > 0) {
        const targetPlaceholder = placeholders[startRound]
        if (targetPlaceholder) targetPlaceholder.scrollIntoView({ block: 'start' })
      }
      scheduleTrimMountedRounds()
      // 占位 + 首批 mount 完成后通知：运行中 AI 块应在此后挂回，避免被 innerHTML 清掉
      fireReady({ roundCount: roundsData.length, eagerStart, eagerEnd })
    })
  }

  // --- 销毁 ---
  function destroy() {
    resetGeneration++
    isDestroyed = true
    clearStickyBottom()
    if (observer) {
      observer.disconnect()
      observer = null
    }
    if (container) container.removeEventListener('scroll', handleScrollForTrim)
    clearTrimWork()
    clearMountWork()
    roundsData = []
    placeholders = []
    heightCache.clear()
    container = null
    renderer = null
    projectPath = ''
    currentKeepAroundRounds = NORMAL_KEEP_AROUND_ROUNDS
    lastScrollTop = 0
    anchorRoundIndex = 0
    isJumping = false
  }

  // --- 跳转到指定turnId ---
  function jumpToTurn(turnId) {
    jumpToTarget(turnId, null)
  }

  function jumpToTarget(turnId, historyIndex) {
    if (isDestroyed || !container) return

    // 在 roundsData 中找到对应轮次
    let targetIndex = -1
    const normalizedHistoryIndex = normalizeHistoryIndex(historyIndex)
    for (let i = 0; i < roundsData.length; i++) {
      const rd = roundsData[i]
      if (rd.isDivider) continue
      const userHistoryIndex = Number(rd?.round?.user?._historyIndex)
      if (normalizedHistoryIndex !== null && userHistoryIndex === normalizedHistoryIndex) {
        targetIndex = i
        break
      }
      if (turnId && rd.turnId === turnId) {
        targetIndex = i
        break
      }
    }

    if (targetIndex < 0) return

    // 只暂停 observer 的即时回调，目标轮次由下面同步挂载；附近轮次交给分帧队列。
    if (observer) observer.disconnect()

    // 跳转模式：mount 附近轮次时不做 scrollTop 补偿，避免互相干扰冲掉定位
    isJumping = true

    // 同步 mount 目标轮次：占位符 → 真实内容
    const targetPlaceholder = placeholders[targetIndex]
    if (targetPlaceholder && isPlaceholder(targetPlaceholder)) {
      mountRound(targetIndex)
    }

    // 精确定位到目标轮次内部的用户消息元素（不用 smooth 动画，避免和 mount 补偿竞争）
    const scrollToTarget = () => {
      const el = placeholders[targetIndex]
      if (!el || isDestroyed) return

      if (isWrapper(el)) {
        const historySelector = normalizedHistoryIndex !== null ? `[data-history-index="${normalizedHistoryIndex}"]` : ''
        const userMsgByHistory = historySelector ? el.querySelector(`.message.user${historySelector}`) : null
        const userMsg = userMsgByHistory || (turnId ? el.querySelector(`.message.user[data-turn-id="${turnId}"]`) : null)
        const aiMsg = turnId ? el.querySelector(`.message.ai[data-turn-id="${turnId}"]`) : null
        const target = userMsg || aiMsg
        if (target) {
          target.scrollIntoView({ block: 'start' })
          return
        }
      }
      el.scrollIntoView({ block: 'start' })
    }

    // 第一帧：立即定位到目标（instant，不做动画）
    scrollToTarget()

    // 恢复 observer；附近轮次由 IntersectionObserver 分帧挂载，不阻塞本次跳转。
    createObserver()
    for (const el of placeholders) {
      if (el) observer.observe(el)
    }

    // 一帧后做最终修正（处理图片加载等异步因素导致的微小偏移）
    requestAnimationFrame(() => {
      if (isDestroyed) return
      scrollToTarget()
      isJumping = false
      anchorRoundIndex = targetIndex
      scheduleTrimMountedRounds()
    })
  }

  // --- 追加新消息（流式） ---
  function appendMessage(msg) {
    if (isDestroyed || !container || !renderer) return

    // 简单追加：创建一个新轮次占位符
    const newIndex = roundsData.length
    const newRoundData = {
      isDivider: false,
      round: { user: msg, aiSteps: [] },
      interjectSteps: [],
      messageIndex: newIndex,
      turnId: newIndex + 1,
      isHiddenUser: false,
      hasAiContent: false
    }
    roundsData.push(newRoundData)

    const placeholder = createPlaceholder(newIndex)
    placeholders.push(placeholder)
    container.appendChild(placeholder)

    if (observer) {
      observer.observe(placeholder)
    }

    // 如果用户在底部，自动滚动
    if (renderer.isUserNearBottom && renderer.isUserNearBottom(container)) {
      requestAnimationFrame(() => {
        if (!isDestroyed && container) {
          container.scrollTop = container.scrollHeight
        }
      })
    }
  }

  // --- 导出 ---
  window.ChatVirtualScroller = {
    reset,
    destroy,
    jumpToTurn,
    appendMessage,
    isActive: isActiveFor,
    getRoundCount: () => roundsData.length,
    calcJumpRange: (...args) => window.ChatHistoryRanges?.calcJumpRange?.(...args),
    calcSwitchRange: (...args) => window.ChatHistoryRanges?.calcSwitchRange?.(...args),
    findHistoryIndexByTurnId: (...args) => window.ChatHistoryRanges?.findHistoryIndexByTurnId?.(...args)
  }
})()
