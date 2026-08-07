(function () {
  const imageExtPattern = /\.(png|jpe?g|webp|gif|bmp|ico|avif|tiff?)$/i
  const modelExtPattern = /\.(glb|gltf)$/i
  const blendExtPattern = /\.blend$/i
  const audioExtPattern = /\.(mp3|wav|m4a|aac|ogg|oga|flac|opus|weba)$/i
  const videoExtPattern = /\.(mp4|webm|mov|m4v|mkv|avi|ogv)$/i

  function bind(options = {}) {
    const api = options.api || window.api
    const createFileTab = options.createFileTab || function () {}
    const closeTab = options.closeTab || function () {}
    const showToast = options.showToast || ((message, type = 'info') => window.ToastUI?.show?.(message, type))
    const getCurrentProjectPath = options.getCurrentProjectPath || function () { return '' }

    function isAbsolutePath(filePath = '') {
      return /^[A-Za-z]:[\\/]/.test(String(filePath || '')) || /^\\\\/.test(String(filePath || '')) || /^\//.test(String(filePath || ''))
    }

    function resolvePreviewPath(filePath = '') {
      const raw = String(filePath || '').trim()
      if (!raw || isAbsolutePath(raw) || /^(?:https?:|file:)/i.test(raw)) return raw
      const projectPath = String(getCurrentProjectPath() || '').trim()
      if (!projectPath) return raw
      return `${projectPath.replace(/[\\/]+$/, '')}\\${raw.replace(/^[\\/]+/, '').replace(/\//g, '\\')}`
    }

    function openFromData(el) {
      const path = resolvePreviewPath(decodeURIComponent(el.getAttribute('data-path') || ''))
      AppLogger.debug('[Frontend] 从 data-path 获取路径:', path)
      open(path)
    }

    function open(path) {
      path = resolvePreviewPath(path)
      AppLogger.debug('[Frontend] 打开文件预览:', path, '路径长度:', path?.length)
      if (!path) {
        showToast((window.i18n?.t?.('auto.js_file_preview_36_0') ?? ((window.i18n?.t?.('auto.js_file_preview_36_1') ?? '路径为空'))), 'error')
        return
      }

      if (imageExtPattern.test(path)) {
        openImage(path)
        return
      }

      if (modelExtPattern.test(path) || blendExtPattern.test(path)) {
        createFileTab(path, '')
        return
      }

      if (audioExtPattern.test(path) || videoExtPattern.test(path)) {
        createFileTab(path, '')
        return
      }

      if (!api?.readFileContent) return

      // 先开空标签再异步读内容，避免点击后整段等待读文件+创建编辑器
      const tab = createFileTab(path, '', false, {
        loading: true,
        deferEditor: true,
        statusText: '加载中...'
      })
      const openToken = Date.now()
      if (tab) tab.openToken = openToken

      api.readFileContent(path).then(result => {
        AppLogger.debug('[Frontend] readFileContent 结果:', result)
        // 用户已关闭标签或切换到同路径新请求时，丢弃过期结果
        if (tab && tab.openToken !== openToken) return

        if (result.success) {
          if (result.isDirectory || result.file_type === 'directory') {
            api.openProjectFolder?.(path)
            showToast((window.i18n?.t?.('auto.js_file_preview_62_1') ?? ((window.i18n?.t?.('auto.js_file_preview_62_2') ?? '这是文件夹，已打开文件夹位置。'))), 'info')
            if (tab?.id != null) closeTab(tab.id)
          } else if (result.dataUrl) {
            if (tab?.id != null) closeTab(tab.id)
            openImageViewer(path, result)
          } else {
            createFileTab(path, result.content || '', false, {
              statusText: '已加载'
            })
          }
        } else {
          const errMsg = result.error || '未知错误'
          if (tab) {
            createFileTab(path, '', false, {
              statusText: result.tooLarge ? '文件过大' : '加载失败',
              statusClass: 'error'
            })
          }
          showToast((window.i18n?.t?.('auto.js_file_preview_66_2') ?? ((window.i18n?.t?.('auto.js_file_preview_66_3') ?? '读取文件失败: '))) + errMsg + ((window.i18n?.t?.('auto.js_file_preview_66_4') ?? '\n路径: ')) + path, 'error')
        }
      }).catch(err => {
        console.error('[Frontend] readFileContent 错误:', err)
        if (tab && tab.openToken === openToken) {
          createFileTab(path, '', false, {
            statusText: '加载失败',
            statusClass: 'error'
          })
        }
        showToast((window.i18n?.t?.('auto.js_file_preview_70_3') ?? ((window.i18n?.t?.('auto.js_file_preview_70_5') ?? '调用失败: '))) + err.message, 'error')
      })
    }

    function openImageFromData(el) {
      const path = resolvePreviewPath(decodeURIComponent(el.getAttribute('data-path') || ''))
      openImage(path)
    }

    function openImage(path) {
      path = resolvePreviewPath(path)
      if (!path) return
      const reader = api?.readImageDataUrl || api?.readFileContent
      if (!reader) return
      reader(path).then(result => {
        if (result.success && result.dataUrl) {
          openImageViewer(path, result)
        } else {
          showToast((window.i18n?.t?.('auto.js_file_preview_88_4') ?? ((window.i18n?.t?.('auto.js_file_preview_88_6') ?? '读取图片失败: '))) + (result.error || ((window.i18n?.t?.('auto.js_file_preview_88_7') ?? '未知错误'))) + ((window.i18n?.t?.('auto.js_file_preview_88_8') ?? '\\n路径: ')) + path, 'error')
        }
      }).catch(err => {
        console.error('[Frontend] readImageDataUrl 错误:', err)
        showToast((window.i18n?.t?.('auto.js_file_preview_92_5') ?? ((window.i18n?.t?.('auto.js_file_preview_92_9') ?? '读取图片失败: '))) + err.message, 'error')
      })
    }

    function buildImageViewerModal({ src, name, path, width, height, canSave, showExpiryNote }) {
      const existing = document.getElementById('imagePreviewModal')
      if (existing) existing.remove()

      const modal = document.createElement('div')
      modal.className = 'image-preview-modal'
      modal.id = 'imagePreviewModal'
      const safeName = escapeHtml(name || '')
      const sizeText = width && height ? `${width} x ${height}` : ''
      const pathHtml = path ? `<div class="image-preview-path">${escapeHtml(path)}</div>` : ''
      const saveButtonHtml = canSave ? `
            <button class="image-preview-save" type="button" aria-label="保存图片" title="保存图片">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/></svg>
            </button>` : ''
      modal.innerHTML = `
        <div class="image-preview-shell">
          <div class="image-preview-header">
            <span class="image-preview-title">${safeName}</span>
            <span class="image-preview-meta">${sizeText}</span>
            ${saveButtonHtml}
            <button class="image-preview-close" type="button" aria-label="关闭">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
            </button>
          </div>
          ${showExpiryNote ? '<div class="image-preview-expiry-note">此图片将在一天后自动删除，若需保存，请自行保存。</div>' : ''}
          <div class="image-preview-canvas">
            <div class="image-preview-content">
              <img src="${src}" alt="${safeName}">
            </div>
          </div>
          ${pathHtml}
        </div>
      `
      const close = () => modal.remove()
      modal.addEventListener('click', event => {
        if (event.target === modal) close()
      })
      modal.querySelector('.image-preview-close')?.addEventListener('click', close)
      if (canSave && path) {
        modal.querySelector('.image-preview-save')?.addEventListener('click', async event => {
          event.stopPropagation()
          if (!api?.saveImageAs) {
            showToast('Save image is unavailable', 'error')
            return
          }
          const saveResult = await api.saveImageAs(path)
          if (saveResult?.success) showToast('Image saved', 'success')
          else if (!saveResult?.canceled) showToast(saveResult?.error || 'Save failed', 'error')
        })
      }
      document.body.appendChild(modal)
      bindImageZoom(modal, { width, height })
    }

    function openImageViewer(path, result = {}) {
      buildImageViewerModal({
        src: result.dataUrl,
        name: getFileName(path),
        path,
        width: result.width,
        height: result.height,
        canSave: true,
        showExpiryNote: isTemporaryScreenshotPath(path)
      })
    }

    function openImageViewerFromSrc({ src, name, width, height } = {}) {
      if (!src) return
      buildImageViewerModal({
        src,
        name: name || '',
        path: '',
        width,
        height,
        canSave: false,
        showExpiryNote: false
      })
    }

    function bindImageZoom(modal, result = {}) {
      const canvas = modal.querySelector('.image-preview-canvas')
      const content = modal.querySelector('.image-preview-content')
      const image = modal.querySelector('.image-preview-content img')
      const meta = modal.querySelector('.image-preview-meta')
      if (!canvas || !content || !image) return

      let zoom = 1
      let fitWidth = 0
      let fitHeight = 0
      let dragging = false
      let dragStartX = 0
      let dragStartY = 0
      let scrollStartLeft = 0
      let scrollStartTop = 0
      const minZoom = 0.15
      const maxZoom = 8
      const sizeText = result.width && result.height ? `${result.width} x ${result.height}` : ''

      const clamp = value => Math.max(minZoom, Math.min(maxZoom, value))
      const updateMeta = () => {
        if (!meta) return
        meta.textContent = `${sizeText}${sizeText ? ' | ' : ''}${Math.round(zoom * 100)}%`
      }
      const applySize = () => {
        content.style.width = `${Math.max(1, Math.round(fitWidth * zoom))}px`
        content.style.height = `${Math.max(1, Math.round(fitHeight * zoom))}px`
        content.style.margin = 'auto'
        canvas.classList.toggle('is-zoomed', zoom > 1.01)
        updateMeta()
      }
      const resetFitSize = () => {
        const naturalWidth = image.naturalWidth || Number(result.width) || 1
        const naturalHeight = image.naturalHeight || Number(result.height) || 1
        const availableWidth = Math.max(1, canvas.clientWidth - 36)
        const availableHeight = Math.max(1, canvas.clientHeight - 36)
        const fit = Math.min(availableWidth / naturalWidth, availableHeight / naturalHeight, 1)
        fitWidth = naturalWidth * fit
        fitHeight = naturalHeight * fit
        applySize()
      }
      const setZoom = (nextZoom, event) => {
        const rect = canvas.getBoundingClientRect()
        const contentRect = content.getBoundingClientRect()
        const oldWidth = contentRect.width
        const oldHeight = contentRect.height
        // getBoundingClientRect 的 left/top 是已经扣除 canvas.scrollLeft/Top 后的可视位置，
        // 所以要加回 scrollLeft/Top 才是 content 相对 canvas padding-box 的"自然位置"。
        const contentOffsetX = contentRect.left - rect.left
        const contentOffsetY = contentRect.top - rect.top
        const anchorX = event ? event.clientX - rect.left : rect.width / 2
        const anchorY = event ? event.clientY - rect.top : rect.height / 2
        // pointerX/Y = 鼠标在 content 内坐标（0..oldWidth/oldHeight）。
        // 与 canvas.scrollLeft 无关 —— scrollLeft 已经体现在 contentOffsetX 里了，再加一次会算重。
        const pointerX = anchorX - contentOffsetX
        const pointerY = anchorY - contentOffsetY
        const ratioX = oldWidth > 0 ? Math.max(0, Math.min(1, pointerX / oldWidth)) : 0.5
        const ratioY = oldHeight > 0 ? Math.max(0, Math.min(1, pointerY / oldHeight)) : 0.5

        zoom = clamp(nextZoom)
        applySize()

        const newContentRect = content.getBoundingClientRect()
        const newWidth = newContentRect.width
        const newHeight = newContentRect.height
        // 同样：newContentOffsetX 里已经带 scrollLeft 了，要加回 canvas.scrollLeft
        // 才能得到 content 的自然位置，再用来计算让“鼠标下同一点”保持对准所需的 scrollLeft。
        const newContentOffsetX = newContentRect.left - rect.left
        const newContentOffsetY = newContentRect.top - rect.top
        const naturalOffsetX = newContentOffsetX + canvas.scrollLeft
        const naturalOffsetY = newContentOffsetY + canvas.scrollTop
        const maxScrollLeft = Math.max(0, canvas.scrollWidth - canvas.clientWidth)
        const maxScrollTop = Math.max(0, canvas.scrollHeight - canvas.clientHeight)
        const targetScrollLeft = naturalOffsetX + ratioX * newWidth - anchorX
        const targetScrollTop = naturalOffsetY + ratioY * newHeight - anchorY
        canvas.scrollLeft = Math.max(0, Math.min(maxScrollLeft, targetScrollLeft))
        canvas.scrollTop = Math.max(0, Math.min(maxScrollTop, targetScrollTop))
      }

      image.addEventListener('load', resetFitSize, { once: true })
      if (image.complete) resetFitSize()
      canvas.addEventListener('wheel', event => {
        event.preventDefault()
        const step = event.deltaY < 0 ? 1.12 : 1 / 1.12
        setZoom(zoom * step, event)
      }, { passive: false })
      canvas.addEventListener('pointerdown', event => {
        if (event.button !== 0 || zoom <= 1.01) return
        dragging = true
        dragStartX = event.clientX
        dragStartY = event.clientY
        scrollStartLeft = canvas.scrollLeft
        scrollStartTop = canvas.scrollTop
        canvas.classList.add('is-dragging')
        canvas.setPointerCapture?.(event.pointerId)
        event.preventDefault()
      })
      canvas.addEventListener('pointermove', event => {
        if (!dragging) return
        canvas.scrollLeft = scrollStartLeft - (event.clientX - dragStartX)
        canvas.scrollTop = scrollStartTop - (event.clientY - dragStartY)
        event.preventDefault()
      })
      const stopDrag = event => {
        if (!dragging) return
        dragging = false
        canvas.classList.remove('is-dragging')
        canvas.releasePointerCapture?.(event.pointerId)
      }
      canvas.addEventListener('pointerup', stopDrag)
      canvas.addEventListener('pointercancel', stopDrag)
      canvas.addEventListener('dblclick', event => {
        event.preventDefault()
        setZoom(1, event)
      })
    }

    const escapeHtml = HtmlUtils.escapeHtml

    function getFileName(filePath) {
      if (!filePath) return ''
      return String(filePath).split(/[\\/]/).pop() || filePath
    }

    function isTemporaryScreenshotPath(filePath) {
      return /[\\/]cache[\\/](screenshots[\\/]screenshot-|generated-images[\\/]generated-image-)[^\\/]+\.png$/i.test(String(filePath || ''))
    }

    previewInstance = {
      openFromData,
      open,
      openImageFromData,
      openImage,
      openImageViewerFromSrc
    }
    return previewInstance
  }

  let previewInstance = null
  window.FilePreview = {
    bind,
    openImageViewerFromSrc(opts) {
      if (!previewInstance) return
      previewInstance.openImageViewerFromSrc(opts)
    }
  }
})()
