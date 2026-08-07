// 输入框上方执行计划待办面板
// 样式依赖 styles/input-area.css 中的 .plan-progress-* 规则

(function () {
  function escapeHtml(value) {
    if (window.HtmlUtils?.escapeHtml) return window.HtmlUtils.escapeHtml(String(value ?? ''))
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;')
  }

  function stepTitle(step) {
    if (typeof step === 'string') return step
    if (!step || typeof step !== 'object') return String(step || '')
    return step.title || step.name || step.task || String(step)
  }

  function ensureDock() {
    let dock = document.getElementById('planProgressDock')
    if (dock) return dock

    const inputArea = document.querySelector('.chat-input-area')
    if (!inputArea) return null

    dock = document.createElement('div')
    dock.id = 'planProgressDock'
    dock.className = 'plan-progress-dock'
    dock.hidden = true

    const strip = document.getElementById('cacheUsageStrip')
    const wrapper = document.getElementById('inputWrapper')
    if (strip && strip.parentElement === inputArea) {
      strip.insertAdjacentElement('afterend', dock)
    } else if (wrapper && wrapper.parentElement === inputArea) {
      inputArea.insertBefore(dock, wrapper)
    } else {
      inputArea.appendChild(dock)
    }
    return dock
  }

  function clear() {
    const dock = document.getElementById('planProgressDock')
    if (!dock) return
    dock.hidden = true
    dock.innerHTML = ''
  }

  function render(options = {}) {
    const steps = Array.isArray(options.steps) ? options.steps : []
    if (!steps.length) {
      clear()
      return
    }

    const dock = ensureDock()
    if (!dock) return

    const total = steps.length
    const rawIndex = Number(options.currentStepIndex)
    const idx = Number.isFinite(rawIndex) ? Math.max(0, Math.min(rawIndex, total)) : 0
    const allDone = idx >= total
    const activeIndex = allDone ? Math.max(0, total - 1) : idx
    const rawPhase = String(options.phase || '').trim().replace(/[.。…]+$/g, '')
    const currentTitle = allDone
      ? (!rawPhase || rawPhase === '执行中' || rawPhase === '计划确认' ? '已完成' : rawPhase)
      : (rawPhase && rawPhase !== '执行中' && rawPhase !== '计划确认' && rawPhase !== '已完成'
        ? rawPhase
        : stepTitle(steps[activeIndex]))
    const doneCount = allDone ? total : idx
    const meta = `${Math.min(doneCount, total)}/${total}`
    const expanded = !!options.expanded

    const stepsHtml = steps.map((step, index) => {
      let status = index < idx ? 'done' : (index === idx ? 'active' : 'pending')
      if (allDone) status = 'done'
      if (typeof step === 'object' && step?.status === 'blocked') status = 'blocked'
      if (typeof step === 'object' && step?.status === 'failed' && index === idx) status = 'failed'
      const icon = status === 'done' ? '✓' : (status === 'active' || status === 'failed' ? '●' : '○')
      return `<div class="plan-progress-step ${status}"><span class="plan-progress-step-icon">${icon}</span><span class="plan-progress-step-text">${escapeHtml(stepTitle(step))}</span></div>`
    }).join('')

    dock.hidden = false
    dock.innerHTML = `
      <div class="plan-progress-card${expanded ? ' expanded' : ''}${allDone ? ' is-done' : ''}">
        <button type="button" class="plan-progress-current" id="planProgressToggle" aria-expanded="${expanded ? 'true' : 'false'}">
          <span class="plan-progress-dot${allDone ? ' is-done' : ''}"></span>
          <span class="plan-progress-title">${escapeHtml(currentTitle)}</span>
          <span class="plan-progress-meta">
            <span>${escapeHtml(meta)}</span>
            <svg class="plan-progress-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg>
          </span>
        </button>
        <div class="plan-progress-list">${stepsHtml}</div>
      </div>
    `

    const toggle = dock.querySelector('#planProgressToggle')
    if (toggle && typeof options.onToggleExpand === 'function') {
      toggle.addEventListener('click', options.onToggleExpand)
    }
  }

  window.PlanProgressUI = {
    clear,
    render,
    ensureDock
  }
})()
