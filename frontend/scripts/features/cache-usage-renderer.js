// 缓存使用量渲染模块
// 负责在输入框下方显示"本轮缓存命中 X Token · 命中率 Y%"等提示条。
// 通过 window.CacheUsageRenderer.bind(deps) 注入依赖后使用。

(function () {
  let escapeHtmlFn = null
  let syncChatBottomInsetFn = null
  let getActiveProjectId = null

  function getStrip() {
    return document.getElementById('cacheUsageStrip')
  }

  function formatCompactTokenCount(value) {
    const number = Number(value)
    if (!Number.isFinite(number) || number <= 0) return '0'
    if (number >= 1000000) return `${(number / 1000000).toFixed(number >= 10000000 ? 0 : 1)}M`
    if (number >= 10000) return `${Math.round(number / 1000)}K`
    if (number >= 1000) return `${(number / 1000).toFixed(1)}K`
    return String(Math.round(number))
  }

  function calculateCacheHitRate(cachedTokens, inputTokens, cacheMissTokens, providerRate) {
    const cached = Math.max(0, Number(cachedTokens || 0))
    const input = Math.max(0, Number(inputTokens || 0))
    const explicitMiss = Math.max(0, Number(cacheMissTokens || 0))
    let miss = explicitMiss
    if (!miss && input > 0) {
      // cached 大于 input 时，云端的 input 表示未命中量，而不是总输入量。
      miss = input >= cached ? Math.max(0, input - cached) : input
    }
    const base = cached + miss
    if (base > 0) return Math.min(100, Math.max(0, Math.round((cached / base) * 100)))
    const upstream = Number(providerRate)
    if (!Number.isFinite(upstream)) return null
    return Math.min(100, Math.max(0, Math.round(upstream)))
  }

  let suppressCacheUsageRender = false

  function setCacheUsageText(text, state = 'muted') {
    if (suppressCacheUsageRender) return
    const cacheUsageStrip = getStrip()
    if (!cacheUsageStrip) return
    const value = String(text || '').trim()
    if (!value) {
      cacheUsageStrip.hidden = true
      cacheUsageStrip.innerHTML = ''
      cacheUsageStrip.className = 'cache-usage-strip'
      return
    }
    cacheUsageStrip.hidden = false
    cacheUsageStrip.className = `cache-usage-strip cache-usage-${state}`
    const escaped = escapeHtmlFn ? escapeHtmlFn(value) : value
    cacheUsageStrip.innerHTML = `<span class="cache-usage-dot"></span><span>${escaped}</span>`
    if (syncChatBottomInsetFn) syncChatBottomInsetFn()
  }

  function createCacheUsageViewState() {
    return {
      running: false,
      cached: 0,
      written: 0,
      input: 0,
      output: 0,
      cacheMiss: 0,
      costText: '',
      costSupported: false,
      cacheRate: null,
      cacheRateReliable: false,
      latestRequestCacheRate: null,
      supported: false,
      stabilityText: '',
      lastText: '',
      lastState: 'muted'
    }
  }

  const cacheUsageViewStates = new Map()
  let cacheUsageViewState = createCacheUsageViewState()

  function getCacheUsageViewState(projectId) {
    const fallback = getActiveProjectId ? getActiveProjectId() : 'default'
    const key = String(projectId || fallback || 'default')
    if (!cacheUsageViewStates.has(key)) {
      cacheUsageViewStates.set(key, createCacheUsageViewState())
    }
    return cacheUsageViewStates.get(key)
  }

  function withCacheUsageViewState(projectId, fn) {
    const previousState = cacheUsageViewState
    cacheUsageViewState = getCacheUsageViewState(projectId)
    try {
      return fn(cacheUsageViewState)
    } finally {
      cacheUsageViewState = previousState
    }
  }

  function resetCacheUsageViewState() {
    cacheUsageViewState.running = false
    cacheUsageViewState.cached = 0
    cacheUsageViewState.written = 0
    cacheUsageViewState.input = 0
    cacheUsageViewState.output = 0
    cacheUsageViewState.cacheMiss = 0
    cacheUsageViewState.costText = ''
    cacheUsageViewState.costSupported = false
    cacheUsageViewState.cacheRate = null
    cacheUsageViewState.cacheRateReliable = false
    cacheUsageViewState.latestRequestCacheRate = null
    cacheUsageViewState.supported = false
    cacheUsageViewState.stabilityText = ''
    cacheUsageViewState.lastText = ''
    cacheUsageViewState.lastState = 'muted'
  }

  function getCacheStabilitySuffix() {
    return cacheUsageViewState.stabilityText ? ` · ${cacheUsageViewState.stabilityText}` : ''
  }

  function formatCacheSegmentName(name = '') {
    const value = String(name || '')
    const systemMatch = value.match(/^system\.(\d+)$/)
    if (systemMatch) return `系统块${systemMatch[1]}`
    const map = {
      tools: '工具',
      messages: '消息',
      'messages.history': '历史消息',
      'messages.latest': '最新消息',
      'messages.timeline': '消息结构',
      parameters: '参数'
    }
    return map[value] || value
  }

  function formatPromptStabilityText(stability = {}) {
    const cachePrefix = stability?.cachePrefix || {}
    const reusablePercent = Number(cachePrefix.reusablePercent)
    if (!Number.isFinite(reusablePercent) || stability.firstSeen) return ''
    const bounded = Math.min(100, Math.max(0, Math.round(reusablePercent)))
    return `本地前缀 ${bounded}%`
  }

  function showCacheUsageSnapshot(options = {}) {
    const suffix = cacheUsageViewState.running && !options.final ? ' · 统计中' : ''
    const stabilitySuffix = getCacheStabilitySuffix()
    const costSuffix = cacheUsageViewState.costText
      ? ` · 预计 ${cacheUsageViewState.costText}`
      : (cacheUsageViewState.costSupported && cacheUsageViewState.running && !options.final ? ' · 费用预算中' : '')
    if (cacheUsageViewState.cached > 0) {
      const rateText = cacheUsageViewState.cacheRateReliable && cacheUsageViewState.cacheRate !== null
        ? ` · 上游累计 ${cacheUsageViewState.cacheRate}%`
        : (cacheUsageViewState.running && !options.final ? ' · 上游命中统计中' : '')
      const requestRateText = Number.isFinite(cacheUsageViewState.latestRequestCacheRate)
        ? ` · 本次 ${cacheUsageViewState.latestRequestCacheRate}%`
        : ''
      const text = `上游缓存读取 ${formatCompactTokenCount(cacheUsageViewState.cached)} Token${rateText}${requestRateText}${cacheUsageViewState.cacheRateReliable ? suffix : ''}${costSuffix}${stabilitySuffix}`
      cacheUsageViewState.lastText = text
      cacheUsageViewState.lastState = 'hit'
      setCacheUsageText(text, 'hit')
      return true
    }
    if (cacheUsageViewState.written > 0) {
      const text = `已写入缓存 ${formatCompactTokenCount(cacheUsageViewState.written)} Token${suffix}${costSuffix}${stabilitySuffix}`
      cacheUsageViewState.lastText = text
      cacheUsageViewState.lastState = 'pending'
      setCacheUsageText(text, 'pending')
      return true
    }
    if (cacheUsageViewState.input > 0) {
      const text = `本轮输入 ${formatCompactTokenCount(cacheUsageViewState.input)} Token · 暂无命中${suffix}${costSuffix}${stabilitySuffix}`
      cacheUsageViewState.lastText = text
      cacheUsageViewState.lastState = 'muted'
      setCacheUsageText(text, 'muted')
      return true
    }
    return false
  }

  function resetCacheUsageStrip() {
    const activeProjectId = getActiveProjectId ? getActiveProjectId() : undefined
    withCacheUsageViewState(activeProjectId, () => {
      resetCacheUsageViewState()
    })
    setCacheUsageText('', 'muted')
  }

  function renderActiveCacheUsageStrip() {
    const activeProjectId = getActiveProjectId ? getActiveProjectId() : undefined
    withCacheUsageViewState(activeProjectId, state => {
      if (state.lastText) {
        setCacheUsageText(state.lastText, state.lastState || 'muted')
        return
      }
      if (!showCacheUsageSnapshot({ final: !state.running })) {
        setCacheUsageText('', 'muted')
      }
    })
  }

  function renderCacheUsage(data = {}) {
    if (!data) return
    const activeProjectId = getActiveProjectId ? getActiveProjectId() : undefined
    const targetProjectId = data.projectId || activeProjectId || 'default'
    const shouldRender = !data.projectId || data.projectId === activeProjectId
    return withCacheUsageViewState(targetProjectId, () => {
      const previousSuppressCacheUsageRender = suppressCacheUsageRender
      suppressCacheUsageRender = !shouldRender
      try {
        if (data.phase === 'request-start') {
          cacheUsageViewState.running = true
          cacheUsageViewState.costSupported = cacheUsageViewState.costSupported || !!data.costSupported || !!data.costEstimate
          if (!showCacheUsageSnapshot()) {
            setCacheUsageText(cacheUsageViewState.costSupported ? '缓存命中观测中 · 费用预算中' : '缓存命中观测中', 'pending')
          }
          return
        }
        if (data.phase === 'stability') {
          const text = formatPromptStabilityText(data.stability)
          if (text) cacheUsageViewState.stabilityText = text
          if (!showCacheUsageSnapshot()) {
            setCacheUsageText(cacheUsageViewState.stabilityText || '缓存体检中', data.stability?.stable ? 'hit' : 'pending')
          }
          return
        }
        if (data.phase === 'unsupported') {
          if (!showCacheUsageSnapshot()) {
            setCacheUsageText('当前模型未返回缓存用量', 'muted')
          }
          return
        }
        if (data.phase === 'error') {
          cacheUsageViewState.running = false
          if (!showCacheUsageSnapshot({ final: true })) {
            setCacheUsageText('缓存用量未完成统计', 'muted')
          }
          return
        }
        const current = data.current || {}
        const cached = Number(data.cachedTokens || 0) + Number(current.cachedTokens || 0)
        const written = Number(data.cacheWriteTokens || 0) + Number(current.cacheWriteTokens || 0)
        const input = Number(data.inputTokens || 0) + Number(current.inputTokens || 0)
        const output = Number(data.outputTokens || 0) + Number(current.outputTokens || 0)
        const cacheMiss = Number(data.cacheMissTokens || 0) + Number(current.cacheMissTokens || 0)
        const providerRate = Number(data.cacheRate)
        const rate = calculateCacheHitRate(cached, input, cacheMiss, providerRate)
        cacheUsageViewState.cached = Math.max(cacheUsageViewState.cached, cached)
        cacheUsageViewState.written = Math.max(cacheUsageViewState.written, written)
        cacheUsageViewState.input = Math.max(cacheUsageViewState.input, input)
        cacheUsageViewState.output = Math.max(cacheUsageViewState.output, output)
        cacheUsageViewState.cacheMiss = Math.max(cacheUsageViewState.cacheMiss, cacheMiss)
        cacheUsageViewState.costSupported = cacheUsageViewState.costSupported || !!data.costSupported || !!data.costEstimate
        if (data.costEstimate?.amountText) cacheUsageViewState.costText = data.costEstimate.amountText
        if (rate !== null) {
          cacheUsageViewState.cacheRate = rate
          cacheUsageViewState.cacheRateReliable = true
        }
        const latestRequestCacheRate = Number(data.latestRequestCacheRate)
        if (data.latestRequestCacheRate !== null && data.latestRequestCacheRate !== undefined && Number.isFinite(latestRequestCacheRate)) {
          cacheUsageViewState.latestRequestCacheRate = Math.min(100, Math.max(0, Math.round(latestRequestCacheRate)))
        }
        cacheUsageViewState.supported = cacheUsageViewState.supported || !!data.supported || cached > 0 || written > 0
        if (data.phase === 'done') cacheUsageViewState.running = false
        if (showCacheUsageSnapshot({ final: data.phase === 'done' })) return
        if (cached > 0) {
          const rateText = rate !== null ? ` · 上游累计 ${rate}%` : ' · 上游命中统计中'
          const requestRateText = Number.isFinite(cacheUsageViewState.latestRequestCacheRate)
            ? ` · 本次 ${cacheUsageViewState.latestRequestCacheRate}%`
            : ''
          setCacheUsageText(`上游缓存读取 ${formatCompactTokenCount(cached)} Token${rateText}${requestRateText}${getCacheStabilitySuffix()}`, 'hit')
          return
        }
        if (written > 0) {
          setCacheUsageText(`已写入缓存 ${formatCompactTokenCount(written)} Token`, 'pending')
          return
        }
        if (input > 0) {
          setCacheUsageText(`本轮输入 ${formatCompactTokenCount(input)} Token · 暂无命中`, 'muted')
          return
        }
        if (data.phase === 'done') {
          setCacheUsageText('服务商未返回缓存指标', 'muted')
        }
      } finally {
        suppressCacheUsageRender = previousSuppressCacheUsageRender
      }
    })
  }

  function bind(deps = {}) {
    if (typeof deps.escapeHtml === 'function') escapeHtmlFn = deps.escapeHtml
    if (typeof deps.syncChatBottomInset === 'function') syncChatBottomInsetFn = deps.syncChatBottomInset
    if (typeof deps.getActiveProjectId === 'function') getActiveProjectId = deps.getActiveProjectId
  }

  window.CacheUsageRenderer = {
    bind,
    formatCompactTokenCount,
    calculateCacheHitRate,
    formatPromptStabilityText,
    setCacheUsageText,
    createCacheUsageViewState,
    withCacheUsageViewState,
    resetCacheUsageViewState,
    resetCacheUsageStrip,
    renderActiveCacheUsageStrip,
    renderCacheUsage
  }
})()
