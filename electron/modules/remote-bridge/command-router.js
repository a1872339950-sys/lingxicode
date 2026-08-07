'use strict';

const { Action, buildResponse } = require('./protocol');

class CommandRouter {
  constructor(pairingManager, deviceRegistry) {
    this.pairingManager = pairingManager;
    this.deviceRegistry = deviceRegistry;
    // 命令处理器映射表
    this.handlers = new Map();
    // 直调函数映射表（懒加载）
    this._directHandlers = null;
    this._registerHandlers();
  }

  /**
   * 懒加载构建直调函数映射表
   * 绕过 ipcMain.handle，直接调用业务模块导出函数
   */
  _getDirectHandlers() {
    if (this._directHandlers) return this._directHandlers;

    const projects = require('../projects');
    const git = require('../git');
    const storageConfig = require('../storage-config');
    const skills = require('../skills');
    const terminalSessions = require('../terminal-sessions');
    const aiChat = require('../ai-chat');

    const map = new Map();

    // 项目模块直调接口
    for (const [ch, fn] of Object.entries(projects.remoteBridgeHandlers)) {
      map.set(ch, fn);
    }

    // Git 模块直调接口
    for (const [ch, fn] of Object.entries(git.remoteBridgeHandlers)) {
      map.set(ch, fn);
    }

    // AI 对话模块直调接口（context-status, context-clear）
    for (const [ch, fn] of Object.entries(aiChat.remoteBridgeHandlers)) {
      map.set(ch, fn);
    }

    // 存储配置模块
    map.set('storage:getProjectsList', () => storageConfig.getProjectsList());
    map.set('storage:getApiConfig', () => storageConfig.getApiConfig());
    map.set('storage:saveApiConfig', (payload) => storageConfig.saveApiConfig(payload));

    // 技能模块
    map.set('get-all-skills', (projectPath = '') => skills.getAllSkillsForIPC(projectPath));
    map.set('enable-skill', (skillName) => skills.enableSkill(skillName));
    map.set('disable-skill', (skillName) => skills.disableSkill(skillName));

    // 终端模块
    map.set('terminal:run', (projectId, command, cwd, sessionId) =>
      terminalSessions.startSession(projectId, command, cwd, sessionId));

    this._directHandlers = map;
    return map;
  }

