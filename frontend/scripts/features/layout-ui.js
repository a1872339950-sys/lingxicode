(function () {
  const AUTO_COLLAPSED_ATTR = 'autoCollapsed'

  function markAutoCollapsed(sidebar) {
    if (sidebar) sidebar.dataset[AUTO_COLLAPSED_ATTR] = '1'
  }

  function clearAutoCollapsed(sidebar) {
    if (sidebar) delete sidebar.dataset[AUTO_COLLAPSED_ATTR]
  }

  function wasAutoCollapsed(sidebar) {
    return sidebar?.dataset?.[AUTO_COLLAPSED_ATTR] === '1'
  }

  let layoutSwitchFrame = 0
  function markLayoutSwitching() {
    const root = document.documentElement
    root.classList.add('layout-switching')
    if (layoutSwitchFrame) cancelAnimationFrame(layoutSwitchFrame)
    layoutSwitchFrame = requestAnimationFrame(() => {
      layoutSwitchFrame = requestAnimationFrame(() => {
        layoutSwitchFrame = 0
        root.classList.remove('layout-switching')
      })
    })
  }

  function adjust(elements, hasTabs) {
    const { webviewPanel, center, divider, sidebar, sidebarToggle } = elements
    if (!webviewPanel || !center || !divider || !sidebar) return false

    markLayoutSwitching()
    webviewPanel.style.flex = ''
    center.style.flex = ''

    if (hasTabs) {
      webviewPanel.classList.add('show')
      webviewPanel.classList.remove('shrink')
      center.classList.remove('full', 'shrink', 'max', 'with-toggle')
      center.classList.add('has-webview')
      divider.classList.remove('hidden')
      if (sidebar.classList.contains('expanded')) {
        markAutoCollapsed(sidebar)
        sidebar.classList.remove('expanded')
        sidebarToggle?.classList.add('is-collapsed')
      }
    } else {
      webviewPanel.classList.remove('show', 'shrink')
      divider.classList.add('hidden')
      center.classList.remove('shrink', 'with-toggle', 'has-webview')
      if (wasAutoCollapsed(sidebar)) {
        sidebar.classList.add('expanded')
        sidebarToggle?.classList.remove('is-collapsed')
        clearAutoCollapsed(sidebar)
      }
      center.classList.add('full')
    }

    return sidebar.classList.contains('expanded')
  }

  function collapse(elements, hasTabs) {
    const { webviewPanel, center, sidebar, sidebarToggle } = elements
    if (!webviewPanel || !center || !sidebar) return false

    markLayoutSwitching()
    clearAutoCollapsed(sidebar)
    sidebar.classList.remove('expanded')
    sidebarToggle?.classList.add('is-collapsed')

    if (hasTabs) {
      webviewPanel.classList.remove('shrink')
      center.classList.remove('shrink', 'full', 'max')
      center.classList.add('with-toggle')
    } else {
      center.classList.remove('full')
      center.classList.add('max')
    }

    return false
  }

  function expand(elements, hasTabs) {
    const { webviewPanel, center, sidebar, sidebarToggle } = elements
    if (!webviewPanel || !center || !sidebar) return true

    markLayoutSwitching()
    clearAutoCollapsed(sidebar)
    sidebar.classList.add('expanded')
    sidebarToggle?.classList.remove('is-collapsed')

    if (hasTabs) {
      webviewPanel.classList.add('shrink')
      center.classList.add('shrink')
      center.classList.remove('with-toggle')
    } else {
      center.classList.remove('max')
      center.classList.add('full')
    }

    return true
  }

  function bindSidebarControls(options = {}) {
    const elements = options.elements || {}
    const getHasTabs = options.getHasTabs || function () { return false }
    const setSidebarExpanded = options.setSidebarExpanded || function () {}
    const onAfterToggle = options.onAfterToggle || function () {}
    const { collapseButton, sidebarToggle, sidebar } = elements

    function notifyAfterToggle(expanded) {
      requestAnimationFrame(() => onAfterToggle(expanded))
    }

    if (collapseButton) {
      collapseButton.onclick = () => {
        const expanded = collapse(elements, getHasTabs())
        setSidebarExpanded(expanded)
        notifyAfterToggle(expanded)
      }
    }

    if (sidebarToggle) {
      sidebarToggle.onclick = () => {
        const isExpanded = sidebar?.classList.contains('expanded')
        const expanded = isExpanded ? collapse(elements, getHasTabs()) : expand(elements, getHasTabs())
        sidebarToggle.blur()
        setSidebarExpanded(expanded)
        notifyAfterToggle(expanded)
      }
    }
  }

  function bindDividerDrag(options = {}) {
    const divider = options.divider
    const webviewPanel = options.webviewPanel
    const onResize = options.onResize || function () {}
    const fixedWidth = Number(options.fixedWidth || 0)
    if (!divider || !webviewPanel) return

    let dragging = false
    let startX = 0
    let startLeftW = 0
    let pendingWidth = 0
    let resizeFrame = 0

    function emitResize(width) {
      pendingWidth = Math.max(0, Math.round(Number(width) || 0))
      if (resizeFrame) return
      resizeFrame = requestAnimationFrame(() => {
        resizeFrame = 0
        onResize(pendingWidth)
      })
    }

    divider.onmousedown = event => {
      event.preventDefault()
      if (fixedWidth > 0) {
        webviewPanel.style.flex = `0 0 ${fixedWidth}px`
        webviewPanel.style.minWidth = `${fixedWidth}px`
        webviewPanel.style.maxWidth = `${fixedWidth}px`
        emitResize(fixedWidth)
        return
      }
      dragging = true
      startX = event.clientX
      startLeftW = webviewPanel.offsetWidth
    }

    document.onmousemove = event => {
      if (!dragging) return
      const newLeftW = startLeftW + event.clientX - startX
      if (newLeftW > 100 && newLeftW < window.innerWidth - 300) {
        webviewPanel.style.flex = '0 0 ' + newLeftW + 'px'
        emitResize(newLeftW)
      }
    }

    document.onmouseup = () => {
      dragging = false
      emitResize(webviewPanel.offsetWidth || 0)
    }
  }

  window.LayoutUI = { adjust, collapse, expand, bindSidebarControls, bindDividerDrag }
})()
