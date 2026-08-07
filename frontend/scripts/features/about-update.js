/**
 * about-update.js
 * 关于面板的"检查更新"按钮：调用 IPC 询问云端，显示结果，提供下载入口
 */
;(function () {
  const STATE = {
    busy: false,
    lastResult: null
  }

  function $(id) { return document.getElementById(id) }

  function setStatus(text, cls = '') {
    const el = $('aboutUpdateStatus')
    if (!el) return
    el.textContent = text || ''
    el.className = 'about-update-status' + (cls ? ' ' + cls : '')
  }

  function setBusy(busy) {
    STATE.busy = busy
    const btn = $('aboutCheckUpdateBtn')
    if (!btn) return
    btn.disabled = busy
    btn.textContent = busy ? '检查中…' : '检查更新'
  }

  async function initVersionLabel() {
    const el = $('aboutVersion')
    if (!el || !window.api?.getLingxiVersion) return
    try {
      const res = await window.api.getLingxiVersion()
      const v = res?.data?.currentVersion
      if (v) el.textContent = `v${v}`
    } catch {}
  }

  function formatUpdateText(data) {
    if (!data) return ''
    const { latestVersion, releaseNotes, releaseDate, forceUpdate } = data
    let extra = ''
    if (releaseDate) extra += `（${releaseDate}）`
    if (forceUpdate) extra += ' · 必须更新'
    const notes = releaseNotes ? `：${releaseNotes.split('\n')[0].slice(0, 60)}` : ''
    return `发现新版本 v${latestVersion}${extra}${notes}`
  }

  function renderDownloadButton(data) {
    const wrap = $('aboutUpdateStatus')?.parentElement
    if (!wrap) return
    // 清掉旧的下载按钮
    wrap.querySelectorAll('.about-update-download').forEach(n => n.remove())
    if (!data?.hasUpdate || !data.downloadUrl) return

    const a = document.createElement('button')
    a.type = 'button'
    a.className = 'about-update-btn about-update-download'
    a.textContent = '前往下载'
    a.onclick = async () => {
      try {
        const res = await window.api.openLingxiDownload(data.downloadUrl)
        if (!res?.success) setStatus(res?.error || '打开下载链接失败', 'is-error')
      } catch (err) {
        setStatus(err?.message || '打开下载链接失败', 'is-error')
      }
    }
    wrap.appendChild(a)
  }

  async function checkUpdate({ silent = false } = {}) {
    if (STATE.busy) return
    if (!window.api?.checkLingxiUpdate) {
      setStatus('当前客户端不支持检查更新', 'is-error')
      return
    }
    setBusy(true)
    if (!silent) setStatus('正在连接更新服务器…')
    try {
      const res = await window.api.checkLingxiUpdate({ silent })
      STATE.lastResult = res
      if (!res?.success) {
        setStatus(res?.error || '检查更新失败', 'is-error')
        renderDownloadButton(null)
        return
      }
      const data = res.data || {}
      if (data.hasUpdate) {
        setStatus(formatUpdateText(data), 'is-new')
        renderDownloadButton(data)
      } else {
        setStatus(`当前已是最新版本（v${data.currentVersion || ''}）`, 'is-latest')
        renderDownloadButton(null)
      }
    } catch (err) {
      setStatus(err?.message || '检查更新失败', 'is-error')
      renderDownloadButton(null)
    } finally {
      setBusy(false)
    }
  }

  function bind() {
    const btn = $('aboutCheckUpdateBtn')
    if (btn) btn.onclick = () => checkUpdate({ silent: false })
    initVersionLabel()
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bind, { once: true })
  } else {
    bind()
  }

  window.AboutUpdate = { checkUpdate }
})()
