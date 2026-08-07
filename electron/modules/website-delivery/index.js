/**
 * 网页交付：脚手架 → 设计三选一 → 预览 → 收尾
 * 用户可见能力名：网页交付（设置 → 能力开关）
 */

const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

const MANIFEST_NAME = '.lingxi-site.json'
const OPTIONS_DIR = '.lingxi-design-options'
const TEMPLATE_DIR = path.join(__dirname, 'templates', 'starter')

function slugify(value = '') {
  return String(value || 'site')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'site'
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

function readJson(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return fallback
  }
}

function writeJson(file, data) {
  ensureDir(path.dirname(file))
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8')
}

function copyTemplateFile(src, dest, replacements = {}) {
  let text = fs.readFileSync(src, 'utf8')
  for (const [key, value] of Object.entries(replacements)) {
    text = text.split(key).join(String(value ?? ''))
  }
  ensureDir(path.dirname(dest))
  fs.writeFileSync(dest, text, 'utf8')
}

function resolveSiteRoot(projectPath = '', siteDir = 'site') {
  const root = path.resolve(projectPath || process.cwd())
  const rel = String(siteDir || 'site').replace(/^[\\/]+/, '') || 'site'
  const abs = path.resolve(root, rel)
  if (!abs.startsWith(root)) {
    throw new Error('site_dir 必须位于当前项目内')
  }
  return { projectRoot: root, siteRoot: abs, siteDir: path.relative(root, abs) || '.' }
}

function manifestPath(siteRoot) {
  return path.join(siteRoot, MANIFEST_NAME)
}

function loadManifest(siteRoot) {
  return readJson(manifestPath(siteRoot), null)
}

function saveManifest(siteRoot, manifest) {
  const next = {
    ...manifest,
    updatedAt: Date.now()
  }
  writeJson(manifestPath(siteRoot), next)
  return next
}

function pathToFileUrl(filePath = '') {
  const resolved = path.resolve(filePath)
  let pathname = resolved.replace(/\\/g, '/')
  if (!pathname.startsWith('/')) pathname = `/${pathname}`
  return encodeURI(`file://${pathname}`)
}

function initSite({ projectPath, siteDir = 'site', title = '新站点', description = '' } = {}) {
  const { projectRoot, siteRoot, siteDir: rel } = resolveSiteRoot(projectPath, siteDir)
  ensureDir(siteRoot)

  const indexPath = path.join(siteRoot, 'index.html')
  if (fs.existsSync(indexPath) && !fs.existsSync(manifestPath(siteRoot))) {
    return {
      success: false,
      error: `目标目录已有 index.html 且不是灵犀网页交付站点：${rel}`,
      error_type: 'target_not_empty',
      next_action: '换一个 site_dir，或先清理目录'
    }
  }

  const siteTitle = String(title || '新站点').slice(0, 80)
  const siteDesc = String(description || `${siteTitle} — 由灵犀网页交付生成`).slice(0, 160)
  const replacements = {
    '<!--LINGXI_SITE_TITLE-->': siteTitle,
    '<!--LINGXI_SITE_DESC-->': siteDesc
  }

  for (const name of ['index.html', 'styles.css', 'app.js']) {
    copyTemplateFile(path.join(TEMPLATE_DIR, name), path.join(siteRoot, name), replacements)
  }

  const manifest = saveManifest(siteRoot, {
    version: 1,
    id: crypto.randomBytes(4).toString('hex'),
    title: siteTitle,
    description: siteDesc,
    stage: 'design',
    siteDir: rel,
    createdAt: Date.now(),
    options: [],
    selectedOptionId: null,
    selectedBrief: '',
    previewOpened: false
  })

  return {
    success: true,
    stage: 'design',
    site_dir: rel,
    site_root: siteRoot,
    index_path: indexPath,
    preview_url: pathToFileUrl(indexPath),
    manifest,
    message: '网页脚手架已创建（含加载骨架）。请先保存最多 3 个设计选项，再 present_choices 让用户点选；也可先 open_preview 打开骨架预览。',
    next_steps: [
      'save_option × 2~3（每个含 title + html 或 brief）',
      'present_choices 弹出设计三选一',
      '按用户选择改 index.html / styles.css',
      'open_preview 刷新预览',
      'finalize 去掉骨架并标记完成'
    ]
  }
}

