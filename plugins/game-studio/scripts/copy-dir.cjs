/** Shared recursive directory copy (Windows + CJK paths safe). */
const fs = require('fs')
const path = require('path')

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true })
  for (const name of fs.readdirSync(src)) {
    const from = path.join(src, name)
    const to = path.join(dest, name)
    const st = fs.statSync(from)
    if (st.isDirectory()) copyDir(from, to)
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

/**
 * @param {{ templateName: string, destArg: string, force?: boolean, name?: string, label: string }} opts
 */
function scaffoldFromTemplate(opts) {
  const templateRoot = path.join(__dirname, '..', 'templates', opts.templateName)
  if (!opts.destArg) {
    console.error(`请指定 --dest <目录>`)
    process.exit(1)
  }
  const dest = path.resolve(process.cwd(), String(opts.destArg))
  if (dest === process.cwd()) {
    console.error('目标目录不能是当前仓库根目录')
    process.exit(1)
  }
  if (!fs.existsSync(templateRoot)) {
    console.error('找不到模板:', templateRoot)
    process.exit(1)
  }
  if (fs.existsSync(dest) && !isEmptyDir(dest) && !opts.force) {
    console.error('目标非空，若确认覆盖请加 --force:', dest)
    process.exit(1)
  }
  if (fs.existsSync(dest) && opts.force) {
    fs.rmSync(dest, { recursive: true, force: true })
  }
  copyDir(templateRoot, dest)
  const pkgPath = path.join(dest, 'package.json')
  if (fs.existsSync(pkgPath) && opts.name) {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'))
    pkg.name = String(opts.name)
    fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2))
  }
  console.log(`已创建 ${opts.label}:`, dest)
  console.log('下一步: cd', path.relative(process.cwd(), dest) || '.', '&& npm install && npm run dev')
}

module.exports = { copyDir, parseArgs, isEmptyDir, scaffoldFromTemplate }
