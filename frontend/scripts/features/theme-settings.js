(function () {
  const STORAGE_KEY = 'lingxiThemeSettings'
  const THEME_SCHEMA_VERSION = 4

  const darkTheme = {
    bgBase: '#09090b',
    bgPrimary: '#111113',
    bgSecondary: '#18181b',
    bgTertiary: '#1f1f23',
    accentPrimary: '#6366f1',
    accentLight: '#818cf8',
    textPrimary: '#fafafa',
    textSecondary: '#a1a1aa',
    borderColor: '#ffffff',
    sidebarBg: '#111113',
    sidebarHover: '#27272a',
    sidebarActive: '#303036',
    chatBg: '#09090b',
    inputBg: '#111113',
    inputBorder: '#ffffff',
    userMessageBg: '#6366f1',
    userMessageText: '#ffffff',
    aiMessageBg: '#09090b',
    aiMessageText: '#fafafa'
  }

  const cleanTheme = {
    bgBase: '#ffffff',
    bgPrimary: '#f7f7f5',
    bgSecondary: '#f2f2f0',
    bgTertiary: '#e8e8e5',
    accentPrimary: '#111827',
    accentLight: '#374151',
    textPrimary: '#111827',
    textSecondary: '#5f6368',
    borderColor: '#d8d8d4',
    sidebarBg: '#f7f7f5',
    sidebarHover: '#e5e5e1',
    sidebarActive: '#dededb',
    chatBg: '#ffffff',
    inputBg: '#ffffff',
    inputBorder: '#d8d8d4',
    userMessageBg: '#ffffff',
    userMessageText: '#111827',
    aiMessageBg: '#ffffff',
    aiMessageText: '#111827'
  }

  const defaultTheme = cleanTheme

  const presets = {
    default: darkTheme,
    graphite: {
      bgBase: '#0c0f12',
      bgPrimary: '#11161b',
      bgSecondary: '#171d24',
      bgTertiary: '#202833',
      accentPrimary: '#14b8a6',
      accentLight: '#5eead4',
      textPrimary: '#f4f8fb',
      textSecondary: '#9aa8b5',
      borderColor: '#f4f8fb',
      sidebarBg: '#11161b',
      sidebarHover: '#202833',
      sidebarActive: '#23313d',
      chatBg: '#0c0f12',
      inputBg: '#11161b',
      inputBorder: '#f4f8fb',
      userMessageBg: '#14b8a6',
      userMessageText: '#f4f8fb',
      aiMessageBg: '#0c0f12',
      aiMessageText: '#f4f8fb'
    },
    dawn: {
      bgBase: '#f7f3ee',
      bgPrimary: '#fffaf5',
      bgSecondary: '#ffffff',
      bgTertiary: '#f0e9df',
      accentPrimary: '#8b5cf6',
      accentLight: '#7c3aed',
      textPrimary: '#201a2e',
      textSecondary: '#6b6078',
      borderColor: '#201a2e',
      sidebarBg: '#fffaf5',
      sidebarHover: '#f0e9df',
      sidebarActive: '#ebe2d8',
      chatBg: '#f7f3ee',
      inputBg: '#ffffff',
      inputBorder: '#201a2e',
      userMessageBg: '#8b5cf6',
      userMessageText: '#201a2e',
      aiMessageBg: '#f7f3ee',
      aiMessageText: '#201a2e'
    },
    parchment: {
      bgBase: '#1a1410',
      bgPrimary: '#221a14',
      bgSecondary: '#2b2018',
      bgTertiary: '#34281e',
      accentPrimary: '#c4956a',
      accentLight: '#d4a574',
      textPrimary: '#e8dcc8',
      textSecondary: '#a89888',
      borderColor: '#e8dcc8',
      sidebarBg: '#221a14',
      sidebarHover: '#2b2018',
      sidebarActive: '#34281e',
      chatBg: '#1a1410',
      inputBg: '#221a14',
      inputBorder: '#e8dcc8',
      userMessageBg: '#c4956a',
      userMessageText: '#1a1410',
      aiMessageBg: '#1a1410',
      aiMessageText: '#e8dcc8'
    },
    clean: cleanTheme
  }

  const fields = [
    ['bgBase', '--bg-base', 'themeBgBase'],
    ['bgPrimary', '--bg-primary', 'themeBgPrimary'],
    ['bgSecondary', '--bg-secondary', 'themeBgSecondary'],
    ['bgTertiary', '--bg-tertiary', 'themeBgTertiary'],
    ['accentPrimary', '--accent-primary', 'themeAccentPrimary'],
    ['accentLight', '--accent-light', 'themeAccentLight'],
    ['textPrimary', '--text-primary', 'themeTextPrimary'],
    ['textSecondary', '--text-secondary', 'themeTextSecondary'],
    ['sidebarBg', '--sidebar-bg', 'themeSidebarBg'],
    ['sidebarHover', '--sidebar-hover-bg', 'themeSidebarHover'],
    ['sidebarActive', '--sidebar-active-bg', 'themeSidebarActive'],
    ['chatBg', '--chat-bg', 'themeChatBg'],
    ['inputBg', '--chat-input-bg', 'themeInputBg'],
    ['userMessageBg', '--user-message-bg', 'themeUserMessageBg'],
    ['userMessageText', '--user-message-text', 'themeUserMessageText'],
    ['aiMessageBg', '--ai-message-bg', 'themeAiMessageBg'],
    ['aiMessageText', '--ai-message-text', 'themeAiMessageText']
  ]

  const alphaFields = [
    ['borderColor', '--theme-border-rgb', 'themeBorderColor', 0.1],
    ['inputBorder', '--theme-input-border-rgb', 'themeInputBorder', 0.18]
  ]

  function hexToRgb(hex) {
    const clean = String(hex || '').replace('#', '')
    if (!/^[0-9a-fA-F]{6}$/.test(clean)) return null
    return {
      r: parseInt(clean.slice(0, 2), 16),
      g: parseInt(clean.slice(2, 4), 16),
      b: parseInt(clean.slice(4, 6), 16)
    }
  }

  function rgba(hex, alpha) {
    const rgb = hexToRgb(hex)
    if (!rgb) return `rgba(99,102,241,${alpha})`
    return `rgba(${rgb.r},${rgb.g},${rgb.b},${alpha})`
  }

  function mix(hexA, hexB, ratio) {
    const a = hexToRgb(hexA)
    const b = hexToRgb(hexB)
    if (!a || !b) return hexA
    const t = Math.max(0, Math.min(1, ratio))
    const toHex = value => Math.round(value).toString(16).padStart(2, '0')
    return '#' + toHex(a.r * (1 - t) + b.r * t) + toHex(a.g * (1 - t) + b.g * t) + toHex(a.b * (1 - t) + b.b * t)
  }

  function isHex(value) {
    return /^#[0-9a-fA-F]{6}$/.test(value || '')
  }

  function isLight(hex) {
    const rgb = hexToRgb(hex)
    if (!rgb) return false
    return (rgb.r * 0.299 + rgb.g * 0.587 + rgb.b * 0.114) > 180
  }

  function normalizeTheme(theme) {
    const source = theme && typeof theme === 'object' ? theme : {}
    const isLegacyCleanTheme =
      source._version !== THEME_SCHEMA_VERSION &&
      ['#f7f7f5', '#ffffff'].includes(String(source.bgBase || '').toLowerCase()) &&
      ['#111827', '#ffffff'].includes(String(source.userMessageText || '').toLowerCase())

    if (isLegacyCleanTheme) return { ...cleanTheme }

    const next = {}
    const baseKeys = ['bgBase', 'bgPrimary', 'bgSecondary', 'bgTertiary', 'accentPrimary', 'accentLight', 'textPrimary', 'textSecondary']
    baseKeys.forEach(key => {
      next[key] = isHex(source[key]) ? source[key] : defaultTheme[key]
    })

    const lightMode = isLight(next.bgBase)
    const isLegacyMixedLight = lightMode && source._version !== THEME_SCHEMA_VERSION
    const derived = {
      borderColor: lightMode ? '#d8d8d4' : next.textPrimary,
      sidebarBg: next.bgPrimary,
      sidebarHover: next.bgTertiary,
      sidebarActive: mix(next.bgTertiary, next.textPrimary, lightMode ? 0.08 : 0.14),
      chatBg: next.bgBase,
      inputBg: next.bgPrimary,
      inputBorder: lightMode ? '#d8d8d4' : next.textPrimary,
      userMessageBg: next.accentPrimary,
      userMessageText: isLight(next.inputBg || next.bgPrimary) ? '#111827' : '#ffffff',
      aiMessageBg: next.bgBase,
      aiMessageText: next.textPrimary
    }

    ;[...fields, ...alphaFields].forEach(([key]) => {
      if (next[key]) return
      const legacyDarkDefault =
        isLegacyMixedLight &&
        ((key === 'sidebarBg' && source[key] === defaultTheme.sidebarBg) ||
          (key === 'sidebarHover' && source[key] === defaultTheme.sidebarHover) ||
          (key === 'sidebarActive' && source[key] === defaultTheme.sidebarActive) ||
          (key === 'chatBg' && source[key] === defaultTheme.chatBg) ||
          (key === 'inputBg' && source[key] === defaultTheme.inputBg) ||
          (key === 'inputBorder' && source[key] === defaultTheme.inputBorder) ||
          (key === 'aiMessageBg' && source[key] === defaultTheme.aiMessageBg) ||
          (key === 'aiMessageText' && source[key] === defaultTheme.aiMessageText))
      next[key] = isHex(source[key]) && !legacyDarkDefault ? source[key] : (derived[key] || defaultTheme[key])
    })
    if (source._version !== THEME_SCHEMA_VERSION) {
      next.userMessageText = isLight(next.inputBg || next.bgPrimary) ? '#111827' : '#ffffff'
    }
    return next
  }

  function getSavedTheme() {
    try {
      return normalizeTheme(JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null'))
    } catch {
      return { ...defaultTheme }
    }
  }

  function applyTheme(theme) {
    const nextTheme = normalizeTheme(theme)
    const root = document.documentElement
    // 临时禁用所有 transition，避免颜色渐变动画
    root.classList.add('theme-transitioning')
    const lightMode = isLight(nextTheme.bgBase)
    root.setAttribute('data-theme-mode', lightMode ? 'light' : 'dark')
    fields.forEach(([key, cssVar]) => root.style.setProperty(cssVar, nextTheme[key]))
    alphaFields.forEach(([key, cssVar, , alpha]) => {
      root.style.setProperty(cssVar, rgba(nextTheme[key], alpha))
    })
    // 浅色主题必须同步 elevated/void 背景，否则欢迎页等组件仍会落到暗色兜底
    root.style.setProperty('--bg-void', nextTheme.bgBase)
    root.style.setProperty('--bg-elevated', lightMode
      ? mix(nextTheme.bgSecondary, nextTheme.bgPrimary, 0.35)
      : mix(nextTheme.bgSecondary, nextTheme.bgTertiary, 0.35))
    root.style.setProperty('--bg-hover', mix(nextTheme.bgTertiary, nextTheme.textPrimary, lightMode ? 0.05 : 0.08))
    root.style.setProperty('--bg-active', mix(nextTheme.bgTertiary, nextTheme.textPrimary, lightMode ? 0.1 : 0.14))
    root.style.setProperty('--accent-dark', mix(nextTheme.accentPrimary, nextTheme.bgBase, lightMode ? 0.18 : 0.24))
    root.style.setProperty('--accent-glow', rgba(nextTheme.accentPrimary, lightMode ? 0.1 : 0.14))
    root.style.setProperty('--border-subtle', rgba(nextTheme.borderColor, lightMode ? 0.18 : 0.08))
    root.style.setProperty('--border-default', rgba(nextTheme.borderColor, lightMode ? 0.28 : 0.11))
    root.style.setProperty('--border-strong', rgba(nextTheme.borderColor, lightMode ? 0.4 : 0.16))
    root.style.setProperty('--border-accent', rgba(nextTheme.accentPrimary, lightMode ? 0.28 : 0.38))
    root.style.setProperty('--chat-input-border', rgba(nextTheme.inputBorder, isLight(nextTheme.inputBg) ? 0.42 : 0.18))
    root.style.setProperty('--text-muted', mix(nextTheme.textSecondary, nextTheme.bgBase, lightMode ? 0.18 : 0.32))
    root.style.setProperty('--text-disabled', mix(nextTheme.textSecondary, nextTheme.bgBase, lightMode ? 0.36 : 0.52))
    root.style.setProperty('--text-placeholder', mix(nextTheme.textSecondary, nextTheme.bgBase, lightMode ? 0.46 : 0.66))
    // 双 rAF 确保浏览器完成绘制后再恢复 transition
    requestAnimationFrame(() => requestAnimationFrame(() => {
      root.classList.remove('theme-transitioning')
      try {
        const detail = { mode: lightMode ? 'light' : 'dark', theme: nextTheme }
        window.dispatchEvent(new CustomEvent('lingxi:theme-changed', { detail }))
        document.dispatchEvent(new CustomEvent('lingxi:theme-changed', { detail }))
      } catch (_) { /* ignore */ }
    }))
    return nextTheme
  }

  function setInputs(theme) {
    ;[...fields, ...alphaFields].forEach(([key, , id]) => {
      const input = document.getElementById(id)
      if (input) input.value = theme[key]
    })
  }

  function readInputs() {
    return normalizeTheme([...fields, ...alphaFields].reduce((theme, [key, , id]) => {
      const input = document.getElementById(id)
      theme[key] = input?.value || defaultTheme[key]
      return theme
    }, {}))
  }

  function setActivePreset(name) {
    document.querySelectorAll('[data-theme-preset]').forEach(button => {
      button.classList.toggle('active', button.dataset.themePreset === name)
    })
    document.documentElement.setAttribute('data-preset', name || '')
  }

  function detectPreset(theme) {
    return Object.entries(presets).find(([, preset]) => {
      return [...fields, ...alphaFields].every(([key]) => preset[key].toLowerCase() === theme[key].toLowerCase())
    })?.[0] || ''
  }

  function persistPreset(presetName) {
    const preset = presets[presetName]
    if (!preset) return null
    const nextTheme = applyTheme(preset)
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...nextTheme, _version: THEME_SCHEMA_VERSION }))
    setInputs(nextTheme)
    setActivePreset(presetName)
    return nextTheme
  }

  function bind(options = {}) {
    const showToast = options.showToast || function () {}
    let currentTheme = applyTheme(getSavedTheme())
    setInputs(currentTheme)
    setActivePreset(detectPreset(currentTheme))

    ;[...fields, ...alphaFields].forEach(([, , id]) => {
      const input = document.getElementById(id)
      if (!input) return
      input.addEventListener('input', () => {
        currentTheme = applyTheme(readInputs())
        setActivePreset(detectPreset(currentTheme))
      })
    })

    document.querySelectorAll('[data-theme-preset]').forEach(button => {
      button.addEventListener('click', () => {
        const presetName = button.dataset.themePreset
        currentTheme = persistPreset(presetName) || applyTheme(presets[presetName] || defaultTheme)
      })
    })

    const saveButton = document.getElementById('themeSaveBtn')
    if (saveButton) {
      saveButton.onclick = () => {
        currentTheme = applyTheme(readInputs())
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...currentTheme, _version: THEME_SCHEMA_VERSION }))
        setActivePreset(detectPreset(currentTheme))
        showToast((window.i18n?.t?.('auto.js_theme_settings_166_0') ?? ((window.i18n?.t?.('auto.js_theme_settings_166_1') ?? '个性化设置已保存'))), 'success')
      }
    }

    const resetButton = document.getElementById('themeResetBtn')
    if (resetButton) {
      resetButton.onclick = () => {
        localStorage.removeItem(STORAGE_KEY)
        currentTheme = applyTheme(defaultTheme)
        setInputs(currentTheme)
        setActivePreset('clean')
        showToast((window.i18n?.t?.('auto.js_theme_settings_177_1') ?? ((window.i18n?.t?.('auto.js_theme_settings_177_2') ?? '已恢复默认颜色'))), 'success')
      }
    }

    return {
      applyTheme,
      applyPreset: presetName => {
        currentTheme = persistPreset(presetName) || currentTheme
        return { ...currentTheme }
      },
      getTheme: () => ({ ...currentTheme })
    }
  }

  applyTheme(getSavedTheme())

  window.ThemeSettings = {
    bind,
    applyTheme,
    applyPreset: persistPreset,
    defaultTheme,
    presets
  }
})()
