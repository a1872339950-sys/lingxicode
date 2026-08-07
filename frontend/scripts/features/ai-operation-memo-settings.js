(function () {
  function bind(options = {}) {
    const checkbox = document.getElementById('settingsAiMemoAutoSave')
    const status = document.getElementById('settingsAiMemoStatus')
    const showToast = options.showToast || window.showToast

    function setStatus(message = '', type = '') {
      if (!status) return
      status.textContent = message
      status.className = `worker-model-status ${type}`.trim()
    }

    async function load() {
      if (!checkbox || !window.api?.getAiOperationMemoSettings) return
      const result = await window.api.getAiOperationMemoSettings()
      if (!result?.success) {
        setStatus(result?.error || 'AI 操作备忘录设置读取失败', 'error')
        return
      }
      checkbox.checked = !!result.data?.autoSave
      setStatus('', '')
    }

    async function save() {
      if (!checkbox || !window.api?.saveAiOperationMemoSettings) return
      const result = await window.api.saveAiOperationMemoSettings({ autoSave: !!checkbox.checked })
      if (!result?.success) {
        setStatus(result?.error || 'AI 操作备忘录设置保存失败', 'error')
        showToast?.('AI 操作备忘录设置保存失败', 'error')
        return
      }
      setStatus(checkbox.checked ? '已启用自动保存。' : '已关闭自动保存，每次会询问是否保存。', 'success')
    }

    checkbox?.addEventListener('change', save)
    load()

    return { load }
  }

  window.AiOperationMemoSettings = { bind }
})()
