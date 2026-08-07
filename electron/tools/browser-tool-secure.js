/**
 * 浏览器控制工具（安全加固版本）
 * 修复了SSRF、XSS、路径遍历等安全漏洞
 */

const electron = require('electron')
const shell = electron.shell
const BrowserWindow = electron.BrowserWindow
const electronApp = electron.app
const https = require('https')
const http = require('http')
const crypto = require('crypto')
const { URL } = require('url')
const { URLValidator, SensitiveDataDetector, ResponseLimiter, InputValidator } = require('./security-patch')
const config = require('../modules/config')

class BrowserToolSecure {
  constructor() {
    this.timeout = 30000
    this.activePageInfo = null
    
    // 安全组件
    this.urlValidator = new URLValidator()
    this.sensitiveDetector = new SensitiveDataDetector()
    this.responseLimiter = new ResponseLimiter({
      maxSize: 10 * 1024 * 1024,  // 10MB
      maxRedirects: 5,
      timeout: 30000
    })
    
    // 安全配置
    this.securityConfig = {
      enableDNSCheck: true,       // 启用DNS重绑定检查
      enablePrivateIPBlock: true, // 禁止私有IP
      enableSensitiveMask: true,  // 启用敏感信息遮蔽
      enableURLWhitelist: false,  // URL白名单（可选）
      urlWhitelist: []            // 白名单域名列表
    }
    
    // 统计信息
    this.stats = {
      totalRequests: 0,
      blockedRequests: 0,
      sanitizedResponses: 0,
      cacheHits: 0,
      renderedFetches: 0,
      renderedSearches: 0
    }
    this.searchCache = new Map()
    this.fetchCache = new Map()
    this.cacheTtlMs = 10 * 60 * 1000
    this.renderTimeoutMs = 25000
    this.renderWaitMs = 12000
  }

  /**
   * 搜索（优先国内搜索引擎）
   * @param {string} query - 搜索关键词
   * @param {string} engine - 搜索引擎
   * @returns {Promise<object>} 搜索结果
   */
  async search(query, engine = 'auto') {
    // 1. 输入验证
    const validationResult = InputValidator.validateString(query, {
      minLength: 1,
      maxLength: 500,
      name: '搜索关键词'
    })
    
    if (!validationResult.valid) {
      return { success: false, error: validationResult.error }
    }
    
    // 2. 清理输入
    const sanitizedQuery = InputValidator.sanitize(query)
    const requestedEngine = String(engine || 'auto').trim().toLowerCase()
    const cached = this._getCachedSearch(sanitizedQuery, requestedEngine)
    if (cached) return cached

    const result = requestedEngine === 'auto'
      ? await this._searchAuto(sanitizedQuery)
      : await this._searchSequential(sanitizedQuery, requestedEngine)
    this._setCachedSearch(sanitizedQuery, requestedEngine, result)
    return result
  }

  async searchMany(queries = [], engine = 'auto') {
    const normalizedQueries = this._normalizeSearchQueries(queries)
    if (!normalizedQueries.length) {
      return { success: false, error: 'missing queries', queries: [] }
    }

    if (normalizedQueries.length === 1) {
      const result = await this.search(normalizedQueries[0], engine)
      return { ...result, queries: normalizedQueries, batch: false }
    }

    const requestedEngine = String(engine || 'auto').trim().toLowerCase()
    const settled = await Promise.all(normalizedQueries.map(async query => {
      try {
        return await this.search(query, requestedEngine)
      } catch (error) {
        return { success: false, query, engine: requestedEngine, results: [], error: error.message }
      }
    }))

    const merged = []
    for (const item of settled) {
      if (!item?.success || !Array.isArray(item.results)) continue
      for (const result of item.results) {
        merged.push({
          ...result,
          sourceQuery: item.query || result.sourceQuery || ''
        })
      }
    }

    const deduped = this._dedupeResults(merged).slice(0, 20)
    const perQuery = settled.map(item => ({
      query: item.query || '',
      success: !!item.success,
      engine: item.engine || item.engines?.join('+') || requestedEngine,
      count: Array.isArray(item.results) ? item.results.length : 0,
      error: item.error || ''
    }))

    if (!deduped.length) {
      return {
        success: false,
        batch: true,
        query: normalizedQueries.join(' | '),
        queries: normalizedQueries,
        engine: requestedEngine,
        results: [],
        perQuery,
        error: perQuery.filter(item => item.error).map(item => `${item.query}: ${item.error}`).join('; ') || 'no search results'
      }
    }

    return {
      success: true,
      batch: true,
      query: normalizedQueries.join(' | '),
      queries: normalizedQueries,
      engine: requestedEngine,
      results: deduped,
      perQuery,
      text: this.formatBatchResults(deduped, normalizedQueries, requestedEngine, perQuery)
    }
  }

  _normalizeSearchQueries(queries = []) {
    const raw = Array.isArray(queries) ? queries : [queries]
    const seen = new Set()
    const normalized = []
    for (const item of raw) {
      const text = InputValidator.sanitize(String(item || '').trim())
      if (!text || seen.has(text.toLowerCase())) continue
      seen.add(text.toLowerCase())
      normalized.push(text)
      if (normalized.length >= 8) break
    }
    return normalized
  }

  /**
   * 单引擎搜索
   */
  _getCachedSearch(query, engine) {
    const key = `${engine || 'auto'}:${String(query || '').toLowerCase()}`
    const cached = this.searchCache.get(key)
    if (!cached || Date.now() - cached.time > this.cacheTtlMs) {
      if (cached) this.searchCache.delete(key)
      return null
    }
    this.stats.cacheHits++
    return { ...cached.result, cached: true }
  }

  _setCachedSearch(query, engine, result) {
    if (!query || !result) return
    const key = `${engine || 'auto'}:${String(query || '').toLowerCase()}`
    this.searchCache.set(key, { time: Date.now(), result })
    if (this.searchCache.size > 80) {
      const overflow = [...this.searchCache.entries()]
        .sort((a, b) => a[1].time - b[1].time)
        .slice(0, this.searchCache.size - 80)
      overflow.forEach(([itemKey]) => this.searchCache.delete(itemKey))
    }
  }

  _getCachedFetch(url) {
    const key = String(url || '').trim()
    const cached = this.fetchCache.get(key)
    if (!cached || Date.now() - cached.time > this.cacheTtlMs) {
      if (cached) this.fetchCache.delete(key)
      return null
    }
    this.stats.cacheHits++
    return { ...cached.result, cached: true }
  }

  _setCachedFetch(url, result) {
    if (!url || !result?.success) return
    const key = String(url).trim()
    this.fetchCache.set(key, { time: Date.now(), result })
    if (this.fetchCache.size > 80) {
      const overflow = [...this.fetchCache.entries()]
        .sort((a, b) => a[1].time - b[1].time)
        .slice(0, this.fetchCache.size - 80)
      overflow.forEach(([itemKey]) => this.fetchCache.delete(itemKey))
    }
  }

