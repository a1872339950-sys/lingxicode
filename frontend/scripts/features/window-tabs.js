(function () {
  function svgIcon(name, size = 14) {
    const icons = {
      alert: '<path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
      x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>'
    }
    return `<svg class="inline-svg-icon" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">${icons[name] || ''}</svg>`
  }

  function fallbackFileName(path) {
    return (path || '').split(/[\\/]/).pop() || path || ''
  }

  function isModelPath(filePath) {
    return /\.(glb|gltf)$/i.test(String(filePath || ''))
  }

  function isBlendPath(filePath) {
    return /\.blend$/i.test(String(filePath || ''))
  }

  function isAudioPath(filePath) {
    return /\.(mp3|wav|m4a|aac|ogg|oga|flac|opus|weba)$/i.test(String(filePath || ''))
  }

  function isVideoPath(filePath) {
    return /\.(mp4|webm|mov|m4v|mkv|avi|ogv)$/i.test(String(filePath || ''))
  }

  function isHtmlPath(filePath) {
    return /\.(html?|xhtml)$/i.test(String(filePath || ''))
  }

  function isWebAssetPath(filePath) {
    return /\.(css|js|mjs|cjs|jsx|tsx?|json|svg|png|jpe?g|webp|gif|ico|avif|woff2?|ttf|otf)$/i.test(String(filePath || ''))
  }

  function toFileUrl(filePath) {
    if (/^(?:https?:|file:)/i.test(String(filePath || ''))) return String(filePath || '')
    let normalized = String(filePath || '').replace(/\\/g, '/')
    if (!normalized.startsWith('/')) normalized = '/' + normalized
    return 'file://' + encodeURI(normalized)
  }

  const escapeHtml = HtmlUtils.escapeHtml

  function getActionLabel(action) {
    if (action === 'create') return '新增'
    if (action === 'delete') return '删除'
    if (action === 'folder') return '目录'
    return '修改'
  }

  function getActionClass(action) {
    if (action === 'create' || action === 'delete' || action === 'folder') return action
    return 'modify'
  }

  function getPathDirLabel(filePath) {
    const normalized = String(filePath || '').replace(/\\/g, '/')
    const parts = normalized.split('/').filter(Boolean)
    if (parts.length <= 1) return ''
    return parts.slice(0, -1).join('/') + '/'
  }

  function firstCodeFile(files = []) {
    return files.find(file => file && file.path && (file.beforeText || file.afterText)) || files[0] || null
  }

  function bind(options = {}) {
    const tabs = options.tabs || []
    const elements = options.elements || {}
    const layoutUI = options.layoutUI || {}
    const monacoEditors = options.monacoEditors
    const initMonaco = options.initMonaco || async function () {}
    const getMonacoLanguage = options.getMonacoLanguage || function () { return 'plaintext' }
    const getFileName = options.getFileName || fallbackFileName
    const getFileIcon = options.getFileIcon || function () { return '' }
    const getActiveTabId = options.getActiveTabId || function () { return null }
    const setActiveTabId = options.setActiveTabId || function () {}
    const getSidebarExpanded = options.getSidebarExpanded || function () { return true }
    const setSidebarExpanded = options.setSidebarExpanded || function () {}
    const scrollChatToBottom = options.scrollChatToBottom || function () {}
    const showToast = options.showToast || ((message, type = 'info') => window.ToastUI?.show?.(message, type))
    const sendMessage = options.sendMessage || async function () {}
    const getActiveProjectId = options.getActiveProjectId || function () { return '' }
    const getActiveProject = options.getActiveProject || function () { return null }

    function runAfterPaint(callback) {
      const run = () => {
        try {
          callback()
        } catch (error) {
          console.error('[WindowTabs] deferred UI work failed:', error)
        }
      }
      if (typeof window.requestAnimationFrame === 'function') {
        window.requestAnimationFrame(() => window.requestAnimationFrame(run))
      } else {
        setTimeout(run, 0)
      }
    }

    function disposeMonacoEntrySoon(id, editor) {
      if (!editor) return
      monacoEditors.delete(id)
      const dispose = () => {
        try {
          const diffModel = editor.diffEditor?.getModel?.()
          const models = new Set([
            editor.originalModel,
            editor.modifiedModel,
            diffModel?.original,
            diffModel?.modified,
            editor.getModel?.()
          ].filter(Boolean))
          editor.diffEditor?.dispose?.()
          editor.dispose?.()
          models.forEach(model => model.dispose?.())
        } catch (error) {
          console.warn('[WindowTabs] Monaco dispose failed:', error)
        }
      }
      if (typeof window.requestIdleCallback === 'function') {
        window.requestIdleCallback(dispose, { timeout: 1500 })
      } else {
        setTimeout(dispose, 0)
      }
    }

    const {
      tabCountEl,
      webviewPanel,
      center,
      divider1,
      sidebar,
      sidebarToggle,
      webviewContainer,
      webviewTabs,
      webviewEmpty,
      webviewPanelExpand,
      rightViewToggle
    } = elements
    let rightViewHidden = true
    let rightViewHiddenBeforePreview = false
    let workspaceExpandedState = null
    let workspaceExpandedFrame = 0

    function requestWorkspaceExpanded(expanded) {
      const nextState = !!expanded
      if (workspaceExpandedState === nextState) return
      workspaceExpandedState = nextState
      if (workspaceExpandedFrame) return
      const apply = () => {
        workspaceExpandedFrame = 0
        window.api?.setMainWindowWorkspaceExpanded?.(workspaceExpandedState)
      }
      if (typeof window.requestAnimationFrame === 'function') {
        workspaceExpandedFrame = window.requestAnimationFrame(apply)
      } else {
        workspaceExpandedFrame = setTimeout(apply, 0)
      }
    }
    function updateEmptyStateVisibility(hasContent) {
      if (webviewEmpty) webviewEmpty.classList.toggle('hidden', !!hasContent)
    }

    // ── 浏览器导航条（地址栏 / 前进后退刷新）──
    const browserNavEl = document.getElementById('webviewBrowserNav')
    const browserNavBack = document.getElementById('webviewNavBack')
    const browserNavForward = document.getElementById('webviewNavForward')
    const browserNavReload = document.getElementById('webviewNavReload')
    const browserNavOpenExternal = document.getElementById('webviewNavOpenExternal')
    const browserNavForm = document.getElementById('webviewNavForm')
    const browserNavInput = document.getElementById('webviewNavInput')
    let browserNavBound = false

    function isBrowserAddressTab(tab) {
      return !!(tab && !tab.detached && tab.type === 'webview' && tab.webview)
    }

    function resolveBrowserNavigateInput(raw = '') {
      const input = String(raw || '').trim()
      if (!input) return ''
      if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(input)) return input
      if (/^localhost(?::\d+)?(?:[/?#].*)?$/i.test(input)) return `http://${input}`
      if (/^\d{1,3}(?:\.\d{1,3}){3}(?::\d+)?(?:[/?#].*)?$/.test(input)) return `http://${input}`
      if (/^[\w-]+(\.[\w-]+)+(?::\d+)?(?:[/?#].*)?$/.test(input)) return `https://${input}`
      return `https://www.baidu.com/s?wd=${encodeURIComponent(input)}`
    }

    function getActiveBrowserTab() {
      const id = getActiveTabId()
      if (id == null) return null
      const tab = tabs.find(t => t.id === id)
      return isBrowserAddressTab(tab) ? tab : null
    }

    function syncBrowserNav(tab = getActiveBrowserTab()) {
      const show = isBrowserAddressTab(tab)
      if (browserNavEl) browserNavEl.hidden = !show
      if (!show) {
        if (browserNavBack) browserNavBack.disabled = true
        if (browserNavForward) browserNavForward.disabled = true
        if (browserNavReload) browserNavReload.disabled = true
        if (browserNavOpenExternal) browserNavOpenExternal.disabled = true
        return
      }
      const webview = tab.webview
      let url = tab.url || ''
      try {
        if (typeof webview.getURL === 'function') {
          const live = String(webview.getURL() || '').trim()
          if (live && live !== 'about:blank') url = live
        }
      } catch (_) { /* guest not ready */ }
      if (!url) url = String(webview.getAttribute?.('src') || webview.src || '').trim()
      tab.url = url
      if (browserNavInput && document.activeElement !== browserNavInput) {
        browserNavInput.value = url
      }
      let canBack = false
      let canForward = false
      try { canBack = !!webview.canGoBack?.() } catch (_) { canBack = false }
      try { canForward = !!webview.canGoForward?.() } catch (_) { canForward = false }
      if (browserNavBack) browserNavBack.disabled = !canBack
      if (browserNavForward) browserNavForward.disabled = !canForward
      if (browserNavReload) browserNavReload.disabled = false
      if (browserNavOpenExternal) browserNavOpenExternal.disabled = !url
      // 同步书签按钮状态
      try {
        const title = tab.title || ''
        let favicon = ''
        try {
          if (typeof webview.getFavicon === 'function') favicon = webview.getFavicon() || ''
        } catch (_) { /* ignore */ }
        window.BookmarksUI?.setCurrentUrl?.(url, title, favicon)
        window.BookmarksUI?.setListButtonEnabled?.(true)
      } catch (_) { /* ignore */ }
    }

    function navigateActiveBrowser(rawInput) {
      const tab = getActiveBrowserTab()
      if (!tab?.webview) return
      const target = resolveBrowserNavigateInput(rawInput)
      if (!target) return
      tab.url = target
      if (browserNavInput) browserNavInput.value = target
      try {
        if (typeof tab.webview.loadURL === 'function') tab.webview.loadURL(target)
        else tab.webview.src = target
      } catch (error) {
        console.warn('[WindowTabs] navigate failed:', error)
        try { tab.webview.src = target } catch (_) { /* ignore */ }
      }
      syncBrowserNav(tab)
    }

    function pickBrowserProfile(browsers) {
      return new Promise((resolve) => {
        // 单浏览器单 Profile：直接返回
        if (browsers.length === 1 && browsers[0].profiles.length === 1) {
          const b = browsers[0]
          const p = b.profiles[0]
          resolve({ browserId: b.browserId, displayName: b.displayName, profileName: p.profileName, profileLabel: p.label })
          return
        }

        const overlay = document.createElement('div')
        overlay.style.cssText = [
          'position:fixed', 'inset:0', 'z-index:99999',
          'background:rgba(15,23,42,.45)', 'backdrop-filter:blur(4px)',
          'display:flex', 'align-items:center', 'justify-content:center',
          'font-family:inherit'
        ].join(';')

        const card = document.createElement('div')
        card.style.cssText = [
          'width:420px', 'max-width:90vw', 'max-height:80vh', 'overflow:auto',
          'background:#fff', 'border-radius:14px', 'padding:20px',
          'box-shadow:0 24px 60px rgba(15,23,42,.28)'
        ].join(';')

        const title = document.createElement('div')
        title.textContent = '选择导入来源'
        title.style.cssText = 'font-size:16px;font-weight:600;color:#0f172a;margin-bottom:4px'
        card.appendChild(title)

        const hint = document.createElement('div')
        hint.textContent = '从下列本机浏览器中选择一个配置进行导入'
        hint.style.cssText = 'font-size:12px;color:#64748b;margin-bottom:14px'
        card.appendChild(hint)

        const list = document.createElement('div')
        list.style.cssText = 'display:flex;flex-direction:column;gap:6px'

        browsers.forEach((b) => {
          b.profiles.forEach((p) => {
            const item = document.createElement('button')
            item.type = 'button'
            item.style.cssText = [
              'display:flex', 'align-items:center', 'gap:10px',
              'padding:10px 12px', 'border:1px solid #e2e8f0', 'border-radius:10px',
              'background:#fff', 'cursor:pointer', 'text-align:left',
              'transition:all .15s'
            ].join(';')

            const dot = document.createElement('span')
            dot.style.cssText = 'width:8px;height:8px;border-radius:50%;background:#2563eb;flex-shrink:0'
            item.appendChild(dot)

            const text = document.createElement('div')
            text.style.cssText = 'flex:1;min-width:0'

            const name = document.createElement('div')
            name.textContent = b.displayName
            name.style.cssText = 'font-size:13px;font-weight:600;color:#0f172a'
            text.appendChild(name)

            const sub = document.createElement('div')
            sub.textContent = p.label
            sub.style.cssText = 'font-size:11px;color:#64748b;margin-top:2px'
            text.appendChild(sub)

            item.appendChild(text)

            item.addEventListener('mouseenter', () => {
              item.style.background = '#f1f5f9'
              item.style.borderColor = '#2563eb'
            })
            item.addEventListener('mouseleave', () => {
              item.style.background = '#fff'
              item.style.borderColor = '#e2e8f0'
            })
            item.addEventListener('click', () => {
              overlay.remove()
              resolve({ browserId: b.browserId, displayName: b.displayName, profileName: p.profileName, profileLabel: p.label })
            })

            list.appendChild(item)
          })
        })
        card.appendChild(list)

        const cancel = document.createElement('button')
        cancel.type = 'button'
        cancel.textContent = '取消'
        cancel.style.cssText = 'margin-top:14px;width:100%;padding:9px;border:1px solid #e2e8f0;border-radius:8px;background:#f8fafc;cursor:pointer;font-size:13px;color:#475569'
        cancel.addEventListener('click', () => { overlay.remove(); resolve(null) })
        card.appendChild(cancel)

        overlay.appendChild(card)
        overlay.addEventListener('click', (e) => {
          if (e.target === overlay) { overlay.remove(); resolve(null) }
        })

        document.body.appendChild(overlay)
      })
    }

    function bindBrowserNavOnce() {
      if (browserNavBound) return
      browserNavBound = true
      browserNavBack?.addEventListener('click', () => {
        const tab = getActiveBrowserTab()
        try { tab?.webview?.goBack?.() } catch (_) { /* ignore */ }
        setTimeout(() => syncBrowserNav(tab), 50)
      })
      browserNavForward?.addEventListener('click', () => {
        const tab = getActiveBrowserTab()
        try { tab?.webview?.goForward?.() } catch (_) { /* ignore */ }
        setTimeout(() => syncBrowserNav(tab), 50)
      })
      browserNavReload?.addEventListener('click', () => {
        const tab = getActiveBrowserTab()
        try { tab?.webview?.reload?.() } catch (_) { /* ignore */ }
      })
      // 在外部浏览器中打开当前页面
      browserNavOpenExternal?.addEventListener('click', () => {
        const tab = getActiveBrowserTab()
        const url = tab?.webview?.getURL?.() || tab?.url || ''
        if (!url) return
        window.api?.openExternal?.(url).then(result => {
          if (!result?.success) showToast?.(result?.error || '无法打开外部浏览器', 'error')
        }).catch(e => showToast?.(e?.message || '打开失败', 'error'))
      })
      // 从本机任意 Chromium 类浏览器导入登录 Cookie 到右侧 webview
      document.getElementById('webviewNavImportChrome')?.addEventListener('click', async () => {
        if (!window.api?.importGoogleCookiesFromChrome || !window.api?.listBrowserProfiles) {
          showToast?.('当前版本不支持从本机浏览器导入登录状态', 'error')
          return
        }
        const btn = document.getElementById('webviewNavImportChrome')
        if (btn) btn.disabled = true
        try {
          // 1. 拉取本机可用浏览器列表
          const listResult = await window.api.listBrowserProfiles()
          const browsers = Array.isArray(listResult?.browsers) ? listResult.browsers : []
          if (!browsers.length) {
            showToast?.('未找到本机 Chromium 类浏览器（Chrome/Edge/QQ/夸克等）', 'error')
            return
          }

          // 2. 让用户选择浏览器 + Profile
          const choice = await pickBrowserProfile(browsers)
          if (!choice) { return } // 用户取消

          // 3. 调用导入（默认追加模式）
          showToast?.(`正在从 ${choice.displayName}（${choice.profileLabel}）导入登录状态…`, 'info')
          const result = await window.api.importGoogleCookiesFromChrome({
            browserId: choice.browserId,
            profileName: choice.profileName,
            importMode: 'append'
          })
          if (!result?.success) {
            showToast?.(result?.error || '导入失败', 'error')
            return
          }
          showToast?.(result.message || `已导入 ${result.imported} 条登录 Cookie`, 'success')
          // 刷新当前页，使导入的登录状态生效
          const tab = getActiveBrowserTab()
          try { tab?.webview?.reload?.() } catch (_) { /* ignore */ }
        } catch (error) {          showToast?.(error?.message || '导入失败', 'error')
        } finally {
          if (btn) btn.disabled = false
        }
      })
      browserNavForm?.addEventListener('submit', (event) => {
        event.preventDefault()
        navigateActiveBrowser(browserNavInput?.value || '')
        browserNavInput?.blur?.()
      })
      browserNavInput?.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
          syncBrowserNav()
          browserNavInput.blur()
        }
      })
    }

    bindBrowserNavOnce()

    // 初始化书签 UI 模块
    try {
      window.BookmarksUI?.init?.({
        onNavigate: (url) => {
          if (!url) return
          const tab = getActiveBrowserTab()
          if (!tab?.webview) return
          try {
            if (typeof tab.webview.loadURL === 'function') tab.webview.loadURL(url)
            else tab.webview.src = url
          } catch (_) { /* ignore */ }
        },
        onOpenInNewTab: (url) => {
          if (!url) return
          openInNewTab(url)
        },
        showToast: (message, type) => {
          if (typeof showToast === 'function') showToast(message, type)
        }
      })
    } catch (_) { /* ignore */ }

    function isWebviewExpanded() {
      return !!(webviewPanel && webviewPanel.classList.contains('expand-left'))
    }

    function hasEmbeddedTabs() {
      return tabs.some(t => !t.detached && !t.hidden)
    }

    function hasRightPanelContent() {
      return hasEmbeddedTabs()
    }

    function hasManualToggleContent() {
      if (tabs.some(t => !t.detached && !t.hidden && (t.type !== 'collaboration' || t.temporaryExecution))) return true
      return false
    }

    function updateRightViewToggleState() {
      if (!rightViewToggle) return
      const hasContent = hasRightPanelContent()
      rightViewToggle.disabled = !hasContent
      rightViewToggle.classList.toggle('is-hidden', rightViewHidden)
      rightViewToggle.title = rightViewHidden ? '显示右侧视图' : '隐藏右侧视图'
      rightViewToggle.setAttribute('aria-label', rightViewHidden ? 'show right panel' : 'hide right panel')
      // 右侧视图隐藏时，在按钮上显示标签页数量角标
      const badge = document.getElementById('rightViewBadge')
      if (badge) {
        const count = tabs.filter(t => !t.detached).length
        if (rightViewHidden && count > 0) {
          badge.textContent = String(count)
          badge.hidden = false
        } else {
          badge.hidden = true
        }
      }
    }

    function syncSidebarAfterRightViewHidden() {
      if (!sidebar) return
      sidebar.classList.remove('hidden')
      const expanded = sidebar.classList.contains('expanded')
      sidebarToggle?.classList.toggle('is-collapsed', !expanded)
      setSidebarExpanded(expanded)
    }

    function syncContextCompressionStackWithRightView() {
      window.ContextCompressionStack?.setTemporaryHidden?.(!rightViewHidden)
    }

    function applyRightViewVisibility() {
      if (!webviewPanel || !center) return
      webviewPanel.classList.toggle('right-view-hidden', rightViewHidden)
      sidebar?.classList.toggle('right-view-roomy', rightViewHidden)
      if (rightViewHidden) {
        webviewPanel.classList.remove('show', 'shrink', 'expand-left')
        center.classList.remove('shrink', 'wide-view-mode', 'with-toggle', 'max')
        center.classList.add('full', 'right-view-fill')
        syncSidebarAfterRightViewHidden()
        if (divider1) divider1.classList.add('hidden')
        requestWorkspaceExpanded(false)
      } else {
        // 不再要求 hasRightPanelContent，按钮控制显隐；空内容时由 #webviewEmpty 占位
        webviewPanel.classList.add('show')
        center.classList.remove('full', 'max', 'with-toggle', 'right-view-fill')
        center.classList.toggle('shrink', getSidebarExpanded())
        if (divider1) divider1.classList.remove('hidden')
        // 面板可见时保留内部布局变化；外部窗口尺寸请求做去重合并，避免重复 resize 卡顿。
        requestWorkspaceExpanded(true)
      }
      syncContextCompressionStackWithRightView()
      updateExpandButtonState()
      updateRightViewToggleState()
      updateTabCount()
      updateEmptyStateVisibility(hasRightPanelContent())
    }

    function syncRightViewLayout() {
      if (rightViewHidden) {
        applyRightViewVisibility()
      }
    }

    function showRightViewForContent() {
      if (!rightViewHidden) return
      AppLogger.debug('[RightView] showRightViewForContent: 面板从收起→展开, rightViewHiddenBeforePreview → true')
      rightViewHiddenBeforePreview = true
      rightViewHidden = false
      applyRightViewVisibility()
    }

    function hideRightView() {
      if (rightViewHidden) return
      AppLogger.debug('[RightView] hideRightView: 面板从展开→收起, rightViewHiddenBeforePreview → false')
      rightViewHiddenBeforePreview = false
      rightViewHidden = true
      applyRightViewVisibility()
    }

    function toggleRightView() {
      const hasContent = hasRightPanelContent()
      if (!hasContent) {
        rightViewHidden = true
        applyRightViewVisibility()
        return
      }
      if (isWebviewExpanded()) {
        webviewPanel.classList.remove('expand-left')
        center.classList.remove('chat-hidden', 'wide-view-mode', 'shrink', 'with-toggle')
        rightViewHidden = true
        applyRightViewVisibility()
        scrollChatToBottom()
        return
      }
      const wasHidden = rightViewHidden
      rightViewHidden = !rightViewHidden
      applyRightViewVisibility()
      if (wasHidden && !rightViewHidden) adjustLayout(hasContent)
    }

    function updateExpandButtonState() {
      if (!webviewPanelExpand) return
      webviewPanelExpand.disabled = !isWebviewExpanded() && !hasManualToggleContent()
      webviewPanelExpand.classList.toggle('is-expanded', isWebviewExpanded())
      if (isWebviewExpanded()) {
        webviewPanelExpand.setAttribute('data-i18n-title', 'auto.l262.title')
        webviewPanelExpand.title = (window.i18n?.t?.('auto.l262.title') ?? '恢复默认大小')
        webviewPanelExpand.setAttribute('aria-label', 'collapse')
      } else {
        webviewPanelExpand.setAttribute('data-i18n-title', 'auto.l261.title')
        webviewPanelExpand.title = (window.i18n?.t?.('auto.l261.title') ?? '向左扩展（隐藏聊天区域）')
        webviewPanelExpand.setAttribute('aria-label', 'expand')
      }
    }

    if (rightViewToggle) {
      rightViewToggle.onclick = toggleRightView
      updateRightViewToggleState()
    }

    function toggleExpandLeft() {
      if (!webviewPanel || !center) return
      const hasEmbedded = hasRightPanelContent()
      if (!hasManualToggleContent() && !isWebviewExpanded()) return
      if (rightViewHidden) {
        rightViewHidden = false
        applyRightViewVisibility()
      }
      if (isWebviewExpanded()) {
        webviewPanel.classList.remove('expand-left')
        sidebar?.classList.remove('hidden')
        center.classList.remove('chat-hidden', 'wide-view-mode', 'full', 'max')
        if (divider1) divider1.classList.remove('hidden')
        scrollChatToBottom()
        const hasTabs = hasEmbedded
        if (hasTabs) {
          if (getSidebarExpanded()) {
            webviewPanel.classList.add('shrink')
            center.classList.add('shrink')
          } else {
            webviewPanel.classList.remove('shrink')
            center.classList.remove('shrink')
          }
        }
      } else {
        webviewPanel.classList.remove('shrink')
        sidebar?.classList.add('hidden')
        center.classList.remove('with-toggle', 'shrink', 'full', 'max')
        center.classList.add('chat-hidden')
        webviewPanel.classList.add('expand-left')
        if (divider1) divider1.classList.add('hidden')
      }
      updateExpandButtonState()
    }

    if (webviewPanelExpand) {
      webviewPanelExpand.onclick = toggleExpandLeft
    }

    function updateTabCount() {
      const embeddedCount = tabs.filter(t => !t.detached).length
      if (tabCountEl) tabCountEl.textContent = embeddedCount + ((window.i18n?.t?.('auto.js_window_tabs_76_1') ?? '个窗口'))
      updateExpandButtonState()
      updateRightViewToggleState()
    }

    // adjustLayout 加了一层 rAF + last-write 合并：同帧内多次
    // adjustLayout(true/false) 只保留最后一次，下一帧只执行一次完整布局重算。
    // 14+ 个内部调用点（创建标签、关闭标签、嵌入文件等）原本一帧内连发，
    // 现在折叠成单次 layout 重排，规避 mount/unmount 风暴触发的 reflow thrash。
    let _pendingLayoutHasTabs = null
    let _layoutRafId = null
    function adjustLayout(hasTabs) {
      _pendingLayoutHasTabs = hasTabs
      if (_layoutRafId !== null) return
      _layoutRafId = requestAnimationFrame(() => {
        _layoutRafId = null
        const finalHasTabs = _pendingLayoutHasTabs
        _pendingLayoutHasTabs = null
        _applyAdjustLayout(finalHasTabs)
      })
    }

    function _applyAdjustLayout(hasTabs) {
      if (rightViewHidden && hasTabs) {
        applyRightViewVisibility()
        return getSidebarExpanded()
      }
      requestWorkspaceExpanded(hasTabs || !rightViewHidden)
      if (isWebviewExpanded()) {
        if (!hasTabs) {
          webviewPanel.classList.remove('expand-left')
          center.classList.remove('chat-hidden', 'wide-view-mode')
          sidebar?.classList.remove('hidden')
          webviewPanel.classList.remove('show', 'shrink')
          center.classList.remove('shrink', 'with-toggle')
          if (divider1) divider1.classList.remove('hidden')
        }
        updateExpandButtonState()
        return getSidebarExpanded()
      }
      const expanded = layoutUI.adjust?.({
        webviewPanel,
        center,
        divider: divider1,
        sidebar,
        sidebarToggle
      }, hasTabs)
      // layoutUI.adjust 会移除 show 类；若右侧面板可见则恢复
      if (!rightViewHidden && !hasTabs) {
        webviewPanel.classList.add('show')
        center.classList.remove('full')
        center.classList.toggle('shrink', getSidebarExpanded())
        if (divider1) divider1.classList.remove('hidden')
      }
      setSidebarExpanded(expanded)
      updateExpandButtonState()
      return expanded
    }

    function createTab(url) {
      const id = Date.now()
      const tab = { id, url, title: url, webview: null, detached: false, detachedEl: null, type: 'webview' }
      tabs.push(tab)

      createEmbeddedTab(id, url)
      adjustLayout(true)

      updateTabCount()
      return tab
    }

    async function showTabItemInFolder(id) {
      const tab = tabs.find(t => t.id === id)
      if (!tab?.path) return
      const opener = window.api?.showItemInFolder || window.api?.openProjectFolder
      if (!opener) return
      try {
        const result = await opener(tab.path)
        if (result?.error) showToast(result.error, 'error')
      } catch (error) {
        showToast(error.message || String(error), 'error')
      }
    }

    function createFileTab(path, content, wasRunning = false, options = {}) {
      if (isModelPath(path)) return createModelTab(path)
      if (isBlendPath(path)) return createBlendInfoTab(path)
      if (isAudioPath(path)) return createMediaTab(path, 'audio', options)
      if (isVideoPath(path)) return createMediaTab(path, 'video', options)

      // 同路径已开标签时直接复用，避免重复读文件/重建 Monaco 导致越用越卡
      const existing = getFileTabByPath(path)
      if (existing) {
        if (options.loading) {
          existing.loading = true
          setFileTabStatus(existing.id, options.statusText || '加载中...', 'loading')
        } else if (content != null) {
          existing.loading = false
          updateFileTabContent(existing, content, {
            statusText: options.statusText || (wasRunning ? '运行中' : '已加载')
          })
        } else if (options.statusText) {
          setFileTabStatus(existing.id, options.statusText, options.statusClass || 'saved')
        }
        if (wasRunning && existing.isHtml) setHtmlTabRunning(existing, true)
        switchTab(existing.id)
        adjustLayout(true)
        return existing
      }

      const id = Date.now()
      const fileName = getFileName(path)
      const tab = {
        id,
        path,
        title: fileName,
        content: content == null ? '' : content,
        type: 'file',
        modified: false,
        loading: !!options.loading
      }
      tabs.push(tab)

      createEmbeddedFileTab(id, path, tab.content, wasRunning, {
        deferEditor: !!options.loading || options.deferEditor === true,
        statusText: options.statusText || (options.loading ? '加载中...' : (wasRunning ? '运行中' : '已加载')),
        statusClass: options.statusClass || (options.loading ? 'loading' : 'saved')
      })
      adjustLayout(true)

      updateTabCount()
      return tab
    }

    function normalizePathKey(filePath = '') {
      return String(filePath || '').replace(/\\/g, '/').replace(/\/+/g, '/').toLowerCase()
    }

    function getFileTabByPath(filePath = '') {
      const key = normalizePathKey(filePath)
      if (!key) return null
      return tabs.find(t => t.type === 'file' && normalizePathKey(t.path) === key) || null
    }

    function getToolFilePath(args = {}, result = {}) {
      return result.path ||
        result.filePath ||
        result.file_path ||
        args.path ||
        args.filePath ||
        args.file_path ||
        args.outputPath ||
        args.output_path ||
        ''
    }

    function getWriteContentFromTool(name = '', args = {}) {
      if (name === 'write_file') return args.content || args.svg_content || ''
      if (name === 'edit_file') return args.new_content || args.new_string || args.new || args.content || ''
      return ''
    }

    function toBustedFileUrl(filePath = '') {
      const base = toFileUrl(filePath)
      return `${base}${base.includes('?') ? '&' : '?'}t=${Date.now()}`
    }

    function setFileTabStatus(id, text, className = 'saved') {
      const statusEl = document.querySelector(`#fileview-${id} .file-view-status`)
      if (!statusEl) return
      statusEl.textContent = text
      statusEl.className = `file-view-status ${className}`
    }

    function updateFileTabContent(tab, content = '', options = {}) {
      if (!tab || tab.type !== 'file') return
      const nextContent = String(content || '')
      tab.content = nextContent
      tab.loading = false
      const editor = monacoEditors.get(tab.id)
      if (editor) {
        if (editor.getValue() !== nextContent) editor.setValue(nextContent)
      } else if (tab.fileContainer && options.ensureEditor !== false) {
        // 先开空壳后补内容时，延迟创建 Monaco，避免点击瞬间卡主线程
        ensureFileTabEditor(tab)
      }
      tab.modified = false
      if (options.statusText) {
        setFileTabStatus(tab.id, options.statusText, options.statusClass || 'saved')
        return
      }
      setFileTabStatus(tab.id, '实时预览', 'saved')
    }

    function ensureFileTabEditor(tab) {
      if (!tab || tab.type !== 'file' || monacoEditors.get(tab.id)) return
      const id = tab.id
      const language = getMonacoLanguage(getFileName(tab.path || ''))
      const schedule = (fn) => {
        if (typeof window.requestIdleCallback === 'function') {
          window.requestIdleCallback(fn, { timeout: 120 })
        } else {
          setTimeout(fn, 0)
        }
      }
      schedule(() => {
        if (!tabs.find(t => t.id === id)) return
        initMonaco().then((ok) => {
          if (!ok || !tabs.find(t => t.id === id) || monacoEditors.get(id)) return
          const monacoContainer = document.getElementById('monaco-' + id)
          if (!monacoContainer || !window.monaco?.editor) return

          const editor = monaco.editor.create(monacoContainer, {
            value: String(tab.content || ''),
            language: language,
            theme: 'lingxi-dark',
            lineNumbers: 'on',
            minimap: { enabled: false },
            fontSize: 13,
            fontFamily: "'SF Mono', 'JetBrains Mono', 'Consolas', monospace",
            automaticLayout: true,
            scrollBeyondLastLine: false,
            renderWhitespace: 'selection',
            bracketPairColorization: { enabled: true },
          })

          monacoEditors.set(id, editor)
          editor.onDidChangeModelContent(() => {
            markFileModified(id)
          })

          monaco.editor.onDidChangeMarkers(() => {
            const markers = monaco.editor.getModelMarkers({ resource: editor.getModel()?.uri })
            const errorPanel = document.getElementById('errorpanel-' + id)
            if (!errorPanel) return

            const allErrors = markers.filter(m => m.severity === monaco.MarkerSeverity.Error)
            const errors = allErrors.filter(marker => !isCssHasSelectorCompatMarker(marker, editor.getModel(), language))
            if (errors.length > 0) {
              errorPanel.classList.add('show')
              errorPanel.innerHTML = `<button class="file-view-error-jump" type="button" title="点击定位到第 ${errors[0].startLineNumber} 行">${svgIcon('alert', 14)} 行 ${errors[0].startLineNumber}: ${escapeHtml(errors[0].message)}</button>`
              errorPanel.querySelector('.file-view-error-jump')?.addEventListener('click', () => {
                const marker = errors[0]
                editor.revealLineInCenter(marker.startLineNumber)
                editor.setSelection({
                  startLineNumber: marker.startLineNumber,
                  startColumn: marker.startColumn || 1,
                  endLineNumber: marker.endLineNumber || marker.startLineNumber,
                  endColumn: marker.endColumn || (marker.startColumn || 1) + 1
                })
                editor.focus()
              })
            } else if (allErrors.length > 0) {
              errorPanel.classList.add('show')
              errorPanel.innerHTML = '<span class="file-view-error-muted">仅发现 CSS :has() 兼容性误报，已忽略</span>'
            } else {
              errorPanel.classList.remove('show')
            }
          })

          AppLogger.debug('[Frontend] Monaco Editor 延迟创建完成:', getFileName(tab.path || ''), '语言:', language)
        })
      })
    }

    function setHtmlTabRunning(tab, shouldRun = true, options = {}) {
      if (!tab || tab.type !== 'file' || !tab.isHtml) return
      const id = tab.id
      const editorEl = document.getElementById('editor-' + id)
      const iframeEl = document.getElementById('webview-' + id)
      const runBtn = document.getElementById('runbtn-' + id)
      if (!iframeEl) return

      tab.isRunning = !!shouldRun
      if (tab.isRunning) {
        if (editorEl) editorEl.style.display = 'none'
        iframeEl.style.display = 'block'
        iframeEl.src = options.reload === false ? toFileUrl(tab.path) : toBustedFileUrl(tab.path)
        if (runBtn) {
          runBtn.classList.add('active')
          runBtn.textContent = '■'
          runBtn.title = '返回编辑'
        }
        setFileTabStatus(id, options.statusText || '实时预览', 'saved')
      } else {
        if (editorEl) editorEl.style.display = 'block'
        iframeEl.style.display = 'none'
        if (runBtn) {
          runBtn.classList.remove('active')
          runBtn.innerHTML = '<svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor" aria-hidden="true"><polygon points="2,1 9,5 2,9"/></svg>'
          runBtn.title = '运行HTML'
        }
        setFileTabStatus(id, tab.modified ? '编辑中' : '已保存', tab.modified ? 'editing' : 'saved')
      }
    }

    async function readFileTextForPreview(filePath = '') {
      if (!window.api?.readFileContent || !filePath) return ''
      try {
        const result = await window.api.readFileContent(filePath)
        if (result?.success && !result.isDirectory && result.file_type !== 'directory') return result.content || ''
      } catch (error) {
        console.warn('[LivePreview] read file failed:', error)
      }
      return ''
    }

    function refreshRunningHtmlPreviews(changedPath = '', options = {}) {
      const projectKey = normalizePathKey(options.projectPath || '')
      const changedKey = normalizePathKey(changedPath)
      let refreshed = false
      tabs.forEach(tab => {
        if (tab.type !== 'file' || !tab.isHtml || !tab.isRunning || !tab.path) return
        const tabKey = normalizePathKey(tab.path)
        if (projectKey && (!tabKey.startsWith(projectKey) || !changedKey.startsWith(projectKey))) return
        const iframeEl = document.getElementById('webview-' + tab.id)
        if (!iframeEl) return
        iframeEl.src = toBustedFileUrl(tab.path)
        setFileTabStatus(tab.id, '资源已刷新', 'saved')
        refreshed = true
      })
      return refreshed
    }

    async function openLiveHtmlPreview(filePath = '', content = '') {
      if (!filePath) return null
      let tab = getFileTabByPath(filePath)
      let nextContent = String(content || '')
      if (!nextContent) nextContent = await readFileTextForPreview(filePath)

      if (tab) {
        updateFileTabContent(tab, nextContent)
        setHtmlTabRunning(tab, true, { statusText: '实时预览' })
        switchTab(tab.id)
        return tab
      }

      tab = createFileTab(filePath, nextContent, true)
      if (tab) {
        setHtmlTabRunning(tab, true, { statusText: '实时预览' })
        switchTab(tab.id)
      }
      return tab
    }

    async function refreshExistingHtmlPreview(filePath = '', content = '') {
      if (!filePath) return false
      const tab = getFileTabByPath(filePath)
      if (!tab || tab.type !== 'file' || !tab.isHtml) return false

      let nextContent = String(content || '')
      if (!nextContent) nextContent = await readFileTextForPreview(filePath)
      if (nextContent) {
        updateFileTabContent(tab, nextContent, {
          statusText: tab.isRunning ? '资源已刷新' : '已更新'
        })
      }
      if (!tab.isRunning) return false

      setHtmlTabRunning(tab, true, { statusText: '资源已刷新' })
      return true
    }

    async function handleLivePreviewToolResult(data = {}, options = {}) {
      const name = data.name || ''
      if (!['write_file', 'edit_file'].includes(name)) return false
      const result = data.result || {}
      if (result.error || result.success === false) return false
      const args = data.args || {}
      const filePath = getToolFilePath(args, result)
      if (!filePath) return false

      if (isHtmlPath(filePath)) {
        return refreshExistingHtmlPreview(filePath, getWriteContentFromTool(name, args))
      }

      if (isWebAssetPath(filePath)) {
        return refreshRunningHtmlPreviews(filePath, options)
      }
      return false
    }

    function resolveChangeDiffSelectedIndex(files = [], detail = {}) {
      const list = Array.isArray(files) ? files : []
      if (!list.length) return 0
      if (Number.isFinite(detail.selectedIndex)) {
        return Math.max(0, Math.min(list.length - 1, Number(detail.selectedIndex)))
      }
      const selectedPath = String(detail.selectedPath || '').trim()
      if (selectedPath) {
        const normalize = value => String(value || '').replace(/\\/g, '/').replace(/\/+/g, '/').toLowerCase()
        const target = normalize(selectedPath)
        const index = list.findIndex(file => {
          const current = normalize(file?.path || '')
          return current === target || current.endsWith('/' + target) || target.endsWith('/' + current)
        })
        if (index >= 0) return index
      }
      return 0
    }

    function createChangeDiffTab(detail = {}) {
      const title = detail.title || 'AI 本轮改动'
      const files = Array.isArray(detail.files) ? detail.files : []
      const selectedIndex = resolveChangeDiffSelectedIndex(files, detail)
      const existing = tabs.find(t => t.type === 'changeDiff' && !t.detached)
      if (existing) {
        existing.title = title
        existing.files = files
        existing.summary = detail.summary || {}
        existing.selectedIndex = selectedIndex
        disposeMonacoEntrySoon(existing.id, monacoEditors.get(existing.id))
        if (existing.markerDisposable?.dispose) existing.markerDisposable.dispose()
        if (existing.fileContainer) existing.fileContainer.remove()
        createEmbeddedChangeDiffTab(existing.id)
        switchTab(existing.id)
        return existing
      }

      const id = Date.now()
      const tab = {
        id,
        title,
        path: title + '.diff',
        type: 'changeDiff',
        files,
        summary: detail.summary || {},
        selectedIndex,
        modified: false
      }
      tabs.push(tab)
      createEmbeddedChangeDiffTab(id)
      adjustLayout(true)
      updateTabCount()
      return tab
    }

    function buildChangeDiffFallbackHtml(file, files = [], reason = '') {
      if (!file && !files.length) {
        return `
          <div class="change-diff-fallback">
            <div class="change-diff-fallback-title">No diff content available</div>
            <div class="change-diff-fallback-note">This change record did not include file text snapshots.</div>
          </div>
        `
      }

      const beforeText = String(file?.beforeText || '')
      const afterText = String(file?.afterText || '')
      const hasText = beforeText || afterText
      const summaryOnly = /过大|过多|仅显示变更统计/i.test(String(reason || ''))
      const rows = files.map(item => `
        <div class="change-diff-fallback-file">
          <span>${escapeHtml(getFileName(item.path || '') || item.path || 'unnamed file')}</span>
          <strong>+${Number(item.added) || 0} / -${Number(item.removed) || 0}</strong>
        </div>
      `).join('')

      if (!hasText) {
        return `
          <div class="change-diff-fallback">
            <div class="change-diff-fallback-title">${escapeHtml(reason || 'Diff text is not available')}</div>
            <div class="change-diff-fallback-note">The selected file was recorded as a summary only. This can happen for apply_patch, command changes, large files, binary files, or recovery-session summaries.</div>
            <div class="change-diff-fallback-list">${rows}</div>
          </div>
        `
      }

      return `
        <div class="change-diff-fallback">
          <div class="change-diff-fallback-title">${escapeHtml(reason || 'Text fallback')}</div>
          <div class="change-diff-fallback-note">Monaco editor is unavailable, so the raw before/after text is shown here.</div>
          <div class="change-diff-fallback-grid">
            <section class="before">
              <h4>改前</h4>
              <pre>${escapeHtml(beforeText || '(empty)')}</pre>
            </section>
            <section class="after">
              <h4>改后</h4>
              <pre>${escapeHtml(afterText || '(empty)')}</pre>
            </section>
          </div>
        </div>
      `
    }

    function renderChangeDiffFallback(id, file, files, reason) {
      const diffContainer = document.getElementById('changediff-' + id)
      if (!diffContainer) return
      diffContainer.innerHTML = buildChangeDiffFallbackHtml(file, files, reason)
    }

    function createMediaTab(path, mediaType, options = {}) {
      const existing = tabs.find(t => t.type === 'media' && t.path === path && !t.detached)
      if (existing) {
        switchTab(existing.id)
        return existing
      }
      const id = Date.now()
      const fileName = getFileName(path)
      const tab = { id, path, title: fileName, type: 'media', mediaType, detached: false, mediaState: options.mediaState || null, mediaSource: options.mediaSource || null }
      tabs.push(tab)

      createEmbeddedMediaTab(id, path, mediaType)
      adjustLayout(true)

      updateTabCount()
      return tab
    }

    function readMediaState(id) {
      const player = document.querySelector(`#fileview-${id} .media-preview-player`)
      if (!player) return null
      return {
        currentTime: Number(player.currentTime) || 0,
        paused: !!player.paused,
        volume: Number(player.volume),
        playbackRate: Number(player.playbackRate) || 1
      }
    }

    function applyMediaState(id, mediaState = {}) {
      if (!mediaState || typeof mediaState !== 'object') return
      const player = document.querySelector(`#fileview-${id} .media-preview-player`)
      if (!player) return
      const restore = () => {
        if (Number.isFinite(Number(mediaState.currentTime)) && Number(mediaState.currentTime) > 0) {
          try { player.currentTime = Number(mediaState.currentTime) } catch {}
        }
        if (Number.isFinite(Number(mediaState.volume))) {
          player.volume = Math.max(0, Math.min(1, Number(mediaState.volume)))
        }
        if (Number.isFinite(Number(mediaState.playbackRate)) && Number(mediaState.playbackRate) > 0) {
          player.playbackRate = Number(mediaState.playbackRate)
        }
        if (mediaState.paused === false) {
          player.play().catch(() => {})
        }
      }
      if (player.readyState >= 1) restore()
      else player.addEventListener('loadedmetadata', restore, { once: true })
    }

    function formatMediaTime(seconds) {
      const value = Number(seconds)
      if (!Number.isFinite(value) || value <= 0) return '0:00'
      const total = Math.floor(value)
      const minutes = Math.floor(total / 60)
      const rest = String(total % 60).padStart(2, '0')
      return `${minutes}:${rest}`
    }

    function bindMediaTimeline(id) {
      const container = document.getElementById('fileview-' + id)
      const player = container?.querySelector('.media-preview-player')
      const range = container?.querySelector('[data-media-range]')
      const current = container?.querySelector('[data-media-current]')
      const duration = container?.querySelector('[data-media-duration]')
      const playButton = container?.querySelector('[data-media-play]')
      if (!player || !range || !current || !duration) return

      let dragging = false
      const sync = () => {
        const total = Number(player.duration) || 0
        const now = Number(player.currentTime) || 0
        current.textContent = formatMediaTime(now)
        duration.textContent = formatMediaTime(total)
        if (!dragging) {
          range.value = total > 0 ? String(Math.round((now / total) * 1000)) : '0'
        }
        if (playButton) {
          playButton.classList.toggle('is-playing', !player.paused)
          playButton.setAttribute('aria-label', player.paused ? ((window.i18n?.t?.('auto.js_window_tabs_219_2') ?? '播放')) : ((window.i18n?.t?.('auto.js_window_tabs_219_3') ?? '暂停')))
        }
      }
      const seek = () => {
        const total = Number(player.duration) || 0
        if (total > 0) player.currentTime = (Number(range.value) / 1000) * total
      }

      player.addEventListener('loadedmetadata', sync)
      player.addEventListener('durationchange', sync)
      player.addEventListener('timeupdate', sync)
      player.addEventListener('seeked', sync)
      player.addEventListener('play', sync)
      player.addEventListener('pause', sync)
      playButton?.addEventListener('click', () => {
        if (player.paused) player.play().catch(() => {})
        else player.pause()
        sync()
      })
      range.addEventListener('input', () => {
        dragging = true
        const total = Number(player.duration) || 0
        const preview = total > 0 ? (Number(range.value) / 1000) * total : 0
        current.textContent = formatMediaTime(preview)
      })
      range.addEventListener('change', () => {
        seek()
        dragging = false
        sync()
      })
      range.addEventListener('pointerup', () => {
        seek()
        dragging = false
        sync()
      })
      sync()
    }

    function createModelTab(path) {
      const existing = tabs.find(t => t.type === 'model' && t.path === path && !t.detached)
      if (existing) {
        switchTab(existing.id)
        return existing
      }
      const id = Date.now()
      const fileName = getFileName(path)
      const url = `model-viewer.html?path=${encodeURIComponent(path)}&t=${Date.now()}`
      const tab = { id, path, title: fileName, type: 'model', webview: null, url, detached: false }
      tabs.push(tab)
      createEmbeddedTab(id, url, { title: fileName, type: 'model' })
      adjustLayout(true)
      updateTabCount()
      return tab
    }

    function createMusicTab(url, title = 'Music Studio') {
      const existing = tabs.find(t => t.type === 'music' && !t.detached)
      if (existing) {
        if (url && existing.url !== url && existing.webview) {
          existing.url = url
          existing.webview.src = url
        }
        switchTab(existing.id)
        return existing
      }
      const id = Date.now()
      const tab = { id, url, title, webview: null, detached: false, type: 'music' }
      tabs.push(tab)
      createEmbeddedTab(id, url, { title, type: 'music' })
      adjustLayout(true)
      updateTabCount()
      return tab
    }

    function withRestoreParam(url) {
      if (!url) return url
      try {
        const parsed = new URL(url, window.location.href)
        parsed.searchParams.delete('fresh')
        parsed.searchParams.set('restore', '1')
        return parsed.href
      } catch {
        return String(url).replace(/[?&]fresh=1/, '').includes('?')
          ? String(url).replace('fresh=1', 'restore=1')
          : `${url}${String(url).includes('?') ? '&' : '?'}restore=1`
      }
    }

    function withSnapshotParam(url, snapshot, options = {}) {
      const baseUrl = withRestoreParam(url)
      if (!snapshot) return baseUrl
      const compactSnapshot = { ...snapshot }
      if (!options.keepLargeSources) {
        delete compactSnapshot.sourceImageDataUrl
        delete compactSnapshot.sourceModelDataUrl
      }
      try {
        const parsed = new URL(baseUrl, window.location.href)
        parsed.searchParams.set('snapshot', encodeURIComponent(JSON.stringify(compactSnapshot)))
        return parsed.href
      } catch {
        const joiner = String(baseUrl).includes('?') ? '&' : '?'
        return `${baseUrl}${joiner}snapshot=${encodeURIComponent(JSON.stringify(compactSnapshot))}`
      }
    }

    function withSharedSnapshotParam(url, snapshot, prefix = 'snapshot') {
      const baseUrl = withRestoreParam(url)
      if (!snapshot) return baseUrl
      const id = `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      try {
        localStorage.setItem(`lingxi:${id}`, JSON.stringify(snapshot))
        const parsed = new URL(baseUrl, window.location.href)
        parsed.searchParams.set('snapshotId', id)
        return parsed.href
      } catch (error) {
        return withSnapshotParam(baseUrl, snapshot, { keepLargeSources: true })
      }
    }

    function findMusicTab() {
      return tabs.find(t => t.type === 'music' && !t.detached && t.webview) || null
    }

    async function sendMusicCommand(payload = {}) {
      const tab = findMusicTab()
      if (!tab?.webview) {
        return { success: false, error: ((window.i18n?.t?.('auto.js_window_tabs_484_11') ?? '音乐工作台尚未打开')) }
      }
      const safePayload = JSON.stringify(payload).replace(/</g, '\\u003c')
      try {
        const ready = await waitForMusicReady(tab.webview)
        if (!ready.success) return ready
        const result = await tab.webview.executeJavaScript(`
          (async () => {
            if (!window.AgentMusicStudio || !window.AgentMusicStudio.handleCommand) {
              return { success: false, error: ((window.i18n?.t?.('auto.js_window_tabs_493_12') ?? '音乐工作台尚未就绪')) }
            }
            return await window.AgentMusicStudio.handleCommand(${safePayload})
          })()
        `)
        return result || { success: true }
      } catch (error) {
        return { success: false, error: error.message || String(error) }
      }
    }

    function waitForMusicReady(webview, timeoutMs = 12000) {
      const startedAt = Date.now()
      return new Promise(resolve => {
        const check = async () => {
          if (!webview || !document.body.contains(webview)) {
            resolve({ success: false, error: ((window.i18n?.t?.('auto.js_window_tabs_590_19') ?? '音乐工作台已关闭')) })
            return
          }
          try {
            const ready = await webview.executeJavaScript('!!window.AgentMusicStudioReady')
            if (ready) {
              resolve({ success: true })
              return
            }
          } catch {
            // keep polling while the webview is loading
          }
          if (Date.now() - startedAt > timeoutMs) {
            resolve({ success: false, error: ((window.i18n?.t?.('auto.js_window_tabs_603_20') ?? '音乐工作台加载超时')) })
            return
          }
          setTimeout(check, 250)
        }
        check()
      })
    }


    function createBlendInfoTab(path) {
      const existing = tabs.find(t => t.type === 'blend' && t.path === path && !t.detached)
      if (existing) {
        switchTab(existing.id)
        return existing
      }
      const id = Date.now()
      const fileName = getFileName(path)
      const tab = { id, path, title: fileName, type: 'blend', detached: false }
      tabs.push(tab)
      createEmbeddedBlendTab(id, path)
      adjustLayout(true)
      updateTabCount()
      return tab
    }

    function createEmbeddedBlendTab(id, filePath) {
      const tab = tabs.find(t => t.id === id)
      if (!tab) return
      const fileName = getFileName(filePath)
      const fileContainer = document.createElement('div')
      fileContainer.className = 'file-view-container'
      fileContainer.id = 'fileview-' + id
      fileContainer.innerHTML = `
        <div class="file-view-header">
          <span class="file-view-path">${escapeHtml(filePath)}</span>
          <span class="file-view-status saved">Blender 工程</span>
          <div class="file-view-actions">
            <span class="file-view-btn popout" onclick="openBlendFile(${id})">打开</span>
            <span class="file-view-btn popout" onclick="showBlendInFolder(${id})">定位</span>
          </div>
        </div>
        <div class="blend-file-info">
          <div class="blend-file-icon">BLEND</div>
          <div class="blend-file-title">${escapeHtml(fileName)}</div>
          <div class="blend-file-desc">这是 Blender 工程文件，不适合按文本预览。可以用 Blender 打开它，或点击同目录下的 .glb/.gltf 查看 Three.js 模型预览。</div>
          <div class="blend-file-path">${escapeHtml(filePath)}</div>
        </div>
      `
      webviewContainer.appendChild(fileContainer)
      tab.fileContainer = fileContainer
      switchTab(id)
      createSimpleTabButton(id, fileName, '#f59e0b')
    }

    function createEmbeddedMediaTab(id, filePath, mediaType) {
      const tab = tabs.find(t => t.id === id)
      if (!tab) return

      const fileName = getFileName(filePath)
      const fileUrl = toFileUrl(filePath)
      const isVideo = mediaType === 'video'
      const sourceName = tab.mediaSource?.name || ((window.i18n?.t?.('auto.js_window_tabs_665_21') ?? '本地文件'))
      const sourceHint = tab.mediaSource?.hint || ((window.i18n?.t?.('auto.js_window_tabs_666_22') ?? '后续可接入音乐源、封面、歌手和曲库来源'))
      const timelineHtml = isVideo ? '' : `
                <div class="media-preview-timeline" data-media-timeline="${id}">
                  <div class="media-preview-now">
                    <div class="media-preview-now-title">${escapeHtml(fileName)}</div>
                    <div class="media-preview-now-source">${escapeHtml(sourceName)}</div>
                  </div>
                  <div class="media-preview-controls">
                    <span class="media-preview-time" data-media-current>0:00</span>
                    <button class="media-preview-play" type="button" data-media-play aria-label=((window.i18n?.t?.('auto.js_window_tabs_675_23') ?? '播放'))></button>
                    <input class="media-preview-range" data-media-range type="range" min="0" max="1000" value="0" step="1" aria-label=((window.i18n?.t?.('auto.js_window_tabs_676_24') ?? '播放进度'))>
                    <span class="media-preview-time" data-media-duration>0:00</span>
                  </div>
                </div>`
      const playerHtml = isVideo
        ? `<video class="media-preview-player media-preview-video" controls preload="metadata" src="${escapeHtml(fileUrl)}"></video>`
        : `<audio class="media-preview-player media-preview-audio" controls preload="metadata" src="${escapeHtml(fileUrl)}"></audio>`

      const fileContainer = document.createElement('div')
      fileContainer.className = 'file-view-container media-view-container'
      fileContainer.id = 'fileview-' + id
      fileContainer.innerHTML = `
        <div class="file-view-header">
          <span class="file-view-path">${escapeHtml(filePath)}</span>
          <span class="file-view-status saved">${isVideo ? 'Video' : 'Audio'}</span>
          <div class="file-view-actions">
          </div>
        </div>
        <div class="media-preview-body ${isVideo ? 'video' : 'audio'}">
          <div class="media-preview-card">
            ${isVideo ? '' : '<div class="media-preview-art" aria-hidden="true"></div>'}
            <div class="media-preview-info">
              <div class="media-preview-kicker">
                <div class="media-preview-type">${isVideo ? 'VIDEO' : 'AUDIO'}</div>
                <div class="media-preview-source">${escapeHtml(sourceName)}</div>
              </div>
              <div class="media-preview-title">${escapeHtml(fileName)}</div>
              ${isVideo ? '' : `<div class="media-preview-subtitle">${escapeHtml(sourceHint)}</div>`}
              ${isVideo ? '' : `
                <div class="media-preview-lyric" aria-hidden="true">
                  <div>${escapeHtml(fileName.replace(/\.[^.]+$/, ''))}</div>
                  <div class="active">正在播放本地音乐</div>
                  <div>接入音乐源后可显示歌词、歌手和专辑信息</div>
                  <div>${escapeHtml(sourceName)}</div>
                </div>`}
              ${playerHtml}
              ${timelineHtml}
              <div class="media-preview-path">${escapeHtml(filePath)}</div>
            </div>
          </div>
        </div>
      `
      webviewContainer.appendChild(fileContainer)
      tab.fileContainer = fileContainer
      switchTab(id)
      createSimpleTabButton(id, fileName, isVideo ? '#60a5fa' : '#a78bfa')
      if (!isVideo) bindMediaTimeline(id)
      applyMediaState(id, tab.mediaState)
    }

    function createEmbeddedFileTab(id, filePath, content, wasRunning = false, options = {}) {
      const tab = tabs.find(t => t.id === id)
      if (!tab) return

      const fileName = getFileName(filePath)
      const isHtml = fileName.toLowerCase().endsWith('.html') || fileName.toLowerCase().endsWith('.htm')
      const statusText = options.statusText || (wasRunning
        ? ((window.i18n?.t?.('auto.js_window_tabs_741_26') ?? '运行中'))
        : ((window.i18n?.t?.('auto.js_window_tabs_741_27') ?? '已加载')))
      const statusClass = options.statusClass || (options.loading || tab.loading ? 'loading' : 'saved')

      const fileContainer = document.createElement('div')
      fileContainer.className = 'file-view-container'
      fileContainer.id = 'fileview-' + id
      fileContainer.innerHTML = `
        <div class="file-view-header">
          <span class="file-view-path">${filePath}</span>
          <span class="file-view-status ${statusClass}">${statusText}</span>
          <div class="file-view-actions">
            ${isHtml ? `<span class="file-view-btn run ${wasRunning ? 'active' : ''}" id="runbtn-${id}" onclick="toggleFileRunMode(${id})" title="运行HTML">${wasRunning ? '<svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor" aria-hidden="true"><rect x="2" y="2" width="6" height="6"/></svg>' : '<svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor" aria-hidden="true"><polygon points="2,1 9,5 2,9"/></svg>'}</span>` : ''}
            <span class="file-view-btn save" onclick="saveFileTab(${id})">保存</span>
          </div>
        </div>
        <div class="file-view-error-panel" id="errorpanel-${id}"></div>
        <div class="file-view-editor" id="editor-${id}" style="${wasRunning ? 'display:none' : ''}">
          <div class="monaco-container" id="monaco-${id}"></div>
        </div>
        ${isHtml ? `<iframe class="file-view-webview" id="webview-${id}" style="${wasRunning ? 'display:flex' : 'display:none'};width:100%;height:100%;background:#fff;border:none;"></iframe>` : ''}
      `
      webviewContainer.appendChild(fileContainer)
      tab.fileContainer = fileContainer
      tab.isHtml = isHtml
      tab.isRunning = wasRunning

      if (isHtml && wasRunning) {
        const iframe = document.getElementById('webview-' + id)
        if (iframe && tab.path) {
          let fileUrl = tab.path.replace(/\\/g, '/')
          if (!fileUrl.startsWith('/')) fileUrl = '/' + fileUrl
          iframe.src = 'file://' + fileUrl
        }
        AppLogger.debug('[Frontend] HTML 文件恢复运行状态')
      }

      // 预览打开时先挂空壳，内容就绪后再延迟创建 Monaco，避免点击瞬间卡死主线程
      if (!options.deferEditor) {
        ensureFileTabEditor(tab)
      }

      switchTab(id)

      const tabEl = document.createElement('div')
      tabEl.className = 'webview-panel-tab active'
      tabEl.id = 'tab-' + id
      tabEl.innerHTML = `
        <span class="tab-icon" style="color:#10b981">${getFileIcon()}</span>
        <span class="tab-title">${fileName}</span>
        <span class="tab-btn close" onclick="event.stopPropagation();closeTab(${id})" title=((window.i18n?.t?.('auto.js_window_tabs_819_30') ?? '关闭'))>${svgIcon('x', 13)}</span>
      `
      tabEl.onclick = () => switchTab(id)
      tabEl.ondblclick = () => showTabItemInFolder(id)
      webviewTabs.appendChild(tabEl)
    }

    function computeDiffHunks(beforeText, afterText, contextLines = 3) {
      const oldLines = String(beforeText || '').split('\n')
      const newLines = String(afterText || '').split('\n')

      const policy = window.ChangeDiffPolicy?.compute?.(beforeText, afterText, contextLines)
      if (policy && policy.mode !== 'exact') return policy
      if (oldLines.length * newLines.length > 1200000) {
        return window.ChangeDiffPolicy?.computeLinear?.(oldLines, newLines, contextLines) || {
          hunks: [], totalOld: oldLines.length, totalNew: newLines.length, mode: 'summary', renderable: false
        }
      }

      /* ── LCS-based line diff ── */
      const m = oldLines.length, n = newLines.length
      const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0))
      for (let i = 1; i <= m; i++) {
        for (let j = 1; j <= n; j++) {
          dp[i][j] = oldLines[i - 1] === newLines[j - 1]
            ? dp[i - 1][j - 1] + 1
            : Math.max(dp[i - 1][j], dp[i][j - 1])
        }
      }

      const changes = []
      let i = m, j = n
      while (i > 0 || j > 0) {
        if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
          changes.unshift({ type: 'equal', oldLine: i, newLine: j, text: oldLines[i - 1] })
          i--; j--
        } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
          changes.unshift({ type: 'add', newLine: j, text: newLines[j - 1] })
          j--
        } else {
          changes.unshift({ type: 'remove', oldLine: i, text: oldLines[i - 1] })
          i--
        }
      }

      /* ── Group into hunks ── */
      const hunks = []
      let current = null
      for (let ci = 0; ci < changes.length; ci++) {
        const ch = changes[ci]
        if (ch.type !== 'equal') {
          if (!current) {
            current = { start: ci, changes: [], leadContext: [] }
          }
          current.changes.push(ch)
          current.end = ci
        } else if (current) {
          current.trailContext = current.trailContext || []
          if (current.trailContext.length < contextLines) {
            current.trailContext.push(ch)
          } else {
            hunks.push(current)
            current = null
          }
        }
      }
      if (current) hunks.push(current)

      /* ── Add lead context to each hunk ── */
      for (const hunk of hunks) {
        hunk.leadContext = []
        const startIdx = hunk.start
        for (let k = Math.max(0, startIdx - contextLines); k < startIdx; k++) {
          if (changes[k]?.type === 'equal') hunk.leadContext.push(changes[k])
        }
        if (!hunk.trailContext) hunk.trailContext = []
      }

      return { hunks, totalOld: m, totalNew: n }
    }

    function renderDiffHunks(container, beforeText, afterText) {
      const { hunks, totalOld, totalNew, mode = 'exact' } = computeDiffHunks(beforeText, afterText)
      const editable = mode === 'exact'

      if (hunks.length === 0) {
        container.innerHTML = '<div class="diff-hunk-empty">无改动内容</div>'
        return
      }

      /* ── Build aligned left/right rows per hunk ── */
      const sections = []
      for (let hi = 0; hi < hunks.length; hi++) {
        const hunk = hunks[hi]
        const leftRows = []
        const rightRows = []

        const allChanges = [
          ...hunk.leadContext.map(c => ({ ...c, _ctx: 'lead' })),
          ...hunk.changes.map(c => ({ ...c, _ctx: 'change' })),
          ...(hunk.trailContext || []).map(c => ({ ...c, _ctx: 'trail' }))
        ]

        for (const ch of allChanges) {
          if (ch.type === 'equal') {
            leftRows.push({ type: 'equal', line: ch.oldLine, text: ch.text })
            rightRows.push({ type: 'equal', line: ch.newLine, text: ch.text })
          } else if (ch.type === 'remove') {
            leftRows.push({ type: 'remove', line: ch.oldLine, text: ch.text })
            rightRows.push({ type: 'empty' })
          } else if (ch.type === 'add') {
            leftRows.push({ type: 'empty' })
            rightRows.push({ type: 'add', line: ch.newLine, text: ch.text })
          }
        }

        sections.push({ index: hi + 1, total: hunks.length, leftRows, rightRows })
      }

      const hunkHtml = sections.map(sec => {
        const leftLines = sec.leftRows.map(row => {
          if (row.type === 'empty') return '<div class="diff-dual-line diff-dual-empty"></div>'
          const cls = row.type === 'remove' ? 'remove' : 'equal'
          const gutter = row.line || ''
          return `<div class="diff-dual-line ${cls}"><span class="diff-dual-gutter">${gutter}</span><span class="diff-dual-text">${escapeHtml(row.text)}</span></div>`
        }).join('')

        const rightLines = sec.rightRows.map(row => {
          if (row.type === 'empty') return '<div class="diff-dual-line diff-dual-empty"></div>'
          const cls = row.type === 'add' ? 'add' : 'equal'
          const gutter = row.line || ''
          return `<div class="diff-dual-line ${cls}" data-line-type="${row.type}" data-line-no="${gutter}"><span class="diff-dual-gutter">${gutter}</span><span class="diff-dual-text" contenteditable="${editable ? 'true' : 'false'}" spellcheck="false">${escapeHtml(row.text)}</span></div>`
        }).join('')

        return `
          <div class="diff-dual-section">
            <div class="diff-dual-separator">@@ Hunk ${sec.index} / ${sec.total} @@</div>
            <div class="diff-dual-pair">
              <div class="diff-dual-pane diff-dual-left">
                <div class="diff-dual-pane-label">原始（改前）</div>
                ${leftLines}
              </div>
              <div class="diff-dual-pane diff-dual-right">
                <div class="diff-dual-pane-label">修改后（可编辑）</div>
                ${rightLines}
              </div>
            </div>
          </div>
        `
      }).join('')

      container.innerHTML = `
        <div class="diff-dual-viewer">
          <div class="diff-dual-legend">
            <span class="diff-legend-add">● 新增</span>
            <span class="diff-legend-remove">● 删除</span>
            <span class="diff-legend-equal">— 上下文</span>
          </div>
          ${hunkHtml}
        </div>
      `
    }

    function createEmbeddedChangeDiffTab(id) {
      const tab = tabs.find(t => t.id === id)
      if (!tab) return

      const files = Array.isArray(tab.files) ? tab.files : []
      const selected = files[tab.selectedIndex] || firstCodeFile(files)
      const selectedIndex = Math.max(0, files.indexOf(selected))
      tab.selectedIndex = selectedIndex
      const beforeText = selected?.beforeText || ''
      const afterText = selected?.afterText || ''
      const fileName = selected?.path ? getFileName(selected.path) : 'AI 本轮改动'
      const selectedAction = getActionClass(selected?.action)
      const selectedActionLabel = getActionLabel(selected?.action)
      const selectedDir = selected?.path ? getPathDirLabel(selected.path) : ''
      const language = getMonacoLanguage(fileName)
      const summary = tab.summary || {}
      const previewModeLabel = selected?.previewMode === 'full' ? '完整文件' : '片段预览'
      const diffPlan = window.ChangeDiffPolicy?.compute?.(beforeText, afterText, 3)
      const canEditDiff = !diffPlan || diffPlan.mode === 'exact'

      const fileContainer = document.createElement('div')
      fileContainer.className = 'file-view-container change-diff-view'
      fileContainer.id = 'fileview-' + id
      fileContainer.innerHTML = `
        <div class="file-view-header change-diff-toolbar">
          <div class="change-diff-title-block">
            <span class="change-diff-current-name" title="${escapeHtml(selected?.path || tab.title || 'AI 本轮改动')}">${escapeHtml(fileName)}</span>
            <span class="change-diff-current-action ${escapeHtml(selectedAction)}">${escapeHtml(selectedActionLabel)}</span>
            <span class="file-view-status saved">${summary.fileCount || files.length || 0} 文件</span>
          </div>
          <div class="change-diff-stats" title="${escapeHtml(tab.title || 'AI 本轮改动')}">
            <span class="change-diff-add">+${Number(summary.added) || 0}</span>
            <span class="change-diff-remove">-${Number(summary.removed) || 0}</span>
          </div>
          <div class="file-view-actions">
            <button class="file-view-btn fix" id="fixbtn-${id}" type="button" ${canEditDiff ? '' : 'disabled title="大文件差异仅供查看"'}>修复语法</button>
            <button class="file-view-btn save" id="savediffbtn-${id}" type="button" ${canEditDiff ? '' : 'disabled title="大文件差异仅供查看"'}>保存改动</button>
          </div>
        </div>
        <div class="change-diff-body">
          <aside class="change-diff-sidebar">
            <div class="change-diff-sidebar-title">文件</div>
            <div class="change-diff-file-list" id="changefiles-${id}">
              ${files.map((file, index) => {
                const actionClass = getActionClass(file.action)
                const name = file.path ? getFileName(file.path) : '未命名文件'
                const dir = file.path ? getPathDirLabel(file.path) : ''
                return `
                <button class="change-diff-file action-${escapeHtml(actionClass)} ${index === selectedIndex ? 'active' : ''}" type="button" data-index="${index}" title="${escapeHtml(file.path || '未命名文件')}">
                  <span class="change-diff-file-bar" aria-hidden="true"></span>
                  <span class="change-diff-file-main">
                    <span class="change-diff-file-name">${escapeHtml(name)}</span>
                    <span class="change-diff-file-dir">${escapeHtml(dir || getActionLabel(file.action))}</span>
                  </span>
                  <span class="change-diff-file-delta">
                    <span class="change-diff-add">+${Number(file.added) || 0}</span>
                    <span class="change-diff-remove">-${Number(file.removed) || 0}</span>
                  </span>
                </button>
              `
              }).join('')}
            </div>
          </aside>
          <section class="change-diff-main">
            <div class="change-diff-main-toolbar">
              <div class="change-diff-error-strip is-empty" id="differrors-${id}">
                <span class="change-diff-error-empty">暂无语法错误</span>
              </div>
              <div class="change-diff-meta">
                <div class="change-diff-meta-left">
                  <span class="change-diff-path" title="${escapeHtml(selected?.path || '')}">${escapeHtml(selected?.path || '暂无文件')}</span>
                  ${selectedDir ? `<span class="change-diff-path-dir">${escapeHtml(selectedDir)}</span>` : ''}
                </div>
                <span class="change-diff-mode">${previewModeLabel}</span>
              </div>
            </div>
            <div class="change-diff-editor" id="changediff-${id}"></div>
          </section>
        </div>
      `
      webviewContainer.appendChild(fileContainer)
      tab.fileContainer = fileContainer

      if (!beforeText && !afterText) {
        renderChangeDiffFallback(id, selected, files, 'Diff text is not available')
      }

      /* ── Render diff hunks (only changed lines + context) ── */
      const diffContainer = document.getElementById('changediff-' + id)
      const diffPolicy = window.ChangeDiffPolicy?.inspect?.(beforeText, afterText)
      if (diffContainer && diffPolicy?.renderable === false) {
        renderChangeDiffFallback(id, selected, files, diffPolicy.reason)
      } else if (diffContainer && (beforeText || afterText)) {
        const cachedDiff = tab.diffViewCache?.[selectedIndex]
        if (cachedDiff) diffContainer.innerHTML = cachedDiff
        else {
          renderDiffHunks(diffContainer, beforeText, afterText)
          tab.diffViewCache = tab.diffViewCache || {}
          tab.diffViewCache[selectedIndex] = diffContainer.innerHTML
        }
      } else if (diffContainer && !beforeText && !afterText) {
        renderChangeDiffFallback(id, selected, files, 'Diff text is not available')
      }

      fileContainer.querySelectorAll('.change-diff-file').forEach(button => {
        button.addEventListener('click', () => {
          const nextIndex = Number(button.dataset.index)
          if (!Number.isFinite(nextIndex) || nextIndex === tab.selectedIndex) return
          tab.selectedIndex = nextIndex
          fileContainer.remove()
          createEmbeddedChangeDiffTab(id)
          switchTab(id)
        })
      })

      fileContainer.querySelector(`#fixbtn-${id}`)?.addEventListener('click', () => fixChangeDiffSyntax(id))
      fileContainer.querySelector(`#savediffbtn-${id}`)?.addEventListener('click', () => saveChangeDiffFile(id))

      switchTab(id)
      const oldTabEl = document.getElementById('tab-' + id)
      if (oldTabEl) oldTabEl.remove()
      const tabEl = document.createElement('div')
      tabEl.className = 'webview-panel-tab active'
      tabEl.id = 'tab-' + id
      tabEl.innerHTML = `
        <span class="tab-icon" style="color:#10b981">${getFileIcon()}</span>
        <span class="tab-title">${escapeHtml(tab.title || 'AI 本轮改动')}</span>
        <span class="tab-btn close" onclick="event.stopPropagation();closeTab(${id})" title="关闭">${svgIcon('x', 13)}</span>
      `
      tabEl.onclick = () => switchTab(id)
      webviewTabs.appendChild(tabEl)
    }

    function isCssHasSelectorCompatMarker(marker, model, language) {
      if (language !== 'css' || !marker || !model) return false
      const lineNumber = Number(marker.startLineNumber) || 1
      const line = String(model.getLineContent?.(lineNumber) || '')
      const previous = lineNumber > 1 ? String(model.getLineContent?.(lineNumber - 1) || '') : ''
      const next = String(model.getLineContent?.(lineNumber + 1) || '')
      const windowText = `${previous}\n${line}\n${next}`
      if (!/:has\s*\(/.test(windowText)) return false
      return /selector|identifier|property|colon|semi|rule|expected|应为|选择器|标识符|属性|冒号|分号/i.test(String(marker.message || '')) ||
        marker.code === 'css-lcurlyexpected' ||
        marker.code === 'css-ruleorselectorexpected' ||
        marker.code === 'css-propertyvalueexpected'
    }

    function getActionableChangeDiffMarkers(model, language) {
      if (!model || !window.monaco) return []
      return monaco.editor.getModelMarkers({ resource: model.uri })
        .filter(marker => marker.severity === monaco.MarkerSeverity.Error)
        .filter(marker => !isCssHasSelectorCompatMarker(marker, model, language))
    }

    function focusChangeDiffMarker(id, marker) {
      const editor = monacoEditors.get(id)
      const modifiedEditor = editor?.diffEditor?.getModifiedEditor?.()
      if (!marker || !modifiedEditor) return
      const lineNumber = Number(marker.startLineNumber) || 1
      const column = Number(marker.startColumn) || 1
      modifiedEditor.revealLineInCenter(lineNumber)
      modifiedEditor.setPosition({ lineNumber, column })
      modifiedEditor.setSelection({
        startLineNumber: lineNumber,
        startColumn: column,
        endLineNumber: Number(marker.endLineNumber) || lineNumber,
        endColumn: Number(marker.endColumn) || column + 1
      })
      const decorations = editor.syntaxFocusDecorations || []
      editor.syntaxFocusDecorations = modifiedEditor.deltaDecorations(decorations, [{
        range: new monaco.Range(lineNumber, 1, lineNumber, 1),
        options: {
          isWholeLine: true,
          className: 'change-diff-line-focus',
          glyphMarginClassName: 'change-diff-line-focus-glyph'
        }
      }])
      modifiedEditor.focus()
    }

    function renderChangeDiffErrors(id, modifiedModel, language) {
      const panel = document.getElementById('differrors-' + id)
      if (!panel || !modifiedModel || !window.monaco) return
      const allErrorMarkers = monaco.editor.getModelMarkers({ resource: modifiedModel.uri })
        .filter(marker => marker.severity === monaco.MarkerSeverity.Error)
      const markers = allErrorMarkers.filter(marker => !isCssHasSelectorCompatMarker(marker, modifiedModel, language))
      if (!markers.length) {
        panel.classList.add('is-empty')
        panel.classList.toggle('is-compat-only', allErrorMarkers.length > 0)
        panel.innerHTML = allErrorMarkers.length
          ? '<span class="change-diff-error-empty">仅发现 CSS :has() 兼容性误报，已忽略</span>'
          : '<span class="change-diff-error-empty">暂无语法错误</span>'
        return
      }
      panel.classList.remove('is-empty', 'is-compat-only')
      panel.innerHTML = markers.slice(0, 8).map((marker, index) => `
        <button class="change-diff-error-item" type="button" data-index="${index}" title="点击定位到第 ${marker.startLineNumber} 行">
          行 ${marker.startLineNumber}: ${escapeHtml(marker.message)}
        </button>
      `).join('')
      panel.querySelectorAll('.change-diff-error-item').forEach((button, index) => {
        button.addEventListener('click', () => {
          focusChangeDiffMarker(id, markers[index])
        })
      })
    }

    function buildSyntaxRepairPrompt(file, model, markers, language) {
      const lines = String(model?.getValue?.() || '').split(/\r\n|\r|\n/)
      const frames = markers.slice(0, 5).map(marker => {
        const lineNumber = Number(marker.startLineNumber) || 1
        const start = Math.max(1, lineNumber - 5)
        const end = Math.min(lines.length, lineNumber + 5)
        const content = lines.slice(start - 1, end)
          .map((line, offset) => `${start + offset}: ${line}`)
          .join('\n')
        return [
          `- 行 ${lineNumber}，列 ${marker.startColumn || 1}: ${marker.message}`,
          '```',
          content,
          '```'
        ].join('\n')
      }).join('\n\n')
      return [
        '请帮我判断并修复右侧 diff 预览中的语法错误。',
        '',
        `文件路径：${file?.path || '未知文件'}`,
        `语言：${language || '未知'}`,
        '',
        '注意：如果这是 Monaco/VS Code 内置语言服务版本较旧导致的误报，例如 CSS :has() 选择器，请明确说明它不是真语法错误，不要乱改代码。',
        '',
        '错误和附近代码：',
        frames || '暂无错误片段。',
        '',
        '请先判断是真语法错误还是语言服务误报；如果是真错误，请给出最小修复方案并说明应该改哪几行。'
      ].join('\n')
    }

    async function askAiToFixChangeDiffSyntax(file, model, markers, language) {
      if (!markers.length || !model || !file) return
      const confirmed = window.confirm('本地自动修复无法安全处理当前语法提示。\n\n是否把错误行、附近代码和文件路径发送给 AI，让 AI 判断是真语法错误还是语言服务误报？')
      if (!confirmed) return
      const prompt = buildSyntaxRepairPrompt(file, model, markers, language)
      await sendMessage({
        internalMessage: prompt,
        displayContent: `请分析并修复 ${file.path || '当前文件'} 的语法提示`
      })
    }

    function getEditedDiffText(id) {
      const container = document.getElementById('changediff-' + id)
      if (!container) return ''
      const rightPane = container.querySelector('.diff-dual-right')
      if (!rightPane) return ''
      const lines = []
      rightPane.querySelectorAll('.diff-dual-line').forEach(lineEl => {
        if (lineEl.classList.contains('diff-dual-empty')) return
        const textEl = lineEl.querySelector('.diff-dual-text')
        lines.push(textEl ? textEl.textContent : '')
      })
      return lines.join('\n')
    }

    async function fixChangeDiffSyntax(id) {
      const tab = tabs.find(t => t.id === id)
      const file = tab?.files?.[tab.selectedIndex]
      if (!tab || !file || !file.path) return
      if (!file.canApplyFix) {
        showToast('当前文件不支持语法修复', 'warning')
        return
      }

      const currentText = getEditedDiffText(id)
      if (!currentText) {
        showToast('未找到可编辑的文本内容', 'warning')
        return
      }

      const language = getMonacoLanguage(file.path)
      const fixed = tryLocalSyntaxFix(currentText, language, [])
      if (!fixed || fixed === currentText) {
        showToast('未找到可安全自动修复的语法错误，可发送给 AI 判断', 'warning')
        await askAiToFixChangeDiffSyntax(file, { getValue: () => currentText }, [], language)
        return
      }

      /* Write back the fixed text to the right pane */
      const container = document.getElementById('changediff-' + id)
      const rightPane = container?.querySelector('.diff-dual-right')
      if (rightPane) {
        const fixedLines = fixed.split(/\r\n|\r|\n/)
        const lineEls = rightPane.querySelectorAll('.diff-dual-line:not(.diff-dual-empty)')
        lineEls.forEach((lineEl, idx) => {
          const textEl = lineEl.querySelector('.diff-dual-text')
          if (textEl && idx < fixedLines.length) textEl.textContent = fixedLines[idx]
        })
      }

      const result = await window.api?.writeFileContent?.(file.path, fixed)
      if (result?.success) {
        file.afterText = fixed
        showToast('已本地修复并保存文件', 'success')
      } else {
        showToast(result?.error || '保存修复结果失败', 'error')
      }
    }

    async function saveChangeDiffFile(id) {
      const tab = tabs.find(t => t.id === id)
      const file = tab?.files?.[tab.selectedIndex]
      if (!file || !file.path) return

      const nextText = getEditedDiffText(id)
      if (!nextText) {
        showToast('未找到可编辑的文本内容', 'warning')
        return
      }
      if (file.previewMode === 'full') {
        const result = await window.api?.writeFileContent?.(file.path, nextText)
        if (result?.success) {
          file.afterText = nextText
          tab.modified = false
          const statusEl = document.querySelector(`#fileview-${id} .file-view-status`)
          if (statusEl) {
            statusEl.textContent = '已保存'
            statusEl.className = 'file-view-status saved'
          }
          showToast('已保存改动', 'success')
        } else {
          showToast(result?.error || '保存失败', 'error')
        }
        return
      }

      const current = await window.api?.readFileContent?.(file.path)
      if (!current?.success) {
        showToast(current?.error || '读取当前文件失败', 'error')
        return
      }
      const beforeSnippet = String(file.beforeText || '')
      if (!beforeSnippet || !String(current.content || '').includes(beforeSnippet)) {
        showToast('无法在当前文件中定位原片段，已停止保存，避免误覆盖。', 'warning')
        return
      }
      const nextFileContent = String(current.content || '').replace(beforeSnippet, nextText)
      const result = await window.api?.writeFileContent?.(file.path, nextFileContent)
      if (result?.success) {
        file.beforeText = nextText
        file.afterText = nextText
        tab.modified = false
        const statusEl = document.querySelector(`#fileview-${id} .file-view-status`)
        if (statusEl) {
          statusEl.textContent = '已保存'
          statusEl.className = 'file-view-status saved'
        }
        showToast('已保存片段改动', 'success')
      } else {
        showToast(result?.error || '保存失败', 'error')
      }
    }

    function tryLocalSyntaxFix(content, language, markers = []) {
      let text = String(content || '')
      const joined = markers.map(marker => marker.message || '').join('\n')
      if (/'}' expected|expected.*}|缺少.*}|应为.*}/i.test(joined)) {
        const open = (text.match(/{/g) || []).length
        const close = (text.match(/}/g) || []).length
        if (open > close) text += '\n' + '}'.repeat(open - close)
      }
      if (/']' expected|expected.*\]|缺少.*\]|应为.*\]/i.test(joined)) {
        const open = (text.match(/\[/g) || []).length
        const close = (text.match(/\]/g) || []).length
        if (open > close) text += ']'.repeat(open - close)
      }
      if (/'\)' expected|expected.*\)|缺少.*\)|应为.*\)/i.test(joined)) {
        const open = (text.match(/\(/g) || []).length
        const close = (text.match(/\)/g) || []).length
        if (open > close) text += ')'.repeat(open - close)
      }
      if (/unterminated string|未终止的字符串|字符串文字未终止/i.test(joined)) {
        const quoteCount = (text.match(/(?<!\\)"/g) || []).length
        const singleCount = (text.match(/(?<!\\)'/g) || []).length
        if (quoteCount % 2 === 1) text += '"'
        else if (singleCount % 2 === 1) text += "'"
      }
      return text
    }

    function markFileModified(id) {
      const tab = tabs.find(t => t.id === id)
      if (tab && tab.type === 'file') {
        tab.modified = true
        const statusEl = document.querySelector(`#fileview-${id} .file-view-status`)
        if (statusEl) {
          statusEl.textContent = ((window.i18n?.t?.('auto.js_window_tabs_832_0') ?? ((window.i18n?.t?.('auto.js_window_tabs_832_31') ?? '编辑中'))))
          statusEl.className = 'file-view-status editing'
        }
      }
    }

    function toggleFileRunMode(id) {
      const tab = tabs.find(t => t.id === id)
      if (!tab || tab.type !== 'file' || !tab.isHtml) return

      const editorEl = document.getElementById('editor-' + id)
      const iframeEl = document.getElementById('webview-' + id)
      const runBtn = document.getElementById('runbtn-' + id)
      const statusEl = document.querySelector(`#fileview-${id} .file-view-status`)

      if (!tab.isRunning) {
        tab.isRunning = true
        if (editorEl) editorEl.style.display = 'none'
        if (iframeEl) iframeEl.style.display = 'block'
        if (runBtn) {
          runBtn.classList.add('active')
          runBtn.textContent = '■'
          runBtn.title = ((window.i18n?.t?.('auto.js_window_tabs_854_1') ?? ((window.i18n?.t?.('auto.js_window_tabs_854_32') ?? '返回编辑'))))
        }
        if (statusEl) {
          statusEl.textContent = ((window.i18n?.t?.('auto.js_window_tabs_857_2') ?? ((window.i18n?.t?.('auto.js_window_tabs_857_33') ?? '运行中'))))
          statusEl.className = 'file-view-status saved'
        }

        if (iframeEl && tab.path) {
          let filePath = tab.path.replace(/\\/g, '/')
          if (!filePath.startsWith('/')) filePath = '/' + filePath
          iframeEl.src = 'file://' + filePath
          AppLogger.debug('[Frontend] iframe 加载文件:', iframeEl.src)
        }
      } else {
        tab.isRunning = false
        if (editorEl) editorEl.style.display = 'block'
        if (iframeEl) iframeEl.style.display = 'none'
        if (runBtn) {
          runBtn.classList.remove('active')
          runBtn.innerHTML = '<svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor" aria-hidden="true"><polygon points="2,1 9,5 2,9"/></svg>'
          runBtn.title = ((window.i18n?.t?.('auto.js_window_tabs_874_3') ?? ((window.i18n?.t?.('auto.js_window_tabs_874_34') ?? '运行HTML'))))
        }
        if (statusEl) {
          statusEl.textContent = tab.modified ? ((window.i18n?.t?.('auto.js_window_tabs_877_35') ?? '编辑中')) : ((window.i18n?.t?.('auto.js_window_tabs_877_36') ?? '已保存'))
          statusEl.className = tab.modified ? 'file-view-status editing' : 'file-view-status saved'
        }
      }
    }

    function saveFileTab(id) {
      const tab = tabs.find(t => t.id === id)
      if (!tab || tab.type !== 'file') return

      const editor = monacoEditors.get(id)
      const content = editor ? editor.getValue() : ''

      if (window.api && content) {
        window.api.writeFileContent(tab.path, content).then(result => {
          if (result.success) {
            tab.modified = false
            tab.content = content
            const statusEl = document.querySelector(`#fileview-${id} .file-view-status`)
            if (statusEl) {
              statusEl.textContent = ((window.i18n?.t?.('auto.js_window_tabs_897_4') ?? ((window.i18n?.t?.('auto.js_window_tabs_897_37') ?? '已保存'))))
              statusEl.className = 'file-view-status saved'
            }
            if (tab.isHtml && tab.isRunning) {
              const iframeEl = document.getElementById('webview-' + id)
              if (iframeEl) {
                let filePath = tab.path.replace(/\\/g, '/')
                if (!filePath.startsWith('/')) filePath = '/' + filePath
                iframeEl.src = 'file://' + filePath + '?t=' + Date.now()
                AppLogger.debug('[Frontend] 保存后刷新 iframe')
              }
            }
          } else {
            showToast(((window.i18n?.t?.('auto.js_window_tabs_910_5') ?? ((window.i18n?.t?.('auto.js_window_tabs_910_38') ?? '保存失败: ')))) + result.error, 'error')
          }
        })
      }
    }

    // 与主进程 external-webview-session 一致的 Chrome UA（不含 Electron）
    // 默认值仅作回退；实际 UA 由主进程按当前 Electron/Chromium 版本下发
    let cachedChromeWebviewUA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    let chromeWebviewUAPromise = null

    function resolveChromeWebviewUserAgent() {
      if (chromeWebviewUAPromise) return chromeWebviewUAPromise
      if (!window.api?.getChromeWebviewUserAgent) {
        chromeWebviewUAPromise = Promise.resolve(cachedChromeWebviewUA)
        return chromeWebviewUAPromise
      }
      chromeWebviewUAPromise = window.api.getChromeWebviewUserAgent()
        .then((result) => {
          if (result?.success && result.userAgent) {
            cachedChromeWebviewUA = result.userAgent
          }
          return cachedChromeWebviewUA
        })
        .catch(() => cachedChromeWebviewUA)
      return chromeWebviewUAPromise
    }

    // 预热 UA，减少首个标签创建时的竞态
    resolveChromeWebviewUserAgent().catch(() => {})

        // ── 标签拖拽排序辅助 ──
    function getDragAfterElement(container, x) {
      const items = [...container.querySelectorAll('.webview-panel-tab:not(.dragging)')]
      return items.reduce((closest, child) => {
        const box = child.getBoundingClientRect()
        const offset = x - box.left - box.width / 2
        if (offset < 0 && offset > closest.offset) {
          return { offset, element: child }
        }
        return closest
      }, { offset: -Infinity }).element
    }

    function syncTabOrder() {
      const newOrder = []
      webviewTabs.querySelectorAll('.webview-panel-tab').forEach(el => {
        const id = Number(el.id.replace('tab-', ''))
        const tab = tabs.find(t => t.id === id)
        if (tab) newOrder.push(tab)
      })
      // 保留未在标签栏显示的 tab（如 detached）
      const unshown = tabs.filter(t => !newOrder.includes(t))
      tabs.length = 0
      tabs.push(...newOrder, ...unshown)
    }

function createEmbeddedTab(id, url, meta = {}) {
      const tab = tabs.find(t => t.id === id)
      if (!tab) return

      const webview = document.createElement('webview')
      webview.setAttribute('allowpopups', '')
      const studioPartitions = {
        music: 'persist:lingxi-music-studio'
      }
      const isExternalWeb = !studioPartitions[meta.type]
      webview.setAttribute('partition', studioPartitions[meta.type] || 'persist:lingxi-external-webview')
      // 外部网页必须用标准 Chrome UA，否则 Google 登录会报「内嵌浏览器/不安全」
      webview.setAttribute('useragent', cachedChromeWebviewUA)
      webview.id = 'webview-' + id
      webview.style.cssText = 'flex:1;width:100%;height:100%;display:none;'
      webviewContainer.appendChild(webview)
      tab.webview = webview
      if (meta.type) tab.type = meta.type

      setupWebviewEvents(webview, id)

      const attachSrc = (finalUrl) => {
        if (!webview.parentNode) return
        webview.setAttribute('src', finalUrl)
      }

      if (studioPartitions[meta.type] && window.api?.getPreloadPath) {
        window.api.getPreloadPath()
          .then(preloadPath => {
            if (preloadPath && webview.parentNode) webview.setAttribute('preload', preloadPath)
          })
          .catch(error => console.warn('[WindowTabs] failed to set studio preload:', error))
          .finally(() => attachSrc(url))
      } else if (isExternalWeb) {
        // 先对齐主进程 Chromium 版本的 UA，再导航，避免首跳仍被 Google 识别为 Electron
        resolveChromeWebviewUserAgent()
          .then((ua) => {
            if (webview.parentNode && ua) webview.setAttribute('useragent', ua)
          })
          .finally(() => attachSrc(url))
      } else {
        attachSrc(url)
      }

      const tabEl = document.createElement('div')
      tabEl.className = 'webview-panel-tab active'
      tabEl.id = 'tab-' + id
      tabEl.innerHTML = `
        <span class="tab-title">${escapeHtml(meta.title || url.substring(0, 30))}</span>
        <span class="tab-btn close" onclick="event.stopPropagation();closeTab(${id})" title=((window.i18n?.t?.('auto.js_window_tabs_957_40') ?? '关闭'))>${svgIcon('x', 13)}</span>
      `
      tabEl.onclick = () => switchTab(id)
      if (tab.path) tabEl.ondblclick = () => showTabItemInFolder(id)

      // 拖拽排序
      tabEl.draggable = true
      tabEl.addEventListener('dragstart', (e) => {
        e.dataTransfer.effectAllowed = 'move'
        e.dataTransfer.setData('text/plain', String(id))
        tabEl.classList.add('dragging')
      })
      tabEl.addEventListener('dragend', () => {
        tabEl.classList.remove('dragging')
      })
      tabEl.addEventListener('dragover', (e) => {
        e.preventDefault()
        e.dataTransfer.dropEffect = 'move'
        const after = getDragAfterElement(webviewTabs, e.clientX)
        if (after == null) {
          webviewTabs.appendChild(tabEl)
        } else if (after !== tabEl) {
          webviewTabs.insertBefore(tabEl, after)
        }
      })
      tabEl.addEventListener('drop', (e) => {
        e.preventDefault()
        syncTabOrder()
      })

      webviewTabs.appendChild(tabEl)

      switchTab(id)
    }

    function createSimpleTabButton(id, title, color = '#10b981') {
      const tabEl = document.createElement('div')
      tabEl.className = 'webview-panel-tab active'
      tabEl.id = 'tab-' + id
      tabEl.innerHTML = `
        <span class="tab-icon" style="color:${color}">${getFileIcon()}</span>
        <span class="tab-title">${escapeHtml(title)}</span>
        <span class="tab-btn close" onclick="event.stopPropagation();closeTab(${id})" title=((window.i18n?.t?.('auto.js_window_tabs_973_41') ?? '关闭'))>${svgIcon('x', 13)}</span>
      `
      tabEl.onclick = () => switchTab(id)
      tabEl.ondblclick = () => showTabItemInFolder(id)
      webviewTabs.appendChild(tabEl)
    }

    function removePreviewCollabTab(projectId) {
      if (!projectId) return false
      const previewTab = tabs.find(t => t.type === 'collaboration' && t.sessionProjectId === projectId && t.isPreview === true)
      if (!previewTab) return false
      const id = previewTab.id
      const tabEl = document.getElementById('tab-' + id)
      if (tabEl) tabEl.remove()
      if (previewTab.fileContainer) previewTab.fileContainer.remove()
      if (getActiveTabId() === id) setActiveTabId(null)
      const idx = tabs.indexOf(previewTab)
      if (idx >= 0) tabs.splice(idx, 1)
      updateTabCount()
      return true
    }

    function createCollaborationTab(session = {}, options = {}) {
      if (!session?.id) return null
      const silent = options.silent === true
      const isTemporaryExecution = session.temporaryExecution === true || session.executionKind === 'temporary_chat'
      // 旧“多会话窗口”已下线：只允许临时多 AI 协作标签
      if (!isTemporaryExecution) {
        console.warn('[WindowTabs] blocked non-temporary collaboration tab (multi-session window removed)')
        return null
      }
      const tabTitle = '临时多 AI'
      const tabColor = '#0ea5e9'
      // 如果是真实 session（非 preview），先移除同项目的 preview tab，避免双窗口
      const isPreview = session.mode === 'preview'
      if (!isPreview && session.projectId) {
        removePreviewCollabTab(session.projectId)
      }
      const existing = tabs.find(t =>
        t.type === 'collaboration' &&
        t.sessionProjectId === session.projectId &&
        !t.isPreview &&
        !!t.temporaryExecution === !!isTemporaryExecution
      )
      if (existing) {
        // 更新 sessionId 和内容
        existing.sessionId = session.id
        existing.title = tabTitle
        existing.temporaryExecution = isTemporaryExecution
        const existingTabEl = document.getElementById('tab-' + existing.id)
        const existingTitleEl = existingTabEl?.querySelector('.tab-title')
        if (existingTitleEl) existingTitleEl.textContent = tabTitle
        if (existing.fileContainer) {
          const currentView = existing.fileContainer.querySelector('[data-collab-session]')
          const currentSessionId = currentView?.dataset?.collabSession || ''
          if (!currentView || currentSessionId !== String(session.id || '')) {
            existing.fileContainer.innerHTML = window.AgentCollaborationUI?.buildSessionHtml?.(session) || ''
          }
          window.AgentCollaborationUI?.renderSession?.(session)
          window.AgentCollaborationUI?.bindCollabInteractions?.(existing.fileContainer)
        }
        if (!silent && getActiveTabId() !== existing.id) switchTab(existing.id)
        return existing.id
      }

      const id = Date.now()
      if (!silent) {
        tabs.forEach(t => {
          if (!t.detached) {
            if ((t.type === 'webview' || t.type === 'model' || t.type === 'music') && t.webview) t.webview.style.display = 'none'
            if (t.fileContainer) t.fileContainer.classList.remove('show')
          }
        })
      }

      const container = document.createElement('div')
      container.className = silent ? 'file-view-container' : 'file-view-container show'
      container.id = 'fileview-' + id
      container.innerHTML = window.AgentCollaborationUI?.buildSessionHtml?.(session) || ''
      webviewContainer.appendChild(container)

      const tab = {
        id,
        type: 'collaboration',
        title: tabTitle,
        sessionId: session.id,
        sessionProjectId: session.projectId || '',
        isPreview: !!isPreview,
        temporaryExecution: isTemporaryExecution,
        fileContainer: container,
        hidden: silent,
        detached: false
      }
      tabs.unshift(tab)
      createSimpleTabButton(id, tabTitle, tabColor)
      const collabTabEl = document.getElementById('tab-' + id)
      if (collabTabEl) {
        webviewTabs.insertBefore(collabTabEl, webviewTabs.firstChild)
        if (silent) collabTabEl.classList.add('hidden')
      }
      if (!silent) switchTab(id)
      updateTabCount()
      window.AgentCollaborationUI?.renderSession?.(session)
      window.AgentCollaborationUI?.bindCollabInteractions?.(container)
      return id
    }

    function showCanvasInspector(payload = {}) {
      const existing = tabs.find(tab => tab.type === 'canvasInspector' && !tab.detached)
      if (existing) {
        existing.canvasPayload = payload
        if (existing.fileContainer) window.CanvasInspector?.render?.(existing.fileContainer, payload)
        switchTab(existing.id)
        return existing.id
      }

      tabs.forEach(tab => {
        if (tab.detached) return
        if ((tab.type === 'webview' || tab.type === 'model' || tab.type === 'music') && tab.webview) {
          tab.webview.style.display = 'none'
        }
        if (tab.fileContainer) tab.fileContainer.classList.remove('show')
      })

      const id = Date.now()
      const container = document.createElement('div')
      container.className = 'file-view-container canvas-inspector-container show'
      container.id = 'fileview-' + id
      webviewContainer.appendChild(container)

      const tab = {
        id,
        type: 'canvasInspector',
        title: '节点检查器',
        canvasPayload: payload,
        fileContainer: container,
        detached: false
      }
      tabs.unshift(tab)
      createSimpleTabButton(id, tab.title, '#0ea5e9')
      window.CanvasInspector?.render?.(container, payload)
      switchTab(id)
      return id
    }

    function closeCanvasInspector() {
      const inspector = tabs.find(tab => tab.type === 'canvasInspector' && !tab.detached)
      if (!inspector) return false
      closeTab(inspector.id)
      return true
    }

    // 按当前项目过滤协作 tab 的可见性，并自动管理右侧面板展开/收起
    function setActiveProjectCollabFilter(projectId) {
      const collabTabs = tabs.filter(t => t.type === 'collaboration')
      let matchedRealCollab = false
      let matchedPreviewOnly = false
      let firstMatchedTabId = null
      for (const t of collabTabs) {
        const tabEl = document.getElementById('tab-' + t.id)
        if (!tabEl) continue
        const isMatch = projectId && t.sessionProjectId === projectId
        t.hidden = !isMatch
        if (!isMatch) {
          tabEl.classList.add('hidden')
          if (t.fileContainer) t.fileContainer.classList.remove('show')
        } else {
          tabEl.classList.remove('hidden')
          if (firstMatchedTabId === null) firstMatchedTabId = t.id
          if (t.isPreview) {
            matchedPreviewOnly = matchedPreviewOnly || !matchedRealCollab
          } else {
            matchedRealCollab = true
          }
        }
      }
      // 真实协作 tab 匹配时，只在用户已经打开协作视图时跟随切换项目。
      if (matchedRealCollab && firstMatchedTabId !== null) {
        const activeTab = tabs.find(t => t.id === getActiveTabId())
        const activeInvalid = !activeTab || activeTab.hidden || activeTab.detached
        if (!rightViewHidden && activeTab?.type === 'collaboration') {
          switchTab(firstMatchedTabId)
        } else if (activeInvalid) {
          tabs.forEach(t => {
            if (!t.detached && (t.type === 'file' || t.type === 'media' || t.type === 'blend' || t.type === 'changeDiff' || t.type === 'collaboration' || t.type === 'canvasInspector') && t.fileContainer) {
              t.fileContainer.classList.toggle('show', t.id === firstMatchedTabId)
            }
            const tabEl = document.getElementById('tab-' + t.id)
            if (tabEl) tabEl.classList.toggle('active', t.id === firstMatchedTabId)
          })
          setActiveTabId(firstMatchedTabId)
        }
      } else {
        // 没有真实协作匹配：如果当前活跃 tab 是被隐藏的协作，切到非协作 tab 或收起
        const activeId = getActiveTabId()
        const activeTab = tabs.find(t => t.id === activeId)
        if (activeTab && activeTab.type === 'collaboration' && activeTab.hidden) {
          const firstVisibleNonCollab = tabs.find(t => t.type !== 'collaboration' && !t.detached && !t.hidden)
          if (firstVisibleNonCollab) {
            switchTab(firstVisibleNonCollab.id)
          } else if (!rightViewHidden) {
            rightViewHidden = true
            applyRightViewVisibility()
          }
        } else if (!matchedPreviewOnly && !activeTab) {
          // 当前没有任何活跃 tab，且没有匹配协作（包括 preview），收起
          if (!rightViewHidden && !tabs.some(t => !t.detached && !t.hidden)) {
            rightViewHidden = true
            applyRightViewVisibility()
          }
        }
      }
      updateExpandButtonState()
      updateRightViewToggleState()
      updateTabCount()
      updateEmptyStateVisibility(hasRightPanelContent())
    }

    function setupWebviewEvents(webview, id) {
      const registerRuntimeTarget = async (patch = {}) => {
        const tab = tabs.find(t => t.id === id)
        if (!tab || !window.api?.registerRuntimeTarget || typeof webview.getWebContentsId !== 'function') return null
        const webContentsId = Number(webview.getWebContentsId())
        if (!webContentsId) return null
        const project = getActiveProject() || {}
        const result = await window.api.registerRuntimeTarget({
          runtimeId: tab.runtimeId || `runtime-${getActiveProjectId() || 'unscoped'}-tab-${id}`,
          webContentsId,
          projectId: getActiveProjectId() || '',
          projectPath: project.path || '',
          tabId: String(id),
          kind: tab.type || 'webview',
          title: tab.title || '',
          url: tab.url || webview.src || '',
          active: getActiveTabId() === id,
          source: 'right-panel-webview',
          ...patch
        })
        if (result?.target?.runtime_id) tab.runtimeId = result.target.runtime_id
        return result
      }

      webview.addEventListener('dom-ready', () => {
        registerRuntimeTarget().catch(error => console.warn('[WindowTabs] runtime target registration failed:', error))
      })

      webview.addEventListener('page-title-updated', e => {
        const tab = tabs.find(t => t.id === id)
        if (tab) {
          tab.title = e.title
          updateTabLabel(id, e.title)
          registerRuntimeTarget({ title: e.title }).catch(() => {})
        }
      })

      webview.addEventListener('did-navigate', e => {
        const tab = tabs.find(t => t.id === id)
        if (tab) {
          tab.url = e.url
          registerRuntimeTarget({ url: e.url }).catch(() => {})
          if (getActiveTabId() === id) syncBrowserNav(tab)
        }
      })

      // Google 登录完成后（应用内顶层窗口写回同 partition cookie），刷新右侧相关页
      if (!window.__lingxiGoogleAuthReloadBound) {
        window.__lingxiGoogleAuthReloadBound = true
        window.api?.onExternalWebviewAuthCompleted?.(() => {
          tabs.forEach((tab) => {
            if (!tab.webview || tab.detached) return
            try { tab.webview.reload?.() } catch (_) { /* ignore */ }
          })
          showToast?.('Google 登录状态已同步，正在刷新页面…', 'success')
        })
      }

      webview.addEventListener('did-navigate-in-page', e => {
        const tab = tabs.find(t => t.id === id)
        if (tab && e?.url) {
          tab.url = e.url
          if (getActiveTabId() === id) syncBrowserNav(tab)
        }
      })

      webview.addEventListener('did-finish-load', () => {
        const tab = tabs.find(t => t.id === id)
        if (tab && getActiveTabId() === id) syncBrowserNav(tab)
      })

      webview.addEventListener('new-window', e => {
        e.preventDefault()
        openInWebview(e.url)
      })

      webview.addEventListener('context-menu', e => {
        e.preventDefault()
        const menu = document.createElement('div')
        menu.style.cssText = 'position:fixed;left:' + e.x + 'px;top:' + e.y + 'px;background:#333;padding:8px;border-radius:4px;z-index:1000;'
        const linkUrl = e.params?.linkURL || ''
        menu.innerHTML = `
          <div style="padding:6px 12px;color:#fff;cursor:pointer;font-size:12px;" onclick="openInWebview('${linkUrl}');this.parentElement.remove();">在标签中打开</div>
          <div style="padding:6px 12px;color:#ccc;cursor:pointer;font-size:12px;" onclick="this.parentElement.remove();">取消</div>
        `
        document.body.appendChild(menu)
        setTimeout(() => {
          document.onclick = () => { menu.remove(); document.onclick = null }
        }, 10)
      })
    }

    function updateTabLabel(id, title) {
      const tab = tabs.find(t => t.id === id)
      if (!tab) return

      if (tab.detached) {
        const titleEl = document.getElementById('title-' + id)
        if (titleEl) titleEl.textContent = title.substring(0, 40)
      } else {
        const tabEl = document.getElementById('tab-' + id)
        if (tabEl) {
          const titleSpan = tabEl.querySelector('.tab-title')
          if (titleSpan) titleSpan.textContent = title
        }
      }
    }

    function switchTab(id) {
      const tab = tabs.find(t => t.id === id)
      if (!tab || tab.detached) return
      showRightViewForContent()

      tabs.forEach(t => {
        if (!t.detached) {
          if ((t.type === 'webview' || t.type === 'model' || t.type === 'music') && t.webview) {
            t.webview.style.display = t.id === id ? 'flex' : 'none'
          }
          if (t.fileContainer) {
            t.fileContainer.classList.toggle('show', t.id === id)
          }
          const tabEl = document.getElementById('tab-' + t.id)
          if (tabEl) tabEl.classList.toggle('active', t.id === id)
        }
      })
      setActiveTabId(id)
      if (tab.runtimeId && window.api?.touchRuntimeTarget) {
        window.api.touchRuntimeTarget({ runtimeId: tab.runtimeId, active: true }).catch(() => {})
      }
      webviewContainer.classList.add('show')
      webviewEmpty.classList.add('hidden')
      updateEmptyStateVisibility(true)
      adjustLayout(true)
      const headerHint = document.querySelector('.header-hint')
      if (headerHint) headerHint.style.display = 'none'
      syncBrowserNav(tab)
    }

    function closeTab(id) {
      const idx = tabs.findIndex(t => t.id === id)
      if (idx === -1) return

      const tab = tabs[idx]
      if (tab.type === 'canvasInspector') window.CanvasInspector?.destroy?.()
      const editor = monacoEditors.get(id)
      disposeMonacoEntrySoon(id, editor)
      if (tab.markerDisposable?.dispose) tab.markerDisposable.dispose()

      if (tab.detached) {
        if (tab.detachedEl) tab.detachedEl.remove()
        if (tab.webview) tab.webview.remove()
      } else {
        const tabEl = document.getElementById('tab-' + id)
        if (tabEl) tabEl.remove()
        if (tab.type === 'webview' && tab.webview) tab.webview.remove()
        if (tab.type === 'model' && tab.webview) tab.webview.remove()
        if (tab.type === 'music' && tab.webview) tab.webview.remove()
        if (tab.type === 'file' && tab.fileContainer) tab.fileContainer.remove()
        if (tab.type === 'media' && tab.fileContainer) tab.fileContainer.remove()
        if (tab.type === 'blend' && tab.fileContainer) tab.fileContainer.remove()
        if (tab.type === 'changeDiff' && tab.fileContainer) tab.fileContainer.remove()
        if (tab.type === 'collaboration' && tab.fileContainer) tab.fileContainer.remove()
        if (tab.type === 'canvasInspector' && tab.fileContainer) tab.fileContainer.remove()

        if (getActiveTabId() === id) setActiveTabId(null)
      }

      tabs.splice(idx, 1)
      updateTabCount()

      const visibleEmbeddedTabs = tabs.filter(t => !t.detached && !t.hidden)
      if (visibleEmbeddedTabs.length > 0) {
        switchTab(visibleEmbeddedTabs[visibleEmbeddedTabs.length - 1].id)
        if (getSidebarExpanded()) {
          webviewPanel.classList.add('shrink')
          center.classList.add('shrink')
        } else {
          webviewPanel.classList.remove('shrink')
          center.classList.remove('shrink')
        }
      } else {
        const hasAnyEmbeddedTabs = tabs.some(t => !t.detached)
        requestWorkspaceExpanded(false)
        webviewPanel.classList.remove('expand-left', 'show', 'shrink')
        center.classList.remove('chat-hidden', 'shrink', 'with-toggle', 'wide-view-mode')
        sidebar?.classList.remove('hidden')
        if (!hasAnyEmbeddedTabs) {
          webviewContainer.querySelectorAll('webview, .file-view-container, [data-collab-session]').forEach(node => node.remove())
        }
        webviewContainer.classList.remove('show')
        webviewEmpty.classList.remove('hidden')
        updateEmptyStateVisibility(false)
        syncBrowserNav(null)
        if (divider1) divider1.classList.add('hidden')
        const headerHint = document.querySelector('.header-hint')
        if (headerHint) headerHint.style.display = ''
        adjustLayout(false)
        webviewPanel.classList.remove('expand-left', 'show', 'shrink')
        center.classList.remove('chat-hidden', 'shrink', 'with-toggle', 'wide-view-mode')
        sidebar?.classList.remove('hidden')
        center.classList.add('full')
        scrollChatToBottom()
        AppLogger.debug('[RightView] closeTab: 已关闭最后一个右侧内容，面板状态归零')
        rightViewHiddenBeforePreview = false
        rightViewHidden = true
        applyRightViewVisibility()
      }
    }

    function openInWebview(url) {
      if (!url) return
      const existing = tabs.find(t => t.url === url && !t.detached)
      if (existing) {
        switchTab(existing.id)
        return
      }
      createTab(url, false)
    }

    function openInNewTab(url) {
      if (!url) return
      openInWebview(url)
    }

    return {
      updateTabCount,
      adjustLayout,
      syncRightViewLayout,
      createTab,
      createFileTab,
      createChangeDiffTab,
      createModelTab,
      createMusicTab,
      sendMusicCommand,
      createBlendInfoTab,
      createEmbeddedFileTab,
      markFileModified,
      toggleFileRunMode,
      handleLivePreviewToolResult,
      saveFileTab,
      createEmbeddedTab,
      setupWebviewEvents,
      updateTabLabel,
      switchTab,
      closeTab,
      openInWebview,
      openInNewTab,
      createCollaborationTab,
      showCanvasInspector,
      closeCanvasInspector,
      setActiveProjectCollabFilter,
      removePreviewCollabTab,
      hideRightView
    }
  }

  window.WindowTabsFeature = { bind }
})()
