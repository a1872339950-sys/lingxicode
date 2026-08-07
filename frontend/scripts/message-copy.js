/**
 * Message context actions.
 * Right click a message with no selected text to delete, multi-select, or quote it.
 * Copy is shown inline under each chat message.
 */

let multiSelectMode = false
const selectedMessages = new Map()
let contextMessageEl = null
let messageMenuEl = null
let multiToolbarEl = null
let contextTargetEl = null
let deleteConfirmEl = null
let messageMetadataObserver = null
let observedChatMessages = null

function initCopyButton() {
  const chatMessages = document.getElementById('chatMessages')
  if (!chatMessages) return

  if (!chatMessages.dataset.messageActionsBound) {
    chatMessages.dataset.messageActionsBound = 'true'
    chatMessages.addEventListener('contextmenu', handleMessageContextMenu, true)
    chatMessages.addEventListener('click', handleInlineMessageActionClick, true)
    chatMessages.addEventListener('click', handleMessageSelectClick, true)
  }

  ensureMessageMenu()
  ensureMultiToolbar()
  refreshMessageMetadata()

  if (messageMetadataObserver && observedChatMessages !== chatMessages) {
    messageMetadataObserver.disconnect()
    messageMetadataObserver = null
    observedChatMessages = null
  }

  if (!messageMetadataObserver) {
    observedChatMessages = chatMessages
    messageMetadataObserver = new MutationObserver(handleMessageTreeMutations)
    messageMetadataObserver.observe(chatMessages, { childList: true, subtree: true })
  }
}

function handleMessageTreeMutations(mutations) {
  const pending = new Set()
  for (const mutation of mutations) {
    for (const node of mutation.addedNodes || []) {
      collectMessageNodes(node, pending)
    }
  }
  if (!pending.size) return
  pending.forEach(processMessageMetadata)
}

function handleInlineMessageActionClick(event) {
  const branchButton = event.target.closest('.message-inline-branch-btn')
  if (branchButton) {
    event.preventDefault()
    event.stopPropagation()
    createBranchFromMessageButton(branchButton)
    return
  }
  const copyButton = event.target.closest('.message-inline-copy-btn')
  if (!copyButton) return
  event.preventDefault()
  event.stopPropagation()
  copyMessageFromButton(copyButton)
}

function collectMessageNodes(node, targetSet) {
  if (!node || node.nodeType !== Node.ELEMENT_NODE || !targetSet) return
  if (node.matches?.('.message.user, .message.ai')) {
    targetSet.add(node)
  }
  node.querySelectorAll?.('.message.user, .message.ai').forEach(msg => targetSet.add(msg))
}

function processMessageMetadata(msg) {
  if (!msg || !msg.classList) return
  if (msg.classList.contains('user')) {
    msg.dataset.messagePart = msg.dataset.messagePart || 'user'
  } else if (msg.classList.contains('ai')) {
    msg.dataset.messagePart = msg.dataset.messagePart || 'assistant'
  } else {
    return
  }
  ensureSelectCircle(msg)
  ensureMessageInlineActions(msg)
}

function refreshMessageMetadata(root = null) {
  const chatMessages = root || document.getElementById('chatMessages')
  if (!chatMessages) return
  const pending = new Set()
  collectMessageNodes(chatMessages, pending)
  pending.forEach(processMessageMetadata)
}

function copyIconSvg() {
  return '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>'
}

function branchIconSvg() {
  return '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="6" cy="6" r="2"/><circle cx="18" cy="18" r="2"/><path d="M8 6h3a3 3 0 0 1 3 3v6a3 3 0 0 0 3 3h1"/></svg>'
}

function buildBranchTitleFromText(text = '') {
  const raw = String(text || '')
    .replace(/\s+/g, ' ')
    .trim()
  if (!raw) return ''
  return raw.length > 20 ? `${raw.slice(0, 20)}...` : raw
}

