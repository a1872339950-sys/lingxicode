/**
 * Central registry for tool schemas, executable handlers, and tool metadata.
 *
 * Model-facing schemas are separated from internal atomic handlers. Composite
 * tools dispatch to those atoms through this registry so authorization,
 * recovery points, and result validation remain centralized.
 */

const path = require('path')
const { TOOLS_SCHEMA, MODEL_TOOLS_SCHEMA, DISABLED_MODEL_TOOLS, isLowLevelWorkflowTool } = require('./schemas')
const officeHandlers = require('./office-handlers')

const HANDLER_MODULES = [
  { id: 'file-ops', category: 'file', load: () => require('./tool-handlers/file-ops') },
  { id: 'text-edit', category: 'edit', load: () => require('./tool-handlers/text-edit') },
  { id: 'command', category: 'command', load: () => require('./tool-handlers/command') },
  { id: 'search', category: 'search', load: () => require('./tool-handlers/search') },
  { id: 'parallel-research', category: 'search', load: () => require('./tool-handlers/parallel-research') },
  { id: 'screenshot', category: 'visual', load: () => require('./tool-handlers/screenshot') },
  { id: 'image-gen', category: 'media', load: () => require('./tool-handlers/image-gen') },
  { id: 'media-gen', category: 'media', load: () => require('./tool-handlers/media-gen') },
  { id: 'website-research', category: 'browser', load: () => require('./tool-handlers/website-research') },
  { id: 'vision', category: 'vision', load: () => require('./tool-handlers/vision') },
  { id: 'git-safety', category: 'git', load: () => require('./tool-handlers/git-safety') },
  { id: 'diagnostics', category: 'diagnostics', load: () => require('./tool-handlers/diagnostics') },
  { id: 'mcp', category: 'mcp', load: () => require('./tool-handlers/mcp') },
  { id: 'workflows', category: 'workflow', load: () => require('./tool-handlers/workflows') },
  { id: 'code-navigation', category: 'navigation', load: () => require('./tool-handlers/code-navigation') },
  { id: 'call-chain', category: 'search', load: () => require('./tool-handlers/call-chain') },
  { id: 'ai-operation-memo', category: 'memory', load: () => require('./tool-handlers/ai-operation-memo') },
  { id: 'canvas-workflow', category: 'canvas', load: () => require('./tool-handlers/canvas-workflow') },
  { id: 'tool-system', category: 'system', load: () => require('./tool-handlers/tool-system') },
  { id: 'speech-synth', category: 'media', load: () => require('./tool-handlers/speech-synth') },
  { id: 'composite-tools', category: 'composite', load: () => require('./tool-handlers/composite-tools') },
  { id: 'character-animation', category: 'media', load: () => require('./tool-handlers/character-animation') },
  { id: 'office-template', category: 'office', load: () => require('./tool-handlers/office-template') },
  { id: 'desktop-control', category: 'desktop', load: () => require('./tool-handlers/desktop-control') },
  { id: 'inline-visualize', category: 'media', load: () => require('./tool-handlers/inline-visualize') },
  { id: 'website-delivery', category: 'web', load: () => require('./tool-handlers/website-delivery') },
  // 可选模块：目录删除后 load 失败会被 createRegistry 跳过
  {
    id: 'optional-binary-analysis',
    category: 'security',
    load: () => {
      const optional = require('./optional/loader').getOptionalHandlers()
      return { handlers: optional }
    }
  }
]

const LEGACY_EXECUTABLE_TOOLS = new Set([
  'report_progress',
  'show_thinking_note',
  'start_final_reply',
  'lxweb',
  'browser_search',
  'browser_fetch',
  'browser_open',
  'recall_history',
  'read_task_ledger_entry',
  'get_latest_change_session',
  'rollback_latest_change_session',
  'find_software',
  'open_software',
  'blender_status',
  'blender_run_script',
  'blender_create_demo_model',
  'blender_modify_scene',
  'blender_import_asset',
  'blender_inspect_scene',
  'request_agent_collaboration',
  'get_agent_collaboration_status',
  'enter_plan_mode',
  'ask_user_choice',
  'confirm_plan',
  'enter_auto_mode',
  'ask_step_confirm',
  'complete_step'
])

function schemaName(tool) {
  return String(tool?.function?.name || '').trim()
}

function collectSchemaInfo(schemaList = TOOLS_SCHEMA) {
  const byName = new Map()
  const duplicates = []
  for (const tool of Array.isArray(schemaList) ? schemaList : []) {
    const name = schemaName(tool)
    if (!name) continue
    if (byName.has(name)) duplicates.push(name)
    byName.set(name, tool)
  }
  return { byName, duplicates: [...new Set(duplicates)] }
}

function getOfficeToolNames() {
  return [
    ...Object.keys(officeHandlers.excelBasicHandlers || {}),
    ...Object.keys(officeHandlers.excelAdvancedHandlers || {}),
    ...Object.keys(officeHandlers.pptHandlers || {}),
    ...Object.keys(officeHandlers.docxHandlers || {})
  ].sort()
}

