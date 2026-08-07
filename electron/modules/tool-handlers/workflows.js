const fs = require('fs')
const path = require('path')

const OFFICE_ACTIONS = {
  ppt: {
    open: 'ppt_open',
    create: 'ppt_create',
    create_new: 'ppt_create',
    load: 'ppt_load',
    add_slide: 'ppt_add_slide',
    set_title: 'ppt_set_title',
    set_content: 'ppt_set_content',
    add_text: 'ppt_add_text',
    add_text_box: 'ppt_add_text',
    add_bullets: 'ppt_add_bullets',
    set_bg_color: 'ppt_set_bg_color',
    goto_slide: 'ppt_goto_slide',
    save: 'ppt_save',
    add_image: 'ppt_add_image',
    add_video: 'ppt_add_video',
    add_audio: 'ppt_add_audio',
    add_shape: 'ppt_add_shape',
    add_line: 'ppt_add_line',
    add_animation: 'ppt_add_animation',
    set_transition: 'ppt_set_transition',
    run_script: 'ppt_run_script'
  },
  excel: {
    open: 'excel_open',
    create: 'excel_create',
    create_new: 'excel_create',
    load: 'excel_load',
    write_cell: 'excel_write_cell',
    write_range: 'excel_write_range',
    read_range: 'excel_read_range',
    set_style: 'excel_set_style',
    set_formula: 'excel_set_formula',
    get_formula: 'excel_get_formula',
    add_chart: 'excel_add_chart',
    list_sheets: 'excel_list_sheets',
    create_sheet: 'excel_create_sheet',
    switch_sheet: 'excel_switch_sheet',
    save: 'excel_save',
    close: 'excel_close',
    run_script: 'excel_run_script'
  },
  docx: {
    open: 'docx_open',
    create: 'docx_create',
    create_new: 'docx_create',
    load: 'docx_load',
    save: 'docx_save',
    add_heading: 'docx_add_heading',
    add_paragraph: 'docx_add_paragraph',
    set_paragraph: 'docx_set_paragraph',
    replace_text: 'docx_replace_text',
    get_outline: 'docx_get_outline',
    fill_placeholders: 'docx_fill_placeholders',
    close: 'docx_close',
    copy_template: 'docx_copy_template',
    run_script: 'docx_run_script'
  }
}

function normalizeDomain(value = '') {
  const text = String(value || '').trim().toLowerCase()
  if (['blender', '3d', 'model', '模型', '三维'].includes(text)) return 'blender'
  if (['ppt', 'powerpoint', 'presentation', '演示文稿', '演示'].includes(text)) return 'ppt'
  if (['excel', 'xlsx', 'spreadsheet', '表格', 'sheet'].includes(text)) return 'excel'
  if (['docx', 'word', 'document', '文档', 'doc'].includes(text)) return 'docx'
  return ''
}

function normalizeKind(value = '') {
  const text = String(value || '').trim().toLowerCase()
  if (['ppt', 'powerpoint', 'presentation', '演示文稿', '演示'].includes(text)) return 'ppt'
  if (['excel', 'xlsx', 'spreadsheet', '表格', 'sheet'].includes(text)) return 'excel'
  if (['docx', 'word', 'document', '文档', 'doc'].includes(text)) return 'docx'
  return ''
}

function normalizeAction(value = '', kind = '') {
  let text = String(value || '').trim()
  if (kind === 'excel') text = text.replace(/^excel_/i, '')
  else if (kind === 'docx') text = text.replace(/^docx_/i, '')
  else text = text.replace(/^ppt_/i, '')
  return text.toLowerCase()
}

function compactResult(result) {
  if (!result || typeof result !== 'object') return result
  return {
    success: result.success !== false,
    ...result
  }
}

function safeFileName(value = '') {
  return String(value || 'artifact')
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '-')
    .replace(/\s+/g, '-')
    .slice(0, 80) || 'artifact'
}

function getWorkflowTempRoot(projectPath = '') {
  return path.join(projectPath || process.cwd(), '.lingxi-temp-artifacts')
}

function cleanupExpiredWorkflowArtifacts(projectPath = '', keepDays = 1) {
  const root = getWorkflowTempRoot(projectPath)
  const retentionMs = Math.max(1, Number(keepDays) || 1) * 24 * 60 * 60 * 1000
  const cutoff = Date.now() - retentionMs
  if (!fs.existsSync(root)) return { root, removed: 0 }
  let removed = 0

  function walk(dir) {
    let entries = []
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch (_) {
      return
    }
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name)
      try {
        const stat = fs.statSync(fullPath)
        if (entry.isDirectory()) {
          walk(fullPath)
          const left = fs.readdirSync(fullPath)
          if (!left.length && stat.mtimeMs < cutoff) {
            fs.rmSync(fullPath, { recursive: true, force: true })
            removed++
          }
        } else if (stat.mtimeMs < cutoff) {
          fs.rmSync(fullPath, { force: true })
          removed++
        }
      } catch (_) {
        // Best effort cleanup only.
      }
    }
  }

  walk(root)
  return { root, removed }
}

