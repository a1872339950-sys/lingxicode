/**
 * Per-AI-round file change snapshots.
 */

const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const os = require('os')
const { execFile } = require('child_process')
const config = require('./config')
const { atomicWriteJson } = require('./task-runs')
const { serializeJson } = require('./chat-history-serializer')
const snapshotStore = require('./change-session-snapshots')
const contentObjectStore = require('./content-object-store')
const recoveryPointManifests = require('./recovery-point-manifests')
const sessionIndex = require('./change-session-index')
const sessionRetention = require('./change-session-retention')

const activeSessions = new Map()
const sessionCache = new Map()
const pendingSessionWrites = new Map()
const MAX_SESSION_CACHE_ITEMS = 80
const MAX_PROMPT_CHARS = 22000
const MAX_SNAPSHOT_BYTES = 2 * 1024 * 1024
const SNAPSHOT_DIR_NAME = '_snapshots'
const SESSION_INDEX_FILE = '_index.json'
const pendingRetentionCleanups = new Set()

function makeId() {
  return `${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}`
}

function hashContent(content) {
  if (content === null || content === undefined) return null
  return crypto.createHash('sha256').update(String(content)).digest('hex')
}

function normalizeFilePath(filePath) {
  return path.normalize(filePath)
}

function isPathInside(parentPath, childPath) {
  if (!parentPath || !childPath) return false
  const relative = path.relative(path.resolve(parentPath), path.resolve(childPath))
  return relative === '' || (!!relative && !relative.startsWith('..') && !path.isAbsolute(relative))
}

function normalizePathForMatch(filePath = '') {
  return path.normalize(String(filePath || '')).replace(/\\/g, '/').toLowerCase()
}

function buildRollbackPathMatcher(session, paths = []) {
  const requested = (Array.isArray(paths) ? paths : [paths])
    .map(item => String(item || '').trim())
    .filter(Boolean)
  if (!requested.length) {
    return {
      partial: false,
      requested: [],
      matches: () => true,
      unmatched: [],
      getUnmatched: () => []
    }
  }

  const normalizedProject = path.resolve(session.projectPath || '')
  const normalizedRequested = requested.map(item => {
    const absolute = path.isAbsolute(item) ? path.resolve(item) : path.resolve(normalizedProject, item)
    return {
      original: item,
      absolute,
      match: normalizePathForMatch(absolute),
      base: path.basename(item).toLowerCase()
    }
  })
  const matchedOriginals = new Set()

  return {
    partial: true,
    requested,
    matches(filePath) {
      const normalizedFile = normalizePathForMatch(path.resolve(filePath))
      const base = path.basename(filePath).toLowerCase()
      const found = normalizedRequested.find(item =>
        normalizedFile === item.match ||
        normalizedFile.endsWith('/' + item.match) ||
        (!!item.base && base === item.base)
      )
      if (found) {
        matchedOriginals.add(found.original)
        return true
      }
      return false
    },
    getUnmatched() {
      return requested.filter(item => !matchedOriginals.has(item))
    }
  }
}

function getSessionBaseDir(projectId) {
  const instance = config.getProjectInstance(projectId)
  if (instance?.storagePath) return path.join(instance.storagePath, 'change-sessions')

  const basePath = config.getLinguaBasePath() || config.getAppDataPath() || process.cwd()
  return path.join(basePath, 'change-sessions', sanitizeName(projectId || 'unknown'))
}

function sanitizeName(name) {
  return String(name || 'unknown').replace(/[<>:"/\\|?*]/g, '_')
}

function getSessionPath(projectId, sessionId) {
  return path.join(getSessionBaseDir(projectId), `${sanitizeName(sessionId)}.json`)
}

function getSessionIndexPath(projectId) {
  return path.join(getSessionBaseDir(projectId), SESSION_INDEX_FILE)
}

function getExternalSnapshotRelPath(session, filePath, phase) {
  const digest = crypto
    .createHash('sha256')
    .update(`${phase}:${path.resolve(filePath)}`)
    .digest('hex')
  return path.join(SNAPSHOT_DIR_NAME, sanitizeName(session.id), `${phase}-${digest}.txt`)
}

async function writeExternalSnapshot(session, filePath, phase, content) {
  if (!session?.id) return null
  const relativePath = getExternalSnapshotRelPath(session, filePath, phase)
  const absolutePath = path.join(getSessionBaseDir(session.projectId), relativePath)
  await fs.promises.mkdir(path.dirname(absolutePath), { recursive: true })
  await fs.promises.writeFile(absolutePath, content, 'utf-8')
  return relativePath
}

function writeExternalSnapshotSync(session, filePath, phase, content) {
  if (!session?.id) return null
  const relativePath = getExternalSnapshotRelPath(session, filePath, phase)
  const absolutePath = path.join(getSessionBaseDir(session.projectId), relativePath)
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true })
  fs.writeFileSync(absolutePath, content, 'utf-8')
  return relativePath
}

function readExternalSnapshot(session, snapshotRef) {
  if (!session?.projectId || !snapshotRef) return null
  const baseDir = getSessionBaseDir(session.projectId)
  const absolutePath = path.resolve(baseDir, snapshotRef)
  if (!isPathInside(baseDir, absolutePath) || !fs.existsSync(absolutePath)) return null
  return fs.readFileSync(absolutePath, 'utf-8')
}

function getStoredSnapshotContent(session, file, phase) {
  return snapshotStore.readStoredText(session, file, phase, snapshotRef => readExternalSnapshot(session, snapshotRef))
}

function setCachedSession(cacheKey, session) {
  if (!cacheKey || !session) return
  if (sessionCache.has(cacheKey)) sessionCache.delete(cacheKey)
  sessionCache.set(cacheKey, session)
  while (sessionCache.size > MAX_SESSION_CACHE_ITEMS) {
    const oldestKey = sessionCache.keys().next().value
    if (!oldestKey) break
    sessionCache.delete(oldestKey)
  }
}

// 异步写入跟踪（用于窗口关闭前等待）
const _pendingSessionWritePromises = new Set()
const _sessionWriteChains = new Map()

function queueSessionWrite(session) {
  const dir = getSessionBaseDir(session.projectId)
  const filePath = getSessionPath(session.projectId, session.id)
  const serialized = serializeJson(session, { space: 2 })
  const indexMetadata = sessionIndex.metadataFromSession(session)
  const previous = _sessionWriteChains.get(filePath) || Promise.resolve()
  const promise = previous
    .catch(() => {})
    .then(async () => {
      await _asyncAtomicWrite(dir, filePath, await serialized)
      sessionIndex.upsert(getSessionIndexPath(session.projectId), dir, indexMetadata)
    })
  _sessionWriteChains.set(filePath, promise)
  _pendingSessionWritePromises.add(promise)
  const cleanup = () => {
    _pendingSessionWritePromises.delete(promise)
    if (_sessionWriteChains.get(filePath) === promise) _sessionWriteChains.delete(filePath)
  }
  promise.then(cleanup, cleanup)
  return promise
}