function createRegistry() {
  const handlers = new Map()
  const metadata = new Map()
  const duplicateHandlers = []
  const loadErrors = []

  for (const modInfo of HANDLER_MODULES) {
    let mod
    try {
      mod = modInfo.load()
    } catch (error) {
      loadErrors.push({ module: modInfo.id, error: error.message })
      continue
    }
    for (const [name, handler] of Object.entries(mod.handlers || {})) {
      if (handlers.has(name)) duplicateHandlers.push(name)
      handlers.set(name, handler)
      metadata.set(name, {
        name,
        source: modInfo.id,
        category: modInfo.category,
        modulePath: path.join('electron', 'modules', 'tool-handlers', `${modInfo.id}.js`),
        kind: 'handler'
      })
    }
  }

  for (const name of getOfficeToolNames()) {
    metadata.set(name, {
      name,
      source: 'office-handlers',
      category: name.startsWith('ppt_') ? 'ppt' : name.startsWith('docx_') ? 'docx' : 'excel',
      modulePath: path.join('electron', 'modules', 'office-handlers.js'),
      kind: 'office'
    })
  }

  for (const name of LEGACY_EXECUTABLE_TOOLS) {
    if (!metadata.has(name)) {
      metadata.set(name, {
        name,
        source: 'tools.js',
        category: 'legacy',
        modulePath: path.join('electron', 'modules', 'tools.js'),
        kind: 'legacy'
      })
    }
  }

  return {
    handlers,
    metadata,
    duplicateHandlers: [...new Set(duplicateHandlers)],
    loadErrors
  }
}

const registry = createRegistry()

function getToolHandler(name) {
  return registry.handlers.get(String(name || ''))
}

function hasToolHandler(name) {
  return registry.handlers.has(String(name || ''))
}

function getToolMeta(name) {
  return registry.metadata.get(String(name || '')) || null
}

function listRegisteredTools(options = {}) {
  const includeSchemas = options.includeSchemas !== false
  const schemaInfo = includeSchemas ? collectSchemaInfo(TOOLS_SCHEMA) : { byName: new Map(), duplicates: [] }
  return [...registry.metadata.values()]
    .map(item => {
      const exposedToModel = schemaInfo.byName.has(item.name)
        && !DISABLED_MODEL_TOOLS.has(item.name)
        && !isLowLevelWorkflowTool(item.name)
      return {
        ...item,
        hasSchema: schemaInfo.byName.has(item.name),
        modelVisible: exposedToModel
      }
    })
    .sort((a, b) => a.name.localeCompare(b.name))
}

function getExecutableToolNames() {
  return [...registry.metadata.keys()].sort()
}

function validateToolRegistry() {
  const allSchema = collectSchemaInfo(TOOLS_SCHEMA)
  const modelSchema = collectSchemaInfo(MODEL_TOOLS_SCHEMA)
  const executable = new Set(getExecutableToolNames())
  const schemaNames = [...allSchema.byName.keys()]

  const schemaWithoutExecutable = schemaNames
    .filter(name => !executable.has(name))
    .sort()

  const executableWithoutSchema = [...executable]
    .filter(name => !allSchema.byName.has(name))
    .sort()

  const modelVisibleWithoutExecutable = [...modelSchema.byName.keys()]
    .filter(name => !executable.has(name))
    .sort()

  const errors = [
    ...registry.loadErrors.map(item => `handler module failed to load: ${item.module}: ${item.error}`),
    ...registry.duplicateHandlers.map(name => `duplicate handler registered: ${name}`),
    ...allSchema.duplicates.map(name => `duplicate tool schema: ${name}`),
    ...modelVisibleWithoutExecutable.map(name => `model-visible schema has no executable tool: ${name}`)
  ]

  const warnings = [
    ...schemaWithoutExecutable.map(name => `schema has no executable tool: ${name}`),
    ...executableWithoutSchema.map(name => `executable tool has no schema: ${name}`)
  ]

  return {
    success: errors.length === 0,
    errors,
    warnings,
    counts: {
      handlerTools: registry.handlers.size,
      executableTools: executable.size,
      schemaTools: allSchema.byName.size,
      modelVisibleTools: modelSchema.byName.size,
      officeTools: getOfficeToolNames().length,
      legacyTools: LEGACY_EXECUTABLE_TOOLS.size
    },
    duplicateHandlers: registry.duplicateHandlers,
    duplicateSchemas: allSchema.duplicates,
    loadErrors: registry.loadErrors,
    schemaWithoutExecutable,
    executableWithoutSchema,
    modelVisibleWithoutExecutable
  }
}

function getRegistrySnapshot() {
  return {
    tools: listRegisteredTools(),
    validation: validateToolRegistry()
  }
}

module.exports = {
  HANDLER_MODULES,
  LEGACY_EXECUTABLE_TOOLS,
  getToolHandler,
  hasToolHandler,
  getToolMeta,
  getOfficeToolNames,
  getExecutableToolNames,
  listRegisteredTools,
  validateToolRegistry,
  getRegistrySnapshot
}
