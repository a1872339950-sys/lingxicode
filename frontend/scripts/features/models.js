(function () {
  let models = []
  let currentIndex = -1
  const routableCapabilityKeys = ['vision', 'imageGeneration', 'musicGeneration', 'videoGeneration', 'speechSynthesis']
  let capabilityRouting = {}
  let capabilityPolicies = {}
  const defaultCapabilityPolicies = {
    imageGenerationConfirm: 'never',
    visionConfirm: 'never',
    musicGenerationConfirm: 'never',
    videoGenerationConfirm: 'never',
    speechSynthesisConfirm: 'never'
  }
  const capabilityDefinitions = [
    { key: 'text', label: ((window.i18n?.t?.('auto.js_models_12_1') ?? '文本')) },
    { key: 'vision', label: ((window.i18n?.t?.('auto.js_models_13_2') ?? '视觉理解')) },
    { key: 'imageGeneration', label: ((window.i18n?.t?.('auto.js_models_14_3') ?? '图片生成')) },
    { key: 'musicGeneration', label: ((window.i18n?.t?.('auto.js_models_15_4') ?? '音乐生成')) },
    { key: 'videoGeneration', label: ((window.i18n?.t?.('auto.js_models_16_5') ?? '视频生成')) },
    { key: 'speechSynthesis', label: '语音合成' },
    { key: 'toolCalling', label: ((window.i18n?.t?.('auto.js_models_17_6') ?? '工具调用')) }
  ]
  const defaultCapabilities = {
    text: true,
    vision: false,
    imageGeneration: false,
    musicGeneration: false,
    videoGeneration: false,
    speechSynthesis: false,
    toolCalling: true
  }
  const reasoningEffortDefinitions = [
    { value: '', label: ((window.i18n?.t?.('auto.js_models_28_7') ?? '自动')), desc: ((window.i18n?.t?.('auto.js_models_28_8') ?? '不额外发送推理强度参数')) },
    { value: 'low', label: ((window.i18n?.t?.('auto.js_models_29_9') ?? '低')), desc: ((window.i18n?.t?.('auto.js_models_29_10') ?? '更快，适合简单聊天和小修改')) },
    { value: 'medium', label: ((window.i18n?.t?.('auto.js_models_30_11') ?? '中')), desc: ((window.i18n?.t?.('auto.js_models_30_12') ?? '平衡速度和思考深度')) },
    { value: 'high', label: ((window.i18n?.t?.('auto.js_models_31_13') ?? '高')), desc: ((window.i18n?.t?.('auto.js_models_31_14') ?? '更慢，适合开发、审查和复杂推理')) },
    { value: 'xhigh', label: ((window.i18n?.t?.('auto.js_models_32_15') ?? '极高')), desc: ((window.i18n?.t?.('auto.js_models_32_16') ?? '最慢，适合大型开发、复杂审查和多步工具任务')) }
  ]
  const reasoningEffortValues = new Set(reasoningEffortDefinitions.map(item => item.value))
  function normalizeReasoningEffort(value) {
    const normalized = String(value || '').trim().toLowerCase()
    return reasoningEffortValues.has(normalized) ? normalized : ''
  }

  function normalizeCapabilities(capabilities) {
    const source = capabilities && typeof capabilities === 'object' ? capabilities : null
    const normalized = { ...defaultCapabilities }
    if (source) {
      normalized.text = source.text !== undefined ? !!source.text : normalized.text
      normalized.vision = source.vision !== undefined ? !!source.vision : normalized.vision
      normalized.imageGeneration = source.imageGeneration !== undefined ? !!source.imageGeneration : !!source.imageGen
      normalized.musicGeneration = source.musicGeneration !== undefined ? !!source.musicGeneration : !!source.musicGen
      normalized.videoGeneration = source.videoGeneration !== undefined ? !!source.videoGeneration : !!source.videoGen
      normalized.speechSynthesis = source.speechSynthesis !== undefined ? !!source.speechSynthesis : !!source.speechSynth
      normalized.toolCalling = source.toolCalling !== undefined ? !!source.toolCalling : normalized.toolCalling
    }
    if (!Object.values(normalized).some(Boolean)) return { ...defaultCapabilities }
    return normalized
  }

  function normalizeModel(model) {
    const nextModel = model && typeof model === 'object' ? { ...model } : {}
    nextModel.capabilities = normalizeCapabilities(nextModel.capabilities)
    nextModel.reasoning_effort = normalizeReasoningEffort(nextModel.reasoning_effort ?? nextModel.reasoningEffort)
    nextModel.reasoningEffort = nextModel.reasoning_effort
    nextModel.modelKey = getModelKey(nextModel) || Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8)
    return nextModel
  }

  function normalizeModelList(nextModels) {
    return Array.isArray(nextModels) ? nextModels.map(normalizeModel) : []
  }

  function normalizeCapabilityRouting(nextRouting = {}) {
    const source = nextRouting && typeof nextRouting === 'object' ? nextRouting : {}
    const normalized = {}
    routableCapabilityKeys.forEach(key => {
      const capableKeys = models.filter(model => hasCapability(model, key)).map(getModelKey).filter(Boolean)
      const validKeys = new Set(capableKeys)
      const seen = new Set()
      const orderedKeys = (Array.isArray(source[key]) ? source[key] : [])
        .map(value => String(value || '').trim())
        .filter(modelKey => {
          if (!modelKey || seen.has(modelKey) || !validKeys.has(modelKey)) return false
          seen.add(modelKey)
          return true
        })
      capableKeys.forEach(modelKey => {
        if (!seen.has(modelKey)) {
          orderedKeys.push(modelKey)
          seen.add(modelKey)
        }
      })
      normalized[key] = orderedKeys
    })
    return normalized
  }

  function normalizeCapabilityPolicies(nextPolicies = {}) {
    const source = nextPolicies && typeof nextPolicies === 'object' ? nextPolicies : {}
    const pick = (key) => source[key] === 'always' ? 'always' : defaultCapabilityPolicies[key]
    return {
      imageGenerationConfirm: pick('imageGenerationConfirm'),
      visionConfirm: pick('visionConfirm'),
      musicGenerationConfirm: pick('musicGenerationConfirm'),
      videoGenerationConfirm: pick('videoGenerationConfirm'),
      speechSynthesisConfirm: pick('speechSynthesisConfirm')
    }
  }

  function hasCapability(model, key) {
    if (!model || !key) return false
    return !!normalizeCapabilities(model.capabilities)[key]
  }

  function getCapabilityLabels(model) {
    const capabilities = normalizeCapabilities(model?.capabilities)
    return capabilityDefinitions.filter(item => capabilities[item.key]).map(item => item.label)
  }

  function findModelWithCapability(key, excludeModel = null) {
    return models.find(model => model !== excludeModel && hasCapability(model, key)) || null
  }

  function getModelsForCapability(key) {
    return models.filter(model => hasCapability(model, key))
  }

  function getCapabilityRouting() {
    capabilityRouting = normalizeCapabilityRouting(capabilityRouting)
    return { ...capabilityRouting }
  }

  function getRoutedModelsForCapability(key) {
    if (!routableCapabilityKeys.includes(key)) return []
    capabilityRouting = normalizeCapabilityRouting(capabilityRouting)
    const capableModels = getModelsForCapability(key)
    const byKey = new Map(capableModels.map(model => [getModelKey(model), model]))
    const routed = []
    const used = new Set()
    ;(capabilityRouting[key] || []).forEach(modelKey => {
      const model = byKey.get(modelKey)
      if (model) {
        routed.push(model)
        used.add(modelKey)
      }
    })
    capableModels.forEach(model => {
      const modelKey = getModelKey(model)
      if (!used.has(modelKey)) routed.push(model)
    })
    return routed
  }

  function setCapabilityRouting(nextRouting) {
    capabilityRouting = normalizeCapabilityRouting(nextRouting)
    return getCapabilityRouting()
  }

  function getCapabilityPolicies() {
    capabilityPolicies = normalizeCapabilityPolicies(capabilityPolicies)
    return { ...capabilityPolicies }
  }

  function setCapabilityPolicies(nextPolicies) {
    capabilityPolicies = normalizeCapabilityPolicies(nextPolicies)
    return getCapabilityPolicies()
  }

  function moveCapabilityModel(capabilityKey, fromIndex, toIndex) {
    if (!routableCapabilityKeys.includes(capabilityKey)) return false
    const routedModels = getRoutedModelsForCapability(capabilityKey)
    if (!routedModels[fromIndex] || fromIndex === toIndex || toIndex < 0 || toIndex >= routedModels.length) {
      return false
    }

    const keys = routedModels.map(getModelKey).filter(Boolean)
    const [draggedKey] = keys.splice(fromIndex, 1)
    keys.splice(toIndex, 0, draggedKey)
    capabilityRouting = normalizeCapabilityRouting({
      ...capabilityRouting,
      [capabilityKey]: keys
    })
    return true
  }

  function getModelKey(model) {
    if (!model || typeof model !== 'object') return ''
    if (model.modelKey && String(model.modelKey).trim()) {
      return String(model.modelKey).trim()
    }
    const parts = [
      model.provider,
      model.apiUrl,
      model.modelId || model.modelName,
      model.modelName
    ].filter(value => value !== undefined && value !== null && String(value).trim() !== '')
    return parts.map(value => String(value).trim()).join('::')
  }

  function getModelAt(index) {
    const normalizedIndex = normalizeIndex(index)
    return normalizedIndex >= 0 ? models[normalizedIndex] || null : null
  }

  function findModelIndexByKey(modelKey) {
    if (!modelKey) return -1
    return models.findIndex(model => getModelKey(model) === modelKey)
  }

  function resolveModelIndex(ref = {}) {
    if (ref && typeof ref === 'object') {
      const keyIndex = findModelIndexByKey(ref.modelKey)
      if (keyIndex >= 0) return keyIndex

      if (ref.model && typeof ref.model === 'object') {
        const modelIndex = findModelIndexByKey(getModelKey(ref.model))
        if (modelIndex >= 0) return modelIndex
      }

      if (Number.isInteger(ref.modelIndex)) return normalizeIndex(ref.modelIndex)
    }

    return normalizeIndex(ref)
  }

  function resolveModel(ref = {}) {
    const index = resolveModelIndex(ref)
    return index >= 0 ? models[index] || null : null
  }

  function normalizeIndex(index) {
    const nextIndex = Number.isInteger(index) ? index : parseInt(index, 10)
    if (!Number.isFinite(nextIndex)) return -1
    if (nextIndex < 0 || nextIndex >= models.length) {
      return models.length > 0 ? 0 : -1
    }
    return nextIndex
  }

  function setState(nextModels, nextIndex) {
    models = normalizeModelList(nextModels)
    currentIndex = normalizeIndex(nextIndex)
    capabilityRouting = normalizeCapabilityRouting(capabilityRouting)
  }

  function getModels() {
    return models
  }

  function getCurrentIndex() {
    return currentIndex
  }

  function getCurrentModel() {
    return currentIndex >= 0 ? models[currentIndex] || null : null
  }

  function setCurrentIndex(index) {
    currentIndex = normalizeIndex(index)
    return getCurrentModel()
  }

  async function load() {
    if (window.api?.getApiConfig) {
      try {
        const result = await window.api.getApiConfig()
        if (result.success && result.data) {
          if (Array.isArray(result.data.models) && result.data.models.length > 0) {
            const backendIndex = Number.isInteger(result.data.currentIndex)
              ? result.data.currentIndex
              : parseInt(result.data.currentIndex, 10)
            const savedCurrentModelKey = String(result.data.currentModelKey || '').trim()
            setState(result.data.models, Number.isFinite(backendIndex) ? backendIndex : 0)
            if (savedCurrentModelKey) {
              const restoredIndex = findModelIndexByKey(savedCurrentModelKey)
              if (restoredIndex >= 0) currentIndex = restoredIndex
            }
            capabilityRouting = normalizeCapabilityRouting(result.data.capabilityRouting)
            capabilityPolicies = normalizeCapabilityPolicies(result.data.capabilityPolicies)
            AppLogger.debug('[Frontend] 从后端加载 API 配置成功，共', models.length, '个模型')
            return { models, currentIndex, currentModel: getCurrentModel(), capabilityRouting: getCapabilityRouting(), capabilityPolicies: getCapabilityPolicies(), source: 'backend' }
          }

          if (result.isNew) {
            const localSaved = localStorage.getItem('savedModels')
            const localIndex = localStorage.getItem('currentModelIndex')
            let localCapabilityRouting = {}
            let localCapabilityPolicies = {}
            try {
              localCapabilityRouting = JSON.parse(localStorage.getItem('capabilityRouting') || '{}')
            } catch (e) {
              localCapabilityRouting = {}
            }
            try {
              localCapabilityPolicies = JSON.parse(localStorage.getItem('capabilityPolicies') || '{}')
            } catch (e) {
              localCapabilityPolicies = {}
            }

            if (localSaved) {
              try {
                const localModels = JSON.parse(localSaved)
                if (Array.isArray(localModels) && localModels.length > 0) {
                  const parsedIndex = localIndex !== null ? parseInt(localIndex, 10) : 0
                  const migrateResult = await window.api.migrateApiConfig({
                    savedModels: localModels,
                    currentModelIndex: parsedIndex,
                    capabilityRouting: localCapabilityRouting,
                    capabilityPolicies: localCapabilityPolicies
                  })

                  if (migrateResult.success) {
                    setState(localModels, parsedIndex)
                    capabilityRouting = normalizeCapabilityRouting(localCapabilityRouting)
                    capabilityPolicies = normalizeCapabilityPolicies(localCapabilityPolicies)
                    localStorage.removeItem('savedModels')
                    localStorage.removeItem('currentModelIndex')
                    localStorage.removeItem('capabilityRouting')
                    localStorage.removeItem('capabilityPolicies')
                    localStorage.removeItem('apiConfig')
                    AppLogger.debug('[Frontend] 已从 localStorage 迁移 API 配置到后端')
                    return { models, currentIndex, currentModel: getCurrentModel(), capabilityRouting: getCapabilityRouting(), capabilityPolicies: getCapabilityPolicies(), source: 'migrated' }
                  }
                }
              } catch (e) {
                console.error('[Frontend] 迁移 localStorage 数据失败:', e)
              }
            }
          }
        }
      } catch (e) {
        console.error('[Frontend] 从后端加载 API 配置失败:', e)
      }
    }

    const saved = localStorage.getItem('savedModels')
    if (saved) {
      try {
        const parsedModels = JSON.parse(saved)
          models = normalizeModelList(parsedModels)
      } catch (e) {
        console.error('[Frontend] 读取 localStorage 模型列表失败:', e)
        models = []
      }
    }

    const oldConfig = localStorage.getItem('apiConfig')
    if (oldConfig && models.length === 0) {
      try {
        const config = JSON.parse(oldConfig)
        if (config.modelName || config.apiUrl || config.apiKey) {
          models.push(normalizeModel(config))
          localStorage.setItem('savedModels', JSON.stringify(models))
          localStorage.removeItem('apiConfig')
        }
      } catch (e) {
        console.error('[Frontend] 迁移旧 API 配置失败:', e)
      }
    }

    const currentIdx = localStorage.getItem('currentModelIndex')
    if (currentIdx !== null) {
      currentIndex = normalizeIndex(parseInt(currentIdx, 10))
    } else if (models.length > 0) {
      currentIndex = 0
      await save()
    } else {
      currentIndex = -1
    }

    try {
      capabilityRouting = normalizeCapabilityRouting(JSON.parse(localStorage.getItem('capabilityRouting') || '{}'))
    } catch (e) {
      capabilityRouting = normalizeCapabilityRouting({})
    }
    try {
      capabilityPolicies = normalizeCapabilityPolicies(JSON.parse(localStorage.getItem('capabilityPolicies') || '{}'))
    } catch (e) {
      capabilityPolicies = normalizeCapabilityPolicies({})
    }

    return { models, currentIndex, currentModel: getCurrentModel(), capabilityRouting: getCapabilityRouting(), capabilityPolicies: getCapabilityPolicies(), source: 'localStorage' }
  }

  async function save() {
    models = models.map(normalizeModel)
    const currentModel = getCurrentModel()
    const currentModelKey = getModelKey(currentModel)
    const persistedCurrentIndex = currentModel
      ? models.findIndex(model => getModelKey(model) === currentModelKey)
      : -1
    const safePersistedIndex = persistedCurrentIndex >= 0
      ? persistedCurrentIndex
      : (models.length > 0 ? 0 : -1)
    capabilityRouting = normalizeCapabilityRouting(capabilityRouting)
    capabilityPolicies = normalizeCapabilityPolicies(capabilityPolicies)
    if (window.api?.saveApiConfig) {
      try {
        const result = await window.api.saveApiConfig({
          models,
          currentIndex: safePersistedIndex,
          currentModelKey,
          capabilityRouting,
          capabilityPolicies
        })
        if (result.success) {
          AppLogger.debug('[Frontend] API 配置已保存到后端')
          return
        }
      } catch (e) {
        console.error('[Frontend] 保存到后端失败:', e)
      }
    }

    localStorage.setItem('savedModels', JSON.stringify(models))
    localStorage.setItem('currentModelIndex', safePersistedIndex.toString())
    if (currentModelKey) localStorage.setItem('currentModelKey', currentModelKey)
    localStorage.setItem('capabilityRouting', JSON.stringify(capabilityRouting))
    localStorage.setItem('capabilityPolicies', JSON.stringify(capabilityPolicies))
  }

  function addModel(model) {
    models.push(normalizeModel({ ...model, modelKey: model?.modelKey || Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8) }))
    currentIndex = models.length - 1
    return getCurrentModel()
  }

  function updateModel(index, model) {
    if (!models[index]) return null
    const existingModel = models[index]
    const existingKey = existingModel.modelKey || getModelKey(existingModel)
    const reasoningEffort = model.reasoning_effort ?? model.reasoningEffort ?? existingModel.reasoning_effort ?? existingModel.reasoningEffort
    models[index] = normalizeModel({ ...model, modelKey: existingKey, reasoning_effort: reasoningEffort, reasoningEffort })
    currentIndex = index
    return getCurrentModel()
  }

  function removeModel(index) {
    if (!models[index]) return null
    const removed = models.splice(index, 1)[0]
    if (currentIndex === index) {
      currentIndex = models.length > 0 ? 0 : -1
    } else if (currentIndex > index) {
      currentIndex--
    }
    capabilityRouting = normalizeCapabilityRouting(capabilityRouting)
    return removed
  }

  function moveModel(fromIndex, toIndex) {
    if (!models[fromIndex] || fromIndex === toIndex || toIndex < 0 || toIndex >= models.length) {
      return false
    }

    const draggedModel = models[fromIndex]
    models.splice(fromIndex, 1)
    models.splice(toIndex, 0, draggedModel)

    if (currentIndex === fromIndex) {
      currentIndex = toIndex
    } else if (currentIndex > fromIndex && currentIndex <= toIndex) {
      currentIndex--
    } else if (currentIndex < fromIndex && currentIndex >= toIndex) {
      currentIndex++
    }

    return true
  }

  function setModelReasoningEffort(index, value) {
    const normalizedIndex = normalizeIndex(index)
    if (normalizedIndex < 0 || !models[normalizedIndex]) return null
    const reasoningEffort = normalizeReasoningEffort(value)
    models[normalizedIndex] = normalizeModel({
      ...models[normalizedIndex],
      reasoning_effort: reasoningEffort,
      reasoningEffort
    })
    return models[normalizedIndex]
  }

  window.ModelStore = {
    getModels,
    getModelsForCapability,
    getCapabilityRouting,
    getRoutedModelsForCapability,
    setCapabilityRouting,
    getCapabilityPolicies,
    setCapabilityPolicies,
    moveCapabilityModel,
    getCurrentIndex,
    getCurrentModel,
    getModelKey,
    getModelAt,
    findModelIndexByKey,
    resolveModelIndex,
    resolveModel,
    setCurrentIndex,
    load,
    save,
    addModel,
    updateModel,
    removeModel,
    moveModel,
    setModelReasoningEffort,
    capabilityDefinitions,
    reasoningEffortDefinitions,
    normalizeReasoningEffort,
    normalizeCapabilities,
    normalizeModel,
    hasCapability,
    getCapabilityLabels,
    findModelWithCapability
  }
})()