function writeWorkflowTempScript(projectPath = '', domain = 'script', script = '', goal = '') {
  const root = path.join(getWorkflowTempRoot(projectPath), safeFileName(domain))
  fs.mkdirSync(root, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const filePath = path.join(root, `${stamp}-${safeFileName(goal || domain)}.py`)
  fs.writeFileSync(filePath, String(script || ''), 'utf8')
  return filePath
}

async function runOfficeWorkflow(args = {}, ctx = {}) {
  const kind = normalizeKind(args.kind)
  if (!kind) return { success: false, error: 'office_workflow requires kind: ppt | excel | docx' }
  const actionMap = OFFICE_ACTIONS[kind]

  const steps = []
  const baseArgs = args.args && typeof args.args === 'object' ? { ...args.args } : {}
  if (args.script) {
    const toolName = actionMap.run_script
    const result = await ctx.dispatch(toolName, {
      ...baseArgs,
      script: String(args.script),
      goal: args.goal,
      keep_days: args.keep_days || 1
    })
    steps.push({ tool: toolName, result: compactResult(result) })
    return {
      success: result?.success !== false,
      tool: 'office_workflow',
      kind,
      mode: 'script',
      goal: args.goal || '',
      steps,
      next_action: result?.success === false ? 'fix_generated_office_script_and_retry_office_workflow' : 'continue'
    }
  }

  const action = normalizeAction(args.action || 'create', kind)
  const toolName = actionMap[action]
  if (!toolName) {
    return {
      success: false,
      tool: 'office_workflow',
      kind,
      error: `unsupported ${kind} workflow action: ${args.action || action}`,
      supported_actions: Object.keys(actionMap)
    }
  }
  const result = await ctx.dispatch(toolName, { ...baseArgs, goal: args.goal, keep_days: args.keep_days || 1 })
  steps.push({ tool: toolName, result: compactResult(result) })
  return {
    success: result?.success !== false,
    tool: 'office_workflow',
    kind,
    mode: 'action',
    action,
    goal: args.goal || '',
    steps,
    next_action: result?.success === false ? 'adjust_office_workflow_args_or_use_script_mode' : 'continue'
  }
}

async function runBlenderWorkflow(args = {}, ctx = {}) {
  const cleanup = cleanupExpiredWorkflowArtifacts(ctx.projectPath, args.keep_days || 1)
  const baseArgs = {
    ...args,
    wait: args.wait !== false,
    keep_days: args.keep_days || 1
  }
  const steps = []

  if (args.script || args.script_path) {
    let scriptPath = args.script_path
    if (args.script && !scriptPath) {
      scriptPath = writeWorkflowTempScript(ctx.projectPath, 'blender', args.script, args.goal)
    }
    const result = await ctx.dispatch('blender_run_script', {
      ...baseArgs,
      script: '',
      script_path: scriptPath
    })
    steps.push({ tool: 'blender_run_script', result: compactResult(result) })
    return {
      success: result?.success !== false,
      tool: 'blender_workflow',
      mode: args.script_path ? 'script_path' : 'script',
      goal: args.goal || '',
      temp: { cleanup, script_path: scriptPath },
      steps,
      next_action: result?.success === false ? 'fix_generated_blender_script_and_retry_blender_workflow' : 'inspect_or_continue'
    }
  }

  if (Array.isArray(args.operations) && args.operations.length) {
    const result = await ctx.dispatch('blender_modify_scene', baseArgs)
    steps.push({ tool: 'blender_modify_scene', result: compactResult(result) })
    return {
      success: result?.success !== false,
      tool: 'blender_workflow',
      mode: 'operations',
      goal: args.goal || '',
      temp: { cleanup },
      steps,
      next_action: result?.success === false ? 'use_script_mode_for_precise_blender_control' : 'inspect_or_continue'
    }
  }

  return {
    success: false,
    tool: 'blender_workflow',
    error: 'blender_workflow needs script, script_path, or operations. For creative 3D generation, provide a Blender Python script.',
    next_action: 'generate_blender_python_script_and_retry_blender_workflow'
  }
}

async function runArtifactWorkflow(args = {}, ctx = {}) {
  const domain = normalizeDomain(args.domain)
  if (!domain) {
    return {
      success: false,
      tool: 'artifact_workflow',
      error: 'artifact_workflow requires domain: blender | ppt | excel | docx',
      supported_domains: ['blender', 'ppt', 'excel', 'docx']
    }
  }

  if (domain === 'blender') {
    const result = await runBlenderWorkflow(args, ctx)
    return { ...result, tool: 'artifact_workflow', routed_tool: 'blender_workflow', domain }
  }
  if (domain === 'ppt' || domain === 'excel' || domain === 'docx') {
    const result = await runOfficeWorkflow({ ...args, kind: domain }, ctx)
    return { ...result, tool: 'artifact_workflow', routed_tool: 'office_workflow', domain }
  }

  return { success: false, tool: 'artifact_workflow', domain, error: 'unsupported domain' }
}

const handlers = {
  artifact_workflow: runArtifactWorkflow,
  office_workflow: runOfficeWorkflow,
  blender_workflow: runBlenderWorkflow
}

module.exports = {
  handlers,
  runArtifactWorkflow,
  runOfficeWorkflow,
  runBlenderWorkflow
}
