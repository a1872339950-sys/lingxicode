(function () {
  const queue = []
  let activeItem = null
  let hideTimer = null
  let activeVisual = null
  let deps = {}
  let positionBound = false
  let positionRaf = 0

  function escapeHtml(value = '') {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;')
  }

  function buildLogoSvg() {
    return [
      '<img class="agent-collab-handoff-logo" src="assets/brand/lingxi-logo-transparent.png" alt="灵犀 LingXiCode">'
    ].join('')
  }

  function getActiveProjectId() {
    return deps.getActiveProjectId?.() || window.ProjectStore?.getActiveProjectId?.() || ''
  }

  function isVisibleAnchor(el) {
    if (!el || el.hidden) return false
    const style = window.getComputedStyle?.(el)
    if (style && (style.display === 'none' || style.visibility === 'hidden')) return false
    const rect = el.getBoundingClientRect()
    return rect.width > 0 && rect.height > 0
  }

  // 询问条 bottom 贴在缓存预估条上方，避免和 cache-usage-strip 重叠
  function resolveHandoffBottomPx() {
    const gap = 8
    const minBottom = 96
    const candidates = [
      document.getElementById('cacheUsageStrip'),
      document.getElementById('planProgressDock'),
      document.querySelector('.chat-input-area')
    ]
    for (const el of candidates) {
      if (!isVisibleAnchor(el)) continue
      const top = el.getBoundingClientRect().top
      // bottom = 视口底到锚点顶的距离 + 小间距，使 handoff 紧贴锚点上方
      return Math.max(minBottom, Math.round(window.innerHeight - top + gap))
    }
    return 132
  }

  function positionPrompt(prompt) {
    const target = prompt || document.getElementById('lingxiHandoffConfirmationPrompt')
    if (!target || !target.classList.contains('show')) return
    const bottomPx = resolveHandoffBottomPx()
    target.style.setProperty('--handoff-bottom', `${bottomPx}px`)
    target.style.bottom = `${bottomPx}px`
  }

  function schedulePositionPrompt() {
    if (positionRaf) cancelAnimationFrame(positionRaf)
    positionRaf = requestAnimationFrame(() => {
      positionRaf = 0
      positionPrompt()
    })
  }

  function bindPositionListeners() {
    if (positionBound) return
    positionBound = true
    window.addEventListener('resize', schedulePositionPrompt)
    window.addEventListener('scroll', schedulePositionPrompt, true)
    // 缓存条内容变化时也重算位置
    const strip = document.getElementById('cacheUsageStrip')
    if (strip && typeof MutationObserver !== 'undefined') {
      const observer = new MutationObserver(schedulePositionPrompt)
      observer.observe(strip, { attributes: true, childList: true, characterData: true, subtree: true })
    }
  }

  function ensurePrompt() {
    let prompt = document.getElementById('lingxiHandoffConfirmationPrompt')
    if (prompt) return prompt
    prompt = document.createElement('div')
    prompt.id = 'lingxiHandoffConfirmationPrompt'
    prompt.className = 'agent-collab-handoff handoff-confirmation-queue'
    document.body.appendChild(prompt)
    bindPositionListeners()
    return prompt
  }

  function hidePrompt(callback) {
    const prompt = document.getElementById('lingxiHandoffConfirmationPrompt')
    if (!prompt) {
      callback?.()
      return
    }
    if (hideTimer) clearTimeout(hideTimer)
    prompt.classList.add('closing')
    hideTimer = setTimeout(() => {
      hideTimer = null
      prompt.classList.remove('show', 'closing')
      prompt.innerHTML = ''
      activeVisual?.destroy?.()
      activeVisual = null
      callback?.()
    }, 420)
  }

  function canShow(item = {}) {
    return !item.projectId || item.projectId === getActiveProjectId()
  }

  function nextDisplayableIndex() {
    const activeProjectId = getActiveProjectId()
    const exactIndex = queue.findIndex(item => item.projectId && item.projectId === activeProjectId)
    if (exactIndex >= 0) return exactIndex
    return queue.findIndex(item => !item.projectId)
  }

  function completeActive() {
    activeItem = null
    hidePrompt(pump)
  }

  async function runAction(action, item) {
    if (!action || !activeItem) return
    const safeActionId = window.CSS?.escape ? CSS.escape(action.id) : String(action.id || '').replace(/"/g, '\\"')
    const button = document.querySelector(`[data-handoff-action="${safeActionId}"]`)
    if (button) button.disabled = true
    activeVisual?.setState?.(action.visualState || (action.kind === 'primary' ? 'save' : 'dismiss'))
    try {
      const result = await action.handler?.(item)
      if (result === false) {
        activeVisual?.setState?.('error')
        if (button) button.disabled = false
        return
      }
      completeActive()
    } catch (error) {
      activeVisual?.setState?.('error')
      if (button) button.disabled = false
      const message = error?.message || String(error || '')
      if (deps.showToast) deps.showToast(message || '操作失败', 'error')
      else if (window.showToast) window.showToast(message || '操作失败', 'error')
    }
  }

  function render(item) {
    if (hideTimer) { clearTimeout(hideTimer); hideTimer = null }
    const prompt = ensurePrompt()
    prompt.classList.remove('closing')
    const actions = Array.isArray(item.actions) ? item.actions : []
    prompt.className = `agent-collab-handoff handoff-confirmation-queue ${item.className || ''}`.trim()
    prompt.innerHTML = `
      <div class="agent-collab-handoff-panel">
        <div class="agent-collab-handoff-text">
          <span class="handoff-confirmation-title">${escapeHtml(item.title || '需要确认')}</span>
          ${item.meta ? `<span class="handoff-confirmation-meta">${escapeHtml(item.meta)}</span>` : ''}
          ${item.bodyHtml ? `<div class="handoff-confirmation-body">${item.bodyHtml}</div>` : ''}
        </div>
        <div class="agent-collab-handoff-actions">
          ${actions.map(action => `<button type="button" data-handoff-action="${escapeHtml(action.id)}" data-action-kind="${escapeHtml(action.kind || '')}">${escapeHtml(action.label || '确定')}</button>`).join('')}
        </div>
      </div>
      <div class="agent-collab-handoff-light" aria-hidden="true"></div>
      <div class="agent-collab-handoff-orb" aria-hidden="true">${item.visual === 'memo-logo' ? '<div class="memo-logo-scene"></div>' : buildLogoSvg()}</div>
    `
    activeVisual?.destroy?.()
    activeVisual = null
    if (item.visual === 'memo-logo') {
      window.MemoLogoScene?.mount(prompt.querySelector('.memo-logo-scene')).then(scene => {
        if (activeItem === item) activeVisual = scene
        else scene?.destroy?.()
      })
    }
    requestAnimationFrame(() => {
      prompt.classList.add('show')
      positionPrompt(prompt)
      // 下一帧再算一次，等缓存条布局稳定
      requestAnimationFrame(() => positionPrompt(prompt))
    })
    actions.forEach(action => {
      const safeActionId = window.CSS?.escape ? CSS.escape(action.id) : String(action.id || '').replace(/"/g, '\\"')
      prompt.querySelector(`[data-handoff-action="${safeActionId}"]`)?.addEventListener('click', event => {
        event.preventDefault()
        event.stopPropagation()
        runAction(action, item)
      })
    })
  }

  function pump() {
    if (activeItem) {
      if (canShow(activeItem)) return
      queue.unshift(activeItem)
      activeItem = null
      hidePrompt(pump)
      return
    }
    const index = nextDisplayableIndex()
    if (index < 0) return
    activeItem = queue.splice(index, 1)[0]
    render(activeItem)
  }

  function enqueue(item = {}) {
    if (!item.id) item.id = `handoff-${Date.now()}-${Math.random().toString(16).slice(2)}`
    const duplicate = activeItem?.id === item.id || queue.some(existing => existing.id === item.id)
    if (duplicate) return item.id
    queue.push(item)
    pump()
    return item.id
  }

  function bind(nextDeps = {}) {
    deps = nextDeps || {}
    window.addEventListener('lingxi:active-project-changed', pump)
    bindPositionListeners()
  }

  window.HandoffConfirmationQueue = {
    bind,
    enqueue,
    pump,
    reposition: schedulePositionPrompt
  }
})()
