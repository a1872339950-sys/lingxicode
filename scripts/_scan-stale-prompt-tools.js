/**
 * Scan prompt/agent sources for tool names that models cannot call.
 * Run: node scripts/_scan-stale-prompt-tools.js
 */
const fs = require('fs')
const path = require('path')
const { MODEL_TOOLS_SCHEMA, TOOLS_SCHEMA, DISABLED_MODEL_TOOLS } = require('../electron/modules/schemas')
const composite = require('../electron/modules/composite-tool-contracts')

const model = new Set(MODEL_TOOLS_SCHEMA.map(t => t.function?.name).filter(Boolean))
const all = new Set(TOOLS_SCHEMA.map(t => t.function?.name).filter(Boolean))
const disabled = new Set(DISABLED_MODEL_TOOLS)

const routed = new Map()
for (const [comp, def] of Object.entries(composite.COMPOSITE_TOOL_CONTRACTS)) {
  for (const [action, route] of Object.entries(def.actions)) {
    const tip = action === (def.defaultAction || '') || def.defaultAction === action
      ? comp
      : `${comp} action=${action}`
    if (!routed.has(route.tool)) routed.set(route.tool, [])
    routed.get(route.tool).push(tip)
  }
}

// Names that are definitely retired / should not appear as callable tools in prompts
const retiredOrLegacy = new Set([
  'particle', 'cutout', 'project_search', 'query_code_map', 'codemap',
  'enter_auto_mode', 'ask_step_confirm', 'report_progress',
  'blender_workflow', 'inspect_runtime_errors', 'list_runtime_targets',
  'capture_screenshot', 'browser_search', 'browser_fetch', 'browser_open',
  'discover_code', 'search_project', 'run_command', 'terminal_run', 'terminal_status', 'terminal_stop',
  'view_image', 'mcp_aidev_workflow', 'blender_3d_relay',
  'enter_auto', 'ask_step', 'find_in_file', // sometimes old bare names
])

const knownTools = new Set([
  ...all,
  ...disabled,
  ...retiredOrLegacy,
  'launch_app', // desktop_control method, not a tool
])

const files = [
  'electron/modules/system-prompt-builder.js',
  'electron/modules/agent-runtime.js',
  'electron/modules/agents/agent-registry.js',
  'electron/modules/agents/agent-router.js',
  'electron/modules/capability-tiers.js',
  'electron/modules/chat/model-capability-prompt.js',
  'electron/modules/chat/exploration-strategy.js',
  'electron/modules/tool-failure-recovery.js',
  'electron/modules/progress-narration.js',
  'electron/modules/ai-chat.js',
  'electron/modules/agent-sub-runner.js',
  'electron/modules/system-prompt-builder.js',
]

// Also walk skills for SKILL.md that might be model-facing
function walkMd(dir, out = []) {
  if (!fs.existsSync(dir)) return out
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name)
    if (ent.isDirectory()) walkMd(p, out)
    else if (/\.(md|js)$/i.test(ent.name)) out.push(p)
  }
  return out
}

const skillFiles = walkMd(path.join(process.cwd(), 'skills'))
  .filter(p => /SKILL\.md$|guidance\.md$|api\.md$/i.test(p))
  .map(p => path.relative(process.cwd(), p))

const scanFiles = [...new Set([...files, ...skillFiles])]

const findings = []

for (const rel of scanFiles) {
  const full = path.isAbsolute(rel) ? rel : path.join(process.cwd(), rel)
  if (!fs.existsSync(full)) continue
  const text = fs.readFileSync(full, 'utf8')
  const lines = text.split(/\r?\n/)
  lines.forEach((line, i) => {
    // skip pure requires/imports without prose
    if (/^\s*(const|let|var|function|class|module\.exports|exports\.|require\(|import\s)/.test(line)
      && !/['"`].{20,}/.test(line)) return
    // skip comments that are only TODO code wiring, still scan long prose comments

    const re = /\b([a-z][a-z0-9_]{3,40})\b/g
    let m
    const hits = new Set()
    while ((m = re.exec(line)) !== null) {
      if (knownTools.has(m[1])) hits.add(m[1])
    }
    for (const name of hits) {
      if (model.has(name)) continue
      const isAll = all.has(name)
      const isDis = disabled.has(name)
      const via = routed.get(name) || []
      let severity = ''
      let note = ''
      if (retiredOrLegacy.has(name) && !isAll) {
        severity = 'retired'
        note = '已退役/不存在的工具或能力名'
      } else if (isDis && via.length) {
        severity = 'should_use_composite'
        note = `模型不可直呼；应写：${via.slice(0, 4).join(' / ')}`
      } else if (isDis && !via.length) {
        severity = 'disabled_no_route'
        note = '模型侧禁用且无 composite 路由（提示词不应当可调用工具写）'
      } else if (!isAll && !retiredOrLegacy.has(name)) {
        continue
      } else if (!isAll) {
        severity = 'stale'
        note = '非工具名/已失效'
      } else {
        continue
      }
      findings.push({
        file: rel.replace(/\\/g, '/'),
        line: i + 1,
        name,
        severity,
        note,
        snippet: line.trim().slice(0, 180)
      })
    }
  })
}

const groups = new Map()
for (const f of findings) {
  const key = `${f.severity}::${f.name}`
  if (!groups.has(key)) groups.set(key, { name: f.name, severity: f.severity, note: f.note, locations: [] })
  groups.get(key).locations.push({ file: f.file, line: f.line, snippet: f.snippet })
}

const order = ['retired', 'disabled_no_route', 'should_use_composite', 'stale']
const sorted = [...groups.values()].sort((a, b) => {
  const d = order.indexOf(a.severity) - order.indexOf(b.severity)
  return d || a.name.localeCompare(b.name)
})

console.log('# Stale prompt tool references\n')
console.log(`Model-visible tools: ${model.size}`)
console.log(`Hits: ${findings.length}  Groups: ${sorted.length}\n`)

for (const g of sorted) {
  console.log(`## [${g.severity}] \`${g.name}\``)
  console.log(`${g.note}`)
  console.log('')
  // unique by file:line
  const seen = new Set()
  for (const loc of g.locations) {
    const k = `${loc.file}:${loc.line}`
    if (seen.has(k)) continue
    seen.add(k)
    console.log(`- ${loc.file}:${loc.line}`)
    console.log(`  > ${loc.snippet}`)
  }
  console.log('')
}
