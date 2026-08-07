(function () {
  const PANEL_IDS = {
    archive: 'archivePanel',
    git: 'gitPanel',
    gitBranch: 'gitBranchPanel',
    gitHistory: 'gitHistoryPanel',
    integration: 'integrationPanel',
    localApps: 'localAppsPanel',
    remoteBridge: 'remoteBridgePanel',
    settings: 'settingsMainPanel',
    skill: 'skillPanel'
  }

  const MAIN_PANEL_KEYS = Object.keys(PANEL_IDS)

  function getPanelId(panel) {
    return PANEL_IDS[panel] || panel
  }

  function getPanel(panel) {
    if (!panel) return null
    if (panel instanceof Element) return panel
    return document.getElementById(getPanelId(panel))
  }

  function open(panel) {
    const element = getPanel(panel)
    if (!element) return false
    element.classList.add('show')
    return true
  }

  function close(panel) {
    const element = getPanel(panel)
    if (!element) return false
    element.classList.remove('show')
    return true
  }

  function isOpen(panel) {
    return !!getPanel(panel)?.classList.contains('show')
  }

  function closeMany(panels) {
    panels.forEach(close)
  }

  function closePeers(except, panels = Object.keys(PANEL_IDS)) {
    const exceptId = getPanelId(except)
    panels.forEach(panel => {
      const panelId = getPanelId(panel)
      if (panelId !== exceptId) close(panelId)
    })
  }

  function ensureChatVisible(options = {}) {
    if (options.hideChat) return
    window.closeCanvasView?.()
    const chatMessages = document.getElementById('chatMessages')
    if (chatMessages) chatMessages.style.display = 'block'
  }

  function openExclusive(panel, options = {}) {
    const panelId = getPanelId(panel)
    const element = getPanel(panelId)
    if (!element) return false
    closePeers(panelId, options.panels || MAIN_PANEL_KEYS)
    ensureChatVisible(options)
    element.classList.add('show')
    return true
  }

  window.LingxiPanelManager = {
    ids: PANEL_IDS,
    getPanel,
    open,
    openExclusive,
    close,
    closeMany,
    closePeers,
    isOpen
  }

  // Escape 键关闭所有打开的面板，返回聊天区域
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return
    // 跳过输入框、弹窗等内部 Escape 用途
    const tag = (e.target.tagName || '').toLowerCase()
    const isInput = tag === 'input' || tag === 'textarea' || tag === 'select' || e.target.isContentEditable
    if (isInput) return
    const anyOpen = Object.values(PANEL_IDS).some(id => {
      const el = document.getElementById(id)
      return el?.classList.contains('show')
    })
    if (!anyOpen) return
    e.preventDefault()
    closeMany(Object.keys(PANEL_IDS))
    window.ProjectSwitcher?.returnToChatArea?.()
  })
})()
