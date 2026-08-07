(function () {
  function bind(menuEl) {
    if (!menuEl) return

    let targetEl = null
    let savedSelection = null
    let savedRange = null
    let savedInputSelection = null

    function hide() {
      menuEl.classList.remove('show')
    }

    function show(x, y, target) {
      targetEl = target

      const sel = window.getSelection()
      savedSelection = sel.toString()
      if (sel.rangeCount > 0) {
        savedRange = sel.getRangeAt(0).cloneRange()
      }

      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) {
        savedInputSelection = {
          start: target.selectionStart,
          end: target.selectionEnd,
          value: target.value
        }
      } else {
        savedInputSelection = null
      }

      const isEditable = target && (target.isContentEditable || target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')
      const cutItem = menuEl.querySelector('[data-action="cut"]')
      const copyItem = menuEl.querySelector('[data-action="copy"]')
      const pasteItem = menuEl.querySelector('[data-action="paste"]')
      const divider = menuEl.querySelector('.context-menu-divider')
      const selectAllItem = menuEl.querySelector('[data-action="selectAll"]')

      if (cutItem) cutItem.style.display = (isEditable && savedSelection) ? 'flex' : 'none'
      if (copyItem) copyItem.style.display = savedSelection ? 'flex' : 'none'
      if (pasteItem) pasteItem.style.display = isEditable ? 'flex' : 'none'
      if (divider) divider.style.display = isEditable ? 'block' : 'none'
      if (selectAllItem) selectAllItem.style.display = isEditable ? 'flex' : 'none'

      const visibleItems = menuEl.querySelectorAll('.context-menu-item[style*="flex"]')
      if (visibleItems.length === 0) return

      menuEl.classList.add('show')
      const menuHeight = menuEl.offsetHeight
      const menuWidth = menuEl.offsetWidth
      const windowHeight = window.innerHeight
      const windowWidth = window.innerWidth
      let finalY = y
      let finalX = x

      if (y + menuHeight > windowHeight) finalY = y - menuHeight
      if (x + menuWidth > windowWidth) finalX = windowWidth - menuWidth - 8

      menuEl.style.left = finalX + 'px'
      menuEl.style.top = finalY + 'px'
    }

    async function handleAction(action) {
      hide()

      if (action === 'cut' || action === 'copy') {
        if (!savedSelection) return
        try {
          await navigator.clipboard.writeText(savedSelection)
          if (action === 'cut') {
            if (savedInputSelection && targetEl) {
              const { start, end, value } = savedInputSelection
              targetEl.value = value.substring(0, start) + value.substring(end)
              targetEl.selectionStart = targetEl.selectionEnd = start
            } else if (savedRange) {
              const sel = window.getSelection()
              sel.removeAllRanges()
              sel.addRange(savedRange)
              savedRange.deleteContents()
            }
          }
        } catch (err) {
          document.execCommand(action)
        }
        return
      }

      if (action === 'paste') {
        try {
          const text = await navigator.clipboard.readText()
          if (targetEl) {
            if (targetEl.tagName === 'INPUT' || targetEl.tagName === 'TEXTAREA') {
              const start = targetEl.selectionStart
              const end = targetEl.selectionEnd
              targetEl.value = targetEl.value.substring(0, start) + text + targetEl.value.substring(end)
              targetEl.selectionStart = targetEl.selectionEnd = start + text.length
            } else if (savedRange) {
              savedRange.deleteContents()
              savedRange.insertNode(document.createTextNode(text))
            }
          }
        } catch (err) {
          document.execCommand('paste')
        }
        return
      }

      if (action === 'selectAll') {
        if (targetEl && (targetEl.tagName === 'INPUT' || targetEl.tagName === 'TEXTAREA')) {
          targetEl.select()
        } else {
          document.execCommand('selectAll')
        }
      }
    }

    document.addEventListener('contextmenu', e => {
      const selectedText = window.getSelection()?.toString()?.trim()
      if (!selectedText && e.target.closest?.('.message.user, .message.ai')) return
      e.preventDefault()
      show(e.clientX, e.clientY, e.target)
    })

    menuEl.querySelectorAll('.context-menu-item').forEach(item => {
      item.addEventListener('click', () => {
        handleAction(item.dataset.action)
      })
    })

    document.addEventListener('click', e => {
      if (!menuEl.contains(e.target)) hide()
    })

    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') hide()
    })
  }

  window.ContextMenuUI = { bind }
})()