function findSiteRoot(projectPath = '', siteDir = '') {
  const root = path.resolve(projectPath || process.cwd())
  if (siteDir) {
    const { siteRoot } = resolveSiteRoot(projectPath, siteDir)
    if (fs.existsSync(manifestPath(siteRoot))) return siteRoot
  }
  // 常见位置
  for (const candidate of ['site', 'web', 'www', '.']) {
    try {
      const { siteRoot } = resolveSiteRoot(projectPath, candidate)
      if (fs.existsSync(manifestPath(siteRoot))) return siteRoot
    } catch (_) { /* skip */ }
  }
  // 浅层扫描
  try {
    const entries = fs.readdirSync(root, { withFileTypes: true })
    for (const ent of entries) {
      if (!ent.isDirectory()) continue
      if (['node_modules', '.git', 'dist', 'build'].includes(ent.name)) continue
      const p = path.join(root, ent.name, MANIFEST_NAME)
      if (fs.existsSync(p)) return path.join(root, ent.name)
    }
  } catch (_) { /* skip */ }
  return ''
}

function saveOption({ projectPath, siteDir = '', id = '', title = '', html = '', brief = '', colors = '' } = {}) {
  const siteRoot = findSiteRoot(projectPath, siteDir)
  if (!siteRoot) {
    return { success: false, error: '未找到网页交付站点，请先 action=init', error_type: 'not_found' }
  }
  const manifest = loadManifest(siteRoot) || {}
  const optionId = slugify(id || title || `opt-${(manifest.options || []).length + 1}`)
  const optionsDir = ensureDir(path.join(siteRoot, OPTIONS_DIR))
  const fileName = `${optionId}.html`
  const filePath = path.join(optionsDir, fileName)

  const fragment = String(html || '').trim() || buildBriefPreviewHtml(title, brief, colors)
  const standalone = wrapOptionHtml(title || optionId, fragment)
  fs.writeFileSync(filePath, standalone, 'utf8')

  const options = Array.isArray(manifest.options) ? [...manifest.options] : []
  const entry = {
    id: optionId,
    title: String(title || optionId).slice(0, 60),
    brief: String(brief || '').slice(0, 400),
    colors: String(colors || '').slice(0, 120),
    path: path.relative(siteRoot, filePath).replace(/\\/g, '/'),
    updatedAt: Date.now()
  }
  const idx = options.findIndex(item => item.id === optionId)
  if (idx >= 0) options[idx] = { ...options[idx], ...entry }
  else options.push(entry)
  // 最多保留 3 个（最近的优先）
  const trimmed = options.slice(-3)
  const next = saveManifest(siteRoot, {
    ...manifest,
    stage: 'design',
    options: trimmed
  })

  return {
    success: true,
    option: entry,
    options_count: trimmed.length,
    manifest: next,
    message: trimmed.length >= 2
      ? `已保存设计选项「${entry.title}」（共 ${trimmed.length} 个）。可继续 save_option 或 present_choices。`
      : `已保存设计选项「${entry.title}」。建议再准备 ${Math.max(0, 2 - trimmed.length)}~${Math.max(0, 3 - trimmed.length)} 个选项后 present_choices。`
  }
}

function buildBriefPreviewHtml(title = '', brief = '', colors = '') {
  const palette = String(colors || '#6366f1,#22c55e,#f59e0b')
    .split(/[,，\s]+/)
    .filter(Boolean)
    .slice(0, 5)
  const swatches = palette.map(c =>
    `<span style="display:inline-block;width:28px;height:28px;border-radius:8px;background:${escapeAttr(c)};margin-right:6px;border:1px solid rgba(127,127,127,.3)"></span>`
  ).join('')
  return `
    <div style="font-family:system-ui,sans-serif;padding:16px;color:#e8e9ed;background:#111">
      <div style="font-size:18px;font-weight:700;margin-bottom:8px">${escapeHtml(title || '设计方向')}</div>
      <div style="font-size:13px;line-height:1.55;color:#a1a1aa;margin-bottom:14px">${escapeHtml(brief || '暂无说明')}</div>
      <div>${swatches || '<span style="color:#71717a;font-size:12px">未指定色板</span>'}</div>
      <div style="margin-top:18px;height:90px;border-radius:12px;background:linear-gradient(135deg,${escapeAttr(palette[0] || '#6366f1')},${escapeAttr(palette[1] || '#1e1b4b')});opacity:.9"></div>
    </div>
  `
}