async function createBranchFromMessageButton(button) {
  const msgEl = button?.closest?.('.message.user, .message.ai')
  if (!msgEl) return
  const createBranch = window.ProjectBranchSession?.openCreateBranchFromMessage
  if (typeof createBranch !== 'function') {
    showActionToast('当前版本暂不支持从消息创建分支', 'error')
    return
  }
  const messageText = getMessageText(msgEl)
  const preferredTitle = buildBranchTitleFromText(messageText)
  try {
    await createBranch({
      preferredTitle,
      sourceMessageText: messageText,
      createdFrom: 'message_inline_copy'
    })
  } catch (error) {
    console.error('[Frontend] create branch from message failed:', error)
    showActionToast(error?.message || '创建分支失败', 'error')
  }
}

function checkIconSvg() {
  return '<svg viewBox="0 0 24 24" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>'
}

function padTimePart(value) {
  return String(value).padStart(2, '0')
}

function formatClockTime(date) {
  return `${padTimePart(date.getHours())}:${padTimePart(date.getMinutes())}`
}

function parseMessageTime(value) {
  const raw = String(value || '').trim()
  if (!raw) return new Date()

  const numeric = Number(raw)
  if (Number.isFinite(numeric) && numeric > 0) {
    const date = new Date(numeric)
    if (!Number.isNaN(date.getTime())) return date
  }

  const direct = new Date(raw)
  if (!Number.isNaN(direct.getTime())) return direct

  const dateTimeMatch = raw.match(/(?:^|\s)(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?\s+(\d{1,2})[:：](\d{2})(?::\d{2})?/)
  if (dateTimeMatch) {
    const now = new Date()
    const month = Number(dateTimeMatch[1])
    const day = Number(dateTimeMatch[2])
    const yearText = dateTimeMatch[3]
    const year = yearText
      ? (yearText.length === 2 ? 2000 + Number(yearText) : Number(yearText))
      : now.getFullYear()
    const date = new Date(year, month - 1, day, Number(dateTimeMatch[4]), Number(dateTimeMatch[5]))
    if (!Number.isNaN(date.getTime())) return date
  }

  const timeMatch = raw.match(/(\d{1,2})[:：](\d{2})(?::\d{2})?/)
  if (timeMatch) {
    const now = new Date()
    return new Date(now.getFullYear(), now.getMonth(), now.getDate(), Number(timeMatch[1]), Number(timeMatch[2]))
  }

  return null
}

function formatInlineMessageTime(value) {
  const date = parseMessageTime(value)
  if (!date) return String(value || '').trim()
  const timeStr = formatClockTime(date)
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const msgDay = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  const diffDays = Math.floor((today - msgDay) / (24 * 60 * 60 * 1000))
  if (diffDays === 0) return `今天 ${timeStr}`
  if (diffDays === 1) return `昨天 ${timeStr}`
  return `${date.getMonth() + 1}/${date.getDate()} ${timeStr}`
}
function ensureMessageInlineActions(msgEl) {
  if (!msgEl || msgEl.classList.contains('thinking')) return
  let actionsEl = msgEl.querySelector(':scope > .message-inline-actions')
  if (!actionsEl) {
    actionsEl = document.createElement('div')
    actionsEl.className = 'message-inline-actions'
    actionsEl.innerHTML = `
      <span class="message-inline-time"></span>
      <button class="message-inline-branch-btn" type="button" title="创建分支" aria-label="创建分支">${branchIconSvg()}</button>
      <button class="message-inline-copy-btn" type="button" title="复制消息" aria-label="复制消息">${copyIconSvg()}</button>
    `
    msgEl.appendChild(actionsEl)
  } else if (!actionsEl.querySelector('.message-inline-branch-btn')) {
    const copyBtn = actionsEl.querySelector('.message-inline-copy-btn')
    const branchBtn = document.createElement('button')
    branchBtn.className = 'message-inline-branch-btn'
    branchBtn.type = 'button'
    branchBtn.title = '创建分支'
    branchBtn.setAttribute('aria-label', '创建分支')
    branchBtn.innerHTML = branchIconSvg()
    if (copyBtn) actionsEl.insertBefore(branchBtn, copyBtn)
    else actionsEl.appendChild(branchBtn)
  }
  const timeEl = actionsEl.querySelector('.message-inline-time')
  if (timeEl) timeEl.textContent = formatInlineMessageTime(msgEl.dataset.messageTime)
}

function handleMessageContextMenu(event) {
  const selectedText = window.getSelection()?.toString()?.trim()
  if (selectedText) return

  const dividerEl = event.target.closest('.context-divider-auto[data-summary-id]')
  const msgEl = event.target.closest('.message.user, .message.ai')
  if (!dividerEl && (!msgEl || msgEl.classList.contains('thinking'))) return

  event.preventDefault()
  event.stopPropagation()
  contextMessageEl = msgEl || dividerEl
  contextTargetEl = event.target
  showMessageMenu(event.clientX, event.clientY)
}

function handleMessageSelectClick(event) {
  if (!multiSelectMode) return
  const msgEl = event.target.closest('.message.user, .message.ai')
  if (!msgEl || msgEl.classList.contains('thinking')) return
  event.preventDefault()
  event.stopPropagation()
  toggleMessageSelection(msgEl)
  updateMultiToolbar()
}


function ensureMessageMenu() {
  if (messageMenuEl) return messageMenuEl
  messageMenuEl = document.createElement('div')
  messageMenuEl.className = 'message-context-menu'
  messageMenuEl.innerHTML = `
    <button type="button" data-action="quote">引用</button>
    <button type="button" data-action="multi">多选</button>
    <button type="button" data-action="delete" class="danger">删除</button>
  `
  messageMenuEl.addEventListener('click', event => {
    const button = event.target.closest('button[data-action]')
    if (!button) return
    handleMenuAction(button.dataset.action)
  })
  document.body.appendChild(messageMenuEl)

  document.addEventListener('click', event => {
    if (!messageMenuEl.contains(event.target)) hideMessageMenu()
  })
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      hideMessageMenu()
      if (multiSelectMode) exitMultiSelectMode()
    }
  })
  return messageMenuEl
}

