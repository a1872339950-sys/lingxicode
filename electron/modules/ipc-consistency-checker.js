const fs = require('fs')
const path = require('path')

function normalizePath(filePath = '', projectPath = '') {
  const absolute = path.isAbsolute(filePath) ? filePath : path.join(projectPath, filePath)
  const relative = path.relative(projectPath, absolute)
  return (relative && !relative.startsWith('..') ? relative : filePath).replace(/\\/g, '/')
}

function add(map, key, value) {
  if (!key || !value) return
  if (!map.has(key)) map.set(key, new Set())
  map.get(key).add(value)
}

function collectMatches(content, pattern, callback) {
  let match
  while ((match = pattern.exec(content)) !== null) callback(match)
}

function scanIpcFile(filePath, projectPath) {
  let content = ''
  try {
    content = fs.readFileSync(filePath, 'utf8')
  } catch {
    return null
  }
  const relativePath = normalizePath(filePath, projectPath)
  const handlers = []
  const rendererCalls = []
  const rendererListeners = []
  const emitters = []
  const preloadExposures = []
  const frontendMethods = []

  collectMatches(content, /ipcMain\.(handle|on)\s*\(\s*['"`]([\w:.-]+)['"`]/g, match => {
    handlers.push({ channel: match[2], method: match[1] })
  })
  collectMatches(content, /ipcRenderer\.(invoke|send)\s*\(\s*['"`]([\w:.-]+)['"`]/g, match => {
    rendererCalls.push({ channel: match[2], method: match[1] })
  })
  collectMatches(content, /ipcRenderer\.on\s*\(\s*['"`]([\w:.-]+)['"`]/g, match => {
    rendererListeners.push({ channel: match[1], method: 'on' })
  })
  collectMatches(content, /(?:webContents|sender|event\.sender|[A-Za-z_$][\w$]*\.webContents)\??\.send\s*\(\s*['"`]([\w:.-]+)['"`]/g, match => {
    emitters.push({ channel: match[1], method: 'send' })
  })
  collectMatches(content, /event\.reply\s*\(\s*['"`]([\w:.-]+)['"`]/g, match => {
    emitters.push({ channel: match[1], method: 'reply' })
  })

  for (const line of content.split(/\r?\n/)) {
    const exposure = line.match(/^\s*([A-Za-z_$][\w$]*)\s*:\s*.*ipcRenderer\.(invoke|send|on)\s*\(\s*['"`]([\w:.-]+)['"`]/)
    if (exposure) preloadExposures.push({ apiMethod: exposure[1], method: exposure[2], channel: exposure[3] })
  }
  collectMatches(content, /window\.api\??\.([A-Za-z_$][\w$]*)\s*\(/g, match => frontendMethods.push(match[1]))

  return { relativePath, handlers, rendererCalls, rendererListeners, emitters, preloadExposures, frontendMethods }
}

function checkIpcConsistency({ projectPath = '', changedFiles = [], sourceFiles = [] } = {}) {
  const changedSet = new Set(changedFiles.map(file => normalizePath(file, projectPath)))
  const bridgeCandidates = [
    'electron/preload.js', 'preload.js', 'src/preload.js', 'src/preload.ts',
    'electron/preload/index.js', 'electron/preload/index.ts'
  ].map(file => path.join(projectPath, file)).filter(file => fs.existsSync(file))
  const files = [...new Set([...sourceFiles, ...changedFiles, ...bridgeCandidates].map(file => path.isAbsolute(file) ? file : path.join(projectPath, file)))]
  const handlers = new Map()
  const rendererCalls = new Map()
  const rendererListeners = new Map()
  const emitters = new Map()
  const exposuresByChannel = new Map()
  const channelsByApiMethod = new Map()
  const frontendCallersByMethod = new Map()
  const records = []

  for (const filePath of files) {
    const record = scanIpcFile(filePath, projectPath)
    if (!record) continue
    records.push(record)
    record.handlers.forEach(item => add(handlers, item.channel, record.relativePath))
    record.rendererCalls.forEach(item => add(rendererCalls, item.channel, record.relativePath))
    record.rendererListeners.forEach(item => add(rendererListeners, item.channel, record.relativePath))
    record.emitters.forEach(item => add(emitters, item.channel, record.relativePath))
    record.preloadExposures.forEach(item => {
      add(exposuresByChannel, item.channel, `${record.relativePath}#${item.apiMethod}`)
      add(channelsByApiMethod, item.apiMethod, item.channel)
    })
    record.frontendMethods.forEach(method => add(frontendCallersByMethod, method, record.relativePath))
  }

  const relevantChannels = new Set()
  for (const record of records) {
    if (!changedSet.has(record.relativePath)) continue
    record.handlers.forEach(item => relevantChannels.add(item.channel))
    record.rendererCalls.forEach(item => relevantChannels.add(item.channel))
    record.rendererListeners.forEach(item => relevantChannels.add(item.channel))
    record.emitters.forEach(item => relevantChannels.add(item.channel))
    record.preloadExposures.forEach(item => relevantChannels.add(item.channel))
    record.frontendMethods.forEach(method => {
      for (const channel of channelsByApiMethod.get(method) || []) relevantChannels.add(channel)
    })
  }

  const channels = []
  let issues = 0
  for (const channel of [...relevantChannels].sort()) {
    const handlerFiles = [...(handlers.get(channel) || [])]
    const directCallerFiles = [...(rendererCalls.get(channel) || [])]
    const listenerFiles = [...(rendererListeners.get(channel) || [])]
    const emitterFiles = [...(emitters.get(channel) || [])]
    const preloadExposures = [...(exposuresByChannel.get(channel) || [])]
    const frontendCallerFiles = [...new Set(preloadExposures.flatMap(exposure => {
      const method = exposure.slice(exposure.lastIndexOf('#') + 1)
      return [...(frontendCallersByMethod.get(method) || [])]
    }))]
    const needsHandler = directCallerFiles.length > 0
    const needsCaller = handlerFiles.length > 0
    const issue = needsHandler && handlerFiles.length === 0
      ? 'No handler registered'
      : needsCaller && directCallerFiles.length === 0
        ? 'No renderer/preload caller found'
        : null
    if (issue) issues++
    channels.push({
      channel,
      handlerFile: handlerFiles[0] || null,
      handlerFiles,
      callerFiles: directCallerFiles,
      preloadExposures,
      frontendCallerFiles,
      listenerFiles,
      emitterFiles,
      consistent: !issue,
      issue
    })
  }

  return {
    channels,
    issues,
    relevantChannelCount: relevantChannels.size,
    scannedFileCount: records.length,
    scope: 'changed-channels/full-project-closure'
  }
}

module.exports = { checkIpcConsistency, scanIpcFile }
