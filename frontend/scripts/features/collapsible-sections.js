/* collapsible-sections.js
 * 设置面板里可折叠区块的开关 + 状态持久化
 * - 触发器：[data-collapse-toggle="<section-id>"]（一般为 .settings-section-header）
 * - 内容容器：[data-collapse-body="<section-id>"]
 * - 容器根：触发器所在的父级（一般是 .settings-section-collapsible）
 * - 默认展开，除非 localStorage 里存着 true
 */
(function () {
  var STORAGE_KEY = 'lingxi_collapsed_sections'

  function loadState() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY)
      return raw ? JSON.parse(raw) : {}
    } catch (e) {
      return {}
    }
  }

  function saveState(state) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
    } catch (e) { /* localStorage 不可用就静默忽略 */ }
  }

  function syncExpandedAttr(header, root) {
    if (!header) return
    var collapsed = !!(root && root.classList.contains('collapsed'))
    header.setAttribute('aria-expanded', collapsed ? 'false' : 'true')
  }

  function applyInitial() {
    var state = loadState()
    document.querySelectorAll('[data-collapse-toggle]').forEach(function (header) {
      var id = header.getAttribute('data-collapse-toggle')
      var root = header.parentElement
      if (!root) return
      if (state[id] === true) root.classList.add('collapsed')
      else root.classList.remove('collapsed')
      syncExpandedAttr(header, root)
    })
  }

  function bindToggles() {
    document.querySelectorAll('[data-collapse-toggle]').forEach(function (header) {
      // 防止重复绑定（脚本可能被多次加载）
      if (header.__collapsibleBound) return
      header.__collapsibleBound = true

      header.addEventListener('click', function (e) {
        // 避免点击 header 里的 input/button 时误触
        var tag = (e.target && e.target.tagName) || ''
        if (tag === 'INPUT' || tag === 'BUTTON' || tag === 'SELECT' || tag === 'TEXTAREA' || tag === 'LABEL' || tag === 'A') {
          return
        }
        var id = header.getAttribute('data-collapse-toggle')
        var root = header.parentElement
        if (!root) return
        root.classList.toggle('collapsed')
        syncExpandedAttr(header, root)
        var state = loadState()
        state[id] = root.classList.contains('collapsed')
        saveState(state)
      })

      // 键盘可达性：回车/空格也能切
      header.setAttribute('role', 'button')
      header.setAttribute('tabindex', '0')
      header.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          header.click()
        }
      })
    })
  }

  function init() {
    applyInitial()
    bindToggles()
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init)
  } else {
    init()
  }
})()