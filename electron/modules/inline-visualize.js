/**
 * 对话内可视化：把 HTML 片段存到项目可视化目录，供聊天区沙箱渲染。
 * 指令格式：::lingxi-inline-vis{id="xxx"}
 */

const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const storageConfig = require('./storage-config')

const MAX_HTML_BYTES = 2 * 1024 * 1024
const DIRECTIVE_RE = /::lingxi-inline-vis\{([^}]*)\}/gi
const VISUAL_KINDS = new Set(['flow', 'relation', 'timeline', 'comparison', 'chart', 'simulator', 'diagram'])

const CDN_ALLOW = [
  'cdnjs.cloudflare.com',
  'esm.sh',
  'cdn.jsdelivr.net',
  'unpkg.com',
  'fonts.googleapis.com',
  'fonts.gstatic.com',
  'fonts.bunny.net'
]

function makeId() {
  const stamp = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14)
  const rand = crypto.randomBytes(4).toString('hex')
  // 纯 ASCII id，避免中文标题被剥掉后变成难查的残缺 id
  return `v${stamp}-${rand}`
}

function getBaseVisualDir() {
  try {
    return path.join(storageConfig.getBasePath(), 'visualizations')
  } catch (_) {
    return path.join(process.cwd(), '.lingxi', 'visualizations')
  }
}

/** 全局按 id 索引（权威读取源，不依赖 projectId） */
function getGlobalByIdRoot() {
  return path.join(getBaseVisualDir(), '_by_id')
}

function getVisualRoot(projectId = '') {
  const pid = String(projectId || 'global').replace(/[^\w.-]+/g, '_') || 'global'
  try {
    if (pid && pid !== 'global' && typeof storageConfig.getProjectDataDir === 'function') {
      return path.join(storageConfig.getProjectDataDir(pid), 'visualizations')
    }
  } catch (_) { /* fallthrough */ }
  return path.join(getBaseVisualDir(), pid)
}

