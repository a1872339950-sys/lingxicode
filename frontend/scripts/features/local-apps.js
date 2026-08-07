/**
 * 本地应用面板 — 自动发现系统已安装应用并展示为可启动的图标网格
 */
;(function () {
  function bind(options = {}) {
    const showToast = options.showToast || function () {}

    const els = {
      button: document.getElementById('btnLocalApps'),
      panel: document.getElementById('localAppsPanel'),
      back: document.getElementById('localAppsPanelBack'),
      tabs: document.getElementById('localAppsTabs'),
      grid: document.getElementById('localAppsGrid'),
      empty: document.getElementById('localAppsEmpty'),
      search: document.getElementById('localAppsSearchInput'),
      refreshBtn: document.getElementById('localAppsRefreshBtn'),
      addBtn: document.getElementById('localAppsAddBtn')
    }

    let allApps = []
    let currentCategory = 'all'
    let searchQuery = ''
    let hasLoadedCache = false

    // ── 面板开关 ──
    function openPanel() {
      window.LingxiPanelManager?.openExclusive?.('localApps')
      if (!hasLoadedCache) loadApps()
      else renderGrid()
    }

    function closePanel() {
      els.panel?.classList.remove('show')
    }

    // ── 扫描应用 ──
    function setApps(apps = []) {
      allApps = apps.slice().sort((a, b) => {
        const nameA = (a.name || '').toLowerCase()
        const nameB = (b.name || '').toLowerCase()
        return nameA.localeCompare(nameB)
      })
      renderGrid()
    }

    async function loadApps() {
      hasLoadedCache = true
      if (!window.api?.listInstalledApps) {
        renderGrid()
        return
      }

      try {
        const result = await window.api.listInstalledApps()
        if (result?.success) setApps(result.apps || [])
        else renderGrid()
      } catch (e) {
        renderGrid()
      }
    }

    // ── 渲染网格 ──
    async function scanApps() {
      if (!window.api?.scanInstalledApps) {
        showToast('扫描功能不可用', 'error')
        return
      }

      els.refreshBtn?.classList.add('scanning')
      try {
        const result = await window.api.scanInstalledApps()
        if (result?.success) {
          setApps(result.apps || [])
          showToast('本地应用已刷新', 'success')
        } else {
          showToast('扫描失败：' + (result?.error || '未知错误'), 'error')
        }
      } catch (e) {
        showToast('扫描出错：' + e.message, 'error')
      } finally {
        els.refreshBtn?.classList.remove('scanning')
      }
    }

    async function addLocalApp() {
      if (!window.api?.addLocalApp) {
        showToast('添加功能不可用', 'error')
        return
      }

      els.addBtn?.classList.add('scanning')
      try {
        const result = await window.api.addLocalApp()
        if (result?.canceled) return
        if (result?.success) {
          setApps(result.apps || [])
          showToast('已添加：' + (result.app?.name || '本地应用'), 'success')
        } else {
          showToast('添加失败：' + (result?.error || '未知错误'), 'error')
        }
      } catch (e) {
        showToast('添加出错：' + e.message, 'error')
      } finally {
        els.addBtn?.classList.remove('scanning')
      }
    }

    function renderGrid() {
      if (!els.grid) return

      let filtered = allApps
      if (currentCategory !== 'all') {
        filtered = filtered.filter(app => app.category === currentCategory)
      }
      if (searchQuery) {
        const q = searchQuery.toLowerCase()
        filtered = filtered.filter(app => (app.name || '').toLowerCase().includes(q))
      }

      if (filtered.length === 0) {
        els.grid.innerHTML = ''
        if (els.empty) {
          els.empty.style.display = 'flex'
          els.empty.querySelector('p').textContent = allApps.length === 0
            ? '未发现应用，点击"扫描"按钮自动发现系统已安装的应用'
            : '没有找到匹配的应用'
        }
        return
      }

      if (els.empty) els.empty.style.display = 'none'

      els.grid.innerHTML = filtered.map((app, i) => {
        const catClass = 'cat-' + (app.category || 'other')
        const initial = getAppInitial(app.name)
        const isCustom = app.custom ? ' data-custom="true"' : ''
        const iconSrc = getSafeIconSrc(app.icon)
        let iconContent
        if (iconSrc) {
          iconContent = '<div class="local-apps-card-icon has-image"><img src="' + escapeAttr(iconSrc) + '" alt="' + escapeAttr(app.name) + '" draggable="false" data-initial="' + escapeAttr(initial) + '" data-cat-class="' + escapeAttr(catClass) + '"></div>'
        } else {
          iconContent = '<div class="local-apps-card-icon ' + catClass + '">' + initial + '</div>'
        }
        return '<div class="local-apps-card"' + isCustom + ' data-index="' + i + '" data-path="' + escapeAttr(app.executablePath || app.path) + '" data-launch-args="' + escapeAttr(app.launchArgs || '') + '" title="' + escapeAttr(app.name) + '" draggable="true">' +
          iconContent +
          '<div class="local-apps-card-name">' + escapeHtml(app.name) + '</div>' +
          '</div>'
      }).join('')

      // 绑定点击事件
      els.grid.querySelectorAll('.local-apps-card').forEach(card => {
        card.addEventListener('click', () => launchFromCard(card))
      })
      // 绑定右键菜单
      els.grid.querySelectorAll('.local-apps-card').forEach(card => {
        card.addEventListener('contextmenu', e => showContextMenu(e, card))
      })
      // 绑定拖拽事件
      els.grid.querySelectorAll('.local-apps-card').forEach(card => {
        card.addEventListener('dragstart', onDragStart)
      })
      els.grid.querySelectorAll('.local-apps-card-icon img').forEach(img => {
        img.addEventListener('error', () => {
          const wrapper = img.closest('.local-apps-card-icon')
          if (!wrapper) return
          wrapper.className = 'local-apps-card-icon ' + (img.dataset.catClass || 'cat-other')
          wrapper.textContent = img.dataset.initial || '?'
        }, { once: true })
      })
    }

    // ── 右键菜单 ──
    let ctxMenu = null

    function showContextMenu(e, card) {
      e.preventDefault()
      hideContextMenu()
      const isCustom = card.dataset.custom === 'true'
      const appName = card.getAttribute('title') || ''
      const appPath = card.dataset.path || ''

      const menu = document.createElement('div')
      menu.className = 'context-menu show'
      menu.style.left = Math.min(e.clientX, window.innerWidth - 200) + 'px'
      menu.style.top = Math.min(e.clientY, window.innerHeight - 80) + 'px'

      if (isCustom) {
        const delItem = document.createElement('div')
        delItem.className = 'context-menu-item'
        delItem.innerHTML = '<span class="context-menu-icon"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg></span><span class="context-menu-label" style="color:#ef4444">删除 ' + escapeHtml(appName) + '</span>'
        delItem.addEventListener('click', async () => {
          hideContextMenu()
          if (!confirm('确定要删除"' + appName +'"吗？')) return
          if (!window.api?.removeLocalApp) {
            showToast('删除功能不可用', 'error')
            return
          }
          try {
            const result = await window.api.removeLocalApp({ path: appPath })
            if (result?.success) {
              setApps(result.apps || [])
              showToast('已删除：' + appName, 'success')
            } else {
              showToast('删除失败：' + (result?.error || '未知错误'), 'error')
            }
          } catch (e) {
            showToast('删除出错：' + e.message, 'error')
          }
        })
        menu.appendChild(delItem)
      } else {
        const infoItem = document.createElement('div')
        infoItem.className = 'context-menu-item'
        infoItem.innerHTML = '<span class="context-menu-label" style="color:var(--text-disabled);font-size:12px;cursor:default">仅自定义应用可删除</span>'
        infoItem.style.cursor = 'default'
        menu.appendChild(infoItem)
      }

      document.body.appendChild(menu)
      ctxMenu = menu

      setTimeout(() => document.addEventListener('click', hideContextMenu, { once: true }), 0)
    }

    function hideContextMenu() {
      if (ctxMenu) {
        ctxMenu.remove()
        ctxMenu = null
      }
    }

    // ── 拖拽分类 ──
    let dragPath = null

    function onDragStart(e) {
      dragPath = e.target.closest('.local-apps-card')?.dataset?.path || null
      if (!dragPath) return e.preventDefault()
      e.dataTransfer.effectAllowed = 'move'
      e.dataTransfer.setData('text/plain', dragPath)

      // 高亮分类标签作为拖放目标
      els.tabs?.querySelectorAll('.local-apps-tab').forEach(tab => {
        if (!tab.classList.contains('active')) {
          tab.classList.add('drop-target')
        }
      })
    }

    function setupDragDrop() {
      if (!els.tabs) return

      els.tabs.querySelectorAll('.local-apps-tab').forEach(tab => {
        tab.addEventListener('dragover', e => {
          if (!dragPath) return
          e.preventDefault()
          e.dataTransfer.dropEffect = 'move'
          tab.classList.add('drag-over')
        })
        tab.addEventListener('dragleave', () => {
          tab.classList.remove('drag-over')
        })
        tab.addEventListener('drop', async e => {
          e.preventDefault()
          tab.classList.remove('drag-over')
          els.tabs.querySelectorAll('.local-apps-tab').forEach(t => t.classList.remove('drop-target'))
          const targetCategory = tab.dataset.category || 'all'
          if (targetCategory === 'all' || !dragPath) {
            dragPath = null
            return
          }
          if (!window.api?.updateAppCategory) {
            showToast('分类功能不可用', 'error')
            dragPath = null
            return
          }
          try {
            const result = await window.api.updateAppCategory({ path: dragPath, category: targetCategory })
            if (result?.success) {
              setApps(result.apps || [])
              showToast('已更新分类', 'success')
            } else {
              showToast((result?.error || '分类更新失败'), 'error')
            }
          } catch (e) {
            showToast('分类出错：' + e.message, 'error')
          }
          dragPath = null
        })
      })

      // 全局 dragend 清理
      document.addEventListener('dragend', () => {
        dragPath = null
        els.tabs?.querySelectorAll('.local-apps-tab').forEach(t => {
          t.classList.remove('drop-target', 'drag-over')
        })
      })
    }

    // ── 启动应用 ──
    async function launchFromCard(card) {
      const appPath = card.dataset.path
      if (!appPath) return

      card.classList.add('launching')
      try {
        const result = await window.api.launchApp({ path: appPath, launchArgs: card.dataset.launchArgs || '' })
        if (result?.success) {
          showToast('已启动：' + (card.getAttribute('title') || ''), 'success')
        } else {
          showToast('启动失败：' + (result?.error || '未知错误'), 'error')
        }
      } catch (e) {
        showToast('启动出错：' + e.message, 'error')
      } finally {
        setTimeout(() => card.classList.remove('launching'), 600)
      }
    }

    // ── 工具函数 ──
    function getAppInitial(name) {
      if (!name) return '?'
      const trimmed = name.trim()
      // 如果是中文字符，取第一个字
      if (/[\u4e00-\u9fff]/.test(trimmed[0])) return trimmed[0]
      // 英文取前两个字母
      return trimmed.substring(0, 2).toUpperCase()
    }

    const escapeHtml = HtmlUtils.escapeHtml

    function escapeAttr(str) {
      return String(str || '').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    }

    function getSafeIconSrc(value) {
      const src = String(value || '').trim()
      if (!src) return ''
      if (src.includes('${') || src.includes('escapeAttr(') || src.includes('undefined')) return ''
      if (/^data:image\/(?:png|jpe?g|webp|gif|bmp|svg\+xml);base64,/i.test(src)) return src
      if (/^file:\/\/\/?/i.test(src)) return src
      if (/^[A-Za-z]:[\\/]/.test(src)) {
        return 'file:///' + src.replace(/\\/g, '/').replace(/^\/+/, '')
      }
      if (/^(?:assets|frontend\/assets)\//i.test(src)) return src
      return ''
    }

    // ── 事件绑定 ──
    if (els.button) {
      els.button.addEventListener('click', openPanel)
    }

    if (els.back) {
      els.back.addEventListener('click', closePanel)
    }

    if (els.refreshBtn) {
      els.refreshBtn.addEventListener('click', scanApps)
    }

    if (els.addBtn) {
      els.addBtn.addEventListener('click', addLocalApp)
    }

    setupDragDrop()

    // 分类标签切换
    if (els.tabs) {
      els.tabs.addEventListener('click', e => {
        const tab = e.target.closest('.local-apps-tab')
        if (!tab) return
        els.tabs.querySelectorAll('.local-apps-tab').forEach(t => t.classList.remove('active'))
        tab.classList.add('active')
        currentCategory = tab.dataset.category || 'all'
        renderGrid()
      })
    }

    // 搜索
    if (els.search) {
      els.search.addEventListener('input', e => {
        searchQuery = (e.target.value || '').trim()
        renderGrid()
      })
    }

    renderGrid()
    return { openPanel, closePanel, loadApps, scanApps, addLocalApp, renderGrid }
  }

  window.LocalApps = { bind }
})()
