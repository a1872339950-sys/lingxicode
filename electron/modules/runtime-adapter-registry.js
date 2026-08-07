const adapters = new Map()

const CAPABILITY_KEYS = [
  'dom',
  'semantic_action',
  'screenshot',
  'console',
  'network',
  'accessibility',
  'native_input'
]

function normalizeCapabilities(input = {}) {
  return Object.fromEntries(CAPABILITY_KEYS.map(key => [key, input[key] === true]))
}

function registerRuntimeAdapter(definition = {}) {
  const id = String(definition.id || '').trim().toLowerCase()
  if (!id) throw new Error('runtime adapter id is required')
  const normalized = {
    id,
    title: String(definition.title || id),
    protocol: String(definition.protocol || 'lingxi-runtime-target/v1'),
    implemented: definition.implemented !== false,
    capabilities: normalizeCapabilities(definition.capabilities)
  }
  adapters.set(id, normalized)
  return normalized
}

function getRuntimeAdapter(id = '') {
  return adapters.get(String(id || '').trim().toLowerCase()) || null
}

function listRuntimeAdapters(options = {}) {
  const includePlanned = options.includePlanned === true || options.include_planned === true
  return [...adapters.values()].filter(adapter => includePlanned || adapter.implemented)
}

registerRuntimeAdapter({
  id: 'electron',
  title: 'Electron WebContents',
  capabilities: { dom: true, semantic_action: true, screenshot: true, console: true, network: true }
})

registerRuntimeAdapter({
  id: 'browser',
  title: 'Browser Development Server',
  capabilities: { dom: true, semantic_action: true, screenshot: true, console: true, network: true }
})

registerRuntimeAdapter({
  id: 'windows-uia',
  title: 'Windows UI Automation',
  implemented: process.platform === 'win32',
  capabilities: { semantic_action: true, screenshot: true, accessibility: true, native_input: false }
})

registerRuntimeAdapter({
  id: 'screenshot-only',
  title: 'Screenshot-only Runtime',
  implemented: false,
  capabilities: { screenshot: true }
})

module.exports = {
  CAPABILITY_KEYS,
  getRuntimeAdapter,
  listRuntimeAdapters,
  normalizeCapabilities,
  registerRuntimeAdapter
}
