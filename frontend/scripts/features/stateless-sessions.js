// Lightweight archive and restore UI for temporary/stateless chats.
// Supports: delete session, search, show first 5 with scroll for the rest.
(function () {
  'use strict'

  const PAGE_SIZE = 30
  const SEARCH_DEBOUNCE_MS = 120
  const state = {
    open: false,
    loading: false,
    sessions: [],
    total: 0,
    resultTotal: 0,
    page: 0,
    hasMore: false,
    query: '',
    searchTimer: 0,
    loadGeneration: 0,
    lastActiveProjectId: ''
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;')
  }

  function formatTime(ts) {
    if (!ts) return ''
    try {
      return new Date(ts).toLocaleString('zh-CN', {
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
      })
    } catch (_) {
      return ''
    }
  }

  function getEls() {
    return {
      btn: document.getElementById('statelessSessionsBtn'),
      badge: document.getElementById('statelessSessionsBadge'),
      popover: document.getElementById('statelessSessionsPopover'),
      list: document.getElementById('statelessSessionsList'),
      count: document.getElementById('statelessSessionsCount'),
      close: document.getElementById('statelessSessionsClose'),
      search: document.getElementById('statelessSessionsSearch')
    }
  }

  function getActiveProjectId() {
    return String(
      window.getActiveProject?.()?.id
      || window.ProjectStore?.getActiveProjectId?.()
      || ''
    )
  }

  function findProjectById(projectId) {
    if (!projectId) return null
    return window.ProjectStore?.findProjectById?.(projectId)
      || window.findProjectById?.(projectId)
      || null
  }

  function getSessionTitleFromProject(project) {
    const firstUser = (Array.isArray(project?.messagesHistory) ? project.messagesHistory : [])
      .find(message => message?.role === 'user' && !message.hidden)
    const raw = String(
      firstUser?.displayContent
      || firstUser?.content
      || project?.branchTitle
      || project?.title
      || project?.name
      || '临时会话'
    ).replace(/\s+/g, ' ').trim()
    return raw.length > 30 ? `${raw.slice(0, 30)}...` : (raw || '临时会话')
  }

  function refreshBadgeQuietly() {
    if (!window.api?.listStatelessChatSessions) return
    window.api.listStatelessChatSessions({ page: 0, limit: 1 })
      .then(result => {
        if (!result?.success) return
        state.total = Number(result.total) || 0
        updateBadge(getEls())
      })
      .catch(() => {})
  }

  function pulseEntryButton() {
    const els = getEls()
    if (!els.btn) return
    els.btn.classList.remove('session-arrived')
    void els.btn.offsetWidth
    els.btn.classList.add('session-arrived')
    window.setTimeout(() => els.btn?.classList.remove('session-arrived'), 420)
  }

  function animateIntoEntry(project) {
    const els = getEls()
    if (!els.btn) return
    pulseEntryButton()
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return

    const destination = els.btn.getBoundingClientRect()
    const chat = document.getElementById('chatMessages')
    const source = chat?.getBoundingClientRect?.()
    if (!source || source.width <= 0 || source.height <= 0) return

    const flight = document.createElement('div')
    flight.className = 'stateless-session-flight'
    flight.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z"/></svg><span></span>'
    const label = flight.querySelector('span')
    if (label) label.textContent = getSessionTitleFromProject(project)
    document.body.appendChild(flight)

    const width = Math.min(280, Math.max(180, source.width * 0.46))
    flight.style.width = `${width}px`
    const startX = source.left + (source.width - width) / 2
    const startY = source.top + Math.min(120, source.height * 0.28)
    const endX = destination.left + destination.width / 2 - width / 2
    const endY = destination.top + destination.height / 2 - 21
    const animation = flight.animate([
      { transform: `translate(${startX}px, ${startY + 8}px) scale(0.96)`, opacity: 0 },
      { transform: `translate(${startX}px, ${startY}px) scale(1)`, opacity: 1, offset: 0.18 },
      { transform: `translate(${endX}px, ${endY}px) scale(0.12)`, opacity: 0.08 }
    ], { duration: 420, easing: 'cubic-bezier(.2,.75,.25,1)', fill: 'forwards' })
    animation.addEventListener('finish', () => flight.remove(), { once: true })
    animation.addEventListener('cancel', () => flight.remove(), { once: true })
  }

  function onActiveProjectChanged(event) {
    const nextId = String(event?.detail?.projectId || getActiveProjectId() || '')
    if (state.open) closePopover()

    const previousId = state.lastActiveProjectId
    const previousProject = previousId ? findProjectById(previousId) : null
    state.lastActiveProjectId = nextId

    // 仅恢复视觉过渡：从临时会话切走时飞入入口按钮
    if (previousProject?.stateless && previousId && previousId !== nextId) {
      animateIntoEntry(previousProject)
    }

    window.setTimeout(() => {
      if (state.open) loadSessions({ reset: true })
      else refreshBadgeQuietly()
    }, 180)
  }

  function updateCountLabel(els) {
    if (!els.count) return
    const total = Number(state.total) || state.sessions.length || 0
    if (state.query.trim()) {
      els.count.textContent = `匹配 ${state.resultTotal} / 共 ${total} 个`
      return
    }
    els.count.textContent = `${total} 个会话`
  }

  function updateBadge(els) {
    if (!els.badge) return
    const total = Number(state.total) || state.sessions.length || 0
    if (!total) {
      els.badge.hidden = true
      els.badge.textContent = ''
      return
    }
    els.badge.hidden = false
    els.badge.textContent = total > 99 ? '99+' : String(total)
  }

  function renderList() {
    const els = getEls()
    if (!els.list) return

    if (state.loading && !state.sessions.length) {
      els.list.innerHTML = '<div class="stateless-sessions-loading">正在读取会话...</div>'
      updateCountLabel(els, 0)
      return
    }

    const sessions = state.sessions
    updateCountLabel(els)
    updateBadge(els)

    if (!sessions.length) {
      const emptyText = state.query.trim()
        ? '没有匹配的临时会话'
        : '暂无临时会话'
      els.list.innerHTML = `<div class="stateless-sessions-empty">${escapeHtml(emptyText)}</div>`
      return
    }

    const activeId = window.getActiveProject?.()?.id || ''
    els.list.innerHTML = sessions.map(session => {
      const active = session.id === activeId
      const timestamp = formatTime(session.updatedAt || session.createdAt)
      // 标题为空时用时间兜底，避免只显示一个孤立数字
      const title = String(session.title || '').trim() || timestamp || '临时会话'
      return `
        <div class="stateless-session-row${active ? ' active' : ''}" data-session-id="${escapeHtml(session.id)}">
          <button class="stateless-session-open" type="button" data-open-session="${escapeHtml(session.id)}" title="${escapeHtml(title)}">
            <span class="stateless-session-title">${escapeHtml(title)}</span>
            <span class="stateless-session-meta">
              <span>${escapeHtml(timestamp)}</span>
              <span>${Number(session.turnCount) || 0} 轮</span>
            </span>
          </button>
          <button
            class="stateless-session-delete"
            type="button"
            data-delete-session="${escapeHtml(session.id)}"
            title="${active ? '当前正在使用的临时会话不能直接删除，请先切换到其他会话' : '删除会话'}"
            aria-label="删除会话"
            ${active ? 'disabled' : ''}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v5"/><path d="M14 11v5"/>
            </svg>
          </button>
        </div>
      `
    }).join('')
  }

  async function loadSessions({ reset = false } = {}) {
    if (!window.api?.listStatelessChatSessions) return
    if (state.loading && !reset) return
    const generation = reset ? ++state.loadGeneration : state.loadGeneration
    state.loading = true
    if (reset) {
      state.page = 0
      state.sessions = []
      state.hasMore = false
      state.resultTotal = 0
      renderList()
    }
    const requestedPage = state.page
    const requestedQuery = String(state.query || '').trim()
    try {
      const result = await window.api.listStatelessChatSessions({
        page: requestedPage,
        limit: PAGE_SIZE,
        query: requestedQuery
      })
      if (generation !== state.loadGeneration) return
      if (!result?.success) throw new Error(result?.error || '读取临时会话失败')
      const pageSessions = Array.isArray(result.sessions) ? result.sessions : []
      const merged = reset ? pageSessions : state.sessions.concat(pageSessions)
      state.sessions = Array.from(new Map(merged.map(session => [session.id, session])).values())
      state.total = Number(result.overallTotal ?? result.total) || state.sessions.length
      state.resultTotal = Number(result.total) || state.sessions.length
      state.hasMore = !!result.hasMore
      state.page = state.hasMore ? requestedPage + 1 : requestedPage
    } catch (error) {
      console.error('[StatelessSessions] load failed:', error)
      if (state.open) window.showToast?.(error?.message || '读取临时会话失败', 'error')
      if (!state.sessions.length) {
        const els = getEls()
        if (els.list) {
          els.list.innerHTML = `<div class="stateless-sessions-empty">${escapeHtml(error?.message || '读取临时会话失败')}</div>`
        }
      }
    } finally {
      if (generation === state.loadGeneration) {
        state.loading = false
        renderList()
      }
    }
  }

  async function openPopover() {
    const els = getEls()
    if (!els.popover || !els.btn) return
    state.open = true
    els.popover.hidden = false
    els.btn.setAttribute('aria-expanded', 'true')
    if (els.search) {
      els.search.value = state.query || ''
      try { els.search.focus({ preventScroll: true }) } catch (_) {
        try { els.search.focus?.() } catch (_) {}
      }
    }
    await loadSessions({ reset: true })
  }

  function closePopover() {
    const els = getEls()
    state.open = false
    if (els.popover) els.popover.hidden = true
    if (els.btn) els.btn.setAttribute('aria-expanded', 'false')
  }

  async function openSession(sessionId) {
    if (!sessionId || !window.api?.openStatelessChatSession) return
    try {
      const result = await window.api.openStatelessChatSession(sessionId)
      if (!result?.success) throw new Error(result?.error || '打开临时会话失败')

      const session = result.session || state.sessions.find(item => item.id === sessionId) || {}
      const projectId = result.projectId || session.id || sessionId
      const title = session.title || '临时会话'

      // 打开时先把临时会话挂到前端项目 store，再切换激活
      if (typeof window.createProject === 'function') {
        window.createProject('', {
          id: projectId,
          name: title,
          title,
          storagePath: result.storagePath || session.storagePath || '',
          stateless: true,
          workspaceOrigin: 'none',
          skipSave: true
        })
      } else if (window.ProjectStore?.createProject) {
        window.ProjectStore.createProject('', {
          id: projectId,
          name: title,
          title,
          storagePath: result.storagePath || session.storagePath || '',
          stateless: true,
          workspaceOrigin: 'none'
        })
      }

      closePopover()
      try { window.returnToChatArea?.() } catch (_) {}

      if (typeof window.switchProject === 'function') {
        await window.switchProject(projectId)
      } else if (typeof window.setActiveProject === 'function') {
        window.setActiveProject(projectId)
        window.renderProjectList?.()
        window.updateProjectDisplay?.()
      }

      renderList()
    } catch (error) {
      console.error('[StatelessSessions] open failed:', error)
      window.showToast?.(error?.message || '打开临时会话失败', 'error')
    }
  }

  async function confirmDeleteSession(session) {
    const title = session?.title || '临时会话'
    if (window.BranchDangerDialog?.show) {
      return !!(await window.BranchDangerDialog.show({
        targetName: title,
        title: '删除临时会话',
        subtitle: '将删除这个临时会话的聊天记录和上下文，且无法恢复。',
        targetLabel: '目标会话',
        listTitle: '将一并删除',
        tags: ['聊天历史', '上下文', '压缩记录'],
        note: '这是临时会话，不会影响项目源码、Git 分支、文件权限和安全快照。',
        confirmText: '确认删除'
      }))
    }
    return !!window.confirm(`确定删除临时会话“${title}”吗？\n\n聊天记录和压缩历史会一并删除。`)
  }

  async function deleteSession(sessionId) {
    if (!sessionId || !window.api?.deleteStatelessChatSession) return
    const session = state.sessions.find(item => item.id === sessionId)
    const activeId = window.getActiveProject?.()?.id || ''
    if (sessionId === activeId) {
      window.showToast?.('当前正在使用的临时会话不能直接删除，请先切换到其他会话', 'warning')
      return
    }
    const confirmed = await confirmDeleteSession(session)
    if (!confirmed) return
    try {
      const result = await window.api.deleteStatelessChatSession(sessionId)
      if (!result?.success) throw new Error(result?.error || '删除临时会话失败')
      state.sessions = state.sessions.filter(item => item.id !== sessionId)
      state.total = Math.max(0, (Number(state.total) || state.sessions.length) - 1)
      renderList()
      window.showToast?.('已删除临时会话', 'success')
    } catch (error) {
      console.error('[StatelessSessions] delete failed:', error)
      window.showToast?.(error?.message || '删除临时会话失败', 'error')
    }
  }

  function bindEvents() {
    const els = getEls()
    if (!els.btn || !els.popover || !els.list) return

    els.btn.addEventListener('click', async event => {
      event.preventDefault()
      event.stopPropagation()
      if (state.open) closePopover()
      else await openPopover()
    })

    els.close?.addEventListener('click', event => {
      event.preventDefault()
      event.stopPropagation()
      closePopover()
    })

    els.search?.addEventListener('input', event => {
      const value = String(event.target?.value || '')
      window.clearTimeout(state.searchTimer)
      state.searchTimer = window.setTimeout(() => {
        state.query = value.trim()
        loadSessions({ reset: true })
      }, SEARCH_DEBOUNCE_MS)
    })

    els.search?.addEventListener('keydown', event => {
      if (event.key === 'Escape') {
        event.preventDefault()
        if (String(els.search.value || '').trim()) {
          els.search.value = ''
          state.query = ''
          loadSessions({ reset: true })
          return
        }
        closePopover()
      }
    })

    els.list.addEventListener('click', async event => {
      const deleteBtn = event.target.closest('[data-delete-session]')
      if (deleteBtn) {
        event.preventDefault()
        event.stopPropagation()
        if (deleteBtn.disabled) return
        await deleteSession(deleteBtn.getAttribute('data-delete-session'))
        return
      }
      const openBtn = event.target.closest('[data-open-session]')
      if (openBtn) {
        event.preventDefault()
        event.stopPropagation()
        await openSession(openBtn.getAttribute('data-open-session'))
      }
    })

    els.list.addEventListener('scroll', () => {
      if (!state.open || state.loading || !state.hasMore) return
      const remaining = els.list.scrollHeight - els.list.scrollTop - els.list.clientHeight
      if (remaining <= 48) loadSessions({ reset: false })
    }, { passive: true })

    document.addEventListener('click', event => {
      if (!state.open) return
      const anchor = document.querySelector('.stateless-sessions-anchor')
      if (anchor && !anchor.contains(event.target)) closePopover()
    })

    document.addEventListener('keydown', event => {
      if (!state.open) return
      if (event.key === 'Escape') closePopover()
    })

    window.addEventListener('lingxi:active-project-changed', onActiveProjectChanged)
    window.api?.onProjectPathChanged?.(() => window.setTimeout(refreshBadgeQuietly, 150))
  }

  function init() {
    state.lastActiveProjectId = getActiveProjectId()
    bindEvents()
    // 轻量预取数量，用于角标
    refreshBadgeQuietly()
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true })
  } else {
    init()
  }

  window.StatelessSessionsUI = {
    refresh: () => (state.open ? loadSessions({ reset: true }) : refreshBadgeQuietly()),
    open: openPopover,
    close: closePopover,
    animateIntoEntry
  }

  // 兼容旧入口名
  window.StatelessSessions = window.StatelessSessionsUI
})()
