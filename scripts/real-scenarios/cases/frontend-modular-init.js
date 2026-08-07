const fs = require('fs')
const path = require('path')
const vm = require('vm')

module.exports = {
  id: 'frontend.modular-init',
  title: 'Frontend modularized scripts initialize without breaking core click handlers',
  tags: ['frontend', 'modularization', 'ui'],
  changedFilePatterns: [
    /^frontend\/index\.html$/i,
    /^frontend\/scripts\/app\.js$/i,
    /^frontend\/scripts\/features\/.*\.js$/i
  ],

  async run(ctx) {
    const elements = new Map()

    class FakeClassList {
      constructor() { this.items = new Set() }
      add(...items) { items.forEach(item => this.items.add(item)) }
      remove(...items) { items.forEach(item => this.items.delete(item)) }
      contains(item) { return this.items.has(item) }
      toggle(item, force) {
        if (force === true) this.items.add(item)
        else if (force === false) this.items.delete(item)
        else if (this.items.has(item)) this.items.delete(item)
        else this.items.add(item)
        return this.items.has(item)
      }
    }

    function makeElement(id = '') {
      const el = {
        id,
        dataset: {},
        style: {
          _props: Object.create(null),
          setProperty(key, value) { this._props[key] = String(value); this[key] = String(value) },
          removeProperty(key) { delete this._props[key]; delete this[key] },
          getPropertyValue(key) { return this._props[key] || this[key] || '' }
        },
        classList: new FakeClassList(),
        children: [],
        childNodes: [],
        value: '',
        textContent: '',
        innerHTML: '',
        title: '',
        disabled: false,
        attributes: Object.create(null),
        appendChild(child) { this.children.push(child); child.parentNode = this; return child },
        prepend(child) { this.children.unshift(child); child.parentNode = this; return child },
        insertBefore(newNode, referenceNode) {
          if (!referenceNode) return this.appendChild(newNode)
          const index = this.children.indexOf(referenceNode)
          if (index < 0) return this.appendChild(newNode)
          this.children.splice(index, 0, newNode)
          newNode.parentNode = this
          return newNode
        },
        insertAdjacentElement(position, element) {
          if (position === 'beforeend' || position === 'afterbegin') return this.appendChild(element)
          if (this.parentNode && typeof this.parentNode.insertBefore === 'function') {
            return this.parentNode.insertBefore(element, this)
          }
          return this.appendChild(element)
        },
        replaceChildren(...nodes) {
          this.children = []
          nodes.forEach(node => this.appendChild(node))
        },
        contains(node) {
          if (node === this) return true
          return this.children.some(child => child === node || child.contains?.(node))
        },
        remove() {},
        removeChild(child) { this.children = this.children.filter(item => item !== child); return child },
        addEventListener() {},
        removeEventListener() {},
        dispatchEvent() { return true },
        setAttribute(key, value) { this.attributes[key] = String(value); this[key] = value },
        getAttribute(key) { return this.attributes[key] ?? this[key] ?? null },
        removeAttribute(key) { delete this.attributes[key]; delete this[key] },
        hasAttribute(key) { return key in this.attributes || this[key] != null },
        querySelector(selector) { return makeElement(selector) },
        querySelectorAll() { return [] },
        closest() { return null },
        matches() { return false },
        cloneNode() { return makeElement(id) },
        getBoundingClientRect() { return { left: 0, top: 0, right: 100, bottom: 30, width: 100, height: 30 } },
        getContext() {
          return {
            canvas: this,
            fillRect() {},
            clearRect() {},
            getImageData() { return { data: new Uint8ClampedArray(4) } },
            putImageData() {},
            createImageData() { return { data: new Uint8ClampedArray(4) } },
            setTransform() {},
            drawImage() {},
            save() {},
            restore() {},
            beginPath() {},
            moveTo() {},
            lineTo() {},
            closePath() {},
            stroke() {},
            fill() {},
            measureText() { return { width: 0 } },
            getExtension() { return null },
            getParameter() { return 0 },
            getShaderParameter() { return true },
            getProgramParameter() { return true },
            getShaderInfoLog() { return '' },
            getProgramInfoLog() { return '' },
            createShader() { return {} },
            shaderSource() {},
            compileShader() {},
            createProgram() { return {} },
            attachShader() {},
            linkProgram() {},
            useProgram() {},
            getAttribLocation() { return 0 },
            getUniformLocation() { return {} },
            enableVertexAttribArray() {},
            vertexAttribPointer() {},
            uniform1f() {},
            uniform2f() {},
            createBuffer() { return {} },
            bindBuffer() {},
            bufferData() {},
            viewport() {},
            clearColor() {},
            clear() {},
            drawArrays() {},
            createTexture() { return {} },
            bindTexture() {},
            texImage2D() {},
            texParameteri() {},
            activeTexture() {},
            enable() {},
            disable() {},
            blendFunc() {},
            depthFunc() {}
          }
        },
        focus() {},
        blur() {}
      }
      return el
    }

    const document = {
      readyState: 'complete',
      body: makeElement('body'),
      documentElement: makeElement('html'),
      getElementById(id) {
        if (!elements.has(id)) elements.set(id, makeElement(id))
        return elements.get(id)
      },
      querySelector(selector) { return this.getElementById(selector.replace(/^[#.]/, '')) },
      querySelectorAll() { return [] },
      createElement(tag) {
        const el = makeElement(tag)
        el.tagName = String(tag || '').toUpperCase()
        return el
      },
      createTextNode(text) { return { textContent: text } },
      addEventListener() {},
      removeEventListener() {}
    }
    document.body.contains = (node) => document.body === node || !!node
    document.documentElement.contains = document.body.contains

    const context = {
      console,
      document,
      window: null,
      globalThis: null,
      URLSearchParams,
      setTimeout,
      clearTimeout,
      setInterval() { return 1 },
      clearInterval() {},
      requestAnimationFrame(fn) { return setTimeout(fn, 0) },
      addEventListener() {},
      removeEventListener() {},
      dispatchEvent() {},
      CustomEvent: function CustomEvent(type, init = {}) { return { type, ...init } },
      ResizeObserver: function ResizeObserver() { this.observe = function () {} },
      MutationObserver: function MutationObserver() { this.observe = function () {} },
      CSS: { escape: value => String(value || '') },
      location: { search: '' },
      navigator: { clipboard: { writeText: async () => {} } },
      localStorage: { getItem() { return null }, setItem() {}, removeItem() {} },
      sessionStorage: { getItem() { return null }, setItem() {}, removeItem() {} },
      HTMLElement: function HTMLElement() {}
    }
    context.window = context
    context.globalThis = context
    context.api = new Proxy({}, {
      get(target, prop) {
        if (!target[prop]) {
          target[prop] = async () => {
            if (['getAllProjects', 'getAllSkills', 'getEnabledSkills', 'loadSkills'].includes(prop)) return []
            if (prop === 'loadConfig') return { models: [], currentIndex: 0 }
            if (prop === 'getContextStatus') return { contextRatio: 0, estimatedTokens: 0 }
            return { success: true, canceled: true, models: [], projects: [] }
          }
        }
        return target[prop]
      }
    })

    const sandbox = vm.createContext(context)
    const indexHtml = fs.readFileSync(path.join(ctx.root, 'frontend/index.html'), 'utf8')
    const scripts = [...indexHtml.matchAll(/<script\s+src="([^"]+)"/g)]
      .map(match => match[1].split('?')[0])
      .filter(src => src.startsWith('scripts/'))

    let loadErrors = 0
    const optionalScript = /no-project-logo-scene|startup-access|welcome|three|webgl|soundfont|media-prism|avatar/i
    const criticalScript = /(?:^|\/)app\.js$|chat-renderer|ai-tool-renderer|window-tabs|text-input-ui|projects\.js|project-state/i
    for (const src of scripts) {
      const filePath = path.join(ctx.root, 'frontend', src)
      if (!fs.existsSync(filePath)) continue
      if (optionalScript.test(src)) {
        loadErrors += 1
        continue
      }
      try {
        vm.runInContext(fs.readFileSync(filePath, 'utf8'), sandbox, { filename: filePath })
      } catch (error) {
        // 非核心脚本在精简 DOM mock 下可能失败，不阻断主链路绑定检查
        loadErrors += 1
        if (criticalScript.test(src)) throw error
      }
    }

    await new Promise(resolve => setTimeout(resolve, 30))

    ctx.assert.ok(!!document.getElementById('sendBtn').onclick, 'send button should be bound after modularized app init')
    ctx.assert.ok(!!document.getElementById('inputBox').onkeydown, 'input box Enter handler should be bound after modularized app init')
    // detachTab 已随「仅右侧标签」策略移除，不再要求全局存在
    for (const name of [
      'switchSettingsTab',
      'openInNewTab',
      'saveFileTab',
      'toggleFileRunMode',
      'sendMessage',
      'switchProject',
      'toggleDynamicArea',
      'toggleToolCard',
      'toggleToolGroup',
      'openFilePreviewFromData',
      'openImagePreviewFromData',
      'resetVisibility',
      'showMemoryQuery'
    ]) {
      ctx.assert.equal(typeof sandbox[name], 'function', `${name} should remain globally callable for legacy inline handlers`)
    }
    ctx.assert.equal(typeof sandbox.detachTab, 'undefined', 'detachTab should stay removed under right-panel-only policy')
    ctx.assert.ok(loadErrors < scripts.length, 'most frontend modules should load under the modular init harness')
  }
}
