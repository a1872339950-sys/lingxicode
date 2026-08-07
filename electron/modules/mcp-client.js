const { spawn } = require('child_process')

class StdioMcpClient {
  constructor(config = {}) {
    this.command = config.command || 'node'
    this.args = Array.isArray(config.args) ? config.args : []
    this.cwd = config.cwd || undefined
    this.env = config.env || undefined
    this.timeoutMs = Math.max(3000, Number(config.timeoutMs || 30000))
    this.name = config.name || 'mcp'
    this.child = null
    this.nextId = 1
    this.pending = new Map()
    this.buffer = ''
    this.stderrTail = ''
    this.initialized = false
  }

  async sendNotification(method, params = {}) {
    await this.ensureStarted()
    try {
      this.child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method, params })}\n`, 'utf8')
    } catch (error) {
      throw new Error(`${this.name} failed to send ${method}: ${error.message}`)
    }
  }


  async ensureStarted() {
    if (this.child && !this.child.killed) return
    this.child = spawn(this.command, this.args, {
      cwd: this.cwd,
      env: this.env ? { ...process.env, ...this.env } : process.env,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true
    })
    this.child.unref?.() // 不阻止父进程退出
    this.child.stdout.setEncoding('utf8')
    this.child.stderr.setEncoding('utf8')
    this.child.stdout.on('data', chunk => this.handleStdout(chunk))
    this.child.stderr.on('data', chunk => {
      this.stderrTail = `${this.stderrTail}${chunk}`.slice(-4000)
    })
    this.child.on('error', error => {
      const wrapped = new Error(`${this.name} failed to start: ${error.message}`)
      wrapped.cause = error
      for (const item of this.pending.values()) {
        clearTimeout(item.timer)
        item.reject(wrapped)
      }
      this.pending.clear()
      this.child = null
      this.initialized = false
    })
    this.child.on('exit', (code, signal) => {
      const error = new Error(`${this.name} exited: code=${code} signal=${signal || ''}`.trim())
      for (const item of this.pending.values()) {
        clearTimeout(item.timer)
        item.reject(error)
      }
      this.pending.clear()
      this.child = null
      this.initialized = false
    })
  }

  handleStdout(chunk) {
    this.buffer += chunk
    let newlineIndex = this.buffer.indexOf('\n')
    while (newlineIndex >= 0) {
      const line = this.buffer.slice(0, newlineIndex).trim()
      this.buffer = this.buffer.slice(newlineIndex + 1)
      newlineIndex = this.buffer.indexOf('\n')
      if (!line) continue
      let message = null
      try {
        message = JSON.parse(line)
      } catch {
        continue
      }
      if (message.id === undefined || message.id === null) continue
      const pending = this.pending.get(message.id)
      if (!pending) continue
      this.pending.delete(message.id)
      clearTimeout(pending.timer)
      if (message.error) {
        const error = new Error(message.error.message || 'MCP request failed')
        error.data = message.error.data
        pending.reject(error)
      } else {
        pending.resolve(message.result)
      }
    }
  }

  async request(method, params = {}, options = {}) {
    await this.ensureStarted()
    const id = this.nextId++
    const timeoutMs = Math.max(1000, Number(options.timeoutMs || this.timeoutMs))
    const payload = { jsonrpc: '2.0', id, method, params }
    return await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`${this.name} ${method} timed out after ${timeoutMs}ms`))
      }, timeoutMs)
      this.pending.set(id, { resolve, reject, timer })
      try {
        this.child.stdin.write(`${JSON.stringify(payload)}\n`, 'utf8')
      } catch (error) {
        clearTimeout(timer)
        this.pending.delete(id)
        reject(error)
      }
    })
  }

  async initialize() {
    await this.ensureStarted()
    if (this.initialized) return
    await this.request('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'lingxi', version: '1.0.0' }
    }, { timeoutMs: this.timeoutMs })
    this.initialized = true
    await this.sendNotification('notifications/initialized')
  }

  async listTools() {
    await this.initialize()
    const result = await this.request('tools/list', {})
    return Array.isArray(result?.tools) ? result.tools : []
  }

  async callTool(name, args = {}, options = {}) {
    await this.initialize()
    return await this.request('tools/call', {
      name,
      arguments: args && typeof args === 'object' ? args : {}
    }, options)
  }

  stop() {
    if (!this.child) return
    try {
      this.child.kill()
    } catch { /* 进程可能已退出 */ }
  }
}

class HttpMcpClient {
  constructor(config = {}) {
    this.url = String(config.url || '').replace(/\/+$/, '')
    this.headers = config.headers && typeof config.headers === 'object' ? { ...config.headers } : {}
    if (config.bearerToken) {
      this.headers['Authorization'] = `Bearer ${config.bearerToken}`
    }
    this.timeoutMs = Math.max(3000, Number(config.timeoutMs || 30000))
    this.name = config.name || 'mcp-http'
    this.nextId = 1
    this.pending = new Map()
    this.initialized = false
    this._transport = null // 'streamable' | 'sse' | null
    this._sessionId = null
    this._sseResponse = null
    this._sseBuffer = ''
    this._postEndpoint = null
  }

  async sendRequest(method, params = {}, options = {}) {
    const id = this.nextId++
    const timeoutMs = Math.max(1000, Number(options.timeoutMs || this.timeoutMs))
    const payload = { jsonrpc: '2.0', id, method, params }

    return await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`${this.name} ${method} timed out after ${timeoutMs}ms`))
      }, timeoutMs)
      this.pending.set(id, { resolve, reject, timer })

      this.doPost(payload).then((response) => {
        if (response === 'sse') return
        clearTimeout(timer)
        this.pending.delete(id)
        if (response && typeof response === 'object' && 'error' in response) {
          const error = new Error(response.error.message || 'MCP request failed')
          error.data = response.error.data
          reject(error)
        } else {
          resolve(response)
        }
      }).catch((err) => {
        clearTimeout(timer)
        this.pending.delete(id)
        reject(err)
      })
    })
  }

  async doPost(payload) {
    if (this._transport === 'sse') {
      return this.doPostSse(payload)
    }
    try {
      const result = await this.doStreamablePost(payload)
      if (this._transport === null) this._transport = 'streamable'
      return result
    } catch (err) {
      if (this._transport === null) {
        this._transport = 'sse'
        this.startSse()
        const start = Date.now()
        while (!this._postEndpoint && Date.now() - start < 5000) {
          await new Promise(r => setTimeout(r, 100))
        }
        if (!this._postEndpoint) throw new Error(`${this.name}: both Streamable HTTP and legacy SSE failed`)
        return this.doPostSse(payload)
      }
      throw err
    }
  }

  doStreamablePost(payload) {
    const { net } = require('electron')
    const body = JSON.stringify(payload)

    return new Promise((resolve, reject) => {
      const request = net.request({
        method: 'POST',
        url: this.url,
        redirect: 'follow'
      })
      for (const [key, value] of Object.entries(this.headers)) {
        request.setHeader(key, value)
      }
      if (this._sessionId) request.setHeader('Mcp-Session-Id', this._sessionId)
      if (this.initialized) request.setHeader('MCP-Protocol-Version', '2024-11-05')
      request.setHeader('Content-Type', 'application/json')
      request.setHeader('Accept', 'application/json, text/event-stream')

      request.on('response', (response) => {
        const statusCode = response.statusCode
        const contentType = (response.headers['content-type'] || '').toString().toLowerCase()
        const rawSessionId = response.headers['mcp-session-id'] || response.headers['Mcp-Session-Id']
        const sessionId = Array.isArray(rawSessionId) ? rawSessionId[0] : rawSessionId
        if (sessionId && !this._sessionId) {
          this._sessionId = sessionId
        }

        if (statusCode === 202) {
          resolve('sse')
          return
        }
        if (statusCode >= 400) {
          const chunks = []
          response.on('data', (chunk) => chunks.push(chunk))
          response.on('end', () => {
            const raw = Buffer.concat(chunks).toString('utf8')
            let errObj
            try { errObj = JSON.parse(raw) } catch { errObj = null }
            if (errObj && errObj.error) {
              resolve({ error: errObj.error })
            } else {
              reject(new Error(`${this.name} HTTP ${statusCode}: ${raw.slice(0, 500)}`))
            }
          })
          return
        }
        if (contentType.includes('text/event-stream')) {
          this._streamableSseBuffer = this._streamableSseBuffer || ''
          this._streamableSseEventName = ''
          response.on('data', (chunk) => {
            this._streamableSseBuffer += chunk.toString('utf8')
            let newlineIndex
            while ((newlineIndex = this._streamableSseBuffer.indexOf('\n')) >= 0) {
              const line = this._streamableSseBuffer.slice(0, newlineIndex).trim()
              this._streamableSseBuffer = this._streamableSseBuffer.slice(newlineIndex + 1)
              if (!line || line.startsWith(':')) continue
              if (line.startsWith('event:')) {
                this._streamableSseEventName = line.slice(6).trim()
                continue
              }
              if (line.startsWith('data:')) {
                const data = line.slice(5).trim()
                this.handleStreamableSseData(data)
                this._streamableSseEventName = ''
                continue
              }
            }
          })
          response.on('end', () => {
            this._streamableSseBuffer = ''
          })
          resolve('sse')
          return
        }
        // JSON response
        const chunks = []
        response.on('data', (chunk) => chunks.push(chunk))
        response.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf8')
          if (!raw.trim()) { resolve('sse'); return }
          try { resolve(JSON.parse(raw)) } catch { resolve('sse') }
        })
      })
      request.on('error', reject)
      request.write(body)
      request.end()
    })
  }

  handleStreamableSseData(data) {
    let message = null
    try { message = JSON.parse(data) } catch { return }
    if (!message || message.id === undefined || message.id === null) return
    const pending = this.pending.get(message.id)
    if (!pending) return
    this.pending.delete(message.id)
    clearTimeout(pending.timer)
    if (message.error) {
      const error = new Error(message.error.message || 'MCP request failed')
      error.data = message.error.data
      pending.reject(error)
    } else {
      pending.resolve(message.result)
    }
  }

  startSse() {
    if (this._sseResponse) return
    const sseUrl = this._postEndpoint
      ? (this._postEndpoint.startsWith('http') ? this._postEndpoint : `${this.url}${this._postEndpoint}`)
      : `${this.url}/sse`
    const { net } = require('electron')
    const request = net.request({ method: 'GET', url: sseUrl, redirect: 'follow' })
    for (const [key, value] of Object.entries(this.headers)) {
      request.setHeader(key, value)
    }
    request.setHeader('Accept', 'text/event-stream')
    request.setHeader('Cache-Control', 'no-cache')
    request.on('response', (response) => {
      this._sseResponse = response
      response.on('data', (chunk) => {
        this._sseBuffer += chunk.toString('utf8')
        let newlineIndex
        while ((newlineIndex = this._sseBuffer.indexOf('\n')) >= 0) {
          const line = this._sseBuffer.slice(0, newlineIndex).trim()
          this._sseBuffer = this._sseBuffer.slice(newlineIndex + 1)
          if (!line || line.startsWith(':')) continue
          if (line.startsWith('event:')) {
            this._sseEventName = line.slice(6).trim()
            continue
          }
          if (line.startsWith('data:')) {
            const data = line.slice(5).trim()
            this.handleLegacySseMessage(this._sseEventName || 'message', data)
            this._sseEventName = ''
            continue
          }
        }
      })
      response.on('end', () => {
        this._sseResponse = null
        this._sseBuffer = ''
        const error = new Error(`${this.name} SSE connection closed`)
        for (const item of this.pending.values()) {
          clearTimeout(item.timer)
          item.reject(error)
        }
        this.pending.clear()
        this.initialized = false
      })
    })
    request.on('error', () => {})
    request.end()
  }

  handleLegacySseMessage(eventName, data) {
    if (eventName === 'endpoint' && data) {
      this._postEndpoint = data
      return
    }
    if (eventName === 'ping') return
    let message = null
    try { message = JSON.parse(data) } catch { return }
    if (!message || message.id === undefined || message.id === null) return
    const pending = this.pending.get(message.id)
    if (!pending) return
    this.pending.delete(message.id)
    clearTimeout(pending.timer)
    if (message.error) {
      const error = new Error(message.error.message || 'MCP request failed')
      error.data = message.error.data
      pending.reject(error)
    } else {
      pending.resolve(message.result)
    }
  }

  doPostSse(payload) {
    let postUrl = this._postEndpoint
      ? (this._postEndpoint.startsWith('http') ? this._postEndpoint : `${this.url}${this._postEndpoint}`)
      : `${this.url}/message`
    const url = new URL(postUrl)
    const isHttps = url.protocol === 'https:'
    const transport = isHttps ? require('https') : require('http')
    const body = JSON.stringify(payload)

    return new Promise((resolve, reject) => {
      const req = transport.request({
        hostname: url.hostname,
        port: url.port || (isHttps ? 443 : 80),
        path: url.pathname + url.search,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json, text/event-stream',
          'Content-Length': Buffer.byteLength(body),
          ...this.headers
        }
      }, (res) => {
        const chunks = []
        res.on('data', (chunk) => chunks.push(chunk))
        res.on('end', () => {
          if (res.statusCode >= 400) {
            const raw = Buffer.concat(chunks).toString('utf8')
            let errObj
            try { errObj = JSON.parse(raw) } catch { errObj = null }
            if (errObj && errObj.error) {
              resolve({ error: errObj.error })
            } else {
              reject(new Error(`${this.name} HTTP ${res.statusCode}: ${raw.slice(0, 500)}`))
            }
            return
          }
          if (res.statusCode === 202) {
            resolve('sse')
            return
          }
          const raw = Buffer.concat(chunks).toString('utf8')
          if (!raw.trim()) { resolve('sse'); return }
          try { resolve(JSON.parse(raw)) } catch { resolve('sse') }
        })
      })
      req.on('error', reject)
      req.setTimeout(this.timeoutMs, () => { req.destroy(); reject(new Error('HTTP request timed out')) })
      req.write(body)
      req.end()
    })
  }

  async initialize() {
    if (this.initialized) return
    // Try Streamable HTTP first (direct POST to URL)
    await this.sendRequest('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'lingxi', version: '1.0.0' }
    }, { timeoutMs: this.timeoutMs })
    if (this._transport === 'sse' && !this._postEndpoint) {
      const start = Date.now()
      while (!this._postEndpoint && Date.now() - start < 5000) {
        await new Promise(r => setTimeout(r, 100))
      }
      if (!this._postEndpoint) throw new Error(`${this.name}: failed to establish SSE connection`)
    }
    this.initialized = true
  }

  async listTools() {
    await this.initialize()
    const result = await this.sendRequest('tools/list', {})
    return Array.isArray(result?.tools) ? result.tools : []
  }

  async callTool(name, args = {}, options = {}) {
    await this.initialize()
    return await this.sendRequest('tools/call', {
      name,
      arguments: args && typeof args === 'object' ? args : {}
    }, options)
  }

  stop() {
    if (this._sseResponse) {
      try { this._sseResponse.destroy() } catch {}
      this._sseResponse = null
    }
    for (const item of this.pending.values()) {
      clearTimeout(item.timer)
      item.reject(new Error(`${this.name} stopped`))
    }
    this.pending.clear()
    this.initialized = false
    this._transport = null
    this._sessionId = null
    this._postEndpoint = null
  }
}

module.exports = {
  StdioMcpClient,
  HttpMcpClient
}
