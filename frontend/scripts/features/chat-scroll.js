(function () {
  function bind(options = {}) {
    const container = options.container
    const scrollButton = options.scrollButton
    const setScrolledUp = options.setScrolledUp || function () {}
    const getLastScrollTop = options.getLastScrollTop || function () { return 0 }
    const setLastScrollTop = options.setLastScrollTop || function () {}

    if (scrollButton) {
      scrollButton.onclick = () => {
        if (!container) return
        container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' })
        try { window.ChatStickyBottom?.reset?.(container) } catch (_) {}
        scrollButton.classList.remove('show')
      }
    }

    if (container) {
      container.addEventListener('scroll', () => {
        if (!scrollButton) return
        const isNearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 100
        if (isNearBottom) {
          scrollButton.classList.remove('show')
          setScrolledUp(false)
        } else {
          scrollButton.classList.add('show')
        }

        if (container.scrollTop < getLastScrollTop() - 10) {
          setScrolledUp(true)
        }
        setLastScrollTop(container.scrollTop)
      })
    }
  }

  function addErrorMessage(container, content) {
    if (!container) return null
    const msg = document.createElement('div')
    msg.className = 'message error'
    msg.innerHTML = `<div class="message-bubble">${content}</div>`
    container.appendChild(msg)
    container.scrollTop = container.scrollHeight
    return msg
  }

  window.ChatScroll = { bind, addErrorMessage }
})()
