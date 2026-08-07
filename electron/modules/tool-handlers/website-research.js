/**
 * 网站研究工具处理器
 * 包含：research_website_runtime 与统一 runtime_verify 的内部实现
 */

const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { BrowserWindow } = require('electron')
const sharp = require('sharp')
const storageConfig = require('../storage-config')
const designStyleMemory = require('../design-style-memory')
const runtimeDiagnostics = require('../runtime-diagnostics')

const {
  normalizeScreenshotUrl,
  normalizeTimestampForFile,
  ensureScreenshotDir,
  captureWebContentsToFile,
  waitForScreenshotTarget,
  resolveTargetWebContents
} = require('./screenshot')

function clipArray(items = [], maxItems = 40) {
  return Array.isArray(items) ? items.slice(0, maxItems) : []
}

function clipString(value = '', maxChars = 2000) {
  const text = String(value || '')
  return text.length > maxChars ? `${text.slice(0, maxChars)}\n...[truncated ${text.length - maxChars} chars]` : text
}

function listValues(items = [], key = 'value', limit = 8) {
  return clipArray(items, limit)
    .map(item => String(item?.[key] || item || '').trim())
    .filter(Boolean)
}

function briefLine(label, values = [], limit = 8) {
  const list = Array.isArray(values) ? values : [values]
  const text = listValues(list, 'value', limit).join(', ')
  return text ? `${label}: ${text}` : ''
}

function buildRuntimeReplicationBrief(analysis = {}) {
  const lines = []
  const refined = analysis.refinedDesignTokens || {}
  const priority = analysis.visualPriority || {}
  const layout = analysis.layoutSystem || {}
  const components = analysis.componentSystem || {}
  const sections = Array.isArray(analysis.sectionAnalysis) ? analysis.sectionAnalysis : []
  const animation = analysis.animationSystem || {}

  lines.push(`Target: ${analysis.title || analysis.url || 'website'}`)
  if (analysis.viewport) {
    lines.push(`Viewport baseline: ${analysis.viewport.width}x${analysis.viewport.height}; page scroll height ${analysis.scrollHeight || '?'}`)
  }
  if (sections.length) {
    lines.push(`Page structure: ${sections.slice(0, 12).map(item => `${item.role || item.tag || 'section'}(${item.y || 0}-${item.height || 0}px): ${item.layout || 'block'} ${item.text ? '- ' + item.text : ''}`.trim()).join(' | ')}`)
  }
  const colorRoles = priority.colorRoles || {}
  if (colorRoles.primaryBrand?.value) lines.push(`Primary brand color: ${colorRoles.primaryBrand.value} (${colorRoles.primaryBrand.reason || 'dominant accent'})`)
  if (colorRoles.accent?.value) lines.push(`Accent color: ${colorRoles.accent.value}`)
  if (colorRoles.pageBackground?.value) lines.push(`Page background: ${colorRoles.pageBackground.value}`)
  if (colorRoles.surface?.value) lines.push(`Surface color: ${colorRoles.surface.value}`)
  if (colorRoles.primaryText?.value) lines.push(`Primary text: ${colorRoles.primaryText.value}`)
  if (colorRoles.mutedText?.value) lines.push(`Muted text: ${colorRoles.mutedText.value}`)
  if (colorRoles.border?.value) lines.push(`Border/subtle line: ${colorRoles.border.value}`)
  if (colorRoles.danger?.value || colorRoles.success?.value) {
    lines.push(`Semantic colors: danger ${colorRoles.danger?.value || 'not obvious'}, success ${colorRoles.success?.value || 'not obvious'}`)
  }
  const fontScale = refined.typographyScale || []
  if (fontScale.length) lines.push(`Typography scale: ${fontScale.slice(0, 10).map(item => `${item.size}/${item.weight}`).join(', ')}`)
  const fonts = refined.fontFamilies || analysis.designTokens?.fonts || []
  const fontLine = briefLine('Font families', fonts, 6)
  if (fontLine) lines.push(fontLine)
  if (layout.contentWidths?.length) lines.push(`Content widths: ${layout.contentWidths.slice(0, 8).map(item => item.value || item).join(', ')}`)
  if (layout.spacingScale?.length) lines.push(`Spacing rhythm: ${layout.spacingScale.slice(0, 12).map(item => item.value || item).join(', ')}`)
  if (layout.gridPatterns?.length) lines.push(`Grid/layout patterns: ${layout.gridPatterns.slice(0, 8).map(item => item.value || item).join(', ')}`)
  if (refined.radiiScale?.length) lines.push(`Radius scale: ${refined.radiiScale.slice(0, 8).map(item => item.value || item).join(', ')}`)
  if (refined.shadowScale?.length) lines.push(`Shadow scale: ${refined.shadowScale.slice(0, 6).map(item => item.value || item).join(' | ')}`)
  const componentOrder = ['navigation', 'buttons', 'cards', 'forms', 'tags', 'media', 'lists']
  for (const name of componentOrder) {
    const item = components[name]
    if (!item || item.count <= 0) continue
    const signature = [
      item.layout ? `layout ${item.layout}` : '',
      item.typography ? `type ${item.typography}` : '',
      item.color ? `color ${item.color}` : '',
      item.background ? `bg ${item.background}` : '',
      item.radius ? `radius ${item.radius}` : '',
      item.spacing ? `spacing ${item.spacing}` : ''
    ].filter(Boolean).join('; ')
    lines.push(`${name}: ${item.count} samples${signature ? `; ${signature}` : ''}${item.example ? `; example ${item.example}` : ''}`)
  }
  if (animation.summary) lines.push(`Motion: ${animation.summary}`)
  if (animation.rules?.length) lines.push(`Motion rules: ${animation.rules.slice(0, 8).join(' | ')}`)
  if (analysis.designDna) {
    const dna = analysis.designDna
    if (dna.visualCharacter) lines.push(`Visual character: ${dna.visualCharacter}`)
    if (dna.composition) lines.push(`Composition: ${dna.composition}`)
    if (dna.hierarchy) lines.push(`Hierarchy: ${dna.hierarchy}`)
    if (dna.contentTone) lines.push(`Content tone: ${dna.contentTone}`)
    if (Array.isArray(dna.replicationChecklist) && dna.replicationChecklist.length) {
      lines.push(`Replication checklist: ${dna.replicationChecklist.slice(0, 10).join(' | ')}`)
    }
    if (Array.isArray(dna.avoid) && dna.avoid.length) {
      lines.push(`Avoid: ${dna.avoid.slice(0, 8).join(' | ')}`)
    }
  }
  if (analysis.technologySignals) {
    const tech = Object.entries(analysis.technologySignals).filter(([, value]) => value).map(([key]) => key)
    if (tech.length) lines.push(`Implementation signals: ${tech.join(', ')}`)
  }
  lines.push('Build guidance: recreate the section rhythm and component system first, then fill copy/assets; do not copy private source or rely on a single screenshot.')
  return lines.filter(Boolean).join('\n')
}

function timeoutError(label = 'operation', timeoutMs = 0) {
  const seconds = Math.max(1, Math.round(Number(timeoutMs || 0) / 1000))
  const error = new Error(`${label} 超时：${seconds} 秒内没有返回结果`)
  error.code = 'UI_INTERACTION_TIMEOUT'
  return error
}

function withTimeout(promise, timeoutMs, label = 'operation') {
  const ms = Math.max(1000, Number(timeoutMs || 0))
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(timeoutError(label, ms)), ms)
    Promise.resolve(promise).then(
      value => {
        clearTimeout(timer)
        resolve(value)
      },
      error => {
        clearTimeout(timer)
        reject(error)
      }
    )
  })
}

function getUiInteractionTimeouts(args = {}) {
  const total = Math.max(5000, Math.min(Number(args.timeout_ms || args.timeoutMs || 30000), 120000))
  const step = Math.max(1000, Math.min(Number(args.step_timeout_ms || args.stepTimeoutMs || Math.min(8000, Math.ceil(total / 4))), total))
  return { total, step }
}

function throwIfAborted(signal) {
  if (!signal?.aborted) return
  const reason = signal.reason
  const error = reason instanceof Error ? reason : new Error(reason ? String(reason) : 'ui interaction check aborted')
  error.name = 'AbortError'
  throw error
}

function getWebsiteResearchDir() {
  const dir = path.join(storageConfig.getCacheDir(), 'website-research')
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

function sameOrigin(left, right) {
  try {
    return new URL(left).origin === new URL(right).origin
  } catch {
    return false
  }
}

function sleep(ms = 0) {
  return new Promise(resolve => setTimeout(resolve, Math.max(0, Number(ms) || 0)))
}

function normalizeCrawlUrl(url = '', base = '') {
  try {
    const parsed = new URL(String(url || ''), base || undefined)
    if (!['http:', 'https:'].includes(parsed.protocol)) return ''
    parsed.hash = ''
    if ((parsed.protocol === 'http:' && parsed.port === '80') || (parsed.protocol === 'https:' && parsed.port === '443')) parsed.port = ''
    return parsed.href
  } catch {
    return ''
  }
}

function getCrawlUrlKey(url = '') {
  try {
    const parsed = new URL(url)
    const blockedParams = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'fbclid', 'gclid']
    blockedParams.forEach(key => parsed.searchParams.delete(key))
    parsed.hash = ''
    return parsed.href.replace(/\/+$/, '/')
  } catch {
    return String(url || '')
  }
}

function isLikelyBotChallenge({ statusCode = 0, title = '', text = '', url = '' } = {}) {
  const haystack = `${statusCode}\n${title}\n${url}\n${String(text || '').slice(0, 5000)}`.toLowerCase()
  return /captcha|recaptcha|hcaptcha|turnstile|cloudflare|cf-challenge|checking your browser|verify you are human|are you a human|access denied|forbidden|too many requests|unusual traffic|安全验证|验证码|人机验证|访问被拒绝|请求过于频繁|验证您是真人/.test(haystack)
}

async function fetchText(url, options = {}) {
  const timeoutMs = Math.max(3000, Math.min(Number(options.timeoutMs || 12000), 45000))
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        'user-agent': options.userAgent || 'LingXiWebsiteResearch/1.0 (+public-page-research)',
        accept: options.accept || 'text/html,application/xhtml+xml,application/xml,text/xml,text/plain;q=0.9,*/*;q=0.8'
      }
    })
    const text = await response.text()
    return {
      success: true,
      url: response.url || url,
      statusCode: response.status,
      contentType: response.headers.get('content-type') || '',
      text
    }
  } catch (error) {
    return { success: false, url, error: error.message }
  } finally {
    clearTimeout(timer)
  }
}

function parseRobotsTxt(text = '') {
  const groups = []
  let current = null
  const sitemaps = []
  for (const rawLine of String(text || '').split(/\r?\n/)) {
    const line = rawLine.replace(/#.*/, '').trim()
    if (!line) continue
    const index = line.indexOf(':')
    if (index <= 0) continue
    const key = line.slice(0, index).trim().toLowerCase()
    const value = line.slice(index + 1).trim()
    if (key === 'sitemap') {
      if (value) sitemaps.push(value)
      continue
    }
    if (key === 'user-agent') {
      if (current && current.rules.length === 0 && current.crawlDelay === null) {
        current.agents.push(value.toLowerCase())
      } else {
        current = { agents: [value.toLowerCase()], rules: [], crawlDelay: null }
        groups.push(current)
      }
      continue
    }
    if (!current) continue
    if (key === 'allow' || key === 'disallow') current.rules.push({ type: key, path: value })
    if (key === 'crawl-delay') current.crawlDelay = Number(value) || null
  }
  return { groups, sitemaps }
}

function getRobotsGroup(robots = {}) {
  const groups = Array.isArray(robots.groups) ? robots.groups : []
  return groups.find(group => group.agents?.some(agent => agent === '*' || agent.includes('lingxi'))) ||
    groups.find(group => group.agents?.includes('*')) ||
    null
}

function robotsAllows(url = '', robots = null) {
  if (!robots) return true
  const group = getRobotsGroup(robots)
  if (!group) return true
  let pathname = '/'
  try {
    const parsed = new URL(url)
    pathname = parsed.pathname || '/'
  } catch {
    return true
  }
  const matches = group.rules
    .filter(rule => rule.path && (rule.path === '/' || pathname.startsWith(rule.path.replace(/\*.*$/, ''))))
    .sort((a, b) => String(b.path).length - String(a.path).length)
  if (!matches.length) return true
  return matches[0].type === 'allow'
}

async function loadRobots(seedUrl = {}, options = {}) {
  try {
    const parsed = new URL(seedUrl)
    const robotsUrl = `${parsed.origin}/robots.txt`
    const result = await fetchText(robotsUrl, options)
    if (!result.success || result.statusCode >= 400) {
      return { success: false, url: robotsUrl, error: result.error || `status ${result.statusCode}`, groups: [], sitemaps: [] }
    }
    return { success: true, url: robotsUrl, ...parseRobotsTxt(result.text) }
  } catch (error) {
    return { success: false, error: error.message, groups: [], sitemaps: [] }
  }
}

function extractSitemapUrls(xml = '', baseUrl = '') {
  const urls = []
  const locRe = /<loc[^>]*>([\s\S]*?)<\/loc>/gi
  let match
  while ((match = locRe.exec(String(xml || ''))) && urls.length < 500) {
    const value = normalizeCrawlUrl(match[1].replace(/<!\[CDATA\[|\]\]>/g, '').trim(), baseUrl)
    if (value) urls.push(value)
  }
  return urls
}

async function loadSitemapUrls(seedUrl = '', robots = {}, options = {}) {
  const candidates = []
  try {
    const parsed = new URL(seedUrl)
    candidates.push(`${parsed.origin}/sitemap.xml`)
  } catch {}
  for (const item of robots?.sitemaps || []) {
    const normalized = normalizeCrawlUrl(item, seedUrl)
    if (normalized) candidates.push(normalized)
  }
  const uniqueCandidates = [...new Set(candidates)]
  const urls = []
  const sources = []
  for (const sitemapUrl of uniqueCandidates.slice(0, 8)) {
    const result = await fetchText(sitemapUrl, { ...options, accept: 'application/xml,text/xml,text/plain,*/*;q=0.8' })
    if (!result.success || result.statusCode >= 400) continue
    const extracted = extractSitemapUrls(result.text, result.url || sitemapUrl)
    if (extracted.length) {
      sources.push({ url: sitemapUrl, count: extracted.length })
      urls.push(...extracted)
    }
  }
  return { sources, urls: [...new Set(urls)] }
}

function classifyPage(url = '', title = '', text = '') {
  const haystack = `${url}\n${title}\n${String(text || '').slice(0, 1000)}`.toLowerCase()
  if (/docs|documentation|guide|manual|api|reference|developer|教程|文档|指南/.test(haystack)) return 'docs'
  if (/blog|news|article|post|insight|博客|新闻|文章/.test(haystack)) return 'article'
  if (/pricing|price|plans|subscribe|价格|定价|套餐/.test(haystack)) return 'pricing'
  if (/case|customer|showcase|portfolio|work|案例|客户|作品/.test(haystack)) return 'case'
  if (/product|feature|solution|platform|产品|功能|解决方案/.test(haystack)) return 'product'
  if (/about|company|team|关于|团队/.test(haystack)) return 'about'
  if (/contact|support|help|联系|支持|帮助/.test(haystack)) return 'support'
  return 'page'
}

function buildCrawlBrief(pages = [], blockedPages = []) {
  const lines = []
  lines.push(`Crawled pages: ${pages.length}; blocked/challenge pages: ${blockedPages.length}`)
  const byType = new Map()
  for (const page of pages) byType.set(page.type, (byType.get(page.type) || 0) + 1)
  if (byType.size) lines.push(`Page types: ${Array.from(byType.entries()).map(([type, count]) => `${type} ${count}`).join(', ')}`)
  const important = pages
    .slice()
    .sort((a, b) => (b.contentLength || 0) - (a.contentLength || 0))
    .slice(0, 12)
  for (const page of important) {
    lines.push(`- ${page.type}: ${page.title || page.url}`)
    if (page.description) lines.push(`  Description: ${clipString(page.description, 220)}`)
    if (page.headings?.length) lines.push(`  Headings: ${page.headings.slice(0, 6).map(item => item.text).filter(Boolean).join(' | ')}`)
    if (page.mainText) lines.push(`  Content: ${clipString(page.mainText, 420).replace(/\n+/g, ' ')}`)
  }
  if (blockedPages.length) {
    lines.push('Blocked or challenge pages were detected and not bypassed. Use authorized cookies/session manually if access is allowed.')
  }
  return lines.join('\n')
}

async function renderCrawlPage(url = '', args = {}) {
  const width = Math.max(320, Math.min(Number(args.viewport_width || args.viewportWidth || 1280), 3840))
  const height = Math.max(240, Math.min(Number(args.viewport_height || args.viewportHeight || 900), 2160))
  const delayMs = Math.max(0, Math.min(Number(args.delay_ms || args.delayMs || 500), 4000))
  const timeoutMs = Math.max(8000, Math.min(Number(args.page_timeout_ms || args.pageTimeoutMs || 30000), 90000))
  const consoleMessages = []
  const pageErrors = []
  const loadFailures = []
  const win = new BrowserWindow({
    show: false,
    width,
    height,
    webPreferences: {
      offscreen: true,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: false
    }
  })

  try {
    win.webContents.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36 LingXiWebsiteResearch/1.0')
    win.webContents.on('console-message', (event, level, message, line, sourceId) => {
      if (consoleMessages.length < 80) consoleMessages.push({ level, message, line, sourceId })
    })
    win.webContents.on('render-process-gone', (event, details) => {
      pageErrors.push({ message: `render process gone: ${details?.reason || 'unknown'}` })
    })
    win.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL, isMainFrame) => {
      loadFailures.push({ errorCode, errorDescription, validatedURL, isMainFrame })
    })

    await withTimeout(win.loadURL(url), timeoutMs, 'crawl page load')
    await waitForScreenshotTarget(win.webContents, { wait_until: args.wait_until || args.waitUntil || 'load', delay_ms: delayMs }, { alreadyLoaded: true })
    const page = await withTimeout(win.webContents.executeJavaScript(`
      (() => {
        const clean = (value, max = 2000) => String(value || '').replace(/\\s+/g, ' ').trim().slice(0, max);
        const absolute = value => {
          try { return new URL(value, location.href).href; } catch { return ''; }
        };
        const visible = el => {
          const rect = el.getBoundingClientRect();
          const style = getComputedStyle(el);
          return rect.width > 1 && rect.height > 1 && style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity || 1) > 0.01;
        };
        const meta = selector => document.querySelector(selector)?.getAttribute('content') || '';
        const mainCandidates = Array.from(document.querySelectorAll('main, article, [role="main"], .content, [class*="content"], [class*="article"], [class*="docs"], [class*="post"]'))
          .filter(visible)
          .map(el => ({ text: clean(el.innerText || el.textContent || '', 24000), selector: el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') }))
          .filter(item => item.text.length > 120)
          .sort((a, b) => b.text.length - a.text.length);
        const bodyText = clean(document.body?.innerText || '', 32000);
        const main = mainCandidates[0] || { text: bodyText, selector: 'body' };
        const headings = Array.from(document.querySelectorAll('h1,h2,h3,h4')).filter(visible).slice(0, 80).map(el => ({
          level: el.tagName.toLowerCase(),
          text: clean(el.innerText || el.textContent || '', 220)
        })).filter(item => item.text);
        const links = Array.from(document.querySelectorAll('a[href]')).map(a => ({
          text: clean(a.innerText || a.getAttribute('aria-label') || a.title || '', 180),
          href: absolute(a.getAttribute('href') || ''),
          rel: a.getAttribute('rel') || ''
        })).filter(item => item.href).slice(0, 500);
        const navLinks = Array.from(document.querySelectorAll('nav a[href], header a[href], footer a[href], aside a[href]')).map(a => ({
          text: clean(a.innerText || a.getAttribute('aria-label') || a.title || '', 140),
          href: absolute(a.getAttribute('href') || '')
        })).filter(item => item.href).slice(0, 220);
        const structuredData = Array.from(document.querySelectorAll('script[type="application/ld+json"]')).slice(0, 20).map(script => {
          const raw = script.textContent || '';
          try { return JSON.parse(raw); } catch { return { raw: raw.slice(0, 2000) }; }
        });
        const tables = Array.from(document.querySelectorAll('table')).filter(visible).slice(0, 12).map(table => clean(table.innerText || '', 2400));
        const codeBlocks = Array.from(document.querySelectorAll('pre, code')).filter(visible).slice(0, 40).map(el => clean(el.innerText || el.textContent || '', 1600)).filter(Boolean);
        const images = Array.from(document.images).filter(visible).slice(0, 80).map(img => ({
          src: img.currentSrc || img.src || '',
          alt: clean(img.alt || '', 180),
          width: img.naturalWidth || img.width || 0,
          height: img.naturalHeight || img.height || 0
        }));
        const title = clean(document.title || document.querySelector('h1')?.innerText || '', 240);
        const description = clean(meta('meta[name="description"]') || meta('meta[property="og:description"]') || '', 500);
        return {
          url: location.href,
          canonical: absolute(document.querySelector('link[rel="canonical"]')?.getAttribute('href') || location.href),
          title,
          description,
          language: document.documentElement.lang || '',
          mainSelector: main.selector,
          mainText: main.text,
          bodyTextLength: bodyText.length,
          headings,
          links,
          navLinks,
          structuredData,
          tables,
          codeBlocks,
          images,
          forms: Array.from(document.forms).slice(0, 12).map(form => ({ action: absolute(form.getAttribute('action') || ''), method: form.method || 'get', text: clean(form.innerText || '', 500) })),
          statusHints: clean(bodyText, 5000)
        };
      })()
    `), timeoutMs, 'crawl page extract')
    const blocked = isLikelyBotChallenge({
      title: page?.title,
      text: page?.statusHints || page?.mainText,
      url: page?.url || url,
      statusCode: loadFailures.find(item => item.isMainFrame)?.errorCode || 0
    })
    return {
      success: true,
      ...page,
      blocked,
      pageErrors,
      loadFailures,
      consoleMessages: consoleMessages.slice(-20)
    }
  } catch (error) {
    return {
      success: false,
      url,
      error: error.message,
      blocked: isLikelyBotChallenge({ title: '', text: error.message, url }),
      pageErrors,
      loadFailures,
      consoleMessages: consoleMessages.slice(-20)
    }
  } finally {
    if (!win.isDestroyed()) win.destroy()
  }
}