function showMessageMenu(x, y) {
  ensureMessageMenu()
  messageMenuEl.classList.add('show')
  const rect = messageMenuEl.getBoundingClientRect()
  const finalX = Math.min(x, window.innerWidth - rect.width - 8)
  const finalY = Math.min(y, window.innerHeight - rect.height - 8)
  messageMenuEl.style.left = `${Math.max(8, finalX)}px`
  messageMenuEl.style.top = `${Math.max(8, finalY)}px`
}

function hideMessageMenu() {
  messageMenuEl?.classList.remove('show')
}

async function handleMenuAction(action) {
  const msgEl = contextMessageEl
  hideMessageMenu()
  if (!msgEl) return

  if (action === 'copy') {
    await copyMessage(msgEl)
    return
  }

  if (action === 'quote') {
    quoteMessage(msgEl)
    return
  }

  if (action === 'multi') {
    enterMultiSelectMode(msgEl)
    return
  }

  if (action === 'delete') {
    await deleteSelections([getMessageSelection(msgEl)], { highlightMessages: [msgEl] })
  }
}

async function copyMessage(msgEl) {
  const text = getMessageText(msgEl)
  if (!text) return
  await navigator.clipboard.writeText(text)
  showActionToast(((window.i18n?.t?.('auto.js_message_copy_142_1') ?? '复制成功')), 'success')
}

async function copyMessageFromButton(button) {
  const msgEl = button?.closest?.('.message.user, .message.ai')
  if (!msgEl || msgEl.classList.contains('thinking')) return
  try {
    await copyMessage(msgEl)
    button.classList.add('copied')
    button.innerHTML = checkIconSvg()
    window.clearTimeout(Number(button.dataset.resetTimer || 0))
    button.dataset.resetTimer = String(window.setTimeout(() => {
      button.classList.remove('copied')
      button.innerHTML = copyIconSvg()
      button.dataset.resetTimer = ''
    }, 1400))
  } catch (error) {
    showActionToast(error?.message || '复制失败', 'error')
  }
}

function quoteMessage(msgEl) {
  const summaryDivider = getSummaryDividerFromTarget(msgEl)
  if (summaryDivider) {
    window.ChatMessageActions?.addQuotedReference?.({
      type: 'summary',
      summaryId: summaryDivider.summaryId,
      title: summaryDivider.title,
      preview: summaryDivider.preview
    })
    return
  }

  const selection = getMessageSelection(msgEl)
  if (!selection) return
  window.ChatMessageActions?.addQuotedReference?.({
    type: 'message',
    turnId: selection.turnId,
    part: selection.part,
    title: selection.part === 'user' ? `用户消息 #${selection.turnId}` : `AI消息 #${selection.turnId}`,
    content: getMessageText(msgEl)
  })
}

