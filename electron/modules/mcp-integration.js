const fs = require('fs')
const path = require('path')
const { StdioMcpClient, HttpMcpClient } = require('./mcp-client')
const projects = require('./projects')

const APP_ROOT = path.resolve(__dirname, '..', '..')
const MCP_CONFIG_PATH = path.join(APP_ROOT, 'config', 'mcp-servers.json')
const AIDEV_PROTOTYPE_SERVER = String(process.env.LINGXI_AIDEV_MCP_SERVER || '').trim()
function getDefaultNodeCommand() {
  const candidates = [
    process.env.LINGXI_NODE_PATH,
    process.env.npm_node_execpath
  ]
  if (/^node(?:\.exe)?$/i.test(path.basename(process.execPath || ''))) {
    candidates.push(process.execPath)
  }
  candidates.push('node')
  return candidates.find(Boolean)
}

const NODE_COMMAND = getDefaultNodeCommand()
const DEFAULT_SERVER_ID = 'aidev-prototype'
const clients = new Map()

function isProtectedBuiltInId(id) {
  return !!AIDEV_PROTOTYPE_SERVER && id === DEFAULT_SERVER_ID
}

function normalizeRoot(projectPath = '') {
  return path.resolve(projectPath || process.cwd())
}

function getProjectPath(projectId = '', fallbackPath = '') {
  if (fallbackPath) return normalizeRoot(fallbackPath)
  const instance = projectId ? projects.getProjectInstance(projectId) : null
  return normalizeRoot(instance?.projectPath || process.cwd())
}

function replacePlaceholders(value, rootPath) {
  if (typeof value !== 'string') return value
  return value
    .replace(/\{projectPath\}/g, rootPath)
    .replace(/\{rootPath\}/g, rootPath)
    .replace(/\{appRoot\}/g, APP_ROOT)
}

function resolveBearerToken(envName) {
  if (!envName) return ''
  const direct = process.env[envName]
  if (direct) return direct
  const normalized = envName.replace(/[^A-Za-z0-9_]/g, '_').toUpperCase()
  const fallbackKeys = [
    normalized,
    `${normalized}_TOKEN`,
    `${normalized}_API_KEY`,
    `${normalized}_SECRET`,
    `MCP_${normalized}`
  ]
  for (const key of fallbackKeys) {
    if (key !== envName && process.env[key]) return process.env[key]
  }
  return ''
}

function resolveHeaders(headerEnv = {}, extraHeaders = {}) {
  const headers = {}
  if (headerEnv && typeof headerEnv === 'object') {
    for (const [headerKey, envName] of Object.entries(headerEnv)) {
      if (!headerKey || !envName) continue
      const direct = process.env[envName]
      if (direct) { headers[headerKey] = direct; continue }
      const normalized = String(envName).replace(/[^A-Za-z0-9_]/g, '_').toUpperCase()
      for (const suffix of ['', '_TOKEN', '_API_KEY', '_SECRET', '_VALUE']) {
        const candidate = process.env[`${normalized}${suffix}`]
        if (candidate) { headers[headerKey] = candidate; break }
      }
    }
  }
  if (extraHeaders && typeof extraHeaders === 'object') {
    for (const [key, value] of Object.entries(extraHeaders)) {
      if (key && value) headers[key] = value
    }
  }
  return headers
}

function loadConfiguredServers(rootPath) {
  if (!fs.existsSync(MCP_CONFIG_PATH)) return []
  try {
    const list = readConfiguredServerEntries()
    return list
      .filter(item => item && item.enabled !== false && item.id)
      .map(item => {
        const type = item.type || 'stdio'
        const base = {
          id: String(item.id),
          name: item.name || item.id,
          type,
          timeoutMs: Number(item.timeoutMs || item.timeout_ms || 45000),
          description: item.description || 'External MCP server',
          source: 'config'
        }
        if (type === 'http') {
          return {
            ...base,
            url: replacePlaceholders(item.url || '', rootPath),
            headers: resolveHeaders(item.headerEnv, item.headers),
            bearerToken: resolveBearerToken(item.bearerEnv),
            enabled: item.enabled !== false
          }
        }
        return {
          ...base,
          command: replacePlaceholders(item.command || NODE_COMMAND, rootPath),
          args: Array.isArray(item.args) ? item.args.map(arg => replacePlaceholders(arg, rootPath)) : [],
          cwd: replacePlaceholders(item.cwd || rootPath, rootPath),
          env: item.env && typeof item.env === 'object' ? item.env : undefined
        }
      })
  } catch (error) {
    console.warn('[MCP] Failed to read config:', error.message)
    return []
  }
}