  _registerHandlers() {
    // ===== 认证 =====
    this.handlers.set(Action.REMOTE_AUTH, (msg, ws, server) => {
      return this._handleAuth(msg, ws, server);
    });

    // ===== 项目操作 =====
    this.handlers.set(Action.PROJECT_LIST, async () => {
      const activeProjects = await this._invokeDirect('get-all-projects');
      const storedResult = await this._invokeDirect('storage:getProjectsList');
      const storedProjects = storedResult?.success && Array.isArray(storedResult.data)
        ? storedResult.data.filter(project => !project?.archived)
        : [];
      const merged = new Map();

      for (const project of storedProjects) {
        if (project?.id) merged.set(project.id, project);
      }
      for (const project of Array.isArray(activeProjects) ? activeProjects : []) {
        if (!project?.id) continue;
        merged.set(project.id, { ...merged.get(project.id), ...project, active: true });
      }

      const projects = await Promise.all([...merged.values()].map(async project => {
        const recentRuns = await this._invokeDirect('task-runs:list', project.id, {
          limit: 8,
          storagePath: project.storagePath,
        });
        return {
          ...project,
          recentRuns: Array.isArray(recentRuns) ? recentRuns : [],
        };
      }));

      return { projects };
    });
    this.handlers.set(Action.PROJECT_SWITCH, async (msg) => {
      const projectId = msg.payload?.projectId;
      if (!projectId) throw new Error('Missing project id');

      const activeProjects = await this._invokeDirect('get-all-projects');
      if ((Array.isArray(activeProjects) ? activeProjects : []).some(project => project?.id === projectId)) {
        return projectId;
      }

      const storedResult = await this._invokeDirect('storage:getProjectsList');
      const storedProject = storedResult?.success && Array.isArray(storedResult.data)
        ? storedResult.data.find(project => project?.id === projectId)
        : null;
      if (!storedProject?.path) throw new Error('Project is unavailable');

      await this._invokeDirect('create-project', storedProject.path, {
        projectId: storedProject.id,
        storagePath: storedProject.storagePath,
      });
      return projectId;
    });
    this.handlers.set(Action.PROJECT_CREATE, (msg) => this._invokeDirect('create-project', msg.payload?.path, msg.payload?.options || {}));
    this.handlers.set(Action.PROJECT_DELETE, (msg) => this._invokeDirect('delete-project', msg.payload?.projectId, msg.payload?.mode || 'light'));

    // ===== 聊天 =====
    // send-message 和 interrupt-ai 通过 remoteBridgeHandlers 直调，绕过 ipcMain.on
    this.handlers.set(Action.CHAT_SEND, (msg) => this._invokeDirect('send-message', msg.payload));
    this.handlers.set(Action.CHAT_INTERRUPT, (msg) => this._invokeDirect('interrupt-ai', msg.payload));
    this.handlers.set(Action.CHAT_HISTORY, (msg) => this._invokeDirect('get-chat-history', msg.payload?.projectId));
    this.handlers.set(Action.CHAT_DELETE, (msg) => this._invokeDirect('messages:delete', msg.payload?.projectId, msg.payload?.selections, msg.payload?.options));

    // ===== Git =====
    this.handlers.set(Action.GIT_STATUS, (msg) => this._invokeDirect('git-status', msg.payload?.projectPath));
    this.handlers.set(Action.GIT_COMMIT, (msg) => this._invokeDirect('git-commit', msg.payload?.projectPath, msg.payload?.message));
    this.handlers.set(Action.GIT_LOG, (msg) => this._invokeDirect('git-log', msg.payload?.projectPath));
    this.handlers.set(Action.GIT_PUSH, (msg) => this._invokeDirect('git-push', msg.payload?.projectPath));
    this.handlers.set(Action.GIT_PULL, (msg) => this._invokeDirect('git-pull', msg.payload?.projectPath));
    this.handlers.set(Action.GIT_BRANCHES, (msg) => this._invokeDirect('git-branches', msg.payload?.projectPath));

    // ===== 配置 =====
    this.handlers.set(Action.CONFIG_GET, () => this._invokeDirect('storage:getApiConfig'));
    this.handlers.set(Action.CONFIG_SAVE, (msg) => this._invokeDirect('storage:saveApiConfig', msg.payload));

    // ===== 技能 =====
    this.handlers.set(Action.SKILL_LIST, (msg) => this._invokeDirect('get-all-skills', msg.payload?.projectPath || ''));
    this.handlers.set(Action.SKILL_TOGGLE, (msg) => {
      const { skillName, enabled } = msg.payload || {};
      return enabled
        ? this._invokeDirect('enable-skill', skillName)
        : this._invokeDirect('disable-skill', skillName);
    });

    // ===== 终端 =====
    this.handlers.set(Action.TERMINAL_RUN, (msg) => this._invokeDirect('terminal:run', msg.payload?.projectId, msg.payload?.command, msg.payload?.cwd, msg.payload?.sessionId));

    // ===== 上下文 =====
    this.handlers.set(Action.CONTEXT_STATUS, (msg) => this._invokeDirect('context-status', msg.payload?.projectId, msg.payload?.modelName));
    this.handlers.set(Action.CONTEXT_CLEAR, (msg) => this._invokeDirect('context-clear', msg.payload?.projectId));

    // ===== 弹窗询问 =====
    this.handlers.set(Action.ASK_RESPONSE, (msg) => {
      const { requestId, answer, value } = msg.payload || {};
      const askPermission = require('../ask-permission');
      const pending = askPermission.pendingAskRequests.get(requestId);
      if (pending) {
        pending.finish({ answer, value });
        return { success: true };
      }
      return { success: false, error: '弹窗请求已过期' };
    });

    // ===== 设备管理 =====
    this.handlers.set(Action.DEVICE_LIST, () => ({ devices: this.deviceRegistry.listDevices() }));
    this.handlers.set(Action.DEVICE_REVOKE, (msg) => {
      const revoked = this.deviceRegistry.revokeDevice(msg.payload?.tokenPrefix);
      return { revoked };
    });

    // ===== 模型列表 =====
    this.handlers.set(Action.MODEL_LIST, () => {
      const storageConfig = require('../storage-config');
      const result = storageConfig.getApiConfig();
      return {
        models: (result.success && result.data?.models) || [],
        currentIndex: (result.success && result.data?.currentIndex) || 0,
      };
    });
  }

  _handleAuth(msg, ws, server) {
    const { pin, token, deviceName } = msg.payload || {};

    if (pin) {
      // PIN 配对
      const result = this.pairingManager.verifyPin(pin, deviceName);
      if (result.success) {
        server.authenticateClient(ws, result.token, deviceName || result.deviceName);
      }
      return result;
    }

    if (token) {
      // Token 认证（已配对设备）
      const result = this.pairingManager.verifyToken(token);
      if (result.success) {
        server.authenticateClient(ws, token, deviceName);
      }
      return result;
    }

    return { success: false, error: '需要提供 pin 或 token' };
  }

  /**
   * 直接调用业务模块函数 — 绕过 ipcMain.handle 通道
   * 所有远程桥接所需的通道均已在 _getDirectHandlers() 中注册
   */
  async _invokeDirect(channel, ...args) {
    const handlers = this._getDirectHandlers();
    const fn = handlers.get(channel);
    if (!fn) {
      throw new Error(`No direct handler registered for channel: ${channel}`);
    }
    return await fn(...args);
  }

  /**
   * 路由命令消息
   * @returns {Promise<any>} 命令执行结果
   */
  async route(message, ws, server) {
    const handler = this.handlers.get(message.action);
    if (!handler) {
      return { success: false, error: `Unknown action: ${message.action}` };
    }

    // 认证命令不需要已认证状态
    if (message.action === Action.REMOTE_AUTH) {
      return handler(message, ws, server);
    }

    // 其他命令需要已认证
    const client = server.clients.get(ws);
    if (!client?.authenticated) {
      return { success: false, error: '未认证，请先配对' };
    }

    return handler(message, ws, server);
  }
}

module.exports = CommandRouter;
