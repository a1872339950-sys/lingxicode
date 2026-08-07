(function () {
  function bindTitlebar(options) {
    const menuItems = document.querySelectorAll('.titlebar-menu-item, .titlebar-brand')
    const dropdowns = document.querySelectorAll('.titlebar-dropdown')

    menuItems.forEach(item => {
      item.onclick = e => {
        e.stopPropagation()
        const dropdown = item.querySelector('.titlebar-dropdown')
        dropdowns.forEach(d => {
          if (d !== dropdown) d.classList.remove('show')
        })
        dropdown?.classList.toggle('show')
      }
    })

    document.addEventListener('click', () => {
      dropdowns.forEach(d => d.classList.remove('show'))
    })

    document.querySelectorAll('.titlebar-dropdown-item').forEach(item => {
      item.onclick = e => {
        e.stopPropagation()
        const action = item.dataset.menuAction || ''
        const text = item.textContent || ''
        options.onMenuItem?.(action || text, text, item)
        dropdowns.forEach(d => d.classList.remove('show'))
      }
    })
  }

  function bindAbout(panel, closeButton) {
    if (closeButton && panel) {
      closeButton.onclick = () => {
        panel.classList.remove('show')
      }
    }
    if (!panel) return

    let dragging = false
    let dragStartX = 0
    let dragStartY = 0
    let windowStartX = 0
    let windowStartY = 0

    panel.addEventListener('mousedown', e => {
      if (e.target.closest('.about-close')) return

      dragging = true
      dragStartX = e.clientX
      dragStartY = e.clientY
      const rect = panel.getBoundingClientRect()
      windowStartX = rect.left
      windowStartY = rect.top
      panel.style.transform = 'none'
      panel.style.left = windowStartX + 'px'
      panel.style.top = windowStartY + 'px'
      panel.style.cursor = 'grabbing'
    })

    document.addEventListener('mousemove', e => {
      if (!dragging) return
      const deltaX = e.clientX - dragStartX
      const deltaY = e.clientY - dragStartY
      panel.style.left = (windowStartX + deltaX) + 'px'
      panel.style.top = (windowStartY + deltaY) + 'px'
    })

    document.addEventListener('mouseup', () => {
      dragging = false
      panel.style.cursor = ''
    })
  }

  function resetAboutPosition(panel) {
    if (!panel) return
    panel.style.transform = 'translate(-50%, -50%)'
    panel.style.left = '50%'
    panel.style.top = '50%'
  }

  function bindWindowControls(api) {
    const ctrlMinimize = document.getElementById('ctrlMinimize')
    const ctrlMaximize = document.getElementById('ctrlMaximize')
    const ctrlClose = document.getElementById('ctrlClose')

    if (ctrlMinimize) ctrlMinimize.onclick = () => api?.mainWindowMinimize?.()
    if (ctrlMaximize) ctrlMaximize.onclick = () => api?.mainWindowMaximize?.()
    if (ctrlClose) ctrlClose.onclick = () => api?.mainWindowClose?.()

    function setMaximizedIcon(maximized) {
      if (!ctrlMaximize) return
      ctrlMaximize.classList.toggle('is-maximized', !!maximized)
      ctrlMaximize.innerHTML = maximized
        ? '<svg class="titlebar-restore-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 8.5V6.75C8 5.78 8.78 5 9.75 5h7.5C18.22 5 19 5.78 19 6.75v7.5c0 .97-.78 1.75-1.75 1.75H15.5"/><rect x="5" y="8.5" width="10.5" height="10.5" rx="1.75"/></svg>'
        : '<svg class="titlebar-maximize-icon" viewBox="0 0 24 24" aria-hidden="true"><rect x="6.25" y="6.25" width="11.5" height="11.5" rx="1.6"/></svg>'
      ctrlMaximize.title = maximized ? '还原' : '最大化'
    }

    api?.onMainWindowMaximizedChange?.(data => {
      setMaximizedIcon(!!data?.maximized)
    })
  }

  window.TitlebarUI = {
    bindTitlebar,
    bindAbout,
    resetAboutPosition,
    bindWindowControls
  }
})()
