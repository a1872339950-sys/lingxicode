(function () {
  function bind(options = {}) {
    const getAskPopupElementsDeps = options.getAskPopupElementsDeps || function () { return {} }
    const aiAskPopup = options.aiAskPopup
    const askContent = options.askContent
    const askOptions = options.askOptions
    const askCustomInputBox = options.askCustomInputBox
    const customAnswerInput = options.customAnswerInput
    const customSubmitBtn = options.customSubmitBtn
    const askPopup = options.askPopup
    const getProjects = options.getProjects || function () { return [] }
    const getActiveProject = options.getActiveProject || function () { return null }
    const getActiveProjectId = options.getActiveProjectId || function () { return null }
    const getCurrentAiMsg = options.getCurrentAiMsg || function () { return null }
    const getPendingAsk = options.getPendingAsk || function () { return null }
    const setPendingAsk = options.setPendingAsk || function () {}
    const getExecutionMode = options.getExecutionMode || function () { return 'ask' }
    const setExecutionMode = options.setExecutionMode || function () {}
    const updateSendBtnState = options.updateSendBtnState || function () {}
    const ensureCurrentAiMessageForProject = options.ensureCurrentAiMessageForProject || function () {}
    const updateWorkStatus = options.updateWorkStatus || function () {}
    const addThinking = options.addThinking || function () {}
    const syncAiStateToProject = options.syncAiStateToProject || function () {}
    const switchProject = options.switchProject || async function () {}

    // ===== 询问弹窗处理 =====
    function getAskPopupElements() {
      return {
        popup: aiAskPopup,
        content: askContent,
        options: askOptions,
        customInputBox: askCustomInputBox,
        customInput: customAnswerInput
      }
    }

    function getAskPopupHandlers() {
      return {
        onSelect: (label, value) => handleAskResponse(label, value),
        // 自定义选项行内提交：直接把输入内容作为 answer
        onCustom: (value) => handleAskResponse(value, 'custom')
      }
    }

    askPopup.bindKeyboard?.(getAskPopupElements())

    function ensureAskFeedback(data, statusText) {
      const askProject = data?.projectId ? getProjects().find(p => p.id === data.projectId) : getActiveProject()
      if (askProject) {
        askProject.isRunning = true
        askProject.awaitingFinalReply = false
        askProject.aiRunCompletedAt = 0
        if (askProject._aiState) askProject._aiState.aiRunCompletedAt = 0
        updateSendBtnState()
      }
      const currentAiMsg = getCurrentAiMsg()
      if (!currentAiMsg || !document.contains(currentAiMsg)) {
        ensureCurrentAiMessageForProject(askProject)
      }
      const dynamicArea = getCurrentAiMsg()?.querySelector('.ai-dynamic-area')
      const toggleEl = getCurrentAiMsg()?.querySelector('.work-detail-toggle')
      if (dynamicArea?.classList.contains('collapsed')) {
        dynamicArea.classList.remove('collapsed')
        if (toggleEl) toggleEl.textContent = '▾'
      }
      updateWorkStatus('working')
      addThinking(statusText, { isProgressNarration: true })
      syncAiStateToProject()
    }

    async function ensureAskProjectActive(projectId) {
      if (!projectId || projectId === getActiveProjectId()) return
      const targetProject = getProjects().find(p => p.id === projectId)
      if (!targetProject) {
        console.warn('[Frontend] show ask popup target project not found:', projectId)
        return
      }
      await switchProject(projectId)
    }

    // 显示询问弹窗（Plan模式的选项询问）
    function showPlanAskPopup(question, options, recommended = null, requestId = null, projectId = null, meta = {}) {
      askPopup.showPlan(getAskPopupElements(), question, options, recommended, getAskPopupHandlers(), meta || {})
      setPendingAsk({
        type: meta?.type || 'plan',
        question,
        options,
        requestId: requestId || null,
        projectId: projectId || getActiveProjectId(),
        layout: meta?.layout || ''
      })
    }

    // 显示执行询问弹窗（Auto模式的步骤确认）
    function showExecAskPopup(step, isCritical = false, requestId = null, projectId = null) {
      askPopup.showExec(getAskPopupElements(), step, isCritical, getAskPopupHandlers())
      setPendingAsk({ type: 'exec', step, isCritical, requestId: requestId || null, projectId: projectId || getActiveProjectId() })
    }

    // 显示模式选择（执行并切换）
    window.showModeSelect = () => {
      const select = document.getElementById('askModeSelect')
      if (select) {
        const newMode = select.value
        const modeDesc = askPopup.modeLabel(newMode)
        setExecutionMode(newMode)  // 更新全局执行模式
        // 同步到后端 path-permissions（持久化 + 设置页同步）
        window.api?.setPathPermissionMode?.(newMode).catch(() => {})
        // 更新UI显示
        const currentModeText = document.getElementById('execModeCurrent')
        if (currentModeText) currentModeText.textContent = modeDesc
        selectOption(((window.i18n?.t?.('auto.js_app_3975_58') ?? '执行并切换为')) + modeDesc, 'approved_with_mode:' + newMode)
      }
    }

    // 选择选项（统一处理）
    window.selectOption = (label, value) => {
      handleAskResponse(label, value)
    }

    // 兼容旧入口：聚焦行内自定义输入
    window.showCustomInput = () => {
      askPopup.showCustomInput(getAskPopupElements())
    }

    // 底部旧输入区已废弃，保留节点但不绑定提交逻辑
    if (askCustomInputBox) {
      askCustomInputBox.classList.remove('show')
      askCustomInputBox.hidden = true
    }
    if (customSubmitBtn) customSubmitBtn.onclick = null
    if (customAnswerInput) customAnswerInput.onkeydown = null

    // 处理询问响应（不显示到聊天区域，直接发送给AI）
    function handleAskResponse(answer, value) {
      const askContext = getPendingAsk() ? { ...getPendingAsk() } : null
      askPopup.hide(getAskPopupElements())
      setPendingAsk(null)

      let executionModeValue = null
      if (String(value || '').startsWith('approved_with_mode:')) {
        const newMode = value.split(':')[1]
        setExecutionMode(newMode)
        // 同步到后端 path-permissions（持久化 + 设置页同步）
        window.api?.setPathPermissionMode?.(newMode).catch(() => {})
        executionModeValue = newMode
        const modeDesc = askPopup.modeLabel(newMode)
        const currentModeText = document.getElementById('execModeCurrent')
        if (currentModeText) currentModeText.textContent = modeDesc
      }

      if (askContext?.requestId && window.api?.sendAskPopupResponse) {
        window.api.sendAskPopupResponse({
          requestId: askContext.requestId,
          projectId: askContext.projectId || getActiveProjectId(),
          type: askContext.type,
          answer,
          value,
          executionMode: executionModeValue
        })
        updateSendBtnState()
        return
      }

      // requestId 缺失：旧兜底 sendMessage 路径已废弃。
      // 老路径会调 sendMessage 启动一个新协程，与 waitForAskResponse 旧协程的
      // abortController 引用冲突（setAbortController 覆盖后 interrupt-ai 只能 abort 新协程，
      // 旧 waitForAskResponse 永远 await 不到 finish），同时把 `[用户选择: ...]` 脏消息
      // 推入 history 让 AI 误以为收到了选择。表现：选完弹窗关了但 AI 不动，必须 interrupt。
      // 现在只记错误，等待后端重新触发弹窗或用户重试。
      console.error('[Frontend] handleAskResponse 缺少 requestId，跳过 sendMessage 以避免协程冲突。askContext:', askContext, 'answer:', answer, 'value:', value)
      updateSendBtnState()
    }

    return {
      getAskPopupElements,
      getAskPopupHandlers,
      ensureAskFeedback,
      ensureAskProjectActive,
      showPlanAskPopup,
      showExecAskPopup,
      handleAskResponse
    }
  }

  window.AskPopupHandler = { bind }
})()
