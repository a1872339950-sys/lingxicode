const fs = require('fs')
const path = require('path')
const vm = require('vm')

module.exports = {
  id: 'chat.long-text-paste-attachment',
  title: 'Long pasted text becomes a real TXT attachment behind a default-on capability switch',
  tags: ['chat-ui', 'attachments', 'settings'],
  changedFilePatterns: [
    /^electron\/modules\/feature-settings\.js$/i,
    /^electron\/modules\/chat\/file-ipc-handlers\.js$/i,
    /^electron\/preload\.js$/i,
    /^frontend\/scripts\/app\.js$/i,
    /^frontend\/scripts\/features\/attachments\.js$/i,
    /^frontend\/scripts\/features\/feature-settings\.js$/i,
    /^frontend\/scripts\/features\/message-sender\.js$/i,
    /^frontend\/scripts\/features\/text-input-ui\.js$/i,
    /^frontend\/styles\/input-area\.css$/i
  ],

  async run(ctx) {
    const featureSettings = require(path.join(ctx.root, 'electron/modules/feature-settings'))
    const feature = featureSettings.FEATURE_CATALOG.find(item => item.id === 'long_text_paste_attachment')
    ctx.assert.ok(feature, 'long text paste capability must exist')
    ctx.assert.equal(feature.defaultEnabled, true, 'long text paste capability must be enabled by default')
    ctx.assert.equal(feature.tools.length, 0, 'UI-only capability must not expose a model tool')

    const source = fs.readFileSync(path.join(ctx.root, 'frontend/scripts/features/text-input-ui.js'), 'utf8')
    const windowObject = {
      WorkbenchMention: { stripMentionDirectives: value => String(value || '') },
      getComputedStyle: () => ({
        width: '500px',
        font: '14px sans-serif',
        fontFamily: 'sans-serif',
        fontSize: '14px',
        fontWeight: '400',
        lineHeight: '20px',
        letterSpacing: '0px',
        padding: '0px',
        border: '0px',
        boxSizing: 'border-box'
      })
    }
    const documentObject = {
      body: {
        contains: () => false,
        appendChild: () => {}
      },
      createElement: () => ({
        style: {},
        setAttribute: () => {},
        textContent: '',
        offsetHeight: 36
      })
    }
    const context = vm.createContext({
      window: windowObject,
      document: documentObject,
      requestAnimationFrame: callback => {
        callback()
        return 1
      },
      console,
      setTimeout,
      clearTimeout
    })
    vm.runInContext(source, context)

    function createInput(initial = '') {
      const callbacks = {}
      return {
        value: initial,
        selectionStart: initial.length,
        selectionEnd: initial.length,
        scrollTop: 0,
        style: {},
        addEventListener(type, callback) {
          callbacks[type] = callback
        },
        setSelectionRange(start, end) {
          this.selectionStart = start
          this.selectionEnd = end
        },
        callbacks
      }
    }

    function pasteEvent(text) {
      return {
        prevented: false,
        clipboardData: {
          items: [],
          files: [],
          getData: () => text
        },
        preventDefault() {
          this.prevented = true
        }
      }
    }

    {
      const input = createInput()
      let attachment = null
      windowObject.TextInputUI.bind(input, {
        isLongTextAttachmentEnabled: async () => true,
        onLongTextPaste: async detail => {
          attachment = detail
          return true
        }
      })
      const text = '中'.repeat(4001)
      const event = pasteEvent(text)
      await input.callbacks.paste(event)
      ctx.assert.equal(event.prevented, true, 'long text paste should prevent native insertion')
      ctx.assert.equal(input.value, '', 'enabled long text paste should not occupy the input')
      ctx.assert.equal(attachment.text, text, 'attachment callback should receive the exact pasted text')
      ctx.assert.equal(attachment.characterCount, 4001, 'character count should be preserved')
    }

    {
      const input = createInput()
      let attachmentCalls = 0
      windowObject.TextInputUI.bind(input, {
        isLongTextAttachmentEnabled: async () => false,
        onLongTextPaste: async () => {
          attachmentCalls += 1
          return true
        }
      })
      const text = '关'.repeat(5000)
      await input.callbacks.paste(pasteEvent(text))
      ctx.assert.equal(input.value, text, 'disabled capability should paste long text normally')
      ctx.assert.equal(attachmentCalls, 0, 'disabled capability must not create an attachment')
    }

    {
      const input = createInput()
      let detail = null
      windowObject.TextInputUI.bind(input, {
        isLongTextAttachmentEnabled: async () => true,
        onLongTextPaste: async value => {
          detail = value
          return true
        }
      })
      const text = Array.from({ length: 121 }, (_, index) => `line-${index}`).join('\n')
      await input.callbacks.paste(pasteEvent(text))
      ctx.assert.equal(input.value, '', '121 lines should become an attachment even below 4000 characters')
      ctx.assert.equal(detail.lineCount, 121, 'line threshold should use the real line count')
    }

    {
      const input = createInput('prefix:')
      windowObject.TextInputUI.bind(input, {
        isLongTextAttachmentEnabled: async () => true,
        onLongTextPaste: async () => true
      })
      const text = '短'.repeat(4000)
      await input.callbacks.paste(pasteEvent(text))
      ctx.assert.equal(input.value, `prefix:${text}`, 'exactly 4000 characters should remain normal text')
    }

    const attachmentSource = fs.readFileSync(path.join(ctx.root, 'frontend/scripts/features/attachments.js'), 'utf8')
    ctx.assert.ok(attachmentSource.includes('async function addPastedText'), 'attachment store should save pasted text')
    ctx.assert.ok(attachmentSource.includes("source: 'pasted-text'"), 'pasted TXT entries need a stable source marker')
    ctx.assert.ok(attachmentSource.includes('uploaded-file-restore'), 'pasted TXT attachment should support restoring text')

    const appSource = fs.readFileSync(path.join(ctx.root, 'frontend/scripts/app.js'), 'utf8')
    ctx.assert.ok(
      appSource.includes("FeatureSettingsUI?.isEnabled?.('long_text_paste_attachment', true)"),
      'paste behavior must honor the persisted capability switch'
    )
    ctx.assert.ok(appSource.includes('addPastedText?.(text, window.api)'), 'app should create the real pasted TXT attachment')

    const senderSource = fs.readFileSync(path.join(ctx.root, 'frontend/scripts/features/message-sender.js'), 'utf8')
    ctx.assert.ok(
      senderSource.includes("file.source === 'pasted-text'") &&
        senderSource.includes('${file.pastedText}'),
      'sender must inject the actual pasted text instead of sending a decorative attachment only'
    )

    const preloadSource = fs.readFileSync(path.join(ctx.root, 'electron/preload.js'), 'utf8')
    const ipcSource = fs.readFileSync(path.join(ctx.root, 'electron/modules/chat/file-ipc-handlers.js'), 'utf8')
    ctx.assert.ok(preloadSource.includes("ipcRenderer.invoke('save-pasted-text'"), 'renderer should have a pasted text IPC bridge')
    ctx.assert.ok(ipcSource.includes("ipcMain.handle('save-pasted-text'"), 'main process should save pasted TXT files')
    ctx.assert.ok(ipcSource.includes("'pasted-images', 'pasted-text'"), 'temporary cleanup should allow pasted text cache files')
  }
}