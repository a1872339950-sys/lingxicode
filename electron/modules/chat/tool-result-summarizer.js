const { summarizePostEditDiagnostics } = require('./diagnostics-summarizer')
const { safeJsonStringify } = require('./json-utils')

const COMMAND_OUTPUT_TOOLS = new Set(['run_command', 'shell_run', 'terminal_status'])

function getToolRoute(result) {
  if (!result || typeof result !== 'object' || Array.isArray(result)) return null
  const route = result._tool_route
  if (!route || typeof route !== 'object' || !String(route.routed_tool || '').trim()) return null
  return route
}

function withoutToolRoute(result) {
  if (!result || typeof result !== 'object' || Array.isArray(result)) return result
  const next = { ...result }
  delete next._tool_route
  return next
}

function attachToolRoute(result, route) {
  if (result && typeof result === 'object' && !Array.isArray(result)) {
    return { ...result, _tool_route: route }
  }
  return { value: result, _tool_route: route }
}

function clipModelText(text = '', maxChars = 8000) {
  const value = String(text || '')
  const limit = Math.max(1000, Math.min(20000, Number(maxChars) || 8000))
  if (value.length <= limit) return { text: value, truncated: false }
  const headLength = Math.max(600, Math.floor(limit * 0.72))
  const tailLength = Math.max(300, limit - headLength - 140)
  return {
    text: `${value.slice(0, headLength)}\n...[truncated ${value.length - headLength - tailLength} chars; narrow with start_line/end_line or max_chars]\n${value.slice(-tailLength)}`,
    truncated: true
  }
}

function summarizeRuntimeSelector(item = {}, includeAncestors = false) {
  return {
    selector: item.selector,
    exists: item.exists,
    invalid: item.invalid,
    error: item.error,
    node: item.node,
    role: item.role,
    name: item.name,
    id: item.id,
    className: item.className,
    textSample: item.textSample,
    visible: item.visible ?? item.effectiveVisible,
    interactable: item.interactable,
    disabled: item.disabled,
    pointerBlocked: item.pointerBlocked,
    hiddenBy: item.hiddenBy,
    clippingAncestor: item.clippingAncestor,
    occludedBy: item.occludedBy,
    outsideViewport: item.outsideViewport,
    ancestorChain: includeAncestors && Array.isArray(item.ancestorChain) ? item.ancestorChain.slice(0, 10) : undefined
  }
}

function summarizeRuntimeState(state = {}) {
  if (!state || typeof state !== 'object') return undefined
  return {
    url: state.url,
    title: state.title,
    readyState: state.readyState,
    page: state.page,
    interactiveElements: Array.isArray(state.interactiveElements)
      ? state.interactiveElements.slice(0, 8).map(item => summarizeRuntimeSelector(item, false))
      : [],
    selectors: Array.isArray(state.selectors)
      ? state.selectors.slice(0, 12).map(item => summarizeRuntimeSelector(item, false))
      : []
  }
}

function summarizeRuntimeDiagnosis(diagnosis = {}) {
  if (!diagnosis || typeof diagnosis !== 'object') return undefined
  return {
    category: diagnosis.category,
    error_type: diagnosis.error_type,
    failed_stage: diagnosis.failed_stage,
    summary: diagnosis.summary,
    next_action: diagnosis.next_action,
    current_page: diagnosis.current_page,
    requested_locator: diagnosis.requested_locator,
    click_reason: diagnosis.click_reason,
    blocking_evidence: diagnosis.blocking_evidence ? {
      ...diagnosis.blocking_evidence,
      ancestorChain: Array.isArray(diagnosis.blocking_evidence.ancestorChain)
        ? diagnosis.blocking_evidence.ancestorChain.slice(0, 12)
        : diagnosis.blocking_evidence.ancestorChain
    } : undefined,
    click_candidates: Array.isArray(diagnosis.click_candidates)
      ? diagnosis.click_candidates.slice(0, 8).map(item => summarizeRuntimeSelector(item, false))
      : [],
    nearby_candidates: Array.isArray(diagnosis.nearby_candidates)
      ? diagnosis.nearby_candidates.slice(0, 12).map(item => summarizeRuntimeSelector(item, false))
      : [],
    expected_visible_state: diagnosis.expected_visible_state ? summarizeRuntimeSelector(diagnosis.expected_visible_state, true) : undefined,
    expected_hidden_state: diagnosis.expected_hidden_state ? summarizeRuntimeSelector(diagnosis.expected_hidden_state, true) : undefined
  }
}

function summarizeRuntimeEvent(item = {}) {
  if (typeof item === 'string') return item.slice(0, 600)
  return {
    severity: item.severity,
    type: item.type,
    message: String(item.message || item.text || item.error || '').slice(0, 800),
    source: item.source || item.sourceId || item.sourceURL || item.url,
    line: item.line || item.lineNumber || item.lineno,
    column: item.column || item.columnNumber || item.colno
  }
}

function summarizeReadFileForModel(result, maxChars = 8000) {
  const content = String(result?.content || '')
  const clipped = clipModelText(content, maxChars)
  return {
    success: result.success,
    path: result.path,
    requested_path: result.requested_path,
    resolved_path: result.resolved_path,
    file_type: result.file_type || (result.binary ? 'binary' : 'text'),
    binary: !!result.binary,
    coverage: result.coverage || (result.range_read ? 'partial' : 'full'),
    line_count: result.line_count,
    start_line: result.start_line || 1,
    end_line: result.end_line || result.line_count || null,
    length: result.full_length || result.length || content.length,
    byte_length: result.byte_length,
    truncated: !!result.truncated || clipped.truncated,
    content: clipped.text,
    error: result.error,
    error_type: result.error_type,
    nearest_paths: Array.isArray(result.nearest_candidates) ? result.nearest_candidates.slice(0, 8) : undefined
  }
}

