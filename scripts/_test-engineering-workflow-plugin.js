const fs = require('fs')
const path = require('path')

const market = JSON.parse(fs.readFileSync(path.join('plugins', 'marketplace.json'), 'utf8'))
const names = market.plugins.map(p => p.name)
console.log('marketplace has engineering-workflow:', names.includes('engineering-workflow'))
console.log('all plugins:', names.join(', '))

const dir = path.join('plugins', 'engineering-workflow')
const man = JSON.parse(fs.readFileSync(path.join(dir, '.codex-plugin', 'plugin.json'), 'utf8'))
console.log('displayName:', man.interface.displayName)
console.log('category:', man.interface.category)
console.log('defaultPrompt:', man.interface.defaultPrompt)
console.log('logo exists:', fs.existsSync(path.join(dir, 'assets', 'logo.svg')))

const skillFolders = fs.readdirSync(path.join(dir, 'skills'))
console.log('skill folders:', skillFolders.join(', '))
for (const folder of skillFolders) {
  const skillPath = path.join(dir, 'skills', folder, 'SKILL.md')
  const md = fs.readFileSync(skillPath, 'utf8')
  const name = (md.match(/^name:\s*(.+)$/m) || [])[1]
  const title = (md.match(/^title:\s*(.+)$/m) || [])[1]
  console.log(`  - ${folder}: name=${name} title=${title} bytes=${md.length}`)
}

console.log('ALL DONE')