async function crawlWebsiteRuntime(args = {}, resolvePath = input => input) {
  const seedUrl = normalizeScreenshotUrl(args, resolvePath)
  const normalizedSeed = normalizeCrawlUrl(seedUrl)
  if (!normalizedSeed) {
    return { success: false, error: 'website crawl failed: missing valid url or html_path.' }
  }
  const maxPages = Math.max(1, Math.min(Number(args.max_pages || args.maxPages || 12), 80))
  const maxDepth = Math.max(0, Math.min(Number(args.max_depth || args.maxDepth || 2), 5))
  const sameOriginOnly = args.same_origin_only !== false && args.sameOriginOnly !== false
  const respectRobots = args.respect_robots !== false && args.respectRobots !== false
  const includeSitemap = args.include_sitemap !== false && args.includeSitemap !== false
  const delayMs = Math.max(0, Math.min(Number(args.crawl_delay_ms || args.crawlDelayMs || args.delay_ms || args.delayMs || 700), 10000))
  const robots = respectRobots ? await loadRobots(normalizedSeed, {}) : { success: false, skipped: true, groups: [], sitemaps: [] }
  const sitemap = includeSitemap ? await loadSitemapUrls(normalizedSeed, robots, {}) : { sources: [], urls: [] }
  const queue = [{ url: normalizedSeed, depth: 0, source: 'seed' }]
  for (const url of sitemap.urls.slice(0, maxPages * 4)) {
    if (!sameOriginOnly || sameOrigin(normalizedSeed, url)) queue.push({ url, depth: 1, source: 'sitemap' })
  }

  const visited = new Set()
  const queued = new Set(queue.map(item => getCrawlUrlKey(item.url)))
  const pages = []
  const blockedPages = []
  const skipped = []

  while (queue.length && pages.length + blockedPages.length < maxPages) {
    const next = queue.shift()
    const url = normalizeCrawlUrl(next.url, normalizedSeed)
    const key = getCrawlUrlKey(url)
    if (!url || visited.has(key)) continue
    visited.add(key)
    if (sameOriginOnly && !sameOrigin(normalizedSeed, url)) {
      skipped.push({ url, reason: 'cross-origin' })
      continue
    }
    if (respectRobots && !robotsAllows(url, robots)) {
      skipped.push({ url, reason: 'robots.txt disallow' })
      continue
    }

    const page = await renderCrawlPage(url, args)
    if (!page.success) {
      const item = { url, error: page.error, blocked: !!page.blocked, source: next.source, depth: next.depth }
      if (page.blocked) blockedPages.push(item)
      else skipped.push({ ...item, reason: 'load failed' })
      await sleep(delayMs)
      continue
    }

    const pageRecord = {
      url: page.url || url,
      canonical: page.canonical || '',
      title: page.title || '',
      description: page.description || '',
      language: page.language || '',
      type: classifyPage(page.url || url, page.title, page.mainText),
      depth: next.depth,
      source: next.source,
      mainSelector: page.mainSelector,
      contentLength: String(page.mainText || '').length,
      bodyTextLength: page.bodyTextLength || 0,
      mainText: clipString(page.mainText || '', Number(args.page_text_chars || args.pageTextChars || 5000)),
      headings: clipArray(page.headings, 40),
      navLinks: clipArray(page.navLinks, 80),
      links: clipArray(page.links, 120),
      structuredData: clipArray(page.structuredData, 12),
      tables: clipArray(page.tables, 8),
      codeBlocks: clipArray(page.codeBlocks, 12),
      images: clipArray(page.images, 40),
      forms: clipArray(page.forms, 8),
      blocked: !!page.blocked,
      consoleMessages: clipArray(page.consoleMessages, 12),
      pageErrors: clipArray(page.pageErrors, 12)
    }
    if (page.blocked) {
      blockedPages.push({
        url: pageRecord.url,
        title: pageRecord.title,
        reason: 'bot challenge or access verification detected',
        depth: next.depth
      })
    } else {
      pages.push(pageRecord)
    }

    if (next.depth < maxDepth && !page.blocked) {
      const candidates = [...(page.navLinks || []), ...(page.links || [])]
      for (const link of candidates) {
        const href = normalizeCrawlUrl(link.href, page.url || url)
        const hrefKey = getCrawlUrlKey(href)
        if (!href || queued.has(hrefKey) || visited.has(hrefKey)) continue
        if (sameOriginOnly && !sameOrigin(normalizedSeed, href)) continue
        if (respectRobots && !robotsAllows(href, robots)) continue
        queued.add(hrefKey)
        queue.push({ url: href, depth: next.depth + 1, source: next.depth === 0 ? 'page-link' : 'deep-link' })
      }
    }
    await sleep(delayMs)
  }

  const siteMap = pages.map(page => ({
    url: page.url,
    title: page.title,
    type: page.type,
    depth: page.depth,
    contentLength: page.contentLength,
    headings: page.headings?.slice(0, 4).map(item => item.text).filter(Boolean)
  }))
  return {
    success: true,
    mode: 'crawl',
    target: normalizedSeed,
    crawlPolicy: {
      maxPages,
      maxDepth,
      sameOriginOnly,
      respectRobots,
      includeSitemap,
      delayMs,
      bypassPolicy: 'Captcha, login walls, paywalls, and anti-bot challenges are detected and reported, not bypassed.'
    },
    robots: {
      success: !!robots.success,
      url: robots.url,
      sitemapCount: robots.sitemaps?.length || 0,
      crawlDelay: getRobotsGroup(robots)?.crawlDelay || null
    },
    sitemap,
    summary: {
      crawledPages: pages.length,
      blockedPages: blockedPages.length,
      skippedPages: skipped.length,
      discoveredQueued: queued.size,
      pageTypes: pages.reduce((acc, page) => {
        acc[page.type] = (acc[page.type] || 0) + 1
        return acc
      }, {})
    },
    siteMap,
    pages,
    blockedPages,
    skipped: skipped.slice(0, 80),
    contentBrief: buildCrawlBrief(pages, blockedPages)
  }
}

function normalizeSelectorList(value) {
  if (!value) return []
  if (Array.isArray(value)) return value.map(item => String(item || '').trim()).filter(Boolean)
  return String(value || '').split(',').map(item => item.trim()).filter(Boolean)
}

function uniqueSelectors(selectors = []) {
  return [...new Set(selectors.filter(Boolean))]
}

async function collectInteractionState(webContents, selectors = []) {
  return webContents.executeJavaScript(`
    (() => {
      const selectors = ${JSON.stringify(selectors)};
      const viewport = { width: window.innerWidth || 0, height: window.innerHeight || 0 };
      function nodeLabel(el) {
        if (!el) return null;
        return {
          tagName: el.tagName || '',
          id: el.id || '',
          className: typeof el.className === 'string' ? el.className : '',
          classList: Array.from(el.classList || []),
          role: el.getAttribute && el.getAttribute('role') || '',
          ariaExpanded: el.getAttribute && el.getAttribute('aria-expanded') || '',
          hidden: !!el.hidden
        };
      }
      function clean(value) {
        return String(value || '').replace(/\\s+/g, ' ').trim();
      }
      function semanticRole(el) {
        const explicit = clean(el?.getAttribute?.('role')).toLowerCase();
        if (explicit) return explicit;
        const tag = String(el?.tagName || '').toLowerCase();
        if (tag === 'button') return 'button';
        if (tag === 'a' && el.hasAttribute('href')) return 'link';
        if (tag === 'input') return ['button', 'submit', 'reset'].includes(el.type) ? 'button' : 'textbox';
        if (tag === 'select') return 'combobox';
        if (tag === 'textarea') return 'textbox';
        return '';
      }
      function accessibleName(el) {
        if (!el) return '';
        const labelledBy = clean(el.getAttribute?.('aria-labelledby'));
        const labelledText = labelledBy
          ? labelledBy.split(/\\s+/).map(id => document.getElementById(id)?.textContent || '').join(' ')
          : '';
        const explicitLabel = el.id ? document.querySelector('label[for="' + CSS.escape(el.id) + '"]')?.textContent : '';
        return clean(
          el.getAttribute?.('aria-label') || labelledText || explicitLabel || el.innerText || el.textContent ||
          el.getAttribute?.('title') || el.getAttribute?.('placeholder') || el.getAttribute?.('value') || ''
        );
      }
      function selectorHint(el) {
        if (!el) return '';
        if (el.id) return '#' + CSS.escape(el.id);
        const tag = String(el.tagName || '').toLowerCase();
        const classes = Array.from(el.classList || []).slice(0, 2).map(item => '.' + CSS.escape(item)).join('');
        return tag + classes;
      }
      function storageKeys(storage) {
        try { return Object.keys(window[storage]).slice(0, 30); } catch (_) { return []; }
      }
      function rectValue(rect) {
        return {
          x: Math.round(rect.x),
          y: Math.round(rect.y),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
          top: Math.round(rect.top),
          left: Math.round(rect.left),
          right: Math.round(rect.right),
          bottom: Math.round(rect.bottom)
        };
      }
      function styleValue(style) {
        return {
          display: style.display,
          visibility: style.visibility,
          opacity: style.opacity,
          pointerEvents: style.pointerEvents,
          position: style.position,
          zIndex: style.zIndex,
          transform: style.transform,
          overflow: style.overflow,
          overflowX: style.overflowX,
          overflowY: style.overflowY
        };
      }
      function nodeVisibility(el) {
        const style = getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        const opacity = Number(style.opacity || 1);
        const reasons = [];
        if (el.hidden) reasons.push('hidden attribute');
        if (el.hasAttribute && el.hasAttribute('inert')) reasons.push('inert attribute');
        if (style.display === 'none') reasons.push('display:none');
        if (style.visibility === 'hidden' || style.visibility === 'collapse') reasons.push('visibility:' + style.visibility);
        if (opacity <= 0) reasons.push('opacity:0');
        const zeroSize = rect.width <= 0 || rect.height <= 0;
        return { style, rect, reasons, zeroSize };
      }
      function overlapRect(a, b) {
        const left = Math.max(a.left, b.left);
        const top = Math.max(a.top, b.top);
        const right = Math.min(a.right, b.right);
        const bottom = Math.min(a.bottom, b.bottom);
        return { left, top, right, bottom, width: Math.max(0, right - left), height: Math.max(0, bottom - top) };
      }
      function visibilityDiagnostics(el) {
        const chain = [];
        let hiddenBy = null;
        let clippingAncestor = null;
        let current = el;
        let effectiveRect = el.getBoundingClientRect();
        let depth = 0;
        let targetZeroSize = false;
        while (current && current.nodeType === 1) {
          const state = nodeVisibility(current);
          if (depth === 0) targetZeroSize = state.zeroSize;
          const entry = {
            depth,
            node: nodeLabel(current),
            rect: rectValue(state.rect),
            style: styleValue(state.style),
            reasons: state.reasons
          };
          chain.push(entry);
          if (!hiddenBy && state.reasons.length) {
            hiddenBy = { depth, node: entry.node, reasons: state.reasons };
          }
          if (depth > 0 && /(hidden|clip|scroll|auto)/.test(state.style.overflowX + ' ' + state.style.overflowY)) {
            const clipped = overlapRect(effectiveRect, state.rect);
            if (!clippingAncestor && (clipped.width <= 0 || clipped.height <= 0)) {
              clippingAncestor = {
                depth,
                node: entry.node,
                overflowX: state.style.overflowX,
                overflowY: state.style.overflowY,
                reason: 'target is fully outside an ancestor clipping region'
              };
            }
            effectiveRect = clipped;
          }
          current = current.parentElement;
          depth += 1;
        }
        if (!hiddenBy && targetZeroSize) {
          hiddenBy = { depth: 0, node: nodeLabel(el), reasons: ['zero-size rect'] };
        }
        const targetRect = el.getBoundingClientRect();
        const samplePoints = targetRect.width > 0 && targetRect.height > 0 ? [
          [targetRect.left + targetRect.width / 2, targetRect.top + targetRect.height / 2],
          [targetRect.left + 1, targetRect.top + 1],
          [targetRect.right - 1, targetRect.bottom - 1]
        ] : [];
        let occludedBy = null;
        for (const [x, y] of samplePoints) {
          if (x < 0 || y < 0 || x >= viewport.width || y >= viewport.height) continue;
          const top = document.elementFromPoint(x, y);
          if (top && top !== el && !el.contains(top) && !top.contains(el)) {
            occludedBy = { node: nodeLabel(top), point: { x: Math.round(x), y: Math.round(y) } };
            break;
          }
        }
        const outsideViewport = targetRect.right <= 0 || targetRect.bottom <= 0 ||
          targetRect.left >= viewport.width || targetRect.top >= viewport.height;
        return {
          ancestorChain: chain,
          hiddenBy,
          clippingAncestor,
          occludedBy,
          outsideViewport,
          effectiveVisible: !hiddenBy && !clippingAncestor && !outsideViewport,
          effectiveInteractable: !hiddenBy && !clippingAncestor && !outsideViewport && !occludedBy
        };
      }
      function snap(selector) {
        let el = null;
        try {
          el = document.querySelector(selector);
        } catch (error) {
          return { selector, exists: false, invalid: true, error: error.message };
        }
        if (!el) return { selector, exists: false };
        const style = getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        const opacity = Number(style.opacity || 1);
        const selfVisible = style.display !== 'none' && style.visibility !== 'hidden' &&
          opacity > 0 && !el.hidden;
        const diagnostics = visibilityDiagnostics(el);
        const visible = diagnostics.effectiveVisible;
        const interactable = diagnostics.effectiveInteractable && style.pointerEvents !== 'none';
        return {
          selector,
          exists: true,
          node: nodeLabel(el),
          parent: nodeLabel(el.parentElement),
          childElementCount: el.childElementCount || 0,
          textSample: String(el.innerText || el.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 120),
          rect: rectValue(rect),
          offsetHeight: el.offsetHeight || 0,
          offsetWidth: el.offsetWidth || 0,
          style: styleValue(style),
          selfVisible,
          effectiveVisible: diagnostics.effectiveVisible,
          hiddenBy: diagnostics.hiddenBy,
          clippingAncestor: diagnostics.clippingAncestor,
          occludedBy: diagnostics.occludedBy,
          outsideViewport: diagnostics.outsideViewport,
          ancestorChain: diagnostics.ancestorChain,
          visible,
          interactable
        };
      }
      const bodyText = clean(document.body?.innerText || '');
      const interactiveNodes = Array.from(document.querySelectorAll(
        'button,a[href],input,select,textarea,[role],[tabindex],[contenteditable="true"]'
      ));
      const interactiveElements = interactiveNodes.slice(0, 40).map(el => {
        const diagnostics = visibilityDiagnostics(el);
        const style = getComputedStyle(el);
        return {
          selector: selectorHint(el),
          role: semanticRole(el),
          name: accessibleName(el).slice(0, 120),
          id: el.id || '',
          className: typeof el.className === 'string' ? el.className : '',
          disabled: !!el.disabled || el.getAttribute('aria-disabled') === 'true',
          effectiveVisible: diagnostics.effectiveVisible,
          interactable: diagnostics.effectiveInteractable && style.pointerEvents !== 'none' && !el.disabled,
          hiddenBy: diagnostics.hiddenBy,
          clippingAncestor: diagnostics.clippingAncestor,
          occludedBy: diagnostics.occludedBy
        };
      });
      return {
        url: location.href,
        title: document.title || '',
        readyState: document.readyState,
        page: {
          url: location.href,
          title: document.title || '',
          readyState: document.readyState,
          bodyTextLength: bodyText.length,
          bodyTextSample: bodyText.slice(0, 300),
          bodyChildCount: document.body?.children?.length || 0,
          interactiveElementCount: interactiveNodes.length,
          visibleInteractiveElementCount: interactiveElements.filter(item => item.effectiveVisible).length,
          localStorageKeys: storageKeys('localStorage'),
          sessionStorageKeys: storageKeys('sessionStorage'),
          hasElectronBridge: !!(window.electronAPI || window.electron || window.api),
          frameCount: window.frames.length
        },
        interactiveElements,
        selectors: selectors.map(snap)
      };
    })()
  `)
}

