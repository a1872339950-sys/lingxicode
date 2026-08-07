(function () {
  function noop() {}

  function removeLegacyAgentPanels() {
    document.getElementById('subAgentStatus')?.remove()
    document.getElementById('agentDetailPopup')?.remove()
    document.getElementById('agentModeBtn')?.remove()
  }

  // 旧右侧多会话窗口已下线；同项目多会话走侧栏新开会话，临时多 AI 走协作画布。
  window.AgentUI = {
    init: removeLegacyAgentPanels,
    isEnabled: () => false,
    setActiveProject: noop,
    clearProjectAgents: removeLegacyAgentPanels,
    refreshPanel: noop,
    hidePanel: removeLegacyAgentPanels,
    showPanel: noop
  }
})()
