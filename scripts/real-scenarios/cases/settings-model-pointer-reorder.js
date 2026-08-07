const fs = require('fs')
const path = require('path')
const vm = require('vm')

function createClassList() {
  const values = new Set()
  return {
    add(...names) { names.forEach(name => values.add(name)) },
    remove(...names) { names.forEach(name => values.delete(name)) },
    contains(name) { return values.has(name) }
  }
}

function createHandle() {
  const listeners = new Map()
  const attributes = new Map()
  return {
    draggable: true,
    addEventListener(type, listener) { listeners.set(type, listener) },
    setAttribute(name, value) { attributes.set(name, value) },
    setPointerCapture() {},
    hasPointerCapture() { return false },
    dispatch(type, event) { listeners.get(type)?.(event) },
    attributes
  }
}

function createItem(index) {
  const handle = createHandle()
  const listeners = new Map()
  const item = {
    dataset: { index: String(index) },
    draggable: true,
    classList: createClassList(),
    addEventListener(type, listener) { listeners.set(type, listener) },
    setPointerCapture() {},
    hasPointerCapture() { return false },
    dispatch(type, event) { listeners.get(type)?.(event) },
    querySelector() { return handle },
    matches(selector) { return selector === '.item' },
    closest(selector) { return selector === '.item' ? item : null }
  }
  return { item, handle }
}

module.exports = {
  id: 'settings-model.pointer-reorder',
  title: 'Settings model lists reorder reliably with pointer input',
  tags: ['ui', 'settings', 'models', 'drag'],
  paths: [
    'frontend/scripts/features/settings-main.js',
    'frontend/styles/settings.css'
  ],
  async run(ctx) {
    const source = fs.readFileSync(path.join(ctx.root, 'frontend/scripts/features/settings-main.js'), 'utf8')
    const css = fs.readFileSync(path.join(ctx.root, 'frontend/styles/settings.css'), 'utf8')
    const sandbox = { window: {}, console, setTimeout, clearTimeout }
    vm.runInNewContext(source, sandbox, { filename: 'settings-main.js' })
    const bindPointerReorder = sandbox.window.SettingsMain?.bindPointerReorder
    ctx.assert.equal(typeof bindPointerReorder, 'function', 'pointer reorder helper must be exported for regression coverage')

    const entries = [createItem(0), createItem(1), createItem(2)]
    const docListeners = new Map()
    const doc = {
      body: { classList: createClassList() },
      addEventListener(type, listener) { docListeners.set(type, listener) },
      removeEventListener(type, listener) {
        if (docListeners.get(type) === listener) docListeners.delete(type)
      }
    }
    const list = {
      ownerDocument: doc,
      querySelectorAll() { return entries.map(entry => entry.item) },
      contains(item) { return entries.some(entry => entry.item === item) }
    }
    const moves = []
    bindPointerReorder({
      list,
      itemSelector: '.item',
      handleSelector: '.handle',
      getIndex: item => Number(item.dataset.index),
      getTargetAtPoint: () => entries[2].item,
      onMove: (fromIndex, toIndex) => moves.push([fromIndex, toIndex])
    })

    const pointerEvent = values => ({
      pointerId: 7,
      button: 0,
      isPrimary: true,
      clientX: 0,
      clientY: 0,
      preventDefault() {},
      ...values
    })
    entries[0].item.dispatch('pointerdown', pointerEvent({ target: entries[0].item }))
    ctx.assert.ok(entries[0].item.classList.contains('drag-armed'), 'pressing anywhere on the card must show immediate feedback')
    docListeners.get('pointermove')(pointerEvent({ clientX: 20, clientY: 20 }))
    ctx.assert.ok(entries[2].item.classList.contains('drag-over'), 'the item under the pointer must show the drop target')
    docListeners.get('pointerup')(pointerEvent({ clientX: 20, clientY: 20 }))
    ctx.assert.deepEqual(moves[0], [0, 2], 'pointer release must commit source and target indexes')
    ctx.assert.ok(!entries[0].item.classList.contains('dragging'), 'dragging state must be cleaned after release')
    ctx.assert.ok(!entries[0].item.classList.contains('drag-armed'), 'pressed state must be cleaned after release')
    ctx.assert.equal(entries[0].item.draggable, false, 'native HTML drag must be disabled to avoid Electron conflicts')

    let keyboardPrevented = false
    entries[0].handle.dispatch('keydown', {
      key: 'ArrowDown',
      preventDefault() { keyboardPrevented = true }
    })
    ctx.assert.deepEqual(moves[1], [0, 1], 'drag handles must also support keyboard reordering')
    ctx.assert.ok(keyboardPrevented, 'keyboard reorder must prevent page scrolling')
    ctx.assert.ok(source.includes('class="settings-model-handle"'), 'saved model cards must expose a real drag handle')
    ctx.assert.ok(!source.includes('data-index="${index}" draggable="true"'), 'routing cards must not fall back to native HTML drag')
    ctx.assert.ok(css.includes('touch-action: none'), 'drag handles must retain pointer events on touch devices')
    ctx.assert.ok(css.includes('.settings-model-item.drag-armed'), 'pressed cards must provide immediate visual feedback')
  }
}
