(function () {
  const toastIcons = {
    success: `<svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" stroke-width="2" fill="none"><circle cx="12" cy="12" r="10"/><path d="M9 12l2 2 4-4"/></svg>`,
    error: `<svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" stroke-width="2" fill="none"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>`,
    loading: `<svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" stroke-width="2" fill="none"><circle cx="12" cy="12" r="10" stroke-dasharray="32" stroke-dashoffset="32"/></svg>`,
    warning: `<svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" stroke-width="2" fill="none"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`,
    info: `<svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" stroke-width="2" fill="none"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`
  }

  function show(message, type = 'info', duration = 3000) {
    const container = document.getElementById('toastContainer')
    if (!container) return null

    const toast = document.createElement('div')
    toast.className = `toast ${type}`
    const icon = document.createElement('span')
    icon.className = 'toast-icon'
    icon.innerHTML = toastIcons[type] || toastIcons.info
    const text = document.createElement('span')
    text.className = 'toast-text'
    text.textContent = message
    toast.appendChild(icon)
    toast.appendChild(text)
    container.appendChild(toast)

    if (duration > 0 && type !== 'loading') {
      setTimeout(() => { toast.remove() }, duration)
    }

    return toast
  }

  function remove(toastEl) {
    if (toastEl) toastEl.remove()
  }

  window.ToastUI = { show, remove }
})()