function getSummaryDividerFromTarget(msgEl) {
  const divider = contextTargetEl?.closest?.('.context-divider-auto[data-summary-id]') || msgEl?.closest?.('.context-divider-auto[data-summary-id]')
  if (!divider?.dataset?.summaryId) return null
  return {
    summaryId: divider.dataset.summaryId,
    title: `压缩摘要 ${divider.dataset.summaryId}`,
    preview: divider.textContent?.trim()?.slice(0, 160) || ''
  }
}

function getArtifactFromTarget(msgEl) {
  return null
}
function enterMultiSelectMode(initialMsg) {
  multiSelectMode = true
  document.body.classList.add('message-multi-select-mode')
  refreshMessageMetadata()
  selectedMessages.clear()
  toggleMessageSelection(initialMsg, true)
  updateMultiToolbar()
}

function exitMultiSelectMode() {
  multiSelectMode = false
  document.body.classList.remove('message-multi-select-mode')
  selectedMessages.clear()
  document.querySelectorAll('.message.multi-selected').forEach(el => el.classList.remove('multi-selected'))
  updateSelectCircles()
  updateMultiToolbar()
}

function ensureSelectCircle(msgEl) {
  if (msgEl.querySelector(':scope > .message-select-circle')) return
  const circle = document.createElement('span')
  circle.className = 'message-select-circle'
  circle.innerHTML = '<span></span>'
  msgEl.insertBefore(circle, msgEl.firstChild)
}

function toggleMessageSelection(msgEl, forceSelected = null) {
  const selection = getMessageSelection(msgEl)
  if (!selection) return

  const isSelected = selectedMessages.has(selection.key)
  const shouldSelect = forceSelected === null ? !isSelected : forceSelected
  if (shouldSelect) {
    selectedMessages.set(selection.key, selection)
  } else {
    selectedMessages.delete(selection.key)
  }
  updateSelectCircles()
}

function updateSelectCircles() {
  document.querySelectorAll('.message.user, .message.ai').forEach(msgEl => {
    const selection = getMessageSelection(msgEl)
    const selected = selection && selectedMessages.has(selection.key)
    msgEl.classList.toggle('multi-selected', !!selected)
  })
}

function ensureMultiToolbar() {
  if (multiToolbarEl) return multiToolbarEl
  const inputWrapper = document.getElementById('inputWrapper')
  const inputArea = document.querySelector('.chat-input-area')
  if (!inputWrapper || !inputArea) return null
  multiToolbarEl = document.createElement('div')
  multiToolbarEl.className = 'message-multi-toolbar'
  multiToolbarEl.innerHTML = `
    <button type="button" data-action="clear">一键取消多选</button>
    <button type="button" data-action="delete" class="danger">删除</button>
    <button type="button" data-action="date-range">按日期删除</button>
    <button type="button" data-action="exit">退出</button>
  `
  multiToolbarEl.addEventListener('click', async event => {
    const action = event.target.closest('button[data-action]')?.dataset.action
    if (!action) return
    if (action === 'clear') {
      selectedMessages.clear()
      updateSelectCircles()
      updateMultiToolbar()
    } else if (action === 'delete') {
      await deleteSelections(Array.from(selectedMessages.values()))
    } else if (action === 'date-range') {
      await handleDateRangeDelete()
    } else if (action === 'exit') {
      exitMultiSelectMode()
    }
  })
  inputArea.insertBefore(multiToolbarEl, inputWrapper)
  return multiToolbarEl
}

function updateMultiToolbar() {
  ensureMultiToolbar()
  if (!multiToolbarEl) return
  multiToolbarEl.classList.toggle('show', multiSelectMode)
  const deleteBtn = multiToolbarEl.querySelector('[data-action="delete"]')
  if (deleteBtn) {
    deleteBtn.textContent = selectedMessages.size > 0 ? `删除(${selectedMessages.size})` : ((window.i18n?.t?.('auto.js_message_copy_264_2') ?? '删除'))
    deleteBtn.disabled = selectedMessages.size === 0
  }
}

