/**
 * office_from_template：列出 / 套用办公模板插件中的参考文件
 */

const fs = require('fs')
const path = require('path')
const storageConfig = require('../storage-config')
const { executeDocxCommand } = require('../office-bridge')

const CATALOG = [
  { id: 'minimal-letterhead', kind: 'document', title: '商务信笺', file: 'minimal-letterhead.docx' },
  { id: 'strategy-memorandum', kind: 'document', title: '战略备忘录', file: 'strategy-memorandum.docx' },
  { id: 'system-design', kind: 'document', title: '系统设计', file: 'system-design.docx' },
  { id: 'design-report', kind: 'document', title: '设计报告', file: 'design-report.docx' },
  { id: 'team-alignment', kind: 'presentation', title: '团队对齐', file: 'team-alignment.pptx' },
  { id: 'project-kickoff', kind: 'presentation', title: '项目启动', file: 'project-kickoff.pptx' },
  { id: 'business-review', kind: 'presentation', title: '业务复盘', file: 'business-review.pptx' },
  { id: 'simple-light', kind: 'presentation', title: '简约演示', file: 'simple-light.pptx' },
  { id: 'analytics-dashboard', kind: 'spreadsheet', title: '分析看板', file: 'analytics-dashboard.xlsx' },
  { id: 'financial-budget', kind: 'spreadsheet', title: '财务预算', file: 'financial-budget.xlsx' },
  { id: 'project-tracker', kind: 'spreadsheet', title: '项目跟踪', file: 'project-tracker.xlsx' },
  { id: 'three-statement-forecast', kind: 'spreadsheet', title: '三表预测', file: 'three-statement-forecast.xlsx' }
]

function normalizeKindFilter(value = '') {
  const t = String(value || '').trim().toLowerCase()
  if (!t) return ''
  if (['document', 'docx', 'word', 'doc', '文档'].includes(t)) return 'document'
  if (['presentation', 'ppt', 'pptx', '演示'].includes(t)) return 'presentation'
  if (['spreadsheet', 'excel', 'xlsx', '表格', 'sheet'].includes(t)) return 'spreadsheet'
  return t
}

function kindToExt(kind) {
  if (kind === 'document') return 'docx'
  if (kind === 'presentation') return 'pptx'
  if (kind === 'spreadsheet') return 'xlsx'
  return 'bin'
}

function kindToWorkflow(kind) {
  if (kind === 'document') return 'docx'
  if (kind === 'presentation') return 'ppt'
  if (kind === 'spreadsheet') return 'excel'
  return ''
}

function resolveTemplatesRoot() {
  const candidates = []
  try {
    candidates.push(path.join(storageConfig.getBasePath(), 'plugins', 'office-templates'))
  } catch (_) { /* ignore */ }
  candidates.push(path.join(__dirname, '../../../plugins/office-templates'))
  for (const root of candidates) {
    if (fs.existsSync(path.join(root, 'templates'))) return root
  }
  return candidates[candidates.length - 1]
}

function safeSlug(text = '') {
  return String(text || '')
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 48)
    .replace(/^-|-$/g, '') || 'draft'
}

function resolveOutputPath(projectPath, template, args = {}) {
  if (args.output_path) {
    const p = String(args.output_path)
    if (path.isAbsolute(p)) return p
    return path.resolve(projectPath || process.cwd(), p)
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, '').slice(0, 15)
  const slug = safeSlug(args.title || stamp)
  const rel = path.join('assets', 'office', `${template.id}-${slug}.${kindToExt(template.kind)}`)
  return path.resolve(projectPath || process.cwd(), rel)
}

function listTemplates(kindFilter = '') {
  const root = resolveTemplatesRoot()
  const filter = normalizeKindFilter(kindFilter)
  const templatesDir = path.join(root, 'templates')
  return CATALOG
    .filter(t => !filter || t.kind === filter)
    .map(t => {
      const ref = path.join(templatesDir, t.file)
      return {
        ...t,
        workflow_kind: kindToWorkflow(t.kind),
        reference_path: ref,
        available: fs.existsSync(ref)
      }
    })
}

async function applySimpleReplacements(filePath, kind, replacements = {}) {
  const entries = Object.entries(replacements || {}).filter(([k]) => k)
  if (!entries.length) return { applied: 0 }

  if (kind === 'document') {
    let total = 0
    const open = await executeDocxCommand('open_file', { file_path: filePath })
    if (open?.success === false) return open
    for (const [oldText, newText] of entries) {
      const r = await executeDocxCommand('replace_text', { old: oldText, new: newText })
      if (r?.success) total += Number(r.replaced || 0)
    }
    const save = await executeDocxCommand('save_file', { file_path: filePath })
    return { success: save?.success !== false, replaced: total, detail: save }
  }

  // pptx/xlsx: best-effort via python one-shot in docx_control is wrong;
  // use a small inline python for binary zip text is fragile — skip non-docx bulk replace
  // and report that workflow should continue with office_workflow.
  return {
    success: true,
    applied: 0,
    skipped: true,
    message: '演示/表格的结构化填充请继续用 office_workflow 或 artifact_workflow 编辑'
  }
}

