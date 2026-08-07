(function () {
  let boundInstance = null
  let currentRangePreset = '7d'
  let currentGranularity = 'day'
  let currentStartDate = ''
  let currentEndDate = ''
  let currentSingleDate = ''
  let clearTrendTooltipHandler = null
  let detailTab = 'models'
  let detailCache = { models: [], tasks: [], recent: [], totalTokens: 0 }
  let detailSort = {
    models: { key: 'totalTokens', dir: 'desc' },
    tasks: { key: 'totalTokens', dir: 'desc' },
    recent: { key: 'createdAt', dir: 'desc' }
  }
  const portalPlaceholders = new WeakMap()
  const presetLabels = {
    today: '今天',
    yesterday: '昨天',
    last24h: '近 24 小时',
    '7d': '近 7 天',
    '14d': '近 14 天',
    '30d': '近 30 天',
    '90d': '近 90 天',
    thisMonth: '本月',
    lastMonth: '上月',
    custom: '自定义',
    singleDay: '单日查询'
  }
  const granularityLabels = {
    hour: '按小时',
    day: '按天',
    week: '按周',
    month: '按月'
  }
  const taskLabels = {
    chat: '主聊天',
    tool_loop: '工具调用循环',
    project_ledger: '项目记录整理',
    project_route: '项目路线整理',
    memory_organizer: '偏好与规则整理',
    worker_json: '后台整理'
  }

  function bind() {
    if (boundInstance) return boundInstance
    const root = document.getElementById('settingsContentCloudTokenUsage')
    if (!root) return { load: async function () {} }
    initDefaultDates()
    bindFilters(root)
    bindDetailTabs(root)
    const refreshButton = document.getElementById('cloudTokenUsageRefreshBtn')
    if (refreshButton) refreshButton.onclick = () => load()
    boundInstance = { load }
    load()
    return boundInstance
  }

  function bindDetailTabs(root) {
    const tabs = root.querySelectorAll('[data-detail-tab]')
    tabs.forEach(button => {
      button.onclick = () => {
        detailTab = button.dataset.detailTab || 'models'
        tabs.forEach(item => {
          const active = item.dataset.detailTab === detailTab
          item.classList.toggle('is-active', active)
          item.setAttribute('aria-selected', active ? 'true' : 'false')
        })
        renderDetailTable()
      }
    })
  }

  function initDefaultDates() {
    const today = startOfDay(new Date())
    currentEndDate = formatDateInput(today)
    currentStartDate = formatDateInput(addDays(today, -6))
    currentSingleDate = currentEndDate
    const startInput = document.getElementById('cloudTokenUsageStartDate')
    const endInput = document.getElementById('cloudTokenUsageEndDate')
    const singleInput = document.getElementById('cloudTokenUsageSingleDate')
    const minDate = formatDateInput(addDays(today, -29))
    if (startInput && !startInput.value) startInput.value = currentStartDate
    if (endInput && !endInput.value) endInput.value = currentEndDate
    ;[startInput, endInput, singleInput].filter(Boolean).forEach(input => {
      input.min = minDate
      input.max = currentEndDate
    })
    if (singleInput && !singleInput.value) singleInput.value = currentSingleDate
  }

  function bindFilters(root) {
    const rangeTrigger = document.getElementById('cloudTokenUsageRangeTrigger')
    const rangePopover = document.getElementById('cloudTokenUsageRangePopover')
    const rangeOptions = document.getElementById('cloudTokenUsageRangeOptions')
    const applyRangeBtn = document.getElementById('cloudTokenUsageApplyRangeBtn')
    const applySingleDayBtn = document.getElementById('cloudTokenUsageApplySingleDayBtn')
    const granularityTrigger = document.getElementById('cloudTokenUsageGranularityTrigger')
    const granularityMenu = document.getElementById('cloudTokenUsageGranularityMenu')

    if (rangeTrigger && rangePopover) {
      rangeTrigger.onclick = event => {
        event.stopPropagation()
        closeGranularityMenu()
        togglePopover(rangePopover, rangeTrigger)
      }
    }
    if (rangeOptions) {
      rangeOptions.querySelectorAll('[data-preset]').forEach(button => {
        button.onclick = event => {
          event.stopPropagation()
          currentRangePreset = button.dataset.preset || '7d'
          applyPresetDates(currentRangePreset)
          closeRangePopover()
          updateFilterUi()
          load()
        }
      })
    }
    if (applyRangeBtn) {
      applyRangeBtn.onclick = event => {
        event.stopPropagation()
        const startInput = document.getElementById('cloudTokenUsageStartDate')
        const endInput = document.getElementById('cloudTokenUsageEndDate')
        currentStartDate = clampDateToRecentMonth(startInput?.value || currentStartDate)
        currentEndDate = clampDateToRecentMonth(endInput?.value || currentEndDate)
        if (currentRangePreset === 'custom' || !presetLabels[currentRangePreset]) currentRangePreset = 'custom'
        closeRangePopover()
        updateFilterUi()
        load()
      }
    }
    if (applySingleDayBtn) {
      applySingleDayBtn.onclick = event => {
        event.stopPropagation()
        const singleInput = document.getElementById('cloudTokenUsageSingleDate')
        currentSingleDate = clampDateToRecentMonth(singleInput?.value || currentSingleDate || currentEndDate)
        currentStartDate = currentSingleDate
        currentEndDate = currentSingleDate
        currentRangePreset = 'singleDay'
        currentGranularity = 'hour'
        closeRangePopover()
        updateFilterUi()
        load()
      }
    }
    const startInput = document.getElementById('cloudTokenUsageStartDate')
    const endInput = document.getElementById('cloudTokenUsageEndDate')
    ;[startInput, endInput].filter(Boolean).forEach(input => {
      bindDatePickerOpen(input)
      input.onchange = () => {
        currentRangePreset = 'custom'
        currentStartDate = clampDateToRecentMonth(startInput?.value || currentStartDate)
        currentEndDate = clampDateToRecentMonth(endInput?.value || currentEndDate)
        updateFilterUi()
      }
    })
    const singleInput = document.getElementById('cloudTokenUsageSingleDate')
    if (singleInput) {
      bindDatePickerOpen(singleInput)
      singleInput.onchange = () => {
        currentSingleDate = clampDateToRecentMonth(singleInput.value || currentSingleDate)
        updateFilterUi()
      }
    }

    if (granularityTrigger && granularityMenu) {
      granularityTrigger.onclick = event => {
        event.stopPropagation()
        closeRangePopover()
        togglePopover(granularityMenu, granularityTrigger)
      }
      granularityMenu.querySelectorAll('[data-granularity]').forEach(button => {
        button.onclick = event => {
          event.stopPropagation()
          currentGranularity = button.dataset.granularity || 'day'
          closeGranularityMenu()
          updateFilterUi()
          load()
        }
      })
    }

    document.addEventListener('click', event => {
      const insideRange = event.target.closest?.('#cloudTokenUsageRangeFilter, #cloudTokenUsageRangePopover')
      const insideGranularity = event.target.closest?.('#cloudTokenUsageGranularityFilter, #cloudTokenUsageGranularityMenu')
      if (!insideRange) closeRangePopover()
      if (!insideGranularity) closeGranularityMenu()
    })
    updateFilterUi()
  }

  function bindDatePickerOpen(input) {
    if (!input || input.dataset.pickerClickBound === 'true') return
    input.dataset.pickerClickBound = 'true'
    input.addEventListener('click', event => {
      event.stopPropagation()
      openNativeDatePicker(input)
    })
    input.addEventListener('keydown', event => {
      if (event.key !== 'Enter' && event.key !== ' ') return
      event.preventDefault()
      event.stopPropagation()
      openNativeDatePicker(input)
    })
  }

  function openNativeDatePicker(input) {
    if (!input) return
    input.focus({ preventScroll: true })
    if (typeof input.showPicker === 'function') {
      try {
        input.showPicker()
      } catch (_) {}
    }
  }

  function togglePopover(popover, trigger) {
    const willOpen = popover.hidden
    if (willOpen) attachPopoverToPortal(popover)
    popover.hidden = !willOpen
    trigger?.setAttribute('aria-expanded', willOpen ? 'true' : 'false')
    if (willOpen) positionFloatingPopover(popover, trigger)
  }

  function attachPopoverToPortal(popover) {
    if (!popover || popover.parentElement === document.body) return
    const placeholder = document.createComment(`${popover.id || 'cloud-token-popover'}-placeholder`)
    popover.parentNode.insertBefore(placeholder, popover)
    portalPlaceholders.set(popover, placeholder)
    document.body.appendChild(popover)
  }

  function restorePopoverFromPortal(popover) {
    const placeholder = portalPlaceholders.get(popover)
    if (!popover || !placeholder || !placeholder.parentNode) return
    placeholder.parentNode.insertBefore(popover, placeholder)
    placeholder.remove()
    portalPlaceholders.delete(popover)
  }

  function positionFloatingPopover(popover, trigger) {
    if (!popover || !trigger) return
    const rect = trigger.getBoundingClientRect()
    const margin = 12
    const width = Math.min(380, Math.max(320, window.innerWidth - margin * 2))
    const left = Math.max(margin, Math.min(window.innerWidth - width - margin, rect.right - width))
    popover.style.width = `${width}px`
    popover.style.left = `${left}px`
    popover.style.right = 'auto'
    popover.style.top = `${Math.min(window.innerHeight - margin, rect.bottom + 8)}px`
  }

  function closeRangePopover() {
    const popover = document.getElementById('cloudTokenUsageRangePopover')
    const trigger = document.getElementById('cloudTokenUsageRangeTrigger')
    if (popover) {
      popover.hidden = true
      popover.style.left = ''
      popover.style.right = ''
      popover.style.top = ''
      popover.style.width = ''
      restorePopoverFromPortal(popover)
    }
    trigger?.setAttribute('aria-expanded', 'false')
  }

  function closeGranularityMenu() {
    const menu = document.getElementById('cloudTokenUsageGranularityMenu')
    const trigger = document.getElementById('cloudTokenUsageGranularityTrigger')
    if (menu) {
      menu.hidden = true
      menu.style.left = ''
      menu.style.right = ''
      menu.style.top = ''
      menu.style.width = ''
      restorePopoverFromPortal(menu)
    }
    trigger?.setAttribute('aria-expanded', 'false')
  }

  function updateFilterUi() {
    const rangeText = document.getElementById('cloudTokenUsageRangeText')
    const granularityText = document.getElementById('cloudTokenUsageGranularityText')
    const startInput = document.getElementById('cloudTokenUsageStartDate')
    const endInput = document.getElementById('cloudTokenUsageEndDate')
    const singleInput = document.getElementById('cloudTokenUsageSingleDate')
    if (rangeText) rangeText.textContent = getRangeDisplayText()
    if (granularityText) granularityText.textContent = granularityLabels[currentGranularity] || '按天'
    if (startInput) startInput.value = currentStartDate || startInput.value
    if (endInput) endInput.value = currentEndDate || endInput.value
    if (singleInput) singleInput.value = currentSingleDate || currentEndDate || singleInput.value
    document.querySelectorAll('#cloudTokenUsageRangeOptions [data-preset]').forEach(button => {
      button.classList.toggle('is-active', button.dataset.preset === currentRangePreset)
    })
    document.querySelectorAll('#cloudTokenUsageGranularityMenu [data-granularity]').forEach(button => {
      button.classList.toggle('is-active', button.dataset.granularity === currentGranularity)
    })
  }

  function getRangeDisplayText() {
    if (currentRangePreset === 'singleDay') return `单日 ${formatShortDate(currentSingleDate || currentStartDate)}`
    if (currentRangePreset === 'custom') return `${formatShortDate(currentStartDate)} - ${formatShortDate(currentEndDate)}`
    return presetLabels[currentRangePreset] || '近 7 天'
  }

  function applyPresetDates(preset) {
    const today = startOfDay(new Date())
    let start = today
    let end = today
    if (preset === 'today') {
      start = today
    } else if (preset === 'yesterday') {
      start = addDays(today, -1)
      end = addDays(today, -1)
    } else if (preset === 'last24h') {
      start = addDays(today, -1)
    } else if (preset === '14d') {
      start = addDays(today, -13)
    } else if (preset === '30d') {
      start = addDays(today, -29)
    } else if (preset === '90d') {
      start = addDays(today, -89)
    } else if (preset === 'thisMonth') {
      start = new Date(today.getFullYear(), today.getMonth(), 1)
    } else if (preset === 'lastMonth') {
      start = new Date(today.getFullYear(), today.getMonth() - 1, 1)
      end = new Date(today.getFullYear(), today.getMonth(), 0)
    } else {
      start = addDays(today, -6)
    }
    currentStartDate = formatDateInput(start)
    currentEndDate = formatDateInput(end)
    currentSingleDate = currentEndDate
  }

  function getDaysForPreset(preset) {
    if (preset === 'today' || preset === 'yesterday' || preset === 'singleDay') return 1
    if (preset === 'last24h') return 1
    if (preset === '14d') return 14
    if (preset === '30d') return 30
    if (preset === '90d') return 90
    if (preset === 'thisMonth' || preset === 'lastMonth' || preset === 'custom') return Math.max(1, Math.ceil((parseDateInput(currentEndDate) - parseDateInput(currentStartDate)) / 86400000) + 1)
    return 7
  }

  function startOfDay(date) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate())
  }

  function addDays(date, count) {
    const result = new Date(date)
    result.setDate(result.getDate() + count)
    return result
  }

  function parseDateInput(value) {
    const parsed = new Date(String(value || '').replace(/\//g, '-'))
    return Number.isNaN(parsed.getTime()) ? startOfDay(new Date()) : startOfDay(parsed)
  }

  function clampDateToRecentMonth(value) {
    const today = startOfDay(new Date())
    const min = addDays(today, -29)
    const date = parseDateInput(value)
    if (date < min) return formatDateInput(min)
    if (date > today) return formatDateInput(today)
    return formatDateInput(date)
  }

  function formatDateInput(date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
  }

  function formatShortDate(value) {
    if (!value) return ''
    return value.replace(/-/g, '/').slice(5)
  }

  function formatTokens(value = 0) {
    const num = Number(value || 0)
    if (!Number.isFinite(num) || num <= 0) return '0'
    if (num >= 1000000000) return `${(num / 1000000000).toFixed(num >= 10000000000 ? 1 : 2)}B`
    if (num >= 1000000) return `${(num / 1000000).toFixed(num >= 10000000 ? 1 : 2)}M`
    if (num >= 1000) return `${(num / 1000).toFixed(num >= 10000 ? 1 : 2)}K`
    return String(Math.round(num))
  }

  function formatExactTokens(value = 0) {
    const num = Math.max(0, Math.round(Number(value || 0)))
    if (!Number.isFinite(num)) return '0'
    return num.toLocaleString('en-US')
  }

  function formatPercent(value = 0) {
    const num = Number(value || 0)
    if (!Number.isFinite(num) || num <= 0) return '0%'
    return `${Math.min(100, Math.max(0, num)).toFixed(num >= 10 ? 0 : 1)}%`
  }

  function getCacheParts(source = {}) {
    const usage = source.usage && typeof source.usage === 'object' ? source.usage : source
    const inputTokens = Math.max(0, Number(usage.inputTokens || 0))
    const cachedTokens = Math.max(0, Number(usage.cachedTokens || 0))
    const cacheWriteTokens = Math.max(0, Number(usage.cacheWriteTokens || 0))
    let cacheMissTokens = Math.max(0, Number(usage.cacheMissTokens || 0))
    if (!cacheMissTokens && inputTokens > 0) {
      cacheMissTokens = Math.max(0, inputTokens - cachedTokens - cacheWriteTokens)
    }
    const base = cachedTokens + cacheMissTokens
    const hitRate = Number.isFinite(Number(usage.cacheHitRate))
      ? Number(usage.cacheHitRate)
      : (base > 0 ? (cachedTokens / base) * 100 : 0)
    return { inputTokens, cachedTokens, cacheWriteTokens, cacheMissTokens, hitRate }
  }

  const formatDateTime = FormatUtils.formatDateTime

  const escapeHtml = HtmlUtils.escapeHtml

  function setText(id, value) {
    const el = document.getElementById(id)
    if (el) el.textContent = value
  }

  function renderBucket(prefix, bucket = {}) {
    const cache = getCacheParts(bucket)
    setText(`${prefix}Total`, formatTokens(bucket.totalTokens))
    setText(
      `${prefix}Meta`,
      `输入 ${formatTokens(bucket.inputTokens)} / 输出 ${formatTokens(bucket.outputTokens)} · 命中 ${formatTokens(cache.cachedTokens)} / 未命中 ${formatTokens(cache.cacheMissTokens)} · ${bucket.requests || 0} 次`
    )
  }

  function getRangeLabel(range = {}) {
    if (range.label) return range.label
    const value = Number(range.days || getDaysForPreset(currentRangePreset) || 7)
    if (value === 1) return presetLabels[currentRangePreset] || '1 天'
    return `近 ${value} 天`
  }

  function getChartLabel(item = {}) {
    return item.label || item.date || item.key || ''
  }

  function getPointX(index, total, width, padding) {
    if (total <= 1) return padding.left + (width - padding.left - padding.right) / 2
    return padding.left + index * ((width - padding.left - padding.right) / (total - 1))
  }

  function getPointY(value, max, height, padding) {
    const safeMax = Math.max(1, Number(max || 0))
    return height - padding.bottom - (Number(value || 0) / safeMax) * (height - padding.top - padding.bottom)
  }

  function buildPath(points = []) {
    return points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`).join(' ')
  }

  function buildSmoothPath(points = []) {
    if (points.length < 2) return buildPath(points)
    let pathData = `M ${points[0].x.toFixed(2)} ${points[0].y.toFixed(2)}`
    for (let index = 1; index < points.length; index += 1) {
      const previous = points[index - 2] || points[index - 1]
      const current = points[index - 1]
      const next = points[index]
      const after = points[index + 1] || next
      const control1X = current.x + (next.x - previous.x) / 6
      const control1Y = current.y + (next.y - previous.y) / 6
      const control2X = next.x - (after.x - current.x) / 6
      const control2Y = next.y - (after.y - current.y) / 6
      pathData += ` C ${control1X.toFixed(2)} ${control1Y.toFixed(2)}, ${control2X.toFixed(2)} ${control2Y.toFixed(2)}, ${next.x.toFixed(2)} ${next.y.toFixed(2)}`
    }
    return pathData
  }

  function buildAreaPath(points = [], baseline = 0) {
    if (!points.length) return ''
    return `${buildSmoothPath(points)} L ${points[points.length - 1].x.toFixed(2)} ${baseline.toFixed(2)} L ${points[0].x.toFixed(2)} ${baseline.toFixed(2)} Z`
  }

  function buildTrendDetail(bucket = {}, label = '') {
    const cache = getCacheParts(bucket)
    return `
      <strong>${escapeHtml(label || getChartLabel(bucket))}</strong>
      <span><i class="is-total"></i>总 Token：${formatExactTokens(bucket.totalTokens)}</span>
      <span><i class="is-input"></i>输入 Token：${formatExactTokens(bucket.inputTokens)}</span>
      <span><i class="is-output"></i>输出 Token：${formatExactTokens(bucket.outputTokens)}</span>
      ${bucket._cumulativeTokens !== undefined ? `<span><i class="is-cumulative"></i>累计 Token：${formatExactTokens(bucket._cumulativeTokens)}</span>` : ''}
      <span class="is-cache">缓存命中 ${formatTokens(cache.cachedTokens)} · 命中率 ${formatPercent(cache.hitRate)}</span>
    `
  }

  function bindTrendInteractions(root, data = []) {
    if (clearTrendTooltipHandler) {
      document.removeEventListener('click', clearTrendTooltipHandler)
      clearTrendTooltipHandler = null
    }
    const tooltip = root.querySelector('.cloud-token-chart-tooltip')
    const detail = root.querySelector('.cloud-token-chart-detail')
    const crosshair = root.querySelector('.cloud-token-chart-crosshair')
    const dots = root.querySelectorAll('.cloud-token-chart-dot-trigger')
    const setActive = node => {
      if (!node || !tooltip || !detail) return
      dots.forEach(item => item.classList.toggle('is-active', item === node))
      const index = Number(node.dataset.index || 0)
      const bucket = data[index] || {}
      const label = getChartLabel(bucket)
      tooltip.innerHTML = buildTrendDetail(bucket, label)
      tooltip.style.left = `${node.dataset.tooltipX || 50}%`
      tooltip.style.top = node.dataset.tooltipY || '18%'
      tooltip.classList.add('is-visible')
      detail.innerHTML = buildTrendDetail(bucket, label)
      detail.classList.add('is-visible')
      if (crosshair) {
        const x = node.getAttribute('cx') || '0'
        crosshair.setAttribute('x1', x)
        crosshair.setAttribute('x2', x)
        crosshair.classList.add('is-visible')
      }
    }
    const clearActive = () => {
      dots.forEach(item => item.classList.remove('is-active'))
      crosshair?.classList.remove('is-visible')
      if (tooltip) {
        tooltip.classList.remove('is-visible')
        tooltip.innerHTML = ''
      }
      if (detail) {
        detail.classList.remove('is-visible')
        detail.innerHTML = ''
      }
    }
    dots.forEach(node => {
      node.addEventListener('pointerenter', () => setActive(node))
      node.addEventListener('focus', () => setActive(node))
      node.addEventListener('click', event => {
        event.stopPropagation()
        setActive(node)
      })
      node.addEventListener('keydown', event => {
        if (event.key !== 'Enter' && event.key !== ' ') return
        event.preventDefault()
        setActive(node)
      })
    })
    root.querySelectorAll('[data-token-range-preset]').forEach(button => {
      button.addEventListener('click', event => {
        event.stopPropagation()
        currentRangePreset = button.dataset.tokenRangePreset || '7d'
        currentGranularity = ['today', 'last24h'].includes(currentRangePreset) ? 'hour' : 'day'
        applyPresetDates(currentRangePreset)
        updateFilterUi()
        load()
      })
    })
    root.addEventListener('click', event => {
      if (event.target.closest?.('.cloud-token-chart-dot-trigger, [data-token-range-preset]')) return
      clearActive()
    })
    clearTrendTooltipHandler = event => {
      if (root.contains(event.target)) return
      clearActive()
    }
    document.addEventListener('click', clearTrendTooltipHandler)
  }

  function bindModelDistributionInteractions(root) {
    const items = root.querySelectorAll('.cloud-token-model-row')
    const setActive = node => {
      if (!node) return
      const modelIndex = node.dataset.modelIndex || ''
      items.forEach(item => item.classList.toggle('is-active', item.dataset.modelIndex === modelIndex))
    }
    items.forEach(node => {
      node.addEventListener('focus', () => setActive(node))
      node.addEventListener('click', event => {
        event.stopPropagation()
        setActive(node)
      })
      node.addEventListener('keydown', event => {
        if (event.key !== 'Enter' && event.key !== ' ') return
        event.preventDefault()
        setActive(node)
      })
    })
    if (items[0]) setActive(items[0])
  }

  function renderTrendChart(data = [], range = {}) {
    const el = document.getElementById('cloudTokenUsageTrendChart') || document.getElementById('cloudTokenUsageDailyChart')
    if (!el) return
    if (!data.length) {
      el.innerHTML = '<div class="settings-empty compact">暂无云端 Token 趋势数据</div>'
      return
    }

    const width = 1120
    const height = 430
    const padding = { top: 28, right: 78, bottom: 64, left: 72 }
    const baseline = height - padding.bottom
    let cumulativeTokens = 0
    const chartData = data.map(item => {
      cumulativeTokens += Number(item.totalTokens || 0)
      return { ...item, _cumulativeTokens: cumulativeTokens }
    })
    const totals = chartData.reduce((sum, item) => ({
      totalTokens: sum.totalTokens + Number(item.totalTokens || 0),
      inputTokens: sum.inputTokens + Number(item.inputTokens || 0),
      outputTokens: sum.outputTokens + Number(item.outputTokens || 0),
      requests: sum.requests + Number(item.requests || 0)
    }), { totalTokens: 0, inputTokens: 0, outputTokens: 0, requests: 0 })
    const peak = chartData.reduce((best, item) => Number(item.totalTokens || 0) > Number(best.totalTokens || 0) ? item : best, chartData[0] || {})
    const average = chartData.length ? totals.totalTokens / chartData.length : 0
    const maxTokens = Math.max(1, ...chartData.flatMap(item => [item.totalTokens || 0, item.inputTokens || 0, item.outputTokens || 0]))
    const niceMax = Math.max(1, maxTokens * 1.08)
    const cumulativeMax = Math.max(1, cumulativeTokens)
    const granularity = range.granularity || currentGranularity
    const granularityLabel = granularityLabels[granularity] || '按天'
    const series = [
      { key: 'totalTokens', label: `总 Token（每${granularityLabel.replace('按', '')}）`, color: '#1688ff', gradient: 'total' },
      { key: 'inputTokens', label: `输入 Token（每${granularityLabel.replace('按', '')}）`, color: '#37c978', gradient: 'input' },
      { key: 'outputTokens', label: `输出 Token（每${granularityLabel.replace('按', '')}）`, color: '#f59e0b', gradient: 'output' }
    ]
    const tokenTicks = [0, 0.25, 0.5, 0.75, 1].map(rate => niceMax * rate)
    const cumulativeTicks = [0, 0.25, 0.5, 0.75, 1].map(rate => cumulativeMax * rate)
    const gridLines = tokenTicks.map(value => {
      const y = getPointY(value, niceMax, height, padding)
      return `<line class="cloud-token-chart-grid" x1="${padding.left}" y1="${y}" x2="${width - padding.right}" y2="${y}"></line>`
    }).join('')
    const yLabels = tokenTicks.map(value => {
      const y = getPointY(value, niceMax, height, padding)
      return `<text class="cloud-token-axis-label" x="${padding.left - 14}" y="${y + 4}" text-anchor="end">${formatTokens(value)}</text>`
    }).join('')
    const cumulativeLabels = cumulativeTicks.map(value => {
      const y = getPointY(value, cumulativeMax, height, padding)
      return `<text class="cloud-token-axis-label is-cumulative" x="${width - padding.right + 14}" y="${y + 4}" text-anchor="start">${formatTokens(value)}</text>`
    }).join('')
    const labelStep = Math.max(1, Math.ceil(chartData.length / 10))
    const xLabels = chartData.map((item, index) => {
      if (index !== 0 && index !== chartData.length - 1 && index % labelStep !== 0) return ''
      const x = getPointX(index, chartData.length, width, padding)
      return `<text class="cloud-token-axis-label is-date" x="${x}" y="${height - 30}" text-anchor="middle">${escapeHtml(getChartLabel(item))}</text>`
    }).join('')
    const verticalGrid = chartData.map((item, index) => {
      if (index !== 0 && index !== chartData.length - 1 && index % labelStep !== 0) return ''
      const x = getPointX(index, chartData.length, width, padding)
      return `<line class="cloud-token-chart-grid is-vertical" x1="${x}" y1="${padding.top}" x2="${x}" y2="${baseline}"></line>`
    }).join('')
    const renderedSeries = series.map(item => {
      const points = chartData.map((bucket, index) => ({
        x: getPointX(index, chartData.length, width, padding),
        y: getPointY(Number(bucket[item.key] || 0), niceMax, height, padding)
      }))
      return `
        <path class="cloud-token-chart-area is-${item.gradient}" d="${buildAreaPath(points, baseline)}" fill="url(#cloud-token-gradient-${item.gradient})"></path>
        <path class="cloud-token-chart-line" d="${buildSmoothPath(points)}" style="--series-color:${item.color}"></path>
      `
    }).join('')
    const cumulativePoints = chartData.map((bucket, index) => ({
      x: getPointX(index, chartData.length, width, padding),
      y: getPointY(bucket._cumulativeTokens, cumulativeMax, height, padding)
    }))
    const dots = chartData.map((bucket, index) => {
      const point = {
        x: getPointX(index, chartData.length, width, padding),
        y: getPointY(Number(bucket.totalTokens || 0), niceMax, height, padding)
      }
      const tooltipX = Math.min(91, Math.max(9, (point.x / width) * 100))
      const tooltipY = Math.min(72, Math.max(6, (point.y / height) * 100 - 8))
      const attrs = `tabindex="0" role="button" aria-label="查看 ${escapeHtml(getChartLabel(bucket))} 用量明细" data-index="${index}" data-tooltip-x="${tooltipX.toFixed(2)}" data-tooltip-y="${tooltipY.toFixed(2)}%"`
      return `<circle class="cloud-token-chart-dot cloud-token-chart-dot-trigger" ${attrs} cx="${point.x.toFixed(2)}" cy="${point.y.toFixed(2)}" r="4" style="--series-color:#1688ff"></circle>`
    }).join('')
    const legend = [
      ...series.map(item => `<span><i style="--series-color:${item.color}"></i>${item.label}</span>`),
      '<span><i class="is-dashed" style="--series-color:#1688ff"></i>总 Token（累计）</span>'
    ].join('')
    const metricCards = [
      { tone: 'total', label: '总 Token', value: totals.totalTokens, meta: `${totals.requests} 次云端调用` },
      { tone: 'input', label: '输入 Token', value: totals.inputTokens, meta: `占总量 ${formatPercent(totals.totalTokens ? totals.inputTokens / totals.totalTokens * 100 : 0)}` },
      { tone: 'output', label: '输出 Token', value: totals.outputTokens, meta: `占总量 ${formatPercent(totals.totalTokens ? totals.outputTokens / totals.totalTokens * 100 : 0)}` },
      { tone: 'average', label: `${granularityLabel}平均`, value: average, meta: `${chartData.length} 个数据点` },
      { tone: 'peak', label: `峰值（${granularityLabel.replace('按', '每')}）`, value: peak.totalTokens, meta: `出现于 ${getChartLabel(peak)}` }
    ].map(card => `
      <div class="cloud-token-trend-metric is-${card.tone}">
        <span>${card.label}</span>
        <strong>${formatExactTokens(card.value)}</strong>
        <small>${escapeHtml(card.meta)}</small>
      </div>
    `).join('')
    const shortcuts = [
      ['today', '今天'], ['last24h', '24 小时'], ['7d', '7 天'], ['14d', '14 天'], ['30d', '30 天']
    ].map(([preset, label]) => `<button type="button" data-token-range-preset="${preset}" class="${currentRangePreset === preset ? 'is-active' : ''}">${label}</button>`).join('')
    const rangeTitle = getRangeLabel(range)
    const startLabel = range.startDate || currentStartDate
    const endLabel = range.endDate || currentEndDate

    el.innerHTML = `
      <div class="cloud-token-trend-period">统计时间：${escapeHtml(startLabel || '--')} → ${escapeHtml(endLabel || '--')}</div>
      <div class="cloud-token-trend-metrics">${metricCards}</div>
      <div class="cloud-token-trend-head">
        <div class="cloud-token-trend-axis-title">Token 数量 <span>${escapeHtml(rangeTitle)} · ${escapeHtml(granularityLabel)}</span></div>
        <div class="cloud-token-chart-legend">${legend}</div>
        <div class="cloud-token-trend-axis-title is-right">累计 Token</div>
      </div>
      <div class="cloud-token-chart-stage">
        <svg class="cloud-token-trend-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="Token 使用趋势">
          <defs>
            <linearGradient id="cloud-token-gradient-total" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1688ff" stop-opacity=".38"></stop><stop offset="1" stop-color="#1688ff" stop-opacity=".02"></stop></linearGradient>
            <linearGradient id="cloud-token-gradient-input" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#37c978" stop-opacity=".34"></stop><stop offset="1" stop-color="#37c978" stop-opacity=".015"></stop></linearGradient>
            <linearGradient id="cloud-token-gradient-output" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f59e0b" stop-opacity=".34"></stop><stop offset="1" stop-color="#f59e0b" stop-opacity=".015"></stop></linearGradient>
          </defs>
          <rect class="cloud-token-chart-bg" x="${padding.left}" y="${padding.top}" width="${width - padding.left - padding.right}" height="${height - padding.top - padding.bottom}" rx="10"></rect>
          ${gridLines}${verticalGrid}
          <line class="cloud-token-chart-axis" x1="${padding.left}" y1="${baseline}" x2="${width - padding.right}" y2="${baseline}"></line>
          <line class="cloud-token-chart-axis" x1="${padding.left}" y1="${padding.top}" x2="${padding.left}" y2="${baseline}"></line>
          <line class="cloud-token-chart-axis" x1="${width - padding.right}" y1="${padding.top}" x2="${width - padding.right}" y2="${baseline}"></line>
          ${yLabels}${cumulativeLabels}${xLabels}
          ${renderedSeries}
          <path class="cloud-token-chart-line is-dashed" d="${buildSmoothPath(cumulativePoints)}" style="--series-color:#1688ff"></path>
          <line class="cloud-token-chart-crosshair" y1="${padding.top}" y2="${baseline}"></line>
          ${dots}
        </svg>
        <div class="cloud-token-chart-tooltip" role="status"></div>
      </div>
      <div class="cloud-token-trend-footer">
        <div class="cloud-token-trend-shortcuts">${shortcuts}</div>
        <div class="cloud-token-trend-update">数据更新时间：${new Date().toLocaleString('zh-CN', { hour12: false })}</div>
      </div>
      <div class="cloud-token-chart-detail" aria-live="polite"></div>
    `
    bindTrendInteractions(el, chartData)
  }

  function getSortIcon(tab, key) {
    const state = detailSort[tab] || {}
    if (state.key !== key) return '<span class="cloud-token-sort-icon" aria-hidden="true"></span>'
    return `<span class="cloud-token-sort-icon is-active is-${state.dir}" aria-hidden="true"></span>`
  }

  function sortRows(rows = [], tab = 'models') {
    const state = detailSort[tab] || { key: 'totalTokens', dir: 'desc' }
    const key = state.key
    const dir = state.dir === 'asc' ? 1 : -1
    return rows.slice().sort((a, b) => {
      const av = getSortValue(a, tab, key)
      const bv = getSortValue(b, tab, key)
      if (typeof av === 'string' || typeof bv === 'string') {
        return String(av).localeCompare(String(bv), 'zh-CN') * dir
      }
      return (Number(av) - Number(bv)) * dir
    })
  }

  function getSortValue(item = {}, tab = 'models', key = 'totalTokens') {
    if (tab === 'recent') {
      const cache = getCacheParts(item)
      if (key === 'createdAt') return Date.parse(item.createdAt || 0) || 0
      if (key === 'model') return item.modelName || item.modelKey || ''
      if (key === 'task') return taskLabels[item.taskType] || item.taskType || ''
      if (key === 'inputTokens') return Number(item.usage?.inputTokens || 0)
      if (key === 'outputTokens') return Number(item.usage?.outputTokens || 0)
      if (key === 'cachedTokens') return cache.cachedTokens
      if (key === 'cacheMissTokens') return cache.cacheMissTokens
      if (key === 'cacheWriteTokens') return cache.cacheWriteTokens
      if (key === 'hitRate') return cache.hitRate
      if (key === 'totalTokens') return Number(item.usage?.totalTokens || 0)
      return Number(item.usage?.totalTokens || 0)
    }
    if (key === 'name') {
      if (tab === 'tasks') return taskLabels[item.taskType] || item.taskType || ''
      return item.modelName || item.modelKey || ''
    }
    if (key === 'requests') return Number(item.requests || 0)
    if (key === 'inputTokens') return Number(item.inputTokens || 0)
    if (key === 'outputTokens') return Number(item.outputTokens || 0)
    if (key === 'cachedTokens') return getCacheParts(item).cachedTokens
    if (key === 'cacheMissTokens') return getCacheParts(item).cacheMissTokens
    if (key === 'cacheWriteTokens') return getCacheParts(item).cacheWriteTokens
    if (key === 'hitRate') return getCacheParts(item).hitRate
    if (key === 'share') return Number(item.totalTokens || 0)
    return Number(item.totalTokens || 0)
  }

  function bindDetailSort(root) {
    root.querySelectorAll('[data-sort-key]').forEach(button => {
      button.onclick = () => {
        const key = button.dataset.sortKey || 'totalTokens'
        const tab = button.dataset.sortTab || detailTab
        const current = detailSort[tab] || { key: 'totalTokens', dir: 'desc' }
        if (current.key === key) {
          detailSort[tab] = { key, dir: current.dir === 'desc' ? 'asc' : 'desc' }
        } else {
          detailSort[tab] = { key, dir: key === 'name' || key === 'model' || key === 'task' || key === 'createdAt' ? 'asc' : 'desc' }
        }
        renderDetailTable()
      }
    })
  }

  function renderDetailTable() {
    const el = document.getElementById('cloudTokenDetailTable')
    const hint = document.getElementById('cloudTokenDetailHint')
    if (!el) return
    const totalTokens = Math.max(1, Number(detailCache.totalTokens || 0))
    if (detailTab === 'tasks') {
      const rows = sortRows(detailCache.tasks || [], 'tasks')
      if (hint) hint.textContent = `任务明细 · ${rows.length} 项`
      if (!rows.length) {
        el.innerHTML = '<div class="settings-empty compact">暂无任务消耗记录</div>'
        return
      }
      el.innerHTML = `
        <div class="cloud-token-table-scroll">
          <table class="cloud-token-data-table">
            <thead>
              <tr>
                <th><button type="button" data-sort-tab="tasks" data-sort-key="name">任务${getSortIcon('tasks', 'name')}</button></th>
                <th class="is-num"><button type="button" data-sort-tab="tasks" data-sort-key="requests">次数${getSortIcon('tasks', 'requests')}</button></th>
                <th class="is-num"><button type="button" data-sort-tab="tasks" data-sort-key="inputTokens">输入${getSortIcon('tasks', 'inputTokens')}</button></th>
                <th class="is-num"><button type="button" data-sort-tab="tasks" data-sort-key="cachedTokens">命中${getSortIcon('tasks', 'cachedTokens')}</button></th>
                <th class="is-num"><button type="button" data-sort-tab="tasks" data-sort-key="cacheMissTokens">未命中${getSortIcon('tasks', 'cacheMissTokens')}</button></th>
                <th class="is-num"><button type="button" data-sort-tab="tasks" data-sort-key="hitRate">命中率${getSortIcon('tasks', 'hitRate')}</button></th>
                <th class="is-num"><button type="button" data-sort-tab="tasks" data-sort-key="outputTokens">输出${getSortIcon('tasks', 'outputTokens')}</button></th>
                <th class="is-num"><button type="button" data-sort-tab="tasks" data-sort-key="totalTokens">总量${getSortIcon('tasks', 'totalTokens')}</button></th>
                <th class="is-num"><button type="button" data-sort-tab="tasks" data-sort-key="share">占比${getSortIcon('tasks', 'share')}</button></th>
              </tr>
            </thead>
            <tbody>
              ${rows.map(item => {
                const share = Number(item.totalTokens || 0) / totalTokens * 100
                const cache = getCacheParts(item)
                return `
                  <tr>
                    <td class="is-name">${escapeHtml(taskLabels[item.taskType] || item.taskType || '其他任务')}</td>
                    <td class="is-num">${formatExactTokens(item.requests || 0)}</td>
                    <td class="is-num">${formatExactTokens(item.inputTokens)}</td>
                    <td class="is-num is-hit">${formatExactTokens(cache.cachedTokens)}</td>
                    <td class="is-num is-miss">${formatExactTokens(cache.cacheMissTokens)}</td>
                    <td class="is-num is-rate">${formatPercent(cache.hitRate)}</td>
                    <td class="is-num">${formatExactTokens(item.outputTokens)}</td>
                    <td class="is-num is-strong">${formatExactTokens(item.totalTokens)}</td>
                    <td class="is-num">${formatPercent(share)}</td>
                  </tr>
                `
              }).join('')}
            </tbody>
          </table>
        </div>
      `
      bindDetailSort(el)
      return
    }

    if (detailTab === 'recent') {
      const rows = sortRows(detailCache.recent || [], 'recent')
      if (hint) hint.textContent = `最近调用 · ${rows.length} 条`
      if (!rows.length) {
        el.innerHTML = '<div class="settings-empty compact">暂无最近调用记录</div>'
        return
      }
      el.innerHTML = `
        <div class="cloud-token-table-scroll">
          <table class="cloud-token-data-table is-recent">
            <thead>
              <tr>
                <th><button type="button" data-sort-tab="recent" data-sort-key="createdAt">时间${getSortIcon('recent', 'createdAt')}</button></th>
                <th><button type="button" data-sort-tab="recent" data-sort-key="model">模型${getSortIcon('recent', 'model')}</button></th>
                <th><button type="button" data-sort-tab="recent" data-sort-key="task">任务${getSortIcon('recent', 'task')}</button></th>
                <th class="is-num"><button type="button" data-sort-tab="recent" data-sort-key="inputTokens">输入${getSortIcon('recent', 'inputTokens')}</button></th>
                <th class="is-num"><button type="button" data-sort-tab="recent" data-sort-key="cachedTokens">命中${getSortIcon('recent', 'cachedTokens')}</button></th>
                <th class="is-num"><button type="button" data-sort-tab="recent" data-sort-key="cacheMissTokens">未命中${getSortIcon('recent', 'cacheMissTokens')}</button></th>
                <th class="is-num"><button type="button" data-sort-tab="recent" data-sort-key="hitRate">命中率${getSortIcon('recent', 'hitRate')}</button></th>
                <th class="is-num"><button type="button" data-sort-tab="recent" data-sort-key="outputTokens">输出${getSortIcon('recent', 'outputTokens')}</button></th>
                <th class="is-num"><button type="button" data-sort-tab="recent" data-sort-key="totalTokens">总量${getSortIcon('recent', 'totalTokens')}</button></th>
              </tr>
            </thead>
            <tbody>
              ${rows.map(item => {
                const cache = getCacheParts(item)
                return `
                <tr>
                  <td class="is-time">${escapeHtml(formatDateTime(item.createdAt))}</td>
                  <td class="is-name">${escapeHtml(item.modelName || item.modelKey || '云端模型')}</td>
                  <td>${escapeHtml(taskLabels[item.taskType] || item.taskType || '调用')}</td>
                  <td class="is-num">${formatExactTokens(item.usage?.inputTokens)}</td>
                  <td class="is-num is-hit">${formatExactTokens(cache.cachedTokens)}</td>
                  <td class="is-num is-miss">${formatExactTokens(cache.cacheMissTokens)}</td>
                  <td class="is-num is-rate">${formatPercent(cache.hitRate)}</td>
                  <td class="is-num">${formatExactTokens(item.usage?.outputTokens)}</td>
                  <td class="is-num is-strong">${formatExactTokens(item.usage?.totalTokens)}</td>
                </tr>
              `
              }).join('')}
            </tbody>
          </table>
        </div>
      `
      bindDetailSort(el)
      return
    }

    const rows = sortRows(detailCache.models || [], 'models')
    if (hint) hint.textContent = `模型明细 · ${rows.length} 项 · 含命中/未命中`
    if (!rows.length) {
      el.innerHTML = '<div class="settings-empty compact">暂无云端模型用量记录</div>'
      return
    }
    el.innerHTML = `
      <div class="cloud-token-table-scroll">
        <table class="cloud-token-data-table">
          <thead>
            <tr>
              <th><button type="button" data-sort-tab="models" data-sort-key="name">模型${getSortIcon('models', 'name')}</button></th>
              <th class="is-num"><button type="button" data-sort-tab="models" data-sort-key="requests">次数${getSortIcon('models', 'requests')}</button></th>
              <th class="is-num"><button type="button" data-sort-tab="models" data-sort-key="inputTokens">输入${getSortIcon('models', 'inputTokens')}</button></th>
              <th class="is-num"><button type="button" data-sort-tab="models" data-sort-key="cachedTokens">命中${getSortIcon('models', 'cachedTokens')}</button></th>
              <th class="is-num"><button type="button" data-sort-tab="models" data-sort-key="cacheMissTokens">未命中${getSortIcon('models', 'cacheMissTokens')}</button></th>
              <th class="is-num"><button type="button" data-sort-tab="models" data-sort-key="cacheWriteTokens">写入${getSortIcon('models', 'cacheWriteTokens')}</button></th>
              <th class="is-num"><button type="button" data-sort-tab="models" data-sort-key="hitRate">命中率${getSortIcon('models', 'hitRate')}</button></th>
              <th class="is-num"><button type="button" data-sort-tab="models" data-sort-key="outputTokens">输出${getSortIcon('models', 'outputTokens')}</button></th>
              <th class="is-num"><button type="button" data-sort-tab="models" data-sort-key="totalTokens">总量${getSortIcon('models', 'totalTokens')}</button></th>
              <th class="is-num"><button type="button" data-sort-tab="models" data-sort-key="share">占比${getSortIcon('models', 'share')}</button></th>
            </tr>
          </thead>
          <tbody>
            ${rows.map((item, index) => {
              const share = Number(item.totalTokens || 0) / totalTokens * 100
              const cache = getCacheParts(item)
              const color = ['#2563eb', '#16a34a', '#8b5cf6', '#f59e0b', '#06b6d4', '#ef4444', '#64748b', '#14b8a6'][index % 8]
              return `
                <tr>
                  <td class="is-name">
                    <span class="cloud-token-table-dot" style="--model-color:${color}"></span>
                    <span>${escapeHtml(item.modelName || item.modelKey || '云端模型')}</span>
                  </td>
                  <td class="is-num">${formatExactTokens(item.requests || 0)}</td>
                  <td class="is-num">${formatExactTokens(item.inputTokens)}</td>
                  <td class="is-num is-hit">${formatExactTokens(cache.cachedTokens)}</td>
                  <td class="is-num is-miss">${formatExactTokens(cache.cacheMissTokens)}</td>
                  <td class="is-num">${formatExactTokens(cache.cacheWriteTokens)}</td>
                  <td class="is-num is-rate">${formatPercent(cache.hitRate)}</td>
                  <td class="is-num">${formatExactTokens(item.outputTokens)}</td>
                  <td class="is-num is-strong">${formatExactTokens(item.totalTokens)}</td>
                  <td class="is-num">
                    <span class="cloud-token-share-cell">
                      <span class="cloud-token-share-bar" aria-hidden="true"><i style="width:${Math.min(100, Math.max(0, share)).toFixed(2)}%; background:${color}"></i></span>
                      <span>${formatPercent(share)}</span>
                    </span>
                  </td>
                </tr>
              `
            }).join('')}
          </tbody>
        </table>
      </div>
    `
    bindDetailSort(el)
  }

  function renderTaskList(tasks = []) {
    detailCache.tasks = Array.isArray(tasks) ? tasks : []
    if (detailTab === 'tasks') renderDetailTable()
  }

  function renderRecent(records = []) {
    detailCache.recent = Array.isArray(records) ? records : []
    if (detailTab === 'recent') renderDetailTable()
  }

  function buildRequestOptions() {
    return {
      preset: currentRangePreset,
      days: getDaysForPreset(currentRangePreset),
      startDate: currentStartDate,
      endDate: currentEndDate,
      granularity: currentGranularity || 'day'
    }
  }

  async function load() {
    const status = document.getElementById('cloudTokenUsageStatus')
    if (!window.api?.getCloudTokenUsageSummary) {
      if (status) status.textContent = '当前版本不支持读取云端 Token 统计'
      return
    }
    if (status) status.textContent = '正在读取云端 Token 统计...'
    try {
      const result = await window.api.getCloudTokenUsageSummary(buildRequestOptions())
      if (!result?.success) throw new Error(result?.error || '读取失败')
      const data = result.data || {}
      renderBucket('cloudTokenToday', data.today)
      renderBucket('cloudTokenWeek', data.week)
      renderBucket('cloudTokenMonth', data.month)
      renderBucket('cloudTokenTotal', data.total)
      const rangeTotal = data.rangeTotal || {}
      renderTrendChart(data.trend || data.daily || [], data.range || {})
      const rangeTokens = Number(rangeTotal.totalTokens || 0) || (Array.isArray(data.byModel)
        ? data.byModel.reduce((sum, item) => sum + Number(item.totalTokens || 0), 0)
        : 0)
      detailCache = {
        models: Array.isArray(data.byModel) ? data.byModel : [],
        tasks: Array.isArray(data.byTask) ? data.byTask : [],
        recent: Array.isArray(data.recent) ? data.recent : [],
        totalTokens: rangeTokens || Number(data.total?.totalTokens || 0)
      }
      renderDetailTable()
      const cache = getCacheParts(rangeTotal)
      if (status) {
        status.textContent = `仅统计云端模型，本地部署模型不计入。当前显示：${getRangeLabel(data.range || {})}，${granularityLabels[data.range?.granularity || currentGranularity] || '按天'}。缓存命中 ${formatExactTokens(cache.cachedTokens)} / 未命中 ${formatExactTokens(cache.cacheMissTokens)} · 命中率 ${formatPercent(cache.hitRate)}。命中率仅供参考，详情请查阅官方数据。`
      }
    } catch (error) {
      if (status) status.textContent = error.message || '读取云端 Token 统计失败'
    }
  }

  window.CloudTokenUsageSettings = { bind }
})()