async function deleteSelections(selections, options = {}) {
  const validSelections = (selections || []).filter(Boolean)
  if (validSelections.length === 0) return
  const pendingHighlights = applyPendingDeleteHighlights(options.highlightMessages)

  const deleteOptions = await confirmMessageDelete(validSelections.length)
  if (!deleteOptions?.confirmed) {
    clearPendingDeleteHighlights(pendingHighlights)
    return
  }

  const projectId = window.ChatMessageActions?.getActiveProjectId?.()
  if (!projectId || !window.api?.deleteMessages) {
    clearPendingDeleteHighlights(pendingHighlights)
    return
  }
  if (window.ChatMessageActions?.canDeleteMessages && !window.ChatMessageActions.canDeleteMessages()) {
    clearPendingDeleteHighlights(pendingHighlights)
    showActionToast(((window.i18n?.t?.('auto.js_message_copy_287_3') ?? 'AI正在处理时不能删除消息，请等本轮完成后再删除。')), 'error')
    return
  }

  const result = await window.api.deleteMessages(
    projectId,
    validSelections.map(({ turnId, part, historyStart, historyEnd, messageIds }) => ({ turnId, part, historyStart, historyEnd, messageIds })),
    { deleteMemory: !!deleteOptions.deleteMemory }
  )
  if (!result?.success) {
    clearPendingDeleteHighlights(pendingHighlights)
    showActionToast(result?.error || ((window.i18n?.t?.('auto.js_message_copy_298_4') ?? '删除失败')), 'error')
    return
  }

  clearPendingDeleteHighlights(pendingHighlights)
  exitMultiSelectMode()
  window.ChatMessageActions?.replaceHistory?.(result.messages || result.messagesHistory || [], result)
}

function applyPendingDeleteHighlights(messages) {
  if (multiSelectMode) return []
  const highlighted = (messages || []).filter(Boolean)
  highlighted.forEach(msgEl => {
    ensureSelectCircle(msgEl)
    msgEl.classList.add('delete-pending', 'multi-selected')
  })
  return highlighted
}

function clearPendingDeleteHighlights(messages) {
  ;(messages || []).forEach(msgEl => {
    msgEl.classList.remove('delete-pending', 'multi-selected')
  })
}

function promptDateRangeDelete() {
  return new Promise(resolve => {
    let resolved = false
    const overlay = document.createElement('div')
    overlay.className = 'message-delete-confirm date-range-overlay'
    overlay.innerHTML = `
      <div class="message-delete-confirm-panel date-range-panel" role="dialog" aria-modal="true">
        <div class="message-delete-confirm-title">按日期范围删除</div>
        <div class="date-range-hint">将删除指定日期范围内的所有消息和对应记忆</div>
        <div class="date-range-field">
          <label>开始日期</label>
          <input type="date" data-field="start">
        </div>
        <div class="date-range-field">
          <label>结束日期</label>
          <input type="date" data-field="end">
        </div>
        <div class="message-delete-confirm-actions">
          <button type="button" class="message-delete-confirm-btn secondary" data-action="cancel">取消</button>
          <button type="button" class="message-delete-confirm-btn danger" data-action="confirm">删除该范围</button>
        </div>
      </div>
    `
    const startInput = overlay.querySelector('[data-field="start"]')
    const endInput = overlay.querySelector('[data-field="end"]')
    const now = new Date()
    let earliest = null
    document.querySelectorAll('.message').forEach(msgEl => {
      const t = msgEl?.dataset?.messageTime
      if (!t) return
      const ms = parseMessageTime(t).getTime()
      if (!isNaN(ms) && (earliest === null || ms < earliest)) earliest = ms
    })
    const startDate = earliest !== null ? new Date(earliest) : new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
    if (startInput) startInput.value = toLocalDateInput(startDate)
    if (endInput) endInput.value = toLocalDateInput(now)

    ;[startInput, endInput].forEach(input => {
      if (!input) return
      input.addEventListener('click', () => {
        if (typeof input.showPicker === 'function') {
          try { input.showPicker() } catch (_) {}
        }
      })
      const label = input.parentElement?.querySelector('label')
      if (label) {
        label.style.cursor = 'pointer'
        label.addEventListener('click', () => {
          input.focus()
          if (typeof input.showPicker === 'function') {
            try { input.showPicker() } catch (_) {}
          }
        })
      }
    })

    function close(value) {
      if (resolved) return
      resolved = true
      document.removeEventListener('keydown', onKeydown)
      overlay.remove()
      resolve(value)
    }
    function onKeydown(event) {
      if (event.key === 'Escape') close(null)
    }
    overlay.addEventListener('click', event => {
      const action = event.target.closest('[data-action]')?.dataset.action
      if (action === 'cancel') close(null)
      if (event.target === overlay) close(null)
      if (action === 'confirm') {
        const startVal = startInput?.value
        const endVal = endInput?.value
        if (!startVal || !endVal) { showActionToast('请选择开始和结束日期', 'error'); return }
        const startTime = new Date(startVal + 'T00:00:00')
        const endTime = new Date(endVal + 'T23:59:59.999')
        if (isNaN(startTime.getTime()) || isNaN(endTime.getTime())) { showActionToast('日期格式无效', 'error'); return }
        if (startTime > endTime) { showActionToast('开始日期不能晚于结束日期', 'error'); return }
        close({ startTime, endTime })
      }
    })
    document.addEventListener('keydown', onKeydown)
    document.body.appendChild(overlay)
    bindDeleteConfirmDrag(overlay.querySelector('.date-range-panel'))
    overlay.querySelector('[data-action="confirm"]')?.focus()
  })
}

