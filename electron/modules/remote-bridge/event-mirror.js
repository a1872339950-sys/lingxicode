'use strict';

const { MIRROR_EVENTS, buildEvent } = require('./protocol');

class EventMirror {
  constructor() {
    this.bridge = null;       // BridgeWSServer 实例
    this.originalSend = null; // 原始 send 函数
    this.hooked = false;
    this._webContents = null;
  }

  /**
   * 启动事件镜像
   * @param {Electron.WebContents} webContents - mainWindow.webContents
   * @param {BridgeWSServer} bridgeServer
   */
  start(webContents, bridgeServer) {
    if (this.hooked || !webContents) return;

    this.bridge = bridgeServer;
    this._webContents = webContents;

    // 保存原始 send 方法
    this.originalSend = webContents.send.bind(webContents);

    // 创建代理 send 方法
    const self = this;
    webContents.send = function(channel, ...args) {
      // 原始调用不受影响
      self.originalSend(channel, ...args);

      // 白名单事件镜像到远程客户端
      if (MIRROR_EVENTS.includes(channel)) {
        const data = args.length === 1 ? args[0] : args;
        self.bridge.broadcast(buildEvent(channel, data));
      }
    };

    this.hooked = true;
    console.log(`[EventMirror] hooked, mirroring ${MIRROR_EVENTS.length} events`);
  }

  stop() {
    // 尝试还原 send（如果 webContents 仍然存活）
    if (this.hooked && this._webContents && this.originalSend) {
      try {
        this._webContents.send = this.originalSend;
      } catch (_) {
        // webContents 可能已销毁，忽略
      }
    }
    this.hooked = false;
    this.bridge = null;
    this.originalSend = null;
    this._webContents = null;
    console.log('[EventMirror] stopped');
  }
}

module.exports = EventMirror;
