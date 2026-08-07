const fs = require('fs')
const path = require('path')

module.exports = {
  id: 'open-source.cloud-account-removal',
  title: 'Open-source build removes managed cloud accounts while preserving token analytics',
  tags: ['open-source', 'account', 'models', 'token'],
  paths: [
    'electron/modules/ipc.js',
    'electron/preload.js',
    'frontend/index.html',
    'frontend/scripts/features/models.js',
    'frontend/scripts/features/cloud-token-usage-settings.js'
  ],
  async run(ctx) {
    const read = relative => fs.readFileSync(path.join(ctx.root, relative), 'utf8')
    const exists = relative => fs.existsSync(path.join(ctx.root, relative))
    const html = read('frontend/index.html')
    const preload = read('electron/preload.js')
    const ipc = read('electron/modules/ipc.js')
    const models = read('frontend/scripts/features/models.js')

    ctx.assert.ok(!exists('electron/modules/lingxi-account.js'), 'managed cloud account backend must be removed')
    ctx.assert.ok(!exists('frontend/scripts/features/lingxi-account-settings.js'), 'managed account UI module must be removed')
    ctx.assert.ok(!/lingxi-account|getLingxiAccount|getLingxiBuiltinModel/.test(preload + ipc + models), 'account and built-in model bridges must not remain')
    ctx.assert.ok(!/登录灵犀|我的用量|accountInfoPanel|settingsUsagePopover/.test(html), 'login and account quota panels must not remain in the UI')

    ctx.assert.ok(html.includes('data-tab="cloudTokenUsage"'), 'settings Token usage tab must remain')
    ctx.assert.ok(html.includes('scripts/features/cloud-token-usage-settings.js'), 'Token usage UI script must remain')
    ctx.assert.ok(html.includes('styles/cloud-token-usage.css'), 'Token usage styles must remain')
    ctx.assert.ok(preload.includes('getCloudTokenUsageSummary'), 'Token usage IPC bridge must remain')
    ctx.assert.ok(ipc.includes("cloudTokenUsage.registerIPC"), 'Token usage backend must remain registered')
    ctx.assert.ok(models.includes('saveApiConfig'), 'custom model persistence must remain')
  }
}
