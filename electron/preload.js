const { contextBridge, ipcRenderer, webUtils } = require('electron')

contextBridge.exposeInMainWorld('api', {
  // 选择文件（返回完整路径）
  selectFiles: () => ipcRenderer.invoke('select-files'),
  savePastedImage: (payload) => ipcRenderer.invoke('save-pasted-image', payload),
  savePastedText: (payload) => ipcRenderer.invoke('save-pasted-text', payload),
  saveUploadedFile: (payload) => ipcRenderer.invoke('save-uploaded-file', payload),
  deleteTempFiles: (filePaths) => ipcRenderer.invoke('delete-temp-files', filePaths),
  // 在外部浏览器中打开 URL
  openExternal: (url) => ipcRenderer.invoke('shell:open-external', url),
  // 强制主窗口回焦（删除确认后恢复输入框）
  focusMainWindow: () => ipcRenderer.invoke('window:focus-main'),
  // 获取 File 对象的真实路径（Electron 28+）
  getFilePath: (file) => {
    try {
      return webUtils.getPathForFile(file)
    } catch (e) {
      return null
    }
  },

  // 设置用户界面语言（zh-CN | en-US）
  // 影响后续 system prompt 的"回复风格"和"思考语言"段
  setLanguage: (lang) => ipcRenderer.invoke('set-language', lang),

  // 行为风格：读取/保存 AI 思考与回复风格设置
  getBehaviorStyle: () => ipcRenderer.invoke('get-behavior-style'),
  setBehaviorStyle: (cfg) => ipcRenderer.invoke('set-behavior-style', cfg),

  // 发送消息（支持 projectId，使用 send 替代 invoke 以支持多项目并行）
  // imageDataList: [{ type, data, name, path }] 用于视觉模型
  sendMessage: (projectId, message, config, history, skillContent = null, executionMode = 'auto', agentMode = false, imageDataList = [], displayContent = null, hidden = false, visionRelayConfig = null, references = [], directiveBadges = []) => {
    const requestId = Date.now().toString(36) + Math.random().toString(36).substr(2, 5)
    return new Promise((resolve, reject) => {
      const handler = (event, data) => {
        if (data.requestId === requestId) {
          ipcRenderer.removeListener('send-message-response', handler)
          if (data.error) {
            const error = new Error(data.error)
            error.projectId = data.projectId || projectId
            error.requestId = data.requestId || requestId
            error.response = data
            reject(error)
          }
          else resolve(data)
        }
      }
      ipcRenderer.on('send-message-response', handler)
      ipcRenderer.send('send-message', requestId, projectId, message, config, history, skillContent, executionMode, agentMode, imageDataList, displayContent, hidden, visionRelayConfig, references, directiveBadges)
    })
  },

  // 监听事件
  onAiStatus: (callback) => ipcRenderer.on('ai-status', (e, d) => callback(d)),
  onAiThinking: (callback) => ipcRenderer.on('ai-thinking', (e, d) => callback(d)),
  onAiThinkingReset: (callback) => ipcRenderer.on('ai-thinking-reset', (e, d) => callback(d)),
  onContextCompression: (callback) => ipcRenderer.on('context-compression-start', (e, d) => callback(d)),
  onContextSplit: (callback) => ipcRenderer.on('context-split', (e, d) => callback(d)),
  onAiFinalDelta: (callback) => ipcRenderer.on('ai-final-delta', (e, d) => callback(d)),
  onAiCacheUsage: (callback) => ipcRenderer.on('ai-cache-usage', (e, d) => callback(d)),
  onAiContentChunk: (callback) => ipcRenderer.on('ai-content-chunk', (e, d) => callback(d)),
  onAiIntermediateContent: (callback) => ipcRenderer.on('ai-intermediate-content', (e, d) => callback(d)),
  onBackgroundReplySound: (callback) => ipcRenderer.on('background-reply-sound', (e, d) => callback(d)),
  onToolArgumentProgress: (callback) => ipcRenderer.on('tool-argument-progress', (e, d) => callback(d)),
  onToolStart: (callback) => ipcRenderer.on('tool-start', (e, d) => callback(d)),  // 工具开始执行
  onToolResult: (callback) => ipcRenderer.on('tool-result', (e, d) => callback(d)),
  onRemoteUserMessage: (callback) => ipcRenderer.on('remote-user-message', (e, d) => callback(d)),  // 远程桥接用户消息
  onRightWebviewOpenRequest: (callback) => ipcRenderer.on('right-webview-open-request', (e, d) => callback(d)),
  // 右侧外部网页使用的标准 Chrome UA（避免 Google 判定为内嵌 Electron 浏览器）
  getChromeWebviewUserAgent: () => ipcRenderer.invoke('webview:get-chrome-user-agent'),
  // Google 登录：应用内顶层窗口（与右侧 webview 共享 partition，不是系统浏览器）
  openGoogleLoginWindow: (url) => ipcRenderer.invoke('google-login:open-window', url),
  onExternalWebviewAuthCompleted: (callback) => ipcRenderer.on('external-webview-auth-completed', (e, d) => callback(d)),
  // 从本机 Chromium 浏览器导入登录 Cookie 到右侧内嵌浏览器
  listBrowserProfiles: () => ipcRenderer.invoke('browser-profile:list'),
  importGoogleCookiesFromChrome: (options = {}) => ipcRenderer.invoke('browser-profile:import-google-cookies', options),
  clearBrowserImportStorage: () => ipcRenderer.invoke('browser-profile:clear-storage'),

  // 书签管理
  listBookmarks: () => ipcRenderer.invoke('bookmarks:list'),
  addBookmark: (payload = {}) => ipcRenderer.invoke('bookmarks:add', payload),
  removeBookmark: (payload = {}) => ipcRenderer.invoke('bookmarks:remove', payload),
  hasBookmark: (payload = {}) => ipcRenderer.invoke('bookmarks:has', payload),
  reorderBookmarks: (orderedIds) => ipcRenderer.invoke('bookmarks:reorder', { orderedIds }),
  registerRuntimeTarget: (payload = {}) => ipcRenderer.invoke('runtime-target:register', payload),
  touchRuntimeTarget: (payload = {}) => ipcRenderer.invoke('runtime-target:touch', payload),
  listRuntimeTargets: (payload = {}) => ipcRenderer.invoke('runtime-target:list', payload),
  unregisterRuntimeTarget: (payload = {}) => ipcRenderer.invoke('runtime-target:unregister', payload),
  onReply: (callback) => ipcRenderer.on('message-reply', (e, d) => callback(d)),

  // 接力执行流程
  executeRelayTask: () => Promise.resolve({ success: false, disabled: true, status: 'disabled' }),
  getRelayStatus: () => Promise.resolve({ status: 'disabled', disabled: true }),
  interruptRelay: () => {},
  onRelayStatus: () => {},
  onRelayProgress: () => {},

  // 上下文管理接口（支持 projectId 和 modelName）
  getContextStatus: (projectId, modelName = null) => ipcRenderer.invoke('context-status', projectId, modelName),
  getContextCompressionStack: (projectId, modelDescriptor = null) => ipcRenderer.invoke('context-compression-stack', projectId, modelDescriptor),
  clearContext: (projectId) => ipcRenderer.invoke('context-clear', projectId),
  setProjectPath: (projectId, path) => ipcRenderer.invoke('set-project-path', projectId, path),
  selectProjectPath: () => ipcRenderer.invoke('select-project-path'),
  selectNewProjectParentPath: () => ipcRenderer.invoke('select-new-project-parent-path'),
  createProjectFolder: (parentPath, projectName) => ipcRenderer.invoke('create-project-folder', parentPath, projectName),
  createStatelessChatProject: () => ipcRenderer.invoke('create-stateless-chat-project'),
  listStatelessChatSessions: (options = {}) => ipcRenderer.invoke('stateless-chat-sessions:list', options),
  openStatelessChatSession: (projectId) => ipcRenderer.invoke('stateless-chat-sessions:open', projectId),
  releaseStatelessChatSession: (projectId) => ipcRenderer.invoke('stateless-chat-sessions:release', projectId),
  deleteStatelessChatSession: (projectId) => ipcRenderer.invoke('stateless-chat-sessions:delete', projectId),
  onProjectPathChanged: (callback) => ipcRenderer.on('project-path-changed', (e, d) => callback(d)),

  // ===== 双机制新增接口 =====

  // 记忆查询
  recallMemory: (projectId, query, maxResults = 10) => ipcRenderer.invoke('recall-memory', projectId, query, maxResults),
  recallMemoryByTime: (projectId, startTime, endTime, maxResults = 20) => ipcRenderer.invoke('recall-memory-by-time', projectId, startTime, endTime, maxResults),
  recallMemoryByTurnRange: (projectId, startTurn, endTurn, maxResults = 20) => ipcRenderer.invoke('recall-memory-by-turn-range', projectId, startTurn, endTurn, maxResults),
  getMemoryStatus: (projectId) => ipcRenderer.invoke('memory-get-status', projectId),

  // 可见边界管理
  getVisibilityBoundary: (projectId) => ipcRenderer.invoke('get-visibility-boundary', projectId),
  setVisibilityBoundary: (projectId, newIndex) => ipcRenderer.invoke('set-visibility-boundary', projectId, newIndex),
  resetVisibilityBoundary: (projectId) => ipcRenderer.invoke('reset-visibility-boundary', projectId),
  onVisibilityBoundaryChanged: (callback) => ipcRenderer.on('visibility-boundary-changed', (e, d) => callback(d)),

  // 行为摘要
  getBehaviorSummary: (projectId) => ipcRenderer.invoke('get-behavior-summary', projectId),

  // 完整上下文状态（双机制版本）
  getFullContextStatus: (projectId, modelName = null) => ipcRenderer.invoke('get-context-status', projectId, modelName),

  // 创建项目实例（新增）
  createProject: (path, options = {}) => ipcRenderer.invoke('create-project', path, options),
  createProjectWorktree: (payload = {}) => ipcRenderer.invoke('project-worktree:create', payload),
  removeProjectWorktree: (payload = {}) => ipcRenderer.invoke('project-worktree:remove', payload),
  mergeProjectWorktree: (payload = {}) => ipcRenderer.invoke('project-worktree:merge', payload),
  // 同项目多会话（共享项目路径/权限/快照，独立聊天上下文与历史）
  createProjectChatSession: (projectId, options = {}) => ipcRenderer.invoke('create-project-chat-session', projectId, options),
  switchProjectChatSession: (projectId, sessionId) => ipcRenderer.invoke('switch-project-chat-session', projectId, sessionId),
  deleteProjectChatSession: (projectId, sessionId) => ipcRenderer.invoke('delete-project-chat-session', projectId, sessionId),
  listProjectChatSessions: (projectId) => ipcRenderer.invoke('list-project-chat-sessions', projectId),
  updateProjectChatSessionTitle: (projectId, sessionId, title) => ipcRenderer.invoke('update-project-chat-session-title', projectId, sessionId, title),
  renameProjectFolder: (projectId, nextName) => ipcRenderer.invoke('rename-project-folder', projectId, nextName),
  // 获取所有项目状态（新增）
  getAllProjects: (options = {}) => ipcRenderer.invoke('get-all-projects', options),
  // 删除项目（mode: 'full' 完全删除, 'light' 仅删除聊天数据）
  deleteProject: (projectId, mode) => ipcRenderer.invoke('delete-project', projectId, mode),
  deleteMessages: (projectId, selections, options = {}) => ipcRenderer.invoke('messages:delete', projectId, selections, options),
  getArtifact: (projectId, artifactId) => ipcRenderer.invoke('artifact:get', projectId, artifactId),
  getTaskLedgerIndex: (projectId) => ipcRenderer.invoke('task-ledger:index', projectId),
  getTaskLedgerEntry: (projectId, entryId) => ipcRenderer.invoke('task-ledger:get', projectId, entryId),
  listTaskRuns: (projectId) => ipcRenderer.invoke('task-runs:list', projectId),
  getRecoverableTaskRuns: (projectId) => ipcRenderer.invoke('task-runs:recoverable', projectId),
  getObservabilitySnapshot: (options = {}) => ipcRenderer.invoke('observability:getSnapshot', options),
  clearObservability: () => ipcRenderer.invoke('observability:clear'),

  // Project-scoped terminal
  terminalCreate: (projectId, cwd, options = {}) => ipcRenderer.invoke('terminal:create', projectId, cwd, options),
  terminalActivate: (projectId, sessionId) => ipcRenderer.invoke('terminal:activate', projectId, sessionId),
  terminalRun: (projectId, command, cwd, sessionId = null) => ipcRenderer.invoke('terminal:run', projectId, command, cwd, sessionId),
  terminalStatus: (projectId, sessionId = null, options = {}) => ipcRenderer.invoke('terminal:status', projectId, sessionId, options),
  terminalStop: (projectId, sessionId = null) => ipcRenderer.invoke('terminal:stop', projectId, sessionId),
  terminalDelete: (projectId, sessionId) => ipcRenderer.invoke('terminal:delete', projectId, sessionId),
  terminalClear: (projectId) => ipcRenderer.invoke('terminal:clear', projectId),
  onTerminalOutput: (callback) => ipcRenderer.on('terminal-output', (e, d) => callback(d)),
  onTerminalStatus: (callback) => ipcRenderer.on('terminal-status', (e, d) => callback(d)),
  startAgentCollaboration: (projectId, payload = {}) => ipcRenderer.invoke('agent-collaboration:start', projectId, payload),
  ensureCollaborationChatInstance: (parentProjectId, sessionId, agent = {}) => ipcRenderer.invoke('ensure-collaboration-chat-instance', parentProjectId, sessionId, agent),
  cancelAgentCollaboration: (projectId, requestId, reason = '') => ipcRenderer.invoke('agent-collaboration:cancel', projectId, requestId, reason),
  getAgentCollaboration: (projectId, sessionId = null) => ipcRenderer.invoke('agent-collaboration:get', projectId, sessionId),
  updateAgentCollaboration: (projectId, sessionId, patch = {}) => ipcRenderer.invoke('agent-collaboration:update', projectId, sessionId, patch),
  stopAgentCollaborationAi: (projectId, sessionId, agentId, reason = '') => ipcRenderer.invoke('agent-collaboration:stop-agent', projectId, sessionId, agentId, reason),
  retryAgentCollaborationAi: (projectId, sessionId, agentId) => ipcRenderer.invoke('agent-collaboration:retry-agent', projectId, sessionId, agentId),
  stopAgentCollaborationAll: (projectId, sessionId, reason = '') => ipcRenderer.invoke('agent-collaboration:stop-all', projectId, sessionId, reason),
  readAgentCollaborationReport: (filePath) => ipcRenderer.invoke('agent-collaboration-report:read', filePath),
  readAgentCollaborationReports: (projectId) => ipcRenderer.invoke('agent-collaboration-report:read-project', projectId),
  cleanupAgentCollaborationReports: (projectId = null) => ipcRenderer.invoke('agent-collaboration-report:cleanup', projectId),
  onAgentCollaborationRequest: (callback) => ipcRenderer.on('agent-collaboration-request', (e, d) => callback(d)),
  onAgentCollaborationSession: (callback) => ipcRenderer.on('agent-collaboration-session', (e, d) => callback(d)),
  listAgentWorkflows: (projectId, options = {}) => ipcRenderer.invoke('agent-workflow:list', projectId, options),
  getAgentWorkflow: (projectId, workflowId) => ipcRenderer.invoke('agent-workflow:get', projectId, workflowId),
  saveAgentWorkflow: (projectId, workflow = {}) => ipcRenderer.invoke('agent-workflow:save', projectId, workflow),
  deleteAgentWorkflow: (projectId, workflowId) => ipcRenderer.invoke('agent-workflow:delete', projectId, workflowId),
  setAgentWorkflowEnabled: (projectId, workflowId, enabled) => ipcRenderer.invoke('agent-workflow:set-enabled', projectId, workflowId, enabled),
  onCanvasWorkflowCreated: (callback) => {
    const listener = (_event, data) => callback(data)
    ipcRenderer.on('canvas-workflow:created', listener)
    return () => ipcRenderer.removeListener('canvas-workflow:created', listener)
  },
  getAiOperationMemoSettings: () => ipcRenderer.invoke('ai-operation-memo:get-settings'),
  saveAiOperationMemoSettings: (config = {}) => ipcRenderer.invoke('ai-operation-memo:save-settings', config),
  saveAiOperationMemoDraft: (projectPath, memoId) => ipcRenderer.invoke('ai-operation-memo:save-draft', projectPath, memoId),
  deleteAiOperationMemoDraft: (projectPath, memoId) => ipcRenderer.invoke('ai-operation-memo:delete-draft', projectPath, memoId),
  listAiOperationMemoTimeline: (projectPath) => ipcRenderer.invoke('ai-operation-memo:list-timeline', projectPath),
  readAiOperationMemo: (projectPath, memoId) => ipcRenderer.invoke('ai-operation-memo:read', projectPath, memoId),
  listProjectSkillDrafts: (projectPath) => ipcRenderer.invoke('project-skill-draft:list', projectPath),
  installProjectSkillDraft: (projectPath, draftId, options = {}) => ipcRenderer.invoke('project-skill-draft:install', projectPath, draftId, options),
  deleteProjectSkillDraft: (projectPath, draftId, options = {}) => ipcRenderer.invoke('project-skill-draft:delete', projectPath, draftId, options),
  blenderStatus: () => ipcRenderer.invoke('blender:status'),
  blenderRunScript: (args = {}, projectPath = '') => ipcRenderer.invoke('blender:runScript', args, projectPath),
  blenderCreateDemoModel: (args = {}, projectPath = '') => ipcRenderer.invoke('blender:createDemoModel', args, projectPath),
  blenderModifyScene: (args = {}, projectPath = '') => ipcRenderer.invoke('blender:modifyScene', args, projectPath),
  blenderImportAsset: (args = {}, projectPath = '') => ipcRenderer.invoke('blender:importAsset', args, projectPath),
  blenderInspectScene: (args = {}, projectPath = '') => ipcRenderer.invoke('blender:inspectScene', args, projectPath),
  getPathPermissions: () => ipcRenderer.invoke('path-permissions:get'),
  getSmartAuthorizationConfig: () => ipcRenderer.invoke('storage:getSmartAuthorizationConfig'),
  saveSmartAuthorizationConfig: (config = {}) => ipcRenderer.invoke('storage:saveSmartAuthorizationConfig', config),
  setPathPermissionMode: (mode) => ipcRenderer.invoke('path-permissions:set-mode', mode),
  removePathPermission: (key) => ipcRenderer.invoke('path-permissions:remove', key),
  addPathPermission: (input = {}) => ipcRenderer.invoke('path-permissions:add', input),
  selectPathPermissionTarget: (kind = 'path') => ipcRenderer.invoke('path-permissions:select-path', kind),
  findSoftware: (input = {}) => ipcRenderer.invoke('software:find', input),
  openSoftware: (input = {}) => ipcRenderer.invoke('software:open', input),
  listInstalledApps: () => ipcRenderer.invoke('software:listInstalledApps'),
  scanInstalledApps: () => ipcRenderer.invoke('software:scanInstalledApps'),
  addLocalApp: () => ipcRenderer.invoke('software:addLocalApp'),
  launchApp: (input = {}) => ipcRenderer.invoke('software:launchApp', input),
  removeLocalApp: (input = {}) => ipcRenderer.invoke('software:removeLocalApp', input),
  updateAppCategory: (input = {}) => ipcRenderer.invoke('software:updateAppCategory', input),

  // 主窗口控制（标题栏）
  mainWindowMinimize: () => ipcRenderer.send('main-window-minimize'),
  mainWindowMaximize: () => ipcRenderer.send('main-window-maximize'),
  setMainWindowWorkspaceExpanded: (expanded) => ipcRenderer.send('main-window-workspace-expanded', expanded === true),
  onMainWindowMaximizedChange: (callback) => ipcRenderer.on('main-window-maximized-change', (e, d) => callback(d)),
  mainWindowClose: () => ipcRenderer.send('main-window-close'),

  // 智能执行系统IPC
  on: (channel, callback) => ipcRenderer.on(channel, (e, d) => callback(e, d)),
  sendAskPopupResponse: (data) => ipcRenderer.send('ask-popup-response', data),
  interruptAi: (projectId) => ipcRenderer.send('interrupt-ai', projectId),

  // 消息注入：渲染进程通知后端把消息注入当前 AI 上下文
  // payload: { projectId, itemId, content, createdAt }
  notifyInterjectMessage: (payload) => ipcRenderer.send('notify-interject-message', payload),

  // 兼容旧事件：后端要求前端补渲染一条注入消息
  // payload: { projectId, itemId, content, createdAt }
  onInterjectRendered: (handler) => {
    const listener = (_event, payload) => handler && handler(payload)
    ipcRenderer.on('interject-rendered', listener)
    return () => ipcRenderer.removeListener('interject-rendered', listener)
  },

  // 后端通知前端：消息已进入当前模型继续请求上下文
  // payload: { projectId, itemIds }
  onInterjectConsumed: (handler) => {
    const listener = (_event, payload) => handler && handler(payload)
    ipcRenderer.on('interject-consumed', listener)
    return () => ipcRenderer.removeListener('interject-consumed', listener)
  },

  // 文件预览（新增）
  readFileContent: (path) => ipcRenderer.invoke('read-file-content', path),
  readImageDataUrl: (path) => ipcRenderer.invoke('read-image-data-url', path),
  saveImageAs: (path) => ipcRenderer.invoke('save-image-as', path),
  writeFileContent: (path, content) => ipcRenderer.invoke('write-file-content', path, content),
  listAssetLibrary: (input = {}) => ipcRenderer.invoke('asset-library:list', input),
  getAssetLibraryItem: (id = '') => ipcRenderer.invoke('asset-library:get', id),
  deleteAssetLibraryItem: (id = '') => ipcRenderer.invoke('asset-library:delete', id),

  // 打开项目文件夹（新增）
  openProjectFolder: (path) => ipcRenderer.invoke('open-project-folder', path),
  showItemInFolder: (path) => ipcRenderer.invoke('show-item-in-folder', path),

  // 技能系统
  getAllSkills: (projectPath = '') => ipcRenderer.invoke('get-all-skills', projectPath),
  getEnabledSkills: (projectPath = '') => ipcRenderer.invoke('get-enabled-skills', projectPath),
  reloadSkills: (projectPath = '') => ipcRenderer.invoke('reload-skills', projectPath),
  enableSkill: (skillName) => ipcRenderer.invoke('enable-skill', skillName),
  disableSkill: (skillName) => ipcRenderer.invoke('disable-skill', skillName),
  uploadSkill: (skillData) => ipcRenderer.invoke('upload-skill', skillData),
  deleteSkill: (skillName) => ipcRenderer.invoke('delete-skill', skillName),
  selectSkillFile: () => ipcRenderer.invoke('select-skill-file'),

  // 插件商城
  listPluginMarketplace: () => ipcRenderer.invoke('plugins:listMarketplace'),
  listInstalledPlugins: () => ipcRenderer.invoke('plugins:listInstalled'),
  installPlugin: (pluginId) => ipcRenderer.invoke('plugins:install', pluginId),
  uninstallPlugin: (pluginId) => ipcRenderer.invoke('plugins:uninstall', pluginId),

  // 桌宠
  getDesktopPetConfig: () => ipcRenderer.invoke('desktop-pet:getConfig'),
  setDesktopPetConfig: (cfg) => ipcRenderer.invoke('desktop-pet:setConfig', cfg),
  listDesktopPetCharacters: (projectPath = '') => ipcRenderer.invoke('desktop-pet:listCharacters', projectPath),
  getDesktopPetStatus: () => ipcRenderer.invoke('desktop-pet:getStatus'),
  setDesktopPetEnabled: (enabled, options = {}) => ipcRenderer.invoke('desktop-pet:setEnabled', enabled, options),
  selectDesktopPetCharacter: (characterPathOrId, projectPath = '') => ipcRenderer.invoke('desktop-pet:selectCharacter', characterPathOrId, projectPath),
  showDesktopPet: (options = {}) => ipcRenderer.invoke('desktop-pet:show', options),
  hideDesktopPet: (persistDisable = false) => ipcRenderer.invoke('desktop-pet:hide', persistDisable),
  setDesktopPetAction: (actionId) => ipcRenderer.invoke('desktop-pet:setAction', actionId),
  notifyDesktopPetStatus: (status) => ipcRenderer.invoke('desktop-pet:notifyStatus', status),

  // 桌面操控
  getDesktopControlSettings: () => ipcRenderer.invoke('desktop-control:getSettings'),
  saveDesktopControlSettings: (cfg) => ipcRenderer.invoke('desktop-control:saveSettings', cfg),
  setDesktopControlEnabled: (enabled) => ipcRenderer.invoke('desktop-control:setEnabled', enabled),
  getDesktopControlStatus: () => ipcRenderer.invoke('desktop-control:getStatus'),
  interruptDesktopControl: () => ipcRenderer.invoke('desktop-control:interrupt'),
  clearDesktopControlInterrupt: () => ipcRenderer.invoke('desktop-control:clearInterrupt'),
  revokeDesktopControlApp: (appRef) => ipcRenderer.invoke('desktop-control:revokeApp', appRef),
  clearDesktopControlAllowlist: () => ipcRenderer.invoke('desktop-control:clearAllowlist'),
  onDesktopControlActivity: (callback) => {
    if (typeof callback !== 'function') return () => {}
    const listener = (_event, payload) => callback(payload)
    ipcRenderer.on('desktop-control:activity', listener)
    return () => ipcRenderer.removeListener('desktop-control:activity', listener)
  },

  // 能力开关（可选/高权限能力总控）
  getFeatureSettings: () => ipcRenderer.invoke('feature-settings:get'),
  setFeatureEnabled: (featureId, enabled) => ipcRenderer.invoke('feature-settings:set', featureId, enabled),
  saveFeatureSettings: (partial) => ipcRenderer.invoke('feature-settings:save', partial),
  resetFeatureSettings: () => ipcRenderer.invoke('feature-settings:resetDefaults'),

  // 对话内可视化
  getInlineVisual: (payload) => ipcRenderer.invoke('inline-visualize:get', payload),
  listInlineVisuals: (projectId, limit) => ipcRenderer.invoke('inline-visualize:list', projectId, limit),
  saveInlineVisual: (payload) => ipcRenderer.invoke('inline-visualize:save', payload),

  listMcpServers: (payload = {}) => ipcRenderer.invoke('mcp:listServers', payload),
  listMcpTools: (payload = {}) => ipcRenderer.invoke('mcp:listTools', payload),
  callMcpTool: (payload = {}) => ipcRenderer.invoke('mcp:callTool', payload),
  saveMcpServer: (payload = {}) => ipcRenderer.invoke('mcp:saveServer', payload),
  removeMcpServer: (payload = {}) => ipcRenderer.invoke('mcp:removeServer', payload),
  setMcpServerEnabled: (payload = {}) => ipcRenderer.invoke('mcp:setServerEnabled', payload),
  testMcpServer: (payload = {}) => ipcRenderer.invoke('mcp:testServer', payload),

  // 方案管理

  // 技能管理路径
  getSkillsDir: () => ipcRenderer.invoke('get-skills-dir'),

  // ===== 存储路径配置（统一管理） =====
  // 获取存储状态（包含 basePath, isCustom, paths 等）
  getStorageStatus: () => ipcRenderer.invoke('storage:getStatus'),
  // 设置新的存储路径（可选择是否迁移数据）
  setStoragePath: (newPath, migrate = true) => ipcRenderer.invoke('storage:setPath', newPath, migrate),
  // 重置为默认路径
  resetStoragePath: () => ipcRenderer.invoke('storage:resetPath'),
  // 打开路径选择对话框
  selectStoragePath: () => ipcRenderer.invoke('storage:selectPath'),

  // ===== API 配置管理 =====
  // 获取 API 配置（模型列表）
  getTrashStatus: () => ipcRenderer.invoke('storage:getTrashStatus'),
  setTrashRetentionDays: (days) => ipcRenderer.invoke('storage:setTrashRetentionDays', days),
  cleanupTrash: (options = {}) => ipcRenderer.invoke('storage:cleanupTrash', options),
  getRecoveryPointConfig: () => ipcRenderer.invoke('storage:getRecoveryPointConfig'),
  saveRecoveryPointConfig: (config) => ipcRenderer.invoke('storage:saveRecoveryPointConfig', config),
  getRecoveryPointStatus: () => ipcRenderer.invoke('recovery-points-status'),
  cleanupRecoveryPoints: (options = {}) => ipcRenderer.invoke('recovery-points-cleanup', options),
  getWorkerModelConfig: () => ipcRenderer.invoke('storage:getWorkerModelConfig'),
  saveWorkerModelConfig: (config) => ipcRenderer.invoke('storage:saveWorkerModelConfig', config),
  testWorkerModel: (config, options = {}) => ipcRenderer.invoke('storage:testWorkerModel', config, options),
  testModelConnection: (config, options = {}) => ipcRenderer.invoke('models:testConnection', config, options),
  scanLocalModels: (options = {}) => ipcRenderer.invoke('storage:scanLocalModels', options),
  getCloudTokenUsageSummary: (options = {}) => ipcRenderer.invoke('cloud-token-usage:getSummary', options),
  getApiConfig: () => ipcRenderer.invoke('storage:getApiConfig'),
  // 保存 API 配置
  saveApiConfig: (apiConfig) => ipcRenderer.invoke('storage:saveApiConfig', apiConfig),
  // 从 localStorage 迁移 API 配置
  migrateApiConfig: (localStorageData) => ipcRenderer.invoke('storage:migrateApiConfig', localStorageData),

  // 灵犀客户端更新
  checkLingxiUpdate: (opts) => ipcRenderer.invoke('lingxi-update:check', opts || {}),
  openLingxiDownload: (url) => ipcRenderer.invoke('lingxi-update:openDownload', url),
  getLingxiVersion: () => ipcRenderer.invoke('lingxi-update:getCurrentVersion'),

  // ===== 项目列表管理 =====
  // 获取项目列表
  getProjectsList: () => ipcRenderer.invoke('storage:getProjectsList'),
  // 保存项目列表
  saveProjectsList: (projectsList) => ipcRenderer.invoke('storage:saveProjectsList', projectsList),
  // 从 localStorage 迁移项目列表
  migrateProjectsList: (localStorageProjects) => ipcRenderer.invoke('storage:migrateProjectsList', localStorageProjects),

  // Git 版本管理
  gitStatus: (projectPath) => ipcRenderer.invoke('git-status', projectPath),
  gitStageFiles: (projectPath, files) => ipcRenderer.invoke('git-stage-files', projectPath, files),
  gitIgnoreFiles: (projectPath, files) => ipcRenderer.invoke('git-ignore-files', projectPath, files),
  gitInit: (projectPath) => ipcRenderer.invoke('git-init', projectPath),
  gitLog: (projectPath) => ipcRenderer.invoke('git-log', projectPath),
  gitHideRecoveryCommit: (projectPath, hash) => ipcRenderer.invoke('git-hide-recovery-commit', projectPath, hash),
  gitRecoverySummary: (projectPath) => ipcRenderer.invoke('git-recovery-summary', projectPath),
  gitBranches: (projectPath) => ipcRenderer.invoke('git-branches', projectPath),
  gitBranchDetail: (projectPath, branchName) => ipcRenderer.invoke('git-branch-detail', projectPath, branchName),
  gitCommit: (projectPath, message) => ipcRenderer.invoke('git-commit', projectPath, message),
  gitPush: (projectPath) => ipcRenderer.invoke('git-push', projectPath),
  gitPull: (projectPath) => ipcRenderer.invoke('git-pull', projectPath),
  gitCheckout: (projectPath, branch) => ipcRenderer.invoke('git-checkout', projectPath, branch),
  gitMerge: (projectPath, branch) => ipcRenderer.invoke('git-merge', projectPath, branch),
  gitCreateBranch: (projectPath, branchName) => ipcRenderer.invoke('git-create-branch', projectPath, branchName),
  gitCheckoutBranch: (projectPath, branchName) => ipcRenderer.invoke('git-checkout-branch', projectPath, branchName),
  gitDeleteBranch: (projectId, projectPath, branchName) => ipcRenderer.invoke('git-delete-branch', { projectId, projectPath, branchName }),
  gitGenerateCommit: (projectPath) => ipcRenderer.invoke('git-generate-commit', projectPath),
  gitReset: (projectPath, hash) => ipcRenderer.invoke('git-reset', projectPath, hash),
  gitDiffCommit: (projectPath, hash) => ipcRenderer.invoke('git-diff-commit', projectPath, hash),
  gitFileDiff: (projectPath, filePath) => ipcRenderer.invoke('git-file-diff', projectPath, filePath),
  gitAddRemote: (projectPath, remoteUrl) => ipcRenderer.invoke('git-add-remote', projectPath, remoteUrl),
  gitRemoveRemote: (projectPath) => ipcRenderer.invoke('git-remove-remote', projectPath),

  // AI 本轮修改记录
  getChangeSession: (projectId, sessionId) => ipcRenderer.invoke('change-session-get', projectId, sessionId),
  rollbackChangeSession: (projectId, sessionId, force = false) => ipcRenderer.invoke('change-session-rollback', projectId, sessionId, force),
  onChangeSessionRollbackProgress: (callback) => {
    const handler = (event, data) => callback(data)
    ipcRenderer.on('change-session-rollback-progress', handler)
    return () => ipcRenderer.removeListener('change-session-rollback-progress', handler)
  },
  buildChangeSessionPrompt: (projectId, sessionId, mode = 'review') => ipcRenderer.invoke('change-session-review-prompt', projectId, sessionId, mode),
  listRecoveryPoints: (projectId) => ipcRenderer.invoke('recovery-points-list', projectId),
  createManualRecoveryPoint: (projectId, projectPath, options = {}) => ipcRenderer.invoke('recovery-points-create-manual', projectId, projectPath, options),
  restoreRecoveryPoint: (projectId, pointId, options = {}) => ipcRenderer.invoke('recovery-points-restore', projectId, pointId, options),
  deleteRecoveryPoint: (projectId, pointId) => ipcRenderer.invoke('recovery-points-delete', projectId, pointId),
  runProjectErrorScan: (payload = {}) => ipcRenderer.invoke('project-error-scan:run', payload),

  getPreloadPath: () => ipcRenderer.invoke('get-preload-path'),

  getChatHistory: (projectId) => ipcRenderer.invoke('get-chat-history', projectId),
  getChatHistoryPage: (projectId, options = {}) => ipcRenderer.invoke('get-chat-history-page', projectId, options),
  getChatHistoryIndex: (projectId) => ipcRenderer.invoke('get-chat-history-index', projectId),
  exportChatHistory: (projectId) => ipcRenderer.invoke('export-chat-history', projectId),
  createChatHistorySourceReference: (targetProjectId, sourceProjectId, options = {}) => ipcRenderer.invoke('chat-history:create-source-reference', targetProjectId, sourceProjectId, options),
  switchBranchChatSession: (projectId, branchName) => ipcRenderer.invoke('switch-branch-chat-session', projectId, branchName),
  replaceChatHistory: (projectId, messagesHistory = [], options = {}) => ipcRenderer.invoke('chat-history:replace', projectId, messagesHistory, options),
  setBranchSessionTitle: (projectId, title = '') => ipcRenderer.invoke('branch-session:set-title', projectId, title),

  // ===== 自动分割事件 =====
  onContextSplit: (callback) => ipcRenderer.on('context-split', (e, d) => callback(d)),

  // ===== Agent调度系统 =====

  // 执行Agent任务
  executeAgentTask: () => Promise.resolve({
    success: false,
    disabled: true,
    error: '多会话窗口只支持用户手动发送消息，不再支持主聊天 AI 指派任务。'
  }),

  // 获取Agent状态
  getAgentStatus: (projectId) => ipcRenderer.invoke('agent-collaboration:get', projectId),

  // 中断Agent任务
  interruptAgent: (projectId) => ipcRenderer.invoke('agent-collaboration:get', projectId).then(result => {
    const session = result?.session
    if (session?.id) return ipcRenderer.invoke('agent-collaboration:stop-all', projectId, session.id, '用户停止了全部协作 AI')
    return { success: true, skipped: true }
  }),

  // 检查任务复杂度
  checkTaskComplexity: (projectId, userMessage) => ipcRenderer.invoke('agent-collaboration:complexity', projectId, userMessage),

  // Agent状态事件监听
  onAgentMasterStatus: () => {},
  onAgentSubStatus: () => {},

  // ===== 远程桥接（移动端远程操控） =====
  remoteBridge: {
    getStatus: () => ipcRenderer.invoke('remote-bridge:status'),
    generatePin: () => ipcRenderer.invoke('remote-bridge:generate-pin'),
    start: (options) => ipcRenderer.invoke('remote-bridge:start', options),
    stop: () => ipcRenderer.invoke('remote-bridge:stop'),
    attach: () => ipcRenderer.invoke('remote-bridge:attach'),
    listDevices: () => ipcRenderer.invoke('remote-bridge:list-devices'),
    revokeDevice: (tokenPrefix) => ipcRenderer.invoke('remote-bridge:revoke-device', tokenPrefix),
  },
})