function buildConfiguredServerForDisplay(item = {}, rootPath = '') {
  const type = String(item.type || 'stdio').trim() || 'stdio'
  const command = type === 'stdio' ? replacePlaceholders(item.command || NODE_COMMAND, rootPath) : ''
  const args = Array.isArray(item.args) ? item.args.map(arg => replacePlaceholders(arg, rootPath)) : []
  return {
    id: String(item.id || ''),
    name: item.name || item.id,
    type,
    command,
    args,
    cwd: replacePlaceholders(item.cwd || rootPath, rootPath),
    env: item.env && typeof item.env === 'object' ? item.env : undefined,
    url: replacePlaceholders(item.url || '', rootPath),
    bearerEnv: item.bearerEnv || item.bearer_env || '',
    headers: item.headers && typeof item.headers === 'object' ? item.headers : undefined,
    headerEnv: item.headerEnv && typeof item.headerEnv === 'object' ? item.headerEnv : undefined,
    timeoutMs: Number(item.timeoutMs || item.timeout_ms || 45000),
    description: item.description || 'External MCP server',
    enabled: item.enabled !== false,
    source: 'config'
  }
}

function readConfiguredServerEntries() {
  if (!fs.existsSync(MCP_CONFIG_PATH)) return []
  try {
    const parsed = JSON.parse(fs.readFileSync(MCP_CONFIG_PATH, 'utf8'))
    return Array.isArray(parsed) ? parsed : Array.isArray(parsed?.servers) ? parsed.servers : []
  } catch {
    return []
  }
}

function writeConfiguredServerEntries(servers = []) {
  fs.mkdirSync(path.dirname(MCP_CONFIG_PATH), { recursive: true })
  fs.writeFileSync(MCP_CONFIG_PATH, JSON.stringify({ servers }, null, 2), 'utf8')
}

function sanitizeServerInput(input = {}) {
  const name = String(input.name || input.id || input.serverId || '').trim()
  const requestedId = String(input.id || input.serverId || '').trim()
  const generatedId = name
    .toLowerCase()
    .replace(/[^a-z0-9_.-]+/g, '-')
    .replace(/^[_.-]+|[_.-]+$/g, '')
  const id = requestedId || generatedId || `mcp-${Buffer.from(name).toString('base64url').slice(0, 56)}`
  const type = String(input.type || input.transport || 'stdio').trim() === 'http' ? 'http' : 'stdio'
  const command = String(input.command || '').trim()
  const url = String(input.url || '').trim()
  const args = Array.isArray(input.args)
    ? input.args.map(arg => String(arg)).filter(Boolean)
    : String(input.args || '').split(/\r?\n|,/).map(arg => arg.trim()).filter(Boolean)
  const cwd = String(input.cwd || '{projectPath}').trim()
  const env = input.env && typeof input.env === 'object' ? input.env : undefined
  const headers = input.headers && typeof input.headers === 'object' ? input.headers : undefined
  const headerEnv = input.headerEnv && typeof input.headerEnv === 'object' ? input.headerEnv : undefined
  const bearerEnv = String(input.bearerEnv || input.bearer_env || '').trim()
  const description = String(input.description || '').trim()
  const enabled = input.enabled !== false
  if (!name) {
    throw new Error('MCP server name is required')
  }
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,63}$/.test(id)) {
    throw new Error('MCP server name must contain at least one letter or number')
  }
  if (isProtectedBuiltInId(id)) {
    throw new Error(`Built-in MCP server cannot be overwritten: ${DEFAULT_SERVER_ID}`)
  }
  if (type === 'stdio' && !command) throw new Error('MCP command is required')
  if (type === 'http' && !/^https?:\/\//i.test(url)) throw new Error('HTTP MCP URL is required')
  return {
    id,
    name: name || id,
    type,
    command: type === 'stdio' ? command : '',
    args,
    cwd,
    env,
    url,
    bearerEnv,
    headers,
    headerEnv,
    enabled,
    description: description || 'External MCP server connected by Lingxi.'
  }
}

