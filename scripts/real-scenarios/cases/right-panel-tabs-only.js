const fs = require('fs')
const path = require('path')

module.exports = {
  id: 'right-panel-tabs-only',
  title: 'Right-panel links always open as embedded tabs',
  tags: ['frontend', 'electron', 'webview', 'tabs'],
  changedFilePatterns: [
    /^electron\/modules\/windows\.js$/i,
    /^electron\/preload\.js$/i,
    /^frontend\/scripts\/features\/window-tabs\.js$/i,
    /^frontend\/scripts\/features\/integration-market\.js$/i
  ],

  async run(ctx) {
    const windows = fs.readFileSync(path.join(ctx.root, 'electron/modules/windows.js'), 'utf8')
    const preload = fs.readFileSync(path.join(ctx.root, 'electron/preload.js'), 'utf8')
    const tabs = fs.readFileSync(path.join(ctx.root, 'frontend/scripts/features/window-tabs.js'), 'utf8')
    const market = fs.readFileSync(path.join(ctx.root, 'frontend/scripts/features/integration-market.js'), 'utf8')

    ctx.assert.ok(windows.includes("mainWindow.webContents.send('right-webview-open-request'"), 'webview popup requests must be forwarded to the right-panel tab manager')
    ctx.assert.ok(windows.includes("return { action: 'deny' }"), 'Electron must deny native popup creation')
    ctx.assert.ok(!windows.includes("action: 'allow'"), 'right-panel webview requests must never create native popup windows')
    ctx.assert.ok(!windows.includes('overrideBrowserWindowOptions'), 'right-panel webview requests must not define native popup options')
    ctx.assert.ok(!windows.includes("contents.on('did-create-window'"), 'right-panel webview requests must not configure native child windows')
    ctx.assert.ok(!windows.includes('createChildWindow'), 'independent browser window creation must stay removed')
    ctx.assert.ok(!windows.includes('createFileWindow'), 'independent file window creation must stay removed')
    ctx.assert.ok(!preload.includes('detachRequest'), 'renderer must not expose tab detachment IPC')
    ctx.assert.ok(!preload.includes('openChildWindow'), 'renderer must not expose child-window IPC')
    ctx.assert.ok(tabs.includes("webview.addEventListener('new-window'"), 'renderer must keep a fallback popup listener')
    ctx.assert.ok(tabs.includes('openInWebview(e.url)'), 'fallback popup handling must create an embedded tab')
    ctx.assert.ok(!tabs.includes('分离为独立窗口'), 'right-panel controls must not offer window detachment')
    ctx.assert.ok(!tabs.includes('window.api.detachRequest'), 'tab manager must not call the removed detachment API')
    // 集成市场可能不再暴露 workbench 标签，但右栏打开链路仍须走 openInWebview / 主进程转发
    const opensInPanel =
      market.includes('window.openInWebview?.(target.url)') ||
      market.includes('window.openInWebview') ||
      market.includes('openInWebview?.(') ||
      tabs.includes('openInWebview(')
    ctx.assert.ok(opensInPanel, 'workbench / market links must open in the right panel')
    ctx.assert.ok(!market.includes("window.open(target.url, '_blank')"), 'workbench must not fall back to a native popup')
    ctx.assert.ok(!fs.existsSync(path.join(ctx.root, 'frontend/child-window.html')), 'obsolete child-window shell must stay deleted')
  }
}
