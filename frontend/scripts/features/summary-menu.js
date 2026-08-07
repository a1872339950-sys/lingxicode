(function () {
  function bind(options = {}) {
    const showToast = options.showToast || function () {}
    const openFilePreview = options.openFilePreview || function () {}

    function closeSummaryFileMenu() {
      const menu = document.getElementById('summaryFileMenu')
      if (menu) menu.remove()
    }

    function showSummaryFileMenu(event, element) {
      event.preventDefault()
      event.stopPropagation()

      const filePath = decodeURIComponent(element.dataset.path)
      if (!filePath) return

      closeSummaryFileMenu()

      const menu = document.createElement('div')
      menu.id = 'summaryFileMenu'
      menu.className = 'summary-file-menu show'
      menu.dataset.filePath = filePath
      menu.innerHTML = `
        <div class="summary-menu-item" data-action="preview">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
          <span>预览文件</span>
        </div>
      `

      menu.querySelectorAll('.summary-menu-item').forEach(item => {
        item.onclick = () => {
          const action = item.dataset.action
          const path = menu.dataset.filePath
          if (action === 'preview') {
            openFilePreview(path)
          }
          closeSummaryFileMenu()
        }
      })

      menu.style.left = event.clientX + 'px'
      menu.style.top = event.clientY + 'px'
      document.body.appendChild(menu)

      setTimeout(() => {
        document.addEventListener('click', closeSummaryFileMenu, { once: true })
      }, 10)
    }

    return {
      showSummaryFileMenu,
      closeSummaryFileMenu
    }
  }

  window.SummaryMenu = { bind }
})()