function saveSession(session) {
  if (flushSessionWrite(session?.projectId, session?.id)) return
  queueSessionWrite(session)
  setCachedSession(`${session.projectId}:${session.id}`, session)
}

async function _asyncAtomicWrite(dir, filePath, json) {
  await fs.promises.mkdir(dir, { recursive: true }).catch(() => {})
  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`
  await fs.promises.writeFile(tmpPath, json, 'utf-8')
  await fs.promises.rename(tmpPath, filePath)
}

/** 等待所有异步 session 写入完成 */
async function flushPendingSessionWrites() {
  await Promise.allSettled([..._pendingSessionWritePromises])
}

function saveSessionDeferred(session) {
  if (!session?.projectId || !session?.id) return
  const cacheKey = `${session.projectId}:${session.id}`
  setCachedSession(cacheKey, session)
  if (pendingSessionWrites.has(cacheKey)) return
  const timer = setTimeout(() => {
    pendingSessionWrites.delete(cacheKey)
    try {
      saveSession(session)
    } catch (error) {
      console.warn('[ChangeSession] 异步保存失败:', error.message)
    }
  }, 80)
  pendingSessionWrites.set(cacheKey, { timer, session })
}

function flushSessionWrite(projectId, sessionId) {
  if (!projectId || !sessionId) return false
  const cacheKey = `${projectId}:${sessionId}`
  const pending = pendingSessionWrites.get(cacheKey)
  if (!pending) return false
  clearTimeout(pending.timer)
  pendingSessionWrites.delete(cacheKey)
  const session = pending.session || sessionCache.get(cacheKey)
  if (!session) return false
  queueSessionWrite(session)
  setCachedSession(cacheKey, session)
  return true
}

function loadSession(projectId, sessionId) {
  const cacheKey = `${projectId}:${sessionId}`
  if (sessionCache.has(cacheKey)) {
    const cached = sessionCache.get(cacheKey)
    setCachedSession(cacheKey, cached)
    return cached
  }

  const filePath = getSessionPath(projectId, sessionId)
  if (!fs.existsSync(filePath)) return null

  const session = JSON.parse(fs.readFileSync(filePath, 'utf-8'))
  setCachedSession(cacheKey, session)
  return session
}

async function loadSessionAsync(projectId, sessionId) {
  const cacheKey = `${projectId}:${sessionId}`
  if (sessionCache.has(cacheKey)) {
    const cached = sessionCache.get(cacheKey)
    setCachedSession(cacheKey, cached)
    return cached
  }

  const filePath = getSessionPath(projectId, sessionId)
  let data
  try {
    data = await fs.promises.readFile(filePath, 'utf-8')
  } catch (error) {
    if (error.code === 'ENOENT') return null
    throw error
  }
  const session = JSON.parse(data)
  setCachedSession(cacheKey, session)
  return session
}

async function readTextSnapshot(filePath, session = null, phase = 'snapshot') {
  if (session?.projectId && session?.id) {
    return snapshotStore.captureTextFile(session, filePath, phase)
  }
  let stat
  try {
    stat = await fs.promises.stat(filePath)
  } catch (error) {
    if (error.code === 'ENOENT') return { exists: false, content: null, hash: null, size: 0, mtimeMs: null }
    throw error
  }
  if (!stat.isFile()) {
    return {
      exists: true,
      content: null,
      hash: null,
      size: stat.size,
      mtimeMs: stat.mtimeMs,
      unsupported: true
    }
  }

  const buffer = await fs.promises.readFile(filePath)
  if (buffer.includes(0)) {
    return {
      exists: true,
      content: null,
      hash: null,
      size: stat.size,
      mtimeMs: stat.mtimeMs,
      unsupported: true
    }
  }

  const content = buffer.toString('utf-8')
  const hash = hashContent(content)
  if (stat.size > MAX_SNAPSHOT_BYTES && session) {
    return {
      exists: true,
      content: null,
      snapshotRef: await writeExternalSnapshot(session, filePath, phase, content),
      contentExternal: true,
      hash,
      size: stat.size,
      mtimeMs: stat.mtimeMs
    }
  }

  return {
    exists: true,
    content,
    hash,
    size: stat.size,
    mtimeMs: stat.mtimeMs
  }
}

function readTextSnapshotSync(filePath, session = null, phase = 'snapshot') {
  if (!fs.existsSync(filePath)) {
    return { exists: false, content: null, hash: null, size: 0, mtimeMs: null }
  }
  const stat = fs.statSync(filePath)
  if (!stat.isFile()) {
    return { exists: true, content: null, hash: null, size: stat.size, mtimeMs: stat.mtimeMs, unsupported: true }
  }
  const buffer = fs.readFileSync(filePath)
  if (buffer.includes(0)) {
    return { exists: true, content: null, hash: null, size: stat.size, mtimeMs: stat.mtimeMs, unsupported: true }
  }
  const content = buffer.toString('utf-8')
  const hash = hashContent(content)
  if (stat.size > MAX_SNAPSHOT_BYTES && session) {
    return {
      exists: true,
      content: null,
      snapshotRef: writeExternalSnapshotSync(session, filePath, phase, content),
      contentExternal: true,
      hash,
      size: stat.size,
      mtimeMs: stat.mtimeMs
    }
  }
  return { exists: true, content, hash, size: stat.size, mtimeMs: stat.mtimeMs }
}

function getActiveSession(projectId) {
  const sessionId = activeSessions.get(projectId) || config.getProjectInstance(projectId)?.activeChangeSessionId
  if (!sessionId) return null
  return loadSession(projectId, sessionId)
}

async function getActiveSessionAsync(projectId) {
  const sessionId = activeSessions.get(projectId) || config.getProjectInstance(projectId)?.activeChangeSessionId
  if (!sessionId) return null
  return await loadSessionAsync(projectId, sessionId)
}

function hasTrackedFileChanges(session) {
  return Object.keys(session?.files || {}).length > 0
}

function isUsableCompletedSession(session) {
  return !!session &&
    session.status === 'completed' &&
    !session.rolledBackAt &&
    hasTrackedFileChanges(session)
}

function looksLikePreviousChangeFeedback(message = '') {
  const text = String(message || '')
  const failureSignal = /(报错|错误|异常|失败|崩溃|空白|打不开|不显示|没反应|没效果|不生效|不见了|没了|丢了|消失|坏了|构建失败|语法错误|运行错误|undefined|not defined|blank|crash|failed|error)/i
  // 只在有明确"上一轮改动"指向词时才反推为回归，避免"现在/结果"这类泛词把全新问题误当成回归，
  // 从而注入大段变更域上下文淹没当轮真实需求。
  const previousSignal = /(刚才|刚刚|上次|上一轮|上一步|之前|前面|你改完|你刚|改完后|做完后|删除后|移除后|新增后|修改后|导致)/i
  const rollbackSignal = /(恢复|回退|撤回|撤销|还原|回到|退回|改回去|不要了|回滚|restore|rollback|revert)/i
  const aiChangeSignal = /(AI|你|刚才|刚刚|上次|上一轮|上一步|之前|前面|改动|修改|改完|做完)/i
  return (failureSignal.test(text) && previousSignal.test(text)) || (rollbackSignal.test(text) && aiChangeSignal.test(text))
}

function listSavedSessionMetadata(projectId) {
  const dir = getSessionBaseDir(projectId)
  return sessionIndex.list(getSessionIndexPath(projectId), dir)
}

async function cleanupChangeSessions(projectId, options = {}) {
  await flushPendingSessionWrites()
  const referencedIds = new Set(recoveryPointManifests.list(projectId)
    .map(point => String(point?.changeSessionId || ''))
    .filter(Boolean))
  const expiredIds = sessionRetention.selectExpiredSessions(listSavedSessionMetadata(projectId), referencedIds, options)
  const removed = []
  const failed = []
  for (const sessionId of expiredIds) {
    if (activeSessions.get(projectId) === sessionId || referencedIds.has(String(sessionId))) continue
    try {
      const filePath = getSessionPath(projectId, sessionId)
      const snapshotDir = path.join(getSessionBaseDir(projectId), SNAPSHOT_DIR_NAME, sanitizeName(sessionId))
      await fs.promises.rm(filePath, { force: true })
      await fs.promises.rm(snapshotDir, { recursive: true, force: true })
      await contentObjectStore.releaseOwner(projectId, 'change-session', sessionId)
      sessionCache.delete(`${projectId}:${sessionId}`)
      sessionIndex.remove(getSessionIndexPath(projectId), getSessionBaseDir(projectId), sessionId)
      removed.push(sessionId)
    } catch (error) {
      failed.push({ sessionId, error: error.message })
    }
  }
  if (removed.length > 0) await contentObjectStore.garbageCollect(projectId).catch(() => {})
  return { success: failed.length === 0, removed, failed, referenced: referencedIds.size }
}

function cleanupChangeSessionsDeferred(projectId, options = {}) {
  if (!projectId || pendingRetentionCleanups.has(projectId)) return
  pendingRetentionCleanups.add(projectId)
  const timer = setTimeout(async () => {
    try {
      await cleanupChangeSessions(projectId, options)
    } catch (error) {
      console.warn('[ChangeSession] retention cleanup deferred:', error.message)
    } finally {
      pendingRetentionCleanups.delete(projectId)
    }
  }, 250)
  timer.unref?.()
}

function getLatestCompletedChangeSession(projectId) {
  const instance = config.getProjectInstance(projectId)
  if (instance?.lastCompletedChangeSessionId) {
    const preferred = loadSession(projectId, instance.lastCompletedChangeSessionId)
    if (isUsableCompletedSession(preferred)) return preferred
  }

  for (const metadata of listSavedSessionMetadata(projectId)) {
    if (metadata.status === 'active') continue
    const session = loadSession(projectId, metadata.id)
    if (isUsableCompletedSession(session)) return session
  }
  return null
}

function buildCompactChangeDigest(session, maxChars = 3500) {
  const files = Object.values(session.files || {})
  const lines = []
  lines.push('【上一轮变更域反推上下文】')
  lines.push('用户反馈的是上一轮交付后的问题。默认先把问题当作上一轮改动引入的回归处理。')
  lines.push('')
  lines.push('工作规则：')
  lines.push('1. 先基于上一轮改动文件、删改片段、删改符号、入口接线、初始化顺序反推根因。')
  lines.push('2. 下一步优先读取/比对这些改动文件，不要先全项目泛扫，也不要先截图或视觉确认现象。')
  lines.push('3. 只有用证据排除上一轮改动后，才转向外部环境、依赖或更大范围原因。')
  lines.push('4. 最终回复必须说明上一轮哪个改动点导致问题；如果排除，也要说明排除依据。')
  lines.push('')
  lines.push(`项目路径: ${session.projectPath}`)
  lines.push(`上一轮变更记录ID: ${session.id}`)
  if (session.gitSafety?.before?.hash || session.gitSafety?.after?.hash) {
    lines.push(`修改前恢复点: ${session.gitSafety?.before?.hash || '无'}`)
    lines.push(`完成后恢复点: ${session.gitSafety?.after?.hash || '无'}`)
  }
  lines.push('可用工具: get_latest_change_session 查看最近变更记录；用户明确要求撤回/恢复时，rollback_latest_change_session 可回退最近一次 AI 修改。')
  lines.push('')
  lines.push('上一轮改动文件:')
  for (const file of files) {
    lines.push(`- ${file.action}: ${file.path}`)
  }

  if (session.commands?.length) {
    lines.push('')
    lines.push('上一轮执行过的命令:')
    for (const cmd of session.commands.slice(-6)) {
      lines.push(`- ${cmd.command} (success: ${cmd.success})`)
      if (cmd.error) lines.push(`  error: ${clipText(cmd.error, 400)}`)
      if (cmd.stderr) lines.push(`  stderr: ${clipText(cmd.stderr, 700)}`)
    }
  }

  lines.push('')
  lines.push('上一轮关键差异片段:')
  for (const file of files.slice(0, 8)) {
    lines.push('')
    lines.push(`### ${file.action}: ${file.path}`)
    if (file.beforeUnsupported || file.afterUnsupported) {
      lines.push('该文件不是可快照的普通文本文件，只能基于文件路径和工具结果反推。')
      continue
    }
    if (!file.existedBefore && file.existsAfter) {
      lines.push('新增文件内容片段:')
      lines.push(clipText(file.afterContent || '', 1800))
    } else if (file.existedBefore && !file.existsAfter) {
      lines.push('删除前内容片段:')
      lines.push(clipText(file.beforeContent || '', 1800))
    } else {
      lines.push(clipText(buildChangedBlock(file.beforeContent, file.afterContent), 2600))
    }
  }

  return clipText(lines.join('\n'), maxChars)
}

