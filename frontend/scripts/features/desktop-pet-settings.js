/**
 * 桌宠设置：开关、角色选择、大小、显示/隐藏
 * 设置 → 个性化 → 界面显示 → 桌宠
 */
(function () {
  let sizeSaveTimer = null

  function toast(msg, type) {
    if (window.ToastUI?.show) window.ToastUI.show(msg, type || 'info')
  }

  function getProjectPath() {
    try {
      return window.ProjectSwitcher?.getActiveProject?.()?.path
        || window.getActiveProject?.()?.path
        || ''
    } catch {
      return ''
    }
  }

  function sourceLabel(source) {
    if (source === 'project') return '项目'
    if (source === 'lingxi-data') return '灵犀'
    return '本地'
  }

  function clampSize(n) {
    const v = Number(n)
    if (!Number.isFinite(v)) return 112
    return Math.round(Math.min(224, Math.max(80, v)))
  }

  function syncSizeUi(px) {
    const sizeEl = document.getElementById('desktopPetSize')
    const valueEl = document.getElementById('desktopPetSizeValue')
    const w = clampSize(px)
    if (sizeEl) sizeEl.value = String(w)
    if (valueEl) valueEl.textContent = w + 'px'
  }

  async function refreshCharacterList(selectedPath) {
    const select = document.getElementById('desktopPetCharacter')
    if (!select || !window.api?.listDesktopPetCharacters) return
    const res = await window.api.listDesktopPetCharacters(getProjectPath())
    const list = res?.characters || []
    select.innerHTML = ''
    if (!list.length) {
      const opt = document.createElement('option')
      opt.value = ''
      opt.textContent = '（暂无角色，请用角色动画插件制作）'
      select.appendChild(opt)
      return
    }
    for (const c of list) {
      const opt = document.createElement('option')
      opt.value = c.path
      opt.textContent = `${c.displayName || c.id} · ${sourceLabel(c.source)}`
      opt.dataset.id = c.id
      select.appendChild(opt)
    }
    if (selectedPath) {
      select.value = selectedPath
      if (select.value !== selectedPath) {
        const hit = list.find(c => c.path === selectedPath || selectedPath.endsWith(c.id))
        if (hit) select.value = hit.path
      }
    }
  }

  async function loadAndApply() {
    if (!window.api?.getDesktopPetConfig) return
    const res = await window.api.getDesktopPetConfig()
    const cfg = res?.data || {}
    const enabledEl = document.getElementById('desktopPetEnabled')
    const followEl = document.getElementById('desktopPetFollowAi')
    const statusEl = document.getElementById('desktopPetStatus')
    if (enabledEl) enabledEl.checked = !!cfg.enabled
    if (followEl) followEl.checked = cfg.followAiStatus !== false
    syncSizeUi(cfg.mascotWidthPx != null ? cfg.mascotWidthPx : (cfg.scale ? cfg.scale * 192 : 112))
    await refreshCharacterList(cfg.characterPath || '')
    if (statusEl) {
      const size = clampSize(cfg.mascotWidthPx != null ? cfg.mascotWidthPx : 112)
      statusEl.textContent = cfg.enabled
        ? `桌宠已启用${cfg.characterId ? ' · ' + cfg.characterId : ''} · ${size}px · 跟随状态：${cfg.followAiStatus !== false ? '开' : '关'}`
        : '桌宠未启用。开启后右下角悬浮显示；AI 忙碌时在角色上方显示状态托盘。'
    }
  }

  function scheduleSaveSize(value) {
    const w = clampSize(value)
    syncSizeUi(w)
    if (sizeSaveTimer) clearTimeout(sizeSaveTimer)
    sizeSaveTimer = setTimeout(async () => {
      sizeSaveTimer = null
      if (!window.api?.setDesktopPetConfig) return
      await window.api.setDesktopPetConfig({ mascotWidthPx: w })
      loadAndApply()
    }, 180)
  }

  function bind() {
    const enabledEl = document.getElementById('desktopPetEnabled')
    const followEl = document.getElementById('desktopPetFollowAi')
    const select = document.getElementById('desktopPetCharacter')
    const sizeEl = document.getElementById('desktopPetSize')
    const showBtn = document.getElementById('desktopPetShowBtn')
    const hideBtn = document.getElementById('desktopPetHideBtn')
    const refreshBtn = document.getElementById('desktopPetRefreshBtn')
    if (!enabledEl || enabledEl.__petBound) return
    enabledEl.__petBound = true

    enabledEl.addEventListener('change', async () => {
      if (!window.api?.setDesktopPetEnabled) return
      const result = await window.api.setDesktopPetEnabled(enabledEl.checked, {
        projectPath: getProjectPath()
      })
      if (result?.success === false) {
        toast(result.message || '桌宠操作失败', 'error')
        enabledEl.checked = !enabledEl.checked
      } else {
        toast(result?.message || (enabledEl.checked ? '桌宠已开启' : '桌宠已关闭'), 'success')
      }
      loadAndApply()
    })

    followEl?.addEventListener('change', async () => {
      if (!window.api?.setDesktopPetConfig) return
      await window.api.setDesktopPetConfig({ followAiStatus: !!followEl.checked })
      loadAndApply()
    })

    sizeEl?.addEventListener('input', () => {
      scheduleSaveSize(sizeEl.value)
    })

    select?.addEventListener('change', async () => {
      if (!select.value || !window.api?.selectDesktopPetCharacter) return
      const result = await window.api.selectDesktopPetCharacter(select.value, getProjectPath())
      if (result?.success === false) toast(result.message || '选择失败', 'error')
      else toast(result?.message || '已切换角色', 'success')
      loadAndApply()
    })

    showBtn?.addEventListener('click', async () => {
      if (!window.api?.showDesktopPet) return
      const result = await window.api.showDesktopPet({ projectPath: getProjectPath() })
      if (result?.success === false) toast(result.message || '显示失败', 'error')
      else {
        const en = document.getElementById('desktopPetEnabled')
        if (en) en.checked = true
        toast(result?.message || '桌宠已显示', 'success')
      }
      loadAndApply()
    })

    hideBtn?.addEventListener('click', async () => {
      if (!window.api?.hideDesktopPet) return
      await window.api.hideDesktopPet(false)
      toast('桌宠已隐藏（设置里仍可保持启用，下次启动会恢复）', 'info')
      loadAndApply()
    })

    refreshBtn?.addEventListener('click', async () => {
      await loadAndApply()
      toast('角色列表已刷新', 'info')
    })
  }

  function init() {
    if (!document.getElementById('desktopPetEnabled')) return
    bind()
    loadAndApply()
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init)
  } else {
    init()
  }

  document.addEventListener('click', (e) => {
    if (e.target?.closest?.('#btnSettings, #sidebarSettingsOpenBtn, #settingsTabTheme')) {
      setTimeout(loadAndApply, 80)
    }
  })

  window.DesktopPetSettings = { refresh: loadAndApply }
})()
