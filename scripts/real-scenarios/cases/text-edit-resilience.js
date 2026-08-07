const fs = require('fs')
const path = require('path')

module.exports = {
  id: 'text-edit.resilience',
  title: 'Text editing tools recover from whitespace drift without full file rewrites',
  tags: ['tools', 'text-edit', 'resilience'],
  changedFilePatterns: [
    /^electron\/modules\/tools\.js$/i,
    /^electron\/modules\/tools-schema\.js$/i
  ],

  async run(ctx) {
    const workspace = ctx.createWorkspace(this.id)
    const tools = require(path.join(ctx.root, 'electron/modules/tools'))
    const targetPath = path.join(workspace.projectPath, 'features', 'context-ui.js')
    const resolvePath = item => path.resolve(workspace.projectPath, item || '')

    try {
      const original = [
        'function hidePanel() {',
        '    panel.classList.remove("visible")   ',
        '    state.visible = false',
        '}',
        '',
        'window.ContextUI = {',
        '    hidePanel',
        '}',
        ''
      ].join('\r\n')
      ctx.writeText(targetPath, original)

      const eolFlexible = await tools.executeToolForProject(
        'text_edit',
        {
          path: 'features/context-ui.js',
          edits: [{
            op: 'insert_after',
            anchor: 'function hidePanel() {\n    panel.classList.remove("visible")\n    state.visible = false\n}',
            content: '\n\nfunction updateIndicator(status) {\n    state.status = status\n}'
          }]
        },
        workspace.projectPath,
        resolvePath,
        null,
        `scenario-${this.id}`,
        null,
        { userMessage: 'scenario text edit line ending resilience' }
      )
      ctx.assert.ok(eolFlexible.success, eolFlexible.error || 'text_edit should tolerate line endings and trailing whitespace')
      ctx.assert.equal(eolFlexible.applied[0].match_mode, 'trailing_whitespace', 'text_edit should report flexible whitespace matching')

      const regexEdit = await tools.executeToolForProject(
        'text_edit',
        {
          path: 'features/context-ui.js',
          edits: [{
            op: 'insert_before_regex',
            pattern: 'window\\.ContextUI\\s*=\\s*\\{',
            content: 'function showClearing() {\n    state.clearing = true\n}\n\n',
            expected_occurrences: 1
          }]
        },
        workspace.projectPath,
        resolvePath,
        null,
        `scenario-${this.id}`,
        null,
        { userMessage: 'scenario text edit regex' }
      )
      ctx.assert.ok(regexEdit.success, regexEdit.error || 'text_edit should support regex anchors')

      const lineEdit = await tools.executeToolForProject(
        'text_edit',
        {
          path: 'features/context-ui.js',
          edits: [{
            op: 'replace_lines',
            start_line: 13,
            end_line: 14,
            new_content: '    hidePanel,\n    updateIndicator,\n    showClearing\n'
          }]
        },
        workspace.projectPath,
        resolvePath,
        null,
        `scenario-${this.id}`,
        null,
        { userMessage: 'scenario text edit line range' }
      )
      ctx.assert.ok(lineEdit.success, lineEdit.error || 'text_edit should support line-range edits')
      const updated = fs.readFileSync(targetPath, 'utf8')
      ctx.assert.ok(updated.includes('updateIndicator') && updated.includes('showClearing'), 'text_edit should add methods without full rewrite')

      const noMatch = await tools.executeToolForProject(
        'text_edit',
        {
          path: 'features/context-ui.js',
          edits: [{ op: 'insert_after', anchor: 'missingUniqueAnchorForDiagnostics', content: '\nnoop()\n' }]
        },
        workspace.projectPath,
        resolvePath,
        null,
        `scenario-${this.id}`,
        null,
        { userMessage: 'scenario text edit diagnostics' }
      )
      ctx.assert.equal(noMatch.success, false, 'failed text_edit should remain safe')
      ctx.assert.equal(noMatch.error_type, 'text_edit_error', 'failed text_edit should use text_edit_error')
      ctx.assert.ok(noMatch.diagnostics && Array.isArray(noMatch.diagnostics.candidate_lines), 'failed text_edit should return candidate line diagnostics')

      const bigPath = path.join(workspace.projectPath, 'features', 'large-source.js')
      ctx.writeText(bigPath, Array.from({ length: 120 }, (_, index) => `const value${index} = ${index}`).join('\n') + '\n')
      // 先读后写：存在文件的覆盖必须先 read，否则会先命中 must_read_before_write
      const readBig = await tools.executeToolForProject(
        'read_file',
        { path: 'features/large-source.js' },
        workspace.projectPath,
        resolvePath,
        null,
        `scenario-${this.id}`,
        null,
        { userMessage: 'scenario read before rewrite guard' }
      )
      ctx.assert.ok(readBig.success, readBig.error || 'read_file should succeed before rewrite attempt')
      const blockedRewrite = await tools.executeToolForProject(
        'write_file',
        {
          path: 'features/large-source.js',
          content: Array.from({ length: 120 }, (_, index) => `const next${index} = ${index}`).join('\n') + '\n'
        },
        workspace.projectPath,
        resolvePath,
        null,
        `scenario-${this.id}`,
        null,
        { userMessage: 'scenario full rewrite guard' }
      )
      ctx.assert.equal(blockedRewrite.success, false, 'write_file should block accidental full source rewrites')
      ctx.assert.equal(blockedRewrite.error_type, 'full_source_rewrite_blocked', 'blocked rewrite should be explicit')
    } finally {
      workspace.cleanup()
    }
  }
}
