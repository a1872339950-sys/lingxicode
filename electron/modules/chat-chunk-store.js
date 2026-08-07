const crypto = require('crypto')
const fs = require('fs')
const path = require('path')

const identity = require('./chat-message-identity')
const sourceLinks = require('./chat-history-source-links')

const FORMAT_VERSION = 1
const DEFAULT_ROUNDS_PER_CHUNK = 30
const writeLocks = new Map()

function getPaths(chatHistoryPath) {
  const sessionDir = path.dirname(chatHistoryPath)
  return {
    sessionDir,
    manifestPath: path.join(sessionDir, 'manifest.json'),
    chunksDir: path.join(sessionDir, 'chunks'),
    deletionsPath: path.join(sessionDir, 'overlays', 'deletions.json')
  }
}

function checksum(messages) {
  return crypto.createHash('sha256').update(JSON.stringify(messages)).digest('hex')
}

async function atomicWriteJson(filePath, value) {
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true })
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.${crypto.randomBytes(3).toString('hex')}.tmp`
  try {
    await fs.promises.writeFile(tempPath, JSON.stringify(value, null, 2), 'utf-8')
    await fs.promises.rename(tempPath, filePath)
  } finally {
    await fs.promises.rm(tempPath, { force: true }).catch(() => {})
  }
}

async function withWriteLock(chatHistoryPath, operation) {
  const key = path.resolve(chatHistoryPath)
  const previous = writeLocks.get(key) || Promise.resolve()
  const current = previous.catch(() => {}).then(operation)
  writeLocks.set(key, current)
  try {
    return await current
  } finally {
    if (writeLocks.get(key) === current) writeLocks.delete(key)
  }
}

async function readManifest(chatHistoryPath) {
  const { manifestPath } = getPaths(chatHistoryPath)
  try {
    const manifest = JSON.parse(await fs.promises.readFile(manifestPath, 'utf-8'))
    if (manifest?.version !== FORMAT_VERSION || !Array.isArray(manifest.chunks)) {
      throw new Error('Unsupported chat chunk manifest version')
    }
    return await repairOrphanedInitialChunk(chatHistoryPath, manifest)
  } catch (error) {
    if (error.code === 'ENOENT') return null
    throw error
  }
}

async function repairOrphanedInitialChunk(chatHistoryPath, manifest) {
  const paths = getPaths(chatHistoryPath)
  const referenced = new Set(manifest.chunks.map(chunk => chunk.file))
  const storedMessageCount = manifest.chunks.reduce((sum, chunk) => sum + (Number(chunk.messageCount) || 0), 0)
  if (storedMessageCount >= Number(manifest.messageCount || 0)) return manifest

  const entries = await fs.promises.readdir(paths.chunksDir).catch(() => [])
  const candidates = entries
    .filter(file => /^000000(?:\.|\.json$)/i.test(file) && !referenced.has(file))
    .sort()
  if (!candidates.length) return manifest

  const file = candidates[candidates.length - 1]
  const parsed = JSON.parse(await fs.promises.readFile(path.join(paths.chunksDir, file), 'utf-8'))
  const messages = Array.isArray(parsed) ? parsed : parsed.messages
  if (!Array.isArray(messages) || !messages.length) return manifest
  if (storedMessageCount + messages.length > Number(manifest.messageCount || 0)) return manifest

  const repaired = {
    ...manifest,
    chunks: [buildChunkRecord(file, messages, true), ...manifest.chunks],
    roundCount: 0,
    updatedAt: new Date().toISOString(),
    repairedInitialChunkAt: new Date().toISOString()
  }
  repaired.roundCount = repaired.chunks.reduce((sum, chunk) => sum + (Number(chunk.roundCount) || 0), 0)
  await atomicWriteJson(paths.manifestPath, repaired)
  await Promise.all(candidates
    .slice(0, -1)
    .map(staleFile => fs.promises.rm(path.join(paths.chunksDir, staleFile), { force: true }).catch(() => {})))
  return repaired
}

function readManifestSync(chatHistoryPath) {
  try {
    const manifest = JSON.parse(fs.readFileSync(getPaths(chatHistoryPath).manifestPath, 'utf-8'))
    return manifest?.version === FORMAT_VERSION ? manifest : null
  } catch {
    return null
  }
}

function existsSync(chatHistoryPath) {
  return !!readManifestSync(chatHistoryPath) || fs.existsSync(chatHistoryPath)
}

async function exists(chatHistoryPath) {
  try {
    if (await readManifest(chatHistoryPath)) return true
  } catch {
    // A corrupt new-format manifest must not hide a readable legacy file.
  }
  return fs.promises.stat(chatHistoryPath).then(stat => stat.isFile()).catch(() => false)
}

function chunkFileName(index) {
  return `${String(index + 1).padStart(6, '0')}.json`
}

function chunkRevisionFileName(index) {
  return `${String(index + 1).padStart(6, '0')}.${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}.json`
}

function buildChunkRecord(file, messages, sealed) {
  const rounds = identity.groupByRound(messages)
  return {
    id: path.basename(file, '.json'),
    file,
    messageCount: messages.length,
    roundCount: rounds.length,
    firstMessageId: messages[0]?.messageId || '',
    lastMessageId: messages[messages.length - 1]?.messageId || '',
    firstRoundId: rounds[0]?.roundId || '',
    lastRoundId: rounds[rounds.length - 1]?.roundId || '',
    checksum: checksum(messages),
    sealed: !!sealed
  }
}

async function writeChunk(chatHistoryPath, file, messages, sealed) {
  const { chunksDir } = getPaths(chatHistoryPath)
  await atomicWriteJson(path.join(chunksDir, file), {
    version: FORMAT_VERSION,
    sealed: !!sealed,
    messages
  })
  return buildChunkRecord(file, messages, sealed)
}

async function readChunk(chatHistoryPath, chunk) {
  const filePath = path.join(getPaths(chatHistoryPath).chunksDir, chunk.file)
  const parsed = JSON.parse(await fs.promises.readFile(filePath, 'utf-8'))
  const messages = Array.isArray(parsed) ? parsed : parsed.messages
  if (!Array.isArray(messages)) throw new Error(`Invalid chat chunk: ${chunk.file}`)
  if (chunk.checksum && checksum(messages) !== chunk.checksum) throw new Error(`Chat chunk checksum mismatch: ${chunk.file}`)
  return messages
}

async function readDeletedMessageIds(chatHistoryPath) {
  try {
    const parsed = JSON.parse(await fs.promises.readFile(getPaths(chatHistoryPath).deletionsPath, 'utf-8'))
    return new Set(Array.isArray(parsed?.messageIds) ? parsed.messageIds : [])
  } catch (error) {
    if (error.code === 'ENOENT') return new Set()
    throw error
  }
}

async function deleteMessages(chatHistoryPath, messageIds) {
  const additions = (Array.isArray(messageIds) ? messageIds : []).map(String).filter(Boolean)
  if (!additions.length) return { success: true, deletedCount: 0 }
  return withWriteLock(chatHistoryPath, async () => {
    const deleted = await readDeletedMessageIds(chatHistoryPath)
    const before = deleted.size
    additions.forEach(messageId => deleted.add(messageId))
    await atomicWriteJson(getPaths(chatHistoryPath).deletionsPath, {
      version: FORMAT_VERSION,
      updatedAt: new Date().toISOString(),
      messageIds: [...deleted]
    })
    return { success: true, deletedCount: deleted.size - before, totalDeleted: deleted.size }
  })
}

function createManifest(chatHistoryPath, options = {}) {
  return {
    version: FORMAT_VERSION,
    sessionId: String(options.sessionId || path.basename(path.dirname(chatHistoryPath))),
    createdAt: options.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    messageCount: 0,
    roundCount: 0,
    activeChunkId: '',
    chunks: [],
    legacy: options.legacy || null
  }
}

async function migrateLegacy(chatHistoryPath, legacyMessages, options = {}) {
  return withWriteLock(chatHistoryPath, async () => {
    const existing = await readManifest(chatHistoryPath)
    if (existing) return existing
    const manifest = createManifest(chatHistoryPath, {
      ...options,
      legacy: { path: path.basename(chatHistoryPath), readOnly: true, migratedAt: new Date().toISOString() }
    })
    const messages = identity.assignMessageIdentity(legacyMessages, {
      sessionId: manifest.sessionId,
      deterministic: true
    })
    const groups = identity.groupByRound(messages)
    const maxRounds = Math.max(1, Number(options.roundsPerChunk) || DEFAULT_ROUNDS_PER_CHUNK)
    for (let offset = 0; offset < groups.length; offset += maxRounds) {
      const chunkMessages = groups.slice(offset, offset + maxRounds).flatMap(group => group.messages)
      const file = chunkFileName(manifest.chunks.length)
      const sealed = offset + maxRounds < groups.length
      manifest.chunks.push(await writeChunk(chatHistoryPath, file, chunkMessages, sealed))
    }
    manifest.messageCount = messages.length
    manifest.roundCount = groups.length
    manifest.activeChunkId = manifest.chunks[manifest.chunks.length - 1]?.id || ''
    manifest.updatedAt = new Date().toISOString()
    await atomicWriteJson(getPaths(chatHistoryPath).manifestPath, manifest)
    return manifest
  })
}

async function replaceAll(chatHistoryPath, replacementMessages, options = {}) {
  return withWriteLock(chatHistoryPath, async () => {
    if (!options.preserveSourceReference) await sourceLinks.releaseReference(chatHistoryPath)
    const previous = await readManifest(chatHistoryPath).catch(() => null)
    const manifest = createManifest(chatHistoryPath, {
      ...options,
      sessionId: options.sessionId || previous?.sessionId,
      createdAt: previous?.createdAt
    })
    const messages = identity.assignMessageIdentity(replacementMessages, {
      sessionId: manifest.sessionId,
      deterministic: false
    })
    const groups = identity.groupByRound(messages)
    const maxRounds = Math.max(1, Number(options.roundsPerChunk) || DEFAULT_ROUNDS_PER_CHUNK)
    const generationId = `g${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`
    for (let offset = 0; offset < groups.length; offset += maxRounds) {
      const chunkMessages = groups.slice(offset, offset + maxRounds).flatMap(group => group.messages)
      const file = `${generationId}-${chunkFileName(manifest.chunks.length)}`
      const sealed = offset + maxRounds < groups.length
      manifest.chunks.push(await writeChunk(chatHistoryPath, file, chunkMessages, sealed))
    }
    manifest.messageCount = messages.length
    manifest.roundCount = groups.length
    manifest.activeChunkId = manifest.chunks[manifest.chunks.length - 1]?.id || ''
    manifest.updatedAt = new Date().toISOString()
    await atomicWriteJson(getPaths(chatHistoryPath).manifestPath, manifest)
    await fs.promises.rm(getPaths(chatHistoryPath).deletionsPath, { force: true }).catch(() => {})
    const referenced = new Set(manifest.chunks.map(chunk => chunk.file))
    await Promise.all((previous?.chunks || [])
      .map(chunk => chunk.file)
      .filter(file => file && !referenced.has(file))
      .map(file => fs.promises.rm(path.join(getPaths(chatHistoryPath).chunksDir, file), { force: true }).catch(() => {})))
    return { manifest, messages }
  })
}

async function ensureStore(chatHistoryPath, options = {}) {
  const manifest = await readManifest(chatHistoryPath)
  if (manifest) return manifest
  return migrateLegacy(chatHistoryPath, [], options)
}

async function readRecentMessages(chatHistoryPath, manifest, targetCount = 400) {
  const result = []
  for (let index = manifest.chunks.length - 1; index >= 0 && result.length < targetCount; index--) {
    result.unshift(...await readChunk(chatHistoryPath, manifest.chunks[index]))
  }
  return result
}

async function syncSnapshot(chatHistoryPath, snapshot, options = {}) {
  return withWriteLock(chatHistoryPath, async () => {
    let manifest = await readManifest(chatHistoryPath)
    if (!manifest) manifest = createManifest(chatHistoryPath, options)
    const messages = (Array.isArray(snapshot) ? snapshot : []).filter(item => item && typeof item === 'object')
    const recent = await readRecentMessages(chatHistoryPath, manifest, Math.max(400, messages.length + 50))
    let overlap = identity.findPersistedPrefixLength(recent, messages)
    const sourceReference = await sourceLinks.readReference(chatHistoryPath)
    if (!overlap && sourceReference?.forkMessageId) {
      const forkIndex = messages.findIndex(message => message?.messageId === sourceReference.forkMessageId)
      if (forkIndex >= 0) overlap = forkIndex + 1
    }
    const previousRoundId = overlap
      ? messages[overlap - 1]?.roundId
      : (recent[recent.length - 1]?.roundId || sourceReference?.forkRoundId)
    identity.assignMessageIdentity(messages, { sessionId: manifest.sessionId, previousRoundId })
    const knownIds = new Set(recent.map(message => message.messageId).filter(Boolean))
    const appended = messages.slice(overlap).filter(message => !knownIds.has(message.messageId))
    if (!appended.length) {
      if (!manifest.chunks.length) await atomicWriteJson(getPaths(chatHistoryPath).manifestPath, manifest)
      return { manifest, appendedCount: 0, overlap }
    }

    let activeIndex = manifest.chunks.length > 0 ? manifest.chunks.length - 1 : 0
    let activeRecord = manifest.chunks.length > 0 ? manifest.chunks[activeIndex] : null
    let activeMessages = activeRecord ? await readChunk(chatHistoryPath, activeRecord) : []
    const staleChunkFiles = []
    const maxRounds = Math.max(1, Number(options.roundsPerChunk) || DEFAULT_ROUNDS_PER_CHUNK)
    for (const group of identity.groupByRound(appended)) {
      const activeRounds = identity.groupByRound(activeMessages)
      const continuesActiveRound = activeRounds[activeRounds.length - 1]?.roundId === group.roundId
      if (activeMessages.length && activeRounds.length >= maxRounds && !continuesActiveRound) {
        const sealedFile = chunkRevisionFileName(activeIndex)
        if (activeRecord?.file) staleChunkFiles.push(activeRecord.file)
        manifest.chunks[activeIndex] = await writeChunk(chatHistoryPath, sealedFile, activeMessages, true)
        activeMessages = []
        activeIndex = manifest.chunks.length
        activeRecord = null
      }
      activeMessages.push(...group.messages)
      const previousActiveFile = activeRecord?.file || ''
      const file = activeRecord ? chunkRevisionFileName(activeIndex) : chunkFileName(activeIndex)
      activeRecord = await writeChunk(chatHistoryPath, file, activeMessages, false)
      if (previousActiveFile) staleChunkFiles.push(previousActiveFile)
      manifest.chunks[activeIndex] = activeRecord
    }

    manifest.messageCount += appended.length
    manifest.roundCount = manifest.chunks.reduce((sum, chunk) => sum + (Number(chunk.roundCount) || 0), 0)
    manifest.activeChunkId = activeRecord?.id || manifest.activeChunkId
    manifest.updatedAt = new Date().toISOString()
    await atomicWriteJson(getPaths(chatHistoryPath).manifestPath, manifest)
    const referencedFiles = new Set(manifest.chunks.map(chunk => chunk.file))
    await Promise.all(staleChunkFiles
      .filter(file => !referencedFiles.has(file))
      .map(file => fs.promises.rm(path.join(getPaths(chatHistoryPath).chunksDir, file), { force: true }).catch(() => {})))
    return { manifest, appendedCount: appended.length, overlap }
  })
}

async function createSourceReference(targetChatHistoryPath, sourceChatHistoryPath, options = {}) {
  await ensureStore(targetChatHistoryPath, {
    sessionId: options.targetSessionId || path.basename(path.dirname(targetChatHistoryPath))
  })
  const targetManifest = await readManifest(targetChatHistoryPath)
  if (targetManifest.chunks.length || targetManifest.messageCount) {
    throw new Error('Target chat history must be empty before adding a source reference')
  }
  const latestPage = await readPage(sourceChatHistoryPath, { direction: 'older', pageChunks: 1 })
  if (!latestPage) throw new Error('Source chat history does not exist')
  const lastMessage = latestPage.messages[latestPage.messages.length - 1] || null
  const sourceDeletedMessageIds = [...await readDeletedMessageIds(sourceChatHistoryPath)]
  return sourceLinks.createReference(targetChatHistoryPath, sourceChatHistoryPath, {
    ...options,
    sourceChunkCount: latestPage.range?.totalChunks || 0,
    sourceMessageCount: Math.max(0, Number(latestPage.manifest?.messageCount || 0) - sourceDeletedMessageIds.length),
    sourceRoundCount: latestPage.manifest?.roundCount || 0,
    sourceDeletedMessageIds,
    forkMessageId: options.forkMessageId || lastMessage?.messageId || '',
    forkRoundId: options.forkRoundId || lastMessage?.roundId || ''
  })
}

async function detachSourceConsumers(sourceChatHistoryPath) {
  const registry = await sourceLinks.readConsumers(sourceChatHistoryPath)
  const results = []
  for (const consumer of registry.consumers) {
    const targetPath = consumer?.targetChatHistoryPath
    if (!targetPath || !await fs.promises.stat(path.dirname(targetPath)).then(stat => stat.isDirectory()).catch(() => false)) continue
    try {
      const composite = await readAll(targetPath)
      const contextCompression = require('./context-compression')
      await contextCompression.materializeInheritedSummaries(targetPath)
      await replaceAll(targetPath, composite?.messages || [], {
        sessionId: path.basename(path.dirname(targetPath))
      })
      results.push({ targetChatHistoryPath: targetPath, materialized: true })
    } catch (error) {
      results.push({ targetChatHistoryPath: targetPath, materialized: false, error: error.message })
      throw error
    }
  }
  return results
}

async function findSessionHistoryPaths(rootPath) {
  const results = []
  async function visit(dirPath) {
    const entries = await fs.promises.readdir(dirPath, { withFileTypes: true }).catch(() => [])
    if (entries.some(entry => entry.isFile() && entry.name === 'manifest.json')) {
      results.push(path.join(dirPath, 'chat-history.json'))
    }
    await Promise.all(entries.filter(entry => entry.isDirectory()).map(entry => visit(path.join(dirPath, entry.name))))
  }
  await visit(rootPath)
  return results
}

async function prepareStorageDeletion(storagePath) {
  const histories = await findSessionHistoryPaths(storagePath)
  for (const historyPath of histories) await detachSourceConsumers(historyPath)
  for (const historyPath of histories) await sourceLinks.releaseReference(historyPath)
  return { success: true, historyCount: histories.length }
}

async function readAll(chatHistoryPath, options = {}) {
  const manifest = await readManifest(chatHistoryPath)
  if (!manifest) return null
  const messages = []
  let cursor = 0
  let page = null
  do {
    page = await readPage(chatHistoryPath, {
      cursor,
      direction: 'newer',
      pageChunks: 5,
      _visited: options._visited
    })
    messages.push(...(page?.messages || []))
    cursor = page?.nextCursor
  } while (page?.hasMore && cursor !== null)
  return { manifest: page?.manifest || manifest, messages }
}

async function readPage(chatHistoryPath, options = {}) {
  const manifest = await readManifest(chatHistoryPath)
  if (!manifest) return null
  const visited = new Set(options._visited || [])
  const resolvedPath = path.resolve(chatHistoryPath)
  if (visited.has(resolvedPath)) throw new Error('Circular chat history source reference')
  visited.add(resolvedPath)
  const sourceReference = await sourceLinks.readReference(chatHistoryPath)
  const sourceChunkCount = Math.max(0, Number(sourceReference?.sourceChunkCount) || 0)
  const totalChunks = sourceChunkCount + manifest.chunks.length
  const pageChunks = Math.max(1, Math.min(5, Number(options.pageChunks) || 1))
  const direction = options.direction === 'newer' ? 'newer' : 'older'
  let startIndex
  let endIndex
  if (direction === 'newer') {
    startIndex = options.cursor === undefined || options.cursor === null || options.cursor === ''
      ? 0
      : Math.max(0, Number(options.cursor))
    endIndex = Math.min(totalChunks - 1, startIndex + pageChunks - 1)
  } else {
    endIndex = options.cursor === undefined || options.cursor === null || options.cursor === ''
      ? totalChunks - 1
      : Math.min(totalChunks - 1, Number(options.cursor))
    startIndex = Math.max(0, endIndex - pageChunks + 1)
  }
  if (!Number.isInteger(endIndex) || endIndex < 0) {
    return { messages: [], nextCursor: null, hasMore: false, direction, range: null, manifest }
  }
  const messages = []
  for (let index = startIndex; index <= endIndex; index++) {
    if (index < sourceChunkCount && sourceReference) {
      const sourcePage = await readPage(sourceReference.sourceChatHistoryPath, {
        cursor: index,
        direction: 'newer',
        pageChunks: 1,
        _skipOwnDeletions: true,
        _visited: [...visited]
      })
      let sourceMessages = sourcePage?.messages || []
      const frozenSourceDeletions = new Set(sourceReference.sourceDeletedMessageIds || [])
      if (frozenSourceDeletions.size) {
        sourceMessages = sourceMessages.filter(message => !frozenSourceDeletions.has(message?.messageId))
      }
      if (index === sourceChunkCount - 1 && sourceReference.forkMessageId) {
        const forkIndex = sourceMessages.findIndex(message => message?.messageId === sourceReference.forkMessageId)
        if (forkIndex >= 0) sourceMessages = sourceMessages.slice(0, forkIndex + 1)
      }
      messages.push(...sourceMessages)
    } else {
      const ownChunk = manifest.chunks[index - sourceChunkCount]
      if (ownChunk) messages.push(...await readChunk(chatHistoryPath, ownChunk))
    }
  }
  const deleted = options._skipOwnDeletions ? new Set() : await readDeletedMessageIds(chatHistoryPath)
  const visibleMessages = deleted.size ? messages.filter(message => !deleted.has(message.messageId)) : messages
  return {
    messages: visibleMessages,
    nextCursor: direction === 'newer'
      ? (endIndex < totalChunks - 1 ? endIndex + 1 : null)
      : (startIndex > 0 ? startIndex - 1 : null),
    hasMore: direction === 'newer' ? endIndex < totalChunks - 1 : startIndex > 0,
    direction,
    range: { startIndex, endIndex, totalChunks },
    manifest: {
      sessionId: manifest.sessionId,
      messageCount: Math.max(0, Number(sourceReference?.sourceMessageCount || 0) + Number(manifest.messageCount || 0) - deleted.size),
      roundCount: Number(sourceReference?.sourceRoundCount || 0) + Number(manifest.roundCount || 0),
      updatedAt: manifest.updatedAt
    }
  }
}

function getStatSync(chatHistoryPath) {
  const manifest = readManifestSync(chatHistoryPath)
  if (manifest) {
    const stat = fs.statSync(getPaths(chatHistoryPath).manifestPath)
    const sourceReference = sourceLinks.readReferenceSync(chatHistoryPath)
    return {
      exists: true,
      mtimeMs: stat.mtimeMs,
      size: stat.size,
      messageCount: Number(sourceReference?.sourceMessageCount || 0) + Number(manifest.messageCount || 0),
      roundCount: Number(sourceReference?.sourceRoundCount || 0) + Number(manifest.roundCount || 0)
    }
  }
  try {
    const stat = fs.statSync(chatHistoryPath)
    return { exists: stat.isFile(), mtimeMs: stat.mtimeMs, size: stat.size, messageCount: 0, roundCount: 0 }
  } catch {
    return { exists: false, mtimeMs: 0, size: 0, messageCount: 0, roundCount: 0 }
  }
}

module.exports = {
  createSourceReference,
  deleteMessages,
  detachSourceConsumers,
  exists,
  existsSync,
  getPaths,
  getStatSync,
  migrateLegacy,
  readAll,
  readManifest,
  readPage,
  readSourceReference: sourceLinks.readReference,
  prepareStorageDeletion,
  releaseSourceReference: sourceLinks.releaseReference,
  replaceAll,
  syncSnapshot
}
