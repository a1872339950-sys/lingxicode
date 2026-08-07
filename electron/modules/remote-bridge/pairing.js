'use strict';

const crypto = require('crypto');

class PairingManager {
  constructor(deviceRegistry) {
    this.registry = deviceRegistry;
    this.pendingPins = new Map(); // pin -> { createdAt, expiresAt }
    this.PIN_TTL = 5 * 60 * 1000; // 5 分钟有效期
    this.PIN_LENGTH = 6;
  }

  /**
   * 生成一个新的 PIN 码
   */
  generatePin() {
    // 清理过期 PIN
    this._cleanExpired();

    const pin = crypto.randomInt(0, 1000000).toString().padStart(this.PIN_LENGTH, '0');
    this.pendingPins.set(pin, {
      createdAt: Date.now(),
      expiresAt: Date.now() + this.PIN_TTL,
    });
    return pin;
  }

  /**
   * 验证 PIN 并完成设备配对
   * @returns  success: boolean, token?: string, error?: string 
   */
  verifyPin(pin, deviceName) {
    this._cleanExpired();

    const pending = this.pendingPins.get(pin);
    if (!pending) {
      return { success: false, error: 'PIN 无效或已过期' };
    }

    // PIN 验证成功，注册设备
    this.pendingPins.delete(pin);
    const token = this.registry.registerDevice(deviceName);

    return {
      success: true,
      token,
      deviceName: deviceName || 'Unknown Device',
    };
  }

  /**
   * 验证已有 token（已配对设备的后续连接）
   */
  verifyToken(token) {
    if (this.registry.isValidToken(token)) {
      this.registry.touchDevice(token);
      const device = this.registry.devices.get(token);
      return { success: true, deviceName: device?.deviceName || '' };
    }
    return { success: false, error: 'Token 无效，请重新配对' };
  }

  /**
   * 清理过期的 PIN
   */
  _cleanExpired() {
    const now = Date.now();
    for (const [pin, info] of this.pendingPins) {
      if (info.expiresAt <= now) {
        this.pendingPins.delete(pin);
      }
    }
  }
}

module.exports = PairingManager;
