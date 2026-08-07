const path = require('path')
const fs = require('fs')
const { pathToFileURL } = require('url')
const { researchWebsiteRuntime, runtimeVerify } = require('./tool-handlers/website-research')

const URL_PATTERN = /(https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0):\d+[^\s"'<>]*)/i

function resolveRuntimeTarget(projectPath = '', options = {}, runtimeProbe = {}) {
  const explicitUrl = String(options.url || options.runtime_url || options.runtimeUrl || '').trim()
  if (explicitUrl) return { url: explicitUrl, source: 'explicit-url' }

  const htmlPath = String(options.html_path || options.htmlPath || options.runtime_html_path || options.runtimeHtmlPath || '').trim()
  if (htmlPath) {
    const resolved = path.isAbsolute(htmlPath) ? htmlPath : path.resolve(projectPath, htmlPath)
    return { url: pathToFileURL(resolved).toString(), html_path: resolved, source: 'explicit-html' }
  }

  const output = String(runtimeProbe?.output_tail || '')
  const match = output.match(URL_PATTERN)
  if (match) return { url: match[1].replace(/0\.0\.0\.0/, '127.0.0.1'), source: 'runtime-output' }

  return null
}

function runtimeEvent(severity, type, message, evidence = '', extra = {}) {
  return {
    severity,
    category: 'runtime',
    type,
    path: extra.path || '',
    line: extra.line || null,
    message,
    evidence,
    source: extra.source || 'runtime-closure'
  }
}

function collectBrowserEvents(result = {}) {
  const events = []
  for (const item of Array.isArray(result.pageErrors) ? result.pageErrors : []) {
    events.push(runtimeEvent('error', 'browser-page-error', item.message || 'Browser page error', item.sourceId || '', { line: item.line }))
  }
  for (const item of Array.isArray(result.consoleMessages) ? result.consoleMessages : []) {
    const level = Number(item.level)
    const text = String(item.message || '')
    if (level < 2 && !/(error|exception|unhandled|failed|cannot|undefined|TypeError|ReferenceError|SyntaxError)/i.test(text)) continue
    events.push(runtimeEvent(level >= 3 ? 'error' : 'warning', 'browser-console-error', text, item.sourceId || '', { line: item.line }))
  }
  for (const resource of Array.isArray(result.resources) ? result.resources : []) {
    const status = Number(resource.statusCode || resource.status || 0)
    if (status < 400) continue
    events.push(runtimeEvent(status >= 500 ? 'error' : 'warning', 'browser-resource-error', `${resource.method || 'GET'} ${resource.url || ''} returned HTTP ${status}`, resource.resourceType || ''))
  }
  return events
}

function collectInteractionEvents(result = {}) {
  const events = []
  if (!result || result.success !== false) return events
  if (result.error) {
    events.push(runtimeEvent(result.incomplete ? 'warning' : 'error', 'runtime-verification-failure', result.error, result.error_type || '', { source: 'runtime-verify-closure' }))
  }
  for (const failure of Array.isArray(result.failures) ? result.failures : []) {
    events.push(runtimeEvent('error', 'ui-interaction-failure', failure, result.message || '', { source: 'ui-interaction-closure' }))
  }
  for (const item of Array.isArray(result.pageErrors) ? result.pageErrors : []) {
    events.push(runtimeEvent('error', 'ui-interaction-page-error', item.message || 'UI interaction page error', item.sourceId || '', { line: item.line, source: 'ui-interaction-closure' }))
  }
  for (const item of Array.isArray(result.consoleErrors) ? result.consoleErrors : []) {
    events.push(runtimeEvent('error', 'ui-interaction-console-error', item.message || 'UI interaction console error', item.sourceId || '', { line: item.line, source: 'ui-interaction-closure' }))
  }
  return events
}

function collectStaticHtmlRuntimeEvents(target = {}, options = {}) {
  if (!target.html_path || !fs.existsSync(target.html_path)) return []
  let content = ''
  try { content = fs.readFileSync(target.html_path, 'utf8') } catch (_) { return [] }
  const events = []
  for (const match of content.matchAll(/console\.error\s*\(\s*(['"`])([\s\S]{0,240}?)\1/g)) {
    events.push(runtimeEvent('warning', 'static-browser-console-error', match[2], target.html_path, {
      line: content.slice(0, match.index).split(/\r\n|\r|\n/).length,
      source: 'runtime-closure-static'
    }))
  }
  for (const match of content.matchAll(/\b([A-Za-z_$][\w$]*)\s*\(\s*\)/g)) {
    const name = match[1]
    const before = content.slice(Math.max(0, match.index - 160), match.index)
    if (/function\s+$|function\s+[A-Za-z_$][\w$]*\s*$|=>\s*$|\.|\b(if|for|while|switch|catch)\s*$/.test(before)) continue
    if (new RegExp(`function\\s+${name}\\s*\\(|(?:const|let|var)\\s+${name}\\s*=|${name}\\s*:\\s*function`).test(content)) continue
    events.push(runtimeEvent('error', 'static-browser-reference-error', `${name} is called but no local definition was found in this HTML.`, target.html_path, {
      line: content.slice(0, match.index).split(/\r\n|\r|\n/).length,
      source: 'runtime-closure-static'
    }))
  }
  for (const match of content.matchAll(/addEventListener\s*\(\s*['"`](click|change|input)['"`][\s\S]{0,500}?\bthrow\s+new\s+([A-Za-z_$][\w$]*)\s*\(([\s\S]{0,160}?)\)/g)) {
    events.push(runtimeEvent('error', 'static-ui-interaction-throws', `Event handler throws ${match[2]} during ${match[1]} interaction.`, match[0].replace(/\s+/g, ' ').slice(0, 260), {
      line: content.slice(0, match.index).split(/\r\n|\r|\n/).length,
      source: 'runtime-closure-static'
    }))
  }
  for (const check of Array.isArray(options.ui_checks || options.uiChecks) ? (options.ui_checks || options.uiChecks) : []) {
    const expected = String(check.expected_visible_selector || check.expectedVisibleSelector || '').trim()
    const click = String(check.click_selector || check.clickSelector || '').trim()
    if (!expected || !click) continue
    const expectedId = expected.match(/^#([A-Za-z0-9_-]+)$/)?.[1]
    if (!expectedId) continue
    const expectedOpenRule = new RegExp(`#${expectedId}\\.(?:open|show|active)|\\.(?:open|show|active)\\s+#${expectedId}`)
    if (expectedOpenRule.test(content)) continue
    events.push(runtimeEvent('warning', 'static-ui-expected-state-rule-missing', `Expected visible selector ${expected} has no obvious open/show/active CSS state rule in this HTML.`, `${click} -> ${expected}`, {
      source: 'runtime-closure-static'
    }))
  }
  return events
}

async function runRuntimeClosure(projectPath = '', options = {}, runtimeProbe = {}) {
  const target = resolveRuntimeTarget(projectPath, options, runtimeProbe)
  if (!target) {
    return {
      success: true,
      ok: true,
      skipped: true,
      events: [],
      message: 'runtime closure skipped: no runtime_url/html_path and no localhost URL found in runtime probe output'
    }
  }

  const resolvePath = input => {
    if (!input) return input
    return path.isAbsolute(input) ? input : path.resolve(projectPath, input)
  }

  let browser = null
  try {
    browser = await researchWebsiteRuntime({
      url: target.url,
      delay_ms: options.browser_delay_ms || options.browserDelayMs || 500,
      scroll_samples: 1,
      include_assets: true,
      include_source: false,
      include_screenshots: false,
      same_origin_only: true,
      viewport_width: options.viewport_width || options.viewportWidth || 1280,
      viewport_height: options.viewport_height || options.viewportHeight || 800
    }, resolvePath)
  } catch (error) {
    browser = { success: false, error: error.message, consoleMessages: [], pageErrors: [], resources: [] }
  }

  const events = collectBrowserEvents(browser)
  if (browser.success === false) {
    events.push(runtimeEvent('warning', 'browser-runtime-unavailable', browser.error || 'Browser runtime closure unavailable', target.url, { source: 'runtime-closure' }))
    events.push(...collectStaticHtmlRuntimeEvents(target, options))
  }
  const interactionResults = []
  const checks = Array.isArray(options.ui_checks || options.uiChecks) ? (options.ui_checks || options.uiChecks) : []
  for (const check of checks.slice(0, 6)) {
    let interaction = null
    try {
      interaction = await runtimeVerify({
        runtime_url: check.runtime_url || check.runtimeUrl || check.url || target.url,
        interaction: {
          ...check,
          wait_after_click_ms: check.wait_after_click_ms || check.waitAfterClickMs || 300
        },
        observe_ms: check.observe_ms || check.observeMs || 800
      }, { resolvePath, projectId: options.projectId || null })
    } catch (error) {
      interaction = { success: false, unavailable: true, error: error.message, failures: [], pageErrors: [], consoleErrors: [] }
    }
    interactionResults.push(interaction)
    events.push(...collectInteractionEvents(interaction))
  }

  return {
    success: true,
    ok: events.filter(item => item.severity === 'error').length === 0,
    target,
    browser: {
      success: browser.success,
      target: browser.target,
      error: browser.error,
      title: browser.summary?.title || '',
      consoleMessages: browser.consoleMessages,
      pageErrors: browser.pageErrors,
      resources: browser.resources
    },
    ui_interactions: interactionResults,
    events,
    message: events.length
      ? `runtime closure captured ${events.length} browser/runtime issue(s)`
      : 'runtime closure captured no browser/runtime issues'
  }
}

module.exports = {
  runRuntimeClosure,
  resolveRuntimeTarget,
  collectBrowserEvents,
  collectInteractionEvents
}