function summarizeReadManyFilesForModel(result) {
  return {
    success: result.success,
    error: result.error,
    error_type: result.error_type,
    files: Array.isArray(result.files)
      ? result.files.slice(0, 20).map(file => summarizeReadFileForModel(file, 5000))
      : [],
    count: Array.isArray(result.files) ? result.files.length : 0,
    truncated: Array.isArray(result.files) && result.files.length > 20
  }
}

function summarizeFindInFileForModel(result) {
  return {
    success: result.success,
    path: result.path,
    pattern: result.pattern,
    regex: result.regex,
    case_sensitive: result.case_sensitive,
    totalMatches: result.totalMatches ?? result.total_matches ?? result.count,
    truncated: !!result.truncated,
    error: result.error,
    error_type: result.error_type,
    matches: Array.isArray(result.matches)
      ? result.matches.slice(0, 80).map(match => ({
        line: match.line ?? match.line_number,
        line_number: match.line_number ?? match.line,
        text: match.text,
        content: match.content,
        context: match.context,
        preview: match.preview
      }))
      : []
  }
}

function hasActionableDiscoveryResult(result = {}) {
  return [
    result.highConfidence,
    result.mediumConfidence,
    result.candidates,
    result.readHints,
    result.focusedSnippets,
    result.lineLocator,
    result.grep,
    result.glob,
    result.relatedFiles
  ].some(value => Array.isArray(value) && value.length > 0)
}

function getSearchGuidance(result = {}) {
  if (hasActionableDiscoveryResult(result)) {
    return {
      evidenceStatus: 'facts_available',
      guidance: 'Tool output is factual evidence only. Do not treat returned paths as recommendations; decide relevance from actual source, imports, links, script/style loading, and runtime behavior.'
    }
  }
  return {
    evidenceStatus: 'no_direct_evidence',
    guidance: 'No direct evidence was found for the supplied terms. The model should choose better concrete keywords, symbols, DOM ids, file names, or error text.'
  }
}

