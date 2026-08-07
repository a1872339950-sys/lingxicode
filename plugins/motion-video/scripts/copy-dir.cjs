const fs = require('fs')
const path = require('path')

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true })
  for (const name of fs.readdirSync(src)) {
    const from = path.join(src, name)
    const to = path.join(dest, name)
    if (fs.statSync(from).isDirectory()) copyDir(from, to)
    else fs.copyFileSync(from, to)
  }
}

function parseArgs(argv) {
  const out = {}
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (!a.startsWith('--')) continue
    const key = a.slice(2)
    const next = argv[i + 1]
    if (next && !next.startsWith('--')) {
      out[key] = next
      i++
    } else out[key] = true
  }
  return out
}

function isEmptyDir(dir) {
  if (!fs.existsSync(dir)) return true
  if (!fs.statSync(dir).isDirectory()) return false
  return fs.readdirSync(dir).length === 0
}

function scaffold(templateName, destArg, { force, name, label }) {
  const templateRoot = path.join(__dirname, '..', 'templates', templateName)
  if (!destArg) {
    console.error('请指定 --dest <目录>')
    process.exit(1)
  }
  const dest = path.resolve(process.cwd(), String(destArg))
  if (dest === process.cwd()) {
    console.error('目标不能是当前仓库根目录')
    process.exit(1)
  }
  if (!fs.existsSync(templateRoot)) {
    console.error('找不到模板', templateRoot)
    process.exit(1)
  }
  if (fs.existsSync(dest) && !isEmptyDir(dest) && !force) {
    console.error('目标非空，加 --force 覆盖:', dest)
    process.exit(1)
  }
  if (fs.existsSync(dest) && force) fs.rmSync(dest, { recursive: true, force: true })
  copyDir(templateRoot, dest)
  const pkgPath = path.join(dest, 'package.json')
  if (fs.existsSync(pkgPath) && name) {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'))
    pkg.name = String(name)
    fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2))
  }
  console.log('已创建', label + ':', dest)
  console.log('下一步: cd', path.relative(process.cwd(), dest) || '.', '&& npm install && npm run dev')
}

module.exports = { scaffold, parseArgs }
