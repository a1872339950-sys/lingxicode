/**
 * 能力开关设置页：用户可见的可选/高权限能力总控
 * 入口：设置 → 能力开关
 */
(function () {
  let currentState = null
  let loadingPromise = null
  let activeCategory = 'all'
  let statusFilter = 'all'
  let searchQuery = ''

  function toast(msg, type) {
    if (window.ToastUI?.show) window.ToastUI.show(msg, type || 'info')
    else if (window.showToast) window.showToast(msg, type || 'info')
  }

  function escapeHtml(value) {
    if (window.HtmlUtils?.escapeHtml) return window.HtmlUtils.escapeHtml(value)
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
  }

  function riskLabel(risk) {
    if (risk === 'high') return '高风险'
    if (risk === 'medium') return '中风险'
    return ''
  }

  function riskClass(risk) {
    if (risk === 'high') return 'is-risk-high'
    if (risk === 'medium') return 'is-risk-medium'
    return ''
  }

  function getCatalog(state) {
    return Array.isArray(state?.catalog) ? state.catalog : []
  }

  function getCategories(state) {
    return Array.isArray(state?.categories) ? state.categories : []
  }

  function matchesCurrentFilters(item, category) {
    if (statusFilter === 'enabled' && !item.enabled) return false
    if (statusFilter === 'disabled' && item.enabled) return false
    const query = searchQuery.trim().toLocaleLowerCase()
    if (!query) return true
    const searchable = [
      category,
      item.title,
      item.description,
      item.hint,
      ...(Array.isArray(item.tools) ? item.tools : [])
    ].join(' ').toLocaleLowerCase()
    return searchable.includes(query)
  }

  function renderSummary(state) {
    const el = document.getElementById('featureSettingsSummary')
    if (!el) return
    const catalog = getCatalog(state)
    const onCount = catalog.filter(item => item.enabled).length
    const offCount = catalog.length - onCount
    const highRiskCount = catalog.filter(item => item.risk === 'high').length
    el.innerHTML = `
      <div class="feature-settings-summary-item">
        <strong>${catalog.length}</strong>
        <span>全部能力</span>
      </div>
      <div class="feature-settings-summary-item is-enabled">
        <strong>${onCount}</strong>
        <span>已开启</span>
      </div>
      <div class="feature-settings-summary-item is-disabled">
        <strong>${offCount}</strong>
        <span>已关闭</span>
      </div>
      <div class="feature-settings-summary-item is-risk">
        <strong>${highRiskCount}</strong>
        <span>高风险能力</span>
      </div>
    `
  }

  function renderCategoryTabs(state) {
    const tabsEl = document.getElementById('featureSettingsCategoryTabs')
    if (!tabsEl) return
    const catalog = getCatalog(state)
    const categories = getCategories(state)
    const available = new Set(categories.map(group => group.category))
    if (activeCategory !== 'all' && !available.has(activeCategory)) activeCategory = 'all'

    const tabs = [
      { category: 'all', label: '全部', items: catalog },
      ...categories.map(group => ({
        category: group.category || '其他',
        label: group.category || '其他',
        items: Array.isArray(group.items) ? group.items : []
      }))
    ]

    tabsEl.innerHTML = tabs.map(tab => {
      const enabledCount = tab.items.filter(item => item.enabled).length
      const active = tab.category === activeCategory
      return `
        <button type="button"
          class="feature-settings-category-tab${active ? ' is-active' : ''}"
          data-feature-category="${escapeHtml(tab.category)}"
          role="tab"
          aria-selected="${active ? 'true' : 'false'}">
          <span>${escapeHtml(tab.label)}</span>
          <span class="feature-settings-category-count">${enabledCount}/${tab.items.length}</span>
        </button>
      `
    }).join('')

    tabsEl.querySelectorAll('[data-feature-category]').forEach(button => {
      button.addEventListener('click', () => {
        activeCategory = button.getAttribute('data-feature-category') || 'all'
        renderCategoryTabs(currentState)
        renderList(currentState)
      })
    })
  }

  function updateStatusFilterButtons() {
    document.querySelectorAll('[data-feature-status-filter]').forEach(button => {
      const active = button.getAttribute('data-feature-status-filter') === statusFilter
      button.classList.toggle('is-active', active)
      button.setAttribute('aria-pressed', active ? 'true' : 'false')
    })
  }

  function renderList(state) {
    const listEl = document.getElementById('featureSettingsList')
    if (!listEl) return

    const hasActiveFilters = activeCategory !== 'all' || statusFilter !== 'all' || searchQuery.trim()
    const categories = getCategories(state)
      .filter(group => activeCategory === 'all' || group.category === activeCategory)
      .map(group => {
        const allItems = Array.isArray(group.items) ? group.items : []
        return {
          category: group.category || '其他',
          allItems,
          items: allItems.filter(item => matchesCurrentFilters(item, group.category || '其他'))
        }
      })
      .filter(group => group.items.length > 0)

    if (!categories.length) {
      listEl.innerHTML = `
        <div class="feature-settings-empty">
          <div class="feature-settings-empty-icon" aria-hidden="true">⌕</div>
          <div class="feature-settings-empty-title">没有找到符合条件的能力</div>
          <div class="feature-settings-empty-desc">换个关键词或清除当前分类与状态筛选。</div>
          ${hasActiveFilters ? '<button type="button" class="settings-path-btn" id="featureSettingsClearFiltersBtn">清除筛选</button>' : ''}
        </div>
      `
      document.getElementById('featureSettingsClearFiltersBtn')?.addEventListener('click', () => {
        activeCategory = 'all'
        statusFilter = 'all'
        searchQuery = ''
        const searchInput = document.getElementById('featureSettingsSearchInput')
        if (searchInput) searchInput.value = ''
        updateStatusFilterButtons()
        renderCategoryTabs(currentState)
        renderList(currentState)
      })
      return
    }

    listEl.innerHTML = categories.map(group => {
      const enabledCount = group.allItems.filter(item => item.enabled).length
      const resultMeta = hasActiveFilters && group.items.length !== group.allItems.length
        ? `${group.items.length} 项结果 · ${enabledCount}/${group.allItems.length} 已开启`
        : `${enabledCount}/${group.allItems.length} 已开启`
      const cards = group.items.map(item => {
        const risk = riskLabel(item.risk)
        const tools = Array.isArray(item.tools) ? item.tools.join(', ') : ''
        return `
          <div class="feature-settings-card ${item.enabled ? 'is-enabled' : 'is-disabled'} ${riskClass(item.risk)}" data-feature-id="${escapeHtml(item.id)}">
            <div class="feature-settings-card-state" aria-hidden="true"></div>
            <div class="feature-settings-card-main">
              <div class="feature-settings-card-title-row">
                <div class="feature-settings-card-title">${escapeHtml(item.title)}</div>
                ${risk ? `<span class="feature-settings-risk">${escapeHtml(risk)}</span>` : ''}
              </div>
              <div class="feature-settings-card-desc">${escapeHtml(item.description || '')}</div>
              ${item.hint ? `<div class="feature-settings-card-hint">${escapeHtml(item.hint)}</div>` : ''}
              ${tools ? `<div class="feature-settings-card-tools"><span>关联工具</span>${escapeHtml(tools)}</div>` : ''}
            </div>
            <label class="settings-toggle" title="${item.enabled ? '已开启' : '已关闭'}">
              <input type="checkbox"
                data-feature-toggle="${escapeHtml(item.id)}"
                aria-label="${escapeHtml(item.title)}"
                ${item.enabled ? 'checked' : ''}>
              <span class="settings-toggle-slider" aria-hidden="true"></span>
            </label>
          </div>
        `
      }).join('')

      return `
        <section class="feature-settings-group" data-feature-group="${escapeHtml(group.category)}">
          <div class="feature-settings-group-heading">
            <div class="feature-settings-group-title">
              <span class="feature-settings-group-dot" aria-hidden="true"></span>
              ${escapeHtml(group.category)}
            </div>
            <div class="feature-settings-group-meta">${escapeHtml(resultMeta)}</div>
          </div>
          <div class="feature-settings-group-body">${cards}</div>
        </section>
      `
    }).join('')

    listEl.querySelectorAll('[data-feature-toggle]').forEach(input => {
      input.addEventListener('change', async () => {
        const id = input.getAttribute('data-feature-toggle')
        const enabled = !!input.checked
        input.disabled = true
        try {
          if (!window.api?.setFeatureEnabled) {
            toast('能力开关接口不可用', 'error')
            input.checked = !enabled
            return
          }
          const res = await window.api.setFeatureEnabled(id, enabled)
          if (!res?.success) {
            toast(res?.error || '保存失败', 'error')
            input.checked = !enabled
            return
          }
          applyState(res.data)
          if (id === 'desktop_control') {
            window.DesktopControlSettings?.reload?.()
          }
          const title = res.data?.catalog?.find(x => x.id === id)?.title || id
          toast(enabled ? `已开启「${title}」` : `已关闭「${title}」`, 'success')
        } catch (err) {
          toast(err?.message || '保存失败', 'error')
          input.checked = !enabled
        } finally {
          input.disabled = false
        }
      })
    })
  }

  function applyState(state) {
    currentState = state && typeof state === 'object' ? state : null
    renderSummary(currentState)
    renderCategoryTabs(currentState)
    updateStatusFilterButtons()
    renderList(currentState)
  }

  async function loadAndApply() {
    const summaryEl = document.getElementById('featureSettingsSummary')
    if (!window.api?.getFeatureSettings) {
      if (summaryEl) summaryEl.textContent = '能力开关接口不可用（请确认主进程已加载）'
      return currentState
    }
    if (!loadingPromise) {
      loadingPromise = window.api.getFeatureSettings()
        .then(res => {
          if (!res?.success) throw new Error(res?.error || '读取失败')
          applyState(res.data)
          return currentState
        })
        .finally(() => {
          loadingPromise = null
        })
    }
    try {
      return await loadingPromise
    } catch (err) {
      if (summaryEl) summaryEl.textContent = err?.message || '读取失败'
      return currentState
    }
  }

  async function isEnabled(featureId, fallback = true) {
    const state = currentState || await loadAndApply()
    if (state?.features && Object.prototype.hasOwnProperty.call(state.features, featureId)) {
      return state.features[featureId] === true
    }
    return fallback === true
  }

  async function resetDefaults() {
    if (!window.api?.resetFeatureSettings) return
    const ok = window.confirm?.('将所有能力开关恢复为默认值？（桌面操控默认关闭，其余大多默认开启）')
    if (ok === false) return
    const res = await window.api.resetFeatureSettings()
    if (!res?.success) {
      toast(res?.error || '恢复默认失败', 'error')
      return
    }
    applyState(res.data)
    window.DesktopControlSettings?.reload?.()
    toast('已恢复默认能力开关', 'success')
  }

  function bind() {
    if (!document.getElementById('featureSettingsList')) return

    const searchInput = document.getElementById('featureSettingsSearchInput')
    searchInput?.addEventListener('input', () => {
      searchQuery = searchInput.value || ''
      renderList(currentState)
    })

    document.querySelectorAll('[data-feature-status-filter]').forEach(button => {
      button.addEventListener('click', () => {
        statusFilter = button.getAttribute('data-feature-status-filter') || 'all'
        updateStatusFilterButtons()
        renderList(currentState)
      })
    })
    updateStatusFilterButtons()

    document.getElementById('featureSettingsReloadBtn')?.addEventListener('click', () => {
      loadAndApply()
    })
    document.getElementById('featureSettingsResetBtn')?.addEventListener('click', () => {
      resetDefaults()
    })

    document.getElementById('settingsTabFeatures')?.addEventListener('click', () => {
      setTimeout(loadAndApply, 40)
    })

    // 个性化页改了桌面操控后，若能力页已打开则刷新
    window.addEventListener('lingxi-desktop-control-settings-changed', () => {
      if (document.getElementById('settingsContentFeatures')?.classList.contains('active')) {
        loadAndApply()
      }
    })

    // 提前加载一次，让聊天输入框能在第一次粘贴时拿到真实持久化状态。
    loadAndApply()
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bind)
  } else {
    bind()
  }

  window.FeatureSettingsUI = {
    reload: loadAndApply,
    load: loadAndApply,
    isEnabled,
    getState: () => currentState
  }
})()