function buildPreviousChangeDiagnosticPrompt(projectId, userMessage, options = {}) {
  if (!looksLikePreviousChangeFeedback(userMessage)) {
    return { enabled: false, reason: 'message-not-previous-change-feedback' }
  }

  const session = getLatestCompletedChangeSession(projectId)
  if (!session) {
    return { enabled: false, reason: 'no-previous-completed-change-session' }
  }

  const files = Object.values(session.files || {})
  const beforeHash = session.gitSafety?.before?.hash || ''
  const afterHash = session.gitSafety?.after?.hash || ''
  return {
    enabled: true,
    sessionId: session.id,
    changedPaths: files.map(file => file.path).filter(Boolean),
    beforeHash,
    afterHash,
    prompt: buildCompactChangeDigest(session, options.maxChars || 3500)
  }
}

function getLatestChangeSessionForTool(projectId) {
  const session = getLatestCompletedChangeSession(projectId)
  if (!session) return { success: false, error: '找不到最近一次 AI 修改记录' }
  const summary = summarizeSession(session)
  return {
    success: true,
    session: {
      id: summary.id,
      projectPath: summary.projectPath,
      status: summary.status,
      finalizedAt: summary.finalizedAt,
      fileCount: summary.fileCount,
      files: summary.files,
      commandCount: summary.commandCount,
      mutatingCommandCount: summary.mutatingCommandCount,
      readOnlyCommandCount: summary.readOnlyCommandCount,
      commands: (summary.commands || []).map(cmd => ({
        command: cmd.command,
        cwd: cmd.cwd,
        success: cmd.success,
        exitCode: cmd.exitCode,
        mutatesFiles: cmd.mutatesFiles !== false,
        commandKind: cmd.commandKind || 'unknown',
        error: cmd.error,
        stderr: cmd.stderr
      })),
      gitSafety: summary.gitSafety,
      recoveryPoints: summary.recoveryPoints,
      warnings: summary.warnings
    },
    guidance: '如果用户明确要求撤回/恢复到 AI 修改前，可调用 rollback_latest_change_session。它只会反向撤销本轮 AI 改动并保留后续修改；位置重叠时会整批停止，不能强制覆盖。如果只是反馈出错，应先围绕这些文件定位并小修。'
  }
}