function wrapOptionHtml(title, body) {
  return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title>
<style>html,body{margin:0;background:#0b0c10;color:#e8e9ed}body{min-height:160px}</style></head><body>${body}</body></html>`
}

function escapeHtml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function escapeAttr(value = '') {
  return String(value).replace(/[<>"']/g, '')
}

function getStatus({ projectPath, siteDir = '' } = {}) {
  const siteRoot = findSiteRoot(projectPath, siteDir)
  if (!siteRoot) {
    return { success: true, initialized: false, message: '尚未 init 网页交付站点' }
  }
  const manifest = loadManifest(siteRoot)
  return {
    success: true,
    initialized: true,
    site_root: siteRoot,
    site_dir: manifest?.siteDir || path.relative(path.resolve(projectPath), siteRoot),
    index_path: path.join(siteRoot, 'index.html'),
    preview_url: pathToFileUrl(path.join(siteRoot, 'index.html')),
    manifest
  }
}

function setStage({ projectPath, siteDir = '', stage = '' } = {}) {
  const siteRoot = findSiteRoot(projectPath, siteDir)
  if (!siteRoot) return { success: false, error: '未找到站点', error_type: 'not_found' }
  const allowed = new Set(['design', 'building', 'preview', 'done'])
  const nextStage = String(stage || '').trim()
  if (!allowed.has(nextStage)) {
    return { success: false, error: `stage 必须是 ${[...allowed].join('|')}` }
  }
  const manifest = loadManifest(siteRoot) || {}
  const next = saveManifest(siteRoot, { ...manifest, stage: nextStage })
  return { success: true, stage: nextStage, manifest: next }
}

function recordSelection({ projectPath, siteDir = '', optionId = '', answer = '' } = {}) {
  const siteRoot = findSiteRoot(projectPath, siteDir)
  if (!siteRoot) return { success: false, error: '未找到站点' }
  const manifest = loadManifest(siteRoot) || {}
  const options = Array.isArray(manifest.options) ? manifest.options : []
  const selected = options.find(item => item.id === optionId || item.title === optionId)
  const next = saveManifest(siteRoot, {
    ...manifest,
    stage: 'building',
    selectedOptionId: selected?.id || optionId || '',
    selectedBrief: selected?.brief || answer || '',
    selectedTitle: selected?.title || optionId || answer || ''
  })
  return {
    success: true,
    selected: selected || { id: optionId, title: optionId, brief: answer },
    manifest: next,
    message: `用户已选择「${selected?.title || optionId || answer}」。请据此改写 index.html/styles.css，然后 open_preview 与 finalize。`
  }
}

function finalizeSite({ projectPath, siteDir = '', title = '' } = {}) {
  const siteRoot = findSiteRoot(projectPath, siteDir)
  if (!siteRoot) return { success: false, error: '未找到站点', error_type: 'not_found' }
  const indexPath = path.join(siteRoot, 'index.html')
  if (!fs.existsSync(indexPath)) {
    return { success: false, error: '缺少 index.html' }
  }
  let html = fs.readFileSync(indexPath, 'utf8')
  // 移除骨架区块
  html = html.replace(/<!--LINGXI_SKELETON_START-->[\s\S]*?<!--LINGXI_SKELETON_END-->/g, '')
  html = html.replace(/\s*data-lingxi-stage="skeleton"/g, ' data-lingxi-stage="done"')
  if (title) {
    html = html.replace(/<title>[^<]*<\/title>/i, `<title>${escapeHtml(title)}</title>`)
  }
  // 若仍几乎是空 app，写入最小成品
  if (!/<main[\s>]|class="hero"|class="site-main"/i.test(html)) {
    const manifest = loadManifest(siteRoot) || {}
    const t = title || manifest.title || '站点'
    html = html.replace(
      /<div id="app"[^>]*>[\s\S]*?<\/div>\s*<script/i,
      `<div id="app" class="app">
  <header class="site-header"><strong>${escapeHtml(t)}</strong></header>
  <main class="site-main hero">
    <h1>${escapeHtml(t)}</h1>
    <p>${escapeHtml(manifest.selectedBrief || manifest.description || '站点已就绪。')}</p>
  </main>
</div>
<script`
    )
  }
  fs.writeFileSync(indexPath, html, 'utf8')
  const manifest = loadManifest(siteRoot) || {}
  const next = saveManifest(siteRoot, { ...manifest, stage: 'done', finalizedAt: Date.now() })
  return {
    success: true,
    stage: 'done',
    index_path: indexPath,
    preview_url: pathToFileUrl(indexPath),
    manifest: next,
    message: '已收尾：骨架标记已清理，stage=done。可用 open_preview 展示最终页。'
  }
}

function buildPresentPayload(manifest = {}, siteRoot = '') {
  const options = (Array.isArray(manifest.options) ? manifest.options : []).slice(0, 3)
  return options.map((opt, index) => {
    const abs = path.join(siteRoot, opt.path || '')
    let previewHtml = ''
    try {
      if (fs.existsSync(abs)) previewHtml = fs.readFileSync(abs, 'utf8')
    } catch (_) { /* ignore */ }
    return {
      label: opt.title || `方案 ${index + 1}`,
      value: opt.id,
      desc: opt.brief || opt.colors || '',
      preview_html: previewHtml,
      preview_path: abs,
      presentation: 'design'
    }
  })
}

module.exports = {
  MANIFEST_NAME,
  initSite,
  saveOption,
  getStatus,
  setStage,
  recordSelection,
  finalizeSite,
  findSiteRoot,
  loadManifest,
  buildPresentPayload,
  pathToFileUrl,
  resolveSiteRoot
}
