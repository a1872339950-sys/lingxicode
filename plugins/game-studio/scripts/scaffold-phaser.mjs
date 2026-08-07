#!/usr/bin/env node
/**
 * 复制 Phaser 最小可玩模板到目标目录
 * 用法: node scripts/scaffold-phaser.mjs --dest ./my-game
 */
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  statSync,
  readFileSync,
  writeFileSync
} from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const templateRoot = path.resolve(__dirname, '../templates/phaser-starter')

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
  if (!existsSync(dir)) return true
  if (!statSync(dir).isDirectory()) return false
  return readdirSync(dir).length === 0
}

const args = parseArgs(process.argv.slice(2))
const dest = path.resolve(process.cwd(), String(args.dest || args.d || ''))
if (!dest || dest === process.cwd()) {
  console.error('请指定 --dest <目录>，例如: --dest ./my-game')
  process.exit(1)
}
if (!existsSync(templateRoot)) {
  console.error('找不到模板:', templateRoot)
  process.exit(1)
}
if (existsSync(dest) && !isEmptyDir(dest) && !args.force) {
  console.error('目标非空，若确认覆盖请加 --force:', dest)
  process.exit(1)
}

mkdirSync(dest, { recursive: true })
cpSync(templateRoot, dest, { recursive: true, force: !!args.force })

const pkgPath = path.join(dest, 'package.json')
if (existsSync(pkgPath) && args.name) {
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
  pkg.name = String(args.name)
  writeFileSync(pkgPath, JSON.stringify(pkg, null, 2))
}

console.log('已创建 Phaser 最小可玩项目:', dest)
console.log('下一步: cd', path.relative(process.cwd(), dest) || '.', '&& npm install && npm run dev')
