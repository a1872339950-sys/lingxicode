// 工具详情折叠状态管理。正文保留在 DOM，避免消息重建或虚拟滚动后
// WeakMap 缓存随旧节点丢失，导致点击展开只剩空容器。
(function () {
  'use strict'

  const store = new WeakMap()
  const UI_PREVIEW_CHARS = 1200
  const UI_BASH_CHARS = 1000
  const UI_DIFF_CHARS = 800
  const UI_CONTENT_CHARS = 600

  function limits() {
    return {
      preview: UI_PREVIEW_CHARS,
      bash: UI_BASH_CHARS,
      diff: UI_DIFF_CHARS,
      content: UI_CONTENT_CHARS
    }
  }

  function stash(detailEl, html = '', options = {}) {
    if (!detailEl) return
    const nextHtml = String(html || detailEl.innerHTML || '')
    const forceExpanded = options.expanded === true || options.media === true
    if (forceExpanded) {
      detailEl.innerHTML = nextHtml
      detailEl.classList.remove('collapsed')
      detailEl.dataset.lazyDetail = '0'
      store.set(detailEl, { html: nextHtml, hydrated: true })
      if (typeof options.onHydrated === 'function') options.onHydrated(detailEl)
      return
    }
    detailEl.innerHTML = nextHtml
    store.set(detailEl, { html: nextHtml, hydrated: true })
    detailEl.dataset.lazyDetail = '0'
    detailEl.classList.add('collapsed')
    detailEl.style.removeProperty('max-height')
  }

  function hydrate(detailEl, options = {}) {
    if (!detailEl) return false
    const entry = store.get(detailEl)
    if (!entry) {
      // 无懒加载标记时视为已有内容
      return detailEl.childNodes.length > 0
    }
    if (!entry.hydrated) {
      if (entry.html) detailEl.innerHTML = entry.html
      entry.hydrated = true
      store.set(detailEl, entry)
      detailEl.dataset.lazyDetail = '0'
      if (typeof options.onHydrated === 'function') options.onHydrated(detailEl)
    }
    return true
  }

  function collapseAndRelease(detailEl) {
    if (!detailEl) return
    const entry = store.get(detailEl)
    const html = entry?.html || detailEl.innerHTML || ''
    if (html && !detailEl.innerHTML) detailEl.innerHTML = html
    store.set(detailEl, { html, hydrated: true })
    detailEl.dataset.lazyDetail = '0'
    detailEl.classList.add('collapsed')
    detailEl.style.removeProperty('max-height')
  }

  function clear(detailEl) {
    if (!detailEl) return
    store.delete(detailEl)
    detailEl.innerHTML = ''
    detailEl.dataset.lazyDetail = ''
  }

  function isLazy(detailEl) {
    return !!(detailEl && (detailEl.dataset.lazyDetail === '1' || store.has(detailEl)))
  }

  window.ToolDetailLazy = {
    UI_PREVIEW_CHARS,
    UI_BASH_CHARS,
    UI_DIFF_CHARS,
    UI_CONTENT_CHARS,
    limits,
    stash,
    hydrate,
    collapseAndRelease,
    clear,
    isLazy
  }
})()
