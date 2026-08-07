(function () {
  function bind(options = {}) {
    const modelStore = options.modelStore
    const getModels = options.getModels || function () { return [] }
    const getCurrentIndex = options.getCurrentIndex || function () { return -1 }
    const getCurrentConfig = options.getCurrentConfig || function () { return {} }
    const syncModelState = options.syncModelState || function () {}
    const getActiveProject = options.getActiveProject || function () { return null }
    const getProjectModelIndex = options.getProjectModelIndex || function () { return -1 }
    const setProjectModel = options.setProjectModel || function () {}
    const getEditingIndex = options.getEditingIndex || function () { return -1 }
    const setEditingIndex = options.setEditingIndex || function () {}
    const settingsPanelUI = options.settingsPanelUI
    const saveProjectsList = options.saveProjectsList || async function () {}

    const quickModelSettings = window.QuickModelSettings?.bind({
      modelStore,
      getModels,
      getCurrentIndex,
      getCurrentConfig,
      syncModelState,
      saveModelsToStorage,
      getActiveProject,
      getProjectModelIndex,
      setProjectModel,
      getEditingIndex,
      setEditingIndex,
      settingsPanelUI,
      openModelEditorModal: options.openModelEditorModal
    })

    function fillQuickModelForm(model) {
      return quickModelSettings?.fillQuickModelForm(model)
    }

    function switchSettingsTab(tab) {
      return quickModelSettings?.switchSettingsTab(tab)
    }

    function renderModelList() {
      return quickModelSettings?.renderModelList()
    }

    function renderModelSelect() {
      return quickModelSettings?.renderModelSelect()
    }

    function useModel(index, silent = false) {
      return quickModelSettings?.useModel(index, silent)
    }

    function editModel(index) {
      return quickModelSettings?.editModel(index)
    }

    function deleteModel(index) {
      return quickModelSettings?.deleteModel(index)
    }

    function saveModel() {
      return quickModelSettings?.saveModel()
    }

    function setupModelDragSort() {
      return quickModelSettings?.setupModelDragSort()
    }

    // 加载配置（从后端文件加载，支持迁移）
    async function loadConfig() {
      await modelStore.load()
      syncModelState()
      fillQuickModelForm(getCurrentConfig())
    }

    // 保存模型列表到后端（异步）
    async function saveModelsToStorage() {
      syncModelState()
      await modelStore.save()
      await saveProjectsList()
    }

    return {
      quickModelSettings,
      fillQuickModelForm,
      switchSettingsTab,
      renderModelList,
      renderModelSelect,
      useModel,
      editModel,
      deleteModel,
      saveModel,
      setupModelDragSort,
      loadConfig,
      saveModelsToStorage
    }
  }

  window.ModelSettingsProxy = { bind }
})()
