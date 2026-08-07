const crypto = require('crypto')
const fs = require('fs')
const path = require('path')

const VERSION = 1

function getReferencePath(chatHistoryPath) {
  return path.join(path.dirname(chatHistoryPath), 'history-source.json')
}

function getConsumersPath(chatHistoryPath) {
  return path.join(path.dirname(chatHistoryPath), 'history-consumers.json')
}

async function atomicWriteJson(filePath, value) {
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true })
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.${crypto.randomBytes(3).toString('hex')}.tmp`
  try {
    await fs.promises.writeFile(tempPath, JSON.stringify(value, null, 2), 'utf8')
    await fs.promises.rename(tempPath, filePath)
  } finally {
    await fs.promises.rm(tempPath, { force: true }).catch(() => {})
  }
}

async function readReference(chatHistoryPath) {
  try {
    const parsed = JSON.parse(await fs.promises.readFile(getReferencePath(chatHistoryPath), 'utf8'))
    if (parsed?.version !== VERSION || !parsed.sourceChatHistoryPath) return null
    return parsed
  } catch (error) {
    if (error.code === 'ENOENT') return null
    throw error
  }
}

function readReferenceSync(chatHistoryPath) {
  try {
    const parsed = JSON.parse(fs.readFileSync(getReferencePath(chatHistoryPath), 'utf8'))
    return parsed?.version === VERSION ? parsed : null
  } catch {
    return null
  }
}

async function readConsumers(sourceChatHistoryPath) {
  try {
    const parsed = JSON.parse(await fs.promises.readFile(getConsumersPath(sourceChatHistoryPath), 'utf8'))
    return Array.isArray(parsed?.consumers) ? parsed : { version: VERSION, consumers: [] }
  } catch (error) {
    if (error.code === 'ENOENT') return { version: VERSION, consumers: [] }
    throw error
  }
}

async function createReference(targetChatHistoryPath, sourceChatHistoryPath, metadata = {}) {
  const target = path.resolve(targetChatHistoryPath)
  const source = path.resolve(sourceChatHistoryPath)
  if (target === source) throw new Error('Chat history cannot reference itself')
  const reference = {
    version: VERSION,
    sourceProjectId: String(metadata.sourceProjectId || ''),
    sourceSessionId: String(metadata.sourceSessionId || ''),
    sourceChatHistoryPath: source,
    sourceChunkCount: Math.max(0, Number(metadata.sourceChunkCount) || 0),
    sourceMessageCount: Math.max(0, Number(metadata.sourceMessageCount) || 0),
    sourceRoundCount: Math.max(0, Number(metadata.sourceRoundCount) || 0),
    sourceDeletedMessageIds: [...new Set((Array.isArray(metadata.sourceDeletedMessageIds) ? metadata.sourceDeletedMessageIds : []).map(String).filter(Boolean))],
    forkMessageId: String(metadata.forkMessageId || ''),
    forkRoundId: String(metadata.forkRoundId || ''),
    createdAt: new Date().toISOString()
  }
  await atomicWriteJson(getReferencePath(target), reference)

  const consumers = await readConsumers(source)
  consumers.consumers = consumers.consumers.filter(item => path.resolve(item.targetChatHistoryPath) !== target)
  consumers.consumers.push({
    targetChatHistoryPath: target,
    targetProjectId: String(metadata.targetProjectId || ''),
    createdAt: reference.createdAt
  })
  consumers.updatedAt = new Date().toISOString()
  await atomicWriteJson(getConsumersPath(source), consumers)
  return reference
}

async function releaseReference(targetChatHistoryPath) {
  const target = path.resolve(targetChatHistoryPath)
  const reference = await readReference(target).catch(() => null)
  await fs.promises.rm(getReferencePath(target), { force: true })
  if (!reference?.sourceChatHistoryPath) return false
  const consumers = await readConsumers(reference.sourceChatHistoryPath).catch(() => null)
  if (!consumers) return true
  consumers.consumers = consumers.consumers.filter(item => path.resolve(item.targetChatHistoryPath) !== target)
  consumers.updatedAt = new Date().toISOString()
  await atomicWriteJson(getConsumersPath(reference.sourceChatHistoryPath), consumers)
  return true
}

module.exports = {
  createReference,
  getConsumersPath,
  getReferencePath,
  readConsumers,
  readReference,
  readReferenceSync,
  releaseReference
}
