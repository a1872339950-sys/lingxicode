(function () {
  // 跨实例共享的“粘底跟随”记录表：同一个滚动容器只绑一次
  const stickyBottomBound = new WeakSet()
  // 真正“贴底”的最大像素差。比这个大就算不贴底，不再自动跟随。
  const STICKY_AT_BOTTOM_PX = 8
  // 用户脱粘后，再次手动滚回这个范围内才算回到底部，允许重新粘底。
  const STICKY_RESUME_PX = 24
  // 流式输出会触发大量 DOM 变化；自动贴底需要合并降频，避免连续写 scrollTop 造成视觉抖动。
  const STICKY_MIN_INTERVAL_MS = 48
  const stickySuspendCount = new WeakMap()

  function isStickySuspended(container) {
    return (stickySuspendCount.get(container) || 0) > 0
  }

  function suspendStickyBottom(container) {
    if (!container) return function () {}
    stickySuspendCount.set(container, (stickySuspendCount.get(container) || 0) + 1)
    return function resumeStickyBottom() {
      const next = Math.max((stickySuspendCount.get(container) || 1) - 1, 0)
      if (next) stickySuspendCount.set(container, next)
      else stickySuspendCount.delete(container)
    }
  }

  function ensureStickyBottomTracker(container) {
    if (!container || stickyBottomBound.has(container)) return
    stickyBottomBound.add(container)

    // 几何是否贴底
    const gapToBottom = () => container.scrollHeight - container.scrollTop - container.clientHeight
    const isAtBottom = () => gapToBottom() <= STICKY_AT_BOTTOM_PX

    // escaped = true 表示“用户已主动滚离底部，不要再自动拽他回来”
    // 初始默认贴底；如果不是贴底，等用户首次滚动事件再决定（避免冷启动就被误判为逃离）
    let escaped = false
    // 最近一次容器的 scrollTop，用来判断滚动方向
    let lastScrollTop = container.scrollTop
    // 区分“程序性写 scrollTop”和“用户滚动”：程序性写入时打这个标记
    let programmaticUntil = 0
    let rafStick = 0
    let rafReadIntent = 0
    let lastStickAt = 0
    let stickTimer = 0
    let mutationRaf = 0

    const stickToBottom = () => {
      if (rafStick) return
      const now = performance.now()
      const elapsed = now - lastStickAt
      if (elapsed < STICKY_MIN_INTERVAL_MS) {
        if (!stickTimer) {
          stickTimer = setTimeout(() => {
            stickTimer = 0
            stickToBottom()
          }, Math.max(0, STICKY_MIN_INTERVAL_MS - elapsed))
        }
        return
      }
      rafStick = requestAnimationFrame(() => {
        rafStick = 0
        if (escaped) return
        // 只要没标记为 escaped，就一路把容器拉到底，不再做“此刻是否贴底”的二次校验。
        // 因为 MutationObserver 触发时内容已追加，几何上必然不贴底，旧逻辑会把自己挡住。
        programmaticUntil = performance.now() + 80
        container.scrollTop = container.scrollHeight
        lastScrollTop = container.scrollTop
        lastStickAt = performance.now()
      })
    }

    // 强制粘底（用于发送新消息、切换会话等明确意图）。会清除 escaped。
    const forceStickToBottom = () => {
      escaped = false
      if (stickTimer) {
        clearTimeout(stickTimer)
        stickTimer = 0
      }
      programmaticUntil = performance.now() + 60
      container.scrollTop = container.scrollHeight
      lastScrollTop = container.scrollTop
      lastStickAt = performance.now()
    }

    container.addEventListener('scroll', () => {
      const now = performance.now()
      const top = container.scrollTop
      const delta = top - lastScrollTop
      lastScrollTop = top
      // 程序性写入产生的 scroll 事件不参与方向判定
      if (now < programmaticUntil) return
      // 用户向上滚 → 立刻脱粘
      if (delta < -1) {
        escaped = true
        return
      }
      // 用户向下滚到接近底部 → 重新粘底
      if (delta > 0 && gapToBottom() <= STICKY_RESUME_PX) {
        escaped = false
      }
    }, { passive: true })

    // wheel / touch / 键盘只用来辅助：滚动事件本身已能覆盖方向
    // 但 wheel 在 passive 同步阶段读 scrollTop 拿到的是滚动前的位置，所以延后一帧再读
    const readUserIntent = () => {
      if (rafReadIntent) return
      rafReadIntent = requestAnimationFrame(() => {
        rafReadIntent = 0
        if (!isAtBottom()) escaped = true
      })
    }
    container.addEventListener('wheel', (e) => {
      if (e.deltaY < 0) {
        escaped = true
      } else {
        readUserIntent()
      }
    }, { passive: true })
    container.addEventListener('touchmove', readUserIntent, { passive: true })
    container.addEventListener('keydown', (e) => {
      if (['PageUp', 'ArrowUp', 'Home'].includes(e.key)) {
        escaped = true
      } else if (['PageDown', 'ArrowDown', 'End'].includes(e.key)) {
        readUserIntent()
      }
    })

    // 内容在容器内部变动（流式 delta、工具卡追加、推理追加）均触发粘底检查
    const observer = new MutationObserver(() => {
      if (mutationRaf || isStickySuspended(container)) return
      mutationRaf = requestAnimationFrame(() => {
        mutationRaf = 0
        if (isStickySuspended(container)) return
        if (!escaped) stickToBottom()
      })
    })
    observer.observe(container, {
      childList: true,
      subtree: true
    })

    // 容器本身尺寸变化（例如输入框变高、分栏拖动）也应粘底
    if (typeof ResizeObserver === 'function') {
      const ro = new ResizeObserver(() => {
        if (isStickySuspended(container)) return
        if (!escaped) stickToBottom()
      })
      ro.observe(container)
    }

    // 暴露给外部用：发送消息、切换会话、点向下箭头时强制贴底并解除 escaped
    try {
      container.__stickyBottom = {
        forceStickToBottom,
        isEscaped: () => escaped,
        reset: () => { escaped = false; lastScrollTop = container.scrollTop }
      }
    } catch (_) {}
  }

  // 全局快捷入口：window.ChatStickyBottom.forceStick(container) 可在任何地方调用
  try {
    window.ChatStickyBottom = window.ChatStickyBottom || {
      forceStick(container) {
        const api = container && container.__stickyBottom
        if (api) api.forceStickToBottom()
        else if (container) container.scrollTop = container.scrollHeight
      },
      isEscaped(container) {
        const api = container && container.__stickyBottom
        return api ? api.isEscaped() : false
      },
      reset(container) {
        const api = container && container.__stickyBottom
        if (api) api.reset()
      }
    }
  } catch (_) {}
  function bind(options = {}) {
    const getContainer = options.getContainer || function () { return null }
    const highlightMessage = options.highlightMessage || function () {}
    const sanitizeContent = options.sanitizeContent || function (content) { return content }
    const generateSummaryHtml = options.generateSummaryHtml || function () { return '' }
    const renderAiContent = options.renderAiContent || function (content, renderOptions = {}) {
      return sanitizeContent(content) + (renderOptions.summaryHtml || '')
    }
    const getOpIcons = options.getOpIcons || function () { return {} }
    const getOpTypes = options.getOpTypes || function () { return {} }
    const onAfterRestore = options.onAfterRestore || function () {}
    const calculateEditLines = options.calculateEditLines || function (oldStr, newStr) {
      return window.AiMessageUI?.calculateEditLines?.(oldStr, newStr) || { add: 0, remove: 0 }
    }
    const ThinkingDisplay = window.ThinkingDisplay || {}
    const ToolDisplay = window.ToolDisplayMetadata || {}
    const LONG_USER_MESSAGE_COLLAPSE_THRESHOLD = 520
    const LONG_USER_MESSAGE_PREVIEW_LENGTH = 360

    function getFullFilePath(filePath, projectPath) {
      if (!filePath || filePath.match(/^[A-Z]:/i)) return filePath
      return projectPath ? projectPath + '\\' + filePath.replace(/\//g, '\\') : filePath
    }

    function getSingleFileName(filePath) {
      return (filePath || '').split(/[\\/]/).pop() || ''
    }

    const escapeHtml = HtmlUtils.escapeHtml

    const displayText = HtmlUtils.displayText.bind(HtmlUtils)
    const displayCount = HtmlUtils.displayCount.bind(HtmlUtils)

    function getDisplayLength(value = '') {
      return Array.from(String(value || '')).length
    }

    function getDisplaySlice(value = '', length = LONG_USER_MESSAGE_PREVIEW_LENGTH) {
      return Array.from(String(value || '')).slice(0, length).join('')
    }

    // 去掉发给模型的附件注入文案，避免盖住用户真实输入；缩略图走 attachments。
    function stripInjectedAttachmentBlocks(content = '') {
      let text = String(content || '')
      text = text
        .replace(/【文件(?::[^\】]*)?】[^\n]*(?:\n路径:\s*[^\n]*)?/g, '')
        .replace(/【图片(?::[^\】]*)?】[^\n]*/g, '')
        .replace(/(?:^|\n)路径:\s*(?:[A-Za-z]:\\|\/)[^\n]*/g, '\n')
        .replace(/(?:^|\n)【图片处理】[^\n]*/g, '\n')
        .replace(/(?:^|\n)【图片读取失败】[^\n]*/g, '\n')
      return text.replace(/\n{3,}/g, '\n\n').trim()
    }

    function contentToUserDisplayText(content = '') {
      if (Array.isArray(content)) {
        return content
          .map(part => {
            if (part && typeof part === 'object' && part.type === 'text') return String(part.text || '')
            return typeof part === 'string' ? part : ''
          })
          .filter(Boolean)
          .join('\n')
      }
      return String(content || '')
    }

    function buildUserMessageTextHtml(content = '') {
      const text = stripInjectedAttachmentBlocks(contentToUserDisplayText(content))
      if (!text) return '<div class="user-message-text"></div>'
      const length = getDisplayLength(text)
      if (length <= LONG_USER_MESSAGE_COLLAPSE_THRESHOLD) {
        return `<div class="user-message-text">${escapeHtml(text)}</div>`
      }
      const preview = getDisplaySlice(text).trimEnd()
      return `
        <div class="user-message-text user-message-preview">${escapeHtml(preview)}...</div>
        <div class="user-message-text user-message-full" hidden>${escapeHtml(text)}</div>
        <button type="button" class="user-message-toggle" data-user-message-toggle aria-expanded="false">
          <span class="user-message-toggle-label">\u5c55\u5f00\u5168\u90e8</span>
          <span class="user-message-toggle-count">\u5171 ${length} \u5b57</span>
        </button>
      `
    }

    function setUserMessageExpanded(msg, expanded) {
      if (!msg) return
      const isExpanded = !!expanded
      const preview = msg.querySelector('.user-message-preview')
      const full = msg.querySelector('.user-message-full')
      const toggle = msg.querySelector('[data-user-message-toggle]')
      const label = toggle?.querySelector('.user-message-toggle-label')
      msg.classList.toggle('user-message-expanded', isExpanded)
      if (preview) preview.hidden = isExpanded
      if (full) full.hidden = !isExpanded
      if (toggle) toggle.setAttribute('aria-expanded', isExpanded ? 'true' : 'false')
      if (label) label.textContent = isExpanded ? '\u6536\u8d77' : '\u5c55\u5f00\u5168\u90e8'
    }

    function bindUserMessageCollapseToggle(chatMessages) {
      if (!chatMessages || chatMessages.dataset.userMessageCollapseBound === 'true') return
      chatMessages.dataset.userMessageCollapseBound = 'true'
      chatMessages.addEventListener('click', event => {
        const toggle = event.target?.closest?.('[data-user-message-toggle]')
        if (!toggle || !chatMessages.contains(toggle)) return
        const msg = toggle.closest('.message.user')
        if (!msg) return
        event.preventDefault()
        event.stopPropagation()
        setUserMessageExpanded(msg, toggle.getAttribute('aria-expanded') !== 'true')
      })
    }

    function isThinkingInlineToken(value = '') {
      return ThinkingDisplay.isThinkingInlineToken ? ThinkingDisplay.isThinkingInlineToken(value) : false
    }

    function renderThinkingStatusHtml(text = '') {
      return ThinkingDisplay.renderThinkingStatusHtml ? ThinkingDisplay.renderThinkingStatusHtml(text) : escapeHtml(text)
    }

    function buildThinkingPulseIconHtml() {
      return `
        <span class="ai-thinking-pulse-icon">
          <span class="pulse-ring"></span>
          <svg class="pulse-core" viewBox="0 0 16 16" width="14" height="14"><path d="M8 0 L9.2 6.8 L16 8 L9.2 9.2 L8 16 L6.8 9.2 L0 8 L6.8 6.8 Z" fill="currentColor"/></svg>
        </span>
      `
    }

    function buildStoppedThinkingBlockHtml(statusText = '') {
      const statusHtml = renderThinkingStatusHtml(statusText || displayText('toolDisplay.text.stoppedThinking'))
      return `
        <div class="ai-thinking-block stopped">
          ${buildThinkingPulseIconHtml()}
          <div class="ai-thinking-header-row stopped">
            <div class="ai-thinking-timeline">
              <div class="ai-thinking-line active">
                <span class="ai-thinking-status">${statusHtml}</span>
              </div>
            </div>
          </div>
        </div>
      `
    }

    function softenThinkingPunctuation(raw = '') {
      return ThinkingDisplay.normalizeThinkingPunctuation ? ThinkingDisplay.normalizeThinkingPunctuation(raw) : String(raw || '').trim()
    }

    function normalizeThinkingDisplayText(raw) {
      return ThinkingDisplay.normalizeThinkingPunctuation ? ThinkingDisplay.normalizeThinkingPunctuation(raw) : String(raw || '').trim()
    }

    function getVisibleThinkingLength(value = '') {
      return ThinkingDisplay.getVisibleThinkingLength ? ThinkingDisplay.getVisibleThinkingLength(value) : String(value || '').trim().length
    }

    function compactThinkingStatus(text, maxLength = ThinkingDisplay.PUBLIC_THINKING_MAX_LENGTH || Number.POSITIVE_INFINITY) {
      return ThinkingDisplay.compactThinkingStatus ? ThinkingDisplay.compactThinkingStatus(text, maxLength) : String(text || '').trim()
    }

    function isNoisyThinkingStatus(text = '') {
      return !cleanVisibleThinkingPhrase(text)
    }

    function hasInternalThinkingLeak(text = '') {
      return ThinkingDisplay.hasInternalThinkingLeak ? ThinkingDisplay.hasInternalThinkingLeak(text) : false
    }

    function cleanVisibleThinkingPhrase(raw = '') {
      return ThinkingDisplay.cleanVisibleThinkingPhrase ? ThinkingDisplay.cleanVisibleThinkingPhrase(raw) : String(raw || '').trim()
    }

    function formatMessageTime(value = Date.now()) {
      const date = value instanceof Date ? value : new Date(value || Date.now())
      if (Number.isNaN(date.getTime())) return ''
      return date.toISOString()
    }

    const clipText = HtmlUtils.clipText.bind(HtmlUtils)

    function countTextLines(value = '') {
      const text = String(value || '')
      if (!text) return 0
      return Math.max(1, text.split(/\r\n|\r|\n/).length)
    }

    function getTextEditDelta(args = {}, result = {}) {
      const applied = Array.isArray(result.applied) ? result.applied : []
      const fromResult = {
        add: Number(result.added_lines || 0) || applied.reduce((sum, item) => sum + (Number(item.added_lines || 0) || 0), 0),
        remove: Number(result.removed_lines || 0) || applied.reduce((sum, item) => sum + (Number(item.removed_lines || 0) || 0), 0)
      }
      if (fromResult.add || fromResult.remove) return fromResult
      const edits = Array.isArray(args.edits) ? args.edits : []
      return edits.reduce((acc, edit) => {
        const op = String(edit?.op || '')
        if (op === 'insert_before' || op === 'insert_after') acc.add += countTextLines(edit.content)
        else if (op === 'delete') acc.remove += countTextLines(edit.old_content)
        else if (op === 'replace' || op === 'replace_all') {
          acc.add += countTextLines(edit.new_content)
          acc.remove += countTextLines(edit.old_content)
        }
        return acc
      }, { add: 0, remove: 0 })
    }

    function clipAtSentence(text, maxLength = 300) {
      const value = String(text || '').trim()
      if (!value || value.length <= maxLength) return value

      const limited = value.slice(0, maxLength)
      const sentenceEnd = Math.max(
        limited.lastIndexOf('。'),
        limited.lastIndexOf('！'),
        limited.lastIndexOf('？'),
        limited.lastIndexOf('!'),
        limited.lastIndexOf('?')
      )
      if (sentenceEnd >= Math.floor(maxLength * 0.45)) {
        return limited.slice(0, sentenceEnd + 1).trim()
      }

      const clauseEnd = Math.max(
        limited.lastIndexOf('，'),
        limited.lastIndexOf('；'),
        limited.lastIndexOf(';'),
        limited.lastIndexOf(',')
      )
      if (clauseEnd >= Math.floor(maxLength * 0.55)) {
        return `${limited.slice(0, clauseEnd).trim()}。`
      }

      return `${limited.trimEnd()}。`
    }

    function summarizeThinkingStatus(raw) {
      if (ThinkingDisplay.summarizeThinkingStatus) return ThinkingDisplay.summarizeThinkingStatus(raw)
      return cleanVisibleThinkingPhrase(raw)
    }

    function getEditOldContent(args = {}) {
      return args.old_content ?? args.old_string ?? args.old ?? ''
    }

    function getEditNewContent(args = {}) {
      return args.new_content ?? args.new_string ?? args.new ?? args.content ?? ''
    }

    const formatFileList = HtmlUtils.formatFileList.bind(HtmlUtils)

    const formatMatches = HtmlUtils.formatMatches.bind(HtmlUtils)

    const formatSearchCandidates = HtmlUtils.formatSearchCandidates.bind(HtmlUtils)

    function getCommandOutput(result = {}) {
      const parts = []
      if (result.stderr) parts.push(`[stderr]\n${result.stderr}`)
      if (result.stdout) parts.push(`[stdout]\n${result.stdout}`)
      if (result.output) parts.push(result.output)
      if (result.text) parts.push(result.text)
      if (!parts.length && result.message) parts.push(result.message)
      return clipText(parts.join('\n\n'), window.ToolDetailLazy?.UI_BASH_CHARS || 1000)
    }

    const formatPathFailureDetail = HtmlUtils.formatPathFailureDetail.bind(HtmlUtils)

    function getToolLabel(type, fallbackName) {
      return ToolDisplay.getToolLabel ? ToolDisplay.getToolLabel(fallbackName, type) : (fallbackName || type || '')
    }

    function clearWelcomeEmptyStateIfNeeded(chatMessages) {
      if (!chatMessages) return
      // 优先用全局清理（会停掉 logo 动效）；否则直接剥掉欢迎页节点
      if (typeof window.clearWelcomeEmptyState === 'function') {
        if (chatMessages.querySelector?.('.welcome-empty-state, .no-project-empty-state')) {
          window.clearWelcomeEmptyState({ root: chatMessages })
        }
        return
      }
      chatMessages.querySelectorAll?.('.welcome-empty-state, .no-project-empty-state')?.forEach((node) => {
        try { node.remove() } catch (_) { /* ignore */ }
      })
    }

    function isUserImageAttachment(item = {}) {
      if (item?.type && String(item.type).startsWith('image/')) return true
      const name = String(item?.name || item?.path || '')
      return /\.(png|jpe?g|gif|bmp|webp|svg|ico)$/i.test(name)
    }

    function toUserAttachmentSrc(filePath = '') {
      const value = String(filePath || '').trim()
      if (!value) return ''
      if (/^(?:https?:|file:|data:|blob:)/i.test(value)) return value
      let normalized = value.replace(/\\/g, '/')
      if (!normalized.startsWith('/')) normalized = '/' + normalized
      return 'file://' + encodeURI(normalized)
    }

    function normalizeUserAttachment(item = {}) {
      if (!item || typeof item !== 'object') return null
      const pathValue = String(item.path || '').trim()
      const name = String(item.name || '').trim() || (pathValue ? pathValue.split(/[\\/]/).pop() : '')
      if (!name && !pathValue) return null
      return {
        ...item,
        name: name || 'image',
        path: pathValue,
        type: item.type || ''
      }
    }

    // 旧历史无 attachments 字段时，从正文里的「路径:」行尽量恢复图片元数据（仍不存 base64）。
    function extractImageAttachmentsFromContent(content) {
      let text = ''
      if (typeof content === 'string') text = content
      else if (Array.isArray(content)) {
        text = content.filter(part => part && part.type === 'text').map(part => String(part.text || '')).join('\n')
      }
      if (!text) return []
      const found = []
      const seen = new Set()
      const pathRe = /路径:\s*([^\r\n]+)/g
      let match
      while ((match = pathRe.exec(text)) !== null) {
        const filePath = String(match[1] || '').trim()
        if (!filePath || seen.has(filePath)) continue
        if (!/\.(png|jpe?g|gif|bmp|webp|svg|ico)$/i.test(filePath)) continue
        seen.add(filePath)
        found.push({
          name: filePath.split(/[\\/]/).pop(),
          path: filePath,
          type: 'image/*',
          kind: 'image'
        })
      }
      return found
    }

    function resolveUserAttachments(options = {}, content = '') {
      const fromOptions = Array.isArray(options.attachments)
        ? options.attachments.map(normalizeUserAttachment).filter(Boolean)
        : []
      const fromContent = extractImageAttachmentsFromContent(content)
      const merged = []
      const upsert = (item) => {
        if (!item) return
        const nameKey = String(item.name || '').toLowerCase()
        const pathKey = String(item.path || '').toLowerCase()
        const existing = merged.find(row => {
          if (pathKey && row.path && String(row.path).toLowerCase() === pathKey) return true
          if (nameKey && String(row.name || '').toLowerCase() === nameKey) return true
          return false
        })
        if (existing) {
          if (!existing.path && item.path) existing.path = item.path
          if (!existing.thumb && item.thumb) existing.thumb = item.thumb
          if (!existing.type && item.type) existing.type = item.type
          return
        }
        merged.push({ ...item })
      }
      fromOptions.forEach(upsert)
      fromContent.forEach(upsert)
      // 无 path 且无 thumb 的图片项无法出图，直接丢掉，避免残留文件名大圆占位
      return merged.filter(item => {
        if (!isUserImageAttachment(item)) return true
        return !!(item.path || item.thumb)
      })
    }

    function buildUserAttachmentHtml(item = {}) {
      const normalized = normalizeUserAttachment(item) || item
      const name = String(normalized.name || '')
      const pathValue = String(normalized.path || '')
      const title = escapeHtml(pathValue || name)
      const safeName = escapeHtml(name || 'image')
      if (isUserImageAttachment(normalized)) {
        const thumb = String(normalized.thumb || '').trim()
        // 有磁盘 path 时优先懒加载（不依赖 blob，发送后 clear 附件区也不会裂图）
        // 无 path 时才用 thumb（blob/data）
        if (pathValue) {
          return `<button type="button" class="user-message-image image-preview-lazy" data-path="${escapeHtml(pathValue)}" onclick="event.stopPropagation();openImagePreviewFromData(this)" title="${title}"><span class="image-preview-lazy-text">图片</span></button>`
        }
        if (thumb) {
          return `<button type="button" class="user-message-image" data-path="" onclick="event.stopPropagation();openImagePreviewFromData(this)" title="${title}"><img class="user-message-image-thumb" src="${escapeHtml(thumb)}" alt="${safeName}" loading="lazy"></button>`
        }
        // 无法预览的图片项：不渲染占位，避免裂成大圆
        return ''
      }
      return `<div class="user-message-file" title="${title}">${safeName}</div>`
    }

    function addUserMessage(content, options = {}) {
      const chatMessages = getContainer()
      if (!chatMessages) return null
      // 首次发送时欢迎页与消息共存是 bug：先清欢迎页再挂消息
      if (!options.parentNode || options.parentNode === chatMessages) {
        clearWelcomeEmptyStateIfNeeded(chatMessages)
      }
      ensureStickyBottomTracker(chatMessages)
      bindUserMessageCollapseToggle(chatMessages)
      const stripMentionDirectives = window.WorkbenchMention?.stripMentionDirectives || (value => String(value || '').trim())
      // 先用原始 content 恢复附件路径，再剥离注入文案，避免路径块盖住用户正文。
      const rawDisplayText = contentToUserDisplayText(content)
      const attachments = resolveUserAttachments(options, rawDisplayText)
      const visibleContent = stripInjectedAttachmentBlocks(stripMentionDirectives(rawDisplayText))

      const msg = document.createElement('div')
      msg.className = 'message user'
      msg.dataset.messagePart = 'user'
      if (options.index !== null && options.index !== undefined) msg.dataset.index = options.index
      if (options.turnId !== null && options.turnId !== undefined) msg.dataset.turnId = options.turnId
      if (options.historyIndex !== null && options.historyIndex !== undefined) msg.dataset.historyIndex = options.historyIndex
      if (options.messageId) msg.dataset.messageId = options.messageId
      if (options.itemId !== null && options.itemId !== undefined) msg.dataset.itemId = options.itemId
      if (options.isInterject) {
        msg.classList.add('message-user-interject')
        msg.setAttribute('data-interject-state', options.interjectState || 'queued')
      }
      msg.dataset.messageTime = options.time || ''
      const directiveBadges = Array.isArray(options.directiveBadges)
        ? options.directiveBadges
        : (window.WorkbenchMention?.getMentionDirectiveBadges?.(rawDisplayText) || [])
      const directiveHtml = directiveBadges.length > 0
        ? `<div class="user-message-directives">${directiveBadges.map(item => `<span class="user-message-directive" title="${escapeHtml(item.desc || item.token || '')}">${escapeHtml(item.token || item.label || '')}</span>`).join('')}</div>`
        : ''
      const attachmentPieces = attachments.map(item => buildUserAttachmentHtml(item)).filter(Boolean)
      const attachmentHtml = attachmentPieces.length > 0
        ? `<div class="user-message-attachments">${attachmentPieces.join('')}</div>`
        : ''
      msg.innerHTML = `<div class="message-bubble">${directiveHtml}${attachmentHtml}${buildUserMessageTextHtml(visibleContent)}</div>`
      const parentNode = options.parentNode || chatMessages
      parentNode.appendChild(msg)
      // 有 path 的历史缩略图走懒加载；有 thumb 的即时图无需 hydrate
      if (msg.querySelector('.user-message-image.image-preview-lazy[data-path]')) {
        hydrateLazyImagePreviews(msg)
      }
      if (options.scroll !== false && parentNode === chatMessages) chatMessages.scrollTop = chatMessages.scrollHeight
      return msg
    }

    function addAiMessage(content, options = {}) {
      const chatMessages = getContainer()
      if (!chatMessages) return null
      if (!options.parentNode || options.parentNode === chatMessages) {
        clearWelcomeEmptyStateIfNeeded(chatMessages)
      }
      ensureStickyBottomTracker(chatMessages)

      const msg = document.createElement('div')
      msg.className = 'message ai'
      msg.dataset.messagePart = 'assistant'
      if (options.turnId !== null && options.turnId !== undefined) msg.dataset.turnId = options.turnId
      if (options.historyStart !== null && options.historyStart !== undefined) msg.dataset.historyStart = options.historyStart
      if (options.historyEnd !== null && options.historyEnd !== undefined) msg.dataset.historyEnd = options.historyEnd
      if (Array.isArray(options.messageIds) && options.messageIds.length > 0) {
        msg.dataset.messageIds = options.messageIds.filter(Boolean).join(',')
      }
      msg.dataset.messageTime = options.time || ''
      msg.innerHTML = `<div class="ai-content">${renderAiContent(content, options)}</div>`
      const parentNode = options.parentNode || chatMessages
      parentNode.appendChild(msg)
      if (options.scroll !== false && parentNode === chatMessages) chatMessages.scrollTop = chatMessages.scrollHeight
      return msg
    }

    function scrollToTurn(turnId) {
      const chatMessages = getContainer()
      if (!chatMessages) return

      // 优先定位 user 消息：同一轮对话里 AI 消息也会带相同 data-turn-id，
      // 且 AI 消息通常很长，若先命中 AI 会导致 scrollIntoView 视觉中心偏移，
      // 用户会感觉"没跳到我想看的那条"。
      const userMsg = chatMessages.querySelector(`.message.user[data-turn-id="${turnId}"]`)
      AppLogger.debug('[Frontend] scrollToMessageByTurnId:', turnId, 'found user:', userMsg)
      if (userMsg) {
        highlightMessage(userMsg)
        return
      }

      const targetMsg = chatMessages.querySelector(`.message[data-turn-id="${turnId}"]`)
      AppLogger.debug('[Frontend] scrollToMessageByTurnId:', turnId, 'found:', targetMsg)
      if (targetMsg) {
        highlightMessage(targetMsg)
        return
      }

      const userMsgs = chatMessages.querySelectorAll('.message.user')
      AppLogger.debug('[Frontend] user messages count:', userMsgs.length)
      const userIndex = turnId - 1
      if (userMsgs[userIndex]) {
        highlightMessage(userMsgs[userIndex])
      }
    }


    // 注入消息 content 格式：
    //   【消息注入】用户在当前 AI 执行过程中追加了新的指令。
    //   请先尊重已经完成的工具结果，...
    //   注入消息 1：要科幻风
    //   注入消息 2：...
    // 历史渲染时剥离前两行说明 + "注入消息 N：" 前缀，只保留原始用户内容（多条用换行连接）。
    // 也支持多行内容（注入消息 N：之后的续行也保留）。
    function extractInterjectOriginalContent(rawContent) {
      const text = String(rawContent || '')
      if (!text.trim()) return text
      const lines = text.split('\n')
      const userLines = []
      let inUserSection = false
      for (const line of lines) {
        const match = line.match(/^注入消息\s*\d+\s*[：:]\s*(.*)$/)
        if (match) {
          userLines.push(match[1])
          inUserSection = true
        } else if (inUserSection && line.trim()) {
          // 多行内容的续行（非空行）
          userLines.push(line)
        } else if (inUserSection && !line.trim()) {
          // 空行分隔不同注入消息
          inUserSection = false
        }
      }
      return userLines.length > 0 ? userLines.join('\n') : text
    }

    function groupRounds(messagesHistory, baseIndex = 0) {
      const rounds = []
      let currentRound = null

      for (let index = 0; index < messagesHistory.length; index++) {
        const msg = { ...messagesHistory[index], _historyIndex: baseIndex + index }
        // DeepSeek multi-tool cache bridge: model-only, never render as chat bubbles.
        // Also match legacy rows that only have content markers (before hidden flag).
        if (msg._deepseekBridge || msg.deepseekBridge) continue
        {
          const bridgeText = String(msg.content || '')
          if (
            bridgeText.includes('[Lingxi internal parallel tool batch results]') ||
            /^Lingxi executed \d+ requested tools in parallel/i.test(bridgeText)
          ) continue
        }
        if (msg.type === 'compression-divider') {
          if (currentRound) {
            rounds.push(currentRound)
            currentRound = null
          }
          rounds.push({ divider: msg })
          continue
        }
        if (msg.role === 'user') {
          if (msg.hidden) {
            if (currentRound) currentRound.aiSteps.push(msg)
            continue
          }
          if (msg.interject) {
            if (currentRound) currentRound.aiSteps.push(msg)
            continue
          }
          if (currentRound) rounds.push(currentRound)
          currentRound = { user: msg, aiSteps: [] }
        } else if (msg.role === 'assistant' || msg.role === 'tool') {
          if (currentRound) {
            currentRound.aiSteps.push(msg)
          }
        }
      }

      if (currentRound) rounds.push(currentRound)
      return rounds
    }

    function getRoundModelName(aiSteps) {
      let modelName = 'AI'
      for (const step of aiSteps) {
        if (step.role === 'assistant' && step.modelName) {
          modelName = step.modelName
          break
        }
      }

      if (modelName === 'AI') {
        for (const step of aiSteps) {
          if (step.role === 'assistant') {
            modelName = step.modelName || 'AI'
            break
          }
        }
      }

      return modelName
    }

    function formatElapsedSeconds(totalSeconds) {
      const total = Math.max(0, Math.floor(Number(totalSeconds) || 0))
      const minutes = Math.floor(total / 60)
      const seconds = total % 60
      return minutes > 0
        ? displayText('toolDisplay.text.minutesSeconds', { minutes, seconds })
        : displayText('toolDisplay.text.seconds', { count: seconds })
    }

    function getRoundDurationText(aiSteps) {
      for (let i = aiSteps.length - 1; i >= 0; i--) {
        const step = aiSteps[i]
        if (step.role !== 'assistant') continue
        const durationMs = Number(step.durationMs)
        if (Number.isFinite(durationMs) && durationMs >= 0) {
          return displayText('toolDisplay.text.elapsed', { duration: formatElapsedSeconds(durationMs / 1000) })
        }
        const startedAt = Number(step.startedAt)
        const completedAt = Number(step.completedAt)
        if (Number.isFinite(startedAt) && Number.isFinite(completedAt) && completedAt >= startedAt) {
          return displayText('toolDisplay.text.elapsed', { duration: formatElapsedSeconds((completedAt - startedAt) / 1000) })
        }
      }
      return displayText('toolDisplay.verb.done.default')
    }

    function buildToolSummary(type, args) {
      if (type === 'search') {
        return args.query || args.q || args.pattern || args.regex || ''
      }
      if (type === 'read' || type === 'write' || type === 'edit') {
        const pathKeys = ['file_path', 'path', 'destination', 'to', 'source', 'from']
        for (const key of pathKeys) {
          const value = args[key]
          if (typeof value === 'string' && value.trim()) {
            return getSingleFileName(value) || value
          }
        }
        return ''
      }
      if (type === 'bash') {
        return (args.command || '').substring(0, 30)
      }
      if (type === 'grep') {
        return args.pattern || args.query || args.q || args.regex || ''
      }
      if (type === 'glob' || type === 'search') {
        return args.pattern || args.query || args.q || ''
      }
      if (type === 'auto' || type === 'step') {
        return args.mode || ''
      }
      if (type === 'folder' || type === 'list') {
        const folderPath = args.path || args.folder_path || ''
        return folderPath || displayText('toolDisplay.text.projectDirectory')
      }
      if (type === 'browser') {
        return getWebTarget(args).substring(0, 40)
      }
      return ''
    }

    function normalizeToolType(name, type) {
      if (type && type !== 'unknown') return type
      if (name === 'apply_patch') return 'edit'
      if (name === 'json_edit') return 'edit'
      if (name === 'text_edit') return 'edit'
      if (name === 'move_file') return 'edit'
      if (name === 'copy_file') return 'write'
      if (name === 'create_directory') return 'folder'
      if (name === 'delete_file') return 'edit'
      if (name === 'get_latest_change_session' || name === 'get_change_session') return 'read'
      if (name === 'rollback_latest_change_session' || name === 'rollback_change_session') return 'edit'
      if (name === 'shell_run') return 'bash'
      if (name === 'lxweb') return 'browser'
      if (name === 'research_website_runtime' || name === 'verify_runtime_smoke' || name === 'runtime_verify') return 'browser'
      if (name === 'find_software') return 'search'
      if (name === 'open_software') return 'step'
      if (name === 'report_progress' || name === 'start_final_reply' || name === 'show_thinking_note' || name === 'get_agent_collaboration_status') return 'step'
      if (name === 'enter_plan_mode' || name === 'ask_user_choice' || name === 'confirm_plan') return 'step'
      if (name === 'read_task_ledger_entry') return 'read'
      if (name === 'find_references') return 'grep'
      if (name === 'check_syntax' || name === 'post_change_verify') return 'read'
      if (String(name || '').startsWith('excel_')) return 'excel'
      if (String(name || '').startsWith('ppt_')) return 'ppt'
      if (String(name || '').startsWith('blender_')) return 'blender'
      if (name === 'read_many_files') return 'read'
      if (name === 'git_diff') return 'read'
      if (name === 'find_in_file') return 'grep'
      if (name === 'grep_code') return 'grep'
      if (name === 'glob_files') return 'glob'
      if (name === 'locate_code' || name === 'search_project' || name === 'discover_code' || name === 'dev_workflow' || name === 'parallel_research' || name === 'recall_history') return 'search'
      if (name === 'view_image') return 'vision'
      if (name === 'ui_smoke_check') return 'browser'
      return type || 'unknown'
    }

    function getWebTarget(args = {}, result = {}) {
      const action = String(args.action || args.fn || args.type || result.action || '').toLowerCase()
      const url = args.url || args.html_path || args.htmlPath || args.ref_id || args.href || args.link || result.url || result.href || result.link || ''
      if (url) return String(url)
      if (action.includes('search')) return String(args.query || args.q || result.query || '')
      return String(args.query || args.q || result.query || '')
    }

    function buildWebSummary(target = '') {
      const value = String(target || '').trim()
      if (!value) return `<span class="op-source">${escapeHtml(displayText('toolDisplay.text.processing'))}</span>`
      const short = escapeHtml(value.substring(0, 80))
      if (/^https?:\/\//i.test(value)) {
        return `<span class="op-file" onclick="event.stopPropagation();openInWebview('${escapeHtml(value)}')">${short}</span>`
      }
      return `<span class="op-file">${short}</span>`
    }

    function getWebToolLabel(name = '', args = {}, result = {}) {
      if (name !== 'lxweb') return getToolLabel('browser', name)
      const rawAction = String(args.action || result.action || (args.query || args.q ? 'search' : args.url ? 'fetch' : 'status')).toLowerCase()
      const action = /design|ui_design|analyze_ui|inspect_ui|replicate_ui/.test(rawAction)
        ? 'design'
        : /find/.test(rawAction)
          ? 'find'
          : /open/.test(rawAction)
            ? 'open'
            : /fetch|url/.test(rawAction)
              ? 'fetch'
              : /search/.test(rawAction)
                ? 'search'
                : 'status'
      const key = `tool.lxweb.action.${action}`
      return ToolDisplay.t ? ToolDisplay.t(key, null, getToolLabel('browser', name)) : getToolLabel('browser', name)
    }

    function buildToolCurrentHtml(toolNameCn, summaryHtml, type = '') {
      const iconPart = type ? `<span class="tool-card-icon">${getToolLogIcon(type)}</span>` : ''
      const summaryPart = summaryHtml
        ? `<span class="tool-card-summary">${summaryHtml}</span>`
        : ''
      return `${iconPart}<span class="tool-card-tool">${toolNameCn}</span>${summaryPart}`
    }

    function getOperationVerb(type) {
      return ToolDisplay.getOperationVerb ? ToolDisplay.getOperationVerb(type, false) : displayText('toolDisplay.verb.done.default')
    }

    function getToolLogIcon(type = '') {
      if (type === 'bash') {
        return '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="5" width="16" height="14" rx="2"/><path d="m8 9 3 3-3 3"/><path d="M13 15h4"/></svg>'
      }
      if (type === 'read') {
        return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/><path d="M8 13h8"/><path d="M8 17h5"/></svg>'
      }
      if (type === 'grep' || type === 'glob' || type === 'search' || type === 'browser') {
        return '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m16.5 16.5 3.5 3.5"/></svg>'
      }
      return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>'
    }

    function buildToolLogLineHtml(toolCall = {}) {
      const summary = toolCall.summaryHtml || toolCall.summary || ''
      return `<span class="tool-card-icon">${getToolLogIcon(toolCall.type)}</span>${buildToolCurrentHtml(toolCall.toolNameCn || toolCall.name || '', summary)}`
    }

    function stripHtml(value = '') {
      return String(value || '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim()
    }

    function parsePatchFileDeltas(patch = '') {
      const map = new Map()
      let currentPath = ''
      const ensure = pathValue => {
        const key = String(pathValue || '').trim()
        if (!key) return null
        if (!map.has(key)) map.set(key, { path: key, add: 0, remove: 0 })
        return map.get(key)
      }
      String(patch || '').split(/\r\n|\r|\n/).forEach(line => {
        const addMatch = line.match(/^\*\*\* Add File:\s*(.+)$/)
        const updateMatch = line.match(/^\*\*\* Update File:\s*(.+)$/)
        const deleteMatch = line.match(/^\*\*\* Delete File:\s*(.+)$/)
        const moveMatch = line.match(/^\*\*\* Move to:\s*(.+)$/)
        if (addMatch || updateMatch || deleteMatch) {
          currentPath = (addMatch || updateMatch || deleteMatch)[1].trim()
          ensure(currentPath)
          return
        }
        if (moveMatch) {
          currentPath = moveMatch[1].trim()
          ensure(currentPath)
          return
        }
        if (!currentPath || line.startsWith('***') || line.startsWith('@@')) return
        const item = ensure(currentPath)
        if (!item) return
        if (line.startsWith('+')) item.add += 1
        else if (line.startsWith('-')) item.remove += 1
      })
      return map
    }

    function getToolFileEdits(name, args = {}, result = {}) {
      if (name === 'apply_patch') {
        const deltas = parsePatchFileDeltas(args.patch || '')
        const files = Array.isArray(result.files) ? result.files : []
        const paths = new Set()
        files.forEach(item => {
          const filePath = item.path || item.file || item.to || item.destination || ''
          if (filePath) paths.add(filePath)
        })
        deltas.forEach((_, filePath) => paths.add(filePath))
        return [...paths].map(filePath => {
          const file = files.find(item => (item.path || item.file || item.to || item.destination || '') === filePath) || {}
          const delta = deltas.get(filePath) || {}
          const action = String(file.action || '').toLowerCase()
          return {
            path: filePath,
            label: getSingleFileName(filePath) || filePath,
            add: Math.max(0, Number(file.added || file.additions || file.add || delta.add || (action === 'add' ? file.line_count : 0) || 0)),
            remove: Math.max(0, Number(file.removed || file.deletions || file.remove || delta.remove || (action === 'delete' ? file.line_count : 0) || 0))
          }
        }).filter(item => item.path || item.label)
      }
      if (name === 'json_edit') {
        const filePath = result.path || args.path || ''
        return [{ path: filePath, label: getSingleFileName(filePath) || filePath, add: 1, remove: 1 }]
      }
      if (name === 'text_edit') {
        const filePath = result.path || args.path || ''
        const delta = getTextEditDelta(args, result)
        return [{ path: filePath, label: getSingleFileName(filePath) || filePath, add: delta.add || 0, remove: delta.remove || 0 }]
      }
      if (name === 'copy_file' || name === 'move_file') {
        const filePath = result.destination || args.destination || args.to || args.path || args.file_path || ''
        return [{ path: filePath, label: getSingleFileName(filePath) || filePath, add: 0, remove: 0 }]
      }
      const filePath = args.path || args.file_path || result.path || ''
      const oldStr = getEditOldContent(args)
      const newStr = getEditNewContent(args)
      if (!filePath && !oldStr && !newStr) return []
      const lines = calculateEditLines(oldStr, newStr)
      return [{ path: filePath, label: getSingleFileName(filePath) || filePath, add: lines.add || 0, remove: lines.remove || 0 }]
    }

    function getToolTargetLabel(name, args = {}, result = {}) {
      if (name === 'copy_file' || name === 'move_file') return getSingleFileName(result.destination || args.destination || args.to || args.source || args.from || '')
      if (name === 'apply_patch') {
        const edits = getToolFileEdits(name, args, result)
        if (edits.length === 1) return edits[0].label || edits[0].path
        return edits.length ? displayCount('toolDisplay.text.files', edits.length) : displayText('toolDisplay.text.patch')
      }
      if (name === 'git_diff') return args.path || displayText('toolDisplay.text.workingTreeDiff')
      if (name === 'read_many_files') {
        const files = Array.isArray(result.files) ? result.files : Array.isArray(args.files) ? args.files : []
        return files.length ? displayCount('toolDisplay.text.files', files.length) : displayText('toolDisplay.text.batchFiles')
      }
      if (name === 'get_latest_change_session' || name === 'get_change_session') return displayText('toolDisplay.text.recentChanges')
      if (name === 'rollback_latest_change_session' || name === 'rollback_change_session') return displayText('toolDisplay.text.changeRollback')
      if (name === 'ui_smoke_check') return args.html_path || args.url || result.url || displayText('toolDisplay.text.interface')
      if (name === 'json_edit') return getSingleFileName(result.path || args.path || '')
      const filePath = args.file_path || args.path || result.path || ''
      if (filePath && !args.query && !args.pattern && !args.q) return getSingleFileName(filePath)
      return args.pattern || args.query || args.q || args.regex || result.query || getWebTarget(args, result) || filePath || name
    }

    function getToolEditStats(name, args = {}, result = {}) {
      if (name === 'apply_patch') {
        const edits = getToolFileEdits(name, args, result)
        return {
          fileCount: edits.length,
          add: edits.reduce((sum, item) => sum + Math.max(0, Number(item.add || 0)), 0),
          remove: edits.reduce((sum, item) => sum + Math.max(0, Number(item.remove || 0)), 0)
        }
      }
      if (name === 'json_edit') return { fileCount: 1, add: 1, remove: 1 }
      if (name === 'text_edit') {
        const delta = getTextEditDelta(args, result)
        return { fileCount: args.path || result.path ? 1 : 0, add: delta.add || 0, remove: delta.remove || 0 }
      }
      if (name === 'copy_file' || name === 'move_file') return { fileCount: 1, add: 0, remove: 0 }
      const lines = calculateEditLines(getEditOldContent(args), getEditNewContent(args))
      const fileCount = args.path || args.file_path ? 1 : 0
      return { fileCount, add: lines.add || 0, remove: lines.remove || 0 }
    }

    function renderEditStats(stats = {}) {
      const addText = stats.add > 0 ? `<span class="op-add">+${stats.add}</span>` : ''
      const removeText = stats.remove > 0 ? `<span class="op-remove">-${stats.remove}</span>` : ''
      return [addText, removeText].filter(Boolean).join('')
    }

    function renderToolEditFileRows(edits = [], projectPath = '') {
      const rows = edits.map(item => {
        const fullPath = getFullFilePath(item.path || '', projectPath)
        const label = item.label || getSingleFileName(item.path || '') || item.path || displayText('toolDisplay.text.file')
        const statsHtml = renderEditStats(item)
        return `
          <div class="tool-edit-file-row">
            <span class="tool-log-icon">${getToolLogIcon('edit')}</span>
            <span class="tool-card-tool">${getOperationVerb('edit')}</span>
            <span class="tool-card-summary">
              <span class="op-file" data-path="${escapeHtml(fullPath)}" onclick="event.stopPropagation();openFilePreviewFromData(this)">${escapeHtml(label)}</span>
              ${statsHtml}
            </span>
          </div>
        `
      }).join('')
      return `<div class="tool-edit-file-list">${rows}</div>`
    }

    function getToolCardMeta(toolCall = {}, result = {}) {
      const targetLabel = getToolTargetLabel(toolCall.name, toolCall.args || {}, result)
      const stats = getToolEditStats(toolCall.name, toolCall.args || {}, result)
      return {
        targetLabel,
        editFileCount: stats.fileCount || 0,
        editAdd: stats.add || 0,
        editRemove: stats.remove || 0
      }
    }

    function setToolCardMeta(card, toolCall = {}, result = {}, summaryHtml = '') {
      if (!card) return
      const meta = getToolCardMeta(toolCall, result)
      card.dataset.toolName = toolCall.name || ''
      card.dataset.toolType = toolCall.type || ''
      card.dataset.targetLabel = meta.targetLabel || ''
      card.dataset.summaryText = stripHtml(summaryHtml || toolCall.summary || toolCall.toolNameCn || toolCall.name || '')
      card.dataset.editFileCount = String(meta.editFileCount || 0)
      card.dataset.editAdd = String(meta.editAdd || 0)
      card.dataset.editRemove = String(meta.editRemove || 0)
    }

    function buildToolCardMetaAttrs(toolCall = {}) {
      const meta = getToolCardMeta(toolCall, {})
      return [
        `data-tool-id="${escapeHtml(toolCall.id || '')}"`,
        `data-tool-name="${escapeHtml(toolCall.name || '')}"`,
        `data-tool-type="${escapeHtml(toolCall.type || '')}"`,
        `data-target-label="${escapeHtml(meta.targetLabel || '')}"`,
        `data-summary-text="${escapeHtml(toolCall.summary || toolCall.toolNameCn || toolCall.name || '')}"`,
        `data-edit-file-count="${escapeHtml(meta.editFileCount || 0)}"`,
        `data-edit-add="${escapeHtml(meta.editAdd || 0)}"`,
        `data-edit-remove="${escapeHtml(meta.editRemove || 0)}"`
      ].join(' ')
    }

    function updateHistoryGroupCurrent(group) {
      if (!group) return
      const currentEl = group.querySelector('.tool-group-current')
      const listEl = group.querySelector('.tool-group-list')
      if (!currentEl || !listEl) return
      const cards = [...listEl.querySelectorAll('.tool-call-card')]
      const toolCalls = cards.map(card => ({
        type: card.dataset.toolType || '',
        toolNameCn: card.querySelector('.tool-card-tool')?.textContent || '',
        summary: card.querySelector('.tool-card-summary')?.innerHTML || ''
      }))
      currentEl.innerHTML = buildToolGroupCurrentHtml(toolCalls)
    }

    function buildToolGroupCurrentHtml(toolCalls = []) {
      const count = Array.isArray(toolCalls) ? toolCalls.length : 0
      if (!count) return ''
      const latestToolCall = toolCalls[count - 1]
      if (count === 1) return buildToolCurrentHtml(latestToolCall.toolNameCn, latestToolCall.summary, latestToolCall.type)
      const types = []
      toolCalls.forEach(toolCall => {
        const type = toolCall.type === 'grep' || toolCall.type === 'search' ? 'search' : (toolCall.type || 'default')
        if (!types.includes(type)) types.push(type)
      })
      return types.map(type => {
        const summary = ToolDisplay.getAggregateSummary
          ? ToolDisplay.getAggregateSummary(type)
          : displayText('toolDisplay.aggregate.default')
        return `<span class="tool-agg-block"><span class="tool-card-icon">${getToolLogIcon(type)}</span><span class="tool-agg-text">${escapeHtml(summary)}</span></span>`
      }).join('<span class="tool-agg-sep">，</span>')
    }

    function buildImagePreviewSummary(result, fallbackPath, projectPath) {
      const outputPath = result.path || result.outputPath || fallbackPath || ''
      const fullOutputPath = getFullFilePath(outputPath, projectPath)
      const displayName = getSingleFileName(outputPath) || displayText('toolDisplay.text.image')
      if (result.thumbnailDataUrl) {
        return `<span class="tool-card-summary-shot"><button class="tool-image-preview" type="button" data-path="${escapeHtml(fullOutputPath)}" onclick="event.stopPropagation();openImagePreviewFromData(this)" title="${escapeHtml(displayText('toolDisplay.text.openOriginalImage'))}"><img src="${escapeHtml(result.thumbnailDataUrl)}" alt="${escapeHtml(displayName)}"></button></span>`
      }
      if (fullOutputPath) {
        return `<span class="tool-card-summary-shot"><button class="tool-image-preview image-preview-lazy" type="button" data-path="${escapeHtml(fullOutputPath)}" onclick="event.stopPropagation();openImagePreviewFromData(this)" title="${escapeHtml(displayText('toolDisplay.text.openOriginalImage'))}"><span class="image-preview-lazy-text">Loading image...</span></button></span>`
      }
      return ''
    }

    const lazyPreviewRoots = new Set()
    let lazyPreviewRaf = 0

    function flushLazyImagePreviews() {
      lazyPreviewRaf = 0
      if (!window.api?.readImageDataUrl) {
        lazyPreviewRoots.clear()
        return
      }
      const roots = [...lazyPreviewRoots]
      lazyPreviewRoots.clear()
      const buttons = new Set()
      for (const root of roots) {
        // 历史恢复时消息先挂在 DocumentFragment 上（isConnected=false），仍需收集并加载缩略图
        if (!root) continue
        // Root itself may be the lazy button (e.g. user image onerror fallback).
        if (root.matches?.('.image-preview-lazy[data-path]:not([data-loading])')) buttons.add(root)
        root.querySelectorAll?.('.image-preview-lazy[data-path]:not([data-loading])').forEach(button => buttons.add(button))
      }
      buttons.forEach(button => {
        const imagePath = button.dataset.path || ''
        if (!imagePath) return
        button.dataset.loading = 'true'
        window.api.readImageDataUrl(imagePath).then(result => {
          if (!result?.success || !result.dataUrl) {
            // 加载失败：移除坏占位，避免留下文件名大圆
            button.remove()
            return
          }
          const img = document.createElement('img')
          img.src = result.dataUrl
          img.alt = getSingleFileName(imagePath) || displayText('toolDisplay.text.image')
          button.innerHTML = ''
          button.appendChild(img)
          button.classList.remove('image-preview-lazy')
        }).catch(() => {
          button.remove()
        })
      })
    }

    function hydrateLazyImagePreviews(root) {
      if (!root || !window.api?.readImageDataUrl) return
      lazyPreviewRoots.add(root)
      if (!lazyPreviewRaf) lazyPreviewRaf = requestAnimationFrame(flushLazyImagePreviews)
    }
    // 供工具卡片懒展开时复用
    window.hydrateLazyImagePreviews = hydrateLazyImagePreviews

    function collectToolStats(aiSteps, toolCallsQueue, projectPath) {
      const opTypes = getOpTypes()
      const historyToolStats = { modified: [], created: [], read: [], commands: [] }

      for (const step of aiSteps) {
        if (step.role !== 'tool') continue

        const toolCall = toolCallsQueue.find(tc => tc.id === step.tool_call_id)
        if (!toolCall) continue
        if (isInternalUiOnlyTool(toolCall.name)) continue

        const type = opTypes[toolCall.name] || 'unknown'
        const filePath = toolCall.args.file_path || toolCall.args.path || ''
        const fullFilePath = getFullFilePath(filePath, projectPath)
        let parsedResult = {}
        try {
          parsedResult = JSON.parse(step.content || '{}')
        } catch (e) {
          parsedResult = {}
        }

        if (parsedResult?.success !== false && !parsedResult?.error && !step.content?.includes('error') && !step.content?.includes('Error')) {
          if (type === 'read' && fullFilePath && !historyToolStats.read.includes(fullFilePath)) {
            historyToolStats.read.push(fullFilePath)
          } else if ((type === 'write' || type === 'folder') && fullFilePath && !historyToolStats.created.includes(fullFilePath)) {
            historyToolStats.created.push(fullFilePath)
          } else if (type === 'edit' && fullFilePath && !historyToolStats.modified.includes(fullFilePath)) {
            historyToolStats.modified.push(fullFilePath)
          }
        }

        if (type === 'bash' && toolCall.args.command && !historyToolStats.commands.includes(toolCall.args.command)) {
          historyToolStats.commands.push(toolCall.args.command)
        }
      }

      return historyToolStats
    }

    function hasFinalAssistantContent(aiSteps = []) {
      return aiSteps.some(step => {
        if (!step || step.role !== 'assistant' || step.tool_calls) return false
        return String(step.content || '').trim().length > 0
      })
    }

    function isInterruptedRound(aiSteps = []) {
      return aiSteps.some(step => {
        if (!step || step.role !== 'assistant') return false
        return step.interrupted === true || String(step.content || '').trim() === '[已中断]'
      })
    }

    // --- 虚拟滚动支持：预计算轮次数据 ---
    function precomputeRounds(messagesHistory) {
      const rounds = groupRounds(messagesHistory, 0)
      const result = []
      let messageIndex = 0
      let turnId = 1
      for (const round of rounds) {
        if (round.divider) {
          result.push({ isDivider: true, round: round.divider, messageIndex, turnId })
          continue
        }
        const interjectSteps = (round.aiSteps || []).filter(s => s.interject)
        const cleanAiSteps = (round.aiSteps || []).filter(s => !s.interject)
        const hasAiContent = cleanAiSteps.length > 0 && hasFinalAssistantContent(cleanAiSteps)
        // 未完成轮也必须进入虚拟列表。否则项目/会话切换后，最新用户消息会被分页器主动丢掉。
        // 该轮暂时没有 AI 正文时只渲染用户气泡，运行块仍由 RunningUiRestore 挂到它后面。
        result.push({
          isDivider: false,
          round: { user: round.user, aiSteps: cleanAiSteps },
          interjectSteps,
          messageIndex,
          turnId,
          isHiddenUser: false,
          hasAiContent
        })
        messageIndex++
        turnId++
      }
      return result
    }

    // --- 虚拟滚动支持：渲染单轮 DOM ---
    function renderRound(roundData, projectPath) {
      const fragment = document.createDocumentFragment()
      if (roundData.isDivider) {
        const divider = document.createElement('div')
        divider.className = 'context-divider-auto persisted'
        const round = roundData.round
        if (round.compressionSummaryId) divider.dataset.summaryId = round.compressionSummaryId
        divider.innerHTML = ''
        fragment.appendChild(divider)
        return fragment
      }
      const { round, interjectSteps, messageIndex, turnId, hasAiContent } = roundData
      // 渲染 user 消息
      addUserMessage(round.user.displayContent || round.user.content, {
        index: messageIndex,
        turnId,
        historyIndex: round.user._historyIndex,
        messageId: round.user.messageId,
        attachments: round.user.attachments,
        directiveBadges: round.user.directiveBadges,
        time: round.user.time || '',
        scroll: false,
        parentNode: fragment
      })
      // 渲染 interject aiSteps
      for (const step of interjectSteps) {
        const rawContent = String(step.displayContent || step.content || '')
        const extracted = extractInterjectOriginalContent(rawContent)
        const msg = addUserMessage(extracted, {
          scroll: false,
          isInterject: true,
          itemId: Array.isArray(step.itemIds) ? step.itemIds[0] : null,
          time: step.time || '',
          historyIndex: step._historyIndex,
          messageId: step.messageId,
          turnId,
          parentNode: fragment
        })
        if (msg) {
          msg.classList.add('message-user-interject')
          msg.setAttribute('data-interject-state', 'consumed')
          const bubble = msg.querySelector('.message-bubble')
          if (bubble && !bubble.querySelector('.interject-tag')) {
            const tag = document.createElement('span')
            tag.className = 'interject-tag'
            tag.textContent = '消息注入'
            bubble.appendChild(tag)
          }
        }
      }
      // 渲染 AI 消息
      if (hasAiContent) {
        const aiMsg = document.createElement('div')
        aiMsg.className = 'message ai'
        aiMsg.dataset.messagePart = 'assistant'
        aiMsg.dataset.turnId = turnId
        const aiHistoryIndexes = round.aiSteps.map(step => Number(step._historyIndex)).filter(index => Number.isInteger(index) && index >= 0)
        if (aiHistoryIndexes.length > 0) {
          aiMsg.dataset.historyStart = Math.min(...aiHistoryIndexes)
          aiMsg.dataset.historyEnd = Math.max(...aiHistoryIndexes) + 1
        }
        aiMsg.dataset.messageIds = round.aiSteps.map(step => step.messageId).filter(Boolean).join(',')
        const finalAssistantStep = [...round.aiSteps].reverse().find(step => step.role === 'assistant' && step.content)
        aiMsg.dataset.messageTime = finalAssistantStep?.time || formatMessageTime(finalAssistantStep?.completedAt || finalAssistantStep?.createdAt || Date.now())
        const durationStep = [...round.aiSteps].reverse().find(step =>
          step.role === 'assistant' && (Number.isFinite(Number(step.durationMs)) || (Number(step.startedAt) > 0 && Number(step.completedAt) > 0))
        )
        const durationMs = Number(durationStep?.durationMs)
        if (Number.isFinite(durationMs) && durationMs >= 0) {
          aiMsg.dataset.workDurationMs = String(durationMs)
        } else if (durationStep) {
          const startedAt = Number(durationStep.startedAt)
          const completedAt = Number(durationStep.completedAt)
          if (Number.isFinite(startedAt) && Number.isFinite(completedAt) && completedAt >= startedAt) {
            aiMsg.dataset.workDurationMs = String(completedAt - startedAt)
          }
        }
        aiMsg.dataset.workDone = 'true'
        const { innerHtml } = buildAiMessageHtml(round, projectPath, {
          renderToolDetails: isInterruptedRound(round.aiSteps)
        })
        aiMsg.innerHTML = innerHtml
        fragment.appendChild(aiMsg)
      }
      return fragment
    }

    function isInternalUiOnlyTool(name = '') {
      return ['report_progress', 'start_final_reply', 'show_thinking_note', 'complete_step', 'create_inline_visual'].includes(String(name || ''))
    }

    function parseToolResultContent(content = '') {
      try {
        return JSON.parse(content || '{}')
      } catch (e) {
        return {}
      }
    }

    function collectToolResultsById(aiSteps = []) {
      const results = new Map()
      for (const step of aiSteps) {
        if (step?.role !== 'tool' || !step.tool_call_id) continue
        results.set(step.tool_call_id, parseToolResultContent(step.content || '{}'))
      }
      return results
    }

    function getInternalVisibleStatus(tc = {}, resultByToolId = new Map()) {
      const name = String(tc?.function?.name || '')
      if (name !== 'show_thinking_note' && name !== 'report_progress') return ''
      let args = {}
      try {
        args = JSON.parse(tc.function.arguments || '{}')
      } catch (e) {
        args = {}
      }
      const result = resultByToolId.get(tc.id) || {}
      return result.progressStatus || args.status || args.message || args.content || args.progress || args.note || ''
    }

    function buildHistoryDeepReasoningHtml(reasoningText = '') {
      const raw = String(reasoningText || '').trim()
      if (!raw) return ''
      const contentHtml = escapeHtml(raw).replace(/\r\n|\r|\n/g, '<br>')
      return `
        <div class="ai-work-segment">
          <div class="ai-deep-reasoning-block stopped">
            <div class="ai-deep-reasoning-header collapsed" onclick="AiMessageUI.toggleDeepReasoningBlock(this)">
              <span class="ai-deep-reasoning-icon">
                <span class="pulse-ring"></span>
                <svg class="pulse-core" viewBox="0 0 16 16" width="14" height="14"><path d="M8 0 L9.2 6.8 L16 8 L9.2 9.2 L8 16 L6.8 9.2 L0 8 L6.8 6.8 Z" fill="currentColor"/></svg>
              </span>
              <span class="ai-deep-reasoning-title">深度思考</span>
              <span class="ai-deep-reasoning-time"></span>
              <span class="ai-deep-reasoning-toggle">▸</span>
            </div>
            <div class="ai-deep-reasoning-content collapsed" data-raw-reasoning="${escapeHtml(raw)}">${contentHtml}</div>
          </div>
        </div>
      `
    }

    function buildAiMessageHtml(round, projectPath, options = {}) {
      const opIcons = getOpIcons()
      const opTypes = getOpTypes()
      const toolCallsQueue = []
      // History always keeps elapsed timer + thinking/reasoning blocks.
      // Tool process cards are live-only unless renderToolDetails is explicitly true.
      const renderToolDetails = options.renderToolDetails === true
      let finalContent = ''
      let finalArtifacts = []
      let reasoningContent = ''
      let innerHtml = `<div class="ai-header">${getRoundModelName(round.aiSteps)}</div>`

      // Always render the expandable elapsed-time header for completed/history turns.
      innerHtml += `<div class="ai-work-detail-header" onclick="toggleDynamicArea(this)">
        <span class="work-detail-dots"><span></span><span></span><span></span></span>
        <span class="work-detail-title"></span>
        <span class="work-detail-timer">${escapeHtml(getRoundDurationText(round.aiSteps))}</span>
        <span class="work-detail-toggle">▸</span>
      </div>`
      innerHtml += `<div class="ai-dynamic-area collapsed">`

      const toolCallGroups = []
      const resultByToolId = collectToolResultsById(round.aiSteps)

      for (const step of round.aiSteps) {
        if (step.role !== 'assistant') continue

        if (step.reasoning_content) {
          reasoningContent = String(step.reasoning_content || '')
        }

        if (step.tool_calls && step.tool_calls.length > 0) {
          const renderedToolCalls = []
          const visibleStatuses = []

          for (const tc of step.tool_calls) {
            if (isInternalUiOnlyTool(tc.function?.name)) {
              const status = summarizeThinkingStatus(getInternalVisibleStatus(tc, resultByToolId))
              if (status && !visibleStatuses.includes(status)) visibleStatuses.push(status)
              continue
            }
            let args = {}
            try {
              args = JSON.parse(tc.function.arguments || '{}')
            } catch (e) {
              args = {}
            }

            const type = normalizeToolType(tc.function.name, opTypes[tc.function.name] || 'unknown')
            const icon = opIcons[type] || opIcons.unknown
            const toolNameCn = type === 'browser' ? getWebToolLabel(tc.function.name, args, {}) : getToolLabel(type, tc.function.name)
            const summary = buildToolSummary(type, args)
            const toolInfo = { id: tc.id, name: tc.function.name, args, type, icon, toolNameCn, summary }
            toolCallsQueue.push(toolInfo)
            renderedToolCalls.push(toolInfo)
          }

          if (renderedToolCalls.length > 0) {
            toolCallGroups.push({
              status: visibleStatuses[visibleStatuses.length - 1] || summarizeThinkingStatus(step.progressStatus || ''),
              tools: renderedToolCalls
            })
          } else {
            const status = visibleStatuses[visibleStatuses.length - 1] || summarizeThinkingStatus(step.progressStatus || '')
            if (status) {
              toolCallGroups.push({
                status,
                tools: []
              })
            }
          }
        }
      }

      // Prefer reasoning on the final content-bearing assistant step when present.
      const reasoningStep = [...round.aiSteps].reverse().find(step =>
        step.role === 'assistant' && step.reasoning_content
      )
      if (reasoningStep?.reasoning_content) {
        reasoningContent = String(reasoningStep.reasoning_content || '')
      }
      if (reasoningContent) {
        innerHtml += buildHistoryDeepReasoningHtml(reasoningContent)
      }

      for (const groupInfo of toolCallGroups) {
        const renderedToolCalls = groupInfo.tools
        const statusHtml = groupInfo.status ? buildStoppedThinkingBlockHtml(groupInfo.status) : ''

        // History path: keep thinking notes, skip tool process cards.
        if (!renderToolDetails) {
          if (statusHtml) {
            innerHtml += `
          <div class="ai-work-segment">
            ${statusHtml}
          </div>
        `
          }
          continue
        }

        if (!renderedToolCalls.length) {
          if (!statusHtml) continue
          innerHtml += `
          <div class="ai-work-segment">
            ${statusHtml}
          </div>
        `
          continue
        }
        const latestToolCall = renderedToolCalls[renderedToolCalls.length - 1]
        innerHtml += `
          <div class="ai-work-segment">
            ${statusHtml}
            <div class="tool-call-group" data-active="false">
              <div class="tool-group-header" onclick="toggleToolGroup(this)">
                <span class="tool-group-current">${buildToolGroupCurrentHtml(renderedToolCalls)}</span>
                <span class="tool-card-toggle"><svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="9 6 15 12 9 18"/></svg></span>
              </div>
              <div class="tool-group-list collapsed">
        `

        for (const toolCall of renderedToolCalls) {
          innerHtml += `
            <div class="tool-call-card" ${buildToolCardMetaAttrs(toolCall)} data-latest="${toolCall.id === latestToolCall.id ? 'true' : 'false'}">
              <div class="tool-card-header" onclick="toggleToolCard(this)">
                <span class="tool-card-icon">${getToolLogIcon(toolCall.type)}</span>
                ${buildToolCurrentHtml(toolCall.toolNameCn, toolCall.summary)}
                <span class="tool-card-status"></span>
                <span class="tool-card-toggle"><svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="9 6 15 12 9 18"/></svg></span>
              </div>
              <div class="tool-card-detail collapsed" data-tool-id="${toolCall.id}"></div>
            </div>
          `
        }

        innerHtml += `
              </div>
            </div>
          </div>
        `
      }

      innerHtml += `</div>`

      for (const step of round.aiSteps) {
        if (step.role === 'assistant' && !step.tool_calls && step.content) {
          finalContent = step.content
          finalArtifacts = Array.isArray(step.artifacts) ? step.artifacts : []
        }
      }

      const finalAssistantStep = [...round.aiSteps].reverse().find(step => step.role === 'assistant' && step.content)
      const summaryHtml = generateSummaryHtml(collectToolStats(round.aiSteps, toolCallsQueue, projectPath), finalAssistantStep?.changeSession || null, finalAssistantStep?.operationSnapshot || null)
      innerHtml += `<div class="ai-content">${renderAiContent(finalContent, { summaryHtml, artifacts: finalArtifacts })}</div>`

      return { innerHtml, toolCallsQueue }
    }

    function updateToolDetailCard(aiMsg, step, toolCallsQueue, projectPath) {
      const opTypes = getOpTypes()
      const toolCall = toolCallsQueue.find(tc => tc.id === step.tool_call_id)
      if (!toolCall) return

      const detailEl = aiMsg.querySelector(`.tool-card-detail[data-tool-id="${step.tool_call_id}"]`)
      if (!detailEl) return

      let result = {}
      try {
        result = JSON.parse(step.content || '{}')
      } catch (e) {
        result = { text: step.content }
      }

      const type = normalizeToolType(toolCall.name, opTypes[toolCall.name] || 'unknown')
      toolCall.type = type
      const filePath = toolCall.args.file_path || toolCall.args.path || ''
      const fullFilePath = getFullFilePath(filePath, projectPath)
      const fileName = getSingleFileName(filePath)
      const cardEl = detailEl.parentElement
      const headerEl = cardEl?.querySelector('.tool-card-header')
      const isError = !!(result.error || result.success === false)

      if (cardEl) {
        cardEl.classList.remove('pending', 'success', 'error')
        cardEl.classList.add(isError ? 'error' : 'success')
        cardEl.dataset.toolType = type
      }

      if (headerEl) {
        const iconEl = headerEl.querySelector('.tool-card-icon')
        if (iconEl) {
          iconEl.classList.remove('loading')
          iconEl.innerHTML = getToolLogIcon(type)
        }
        const toolEl = headerEl.querySelector('.tool-card-tool')
        if (toolEl) toolEl.textContent = type === 'browser' ? getWebToolLabel(toolCall.name, toolCall.args, result) : getToolLabel(type, toolCall.name)
        if (!headerEl.querySelector('.tool-card-status')) {
          const status = document.createElement('span')
          status.className = 'tool-card-status'
          headerEl.appendChild(status)
        }
        if (!headerEl.querySelector('.tool-card-toggle')) {
          const toggle = document.createElement('span')
          toggle.className = 'tool-card-toggle'
          toggle.textContent = '▸'
          headerEl.appendChild(toggle)
        }
      }

      const summaryEl = detailEl.parentElement.querySelector('.tool-card-summary')
      if (summaryEl) {
        let interactiveSummary = ''
        switch (type) {
          case 'search': {
            if (toolCall.name === 'dev_workflow') {
              const modeLabel = displayText(`toolDisplay.devMode.${result.mode || toolCall.args.mode || 'default'}`)
              const failedCount = Number(result.syntax?.failed_count || 0)
              const logicErrorCount = Number(result.logic_review?.error_count || 0)
              const logicWarningCount = Number(result.logic_review?.warning_count || 0)
              const bits = []
              if (failedCount) bits.push(displayText('toolDisplay.text.issues', { count: failedCount }))
              if (logicErrorCount) bits.push(displayText('toolDisplay.text.risks', { count: logicErrorCount }))
              if (!logicErrorCount && logicWarningCount) bits.push(displayText('toolDisplay.text.warnings', { count: logicWarningCount }))
              interactiveSummary = `<span class="op-file">${escapeHtml(modeLabel)}</span>${bits.length ? ` <span class="op-source">${escapeHtml(bits.join('，'))}</span>` : ''}`
              break
            }
            const query = toolCall.args.query || toolCall.args.q || toolCall.args.pattern || result.query || ''
            const url = result.url || result.href || result.link || ''
            const count = result.count || result.results?.length || result.matches?.length || result.highConfidence?.length || result.mediumConfidence?.length || 0
            interactiveSummary = url
              ? `<span class="op-file" onclick="event.stopPropagation();openInWebview('${escapeHtml(url)}')">${escapeHtml(query || url)}</span>${count ? ` <span class="op-source">${displayCount('toolDisplay.text.matches', count)}</span>` : ''}`
              : `<span class="op-file">${escapeHtml(query || displayText('toolDisplay.text.findDone'))}</span>${count ? ` <span class="op-source">${displayCount('toolDisplay.text.matches', count)}</span>` : ''}`
            break
          }
          case 'grep': {
            const pattern = toolCall.args.pattern || toolCall.args.query || toolCall.args.q || toolCall.args.regex || result.query || ''
            const count = result.count || result.matches?.length || 0
            interactiveSummary = pattern
              ? `<span class="op-file">${escapeHtml(pattern)}</span>${count ? ` <span class="op-source">${displayCount('toolDisplay.text.matches', count)}</span>` : ''}`
              : `<span class="op-source">${count ? displayCount('toolDisplay.text.results', count) : displayText('toolDisplay.text.findDone')}</span>`
            break
          }
          case 'glob': {
            const pattern = toolCall.args.pattern || toolCall.args.query || toolCall.args.q || result.query || ''
            const files = Array.isArray(result.files) ? result.files : []
            interactiveSummary = pattern
              ? `<span class="op-file">${escapeHtml(pattern)}</span>${files.length ? ` <span class="op-source">${displayCount('toolDisplay.text.files', files.length)}</span>` : ''}`
              : `<span class="op-source">${files.length ? displayCount('toolDisplay.text.files', files.length) : displayText('toolDisplay.text.findDone')}</span>`
            break
          }
          case 'read': {
            if (toolCall.name === 'git_diff') {
              interactiveSummary = `<span class="op-file">${escapeHtml(toolCall.args.path || displayText('toolDisplay.text.workingTreeDiff'))}</span>`
            } else if (toolCall.name === 'read_many_files') {
              const files = Array.isArray(result.files) ? result.files : []
              const okCount = result.ok_count ?? files.filter(item => item.success).length
              interactiveSummary = `<span class="op-file">${escapeHtml(displayCount('toolDisplay.text.files', okCount || files.length || 0))}</span>`
            } else if (toolCall.name === 'get_latest_change_session' || toolCall.name === 'get_change_session') {
              const session = result.session || result.changeSession || result.latest || result
              const files = Array.isArray(session.files) ? session.files : Array.isArray(result.files) ? result.files : []
              const count = files.length || Number(session.file_count || session.fileCount || 0) || 0
              interactiveSummary = `<span class="op-file">${escapeHtml(displayText('toolDisplay.text.recentChanges'))}</span>${count ? ` <span class="op-source">${displayCount('toolDisplay.text.files', count)}</span>` : ''}`
            } else {
              const lineInfo = toolCall.args.limit ? `:${toolCall.args.offset || 1}-${parseInt(toolCall.args.offset || 1) + parseInt(toolCall.args.limit)}` : ''
              interactiveSummary = `<span class="op-file" data-path="${escapeHtml(fullFilePath)}" onclick="event.stopPropagation();openFilePreviewFromData(this)">${escapeHtml(fileName)}</span>${escapeHtml(lineInfo)}`
            }
            break
          }
          case 'write': {
            if (toolCall.name === 'copy_file') {
              const targetPath = result.destination || getFullFilePath(toolCall.args.destination || toolCall.args.to || '', projectPath)
              const targetName = getSingleFileName(targetPath)
              interactiveSummary = `<span class="op-file" data-path="${escapeHtml(targetPath)}" onclick="event.stopPropagation();openFilePreviewFromData(this)">${escapeHtml(targetName)}</span> <span class="op-source">${escapeHtml(displayText('toolDisplay.text.copyTag'))}</span>`
            } else {
              interactiveSummary = `<span class="op-file" data-path="${escapeHtml(fullFilePath)}" onclick="event.stopPropagation();openFilePreviewFromData(this)">${escapeHtml(fileName)}</span>`
            }
            break
          }
          case 'edit': {
            if (toolCall.name === 'move_file') {
              const targetPath = result.destination || getFullFilePath(toolCall.args.destination || toolCall.args.to || '', projectPath)
              const targetName = getSingleFileName(targetPath)
              interactiveSummary = `<span class="op-file" data-path="${escapeHtml(targetPath)}" onclick="event.stopPropagation();openFilePreviewFromData(this)">${escapeHtml(targetName)}</span> <span class="op-source">${escapeHtml(displayText('toolDisplay.text.moveTag'))}</span>`
            } else if (toolCall.name === 'apply_patch' || toolCall.name === 'text_edit') {
              const edits = getToolFileEdits(toolCall.name, toolCall.args, result)
              const total = edits.reduce((acc, item) => ({ add: acc.add + (Number(item.add) || 0), remove: acc.remove + (Number(item.remove) || 0) }), { add: 0, remove: 0 })
              const statsHtml = renderEditStats(total)
              interactiveSummary = edits.length === 1
                ? `<span class="op-file" data-path="${escapeHtml(getFullFilePath(edits[0].path || '', projectPath))}" onclick="event.stopPropagation();openFilePreviewFromData(this)">${escapeHtml(edits[0].label || edits[0].path || displayText('toolDisplay.text.file'))}</span>${statsHtml ? ` ${statsHtml}` : ''}`
                : `<span class="op-file">${displayCount('toolDisplay.text.files', edits.length || 0)}</span>${statsHtml ? ` ${statsHtml}` : ''}`
            } else if (toolCall.name === 'json_edit') {
              const targetPath = result.path || getFullFilePath(toolCall.args.path || '', projectPath)
              const targetName = getSingleFileName(targetPath)
              interactiveSummary = `<span class="op-file" data-path="${escapeHtml(targetPath)}" onclick="event.stopPropagation();openFilePreviewFromData(this)">${escapeHtml(targetName)}</span> <span class="op-source">${displayCount('toolDisplay.text.operations', result.operation_count || toolCall.args.operations?.length || 0)}</span>`
            } else {
              interactiveSummary = `<span class="op-file" data-path="${escapeHtml(fullFilePath)}" onclick="event.stopPropagation();openFilePreviewFromData(this)">${escapeHtml(fileName)}</span>`
            }
            break
          }
          case 'folder': {
            interactiveSummary = `<span class="op-file">${escapeHtml(fileName || toolCall.args.path || toolCall.args.folder_path || displayText('toolDisplay.text.projectDirectory'))}</span>`
            break
          }
          case 'list': {
            interactiveSummary = `<span class="op-file">${escapeHtml(fileName || toolCall.args.path || toolCall.args.folder_path || displayText('toolDisplay.text.projectDirectory'))}</span>`
            break
          }
          case 'bash': {
            interactiveSummary = escapeHtml((toolCall.args.command || '').substring(0, 80))
            break
          }
          case 'browser': {
            if (toolCall.name === 'ui_smoke_check') {
              const target = toolCall.args.html_path || toolCall.args.url || result.url || displayText('toolDisplay.text.interface')
              interactiveSummary = `<span class="op-file">${escapeHtml(String(target).substring(0, 80))}</span> <span class="op-source">${escapeHtml(result.success === false ? displayText('toolDisplay.text.fail') : displayText('toolDisplay.text.pass'))}</span>`
            } else {
              interactiveSummary = buildWebSummary(getWebTarget(toolCall.args, result))
            }
            break
          }
          case 'image':
          case 'vision': {
            interactiveSummary = buildImagePreviewSummary(result, toolCall.args.path || toolCall.args.output_path || '', projectPath)
            break
          }
          case 'music': {
            const projectId = result.projectId || toolCall.args.projectId || ''
            interactiveSummary = `<span class="op-file" onclick="event.stopPropagation();openAgentMusicStudioFromTool('${escapeHtml(projectId)}')">${escapeHtml(displayText('toolDisplay.tool.music_open'))}</span>`
            break
          }
          default: {
            interactiveSummary = escapeHtml(toolCall.summary || toolCall.toolNameCn || toolCall.name)
          }
        }
        summaryEl.innerHTML = interactiveSummary

        setToolCardMeta(cardEl, { ...toolCall, type, toolNameCn: getToolLabel(type, toolCall.name) }, result, interactiveSummary)
        if (cardEl?.dataset.latest === 'true') {
          const currentEl = cardEl.closest('.tool-call-group')?.querySelector('.tool-group-current')
          if (currentEl) currentEl.innerHTML = buildToolCurrentHtml(getToolLabel(type, toolCall.name), interactiveSummary, type)
        }
      }

      let detailContent = ''
      if (result.error || result.success === false) {
        detailContent = `<pre class="tool-error">${escapeHtml(formatPathFailureDetail(result) || result.error || 'Tool failed')}</pre>`
      } else if (type === 'search' && toolCall.name === 'dev_workflow') {
        const rows = [
          result.summary || '',
          result.next_action ? `${displayText('toolDisplay.text.nextStep')} ${result.next_action}` : '',
          result.logic_review?.findings?.length ? `${displayText('toolDisplay.text.qualityReview')}\n${result.logic_review.findings.slice(0, 8).map(item => `- ${item.severity || 'warning'} ${item.path || ''}${item.line ? ':' + item.line : ''} ${item.message || ''}${item.suggestion ? `\n  ${displayText('toolDisplay.text.suggestion')} ${item.suggestion}` : ''}`).join('\n')}` : '',
          result.syntax?.failed_files?.length ? `${displayText('toolDisplay.text.failedFiles')}\n${result.syntax.failed_files.slice(0, 10).map(item => `- ${item.path || item.file || item}`).join('\n')}` : '',
          result.discovery?.readHints?.length ? `${displayText('toolDisplay.text.suggestedReads')}\n${result.discovery.readHints.slice(0, 8).map(item => `- ${item.path || ''}:${item.start_line || 1}-${item.end_line || '?'}`).join('\n')}` : ''
        ].filter(Boolean).join('\n\n')
        detailContent = `<pre>${escapeHtml(rows || displayText('toolDisplay.text.devDone'))}</pre>`
      } else if (type === 'search' && result.results) {
        detailContent = result.results.map((r, i) =>
          `${i + 1}. <a onclick="openInWebview('${escapeHtml(r.url || r.link || '')}')">${escapeHtml(r.title || r.url || r.link || '')}</a>`
        ).join('<br>')
      } else if (type === 'search') {
        detailContent = `<pre>${escapeHtml(formatSearchCandidates(result) || result.message || displayText('toolDisplay.text.searchDone'))}</pre>`
      } else if (type === 'read' && toolCall.name === 'git_diff') {
        detailContent = `<pre>${escapeHtml(result.diff || displayText('toolDisplay.text.noDiff'))}</pre>`
      } else if (type === 'read' && toolCall.name === 'read_many_files') {
        const files = Array.isArray(result.files) ? result.files : []
        const rows = files.map(item => {
          const label = item.relative_path || item.requested_path || item.path || ''
          const range = item.range_read ? `:${item.start_line}-${item.end_line}` : ''
          const status = item.success ? 'ok' : (item.error || 'failed')
          return `${status} ${label}${range}`
        }).join('\n')
        detailContent = `<pre>${escapeHtml(rows || displayText('toolDisplay.text.readManyDone'))}</pre>`
      } else if (type === 'read' && (toolCall.name === 'get_latest_change_session' || toolCall.name === 'get_change_session')) {
        const session = result.session || result.changeSession || result.latest || result
        const files = Array.isArray(session.files) ? session.files : Array.isArray(result.files) ? result.files : []
        const count = files.length || Number(session.file_count || session.fileCount || 0) || 0
        detailContent = `<pre>${escapeHtml(result.message || session.title || displayText('toolDisplay.text.recentChangesRead', { count }))}</pre>`
      } else if (type === 'browser') {
        if (toolCall.name === 'ui_smoke_check') {
          const checks = [
            result.expectedText ? `${displayText('toolDisplay.text.expectedText')} ${result.expectedTextFound ? displayText('toolDisplay.text.found') : displayText('toolDisplay.text.notFound')} ${result.expectedText}` : '',
            result.pageState?.bodyTextLength !== undefined ? `${displayText('toolDisplay.text.bodyLength')} ${result.pageState.bodyTextLength}` : '',
            Array.isArray(result.failures) && result.failures.length ? `${displayText('toolDisplay.text.failures')} ${result.failures.join(', ')}` : '',
            Array.isArray(result.consoleErrors) && result.consoleErrors.length ? `${displayText('toolDisplay.text.consoleErrors')} ${result.consoleErrors.length}` : ''
          ].filter(Boolean).join('\n')
          detailContent = `<pre>${escapeHtml(checks || result.message || displayText('toolDisplay.text.uiCheckDone'))}</pre>`
        } else {
          detailContent = `<pre>${escapeHtml(result.text || result.content || result.message || getWebTarget(toolCall.args, result) || displayText('toolDisplay.text.visitDone'))}</pre>`
        }
      } else if ((type === 'write' && toolCall.name === 'copy_file') || (type === 'edit' && toolCall.name === 'move_file')) {
        detailContent = `<pre>${escapeHtml(result.message || result.error || displayText('toolDisplay.text.operationDone'))}</pre>`
      } else if (type === 'edit' && (toolCall.name === 'apply_patch' || toolCall.name === 'text_edit')) {
        const edits = getToolFileEdits(toolCall.name, toolCall.args, result)
        detailContent = edits.length
          ? renderToolEditFileRows(edits, projectPath)
          : `<pre>${escapeHtml(result.message || displayText('toolDisplay.text.editDone'))}</pre>`
      } else if (type === 'edit' && toolCall.name === 'json_edit') {
        const operations = Array.isArray(result.operations) ? result.operations : []
        const rows = operations.length
          ? operations.map(item => `${item.op || ''} ${item.json_path || ''}${item.skipped ? ` (${item.reason || 'skipped'})` : ''}`).join('\n')
          : Array.isArray(toolCall.args.operations)
            ? toolCall.args.operations.map(item => `${item.op || ''} ${item.json_path || item.path || ''}`).join('\n')
            : ''
        detailContent = `<pre>${escapeHtml(rows || result.message || displayText('toolDisplay.text.jsonUpdated'))}</pre>`
      } else if (type === 'edit') {
        const oldStr = getEditOldContent(toolCall.args)
        const newStr = getEditNewContent(toolCall.args)
        detailContent = `<div class="op-diff"><div class="op-diff-section op-diff-add"><div class="op-diff-label">${escapeHtml(displayText('toolDisplay.text.diffAdd'))}</div><pre>${escapeHtml(clipText(newStr, 800))}</pre></div><div class="op-diff-section op-diff-remove"><div class="op-diff-label">${escapeHtml(displayText('toolDisplay.text.diffRemove'))}</div><pre>${escapeHtml(clipText(oldStr, 800))}</pre></div></div>`
      } else if (type === 'write') {
        const contentPreview = toolCall.args.content ? `${displayText('toolDisplay.text.writeContent')}\n${clipText(toolCall.args.content, 1000)}` : ''
        detailContent = `<pre>${escapeHtml([result.message || displayText('toolDisplay.text.createDone'), contentPreview].filter(Boolean).join('\n\n'))}</pre>`
      } else if (type === 'bash') {
        detailContent = `<pre>${escapeHtml(getCommandOutput(result) || displayText('toolDisplay.text.commandDone'))}</pre>`
      } else if (type === 'list' || type === 'folder') {
        detailContent = `<pre>${escapeHtml(formatFileList(result.files, type === 'list' ? 80 : 50) || result.message || displayCount('toolDisplay.text.items', result.count || 0))}</pre>`
      } else if (type === 'grep') {
        detailContent = `<pre>${escapeHtml(formatMatches(result.matches, 20) || result.message || displayText('toolDisplay.text.findDone'))}</pre>`
      } else if (type === 'glob') {
        detailContent = `<pre>${escapeHtml(formatFileList(result.files, 50) || result.message || displayText('toolDisplay.text.findDone'))}</pre>`
      } else if ((type === 'image' || type === 'vision') && (result.path || result.thumbnailDataUrl)) {
        const preview = buildImagePreviewSummary(result, toolCall.args.path || toolCall.args.output_path || '', projectPath)
        detailContent = [
          preview,
          `<pre>${escapeHtml([
            result.message || 'Image ready',
            result.modelName ? `Model: ${result.modelName}` : '',
            result.prompt ? `Prompt: ${result.prompt}` : '',
            result.summary ? `Summary:\n${result.summary}` : '',
            result.width && result.height ? `Size: ${result.width}x${result.height}` : '',
            result.path ? `Path: ${result.path}` : ''
          ].filter(Boolean).join('\n\n'))}</pre>`
        ].filter(Boolean).join('')
      } else if (result.content) {
        const limit = window.ToolDetailLazy?.UI_CONTENT_CHARS || 600
        const preview = result.content.substring(0, limit) + (result.content.length > limit ? displayText('toolDisplay.text.truncated') : '')
        detailContent = `<pre>${escapeHtml(preview)}</pre>`
      } else if (result.message) {
        detailContent = `<pre>${escapeHtml(clipText(result.message, window.ToolDetailLazy?.UI_PREVIEW_CHARS || 1200))}</pre>`
      } else {
        const limit = window.ToolDetailLazy?.UI_CONTENT_CHARS || 600
        detailContent = `<pre>${escapeHtml(String(step.content || '').substring(0, limit))}</pre>`
      }
      // 历史恢复时正文保留在 DOM，折叠渲染成本交给 content-visibility。
      const isMediaDetail = /tool-image-preview|tool-media-stage|image-preview-lazy/.test(detailContent)
      if (window.ToolDetailLazy?.stash) {
        window.ToolDetailLazy.stash(detailEl, detailContent, {
          media: isMediaDetail,
          onHydrated: (el) => hydrateLazyImagePreviews(el.parentElement)
        })
      } else {
        detailEl.innerHTML = detailContent
        if (!isMediaDetail) detailEl.classList.add('collapsed')
      }
      detailEl.parentElement?.classList.remove('tool-card-file-bundle')
      if (isMediaDetail) hydrateLazyImagePreviews(detailEl.parentElement)
    }

    // 渲染聊天历史。虚拟滚动优先使用 renderRound；这个函数保留给非虚拟滚动兜底和临时窗口恢复。
    function restoreChatHistory(messagesHistory, options = {}) {
      const chatMessages = getContainer()
      if (!chatMessages) return
      // 空历史：清空 chatMessages 容器，避免上一项目残留
      if (!messagesHistory || messagesHistory.length === 0) {
        chatMessages.innerHTML = ''
        return
      }

      const projectPath = options.projectPath || ''
      const total = messagesHistory.length
      const sliceStart = Math.max(0, Number(options.start) || 0)
      const sliceEnd = Math.min(total, Number(options.end) || total)
      const source = String(options.source || 'append')
      if (sliceEnd <= sliceStart) return
      const sliceMessages = (sliceStart === 0 && sliceEnd === total)
        ? messagesHistory
        : messagesHistory.slice(sliceStart, sliceEnd)

      chatMessages.style.scrollBehavior = 'auto'
      const resumeStickyBottom = suspendStickyBottom(chatMessages)

      // 根据 source 决定 DOM 操作：清空/定位插入锚点
      let insertBeforeNode = null
      let insertAfterNode = null
      if (source === 'replace') {
        chatMessages.innerHTML = ''
      } else if (source === 'prepend') {
        insertBeforeNode = chatMessages.firstChild
      } else if (source === 'append') {
        insertAfterNode = chatMessages.lastChild
      }

      try {
        const rounds = groupRounds(sliceMessages, sliceStart)
        const baseUserCount = messagesHistory.slice(0, sliceStart).filter(msg => msg && msg.role === 'user' && !msg.hidden).length
        let messageIndex = baseUserCount
        let turnId = baseUserCount + 1
        // 收集历史里的注入消息，循环结束后统一插到最近一条用户消息下面
        // 避免注入消息散落在各轮，挤压思考/工具可见区域
        const pendingInterjectRenders = []
        // 使用 DocumentFragment 批量插入，减少 DOM reflow
        const batchFragment = document.createDocumentFragment()
        const batchNodes = []
        const appendNode = (node) => {
          if (!node) return
          batchFragment.appendChild(node)
          batchNodes.push(node)
        }
        function flushBatchToDOM() {
          if (batchNodes.length === 0) return
          // 清空引用，防止重复插入
          batchNodes.length = 0
          if (insertBeforeNode && insertBeforeNode.parentNode === chatMessages) {
            chatMessages.insertBefore(batchFragment, insertBeforeNode)
          } else if (insertAfterNode && insertAfterNode.parentNode === chatMessages) {
            if (insertAfterNode.nextSibling) {
              chatMessages.insertBefore(batchFragment, insertAfterNode.nextSibling)
            } else {
              chatMessages.appendChild(batchFragment)
            }
          } else {
            chatMessages.appendChild(batchFragment)
          }
          // 批量挂载后再 hydrate 一次：补抓 DocumentFragment 阶段漏掉的用户图缩略图
          hydrateLazyImagePreviews(chatMessages)
          // 更新 insertAfterNode 为最后一个子节点
          if (source === 'append' || insertAfterNode) {
            const children = chatMessages.children
            insertAfterNode = children[children.length - 1] || null
          }
        }
        for (const round of rounds) {
          const isHiddenUser = Boolean(round.user?.hidden)
          if (round.divider) {
            const divider = document.createElement('div')
            divider.className = 'context-divider-auto persisted'
            if (round.divider.compressionSummaryId) divider.dataset.summaryId = round.divider.compressionSummaryId
            divider.innerHTML = ''
            appendNode(divider)
            continue
          }

          // 注入消息不在此处渲染，循环结束后统一插到最近一条用户消息下面。
          if (round.user.interject) {
            const rawContent = String(round.user.displayContent || round.user.content || '')
            const extracted = extractInterjectOriginalContent(rawContent)
            pendingInterjectRenders.push({
              content: extracted,
              itemId: Array.isArray(round.user.itemIds) ? round.user.itemIds[0] : null,
              time: round.user.time || '',
              historyIndex: round.user._historyIndex,
              messageId: round.user.messageId,
              turnId: turnId
            })
          } else {
            const userMsg = addUserMessage(round.user.displayContent || round.user.content, { index: messageIndex, turnId, historyIndex: round.user._historyIndex, messageId: round.user.messageId, attachments: round.user.attachments, directiveBadges: round.user.directiveBadges, time: round.user.time || '', scroll: false, parentNode: batchFragment })
            if (userMsg) appendNode(userMsg)
          }
          messageIndex++

          // 从本轮 aiSteps 中提取注入消息并渲染到用户消息下方
          if (round.aiSteps && round.aiSteps.length > 0) {
            const interjectSteps = round.aiSteps.filter(function(s) { return s.interject })
            if (interjectSteps.length > 0) {
              round.aiSteps = round.aiSteps.filter(function(s) { return !s.interject })
              for (var _i = 0; _i < interjectSteps.length; _i++) {
                var step = interjectSteps[_i]
                var rawContent = String(step.displayContent || step.content || '')
                var extracted = extractInterjectOriginalContent(rawContent)
                var msg = addUserMessage(extracted, { scroll: false, isInterject: true, itemId: Array.isArray(step.itemIds) ? step.itemIds[0] : null, time: step.time || '', historyIndex: step._historyIndex, messageId: step.messageId, turnId: turnId, parentNode: batchFragment })
                if (msg) {
                  msg.classList.add('message-user-interject')
                  msg.setAttribute('data-interject-state', 'consumed')
                  var bubble = msg.querySelector('.message-bubble')
                  if (bubble && !bubble.querySelector('.interject-tag')) {                    var tag = document.createElement('span')
                    tag.className = 'interject-tag'
                    tag.textContent = '消息注入'
                    bubble.appendChild(tag)
                  }
                  appendNode(msg)
                }
              }
            }
          }

          if (!round.aiSteps || round.aiSteps.length === 0) {
            if (!isHiddenUser) turnId++
            continue
          }
          if (!hasFinalAssistantContent(round.aiSteps)) {
            if (!isHiddenUser) turnId++
            continue
          }
          if (isHiddenUser) {
            continue
          }

          const aiMsg = document.createElement('div')
          aiMsg.className = 'message ai'
          aiMsg.dataset.messagePart = 'assistant'
          aiMsg.dataset.turnId = turnId
          const aiHistoryIndexes = round.aiSteps
            .map(step => Number(step._historyIndex))
            .filter(index => Number.isInteger(index) && index >= 0)
          if (aiHistoryIndexes.length > 0) {
            aiMsg.dataset.historyStart = Math.min(...aiHistoryIndexes)
            aiMsg.dataset.historyEnd = Math.max(...aiHistoryIndexes) + 1
          }
          aiMsg.dataset.messageIds = round.aiSteps.map(step => step.messageId).filter(Boolean).join(',')
          const finalAssistantStep = [...round.aiSteps].reverse().find(step => step.role === 'assistant' && step.content)
          aiMsg.dataset.messageTime = finalAssistantStep?.time || formatMessageTime(finalAssistantStep?.completedAt || finalAssistantStep?.createdAt || Date.now())
          const durationStep = [...round.aiSteps].reverse().find(step =>
            step.role === 'assistant' && (Number.isFinite(Number(step.durationMs)) || (Number(step.startedAt) > 0 && Number(step.completedAt) > 0))
          )
          const durationMs = Number(durationStep?.durationMs)
          if (Number.isFinite(durationMs) && durationMs >= 0) {
            aiMsg.dataset.workDurationMs = String(durationMs)
          } else if (durationStep) {
            const startedAt = Number(durationStep.startedAt)
            const completedAt = Number(durationStep.completedAt)
            if (Number.isFinite(startedAt) && Number.isFinite(completedAt) && completedAt >= startedAt) {
              aiMsg.dataset.workDurationMs = String(completedAt - startedAt)
            }
          }
          aiMsg.dataset.workDone = 'true'
          const { innerHtml } = buildAiMessageHtml(round, projectPath, {
            renderToolDetails: isInterruptedRound(round.aiSteps)
          })
          aiMsg.innerHTML = innerHtml
          appendNode(aiMsg)

          if (!isHiddenUser) turnId++
        }

        // 把批量构建的节点一次性刷入 DOM，减少 reflow
        flushBatchToDOM()

        // 循环结束后，把收集到的注入消息统一插到最近一条用户消息下面
        if (pendingInterjectRenders.length > 0) {
          try {
            const placeInterjectNearLatestUser = (node) => {
              if (!node || node.parentNode !== chatMessages) return
              const myTurn = Number(node.dataset.turnId) || 0
              const allUserEls = Array.from(chatMessages.querySelectorAll('.message.user:not(.message-user-interject)'))
              // 优先找 turnId 相同的用户消息
              let anchor = myTurn ? allUserEls.find(u => Number(u.dataset.turnId) === myTurn) : null
              // 找不到就找最后一条 turnId <= myTurn 的
              if (!anchor && myTurn) {
                const earlier = allUserEls.filter(u => Number(u.dataset.turnId) <= myTurn)
                if (earlier.length) anchor = earlier[earlier.length - 1]
              }
              // 还找不到就用最后一条（兜底）
              if (!anchor && allUserEls.length) anchor = allUserEls[allUserEls.length - 1]
              if (!anchor) return
              let insertBefore = anchor.nextSibling || null
              while (insertBefore && insertBefore.classList?.contains('message-user-interject') && insertBefore !== node) {
                insertBefore = insertBefore.nextSibling
              }
              if (insertBefore !== node) {
                chatMessages.insertBefore(node, insertBefore)
              }
            }
            pendingInterjectRenders.forEach(item => {
              const content = item.content || ''
              const msg = addUserMessage(content, { scroll: false, isInterject: true, itemId: item.itemId, time: item.time, historyIndex: item.historyIndex, turnId: item.turnId })
              if (msg) {
                msg.classList.add('message-user-interject')
                msg.setAttribute('data-interject-state', 'consumed')
                // 补上 interject-tag 视觉标签
                const bubble = msg.querySelector('.message-bubble')
                if (bubble && !bubble.querySelector('.interject-tag')) {
                  const tag = document.createElement('span')
                  tag.className = 'interject-tag'
                  tag.textContent = '消息注入'
                  bubble.appendChild(tag)
                }
                placeInterjectNearLatestUser(msg)
              }
            })
          } catch (e) {
            console.warn('[ChatRenderer] relocate history interject messages failed:', e)
          }
        }
      } finally {
        chatMessages.style.scrollBehavior = ''
        resumeStickyBottom()
        onAfterRestore()
      }
    }

    return {
      addUserMessage,
      addAiMessage,
      restoreChatHistory,
      scrollToTurn,
      precomputeRounds,
      renderRound
    }
  }

  window.ChatRenderer = { bind }
})()