function summarizeToolResult(toolName, result) {
  // 如果结果很短（<200字符），直接返回
  const fullContent = JSON.stringify(result)
  if (fullContent.length < 200) return result

  // 根据工具类型生成摘要
  const summary = {
    success: result.success,
    status: result.status
  }
  if (result?.success === false || result?.error) {
    summary.error = result.error
    summary.error_type = result.error_type
    summary.requested_path = result.requested_path
    summary.resolved_path = result.resolved_path
    summary.project_root = result.project_root
      summary.nearest_paths = Array.isArray(result.nearest_candidates)
      ? result.nearest_candidates.slice(0, 8)
      : undefined
  }

  switch (toolName) {
    case 'mcp_aidev_workflow':
      summary.tool = 'mcp_aidev_workflow'
      summary.serverId = result.serverId
      summary.mode = result.mode
      summary.query = result.query
      summary.degraded = !!result.degraded
      summary.summary = result.summary || null
      summary.recovery = result.recovery ? {
        ensured: !!result.recovery.ensured,
        recovered: !!result.recovery.recovered,
        reason: result.recovery.reason,
        requestedBy: result.recovery.requestedBy,
        message: result.recovery.message,
        evidence: result.recovery.evidence ? {
          root: result.recovery.evidence.root,
          codeFileCount: result.recovery.evidence.codeFileCount,
          scannedFileCount: result.recovery.evidence.scannedFileCount,
          truncated: result.recovery.evidence.truncated,
          tooLargeForAutoIndex: result.recovery.evidence.tooLargeForAutoIndex,
          aimap: result.recovery.evidence.aimap,
          sampleFiles: Array.isArray(result.recovery.evidence.sampleFiles) ? result.recovery.evidence.sampleFiles.slice(0, 30) : []
        } : null
      } : null
      summary.steps = Array.isArray(result.steps) ? result.steps.slice(0, 16) : []
      break

    case 'mcp_call_tool':
      summary.tool = result.tool || 'mcp_call_tool'
      summary.serverId = result.serverId
      summary.serverName = result.serverName
      summary.projectPath = result.projectPath
      summary.isError = !!result.isError
      summary.data = result.data && typeof result.data === 'object'
        ? {
          ...result.data,
          content: typeof result.data.content === 'string' ? result.data.content.slice(0, 2400) : result.data.content
        }
        : result.data
      summary.text = result.text ? String(result.text).slice(0, 2400) : ''
      break

    case 'read_file':
      Object.assign(summary, summarizeReadFileForModel(result, 2400))
      if (result.binary) {
        summary.format = result.format || result.extension || ''
        summary.width = result.width || null
        summary.height = result.height || null
        summary.message = result.message || '二进制文件未返回原始内容'
        delete summary.content
      }
      break

    case 'read_many_files':
      Object.assign(summary, summarizeReadManyFilesForModel(result))
      break

    case 'find_in_file':
      Object.assign(summary, summarizeFindInFileForModel(result))
      break

    case 'write_file':
    case 'edit_file':
      summary.path = result.path
      summary.relative_path = result.relative_path
      summary.requested_path = result.requested_path
      summary.resolved_path = result.resolved_path
      summary.action = toolName === 'write_file' ? '创建' : '编辑'
      summary.success = result.success
      summary.status = result.status
      summary.line_count = result.line_count
      summary.error = result.error
      summary.error_type = result.error_type
      summary.nearest_paths = Array.isArray(result.nearest_candidates) ? result.nearest_candidates.slice(0, 8) : undefined
      summary.hint = result.hint
      break

    case 'text_edit':
      summary.path = result.path
      summary.relative_path = result.relative_path
      summary.success = result.success
      summary.unchanged = result.unchanged
      summary.operation_count = result.operation_count
      summary.added_lines = result.added_lines
      summary.removed_lines = result.removed_lines
      summary.applied = Array.isArray(result.applied) ? result.applied.slice(0, 12) : []
      summary.error = result.error
      summary.error_type = result.error_type
      summary.diagnostics = result.diagnostics
      break

    case 'apply_patch':
      summary.success = result.success
      summary.message = result.message
      summary.files = Array.isArray(result.files)
        ? result.files.slice(0, 16).map(item => ({
          path: item.relative_path || item.path,
          action: item.action,
          added_lines: item.added_lines,
          removed_lines: item.removed_lines
        }))
        : []
      summary.error = result.error
      summary.error_type = result.error_type
      summary.diagnostics = result.diagnostics
      break

    case 'json_edit':
      summary.path = result.path
      summary.relative_path = result.relative_path
      summary.success = result.success
      summary.operation_count = result.operation_count
      summary.operations = Array.isArray(result.operations) ? result.operations.slice(0, 12) : []
      summary.error = result.error
      summary.error_type = result.error_type
      break

    case 'check_project_syntax':
      summary.ok = result.ok
      summary.valid = result.valid
      summary.requires_fix = result.requires_fix
      summary.checked_count = result.checked_count
      summary.total_evidence = result.total_candidates
      summary.failed_count = result.failed_count
      summary.warning_count = result.warning_count
      summary.failed_files = Array.isArray(result.failed_files)
        ? result.failed_files.slice(0, 12).map(item => ({
          path: item.relative_path || item.path,
          language: item.language,
          errors: Array.isArray(item.errors) ? item.errors.slice(0, 4) : [],
          read_hint: item.read_hint || null,
          code_frame: item.code_frame || null
        }))
        : []
      summary.read_hints = Array.isArray(result.read_hints) ? result.read_hints.slice(0, 12) : []
      summary.code_frames = Array.isArray(result.code_frames) ? result.code_frames.slice(0, 12) : []
      summary.repair_hints = Array.isArray(result.repair_hints) ? result.repair_hints.slice(0, 12) : []
      summary.next_action = result.next_action
      summary.message = result.message
      break

    case 'check_syntax':
      summary.path = result.path
      summary.valid = result.valid
      summary.language = result.language
      summary.errors = Array.isArray(result.errors) ? result.errors.slice(0, 6) : []
      summary.warnings = Array.isArray(result.warnings) ? result.warnings.slice(0, 6) : []
      break

    case 'list_files':
      summary.path = result.path
      summary.count = result.files?.length || 0
      break

    case 'search_ai_operation_memos':
      summary.tool = 'search_ai_operation_memos'
      summary.query = result.query
      summary.terms = Array.isArray(result.terms) ? result.terms.slice(0, 12) : []
      summary.count = result.count || 0
      summary.results = Array.isArray(result.results) ? result.results.slice(0, 8) : []
      summary.contract = result.contract || 'Memo results are reference material only; verify current source before editing.'
      summary.factsOnly = true
      break

    case 'read_ai_operation_memo':
      summary.tool = 'read_ai_operation_memo'
      summary.item = result.item
      summary.filePath = result.relativePath || result.filePath
      summary.content = result.content ? String(result.content).slice(0, 7000) : ''
      summary.truncated = !!(result.content && String(result.content).length > 7000)
      summary.contract = result.contract || 'This memo is reference material only; verify current source before editing.'
      summary.factsOnly = true
      break

    case 'locate_code':
      summary.tool = 'locate_code'
      summary.query = result.query
      summary.terms = Array.isArray(result.terms) ? result.terms.slice(0, 16) : []
      summary.mode = result.mode || 'literal_evidence'
      summary.contract = result.contract || 'Facts only; returned paths are evidence, not recommendations.'
      summary.confidenceThreshold = result.confidenceThreshold || 70
      summary.accuracyContract = result.accuracyContract
      summary.evidenceFiles = Array.isArray(result.evidenceFiles || result.highConfidence)
        ? (result.evidenceFiles || result.highConfidence).slice(0, 12).map(item => ({
          band: item.band,
          path: item.path,
          confidence: item.confidence,
          evidenceTypes: item.evidenceTypes,
          sources: item.sources,
          bestLine: item.bestLine,
          snippets: Array.isArray(item.snippets) ? item.snippets.slice(0, 3) : [],
          caution: item.caution
        }))
        : []
      summary.duplicateImplementationRisks = Array.isArray(result.duplicateImplementationRisks || result.implementationRisks)
        ? (result.duplicateImplementationRisks || result.implementationRisks).slice(0, 8)
        : []
      summary.parallel = result.parallel || null
      summary.factsOnly = result.factsOnly !== false
      break

    case 'discover_code':
      summary.tool = result.tool || 'discover_code'
      Object.assign(summary, getSearchGuidance(result))
      summary.query = result.query
      summary.translatedTerms = Array.isArray(result.translatedTerms || result.terms)
        ? (result.translatedTerms || result.terms).slice(0, 24)
        : []
      summary.suggestedGrepPattern = result.suggestedGrepPattern || ''
      summary.queryFocus = result.queryFocus || null
      summary.quality = result.quality || null
      summary.timings = result.timings || null
      summary.mode = result.mode || null
      summary.evidenceFiles = Array.isArray(result.candidates)
        ? result.candidates.slice(0, 10).map(item => ({
          path: item.path,
          score: item.score,
          sources: Array.isArray(item.sources) ? item.sources.slice(0, 6) : [],
          details: Array.isArray(item.details) ? item.details.slice(0, 2) : []
        }))
        : []
      summary.readHints = []
      summary.batchReadPlan = null
      summary.lineLocator = Array.isArray(result.lineLocator) ? result.lineLocator.slice(0, 8) : []
      summary.relatedFiles = Array.isArray(result.relatedFiles) ? result.relatedFiles.slice(0, 6) : []
      summary.focusedSnippets = Array.isArray(result.focusedSnippets) ? result.focusedSnippets.slice(0, 5) : []
      summary.structuralResidue = Array.isArray(result.structuralResidue)
        ? result.structuralResidue.slice(0, 6)
        : []
      summary.nextActions = []
      summary.grep = Array.isArray(result.grep)
        ? result.grep.slice(0, 6).map(item => ({
          path: item.path,
          line: item.line,
          preview: item.preview
        }))
        : []
      break

    case 'search_project':
      Object.assign(summary, getSearchGuidance(result))
      summary.query = result.query
      summary.terms = Array.isArray(result.terms) ? result.terms.slice(0, 24) : []
      summary.queryFocus = result.queryFocus || null
      summary.quality = result.quality || null
      summary.timings = result.timings || null
      summary.mode = result.mode || null
      summary.readHints = []
      summary.batchReadPlan = null
      summary.lineLocator = Array.isArray(result.lineLocator) ? result.lineLocator.slice(0, 8) : []
      summary.relatedFiles = Array.isArray(result.relatedFiles) ? result.relatedFiles.slice(0, 6) : []
      summary.focusedSnippets = Array.isArray(result.focusedSnippets) ? result.focusedSnippets.slice(0, 5) : []
      summary.structuralResidue = Array.isArray(result.structuralResidue)
        ? result.structuralResidue.slice(0, 6)
        : []
      summary.evidenceFiles = Array.isArray(result.candidates)
        ? result.candidates.slice(0, 10).map(item => ({
          path: item.path,
          score: item.score,
          sources: Array.isArray(item.sources) ? item.sources.slice(0, 6) : [],
          details: Array.isArray(item.details) ? item.details.slice(0, 2) : []
        }))
        : []
      summary.grep = Array.isArray(result.grep)
        ? result.grep.slice(0, 6).map(item => ({
          path: item.path,
          line: item.line,
          preview: item.preview
        }))
        : []
      summary.glob = Array.isArray(result.glob)
        ? result.glob.slice(0, 10).map(item => ({
          path: item.path,
          score: item.score,
          reason: item.reason
        }))
        : []
      break

    case 'lxweb':
      summary.action = result.action || result.engine
      summary.query = result.query
      summary.url = result.url
      summary.count = result.results?.length || 0
      summary.size = result.text?.length || result.content?.length || 0
      if ((result.action || '') === 'design') {
        summary.title = result.title
        summary.rendered = result.rendered
        summary.viewport = result.viewport
        summary.designTokens = result.design?.designTokens
          ? {
              colors: Array.isArray(result.design.designTokens.colors) ? result.design.designTokens.colors.slice(0, 12) : [],
              typography: result.design.designTokens.typography,
              radii: Array.isArray(result.design.designTokens.radii) ? result.design.designTokens.radii.slice(0, 8) : [],
              shadows: Array.isArray(result.design.designTokens.shadows) ? result.design.designTokens.shadows.slice(0, 8) : []
            }
          : undefined
        summary.components = result.design?.components
          ? Object.fromEntries(Object.entries(result.design.components).map(([key, value]) => [key, Array.isArray(value) ? value.length : 0]))
          : undefined
        summary.replicationBrief = String(result.replicationBrief || result.text || '').slice(0, 2000)
      }
      break

    case 'browser_search':
      summary.query = result.query
      summary.count = result.results?.length || 0
      break

    case 'browser_fetch':
      summary.url = result.url
      summary.size = result.content?.length || 0
      break

    case 'runtime_verify':
      summary.tool = 'runtime_verify'
      summary.action = result.action
      summary.level = result.level
      summary.verification_status = result.verification_status
      summary.message = result.message
      summary.failures = Array.isArray(result.failures) ? result.failures.slice(0, 16) : []
      summary.next_action = result.next_action
      summary.retry_policy = result.retry_policy
      summary.claim_policy = result.claim_policy
      summary.diagnosis = summarizeRuntimeDiagnosis(result.diagnosis)
      summary.runtime_target = result.runtime_target
      summary.click = result.click ? {
        found: result.click.found,
        reason: result.click.reason,
        ambiguous: result.click.ambiguous,
        locator: result.click.locator,
        selector: result.click.selector,
        role: result.click.role,
        name: result.click.name,
        waited_ms: result.click.waited_ms,
        candidates: Array.isArray(result.click.candidates) ? result.click.candidates.slice(0, 8).map(item => summarizeRuntimeSelector(item, false)) : [],
        nearby_candidates: Array.isArray(result.click.nearby_candidates) ? result.click.nearby_candidates.slice(0, 12).map(item => summarizeRuntimeSelector(item, false)) : []
      } : undefined
      summary.before = summarizeRuntimeState(result.before || result.domState)
      summary.after = summarizeRuntimeState(result.afterOpen || result.after)
      summary.changes = Array.isArray(result.changes) ? result.changes.slice(0, 24) : []
      summary.visualChanges = result.visualChanges
      summary.pageState = result.pageState
      summary.consoleErrors = Array.isArray(result.consoleErrors) ? result.consoleErrors.slice(-12).map(summarizeRuntimeEvent) : []
      summary.pageErrors = Array.isArray(result.pageErrors) ? result.pageErrors.slice(-12).map(summarizeRuntimeEvent) : []
      summary.runtimeDiagnostics = result.runtimeDiagnostics ? {
        success: result.runtimeDiagnostics.success,
        error_count: result.runtimeDiagnostics.error_count,
        warning_count: result.runtimeDiagnostics.warning_count,
        events: Array.isArray(result.runtimeDiagnostics.events) ? result.runtimeDiagnostics.events.slice(-16).map(summarizeRuntimeEvent) : [],
        introduced_error_count: result.runtimeDiagnostics.introduced_error_count,
        persisting_error_count: result.runtimeDiagnostics.persisting_error_count,
        introduced: Array.isArray(result.runtimeDiagnostics.introduced) ? result.runtimeDiagnostics.introduced.slice(-12).map(summarizeRuntimeEvent) : undefined,
        persisting: Array.isArray(result.runtimeDiagnostics.persisting) ? result.runtimeDiagnostics.persisting.slice(-12).map(summarizeRuntimeEvent) : undefined,
        resolved: Array.isArray(result.runtimeDiagnostics.resolved) ? result.runtimeDiagnostics.resolved.slice(-12).map(summarizeRuntimeEvent) : undefined,
        unrelated: Array.isArray(result.runtimeDiagnostics.unrelated) ? result.runtimeDiagnostics.unrelated.slice(-8).map(summarizeRuntimeEvent) : undefined,
        resolved_requires_active_recheck: result.runtimeDiagnostics.resolved_requires_active_recheck
      } : undefined
      summary.evidence = result.evidence
      summary.verification_report = result.verification_report
      break

    case 'research_website_runtime':
      summary.target = result.target
      summary.method = result.method
      summary.viewport = result.viewport
      summary.screenshotPolicy = result.screenshotPolicy
      summary.summary = result.summary
      summary.designTokens = result.designTokens
      summary.refinedDesignTokens = result.refinedDesignTokens ? {
        colors: Array.isArray(result.refinedDesignTokens.colors) ? result.refinedDesignTokens.colors.slice(0, 18) : [],
        fontFamilies: Array.isArray(result.refinedDesignTokens.fontFamilies) ? result.refinedDesignTokens.fontFamilies.slice(0, 10) : [],
        typographyScale: Array.isArray(result.refinedDesignTokens.typographyScale) ? result.refinedDesignTokens.typographyScale.slice(0, 12) : [],
        radiiScale: Array.isArray(result.refinedDesignTokens.radiiScale) ? result.refinedDesignTokens.radiiScale.slice(0, 10) : [],
        shadowScale: Array.isArray(result.refinedDesignTokens.shadowScale) ? result.refinedDesignTokens.shadowScale.slice(0, 8) : []
      } : undefined
      summary.visualPriority = result.visualPriority ? {
        colorRoles: result.visualPriority.colorRoles,
        reasoning: result.visualPriority.reasoning
      } : undefined
      summary.layoutSystem = result.layoutSystem
      summary.sectionAnalysis = Array.isArray(result.sectionAnalysis)
        ? result.sectionAnalysis.map(item => ({
            role: item.role || item.tag,
            y: item.y,
            height: item.height,
            layout: item.layout,
            text: item.text ? String(item.text).slice(0, 220) : '',
            background: item.background,
            color: item.color,
            density: item.density
          })).slice(0, 16)
        : []
      summary.componentSystem = result.componentSystem
        ? Object.fromEntries(Object.entries(result.componentSystem).map(([key, value]) => [key, {
            count: value?.count || 0,
            layout: value?.layout,
            typography: value?.typography,
            color: value?.color,
            background: value?.background,
            radius: value?.radius,
            spacing: value?.spacing,
            example: value?.example ? String(value.example).slice(0, 180) : ''
          }]))
        : undefined
      summary.componentVariants = result.componentVariants
        ? Object.fromEntries(Object.entries(result.componentVariants).map(([key, variants]) => [key, Array.isArray(variants)
            ? variants.slice(0, 6).map(item => ({
                count: item?.count || 0,
                layout: item?.layout,
                background: item?.background,
                color: item?.color,
                radius: item?.radius,
                shadow: item?.shadow,
                spacing: item?.spacing,
                font: item?.font,
                examples: Array.isArray(item?.examples) ? item.examples.slice(0, 4) : []
              }))
            : []]))
        : undefined
      summary.animationSystem = result.animationSystem
      summary.designDna = result.designDna ? {
        visualCharacter: result.designDna.visualCharacter,
        hierarchy: result.designDna.hierarchy,
        composition: result.designDna.composition,
        contentTone: result.designDna.contentTone,
        replicationChecklist: Array.isArray(result.designDna.replicationChecklist) ? result.designDna.replicationChecklist.slice(0, 10) : [],
        avoid: Array.isArray(result.designDna.avoid) ? result.designDna.avoid.slice(0, 8) : []
      } : undefined
      summary.replicationBrief = String(result.replicationBrief || '').slice(0, 2600)
      summary.designStyleMemory = result.designStyleMemory
      summary.domSummary = result.domSummary ? {
        bodyTextLength: result.domSummary.bodyTextLength,
        headings: Array.isArray(result.domSummary.headings) ? result.domSummary.headings.slice(0, 16) : [],
        sections: Array.isArray(result.domSummary.sections) ? result.domSummary.sections.slice(0, 16) : []
      } : undefined
      summary.scrollRuntime = Array.isArray(result.scrollRuntime)
        ? result.scrollRuntime.map(item => ({
            scrollY: item.scrollY,
            scrollProgress: item.scrollProgress,
            visibleCount: item.visibleCount,
            important: Array.isArray(item.important) ? item.important.slice(0, 12) : []
          })).slice(0, 8)
        : []
      summary.animations = Array.isArray(result.animations) ? result.animations.slice(0, 20) : []
      summary.canvas = Array.isArray(result.canvas) ? result.canvas : []
      summary.assets = result.assets ? {
        images: Array.isArray(result.assets.images) ? result.assets.images.slice(0, 20) : [],
        videos: Array.isArray(result.assets.videos) ? result.assets.videos.slice(0, 12) : [],
        audio: Array.isArray(result.assets.audio) ? result.assets.audio.slice(0, 12) : [],
        svgs: Array.isArray(result.assets.svgs) ? result.assets.svgs.slice(0, 8) : []
      } : undefined
      summary.resources = Array.isArray(result.resources) ? result.resources.slice(0, 40) : []
      summary.publicSourceFiles = Array.isArray(result.publicSourceFiles)
        ? result.publicSourceFiles.map(item => ({
            url: item.url,
            status: item.status,
            contentType: item.contentType,
            length: item.length,
            sourceMapHint: item.sourceMapHint,
            sample: item.sample ? String(item.sample).slice(0, 800) : ''
          })).slice(0, 16)
        : []
      summary.consoleMessages = Array.isArray(result.consoleMessages) ? result.consoleMessages.slice(-20) : []
      summary.pageErrors = result.pageErrors
      summary.screenshots = result.screenshots
      break

    case 'capture_screenshot':
    case 'generate_image':
      summary.path = result.path
      summary.file_type = result.file_type || 'image'
      summary.kind = result.kind || (toolName === 'capture_screenshot' ? 'screenshot' : 'generated_image')
      summary.modelName = result.modelName
      summary.prompt = result.prompt ? String(result.prompt).slice(0, 500) : undefined
      summary.width = result.width || null
      summary.height = result.height || null
      summary.format = result.format || 'png'
      summary.thumbnailWidth = result.thumbnailWidth || null
      summary.thumbnailHeight = result.thumbnailHeight || null
      summary.message = result.message
      break

    case 'generate_music':
    case 'generate_video':
    case 'text_to_speech':
      summary.path = result.path || result.file_path
      summary.file_type = result.file_type || (toolName === 'generate_music' ? 'audio' : (toolName === 'text_to_speech' ? 'audio' : 'video'))
      summary.kind = result.kind || (toolName === 'generate_music' ? 'generated_music' : (toolName === 'text_to_speech' ? 'generated_speech' : 'generated_video'))
      summary.modelName = result.modelName || result.model
      summary.prompt = result.prompt ? String(result.prompt).slice(0, 500) : undefined
      summary.format = result.format
      summary.outputFormat = result.outputFormat
      summary.taskId = result.taskId
      summary.fileId = result.fileId
      summary.message = result.message
      break

    case 'inspect_image':
      summary.path = result.path
      summary.file_type = result.file_type || 'image_analysis'
      summary.kind = result.kind || 'vision_inspection'
      summary.modelName = result.modelName
      summary.summary = result.summary ? String(result.summary).substring(0, 1200) : ''
      summary.referencePath = result.referencePath
      summary.subject = result.subject
      summary.message = result.message
      summary.width = result.width || null
      summary.height = result.height || null
      summary.thumbnailWidth = result.thumbnailWidth || null
      summary.thumbnailHeight = result.thumbnailHeight || null
      summary.format = result.format
      break


    case 'blender_status':
      summary.found = !!result.found
      summary.executable = result.executable
      summary.version = result.version
      summary.error = result.error
      break

    case 'blender_run_script':
    case 'blender_create_demo_model':
    case 'blender_modify_scene':
      summary.file_type = 'blender_asset'
      summary.visible = result.visible
      summary.pid = result.pid
      summary.exitCode = result.exitCode
      summary.scriptPath = result.scriptPath
      summary.glbPath = result.glbPath
      summary.blendPath = result.blendPath
      summary.previewPath = result.previewPath
      summary.viewsDir = result.viewsDir
      summary.operations = Array.isArray(result.operations) ? result.operations.map(item => item.type || item).slice(0, 12) : undefined
      summary.message = result.message
      summary.stdout = result.stdout ? String(result.stdout).slice(-1200) : undefined
      summary.stderr = result.stderr ? String(result.stderr).slice(-1200) : undefined
      break

    case 'blender_3d_relay':
      summary.file_type = 'blender_3d_relay'
      summary.kind = result.kind
      summary.name = result.name
      summary.referencePath = result.referencePath
      summary.glbPath = result.glbPath
      summary.blendPath = result.blendPath
      summary.previewPath = result.previewPath
      summary.handoffPath = result.handoffPath
      summary.checkViews = Array.isArray(result.checkViews) ? result.checkViews.slice(0, 8) : []
      summary.repaired = !!result.repaired
      summary.inspection = result.inspection ? String(result.inspection).slice(0, 1200) : ''
      summary.relay = Array.isArray(result.relay) ? result.relay : []
      summary.message = result.message
      break

    case 'grep':
    case 'grep_code':
      summary.pattern = result.pattern
      summary.count = result.matches?.length || result.files?.length || result.totalMatches || 0
      summary.matches = Array.isArray(result.matches)
        ? result.matches.slice(0, 20).map(item => ({
          path: item.path,
          line: item.line,
          start_line: item.start_line,
          end_line: item.end_line,
          content: item.content || item.text || item.preview,
          reason: item.reason
        }))
        : []
      summary.engine = result.engine
      summary.discoveryMode = result.discoveryMode
      summary.fastPath = result.fastPath
      summary.readHints = undefined
      summary.batchReadPlan = undefined
      summary.evidenceFiles = Array.isArray(result.candidates)
        ? result.candidates.slice(0, 10).map(item => ({
          path: item.path,
          score: item.score,
          sources: item.sources,
          details: Array.isArray(item.details) ? item.details.slice(0, 2) : []
        }))
        : undefined
      summary.truncated = result.truncated
      break

    case 'glob_files':
      summary.pattern = result.pattern
      summary.path = result.path
      summary.count = result.count || result.files?.length || 0
      summary.files = Array.isArray(result.files) ? result.files.slice(0, 80) : []
      break

    case 'glob':
      summary.pattern = result.pattern
      summary.count = result.matches?.length || result.files?.length || 0
      break

    case 'dev_workflow':
      summary.tool = 'dev_workflow'
      summary.mode = result.mode
      summary.query = result.query
      summary.integrated_steps = Array.isArray(result.integrated_steps) ? result.integrated_steps.slice(0, 8) : []
      summary.summary = result.summary
      summary.next_action = result.next_action
      summary.next_action_policy = result.next_action_policy || 'legacy_next_action_is_a_hint_not_an_instruction'
      if (result.diagnostic_navigation) {
        summary.diagnostic_navigation = {
          kind: result.diagnostic_navigation.kind,
          is_instruction: result.diagnostic_navigation.is_instruction === true ? true : false,
          model_judgment_required: result.diagnostic_navigation.model_judgment_required !== false,
          caution: result.diagnostic_navigation.caution,
          confidence_policy: result.diagnostic_navigation.confidence_policy,
          query: result.diagnostic_navigation.query,
          mode: result.diagnostic_navigation.mode,
          confidence: result.diagnostic_navigation.confidence,
          issue_signals: Array.isArray(result.diagnostic_navigation.issue_signals) ? result.diagnostic_navigation.issue_signals.slice(0, 8) : [],
          observations: Array.isArray(result.diagnostic_navigation.observations) ? result.diagnostic_navigation.observations.slice(0, 8) : [],
          hypotheses: Array.isArray(result.diagnostic_navigation.hypotheses) ? result.diagnostic_navigation.hypotheses.slice(0, 6) : [],
          evidence_gaps: Array.isArray(result.diagnostic_navigation.evidence_gaps) ? result.diagnostic_navigation.evidence_gaps.slice(0, 6) : [],
          verification_options: Array.isArray(result.diagnostic_navigation.verification_options) ? result.diagnostic_navigation.verification_options.slice(0, 6) : [],
          evidence_queries: Array.isArray(result.diagnostic_navigation.evidence_queries || result.diagnostic_navigation.candidate_queries)
            ? (result.diagnostic_navigation.evidence_queries || result.diagnostic_navigation.candidate_queries).slice(0, 12)
            : [],
          source_summary: result.diagnostic_navigation.source_summary || null
        }
      }
      if (result.syntax) {
        summary.syntax = {
          ok: result.syntax.ok,
          checked_count: result.syntax.checked_count,
          failed_count: result.syntax.failed_count,
          failed_files: Array.isArray(result.syntax.failed_files) ? result.syntax.failed_files.slice(0, 10) : [],
          code_frames: Array.isArray(result.syntax.code_frames) ? result.syntax.code_frames.slice(0, 10) : [],
          repair_hints: Array.isArray(result.syntax.repair_hints) ? result.syntax.repair_hints.slice(0, 10) : [],
          read_hints: Array.isArray(result.syntax.read_hints) ? result.syntax.read_hints.slice(0, 10) : [],
          next_action: result.syntax.next_action
        }
      }
      if (result.discovery) {
        summary.discovery = {
          query: result.discovery.query,
          mode: result.discovery.mode,
          quality: result.discovery.quality,
          evidenceFiles: Array.isArray(result.discovery.candidates) ? result.discovery.candidates.slice(0, 10) : [],
          readHints: [],
          focusedSnippets: Array.isArray(result.discovery.focusedSnippets) ? result.discovery.focusedSnippets.slice(0, 8) : [],
          relatedFiles: Array.isArray(result.discovery.relatedFiles) ? result.discovery.relatedFiles.slice(0, 8) : [],
          next_action: result.discovery.next_action
        }
      }
      if (result.verify) summary.verify = summarizePostEditDiagnostics(result.verify)
      if (result.logic_review) {
        summary.logic_review = {
          ok: result.logic_review.ok,
          reviewed_count: result.logic_review.reviewed_count,
          error_count: result.logic_review.error_count,
          warning_count: result.logic_review.warning_count,
          findings: Array.isArray(result.logic_review.findings) ? result.logic_review.findings.slice(0, 12) : [],
          next_action: result.logic_review.next_action
        }
      }
      if (result.health) {
        summary.health = {
          ok: result.health.ok,
          project_path: result.health.project_path,
          error_count: result.health.error_count,
          warning_count: result.health.warning_count,
          finding_count: result.health.finding_count,
          categories: result.health.categories,
          capability_coverage: result.health.capability_coverage,
          path_class_summary: result.health.path_class_summary,
          evidence_policy: result.health.evidence_policy,
          evidence_bundle: result.health.evidence_bundle,
          top_findings: Array.isArray(result.health.top_findings) ? result.health.top_findings.slice(0, 24) : [],
          finding_views: result.health.finding_views ? {
            evidence_first: Array.isArray(result.health.finding_views.evidence_first) ? result.health.finding_views.evidence_first.slice(0, 24) : [],
            production_first: Array.isArray(result.health.finding_views.production_first) ? result.health.finding_views.production_first.slice(0, 24) : [],
            errors_first: Array.isArray(result.health.finding_views.errors_first) ? result.health.finding_views.errors_first.slice(0, 24) : [],
            confirmed_production: Array.isArray(result.health.finding_views.confirmed_production) ? result.health.finding_views.confirmed_production.slice(0, 16) : [],
            needs_verification: Array.isArray(result.health.finding_views.needs_verification) ? result.health.finding_views.needs_verification.slice(0, 16) : [],
            fixtures_and_temp: Array.isArray(result.health.finding_views.fixtures_and_temp) ? result.health.finding_views.fixtures_and_temp.slice(0, 16) : [],
            possible_false_positive: Array.isArray(result.health.finding_views.possible_false_positive) ? result.health.finding_views.possible_false_positive.slice(0, 8) : []
          } : undefined,
          findings: Array.isArray(result.health.findings) ? result.health.findings.slice(0, 80) : [],
          read_hints: Array.isArray(result.health.read_hints) ? result.health.read_hints.slice(0, 16) : [],
          runtime_verification_tasks: Array.isArray(result.health.runtime_verification_tasks) ? result.health.runtime_verification_tasks.slice(0, 8) : [],
          next_action: result.health.next_action
        }
      }
      break

    default:
      // 其他工具：保留基本状态和简短摘要
      summary.preview = fullContent.substring(0, 150) + '...'
  }

  if (result.postEditDiagnostics) {
    summary.postEditDiagnostics = summarizePostEditDiagnostics(result.postEditDiagnostics)
    summary.requires_fix = result.requires_fix
    summary.next_action = result.next_action
  }
  if (result.syntaxWarning) summary.syntaxWarning = result.syntaxWarning
  if (result.syntaxWarnings) summary.syntaxWarnings = result.syntaxWarnings

  return summary
}

