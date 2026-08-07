(function () {
  function bind(options = {}) {
    const modelStore = options.modelStore
    const getModels = options.getModels || function () { return [] }
    const getCurrentIndex = options.getCurrentIndex || function () { return -1 }
    const getCurrentConfig = options.getCurrentConfig || function () { return null }
    const syncModelState = options.syncModelState || function () {}
    const saveModelsToStorage = options.saveModelsToStorage || async function () {}
    const getActiveProject = options.getActiveProject || function () { return null }
    const getProjectModelIndex = options.getProjectModelIndex || function (project) { return project?.modelIndex ?? -1 }
    const setProjectModel = options.setProjectModel || function (project, index) {
      if (project) project.modelIndex = index
    }
    const setEditingIndex = options.setEditingIndex || function () {}
    const getEditingIndex = options.getEditingIndex || function () { return -1 }
    const settingsPanelUI = options.settingsPanelUI
    const openModelEditorModal = options.openModelEditorModal || function () {}

    const panel = document.getElementById('settingsPanel')
    const closeButton = document.getElementById('settingsClose')
    const modelNameInput = document.getElementById('modelName')
    const modelIdInput = document.getElementById('modelId')
    const apiUrlInput = document.getElementById('apiUrl')
    const apiUrlFullModeInput = document.getElementById('apiUrlFullMode')
    const apiKeyInput = document.getElementById('apiKey')

    const keyToggle = document.getElementById('keyToggle')
    const saveBtn = document.getElementById('saveBtn')
    const settingsStatus = document.getElementById('settingsStatus')
    const modelMenu = document.getElementById('modelMenu')
    const modelTrigger = document.getElementById('modelTrigger')
    const modelCurrent = document.getElementById('modelCurrent')
    const capabilityInputs = {
      text: document.getElementById('capabilityText'),
      vision: document.getElementById('capabilityVision'),
      imageGeneration: document.getElementById('capabilityImageGeneration'),
      musicGeneration: document.getElementById('capabilityMusicGeneration'),
      videoGeneration: document.getElementById('capabilityVideoGeneration'),
      speechSynthesis: document.getElementById('capabilitySpeechSynthesis'),
      toolCalling: document.getElementById('capabilityToolCalling')
    }
    let draggedModelIndex = null
    let modelSearchValue = ''

    const escapeHtml = HtmlUtils.escapeHtml

    function openAddModelEditor() {
      modelSearchValue = ''
      modelMenu?.classList.remove('show')
      openModelEditorModal('add')
    }

    function getModelSearchText(model) {
      const labels = modelStore?.getCapabilityLabels?.(model) || []
      return [
        model?.modelName,
        model?.modelId,
        model?.cloudProvider,
        model?.apiUrl,
        labels.join(' ')
      ].filter(Boolean).join(' ').toLowerCase()
    }

    function isChatSelectableModel(model) {
      const capabilities = modelStore?.normalizeCapabilities?.(model?.capabilities) || { text: true }
      return capabilities.text === true
    }

    function getModelIconHtml(model, className = '') {
      return window.ModelBrandIcons?.getIconHtml?.(model, className) || ''
    }

    function getModelDisplayName(model) {
      if (!model) return '未命名模型'
      return model.modelName || model.modelId || '未命名模型'
    }

    function getModelMetaText(model, labels = []) {
      return labels.join(' / ')
    }

    function getSafeSavedModelMeta(model, labels = []) {
      const modelId = model?.modelId && model.modelId !== model.modelName ? model.modelId : ''
      const source = '自定义模型'
      return [modelId, source, labels.join(' / ')].filter(Boolean).join(' · ')
    }

    function getCapabilityHtml(model) {
      const labels = modelStore?.getCapabilityLabels?.(model) || []
      if (labels.length === 0) return ''
      return `<div class="model-capability-badges">${labels.map(label => `<span class="model-capability-badge">${label}</span>`).join('')}</div>`
    }

    function getReasoningDefinitions() {
      return modelStore?.reasoningEffortDefinitions || [
        { value: '', label: ((window.i18n?.t?.('auto.js_quick_model_settings_69_1') ?? '自动')), desc: ((window.i18n?.t?.('auto.js_quick_model_settings_69_2') ?? '不额外发送推理强度参数')) },
        { value: 'low', label: ((window.i18n?.t?.('auto.js_quick_model_settings_70_3') ?? '低')), desc: ((window.i18n?.t?.('auto.js_quick_model_settings_70_4') ?? '更快，适合简单任务')) },
        { value: 'medium', label: ((window.i18n?.t?.('auto.js_quick_model_settings_71_5') ?? '中')), desc: ((window.i18n?.t?.('auto.js_quick_model_settings_71_6') ?? '平衡速度和推理')) },
        { value: 'high', label: ((window.i18n?.t?.('auto.js_quick_model_settings_72_7') ?? '高')), desc: ((window.i18n?.t?.('auto.js_quick_model_settings_72_8') ?? '更慢，适合开发和审查')) },
        { value: 'xhigh', label: ((window.i18n?.t?.('auto.js_quick_model_settings_73_9') ?? '极高')), desc: ((window.i18n?.t?.('auto.js_quick_model_settings_73_10') ?? '最慢，适合大型开发和复杂审查')) }
      ]
    }

    function getReasoningEffort(model) {
      return modelStore?.normalizeReasoningEffort?.(model?.reasoning_effort ?? model?.reasoningEffort) || ''
    }

    function getReasoningLabel(model) {
      const value = getReasoningEffort(model)
      const option = getReasoningDefinitions().find(item => item.value === value)
      return option?.label || ((window.i18n?.t?.('auto.js_quick_model_settings_84_11') ?? '自动'))
    }


    function readCapabilities() {
      const capabilities = {
        text: !!capabilityInputs.text?.checked,
        vision: !!capabilityInputs.vision?.checked,
        imageGeneration: !!capabilityInputs.imageGeneration?.checked,
        musicGeneration: !!capabilityInputs.musicGeneration?.checked,
        videoGeneration: !!capabilityInputs.videoGeneration?.checked,
        speechSynthesis: !!capabilityInputs.speechSynthesis?.checked,
        toolCalling: !!capabilityInputs.toolCalling?.checked
      }
      return capabilities
    }

    function writeCapabilities(modelOrCapabilities = null) {
      const caps = modelStore?.normalizeCapabilities?.(modelOrCapabilities?.capabilities || modelOrCapabilities) || {}
      Object.entries(capabilityInputs).forEach(([key, input]) => {
        if (input) input.checked = !!caps[key]
      })
    }

    function fillQuickModelForm(model) {
      if (!model) {
        writeCapabilities()
        return
      }
      modelNameInput.value = model.modelName || ''
      modelIdInput.value = model.modelId || model.modelName || ''
      apiUrlInput.value = model.apiUrl || ''
      if (apiUrlFullModeInput) apiUrlFullModeInput.checked = model.useFullUrl === true || model.fullUrl === true || model.apiUrlMode === 'full'
      const keyValue = model.apiKey || ''
      apiKeyInput.value = keyValue
      window.SettingsPanelUI?.setApiKeyRealValue?.(apiKeyInput, keyValue)
      window.SettingsPanelUI?.setApiKeyMasked?.(apiKeyInput, true)
      writeCapabilities(model)
    }

    function switchSettingsTab(tab) {
      document.getElementById('contentNew')?.classList.toggle('show', true)
    }

    function bindReasoningOptionEvents() {
      function hideAllReasoningMenus(except = null) {
        modelMenu.querySelectorAll('.model-option-with-reasoning').forEach(opt => {
          if (opt !== except) opt.classList.remove('active-reasoning')
        })
        document.querySelectorAll('.model-reasoning-menu-floating').forEach(menu => {
          if (menu !== except) menu.remove()
        })
      }

      function buildReasoningMenuHtml(modelIndex) {
        const models = getModels()
        const model = models[modelIndex]
        if (!model) return ''
        const current = getReasoningEffort(model)
        return `<div class="model-reasoning-title">推理强度</div>` +
          getReasoningDefinitions().map(item =>
            `<button class="model-reasoning-option ${item.value === current ? 'selected' : ''}" data-model-index="${modelIndex}" data-reasoning-value="${escapeHtml(item.value)}" type="button">
              <span class="model-reasoning-label">${escapeHtml(item.label)}</span>
              <span class="model-reasoning-desc">${escapeHtml(item.desc || '')}</span>
            </button>`
          ).join('')
      }

      modelMenu.querySelectorAll('.model-option-with-reasoning').forEach(option => {
        const modelIndex = parseInt(option.dataset.value, 10)
        if (isNaN(modelIndex)) return
        let hideTimer = null
        let floatingMenu = null
        const showMenu = () => {
          clearTimeout(hideTimer)
          hideAllReasoningMenus()
          option.classList.add('active-reasoning')
          const rect = option.getBoundingClientRect()
          floatingMenu = document.createElement('div')
          floatingMenu.className = 'model-reasoning-menu model-reasoning-menu-floating'
          floatingMenu.innerHTML = buildReasoningMenuHtml(modelIndex)
          floatingMenu.style.position = 'fixed'
          floatingMenu.style.left = `${rect.right + 8}px`
          floatingMenu.style.display = 'block'
          document.body.appendChild(floatingMenu)
          const menuHeight = floatingMenu.offsetHeight || 160
          const centerY = rect.top + rect.height / 2
          const menuTop = Math.max(8, Math.min(centerY - menuHeight / 2, window.innerHeight - menuHeight - 8))
          floatingMenu.style.top = `${menuTop}px`
          floatingMenu.querySelectorAll('.model-reasoning-option').forEach(button => {
            button.onclick = e => {
              e.stopPropagation()
              const idx = parseInt(button.dataset.modelIndex, 10)
              const value = button.dataset.reasoningValue || ''
              const updatedModel = modelStore?.setModelReasoningEffort?.(idx, value)
              if (!updatedModel) return
              syncModelState()
              saveModelsToStorage()
              renderModelSelect(modelSearchValue)
              const activeProject = getActiveProject()
              const activeIndex = activeProject ? getProjectModelIndex(activeProject) : getCurrentIndex()
              if (activeIndex === idx && modelCurrent) {
                modelCurrent.textContent = updatedModel.modelName || updatedModel.modelId || '未命名模型'
              }
              if (settingsStatus) {
                settingsStatus.textContent = `推理强度已设为：${getReasoningLabel(updatedModel)}`
                setTimeout(() => { settingsStatus.textContent = '' }, 1500)
              }
              floatingMenu?.remove()
              floatingMenu = null
              option.classList.remove('active-reasoning')
            }
          })
          floatingMenu.addEventListener('mouseenter', () => clearTimeout(hideTimer))
          floatingMenu.addEventListener('mouseleave', hideMenu)
        }
        const hideMenu = () => {
          hideTimer = setTimeout(() => {
            if (!option.matches(':hover') && (!floatingMenu || !floatingMenu.matches(':hover'))) {
              floatingMenu?.remove()
              floatingMenu = null
              option.classList.remove('active-reasoning')
            }
          }, 120)
        }
        option.addEventListener('mouseenter', showMenu)
        option.addEventListener('mouseleave', hideMenu)
      })
    }

    function renderModelList() {
      const modelListEl = document.getElementById('modelList')
      if (!modelListEl) return
      const savedModels = getModels()
      if (savedModels.length === 0) {
        modelListEl.innerHTML = '<div class="model-empty">暂无已储存的模型</div>'
        return
      }
      modelListEl.innerHTML = savedModels.map((model, index) => `
        <div class="model-item" data-index="${index}">
          ${getModelIconHtml(model, 'model-item-icon')}
          <div class="model-info">
            <div class="model-name">${escapeHtml(model.modelName || '未命名模型')}</div>
            <div class="model-url">${escapeHtml(getSafeSavedModelMeta(model, modelStore?.getCapabilityLabels?.(model) || []))}</div>
            ${getCapabilityHtml(model)}
          </div>
          <div class="model-actions">
            <span class="model-btn use" data-action="use" data-index="${index}" title="使用">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>
            </span>
            <span class="model-btn edit" data-action="edit" data-index="${index}" title="编辑">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
            </span>
            <span class="model-btn delete" data-action="delete" data-index="${index}" title="删除">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </span>
          </div>
        </div>
      `).join('')

      modelListEl.querySelectorAll('.model-btn').forEach(button => {
        button.onclick = () => {
          const index = parseInt(button.dataset.index, 10)
          if (button.dataset.action === 'use') useModel(index)
          if (button.dataset.action === 'edit') editModel(index)
          if (button.dataset.action === 'delete') deleteModel(index)
        }
      })

      setupModelDragSort()
    }

    function renderModelSelect() {
      const savedModels = getModels()
      const activeProject = getActiveProject()
      const currentModelIndex = activeProject ? getProjectModelIndex(activeProject) : getCurrentIndex()
      if (savedModels.length === 0) {
        modelMenu.innerHTML = ((window.i18n?.t?.('auto.js_quick_model_settings_243_18') ?? '<div class="model-option" data-value="-1">无可用模型</div><div class="model-separator"></div><div class="model-option add-model" data-value="add">+ 新增模型</div>'))
        modelCurrent.textContent = ((window.i18n?.t?.('auto.js_quick_model_settings_244_0') ?? ((window.i18n?.t?.('auto.js_quick_model_settings_244_19') ?? '无可用模型'))))
      } else {
        let html = ''
        savedModels.forEach((model, index) => {
          const selected = (currentModelIndex === index) ? 'selected' : ''
          const labels = modelStore?.getCapabilityLabels?.(model) || []
          html += `<div class="model-option model-option-with-reasoning ${selected}" data-value="${index}"><span class="model-option-name">${escapeHtml(model.modelName || '未命名模型')}</span><span class="model-option-capabilities">${escapeHtml(labels.join(' / '))}</span><span class="model-option-reasoning">推理：${escapeHtml(getReasoningLabel(model))}</span></div>`
        })
        html += ((window.i18n?.t?.('auto.js_quick_model_settings_252_20') ?? '<div class="model-separator"></div><div class="model-option add-model" data-value="add">+ 新增模型</div>'))
        modelMenu.innerHTML = html
      }

      if (currentModelIndex >= 0 && savedModels[currentModelIndex]) {
        modelCurrent.textContent = savedModels[currentModelIndex].modelName
      }

      modelMenu.querySelectorAll('.model-option').forEach(option => {
        option.onclick = e => {
          e.stopPropagation()
          if (e.target.closest('.model-reasoning-menu')) return
          const value = option.dataset.value
          if (value === 'add') {
            openAddModelEditor()
            return
          }
          if (value !== '-1') {
            useModel(parseInt(value, 10))
          }
          modelMenu.classList.remove('show')
        }
      })
      bindReasoningOptionEvents()
    }

    function useModel(index, silent = false) {
      modelStore.setCurrentIndex(index)
      if (!silent) {
        const project = getActiveProject()
        if (project) setProjectModel(project, index)
      }
      syncModelState()
      saveModelsToStorage()
      if (!silent) {
        const currentConfig = getModels()[index] || getCurrentConfig()
        if (currentConfig) modelCurrent.textContent = currentConfig.modelName
        renderModelSelect()
        window.dispatchEvent(new CustomEvent('lingxi:model-changed', {
          detail: {
            projectId: getActiveProject()?.id || '',
            modelName: currentConfig?.modelName || currentConfig?.modelId || ''
          }
        }))
        settingsStatus.textContent = ((window.i18n?.t?.('auto.js_quick_model_settings_292_1') ?? ((window.i18n?.t?.('auto.js_quick_model_settings_292_21') ?? '已切换到: ')))) + (currentConfig?.modelName || '')
        setTimeout(() => { settingsStatus.textContent = '' }, 1500)
      }
    }

    renderModelSelect = function (filter = modelSearchValue) {
      const savedModels = getModels()
      const activeProject = getActiveProject()
      const currentModelIndex = activeProject ? getProjectModelIndex(activeProject) : getCurrentIndex()
      modelSearchValue = String(filter || '')
      const normalizedFilter = modelSearchValue.trim().toLowerCase()
      let html = ((window.i18n?.t?.('auto.js_quick_model_settings_303_22') ?? '<input class="model-menu-search" id="modelMenuSearch" type="text" placeholder="搜索模型..."><div class="model-menu-list">'))

      if (savedModels.length === 0) {
        html += ((window.i18n?.t?.('auto.js_quick_model_settings_306_23') ?? '<div class="model-option" data-value="-1">无可用模型</div>'))
        modelCurrent.textContent = ((window.i18n?.t?.('auto.js_quick_model_settings_307_2') ?? ((window.i18n?.t?.('auto.js_quick_model_settings_307_24') ?? '无可用模型'))))
      } else {
        const filteredModels = savedModels
          .map((model, index) => ({ model, index }))
          .filter(({ model }) => !normalizedFilter || getModelSearchText(model).includes(normalizedFilter))

        if (filteredModels.length === 0) {
          html += ((window.i18n?.t?.('auto.js_quick_model_settings_314_25') ?? '<div class="model-empty-option">没有匹配的模型</div>'))
        }

        filteredModels.forEach(({ model, index }) => {
          const selected = (currentModelIndex === index) ? 'selected' : ''
          const labels = modelStore?.getCapabilityLabels?.(model) || []
          html += `<div class="model-option model-option-with-reasoning ${selected}" data-value="${index}"><span class="model-option-name">${escapeHtml(model.modelName || '未命名模型')}</span><span class="model-option-capabilities">${escapeHtml(labels.join(' / '))}</span><span class="model-option-reasoning">推理：${escapeHtml(getReasoningLabel(model))}</span></div>`
        })
      }

      html += ((window.i18n?.t?.('auto.js_quick_model_settings_324_26') ?? '</div><div class="model-separator"></div><div class="model-option add-model" data-value="add">+ 新增模型</div>'))
      modelMenu.innerHTML = html

      const searchInput = modelMenu.querySelector('.model-menu-search')
      if (searchInput) {
        searchInput.value = modelSearchValue
        searchInput.oninput = e => {
          renderModelSelect(e.target.value)
          const nextInput = modelMenu.querySelector('.model-menu-search')
          if (nextInput) {
            nextInput.focus()
            const cursor = nextInput.value.length
            nextInput.setSelectionRange(cursor, cursor)
          }
        }
      }

      if (currentModelIndex >= 0 && savedModels[currentModelIndex]) {
        modelCurrent.textContent = savedModels[currentModelIndex].modelName
      }

      modelMenu.querySelectorAll('.model-option').forEach(option => {
        option.onclick = e => {
          e.stopPropagation()
          if (e.target.closest('.model-reasoning-menu')) return
          const value = option.dataset.value
          if (value === 'add') {
            openAddModelEditor()
            return
          }
          if (value !== '-1') {
            modelSearchValue = ''
            useModel(parseInt(value, 10))
          }
          modelMenu.classList.remove('show')
        }
      })
      bindReasoningOptionEvents()
    }

    renderModelSelect = function (filter = modelSearchValue) {
      const savedModels = getModels()
      const activeProject = getActiveProject()
      const currentModelIndex = activeProject ? getProjectModelIndex(activeProject) : getCurrentIndex()
      const currentModel = currentModelIndex >= 0 ? savedModels[currentModelIndex] : null
      modelSearchValue = String(filter || '')
      const normalizedFilter = modelSearchValue.trim().toLowerCase()
      const allModelRefs = savedModels
        .map((model, index) => ({ model, index }))
        .filter(({ model }) => isChatSelectableModel(model))
      const filteredModels = allModelRefs.filter(({ model }) => !normalizedFilter || getModelSearchText(model).includes(normalizedFilter))

      let html = `
        <input class="model-menu-search" id="modelMenuSearch" type="text" placeholder="搜索模型...">
        <div class="model-menu-list">
      `

      if (savedModels.length === 0) {
        html += '<div class="model-option" data-value="-1">暂无可用模型</div>'
      } else if (allModelRefs.length === 0) {
        html += '<div class="model-empty-option">暂无可聊天的文本模型</div>'
      } else if (filteredModels.length === 0) {
        html += '<div class="model-empty-option">暂无匹配的自定义文本模型</div>'
      } else {
        filteredModels.forEach(({ model, index }) => {
          const selected = (currentModelIndex === index) ? 'selected' : ''
          const labels = modelStore?.getCapabilityLabels?.(model) || []
          html += `
            <div class="model-option model-option-with-reasoning ${selected}" data-value="${index}">
              ${getModelIconHtml(model, 'model-option-icon')}
              <span class="model-option-name">${escapeHtml(getModelDisplayName(model))}</span>
              <span class="model-option-capabilities">${escapeHtml(getModelMetaText(model, labels))}</span>
              <span class="model-option-reasoning">推理：${escapeHtml(getReasoningLabel(model))}</span>
              
            </div>
          `
        })
      }

      html += '</div>'
      html += '<div class="model-separator"></div><div class="model-option add-model" data-value="add">+ 新增自定义模型</div>'
      modelMenu.innerHTML = html

      const searchInput = modelMenu.querySelector('.model-menu-search')
      if (searchInput) {
        searchInput.value = modelSearchValue
        searchInput.oninput = e => {
          renderModelSelect(e.target.value)
          const nextInput = modelMenu.querySelector('.model-menu-search')
          if (nextInput) {
            nextInput.focus()
            const cursor = nextInput.value.length
            nextInput.setSelectionRange(cursor, cursor)
          }
        }
      }

      modelCurrent.textContent = currentModel && isChatSelectableModel(currentModel)
        ? getModelDisplayName(currentModel)
        : '暂无可聊天的文本模型'

      modelMenu.querySelectorAll('.model-option').forEach(option => {
        option.onclick = e => {
          e.stopPropagation()
          if (e.target.closest('.model-reasoning-menu')) return
          const value = option.dataset.value
          if (value === 'add') {
            openAddModelEditor()
            return
          }
          if (value !== '-1' && value !== undefined) {
            modelSearchValue = ''
            useModel(parseInt(value, 10))
          }
          modelMenu.classList.remove('show')
        }
      })
      bindReasoningOptionEvents()
    }

    function editModel(index) {
      setEditingIndex(index)
      const model = getModels()[index]
      if (!model) return
      modelNameInput.value = model.modelName || ''
      modelIdInput.value = model.modelId || model.modelName || ''
      apiUrlInput.value = model.apiUrl || ''
      if (apiUrlFullModeInput) apiUrlFullModeInput.checked = model.useFullUrl === true || model.fullUrl === true || model.apiUrlMode === 'full'
      const keyValue = model.apiKey || ''
      apiKeyInput.value = keyValue
      window.SettingsPanelUI?.setApiKeyRealValue?.(apiKeyInput, keyValue)
      window.SettingsPanelUI?.setApiKeyMasked?.(apiKeyInput, true)
      writeCapabilities(model)
      switchSettingsTab('new')
      saveBtn.textContent = ((window.i18n?.t?.('auto.js_quick_model_settings_377_3') ?? ((window.i18n?.t?.('auto.js_quick_model_settings_377_27') ?? '更新'))))
    }

    function deleteModel(index) {
      if (confirm(((window.i18n?.t?.('auto.js_quick_model_settings_381_28') ?? '确定删除此模型？')))) {
        modelStore.removeModel(index)
        syncModelState()
        saveModelsToStorage()
        renderModelList()
        renderModelSelect()
        settingsStatus.textContent = ((window.i18n?.t?.('auto.js_quick_model_settings_387_4') ?? ((window.i18n?.t?.('auto.js_quick_model_settings_387_29') ?? '已删除'))))
        setTimeout(() => { settingsStatus.textContent = '' }, 1500)
      }
    }

    function saveModel() {
      const modelId = modelIdInput.value.trim()
      const modelName = modelNameInput.value.trim() || modelId
      const apiUrl = apiUrlInput.value.trim()
      const useFullUrl = !!apiUrlFullModeInput?.checked
      const apiKeyRaw = window.SettingsPanelUI?.getApiKeyRealValue?.(apiKeyInput) ?? apiKeyInput.value
      if (window.SettingsPanelUI?.isMaskOnlyKey?.(apiKeyRaw)) {
        showToast?.('Key 是圆点掩码，不是真值。请重新粘贴真实 API Key 后再保存', 'error')
        return
      }
      const apiKey = (window.SettingsPanelUI?.sanitizeApiKeyText?.(apiKeyRaw) ?? String(apiKeyRaw || '').trim())
      if (apiKeyInput && apiKey !== apiKeyInput.value) {
        apiKeyInput.value = apiKey
        window.SettingsPanelUI?.setApiKeyRealValue?.(apiKeyInput, apiKey)
      }

      if (!modelId || !apiUrl || !apiKey) {
        settingsStatus.textContent = ((window.i18n?.t?.('auto.js_quick_model_settings_399_5') ?? ((window.i18n?.t?.('auto.js_quick_model_settings_399_30') ?? '请填写完整信息'))))
        return
      }

      const capabilities = readCapabilities()
      if (!Object.values(capabilities).some(Boolean)) {
        settingsStatus.textContent = ((window.i18n?.t?.('auto.js_quick_model_settings_405_6') ?? ((window.i18n?.t?.('auto.js_quick_model_settings_405_31') ?? '请至少标注一种模型能力'))))
        return
      }

      const model = { modelName, modelId, apiUrl, apiKey, useFullUrl, capabilities }
      const editingModelIndex = getEditingIndex()
      if (editingModelIndex >= 0) {
        modelStore.updateModel(editingModelIndex, model)
        setEditingIndex(-1)
        saveBtn.textContent = ((window.i18n?.t?.('auto.js_quick_model_settings_414_7') ?? ((window.i18n?.t?.('auto.js_quick_model_settings_414_32') ?? '保存'))))
        settingsStatus.textContent = ((window.i18n?.t?.('auto.js_quick_model_settings_415_8') ?? ((window.i18n?.t?.('auto.js_quick_model_settings_415_33') ?? '已更新'))))
      } else {
        modelStore.addModel(model)
        settingsStatus.textContent = ((window.i18n?.t?.('auto.js_quick_model_settings_418_9') ?? ((window.i18n?.t?.('auto.js_quick_model_settings_418_34') ?? '已保存'))))
      }

      syncModelState()
      saveModelsToStorage()
      renderModelSelect()
      modelNameInput.value = ''
      modelIdInput.value = ''
      apiUrlInput.value = ''
      if (apiUrlFullModeInput) apiUrlFullModeInput.checked = false
      apiKeyInput.value = ''
      window.SettingsPanelUI?.setApiKeyRealValue?.(apiKeyInput, '')
      writeCapabilities()

      setTimeout(() => {
        panel.classList.remove('show')
        settingsStatus.textContent = ''
      }, 1000)
    }

    function setupModelDragSort() {
      const modelListEl = document.getElementById('modelList')
      if (!modelListEl) return
      const modelItems = modelListEl.querySelectorAll('.model-item')
      modelItems.forEach(item => {
        item.draggable = true
        item.addEventListener('dragstart', e => {
          draggedModelIndex = parseInt(item.dataset.index, 10)
          item.classList.add('dragging')
          e.dataTransfer.effectAllowed = 'move'
        })
        item.addEventListener('dragend', () => {
          item.classList.remove('dragging')
          modelItems.forEach(i => i.classList.remove('drag-over'))
          draggedModelIndex = null
        })
        item.addEventListener('dragover', e => {
          e.preventDefault()
          e.dataTransfer.dropEffect = 'move'
          const targetIndex = parseInt(item.dataset.index, 10)
          if (targetIndex !== draggedModelIndex) {
            item.classList.add('drag-over')
          }
        })
        item.addEventListener('dragleave', () => {
          item.classList.remove('drag-over')
        })
        item.addEventListener('drop', e => {
          e.preventDefault()
          item.classList.remove('drag-over')
          const targetIndex = parseInt(item.dataset.index, 10)
          if (draggedModelIndex !== null && targetIndex !== draggedModelIndex) {
            modelStore.moveModel(draggedModelIndex, targetIndex)
            syncModelState()
            saveModelsToStorage()
            renderModelList()
            renderModelSelect()
          }
        })
      })
    }

    if (settingsPanelUI) {
      settingsPanelUI.bind({
        panel,
        closeButton,
        keyToggle,
        apiKeyInput
      })
    }

    if (saveBtn) saveBtn.onclick = saveModel
    if (modelTrigger) modelTrigger.onclick = e => {
      e.stopPropagation()
      modelMenu.classList.toggle('show')
      if (modelMenu.classList.contains('show')) {
        renderModelSelect(modelSearchValue)
      }
    }
    if (modelMenu) modelMenu.onclick = e => e.stopPropagation()
    document.addEventListener('click', () => {
      modelMenu.classList.remove('show')
      document.querySelectorAll('.model-reasoning-menu-floating').forEach(m => m.remove())
      modelMenu.querySelectorAll('.active-reasoning').forEach(el => el.classList.remove('active-reasoning'))
    })

    function togglePanel() {
      panel.classList.toggle('show')
    }

    return {
      fillQuickModelForm,
      switchSettingsTab,
      renderModelList,
      renderModelSelect,
      useModel,
      editModel,
      deleteModel,
      saveModel,
      setupModelDragSort,
      togglePanel
    }
  }

  window.QuickModelSettings = { bind }
})()
