'use strict';

const http = require('http');
const path = require('path');
const fs = require('fs');
const os = require('os');
const WebSocket = require('ws');
const { buildResponse } = require('./protocol');

class BridgeWSServer {
  constructor() {
    this.httpServer = null;
    this.wss = null;
    this.clients = new Map(); // ws -> { token, deviceName, authenticated }
    this.port = 9876;
    this.onMessage = null;
    this.onDisconnect = null;
    this.onAutoAuth = null;
    this.maxClients = 5;
  }

  start(port = 9876) {
    this.port = port;

    // 创建 HTTP 服务器（处理静态文件请求）
    this.httpServer = http.createServer((req, res) => {
      this._handleHTTPRequest(req, res);
    });

    // WebSocket 使用 noServer 模式，手动路由 upgrade 事件
    // 避免 ws 库拦截或干扰普通 HTTP 请求
    this.wss = new WebSocket.Server({ noServer: true });

    this.httpServer.on('upgrade', (request, socket, head) => {
      // 只将有效的 WebSocket upgrade 请求交给 ws 处理
      const wss = this.wss;
      if (!wss) { socket.destroy(); return; }

      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request);
      });
    });

    // HTTP server 错误处理
    this.httpServer.on('error', (err) => {
      console.error('[BridgeWS] HTTP server error:', err.message);
    });

    this.wss.on('connection', (ws, req) => {
      // 连接数限制
      if (this.clients.size >= this.maxClients) {
        console.warn(`[BridgeWS] rejecting connection: max clients (${this.maxClients}) reached`);
        ws.close(1013, 'Too many connections');
        return;
      }

      // 从 URL 查询参数提取 token
      const url = new URL(req.url, `http://${req.headers.host}`);
      const token = url.searchParams.get('token');

      this.clients.set(ws, { token, deviceName: '', authenticated: false });

      // 如果 URL 带有 token，通知外部做自动认证（重连场景）
      if (token && this.onAutoAuth) {
        this.onAutoAuth(ws, token);
      }

      ws.on('message', (raw) => this._handleMessage(ws, raw));
      ws.on('close', () => this._handleDisconnect(ws));
      ws.on('error', (err) => {
        console.warn('[BridgeWS] client error:', err.message);
      });

      // 发送欢迎消息
      ws.send(JSON.stringify({ type: 'connected', serverTime: Date.now() }));
      console.log(`[BridgeWS] new connection from ${req.socket.remoteAddress}, token=${token ? 'yes' : 'no'}`);
    });

    this.wss.on('error', (err) => {
      console.error('[BridgeWS] server error:', err.message);
    });

    this.httpServer.listen(port, '0.0.0.0', () => {
      const ips = this._getLocalIPs();
      console.log(`[BridgeWS] HTTP + WS 服务已启动:`);
      console.log(`  本机访问: http://localhost:${port}`);
      ips.forEach(ip => console.log(`  局域网访问: http://${ip}:${port}`));
    });

    return this;
  }

  /**
   * 处理 HTTP 请求 — 静态文件服务
   */
  _handleHTTPRequest(req, res) {
    // 拒绝非 GET/HEAD 请求
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { 'Content-Type': 'text/plain' });
      res.end('Method Not Allowed');
      return;
    }

    // 拒绝带有 Upgrade 头的请求（这些应该走 upgrade 事件）
    if (req.headers.upgrade) {
      res.writeHead(426, { 'Content-Type': 'text/plain' });
      res.end('Upgrade Required');
      return;
    }

    const webDir = path.join(__dirname, 'web');

    // 解析 URL（去掉查询参数）
    let urlPath;
    try {
      urlPath = new URL(req.url, 'http://localhost').pathname;
    } catch (_) {
      urlPath = req.url.split('?')[0];
    }

    let filePath = urlPath === '/' ? '/index.html' : urlPath;
    // 防止路径遍历攻击
    filePath = path.normalize(filePath).replace(/^(\.\.[\/\\])+/, '');
    const fullPath = path.join(webDir, filePath);

    // 安全检查：确保路径在 webDir 内
    if (!fullPath.startsWith(webDir)) {
      res.writeHead(403);
      res.end('Forbidden');
      return;
    }

    const extMap = {
      '.html': 'text/html; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
      '.js': 'application/javascript; charset=utf-8',
      '.json': 'application/json; charset=utf-8',
      '.png': 'image/png',
      '.svg': 'image/svg+xml',
      '.ico': 'image/x-icon',
      '.woff2': 'font/woff2',
      '.woff': 'font/woff',
      '.ttf': 'font/ttf',
    };

    const ext = path.extname(fullPath);
    const contentType = extMap[ext] || 'application/octet-stream';

    fs.readFile(fullPath, (err, data) => {
      if (err) {
        if (err.code === 'ENOENT') {
          // SPA fallback: 未找到的路径返回 index.html
          fs.readFile(path.join(webDir, 'index.html'), (err2, data2) => {
            if (err2) {
              console.error('[BridgeWS] Failed to read index.html:', err2.message);
              res.writeHead(500, { 'Content-Type': 'text/plain' });
              res.end('Internal Server Error');
              return;
            }
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(data2);
          });
        } else {
          console.error('[BridgeWS] File read error:', err.message);
          res.writeHead(500, { 'Content-Type': 'text/plain' });
          res.end('Server Error');
        }
        return;
      }
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(data);
    });
  }

  /**
   * 获取本机所有局域网 IPv4 地址
   */
  _getLocalIPs() {
    const interfaces = os.networkInterfaces();
    const ips = [];
    for (const name of Object.keys(interfaces)) {
      for (const iface of interfaces[name]) {
        if (iface.family === 'IPv4' && !iface.internal) {
          ips.push(iface.address);
        }
      }
    }
    return ips;
  }

  stop() {
    if (this.wss) {
      for (const [ws] of this.clients) {
        try { ws.close(); } catch (_) { /* ignore */ }
      }
      this.clients.clear();
      this.wss.close();
      this.wss = null;
    }
    if (this.httpServer) {
      this.httpServer.close();
      this.httpServer = null;
    }
    console.log('[BridgeWS] server stopped');
  }

  _handleMessage(ws, raw) {
    if (this.onMessage) {
      try {
        const msg = JSON.parse(raw.toString('utf-8'));
        this.onMessage(ws, msg);
      } catch (e) {
        ws.send(JSON.stringify(buildResponse(null, false, null, 'Invalid JSON')));
      }
    }
  }

  _handleDisconnect(ws) {
    const client = this.clients.get(ws);
    if (client) {
      console.log(`[BridgeWS] client disconnected: ${client.deviceName || 'unknown'}`);
    }
    this.clients.delete(ws);
    if (this.onDisconnect) this.onDisconnect(ws);
  }

  /**
   * 标记客户端为已认证
   */
  authenticateClient(ws, token, deviceName) {
    const client = this.clients.get(ws);
    if (client) {
      client.authenticated = true;
      client.token = token;
      client.deviceName = deviceName;
    }
  }

  /**
   * 向所有已认证的客户端广播消息
   */
  broadcast(message) {
    const data = JSON.stringify(message);
    for (const [ws, client] of this.clients) {
      if (client.authenticated && ws.readyState === WebSocket.OPEN) {
        try { ws.send(data); } catch (_) { /* ignore send errors */ }
      }
    }
  }

  /**
   * 向指定客户端发送消息
   */
  sendTo(ws, message) {
    if (ws.readyState === WebSocket.OPEN) {
      try { ws.send(JSON.stringify(message)); } catch (_) { /* ignore */ }
    }
  }

  /**
   * 获取已认证的客户端数量
   */
  get authenticatedCount() {
    let count = 0;
    for (const [, client] of this.clients) {
      if (client.authenticated) count++;
    }
    return count;
  }
}

module.exports = BridgeWSServer;