function summarizeDesktopControlForModel(result = {}) {
  if (!result || typeof result !== 'object') return result

  const method = String(result.method || '')
  if (method === 'list_windows') {
    const windows = Array.isArray(result.windows) ? result.windows : []
    return {
      ...result,
      windows: windows.slice(0, 80),
      truncated: windows.length > 80,
      next_action: result.next_action || 'select_window_id_then_get_window_state'
    }
  }
  if (method === 'list_apps') {
    const apps = Array.isArray(result.apps) ? result.apps : []
    return {
      ...result,
      apps: apps.slice(0, 80),
      truncated: apps.length > 80,
      next_action: result.next_action || 'select_app_then_get_window_state'
    }
  }
  if (method !== 'get_window_state') return result

  const accessibility = result.accessibility && typeof result.accessibility === 'object'
    ? result.accessibility
    : null
  const screenshots = Array.isArray(result.screenshots) ? result.screenshots.slice(0, 2) : []
  const tree = String(accessibility?.tree || '')
  const treeLimit = 26000
  const nodes = Array.isArray(accessibility?.nodes) ? accessibility.nodes.slice(0, 160) : []
  const documentText = String(accessibility?.document_text || '')

  return {
    ...result,
    screenshots,
    accessibility: accessibility ? {
      ...accessibility,
      tree: tree.length > treeLimit
        ? `${tree.slice(0, treeLimit)}\n[控件树过长，后续内容已省略；请使用 name/role/automation_id 缩小目标，或分析截图，禁止猜坐标]`
        : tree,
      tree_truncated: tree.length > treeLimit,
      nodes,
      nodes_truncated: Number(accessibility.node_count || 0) > nodes.length,
      document_text: documentText.length > 6000
        ? `${documentText.slice(0, 6000)}\n[文档文本已省略]`
        : documentText
    } : null,
    observation_guidance: screenshots[0]?.path
      ? {
          screenshot_path: screenshots[0].path,
          instruction: '先在 accessibility 中找目标并优先使用 element_index。找不到或有歧义时，调用 image_analyze 分析 screenshot_path 后再使用窗口相对坐标；禁止猜坐标。'
        }
      : {
          instruction: '当前没有可用截图，只能使用 accessibility 中已观察到的控件；未找到目标时重新观察，禁止猜坐标。'
        },
    next_action: 'locate_observed_target_then_act_and_get_window_state_again'
  }
}