  async _searchSequential(query, preferredEngine = 'auto') {
    const priority = this._getSearchPriority(preferredEngine)
    const waves = preferredEngine === 'auto'
      ? [priority.slice(0, 3), priority.slice(3)]
      : [priority.slice(0, 1), priority.slice(1)]
    const errors = []

    for (const wave of waves) {
      const engines = wave.filter(Boolean)
      if (!engines.length) continue
      const results = await this._searchEnginesParallel(query, engines)
      errors.push(...results.filter(item => item?.error).map(item => `${item.engine}: ${item.error}`))
      const best = this._pickBestSearchResult(query, results)
      if (best?.success && best.results.length > 0) return best
    }

    const rendered = await this._searchRenderedSequential(query, priority)
    if (rendered.success && rendered.results.length > 0) return rendered
    return { success: false, error: errors.join('; ') || 'all search engines failed', query }
  }

  async _searchAuto(query) {
    const priority = this._getSearchPriority('auto')
    const primary = await this._searchEnginesParallel(query, priority.slice(0, 3))
    const best = this._pickBestSearchResult(query, primary)
    if (best?.success && best.results.length > 0) return best
    return this._searchSequential(query, 'auto')
  }

  _getSearchPriority(preferredEngine = 'auto') {
    const priority = ['baidu', 'bing_cn', 'duckduckgo', 'bing', 'google']
    const preferred = String(preferredEngine || 'auto').trim().toLowerCase()
    if (!preferred || preferred === 'auto') return priority
    return [preferred, ...priority.filter(engine => engine !== preferred)]
  }

  async _searchEnginesParallel(query, engines = []) {
    const uniqueEngines = [...new Set(engines)].filter(Boolean)
    return Promise.all(uniqueEngines.map(engine => this._searchSingleSafe(query, engine)))
  }

  async _searchSingleSafe(query, engine) {
    try {
      return await this._searchSingle(query, engine)
    } catch (error) {
      console.log(`[Browser] ${engine} search failed:`, error.message)
      return { success: false, query, engine, error: error.message, results: [] }
    }
  }

  _getSearchUrl(query, engine) {
    const urls = {
      baidu: `https://www.baidu.com/s?wd=${encodeURIComponent(query)}`,
      bing_cn: `https://cn.bing.com/search?q=${encodeURIComponent(query)}`,
      bing: `https://www.bing.com/search?q=${encodeURIComponent(query)}`,
      duckduckgo: `https://duckduckgo.com/html/?q=${encodeURIComponent(query)}`,
      google: `https://www.google.com/search?q=${encodeURIComponent(query)}`
    }
    return urls[engine] || ''
  }

  async _searchRenderedSequential(query, engines = []) {
    if (!this._canRender()) {
      return { success: false, query, engine: 'rendered', results: [], error: 'renderer unavailable' }
    }

    const tryEngines = [...new Set(engines)].filter(Boolean).slice(0, 3)
    const renderedResults = await Promise.all(tryEngines.map(async engine => {
      const url = this._getSearchUrl(query, engine)
      if (!url) return { success: false, engine, error: 'missing search URL', results: [] }
      try {
        const page = await this._renderPage(url, { mode: 'search' })
        const results = this._extractSearchResultsFromRenderedPage(page, engine)
        if (results.length > 0) {
          this.stats.renderedSearches++
          return {
            success: true,
            query,
            engine: `${engine}:rendered`,
            url,
            results,
            rendered: true,
            text: this.formatResults(results, query, `${engine}:rendered`)
          }
        }
        return { success: false, query, engine, results: [], error: 'no rendered search results' }
      } catch (error) {
        return { success: false, query, engine, results: [], error: error.message }
      }
    }))

    const best = this._pickBestSearchResult(query, renderedResults)
    if (best?.success && best.results.length > 0) {
      return {
        ...best,
        rendered: true,
        engine: `rendered:${(best.engines || []).join('+')}`,
        text: this.formatResults(best.results, query, `rendered:${(best.engines || []).join('+')}`)
      }
    }

    return {
      success: false,
      query,
      engine: 'rendered',
      results: [],
      error: renderedResults.filter(item => item?.error).map(item => `${item.engine}: ${item.error}`).join('; ')
    }
  }

  _pickBestSearchResult(query, results = []) {
    const successful = results.filter(item => item?.success && Array.isArray(item.results) && item.results.length)
    if (!successful.length) return null
    const merged = []
    for (const item of successful) {
      for (const result of item.results) merged.push({ ...result, engine: result.engine || item.engine })
    }
    const deduped = this._dedupeResults(merged).slice(0, 10)
    const engines = successful.map(item => item.engine)
    return {
      success: true,
      query,
      engine: 'auto',
      engines,
      url: successful[0].url,
      results: deduped,
      text: this.formatResults(deduped, query, `auto:${engines.join('+')}`)
    }
  }

  _dedupeResults(results = []) {
    const seen = new Set()
    const deduped = []
    for (const item of results) {
      const title = String(item.title || '').trim()
      const link = String(item.link || '').trim()
      const key = (link || title).toLowerCase().replace(/^https?:\/\/(www\.)?/, '').replace(/[#?].*$/, '')
      if (!title || seen.has(key)) continue
      seen.add(key)
      deduped.push({
        title,
        snippet: String(item.snippet || '').trim(),
        link,
        engine: item.engine || '',
        sourceQuery: item.sourceQuery || ''
      })
    }
    return deduped
  }

  async _searchSingle(query, engine) {
    const url = this._getSearchUrl(query, engine)
    if (!url) {
      return { success: false, error: `未知引擎: ${engine}`, query }
    }

    const html = await this.fetchHtml(url)
    const results = this.parseResults(html, engine)

    return {
      success: true,
      query,
      engine,
      url,
      results,
      text: this.formatResults(results, query, engine)
    }
  }

  /**
   * 获取网页 HTML（安全加固版本）
   * @param {string} url - 目标URL
   * @param {object} options - 可选配置
   */
  async fetchHtml(url, options = {}) {
    this.stats.totalRequests++

    // ====== 安全检查 ======
    
    // 1. URL格式验证
    const urlValidation = await this.urlValidator.validate(url, {
      allowPrivateIP: !this.securityConfig.enablePrivateIPBlock,
      allowLocalhost: false,
      checkDNS: this.securityConfig.enableDNSCheck
    })
    
    if (!urlValidation.valid) {
      this.stats.blockedRequests++
      console.warn('[Browser] URL安全检查失败:', urlValidation.error)
      return `<!-- 安全拦截: ${urlValidation.error} -->`
    }

    // 2. 白名单检查（如果启用）
    if (this.securityConfig.enableURLWhitelist) {
      const hostname = urlValidation.parsedUrl.hostname
      const isAllowed = this.securityConfig.urlWhitelist.some(domain => 
        hostname === domain || hostname.endsWith('.' + domain)
      )
      if (!isAllowed) {
        this.stats.blockedRequests++
        return '<!-- 域名不在白名单中 -->'
      }
    }

    // ====== 安全请求 ======
    try {
      const html = await this._safeFetch(url, options)
      return html
    } catch (err) {
      console.error('[Browser] 请求失败:', err.message)
      throw err
    }
  }

  /**
   * 安全HTTP请求
   */
  async _safeFetch(url, options = {}) {
    return new Promise((resolve, reject) => {
      const parsedUrl = new URL(url)
      const client = parsedUrl.protocol === 'https:' ? https : http

      // 响应大小限制
      const maxSize = options.maxSize || 10 * 1024 * 1024  // 10MB
      let data = ''
      let dataSize = 0

      const req = client.get(url, {
        timeout: this.timeout,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Encoding': 'identity',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
          ...(options.headers || {})
        }
      }, (res) => {
        // 重定向处理（限制次数）
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          const redirectUrl = new URL(res.headers.location, parsedUrl.href).href
          
          // 递归深度限制
          const redirectCount = options._redirectCount || 0
          if (redirectCount >= 5) {
            reject(new Error('重定向次数过多'))
            return
          }
          
          // 验证重定向URL
          this.urlValidator.validate(redirectUrl, {
            allowPrivateIP: !this.securityConfig.enablePrivateIPBlock,
            checkDNS: false  // 重定向时跳过DNS检查以提高性能
          }).then(validation => {
            if (!validation.valid) {
              reject(new Error(`重定向URL不安全: ${validation.error}`))
              return
            }
            this._safeFetch(redirectUrl, { ...options, _redirectCount: redirectCount + 1 })
              .then(resolve)
              .catch(reject)
          }).catch(reject)
          return
        }

        // 数据收集
        res.on('data', chunk => {
          dataSize += chunk.length
          
          // 响应大小限制
          if (dataSize > maxSize) {
            req.destroy()
            reject(new Error(`响应大小超过限制 (${Math.round(maxSize / 1024 / 1024)}MB)`))
            return
          }
          
          data += chunk
        })

        res.on('end', () => resolve(data))
      })

      req.on('error', reject)
      
      req.on('timeout', () => {
        req.destroy()
        reject(new Error('请求超时'))
      })
    })
  }

