function clip(value = '', max = 260) {
  const text = String(value == null ? '' : value)
  return text.length > max ? `${text.slice(0, max)}...[truncated ${text.length - max} chars]` : text
}

function normalizeSeverity(value = '') {
  const text = String(value || '').toLowerCase()
  if (['critical', 'fatal', 'error', 'high'].includes(text)) return 'error'
  if (['warn', 'warning', 'medium'].includes(text)) return 'warning'
  return 'info'
}

function pushUnique(list, item = {}, keyFields = ['type', 'path', 'line', 'claim', 'text']) {
  if (!item || typeof item !== 'object') return
  const key = keyFields.map(field => String(item[field] || '')).join('|')
  if (list.some(existing => keyFields.map(field => String(existing[field] || '')).join('|') === key)) return
  list.push(item)
}

function findingText(item = {}) {
  return [
    item.type,
    item.category,
    item.path,
    item.message,
    item.evidence,
    item.suggestion,
    item.source
  ].filter(Boolean).join('\n')
}

function compactFinding(item = {}) {
  return {
    severity: normalizeSeverity(item.severity),
    type: item.type || 'finding',
    category: item.category || '',
    path: item.path || item.file || '',
    line: item.line || null,
    message: clip(item.message || ''),
    evidence: clip(item.evidence || item.detail || ''),
    source: item.source || ''
  }
}

