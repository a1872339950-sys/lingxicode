(function () {
  const isMac = /Mac|iPhone|iPad|iPod/i.test(navigator.platform || navigator.userAgent)
  const primaryModifier = isMac ? 'Meta' : 'Ctrl'
  const modifierLabel = isMac ? '⌘' : 'Ctrl'

  function isEditableTarget(target) {
    const element = target instanceof Element ? target : null
    if (!element) return false
    const tag = element.tagName.toLowerCase()
    return tag === 'input' || tag === 'textarea' || tag === 'select' || element.isContentEditable
  }

  function hasPrimaryModifier(event) {
    return isMac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey
  }

  function click(id) {
    const element = document.getElementById(id)
    if (!element || element.disabled) return false
    element.click()
    return true
  }

  function focusChatInput() {
    const input = document.getElementById('inputBox')
    if (!input) return false
    input.focus({ preventScroll: true })
    input.setSelectionRange(input.value.length, input.value.length)
    return true
  }

  function isAiRunning() {
    const sendButton = document.getElementById('sendBtn')
    return !!sendButton?.classList.contains('is-interrupt')
  }

  function stopAi() {
    if (!isAiRunning()) return false
    const input = document.getElementById('inputBox')
    if (input?.value?.trim()) return false
    return click('sendBtn')
  }

  function handle(event) {
    if (event.isComposing || event.repeat) return

    if (event.key === 'Escape') {
      if (!isEditableTarget(event.target) && stopAi()) {
        event.preventDefault()
        event.stopPropagation()
      }
      return
    }

    if (!hasPrimaryModifier(event)) return
    if (isEditableTarget(event.target)) return
    const key = event.key.toLowerCase()
    let handled = false

    if (key === 'l') {
      handled = focusChatInput()
    } else if (key === ',' && !event.shiftKey && !event.altKey) {
      handled = click('sidebarSettingsOpenBtn')
    } else if (key === 'm' && event.shiftKey && !event.altKey) {
      handled = click('modelTrigger')
    } else if (key === 'b' && !event.shiftKey && !event.altKey) {
      handled = click('sidebarToggle')
    } else if (key === 'e' && event.shiftKey && !event.altKey) {
      handled = click('rightViewToggle')
    } else if (key === '`' && !event.shiftKey && !event.altKey) {
      handled = click('toolbarTerminalBtn')
    } else if (key === 'g' && event.shiftKey && !event.altKey) {
      if (window.LingxiPanelManager?.openExclusive) {
        window.LingxiPanelManager.openExclusive('git', { hideChat: true })
        handled = true
      }
    } else if (key === 'n' && !event.shiftKey && !event.altKey) {
      if (window.TitlebarActions?.clearVisibleChatFromMenu) {
        window.TitlebarActions.clearVisibleChatFromMenu()
        handled = true
      }
    } else if (key === 'p' && event.shiftKey && !event.altKey) {
      handled = click('rightViewToggle')
    }

    if (handled) {
      event.preventDefault()
      event.stopPropagation()
    }
  }

  document.addEventListener('keydown', handle, true)

  window.KeyboardShortcuts = {
    isMac,
    primaryModifier,
    modifierLabel,
    focusChatInput,
    stopAi
  }

  function applyShortcutHints() {
    const hints = {
      inputBox: `${modifierLabel}+L 聚焦输入框`,
      sidebarSettingsOpenBtn: `${modifierLabel}+, 打开设置`,
      modelTrigger: `${modifierLabel}+Shift+M 打开模型选择`,
      sidebarToggle: `${modifierLabel}+B 折叠/展开侧栏`,
      rightViewToggle: `${modifierLabel}+Shift+E 显示/隐藏右侧视图`,
      toolbarTerminalBtn: `${modifierLabel}+Shift+\` 打开终端`
    }
    const sendBtn = document.getElementById('sendBtn')
    if (sendBtn && sendBtn.tagName === 'BUTTON') {
      const existing = sendBtn.getAttribute('title') || ''
      if (!existing.includes('Esc')) {
        sendBtn.setAttribute('title', existing ? `${existing}（Esc 中断 AI）` : 'Esc 中断 AI')
      }
    }
    Object.entries(hints).forEach(([id, hint]) => {
      const element = document.getElementById(id)
      if (!element) return
      const baseTitle = element.getAttribute('title') || ''
      const nextTitle = baseTitle && !baseTitle.includes(hint) ? `${baseTitle}（${hint}）` : hint
      element.setAttribute('title', nextTitle)
      if (element.tagName === 'BUTTON') element.setAttribute('aria-keyshortcuts', hint.split(' ')[0])
    })
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', applyShortcutHints, { once: true })
  } else {
    applyShortcutHints()
  }
})()
