(function () {
  const escapeHtml = HtmlUtils.escapeHtml

  function bind(options = {}) {
    const showToast = options.showToast || function () {}
    const getModels = options.getModels || function () { return [] }
    const modelStore = options.modelStore || null
    const els = {
      enabled: document.getElementById('workerModelEnabled'),
      localEnabled: document.getElementById('workerModelLocalEnabled'),
      apiUrl: document.getElementById('workerModelApiUrl'),
      model: document.getElementById('workerModelName'),
      keepAlive: document.getElementById('workerModelKeepAlive'),
      cloudEnabled: document.getElementById('workerModelCloudEnabled'),
      cloudModel: document.getElementById('workerModelCloudModel'),
      ledgerTask: document.getElementById('workerModelTaskLedger'),
      memoryTask: document.getElementById('workerModelTaskMemory'),
      codeMapTask: document.getElementById('workerModelTaskCodeMap'),
      codeMapModel: document.getElementById('workerModelCodeMapModel'),
      status: document.getElementById('workerModelStatus'),
      saveButton: document.getElementById('workerModelSaveBtn'),
      testButton: document.getElementById('workerModelTestBtn'),
      cloudTestButton: document.getElementById('workerModelCloudTestBtn'),
      nav: document.getElementById('workerModelNav'),
      navChainTag: document.getElementById('workerNavChainTag'),
      navChainMeta: document.getElementById('workerNavChainMeta')
    }

    function getModelLabel(model, index) {
      const name = model.modelName || model.modelId || `Model ${index + 1}`
      const apiUrl = String(model.apiUrl || '').trim()
      if (!apiUrl) return name
      try { return `${name} · ${new URL(apiUrl).host}` } catch (_) { return `${name} · ${apiUrl}` }
    }

    function renderCodeMapModels(selectedKey = '') {
      if (!els.codeMapModel) return
      const models = getModels()
      const options = ['<option value="">不使用路线整理模型</option>']
      models.forEach((model, index) => {
        const key = String(model.modelKey || modelStore?.getModelKey?.(model) || '').trim()
        if (!key) return
        options.push(`<option value="${escapeHtml(key)}">${escapeHtml(getModelLabel(model, index))}</option>`)
      })
      els.codeMapModel.innerHTML = options.join('')
      els.codeMapModel.value = models.some(model => String(model.modelKey || modelStore?.getModelKey?.(model) || '') === selectedKey) ? selectedKey : ''
    }

    function renderCloudModels(selectedKey = '') {
      if (!els.cloudModel) return
      const models = getModels()
      const options = ['<option value="">不使用云端兜底</option>']
      models.forEach((model, index) => {
        const key = String(model.modelKey || modelStore?.getModelKey?.(model) || '').trim()
        if (!key) return
        options.push(`<option value="${escapeHtml(key)}">${escapeHtml(getModelLabel(model, index))}</option>`)
      })
    els.nav?.querySelectorAll('[data-worker-panel]').forEach(button => {
      button.onclick = () => setActivePanel(button.dataset.workerPanel || 'chain')
    })
      els.cloudModel.innerHTML = options.join('')
      els.cloudModel.value = models.some(model => String(model.modelKey || modelStore?.getModelKey?.(model) || '') === selectedKey) ? selectedKey : ''
    }

    function readConfig() {
      return {
        enabled: !!els.enabled?.checked,
        timeoutMs: 90000,
        local: {
          enabled: !!els.localEnabled?.checked,
          provider: 'ollama',
          apiUrl: els.apiUrl?.value?.trim() || 'http://127.0.0.1:11434',
          model: els.model?.value?.trim() || 'gemma4:e4b',
          keepAlive: els.keepAlive?.value?.trim() || '30s'
        },
        cloud: {
          enabled: !!els.cloudEnabled?.checked,
          modelKey: els.cloudModel?.value || ''
        },
        codeMap: {
          enabled: !!els.codeMapTask?.checked,
          modelKey: els.codeMapModel?.value || '',
          requireUserConfirm: true
        },
        tasks: {
          ledger: !!els.ledgerTask?.checked,
          memory: !!els.memoryTask?.checked,
          summary: true,
          codeMap: !!els.codeMapTask?.checked
        }
      }
    }

    function setActivePanel(panel = 'chain') {
      els.nav?.querySelectorAll('[data-worker-panel]').forEach(button => {
        button.classList.toggle('active', button.dataset.workerPanel === panel)
      })
      document.querySelectorAll('#settingsContentWorker [data-worker-panel-body]').forEach(element => {
        element.classList.toggle('active', element.dataset.workerPanelBody === panel)
      })
    }

    function writeConfig(config = {}) {
      if (els.enabled) els.enabled.checked = config.enabled !== false
      if (els.localEnabled) els.localEnabled.checked = config.local?.enabled !== false
      if (els.apiUrl) els.apiUrl.value = config.local?.apiUrl || 'http://127.0.0.1:11434'
      if (els.model) els.model.value = config.local?.model || 'gemma4:e4b'
      if (els.keepAlive) els.keepAlive.value = config.local?.keepAlive || '30s'
      if (els.cloudEnabled) els.cloudEnabled.checked = config.cloud?.enabled !== false
      renderCloudModels(config.cloud?.modelKey || '')
      renderCodeMapModels(config.codeMap?.modelKey || '')
      if (els.ledgerTask) els.ledgerTask.checked = config.tasks?.ledger !== false
      if (els.memoryTask) els.memoryTask.checked = !!config.tasks?.memory
      if (els.codeMapTask) els.codeMapTask.checked = config.tasks?.codeMap !== false
      setActivePanel('chain')
    refreshUiState()
    }

    function refreshUiState() {
      const config = readConfig()
      const cloudActive = config.cloud.enabled && config.cloud.modelKey
      if (els.navChainTag) els.navChainTag.textContent = ['本地', cloudActive ? '云端' : '', '规则'].filter(Boolean).join('→')
      if (els.navChainMeta) {
        els.navChainMeta.textContent = cloudActive
          ? `优先 ${config.local.model || '本地'}，失败后云端兜底`
          : `优先 ${config.local.model || '本地'}，失败后规则整理`
      }
    }

    function setStatus(text, type = '') {
      if (!els.status) return
      els.status.textContent = text || ''
      els.status.className = `worker-model-status ${type}`.trim()
      els.status.hidden = !text
    }

    async function load() {
      if (!window.api?.getWorkerModelConfig) return
      const result = await window.api.getWorkerModelConfig()
      if (result?.success) writeConfig(result.data || {})
      else if (result?.error) setStatus(result.error, 'error')
    }

    async function save() {
      if (!window.api?.saveWorkerModelConfig) return showToast('当前版本不支持保存后台整理模型配置', 'error')
      const result = await window.api.saveWorkerModelConfig(readConfig())
      if (!result?.success) {
        setStatus(result?.error || '保存失败', 'error')
        return showToast(result?.error || '保存失败', 'error')
      }
      writeConfig(result.data || readConfig())
      setStatus('后台整理模型配置已保存', 'success')
      showToast('后台整理模型配置已保存', 'success')
    }

    async function test(target) {
      if (!window.api?.testWorkerModel) return showToast('当前版本不支持测试后台整理模型', 'error')
      const label = target === 'cloud' ? '云端整理模型' : '本地整理模型'
      setStatus(`正在测试${label}...`, 'loading')
      const result = await window.api.testWorkerModel(readConfig(), { target })
      if (result?.success) {
        setStatus(`${label}连接成功：${result.model || ''}`, 'success')
        showToast(`${label}连接成功`, 'success')
      } else {
        setStatus(`${label}连接失败：${result?.error || '未知错误'}`, 'error')
        showToast(`${label}连接失败`, 'error')
      }
    }

    ;[els.enabled, els.localEnabled, els.apiUrl, els.model, els.keepAlive, els.cloudEnabled, els.cloudModel, els.ledgerTask, els.memoryTask, els.codeMapTask, els.codeMapModel].forEach(field => {
      field?.addEventListener('change', refreshUiState)
      field?.addEventListener('input', refreshUiState)
    })
    if (els.saveButton) els.saveButton.onclick = save
    if (els.testButton) els.testButton.onclick = () => test('local')
    if (els.cloudTestButton) els.cloudTestButton.onclick = () => test('cloud')

    refreshUiState()
    return { load, renderCloudModels }
  }

  window.WorkerModelSettings = { bind }
})()
