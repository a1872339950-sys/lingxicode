(function () {
  function bind(options = {}) {
    const api = options.api || window.api
    const getActiveProjectId = options.getActiveProjectId || function () { return null }
    const getChatMessages = options.getChatMessages || function () { return null }
    const showToast = options.showToast || function () {}
    const addAiMessage = options.addAiMessage || function () {}

    let currentVisibilityBoundary = 0

    function updateMessagesVisibility() {
      const projectId = getActiveProjectId()
      if (!projectId || !api?.getVisibilityBoundary) return

      return api.getVisibilityBoundary(projectId).then(result => {
        if (result.success && result.startIndex !== currentVisibilityBoundary) {
          currentVisibilityBoundary = result.startIndex
          applyVisibilityToMessages(result.startIndex, result.stats)
        }
      }).catch(err => {
        AppLogger.debug('[UI] 获取可见边界失败:', err)
      })
    }

    function applyVisibilityToMessages(startIndex, stats) {
      const chatMessages = getChatMessages()
      if (!chatMessages) return

      const messages = chatMessages.querySelectorAll('.message')
      const existingDivider = chatMessages.querySelector('.context-visibility-divider')
      if (existingDivider) existingDivider.remove()

      if (startIndex === 0) {
        messages.forEach(msg => msg.classList.remove('ai-invisible'))
        return
      }

      let userMsgCount = 0
      messages.forEach(msg => {
        if (msg.classList.contains('user')) {
          userMsgCount++
        }

        if (userMsgCount <= startIndex) {
          msg.classList.add('ai-invisible')
        } else {
          msg.classList.remove('ai-invisible')
        }
      })

      renderContextDivider(startIndex, stats)
    }

    function renderContextDivider(startIndex, stats) {
      const chatMessages = getChatMessages()
      if (!chatMessages || startIndex === 0) return

      const messages = chatMessages.querySelectorAll('.message')
      let userMsgCount = 0
      let targetMsg = null

      messages.forEach(msg => {
        if (msg.classList.contains('user')) {
          userMsgCount++
          if (userMsgCount === startIndex + 1) {
            targetMsg = msg
          }
        }
      })

      if (!targetMsg) return

      const divider = document.createElement('div')
      divider.className = 'context-visibility-divider'

      divider.innerHTML = `
        <div class="divider-line"></div>
        <div class="context-divider-hint">
          <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>
          以上 ${startIndex} 条对话AI已不可见，可通过记忆查询找回
        </div>
        <div class="context-divider-actions">
          <div class="context-divider-btn" onclick="resetVisibility()">重置边界（全部可见）</div>
          <div class="context-divider-btn" onclick="showMemoryQuery()">查询记忆</div>
        </div>
      `

      chatMessages.insertBefore(divider, targetMsg)
    }

    function resetVisibility() {
      const projectId = getActiveProjectId()
      if (!projectId || !api?.resetVisibilityBoundary) return

      return api.resetVisibilityBoundary(projectId).then(result => {
        if (result.success) {
          currentVisibilityBoundary = 0
          applyVisibilityToMessages(0, null)
          showToast((window.i18n?.t?.('auto.js_context_visibility_99_0') ?? ((window.i18n?.t?.('auto.js_context_visibility_99_1') ?? '已重置边界，所有消息对AI可见'))), 'success')
        }
      }).catch(err => {
        AppLogger.debug('[UI] 重置边界失败:', err)
        showToast((window.i18n?.t?.('auto.js_context_visibility_103_1') ?? ((window.i18n?.t?.('auto.js_context_visibility_103_2') ?? '重置失败'))), 'error')
      })
    }

    function showMemoryQuery() {
      const input = prompt(((window.i18n?.t?.('auto.js_context_visibility_108_3') ?? '请输入查询关键词：')))
      if (!input) return

      const projectId = getActiveProjectId()
      if (!projectId || !api?.recallMemory) return

      return api.recallMemory(projectId, input, 5).then(result => {
        if (result.success && result.results.length > 0) {
          let content = ((window.i18n?.t?.('auto.js_context_visibility_116_4') ?? '## 记忆查询结果\\n\\n'))
          result.results.forEach(f => {
            content += `--- Turn ${f.turn} ---\n`
            content += `用户: ${f.user}\n`
            if (f.ai) content += `AI: ${f.ai}\n`
            content += '\n'
          })

          addAiMessage(content)
          showToast(`找到 ${result.count} 条相关记录`, 'success')
        } else {
          showToast(result.hint || ((window.i18n?.t?.('auto.js_context_visibility_127_5') ?? '未找到相关记录')), 'info')
        }
      }).catch(err => {
        AppLogger.debug('[UI] 记忆查询失败:', err)
        showToast((window.i18n?.t?.('auto.js_context_visibility_131_2') ?? ((window.i18n?.t?.('auto.js_context_visibility_131_6') ?? '查询失败'))), 'error')
      })
    }

    function handleVisibilityBoundaryChanged(data) {
      if (data.projectId === getActiveProjectId()) {
        currentVisibilityBoundary = data.startIndex
        updateMessagesVisibility()
      }
    }

    function handleContextSplit(data) {
      if (data.projectId === getActiveProjectId()) {
        AppLogger.debug('[Frontend] 收到分割事件:', data.splitIndex)
        showSplitDivider(data.splitIndex)
      }
    }

    function showSplitDivider(splitIndex) {
      const chatMessages = getChatMessages()
      if (!chatMessages) return

      const messages = chatMessages.querySelectorAll('.message')
      const userMessages = Array.from(messages).filter(m => m.classList.contains('user'))

      if (splitIndex <= 0 || splitIndex >= userMessages.length) return

      const oldDivider = chatMessages.querySelector('.context-divider-auto')
      if (oldDivider) oldDivider.remove()

      const divider = document.createElement('div')
      divider.className = 'context-divider-auto'
      divider.innerHTML = ((window.i18n?.t?.('auto.js_context_visibility_163_7') ?? '<div class="context-divider-title">上下文已自动压缩为摘要</div>'))

      let targetMsg = null
      let userCount = 0
      messages.forEach(msg => {
        if (msg.classList.contains('user')) {
          userCount++
          if (userCount === splitIndex + 1) {
            targetMsg = msg
          }
        }
      })

      if (targetMsg) {
        chatMessages.insertBefore(divider, targetMsg)
      } else {
        chatMessages.appendChild(divider)
      }
    }

    api?.onVisibilityBoundaryChanged?.(handleVisibilityBoundaryChanged)
    api?.onContextSplit?.(handleContextSplit)

    return {
      updateMessagesVisibility,
      applyVisibilityToMessages,
      renderContextDivider,
      resetVisibility,
      showMemoryQuery,
      showSplitDivider
    }
  }

  window.ContextVisibility = { bind }
})()
