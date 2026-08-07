const fs = require('fs')
const { MODEL_TOOLS_SCHEMA, DISABLED_MODEL_TOOLS } = require('../electron/modules/schemas')
const model = new Set(MODEL_TOOLS_SCHEMA.map(t => t.function.name))
const disabled = new Set(DISABLED_MODEL_TOOLS)
const watch = [...disabled, 'enter_auto_mode', 'ask_step_confirm', 'report_progress', 'codemap', 'query_code_map', 'terminal_run', 'terminal_status', 'terminal_stop']
const files = [
  'electron/modules/system-prompt-builder.js',
  'electron/modules/agent-runtime.js',
  'electron/modules/ai-chat.js'
]
for (const f of files) {
  const lines = fs.readFileSync(f, 'utf8').split(/\n/)
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (!/['"`]/.test(line) && !line.includes('- ') && !line.includes('请')) continue
    for (const t of watch) {
      if (!line.includes(t)) continue
      if (model.has(t)) continue
      // action= form is OK for composite
      if (new RegExp(`action\\s*=\\s*${t}\\b|action=${t}\\b`).test(line)) continue
      if (t === 'find_references' && /action=find_references/.test(line)) continue
      if (t === 'find_in_file' && /action=find_in_file/.test(line)) continue
      if (t === 'trace_call_chain' && /action=trace_call_chain/.test(line)) continue
      if (t === 'git_diff' && /action=git_diff/.test(line)) continue
      // code compatibility arrays are fine in ai-chat if not Chinese guidance
      if (f.includes('ai-chat') && /new Set\(|POST_WRITE|===|includes\(|toolName ===/.test(line)) continue
      console.log(`${f}:${i + 1}\t${t}\t${line.trim().slice(0, 140)}`)
    }
  }
}
console.log('DONE')
