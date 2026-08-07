const fs = require('fs')
const path = require('path')

module.exports = {
  id: 'chat.uploaded-attachment-preview-and-uri-rendering',
  title: 'Uploaded files use managed cache and bare URI rendering stays intact',
  tags: ['chat-ui', 'attachments', 'markdown', 'security'],
  changedFilePatterns: [
    /^electron\/modules\/chat\/file-ipc-handlers\.js$/i,
    /^electron\/preload\.js$/i,
    /^frontend\/scripts\/features\/(attachments|ai-message-ui)\.js$/i
  ],

  async run(ctx) {
    const read = relative => fs.readFileSync(path.join(ctx.root, relative), 'utf8')
    const preload = read('electron/preload.js')
    const ipc = read('electron/modules/chat/file-ipc-handlers.js')
    const attachments = read('frontend/scripts/features/attachments.js')
    const messageUi = read('frontend/scripts/features/ai-message-ui.js')

    ctx.assert.ok(
      preload.includes("ipcRenderer.invoke('save-uploaded-file'"),
      'browser-selected files must have a managed-upload IPC bridge'
    )
    ctx.assert.ok(
      ipc.includes("path.join(storageConfig.getCacheDir(), 'uploaded-files')"),
      'uploaded files must be staged inside the application cache'
    )
    ctx.assert.ok(
      ipc.includes("'pasted-images', 'pasted-text', 'uploaded-files'"),
      'managed uploads must participate in safe temporary-file cleanup'
    )
    ctx.assert.ok(
      attachments.includes('await api.saveUploadedFile({') &&
        attachments.includes("entry.pathSource = 'temporary'"),
      'file input and drag/drop uploads must replace external paths with managed copies'
    )
    ctx.assert.ok(
      attachments.indexOf('if (file.thumb &&') < attachments.indexOf('} else if (file.path) {'),
      'image preview must prefer its already-authorized thumbnail over the original external path'
    )

    ctx.assert.ok(
      messageUi.includes('decorateFileReferences(decorateUriReferences(sanitizeAiContent(text)))'),
      'URI decoration must run before local file-path decoration'
    )
    ctx.assert.ok(
      messageUi.includes('(?<![A-Za-z0-9+.-])([A-Za-z]:'),
      'drive-letter matching must not start inside http/file URI schemes'
    )
    ctx.assert.ok(
      messageUi.includes("openInWebview(this.href)"),
      'bare HTTP URLs should open as one complete link in the in-app browser'
    )

    const uriPattern = /\b(?:https?:\/\/[^\s<>"']+|file:\/{2,3}[^\s<>"']*)/gi
    const samples = [
      ['开发服务器：http://localhost:9696/', 'http://localhost:9696/'],
      ['浏览器文件协议（file:/// 无法处理）', 'file:///']
    ]
    for (const [input, expected] of samples) {
      const matches = [...input.matchAll(uriPattern)].map(match => match[0])
      ctx.assert.equal(matches.length, 1, `${expected} must remain one URI token`)
      ctx.assert.equal(matches[0], expected, `${expected} must not become p:// or e:///`)
    }
  }
}
