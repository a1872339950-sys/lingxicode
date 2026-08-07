(function () {
  function bindPointerReorder(options = {}) {
    const list = options.list
    const itemSelector = options.itemSelector
    const handleSelector = options.handleSelector
    const getIndex = options.getIndex || (item => Number(item?.dataset?.index))
    const onMove = options.onMove || function () {}
    if (!list || !itemSelector || !handleSelector) return

    const doc = options.document || list.ownerDocument || document
    const items = Array.from(list.querySelectorAll(itemSelector))
    const resolveItem = node => {
      const item = node?.matches?.(itemSelector) ? node : node?.closest?.(itemSelector)
      return item && list.contains(item) ? item : null
    }
    const commit = (sourceItem, targetItem) => {
      const fromIndex = getIndex(sourceItem)
      const toIndex = getIndex(targetItem)
      if (!Number.isInteger(fromIndex) || !Number.isInteger(toIndex) || fromIndex === toIndex) return
      onMove(fromIndex, toIndex, sourceItem, targetItem)
    }

    items.forEach(item => {
      const handle = item.querySelector(handleSelector)
      if (!handle) return

      // Electron 中原生 HTML5 drag/drop 会被嵌套按钮、动画和 Chromium 拖放接管影响。
      // 这里统一使用 Pointer Events，按坐标命中目标卡片，不再依赖原生拖放。
      item.draggable = false
      handle.draggable = false
      handle.setAttribute('role', 'button')
      handle.setAttribute('tabindex', '0')
      handle.setAttribute('aria-label', '拖拽调整顺序')

      handle.addEventListener('keydown', event => {
        const direction = event.key === 'ArrowUp' || event.key === 'ArrowLeft'
          ? -1
          : event.key === 'ArrowDown' || event.key === 'ArrowRight'
            ? 1
            : 0
        if (!direction) return
        const currentIndex = items.indexOf(item)
        const targetItem = items[currentIndex + direction]
        if (!targetItem) return
        event.preventDefault()
        commit(item, targetItem)
      })

      item.addEventListener('pointerdown', event => {
        if (event.isPrimary === false || (typeof event.button === 'number' && event.button !== 0)) return
        const interactiveTarget = event.target?.closest?.('button, input, textarea, select, a, [contenteditable="true"], [data-action], .settings-model-actions, .settings-model-btn')
        if (interactiveTarget) return
        const pointerId = event.pointerId
        const startX = Number(event.clientX) || 0
        const startY = Number(event.clientY) || 0
        let moved = false
        let targetItem = item

        const clearTarget = () => {
          items.forEach(candidate => candidate.classList.remove('drag-over'))
        }
        const cleanup = () => {
          doc.removeEventListener('pointermove', handlePointerMove)
          doc.removeEventListener('pointerup', finishPointerDrag)
          doc.removeEventListener('pointercancel', cancelPointerDrag)
          clearTarget()
          item.classList.remove('drag-armed')
          item.classList.remove('dragging')
          doc.body?.classList?.remove('settings-pointer-reordering')
          try {
            if (pointerId !== undefined && item.hasPointerCapture?.(pointerId)) {
              item.releasePointerCapture(pointerId)
            }
          } catch {}
        }
        const handlePointerMove = moveEvent => {
          if (pointerId !== undefined && moveEvent.pointerId !== undefined && moveEvent.pointerId !== pointerId) return
          const distance = Math.hypot((Number(moveEvent.clientX) || 0) - startX, (Number(moveEvent.clientY) || 0) - startY)
          if (!moved && distance < 5) return
          moved = true
          item.classList.add('dragging')
          doc.body?.classList?.add('settings-pointer-reordering')
          moveEvent.preventDefault()

          const hit = options.getTargetAtPoint
            ? options.getTargetAtPoint(moveEvent.clientX, moveEvent.clientY)
            : doc.elementFromPoint?.(moveEvent.clientX, moveEvent.clientY)
          const nextTarget = resolveItem(hit)
          if (!nextTarget || nextTarget === targetItem) return
          clearTarget()
          targetItem = nextTarget
          if (targetItem !== item) targetItem.classList.add('drag-over')
        }
        const finishPointerDrag = upEvent => {
          if (pointerId !== undefined && upEvent.pointerId !== undefined && upEvent.pointerId !== pointerId) return
          if (moved) upEvent.preventDefault()
          const finalTarget = targetItem
          cleanup()
          if (moved && finalTarget !== item) commit(item, finalTarget)
        }
        const cancelPointerDrag = cancelEvent => {
          if (pointerId !== undefined && cancelEvent.pointerId !== undefined && cancelEvent.pointerId !== pointerId) return
          cleanup()
        }

        event.preventDefault()
        item.classList.add('drag-armed')
        try { item.setPointerCapture?.(pointerId) } catch {}
        doc.addEventListener('pointermove', handlePointerMove, { passive: false })
        doc.addEventListener('pointerup', finishPointerDrag)
        doc.addEventListener('pointercancel', cancelPointerDrag)
      }, { passive: false })
    })
  }

  function getElements() {
    return {
      btnSettings: document.getElementById('btnSettings'),
      quickSettingsButton: document.getElementById('settingsQuickBtn'),
      settingsMenu: document.getElementById('sidebarSettingsMenu'),
      settingsMenuThemeToggle: document.getElementById('sidebarSettingsThemeToggle'),
      settingsMenuThemeOptions: document.getElementById('sidebarThemeOptions'),
      settingsMenuThemeButtons: document.querySelectorAll('[data-sidebar-theme]'),
      settingsMenuOpenButton: document.getElementById('sidebarSettingsOpenBtn'),
      panel: document.getElementById('settingsMainPanel'),
      backButton: document.getElementById('settingsMainBack'),
      tabs: document.querySelectorAll('.settings-main-tab'),
      modelName: document.getElementById('settingsModelName'),
      modelId: document.getElementById('settingsModelId'),
      apiUrl: document.getElementById('settingsApiUrl'),
      apiUrlFullMode: document.getElementById('settingsApiUrlFullMode'),
      apiKey: document.getElementById('settingsApiKey'),
      keyToggle: document.getElementById('settingsKeyToggle'),
      urlLockButton: document.getElementById('settingsUrlLockBtn'),
      keyLockButton: document.getElementById('settingsKeyLockBtn'),
      modelEditorModal: document.getElementById('settingsModelEditorModal'),
      modelEditorOverlay: document.getElementById('settingsModelEditorOverlay'),
      modelEditorClose: document.getElementById('settingsModelEditorClose'),
      openAddModelModalBtn: document.getElementById('settingsOpenAddModelModalBtn'),
      modelCancelButton: document.getElementById('settingsModelCancelBtn'),
      modelTestButton: document.getElementById('settingsModelTestBtn'),
      modelTestStatus: document.getElementById('settingsModelTestStatus'),
      modelPreviewBase: document.getElementById('settingsModelPreviewBase'),
      modelPreviewRoutes: document.getElementById('settingsModelPreviewRoutes'),
      addModelButton: document.getElementById('settingsAddModelBtn'),
      modelList: document.getElementById('settingsModelList'),
      routing: {
        nav: document.getElementById('settingsRoutingNav'),
        list: document.getElementById('settingsRoutingActiveList'),
        summary: document.getElementById('settingsRoutingSummary'),
        detailTitle: document.getElementById('settingsRoutingDetailTitle'),
        detailSub: document.getElementById('settingsRoutingDetailSub'),
        preview: document.getElementById('settingsRoutingPreview'),
        policyToggle: document.getElementById('settingsRoutingPolicyToggle'),
        policyHint: document.getElementById('settingsRoutingPolicyHint')
      },
      // 兼容旧隐藏策略输入；真正交互走右侧 toggle
      policyInputs: {
        imageGenerationConfirm: document.getElementById('settingsImageGenerationConfirm'),
        visionConfirm: document.getElementById('settingsVisionConfirm'),
        musicGenerationConfirm: document.getElementById('settingsMusicGenerationConfirm'),
        videoGenerationConfirm: document.getElementById('settingsVideoGenerationConfirm'),
        speechSynthesisConfirm: document.getElementById('settingsSpeechSynthesisConfirm')
      },
      localModels: {
        apiUrl: document.getElementById('localModelsApiUrl'),
        scanButton: document.getElementById('localModelsScanBtn'),
        refreshButton: document.getElementById('localModelsRefreshBtn'),
        list: document.getElementById('localModelsList'),
        status: document.getElementById('localModelsStatus')
      },
      ui: {
        contextCompressionStackVisible: document.getElementById('settingsContextCompressionStackVisible'),
        contextCompressionStackVisibleLegacy: document.getElementById('contextCompressionStackVisible'),
        aiMemoRailVisible: document.getElementById('settingsAiMemoRailVisible')
      },
      capabilities: {
        text: document.getElementById('settingsCapabilityText'),
        vision: document.getElementById('settingsCapabilityVision'),
        imageGeneration: document.getElementById('settingsCapabilityImageGeneration'),
        musicGeneration: document.getElementById('settingsCapabilityMusicGeneration'),
        videoGeneration: document.getElementById('settingsCapabilityVideoGeneration'),
        speechSynthesis: document.getElementById('settingsCapabilitySpeechSynthesis'),
        toolCalling: document.getElementById('settingsCapabilityToolCalling')
      }
    }
  }

  function bind(options = {}) {
    const showToast = options.showToast || function () {}
    const getModels = options.getModels || function () { return [] }
    const modelStore = options.modelStore
    const syncModelState = options.syncModelState || function () {}
    const saveModelsToStorage = options.saveModelsToStorage || function () {}
    const renderModelSelect = options.renderModelSelect || function () {}
    const useModel = options.useModel || function () {}
    const loadSettingsPaths = options.loadSettingsPaths || async function () {}
    const loadWorkerModelSettings = options.loadWorkerModelSettings || async function () {}
    const loadAIPermissionSettings = options.loadAIPermissionSettings || async function () {}
    const getEditingIndex = options.getEditingIndex || function () { return -1 }
    const setEditingIndex = options.setEditingIndex || function () {}
    const els = getElements()
    let urlLocked = false
    let keyLocked = false
    let scannedLocalModels = []
    let activeSettingsModelCategory = 'all'
    let activeRoutingCapability = 'vision'
    const routingCapabilityDefs = [
      { key: 'vision', label: '视觉理解', policyKey: 'visionConfirm', icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>', iconColor: '#3b82f6' },
      { key: 'imageGeneration', label: '文生图 / 图生图', policyKey: 'imageGenerationConfirm', icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.5-3.5a2 2 0 0 0-2.8 0L6 21"/></svg>', iconColor: '#10b981' },
      { key: 'musicGeneration', label: '音乐生成', policyKey: 'musicGenerationConfirm', icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>', iconColor: '#8b5cf6' },
      { key: 'videoGeneration', label: '视频生成', policyKey: 'videoGenerationConfirm', icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="6" width="14" height="12" rx="2"/><path d="m22 8-6 4 6 4V8Z"/></svg>', iconColor: '#f59e0b' },
      { key: 'speechSynthesis', label: '语音合成', policyKey: 'speechSynthesisConfirm', icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="22"/></svg>', iconColor: '#06b6d4' }
    ]
    const routingCapabilityMap = Object.fromEntries(routingCapabilityDefs.map(item => [item.key, item]))
    const contextCompressionStackVisibleKey = 'lingxiContextCompressionStackVisible'
    const contextCompressionStackVisibleLegacyKeys = [
      'contextCompressionStackVisible',
      'contextMemoryStackVisible',
      'showContextCompressionStack',
      'showContextMemoryStack',
      'lingxiContextMemoryStackVisible'
    ]
    const aiMemoRailVisibleKey = 'lingxiAiMemoRailVisible'

    const escapeHtml = HtmlUtils.escapeHtml

    function getSafeModelMeta(model, options = {}) {
      const labels = modelStore?.getCapabilityLabels?.(model) || []
      const modelId = model?.modelId && model.modelId !== model.modelName ? model.modelId : ''
      const source = '自定义模型'
      const parts = [modelId, source]
      if (options.includeCapabilities !== false && labels.length) parts.push(labels.join(' / '))
      return parts.filter(Boolean).join(' · ')
    }

    function getModelIconHtml(model, className = '') {
      return window.ModelBrandIcons?.getIconHtml?.(model, className) || ''
    }

    function getCapabilityHtml(model) {
      const labels = modelStore?.getCapabilityLabels?.(model) || []
      if (labels.length === 0) return ''
      return `<div class="model-capability-badges">${labels.map(label => `<span class="model-capability-badge">${escapeHtml(label)}</span>`).join('')}</div>`
    }

    function isOllamaModel(model) {
      return model?.provider === 'ollama' || model?.apiType === 'ollama' || /127\.0\.0\.1:11434|localhost:11434/i.test(String(model?.apiUrl || ''))
    }

    function getLocalModelIndex(name, apiUrl = '') {
      const targetName = String(name || '').trim()
      const targetUrl = String(apiUrl || '').replace(/\/+$/, '')
      return getModels().findIndex(model => {
        const modelName = String(model.modelId || model.modelName || '').trim()
        const modelUrl = String(model.apiUrl || '').replace(/\/+$/, '')
        return isOllamaModel(model) && modelName === targetName && (!targetUrl || modelUrl === targetUrl)
      })
    }

    const formatBytes = FormatUtils.formatBytes

    function setLocalModelsStatus(text, type = '') {
      if (!els.localModels?.status) return
      const content = String(text || '').trim()
      els.localModels.status.textContent = content
      els.localModels.status.className = content ? `worker-model-status ${type}`.trim() : 'worker-model-status'
      els.localModels.status.hidden = !content
    }

    function parseSettingBoolean(value) {
      if (value == null || value === '') return null
      if (typeof value === 'boolean') return value
      const text = String(value).trim().toLowerCase()
      if (['false', '0', 'off', 'no', 'hidden', 'hide', 'disabled'].includes(text)) return false
      if (['true', '1', 'on', 'yes', 'visible', 'show', 'enabled'].includes(text)) return true
      return null
    }

    function getContextCompressionStackVisible() {
      try {
        const ownValue = parseSettingBoolean(localStorage.getItem(contextCompressionStackVisibleKey))
        if (ownValue != null) return ownValue
        for (const key of contextCompressionStackVisibleLegacyKeys) {
          const legacyValue = parseSettingBoolean(localStorage.getItem(key))
          if (legacyValue != null) return legacyValue
        }
      } catch {
      }
      return true
    }

    function getContextCompressionStackVisibleInputs() {
      return [
        els.ui?.contextCompressionStackVisible,
        els.ui?.contextCompressionStackVisibleLegacy
      ].filter(Boolean)
    }

    function setContextCompressionStackVisible(enabled) {
      try {
        localStorage.setItem(contextCompressionStackVisibleKey, enabled ? 'true' : 'false')
        localStorage.setItem('contextCompressionStackVisible', enabled ? 'true' : 'false')
      } catch {}
      getContextCompressionStackVisibleInputs().forEach(input => { input.checked = !!enabled })
      window.ContextCompressionStack?.setVisible?.(enabled)
    }

    function getAiMemoRailVisible() {
      try {
        const ownValue = parseSettingBoolean(localStorage.getItem(aiMemoRailVisibleKey))
        if (ownValue != null) return ownValue
      } catch {}
      return true
    }

    function setAiMemoRailVisible(enabled) {
      try {
        localStorage.setItem(aiMemoRailVisibleKey, enabled ? 'true' : 'false')
      } catch {}
      if (els.ui?.aiMemoRailVisible) els.ui.aiMemoRailVisible.checked = !!enabled
      window.AiMemoChatRail?.setVisible?.(enabled)
    }

    function syncUiDisplaySettings() {
      const enabled = getContextCompressionStackVisible()
      getContextCompressionStackVisibleInputs().forEach(input => { input.checked = enabled })
      if (els.ui?.aiMemoRailVisible) els.ui.aiMemoRailVisible.checked = getAiMemoRailVisible()
    }

    function renderLocalModelsList() {
      const list = els.localModels?.list
      if (!list) return
      const apiUrl = els.localModels?.apiUrl?.value?.trim() || 'http://127.0.0.1:11434'
      if (!scannedLocalModels.length) {
        list.innerHTML = '<div class="settings-empty">点击“扫描本地模型”后显示</div>'
        return
      }
      list.innerHTML = scannedLocalModels.map(item => {
        const name = item.name || item.model || ''
        const index = getLocalModelIndex(name, apiUrl)
        const enabled = index >= 0
        const meta = [formatBytes(item.size), item.modifiedAt ? String(item.modifiedAt).slice(0, 19).replace('T', ' ') : ''].filter(Boolean).join(' · ')
        return `
          <div class="local-model-item" data-model="${escapeHtml(name)}">
            <div class="local-model-info">
              <div class="local-model-name">${escapeHtml(name)}</div>
              <div class="local-model-meta">${escapeHtml(meta || 'Ollama local model')}</div>
            </div>
            <div class="local-model-actions">
              <button class="settings-path-btn ${enabled ? 'reset' : ''}" type="button" data-local-model-action="${enabled ? 'remove' : 'enable'}" data-model="${escapeHtml(name)}">${enabled ? '从软件移除' : '启用'}</button>
            </div>
          </div>
        `
      }).join('')
    }

    async function scanLocalModels() {
      if (!window.api?.scanLocalModels) {
        setLocalModelsStatus('当前版本不支持扫描本地模型', 'error')
        return
      }
      const apiUrl = els.localModels?.apiUrl?.value?.trim() || 'http://127.0.0.1:11434'
      setLocalModelsStatus('正在扫描 Ollama 本地模型...', 'loading')
      const result = await window.api.scanLocalModels({ apiUrl })
      if (!result?.success) {
        scannedLocalModels = []
        renderLocalModelsList()
        setLocalModelsStatus(result?.error || '扫描失败，请确认 Ollama 正在运行', 'error')
        return
      }
      scannedLocalModels = Array.isArray(result.models) ? result.models : []
      renderLocalModelsList()
      setLocalModelsStatus(scannedLocalModels.length ? `发现 ${scannedLocalModels.length} 个本地模型` : '没有发现本地模型', scannedLocalModels.length ? 'success' : '')
    }

    function enableLocalModel(name) {
      if (!modelStore || !name) return
      const apiUrl = els.localModels?.apiUrl?.value?.trim() || 'http://127.0.0.1:11434'
      const existingIndex = getLocalModelIndex(name, apiUrl)
      if (existingIndex >= 0) {
        useModel(existingIndex)
        showToast('本地模型已启用', 'success')
        return
      }
      modelStore.addModel({
        provider: 'ollama',
        apiType: 'ollama',
        modelName: name,
        modelId: name,
        apiUrl,
        apiKey: 'ollama-local',
        capabilities: {
          text: true,
          vision: false,
          imageGeneration: false,
          musicGeneration: false,
          videoGeneration: false,
          speechSynthesis: false,
          toolCalling: true
        }
      })
      syncModelState()
      saveModelsToStorage()
      renderSettingsModelList()
      renderCapabilityRouting()
      renderModelSelect()
      renderLocalModelsList()
      showToast('本地模型已加入模型列表', 'success')
    }

    function removeLocalModel(name) {
      if (!modelStore || !name) return
      const apiUrl = els.localModels?.apiUrl?.value?.trim() || 'http://127.0.0.1:11434'
      const index = getLocalModelIndex(name, apiUrl)
      if (index < 0) return
      modelStore.removeModel(index)
      syncModelState()
      saveModelsToStorage()
      renderSettingsModelList()
      renderCapabilityRouting()
      renderModelSelect()
      renderLocalModelsList()
      showToast('已从软件模型列表移除，本机模型文件未删除', 'success')
    }

    function ensureModelSettingsSubnav() {
      const modelContent = document.getElementById('settingsContentModel')
      if (!modelContent || document.getElementById('settingsModelSubnavLayout')) return
      const routingContent = document.getElementById('settingsContentRouting')
      const workerContent = document.getElementById('settingsContentWorker')
      const localContent = document.getElementById('settingsContentLocalModels')
      const cloudTokenContent = document.getElementById('settingsContentCloudTokenUsage')
      const originalChildren = Array.from(modelContent.childNodes)
      const layout = document.createElement('div')
      layout.id = 'settingsModelSubnavLayout'
      layout.className = 'settings-model-subnav-layout'
      layout.innerHTML = `
        <div class="settings-model-subnav">
          <button class="settings-model-subtab active" type="button" data-model-subtab="model">
            <span class="settings-model-subtab-title">模型增加</span>
            <span class="settings-model-subtab-desc">接入、能力标注</span>
          </button>
          <button class="settings-model-subtab" type="button" data-model-subtab="routing">
            <span class="settings-model-subtab-title">模型能力调度</span>
            <span class="settings-model-subtab-desc">按能力配置优先级</span>
          </button>
          <button class="settings-model-subtab" type="button" data-model-subtab="worker">
            <span class="settings-model-subtab-title">后台整理模型</span>
            <span class="settings-model-subtab-desc">记忆、账本、路线整理</span>
          </button>
          <button class="settings-model-subtab" type="button" data-model-subtab="localModels">
            <span class="settings-model-subtab-title">本地模型</span>
            <span class="settings-model-subtab-desc">Ollama 扫描与启用</span>
          </button>
        </div>
        <div class="settings-model-subcontent" data-model-subcontent="model"></div>
      `
      modelContent.appendChild(layout)
      const primaryPane = layout.querySelector('[data-model-subcontent="model"]')
      originalChildren.forEach(node => primaryPane.appendChild(node))
      ;[
        { key: 'routing', node: routingContent },
        { key: 'worker', node: workerContent },
        { key: 'localModels', node: localContent }
      ].forEach(item => {
        if (!item.node) return
        item.node.classList.remove('settings-main-content')
        item.node.classList.remove('active')
        item.node.classList.add('settings-model-subcontent')
        item.node.dataset.modelSubcontent = item.key
        layout.appendChild(item.node)
      })
      layout.querySelectorAll('.settings-model-subtab').forEach(button => {
        button.onclick = () => showModelSettingsSubtab(button.dataset.modelSubtab || 'model')
      })
      showModelSettingsSubtab('model')
    }

    function showModelSettingsSubtab(key = 'model') {
      const layout = document.getElementById('settingsModelSubnavLayout')
      if (!layout) return
      layout.querySelectorAll('.settings-model-subtab').forEach(button => {
        button.classList.toggle('active', button.dataset.modelSubtab === key)
      })
      layout.querySelectorAll('.settings-model-subcontent').forEach(content => {
        content.classList.toggle('active', content.dataset.modelSubcontent === key)
      })
      if (key === 'routing') renderCapabilityRouting()
      if (key === 'localModels') renderLocalModelsList()
    }

    function readCapabilities() {
      const caps = els.capabilities || {}
      const capabilities = {
        text: !!caps.text?.checked,
        vision: !!caps.vision?.checked,
        imageGeneration: !!caps.imageGeneration?.checked,
        musicGeneration: !!caps.musicGeneration?.checked,
        videoGeneration: !!caps.videoGeneration?.checked,
        speechSynthesis: !!caps.speechSynthesis?.checked,
        toolCalling: !!caps.toolCalling?.checked
      }
      return capabilities
    }

    function writeCapabilities(modelOrCapabilities = null) {
      const caps = modelStore?.normalizeCapabilities?.(modelOrCapabilities?.capabilities || modelOrCapabilities) || {}
      Object.entries(els.capabilities || {}).forEach(([key, input]) => {
        if (input) input.checked = !!caps[key]
      })
    }

    function setModelTestStatus(message = '', type = '') {
      if (!els.modelTestStatus) return
      els.modelTestStatus.textContent = String(message || '')
      els.modelTestStatus.classList.toggle('success', type === 'success')
      els.modelTestStatus.classList.toggle('error', type === 'error')
    }

    function getModelConnectionPreview() {
      const rawUrl = String(els.apiUrl?.value || '').trim()
      const modelId = String(els.modelId?.value || '').trim().toLowerCase()
      const baseUrl = rawUrl || 'https://api.openai.com/v1'
      if (els.apiUrlFullMode?.checked) return { baseUrl, routes: ['使用完整 URL'] }
      const providerText = `${baseUrl} ${modelId}`.toLowerCase()
      if (/anthropic|claude/.test(providerText)) return { baseUrl, routes: ['/messages'] }
      if (/generativelanguage\.googleapis\.com|gemini/.test(providerText)) return { baseUrl, routes: ['/models/{model}:generateContent'] }
      if (/\/responses(?:\?|$)|(^|[^a-z])(?:gpt-5|o[1-9])/.test(providerText)) return { baseUrl, routes: ['/responses'] }
      return { baseUrl, routes: ['/chat/completions', '/responses', '/messages'] }
    }

    function updateModelConnectionPreview() {
      const preview = getModelConnectionPreview()
      if (els.modelPreviewBase) els.modelPreviewBase.textContent = preview.baseUrl
      if (els.modelPreviewRoutes) {
        els.modelPreviewRoutes.replaceChildren(...preview.routes.map(route => {
          const code = document.createElement('code')
          code.textContent = route
          return code
        }))
      }
    }

    function resetForm() {
      setEditingIndex(-1)
      urlLocked = false
      keyLocked = false
      if (els.urlLockButton) {
        els.urlLockButton.classList.remove('locked')
        els.urlLockButton.setAttribute('aria-pressed', 'false')
      }
      if (els.keyLockButton) {
        els.keyLockButton.classList.remove('locked')
        els.keyLockButton.setAttribute('aria-pressed', 'false')
      }
      if (els.modelName) els.modelName.value = ''
      if (els.modelId) els.modelId.value = ''
      if (els.apiUrl) els.apiUrl.value = ''
      if (els.apiUrlFullMode) els.apiUrlFullMode.checked = false
      if (els.apiKey) {
        els.apiKey.value = ''
        window.SettingsPanelUI?.setApiKeyRealValue?.(els.apiKey, '')
      }
      writeCapabilities()
      setModelTestStatus()
      updateModelConnectionPreview()
      if (els.addModelButton) els.addModelButton.textContent = ((window.i18n?.t?.('auto.js_settings_main_94_0') ?? ((window.i18n?.t?.('auto.js_settings_main_94_1') ?? '添加模型'))))
    }

    function getModelVendor(model) {
      if (isOllamaModel(model)) return 'Ollama'
      const detected = window.ModelBrandIcons?.detect?.(model)
      if (detected?.label) return detected.label
      const url = String(model?.apiUrl || '')
      try {
        const host = new URL(url).hostname.toLowerCase()
        if (host) return host.replace(/^api\./, '').split('.')[0]
      } catch {}
      return '其他'
    }

    function renderSettingsModelList() {
      if (!els.modelList) return
      const savedModels = getModels()
      const categoryTabsEl = document.getElementById('settingsModelCategoryTabs')

      // 构建厂商分类
      const vendorMap = new Map()
      savedModels.forEach(model => {
        const vendor = getModelVendor(model)
        if (!vendorMap.has(vendor)) vendorMap.set(vendor, 0)
        vendorMap.set(vendor, vendorMap.get(vendor) + 1)
      })

      const categoryDefs = [{ key: 'all', label: '全部', count: savedModels.length, filter: () => true }]
      // 按出现顺序排列厂商分类
      vendorMap.forEach((count, vendor) => {
        categoryDefs.push({
          key: `vendor:${vendor}`,
          label: vendor,
          count,
          filter: m => getModelVendor(m) === vendor
        })
      })

      // 确保当前分类有效
      const activeCat = categoryDefs.find(d => d.key === activeSettingsModelCategory)
      if (!activeCat || (activeSettingsModelCategory !== 'all' && activeCat.count === 0)) {
        activeSettingsModelCategory = 'all'
      }

      // 渲染分类标签
      if (categoryTabsEl && savedModels.length > 0) {
        categoryTabsEl.innerHTML = categoryDefs.map(def =>
          `<span class="model-category-tab${def.key === activeSettingsModelCategory ? ' active' : ''}" data-cat="${def.key}">${escapeHtml(def.label)}<span class="cat-count">${def.count}</span></span>`
        ).join('')
        categoryTabsEl.querySelectorAll('.model-category-tab').forEach(tab => {
          tab.onclick = () => {
            activeSettingsModelCategory = tab.dataset.cat
            renderSettingsModelList()
          }
        })
      } else if (categoryTabsEl) {
        categoryTabsEl.innerHTML = ''
      }

      // 按当前分类过滤
      const activeFilter = categoryDefs.find(d => d.key === activeSettingsModelCategory)?.filter || (() => true)
      const filteredModels = savedModels
        .map((model, index) => ({ model, index }))
        .filter(({ model }) => activeFilter(model))

      if (savedModels.length === 0) {
        els.modelList.innerHTML = '<div class="settings-empty">暂无已储存的模型</div>'
        return
      }
      if (filteredModels.length === 0) {
        els.modelList.innerHTML = '<div class="settings-empty">该分类下暂无模型</div>'
        return
      }

      els.modelList.innerHTML = filteredModels.map(({ model, index }, displayIdx) => `
        <div class="settings-model-item" data-index="${index}" data-display-idx="${displayIdx}">
          <span class="settings-model-handle" title="拖拽排序">
            <span></span><span></span><span></span>
          </span>
          ${getModelIconHtml(model, 'settings-model-icon')}
          <div class="settings-model-info">
            <div class="settings-model-name">${escapeHtml(model.modelName || '未命名模型')}</div>
            <div class="settings-model-url">${escapeHtml(getSafeModelMeta(model))}</div>
            ${getCapabilityHtml(model)}
          </div>
          <div class="settings-model-actions">
            <span class="settings-model-btn use" data-action="use" data-index="${index}">使用</span>
            <span class="settings-model-btn edit" data-action="edit" data-index="${index}">编辑</span>
            <span class="settings-model-btn delete" data-action="delete" data-index="${index}">删除</span>
          </div>
        </div>
      `).join('')

      els.modelList.querySelectorAll('.settings-model-btn').forEach(button => {
        button.onclick = () => {
          const index = parseInt(button.dataset.index, 10)
          if (button.dataset.action === 'use') useModelFromSettings(index)
          if (button.dataset.action === 'edit') editModelFromSettings(index)
          if (button.dataset.action === 'delete') deleteModelFromSettings(index)
        }
      })
      setupSettingsModelDragSort()
      // 滚动入场动画：IntersectionObserver 监听卡片进入视口
      setupModelScrollAnimation()
    }

    function getRoutingCapabilityDef(key = activeRoutingCapability) {
      return routingCapabilityMap[key] || routingCapabilityDefs[0]
    }

    function isPolicyDirect(policyKey, policies) {
      return (policies?.[policyKey] || 'never') !== 'always'
    }

    function getCapabilityModelName(model) {
      return model?.modelName || model?.modelId || ((window.i18n?.t?.('auto.js_settings_main_146_5') ?? '未命名模型'))
    }

    function buildRoutingPreviewText(def, routedModels, policies) {
      const direct = isPolicyDirect(def.policyKey, policies)
      const modeText = direct ? '直接调用' : '调用前询问'
      if (!routedModels.length) {
        return `${def.label}：暂无可调度模型 · ${modeText}`
      }
      const primary = getCapabilityModelName(routedModels[0])
      const fallback = routedModels[1] ? getCapabilityModelName(routedModels[1]) : ''
      if (fallback) {
        return `${def.label}：优先 ${primary} · 失败后 ${fallback} · ${modeText}`
      }
      return `${def.label}：优先 ${primary} · ${modeText}`
    }

    function renderRoutingSummary(policies) {
      const summaryEl = els.routing?.summary
      if (!summaryEl) return
      let totalModels = 0
      let directCount = 0
      let askCount = 0
      routingCapabilityDefs.forEach(def => {
        const count = (modelStore.getRoutedModelsForCapability?.(def.key) || []).length
        totalModels += count
        if (isPolicyDirect(def.policyKey, policies)) directCount += 1
        else askCount += 1
      })
      summaryEl.innerHTML = `
        <span class="settings-routing-pill">可调度 ${totalModels}</span>
        <span class="settings-routing-pill is-success">免确认 ${directCount}</span>
        <span class="settings-routing-pill is-warn">待确认 ${askCount}</span>
      `
    }

    function renderRoutingNav(policies) {
      const nav = els.routing?.nav
      if (!nav) return
      if (!routingCapabilityMap[activeRoutingCapability]) {
        activeRoutingCapability = routingCapabilityDefs[0].key
      }
      nav.innerHTML = routingCapabilityDefs.map(def => {
        const routedModels = modelStore.getRoutedModelsForCapability?.(def.key) || []
        const count = routedModels.length
        const direct = isPolicyDirect(def.policyKey, policies)
        const primaryName = routedModels[0] ? getCapabilityModelName(routedModels[0]) : '未配置'
        return `
          <button type="button" class="settings-routing-nav-item${def.key === activeRoutingCapability ? ' active' : ''}" data-capability="${def.key}">
            <span class="settings-routing-nav-icon" style="color: ${def.iconColor || 'var(--accent-primary)'}">${def.icon || ''}</span>
            <span class="settings-routing-nav-content">
              <span class="settings-routing-nav-top">
                <span class="settings-routing-nav-name">${escapeHtml(def.label)}</span>
                <span class="settings-routing-nav-count">${count}</span>
              </span>
              <span class="settings-routing-nav-bottom">
                <span class="settings-routing-status-dot ${direct ? 'is-direct' : 'is-ask'}" aria-hidden="true"></span>
                <span class="settings-routing-nav-meta">${escapeHtml(primaryName)}</span>
                <span class="settings-routing-nav-mode">${direct ? '免确认' : '询问'}</span>
              </span>
            </span>
          </button>
        `
      }).join('')

      nav.querySelectorAll('[data-capability]').forEach(button => {
        button.onclick = () => {
          activeRoutingCapability = button.dataset.capability || 'vision'
          renderCapabilityRouting()
        }
      })
    }
    function renderActiveRoutingList(capabilityKey, routedModels) {
      const list = els.routing?.list
      if (!list) return
      if (!routedModels.length) {
        list.innerHTML = `
          <div class="settings-empty settings-routing-empty">
            <div class="settings-routing-empty-title">暂无可调度模型</div>
            <div class="settings-routing-empty-desc">请先到模型设置勾选该能力，模型才会出现在这里。</div>
            <button type="button" class="settings-routing-empty-btn" data-action="goto-models">去模型设置</button>
          </div>
        `
        const gotoBtn = list.querySelector('[data-action="goto-models"]')
        if (gotoBtn) {
          gotoBtn.onclick = () => showModelSettingsSubtab('model')
        }
        return
      }

      list.innerHTML = routedModels.map((model, index) => `
        <div class="settings-routing-item" data-capability="${capabilityKey}" data-index="${index}">
          <span class="settings-routing-handle" title="拖拽排序">
            <span></span><span></span><span></span>
          </span>
          <span class="settings-routing-rank${index === 0 ? ' is-primary' : ''}">#${index + 1}</span>
          ${getModelIconHtml(model, 'settings-routing-icon')}
          <div class="settings-routing-info">
            <div class="settings-routing-name-row">
              <div class="settings-routing-name">${escapeHtml(getCapabilityModelName(model))}</div>
              ${index === 0 ? '<span class="settings-routing-badge">优先</span>' : ''}
            </div>
            <div class="settings-routing-meta">${escapeHtml(getSafeModelMeta(model, { includeCapabilities: false }))}</div>
          </div>
        </div>
      `).join('')
      setupCapabilityRoutingDragSort(capabilityKey, list)
    }

    function renderCapabilityRouting() {
      if (!modelStore) return
      const policies = modelStore.getCapabilityPolicies?.() || {}
      renderCapabilityPolicies(policies)

      const def = getRoutingCapabilityDef(activeRoutingCapability)
      const routedModels = modelStore.getRoutedModelsForCapability?.(def.key) || []
      const direct = isPolicyDirect(def.policyKey, policies)

      if (els.routing?.detailTitle) els.routing.detailTitle.textContent = def.label
      if (els.routing?.detailSub) {
        els.routing.detailSub.textContent = routedModels.length
          ? `共 ${routedModels.length} 个可调度模型 · 拖到最上方优先调用`
          : '当前能力下暂无模型，请先在模型设置勾选能力'
      }
      if (els.routing?.policyToggle) {
        els.routing.policyToggle.checked = direct
      }
      if (els.routing?.policyHint) {
        els.routing.policyHint.textContent = direct ? '免确认，直接调用' : '每次调用前询问'
      }
      if (els.routing?.preview) {
        els.routing.preview.textContent = buildRoutingPreviewText(def, routedModels, policies)
      }

      renderRoutingSummary(policies)
      renderRoutingNav(policies)
      renderActiveRoutingList(def.key, routedModels)
    }

    function renderCapabilityPolicies(policiesArg) {
      if (!modelStore) return
      const policies = policiesArg || modelStore.getCapabilityPolicies?.() || {}
      Object.keys(els.policyInputs || {}).forEach(key => {
        if (els.policyInputs?.[key]) {
          els.policyInputs[key].checked = policies[key] !== 'always'
        }
      })
    }

    function saveCapabilityPolicies() {
      if (!modelStore) return
      // 优先读取右侧当前能力 toggle，再与隐藏兼容输入合并
      const next = {
        imageGenerationConfirm: els.policyInputs?.imageGenerationConfirm?.checked ? 'never' : 'always',
        visionConfirm: els.policyInputs?.visionConfirm?.checked ? 'never' : 'always',
        musicGenerationConfirm: els.policyInputs?.musicGenerationConfirm?.checked ? 'never' : 'always',
        videoGenerationConfirm: els.policyInputs?.videoGenerationConfirm?.checked ? 'never' : 'always',
        speechSynthesisConfirm: els.policyInputs?.speechSynthesisConfirm?.checked ? 'never' : 'always'
      }
      const def = getRoutingCapabilityDef(activeRoutingCapability)
      if (els.routing?.policyToggle && def?.policyKey) {
        next[def.policyKey] = els.routing.policyToggle.checked ? 'never' : 'always'
        if (els.policyInputs?.[def.policyKey]) {
          els.policyInputs[def.policyKey].checked = !!els.routing.policyToggle.checked
        }
      }
      modelStore.setCapabilityPolicies?.(next)
      saveModelsToStorage()
    }

    function setupCapabilityRoutingDragSort(capabilityKey, list) {
      bindPointerReorder({
        list,
        itemSelector: '.settings-routing-item',
        handleSelector: '.settings-routing-handle',
        getIndex: item => parseInt(item.dataset.index, 10),
        onMove: (fromIndex, toIndex) => {
          if (!modelStore.moveCapabilityModel?.(capabilityKey, fromIndex, toIndex)) return
          saveModelsToStorage()
          renderCapabilityRouting()
          showToast('调度优先级已更新', 'success')
        }
      })
    }

    function setupSettingsModelDragSort() {
      if (!els.modelList) return
      bindPointerReorder({
        list: els.modelList,
        itemSelector: '.settings-model-item',
        handleSelector: '.settings-model-handle',
        getIndex: item => parseInt(item.dataset.index, 10),
        onMove: (fromIndex, toIndex) => {
          if (!modelStore?.moveModel(fromIndex, toIndex)) return
          syncModelState()
          saveModelsToStorage()
          renderSettingsModelList()
          renderCapabilityRouting()
          renderModelSelect()
          showToast('模型顺序已更新', 'success')
        }
      })
    }
    let modelScrollObserver = null

    function setupModelScrollAnimation() {
      if (modelScrollObserver) {
        modelScrollObserver.disconnect()
      }
      const scrollContainer = document.querySelector('.settings-main-body')
      if (!scrollContainer) return

      modelScrollObserver = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
          if (entry.isIntersecting) {
            const item = entry.target
            if (!item.classList.contains('piano-entering')) {
              item.classList.add('piano-entering')
            }
          }
        })
      }, {
        root: scrollContainer,
        rootMargin: '0px 0px -30px 0px',
        threshold: 0.1
      })

      scrollContainer.querySelectorAll('.settings-model-item').forEach(item => {
        modelScrollObserver.observe(item)
      })
    }

    function useModelFromSettings(index) {
      useModel(index)
      showToast(((window.i18n?.t?.('auto.js_settings_main_261_2') ?? ((window.i18n?.t?.('auto.js_settings_main_261_7') ?? '已切换模型')))), 'success')
    }

    function editModelFromSettings(index) {
      const model = getModels()[index]
      if (!model) return
      setEditingIndex(index)
      if (els.modelName) els.modelName.value = model.modelName || ''
      if (els.modelId) els.modelId.value = model.modelId || ''
      if (els.apiUrl) els.apiUrl.value = model.apiUrl || ''
      if (els.apiUrlFullMode) els.apiUrlFullMode.checked = model.useFullUrl === true || model.fullUrl === true || model.apiUrlMode === 'full'
      if (els.apiKey) {
        const keyValue = model.apiKey || ''
        els.apiKey.value = keyValue
        window.SettingsPanelUI?.setApiKeyRealValue?.(els.apiKey, keyValue)
        window.SettingsPanelUI?.setApiKeyMasked?.(els.apiKey, true)
        if (window.SettingsPanelUI?.isMaskOnlyKey?.(keyValue)) {
          window.showToast?.('该模型保存的 Key 已是圆点掩码，请重新粘贴真 Key', 'error')
        }
      }
      writeCapabilities(model)
      setModelTestStatus()
      updateModelConnectionPreview()
      if (els.addModelButton) els.addModelButton.textContent = ((window.i18n?.t?.('auto.js_settings_main_273_3') ?? ((window.i18n?.t?.('auto.js_settings_main_273_8') ?? '保存修改'))))
      openModelEditorModal()
      showToast(((window.i18n?.t?.('auto.js_settings_main_274_4') ?? ((window.i18n?.t?.('auto.js_settings_main_274_9') ?? '已加载模型信息，修改后点击保存')))), 'info')
    }

    function deleteModelFromSettings(index) {
      if (!confirm(((window.i18n?.t?.('auto.js_settings_main_278_10') ?? '确定要删除此模型吗？')))) return
      if (!modelStore) return
      modelStore.removeModel(index)
      syncModelState()
      saveModelsToStorage()
      renderSettingsModelList()
      renderCapabilityRouting()
      renderModelSelect()
      showToast(((window.i18n?.t?.('auto.js_settings_main_286_5') ?? ((window.i18n?.t?.('auto.js_settings_main_286_11') ?? '模型已删除')))), 'success')
    }

    function closeSidebarMenus() {
      els.settingsMenu?.classList.remove('show')
      els.settingsMenu?.classList.remove('theme-open')
    }

    function openSettingsPanel() {
      // 只做一件事：打开全屏设置
      closeSidebarMenus()
      window.LingxiPanelManager?.openExclusive?.('settings')
      if (els.panel) els.panel.classList.add('show')
      closeModelEditorModal()
      resetForm()
      ensureModelSettingsSubnav()
      renderSettingsModelList()
      renderCapabilityRouting()
      loadSettingsPaths()
      loadWorkerModelSettings()
      loadAIPermissionSettings()
      syncUiDisplaySettings()
    }

    /* 侧栏底部提供设置入口与主题快捷菜单。 */
    function bindMenuAction(el, handler) {
      if (!el) return
      // 只用 pointerdown：菜单关闭后 click 容易丢；并加锁避免连点
      let locked = false
      el.addEventListener('pointerdown', event => {
        event.preventDefault()
        event.stopPropagation()
        if (locked) return
        locked = true
        Promise.resolve()
          .then(() => handler(event))
          .catch(err => console.error('[Settings] menu action failed:', err))
          .finally(() => { window.setTimeout(() => { locked = false }, 300) })
      }, true)
    }

    if (els.btnSettings) {
      els.btnSettings.addEventListener('click', event => {
        if (event.target?.closest?.('#settingsQuickBtn, #sidebarSettingsMenu')) return
        event.preventDefault()
        event.stopPropagation()
        openSettingsPanel()
      })
    }

    if (els.quickSettingsButton) {
      els.quickSettingsButton.addEventListener('click', async event => {
        event.preventDefault()
        event.stopPropagation()
        els.settingsMenu?.classList.toggle('show')
      })
    }

    if (els.settingsMenuThemeToggle) {
      els.settingsMenuThemeToggle.addEventListener('click', event => {
        event.preventDefault()
        event.stopPropagation()
        els.settingsMenu?.classList.toggle('theme-open')
      })
    }

    els.settingsMenuThemeButtons?.forEach(button => {
      button.addEventListener('click', event => {
        event.preventDefault()
        event.stopPropagation()
        const preset = button.dataset.sidebarTheme
        window.ThemeSettings?.applyPreset?.(preset)
        els.settingsMenuThemeButtons.forEach(item => item.classList.toggle('active', item === button))
      })
    })

    // 菜单「设置」→ 只打开设置
    bindMenuAction(els.settingsMenuOpenButton, () => {
      openSettingsPanel()
    })

    document.addEventListener('click', event => {
      const t = event.target
      // 快捷菜单：点外部关闭（菜单本身、齿轮不算外部）
      if (els.settingsMenu?.classList.contains('show')) {
        if (!els.settingsMenu.contains(t) && !els.quickSettingsButton?.contains(t)) {
          els.settingsMenu.classList.remove('show')
          els.settingsMenu.classList.remove('theme-open')
        }
      }
    })

    if (els.backButton) els.backButton.onclick = () => {
      if (els.panel) els.panel.classList.remove('show')
    }

    els.tabs.forEach(tab => {
      tab.onclick = () => {
        els.tabs.forEach(t => t.classList.remove('active'))
        tab.classList.add('active')
        const tabName = tab.dataset.tab
        document.querySelectorAll('.settings-main-content').forEach(c => c.classList.remove('active'))
        const contentId = 'settingsContent' + tabName.charAt(0).toUpperCase() + tabName.slice(1)
        const content = document.getElementById(contentId)
        if (content) {
          content.classList.add('active')
        } else {
          const fallback = document.getElementById('settingsContentOther')
          if (fallback) fallback.classList.add('active')
          console.warn(`[Settings] Missing content panel: ${contentId}`)
        }
        if (tabName === 'model') ensureModelSettingsSubnav()
        if (tabName === 'cloudTokenUsage') window.CloudTokenUsageSettings?.bind?.().load?.()
        if (tabName === 'permission') loadAIPermissionSettings()
        if (tabName === 'features') window.FeatureSettingsUI?.load?.()
      }
    })

    if (els.apiKey) {
      window.SettingsPanelUI?.bindApiKeyClipboard?.(els.apiKey)
    }

    if (els.keyToggle && els.apiKey) {
      let keyRevealed = false
      const setKeyRevealed = revealed => {
        keyRevealed = !!revealed
        // 始终 type=text + CSS 遮罩；禁止 password，避免系统复制圆点
        const currentValue = window.SettingsPanelUI?.getApiKeyRealValue?.(els.apiKey) ?? els.apiKey.value
        els.apiKey.value = currentValue
        window.SettingsPanelUI?.setApiKeyRealValue?.(els.apiKey, currentValue)
        window.SettingsPanelUI?.setApiKeyMasked?.(els.apiKey, !keyRevealed)
        els.keyToggle.classList.toggle('is-revealed', keyRevealed)
        els.keyToggle.setAttribute('aria-pressed', keyRevealed ? 'true' : 'false')
        els.keyToggle.setAttribute('aria-label', keyRevealed ? '隐藏 API Key' : '显示 API Key')
        els.keyToggle.title = keyRevealed ? '隐藏 API Key' : '显示 API Key'
        if (keyRevealed && window.SettingsPanelUI?.isMaskOnlyKey?.(currentValue)) {
          window.showToast?.('当前 Key 已是圆点掩码，请重新粘贴真 Key 后保存', 'error')
        }
      }
      // 防止点击眼睛时 input 失焦，避免 focusout 立刻又盖回遮罩
      els.keyToggle.addEventListener('mousedown', event => {
        event.preventDefault()
      })
      els.keyToggle.onclick = event => {
        event.preventDefault()
        event.stopPropagation()
        setKeyRevealed(!keyRevealed)
      }
      // 明文态不要 focusout 自动回掩：全选/复制时会抢焦点，导致刚显示就又变圆点
    }

    function openModelEditorModal(mode = 'open') {
      if (!els.modelEditorModal) return
      if (mode === 'add') resetForm()
      els.modelEditorModal.classList.add('show')
      els.modelEditorModal.setAttribute('aria-hidden', 'false')
      updateModelConnectionPreview()
      if (els.modelName) els.modelName.focus()
    }

    function closeModelEditorModal() {
      if (!els.modelEditorModal) return
      els.modelEditorModal.classList.remove('show')
      els.modelEditorModal.setAttribute('aria-hidden', 'true')
    }

    if (els.openAddModelModalBtn) {
      els.openAddModelModalBtn.onclick = () => {
        resetForm()
        openModelEditorModal()
      }
    }
    if (els.modelEditorClose) els.modelEditorClose.onclick = closeModelEditorModal
    if (els.modelEditorOverlay) els.modelEditorOverlay.onclick = closeModelEditorModal
    if (els.modelCancelButton) els.modelCancelButton.onclick = closeModelEditorModal

    ;[els.apiUrl, els.modelId].forEach(input => {
      if (!input) return
      input.addEventListener('input', () => {
        setModelTestStatus()
        updateModelConnectionPreview()
      })
    })
    if (els.apiUrlFullMode) {
      els.apiUrlFullMode.addEventListener('change', () => {
        setModelTestStatus()
        updateModelConnectionPreview()
      })
    }
    if (els.apiKey) els.apiKey.addEventListener('input', () => setModelTestStatus())

    if (els.modelTestButton) els.modelTestButton.onclick = async () => {
      const modelId = String(els.modelId?.value || '').trim()
      const apiUrl = String(els.apiUrl?.value || '').trim()
      const apiKeyRaw = window.SettingsPanelUI?.getApiKeyRealValue?.(els.apiKey) ?? els.apiKey?.value
      const apiKey = window.SettingsPanelUI?.sanitizeApiKeyText?.(apiKeyRaw) ?? String(apiKeyRaw || '').trim()
      if (!modelId || !apiUrl || !apiKey) {
        setModelTestStatus('请先填写模型 ID、API URL 和 API Key。', 'error')
        showToast('请先填写完整的连接信息', 'error')
        return
      }
      if (window.SettingsPanelUI?.isMaskOnlyKey?.(apiKey)) {
        setModelTestStatus('当前 API Key 仅为掩码，请重新粘贴真实 Key。', 'error')
        showToast('请重新粘贴真实 API Key', 'error')
        return
      }
      if (typeof window.api?.testModelConnection !== 'function') {
        setModelTestStatus('连接测试服务尚未加载，请重启应用后再试。', 'error')
        showToast('连接测试服务尚未加载，请重启应用', 'error')
        return
      }
      const label = els.modelTestButton.querySelector('span')
      const previousText = label?.textContent || '测试连接'
      els.modelTestButton.disabled = true
      if (label) label.textContent = '测试中...'
      setModelTestStatus('正在验证接口与模型可用性...')
      try {
        const result = await window.api.testModelConnection({
          modelId,
          modelName: String(els.modelName?.value || '').trim() || modelId,
          apiUrl,
          apiKey,
          useFullUrl: !!els.apiUrlFullMode?.checked
        })
        if (!result?.success) throw new Error(result?.error || '连接失败')
        const latency = Number.isFinite(Number(result.latencyMs)) ? `，${Number(result.latencyMs)} ms` : ''
        setModelTestStatus(`连接成功${latency}`, 'success')
        showToast('模型连接测试成功', 'success')
      } catch (error) {
        const message = String(error?.message || error || '连接失败')
        setModelTestStatus(message.length > 96 ? `${message.slice(0, 93)}...` : message, 'error')
        showToast('模型连接测试失败', 'error')
      } finally {
        els.modelTestButton.disabled = false
        if (label) label.textContent = previousText
      }
    }

    if (els.urlLockButton) els.urlLockButton.onclick = () => {
      urlLocked = !urlLocked
      els.urlLockButton.classList.toggle('locked', urlLocked)
      els.urlLockButton.setAttribute('aria-pressed', String(urlLocked))
      els.urlLockButton.title = urlLocked ? ((window.i18n?.t?.('auto.js_settings_main_328_14') ?? '已锁定，添加后不清空')) : ((window.i18n?.t?.('auto.js_settings_main_328_15') ?? '锁定 URL，添加后不清空'))
    }

    if (els.keyLockButton) els.keyLockButton.onclick = () => {
      keyLocked = !keyLocked
      els.keyLockButton.classList.toggle('locked', keyLocked)
      els.keyLockButton.setAttribute('aria-pressed', String(keyLocked))
      els.keyLockButton.title = keyLocked ? ((window.i18n?.t?.('auto.js_settings_main_334_16') ?? '已锁定，添加后不清空')) : ((window.i18n?.t?.('auto.js_settings_main_334_17') ?? '锁定 Key，添加后不清空'))
    }

    getContextCompressionStackVisibleInputs().forEach(input => {
      input.checked = getContextCompressionStackVisible()
      input.onchange = () => {
        const enabled = !!input.checked
        setContextCompressionStackVisible(enabled)
        showToast(enabled ? '已显示上下文预算指示器' : '已隐藏上下文预算指示器', 'success')
      }
    })

    if (els.ui?.aiMemoRailVisible) {
      els.ui.aiMemoRailVisible.checked = getAiMemoRailVisible()
      els.ui.aiMemoRailVisible.onchange = () => {
        const enabled = !!els.ui.aiMemoRailVisible.checked
        setAiMemoRailVisible(enabled)
        showToast(enabled ? '已显示 AI 操作备忘录轨迹' : '已隐藏 AI 操作备忘录轨迹', 'success')
      }
    }

    Object.values(els.policyInputs || {}).forEach(input => {
      if (!input) return
      input.onchange = () => {
        saveCapabilityPolicies()
        renderCapabilityRouting()
        showToast(((window.i18n?.t?.('auto.js_settings_main_341_8') ?? ((window.i18n?.t?.('auto.js_settings_main_341_18') ?? '调用确认策略已保存')))), 'success')
      }
    })

    if (els.routing?.policyToggle) {
      els.routing.policyToggle.onchange = () => {
        saveCapabilityPolicies()
        renderCapabilityRouting()
        showToast('调用确认策略已保存', 'success')
      }
    }

    const routingSaveBtn = document.getElementById('settingsRoutingSaveBtn')
    if (routingSaveBtn) {
      routingSaveBtn.onclick = () => {
        saveCapabilityPolicies()
        saveModelsToStorage()
        renderCapabilityRouting()
        showToast('调度设置已保存', 'success')
      }
    }

    const routingResetBtn = document.getElementById('settingsRoutingResetBtn')
    if (routingResetBtn) {
      routingResetBtn.onclick = () => {
        if (!modelStore) return
        const defaultPolicies = {
          imageGenerationConfirm: 'never',
          visionConfirm: 'never',
          musicGenerationConfirm: 'never',
          videoGenerationConfirm: 'never',
          speechSynthesisConfirm: 'never'
        }
        modelStore.setCapabilityPolicies?.(defaultPolicies)
        Object.keys(els.policyInputs || {}).forEach(key => {
          if (els.policyInputs?.[key]) els.policyInputs[key].checked = true
        })
        saveModelsToStorage()
        renderCapabilityRouting()
        showToast('已恢复默认设置', 'success')
      }
    }

    if (els.addModelButton) els.addModelButton.onclick = async () => {
      const modelId = els.modelId.value.trim()
      const modelName = els.modelName.value.trim() || modelId
      const apiUrl = els.apiUrl.value.trim()
      const useFullUrl = !!els.apiUrlFullMode?.checked
      const apiKeyRaw = window.SettingsPanelUI?.getApiKeyRealValue?.(els.apiKey) ?? els.apiKey.value
      if (window.SettingsPanelUI?.isMaskOnlyKey?.(apiKeyRaw)) {
        showToast('Key 是圆点掩码，不是真值。请重新粘贴真实 API Key 后再保存', 'error')
        return
      }
      const apiKey = (window.SettingsPanelUI?.sanitizeApiKeyText?.(apiKeyRaw) ?? String(apiKeyRaw || '').trim())
      if (els.apiKey && apiKey !== els.apiKey.value) {
        els.apiKey.value = apiKey
        window.SettingsPanelUI?.setApiKeyRealValue?.(els.apiKey, apiKey)
      }
      if (!modelId || !apiUrl || !apiKey) {
        showToast(((window.i18n?.t?.('auto.js_settings_main_351_9') ?? ((window.i18n?.t?.('auto.js_settings_main_351_19') ?? '请填写完整信息')))), 'error')
        return
      }
      if (!modelStore) return
      const capabilities = readCapabilities()
      if (!Object.values(capabilities).some(Boolean)) {
        showToast(((window.i18n?.t?.('auto.js_settings_main_358_10') ?? ((window.i18n?.t?.('auto.js_settings_main_358_20') ?? '请至少标注一种模型能力')))), 'error')
        return
      }

      const editingIndex = getEditingIndex()
      const modelPatch = { modelName, modelId, apiUrl, apiKey, useFullUrl, capabilities }
      let successMessage = '模型已添加'
      if (editingIndex >= 0) {
        modelStore.updateModel(editingIndex, modelPatch)
        successMessage = (window.i18n?.t?.('auto.js_settings_main_365_11') ?? (window.i18n?.t?.('auto.js_settings_main_365_21') ?? '模型已更新'))
        setEditingIndex(-1)
      } else {
        modelStore.addModel(modelPatch)
        successMessage = (window.i18n?.t?.('auto.js_settings_main_369_12') ?? (window.i18n?.t?.('auto.js_settings_main_369_22') ?? '模型已添加'))
      }

      syncModelState()
      const previousButtonText = els.addModelButton.textContent
      els.addModelButton.disabled = true
      els.addModelButton.textContent = '正在保存...'
      try {
        await saveModelsToStorage()
      } catch (error) {
        console.error('[SettingsMain] save model config failed:', error)
        showToast('模型配置保存失败，请重试', 'error')
        els.addModelButton.textContent = previousButtonText
        els.addModelButton.disabled = false
        return
      }
      showToast(successMessage, 'success')
      els.modelName.value = ''
      els.modelId.value = ''
      if (!urlLocked) els.apiUrl.value = ''
      if (!urlLocked && els.apiUrlFullMode) els.apiUrlFullMode.checked = false
      if (!keyLocked && els.apiKey) {
        els.apiKey.value = ''
        window.SettingsPanelUI?.setApiKeyRealValue?.(els.apiKey, '')
      }
      writeCapabilities()
      setModelTestStatus()
      updateModelConnectionPreview()
      els.addModelButton.textContent = ((window.i18n?.t?.('auto.js_settings_main_379_13') ?? ((window.i18n?.t?.('auto.js_settings_main_379_23') ?? '添加模型'))))
      if (!urlLocked && !keyLocked) closeModelEditorModal()
      renderSettingsModelList()
      renderCapabilityRouting()
      renderModelSelect()
      loadWorkerModelSettings()
      document.dispatchEvent(new CustomEvent('lingxi:model-config-saved', {
        detail: {
          source: 'settings-model-editor',
          success: true,
          modelKey: modelStore.getModelKey?.(modelStore.getCurrentModel?.()) || ''
        }
      }))
      els.addModelButton.disabled = false
    }

    if (els.localModels?.scanButton) els.localModels.scanButton.onclick = scanLocalModels
    if (els.localModels?.refreshButton) els.localModels.refreshButton.onclick = () => {
      renderLocalModelsList()
      setLocalModelsStatus('状态已刷新', 'success')
    }
    els.localModels?.list?.addEventListener('click', event => {
      const button = event.target.closest('[data-local-model-action]')
      if (!button) return
      const name = button.dataset.model || ''
      if (button.dataset.localModelAction === 'enable') enableLocalModel(name)
      if (button.dataset.localModelAction === 'remove') removeLocalModel(name)
    })

    return {
      renderSettingsModelList,
      renderCapabilityRouting,
      useModelFromSettings,
      openModelEditorModal,
      editModelFromSettings,
      deleteModelFromSettings
    }
  }

  window.SettingsMain = { bind, bindPointerReorder }
})()
