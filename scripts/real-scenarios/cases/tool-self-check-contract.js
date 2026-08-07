const path = require('path')

module.exports = {
  id: 'tool-self-check.contract',
  title: 'Tool self-check uses current read-only gateway contracts',
  tags: ['tools', 'diagnostic', 'self-check'],
  changedFilePatterns: [
    /^electron\/modules\/tool-self-check\.js$/i,
    /^electron\/modules\/schemas\/command\.js$/i
  ],

  async run(ctx) {
    const { buildRgCheckCandidates, runToolSelfCheck } = require(path.join(ctx.root, 'electron/modules/tool-self-check'))
    const calls = []
    const registry = {
      validateToolRegistry() {
        return {
          success: true,
          counts: { modelVisibleTools: 2 },
          errors: [],
          warnings: []
        }
      },
      getRegistrySnapshot() {
        return { tools: [], validation: this.validateToolRegistry() }
      }
    }
    const result = await runToolSelfCheck({ deep: true }, {
      projectPath: ctx.root,
      registry,
      async dispatch(name, args) {
        calls.push({ name, args })
        return { success: true, name }
      }
    })

    ctx.assert.equal(result.success, true, 'deep tool self-check should pass when read-only gateway calls pass')
    ctx.assert.equal(calls.length, 2, 'deep check should execute both read-only gateway checks')
    ctx.assert.deepEqual(calls[0], {
      name: 'list_files',
      args: { path: '.', recursive: false, limit: 5 }
    }, 'list_files smoke call should use the current contract')
    ctx.assert.deepEqual(calls[1], {
      name: 'glob_files',
      args: { path: '.', pattern: 'electron/modules/*.js', limit: 5, include_hidden: false }
    }, 'glob_files smoke call should use the current contract')
    ctx.assert.deepEqual(
      buildRgCheckCandidates('C:\\app\\resources\\app.asar\\node_modules\\rg.exe').slice(0, 2),
      [
        'C:\\app\\resources\\app.asar.unpacked\\node_modules\\rg.exe',
        'C:\\app\\resources\\app.asar\\node_modules\\rg.exe'
      ],
      'packaged self-check should try the executable app.asar.unpacked path before the virtual archive path'
    )
  }
}