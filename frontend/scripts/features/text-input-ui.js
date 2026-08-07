(function () {
  const LONG_TEXT_CHARACTER_THRESHOLD = 4000
  const LONG_TEXT_LINE_THRESHOLD = 120

  function bind(inputBox, options = {}) {
    const onResize = typeof options.onResize === 'function' ? options.onResize : function () {}

    // 离屏隐藏测量元素：同步镇真实输入框的关键样式，避免 "写 height=0 -> 读 scrollHeight -> 写 new height" 的强制同步布局
    let mirrorEl = null
    function ensureMirror() {
      if (mirrorEl && document.body.contains(mirrorEl)) return mirrorEl
      mirrorEl = document.createElement('div')
      mirrorEl.setAttribute('aria-hidden', 'true')
      mirrorEl.style.cssText = 'position:absolute;visibility:hidden;pointer-events:none;left:-9999px;top:0;white-space:pre-wrap;word-wrap:break-word;overflow-wrap:break-word;'
      document.body.appendChild(mirrorEl)
      return mirrorEl
    }

    let lastHeight = -1
    let lastMirrorSync = 0
    // 中文输入法组合状态：compositionstart → true, compositionend → false
    // 组合过程中跳过 input 事件处理，避免强制布局导致输入法卡顿
    let isComposing = false
    // input 事件节流：连续打字时把测量合并到 rAF 内执行，避免每个按键都做 getComputedStyle + 强制 layout
    let _autoResizeRafId = 0
    let _pendingAutoResize = false
    function scheduleAutoResize() {
      // 输入法正在组合拼音时跳过，避免卡顿导致拼音变字母
      if (isComposing) return
      if (_autoResizeRafId) {
        _pendingAutoResize = true
        return
      }
      _autoResizeRafId = requestAnimationFrame(() => {
        _autoResizeRafId = 0
        autoResize()
        if (_pendingAutoResize) {
          // 一帧内又收到 input，再补一次，确保长文快打时不漏量
          _pendingAutoResize = false
          scheduleAutoResize()
        }
      })
    }

    function syncMirrorStyle(el) {
      // 只同步会影响高度的样式；多数样式频率很低，500ms 同步一次即可
      const now = Date.now()
      if (now - lastMirrorSync < 500 && el.style.width && el.style.font) return
      lastMirrorSync = now
      const cs = window.getComputedStyle(inputBox)
      el.style.width = cs.width
      el.style.font = cs.font
      el.style.fontFamily = cs.fontFamily
      el.style.fontSize = cs.fontSize
      el.style.fontWeight = cs.fontWeight
      el.style.lineHeight = cs.lineHeight
      el.style.letterSpacing = cs.letterSpacing
      el.style.padding = cs.padding
      el.style.border = cs.border
      el.style.boxSizing = cs.boxSizing
    }

    function measureHeight() {
      const el = ensureMirror()
      syncMirrorStyle(el)
      // 末尾补一个字符，避免换行末尾空行高度丢失
      el.textContent = (inputBox.value || '') + '\u200b'
      return el.offsetHeight
    }

    function autoResize() {
      const measured = measureHeight()
      const newHeight = Math.max(36, Math.min(measured, 120))
      if (newHeight === lastHeight) return
      lastHeight = newHeight
      inputBox.style.height = newHeight + 'px'
      onResize(newHeight)
    }

    function reset() {
      lastHeight = 36
      inputBox.style.height = '36px'
      inputBox.scrollTop = 0
      onResize(36)
      requestAnimationFrame(autoResize)
    }

    inputBox.addEventListener('input', scheduleAutoResize)
    // 中文输入法组合状态监听：组合过程中不处理 input 事件
    inputBox.addEventListener('compositionstart', () => { isComposing = true })
    inputBox.addEventListener('compositionend', () => {
      isComposing = false
      // 组合完成后补一次 resize，确保高度正确
      scheduleAutoResize()
    })
    // 主题切换、字体变化、DPI 变化时输入框样式会变，触发一次强制同步
    inputBox.addEventListener('change', () => {
      lastMirrorSync = 0
      scheduleAutoResize()
    })
    function insertText(text, selection = {}) {
      const value = String(text || '')
      const start = Number.isInteger(selection.start) ? selection.start : (inputBox.selectionStart ?? inputBox.value.length)
      const end = Number.isInteger(selection.end) ? selection.end : (inputBox.selectionEnd ?? start)
      const textBefore = inputBox.value.substring(0, start)
      const textAfter = inputBox.value.substring(end)
      inputBox.value = textBefore + value + textAfter
      const newCursorPos = start + value.length
      inputBox.setSelectionRange(newCursorPos, newCursorPos)
      autoResize()
      return newCursorPos
    }

    inputBox.addEventListener('paste', async event => {
      const clipboard = event.clipboardData || window.clipboardData
      const clipboardItems = Array.from(clipboard?.items || [])
      const clipboardFiles = Array.from(clipboard?.files || [])
      const hasClipboardImage = clipboardItems.some(item => item.type && item.type.startsWith('image/')) ||
        clipboardFiles.some(file => file.type && file.type.startsWith('image/'))
      if (hasClipboardImage || clipboardFiles.length > 0) return

      const rawPastedText = clipboard?.getData?.('text') || ''
      const pastedText = window.WorkbenchMention?.stripMentionDirectives
        ? window.WorkbenchMention.stripMentionDirectives(rawPastedText)
        : rawPastedText
      const selection = {
        start: inputBox.selectionStart ?? inputBox.value.length,
        end: inputBox.selectionEnd ?? inputBox.value.length
      }
      const lineCount = pastedText ? pastedText.split(/\r\n|\r|\n/).length : 0
      const shouldOfferAttachment = pastedText.length > LONG_TEXT_CHARACTER_THRESHOLD ||
        lineCount > LONG_TEXT_LINE_THRESHOLD

      event.preventDefault()

      if (shouldOfferAttachment && typeof options.onLongTextPaste === 'function') {
        let enabled = true
        try {
          if (typeof options.isLongTextAttachmentEnabled === 'function') {
            enabled = await options.isLongTextAttachmentEnabled()
          }
        } catch (_) {
          enabled = true
        }

        if (enabled) {
          try {
            const handled = await options.onLongTextPaste({
              text: pastedText,
              characterCount: pastedText.length,
              lineCount
            })
            if (handled === true) {
              autoResize()
              return
            }
          } catch (error) {
            console.warn('[TextInputUI] 长文本转附件失败，已回退为普通粘贴:', error)
          }
        }
      }

      insertText(pastedText, selection)
    })

    return { autoResize, reset, insertText }
  }

  window.TextInputUI = {
    bind,
    LONG_TEXT_CHARACTER_THRESHOLD,
    LONG_TEXT_LINE_THRESHOLD
  }
})()
