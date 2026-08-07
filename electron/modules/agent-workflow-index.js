const fs = require('fs')
const path = require('path')

const VERSION = 1
let cache = null

function atomicWrite(filePath, value) {
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`
  fs.writeFileSync(tempPath, JSON.stringify(value, null, 2), 'utf8')
  fs.renameSync(tempPath, filePath)
}

function metadataFromWorkflow(workflow = {}, fallbackId = '') {
  return {
    id: String(workflow.id || fallbackId),
    name: String(workflow.name || '未命名工作流').slice(0, 160),
    description: String(workflow.description || '').slice(0, 400),
    enabled: workflow.enabled !== false,
    nodeCount: Array.isArray(workflow.nodes) ? workflow.nodes.length : Math.max(0, Number(workflow.nodeCount) || 0),
    updatedAt: String(workflow.updatedAt || '')
  }
}

function rebuild(indexPath, workflowDir) {
  const items = fs.readdirSync(workflowDir, { withFileTypes: true })
    .filter(entry => entry.isFile() && entry.name.endsWith('.json'))
    .map(entry => {
      try {
        const workflow = JSON.parse(fs.readFileSync(path.join(workflowDir, entry.name), 'utf8'))
        return metadataFromWorkflow(workflow, entry.name.replace(/\.json$/i, ''))
      } catch {
        return null
      }
    })
    .filter(Boolean)
  cache = { version: VERSION, items }
  atomicWrite(indexPath, cache)
  return cache
}

function load(indexPath, workflowDir) {
  if (cache) return cache
  try {
    const parsed = JSON.parse(fs.readFileSync(indexPath, 'utf8'))
    if (parsed?.version === VERSION && Array.isArray(parsed.items)) {
      cache = parsed
      return cache
    }
  } catch {}
  return rebuild(indexPath, workflowDir)
}

function list(indexPath, workflowDir) {
  return load(indexPath, workflowDir).items
    .slice()
    .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
}

function upsert(indexPath, workflowDir, workflow) {
  const index = load(indexPath, workflowDir)
  const metadata = metadataFromWorkflow(workflow)
  const existing = index.items.findIndex(item => item.id === metadata.id)
  if (existing >= 0) index.items[existing] = metadata
  else index.items.push(metadata)
  atomicWrite(indexPath, index)
  return metadata
}

function remove(indexPath, workflowDir, workflowId) {
  const index = load(indexPath, workflowDir)
  index.items = index.items.filter(item => item.id !== workflowId)
  atomicWrite(indexPath, index)
}

function invalidate() {
  cache = null
}

module.exports = { list, upsert, remove, invalidate, rebuild }
