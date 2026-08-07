/* behavior-style-settings.js
 * 「AI 行为风格」和「允许温和关怀提醒」两个开关已经嵌在个性化设置面板的
 * 「界面显示」section 里（与"显示历史压缩指示器"同一行）。
 * 本文件只负责：
 *   1. 把 5 档风格按钮注入 #behaviorStyleGrid
 *   2. 给 #behaviorStyleEnabled / #behaviorStyleCareReminder 绑定事件
 *   3. 根据 state.enabled 显隐 #behaviorStyleSubpanel 并刷新状态文字
 *   4. 通过 window.api.getBehaviorStyle() / setBehaviorStyle() 持久化
 *   5. 暴露 window.BehaviorStyleSettings 给 care-reminder 等模块读取最新值
 */
(function () {
  var STORAGE_PREFIX = 'lingxi-behavior-style-init'

  var STYLES = [
    { value: 'standard', label: '标准', desc: '正式客观、像产品文档。' },
    { value: 'plain',    label: '大白话', desc: '去掉书面腔，能少说就少说。' },
    { value: 'human',    label: '像人一样', desc: '自然口语，可以带点情绪起伏。' },
    { value: 'roast',    label: '毒舌吐槽', desc: '话糙理直，敢怼敢说，但不骂人。' },
    { value: 'cute',     label: '温和可爱', desc: '软糯关怀、语气轻柔，多用语气词。' }
  ]

  var state = { enabled: false, style: 'standard', careReminderEnabled: true }

  function updateState(patch) {
    Object.assign(state, patch)
    persist()
    applyState()
  }

  function persist() {
    if (window.api && typeof window.api.setBehaviorStyle === 'function') {
      window.api.setBehaviorStyle(state).catch(function (err) {
        console.warn('[behavior-style-settings] setBehaviorStyle failed', err)
      })
    }
    try { localStorage.setItem(STORAGE_PREFIX, JSON.stringify(state)) } catch (_) {}
  }

  function loadState(cb) {
    if (window.api && typeof window.api.getBehaviorStyle === 'function') {
      window.api.getBehaviorStyle().then(function (cfg) {
        if (cfg) state = Object.assign(state, cfg)
        if (cb) cb()
      }).catch(function () { if (cb) cb() })
    } else {
      try {
        var cached = localStorage.getItem(STORAGE_PREFIX)
        if (cached) state = Object.assign(state, JSON.parse(cached))
      } catch (_) {}
      if (cb) cb()
    }
  }

  function applyState() {
    var enabledEl = document.getElementById('behaviorStyleEnabled')
    var careEl = document.getElementById('behaviorStyleCareReminder')
    var subpanel = document.getElementById('behaviorStyleSubpanel')
    var statusEl = document.getElementById('behaviorStyleStatus')
    if (!enabledEl || !careEl) return

    enabledEl.checked = !!state.enabled
    careEl.checked = !!state.careReminderEnabled

    if (subpanel) {
      if (state.enabled) subpanel.removeAttribute('hidden')
      else subpanel.setAttribute('hidden', '')
    }

    var grid = document.getElementById('behaviorStyleGrid')
    if (grid) {
      Array.prototype.forEach.call(grid.querySelectorAll('.behavior-style-btn'), function (btn) {
        var active = state.enabled && btn.dataset.value === state.style
        btn.classList.toggle('active', active)
        btn.disabled = !state.enabled
      })
    }

    if (statusEl) {
      var activeStyle = STYLES.find(function (s) { return s.value === state.style })
      var styleLabel = activeStyle ? activeStyle.label : '标准'
      if (!state.enabled) {
        statusEl.textContent = '当前未启用自定义行为风格，使用默认风格回复。' + (state.careReminderEnabled ? '；关怀提醒已开启。' : '')
      } else {
        statusEl.textContent = '当前已启用：' + styleLabel + '。下一轮 AI 的思考块和最终回复都会按此风格表达。' + (state.careReminderEnabled ? '；关怀提醒已开启。' : '')
      }
    }
  }

  function buildGrid() {
    var grid = document.getElementById('behaviorStyleGrid')
    if (!grid || grid.dataset.built === '1') return
    grid.innerHTML = ''
    STYLES.forEach(function (s) {
      var btn = document.createElement('button')
      btn.type = 'button'
      btn.className = 'behavior-style-btn'
      btn.dataset.value = s.value
      btn.innerHTML = '<span class="behavior-style-btn-label">' + escapeHtml(s.label) + '</span>'
      btn.title = s.desc
      btn.addEventListener('click', function () {
        if (!state.enabled) return
        updateState({ style: s.value })
      })
      grid.appendChild(btn)
    })
    grid.dataset.built = '1'
  }

  function bindCheckboxes() {
    var enabledEl = document.getElementById('behaviorStyleEnabled')
    var careEl = document.getElementById('behaviorStyleCareReminder')
    if (enabledEl && !enabledEl.__bsBound) {
      enabledEl.__bsBound = true
      enabledEl.addEventListener('change', function (e) {
        updateState({ enabled: e.target.checked })
      })
    }
    if (careEl && !careEl.__bsBound) {
      careEl.__bsBound = true
      careEl.addEventListener('change', function (e) {
        updateState({ careReminderEnabled: e.target.checked })
      })
    }
  }

  function escapeHtml(s) {
    if (window.HtmlUtils && HtmlUtils.escapeHtml) return HtmlUtils.escapeHtml(s)
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
    })
  }

  function init() {
    if (!document.getElementById('behaviorStyleEnabled')) return
    buildGrid()
    bindCheckboxes()
    loadState(applyState)
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init)
  } else {
    init()
  }

  window.BehaviorStyleSettings = {
    getState: function () { return Object.assign({}, state) },
    apply: applyState
  }
})()