const fs = require('fs')
const path = require('path')
const vm = require('vm')

module.exports = {
  id: 'canvas-workflow.index-save-queue',
  title: 'Canvas workflow list uses metadata index and drag saves are throttled',
  tags: ['canvas', 'workflow', 'performance'],
  changedFilePatterns: [
    /^electron\/modules\/agent-workflow(?:s|-index|-policy)\.js$/i,
    /^electron\/preload\.js$/i,
    /^frontend\/scripts\/(?:canvas-view|features\/canvas-workflow-save-queue|features\/canvas-workflows|features\/canvas-inspector)\.js$/i
  ],

  async run(ctx) {
    const workspace = ctx.createWorkspace(this.id)
    const workflowDir = path.join(workspace.storagePath, 'workflows')
    const indexPath = path.join(workspace.storagePath, 'index.json')
    fs.mkdirSync(workflowDir, { recursive: true })
    for (let index = 0; index < 40; index++) {
      fs.writeFileSync(path.join(workflowDir, `workflow-${index}.json`), JSON.stringify({
        id: `workflow-${index}`,
        name: `Workflow ${index}`,
        updatedAt: new Date(2026, 0, index + 1).toISOString(),
        nodes: Array.from({ length: 20 }, (_, nodeIndex) => ({ id: `node-${nodeIndex}`, task: 'x'.repeat(2000) }))
      }))
    }

    try {
      const indexStore = require(path.join(ctx.root, 'electron/modules/agent-workflow-index'))
      const first = indexStore.list(indexPath, workflowDir)
      ctx.assert.equal(first.length, 40, 'initial index build should discover workflow metadata')
      fs.writeFileSync(path.join(workflowDir, 'workflow-39.json'), '{broken-json')
      const indexed = indexStore.list(indexPath, workflowDir)
      ctx.assert.equal(indexed.length, 40, 'normal list reads should use the index instead of reparsing workflow bodies')
      indexStore.upsert(indexPath, workflowDir, { id: 'workflow-39', name: 'Updated', updatedAt: '2026-07-14', nodes: [] })
      ctx.assert.equal(indexStore.list(indexPath, workflowDir)[0].name, 'Updated', 'save should update one index record incrementally')

      const policy = require(path.join(ctx.root, 'electron/modules/agent-workflow-policy'))
      const bounded = {
        name: 'Bounded workflow',
        nodes: Array.from({ length: policy.MAX_NODES }, (_, nodeIndex) => ({ id: `node-${nodeIndex}`, task: 'bounded' })),
        edges: Array.from({ length: policy.MAX_EDGES }, (_, edgeIndex) => ({ id: `edge-${edgeIndex}`, source: 'node-0', target: 'node-1' }))
      }
      ctx.assert.ok(policy.validateWorkflowPayload(bounded).valid, 'workflow payload should accept values at the configured limits')
      ctx.assert.equal(policy.validateWorkflowPayload({ ...bounded, nodes: [...bounded.nodes, { id: 'overflow' }] }).code, 'WORKFLOW_NODE_LIMIT', 'save and execution should reject excess nodes instead of silently truncating')
      ctx.assert.equal(policy.validateWorkflowPayload({ nodes: [{ id: 'node', task: 'x'.repeat(policy.FIELD_LIMITS.task + 1) }] }).code, 'WORKFLOW_FIELD_LIMIT', 'oversized node fields should be rejected')
      ctx.assert.equal(policy.validateWorkflowPayload({ nodes: [], edges: [], ignoredBlob: 'x'.repeat(policy.MAX_WORKFLOW_BYTES + 1) }).code, 'WORKFLOW_TOO_LARGE', 'total workflow IPC payload should have a byte limit')

      const collaborationSource = fs.readFileSync(path.join(ctx.root, 'electron/modules/agent-collaboration.js'), 'utf8')
      ctx.assert.ok(/assertWorkflowPayload\(payload\.workflow\)/.test(collaborationSource), 'workflow execution must apply the same backend payload policy as saving')

      const source = fs.readFileSync(path.join(ctx.root, 'frontend/scripts/features/canvas-workflow-save-queue.js'), 'utf8')
      const sandbox = { window: {}, console, setTimeout, clearTimeout }
      vm.createContext(sandbox)
      vm.runInContext(source, sandbox)
      let writes = 0
      let snapshot = 0
      const queue = sandbox.window.CanvasWorkflowSaveQueue.create({
        getSnapshot: () => snapshot,
        persist: async value => {
          writes++
          return value
        }
      })
      for (let move = 0; move < 25; move++) {
        snapshot = move
        queue.markChanged()
        queue.schedule(100)
      }
      await new Promise(resolve => setTimeout(resolve, 180))
      ctx.assert.equal(writes, 1, 'many drag updates should collapse into one delayed save')
    } finally {
      workspace.cleanup()
    }
  }
}
