(function () {
  let uploadedFiles = []

  const imageExts = ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp', 'svg', 'ico']
  function removeIcon() {
    return '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>'
  }

  function escapeHtml(value) {
    if (window.HtmlUtils?.escapeHtml) return window.HtmlUtils.escapeHtml(value)
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
  }

  const fileIcons = {
    png: '<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M8.5 13.5l2.5 3 2.5-3h-1.5v-3h-2v3H8.5m5-3v3h-1.5l2.5 3 2.5-3H16v-3h-2.5m-6-8L6 5v14h12V6l-2-1.5H7.5M7 7h2v2H7V7m4 0h2v2h-2V7m-4 3h6v5H7v-5z"/></svg>',
    jpg: '<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M8.5 13.5l2.5 3 2.5-3h-1.5v-3h-2v3H8.5m5-3v3h-1.5l2.5 3 2.5-3H16v-3h-2.5m-6-8L6 5v14h12V6l-2-1.5H7.5M7 7h2v2H7V7m4 0h2v2h-2V7m-4 3h6v5H7v-5z"/></svg>',
    jpeg: '<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M8.5 13.5l2.5 3 2.5-3h-1.5v-3h-2v3H8.5m5-3v3h-1.5l2.5 3 2.5-3H16v-3h-2.5m-6-8L6 5v14h12V6l-2-1.5H7.5M7 7h2v2H7V7m4 0h2v2h-2V7m-4 3h6v5H7v-5z"/></svg>',
    gif: '<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M8.5 13.5l2.5 3 2.5-3h-1.5v-3h-2v3H8.5m5-3v3h-1.5l2.5 3 2.5-3H16v-3h-2.5m-6-8L6 5v14h12V6l-2-1.5H7.5M7 7h2v2H7V7m4 0h2v2h-2V7m-4 3h6v5H7v-5z"/></svg>',
    bmp: '<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M8.5 13.5l2.5 3 2.5-3h-1.5v-3h-2v3H8.5m5-3v3h-1.5l2.5 3 2.5-3H16v-3h-2.5m-6-8L6 5v14h12V6l-2-1.5H7.5M7 7h2v2H7V7m4 0h2v2h-2V7m-4 3h6v5H7v-5z"/></svg>',
    webp: '<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M8.5 13.5l2.5 3 2.5-3h-1.5v-3h-2v3H8.5m5-3v3h-1.5l2.5 3 2.5-3H16v-3h-2.5m-6-8L6 5v14h12V6l-2-1.5H7.5M7 7h2v2H7V7m4 0h2v2h-2V7m-4 3h6v5H7v-5z"/></svg>',
    pdf: '<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6m-1 2l5 5h-5V4m-3 9h4v2h-4v-2m0 4h4v2h-4v-2m6-4h2v6h-2v-6z"/></svg>',
    doc: '<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6m4 18H6V4h7v5h5v11z"/></svg>',
    docx: '<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6m4 18H6V4h7v5h5v11z"/></svg>',
    xls: '<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6m-2 8l2 3-2 3h2l1-2 1 2h2l-2-3 2-3h-2l-1 2-1-2h-2m3-6V4l5 5h-5z"/></svg>',
    xlsx: '<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6m-2 8l2 3-2 3h2l1-2 1 2h2l-2-3 2-3h-2l-1 2-1-2h-2m3-6V4l5 5h-5z"/></svg>',
    zip: '<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M20 6h-8l-2-2H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2m-8 11H8v-2h4v2m0-4H8v-2h4v2m0-4H8V9h4v2m4 8h-4v-2h4v2m0-4h-4v-2h4v2m0-4h-4V9h4v2m2-3V4l5 5h-5z"/></svg>',
    rar: '<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M20 6h-8l-2-2H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2m-4 11h-2v-2h2v2m0-4h-2v-2h2v2m2 4h-2v-2h2v2m0-4h-2v-2h2v2z"/></svg>',
    '7z': '<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M20 6h-8l-2-2H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2z"/></svg>',
    js: '<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><rect x="3" y="3" width="18" height="18" rx="2"/><text x="12" y="16" text-anchor="middle" font-size="8" fill="none" stroke="currentColor">JS</text></svg>',
    ts: '<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><rect x="3" y="3" width="18" height="18" rx="2"/><text x="12" y="16" text-anchor="middle" font-size="8" fill="none" stroke="currentColor">TS</text></svg>',
    py: '<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><rect x="3" y="3" width="18" height="18" rx="2"/><text x="12" y="16" text-anchor="middle" font-size="8" fill="none" stroke="currentColor">PY</text></svg>',
    html: '<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M12 17.56l4.07-1.13.53-5.14H9.36l-.18-2h7.64l.27-2H7l.6 6h8.05l-.29 3.12-2.93.75-2.93-.75-.2-2h-2l.35 3.5 2.07.55m1-14.12L3 4v16l9 2 9-2V4l-9-2z"/></svg>',
    css: '<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M5 3l-.65 3.34h13.59L17.5 8.5H4.27l-.53 2.82h13.59l-.77 4.07-5.88 1.55-5.2-1.55.33-1.81H2.6l-.79 4.04 8.54 2.26 9.86-2.74L21 3H5z"/></svg>',
    json: '<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M5 3h2v2H5v4c0 1.1-.9 2-2 2 1.1 0 2 .9 2 2v4h2v2H5c-1.1-1-2-2.1-2-3.5V12c0-.6-.4-1-1-1H1v-2h1c.6 0 1-.4 1-1V6.5C2 5.1 2.9 4 5 3m14 0c2.1 0 3 1.1 3 2.5V8c0 .6.4 1 1 1h1v2h-1c-.6 0-1 .4-1 1v3.5c0 1.4-.9 2.5-3 3.5h-2v-2h2v-4c0-1.1.9-2 2-2-1.1 0-2-.9-2-2V5h-2V3h2z"/></svg>',
    txt: '<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6m4 18H6V4h7v5h5v11z"/></svg>',
    md: '<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6m4 18H6V4h7v5h5v11M9.5 13v4h1.5l1.5-2 1.5 2H15v-4h-1.5v2.5L12 13l-1.5 2.5V13H9.5z"/></svg>'
  }

  function getFiles() {
    return uploadedFiles
  }

  function revokeThumbnail(file) {
    if (file?.thumb && String(file.thumb).startsWith('blob:')) {
      URL.revokeObjectURL(file.thumb)
    }
  }

  async function addPathFiles(files) {
    const entries = []
    for (const file of Array.from(files || [])) {
      const entry = {
        name: file.name,
        path: file.path,
        size: file.size,
        type: file.type || 'file',
        pathSource: file.pathSource || (file.temporary ? 'temporary' : 'electron'),
        temporary: file.temporary === true
      }
      entries.push(entry)
    }
    uploadedFiles.push(...entries)
  }

  async function addBrowserFiles(files, api = window.api) {
    const entries = []
    for (const file of Array.from(files || [])) {
      const filePath = api?.getFilePath?.(file) || ''
      const isImage = (file.type && file.type.startsWith('image/')) || imageExts.includes(file.name.split('.').pop().toLowerCase())
      const entry = {
        name: file.name,
        size: file.size,
        type: file.type,
        path: filePath || null,
        pathSource: filePath ? 'electron' : 'browser',
        file: filePath ? null : file
      }
      if (isImage) {
        try {
          entry.thumb = await createImageThumbnail(file)
        } catch (e) {
          entry.thumb = ''
        }
      }

      // 手动选择/拖放的文件必须先进入应用受管缓存，否则点击预览时会被项目路径安全边界拒绝。
      if (api?.saveUploadedFile) {
        try {
          const dataUrl = await readFileAsDataUrl(file)
          const saved = await api.saveUploadedFile({
            data: dataUrl,
            type: file.type || 'application/octet-stream',
            name: file.name || 'attachment'
          })
          if (saved?.success && saved.path) {
            entry.path = saved.path
            entry.pathSource = 'temporary'
            entry.temporary = true
            entry.file = null
          } else if (saved?.error) {
            window.ToastUI?.show?.(`附件缓存失败：${saved.error}`, 'error')
          }
        } catch (error) {
          console.warn('[Attachments] 保存上传附件失败:', error)
          window.ToastUI?.show?.(`附件缓存失败：${error.message || error}`, 'error')
        }
      }
      entries.push(entry)
    }
    uploadedFiles.push(...entries)
  }

  function readFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result || ''))
      reader.onerror = () => reject(reader.error || new Error('读取附件失败'))
      reader.readAsDataURL(file)
    })
  }

  async function addClipboardImagesFromItems(items, api = window.api) {
    const imageFiles = []
    for (const item of Array.from(items || [])) {
      if (item?.type?.startsWith('image/')) {
        const file = item.getAsFile?.()
        if (file) imageFiles.push(file)
      }
    }
    if (imageFiles.length === 0) return false

    const entries = []
    for (const file of imageFiles) {
      const dataUrl = await readFileAsDataUrl(file)
      const result = await api?.savePastedImage?.({
        data: dataUrl,
        type: file.type || 'image/png',
        name: file.name || 'pasted-image.png'
      })
      if (result?.success && result.path) {
        entries.push({
          name: result.name || file.name || 'pasted-image.png',
          size: file.size,
          type: result.type || file.type || 'image/png',
          path: result.path,
          pathSource: 'temporary',
          temporary: true,
          thumb: URL.createObjectURL(file)
        })
      }
    }
    if (entries.length === 0) return false
    uploadedFiles.push(...entries)
    return true
  }

  async function addPastedText(text, api = window.api) {
    const content = String(text || '')
    if (!content || !api?.savePastedText) return false
    const lineCount = content.split(/\r\n|\r|\n/).length
    const result = await api.savePastedText({ text: content })
    if (!result?.success || !result.path) {
      console.warn('[Attachments] 保存粘贴文本失败:', result?.error || 'unknown error')
      return false
    }
    const size = Number(result.size) || new TextEncoder().encode(content).byteLength
    uploadedFiles.push({
      name: result.name || '粘贴内容.txt',
      size,
      type: result.type || 'text/plain',
      path: result.path,
      pathSource: 'temporary',
      temporary: true,
      source: 'pasted-text',
      pastedText: content,
      characterCount: content.length,
      lineCount
    })
    return true
  }

  function cleanupTemporaryFile(file, api = window.api) {
    if (file?.temporary && file.path) {
      api?.deleteTempFiles?.([file.path]).catch(error => {
        console.warn('[Attachments] 清理临时附件失败:', error)
      })
    }
  }

  function remove(index, api = window.api) {
    const removed = uploadedFiles.splice(index, 1)[0]
    revokeThumbnail(removed)
    cleanupTemporaryFile(removed, api)
  }

  function clear(options = {}) {
    const shouldDeleteTemporary = options.deleteTemporary === true
    if (shouldDeleteTemporary) {
      uploadedFiles.forEach(file => cleanupTemporaryFile(file))
    }
    uploadedFiles.forEach(revokeThumbnail)
    uploadedFiles = []
  }

  function createImageThumbnail(file) {
    if (!file) return ''
    return URL.createObjectURL(file)
  }

  async function addFileList(files, onChange, api = window.api) {
    if (!files || files.length === 0) return false
    await addBrowserFiles(files, api)
    onChange()
    return true
  }

  function showImageLightbox(src, name) {
    const probe = new Image()
    probe.onload = () => {
      window.FilePreview?.openImageViewerFromSrc?.({
        src,
        name,
        width: probe.naturalWidth,
        height: probe.naturalHeight
      })
    }
    probe.onerror = () => {
      window.FilePreview?.openImageViewerFromSrc?.({ src, name })
    }
    probe.src = src
  }

  function render(options) {
    const area = options.area
    const inputWrapper = options.inputWrapper

    if (uploadedFiles.length === 0) {
      area.classList.remove('show')
      inputWrapper.classList.remove('has-files')
      area.innerHTML = ''
      return
    }

    area.classList.add('show')
    inputWrapper.classList.add('has-files')
    area.innerHTML = uploadedFiles.map((f, i) => {
      const ext = f.name.split('.').pop().toLowerCase()
      const isImage = (f.type && f.type.startsWith('image/')) || imageExts.includes(ext)
      const isPastedText = f.source === 'pasted-text'
      const fallbackIcon = '<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M10 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z"/></svg>'
      const icon = fileIcons[ext] || fallbackIcon
      const safeName = escapeHtml(f.name)
      const pastedMeta = isPastedText
        ? `${Number(f.characterCount) || 0} 字符 · ${Number(f.lineCount) || 0} 行`
        : ''
      const title = escapeHtml(isPastedText ? `点击预览 · ${pastedMeta}` : '点击预览')
      // data-path 存真实磁盘路径（用于预览）
      const pathAttr = f.path ? ` data-path="${encodeURIComponent(f.path)}"` : ''

      if (isImage) {
        const thumbHtml = f.thumb ? `<img class="uploaded-file-thumb" src="${f.thumb}" alt="${f.name}">` : ''
        return `
          <div class="uploaded-file-item is-clickable" data-index="${i}" title="${title}"${pathAttr}>
            ${thumbHtml}
            <span class="uploaded-file-icon">${fileIcons[ext] || fileIcons.png}</span>
            <span class="uploaded-file-name">${safeName}</span>
            <span class="uploaded-file-remove" data-index="${i}">${removeIcon()}</span>
          </div>
        `
      }

      return `
        <div class="uploaded-file-item is-clickable${isPastedText ? ' is-pasted-text' : ''}" data-index="${i}" title="${title}"${pathAttr}>
          <span class="uploaded-file-icon">${icon}</span>
          <span class="uploaded-file-name">${safeName}</span>
          ${isPastedText ? `<span class="uploaded-file-meta">${escapeHtml(pastedMeta)}</span><button type="button" class="uploaded-file-restore" data-index="${i}" title="恢复到输入框">恢复为文字</button>` : ''}
          <span class="uploaded-file-remove" data-index="${i}">${removeIcon()}</span>
        </div>
      `
    }).join('')

    area.querySelectorAll('.uploaded-file-remove').forEach(btn => {
      btn.onclick = ev => {
        ev.stopPropagation()
        remove(parseInt(btn.dataset.index, 10), options.api || window.api)
        options.onChange?.()
      }
    })

    area.querySelectorAll('.uploaded-file-restore').forEach(btn => {
      btn.onclick = ev => {
        ev.stopPropagation()
        const idx = parseInt(btn.dataset.index, 10)
        const file = uploadedFiles[idx]
        if (!file) return
        const restored = options.onRestoreText?.(file)
        if (restored === false) return
        remove(idx, options.api || window.api)
        options.onChange?.()
      }
    })

    area.querySelectorAll('.uploaded-file-item').forEach(item => {
      item.onclick = ev => {
        if (ev.target.closest('.uploaded-file-remove')) return
        const idx = parseInt(item.dataset.index, 10)
        const file = uploadedFiles[idx]
        if (!file) return
        if (file.thumb && ((file.type && file.type.startsWith('image/')) || imageExts.includes(file.name.split('.').pop().toLowerCase()))) {
          showImageLightbox(file.thumb, file.name)
        } else if (file.path) {
          window.openFilePreviewFromData?.(item)
        } else {
          window.ToastUI?.show?.('该文件未保存到磁盘，无法预览', 'info')
        }
      }
    })
  }

  function bindUpload(options = {}) {
    const api = options.api || window.api
    const uploadButton = options.uploadButton
    const fileInput = options.fileInput
    const pasteTarget = options.pasteTarget
    const dropTarget = options.dropTarget
    const onChange = options.onChange || function () {}

    if (uploadButton) {
      uploadButton.onclick = async () => {
        if (fileInput) {
          fileInput.click()
        } else if (api?.selectFiles) {
          const result = await api.selectFiles()
          if (!result.canceled && result.files.length > 0) {
            await addPathFiles(result.files)
            onChange()
          }
        }
      }
    }

    if (fileInput) {
      fileInput.onchange = async event => {
        const files = event.target.files
        await addFileList(files, onChange, api)
        fileInput.value = ''
      }
    }

    if (pasteTarget) {
      pasteTarget.addEventListener('paste', async event => {
        const items = event.clipboardData?.items
        if (items && Array.from(items).some(item => item.type?.startsWith('image/'))) {
          event.preventDefault()
          const added = await addClipboardImagesFromItems(items, api)
          if (added) onChange()
          return
        }
        const files = event.clipboardData?.files
        if (files && files.length > 0) {
          event.preventDefault()
          await addFileList(files, onChange, api)
        }
      })
    }

    if (dropTarget) {
      dropTarget.addEventListener('dragover', event => {
        if (event.dataTransfer?.types?.includes('Files')) {
          event.preventDefault()
          dropTarget.classList.add('drag-over')
        }
      })
      dropTarget.addEventListener('dragleave', event => {
        if (!dropTarget.contains(event.relatedTarget)) {
          dropTarget.classList.remove('drag-over')
        }
      })
      dropTarget.addEventListener('drop', async event => {
        const files = event.dataTransfer?.files
        if (files && files.length > 0) {
          event.preventDefault()
          dropTarget.classList.remove('drag-over')
          await addFileList(files, onChange, api)
        }
      })
    }

    window.removeUploadedFile = index => {
      remove(index, api)
      onChange()
    }
  }

  window.AttachmentStore = {
    getFiles,
    addPathFiles,
    addBrowserFiles,
    addClipboardImagesFromItems,
    addPastedText,
    remove,
    clear,
    createImageThumbnail,
    addFileList,
    render,
    bindUpload
  }
})()
