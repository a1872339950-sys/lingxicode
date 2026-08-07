/**
 * 桌面操控设置：总开关、状态条、Esc 中断、始终允许列表
 * 设置 → 个性化 → 桌面操控
 */
(function () {
  let liveBanner = null
  let liveHideTimer = null
  let liveElapsedTimer = null
  let latestLiveStatus = null

  function ensureLiveBanner() {
    if (liveBanner?.isConnected) return liveBanner
    liveBanner = document.createElement('section')
    liveBanner.id = 'desktopControlLiveStatus'
    liveBanner.className = 'desktop-control-live-status'
    liveBanner.hidden = true
    liveBanner.setAttribute('role', 'status')
    liveBanner.setAttribute('aria-live', 'polite')
    liveBanner.innerHTML = `
      <span class="desktop-control-live-indicator" aria-hidden="true"></span>
      <div class="desktop-control-live-copy">
        <div class="desktop-control-live-kicker">桌面操控</div>
        <div class="desktop-control-live-action"></div>
        <div class="desktop-control-live-meta"></div>
      </div>
      <button type="button" class="desktop-control-live-stop" title="立即停止桌面操控">停止</button>
    `
    liveBanner.querySelector('.desktop-control-live-stop')?.addEventListener('click', async () => {
      if (!window.api?.interruptDesktopControl) return
      const button = liveBanner.querySelector('.desktop-control-live-stop')
      if (button) button.disabled = true
      try {
        await window.api.interruptDesktopControl()
        toast('已停止桌面操控', 'info')
      } catch (error) {
        toast(error?.message || '停止桌面操控失败', 'error')
        if (button) button.disabled = false
      }
    })
    document.body.appendChild(liveBanner)
    return liveBanner
  }

  function formatElapsed(ms = 0) {
    const seconds = Math.max(0, Math.floor(Number(ms) / 1000))
    if (seconds < 60) return `${seconds} 秒`
    return `${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒`
  }

  function updateLiveElapsed() {
    if (!liveBanner || liveBanner.hidden || !latestLiveStatus) return
    const meta = liveBanner.querySelector('.desktop-control-live-meta')
    if (!meta) return
    const target = String(latestLiveStatus.lastTargetLabel || '').trim()
    const baseElapsed = Number(latestLiveStatus.elapsedMs || 0)
    const since = latestLiveStatus.active && latestLiveStatus.lastActivityAt
      ? Math.max(0, Date.now() - Number(latestLiveStatus.lastActivityAt))
      : 0
    const parts = []
    if (target) parts.push(target)
    if (latestLiveStatus.active) parts.push(`已持续 ${formatElapsed(baseElapsed + since)}`)
    else if (latestLiveStatus.phase === 'completed') parts.push('已完成')
    else if (latestLiveStatus.phase === 'error') parts.push('执行失败')
    else if (latestLiveStatus.phase === 'interrupted') parts.push('已停止')
    meta.textContent = parts.join(' · ')
  }

  function scheduleLiveHide(delay) {
    if (liveHideTimer) clearTimeout(liveHideTimer)
    liveHideTimer = setTimeout(() => {
      if (liveBanner) liveBanner.hidden = true
    }, delay)
  }

  function renderLiveStatus(status = {}) {
    latestLiveStatus = status
    const banner = ensureLiveBanner()
    if (!status.enabled && status.phase !== 'interrupted') {
      banner.hidden = true
      return
    }
    if (status.idle || status.ended || status.phase === 'idle') {
      if (status.kind !== 'settings_changed') scheduleLiveHide(120)
      return
    }

    if (liveHideTimer) {
      clearTimeout(liveHideTimer)
      liveHideTimer = null
    }
    const phase = String(status.phase || (status.active ? 'working' : 'idle'))
    banner.dataset.phase = phase
    banner.hidden = false
    const action = banner.querySelector('.desktop-control-live-action')
    const stop = banner.querySelector('.desktop-control-live-stop')
    if (action) {
      if (phase === 'completed') action.textContent = '操作完成'
      else if (phase === 'error') action.textContent = status.lastError || '桌面操作失败'
      else if (phase === 'interrupted') action.textContent = '桌面操控已停止'
      else action.textContent = status.lastActionLabel || '正在执行桌面操作'
    }
    if (stop) {
      stop.hidden = !['working', 'observing', 'acting'].includes(phase)
      stop.disabled = false
    }
    updateLiveElapsed()
    if (phase === 'completed') scheduleLiveHide(3200)
    else if (phase === 'error' || phase === 'interrupted') scheduleLiveHide(7000)
  }

  function toast(msg, type) {
    if (window.ToastUI?.show) window.ToastUI.show(msg, type || 'info')
  }

  function basename(p = '') {
    const s = String(p || '')
    const parts = s.replace(/^process:/i, '').split(/[/\\]/)
    return parts[parts.length - 1] || s
  }

  async function loadAndApply() {
    if (!window.api?.getDesktopControlSettings) return
    const res = await window.api.getDesktopControlSettings()
    const cfg = res?.data || {}
    const status = res?.status || {}
    const enabledEl = document.getElementById('desktopControlEnabled')
    const overlayEl = document.getElementById('desktopControlShowOverlay')
    const escEl = document.getElementById('desktopControlEscCancel')
    const statusEl = document.getElementById('desktopControlStatus')
    const listEl = document.getElementById('desktopControlAllowlist')

    if (enabledEl) enabledEl.checked = cfg.enabled === true
    if (overlayEl) overlayEl.checked = cfg.showOverlay !== false
    if (escEl) escEl.checked = cfg.escToCancel !== false

    if (statusEl) {
      const parts = []
      parts.push(cfg.enabled === true ? '已开启' : '已关闭')
      if (status.active) parts.push('当前正在操控')
      if (status.interrupted) parts.push('已中断（Esc）')
      if (status.lastTargetLabel) parts.push('目标：' + status.lastTargetLabel)
      if (status.lastActionLabel && status.phase !== 'idle') parts.push(status.lastActionLabel)
      statusEl.textContent = '桌面操控：' + parts.join(' · ')
    }

    if (listEl) {
      const apps = Array.isArray(cfg.alwaysAllowedApps) ? cfg.alwaysAllowedApps : []
      if (!apps.length) {
        listEl.textContent = '始终允许的应用：无（首次操控时会询问）'
      } else {
        listEl.textContent = '始终允许的应用：' + apps.map(basename).join('、')
      }
    }
  }

  async function savePartial(partial) {
    if (!window.api?.saveDesktopControlSettings) return
    const res = await window.api.saveDesktopControlSettings(partial)
    if (!res?.success) {
      toast(res?.error || '保存桌面操控设置失败', 'error')
      return
    }
    await loadAndApply()
    // 与「能力开关」页总开关保持同步
    if (Object.prototype.hasOwnProperty.call(partial || {}, 'enabled')) {
      try {
        window.dispatchEvent(new CustomEvent('lingxi-desktop-control-settings-changed', {
          detail: { enabled: !!partial.enabled }
        }))
        window.FeatureSettingsUI?.reload?.()
      } catch (_) { /* ignore */ }
    }
  }

  function bind() {
    if (!document.getElementById('desktopControlEnabled')) return

    const enabledEl = document.getElementById('desktopControlEnabled')
    const overlayEl = document.getElementById('desktopControlShowOverlay')
    const escEl = document.getElementById('desktopControlEscCancel')
    const clearBtn = document.getElementById('desktopControlClearAllowlistBtn')
    const stopBtn = document.getElementById('desktopControlInterruptBtn')

    enabledEl?.addEventListener('change', async () => {
      await savePartial({ enabled: !!enabledEl.checked })
      toast(enabledEl.checked ? '已允许 AI 操控电脑' : '已关闭 AI 桌面操控', 'success')
    })
    overlayEl?.addEventListener('change', async () => {
      await savePartial({ showOverlay: !!overlayEl.checked })
    })
    escEl?.addEventListener('change', async () => {
      await savePartial({ escToCancel: !!escEl.checked })
    })
    clearBtn?.addEventListener('click', async () => {
      if (!window.api?.clearDesktopControlAllowlist) return
      await window.api.clearDesktopControlAllowlist()
      toast('已清空始终允许的应用列表', 'success')
      await loadAndApply()
    })
    stopBtn?.addEventListener('click', async () => {
      if (!window.api?.interruptDesktopControl) return
      await window.api.interruptDesktopControl()
      toast('已请求停止桌面操控', 'info')
      await loadAndApply()
    })

    // 打开个性化页时刷新
    document.getElementById('settingsTabTheme')?.addEventListener('click', () => {
      setTimeout(loadAndApply, 50)
    })

    if (!window.__lingxiDesktopControlActivityBound && window.api?.onDesktopControlActivity) {
      window.__lingxiDesktopControlActivityBound = true
      window.api.onDesktopControlActivity(status => {
        renderLiveStatus(status || {})
        const statusEl = document.getElementById('desktopControlStatus')
        if (statusEl && status?.kind !== 'settings_changed') {
          const parts = [status.enabled ? '已开启' : '已关闭']
          if (status.active) parts.push('当前正在操控')
          if (status.interrupted) parts.push('已中断')
          if (status.lastActionLabel && status.phase !== 'idle') parts.push(status.lastActionLabel)
          if (status.lastTargetLabel) parts.push('目标：' + status.lastTargetLabel)
          statusEl.textContent = '桌面操控：' + parts.join(' · ')
        }
      })
      liveElapsedTimer = setInterval(updateLiveElapsed, 1000)
    }

    loadAndApply()
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bind)
  } else {
    bind()
  }

  window.DesktopControlSettings = { reload: loadAndApply, renderLiveStatus }
})()
