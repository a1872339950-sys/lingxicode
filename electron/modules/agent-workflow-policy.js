const MAX_WORKFLOWS = 80
const MAX_NODES = 32
const MAX_EDGES = 96
const MAX_WORKFLOW_BYTES = 512 * 1024

const FIELD_LIMITS = Object.freeze({
  workflowName: 160,
  description: 2000,
  nodeName: 120,
  task: 12000,
  outputRule: 4000,
  modelKey: 180,
  modelName: 180,
  id: 100
})

function byteLength(value) {
  try {
    return Buffer.byteLength(JSON.stringify(value ?? {}), 'utf8')
  } catch {
    return Number.POSITIVE_INFINITY
  }
}

function validateText(value, limit, label) {
  if (value == null || String(value).length <= limit) return null
  return `${label} exceeds ${limit} characters`
}

function validateWorkflowPayload(input = {}) {
  const nodes = Array.isArray(input.nodes) ? input.nodes : []
  const edges = Array.isArray(input.edges) ? input.edges : []
  if (byteLength(input) > MAX_WORKFLOW_BYTES) return { valid: false, code: 'WORKFLOW_TOO_LARGE', error: `workflow exceeds ${MAX_WORKFLOW_BYTES} bytes` }
  if (nodes.length > MAX_NODES) return { valid: false, code: 'WORKFLOW_NODE_LIMIT', error: `workflow exceeds ${MAX_NODES} nodes` }
  if (edges.length > MAX_EDGES) return { valid: false, code: 'WORKFLOW_EDGE_LIMIT', error: `workflow exceeds ${MAX_EDGES} edges` }

  const workflowFields = [
    [input.id, FIELD_LIMITS.id, 'workflow id'],
    [input.name, FIELD_LIMITS.workflowName, 'workflow name'],
    [input.description, FIELD_LIMITS.description, 'workflow description']
  ]
  for (const [value, limit, label] of workflowFields) {
    const error = validateText(value, limit, label)
    if (error) return { valid: false, code: 'WORKFLOW_FIELD_LIMIT', error }
  }

  for (let index = 0; index < nodes.length; index++) {
    const node = nodes[index] || {}
    const fields = [
      [node.id, FIELD_LIMITS.id, `node ${index + 1} id`],
      [node.name, FIELD_LIMITS.nodeName, `node ${index + 1} name`],
      [node.task, FIELD_LIMITS.task, `node ${index + 1} task`],
      [node.outputRule, FIELD_LIMITS.outputRule, `node ${index + 1} output rule`],
      [node.modelKey, FIELD_LIMITS.modelKey, `node ${index + 1} model key`],
      [node.modelName, FIELD_LIMITS.modelName, `node ${index + 1} model name`]
    ]
    for (const [value, limit, label] of fields) {
      const error = validateText(value, limit, label)
      if (error) return { valid: false, code: 'WORKFLOW_FIELD_LIMIT', error }
    }
  }
  return { valid: true }
}

function assertWorkflowPayload(input = {}) {
  const result = validateWorkflowPayload(input)
  if (result.valid) return result
  const error = new Error(result.error)
  error.code = result.code
  throw error
}

module.exports = {
  FIELD_LIMITS,
  MAX_EDGES,
  MAX_NODES,
  MAX_WORKFLOWS,
  MAX_WORKFLOW_BYTES,
  assertWorkflowPayload,
  validateWorkflowPayload
}
