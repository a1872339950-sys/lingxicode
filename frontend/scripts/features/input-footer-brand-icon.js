/**
 * 输入框底栏模型 trigger 厂商图标同步器
 *
 * 复用 window.ModelBrandIcons.getIconHtml 根据 #modelCurrent 文本识别厂商，
 * 渲染到 #modelTriggerIcon 占位 span 中。
 * 通过 MutationObserver 监听文本变化，避免侵入 quick-model-settings.js
 * 多处 textContent 赋值点；同时也能覆盖 project-switcher 切项目时的更新。
 */
(function () {
  function getCurrentModelMeta() {
    try {
      if (window.modelStore?.getCurrentConfig) {
        const cfg = window.modelStore.getCurrentConfig()
        if (cfg) return cfg
      }
    } catch (_) { /* ignore */ }
    return null
  }

  function syncIcon(label, iconSpan) {
    if (!iconSpan) return
    const api = window.ModelBrandIcons
    if (!api || typeof api.getIconHtml !== 'function') {
      iconSpan.innerHTML = ''
      return
    }
    const meta = getCurrentModelMeta()
    const probe = meta && (meta.modelName || meta.modelId || meta.provider)
      ? meta
      : { modelName: label || '' }
    const html = api.getIconHtml(probe, 'model-trigger-brand-icon')
    if (html) {
      if (iconSpan.dataset.lastLabel !== label || !iconSpan.firstChild) {
        iconSpan.innerHTML = html
        iconSpan.dataset.lastLabel = label
      }
    } else {
      iconSpan.innerHTML = ''
      iconSpan.dataset.lastLabel = ''
    }
  }

  function init() {
    const modelCurrent = document.getElementById('modelCurrent')
    const iconSpan = document.getElementById('modelTriggerIcon')
    if (!modelCurrent || !iconSpan) return

    const update = () => syncIcon(modelCurrent.textContent || '', iconSpan)

    // 首次渲染
    update()

    // 监听文本变化（quick-model-settings.js / project-switcher.js / app.js 都直接改 textContent）
    const observer = new MutationObserver(() => update())
    observer.observe(modelCurrent, {
      characterData: true,
      childList: true,
      subtree: true
    })

    // 兜底：项目切换事件
    window.addEventListener('lingxi:project-switched', update)
    window.addEventListener('lingxi:model-changed', update)
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init)
  } else {
    init()
  }
})()
