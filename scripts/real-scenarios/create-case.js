const fs = require('fs')
const path = require('path')

const root = path.resolve(__dirname, '../..')
const casesDir = path.join(__dirname, 'cases')

function kebab(value = '') {
  return String(value || '')
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
}

function parseArgs(argv) {
  const args = { id: '', title: '', tags: [], paths: [] }
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index]
    if (item === '--id' && argv[index + 1]) args.id = argv[++index]
    else if (item === '--title' && argv[index + 1]) args.title = argv[++index]
    else if (item === '--tag' && argv[index + 1]) args.tags.push(argv[++index])
    else if (item === '--path' && argv[index + 1]) args.paths.push(argv[++index])
    else if (!item.startsWith('--') && !args.id) args.id = item
  }
  return args
}

function patternForPath(value = '') {
  const normalized = String(value || '').replace(/\\/g, '/').replace(/^\/+/, '')
  if (!normalized) return null
  return `    /^${normalized.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}$/i`
}

function buildTemplate(args) {
  const id = kebab(args.id)
  const title = args.title || `${id} minimal real scenario`
  const tags = args.tags.length ? args.tags : [id.split('-')[0] || 'scenario']
  const patterns = args.paths.map(patternForPath).filter(Boolean)
  const patternBlock = patterns.length
    ? patterns.join(',\n')
    : '    /^electron\\/modules\\/example\\.js$/i'

  return `const fs = require('fs')
const path = require('path')

module.exports = {
  id: '${id}',
  title: '${title.replace(/'/g, "\\'")}',
  tags: ${JSON.stringify(tags)},
  changedFilePatterns: [
${patternBlock}
  ],

  async run(ctx) {
    const workspace = ctx.createWorkspace(this.id)
    try {
      const target = path.join(workspace.projectPath, 'example.txt')
      ctx.writeText(target, 'before\\n')

      // Arrange -> call the real project module/tool -> assert disk/state/UI-facing result.
      ctx.assert.equal(fs.readFileSync(target, 'utf-8'), 'before\\n')
    } finally {
      workspace.cleanup()
    }
  }
}
`
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  const id = kebab(args.id)
  if (!id) {
    console.error('Usage: node scripts/real-scenarios/create-case.js --id feature-name [--title "..."] [--tag ui] [--path frontend/scripts/app.js]')
    process.exit(1)
  }
  fs.mkdirSync(casesDir, { recursive: true })
  const filePath = path.join(casesDir, `${id}.js`)
  if (fs.existsSync(filePath)) {
    console.error(`Scenario already exists: ${path.relative(root, filePath)}`)
    process.exit(1)
  }
  fs.writeFileSync(filePath, buildTemplate(args), 'utf-8')
  console.log(`Created ${path.relative(root, filePath)}`)
}

main()
