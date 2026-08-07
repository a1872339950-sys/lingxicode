const path = require('path')

module.exports = {
  id: 'project-syntax-scan.tool',
  title: 'Project syntax scan locates production syntax errors without temp-script noise',
  tags: ['tools', 'syntax', 'diagnostic'],
  changedFilePatterns: [
    /^electron\/main\.js$/i,
    /^electron\/modules\/syntax-checker\.js$/i,
    /^electron\/modules\/tool-handlers\/diagnostics\.js$/i,
    /^electron\/modules\/schemas\/search-verify\.js$/i,
    /^electron\/modules\/agent-runtime\.js$/i,
    /^electron\/modules\/system-prompt-builder\.js$/i
  ],

  async run(ctx) {
    const workspace = ctx.createWorkspace(this.id)
    const projectPath = workspace.projectPath
    const diagnostics = require(path.join(ctx.root, 'electron/modules/tool-handlers/diagnostics'))
    const syntaxChecker = require(path.join(ctx.root, 'electron/modules/syntax-checker'))
    const { MODEL_TOOLS_SCHEMA } = require(path.join(ctx.root, 'electron/modules/schemas'))
    const runtime = require(path.join(ctx.root, 'electron/modules/agent-runtime'))

    try {
      ctx.writeText(path.join(projectPath, 'electron/modules/good.js'), 'module.exports = { ok: true }\n')
      ctx.writeText(path.join(projectPath, 'electron/preload.js'), "const { contextBridge } = require('electron')\ncontextBridge.exposeInMainWorld('api', {})\n")
      ctx.writeText(path.join(projectPath, 'electron/modules/broken-a.js'), 'function run() {\n  return true\n\nmodule.exports = run\n')
      ctx.writeText(path.join(projectPath, 'frontend/scripts/browser-ok.js'), "window.demo = document.querySelector('#app')\n")
      ctx.writeText(path.join(projectPath, 'frontend/scripts/module-ok.js'), "import './browser-ok.js'\nexport const ready = true\n")
      ctx.writeText(path.join(projectPath, 'frontend/scripts/broken-b.js'), 'const state = {\n  label: "old"\n  active: true\n}\nconsole.log(state)\n')
      ctx.writeText(path.join(projectPath, 'frontend/scripts/broken-c.js'), [
        '(function () {',
        '  function updatePanel(elements) {',
        '    if (elements.tokenFill) {',
        '      elements.tokenFill.style.width = "10%"',
        '',
        '    if (elements.value) elements.value.textContent = "ready"',
        '  }',
        '',
        '  window.BrokenC = { updatePanel }',
        '})()',
        ''
      ].join('\n'))
      ctx.writeText(path.join(projectPath, 'scripts/ok.js'), 'console.log("ok")\n')
      ctx.writeText(path.join(projectPath, 'temp/repair-backup/app.js'), 'const ignored = {\n  value: true\n  other: false\n}\n')

      const schemaNames = new Set(MODEL_TOOLS_SCHEMA.map(tool => tool.function?.name).filter(Boolean))
      // 低层 check_project_syntax 已收敛进 composite code_verify；模型侧应看到 code_verify 或仍保留原子工具
      ctx.assert.ok(
        schemaNames.has('code_verify') || schemaNames.has('check_project_syntax') || schemaNames.has('dev_workflow'),
        'project syntax verification should be reachable via code_verify / check_project_syntax / dev_workflow'
      )
      const { TOOLS_SCHEMA } = require(path.join(ctx.root, 'electron/modules/schemas'))
      const allToolNames = new Set(TOOLS_SCHEMA.map(tool => tool.function?.name).filter(Boolean))
      ctx.assert.ok(allToolNames.has('check_project_syntax'), 'check_project_syntax atomic tool should still exist for composite routing')
      ctx.assert.equal(
        syntaxChecker.getNodeCheckExecOptions().env.ELECTRON_RUN_AS_NODE,
        '1',
        'node syntax checks should run the Electron binary in Node mode instead of launching another app instance'
      )
      ctx.assert.equal(
        syntaxChecker.stripProcessControlCharacters('ok\x07\x1Bdone'),
        'okdone',
        'syntax checker output should remove audible/control characters before reaching UI'
      )

      const result = await diagnostics.scanProjectSyntax(projectPath, { max_failures: 10, concurrency: 3 })
      ctx.assert.equal(result.success, true, 'project syntax scan should complete')
      ctx.assert.equal(result.ok, false, 'broken production files should fail the scan')
      ctx.assert.equal(result.requires_fix, true, 'scan should require fixes when production syntax is broken')

      const directBroken = await syntaxChecker.checkFileSyntaxAsync(path.join(projectPath, 'electron/modules/broken-a.js'))
      ctx.assert.equal(directBroken.valid, false, 'node --check non-zero exit should be treated as a syntax failure, not checker infrastructure warning')
      ctx.assert.ok(
        Array.isArray(directBroken.errors) && directBroken.errors.some(item => /Unexpected end of input|parse/i.test(item.message || '')),
        'node --check syntax errors should keep the actual parse message'
      )

      const failed = result.failed_files.map(item => item.relative_path).sort()
      ctx.assert.deepEqual(
        failed,
        ['electron/modules/broken-a.js', 'frontend/scripts/broken-b.js', 'frontend/scripts/broken-c.js'],
        'scan should report real syntax errors without flagging browser globals, Electron globals, or ESM imports'
      )
      ctx.assert.ok(result.checked_count >= 3, 'scan should check real source candidates')
      ctx.assert.ok(result.checked_count < result.total_candidates || result.total_candidates >= 4, 'scan should expose candidate/check counts')
      ctx.assert.ok(
        result.read_hints.length === 3 &&
          result.read_hints.every(hint => hint.path && hint.start_line >= 1 && hint.end_line >= hint.start_line),
        'scan should return focused read hints for each failed file'
      )
      ctx.assert.ok(
        result.code_frames.length === 3 &&
          result.code_frames.every(frame => frame.path && frame.content && frame.content.includes('|') && frame.error_line >= frame.start_line),
        'scan should return focused code frames so syntax repair can start without extra read_file calls'
      )
      ctx.assert.ok(
        Array.isArray(result.repair_hints) &&
          result.repair_hints.some(hint => hint.path === 'frontend/scripts/broken-c.js' && hint.type === 'likely_unclosed_delimiter'),
        'scan should return repair_hints for delayed unclosed delimiter errors'
      )
      ctx.assert.ok(
        !JSON.stringify(result).includes('repair-backup'),
        'scan result should not surface ignored temp backup syntax errors'
      )

      const skipped = diagnostics.collectCheckableSyntaxFiles(projectPath, [], projectPath)
      ctx.assert.ok(
        !skipped.some(file => file.includes(`${path.sep}temp${path.sep}`)),
        'file collection should skip temp directories'
      )
      const skippedAsync = await diagnostics.collectCheckableSyntaxFilesAsync(projectPath, [], projectPath)
      ctx.assert.deepEqual(
        skippedAsync.map(file => path.relative(projectPath, file)).sort(),
        skipped.map(file => path.relative(projectPath, file)).sort(),
        'async file collection should match sync collection while avoiding main-process blocking'
      )

      const runtimePrompt = runtime.buildAgentRuntimePrompt({ projectPath: ctx.root })
      ctx.assert.ok(
        runtimePrompt.includes('check_project_syntax') || runtimePrompt.includes('code_verify'),
        'runtime prompt should route project syntax errors to check_project_syntax or code_verify'
      )
      ctx.assert.ok(/临时.*脚本/.test(runtimePrompt), 'runtime prompt should discourage temporary syntax scan scripts')

      const schemaDescription = (
        MODEL_TOOLS_SCHEMA.find(tool => tool.function?.name === 'check_project_syntax') ||
        MODEL_TOOLS_SCHEMA.find(tool => tool.function?.name === 'code_verify') ||
        TOOLS_SCHEMA.find(tool => tool.function?.name === 'check_project_syntax') ||
        TOOLS_SCHEMA.find(tool => tool.function?.name === 'code_verify')
      )?.function?.description || ''
      ctx.assert.ok(schemaDescription.length > 8, 'syntax verification tool should expose a description to the model or composite catalog')
      // 原子工具或 composite 描述里至少应提到扫描/修复相关线索之一
      ctx.assert.ok(
        /code_frames|repair_hints|read_hints|syntax|语法|契约|verify|静态/.test(schemaDescription),
        'tool description should guide syntax repair workflow'
      )
    } finally {
      workspace.cleanup()
    }
  }
}
