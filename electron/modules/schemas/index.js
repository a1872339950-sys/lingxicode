/**
 * 工具 Schema 汇总入口
 * 自动拆分自 tools-schema.js，保持导出接口不变
 */

const browser_search = require('./browser-search')
const file_ops = require('./file-ops')
const search_verify = require('./search-verify')
const command = require('./command')
const plan_ask = require('./plan-ask')
const screenshot_image = require('./screenshot-image')
const agent = require('./agent')
const media_gen = require('./media-gen')
const software = require('./software')
const blender = require('./blender')
const ppt = require('./ppt')
const mcp = require('./mcp')
const workflows = require('./workflows')
const code_navigation = require('./code-navigation')
const ai_operation_memo = require('./ai-operation-memo')
const canvas_workflow = require('./canvas-workflow')
const speech_synth = require('./speech-synth')
const parallel_research = require('./parallel-research')
const composite_tools = require('./composite-tools')
const character_animation = require('./character-animation')
const office_template = require('./office-template')
const desktop_control = require('./desktop-control')
const inline_visualize = require('./inline-visualize')
const website_delivery = require('./website-delivery')

function loadOptionalToolsSchemaSafe() {
  try {
    return require('../optional/loader').getOptionalToolsSchema() || []
  } catch (error) {
    console.warn('[Schemas] optional tools unavailable:', error.message)
    return []
  }
}

const DISABLED_MODEL_TOOLS = new Set([
  // These remain executable compatibility entries. Models use the grouped tools below.
  'read_file', 'read_many_files',
  'create_directory', 'copy_file', 'move_file', 'delete_file',
  'create_file_session', 'append_file_chunk', 'finish_file_session',
  'list_files', 'glob_files',
  'check_syntax', 'check_project_syntax', 'post_change_verify',
  'locate_code', 'find_in_file', 'code_navigate', 'trace_call_chain', 'git_diff',
  'recall_history', 'read_task_ledger_entry', 'get_latest_change_session', 'rollback_latest_change_session',
  'search_ai_operation_memos', 'read_ai_operation_memo',
  'create_skill_draft', 'install_skill_draft', 'list_skill_drafts',
  'find_software', 'open_software',
  'inspect_image', 'view_image',
  'mcp_aidev_workflow', 'mcp_list_tools', 'mcp_call_tool',
  'render_svg_asset', 'extract_video_frames', 'upscale_media',
  "browser_search",
  "browser_fetch",
  "browser_open",
  "list_runtime_targets",
  "capture_screenshot",
  "inspect_runtime_errors",
  "discover_code",
  "search_project",
  "grep_code",
  "find_references",
  "enter_auto_mode",
  "ask_step_confirm",
  "report_progress",
  "blender_3d_relay",
  "run_command",
  "terminal_run",
  "terminal_status",
  "terminal_stop",
  "blender_workflow"
])
const LOW_LEVEL_WORKFLOW_TOOL_PREFIXES = ['ppt_', 'excel_', 'docx_', 'blender_']

const TOOLS_SCHEMA = [
  ...browser_search,
  ...file_ops,
  ...search_verify,
  ...command,
  ...plan_ask,
  ...screenshot_image,
  ...agent,
  ...media_gen,
  ...software,
  ...blender,
  ...ppt,
  ...mcp,
  ...workflows,
  ...code_navigation,
  ...ai_operation_memo,
  ...canvas_workflow,
  ...speech_synth,
  ...parallel_research,
  ...composite_tools,
  ...character_animation,
  ...office_template,
  ...desktop_control,
  ...inline_visualize,
  ...website_delivery,
  ...loadOptionalToolsSchemaSafe()
]

function isLowLevelWorkflowTool(name = '') {
  return LOW_LEVEL_WORKFLOW_TOOL_PREFIXES.some(prefix => String(name || '').startsWith(prefix))
}

const MODEL_TOOL_PRIORITY = new Map([
  ['show_thinking_note', -100],
  ['start_final_reply', -90],
  ['record_ai_operation_memo', -85],
  ['complete_step', -80],
  ['confirm_plan', -70],
  ['ask_user_choice', -60],
  ['enter_plan_mode', -50]
])

function getModelToolPriority(name = '') {
  return MODEL_TOOL_PRIORITY.has(name) ? MODEL_TOOL_PRIORITY.get(name) : 0
}

const MODEL_TOOLS_SCHEMA = TOOLS_SCHEMA.filter(tool => {
  const name = tool.function?.name || ''
  return !DISABLED_MODEL_TOOLS.has(name) && !isLowLevelWorkflowTool(name)
}).sort((a, b) => {
  const aName = a.function?.name || ''
  const bName = b.function?.name || ''
  return getModelToolPriority(aName) - getModelToolPriority(bName)
})

module.exports = { TOOLS_SCHEMA, MODEL_TOOLS_SCHEMA, DISABLED_MODEL_TOOLS, LOW_LEVEL_WORKFLOW_TOOL_PREFIXES, isLowLevelWorkflowTool }