function startChangeSession(projectId, projectPath, metadata = {}) {
  const session = {
    id: makeId(),
    projectId,
    projectPath,
    status: 'active',
    startedAt: new Date().toISOString(),
    finalizedAt: null,
    rolledBackAt: null,
    metadata,
    files: {},
    fileOrder: [],
    commands: [],
    warnings: []
  }

  activeSessions.set(projectId, session.id)
  const instance = config.getProjectInstance(projectId)
  if (instance) instance.activeChangeSessionId = session.id
  saveSession(session)
  return session
}

function recordFileBefore(projectId, filePath, action = 'modify') {
  const session = getActiveSession(projectId)
  if (!session || !filePath) return null
  const normalizedPath = normalizeFilePath(filePath)
  if (!session.files[normalizedPath]) {
    const before = readTextSnapshotSync(normalizedPath, session, 'before')
    session.files[normalizedPath] = {
      path: normalizedPath,
      action,
      existedBefore: before.exists,
      beforeContent: before.content,
      beforeObjectHash: before.objectHash || null,
      beforeSnapshotRef: before.snapshotRef || null,
      beforeContentExternal: !!before.contentExternal,
      beforeHash: before.hash,
      beforeSize: before.size,
      beforeMtimeMs: before.mtimeMs,
      beforeUnsupported: !!before.unsupported,
      existsAfter: before.exists,
      afterContent: before.content,
      afterObjectHash: before.objectHash || null,
      afterSnapshotRef: before.snapshotRef || null,
      afterContentExternal: !!before.contentExternal,
      afterHash: before.hash,
      afterSize: before.size,
      afterMtimeMs: before.mtimeMs,
      afterUnsupported: !!before.unsupported,
      updatedAt: new Date().toISOString()
    }
    session.fileOrder.push(normalizedPath)
  }
  if (session.files[normalizedPath].action === 'modify' && action === 'delete') {
    session.files[normalizedPath].action = 'delete'
  }
  saveSessionDeferred(session)
  return session.files[normalizedPath]
}

async function recordFileBeforeAsync(projectId, filePath, action = 'modify') {
  const session = await getActiveSessionAsync(projectId)
  if (!session || !filePath) return null

  const normalizedPath = normalizeFilePath(filePath)
  if (!session.files[normalizedPath]) {
    const before = await readTextSnapshot(normalizedPath, session, 'before')
    session.files[normalizedPath] = {
      path: normalizedPath,
      action,
      existedBefore: before.exists,
      beforeContent: before.content,
      beforeObjectHash: before.objectHash || null,
      beforeSnapshotRef: before.snapshotRef || null,
      beforeContentExternal: !!before.contentExternal,
      beforeHash: before.hash,
      beforeSize: before.size,
      beforeMtimeMs: before.mtimeMs,
      beforeUnsupported: !!before.unsupported,
      existsAfter: before.exists,
      afterContent: before.content,
      afterObjectHash: before.objectHash || null,
      afterSnapshotRef: before.snapshotRef || null,
      afterContentExternal: !!before.contentExternal,
      afterHash: before.hash,
      afterSize: before.size,
      afterMtimeMs: before.mtimeMs,
      afterUnsupported: !!before.unsupported,
      updatedAt: new Date().toISOString()
    }
    session.fileOrder.push(normalizedPath)
  }

  if (session.files[normalizedPath].action === 'modify' && action === 'delete') {
    session.files[normalizedPath].action = 'delete'
  }

  saveSessionDeferred(session)
  return session.files[normalizedPath]
}