  /**
   * 解析搜索结果
   */
  parseResults(html, engine) {
    const results = []

    try {
      // 百度搜索结果
      if (engine === 'baidu') {
        // 使用更安全的HTML解析
        results.push(...this._parseBaiduResults(html))
      } 
      // Bing搜索结果
      else if (engine === 'bing' || engine === 'bing_cn') {
        results.push(...this._parseBingResults(html))
      } else if (engine === 'duckduckgo') {
        results.push(...this._parseDuckDuckGoResults(html))
      } 
      // Google搜索结果
      else {
        results.push(...this._parseGoogleResults(html))
      }
    } catch (e) {
      console.error('[Browser] Parse error:', e.message)
    }

    console.log(`[Browser] ${engine} 解析到 ${results.length} 个结果`)
    return results
  }

  /**
   * 解析百度结果（安全版本）
   */
  _parseBaiduResults(html) {
    const results = []
    // 安全的正则匹配
    const titleLinkRegex = /<h3[^>]*class="[^"]*t[^"]*"[^>]*>\s*<a[^>]*href="([^"]*)"[^>]*>(.*?)<\/a>\s*<\/h3>/gi
    let match

    while ((match = titleLinkRegex.exec(html)) !== null && results.length < 10) {
      const link = this._sanitizeUrl(match[1] || '')
      const title = this._sanitizeHtml(match[2]).trim()
      
      if (title && title.length > 2 && !title.includes('百度为您找到') && !title.includes('相关搜索')) {
        // 提取摘要
        const startPos = match.index
        const nearbyHtml = html.substring(startPos, startPos + 500)
        const snippetMatch = nearbyHtml.match(/<div[^>]*class="[^"]*c-[^"]*"[^>]*>(.*?)<\/div>/i)
        const snippet = snippetMatch ? this._sanitizeHtml(snippetMatch[1]).substring(0, 100) : ''
        
        results.push({ title, snippet, link })
      }
    }

    return results
  }

  /**
   * 解析Bing结果
   */
  _parseBingResults(html) {
    const results = []
    const itemRegex = /<li[^>]*class="[^"]*b_algo[^"]*"[^>]*>(.*?)<\/li>/gis
    let itemMatch

    while ((itemMatch = itemRegex.exec(html)) !== null && results.length < 10) {
      const itemHtml = itemMatch[1]
      const titleMatch = itemHtml.match(/<h2[^>]*>\s*<a[^>]*href="([^"]*)"[^>]*>(.*?)<\/a>\s*<\/h2>/i)
      const snippetMatch = itemHtml.match(/<div[^>]*class="[^"]*b_caption[^"]*"[^>]*>[\s\S]*?<p[^>]*>(.*?)<\/p>/i)
        || itemHtml.match(/<span[^>]*class="[^"]*b_snippet[^"]*"[^>]*>(.*?)<\/span>/i)

      if (titleMatch) {
        const link = this._sanitizeUrl(titleMatch[1] || '')
        const title = this._sanitizeHtml(titleMatch[2]).trim()
        const snippet = snippetMatch ? this._sanitizeHtml(snippetMatch[1]).substring(0, 100) : ''
        
        if (title && title.length > 2) {
          results.push({ title, snippet, link })
        }
      }
    }

    return results
  }

  /**
   * 解析Google结果
   */
  _parseDuckDuckGoResults(html) {
    const results = []
    const itemRegex = /<div[^>]*class="[^"]*result[^"]*"[^>]*>([\s\S]*?)(?=<div[^>]*class="[^"]*result[^"]*"|<\/body>|$)/gi
    let itemMatch

    while ((itemMatch = itemRegex.exec(html)) !== null && results.length < 10) {
      const itemHtml = itemMatch[1]
      const titleMatch = itemHtml.match(/<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/i)
        || itemHtml.match(/<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/i)
      const snippetMatch = itemHtml.match(/<a[^>]*class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/i)
        || itemHtml.match(/<div[^>]*class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/div>/i)
      if (!titleMatch) continue
      const link = this._sanitizeDuckDuckGoUrl(titleMatch[1] || '')
      const title = this._sanitizeHtml(titleMatch[2] || '').trim()
      const snippet = snippetMatch ? this._sanitizeHtml(snippetMatch[1]).substring(0, 160) : ''
      if (title && title.length > 2) results.push({ title, snippet, link })
    }

    return results
  }

  _sanitizeDuckDuckGoUrl(url) {
    const clean = this._sanitizeUrl(url)
    if (!clean) return ''
    try {
      const parsed = new URL(clean)
      const uddg = parsed.searchParams.get('uddg')
      if (uddg) return this._sanitizeUrl(decodeURIComponent(uddg))
    } catch { /* URL 解析失败 */ }
    return clean
  }

  _parseGoogleResults(html) {
    const results = []
    const itemRegex = /<div[^>]*class="[^"]*g[^"]*"[^>]*>(.*?)<\/div>/gis
    let itemMatch

    while ((itemMatch = itemRegex.exec(html)) !== null && results.length < 10) {
      const itemHtml = itemMatch[1]
      const titleMatch = itemHtml.match(/<h3[^>]*>(.*?)<\/h3>/i)
      const linkMatch = itemHtml.match(/<a[^>]*href="([^"]*)"[^>]*>/i)
      const snippetMatch = itemHtml.match(/<div[^>]*class="[^"]*VwiC3b[^"]*"[^>]*>(.*?)<\/div>/i)

      if (titleMatch) {
        const title = this._sanitizeHtml(titleMatch[1]).trim()
        const link = linkMatch ? this._sanitizeUrl(linkMatch[1]) : ''
        const snippet = snippetMatch ? this._sanitizeHtml(snippetMatch[1]).substring(0, 100) : ''
        
        if (title && title.length > 2) {
          results.push({ title, snippet, link })
        }
      }
    }

    return results
  }

  _solveWafChallengeCookie(html = '') {
    const text = String(html || '')
    if (!text.includes('_wafchallengeid') || !text.includes('Please wait')) return ''
    const match = text.match(/cs\s*=\s*"([^"]+)"/)
    if (!match) return ''

    try {
      const payload = JSON.parse(Buffer.from(match[1], 'base64').toString('utf8'))
      const prefix = Buffer.from(payload?.v?.a || '', 'base64')
      const expect = Buffer.from(payload?.v?.c || '', 'base64').toString('hex')
      if (!prefix.length || !expect) return ''

      for (let i = 0; i <= 1000000; i++) {
        const digest = crypto.createHash('sha256').update(prefix).update(String(i)).digest('hex')
        if (digest === expect) {
          payload.d = Buffer.from(String(i)).toString('base64')
          const cookieValue = Buffer.from(JSON.stringify(payload)).toString('base64')
          return `_wafchallengeid=${cookieValue}`
        }
      }
    } catch (error) {
      console.log('[Browser] WAF challenge parse failed:', error.message)
    }

    return ''
  }

  _canRender() {
    return typeof BrowserWindow === 'function' && (!electronApp || electronApp.isReady?.())
  }

  _isThinContent(text, html = '') {
    const cleanText = String(text || '').trim()
    const rawHtml = String(html || '')
    if (cleanText.length < 240) return true
    if (/<div[^>]+id=["']?(app|root|__next|vite-root)["']?[^>]*>\s*<\/div>/i.test(rawHtml) && cleanText.length < 1000) return true
    if ((rawHtml.match(/<script\b/gi) || []).length >= 8 && cleanText.length < 1200) return true
    return false
  }

  async _renderPage(url, options = {}) {
    const validation = await this.urlValidator.validate(url, {
      allowPrivateIP: !this.securityConfig.enablePrivateIPBlock,
      allowLocalhost: false,
      checkDNS: this.securityConfig.enableDNSCheck
    })
    if (!validation.valid) throw new Error(validation.error)
    if (!this._canRender()) throw new Error('Electron renderer is unavailable')

    let win
    let timeoutId
    try {
      win = new BrowserWindow({
        show: false,
        width: options.width || 1366,
        height: options.height || 900,
        webPreferences: {
          sandbox: true,
          contextIsolation: true,
          nodeIntegration: false,
          webSecurity: true
        }
      })

      win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
      win.webContents.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36')
      const timeout = new Promise((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error('render timeout')), this.renderTimeoutMs)
      })

      await Promise.race([win.loadURL(url), timeout])
      clearTimeout(timeoutId)
      await this._waitForRenderedContent(win, options)

      return await win.webContents.executeJavaScript(`
        (() => {
          const clean = value => String(value || '').replace(/\\s+/g, ' ').trim()
          const pickText = () => {
            const target = document.querySelector('article, main, [role="main"]') || document.body
            return clean(target ? target.innerText : document.body.innerText)
          }
          const metaDescription = document.querySelector('meta[name="description"], meta[property="og:description"]')
          const anchors = Array.from(document.querySelectorAll('a')).slice(0, 500).map(anchor => ({
            text: clean(anchor.innerText || anchor.textContent || anchor.getAttribute('aria-label') || ''),
            href: anchor.href || '',
            title: clean(anchor.getAttribute('title') || ''),
            nearby: clean(anchor.closest('li, article, section, div')?.innerText || '')
          }))
          const headings = Array.from(document.querySelectorAll('h1,h2,h3')).slice(0, 40).map(node => clean(node.innerText))
          return {
            url: location.href,
            title: clean(document.title),
            description: clean(metaDescription ? metaDescription.content : ''),
            text: pickText(),
            headings,
            anchors
          }
        })()
      `, true)
    } finally {
      if (timeoutId) clearTimeout(timeoutId)
      if (win && !win.isDestroyed()) win.destroy()
    }
  }

  async analyzeDesign(url, options = {}) {
    const validation = await this.urlValidator.validate(url, {
      allowPrivateIP: !this.securityConfig.enablePrivateIPBlock,
      checkDNS: this.securityConfig.enableDNSCheck
    })
    if (!validation.valid) return { success: false, error: validation.error }

    const normalizedUrl = validation.parsedUrl.href
    const viewport = {
      width: Math.max(320, Math.min(2560, Number(options.viewport_width || options.viewportWidth) || 1440)),
      height: Math.max(320, Math.min(1800, Number(options.viewport_height || options.viewportHeight) || 900))
    }
    const scrollSamples = Math.max(1, Math.min(12, Number(options.scroll_samples || options.scrollSamples) || 5))

    let html = ''
    try {
      html = await this.fetchHtml(normalizedUrl)
    } catch (error) {
      html = ''
    }

    const staticHints = this._extractStaticDesignHints(html, normalizedUrl)
    let renderedDesign = null
    let renderError = ''
    if (this._canRender()) {
      try {
        renderedDesign = await this._renderDesignPage(normalizedUrl, {
          width: viewport.width,
          height: viewport.height,
          scrollSamples,
          waitMs: Number(options.delay_ms || options.delayMs) || this.renderWaitMs
        })
        this.stats.renderedFetches++
      } catch (error) {
        renderError = error.message
      }
    } else {
      renderError = 'renderer unavailable'
    }

    const design = {
      ...(staticHints || {}),
      ...(renderedDesign || {}),
      staticHints,
      rendered: !!renderedDesign,
      renderError: renderedDesign ? '' : renderError
    }
    const replicationBrief = this._buildDesignBrief(design)

    return {
      success: true,
      action: 'design',
      url: renderedDesign?.url || normalizedUrl,
      title: renderedDesign?.title || staticHints.title || '',
      description: renderedDesign?.description || staticHints.description || '',
      viewport,
      scrollSamples,
      rendered: !!renderedDesign,
      renderError: renderedDesign ? '' : renderError,
      design,
      replicationBrief,
      text: replicationBrief
    }
  }

  _extractStaticDesignHints(html = '', baseUrl = '') {
    const source = String(html || '')
    const titleMatch = source.match(/<title[^>]*>([\s\S]*?)<\/title>/i)
    const descriptionMatch = source.match(/<meta[^>]+(?:name|property)=["'](?:description|og:description)["'][^>]+content=["']([^"']*)["']/i)
      || source.match(/<meta[^>]+content=["']([^"']*)["'][^>]+(?:name|property)=["'](?:description|og:description)["']/i)
    const styleBlocks = [...source.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)].map(match => match[1] || '').join('\n')
    const inlineStyles = [...source.matchAll(/\sstyle=["']([^"']{2,500})["']/gi)].map(match => match[1] || '').join('\n')
    const styleText = `${styleBlocks}\n${inlineStyles}`
    const collect = (pattern, limit = 24) => {
      const values = []
      let match
      while ((match = pattern.exec(styleText)) && values.length < limit) {
        const value = this._sanitizeHtml(match[1] || match[0] || '').trim()
        if (value && !values.includes(value)) values.push(value)
      }
      return values
    }
    const assets = []
    const pushAsset = value => {
      const raw = String(value || '').trim()
      if (!raw) return
      try {
        const href = new URL(raw, baseUrl || 'https://example.com/').href
        if (!assets.includes(href)) assets.push(href)
      } catch {}
    }
    for (const match of source.matchAll(/<(?:img|source)[^>]+src=["']([^"']+)["']/gi)) pushAsset(match[1])
    for (const match of source.matchAll(/<link[^>]+href=["']([^"']+\.(?:css|png|jpg|jpeg|webp|gif|svg|ico)(?:\?[^"']*)?)["']/gi)) pushAsset(match[1])

    return {
      url: baseUrl,
      title: titleMatch ? this._sanitizeHtml(titleMatch[1]).trim() : '',
      description: descriptionMatch ? this._sanitizeHtml(descriptionMatch[1]).trim() : '',
      cssVariables: collect(/(--[A-Za-z0-9_-]+)\s*:/g, 40),
      colors: collect(/(?:#[0-9a-f]{3,8}\b|rgba?\([^)]+\)|hsla?\([^)]+\))/gi, 32),
      fontFamilies: collect(/font-family\s*:\s*([^;}{]+)/gi, 16),
      radii: collect(/border-radius\s*:\s*([^;}{]+)/gi, 16),
      shadows: collect(/box-shadow\s*:\s*([^;}{]+)/gi, 16),
      assets: assets.slice(0, 40)
    }
  }

  async _renderDesignPage(url, options = {}) {
    const validation = await this.urlValidator.validate(url, {
      allowPrivateIP: !this.securityConfig.enablePrivateIPBlock,
      allowLocalhost: false,
      checkDNS: this.securityConfig.enableDNSCheck
    })
    if (!validation.valid) throw new Error(validation.error)
    if (!this._canRender()) throw new Error('Electron renderer is unavailable')

    let win
    let timeoutId
    try {
      win = new BrowserWindow({
        show: false,
        width: options.width || 1440,
        height: options.height || 900,
        webPreferences: {
          sandbox: true,
          contextIsolation: true,
          nodeIntegration: false,
          webSecurity: true
        }
      })
      win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
      win.webContents.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36')
      const timeout = new Promise((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error('render timeout')), this.renderTimeoutMs)
      })
      await Promise.race([win.loadURL(url), timeout])
      clearTimeout(timeoutId)
      await this._waitForRenderedContent(win, options)

      const scrollSamples = Math.max(1, Math.min(12, Number(options.scrollSamples) || 5))
      return await win.webContents.executeJavaScript(`
        (async () => {
          const clean = value => String(value || '').replace(/\\s+/g, ' ').trim()
          const isVisible = el => {
            const rect = el.getBoundingClientRect()
            const style = getComputedStyle(el)
            return rect.width > 2 && rect.height > 2 && style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity || 1) > 0
          }
          const countValues = (items, key, limit = 12) => {
            const counts = new Map()
            for (const item of items) {
              const value = clean(item && item[key])
              if (!value || value === 'rgba(0, 0, 0, 0)' || value === 'transparent' || value === 'none' || value === 'normal') continue
              counts.set(value, (counts.get(value) || 0) + 1)
            }
            return Array.from(counts.entries()).sort((a, b) => b[1] - a[1]).slice(0, limit).map(([value, count]) => ({ value, count }))
          }
          const sampleElement = el => {
            const style = getComputedStyle(el)
            const rect = el.getBoundingClientRect()
            return {
              tag: el.tagName.toLowerCase(),
              role: clean(el.getAttribute('role') || ''),
              id: clean(el.id || ''),
              classes: String(el.className || '').split(/\\s+/).filter(Boolean).slice(0, 8),
              text: clean(el.innerText || el.textContent || el.getAttribute('aria-label') || '').slice(0, 160),
              box: { x: Math.round(rect.x), y: Math.round(rect.y + scrollY), width: Math.round(rect.width), height: Math.round(rect.height) },
              display: style.display,
              position: style.position,
              color: style.color,
              background: style.backgroundColor,
              fontFamily: style.fontFamily,
              fontSize: style.fontSize,
              fontWeight: style.fontWeight,
              lineHeight: style.lineHeight,
              borderRadius: style.borderRadius,
              border: style.border,
              boxShadow: style.boxShadow,
              padding: style.padding,
              margin: style.margin,
              gap: style.gap
            }
          }
          const pick = (selector, limit = 12) => Array.from(document.querySelectorAll(selector)).filter(isVisible).slice(0, limit).map(sampleElement)
          const allVisible = Array.from(document.querySelectorAll('body *')).filter(isVisible).slice(0, 900).map(el => {
            const style = getComputedStyle(el)
            return {
              color: style.color,
              background: style.backgroundColor,
              borderColor: style.borderColor,
              fontFamily: style.fontFamily,
              fontSize: style.fontSize,
              fontWeight: style.fontWeight,
              borderRadius: style.borderRadius,
              boxShadow: style.boxShadow
            }
          })
          const rootStyle = getComputedStyle(document.documentElement)
          const cssVariables = Array.from(document.styleSheets).slice(0, 20).flatMap(sheet => {
            try {
              return Array.from(sheet.cssRules || []).slice(0, 300).flatMap(rule => {
                const text = rule.cssText || ''
                return Array.from(text.matchAll(/(--[A-Za-z0-9_-]+)\\s*:/g)).map(match => match[1])
              })
            } catch {
              return []
            }
          }).filter((value, index, array) => array.indexOf(value) === index).slice(0, 80).map(name => ({ name, value: clean(rootStyle.getPropertyValue(name)) }))
          const metaDescription = document.querySelector('meta[name="description"], meta[property="og:description"]')
          const sections = pick('header, nav, main, section, article, aside, footer, [class*="hero"], [class*="section"]', 24)
          const images = Array.from(document.images).filter(isVisible).slice(0, 30).map(img => ({
            src: img.currentSrc || img.src || '',
            alt: clean(img.alt || ''),
            box: (() => { const rect = img.getBoundingClientRect(); return { width: Math.round(rect.width), height: Math.round(rect.height) } })()
          }))
          const scrollRuntime = []
          const maxScroll = Math.max(0, document.documentElement.scrollHeight - innerHeight)
          for (let i = 0; i < ${scrollSamples}; i += 1) {
            const y = ${scrollSamples} <= 1 ? 0 : Math.round(maxScroll * (i / (${scrollSamples} - 1)))
            scrollTo(0, y)
            await new Promise(resolve => setTimeout(resolve, 160))
            const important = Array.from(document.querySelectorAll('h1,h2,h3,section,article,[class*="hero"],[class*="card"],[class*="panel"]'))
              .filter(isVisible)
              .slice(0, 10)
              .map(sampleElement)
            scrollRuntime.push({ scrollY: y, important })
          }
          scrollTo(0, 0)
          return {
            url: location.href,
            title: clean(document.title),
            description: clean(metaDescription ? metaDescription.content : ''),
            viewport: { width: innerWidth, height: innerHeight, scrollHeight: document.documentElement.scrollHeight },
            designTokens: {
              colors: [
                ...countValues(allVisible, 'background', 16),
                ...countValues(allVisible, 'color', 12),
                ...countValues(allVisible, 'borderColor', 8)
              ].slice(0, 32),
              typography: {
                families: countValues(allVisible, 'fontFamily', 10),
                sizes: countValues(allVisible, 'fontSize', 16),
                weights: countValues(allVisible, 'fontWeight', 10)
              },
              radii: countValues(allVisible, 'borderRadius', 14),
              shadows: countValues(allVisible, 'boxShadow', 14),
              cssVariables
            },
            layout: {
              body: sampleElement(document.body),
              sections,
              hero: pick('main h1, h1, [class*="hero"], [class*="banner"]', 8)
            },
            components: {
              nav: pick('nav, header nav, [class*="nav"], [class*="menu"]', 10),
              buttons: pick('button, a[role="button"], .button, .btn, [class*="button"], [class*="btn"]', 20),
              cards: pick('article, .card, [class*="card"], [class*="panel"], [class*="tile"], [class*="item"]', 20),
              forms: pick('input, textarea, select, form, [class*="input"], [class*="field"]', 16)
            },
            assets: { images },
            scrollRuntime
          }
        })()
      `, true)
    } finally {
      if (timeoutId) clearTimeout(timeoutId)
      if (win && !win.isDestroyed()) win.destroy()
    }
  }

  _buildDesignBrief(design = {}) {
    const lines = []
    const title = design.title || design.staticHints?.title || ''
    if (title) lines.push(`Title: ${title}`)
    if (design.description || design.staticHints?.description) lines.push(`Description: ${design.description || design.staticHints.description}`)
    if (design.viewport) lines.push(`Viewport: ${design.viewport.width}x${design.viewport.height}, scrollHeight ${design.viewport.scrollHeight || '?'}`)
    const colors = design.designTokens?.colors || design.colors || []
    if (colors.length) lines.push(`Color palette: ${colors.slice(0, 16).map(item => typeof item === 'string' ? item : `${item.value} (${item.count})`).join(', ')}`)
    const typography = design.designTokens?.typography
    if (typography) {
      lines.push(`Typography families: ${(typography.families || []).slice(0, 8).map(item => item.value).join(', ')}`)
      lines.push(`Font sizes: ${(typography.sizes || []).slice(0, 10).map(item => item.value).join(', ')}`)
      lines.push(`Font weights: ${(typography.weights || []).slice(0, 8).map(item => item.value).join(', ')}`)
    } else if (design.fontFamilies?.length) {
      lines.push(`Typography families: ${design.fontFamilies.slice(0, 8).join(', ')}`)
    }
    const radii = design.designTokens?.radii || design.radii || []
    if (radii.length) lines.push(`Border radii: ${radii.slice(0, 10).map(item => typeof item === 'string' ? item : item.value).join(', ')}`)
    const shadows = design.designTokens?.shadows || design.shadows || []
    if (shadows.length) lines.push(`Shadows: ${shadows.slice(0, 8).map(item => typeof item === 'string' ? item : item.value).join(' | ')}`)
    const hero = design.layout?.hero || []
    if (hero.length) lines.push(`Hero/first viewport: ${hero.slice(0, 6).map(item => `${item.tag} ${item.text || item.classes?.join('.') || ''}`.trim()).join(' / ')}`)
    const sections = design.layout?.sections || []
    if (sections.length) lines.push(`Page structure: ${sections.slice(0, 12).map(item => `${item.tag}${item.classes?.length ? '.' + item.classes.slice(0, 3).join('.') : ''} ${item.text || ''}`.trim().slice(0, 120)).join(' | ')}`)
    const components = design.components || {}
    for (const [name, items] of Object.entries(components)) {
      if (Array.isArray(items) && items.length) {
        lines.push(`${name}: ${items.slice(0, 8).map(item => `${item.tag} ${item.text || item.classes?.join('.') || ''} ${item.background || ''} ${item.borderRadius || ''}`.trim()).join(' | ')}`)
      }
    }
    const cssVariables = design.designTokens?.cssVariables || design.cssVariables || []
    if (cssVariables.length) {
      lines.push(`CSS variables: ${cssVariables.slice(0, 24).map(item => typeof item === 'string' ? item : `${item.name}:${item.value}`).join(', ')}`)
    }
    const images = design.assets?.images || design.assets || []
    if (Array.isArray(images) && images.length) {
      lines.push(`Visual assets: ${images.slice(0, 12).map(item => typeof item === 'string' ? item : `${item.src} ${item.alt || ''}`.trim()).join(' | ')}`)
    }
    if (Array.isArray(design.scrollRuntime) && design.scrollRuntime.length) {
      lines.push(`Scroll samples: ${design.scrollRuntime.map(sample => `y=${sample.scrollY}: ${(sample.important || []).slice(0, 4).map(item => item.text || item.classes?.join('.') || item.tag).join(' / ')}`).join(' || ')}`)
    }
    lines.push('Replication guidance: match the extracted palette, typography scale, spacing rhythm, component radii/shadows, hero structure, navigation treatment, card/button states, and scroll-section composition before adding new decoration.')
    return lines.filter(Boolean).join('\n')
  }

  async _waitForRenderedContent(win, options = {}) {
    const deadline = Date.now() + (options.waitMs || this.renderWaitMs)
    let lastLength = 0
    let stableCount = 0

    while (Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 500))
      if (!win || win.isDestroyed()) return

      let snapshot
      try {
        snapshot = await win.webContents.executeJavaScript(`
          (() => {
            const text = String(document.body?.innerText || '').replace(/\\s+/g, ' ').trim()
            return {
              readyState: document.readyState,
              length: text.length,
              text: text.slice(0, 300),
              pending: performance.getEntriesByType('resource').filter(item => item.initiatorType === 'xmlhttprequest' || item.initiatorType === 'fetch').length
            }
          })()
        `, true)
      } catch {
        continue
      }

      const currentLength = Number(snapshot?.length || 0)
      const sampleText = String(snapshot?.text || '')
      const stillWaiting = /please wait|loading|加载中|正在加载|请稍候/i.test(sampleText)
      const enoughText = currentLength >= 900 && !stillWaiting

      if (enoughText && Math.abs(currentLength - lastLength) < 80) {
        stableCount++
      } else {
        stableCount = 0
      }

      if (enoughText && stableCount >= 2) return
      lastLength = currentLength
    }
  }

  _extractSearchResultsFromRenderedPage(page, engine = '') {
    const anchors = Array.isArray(page?.anchors) ? page.anchors : []
    const candidates = []
    for (const anchor of anchors) {
      const title = String(anchor.text || anchor.title || '').trim()
      const link = this._sanitizeSearchResultUrl(anchor.href || '')
      if (!title || title.length < 3 || !link) continue
      if (this._isLikelySearchInternalUrl(link, engine)) continue
      const nearby = String(anchor.nearby || '').replace(title, '').trim()
      candidates.push({
        title: this._sanitizeHtml(title).substring(0, 120),
        snippet: this._sanitizeHtml(nearby).substring(0, 180),
        link,
        engine
      })
    }
    return this._dedupeResults(candidates).slice(0, 10)
  }

  _sanitizeSearchResultUrl(url) {
    const clean = this._sanitizeDuckDuckGoUrl(url)
    if (!clean) return ''
    try {
      const parsed = new URL(clean)
      const redirectParam = ['url', 'u', 'target', 'to'].map(name => parsed.searchParams.get(name)).find(Boolean)
      if (redirectParam && /^https?:\/\//i.test(redirectParam)) {
        return this._sanitizeUrl(decodeURIComponent(redirectParam))
      }
    } catch { /* URL 解析失败 */ }
    return clean
  }

  _isLikelySearchInternalUrl(url, engine = '') {
    try {
      const parsed = new URL(url)
      const host = parsed.hostname.replace(/^www\./, '').toLowerCase()
      const path = parsed.pathname.toLowerCase()
      const blockedHosts = [
        'bing.com', 'cn.bing.com', 'baidu.com', 'google.com', 'duckduckgo.com',
        'microsoft.com', 'go.microsoft.com', 'support.google.com'
      ]
      if (blockedHosts.includes(host) && /^(\/search|\/s|\/preferences|\/settings|\/account|\/maps|\/images|\/videos|\/news|\/aclk|\/url|\/l\/?)/.test(path)) return true
      if (/\/(login|signin|signup|account|preferences|settings|privacy|terms)(\/|$)/.test(path)) return true
      if (engine && host.includes(String(engine).replace('_cn', ''))) return true
      return false
    } catch {
      return true
    }
  }

  /**
   * 清理HTML（防止XSS）
   */
  _sanitizeHtml(html) {
    if (!html) return ''
    
    return html
      // 移除所有标签，只保留文本
      .replace(/<[^>]+>/g, '')
      // 解码HTML实体
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&nbsp;/g, ' ')
      .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code) || 32))
      .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(parseInt(code, 16) || 32))
      // 移除危险字符
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/javascript:/gi, '')
      .replace(/on\w+\s*=/gi, '')
      // 清理空白
      .replace(/\s+/g, ' ')
      .trim()
  }

  /**
   * 清理URL（防止注入）
   */
  _sanitizeUrl(url) {
    if (!url) return ''
    
    try {
      // 只允许http和https协议
      const parsed = new URL(url, 'https://example.com')
      if (!['http:', 'https:'].includes(parsed.protocol)) {
        return ''
      }
      return parsed.href
    } catch (e) {
      return ''
    }
  }

  /**
   * 格式化结果为文本
   */
  formatResults(results, query, engine) {
    if (!results.length) {
      return `搜索 "${query}" (${engine}) - 未找到结果`
    }

    let text = `搜索 "${query}" (${engine})\n找到 ${results.length} 个结果：\n\n`
    results.forEach((r, i) => {
      text += `${i + 1}. ${r.title}\n`
      if (r.snippet) text += `   ${r.snippet}\n`
      if (r.link) text += `   链接: ${r.link}\n`
    })
    return text
  }

  formatBatchResults(results, queries, engine, perQuery = []) {
    if (!results.length) {
      return `并行搜索 ${queries.length} 个关键词 (${engine}) - 未找到结果`
    }

    const summary = perQuery
      .map(item => `${item.query || '未知关键词'}: ${item.count || 0}`)
      .join('；')
    let text = `并行搜索 ${queries.length} 个关键词 (${engine})\n关键词: ${queries.join('；')}\n每词结果: ${summary}\n合并去重后 ${results.length} 个结果：\n\n`
    results.forEach((r, i) => {
      text += `${i + 1}. ${r.title}\n`
      if (r.sourceQuery) text += `   来源关键词: ${r.sourceQuery}\n`
      if (r.snippet) text += `   ${r.snippet}\n`
      if (r.link) text += `   链接: ${r.link}\n`
    })
    return text
  }

  async lxweb(args = {}, options = {}) {
    const inferredAction = args.action || args.fn || args.type || (args.url || args.ref_id ? 'fetch' : 'search')
    const action = String(inferredAction).trim().toLowerCase().replace(/^lxweb[._:-]?/i, '')
    if (action === 'search' || action === 'search_query') {
      const queryArgs = args.queries || args.query_list || args.queryList || args.keywords || args.keywordList
      const result = queryArgs
        ? await this.searchMany(queryArgs, args.engine || 'auto')
        : await this.search(args.query || args.q || '', args.engine || 'auto')
      return { ...result, action: 'search' }
    }
    if (action === 'fetch' || action === 'open_url' || action === 'read') {
      const result = await this.fetch(args.url || args.ref_id || '')
      return { ...result, action: 'fetch' }
    }
    if (action === 'find' || action === 'find_text' || action === 'find_in_page') {
      const result = await this.find(args.url || args.ref_id || '', args.pattern || args.query || args.q || '', args)
      return { ...result, action: 'find' }
    }
    if (action === 'design' || action === 'ui_design' || action === 'analyze_ui' || action === 'inspect_ui' || action === 'replicate_ui') {
      const result = await this.analyzeDesign(args.url || args.ref_id || args.href || args.link || '', args)
      return { ...result, action: 'design' }
    }
    if (action === 'open') {
      const result = await this.open(args.url || '')
      return { ...result, action: 'open' }
    }
    if (action === 'open_right' || action === 'right' || action === 'right_view' || action === 'right_webview' || action === 'open_panel') {
      const result = await this.openRight(args.url || args.href || args.link || '', options)
      return { ...result, action: 'open_right' }
    }
    if (action === 'status') {
      return { ...this.status(), action: 'status' }
    }
    return {
      success: false,
      error: `unknown lxweb action: ${action}`,
      supportedActions: ['search', 'fetch', 'find', 'design', 'open', 'open_right', 'status']
    }
  }

  async find(url, pattern, options = {}) {
    const target = String(url || '').trim()
    const needle = String(pattern || '').trim()
    if (!target) return { success: false, error: 'missing url' }
    if (!needle) return { success: false, error: 'missing pattern' }

    const fetched = await this.fetch(target)
    if (!fetched?.success) return { ...fetched, pattern: needle, matches: [], count: 0 }

    const text = String(fetched.text || '')
    const lowerText = text.toLowerCase()
    const lowerNeedle = needle.toLowerCase()
    const maxResults = Math.max(1, Math.min(50, Number(options.max_results || options.maxResults) || 12))
    const matches = []
    let index = 0
    while (matches.length < maxResults) {
      const foundAt = lowerText.indexOf(lowerNeedle, index)
      if (foundAt < 0) break
      const start = Math.max(0, foundAt - 120)
      const end = Math.min(text.length, foundAt + needle.length + 180)
      matches.push({
        index: foundAt,
        snippet: text.slice(start, end).replace(/\s+/g, ' ').trim()
      })
      index = foundAt + Math.max(needle.length, 1)
    }

    return {
      success: true,
      url: fetched.url || target,
      title: fetched.title || '',
      pattern: needle,
      matches,
      count: matches.length,
      text: matches.length
        ? matches.map((item, itemIndex) => `${itemIndex + 1}. ${item.snippet}`).join('\n')
        : `未在网页正文中找到: ${needle}`,
      fetched_length: fetched.length || text.length,
      rendered: !!fetched.rendered
    }
  }

  /**
   * 获取网页内容（安全版本）
   */
  async fetch(url) {
    try {
      // 安全验证
      const validation = await this.urlValidator.validate(url, {
        allowPrivateIP: !this.securityConfig.enablePrivateIPBlock,
        checkDNS: this.securityConfig.enableDNSCheck
      })
      
      if (!validation.valid) {
        return { success: false, error: validation.error }
      }

      const normalizedUrl = validation.parsedUrl.href
      const cached = this._getCachedFetch(normalizedUrl)
      if (cached) return cached

      let html = await this.fetchHtml(normalizedUrl)
      const challengeCookie = this._solveWafChallengeCookie(html)
      if (challengeCookie) {
        try {
          html = await this.fetchHtml(normalizedUrl, { headers: { Cookie: challengeCookie } })
        } catch (challengeError) {
          console.log('[Browser] WAF challenge retry failed:', challengeError.message)
        }
      }

      // 安全提取正文
      let text = this._safeExtractContent(html)
      let rendered = false
      let renderSource = null

      if (this._isThinContent(text, html) && this._canRender()) {
        try {
          const renderedPage = await this._renderPage(normalizedUrl, { mode: 'fetch' })
          const renderedText = String(renderedPage.text || '').trim()
          if (renderedText.length > text.length) {
            text = renderedText
            rendered = true
            renderSource = renderedPage
            this.stats.renderedFetches++
          }
        } catch (renderError) {
          console.log('[Browser] rendered fetch fallback failed:', renderError.message)
        }
      }

      // 敏感信息检测和遮蔽
      if (this.securityConfig.enableSensitiveMask) {
        const { masked, detected } = this.sensitiveDetector.detectAndMask(text)
        if (detected.length > 0) {
          this.stats.sanitizedResponses++
          console.log('[Browser] 检测到敏感信息，已遮蔽:', detected.map(d => d.type).join(', '))
          text = masked
        }
      }

      // 长度限制
      text = text.substring(0, 8000)

      const titleMatch = html.match(/<title[^>]*>(.*?)<\/title>/i)
      const title = renderSource?.title || (titleMatch ? this._sanitizeHtml(titleMatch[1]).trim() : '')

      const result = {
        success: true,
        url: normalizedUrl,
        title,
        text,
        length: text.length,
        rendered,
        description: renderSource?.description || ''
      }
      this._setCachedFetch(normalizedUrl, result)
      return result
    } catch (err) {
      return {
        success: false,
        error: err.message
      }
    }
  }

  /**
   * 安全提取正文内容
   */
  _safeExtractContent(html) {
    let text = html

    // 移除危险内容
    const dangerousPatterns = [
      /<script[^>]*>[\s\S]*?<\/script>/gi,
      /<style[^>]*>[\s\S]*?<\/style>/gi,
      /<iframe[^>]*>[\s\S]*?<\/iframe>/gi,
      /<object[^>]*>[\s\S]*?<\/object>/gi,
      /<embed[^>]*>[\s\S]*?<\/embed>/gi,
      /<nav[^>]*>[\s\S]*?<\/nav>/gi,
      /<header[^>]*>[\s\S]*?<\/header>/gi,
      /<footer[^>]*>[\s\S]*?<\/footer>/gi,
      /<aside[^>]*>[\s\S]*?<\/aside>/gi,
      /<!--[\s\S]*?-->/g  // 注释
    ]

    dangerousPatterns.forEach(pattern => {
      text = text.replace(pattern, '')
    })

    // 提取正文段落
    const paragraphs = []
    const pRegex = /<p[^>]*>(.*?)<\/p>/gi
    let match
    while ((match = pRegex.exec(text)) !== null) {
      const pText = this._sanitizeHtml(match[1])
      if (pText.length > 20) paragraphs.push(pText)
    }

    // 如果没找到p标签，直接清理HTML
    if (paragraphs.length === 0) {
      text = this._sanitizeHtml(text)
    } else {
      text = paragraphs.join('\n\n')
    }

    return text
  }

  /**
   * 在系统浏览器中打开 URL（安全版本）
   */
  async open(url) {
    try {
      // 1. URL格式验证
      let parsedUrl
      try {
        parsedUrl = new URL(url)
      } catch (e) {
        return { success: false, error: '无效的URL格式' }
      }

      // 2. 白名单协议检查 - 只允许http和https
      const allowedProtocols = ['http:', 'https:']
      if (!allowedProtocols.includes(parsedUrl.protocol)) {
        return { 
          success: false, 
          error: `禁止打开 ${parsedUrl.protocol} 协议链接，只允许HTTP/HTTPS` 
        }
      }

      // 3. 可选：域名白名单检查
      if (this.securityConfig.enableURLWhitelist) {
        const hostname = parsedUrl.hostname
        const isAllowed = this.securityConfig.urlWhitelist.some(domain => 
          hostname === domain || hostname.endsWith('.' + domain)
        )
        if (!isAllowed) {
          return { success: false, error: '域名不在白名单中' }
        }
      }

      // 4. 执行打开
      if (!shell?.openExternal) {
        return { success: false, error: 'system browser is unavailable' }
      }
      await shell.openExternal(url)
      this.activePageInfo = { url, title: '外部浏览器' }
      
      return {
        success: true,
        message: `已在浏览器中打开: ${url}`
      }
    } catch (err) {
      return {
        success: false,
        error: err.message
      }
    }
  }

  async openRight(url, options = {}) {
    try {
      const validation = await this.urlValidator.validate(url, {
        allowPrivateIP: !this.securityConfig.enablePrivateIPBlock,
        checkDNS: this.securityConfig.enableDNSCheck
      })

      if (!validation.valid) {
        return { success: false, error: validation.error }
      }

      const normalizedUrl = validation.parsedUrl.href
      if (this.securityConfig.enableURLWhitelist) {
        const hostname = validation.parsedUrl.hostname
        const isAllowed = this.securityConfig.urlWhitelist.some(domain =>
          hostname === domain || hostname.endsWith('.' + domain)
        )
        if (!isAllowed) {
          return { success: false, error: 'domain is not allowed by URL whitelist' }
        }
      }

      const targetWebContents = options.webContents || config.getMainWindow()?.webContents
      if (!targetWebContents || targetWebContents.isDestroyed?.()) {
        return { success: false, error: 'right webview target is unavailable' }
      }

      targetWebContents.send('right-webview-open-request', {
        url: normalizedUrl,
        title: options.title || ''
      })
      this.activePageInfo = { url: normalizedUrl, title: 'right webview' }

      return {
        success: true,
        url: normalizedUrl,
        message: `Opened in the right-side webview: ${normalizedUrl}`
      }
    } catch (err) {
      return {
        success: false,
        error: err.message
      }
    }
  }

  /**
   * 获取状态
   */
  status() {
    return {
      available: true,
      activePage: this.activePageInfo,
      securityConfig: this.securityConfig,
      stats: this.stats
    }
  }

  /**
   * 更新安全配置
   */
  setSecurityConfig(config) {
    Object.assign(this.securityConfig, config)
    console.log('[Browser] 安全配置已更新:', this.securityConfig)
  }
}

// 创建单例
const browserToolSecure = new BrowserToolSecure()

// 导出
module.exports = {
  BrowserToolSecure,
  browserToolSecure,
  lxweb: (args) => browserToolSecure.lxweb(args),
  search: (query, engine) => browserToolSecure.search(query, engine),
  fetch: (url) => browserToolSecure.fetch(url),
  open: (url) => browserToolSecure.open(url),
  openRight: (url, options) => browserToolSecure.openRight(url, options),
  status: () => browserToolSecure.status()
}
