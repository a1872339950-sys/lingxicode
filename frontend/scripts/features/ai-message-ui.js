(function () {
  const ThinkingDisplay = window.ThinkingDisplay || {}
  const opIcons = {
    search: `<svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>`,
    read: `<svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>`,
    write: `<svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none"><path d="M12 5v14"/><path d="M5 12h14"/></svg>`,
    edit: `<svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>`,
    bash: `<svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none"><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg>`,
    grep: `<svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/><path d="M11 8v6"/><path d="M8 11h6"/></svg>`,
    glob: `<svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>`,
    image: `<svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/></svg>`,
    browser: `<svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>`,
    folder: `<svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>`,
    list: `<svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none"><path d="M8 6h13"/><path d="M8 12h13"/><path d="M8 18h13"/><path d="M3 6h.01"/><path d="M3 12h.01"/><path d="M3 18h.01"/></svg>`,
    vision: `<svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>`,
    music: `<svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>`,
    video: `<svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none"><rect x="3" y="5" width="14" height="14" rx="2"/><path d="m17 9 4-2v10l-4-2z"/></svg>`,

    step: `<svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none"><polyline points="20 6 9 17 4 12"/></svg>`,
    auto: `<svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>`,
    unknown: `<svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`,
    file: `<svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>`,
    thinking: `<span class="thinking-icon"><svg viewBox="0 0 24 24" width="20" height="20"><defs><linearGradient id="thinkGrad" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" style="stop-color:#a78bfa"/><stop offset="50%" style="stop-color:#6366f1"/><stop offset="100%" style="stop-color:#00d4ff"/></linearGradient><filter id="thinkGlow"><feGaussianBlur stdDeviation="2" result="blur"/><feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs><circle cx="12" cy="12" r="6" fill="url(#thinkGrad)" filter="url(#thinkGlow)"/><circle cx="12" cy="12" r="3" fill="white" opacity="0.7"/></svg></span>`
  }

  // 统一 chevron：折叠态朝右，展开态由 CSS 旋转 90°朝下
  const chevronSvg = '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="9 6 15 12 9 18"/></svg>'
  const chevronDownSvg = '<svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg>'

  // 二级“展开全文”阈值：超过该高度才显示展开按钮
  const DEEP_REASONING_TRUNCATE_PX = 240

  function formatReasoningElapsed(ms) {
    const safe = Math.max(0, Number(ms) || 0)
    const sec = safe / 1000
    if (sec < 60) {
      return sec.toFixed(1) + 's'
    }
    const m = Math.floor(sec / 60)
    const s = Math.floor(sec - m * 60)
    return m + 'm ' + s + 's'
  }

  const reasoningTimers = new WeakMap()

  function startReasoningTimer(block) {
    if (!block) return
    const timeEl = block.querySelector('.ai-deep-reasoning-time')
    if (!timeEl) return
    const startedAt = Number(block.dataset.startTime) || Date.now()
    block.dataset.startTime = String(startedAt)
    if (reasoningTimers.has(block)) return
    const tick = () => {
      if (!document.contains(block) || block.classList.contains('stopped')) {
        const id = reasoningTimers.get(block)
        if (id) clearInterval(id)
        reasoningTimers.delete(block)
        return
      }
      timeEl.textContent = formatReasoningElapsed(Date.now() - startedAt)
    }
    tick()
    const id = setInterval(tick, 1000)
    reasoningTimers.set(block, id)
  }

  function stopReasoningTimer(block) {
    if (!block) return
    const id = reasoningTimers.get(block)
    if (id) clearInterval(id)
    reasoningTimers.delete(block)
    const timeEl = block.querySelector('.ai-deep-reasoning-time')
    if (timeEl) {
      const startedAt = Number(block.dataset.startTime) || 0
      const endedAt = Number(block.dataset.endTime) || Date.now()
      block.dataset.endTime = String(endedAt)
      if (startedAt > 0) {
        timeEl.textContent = formatReasoningElapsed(endedAt - startedAt)
      }
    }
  }

  function refreshDeepReasoningTruncation(block) {
    if (!block) return
    const contentEl = block.querySelector('.ai-deep-reasoning-content')
    if (!contentEl) return
    let expandBtn = block.querySelector('.ai-deep-reasoning-expand')
    const isUserExpanded = contentEl.classList.contains('is-expanded')
    // 临时释放限高以获取真实 scrollHeight
    const wasTruncated = contentEl.classList.contains('is-truncated')
    contentEl.classList.remove('is-truncated')
    const fullHeight = contentEl.scrollHeight
    if (isUserExpanded) {
      // 用户已展开全文，保持
      if (!expandBtn) {
        expandBtn = createDeepReasoningExpandBtn()
        contentEl.insertAdjacentElement('afterend', expandBtn)
      }
      expandBtn.classList.add('is-open')
      setDeepReasoningExpandLabel(expandBtn, true)
      return
    }
    if (fullHeight > DEEP_REASONING_TRUNCATE_PX + 24) {
      contentEl.classList.add('is-truncated')
      if (!expandBtn) {
        expandBtn = createDeepReasoningExpandBtn()
        contentEl.insertAdjacentElement('afterend', expandBtn)
      }
      expandBtn.classList.remove('is-open')
      setDeepReasoningExpandLabel(expandBtn, false)
    } else {
      if (wasTruncated) contentEl.classList.remove('is-truncated')
      if (expandBtn) expandBtn.remove()
    }
  }

  function createDeepReasoningExpandBtn() {
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.className = 'ai-deep-reasoning-expand'
    btn.setAttribute('onclick', 'AiMessageUI.toggleDeepReasoningExpand(this)')
    btn.innerHTML = `<span class="ai-deep-reasoning-expand-label">展开全文</span>${chevronDownSvg}`
    return btn
  }

  function setDeepReasoningExpandLabel(btn, isOpen) {
    if (!btn) return
    const label = btn.querySelector('.ai-deep-reasoning-expand-label')
    if (label) label.textContent = isOpen ? '收起' : '展开全文'
  }

  function toggleDeepReasoningExpand(btnEl) {
    if (!btnEl) return
    const block = btnEl.closest('.ai-deep-reasoning-block')
    if (!block) return
    const contentEl = block.querySelector('.ai-deep-reasoning-content')
    if (!contentEl) return
    const willOpen = !contentEl.classList.contains('is-expanded')
    if (willOpen) {
      contentEl.classList.add('is-expanded')
      contentEl.classList.remove('is-truncated')
      btnEl.classList.add('is-open')
      setDeepReasoningExpandLabel(btnEl, true)
    } else {
      contentEl.classList.remove('is-expanded')
      contentEl.classList.add('is-truncated')
      btnEl.classList.remove('is-open')
      setDeepReasoningExpandLabel(btnEl, false)
    }
  }

  function toggleDeepReasoningBlock(headerEl) {
    if (!headerEl) return
    const blockEl = headerEl.closest('.ai-deep-reasoning-block')
    if (!blockEl) return

    const contentEl = blockEl.querySelector('.ai-deep-reasoning-content')
    const expandBtn = blockEl.querySelector('.ai-deep-reasoning-expand')
    const isCollapsed = headerEl.classList.contains('collapsed')

    if (isCollapsed) {
      headerEl.classList.remove('collapsed')
      if (contentEl) contentEl.classList.remove('collapsed')
      // 重新评估是否需要二级展开按钮
      refreshDeepReasoningTruncation(blockEl)
    } else {
      headerEl.classList.add('collapsed')
      if (contentEl) contentEl.classList.add('collapsed')
      if (expandBtn) expandBtn.style.display = 'none'
    }
  }

  const opTypes = {
    lxweb: 'browser',
    browser_search: 'search',
    browser_fetch: 'browser',
    browser_open: 'browser',
    ui_smoke_check: 'browser',
    runtime_verify: 'browser',
    locate_code: 'search',
    discover_code: 'search',
    dev_workflow: 'search',
    parallel_research: 'search',
    inspect_binary: 'read',
    WebFetch: 'browser',
    WebSearch: 'search',
    Read: 'read',
    read_file: 'read',
    read_many_files: 'read',
    git_diff: 'read',
    file_read: 'read',
    file_manage: 'folder',
    file_write_session: 'write',
    file_search: 'glob',
    code_verify: 'read',
    code_inspect: 'search',
    project_history: 'search',
    skill_manage: 'step',
    desktop_app: 'software',
    image_analyze: 'vision',
    mcp: 'step',
    media_process: 'image',
    Write: 'write',
    write_file: 'write',
    create_file: 'write',
    copy_file: 'write',
    create_directory: 'folder',
    delete_file: 'edit',
    Edit: 'edit',
    edit_file: 'edit',
    text_edit: 'edit',
    apply_patch: 'edit',
    json_edit: 'edit',
    move_file: 'edit',
    get_latest_change_session: 'read',
    rollback_latest_change_session: 'edit',
    get_change_session: 'read',
    rollback_change_session: 'edit',
    Bash: 'bash',
    shell_run: 'bash',
    run_command: 'bash',
    execute_command: 'bash',
    Grep: 'grep',
    grep_search: 'grep',
    grep_code: 'grep',
    find_in_file: 'grep',
    locate_code: 'search',
    search_project: 'search',
    discover_code: 'search',
    dev_workflow: 'search',
    Glob: 'glob',
    glob_files: 'glob',
    glob_search: 'glob',
    create_folder: 'folder',
    mkdir: 'folder',
    list_files: 'list',
    complete_step: 'step',
    enter_auto_mode: 'auto',
    recall_history: 'search',
    render_svg_asset: 'image',
    generate_image: 'image',
    generate_music: 'music',
    generate_video: 'video',
    capture_screenshot: 'image',
    image_analyze: 'vision',
    inspect_image: 'vision',
    view_image: 'vision',
    research_website_runtime: 'browser',
    report_progress: 'step',
    start_final_reply: 'step',
    show_thinking_note: 'step',
    get_agent_collaboration_status: 'step',
    verify_runtime_smoke: 'browser',
    find_software: 'search',
    open_software: 'step',
    enter_plan_mode: 'step',
    ask_user_choice: 'step',
    confirm_plan: 'step',
    read_task_ledger_entry: 'read',
    find_references: 'grep',
    check_syntax: 'read',
    post_change_verify: 'read',
    music_open: 'music',
    music_list_instruments: 'music',
    music_compose: 'music',
    music_import_score: 'music',
    music_set_options: 'music',
    music_set_global: 'music',
    music_set_track: 'music',
    music_set_step: 'music',
    music_vary: 'music',
    music_randomize_rhythm: 'music',
    music_apply_preset: 'music',
    music_set_melody: 'music',
    music_set_chords: 'music',
    music_add_fill: 'music',
    music_set_effects: 'music',
    music_clear: 'music',
    music_play: 'music',
    music_stop: 'music',
    music_export_wav: 'music',
    music_inspect: 'music',
    Agent: 'unknown'
    , request_agent_collaboration: 'step'
  }

  function escapeHtmlAttr(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;')
  }

  const escapeHtml = HtmlUtils.escapeHtml

  function isThinkingInlineToken(value = '') {
    return ThinkingDisplay.isThinkingInlineToken ? ThinkingDisplay.isThinkingInlineToken(value) : false
  }

  function renderThinkingStatusHtml(text = '') {
    return ThinkingDisplay.renderThinkingStatusHtml ? ThinkingDisplay.renderThinkingStatusHtml(text) : escapeHtml(text)
  }

  function softenThinkingPunctuation(raw = '') {
    return ThinkingDisplay.normalizeThinkingPunctuation ? ThinkingDisplay.normalizeThinkingPunctuation(raw) : String(raw || '').trim()
  }

  function normalizeThinkingDisplayText(raw) {
    return ThinkingDisplay.normalizeThinkingPunctuation ? ThinkingDisplay.normalizeThinkingPunctuation(raw) : String(raw || '').trim()
  }

  const toolTypes = {
    ...opTypes,
    glob: 'glob',
    grep: 'grep',
    list_files: 'list',
    ask_step_confirm: 'step',
    ask_user_choice: 'step',
    confirm_plan: 'step',
    enter_plan_mode: 'step',
    recall_history: 'recall_history'
  }

  function getToolType(name) {
    return toolTypes[name] || 'unknown'
  }

  function getWebTarget(args = {}) {
    const action = String(args.action || args.fn || args.type || '').toLowerCase()
    const url = args.url || args.ref_id || args.href || args.link || ''
    if (url) return String(url)
    if (action.includes('search')) return args.query || args.q || ''
    return args.query || args.q || ''
  }

  function getToolSummary(name, args = {}) {
    const filePath = args.file_path || args.path || ''
    const fileName = filePath.split(/[\\/]/).pop() || ''

    switch (getToolType(name)) {
      case 'read': return fileName || name
      case 'write': return `${fileName} (新建)`
      case 'edit': return fileName || name
      case 'bash': return args.command?.substring(0, 30) || name
      case 'glob': return args.pattern || name
      case 'grep': return args.pattern?.substring(0, 20) || name
      case 'search': return args.query?.substring(0, 30) || name
      case 'browser': return getWebTarget(args)?.substring(0, 30) || name
      case 'list': return filePath || args.folder_path || ((window.i18n?.t?.('auto.js_ai_message_ui_170_1') ?? '项目目录'))
      case 'folder': return filePath || args.folder_path || ((window.i18n?.t?.('auto.js_ai_message_ui_171_2') ?? '项目目录'))
      case 'image': return args.output_path?.split(/[\\/]/).pop() || args.path?.split(/[\\/]/).pop() || ((window.i18n?.t?.('auto.js_ai_message_ui_172_3') ?? '图片资源'))
      default: return name
    }
  }

  function calculateEditLines(oldStr, newStr) {
    const oldText = oldStr == null ? '' : String(oldStr)
    const newText = newStr == null ? '' : String(newStr)
    // 退化为"前后缀 + 中间段"近似 diff，避免整篇文件行数差导致的夸张数字。
    // 对常见 edit_file 场景（改一段连续区间）已经足够准确。
    if (oldText === newText) return { add: 0, remove: 0, modified: false }
    const oldLines = oldText.split('\n')
    const newLines = newText.split('\n')
    // 大文件回退到简单差值，避免 O(n²) 内存压力
    const HARD_LIMIT = 5000
    if (oldLines.length > HARD_LIMIT || newLines.length > HARD_LIMIT) {
      const add = Math.max(0, newLines.length - oldLines.length)
      const remove = Math.max(0, oldLines.length - newLines.length)
      return { add, remove, modified: add > 0 || remove > 0 }
    }
    const n = oldLines.length
    const m = newLines.length
    let prefix = 0
    const maxPrefix = Math.min(n, m)
    while (prefix < maxPrefix && oldLines[prefix] === newLines[prefix]) prefix++
    let suffix = 0
    const maxSuffix = Math.min(n - prefix, m - prefix)
    while (
      suffix < maxSuffix &&
      oldLines[n - 1 - suffix] === newLines[m - 1 - suffix]
    ) suffix++
    const removed = Math.max(0, n - prefix - suffix)
    const added = Math.max(0, m - prefix - suffix)
    if (added === 0 && removed === 0) {
      return { add: 1, remove: 1, modified: true }
    }
    return { add: added, remove: removed, modified: false }
  }

  function getFileName(path) {
    if (!path) return ''
    const parts = path.split(/[\\/]/)
    return parts.slice(-2).join('/')
  }

  const formatElapsed = FormatUtils.formatElapsedSeconds

  function getMessageElapsed(aiMsg) {
    const startTime = parseInt(aiMsg?.dataset.workStartTime || '0', 10)
    if (!startTime) return 0
    return Math.floor((Date.now() - startTime) / 1000)
  }

  function setWorkDuration(aiMsg, durationMs) {
    if (!aiMsg) return
    const value = Number(durationMs)
    if (!Number.isFinite(value) || value < 0) return
    aiMsg.dataset.workDurationMs = String(value)
  }

  function clearWorkTimer(aiMsg) {
    const timerId = parseInt(aiMsg?.dataset.workTimerId || '0', 10)
    if (timerId) {
      clearInterval(timerId)
      aiMsg.dataset.workTimerId = ''
    }
  }

  function startWorkTimer(aiMsg) {
    if (!aiMsg) return
    clearWorkTimer(aiMsg)
    if (!aiMsg.dataset.workStartTime) {
      aiMsg.dataset.workStartTime = String(Date.now())
    }
    updateWorkElapsed(aiMsg)
    const timerId = setInterval(() => {
      if (!document.contains(aiMsg)) {
        clearInterval(timerId)
        if (aiMsg.dataset.workTimerId === String(timerId)) aiMsg.dataset.workTimerId = ''
        return
      }
      if (aiMsg.dataset.workDone === 'true') {
        clearInterval(timerId)
        if (aiMsg.dataset.workTimerId === String(timerId)) aiMsg.dataset.workTimerId = ''
        return
      }
      updateWorkElapsed(aiMsg)
    }, 1000)
    aiMsg.dataset.workTimerId = String(timerId)
  }

  function pruneCompletedToolGroups() {
    const chatMessages = document.getElementById('chatMessages')
    if (!chatMessages) return
    chatMessages.querySelectorAll('.message.ai').forEach(aiMsg => {
      // Only strip tool process cards. Keep work-detail header (elapsed time)
      // and thinking / deep-reasoning blocks for previous rounds.
      aiMsg.querySelectorAll('.tool-call-group').forEach(group => {
        const segment = group.closest('.ai-work-segment')
        group.remove()
        if (segment && segment.children.length === 0) segment.remove()
      })

      const dynamicArea = aiMsg.querySelector('.ai-dynamic-area')
      if (dynamicArea) {
        dynamicArea.querySelectorAll('.ai-work-segment').forEach(segment => {
          if (segment.children.length === 0) segment.remove()
        })
        // Collapse process area on historical turns; header + timer stay visible.
        if (!dynamicArea.classList.contains('collapsed')) {
          dynamicArea.classList.add('collapsed')
        }
        const toggleEl = aiMsg.querySelector('.ai-work-detail-header .work-detail-toggle')
        if (toggleEl) toggleEl.textContent = '▸'
      }

      // Freeze elapsed text so previous rounds keep "已用X分X秒".
      updateWorkElapsed(aiMsg, true)
      aiMsg.classList.remove('thinking')
    })
  }

  function createAiMessage(modelDisplayName = ((window.i18n?.t?.('auto.js_ai_message_ui_239_4') ?? '灵犀LingXiCode'))) {
    // Starting a new live turn makes every existing AI message historical.
    // Remove only tool process DOM; keep elapsed timer + thinking/reasoning blocks.
    pruneCompletedToolGroups()
    const msg = document.createElement('div')
    msg.className = 'message ai thinking'
    msg.dataset.workStartTime = Date.now()
    msg.dataset.messageTime = new Date().toISOString()
    msg.innerHTML = `
      <div class="ai-header">${modelDisplayName}</div>
      <div class="ai-work-detail-header" onclick="toggleDynamicArea(this)">
        <span class="work-detail-dots thinking"><span></span><span></span><span></span></span>
        <span class="work-detail-title"></span>
        <span class="work-detail-timer">已用时0秒</span>
        <span class="work-detail-toggle">▾</span>
      </div>
      <div class="ai-dynamic-area"></div>
      <div class="ai-content"></div>
    `
    startWorkTimer(msg)
    return msg
  }

  function createNewThinkingBlock(aiMsg, previousBlock, options = {}) {
    if (!aiMsg) return null

    const dynamicArea = aiMsg.querySelector('.ai-dynamic-area')
    if (!dynamicArea) return null

    const requestedAgentRole = String(options.agentRole || '')
    const thinkingKind = options.isReasoningSummary ? 'reasoning' : 'note'
    const shouldReuseOpenSegment = options.reuseOpenSegment === true && thinkingKind !== 'note'
    const latestSegment = shouldReuseOpenSegment ? [...dynamicArea.querySelectorAll('.ai-work-segment')].pop() : null
    if (latestSegment && !latestSegment.querySelector('.tool-call-group')) {
      const existingBlock = latestSegment.querySelector('.ai-thinking-block')
      const existingRow = latestSegment.querySelector('.ai-thinking-header-row')
      const existingAgentRole = existingBlock?.dataset.agentRole || ''
      const existingKind = existingBlock?.dataset.thinkingKind || 'note'
      if (existingBlock && existingAgentRole === requestedAgentRole && existingKind === thinkingKind) {
        existingBlock.classList.remove('stopped')
        existingBlock.classList.add('active')
        existingBlock.dataset.startTime = Date.now()
        if (existingRow) existingRow.classList.remove('stopped')
        return { block: existingBlock, timerId: null }
      }
    }

    const segment = document.createElement('div')
    segment.className = 'ai-work-segment'

    const block = document.createElement('div')
    block.className = 'ai-thinking-block active'
    block.dataset.startTime = Date.now()
    block.dataset.agentRole = requestedAgentRole
    block.dataset.thinkingKind = thinkingKind
    if (options.isTransient) block.dataset.transientUi = 'true'
    if (options.agentTitle) block.dataset.agentTitle = String(options.agentTitle)
    block.innerHTML = `
      <span class="ai-thinking-pulse-icon">
        <span class="pulse-ring"></span>
        <svg class="pulse-core" viewBox="0 0 16 16" width="14" height="14"><path d="M8 0 L9.2 6.8 L16 8 L9.2 9.2 L8 16 L6.8 9.2 L0 8 L6.8 6.8 Z" fill="currentColor"/></svg>
      </span>
      <div class="ai-thinking-header-row">
        <div class="ai-thinking-timeline">
          <div class="ai-thinking-line active">
            <span class="ai-thinking-status">正在处理</span>
          </div>
        </div>
      </div>
    `
    segment.appendChild(block)
    dynamicArea.appendChild(segment)

    return { block, timerId: null }
  }

  function getLatestReasoningBlock(aiMsg, options = {}) {
    if (!aiMsg) return null
    const requestedAgentRole = String(options.agentRole || '')
    const blocks = [...aiMsg.querySelectorAll('.ai-deep-reasoning-block.active')].reverse()
    return blocks.find(block => (block.dataset.agentRole || '') === requestedAgentRole) || null
  }

  function createDeepReasoningBlock(aiMsg, options = {}) {
    if (!aiMsg) return null
    const existingBlock = getLatestReasoningBlock(aiMsg, options)
    if (existingBlock) return existingBlock

    const dynamicArea = aiMsg.querySelector('.ai-dynamic-area')
    if (!dynamicArea) return null

    const segment = document.createElement('div')
    segment.className = 'ai-work-segment'

    const block = document.createElement('div')
    block.className = 'ai-deep-reasoning-block active'
    block.dataset.startTime = Date.now()
    block.dataset.agentRole = String(options.agentRole || '')
    block.innerHTML = `
      <div class="ai-deep-reasoning-header" onclick="AiMessageUI.toggleDeepReasoningBlock(this)">
        <span class="ai-deep-reasoning-icon">
          <span class="pulse-ring"></span>
          <svg class="pulse-core" viewBox="0 0 16 16" width="14" height="14"><path d="M8 0 L9.2 6.8 L16 8 L9.2 9.2 L8 16 L6.8 9.2 L0 8 L6.8 6.8 Z" fill="currentColor"/></svg>
        </span>
        <span class="ai-deep-reasoning-title">深度思考</span>
        <span class="ai-deep-reasoning-time"></span>
        <span class="ai-deep-reasoning-toggle">${chevronSvg}</span>
      </div>
      <div class="ai-deep-reasoning-content"></div>
    `
    segment.appendChild(block)
    dynamicArea.appendChild(segment)
    startReasoningTimer(block)
    return block
  }

  function updateDeepReasoningBlock(aiMsg, content, options = {}) {
    const block = createDeepReasoningBlock(aiMsg, options)
    if (!block) return null
    const contentEl = block.querySelector('.ai-deep-reasoning-content')
    if (!contentEl) return block
    const rawText = String(content || '')
    const previousText = (options.append || contentEl.dataset.rawReasoning)
      ? String(contentEl.dataset.rawReasoning || '')
      : ''
    const fullText = previousText ? `${previousText}${rawText}` : rawText
    contentEl.dataset.rawReasoning = fullText
    // 字符级平滑流式：拆成单字逐帧追加，避免一次性 appendData 导致几段几段蹦字
    if (!previousText) {
      contentEl.textContent = ''
      contentEl.appendChild(document.createTextNode(''))
    }
    enqueueCharsSmoothly(contentEl, rawText)
    if (!block.classList.contains('stopped')) {
      const headerEl = block.querySelector('.ai-deep-reasoning-header')
      if (headerEl && !headerEl.classList.contains('collapsed')) {
        // 流式阶段直接加限高，不做测量（避免反复删加 is-truncated 导致抖动）
        // 测量和展开按钮逻辑留给 finishDeepReasoningBlock 结束时处理
        if (!contentEl.classList.contains('is-truncated')) {
          contentEl.classList.add('is-truncated')
          // 流式过程中关掉渐变遮罩，避免 content 增长导致 mask-image 每 delta 重算
          contentEl.style.maskImage = 'none'
          contentEl.style.webkitMaskImage = 'none'
        }
        // 折叠态自动滚到底：旧内容往上消失，新内容从底部出现
        if (!contentEl.classList.contains('is-expanded')) {
          scheduleReasoningScroll(contentEl)
        }
      }
    }
    return block
  }

  // 共享的滚动跟随调度：50ms 节流，避免每 delta 触发一次 scrollTop 强回流
  const _reasoningScrollLast = new WeakMap()
  function scheduleReasoningScroll(contentEl) {
    if (!contentEl) return
    const now = performance.now()
    const last = _reasoningScrollLast.get(contentEl) || 0
    if (now - last < 50) return
    _reasoningScrollLast.set(contentEl, now)
    requestAnimationFrame(() => {
      if (!document.contains(contentEl)) return
      contentEl.scrollTop = contentEl.scrollHeight
    })
  }

  // 字符级平滑流式：每 rAF 帧追加 3 个字，积压 >30 时自动提速到 6 字/帧
  const _charStreamQueues = new WeakMap()
  function enqueueCharsSmoothly(contentEl, text) {
    if (!contentEl || !text) return
    let state = _charStreamQueues.get(contentEl)
    if (!state) {
      let textNode = contentEl.lastChild
      if (!textNode || textNode.nodeType !== 3) {
        textNode = document.createTextNode('')
        contentEl.appendChild(textNode)
      }
      state = { textNode, queue: [], raf: null }
      _charStreamQueues.set(contentEl, state)
    }
    state.queue.push(...Array.from(text))
    if (state.raf === null) {
      flushCharQueue(contentEl, state)
    }
  }
  function flushCharQueue(contentEl, state) {
    state.raf = requestAnimationFrame(() => {
      const current = _charStreamQueues.get(contentEl)
      if (!current || current.queue.length === 0) {
        if (current) current.raf = null
        return
      }
      const batchSize = current.queue.length > 30 ? 6 : 3
      const batch = current.queue.splice(0, batchSize).join('')
      if (batch) {
        current.textNode.appendData(batch)
        scheduleReasoningScroll(contentEl)
      }
      if (current.queue.length > 0) {
        flushCharQueue(contentEl, current)
      } else {
        current.raf = null
      }
    })
  }
  function flushCharsImmediately(contentEl) {
    const state = _charStreamQueues.get(contentEl)
    if (!state) return
    if (state.queue.length > 0) {
      state.textNode.appendData(state.queue.join(''))
      state.queue.length = 0
    }
    _charStreamQueues.delete(contentEl)
  }

  function finishDeepReasoningBlock(aiMsg) {
    if (!aiMsg) return
    const blocks = aiMsg.querySelectorAll('.ai-deep-reasoning-block.active')
    blocks.forEach(block => {
      block.classList.remove('active')
      block.classList.add('stopped')
      block.dataset.endTime = String(Date.now())
      stopReasoningTimer(block)
      // 排空残留字符队列，恢复渐变遮罩
      const contentEl = block.querySelector('.ai-deep-reasoning-content')
      if (contentEl) {
        flushCharsImmediately(contentEl)
        contentEl.style.maskImage = ''
        contentEl.style.webkitMaskImage = ''
      }
      // 推理结束后保持展开，等最终正文开始流式时再统一收起；这里仅刷新二级展开按钮
      refreshDeepReasoningTruncation(block)
    })
  }

  function collapseAllDeepReasoningBlocks(aiMsg) {
    if (!aiMsg) return
    const blocks = aiMsg.querySelectorAll('.ai-deep-reasoning-block')
    blocks.forEach(block => {
      const headerEl = block.querySelector('.ai-deep-reasoning-header')
      const contentEl = block.querySelector('.ai-deep-reasoning-content')
      const expandBtn = block.querySelector('.ai-deep-reasoning-expand')
      if (headerEl) headerEl.classList.add('collapsed')
      if (contentEl) {
        flushCharsImmediately(contentEl)
        contentEl.classList.add('collapsed')
        contentEl.classList.remove('is-expanded', 'is-truncated')
      }
      if (expandBtn) expandBtn.remove()
    })
  }

  function updateThinkingProgress(blockEl, statusText, options = {}) {
    if (!blockEl || blockEl.classList.contains('stopped')) return

    const rawText = String(statusText || '')
    const previousText = options.isReasoningSummary && options.append
      ? String(getThinkingStatusTarget(blockEl, rawText, options)?.dataset?.fullStatus || '')
      : ''
    const sourceText = previousText ? `${previousText}${rawText}` : rawText
    const summaryText = options.isReasoningSummary
      ? sanitizeThinkingStatus(compactThinkingStatus(sourceText), sourceText)
      : summarizeThinkingStatus(sourceText)
    if (!summaryText) return Promise.resolve()
    if (getVisibleThinkingLength(summaryText) <= 6) return Promise.resolve()
    const text = summaryText
    const statusEl = getThinkingStatusTarget(blockEl, text, options)
    if (!statusEl) return Promise.resolve()
    if (!text) return Promise.resolve()
    if (!options.forceUpdate && areThinkingStatusesSimilar(text, statusEl.dataset.fullStatus || '')) {
      return statusEl._statusPromise || Promise.resolve()
    }
    return streamThinkingStatus(statusEl, text, options)
  }

  function getThinkingTimeline(blockEl) {
    if (!blockEl) return null
    let timeline = blockEl.querySelector('.ai-thinking-timeline')
    if (timeline) return timeline
    const headerRow = blockEl.querySelector('.ai-thinking-header-row')
    const oldStatus = blockEl.querySelector('.ai-thinking-status')
    if (!headerRow) return null
    timeline = document.createElement('div')
    timeline.className = 'ai-thinking-timeline'
    const line = document.createElement('div')
    line.className = 'ai-thinking-line active'
    if (oldStatus) {
      oldStatus.remove()
      line.appendChild(oldStatus)
    } else {
      const status = document.createElement('span')
      status.className = 'ai-thinking-status'
      status.textContent = ((window.i18n?.t?.('auto.js_ai_message_ui_333_0') ?? ((window.i18n?.t?.('auto.js_ai_message_ui_333_5') ?? '正在处理'))))
      line.appendChild(status)
    }
    timeline.appendChild(line)
    headerRow.appendChild(timeline)
    return timeline
  }

  function getThinkingStatusTarget(blockEl, text, options = {}) {
    const timeline = getThinkingTimeline(blockEl)
    if (!timeline) return blockEl.querySelector('.ai-thinking-status')

    const lastLine = timeline.querySelector('.ai-thinking-line:last-child')
    const lastStatus = lastLine?.querySelector('.ai-thinking-status')
    if (lastStatus && options.append) return lastStatus

    if (lastStatus && !lastStatus.dataset.fullStatus && lastStatus.textContent.trim() === ((window.i18n?.t?.('auto.js_ai_message_ui_349_6') ?? '正在处理'))) {
      return lastStatus
    }

    const existingText = lastStatus?.dataset.fullStatus || lastStatus?.textContent || ''
    if (lastStatus && !options.forceUpdate && areThinkingStatusesSimilar(text, existingText)) {
      return lastStatus
    }

    if (lastLine) lastLine.classList.remove('active')
    const line = document.createElement('div')
    line.className = 'ai-thinking-line active'
    const status = document.createElement('span')
    status.className = 'ai-thinking-status'
    line.appendChild(status)
    timeline.appendChild(line)

    const lines = timeline.querySelectorAll('.ai-thinking-line')
    if (lines.length > 10) lines[0].remove()
    return status
  }

  function getThinkingStatusKey(text) {
    return String(text || '')
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\u4e00-\u9fa5]+/gu, '')
      .replace(/\d+(?:\.\d+)?(?:行|kb|mb|b)?/gi, '')
      .replace(/(正在|生成|编辑|文件|代码|已生成|参数|接收|准备|写入|修改)/g, '')
      .slice(0, 32)
  }

  function areThinkingStatusesSimilar(a, b) {
    if (!a || !b) return false
    const aKey = getThinkingStatusKey(a)
    const bKey = getThinkingStatusKey(b)
    if (!aKey || !bKey) return false
    return aKey === bKey || (aKey.length >= 8 && bKey.length >= 8 && (aKey.includes(bKey) || bKey.includes(aKey)))
  }

  function getVisibleThinkingLength(value = '') {
    return ThinkingDisplay.getVisibleThinkingLength ? ThinkingDisplay.getVisibleThinkingLength(value) : String(value || '').trim().length
  }

  function isUserRequestRestatement(raw) {
    return ThinkingDisplay.isUserRequestRestatement ? ThinkingDisplay.isUserRequestRestatement(raw) : false
  }

  function isNonProgressThinking(raw) {
    return ThinkingDisplay.isNonProgressThinking ? ThinkingDisplay.isNonProgressThinking(raw) : !String(raw || '').trim()
  }

  function hasInternalThinkingLeak(raw) {
    return ThinkingDisplay.hasInternalThinkingLeak ? ThinkingDisplay.hasInternalThinkingLeak(raw) : false
  }

  function sanitizeThinkingStatus(summary, raw = summary) {
    let text = String(summary || '').trim()
    if (!text) return ''
    if (hasInternalThinkingLeak(text) || hasInternalThinkingLeak(raw)) {
      return ''
    }
    text = text
      .replace(/\b(?:internal_next_instruction|start_final_reply|show_thinking_note|query_code_map)\b/gi, '')
      .replace(/\s+/g, ' ')
      .trim()
    if (hasInternalThinkingLeak(text)) return ''
    return normalizeThinkingPunctuation(text)
  }

  function normalizeThinkingPunctuation(raw) {
    return ThinkingDisplay.normalizeThinkingPunctuation ? ThinkingDisplay.normalizeThinkingPunctuation(raw) : String(raw || '').trim()
  }

  function compactThinkingStatus(text, maxLength = ThinkingDisplay.PUBLIC_THINKING_MAX_LENGTH || Number.POSITIVE_INFINITY) {
    return ThinkingDisplay.compactThinkingStatus ? ThinkingDisplay.compactThinkingStatus(text, maxLength) : String(text || '').trim()
  }

  function cleanVisibleThinkingPhrase(raw = '') {
    return ThinkingDisplay.cleanVisibleThinkingPhrase ? ThinkingDisplay.cleanVisibleThinkingPhrase(raw) : String(raw || '').trim()
  }

  function shouldDisplayThinkingStatus(raw) {
    if (ThinkingDisplay.shouldDisplayThinkingStatus) return ThinkingDisplay.shouldDisplayThinkingStatus(raw)
    const summary = summarizeThinkingStatus(raw)
    if (!summary) return false
    return getVisibleThinkingLength(summary) > 10
  }

  function streamThinkingStatus(statusEl, text, options = {}) {
    if (!statusEl || !text) return Promise.resolve()
    if (statusEl.dataset.fullStatus === text) {
      return statusEl._statusPromise || Promise.resolve()
    }

    const previousTimer = parseInt(statusEl.dataset.statusTimer || '0', 10)
    if (previousTimer) {
      cancelAnimationFrame(previousTimer)
      statusEl.dataset.statusTimer = ''
      if (statusEl._resolveStatusPromise) statusEl._resolveStatusPromise()
    }

    statusEl.dataset.fullStatus = text
    statusEl.textContent = ''
    statusEl.dataset.statusDone = ''

    let index = 0
    const step = Math.max(2, Math.ceil(text.length / 18))
    let lastFrame = 0
    statusEl._statusPromise = new Promise(resolve => {
      statusEl._resolveStatusPromise = resolve

      function tick(ts) {
        if (!document.contains(statusEl)) {
          statusEl.dataset.statusTimer = ''
          statusEl._resolveStatusPromise = null
          resolve()
          return
        }

        // 节流到约 60ms 一帧，避免 18ms 高频回流
        if (ts - lastFrame < 50) {
          statusEl.dataset.statusTimer = String(requestAnimationFrame(tick))
          return
        }
        lastFrame = ts

        index = Math.min(text.length, index + step)
        statusEl.textContent = text.slice(0, index)
        if (typeof options.onStatusFrame === 'function') {
          options.onStatusFrame()
        }

        if (index >= text.length) {
          statusEl.dataset.statusTimer = ''
          statusEl.dataset.statusDone = '1'
          statusEl._resolveStatusPromise = null
          resolve()
        } else {
          statusEl.dataset.statusTimer = String(requestAnimationFrame(tick))
        }
      }

      statusEl.dataset.statusTimer = String(requestAnimationFrame(tick))
    })

    return statusEl._statusPromise
  }

  function summarizeThinkingStatus(raw) {
    if (ThinkingDisplay.summarizeThinkingStatus) return ThinkingDisplay.summarizeThinkingStatus(raw)
    return cleanVisibleThinkingPhrase(raw)
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

  function updateWorkElapsed(aiMsg, final = false) {
    if (!aiMsg) return
    let timerEl = aiMsg.querySelector('.work-detail-timer')
    const titleEl = aiMsg.querySelector('.work-detail-title')
    const dotsEl = aiMsg.querySelector('.work-detail-dots')
    if (!timerEl && titleEl) {
      timerEl = document.createElement('span')
      timerEl.className = 'work-detail-timer'
      titleEl.parentElement?.insertBefore(timerEl, titleEl.nextSibling)
    }
    if (!timerEl) return

    let fixedDurationMs = parseInt(aiMsg?.dataset.workDurationMs || '', 10)
    // On finalize, snapshot duration so later re-freeze (e.g. prune) won't grow with wall clock.
    if (final && !Number.isFinite(fixedDurationMs)) {
      const startTime = parseInt(aiMsg?.dataset.workStartTime || '0', 10)
      if (startTime > 0) {
        fixedDurationMs = Math.max(0, Date.now() - startTime)
        aiMsg.dataset.workDurationMs = String(fixedDurationMs)
      }
    }
    const elapsedSeconds = Number.isFinite(fixedDurationMs)
      ? Math.floor(fixedDurationMs / 1000)
      : getMessageElapsed(aiMsg)
    const elapsedText = formatElapsed(elapsedSeconds)
    
    if (final) {
      timerEl.textContent = `已用${elapsedText}`
      if (titleEl) titleEl.textContent = ''
      if (dotsEl) dotsEl.classList.remove('thinking')
      aiMsg.dataset.workDone = 'true'
      clearWorkTimer(aiMsg)
    } else {
      timerEl.textContent = `已用时${elapsedText}`
      if (titleEl) titleEl.textContent = ''
      if (dotsEl) dotsEl.classList.add('thinking')
    }
  }

  function startBlockTimer(blockEl) {
    if (!blockEl) return null
    const aiMsg = blockEl.closest('.message.ai')
    updateWorkElapsed(aiMsg)

    const timerId = setInterval(() => {
      if (!document.contains(blockEl)) {
        clearInterval(timerId)
        return
      }

      if (blockEl.classList.contains('stopped')) {
        clearInterval(timerId)
        return
      }

      const startTime = parseInt(blockEl.dataset.startTime) || Date.now()
      const elapsed = Math.floor((Date.now() - startTime) / 1000)
      const timeEl = blockEl.querySelector('.ai-thinking-time')
      if (timeEl) {
        timeEl.textContent = `(${formatElapsed(elapsed)})`
      }
      updateWorkElapsed(aiMsg)
    }, 1000)

    blockEl.dataset.timerId = timerId
    return timerId
  }

  function finishThinkingBlock(blockEl, reason = 'done') {
    if (!blockEl) return

    const timerId = blockEl.dataset.timerId
    if (timerId) {
      clearInterval(parseInt(timerId))
    }

    const startTime = parseInt(blockEl.dataset.startTime) || Date.now()
    const elapsed = Math.floor((Date.now() - startTime) / 1000)

    const headerRowEl = blockEl.querySelector('.ai-thinking-header-row')
    const statusEl = blockEl.querySelector('.ai-thinking-status')
    const timeEl = blockEl.querySelector('.ai-thinking-time')
    const statusTimer = parseInt(statusEl?.dataset.statusTimer || '0', 10)
    if (statusTimer) {
      clearInterval(statusTimer)
      if (statusEl?.dataset.fullStatus) statusEl.textContent = statusEl.dataset.fullStatus
      if (statusEl) statusEl.dataset.statusTimer = ''
    }
    if (timeEl) timeEl.textContent = `(${formatElapsed(elapsed)})`

    blockEl.classList.remove('active')
    blockEl.classList.add('stopped')
    if (headerRowEl) headerRowEl.classList.add('stopped')
    if (reason === 'reasoning-end') {
      headerRowEl?.classList.add('collapsed')
      blockEl.querySelector('.ai-thinking-content')?.classList.add('collapsed')
      const toggleEl = headerRowEl?.querySelector('.ai-thinking-toggle')
      if (toggleEl) toggleEl.textContent = '▸'
    }
  }

  function clearTransientThinkingPlaceholders(aiMsg) {
    if (!aiMsg) return
    aiMsg.querySelectorAll('.ai-thinking-block').forEach(block => {
      const statuses = [...block.querySelectorAll('.ai-thinking-status')]
      const onlyDefaultPlaceholder = statuses.length > 0 && statuses.every(status => {
        const text = String(status.dataset.fullStatus || status.textContent || '').trim()
        return !status.dataset.fullStatus && text === '正在处理'
      })
      if (block.dataset.transientUi !== 'true' && !onlyDefaultPlaceholder) return
      const segment = block.closest('.ai-work-segment')
      if (segment && !segment.querySelector('.tool-call-group, .intermediate-content-block')) segment.remove()
      else block.remove()
    })
  }

  // 轻量级增量 sanitize：只做基本 HTML 转义 + 行内代码，不做完整 markdown 渲染
  function quickSanitizeChunk(text) {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/\n/g, '<br>')
      .replace(/`([^`]+)`/g, '<code class="ai-inline-code">$1</code>')
  }

  let typewriterState = {
    content: '',
    currentIndex: 0,
    isRunning: false,
    targetEl: null,
    intervalId: null,
    lastScrollTop: 0,
    lastRenderedIndex: 0
  }

  function ensureTypewriterStyle() {
    if (document.getElementById('typewriter-style')) return

    const style = document.createElement('style')
    style.id = 'typewriter-style'
    style.textContent = `
      @keyframes blink { 0%, 50% { opacity: 1; } 51%, 100% { opacity: 0; } }
      .typewriter-text { display: block; }
      .typewriter-cursor { display: inline; color: var(--accent-primary); }
    `
    document.head.appendChild(style)
  }

  function startTypewriterEffect(targetEl, fullContent, options = {}) {
    if (!targetEl) return

    ensureTypewriterStyle()

    if (typewriterState.intervalId) {
      clearInterval(typewriterState.intervalId)
    }

    const scrollContainer = options.scrollContainer
    const sanitizeContent = options.sanitizeContent || sanitizeAiContent
    const getSummaryHtml = options.getSummaryHtml || function () { return '' }
    const onFirstFrame = options.onFirstFrame || function () {}
    const onComplete = options.onComplete || function () {}
    const content = String(fullContent || '')

    if (!content) {
      targetEl.innerHTML = ''
      typewriterState = {
        content: '',
        currentIndex: 0,
        isRunning: false,
        targetEl: null,
        intervalId: null,
        lastScrollTop: scrollContainer?.scrollTop || 0,
        lastRenderedIndex: 0
      }
      onComplete()
      return
    }

    typewriterState = {
      content,
      currentIndex: 0,
      isRunning: true,
      targetEl,
      intervalId: null,
      lastScrollTop: scrollContainer?.scrollTop || 0,
      lastRenderedIndex: 0
    }

    const totalLength = typewriterState.content.length
    const speed = totalLength > 1800 ? 48 : Math.max(16, Math.min(50, 1200 / Math.max(totalLength, 1)))
    const batchSize = Math.max(6, Math.min(80, Math.ceil(totalLength / 120)))
    // 首次渲染：放入文本容器 + 光标，避免每次 innerHTML 全量重解析
    targetEl.innerHTML = '<span class="typewriter-text"></span><span class="typewriter-cursor" style="opacity:0.7;animation:blink 0.8s infinite;">▌</span>'
    const textContainer = targetEl.querySelector('.typewriter-text')
    const renderNextFrame = () => {
      const nextBatchSize = Math.min(batchSize, typewriterState.content.length - typewriterState.currentIndex)
      if (nextBatchSize <= 0) return false
      typewriterState.currentIndex += nextBatchSize
      const newIndex = typewriterState.currentIndex
      const oldIndex = typewriterState.lastRenderedIndex

      if (oldIndex === 0) {
        // 首帧：用完整 sanitize 渲染初始内容
        textContainer.innerHTML = sanitizeContent(typewriterState.content.substring(0, newIndex))
      } else {
        const newChunk = typewriterState.content.substring(oldIndex, newIndex)
        // 检测是否跨越代码块边界，涉及 ``` 时回退到全量渲染
        const hasCodeBlockInChunk = newChunk.includes('```')
        const hasUnclosedBlockBefore = (typewriterState.content.lastIndexOf('```', oldIndex - 1) >= 0 &&
          (typewriterState.content.substring(0, oldIndex).match(/```/g) || []).length % 2 !== 0)
        if (hasCodeBlockInChunk || hasUnclosedBlockBefore) {
          textContainer.innerHTML = sanitizeContent(typewriterState.content.substring(0, newIndex))
        } else {
          // 增量追加：只 sanitize 新增片段
          textContainer.insertAdjacentHTML('beforeend', quickSanitizeChunk(newChunk))
        }
      }
      typewriterState.lastRenderedIndex = newIndex
      return true
    }

    if (renderNextFrame()) {
      onFirstFrame()
    }

    typewriterState.intervalId = setInterval(() => {
      if (!typewriterState.isRunning || !document.contains(targetEl)) {
        clearInterval(typewriterState.intervalId)
        return
      }

      if (!renderNextFrame()) {
        clearInterval(typewriterState.intervalId)
        typewriterState.isRunning = false

        // 打字机完成：做一次完整 sanitize + decorateFileReferences
        targetEl.innerHTML = renderAiContent(typewriterState.content, {
          summaryHtml: getSummaryHtml(),
          artifacts: options.artifacts || []
        })
        onComplete()
        return
      }

    }, speed)
  }

  function finishTypewriterEffect(options = {}) {
    if (typewriterState.intervalId) {
      clearInterval(typewriterState.intervalId)
    }

    const sanitizeContent = options.sanitizeContent || sanitizeAiContent
    const getSummaryHtml = options.getSummaryHtml || function () { return '' }
    const onComplete = options.onComplete || function () {}

    if (typewriterState.targetEl && typewriterState.content) {
      typewriterState.targetEl.innerHTML = renderAiContent(typewriterState.content, {
        summaryHtml: getSummaryHtml(),
        artifacts: options.artifacts || []
      })
    }

    typewriterState.isRunning = false
    onComplete()
  }

  function toggleDynamicArea(headerEl) {
    if (!headerEl) return
    const aiMsg = headerEl.closest('.message.ai')
    if (!aiMsg) return

    const dynamicArea = aiMsg.querySelector('.ai-dynamic-area')
    if (!dynamicArea) return

    const toggleEl = headerEl.querySelector('.work-detail-toggle')
    const isCollapsed = dynamicArea.classList.contains('collapsed')

    if (isCollapsed) {
      dynamicArea.classList.remove('collapsed')
      if (toggleEl) toggleEl.textContent = '▾'
    } else {
      dynamicArea.classList.add('collapsed')
      if (toggleEl) toggleEl.textContent = '▸'
    }
  }

  function collapseDynamicArea(aiMsg) {
    if (!aiMsg) return
    const dynamicArea = aiMsg.querySelector('.ai-dynamic-area')
    const headerEl = aiMsg.querySelector('.ai-work-detail-header')
    const toggleEl = headerEl?.querySelector('.work-detail-toggle')

    if (dynamicArea && !dynamicArea.classList.contains('collapsed')) {
      dynamicArea.classList.add('collapsed')
      if (toggleEl) toggleEl.textContent = '▸'
    }
    updateWorkElapsed(aiMsg, true)
  }

  function updateWorkStatus(aiMsg, status) {
    if (!aiMsg) return
    const headerEl = aiMsg.querySelector('.ai-work-detail-header')
    const titleEl = headerEl?.querySelector('.work-detail-title')
    const dotsEl = headerEl?.querySelector('.work-detail-dots')
    if (!titleEl) return

    switch (status) {
      case 'working':
        aiMsg.dataset.workDone = 'false'
        delete aiMsg.dataset.workDurationMs
        if (!aiMsg.dataset.workStartTime) {
          aiMsg.dataset.workStartTime = String(Date.now())
        }
        startWorkTimer(aiMsg)
        updateWorkElapsed(aiMsg)
        titleEl.textContent = ((window.i18n?.t?.('auto.js_ai_message_ui_724_3') ?? ((window.i18n?.t?.('auto.js_ai_message_ui_724_16') ?? '正在思考中'))))
        if (dotsEl) dotsEl.classList.add('thinking')
        break
      case 'done':
        updateWorkElapsed(aiMsg, true)
        break
      case 'interrupted':
        clearWorkTimer(aiMsg)
        titleEl.textContent = ((window.i18n?.t?.('auto.js_ai_message_ui_732_4') ?? ((window.i18n?.t?.('auto.js_ai_message_ui_732_17') ?? '已中断'))))
        if (dotsEl) dotsEl.classList.remove('thinking')
        break
      case 'error':
        clearWorkTimer(aiMsg)
        titleEl.textContent = ((window.i18n?.t?.('auto.js_ai_message_ui_737_5') ?? ((window.i18n?.t?.('auto.js_ai_message_ui_737_18') ?? '出错了'))))
        if (dotsEl) dotsEl.classList.remove('thinking')
        break
    }
  }

  function toggleThinkingBlock(headerRowEl) {
    if (!headerRowEl) return
    const blockEl = headerRowEl.closest('.ai-thinking-block')
    if (!blockEl) return

    const contentEl = blockEl.querySelector('.ai-thinking-content')
    const toggleEl = headerRowEl.querySelector('.ai-thinking-toggle')
    const isCollapsed = headerRowEl.classList.contains('collapsed')

    if (isCollapsed) {
      headerRowEl.classList.remove('collapsed')
      if (contentEl) contentEl.classList.remove('collapsed')
      if (toggleEl) toggleEl.textContent = '▾'
    } else {
      headerRowEl.classList.add('collapsed')
      if (contentEl) contentEl.classList.add('collapsed')
      if (toggleEl) toggleEl.textContent = '▸'
    }
  }

  function toggleAiStats(statsEl) {
    if (!statsEl) return
    statsEl.classList.toggle('expanded')
    const opsEl = statsEl.parentElement?.querySelector('.ai-operations')
    if (!opsEl) return

    if (statsEl.classList.contains('expanded')) {
      opsEl.classList.add('show')
    } else {
      opsEl.classList.remove('show')
    }
  }

  function toggleOpDetail(headerEl) {
    if (!headerEl) return
    const detailEl = headerEl.nextElementSibling
    if (!detailEl) return

    detailEl.classList.toggle('show')
    headerEl.classList.toggle('expanded')
  }

  // 剥离模型把"思考/推理"块当成正文返回的情况
  // 与后端 sanitizeFinalContent 保持一致；前端再过一道，防止历史消息或流式中间态把 <think> 内容渲染到正文
  function stripThinkingArtifacts(text) {
    if (!text) return text
    let result = String(text)
    const tagNames = ['think', 'thinking', 'reasoning', 'reflection', 'scratchpad', 'analysis', 'thought']
    for (const tag of tagNames) {
      const blockRe = new RegExp('<' + tag + '\\b[^>]*>[\\s\\S]*?<\\/' + tag + '>', 'gi')
      result = result.replace(blockRe, '')
      const closingRe = new RegExp('<\\/' + tag + '>', 'i')
      const openOnlyRe = new RegExp('<' + tag + '\\b[^>]*>[\\s\\S]*' + '$', 'i')
      if (!closingRe.test(result) && openOnlyRe.test(result)) {
        result = result.replace(openOnlyRe, '')
      }
      result = result.replace(new RegExp('<\\/?' + tag + '\\b[^>]*>', 'gi'), '')
    }
    // markdown 代码块包思考过程，如 ```thinking ... ```
    result = result.replace(/```(?:think|thinking|reasoning|reflection|analysis)\b[\s\S]*?```/gi, '')
    return result
  }

  function stripInternalMechanismArtifacts(text) {
    let result = String(text || '')
    if (!result) return result

    const leakPatterns = [
      /内部(?:软提醒|质量门禁|工作流指令|指令|机制|提醒)/,
      /系统(?:内部)?(?:提醒|指令)/,
      /系统提示(?:词|规则|注入|消息|内容)/,
      /最终回复(?:里)?禁止提到/,
      /最终质检未通过|统一工程工作流|工程证据账本/,
      /根据[^。\n]{0,80}(?:工作流|系统提醒|系统提示|代码地图|codemap|code\s*map)/i,
      /系统已用[^。\n]{0,80}代码地图/i,
      /代码地图(?:命中|候选|查询|路标|使用策略|规则)/i,
      /\b(?:query_code_map|internal_next_instruction|start_final_reply|show_thinking_note)\b/i,
      /\bmap[a-z0-9_-]{6,}\b/i
    ]
    const hasLeak = value => {
      const line = String(value || '')
      return !!line && leakPatterns.some(pattern => pattern.test(line))
    }

    result = result
      .replace(/【内部工作流指令】[\s\S]*?(?=\n{2,}|$)/g, ' ')
      .replace(/internal_next_instruction\s*:\s*[\s\S]*?(?=\n{2,}|$)/gi, ' ')

    result = result
      .split(/\r?\n/)
      .map(line => {
        if (!line.trim() || hasLeak(line)) return ''
        return line
          .split(/(?<=[。！？!?])\s*/)
          .filter(sentence => sentence && !hasLeak(sentence))
          .join(' ')
          .trimEnd()
      })
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim()

    return result
  }

  function escapeTableHtml(value = '') {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
  }

  function tableCellHtml(value = '') {
    return inlineFormat(escapeTableHtml(value))
  }

  function renderTableChart(table, chartModel) {
    const legend = chartModel.series.length > 1
      ? '<div class="ai-table-chart-legend">' + chartModel.series.map((series, index) =>
          '<span><i class="ai-table-series-' + (index + 1) + '"></i>' + tableCellHtml(series.label) + '</span>'
        ).join('') + '</div>'
      : ''
    const rows = chartModel.labels.map((label, rowIndex) => {
      const bars = chartModel.series.map((series, seriesIndex) => {
        const value = series.values[rowIndex]
        if (value === null) return ''
        const width = Math.max(2, Math.min(100, value / chartModel.max * 100))
        const original = table.rows[rowIndex]?.[series.column] ?? value
        return '<div class="ai-table-chart-bar-row">' +
          '<span class="ai-table-chart-series-label">' + (chartModel.series.length > 1 ? tableCellHtml(series.label) : '') + '</span>' +
          '<span class="ai-table-chart-track"><span class="ai-table-chart-bar ai-table-series-' + (seriesIndex + 1) + '" style="--ai-table-bar:' + width.toFixed(2) + '%"></span></span>' +
          '<span class="ai-table-chart-value">' + tableCellHtml(original) + '</span>' +
          '</div>'
      }).join('')
      return '<div class="ai-table-chart-row"><div class="ai-table-chart-label">' + tableCellHtml(label) + '</div>' + bars + '</div>'
    }).join('')
    const summary = '根据表格生成的数据图，共 ' + chartModel.labels.length + ' 个项目、' + chartModel.series.length + ' 个数值系列'
    return '<div class="ai-table-chart" role="img" aria-label="' + escapeTableHtml(summary) + '">' + legend + rows + '</div>'
  }

  function renderStructuredMarkdownTable(table = {}) {
    const header = Array.isArray(table.header) ? table.header : []
    const rows = Array.isArray(table.rows) ? table.rows : []
    const alignments = Array.isArray(table.alignments) ? table.alignments : []
    const chartModel = window.MarkdownTableParser?.getChartModel?.(table) || null
    const alignClass = index => alignments[index] ? ' is-' + alignments[index] : ''
    let html = '<div class="ai-structured-table" data-ai-table-root data-ai-table-mode="table">'
    if (chartModel) {
      html += '<div class="ai-table-view-switch" role="group" aria-label="表格显示方式">' +
        '<button type="button" class="ai-table-view-btn is-active" data-ai-table-view="table" aria-pressed="true">表格</button>' +
        '<button type="button" class="ai-table-view-btn" data-ai-table-view="chart" aria-pressed="false">图表</button>' +
        '</div>'
    }
    html += '<div class="ai-table-panel" data-ai-table-panel="table"><div class="ai-table-wrap"><table class="ai-table"><thead><tr>'
    header.forEach((cell, index) => { html += '<th class="' + alignClass(index).trim() + '">' + tableCellHtml(cell) + '</th>' })
    html += '</tr></thead><tbody>'
    rows.forEach(row => {
      html += '<tr>'
      header.forEach((_, index) => { html += '<td class="' + alignClass(index).trim() + '">' + tableCellHtml(row[index] || '') + '</td>' })
      html += '</tr>'
    })
    html += '</tbody></table></div></div>'
    if (chartModel) html += '<div class="ai-table-panel" data-ai-table-panel="chart" hidden>' + renderTableChart(table, chartModel) + '</div>'
    html += '</div>'
    return html
  }

  function sanitizeAiContent(content) {
    if (!content) return content

    // 兜底：剥离模型把思考/推理块当成正文返回的情况（后端 sanitizeFinalContent 已剥离过一道；这里防止历史消息和流式中间态泄漏）
    content = stripThinkingArtifacts(content)
    content = stripInternalMechanismArtifacts(content)

    // 对话内可视化指令：先抽出，避免被当普通文本拆碎
    const visualBlocks = []
    content = content.replace(/::lingxi-inline-vis\{([^}]*)\}/gi, (match, body) => {
      const idMatch = String(body || '').match(/id\s*=\s*["']?([a-zA-Z0-9._-]+)/i)
      if (!idMatch) return match
      const idx = visualBlocks.length
      visualBlocks.push(idMatch[1])
      return `\n\n\x00VIS${idx}\x00\n\n`
    })

    // Show style/script bodies as chat code snippets without running them.
    content = content.replace(/<style[^>]*>([\s\S]*?)<\/style>/gi, (match, cssContent) => {
      const escapedCss = cssContent.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      return `<div class="ai-code-wrapper has-lang"><div class="ai-code-header"><span class="ai-code-lang">css</span></div><pre class="ai-code-block"><code>${escapedCss}</code></pre></div>`
    })
    content = content.replace(/<script[^>]*>([\s\S]*?)<\/script>/gi, (match, jsContent) => {
      const escapedJs = jsContent.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      return `<div class="ai-code-wrapper has-lang"><div class="ai-code-header"><span class="ai-code-lang">js</span></div><pre class="ai-code-block"><code>${escapedJs}</code></pre></div>`
    })

    // 压缩连续空行
    content = content.replace(/\n{3,}/g, '\n\n')

    // 提取代码块（```...```），用占位符替换，避免被后续正则破坏
    const codeBlocks = []
    content = content.replace(/```(\w*)\n([\s\S]*?)```/g, (match, lang, code) => {
      const idx = codeBlocks.length
      const escapedCode = code.replace(/</g, '&lt;').replace(/>/g, '&gt;').trimEnd()
      const rawText = code.trimEnd()
      const copyBtnSvg = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>`
      if (lang) {
        codeBlocks.push(
          `<div class="ai-code-wrapper has-lang" data-code="${rawText.replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}">` +
          `<div class="ai-code-header"><span class="ai-code-lang">${lang}</span><button class="ai-code-copy-btn" title="复制代码">${copyBtnSvg}</button></div>` +
          `<pre class="ai-code-block"><code>${escapedCode}</code></pre></div>`
        )
      } else {
        codeBlocks.push(
          `<div class="ai-code-wrapper" data-code="${rawText.replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}">` +
          `<button class="ai-code-copy-btn" title="复制代码">${copyBtnSvg}</button>` +
          `<pre class="ai-code-block"><code>${escapedCode}</code></pre></div>`
        )
      }
      return `\n\x00CB${idx}\x00\n`
    })

    // 提取行内代码（`...`）
    const inlineCodes = []
    content = content.replace(/`([^`\n]+)`/g, (match, code) => {
      const escaped = String(code || '').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      if (!isThinkingInlineToken(code)) return escaped
      const idx = inlineCodes.length
      inlineCodes.push(`<code class="ai-inline-code">${escaped}</code>`)
      return `\x00IC${idx}\x00`
    })

    // 表格先做逐行结构化提取，不再依赖“表格前后必须有空行”的脆弱块级正则。
    const tableExtraction = window.MarkdownTableParser?.extractTables?.(content) || { content, tables: [] }
    content = tableExtraction.content
    const markdownTables = Array.isArray(tableExtraction.tables) ? tableExtraction.tables : []

    // 按双换行分割为块
    const blocks = content.split(/\n\n+/)
    const htmlParts = []

    for (let raw of blocks) {
      let block = raw.trim()
      if (!block) continue

      // 还原代码块占位符
      const cbMatch = block.match(/^\x00CB(\d+)\x00$/)
      if (cbMatch) {
        htmlParts.push(codeBlocks[parseInt(cbMatch[1])])
        continue
      }

      // 对话内可视化占位
      const visMatch = block.match(/^\x00VIS(\d+)\x00$/)
      if (visMatch) {
        const visId = visualBlocks[parseInt(visMatch[1], 10)] || ''
        const safeId = String(visId).replace(/"/g, '')
        htmlParts.push(
          `<div class="lingxi-inline-vis is-natural" data-vis-id="${safeId}" data-vis-state="pending" data-vis-collapsed="false">` +
          `<div class="lingxi-inline-vis-toolbar">` +
          `<button type="button" class="lingxi-inline-vis-toggle" data-vis-toggle="${safeId}" aria-expanded="true" title="折叠可视化">` +
          `<span class="lingxi-inline-vis-toggle-icon" aria-hidden="true">▾</span>` +
          `<span class="lingxi-inline-vis-kind-icon" aria-hidden="true">◇</span>` +
          `<span class="lingxi-inline-vis-toggle-label">可视化</span>` +
          `</button>` +
          `<span class="lingxi-inline-vis-title"></span>` +
          `<button type="button" class="lingxi-inline-vis-open" data-vis-open="${safeId}" title="新窗口打开"><span aria-hidden="true">↗</span> 新窗口</button>` +
          `</div>` +
          `<div class="lingxi-inline-vis-frame-wrap"><div class="lingxi-inline-vis-loading">加载中…</div></div>` +
          `</div>`
        )
        continue
      }

      // 结构化 Markdown 表格占位
      const tableMatch = block.match(/^\x00MTB(\d+)\x00$/)
      if (tableMatch) {
        const table = markdownTables[parseInt(tableMatch[1], 10)]
        if (table) htmlParts.push(renderStructuredMarkdownTable(table))
        continue
      }

      // 水平分隔线
      if (/^-{3,}$/.test(block)) {
        htmlParts.push('<hr class="ai-hr">')
        continue
      }

      // 表格（| 开头的连续行，含 |---| 分隔行）
      const tbLines = block.split('\n')
      if (tbLines.length >= 2 && tbLines.every(l => /\|/.test(l))) {
        const sepIdx = tbLines.findIndex(l => /^\|?[\s:-]+\|[\s|:-]+$/.test(l.trim()))
        if (sepIdx > 0) {
          const parseRow = (line) => line.replace(/^\||\|$/g, '').split('|').map(c => c.trim())
          const headerCells = parseRow(tbLines[0])
          const bodyRows = tbLines.slice(sepIdx + 1).map(parseRow)
          let tbl = '<div class="ai-table-wrap"><table class="ai-table"><thead><tr>'
          headerCells.forEach(c => { tbl += `<th>${inlineFormat(c)}</th>` })
          tbl += '</tr></thead><tbody>'
          bodyRows.forEach(row => {
            tbl += '<tr>'
            row.forEach(c => { tbl += `<td>${inlineFormat(c)}</td>` })
            tbl += '</tr>'
          })
          tbl += '</tbody></table></div>'
          htmlParts.push(tbl)
          continue
        }
      }

      // 标题
      const headingMatch = block.match(/^#{1,3}\s+(.+)$/)
      if (headingMatch && block.split('\n').length === 1) {
        htmlParts.push(`<div class="ai-heading">${inlineFormat(headingMatch[1])}</div>`)
        continue
      }

      const lines = block.split('\n')

      // 无序列表（- 或 · 开头）
      if (lines.length > 1 && lines.every(l => /^[-·]\s+/.test(l.trim()) || l.trim() === '')) {
        const items = lines.filter(l => l.trim()).map(l => `<li>${inlineFormat(l.trim().replace(/^[-·]\s+/, ''))}</li>`)
        htmlParts.push(`<ul class="ai-list">${items.join('')}</ul>`)
        continue
      }
      if (/^[-·]\s+/.test(block) && !block.includes('\n')) {
        htmlParts.push(`<ul class="ai-list"><li>${inlineFormat(block.replace(/^[-·]\s+/, ''))}</li></ul>`)
        continue
      }

      // 有序列表（1. 2. 3. 开头）
      if (lines.length > 1 && lines.every(l => /^\d+\.\s+/.test(l.trim()) || l.trim() === '')) {
        const items = lines.filter(l => l.trim()).map(l => `<li>${inlineFormat(l.trim().replace(/^\d+\.\s+/, ''))}</li>`)
        htmlParts.push(`<ol class="ai-list-ordered">${items.join('')}</ol>`)
        continue
      }
      if (/^\d+\.\s+/.test(block) && !block.includes('\n')) {
        htmlParts.push(`<ol class="ai-list-ordered"><li>${inlineFormat(block.replace(/^\d+\.\s+/, ''))}</li></ol>`)
        continue
      }

      // 引用块（> 开头）
      if (lines.every(l => /^>\s?/.test(l.trim()) || l.trim() === '')) {
        const quoteContent = lines.filter(l => l.trim()).map(l => inlineFormat(l.trim().replace(/^>\s?/, ''))).join('<br>')
        htmlParts.push(`<blockquote class="ai-blockquote">${quoteContent}</blockquote>`)
        continue
      }

      // 普通段落：内部单换行用 <br>
      const paragraphHtml = lines.map(l => inlineFormat(l)).join('<br>')
      htmlParts.push(`<p class="ai-para">${paragraphHtml}</p>`)
    }

    let result = htmlParts.join('')

    // 还原行内代码
    result = result.replace(/\x00IC(\d+)\x00/g, (m, idx) => inlineCodes[parseInt(idx)])

    return result
  }

  // 行内格式化：粗体 → 斜体 → 删除线 → 链接
  function inlineFormat(text) {
    return text
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/(?<!\*)\*([^*\s][^*]*?)\*(?!\*)/g, '<em>$1</em>')
      .replace(/~~([^~\s][^~]*?)~~/g, '<del>$1</del>')
      .replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
  }

  // 裸网址要先于文件路径处理。否则盘符正则会把 http:// 中的 p:/、
  // file:/// 中的 e:/ 当成 Windows 路径，最终渲染成“htt + p://”之类的碎片。
  function decorateUriReferences(html) {
    if (!html || typeof document === 'undefined') return html

    const root = document.createElement('div')
    root.innerHTML = html
    const skipTags = new Set(['PRE', 'CODE', 'A', 'BUTTON', 'TEXTAREA', 'INPUT', 'SCRIPT', 'STYLE'])
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        let current = node.parentElement
        if (!current || !node.nodeValue.trim()) return NodeFilter.FILTER_REJECT
        while (current && current !== root) {
          if (skipTags.has(current.tagName)) return NodeFilter.FILTER_REJECT
          current = current.parentElement
        }
        return NodeFilter.FILTER_ACCEPT
      }
    })
    const nodes = []
    while (walker.nextNode()) nodes.push(walker.currentNode)
    const uriPattern = /\b(?:https?:\/\/[^\s<>"']+|file:\/{2,3}[^\s<>"']*)/gi
    const trailingPunctuation = /[.,;:!?\uFF0C\u3002\uFF1B\uFF1A\uFF1F\uFF01\u3001)\uFF09\]\}]+$/u

    nodes.forEach(node => {
      const text = node.nodeValue
      let match
      let lastIndex = 0
      let found = false
      const fragment = document.createDocumentFragment()
      uriPattern.lastIndex = 0
      while ((match = uriPattern.exec(text)) !== null) {
        const rawValue = match[0]
        const punctuation = rawValue.match(trailingPunctuation)?.[0] || ''
        const value = punctuation ? rawValue.slice(0, -punctuation.length) : rawValue
        if (match.index > lastIndex) fragment.appendChild(document.createTextNode(text.slice(lastIndex, match.index)))
        if (/^https?:\/\//i.test(value)) {
          const anchor = document.createElement('a')
          anchor.className = 'ai-url-ref'
          anchor.href = value
          anchor.target = '_blank'
          anchor.rel = 'noopener'
          anchor.textContent = value
          anchor.setAttribute('onclick', 'event.preventDefault();event.stopPropagation();openInWebview(this.href)')
          fragment.appendChild(anchor)
        } else {
          const code = document.createElement('code')
          code.className = 'ai-inline-code ai-uri-ref'
          code.textContent = value
          fragment.appendChild(code)
        }
        if (punctuation) fragment.appendChild(document.createTextNode(punctuation))
        lastIndex = uriPattern.lastIndex
        found = true
      }
      if (!found) return
      if (lastIndex < text.length) fragment.appendChild(document.createTextNode(text.slice(lastIndex)))
      node.parentNode.replaceChild(fragment, node)
    })
    return root.innerHTML
  }

  function decorateFileReferences(html) {
    if (!html || typeof document === 'undefined') return html

    const root = document.createElement('div')
    root.innerHTML = html
    const skipTags = new Set(['PRE', 'CODE', 'A', 'BUTTON', 'TEXTAREA', 'INPUT', 'SCRIPT', 'STYLE'])
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const parent = node.parentElement
        if (!parent || !node.nodeValue.trim()) return NodeFilter.FILTER_REJECT
        if (parent.closest('.ai-file-ref, .op-file, .summary-file, .tool-card, .ai-artifact-card')) return NodeFilter.FILTER_REJECT
        let current = parent
        while (current && current !== root) {
          if (skipTags.has(current.tagName)) return NodeFilter.FILTER_REJECT
          current = current.parentElement
        }
        return NodeFilter.FILTER_ACCEPT
      }
    })

    const nodes = []
    while (walker.nextNode()) nodes.push(walker.currentNode)
    nodes.forEach(node => {
      const fragment = buildFileReferenceFragment(node.nodeValue)
      if (fragment) node.parentNode.replaceChild(fragment, node)
    })
    return root.innerHTML
  }

  const fileReferenceExtensions = 'js|jsx|ts|tsx|mjs|cjs|vue|svelte|css|scss|sass|less|html|htm|json|jsonc|md|markdown|py|java|c|h|cpp|hpp|cs|go|rs|php|rb|swift|kt|kts|sh|bash|zsh|ps1|bat|cmd|yml|yaml|toml|ini|env|txt|log|csv|xml|svg|png|jpe?g|webp|gif|bmp|ico|avif|pdf|docx?|xlsx?|pptx?|glb|gltf|blend'
  const fileReferenceLineSuffix = new RegExp(`(\\.(?:${fileReferenceExtensions}))(?:[:：]\\d+(?:[:：]\\d+)?)$`, 'i')
  const fileReferenceWithOptionalLine = new RegExp(`^([\\s\\S]*?\\.(?:${fileReferenceExtensions})(?:[:：]\\d+(?:[:：]\\d+)?)?)(?=$|[\\s,.;:!?，。；：！？、)）\\]\\}])`, 'i')

  function trimFileReferenceValue(rawValue) {
    let value = String(rawValue || '').trim()
    const fileMatch = value.match(fileReferenceWithOptionalLine)
    if (fileMatch) value = fileMatch[1]
    return value.replace(/[.,;:!?\uFF0C\u3002\uFF1B\uFF1A\uFF1F\uFF01\u3001)\uFF09\]\}]+$/u, '')
  }

  function getOpenableFileReferencePath(value) {
    return String(value || '').replace(fileReferenceLineSuffix, '$1')
  }

  function buildFileReferenceFragment(text) {
    const pattern = new RegExp(`(?<![A-Za-z0-9+.-])([A-Za-z]:[\\\\/][^\\r\\n<>"'\`]+)|(?<![\\w.-])(?:[\\w.-]+[\\\\/]+)+[\\w.-]+(?:\\.(?:${fileReferenceExtensions})\\b)?|\\b[\\w.-]+\\.(?:${fileReferenceExtensions})\\b`, 'gi')
    const trailingPunctuation = /[.,;:!?\uFF0C\u3002\uFF1B\uFF1A\uFF1F\uFF01\u3001)\uFF09\]\}]+$/u
    let match
    let lastIndex = 0
    let found = false
    const fragment = document.createDocumentFragment()

    while ((match = pattern.exec(text)) !== null) {
      const rawValue = match[0]
      const punctuationMatch = rawValue.match(trailingPunctuation)
      const trailing = punctuationMatch ? punctuationMatch[0] : ''
      const value = trimFileReferenceValue(trailing ? rawValue.slice(0, -trailing.length) : rawValue)
      if (!value) continue
      if (match.index > lastIndex) {
        fragment.appendChild(document.createTextNode(text.slice(lastIndex, match.index)))
      }
      fragment.appendChild(createFileReferenceElement(value))
      const consumedLength = value.length + trailing.length
      const rest = rawValue.slice(consumedLength)
      if (rest) fragment.appendChild(document.createTextNode(rest))
      else if (trailing) fragment.appendChild(document.createTextNode(trailing))
      lastIndex = pattern.lastIndex
      found = true
    }

    if (!found) return null
    if (lastIndex < text.length) fragment.appendChild(document.createTextNode(text.slice(lastIndex)))
    return fragment
  }

  function createFileReferenceElement(value) {
    const span = document.createElement('span')
    const openablePath = getOpenableFileReferencePath(value)
    const isFullPath = /^[A-Za-z]:[\\/]/.test(openablePath) || /^\\\\/.test(openablePath)
    const isRelativePath = /[\\/]/.test(value) && !/^(?:https?:|file:)/i.test(value)
    span.className = `ai-file-ref${isFullPath || isRelativePath ? ' ai-file-ref-path' : ''}`
    span.textContent = value
    span.title = isFullPath || isRelativePath ? value : `File: ${value}`
    if (isFullPath || isRelativePath) {
      span.setAttribute('data-path', encodeURIComponent(openablePath))
      if (isFullPath) span.setAttribute('data-open-mode', 'system')
      span.setAttribute('onclick', 'event.stopPropagation();openFilePreviewFromData(this)')
    }
    return span
  }

  function shouldFoldLongReview(content) {
    const text = String(content || '')
    if (text.length < 1600) return false

    const reviewSignals = [
      ((window.i18n?.t?.('auto.js_ai_message_ui_884_19') ?? '高危问题')),
      ((window.i18n?.t?.('auto.js_ai_message_ui_885_20') ?? '中等问题')),
      ((window.i18n?.t?.('auto.js_ai_message_ui_886_21') ?? '轻微问题')),
      ((window.i18n?.t?.('auto.js_ai_message_ui_887_22') ?? '低风险')),
      ((window.i18n?.t?.('auto.js_ai_message_ui_888_23') ?? '问题汇总')),
      ((window.i18n?.t?.('auto.js_ai_message_ui_889_24') ?? '修复优先级')),
      ((window.i18n?.t?.('auto.js_ai_message_ui_890_25') ?? '必须立即修复')),
      ((window.i18n?.t?.('auto.js_ai_message_ui_891_26') ?? '安全漏洞')),
      ((window.i18n?.t?.('auto.js_ai_message_ui_892_27') ?? '风险')),
      ((window.i18n?.t?.('auto.js_ai_message_ui_893_28') ?? '| 文件 |')),
      ((window.i18n?.t?.('auto.js_ai_message_ui_894_29') ?? '| 严重程度 |'))
    ]
    const signalCount = reviewSignals.filter(signal => text.includes(signal)).length
    const tableRows = (text.match(/\n\|/g) || []).length
    const headings = (text.match(/^#{2,4}\s+/gm) || []).length

    return signalCount >= 2 || tableRows >= 5 || headings >= 4
  }

  function findFoldPoint(content) {
    const markers = [
      '\n---\n',
      ((window.i18n?.t?.('auto.js_ai_message_ui_906_30') ?? '\\n## 中等问题')),
      ((window.i18n?.t?.('auto.js_ai_message_ui_907_31') ?? '\\n## 中危')),
      ((window.i18n?.t?.('auto.js_ai_message_ui_908_32') ?? '\\n## 建议优先修复')),
      ((window.i18n?.t?.('auto.js_ai_message_ui_909_33') ?? '\\n## 低风险')),
      ((window.i18n?.t?.('auto.js_ai_message_ui_910_34') ?? '\\n## 轻微问题')),
      ((window.i18n?.t?.('auto.js_ai_message_ui_911_35') ?? '\\n## 问题汇总')),
      ((window.i18n?.t?.('auto.js_ai_message_ui_912_36') ?? '\\n## 修复优先级'))
    ]

    const candidates = markers
      .map(marker => content.indexOf(marker))
      .filter(index => index >= 500)
      .sort((a, b) => a - b)

    if (candidates.length > 0) return candidates[0]

    const paragraphs = content.split(/\n{2,}/)
    let size = 0
    for (let i = 0; i < paragraphs.length; i++) {
      size += paragraphs[i].length + 2
      if (size >= 900) return size
    }
    return 900
  }

  function renderAiContent(content, options = {}) {
    const text = String(content || '')
    const summaryHtml = options.summaryHtml || ''
    const html = decorateFileReferences(decorateUriReferences(sanitizeAiContent(text))) + summaryHtml
    // 异步灌入可视化 iframe（不阻塞 HTML 字符串返回）
    try {
      if (typeof queueMicrotask === 'function') {
        queueMicrotask(() => window.InlineVisualizeUI?.hydrateAll?.())
      } else {
        setTimeout(() => window.InlineVisualizeUI?.hydrateAll?.(), 0)
      }
    } catch (_) { /* ignore */ }
    return html
  }

  function renderArtifactCard(artifact) {
    return ''
  }
  function toggleToolCard(headerEl) {
    if (!headerEl) return
    const card = headerEl.closest('.tool-call-card')
    if (!card) return

    const detailEl = card.querySelector('.tool-card-detail')
    if (!detailEl) return

    const isCollapsed = detailEl.classList.contains('collapsed')
    const lazy = window.ToolDetailLazy

    if (isCollapsed) {
      // 兼容旧卡片的懒加载缓存；新卡片的正文始终保留在 DOM。
      const hydrated = lazy?.hydrate?.(detailEl, {
        onHydrated: (el) => {
          if (typeof window.hydrateLazyImagePreviews === 'function') {
            window.hydrateLazyImagePreviews(el.parentElement || card)
          }
        }
      })
      if (hydrated === false && !detailEl.childNodes.length) return
      detailEl.classList.remove('collapsed')
      // 不在解除 content-visibility 的同一帧读取 scrollHeight：此时 Chromium
      // 可能仍返回 0，随后会把有内容的详情锁成 1px，看起来像空白。
      detailEl.style.removeProperty('max-height')
      requestAnimationFrame(() => {
        card.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
      })
    } else {
      // 保留详情 DOM，折叠高度统一交给 collapsed 样式。
      if (lazy?.collapseAndRelease) lazy.collapseAndRelease(detailEl)
      else detailEl.classList.add('collapsed')
    }
  }

  function toggleToolGroup(headerEl) {
    if (!headerEl) return
    const group = headerEl.closest('.tool-call-group')
    if (!group) return

    const listEl = group.querySelector('.tool-group-list')
    if (!listEl) return

    const isCollapsed = listEl.classList.contains('collapsed')

    if (group.classList.contains('tool-media-group')) {
      // 媒体舞台不能复用 scrollHeight/max-height 动画，否则图片异步加载时会再次
      // 产生大块空白。这里使用媒体专用的即时折叠，同时保留完整媒体 DOM。
      const willCollapse = !isCollapsed
      listEl.classList.toggle('collapsed', willCollapse)
      group.classList.toggle('media-collapsed', willCollapse)
      group.dataset.mediaCollapsed = willCollapse ? 'true' : 'false'
      headerEl.setAttribute('aria-expanded', willCollapse ? 'false' : 'true')
      if (!willCollapse) {
        requestAnimationFrame(() => {
          if (typeof window.hydrateLazyImagePreviews === 'function') {
            window.hydrateLazyImagePreviews(listEl)
          }
          listEl.querySelector('.tool-media-stage, .tool-media-result-image, .tool-media-result-video')
            ?.scrollIntoView?.({ behavior: 'smooth', block: 'nearest' })
        })
      }
      return
    }

    if (isCollapsed) {
      listEl.classList.remove('collapsed')
      headerEl.setAttribute('aria-expanded', 'true')
      // A previous collapse leaves max-height:0 inline. Clear it before
      // measuring in the next frame so Chromium cannot lock a populated list
      // to 0px while visibility is changing.
      listEl.style.removeProperty('max-height')
      requestAnimationFrame(() => {
        if (listEl.classList.contains('collapsed')) return
        const targetHeight = Math.min(listEl.scrollHeight, 5000)
        if (targetHeight <= 0) {
          listEl.style.removeProperty('max-height')
          return
        }
        listEl.style.maxHeight = targetHeight + 'px'
        listEl.addEventListener('transitionend', function handler(event) {
          if (event.propertyName !== 'max-height') return
          listEl.style.removeProperty('max-height')
          listEl.removeEventListener('transitionend', handler)
        })
      })
    } else {
      headerEl.setAttribute('aria-expanded', 'false')
      listEl.style.maxHeight = listEl.scrollHeight + 'px'
      requestAnimationFrame(() => {
        listEl.classList.add('collapsed')
        listEl.style.removeProperty('max-height')
      })
    }
  }

  function toggleFoldedReport(buttonEl) {
    if (!buttonEl) return
    const contentEl = buttonEl.nextElementSibling
    const arrowEl = buttonEl.querySelector('.ai-folded-report-arrow')
    if (!contentEl) return

    const collapsed = contentEl.classList.toggle('collapsed')
    buttonEl.classList.toggle('expanded', !collapsed)
    if (arrowEl) arrowEl.textContent = collapsed ? '▸' : '▾'
  }

  function bind(options = {}) {
    const getCurrentAiMsg = options.getCurrentAiMsg || function () { return null }
    const onStatusFrame = typeof options.onStatusFrame === 'function' ? options.onStatusFrame : function () {}

    return {
      toggleDynamicArea,
      collapseDynamicArea: () => collapseDynamicArea(getCurrentAiMsg()),
      updateWorkStatus: status => updateWorkStatus(getCurrentAiMsg(), status),
      toggleThinkingBlock,
      toggleAiStats,
      toggleOpDetail,
      sanitizeAiContent,
      renderAiContent,
      toggleToolCard,
      toggleToolGroup,
      toggleFoldedReport,
      opIcons,
      opTypes,
      getToolType,
      getToolSummary,
      calculateEditLines,
      getFileName,
      createAiMessage,
      createNewThinkingBlock,
      updateDeepReasoningBlock,
      finishDeepReasoningBlock,
      collapseAllDeepReasoningBlocks,
      toggleDeepReasoningBlock,
      toggleDeepReasoningExpand,
      startBlockTimer,
      startWorkTimer,
      clearWorkTimer,
      updateWorkElapsed,
      updateThinkingProgress: (blockEl, statusText, progressOptions = {}) => updateThinkingProgress(blockEl, statusText, {
        ...progressOptions,
        onStatusFrame
      }),
      summarizeThinkingStatus,
      shouldDisplayThinkingStatus,
      clipAtSentence,
      finishThinkingBlock,
      clearTransientThinkingPlaceholders: () => clearTransientThinkingPlaceholders(getCurrentAiMsg()),
      ensureTypewriterStyle,
      startTypewriterEffect,
      finishTypewriterEffect,
      setWorkDuration
    }
  }

  // 表格/图表视图：事件委托（全局绑定一次）
  ;(function initStructuredTableViewSwitch() {
    document.addEventListener('click', event => {
      const button = event.target.closest?.('[data-ai-table-view]')
      if (!button) return
      const root = button.closest('[data-ai-table-root]')
      const mode = button.getAttribute('data-ai-table-view') === 'chart' ? 'chart' : 'table'
      if (!root) return
      root.dataset.aiTableMode = mode
      root.querySelectorAll('[data-ai-table-view]').forEach(item => {
        const active = item.getAttribute('data-ai-table-view') === mode
        item.classList.toggle('is-active', active)
        item.setAttribute('aria-pressed', active ? 'true' : 'false')
      })
      root.querySelectorAll('[data-ai-table-panel]').forEach(panel => {
        panel.hidden = panel.getAttribute('data-ai-table-panel') !== mode
      })
    })
  })()

  // 代码块复制按钮：事件委托（全局绑定一次）
  ;(function initCodeCopyButtons() {
    document.addEventListener('click', (e) => {
      const btn = e.target.closest('.ai-code-copy-btn')
      if (!btn) return
      const wrapper = btn.closest('.ai-code-wrapper')
      if (!wrapper) return
      const code = wrapper.dataset.code || ''
      if (!code) return
      navigator.clipboard.writeText(code).then(() => {
        btn.classList.add('copied')
        btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>'
        setTimeout(() => {
          btn.classList.remove('copied')
          btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>'
        }, 1500)
      })
    })
  })()

  window.AiMessageUI = {
    bind,
    opIcons,
    opTypes,
    getToolType,
    getToolSummary,
    calculateEditLines,
    getFileName,
    createAiMessage,
    createNewThinkingBlock,
    updateDeepReasoningBlock,
    finishDeepReasoningBlock,
    collapseAllDeepReasoningBlocks,
    toggleDeepReasoningBlock,
    toggleDeepReasoningExpand,
    startBlockTimer,
    startWorkTimer,
    clearWorkTimer,
    updateWorkElapsed,
    updateThinkingProgress,
    summarizeThinkingStatus,
    shouldDisplayThinkingStatus,
    clipAtSentence,
    finishThinkingBlock,
    clearTransientThinkingPlaceholders,
    ensureTypewriterStyle,
    startTypewriterEffect,
    finishTypewriterEffect,
    toggleDynamicArea,
    collapseDynamicArea,
    updateWorkStatus,
    setWorkDuration,
    toggleThinkingBlock,
    toggleAiStats,
    toggleOpDetail,
    sanitizeAiContent,
    renderAiContent,
    toggleToolCard,
    toggleToolGroup,
    toggleFoldedReport
  }
})()
