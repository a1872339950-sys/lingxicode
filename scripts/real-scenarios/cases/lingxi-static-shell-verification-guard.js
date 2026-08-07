const path = require('path')

module.exports = {
  id: 'lingxi-static-shell-verification-guard',
  title: 'Lingxi static shell cannot impersonate a development runtime',
  tags: ['runtime', 'electron', 'interaction', 'instance-targeting'],
  changedFilePatterns: [
    /^electron\/modules\/tool-handlers\/website-research\.js$/i,
    /^electron\/modules\/schemas\/screenshot-image\.js$/i
  ],

  async run(ctx) {
    const { runtimeVerify } = require(path.join(ctx.root, 'electron/modules/tool-handlers/website-research'))
    const result = await runtimeVerify({
      html_path: 'frontend/index.html',
      interaction: { click_locator: { selector: '#startupLoginBtn' } }
    }, { projectId: 'lingxi-source', resolvePath: input => path.resolve(ctx.root, input) })

    ctx.assert.equal(result.success, false, 'static Lingxi shell must not pass as end-to-end verification')
    ctx.assert.equal(result.error_type, 'unsupported_runtime_verify_arguments', 'legacy hidden-page arguments must be rejected')
    ctx.assert.equal(result.verification_status, 'incomplete', 'verification must stop before opening a hidden shell window')
    ctx.assert.ok(result.unsupported_arguments.includes('html_path'), 'the rejected hidden-page argument must be explicit')

    const desktop = await runtimeVerify({ level: 'desktop', target: 'active_window' }, {
      projectId: 'lingxi-source',
      resolvePath: input => path.resolve(ctx.root, input)
    })
    ctx.assert.equal(desktop.error_type, 'unsupported_runtime_verify_arguments', 'desktop capture routing must not remain inside runtime_verify')

    const quickShell = await runtimeVerify({ html_path: 'frontend/index.html' }, {
      projectId: 'lingxi-source',
      resolvePath: input => path.resolve(ctx.root, input)
    })
    ctx.assert.equal(quickShell.error_type, 'unsupported_runtime_verify_arguments', 'URL/HTML quick routing must not remain inside runtime_verify')
  }
}