function recordFileAfter(projectId, filePath, action = 'modify') {
  const session = getActiveSession(projectId)
  if (!session || !filePath) return null
  const normalizedPath = normalizeFilePath(filePath)
  if (!session.files[normalizedPath]) recordFileBefore(projectId, normalizedPath, action)
  const entry = session.files[normalizedPath]
  const after = readTextSnapshotSync(normalizedPath, session, 'after')
  entry.existsAfter = after.exists
  entry.afterContent = after.content
  entry.afterObjectHash = after.objectHash || null
  entry.afterSnapshotRef = after.snapshotRef || null
  entry.afterContentExternal = !!after.contentExternal
  entry.afterHash = after.hash
  entry.afterSize = after.size
  entry.afterMtimeMs = after.mtimeMs
  entry.afterUnsupported = !!after.unsupported
  entry.updatedAt = new Date().toISOString()
  if (!entry.existedBefore && entry.existsAfter) entry.action = 'create'
  else if (entry.existedBefore && !entry.existsAfter) entry.action = 'delete'
  else if (entry.existedBefore && entry.existsAfter) entry.action = 'modify'
  else entry.action = action
  saveSessionDeferred(session)
  return entry
}

async function recordFileAfterAsync(projectId, filePath, action = 'modify') {
  const session = await getActiveSessionAsync(projectId)
  if (!session || !filePath) return null

  const normalizedPath = normalizeFilePath(filePath)
  if (!session.files[normalizedPath]) {
    await recordFileBeforeAsync(projectId, normalizedPath, action)
  }

  const entry = session.files[normalizedPath]
  const after = await readTextSnapshot(normalizedPath, session, 'after')
  entry.existsAfter = after.exists
  entry.afterContent = after.content
  entry.afterObjectHash = after.objectHash || null
  entry.afterSnapshotRef = after.snapshotRef || null
  entry.afterContentExternal = !!after.contentExternal
  entry.afterHash = after.hash
  entry.afterSize = after.size
  entry.afterMtimeMs = after.mtimeMs
  entry.afterUnsupported = !!after.unsupported
  entry.updatedAt = new Date().toISOString()

  if (!entry.existedBefore && entry.existsAfter) {
    entry.action = 'create'
  } else if (entry.existedBefore && !entry.existsAfter) {
    entry.action = 'delete'
  } else if (entry.existedBefore && entry.existsAfter) {
    entry.action = 'modify'
  } else {
    entry.action = action
  }

  saveSessionDeferred(session)
  return entry
}

