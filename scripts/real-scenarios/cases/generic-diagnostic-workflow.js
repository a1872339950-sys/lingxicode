const fs = require('fs')
const os = require('os')
const path = require('path')

module.exports = {
  id: 'generic-diagnostic.workflow',
  title: 'Generic failure diagnostics require real entry evidence, contract tracing, and verification',
  tags: ['diagnostic', 'workflow', 'self-evolution'],
  changedFilePatterns: [
    /^electron\/modules\/diagnostic-navigator\.js$/i,
    /^electron\/modules\/diagnostic-workflow\.js$/i,
    /^electron\/modules\/agent-workflow\.js$/i,
    /^electron\/modules\/agent-runtime\.js$/i,
    /^electron\/modules\/project-health-scan\.js$/i,
    /^electron\/modules\/tool-handlers\/diagnostics\.js$/i,
    /^electron\/modules\/chat\/tool-result-summarizer\.js$/i,
    /^electron\/modules\/schemas\/search-verify\.js$/i,
    /^electron\/modules\/system-prompt-builder\.js$/i
  ],

  async run(ctx) {
    const diagnostic = require(path.join(ctx.root, 'electron/modules/diagnostic-workflow'))
    const navigator = require(path.join(ctx.root, 'electron/modules/diagnostic-navigator'))
    const workflow = require(path.join(ctx.root, 'electron/modules/agent-workflow'))
    const runtime = require(path.join(ctx.root, 'electron/modules/agent-runtime'))

    ctx.assert.equal(diagnostic.isFailureLikeRequest('后端接口调用失败'), true, 'backend failures should be diagnostic intents')
    ctx.assert.equal(diagnostic.isFailureLikeRequest('工具执行没反应'), true, 'tool failures should be diagnostic intents')
    ctx.assert.equal(diagnostic.isFailureLikeRequest('按钮无反应'), true, 'UI failures should also be diagnostic intents')
    ctx.assert.equal(diagnostic.isBroadFailureLikeRequest('你全面排查并修复，此项目有一些问题'), true, 'broad project issue reports should be diagnostic intents')

    const prompt = diagnostic.buildGenericDiagnosticProtocolPrompt()
    ctx.assert.ok(prompt.includes('frontend, backend, Electron main/preload, tools, IPC/API'), 'protocol should explicitly be cross-layer')
    ctx.assert.ok(!/projectStore|frontend\.modular-init|sendBtn|inputBox/.test(prompt), 'protocol should not be hardcoded to the recent frontend incident')
    ctx.assert.ok(prompt.includes('soft diagnostic rhythm, not a hard gate'), 'protocol should stay a soft workflow, not a hard gate')

    const runtimePrompt = runtime.buildAgentRuntimePrompt({ projectPath: ctx.root })
    ctx.assert.ok(runtimePrompt.includes('Generic Failure Diagnostic Protocol'), 'runtime prompt should include the generic diagnostic protocol')
    ctx.assert.ok(runtimePrompt.includes('business calculation or ranking'), 'runtime prompt should require broad diagnostic coverage for vague project issues')

    const diagnostics = require(path.join(ctx.root, 'electron/modules/tool-handlers/diagnostics'))
    const healthScan = require(path.join(ctx.root, 'electron/modules/project-health-scan'))
    const summarizer = require(path.join(ctx.root, 'electron/modules/chat/tool-result-summarizer'))
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lingxi-diagnostic-review-'))
    fs.mkdirSync(path.join(tempRoot, 'electron/modules'), { recursive: true })
    fs.mkdirSync(path.join(tempRoot, 'frontend/scripts/features'), { recursive: true })
    fs.writeFileSync(path.join(tempRoot, 'electron/modules/change-sessions.js'), [
      'async function findRollbackConflictsAsync(file, current) {',
      '  if (current.exists && current.hash !== file.beforeHash) return true',
      '  return false',
      '}'
    ].join('\n'))
    fs.writeFileSync(path.join(tempRoot, 'electron/modules/software-access.js'), [
      'function readCustomApps() { return [] }',
      'function filterDisplayableApps(apps) { return apps }',
      'function readLocalAppsCache(data) {',
      '  return { apps: filterDisplayableApps(data.apps) }',
      '}'
    ].join('\n'))
    fs.writeFileSync(path.join(tempRoot, 'electron/modules/search-ranking.js'), [
      'function buildCandidateSummary(candidates) {',
      '  return candidates.sort((a, b) => a.score - b.score)',
      '}'
    ].join('\n'))
    fs.writeFileSync(path.join(tempRoot, 'electron/modules/model-cost-estimator.js'), [
      'function estimate(profile, cachedTokens, missTokens) {',
      '  const cachedInputCost = cachedTokens / 1000000 * profile.missInputPerMillion',
      '  const missInputCost = missTokens / 1000000 * profile.cachedInputPerMillion',
      '  return cachedInputCost + missInputCost',
      '}'
    ].join('\n'))
    fs.writeFileSync(path.join(tempRoot, 'frontend/scripts/features/ipc-ai-stream-listeners.js'), [
      'function onAiStatus(data, targetProject) {',
      '  if (data.status === "done") {',
      '    targetProject.awaitingFinalReply = false',
      '  }',
      '}'
    ].join('\n'))
    fs.writeFileSync(path.join(tempRoot, 'frontend/scripts/features/settings-main.js'), [
      'function readCapabilities() {',
      '  return { toolCalling: false }',
      '}'
    ].join('\n'))

    const review = await diagnostics.handlers.dev_workflow(
      { mode: 'review' },
      { projectPath: tempRoot, projectId: 'diagnostic-review-test' }
    )
    ctx.assert.equal(review.diagnostic_navigation?.is_instruction, false, 'dev_workflow should attach a non-instruction diagnostic evidence package')
    ctx.assert.equal(review.diagnostic_navigation?.model_judgment_required, true, 'diagnostic navigation should require model judgment')
    ctx.assert.ok(/hint_not_an_instruction/.test(review.next_action_policy || ''), 'legacy next_action should be explicitly downgraded to a hint')
    ctx.assert.ok(!Object.prototype.hasOwnProperty.call(review.diagnostic_navigation || {}, 'next_action'), 'diagnostic navigation should not expose next_action-style commands')
    ctx.assert.ok(/not an instruction/i.test(review.diagnostic_navigation?.caution || ''), 'diagnostic navigation should warn that it is evidence, not a command')
    const findingTypes = new Set((review.logic_review?.findings || []).map(item => item.type))
    ;[
      'rollback-conflict-hash-contract',
      'custom-app-cache-merge-lost',
      'candidate-score-sort-inverted',
      'cached-cost-rate-swapped',
      'miss-cost-rate-swapped',
      'final-reply-awaiting-state-cleared',
      'tool-capability-forced-disabled'
    ].forEach(type => {
      ctx.assert.ok(findingTypes.has(type), `logic review should catch ${type}`)
    })

    const dynamicDomRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lingxi-health-dynamic-dom-'))
    fs.mkdirSync(path.join(dynamicDomRoot, 'frontend/scripts'), { recursive: true })
    fs.writeFileSync(path.join(dynamicDomRoot, 'frontend/index.html'), '<div id="app"></div><script src="scripts/dynamic-modal.js"></script>', 'utf8')
    fs.writeFileSync(path.join(dynamicDomRoot, 'frontend/scripts/dynamic-modal.js'), `
      function ensureDynamicModal() {
        let modal = document.getElementById('dynamicModal')
        if (modal) return modal
        modal = document.createElement('div')
        modal.id = 'dynamicModal'
        document.body.appendChild(modal)
        return modal
      }
      function showDynamicModal() {
        const modal = ensureDynamicModal()
        modal.classList.add('show')
      }
      window.showDynamicModal = showDynamicModal
    `, 'utf8')
    const dynamicDomHealth = await healthScan.runProjectHealthScan({
      projectPath: dynamicDomRoot,
      disable_worker: true,
      top_limit: 20,
      include_ipc: false
    })
    const dynamicDomFalsePositive = (dynamicDomHealth.findings || []).find(item =>
      /dynamicModal/.test(`${item.message || ''}\n${item.evidence || ''}`) &&
      /dom-target-missing|dom-query-without-matching-markup/.test(item.type || '')
    )
    ctx.assert.ok(!dynamicDomFalsePositive, 'health scan should not report runtime-created DOM ids as missing static markup')
    const annotatedFinding = dynamicDomHealth.finding_views?.evidence_first?.[0]
    if (annotatedFinding) {
      ctx.assert.ok(annotatedFinding.confidence, 'health scan finding views should expose confidence')
      ctx.assert.ok(annotatedFinding.verification_status, 'health scan finding views should expose verification status')
    }

    const fakeNavigation = navigator.buildDiagnosticNavigation({
      mode: 'health',
      query: '切换项目后历史消息和最新用户消息顺序不对',
      discovery: {
        quality: { level: 'medium', score: 62, topPath: 'frontend/scripts/features/project-switcher.js', evidenceCount: 3 },
        candidates: [{ path: 'frontend/scripts/features/project-switcher.js', score: 88, sources: ['grep'] }],
        readHints: [{ path: 'frontend/scripts/features/project-switcher.js', start_line: 120, end_line: 180 }]
      },
      health: {
        error_count: 0,
        warning_count: 2,
        finding_count: 2,
        categories: { state: 1, runtime: 1 },
        top_findings: [
          {
            severity: 'warning',
            category: 'state',
            type: 'running-operation-duplicate-replay',
            path: 'frontend/scripts/features/project-switcher.js',
            line: 150,
            message: 'Running UI replay may duplicate visible state.',
            evidence: 'restoreRunningBlock(); replay=true',
            source: 'logic_review'
          }
        ],
        runtime_verification_tasks: [{ type: 'ui_interaction_check', reason: 'project switch should preserve visible messages' }]
      }
    }, { query: '切换项目后历史消息和最新用户消息顺序不对' })
    ctx.assert.equal(fakeNavigation.is_instruction, false, 'navigator output should be evidence only')
    ctx.assert.ok(fakeNavigation.hypotheses?.some(item => /state sources|lifecycle ordering/i.test(item.claim)), 'navigator should surface state/lifecycle hypotheses')
    ctx.assert.ok(fakeNavigation.hypotheses?.some(item => Array.isArray(item.counter_evidence_needed) && item.counter_evidence_needed.length), 'hypotheses should include counter-evidence requirements')
    ctx.assert.ok(fakeNavigation.verification_options?.some(item => item.kind === 'state_source_audit'), 'state/lifecycle issues should offer a state-source audit option')
    ctx.assert.ok(!Object.prototype.hasOwnProperty.call(fakeNavigation, 'next_action'), 'navigator should avoid command-like next_action')

    const summarized = summarizer.summarizeToolResultForHistory('dev_workflow', {
      success: true,
      tool: 'dev_workflow',
      mode: 'health',
      query: '切换项目后历史消息和最新用户消息顺序不对',
      integrated_steps: ['discover_code', 'project_health_scan'],
      summary: 'diagnostic summary',
      next_action_policy: 'legacy_next_action_is_a_hint_not_an_instruction',
      diagnostic_navigation: fakeNavigation,
      health: {
        ok: true,
        error_count: 0,
        warning_count: 0,
        finding_count: 0,
        top_findings: [],
        read_hints: []
      }
    })
    ctx.assert.equal(summarized.diagnostic_navigation?.is_instruction, false, 'model-facing summary should preserve non-instruction flag')
    ctx.assert.ok(/hint_not_an_instruction/.test(summarized.next_action_policy || ''), 'model-facing summary should keep next_action policy')
    ctx.assert.ok(summarized.diagnostic_navigation?.hypotheses?.length, 'model-facing summary should keep diagnostic hypotheses')

    const firstCheckpoint = workflow.getEngineeringWorkflowCheckpoint({
      taskType: 'bugfix',
      userMessage: '后端接口调用失败，帮我修复',
      toolCallsRecord: [
        { name: 'read_file', args: { path: 'package.json' }, result: { success: true, content: '{"scripts":{}}' } }
      ]
    })
    ctx.assert.ok(firstCheckpoint, 'failure-like tasks should produce a diagnostic checkpoint')
    ctx.assert.equal(firstCheckpoint.key, 'bugfix:generic-diagnostic-reproduce', 'first stage should require real entry reproduction')

    const broadCheckpoint = workflow.getEngineeringWorkflowCheckpoint({
      taskType: 'bugfix',
      userMessage: '你全面排查并修复，此项目有一些问题',
      toolCallsRecord: [
        {
          name: 'run_command',
          args: { command: 'npm run check:syntax' },
          result: { success: true, stdout: 'Syntax check passed: 408 files' }
        },
        {
          name: 'grep_code',
          args: { pattern: 'path.join|storagePath' },
          result: { success: true, matches: [{ path: 'electron/modules/projects.js', line: 890 }] }
        }
      ]
    })
    ctx.assert.ok(broadCheckpoint, 'broad project issue reports should not finish after one narrow finding')
    ctx.assert.equal(broadCheckpoint.key, 'bugfix:generic-diagnostic-broad-coverage', 'broad project issues should require multi-class coverage')

    const coverage = diagnostic.getBroadDiagnosticCoverage({
      text: [
        'TypeError window.ContextUI.updateIndicator is not a function',
        'button click addEventListener settings panel',
        'cache cost amount score sort rank calculation',
        'search_project codemap candidate readHints',
        'projectId activeProject state cache isolation',
        'npm run check:syntax verification passed'
      ].join('\n')
    })
    ctx.assert.equal(coverage.isEnough, true, 'broad coverage should pass only after several issue classes and verification are covered')

    const contractCheckpoint = workflow.getEngineeringWorkflowCheckpoint({
      taskType: 'bugfix',
      userMessage: '工具执行没反应，帮我修复',
      toolCallsRecord: [
        {
          name: 'run_command',
          args: { command: 'node scripts/repro.js' },
          result: { success: false, stderr: 'TypeError: runner is not a function\n    at tool.js:12:3' }
        }
      ]
    })
    ctx.assert.ok(contractCheckpoint, 'runtime error evidence should advance to contract tracing')
    ctx.assert.equal(contractCheckpoint.key, 'bugfix:generic-diagnostic-contract', 'second stage should require boundary contract tracing')

    const verifyCheckpoint = workflow.getEngineeringWorkflowCheckpoint({
      taskType: 'bugfix',
      userMessage: 'IPC 调用报错，帮我修复',
      toolCallsRecord: [
        {
          name: 'run_command',
          args: { command: 'node scripts/repro.js' },
          result: { success: false, stderr: 'ReferenceError: updateIndicator is not defined\n    at ipc-handler.js:20:5' }
        },
        {
          name: 'read_file',
          args: { path: 'electron/modules/ipc-handler.js' },
          result: { success: true, content: 'module.exports = { updateIndicator }\nipcMain.handle("context:update", updateIndicator)' }
        },
        {
          name: 'edit_file',
          args: { path: 'electron/modules/ipc-handler.js' },
          result: { success: true }
        }
      ]
    })
    ctx.assert.ok(verifyCheckpoint, 'post-fix diagnostic tasks should require verification')
    ctx.assert.equal(verifyCheckpoint.key, 'bugfix:generic-diagnostic-verify', 'third stage should require real-path verification')
  }
}
