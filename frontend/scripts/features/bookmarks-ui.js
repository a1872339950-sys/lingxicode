/**
 * 书签功能前端模块
 * 负责：
 * - 工具栏书签管理按钮：点击展开书签列表面板
 * - 网址输入框内星标按钮：根据当前 URL 切换收藏/取消收藏
 * - 与外部传入的导航回调协作（点击书签时触发跳转）
 */
(function () {
  'use strict'

  const STAR_BTN_ID = 'webviewNavInputBookmark'
  const LIST_BTN_ID = 'webviewNavBookmarkList'

  let panel = null
  let searchKeyword = ''
  let cachedBookmarks = null // null 表示未加载过
  let currentUrl = ''
  let currentTitle = ''
  let currentFavicon = ''
  let navigateCallback = null // 外部注入：navigateCallback(url)
  let openInNewTabCallback = null // 外部注入：openInNewTabCallback(url)
  let toastCallback = null    // 外部注入：toastCallback(message, type)

  function api() {
    return window.api || {}
  }

  function showToast(message, type = 'info') {
    if (typeof toastCallback === 'function') toastCallback(message, type)
    else if (typeof window.showToast === 'function') window.showToast(message, type)
  }

  /**
   * 刷新缓存：从后端拉取所有书签
   */
  async function refreshCache() {
    if (!api().listBookmarks) { cachedBookmarks = []; return }
    try {
      const result = await api().listBookmarks()
      cachedBookmarks = Array.isArray(result?.bookmarks) ? result.bookmarks : []
    } catch (error) {
      console.error('[Bookmarks] 加载失败:', error)
      cachedBookmarks = []
    }
  }

  /**
   * 更新星标按钮状态（基于 currentUrl）
   */
  function updateStarButtonState() {
    const btn = document.getElementById(STAR_BTN_ID)
    if (!btn) return
    if (!currentUrl) {
      btn.disabled = true
      btn.classList.remove('is-bookmarked')
      return
    }
    btn.disabled = false
    const isBookmarked = (cachedBookmarks || []).some(b => b.url === currentUrl)
    btn.classList.toggle('is-bookmarked', isBookmarked)
  }

  /**
   * 设置当前 URL（由外部导航事件触发）
   */
  async function setCurrentUrl(url, title = '', favicon = '') {
    currentUrl = url || ''
    currentTitle = title || ''
    currentFavicon = favicon || ''
    if (cachedBookmarks === null) await refreshCache()
    updateStarButtonState()
  }

  /**
   * 切换当前 URL 的收藏状态
   */
  async function toggleCurrent() {
    if (!currentUrl) return
    if (!api().addBookmark || !api().removeBookmark) {
      showToast('当前版本不支持书签功能', 'error')
      return
    }
    const existed = (cachedBookmarks || []).some(b => b.url === currentUrl)
    try {
      if (existed) {
        const result = await api().removeBookmark({ url: currentUrl })
        if (!result?.success) {
          showToast(result?.error || '取消收藏失败', 'error')
          return
        }
        cachedBookmarks = (cachedBookmarks || []).filter(b => b.url !== currentUrl)
        showToast('已取消收藏', 'info')
      } else {
        const result = await api().addBookmark({
          url: currentUrl,
          title: currentTitle || currentUrl,
          favicon: currentFavicon || ''
        })
        if (!result?.success) {
          showToast(result?.error || '收藏失败', 'error')
          return
        }
        if (result.bookmark) cachedBookmarks.push(result.bookmark)
        showToast('已收藏', 'success')
      }
      updateStarButtonState()
      // 如果面板已展开，同步刷新
      if (panel) renderPanelList()
    } catch (error) {
      showToast(error?.message || '操作失败', 'error')
    }
  }

  /**
   * 删除书签（按 URL）
   */
  async function removeBookmarkByUrl(url) {
    if (!url || !api().removeBookmark) return
    try {
      const result = await api().removeBookmark({ url })
      if (result?.success) {
        cachedBookmarks = (cachedBookmarks || []).filter(b => b.url !== url)
        updateStarButtonState()
        renderPanelList()
        showToast('已删除书签', 'info')
      } else {
        showToast(result?.error || '删除失败', 'error')
      }
    } catch (error) {
      showToast(error?.message || '删除失败', 'error')
    }
  }

  /**
   * 渲染面板书签列表
   */
  function renderPanelList() {
    if (!panel) return
    const body = panel.querySelector('.bookmark-list-panel-body')
    if (!body) return

    const all = cachedBookmarks || []
    const filtered = searchKeyword
      ? all.filter(b => {
          const k = searchKeyword.toLowerCase()
          return (b.title || '').toLowerCase().includes(k) || (b.url || '').toLowerCase().includes(k)
        })
      : all

    const countEl = panel.querySelector('.bookmark-list-panel-count')
    if (countEl) countEl.textContent = String(all.length)

    if (filtered.length === 0) {
      body.innerHTML = `
        <div class="bookmark-list-panel-empty">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>
          <div>${all.length === 0 ? '还没有书签' : '未匹配到书签'}</div>
        </div>
      `
      return
    }

    body.innerHTML = ''
    for (const b of filtered) {
      const item = document.createElement('div')
      item.className = 'bookmark-item'
      item.title = b.url

      // favicon
      let faviconHtml = ''
      if (b.favicon) {
        faviconHtml = `<img class="bookmark-item-favicon" src="${escapeHtml(b.favicon)}" onerror="this.style.display='none';this.nextElementSibling.style.display='inline-flex'"><span class="bookmark-item-favicon-placeholder" style="display:none"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg></span>`
      } else {
        faviconHtml = `<span class="bookmark-item-favicon-placeholder"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg></span>`
      }

      item.innerHTML = `
        ${faviconHtml}
        <div class="bookmark-item-text">
          <div class="bookmark-item-title">${escapeHtml(b.title || b.url)}</div>
          <div class="bookmark-item-url">${escapeHtml(b.url)}</div>
        </div>
        <button type="button" class="bookmark-item-delete" title="删除书签" aria-label="删除书签">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2"/></svg>
        </button>
      `

      // 点击条目跳转
      item.addEventListener('click', (e) => {
        if (e.target.closest('.bookmark-item-delete')) return
        if (typeof navigateCallback === 'function') navigateCallback(b.url)
        closePanel()
      })
      // 右键菜单：在新标签页打开
      item.addEventListener('contextmenu', (e) => {
        e.preventDefault()
        showBookmarkContextMenu(e.clientX, e.clientY, b.url)
      })
      // 删除按钮
      item.querySelector('.bookmark-item-delete').addEventListener('click', (e) => {
        e.stopPropagation()
        removeBookmarkByUrl(b.url)
      })

      // 拖拽排序
      item.draggable = true
      item.dataset.id = b.id || ''
      item.addEventListener('dragstart', (e) => {
        e.dataTransfer.effectAllowed = 'move'
        e.dataTransfer.setData('text/plain', b.id || '')
        item.classList.add('dragging')
      })
      item.addEventListener('dragend', () => {
        item.classList.remove('dragging')
      })
      item.addEventListener('dragover', (e) => {
        e.preventDefault()
        e.dataTransfer.dropEffect = 'move'
        const after = getBookmarkDragAfterElement(body, e.clientY)
        if (after == null) {
          body.appendChild(item)
        } else if (after !== item) {
          body.insertBefore(item, after)
        }
      })
      item.addEventListener('drop', (e) => {
        e.preventDefault()
        syncBookmarkOrder()
      })

      body.appendChild(item)
    }
  }

  function escapeHtml(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;')
  }

  /**
   * 打开书签列表面板
   */
  async function openPanel(anchorEl) {
    if (panel) { closePanel(); return }
    if (cachedBookmarks === null) await refreshCache()

    panel = document.createElement('div')
    panel.className = 'bookmark-list-panel'
    panel.innerHTML = `
      <div class="bookmark-list-panel-header">
        <div class="bookmark-list-panel-title">书签</div>
        <div class="bookmark-list-panel-count">0</div>
      </div>
      <div class="bookmark-list-panel-search">
        <input type="text" placeholder="搜索书签..." />
      </div>
      <div class="bookmark-list-panel-body"></div>
      <div class="bookmark-list-panel-footer">
        <button type="button">关闭</button>
      </div>
    `
    document.body.appendChild(panel)

    // 定位：在 anchor 按钮下方
    if (anchorEl) {
      const rect = anchorEl.getBoundingClientRect()
      const panelWidth = 360
      let left = rect.left
      if (left + panelWidth > window.innerWidth - 8) {
        left = window.innerWidth - panelWidth - 8
      }
      let top = rect.bottom + 6
      panel.style.left = `${Math.max(8, left)}px`
      panel.style.top = `${top}px`

      // 如果超出下方，向上展开
      requestAnimationFrame(() => {
        const panelRect = panel.getBoundingClientRect()
        if (panelRect.bottom > window.innerHeight - 8) {
          panel.style.top = `${Math.max(8, rect.top - panelRect.height - 6)}px`
        }
      })
    } else {
      panel.style.left = '50%'
      panel.style.top = '50%'
      panel.style.transform = 'translate(-50%, -50%)'
    }

    // 搜索框
    const searchInput = panel.querySelector('input[type="text"]')
    if (searchInput) {
      searchInput.value = searchKeyword
      searchInput.addEventListener('input', (e) => {
        searchKeyword = e.target.value
        renderPanelList()
      })
    }

    // 关闭按钮
    panel.querySelector('.bookmark-list-panel-footer button').addEventListener('click', closePanel)

    // 点击外部关闭
    setTimeout(() => {
      document.addEventListener('mousedown', onOutsideClick)
    }, 0)

    renderPanelList()
  }

  function onOutsideClick(e) {
    // 点击右键菜单时不关闭浮窗
    if (e.target.closest('.bookmark-context-menu')) return
    if (panel && !panel.contains(e.target) && e.target.id !== LIST_BTN_ID && !e.target.closest(`#${LIST_BTN_ID}`)) {
      closePanel()
    }
  }

  function closePanel() {
    closeBookmarkContextMenu()
    if (panel) {
      panel.remove()
      panel = null
    }
    document.removeEventListener('mousedown', onOutsideClick)
  }

  /**
   * 右键上下文菜单
   */
  function showBookmarkContextMenu(x, y, url) {
    closeBookmarkContextMenu()
    const menu = document.createElement('div')
    menu.className = 'bookmark-context-menu'
    menu.style.cssText = `position:fixed;left:${x}px;top:${y}px;z-index:100000;background:var(--card,#1e1e2e);border:1px solid var(--border,#333);border-radius:8px;padding:4px 0;box-shadow:0 8px 24px rgba(0,0,0,0.4);min-width:160px;font-size:13px;`

    const items = [
      { label: '在新标签页打开', action: () => { if (typeof openInNewTabCallback === 'function') openInNewTabCallback(url); closePanel() } },
      { label: '在当前页打开', action: () => { if (typeof navigateCallback === 'function') navigateCallback(url); closePanel() } },
      { label: '复制链接', action: () => { navigator.clipboard?.writeText(url); showToast('已复制链接', 'info') } },
    ]

    for (const item of items) {
      const el = document.createElement('div')
      el.textContent = item.label
      el.style.cssText = 'padding:6px 16px;cursor:pointer;color:var(--foreground,#e0e0e0);'
      el.addEventListener('mouseenter', () => { el.style.background = 'var(--primary,#6366f1)'; el.style.color = 'var(--primary-foreground,#fff)' })
      el.addEventListener('mouseleave', () => { el.style.background = ''; el.style.color = 'var(--foreground,#e0e0e0)' })
      el.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation() })
      el.addEventListener('click', (e) => { e.stopPropagation(); item.action(); closeBookmarkContextMenu() })
      menu.appendChild(el)
    }

    document.body.appendChild(menu)

    // 边界检测
    const rect = menu.getBoundingClientRect()
    if (rect.right > window.innerWidth - 4) menu.style.left = `${window.innerWidth - rect.width - 4}px`
    if (rect.bottom > window.innerHeight - 4) menu.style.top = `${window.innerHeight - rect.height - 4}px`

    setTimeout(() => {
      document.addEventListener('mousedown', (e) => {
        if (!e.target.closest('.bookmark-context-menu')) closeBookmarkContextMenu()
      }, { once: true })
    }, 0)
  }

  /**
   * 书签拖拽排序辅助
   */
  function getBookmarkDragAfterElement(container, y) {
    const items = [...container.querySelectorAll('.bookmark-item:not(.dragging)')]
    return items.reduce((closest, child) => {
      const box = child.getBoundingClientRect()
      const offset = y - box.top - box.height / 2
      if (offset < 0 && offset > closest.offset) {
        return { offset, element: child }
      }
      return closest
    }, { offset: -Infinity }).element
  }

  async function syncBookmarkOrder() {
    if (!panel) return
    const body = panel.querySelector('.bookmark-list-panel-body')
    if (!body) return
    const orderedIds = [...body.querySelectorAll('.bookmark-item')].map(el => el.dataset.id).filter(Boolean)
    if (!orderedIds.length) return
    // 本地缓存同步
    const idMap = new Map((cachedBookmarks || []).map(b => [b.id, b]))
    const reordered = orderedIds.map(id => idMap.get(id)).filter(Boolean)
    // 追加未在列表中的（如搜索过滤掉的）
    const unshown = (cachedBookmarks || []).filter(b => !orderedIds.includes(b.id))
    cachedBookmarks = [...reordered, ...unshown]
    // 持久化
    try { await api().reorderBookmarks?.(orderedIds) } catch (_) { /* ignore */ }
  }

  function closeBookmarkContextMenu() {
    document.querySelectorAll('.bookmark-context-menu').forEach(el => el.remove())
  }

  /**
   * 初始化：绑定按钮事件
   * @param {Object} options
   *   - onNavigate: Function(url) - 点击书签条目时的跳转回调
   *   - showToast: Function(message, type) - toast 函数
   */
  function init(options = {}) {
    navigateCallback = typeof options.onNavigate === 'function' ? options.onNavigate : null
    openInNewTabCallback = typeof options.onOpenInNewTab === 'function' ? options.onOpenInNewTab : null
    toastCallback = typeof options.showToast === 'function' ? options.showToast : null

    const starBtn = document.getElementById(STAR_BTN_ID)
    if (starBtn) {
      starBtn.addEventListener('click', toggleCurrent)
    }

    const listBtn = document.getElementById(LIST_BTN_ID)
    if (listBtn) {
      listBtn.addEventListener('click', () => {
        openPanel(listBtn)
      })
    }
  }

  /**
   * 设置书签管理按钮可用状态
   */
  function setListButtonEnabled(enabled) {
    const btn = document.getElementById(LIST_BTN_ID)
    if (btn) btn.disabled = !enabled
  }

  window.BookmarksUI = {
    init,
    setCurrentUrl,
    setListButtonEnabled,
    refreshCache
  }
})()