function classifyCommandMutation(command = '') {
  const text = String(command || '').trim()
  const lower = text.toLowerCase()
  const hasWriteSignal = /\b(set-content|add-content|out-file|new-item|remove-item|move-item|copy-item|rename-item|set-item)\b/i.test(lower) ||
    /(^|[;&|\s])(del|erase|rm|rmdir|mkdir|ni)\b/i.test(lower) ||
    /(^|[;&|\s])(sed\s+-i|perl\s+-pi)\b/i.test(lower) ||
    /(^|[;&|\s])(npm|pnpm|yarn)\s+(install|add|remove|build|run\s+build)\b/i.test(lower) ||
    /(^|[^>])>>?($|[^=])/i.test(text)
  const hasReadOnlyTool = /\b(get-content|select-string|get-childitem|measure-object)\b/i.test(lower) ||
    /(^|[;&|"'`\s])(gc|type|cat|findstr|rg|ripgrep|grep|where|dir|ls)\b/i.test(lower)

  if (hasReadOnlyTool && !hasWriteSignal) {
    return { mutatesFiles: false, commandKind: 'read_only' }
  }
  return { mutatesFiles: true, commandKind: hasWriteSignal ? 'mutating' : 'unknown' }
}

function recordCommand(projectId, command, cwd, result = {}) {
  const session = getActiveSession(projectId)
  if (!session || !command) return null
  const mutation = classifyCommandMutation(command)

  session.commands.push({
    command,
    cwd,
    success: !!result.success,
    exitCode: result.exitCode ?? null,
    mutatesFiles: mutation.mutatesFiles,
    commandKind: mutation.commandKind,
    stdout: clipText(result.stdout || '', 1800),
    stderr: clipText(result.stderr || '', 1800),
    error: clipText(result.error || '', 1000),
    recordedAt: new Date().toISOString()
  })

  if (mutation.mutatesFiles && !session.warnings.includes('commands-not-snapshotted')) {
    session.warnings.push('commands-not-snapshotted')
  }

  saveSession(session)
  return session
}

function summarizeSession(session, options = {}) {
  if (!session) return null
  const includeContent = !!options.includeContent
  const commands = Array.isArray(session.commands) ? session.commands : []
  const mutatingCommandCount = commands.filter(command => command.mutatesFiles !== false).length
  const files = Object.values(session.files || {}).map(file => {
    const item = {
      path: file.path,
      action: file.action,
      existedBefore: file.existedBefore,
      existsAfter: file.existsAfter,
      beforeSize: file.beforeSize,
      afterSize: file.afterSize,
      beforeUnsupported: file.beforeUnsupported,
      afterUnsupported: file.afterUnsupported,
      additions: 0,
      deletions: 0
    }
    if (!file.beforeUnsupported && !file.afterUnsupported) {
      const beforeText = getStoredSnapshotContent(session, file, 'before')
      const afterText = getStoredSnapshotContent(session, file, 'after')
      const delta = countLineDelta(beforeText, afterText)
      item.additions = delta.additions
      item.deletions = delta.deletions
      if (includeContent) {
        item.beforeText = beforeText ?? ''
        item.afterText = afterText ?? ''
        item.previewMode = (item.beforeText || item.afterText) ? 'full' : 'summary'
        item.canApplyFix = !!item.afterText
      }
    }
    return item
  })

  return {
    id: session.id,
    projectId: session.projectId,
    projectPath: session.projectPath,
    status: session.status,
    startedAt: session.startedAt,
    finalizedAt: session.finalizedAt,
    rolledBackAt: session.rolledBackAt,
    files,
    fileCount: files.length,
    commands,
    commandCount: commands.length,
    mutatingCommandCount,
    readOnlyCommandCount: commands.length - mutatingCommandCount,
    warnings: session.warnings || [],
    gitSafety: session.gitSafety || null,
    recoveryPoints: session.recoveryPoints || null
  }
}

function finalizeChangeSession(projectId, sessionId, status = 'completed') {
  const session = loadSession(projectId, sessionId)
  if (!session) return null

  const unchangedReleases = []
  for (const filePath of Object.keys(session.files || {})) {
    const file = session.files[filePath]
    const unchanged = file.existedBefore === file.existsAfter && file.beforeHash === file.afterHash
    if (unchanged) {
      unchangedReleases.push(snapshotStore.releaseFile(session, filePath))
      delete session.files[filePath]
      session.fileOrder = (session.fileOrder || []).filter(item => item !== filePath)
    }
  }

  if (session.status === 'active') {
    session.status = status
    session.finalizedAt = new Date().toISOString()
  }

  if (activeSessions.get(projectId) === sessionId) activeSessions.delete(projectId)
  const instance = config.getProjectInstance(projectId)
  if (instance?.activeChangeSessionId === sessionId) instance.activeChangeSessionId = null
  if (instance && status === 'completed' && hasTrackedFileChanges(session)) {
    instance.lastCompletedChangeSessionId = session.id
  }

  saveSession(session)
  if (unchangedReleases.length > 0) {
    Promise.allSettled(unchangedReleases)
      .then(() => contentObjectStore.garbageCollect(projectId))
      .catch(() => {})
  }
  cleanupChangeSessionsDeferred(projectId)
  return summarizeSession(session)
}

function getChangeSession(projectId, sessionId, options = {}) {
  return summarizeSession(loadSession(projectId, sessionId), options)
}

function getRecoverySnapshot(projectId, sessionId) {
  const session = loadSession(projectId, sessionId)
  if (!session) return null
  return {
    id: session.id,
    projectId: session.projectId,
    projectPath: session.projectPath,
    status: session.status,
    startedAt: session.startedAt,
    finalizedAt: session.finalizedAt,
    files: (session.fileOrder || [])
      .map(filePath => session.files?.[filePath])
      .filter(Boolean)
      .map(file => ({
        path: file.path,
        action: file.action,
        existedBefore: file.existedBefore,
        existsAfter: file.existsAfter,
        beforeHash: file.beforeHash,
        afterHash: file.afterHash,
        beforeObjectHash: file.beforeObjectHash || null,
        beforeContent: file.beforeObjectHash ? null : getStoredSnapshotContent(session, file, 'before'),
        beforeSize: file.beforeSize,
        beforeMtimeMs: file.beforeMtimeMs,
        beforeUnsupported: file.beforeUnsupported,
        afterUnsupported: file.afterUnsupported
      }))
  }
}

function setGitSafetySnapshot(projectId, sessionId, phase, snapshot) {
  const session = loadSession(projectId, sessionId)
  if (!session || !phase) return null
  session.gitSafety = {
    ...(session.gitSafety || {}),
    [phase]: snapshot
  }
  saveSession(session)
  return summarizeSession(session)
}

function setRecoveryPoint(projectId, sessionId, phase, recoveryPoint) {
  const session = loadSession(projectId, sessionId)
  if (!session || !phase) return null
  session.recoveryPoints = {
    ...(session.recoveryPoints || {}),
    [phase]: recoveryPoint
  }
  saveSession(session)
  return summarizeSession(session)
}

async function getCurrentSnapshotAsync(filePath, options = {}) {
  let stat
  try {
    stat = await fs.promises.stat(filePath)
  } catch (err) {
    if (err.code === 'ENOENT') return { exists: false, content: null, hash: null }
    throw err
  }
  if (!stat.isFile()) return { exists: true, content: null, hash: null, unsupported: true }
  const buffer = await fs.promises.readFile(filePath)
  if (buffer.includes(0)) return { exists: true, content: null, hash: null, unsupported: true }
  const content = buffer.toString('utf-8')
  return {
    exists: true,
    content: options.includeContent || stat.size <= MAX_SNAPSHOT_BYTES ? content : null,
    hash: hashContent(content),
    size: stat.size
  }
}

async function reverseMergeText(currentContent, aiAfterContent, aiBeforeContent) {
  const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'lingxi-safe-rollback-'))
  const currentPath = path.join(tempDir, 'current.txt')
  const afterPath = path.join(tempDir, 'ai-after.txt')
  const beforePath = path.join(tempDir, 'ai-before.txt')
  try {
    await Promise.all([
      fs.promises.writeFile(currentPath, String(currentContent ?? ''), 'utf-8'),
      fs.promises.writeFile(afterPath, String(aiAfterContent ?? ''), 'utf-8'),
      fs.promises.writeFile(beforePath, String(aiBeforeContent ?? ''), 'utf-8')
    ])
    const maxBuffer = Math.max(
      10 * 1024 * 1024,
      Buffer.byteLength(String(currentContent ?? ''), 'utf-8') * 4 +
        Buffer.byteLength(String(aiBeforeContent ?? ''), 'utf-8') * 2 + 1024 * 1024
    )
    const result = await new Promise(resolve => {
      execFile('git', [
        'merge-file', '-p', '--diff3',
        '-L', 'current-user-content',
        '-L', 'ai-after-content',
        '-L', 'ai-before-content',
        currentPath, afterPath, beforePath
      ], { encoding: 'utf-8', windowsHide: true, maxBuffer }, (error, stdout, stderr) => {
        if (!error) return resolve({ success: true, content: stdout })
        if (Number(error.code) === 1) {
          return resolve({ success: false, conflict: true, reason: 'AI 改动与后来修改重叠，无法安全自动合并' })
        }
        resolve({
          success: false,
          conflict: true,
          reason: error.code === 'ENOENT'
            ? '系统缺少 Git 三方合并能力，已停止回退以保护当前文件'
            : `三方合并失败：${String(stderr || error.message || '').trim()}`
        })
      })
    })
    return result
  } finally {
    await fs.promises.rm(tempDir, { recursive: true, force: true }).catch(() => {})
  }
}

async function buildSafeRollbackAction(session, file) {
  if (!isPathInside(session.projectPath, file.path)) {
    return { conflict: true, path: file.path, reason: '文件不在当前项目目录内，不能自动回退' }
  }
  if (file.beforeUnsupported || file.afterUnsupported) {
    return { conflict: true, path: file.path, reason: '不是普通文本文件，不能自动回退' }
  }

  const current = await getCurrentSnapshotAsync(file.path, { includeContent: true })
  if (current.unsupported) {
    return { conflict: true, path: file.path, reason: '当前文件不是普通文本文件' }
  }

  const beforeContent = file.existedBefore ? getStoredSnapshotContent(session, file, 'before') : ''
  const afterContent = file.existsAfter ? getStoredSnapshotContent(session, file, 'after') : ''
  if ((file.existedBefore && beforeContent == null) || (file.existsAfter && afterContent == null)) {
    return { conflict: true, path: file.path, reason: '变更记录缺少完整快照，已停止回退以保护当前文件' }
  }

  const matchesAfter = current.exists === file.existsAfter && (!current.exists || current.hash === file.afterHash)
  if (matchesAfter) {
    return {
      path: file.path,
      action: file.existedBefore ? 'restore' : 'delete',
      desiredExists: !!file.existedBefore,
      desiredContent: file.existedBefore ? beforeContent : null,
      current
    }
  }

  const matchesBefore = current.exists === file.existedBefore && (!current.exists || current.hash === file.beforeHash)
  if (matchesBefore) {
    return { path: file.path, action: 'already_restored', desiredExists: current.exists, desiredContent: current.content, current, noWrite: true }
  }

  // AI 删除了文件，而用户/外部软件后来又在同一路径创建了内容：无法判断两份内容的归属，拒绝覆盖。
  if (file.existedBefore && !file.existsAfter) {
    return { conflict: true, path: file.path, reason: 'AI 删除文件后该路径又出现了新内容，已停止回退以避免覆盖' }
  }
  // AI 修改了已有文件，而用户后来删除了它：恢复整文件同样会覆盖用户的删除决定。
  if (file.existedBefore && file.existsAfter && !current.exists) {
    return { conflict: true, path: file.path, reason: 'AI 修改后文件又被删除，已停止回退以避免重新覆盖创建' }
  }

  const merged = await reverseMergeText(current.content || '', afterContent || '', beforeContent || '')
  if (!merged.success) {
    return { conflict: true, path: file.path, reason: merged.reason || '无法安全合并后来修改' }
  }
  const desiredExists = file.existedBefore || merged.content.length > 0
  return {
    path: file.path,
    action: desiredExists ? 'reverse_merge' : 'delete',
    desiredExists,
    desiredContent: desiredExists ? merged.content : null,
    current,
    preservedLaterChanges: true
  }
}

