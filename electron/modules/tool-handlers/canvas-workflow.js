const { BrowserWindow } = require('electron')
const agentWorkflows = require('../agent-workflows')

function createId(prefix = 'item') {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
}

function normalizeNode(node = {}, index = 0) {
  const type = String(node.type || 'work').trim().toLowerCase()
  return {
    id: String(node.id || '').trim() || createId(type),
    type,
    name: String(node.name || '').trim() || `节点 ${index + 1}`,
    task: String(node.task || '').trim(),
    outputRule: String(node.outputRule || '').trim(),
    modelKey: String(node.modelKey || '').trim(),
    modelName: String(node.modelName || '').trim(),
    x: Number(node.x) || (type === 'input' ? 90 : type === 'output' ? 1090 : 360 + index * 290),
    y: Number(node.y) || (150 + (index % 4) * 184)
  }
}

function normalizeEdge(edge = {}, index = 0) {
  return {
    id: String(edge.id || '').trim() || createId('edge'),
    source: String(edge.source || '').trim(),
    target: String(edge.target || '').trim()
  }
}

function validateWorkflowStructure(nodes = [], edges = []) {
  const inputNodes = nodes.filter(n => n.type === 'input')
  const outputNodes = nodes.filter(n => n.type === 'output')
  const workNodes = nodes.filter(n => n.type === 'work')

  if (inputNodes.length !== 1) {
    return { valid: false, error: `必须有且仅有 1 个 input 节点，当前 ${inputNodes.length} 个` }
  }
  if (outputNodes.length !== 1) {
    return { valid: false, error: `必须有且仅有 1 个 output 节点，当前 ${outputNodes.length} 个` }
  }
  if (workNodes.length < 1) {
    return { valid: false, error: '至少需要 1 个 work 节点' }
  }

  for (const node of workNodes) {
    if (!node.task) {
      return { valid: false, error: `work 节点「${node.name}」的 task 不能为空` }
    }
  }

  const nodeIds = new Set(nodes.map(n => n.id))
  for (const edge of edges) {
    if (!nodeIds.has(edge.source)) {
      return { valid: false, error: `连接的 source「${edge.source}」不存在于节点列表中` }
    }
    if (!nodeIds.has(edge.target)) {
      return { valid: false, error: `连接的 target「${edge.target}」不存在于节点列表中` }
    }
  }

  // 检查循环依赖（仅检查 work 节点之间的边）
  const workIds = new Set(workNodes.map(n => n.id))
  const adjacency = new Map(workNodes.map(n => [n.id, []]))
  const indegree = new Map(workNodes.map(n => [n.id, 0]))
  for (const edge of edges) {
    if (!workIds.has(edge.source) || !workIds.has(edge.target)) continue
    adjacency.get(edge.source).push(edge.target)
    indegree.set(edge.target, (indegree.get(edge.target) || 0) + 1)
  }
  const queue = [...indegree.entries()].filter(([, count]) => count === 0).map(([id]) => id)
  let visited = 0
  while (queue.length) {
    const id = queue.shift()
    visited++
    for (const next of adjacency.get(id) || []) {
      indegree.set(next, indegree.get(next) - 1)
      if (indegree.get(next) === 0) queue.push(next)
    }
  }
  if (visited !== workNodes.length) {
    return { valid: false, error: '工作流存在循环连接，请调整节点依赖' }
  }

  return { valid: true }
}

function notifyRenderer(projectId, workflow) {
  try {
    const windows = BrowserWindow.getAllWindows()
    for (const win of windows) {
      if (!win.isDestroyed()) {
        win.webContents.send('canvas-workflow:created', { projectId, workflow })
      }
    }
  } catch (_) {
    // 通知失败不影响保存结果
  }
}

const handlers = {
  create_canvas_workflow: async (args = {}, ctx = {}) => {
    const projectId = String(ctx.projectId || '').trim()
    if (!projectId) {
      return { success: false, error: '请先选择项目' }
    }

    const name = String(args.name || '').trim() || '未命名工作流'
    const description = String(args.description || '').trim()
    const rawNodes = Array.isArray(args.nodes) ? args.nodes : []
    const rawEdges = Array.isArray(args.edges) ? args.edges : []

    const limitCheck = agentWorkflows.validateWorkflowPayload({ name, description, nodes: rawNodes, edges: rawEdges })
    if (!limitCheck.valid) {
      return { success: false, error: limitCheck.error, error_type: limitCheck.code }
    }

    if (rawNodes.length < 3) {
      return { success: false, error: '至少需要 3 个节点（input + work + output）' }
    }

    const nodes = rawNodes.map((node, i) => normalizeNode(node, i))
    const edges = rawEdges.map((edge, i) => normalizeEdge(edge, i))

    const validation = validateWorkflowStructure(nodes, edges)
    if (!validation.valid) {
      return { success: false, error: validation.error }
    }

    const workflow = {
      version: 1,
      id: createId('workflow'),
      name,
      description,
      nodes,
      edges,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }

    const saved = agentWorkflows.saveWorkflow(projectId, workflow)

    // 通知前端刷新画布并切换视图
    notifyRenderer(projectId, saved)

    const workNodes = nodes.filter(n => n.type === 'work')
    return {
      success: true,
      workflow: saved,
      summary: {
        name: saved.name,
        id: saved.id,
        nodeCount: nodes.length,
        workNodeCount: workNodes.length,
        edgeCount: edges.length,
        nodes: workNodes.map(n => ({ name: n.name, task: n.task.slice(0, 100) }))
      },
      message: `工作流「${saved.name}」已创建并保存，包含 ${workNodes.length} 个工作节点。画布视图已自动切换。`
    }
  }
}

module.exports = { handlers }
