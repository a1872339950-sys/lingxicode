/**
 * 将已存可视化中的 fill="white" 改为主题变量，并按新 wrapStandalone 重写 html。
 * 直接写 data/ 路径（不依赖 Electron storage 初始化）。
 */
const fs = require('fs')
const path = require('path')
const iv = require('../electron/modules/inline-visualize')

const id = process.argv[2] || 'v20260715082943-1fa17d4f'
const roots = [
  path.join('data', 'visualizations', '_by_id'),
  path.join('data', 'projects', 'project-114d40e7', 'visualizations')
]

let patched = 0
for (const root of roots) {
  const fragPath = path.join(root, `${id}.fragment.html`)
  const htmlPath = path.join(root, `${id}.html`)
  const metaPath = path.join(root, `${id}.json`)
  if (!fs.existsSync(fragPath) && !fs.existsSync(htmlPath)) {
    console.log('skip missing', root)
    continue
  }

  let frag = fs.existsSync(fragPath)
    ? fs.readFileSync(fragPath, 'utf8')
    : ''
  if (!frag && fs.existsSync(htmlPath)) {
    const full = fs.readFileSync(htmlPath, 'utf8')
    const m = full.match(/<div id="viz-root">([\s\S]*)<\/div>\s*<script>\s*\(function \(\) \{\s*function report/)
    frag = m ? m[1] : full
  }

  const onSeries = 'var(--on-series)'
  frag = frag.replace(/fill="white"/g, `fill="${onSeries}"`)
  frag = frag.replace(/fill='white'/g, `fill='${onSeries}'`)

  let title = id
  try {
    if (fs.existsSync(metaPath)) {
      title = JSON.parse(fs.readFileSync(metaPath, 'utf8')).title || title
    }
  } catch (_) { /* ignore */ }

  const standalone = iv.wrapStandalone(frag, title)
  fs.mkdirSync(root, { recursive: true })
  fs.writeFileSync(fragPath, frag, 'utf8')
  fs.writeFileSync(htmlPath, standalone, 'utf8')
  patched += 1
  console.log(
    'patched',
    root,
    'dark=',
    standalone.includes('data-viz-theme="dark"'),
    'no-light-dark=',
    !standalone.includes('light-dark('),
    'on-series=',
    (standalone.match(/on-series/g) || []).length
  )
}

if (!patched) {
  console.error('nothing patched')
  process.exit(1)
}
console.log('DONE')
