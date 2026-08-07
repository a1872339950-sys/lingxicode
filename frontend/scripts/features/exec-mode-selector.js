(function () {
  function bind(options = {}) {
    const execModeTrigger = options.execModeTrigger
    const execModeMenu = options.execModeMenu
    const execModeIcon = options.execModeIcon
    const execModeCurrent = options.execModeCurrent
    const contextPanel = options.contextPanel
    const getExecutionMode = options.getExecutionMode || function () { return 'ask' }
    const setExecutionMode = options.setExecutionMode || function () {}
    const showToast = options.showToast || function () {}

    if (!execModeTrigger || !execModeMenu) return

    // ===== 授权模式选择器（与设置页 AI 授权同步） =====
    execModeTrigger.onclick = (e) => {
      e.stopPropagation()
      execModeMenu.classList.toggle('show')
    }

    execModeMenu.querySelectorAll('.exec-mode-option').forEach(option => {
      option.onclick = async () => {
        const value = option.dataset.value  // 'ask' | 'smart' | 'full'
        // 同步到后端 path-permissions（持久化 + 设置页同步）
        try {
          const result = await window.api?.setPathPermissionMode?.(value)
          if (!result?.success) {
            showToast('授权模式切换失败', 'error')
            return
          }
        } catch (err) {
          showToast('授权模式切换失败: ' + (err?.message || err), 'error')
          return
        }
        setExecutionMode(value)
        // 更新图标（复制选中选项的SVG）
        const selectedIcon = option.querySelector('.option-icon svg')
        if (selectedIcon) {
          execModeIcon.innerHTML = selectedIcon.outerHTML
        }
        execModeCurrent.textContent = option.querySelector('.option-name').textContent
        execModeMenu.querySelectorAll('.exec-mode-option').forEach(o => o.classList.remove('selected'))
        option.classList.add('selected')
        // 完整授权时 trigger 显示红色警示
        execModeTrigger.classList.toggle('mode-full', value === 'full')
        execModeMenu.classList.remove('show')
        showToast(value === 'full' ? '已切换为完整授权' : value === 'smart' ? '已切换为智能授权' : '已切换为询问授权', 'success')
      }
    })

    document.addEventListener('click', event => {
      execModeMenu.classList.remove('show')
      // 点击其他区域关闭上下文面板
      if (contextPanel && !contextPanel.contains(event.target)) {
        contextPanel.classList.remove('show')
      }
    })

    // ===== 初始化：从后端读取当前授权模式，同步下拉显示 =====
    async function syncFromBackend() {
      try {
        const result = await window.api?.getPathPermissions?.()
        if (!result?.success) return
        const mode = ['ask', 'smart', 'full'].includes(result.mode) ? result.mode : 'ask'
        setExecutionMode(mode)
        const option = execModeMenu.querySelector(`.exec-mode-option[data-value="${mode}"]`)
        if (!option) return
        const selectedIcon = option.querySelector('.option-icon svg')
        if (selectedIcon) execModeIcon.innerHTML = selectedIcon.outerHTML
        execModeCurrent.textContent = option.querySelector('.option-name').textContent
        execModeMenu.querySelectorAll('.exec-mode-option').forEach(o => o.classList.remove('selected'))
        option.classList.add('selected')
        execModeTrigger.classList.toggle('mode-full', mode === 'full')
      } catch (err) {}
    }
    syncFromBackend()
  }

  window.ExecModeSelector = { bind }
})()