function normalizeLocator(value, fallbackSelector = '') {
  if (value && typeof value === 'object') {
    return {
      selector: String(value.selector || '').trim(),
      text: String(value.text || value.label || '').trim(),
      role: String(value.role || '').trim().toLowerCase(),
      name: String(value.name || value.accessible_name || value.accessibleName || '').trim()
    }
  }
  return { selector: String(value || fallbackSelector || '').trim(), text: '', role: '', name: '' }
}

function hasLocator(locator = {}) {
  return !!(locator.selector || locator.text || locator.role || locator.name)
}

async function clickLocator(webContents, locatorInput, options = {}) {
  const locator = normalizeLocator(locatorInput)
  const waitMs = Math.max(0, Math.min(Number(options.wait_ms ?? options.waitMs ?? 1500), 10000))
  const pollMs = Math.max(50, Math.min(Number(options.poll_ms ?? options.pollMs ?? 120), 1000))
  const inputMode = ['semantic', 'pointer'].includes(String(options.input_mode || options.inputMode || '').toLowerCase())
    ? String(options.input_mode || options.inputMode).toLowerCase()
    : 'semantic'
  const stableMs = waitMs > 0
    ? Math.max(0, Math.min(Number(options.stable_ms ?? options.stableMs ?? 120), Math.min(waitMs, 1000)))
    : 0
  const result = await webContents.executeJavaScript(`
    (async () => {
      const locator = ${JSON.stringify(locator)};
      const waitMs = ${waitMs};
      const pollMs = ${pollMs};
      const inputMode = ${JSON.stringify(inputMode)};
      const stableMs = ${stableMs};
      const viewport = () => ({ width: window.innerWidth || 0, height: window.innerHeight || 0 });
      const clean = value => String(value || '').replace(/\\s+/g, ' ').trim();
      const nodeLabel = el => el ? {
        tagName: el.tagName || '',
        id: el.id || '',
        className: typeof el.className === 'string' ? el.className : '',
        role: el.getAttribute?.('role') || '',
        hidden: !!el.hidden
      } : null;
      const rectValue = rect => ({
        x: Math.round(rect.x), y: Math.round(rect.y),
        width: Math.round(rect.width), height: Math.round(rect.height),
        top: Math.round(rect.top), left: Math.round(rect.left),
        right: Math.round(rect.right), bottom: Math.round(rect.bottom)
      });
      const styleValue = style => ({
        display: style.display,
        visibility: style.visibility,
        opacity: style.opacity,
        pointerEvents: style.pointerEvents,
        overflowX: style.overflowX,
        overflowY: style.overflowY,
        position: style.position,
        zIndex: style.zIndex
      });
      const semanticRole = el => {
        const explicit = clean(el?.getAttribute?.('role')).toLowerCase();
        if (explicit) return explicit;
        const tag = String(el?.tagName || '').toLowerCase();
        if (tag === 'button') return 'button';
        if (tag === 'a' && el.hasAttribute('href')) return 'link';
        if (tag === 'input') return ['button', 'submit', 'reset'].includes(el.type) ? 'button' : 'textbox';
        if (tag === 'select') return 'combobox';
        if (tag === 'textarea') return 'textbox';
        return '';
      };
      const accessibleName = el => {
        const labelledBy = clean(el?.getAttribute?.('aria-labelledby'));
        const labelledText = labelledBy
          ? labelledBy.split(/\\s+/).map(id => document.getElementById(id)?.textContent || '').join(' ')
          : '';
        const explicitLabel = el?.id ? document.querySelector('label[for="' + CSS.escape(el.id) + '"]')?.textContent : '';
        return clean(
          el?.getAttribute?.('aria-label') || labelledText || explicitLabel || el?.innerText || el?.textContent ||
          el?.getAttribute?.('title') || el?.getAttribute?.('placeholder') || el?.getAttribute?.('value') || ''
        );
      };
      const selectorHint = el => {
        if (!el) return '';
        if (el.id) return '#' + CSS.escape(el.id);
        const tag = String(el.tagName || '').toLowerCase();
        return tag + Array.from(el.classList || []).slice(0, 2).map(item => '.' + CSS.escape(item)).join('');
      };
      const overlapRect = (a, b) => {
        const left = Math.max(a.left, b.left);
        const top = Math.max(a.top, b.top);
        const right = Math.min(a.right, b.right);
        const bottom = Math.min(a.bottom, b.bottom);
        return { left, top, right, bottom, width: Math.max(0, right - left), height: Math.max(0, bottom - top) };
      };
      const visibilityDiagnostics = el => {
        const chain = [];
        let hiddenBy = null;
        let clippingAncestor = null;
        let effectiveRect = el.getBoundingClientRect();
        let current = el;
        let depth = 0;
        let targetZeroSize = false;
        while (current && current.nodeType === 1) {
          const style = getComputedStyle(current);
          const rect = current.getBoundingClientRect();
          const reasons = [];
          if (current.hidden) reasons.push('hidden attribute');
          if (current.hasAttribute?.('inert')) reasons.push('inert attribute');
          if (style.display === 'none') reasons.push('display:none');
          if (style.visibility === 'hidden' || style.visibility === 'collapse') reasons.push('visibility:' + style.visibility);
          if (Number(style.opacity || 1) <= 0) reasons.push('opacity:0');
          if (depth === 0) targetZeroSize = rect.width <= 0 || rect.height <= 0;
          const entry = { depth, node: nodeLabel(current), rect: rectValue(rect), style: styleValue(style), reasons };
          chain.push(entry);
          if (!hiddenBy && reasons.length) hiddenBy = { depth, node: entry.node, reasons };
          if (depth > 0 && /(hidden|clip|scroll|auto)/.test(style.overflowX + ' ' + style.overflowY)) {
            const clipped = overlapRect(effectiveRect, rect);
            if (!clippingAncestor && (clipped.width <= 0 || clipped.height <= 0)) {
              clippingAncestor = {
                depth,
                node: entry.node,
                overflowX: style.overflowX,
                overflowY: style.overflowY,
                reason: 'target is fully outside an ancestor clipping region'
              };
            }
            effectiveRect = clipped;
          }
          current = current.parentElement;
          depth += 1;
        }
        if (!hiddenBy && targetZeroSize) {
          hiddenBy = { depth: 0, node: nodeLabel(el), reasons: ['zero-size rect'] };
        }
        const targetRect = el.getBoundingClientRect();
        const size = viewport();
        const outsideViewport = targetRect.right <= 0 || targetRect.bottom <= 0 ||
          targetRect.left >= size.width || targetRect.top >= size.height;
        const samplePoints = targetRect.width > 0 && targetRect.height > 0 ? [
          [targetRect.left + targetRect.width / 2, targetRect.top + targetRect.height / 2],
          [targetRect.left + 1, targetRect.top + 1],
          [targetRect.right - 1, targetRect.bottom - 1]
        ] : [];
        let occludedBy = null;
        for (const [x, y] of samplePoints) {
          if (x < 0 || y < 0 || x >= size.width || y >= size.height) continue;
          const top = document.elementFromPoint(x, y);
          if (top && top !== el && !el.contains(top) && !top.contains(el)) {
            occludedBy = { node: nodeLabel(top), point: { x: Math.round(x), y: Math.round(y) } };
            break;
          }
        }
        const style = getComputedStyle(el);
        const disabled = !!el.disabled || el.getAttribute?.('aria-disabled') === 'true';
        const pointerBlocked = style.pointerEvents === 'none';
        return {
          ancestorChain: chain,
          hiddenBy,
          clippingAncestor,
          occludedBy,
          outsideViewport,
          disabled,
          pointerBlocked,
          effectiveVisible: !hiddenBy && !clippingAncestor && !outsideViewport,
          effectiveInteractable: !hiddenBy && !clippingAncestor && !outsideViewport && !occludedBy && !disabled && !pointerBlocked
        };
      };
      const describe = el => {
        const diagnostics = visibilityDiagnostics(el);
        return {
          selector: selectorHint(el),
          role: semanticRole(el),
          name: accessibleName(el).slice(0, 160),
          id: el.id || '',
          className: typeof el.className === 'string' ? el.className : '',
          rect: rectValue(el.getBoundingClientRect()),
          effectiveVisible: diagnostics.effectiveVisible,
          interactable: diagnostics.effectiveInteractable,
          hiddenBy: diagnostics.hiddenBy,
          clippingAncestor: diagnostics.clippingAncestor,
          occludedBy: diagnostics.occludedBy,
          outsideViewport: diagnostics.outsideViewport,
          disabled: diagnostics.disabled,
          pointerBlocked: diagnostics.pointerBlocked,
          ancestorChain: diagnostics.ancestorChain
        };
      };
      const inventory = () => Array.from(document.querySelectorAll(
        'button,a[href],input,select,textarea,[role],[tabindex],[contenteditable="true"]'
      )).slice(0, 40).map(describe).slice(0, 16);
      let stableSignature = '';
      let stableSince = 0;
      const inspectAndClick = () => {
        let elements = [];
        if (locator.selector) {
          try {
            elements = Array.from(document.querySelectorAll(locator.selector));
          } catch (error) {
            return {
              found: false,
              error_type: 'invalid_selector',
              reason: 'invalid_selector',
              error: 'invalid selector: ' + error.message,
              locator,
              nearby_candidates: inventory()
            };
          }
        } else {
          elements = Array.from(document.querySelectorAll(
            'button,a[href],input,select,textarea,[role],[tabindex],[contenteditable="true"]'
          ));
        }
        const matched = elements.filter(el => {
          const name = accessibleName(el);
          if (locator.role && semanticRole(el) !== locator.role) return false;
          if (locator.name && !name.toLowerCase().includes(locator.name.toLowerCase())) return false;
          if (locator.text && !name.toLowerCase().includes(locator.text.toLowerCase())) return false;
          return true;
        });
        const described = matched.map(el => ({ el, details: describe(el) }));
        const structurallyAvailable = described.filter(item =>
          !item.details.hiddenBy && !item.details.clippingAncestor && !item.details.disabled && !item.details.pointerBlocked
        );
        if (!structurallyAvailable.length) {
          return {
            found: false,
            locator,
            reason: matched.length
              ? 'locator_not_interactable'
              : elements.length ? 'locator_filter_mismatch' : 'locator_absent',
            selector_match_count: elements.length,
            semantic_match_count: matched.length,
            candidates: described.slice(0, 8).map(item => item.details),
            nearby_candidates: inventory()
          };
        }
        if (structurallyAvailable.length > 1 && !locator.selector) {
          return {
            found: false,
            ambiguous: true,
            reason: 'locator_ambiguous',
            locator,
            selector_match_count: elements.length,
            semantic_match_count: matched.length,
            candidates: structurallyAvailable.slice(0, 8).map(item => item.details),
            nearby_candidates: inventory()
          };
        }
        const el = structurallyAvailable[0].el;
        el.scrollIntoView({ block: 'center', inline: 'center' });
        const diagnostics = visibilityDiagnostics(el);
        if (!diagnostics.effectiveInteractable) {
          return {
            found: false,
            locator,
            reason: 'locator_not_interactable',
            selector_match_count: elements.length,
            semantic_match_count: matched.length,
            candidates: [describe(el)],
            nearby_candidates: inventory()
          };
        }
        if (typeof el.focus === 'function') el.focus({ preventScroll: true });
        const rect = el.getBoundingClientRect();
        const rectSignature = [
          selectorHint(el),
          Math.round(rect.left),
          Math.round(rect.top),
          Math.round(rect.width),
          Math.round(rect.height)
        ].join(':');
        if (rectSignature !== stableSignature) {
          stableSignature = rectSignature;
          stableSince = Date.now();
        }
        if (Date.now() - stableSince < stableMs) {
          return {
            found: false,
            waiting: true,
            locator,
            reason: 'locator_not_stable',
            stable_for_ms: Date.now() - stableSince,
            required_stable_ms: stableMs,
            candidates: [describe(el)],
            nearby_candidates: inventory()
          };
        }
        const result = {
          found: true,
          locator,
          selector: selectorHint(el),
          role: semanticRole(el),
          name: accessibleName(el).slice(0, 160),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
          diagnostics
        };
        if (inputMode === 'pointer') {
          const x = Math.round(rect.left + rect.width / 2);
          const y = Math.round(rect.top + rect.height / 2);
          const hit = document.elementFromPoint(x, y);
          if (!hit || (hit !== el && !el.contains(hit))) {
            return {
              found: false,
              locator,
              reason: 'pointer_hit_test_failed',
              dispatch_point: { x, y },
              hit_target: nodeLabel(hit),
              candidates: [describe(el)],
              nearby_candidates: inventory()
            };
          }
          return {
            ...result,
            action_fidelity: 'native_pointer',
            dispatch_point: { x, y },
            pending_native_pointer: true
          };
        }
        if (typeof el.click === 'function') el.click();
        else el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
        return { ...result, action_fidelity: 'dom_semantic' };
      };
      const startedAt = Date.now();
      let result;
      do {
        result = inspectAndClick();
        if (result.found || result.ambiguous || result.reason === 'invalid_selector') break;
        if (Date.now() - startedAt >= waitMs) break;
        await new Promise(resolve => setTimeout(resolve, pollMs));
      } while (true);
      return { ...result, waited_ms: Date.now() - startedAt };
    })()
  `)
  if (result?.pending_native_pointer && result.dispatch_point) {
    const { x, y } = result.dispatch_point
    webContents.sendInputEvent({ type: 'mouseMove', x, y })
    webContents.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 })
    webContents.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount: 1 })
    const { pending_native_pointer: _, ...completed } = result
    return completed
  }
  return result
}

async function clickSelector(webContents, selector) {
  return clickLocator(webContents, { selector })
}

function summarizeSelectorChange(before = {}, after = {}) {
  const beforeItems = new Map((before.selectors || []).map(item => [item.selector, item]))
  return (after.selectors || []).map(item => {
    const old = beforeItems.get(item.selector) || {}
    return {
      selector: item.selector,
      exists_before: !!old.exists,
      exists_after: !!item.exists,
      visible_before: old.visible,
      visible_after: item.visible,
      class_before: old.node?.className || '',
      class_after: item.node?.className || '',
      parent_class_before: old.parent?.className || '',
      parent_class_after: item.parent?.className || '',
      display_before: old.style?.display,
      display_after: item.style?.display,
      visibility_before: old.style?.visibility,
      visibility_after: item.style?.visibility,
      opacity_before: old.style?.opacity,
      opacity_after: item.style?.opacity
    }
  })
}

function isConsoleErrorMessage(item = {}) {
  const level = String(item.level || '').toLowerCase()
  const message = String(item.message || '')
  return level === '3' ||
    level === 'error' ||
    /(^|\b)(uncaught|referenceerror|typeerror|syntaxerror|rangeerror|failed to load module script|not defined|unhandledrejection)(\b|$)/i.test(message)
}

async function installInteractionErrorProbe(webContents) {
  try {
    await webContents.executeJavaScript(`
      (() => {
        window.__lingxiUiInteractionErrors = [];
        if (!window.__lingxiUiInteractionProbeInstalled) {
          window.__lingxiUiInteractionProbeInstalled = true;
          window.addEventListener('error', event => {
            window.__lingxiUiInteractionErrors.push({
              type: 'window.error',
              message: event.message || String(event.error || ''),
              source: event.filename || '',
              line: event.lineno || 0,
              column: event.colno || 0,
              stack: event.error && event.error.stack ? String(event.error.stack).slice(0, 2000) : ''
            });
          });
          window.addEventListener('unhandledrejection', event => {
            const reason = event.reason;
            window.__lingxiUiInteractionErrors.push({
              type: 'unhandledrejection',
              message: reason && reason.message ? reason.message : String(reason || ''),
              stack: reason && reason.stack ? String(reason.stack).slice(0, 2000) : ''
            });
          });
        }
      })()
    `)
  } catch (_) { /* 注入 JS 探针失败 */ }
}

async function readInteractionErrorProbe(webContents) {
  try {
    const events = await webContents.executeJavaScript(`
      (() => Array.isArray(window.__lingxiUiInteractionErrors)
        ? window.__lingxiUiInteractionErrors.slice(-20)
        : [])()
    `)
    return Array.isArray(events) ? events : []
  } catch (_) {
    return []
  }
}

function selectorVisible(state = {}, selector = '') {
  if (!selector) return null
  const item = (state.selectors || []).find(entry => entry.selector === selector)
  if (!item?.exists) return false
  return item.visible === true
}

function selectorState(state = {}, selector = '') {
  if (!selector) return null
  return (state.selectors || []).find(entry => entry.selector === selector) || { selector, exists: false }
}

const RUNTIME_ASSERTION_PROPERTY_ALIASES = {
  exists: 'exists',
  visible: 'visible',
  effectivevisible: 'visible',
  interactable: 'interactable',
  childelementcount: 'childElementCount',
  child_count: 'childElementCount',
  offsetheight: 'offsetHeight',
  height: 'offsetHeight',
  offsetwidth: 'offsetWidth',
  width: 'offsetWidth',
  text: 'text',
  textcontent: 'text',
  display: 'display',
  visibility: 'visibility',
  opacity: 'opacity',
  classcontains: 'classContains',
  class_contains: 'classContains',
  ariaexpanded: 'ariaExpanded',
  aria_expanded: 'ariaExpanded'
}

