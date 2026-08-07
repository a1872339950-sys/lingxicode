/**
 * 对话内可视化：沙箱 iframe 灌入与交互
 * 主题：跟随宿主 data-theme-mode / 设计令牌，避免系统色与应用主题不一致导致黑字黑底。
 */
(function () {
  const cache = new Map()
  const KIND_META = {
    flow: { label: '流程图', icon: '⇢' },
    relation: { label: '关系图', icon: '⌘' },
    timeline: { label: '时间线', icon: '◷' },
    comparison: { label: '对比图', icon: '◫' },
    chart: { label: '数据图', icon: '⌁' },
    simulator: { label: '交互演示', icon: '◎' },
    diagram: { label: '可视化', icon: '◇' }
  }
  /** iframe -> 原始 HTML（切换主题时重灌，不塞进 DOM 属性） */
  const frameSourceHtml = new WeakMap()

  function currentProjectId() {
    try {
      return String(
        window.AppState?.currentProjectId ||
        window.Projects?.getCurrentProjectId?.() ||
        window.currentProjectId ||
        ''
      )
    } catch {
      return ''
    }
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
  }

  function getKindMeta(kind = '') {
    return KIND_META[String(kind || '').trim().toLowerCase()] || KIND_META.diagram
  }

  function applyVisualMeta(card, payload = {}) {
    if (!card) return
    const kind = String(payload?.kind || payload?.meta?.kind || card.dataset.visKind || 'diagram').toLowerCase()
    const meta = getKindMeta(kind)
    card.dataset.visKind = KIND_META[kind] ? kind : 'diagram'
    const label = card.querySelector('.lingxi-inline-vis-toggle-label')
    const glyph = card.querySelector('.lingxi-inline-vis-kind-icon')
    const toggle = card.querySelector('[data-vis-toggle]')
    if (glyph) glyph.textContent = meta.icon
    if (label) label.textContent = card.dataset.visCollapsed === 'true' ? `${meta.label}（已折叠）` : meta.label
    if (toggle) toggle.title = card.dataset.visCollapsed === 'true' ? `展开${meta.label}` : `折叠${meta.label}`
  }

  function hostThemeMode() {
    try {
      return document.documentElement.getAttribute('data-theme-mode') === 'light' ? 'light' : 'dark'
    } catch {
      return 'dark'
    }
  }

  function readCssVar(name, fallback = '') {
    try {
      const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
      return v || fallback
    } catch {
      return fallback
    }
  }

  /**
   * 从宿主设计令牌映射可视化 CSS 变量（与 electron/modules/inline-visualize 约定一致）
   */
  function getHostVizTheme() {
    const mode = hostThemeMode()
    const dark = mode === 'dark'
    const bg = readCssVar('--bg-base', dark ? '#0a0b10' : '#ffffff')
    const card = readCssVar('--bg-secondary', dark ? '#161925' : '#f4f6f8')
    const fg = readCssVar('--text-primary', dark ? '#f1f5f9' : '#1a1c1f')
    const mutedFg = readCssVar('--text-secondary', dark ? '#94a3b8' : '#64748b')
    const primary = readCssVar('--accent-primary', dark ? '#22d3ee' : '#0891b2')
    const accentLight = readCssVar('--accent-light', dark ? '#22d3ee' : '#06b6d4')
    const border = readCssVar('--border-default', dark ? 'rgba(148,163,184,0.14)' : 'rgba(26,28,31,0.10)')
    const onSeries = dark ? '#0b0c10' : '#ffffff'
    const primaryFg = dark ? '#0b0c10' : '#ffffff'
    const vars = {
      '--background': bg,
      '--foreground': fg,
      '--card': card,
      '--card-foreground': fg,
      '--primary': primary,
      '--primary-foreground': primaryFg,
      '--muted': dark ? 'rgba(255,255,255,0.08)' : 'rgba(26,28,31,0.08)',
      '--muted-foreground': mutedFg,
      '--accent': readCssVar('--accent-glow', dark ? 'rgba(6,182,212,0.14)' : '#e0f7fa'),
      '--accent-foreground': accentLight || primary,
      '--border': border,
      '--viz-series-1': primary,
      '--viz-series-2': dark ? '#f59a56' : '#ea580c',
      '--viz-series-3': dark ? '#74d58b' : '#16a34a',
      '--viz-series-4': dark ? '#f08fc0' : '#db2777',
      '--viz-series-5': dark ? '#aa91ef' : '#7c3aed',
      '--viz-series-6': dark ? '#5acbc2' : '#0d9488',
      '--on-series': onSeries
    }
    const cssText =
      `:root,html{color-scheme:${mode};}` +
      `html,html[data-viz-theme]{color-scheme:${mode};` +
      Object.entries(vars).map(([k, v]) => `${k}:${v};`).join('') +
      `}`
    return { mode, vars, cssText }
  }

  /** 把宿主主题写进独立 HTML（首屏正确；兼容已存旧文档） */
  function applyHostThemeToHtml(html) {
    const theme = getHostVizTheme()
    let out = String(html || '')
    const hostStyle = `<style id="lingxi-host-theme">${theme.cssText}</style>`

    out = out.replace(/<html\b([^>]*)>/i, (_, attrs = '') => {
      let a = String(attrs)
        .replace(/\sdata-viz-theme\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/i, '')
        .replace(/\sstyle\s*=\s*("[^"]*"|'[^']*')/i, '')
      return `<html${a} data-viz-theme="${theme.mode}" style="color-scheme:${theme.mode}">`
    })
    out = out.replace(/<style\s+id=["']lingxi-host-theme["']\s*>[\s\S]*?<\/style>/i, '')
    out = out.replace(
      /<meta\s+name=["']color-scheme["'][^>]*>/i,
      `<meta name="color-scheme" content="${theme.mode === 'light' ? 'light dark' : 'dark light'}">`
    )
    if (/<\/head>/i.test(out)) {
      out = out.replace(/<\/head>/i, `${hostStyle}</head>`)
    } else {
      out = hostStyle + out
    }
    return out
  }

  function postThemeToFrame(iframe) {
    if (!iframe?.contentWindow) return
    try {
      iframe.contentWindow.postMessage(
        { type: 'lingxi-vis-theme', theme: getHostVizTheme() },
        '*'
      )
    } catch (_) { /* sandbox */ }
  }

  function broadcastThemeToFrames() {
    const theme = getHostVizTheme()
    document.querySelectorAll('iframe.lingxi-inline-vis-frame').forEach(iframe => {
      try {
        iframe.contentWindow?.postMessage({ type: 'lingxi-vis-theme', theme }, '*')
      } catch (_) { /* ignore */ }
      // 同步重灌 srcdoc：覆盖无桥接脚本的旧可视化，并保证首帧 CSS 正确
      const raw = frameSourceHtml.get(iframe)
      if (!raw) return
      try {
        const next = applyHostThemeToHtml(raw)
        if (iframe.srcdoc !== next) {
          const h = iframe.style.height
          iframe.srcdoc = next
          if (h) iframe.style.height = h
        }
      } catch (_) { /* ignore */ }
    })
  }

  async function fetchVisual(id) {
    const key = `${currentProjectId()}::${id}`
    if (cache.has(key)) return cache.get(key)
    if (!window.api?.getInlineVisual) {
      return { success: false, error: '可视化接口不可用' }
    }
    const res = await window.api.getInlineVisual({
      projectId: currentProjectId(),
      id
    })
    if (res?.success) cache.set(key, res)
    return res
  }

  function applyCollapsedUI(card, collapsed) {
    if (!card) return
    const isCollapsed = !!collapsed
    card.dataset.visCollapsed = isCollapsed ? 'true' : 'false'
    card.classList.toggle('is-collapsed', isCollapsed)
    const toggle = card.querySelector('[data-vis-toggle]')
    const icon = card.querySelector('.lingxi-inline-vis-toggle-icon')
    if (toggle) {
      toggle.setAttribute('aria-expanded', isCollapsed ? 'false' : 'true')
    }
    if (icon) icon.textContent = isCollapsed ? '▸' : '▾'
    applyVisualMeta(card)
    const wrap = card.querySelector('.lingxi-inline-vis-frame-wrap')
    if (wrap) wrap.hidden = isCollapsed
  }

  function toggleCollapsed(card) {
    if (!card) return
    const next = card.dataset.visCollapsed !== 'true'
    applyCollapsedUI(card, next)
  }

  function mountIframe(wrap, html, title, card, kind = 'diagram') {
    wrap.innerHTML = ''
    const themedHtml = applyHostThemeToHtml(html)
    const iframe = document.createElement('iframe')
    iframe.className = 'lingxi-inline-vis-frame'
    iframe.setAttribute('sandbox', 'allow-scripts allow-forms')
    iframe.setAttribute('referrerpolicy', 'no-referrer')
    iframe.setAttribute('title', title || getKindMeta(kind).label)
    iframe.style.height = '220px'
    // srcdoc + 无 allow-same-origin：与父页隔离，高度靠 postMessage
    iframe.srcdoc = themedHtml
    frameSourceHtml.set(iframe, String(html || ''))
    wrap.appendChild(iframe)

    const setHeight = (h) => {
      const next = `${Math.min(Math.max(h + 12, 140), 720)}px`
      iframe.style.height = next
      if (card) card.dataset.visExpandedHeight = next
    }

    const onMessage = event => {
      if (event.source !== iframe.contentWindow) return
      const data = event.data || {}
      if (data.type !== 'lingxi-vis-resize') return
      // 折叠时不改高度，展开时再恢复
      if (card?.dataset?.visCollapsed === 'true') return
      setHeight(Number(data.height) || 280)
    }
    window.addEventListener('message', onMessage)
    iframe.addEventListener('load', () => {
      postThemeToFrame(iframe)
      setTimeout(() => {
        if (!iframe.style.height || iframe.style.height === '220px') {
          setHeight(248)
        }
      }, 600)
    })
  }

  async function hydrateCard(card) {
    if (!card || card.dataset.visState === 'ready' || card.dataset.visState === 'loading') return
    const id = card.getAttribute('data-vis-id')
    if (!id) return
    card.dataset.visState = 'loading'
    // 确保有工具条（兼容旧消息 HTML）
    ensureToolbar(card)
    applyCollapsedUI(card, card.dataset.visCollapsed === 'true')

    const wrap = card.querySelector('.lingxi-inline-vis-frame-wrap')
    const titleEl = card.querySelector('.lingxi-inline-vis-title')
    try {
      // 不依赖 projectId：后端按全局 id 索引读取
      const res = await (window.api?.getInlineVisual
        ? window.api.getInlineVisual({ id, projectId: currentProjectId() })
        : Promise.resolve({ success: false, error: '可视化接口不可用' }))
      if (!res?.success) {
        card.dataset.visState = 'error'
        if (wrap) wrap.innerHTML = `<div class="lingxi-inline-vis-error">${escapeHtml(res?.error || '加载失败')}</div>`
        return
      }
      applyVisualMeta(card, res)
      if (titleEl) titleEl.textContent = res.title || ''
      if (wrap) mountIframe(wrap, res.html, res.title, card, res.kind || res.meta?.kind)
      card.dataset.visState = 'ready'
      applyCollapsedUI(card, card.dataset.visCollapsed === 'true')
    } catch (err) {
      card.dataset.visState = 'error'
      if (wrap) wrap.innerHTML = `<div class="lingxi-inline-vis-error">${escapeHtml(err?.message || '加载失败')}</div>`
    }
  }

  function ensureToolbar(card) {
    if (!card || card.querySelector('.lingxi-inline-vis-toolbar')) return
    const id = card.getAttribute('data-vis-id') || ''
    const bar = document.createElement('div')
    bar.className = 'lingxi-inline-vis-toolbar'
    bar.innerHTML =
      `<button type="button" class="lingxi-inline-vis-toggle" data-vis-toggle="${escapeHtml(id)}" aria-expanded="true" title="折叠可视化">` +
      `<span class="lingxi-inline-vis-toggle-icon" aria-hidden="true">▾</span>` +
      `<span class="lingxi-inline-vis-kind-icon" aria-hidden="true">◇</span>` +
      `<span class="lingxi-inline-vis-toggle-label">可视化</span>` +
      `</button>` +
      `<span class="lingxi-inline-vis-title"></span>` +
      `<button type="button" class="lingxi-inline-vis-open" data-vis-open="${escapeHtml(id)}" title="新窗口打开"><span aria-hidden="true">↗</span> 新窗口</button>`
    card.insertBefore(bar, card.firstChild)
  }

  function hydrateAll(root = document) {
    const scope = root && root.querySelectorAll ? root : document
    scope.querySelectorAll?.('.lingxi-inline-vis[data-vis-state="pending"], .lingxi-inline-vis:not([data-vis-state])')
      ?.forEach(card => {
        // 新插入的节点可能没有 pending，统一处理
        if (!card.dataset.visState || card.dataset.visState === 'pending') {
          hydrateCard(card)
        }
      })
    // 兼容只写了 data-vis-id 的节点
    scope.querySelectorAll?.('.lingxi-inline-vis[data-vis-id]')?.forEach(card => {
      if (card.dataset.visState === 'pending' || !card.dataset.visState) hydrateCard(card)
    })
  }

  async function openInWindow(id) {
    const res = await fetchVisual(id)
    if (!res?.success) {
      window.ToastUI?.show?.(res?.error || '无法打开可视化', 'error')
      return
    }
    // 独立窗口同样注入当前宿主主题
    const blob = new Blob([applyHostThemeToHtml(res.html)], { type: 'text/html;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const win = window.open(url, '_blank')
    if (!win) {
      window.ToastUI?.show?.('弹窗被拦截，请允许本应用打开新窗口', 'error')
    }
    setTimeout(() => URL.revokeObjectURL(url), 60000)
  }

  function bindThemeSync() {
    let timer = 0
    const onThemeMaybeChanged = () => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        timer = 0
        broadcastThemeToFrames()
      }, 80)
    }
    window.addEventListener('lingxi:theme-changed', onThemeMaybeChanged)
    document.addEventListener('lingxi:theme-changed', onThemeMaybeChanged)
    // 兜底：监听 html 的 data-theme-mode / style 变化
    if (typeof MutationObserver !== 'undefined') {
      try {
        const mo = new MutationObserver(() => onThemeMaybeChanged())
        mo.observe(document.documentElement, {
          attributes: true,
          attributeFilter: ['data-theme-mode', 'data-preset', 'style', 'class']
        })
      } catch (_) { /* ignore */ }
    }
  }

  function bind() {
    document.addEventListener('click', event => {
      const toggleBtn = event.target?.closest?.('[data-vis-toggle]')
      if (toggleBtn) {
        event.preventDefault()
        event.stopPropagation()
        const card = toggleBtn.closest('.lingxi-inline-vis')
        toggleCollapsed(card)
        return
      }

      const openBtn = event.target?.closest?.('[data-vis-open]')
      if (openBtn) {
        event.preventDefault()
        event.stopPropagation()
        openInWindow(openBtn.getAttribute('data-vis-open'))
      }
    })

    // 历史消息滚动进视口时补灌
    if (typeof MutationObserver !== 'undefined') {
      const obs = new MutationObserver(mutations => {
        for (const m of mutations) {
          m.addedNodes?.forEach(node => {
            if (node.nodeType !== 1) return
            if (node.classList?.contains('lingxi-inline-vis')) hydrateCard(node)
            else if (node.querySelectorAll) hydrateAll(node)
          })
        }
      })
      const start = () => {
        const chat = document.getElementById('chatMessages') || document.body
        obs.observe(chat, { childList: true, subtree: true })
        hydrateAll()
      }
      if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start)
      else start()
    }

    bindThemeSync()
  }

  bind()

  window.InlineVisualizeUI = {
    hydrateAll,
    hydrateCard,
    openInWindow,
    toggleCollapsed,
    applyVisualMeta,
    getKindMeta,
    applyHostThemeToHtml,
    getHostVizTheme,
    broadcastThemeToFrames,
    clearCache: () => cache.clear()
  }
})()
