const path = require('path')
const fs = require('fs')
const vm = require('vm')

module.exports = {
  id: 'thinking-progress.filter-restatement',
  title: 'Thinking progress filters user request restatements but keeps real progress',
  tags: ['thinking-progress', 'ai-ui'],
  changedFilePatterns: [
    /^electron\/modules\/ai-chat\.js$/i,
    /^electron\/modules\/chat\/modification-reroute\.js$/i,
    /^electron\/modules\/progress-narration\.js$/i,
    /^electron\/modules\/agent-runtime\.js$/i,
    /^frontend\/scripts\/features\/thinking-display\.js$/i,
    /^frontend\/scripts\/app\.js$/i,
    /^frontend\/scripts\/features\/ai-message-ui\.js$/i,
    /^frontend\/scripts\/features\/ai-tool-renderer\.js$/i,
    /^frontend\/scripts\/features\/chat-renderer\.js$/i
  ],

  async run(ctx) {
    const aiChat = require(path.join(ctx.root, 'electron/modules/ai-chat'))
    const helpers = aiChat.__test || {}

    ctx.assert.equal(
      helpers.normalizeProgressNarration('用户想了解这个项目的用户系统是怎么实现的'),
      '',
      'user-request restatement should not be rendered as progress narration'
    )
    ctx.assert.equal(
      helpers.normalizeProgressNarration('用户问的是“他的用户系统是怎么运行的”'),
      '',
      'quoted user-question restatement should not be rendered as progress narration'
    )
    ctx.assert.equal(
      helpers.normalizeProgressStatus('用户要求的是查看用户系统'),
      '',
      'user requirement restatement should not be rendered as status'
    )
    ctx.assert.equal(
      helpers.normalizeProgressNarration('的，现在我了解了项目的技能结构。'),
      '',
      'truncated understanding fragments should not be rendered as progress narration'
    )
    ctx.assert.equal(
      helpers.normalizeProgressNarration('我已经了解了这个项目的基本情况。'),
      '',
      'self-understanding summaries should not be rendered as progress narration'
    )
    ctx.assert.equal(
      helpers.normalizeProgressNarration('换一个思路：告诉用户如何手动添加工具 case 语句。'),
      '',
      'manual-offload thinking should not be rendered as progress narration'
    )

    const realProgress = helpers.normalizeProgressNarration('正在检查登录接口和用户数据存储逻辑。')
    ctx.assert.ok(realProgress.includes('检查登录接口'), 'real execution progress should still be shown')

    const publicFinding = helpers.normalizeProgressNarration('关键点找到了：isProjectAiRunActive 把旧的 savedAiMsg 当成还在运行，所以切换回来会复活思考块。')
    ctx.assert.ok(publicFinding.includes('关键点找到了') && publicFinding.includes('复活思考块'), 'public intelligent progress narration should be preserved')

    const publicDirection = helpers.normalizeProgressNarration('定位方向基本清楚：不是渲染气泡本身的问题，而是运行态生命周期边界没有收紧。')
    ctx.assert.ok(publicDirection.includes('定位方向基本清楚') && publicDirection.includes('生命周期'), 'diagnostic public narration should be preserved')

    const toolCall = (name, args = {}) => ({
      id: `${name}-${Math.random().toString(16).slice(2)}`,
      type: 'function',
      function: { name, arguments: JSON.stringify(args) }
    })
    const tenRealTools = Array.from({ length: 10 }, (_, index) => toolCall('read_file', { path: `src/file-${index}.js` }))
    const elevenRealTools = Array.from({ length: 11 }, (_, index) => toolCall('read_file', { path: `src/file-${index}.js` }))
    ctx.assert.equal(
      helpers.shouldSplitLargeToolBatch([...tenRealTools, toolCall('report_progress', { status: 'checking files' }), toolCall('start_final_reply')]),
      false,
      '10 real tools plus internal progress/final controls should stay in one thinking section'
    )
    ctx.assert.equal(
      helpers.shouldSplitLargeToolBatch(elevenRealTools),
      false,
      'more than 10 real tools should not be blocked by a fixed thinking-section cap'
    )
    ctx.assert.equal(
      helpers.shouldSplitToolSectionBatch([toolCall('check_project_syntax')], 10),
      false,
      'a real tool should not be blocked by an accumulated fixed section cap'
    )
    ctx.assert.equal(
      helpers.shouldSplitToolSectionBatch([toolCall('report_progress', { status: 'next section' })], 10),
      false,
      'internal progress controls should not count as real tools for section splitting'
    )
    ctx.assert.equal(
      helpers.shouldRerouteToolStatusMismatch([toolCall('read_file', { path: 'frontend/a.js' })], 'checking frontend/a.js'),
      false,
      'status and tool target that overlap should not be rerouted'
    )
    ctx.assert.equal(
      helpers.shouldRerouteToolStatusMismatch([toolCall('read_file', { path: 'frontend/b.js' })], 'checking frontend/a.js'),
      true,
      'status that names one file but tools target another should be rerouted once'
    )
    ctx.assert.equal(
      helpers.shouldRerouteToolStatusMismatch([toolCall('read_file', { path: 'frontend/b.js' })], 'checking the related implementation'),
      false,
      'generic status text should not block otherwise valid tools'
    )
    ctx.assert.equal(
      helpers.shouldRerouteToolStatusMismatch([toolCall('read_file', { path: 'frontend/b.js' })], 'preparing final reply'),
      true,
      'final-reply-like status followed by real tools should be corrected'
    )

    const softenedProgress = helpers.normalizeProgressNarration('社区审核机制——前面已经回答了举报机制（用户上传/审核由用户发起），但还要确认评论举报入口→审核状态。')
    ctx.assert.ok(!/[()（）]|——|→/.test(softenedProgress), 'public progress punctuation should be softened for readable thinking blocks')
    ctx.assert.ok(softenedProgress.includes('社区审核机制') && softenedProgress.includes('举报机制'), 'softened public progress should keep useful content')

    ctx.assert.equal(
      helpers.normalizeProgressNarration('遵守情况：- 我没写文件 ✓ - 我没创建临时脚本 ✓ - 我用 grep 全项目乱翻，只针对点赞相关目录。'),
      '',
      'checklist compliance fragments should not be rendered as public thinking progress'
    )

    ctx.assert.equal(
      helpers.normalizeProgressNarration('根据代码地图和系统提醒，我需要按照 internal_next_instruction 继续执行。'),
      '',
      'internal workflow/codemap narration should not be rendered'
    )

    ctx.assert.equal(
      helpers.normalizeProgressStatus('读 app.js 196-205 行确认调用方式，同时读 context-ui.js 找实际导出的方法名。'),
      '',
      'tool-log style progress should not be rendered as a thinking block'
    )
    ctx.assert.equal(
      helpers.normalizeProgressStatus('执行命令 - grep -n "ContextUI|updateIndicator" frontend/scripts/app.js'),
      '',
      'command-log style progress should not be rendered as a thinking block'
    )
    ctx.assert.equal(
      helpers.normalizeProgressStatus('find_in_file 多次 0 命中，直接整文件读 context-ui.js。'),
      '',
      'failed-search log lines should not be rendered as public thinking'
    )
    ctx.assert.equal(
      helpers.normalizeProgressStatus('之前整文件读 context-ui.js 显示 0 行有异常，改为按行号精确读取关键段：33、56、107、115-119、134 行。'),
      '',
      'line-number evidence details should not be rendered as public thinking'
    )
    ctx.assert.equal(
      helpers.normalizeProgressStatus('app.js:200 调用签名是 contextUI.updateIndicator(elements, ratio, tokens)。'),
      '',
      'call signatures should not be rendered as public thinking'
    )
    ctx.assert.equal(
      helpers.normalizeProgressStatus('文件内查找 - const\\s+contextUI|updateIndicator|ContextUI，用正则继续定位。'),
      '',
      'regex search details should not be rendered as public thinking'
    )
    ctx.assert.equal(
      helpers.normalizeProgressStatus('已确认根因：context-ui.js window.ContextUI 只暴露 4 个方法，没有 updateIndicator。'),
      '',
      'method-list evidence details should not be rendered as public thinking'
    )
    ctx.assert.ok(
      helpers.normalizeProgressStatus('我先核对调用方和导出方是否一致，再确认状态更新链路的根因。').includes('调用方'),
      'natural Codex-like progress should still be accepted'
    )
    ctx.assert.ok(
      helpers.normalizeProgressStatus('根因方向已经清楚，我会先修正调用关系，再做语法和运行验证。').includes('根因方向'),
      'concise public progress should still be accepted'
    )
    const longProgressStatus = '我先把运行中项目切换后的状态缓存、工具回放和最终正文衔接链路一起核对，确认到底是记录被吞掉、重复 replay，还是 UI 只显示了最后一条工具结果导致用户误以为没有过程。'
    ctx.assert.equal(
      helpers.normalizeProgressStatus(longProgressStatus),
      longProgressStatus,
      'backend public progress should normalize status text without a fixed length cap'
    )

    const aiChatSource = fs.readFileSync(path.join(ctx.root, 'electron/modules/ai-chat.js'), 'utf8')
    ctx.assert.ok(
      !aiChatSource.includes('sendReasoningThinkingChunk(delta.reasoning_content)') &&
      !aiChatSource.includes('sendReasoningThinkingChunk(cdelta.reasoning_content)'),
      'provider reasoning_content should not be streamed directly as frontend thinking entries'
    )
    const schemaIndexSource = fs.readFileSync(path.join(ctx.root, 'electron/modules/schemas/index.js'), 'utf8')
    const searchVerifySchemaSource = fs.readFileSync(path.join(ctx.root, 'electron/modules/schemas/search-verify.js'), 'utf8')
    const systemPromptSource = fs.readFileSync(path.join(ctx.root, 'electron/modules/system-prompt-builder.js'), 'utf8')
    ctx.assert.ok(
      systemPromptSource.includes('用户可见思考块通过 show_thinking_note 工具显示') &&
      systemPromptSource.includes('不要再用普通正文输出 [[状态: ...]]') &&
      schemaIndexSource.includes('"report_progress"') &&
      !schemaIndexSource.includes('"show_thinking_note"'),
      'backend prompt should make show_thinking_note the public thinking source while report_progress stays disabled for model-facing tools'
    )
    ctx.assert.ok(
      systemPromptSource.includes('仍然可以继续调用真实工具') &&
      (
        systemPromptSource.includes('不要为了补状态句而重复、撤销或重发同一批工具') ||
        systemPromptSource.includes('不要为了补过程说明而重复、撤销或重发同一批工具')
      ) &&
      systemPromptSource.includes('第一次真实工具调用前应先调用 show_thinking_note') &&
      systemPromptSource.includes('阶段变化时必须调用 show_thinking_note'),
      'prompt should require show_thinking_note without blocking real tool execution behind it'
    )
    ctx.assert.ok(
      searchVerifySchemaSource.includes('"name": "dev_workflow"') &&
      (
        systemPromptSource.includes('dev_workflow mode=') ||
        systemPromptSource.includes('dev_workflow')
      ) &&
      (
        systemPromptSource.includes('code_verify') ||
        systemPromptSource.includes('check_project_syntax') ||
        systemPromptSource.includes('dev_workflow mode=syntax') ||
        systemPromptSource.includes('dev_workflow mode=locate') ||
        systemPromptSource.includes('dev_workflow mode=health')
      ),
      'main chat should expose an integrated development workflow tool before falling back to scattered low-level tools'
    )
    const progressNarrationSource = fs.readFileSync(path.join(ctx.root, 'electron/modules/progress-narration.js'), 'utf8')
    const thinkingDisplaySource = fs.readFileSync(path.join(ctx.root, 'frontend/scripts/features/thinking-display.js'), 'utf8')
    ctx.assert.ok(
      progressNarrationSource.includes('function isToolLogLikeProgress') &&
      progressNarrationSource.includes('normalizeProgressStatus') &&
      thinkingDisplaySource.includes('hasInternalThinkingLeak'),
      'model-facing and rendering progress filters should reject tool-log/internal thinking content'
    )
    ctx.assert.ok(
      aiChatSource.includes('fullReasoningContent += delta.reasoning_content') &&
      aiChatSource.includes('fullReasoningContent += cdelta.reasoning_content') &&
      !aiChatSource.includes('emitVisibleReasoningThinking') &&
      !aiChatSource.includes('buildMissingProgressStatusInstruction') &&
      !aiChatSource.includes('pendingProgressStatusForNextToolBatch') &&
      !aiChatSource.includes('hasRealToolCallsInBatch && !progressStatusBeforeTools') &&
      !aiChatSource.includes('tool_progress_status_retry_escalated') &&
      !aiChatSource.includes('??????????????????????????????????????????'),
      'model-authored status text should drive thinking blocks without blocking real tool execution behind a progress gate'
    )
    ctx.assert.ok(
      aiChatSource.includes('const allowContentAsProgressNarration = false'),
      'content-as-progress fallback should stay disabled'
    )
    const toolArgumentTrackerSource = progressNarrationSource.slice(
      progressNarrationSource.indexOf('function createToolArgumentProgressTracker'),
      progressNarrationSource.indexOf('function createProgressNarrationTracker')
    )
    const narrationTrackerSource = progressNarrationSource.slice(
      progressNarrationSource.indexOf('function createProgressNarrationTracker'),
      progressNarrationSource.indexOf('function isProcessOnlyContinuationText')
    )
    ctx.assert.ok(
      progressNarrationSource.includes('createToolArgumentProgressTracker') &&
      !toolArgumentTrackerSource.includes('isProgressNarration: true'),
      'tool argument streaming should not generate thinking blocks'
    )
    ctx.assert.ok(
      progressNarrationSource.includes('createProgressStatusParser') &&
      !narrationTrackerSource.includes("webContents?.send('ai-thinking'"),
      'progress narration tracker should no longer guess thinking blocks from ordinary content'
    )
    ctx.assert.ok(
      aiChatSource.includes('fullReasoningContent += delta.reasoning_content') &&
      aiChatSource.includes('fullReasoningContent += cdelta.reasoning_content'),
      'reasoning should be preserved for model continuity/history without being used as live public thinking'
    )

    const thinkingSource = fs.readFileSync(path.join(ctx.root, 'frontend/scripts/features/thinking-display.js'), 'utf8')
    const thinkingSandbox = {
      window: {},
      HtmlUtils: {
        escapeHtml(value) {
          return String(value ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
        }
      }
    }
    vm.runInNewContext(thinkingSource, thinkingSandbox)
    const thinkingDisplay = thinkingSandbox.window.ThinkingDisplay
    ctx.assert.ok(thinkingDisplay && typeof thinkingDisplay.summarizeThinkingStatus === 'function', 'thinking display should expose one shared frontend normalization module')
    ctx.assert.equal(thinkingDisplay.PUBLIC_THINKING_MAX_LENGTH, Number.POSITIVE_INFINITY, 'public thinking block length should not have a fixed visible-character cap')
    const longThinking = '我会继续检查这个问题的触发链路，先确认前端事件入口和状态更新路径，再核对后端工具返回与消息渲染之间的同步关系，避免只看单个文件就误判根因。'.repeat(3)
    const compactLongThinking = thinkingDisplay.compactThinkingStatus(longThinking)
    ctx.assert.equal(
      thinkingDisplay.getVisibleThinkingLength(compactLongThinking),
      thinkingDisplay.getVisibleThinkingLength(longThinking),
      'long public thinking text should be normalized without fixed-length truncation'
    )
    ctx.assert.ok(
      thinkingDisplay.summarizeThinkingStatus('我看到官方价格页是 JS 页面，正文抓取只有搜索摘要能读到一部分；我再直接抓页面资源。').includes('我看到官方价格页'),
      'Codex-like first-person progress should be preserved instead of rewritten into a template'
    )
    ctx.assert.ok(
      thinkingDisplay.summarizeThinkingStatus('我会把金额估算抽成独立模块，这样后续补模型价格更稳。').startsWith('我会'),
      'natural first-person work narration should not be rewritten'
    )
    ctx.assert.equal(
      thinkingDisplay.summarizeThinkingStatus('根据代码地图和系统提醒，我需要按照 internal_next_instruction 继续执行。'),
      '',
      'shared frontend thinking display should filter internal mechanism leaks'
    )
    ctx.assert.ok(
      thinkingDisplay.renderThinkingStatusHtml('我会检查 `model-cost-estimator.js` 的金额估算。').includes('ai-thinking-inline-code'),
      'shared frontend thinking display should render code-like tokens consistently'
    )
    const codeAwareThinking = thinkingDisplay.cleanVisibleThinkingPhrase('我会核对 frontend/scripts/app.js 里的 recordToolResult 调用。')
    ctx.assert.ok(
      codeAwareThinking.includes('frontend/scripts/app.js') && codeAwareThinking.includes('recordToolResult'),
      'public thinking should preserve useful file and symbol names instead of replacing them with vague placeholders'
    )
    const codeAwareHtml = thinkingDisplay.renderThinkingStatusHtml(codeAwareThinking)
    ctx.assert.ok(
      (codeAwareHtml.match(/ai-thinking-inline-code/g) || []).length >= 2,
      'public thinking should render preserved file and symbol names as Codex-like inline code chips'
    )

    const source = fs.readFileSync(path.join(ctx.root, 'frontend/scripts/features/ai-message-ui.js'), 'utf8')
    ctx.assert.ok(source.includes('const ThinkingDisplay = window.ThinkingDisplay || {}'), 'live thinking UI should use the shared ThinkingDisplay module')
    ctx.assert.ok(source.includes('options.isReasoningSummary') && !source.includes('reasoningFullSummary') && !source.includes('getReasoningAppendText'), 'live thinking UI should append backend reasoning entries instead of diffing cumulative snapshots')
    ctx.assert.ok(!source.includes('现在开始') && !source.includes('现在需要'), 'live thinking UI should not keep old mechanical first-person rewrites')
    ctx.assert.ok(source.includes("text_edit: 'edit'") && source.includes("get_latest_change_session: 'read'"), 'frontend tool type map should productize precise edit and change-session tools')
    ctx.assert.ok(source.includes('renderNextFrame()'), 'typewriter should render the first final-reply frame synchronously')
    ctx.assert.ok(source.includes('if (!content)') && source.includes("targetEl.innerHTML = ''"), 'empty final replies should not leave a blinking typewriter cursor')
    ctx.assert.ok(source.includes('delete aiMsg.dataset.workDurationMs'), 'frontend should restart live elapsed timers from running state')
    ctx.assert.ok(source.includes('clearWorkTimer(aiMsg)') && source.includes("aiMsg.dataset.workTimerId === String(timerId)"), 'work timer should not be blocked by stale timer ids after project switching')
    ctx.assert.ok(source.includes('grep_code:') && source.includes('search_project:'), 'frontend should map project search tools to productized tool labels')

    const rendererSource = fs.readFileSync(path.join(ctx.root, 'frontend/scripts/features/chat-renderer.js'), 'utf8')
    ctx.assert.ok(rendererSource.includes('const ThinkingDisplay = window.ThinkingDisplay || {}'), 'restored thinking history should use the same ThinkingDisplay module')
    ctx.assert.ok(!rendererSource.includes('现在开始') && !rendererSource.includes('现在需要'), 'restored thinking history should not keep old mechanical first-person rewrites')
    ctx.assert.ok(
      rendererSource.includes('function isInternalUiOnlyTool') &&
      rendererSource.includes('show_thinking_note') &&
      (
        rendererSource.includes('if (isInternalUiOnlyTool(tc.function?.name)) continue') ||
        /isInternalUiOnlyTool\(\s*tc\.function\?\.name\s*\)[\s\S]{0,80}continue/.test(rendererSource) ||
        /isInternalUiOnlyTool\(\s*toolCall\.name\s*\)[\s\S]{0,40}continue/.test(rendererSource)
      ),
      'restored history should not render internal progress/final-reply/thinking-note control tools'
    )
    ctx.assert.ok(
      (
        rendererSource.includes("fallbackName === 'text_edit'") ||
        rendererSource.includes("name === 'text_edit'")
      ) &&
      (
        rendererSource.includes("fallbackName === 'get_latest_change_session'") ||
        rendererSource.includes("name === 'get_latest_change_session'")
      ),
      'restored tool history should show productized labels for text_edit / change-session tools'
    )
    ctx.assert.ok(rendererSource.includes('buildToolGroupCurrentHtml') && rendererSource.includes('summaryHtml') && rendererSource.includes('toolCalls[count - 1]'), 'restored tool groups should keep the latest operation as the visible status line')
    ctx.assert.ok(rendererSource.includes('function normalizeToolType') && rendererSource.includes("name === 'grep_code'") && !rendererSource.includes('<span class="tool-card-icon">${toolCall.icon}</span>'), 'restored expanded tool rows should use fixed svg log icons and normalize grep_code')

    const toolRendererSource = fs.readFileSync(path.join(ctx.root, 'frontend/scripts/features/ai-tool-renderer.js'), 'utf8')
    ctx.assert.ok(
      toolRendererSource.includes('updateGroupCurrent') &&
      toolRendererSource.includes('buildToolCurrentHtml') &&
      toolRendererSource.includes('function getToolLogIcon') &&
      (
        toolRendererSource.includes("name === 'grep_code'") ||
        toolRendererSource.includes('grep_code')
      ) &&
      (
        toolRendererSource.includes('latestCard') ||
        toolRendererSource.includes('toolCalls[') ||
        toolRendererSource.includes('currentHtml')
      ),
      'live tool groups should keep the latest operation as the visible status line with useful search labels'
    )
    ctx.assert.ok(
      (
        toolRendererSource.includes("text_edit: '精确编辑'") ||
        toolRendererSource.includes("text_edit:") ||
        toolRendererSource.includes("'text_edit'")
      ) &&
      (
        toolRendererSource.includes("get_latest_change_session: '查看改动'") ||
        toolRendererSource.includes('get_latest_change_session')
      ) &&
      toolRendererSource.includes('getTextEditDelta'),
      'live tool renderer should label precise edit/change-session tools and keep edit deltas'
    )

    const chatCss = fs.readFileSync(path.join(ctx.root, 'frontend/styles/chat.css'), 'utf8')
    ctx.assert.ok(chatCss.includes('.ai-thinking-inline-code') && chatCss.includes('color-mix(in srgb, var(--bg-tertiary)'), 'thinking inline code should use theme-adaptive colors')
    ctx.assert.ok(
      chatCss.includes('.tool-log-icon svg') &&
      (
        chatCss.includes('width: 17px') ||
        chatCss.includes('width: 14px') ||
        chatCss.includes('width: 15px')
      ) &&
      chatCss.includes('opacity: 0'),
      'tool status lines should use larger svg icons and hover-only toggles'
    )

    const appSource = fs.readFileSync(path.join(ctx.root, 'frontend/scripts/app.js'), 'utf8')
    ctx.assert.ok(appSource.includes('awaitingFinalReply'), 'ai-status done should wait for message-reply before ending the run state')
    const ipcStreamSource = fs.readFileSync(path.join(ctx.root, 'frontend/scripts/features/ipc-ai-stream-listeners.js'), 'utf8')
    const streamRendererSource = fs.readFileSync(path.join(ctx.root, 'frontend/scripts/features/ai-stream-renderer.js'), 'utf8')
    ctx.assert.ok(streamRendererSource.includes('function isInternalUiOnlyTool') && ipcStreamSource.includes('if (deps.isInternalUiOnlyTool(data.name)) return'), 'live frontend should not render internal progress/final-reply control tools')
    const finalDeltaSource = streamRendererSource.slice(
      streamRendererSource.indexOf('function appendAiFinalDelta'),
      streamRendererSource.indexOf('function finishAiStreaming')
    )
    ctx.assert.ok(finalDeltaSource.indexOf('renderFinalStreamFrame(currentAiMsg, targetProject)') < finalDeltaSource.indexOf('collapseDynamicArea()'), 'final reply should render a first frame before collapsing the thinking area')
    const finishStreamingSource = streamRendererSource.slice(
      streamRendererSource.indexOf('function finishAiStreaming'),
      streamRendererSource.indexOf('function updateAiStats')
    )
    ctx.assert.ok(
      finishStreamingSource.includes('onFirstFrame:') &&
      (
        finishStreamingSource.includes('onFirstFrame: () => deps.collapseDynamicArea()') ||
        /onFirstFrame:\s*\(\)\s*=>\s*\{[\s\S]{0,120}collapseDynamicArea\(/.test(finishStreamingSource)
      ),
      'non-delta final replies should collapse process blocks only after the first typewriter frame is visible'
    )
    const replyListenerSource = fs.readFileSync(path.join(ctx.root, 'frontend/scripts/features/ipc-reply-listener.js'), 'utf8')
    ctx.assert.ok(!/finishAiStreaming\(finalContent,\s*finalArtifacts\)[\s\S]{0,120}collapseDynamicArea\(\)/.test(replyListenerSource), 'message-reply done handler must not collapse process blocks before final content renders')
    ctx.assert.ok(
      (
        ipcStreamSource.includes('if (!data.isStatus && !data.isProgressNarration && !data.isReasoningSummary) return') ||
        /if\s*\(\s*!data\.isStatus[\s\S]{0,80}return/.test(ipcStreamSource)
      ) &&
      (
        streamRendererSource.includes('if (!options.isStatus && !options.isProgressNarration && !options.isReasoningSummary) return') ||
        streamRendererSource.includes('if (!options.isStatus && !options.isProgressNarration') ||
        /if\s*\(\s*!options\.isStatus[\s\S]{0,80}return/.test(streamRendererSource)
      ),
      'frontend should render thinking blocks only from model-emitted status events'
    )

    const runtimeSource = fs.readFileSync(path.join(ctx.root, 'electron/modules/agent-runtime.js'), 'utf8')
    ctx.assert.ok(
      runtimeSource.includes('search_project') ||
      runtimeSource.includes('code_inspect') ||
      runtimeSource.includes('grep_code') ||
      runtimeSource.includes('list_files'),
      'runtime prompt should guide cold-start search / inspection tooling'
    )
    ctx.assert.ok(
      runtimeSource.includes('不要把') ||
      runtimeSource.includes('交付') ||
      runtimeSource.includes('search_project') ||
      runtimeSource.includes('list_files'),
      'runtime prompt should keep delivery and search guidance'
    )
  }
}
