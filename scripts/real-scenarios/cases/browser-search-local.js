const path = require('path')

module.exports = {
  id: 'browser-search.local',
  title: 'Secure browser search parses free search HTML, dedupes results, and caches repeats',
  tags: ['browser-search', 'web-search'],
  changedFilePatterns: [
    /^electron\/tools\/browser-tool-secure\.js$/i,
    /^electron\/modules\/tools\.js$/i,
    /^electron\/modules\/schemas\/index\.js$/i,
    /^electron\/modules\/schemas\/browser-search\.js$/i,
    /^electron\/modules\/chat\/tool-result-summarizer\.js$/i,
    /^electron\/preload\.js$/i,
    /^frontend\/scripts\/app\.js$/i
  ],

  async run(ctx) {
    const { BrowserToolSecure } = require(path.join(ctx.root, 'electron/tools/browser-tool-secure'))
    const tool = new BrowserToolSecure()
    const duckHtml = [
      '<div class="result">',
      '<a class="result__a" href="https://duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fdocs">Example &#x6587;&#26723;</a>',
      '<a class="result__snippet">A useful snippet &amp; detail</a>',
      '</div>'
    ].join('')
    const parsed = tool.parseResults(duckHtml, 'duckduckgo')
    ctx.assert.equal(parsed.length, 1, 'DuckDuckGo HTML result should parse')
    ctx.assert.equal(parsed[0].title, 'Example 文档', 'HTML numeric entities should decode')
    ctx.assert.equal(parsed[0].link, 'https://example.com/docs', 'DuckDuckGo redirect URL should unwrap')

    const deduped = tool._dedupeResults([
      { title: 'Same', link: 'https://example.com/docs?utm=1' },
      { title: 'Same Again', link: 'https://example.com/docs?utm=2' },
      { title: 'Other', link: 'https://example.com/other' }
    ])
    ctx.assert.equal(deduped.length, 2, 'results should dedupe by canonical URL')

    tool._setCachedSearch('query', 'auto', { success: true, query: 'query', engine: 'auto', results: [{ title: 'Cached' }] })
    const cached = tool._getCachedSearch('query', 'auto')
    ctx.assert.ok(cached?.cached, 'repeat search should be served from cache')

    const lxStatus = await tool.lxweb({ action: 'status' })
    ctx.assert.equal(lxStatus.action, 'status', 'lxweb should expose a unified status action')

    const originalFetch = tool.fetch.bind(tool)
    tool.fetch = async url => ({ success: true, url, text: 'fetched', length: 7 })
    const inferredFetch = await tool.lxweb({ url: 'https://example.com/doc' })
    ctx.assert.equal(inferredFetch.action, 'fetch', 'lxweb should infer fetch action when url is provided')
    ctx.assert.equal(inferredFetch.url, 'https://example.com/doc', 'lxweb inferred fetch should pass the URL through')
    tool.fetch = async url => ({
      success: true,
      url,
      title: 'Find Doc',
      text: 'alpha before target keyword and useful context. another target keyword appears here.',
      length: 78
    })
    const findResult = await tool.lxweb({ action: 'find', url: 'https://example.com/doc', pattern: 'target keyword' })
    ctx.assert.equal(findResult.action, 'find', 'lxweb should expose a find action')
    ctx.assert.equal(findResult.count, 2, 'lxweb find should return all matching snippets')
    ctx.assert.ok(findResult.matches[0]?.snippet.includes('target keyword'), 'lxweb find should include useful context snippets')
    tool.fetch = originalFetch

    const designHtml = [
      '<html><head><title>Design Demo</title>',
      '<meta name="description" content="A polished SaaS dashboard">',
      '<style>:root{--brand:#2563eb;--surface:#ffffff}.hero{font-family:Inter, sans-serif;color:#111827;background:linear-gradient(#2563eb,#14b8a6);border-radius:18px;box-shadow:0 20px 60px rgba(0,0,0,.18)}</style>',
      '<link rel="stylesheet" href="/app.css"></head>',
      '<body><main class="hero"><h1>Design Demo</h1><img src="/hero.webp" alt="Hero"></main></body></html>'
    ].join('')
    const staticDesign = tool._extractStaticDesignHints(designHtml, 'https://example.com/')
    ctx.assert.equal(staticDesign.title, 'Design Demo', 'design extraction should read page title')
    ctx.assert.ok(staticDesign.colors.includes('#2563eb'), 'design extraction should collect CSS colors')
    ctx.assert.ok(staticDesign.fontFamilies.some(item => item.includes('Inter')), 'design extraction should collect font families')
    ctx.assert.ok(staticDesign.assets.some(item => item.endsWith('/hero.webp')), 'design extraction should collect visual assets')
    const designBrief = tool._buildDesignBrief({ ...staticDesign, rendered: false })
    ctx.assert.ok(designBrief.includes('Color palette'), 'design brief should summarize palette for UI replication')

    const originalAnalyzeDesign = tool.analyzeDesign.bind(tool)
    tool.analyzeDesign = async (url, options = {}) => ({
      success: true,
      action: 'design',
      url,
      viewport: { width: options.viewport_width || 1440, height: options.viewport_height || 900 },
      design: { colors: ['#2563eb'] },
      replicationBrief: 'Color palette: #2563eb',
      text: 'Color palette: #2563eb'
    })
    const designResult = await tool.lxweb({ action: 'design', url: 'https://example.com/', viewport_width: 1280 })
    ctx.assert.equal(designResult.action, 'design', 'lxweb should expose a UI design analysis action')
    ctx.assert.equal(designResult.viewport.width, 1280, 'lxweb design action should pass viewport options through')
    ctx.assert.ok(designResult.replicationBrief.includes('#2563eb'), 'lxweb design action should return a replication brief')
    tool.analyzeDesign = originalAnalyzeDesign

    const sentEvents = []
    tool.urlValidator = {
      validate: async url => ({ valid: true, parsedUrl: new URL(url) })
    }
    const rightOpen = await tool.lxweb({
      action: 'open_right',
      url: 'https://www.douyin.com/'
    }, {
      webContents: {
        isDestroyed: () => false,
        send: (channel, payload) => sentEvents.push({ channel, payload })
      }
    })
    ctx.assert.equal(rightOpen.action, 'open_right', 'lxweb should expose a right-side webview open action')
    ctx.assert.equal(rightOpen.success, true, 'open_right should succeed when renderer target is available')
    ctx.assert.equal(sentEvents[0]?.channel, 'right-webview-open-request', 'open_right should ask the renderer to open the right webview')
    ctx.assert.equal(sentEvents[0]?.payload?.url, 'https://www.douyin.com/', 'open_right should send the normalized URL to the renderer')

    const thinHtml = '<html><body><div id="app"></div><script src="/app.js"></script></body></html>'
    ctx.assert.equal(tool._isThinContent('', thinHtml), true, 'JS app shells should trigger render fallback')

    const { MODEL_TOOLS_SCHEMA } = require(path.join(ctx.root, 'electron/modules/schemas'))
    const exposedNames = MODEL_TOOLS_SCHEMA.map(item => item.function.name)
    ctx.assert.ok(exposedNames.includes('lxweb'), 'lxweb should be exposed to models')
    const lxwebSchema = MODEL_TOOLS_SCHEMA.find(item => item.function.name === 'lxweb')
    const actionEnum = lxwebSchema?.function?.parameters?.properties?.action?.enum || []
    ctx.assert.ok(actionEnum.includes('open_right'), 'lxweb schema should teach models to open pages in the right-side webview')
    ctx.assert.ok(actionEnum.includes('find'), 'lxweb schema should teach models to find text inside fetched pages')
    ctx.assert.ok(actionEnum.includes('design'), 'lxweb schema should teach models to capture UI design for replication')
    ctx.assert.equal(exposedNames.includes('browser_search'), false, 'browser_search should be hidden from models')
    ctx.assert.equal(exposedNames.includes('browser_fetch'), false, 'browser_fetch should be hidden from models')
  }
}