const RUNTIME_ASSERTION_OPERATOR_ALIASES = {
  '==': 'equals',
  '===': 'equals',
  eq: 'equals',
  equals: 'equals',
  '!=': 'not_equals',
  '!==': 'not_equals',
  ne: 'not_equals',
  not_equals: 'not_equals',
  '>': 'gt',
  gt: 'gt',
  '>=': 'gte',
  gte: 'gte',
  '<': 'lt',
  lt: 'lt',
  '<=': 'lte',
  lte: 'lte',
  includes: 'includes',
  contains: 'includes',
  not_includes: 'not_includes'
}

function normalizeRuntimeAssertions(value) {
  const list = Array.isArray(value) ? value : []
  return list.slice(0, 32).map((item, index) => {
    if (!item || typeof item !== 'object') return null
    const selector = String(item.selector || '').trim()
    const rawProperty = String(item.property || item.field || '').trim()
    const property = RUNTIME_ASSERTION_PROPERTY_ALIASES[rawProperty.toLowerCase()] || rawProperty
    const rawOperator = String(item.operator || item.op || 'equals').trim().toLowerCase()
    const operator = RUNTIME_ASSERTION_OPERATOR_ALIASES[rawOperator] || rawOperator
    if (!selector || !property || !Object.values(RUNTIME_ASSERTION_PROPERTY_ALIASES).includes(property)) return null
    if (!Object.values(RUNTIME_ASSERTION_OPERATOR_ALIASES).includes(operator)) return null
    return {
      id: String(item.id || `assertion-${index + 1}`),
      selector,
      property,
      operator,
      expected: item.expected !== undefined ? item.expected : item.value
    }
  }).filter(Boolean)
}

function runtimeAssertionActual(item, assertion) {
  if (assertion.property === 'exists') return item?.exists === true
  if (!item?.exists) return undefined
  if (assertion.property === 'visible') return item.visible === true
  if (assertion.property === 'interactable') return item.interactable === true
  if (assertion.property === 'childElementCount') return Number(item.childElementCount || 0)
  if (assertion.property === 'offsetHeight') return Number(item.offsetHeight ?? item.rect?.height ?? 0)
  if (assertion.property === 'offsetWidth') return Number(item.offsetWidth ?? item.rect?.width ?? 0)
  if (assertion.property === 'text') return String(item.textSample || '')
  if (assertion.property === 'display') return String(item.style?.display || '')
  if (assertion.property === 'visibility') return String(item.style?.visibility || '')
  if (assertion.property === 'opacity') return Number(item.style?.opacity ?? 1)
  if (assertion.property === 'classContains') return Array.isArray(item.node?.classList)
    ? item.node.classList.includes(String(assertion.expected || ''))
    : false
  if (assertion.property === 'ariaExpanded') return String(item.node?.ariaExpanded || '')
  return undefined
}

function compareRuntimeAssertion(actual, operator, expected) {
  if (operator === 'equals') return actual === expected || String(actual) === String(expected)
  if (operator === 'not_equals') return !(actual === expected || String(actual) === String(expected))
  if (operator === 'includes') return String(actual ?? '').includes(String(expected ?? ''))
  if (operator === 'not_includes') return !String(actual ?? '').includes(String(expected ?? ''))
  const left = Number(actual)
  const right = Number(expected)
  if (!Number.isFinite(left) || !Number.isFinite(right)) return false
  if (operator === 'gt') return left > right
  if (operator === 'gte') return left >= right
  if (operator === 'lt') return left < right
  if (operator === 'lte') return left <= right
  return false
}

function evaluateRuntimeAssertions(state = {}, assertions = []) {
  return assertions.map(assertion => {
    const item = selectorState(state, assertion.selector)
    const actual = runtimeAssertionActual(item, assertion)
    const passed = compareRuntimeAssertion(actual, assertion.operator, assertion.expected)
    return {
      ...assertion,
      actual,
      passed,
      evidence: item
    }
  })
}

function runtimeStateSignature(state = {}) {
  return JSON.stringify({
    readyState: state.readyState || state.page?.readyState || '',
    selectors: (state.selectors || []).map(item => ({
      selector: item.selector,
      exists: item.exists,
      rect: item.rect,
      display: item.style?.display,
      visibility: item.style?.visibility,
      opacity: item.style?.opacity,
      childElementCount: item.childElementCount,
      textSample: item.textSample,
      classList: item.node?.classList,
      ariaExpanded: item.node?.ariaExpanded
    }))
  })
}

async function waitForInteractionOutcome(webContents, selectors = [], options = {}) {
  const assertions = normalizeRuntimeAssertions(options.assertions)
  const timeoutMs = Math.max(0, Math.min(Number(options.timeoutMs ?? 3000), 10000))
  const pollMs = Math.max(50, Math.min(Number(options.pollMs ?? 100), 1000))
  const settleMs = Math.max(0, Math.min(Number(options.settleMs ?? 120), 1000))
  const startedAt = Date.now()
  let lastState = null
  let assertionResults = []
  let signature = ''
  let stableSince = 0
  let conditionsPassed = false

  do {
    lastState = await collectInteractionState(webContents, selectors)
    assertionResults = evaluateRuntimeAssertions(lastState, assertions)
    conditionsPassed =
      (!options.expectedVisibleSelector || selectorVisible(lastState, options.expectedVisibleSelector) === true) &&
      (!options.expectedHiddenSelector || selectorVisible(lastState, options.expectedHiddenSelector) === false) &&
      assertionResults.every(item => item.passed)

    const nextSignature = runtimeStateSignature(lastState)
    if (nextSignature === signature) {
      if (!stableSince) stableSince = Date.now()
    } else {
      signature = nextSignature
      stableSince = Date.now()
    }
    const stable = Date.now() - stableSince >= settleMs
    if (conditionsPassed && stable) {
      return {
        state: lastState,
        assertions: assertionResults,
        conditions_passed: true,
        timed_out: false,
        waited_ms: Date.now() - startedAt
      }
    }
    if (Date.now() - startedAt >= timeoutMs) break
    await new Promise(resolve => setTimeout(resolve, pollMs))
  } while (true)

  return {
    state: lastState || await collectInteractionState(webContents, selectors),
    assertions: assertionResults,
    conditions_passed: conditionsPassed,
    timed_out: true,
    waited_ms: Date.now() - startedAt
  }
}

function compactInteractionCandidates(items = [], limit = 8) {
  return (Array.isArray(items) ? items : []).slice(0, limit).map(item => ({
    selector: item.selector || '',
    role: item.role || '',
    name: item.name || '',
    id: item.id || '',
    className: item.className || '',
    effectiveVisible: item.effectiveVisible,
    interactable: item.interactable,
    disabled: item.disabled,
    pointerBlocked: item.pointerBlocked,
    hiddenBy: item.hiddenBy || null,
    clippingAncestor: item.clippingAncestor || null,
    occludedBy: item.occludedBy || null
  }))
}

function buildInteractionFailureDiagnosis({
  click,
  before,
  after,
  expectedVisibleSelector,
  expectedHiddenSelector,
  closeClick,
  pageErrors,
  consoleErrors,
  requireVisualChange,
  visualChanges
} = {}) {
  const page = before?.page || {
    url: before?.url || '',
    title: before?.title || '',
    readyState: before?.readyState || ''
  }
  const currentPage = {
    url: page.url || before?.url || '',
    title: page.title || before?.title || '',
    readyState: page.readyState || before?.readyState || '',
    bodyTextLength: Number(page.bodyTextLength || 0),
    bodyTextSample: page.bodyTextSample || '',
    bodyChildCount: Number(page.bodyChildCount || 0),
    interactiveElementCount: Number(page.interactiveElementCount || 0),
    visibleInteractiveElementCount: Number(page.visibleInteractiveElementCount || 0),
    localStorageKeys: page.localStorageKeys || [],
    sessionStorageKeys: page.sessionStorageKeys || [],
    hasElectronBridge: page.hasElectronBridge === true
  }
  const base = {
    current_page: currentPage,
    requested_locator: click?.locator || null,
    click_reason: click?.reason || '',
    click_candidates: compactInteractionCandidates(click?.candidates),
    nearby_candidates: compactInteractionCandidates(click?.nearby_candidates || before?.interactiveElements),
    expected_visible_state: selectorState(after, expectedVisibleSelector),
    expected_hidden_state: selectorState(after, expectedHiddenSelector)
  }

  if (!click?.found) {
    if (click?.reason === 'invalid_selector') {
      return {
        ...base,
        category: 'invalid_locator',
        error_type: 'ui_invalid_selector',
        failed_stage: 'locate_click_target',
        summary: click.error || '点击选择器语法无效。',
        next_action: '修正 click_locator.selector；不要原样重试。可改用 role/name 或从 nearby_candidates 选择稳定定位。'
      }
    }
    if (click?.ambiguous || click?.reason === 'locator_ambiguous') {
      return {
        ...base,
        category: 'ambiguous_locator',
        error_type: 'ui_locator_ambiguous',
        failed_stage: 'locate_click_target',
        summary: '点击定位命中多个可交互元素，工具拒绝猜测目标。',
        next_action: '根据 click_candidates 补充更精确的 selector、role/name 或 text 后重试。'
      }
    }
    if (click?.reason === 'locator_not_interactable') {
      const blocked = compactInteractionCandidates(click?.candidates, 1)[0] || null
      return {
        ...base,
        category: 'precondition_or_visibility_block',
        error_type: 'ui_element_not_interactable',
        failed_stage: 'locate_click_target',
        blocking_evidence: blocked,
        summary: '点击目标存在，但被隐藏祖先、裁切、遮挡、禁用状态或 pointer-events 阻断。',
        next_action: '先满足页面前置状态；按 blocking_evidence 的 hiddenBy、clippingAncestor、occludedBy 或 disabled 修复，再重试。'
      }
    }
    const blankPage = currentPage.bodyTextLength === 0 && currentPage.interactiveElementCount === 0
    const noInteractiveUi = currentPage.interactiveElementCount === 0
    if (blankPage || noInteractiveUi) {
      return {
        ...base,
        category: blankPage ? 'blank_or_wrong_runtime_target' : 'missing_runtime_precondition',
        error_type: blankPage ? 'runtime_target_blank_or_wrong' : 'ui_precondition_missing',
        failed_stage: 'runtime_preflight',
        summary: blankPage
          ? '当前运行目标是空页面或错误页面，无法执行所请求的 UI 交互。'
          : '当前页面没有可交互控件，通常表示路由、登录、项目数据或初始化前置状态未满足。',
        next_action: blankPage
          ? '启动并绑定与当前工作区匹配且 verification_eligible=true 的开发运行实例；多候选时按 candidates 选择 runtime_id，确认 current_page.url 后再交互。'
          : '先切换到正确路由并准备登录/项目/测试数据；确认 nearby_candidates 出现目标后再重试，禁止原样循环调用。'
      }
    }
    return {
      ...base,
      category: 'locator_not_found_on_current_page',
      error_type: 'ui_locator_not_found',
      failed_stage: 'locate_click_target',
      summary: '当前页面存在其他可交互控件，但请求的定位条件没有命中。',
      next_action: '核对 current_page.url 与 nearby_candidates；若页面正确，改用候选元素提供的 selector 或 role/name，禁止原样重试。'
    }
  }

  if (expectedVisibleSelector) {
    const expected = selectorState(after, expectedVisibleSelector)
    if (!expected?.exists) {
      return {
        ...base,
        category: 'expected_state_absent',
        error_type: 'ui_expected_element_absent',
        failed_stage: 'assert_after_click',
        summary: `点击已执行，但预期元素 ${expectedVisibleSelector} 不存在于当前 DOM。`,
        next_action: '检查运行实例、路由和业务数据是否正确；若目标页面正确，再核对选择器或点击回调是否创建了预期节点。'
      }
    }
    if (expected.visible !== true) {
      return {
        ...base,
        category: 'state_transition_visibility_failed',
        error_type: 'ui_state_transition_failed',
        failed_stage: 'assert_after_click',
        blocking_evidence: {
          hiddenBy: expected.hiddenBy || null,
          clippingAncestor: expected.clippingAncestor || null,
          occludedBy: expected.occludedBy || null,
          ancestorChain: expected.ancestorChain || []
        },
        summary: `点击已执行，预期元素 ${expectedVisibleSelector} 存在但仍不可见。`,
        next_action: '沿 blocking_evidence 检查状态类挂载位置、隐藏祖先、裁切和遮挡；修复状态转换后再验证。'
      }
    }
  }
  if (expectedHiddenSelector && selectorVisible(after, expectedHiddenSelector) !== false) {
    return {
      ...base,
      category: 'state_transition_hidden_failed',
      error_type: 'ui_state_transition_failed',
      failed_stage: 'assert_after_click',
      summary: `点击已执行，但 ${expectedHiddenSelector} 仍然可见。`,
      next_action: '检查点击回调是否更新了正确节点的状态类或 hidden/aria 属性。'
    }
  }
  if (closeClick && !closeClick.found) {
    return {
      ...base,
      category: 'close_locator_failed',
      error_type: closeClick.reason === 'locator_not_interactable' ? 'ui_element_not_interactable' : 'ui_locator_not_found',
      failed_stage: 'close_interaction',
      close_click: closeClick,
      summary: '打开交互成功，但关闭控件定位失败。',
      next_action: '根据 close_click 的 candidates、hiddenBy 和 nearby_candidates 修正 close_locator。'
    }
  }
  if ((pageErrors || []).length || (consoleErrors || []).length) {
    return {
      ...base,
      category: 'runtime_error_during_interaction',
      error_type: 'ui_runtime_error',
      failed_stage: 'observe_runtime',
      summary: '交互期间检测到页面、未处理异常或控制台错误。',
      next_action: '先修复 pageErrors/consoleErrors 中的首个根因，再重新验证交互。'
    }
  }
  if (requireVisualChange && visualChanges?.changed !== true) {
    return {
      ...base,
      category: 'visual_state_unchanged',
      error_type: 'ui_visual_change_missing',
      failed_stage: 'compare_visual_evidence',
      summary: '点击执行后没有检测到要求的像素变化。',
      next_action: '确认交互是否应产生视觉变化；若应该，检查状态更新与渲染链路，否则取消 require_visual_change。'
    }
  }
  return {
    ...base,
    category: 'interaction_assertion_failed',
    error_type: 'ui_interaction_failed',
    failed_stage: 'assert_interaction',
    summary: '运行态交互未通过。',
    next_action: '根据 failures 与结构化诊断修复首个失败阶段，禁止原样循环调用。'
  }
}

async function captureInteractionEvidence(webContents, label = 'state') {
  try {
    const image = await webContents.capturePage()
    const buffer = image.toPNG()
    const size = image.getSize()
    const filePath = path.join(
      ensureScreenshotDir(),
      `screenshot-interaction-${normalizeTimestampForFile()}-${label}-${Math.random().toString(36).slice(2, 8)}.png`
    )
    fs.writeFileSync(filePath, buffer)
    const sample = await sharp(buffer)
      .resize({ width: 256, height: 144, fit: 'fill' })
      .removeAlpha()
      .raw()
      .toBuffer()
    return {
      label,
      path: filePath,
      width: size.width,
      height: size.height,
      sha256: crypto.createHash('sha256').update(buffer).digest('hex'),
      sample
    }
  } catch (error) {
    return {
      label,
      unavailable: true,
      error: error?.message || 'Current display surface not available for capture'
    }
  }
}

function compareInteractionEvidence(before, after) {
  if (!before?.sample || !after?.sample || before.sample.length !== after.sample.length) {
    return { changed: null, mean_delta: null, changed_pixel_ratio: null }
  }
  let totalDelta = 0
  let changedPixels = 0
  const channels = 3
  const pixelCount = before.sample.length / channels
  for (let index = 0; index < before.sample.length; index += channels) {
    const delta = (
      Math.abs(before.sample[index] - after.sample[index]) +
      Math.abs(before.sample[index + 1] - after.sample[index + 1]) +
      Math.abs(before.sample[index + 2] - after.sample[index + 2])
    ) / (channels * 255)
    totalDelta += delta
    if (delta >= 0.02) changedPixels += 1
  }
  const meanDelta = pixelCount ? totalDelta / pixelCount : 0
  const changedPixelRatio = pixelCount ? changedPixels / pixelCount : 0
  return {
    changed: meanDelta >= 0.002 || changedPixelRatio >= 0.005,
    mean_delta: Number(meanDelta.toFixed(6)),
    changed_pixel_ratio: Number(changedPixelRatio.toFixed(6))
  }
}

function publicInteractionEvidence(evidence) {
  if (!evidence) return undefined
  const { sample, ...rest } = evidence
  return rest
}

function getEvidenceLimitation(evidence) {
  if (!evidence?.unavailable) return ''
  return `Visual evidence is unavailable: ${evidence.error || 'display surface capture failed'}`
}

