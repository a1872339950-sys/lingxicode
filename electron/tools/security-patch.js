/**
 * 安全补丁模块
 * 修复高危安全漏洞
 */

const dns = require('dns').promises
const { URL } = require('url')

/**
 * URL安全验证器
 */
class URLValidator {
  constructor() {
    // 私有IP地址段
    this.privateIPRanges = [
      // IPv4 私有地址
      { start: '10.0.0.0', end: '10.255.255.255' },
      { start: '172.16.0.0', end: '172.31.255.255' },
      { start: '192.168.0.0', end: '192.168.255.255' },
      { start: '127.0.0.0', end: '127.255.255.255' },
      { start: '169.254.0.0', end: '169.254.255.255' },
      { start: '0.0.0.0', end: '0.255.255.255' },
      // IPv6 私有地址
      { start: '::1', end: '::1' },
      { start: 'fc00::', end: 'fdff:ffff:ffff:ffff:ffff:ffff:ffff:ffff' },
      { start: 'fe80::', end: 'febf:ffff:ffff:ffff:ffff:ffff:ffff:ffff' }
    ]

    // 禁止的主机名
    this.blockedHosts = [
      'localhost', 'localhost.localdomain',
      'ip6-localhost', 'ip6-loopback',
      'metadata.google.internal',  // GCP元数据服务
      '169.254.169.254'  // 云元数据服务
    ]

    // 允许的协议
    this.allowedProtocols = ['http:', 'https:']
  }

  /**
   * 验证URL安全性
   * @param {string} url - 要验证的URL
   * @param {object} options - 配置选项
   * @returns {object} { valid, error, parsedUrl }
   */
  async validate(url, options = {}) {
    const {
      allowPrivateIP = false,  // 是否允许私有IP
      allowLocalhost = false,  // 是否允许localhost
      checkDNS = true,         // 是否检查DNS重绑定
      timeout = 5000           // DNS解析超时
    } = options

    // 1. 基本格式验证
    let parsedUrl
    try {
      parsedUrl = new URL(url)
    } catch (e) {
      return { valid: false, error: '无效的URL格式' }
    }

    // 2. 协议检查
    if (!this.allowedProtocols.includes(parsedUrl.protocol)) {
      return { 
        valid: false, 
        error: `禁止的协议: ${parsedUrl.protocol}，只允许 HTTP/HTTPS` 
      }
    }

    const hostname = parsedUrl.hostname.toLowerCase()

    // 3. 检查禁止的主机名
    if (this.blockedHosts.includes(hostname)) {
      if (!allowLocalhost) {
        return { valid: false, error: '禁止访问本地地址' }
      }
    }

    // 4. 检查是否为IP地址
    const ipInfo = this._parseIP(hostname)
    if (ipInfo.isIP) {
      if (!allowPrivateIP && ipInfo.isPrivate) {
        return { valid: false, error: '禁止访问私有IP地址' }
      }
    }

    // 5. DNS重绑定攻击检查
    if (checkDNS && !ipInfo.isIP) {
      try {
        const addresses = await Promise.race([
          dns.resolve4(hostname),
          new Promise((_, reject) => 
            setTimeout(() => reject(new Error('DNS解析超时')), timeout)
          )
        ])

        if (addresses && addresses.length > 0) {
          for (const addr of addresses) {
            if (this._isPrivateIP(addr) && !allowPrivateIP) {
              return { 
                valid: false, 
                error: '域名解析到私有IP地址，禁止访问' 
              }
            }
          }
        }
      } catch (e) {
        console.warn('[URLValidator] DNS解析失败:', e.message)
        // DNS解析失败时，仍然允许访问（可能是临时网络问题）
      }
    }

    return { valid: true, parsedUrl }
  }

  /**
   * 解析IP地址信息
   */
  _parseIP(hostname) {
    // IPv4
    const ipv4Match = hostname.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
    if (ipv4Match) {
      const octets = ipv4Match.slice(1).map(Number)
      const isIP = octets.every(o => o >= 0 && o <= 255)
      return {
        isIP,
        isPrivate: isIP && this._isPrivateIPv4(octets),
        version: 4
      }
    }

    // IPv6 (简化检查)
    if (hostname.includes(':')) {
      return {
        isIP: true,
        isPrivate: this._isPrivateIPv6(hostname),
        version: 6
      }
    }

    return { isIP: false, isPrivate: false }
  }

