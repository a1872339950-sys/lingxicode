/**
 * 快速语法检查：扫描 electron 与 frontend/scripts 下的 JS（可被 npm run check:syntax 调用）
 */
const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')

const root = path.resolve(__dirname, '..')
const SKIP_DIR = new Set(['node_modules', 'dist', '.git', 'data', 'codemap', 'build', 'temp', '.tmp-real-scenarios'])

function walk(dir, out = []) {
  let entries
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (SKIP_DIR.has(entry.name)) continue
      walk(full, out)
    } else if (entry.isFile() && entry.name.endsWith('.js') && !entry.name.endsWith('.min.js')) {
      out.push(full)
    }
  }
  return out
}

function main() {
  const targets = [
    ...walk(path.join(root, 'electron')),
    ...walk(path.join(root, 'frontend', 'scripts')),
    ...walk(path.join(root, 'scripts')).filter(f => !f.includes(`${path.sep}real-scenarios${path.sep}cases${path.sep}`))
  ]

  // 优先覆盖关键入口 + 变更相关；全量对所有文件做 node --check
  let failed = 0
  let checked = 0
  for (const file of targets) {
    const rel = path.relative(root, file)
    const result = spawnSync(process.execPath, ['--check', file], {
      encoding: 'utf8',
      cwd: root
    })
    checked += 1
    if (result.status !== 0) {
      failed += 1
      const err = (result.stderr || result.stdout || '').trim()
      console.error(`FAIL ${rel}`)
      if (err) console.error(err)
    }
  }

  if (failed > 0) {
    console.error(`\nSyntax check failed: ${failed}/${checked}`)
    process.exit(1)
  }
  console.log(`Syntax check passed: ${checked}/${checked}`)
}

main()