function collectFindings(result = {}) {
  const findings = []
  const add = item => {
    if (!item || typeof item !== 'object') return
    findings.push(compactFinding(item))
  }
  ;(result.health?.top_findings || []).forEach(add)
  ;(result.health?.finding_views?.needs_verification || []).forEach(add)
  ;(result.health?.finding_views?.confirmed_production || []).forEach(add)
  ;(result.logic_review?.findings || []).forEach(add)
  ;(result.syntax?.failed_files || []).forEach(file => {
    const firstError = Array.isArray(file.errors) ? file.errors[0] : null
    add({
      severity: 'error',
      type: 'syntax-error',
      category: 'syntax',
      path: file.relative_path || file.path,
      line: firstError?.line || firstError?.loc?.line || null,
      message: firstError?.message || 'Syntax check failed.',
      evidence: file.code_frame?.content || '',
      source: 'check_project_syntax'
    })
  })
  ;(result.runtimeDiagnostics?.events || []).forEach(event => {
    add({
      severity: event.severity || 'error',
      type: event.type || 'runtime-diagnostic',
      category: 'runtime',
      path: event.sourceId || event.url || '',
      line: event.line || null,
      message: event.message || '',
      evidence: [event.source, event.title, event.url].filter(Boolean).join(' | '),
      source: 'runtime-diagnostics'
    })
  })
  ;(result.runtimeProbe?.events || []).forEach(add)
  ;(result.runtimeClosure?.events || []).forEach(add)

  const seen = new Set()
  return findings.filter(item => {
    const key = `${item.type}|${item.path}|${item.line}|${item.message}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function inferIssueSignals(query = '', findings = []) {
  const text = `${query}\n${findings.map(findingText).join('\n')}`.toLowerCase()
  const signals = []
  const add = (key, label, pattern) => {
    if (pattern.test(text)) signals.push({ key, label })
  }
  add('ui_runtime', 'UI/runtime interaction', /click|button|modal|panel|\bdom\b|\bcss\b|selector|render|visible|hidden|\bui\b|frontend|页面|界面|点击|按钮|弹窗|面板|渲染|显示|不见|隐藏/)
  add('state_lifecycle', 'state/lifecycle ordering', /state|cache|session|projectid|activeproject|history|runtime|restore|replay|timer|async|race|状态|缓存|会话|项目切换|历史|恢复|回放|竞态|异步|时序/)
  add('ipc_contract', 'IPC/API contract', /\bipc\b|invoke|handle\(|preload|contextbridge|\bapi\b|route|handler|schema|contract|接口|契约|调用/)
  add('syntax_build', 'syntax/build', /syntax|\bparse\b|\bcompile\b|\bbuild\b|node --check|\btsc\b|\beslint\b|语法|编译|构建/)
  add('search_recall', 'search/location quality', /search|grep|rg|codemap|candidate|locate|find|搜索|召回|定位|代码地图/)
  add('storage_path', 'storage/path/config', /storage|path|config|persist|fs\.|readfile|writefile|保存|加载|路径|配置|持久化/)
  return signals
}

function confidenceFromEvidence(evidenceCount = 0, hasRuntime = false, hasSyntax = false) {
  if (hasRuntime || hasSyntax || evidenceCount >= 4) return 'medium'
  if (evidenceCount >= 2) return 'low-medium'
  return 'low'
}

function buildHypotheses({ query = '', findings = [], signals = [], discovery = null } = {}) {
  const hypotheses = []
  const byCategory = new Map()
  for (const finding of findings) {
    const key = finding.category || 'unknown'
    if (!byCategory.has(key)) byCategory.set(key, [])
    byCategory.get(key).push(finding)
  }

  for (const [category, items] of byCategory.entries()) {
    const top = items.slice(0, 4)
    pushUnique(hypotheses, {
      claim: `${category} evidence may be relevant to the user-visible failure.`,
      confidence: confidenceFromEvidence(top.length, category === 'runtime', category === 'syntax'),
      evidence: top.map(item => ({
        type: item.type,
        path: item.path,
        line: item.line,
        message: item.message
      })),
      counter_evidence_needed: [
        'Confirm the matched code is on the real user-triggered path.',
        'Check whether another state source or caller overwrites this path later.',
        'Verify with a narrow repro or runtime check before treating this as root cause.'
      ]
    }, ['claim'])
  }

  if (signals.some(item => item.key === 'state_lifecycle')) {
    const stateEvidence = findings
      .filter(item => /state|cache|session|history|runtime|restore|replay|project|storage/i.test(findingText(item)))
      .slice(0, 5)
    pushUnique(hypotheses, {
      claim: 'The failure may involve multiple state sources or lifecycle ordering.',
      confidence: confidenceFromEvidence(stateEvidence.length, false, false),
      evidence: stateEvidence.map(item => ({
        type: item.type,
        path: item.path,
        line: item.line,
        message: item.message
      })),
      counter_evidence_needed: [
        'Identify the authoritative source for the visible state.',
        'Compare persisted data, runtime cache, queue/state objects, and rendered DOM after the same transition.',
        'Check whether restore/replay code runs before or after history rendering.'
      ]
    }, ['claim'])
  }

  if (signals.some(item => item.key === 'ui_runtime')) {
    const uiEvidence = findings
      .filter(item => /dom|css|ui|selector|event|runtime|render|visible|hidden|overlay/i.test(findingText(item)))
      .slice(0, 5)
    pushUnique(hypotheses, {
      claim: 'The failure may require a real UI/runtime check, not only syntax or static review.',
      confidence: confidenceFromEvidence(uiEvidence.length, true, false),
      evidence: uiEvidence.map(item => ({
        type: item.type,
        path: item.path,
        line: item.line,
        message: item.message
      })),
      counter_evidence_needed: [
        'Trigger the real UI action and inspect DOM state after the transition.',
        'Check console/runtime errors from the same project context.',
        'Confirm computed visibility, event binding, and data source after interaction.'
      ]
    }, ['claim'])
  }

  const evidenceFileCount = Array.isArray(discovery?.evidenceFiles || discovery?.candidates) ? (discovery.evidenceFiles || discovery.candidates).length : 0
  const evidenceRefCount = Array.isArray(discovery?.evidenceRefs || discovery?.readHints) ? (discovery.evidenceRefs || discovery.readHints).length : 0
  if (evidenceFileCount || evidenceRefCount) {
    pushUnique(hypotheses, {
      claim: 'Discovery returned factual evidence files, but relevance still requires source verification.',
      confidence: discovery?.quality?.level === 'strong' ? 'medium' : 'low-medium',
      evidence: (discovery.evidenceFiles || discovery.candidates || []).slice(0, 5).map(item => ({
        path: item.path,
        score: item.score,
        sources: item.sources
      })),
      counter_evidence_needed: [
        'Read focused evidence refs before editing.',
        'Confirm the evidence files are implementation files, not only tests, docs, or search infrastructure.',
        'If snippets do not match the symptom, choose better concrete search terms instead of forcing this route.'
      ]
    }, ['claim'])
  }

  if (!hypotheses.length && query) {
    hypotheses.push({
      claim: 'The scan did not prove a root cause yet; treat this as a starting map only.',
      confidence: 'low',
      evidence: [],
      counter_evidence_needed: [
        'Find the real entry path from the user action or error text.',
        'Read candidate source before changing behavior.',
        'Create or run a narrow verification that would fail before the fix.'
      ]
    })
  }

  return hypotheses.slice(0, 8)
}

function buildObservations(result = {}, findings = []) {
  const observations = []
  if (result.discovery?.quality) {
    observations.push({
      type: 'discovery_quality',
      text: `Discovery quality is ${result.discovery.quality.level || 'unknown'} with score ${result.discovery.quality.score ?? 'unknown'}.`,
      evidence: {
        topPath: result.discovery.quality.topPath || '',
        evidenceCount: result.discovery.quality.evidenceCount || 0
      }
    })
  }
  if (result.syntax) {
    observations.push({
      type: 'syntax_scan',
      text: result.syntax.ok
        ? `Syntax scan passed for ${result.syntax.checked_count || 0} files.`
        : `Syntax scan found ${result.syntax.failed_count || 0} failed files.`,
      evidence: {
        checked_count: result.syntax.checked_count || 0,
        failed_count: result.syntax.failed_count || 0
      }
    })
  }
  if (result.health) {
    observations.push({
      type: 'health_scan',
      text: `Health scan reported ${result.health.error_count || 0} errors and ${result.health.warning_count || 0} warnings.`,
      evidence: {
        categories: result.health.categories || {},
        finding_count: result.health.finding_count || 0
      }
    })
  }
  if (result.logic_review) {
    observations.push({
      type: 'logic_review',
      text: `Logic review scanned ${result.logic_review.reviewed_count || 0} files and found ${result.logic_review.error_count || 0} high-risk items.`,
      evidence: {
        scope: result.logic_review.scope || '',
        warning_count: result.logic_review.warning_count || 0
      }
    })
  }
  if (result.runtimeDiagnostics) {
    observations.push({
      type: 'runtime_diagnostics',
      text: `Runtime diagnostics currently has ${result.runtimeDiagnostics.error_count || 0} errors.`,
      evidence: {
        unavailable: !!result.runtimeDiagnostics.unavailable,
        error: result.runtimeDiagnostics.error || ''
      }
    })
  }
  if (findings.length) {
    observations.push({
      type: 'top_evidence',
      text: `${findings.length} compact evidence items were collected for model review.`,
      evidence: findings.slice(0, 5)
    })
  }
  return observations
}

function buildEvidenceGaps({ result = {}, query = '', signals = [] } = {}) {
  const gaps = []
  const hasRuntimeSignal = signals.some(item => item.key === 'ui_runtime' || item.key === 'state_lifecycle')
  if (query && !result.discovery) {
    gaps.push({
      area: 'location',
      missing: 'No discovery result is attached.',
      why_it_matters: 'The model should not infer files only from names or past memory.'
    })
  }
  if (hasRuntimeSignal && !result.runtimeProbe && !result.runtimeClosure) {
    gaps.push({
      area: 'runtime',
      missing: 'No live runtime probe or UI closure check is attached.',
      why_it_matters: 'UI, lifecycle, and state ordering bugs often pass static scans.'
    })
  }
  if (result.discovery && !(result.discovery.evidenceRefs || result.discovery.readHints || []).length && !(result.discovery.focusedSnippets || []).length) {
    gaps.push({
      area: 'source_verification',
      missing: 'Discovery has no focused evidence refs or snippets.',
      why_it_matters: 'Path evidence alone is not enough to justify a code edit.'
    })
  }
  if (result.health?.runtime_verification_tasks?.length) {
    gaps.push({
      area: 'behavior_verification',
      missing: 'Health scan produced UI/runtime verification tasks that have not been executed in this result.',
      why_it_matters: 'These tasks are proof options, not confirmed bugs.'
    })
  }
  if (!result.syntax && ['health', 'triage', 'syntax'].includes(result.mode)) {
    gaps.push({
      area: 'syntax',
      missing: 'No syntax scan summary is attached.',
      why_it_matters: 'Syntax failures can mask deeper runtime diagnosis.'
    })
  }
  return gaps.slice(0, 8)
}

function buildVerificationOptions({ result = {}, signals = [] } = {}) {
  const options = []
  const discoveryEvidenceRefs = result.discovery?.evidenceRefs || result.discovery?.readHints || []
  if (discoveryEvidenceRefs.length) {
    options.push({
      kind: 'source_read',
      description: 'Read the focused evidence snippets and decide whether they are on the real failing path.',
      evidence_refs: discoveryEvidenceRefs.slice(0, 5)
    })
  }
  if (result.syntax?.failed_count > 0) {
    options.push({
      kind: 'syntax_recheck',
      description: 'Use the syntax code frames as evidence for a minimal syntax repair, then rerun the same syntax scan.',
      evidence_refs: (result.syntax.code_frames || []).slice(0, 4)
    })
  }
  if (result.health?.runtime_verification_tasks?.length) {
    options.push({
      kind: 'runtime_behavior_check',
      description: 'Run one narrow UI/runtime verification task only if it matches the user-visible symptom.',
      evidence_refs: result.health.runtime_verification_tasks.slice(0, 4)
    })
  }
  if (signals.some(item => item.key === 'state_lifecycle')) {
    options.push({
      kind: 'state_source_audit',
      description: 'Compare persisted state, runtime cache, queues, and rendered DOM after the same user transition.',
      evidence_refs: []
    })
  }
  if (signals.some(item => item.key === 'ipc_contract')) {
    options.push({
      kind: 'contract_trace',
      description: 'Trace provider and consumer names, payload shape, and failure handling before changing either side.',
      evidence_refs: []
    })
  }
  if (!options.length) {
    options.push({
      kind: 'narrow_repro',
      description: 'Create or run the smallest scenario that proves the described failure before editing broadly.',
      evidence_refs: []
    })
  }
  return options.slice(0, 8)
}

function buildEvidenceQueries(result = {}) {
  const queries = []
  const push = item => {
    const text = String(item || '').trim()
    if (!text || queries.includes(text)) return
    queries.push(text)
  }
  ;(result.discovery?.evidenceRefs || result.discovery?.readHints || []).slice(0, 6).forEach(item => push(item.path))
  ;(result.discovery?.evidenceFiles || result.discovery?.candidates || []).slice(0, 6).forEach(item => push(item.path))
  ;(result.health?.read_hints || []).slice(0, 6).forEach(item => push(item.path))
  collectFindings(result).slice(0, 8).forEach(item => {
    push(item.path)
    push(item.type)
  })
  return queries.slice(0, 16)
}

function buildDiagnosticNavigation(result = {}, options = {}) {
  const query = String(options.query || result.query || '').trim()
  const findings = collectFindings(result)
  const signals = inferIssueSignals(query, findings)
  const observations = buildObservations(result, findings)
  const hypotheses = buildHypotheses({
    query,
    findings,
    signals,
    discovery: result.discovery || null
  })
  const evidenceGaps = buildEvidenceGaps({ result, query, signals })
  const verificationOptions = buildVerificationOptions({ result, signals })
  const highEvidence = findings.some(item => normalizeSeverity(item.severity) === 'error' && /syntax|runtime/i.test(`${item.category} ${item.source} ${item.type}`))

  return {
    kind: 'diagnostic_evidence_package',
    is_instruction: false,
    confidence_policy: 'Conservative: high confidence requires a repro, stack/runtime event, syntax failure, or source-confirmed contract break. Otherwise treat claims as hypotheses.',
    model_judgment_required: true,
    caution: 'This package is evidence and verification material only. It is not an instruction to edit a specific file or follow a fixed path. If source/runtime evidence conflicts with this package, trust the source/runtime evidence.',
    query,
    mode: result.mode || '',
    issue_signals: signals,
    confidence: highEvidence ? 'medium' : (findings.length >= 4 ? 'low-medium' : 'low'),
    observations,
    hypotheses,
    evidence_gaps: evidenceGaps,
    verification_options: verificationOptions,
    evidence_queries: buildEvidenceQueries(result),
    source_summary: {
      has_discovery: !!result.discovery,
      has_syntax: !!result.syntax,
      has_logic_review: !!result.logic_review,
      has_health: !!result.health,
      has_runtime_diagnostics: !!result.runtimeDiagnostics,
      has_runtime_probe: !!result.runtimeProbe,
      has_runtime_closure: !!result.runtimeClosure,
      evidence_count: findings.length
    }
  }
}

module.exports = {
  buildDiagnosticNavigation,
  collectFindings,
  inferIssueSignals
}