async function saveMcpServer(input = {}) {
  const server = sanitizeServerInput(input)
  const entries = readConfiguredServerEntries().filter(item => item?.id !== server.id)
  entries.push(server)
  writeConfiguredServerEntries(entries)
  return { success: true, server }
}

async function removeMcpServer(serverId = '') {
  const id = String(serverId || '').trim()
  if (!id) throw new Error('MCP server id is required')
  if (isProtectedBuiltInId(id)) throw new Error(`Built-in MCP server cannot be removed: ${DEFAULT_SERVER_ID}`)
  const before = readConfiguredServerEntries()
  const after = before.filter(item => item?.id !== id)
  writeConfiguredServerEntries(after)
  stopMcpClients()
  return { success: true, removed: before.length !== after.length, id }
}

async function setMcpServerEnabled(serverId = '', enabled = true) {
  const id = String(serverId || '').trim()
  if (!id) throw new Error('MCP server id is required')
  if (isProtectedBuiltInId(id)) throw new Error(`Built-in MCP server cannot be disabled: ${DEFAULT_SERVER_ID}`)
  const entries = readConfiguredServerEntries()
  let updated = null
  const nextEntries = entries.map(item => {
    if (item?.id !== id) return item
    updated = { ...item, enabled: enabled !== false }
    return updated
  })
  if (!updated) throw new Error(`External MCP server not configured: ${id}`)
  writeConfiguredServerEntries(nextEntries)
  stopMcpClients()
  return { success: true, server: updated }
}

function getBuiltInServers(rootPath) {
  if (!AIDEV_PROTOTYPE_SERVER) return []
  return [
    {
      id: DEFAULT_SERVER_ID,
      name: 'AI Dev Prototype MCP',
      type: 'stdio',
      command: NODE_COMMAND,
      args: [AIDEV_PROTOTYPE_SERVER, `--root=${rootPath}`],
      cwd: rootPath,
      timeoutMs: 45000,
      description: 'External AI development helper MCP for project perception, code location, syntax/static checks, impact analysis, runtime logs and graph freshness.',
      source: 'built-in'
    }
  ]
}

function isServerAvailable(server) {
  if (!server) return false
  if (server.type === 'http') {
    return /^https?:\/\//i.test(server.url || '')
  }
  if (server.type !== 'stdio') return false
  const firstArg = Array.isArray(server.args) ? server.args[0] : ''
  if (typeof firstArg === 'string' && /\.(cjs|mjs|js)$/i.test(firstArg) && path.isAbsolute(firstArg)) {
    return fs.existsSync(firstArg)
  }
  return !!server.command
}

function getServers(rootPath) {
  const seen = new Set()
  return [...getBuiltInServers(rootPath), ...loadConfiguredServers(rootPath)]
    .filter(server => {
      if (!server.id || seen.has(server.id)) return false
      seen.add(server.id)
      return server.type === 'stdio' || server.type === 'http'
    })
    .map(server => ({
      ...server,
      rootPath,
      available: isServerAvailable(server)
    }))
}

function getServer(rootPath, serverId = DEFAULT_SERVER_ID) {
  const id = serverId || DEFAULT_SERVER_ID
  const server = getServers(rootPath).find(item => item.id === id)
  if (!server) throw new Error(`External MCP server not configured: ${id}`)
  if (!server.available) throw new Error(`External MCP server is not available: ${id}`)
  return server
}

function getClientKey(server, rootPath) {
  if (server.type === 'http') {
    return `${server.id}:http:${server.url}`
  }
  const argsKey = Array.isArray(server.args) ? server.args.join('\u0000') : ''
  return `${server.id}:${normalizeRoot(rootPath).toLowerCase()}:${server.command}:${argsKey}`
}

