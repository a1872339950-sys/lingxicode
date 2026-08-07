(function () {
  function bind(options = {}) {
    const getProjectStore = options.getProjectStore || function () { return null }
    const getModelStore = options.getModelStore || function () { return null }
    const getProjects = options.getProjects || function () { return [] }
    const setProjects = options.setProjects || function () {}
    const getActiveProjectId = options.getActiveProjectId || function () { return null }
    const setActiveProjectId = options.setActiveProjectId || function () {}
    const getSavedModels = options.getSavedModels || function () { return [] }
    const getChatInputArea = options.getChatInputArea || function () { return null }
    const getInputBox = options.getInputBox || function () { return null }
    const getAttachmentStore = options.getAttachmentStore || function () { return null }
    const getChatMessages = options.getChatMessages || function () { return null }
    const getExecModeIcon = options.getExecModeIcon || function () { return null }
    const getExecModeCurrent = options.getExecModeCurrent || function () { return null }
    const getExecModeMenu = options.getExecModeMenu || function () { return null }
    const getGitPanelFeature = options.getGitPanelFeature || function () { return null }
    const getChatRenderer = options.getChatRenderer || function () { return null }
    const getNoProjectChatPrompt = options.getNoProjectChatPrompt || function () { return '' }
    const getNoProjectSendPrompt = options.getNoProjectSendPrompt || function () { return '' }
    const getQuotedArtifacts = options.getQuotedArtifacts || function () { return [] }
    const setQuotedArtifacts = options.setQuotedArtifacts || function () {}
    const setCurrentProjectPath = options.setCurrentProjectPath || function () {}
    const setCurrentStoragePath = options.setCurrentStoragePath || function () {}
    const setCurrentSkill = options.setCurrentSkill || function () {}
    const setCurrentAiMsg = options.setCurrentAiMsg || function () {}
    const setCurrentToolCount = options.setCurrentToolCount || function () {}
    const setCurrentOpCount = options.setCurrentOpCount || function () {}
    const renderProjectList = options.renderProjectList || function () {}
    const updateSkillButton = options.updateSkillButton || function () {}
    const updateProjectDisplay = options.updateProjectDisplay || function () {}
    const updateSidebarContext = options.updateSidebarContext || function () {}
    const updateSendBtnState = options.updateSendBtnState || function () {}
    const syncUploadedFiles = options.syncUploadedFiles || function () {}
    const renderUploadedFiles = options.renderUploadedFiles || function () {}
    const renderArtifactRefs = options.renderArtifactRefs || function () {}
    const syncChatBottomInset = options.syncChatBottomInset || function () {}
    const scrollToLatestAiMessage = options.scrollToLatestAiMessage || function () {}
    const switchProjectFn = options.switchProject || null
    const makeProjectFn = options.createProject || null
    const showToast = options.showToast || ((message, type = 'info') => window.showToast?.(message, type))
    let ensureStatelessChatPromise = null

    function syncProjectState() {
      const projectStore = getProjectStore()
      setProjects(projectStore?.getProjects() || [])
      setActiveProjectId(projectStore?.getActiveProjectId() || null)
    }

    function resolveActivitySessionId(project, options = {}) {
      const fromOpt = String(options?.sessionId || options?.chatSessionId || '').trim()
      if (fromOpt) return fromOpt
      const running = String(project?._runningSessionId || '').trim()
      if (running) return running
      const current = String(project?.chatSessionId || '').trim()
      if (current) return current
      const primary = Array.isArray(project?.chatSessions)
        ? (project.chatSessions.find(s => s?.isPrimary)?.sessionId
          || project.chatSessions.find(s => s?.sessionId === 'main')?.sessionId
          || project.chatSessions[0]?.sessionId
          || '')
        : ''
      return String(primary || 'main').trim() || 'main'
    }

    function ensureSessionActivityMap(project) {
      if (!project) return null
      if (!project.sessionActivityStatus || typeof project.sessionActivityStatus !== 'object') {
        project.sessionActivityStatus = {}
      }
      return project.sessionActivityStatus
    }

    function getSessionActivityStatus(project, sessionId) {
      if (!project) return ''
      const key = String(sessionId || '').trim()
      const map = project.sessionActivityStatus
      if (key && map && typeof map === 'object') {
        const status = map[key]
        if (['running', 'done', 'error'].includes(status)) return status
      }
      // 兼容旧的项目级状态：仅映射到当前/运行中会话，避免两会话同时亮同一指示
      const legacy = project.projectActivityStatus
      if (!['running', 'done', 'error'].includes(legacy)) return ''
      const runningId = String(project._runningSessionId || project.chatSessionId || '').trim()
      if (!key || !runningId || key === runningId) return legacy
      return ''
    }

    function setProjectActivity(projectOrId, status, options = {}) {
      const projects = getProjects()
      const project = typeof projectOrId === 'string'
        ? projects.find(p => p.id === projectOrId)
        : projectOrId
      if (!project) return
      const nextStatus = ['running', 'done', 'error'].includes(status) ? status : ''
      const sessionId = resolveActivitySessionId(project, options)
      const map = ensureSessionActivityMap(project)
      // 下线项目名右侧指示：清空旧字段，状态只挂在会话上
      if (project.projectActivityStatus) project.projectActivityStatus = ''

      if (nextStatus) {
        if (map[sessionId] === nextStatus) return
        map[sessionId] = nextStatus
      } else {
        if (!map[sessionId]) {
          // 若传入空状态且无 session 键，清掉全部非 running 遗留
          if (!String(options?.sessionId || options?.chatSessionId || '').trim() && !project._runningSessionId) {
            let changed = false
            for (const key of Object.keys(map)) {
              if (map[key] === 'done' || map[key] === 'error') {
                delete map[key]
                changed = true
              }
            }
            if (!changed) return
            renderProjectList()
            return
          }
          return
        }
        delete map[sessionId]
      }
      renderProjectList()
    }

    function clearViewedProjectActivity(project, options = {}) {
      if (!project) return
      const map = project.sessionActivityStatus
      const sessionId = String(options?.sessionId || project.chatSessionId || '').trim()

      if (map && typeof map === 'object') {
        if (sessionId) {
          const status = map[sessionId]
          if (status === 'done' || status === 'error') {
            setProjectActivity(project, '', { sessionId })
          }
          return
        }
        let changed = false
        for (const key of Object.keys(map)) {
          if (map[key] === 'done' || map[key] === 'error') {
            delete map[key]
            changed = true
          }
        }
        if (changed) renderProjectList()
        return
      }

      // 兼容旧项目级字段
      if (project.projectActivityStatus === 'done' || project.projectActivityStatus === 'error') {
        project.projectActivityStatus = ''
        renderProjectList()
      }
    }

    function setProjectModel(project, index) {
      if (!project) return null
      const modelStore = getModelStore()
      const savedModels = getSavedModels()
      const model = modelStore?.getModelAt?.(index) || null
      project.modelIndex = model ? savedModels.indexOf(model) : -1
      project.modelKey = model ? modelStore.getModelKey(model) : null
      return model
    }

    function resolveProjectModelIndex(project) {
      if (!project) return -1
      const modelStore = getModelStore()
      const index = modelStore?.resolveModelIndex?.({
        modelKey: project.modelKey,
        modelIndex: project.modelIndex
      }) ?? -1
      if (index !== project.modelIndex) {
        setProjectModel(project, index)
      } else if (index >= 0 && !project.modelKey) {
        setProjectModel(project, index)
      }
      return index
    }

    function getProjectModel(project) {
      const index = resolveProjectModelIndex(project)
      const savedModels = getSavedModels()
      return index >= 0 ? savedModels[index] || null : null
    }

    function getProjectModelName(project) {
      return getProjectModel(project)?.modelName || null
    }

    function syncAllProjectModelRefs() {
      const projects = getProjects()
      projects.forEach(project => resolveProjectModelIndex(project))
    }

    function ensureActiveProject(preferredPath = '') {
      const projectStore = getProjectStore()
      const project = projectStore?.ensureActiveProject?.(preferredPath) || null
      syncProjectState()
      return project
    }

    function hasVisibleProjects() {
      syncProjectState()
      const projects = getProjects()
      return projects.some(project => !project.archived && !project.stateless)
    }

    let noProjectScene = null
    let noProjectSceneHost = null

    function destroyNoProjectScene() {
      try { noProjectSceneHost?._noProjectCleanup?.() } catch {}
      try { noProjectScene?.destroy?.() } catch {}
      if (noProjectSceneHost) {
        try { delete noProjectSceneHost._noProjectCleanup } catch {}
      }
      noProjectScene = null
      noProjectSceneHost = null
    }

    async function mountWelcomeLogoMark(root) {
      destroyNoProjectScene()
      const host = root?.querySelector?.('.welcome-mark')
      if (!host) return

      if (window.NoProjectLogoScene?.mount) {
        try {
          const scene = await window.NoProjectLogoScene.mount(host)
          noProjectScene = scene
          noProjectSceneHost = host
          host.dataset.sceneState = 'idle'
          const onMove = (event) => {
            const rect = host.getBoundingClientRect()
            if (!rect.width || !rect.height) return
            const x = ((event.clientX - rect.left) / rect.width) * 2 - 1
            const y = 1 - ((event.clientY - rect.top) / rect.height) * 2
            scene?.setPointer?.({ strength: 1, x, y })
          }
          const onLeave = () => scene?.setPointer?.({ strength: 0 })
          const onEnter = () => scene?.setActive?.(true)
          const onBlur = () => scene?.setActive?.(false)
          host.addEventListener('pointermove', onMove)
          host.addEventListener('pointerleave', onLeave)
          host.addEventListener('pointerenter', onEnter)
          host.addEventListener('pointerdown', onEnter)
          host.addEventListener('pointerup', onBlur)
          host._noProjectCleanup = () => {
            host.removeEventListener('pointermove', onMove)
            host.removeEventListener('pointerleave', onLeave)
            host.removeEventListener('pointerenter', onEnter)
            host.removeEventListener('pointerdown', onEnter)
            host.removeEventListener('pointerup', onBlur)
          }
          return
        } catch (error) {
          console.warn('[Welcome] logo scene mount failed:', error)
        }
      }

      host.classList.add('is-fallback')
      host.innerHTML = '<img class="welcome-logo-image no-project-logo-fallback" src="assets/brand/lingxi-logo-transparent.png" alt="">'
      noProjectSceneHost = host
    }

    function setChatInputVisible(visible) {
      const chatInputArea = getChatInputArea()
      if (!chatInputArea) return
      // 无项目态也保留输入框，支持直接发送。
      chatInputArea.classList.remove('hidden-no-project')
      document.body.classList.toggle('no-project-mode', !visible)
      if (visible) destroyNoProjectScene()
      syncChatBottomInset()
    }

    function triggerNoProjectCreate() {
      if (typeof window.ProjectActions?.createProjectDirectory === 'function') {
        window.ProjectActions.createProjectDirectory()
        return
      }
      showToast?.('当前版本不支持新建项目目录', 'error')
    }

    function triggerNoProjectOpen() {
      if (typeof window.TitlebarActions?.openProjectFromMenu === 'function') {
        window.TitlebarActions.openProjectFromMenu()
        return
      }
      const openItem = document.querySelector('[data-menu-action="file:open-project"]')
      if (openItem) {
        openItem.click()
        return
      }
      showToast?.('当前版本不支持打开已有项目', 'error')
    }

    function fillWelcomePrompt(text) {
      const inputBox = getInputBox()
      if (!inputBox) return
      const next = String(text || '').trim()
      if (!next) return
      inputBox.value = next
      inputBox.dispatchEvent(new Event('input', { bubbles: true }))
      inputBox.focus()
      try {
        const end = inputBox.value.length
        inputBox.setSelectionRange(end, end)
      } catch {}
      updateSendBtnState()
    }

    function bindNoProjectEmptyState(root) {
      if (!root) return
      root.querySelectorAll('[data-no-project-action="create"]').forEach((btn) => {
        btn.addEventListener('click', (event) => {
          event.preventDefault()
          triggerNoProjectCreate()
        })
      })
      root.querySelectorAll('[data-no-project-action="open"]').forEach((btn) => {
        btn.addEventListener('click', (event) => {
          event.preventDefault()
          triggerNoProjectOpen()
        })
      })
      root.querySelectorAll('[data-welcome-prompt]').forEach((card) => {
        card.addEventListener('click', (event) => {
          event.preventDefault()
          fillWelcomePrompt(card.getAttribute('data-welcome-prompt') || card.textContent || '')
        })
      })
    }

    function buildNoProjectWelcomeHtml() {
      const cards = [
        {
          key: 'explore',
          title: '探索并理解代码',
          prompt: '请先探索并理解当前工作区的代码结构、关键入口和现有实现。',
          color: 'blue',
          icon: '<path d="M10.5 18a7.5 7.5 0 1 1 0-15 7.5 7.5 0 0 1 0 15Z"/><path d="m16 16 4.5 4.5"/><path d="M8.2 10.2h4.6"/><path d="M10.5 7.9v4.6"/>'
        },
        {
          key: 'build',
          title: '构建新功能、应用或工具',
          prompt: '请帮我规划并实现一个新功能，先确认需求边界，再给出可落地的实现步骤。',
          color: 'violet',
          icon: '<path d="M14.5 4.5 19 9l-8.5 8.5H6v-4.5L14.5 4.5Z"/><path d="m12.5 6.5 4 4"/>'
        },
        {
          key: 'review',
          title: '审查代码并提出修改建议',
          prompt: '请审查当前工作区代码，指出问题与风险，并给出可执行的修改建议。',
          color: 'green',
          icon: '<path d="M8 6h11"/><path d="M8 12h11"/><path d="M8 18h11"/><path d="m4.5 6.5 1.2 1.2L7.8 5.6"/><path d="m4.5 12.5 1.2 1.2L7.8 11.6"/><path d="m4.5 18.5 1.2 1.2L7.8 17.6"/>'
        },
        {
          key: 'fix',
          title: '修复问题和失败',
          prompt: '请帮我定位并修复当前问题，优先找出根因，再做最小正确修复。',
          color: 'orange',
          icon: '<path d="M12 3.8 20.2 18H3.8L12 3.8Z"/><path d="M12 9v4.2"/><path d="M12 16.4h.01"/>'
        }
      ]

      const cardsHtml = cards.map((card) => `
        <button type="button" class="welcome-prompt-card is-${card.color}" data-welcome-prompt="${card.prompt.replace(/"/g, '&quot;')}">
          <span class="welcome-prompt-icon" aria-hidden="true">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${card.icon}</svg>
          </span>
          <span class="welcome-prompt-title">${card.title}</span>
        </button>
      `).join('')

      return `
        <div class="no-project-empty-state welcome-empty-state" aria-live="polite">
          <div class="welcome-stage">
            <div class="welcome-mark" aria-hidden="true" data-scene-state="idle"></div>
            <div class="welcome-title">我们现在可以做什么？</div>
            <div class="welcome-subtitle">直接输入想法开始，或先新建 / 打开一个工作目录。</div>
            <div class="welcome-prompt-grid">${cardsHtml}</div>
            <div class="welcome-actions">
              <button type="button" class="no-project-btn primary" data-no-project-action="create">新建项目</button>
              <button type="button" class="no-project-btn ghost" data-no-project-action="open">打开已有目录</button>
            </div>
          </div>
        </div>
      `
    }

    function hasWelcomeEmptyState(root = null) {
      const chatMessages = root || getChatMessages()
      if (!chatMessages) return false
      return !!chatMessages.querySelector?.('.welcome-empty-state, .no-project-empty-state')
    }

    /**
     * 首条真实消息出现前清除欢迎页 DOM。
     * 新建/打开空项目时 keepProject 欢迎页会挂在 #chatMessages 内；
     * 若只 append 用户/AI 消息而不移除，欢迎页会一直残留（切换项目再回来才会被历史渲染覆盖）。
     */
    function clearWelcomeEmptyState(options = {}) {
      const chatMessages = options.root || getChatMessages()
      if (!chatMessages) return false
      const nodes = chatMessages.querySelectorAll?.('.welcome-empty-state, .no-project-empty-state')
      if (!nodes || nodes.length === 0) return false
      destroyNoProjectScene()
      nodes.forEach((node) => {
        try { node.remove() } catch (_) {
          try { node.parentNode?.removeChild(node) } catch (_) { /* ignore */ }
        }
      })
      // 有真实项目时不要保留 no-project-mode；无项目会话仍由后续逻辑设置。
      if (options.keepNoProjectMode !== true) {
        const active = getActiveProject?.() || null
        if (active?.id && !active.stateless) {
          document.body.classList.remove('no-project-mode')
        }
      }
      syncChatBottomInset()
      return true
    }

    function renderWelcomeEmptyState(options = {}) {
      const chatMessages = getChatMessages()
      if (!chatMessages) return
      destroyNoProjectScene()
      // 先替换内容为欢迎页，再关闭面板+显示 chatMessages
      // 避免 returnToChatArea 先显示 chatMessages 时闪现旧聊天记录
      chatMessages.innerHTML = buildNoProjectWelcomeHtml()
      // 渲染欢迎页前确保聊天区可见，避免停在设置/资源中心等外部面板
      try { window.ProjectSwitcher?.returnToChatArea?.() } catch (_) {}
      try { window.returnToChatArea?.() } catch (_) {}
      chatMessages.style.display = 'block'
      const root = chatMessages.querySelector('.no-project-empty-state')
      bindNoProjectEmptyState(root)
      void mountWelcomeLogoMark(root)
      const chatInputArea = getChatInputArea()
      chatInputArea?.classList.remove('hidden-no-project')
      if (options.keepProject !== true) {
        document.body.classList.add('no-project-mode')
      } else {
        document.body.classList.remove('no-project-mode')
      }
      syncChatBottomInset()
      updateSendBtnState()
    }

    async function enterNoProjectState(options = {}) {
      // 只关闭各面板，不在此处显示 chatMessages（避免旧聊天记录闪现）
      // chatMessages 的显示由 renderWelcomeEmptyState 统一处理（先替换内容再显示）
      try { window.closeCanvasView?.() } catch (_) {}
      try { window.LingxiPanelManager?.closeMany?.(['archive','integration','localApps','settings','git','gitHistory','gitBranch','remoteBridge']) } catch (_) {}

      // 销毁聊天视图（虚拟滚动器 + 分页加载器），避免 pending 的 requestAnimationFrame
      // 回调在欢迎页渲染后把历史聊天记录恢复到 chatMessages，覆盖欢迎页
      const chatMessagesForCleanup = getChatMessages()
      if (chatMessagesForCleanup) {
        try { window.ChatSessionCleanup?.destroyChatViews?.(chatMessagesForCleanup) } catch (_) {}
      }

      const projectStore = getProjectStore()
      projectStore?.setActiveProjectId?.(null)
      syncProjectState()
      setCurrentProjectPath('')
      setCurrentStoragePath('')
      setCurrentSkill(null)
      setCurrentAiMsg(null)
      setCurrentToolCount(0)
      setCurrentOpCount(0)
      localStorage.removeItem('lastProjectPath')
      if (window.ContextCompressionStatus?.clearForProjectSwitch) {
        window.ContextCompressionStatus.clearForProjectSwitch()
      }
      if (window.ContextCompressionStack?.clearForProjectSwitch) {
        window.ContextCompressionStack.clearForProjectSwitch()
      }
      renderWelcomeEmptyState({ keepProject: false })
      // 无项目也显示输入框，允许直接发送。
      setChatInputVisible(false)
      if (options.save !== false) await saveProjectsList('')
      renderProjectList()
      updateSkillButton()
      updateProjectDisplay()
      updateSidebarContext(0, 0)
      updateSendBtnState()
    }

    async function ensureStatelessChatProject() {
      const existing = getActiveProject()
      if (existing?.id) return existing

      if (ensureStatelessChatPromise) return ensureStatelessChatPromise

      ensureStatelessChatPromise = (async () => {
        if (!window.api?.createStatelessChatProject) {
          throw new Error('当前客户端不支持无项目聊天，请重启应用后再试')
        }

        const createResult = await window.api.createStatelessChatProject()
        if (!createResult?.success || !createResult.projectId) {
          throw new Error(createResult?.error || '创建无项目会话失败')
        }

        const projects = getProjects()
        const existingProject = projects.find(p => p.id === createResult.projectId)
        let project = existingProject
        if (!project) {
          const maker = makeProjectFn || createProject
          project = maker('', {
            id: createResult.projectId,
            name: '无项目会话',
            storagePath: createResult.storagePath || '',
            stateless: true,
            workspaceOrigin: 'none',
            skipSave: true
          })
        }

        if (!project?.id) throw new Error('无项目会话绑定失败')

        setActiveProject(project.id)
        setCurrentProjectPath('')
        setCurrentStoragePath(createResult.storagePath || '')
        const chatMessages = getChatMessages()
        if (chatMessages) chatMessages.innerHTML = ''
        document.body.classList.add('no-project-mode')
        renderProjectList()
        updateProjectDisplay()
        updateSendBtnState()
        syncChatBottomInset()
        return getActiveProject() || project
      })()

      try {
        return await ensureStatelessChatPromise
      } finally {
        ensureStatelessChatPromise = null
      }
    }

    function pathBasename(fullPath = '') {
      const text = String(fullPath || '')
      const parts = text.split(/[\\/]/).filter(Boolean)
      return parts[parts.length - 1] || text
    }

    async function showNoProjectSendPrompt() {
      try {
        await ensureStatelessChatProject()
        return true
      } catch (error) {
        showToast?.(error?.message || getNoProjectSendPrompt() || '无项目会话创建失败', 'error')
        return false
      }
    }

    function setActiveProject(projectId) {
      const projectStore = getProjectStore()
      projectStore.setActiveProjectId(projectId)
      syncProjectState()
      return getActiveProject()
    }

    // 生成项目ID（路径哈希）
    function generateProjectId(path) {
      const projectStore = getProjectStore()
      return projectStore.generateProjectId(path)
    }

    // 创建新项目
    function createProject(path, options = {}) {
      const projectStore = getProjectStore()
      const modelStore = getModelStore()
      const savedModels = getSavedModels()
      const lingxiDefaultIndex = savedModels.findIndex(model => {
        const key = modelStore?.getModelKey?.(model) || ''
        return key === 'lingxi-default' || model?.modelId === 'lingxi-default'
      })
      const currentModelIndex = modelStore?.getCurrentIndex?.() ?? -1
      const defaultModelIndex = lingxiDefaultIndex >= 0
        ? lingxiDefaultIndex
        : (currentModelIndex >= 0 ? currentModelIndex : (savedModels.length > 0 ? 0 : -1))
      const resolvedOptions = {
        modelIndex: defaultModelIndex,
        modelKey: defaultModelIndex >= 0 ? modelStore?.getModelKey?.(savedModels[defaultModelIndex]) || null : null,
        ...options
      }
      if (resolvedOptions.modelIndex >= 0 && !resolvedOptions.modelKey) {
        resolvedOptions.modelKey = modelStore?.getModelKey?.(savedModels[resolvedOptions.modelIndex]) || null
      }
      const project = projectStore.createProject(path, resolvedOptions)
      resolveProjectModelIndex(project)
      syncProjectState()
      if (!options.skipSave) {
        saveProjectsList(options.lastProjectPath || path)  // 持久化保存项目列表
      }
      return project
    }

    // 保存所有项目列表到后端（持久化，统一存储）
    async function saveProjectsList(lastProjectPath = '') {
      const projectStore = getProjectStore()
      syncProjectState()
      const targetLastProjectPath = arguments.length > 0 ? lastProjectPath : (getActiveProject()?.path || '')
      await projectStore.saveList(targetLastProjectPath)
    }

    // 从后端恢复项目列表（支持迁移）
    async function loadProjectsList() {
      const projectStore = getProjectStore()
      return projectStore.loadList()
    }

    // 获取当前激活项目
    function getActiveProject() {
      const projectStore = getProjectStore()
      return projectStore.getActiveProject()
    }

    // 更新执行模式 UI 显示
    function updateExecModeUI(mode) {
      const modeConfig = {
        ask: { name: ((window.i18n?.t?.('auto.l1084') ?? '询问授权')), icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="M9 12l2 2 4-4"/></svg>' },
        full: { name: ((window.i18n?.t?.('auto.l1089') ?? '完整授权')), icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>' }
      }
      const config = { ...(modeConfig[mode] || modeConfig.ask) }
      const askLabel = window.i18n?.t?.('auto.l1084') || '询问授权'
      const fullLabel = window.i18n?.t?.('auto.l1089') || '完整授权'
      if (mode === 'ask') config.name = askLabel
      if (mode === 'full') config.name = fullLabel
      const execModeIcon = getExecModeIcon()
      const execModeCurrent = getExecModeCurrent()
      const execModeMenu = getExecModeMenu()
      if (execModeIcon) execModeIcon.innerHTML = config.icon
      if (execModeCurrent) execModeCurrent.textContent = config.name
      // 更新选中状态
      execModeMenu.querySelectorAll('.exec-mode-option').forEach(o => {
        o.classList.toggle('selected', o.dataset.value === mode)
      })
    }

    // 加载指定项目的 Git 状态（不依赖全局变量）
    async function loadGitStatusForProject(project) {
      const gitPanelFeature = getGitPanelFeature()
      return await gitPanelFeature?.loadGitStatusForProject(project)
    }

    // 初始化项目 Git 仓库
    async function initGitForProject(project) {
      const gitPanelFeature = getGitPanelFeature()
      return await gitPanelFeature?.initGitForProject(project)
    }

    // 添加用户消息到UI（不记录到history）
    function addUserMessageToUI(content, index = null, turnId = null, options = {}) {
      const chatRenderer = getChatRenderer()
      return chatRenderer?.addUserMessage(content, { index, turnId, ...options })
    }

    // 添加AI消息到UI（不记录到history）
    function addAiMessageToUI(content, options = {}) {
      const chatRenderer = getChatRenderer()
      return chatRenderer?.addAiMessage(content, options)
    }

    // 恢复完整聊天历史（包括工具调用）
    function restoreChatHistory(messagesHistory, options = {}) {
      const chatRenderer = getChatRenderer()
      const projectPath = options.projectPath || getActiveProject()?.path || ''
      const restored = chatRenderer?.restoreChatHistory(messagesHistory, { ...options, projectPath })
      scrollToLatestAiMessage()
      return restored
    }

    function mapMessagesHistoryForProject(messagesHistory) {
      let userMsgCount = 0
      return (messagesHistory || []).map((msg) => {
        if (msg.role === 'user') {
          const index = userMsgCount
          if (!msg.hidden) userMsgCount += 1
          return {
            role: msg.role,
            content: msg.content,
            displayContent: msg.displayContent,
            attachments: msg.attachments,
            directiveBadges: msg.directiveBadges,
            references: msg.references,
            hidden: !!msg.hidden,
            index,
            time: msg.time || ''
          }
        }
        return msg
      })
    }

    function isAiMessageStillRunning(aiMsg) {
      if (!aiMsg) return false
      if (aiMsg.dataset?.workDone === 'true') return false
      if (aiMsg.dataset?.finalStreamStarted === 'true' || aiMsg.dataset?.finalStreamContent) return false
      return aiMsg.classList?.contains('thinking') || !!aiMsg.querySelector?.('.ai-thinking-block.active:not(.stopped)')
    }

    function isProjectAiRunActive(project) {
      if (!project) return false
      if (window.RunningUiRestore?.isCurrentSessionRunning && !window.RunningUiRestore.isCurrentSessionRunning(project)) return false
      // 如果 AI 已完成（只是在等 message-reply:done），不算“活跃”
      // 避免 ai-status:done 与 message-reply:done 之间的时序窗口导致 stripActiveRunHistory 被误触发
      // 但如果 awaitingFinalReply 为 true，说明还在等最终回复，AI 运行还没完全结束，仍算活跃
      // 否则切换项目回来时 ensureRunningAiBlockVisible 被跳过，看不见执行过程
      const hasCompletedRun = Number(project.aiRunCompletedAt || project._aiState?.aiRunCompletedAt || 0) > 0
      if (hasCompletedRun && !project.awaitingFinalReply && !project._pendingRunningUiRestore) return false
      return !!(
        project.isRunning ||
        project.awaitingFinalReply ||
        project._pendingRunningUiRestore ||
        (Array.isArray(project.aiOperations) && project.aiOperations.length > 0) ||
        isAiMessageStillRunning(project.savedAiMsg) ||
        project.aiRunningState?.html ||
        project._frozenAiHtml ||
        isAiMessageStillRunning(project._aiState?.currentAiMsg)
      )
    }

    function stripActiveRunHistory(messagesHistory = []) {
      const history = Array.isArray(messagesHistory) ? messagesHistory : []
      const lastUserIndex = history.map(m => m?.role).lastIndexOf('user')
      if (lastUserIndex < 0) return []
      return history.slice(0, lastUserIndex + 1)
    }

    return {
      syncProjectState,
      setProjectActivity,
      clearViewedProjectActivity,
      getSessionActivityStatus,
      resolveActivitySessionId,
      setProjectModel,
      resolveProjectModelIndex,
      getProjectModel,
      getProjectModelName,
      syncAllProjectModelRefs,
      ensureActiveProject,
      hasVisibleProjects,
      setChatInputVisible,
      enterNoProjectState,
      renderWelcomeEmptyState,
      clearWelcomeEmptyState,
      hasWelcomeEmptyState,
      ensureStatelessChatProject,
      showNoProjectSendPrompt,
      setActiveProject,
      generateProjectId,
      createProject,
      saveProjectsList,
      loadProjectsList,
      getActiveProject,
      updateExecModeUI,
      loadGitStatusForProject,
      initGitForProject,
      addUserMessageToUI,
      addAiMessageToUI,
      restoreChatHistory,
      mapMessagesHistoryForProject,
      isAiMessageStillRunning,
      isProjectAiRunActive,
      stripActiveRunHistory
    }
  }

  window.ProjectStateHelpers = { bind }
})()
