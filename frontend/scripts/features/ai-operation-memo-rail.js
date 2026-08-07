(function () {
  const MAX_VISIBLE_ITEMS = 80
  const WINDOW_VISIBLE_ITEMS = 28
  const VISIBILITY_KEY = 'lingxiAiMemoRailVisible'
  const state = {
    rail: null,
    list: null,
    tooltip: null,
    modal: null,
    items: [],
    loading: false,
    selectedId: '',
    refreshTimer: null,
    scrollFeedbackTimer: null,
    scrollFeedbackEdge: '',
    scrollFeedbackDir: '',
    visibleStart: 0,
    userScrolled: false,
    eventsBound: false,
    documentEventsBound: false,
    waveRaf: 0,
    lastPointerY: null
  }

  function parseVisibility(value) {
    if (value == null || value === '') return null
    if (typeof value === 'boolean') return value
    const text = String(value).trim().toLowerCase()
    if (['false', '0', 'off', 'no', 'hidden', 'hide', 'disabled'].includes(text)) return false
    if (['true', '1', 'on', 'yes', 'visible', 'show', 'enabled'].includes(text)) return true
    return null
  }

  function isVisibleEnabled() {
    try {
      const saved = parseVisibility(localStorage.getItem(VISIBILITY_KEY))
      if (saved != null) return saved
    } catch {}
    return true
  }

  function escapeHtml(value = '') {
    if (window.HtmlUtils?.escapeHtml) return window.HtmlUtils.escapeHtml(value)
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;')
  }

  function getActiveProject() {
    return window.ProjectStore?.getActiveProject?.() || null
  }

  function getActiveProjectPath() {
    return getActiveProject()?.path || ''
  }

  function formatDate(value = '') {
    if (!value) return ''
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) return String(value)
    const pad = n => String(n).padStart(2, '0')
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
  }

  function getSummary(item = {}) {
    return item.modelSummary || item.summary || ''
  }

  function getStatsText(item = {}) {
    const stats = item.stats || {}
    const modified = Number(stats.modified || 0)
    const created = Number(stats.created || 0)
    const deleted = Number(stats.deleted || 0)
    const parts = []
    if (modified) parts.push(`改 ${modified}`)
    if (created) parts.push(`增 ${created}`)
    if (deleted) parts.push(`删 ${deleted}`)
    return parts.join(' · ') || '无文件统计'
  }

  function ensureDom() {
    // 热更新：旧轨迹条缺少方向箭头时补上
    if (state.rail && state.list && !state.rail.querySelector('.ai-memo-chat-rail-arrow')) {
      const topArrow = document.createElement('div')
      topArrow.className = 'ai-memo-chat-rail-arrow is-top'
      topArrow.setAttribute('aria-hidden', 'true')
      topArrow.innerHTML = '<svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7.5 6 4.5 9 7.5"/></svg>'
      const bottomArrow = document.createElement('div')
      bottomArrow.className = 'ai-memo-chat-rail-arrow is-bottom'
      bottomArrow.setAttribute('aria-hidden', 'true')
      bottomArrow.innerHTML = '<svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 4.5 6 7.5 9 4.5"/></svg>'
      state.rail.insertBefore(topArrow, state.list)
      state.rail.insertBefore(bottomArrow, state.list)
    }
    if (state.rail && state.list && state.tooltip && state.modal) return true
    const center = document.getElementById('center')
    const chatMessages = document.getElementById('chatMessages')
    if (!center || !chatMessages) return false

    const rail = document.createElement('div')
    rail.className = 'ai-memo-chat-rail'
    rail.id = 'aiMemoChatRail'
    rail.setAttribute('aria-label', 'AI 操作备忘录轨迹')
    rail.innerHTML = [
      '<div class="ai-memo-chat-rail-line"></div>',
      // 滚轮方向箭头：上=更早，下=更新
      '<div class="ai-memo-chat-rail-arrow is-top" aria-hidden="true">',
      '<svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7.5 6 4.5 9 7.5"/></svg>',
      '</div>',
      '<div class="ai-memo-chat-rail-arrow is-bottom" aria-hidden="true">',
      '<svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 4.5 6 7.5 9 4.5"/></svg>',
      '</div>',
      '<div class="ai-memo-chat-rail-list"></div>'
    ].join('')
    center.insertBefore(rail, chatMessages)

    let tooltip = document.querySelector('.ai-memo-chat-tooltip')
    if (!tooltip) {
      tooltip = document.createElement('div')
      tooltip.className = 'ai-memo-chat-tooltip'
      tooltip.setAttribute('role', 'tooltip')
      document.body.appendChild(tooltip)
    }

    let modal = document.getElementById('aiMemoChatModal')
    if (!modal) {
      modal = document.createElement('div')
      modal.className = 'ai-memo-chat-modal hidden'
      modal.id = 'aiMemoChatModal'
      modal.setAttribute('aria-hidden', 'true')
      modal.innerHTML = `
      <div class="ai-memo-chat-modal-backdrop" data-action="close"></div>
      <section class="ai-memo-chat-modal-panel" role="dialog" aria-modal="true" aria-labelledby="aiMemoChatModalTitle">
        <header class="ai-memo-chat-modal-header">
          <div>
            <div class="ai-memo-chat-modal-kicker">AI 操作备忘录</div>
            <h2 id="aiMemoChatModalTitle">AI 操作备忘录</h2>
            <div class="ai-memo-chat-modal-meta" id="aiMemoChatModalMeta"></div>
          </div>
          <button type="button" class="ai-memo-chat-modal-close" data-action="close" aria-label="关闭">×</button>
        </header>
        <div class="ai-memo-chat-modal-summary" id="aiMemoChatModalSummary"></div>
        <pre class="ai-memo-chat-modal-content" id="aiMemoChatModalContent"></pre>
      </section>
    `
      document.body.appendChild(modal)

      modal.addEventListener('click', event => {
        const action = event.target?.dataset?.action
        if (action === 'close') closeModal()
      })
    }

    if (!state.documentEventsBound) {
      state.documentEventsBound = true
      document.addEventListener('keydown', event => {
        if (event.key === 'Escape' && !state.modal?.classList.contains('hidden')) closeModal()
      })
    }

    rail.addEventListener('wheel', handleRailWheel, { passive: false })
    // 鼠标滑动（非滚轮）触发海浪起伏
    rail.addEventListener('pointermove', handleRailPointerMove)
    rail.addEventListener('pointerleave', handleRailPointerLeave)
    rail.addEventListener('pointercancel', handleRailPointerLeave)

    state.rail = rail
    state.list = rail.querySelector('.ai-memo-chat-rail-list')
    state.tooltip = tooltip
    state.modal = modal
    return true
  }

  function setRailVisible(visible) {
    if (!state.rail) return
    state.rail.classList.toggle('is-empty', !visible)
  }

  function removeRail() {
    hideTooltip()
    if (state.modal) {
      state.modal.classList.add('hidden')
      state.modal.setAttribute('aria-hidden', 'true')
    }
    state.selectedId = ''
    if (state.rail) {
      state.rail.remove()
      state.rail = null
      state.list = null
    }
    window.clearTimeout(state.refreshTimer)
    state.refreshTimer = null
    state.items = []
  }

  function normalizeItems(items = []) {
    return (Array.isArray(items) ? items : [])
      .filter(item => item && item.id)
      .sort((a, b) => String(a.savedAt || a.createdAt || '').localeCompare(String(b.savedAt || b.createdAt || '')))
      .slice(-MAX_VISIBLE_ITEMS)
  }

  function getVisibleCount(total = 0) {
    return Math.min(WINDOW_VISIBLE_ITEMS, Math.max(1, total))
  }

  function getMaxVisibleStart(total = 0) {
    return Math.max(0, total - getVisibleCount(total))
  }

  function clampVisibleStart(total = state.items.length) {
    const maxStart = getMaxVisibleStart(total)
    if (!state.userScrolled) {
      state.visibleStart = maxStart
      return
    }
    state.visibleStart = Math.max(0, Math.min(state.visibleStart, maxStart))
  }

  function getWindowItems(items = []) {
    const total = items.length
    const visibleCount = getVisibleCount(total)
    clampVisibleStart(total)
    return items.slice(state.visibleStart, state.visibleStart + visibleCount)
  }

  function updateScrollState(total = state.items.length) {
    if (!state.rail) return
    const visibleCount = getVisibleCount(total)
    const scrollable = total > visibleCount
    const canScrollOlder = scrollable && state.visibleStart > 0
    const canScrollNewer = scrollable && state.visibleStart < getMaxVisibleStart(total)
    state.rail.classList.toggle('is-scrollable', scrollable)
    state.rail.classList.toggle('can-scroll-older', canScrollOlder)
    state.rail.classList.toggle('can-scroll-newer', canScrollNewer)
    if (scrollable) {
      state.rail.setAttribute('aria-description', '滚轮查看更早或更新的 AI 操作备忘录')
    } else {
      state.rail.removeAttribute('aria-description')
    }
  }

  // direction: 1=滚轮向下看更新；-1=滚轮向上看更早
  function pulseScrollFeedback(direction, blocked = false) {
    if (!state.rail || !state.list || !direction) return
    const dirClass = direction > 0 ? 'is-scroll-dir-newer' : 'is-scroll-dir-older'
    state.scrollFeedbackDir = direction > 0 ? 'newer' : 'older'
    state.scrollFeedbackEdge = direction > 0 ? 'bottom' : 'top'

    state.rail.classList.remove('is-scroll-dir-older', 'is-scroll-dir-newer', 'is-scroll-blocked')
    // 强制重启动画
    void state.rail.offsetWidth
    state.rail.classList.add(dirClass)
    state.rail.classList.toggle('is-scroll-blocked', Boolean(blocked))

    // 内容随滚动方向轻位移：向下滚内容上移，向上滚内容下移
    const nudge = direction > 0 ? -7 : 7
    state.list.style.setProperty('--scroll-nudge', `${nudge}px`)
    state.list.classList.remove('is-scroll-nudging')
    void state.list.offsetWidth
    state.list.classList.add('is-scroll-nudging')

    clearTimeout(state.scrollFeedbackTimer)
    state.scrollFeedbackTimer = setTimeout(() => {
      state.scrollFeedbackEdge = ''
      state.scrollFeedbackDir = ''
      if (state.rail) {
        state.rail.classList.remove('is-scroll-dir-older', 'is-scroll-dir-newer', 'is-scroll-blocked')
      }
      if (state.list) {
        state.list.classList.remove('is-scroll-nudging')
        state.list.style.removeProperty('--scroll-nudge')
      }
      render()
    }, 420)
  }

  function handleRailWheel(event) {
    const items = normalizeItems(state.items)
    const maxStart = getMaxVisibleStart(items.length)
    if (!maxStart) return

    event.preventDefault()
    const direction = Math.sign(event.deltaY || event.deltaX || 0)
    if (!direction) return

    state.userScrolled = true
    const step = event.shiftKey ? 5 : 3
    const nextStart = Math.max(0, Math.min(state.visibleStart + (direction * step), maxStart))
    const blocked = nextStart === state.visibleStart

    hideTooltip()
    clearWave()

    if (!blocked) state.visibleStart = nextStart
    // 即使到顶/到底也给方向反馈；blocked 时箭头变灰
    pulseScrollFeedback(direction, blocked)
    render()
  }

  function clearWave() {
    if (state.waveRaf) {
      cancelAnimationFrame(state.waveRaf)
      state.waveRaf = 0
    }
    state.lastPointerY = null
    if (!state.list) return
    state.list.classList.remove('is-wave-active')
    state.list.querySelectorAll('.ai-memo-chat-node').forEach(node => {
      node.classList.remove('is-wave-focus', 'is-wave-preview')
      node.style.removeProperty('--wave-width')
      node.style.removeProperty('--wave-height')
      node.style.removeProperty('--wave-strength')
      node.style.removeProperty('--wave-shift')
    })
  }

  function applyWaveAt(pointerY) {
    if (!state.list) return
    const nodes = Array.from(state.list.querySelectorAll('.ai-memo-chat-node'))
    if (!nodes.length) return

    state.list.classList.add('is-wave-active')
    // 海浪半径：邻近鼓起；真正预览的那根单独更粗更凸
    const radius = 88
    let closestNode = null
    let closestDist = Infinity

    const metrics = nodes.map(node => {
      const rect = node.getBoundingClientRect()
      const centerY = rect.top + rect.height / 2
      const dist = Math.abs(pointerY - centerY)
      if (dist < closestDist) {
        closestDist = dist
        closestNode = node
      }
      return { node, dist }
    })

    metrics.forEach(({ node, dist }) => {
      const isPreview = node === closestNode
      const t = Math.max(0, 1 - dist / radius)
      // smoothstep + 轻微二次波峰，形成起伏感
      const ease = t * t * (3 - 2 * t)
      let wave = ease * (0.55 + 0.45 * Math.sin(ease * Math.PI))
      let width = 10 + wave * 14
      let height = 1.6 + wave * 2.2
      let shift = wave * 2.8

      // 当前预览标题对应的那根：加粗并更凸出，一眼能认
      if (isPreview) {
        wave = Math.max(wave, 1)
        width = Math.max(width, 30)
        height = Math.max(height, 4.4)
        shift = Math.max(shift, 9)
      }

      node.style.setProperty('--wave-width', `${width.toFixed(2)}px`)
      node.style.setProperty('--wave-height', `${height.toFixed(2)}px`)
      node.style.setProperty('--wave-strength', wave.toFixed(3))
      node.style.setProperty('--wave-shift', `${shift.toFixed(2)}px`)
      node.classList.toggle('is-wave-focus', isPreview)
      node.classList.toggle('is-wave-preview', isPreview)
    })

    // 预览标题与最近那根刻度同步，避免海浪都差不多时对不上
    if (closestNode) {
      showTooltip(closestNode, { title: closestNode.dataset.memoTitle || closestNode.getAttribute('aria-label') || 'AI 操作备忘录' })
    }
  }

  function handleRailPointerMove(event) {
    if (!state.list || !state.rail || state.rail.classList.contains('is-empty')) return
    state.lastPointerY = event.clientY
    if (state.waveRaf) return
    state.waveRaf = requestAnimationFrame(() => {
      state.waveRaf = 0
      if (state.lastPointerY == null) return
      applyWaveAt(state.lastPointerY)
    })
  }

  function handleRailPointerLeave() {
    clearWave()
    hideTooltip()
  }

  function buildNode(item, index, total) {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'ai-memo-chat-node'
    button.dataset.memoId = item.id
    button.dataset.memoTitle = item.title || 'AI 操作备忘录'
    button.setAttribute('aria-label', item.title || 'AI 操作备忘录')
    button.title = item.title || 'AI 操作备忘录'

    const minTop = 12
    const maxTop = 88
    const top = total <= 1 ? 50 : minTop + ((maxTop - minTop) * index / (total - 1))
    button.style.top = `${top}%`

    if (item.status === 'draft') button.classList.add('is-draft')
    if (item.id === state.selectedId) button.classList.add('is-active')
    if (state.scrollFeedbackEdge === 'top' && index === 0) button.classList.add('is-scroll-feedback')
    if (state.scrollFeedbackEdge === 'bottom' && index === total - 1) button.classList.add('is-scroll-feedback')

    // 预览标题主要由滑动时最近刻度驱动；单点进入时也显示
    button.addEventListener('mouseenter', () => {
      if (!state.list?.classList.contains('is-wave-active')) showTooltip(button, item)
    })
    button.addEventListener('focus', () => showTooltip(button, item))
    button.addEventListener('blur', hideTooltip)
    button.addEventListener('click', () => openMemo(item.id))
    return button
  }

  function render() {
    if (!isVisibleEnabled()) {
      removeRail()
      return
    }
    if (!ensureDom()) return
    state.list.innerHTML = ''
    const items = normalizeItems(state.items)
    const windowItems = getWindowItems(items)
    setRailVisible(items.length > 0)
    state.rail.classList.toggle('is-loading', state.loading)
    updateScrollState(items.length)
    windowItems.forEach((item, index) => state.list.appendChild(buildNode(item, index, windowItems.length)))
  }

  function showTooltip(node, item = {}) {
    if (!state.tooltip) return
    state.tooltip.textContent = item.title || 'AI 操作备忘录'
    state.tooltip.classList.add('show')
    const rect = node.getBoundingClientRect()
    state.tooltip.style.left = `${rect.right + 8}px`
    state.tooltip.style.top = `${rect.top + rect.height / 2}px`
  }

  function hideTooltip() {
    if (!state.tooltip) return
    state.tooltip.classList.remove('show')
  }

  function setModalLoading(item = {}) {
    if (!state.modal) return
    state.modal.querySelector('#aiMemoChatModalTitle').textContent = item.title || 'AI 操作备忘录'
    state.modal.querySelector('#aiMemoChatModalMeta').textContent = [formatDate(item.savedAt || item.createdAt), getStatsText(item)].filter(Boolean).join(' · ')
    state.modal.querySelector('#aiMemoChatModalSummary').textContent = getSummary(item)
    state.modal.querySelector('#aiMemoChatModalContent').textContent = '正在读取备忘录内容...'
  }

  function openModal(item = {}, content = '') {
    if (!ensureDom()) return
    state.selectedId = item.id || ''
    state.modal.querySelector('#aiMemoChatModalTitle').textContent = item.title || 'AI 操作备忘录'
    state.modal.querySelector('#aiMemoChatModalMeta').textContent = [formatDate(item.savedAt || item.createdAt), getStatsText(item)].filter(Boolean).join(' · ')
    state.modal.querySelector('#aiMemoChatModalSummary').textContent = getSummary(item)
    state.modal.querySelector('#aiMemoChatModalContent').textContent = content || '这条备忘录没有可显示的内容。'
    state.modal.classList.remove('hidden')
    state.modal.setAttribute('aria-hidden', 'false')
    render()
  }

  function closeModal() {
    if (!state.modal) return
    state.modal.classList.add('hidden')
    state.modal.setAttribute('aria-hidden', 'true')
    state.selectedId = ''
    render()
  }

  async function openMemo(memoId = '') {
    const projectPath = getActiveProjectPath()
    const item = state.items.find(entry => entry.id === memoId) || {}
    if (!projectPath || !memoId) return
    hideTooltip()
    if (!ensureDom()) return
    state.selectedId = memoId
    state.modal.classList.remove('hidden')
    state.modal.setAttribute('aria-hidden', 'false')
    setModalLoading(item)
    render()

    try {
      const result = await window.api?.readAiOperationMemo?.(projectPath, memoId)
      if (!result?.success) {
        if (result?.error === '备忘录文件不存在') {
          state.items = state.items.filter(entry => entry.id !== memoId)
          render()
          scheduleRefresh(0)
        }
        state.modal.querySelector('#aiMemoChatModalContent').textContent = result?.error || '备忘录读取失败。'
        return
      }
      openModal(result.item || item, result.content || '')
    } catch (error) {
      state.modal.querySelector('#aiMemoChatModalContent').textContent = error?.message || '备忘录读取失败。'
    }
  }

  async function refresh() {
    if (state.loading) return
    if (!isVisibleEnabled()) {
      removeRail()
      return
    }
    const projectPath = getActiveProjectPath()
    if (!ensureDom()) return
    if (!projectPath || !window.api?.listAiOperationMemoTimeline) {
      state.items = []
      render()
      return
    }

    state.loading = true
    render()
    try {
      const result = await window.api.listAiOperationMemoTimeline(projectPath)
      const nextItems = result?.success ? normalizeItems(result.items || []) : []
      const previousNewestId = state.items[state.items.length - 1]?.id || ''
      const nextNewestId = nextItems[nextItems.length - 1]?.id || ''
      state.items = nextItems
      if (!state.userScrolled || previousNewestId !== nextNewestId) {
        state.userScrolled = false
        state.visibleStart = getMaxVisibleStart(state.items.length)
      } else {
        clampVisibleStart(state.items.length)
      }
    } catch (error) {
      state.items = []
      console.warn('[AiMemoChatRail] load failed:', error)
    } finally {
      state.loading = false
      render()
    }
  }

  function scheduleRefresh(delay = 120) {
    if (!isVisibleEnabled()) {
      removeRail()
      return
    }
    window.clearTimeout(state.refreshTimer)
    state.refreshTimer = window.setTimeout(refresh, delay)
  }

  function bindEvents() {
    if (state.eventsBound) return
    state.eventsBound = true
    window.addEventListener('lingxi:active-project-changed', () => scheduleRefresh(80))
    window.addEventListener('focus', () => scheduleRefresh(200))
  }

  function init() {
    if (!isVisibleEnabled()) return
    if (!ensureDom()) return
    bindEvents()
    scheduleRefresh(200)
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true })
  } else {
    init()
  }

  window.AiMemoChatRail = {
    refresh,
    openMemo,
    closeModal,
    isVisible: isVisibleEnabled,
    setVisible: enabled => {
      try {
        localStorage.setItem(VISIBILITY_KEY, enabled ? 'true' : 'false')
      } catch {}
      if (enabled) {
        if (!ensureDom()) return
        bindEvents()
        scheduleRefresh(0)
      } else {
        removeRail()
      }
    }
  }
})()
