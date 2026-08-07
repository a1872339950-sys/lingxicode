(function () {
  const escapeHtml = HtmlUtils.escapeHtml

  function getElements() {
    return {
      modeAsk: document.getElementById('aiPermissionModeAsk'),
      modeSmart: document.getElementById('aiPermissionModeSmart'),
      modeFull: document.getElementById('aiPermissionModeFull'),
      smartModelGroup: document.getElementById('aiSmartAuthorizationModelGroup'),
      smartModel: document.getElementById('aiSmartAuthorizationModel'),
      modeSummary: document.getElementById('aiPermissionModeSummary'),
      modelSummary: document.getElementById('aiPermissionModelSummary'),
      countSummary: document.getElementById('aiPermissionCountSummary'),
      countBadge: document.getElementById('aiPermissionCountBadge'),
      search: document.getElementById('aiPermissionSearch'),
      filter: document.getElementById('aiPermissionFilter'),
      kind: document.getElementById('aiPermissionKind'),
      path: document.getElementById('aiPermissionPath'),
      selectButton: document.getElementById('aiPermissionSelectBtn'),
      addButton: document.getElementById('aiPermissionAddBtn'),
      list: document.getElementById('aiPermissionList')
    }
  }

  function modeLabel(mode) {
    if (mode === 'full') return window.i18n?.t?.('auto.l1089') || '完整授权'
    if (mode === 'smart') return '智能授权'
    return window.i18n?.t?.('auto.l1084') || '询问授权'
  }

  function ruleKind(rule = {}) {
    if (rule.kind === 'application' || rule.scope === 'application') return 'application'
    return 'path'
  }

  function labelForRule(rule) {
    if (ruleKind(rule) === 'application') {
      return window.i18n?.t?.('auto.js_ai_permission_settings_27_1') ?? '应用'
    }
    return window.i18n?.t?.('auto.js_ai_permission_settings_28_2') ?? '路径'
  }

  function operationLabel(rule = {}) {
    const operation = String(rule.operation || 'manual').trim() || 'manual'
    const map = {
      manual: '手动添加',
      dialog: '弹窗授权',
      ask: '询问后授权',
      smart: '智能授权后确认',
      allow: '允许后记住',
      open_software: '打开应用',
      file: '文件访问',
      path: '路径访问'
    }
    return map[operation] || operation
  }

  function formatTime(value) {
    if (!value) return '添加时间未知'
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) return '添加时间未知'
    return `添加于 ${date.toLocaleString()}`
  }

  function bind(options = {}) {
    const showToast = options.showToast || function () {}
    const els = getElements()
    let currentSettings = { mode: 'ask', rules: [] }
    let currentSmartConfig = {}

    function updateModeVisibility(mode) {
      if (els.smartModelGroup) els.smartModelGroup.hidden = mode !== 'smart'
    }

    function updateSummary(settings = {}, smartConfig = {}) {
      const mode = settings.mode || 'ask'
      const rules = Array.isArray(settings.rules) ? settings.rules : []
      const modelKey = String(smartConfig.modelKey || '')
      let modelText = mode === 'smart' ? '未选择：始终询问' : '未启用'
      if (mode === 'smart' && els.smartModel) {
        const option = Array.from(els.smartModel.options || []).find(item => item.value === modelKey)
        if (option && option.value) modelText = option.textContent || modelKey
      }
      if (els.modeSummary) els.modeSummary.textContent = modeLabel(mode)
      if (els.modelSummary) els.modelSummary.textContent = modelText
      if (els.countSummary) els.countSummary.textContent = `${rules.length} 项`
      if (els.countBadge) els.countBadge.textContent = String(rules.length)
    }

    async function renderSmartModelOptions(settings = {}, smartConfig = {}) {
      if (!els.smartModel || !window.api?.getApiConfig) return
      const apiConfig = await window.api.getApiConfig().catch(() => null)
      const models = Array.isArray(apiConfig?.data?.models) ? apiConfig.data.models : []
      const selected = String(smartConfig.modelKey || settings.smartAuthorization?.modelKey || '')
      els.smartModel.innerHTML = [
        '<option value=\"\">未选择：始终询问</option>',
        ...models.map((model, index) => {
          const key = String(model.modelKey || index)
          const name = escapeHtml(model.modelName || model.modelId || `模型 ${index + 1}`)
          return `<option value=\"${escapeHtml(key)}\"${key === selected ? ' selected' : ''}>${name}</option>`
        })
      ].join('')
    }

    function getFilteredRules(rules = []) {
      const keyword = String(els.search?.value || '').trim().toLowerCase()
      const filter = String(els.filter?.value || 'all')
      return rules.filter(rule => {
        const kind = ruleKind(rule)
        if (filter !== 'all' && kind !== filter) return false
        if (!keyword) return true
        const haystack = [
          labelForRule(rule),
          operationLabel(rule),
          rule.path || '',
          rule.operation || '',
          rule.key || ''
        ].join(' ').toLowerCase()
        return haystack.includes(keyword)
      })
    }

    function renderEmptyState(totalCount) {
      const hasFilters = String(els.search?.value || '').trim() || (els.filter && els.filter.value !== 'all')
      if (totalCount === 0) {
        return `
          <div class=\"permission-empty\">
            <div class=\"permission-empty-title\">还没有预授权项</div>
            <div class=\"permission-empty-desc\">添加常用路径或应用后，询问授权和智能授权模式下会直接放行匹配项。</div>
            <button class=\"settings-path-btn\" type=\"button\" id=\"aiPermissionEmptyFocusBtn\">去添加</button>
          </div>
        `
      }
      return `
        <div class=\"permission-empty\">
          <div class=\"permission-empty-title\">没有匹配结果</div>
          <div class=\"permission-empty-desc\">${hasFilters ? '试试调整搜索词或类型筛选。' : '当前没有可显示的授权项。'}</div>
        </div>
      `
    }

    function renderList(settings = {}) {
      if (!els.list) return
      const rules = Array.isArray(settings.rules) ? settings.rules : []
      const filtered = getFilteredRules(rules)
      if (filtered.length === 0) {
        els.list.innerHTML = renderEmptyState(rules.length)
        const focusBtn = document.getElementById('aiPermissionEmptyFocusBtn')
        if (focusBtn) {
          focusBtn.onclick = () => {
            els.path?.focus()
            els.path?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' })
          }
        }
        return
      }

      els.list.innerHTML = filtered.map(rule => {
        const kind = ruleKind(rule)
        const iconName = kind === 'application' ? 'grant' : 'path'
        return `
          <div class="permission-item" data-key="${escapeHtml(rule.key)}">
            <div class="permission-main">
              <div class="permission-item-meta">
                <img class="permission-item-icon" src="assets/settings/permission/permission-${iconName}.png" alt="" aria-hidden="true">
                <span class="permission-kind-tag">${escapeHtml(labelForRule(rule))}</span>
                <span class="permission-source-tag">${escapeHtml(operationLabel(rule))}</span>
              </div>
              <div class="permission-title">${escapeHtml(rule.path || rule.key || '\u672a\u547d\u540d\u6388\u6743')}</div>
              <div class="permission-path">${escapeHtml(rule.path || '')}</div>
              <div class="permission-time">${escapeHtml(formatTime(rule.createdAt || rule.updatedAt || rule.timestamp))}</div>
            </div>
            <button class="settings-path-btn reset permission-remove" data-key="${escapeHtml(rule.key)}">&#21462;&#28040;&#25480;&#26435;</button>
          </div>
        `
      }).join('')
      els.list.querySelectorAll('.permission-remove').forEach(button => {
        button.onclick = async () => {
          const key = button.dataset.key
          const result = await window.api?.removePathPermission?.(key)
          if (result?.success) {
            showToast(window.i18n?.t?.('auto.js_ai_permission_settings_54_0') ?? '授权已取消', 'success')
            render(result.settings || await load())
          } else {
            showToast(
              (window.i18n?.t?.('auto.js_ai_permission_settings_57_1') ?? '取消失败: ') +
              (result?.error || (window.i18n?.t?.('auto.js_ai_permission_settings_57_6') ?? '未知错误')),
              'error'
            )
          }
        }
      })
    }

    function render(settings = {}) {
      currentSettings = {
        mode: settings.mode || 'ask',
        rules: Array.isArray(settings.rules) ? settings.rules : []
      }
      if (els.modeAsk) els.modeAsk.checked = currentSettings.mode === 'ask'
      if (els.modeSmart) els.modeSmart.checked = currentSettings.mode === 'smart'
      if (els.modeFull) els.modeFull.checked = currentSettings.mode === 'full'
      updateModeVisibility(currentSettings.mode)
      renderList(currentSettings)
      Promise.all([
        window.api?.getSmartAuthorizationConfig?.().catch(() => null),
        renderSmartModelOptions(currentSettings, currentSmartConfig)
      ]).then(([smartConfig]) => {
        currentSmartConfig = smartConfig?.data || currentSmartConfig || {}
        return renderSmartModelOptions(currentSettings, currentSmartConfig).then(() => {
          updateSummary(currentSettings, currentSmartConfig)
        })
      }).catch(() => {
        updateSummary(currentSettings, currentSmartConfig)
      })
    }

    async function load() {
      if (!window.api?.getPathPermissions) return { mode: 'ask', rules: [] }
      const result = await window.api.getPathPermissions()
      if (result?.success) render(result)
      return result || { mode: 'ask', rules: [] }
    }

    async function setMode(mode) {
      const result = await window.api?.setPathPermissionMode?.(mode)
      if (result?.success) {
        render(result)
        const execModeCurrent = document.getElementById('execModeCurrent')
        const execModeTrigger = document.getElementById('execModeTrigger')
        const execModeMenu = document.getElementById('execModeMenu')
        if (execModeCurrent) execModeCurrent.textContent = modeLabel(mode)
        if (execModeTrigger) execModeTrigger.classList.toggle('mode-full', mode === 'full')
        if (execModeMenu) {
          execModeMenu.querySelectorAll('.exec-mode-option').forEach(option => {
            option.classList.toggle('selected', option.dataset.value === mode)
          })
        }
        showToast(mode === 'full' ? '已切换为完整授权' : mode === 'smart' ? '已切换为智能授权' : '已切换为询问授权', 'success')
      } else {
        showToast(window.i18n?.t?.('auto.js_ai_permission_settings_76_2') ?? '权限模式保存失败', 'error')
      }
    }

    if (els.modeAsk) els.modeAsk.onchange = () => {
      if (els.modeAsk.checked) setMode('ask')
    }
    if (els.modeSmart) els.modeSmart.onchange = () => {
      if (els.modeSmart.checked) setMode('smart')
    }
    if (els.modeFull) els.modeFull.onchange = () => {
      if (els.modeFull.checked) setMode('full')
    }
    if (els.smartModel) els.smartModel.onchange = async () => {
      const current = await window.api?.getSmartAuthorizationConfig?.()
      const result = await window.api?.saveSmartAuthorizationConfig?.({
        ...(current?.data || {}),
        modelKey: els.smartModel.value
      })
      if (!result?.success) {
        showToast('智能授权模型保存失败', 'error')
        return
      }
      currentSmartConfig = result.data || { ...(current?.data || {}), modelKey: els.smartModel.value }
      updateSummary(currentSettings, currentSmartConfig)
    }
    if (els.search) els.search.oninput = () => renderList(currentSettings)
    if (els.filter) els.filter.onchange = () => renderList(currentSettings)
    if (els.selectButton) els.selectButton.onclick = async () => {
      const kind = els.kind?.value || 'path'
      const result = await window.api?.selectPathPermissionTarget?.(kind)
      if (result?.success && result.path && els.path) els.path.value = result.path
    }
    if (els.addButton) els.addButton.onclick = async () => {
      const targetPath = els.path?.value?.trim()
      if (!targetPath) {
        showToast(window.i18n?.t?.('auto.js_ai_permission_settings_94_3') ?? '请先选择或输入路径', 'error')
        return
      }
      const kind = els.kind?.value || 'path'
      const result = await window.api?.addPathPermission?.({ kind, path: targetPath })
      if (result?.success) {
        if (els.path) els.path.value = ''
        showToast(window.i18n?.t?.('auto.js_ai_permission_settings_101_4') ?? '授权已添加', 'success')
        render(result.settings || await load())
        requestAnimationFrame(() => {
          const first = els.list?.querySelector('.permission-item')
          first?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' })
        })
      } else {
        showToast(
          (window.i18n?.t?.('auto.js_ai_permission_settings_104_5') ?? '添加失败: ') +
          (result?.error || (window.i18n?.t?.('auto.js_ai_permission_settings_104_13') ?? '未知错误')),
          'error'
        )
      }
    }

    return { load, render }
  }

  window.AIPermissionSettings = { bind }
})()
