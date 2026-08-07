const fs = require('fs')
const path = require('path')

module.exports = {
  id: 'chat.bottom-inset',
  title: 'Chat bottom inset follows input overlap instead of using a fixed spacer',
  tags: ['chat-ui', 'layout'],
  changedFilePatterns: [
    /^frontend\/scripts\/app\.js$/i,
    /^frontend\/styles\/chat\.css$/i,
    /^frontend\/styles\/input-area\.css$/i
  ],

  async run(ctx) {
    const appSource = fs.readFileSync(path.join(ctx.root, 'frontend/scripts/app.js'), 'utf8')
    const syncStart = appSource.indexOf('function syncChatBottomInset()')
    ctx.assert.ok(syncStart >= 0, 'syncChatBottomInset should exist')
    const syncEnd = appSource.indexOf('const textInputUI', syncStart)
    const syncSource = appSource.slice(syncStart, syncEnd)

    ctx.assert.ok(
      !syncSource.includes("setProperty('--chat-bottom-safe', '16px')"),
      'chat bottom safe area must not be a fixed 16px value'
    )
    // 当前布局：消息区与输入区为 flex 列，互不重叠；--chat-bottom-safe 仅作呼吸边距，
    // 浮标位置用 inputHeight + terminalHeight 计算。
    ctx.assert.ok(
      (
        (
          syncSource.includes('getBoundingClientRect') &&
          syncSource.includes('inputOverlap') &&
          syncSource.includes('terminalOverlap') &&
          syncSource.includes("setProperty('--chat-bottom-safe'")
        ) ||
        (
          syncSource.includes('inputHeight') &&
          syncSource.includes('terminalHeight') &&
          syncSource.includes("setProperty('--chat-bottom-safe'") &&
          syncSource.includes("setProperty('--chat-floating-bottom'")
        )
      ),
      'chat bottom safe area should be calculated from actual layout (overlap or flex heights)'
    )
    ctx.assert.ok(
      syncSource.includes('wasNearBottom') &&
      syncSource.includes('requestAnimationFrame') &&
      syncSource.includes('chatMessages.scrollTop = chatMessages.scrollHeight'),
      'when the user is already near bottom, input resizing should keep the latest work visible'
    )

    const chatCss = fs.readFileSync(path.join(ctx.root, 'frontend/styles/chat.css'), 'utf8')
    ctx.assert.ok(
      chatCss.includes('padding: var(--space-5)') &&
      chatCss.includes('var(--chat-bottom-safe') &&
      chatCss.includes('scroll-padding-bottom: var(--chat-bottom-safe'),
      'chat message container should use the dynamic bottom safe area for padding and scroll positioning'
    )

    const textInputSource = fs.readFileSync(path.join(ctx.root, 'frontend/scripts/features/text-input-ui.js'), 'utf8')
    ctx.assert.ok(
      textInputSource.includes('function reset()') &&
      textInputSource.includes("inputBox.style.height = '36px'") &&
      textInputSource.includes('requestAnimationFrame(autoResize)') &&
      (
        textInputSource.includes('return { autoResize, reset }') ||
        textInputSource.includes('return { autoResize, reset, insertText }')
      ),
      'text input binding should expose a reset helper that restores textarea height after send'
    )
    ctx.assert.ok(
      appSource.includes("inputBox.value = ''") &&
      appSource.includes('syncChatBottomInset()') &&
      (
        appSource.includes('textInputUI?.reset?.()') ||
        appSource.includes('textInputUI?.autoResize?.()') ||
        appSource.includes('clearInputBox:') ||
        appSource.includes('autoResize')
      ),
      'send flow should clear user input and keep bottom inset / textarea sizing in sync'
    )
  }
}