async function restoreCurrentSnapshots(applied = []) {
  const failures = []
  for (const item of [...applied].reverse()) {
    try {
      if (item.current.exists) {
        await fs.promises.mkdir(path.dirname(item.path), { recursive: true })
        await fs.promises.writeFile(item.path, item.current.content || '', 'utf-8')
      } else {
        await fs.promises.rm(item.path, { force: true })
      }
    } catch (error) {
      console.error('[ChangeSession] 回退事务恢复失败:', item.path, error.message)
      failures.push({ path: item.path, error: error.message })
    }
  }
  return failures
}

async function rollbackChangeSession(projectId, sessionId, options = {}) {
  const session = loadSession(projectId, sessionId)
  if (!session) return { success: false, error: '找不到这次修改记录' }
  if (session.projectId !== projectId) return { success: false, error: '项目不匹配' }

  const onProgress = typeof options.onProgress === 'function' ? options.onProgress : null
  const matcher = buildRollbackPathMatcher(session, options.paths || options.filePaths || [])
  const rolledBack = []
  const order = [...(session.fileOrder || [])].reverse()
  const rollbackFiles = order
    .map(filePath => session.files[filePath])
    .filter(Boolean)
    .filter(file => matcher.matches(file.path))

  // 先规划全部文件，任何一个文件冲突都不写入，避免半回退状态。
  const plans = []
  for (const file of rollbackFiles) {
    plans.push(await buildSafeRollbackAction(session, file))
  }
  const conflicts = plans
    .filter(plan => plan?.conflict)
    .map(plan => ({ path: plan.path, reason: plan.reason }))
  if (conflicts.length) {
    return {
      success: false,
      conflict: true,
      safeRollback: true,
      noFilesChanged: true,
      forceIgnored: !!options.force,
      partial: matcher.partial,
      conflicts,
      error: '检测到与 AI 改动重叠的后续修改，已停止回退，没有覆盖任何当前文件'
    }
  }

  const total = rollbackFiles.length
  const emitProgress = (completed, currentPath = '') => {
    if (!onProgress) return
    const percent = total > 0 ? Math.min(100, Math.max(0, Math.round((completed / total) * 100))) : 100
    onProgress({ projectId, sessionId, completed, total, percent, currentPath })
  }

  emitProgress(0)

  const applied = []
  try {
    for (let index = 0; index < plans.length; index++) {
      const plan = plans[index]
      if (!plan.noWrite) {
        // 写入前先登记。即使 writeFile 写到一半才失败，事务恢复也会覆盖这个文件。
        applied.push(plan)
        if (plan.desiredExists) {
          await fs.promises.mkdir(path.dirname(plan.path), { recursive: true })
          await fs.promises.writeFile(plan.path, plan.desiredContent || '', 'utf-8')
        } else {
          await fs.promises.rm(plan.path, { force: true })
        }
      }
      rolledBack.push({
        path: plan.path,
        action: plan.action,
        preservedLaterChanges: !!plan.preservedLaterChanges,
        noWrite: !!plan.noWrite
      })
      emitProgress(index + 1, plan.path)
    }
  } catch (error) {
    const restoreFailures = await restoreCurrentSnapshots(applied)
    const fullyRestored = restoreFailures.length === 0
    return {
      success: false,
      transactionRolledBack: fullyRestored,
      noFilesChanged: fullyRestored,
      restoreFailures,
      error: fullyRestored
        ? `回退写入失败，已恢复回退前状态：${error.message}`
        : `回退写入失败，且有 ${restoreFailures.length} 个文件未能自动恢复，请立即检查：${restoreFailures.map(item => item.path).join('、')}`
    }
  }

  const unmatched = matcher.getUnmatched()
  if ((matcher.partial || order.length > 0) && rolledBack.length === 0) {
    return {
      success: false,
      error: matcher.partial
        ? '没有匹配到要回退的文件'
        : '没有可自动回退的文件，可能是旧记录缺少完整快照，或文件不是普通文本内容',
      requestedPaths: matcher.requested,
      unmatched
    }
  }

  session.status = matcher.partial ? 'partially_rolled_back' : 'rolled_back'
  session.rolledBackAt = new Date().toISOString()
  if (matcher.partial) {
    session.partialRollback = {
      paths: rolledBack.map(item => item.path),
      requestedPaths: matcher.requested,
      unmatched,
      rolledBackAt: session.rolledBackAt
    }
  }
  saveSession(session)

  return {
    success: true,
    partial: matcher.partial,
    rolledBack,
    requestedPaths: matcher.requested,
    unmatched,
    conflicts: [],
    safeRollback: true,
    forceIgnored: !!options.force,
    session: summarizeSession(session)
  }
}

function clipText(text, maxChars) {
  if (!text) return ''
  const value = String(text)
  if (value.length <= maxChars) return value
  return `${value.slice(0, maxChars)}\n...已截断 ${value.length - maxChars} 字符`
}

