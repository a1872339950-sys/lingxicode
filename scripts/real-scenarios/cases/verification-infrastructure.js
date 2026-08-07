const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')

module.exports = {
  id: 'verification.infrastructure',
  title: 'Verification scripts create standard real scenarios and select them by changed files',
  tags: ['verification', 'real-scenario', 'syntax'],
  changedFilePatterns: [
    /^scripts\/check-syntax\.js$/i,
    /^scripts\/verify-change\.js$/i,
    /^scripts\/real-scenarios\/create-case\.js$/i,
    /^scripts\/real-scenarios\/registry\.js$/i,
    /^scripts\/real-scenarios\/runner\.js$/i,
    /^package\.json$/i
  ],

  async run(ctx) {
    const casePath = path.join(ctx.root, 'scripts/real-scenarios/cases/tmp-generated-scenario.js')
    try {
      if (fs.existsSync(casePath)) fs.unlinkSync(casePath)
      const result = spawnSync(process.execPath, [
        'scripts/real-scenarios/create-case.js',
        '--id', 'tmp-generated-scenario',
        '--title', 'Temporary generated scenario',
        '--tag', 'tmp',
        '--path', 'frontend/scripts/app.js'
      ], {
        cwd: ctx.root,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe']
      })
      ctx.assert.equal(result.status, 0, result.stderr || 'create-case should succeed')
      ctx.assert.ok(fs.existsSync(casePath), 'create-case should write a scenario file')

      delete require.cache[require.resolve(casePath)]
      const generated = require(casePath)
      ctx.assert.equal(generated.id, 'tmp-generated-scenario', 'generated scenario should use normalized id')
      ctx.assert.ok(Array.isArray(generated.changedFilePatterns), 'generated scenario should include changedFilePatterns')
      ctx.assert.ok(generated.changedFilePatterns.some(pattern => pattern.test('frontend/scripts/app.js')), 'generated scenario should match requested path')

      const { selectCases } = require(path.join(ctx.root, 'scripts/real-scenarios/registry'))
      const selected = selectCases([generated], { changedFiles: ['frontend/scripts/app.js'] })
      ctx.assert.equal(selected.length, 1, 'registry should select generated scenario by changed file')
    } finally {
      if (fs.existsSync(casePath)) fs.unlinkSync(casePath)
    }
  }
}
