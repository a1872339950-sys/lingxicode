(function () {
  const READY_DELAY_MS = 2300
  // 临时视觉验收开关：确认新首屏效果后改回 false。
  const FORCE_STARTUP_PREVIEW = false
  let initialized = false
  let leaving = false

  function delay(ms) {
    return new Promise(resolve => window.setTimeout(resolve, ms))
  }

  function getElements() {
    return {
      gateway: document.getElementById('startupAccessGateway'),
      canvas: document.getElementById('startupAccessCanvas'),
      videoStage: document.getElementById('startupAccessVideoStage'),
      video: document.getElementById('startupAccessVideo'),
      content: document.getElementById('startupAccessContent'),
      mark: document.getElementById('startupAccessMark'),
      status: document.getElementById('startupAccessStatus'),
      workspaceButton: document.getElementById('startupWorkspaceAccess'),
      apiButton: document.getElementById('startupApiAccess'),
      minimizeButton: document.getElementById('startupWindowMinimize'),
      closeButton: document.getElementById('startupWindowClose'),
      modelModal: document.getElementById('settingsModelEditorModal')
    }
  }

  function setStatus(els, text) {
    if (els.status) els.status.textContent = String(text || '')
  }

  function hasSavedModels(config) {
    const models = Array.isArray(config?.models) ? config.models : []
    return models.some(model => {
      const modelId = String(model?.modelId || model?.modelName || model?.model || '').trim()
      const apiUrl = String(model?.apiUrl || model?.url || '').trim()
      const apiKey = String(model?.apiKey || model?.key || '').trim()
      return Boolean(modelId && apiUrl && apiKey)
    })
  }

  function hasLocalStorageModels() {
    try {
      const models = JSON.parse(localStorage.getItem('savedModels') || '[]')
      return hasSavedModels({ models })
    } catch (_) {
      return false
    }
  }

  async function resolveExistingAccess() {
    if (window.__lingxiModelConfigReadyPromise) {
      await Promise.race([
        Promise.resolve(window.__lingxiModelConfigReadyPromise).catch(() => null),
        delay(5000)
      ])
    }
    const modelRequest = window.api?.getApiConfig
      ? window.api.getApiConfig().catch(() => null)
      : Promise.resolve(null)
    const modelResult = await modelRequest
    const hasApiModel = Boolean(
      (modelResult?.success && hasSavedModels(modelResult.data)) ||
      hasSavedModels({ models: window.ModelStore?.getModels?.() || [] }) ||
      hasLocalStorageModels()
    )
    return { hasAccess: hasApiModel, hasApiModel }
  }

  async function startVideo(els) {
    if (!els.video) return
    els.video.muted = true
    els.video.defaultMuted = true
    els.video.volume = 0
    try {
      await els.video.play()
    } catch (error) {
      console.warn('[StartupAccess] video playback failed:', error)
      els.gateway?.classList.add('has-video-error')
    }
  }

  function enterAuthMode(els, mode) {
    if (!els.gateway) return
    els.gateway.classList.add('is-auth-mode')
    els.gateway.dataset.authMode = mode
    els.videoStage?.setAttribute('aria-hidden', 'false')
    window.StartupAccessVisual?.stop?.()
    window.StartupAccessTopology?.stop?.()
    if (els.video) {
      try { els.video.currentTime = 0 } catch (_) {}
      void startVideo(els)
    }
  }

  function leaveAuthMode(els) {
    if (!els.gateway || leaving) return
    if (els.modelModal?.classList.contains('show')) return
    els.gateway.classList.remove('is-auth-mode')
    delete els.gateway.dataset.authMode
    els.videoStage?.setAttribute('aria-hidden', 'true')
    if (els.video) {
      els.video.pause()
      try { els.video.currentTime = 0 } catch (_) {}
    }
    window.StartupAccessVisual?.start?.()
    window.StartupAccessTopology?.start?.()
  }

  function dismiss(els = getElements()) {
    if (leaving || !els.gateway) return
    leaving = true
    els.modelModal?.classList.remove('show')
    els.modelModal?.setAttribute('aria-hidden', 'true')
    els.gateway.classList.remove('is-auth-mode')
    delete els.gateway.dataset.authMode
    window.StartupAccessVisual?.stop?.()
    window.StartupAccessTopology?.stop?.()
    els.gateway.classList.add('is-leaving')
    els.gateway.setAttribute('aria-hidden', 'true')
    window.setTimeout(() => {
      els.video?.pause?.()
      document.body.classList.remove('startup-access-active')
    }, 560)
  }

  function openApiEditor(els) {
    enterAuthMode(els, 'api')
    setStatus(els, '保存 API 配置后将自动进入')
    const openButton = document.getElementById('settingsOpenAddModelModalBtn')
    if (openButton) {
      openButton.click()
      return
    }
    setStatus(els, '模型配置入口尚未就绪，请稍后重试')
    leaveAuthMode(els)
  }

  function bindPanelObservers(els) {
    ;[els.modelModal].forEach(panel => {
      if (!panel) return
      const observer = new MutationObserver(() => {
        if (!panel.classList.contains('show') && !leaving) {
          setStatus(els, '')
          window.setTimeout(() => leaveAuthMode(els), 0)
        }
      })
      observer.observe(panel, { attributes: true, attributeFilter: ['class'] })
    })
  }

  function bindSpatialInteraction(els) {
    if (!els.content || window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches) return

    const magneticButtons = Array.from(els.content.querySelectorAll('[data-startup-magnetic]'))
    const resetButton = button => {
      button.style.setProperty('--magnet-x', '0px')
      button.style.setProperty('--magnet-y', '0px')
      button.style.setProperty('--glare-x', '50%')
      button.style.setProperty('--glare-y', '50%')
      delete els.gateway.dataset.accessFocus
    }

    magneticButtons.forEach(button => {
      button.addEventListener('pointermove', event => {
        const rect = button.getBoundingClientRect()
        const localX = event.clientX - rect.left
        const localY = event.clientY - rect.top
        const normalizedX = localX / Math.max(1, rect.width) - 0.5
        const normalizedY = localY / Math.max(1, rect.height) - 0.5
        button.style.setProperty('--magnet-x', `${normalizedX * 8}px`)
        button.style.setProperty('--magnet-y', `${normalizedY * 6}px`)
        button.style.setProperty('--glare-x', `${localX}px`)
        button.style.setProperty('--glare-y', `${localY}px`)
      }, { passive: true })
      button.addEventListener('pointerenter', () => {
        els.gateway.dataset.accessFocus = button.dataset.accessFocus || ''
      }, { passive: true })
      button.addEventListener('pointerleave', () => resetButton(button), { passive: true })
      button.addEventListener('blur', () => resetButton(button))
    })

    els.content.addEventListener('pointermove', event => {
      const rect = els.content.getBoundingClientRect()
      const x = (event.clientX - rect.left) / Math.max(1, rect.width) - 0.5
      const y = (event.clientY - rect.top) / Math.max(1, rect.height) - 0.5
      els.content.style.setProperty('--mark-rotate-x', `${y * -9}deg`)
      els.content.style.setProperty('--mark-rotate-y', `${x * 11}deg`)
      els.content.style.setProperty('--heading-shift-x', `${x * 4}px`)
      els.content.style.setProperty('--heading-shift-y', `${y * 2}px`)
    }, { passive: true })

    els.content.addEventListener('pointerleave', () => {
      els.content.style.setProperty('--mark-rotate-x', '0deg')
      els.content.style.setProperty('--mark-rotate-y', '0deg')
      els.content.style.setProperty('--heading-shift-x', '0px')
      els.content.style.setProperty('--heading-shift-y', '0px')
      magneticButtons.forEach(resetButton)
    }, { passive: true })
  }

  function bindEvents(els) {
    els.workspaceButton?.addEventListener('click', () => dismiss(els))
    els.apiButton?.addEventListener('click', () => openApiEditor(els))
    els.minimizeButton?.addEventListener('click', () => window.api?.mainWindowMinimize?.())
    els.closeButton?.addEventListener('click', () => window.api?.mainWindowClose?.())
    document.addEventListener('lingxi:model-config-saved', event => {
      if (event.detail?.success === false) return
      dismiss(els)
    })
    els.video?.addEventListener('error', () => {
      els.gateway?.classList.add('has-video-error')
    })
    bindSpatialInteraction(els)
    bindPanelObservers(els)
  }

  async function init() {
    if (initialized) return
    initialized = true
    const els = getElements()
    if (!els.gateway) return
    document.body.classList.add('startup-access-active')
    window.StartupAccessVisual?.init?.(els.canvas)
    window.StartupAccessVisual?.start?.()
    window.StartupAccessTopology?.init?.()
    window.StartupAccessTopology?.start?.()
    bindEvents(els)
    setStatus(els, '正在检查模型配置')

    const [, access] = await Promise.all([
      delay(READY_DELAY_MS),
      resolveExistingAccess().catch(error => {
        console.warn('[StartupAccess] access state check failed:', error)
        return { hasAccess: false, hasApiModel: false }
      })
    ])
    if (FORCE_STARTUP_PREVIEW) {
      els.gateway.classList.add('is-ready', 'is-preview-mode')
      setStatus(els, '首屏视觉预览中')
      return
    }
    if (access.hasAccess) {
      els.gateway.classList.add('has-access')
      setStatus(els, '正在进入灵犀')
      dismiss(els)
      return
    }
    els.gateway.classList.add('is-ready')
    setStatus(els, '')
  }

  window.StartupAccessGateway = { init, dismiss: () => dismiss(getElements()) }
  init()
})()
