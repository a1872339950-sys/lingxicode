// 消息队列模块
// 按项目隔离的双通道队列：
// - 普通队列 (normalQueue)：FIFO，AI 当前轮结束后按顺序发送
// - 注入通道 (interjectQueue)：FIFO，当前工具批次结束后注入运行时上下文
// 每个项目的队列状态都挂在 project._queueState 上，切换项目时自然隔离。
//
// 行为模型：
// - 空闲 + 输入有字 + 点击发送 → 立即发送
// - 执行中 + 输入有字 + 点击发送 → 进普通队列（FIFO，不打断当前 AI）
// - 执行中 + 输入空 + 点击按钮 → 中断 AI
// - 队列消息胶囊上的「消息注入」 → 立即显示到聊天区并注入运行中 AI 上下文
// - 队列消息胶囊上的「×」 → 从队列移除
// - 点击胶囊标题 → 弹窗查看完整内容 + 发送/消息注入/删除
//
// 依赖注入（bind 时传入）：
//   getProjects / getActiveProjectId / getActiveProject
//   getInputBox / clearInputBox
//   sendMessageDirect (options)         真正发送消息的函数（不经过队列）
//   promoteInterjectToBackend (item)    通知后端把消息注入当前 AI 上下文
//   showToast

(function () {
  let deps = {}

  const escapeHtml = HtmlUtils.escapeHtml

  function markInjectedMessagesConsumed(itemIds = []) {
    const ids = new Set((Array.isArray(itemIds) ? itemIds : []).map(id => String(id || '')).filter(Boolean))
    if (!ids.size) return
    ids.forEach(id => {
      let msg = null
      try {
        msg = document.querySelector(`.message-user-interject[data-item-id="${CSS.escape(id)}"]`)
      } catch (_) {
        msg = document.querySelector(`.message-user-interject[data-item-id="${id.replace(/"/g, '\\"')}"]`)
      }
      if (msg) msg.setAttribute('data-interject-state', 'consumed')
    })
  }

  function truncateTitle(text, max = 28) {
    const cleaned = String(text == null ? '' : text).replace(/\s+/g, ' ').trim()
    if (!cleaned) return '（空消息）'
    if (cleaned.length <= max) return cleaned
    return cleaned.slice(0, max) + '…'
  }

  function getQueueState(project) {
    if (!project) return null
    if (!project._queueState) {
      project._queueState = {
        normal: [],
        interject: [],
        idCounter: 0,
        modalItemId: null
      }
    }
    return project._queueState
  }

  function getActiveProject() {
    const id = deps.getActiveProjectId?.()
    if (!id) return null
    return deps.getProjects?.().find(p => p.id === id) || null
  }

  function findProjectById(projectId) {
    const id = String(projectId || '')
    if (!id) return null
    return (deps.getProjects?.() || []).find(p => p && p.id === id) || null
  }

  function rememberInjectedInterject(project, item, state = 'queued') {
    if (!project || !item) return null
    if (!Array.isArray(project._injectedInterjectMessages)) project._injectedInterjectMessages = []
    const itemId = String(item.id || item.itemId || '')
    const content = String(item.content || '')
    if (!itemId || !content.trim()) return null
    const existing = project._injectedInterjectMessages.find(entry => String(entry.id || '') === itemId)
    const snapshot = {
      id: itemId,
      content,
      createdAt: Number(item.createdAt || Date.now()),
      injectedAt: Number(item.injectedAt || Date.now()),
      chatSessionId: String(item.chatSessionId || project._runningSessionId || project.chatSessionId || '').trim() || 'main',
      anchorMessageId: String(item.anchorMessageId || existing?.anchorMessageId || '').trim(),
      anchorHistoryIndex: item.anchorHistoryIndex !== null && item.anchorHistoryIndex !== undefined && item.anchorHistoryIndex !== '' && Number.isFinite(Number(item.anchorHistoryIndex))
        ? Number(item.anchorHistoryIndex)
        : (existing?.anchorHistoryIndex ?? null),
      anchorTurnId: item.anchorTurnId !== null && item.anchorTurnId !== undefined && item.anchorTurnId !== '' && Number.isFinite(Number(item.anchorTurnId))
        ? Number(item.anchorTurnId)
        : (existing?.anchorTurnId ?? null),
      state: state || item.state || 'queued'
    }
    if (existing) {
      Object.assign(existing, snapshot)
      return existing
    }
    project._injectedInterjectMessages.push(snapshot)
    return snapshot
  }

  function markStoredInjectedMessagesConsumed(projectId, itemIds = []) {
    const project = findProjectById(projectId) || getActiveProject()
    if (!project || !Array.isArray(project._injectedInterjectMessages)) return
    const ids = new Set((Array.isArray(itemIds) ? itemIds : []).map(id => String(id || '')).filter(Boolean))
    if (!ids.size) return
    project._injectedInterjectMessages.forEach(item => {
      if (ids.has(String(item.id || ''))) item.state = 'consumed'
    })
  }

  function nextId(state) {
    state.idCounter += 1
    return `q${Date.now().toString(36)}${state.idCounter}`
  }

  function buildItem(content, isInterject = false) {
    return {
      id: '', // 由 enqueue 时填充
      content: String(content || ''),
      displayTitle: truncateTitle(content),
      createdAt: Date.now(),
      isInterject: !!isInterject,
      attachments: [], // 预留：附件/引用，与 sendMessage 入参对齐
      hidden: false,   // 预留：是否只在 UI 中可见
      references: []   // 预留：引用条目
    }
  }

  function enqueue(content, options = {}) {
    const project = getActiveProject()
    if (!project) return null
    const state = getQueueState(project)
    if (!state) return null
    if (!String(content || '').trim() && !(options.attachments?.length)) return null
    const item = buildItem(content, !!options.interject)
    item.id = nextId(state)
    if (item.attachments?.length || options.attachments) {
      item.attachments = options.attachments || []
    }
    if (options.references) item.references = options.references
    if (options.hidden) item.hidden = !!options.hidden
    const target = item.isInterject ? state.interject : state.normal
    target.push(item)
    render()
    return item
  }

  function removeById(itemId) {
    const project = getActiveProject()
    if (!project) return false
    const state = getQueueState(project)
    if (!state) return false
    const beforeNormal = state.normal.length
    const beforeInterject = state.interject.length
    state.normal = state.normal.filter(item => item.id !== itemId)
    state.interject = state.interject.filter(item => item.id !== itemId)
    if (state.modalItemId === itemId) state.modalItemId = null
    if (state.normal.length !== beforeNormal || state.interject.length !== beforeInterject) {
      render()
      return true
    }
    return false
  }

  function isInterjectMessageNode(node) {
    return !!(node && node.nodeType === 1 && node.classList?.contains('message-user-interject'))
  }

  function getLatestOrdinaryUserMessage(messagesEl) {
    const users = Array.from(messagesEl?.querySelectorAll?.('.message.user:not(.message-user-interject)') || [])
    return users.length ? users[users.length - 1] : null
  }

  function rememberInterjectAnchor(item, messagesEl) {
    if (!item || !messagesEl) return null
    const anchor = getLatestOrdinaryUserMessage(messagesEl)
    if (!anchor) return null
    if (!String(item.anchorMessageId || '').trim()) {
      item.anchorMessageId = String(anchor.dataset?.messageId || '').trim()
    }
    if (item.anchorHistoryIndex === null || item.anchorHistoryIndex === undefined || item.anchorHistoryIndex === '') {
      const historyIndex = Number(anchor.dataset?.historyIndex)
      if (Number.isFinite(historyIndex)) item.anchorHistoryIndex = historyIndex
    }
    if (item.anchorTurnId === null || item.anchorTurnId === undefined || item.anchorTurnId === '') {
      const turnId = Number(anchor.dataset?.turnId)
      if (Number.isFinite(turnId) && turnId > 0) item.anchorTurnId = turnId
    }
    return anchor
  }

  // 把注入消息贴近它原本跟的那条普通用户消息。
  // 历史恢复时按 turnId 精确定位，实时注入时 turnId 就是最后一条用户消息所以效果一致。
  function placeInjectedNearLatestUser(messagesEl, node) {
    if (!messagesEl || !node) return false
    if (node.parentNode !== messagesEl) messagesEl.appendChild(node)
    const anchorMessageId = String(node.dataset.anchorMessageId || '').trim()
    const hasAnchorHistoryIndex = node.dataset.anchorHistoryIndex !== undefined && node.dataset.anchorHistoryIndex !== ''
    const anchorHistoryIndex = hasAnchorHistoryIndex ? Number(node.dataset.anchorHistoryIndex) : NaN
    const myTurn = Number(node.dataset.anchorTurnId || node.dataset.turnId) || 0
    const allUserEls = Array.from(messagesEl.querySelectorAll('.message.user:not(.message-user-interject)'))
    // 先按持久化身份定位本轮用户消息，最后才用 turnId/最新消息兜底。
    let anchor = anchorMessageId
      ? [...allUserEls].reverse().find(u => String(u.dataset?.messageId || '').trim() === anchorMessageId)
      : null
    if (!anchor && Number.isFinite(anchorHistoryIndex)) {
      anchor = [...allUserEls].reverse().find(u => Number(u.dataset?.historyIndex) === anchorHistoryIndex)
    }
    if (!anchor && myTurn) {
      anchor = [...allUserEls].reverse().find(u => Number(u.dataset.turnId) === myTurn)
    }
    // 找不到就找最后一条 turnId <= myTurn 的
    if (!anchor && myTurn) {
      const earlier = allUserEls.filter(u => Number(u.dataset.turnId) <= myTurn)
      if (earlier.length) anchor = earlier[earlier.length - 1]
    }
    // 还找不到就用最后一条用户消息（兜底）
    if (!anchor && allUserEls.length) anchor = allUserEls[allUserEls.length - 1]
    if (anchor) {
      let insertBefore = anchor.nextSibling || null
      while (insertBefore && isInterjectMessageNode(insertBefore) && insertBefore !== node) {
        insertBefore = insertBefore.nextSibling
      }
      if (insertBefore === node) return false
      messagesEl.insertBefore(node, insertBefore)
    } else {
      if (messagesEl.lastChild !== node) messagesEl.appendChild(node)
    }
    if (node.style.display === 'none') node.style.display = ''
    return true
  }

  function revealInjectedUserMessage(messagesEl, node) {
    if (!messagesEl || !node) return
    const reveal = () => {
      try {
        if (typeof node.scrollIntoView === 'function') {
          node.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
          return
        }
      } catch (_) {}
      try {
        messagesEl.scrollTop = messagesEl.scrollHeight
      } catch (_) {}
    }
    try {
      requestAnimationFrame(reveal)
    } catch (_) {
      reveal()
    }
  }

  function computeInterjectDataAttrs(container, el) {
    const allUserMsgs = container.querySelectorAll('.message.user[data-history-index]')
    const maxIdx = allUserMsgs.length > 0
      ? Math.max(...Array.from(allUserMsgs).map(e => Number(e.dataset.historyIndex)).filter(n => Number.isFinite(n)))
      : -1
    // 优先保留持久化 turnId（历史恢复场景）
    const persistedTurnId = el ? Number(el.dataset.turnId) : 0
    if (persistedTurnId) return { historyIndex: maxIdx >= 0 ? maxIdx + 1 : 0, turnId: persistedTurnId }
    // 实时注入：取普通用户消息的最大 turnId（不 +1），让注入消息记住它跟在哪条用户消息后面
    const userTurns = container.querySelectorAll('.message.user:not(.message-user-interject)[data-turn-id]')
    const maxUserTurn = userTurns.length > 0
      ? Math.max(...Array.from(userTurns).map(e => Number(e.dataset.turnId)).filter(n => Number.isFinite(n)))
      : 0
    return { historyIndex: maxIdx >= 0 ? maxIdx + 1 : 0, turnId: maxUserTurn || 1 }
  }

  function renderInjectedUserMessage(item) {
    if (!item) { console.warn('[MQ-Inject] item is null'); return }
    try {
      const messagesEl = document.getElementById('chatMessages')
      if (!messagesEl) { console.warn('[MQ-Inject] chatMessages element NOT FOUND'); return }
      rememberInterjectAnchor(item, messagesEl)
      const itemId = String(item.id || '')
      let msg = null
      if (itemId) {
        try {
          msg = messagesEl.querySelector(`.message-user-interject[data-item-id="${CSS.escape(itemId)}"]`)
        } catch (_) {
          msg = messagesEl.querySelector(`.message-user-interject[data-item-id="${itemId.replace(/"/g, '\\"')}"]`)
        }
      }
      AppLogger.debug('[MQ-Inject] called, itemId:', itemId, 'existingMsg:', !!msg, 'messagesEl children:', messagesEl.children.length)
      if (!msg) {
        // 优先通过 addUserMessageToChat（chatRenderer.addUserMessage）创建，
        // 这样文本会被包裹在 .user-message-text 中（带 pre-wrap 换行样式）
        const addUserMsg = deps.addUserMessageToChat
        if (typeof addUserMsg === 'function') {
          msg = addUserMsg(item.content || '', { scroll: false, isInterject: true, itemId })
        }
        if (msg) {
          // addUserMessageToChat 已 appendChild 到 chatMessages 末尾；添加 interject 标记
          msg.classList.add('message-user-interject')
          msg.setAttribute('data-interject-state', 'queued')
          if (itemId) msg.setAttribute('data-item-id', itemId)
          // 补上 interject-tag 视觉标签
          const bubble = msg.querySelector('.message-bubble')
          if (bubble && !bubble.querySelector('.interject-tag')) {
            const tag = document.createElement('span')
            tag.className = 'interject-tag'
            tag.textContent = '消息注入'
            bubble.appendChild(tag)
          }
          const interjectData = computeInterjectDataAttrs(messagesEl, msg)
          msg.dataset.historyIndex = interjectData.historyIndex
          msg.dataset.turnId = interjectData.turnId
          if (item.anchorMessageId) msg.dataset.anchorMessageId = item.anchorMessageId
          if (item.anchorHistoryIndex !== null && item.anchorHistoryIndex !== undefined && item.anchorHistoryIndex !== '' && Number.isFinite(Number(item.anchorHistoryIndex))) msg.dataset.anchorHistoryIndex = String(item.anchorHistoryIndex)
          if (item.anchorTurnId !== null && item.anchorTurnId !== undefined && item.anchorTurnId !== '' && Number.isFinite(Number(item.anchorTurnId))) msg.dataset.anchorTurnId = String(item.anchorTurnId)
          placeInjectedNearLatestUser(messagesEl, msg)
        } else {
          // 降级：直接创建元素（保留原有逻辑）
          const div = document.createElement('div')
          div.className = 'message user message-user-interject'
          if (itemId) div.setAttribute('data-item-id', itemId)
          div.setAttribute('data-interject-state', 'queued')
          const contentText = String(item.content || '')
          // 用 .user-message-text 包裹，确保 pre-wrap 换行生效
          div.innerHTML = `<div class="message-bubble"><div class="user-message-text">${escapeHtml(contentText)}</div><span class="interject-tag">消息注入</span></div>`
          const fallbackData = computeInterjectDataAttrs(messagesEl, div)
          div.dataset.historyIndex = fallbackData.historyIndex
          div.dataset.turnId = fallbackData.turnId
          if (item.anchorMessageId) div.dataset.anchorMessageId = item.anchorMessageId
          if (item.anchorHistoryIndex !== null && item.anchorHistoryIndex !== undefined && item.anchorHistoryIndex !== '' && Number.isFinite(Number(item.anchorHistoryIndex))) div.dataset.anchorHistoryIndex = String(item.anchorHistoryIndex)
          if (item.anchorTurnId !== null && item.anchorTurnId !== undefined && item.anchorTurnId !== '' && Number.isFinite(Number(item.anchorTurnId))) div.dataset.anchorTurnId = String(item.anchorTurnId)
          msg = div
          placeInjectedNearLatestUser(messagesEl, msg)
        }
        AppLogger.debug('[MQ-Inject] element created and inserted, parent:', msg?.parentNode?.id, 'visible:', msg?.offsetParent !== null, 'rect:', msg?.getBoundingClientRect().height)
      }
      if (msg) {
        if (item.anchorMessageId) msg.dataset.anchorMessageId = item.anchorMessageId
        if (item.anchorHistoryIndex !== null && item.anchorHistoryIndex !== undefined && item.anchorHistoryIndex !== '' && Number.isFinite(Number(item.anchorHistoryIndex))) msg.dataset.anchorHistoryIndex = String(item.anchorHistoryIndex)
        if (item.anchorTurnId !== null && item.anchorTurnId !== undefined && item.anchorTurnId !== '' && Number.isFinite(Number(item.anchorTurnId))) msg.dataset.anchorTurnId = String(item.anchorTurnId)
        placeInjectedNearLatestUser(messagesEl, msg)
      }
      revealInjectedUserMessage(messagesEl, msg)
    } catch (err) {
      console.warn('[MessageQueue] render injected user message failed:', err)
    }
  }

  // 把所有注入消息重新锚定到所属用户消息下方。
  // 在最终正文开始流式、思考工具区收起时调用
  function relocatePendingInterjectMessages() {
    try {
      const messagesEl = document.getElementById('chatMessages')
      if (!messagesEl) return 0
      const pending = messagesEl.querySelectorAll('.message-user-interject')
      if (!pending.length) return 0
      let relocated = 0
      pending.forEach(node => {
        node.removeAttribute('data-interject-pending-relocate')
        // 状态从 queued 改成 consumed（已接收并归位）
        node.setAttribute('data-interject-state', 'consumed')
        if (placeInjectedNearLatestUser(messagesEl, node)) relocated++
      })
      return relocated
    } catch (err) {
      console.warn('[MessageQueue] relocate pending interject messages failed:', err)
      return 0
    }
  }

  function promoteToInterject(itemId) {
    const project = getActiveProject()
    if (!project) return null
    const state = getQueueState(project)
    if (!state) return null
    const idx = state.normal.findIndex(item => item.id === itemId)
    if (idx < 0) return null
    const [item] = state.normal.splice(idx, 1)
    item.isInterject = true
    item.injectedAt = Date.now()
    rememberInterjectAnchor(item, document.getElementById('chatMessages'))
    rememberInjectedInterject(project, item, 'queued')
    render()
    renderInjectedUserMessage(item)
    // ---- 注入诊断：直接检查 window.api 而不是依赖 deps ----
    try {
      const api = window.api
      const apiKeys = api ? Object.keys(api).filter(k => k.includes('nterject') || k.includes('Interject') || k.includes('notify')).join(', ') : 'NO_API'
      AppLogger.debug('[MessageQueue] interject API check — window.api exists:', !!api, 'interject keys:', apiKeys)
      if (typeof api?.notifyInterjectMessage === 'function') {
        AppLogger.debug('[MessageQueue] calling notifyInterjectMessage directly')
        api.notifyInterjectMessage({
          projectId: deps.getActiveProjectId?.() || '',
          itemId: item.id,
          content: item.content,
          createdAt: item.createdAt
        })
        AppLogger.debug('[MessageQueue] notifyInterjectMessage call completed')
      } else {
        console.error('[MessageQueue] window.api.notifyInterjectMessage is NOT a function, typeof:', typeof api?.notifyInterjectMessage)
      }
    } catch (err) {
      console.warn('[MessageQueue] promoteInterjectToBackend direct call failed:', err)
    }
    // 同时保留 deps 路径（双保险，只要有一条通就行）
    try {
      deps.promoteInterjectToBackend?.(item)
    } catch (err) {
      console.warn('[MessageQueue] promoteInterjectToBackend (deps) failed:', err)
    }
    return item
  }

  function drainNextNormal() {
    const project = getActiveProject()
    if (!project) return null
    const state = getQueueState(project)
    if (!state) return null
    if (!state.normal.length) return null
    const [item] = state.normal.shift()
    render()
    return item
  }

  function peekNextNormal() {
    const project = getActiveProject()
    if (!project) return null
    const state = getQueueState(project)
    return state?.normal?.[0] || null
  }

  function getStats() {
    const project = getActiveProject()
    if (!project) return { normal: 0, interject: 0 }
    const state = getQueueState(project)
    if (!state) return { normal: 0, interject: 0 }
    return { normal: state.normal.length, interject: state.interject.length }
  }

  function getItems() {
    const project = getActiveProject()
    if (!project) return { normal: [], interject: [] }
    const state = getQueueState(project)
    if (!state) return { normal: [], interject: [] }
    return { normal: state.normal.slice(), interject: state.interject.slice() }
  }

  function notifyInterjectBackend(item) {
    try {
      deps.promoteInterjectToBackend?.(item)
    } catch (err) {
      console.warn('[MessageQueue] promote interject backend failed:', err)
    }
  }

  function sendItemNow(itemId) {
    const project = getActiveProject()
    if (!project) return false
    const state = getQueueState(project)
    if (!state) return false
    let item = state.normal.find(it => it.id === itemId) || state.interject.find(it => it.id === itemId)
    if (!item) return false
    removeById(itemId)
    try {
      deps.sendMessageDirect?.({
        displayMessage: item.content,
        aiMessage: item.content,
        references: item.references || [],
        hidden: !!item.hidden
      })
    } catch (err) {
      console.warn('[MessageQueue] sendItemNow failed:', err)
      return false
    }
    return true
  }

  // ===== 渲染 =====
  let rootEl = null
  let modalRootEl = null
  let _renderRaf = 0

  function ensureRoot() {
    if (!rootEl) rootEl = document.getElementById('messageQueueArea')
    return rootEl
  }

  function ensureModalRoot() {
    if (modalRootEl && document.contains(modalRootEl)) return modalRootEl
    modalRootEl = document.createElement('div')
    modalRootEl.className = 'message-queue-modal-root'
    document.body.appendChild(modalRootEl)
    return modalRootEl
  }

  function renderPillHtml(item) {
    const title = escapeHtml(item.displayTitle)
    return `
      <div class="message-queue-pill" data-item-id="${escapeHtml(item.id)}" data-channel="${item.isInterject ? 'interject' : 'normal'}">
        <button type="button" class="message-queue-pill-title" data-action="open" title="查看完整内容">${title}</button>
        <button type="button" class="message-queue-pill-action" data-action="interject" title="发送到聊天区并注入当前 AI 上下文">消息注入</button>
        <button type="button" class="message-queue-pill-close" data-action="remove" title="从队列移除" aria-label="移除">×</button>
      </div>
    `
  }

  function render() {
    if (_renderRaf) return
    _renderRaf = requestAnimationFrame(() => {
      _renderRaf = 0
      renderNow()
    })
  }

  function renderNow() {
    const root = ensureRoot()
    if (!root) return
    const items = getItems()
    const all = [...items.interject, ...items.normal]
    if (!all.length) {
      root.innerHTML = ''
      root.classList.remove('has-items')
      return
    }
    root.classList.add('has-items')
    root.innerHTML = all.map(renderPillHtml).join('')
    bindPillEvents(root)
  }

  function bindPillEvents(root) {
    if (root._mqBound) return
    root._mqBound = true
    root.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-action]')
      if (!btn) return
      const pill = btn.closest('.message-queue-pill')
      if (!pill) return
      const itemId = pill.getAttribute('data-item-id')
      const action = btn.getAttribute('data-action')
      handlePillAction(itemId, action)
    })
  }

  function handlePillAction(itemId, action) {
    if (action === 'remove') {
      removeById(itemId)
      deps.showToast?.('已从队列移除', 'info')
    } else if (action === 'interject') {
      const item = promoteToInterject(itemId)
      if (item) {
        deps.showToast?.('已发送到聊天区，当前操作完成后注入 AI 上下文', 'info')
      } else {
        deps.showToast?.('消息注入失败，未找到该消息', 'warning')
      }
    } else if (action === 'open') {
      openModal(itemId)
    }
  }

  function openModal(itemId) {
    const items = getItems()
    const item = items.normal.find(it => it.id === itemId) || items.interject.find(it => it.id === itemId)
    if (!item) return
    const project = getActiveProject()
    const state = project ? getQueueState(project) : null
    if (state) state.modalItemId = itemId
    const modalRoot = ensureModalRoot()
    modalRoot.innerHTML = `
      <div class="message-queue-modal-mask" data-mq-mask>
        <div class="message-queue-modal" role="dialog" aria-modal="true" aria-label="队列消息详情">
          <div class="message-queue-modal-head">
            <span class="message-queue-modal-tag ${item.isInterject ? 'is-interject' : 'is-normal'}">${item.isInterject ? '注入' : '排队'}</span>
            <span class="message-queue-modal-time">${formatTime(item.createdAt)}</span>
            <button type="button" class="message-queue-modal-close" data-action="close" aria-label="关闭">×</button>
          </div>
          <div class="message-queue-modal-body">${escapeHtml(item.content)}</div>
          <div class="message-queue-modal-foot">
            <button type="button" class="message-queue-modal-btn ghost" data-action="remove">删除</button>
            <button type="button" class="message-queue-modal-btn" data-action="send">发送</button>
            <button type="button" class="message-queue-modal-btn primary" data-action="interject">消息注入</button>
          </div>
        </div>
      </div>
    `
    bindModalEvents()
  }

  function closeModal() {
    const project = getActiveProject()
    const state = project ? getQueueState(project) : null
    if (state) state.modalItemId = null
    if (modalRootEl) modalRootEl.innerHTML = ''
  }

  function bindModalEvents() {
    if (!modalRootEl) return
    modalRootEl.onclick = (e) => {
      const mask = e.target.closest('[data-mq-mask]')
      const btn = e.target.closest('button[data-action]')
      const itemId = (() => {
        const project = getActiveProject()
        const state = project ? getQueueState(project) : null
        return state?.modalItemId || null
      })()
      if (mask && !e.target.closest('.message-queue-modal')) {
        closeModal()
        return
      }
      if (!btn || !itemId) return
      const action = btn.getAttribute('data-action')
      if (action === 'close') {
        closeModal()
      } else if (action === 'remove') {
        removeById(itemId)
        closeModal()
      } else if (action === 'send') {
        sendItemNow(itemId)
        closeModal()
      } else if (action === 'interject') {
        const items = getItems()
        const target = items.normal.find(it => it.id === itemId)
        if (target) {
          promoteToInterject(itemId)
          closeModal()
          deps.showToast?.('已发送到聊天区，当前操作完成后注入 AI 上下文', 'info')
        } else {
          closeModal()
          deps.showToast?.('该消息已提交注入', 'info')
        }
      }
    }
  }

  function formatTime(ts) {
    try {
      const d = new Date(ts)
      const pad = (n) => String(n).padStart(2, '0')
      return `${pad(d.getHours())}:${pad(d.getMinutes())}`
    } catch (_) {
      return ''
    }
  }

  function clearAll() {
    const project = getActiveProject()
    if (!project) return
    const state = getQueueState(project)
    if (!state) return
    state.normal = []
    state.interject = []
    state.modalItemId = null
    render()
  }

  function bind(options = {}) {
    deps = Object.assign({}, options)
    // 项目切换时重渲染（数据已自然隔离，只刷新 DOM）
    const tryRenderOnChange = () => render()
    if (typeof window !== 'undefined') {
      window.addEventListener('lingxi:active-project-changed', tryRenderOnChange)
    }

    // 兼容旧事件：如果后端主动要求渲染注入消息，前端只补漏，不重复追加。
    if (window.api?.onInterjectRendered) {
      try {
        window.api.onInterjectRendered((payload = {}) => {
          const { projectId, itemId, content } = payload
          if (!projectId || !content) return
          // 验证是否当前激活项目（不是则不渲染——避免其他项目的插队消息出现在这里）
          const activeId = deps.getActiveProjectId?.()
          if (activeId && projectId !== activeId) return
          const stored = rememberInjectedInterject(findProjectById(projectId) || getActiveProject(), { id: itemId, content, createdAt: Date.now(), injectedAt: Date.now() }, 'queued')
          try {
            renderInjectedUserMessage({
              id: itemId,
              content,
              anchorMessageId: stored?.anchorMessageId,
              anchorHistoryIndex: stored?.anchorHistoryIndex,
              anchorTurnId: stored?.anchorTurnId
            })
          } catch (err) {
            console.warn('[MessageQueue] render interject user message failed:', err)
          }
        })
      } catch (err) {
        console.warn('[MessageQueue] bind onInterjectRendered failed:', err)
      }
    }

    if (window.api?.onInterjectConsumed) {
      try {
        window.api.onInterjectConsumed((payload = {}) => {
          const { projectId, itemIds } = payload
          const activeId = deps.getActiveProjectId?.()
          if (activeId && projectId && projectId !== activeId) return
          markStoredInjectedMessagesConsumed(projectId || activeId, itemIds)
          markInjectedMessagesConsumed(itemIds)
          relocatePendingInterjectMessages()
          // 准备 AI 消息元素：让 AI 2 续轮时动态区不藏、计时不重置、思考/工具不丢失
          try {
            const aiMsg = resolveCurrentAiMsgForInterjectResume(projectId, activeId)
            if (aiMsg) prepareAiMessageForInterjectResume(aiMsg)
          } catch (err) {
            console.warn('[MessageQueue] prepare ai message for interject resume failed:', err)
          }
        })
      } catch (err) {
        console.warn('[MessageQueue] bind onInterjectConsumed failed:', err)
      }
    }

    render()
  }

  // 从项目状态里查找当前 AI 消息元素，供 interject 续轮准备
  function resolveCurrentAiMsgForInterjectResume(projectId, activeId) {
    const targetId = projectId || activeId
    if (!targetId) return null
    const projects = deps.getProjects?.() || []
    const project = projects.find(p => p && p.id === targetId)
    if (!project) return null
    const candidates = [
      deps.getCurrentAiMsg?.(),
      project._aiState?.currentAiMsg,
      project.savedAiMsg,
      project._aiState?.runtime?.aiMsg
    ].filter(Boolean)
    for (const c of candidates) {
      if (c && document.contains(c)) return c
    }
    // 最后从 DOM 里找最近的 .message.ai
    try {
      const messagesEl = document.getElementById('chatMessages')
      if (!messagesEl) return null
      const aiMsgs = messagesEl.querySelectorAll('.message.ai')
      for (let i = aiMsgs.length - 1; i >= 0; i--) {
        const el = aiMsgs[i]
        if (!el.dataset?.projectId || el.dataset.projectId === targetId) return el
      }
    } catch (_) {}
    return null
  }

  // 清理 AI 元素的折叠/stopped 状态，确保 AI 2 续轮后思考、工具、计时连续可见
  function prepareAiMessageForInterjectResume(aiMsg) {
    if (!aiMsg || !document.contains(aiMsg)) return false
    let touched = false
    try {
      const dynamicArea = aiMsg.querySelector('.ai-dynamic-area')
      if (dynamicArea && dynamicArea.classList.contains('collapsed')) {
        dynamicArea.classList.remove('collapsed')
        touched = true
      }
      const collapsedExtras = aiMsg.querySelectorAll('.ai-dynamic-area-inner.collapsed, .ai-work-detail.collapsed')
      collapsedExtras.forEach(el => {
        el.classList.remove('collapsed')
        touched = true
      })
      const stoppedSelectors = [
        '.ai-thinking-block.stopped',
        '.ai-thinking-status.stopped',
        '.ai-tool-group.stopped',
        '.ai-deep-reasoning-block.stopped',
        '.ai-reasoning-stopped'
      ]
      aiMsg.querySelectorAll(stoppedSelectors.join(',')).forEach(el => {
        el.classList.remove('stopped')
        touched = true
      })
      if (aiMsg.dataset.workDone === 'true') {
        delete aiMsg.dataset.workDone
        touched = true
      }
      if (touched && typeof window.AiMessageUI?.startWorkTimer === 'function') {
        try { window.AiMessageUI.startWorkTimer(aiMsg) } catch (_) {}
      }
    } catch (err) {
      console.warn('[MessageQueue] prepareAiMessageForInterjectResume failed:', err)
    }
    return touched
  }

  function restoreInjectedMessagesForProject(projectId, sessionId, options = {}) {
    const project = findProjectById(projectId) || getActiveProject()
    const targetSessionId = String(sessionId || project?.chatSessionId || '').trim() || 'main'
    const minInjectedAt = Math.max(0, Number(options.minInjectedAt) || 0)
    const items = Array.isArray(project?._injectedInterjectMessages)
      ? project._injectedInterjectMessages.filter(item => {
          if (String(item?.chatSessionId || 'main') !== targetSessionId) return false
          // 运行态切回只补当前执行轮产生的注入；更早的注入已由聊天历史负责渲染。
          if (minInjectedAt > 0 && Number(item?.injectedAt || 0) + 1000 < minInjectedAt) return false
          return true
        })
      : []
    if (!items.length) return 0
    let restored = 0
    items.forEach(item => {
      if (!item?.id || !String(item.content || '').trim()) return
      renderInjectedUserMessage({
        id: item.id,
        content: item.content,
        createdAt: item.createdAt,
        injectedAt: item.injectedAt,
        anchorMessageId: item.anchorMessageId,
        anchorHistoryIndex: item.anchorHistoryIndex,
        anchorTurnId: item.anchorTurnId
      })
      try {
        const node = document.querySelector(`.message-user-interject[data-item-id="${CSS.escape(String(item.id))}"]`)
        if (node) {
          node.dataset.chatSessionId = targetSessionId
          node.setAttribute('data-interject-state', item.state || 'queued')
          restored += 1
        }
      } catch (_) {}
    })
    return restored
  }

  window.MessageQueue = {
    bind,
    enqueue,
    removeById,
    promoteToInterject,
    drainNextNormal,
    peekNextNormal,
    getStats,
    getItems,
    sendItemNow,
    clearAll,
    render,
    relocatePendingInterjectMessages,
    prepareAiMessageForInterjectResume,
    restoreInjectedMessagesForProject
  }
})()
