// 消息发送模块
// 负责发送用户消息、处理发送失败、协作报告清理标记等。
// 通过 window.MessageSender.bind(deps) 注入依赖后使用。

(function () {
  let deps = {}

  async function sendChangeSessionPrompt(prompt) {
    const firstLine = (prompt || '').split('\n')[0] || ((window.i18n?.t?.('auto.js_app_4052_59') ?? '审查本次修改'))
    return sendMessage({
      displayMessage: firstLine.length > 80 ? firstLine.substring(0, 80) + '...' : firstLine,
      aiMessage: prompt,
      hideInChat: true
    })
  }

  function failCurrentSend(project, error) {
    console.error('[Frontend] sendMessage failed:', error)
    const message = String(error?.message || error || '')
    const errorProjectId = error?.projectId || error?.response?.projectId || project?.id || ''
    const activeProjectId = deps.getActiveProjectId?.() || ''
    const belongsToInactiveProject = errorProjectId && activeProjectId && errorProjectId !== activeProjectId
    clearCollabReportCleanupFlag(project)
    if (project && !project.isRunning && !deps.getCurrentAiMsg()) {
      deps.updateSendBtnState()
      return
    }
    if (/aborted|aborterror|operation was aborted|已中断|中断/i.test(message)) {
      deps.finalizeAiFailure(project, '', { mode: 'interrupted', renderError: false })
      return
    }
    if (belongsToInactiveProject) {
      deps.clearProjectAiRunState?.(project)
      deps.setProjectActivity?.(project, 'error', {
        sessionId: project?._runningSessionId || project?.chatSessionId || ''
      })
      deps.updateSendBtnState?.()
      return
    }
    deps.finalizeAiFailure(project, ((window.i18n?.t?.('auto.js_app_4071_60') ?? '发送消息失败: ')) + (error?.message || error))
  }

  // ===== 发送消息函数 =====
  function setCollabReportCleanupFlag(project, enabled) {
    if (!project) return
    project.cleanupCollabReportsAfterReply = !!enabled
    if (project._aiState) {
      project._aiState.cleanupCollabReportsAfterReply = !!enabled
    }
  }

  function clearCollabReportCleanupFlag(project) {
    setCollabReportCleanupFlag(project, false)
  }

  function cleanupCollabReportsAfterSuccessfulReply(project, data = {}) {
    if (!project || !data.done || data.error) return
    const shouldCleanup = !!project.cleanupCollabReportsAfterReply || !!project._aiState?.cleanupCollabReportsAfterReply
    if (!shouldCleanup) return
    clearCollabReportCleanupFlag(project)
  }

  async function sendMessage(options = {}) {
    const syncProjectState = deps.syncProjectState
    const getActiveProject = deps.getActiveProject
    const inputBox = deps.getInputBox()
    syncProjectState()
    let project = getActiveProject()
    AppLogger.debug('[Frontend] sendMessage, project:', project?.id, 'activeProjectId:', deps.getActiveProjectId())
    if (!project) {
      // 无项目时只创建聊天会话；工作区由首次文件生产操作按需绑定。
      const ensured = await deps.showNoProjectSendPrompt?.()
      syncProjectState?.()
      project = getActiveProject()
      if (!project || ensured === false) return
    }

    const isInternalMessage = options.aiMessage !== undefined
    const hideInChat = !!options.hideInChat
    const cleanupCollabReportsAfterReply = options.cleanupCollabReportsAfterReply === true
    const rawInputMsg = isInternalMessage ? String(options.aiMessage || '').trim() : inputBox.value.trim()
    const stripMentionDirectives = deps.stripMentionDirectives || (value => String(value || '').trim())
    const getMentionDirectiveBadges = deps.getMentionDirectiveBadges || (() => [])
    const msg = rawInputMsg
    const visibleMsg = isInternalMessage ? rawInputMsg : stripMentionDirectives(rawInputMsg)
    const directiveBadges = isInternalMessage ? [] : getMentionDirectiveBadges(rawInputMsg)
    const displayMsg = options.displayMessage !== undefined ? String(options.displayMessage || '').trim() : visibleMsg
    const filesForMessage = isInternalMessage ? [] : deps.getUploadedFiles()
    const hasFiles = filesForMessage.length > 0
    const activeReferences = isInternalMessage ? [] : deps.getQuotedArtifacts()
    const referencesToSend = activeReferences
      .map(item => {
        const type = item?.type || (item?.summaryId ? 'summary' : 'message')
        if (type === 'summary' && item?.summaryId) {
          return { type, summaryId: item.summaryId, title: item.title || item.summaryId, preview: item.preview || '' }
        }
        if (type === 'message' && item?.turnId && item?.part) {
          return { type, turnId: Number(item.turnId), part: item.part, title: item.title || '', preview: item.preview || item.content || '' }
        }
        return null
      })
      .filter(Boolean)
    const referencePrefix = referencesToSend.map(item => `【引用：${deps.getReferenceTitle(item)}】`).join('\n')
    const displayContent = [referencePrefix, displayMsg].filter(Boolean).join('\n')
    if (!msg && !hasFiles && referencesToSend.length === 0) return
    if (project.isRunning && !options.allowWhileRunning) return

    const modelConfig = deps.getProjectModel(project)
    AppLogger.debug('[Frontend] modelConfig:', modelConfig, 'modelIndex:', project.modelIndex, 'savedModels:', deps.getSavedModels().length)
    // 检查配置完整性（modelId 用于API请求，modelName 用于显示）
    const effectiveModelId = modelConfig?.modelId || modelConfig?.modelName
    if (!modelConfig || !modelConfig.apiUrl || !modelConfig.apiKey || !effectiveModelId) {
      deps.addErrorMessage(((window.i18n?.t?.('auto.js_app_4119_62') ?? '请先在设置中添加模型')))
      return
    }

    try {
      // 新一轮发送后允许接收当前会话的 AI 事件
      project.ignoreIncomingAiEvents = false
      project.ignoreIncomingAiEventsUntilSessionId = ''
      project.isRunning = true
      project._runningSessionId = project.chatSessionId || ''
      project.awaitingFinalReply = false
      project.aiRunCompletedAt = 0
      project.aiRunStartedAt = Date.now()
      project.updatedAt = Date.now()
      deps.setProjectActivity(project, 'running', {
        sessionId: project._runningSessionId || project.chatSessionId || ''
      })
      setCollabReportCleanupFlag(project, cleanupCollabReportsAfterReply)
      deps.setAutoFollowCurrentRun(true)
      deps.setUserHasScrolledUp(false)
      deps.setLastScrollTop(0)
      deps.setCurrentChangeSession(null)
      deps.clearAiRuntimeForProject(project)
      deps.setCurrentAiMsg(null)
      deps.setCurrentToolCount(0)
      deps.setCurrentOpCount(0)
      deps.setCurrentThinkingBlock(null)
      project.aiOperations = []
      project.savedAiMsg = null
      project.aiRunningState = null
      deps.rememberTempFilesForCleanup(project.id, filesForMessage)
      if (project._aiState) {
        project._aiState.aiRunStartedAt = project.aiRunStartedAt
        project._aiState.aiRunCompletedAt = 0
        project._aiState.currentAiMsg = null
        project._aiState.currentToolCount = 0
        project._aiState.currentOpCount = 0
        project._aiState.cleanupCollabReportsAfterReply = cleanupCollabReportsAfterReply
      }

    // UI 可带 thumb（blob）即时预览；写入历史时去掉 blob/data，只留 path 元数据防膨胀。
    const visibleAttachments = filesForMessage
      .map(file => {
        const entry = {
          name: String(file?.name || file?.path || file?.file?.name || '').split(/[\\/]/).pop(),
          path: file?.path || '',
          type: file?.type || file?.file?.type || '',
          size: file?.size || file?.file?.size || 0
        }
        if (file?.thumb) entry.thumb = file.thumb
        return entry
      })
      .filter(file => file.name)
    const historyAttachments = visibleAttachments.map(item => ({
      name: item.name,
      path: item.path || '',
      type: item.type || '',
      size: item.size || 0
    }))

    // 先显示用户消息，再创建 AI 过程块，避免发送图片时出现"AI块在用户消息前面"的错位。
    if (!hideInChat) {
      // 新建/打开空项目后的欢迎页仍在 #chatMessages 内时，必须先移除，否则首条消息会叠在欢迎页下方
      try { window.clearWelcomeEmptyState?.() } catch (_) { /* ignore */ }
      // 新一轮开始前清掉上一轮可能残留的上下文压缩状态卡
      if (window.ContextCompressionStatus?.resetBeforeNewTurn) {
        window.ContextCompressionStatus.resetBeforeNewTurn()
      }
      deps.addUserMessage(displayContent || '', { attachments: visibleAttachments, directiveBadges })
    }
    deps.setCurrentAiMsg(deps.createAiMessage())
    const runningAiMsg = deps.getCurrentAiMsg?.()
    if (runningAiMsg?.dataset) {
      runningAiMsg.dataset.projectId = project.id
      runningAiMsg.dataset.chatSessionId = window.RunningUiRestore?.currentSessionId?.(project)
        || String(project.chatSessionId || '').trim()
        || 'main'
    }
    deps.getAiChangePill()?.clear?.()
    deps.withCacheUsageViewState(project.id, () => {
      deps.resetCacheUsageViewState()
      deps.setCacheUsageText('缓存命中观测中', 'pending')
    })
    deps.clearToolStats()

    // 状态同步和按钮更新推迟到浏览器空闲时，避免发送瞬间主线程阻塞
    const _deferSync = typeof requestIdleCallback === 'function'
      ? requestIdleCallback
      : (fn) => setTimeout(fn, 0)
    _deferSync(() => {
      deps.syncAiStateToProject()
      deps.updateSendBtnState()
    })

    // 附件准备可能较慢，纯文本请求等待后端真实过程播报即可。
    if (hasFiles) {
      deps.addThinking(((window.i18n?.t?.('auto.js_app_4167_63') ?? '正在准备附件...')), { isProgressNarration: true, isTransient: true })
    }
    await deps.waitForUiFrame()

    let fullMsg = msg || (activeReferences.length > 0 ? ((window.i18n?.t?.('auto.js_app_4171_64') ?? '请根据我引用的内容继续处理。')) : '')

    // ===== 处理上传文件：只传路径，让AI用工具读取 =====
    if (hasFiles) {
      const fileParts = []

      for (const file of filesForMessage) {
        const fileName = file.name
        const filePath = file.path || null  // Electron dialog 返回的完整路径

        if (file.source === 'pasted-text' && typeof file.pastedText === 'string') {
          // 长文本附件在界面上保持为文件，但发送时直接注入真实内容，避免依赖模型主动读取路径。
          fileParts.push(`【文件:${fileName}】\n${file.pastedText}`)
        } else if (filePath) {
          // 有完整路径：告诉AI路径，让AI用 read_file 读取
          fileParts.push(`【文件】${fileName}\n路径: ${filePath}`)
        } else if (file.file && deps.isImageUpload(file.file)) {
          fileParts.push(`【图片:${fileName}】已作为图片附件上传，等待视觉模型分析。`)
        } else if (file.file) {
          // 降级：浏览器 File 对象，先检查大小再决定是否读取内容
          const MAX_INLINE_TEXT_BYTES = 2 * 1024 * 1024 // 2MB，避免大文件撑爆内存和 IPC
          const fileSize = file.file.size || 0
          if (fileSize > MAX_INLINE_TEXT_BYTES) {
            const sizeMB = (fileSize / 1024 / 1024).toFixed(1)
            fileParts.push(`【文件:${fileName}】文件过大（约 ${sizeMB}MB），已跳过内容读取。请通过文件选择器上传以使用路径方式，或将文件拆分后重试。`)
          } else {
            try {
              const content = await deps.readFileContentGlobal(file.file)
              fileParts.push(`【文件:${fileName}】\n${content}`)
            } catch (e) {
              fileParts.push(`【文件:${fileName}】读取失败`)
            }
          }
        } else {
          fileParts.push(`【文件】${fileName}`)
        }
      }

      if (fileParts.length > 0) {
        fullMsg = msg + (msg ? '\n\n' : '') + fileParts.join('\n\n')
      }
    }

    // ===== 提取图片数据（用于视觉模型） =====
    const imageRefs = []
    for (const file of filesForMessage) {
      const filePath = file.path
      if (filePath && deps.isImageUpload(file)) {
        imageRefs.push({
          type: file.type && String(file.type).startsWith('image/') ? file.type : null,
          path: filePath,
          name: file.name,
          source: 'path'
        })
        AppLogger.debug('[Frontend] 图片路径:', filePath)
      } else if (file.file && deps.isImageUpload(file.file)) {
        imageRefs.push({
          type: file.file.type,
          file: file.file,
          name: file.name,
          size: file.file.size || file.size || 0,
          source: 'browser'
        })
      }
    }

    let visionRelayConfig = null
    let imageDataForSend = []
    let msgForAIExtra = ''
    const modelStore = deps.getModelStore()
    const currentModelHasVision = modelStore?.hasCapability?.(modelConfig, 'vision')
    let shouldPrepareImagePayload = imageRefs.length > 0 && currentModelHasVision
    if (imageRefs.length > 0 && currentModelHasVision) {
      deps.addThinking(`当前模型「${modelConfig.modelName || effectiveModelId}」具备视觉理解，图片将直接发送给当前模型分析。`, { isProgressNarration: true, isTransient: true })
    }
    if (imageRefs.length > 0 && !currentModelHasVision) {
      const currentModelKey = modelStore?.getModelKey?.(modelConfig) || ''
      const routedVisionModels = modelStore?.getRoutedModelsForCapability?.('vision') || []
      const visionModel = routedVisionModels.find(model => (modelStore?.getModelKey?.(model) || '') !== currentModelKey) || modelStore?.findModelWithCapability?.('vision', modelConfig)
      if (visionModel) {
        const capabilityPolicies = modelStore?.getCapabilityPolicies?.() || {}
        let restoreVisionConfirm = null
        if (capabilityPolicies.visionConfirm !== 'always') {
          restoreVisionConfirm = window.confirm
          window.confirm = () => true
        }
        const approved = window.confirm(`当前模型「${modelConfig.modelName || effectiveModelId}」未标注视觉理解能力。\n\n是否调用视觉模型「${visionModel.modelName || visionModel.modelId}」先分析图片，再把分析结果交给当前模型？`)
        if (restoreVisionConfirm) window.confirm = restoreVisionConfirm
        if (approved) {
          visionRelayConfig = {
            approved: true,
            visionModelConfig: visionModel
          }
          shouldPrepareImagePayload = true
          deps.showToast(`将先调用视觉模型「${visionModel.modelName || visionModel.modelId}」分析图片`, 'info')
          deps.addThinking(`正在调用视觉模型「${visionModel.modelName || visionModel.modelId}」分析 ${imageRefs.length} 张图片...`, { isProgressNarration: true, isTransient: true })
        } else {
          msgForAIExtra = ((window.i18n?.t?.('auto.js_app_4255_65') ?? '\\n\\n【图片处理】用户已选择不调用视觉模型。本轮只能基于图片文件名、路径和用户文字回答，不要声称已看见图片内容。'))
          deps.showToast(((window.i18n?.t?.('auto.js_app_4256_5') ?? ((window.i18n?.t?.('auto.js_app_4256_66') ?? '已跳过视觉模型调用，仅发送图片元数据')))), 'info')
          deps.addThinking(((window.i18n?.t?.('auto.js_app_4257_67') ?? '已跳过视觉模型调用，本轮只发送图片文件名和元数据。')), { isProgressNarration: true, isTransient: true })
        }
      } else {
        msgForAIExtra = ((window.i18n?.t?.('auto.js_app_4260_68') ?? '\\n\\n【图片处理】当前未配置具备"视觉理解"能力的模型。本轮只能基于图片文件名、路径和用户文字回答，不要声称已看见图片内容。'))
        deps.showToast(((window.i18n?.t?.('auto.js_app_4261_6') ?? ((window.i18n?.t?.('auto.js_app_4261_69') ?? '未配置视觉理解模型，仅发送图片元数据')))), 'warning')
        deps.addThinking(((window.i18n?.t?.('auto.js_app_4262_70') ?? '未配置视觉理解模型，本轮只发送图片文件名和元数据。')), { isProgressNarration: true, isTransient: true })
      }
    }

    if (shouldPrepareImagePayload) {
      const browserImageCount = imageRefs.filter(image => image.source === 'browser').length
      deps.addThinking(browserImageCount > 0
        ? `正在编码 ${browserImageCount} 张粘贴图片附件...`
        : `已获取 ${imageRefs.length} 张图片路径，准备发送给模型...`, { isProgressNarration: true, isTransient: true })
      await deps.waitForUiFrame()
      for (const image of imageRefs) {
        if (image.source === 'path') {
          imageDataForSend.push({
            type: image.type,
            path: image.path,
            name: image.name
          })
          continue
        }
        if (image.size > deps.getMaxInlineImageBytes()) {
          const limitText = deps.formatUploadBytes(deps.getMaxInlineImageBytes())
          const sizeText = deps.formatUploadBytes(image.size)
          deps.addThinking(`图片「${image.name}」大小 ${sizeText}，超过 ${limitText}，已跳过视觉读取。`, { isProgressNarration: true })
          msgForAIExtra += `\n\n【图片读取失败】${image.name} 大小 ${sizeText}，超过 ${limitText}，未发送给视觉模型。`
          continue
        }
        try {
          const base64 = await deps.readFileAsBase64Global(image.file)
          imageDataForSend.push({
            type: image.type,
            data: base64,
            name: image.name
          })
        } catch (e) {
          AppLogger.debug('[Frontend] 图片读取失败:', image.name, e)
          deps.addThinking(`图片「${image.name}」读取失败，已降级为元数据。`, { isProgressNarration: true })
          msgForAIExtra += `\n\n【图片读取失败】${image.name} 读取失败，未发送给视觉模型。`
        }
      }
      if (imageRefs.length > 0 && imageDataForSend.length === 0) {
        deps.addThinking(((window.i18n?.t?.('auto.js_app_4302_71') ?? '没有可发送给视觉模型的图片，已降级为图片元数据。')), { isProgressNarration: true })
      }
    }
    // 无论是否走视觉，都把带 path 的图片元数据交给后端落盘（forHistoryOnly 不参与多模态）
    for (const image of imageRefs) {
      if (image.source !== 'path' || !image.path) continue
      if (imageDataForSend.some(item => item.path === image.path)) continue
      imageDataForSend.push({
        type: image.type || null,
        path: image.path,
        name: image.name,
        forHistoryOnly: true
      })
    }
    if (typeof AgentUI !== 'undefined' && project.id) {
      AgentUI.clearProjectAgents(project.id)
    }
    // 但发送给AI的消息包含文件路径和用户显式 @ 指令
    const directivePrompt = isInternalMessage ? '' : deps.buildMentionDirectivePrompt(fullMsg)
    const msgForAI = fullMsg + msgForAIExtra + directivePrompt

    // 计算用户消息的index（当前用户消息数）
    const userMsgIndex = project.history.filter(m => m.role === 'user' && !m.hidden).length
    const now = new Date()
    const timeStr = now.toISOString()
    // history 只记用户可见正文；【文件】/路径 注入只给模型，不进气泡 content
    const stripFileInject = (value = '') => String(value || '')
      .replace(/【文件(?::[^\】]*)?】[^\n]*(?:\n路径:\s*[^\n]*)?/g, '')
      .replace(/【图片(?::[^\】]*)?】[^\n]*/g, '')
      .replace(/(?:^|\n)路径:\s*(?:[A-Za-z]:\\|\/)[^\n]*/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
    const visibleUserMessage = stripFileInject(
      stripMentionDirectives(String(displayContent || displayMsg || visibleMsg || '').split(((window.i18n?.t?.('auto.js_app_4315_72') ?? '【视觉模型分析结果】')))[0])
    )
    const userHistoryEntry = { role: 'user', content: visibleUserMessage, index: userMsgIndex, time: timeStr }
    if (historyAttachments.length > 0) {
      userHistoryEntry.attachments = historyAttachments
    }
    if (directiveBadges.length > 0) {
      userHistoryEntry.directiveBadges = directiveBadges
    }
    if (hideInChat) {
      userHistoryEntry.hidden = true
    }
    if (isInternalMessage) {
      userHistoryEntry.displayContent = displayMsg
    }
    if (referencesToSend.length > 0) {
      userHistoryEntry.references = referencesToSend
      userHistoryEntry.displayContent = displayContent
    }
    project.history.push(userHistoryEntry)
    if (!Array.isArray(project.messagesHistory)) project.messagesHistory = []
    project.messagesHistory.push({ ...userHistoryEntry })
    if (!hideInChat) {
      const sessionId = window.RunningUiRestore?.currentSessionId?.(project)
        || String(project.chatSessionId || '').trim()
        || 'main'
      const latestUserSnapshot = {
        ...userHistoryEntry,
        role: 'user',
        content: visibleUserMessage,
        displayContent: userHistoryEntry.displayContent || displayContent || visibleUserMessage,
        attachments: historyAttachments,
        directiveBadges,
        references: referencesToSend,
        turnId: userMsgIndex + 1,
        historyIndex: project.messagesHistory.length - 1,
        chatSessionId: sessionId
      }
      if (!project.savedLatestUserMsgBySession || typeof project.savedLatestUserMsgBySession !== 'object') {
        project.savedLatestUserMsgBySession = {}
      }
      project.savedLatestUserMsgBySession[sessionId] = latestUserSnapshot
      project.savedLatestUserMsg = latestUserSnapshot
    }
    window.ChatRuntimeHistoryCache?.compactProject?.(project)

    // 新会话占位标题：用户发送第一条消息后，把「新会话」替换为用户消息摘要
    if (!hideInChat) {
      const rawTitle = String(displayMsg || ((window.i18n?.t?.('auto.js_app_4334_73') ?? '上传文件')) || '').trim()
      const nextTitle = rawTitle
        ? (rawTitle.length > 10 ? `${rawTitle.substring(0, 10)}...` : rawTitle)
        : ''
      const isPlaceholderChatTitle =
        !project.chatSessionTitle ||
        project.chatSessionTitle === '新会话'
      const isPlaceholderBranchTitle =
        !project.branchTitle ||
        project.branchTitle === '新会话'
      const isFirstVisibleUserMsg = project.history.filter(item => item?.role === 'user' && !item.hidden).length === 1
      if (nextTitle && (isPlaceholderChatTitle || isFirstVisibleUserMsg)) {
        // 会话标题始终可更新；分支标题仅在仍是占位时才同步，避免覆盖消息前缀标题
        project.chatSessionTitle = nextTitle
        if (isPlaceholderBranchTitle) {
          project.branchTitle = nextTitle
        }
        if (project.chatSessionId) {
          const chatSessions = Array.isArray(project.chatSessions) ? project.chatSessions : []
          const hasCurrentSession = chatSessions.some(session => session?.sessionId === project.chatSessionId)
          project.chatSessions = hasCurrentSession
            ? chatSessions.map(session =>
                session?.sessionId === project.chatSessionId
                  ? { ...session, title: nextTitle, current: true }
                  : { ...session, current: false }
              )
            : [
                ...chatSessions.map(session => ({ ...session, current: false })),
                {
                  sessionId: project.chatSessionId,
                  title: nextTitle,
                  path: project.chatSessionPath || '',
                  current: true
                }
              ]
        }
        if (Array.isArray(project.branchSessions) && isPlaceholderBranchTitle) {
          project.branchSessions = project.branchSessions.map(item =>
            item?.current ? { ...item, title: nextTitle } : item
          )
        }
        deps.renderProjectList()
        // 后端同步会话标题（不阻塞发送）
        window.api?.updateProjectChatSessionTitle?.(project.id, project.chatSessionId, nextTitle)?.catch?.(() => {})

        // 兜底：项目进入时若未拉取会话列表（如打开已有目录），project.chatSessionId 会缺失，
        // 导致上面只更新了字符串标题但侧栏 chatSessions 列表仍为空、标题不显示。
        // 这里异步拉一次后端会话列表，拿到真实 chatSessionId / chatSessions 后刷新侧栏。
        if (!project.chatSessionId && typeof deps.reloadActiveBranchSession === 'function') {
          deps.reloadActiveBranchSession({ force: true }).then(() => {
            deps.renderProjectList()
          }).catch(() => {})
        }
      }
    }

    if (!isInternalMessage) {
      inputBox.value = ''
      deps.getTextInputUI()?.reset?.()
      deps.getTextInputUI()?.autoResize?.()
      deps.syncChatBottomInset()
      deps.updateWorkbenchMentionHighlight()
      deps.getAttachmentStore().clear()
      deps.syncUploadedFiles()
      deps.renderUploadedFiles()
      deps.setQuotedArtifacts([])
      deps.renderArtifactRefs()
    }

    // 仅输入框当前选中的技能全文注入；已启用但未选中的不对模型可见
    const skillContent = typeof deps.buildSkillContentForSend === 'function'
      ? deps.buildSkillContentForSend({ primaryName: project.skillName || null })
      : (() => {
        const skillName = project.skillName
        const skill = skillName ? deps.getAllSkills().find(s => s.name === skillName) : null
        return skill?.content || null
      })()
    AppLogger.debug('[Frontend] 发送消息时技能:', project.skillName, '内容长度:', skillContent?.length || 0)
    if (skillContent) {
      AppLogger.debug('[Frontend] 技能内容预览:', skillContent.substring(0, 200))
    }
    if (window.api) {
      // 后端使用 instance.messagesHistory 作为真实历史源，不需要前端传完整 history
      // 传空数组避免每次 IPC 传输大量数据（性能优化：聊天轮次越多越卡）
      let historyToSend = []

      window.api.sendMessage(project.id, msgForAI, modelConfig, historyToSend, skillContent, deps.getExecutionMode(), window.AgentUI?.isEnabled?.() || false, imageDataForSend, displayContent || displayMsg || null, hideInChat, visionRelayConfig, referencesToSend, directiveBadges).catch(err => {
        failCurrentSend(project, err)
      })
    } else {
      throw new Error('主进程通信接口不可用')
    }  // if (window.api) 的闭合
    } catch (error) {
      failCurrentSend(project, error)
    }
  }

  function bind(depsObj = {}) {
    deps = depsObj
  }

  window.MessageSender = {
    bind,
    sendChangeSessionPrompt,
    failCurrentSend,
    setCollabReportCleanupFlag,
    clearCollabReportCleanupFlag,
    cleanupCollabReportsAfterSuccessfulReply,
    sendMessage
  }
})()
