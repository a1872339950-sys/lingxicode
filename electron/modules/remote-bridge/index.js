'use strict';

const path = require('path');
const BridgeWSServer = require('./ws-server');
const EventMirror = require('./event-mirror');
const CommandRouter = require('./command-router');
const PairingManager = require('./pairing');
const DeviceRegistry = require('./device-registry');
const { buildResponse } = require('./protocol');

class RemoteBridge {
  constructor() {
    this.server = null;
    this.eventMirror = null;
    this.commandRouter = null;
    this.pairingManager = null;
    this.deviceRegistry = null;
    this.running = false;
  }

  /**
   * 启动远程桥接服务
   * @param {object} options - { port, storageDir, webContents }
   */
  start(options = {}) {
    if (this.running) return;

    const port = options.port || 9876;
    const storageDir = options.storageDir || this._getDefaultStorageDir();

    // 初始化组件
    this.deviceRegistry = new DeviceRegistry(storageDir);
    this.pairingManager = new PairingManager(this.deviceRegistry);
    this.server = new BridgeWSServer();
    this.commandRouter = new CommandRouter(this.pairingManager, this.deviceRegistry);
    this.eventMirror = new EventMirror();

    // 设置消息处理
    this.server.onMessage = (ws, msg) => this._onMessage(ws, msg);
    this.server.onDisconnect = () => { /* cleanup if needed */ };

    // 自动认证回调：重连时 URL 带 token，自动完成认证
    this.server.onAutoAuth = (ws, token) => {
      const result = this.pairingManager.verifyToken(token);
      if (result.success) {
        this.server.authenticateClient(ws, token, result.deviceName || '');
        console.log('[RemoteBridge] 自动认证成功, device:', result.deviceName || 'unknown');
      }
    };

    // 启动 WS 服务器
    this.server.start(port);

    // 启动事件镜像（如果有 webContents）
    if (options.webContents) {
      this.eventMirror.start(options.webContents, this.server);
    }

    this.running = true;
    const ips = this.server._getLocalIPs();
    console.log(`[RemoteBridge] 服务已启动，端口: ${port}`);
    console.log(`  本机: http://localhost:${port}`);
    ips.forEach(ip => console.log(`  局域网: http://${ip}:${port}`));
  }

  /**
   * 延迟启动事件镜像（在 mainWindow 创建后调用）
   */
  attachWebContents(webContents) {
    if (this.eventMirror && !this.eventMirror.hooked) {
      this.eventMirror.start(webContents, this.server);
    }
  }

  stop() {
    if (this.eventMirror) this.eventMirror.stop();
    if (this.server) this.server.stop();
    this.running = false;
    console.log('[RemoteBridge] 服务已停止');
  }

  /**
   * 生成配对 PIN 码（供前端 UI 调用显示）
   */
  generatePin() {
    return this.pairingManager?.generatePin();
  }

  /**
   * 获取连接状态
   */
  getStatus() {
    const os = require('os');
    const interfaces = os.networkInterfaces();
    const localIPs = [];
    for (const name of Object.keys(interfaces)) {
      for (const iface of interfaces[name]) {
        if (iface.family === 'IPv4' && !iface.internal) {
          localIPs.push(iface.address);
        }
      }
    }
    return {
      running: this.running,
      port: this.server?.port || 0,
      connectedClients: this.server?.authenticatedCount || 0,
      pairedDevices: this.deviceRegistry?.count || 0,
      localIPs,
    };
  }

  listDevices() {
    return this.deviceRegistry?.listDevices() || [];
  }

  revokeDevice(tokenPrefix) {
    return this.deviceRegistry?.revokeDevice(tokenPrefix) || false;
  }

  async _onMessage(ws, msg) {
    if (!msg.type) return;

    if (msg.type === 'command') {
      try {
        const result = await this.commandRouter.route(msg, ws, this.server);
        this.server.sendTo(ws, buildResponse(msg.id, true, result));
      } catch (err) {
        this.server.sendTo(ws, buildResponse(msg.id, false, null, err.message));
      }
    } else if (msg.type === 'ping') {
      this.server.sendTo(ws, { type: 'pong', serverTime: Date.now() });
    }
  }

  _getDefaultStorageDir() {
    // 尝试获取存储目录，与 storage-config.js 保持一致
    try {
      const storageConfig = require('../storage-config');
      if (storageConfig?.getBasePath) {
        return path.join(storageConfig.getBasePath(), 'remote');
      }
    } catch (e) { /* fallback */ }

    try {
      const { app } = require('electron');
      return path.join(app.getPath('userData'), 'remote');
    } catch (e) {
      return path.join(process.env.APPDATA || '.', 'remote');
    }
  }
}

// 导出单例
const instance = new RemoteBridge();
module.exports = instance;