  /**
   * 检查是否为私有IPv4
   */
  _isPrivateIPv4(octets) {
    const [a, b] = octets
    if (a === 10) return true
    if (a === 172 && b >= 16 && b <= 31) return true
    if (a === 192 && b === 168) return true
    if (a === 127) return true
    if (a === 169 && b === 254) return true
    if (a === 0) return true
    return false
  }

  /**
   * 检查是否为私有IPv6
   */
  _isPrivateIPv6(hostname) {
    const h = hostname.toLowerCase()
    if (h === '::1') return true
    if (h.startsWith('fc') || h.startsWith('fd')) return true
    if (h.startsWith('fe8') || h.startsWith('fe9') || 
        h.startsWith('fea') || h.startsWith('feb')) return true
    return false
  }

  /**
   * 检查IP是否为私有地址
   */
  _isPrivateIP(ip) {
    // IPv4
    const ipv4Match = ip.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
    if (ipv4Match) {
      const octets = ipv4Match.slice(1).map(Number)
      return this._isPrivateIPv4(octets)
    }
    
    // IPv6
    return this._isPrivateIPv6(ip)
  }
}

/**
 * 敏感数据检测器
 */
class SensitiveDataDetector {
  constructor() {
    this.patterns = [
      // 密码
      { name: 'password', pattern: /(?:password|passwd|pwd)\s*[=:]\s*['"]?[^'"\s,;]+['"]?/gi, mask: '***PASSWORD***' },
      // API密钥
      { name: 'apiKey', pattern: /(?:api[_-]?key|apikey)\s*[=:]\s*['"]?[^'"\s,;]+['"]?/gi, mask: '***API_KEY***' },
      // Token
      { name: 'token', pattern: /(?:access[_-]?token|auth[_-]?token|bearer)\s*[=:]\s*['"]?[^'"\s,;]+['"]?/gi, mask: '***TOKEN***' },
      // 私钥
      { name: 'privateKey', pattern: /(?:private[_-]?key|secret[_-]?key)\s*[=:]\s*['"]?[^'"\s,;]+['"]?/gi, mask: '***SECRET_KEY***' },
      // 连接字符串
      { name: 'connectionString', pattern: /(?:connection[_-]?string|connstr)\s*[=:]\s*['"]?[^'"\s,;]+['"]?/gi, mask: '***CONN_STRING***' },
      // AWS密钥
      { name: 'awsKey', pattern: /(?:AKIA|ABIA|ACCA|ASIA)[0-9A-Z]{16}/g, mask: '***AWS_KEY***' },
      // JWT
      { name: 'jwt', pattern: /eyJ[a-zA-Z0-9_-]*\.eyJ[a-zA-Z0-9_-]*\.[a-zA-Z0-9_-]*/g, mask: '***JWT***' }
    ]
  }

  /**
   * 检测并遮蔽敏感数据
   */
  detectAndMask(text) {
    let result = text
    const detected = []

    for (const { name, pattern, mask } of this.patterns) {
      const matches = text.match(pattern)
      if (matches) {
        matches.forEach(match => {
          detected.push({ type: name, sample: match.substring(0, 20) + '...' })
          result = result.replace(new RegExp(this._escapeRegex(match), 'g'), mask)
        })
      }
    }

    return { masked: result, detected }
  }

  /**
   * 检查是否包含敏感数据
   */
  containsSensitive(text) {
    for (const { pattern } of this.patterns) {
      if (pattern.test(text)) {
        return true
      }
    }
    return false
  }

  _escapeRegex(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  }
}

/**
 * 路径安全验证器
 */
class PathValidator {
  constructor() {
    this.allowedBasePaths = []
  }

  /**
   * 设置允许的基础路径
   */
  setAllowedBasePaths(paths) {
    this.allowedBasePaths = paths.map(p => this._normalizePath(p))
  }

