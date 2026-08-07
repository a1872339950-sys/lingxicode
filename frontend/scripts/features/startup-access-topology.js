const CONFIG = {
  spacing: 78,
  influenceRadius: 190,
  holdTime: 240,
  fadeDuration: 900,
  pulseSpeed: 610,
  baseOpacity: 0.022,
  maxOpacity: 0.52
}

const state = {
  canvas: null,
  host: null,
  context: null,
  width: 1,
  height: 1,
  dpr: 1,
  columns: 0,
  rows: 0,
  offsetX: 0,
  offsetY: 0,
  rowHeight: 1,
  nodes: [],
  levels: new Float32Array(0),
  touched: new Float64Array(0),
  pulses: [],
  colors: [[34, 211, 238], [139, 92, 246]],
  running: false,
  frameId: 0,
  lastFrame: 0,
  listenersBound: false,
  resizeObserver: null,
  themeObserver: null,
  reducedMotion: window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches === true
}

function parseColor(value, fallback) {
  const match = String(value || '').trim().match(/^#([0-9a-f]{6})$/i)
  if (!match) return fallback
  const number = Number.parseInt(match[1], 16)
  return [(number >> 16) & 255, (number >> 8) & 255, number & 255]
}

function readThemeColors() {
  const styles = getComputedStyle(document.documentElement)
  state.colors = [
    parseColor(styles.getPropertyValue('--accent-primary'), [34, 211, 238]),
    parseColor(styles.getPropertyValue('--accent-secondary'), [139, 92, 246])
  ]
}

function nodeIndex(row, column) {
  return row * state.columns + column
}

function rebuild() {
  if (!state.canvas || !state.host || !state.context) return
  const rect = state.host.getBoundingClientRect()
  state.width = Math.max(1, Math.round(rect.width))
  state.height = Math.max(1, Math.round(rect.height))
  state.dpr = Math.min(1.75, Math.max(1, window.devicePixelRatio || 1))
  state.canvas.width = Math.round(state.width * state.dpr)
  state.canvas.height = Math.round(state.height * state.dpr)
  state.canvas.style.width = `${state.width}px`
  state.canvas.style.height = `${state.height}px`
  state.context.setTransform(state.dpr, 0, 0, state.dpr, 0, 0)

  state.rowHeight = CONFIG.spacing * Math.sqrt(3) / 2
  state.columns = Math.ceil(state.width / CONFIG.spacing) + 3
  state.rows = Math.ceil(state.height / state.rowHeight) + 3
  state.offsetX = (state.width - (state.columns - 1) * CONFIG.spacing) / 2
  state.offsetY = (state.height - (state.rows - 1) * state.rowHeight) / 2
  state.nodes = []

  for (let row = 0; row < state.rows; row += 1) {
    for (let column = 0; column < state.columns; column += 1) {
      state.nodes.push({
        x: state.offsetX + column * CONFIG.spacing + (row % 2 ? CONFIG.spacing / 2 : 0),
        y: state.offsetY + row * state.rowHeight,
        row,
        column
      })
    }
  }

  state.levels = new Float32Array(state.nodes.length)
  state.touched = new Float64Array(state.nodes.length)
  draw(performance.now(), true)
}

function energize(x, y, boost = 1) {
  const now = performance.now()
  const radius = CONFIG.influenceRadius

  state.nodes.forEach((node, index) => {
    const distance = Math.hypot(node.x - x, node.y - y)
    if (distance > radius) return
    const normalized = 1 - distance / radius
    const smooth = normalized * normalized * (3 - 2 * normalized)
    const level = Math.min(CONFIG.maxOpacity, smooth * CONFIG.maxOpacity * boost)
    state.levels[index] = Math.max(state.levels[index], level)
    state.touched[index] = now
  })
}

function updatePulses(now) {
  const diagonal = Math.hypot(state.width, state.height)
  for (let pulseIndex = state.pulses.length - 1; pulseIndex >= 0; pulseIndex -= 1) {
    const pulse = state.pulses[pulseIndex]
    const radius = ((now - pulse.startedAt) / 1000) * CONFIG.pulseSpeed
    if (radius > diagonal) {
      state.pulses.splice(pulseIndex, 1)
      continue
    }
    const band = CONFIG.spacing * 0.72
    state.nodes.forEach((node, index) => {
      const distance = Math.hypot(node.x - pulse.x, node.y - pulse.y)
      if (Math.abs(distance - radius) > band) return
      const energy = 1 - Math.abs(distance - radius) / band
      state.levels[index] = Math.max(state.levels[index], energy * CONFIG.maxOpacity)
      state.touched[index] = now
    })
  }
}

function getNeighbors(node) {
  const neighbors = []
  if (node.column + 1 < state.columns) neighbors.push(nodeIndex(node.row, node.column + 1))
  if (node.row + 1 < state.rows) {
    const downColumn = node.row % 2 ? node.column + 1 : node.column
    if (downColumn >= 0 && downColumn < state.columns) neighbors.push(nodeIndex(node.row + 1, downColumn))
  }
  return neighbors
}

function blendedColor(level, bias = 0) {
  const mix = Math.max(0, Math.min(1, level * 1.8 + bias))
  const first = state.colors[0]
  const second = state.colors[1]
  return [
    Math.round(first[0] + (second[0] - first[0]) * mix),
    Math.round(first[1] + (second[1] - first[1]) * mix),
    Math.round(first[2] + (second[2] - first[2]) * mix)
  ]
}

function drawNodeGlyph(node, level, now) {
  if (level < 0.08) return
  const context = state.context
  const size = 3.2 + level * 8
  const rotation = ((node.row + node.column) % 3) * (Math.PI * 2 / 3) + now * 0.00005
  const color = blendedColor(level, ((node.row + node.column) % 2) * 0.18)
  context.beginPath()
  for (let corner = 0; corner < 3; corner += 1) {
    const angle = rotation + corner * (Math.PI * 2 / 3)
    const x = node.x + Math.cos(angle) * size
    const y = node.y + Math.sin(angle) * size
    if (corner === 0) context.moveTo(x, y)
    else context.lineTo(x, y)
  }
  context.closePath()
  context.strokeStyle = `rgba(${color[0]}, ${color[1]}, ${color[2]}, ${Math.min(0.78, level * 1.3)})`
  context.lineWidth = 0.8 + level
  context.stroke()
}

function draw(now, staticOnly = false) {
  if (!state.context) return
  const context = state.context
  const dt = state.lastFrame ? Math.min(50, now - state.lastFrame) : 16
  state.lastFrame = now
  context.clearRect(0, 0, state.width, state.height)
  if (!staticOnly) updatePulses(now)

  let active = state.pulses.length > 0
  const fadeStep = dt / CONFIG.fadeDuration

  state.nodes.forEach((node, index) => {
    let level = state.levels[index]
    if (!staticOnly && level > 0 && now - state.touched[index] > CONFIG.holdTime) {
      level = Math.max(0, level - fadeStep)
      state.levels[index] = level
    }
    if (level > 0.001) active = true

    getNeighbors(node).forEach(neighborIndex => {
      const neighbor = state.nodes[neighborIndex]
      const edgeLevel = Math.max(level, state.levels[neighborIndex])
      const opacity = CONFIG.baseOpacity + edgeLevel * 0.7
      const color = blendedColor(edgeLevel, (index % 4) * 0.04)
      context.beginPath()
      context.moveTo(node.x, node.y)
      context.lineTo(neighbor.x, neighbor.y)
      context.strokeStyle = `rgba(${color[0]}, ${color[1]}, ${color[2]}, ${opacity})`
      context.lineWidth = 0.55 + edgeLevel * 1.45
      context.stroke()
    })

    drawNodeGlyph(node, level, now)
  })

  if (active && !state.reducedMotion) {
    state.frameId = requestAnimationFrame(draw)
  } else {
    state.running = false
    state.frameId = 0
  }
}

function wake() {
  if (state.running || !state.context) return
  state.running = true
  state.lastFrame = performance.now()
  state.frameId = requestAnimationFrame(draw)
}

function toLocal(event) {
  const rect = state.host.getBoundingClientRect()
  return [event.clientX - rect.left, event.clientY - rect.top]
}

function onPointerMove(event) {
  const [x, y] = toLocal(event)
  energize(x, y)
  wake()
}

function onPointerDown(event) {
  const [x, y] = toLocal(event)
  state.pulses.push({ x, y, startedAt: performance.now() })
  energize(x, y, 1.45)
  wake()
}

function bindListeners() {
  if (state.listenersBound || !state.host) return
  state.listenersBound = true
  if (!state.reducedMotion) {
    state.host.addEventListener('pointermove', onPointerMove, { passive: true })
    state.host.addEventListener('pointerdown', onPointerDown, { passive: true })
  }
  state.resizeObserver = new ResizeObserver(rebuild)
  state.resizeObserver.observe(state.host)
  state.themeObserver = new MutationObserver(() => {
    readThemeColors()
    draw(performance.now(), true)
  })
  state.themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'data-theme', 'style'] })
}