function toLocalDateInput(date) {
  const pad = n => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

function collectSelectionsByDateRange(startTime, endTime) {
  const startMs = startTime.getTime()
  const endMs = endTime.getTime()
  const selections = []
  const seen = new Set()
  document.querySelectorAll('.message').forEach(msgEl => {
    const timeStr = msgEl?.dataset?.messageTime
    if (!timeStr) return
    const msgTime = parseMessageTime(timeStr).getTime()
    if (isNaN(msgTime)) return
    if (msgTime < startMs || msgTime > endMs) return
    const sel = getMessageSelection(msgEl)
    if (!sel || seen.has(sel.key)) return
    seen.add(sel.key)
    selections.push(sel)
  })
  return selections
}

function confirmRoundDelete(roundCount) {
  if (deleteConfirmEl) deleteConfirmEl.remove()

  return new Promise(resolve => {
    let resolved = false
    deleteConfirmEl = document.createElement('div')
    deleteConfirmEl.className = 'message-delete-confirm'
    deleteConfirmEl.innerHTML = `
      <div class="message-delete-confirm-panel" role="dialog" aria-modal="true">
        <div class="message-delete-confirm-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M3 6h18"/>
            <path d="M8 6V4h8v2"/>
            <path d="M19 6l-1 15H6L5 6"/>
            <path d="M10 11v6"/>
            <path d="M14 11v6"/>
          </svg>
        </div>
        <div class="message-delete-confirm-main">
          <div class="message-delete-confirm-title">确认删除</div>
          <div class="message-delete-confirm-text">该范围内共 ${roundCount} 轮消息，是否确认删除？</div>
          <div class="message-delete-confirm-actions">
            <button type="button" class="message-delete-confirm-btn secondary" data-action="cancel">否</button>
            <button type="button" class="message-delete-confirm-btn danger" data-action="confirm">是</button>
          </div>
        </div>
      </div>
    `

    function close(value) {
      if (resolved) return
      resolved = true
      document.removeEventListener('keydown', onKeydown)
      deleteConfirmEl?.remove()
      deleteConfirmEl = null
      resolve(value)
    }

    function onKeydown(event) {
      if (event.key === 'Escape') close(false)
      if (event.key === 'Enter') close(true)
    }

    deleteConfirmEl.addEventListener('click', event => {
      const action = event.target.closest('[data-action]')?.dataset.action
      if (action === 'confirm') close(true)
      if (action === 'cancel') close(false)
      if (event.target === deleteConfirmEl) close(false)
    })
    document.addEventListener('keydown', onKeydown)
    document.body.appendChild(deleteConfirmEl)
    deleteConfirmEl.querySelector('[data-action="confirm"]')?.focus()
  })
}

async function handleDateRangeDelete() {
  const range = await promptDateRangeDelete()
  if (!range) return
  const selections = collectSelectionsByDateRange(range.startTime, range.endTime)
  if (selections.length === 0) {
    showActionToast('该日期范围内没有找到消息', 'info')
    return
  }
  const turnIds = new Set()
  for (const sel of selections) {
    if (Number.isInteger(sel.turnId) && sel.turnId > 0) turnIds.add(sel.turnId)
  }
  const roundCount = turnIds.size
  if (roundCount > 0) {
    const confirmed = await confirmRoundDelete(roundCount)
    if (!confirmed) return
  }
  await new Promise(r => setTimeout(r, 50))
  await deleteSelections(selections)
}

function confirmMessageDelete(count) {
  if (deleteConfirmEl) deleteConfirmEl.remove()

  return new Promise(resolve => {
    let resolved = false
    deleteConfirmEl = document.createElement('div')
    deleteConfirmEl.className = 'message-delete-confirm'
    deleteConfirmEl.innerHTML = `
      <div class="message-delete-confirm-panel" role="dialog" aria-modal="true" aria-labelledby="messageDeleteConfirmTitle">
        <div class="message-delete-confirm-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M3 6h18"/>
            <path d="M8 6V4h8v2"/>
            <path d="M19 6l-1 15H6L5 6"/>
            <path d="M10 11v6"/>
            <path d="M14 11v6"/>
          </svg>
        </div>
        <div class="message-delete-confirm-main">
          <div class="message-delete-confirm-title" id="messageDeleteConfirmTitle">删除消息</div>
          <div class="message-delete-confirm-text"></div>
          <div class="message-delete-confirm-options">
            <div class="message-delete-context-row">
              <span class="message-delete-context-lock" aria-hidden="true"></span>
              <span>上下文固定删除</span>
            </div>
            <label class="message-delete-memory-option">
              <input type="checkbox" data-memory-delete>
              <span class="message-delete-memory-circle" aria-hidden="true"><span></span></span>
              <span>同时删除记忆</span>
            </label>
          </div>
          <div class="message-delete-confirm-actions">
            <button type="button" class="message-delete-confirm-btn secondary" data-action="cancel">取消</button>
            <button type="button" class="message-delete-confirm-btn danger" data-action="confirm">确定删除</button>
          </div>
        </div>
      </div>
    `

    const textEl = deleteConfirmEl.querySelector('.message-delete-confirm-text')
    if (textEl) {
      textEl.textContent = count > 1
        ? `确定需要把这 ${count} 条消息从上下文和记忆中删除掉吗？`
        : ((window.i18n?.t?.('auto.js_message_copy_367_5') ?? '确定需要把这条消息从上下文和记忆中删除掉吗？'))
    }

    function close(value) {
      if (resolved) return
      resolved = true
      document.removeEventListener('keydown', onKeydown)
      const deleteMemory = !!deleteConfirmEl?.querySelector('[data-memory-delete]')?.checked
      deleteConfirmEl?.remove()
      deleteConfirmEl = null
      resolve({ confirmed: value, deleteMemory })
    }

    function onKeydown(event) {
      if (event.key === 'Escape') close(false)
      if (event.key === 'Enter') close(true)
    }

    deleteConfirmEl.addEventListener('click', event => {
      const action = event.target.closest('[data-action]')?.dataset.action
      if (action === 'confirm') close(true)
      if (action === 'cancel') close(false)
      if (event.target === deleteConfirmEl) close(false)
    })

    document.addEventListener('keydown', onKeydown)
    document.body.appendChild(deleteConfirmEl)
    bindDeleteConfirmDrag(deleteConfirmEl.querySelector('.message-delete-confirm-panel'))
    deleteConfirmEl.querySelector('[data-action="confirm"]')?.focus()
  })
}

function bindDeleteConfirmDrag(panel) {
  if (!panel) return
  const state = {
    dragging: false,
    startX: 0,
    startY: 0,
    offsetX: 0,
    offsetY: 0,
    startOffsetX: 0,
    startOffsetY: 0
  }

  function applyOffset(x, y) {
    const rect = panel.getBoundingClientRect()
    const nextX = Math.min(Math.max(x, -rect.left + 12 + state.offsetX), window.innerWidth - rect.right - 12 + state.offsetX)
    const nextY = Math.min(Math.max(y, -rect.top + 12 + state.offsetY), window.innerHeight - rect.bottom - 12 + state.offsetY)
    state.offsetX = nextX
    state.offsetY = nextY
    panel.style.transform = `translate(${nextX}px, ${nextY}px)`
  }

  panel.addEventListener('pointerdown', event => {
    if (event.button !== 0) return
    if (event.target.closest('button, input, label, [data-action]')) return
    state.dragging = true
    state.startX = event.clientX
    state.startY = event.clientY
    state.startOffsetX = state.offsetX
    state.startOffsetY = state.offsetY
    panel.classList.add('dragging')
    panel.setPointerCapture?.(event.pointerId)
    event.preventDefault()
  })

  panel.addEventListener('pointermove', event => {
    if (!state.dragging) return
    applyOffset(state.startOffsetX + event.clientX - state.startX, state.startOffsetY + event.clientY - state.startY)
  })

  panel.addEventListener('pointerup', event => {
    state.dragging = false
    panel.classList.remove('dragging')
    panel.releasePointerCapture?.(event.pointerId)
  })

  panel.addEventListener('pointercancel', event => {
    state.dragging = false
    panel.classList.remove('dragging')
    panel.releasePointerCapture?.(event.pointerId)
  })
}

function getMessageSelection(msgEl) {
  const turnId = Number(msgEl?.dataset?.turnId)
  const part = msgEl?.dataset?.messagePart || (msgEl?.classList?.contains('user') ? 'user' : 'assistant')
  if (part !== 'user' && part !== 'assistant') return null
  const messageIds = part === 'assistant'
    ? String(msgEl?.dataset?.messageIds || '').split(',').map(value => value.trim()).filter(Boolean)
    : [String(msgEl?.dataset?.messageId || '').trim()].filter(Boolean)
  if (messageIds.length > 0) {
    return { key: `messages:${messageIds.join(':')}`, messageIds, turnId, part }
  }
  if (part === 'user') {
    const historyIndex = Number(msgEl?.dataset?.historyIndex)
    if (Number.isInteger(historyIndex) && historyIndex >= 0) {
      return { key: `history:${historyIndex}:${historyIndex + 1}`, historyStart: historyIndex, historyEnd: historyIndex + 1, turnId, part }
    }
  }
  if (part === 'assistant') {
    const historyStart = Number(msgEl?.dataset?.historyStart)
    const historyEnd = Number(msgEl?.dataset?.historyEnd)
    if (Number.isInteger(historyStart) && Number.isInteger(historyEnd) && historyStart >= 0 && historyEnd > historyStart) {
      return { key: `history:${historyStart}:${historyEnd}`, historyStart, historyEnd, turnId, part }
    }
  }
  if (!Number.isInteger(turnId) || turnId < 1) return null
  return { key: `${part}:${turnId}`, turnId, part }
}

function getMessageText(msgEl) {
  if (!msgEl) return ''
  const stripMentionDirectives = window.WorkbenchMention?.stripMentionDirectives || (value => String(value || '').trim())
  if (msgEl.classList.contains('user')) {
    const fullUserText = msgEl.querySelector('.user-message-full')?.textContent
    if (fullUserText) return stripMentionDirectives(fullUserText)
    return stripMentionDirectives(msgEl.querySelector('.message-bubble')?.textContent || '')
  }

  // AI 消息：只复制正文，排除操作摘要等 UI 组件文本
  const content = msgEl.querySelector('.ai-content')
  if (!content) return String(msgEl.textContent || '').trim()

  const clone = content.cloneNode(true)
  clone.querySelectorAll([
    '.ai-summary',
    '.summary-actions',
    '.message-inline-actions',
    'button',
    'script',
    'style'
  ].join(',')).forEach(node => node.remove())

  return String(clone.textContent || '')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function getMessageByTurn(part, turnId) {
  const value = Number(turnId)
  if (!Number.isInteger(value) || value < 1) return null
  return document.querySelector(`.message.${part}[data-turn-id="${value}"]`)
}

function showActionToast(message, type = 'info') {
  if (window.ChatMessageActions?.showToast) {
    window.ChatMessageActions.showToast(message, type)
  } else if (window.ToastUI?.show) {
    window.ToastUI.show(message, type)
  } else {
    (window.AppLogger || console).warn(message)
  }
}

window.CopyButton = {
  init: initCopyButton,
  refresh: refreshMessageMetadata
}