  /**
   * 验证路径安全性
   */
  validate(targetPath, options = {}) {
    const { mustExist = false, allowCreate = true } = options

    try {
      // 规范化路径
      const normalizedPath = this._normalizePath(targetPath)

      // 检查路径遍历
      if (normalizedPath.includes('..')) {
        return { valid: false, error: '路径包含非法的遍历字符' }
      }

      // 检查是否在允许的基础路径内
      if (this.allowedBasePaths.length > 0) {
        const isAllowed = this.allowedBasePaths.some(base => 
          normalizedPath.startsWith(base)
        )
        if (!isAllowed) {
          return { valid: false, error: '路径不在允许的范围内' }
        }
      }

      // 检查路径是否存在
      const fs = require('fs')
      if (mustExist && !fs.existsSync(normalizedPath)) {
        return { valid: false, error: '路径不存在' }
      }

      return { valid: true, path: normalizedPath }
    } catch (e) {
      return { valid: false, error: e.message }
    }
  }

  _normalizePath(p) {
    const path = require('path')
    return path.resolve(p).toLowerCase()
  }
}

/**
 * 输入验证器
 */
class InputValidator {
  /**
   * 验证字符串输入
   */
  static validateString(value, options = {}) {
    const {
      minLength = 0,
      maxLength = Infinity,
      pattern = null,
      name = 'value'
    } = options

    if (typeof value !== 'string') {
      return { valid: false, error: `${name} 必须是字符串` }
    }

    if (value.length < minLength) {
      return { valid: false, error: `${name} 长度不能小于 ${minLength}` }
    }

    if (value.length > maxLength) {
      return { valid: false, error: `${name} 长度不能超过 ${maxLength}` }
    }

    if (pattern && !pattern.test(value)) {
      return { valid: false, error: `${name} 格式不正确` }
    }

    return { valid: true, value }
  }

  /**
   * 验证UUID格式
   */
  static validateUUID(value) {
    const uuidRegex = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i
    if (!uuidRegex.test(value)) {
      return { valid: false, error: '无效的UUID格式' }
    }
    return { valid: true, value }
  }

  /**
   * 清理用户输入
   */
  static sanitize(text) {
    if (typeof text !== 'string') return ''
    
    // 移除控制字符
    let result = text.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
    
    // 移除不可见的Unicode字符
    result = result.replace(/[\u200B-\u200D\uFEFF]/g, '')
    
    return result
  }

  /**
   * 截断文本
   */
  static truncate(text, maxLength, suffix = '...') {
    if (text.length <= maxLength) return text
    return text.substring(0, maxLength - suffix.length) + suffix
  }
}

/**
 * 响应限制器
 */
class ResponseLimiter {
  constructor(options = {}) {
    this.maxSize = options.maxSize || 10 * 1024 * 1024  // 10MB
    this.maxRedirects = options.maxRedirects || 5
    this.timeout = options.timeout || 30000
  }

  /**
   * 创建带限制的HTTP请求
   */
  createLimitedRequest(url, options = {}) {
    const http = require('http')
    const https = require('https')
    const { URL } = require('url')

    const parsedUrl = new URL(url)
    const client = parsedUrl.protocol === 'https:' ? https : http

    return new Promise((resolve, reject) => {
      let data = ''
      let dataSize = 0
      let redirectCount = options.redirectCount || 0

      const req = client.get(url, {
        timeout: this.timeout,
        headers: options.headers || {
          'User-Agent': 'Mozilla/5.0',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
        }
      }, (res) => {
        // 处理重定向
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          if (redirectCount >= this.maxRedirects) {
            reject(new Error('重定向次数过多'))
            return
          }
          this.createLimitedRequest(res.headers.location, { ...options, redirectCount: redirectCount + 1 })
            .then(resolve)
            .catch(reject)
          return
        }

        res.on('data', chunk => {
          dataSize += chunk.length
          if (dataSize > this.maxSize) {
            req.destroy()
            reject(new Error(`响应大小超过限制 (${this.maxSize / 1024 / 1024}MB)`))
            return
          }
          data += chunk
        })

        res.on('end', () => resolve(data))
      })

      req.on('error', reject)
      req.on('timeout', () => {
        req.destroy()
        reject(new Error('请求超时'))
      })
    })
  }
}

// 导出安全模块
module.exports = {
  URLValidator,
  SensitiveDataDetector,
  PathValidator,
  InputValidator,
  ResponseLimiter
}