;(function () {
  'use strict'

  const PIN_DURATION = 5 * 60 * 1000 // 5 minutes

  function getElements() {
    return {
      button: document.getElementById('btnRemoteBridge'),
      panel: document.getElementById('remoteBridgePanel'),
      back: document.getElementById('remoteBridgePanelBack'),
      statusDot: document.getElementById('rbStatusDot'),
      statusText: document.getElementById('rbStatusText'),
      ipList: document.getElementById('rbIpList'),
      generatePinBtn: document.getElementById('rbGeneratePinBtn'),
      pinDisplay: document.getElementById('rbPinDisplay'),
      pinCode: document.getElementById('rbPinCode'),
      pinCountdown: document.getElementById('rbPinCountdown'),
      deviceList: document.getElementById('rbDeviceList'),
      startBtn: document.getElementById('rbStartBtn'),
      stopBtn: document.getElementById('rbStopBtn'),
      qrSection: document.getElementById('rbQrSection'),
      qrCanvas: document.getElementById('rbQrCanvas'),
    }
  }

  let countdownTimer = null
  let currentStatus = null

  // ── 面板开关 ──
  function openPanel() {
    window.LingxiPanelManager?.openExclusive?.('remoteBridge')
    refreshStatus()
    loadDevices()
  }

  function closePanel() {
    window.LingxiPanelManager?.close?.('remoteBridge')
  }

  // ── 获取并刷新服务状态 ──
  async function refreshStatus() {
    const els = getElements()
    if (!els.statusDot) return

    try {
      const api = window.api?.remoteBridge
      if (!api) {
        updateStatusUI(els, { running: false, port: 0, localIPs: [] })
        return
      }
      const status = await api.getStatus()
      currentStatus = status
      updateStatusUI(els, status)
    } catch (e) {
      console.error('[RemoteBridgeUI] getStatus failed:', e)
      updateStatusUI(els, { running: false, port: 0, localIPs: [] })
    }
  }

  function updateStatusUI(els, status) {
    const running = !!status.running
    els.statusDot.className = 'rb-status-dot ' + (running ? 'running' : 'stopped')
    els.statusText.textContent = running
      ? `服务运行中 · 端口 ${status.port || 9876} · ${status.connectedClients || 0} 台设备连接`
      : '服务未启动'

    // 更新 IP 列表
    renderIPList(els, status)

    // 更新二维码
    renderQRCode(els, status)

    // 按钮状态
    if (els.generatePinBtn) {
      els.generatePinBtn.disabled = !running
    }
    if (els.startBtn) els.startBtn.style.display = running ? 'none' : ''
    if (els.stopBtn) els.stopBtn.style.display = running ? '' : 'none'
  }

  function renderIPList(els, status) {
    if (!els.ipList) return
    const port = status.port || 9876
    const ips = status.localIPs || []

    if (!status.running || ips.length === 0) {
      els.ipList.innerHTML = ''
      const placeholder = document.createElement('span')
      placeholder.className = 'rb-ip-placeholder'
      placeholder.textContent = status.running ? '未检测到局域网地址' : '启动服务后显示'
      els.ipList.appendChild(placeholder)
      return
    }

    els.ipList.innerHTML = ''
    for (const ip of ips) {
      const item = document.createElement('div')
      item.className = 'rb-ip-item'

      const addr = document.createElement('span')
      addr.textContent = `${ip}:${port}`

      const copyBtn = document.createElement('button')
      copyBtn.className = 'rb-copy-btn'
      copyBtn.textContent = '复制'
      copyBtn.addEventListener('click', () => {
        copyToClipboard(`${ip}:${port}`)
        copyBtn.textContent = '已复制'
        setTimeout(() => { copyBtn.textContent = '复制' }, 1500)
      })

      item.appendChild(addr)
      item.appendChild(copyBtn)
      els.ipList.appendChild(item)
    }
  }

  // ── 二维码渲染 ──
  function renderQRCode(els, status) {
    if (!els.qrSection || !els.qrCanvas) return

    if (!status.running || !status.localIPs || status.localIPs.length === 0) {
      els.qrSection.style.display = 'none'
      return
    }

    const port = status.port || 9876
    const ip = status.localIPs[0]
    const url = `http://${ip}:${port}`

    els.qrSection.style.display = ''

    try {
      if (window.LingxiQR) {
        window.LingxiQR.renderToCanvas(els.qrCanvas, url, {
          size: 200,
          margin: 2,
          fgColor: '#1a1a2e',
          bgColor: '#ffffff',
        })
      }
    } catch (e) {
      console.error('[RemoteBridgeUI] QR render failed:', e)
    }
  }

  // ── 生成配对码 ──
  async function generatePin() {
    const els = getElements()
    if (!els.generatePinBtn) return

    try {
      const api = window.api?.remoteBridge
      if (!api) return

      const result = await api.generatePin()
      const pin = typeof result === 'string' ? result : result?.pin || String(result)

      if (!pin) {
        els.generatePinBtn.textContent = '生成失败'
        setTimeout(() => { els.generatePinBtn.textContent = '生成配对码' }, 2000)
        return
      }

      // 显示 PIN
      els.pinCode.textContent = pin
      els.pinDisplay.classList.remove('hidden')
      els.generatePinBtn.style.display = 'none'

      // 启动倒计时
      startCountdown(els)
    } catch (e) {
      console.error('[RemoteBridgeUI] generatePin failed:', e)
      els.generatePinBtn.textContent = '生成失败'
      setTimeout(() => { els.generatePinBtn.textContent = '生成配对码' }, 2000)
    }
  }

  function startCountdown(els) {
    if (countdownTimer) clearInterval(countdownTimer)

    const endTime = Date.now() + PIN_DURATION

    function tick() {
      const remaining = endTime - Date.now()
      if (remaining <= 0) {
        clearInterval(countdownTimer)
        countdownTimer = null
        els.pinCountdown.textContent = '已过期'
        els.pinCountdown.classList.add('expired')
        els.generatePinBtn.style.display = ''
        els.generatePinBtn.textContent = '重新生成'
        return
      }
      const mins = Math.floor(remaining / 60000)
      const secs = Math.floor((remaining % 60000) / 1000)
      els.pinCountdown.textContent = `剩余 ${mins}:${String(secs).padStart(2, '0')}`
      els.pinCountdown.classList.remove('expired')
    }

    tick()
    countdownTimer = setInterval(tick, 1000)
  }

  // ── 设备列表 ──
  async function loadDevices() {
    const els = getElements()
    if (!els.deviceList) return

    try {
      const api = window.api?.remoteBridge
      if (!api?.listDevices) return

      const devices = await api.listDevices()
      renderDevices(els, devices)
    } catch (e) {
      console.error('[RemoteBridgeUI] listDevices failed:', e)
    }
  }

  function renderDevices(els, devices) {
    els.deviceList.innerHTML = ''

    if (!devices || devices.length === 0) {
      const empty = document.createElement('div')
      empty.className = 'rb-device-empty'
      empty.textContent = '暂无已配对设备'
      els.deviceList.appendChild(empty)
      return
    }

    for (const device of devices) {
      const item = document.createElement('div')
      item.className = 'rb-device-item'

      const info = document.createElement('div')
      info.className = 'rb-device-info'

      const name = document.createElement('span')
      name.className = 'rb-device-name'
      name.textContent = device.deviceName || 'Unknown'

      const time = document.createElement('span')
      time.className = 'rb-device-time'
      const pairedDate = device.pairedAt ? new Date(device.pairedAt).toLocaleDateString('zh-CN') : ''
      time.textContent = pairedDate ? `配对于 ${pairedDate}` : ''

      info.appendChild(name)
      info.appendChild(time)

      const revokeBtn = document.createElement('button')
      revokeBtn.className = 'rb-device-revoke'
      revokeBtn.textContent = '撤销'
      revokeBtn.addEventListener('click', () => revokeDevice(device.tokenPrefix))

      item.appendChild(info)
      item.appendChild(revokeBtn)
      els.deviceList.appendChild(item)
    }
  }

  async function revokeDevice(tokenPrefix) {
    try {
      const api = window.api?.remoteBridge
      if (!api?.revokeDevice) return

      const ok = await api.revokeDevice(tokenPrefix)
      if (ok) {
        loadDevices()
        refreshStatus()
      }
    } catch (e) {
      console.error('[RemoteBridgeUI] revokeDevice failed:', e)
    }
  }

  // ── 服务控制 ──
  async function startService() {
    try {
      const api = window.api?.remoteBridge
      if (!api?.start) return
      await api.start({})
      refreshStatus()
    } catch (e) {
      console.error('[RemoteBridgeUI] start failed:', e)
    }
  }

  async function stopService() {
    try {
      const api = window.api?.remoteBridge
      if (!api?.stop) return
      await api.stop()
      // 隐藏 PIN display
      const els = getElements()
      if (els.pinDisplay) els.pinDisplay.classList.add('hidden')
      if (els.generatePinBtn) {
        els.generatePinBtn.style.display = ''
        els.generatePinBtn.textContent = '生成配对码'
      }
      if (countdownTimer) {
        clearInterval(countdownTimer)
        countdownTimer = null
      }
      refreshStatus()
    } catch (e) {
      console.error('[RemoteBridgeUI] stop failed:', e)
    }
  }

  // ── 工具函数 ──
  function copyToClipboard(text) {
    if (navigator.clipboard) {
      navigator.clipboard.writeText(text).catch(() => fallbackCopy(text))
    } else {
      fallbackCopy(text)
    }
  }

  function fallbackCopy(text) {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.style.position = 'fixed'
    ta.style.left = '-9999px'
    document.body.appendChild(ta)
    ta.select()
    try { document.execCommand('copy') } catch (e) { /* ignore */ }
    document.body.removeChild(ta)
  }

  // ── 绑定事件 ──
  function bind() {
    const els = getElements()
    if (!els.panel) return

    if (els.button) els.button.addEventListener('click', openPanel)
    if (els.back) els.back.addEventListener('click', closePanel)
    if (els.generatePinBtn) els.generatePinBtn.addEventListener('click', generatePin)
    if (els.startBtn) els.startBtn.addEventListener('click', startService)
    if (els.stopBtn) els.stopBtn.addEventListener('click', stopService)
  }

  window.RemoteBridgeUI = { bind, openPanel, refreshStatus }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bind, { once: true })
  } else {
    bind()
  }
})()