function summarizeToolResultForHistory(toolName, result) {
  const route = getToolRoute(result)
  if (route && route.routed_tool !== toolName) {
    return attachToolRoute(
      summarizeToolResultForHistory(route.routed_tool, withoutToolRoute(result)),
      route
    )
  }

  if (COMMAND_OUTPUT_TOOLS.has(toolName)) return result

  const summary = summarizeToolResult(toolName, result)

  if (toolName === 'list_files') {
    summary.path = result.path
    summary.requested_path = result.requested_path
    summary.resolved_path = result.resolved_path
    summary.count = result.count || result.files?.length || 0
    summary.files = Array.isArray(result.files) ? result.files.slice(0, 120) : []
    summary.error = result.error
    summary.error_type = result.error_type
    summary.nearest_paths = Array.isArray(result.nearest_candidates) ? result.nearest_candidates.slice(0, 8) : undefined
  } else if (toolName === 'grep') {
    summary.matches = Array.isArray(result.matches) ? result.matches.slice(0, 50) : []
    summary.count = result.count || result.matches?.length || 0
    summary.error = result.error
  } else if (toolName === 'glob') {
    summary.files = Array.isArray(result.files) ? result.files.slice(0, 80) : []
    summary.count = result.count || result.files?.length || 0
    summary.error = result.error
  }

  return summary
}

