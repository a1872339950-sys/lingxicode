'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

class DeviceRegistry {
  constructor(storageDir) {
    this.storageDir = storageDir;
    this.filePath = path.join(storageDir, 'remote-devices.json');
    this.devices = new Map(); // token -> device info
    this._load();
  }

  _load() {
    try {
      if (fs.existsSync(this.filePath)) {
        const data = JSON.parse(fs.readFileSync(this.filePath, 'utf-8'));
        if (Array.isArray(data.devices)) {
          for (const device of data.devices) {
            this.devices.set(device.token, device);
          }
        }
      }
    } catch (e) {
      this.devices = new Map();
    }
  }

  _save() {
    try {
      if (!fs.existsSync(this.storageDir)) {
        fs.mkdirSync(this.storageDir, { recursive: true });
      }
      const data = {
        devices: Array.from(this.devices.values()),
        updatedAt: Date.now(),
      };
      fs.writeFileSync(this.filePath, JSON.stringify(data, null, 2), 'utf-8');
    } catch (e) {
      // 持久化失败不阻断功能
    }
  }

  /**
   * 注册新设备，返回 session token
   */
  registerDevice(deviceName) {
    const token = crypto.randomBytes(32).toString('hex');
    const device = {
      token,
      deviceName: deviceName || 'Unknown Device',
      pairedAt: Date.now(),
      lastConnectedAt: Date.now(),
    };
    this.devices.set(token, device);
    this._save();
    return token;
  }

  /**
   * 验证 token 是否有效
   */
  isValidToken(token) {
    return this.devices.has(token);
  }

  /**
   * 更新设备最后连接时间
   */
  touchDevice(token) {
    const device = this.devices.get(token);
    if (device) {
      device.lastConnectedAt = Date.now();
      this._save();
    }
  }

  /**
   * 撤销设备授权（支持完整 token 或前缀匹配）
   */
  revokeDevice(tokenOrPrefix) {
    // 先尝试精确匹配
    if (this.devices.has(tokenOrPrefix)) {
      this.devices.delete(tokenOrPrefix);
      this._save();
      return true;
    }
    // 前缀匹配
    for (const [fullToken, device] of this.devices) {
      if (fullToken.startsWith(tokenOrPrefix) || device.token?.startsWith(tokenOrPrefix)) {
        this.devices.delete(fullToken);
        this._save();
        return true;
      }
    }
    return false;
  }

  /**
   * 获取所有已配对设备列表（不含 token 明文）
   */
  listDevices() {
    return Array.from(this.devices.values()).map(d => ({
      deviceName: d.deviceName,
      pairedAt: d.pairedAt,
      lastConnectedAt: d.lastConnectedAt,
      tokenPrefix: d.token.slice(0, 16) + '...',
    }));
  }

  /**
   * 获取设备数量
   */
  get count() {
    return this.devices.size;
  }
}

module.exports = DeviceRegistry;