function getClient(server, rootPath) {
  const key = getClientKey(server, rootPath)
  if (!clients.has(key)) {
    if (server.type === 'http') {
      clients.set(key, new HttpMcpClient({
        name: server.id,
        url: server.url,
        headers: server.headers,
        bearerToken: server.bearerToken,
        timeoutMs: server.timeoutMs || 45000
      }))
    } else {
      clients.set(key, new StdioMcpClient({
        name: server.id,
        command: server.command,
        args: server.args,
        cwd: server.cwd || rootPath,
        env: server.env,
        timeoutMs: server.timeoutMs || 45000
      }))
    }
  }
  return clients.get(key)
}

function normalizeMcpContent(result = {}) {
  const content = Array.isArray(result?.content) ? result.content : []
  const text = content
    .map(item => {
      if (item?.type === 'text') return String(item.text || '')
      return JSON.stringify(item)
    })
    .filter(Boolean)
    .join('\n')
  let parsed = null
  if (text) {
    try {
      parsed = JSON.parse(text)
    } catch { /* MCP 返回非 JSON 文本 */ }
  }
  return {
    success: !result?.isError,
    isError: !!result?.isError,
    text,
    data: parsed,
    raw: result
  }
}

async function listMcpServers(projectId = '', projectPath = '') {
  const rootPath = getProjectPath(projectId, projectPath)
  const configuredServers = readConfiguredServerEntries()
    .filter(item => item?.id)
    .map(item => buildConfiguredServerForDisplay(item, rootPath))
  return {
    success: true,
    projectPath: rootPath,
    configPath: MCP_CONFIG_PATH,
    servers: [...getBuiltInServers(rootPath), ...configuredServers].map(server => ({
      id: server.id,
      name: server.name,
      type: server.type,
      command: server.command,
      args: server.args,
      cwd: server.cwd,
      url: server.url,
      bearerEnv: server.bearerEnv,
      headers: server.headers,
      headerEnv: server.headerEnv,
      rootPath,
      enabled: server.enabled !== false,
      available: server.enabled !== false && isServerAvailable(server),
      description: server.description,
      source: server.source
    }))
  }
}

async function listMcpTools(projectId = '', projectPath = '', serverId = DEFAULT_SERVER_ID) {
  const rootPath = getProjectPath(projectId, projectPath)
  const server = getServer(rootPath, serverId)
  const tools = await getClient(server, rootPath).listTools()
  return {
    success: true,
    serverId: server.id,
    serverName: server.name,
    projectPath: rootPath,
    tools
  }
}

async function callMcpTool(projectId = '', projectPath = '', serverId = DEFAULT_SERVER_ID, toolName = '', args = {}, options = {}) {
  const rootPath = getProjectPath(projectId, projectPath)
  if (!toolName) throw new Error('MCP tool name is required')
  const server = getServer(rootPath, serverId)
  const result = await getClient(server, rootPath).callTool(toolName, args || {}, {
    timeoutMs: options.timeoutMs || 60000
  })
  return {
    tool: toolName,
    serverId: server.id,
    serverName: server.name,
    projectPath: rootPath,
    ...normalizeMcpContent(result)
  }
}

