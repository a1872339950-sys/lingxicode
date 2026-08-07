(function () {
  const escapeHtml = HtmlUtils.escapeHtml

  function contentToText(content) {
    if (content == null) return ''
    if (typeof content === 'string') return content
    if (typeof content === 'number' || typeof content === 'boolean') return String(content)

    if (Array.isArray(content)) {
      return content.map(part => {
        if (part == null) return ''
        if (typeof part === 'string') return part
        if (typeof part === 'number' || typeof part === 'boolean') return String(part)
        if (typeof part !== 'object') return ''

        if (typeof part.text === 'string') return part.text
        if (typeof part.content === 'string') return part.content
        if (typeof part.input_text === 'string') return part.input_text
        if (part.image_url || part.input_image || part.type === 'image_url' || part.type === 'input_image') return '[image]'
        if (part.file || part.file_path || part.type === 'file') return '[file]'
        return ''
      }).filter(Boolean).join(' ')
    }

    if (typeof content === 'object') {
      if (typeof content.text === 'string') return content.text
      if (typeof content.content === 'string') return content.content
      if (typeof content.displayContent === 'string') return content.displayContent
      if (content.image_url || content.input_image) return '[image]'
      try {
        return JSON.stringify(content)
      } catch {
        return String(content)
      }
    }

    return String(content)
  }

  function getHistoryDisplayText(item) {
    return contentToText(item.displayContent || item.content)
  }

  function formatHistoryTime(value) {
    if (!value) return ''
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) return ''
    const month = date.getMonth() + 1
    const day = date.getDate()
    const hours = String(date.getHours()).padStart(2, '0')
    const minutes = String(date.getMinutes()).padStart(2, '0')
    return `${month}/${day} ${hours}:${minutes}`
  }

  function getHistoryMessageTime(item) {
    if (!item || typeof item !== 'object') return ''
    return formatHistoryTime(
      item.time ||
      item.timestamp ||
      item.createdAt ||
      item.completedAt ||
      item.updatedAt ||
      item.date
    )
  }

  function findNearbyTime(historySource, startIndex) {
    const ownTime = getHistoryMessageTime(historySource[startIndex])
    if (ownTime) return ownTime
    for (let i = startIndex + 1; i < historySource.length; i++) {
      const item = historySource[i]
      if (!item || item.role === 'user') break
      const time = getHistoryMessageTime(item)
      if (time) return time
    }
    for (let i = startIndex - 1; i >= 0; i--) {
      const item = historySource[i]
      if (!item || item.role === 'user') break
      const time = getHistoryMessageTime(item)
      if (time) return time
    }
    return ''
  }

  function renderList(options, filter = '') {
    const list = options.list
    if (!list) return

    const project = options.getProject?.()
    if (!project) {
      list.innerHTML = ((window.i18n?.t?.('auto.js_chat_history_54_1') ?? '<div class="chat-history-empty">暂无历史消息</div>'))
      return
    }

    const historySource = Array.isArray(options.historyEntries)
      ? options.historyEntries
      : (Array.isArray(project.messagesHistory) && project.messagesHistory.length > 0
        ? project.messagesHistory
        : (project.history || []))
    if (historySource.length === 0) {
      list.innerHTML = ((window.i18n?.t?.('auto.js_chat_history_60_2') ?? '<div class="chat-history-empty">暂无历史消息</div>'))
      return
    }

    let userMsgIndex = 0
    const userMessagesData = []
    historySource.forEach((item, i) => {
      if ((options.historyEntries || item.role === 'user') && !item.hidden && !item._deepseekBridge && !item.deepseekBridge) {
        const content = getHistoryDisplayText(item)
        // Skip DeepSeek multi-tool cache bridge synthetic user rows
        if (
          content.includes('[Lingxi internal parallel tool batch results]') ||
          /^Lingxi executed \d+ requested tools in parallel/i.test(content)
        ) return
        userMessagesData.push({
          content,
          time: findNearbyTime(historySource, i),
          userIndex: userMsgIndex,
          turnId: userMsgIndex + 1,
          historyIndex: i,
          messageId: item.messageId || '',
          chunkIndex: Number.isInteger(item.chunkIndex) ? item.chunkIndex : null
        })
        userMsgIndex++
      }
    })

    if (userMessagesData.length === 0) {
      list.innerHTML = ((window.i18n?.t?.('auto.js_chat_history_81_3') ?? '<div class="chat-history-empty">暂无历史消息</div>'))
      return
    }

    let filteredData = userMessagesData
    if (filter) {
      filteredData = userMessagesData.filter(msg => msg.content.includes(filter))
    }

    if (filteredData.length === 0) {
      list.innerHTML = ((window.i18n?.t?.('auto.js_chat_history_91_4') ?? '<div class="chat-history-empty">未找到匹配消息</div>'))
      return
    }

    const reversedData = [...filteredData].reverse()
    list.innerHTML = reversedData.map(msg => `
      <div class="chat-history-item" data-turn-id="${msg.turnId}" data-user-index="${msg.userIndex}" data-history-index="${msg.historyIndex}">
        <div class="chat-history-item-content">${escapeHtml(msg.content.substring(0, 30))}${msg.content.length > 30 ? '...' : ''}</div>
        <div class="chat-history-item-time">${msg.time}</div>
      </div>
    `).join('')

    list.querySelectorAll('.chat-history-item').forEach((item, reversedIndex) => {
      item.onclick = () => {
        const msg = reversedData[reversedIndex]
        if (!msg) return
        const turnId = parseInt(item.dataset.turnId, 10)
        const historyIndex = parseInt(item.dataset.historyIndex, 10)
        if (msg.messageId && Number.isInteger(msg.chunkIndex) && options.onJumpToHistoryEntry) {
          options.onJumpToHistoryEntry(msg)
        } else {
          options.onJumpToTurn?.(turnId, Number.isFinite(historyIndex) ? historyIndex : null)
        }
        options.modal?.classList.remove('show')
      }
    })
  }

  function bind(options) {
    const { button, modal, closeButton, searchInput } = options

    if (button) {
      button.onclick = async event => {
        event?.preventDefault?.()
        event?.stopPropagation?.()
        const isShowing = modal?.classList.contains('show')
        if (isShowing) {
          modal.classList.remove('show')
        } else {
          try {
            const project = options.getProject?.()
            let historyEntries = null
            if (project && typeof window.api?.getChatHistoryIndex === 'function') {
              const result = await window.api.getChatHistoryIndex(project.id)
              if (result?.success && project.id === options.getProject?.()?.id) historyEntries = result.entries || []
            }
            renderList({ ...options, historyEntries })
          } catch (error) {
            console.error('[ChatHistory] render failed:', error)
            if (options.list) options.list.innerHTML = ((window.i18n?.t?.('auto.js_chat_history_127_5') ?? '<div class="chat-history-empty">历史消息加载失败</div>'))
          }
          modal?.classList.add('show')
        }
      }
    }

    if (closeButton) {
      closeButton.onclick = () => {
        modal?.classList.remove('show')
        if (searchInput) searchInput.value = ''
      }
    }

    if (searchInput) {
      searchInput.addEventListener('input', () => {
        renderList(options, searchInput.value)
      })
    }

    document.addEventListener('click', e => {
      if (!modal || !modal.classList.contains('show')) return
      const isInsideModal = modal.contains(e.target)
      const isInsideBtn = button && button.contains(e.target)
      if (!isInsideModal && !isInsideBtn) {
        modal.classList.remove('show')
      }
    })
  }

  function highlight(element) {
    if (!element) return
    element.scrollIntoView({ behavior: 'smooth', block: 'center' })
    element.style.transition = 'background 0.3s'
    element.style.background = 'rgba(99, 102, 241, 0.1)'
    setTimeout(() => {
      element.style.background = ''
    }, 1500)
  }

  window.ChatHistoryUI = {
    bind,
    renderList,
    highlight
  }
})()