function init(canvas = document.getElementById('startupAccessTopology')) {
  if (!canvas) return false
  if (state.canvas) return state.canvas === canvas
  state.canvas = canvas
  state.host = canvas.parentElement
  state.context = canvas.getContext('2d', { alpha: true, desynchronized: true })
  if (!state.context || !state.host) return false
  readThemeColors()
  bindListeners()
  rebuild()
  canvas.dataset.visual = 'lingxi-topology'
  return true
}

function start() {
  if (!state.canvas) init()
  if (!state.context) return
  draw(performance.now(), true)
}

function stop() {
  state.running = false
  if (state.frameId) cancelAnimationFrame(state.frameId)
  state.frameId = 0
  state.pulses.length = 0
}

function dispose() {
  stop()
  state.resizeObserver?.disconnect()
  state.themeObserver?.disconnect()
  if (state.host && state.listenersBound) {
    state.host.removeEventListener('pointermove', onPointerMove)
    state.host.removeEventListener('pointerdown', onPointerDown)
  }
  state.canvas = null
  state.host = null
  state.context = null
  state.listenersBound = false
}

window.StartupAccessTopology = { init, start, stop, dispose }

function autoBoot() {
  const canvas = document.getElementById('startupAccessTopology')
  if (!canvas) return
  init(canvas)
  start()
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', autoBoot, { once: true })
else autoBoot()
