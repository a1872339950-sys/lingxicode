const path = require('path')
const fs = require('fs')
const { Worker, isMainThread } = require('worker_threads')
const runtimeDiagnostics = require('./runtime-diagnostics')
const { traceUiRootCause } = require('./ui-root-cause-tracer')

const HEALTH_SCAN_CAPABILITY_TYPES = Object.freeze([
  'syntax-error',
  'runtime-diagnostic',
  'runtime-probe-event',
  'runtime-configured-port-listening-port-drift',
  'runtime-closure-event',
  'project-log-runtime-error',
  'missing-ipc-handler',
  'preload-exposes-missing-ipc-handler',
  'renderer-event-without-listener',
  'dom-css-state-owner-mismatch',
  'env-var-name-drift',
  'boolean-default-swallows-explicit-value',
  'numeric-default-swallows-zero',
  'event-listener-cleanup-different-function-reference',
  'commonjs-circular-require-top-level-read',
  'configured-port-arithmetic-drift',
  'async-foreach-not-awaited',
  'array-fill-shared-reference',
  'python-mutable-default-argument',
  'promise-race-timeout-without-cancellation',
  'response-body-consumed-twice',
  'go-detached-goroutine-ignores-request-context',
  'go-background-loop-without-cancellation',
  'duplicate-yaml-key-overrides-value',
  'shell-command-string-interpolation-risk',
  'non-atomic-state-file-write',
  'utc-date-used-for-local-day-key',
  'python-lock-release-without-finally',
  'python-http-request-without-timeout',
  'object-merge-without-prototype-key-guard',
  'user-controlled-regexp-without-escaping',
  'path-join-user-segment-without-boundary-check',
  'open-redirect-without-target-validation',
  'duplicate-api-route-registration',
  'server-side-request-without-url-allowlist',
  'cors-wildcard-origin-with-credentials',
  'transaction-commit-without-rollback-path',
  'predictable-temp-file-path',
  'payment-or-quota-mutation-without-idempotency-key',
  'sensitive-data-logged',
  'jwt-decoded-without-signature-verification',
  'react-dangerous-html-from-dynamic-content',
  'env-boolean-string-truthiness-risk',
  'weak-random-token-generation',
  'static-iv-or-salt-for-encryption',
  'localstorage-json-parse-without-fallback',
  'async-persistence-call-not-awaited',
  'admin-route-without-obvious-authorization',
  'interval-async-callback-without-reentry-guard',
  'await-io-inside-loop',
  'abort-controller-created-but-signal-not-used',
  'upload-middleware-without-size-limit',
  'unused-css-selector-candidate',
  'dom-query-without-matching-markup',
  'duplicate-feature-surface-candidate',
  'duplicate-function-name-across-files',
  'legacy-disabled-code-candidate'
])

function normalizeSeverity(value = '') {
  const text = String(value || '').toLowerCase()
  if (['critical', 'fatal', 'error', 'high'].includes(text)) return 'error'
  if (['warn', 'warning', 'medium'].includes(text)) return 'warning'
  return 'info'
}

function severityWeight(value = '') {
  const severity = normalizeSeverity(value)
  if (severity === 'error') return 3
  if (severity === 'warning') return 2
  return 1
}

function clip(value = '', max = 360) {
  const text = String(value == null ? '' : value)
  return text.length > max ? `${text.slice(0, max)}...[truncated ${text.length - max} chars]` : text
}

function pushFinding(findings, item = {}) {
  if (!item.type && !item.message) return
  findings.push({
    severity: normalizeSeverity(item.severity),
    type: item.type || 'project-health-risk',
    category: item.category || 'logic',
    path: item.path || '',
    line: item.line || null,
    message: clip(item.message || ''),
    evidence: clip(item.evidence || item.detail || ''),
    suggestion: clip(item.suggestion || ''),
    source: item.source || '',
    confidence: item.confidence || '',
    verification_status: item.verification_status || '',
    counter_evidence: Array.isArray(item.counter_evidence) ? item.counter_evidence.map(value => clip(value, 180)).slice(0, 6) : []
  })
}

function findMatchingBrace(content = '', openIndex = 0) {
  let depth = 0
  let quote = ''
  let escaped = false
  for (let index = openIndex; index < content.length; index += 1) {
    const char = content[index]
    if (quote) {
      if (escaped) escaped = false
      else if (char === '\\') escaped = true
      else if (char === quote) quote = ''
      continue
    }
    if (char === '"' || char === "'" || char === '`') {
      quote = char
      continue
    }
    if (char === '{') depth += 1
    else if (char === '}') {
      depth -= 1
      if (depth === 0) return index
    }
  }
  return -1
}

function collectJsCatchBlocks(content = '') {
  const blocks = []
  const pattern = /catch\s*(?:\([^)]*\))?\s*\{/g
  let match
  while ((match = pattern.exec(content)) !== null) {
    const openIndex = content.indexOf('{', match.index)
    const closeIndex = findMatchingBrace(content, openIndex)
    if (closeIndex <= openIndex) continue
    blocks.push({
      index: match.index,
      content: content.slice(match.index, closeIndex + 1)
    })
    pattern.lastIndex = closeIndex + 1
  }
  return blocks
}

function collectPythonExceptBlocks(content = '') {
  const blocks = []
  const lines = String(content || '').split(/\r\n|\r|\n/)
  let offset = 0
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    const match = line.match(/^(\s*)except\b[^:]*:/)
    const lineStart = offset
    offset += line.length + 1
    if (!match) continue
    const indent = match[1].length
    const blockLines = [line]
    for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
      const next = lines[cursor]
      if (next.trim() && (next.match(/^\s*/)?.[0].length || 0) <= indent) break
      blockLines.push(next)
    }
    blocks.push({ index: lineStart, content: blockLines.join('\n') })
  }
  return blocks
}

function collectBodyConsumptionFindings(content = '', rel = '', findings = []) {
  const calls = []
  const pattern = /\b([A-Za-z_$][\w$]*)\.(text|json|arrayBuffer|blob|formData)\s*\(\s*\)/g
  for (const match of content.matchAll(pattern)) {
    if (!/(response|resp|upstream|body|stream|imageResponse|videoResponse|res)$/i.test(match[1])) continue
    calls.push({
      variable: match[1],
      method: match[2],
      index: match.index,
      end: match.index + match[0].length,
      evidence: match[0]
    })
  }

  for (let left = 0; left < calls.length; left += 1) {
    for (let right = left + 1; right < calls.length; right += 1) {
      const first = calls[left]
      const second = calls[right]
      if (first.variable !== second.variable) continue
      const between = content.slice(first.end, second.index)
      if (/\b(?:return|throw|continue|break)\b/.test(between)) continue
      const escapedVariable = first.variable.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const reassignedSameVariable = new RegExp(`(?:\\b(?:let|const|var)\\s+${escapedVariable}\\b|\\b${escapedVariable}\\s*=\\s*(?:await\\s+)?(?:fetch|fetchWithTimeout|axios\\.|request\\(|got\\(|http\\.|https\\.|client\\.))`).test(between)
      if (reassignedSameVariable) continue
      if (new RegExp(`\\b${escapedVariable}\\s*=\\s*await\\b`).test(between)) continue
      const branchThenRetry = /\bif\s*\([^)]*!\s*[^)]*\.ok[^)]*\)\s*\{/.test(content.slice(Math.max(0, first.index - 500), first.index)) &&
        /\b(?:fetch|fetchWithTimeout|axios\.|request\(|got\(|http\.|https\.|client\.)/.test(between)
      if (branchThenRetry) continue
      if (between.length > 700) break
      pushFinding(findings, {
        severity: 'error',
        category: 'runtime',
        type: 'response-body-consumed-twice',
        path: rel,
        line: findLineNumber(content, first.index),
        message: `Response/body stream "${first.variable}" appears to be consumed twice (${first.method} then ${second.method}) on the same execution path.`,
        evidence: content.slice(first.index, Math.min(content.length, second.end)).replace(/\s+/g, ' ').slice(0, 260),
        suggestion: 'Read the body once, then parse the captured text/buffer, or clone the response before consuming it.',
        source: 'stream-body-lifecycle-scan'
      })
      break
    }
  }
}

function summarizeRuntime(options = {}) {
  try {
    const result = runtimeDiagnostics.summarize(options)
    return result && typeof result === 'object'
      ? result
      : { success: false, ok: false, error_count: 0, warning_count: 0, events: [], error: 'runtime diagnostics returned invalid result' }
  } catch (error) {
    return {
      success: false,
      ok: false,
      unavailable: true,
      error_count: 0,
      warning_count: 0,
      events: [],
      error: error.message
    }
  }
}

function collectRuntimeFindings(runtime = {}, findings = []) {
  for (const event of Array.isArray(runtime.events) ? runtime.events : []) {
    pushFinding(findings, {
      severity: event.severity,
      category: 'runtime',
      type: event.type || 'runtime-diagnostic',
      path: event.sourceId || event.url || '',
      line: event.line || null,
      message: event.message || '',
      evidence: [event.source, event.title, event.url].filter(Boolean).join(' | '),
      suggestion: 'Use this runtime/F12/main-process message as evidence, then trace the matching caller, DOM, IPC, or backend boundary.',
      source: 'runtime-diagnostics'
    })
  }
}

function collectRuntimeProbeFindings(runtimeProbe = {}, findings = []) {
  runtimeProbe = runtimeProbe && typeof runtimeProbe === 'object' ? runtimeProbe : {}
  for (const event of Array.isArray(runtimeProbe.events) ? runtimeProbe.events : []) {
    pushFinding(findings, {
      ...event,
      severity: event.severity || 'error',
      category: 'runtime',
      source: event.source || 'runtime-probe'
    })
  }
  const probeText = [
    runtimeProbe.output_tail,
    runtimeProbe.stdout_tail,
    runtimeProbe.stderr_tail,
    runtimeProbe.output,
    runtimeProbe.stdout,
    runtimeProbe.stderr
  ].filter(Boolean).join('\n')
  for (const match of probeText.matchAll(/configured\s+port\s+(\d{2,5})[\s\S]{0,120}?listening\s+at\s+https?:\/\/[^:\s]+:(\d{2,5})/gi)) {
    if (match[1] === match[2]) continue
    pushFinding(findings, {
      severity: 'error',
      category: 'runtime',
      type: 'runtime-configured-port-listening-port-drift',
      message: `Runtime says configured port is ${match[1]}, but the process is actually listening on ${match[2]}.`,
      evidence: match[0].replace(/\s+/g, ' ').slice(0, 260),
      suggestion: 'Bind to the configured port or publish the actual port consistently; otherwise browser/F12 checks can attach to the wrong process.',
      source: 'runtime-probe-port-drift'
    })
  }
  if (runtimeProbe.success === false && runtimeProbe.error) {
    pushFinding(findings, {
      severity: 'warning',
      category: 'runtime',
      type: 'runtime-probe-unavailable',
      message: runtimeProbe.error,
      evidence: runtimeProbe.command || '',
      suggestion: 'Verify runtime_command/project_path or run health without launch_if_needed.',
      source: 'runtime-probe'
    })
  }
}

function collectRuntimeClosureFindings(runtimeClosure = {}, findings = []) {
  runtimeClosure = runtimeClosure && typeof runtimeClosure === 'object' ? runtimeClosure : {}
  for (const event of Array.isArray(runtimeClosure.events) ? runtimeClosure.events : []) {
    pushFinding(findings, {
      ...event,
      severity: event.severity || 'error',
      category: 'runtime',
      source: event.source || 'runtime-closure'
    })
  }
  if (runtimeClosure.success === false && runtimeClosure.error) {
    pushFinding(findings, {
      severity: 'warning',
      category: 'runtime',
      type: 'runtime-closure-unavailable',
      message: runtimeClosure.error,
      evidence: runtimeClosure.target?.url || '',
      suggestion: 'Verify runtime_url/html_path/ui_checks and rerun health with runtime_closure enabled.',
      source: 'runtime-closure'
    })
  }
}

function collectProjectLogRuntimeFindings(projectPath = '', findings = []) {
  if (!projectPath || !fs.existsSync(projectPath)) return
  const candidates = []
  for (const name of ['electron-runtime.err.log', 'electron-runtime.out.log', 'runtime.err.log', 'runtime.log', 'error.log']) {
    const filePath = path.join(projectPath, name)
    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) candidates.push(filePath)
  }
  for (const dirName of ['logs', 'log']) {
    const dir = path.join(projectPath, dirName)
    if (!fs.existsSync(dir)) continue
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).slice(0, 30)) {
      if (entry.isFile() && /\.(log|txt)$/i.test(entry.name)) candidates.push(path.join(dir, entry.name))
    }
  }

  for (const filePath of candidates.slice(0, 20)) {
    let content = ''
    try { content = fs.readFileSync(filePath, 'utf8') } catch (_) { continue }
    const lines = content.split(/\r\n|\r|\n/)
    lines.forEach((line, index) => {
      if (!/(ReferenceError|TypeError|SyntaxError|UnhandledPromiseRejection|uncaughtException|unhandledRejection|ERR_|Error:)/i.test(line)) return
      pushFinding(findings, {
        severity: 'error',
        category: 'runtime',
        type: 'project-runtime-log-error',
        path: toProjectRelative(projectPath, filePath),
        line: index + 1,
        message: line.trim(),
        evidence: lines.slice(Math.max(0, index - 1), Math.min(lines.length, index + 3)).join('\n'),
        suggestion: 'Trace this project log error to the referenced file/stack before relying on syntax-only verification.',
        source: 'project-log-scan'
      })
    })
  }
}

function collectSyntaxFindings(syntax = {}, findings = []) {
  if (syntax && syntax.ok === false && Number(syntax.checked_count || 0) === 0) {
    pushFinding(findings, {
      severity: 'error',
      category: 'syntax',
      type: 'syntax-scan-empty',
      path: '',
      message: syntax.error || syntax.message || 'Project syntax scan found 0 checkable files.',
      evidence: Array.isArray(syntax.roots) ? syntax.roots.join(', ') : '',
      suggestion: syntax.next_action || 'Verify the project_path before claiming no errors.',
      source: 'check_project_syntax'
    })
  }
  for (const file of Array.isArray(syntax.failed_files) ? syntax.failed_files : []) {
    const firstError = Array.isArray(file.errors) ? file.errors[0] : null
    pushFinding(findings, {
      severity: 'error',
      category: 'syntax',
      type: 'syntax-error',
      path: file.relative_path || file.path || '',
      line: firstError?.line || firstError?.loc?.line || null,
      message: firstError?.message || 'Syntax check failed.',
      evidence: file.code_frame?.content || '',
      suggestion: file.repair_hint?.message || 'Fix the syntax error from code_frame/repair_hint, then rerun dev_workflow mode=health.',
      source: 'check_project_syntax'
    })
    for (const warning of Array.isArray(file.warnings) ? file.warnings : []) {
      const message = typeof warning === 'string' ? warning : warning?.message
      pushFinding(findings, {
        severity: 'warning',
        category: 'syntax',
        type: 'syntax-warning',
        path: file.relative_path || file.path || '',
        line: typeof warning === 'object' ? warning.line || null : null,
        message: message || 'Syntax checker warning.',
        evidence: file.code_frame?.content || '',
        suggestion: 'Use this warning to find the likely root cause of the syntax error.',
        source: 'check_project_syntax'
      })
    }
  }
}

function collectLogicFindings(logicReview = {}, findings = []) {
  for (const item of Array.isArray(logicReview.findings) ? logicReview.findings : []) {
    const type = String(item.type || '')
    let category = 'logic'
    if (/ui|dom|class|selector|css/i.test(type)) category = 'dom-css'
    else if (/path|storage|prefix|project-path/i.test(type)) category = 'path'
    else if (/replay|state|cache|visibility|awaiting/i.test(type)) category = 'state'
    else if (/\b(?:ipc|preload|invoke|contextbridge)\b|ipc-|^ipc/i.test(type)) category = 'ipc'
    pushFinding(findings, {
      ...item,
      category,
      source: 'logic_review'
    })
  }
}

function collectUiRuntimeVerificationFindings(logicReview = {}, findings = []) {
  const adviceList = Array.isArray(logicReview.ui_behavior_verification)
    ? logicReview.ui_behavior_verification
    : []
  for (const advice of adviceList) {
    const source = advice.source || {}
    pushFinding(findings, {
      severity: 'warning',
      category: 'runtime',
      type: 'ui-runtime-verification-required',
      path: source.path || '',
      line: source.line || null,
      message: 'UI state risk needs executable click verification; syntax/static checks are not enough for click-no-response, dropdown, menu, or modal bugs.',
      evidence: JSON.stringify({
        target_selector: advice.target_selector,
        selector_owner: advice.selector_owner,
        suggested_click_selectors: advice.suggested_click_selectors
      }),
      suggestion: `Call runtime_verify with suggested interaction args against the registered development runtime, then verify open, keep-visible, close, repeat-open, effectiveVisible, hiddenBy, ancestorChain, clippingAncestor, occludedBy, computed style, and console/page errors. Pass runtime_id only when candidates are ambiguous.`,
      source: 'ui-behavior-verification'
    })
  }
}

