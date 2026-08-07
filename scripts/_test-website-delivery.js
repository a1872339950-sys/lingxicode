const path = require('path')
const fs = require('fs')
const os = require('os')
const delivery = require('../electron/modules/website-delivery')
const { MODEL_TOOLS_SCHEMA } = require('../electron/modules/schemas')
const reg = require('../electron/modules/tool-registry')
const featureSettings = require('../electron/modules/feature-settings')

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lingxi-site-'))
console.log('tmp', tmp)

const names = MODEL_TOOLS_SCHEMA.map(t => t.function?.name)
console.log('schema', names.includes('website_delivery'))
console.log('handler', reg.hasToolHandler('website_delivery'))
console.log('feature', featureSettings.isFeatureEnabled('website_delivery'))

const init = delivery.initSite({
  projectPath: tmp,
  siteDir: 'site',
  title: '测试门户',
  description: '交付闭环冒烟'
})
console.log('init', init.success, init.site_dir, fs.existsSync(init.index_path))

const o1 = delivery.saveOption({
  projectPath: tmp,
  title: '极简深色',
  brief: '深色底 + 大标题 + 单 CTA',
  colors: '#0b0c10,#6366f1,#e8e9ed'
})
const o2 = delivery.saveOption({
  projectPath: tmp,
  title: '明亮清爽',
  brief: '浅色卡片网格 + 柔和强调色',
  colors: '#f8fafc,#0ea5e9,#0f172a'
})
const o3 = delivery.saveOption({
  projectPath: tmp,
  title: '编辑风格',
  brief: '杂志排版 + 强对比标题',
  colors: '#111,#f43f5e,#fff7ed',
  html: '<div style="padding:20px;font-family:serif"><h1>Edit Mode</h1><p>Magazine-like</p></div>'
})
console.log('options', o1.success, o2.success, o3.success, o3.options_count)

const status = delivery.getStatus({ projectPath: tmp })
const payload = delivery.buildPresentPayload(status.manifest, status.site_root)
console.log('present payload', payload.length, payload.map(p => p.label).join(' / '))
console.log('has preview html', payload.every(p => p.preview_html && p.preview_html.length > 20))

const selected = delivery.recordSelection({
  projectPath: tmp,
  optionId: payload[1].value,
  answer: payload[1].label
})
console.log('selected', selected.success, selected.selected?.title)

// simulate build: replace skeleton
const indexPath = status.index_path
let html = fs.readFileSync(indexPath, 'utf8')
html = html.replace(
  /<!--LINGXI_SKELETON_START-->[\s\S]*?<!--LINGXI_SKELETON_END-->/,
  `<header class="site-header"><strong>测试门户</strong></header>
  <main class="site-main hero"><h1>测试门户</h1><p>${selected.selected?.brief || ''}</p>
  <a class="btn" href="#">开始</a>
  <div class="card-grid"><div class="card">A</div><div class="card">B</div><div class="card">C</div></div>
  </main>`
)
fs.writeFileSync(indexPath, html, 'utf8')

const fin = delivery.finalizeSite({ projectPath: tmp, title: '测试门户' })
console.log('finalize', fin.success, fin.stage)
const finalHtml = fs.readFileSync(indexPath, 'utf8')
console.log('skeleton gone', !finalHtml.includes('LINGXI_SKELETON'))
console.log('ALL DONE')
