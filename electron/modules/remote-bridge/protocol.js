'use strict';

/**
 * 远程桥接通信协议
 * 移动端 <-> 桌面端 Bridge 的 JSON 消息格式定义
 */

// 消息类型
const MessageType = {
  COMMAND: 'command',    // 客户端 → 桌面端（请求）
  RESPONSE: 'response',  // 桌面端 → 客户端（响应）
  EVENT: 'event',        // 桌面端 → 客户端（事件推送）
  PING: 'ping',
  PONG: 'pong',
  AUTH: 'auth',          // 配对认证
};

// 命令 Action 枚举
const Action = {
  // 认证
  REMOTE_AUTH: 'remote:auth',
  // 项目
  PROJECT_LIST: 'project:list',
  PROJECT_CREATE: 'project:create',
  PROJECT_SWITCH: 'project:switch',
  PROJECT_DELETE: 'project:delete',
  // 聊天
  CHAT_SEND: 'chat:send',
  CHAT_INTERRUPT: 'chat:interrupt',
  CHAT_HISTORY: 'chat:history',
  CHAT_DELETE: 'chat:delete',
  // Git
  GIT_STATUS: 'git:status',
  GIT_COMMIT: 'git:commit',
  GIT_LOG: 'git:log',
  GIT_PUSH: 'git:push',
  GIT_PULL: 'git:pull',
  GIT_BRANCHES: 'git:branches',
  // 配置
  CONFIG_GET: 'config:get',
  CONFIG_SAVE: 'config:save',
  // 技能
  SKILL_LIST: 'skill:list',
  SKILL_TOGGLE: 'skill:toggle',
  // 终端
  TERMINAL_RUN: 'terminal:run',
  // 上下文
  CONTEXT_STATUS: 'context:status',
  CONTEXT_CLEAR: 'context:clear',
  // 设备管理
  DEVICE_LIST: 'device:list',
  DEVICE_REVOKE: 'device:revoke',
  // 模型
  MODEL_LIST: 'model:list',
  // 弹窗询问
  ASK_RESPONSE: 'ask:response',
};

// 需要镜像到远程客户端的事件白名单
const MIRROR_EVENTS = [
  'ai-status',
  'ai-thinking',
  'ai-thinking-reset',
  'ai-final-delta',
  'message-reply',
  'tool-start',
  'tool-result',
  'ai-cache-usage',
  'context-compression-start',
  'context-split',
  'terminal-output',
  'terminal-status',
  'project-path-changed',
  'visibility-boundary-changed',
  'agent-collaboration-session',
  'interject-consumed',
  'remote-user-message',  // 远程桥接用户消息通知（桌面端渲染用，手机端忽略）
  'show-ask-popup',  // 弹窗询问转发到手机端
];

/**
 * 构建命令请求消息
 */
function buildCommand(action, payload = {}) {
  return {
    id: `req_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    type: MessageType.COMMAND,
    action,
    payload,
  };
}

/**
 * 构建响应消息
 */
function buildResponse(requestId, success, data = null, error = null) {
  const msg = {
    id: requestId,
    type: MessageType.RESPONSE,
    success,
  };
  if (data !== null) msg.data = data;
  if (error !== null) msg.error = error;
  return msg;
}

/**
 * 构建事件推送消息
 */
function buildEvent(channel, data) {
  return {
    type: MessageType.EVENT,
    channel,
    data,
  };
}

module.exports = {
  MessageType,
  Action,
  MIRROR_EVENTS,
  buildCommand,
  buildResponse,
  buildEvent,
};
