(function () {
  // 密码框在 Electron/Chromium 下复制常变成圆点掩码。
  // API Key 统一用 type=text + -webkit-text-security 做遮罩，并强制写真值到剪贴板。
  // 注意：不能清洗掉 '.' 等合法字符，只清真正的圆点掩码字符。
  const MASK_CHARS_RE = /[\u2022\u25CF\u25E6\u2219\u30FB\u00B7•●○∙·]/g
  const MASK_ONLY_RE = /^[\u2022\u25CF\u25E6\u2219\u30FB\u00B7•●○∙·.\s]+$/

  function sanitizeApiKeyText(value = '') {
    return String(value || '')
      .replace(MASK_CHARS_RE, '')
      .split('')
      .filter(char => char.charCodeAt(0) <= 255)
      .join('')
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
      .trim()
  }

  function isMaskOnlyKey(value = '') {
    const text = String(value || '')
    return !!text && MASK_ONLY_RE.test(text)
  }

  function setApiKeyRealValue(input, value = '') {
    if (!input) return ''
    const next = String(value ?? '')
    input.dataset.realApiKey = next
    return next
  }

  function getApiKeyRealValue(input) {
    if (!input) return ''
    if (Object.prototype.hasOwnProperty.call(input.dataset, 'realApiKey')) {
      return String(input.dataset.realApiKey || '')
    }
    return String(input.value || '')
  }

  function setApiKeyMasked(input, masked = true) {
    if (!input) return
    // 关键：不要用 type=password，否则系统复制会给圆点
    input.type = 'text'
    input.autocomplete = 'off'
    input.spellcheck = false
    input.setAttribute('autocapitalize', 'off')
    input.setAttribute('autocorrect', 'off')
    input.classList.toggle('is-masked', !!masked)
    input.dataset.keyMasked = masked ? '1' : '0'
  }

  function isApiKeyMasked(input) {
    if (!input) return true
    if (input.dataset.keyMasked === '0') return false
    if (input.dataset.keyMasked === '1') return true
    return input.classList.contains('is-masked') || input.type === 'password'
  }

  async function writeClipboardText(text, restoreFocusEl = null) {
    const value = String(text || '')
    if (!value) return false
    const prev = restoreFocusEl || document.activeElement
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(value)
        if (prev && typeof prev.focus === 'function') {
          try { prev.focus({ preventScroll: true }) } catch (_err) { prev.focus() }
        }
        return true
      }
    } catch (_err) { /* fall through */ }

    try {
      const area = document.createElement('textarea')
      area.value = value
      area.setAttribute('readonly', 'readonly')
      area.style.position = 'fixed'
      area.style.top = '0'
      area.style.left = '-9999px'
      area.style.opacity = '0'
      document.body.appendChild(area)
      area.focus()
      area.select()
      area.setSelectionRange(0, value.length)
      const ok = document.execCommand('copy')
      area.remove()
      if (prev && typeof prev.focus === 'function') {
        try { prev.focus({ preventScroll: true }) } catch (_err) { prev.focus() }
      }
      return !!ok
    } catch (_err) {
      if (prev && typeof prev.focus === 'function') {
        try { prev.focus({ preventScroll: true }) } catch (_e2) { /* noop */ }
      }
      return false
    }
  }

  function bindApiKeyClipboard(input) {
    if (!input || input.dataset.keyClipboardBound === '1') return input
    input.dataset.keyClipboardBound = '1'

    // 首次绑定就把 password 转成可复制的遮罩文本框
    const initial = String(input.value || '')
    setApiKeyRealValue(input, initial)
    setApiKeyMasked(input, true)

    input.addEventListener('input', () => {
      setApiKeyRealValue(input, input.value)
    })
    input.addEventListener('change', () => {
      setApiKeyRealValue(input, input.value)
    })

    const forceCopyReal = async event => {
      const real = getApiKeyRealValue(input)
      if (!real) return false
      if (event) {
        event.preventDefault()
        event.stopPropagation()
        try {
          event.clipboardData?.setData('text/plain', real)
        } catch (_err) { /* noop */ }
      }
      const ok = await writeClipboardText(real, input)
      if (isMaskOnlyKey(real)) {
        window.showToast?.('当前 Key 已是圆点掩码，请重新粘贴真 Key 后保存', 'error')
      }
      return ok
    }

    input.addEventListener('copy', event => {
      void forceCopyReal(event)
    })

    input.addEventListener('cut', event => {
      const real = getApiKeyRealValue(input)
      if (!real) return
      event.preventDefault()
      event.stopPropagation()
      try {
        event.clipboardData?.setData('text/plain', real)
      } catch (_err) { /* noop */ }
      void writeClipboardText(real, input)
      const start = input.selectionStart ?? 0
      const end = input.selectionEnd ?? real.length
      const next = real.slice(0, start) + real.slice(end)
      input.value = next
      setApiKeyRealValue(input, next)
      try { input.setSelectionRange(start, start) } catch (_err) { /* noop */ }
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })

    input.addEventListener('paste', event => {
      const text = event.clipboardData?.getData('text/plain')
      if (text == null) return
      event.preventDefault()
      const cleaned = sanitizeApiKeyText(text)
      if (!cleaned && isMaskOnlyKey(text)) {
        window.showToast?.('粘贴内容是圆点掩码，不是真 Key', 'error')
        return
      }
      const current = getApiKeyRealValue(input)
      const start = input.selectionStart ?? current.length
      const end = input.selectionEnd ?? current.length
      const next = current.slice(0, start) + cleaned + current.slice(end)
      input.value = next
      setApiKeyRealValue(input, next)
      const caret = start + cleaned.length
      try { input.setSelectionRange(caret, caret) } catch (_err) { /* noop */ }
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })

    // Ctrl/Cmd + C/X 兜底；不要拦截 Ctrl+A，明文全选必须交给浏览器原生处理
    input.addEventListener('keydown', event => {
      const key = String(event.key || '').toLowerCase()
      const mod = event.ctrlKey || event.metaKey
      if (!mod) return
      if (key === 'c') {
        void forceCopyReal(event)
      } else if (key === 'x') {
        const real = getApiKeyRealValue(input)
        if (!real) return
        event.preventDefault()
        event.stopPropagation()
        void writeClipboardText(real, input)
        const start = input.selectionStart ?? 0
        const end = input.selectionEnd ?? real.length
        const next = real.slice(0, start) + real.slice(end)
        input.value = next
        setApiKeyRealValue(input, next)
        try { input.setSelectionRange(start, start) } catch (_err) { /* noop */ }
        input.dispatchEvent(new Event('input', { bubbles: true }))
      }
    })

    return input
  }

  function center(panel) {
    if (!panel) return
    const panelWidth = 380
    const panelHeight = Math.min(panel.offsetHeight || 400, window.innerHeight - 80)
    const left = Math.max(10, (window.innerWidth - panelWidth) / 2)
    const top = Math.max(10, (window.innerHeight - panelHeight) / 2)
    panel.style.left = left + 'px'
    panel.style.top = top + 'px'
  }

  function bind(options) {
    const panel = options.panel
    if (!panel) return

    if (options.closeButton) {
      options.closeButton.onclick = () => {
        panel.classList.remove('show')
      }
    }

    document.addEventListener('click', e => {
      if (!panel.contains(e.target)) {
        panel.classList.remove('show')
      }
    })

    if (options.apiKeyInput) {
      bindApiKeyClipboard(options.apiKeyInput)
    }

    if (options.keyToggle && options.apiKeyInput) {
      options.keyToggle.addEventListener('mousedown', event => {
        event.preventDefault()
      })
      options.keyToggle.onclick = event => {
        event.preventDefault()
        event.stopPropagation()
        const currentValue = getApiKeyRealValue(options.apiKeyInput)
        const nextMasked = !isApiKeyMasked(options.apiKeyInput)
        options.apiKeyInput.value = currentValue
        setApiKeyRealValue(options.apiKeyInput, currentValue)
        setApiKeyMasked(options.apiKeyInput, nextMasked)
        options.keyToggle.textContent = nextMasked
          ? ((window.i18n?.t?.('auto.js_settings_panel_ui_29_1') ?? '显示'))
          : ((window.i18n?.t?.('auto.js_settings_panel_ui_29_2') ?? '隐藏'))
        if (!nextMasked && isMaskOnlyKey(currentValue)) {
          window.showToast?.('当前 Key 已是圆点掩码，请重新粘贴真 Key 后保存', 'error')
        }
      }
    }

    const observer = new MutationObserver(mutations => {
      mutations.forEach(mutation => {
        if (mutation.attributeName === 'class' && panel.classList.contains('show')) {
          center(panel)
        }
      })
    })
    observer.observe(panel, { attributes: true })

    bindDragging(panel)
  }

  function bindDragging(panel) {
    let isDragging = false
    let startX = 0
    let startY = 0
    let windowStartX = 0
    let windowStartY = 0
    let dragTimer = null

    panel.addEventListener('mousedown', e => {
      if (e.target.closest('input, textarea, button, .model-btn, .settings-tabs, .settings-tab, .settings-close, .model-item')) return

      dragTimer = setTimeout(() => {
        isDragging = true
        startX = e.clientX
        startY = e.clientY
        windowStartX = parseInt(panel.style.left, 10) || (window.innerWidth - 380) / 2
        windowStartY = parseInt(panel.style.top, 10) || (window.innerHeight - 400) / 2
        panel.style.cursor = 'grabbing'
      }, 150)
    })

    document.addEventListener('mousemove', e => {
      if (!isDragging) return
      const deltaX = e.clientX - startX
      const deltaY = e.clientY - startY
      panel.style.left = (windowStartX + deltaX) + 'px'
      panel.style.top = (windowStartY + deltaY) + 'px'
    })

    document.addEventListener('mouseup', () => {
      if (dragTimer) clearTimeout(dragTimer)
      dragTimer = null
      isDragging = false
      panel.style.cursor = ''
    })
  }

  window.SettingsPanelUI = {
    bind,
    center,
    sanitizeApiKeyText,
    isMaskOnlyKey,
    bindApiKeyClipboard,
    getApiKeyRealValue,
    setApiKeyRealValue,
    setApiKeyMasked,
    isApiKeyMasked,
    writeClipboardText
  }
})()