async function runInteractionOnWebContents(webContents, args = {}, options = {}) {
  if (!webContents || webContents.isDestroyed?.()) {
    return { success: false, error: 'runtime_verify failed: target webContents is missing or destroyed' }
  }
  const { total, step } = getUiInteractionTimeouts(args)
  const startedAt = Date.now()
  const signal = options.signal
  const stepRun = (label, promise, timeoutMs = step) => {
    throwIfAborted(signal)
    if (webContents.isDestroyed?.()) throw new Error(`runtime_verify failed: target webContents destroyed before ${label}`)
    return withTimeout(promise, timeoutMs, `runtime_verify ${label}`)
  }

  await stepRun('wait target ready', waitForScreenshotTarget(webContents, args, { alreadyLoaded: options.alreadyLoaded === true }), Math.min(total, Math.max(step, 12000)))
  const clickSelectorValue = String(args.click_selector || args.clickSelector || args.trigger_selector || args.triggerSelector || '').trim()
  const clickTarget = normalizeLocator(args.click_locator || args.clickLocator || {
    selector: clickSelectorValue,
    text: args.click_text || args.clickText,
    role: args.click_role || args.clickRole,
    name: args.click_name || args.clickName
  })
  const claim = String(args.claim || args.verification_claim || args.verificationClaim || '').trim()
  const assertions = normalizeRuntimeAssertions(args.assertions)
  const expectedVisibleSelector = String(args.expected_visible_selector || args.expectedVisibleSelector || args.target_selector || args.targetSelector || '').trim()
  const expectedHiddenSelector = String(args.expected_hidden_selector || args.expectedHiddenSelector || '').trim()
  const closeSelectorValue = String(args.close_selector || args.closeSelector || '').trim()
  const closeTarget = normalizeLocator(args.close_locator || args.closeLocator || { selector: closeSelectorValue })
  const expectedClosedSelector = String(args.expected_closed_selector || args.expectedClosedSelector || expectedVisibleSelector || '').trim()
  const repeatOpen = args.repeat_open === true || args.repeatOpen === true
  const inspectSelectors = uniqueSelectors([
    clickSelectorValue,
    expectedVisibleSelector,
    expectedHiddenSelector,
    closeSelectorValue,
    expectedClosedSelector,
    ...assertions.map(item => item.selector),
    ...normalizeSelectorList(args.inspect_selectors || args.inspectSelectors)
  ])
  if (!hasLocator(clickTarget)) {
    return {
      success: false,
      error_type: 'ui_missing_locator',
      error: 'ui interaction check failed: missing semantic click locator',
      next_action: '提供 interaction.click_locator；优先使用 role/name 或稳定 CSS selector。'
    }
  }
  const consoleMessages = []
  const pageErrors = []
  const onConsole = (event, level, message, line, sourceId) => consoleMessages.push({ level, message, line, sourceId })
  const onGone = (event, details) => pageErrors.push({ message: `render process gone: ${details?.reason || 'unknown'}` })
  const onUnresponsive = () => pageErrors.push({ message: 'page became unresponsive' })
  webContents.on('console-message', onConsole)
  webContents.on('render-process-gone', onGone)
  webContents.on('unresponsive', onUnresponsive)

  try {
    await stepRun('install error probe', installInteractionErrorProbe(webContents))
    const before = await stepRun('collect before state', collectInteractionState(webContents, inspectSelectors))
    const captureEvidence = args.capture_evidence !== false && args.captureEvidence !== false
    const beforeEvidence = captureEvidence
      ? await stepRun('capture before screenshot', captureInteractionEvidence(webContents, 'before'))
      : null
    const locatorWaitMs = Math.max(0, Math.min(Number(args.wait_for_locator_ms ?? args.waitForLocatorMs ?? 1500), Math.max(0, step - 250)))
    const inputMode = ['semantic', 'pointer'].includes(String(args.input_mode || args.inputMode || '').toLowerCase())
      ? String(args.input_mode || args.inputMode).toLowerCase()
      : 'semantic'
    const clickStableMs = Math.max(0, Math.min(Number(args.stable_for_ms ?? args.stableForMs ?? 120), 1000))
    const assertionWaitMs = Math.max(0, Math.min(Number(args.wait_for_assertions_ms ?? args.waitForAssertionsMs ?? 3000), 10000))
    const assertionPollMs = Math.max(50, Math.min(Number(args.poll_interval_ms ?? args.pollIntervalMs ?? 100), 1000))
    const assertionSettleMs = Math.max(0, Math.min(Number(args.assertion_settle_ms ?? args.assertionSettleMs ?? 120), 1000))
    const click = await stepRun(
      inputMode === 'pointer' ? 'native pointer click' : 'semantic click',
      clickLocator(webContents, clickTarget, {
        wait_ms: locatorWaitMs,
        input_mode: inputMode,
        stable_ms: clickStableMs
      })
    )
    const openOutcome = click?.found
      ? await stepRun('wait for asserted open state', waitForInteractionOutcome(webContents, inspectSelectors, {
          assertions,
          expectedVisibleSelector,
          expectedHiddenSelector,
          timeoutMs: assertionWaitMs,
          pollMs: assertionPollMs,
          settleMs: assertionSettleMs
        }), Math.min(total, Math.max(step, assertionWaitMs + assertionSettleMs + 500)))
      : {
          state: await stepRun('collect failed open state', collectInteractionState(webContents, inspectSelectors)),
          assertions: [],
          conditions_passed: false,
          timed_out: false,
          waited_ms: 0
        }
    const afterOpen = openOutcome.state
    const afterOpenEvidence = captureEvidence
      ? await stepRun('capture after open screenshot', captureInteractionEvidence(webContents, 'after-open'))
      : null
    const changes = summarizeSelectorChange(before, afterOpen)
    const visualChanges = compareInteractionEvidence(beforeEvidence, afterOpenEvidence)

    let closeClick = null
    let afterClose = null
    let repeatClick = null
    let afterRepeatOpen = null
    let afterCloseEvidence = null
    let afterRepeatOpenEvidence = null
    if (click?.found && hasLocator(closeTarget)) {
      closeClick = await stepRun('close click', clickLocator(webContents, closeTarget, {
        wait_ms: locatorWaitMs,
        input_mode: inputMode,
        stable_ms: clickStableMs
      }))
      const closeOutcome = closeClick?.found
        ? await stepRun('wait for closed state', waitForInteractionOutcome(webContents, inspectSelectors, {
            expectedHiddenSelector: expectedClosedSelector,
            timeoutMs: assertionWaitMs,
            pollMs: assertionPollMs,
            settleMs: assertionSettleMs
          }), Math.min(total, Math.max(step, assertionWaitMs + assertionSettleMs + 500)))
        : { state: await stepRun('collect failed close state', collectInteractionState(webContents, inspectSelectors)) }
      afterClose = closeOutcome.state
      afterCloseEvidence = captureEvidence
        ? await stepRun('capture after close screenshot', captureInteractionEvidence(webContents, 'after-close'))
        : null
      if (repeatOpen && closeClick?.found) {
        repeatClick = await stepRun('repeat open click', clickLocator(webContents, clickTarget, {
          wait_ms: locatorWaitMs,
          input_mode: inputMode,
          stable_ms: clickStableMs
        }))
        const repeatOutcome = repeatClick?.found
          ? await stepRun('wait for repeated asserted state', waitForInteractionOutcome(webContents, inspectSelectors, {
              assertions,
              expectedVisibleSelector,
              expectedHiddenSelector,
              timeoutMs: assertionWaitMs,
              pollMs: assertionPollMs,
              settleMs: assertionSettleMs
            }), Math.min(total, Math.max(step, assertionWaitMs + assertionSettleMs + 500)))
          : { state: await stepRun('collect failed repeat state', collectInteractionState(webContents, inspectSelectors)) }
        afterRepeatOpen = repeatOutcome.state
        afterRepeatOpenEvidence = captureEvidence
          ? await stepRun('capture repeat open screenshot', captureInteractionEvidence(webContents, 'after-repeat-open'))
          : null
      }
    }

    const observeMs = Math.max(0, Math.min(Number(args.observe_ms ?? args.observeMs ?? 1200), 8000))
    if (observeMs > 0) await new Promise(resolve => setTimeout(resolve, observeMs))
    const probedPageErrors = await stepRun('read error probe', readInteractionErrorProbe(webContents))
    const consoleErrors = consoleMessages.filter(isConsoleErrorMessage)
    const failOnConsoleError = args.fail_on_console_error !== false && args.failOnConsoleError !== false
    const failures = []
    if (!click?.found) {
      const clickFailure = {
        invalid_selector: 'click locator is invalid',
        locator_ambiguous: 'click locator is ambiguous',
        locator_not_interactable: 'click target exists but is not interactable',
        locator_filter_mismatch: 'click locator does not match elements on the current page',
        locator_absent: 'click target is absent from the current page'
      }[click?.reason] || 'click target could not be resolved'
      failures.push(clickFailure)
    }
    if (click?.found && expectedVisibleSelector && selectorVisible(afterOpen, expectedVisibleSelector) !== true) {
      failures.push('expected visible selector is not visible after click')
    }
    if (click?.found && expectedHiddenSelector && selectorVisible(afterOpen, expectedHiddenSelector) !== false) {
      failures.push('expected hidden selector is still visible after click')
    }
    const assertionResults = openOutcome.assertions || evaluateRuntimeAssertions(afterOpen, assertions)
    const failedAssertions = assertionResults.filter(item => !item.passed)
    if (click?.found && failedAssertions.length) {
      failures.push(...failedAssertions.map(item =>
        `assertion ${item.id} failed: ${item.selector} ${item.property} ${item.operator} ${JSON.stringify(item.expected)} (actual ${JSON.stringify(item.actual)})`
      ))
    }
    if (click?.found && hasLocator(closeTarget) && !closeClick?.found) failures.push('close locator not found')
    if (afterClose && expectedClosedSelector && selectorVisible(afterClose, expectedClosedSelector) !== false) {
      failures.push('expected selector is still visible after close')
    }
    if (repeatOpen && afterRepeatOpen && expectedVisibleSelector && selectorVisible(afterRepeatOpen, expectedVisibleSelector) !== true) {
      failures.push('expected visible selector is not visible after repeat open')
    }
    if (pageErrors.length) failures.push('runtime page error during interaction')
    if (probedPageErrors.length) failures.push('window error or unhandled rejection during interaction')
    if (failOnConsoleError && consoleErrors.length) failures.push('console error during interaction')
    const requireVisualChange = args.require_visual_change === true || args.requireVisualChange === true
    if (click?.found && requireVisualChange && visualChanges.changed !== true) failures.push('expected visual change was not detected after click')
    const allPageErrors = [...pageErrors, ...probedPageErrors]
    const coverage = {
      specific: !!claim && assertions.length > 0,
      claim_provided: !!claim,
      assertion_count: assertions.length,
      selectors: [...new Set(assertions.map(item => item.selector))],
      input_mode: inputMode
    }
    const verificationContractMissing = coverage.specific !== true
    const diagnosis = failures.length ? buildInteractionFailureDiagnosis({
      click,
      before,
      after: afterOpen,
      expectedVisibleSelector,
      expectedHiddenSelector,
      closeClick,
      pageErrors: allPageErrors,
      consoleErrors: failOnConsoleError ? consoleErrors : [],
      requireVisualChange,
      visualChanges
    }) : null
    const failureMessage = failures.length
      ? `ui interaction check failed: ${diagnosis?.summary || failures.join(', ')}`
      : ''

    return {
      success: failures.length === 0,
      incomplete: failures.length === 0 && verificationContractMissing,
      error_type: diagnosis?.error_type || (verificationContractMissing ? 'verification_assertions_missing' : undefined),
      error: failureMessage || (verificationContractMissing
        ? 'runtime verification is incomplete: claim and at least one concrete assertion are required'
        : undefined),
      recoverable: failures.length ? true : undefined,
      next_action: diagnosis?.next_action || (verificationContractMissing
        ? 'Add claim and assertions for the exact element and state reported by the user.'
        : undefined),
      retry_policy: failures.length ? 'do_not_repeat_same_call_without_changing_target_precondition_or_locator' : undefined,
      diagnosis: diagnosis || undefined,
      target: webContents.getURL?.() || '',
      click,
      closeClick: closeClick || undefined,
      repeatClick: repeatClick || undefined,
      expected_visible_selector: expectedVisibleSelector || undefined,
      expected_hidden_selector: expectedHiddenSelector || undefined,
      expected_closed_selector: expectedClosedSelector || undefined,
      claim: claim || undefined,
      assertions,
      assertion_results: assertionResults,
      assertion_wait: {
        waited_ms: openOutcome.waited_ms || 0,
        timed_out: openOutcome.timed_out === true,
        conditions_passed: openOutcome.conditions_passed === true
      },
      coverage,
      failures,
      before,
      after: afterOpen,
      afterOpen,
      afterClose: afterClose || undefined,
      afterRepeatOpen: afterRepeatOpen || undefined,
      changes,
      visualChanges,
      evidence: captureEvidence ? {
        before: publicInteractionEvidence(beforeEvidence),
        afterOpen: publicInteractionEvidence(afterOpenEvidence),
        afterClose: publicInteractionEvidence(afterCloseEvidence),
        afterRepeatOpen: publicInteractionEvidence(afterRepeatOpenEvidence)
      } : undefined,
      closeChanges: afterClose ? summarizeSelectorChange(afterOpen, afterClose) : undefined,
      repeatOpenChanges: afterRepeatOpen && afterClose ? summarizeSelectorChange(afterClose, afterRepeatOpen) : undefined,
      consoleErrors,
      consoleMessages: consoleMessages.slice(-20),
      pageErrors: allPageErrors,
      observation_ms: observeMs,
      duration_ms: Date.now() - startedAt,
      timeout_ms: total,
      lifecycle_checked: {
        open: click?.found === true,
        close: !!afterClose,
        repeat_open: !!afterRepeatOpen
      },
      message: failureMessage || (verificationContractMissing
        ? 'ui interaction ran, but verification is incomplete because no specific claim/assertions were supplied'
        : 'ui interaction check passed')
    }
  } finally {
    webContents.removeListener('console-message', onConsole)
    webContents.removeListener('render-process-gone', onGone)
    webContents.removeListener('unresponsive', onUnresponsive)
  }
}

function getLingxiSourceRoot(resolvePath = input => input) {
  let root = ''
  try { root = path.resolve(resolvePath('.')) } catch { return '' }
  if (!fs.existsSync(path.join(root, 'electron/main.js')) || !fs.existsSync(path.join(root, 'frontend/index.html'))) return ''
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
    return String(pkg.main || '').replace(/\\/g, '/') === 'electron/main.js' ? root : ''
  } catch {
    return ''
  }
}

async function collectRuntimePageState(webContents, args = {}) {
  const expectedText = String(args.expect_text || args.expectText || '')
  return webContents.executeJavaScript(`
    (() => {
      const expectedText = ${JSON.stringify(expectedText)};
      const text = String(document.body?.innerText || '').replace(/\s+/g, ' ').trim();
      const visibleElements = Array.from(document.body?.querySelectorAll('*') || []).filter(el => {
        const rect = el.getBoundingClientRect();
        const style = getComputedStyle(el);
        return rect.width > 1 && rect.height > 1 && style.display !== 'none' &&
          style.visibility !== 'hidden' && Number(style.opacity || 1) > 0 && !el.hidden;
      }).length;
      return {
        title: document.title || '',
        url: location.href,
        readyState: document.readyState,
        bodyTextLength: text.length,
        bodyTextSample: text.slice(0, 240),
        expectedTextFound: expectedText ? text.includes(expectedText) : null,
        visibleElements,
        canvasCount: document.querySelectorAll('canvas').length
      };
    })()
  `)
}

function runtimeErrorSummary(webContentsId, args = {}, projectId = '') {
  return runtimeDiagnostics.summarize({
    webContentsId,
    projectId,
    since_ms: args.runtime_since_ms || args.runtimeSinceMs || 10 * 60 * 1000,
    limit: args.runtime_limit || args.runtimeLimit || 80,
    include_info: false
  })
}

async function inspectDomRuntime(webContents, target, args = {}, projectId = '') {
  const capabilities = target?.capabilities || {}
  if (capabilities.dom !== true) {
    return {
      success: false,
      incomplete: true,
      error: `runtime adapter ${target?.adapter || 'unknown'} does not support DOM inspection`,
      runtime_target: target,
      required_capabilities: ['dom'],
      available_capabilities: capabilities
    }
  }
  await waitForScreenshotTarget(webContents, args, { alreadyLoaded: true })
  await installInteractionErrorProbe(webContents)
  const claim = String(args.claim || args.verification_claim || args.verificationClaim || '').trim()
  const assertions = normalizeRuntimeAssertions(args.assertions)
  const observeMs = Math.max(0, Math.min(Number(args.observe_ms || args.observeMs || 500), 5000))
  if (!assertions.length && observeMs) await new Promise(resolve => setTimeout(resolve, observeMs))
  const inspectSelectors = uniqueSelectors([
    ...normalizeSelectorList(args.inspect_selectors || args.inspectSelectors),
    ...assertions.map(item => item.selector)
  ])
  const assertionWaitMs = Math.max(0, Math.min(Number(args.wait_for_assertions_ms ?? args.waitForAssertionsMs ?? 3000), 10000))
  const assertionOutcome = assertions.length
    ? await waitForInteractionOutcome(webContents, inspectSelectors, {
        assertions,
        timeoutMs: assertionWaitMs,
        pollMs: args.poll_interval_ms || args.pollIntervalMs || 100,
        settleMs: args.assertion_settle_ms || args.assertionSettleMs || 120
      })
    : {
        state: inspectSelectors.length ? await collectInteractionState(webContents, inspectSelectors) : null,
        assertions: [],
        conditions_passed: false,
        timed_out: false,
        waited_ms: observeMs
      }
  const domState = assertionOutcome.state
  const [pageState, probeErrors, evidence] = await Promise.all([
    collectRuntimePageState(webContents, args),
    readInteractionErrorProbe(webContents),
    (args.capture_evidence !== false && args.captureEvidence !== false)
      ? captureInteractionEvidence(webContents, 'live')
      : Promise.resolve(null)
  ])
  const diagnostics = typeof webContents.getRuntimeDiagnostics === 'function'
    ? await webContents.getRuntimeDiagnostics({ ...args, projectId }).catch(() => ({ success: false, error_count: 0, events: [] }))
    : runtimeErrorSummary(webContents.id, args, projectId)
  const failures = []
  if (args.fail_on_console_error !== false && args.failOnConsoleError !== false && Number(diagnostics.error_count || 0) > 0) {
    failures.push('historical or current F12/runtime errors detected')
  }
  if (probeErrors.length) failures.push('window error or unhandled rejection detected')
  if (pageState.visibleElements === 0 && pageState.bodyTextLength === 0 && pageState.canvasCount === 0) failures.push('blank page')
  if (pageState.expectedTextFound === false) failures.push('expected text missing')
  const assertionResults = assertionOutcome.assertions || evaluateRuntimeAssertions(domState, assertions)
  const failedAssertions = assertionResults.filter(item => !item.passed)
  failures.push(...failedAssertions.map(item =>
    `assertion ${item.id} failed: ${item.selector} ${item.property} ${item.operator} ${JSON.stringify(item.expected)} (actual ${JSON.stringify(item.actual)})`
  ))
  const coverage = {
    specific: !!claim && assertions.length > 0,
    claim_provided: !!claim,
    assertion_count: assertions.length,
    selectors: [...new Set(assertions.map(item => item.selector))],
    input_mode: 'inspection'
  }
  const verificationContractMissing = coverage.specific !== true
  const evidenceLimitation = getEvidenceLimitation(evidence)
  return {
    success: failures.length === 0,
    incomplete: !!evidenceLimitation || (failures.length === 0 && verificationContractMissing),
    error_type: failures.length === 0 && verificationContractMissing ? 'verification_assertions_missing' : undefined,
    error: failures.length === 0 && verificationContractMissing
      ? 'runtime verification is incomplete: claim and at least one concrete assertion are required'
      : undefined,
    mode: 'live',
    runtime_target: target,
    claim: claim || undefined,
    assertions,
    assertion_results: assertionResults,
    assertion_wait: {
      waited_ms: assertionOutcome.waited_ms || 0,
      timed_out: assertionOutcome.timed_out === true,
      conditions_passed: assertionOutcome.conditions_passed === true
    },
    coverage,
    pageState,
    domState,
    failures,
    runtimeDiagnostics: diagnostics,
    pageErrors: probeErrors,
    evidence: publicInteractionEvidence(evidence),
    limitations: [evidenceLimitation, verificationContractMissing
      ? 'Specific claim/assertions are missing; generic page health is not proof that the reported issue is fixed.'
      : ''].filter(Boolean),
    message: failures.length ? `live runtime verification failed: ${failures.join(', ')}` : (verificationContractMissing ? 'live runtime inspection completed without specific verification coverage' : 'live runtime verification passed')
  }
}

