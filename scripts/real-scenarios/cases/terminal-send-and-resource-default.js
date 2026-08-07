const fs = require('fs')
const path = require('path')
const vm = require('vm')

function createElement() {
  return {
    classList: { toggle() {}, add() {}, remove() {} },
    dataset: {},
    disabled: false,
    value: '',
    textContent: '',
    innerHTML: '',
    scrollHeight: 0,
    scrollTop: 0,
    setAttribute() {},
    querySelectorAll() { return [] },
    closest() { return null }
  }
}

module.exports = {
  id: 'terminal.send-to-ai-and-resource-default',
  title: 'Terminal output reaches AI and resource center opens on assets',
  tags: ['frontend', 'terminal', 'resources'],
  changedFilePatterns: [
    /^frontend\/scripts\/app\.js$/i,
    /^frontend\/scripts\/features\/(terminal-panel|integration-market|skills-main)\.js$/i
  ],

  async run(ctx) {
    const root = ctx.root
    const source = fs.readFileSync(path.join(root, 'frontend/scripts/features/terminal-panel.js'), 'utf8')
    const elements = new Map([
      'terminalPanel', 'terminalHead', 'terminalOutput', 'terminalStatusText', 'terminalTabs',
      'terminalNewTabBtn', 'toolbarTerminalBtn', 'terminalStatusLabel', 'terminalStopBtn',
      'terminalClearBtn', 'terminalCopyBtn', 'terminalSendBtn', 'terminalCommandInput',
      'terminalPrompt', 'terminalRunBtn'
    ].map(id => [id, createElement()]))
    const windowObject = {}
    const documentObject = { getElementById: id => elements.get(id) || null }
    const api = {}
    api.onTerminalOutput = callback => { api.emitOutput = callback }
    api.onTerminalStatus = callback => { api.emitStatus = callback }
    let sentPrompt = ''
    const context = vm.createContext({
      window: windowObject,
      document: documentObject,
      HtmlUtils: { escapeHtml: value => String(value || '') },
      navigator: { clipboard: { writeText: async () => {} } },
      requestAnimationFrame: callback => { callback(); return 1 },
      setTimeout: () => 1,
      clearTimeout() {},
      setInterval: () => 1,
      clearInterval() {},
      console
    })
    vm.runInContext(source, context)
    const panel = windowObject.TerminalPanel.bind({
      api,
      getProject: () => ({ id: 'project-a', path: 'C:\\project-a' }),
      onSendToAi: async prompt => { sentPrompt = prompt; return true }
    })
    api.emitStatus({
      projectId: 'project-a',
      session: {
        id: 'session-a',
        status: 'success',
        command: 'npm test',
        cwd: 'C:\\project-a',
        output: [{ stream: 'stdout', text: 'all tests passed' }]
      },
      sessions: []
    })
    ctx.assert.equal(elements.get('terminalSendBtn').disabled, false, 'send button must enable for an active terminal session')
    await elements.get('terminalSendBtn').onclick()
    ctx.assert.ok(sentPrompt.includes('npm test'), 'terminal command must be included in the AI prompt')
    ctx.assert.ok(sentPrompt.includes('all tests passed'), 'terminal output must be included in the AI prompt')
    panel.destroy()

    const app = fs.readFileSync(path.join(root, 'frontend/scripts/app.js'), 'utf8')
    ctx.assert.ok(app.includes('aiMessage: content'), 'terminal bridge must use the message sender internal-message field')
    ctx.assert.ok(!/sendMessage\(\{\s*internalMessage:\s*content/.test(app), 'obsolete internalMessage field must not be used')

    const skills = fs.readFileSync(path.join(root, 'frontend/scripts/features/skills-main.js'), 'utf8')
    const market = fs.readFileSync(path.join(root, 'frontend/scripts/features/integration-market.js'), 'utf8')
    ctx.assert.ok(skills.includes("window.openResourceCenter('assets')"), 'resource center sidebar entry must target assets')
    ctx.assert.ok(market.includes("let activeTab = 'assets'"), 'resource center state must initialize on assets')
    ctx.assert.ok(market.includes("async function openPanel(tab = 'assets')"), 'resource center public entry must default to assets')
  }
}