function summarizeToolResultForModel(toolName, result) {
  const route = getToolRoute(result)
  if (route && route.routed_tool !== toolName) {
    return attachToolRoute(
      summarizeToolResultForModel(route.routed_tool, withoutToolRoute(result)),
      route
    )
  }

  if (['generate_image', 'generate_music', 'generate_video', 'inspect_image', 'capture_screenshot'].includes(toolName)) {
    return stripBinaryPayloads(summarizeToolResultForHistory(toolName, result))
  }

  if (toolName === 'runtime_verify') {
    return summarizeToolResultForHistory(toolName, result)
  }

  if (COMMAND_OUTPUT_TOOLS.has(toolName)) {
    return stripBinaryPayloads(result)
  }

  if (toolName === 'mcp_aidev_workflow') {
    return summarizeToolResultForHistory(toolName, result)
  }

  // desktop_control 的控件树和截图路径是下一步定位的直接证据，不能走
  // 通用的 150 字 preview 摘要，否则模型会在“看不见”的情况下猜点击位置。
  if (toolName === 'desktop_control') {
    return summarizeDesktopControlForModel(result)
  }

  const fullContent = safeJsonStringify(result)
  if (fullContent.length <= 12000) {
    return stripBinaryPayloads(result)
  }

  if (toolName === 'read_file' && result?.success && result.file_type === 'text') {
    return summarizeReadFileForModel(result, 9000)
  }

  if (toolName === 'read_many_files' && result?.success) {
    return summarizeReadManyFilesForModel(result)
  }

  if (toolName === 'find_in_file' && result?.success) {
    return summarizeFindInFileForModel(result)
  }

  const summary = summarizeToolResultForHistory(toolName, result)
  return stripBinaryPayloads(summary)
}

const BINARY_PAYLOAD_KEYS = new Set([
  'thumbnailDataUrl', 'dataUrl', 'base64', 'imageBase64', 'audioBase64', 'videoBase64',
  'image_data', 'audio_data', 'video_data', 'rawBytes', 'buffer'
])

function stripBinaryPayloads(value, depth = 0) {
  if (depth > 8 || value == null) return value
  if (typeof value === 'string') {
    return /^data:[^;,]+;base64,/i.test(value) ? '[二进制内容已省略，请使用文件路径]' : value
  }
  if (Array.isArray(value)) return value.map(item => stripBinaryPayloads(item, depth + 1))
  if (typeof value !== 'object') return value
  const clean = {}
  for (const [key, item] of Object.entries(value)) {
    if (BINARY_PAYLOAD_KEYS.has(key)) continue
    clean[key] = stripBinaryPayloads(item, depth + 1)
  }
  return clean
}

module.exports = {
  summarizeToolResult,
  summarizeToolResultForHistory,
  summarizeToolResultForModel,
  summarizeDesktopControlForModel,
  stripBinaryPayloads
}
