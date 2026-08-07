const fs = require('fs')
const path = require('path')
const vm = require('vm')

function deferred() {
  let resolve
  const promise = new Promise(done => { resolve = done })
  return { promise, resolve }
}

module.exports = {
  id: 'context-compression.project-switch-refresh',
  title: 'Context compression counters refresh immediately with the active project',
  tags: ['context-compression', 'project-switch', 'frontend'],
  changedFilePatterns: [
    /^electron\/modules\/ai-chat\.js$/i,
    /^electron\/preload\.js$/i,
    /^frontend\/scripts\/features\/context-memory-ruler\.js$/i,
    /^frontend\/scripts\/features\/quick-model-settings\.js$/i,
    /^frontend\/scripts\/features\/project-switcher\.js$/i,
    /^frontend\/scripts\/app\.js$/i,
    /^frontend\/styles\/context-memory-ruler\.css$/i
  ],

  async run(ctx) {
    const source = fs.readFileSync(
      path.join(ctx.root, 'frontend/scripts/features/context-memory-ruler.js'),
      'utf8'
    )
    const backendSource = fs.readFileSync(path.join(ctx.root, 'electron/modules/ai-chat.js'), 'utf8')
    const preloadSource = fs.readFileSync(path.join(ctx.root, 'electron/preload.js'), 'utf8')
    ctx.assert.match(backendSource, /context-compression-stack'[\s\S]*modelDescriptor[\s\S]*buildContextBudget\(modelName \|\| modelId, configuredLimit\)/)
    ctx.assert.ok(!/context-compression-stack'[\s\S]{0,400}buildContextBudget\(null\)/.test(backendSource), 'context budget must never fall back to a hard-coded default for a selected model')
    ctx.assert.match(preloadSource, /getContextCompressionStack:\s*\(projectId, modelDescriptor = null\)/)
    const listeners = new Map()
    const requests = new Map()
    const apiListeners = new Map()
    let activeProjectId = ''
    const modelDescriptor = {
      modelName: 'GPT-5.6 Terra',
      modelId: 'gpt-5.6-terra',
      contextWindow: 500000,
      apiUrl: 'https://example.test/v1'
    }
    const host = { prepend() {} }
    const stackNode = {
      id: 'contextMemoryStack',
      parentElement: host,
      innerHTML: '',
      classList: { contains: () => false },
      addEventListener() {},
      setAttribute() {}
    }
    const sandbox = {
      window: {
        api: {
          getContextCompressionStack(projectId, descriptor) {
            const request = deferred()
            request.descriptor = descriptor
            requests.set(projectId, request)
            return request.promise
          },
          onAiStatus(callback) { apiListeners.set('status', callback) },
          onToolResult(callback) { apiListeners.set('tool-result', callback) },
          onAiCacheUsage(callback) { apiListeners.set('cache-usage', callback) },
          onReply(callback) { apiListeners.set('reply', callback) }
        },
        addEventListener(type, listener) { listeners.set(type, listener) },
        removeEventListener() {},
        LingxiProjectState: { getActiveProjectId: () => activeProjectId }
      },
      document: {
        readyState: 'loading',
        addEventListener() {},
        getElementById(id) {
          if (id === 'contextMemoryStack') return stackNode
          return null
        },
        querySelector(selector) { return selector === '.chat-input-footer' ? host : null }
      },
      localStorage: {
        length: 0,
        getItem: () => 'true',
        setItem() {},
        key: () => null
      },
      console,
      setTimeout,
      clearTimeout,
      requestAnimationFrame: callback => callback()
    }
    vm.createContext(sandbox)
    vm.runInContext(source, sandbox)

    const onProjectChanged = listeners.get('lingxi:active-project-changed')
    ctx.assert.equal(typeof onProjectChanged, 'function', 'compression stack must subscribe to project changes')
    ctx.assert.equal(typeof listeners.get('lingxi:model-changed'), 'function', 'model changes must trigger a fresh budget calculation')

    sandbox.window.ContextCompressionStack.bind({
      getActiveProject: () => ({ id: activeProjectId }),
      getProjectModel: () => modelDescriptor
    })

    activeProjectId = 'project-a'
    onProjectChanged({ detail: { projectId: 'project-a' } })
    activeProjectId = 'project-b'
    onProjectChanged({ detail: { projectId: 'project-b' } })
    ctx.assert.equal(requests.get('project-b').descriptor.modelName, 'GPT-5.6 Terra')
    ctx.assert.equal(requests.get('project-b').descriptor.contextWindow, 500000)
    ctx.assert.equal(requests.get('project-b').descriptor.apiKey, undefined, 'read-only status descriptor must not expose API keys')
    requests.get('project-b').resolve({
      success: true,
      modelName: 'GPT-5.6 Terra',
      estimatedInputTokens: 118000,
      inputBudgetTokens: 325000,
      maxContextTokens: 500000,
      outputReserveTokens: 60000,
      safetyTokens: 50000,
      usageRatio: 118000 / 325000,
      compressionRatio: 0.4,
      compressionEpoch: 2,
      summaryCount: 3,
      pendingTokens: 97000,
      triggerTokens: 243750,
      status: 'safe'
    })
    await new Promise(resolve => setImmediate(resolve))
    ctx.assert.ok(
      /上下文[\s\S]*118K[\s\S]*325K/.test(stackNode.innerHTML),
      `the current model token budget should render without a click; rendered: ${stackNode.innerHTML}`
    )
    ctx.assert.ok(!/轮/.test(stackNode.innerHTML), 'the compact indicator must not describe variable-size history by turn count')

    const firstProjectBRequest = requests.get('project-b')
    apiListeners.get('tool-result')({ projectId: 'project-b' })
    await new Promise(resolve => setTimeout(resolve, 800))
    const liveProjectBRequest = requests.get('project-b')
    ctx.assert.notEqual(liveProjectBRequest, firstProjectBRequest, 'tool progress must refresh the compact number without a click')
    liveProjectBRequest.resolve({
      success: true,
      modelName: 'GPT-5.6 Terra',
      estimatedInputTokens: 126000,
      inputBudgetTokens: 325000,
      maxContextTokens: 500000,
      usageRatio: 126000 / 325000,
      status: 'safe'
    })
    await new Promise(resolve => setImmediate(resolve))
    ctx.assert.ok(/126K[\s\S]*325K/.test(stackNode.innerHTML), 'live tool progress should update the visible number')

    requests.get('project-a').resolve({
      success: true,
      modelName: 'old-model',
      estimatedInputTokens: 99000,
      inputBudgetTokens: 100000,
      usageRatio: 0.99,
      status: 'urgent'
    })
    await new Promise(resolve => setImmediate(resolve))
    ctx.assert.ok(/126K[\s\S]*325K/.test(stackNode.innerHTML), 'late old-project results must not overwrite the active model budget')
  }
}
