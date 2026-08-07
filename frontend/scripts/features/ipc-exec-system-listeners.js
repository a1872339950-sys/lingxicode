// IPC 执行系统及其余监听器模块
// 负责注册 webview/agent/music/embed/projectPathChanged 监听器，
// 以及智能执行系统监听器（mode-change、show-ask-popup、ask-popup-response-ack、plan-confirm、step-complete）。
// 通过 window.IpcExecSystemListeners.bind(deps) 注入依赖后调用 register() 注册监听。

(function () {
  let deps = {}

  function register() {
    if (!window.api) return

    window.api.onRightWebviewOpenRequest?.(data => {
      const url = String(data?.url || '').trim()
      if (!url) return
      deps.openInWebview(url)
      if (typeof deps.showToast === 'function') {
        deps.showToast('已在右侧窗口打开网页', 'success')
      }
    })

    window.api.onAgentMusicOpen?.(data => {
      const activeProjectId = deps.getActiveProjectId()
      if (data?.projectId && data.projectId !== activeProjectId) return
      if (data?.url) deps.createMusicTab(data.url)
      window.api.agentMusicReady?.({ projectId: data?.projectId || activeProjectId || '' })
    })

    window.api.onAgentMusicCommand?.(async data => {
      const activeProjectId = deps.getActiveProjectId()
      if (!data?.requestId) return
      if (data?.projectId && data.projectId !== activeProjectId) {
        window.api.agentMusicCommandResult?.({
          requestId: data.requestId,
          result: { success: false, error: ((window.i18n?.t?.('auto.js_app_2840_30') ?? '音乐工作台当前项目未激活')) }
        })
        return
      }
      try {
        const result = await deps.sendMusicCommand({ action: data.action, args: data.args || {}, projectId: data.projectId || '' })
        window.api.agentMusicCommandResult?.({ requestId: data.requestId, result: result || { success: true } })
      } catch (error) {
        window.api.agentMusicCommandResult?.({
          requestId: data.requestId,
          result: { success: false, error: error.message || String(error) }
        })
      }
    })

    window.api.onAgentMusicComposeRequest?.(data => {
      const activeProjectId = deps.getActiveProjectId()
      if (data?.projectId && data.projectId !== activeProjectId) return
      const scoreText = String(data?.scoreText || '').trim()
      if (!scoreText) return
      const title = String(data?.title || ((window.i18n?.t?.('auto.js_app_2859_31') ?? '曲谱创作任务'))).trim()
      const scoreType = data?.scoreType || 'auto'
      const isUploadedReference = scoreType === 'uploaded_reference' || data?.source === 'music_upload'
      const content = isUploadedReference
        ? [
            ((window.i18n?.t?.('auto.js_app_2864_32') ?? '用户从音乐工作台上传了音乐、MIDI 或曲谱参考文件，请基于这些参考信息建立创作任务。')),
            '',
            ((window.i18n?.t?.('auto.js_app_2866_33') ?? '要求：')),
            ((window.i18n?.t?.('auto.js_app_2867_34') ?? '1. 先打开音乐工作台，不要只回复文字。')),
            ((window.i18n?.t?.('auto.js_app_2868_35') ?? '2. 如果上传内容里包含 ABC、MIDI 描述或文字编曲方案，直接解析结构、速度、调式、段落、乐器与情绪。')),
            ((window.i18n?.t?.('auto.js_app_2869_36') ?? '3. 如果只有音频文件元数据，不要假装已经完整听懂音频；先整理可见信息，并提示后续需要音频解析模型做节拍、和弦、旋律、乐器识别。')),
            ((window.i18n?.t?.('auto.js_app_2870_37') ?? '4. 基于已知信息生成一版可试听音乐草稿，尽量匹配参考风格；没有同名乐器时，用同族或近似音色替代并说明。')),
            ((window.i18n?.t?.('auto.js_app_2871_38') ?? '5. 完成后播放试听，不要默认导出。')),
            '',
            `参考类型：${scoreType}`,
            `标题：${title}`,
            '',
            ((window.i18n?.t?.('auto.js_app_2876_39') ?? '【上传参考信息】')),
            scoreText
          ].join('\n')
        : [
            ((window.i18n?.t?.('auto.js_app_2880_40') ?? '请基于音乐工作台导入的曲谱继续创作完整音乐。')),
            '',
            ((window.i18n?.t?.('auto.js_app_2882_41') ?? '要求：')),
            ((window.i18n?.t?.('auto.js_app_2883_42') ?? '1. 先打开音乐工作台，不要只回复文字。')),
            ((window.i18n?.t?.('auto.js_app_2884_43') ?? '2. 曲谱里的乐器要尽量匹配工作台乐器；没有同名乐器时，用同族或近似音色替代并说明。')),
            ((window.i18n?.t?.('auto.js_app_2885_44') ?? '3. 不要只做同一个 16 步循环，要按曲谱段落做完整歌曲结构。')),
            ((window.i18n?.t?.('auto.js_app_2886_45') ?? '4. 先调用 music_import_score 导入曲谱，再继续使用音乐工具扩编、调整乐器、和弦、旋律、过门和效果。')),
            ((window.i18n?.t?.('auto.js_app_2887_46') ?? '5. 完成后播放试听，不要默认导出。')),
            '',
            `曲谱类型：${scoreType}`,
            `标题：${title}`,
            '',
            ((window.i18n?.t?.('auto.js_app_2892_47') ?? '【曲谱正文】')),
            scoreText
          ].join('\n')
      deps.sendMessage({
        aiMessage: content,
        displayMessage: isUploadedReference
          ? `从音乐工作台上传音乐参考并交给 AI 解析：${title}`
          : `从音乐工作台导入曲谱并交给 AI 创作：${title}`,
        hideInChat: false
      })
    })

    // 监听项目路径变化
    window.api.onProjectPathChanged?.(data => {
      deps.syncProjectState()
      const projects = deps.getProjects()
      const activeProjectId = deps.getActiveProjectId()
      const changedProject = projects.find(project => project.id === data.projectId)
      const wasStateless = !!changedProject?.stateless
      if (changedProject) {
        changedProject.path = data.path || changedProject.path
        changedProject.storagePath = data.storagePath || changedProject.storagePath || ''
        changedProject.name = changedProject.path ? changedProject.path.split(/[\\/]/).pop() : changedProject.name
        if (data.stateless !== undefined) changedProject.stateless = !!data.stateless
        if (data.workspaceOrigin) changedProject.workspaceOrigin = data.workspaceOrigin
        changedProject.updatedAt = Date.now()
      }
      if (!data.projectId || data.projectId === activeProjectId) {
        deps.setCurrentProjectPath(data.path)
        deps.setCurrentStoragePath(data.storagePath || '')
        deps.updateProjectDisplay()
      }
      deps.renderProjectList()
      if (changedProject && wasStateless && !changedProject.stateless) {
        document.body.classList.remove('no-project-mode')
        window.ProjectStore?.saveList?.(changedProject.path || '')
        const action = changedProject.workspaceOrigin === 'existing' ? '已绑定已有目录' : '已创建并绑定工作区'
        deps.showToast?.(`${action}：${changedProject.path}`, 'success')
      }
      // 切换到新项目时提示用户
      AppLogger.debug('切换到项目:', data.path)
    })

    // ===== 智能执行系统IPC监听 =====
    // 模式切换
    window.api.on?.('mode-change', (e, data) => {
      const activeProjectId = deps.getActiveProjectId()
      // 只处理当前活跃项目的进度事件
      if (data.projectId && data.projectId !== activeProjectId) {
        AppLogger.debug('[Frontend] mode-change 来自其他项目，忽略:', data.projectId, '当前:', activeProjectId)
        return
      }

      deps.setCurrentPhase(data.phase)
      if (data.phase === 'plan') {
        deps.setPlanSteps(data.plan || data.steps || [])
      } else if (data.phase === 'auto-exec') {
        deps.setPlanSteps(data.steps || data.plan || [])
        deps.setCurrentStepIndex(Number.isFinite(Number(data.currentStepIndex)) ? Number(data.currentStepIndex) : 0)
      } else {
        deps.setPlanSteps([])
        deps.setCurrentStepIndex(0)
      }
      deps.updateExecutionProgress()
      const planSteps = deps.getPlanSteps()
      if ((data.phase === 'plan' || data.phase === 'auto-exec') && planSteps.length > 0) {
        const currentAiMsg = deps.getCurrentAiMsg()
        if (!currentAiMsg || !document.contains(currentAiMsg)) deps.ensureCurrentAiMessageForProject(deps.getActiveProject())
        deps.renderMainPlanPanel(planSteps, data.phase === 'auto-exec' ? '执行计划' : '计划')
      }
    })

    // 显示询问弹窗
    window.api.on?.('show-ask-popup', async (e, data) => {
      AppLogger.debug('[Frontend] show-ask-popup:', data)
      if ((data?.source === 'agent_collaboration' || data?.collaborationSessionId) &&
          window.AgentCollaborationUI?.handleSharedAsk?.(data)) {
        return
      }
      await deps.ensureAskProjectActive(data?.projectId)
      deps.ensureAskFeedback(data, data.type === 'path_permission' ? ((window.i18n?.t?.('auto.js_app_3539_52') ?? '等待你确认项目外路径权限。')) : (data.type === 'exec' ? ((window.i18n?.t?.('auto.js_app_3539_53') ?? '等待你确认下一步是否执行。')) : ((window.i18n?.t?.('auto.js_app_3539_54') ?? '等待你选择处理方向。'))))
      const activeProjectId = deps.getActiveProjectId()
      if (data.type === 'plan') {
        deps.showPlanAskPopup(
          data.question,
          data.options,
          data.recommended,
          data.requestId,
          data.projectId,
          { layout: data.layout || '' }
        )
      } else if (data.type === 'exec') {
        deps.showExecAskPopup(data.step, data.isCritical, data.requestId, data.projectId)
      } else if (data.type === 'path_permission') {
        deps.askPopup.showPathPermission(deps.getAskPopupElements(), data, deps.getAskPopupHandlers())
        deps.setPendingAsk({ type: 'path_permission', projectId: data.projectId || activeProjectId, requestId: data.requestId || null })
      } else if (data?.requestId && data?.question && Array.isArray(data?.options)) {
        // 桌面操控、视觉等授权共用标准选项弹窗。此前事件已收到但没有显示分支，
        // 后端会一直等待一个用户根本看不到的选择。
        deps.showPlanAskPopup(
          data.question,
          data.options,
          data.recommended,
          data.requestId,
          data.projectId,
          { layout: data.layout || '', type: data.type || 'permission' }
        )
      }
    })

    // 修复：监听后端对 ask 弹窗回传的 ack，
    // 避免长延迟点击时用户选完了但 AI 仍在等待（之前 IPC 收不到对应请求会被静默丢弃）。
    window.api.on?.('ask-popup-response-ack', (e, data = {}) => {
      if (data && data.ok === false) {
        const reason = data.reason || 'unknown'
        console.warn('[Frontend] ask-popup-response-ack ok=false:', data)
        // 如果当前弹窗的 requestId 匹配过期请求，自动隐藏弹窗
        const pendingAsk = deps.getPendingAsk()
        if (pendingAsk && data.requestId && pendingAsk.requestId === data.requestId) {
          deps.askPopup.hide(deps.getAskPopupElements())
          deps.setPendingAsk(null)
        }
        const message = reason === 'project-mismatch'
          ? '该选择来自其他项目，已被忽略。请重新选择或等待新弹窗。'
          : '该弹窗请求已过期，后端没有收到你的选择。请重新选择或继续等待 AI 重新询问。'
        if (typeof window.electronAPI?.showMessage === 'function') {
          try { window.electronAPI.showMessage({ type: 'warning', message }); return } catch (_) {}
        }
        if (typeof window.alert === 'function') {
          try { window.alert(message); return } catch (_) {}
        }
        console.error('[Frontend] ' + message)
      }
    })

    // 计划确认提示
    window.api.on?.('plan-confirm', async (e, data) => {
      AppLogger.debug('[Frontend] plan-confirm:', data)
      await deps.ensureAskProjectActive(data?.projectId)
      deps.ensureAskFeedback(data, ((window.i18n?.t?.('auto.js_app_3558_55') ?? '计划已准备好，等待你确认是否开始执行。')))
      deps.setPlanSteps(data.plan)
      const activeProjectId = deps.getActiveProjectId()
      deps.askPopup.showPlanConfirm(deps.getAskPopupElements(), data.plan, deps.getAskPopupHandlers())
      deps.setPendingAsk({ type: 'confirm', requestId: data.requestId || null, projectId: data.projectId || activeProjectId, plan: data.plan })
    })

    // 步骤完成更新（输入框上方待办面板 + 消息内计划面板）
    window.api.on?.('step-complete', (e, data = {}) => {
      const activeProjectId = deps.getActiveProjectId()
      // 只处理当前活跃项目的进度事件
      if (data.projectId && data.projectId !== activeProjectId) {
        AppLogger.debug('[Frontend] step-complete 来自其他项目，忽略:', data.projectId, '当前:', activeProjectId)
        return
      }

      if (Array.isArray(data.steps) && data.steps.length > 0) {
        deps.setPlanSteps(data.steps)
      }
      deps.setCurrentPhase?.('auto-exec')

      let currentStepIndex = Number.isFinite(Number(data.currentStepIndex))
        ? Number(data.currentStepIndex)
        : (Number.isFinite(Number(data.index)) ? Number(data.index) + 1 : 0)
      const planSteps = deps.getPlanSteps()
      currentStepIndex = Math.max(0, Math.min(currentStepIndex, planSteps.length || currentStepIndex))
      deps.setCurrentStepIndex(currentStepIndex)

      const allDone = planSteps.length > 0 && currentStepIndex >= planSteps.length
      const incomingPhase = String(data.phase || '').trim()
      const phaseLabel = allDone
        ? (incomingPhase && !/执行中/.test(incomingPhase) ? incomingPhase.replace(/[.。…]+$/g, '') : '已完成')
        : (incomingPhase || '执行中')

      deps.updateExecutionProgress?.({
        steps: planSteps,
        currentStepIndex,
        phase: phaseLabel
      })
      if (planSteps.length > 0) {
        const nextSteps = planSteps.map((step, index) => {
          const title = typeof step === 'string' ? step : (step.title || step.name || step.task || String(step))
          let status = index < currentStepIndex ? 'done' : (index === currentStepIndex ? 'active' : 'pending')
          if (currentStepIndex >= planSteps.length) status = 'done'
          if (typeof step === 'object' && step.status === 'blocked') status = 'blocked'
          return { ...(typeof step === 'object' ? step : {}), title, status }
        })
        deps.renderMainPlanPanel(nextSteps, allDone ? '已完成' : '执行计划')
      }
    })
  }

  function bind(depsObj = {}) {
    deps = depsObj
  }

  window.IpcExecSystemListeners = {
    bind,
    register
  }
})()
