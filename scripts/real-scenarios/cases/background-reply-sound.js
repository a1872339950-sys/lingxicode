const fs = require('fs')
const path = require('path')

module.exports = {
  id: 'background-reply-sound',
  name: 'background-reply-sound',
  tags: ['background-reply-sound', 'notification'],
  changedFilePatterns: [
    /^electron\/modules\/background-reply-sound\.js$/i,
    /^electron\/modules\/ai-chat\.js$/i,
    /^electron\/preload\.js$/i,
    /^frontend\/scripts\/features\/background-reply-sound\.js$/i,
    /^frontend\/index\.html$/i,
    /^frontend\/assets\/sounds\/lingxistudio\.wav$/i
  ],
  async run(ctx) {
    const root = ctx.root
    const soundPath = path.join(root, 'frontend', 'assets', 'sounds', 'lingxistudio.wav')
    ctx.assert.ok(fs.existsSync(soundPath), 'custom reply sound asset should exist')
    ctx.assert.ok(fs.statSync(soundPath).size > 1000, 'custom reply sound asset should not be empty')

    const modulePath = path.join(root, 'electron', 'modules', 'background-reply-sound.js')
    const source = fs.readFileSync(modulePath, 'utf8')
    ctx.assert.ok(source.includes('isMinimized') && source.includes('isVisible'), 'reply sound should check minimized/hidden window state')
    ctx.assert.ok(source.includes('background-reply-sound'), 'reply sound should send a renderer event')
    ctx.assert.ok(!source.includes('Notification') && !source.includes('shell.beep'), 'reply sound should not use system notification or default beep')

    const playerSource = fs.readFileSync(path.join(root, 'frontend', 'scripts', 'features', 'background-reply-sound.js'), 'utf8')
    ctx.assert.ok(playerSource.includes('assets/sounds/lingxistudio.wav'), 'renderer should play the selected custom sound')
    ctx.assert.ok(playerSource.includes('onBackgroundReplySound'), 'renderer should listen for the background reply event')

    const preloadSource = fs.readFileSync(path.join(root, 'electron', 'preload.js'), 'utf8')
    ctx.assert.ok(preloadSource.includes('onBackgroundReplySound'), 'preload should expose the reply sound event')

    const indexSource = fs.readFileSync(path.join(root, 'frontend', 'index.html'), 'utf8')
    ctx.assert.ok(indexSource.includes('scripts/features/background-reply-sound.js'), 'index should load the reply sound player')
    ctx.assert.ok(indexSource.includes('BackgroundReplySound') && indexSource.includes('.init()'), 'index should initialize the reply sound player')

    const fakeEvents = []
    const backgroundReplySound = require(modulePath)
    const visibleWin = {
      isDestroyed: () => false,
      isMinimized: () => false,
      isVisible: () => true,
      webContents: { send: (...args) => fakeEvents.push(args) }
    }
    const minimizedWin = {
      isDestroyed: () => false,
      isMinimized: () => true,
      isVisible: () => true,
      webContents: { send: (...args) => fakeEvents.push(args) }
    }
    ctx.assert.equal(backgroundReplySound.shouldPlayForMainWindow(visibleWin), false, 'visible main window should not trigger sound')
    ctx.assert.equal(backgroundReplySound.shouldPlayForMainWindow(minimizedWin), true, 'minimized main window should trigger sound')
  }
}
