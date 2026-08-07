const fs = require('fs')
const path = require('path')
const vm = require('vm')

function createNode() {
  const node = {
    children: [],
    parentNode: null,
    style: {},
    dataset: {},
    className: '',
    firstChild: null,
    scrollHeight: 1000,
    scrollTop: 0,
    clientHeight: 500,
    setAttribute(name, value) {
      this[name] = value
      if (name === 'data-position') this.dataset.position = value
    },
    addEventListener() {},
    removeEventListener() {},
    appendChild(child) {
      child.parentNode?.removeChild?.(child)
      child.parentNode = this
      this.children.push(child)
      this.firstChild = this.children[0] || null
    },
    insertBefore(child, before) {
      child.parentNode?.removeChild?.(child)
      child.parentNode = this
      const index = this.children.indexOf(before)
      if (index < 0) this.children.push(child)
      else this.children.splice(index, 0, child)
      this.firstChild = this.children[0] || null
    },
    removeChild(child) {
      this.children = this.children.filter(item => item !== child)
      child.parentNode = null
      this.firstChild = this.children[0] || null
    },
    remove() {
      this.parentNode?.removeChild?.(this)
    },
    querySelector(selector) {
      const position = /data-position="([^"]+)"/.exec(selector)?.[1]
      return this.children.find(child =>
        String(child.className || '').includes('chat-history-paginator-indicator') &&
        (!position || child.dataset.position === position)
      ) || null
    }
  }
  return node
}

module.exports = {
  id: 'chat-history.paginator-cache',
  title: 'Chat history paginator bounds its page cache and reloads evicted pages',
  tags: ['chat-history', 'pagination', 'frontend'],
  changedFilePatterns: [
    /^frontend\/scripts\/features\/chat-history-paginator\.js$/i,
    /^frontend\/scripts\/features\/project-switcher\.js$/i,
    /^frontend\/scripts\/app\.js$/i
  ],

  async run(ctx) {
    const source = fs.readFileSync(path.join(ctx.root, 'frontend/scripts/features/chat-history-paginator.js'), 'utf8')
    const rafQueue = []
    const sandbox = {
      window: {},
      document: { createElement: createNode },
      console,
      requestAnimationFrame: callback => rafQueue.push(callback)
    }
    vm.createContext(sandbox)
    vm.runInContext(source, sandbox)

    const paginator = sandbox.window.ChatHistoryPaginator
    const container = createNode()
    const requests = []
    const renderer = {
      restoreChatHistory(messages) {
        container.scrollHeight = 1000 + messages.length * 10
      }
    }
    const loadPage = async (projectId, options) => {
      requests.push({ projectId, ...options })
      const index = Number(options.cursor)
      const isOlder = options.direction === 'older'
      return {
        success: true,
        messages: [{ role: 'user', content: `page-${index}`, messageId: `message-${index}` }],
        range: { startIndex: index, endIndex: index, totalChunks: 10 },
        nextCursor: isOlder
          ? (index > 0 ? index - 1 : null)
          : (index < 9 ? index + 1 : null),
        hasMore: isOlder ? index > 0 : index < 9
      }
    }

    paginator.reset({
      container,
      renderer,
      messagesHistory: [{ role: 'user', content: 'page-9', messageId: 'message-9' }],
      projectId: 'project-a',
      range: { startIndex: 9, endIndex: 9, totalChunks: 10 },
      nextCursor: 8,
      hasMore: true,
      loadPage
    })
    while (rafQueue.length) rafQueue.shift()()

    for (let index = 0; index < 6; index++) await paginator.loadOlder()
    let state = paginator.getState()
    ctx.assert.equal(state.pages.length, 6, 'paginator should retain at most six pages')
    ctx.assert.ok(state.hasNewer, 'evicting the newest page while loading older history should expose a newer cursor')
    ctx.assert.equal(state.newerCursor, 9, 'newer cursor should point at the evicted boundary page')
    ctx.assert.ok(requests.every(request => request.includeMetadata === false), 'scroll pagination should skip repeated session metadata scans')

    await paginator.loadNewer()
    state = paginator.getState()
    ctx.assert.equal(state.pages.length, 6, 'reloading an evicted newer page should keep the cache bounded')
    ctx.assert.ok(state.pages.some(page => page.range.startIndex === 9), 'the evicted newest page should be recoverable')
    ctx.assert.ok(state.hasOlder, 'evicting an old page while moving forward should expose an older cursor')

    const rendered = []
    paginator.reset({
      container,
      renderer: { restoreChatHistory: () => rendered.push('stale') },
      messagesHistory: [],
      projectId: 'stale-project'
    })
    paginator.reset({
      container,
      renderer: { restoreChatHistory: () => rendered.push('current') },
      messagesHistory: [],
      projectId: 'current-project'
    })
    while (rafQueue.length) rafQueue.shift()()
    ctx.assert.deepEqual(rendered, ['current'], 'a stale project reset must not render after a newer reset')
    paginator.destroy()
  }
}