function collectIpcContractFindings(projectPath = '', findings = [], options = {}) {
  const roots = [
    path.join(projectPath, 'electron'),
    path.join(projectPath, 'frontend')
  ]
  const files = []
  for (const root of roots) collectFiles(root, files, projectPath, new Set(['.js', '.mjs', '.cjs', '.html']))
  const handlers = new Map()
  const invokes = []
  const exposedInvokes = []
  const rendererEvents = []
  const rendererListeners = new Map()

  const scanFiles = options.full === true || options.fullScan === true ? files : files.slice(0, 1200)
  for (const filePath of scanFiles) {
    let content = ''
    try { content = fs.readFileSync(filePath, 'utf8') } catch (_) { continue }
    const rel = toProjectRelative(projectPath, filePath)
    for (const match of content.matchAll(/ipcMain\.(?:handle|on)\(\s*['"`]([^'"`]+)['"`]/g)) {
      handlers.set(match[1], { path: rel, line: findLineNumber(content, match.index) })
    }
    for (const match of content.matchAll(/(?:ipcRenderer|window\.[A-Za-z_$][\w$]*)\.(?:invoke|send)\(\s*['"`]([^'"`]+)['"`]/g)) {
      invokes.push({ channel: match[1], path: rel, line: findLineNumber(content, match.index), evidence: match[0] })
    }
    for (const match of content.matchAll(/webContents(?:\?\.)?\.send\(\s*['"`]([^'"`]+)['"`]|(?:event\.sender|sender|mainWindow\.webContents|webContents)\.send\(\s*['"`]([^'"`]+)['"`]/g)) {
      rendererEvents.push({ channel: match[1] || match[2], path: rel, line: findLineNumber(content, match.index), evidence: match[0] })
    }
    for (const match of content.matchAll(/(?:ipcRenderer|window\.[A-Za-z_$][\w$]*|window\.api)\.(?:on|once)(?:\?\.)?\s*\(\s*['"`]([^'"`]+)['"`]/g)) {
      rendererListeners.set(match[1], { path: rel, line: findLineNumber(content, match.index), evidence: match[0] })
    }
    for (const match of content.matchAll(/(?:invoke|send)\(\s*['"`]([^'"`]+)['"`]/g)) {
      if (/preload|bridge/i.test(rel)) {
        exposedInvokes.push({ channel: match[1], path: rel, line: findLineNumber(content, match.index), evidence: match[0] })
      }
    }
  }

  for (const call of invokes) {
    if (handlers.has(call.channel)) continue
    const similar = findSimilarChannel(call.channel, [...handlers.keys()])
    pushFinding(findings, {
      severity: 'warning',
      category: 'ipc',
      type: 'ipc-channel-without-handler',
      path: call.path,
      line: call.line,
      message: `IPC call "${call.channel}" has no ipcMain.handle/on match in scanned production files.`,
      evidence: similar ? `${call.evidence} | similar registered channel: ${similar}` : call.evidence,
      suggestion: similar
        ? `This may be a typo of "${similar}". Verify channel spelling across frontend/preload/main.`
        : 'Verify preload/frontend channel spelling and register the matching ipcMain handler, or remove stale caller.',
      source: 'ipc-contract-scan'
    })
  }

  for (const event of rendererEvents) {
    if (rendererListeners.has(event.channel)) continue
    pushFinding(findings, {
      severity: 'warning',
      category: 'ipc',
      type: 'renderer-event-without-listener',
      path: event.path,
      line: event.line,
      message: `Renderer event "${event.channel}" is sent from the main process, but no renderer listener was found in scanned files.`,
      evidence: event.evidence,
      suggestion: 'Verify the renderer registers ipcRenderer/window.api.on for this event, or remove stale webContents.send usage.',
      source: 'ipc-contract-scan'
    })
  }

  for (const call of exposedInvokes) {
    if (handlers.has(call.channel)) continue
    pushFinding(findings, {
      severity: 'warning',
      category: 'ipc',
      type: 'preload-exposes-missing-ipc-handler',
      path: call.path,
      line: call.line,
      message: `Preload exposes IPC channel "${call.channel}" but no main-process handler was found.`,
      evidence: call.evidence,
      suggestion: 'Trace contextBridge API -> ipcRenderer channel -> ipcMain registration before claiming the UI action works.',
      source: 'ipc-contract-scan'
    })
  }
}

function collectGenericSourceFiles(projectPath = '', options = {}) {
  const files = []
  const exts = new Set([
    '.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx',
    '.py', '.go', '.java', '.cs', '.php', '.rb', '.rs', '.kt', '.swift',
    '.cpp', '.cc', '.cxx', '.c', '.h', '.hpp',
    '.sql', '.graphql', '.gql',
    '.json', '.yaml', '.yml', '.toml', '.ini', '.env',
    '.sh', '.ps1', '.bat', '.cmd', '.dockerfile'
  ])
  collectFiles(projectPath, files, projectPath, exts)
  const uniqueFiles = [...new Set(files)]
  return options.full === true || options.fullScan === true ? uniqueFiles : uniqueFiles.slice(0, 2500)
}

function normalizeTokenName(value = '') {
  return String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '')
}

function collectEnvDefinitions(files = [], projectPath = '') {
  const defs = new Map()
  for (const filePath of files) {
    const base = path.basename(filePath).toLowerCase()
    if (!base.startsWith('.env')) continue
    let content = ''
    try { content = fs.readFileSync(filePath, 'utf8') } catch (_) { continue }
    for (const match of content.matchAll(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/gm)) {
      const name = match[1]
      defs.set(name, {
        name,
        path: toProjectRelative(projectPath, filePath),
        line: findLineNumber(content, match.index)
      })
    }
  }
  return defs
}

function collectCommonJsRequireEdges(files = [], projectPath = '') {
  const byFile = new Map()
  const edges = []
  const jsFiles = new Set(files.filter(file => ['.js', '.cjs'].includes(path.extname(file).toLowerCase())).map(file => path.resolve(file)))
  for (const filePath of jsFiles) {
    let content = ''
    try { content = fs.readFileSync(filePath, 'utf8') } catch (_) { continue }
    const rel = toProjectRelative(projectPath, filePath)
    byFile.set(path.resolve(filePath), { content, rel })
    for (const match of content.matchAll(/(?:const|let|var)\s+(?:\{([^}]+)\}|([A-Za-z_$][\w$]*))\s*=\s*require\(\s*['"](\.[^'"]+)['"]\s*\)|require\(\s*['"](\.[^'"]+)['"]\s*\)/g)) {
      const request = match[3] || match[4] || ''
      let target = path.resolve(path.dirname(filePath), request)
      if (!path.extname(target)) {
        const candidate = ['.js', '.cjs', '.mjs'].map(ext => `${target}${ext}`).find(item => jsFiles.has(path.resolve(item)))
        if (candidate) target = candidate
      }
      target = path.resolve(target)
      if (!jsFiles.has(target)) continue
      const importedNames = []
      const destructured = match[1] || ''
      if (destructured) {
        for (const part of destructured.split(',')) {
          const name = part.split(':').pop().trim()
          if (/^[A-Za-z_$][\w$]*$/.test(name)) importedNames.push(name)
        }
      } else if (match[2]) importedNames.push(match[2])
      edges.push({
        from: path.resolve(filePath),
        to: target,
        line: findLineNumber(content, match.index),
        evidence: match[0].replace(/\s+/g, ' ').slice(0, 220),
        importedNames
      })
    }
  }
  return { byFile, edges }
}

function collectCrossFileLogicFindings(projectPath = '', files = [], findings = []) {
  const envDefs = collectEnvDefinitions(files, projectPath)
  const normalizedEnvDefs = new Map()
  for (const def of envDefs.values()) {
    const key = normalizeTokenName(def.name)
    if (!normalizedEnvDefs.has(key)) normalizedEnvDefs.set(key, [])
    normalizedEnvDefs.get(key).push(def)
  }

  for (const filePath of files) {
    const ext = path.extname(filePath).toLowerCase()
    if (!['.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx', '.py', '.go', '.java', '.cs', '.php', '.rb', '.rs', '.kt', '.swift'].includes(ext)) continue
    let content = ''
    try { content = fs.readFileSync(filePath, 'utf8') } catch (_) { continue }
    const rel = toProjectRelative(projectPath, filePath)

    for (const match of content.matchAll(/process\.env\.([A-Za-z_][A-Za-z0-9_]*)|process\.env\[['"]([A-Za-z_][A-Za-z0-9_]*)['"]\]/g)) {
      const used = match[1] || match[2]
      if (envDefs.has(used)) continue
      const candidates = normalizedEnvDefs.get(normalizeTokenName(used)) || []
      const close = candidates[0] || (used.length >= 8 ? [...envDefs.values()]
        .map(def => ({ def, distance: levenshtein(used, def.name) }))
        .filter(item => {
          const maxLength = Math.max(used.length, item.def.name.length)
          const commonPrefix = used.split('').findIndex((char, index) => char !== item.def.name[index])
          const prefixLength = commonPrefix === -1 ? Math.min(used.length, item.def.name.length) : commonPrefix
          return item.distance <= Math.max(2, Math.floor(maxLength * 0.18)) && prefixLength >= 4
        })
        .sort((a, b) => a.distance - b.distance)[0]?.def
        : null)
      if (!close) continue
      pushFinding(findings, {
        severity: 'error',
        category: 'config',
        type: 'env-var-name-drift',
        path: rel,
        line: findLineNumber(content, match.index),
        message: `Code reads environment variable "${used}", but a very similar variable "${close.name}" is defined in ${close.path}.`,
        evidence: `${match[0]} | defined ${close.name} at ${close.path}:${close.line}`,
        suggestion: 'Align the env variable name exactly, or intentionally document both names with a migration fallback.',
        source: 'config-env-contract-scan'
      })
    }
  }

  const { byFile, edges } = collectCommonJsRequireEdges(files, projectPath)
  const edgeMap = new Map()
  for (const edge of edges) edgeMap.set(`${edge.from}->${edge.to}`, edge)
  const reportedCycles = new Set()
  for (const edge of edges) {
    const back = edgeMap.get(`${edge.to}->${edge.from}`)
    if (!back) continue
    const key = [edge.from, edge.to].sort().join('<->')
    if (reportedCycles.has(key)) continue
    reportedCycles.add(key)
    const fromMeta = byFile.get(edge.from)
    const toMeta = byFile.get(edge.to)
    const importedNames = [...new Set([...(edge.importedNames || []), ...(back.importedNames || [])])].filter(Boolean)
    const topLevelRead = importedNames.some(name => {
      const fromIndex = fromMeta?.content.indexOf(`require(`) ?? -1
      const exportIndex = fromMeta?.content.indexOf('module.exports')
      const area = fromMeta?.content.slice(Math.max(0, fromIndex), exportIndex > 0 ? exportIndex : 900) || ''
      const peerIndex = toMeta?.content.indexOf(`require(`) ?? -1
      const peerExportIndex = toMeta?.content.indexOf('module.exports')
      const peerArea = toMeta?.content.slice(Math.max(0, peerIndex), peerExportIndex > 0 ? peerExportIndex : 900) || ''
      return new RegExp(`\\b${name}\\s*(?:\\(|\\.)`).test(area) || new RegExp(`\\b${name}\\s*(?:\\(|\\.)`).test(peerArea)
    })
    pushFinding(findings, {
      severity: topLevelRead ? 'error' : 'warning',
      category: 'logic',
      type: topLevelRead ? 'commonjs-circular-require-top-level-read' : 'commonjs-circular-require',
      path: fromMeta?.rel || toProjectRelative(projectPath, edge.from),
      line: edge.line,
      message: `CommonJS circular require detected between ${fromMeta?.rel || edge.from} and ${toMeta?.rel || edge.to}${topLevelRead ? ', with an imported value read during module initialization.' : '.'}`,
      evidence: `${edge.evidence} | ${back.evidence}`,
      suggestion: 'Break the cycle with a third module, lazy getter, dependency injection, or move top-level reads into a function after both modules initialize.',
      source: 'commonjs-cycle-scan'
    })
  }
}

function collectGenericLogicFindings(projectPath = '', findings = [], options = {}) {
  const files = collectGenericSourceFiles(projectPath, options)
  collectCrossFileLogicFindings(projectPath, files, findings)
  for (const filePath of files) {
    let content = ''
    try { content = fs.readFileSync(filePath, 'utf8') } catch (_) { continue }
    const rel = toProjectRelative(projectPath, filePath)
    const ext = path.extname(filePath).toLowerCase()

    for (const match of content.matchAll(/[\u200B-\u200D\uFEFF\u202A-\u202E\u2066-\u2069]/g)) {
      if (match.index === 0 && match[0] === '\uFEFF') continue
      pushFinding(findings, {
        severity: 'error',
        category: 'security',
        type: 'invisible-unicode-control-character',
        path: rel,
        line: findLineNumber(content, match.index),
        message: 'Invisible Unicode/control character found in source; it can hide auth, routing, identifier, or string differences during review.',
        evidence: `U+${match[0].codePointAt(0).toString(16).toUpperCase().padStart(4, '0')}`,
        suggestion: 'Remove or escape the character explicitly, then review nearby identifiers/strings for spoofing or logic drift.',
        source: 'unicode-safety-scan'
      })
    }
    for (const match of content.matchAll(/\\u(?:200[b-d]|feff|202[a-e]|206[6-9])/gi)) {
      pushFinding(findings, {
        severity: 'warning',
        category: 'security',
        type: 'escaped-unicode-control-character',
        path: rel,
        line: findLineNumber(content, match.index),
        message: 'Escaped Unicode/control character appears in source; at runtime it can become an invisible/spoofing character.',
        evidence: match[0],
        suggestion: 'Avoid hidden Unicode in identifiers, roles, route keys, and auth/cache strings unless explicitly documented and tested.',
        source: 'unicode-safety-scan'
      })
    }

    for (const block of collectJsCatchBlocks(content)) {
      if (!/(return|resolve)\s*(?:\(\s*)?\{[\s\S]{0,180}success\s*:\s*true/i.test(block.content)) continue
      pushFinding(findings, {
        severity: 'error',
        category: 'logic',
        type: 'failure-swallowed-as-success',
        path: rel,
        line: findLineNumber(content, block.index),
        message: 'A failure handler returns success:true, which can hide real errors as successful completion.',
        evidence: block.content.replace(/\s+/g, ' ').slice(0, 260),
        suggestion: 'Return success:false/error status, preserve the original error, and avoid generic success fallback messages.',
        source: 'generic-error-contract-scan'
      })
    }

    for (const block of collectPythonExceptBlocks(content)) {
      if (!/return\s+\{[\s\S]{0,180}["']success["']\s*:\s*True/.test(block.content)) continue
      pushFinding(findings, {
        severity: 'error',
        category: 'logic',
        type: 'failure-swallowed-as-success',
        path: rel,
        line: findLineNumber(content, block.index),
        message: 'A Python except block returns success=True, hiding the real failure from callers.',
        evidence: block.content.replace(/\s+/g, ' ').slice(0, 260),
        suggestion: 'Return success=False or raise/propagate the error with context.',
        source: 'generic-error-contract-scan'
      })
    }

    for (const match of content.matchAll(/\.startswith\s*\(\s*str\s*\(|\.startsWith\s*\(\s*String\s*\(|\.startsWith\s*\(/g)) {
      const nearby = content.slice(Math.max(0, match.index - 140), Math.min(content.length, match.index + 220))
      if (!/(path|dir|file|target|base|root|normalized|normalize)/i.test(nearby)) continue
      pushFinding(findings, {
        severity: 'warning',
        category: 'path',
        type: 'generic-path-prefix-boundary-risk',
        path: rel,
        line: findLineNumber(content, match.index),
        message: 'Path containment appears to use string prefix matching, which can confuse sibling paths with the same prefix.',
        evidence: nearby.replace(/\s+/g, ' ').slice(0, 260),
        suggestion: 'Use path.relative/resolve boundary checks or language-native path APIs instead of string prefix containment.',
        source: 'generic-path-scan'
      })
    }

    for (const match of content.matchAll(/await\s+[^;\n]+[\r\n][\s\S]{0,360}(STATE|state|cache|store|current|render|update|set[A-Z])/g)) {
      const block = match[0]
      if (/(request_id|requestId|project_id|projectId|active|cancel|abort|signal)/.test(block)) continue
      pushFinding(findings, {
        severity: 'warning',
        category: 'state',
        type: 'async-state-update-without-staleness-guard',
        path: rel,
        line: findLineNumber(content, match.index),
        message: 'Async code updates shared state/UI after await without an obvious staleness guard.',
        evidence: block.replace(/\s+/g, ' ').slice(0, 260),
        suggestion: 'Check request/project identity or cancellation after await before mutating shared state or UI.',
        source: 'generic-async-scan'
      })
    }

    for (const match of content.matchAll(/(["']default["']|\bdefault\b)\s*[\]:=,][\s\S]{0,220}(project_id|projectId)/g)) {
      pushFinding(findings, {
        severity: 'warning',
        category: 'state',
        type: 'generic-project-state-default-key-risk',
        path: rel,
        line: findLineNumber(content, match.index),
        message: 'Project-related state appears to use a default/shared key, which can leak state between projects or tenants.',
        evidence: match[0].replace(/\s+/g, ' ').slice(0, 220),
        suggestion: 'Include project/user/tenant identity in the state/cache key.',
        source: 'generic-state-scan'
      })
    }

    for (const match of content.matchAll(/\b([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)?)\s*\|\|\s*(true|false)\b/g)) {
      const nearby = content.slice(Math.max(0, match.index - 180), Math.min(content.length, match.index + 180))
      const fieldName = match[1].split('.').pop()
      if (/(enabled|disabled|free|mode|flag|active|visible|open|allow|deny|can[A-Z]|has[A-Z]|is[A-Z]|should[A-Z])/i.test(fieldName)
        && /\b(process\.env|env|config|settings|options|payload|body|user|model|feature)\b/i.test(nearby)) {
        pushFinding(findings, {
          severity: 'warning',
          category: 'config',
          type: 'boolean-default-swallows-explicit-value',
          path: rel,
          line: findLineNumber(content, match.index),
          message: `Boolean default uses "${match[1]} || ${match[2]}", which can overwrite an explicit false value.`,
          evidence: nearby.replace(/\s+/g, ' ').slice(0, 260),
          suggestion: 'Use nullish coalescing (??) or explicit undefined/null checks so false remains meaningful.',
          source: 'config-default-scan'
        })
      }
    }

    for (const match of content.matchAll(/(?:if\s*\(\s*process\.env\.([A-Za-z_][A-Za-z0-9_]*)\s*\)|process\.env\.([A-Za-z_][A-Za-z0-9_]*)\s*\?\s*[^:]+:|process\.env\.([A-Za-z_][A-Za-z0-9_]*)\s*\|\|\s*(?:true|false))/g)) {
      const name = match[1] || match[2] || match[3] || ''
      if (!/(flag|enabled|disabled|debug|free|mode|allow|deny|feature|use_|enable_|disable_)/i.test(name)) continue
      const nearby = content.slice(Math.max(0, match.index - 180), Math.min(content.length, match.index + 320))
      if (/(===\s*['"]true['"]|!==\s*['"]false['"]|parseBool|parseBoolean|JSON\.parse|toLowerCase\(\)\s*===\s*['"]true['"])/i.test(nearby)) continue
      pushFinding(findings, {
        severity: 'warning',
        category: 'config',
        type: 'env-boolean-string-truthiness-risk',
        path: rel,
        line: findLineNumber(content, match.index),
        message: `Environment variable "${name}" is used as a boolean, but env values are strings; "false" is truthy in JavaScript.`,
        evidence: match[0].replace(/\s+/g, ' ').slice(0, 220),
        suggestion: 'Parse env booleans explicitly, for example value === "true", and keep defaults separate from parsing.',
        source: 'config-env-contract-scan'
      })
    }

    for (const match of content.matchAll(/\b([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)?)\s*\|\|\s*(-?\d+(?:\.\d+)?)\b/g)) {
      const nearby = content.slice(Math.max(0, match.index - 180), Math.min(content.length, match.index + 180))
      const fallbackNumber = Number(match[2])
      const fieldName = match[1].split('.').pop()
      if (fallbackNumber !== 0
        && /(count|limit|max|min|size|port|timeout|retries|attempts|jobs|workers|concurrent|quota|amount|tokens|seconds|millis|ms)/i.test(fieldName)
        && /\b(config|settings)\b/i.test(nearby)) {
        pushFinding(findings, {
          severity: 'warning',
          category: 'config',
          type: 'numeric-default-swallows-zero',
          path: rel,
          line: findLineNumber(content, match.index),
          message: `Numeric default uses "${match[1]} || ${match[2]}", which can overwrite an explicit 0 value.`,
          evidence: nearby.replace(/\s+/g, ' ').slice(0, 260),
          suggestion: 'Use ?? or an explicit Number.isFinite check when 0 is a valid configured value.',
          source: 'config-default-scan'
        })
      }
    }

    for (const match of content.matchAll(/\b([A-Za-z_$][\w$.]*)\.addEventListener\(\s*['"]([^'"]+)['"]\s*,\s*((?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>|function\s*\()/g)) {
      const target = match[1]
      const eventName = match[2]
      const tail = content.slice(match.index + match[0].length, Math.min(content.length, match.index + 1300))
      const removePattern = new RegExp(`${target.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\.removeEventListener\\(\\s*['"]${eventName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"]\\s*,\\s*((?:\\([^)]*\\)|[A-Za-z_$][\\w$]*)\\s*=>|function\\s*\\()`)
      const remove = tail.match(removePattern)
      if (!remove) continue
      pushFinding(findings, {
        severity: 'warning',
        category: 'runtime',
        type: 'event-listener-cleanup-different-function-reference',
        path: rel,
        line: findLineNumber(content, match.index),
        message: `A ${eventName} listener is added with an inline function and removed with a different inline function, so cleanup will not remove the original listener.`,
        evidence: content.slice(match.index, Math.min(content.length, match.index + match[0].length + remove.index + remove[0].length)).replace(/\s+/g, ' ').slice(0, 280),
        suggestion: 'Store the handler in a stable variable and pass the same reference to addEventListener and removeEventListener.',
        source: 'event-lifecycle-scan'
      })
    }

    for (const match of content.matchAll(/\bsetInterval\s*\(\s*async\s*(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>\s*\{[\s\S]{0,900}\}\s*,/g)) {
      const block = match[0]
      if (/(isRunning|inFlight|busy|lock|mutex|clearInterval|AbortController|signal\.aborted|finally\s*\{[\s\S]{0,140}(?:isRunning|inFlight|busy)\s*=\s*false)/i.test(block)) continue
      pushFinding(findings, {
        severity: 'warning',
        category: 'runtime',
        type: 'interval-async-callback-without-reentry-guard',
        path: rel,
        line: findLineNumber(content, match.index),
        message: 'setInterval runs an async callback without an obvious in-flight guard; slow work can overlap and duplicate side effects.',
        evidence: block.replace(/\s+/g, ' ').slice(0, 260),
        suggestion: 'Use a busy/in-flight guard, recursive setTimeout after completion, or cancellation-aware polling.',
        source: 'timer-lifecycle-scan'
      })
    }

    for (const match of content.matchAll(/\bconst\s+([A-Za-z_$][\w$]*Port|port|expectedPort)\s*=\s*[^;\n]+[\r\n][\s\S]{0,220}\bconst\s+([A-Za-z_$][\w$]*Port|actualPort)\s*=\s*\1\s*([+-])\s*(\d+)/g)) {
      pushFinding(findings, {
        severity: 'warning',
        category: 'runtime',
        type: 'configured-port-arithmetic-drift',
        path: rel,
        line: findLineNumber(content, match.index),
        message: `Runtime port "${match[2]}" is derived from configured port "${match[1]}" with arithmetic (${match[3]} ${match[4]}), which can make probes attach to the wrong service.`,
        evidence: match[0].replace(/\s+/g, ' ').slice(0, 260),
        suggestion: 'Use the configured port directly unless the offset is intentional and exposed in logs/config.',
        source: 'runtime-target-scan'
      })
    }

    for (const match of content.matchAll(/\.forEach\s*\(\s*async\s*(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>[\s\S]{0,700}\)/g)) {
      const nearbyAfter = content.slice(match.index + match[0].length, Math.min(content.length, match.index + match[0].length + 260))
      if (/\bPromise\.all\b|\bawait\s+Promise\.all\b/.test(content.slice(Math.max(0, match.index - 180), match.index + match[0].length + 260))) continue
      pushFinding(findings, {
        severity: 'warning',
        category: 'runtime',
        type: 'async-foreach-not-awaited',
        path: rel,
        line: findLineNumber(content, match.index),
        message: 'Array.forEach is used with an async callback; the caller will not await the spawned work or catch its rejection.',
        evidence: (match[0] + nearbyAfter).replace(/\s+/g, ' ').slice(0, 260),
        suggestion: 'Use for...of with await for sequential work, or Promise.all(items.map(async ...)) for parallel work.',
        source: 'async-lifecycle-scan'
      })
    }

    for (const match of content.matchAll(/\.fill\s*\(\s*(\{[\s\S]{0,120}\}|\[[\s\S]{0,120}\]|new\s+(?:Map|Set|Date|URLSearchParams)\s*\([^)]*\))\s*\)/g)) {
      pushFinding(findings, {
        severity: 'warning',
        category: 'state',
        type: 'array-fill-shared-reference',
        path: rel,
        line: findLineNumber(content, match.index),
        message: 'Array.fill receives an object-like value; every slot will share the same reference and mutations leak across rows/items.',
        evidence: match[0].replace(/\s+/g, ' ').slice(0, 220),
        suggestion: 'Use Array.from({ length }, () => newObject) so each slot receives an independent value.',
        source: 'state-aliasing-scan'
      })
    }

    for (const match of content.matchAll(/Math\.random\s*\(\s*\)[\s\S]{0,180}(?:token|secret|password|passwd|credential|nonce|invite|reset|auth|bearer|csrf|xsrf)|(?:token|secret|password|passwd|credential|nonce|invite|reset|auth|bearer|csrf|xsrf)[A-Za-z_$\w]*\s*=\s*[\s\S]{0,120}Math\.random\s*\(\s*\)/gi)) {
      const nearby = content.slice(Math.max(0, match.index - 120), Math.min(content.length, match.index + 260))
      if (/\b(?:dom|element|tab|panel|view|toast|animation|screenshot|filePath|filename|cache|modelKey|requestId)\b/i.test(nearby) &&
        !/\b(?:token|secret|password|passwd|credential|nonce|invite|reset|auth|bearer|csrf|xsrf)\b/i.test(nearby)) continue
      pushFinding(findings, {
        severity: 'warning',
        category: 'security',
        type: 'weak-random-token-generation',
        path: rel,
        line: findLineNumber(content, match.index),
        message: 'Math.random appears to be used for token/session/security-like material, which is predictable enough to be unsafe.',
        evidence: match[0].replace(/\s+/g, ' ').slice(0, 220),
        suggestion: 'Use crypto.randomBytes/randomUUID/getRandomValues depending on the runtime and required entropy.',
        source: 'crypto-randomness-scan'
      })
    }

    for (const match of content.matchAll(/(?:createCipheriv|createDecipheriv)\s*\([\s\S]{0,260}(?:Buffer\.alloc\s*\(\s*(?:12|16)\s*,\s*0\s*\)|Buffer\.from\s*\(\s*['"][A-Za-z0-9+/=]{8,}['"]|['"][A-Za-z0-9+/=]{8,}['"])/g)) {
      pushFinding(findings, {
        severity: 'warning',
        category: 'security',
        type: 'static-iv-or-salt-for-encryption',
        path: rel,
        line: findLineNumber(content, match.index),
        message: 'Encryption/decryption appears to use a static IV/nonce/salt value; repeated IVs can break confidentiality for common modes.',
        evidence: match[0].replace(/\s+/g, ' ').slice(0, 260),
        suggestion: 'Generate a fresh random IV/nonce per encryption and store it alongside the ciphertext.',
        source: 'crypto-iv-scan'
      })
    }
    for (const match of content.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*(?:(?:iv|nonce|salt)[A-Za-z_$\w]*)?)\s*=\s*(?:Buffer\.alloc\s*\(\s*(?:12|16)\s*,\s*0\s*\)|Buffer\.from\s*\(\s*['"][A-Za-z0-9+/=]{8,}['"]|['"][A-Za-z0-9+/=]{8,}['"])/gi)) {
      const name = match[1]
      if (!/(^iv$|iv$|nonce|salt)/i.test(name)) continue
      const tail = content.slice(match.index, Math.min(content.length, match.index + 700))
      if (!new RegExp(`(?:createCipheriv|createDecipheriv)\\s*\\([\\s\\S]{0,260}\\b${name}\\b`).test(tail)) continue
      pushFinding(findings, {
        severity: 'warning',
        category: 'security',
        type: 'static-iv-or-salt-for-encryption',
        path: rel,
        line: findLineNumber(content, match.index),
        message: 'Encryption/decryption appears to use a static IV/nonce/salt variable; repeated IVs can break confidentiality for common modes.',
        evidence: tail.replace(/\s+/g, ' ').slice(0, 260),
        suggestion: 'Generate a fresh random IV/nonce per encryption and store it alongside the ciphertext.',
        source: 'crypto-iv-scan'
      })
    }

    const prototypeMergePatterns = [
      /Object\.assign\s*\(\s*[^,\n]+\s*,\s*(?:req\.body|payload|input|params|query|data)\s*\)/g,
      /for\s*\(\s*(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s+in\s+(?:req\.body|payload|input|params|query|data)\s*\)\s*\{[\s\S]{0,260}\[[^\]]*\1[^\]]*\]\s*=/g
    ]
    for (const pattern of prototypeMergePatterns) for (const match of content.matchAll(pattern)) {
      const nearby = content.slice(Math.max(0, match.index - 180), Math.min(content.length, match.index + 520))
      const guardArea = content.slice(match.index, Math.min(content.length, match.index + match[0].length + 220))
      if (/(schema|validate|zod|joi|ajv|sanitize|allowlist|whitelist|hasOwnProperty|Object\.create\(null\)|Object\.hasOwn)/i.test(guardArea)) continue
      pushFinding(findings, {
        severity: 'warning',
        category: 'security',
        type: 'object-merge-without-prototype-key-guard',
        path: rel,
        line: findLineNumber(content, match.index),
        message: 'Untrusted object data appears to be merged/copied without guarding prototype keys; __proto__/constructor keys can pollute object behavior.',
        evidence: nearby.replace(/\s+/g, ' ').slice(0, 260),
        suggestion: 'Validate keys against an allowlist, reject __proto__/constructor/prototype, or merge into Object.create(null).',
        source: 'prototype-pollution-scan'
      })
    }

    for (const match of content.matchAll(/new\s+RegExp\s*\(\s*(?:req\.|payload|input|query|params|body|user|search|keyword|pattern|term)[^)]*\)/g)) {
      const nearby = content.slice(Math.max(0, match.index - 180), Math.min(content.length, match.index + 320))
      if (/(escapeRegExp|regexpEscape|sanitize|validate|safe-regex|RE2)/i.test(nearby)) continue
      pushFinding(findings, {
        severity: 'warning',
        category: 'security',
        type: 'user-controlled-regexp-without-escaping',
        path: rel,
        line: findLineNumber(content, match.index),
        message: 'RegExp is built from user/input data without obvious escaping or safety checks; this can cause regex injection or ReDoS.',
        evidence: match[0].replace(/\s+/g, ' ').slice(0, 220),
        suggestion: 'Escape literal searches, validate pattern complexity, or use a safe regex engine for user-provided patterns.',
        source: 'regex-safety-scan'
      })
    }

    for (const match of content.matchAll(/\b(?:exec|execSync)\s*\(\s*(`[^`]*\$\{[^}]+\}[^`]*`|['"][^'"]*['"]\s*\+\s*[^,)]+)/g)) {
      const nearby = content.slice(Math.max(0, match.index - 220), Math.min(content.length, match.index + 360))
      if (!/(child_process|require\(['"]node:child_process['"]\)|require\(['"]child_process['"]\)|input|user|path|file|url|cmd|command|args|prompt|name)/i.test(nearby)) continue
      pushFinding(findings, {
        severity: 'error',
        category: 'security',
        type: 'shell-command-string-interpolation-risk',
        path: rel,
        line: findLineNumber(content, match.index),
        message: 'Shell command is assembled with interpolated/dynamic input, which can turn filenames, prompts, or URLs into command execution.',
        evidence: match[0].replace(/\s+/g, ' ').slice(0, 260),
        suggestion: 'Use spawn/execFile with an argument array and validate paths/flags before execution.',
        source: 'command-execution-scan'
      })
    }

    for (const match of content.matchAll(/\bspawn\s*\([\s\S]{0,420}\bshell\s*:\s*true[\s\S]{0,180}\)/g)) {
      const block = match[0]
      if (!/(\$\{|input|user|path|file|url|cmd|command|args|prompt|name)/i.test(block)) continue
      pushFinding(findings, {
        severity: 'warning',
        category: 'security',
        type: 'spawn-shell-true-dynamic-command-risk',
        path: rel,
        line: findLineNumber(content, match.index),
        message: 'spawn uses shell:true with dynamic-looking command data, increasing command injection and quoting risk.',
        evidence: block.replace(/\s+/g, ' ').slice(0, 260),
        suggestion: 'Avoid shell:true for user/project data; pass executable and args separately.',
        source: 'command-execution-scan'
      })
    }

    for (const match of content.matchAll(/path\.(?:join|resolve)\s*\(\s*([A-Za-z_$][\w$.]*(?:root|Root|dir|Dir|base|Base|project|Project)[A-Za-z_$\w.]*)\s*,\s*([A-Za-z_$][\w$.]*(?:path|Path|file|File|name|Name|target|Target)[A-Za-z_$\w.]*)/g)) {
      const nearby = content.slice(Math.max(0, match.index - 220), Math.min(content.length, match.index + 420))
      if (/(path\.relative|startsWith|isInside|contains|normalize|realpath|validate|sanitize|safePath|assert)/i.test(nearby)) continue
      pushFinding(findings, {
        severity: 'warning',
        category: 'path',
        type: 'path-join-user-segment-without-boundary-check',
        path: rel,
        line: findLineNumber(content, match.index),
        message: 'A base directory is joined with a dynamic path segment without an obvious containment check; ../ or absolute paths can escape the root.',
        evidence: match[0].replace(/\s+/g, ' ').slice(0, 240),
        suggestion: 'Resolve the final path and verify path.relative(base, target) stays inside the base directory.',
        source: 'path-boundary-scan'
      })
    }

    for (const match of content.matchAll(/\b(?:fs\.)?(?:writeFileSync|writeFile)\s*\(\s*([^,\n]+)[\s\S]{0,260}\)|\bfs\.promises\.writeFile\s*\(\s*([^,\n]+)[\s\S]{0,260}\)/g)) {
      const target = String(match[1] || match[2] || '')
      const nearby = content.slice(Math.max(0, match.index - 260), Math.min(content.length, match.index + 520))
      if (!/(config|settings|state|cache|session|db|index|manifest|json|yaml|yml|toml|ini)/i.test(target + nearby)) continue
      if (/(mkdtemp|tmp|temp|rename|move|atomic|write-file-atomic)/i.test(nearby)) continue
      pushFinding(findings, {
        severity: 'warning',
        category: 'data',
        type: 'non-atomic-state-file-write',
        path: rel,
        line: findLineNumber(content, match.index),
        message: 'State/config file appears to be written directly without temp-file + rename; a crash can leave a truncated or corrupt file.',
        evidence: match[0].replace(/\s+/g, ' ').slice(0, 260),
        suggestion: 'Write to a temp file in the same directory, fsync when needed, then atomically rename into place.',
        source: 'file-durability-scan'
      })
    }

    for (const match of content.matchAll(/new\s+Date\s*\(\s*\)\.toISOString\s*\(\s*\)\.slice\s*\(\s*0\s*,\s*10\s*\)/g)) {
      const nearby = content.slice(Math.max(0, match.index - 220), Math.min(content.length, match.index + 260))
      if (!/(daily|today|dateKey|quota|reset|billing|usage|report|day|日期|今日|日切|额度|用量)/i.test(nearby)) continue
      pushFinding(findings, {
        severity: 'warning',
        category: 'logic',
        type: 'utc-date-used-for-local-day-key',
        path: rel,
        line: findLineNumber(content, match.index),
        message: 'Daily/local quota key uses UTC date from toISOString(), which can reset usage on the wrong local day.',
        evidence: nearby.replace(/\s+/g, ' ').slice(0, 260),
        suggestion: 'Use the product/account timezone explicitly when building daily quota, billing, or report keys.',
        source: 'time-boundary-scan'
      })
    }

    for (const match of content.matchAll(/res\.redirect\s*\(\s*(?:req\.|payload|input|query|params|body|user)[^)]+\)|(?:location\.href|window\.location)\s*=\s*(?:req\.|payload|input|query|params|body|user)[^;\n]+/g)) {
      const nearby = content.slice(Math.max(0, match.index - 180), Math.min(content.length, match.index + 320))
      if (/(allowlist|whitelist|sameOrigin|new URL\([^)]*,\s*base|startsWith\(['"]\/['"]\)|validate|sanitize)/i.test(nearby)) continue
      pushFinding(findings, {
        severity: 'warning',
        category: 'security',
        type: 'open-redirect-without-target-validation',
        path: rel,
        line: findLineNumber(content, match.index),
        message: 'Redirect target appears to come from user/input data without an obvious same-origin or allowlist check.',
        evidence: match[0].replace(/\s+/g, ' ').slice(0, 220),
        suggestion: 'Allow only relative paths or validate destination origin against an explicit allowlist.',
        source: 'redirect-safety-scan'
      })
    }

    for (const match of content.matchAll(/(?:app|router)\.(?:post|put|patch)\(\s*['"`]([^'"`]*(?:pay|payment|quota|credit|token|billing|subscribe|order|charge|refund)[^'"`]*)['"`][\s\S]{0,900}(?:update|insert|charge|create|quota|balance|token|credit|debit)/gi)) {
      const block = match[0]
      if (/(idempotency|Idempotency-Key|requestId|dedupe|once|unique\s+key|ON CONFLICT|upsert)/i.test(block)) continue
      pushFinding(findings, {
        severity: 'warning',
        category: 'data',
        type: 'payment-or-quota-mutation-without-idempotency-key',
        path: rel,
        line: findLineNumber(content, match.index),
        message: 'Payment/quota-like mutation route has no obvious idempotency key or dedupe guard; retries can double-charge or double-apply credits.',
        evidence: block.replace(/\s+/g, ' ').slice(0, 260),
        suggestion: 'Require an idempotency key/request id and enforce uniqueness at storage level for mutation routes.',
        source: 'idempotency-scan'
      })
    }

    for (const match of content.matchAll(/(?:app|router)\.(get|post|put|patch|delete)\(\s*['"`]([^'"`]*(?:admin|manage|users?|billing|quota|models?|settings)[^'"`]*)['"`]\s*,([\s\S]{0,900}?)\)/gi)) {
      const routePath = match[2] || ''
      const args = match[3] || ''
      if (!/(admin|manage|billing|quota|settings|users?)/i.test(routePath)) continue
      if (/(auth|authorize|authenticated|requireRole|requireAdmin|isAdmin|permission|rbac|acl|session|jwt\.verify|verifyJwt|ensureAdmin)/i.test(args)) continue
      pushFinding(findings, {
        severity: 'warning',
        category: 'security',
        type: 'admin-route-without-obvious-authorization',
        path: rel,
        line: findLineNumber(content, match.index),
        message: `Sensitive route ${String(match[1]).toUpperCase()} ${routePath} has no obvious auth/role middleware or authorization guard in the registration.`,
        evidence: match[0].replace(/\s+/g, ' ').slice(0, 260),
        suggestion: 'Add explicit authentication and role/permission checks close to the route or through a clearly named middleware.',
        source: 'auth-route-scan'
      })
    }

    for (const match of content.matchAll(/\b(?:fetch|axios\.get|axios\.post|http\.get|https\.get|request)\s*\(\s*(?:req\.(?:query|body|params)\.[A-Za-z_$][\w$]*|payload\.[A-Za-z_$][\w$]*|input\.[A-Za-z_$][\w$]*|targetUrl|sourceUrl|remoteUrl|callbackUrl|imageUrl|videoUrl|url)\b/g)) {
      const nearby = content.slice(Math.max(0, match.index - 220), Math.min(content.length, match.index + 420))
      if (/(allowlist|whitelist|privateIp|isPrivate|localhost|127\.|169\.254|metadata|new URL|validateUrl|safeUrl|ssrf|dns\.lookup)/i.test(nearby)) continue
      pushFinding(findings, {
        severity: 'warning',
        category: 'security',
        type: 'server-side-request-without-url-allowlist',
        path: rel,
        line: findLineNumber(content, match.index),
        message: 'Server-side request target appears to come from user/input data without URL allowlist or private-network protection.',
        evidence: match[0].replace(/\s+/g, ' ').slice(0, 220),
        suggestion: 'Parse the URL, allow only expected hosts/schemes, and block private/metadata IP ranges after DNS resolution.',
        source: 'ssrf-safety-scan'
      })
    }

    for (const match of content.matchAll(/new\s+AbortController\s*\(\s*\)/g)) {
      const block = content.slice(match.index, Math.min(content.length, match.index + 900))
      if (/\bsignal\s*[:=]\s*[A-Za-z_$][\w$]*\.signal|\.signal\b[\s\S]{0,160}(?:fetch|axios|request|loadURL)/.test(block)) continue
      pushFinding(findings, {
        severity: 'warning',
        category: 'runtime',
        type: 'abort-controller-created-but-signal-not-used',
        path: rel,
        line: findLineNumber(content, match.index),
        message: 'AbortController is created but its signal is not obviously passed to the async operation, so cancellation/timeout may not work.',
        evidence: block.replace(/\s+/g, ' ').slice(0, 260),
        suggestion: 'Pass controller.signal to fetch/request/load operation and abort it on timeout or owner cancellation.',
        source: 'async-lifecycle-scan'
      })
    }

    for (const match of content.matchAll(/(?:multer\s*\(\s*\{([\s\S]{0,520}?)\}\s*\)|express-fileupload\s*\(\s*\{([\s\S]{0,520}?)\}\s*\)|busboy\s*\(\s*\{([\s\S]{0,520}?)\}\s*\))/g)) {
      const options = match[1] || match[2] || match[3] || ''
      if (/(limits\s*:|fileSize|maxFileSize|maxFieldsSize|parts\s*:|files\s*:)/i.test(options)) continue
      pushFinding(findings, {
        severity: 'warning',
        category: 'security',
        type: 'upload-middleware-without-size-limit',
        path: rel,
        line: findLineNumber(content, match.index),
        message: 'Upload middleware is configured without an obvious file size/parts limit, which can allow memory or disk exhaustion.',
        evidence: match[0].replace(/\s+/g, ' ').slice(0, 240),
        suggestion: 'Set explicit fileSize/files/parts limits and reject oversized uploads before expensive processing.',
        source: 'upload-safety-scan'
      })
    }

    for (const match of content.matchAll(/\b(?:console\.(?:log|error|warn|info)|logger\.(?:info|warn|error|debug)|print|logging\.(?:info|warning|error|debug))\s*\([\s\S]{0,260}(?:api[_-]?key|authorization|password|passwd|secret|token|cookie|set-cookie|bearer)/gi)) {
      const block = match[0]
      if (/(redact|mask|sanitize|safeLog|hash|fingerprint)/i.test(block)) continue
      pushFinding(findings, {
        severity: 'warning',
        category: 'security',
        type: 'sensitive-data-logged',
        path: rel,
        line: findLineNumber(content, match.index),
        message: 'Log statement includes sensitive-looking data such as token/key/password/cookie without obvious redaction.',
        evidence: block.replace(/\s+/g, ' ').slice(0, 240),
        suggestion: 'Log only redacted fingerprints or metadata, never raw credentials or authorization headers.',
        source: 'secret-log-scan'
      })
    }

    for (const match of content.matchAll(/cors\s*\(\s*\{[\s\S]{0,260}origin\s*:\s*['"]\*['"][\s\S]{0,260}credentials\s*:\s*true|Access-Control-Allow-Origin['"]?\s*,\s*['"]\*['"][\s\S]{0,260}Access-Control-Allow-Credentials['"]?\s*,\s*['"]true['"]/g)) {
      pushFinding(findings, {
        severity: 'error',
        category: 'security',
        type: 'cors-wildcard-origin-with-credentials',
        path: rel,
        line: findLineNumber(content, match.index),
        message: 'CORS allows wildcard origin together with credentials, which is invalid in browsers and dangerous as a security boundary.',
        evidence: match[0].replace(/\s+/g, ' ').slice(0, 260),
        suggestion: 'Echo only validated origins from an allowlist when credentials are enabled.',
        source: 'cors-config-scan'
      })
    }

    for (const match of content.matchAll(/\bjwt\.decode\s*\(|jsonwebtoken\.decode\s*\(|jwtDecode\s*\(/g)) {
      const nearby = content.slice(Math.max(0, match.index - 220), Math.min(content.length, match.index + 420))
      if (/(jwt\.verify|jsonwebtoken\.verify|verifyJwt|jose\.jwtVerify|algorithms\s*:|issuer\s*:|audience\s*:)/i.test(nearby)) continue
      pushFinding(findings, {
        severity: 'warning',
        category: 'security',
        type: 'jwt-decoded-without-signature-verification',
        path: rel,
        line: findLineNumber(content, match.index),
        message: 'JWT is decoded without an obvious signature/issuer/audience verification path nearby.',
        evidence: nearby.replace(/\s+/g, ' ').slice(0, 260),
        suggestion: 'Use verify/jwtVerify with expected algorithm, issuer, audience, and key before trusting claims.',
        source: 'auth-token-scan'
      })
    }

    for (const match of content.matchAll(/dangerouslySetInnerHTML\s*=\s*\{\s*\{[\s\S]{0,220}?__html\s*:\s*([\s\S]{0,180}?)\}\s*\}/g)) {
      const value = match[1] || ''
      const nearby = content.slice(Math.max(0, match.index - 220), Math.min(content.length, match.index + 360))
      if (/(DOMPurify\.sanitize|sanitizeHtml\s*\(|sanitize\s*\(|trustedHTML)/i.test(nearby)) continue
      if (/^['"`][\s\S]*['"`]$/.test(value.trim())) continue
      pushFinding(findings, {
        severity: 'warning',
        category: 'security',
        type: 'react-dangerous-html-from-dynamic-content',
        path: rel,
        line: findLineNumber(content, match.index),
        message: 'React dangerouslySetInnerHTML receives dynamic content without an obvious sanitizer.',
        evidence: match[0].replace(/\s+/g, ' ').slice(0, 240),
        suggestion: 'Render as text/structured nodes, or sanitize with a reviewed HTML sanitizer before passing __html.',
        source: 'xss-safety-scan'
      })
    }

    for (const match of content.matchAll(/JSON\.parse\s*\(\s*localStorage\.getItem\s*\([^)]+\)\s*\)/g)) {
      const nearby = content.slice(Math.max(0, match.index - 220), Math.min(content.length, match.index + 320))
      if (/(try\s*\{|catch\s*\(|safeJson|parseJson|fallback|\|\|\s*['"`][\[{])/i.test(nearby)) continue
      pushFinding(findings, {
        severity: 'warning',
        category: 'runtime',
        type: 'localstorage-json-parse-without-fallback',
        path: rel,
        line: findLineNumber(content, match.index),
        message: 'localStorage JSON is parsed without an obvious fallback; corrupt storage can break page initialization before UI renders.',
        evidence: match[0].replace(/\s+/g, ' ').slice(0, 220),
        suggestion: 'Wrap localStorage parsing in try/catch and reset or ignore corrupt values.',
        source: 'frontend-state-resilience-scan'
      })
    }

    for (const match of content.matchAll(/(?:beginTransaction|transaction\s*=\s*await|BEGIN TRANSACTION|db\.transaction)\s*[\s\S]{0,1200}(?:commit|COMMIT)\s*\(/gi)) {
      const block = match[0]
      if (/(rollback|ROLLBACK|catch\s*\([^)]*\)\s*\{[\s\S]{0,260}rollback|finally\s*\{[\s\S]{0,260}rollback)/i.test(block)) continue
      pushFinding(findings, {
        severity: 'warning',
        category: 'data',
        type: 'transaction-commit-without-rollback-path',
        path: rel,
        line: findLineNumber(content, match.index),
        message: 'Transaction-like code commits but has no obvious rollback path; mid-flight errors can leave partial side effects or locked transactions.',
        evidence: block.replace(/\s+/g, ' ').slice(0, 260),
        suggestion: 'Wrap transaction work in try/catch and rollback on every failure path before rethrowing.',
        source: 'transaction-safety-scan'
      })
    }

    for (const match of content.matchAll(/\b(?:readFileSync|createWriteStream|openSync|writeFileSync)\s*\(\s*path\.join\s*\(\s*(?:os\.tmpdir\(\)|['"][^'"]*(?:tmp|temp)[^'"]*['"])\s*,\s*`?\$\{?(?:user|userId|projectId|sessionId|fileName|name|id)[^,)]*/g)) {
      const nearby = content.slice(Math.max(0, match.index - 180), Math.min(content.length, match.index + 320))
      if (/(mkdtemp|randomUUID|randomBytes|nanoid|crypto|sanitize|safeName)/i.test(nearby)) continue
      pushFinding(findings, {
        severity: 'warning',
        category: 'security',
        type: 'predictable-temp-file-path',
        path: rel,
        line: findLineNumber(content, match.index),
        message: 'Temporary file path is derived from predictable/user data, which can collide across requests or enable temp-file races.',
        evidence: match[0].replace(/\s+/g, ' ').slice(0, 220),
        suggestion: 'Use mkdtemp/random names and keep temp files inside an owner-controlled directory.',
        source: 'temp-file-safety-scan'
      })
    }
    for (const match of content.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*path\.join\s*\(\s*(?:os\.tmpdir\(\)|['"][^'"]*(?:tmp|temp)[^'"]*['"])\s*,\s*`?\$\{?(?:user|userId|projectId|sessionId|fileName|name|id)[^;\n]+/g)) {
      const tempVar = match[1]
      const tail = content.slice(match.index, Math.min(content.length, match.index + 700))
      if (!new RegExp(`\\b(?:readFileSync|createWriteStream|openSync|writeFileSync)\\s*\\(\\s*${tempVar}\\b`).test(tail)) continue
      if (/(mkdtemp|randomUUID|randomBytes|nanoid|crypto|sanitize|safeName)/i.test(tail)) continue
      pushFinding(findings, {
        severity: 'warning',
        category: 'security',
        type: 'predictable-temp-file-path',
        path: rel,
        line: findLineNumber(content, match.index),
        message: 'Temporary file path is derived from predictable/user data and later used for file IO, which can collide across requests or enable temp-file races.',
        evidence: tail.replace(/\s+/g, ' ').slice(0, 260),
        suggestion: 'Use mkdtemp/random names and keep temp files inside an owner-controlled directory.',
        source: 'temp-file-safety-scan'
      })
    }

    for (const match of content.matchAll(/Promise\.race\s*\(\s*\[([\s\S]{0,900}?)\]\s*\)/g)) {
      const block = match[1] || ''
      if (!/(setTimeout|timeout|AbortController|signal|abort)/i.test(block)) continue
      if (/(AbortController|\.abort\s*\(|signal\.aborted|clearTimeout|finally\s*\()/i.test(block)) continue
      pushFinding(findings, {
        severity: 'warning',
        category: 'runtime',
        type: 'promise-race-timeout-without-cancellation',
        path: rel,
        line: findLineNumber(content, match.index),
        message: 'Promise.race timeout does not cancel the losing async work; late results can still mutate state after the caller believes it timed out.',
        evidence: match[0].replace(/\s+/g, ' ').slice(0, 260),
        suggestion: 'Use AbortController/cancellation and ignore late results with request/project identity checks.',
        source: 'async-lifecycle-scan'
      })
    }

    for (const match of content.matchAll(/(?:for\s*\([^)]*\)|for\s+await\s*\([^)]*\)|for\s*\([^)]*of[^)]*\))\s*\{[\s\S]{0,900}?await\s+(?:db|tx|repo|store|client|axios|fetch|request)\.[A-Za-z_$][\w$]*\s*\(/g)) {
      const block = match[0]
      if (/(Promise\.all|batch|bulk|transaction|concurrency|p-limit|queue)/i.test(block)) continue
      pushFinding(findings, {
        severity: 'warning',
        category: 'performance',
        type: 'await-io-inside-loop',
        path: rel,
        line: findLineNumber(content, match.index),
        message: 'Loop awaits database/network-like I/O one item at a time; this can turn batch work into slow serial execution.',
        evidence: block.replace(/\s+/g, ' ').slice(0, 260),
        suggestion: 'Use bulk APIs, Promise.all with a concurrency limit, or a transaction/batch operation when ordering is not required.',
        source: 'performance-batch-scan'
      })
    }

    for (const match of content.matchAll(/(?<!await\s)(?<!return\s)(?:db|store|repo|cache|storage|database)\.(?:save|set|put|insert|update|write|delete|remove)[A-Za-z_$\w]*\s*\([^;\n]*\)\s*(?:;|[\r\n])/g)) {
      const nearby = content.slice(Math.max(0, match.index - 220), Math.min(content.length, match.index + 320))
      if (!/(async\s+function|=>\s*\{|Promise|await)/i.test(nearby)) continue
      if (/(void\s+|fireAndForget|background|enqueue|setTimeout|Promise\.all)/i.test(nearby)) continue
      pushFinding(findings, {
        severity: 'warning',
        category: 'data',
        type: 'async-persistence-call-not-awaited',
        path: rel,
        line: findLineNumber(content, match.index),
        message: 'Persistence/cache mutation call is not awaited or returned in async-looking code; callers may report success before data is durable.',
        evidence: match[0].replace(/\s+/g, ' ').slice(0, 220),
        suggestion: 'await/return the persistence promise, or explicitly mark it as queued/background work with error handling.',
        source: 'async-durability-scan'
      })
    }

    for (const match of content.matchAll(/\b(?:setTimeout|setInterval)\s*\([\s\S]{0,240},\s*([A-Za-z_$][\w$]*(?:Seconds|Secs|Sec|_seconds|_secs|_sec))\s*\)/g)) {
      pushFinding(findings, {
        severity: 'warning',
        category: 'runtime',
        type: 'timer-unit-name-mismatch',
        path: rel,
        line: findLineNumber(content, match.index),
        message: 'JavaScript timer APIs expect milliseconds, but the delay variable name suggests seconds.',
        evidence: match[0].replace(/\s+/g, ' ').slice(0, 220),
        suggestion: 'Convert seconds to milliseconds explicitly or rename the variable/config to *_ms.',
        source: 'time-unit-scan'
      })
    }
    for (const match of content.matchAll(/asyncio\.(?:wait_for|sleep)\s*\([\s\S]{0,240}(?:timeout\s*=\s*)?([A-Za-z_$][\w$]*(?:Ms|MS|Millis|Milliseconds|_ms|_millis|_milliseconds))\b/g)) {
      pushFinding(findings, {
        severity: 'warning',
        category: 'runtime',
        type: 'timer-unit-name-mismatch',
        path: rel,
        line: findLineNumber(content, match.index),
        message: 'Python asyncio timeout/sleep APIs expect seconds, but the variable name suggests milliseconds.',
        evidence: match[0].replace(/\s+/g, ' ').slice(0, 220),
        suggestion: 'Divide milliseconds by 1000 or rename/store the config as seconds.',
        source: 'time-unit-scan'
      })
    }
    if (ext === '.py') {
      for (const match of content.matchAll(/def\s+[A-Za-z_][\w]*\s*\([^)]*=\s*(?:\[\]|\{\}|set\(\)|dict\(\)|list\(\))[^)]*\)\s*:/g)) {
        pushFinding(findings, {
          severity: 'warning',
          category: 'state',
          type: 'python-mutable-default-argument',
          path: rel,
          line: findLineNumber(content, match.index),
          message: 'Python function uses a mutable default argument; state can leak between independent calls or requests.',
          evidence: match[0].replace(/\s+/g, ' ').slice(0, 220),
          suggestion: 'Use None as the default and create a new list/dict/set inside the function.',
          source: 'state-aliasing-scan'
        })
      }
      for (const match of content.matchAll(/\b([A-Za-z_][\w.]*)\.acquire\s*\([^)]*\)/g)) {
        const tail = content.slice(match.index, Math.min(content.length, match.index + 900))
        if (/finally\s*:/.test(tail) && new RegExp(`${match[1].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\.release\\s*\\(`).test(tail)) continue
        if (!new RegExp(`${match[1].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\.release\\s*\\(`).test(tail)) continue
        pushFinding(findings, {
          severity: 'warning',
          category: 'runtime',
          type: 'python-lock-release-without-finally',
          path: rel,
          line: findLineNumber(content, match.index),
          message: 'Python lock is acquired and later released without a finally block; exceptions can leave the lock held and freeze later work.',
          evidence: tail.replace(/\s+/g, ' ').slice(0, 260),
          suggestion: 'Use with lock: or try/finally so release happens on every path.',
          source: 'concurrency-lifecycle-scan'
        })
      }
      for (const match of content.matchAll(/\brequests\.(?:get|post|put|patch|delete|request)\s*\(([\s\S]{0,360}?)\)/g)) {
        const call = match[0]
        if (/\btimeout\s*=/.test(call)) continue
        pushFinding(findings, {
          severity: 'warning',
          category: 'runtime',
          type: 'python-http-request-without-timeout',
          path: rel,
          line: findLineNumber(content, match.index),
          message: 'Python HTTP request has no timeout; a stuck upstream can hang the worker or whole task indefinitely.',
          evidence: call.replace(/\s+/g, ' ').slice(0, 240),
          suggestion: 'Set connect/read timeout explicitly and handle timeout errors at the call boundary.',
          source: 'network-timeout-scan'
        })
      }
    }
    for (const match of content.matchAll(/time\.Duration\s*\(\s*([A-Za-z_$][\w$]*(?:Ms|MS|Millis|Milliseconds|_ms|_millis|_milliseconds))\s*\)\s*\*\s*time\.Second|time\.Duration\s*\(\s*([A-Za-z_$][\w$]*(?:Seconds|Secs|Sec|_seconds|_secs|_sec))\s*\)\s*\*\s*time\.Millisecond/g)) {
      pushFinding(findings, {
        severity: 'warning',
        category: 'runtime',
        type: 'timer-unit-name-mismatch',
        path: rel,
        line: findLineNumber(content, match.index),
        message: 'Go time.Duration multiplier does not match the variable unit implied by its name.',
        evidence: match[0].replace(/\s+/g, ' ').slice(0, 220),
        suggestion: 'Align config units and Duration multiplier explicitly.',
        source: 'time-unit-scan'
      })
    }

    for (const match of content.matchAll(/\.then\s*\([^)]*=>\s*\{([\s\S]{0,520}?)\}\s*\)/g)) {
      const body = match[1] || ''
      if (!/(Map|cache|state|store|Stats|stats|set|update)/i.test(body)) continue
      if (!/\b(activeProjectId|currentProjectId|selectedProjectId|currentWorkspace|active[A-Za-z0-9_$]*)\b/.test(body)) continue
      if (/(projectId|requestId|signal\.aborted|isCurrent|currentRequest)/.test(body)) continue
      pushFinding(findings, {
        severity: 'warning',
        category: 'state',
        type: 'late-async-result-writes-active-context',
        path: rel,
        line: findLineNumber(content, match.index),
        message: 'Async callback writes to the current/active context instead of the request context; late responses can corrupt another project/session.',
        evidence: match[0].replace(/\s+/g, ' ').slice(0, 260),
        suggestion: 'Capture the request project/session id and write only if it still matches, or store under the captured id.',
        source: 'async-context-scan'
      })
    }

    if (['.py', '.js', '.ts', '.tsx', '.jsx', '.env', '.json', '.yaml', '.yml'].includes(ext)) {
      const secretPattern = /(?:\b(?:openai|anthropic|deepseek|agnes|ark|api)[_-]?key\s*[:=]\s*['"][^'"]{8,}['"]|\bsecret\s*[:=]\s*['"][^'"]{8,}['"]|(?<![A-Za-z0-9_-])sk-(?=[A-Za-z0-9_-]{20,})(?=.*\d)[A-Za-z0-9_-]{20,})/gi
      for (const match of content.matchAll(secretPattern)) {
        const nearby = content.slice(Math.max(0, match.index - 80), Math.min(content.length, match.index + 140))
        if (/\b(class|className|id|data-|aria-|selector|css|style|i18n|label)\b/i.test(nearby) && !/\b(api|key|secret|token|authorization|bearer)\b/i.test(nearby)) continue
        pushFinding(findings, {
          severity: 'warning',
          category: 'security',
          type: 'hardcoded-secret-risk',
          path: rel,
          line: findLineNumber(content, match.index),
          message: 'Possible hardcoded secret or API key found in source/config.',
          evidence: match[0].slice(0, 80),
          suggestion: 'Move secrets to environment variables or a secure secret manager.',
          source: 'generic-secret-scan'
        })
      }
    }

    for (const match of content.matchAll(/(?:\b(?:role|permission|tenant)\b|[A-Za-z_$][\w$]*\.(?:role|permission|tenant))\s*(?:in|===|==|!==|!=|\.includes\(|\.has\()\s*[^;\n]{0,180}/gi)) {
      const block = match[0]
      const nearby = content.slice(Math.max(0, match.index - 180), Math.min(content.length, match.index + 240))
      if (!/(allowlist|whitelist|denylist|blacklist|admin|operator|delete|write|auth|permission|tenant|Set\s*\(|ROLE_|PERMISSION_)/i.test(nearby)) continue
      if (/(normalize|toLowerCase|trim|NFC|NFKC|casefold|realpath|resolve|path\.normalize|strings\.ToLower)/i.test(block)) continue
      pushFinding(findings, {
        severity: 'warning',
        category: 'security',
        type: 'sensitive-identity-compare-without-normalization',
        path: rel,
        line: findLineNumber(content, match.index),
        message: 'Sensitive role/path/project comparison lacks obvious normalization; invisible Unicode, case, or slash drift can bypass or break authorization/cache identity.',
        evidence: block.replace(/\s+/g, ' ').slice(0, 220),
        suggestion: 'Normalize Unicode/case/path separators before comparing security or cache identity values.',
        source: 'identity-normalization-scan'
      })
    }

    for (const match of content.matchAll(/(?:def\s+[A-Za-z_$][\w$]*(?:cache|key)[A-Za-z_$0-9]*[\s\S]{0,260}return\s+(?:f["'][^"'\n]*(?:project_path|projectPath|rootPath|baseDir|model_name|modelName)[^"'\n]*["']|`[^`\n]*(?:project_path|projectPath|rootPath|baseDir|model_name|modelName)[^`\n]*`)|(?:const|let|var)\s+[A-Za-z_$][\w$]*(?:key|cacheKey|cache_key)[A-Za-z_$0-9]*\s*=\s*`[^`\n]*(?:projectPath|project_path|rootPath|baseDir|modelName|model_name)[^`\n]*`|(?:cache|Map|dict|STATE|store)\.(?:set|get|has)\s*\(\s*`[^`\n]*(?:projectPath|project_path|rootPath|baseDir|modelName|model_name)[^`\n]*`)/g)) {
      const block = match[0]
      if (/(path\.resolve|path\.normalize|realpath|toLowerCase|lower\(\)|replace\([^)]+[\\\\/]|normalize)/i.test(block)) continue
      pushFinding(findings, {
        severity: 'warning',
        category: 'state',
        type: 'cross-platform-cache-key-without-path-normalization',
        path: rel,
        line: findLineNumber(content, match.index),
        message: 'Cache/state key includes project path or model identity without obvious path/case normalization.',
        evidence: block.replace(/\s+/g, ' ').slice(0, 240),
        suggestion: 'Normalize path separators, casing where appropriate, and Unicode before using paths/model names as cache keys.',
        source: 'cache-identity-scan'
      })
    }

    const sqlPatterns = [
      /(?:SELECT\s+[\s\S]{1,180}\s+FROM|UPDATE\s+[\w."]+\s+SET|DELETE\s+FROM|INSERT\s+INTO)\s+[\s\S]{0,220}(?:\+\s*[A-Za-z_$][\w$]*|\$\{[^}]+\})/gi,
      /(?:fmt\.Sprintf|String\.format|format)\s*\(\s*[`'"]\s*(?:SELECT\s+[\s\S]{1,180}\s+FROM|UPDATE\s+[\w."]+\s+SET|DELETE\s+FROM|INSERT\s+INTO)[\s\S]{0,260}%[a-z]/gi
    ]
    for (const pattern of sqlPatterns) for (const match of content.matchAll(pattern)) {
      pushFinding(findings, {
        severity: 'warning',
        category: 'data',
        type: 'dynamic-sql-construction-risk',
        path: rel,
        line: findLineNumber(content, match.index),
        message: 'SQL appears to be built from dynamic strings, which can cause injection or query-shape bugs.',
        evidence: match[0].replace(/\s+/g, ' ').slice(0, 260),
        suggestion: 'Use parameterized queries/prepared statements and keep SQL structure separate from user input.',
        source: 'generic-data-contract-scan'
      })
    }

    for (const match of content.matchAll(/(?:fetch|axios|requests\.|http\.|Invoke-RestMethod|curl)\s*[\s\S]{0,500}(?:json\(\)|\.data|response\.body|Body)[\s\S]{0,260}(?:\.[A-Za-z_$][\w$]*|\[['"][^'"]+['"]\])/g)) {
      const block = match[0]
      if (/(schema|validate|zod|pydantic|serde|decode|unmarshal|try|catch|except|if\s*\()/i.test(block)) continue
      pushFinding(findings, {
        severity: 'warning',
        category: 'contract',
        type: 'api-response-used-without-schema-guard',
        path: rel,
        line: findLineNumber(content, match.index),
        message: 'Remote/API response fields are used without an obvious schema or existence guard.',
        evidence: block.replace(/\s+/g, ' ').slice(0, 260),
        suggestion: 'Validate response shape before using fields, especially across service/model/provider boundaries.',
        source: 'generic-api-contract-scan'
      })
    }

    collectBodyConsumptionFindings(content, rel, findings)

    if (ext === '.go') {
      for (const match of content.matchAll(/go\s+func\s*\([^)]*\)\s*\{[\s\S]{0,900}for\s*\{[\s\S]{0,900}\}/g)) {
        const block = match[0]
        if (/(select\s*\{|<-ctx\.Done\s*\(|ctx\.Done\s*\(|context\.WithCancel|return\s+)/.test(block)) continue
        pushFinding(findings, {
          severity: 'warning',
          category: 'runtime',
          type: 'go-background-loop-without-cancellation',
          path: rel,
          line: findLineNumber(content, match.index),
          message: 'Go background goroutine loops without an obvious ctx.Done/select cancellation path.',
          evidence: block.replace(/\s+/g, ' ').slice(0, 260),
          suggestion: 'Use select with ctx.Done() or another owner-controlled stop signal so reload/shutdown cannot leak the worker.',
          source: 'generic-runtime-lifecycle-scan'
        })
      }
      for (const match of content.matchAll(/go\s+func\s*\([^)]*\)\s*\{[\s\S]{0,900}(?:time\.Sleep|store\.Write|cache|map\[|\.Set\()[\s\S]{0,900}\}\s*\(\s*\)/g)) {
        const block = match[0]
        if (/(select\s*\{|<-ctx\.Done\s*\(|ctx\.Done\s*\(|context\.WithCancel|return\s+)/.test(block)) continue
        pushFinding(findings, {
          severity: 'warning',
          category: 'runtime',
          type: 'go-detached-goroutine-ignores-request-context',
          path: rel,
          line: findLineNumber(content, match.index),
          message: 'Detached goroutine writes state after the request context may be cancelled.',
          evidence: block.replace(/\s+/g, ' ').slice(0, 260),
          suggestion: 'Pass ctx into the goroutine and select on ctx.Done() before sleeping, I/O, or state writes.',
          source: 'generic-runtime-lifecycle-scan'
        })
      }
    } else if (['.rs', '.cs', '.java', '.kt', '.swift'].includes(ext)) {
      for (const match of content.matchAll(/(?:go\s+func|Task\.Run|new\s+Thread|thread::spawn|tokio::spawn|DispatchQueue\.global)[\s\S]{0,600}(?:while\s*\(\s*true\s*\)|for\s*\{\s*\}|loop\s*\{)/g)) {
        const block = match[0]
        if (/(context|ctx|CancellationToken|cancel|abort|signal|select\s*\{|isCancelled)/i.test(block)) continue
        pushFinding(findings, {
          severity: 'warning',
          category: 'runtime',
          type: 'background-loop-without-cancellation',
          path: rel,
          line: findLineNumber(content, match.index),
          message: 'Background worker/loop has no obvious cancellation or context guard.',
          evidence: block.replace(/\s+/g, ' ').slice(0, 260),
          suggestion: 'Add context/cancellation checks and ensure the owner stops the worker during reload/shutdown.',
          source: 'generic-runtime-lifecycle-scan'
        })
      }
    }

    if (['.yaml', '.yml', '.toml', '.ini', '.env', '.json'].includes(ext)) {
      if (['.yaml', '.yml'].includes(ext)) {
        const seenByIndent = new Map()
        const lines = content.split(/\r\n|\r|\n/)
        for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
          const line = lines[lineIndex]
          if (!line.trim() || /^\s*#/.test(line)) continue
          const keyMatch = line.match(/^(\s*)([A-Za-z0-9_.-]+)\s*:\s*(?:#.*)?$/) || line.match(/^(\s*)([A-Za-z0-9_.-]+)\s*:\s+.+$/)
          if (!keyMatch) continue
          const indent = keyMatch[1].length
          const key = keyMatch[2]
          for (const existingIndent of [...seenByIndent.keys()]) if (existingIndent > indent) seenByIndent.delete(existingIndent)
          const bucketKey = indent
          if (!seenByIndent.has(bucketKey)) seenByIndent.set(bucketKey, new Map())
          const bucket = seenByIndent.get(bucketKey)
          if (bucket.has(key)) {
            pushFinding(findings, {
              severity: 'error',
              category: 'config',
              type: 'duplicate-yaml-key-overrides-value',
              path: rel,
              line: lineIndex + 1,
              message: `YAML key "${key}" is repeated at the same indentation; most parsers keep only the last value and silently override the first.`,
              evidence: `previous at line ${bucket.get(key)}, duplicate at line ${lineIndex + 1}: ${line.trim()}`,
              suggestion: 'Rename one key or merge the values explicitly; do not rely on parser-specific duplicate-key behavior.',
              source: 'config-override-scan'
            })
          } else {
            bucket.set(key, lineIndex + 1)
          }
        }
      }
      for (const match of content.matchAll(/(?:localhost|127\.0\.0\.1|0\.0\.0\.0):(\d{2,5})/g)) {
        pushFinding(findings, {
          severity: 'info',
          category: 'runtime',
          type: 'configured-local-port',
          path: rel,
          line: findLineNumber(content, match.index),
          message: `Local runtime port ${match[1]} is configured here; use it to attach logs/browser checks to the right project process.`,
          evidence: match[0],
          suggestion: 'When doing runtime probing, match this port/process instead of assuming the currently open window belongs to the target project.',
          source: 'generic-runtime-target-scan'
        })
      }
    }
  }
}

function collectApiEndpointContracts(projectPath = '', options = {}) {
  const files = collectGenericSourceFiles(projectPath, options)
  const clients = []
  const routes = []
  const fieldUses = []

  const addRoute = (item = {}) => {
    if (!item.path || !item.method) return
    routes.push({ ...item, method: String(item.method || '').toUpperCase() })
  }
  const addClient = (item = {}) => {
    if (!item.path) return
    clients.push({ ...item, method: String(item.method || 'GET').toUpperCase() })
  }
  const addFieldUse = (item = {}) => {
    if (!item.field) return
    fieldUses.push(item)
  }

  for (const filePath of files) {
    let content = ''
    try { content = fs.readFileSync(filePath, 'utf8') } catch (_) { continue }
    const rel = toProjectRelative(projectPath, filePath)
    const ext = path.extname(filePath).toLowerCase()
    const fileRoutePaths = []
    const fileClientPaths = []

    for (const match of content.matchAll(/(?:fetch|client\.fetch)\(\s*['"`]((?:https?:\/\/[^'"`]+)?\/api\/[^'"`?#]+)[^'"`]*['"`]\s*(?:,\s*\{([\s\S]{0,700}?)\})?/g)) {
      const options = match[2] || ''
      const method = options.match(/\bmethod\s*:\s*['"`]([A-Za-z]+)['"`]/)?.[1] || 'GET'
      const bodyKeys = []
      const body = options.match(/JSON\.stringify\(\s*\{([\s\S]{0,360}?)\}\s*\)/)?.[1] || ''
      for (const keyMatch of body.matchAll(/([A-Za-z_$][\w$]*)\s*:/g)) bodyKeys.push(keyMatch[1])
      for (const key of bodyKeys) {
        addFieldUse({ field: key, direction: 'request-client', apiPath: normalizeApiPath(match[1]), pathFile: rel, line: findLineNumber(content, match.index), evidence: match[0].replace(/\s+/g, ' ').slice(0, 220) })
      }
      const apiPath = normalizeApiPath(match[1])
      fileClientPaths.push(apiPath)
      addClient({ method, path: apiPath, bodyKeys, pathFile: rel, line: findLineNumber(content, match.index), evidence: match[0].replace(/\s+/g, ' ').slice(0, 260) })
    }
    for (const match of content.matchAll(/axios\.(get|post|put|patch|delete)\(\s*['"`]((?:https?:\/\/[^'"`]+)?\/api\/[^'"`?#]+)[^'"`]*['"`]/g)) {
      const apiPath = normalizeApiPath(match[2])
      fileClientPaths.push(apiPath)
      addClient({ method: match[1], path: apiPath, bodyKeys: [], pathFile: rel, line: findLineNumber(content, match.index), evidence: match[0] })
    }

    for (const match of content.matchAll(/\b(?:app|router)\.(get|post|put|patch|delete)\(\s*['"`]((?:\/api\/)[^'"`?#]+)['"`]/g)) {
      const apiPath = normalizeApiPath(match[2])
      fileRoutePaths.push(apiPath)
      addRoute({ method: match[1], path: apiPath, pathFile: rel, line: findLineNumber(content, match.index), evidence: match[0] })
    }
    for (const match of content.matchAll(/@(?:app|router)\.(get|post|put|patch|delete)\(\s*['"`]((?:\/api\/)[^'"`?#]+)['"`]/g)) {
      const apiPath = normalizeApiPath(match[2])
      fileRoutePaths.push(apiPath)
      addRoute({ method: match[1], path: apiPath, pathFile: rel, line: findLineNumber(content, match.index), evidence: match[0] })
    }
    for (const match of content.matchAll(/(?:HandleFunc|Handle)\(\s*['"`]([A-Z]+)\s+((?:\/api\/)[^'"`?#\s]+)['"`]/g)) {
      const apiPath = normalizeApiPath(match[2])
      fileRoutePaths.push(apiPath)
      addRoute({ method: match[1], path: apiPath, pathFile: rel, line: findLineNumber(content, match.index), evidence: match[0] })
    }
    for (const match of content.matchAll(/(?:mux|router)\.HandleFunc\(\s*['"`]((?:\/api\/)[^'"`?#]+)['"`][\s\S]{0,220}\.Methods\(\s*['"`]([A-Z]+)['"`]/g)) {
      const apiPath = normalizeApiPath(match[1])
      fileRoutePaths.push(apiPath)
      addRoute({ method: match[2], path: apiPath, pathFile: rel, line: findLineNumber(content, match.index), evidence: match[0].replace(/\s+/g, ' ').slice(0, 220) })
    }

    const hasApiSurface = /\/api\//.test(content)
    if (hasApiSurface) {
      for (const match of content.matchAll(/JSON\.stringify\(\s*\{([\s\S]{0,520}?)\}\s*\)/g)) {
        for (const keyMatch of match[1].matchAll(/(?:^|[,{\s])([A-Za-z_$][\w$]*)\s*(?=[:,}\n])/g)) {
          for (const apiPath of fileClientPaths.length ? fileClientPaths : ['']) {
            addFieldUse({ field: keyMatch[1], direction: 'request-client', apiPath, pathFile: rel, line: findLineNumber(content, match.index), evidence: match[0].replace(/\s+/g, ' ').slice(0, 220) })
          }
        }
      }
      for (const match of content.matchAll(/\b(?:payload|data|result|response|res|json)(?:\s*\[\s*['"`]([^'"`]+)['"`]\s*\]|\.[A-Za-z_$][\w$]*)+/g)) {
        const chain = match[0]
        for (const prop of chain.matchAll(/\.([A-Za-z_$][\w$]*)|\[\s*['"`]([^'"`]+)['"`]\s*\]/g)) {
          for (const apiPath of fileClientPaths.length ? fileClientPaths : ['']) {
            addFieldUse({ field: prop[1] || prop[2], direction: 'response-client', apiPath, pathFile: rel, line: findLineNumber(content, match.index), evidence: chain })
          }
        }
      }
      for (const match of content.matchAll(/json\s*:\s*["']([^"',]+)["']/g)) {
        if (match[1] === '-' || match[1].includes(',')) continue
        for (const apiPath of fileRoutePaths.length ? fileRoutePaths : ['']) {
          addFieldUse({ field: match[1], direction: 'json-tag', apiPath, pathFile: rel, line: findLineNumber(content, match.index), evidence: match[0] })
        }
      }
    }

    if (['.py', '.go', '.js', '.ts'].includes(ext)) {
      for (const match of content.matchAll(/(?:return|json\.NewEncoder\([^)]*\)\.Encode|res\.json)\s*(?:\(|\s)\s*\{([\s\S]{0,420}?)\}/g)) {
        for (const keyMatch of match[1].matchAll(/['"`]?([A-Za-z_$][\w$]*)['"`]?\s*:/g)) {
          for (const apiPath of fileRoutePaths.length ? fileRoutePaths : ['']) {
            addFieldUse({ field: keyMatch[1], direction: 'response-produced', apiPath, pathFile: rel, line: findLineNumber(content, match.index), evidence: match[0].replace(/\s+/g, ' ').slice(0, 220) })
          }
        }
      }
    }
  }

  return { clients, routes, fieldUses }
}

function normalizeApiPath(value = '') {
  let text = String(value || '').trim()
  text = text.replace(/^https?:\/\/[^/]+/i, '')
  text = text.replace(/\/+$/, '')
  return text || '/'
}

function collectApiContractFindings(projectPath = '', findings = [], options = {}) {
  if (!projectPath || !fs.existsSync(projectPath)) return
  const { clients, routes, fieldUses } = collectApiEndpointContracts(projectPath, options)
  const routesByPath = new Map()
  for (const route of routes) {
    if (!routesByPath.has(route.path)) routesByPath.set(route.path, [])
    routesByPath.get(route.path).push(route)
  }

  for (const client of clients) {
    const matchingRoutes = routesByPath.get(client.path) || []
    if (!matchingRoutes.length) continue
    if (matchingRoutes.some(route => route.method === client.method)) continue
    pushFinding(findings, {
      severity: 'warning',
      category: 'contract',
      type: 'api-method-contract-mismatch',
      path: client.pathFile,
      line: client.line,
      message: `Client calls ${client.method} ${client.path}, but scanned server routes for the same path use ${[...new Set(matchingRoutes.map(item => item.method))].join('/')}.`,
      evidence: `${client.evidence} | server: ${matchingRoutes.slice(0, 3).map(item => `${item.method} ${item.path} at ${item.pathFile}:${item.line}`).join('; ')}`,
      suggestion: 'Align the client method with the server route or add the missing server method before treating the integration as working.',
      source: 'api-contract-scan'
    })
  }

  const routesByMethodPath = new Map()
  for (const route of routes) {
    const key = `${route.method} ${route.path}`
    if (!routesByMethodPath.has(key)) routesByMethodPath.set(key, [])
    routesByMethodPath.get(key).push(route)
  }
  for (const [key, matches] of routesByMethodPath.entries()) {
    if (matches.length < 2) continue
    const first = matches[0]
    pushFinding(findings, {
      severity: 'warning',
      category: 'contract',
      type: 'duplicate-api-route-registration',
      path: first.pathFile,
      line: first.line,
      message: `Route ${key} is registered ${matches.length} times; framework order can shadow one handler or execute an unexpected one.`,
      evidence: matches.slice(0, 6).map(item => `${item.pathFile}:${item.line}`).join('; '),
      suggestion: 'Keep one authoritative handler per method/path, or make route ordering explicit and covered by an integration test.',
      source: 'api-contract-scan'
    })
  }

  const fields = new Map()
  for (const use of fieldUses) {
    if (!use.apiPath) continue
    const key = use.field.toLowerCase().replace(/[_-]/g, '')
    const bucketKey = `${use.apiPath}::${key}`
    if (!fields.has(bucketKey)) fields.set(bucketKey, [])
    fields.get(bucketKey).push(use)
  }
  for (const [key, uses] of fields.entries()) {
    const spellings = [...new Set(uses.map(item => item.field))]
    if (spellings.length < 2) continue
    const directions = new Set(uses.map(item => item.direction))
    const hasContractBoundary = directions.has('request-client') && directions.has('json-tag')
      || directions.has('response-client') && directions.has('response-produced')
      || directions.has('request-client') && directions.has('response-produced')
    if (!hasContractBoundary) continue
    const hasSnake = spellings.some(item => /_/.test(item))
    const hasCamel = spellings.some(item => /[a-z][A-Z]/.test(item))
    if (!hasSnake || !hasCamel) continue
    const first = uses[0]
    pushFinding(findings, {
      severity: 'warning',
      category: 'contract',
      type: 'api-field-spelling-drift',
      path: first.pathFile,
      line: first.line,
      message: `API field appears with multiple spellings: ${spellings.join(', ')}.`,
      evidence: uses.slice(0, 6).map(item => `${item.field} at ${item.pathFile}:${item.line}`).join('; '),
      suggestion: 'Confirm whether the contract is snake_case or camelCase and normalize both producer and consumer.',
      source: 'api-contract-scan'
    })
  }
}

function findSimilarChannel(channel = '', candidates = []) {
  const value = String(channel || '')
  if (!value) return ''
  let best = ''
  let bestDistance = Infinity
  for (const candidate of candidates) {
    const distance = levenshtein(value, candidate)
    if (distance < bestDistance) {
      bestDistance = distance
      best = candidate
    }
  }
  return best && bestDistance <= Math.max(2, Math.floor(value.length * 0.18)) ? best : ''
}

function levenshtein(a = '', b = '') {
  const left = String(a)
  const right = String(b)
  const dp = Array.from({ length: left.length + 1 }, () => Array(right.length + 1).fill(0))
  for (let i = 0; i <= left.length; i += 1) dp[i][0] = i
  for (let j = 0; j <= right.length; j += 1) dp[0][j] = j
  for (let i = 1; i <= left.length; i += 1) {
    for (let j = 1; j <= right.length; j += 1) {
      const cost = left[i - 1] === right[j - 1] ? 0 : 1
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost
      )
    }
  }
  return dp[left.length][right.length]
}

function collectDomBindingFindings(projectPath = '', findings = []) {
  const files = []
  collectFiles(path.join(projectPath, 'frontend'), files, projectPath, new Set(['.js', '.mjs', '.html', '.htm']))
  for (const filePath of files.slice(0, 1200)) {
    let content = ''
    try { content = fs.readFileSync(filePath, 'utf8') } catch (_) { continue }
    const rel = toProjectRelative(projectPath, filePath)
    const variableIds = new Map()
    for (const match of content.matchAll(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*document\.getElementById\(\s*['"]([^'"]+)['"]\s*\)/g)) {
      variableIds.set(match[1], { id: match[2], line: findLineNumber(content, match.index) })
    }
    for (const match of content.matchAll(/\b([A-Za-z_$][\w$]*)\.addEventListener\(\s*['"]([^'"]+)['"]/g)) {
      const variable = variableIds.get(match[1])
      if (!variable) continue
      const nearby = content.slice(Math.max(0, match.index - 180), match.index)
      if (new RegExp(`if\\s*\\(\\s*${match[1]}\\s*\\)|${match[1]}\\s*&&`).test(nearby)) continue
      pushFinding(findings, {
        severity: 'warning',
        category: 'runtime',
        type: 'nullable-dom-event-binding',
        path: rel,
        line: findLineNumber(content, match.index),
        message: `Element variable "${match[1]}" from #${variable.id} is used with addEventListener without a nearby null guard.`,
        evidence: match[0],
        suggestion: 'If the element is absent in some pages/states, this throws at runtime and stops later UI initialization. Add a guard or bind after confirming the DOM exists.',
        source: 'dom-binding-scan'
      })
    }
    for (const match of content.matchAll(/document\.querySelector\(\s*['"]([^'"]+)['"]\s*\)\.classList\./g)) {
      pushFinding(findings, {
        severity: 'warning',
        category: 'runtime',
        type: 'nullable-query-selector-chain',
        path: rel,
        line: findLineNumber(content, match.index),
        message: `querySelector("${match[1]}") is dereferenced directly; missing DOM will throw at runtime.`,
        evidence: match[0],
        suggestion: 'Store the element, check for null, then mutate classList. Runtime/F12 errors often originate here.',
        source: 'dom-binding-scan'
      })
    }
    for (const match of content.matchAll(/\.set\(\s*['"]default['"]\s*,[\s\S]{0,220}\bprojectId\b/g)) {
      pushFinding(findings, {
        severity: 'warning',
        category: 'state',
        type: 'project-state-hardcoded-default-key',
        path: rel,
        line: findLineNumber(content, match.index),
        message: 'Project-specific state is stored under a hardcoded "default" key while projectId is present, which can leak state across projects.',
        evidence: match[0].replace(/\s+/g, ' ').slice(0, 220),
        suggestion: 'Use a String(projectId || fallback || "default") key, and avoid sharing mutable UI state between projects.',
        source: 'state-contract-scan'
      })
    }
    for (const match of content.matchAll(/return[ \t]+[^\r\n;]*data\.projectId\s*!==\s*activeProjectId[^\r\n;]*/g)) {
      pushFinding(findings, {
        severity: 'error',
        category: 'state',
        type: 'project-event-visibility-inverted',
        path: rel,
        line: findLineNumber(content, match.index),
        message: 'Project event visibility appears inverted: it returns true when data.projectId differs from activeProjectId.',
        evidence: match[0],
        suggestion: 'Current project events should match activeProjectId. This pattern can show another project\'s runtime/progress/errors in the current UI.',
        source: 'state-contract-scan'
      })
    }
    for (const match of content.matchAll(/\.then\s*\([^=]*=>\s*\{([\s\S]{0,700}?)\}\s*\)/g)) {
      const prefix = content.slice(Math.max(0, match.index - 32), match.index)
      if (/\breturn\s+$/.test(prefix)) continue
      const body = match[1] || ''
      if (!/(render|update|set[A-Z]|textContent|innerHTML|classList|dispatch|send|emit)/.test(body)) continue
      if (/(requestId|activeRequestId|projectId|activeProjectId|signal\.aborted|AbortController|isCurrent|currentRequest)/.test(body)) continue
      pushFinding(findings, {
        severity: 'warning',
        category: 'state',
        type: 'async-result-without-staleness-guard',
        path: rel,
        line: findLineNumber(content, match.index),
        message: 'Async result updates UI/state without an obvious requestId/projectId/abort staleness guard.',
        evidence: match[0].replace(/\s+/g, ' ').slice(0, 240),
        suggestion: 'Before applying async results, verify the request is still current and belongs to the active project/view.',
        source: 'async-contract-scan'
      })
    }
    const listenerKeys = new Map()
    for (const match of content.matchAll(/\b([A-Za-z_$][\w$]*)\.addEventListener\(\s*['"]([^'"]+)['"]/g)) {
      const key = `${match[1]}:${match[2]}`
      const previous = listenerKeys.get(key)
      if (previous) {
        pushFinding(findings, {
          severity: 'warning',
          category: 'runtime',
          type: 'duplicate-event-listener-binding',
          path: rel,
          line: findLineNumber(content, match.index),
          message: `The same variable "${match[1]}" binds "${match[2]}" more than once in this file, which can duplicate user actions after init/reload.`,
          evidence: `${previous.evidence} | ${match[0]}`,
          suggestion: 'Use a single binding path, remove the previous listener, or guard initialization with a mounted/initialized flag.',
          source: 'event-binding-scan'
        })
      } else {
        listenerKeys.set(key, { evidence: match[0] })
      }
    }
    for (const match of content.matchAll(/(?<![\w$.])setInterval\s*\(/g)) {
      const prefix = content.slice(Math.max(0, match.index - 80), match.index)
      if (/(const|let|var|this\.[A-Za-z_$][\w$]*|window\.[A-Za-z_$][\w$]*|[A-Za-z_$][\w$]*\.[A-Za-z_$][\w$]*)\s*=\s*$/.test(prefix)) continue
      pushFinding(findings, {
        severity: 'warning',
        category: 'runtime',
        type: 'untracked-interval-timer',
        path: rel,
        line: findLineNumber(content, match.index),
        message: 'setInterval is started without storing the timer id nearby, so reloads/project switches may leak polling work.',
        evidence: match[0],
        suggestion: 'Store the interval id and clear it on dispose/pagehide/beforeunload or when the owning project/view changes.',
        source: 'timer-lifecycle-scan'
      })
    }
    for (const block of collectJsCatchBlocks(content)) {
      if (!/return\s+\{[\s\S]{0,160}success\s*:\s*true/i.test(block.content)) continue
      pushFinding(findings, {
        severity: 'error',
        category: 'logic',
        type: 'failure-swallowed-as-success',
        path: rel,
        line: findLineNumber(content, block.index),
        message: 'A catch block returns success:true, which can hide real failures behind a successful fallback response.',
        evidence: block.content.replace(/\s+/g, ' ').slice(0, 260),
        suggestion: 'Return success:false with the original error, or use an explicit partial/skipped status that cannot be mistaken for completion.',
        source: 'error-contract-scan'
      })
    }
  }
}

function escapeRegex(value = '') {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function normalizeFeatureToken(value = '') {
  return String(value || '')
    .toLowerCase()
    .replace(/\.(js|mjs|cjs|ts|tsx|jsx|css|scss|less|html|htm)$/i, '')
    .replace(/\b(ui|view|panel|page|component|feature|module|manager|service|handler|controller|renderer|legacy|old|new|v\d+|backup|bak|copy)\b/g, '')
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function collectDynamicDomIdsFromContent(content = '') {
  const ids = new Set()
  const createdVars = new Set()
  for (const match of content.matchAll(/(?:const|let|var)?\s*([A-Za-z_$][\w$]*)\s*=\s*document\.createElement\(\s*['"`][^'"`]+['"`]\s*\)/g)) {
    createdVars.add(match[1])
  }
  for (const variable of createdVars) {
    const escaped = escapeRegex(variable)
    const assignPattern = new RegExp(`\\b${escaped}\\s*\\.\\s*id\\s*=\\s*['"\`]([^'"\`]+)['"\`]`, 'g')
    for (const match of content.matchAll(assignPattern)) {
      if (match[1]) ids.add(match[1])
    }
    const setAttrPattern = new RegExp(`\\b${escaped}\\s*\\.\\s*setAttribute\\(\\s*['"\`]id['"\`]\\s*,\\s*['"\`]([^'"\`]+)['"\`]\\s*\\)`, 'g')
    for (const match of content.matchAll(setAttrPattern)) {
      if (match[1]) ids.add(match[1])
    }
  }
  for (const match of content.matchAll(/Object\.assign\(\s*document\.createElement\(\s*['"`][^'"`]+['"`]\s*\)\s*,\s*\{[\s\S]{0,220}\bid\s*:\s*['"`]([^'"`]+)['"`]/g)) {
    if (match[1]) ids.add(match[1])
  }
  return ids
}

function collectProjectDynamicDomIds(projectPath = '') {
  const ids = new Set()
  if (!projectPath || !fs.existsSync(projectPath)) return ids
  const files = []
  collectFiles(path.join(projectPath, 'frontend'), files, projectPath, new Set(['.js', '.mjs', '.html', '.htm']))
  for (const filePath of files.slice(0, 1200)) {
    let content = ''
    try { content = fs.readFileSync(filePath, 'utf8') } catch (_) { continue }
    for (const id of collectDynamicDomIdsFromContent(content)) ids.add(id)
  }
  return ids
}

function extractDomTargetId(value = '') {
  const text = String(value || '')
  const hash = text.match(/#([A-Za-z_-][\w-]+)/)
  if (hash) return hash[1]
  const quoted = text.match(/["'`]([A-Za-z_-][\w-]{2,})["'`]/)
  return quoted ? quoted[1] : ''
}

function collectRedundancyFindings(projectPath = '', findings = []) {
  if (!projectPath || !fs.existsSync(projectPath)) return
  const files = []
  collectFiles(projectPath, files, projectPath, new Set(['.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx', '.html', '.htm', '.css', '.scss', '.less']))
  const limitedFiles = files
    .filter(filePath => !isFixtureOrTempPath(toProjectRelative(projectPath, filePath)))
    .slice(0, 900)
  const htmlTextParts = []
  const jsTextParts = []
  const cssSelectorOwners = []
  const domIdQueries = []
  const functionOwners = new Map()
  const featureFileGroups = new Map()
  const usedClasses = new Set()
  const usedIds = new Set()
  const emittedRedundancyKeys = new Set()
  const pushRedundancyFinding = (item = {}) => {
    const key = `${item.type || ''}:${item.path || ''}:${item.line || ''}:${item.type === 'unused-css-selector-candidate' ? item.evidence || '' : ''}`.slice(0, 420)
    if (emittedRedundancyKeys.has(key)) return
    emittedRedundancyKeys.add(key)
    pushFinding(findings, item)
  }

  for (const filePath of limitedFiles) {
    let content = ''
    try { content = fs.readFileSync(filePath, 'utf8') } catch (_) { continue }
    const rel = toProjectRelative(projectPath, filePath)
    const ext = path.extname(filePath).toLowerCase()
    if (['.html', '.htm'].includes(ext)) htmlTextParts.push(content)
    if (['.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx'].includes(ext)) jsTextParts.push(content)

    for (const match of content.matchAll(/\bclass(?:Name)?\s*=\s*["'`]([^"'`]+)["'`]/g)) {
      for (const token of String(match[1] || '').split(/\s+/)) if (token) usedClasses.add(token)
    }
    for (const match of content.matchAll(/\bclassList\.(?:add|remove|toggle|contains)\(\s*["'`]([^"'`]+)["'`]/g)) {
      if (match[1]) usedClasses.add(match[1])
    }
    for (const match of content.matchAll(/\bid\s*=\s*["'`]([^"'`]+)["'`]|\bgetElementById\(\s*["'`]([^"'`]+)["'`]|\bquerySelector(?:All)?\(\s*["'`]#([A-Za-z_-][\w-]+)["'`]/g)) {
      const id = match[1] || match[2] || match[3]
      if (id) usedIds.add(id)
    }
    for (const id of collectDynamicDomIdsFromContent(content)) usedIds.add(id)

    const featureToken = normalizeFeatureToken(path.basename(filePath))
    if (featureToken && featureToken.length >= 4 && !/^(index|main|app|utils?|helpers?|types?|style|styles?)$/.test(featureToken)) {
      if (!featureFileGroups.has(featureToken)) featureFileGroups.set(featureToken, [])
      featureFileGroups.get(featureToken).push({ rel, filePath })
    }

    if (['.css', '.scss', '.less'].includes(ext)) {
      for (const match of content.matchAll(/(^|})\s*([^{}@][^{}]{0,220})\s*\{/g)) {
        const selectorText = String(match[2] || '').trim()
        if (!selectorText || /%|from\s|to\s/.test(selectorText)) continue
        for (const selector of selectorText.split(',').map(item => item.trim()).filter(Boolean)) {
          if (cssSelectorOwners.length >= 600) break
          const classMatch = selector.match(/\.([A-Za-z_-][\w-]{2,})/)
          const idMatch = selector.match(/#([A-Za-z_-][\w-]{2,})/)
          const token = classMatch?.[1] || idMatch?.[1] || ''
          if (!token || /^(active|show|hide|open|closed|selected|disabled|loading|error|warning|success|dark|light|hover|focus)$/.test(token)) continue
          cssSelectorOwners.push({
            selector,
            token,
            kind: classMatch ? 'class' : 'id',
            path: rel,
            line: findLineNumber(content, match.index)
          })
        }
      }
    }

    if (['.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx', '.html', '.htm'].includes(ext)) {
      for (const match of content.matchAll(/(?:getElementById\(\s*['"`]([^'"`]+)['"`]\s*\)|querySelector(?:All)?\(\s*['"`]#([A-Za-z_-][\w-]+)['"`]\s*\))/g)) {
        const id = match[1] || match[2]
        if (domIdQueries.length < 600) domIdQueries.push({ id, path: rel, line: findLineNumber(content, match.index), evidence: match[0] })
      }
      for (const match of content.matchAll(/(?:function\s+([A-Za-z_$][\w$]{3,})\s*\(|(?:const|let|var)\s+([A-Za-z_$][\w$]{3,})\s*=\s*(?:async\s*)?(?:function\b|\([^)]*\)\s*=>|[A-Za-z_$][\w$]*\s*=>))/g)) {
        const name = match[1] || match[2]
        if (/^(render|init|bind|load|update|handle|create|show|hide|open|close|set|get|main|start|stop|run)$/.test(name)) continue
        const key = name.toLowerCase()
        if (!functionOwners.has(key)) functionOwners.set(key, [])
        functionOwners.get(key).push({ name, path: rel, line: findLineNumber(content, match.index), evidence: match[0].replace(/\s+/g, ' ').slice(0, 160) })
      }
      for (const match of content.matchAll(/(?:legacy|deprecated|obsolete|dead code|unused|disabled|TODO:\s*remove|待删除|废弃|弃用|残留|旧版)/gi)) {
        const nearby = content.slice(Math.max(0, match.index - 120), Math.min(content.length, match.index + 220))
        pushRedundancyFinding({
          severity: 'warning',
          category: 'redundancy',
          type: 'legacy-disabled-code-candidate',
          path: rel,
          line: findLineNumber(content, match.index),
          message: 'Source contains a legacy/deprecated/unused marker; verify whether this implementation is still reachable or should be removed.',
          evidence: nearby.replace(/\s+/g, ' ').slice(0, 260),
          suggestion: 'Trace imports, DOM entry, IPC route, and user-visible navigation before deleting; if unused, remove the whole feature path in one cleanup.',
          source: 'redundancy-scan'
        })
      }
    }
  }

  const htmlText = htmlTextParts.join('\n')
  const jsText = jsTextParts.join('\n')
  const dynamicDomIds = collectDynamicDomIdsFromContent(jsText)
  const reportedCss = new Set()
  let emittedCss = 0
  for (const owner of cssSelectorOwners) {
    if (emittedCss >= 80) break
    if (owner.kind === 'class' && usedClasses.has(owner.token)) continue
    if (owner.kind === 'id' && usedIds.has(owner.token)) continue
    const key = `${owner.path}:${owner.line}:${owner.token}`
    if (reportedCss.has(key)) continue
    reportedCss.add(key)
    pushRedundancyFinding({
      severity: 'warning',
      category: 'redundancy',
      type: 'unused-css-selector-candidate',
      path: owner.path,
      line: owner.line,
      message: `CSS selector "${owner.selector}" was not referenced by scanned HTML/JS tokens.`,
      evidence: owner.selector,
      suggestion: 'Verify dynamic class generation before deleting. If no runtime path creates it, this is likely stale UI code.',
      source: 'redundancy-scan'
    })
    emittedCss += 1
  }

  const reportedIds = new Set()
  let emittedIds = 0
  for (const query of domIdQueries) {
    if (emittedIds >= 80) break
    if (new RegExp(`id\\s*=\\s*['"]${escapeRegex(query.id)}['"]`, 'i').test(htmlText)) continue
    if (dynamicDomIds.has(query.id)) continue
    if (new RegExp(`createElement[\\s\\S]{0,260}(?:id\\s*=\\s*['"]${escapeRegex(query.id)}['"]|\\.id\\s*=\\s*['"]${escapeRegex(query.id)}['"])`, 'i').test(jsText)) continue
    const key = `${query.path}:${query.line}:${query.id}`
    if (reportedIds.has(key)) continue
    reportedIds.add(key)
    pushRedundancyFinding({
      severity: 'warning',
      category: 'redundancy',
      type: 'dom-query-without-matching-markup',
      path: query.path,
      line: query.line,
      message: `DOM query references "#${query.id}", but no matching static or obvious dynamic markup was found.`,
      evidence: query.evidence,
      suggestion: 'Check whether this is a removed UI entry, stale script path, or dynamically created element. Missing DOM can make code silently do nothing or throw.',
      source: 'redundancy-scan'
    })
    emittedIds += 1
  }

  let emittedFeatureGroups = 0
  for (const [token, owners] of featureFileGroups.entries()) {
    if (emittedFeatureGroups >= 30) break
    const uniqueOwners = owners.filter((item, index, list) => list.findIndex(peer => peer.rel === item.rel) === index)
    if (uniqueOwners.length < 3) continue
    const paths = uniqueOwners.slice(0, 8).map(item => item.rel)
    pushRedundancyFinding({
      severity: 'warning',
      category: 'redundancy',
      type: 'duplicate-feature-surface-candidate',
      path: paths[0],
      line: null,
      message: `Multiple files look like parallel implementations of "${token}".`,
      evidence: paths.join('; '),
      suggestion: 'Identify the active entry/import/navigation path. Merge or delete abandoned implementations so AI and maintainers do not edit the wrong surface.',
      source: 'redundancy-scan'
    })
    emittedFeatureGroups += 1
  }

  let emittedFunctionGroups = 0
  for (const [key, owners] of functionOwners.entries()) {
    if (emittedFunctionGroups >= 30) break
    const files = [...new Set(owners.map(item => item.path))]
    if (files.length < 2) continue
    const important = /model|tool|panel|block|message|progress|plan|scan|preview|render|dropdown|menu|modal|mcp|agent|chat|cache|snapshot|history|route|auth|user|quota|token/i.test(key)
    if (!important) continue
    const first = owners[0]
    pushRedundancyFinding({
      severity: 'warning',
      category: 'redundancy',
      type: 'duplicate-function-name-across-files',
      path: first.path,
      line: first.line,
      message: `Function-like name "${first.name}" appears in multiple files; this can indicate duplicate or competing implementations.`,
      evidence: owners.slice(0, 8).map(item => `${item.path}:${item.line}`).join('; '),
      suggestion: 'Trace which implementation is imported/bound at runtime before editing. If both are active, consolidate ownership.',
      source: 'redundancy-scan'
    })
    emittedFunctionGroups += 1
  }
}

function collectOverlayClickBlockerFindings(projectPath = '', findings = []) {
  const files = []
  collectFiles(path.join(projectPath, 'frontend'), files, projectPath, new Set(['.css', '.scss', '.less', '.html', '.htm']))
  for (const filePath of files.slice(0, 1200)) {
    let content = ''
    try { content = fs.readFileSync(filePath, 'utf8') } catch (_) { continue }
    const rel = toProjectRelative(projectPath, filePath)
    for (const match of content.matchAll(/([^{}]+)\{([^{}]+)\}/g)) {
      const selector = String(match[1] || '').trim().replace(/\s+/g, ' ')
      const body = String(match[2] || '')
      if (!/position\s*:\s*(fixed|absolute)/i.test(body)) continue
      if (!/(inset\s*:\s*0|top\s*:\s*0[\s\S]{0,120}(left\s*:\s*0|right\s*:\s*0)|width\s*:\s*100vw|height\s*:\s*100vh)/i.test(body)) continue
      if (!/pointer-events\s*:\s*auto/i.test(body)) continue
      const zMatch = body.match(/z-index\s*:\s*(\d+)/i)
      const zIndex = zMatch ? Number(zMatch[1]) : 0
      if (zIndex < 100) continue
      pushFinding(findings, {
        severity: 'warning',
        category: 'runtime',
        type: 'transparent-overlay-click-blocker',
        path: rel,
        line: findLineNumber(content, match.index),
        message: `High z-index full-screen overlay "${selector}" can intercept clicks and make underlying buttons look unresponsive.`,
        evidence: body.replace(/\s+/g, ' ').slice(0, 220),
      suggestion: 'Verify with runtime_verify semantic interaction. Hide/remove the overlay, lower z-index, or set pointer-events:none when inactive.',
        source: 'overlay-click-scan'
      })
    }
  }
}

function collectUiRootCauseTraceFindings(projectPath = '', findings = []) {
  if (!projectPath || !fs.existsSync(projectPath)) return null
  let trace = null
  const dynamicDomIds = collectProjectDynamicDomIds(projectPath)
  try {
    trace = traceUiRootCause(projectPath, {
      query: 'click dropdown modal menu panel show open close classList visibility pointer-events opacity'
    })
  } catch (error) {
    pushFinding(findings, {
      severity: 'warning',
      category: 'dom-css',
      type: 'ui-root-cause-trace-unavailable',
      message: error.message,
      suggestion: 'Run targeted UI root cause tracing on the affected files if the bug is click/dropdown/modal related.',
      source: 'ui-root-cause-trace'
    })
    return null
  }

  for (const chain of Array.isArray(trace?.chains) ? trace.chains : []) {
    if (!['broken', 'suspicious'].includes(chain.status)) continue
    const issue = Array.isArray(chain.issues) ? chain.issues[0] : null
    if (!issue) continue
    if (issue.type === 'dom-target-missing') {
      const targetId = extractDomTargetId(`${chain.js?.target || ''}\n${chain.js?.evidence || ''}\n${issue.message || ''}`)
      if (targetId && dynamicDomIds.has(targetId)) continue
    }
    const cssEvidence = [
      ...(Array.isArray(chain.css?.ancestorGated) ? chain.css.ancestorGated : []),
      ...(Array.isArray(chain.css?.stateOnly) ? chain.css.stateOnly : [])
    ][0]
    pushFinding(findings, {
      severity: issue.severity || (chain.status === 'broken' ? 'error' : 'warning'),
      category: 'dom-css',
      type: issue.type || 'ui-state-chain-risk',
      path: chain.js?.path || '',
      line: chain.js?.line || null,
      message: issue.message || 'UI class state chain is not aligned across JS, DOM, and CSS.',
      evidence: [
        chain.js?.evidence ? `JS: ${chain.js.evidence}` : '',
        chain.js?.target ? `target: ${chain.js.target}` : '',
        cssEvidence?.selector ? `CSS: ${cssEvidence.selector}` : '',
        cssEvidence?.path ? `${cssEvidence.path}:${cssEvidence.line || ''}` : ''
      ].filter(Boolean).join(' | '),
      suggestion: chain.recommendation || 'Trace JS -> DOM -> CSS state owner before editing, then verify click lifecycle.',
      source: 'ui-root-cause-trace',
      confidence: 'medium',
      verification_status: 'needs_runtime_or_dom_verification',
      counter_evidence: ['Search for runtime-created DOM nodes, template rendering, and conditional mount paths before claiming the target is missing.']
    })
  }

  return trace
}

function collectFiles(dir, out = [], projectPath = '', extensions = new Set()) {
  if (!dir || !fs.existsSync(dir) || shouldSkip(dir, projectPath)) return out
  let entries = []
  try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch (_) { return out }
  entries.sort((a, b) => a.name.localeCompare(b.name))
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name)
    if (shouldSkip(fullPath, projectPath)) continue
    if (entry.isDirectory()) collectFiles(fullPath, out, projectPath, extensions)
    else if (entry.isFile()) {
      const base = path.basename(entry.name).toLowerCase()
      if (extensions.has(path.extname(entry.name).toLowerCase()) || base === '.env' || base.startsWith('.env.')) out.push(fullPath)
    }
  }
  return out
}

function shouldSkip(filePath = '', projectPath = '') {
  const ignored = new Set(['node_modules', '.git', '__pycache__', '.tmp-real-scenarios', '.lingxi-temp-diagnostics', 'change-sessions', 'codemap', '.lingua', '.uploads', 'dist', 'build', 'out', 'release', 'releases', 'coverage'])
  const parts = toProjectRelative(projectPath, filePath).split(/[\\/]+/).filter(Boolean)
  const base = path.basename(String(filePath || '')).toLowerCase()
  const generatedFiles = new Set(['.aimap.json', 'package-lock.json', 'pnpm-lock.yaml', 'yarn.lock', 'composer.lock', 'cargo.lock', 'go.sum', 'licenses.chromium.html'])
  return parts.some(part => ignored.has(part)) || generatedFiles.has(base) || String(filePath || '').endsWith('.bak')
}

function toProjectRelative(projectPath = '', filePath = '') {
  if (!projectPath || !filePath) return String(filePath || '')
  const root = path.resolve(projectPath)
  const target = path.resolve(filePath)
  const relative = path.relative(root, target)
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return target
  return relative.replace(/\\/g, '/')
}

function findLineNumber(content = '', index = 0) {
  return String(content || '').slice(0, Math.max(0, index)).split(/\r\n|\r|\n/).length
}

function buildReadHints(findings = []) {
  const seen = new Set()
  const hints = []
  for (const item of findings) {
    if (!item.path || !item.line) continue
    const key = `${item.path}:${item.line}:${item.type}`
    if (seen.has(key)) continue
    seen.add(key)
    hints.push({
      path: item.path,
      start_line: Math.max(1, Number(item.line || 1) - 8),
      end_line: Number(item.line || 1) + 12,
      reason: `${item.category}/${item.type}: ${item.message}`
    })
    if (hints.length >= 16) break
  }
  return hints
}

function summarizeByCategory(findings = []) {
  const summary = {}
  for (const item of findings) {
    const key = item.category || 'other'
    if (!summary[key]) summary[key] = { total: 0, errors: 0, warnings: 0 }
    summary[key].total += 1
    if (normalizeSeverity(item.severity) === 'error') summary[key].errors += 1
    if (normalizeSeverity(item.severity) === 'warning') summary[key].warnings += 1
  }
  return summary
}

function compareFindingsByRawRisk(a = {}, b = {}) {
  const bySeverity = severityWeight(b.severity) - severityWeight(a.severity)
  if (bySeverity) return bySeverity
  const byCategory = String(a.category || '').localeCompare(String(b.category || ''))
  if (byCategory) return byCategory
  const byType = String(a.type || '').localeCompare(String(b.type || ''))
  if (byType) return byType
  const byPath = String(a.path || '').localeCompare(String(b.path || ''))
  if (byPath) return byPath
  return Number(a.line || 0) - Number(b.line || 0)
}

function compareFindingsByProductionPriority(a = {}, b = {}) {
  const classWeight = {
    confirmed_production: 4,
    needs_verification: 3,
    possible_false_positive: 2,
    fixtures_and_temp: 1
  }
  const byClass = (classWeight[classifyHealthFinding(b)] || 0) - (classWeight[classifyHealthFinding(a)] || 0)
  if (byClass) return byClass
  return compareFindingsByRawRisk(a, b)
}

function buildTopFindings(findings = [], limit = 20, options = {}) {
  const mode = options.mode || 'balanced'
  const sorter = mode === 'production' ? compareFindingsByProductionPriority : compareFindingsByRawRisk
  return [...findings]
    .sort(sorter)
    .slice(0, limit)
}

function inferFindingConfidence(item = {}) {
  if (item.confidence) return item.confidence
  const type = String(item.type || '')
  if (isHighConfidenceProductionFinding(item)) return 'high'
  if ([
    'failure-swallowed-as-success',
    'commonjs-circular-require-top-level-read',
    'project-event-visibility-inverted',
    'dead-error-handler',
    'impossible-length-condition'
  ].includes(type)) return 'high'
  if (isNeedsVerificationFinding(item)) return 'medium'
  return 'low'
}

function inferVerificationStatus(item = {}) {
  if (item.verification_status) return item.verification_status
  const classification = classifyHealthFinding(item)
  if (classification === 'confirmed_production') return 'static_evidence_strong_verify_before_edit'
  if (classification === 'needs_verification') return 'candidate_requires_source_or_runtime_verification'
  if (classification === 'possible_false_positive') return 'low_confidence_candidate_check_counter_evidence'
  return 'context_label_verify_against_user_intent'
}

function annotateFinding(item = {}) {
  return {
    ...item,
    classification: classifyHealthFinding(item),
    confidence: inferFindingConfidence(item),
    verification_status: inferVerificationStatus(item)
  }
}

function buildFindingViews(findings = [], limit = 20) {
  const grouped = groupHealthFindings(findings)
  const take = (items = [], count = limit, mode = 'balanced') => buildTopFindings(items, count, { mode }).map(annotateFinding)
  const allErrors = findings.filter(item => normalizeSeverity(item.severity) === 'error')
  return {
    evidence_first: take(findings, limit, 'balanced'),
    production_first: take(findings, limit, 'production'),
    errors_first: take(allErrors.length ? allErrors : findings, limit, 'balanced'),
    confirmed_production: take(grouped.confirmed_production, limit, 'balanced'),
    needs_verification: take(grouped.needs_verification, limit, 'balanced'),
    fixtures_and_temp: take(grouped.fixtures_and_temp, limit, 'balanced'),
    possible_false_positive: take(grouped.possible_false_positive, Math.min(limit, 12), 'balanced')
  }
}

function summarizeByPathClass(findings = []) {
  const summary = {}
  for (const item of findings) {
    const key = classifyHealthFinding(item)
    if (!summary[key]) summary[key] = { total: 0, errors: 0, warnings: 0 }
    summary[key].total += 1
    if (normalizeSeverity(item.severity) === 'error') summary[key].errors += 1
    if (normalizeSeverity(item.severity) === 'warning') summary[key].warnings += 1
  }
  return summary
}

function buildEvidencePolicy(findings = []) {
  return {
    ranking: 'top_findings is evidence-first and does not demote temp/fixture/adversarial paths. production_first is provided separately.',
    classification: 'classification is a confidence/context label, not a direct edit instruction. DOM/CSS/IPC/state findings are candidates until source/runtime counter-evidence is checked.',
    completeness: findings.length > 80
      ? `Only compact samples are embedded in tool history; read evidence_bundle/raw-findings.json or the classified markdown files before making an exhaustive conclusion. Total findings: ${findings.length}.`
      : 'All findings fit within the compact tool result sample.',
    rule: 'Do not dismiss a finding only because it is under temp, fixture, backup, adversarial, test, or sample paths; also do not claim a candidate is real until dynamic DOM, conditional mount, IPC registration, and runtime paths have been checked when relevant.',
    counter_evidence: 'For every needs_verification or possible_false_positive item, look for code that creates the target dynamically, alternate entry files, guarded execution paths, tests/fixtures, and runtime logs before presenting it as a confirmed bug.'
  }
}

function buildCapabilityCoverage(findings = []) {
  const observed = new Set(findings.map(item => item.type).filter(Boolean))
  const matched = HEALTH_SCAN_CAPABILITY_TYPES.filter(type => observed.has(type))
  return {
    tracked_types: HEALTH_SCAN_CAPABILITY_TYPES.length,
    matched_types: matched.length,
    matched,
    unmatched_tracked_types: HEALTH_SCAN_CAPABILITY_TYPES.filter(type => !observed.has(type))
  }
}

function buildRuntimeVerificationTasks(logicReview = {}, projectPath = '') {
  return (Array.isArray(logicReview.ui_behavior_verification) ? logicReview.ui_behavior_verification : [])
    .slice(0, 8)
    .map(item => {
      const source = item.source || null
      const args = { ...(item.suggested_args || {}) }
      const sourcePath = source?.path || ''
      if (projectPath && /\.(html|htm)$/i.test(sourcePath)) {
        args.html_path = path.join(projectPath, sourcePath)
        delete args.target
      }
      return {
        type: 'runtime_verify',
        reason: item.reason || 'UI click/state behavior requires executable verification.',
        source,
        lifecycle: item.lifecycle_to_verify || ['open', 'keep-visible-after-open', 'close', 'repeat-open', 'console-errors-after-observation'],
        tool: 'runtime_verify',
        args
      }
    })
}

function sanitizeRunIdPart(value = '') {
  return String(value || '')
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'project'
}

function toMarkdownPath(value = '') {
  return String(value || '').replace(/\\/g, '/')
}

function isFixtureOrTempPath(filePath = '') {
  const normalized = toMarkdownPath(filePath).toLowerCase()
  return /(^|\/)(temp|tmp|backup|backups|fixtures|fixture|adversarial-fixtures|real-scenarios|__tests__|tests|test|spec|mocks?|samples?)(\/|$)/.test(normalized) ||
    /(^|\/|\.)adversarial[_-]/.test(normalized) ||
    /backup-\d|bad-backup|repair-backup|\.bak$|\.backup$/i.test(normalized)
}

function isScannerSelfFinding(item = {}) {
  const filePath = toMarkdownPath(item.path || item.file || '').toLowerCase()
  const message = String(item.message || '')
  const evidence = String(item.evidence || '')
  return /(^|\/)(project-health-scan|tool-handlers\/diagnostics|diagnostics)\.js$/.test(filePath) &&
    /(Promise\.resolve\(\)\.catch|length < 0|projectId \|\| fallback|actualProjectPath|scanner|scan)/i.test(`${message}\n${evidence}`)
}

function isNeedsVerificationFinding(item = {}) {
  const type = String(item.type || '')
  const source = String(item.source || '')
  if (/commonjs-circular-require|dom-css|hidden-property|overlay|runtime|ipc|renderer-event|preload-exposes|missing-ipc|state|async|timer|event-listener/i.test(type)) return true
  if (/runtime|ipc|dom|ui|event|state|async|timer/i.test(source)) return true
  return false
}

function isHighConfidenceProductionFinding(item = {}) {
  const type = String(item.type || '')
  if (isFixtureOrTempPath(item.path || item.file || '')) return false
  if (isScannerSelfFinding(item)) return false
  if ([
    'impossible-length-condition',
    'dead-error-handler',
    'response-body-consumed-twice',
    'shell-command-string-interpolation-risk',
    'cors-wildcard-origin-with-credentials',
    'duplicate-yaml-key-overrides-value',
    'env-var-name-drift',
    'async-foreach-not-awaited',
    'array-fill-shared-reference',
    'python-mutable-default-argument',
    'jwt-decoded-without-signature-verification',
    'static-iv-or-salt-for-encryption'
  ].includes(type)) return true
  return false
}

function classifyHealthFinding(item = {}) {
  if (item.type === 'project-path-storage-path-confusion') return 'needs_verification'
  const pathValue = item.path || item.file || ''
  if (isFixtureOrTempPath(pathValue)) return 'fixtures_and_temp'
  if (isScannerSelfFinding(item)) return 'possible_false_positive'
  if (isHighConfidenceProductionFinding(item)) return 'confirmed_production'
  if (isNeedsVerificationFinding(item)) return 'needs_verification'
  return normalizeSeverity(item.severity) === 'error' ? 'needs_verification' : 'possible_false_positive'
}

function groupHealthFindings(findings = []) {
  const groups = {
    confirmed_production: [],
    needs_verification: [],
    possible_false_positive: [],
    fixtures_and_temp: []
  }
  for (const item of findings) {
    const key = classifyHealthFinding(item)
    groups[key].push(item)
  }
  return groups
}

function formatFindingLine(item = {}, index = 0) {
  const location = [item.path || item.file || '', item.line ? `L${item.line}` : ''].filter(Boolean).join(':')
  const type = item.type ? ` [${item.type}]` : ''
  const severity = normalizeSeverity(item.severity).toUpperCase()
  const message = clip(item.message || '', 220)
  const evidence = item.evidence ? `\n  - evidence: ${clip(item.evidence, 260)}` : ''
  const suggestion = item.suggestion ? `\n  - suggestion: ${clip(item.suggestion, 220)}` : ''
  return `${index + 1}. ${severity}${type} ${location}\n  - ${message}${evidence}${suggestion}`
}

function writeMarkdownFile(filePath, title, intro, findings = [], options = {}) {
  const limit = Number(options.limit || 120)
  const shown = findings.slice(0, limit)
  const body = [
    `# ${title}`,
    '',
    intro,
    '',
    `Total: ${findings.length}`,
    shown.length < findings.length ? `Shown: ${shown.length} (see raw-findings.json for full data)` : `Shown: ${shown.length}`,
    '',
    ...shown.map(formatFindingLine)
  ].join('\n')
  fs.writeFileSync(filePath, body, 'utf-8')
}

function cleanupExpiredDiagnosticBundles(rootDir, keepMs = 24 * 60 * 60 * 1000) {
  try {
    if (!fs.existsSync(rootDir)) return
    const now = Date.now()
    for (const item of fs.readdirSync(rootDir, { withFileTypes: true })) {
      if (!item.isDirectory()) continue
      const fullPath = path.join(rootDir, item.name)
      const stat = fs.statSync(fullPath)
      if (now - stat.mtimeMs > keepMs) fs.rmSync(fullPath, { recursive: true, force: true })
    }
  } catch (_) {
    // Best effort cleanup only.
  }
}

function buildDiagnosticBundle(projectPath = '', findings = [], result = {}) {
  if (!projectPath || !findings.length) return null
  const rootDir = path.join(projectPath, '.lingxi-temp-diagnostics')
  cleanupExpiredDiagnosticBundles(rootDir)

  const runId = `${Date.now()}-${sanitizeRunIdPart(path.basename(projectPath))}`
  const bundleDir = path.join(rootDir, runId)
  fs.mkdirSync(bundleDir, { recursive: true })

  const groups = groupHealthFindings(findings)
  const files = {
    manifest: path.join(bundleDir, 'manifest.md'),
    confirmed_production: path.join(bundleDir, 'confirmed-production.md'),
    needs_verification: path.join(bundleDir, 'needs-verification.md'),
    possible_false_positive: path.join(bundleDir, 'possible-false-positive.md'),
    fixtures_and_temp: path.join(bundleDir, 'fixtures-and-temp.md'),
    raw_findings: path.join(bundleDir, 'raw-findings.json')
  }

  const counts = Object.fromEntries(Object.entries(groups).map(([key, value]) => [key, value.length]))
  const pathClassSummary = summarizeByPathClass(findings)
  const evidencePolicy = buildEvidencePolicy(findings)
  const manifest = [
    '# Lingxi Diagnostic Evidence Bundle',
    '',
    `Run ID: ${runId}`,
    `Project: ${projectPath}`,
    `Total findings: ${findings.length}`,
    `Errors: ${result.error_count || 0}`,
    `Warnings: ${result.warning_count || 0}`,
    `Ranking policy: ${evidencePolicy.ranking}`,
    '',
    '## Classification',
    '',
    `- confirmed-production.md: ${counts.confirmed_production} high-confidence production findings.`,
    `- needs-verification.md: ${counts.needs_verification} findings that require code/runtime/contract verification before claiming them as real bugs.`,
    `- possible-false-positive.md: ${counts.possible_false_positive} scanner-self, broad-pattern, or low-confidence findings.`,
    `- fixtures-and-temp.md: ${counts.fixtures_and_temp} findings under test fixtures, temp, backup, or adversarial files. This is a source label, not an ignore label.`,
    `- raw-findings.json: complete raw findings; classification never deletes evidence.`,
    '',
    '## Evidence Policy',
    '',
    `- ${evidencePolicy.classification}`,
    `- ${evidencePolicy.completeness}`,
    `- ${evidencePolicy.rule}`,
    `- ${evidencePolicy.counter_evidence}`,
    '',
    '## Reading Order For AI',
    '',
    '1. Read this manifest first.',
    '2. Read Top Findings below first; it is evidence-first and includes high-risk findings from every path class.',
    '3. Read confirmed-production.md for production-like high-confidence findings.',
    '4. Read needs-verification.md for runtime/UI/IPC/state/path items and gather extra evidence.',
    '5. Read fixtures-and-temp.md whenever the user scans a whole directory, a test field, a backup, or asks whether scanner coverage is working.',
    '6. Use possible-false-positive.md to avoid overclaiming; do not ignore it when the user asks for exhaustive review.',
    '',
    '## Path Class Summary',
    '',
    '```json',
    JSON.stringify(pathClassSummary, null, 2),
    '```',
    '',
    '## Top Findings',
    '',
    ...buildTopFindings(findings, 12).map(formatFindingLine)
  ].join('\n')

  fs.writeFileSync(files.manifest, manifest, 'utf-8')
  writeMarkdownFile(files.confirmed_production, 'Confirmed Production Findings', 'High-confidence findings in non-fixture paths. Still verify snippets before editing.', groups.confirmed_production)
  writeMarkdownFile(files.needs_verification, 'Needs Verification Findings', 'Potentially real findings that need call-chain, runtime, DOM, IPC, or state evidence before final conclusions.', groups.needs_verification)
  writeMarkdownFile(files.possible_false_positive, 'Possible False Positives', 'Low-confidence or scanner-self findings. Do not present these as confirmed bugs without additional evidence.', groups.possible_false_positive)
  writeMarkdownFile(files.fixtures_and_temp, 'Fixtures And Temp Findings', 'Findings under fixtures/temp/backup/adversarial paths. These are preserved as first-class evidence; verify against user intent instead of dismissing by directory name.', groups.fixtures_and_temp)
  fs.writeFileSync(files.raw_findings, JSON.stringify(findings.map(annotateFinding), null, 2), 'utf-8')

  return {
    run_id: runId,
    dir: bundleDir,
    manifest_path: files.manifest,
    files,
    counts,
    path_class_summary: pathClassSummary,
    evidence_policy: evidencePolicy,
    cleanup: {
      auto_expire_hours: 24,
      note: 'Temporary diagnostic bundles are best-effort cleaned on future scans; delete this run directory after final reply if strict cleanup is required.'
    }
  }
}

async function runProjectHealthScan(options = {}) {
  const diagnostics = options.diagnostics || {}
  const projectPath = options.projectPath || ''
  const findings = []

  const syntax = diagnostics.syntax || null
  if (syntax) collectSyntaxFindings(syntax, findings)

  const logicReview = diagnostics.logicReview || null
  if (logicReview) {
    collectLogicFindings(logicReview, findings)
    collectUiRuntimeVerificationFindings(logicReview, findings)
  }

  const runtime = diagnostics.runtime || summarizeRuntime({
    since_ms: options.runtime_since_ms || options.runtimeSinceMs || 10 * 60 * 1000,
    limit: options.runtime_limit || options.runtimeLimit || 80,
    include_info: false
  })
  collectRuntimeFindings(runtime, findings)
  collectRuntimeProbeFindings(diagnostics.runtimeProbe || null, findings)
  collectRuntimeClosureFindings(diagnostics.runtimeClosure || null, findings)
  collectProjectLogRuntimeFindings(projectPath, findings)

  if (options.include_ipc !== false && projectPath) collectIpcContractFindings(projectPath, findings, options)
  if (projectPath) {
    collectDomBindingFindings(projectPath, findings)
    collectOverlayClickBlockerFindings(projectPath, findings)
    collectUiRootCauseTraceFindings(projectPath, findings)
    collectGenericLogicFindings(projectPath, findings, options)
    collectApiContractFindings(projectPath, findings, options)
    collectRedundancyFindings(projectPath, findings)
  }

  const errorCount = findings.filter(item => normalizeSeverity(item.severity) === 'error').length
  const warningCount = findings.filter(item => normalizeSeverity(item.severity) === 'warning').length
  const topLimit = options.top_limit || 20
  const topFindings = buildTopFindings(findings, topLimit).map(annotateFinding)
  const findingViews = buildFindingViews(findings, topLimit)
  const pathClassSummary = summarizeByPathClass(findings)
  const evidencePolicy = buildEvidencePolicy(findings)
  const partialResult = { error_count: errorCount, warning_count: warningCount }
  const evidenceBundle = buildDiagnosticBundle(projectPath, findings, partialResult)

  return {
    success: true,
    ok: errorCount === 0,
    project_path: projectPath,
    categories: summarizeByCategory(findings),
    error_count: errorCount,
    warning_count: warningCount,
    finding_count: findings.length,
    capability_coverage: buildCapabilityCoverage(findings),
    top_findings: topFindings,
    finding_views: findingViews,
    path_class_summary: pathClassSummary,
    evidence_policy: evidencePolicy,
    findings,
    evidence_bundle: evidenceBundle,
    read_hints: buildReadHints(topFindings),
    runtime_verification_tasks: buildRuntimeVerificationTasks(diagnostics.logicReview || {}, projectPath),
    runtime,
    safety: {
      launched_process: false,
      launch_policy: 'observe_existing_runtime_only',
      note: 'This scan does not start another project process. It uses captured Electron/F12/main-process runtime diagnostics to avoid terminal/process conflicts.'
    },
    next_action: errorCount
      ? 'Fix top_findings with severity=error first, then rerun dev_workflow mode=health.'
      : (warningCount
        ? 'Review warnings that match the user-visible bug before editing; do not treat syntax pass as behavior pass.'
        : 'No project-health findings from the enabled scanners.')
  }
}

function runProjectHealthScanInWorker(options = {}) {
  if (!isMainThread || options.disable_worker === true || options.disableWorker === true) {
    return runProjectHealthScan(options)
  }

  return new Promise((resolve) => {
    let settled = false
    const timeoutMs = Math.max(5000, Math.min(120000, Number(options.worker_timeout_ms || options.workerTimeoutMs || 90000) || 90000))
    const worker = new Worker(path.join(__dirname, 'project-health-scan-worker.js'), {
      workerData: { options }
    })

    const finish = (value) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      worker.removeAllListeners()
      resolve(value)
    }

    const timer = setTimeout(() => {
      worker.terminate().catch(() => {})
      finish({
        success: false,
        ok: false,
        project_path: options.projectPath || '',
        categories: {},
        error_count: 1,
        warning_count: 0,
        finding_count: 1,
        capability_coverage: buildCapabilityCoverage([{ type: 'project-health-worker-timeout' }]),
        top_findings: [{
          severity: 'error',
          category: 'runtime',
          type: 'project-health-worker-timeout',
          path: '',
          line: null,
          message: `Project health scan worker timed out after ${timeoutMs}ms.`,
          suggestion: 'Retry with a narrower project_path or roots; the UI process was not blocked.',
          source: 'project-health-worker'
        }],
        findings: [],
        read_hints: [],
        runtime_verification_tasks: [],
        runtime: null,
        safety: {
          launched_process: false,
          launch_policy: 'worker_thread_scan',
          note: 'Health scan timed out in a worker thread; main Electron window stayed responsive.'
        },
        next_action: 'Retry health scan with a narrower scope or inspect worker timeout cause.'
      })
    }, timeoutMs)

    worker.once('message', (message = {}) => {
      if (message.success === false) {
        finish({
          success: false,
          ok: false,
          project_path: options.projectPath || '',
          categories: {},
          error_count: 1,
          warning_count: 0,
          finding_count: 1,
          capability_coverage: buildCapabilityCoverage([{ type: 'project-health-worker-error' }]),
          top_findings: [{
            severity: 'error',
            category: 'runtime',
            type: 'project-health-worker-error',
            path: '',
            line: null,
            message: message.error || 'Project health scan worker failed.',
            evidence: message.stack || '',
            suggestion: 'Fix the worker-side scanner error, then rerun dev_workflow mode=health.',
            source: 'project-health-worker'
          }],
          findings: [],
          read_hints: [],
          runtime_verification_tasks: [],
          runtime: null,
          safety: {
            launched_process: false,
            launch_policy: 'worker_thread_scan',
            note: 'Health scan failed in a worker thread; main Electron window stayed responsive.'
          },
          next_action: 'Inspect project-health-worker-error before trusting scan coverage.'
        })
        return
      }
      finish(message.result)
    })

    worker.once('error', (error) => {
      finish({
        success: false,
        ok: false,
        project_path: options.projectPath || '',
        categories: {},
        error_count: 1,
        warning_count: 0,
        finding_count: 1,
        capability_coverage: buildCapabilityCoverage([{ type: 'project-health-worker-error' }]),
        top_findings: [{
          severity: 'error',
          category: 'runtime',
          type: 'project-health-worker-error',
          path: '',
          line: null,
          message: error.message,
          evidence: error.stack || '',
          suggestion: 'Fix the worker startup error, then rerun dev_workflow mode=health.',
          source: 'project-health-worker'
        }],
        findings: [],
        read_hints: [],
        runtime_verification_tasks: [],
        runtime: null,
        safety: {
          launched_process: false,
          launch_policy: 'worker_thread_scan',
          note: 'Health scan failed in a worker thread; main Electron window stayed responsive.'
        },
        next_action: 'Inspect project-health-worker-error before trusting scan coverage.'
      })
    })

    worker.once('exit', (code) => {
      if (code === 0 || settled) return
      finish({
        success: false,
        ok: false,
        project_path: options.projectPath || '',
        categories: {},
        error_count: 1,
        warning_count: 0,
        finding_count: 1,
        capability_coverage: buildCapabilityCoverage([{ type: 'project-health-worker-exit' }]),
        top_findings: [{
          severity: 'error',
          category: 'runtime',
          type: 'project-health-worker-exit',
          path: '',
          line: null,
          message: `Project health scan worker exited with code ${code}.`,
          suggestion: 'Retry once; if it repeats, inspect project-health-scan-worker.js and project-health-scan.js.',
          source: 'project-health-worker'
        }],
        findings: [],
        read_hints: [],
        runtime_verification_tasks: [],
        runtime: null,
        safety: {
          launched_process: false,
          launch_policy: 'worker_thread_scan',
          note: 'Health scan worker exited unexpectedly; main Electron window stayed responsive.'
        },
        next_action: 'Inspect project-health-worker-exit before trusting scan coverage.'
      })
    })
  })
}

module.exports = {
  runProjectHealthScan,
  runProjectHealthScanInWorker,
  collectRuntimeFindings,
  collectRuntimeProbeFindings,
  collectRuntimeClosureFindings,
  collectSyntaxFindings,
  collectLogicFindings,
  collectIpcContractFindings,
  collectProjectLogRuntimeFindings,
  collectUiRuntimeVerificationFindings,
  collectDomBindingFindings,
  collectOverlayClickBlockerFindings,
  collectUiRootCauseTraceFindings,
  collectGenericLogicFindings,
  collectApiContractFindings,
  HEALTH_SCAN_CAPABILITY_TYPES
}