function accessibilityNodeMatches(node = {}, locator = {}) {
  const name = String(locator.name || locator.text || '').toLowerCase()
  const role = String(locator.role || '').toLowerCase()
  const automationId = String(locator.automation_id || locator.automationId || locator.selector || '').toLowerCase()
  if (name && !String(node.name || '').toLowerCase().includes(name)) return false
  if (role && String(node.role || '').toLowerCase() !== role) return false
  if (automationId && String(node.automation_id || '').toLowerCase() !== automationId) return false
  return !!(name || role || automationId)
}

async function inspectAccessibilityRuntime(controller, target, args = {}) {
  const tree = await controller.inspectAccessibility({
    maxNodes: args.max_accessibility_nodes || args.maxAccessibilityNodes || 400,
    maxDepth: args.max_accessibility_depth || args.maxAccessibilityDepth || 8
  })
  const evidence = args.capture_evidence === false || args.captureEvidence === false
    ? null
    : await captureInteractionEvidence(controller, 'native-live')
  const diagnostics = typeof controller.getRuntimeDiagnostics === 'function'
    ? await controller.getRuntimeDiagnostics(args)
    : { success: true, error_count: 0, warning_count: 0, events: [] }
  return {
    success: tree.success === true,
    mode: 'live',
    runtime_target: target,
    accessibility_tree: tree.nodes || [],
    runtimeDiagnostics: diagnostics,
    evidence: publicInteractionEvidence(evidence),
    limitations: diagnostics.limitations || [],
    failures: tree.success === true ? [] : [tree.error || 'accessibility inspection failed']
  }
}

async function runAccessibilityInteraction(controller, target, args = {}) {
  const clickTarget = normalizeLocator(args.click_locator || args.clickLocator || {
    selector: args.click_selector || args.clickSelector,
    text: args.click_text || args.clickText,
    role: args.click_role || args.clickRole,
    name: args.click_name || args.clickName
  })
  const expectedTarget = normalizeLocator(args.expected_locator || args.expectedLocator || {
    selector: args.expected_automation_id || args.expectedAutomationId,
    role: args.expected_role || args.expectedRole,
    name: args.expected_name || args.expectedName
  })
  const beforeTree = await controller.inspectAccessibility({ maxNodes: 500, maxDepth: 10 })
  const captureEvidence = args.capture_evidence !== false && args.captureEvidence !== false
  const beforeEvidence = captureEvidence ? await captureInteractionEvidence(controller, 'native-before') : null
  const click = await controller.performSemanticAction(clickTarget, {
    operation: args.native_operation || args.nativeOperation || args.operation || 'invoke',
    value: args.value,
    waitAfterMs: args.wait_after_click_ms || args.waitAfterClickMs || 300
  })
  const afterTree = await controller.inspectAccessibility({ maxNodes: 500, maxDepth: 10 })
  const afterEvidence = captureEvidence ? await captureInteractionEvidence(controller, 'native-after') : null
  const visualChanges = compareInteractionEvidence(beforeEvidence, afterEvidence)
  const failures = []
  if (!click?.found || click.success === false) failures.push(click?.error || 'accessibility target not found')
  if (hasLocator(expectedTarget) && !(afterTree.nodes || []).some(node => accessibilityNodeMatches(node, expectedTarget))) {
    failures.push('expected accessibility element is not available after action')
  }
  if ((args.require_visual_change === true || args.requireVisualChange === true) && visualChanges.changed !== true) {
    failures.push('expected visual change was not detected after accessibility action')
  }
  const diagnostics = typeof controller.getRuntimeDiagnostics === 'function'
    ? await controller.getRuntimeDiagnostics(args)
    : { success: true, error_count: 0, warning_count: 0, events: [] }
  const consoleRequired = args.fail_on_console_error !== false && args.failOnConsoleError !== false
  return {
    success: failures.length === 0,
    incomplete: consoleRequired && target.capabilities?.console !== true,
    mode: 'interaction',
    runtime_target: target,
    click,
    accessibility_before: beforeTree.nodes || [],
    accessibility_after: afterTree.nodes || [],
    failures,
    visualChanges,
    runtimeDiagnostics: diagnostics,
    limitations: consoleRequired && target.capabilities?.console !== true
      ? ['The UI Automation adapter cannot read application-internal logs; set fail_on_console_error=false only when native logs are verified separately.']
      : [],
    evidence: captureEvidence ? {
      before: publicInteractionEvidence(beforeEvidence),
      afterOpen: publicInteractionEvidence(afterEvidence)
    } : undefined
  }
}

function normalizeUnifiedInteraction(args = {}) {
  const interaction = args.interaction && typeof args.interaction === 'object' ? args.interaction : {}
  return { ...args, ...interaction }
}

function collectEvidencePaths(result = {}) {
  const paths = []
  const visit = value => {
    if (!value || typeof value !== 'object') return
    if (typeof value.path === 'string' && value.path) paths.push(value.path)
    for (const child of Object.values(value)) {
      if (child && typeof child === 'object') visit(child)
    }
  }
  visit(result.evidence)
  return [...new Set(paths)]
}

function buildUnifiedVerificationReport(result = {}, options = {}) {
  const target = result.runtime_target || options.target || null
  const level = options.level || result.level || result.mode || 'quick'
  const declared = target?.capabilities || (level === 'desktop'
    ? { screenshot: true }
    : { dom: true, semantic_action: true, screenshot: true, console: true, network: true })
  const required = new Set()
  if (level === 'interaction') {
    required.add(target?.adapter === 'windows-uia' ? 'accessibility' : 'dom')
    required.add('semantic_action')
  }
  if (level === 'live') required.add(target?.adapter === 'windows-uia' ? 'accessibility' : 'dom')
  if (options.captureEvidence !== false) required.add('screenshot')
  if (options.failOnConsoleError !== false && ['interaction', 'live'].includes(level)) required.add('console')
  const missing = [...required].filter(capability => declared[capability] !== true)
  const diagnostics = result.runtimeDiagnostics || {}
  const diagnosticEvents = Array.isArray(diagnostics.events) ? diagnostics.events : []
  const issues = [
    ...(Array.isArray(result.failures) ? result.failures : []),
    ...(result.error ? [result.error] : []),
    ...diagnosticEvents.filter(item => item.severity === 'error').map(item => item.message)
  ].filter(Boolean)
  const incomplete = options.incomplete === true || result.incomplete === true || missing.length > 0
  const status = options.status || (incomplete ? 'incomplete' : result.success ? 'passed' : 'failed')
  return {
    protocol: 'lingxi-runtime-verification/v1',
    status,
    complete: !incomplete,
    level,
    claim: result.claim || '',
    coverage: result.coverage || { specific: false, claim_provided: false, assertion_count: 0 },
    target: target ? {
      runtime_id: target.runtime_id || '',
      adapter: target.adapter || 'unknown',
      build_type: target.build_type || '',
      workspace_path: target.workspace_path || target.project_path || '',
      process_id: target.process_id || null,
      url: target.url || '',
      title: target.title || ''
    } : {
      runtime_id: '',
      adapter: level === 'desktop' ? 'screenshot-only' : 'browser',
      build_type: 'development',
      workspace_path: options.workspacePath || '',
      process_id: null,
      url: result.url || result.target || '',
      title: result.title || ''
    },
    capabilities: {
      declared,
      required: [...required],
      missing
    },
    checks: {
      dom: !!(result.domState || result.before || result.pageState),
      accessibility: !!(result.accessibility_tree || result.accessibility_before || result.accessibility_after),
      semantic_action: result.click?.found === true,
      assertion_contract: result.coverage?.specific === true && (result.assertion_results || []).every(item => item.passed !== false),
      visual_change: result.visualChanges?.changed ?? result.visual_comparison?.changed ?? null,
      screenshot: collectEvidencePaths(result).length > 0,
      console: declared.console === true && (diagnostics.error_count !== undefined || Array.isArray(result.consoleErrors)),
      network: diagnosticEvents.some(item => /network|websocket/i.test(item.type || '')),
      route: target?.url || result.pageState?.url || result.target || ''
    },
    diagnostics: {
      error_count: Number(diagnostics.error_count || 0),
      warning_count: Number(diagnostics.warning_count || 0),
      network_error_count: diagnosticEvents.filter(item => item.severity === 'error' && /network|websocket/i.test(item.type || '')).length,
      websocket_error_count: diagnosticEvents.filter(item => item.severity === 'error' && /websocket/i.test(item.type || '')).length
    },
    evidence_paths: collectEvidencePaths(result),
    issues: [...new Set(issues)],
    claim_policy: incomplete
      ? 'Verification is incomplete because evidence or adapter capabilities are missing. Do not report the target as error-free.'
      : result.success
        ? 'All checks supported by the selected adapter passed.'
        : 'Runtime evidence contains failures. Do not report the issue as fixed.'
  }
}

async function runtimeVerify(args = {}, ctx = {}) {
  const projectId = ctx.projectId || args.project_id || args.projectId || ''
  const resolvePath = ctx.resolvePath || (input => input)
  const workspacePath = getLingxiSourceRoot(resolvePath) || path.resolve(resolvePath('.'))
  const unsupportedArguments = [
    ['action', args.action],
    ['level', args.level],
    ['mode', args.mode],
    ['url', args.url],
    ['html_path', args.html_path || args.htmlPath],
    ['webContentsId', args.webContentsId || args.web_contents_id],
    ['source_id', args.source_id || args.sourceId],
    ['target', args.target],
    ['include_desktop', args.include_desktop || args.includeDesktop],
    ['baseline_id', args.baseline_id || args.baselineId]
  ].filter(([, value]) => value !== undefined && value !== null && value !== '')
  if (unsupportedArguments.length) {
    return {
      success: false,
      incomplete: true,
      tool: 'runtime_verify',
      error_type: 'unsupported_runtime_verify_arguments',
      error: `runtime_verify no longer accepts legacy routing arguments: ${unsupportedArguments.map(([name]) => name).join(', ')}`,
      unsupported_arguments: unsupportedArguments.map(([name]) => name),
      verification_status: 'incomplete',
      next_action: 'Remove legacy routing arguments. Use an already registered development runtime; pass runtime_id only when candidates are ambiguous.',
      claim_policy: 'Verification did not run. Do not report the runtime as error-free.'
    }
  }
  const mergedArgs = normalizeUnifiedInteraction(args)
  mergedArgs.workspacePath = workspacePath
  const hasInteraction = hasLocator(normalizeLocator(mergedArgs.click_locator || mergedArgs.clickLocator || {
    selector: mergedArgs.click_selector || mergedArgs.clickSelector,
    text: mergedArgs.click_text || mergedArgs.clickText,
    role: mergedArgs.click_role || mergedArgs.clickRole,
    name: mergedArgs.click_name || mergedArgs.clickName
  }))
  const requestedInteraction = !!(args.interaction && typeof args.interaction === 'object' && Object.keys(args.interaction).length)
  if (requestedInteraction && !hasInteraction) {
    return {
      success: false,
      incomplete: true,
      tool: 'runtime_verify',
      error_type: 'invalid_semantic_interaction',
      error: 'interaction requires click_locator with selector, automation_id, text, role or name',
      verification_status: 'incomplete',
      next_action: 'Provide one semantic click_locator or move inspect_selectors to the top-level inspection request.',
      claim_policy: 'Verification did not run. Do not report the runtime as error-free.'
    }
  }

  const resolution = resolveTargetWebContents({ ...mergedArgs, projectId, workspacePath })
  if (!resolution.success || !resolution.webContents) {
    return {
      success: false,
      incomplete: true,
      tool: 'runtime_verify',
      error_type: resolution.ambiguous ? 'runtime_target_ambiguous' : 'runtime_target_unavailable',
      error: resolution.error || 'development runtime target not found',
      ambiguous: !!resolution.ambiguous,
      candidates: resolution.candidates || [],
      observation_only_targets: resolution.observation_only_targets || [],
      verification_status: 'incomplete',
      next_action: resolution.ambiguous ? 'Choose one candidate runtime_id and retry.' : (resolution.next_action || 'Start and bind the development runtime for this workspace, then retry.'),
      claim_policy: 'Verification did not run. Do not report the runtime as error-free.'
    }
  }

  const controller = resolution.webContents
  const target = resolution.target
  const capabilities = target?.capabilities || {}
  const level = hasInteraction ? 'interaction' : 'live'
  let result
  if (hasInteraction && typeof controller.performSemanticAction === 'function' && typeof controller.inspectAccessibility === 'function') {
    result = await runAccessibilityInteraction(controller, target, mergedArgs)
  } else if (hasInteraction && capabilities.dom === true && capabilities.semantic_action === true && typeof controller.executeJavaScript === 'function') {
    const { total } = getUiInteractionTimeouts(mergedArgs)
    result = await withTimeout(
      runInteractionOnWebContents(controller, mergedArgs, { signal: ctx.signal, alreadyLoaded: true }),
      total + 1000,
      'runtime_verify semantic interaction'
    )
    result.runtime_target = target
    result.runtimeDiagnostics = typeof controller.getRuntimeDiagnostics === 'function'
      ? await controller.getRuntimeDiagnostics({ ...mergedArgs, projectId }).catch(() => null)
      : runtimeErrorSummary(target.web_contents_id, mergedArgs, projectId)
  } else if (!hasInteraction && typeof controller.inspectAccessibility === 'function') {
    result = await inspectAccessibilityRuntime(controller, target, mergedArgs)
  } else if (!hasInteraction && capabilities.dom === true && typeof controller.executeJavaScript === 'function') {
    result = await inspectDomRuntime(controller, target, mergedArgs, projectId)
  } else {
    const requiredCapabilities = hasInteraction
      ? [capabilities.accessibility === true ? 'accessibility' : 'dom', 'semantic_action']
      : [capabilities.accessibility === true ? 'accessibility' : 'dom']
    result = {
      success: false,
      incomplete: true,
      error_type: 'unsupported_runtime_capability',
      error: `runtime adapter ${target?.adapter || 'unknown'} cannot perform semantic ${hasInteraction ? 'interaction' : 'inspection'}`,
      runtime_target: target,
      required_capabilities: requiredCapabilities,
      available_capabilities: capabilities,
      failures: []
    }
  }

  const verificationClaim = String(mergedArgs.claim || mergedArgs.verification_claim || mergedArgs.verificationClaim || '').trim()
  const verificationAssertions = normalizeRuntimeAssertions(mergedArgs.assertions)
  const expectedAccessibilityTarget = normalizeLocator(mergedArgs.expected_locator || mergedArgs.expectedLocator || {
    selector: mergedArgs.expected_automation_id || mergedArgs.expectedAutomationId,
    role: mergedArgs.expected_role || mergedArgs.expectedRole,
    name: mergedArgs.expected_name || mergedArgs.expectedName
  })
  if (!result.coverage) {
    const nativeSpecific = target?.adapter === 'windows-uia' &&
      !!verificationClaim &&
      hasLocator(expectedAccessibilityTarget)
    result.coverage = {
      specific: nativeSpecific,
      claim_provided: !!verificationClaim,
      assertion_count: verificationAssertions.length,
      selectors: verificationAssertions.map(item => item.selector),
      expected_accessibility_target: hasLocator(expectedAccessibilityTarget)
    }
    result.claim = verificationClaim || result.claim
  }
  if (result.success === true && result.coverage.specific !== true) {
    result.incomplete = true
    result.error_type = result.error_type || 'verification_assertions_missing'
    result.error = result.error || 'runtime verification lacks a specific claim and result contract'
    result.next_action = result.next_action || 'Verify the exact reported element/state with claim plus DOM assertions, or claim plus expected Accessibility target.'
    result.limitations = [...new Set([...(result.limitations || []), 'Generic runtime health does not prove the reported UI issue is fixed.'])]
  }
  const failOnConsoleError = mergedArgs.fail_on_console_error !== false && mergedArgs.failOnConsoleError !== false
  if (failOnConsoleError && Number(result.runtimeDiagnostics?.error_count || 0) > 0) {
    result.failures = [...new Set([...(result.failures || []), 'historical or current F12/runtime errors detected'])]
    result.success = false
  }
  const incomplete = !!result.incomplete
  const verificationStatus = incomplete ? 'incomplete' : result.success ? 'passed' : 'failed'
  const verificationReport = buildUnifiedVerificationReport(result, {
    level,
    status: verificationStatus,
    incomplete,
    captureEvidence: mergedArgs.capture_evidence !== false,
    failOnConsoleError,
    workspacePath
  })
  return {
    ...result,
    tool: 'runtime_verify',
    level,
    verification_status: verificationStatus,
    verification_report: verificationReport,
    claim_policy: incomplete
      ? 'Evidence is incomplete. Report this as not fully verified, not as passed.'
      : result.success
        ? 'The selected runtime adapter completed all required checks.'
        : 'Runtime evidence contains failures. Do not report the issue as fixed.'
  }
}

