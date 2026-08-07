/**
 * 浏览器设置页面
 * 管理浏览器导入登录的 Cookie，支持清除、查看和追加导入
 */
(function () {
  function showToast(msg, type) {
    if (window.ToastUI?.show) window.ToastUI.show(msg, type || 'info')
  }

  async function loadBrowserImportStatus() {
    const statusEl = document.getElementById('browserImportStatus')
    if (!statusEl) return
    try {
      // 检查当前导入的 Cookie 数量
      const result = await window.api?.listBrowserProfiles?.()
      const browsers = result?.browsers || []
      if (browsers.length) {
        const names = browsers.map(b => b.displayName || b.browserId).join('、')
        statusEl.textContent = `已发现 ${browsers.length} 个浏览器：${names}`
        statusEl.style.color = 'var(--color-success, #34d399)'
      } else {
        statusEl.textContent = '未发现可用的浏览器，请安装 Chrome、Edge、QQ浏览器或夸克浏览器。'
        statusEl.style.color = 'var(--color-warning, #fbbf24)'
      }
    } catch (e) {
      statusEl.textContent = '检查失败：' + (e.message || e)
      statusEl.style.color = 'var(--color-error, #f87171)'
    }
  }

  async function importCookies(mode) {
    const browsers = await window.api?.listBrowserProfiles?.()
    const browserList = browsers?.browsers || []
    if (!browserList.length) {
      showToast('未发现可用的浏览器', 'error')
      return
    }
    // 选择浏览器
    const choice = await pickBrowserProfile(browserList)
    if (!choice) return

    const modeText = mode === 'append' ? '追加导入' : '覆盖导入'
    showToast(`正在${modeText}：${choice.displayName}（${choice.profileLabel}）...`, 'info')

    try {
      const result = await window.api.importGoogleCookiesFromChrome({
        browserId: choice.browserId,
        profileName: choice.profileName,
        importMode: mode // 'append' 或 'overwrite'
      })
      if (result?.success) {
        showToast(`${modeText}成功：${result.imported} 条 Cookie`, 'success')
        // 刷新当前页面
        const webviews = document.querySelectorAll('webview')
        webviews.forEach(wv => { try { wv.reload?.() } catch (_) {} })
      } else {
        showToast(`${modeText}失败：${result?.error || '未知错误'}`, 'error')
      }
    } catch (e) {
      showToast(`${modeText}失败：${e.message}`, 'error')
    }
  }

  async function pickBrowserProfile(browsers) {
    return new Promise(resolve => {
      // 创建选择对话框
      const overlay = document.createElement('div')
      overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.6);z-index:9999;display:flex;align-items:center;justify-content:center;'
      const card = document.createElement('div')
      card.style.cssText = 'background:var(--color-surface, #1e293b);border-radius:12px;padding:24px;min-width:320px;max-width:420px;box-shadow:0 20px 60px rgba(0,0,0,0.4);'
      card.innerHTML = `
        <div style="font-size:16px;font-weight:600;color:var(--color-text, #f8fafc);margin-bottom:12px;">选择浏览器</div>
        <div style="font-size:13px;color:var(--color-muted, #94a3b8);margin-bottom:16px;">选择要导入 Cookie 的浏览器</div>
        <div id="browserSelectList" style="display:flex;flex-direction:column;gap:8px;margin-bottom:16px;"></div>
        <div style="display:flex;justify-content:flex-end;gap:8px;">
          <button id="browserSelectCancel" style="padding:8px 16px;border-radius:6px;border:1px solid var(--color-border, #334155);background:transparent;color:var(--color-text, #f8fafc);cursor:pointer;">取消</button>
        </div>
      `
      overlay.appendChild(card)
      document.body.appendChild(overlay)

      const list = card.querySelector('#browserSelectList')
      browsers.forEach(b => {
        const btn = document.createElement('button')
        btn.style.cssText = 'padding:10px 14px;border-radius:8px;border:1px solid var(--color-border, #334155);background:var(--color-surface-2, #0f172a);color:var(--color-text, #f8fafc);cursor:pointer;text-align:left;display:flex;align-items:center;gap:10px;transition:all 0.15s;'
        btn.innerHTML = `<span style="font-size:14px;">${b.displayName || b.browserId}</span><span style="font-size:12px;color:var(--color-muted, #94a3b8);margin-left:auto;">${b.profiles?.[0]?.label || 'Default'}</span>`
        btn.onmouseenter = () => { btn.style.borderColor = 'var(--color-primary, #6366f1)'; btn.style.background = 'var(--color-primary-soft, rgba(99,102,241,0.1))' }
        btn.onmouseleave = () => { btn.style.borderColor = 'var(--color-border, #334155)'; btn.style.background = 'var(--color-surface-2, #0f172a)' }
        btn.onclick = () => {
          document.body.removeChild(overlay)
          resolve({
            browserId: b.browserId,
            displayName: b.displayName || b.browserId,
            profileName: b.profiles?.[0]?.profileName || 'Default',
            profileLabel: b.profiles?.[0]?.label || 'Default'
          })
        }
        list.appendChild(btn)
      })

      card.querySelector('#browserSelectCancel').onclick = () => {
        document.body.removeChild(overlay)
        resolve(null)
      }
      overlay.onclick = (e) => {
        if (e.target === overlay) {
          document.body.removeChild(overlay)
          resolve(null)
        }
      }
    })
  }

  function bind() {
    // 追加导入
    const appendBtn = document.getElementById('browserImportAppendBtn')
    if (appendBtn) {
      appendBtn.addEventListener('click', () => importCookies('append'))
    }

    // 覆盖导入
    const overwriteBtn = document.getElementById('browserImportOverwriteBtn')
    if (overwriteBtn) {
      overwriteBtn.addEventListener('click', () => importCookies('overwrite'))
    }

    // 清除导入的 Cookie
    const clearCookiesBtn = document.getElementById('browserClearCookiesBtn')
    if (clearCookiesBtn) {
      clearCookiesBtn.addEventListener('click', async () => {
        if (!confirm('确定要清除所有导入的 Cookie 吗？这不会影响灵犀自身的设置。')) return
        try {
          const result = await window.api.clearBrowserImportStorage?.()
          if (result?.success) {
            showToast('已清除导入的 Cookie', 'success')
            // 刷新当前页面
            const webviews = document.querySelectorAll('webview')
            webviews.forEach(wv => { try { wv.reload?.() } catch (_) {} })
          } else {
            showToast('清除失败：' + (result?.error || '未知错误'), 'error')
          }
        } catch (e) {
          showToast('清除失败：' + e.message, 'error')
        }
      })
    }

    // 清除存储配额
    const clearStorageBtn = document.getElementById('browserClearStorageBtn')
    if (clearStorageBtn) {
      clearStorageBtn.addEventListener('click', async () => {
        if (!confirm('确定要清除浏览器导入的存储数据吗？这可以解决存储配额满的问题。')) return
        try {
          const result = await window.api.clearBrowserImportStorage?.()
          if (result?.success) {
            showToast('已清除存储配额', 'success')
          } else {
            showToast('清除失败：' + (result?.error || '未知错误'), 'error')
          }
        } catch (e) {
          showToast('清除失败：' + e.message, 'error')
        }
      })
    }

    // 加载状态
    loadBrowserImportStatus()
  }

  // 当设置页面切换到浏览器设置时初始化
  function init() {
    const tab = document.getElementById('settingsTabBrowserSettings')
    if (tab) {
      tab.addEventListener('click', () => {
        setTimeout(loadBrowserImportStatus, 100)
      })
    }
    bind()
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init)
  } else {
    init()
  }

  window.BrowserSettingsPage = { loadBrowserImportStatus, importCookies }
})()