function ensureRoot(dir) {
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

function safeId(id = '') {
  return String(id || '').trim().replace(/[^a-zA-Z0-9._-]+/g, '').slice(0, 120)
}

function isHostAllowed(url = '') {
  try {
    const u = new URL(url, 'https://placeholder.local')
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return false
    if (u.hostname === 'placeholder.local') return false
    return CDN_ALLOW.some(host => u.hostname === host || u.hostname.endsWith(`.${host}`))
  } catch {
    return false
  }
}

/**
 * 轻量净化：去掉危险协议与未允许的外链脚本；不解析完整 DOM。
 */
function sanitizeFragment(html = '') {
  let text = String(html || '')
  if (Buffer.byteLength(text, 'utf8') > MAX_HTML_BYTES) {
    return { ok: false, error: `可视化 HTML 超过 ${MAX_HTML_BYTES} 字节上限，请精简数据或图表。` }
  }
  // 禁止完整文档外壳（可剥掉）
  text = text
    .replace(/<!DOCTYPE[^>]*>/gi, '')
    .replace(/<\/?(html|head|body)[^>]*>/gi, '')
  // 危险协议
  text = text.replace(/\s(on\w+)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
  text = text.replace(/(href|src)\s*=\s*(['"])\s*javascript:[^'"]*\2/gi, '$1=$2#$2')
  text = text.replace(/(href|src)\s*=\s*(['"])\s*data:text\/html[^'"]*\2/gi, '$1=$2#$2')

  // 拦截 script src 非白名单
  text = text.replace(/<script\b([^>]*)>/gi, (full, attrs) => {
    const srcMatch = String(attrs || '').match(/\bsrc\s*=\s*(['"])(.*?)\1/i)
    if (!srcMatch) return full // 内联脚本保留（沙箱隔离）
    const src = srcMatch[2]
    if (isHostAllowed(src)) return full
    return `<!-- blocked script src -->`
  })

  // 拦截 link stylesheet 非白名单
  text = text.replace(/<link\b([^>]*)>/gi, (full, attrs) => {
    const rel = /\brel\s*=\s*(['"])stylesheet\1/i.test(attrs || '')
    if (!rel) return full
    const hrefMatch = String(attrs || '').match(/\bhref\s*=\s*(['"])(.*?)\1/i)
    if (!hrefMatch) return full
    if (isHostAllowed(hrefMatch[2])) return full
    return `<!-- blocked stylesheet -->`
  })

  return { ok: true, html: text.trim() }
}

function normalizeVisualKind(value = '') {
  const raw = String(value || '').trim().toLowerCase()
  const aliases = {
    flowchart: 'flow', workflow: 'flow', process: 'flow',
    graph: 'relation', map: 'relation', network: 'relation', architecture: 'relation',
    compare: 'comparison', table: 'comparison',
    plot: 'chart', dashboard: 'chart',
    simulation: 'simulator', interactive: 'simulator'
  }
  const normalized = aliases[raw] || raw
  return VISUAL_KINDS.has(normalized) ? normalized : ''
}

function inferVisualKind(title = '', html = '', explicitKind = '') {
  const explicit = normalizeVisualKind(explicitKind)
  if (explicit) return explicit
  const source = `${String(title || '')} ${String(html || '').slice(0, 12000)}`.toLowerCase()
  if (/时间线|时序|里程碑|timeline|chronolog|sequence/.test(source)) return 'timeline'
  if (/对比|比较|前后|before\s*after|comparison|compare/.test(source)) return 'comparison'
  if (/模拟|推演|调参|滑块|simulat|scenario|playground/.test(source)) return 'simulator'
  if (/折线|柱状|饼图|趋势|分布|chart|plot|histogram|dashboard/.test(source)) return 'chart'
  if (/流程|工作流|状态机|数据流|调用链|\bflow\b|flowchart|workflow|pipeline|state\s*machine/.test(source)) return 'flow'
  if (/关系|依赖|架构|拓扑|链路|priority[-_\s]*map|relation|network|topology|architecture|dependency|\bgraph\b|\bmap\b/.test(source)) return 'relation'
  return 'diagram'
}

function validateVisualStructure(kind = 'diagram', html = '') {
  if (kind !== 'flow' && kind !== 'relation') return { ok: true }
  const source = String(html || '')
  const hasNodes = /\bclass\s*=\s*(["'])[^"']*(?:viz-node|viz-flow__node|flow[-_]node|graph[-_]node|node[-_]card)[^"']*\1/i.test(source)
  const hasEdges = /\bclass\s*=\s*(["'])[^"']*(?:viz-connector|viz-edge|viz-branch|viz-flow__connector|viz-flow__branches|flow[-_]edge|graph[-_]edge|connector|branch|arrow)[^"']*\1/i.test(source)
  const hasSvgGraph = /<svg\b[\s\S]*?<(?:path|line|polyline|marker)\b/i.test(source)
  const hasGraphLibrary = /\b(?:mermaid|cytoscape|d3\.(?:select|force)|new\s+vis\.Network)\b/i.test(source)
  const hasGraphStructure = (
    hasSvgGraph ||
    hasGraphLibrary ||
    (hasNodes && hasEdges)
  )
  if (hasGraphStructure) return { ok: true }
  return {
    ok: false,
    error: kind === 'flow'
      ? '流程图不能只是纵向卡片列表。请使用 .viz-flow、.viz-node、.viz-connector/.viz-branches 构造真实节点与连线，或使用 SVG path/line；节点只保留标题和一句结论，详情放入 details。'
      : '关系图不能只是并列卡片列表。请使用 .viz-flow、.viz-node、.viz-connector/.viz-branches 表达依赖、分支与汇合，或使用 SVG path/line。'
  }
}

/**
 * 可视化主题令牌：默认跟随灵犀深色；浅色用 data-viz-theme="light"。
 * 不依赖 light-dark() / 系统 prefers-color-scheme 单独决策——
 * 宿主会在灌入 iframe 时注入真实主题，避免「应用深色、系统浅色」时字色发黑。
 */
function buildVizThemeCss() {
  return `
/* 默认：深色（灵犀默认界面） */
:root, html {
  color-scheme: dark;
  --background: #0a0b10;
  --foreground: #f1f5f9;
  --card: #161925;
  --card-foreground: #f1f5f9;
  --primary: #22d3ee;
  --primary-foreground: #0b0c10;
  --muted: rgba(255,255,255,0.08);
  --muted-foreground: #94a3b8;
  --accent: rgba(6,182,212,0.14);
  --accent-foreground: #22d3ee;
  --border: rgba(148,163,184,0.14);
  --font-size-base: 14px;
  --viz-series-1: #22d3ee;
  --viz-series-2: #f59a56;
  --viz-series-3: #74d58b;
  --viz-series-4: #f08fc0;
  --viz-series-5: #aa91ef;
  --viz-series-6: #5acbc2;
  /* 系列色块上的文字/图标，保证对比度 */
  --on-series: #0b0c10;
  --radius: 12px;
  font-family: -apple-system, system-ui, "Segoe UI", sans-serif;
}
/* 浅色主题 */
html[data-viz-theme="light"], :root[data-viz-theme="light"] {
  color-scheme: light;
  --background: #ffffff;
  --foreground: #1a1c1f;
  --card: #f4f6f8;
  --card-foreground: #1a1c1f;
  --primary: #0891b2;
  --primary-foreground: #ffffff;
  --muted: rgba(26,28,31,0.08);
  --muted-foreground: #64748b;
  --accent: #e0f7fa;
  --accent-foreground: #0e7490;
  --border: rgba(26,28,31,0.10);
  --viz-series-1: #0891b2;
  --viz-series-2: #ea580c;
  --viz-series-3: #16a34a;
  --viz-series-4: #db2777;
  --viz-series-5: #7c3aed;
  --viz-series-6: #0d9488;
  --on-series: #ffffff;
}
/* 未注入宿主主题时：仅当系统浅色且未强制 dark 才切浅色（新窗口兜底） */
@media (prefers-color-scheme: light) {
  html:not([data-viz-theme="dark"]):not([data-viz-theme="light"]) {
    color-scheme: light;
    --background: #ffffff;
    --foreground: #1a1c1f;
    --card: #f4f6f8;
    --card-foreground: #1a1c1f;
    --primary: #0891b2;
    --primary-foreground: #ffffff;
    --muted: rgba(26,28,31,0.08);
    --muted-foreground: #64748b;
    --accent: #e0f7fa;
    --accent-foreground: #0e7490;
    --border: rgba(26,28,31,0.10);
    --viz-series-1: #0891b2;
    --viz-series-2: #ea580c;
    --viz-series-3: #16a34a;
    --viz-series-4: #db2777;
    --viz-series-5: #7c3aed;
    --viz-series-6: #0d9488;
    --on-series: #ffffff;
  }
}
html, body { margin:0; padding:0; background: transparent; color: var(--foreground);
  font-size: var(--font-size-base); line-height: 1.5; }
#viz-root { width:100%; box-sizing:border-box; color: var(--foreground); }
.card { background: var(--card); color: var(--card-foreground); border:1px solid var(--border);
  border-radius: var(--radius); padding: 12px 14px; }
.viz-row { display:flex; flex-wrap:wrap; gap:8px; align-items:center; }
.viz-grid { display:grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap:10px; }
.viz-controls { display:flex; flex-wrap:wrap; gap:8px; align-items:center; margin-bottom:10px; }
.viz-stat-value { font-size: 1.35em; font-weight: 500; color: var(--foreground); }
.btn { appearance:none; border:1px solid var(--border); background: var(--muted); color: var(--foreground);
  border-radius:999px; padding:6px 12px; cursor:pointer; font: inherit; }
.btn-primary { background: var(--primary); color: var(--primary-foreground); border-color: transparent; }
.btn-ghost { background: transparent; color: var(--foreground); }
.btn[aria-pressed="true"], .btn.is-selected { background: var(--primary); color: var(--primary-foreground); border-color: transparent; }
.form-label { display:block; font-size:12px; color: var(--muted-foreground); margin-bottom:4px; }
.form-control, .form-select, .form-range { font: inherit; max-width:100%; }
.form-control, .form-select { border:1px solid var(--border); border-radius:8px; padding:6px 8px;
  background: var(--background); color: var(--foreground); }
.text-muted { color: var(--muted-foreground); }
.text-small { font-size: max(11px, calc(var(--font-size-base) - 2px)); }
/* 标准流程/关系图：避免模型把“流程图”退化成普通卡片列表 */
.viz-flow { display:grid; gap:8px; align-items:stretch; width:100%; box-sizing:border-box; }
.viz-flow--horizontal { grid-auto-flow:column; grid-auto-columns:minmax(150px,1fr); align-items:center; overflow-x:auto; padding-bottom:4px; }
.viz-node, .viz-flow__node { position:relative; min-width:0; padding:11px 13px; border:1px solid var(--border);
  border-radius:10px; background:color-mix(in srgb,var(--card) 92%,var(--primary) 8%); color:var(--foreground); box-sizing:border-box; }
.viz-node strong, .viz-flow__node strong { display:block; margin-bottom:3px; font-size:13px; line-height:1.35; }
.viz-node small, .viz-flow__node small { display:block; color:var(--muted-foreground); font-size:11px; line-height:1.45; }
.viz-node[data-priority="P0"], .viz-flow__node[data-priority="P0"] { border-color:color-mix(in srgb,var(--viz-series-4) 68%,var(--border)); box-shadow:inset 3px 0 0 var(--viz-series-4); }
.viz-node[data-priority="P1"], .viz-flow__node[data-priority="P1"] { border-color:color-mix(in srgb,var(--viz-series-2) 58%,var(--border)); box-shadow:inset 3px 0 0 var(--viz-series-2); }
.viz-node[data-state="success"], .viz-flow__node[data-state="success"] { border-color:color-mix(in srgb,var(--viz-series-3) 58%,var(--border)); box-shadow:inset 3px 0 0 var(--viz-series-3); }
.viz-connector, .viz-flow__connector { position:relative; display:grid; place-items:center; min-height:20px; color:var(--muted-foreground); font-size:10px; text-align:center; }
.viz-connector::before, .viz-flow__connector::before { content:""; position:absolute; top:0; bottom:0; left:50%; width:1px; background:color-mix(in srgb,var(--primary) 48%,var(--border)); }
.viz-connector::after, .viz-flow__connector::after { content:""; position:absolute; bottom:0; left:calc(50% - 3px); width:6px; height:6px;
  border-right:1.5px solid var(--primary); border-bottom:1.5px solid var(--primary); transform:rotate(45deg); }
.viz-connector > span, .viz-flow__connector > span { position:relative; z-index:1; padding:1px 7px; border:1px solid var(--border); border-radius:999px; background:var(--background); }
.viz-flow--horizontal > .viz-connector, .viz-flow--horizontal > .viz-flow__connector { min-width:34px; min-height:0; }
.viz-flow--horizontal > .viz-connector::before, .viz-flow--horizontal > .viz-flow__connector::before { top:50%; right:0; bottom:auto; left:0; width:auto; height:1px; }
.viz-flow--horizontal > .viz-connector::after, .viz-flow--horizontal > .viz-flow__connector::after { top:calc(50% - 3px); right:0; bottom:auto; left:auto; transform:rotate(-45deg); }
.viz-branches, .viz-flow__branches { display:grid; grid-template-columns:repeat(auto-fit,minmax(170px,1fr)); gap:10px; position:relative; padding-top:14px; }
.viz-branches::before, .viz-flow__branches::before { content:""; position:absolute; top:4px; left:12%; right:12%; height:1px; background:color-mix(in srgb,var(--primary) 42%,var(--border)); }
.viz-branch, .viz-flow__branch { position:relative; display:grid; gap:7px; }
.viz-branch::before, .viz-flow__branch::before { content:""; position:absolute; top:-10px; left:50%; width:1px; height:10px; background:color-mix(in srgb,var(--primary) 42%,var(--border)); }
.viz-flow details { margin-top:7px; color:var(--muted-foreground); font-size:11px; }
.viz-flow summary { cursor:pointer; color:var(--accent-foreground); }
/* 旧版关系图兼容：过去模型常把关系图输出成单列卡片。读取旧数据时，
 * 用标题作为根节点、各卡片作为分支节点补出真实的树状关系。 */
html[data-viz-kind="relation"] #viz-root > .card > .viz-grid:not(.viz-flow) {
  position:relative;
  grid-template-columns:repeat(auto-fit,minmax(180px,1fr)) !important;
  gap:12px !important;
  padding-top:18px;
}
html[data-viz-kind="relation"] #viz-root > .card > .viz-grid:not(.viz-flow)::before {
  content:"";
  position:absolute;
  top:7px;
  left:12%;
  right:12%;
  height:1px;
  background:color-mix(in srgb,var(--primary) 42%,var(--border));
}
html[data-viz-kind="relation"] #viz-root > .card > .viz-grid:not(.viz-flow) > * {
  position:relative;
  min-width:0;
}
html[data-viz-kind="relation"] #viz-root > .card > .viz-grid:not(.viz-flow) > *::before {
  content:"";
  position:absolute;
  top:-12px;
  left:50%;
  width:1px;
  height:12px;
  background:color-mix(in srgb,var(--primary) 42%,var(--border));
}
@media (max-width:640px) { .viz-flow--horizontal { grid-auto-flow:row; grid-auto-columns:auto; overflow:visible; }
  .viz-flow--horizontal > .viz-connector::before, .viz-flow--horizontal > .viz-flow__connector::before { top:0; bottom:0; left:50%; right:auto; width:1px; height:auto; }
  .viz-flow--horizontal > .viz-connector::after, .viz-flow--horizontal > .viz-flow__connector::after { top:auto; right:auto; bottom:0; left:calc(50% - 3px); transform:rotate(45deg); }
  html[data-viz-kind="relation"] #viz-root > .card > .viz-grid:not(.viz-flow) { grid-template-columns:1fr !important; padding-top:0; padding-left:18px; }
  html[data-viz-kind="relation"] #viz-root > .card > .viz-grid:not(.viz-flow)::before { top:8px; bottom:8px; left:6px; right:auto; width:1px; height:auto; }
  html[data-viz-kind="relation"] #viz-root > .card > .viz-grid:not(.viz-flow) > *::before { top:50%; left:-12px; width:12px; height:1px; }
}
.sr-only { position:absolute; width:1px; height:1px; padding:0; margin:-1px; overflow:hidden; clip:rect(0,0,0,0); white-space:nowrap; border:0; }
/* SVG 文本默认跟前景色，系列色块上的标签用 --on-series */
svg text { fill: var(--foreground); }
svg .on-series, svg text.on-series { fill: var(--on-series); }
`
}

function wrapStandalone(fragment = '', title = '可视化', kind = 'diagram') {
  // 与 skills/inline-visual 约定的宿主设计系统
  const cssVars = buildVizThemeCss()
  const csp = [
    "default-src 'none'",
    "img-src data: blob: https:",
    "font-src https://fonts.gstatic.com https://fonts.bunny.net data:",
    "style-src 'unsafe-inline' https://fonts.googleapis.com https://cdnjs.cloudflare.com https://cdn.jsdelivr.net https://unpkg.com https://esm.sh",
    "script-src 'unsafe-inline' https://cdnjs.cloudflare.com https://cdn.jsdelivr.net https://unpkg.com https://esm.sh",
    "connect-src https://cdnjs.cloudflare.com https://cdn.jsdelivr.net https://unpkg.com https://esm.sh https://fonts.googleapis.com https://fonts.gstatic.com",
    "frame-src 'none'",
    "object-src 'none'",
    "base-uri 'none'"
  ].join('; ')

  return `<!DOCTYPE html>
<html lang="zh-CN" data-viz-theme="dark" data-viz-kind="${normalizeVisualKind(kind) || 'diagram'}" data-viz-contract="2">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="color-scheme" content="dark light">
<title>${String(title || '可视化').replace(/[<>&"]/g, '')}</title>
<style>${cssVars}</style>
</head>
<body>
<div id="viz-root">${fragment}</div>
<script>
(function () {
  function report() {
    try {
      var h = Math.max(
        document.getElementById('viz-root') ? Math.ceil(document.getElementById('viz-root').getBoundingClientRect().height) : 0,
        document.documentElement ? document.documentElement.scrollHeight : 0,
        document.body ? document.body.scrollHeight : 0,
        120
      );
      parent.postMessage({ type: 'lingxi-vis-resize', height: h }, '*');
    } catch (e) {}
  }
  function applyHostTheme(payload) {
    try {
      var theme = payload && payload.theme ? payload.theme : payload || {};
      var mode = theme.mode === 'light' ? 'light' : 'dark';
      var root = document.documentElement;
      root.setAttribute('data-viz-theme', mode);
      root.style.colorScheme = mode;
      var meta = document.querySelector('meta[name="color-scheme"]');
      if (meta) meta.setAttribute('content', mode === 'light' ? 'light dark' : 'dark light');
      var style = document.getElementById('lingxi-host-theme');
      if (!style) {
        style = document.createElement('style');
        style.id = 'lingxi-host-theme';
        document.head.appendChild(style);
      }
      if (theme.cssText) {
        style.textContent = theme.cssText;
      } else if (theme.vars && typeof theme.vars === 'object') {
        var lines = [':root,html[data-viz-theme]{color-scheme:' + mode + ';'];
        Object.keys(theme.vars).forEach(function (k) {
          if (theme.vars[k]) lines.push(k + ':' + theme.vars[k] + ';');
        });
        lines.push('}');
        style.textContent = lines.join('');
      }
      report();
    } catch (e) {}
  }
  window.addEventListener('message', function (event) {
    var data = event.data || {};
    if (data.type === 'lingxi-vis-theme') applyHostTheme(data);
  });
  window.addEventListener('load', report);
  window.addEventListener('resize', report);
  setTimeout(report, 80);
  setTimeout(report, 400);
  if (typeof ResizeObserver !== 'undefined' && document.body) {
    try { new ResizeObserver(report).observe(document.body); } catch (e) {}
  }
})();
</script>
</body>
</html>`
}

function metaPath(root, id) {
  return path.join(root, `${id}.json`)
}

function htmlPath(root, id) {
  return path.join(root, `${id}.html`)
}

function fragmentPath(root, id) {
  return path.join(root, `${id}.fragment.html`)
}

function buildDirective(id) {
  return `::lingxi-inline-vis{id="${id}"}`
}

function writeVisualFiles(root, visualId, fragment, standalone, meta) {
  ensureRoot(root)
  fs.writeFileSync(fragmentPath(root, visualId), fragment, 'utf8')
  fs.writeFileSync(htmlPath(root, visualId), standalone, 'utf8')
  fs.writeFileSync(metaPath(root, visualId), JSON.stringify(meta, null, 2), 'utf8')
}

function resolveVisualPaths(projectId = '', id = '') {
  const visualId = safeId(id)
  if (!visualId) return null
  const candidates = [
    getGlobalByIdRoot(),
    getVisualRoot(projectId),
    getVisualRoot('global'),
    getBaseVisualDir()
  ]
  // 去重
  const roots = [...new Set(candidates.filter(Boolean))]
  for (const root of roots) {
    const file = htmlPath(root, visualId)
    const frag = fragmentPath(root, visualId)
    if (fs.existsSync(file) || fs.existsSync(frag)) {
      return { visualId, root, file, frag, metaFile: metaPath(root, visualId) }
    }
  }
  // 浅扫 projects/*/visualizations 与 visualizations/*
  try {
    const base = getBaseVisualDir()
    if (fs.existsSync(base)) {
      for (const name of fs.readdirSync(base)) {
        const root = path.join(base, name)
        try {
          if (!fs.statSync(root).isDirectory()) continue
          const file = htmlPath(root, visualId)
          const frag = fragmentPath(root, visualId)
          if (fs.existsSync(file) || fs.existsSync(frag)) {
            return { visualId, root, file, frag, metaFile: metaPath(root, visualId) }
          }
        } catch (_) { /* skip */ }
      }
    }
  } catch (_) { /* skip */ }
  try {
    const projectsDir = storageConfig.getProjectsDir?.()
    if (projectsDir && fs.existsSync(projectsDir)) {
      for (const name of fs.readdirSync(projectsDir)) {
        const root = path.join(projectsDir, name, 'visualizations')
        const file = htmlPath(root, visualId)
        const frag = fragmentPath(root, visualId)
        if (fs.existsSync(file) || fs.existsSync(frag)) {
          return { visualId, root, file, frag, metaFile: metaPath(root, visualId) }
        }
      }
    }
  } catch (_) { /* skip */ }
  return { visualId, root: null, file: '', frag: '', metaFile: '' }
}

function saveVisual({ projectId = '', id = '', title = '', kind = '', html = '', update = false } = {}) {
  const cleaned = sanitizeFragment(html)
  if (!cleaned.ok) return { success: false, error: cleaned.error, error_type: 'invalid_tool_args' }

  const globalRoot = ensureRoot(getGlobalByIdRoot())
  let visualId = safeId(id)
  if (update && visualId) {
    const found = resolveVisualPaths(projectId, visualId)
    if (!found?.root) {
      return { success: false, error: `可视化不存在：${visualId}`, error_type: 'not_found' }
    }
  } else {
    visualId = makeId()
  }

  const fragment = cleaned.html
  let previousMeta = null
  const existingMeta = metaPath(globalRoot, visualId)
  if (update && fs.existsSync(existingMeta)) {
    try { previousMeta = JSON.parse(fs.readFileSync(existingMeta, 'utf8')) } catch (_) { /* ignore */ }
  }
  const resolvedTitle = String(title || previousMeta?.title || visualId).slice(0, 120)
  const resolvedKind = inferVisualKind(resolvedTitle, fragment, kind || previousMeta?.kind)
  const structure = validateVisualStructure(resolvedKind, fragment)
  if (!structure.ok) {
    return {
      success: false,
      error: structure.error,
      error_type: 'visual_structure_required',
      recoverable: true,
      suggested_kind: resolvedKind
    }
  }
  const standalone = wrapStandalone(fragment, resolvedTitle, resolvedKind)
  const meta = {
    id: visualId,
    title: resolvedTitle,
    kind: resolvedKind,
    projectId: String(projectId || ''),
    createdAt: Date.now(),
    updatedAt: Date.now(),
    bytes: Buffer.byteLength(fragment, 'utf8')
  }

  if (previousMeta) meta.createdAt = previousMeta.createdAt || meta.createdAt

  // 权威：全局 by-id
  writeVisualFiles(globalRoot, visualId, fragment, standalone, meta)
  // 冗余：项目目录（便于按项目清理）
  if (projectId) {
    try {
      writeVisualFiles(ensureRoot(getVisualRoot(projectId)), visualId, fragment, standalone, meta)
    } catch (_) { /* ignore project copy errors */ }
  }

  const directive = buildDirective(visualId)
  return {
    success: true,
    internal: true,
    id: visualId,
    title: meta.title,
    kind: meta.kind,
    path: htmlPath(globalRoot, visualId),
    directive,
    // 给前端/自动嵌入用，不依赖 projectId
    message: `内嵌可视化已就绪（id=${visualId}）。请在最终说明里自然引用；系统也会自动嵌入。`,
    model_facing_hint: `若你要在正文中指定展示位置，可单独一行写 ${directive}；也可不写，系统会在最终回复末尾自动嵌入。不要向用户提及工具名或指令语法。`
  }
}

function readVisual({ projectId = '', id = '' } = {}) {
  const found = resolveVisualPaths(projectId, id)
  if (!found?.visualId) return { success: false, error: '缺少 id' }
  if (!found.root) {
    return { success: false, error: `可视化不存在：${found.visualId}` }
  }
  let meta = { id: found.visualId, title: found.visualId }
  try {
    if (fs.existsSync(found.metaFile)) meta = { ...meta, ...JSON.parse(fs.readFileSync(found.metaFile, 'utf8')) }
  } catch (_) { /* ignore */ }
  const hasFragment = fs.existsSync(found.frag)
  const fragment = hasFragment ? fs.readFileSync(found.frag, 'utf8') : ''
  const storedHtml = fs.existsSync(found.file) ? fs.readFileSync(found.file, 'utf8') : ''
  meta.kind = inferVisualKind(meta.title, fragment || storedHtml, meta.kind)
  // 旧文件缺少类型和新版节点/连线样式，读取时无损重包一层即可升级，
  // 不改用户保存的原始 fragment，也不需要用户重新生成。
  const html = storedHtml.includes('data-viz-contract="2"') || !hasFragment
    ? storedHtml
    : wrapStandalone(fragment, meta.title, meta.kind)
  return {
    success: true,
    id: found.visualId,
    title: meta.title || found.visualId,
    kind: meta.kind,
    html,
    meta
  }
}

/**
 * 若模型最终回复漏写 directive，把本轮成功的可视化自动补到文末。
 */
function appendMissingVisualDirectives(content = '', toolCalls = []) {
  let text = String(content || '')
  const existing = new Set(extractDirectiveIds(text))
  const toAdd = []
  for (const call of Array.isArray(toolCalls) ? toolCalls : []) {
    const name = call?.name || call?.function?.name || ''
    if (name !== 'create_inline_visual') continue
    const result = call?.result || {}
    if (result.success === false) continue
    const id = safeId(result.id || '')
    if (!id || existing.has(id)) continue
    existing.add(id)
    toAdd.push(buildDirective(id))
  }
  if (!toAdd.length) return text
  const trimmed = text.trimEnd()
  return `${trimmed}${trimmed ? '\n\n' : ''}${toAdd.join('\n')}`
}

function listVisuals(projectId = '', limit = 30) {
  const root = getVisualRoot(projectId)
  if (!fs.existsSync(root)) return { success: true, items: [] }
  const files = fs.readdirSync(root).filter(name => name.endsWith('.json'))
  const items = []
  for (const name of files) {
    try {
      const meta = JSON.parse(fs.readFileSync(path.join(root, name), 'utf8'))
      items.push(meta)
    } catch (_) { /* skip */ }
  }
  items.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
  return { success: true, items: items.slice(0, Math.max(1, Math.min(100, limit))) }
}

function extractDirectiveIds(text = '') {
  const ids = []
  const re = new RegExp(DIRECTIVE_RE.source, 'gi')
  let match
  while ((match = re.exec(String(text || ''))) !== null) {
    const body = match[1] || ''
    const idMatch = body.match(/id\s*=\s*["']?([a-zA-Z0-9._-]+)/i)
    if (idMatch) ids.push(idMatch[1])
  }
  return [...new Set(ids)]
}

function registerInlineVisualizeIPC(ipcMain) {
  ipcMain.handle('inline-visualize:get', async (event, payload = {}) => {
    return readVisual(payload || {})
  })
  ipcMain.handle('inline-visualize:list', async (event, projectId = '', limit = 30) => {
    return listVisuals(projectId, limit)
  })
  ipcMain.handle('inline-visualize:save', async (event, payload = {}) => {
    return saveVisual(payload || {})
  })
}

module.exports = {
  MAX_HTML_BYTES,
  CDN_ALLOW,
  DIRECTIVE_RE,
  saveVisual,
  readVisual,
  listVisuals,
  extractDirectiveIds,
  appendMissingVisualDirectives,
  buildDirective,
  sanitizeFragment,
  normalizeVisualKind,
  inferVisualKind,
  validateVisualStructure,
  wrapStandalone,
  buildVizThemeCss,
  registerInlineVisualizeIPC,
  getVisualRoot,
  getGlobalByIdRoot
}