async function applyPlaceholders(filePath, placeholders = {}) {
  const map = placeholders && typeof placeholders === 'object' ? placeholders : {}
  if (!Object.keys(map).length) return { applied: 0 }
  const open = await executeDocxCommand('open_file', { file_path: filePath })
  if (open?.success === false) return open
  const fill = await executeDocxCommand('fill_placeholders', { mapping: map })
  const save = await executeDocxCommand('save_file', { file_path: filePath })
  return {
    success: save?.success !== false && fill?.success !== false,
    replaced: fill?.replaced || 0,
    detail: { fill, save }
  }
}

async function runOfficeFromTemplate(args = {}, ctx = {}) {
  const action = String(args.action || 'list').toLowerCase()
  const projectPath = ctx.projectPath || process.cwd()

  if (action === 'list') {
    const templates = listTemplates(args.kind)
    return {
      success: true,
      tool: 'office_from_template',
      action: 'list',
      templates_root: resolveTemplatesRoot(),
      count: templates.length,
      templates,
      next_action: 'call_office_from_template_apply_with_template_id'
    }
  }

  if (action !== 'apply') {
    return { success: false, error: `unsupported action: ${action}`, supported: ['list', 'apply'] }
  }

  const templateId = String(args.template_id || '').trim()
  if (!templateId) {
    return { success: false, error: 'apply 需要 template_id；可先 action=list' }
  }

  const template = CATALOG.find(t => t.id === templateId || t.title === templateId)
  if (!template) {
    return {
      success: false,
      error: `未知模板: ${templateId}`,
      available_ids: CATALOG.map(t => t.id)
    }
  }

  const root = resolveTemplatesRoot()
  const source = path.join(root, 'templates', template.file)
  if (!fs.existsSync(source)) {
    return {
      success: false,
      error: `模板文件缺失: ${source}`,
      hint: '运行 plugins/office-templates/scripts/build_references.py 重新生成'
    }
  }

  const dest = resolveOutputPath(projectPath, template, args)
  fs.mkdirSync(path.dirname(dest), { recursive: true })
  fs.copyFileSync(source, dest)

  const steps = [{ step: 'copy', source, dest }]

  if (template.kind === 'document') {
    if (args.placeholders && typeof args.placeholders === 'object') {
      const fill = await applyPlaceholders(dest, args.placeholders)
      steps.push({ step: 'placeholders', result: fill })
    }
    if (args.replacements && typeof args.replacements === 'object') {
      const rep = await applySimpleReplacements(dest, 'document', args.replacements)
      steps.push({ step: 'replacements', result: rep })
    }
    if (args.title) {
      const open = await executeDocxCommand('open_file', { file_path: dest })
      if (open?.success !== false) {
        // best-effort: replace first heading-like or first non-empty paragraph if it looks like template title
        const outline = await executeDocxCommand('get_outline', { max_paragraphs: 12 })
        const first = outline?.outline?.[0]
        if (first && typeof first.index === 'number') {
          await executeDocxCommand('set_paragraph', { index: first.index, text: String(args.title) })
          await executeDocxCommand('save_file', { file_path: dest })
          steps.push({ step: 'set_title', index: first.index, title: args.title })
        }
      }
    }
  } else if (args.replacements && Object.keys(args.replacements).length) {
    steps.push({
      step: 'replacements',
      result: await applySimpleReplacements(dest, template.kind, args.replacements)
    })
  }

  let opened = null
  if (args.open_after && ctx.dispatch) {
    const wk = kindToWorkflow(template.kind)
    if (wk === 'docx') {
      opened = await ctx.dispatch('docx_open', { file_path: dest })
    } else if (wk === 'ppt') {
      opened = await ctx.dispatch('ppt_load', { file_path: dest })
    } else if (wk === 'excel') {
      opened = await ctx.dispatch('excel_load', { file_path: dest })
    }
    steps.push({ step: 'open_after', result: opened })
  }

  const rel = path.relative(projectPath || process.cwd(), dest)
  return {
    success: true,
    tool: 'office_from_template',
    action: 'apply',
    template_id: template.id,
    kind: template.kind,
    workflow_kind: kindToWorkflow(template.kind),
    title: template.title,
    path: dest,
    relative_path: rel.startsWith('..') ? dest : rel.replace(/\\/g, '/'),
    steps,
    next_action:
      template.kind === 'presentation'
        ? 'use_office_workflow_kind_ppt_or_artifact_workflow_to_fill_slides'
        : template.kind === 'spreadsheet'
          ? 'use_office_workflow_kind_excel_to_fill_data'
          : 'review_docx_or_continue_with_office_workflow_kind_docx'
  }
}

const handlers = {
  office_from_template: runOfficeFromTemplate
}

module.exports = {
  handlers,
  runOfficeFromTemplate,
  listTemplates,
  CATALOG
}
