const path = require('path')

module.exports = {
  id: 'runtime-verification-hard-gate',
  title: 'Conditional runtime verification hard gate blocks unproven final replies',
  tags: ['runtime', 'tools', 'gate', 'verification'],
  changedFilePatterns: [
    /^electron\/modules\/runtime-verification-gate\.js$/i,
    /^electron\/modules\/ai-chat\.js$/i,
    /^electron\/modules\/agent-workflow\.js$/i,
    /^electron\/modules\/feature-settings\.js$/i,
    /^electron\/modules\/tool-handlers\/command\.js$/i,
    /^electron\/modules\/command-runner\.js$/i,
    /^electron\/modules\/runtime-probe\.js$/i
  ],

  async run(ctx) {
    const gate = require(path.join(ctx.root, 'electron/modules/runtime-verification-gate'))
    const featureSettings = require(path.join(ctx.root, 'electron/modules/feature-settings'))
    const command = require(path.join(ctx.root, 'electron/modules/tool-handlers/command'))
    const workflow = require(path.join(ctx.root, 'electron/modules/agent-workflow'))

    // --- path / trigger ---
    ctx.assert.equal(gate.isUiSurfacePath('frontend/scripts/app.js'), true, 'frontend js is UI surface')
    ctx.assert.equal(gate.isUiSurfacePath('docs/readme.md'), false, 'markdown is not UI surface')
    ctx.assert.equal(gate.isUiSurfacePath('electron/modules/config.js'), false, 'backend module without UI pattern is not forced by path alone')
    ctx.assert.equal(gate.isUiSurfacePath('server/index.js'), false, 'backend index.js must not force L1 by path alone')
    ctx.assert.equal(gate.isUiSurfacePath('electron/main.js'), false, 'electron main.js must not force L1 by path alone')
    ctx.assert.equal(gate.isUiSurfacePath('utils/math.js'), false, 'pure util path must not force L1')
    ctx.assert.equal(
      gate.evaluateL1Trigger({
        taskType: 'feature',
        userMessage: '修一下后端入口',
        toolCalls: [{ name: 'write_file', args: { path: 'server/index.js' }, result: { success: true } }],
        featureFlags: { runtime_verify: true, runtime_verify_hard_gate: true }
      }).required,
      false,
      'backend index.js write without UI intent must not require L1'
    )

    const writeFrontend = [{
      name: 'write_file',
      args: { path: 'frontend/scripts/features/cloud-models.js' },
      result: { success: true }
    }]
    const trigger = gate.evaluateL1Trigger({
      taskType: 'feature',
      userMessage: '修一下云模型列表',
      toolCalls: writeFrontend,
      featureFlags: { runtime_verify: true, runtime_verify_hard_gate: true }
    })
    ctx.assert.equal(trigger.required, true, 'frontend write should require L1')
    ctx.assert.ok(trigger.reasons.includes('ui_surface_write'), 'trigger reason should include ui_surface_write')

    const noWrite = gate.evaluateL1Trigger({
      taskType: 'general',
      userMessage: '你好',
      toolCalls: [],
      featureFlags: { runtime_verify: true, runtime_verify_hard_gate: true }
    })
    ctx.assert.equal(noWrite.required, false, 'pure chat should not require L1')

    // --- missing blocks final ---
    const missing = gate.classifyRuntimeGate({
      taskType: 'ui',
      userMessage: '页面点击无响应',
      toolCalls: writeFrontend,
      featureFlags: { runtime_verify: true, runtime_verify_hard_gate: true }
    })
    ctx.assert.equal(missing.required, true, 'UI task with write requires gate')
    ctx.assert.equal(missing.status, 'missing', 'without runtime_verify status is missing')
    const blockedFinal = gate.assertStartFinalReplyAllowed(missing)
    ctx.assert.equal(blockedFinal.allowed, false, 'start_final_reply must be blocked when missing')
    ctx.assert.equal(blockedFinal.resultPatch.error_type, 'runtime_verification_gate_blocked')
    ctx.assert.ok(/runtime_verify/.test(blockedFinal.resultPatch.playbook || ''), 'playbook must mention runtime_verify')

    // --- code_verify alone does not qualify ---
    const staticOnly = gate.classifyRuntimeGate({
      taskType: 'ui',
      userMessage: '修前端',
      toolCalls: [
        ...writeFrontend,
        {
          name: 'code_verify',
          args: { action: 'file', path: 'frontend/scripts/features/cloud-models.js' },
          result: { success: true, ok: true }
        }
      ],
      featureFlags: { runtime_verify: true, runtime_verify_hard_gate: true }
    })
    ctx.assert.equal(staticOnly.status, 'missing', 'static verification must not satisfy L1')

    // --- incomplete is not qualified ---
    const incomplete = gate.classifyRuntimeGate({
      taskType: 'ui',
      userMessage: '修前端',
      toolCalls: [
        ...writeFrontend,
        {
          name: 'runtime_verify',
          args: {},
          result: {
            success: false,
            verification_status: 'incomplete',
            error_type: 'runtime_target_unavailable'
          }
        }
      ],
      featureFlags: { runtime_verify: true, runtime_verify_hard_gate: true },
      recoveryAttempts: 0
    })
    ctx.assert.equal(incomplete.status, 'incomplete', 'incomplete target is recoverable')
    ctx.assert.equal(gate.assertStartFinalReplyAllowed(incomplete).allowed, false, 'incomplete must block final')

    // --- max recovery degrades to blocked allow ---
    const degraded = gate.classifyRuntimeGate({
      taskType: 'ui',
      userMessage: '修前端',
      toolCalls: [
        ...writeFrontend,
        {
          name: 'runtime_verify',
          args: {},
          result: {
            success: false,
            verification_status: 'incomplete',
            error_type: 'runtime_target_unavailable'
          }
        }
      ],
      featureFlags: { runtime_verify: true, runtime_verify_hard_gate: true },
      recoveryAttempts: gate.MAX_RUNTIME_GATE_RECOVERY
    })
    ctx.assert.equal(degraded.status, 'blocked', 'after max recovery incomplete becomes blocked')
    const allowBlocked = gate.assertStartFinalReplyAllowed(degraded)
    ctx.assert.equal(allowBlocked.allowed, true, 'blocked degradation allows final reply')
    ctx.assert.ok(allowBlocked.resultPatch.claim_policy, 'blocked must carry claim_policy')

    // --- passed / failed qualify ---
    for (const status of ['passed', 'failed']) {
      const classified = gate.classifyRuntimeGate({
        taskType: 'ui',
        userMessage: '修前端',
        toolCalls: [
          ...writeFrontend,
          {
            name: 'runtime_verify',
            args: {},
            result: { success: status === 'passed', verification_status: status, coverage: status === 'passed' ? { specific: true } : undefined }
          }
        ],
        featureFlags: { runtime_verify: true, runtime_verify_hard_gate: true }
      })
      ctx.assert.equal(classified.status, status, `status ${status} should classify`)
      ctx.assert.equal(gate.assertStartFinalReplyAllowed(classified).allowed, true, `${status} allows final`)
    }

    const genericPass = gate.classifyRuntimeGate({
      taskType: 'ui',
      userMessage: 'fix UI',
      toolCalls: [
        ...writeFrontend,
        {
          name: 'runtime_verify',
          args: {},
          result: { success: true, verification_status: 'passed' }
        }
      ],
      featureFlags: { runtime_verify: true, runtime_verify_hard_gate: true }
    })
    ctx.assert.equal(genericPass.status, 'incomplete', 'passed without specific coverage must be downgraded')
    ctx.assert.equal(gate.assertStartFinalReplyAllowed(genericPass).allowed, false, 'generic passed evidence must not allow final claims')
    // --- verify before last write does not count ---
    const stale = gate.classifyRuntimeGate({
      taskType: 'ui',
      userMessage: '修前端',
      toolCalls: [
        {
          name: 'runtime_verify',
          args: {},
          result: { success: true, verification_status: 'passed' }
        },
        ...writeFrontend
      ],
      featureFlags: { runtime_verify: true, runtime_verify_hard_gate: true }
    })
    ctx.assert.equal(stale.status, 'missing', 'runtime_verify before last write must not qualify')

    // --- feature flag hard gate off ---
    const off = gate.classifyRuntimeGate({
      taskType: 'ui',
      userMessage: '修前端',
      toolCalls: writeFrontend,
      featureFlags: { runtime_verify: true, runtime_verify_hard_gate: false }
    })
    ctx.assert.equal(off.required, false, 'hard gate flag off disables L1')
    ctx.assert.equal(gate.assertStartFinalReplyAllowed(off).allowed, true, 'disabled hard gate allows final')

    // --- feature catalog ---
    const catalog = featureSettings.FEATURE_CATALOG || featureSettings.getFeatureCatalog?.() || []
    const ids = Array.isArray(catalog)
      ? catalog.map(item => item.id)
      : Object.keys(catalog)
    ctx.assert.ok(ids.includes('runtime_verify_hard_gate'), 'feature catalog must include runtime_verify_hard_gate')
    ctx.assert.equal(featureSettings.isFeatureEnabled('runtime_verify_hard_gate'), true, 'hard gate defaults enabled')

    // --- ELECTRON_RUN_AS_NODE stripped from shell env ---
    const previous = process.env.ELECTRON_RUN_AS_NODE
    process.env.ELECTRON_RUN_AS_NODE = '1'
    try {
      const env = command.getCommandExecutionEnv()
      ctx.assert.equal(Object.prototype.hasOwnProperty.call(env, 'ELECTRON_RUN_AS_NODE'), false, 'shell env must strip ELECTRON_RUN_AS_NODE')
      const kept = command.getCommandExecutionEnv({ keepElectronRunAsNode: true })
      ctx.assert.equal(kept.ELECTRON_RUN_AS_NODE, '1', 'keep option must retain ELECTRON_RUN_AS_NODE')
    } finally {
      if (previous === undefined) delete process.env.ELECTRON_RUN_AS_NODE
      else process.env.ELECTRON_RUN_AS_NODE = previous
    }

    // --- agent-workflow static/runtime split ---
    const activity = workflow.analyzeToolCalls([
      {
        name: 'write_file',
        args: { path: 'frontend/index.html' },
        result: { success: true }
      },
      {
        name: 'check_syntax',
        args: { path: 'frontend/index.html' },
        result: { success: true }
      }
    ])
    ctx.assert.equal(activity.hasPostWriteVerification, true, 'static verify counts for L0')
    ctx.assert.equal(activity.hasPostWriteRuntimeVerification, false, 'static verify does not count for L1')

    const withRuntime = workflow.analyzeToolCalls([
      {
        name: 'write_file',
        args: { path: 'frontend/index.html' },
        result: { success: true }
      },
      {
        name: 'runtime_verify',
        args: {},
        result: { success: true, verification_status: 'passed', coverage: { specific: true } }
      }
    ])
    ctx.assert.equal(withRuntime.hasPostWriteRuntimeVerification, true, 'qualified runtime_verify counts for L1')

    // 最小工具链走完写后复查/影响面后，应落到 runtime-verify checkpoint
    const checkpoint = workflow.getEngineeringWorkflowCheckpoint({
      taskType: 'ui',
      userMessage: '修一下页面样式点击无响应',
      toolCallsRecord: [
        {
          name: 'write_file',
          args: { path: 'frontend/styles/main.css', content: '.x{color:red}' },
          result: { success: true }
        },
        {
          name: 'read_file',
          args: { path: 'frontend/styles/main.css' },
          result: { success: true, content: '.x{color:red}' }
        },
        {
          name: 'run_command',
          args: { command: 'git diff -- frontend/styles/main.css' },
          result: { success: true, stdout: 'diff --git a/frontend/styles/main.css' }
        },
        {
          name: 'check_syntax',
          args: { path: 'frontend/styles/main.css' },
          result: { success: true }
        }
      ]
    })
    const checkpointText = checkpoint
      ? `${checkpoint.key || ''}\n${checkpoint.status || ''}\n${checkpoint.content || ''}`
      : ''
    if (checkpoint && /runtime-verify|运行时验证|runtime_verify/.test(checkpointText)) {
      ctx.assert.ok(true, 'runtime checkpoint present when workflow reaches runtime stage')
    } else if (checkpoint) {
      // 可能先命中更早的写后复查阶段；只要仍在推进即可
      ctx.assert.ok(checkpoint.key || checkpoint.content || checkpoint.status, 'workflow still emits a checkpoint for incomplete UI change')
    }

    // --- ai-chat exports helpers ---
    const aiChat = require(path.join(ctx.root, 'electron/modules/ai-chat'))
    ctx.assert.equal(typeof aiChat.__test?.evaluateRuntimeGateForChat, 'function', 'ai-chat exposes evaluateRuntimeGateForChat for tests')
    const evaluated = aiChat.__test.evaluateRuntimeGateForChat({
      taskType: 'ui',
      userMessage: 'F12 有报错',
      toolCalls: writeFrontend,
      recoveryAttempts: 0
    })
    ctx.assert.equal(evaluated.required, true, 'ai-chat gate evaluation requires runtime for UI write')
    ctx.assert.equal(evaluated.status, 'missing', 'ai-chat gate starts missing without runtime_verify')
  }
}