async function testMcpServer(input = {}, projectId = '', projectPath = '') {
  const rootPath = getProjectPath(projectId, projectPath)
  const sanitized = sanitizeServerInput(input)
  const timeoutMs = Number(input.timeoutMs || input.timeout_ms || 15000)

  if (sanitized.type === 'http') {
    const bearerToken = sanitized.bearerEnv ? (process.env[sanitized.bearerEnv] || '') : ''
    const client = new HttpMcpClient({
      name: sanitized.id,
      url: sanitized.url,
      headers: sanitized.headers,
      bearerToken,
      timeoutMs
    })
    try {
      const tools = await client.listTools()
      return {
        success: true,
        serverId: sanitized.id,
        serverName: sanitized.name,
        count: tools.length,
        tools: tools.slice(0, 20).map(tool => ({ name: tool.name, description: tool.description || '' }))
      }
    } finally {
      client.stop()
    }
  }

  const server = {
    ...sanitized,
    command: replacePlaceholders(sanitized.command, rootPath),
    args: sanitized.args.map(arg => replacePlaceholders(arg, rootPath)),
    cwd: replacePlaceholders(sanitized.cwd || rootPath, rootPath),
    timeoutMs,
    rootPath
  }
  if (!isServerAvailable(server)) {
    return { success: false, serverId: server.id, error: 'External MCP server entry is not available on this machine' }
  }
  const client = new StdioMcpClient({
    name: server.id,
    command: server.command,
    args: server.args,
    cwd: server.cwd || rootPath,
    env: server.env,
    timeoutMs: server.timeoutMs
  })
  try {
    const tools = await client.listTools()
    return {
      success: true,
      serverId: server.id,
      serverName: server.name,
      count: tools.length,
      tools: tools.slice(0, 20).map(tool => ({ name: tool.name, description: tool.description || '' }))
    }
  } finally {
    client.stop()
  }
}

function stopMcpClients() {
  for (const client of clients.values()) client.stop()
  clients.clear()
}

function registerIPC(ipcMain) {
  ipcMain.handle('mcp:listServers', async (event, payload = {}) => {
    try {
      return await listMcpServers(payload.projectId || '', payload.projectPath || '')
    } catch (error) {
      return { success: false, error: error.message, servers: [] }
    }
  })
  ipcMain.handle('mcp:listTools', async (event, payload = {}) => {
    try {
      return await listMcpTools(
        payload.projectId || '',
        payload.projectPath || '',
        payload.serverId || payload.server_id || DEFAULT_SERVER_ID
      )
    } catch (error) {
      return { success: false, error: error.message, tools: [] }
    }
  })
  ipcMain.handle('mcp:callTool', async (event, payload = {}) => {
    try {
      return await callMcpTool(
        payload.projectId || '',
        payload.projectPath || '',
        payload.serverId || payload.server_id || DEFAULT_SERVER_ID,
        payload.name || payload.tool || '',
        payload.arguments || payload.args || {},
        payload.options || {}
      )
    } catch (error) {
      return { success: false, error: error.message }
    }
  })
  ipcMain.handle('mcp:saveServer', async (event, payload = {}) => {
    try {
      const result = await saveMcpServer(payload.server || payload)
      stopMcpClients()
      return result
    } catch (error) {
      return { success: false, error: error.message }
    }
  })
  ipcMain.handle('mcp:removeServer', async (event, payload = {}) => {
    try {
      return await removeMcpServer(payload.serverId || payload.server_id || payload.id || '')
    } catch (error) {
      return { success: false, error: error.message }
    }
  })
  ipcMain.handle('mcp:setServerEnabled', async (event, payload = {}) => {
    try {
      return await setMcpServerEnabled(payload.serverId || payload.server_id || payload.id || '', payload.enabled !== false)
    } catch (error) {
      return { success: false, error: error.message }
    }
  })
  ipcMain.handle('mcp:testServer', async (event, payload = {}) => {
    try {
      return await testMcpServer(payload.server || payload, payload.projectId || '', payload.projectPath || '')
    } catch (error) {
      return { success: false, error: error.message }
    }
  })
}

module.exports = {
  AIDEV_PROTOTYPE_SERVER,
  DEFAULT_SERVER_ID,
  NODE_COMMAND,
  MCP_CONFIG_PATH,
  listMcpServers,
  listMcpTools,
  callMcpTool,
  saveMcpServer,
  removeMcpServer,
  setMcpServerEnabled,
  testMcpServer,
  listPrototypeTools: (projectId, projectPath) => listMcpTools(projectId, projectPath, DEFAULT_SERVER_ID),
  callPrototypeTool: (projectId, projectPath, toolName, args, options) => callMcpTool(projectId, projectPath, DEFAULT_SERVER_ID, toolName, args, options),
  stopMcpClients,
  registerIPC
}