function countLineDelta(beforeContent, afterContent) {
  const before = beforeContent == null ? '' : String(beforeContent)
  const after = afterContent == null ? '' : String(afterContent)
  if (before === after) return { additions: 0, deletions: 0 }
  const beforeLines = before.split(/\r?\n/)
  const afterLines = after.split(/\r?\n/)
  if (beforeLines.length > 5000 || afterLines.length > 5000) {
    return {
      additions: Math.max(0, afterLines.length - beforeLines.length),
      deletions: Math.max(0, beforeLines.length - afterLines.length)
    }
  }
  let prefix = 0
  const maxPrefix = Math.min(beforeLines.length, afterLines.length)
  while (prefix < maxPrefix && beforeLines[prefix] === afterLines[prefix]) prefix++
  let suffix = 0
  const maxSuffix = Math.min(beforeLines.length - prefix, afterLines.length - prefix)
  while (
    suffix < maxSuffix &&
    beforeLines[beforeLines.length - 1 - suffix] === afterLines[afterLines.length - 1 - suffix]
  ) suffix++
  return {
    additions: Math.max(0, afterLines.length - prefix - suffix),
    deletions: Math.max(0, beforeLines.length - prefix - suffix)
  }
}

function buildChangedBlock(beforeContent, afterContent) {
  const before = beforeContent || ''
  const after = afterContent || ''
  const beforeLines = before.split(/\r?\n/)
  const afterLines = after.split(/\r?\n/)

  let prefix = 0
  while (prefix < beforeLines.length && prefix < afterLines.length && beforeLines[prefix] === afterLines[prefix]) {
    prefix++
  }

  let suffix = 0
  while (
    suffix < beforeLines.length - prefix &&
    suffix < afterLines.length - prefix &&
    beforeLines[beforeLines.length - 1 - suffix] === afterLines[afterLines.length - 1 - suffix]
  ) {
    suffix++
  }

  const beforeChanged = beforeLines.slice(prefix, beforeLines.length - suffix)
  const afterChanged = afterLines.slice(prefix, afterLines.length - suffix)
  const beforeStart = prefix + 1
  const afterStart = prefix + 1

  return [
    `修改前 第 ${beforeStart} 行起:`,
    clipText(beforeChanged.join('\n'), 3500) || '(空)',
    `修改后 第 ${afterStart} 行起:`,
    clipText(afterChanged.join('\n'), 3500) || '(空)'
  ].join('\n')
}

function buildReviewPrompt(projectId, sessionId, mode = 'review') {
  const session = loadSession(projectId, sessionId)
  if (!session) return { success: false, error: '找不到这次修改记录' }

  const files = Object.values(session.files || {})
  const lines = []
  lines.push(mode === 'repair'
    ? '请审查刚刚这轮 AI 修改的代码。如果发现明确的语法错误、运行错误或明显缺陷，请直接修复；如果没有问题，请简短说明没有发现需要修复的问题。'
    : '请审查刚刚这轮 AI 修改的代码，只看本次修改带来的问题。重点找语法错误、运行错误、误删、路径错误和明显逻辑问题。')
  lines.push('')
  lines.push(`项目路径: ${session.projectPath}`)
  lines.push(`修改记录ID: ${session.id}`)
  lines.push('')
  lines.push('本次涉及文件:')
  for (const file of files) {
    lines.push(`- ${file.action}: ${file.path}`)
  }

  if (session.commands?.length) {
    lines.push('')
    lines.push('本次执行过的命令:')
    for (const cmd of session.commands) {
      lines.push(`- ${cmd.command} (cwd: ${cmd.cwd || session.projectPath}, success: ${cmd.success}, kind: ${cmd.commandKind || 'unknown'})`)
      if (cmd.error) lines.push(`  error: ${cmd.error}`)
      if (cmd.stderr) lines.push(`  stderr:\n${clipText(cmd.stderr, 1200)}`)
      if (cmd.stdout) lines.push(`  stdout:\n${clipText(cmd.stdout, 1200)}`)
    }
    if (!files.length && session.commands.some(cmd => cmd.mutatesFiles !== false)) {
      lines.push('')
      lines.push('注意：本轮没有直接文件快照，但执行过命令。命令可能生成、修改或验证文件。你必须根据命令、cwd、输出和项目状态读取相关目录/文件确认是否产生改动或问题。')
    }
  }

  lines.push('')
  lines.push('文件改动内容:')
  for (const file of files) {
    lines.push('')
    lines.push(`### ${file.action}: ${file.path}`)
    if (file.beforeUnsupported || file.afterUnsupported) {
      lines.push('这个文件不是普通文本文件，已跳过内容快照。')
      continue
    }

    if (!file.existedBefore && file.existsAfter) {
      lines.push('新文件内容:')
      lines.push(clipText(file.afterContent || '', 7000))
    } else if (file.existedBefore && !file.existsAfter) {
      lines.push('文件被删除，删除前内容:')
      lines.push(clipText(file.beforeContent || '', 7000))
    } else {
      lines.push(buildChangedBlock(file.beforeContent, file.afterContent))
    }
  }

  lines.push('')
  lines.push(mode === 'repair'
    ? '要求：能自己修就调用工具修；不要泛泛而谈；修复后说明改了什么和还剩什么风险。'
    : '要求：先给结论；列出必须修的问题；没有问题就直接说没有发现必须修的问题。')

  return { success: true, prompt: clipText(lines.join('\n'), MAX_PROMPT_CHARS) }
}

function registerChangeSessionIPC(ipcMain) {
  ipcMain.handle('change-session-get', async (event, projectId, sessionId) => {
    const session = getChangeSession(projectId, sessionId, { includeContent: true })
    if (!session) return { success: false, error: '找不到这次修改记录' }
    return { success: true, session }
  })

  ipcMain.handle('change-session-rollback', async (event, projectId, sessionId, force = false) => {
    return rollbackChangeSession(projectId, sessionId, {
      force,
      onProgress: progress => {
        event.sender.send('change-session-rollback-progress', progress)
      }
    })
  })

  ipcMain.handle('change-session-review-prompt', async (event, projectId, sessionId, mode = 'review') => {
    return buildReviewPrompt(projectId, sessionId, mode)
  })
}

module.exports = {
  cleanupChangeSessions,
  startChangeSession,
  getActiveSession,
  recordFileBefore,
  recordFileAfter,
  recordFileBeforeAsync,
  recordFileAfterAsync,
  recordCommand,
  finalizeChangeSession,
  getChangeSession,
  getRecoverySnapshot,
  setGitSafetySnapshot,
  setRecoveryPoint,
  getLatestCompletedChangeSession,
  buildPreviousChangeDiagnosticPrompt,
  looksLikePreviousChangeFeedback,
  rollbackChangeSession,
  getLatestChangeSessionForTool,
  buildReviewPrompt,
  registerChangeSessionIPC,
  flushPendingSessionWrites
}
