const fs = require('fs')
const path = 'electron/modules/agents/agent-registry.js'
let s = fs.readFileSync(path, 'utf8')
s = s.replace(/allowedTools:\s*\[([^\]]*)\]/gs, (m, body) => {
  const items = [...body.matchAll(/'([^']+)'/g)].map(x => x[1])
  const uniq = [...new Set(items)]
  const formatted = uniq.map(i => `'${i}'`).join(',\n      ')
  return `allowedTools: [\n      ${formatted}\n    ]`
})
fs.writeFileSync(path, s)
const reg = require('../electron/modules/agents/agent-registry')
console.log('coder', reg.getAgentRole('coder').allowedTools)
console.log('cartographer', reg.getAgentRole('projectCartographer').allowedTools)
console.log('OK')