async function researchWebsiteRuntime(args = {}, resolvePath = input => input, options = {}) {
  const targetUrl = normalizeScreenshotUrl(args, resolvePath)
  if (!targetUrl) {
    return {
      success: false,
      error: 'website research failed: missing target. Provide url or html_path.'
    }
  }
  const mode = String(args.mode || args.action || args.type || '').trim().toLowerCase()
  if (mode === 'crawl' || args.crawl === true || args.site_crawl === true || args.siteCrawl === true) {
    return crawlWebsiteRuntime(args, resolvePath)
  }

  const width = Math.max(320, Math.min(Number(args.viewport_width || args.viewportWidth || 1440), 7680))
  const height = Math.max(240, Math.min(Number(args.viewport_height || args.viewportHeight || 900), 4320))
  const scrollSamples = Math.max(1, Math.min(Number(args.scroll_samples || args.scrollSamples || 5), 12))
  const includeSource = args.include_source !== false && args.includeSource !== false
  const includeAssets = args.include_assets !== false && args.includeAssets !== false
  const includeScreenshots = args.include_screenshots === true || args.includeScreenshots === true
  const delayMs = Math.max(0, Math.min(Number(args.delay_ms || args.delayMs || 600), 5000))
  const partition = `website-research-${Date.now()}-${Math.random().toString(36).slice(2)}`
  const resources = []
  const consoleMessages = []
  const pageErrors = []
  const onRequestCompleted = details => {
    if (resources.length >= 400) return
    resources.push({
      url: details.url,
      method: details.method,
      statusCode: details.statusCode,
      resourceType: details.resourceType,
      fromCache: details.fromCache
    })
  }

  const win = new BrowserWindow({
    show: false,
    width,
    height,
    webPreferences: {
      offscreen: true,
      partition,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: false
    }
  })

  try {
    win.webContents.on('did-finish-load', () => {
      resources.push({ type: 'document', url: win.webContents.getURL() })
    })
    win.webContents.session.webRequest.onCompleted({ urls: ['*://*/*', 'file://*/*'] }, onRequestCompleted)
    win.webContents.on('console-message', (event, level, message, line, sourceId) => {
      consoleMessages.push({ level, message, line, sourceId })
    })
    win.webContents.on('render-process-gone', (event, details) => {
      pageErrors.push({ message: `render process gone: ${details?.reason || 'unknown'}` })
    })

    await win.loadURL(targetUrl)
    await waitForScreenshotTarget(win.webContents, { wait_until: args.wait_until || args.waitUntil || 'load', delay_ms: delayMs }, { alreadyLoaded: true })

    const analysis = await win.webContents.executeJavaScript(`
      (async () => {
        const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
        const clampText = (text, max = 240) => String(text || '').replace(/\\s+/g, ' ').trim().slice(0, max);
        const viewport = { width: window.innerWidth, height: window.innerHeight };
        const doc = document.documentElement;
        const body = document.body;
        const scrollHeight = Math.max(doc.scrollHeight, body ? body.scrollHeight : 0, viewport.height);
        const maxScroll = Math.max(0, scrollHeight - viewport.height);
        const sampleCount = ${scrollSamples};
        const delay = ${delayMs};
        const scrollPositions = sampleCount <= 1
          ? [0]
          : Array.from({ length: sampleCount }, (_, index) => Math.round(maxScroll * index / (sampleCount - 1)));
        const elementSignature = el => {
          const rect = el.getBoundingClientRect();
          const style = getComputedStyle(el);
          return {
            tag: el.tagName.toLowerCase(),
            id: el.id || '',
            className: typeof el.className === 'string' ? el.className.slice(0, 160) : '',
            text: clampText(el.innerText || el.getAttribute('aria-label') || el.getAttribute('alt') || '', 180),
            rect: {
              x: Math.round(rect.x),
              y: Math.round(rect.y),
              width: Math.round(rect.width),
              height: Math.round(rect.height)
            },
            display: style.display,
            position: style.position,
            color: style.color,
            backgroundColor: style.backgroundColor,
            fontFamily: style.fontFamily,
            fontSize: style.fontSize,
            fontWeight: style.fontWeight,
            borderRadius: style.borderRadius,
            transform: style.transform,
            opacity: style.opacity,
            zIndex: style.zIndex
          };
        };
        const isVisible = el => {
          const rect = el.getBoundingClientRect();
          const style = getComputedStyle(el);
          return rect.width > 2 && rect.height > 2 &&
            rect.bottom >= 0 && rect.top <= viewport.height &&
            style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity || 1) > 0.01;
        };
        const readRuntime = () => {
          const visible = Array.from(document.querySelectorAll('body *')).filter(isVisible);
          const important = visible
            .filter(el => /^(header|nav|main|section|article|aside|footer|canvas|video|img|svg|button|a|h1|h2|h3)$/i.test(el.tagName) || el.matches('[role], [data-scroll], [data-speed], [data-scene], [class*="hero"], [class*="scene"], [class*="canvas"], [class*="webgl"], [class*="particle"]'))
            .slice(0, 80)
            .map(elementSignature);
          return {
            scrollY: Math.round(window.scrollY),
            scrollProgress: maxScroll ? Math.round((window.scrollY / maxScroll) * 100) : 0,
            visibleCount: visible.length,
            important
          };
        };
        const snapshots = [];
        for (const y of scrollPositions) {
          window.scrollTo(0, y);
          await sleep(delay);
          snapshots.push(readRuntime());
        }
        window.scrollTo(0, 0);

        const colorCounts = new Map();
        const fontCounts = new Map();
        const radiusCounts = new Map();
        const shadowCounts = new Map();
        const spacingCounts = new Map();
        const allVisible = Array.from(document.querySelectorAll('body *')).filter(el => {
          const rect = el.getBoundingClientRect();
          const style = getComputedStyle(el);
          return rect.width > 2 && rect.height > 2 && style.display !== 'none' && style.visibility !== 'hidden';
        }).slice(0, 900);
        for (const el of allVisible) {
          const style = getComputedStyle(el);
          [style.color, style.backgroundColor, style.borderColor].forEach(value => {
            if (value && value !== 'rgba(0, 0, 0, 0)' && value !== 'transparent') colorCounts.set(value, (colorCounts.get(value) || 0) + 1);
          });
          if (style.fontFamily) fontCounts.set(style.fontFamily, (fontCounts.get(style.fontFamily) || 0) + 1);
          if (style.borderRadius && style.borderRadius !== '0px') radiusCounts.set(style.borderRadius, (radiusCounts.get(style.borderRadius) || 0) + 1);
          if (style.boxShadow && style.boxShadow !== 'none') shadowCounts.set(style.boxShadow, (shadowCounts.get(style.boxShadow) || 0) + 1);
          [style.marginTop, style.marginBottom, style.paddingTop, style.paddingBottom, style.gap, style.columnGap, style.rowGap].forEach(value => {
            if (value && value !== '0px' && !value.includes('normal')) spacingCounts.set(value, (spacingCounts.get(value) || 0) + 1);
          });
        }
        const topEntries = map => Array.from(map.entries()).sort((a, b) => b[1] - a[1]).slice(0, 24).map(([value, count]) => ({ value, count }));
        const modeValue = values => {
          const map = new Map();
          values.filter(Boolean).forEach(value => map.set(value, (map.get(value) || 0) + 1));
          const first = Array.from(map.entries()).sort((a, b) => b[1] - a[1])[0];
          return first ? first[0] : '';
        };
        const toRgb = value => {
          const text = String(value || '').trim();
          if (!text || text === 'transparent' || text === 'rgba(0, 0, 0, 0)') return null;
          const hex = text.match(/^#([0-9a-f]{3,8})$/i);
          if (hex) {
            let raw = hex[1];
            if (raw.length === 3) raw = raw.split('').map(ch => ch + ch).join('');
            return { r: parseInt(raw.slice(0, 2), 16), g: parseInt(raw.slice(2, 4), 16), b: parseInt(raw.slice(4, 6), 16), a: 1 };
          }
          const rgb = text.match(/rgba?\\(([^)]+)\\)/i);
          if (!rgb) return null;
          const parts = rgb[1].split(',').map(item => Number(String(item).trim().replace('%', '')));
          return { r: parts[0] || 0, g: parts[1] || 0, b: parts[2] || 0, a: parts.length > 3 ? parts[3] : 1 };
        };
        const toHex = color => {
          if (!color) return '';
          const part = value => Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, '0');
          return '#' + part(color.r) + part(color.g) + part(color.b);
        };
        const colorStats = value => {
          const rgb = toRgb(value);
          if (!rgb || rgb.a === 0) return null;
          const max = Math.max(rgb.r, rgb.g, rgb.b) / 255;
          const min = Math.min(rgb.r, rgb.g, rgb.b) / 255;
          const lightness = (max + min) / 2;
          const saturation = max === min ? 0 : lightness > 0.5 ? (max - min) / (2 - max - min) : (max - min) / (max + min);
          let hue = 0;
          if (max !== min) {
            const r = rgb.r / 255;
            const g = rgb.g / 255;
            const b = rgb.b / 255;
            switch (max) {
              case r: hue = (g - b) / (max - min) + (g < b ? 6 : 0); break;
              case g: hue = (b - r) / (max - min) + 2; break;
              default: hue = (r - g) / (max - min) + 4; break;
            }
            hue *= 60;
          }
          return { value, hex: toHex(rgb), hue: Math.round(hue), saturation: Number(saturation.toFixed(3)), lightness: Number(lightness.toFixed(3)) };
        };
        const colorUse = new Map();
        const addColorUse = (value, bucket, weight = 1) => {
          const stats = colorStats(value);
          if (!stats) return;
          const key = stats.hex || value;
          const item = colorUse.get(key) || { value: key, raw: value, count: 0, text: 0, background: 0, border: 0, cta: 0, largeArea: 0, saturation: stats.saturation, lightness: stats.lightness, hue: stats.hue };
          item.count += weight;
          item[bucket] = (item[bucket] || 0) + weight;
          colorUse.set(key, item);
        };
        const componentElement = el => {
          const style = getComputedStyle(el);
          const rect = el.getBoundingClientRect();
          return {
            tag: el.tagName.toLowerCase(),
            id: el.id || '',
            classes: typeof el.className === 'string' ? el.className.split(/\\s+/).filter(Boolean).slice(0, 8) : [],
            text: clampText(el.innerText || el.getAttribute('aria-label') || el.getAttribute('alt') || '', 120),
            rect: { x: Math.round(rect.x), y: Math.round(rect.y + window.scrollY), width: Math.round(rect.width), height: Math.round(rect.height) },
            display: style.display,
            layout: style.display === 'grid' ? 'grid' : (style.display.includes('flex') ? 'flex-' + style.flexDirection : style.display),
            color: style.color,
            background: style.backgroundColor,
            borderColor: style.borderColor,
            borderRadius: style.borderRadius,
            boxShadow: style.boxShadow,
            font: [style.fontSize, style.fontWeight, style.fontFamily].filter(Boolean).join(' '),
            spacing: [style.paddingTop, style.paddingRight, style.paddingBottom, style.paddingLeft].join(' '),
            gap: style.gap || style.columnGap || style.rowGap || ''
          };
        };
        const visibleAll = allVisible;
        for (const el of visibleAll) {
          const style = getComputedStyle(el);
          const rect = el.getBoundingClientRect();
          const areaWeight = Math.max(1, Math.round((rect.width * rect.height) / 6000));
          addColorUse(style.color, 'text', 1);
          addColorUse(style.borderColor, 'border', 1);
          addColorUse(style.backgroundColor, 'background', areaWeight);
          if (rect.width > viewport.width * 0.45 && rect.height > 80) addColorUse(style.backgroundColor, 'largeArea', areaWeight);
          if (el.matches('button, a[role="button"], input[type="button"], input[type="submit"], .button, .btn, [class*="button"], [class*="btn"], [class*="cta"]')) {
            addColorUse(style.backgroundColor, 'cta', 8);
            addColorUse(style.color, 'cta', 3);
          }
        }
        const colorUses = Array.from(colorUse.values()).sort((a, b) => b.count - a.count).slice(0, 36);
        const strongColors = colorUses.filter(item => item.saturation > 0.16 && item.lightness > 0.12 && item.lightness < 0.92);
        const neutralColors = colorUses.filter(item => item.saturation <= 0.16);
        const pickBy = (items, scoreFn) => items.slice().sort((a, b) => scoreFn(b) - scoreFn(a))[0] || null;
        const colorRoles = {
          primaryBrand: pickBy(strongColors, item => item.cta * 3 + item.background + item.text),
          accent: pickBy(strongColors.filter(item => item !== pickBy(strongColors, x => x.cta * 3 + x.background + x.text)), item => item.cta + item.background + item.text),
          pageBackground: pickBy(neutralColors, item => item.largeArea * 3 + item.background),
          surface: pickBy(neutralColors.filter(item => item.lightness > 0.12 && item.lightness < 0.98), item => item.background + item.largeArea),
          primaryText: pickBy(colorUses, item => item.text * 2 + (item.lightness < 0.35 || item.lightness > 0.68 ? 6 : 0)),
          mutedText: pickBy(colorUses.filter(item => item.text > 0 && item.lightness > 0.35 && item.lightness < 0.75), item => item.text),
          border: pickBy(colorUses, item => item.border * 2),
          danger: pickBy(strongColors.filter(item => item.hue <= 20 || item.hue >= 340), item => item.count),
          success: pickBy(strongColors.filter(item => item.hue >= 85 && item.hue <= 165), item => item.count)
        };
        Object.keys(colorRoles).forEach(key => {
          if (colorRoles[key]) colorRoles[key] = { value: colorRoles[key].value, reason: key, count: colorRoles[key].count, saturation: colorRoles[key].saturation, lightness: colorRoles[key].lightness };
        });
        const summarizeComponent = (name, selector, max = 28) => {
          const nodes = Array.from(document.querySelectorAll(selector)).filter(el => {
            const rect = el.getBoundingClientRect();
            const style = getComputedStyle(el);
            return rect.width > 3 && rect.height > 3 && style.display !== 'none' && style.visibility !== 'hidden';
          }).slice(0, max);
          const samples = nodes.map(componentElement);
          return {
            name,
            count: nodes.length,
            layout: modeValue(samples.map(item => item.layout)),
            typography: modeValue(samples.map(item => item.font)),
            color: modeValue(samples.map(item => item.color)),
            background: modeValue(samples.map(item => item.background).filter(value => value && value !== 'rgba(0, 0, 0, 0)')),
            radius: modeValue(samples.map(item => item.borderRadius).filter(value => value && value !== '0px')),
            shadow: modeValue(samples.map(item => item.boxShadow).filter(value => value && value !== 'none')),
            spacing: modeValue(samples.map(item => item.spacing)),
            gap: modeValue(samples.map(item => item.gap).filter(Boolean)),
            example: samples[0] ? (samples[0].text || samples[0].classes.join('.') || samples[0].tag) : '',
            samples: samples.slice(0, 8)
          };
        };
        const componentSystem = {
          navigation: summarizeComponent('navigation', 'header, nav, [class*="nav"], [class*="menu"]', 18),
          buttons: summarizeComponent('buttons', 'button, a[role="button"], input[type="button"], input[type="submit"], .button, .btn, [class*="button"], [class*="btn"], [class*="cta"]', 32),
          cards: summarizeComponent('cards', 'article, .card, [class*="card"], [class*="panel"], [class*="tile"], [class*="item"]', 36),
          forms: summarizeComponent('forms', 'form, input, textarea, select, [class*="input"], [class*="field"], [class*="form"]', 26),
          tags: summarizeComponent('tags', '.tag, .badge, .chip, [class*="tag"], [class*="badge"], [class*="chip"], [class*="pill"]', 26),
          media: summarizeComponent('media', 'img, picture, video, canvas, svg, [class*="media"], [class*="image"], [class*="visual"]', 32),
          lists: summarizeComponent('lists', 'ul, ol, [class*="list"], [class*="grid"]', 24)
        };
        const componentVariants = Object.fromEntries(Object.entries(componentSystem).map(([name, group]) => {
          const variants = new Map();
          for (const sample of group.samples || []) {
            const key = [
              sample.layout,
              sample.background,
              sample.color,
              sample.borderRadius,
              sample.boxShadow,
              sample.spacing,
              sample.gap,
              sample.font
            ].filter(Boolean).join(' | ');
            const item = variants.get(key) || {
              signature: key,
              count: 0,
              layout: sample.layout,
              background: sample.background,
              color: sample.color,
              radius: sample.borderRadius,
              shadow: sample.boxShadow,
              spacing: sample.spacing,
              gap: sample.gap,
              font: sample.font,
              examples: []
            };
            item.count++;
            if (sample.text && item.examples.length < 4) item.examples.push(sample.text);
            variants.set(key, item);
          }
          return [name, Array.from(variants.values()).sort((a, b) => b.count - a.count).slice(0, 8)];
        }));
        const classifySection = (el, index) => {
          const tag = el.tagName.toLowerCase();
          const cls = typeof el.className === 'string' ? el.className.toLowerCase() : '';
          const text = clampText(el.innerText || el.getAttribute('aria-label') || '', 180);
          if (tag === 'header' || tag === 'nav' || /nav|menu|navbar/.test(cls)) return 'navigation';
          if (tag === 'footer' || /footer/.test(cls)) return 'footer';
          if (index === 0 || /hero|banner|masthead|intro/.test(cls) || el.querySelector('h1')) return 'hero';
          if (/price|pricing|plan/.test(cls + ' ' + text.toLowerCase())) return 'pricing';
          if (/gallery|portfolio|showcase|work/.test(cls)) return 'gallery';
          if (/feature|benefit|service|solution/.test(cls)) return 'feature';
          if (/testimonial|review|quote/.test(cls)) return 'testimonial';
          if (/contact|signup|subscribe/.test(cls)) return 'conversion';
          return 'content';
        };
        const sectionNodes = Array.from(document.querySelectorAll('header, nav, main > section, main > div, section, article, aside, footer'))
          .filter((el, index, arr) => {
            const rect = el.getBoundingClientRect();
            const style = getComputedStyle(el);
            if (rect.width < 120 || rect.height < 40 || style.display === 'none' || style.visibility === 'hidden') return false;
            return !arr.some(other => other !== el && other.contains(el) && /^(section|article)$/i.test(other.tagName));
          })
          .slice(0, 40);
        const sectionAnalysis = sectionNodes.map((el, index) => {
          const sig = componentElement(el);
          const style = getComputedStyle(el);
          const rect = el.getBoundingClientRect();
          const children = Array.from(el.children);
          const componentCounts = {
            buttons: el.querySelectorAll('button, a[role="button"], .button, .btn, [class*="button"], [class*="btn"]').length,
            cards: el.querySelectorAll('article, .card, [class*="card"], [class*="panel"], [class*="tile"]').length,
            forms: el.querySelectorAll('form, input, textarea, select').length,
            media: el.querySelectorAll('img, video, canvas, svg, picture').length
          };
          return {
            index,
            role: classifySection(el, index),
            tag: sig.tag,
            id: sig.id,
            classes: sig.classes,
            text: sig.text,
            y: Math.round(rect.y + window.scrollY),
            height: Math.round(rect.height),
            width: Math.round(rect.width),
            layout: sig.layout,
            gridTemplateColumns: style.gridTemplateColumns && style.gridTemplateColumns !== 'none' ? style.gridTemplateColumns.slice(0, 160) : '',
            flexDirection: style.flexDirection,
            alignItems: style.alignItems,
            justifyContent: style.justifyContent,
            gap: style.gap || style.columnGap || style.rowGap || '',
            padding: sig.spacing,
            background: sig.background,
            color: sig.color,
            font: sig.font,
            density: children.length <= 3 ? 'sparse' : children.length <= 8 ? 'balanced' : 'dense',
            componentCounts
          };
        });
        const widthCounts = new Map();
        const gridCounts = new Map();
        const typographyCounts = new Map();
        for (const el of visibleAll) {
          const rect = el.getBoundingClientRect();
          const style = getComputedStyle(el);
          if (rect.width > 280 && rect.width < viewport.width + 4) widthCounts.set(Math.round(rect.width) + 'px', (widthCounts.get(Math.round(rect.width) + 'px') || 0) + 1);
          if (style.display === 'grid' && style.gridTemplateColumns !== 'none') gridCounts.set(style.gridTemplateColumns.slice(0, 160), (gridCounts.get(style.gridTemplateColumns.slice(0, 160)) || 0) + 1);
          typographyCounts.set(style.fontSize + '/' + style.fontWeight, (typographyCounts.get(style.fontSize + '/' + style.fontWeight) || 0) + 1);
        }
        const refinedDesignTokens = {
          colors: colorUses.slice(0, 24),
          fontFamilies: topEntries(fontCounts),
          typographyScale: topEntries(typographyCounts).slice(0, 18).map(item => {
            const parts = item.value.split('/');
            return { size: parts[0] || '', weight: parts[1] || '', count: item.count };
          }),
          radiiScale: topEntries(radiusCounts),
          shadowScale: topEntries(shadowCounts),
          spacingScale: topEntries(spacingCounts)
        };
        const layoutSystem = {
          contentWidths: topEntries(widthCounts).slice(0, 12),
          gridPatterns: topEntries(gridCounts).slice(0, 12),
          spacingScale: refinedDesignTokens.spacingScale,
          sectionCount: sectionAnalysis.length,
          averageSectionHeight: sectionAnalysis.length ? Math.round(sectionAnalysis.reduce((sum, item) => sum + item.height, 0) / sectionAnalysis.length) : 0,
          dominantDensity: modeValue(sectionAnalysis.map(item => item.density)),
          sectionRhythm: sectionAnalysis.slice(0, 16).map((item, index) => {
            const previous = index > 0 ? sectionAnalysis[index - 1] : null;
            return {
              role: item.role,
              height: item.height,
              gapFromPrevious: previous ? Math.max(0, item.y - previous.y - previous.height) : 0,
              density: item.density,
              layout: item.layout
            };
          })
        };
        const stylesheets = Array.from(document.styleSheets).map(sheet => {
          let ruleSample = [];
          let accessible = true;
          try {
            ruleSample = Array.from(sheet.cssRules || []).slice(0, 60).map(rule => rule.cssText.slice(0, 500));
          } catch (error) {
            accessible = false;
          }
          return { href: sheet.href || 'inline', accessible, ruleSample };
        });
        const scripts = Array.from(document.scripts).map(script => ({
          src: script.src || '',
          type: script.type || '',
          inlineLength: script.src ? 0 : (script.textContent || '').length,
          inlineSample: script.src ? '' : (script.textContent || '').slice(0, 800)
        }));
        const assets = {
          images: Array.from(document.images).slice(0, 120).map(img => ({ src: img.currentSrc || img.src, alt: img.alt || '', width: img.naturalWidth || img.width || 0, height: img.naturalHeight || img.height || 0 })),
          videos: Array.from(document.querySelectorAll('video')).map(video => ({ src: video.currentSrc || video.src || '', poster: video.poster || '', autoplay: video.autoplay, muted: video.muted, loop: video.loop, width: video.videoWidth || video.clientWidth || 0, height: video.videoHeight || video.clientHeight || 0 })),
          audio: Array.from(document.querySelectorAll('audio, source[type^="audio"]')).map(item => ({ src: item.currentSrc || item.src || '', type: item.type || '' })),
          svgs: Array.from(document.querySelectorAll('svg')).slice(0, 60).map(svg => ({ outerSample: svg.outerHTML.slice(0, 800), rect: elementSignature(svg).rect }))
        };
        const animations = Array.from(document.getAnimations({ subtree: true })).slice(0, 120).map(animation => ({
          playState: animation.playState,
          currentTime: animation.currentTime,
          playbackRate: animation.playbackRate,
          effectTiming: animation.effect && animation.effect.getTiming ? animation.effect.getTiming() : null,
          target: animation.effect && animation.effect.target ? elementSignature(animation.effect.target) : null
        }));
        const animationSystem = {
          count: animations.length,
          summary: animations.length
            ? animations.slice(0, 8).map(item => (item.target?.tag || 'element') + ' ' + (item.playState || '') + ' ' + Math.round(item.effectTiming?.duration || 0) + 'ms').join('; ')
            : '',
          rules: animations.slice(0, 20).map(item => {
            const timing = item.effectTiming || {};
            return [item.target?.tag || 'element', timing.duration ? Math.round(timing.duration) + 'ms' : '', timing.easing || '', item.playState || ''].filter(Boolean).join(' ');
          }),
          motionPersonality: animations.length > 20
            ? 'motion-heavy'
            : animations.length > 4
              ? 'moderate motion'
              : animations.length > 0
                ? 'subtle motion'
                : 'mostly static'
        };
        const headingTexts = Array.from(document.querySelectorAll('h1,h2,h3')).map(el => clampText(el.innerText, 120)).filter(Boolean).slice(0, 16);
        const actionTexts = Array.from(document.querySelectorAll('button, a[role="button"], .button, .btn, [class*="button"], [class*="btn"], [class*="cta"]'))
          .map(el => clampText(el.innerText || el.getAttribute('aria-label') || '', 80))
          .filter(Boolean)
          .slice(0, 18);
        const primaryBrand = colorRoles.primaryBrand?.value || '';
        const backgroundRole = colorRoles.pageBackground?.value || '';
        const hero = sectionAnalysis.find(item => item.role === 'hero') || sectionAnalysis[0] || null;
        const denseSections = sectionAnalysis.filter(item => item.density === 'dense').length;
        const sparseSections = sectionAnalysis.filter(item => item.density === 'sparse').length;
        const designDna = {
          visualCharacter: [
            primaryBrand ? 'brand-led accent color ' + primaryBrand : '',
            backgroundRole ? 'background foundation ' + backgroundRole : '',
            layoutSystem.dominantDensity ? layoutSystem.dominantDensity + ' information density' : '',
            animationSystem.motionPersonality
          ].filter(Boolean).join('; '),
          hierarchy: hero
            ? 'hero starts at ' + hero.y + 'px with ' + hero.height + 'px height, ' + hero.layout + ' layout, ' + (hero.componentCounts?.buttons || 0) + ' actions and ' + (hero.componentCounts?.media || 0) + ' media blocks'
            : 'no clear hero hierarchy detected',
          composition: [
            layoutSystem.contentWidths?.[0]?.value ? 'main content width around ' + layoutSystem.contentWidths[0].value : '',
            layoutSystem.gridPatterns?.[0]?.value ? 'dominant grid ' + layoutSystem.gridPatterns[0].value : '',
            'sections ' + sectionAnalysis.length + ', sparse ' + sparseSections + ', dense ' + denseSections,
            layoutSystem.averageSectionHeight ? 'average section height ' + layoutSystem.averageSectionHeight + 'px' : ''
          ].filter(Boolean).join('; '),
          contentTone: headingTexts.length
            ? 'headings: ' + headingTexts.slice(0, 6).join(' | ') + (actionTexts.length ? '; actions: ' + actionTexts.slice(0, 6).join(' | ') : '')
            : '',
          replicationChecklist: [
            hero ? 'rebuild ' + hero.role + ' section proportions first (' + hero.height + 'px baseline)' : '',
            primaryBrand ? 'map ' + primaryBrand + ' to primary CTA/accent token before adding secondary colors' : '',
            layoutSystem.contentWidths?.[0]?.value ? 'set max content width near ' + layoutSystem.contentWidths[0].value : '',
            refinedDesignTokens.typographyScale?.[0] ? 'establish typography base ' + refinedDesignTokens.typographyScale[0].size + '/' + refinedDesignTokens.typographyScale[0].weight : '',
            componentSystem.buttons?.count ? 'create button variants from ' + (componentVariants.buttons?.length || 1) + ' detected signatures' : '',
            componentSystem.cards?.count ? 'create card rules from ' + (componentVariants.cards?.length || 1) + ' detected signatures' : '',
            animationSystem.motionPersonality !== 'mostly static' ? 'match motion personality: ' + animationSystem.motionPersonality : '',
            layoutSystem.sectionRhythm?.length ? 'preserve section spacing rhythm rather than only copying colors' : ''
          ].filter(Boolean),
          avoid: [
            'do not infer the whole design from first viewport only',
            'do not replace detected component rules with generic card grids',
            primaryBrand ? 'do not overuse ' + primaryBrand + '; keep it on accents and action surfaces' : '',
            backgroundRole ? 'do not flatten background hierarchy into a single color if surfaces differ' : '',
            animationSystem.motionPersonality === 'mostly static' ? 'do not add decorative motion that the source design does not use' : ''
          ].filter(Boolean)
        };
        const canvas = Array.from(document.querySelectorAll('canvas')).map((item, index) => {
          let contextType = 'unknown';
          let sampleError = '';
          let nonBlank = null;
          try {
            const webgl = item.getContext('webgl2') || item.getContext('webgl') || item.getContext('experimental-webgl');
            if (webgl) {
              contextType = webgl instanceof WebGL2RenderingContext ? 'webgl2' : 'webgl';
              const pixels = new Uint8Array(4);
              webgl.readPixels(Math.max(0, Math.floor((item.width || 1) / 2)), Math.max(0, Math.floor((item.height || 1) / 2)), 1, 1, webgl.RGBA, webgl.UNSIGNED_BYTE, pixels);
              nonBlank = pixels[3] > 0 && (pixels[0] || pixels[1] || pixels[2]);
            } else {
              const ctx = item.getContext('2d', { willReadFrequently: true });
              if (ctx) {
                contextType = '2d';
                const w = Math.max(1, Math.min(item.width || item.clientWidth || 1, 120));
                const h = Math.max(1, Math.min(item.height || item.clientHeight || 1, 90));
                const data = ctx.getImageData(0, 0, w, h).data;
                let colored = 0;
                for (let i = 0; i < data.length; i += 4) {
                  if (data[i + 3] > 0 && (data[i] || data[i + 1] || data[i + 2])) colored++;
                  if (colored > 8) break;
                }
                nonBlank = colored > 8;
              }
            }
          } catch (error) {
            sampleError = error && error.message ? error.message : String(error);
          }
          return {
            index,
            width: item.width || 0,
            height: item.height || 0,
            clientWidth: item.clientWidth || 0,
            clientHeight: item.clientHeight || 0,
            contextType,
            nonBlank,
            sampleError,
            className: typeof item.className === 'string' ? item.className : ''
          };
        });
        const technologySignals = {
          react: !!(window.React || document.querySelector('[data-reactroot], [data-reactid], #__next')),
          next: !!document.querySelector('#__next') || scripts.some(item => /_next\\//.test(item.src)),
          vue: !!(window.Vue || document.querySelector('[data-v-]')),
          nuxt: !!document.querySelector('#__nuxt') || scripts.some(item => /_nuxt\\//.test(item.src)),
          gsap: !!window.gsap || scripts.some(item => /gsap/i.test(item.src)),
          three: !!window.THREE || scripts.some(item => /three/i.test(item.src)),
          lottie: !!window.lottie || scripts.some(item => /lottie/i.test(item.src)),
          webgl: canvas.some(item => item.contextType === 'webgl' || item.contextType === 'webgl2'),
          webflow: /webflow/i.test(document.documentElement.className) || scripts.some(item => /webflow/i.test(item.src))
        };
        return {
          url: location.href,
          title: document.title || '',
          viewport,
          scrollHeight,
          snapshots,
          designTokens: {
            colors: topEntries(colorCounts),
            fonts: topEntries(fontCounts),
            radii: topEntries(radiusCounts),
            shadows: topEntries(shadowCounts),
            spacing: topEntries(spacingCounts)
          },
          refinedDesignTokens,
          visualPriority: {
            colorRoles
          },
          layoutSystem,
          sectionAnalysis,
          componentSystem,
          componentVariants,
          animationSystem,
          designDna,
          domSummary: {
            bodyTextLength: (document.body && document.body.innerText || '').length,
            headings: Array.from(document.querySelectorAll('h1,h2,h3')).map(el => ({ tag: el.tagName.toLowerCase(), text: clampText(el.innerText, 180), rect: elementSignature(el).rect })).slice(0, 40),
            navLinks: Array.from(document.querySelectorAll('nav a, header a')).map(el => ({ text: clampText(el.innerText || el.getAttribute('aria-label'), 80), href: el.href })).slice(0, 80),
            sections: Array.from(document.querySelectorAll('section, main > div, article')).map(elementSignature).slice(0, 80)
          },
          stylesheets,
          scripts,
          assets,
          animations,
          canvas,
          technologySignals
        };
      })()
    `)

    const sourceFiles = []
    if (includeSource) {
      const sourceUrls = [
        ...analysis.scripts.map(item => item.src).filter(Boolean),
        ...analysis.stylesheets.map(item => item.href).filter(href => href && href !== 'inline')
      ].filter(url => {
        if (!/^https?:\/\//i.test(url)) return false
        if (args.same_origin_only === false || args.sameOriginOnly === false) return true
        return sameOrigin(targetUrl, url)
      }).slice(0, Math.max(0, Math.min(Number(args.max_source_files || args.maxSourceFiles || 24), 80)))

      for (const sourceUrl of sourceUrls) {
        try {
          const response = await fetch(sourceUrl)
          const contentType = response.headers.get('content-type') || ''
          const text = await response.text()
          sourceFiles.push({
            url: sourceUrl,
            status: response.status,
            contentType,
            length: text.length,
            sample: clipString(text, Number(args.source_sample_chars || args.sourceSampleChars || 3000)),
            sourceMapHint: /sourceMappingURL=/.test(text)
          })
        } catch (error) {
          sourceFiles.push({ url: sourceUrl, success: false, error: error.message })
        }
      }
    }

    let screenshotArtifacts = []
    if (includeScreenshots) {
      const dir = getWebsiteResearchDir()
      const positions = (analysis.snapshots || []).slice(0, 4).map(item => item.scrollY)
      for (const y of positions) {
        await win.webContents.executeJavaScript(`window.scrollTo(0, ${Number(y) || 0}); new Promise(resolve => setTimeout(resolve, ${Math.min(delayMs, 2000)}));`)
        const filePath = path.join(dir, `website-${normalizeTimestampForFile()}-${Math.random().toString(36).slice(2, 7)}-${Number(y) || 0}.png`)
        const size = await captureWebContentsToFile(win.webContents, filePath, {})
        screenshotArtifacts.push({ path: filePath, scrollY: y, width: size.width, height: size.height })
      }
    }

      const resourceSummary = includeAssets
      ? resources.slice(0, 240)
      : resources.slice(0, 40)
    const replicationBrief = buildRuntimeReplicationBrief(analysis)

    const researchResult = {
      success: true,
      target: targetUrl,
      viewport: { width, height },
      method: 'runtime-dom-css-assets-animation-analysis',
      screenshotPolicy: includeScreenshots
        ? 'Screenshots were captured only as optional visual evidence; DOM/CSS/runtime data remains primary.'
        : 'No screenshots captured. Analysis is based on DOM, CSS, resources, scroll runtime, animations, Canvas/WebGL and public frontend code.',
      summary: {
        title: analysis.title,
        scrollHeight: analysis.scrollHeight,
        scrollSamples: analysis.snapshots.length,
        visibleElementSamples: analysis.snapshots.map(item => ({ scrollY: item.scrollY, scrollProgress: item.scrollProgress, visibleCount: item.visibleCount })),
        technologySignals: analysis.technologySignals,
        canvasCount: analysis.canvas.length,
        animationCount: analysis.animations.length,
        sectionCount: Array.isArray(analysis.sectionAnalysis) ? analysis.sectionAnalysis.length : 0,
        componentGroups: Object.values(analysis.componentSystem || {}).filter(item => item?.count > 0).length,
        sourceFileCount: sourceFiles.length,
        resourceCount: resources.length
      },
      designTokens: analysis.designTokens,
      refinedDesignTokens: analysis.refinedDesignTokens,
      visualPriority: analysis.visualPriority,
      layoutSystem: analysis.layoutSystem,
      sectionAnalysis: clipArray(analysis.sectionAnalysis, 40),
      componentSystem: analysis.componentSystem,
      componentVariants: analysis.componentVariants,
      animationSystem: analysis.animationSystem,
      designDna: analysis.designDna,
      replicationBrief,
      domSummary: analysis.domSummary,
      scrollRuntime: analysis.snapshots,
      animations: clipArray(analysis.animations, 80),
      canvas: analysis.canvas,
      assets: includeAssets ? analysis.assets : undefined,
      resources: resourceSummary,
      stylesheets: clipArray(analysis.stylesheets, 40),
      scripts: clipArray(analysis.scripts, 80),
      publicSourceFiles: sourceFiles,
      consoleMessages: consoleMessages.slice(-40),
      pageErrors,
      screenshots: screenshotArtifacts
    }
    if (args.save_design_style !== false && args.saveDesignStyle !== false) {
      try {
        researchResult.designStyleMemory = designStyleMemory.saveFromWebsiteResearchResult(researchResult, {
          projectPath: options.projectPath,
          source: 'research_website_runtime'
        })
      } catch (error) {
        researchResult.designStyleMemory = {
          success: false,
          error: error.message
        }
      }
    }
    return researchResult
  } finally {
    if (!win.isDestroyed()) win.destroy()
  }
}

const handlers = {
  runtime_verify: async (args, ctx = {}) => {
    try {
      return await runtimeVerify(args, ctx)
    } catch (e) {
      return {
        success: false,
        tool: 'runtime_verify',
        verification_status: 'incomplete',
        error: e.message,
        code: e.code,
        claim_policy: 'Verification did not complete. Do not report the runtime as error-free.'
      }
    }
  },

  research_website_runtime: async (args, ctx) => {
    const { resolvePath, projectPath } = ctx
    try {
      return await researchWebsiteRuntime(args, resolvePath, { projectPath })
    } catch (e) {
      return { success: false, error: e.message }
    }
  },
}

module.exports = {
  handlers,
  clipArray,
  clipString,
  getWebsiteResearchDir,
  sameOrigin,
  buildRuntimeReplicationBrief,
  researchWebsiteRuntime,
  crawlWebsiteRuntime,
  runtimeVerify,
  collectInteractionState,
  clickLocator,
  normalizeLocator,
  buildInteractionFailureDiagnosis,
  runInteractionOnWebContents,
  compareInteractionEvidence
}
