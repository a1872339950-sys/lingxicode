const fs = require('fs')
const path = require('path')
const { execFileSync, spawn } = require('child_process')
const os = require('os')
const storageConfig = require('./storage-config')

const WINDOWS_EXECUTABLE_EXTENSIONS = new Set(['.exe', '.bat', '.cmd', '.com', '.lnk'])
const LOCAL_APPS_CACHE_FILE = 'local-apps-cache.json'
const LOCAL_APPS_CUSTOM_FILE = 'local-apps-custom.json'

const KNOWN_ALIASES = {
  blender: ['blender.exe'],
  'vs code': ['Code.exe'],
  vscode: ['Code.exe'],
  chrome: ['chrome.exe'],
  edge: ['msedge.exe'],
  notepad: ['notepad.exe'],
  powershell: ['powershell.exe', 'pwsh.exe'],
  cmd: ['cmd.exe']
}

function fileExists(filePath) {
  try {
    return !!filePath && fs.existsSync(filePath) && fs.statSync(filePath).isFile()
  } catch (error) {
    return false
  }
}

async function extractAppIcons(apps) {
  if (!apps || !apps.length) return

  const validApps = apps
    .map(item => ({ item, iconPath: getIconSourcePath(item) }))
    .filter(entry => entry.iconPath)
  if (!validApps.length) return

  const missingApps = []
  const electronApp = getElectronApp()

  if (electronApp?.getFileIcon) {
    for (const entry of validApps) {
      try {
        const image = await electronApp.getFileIcon(entry.iconPath, { size: 'large' })
        if (image && !image.isEmpty()) {
          entry.item.icon = image.toDataURL()
          continue
        }
      } catch (e) { /* getFileIcon 失败，走 fallback 路径 */ }
      missingApps.push(entry.item)
    }
  } else {
    missingApps.push(...validApps.map(entry => entry.item))
  }

  if (missingApps.length) {
    await extractAppIconsWithPowerShell(missingApps)
  }
}

function getElectronApp() {
  try {
    const electron = require('electron')
    if (electron?.app?.isReady?.()) return electron.app
  } catch (e) { /* 非 Electron 环境或 app 未就绪 */ }
  return null
}

async function extractAppIconsWithPowerShell(apps) {
  const tmpRoot = os.tmpdir().replace(/[^\x20-\x7E]/g, '') || process.env.WINDIR + '\\Temp'
  const tmpDir = path.join(tmpRoot, 'lx-icons-' + Date.now())
  try { fs.mkdirSync(tmpDir, { recursive: true }) } catch (e) { return }

  const entries = apps
    .map((item, index) => ({ index, path: getIconSourcePath(item) }))
    .filter(entry => entry.path)

  if (!entries.length) {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }) } catch (e) { /* 清理临时目录，失败可忽略 */ }
    return
  }

  const entriesJson = JSON.stringify(entries)
    .replace(/[^\x00-\x7F]/g, char => '\\u' + char.charCodeAt(0).toString(16).padStart(4, '0'))

  const psScript = `
$ErrorActionPreference = 'SilentlyContinue'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName System.Drawing
$tmpDir = '${tmpDir.replace(/'/g, "''")}'
$entries = @'
${entriesJson}
'@ | ConvertFrom-Json
foreach ($entry in $entries) {
  $filePath = [string]$entry.path
  $idx = [string]$entry.index
  $target = $filePath
  $iconLocation = ''
  if ($filePath -match '\\.lnk$') {
    $shell = New-Object -ComObject WScript.Shell
    $shortcut = $shell.CreateShortcut($filePath)
    $target = $shortcut.TargetPath
    $iconLocation = $shortcut.IconLocation
    [System.Runtime.Interopservices.Marshal]::ReleaseComObject($shell) | Out-Null
  }
  if ($iconLocation) {
    $iconPath = ($iconLocation -split ',', 2)[0].Trim('"')
    if ($iconPath -and (Test-Path -LiteralPath $iconPath)) { $target = $iconPath }
  }
  if (-not $target -or -not (Test-Path -LiteralPath $target)) { continue }
  try {
    $icon = [System.Drawing.Icon]::ExtractAssociatedIcon($target)
    if ($icon -and $icon.Width -gt 0) {
      $bmp = $icon.ToBitmap()
      $outPath = Join-Path $tmpDir "$idx.png"
      $bmp.Save($outPath, [System.Drawing.Imaging.ImageFormat]::Png)
      $bmp.Dispose()
      $icon.Dispose()
    }
  } catch {}
}
`.trim()

  try {
    const scriptFile = path.join(tmpDir, '_extract.ps1')
    fs.writeFileSync(scriptFile, psScript, 'utf8')

    execFileSync('powershell.exe', [
      '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptFile
    ], { encoding: 'utf8', windowsHide: true, timeout: 30000 })

    for (const entry of entries) {
      const pngPath = path.join(tmpDir, `${entry.index}.png`)
      if (fileExists(pngPath)) {
        try {
          const buf = fs.readFileSync(pngPath)
          apps[entry.index].icon = 'data:image/png;base64,' + buf.toString('base64')
        } catch (e) { /* 读取图标 PNG 失败 */ }
      }
    }
  } catch (e) {
    /* PowerShell 图标提取整体失败 */
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }) } catch (e) { /* 清理临时目录，失败可忽略 */ }
  }
}

function dirExists(dirPath) {
  try {
    return !!dirPath && fs.existsSync(dirPath) && fs.statSync(dirPath).isDirectory()
  } catch (error) {
    return false
  }
}

function normalizeText(value = '') {
  return String(value || '').trim().toLowerCase()
}

function isValidAppIconValue(value = '') {
  const text = String(value || '').trim()
  if (!text) return false
  if (text.includes('${') || text.includes('escapeAttr(') || text.includes('undefined')) return false
  if (/^data:image\/(?:png|jpe?g|webp|gif|bmp|svg\+xml);base64,/i.test(text)) return true
  if (/^file:\/\/\/?/i.test(text)) return true
  if (/^[A-Za-z]:[\\/]/.test(text)) return fileExists(text)
  return false
}

function cleanExecutablePath(value = '') {
  let cleaned = String(value || '').trim()
  if (!cleaned) return ''
  cleaned = expandWindowsEnvVars(cleaned)
  cleaned = cleaned.replace(/^"|"$/g, '').replace(/",\d+$/, '').replace(/,\d+$/, '')
  return cleaned
}

function cleanIconLocation(value = '') {
  const location = String(value || '').trim()
  if (!location) return ''
  return cleanExecutablePath(location.split(',')[0])
}

function expandWindowsEnvVars(value = '') {
  return String(value || '').replace(/%([^%]+)%/g, (match, key) => process.env[key] || match)
}

function getIconSourcePath(app = {}) {
  const candidates = [app.iconSourcePath, app.executablePath, app.path]
  for (const candidate of candidates) {
    const cleaned = cleanExecutablePath(candidate)
    if (cleaned && fileExists(cleaned)) return cleaned
  }
  return ''
}

function ensureDirForFile(filePath) {
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true })
  } catch (e) { /* 创建目录失败（权限不足等） */ }
}

function readJsonFile(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return fallback
    return JSON.parse(fs.readFileSync(filePath, 'utf8'))
  } catch (e) {
    return fallback
  }
}

function writeJsonFile(filePath, data) {
  ensureDirForFile(filePath)
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8')
}

function getLocalAppsCachePath() {
  return path.join(storageConfig.getCacheDir(), LOCAL_APPS_CACHE_FILE)
}

function getLocalAppsCustomPath() {
  return path.join(storageConfig.getConfigDir(), LOCAL_APPS_CUSTOM_FILE)
}

function readCustomApps() {
  const data = readJsonFile(getLocalAppsCustomPath(), { apps: [] })
  return Array.isArray(data?.apps) ? data.apps : []
}

function writeCustomApps(apps) {
  writeJsonFile(getLocalAppsCustomPath(), {
    version: 1,
    updatedAt: Date.now(),
    apps
  })
}

function readLocalAppsCache() {
  const data = readJsonFile(getLocalAppsCachePath(), null)
  if (!data || !Array.isArray(data.apps)) {
    const customApps = readCustomApps()
    return {
      success: true,
      cacheHit: false,
      apps: filterDisplayableApps(customApps),
      scannedAt: null
    }
  }

  return {
    success: true,
    cacheHit: true,
    apps: filterDisplayableApps(mergeAppLists(data.apps, readCustomApps())),
    scannedAt: data.scannedAt || null
  }
}

function writeLocalAppsCache(apps, meta = {}) {
  writeJsonFile(getLocalAppsCachePath(), {
    version: 1,
    scannedAt: meta.scannedAt || Date.now(),
    apps: filterDisplayableApps(apps)
  })
}

function getAppIdentityKey(app = {}) {
  const executable = String(app.executablePath || app.path || '').toLowerCase()
  const args = normalizeLaunchArgs(app.launchArgs || '')
  const name = normalizeAppNameForDedupe(app.name || '')
  return executable ? `${executable}|${args}` : `name:${name}`
}

function mergeAppLists(...lists) {
  const merged = new Map()
  for (const list of lists) {
    for (const app of Array.isArray(list) ? list : []) {
      if (!app?.name || !app.path) continue
      const key = getAppIdentityKey(app)
      merged.set(key, chooseBetterAppEntry(merged.get(key), app))
    }
  }

  const byName = new Map()
  for (const app of merged.values()) {
    const key = normalizeAppNameForDedupe(app.name)
    byName.set(key, chooseBetterAppEntry(byName.get(key), app))
  }

  return [...byName.values()]
    .sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')))
}

function hasCorruptDisplayName(name = '') {
  const text = String(name || '').trim()
  if (!text) return true
  if (/[\uFFFD]/.test(text)) return true
  if (/^[?\s]+$/.test(text)) return true
  return false
}

function filterDisplayableApps(apps = []) {
  const normalized = (Array.isArray(apps) ? apps : []).map(app => normalizeLaunchableApp(app)).filter(Boolean)
  return normalized.filter(app => {
    if (!app?.name || !app.path || hasCorruptDisplayName(app.name)) return false
    if (app.custom) return true
    if (isNoiseAppEntry(app.name) || isSystemComponentEntry(app)) return false
    return true
  })
}

function normalizeLaunchableApp(app = {}) {
  if (!app?.name) return null
  const executablePath = cleanExecutablePath(app.executablePath || app.path || '')
  if (!executablePath || !fileExists(executablePath) || !isExecutablePath(executablePath)) return null

  const originalPath = cleanExecutablePath(app.path || '')
  const next = { ...app }
  if (originalPath && path.extname(originalPath).toLowerCase() === '.lnk') {
    next.shortcutPath = path.resolve(originalPath)
  }
  next.executablePath = path.resolve(executablePath)
  next.path = next.executablePath
  if (next.icon && !isValidAppIconValue(next.icon)) delete next.icon
  return next
}

function isExecutablePath(filePath) {
  return WINDOWS_EXECUTABLE_EXTENSIONS.has(path.extname(filePath).toLowerCase())
}

function addCandidate(candidates, filePath, source, label = '') {
  const cleaned = cleanExecutablePath(filePath)
  if (!cleaned || !isExecutablePath(cleaned) || !fileExists(cleaned)) return
  const key = path.resolve(cleaned).toLowerCase()
  if (candidates.some(item => item.key === key)) return
  candidates.push({
    key,
    path: path.resolve(cleaned),
    source,
    label: label || path.basename(cleaned)
  })
}

function tokenizeQuery(query = '') {
  return normalizeText(query)
    .replace(/\.exe$/i, '')
    .split(/[\s._\-\\/]+/)
    .filter(Boolean)
}

function nameMatches(query, value) {
  const normalizedQuery = normalizeText(query).replace(/\.exe$/i, '')
  const normalizedValue = normalizeText(value)
  if (!normalizedQuery || !normalizedValue) return false
  if (normalizedValue.includes(normalizedQuery)) return true
  const tokens = tokenizeQuery(query)
  return tokens.length > 0 && tokens.every(token => normalizedValue.includes(token))
}

function getCommonRoots() {
  return [
    process.env.ProgramFiles,
    process.env['ProgramFiles(x86)'],
    process.env.LOCALAPPDATA,
    process.env.APPDATA,
    'C:\\Program Files',
    'C:\\Program Files (x86)'
  ].filter(Boolean)
}

function getStartMenuRoots() {
  return [
    process.env.ProgramData && path.join(process.env.ProgramData, 'Microsoft', 'Windows', 'Start Menu', 'Programs'),
    process.env.APPDATA && path.join(process.env.APPDATA, 'Microsoft', 'Windows', 'Start Menu', 'Programs')
  ].filter(Boolean)
}

function scanDirectoryForExecutables(root, query, candidates, source, options = {}) {
  if (!dirExists(root)) return
  const maxDepth = Number.isFinite(options.maxDepth) ? options.maxDepth : 3
  const maxItems = Number.isFinite(options.maxItems) ? options.maxItems : 1600
  let seen = 0

  function walk(dir, depth) {
    if (seen >= maxItems || depth > maxDepth) return
    let items = []
    try {
      items = fs.readdirSync(dir, { withFileTypes: true })
    } catch (error) {
      return
    }
    for (const item of items) {
      if (seen >= maxItems) return
      seen++
      const fullPath = path.join(dir, item.name)
      if (item.isDirectory()) {
        if (depth < maxDepth && nameMatches(query, `${item.name} ${fullPath}`)) {
          scanDirectoryForExecutables(fullPath, query, candidates, source, { maxDepth: 2, maxItems: 500 })
        } else if (depth < 1) {
          walk(fullPath, depth + 1)
        }
        continue
      }
      if (!isExecutablePath(fullPath)) continue
      if (nameMatches(query, `${item.name} ${fullPath}`)) {
        addCandidate(candidates, fullPath, source)
      }
    }
  }

  walk(root, 0)
}

function addWhereCandidates(query, candidates) {
  const queryValue = String(query || '').trim()
  if (!queryValue) return
  const names = new Set([queryValue, `${queryValue}.exe`, ...(KNOWN_ALIASES[normalizeText(queryValue)] || [])])
  for (const name of names) {
    try {
      const output = execFileSync('where.exe', [name], { encoding: 'utf8', windowsHide: true, timeout: 3000 })
      output.split(/\r?\n/).map(line => line.trim()).filter(Boolean).forEach(item => {
        addCandidate(candidates, item, 'PATH')
      })
    } catch (error) { /* where.exe 未找到该程序 */ }
  }
}

function addRegistryCandidates(query, candidates) {
  try {
    const script = [
      "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8",
      "$OutputEncoding = [System.Text.Encoding]::UTF8",
      "$items = Get-ItemProperty 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*','HKLM:\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*','HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*' -ErrorAction SilentlyContinue",
      `$items | Where-Object { $_.DisplayName -and $_.DisplayName -like ${JSON.stringify(`*${query}*`)} } | Select-Object DisplayName,InstallLocation,DisplayIcon | ConvertTo-Json -Depth 3`
    ].join('; ')
    const output = execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 7000
    }).trim()
    if (!output) return
    const parsed = JSON.parse(output)
    const rows = Array.isArray(parsed) ? parsed : [parsed]
    for (const row of rows) {
      const label = row.DisplayName || query
      addCandidate(candidates, row.DisplayIcon, 'registry', label)
      const installLocation = cleanExecutablePath(row.InstallLocation)
      if (dirExists(installLocation)) {
        for (const alias of KNOWN_ALIASES[normalizeText(query)] || []) {
          addCandidate(candidates, path.join(installLocation, alias), 'registry', label)
        }
        scanDirectoryForExecutables(installLocation, query, candidates, 'registry', { maxDepth: 2, maxItems: 700 })
      }
    }
  } catch (error) { /* 注册表查询已安装应用失败 */ }
}

function addStartMenuCandidates(query, candidates) {
  for (const root of getStartMenuRoots()) {
    scanDirectoryForExecutables(root, query, candidates, 'start-menu', { maxDepth: 8, maxItems: 2500 })
  }
}

function addCommonRootCandidates(query, candidates) {
  for (const root of getCommonRoots()) {
    scanDirectoryForExecutables(root, query, candidates, 'common-paths', { maxDepth: 3, maxItems: 1800 })
  }
}

function findSoftware(input = {}) {
  const query = input.name || input.query || input.app || input.application || ''
  const explicitPath = input.path || input.executable_path || input.executablePath || ''
  const candidates = []

  if (explicitPath) {
    addCandidate(candidates, explicitPath, 'explicit', input.name || '')
    if (candidates[0]) return { success: true, found: true, query, candidates, executable: candidates[0].path, selected: candidates[0] }
    return { success: false, found: false, query, error: `软件路径不存在或不可执行: ${explicitPath}`, candidates: [] }
  }

  if (!query) return { success: false, found: false, error: '需要提供软件名称或可执行文件路径', candidates: [] }

  addWhereCandidates(query, candidates)
  addRegistryCandidates(query, candidates)
  addStartMenuCandidates(query, candidates)
  addCommonRootCandidates(query, candidates)

  if (!candidates.length) {
    return {
      success: false,
      found: false,
      query,
      error: `没有找到软件: ${query}`,
      searched: ['PATH', 'Windows 注册表卸载项', '开始菜单快捷方式', '常见安装目录']
    }
  }

  return { success: true, found: true, query, executable: candidates[0].path, selected: candidates[0], candidates: candidates.slice(0, 20) }
}

function openSoftware(input = {}, options = {}) {
  const found = findSoftware(input)
  if (!found.success) return found
  const executable = found.executable
  const args = Array.isArray(input.args) ? input.args.map(String) : []
  const cwd = input.cwd && dirExists(input.cwd) ? input.cwd : path.dirname(executable)
  const ext = path.extname(executable).toLowerCase()

  if (ext === '.lnk') {
    const child = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', 'Start-Process -FilePath $args[0]', executable], {
      cwd,
      windowsHide: false,
      detached: true,
      stdio: 'ignore'
    })
    child.unref?.()
    return { ...found, success: true, opened: true, pid: child.pid, method: 'Start-Process', executable }
  }

  const child = spawn(executable, args, {
    cwd,
    windowsHide: options.visible === false,
    detached: true,
    stdio: 'ignore'
  })
  child.unref?.()
  return { ...found, success: true, opened: true, pid: child.pid, method: 'spawn', executable, args }
}

/**
 * 扫描已安装的所有应用（开始菜单 + 注册表 + 桌面快捷方式）
 * 返回分类列表
 */
function resolveShortcutDetails(shortcutPaths = []) {
  const details = new Map()
  const uniquePaths = [...new Set(shortcutPaths.map(item => path.resolve(item)).filter(fileExists))]
  for (let i = 0; i < uniquePaths.length; i += 40) {
    const chunkDetails = resolveShortcutDetailsChunk(uniquePaths.slice(i, i + 40))
    for (const [key, value] of chunkDetails) details.set(key, value)
  }
  return details
}

function resolveShortcutDetailsChunk(shortcutPaths = []) {
  const uniquePaths = [...new Set(shortcutPaths.map(item => path.resolve(item)).filter(fileExists))]
  const details = new Map()
  if (!uniquePaths.length) return details

  const tmpDir = path.join(os.tmpdir(), 'lingxi-shortcuts-' + Date.now())
  try { fs.mkdirSync(tmpDir, { recursive: true }) } catch (e) { return details }

  try {
    const inputFile = path.join(tmpDir, 'shortcuts.json')
    const scriptFile = path.join(tmpDir, 'resolve-shortcuts.ps1')
    const shortcutPayload = JSON.stringify(uniquePaths.map(item => ({ path: item })))
      .replace(/[^\x00-\x7F]/g, char => '\\u' + char.charCodeAt(0).toString(16).padStart(4, '0'))
    fs.writeFileSync(inputFile, shortcutPayload, 'utf8')
    fs.writeFileSync(scriptFile, `
$ErrorActionPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8
$inputFile = $args[0]
$items = Get-Content -Raw -Encoding UTF8 -LiteralPath $inputFile | ConvertFrom-Json
$shell = New-Object -ComObject WScript.Shell
$result = foreach ($item in $items) {
  $filePath = [string]$item.path
  try {
    $shortcut = $shell.CreateShortcut($filePath)
    [pscustomobject]@{
      filePath = $filePath
      targetPath = $shortcut.TargetPath
      arguments = $shortcut.Arguments
      iconLocation = $shortcut.IconLocation
      workingDirectory = $shortcut.WorkingDirectory
    }
  } catch {}
}
[System.Runtime.Interopservices.Marshal]::ReleaseComObject($shell) | Out-Null
$result | ConvertTo-Json -Compress -Depth 4
`.trim(), 'utf8')

    const output = execFileSync('powershell.exe', [
      '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptFile, inputFile
    ], { encoding: 'utf8', windowsHide: true, timeout: 30000 }).trim()

    if (!output) return details
    const parsed = JSON.parse(output)
    const rows = Array.isArray(parsed) ? parsed : [parsed]
    for (const row of rows) {
      if (!row?.filePath) continue
      details.set(path.resolve(row.filePath).toLowerCase(), {
        targetPath: cleanExecutablePath(row.targetPath || ''),
        arguments: String(row.arguments || '').trim(),
        iconLocation: cleanIconLocation(row.iconLocation || ''),
        workingDirectory: cleanExecutablePath(row.workingDirectory || '')
      })
    }
  } catch (e) {
    /* PowerShell 快捷方式解析整体失败 */
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }) } catch (e) { /* 清理临时目录，失败可忽略 */ }
  }

  return details
}

function normalizeAppNameForDedupe(name = '') {
  return normalizeText(name)
    .replace(/\s+\d+(?:\.\d+){1,}\s*$/g, '')
    .replace(/\s*[\(\[]\s*(?:x64|x86|64-bit|32-bit)\s*[\)\]]\s*$/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function normalizeLaunchArgs(args = '') {
  return String(args || '').trim().replace(/\s+/g, ' ').toLowerCase()
}

function isNoiseAppEntry(name = '') {
  return /(?:uninstall|uninstaller|remove|repair|readme|manual|license|help|support|website|homepage|update|卸载|修复|帮助|说明|手册|许可|官网|主页|更新)/i.test(String(name || ''))
}

function isSystemComponentEntry(app = {}) {
  const name = String(app.name || '')
  const normalizedName = normalizeText(name)
  const executablePath = String(app.executablePath || '')
  const normalizedPath = executablePath.toLowerCase()

  if (hasCorruptDisplayName(name)) return true
  if (/\\windows\\system32\\|\\windows\\syswow64\\|\\windows\\explorer\.exe$/i.test(executablePath)) return true
  if (/^(?:windows|microsoft)\s+(?:powershell|software development kit|app cert kit|edge webview2 runtime)/i.test(name)) return true
  if (/^immersive control panel$/i.test(name)) return true
  if (/microsoft visual c\+\+.*redistributable/i.test(name)) return true
  if (/\b(?:redistributable|runtime|webview|sdk|driver package|development kit|cert kit)\b/i.test(name)) return true
  if (/\b(?:monitor|profiler)\b/i.test(name) && /\b(?:nsight|nvidia|visual)\b/i.test(name)) return true
  if (/\bnsight\b/i.test(name)) return true
  if (/^(?:psftp|putty|puttygen)$/i.test(name)) return true
  if (/^git\s+(?:bash|cmd|gui)$/i.test(name)) return true
  if (/tesseract.*oc?r/i.test(name)) return true
  if (/(?:spreadsheet|database)\s+compare/i.test(name)) return true
  if (/office.*(?:language|语言)/i.test(name)) return true
  if (/^ollama(?:\s+app\.exe|\s+version\b)?$/i.test(name)) return true
  if (/^microsoft office\b/i.test(name)) return true
  if (/visual studio installer/i.test(name)) return true
  if (/\\programdata\\package cache\\/i.test(normalizedPath)) return true
  if (/\\windows kits\\/i.test(normalizedPath)) return true
  if (/\\unins\d*\.exe$/i.test(normalizedPath)) return true
  if (/\\microsoft shared\\clicktorun\\/i.test(normalizedPath)) return true
  if (/\\microsoft office\\root\\client\\appvlp\.exe$/i.test(normalizedPath) && /compare/i.test(name)) return true
  if (/\\git\\(?:cmd|bin|usr)\\/i.test(normalizedPath) && /^git\s+/i.test(name)) return true
  if (/\\putty\\/i.test(normalizedPath)) return true
  if (/\\tesseract/i.test(normalizedPath)) return true

  const nativeUtilityNames = new Set([
    'notepad',
    'paint',
    'quick assist',
    'remote desktop connection',
    'resource monitor',
    'snipping tool',
    'math input panel',
    'windows media player',
    'office language preferences',
    'spreadsheet compare',
    'database compare'
  ])
  if (nativeUtilityNames.has(normalizedName)) return true

  return false
}

function getSourcePriority(source = '') {
  if (source === 'custom') return 60
  if (source === 'start-menu') return 40
  if (source === 'desktop') return 30
  if (source === 'registry') return 10
  return 0
}

function getAppEntryScore(app = {}) {
  let score = getSourcePriority(app.source)
  if (app.custom) score += 30
  if (path.extname(app.path || '').toLowerCase() === '.lnk') score += 15
  if (app.executablePath && fileExists(app.executablePath)) score += 10
  if (app.iconSourcePath && fileExists(app.iconSourcePath)) score += 5
  if (isNoiseAppEntry(app.name)) score -= 100
  return score
}

function chooseBetterAppEntry(current, next) {
  if (!current) return next
  const currentScore = getAppEntryScore(current)
  const nextScore = getAppEntryScore(next)
  if (nextScore !== currentScore) return nextScore > currentScore ? next : current
  const currentNameLength = String(current.name || '').length
  const nextNameLength = String(next.name || '').length
  return nextNameLength < currentNameLength ? next : current
}

function normalizeInstalledApps(apps = [], options = {}) {
  const includeSystemComponents = options.includeSystemComponents === true
  const shortcutDetails = resolveShortcutDetails(
    apps
      .map(item => item.path || '')
      .filter(item => path.extname(item).toLowerCase() === '.lnk')
  )

  const normalized = []
  for (const app of apps) {
    if (!app?.name || !app.path) continue
    if (!app.custom && isNoiseAppEntry(app.name)) continue

    const item = { ...app }
    const ext = path.extname(item.path).toLowerCase()
    let executablePath = ''
    let launchArgs = ''
    let iconSourcePath = ''

    if (ext === '.lnk') {
      item.shortcutPath = path.resolve(item.path)
      const shortcut = shortcutDetails.get(path.resolve(item.path).toLowerCase())
      executablePath = cleanExecutablePath(shortcut?.targetPath || '')
      launchArgs = normalizeLaunchArgs(shortcut?.arguments || '')
      iconSourcePath = shortcut?.iconLocation && fileExists(shortcut.iconLocation)
        ? shortcut.iconLocation
        : executablePath

      if (!executablePath || !fileExists(executablePath) || !isExecutablePath(executablePath)) continue
    } else {
      executablePath = cleanExecutablePath(item.path)
      if (!executablePath || !fileExists(executablePath) || !isExecutablePath(executablePath)) continue
      item.path = path.resolve(executablePath)
      iconSourcePath = executablePath
    }

    item.executablePath = path.resolve(executablePath)
    item.path = item.executablePath
    item.launchArgs = launchArgs
    item.iconSourcePath = fileExists(iconSourcePath) ? path.resolve(iconSourcePath) : item.executablePath
    if (!includeSystemComponents && isSystemComponentEntry(item)) continue
    item._identityKey = `${item.executablePath.toLowerCase()}|${launchArgs}`
    item._nameKey = normalizeAppNameForDedupe(item.name)
    normalized.push(item)
  }

  const byIdentity = new Map()
  for (const item of normalized) {
    byIdentity.set(item._identityKey, chooseBetterAppEntry(byIdentity.get(item._identityKey), item))
  }

  const byName = new Map()
  for (const item of byIdentity.values()) {
    byName.set(item._nameKey, chooseBetterAppEntry(byName.get(item._nameKey), item))
  }

  return [...byName.values()]
    .map(item => {
      const { _identityKey, _nameKey, ...cleaned } = item
      return cleaned
    })
    .sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')))
}

function scanInstalledAppsLegacy() {
  const apps = []
  const seen = new Set()

  function addApp(entry) {
    const key = (entry.path || entry.name || '').toLowerCase()
    if (!key || seen.has(key)) return
    seen.add(key)
    apps.push(entry)
  }

  // 1. 扫描开始菜单快捷方式
  for (const root of getStartMenuRoots()) {
    if (!dirExists(root)) continue
    walkShortcuts(root, 0, 6, (filePath, label) => {
      addApp({
        name: label,
        path: filePath,
        source: 'start-menu',
        category: categorizeApp(label, filePath)
      })
    })
  }

  // 2. 扫描桌面快捷方式
  const desktopPaths = [
    process.env.USERPROFILE && path.join(process.env.USERPROFILE, 'Desktop'),
    process.env.PUBLIC && path.join(process.env.PUBLIC, 'Desktop')
  ].filter(Boolean)
  for (const dp of desktopPaths) {
    if (!dirExists(dp)) continue
    walkShortcuts(dp, 0, 1, (filePath, label) => {
      addApp({
        name: label,
        path: filePath,
        source: 'desktop',
        category: categorizeApp(label, filePath)
      })
    })
  }

  // 3. 从注册表获取已安装应用
  try {
    const script = [
      "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8",
      "$OutputEncoding = [System.Text.Encoding]::UTF8",
      "$items = Get-ItemProperty 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*','HKLM:\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*','HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*' -ErrorAction SilentlyContinue",
      "$items | Where-Object { $_.DisplayName } | Select-Object DisplayName,InstallLocation,DisplayIcon,Publisher | ConvertTo-Json -Depth 3"
    ].join('; ')
    const output = execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 8000
    }).trim()
    if (output) {
      const parsed = JSON.parse(output)
      const rows = Array.isArray(parsed) ? parsed : [parsed]
      for (const row of rows) {
        const name = row.DisplayName
        if (!name) continue
        const exePath = cleanExecutablePath(row.DisplayIcon || row.InstallLocation)
        addApp({
          name,
          path: exePath || '',
          source: 'registry',
          publisher: row.Publisher || '',
          category: categorizeApp(name, exePath)
        })
      }
    }
  } catch (e) { /* 注册表扫描已安装应用列表失败 */ }

  return { success: true, apps: normalizeInstalledApps(apps) }
}

/**
 * 遍历目录查找快捷方式文件
 */
function walkShortcuts(dir, depth, maxDepth, callback) {
  if (depth > maxDepth) return
  let items = []
  try {
    items = fs.readdirSync(dir, { withFileTypes: true })
  } catch (e) {
    return
  }
  for (const item of items) {
    const fullPath = path.join(dir, item.name)
    if (item.isDirectory()) {
      walkShortcuts(fullPath, depth + 1, maxDepth, callback)
    } else if (item.isFile() && item.name.endsWith('.lnk')) {
      const label = item.name.replace(/\.lnk$/i, '')
      callback(fullPath, label)
    }
  }
}

/**
 * 简单分类应用
 */
function categorizeApp(name, filePath = '') {
  const n = (name + ' ' + filePath).toLowerCase()
  const systemKeywords = ['notepad', 'calc', 'mspaint', 'cmd', 'powershell', 'explorer', 'recycle',
    'control', 'task manager', 'device manager', 'disk', 'defrag', 'regedit', 'services',
    '记事本', '计算器', '画图', '回收站', '资源管理器', '任务管理器', '设备管理器']
  const officeKeywords = ['word', 'excel', 'powerpoint', 'outlook', 'onenote', 'office',
    'wps', 'foxit', 'adobe reader', 'pdf', 'notion', '飞书', 'feishu', 'dingtalk', '钉钉',
    'wechat', '微信', 'telegram', 'slack', 'teams', 'zoom', '文档', '学习']
  const mediaKeywords = ['chrome', 'firefox', 'edge', 'opera', 'brave', 'vlc', 'spotify',
    '网易云', 'bilibili', '抖音', 'douyin', 'youtube', 'obs', '剪映', 'capcut',
    'blender', 'unity', 'photoshop', 'illustrator', 'premiere', 'after effects',
    '影音', '娱乐', '游戏', 'game', 'epic', 'steam', 'wegame', 'league']
  const devKeywords = ['code', 'vscode', 'visual studio', 'jetbrains', 'intellij', 'pycharm',
    'webstorm', 'android studio', 'node', 'python', 'git', 'docker', 'postman',
    'ollama', 'cherry studio', 'anythingllm', 'cursor', 'qoder', 'codebuddy']

  if (devKeywords.some(k => n.includes(k))) return 'dev'
  if (officeKeywords.some(k => n.includes(k))) return 'office'
  if (mediaKeywords.some(k => n.includes(k))) return 'media'
  if (systemKeywords.some(k => n.includes(k))) return 'system'
  return 'other'
}

/**
 * 启动应用（通过快捷方式或可执行路径）
 */
function launchAppLegacy(input = {}) {
  const appPath = input.path || ''
  if (!appPath) return { success: false, error: '缺少应用路径' }

  const ext = path.extname(appPath).toLowerCase()
  try {
    if (ext === '.lnk') {
      const child = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', 'Start-Process -FilePath $args[0]', appPath], {
        windowsHide: false,
        detached: true,
        stdio: 'ignore'
      })
      child.unref?.()
      return { success: true, opened: true, pid: child.pid, path: appPath }
    }

    if (fileExists(appPath)) {
      const child = spawn(appPath, [], {
        cwd: path.dirname(appPath),
        windowsHide: false,
        detached: true,
        stdio: 'ignore'
      })
      child.unref?.()
      return { success: true, opened: true, pid: child.pid, path: appPath }
    }

    return { success: false, error: `应用路径不存在: ${appPath}` }
  } catch (e) {
    return { success: false, error: e.message }
  }
}

function splitLaunchArgs(value = '') {
  const text = String(value || '').trim()
  if (!text) return []
  const matches = text.match(/"[^"]*"|'[^']*'|\S+/g) || []
  return matches.map(item => item.replace(/^["']|["']$/g, ''))
}

function launchApp(input = {}) {
  const appPath = cleanExecutablePath(input.executablePath || input.path || '')
  if (!appPath) return { success: false, error: '缺少应用 EXE 路径' }

  const ext = path.extname(appPath).toLowerCase()
  if (ext === '.lnk') {
    return { success: false, error: '启动入口必须是真实 EXE，不能使用快捷方式' }
  }
  if (!fileExists(appPath) || !isExecutablePath(appPath)) {
    return { success: false, error: `应用 EXE 不存在或不可启动: ${appPath}` }
  }

  try {
    const args = Array.isArray(input.args)
      ? input.args.map(String)
      : splitLaunchArgs(input.launchArgs || '')
    const child = spawn(appPath, args, {
      cwd: path.dirname(appPath),
      windowsHide: false,
      detached: true,
      stdio: 'ignore'
    })
    child.unref?.()
    return { success: true, opened: true, pid: child.pid, path: appPath, args }
  } catch (e) {
    return { success: false, error: e.message }
  }
}

function scanInstalledApps() {
  const apps = []
  const seenRaw = new Set()

  function addApp(entry) {
    const key = `${entry.source || ''}|${entry.path || ''}|${entry.name || ''}`.toLowerCase()
    if (!entry.name || !entry.path || seenRaw.has(key)) return
    seenRaw.add(key)
    apps.push(entry)
  }

  for (const root of getStartMenuRoots()) {
    if (!dirExists(root)) continue
    walkShortcuts(root, 0, 6, (filePath, label) => {
      addApp({
        name: label,
        path: filePath,
        source: 'start-menu',
        category: categorizeApp(label, filePath)
      })
    })
  }

  const desktopPaths = [
    process.env.USERPROFILE && path.join(process.env.USERPROFILE, 'Desktop'),
    process.env.PUBLIC && path.join(process.env.PUBLIC, 'Desktop')
  ].filter(Boolean)

  for (const desktopPath of desktopPaths) {
    if (!dirExists(desktopPath)) continue
    walkShortcuts(desktopPath, 0, 1, (filePath, label) => {
      addApp({
        name: label,
        path: filePath,
        source: 'desktop',
        category: categorizeApp(label, filePath)
      })
    })
  }

  try {
    const script = [
      "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8",
      "$OutputEncoding = [System.Text.Encoding]::UTF8",
      "$items = Get-ItemProperty 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*','HKLM:\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*','HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*' -ErrorAction SilentlyContinue",
      "$items | Where-Object { $_.DisplayName } | Select-Object DisplayName,InstallLocation,DisplayIcon,Publisher | ConvertTo-Json -Depth 3"
    ].join('; ')
    const output = execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 8000
    }).trim()
    if (output) {
      const parsed = JSON.parse(output)
      const rows = Array.isArray(parsed) ? parsed : [parsed]
      for (const row of rows) {
        const name = row.DisplayName
        if (!name) continue
        const exePath = cleanExecutablePath(row.DisplayIcon || row.InstallLocation)
        addApp({
          name,
          path: exePath || '',
          source: 'registry',
          publisher: row.Publisher || '',
          category: categorizeApp(name, exePath)
        })
      }
    }
  } catch (e) { /* 注册表扫描安装位置失败 */ }

  return { success: true, apps: normalizeInstalledApps(apps) }
}

async function buildCustomAppFromPath(filePath) {
  const cleaned = cleanExecutablePath(filePath)
  if (!cleaned || !fileExists(cleaned) || !isExecutablePath(cleaned)) {
    return { success: false, error: '请选择可启动的应用文件' }
  }

  const name = path.basename(cleaned, path.extname(cleaned))
  const normalized = normalizeInstalledApps([{
    name,
    path: path.resolve(cleaned),
    source: 'custom',
    custom: true,
    category: categorizeApp(name, cleaned)
  }], { includeSystemComponents: true })

  const app = normalized[0]
  if (!app) return { success: false, error: '无法解析该应用启动入口' }
  app.custom = true
  app.source = 'custom'
  await extractAppIcons([app])
  return { success: true, app }
}

async function addCustomLocalApp(dialog) {
  if (!dialog?.showOpenDialog) {
    return { success: false, error: '文件选择功能不可用' }
  }

  const result = await dialog.showOpenDialog({
    title: '添加本地应用',
    buttonLabel: '添加',
    properties: ['openFile'],
    filters: [
      { name: '应用程序', extensions: ['exe', 'lnk', 'bat', 'cmd', 'com'] },
      { name: '所有文件', extensions: ['*'] }
    ]
  })

  if (result.canceled || !result.filePaths?.[0]) {
    return { success: false, canceled: true }
  }

  const built = await buildCustomAppFromPath(result.filePaths[0])
  if (!built.success) return built

  const customApps = mergeAppLists(readCustomApps(), [built.app])
  writeCustomApps(customApps)

  const cached = readLocalAppsCache()
  const apps = filterDisplayableApps(mergeAppLists(cached.apps, customApps))
  writeLocalAppsCache(apps, { scannedAt: cached.scannedAt || Date.now() })

  return { success: true, app: built.app, apps, cacheHit: true, scannedAt: cached.scannedAt || null }
}

async function removeCustomLocalApp(appPath) {
  if (!appPath) return { success: false, error: '缺少应用路径' }
  const customApps = readCustomApps()
  const lowerPath = cleanExecutablePath(appPath).toLowerCase()
  const isSameAppPath = (app = {}) => {
    const key = cleanExecutablePath(app.executablePath || app.path || '').toLowerCase()
    return key === lowerPath
  }
  const filtered = customApps.filter(app => {
    return !isSameAppPath(app)
  })
  if (filtered.length === customApps.length) {
    return { success: false, error: '未找到匹配的自定义应用' }
  }
  writeCustomApps(filtered)
  const cached = readJsonFile(getLocalAppsCachePath(), { apps: [], scannedAt: null })
  const cachedApps = Array.isArray(cached?.apps) ? cached.apps.filter(app => !isSameAppPath(app)) : []
  const apps = filterDisplayableApps(mergeAppLists(cachedApps, filtered))
  writeLocalAppsCache(apps, { scannedAt: cached.scannedAt || Date.now() })
  return { success: true, apps }
}

async function updateAppCategory(appPath, newCategory) {
  if (!appPath) return { success: false, error: '缺少应用路径' }
  if (!newCategory) return { success: false, error: '缺少分类' }
  const customApps = readCustomApps()
  const lowerPath = appPath.toLowerCase()
  let found = false
  customApps.forEach(app => {
    const key = (app.executablePath || app.path || '').toLowerCase()
    if (key === lowerPath) {
      app.category = newCategory
      found = true
    }
  })
  if (!found) return { success: false, error: '仅支持修改自定义应用的分类' }
  writeCustomApps(customApps)
  const cached = readLocalAppsCache()
  const apps = filterDisplayableApps(mergeAppLists(cached.apps, customApps))
  writeLocalAppsCache(apps, { scannedAt: cached.scannedAt || Date.now() })
  return { success: true, apps }
}

async function refreshInstalledAppsCache() {
  const result = scanInstalledApps()
  if (!result.success) return result

  const apps = filterDisplayableApps(mergeAppLists(result.apps, readCustomApps()))
  await extractAppIcons(apps)
  writeLocalAppsCache(apps, { scannedAt: Date.now() })
  return { success: true, apps: filterDisplayableApps(apps), cacheHit: false, scannedAt: Date.now() }
}

module.exports = {
  findSoftware,
  openSoftware,
  scanInstalledApps,
  launchApp,
  extractAppIcons,
  registerIPC(ipcMain, dialog) {
    ipcMain.handle('software:find', async (event, input = {}) => findSoftware(input))
    ipcMain.handle('software:open', async (event, input = {}) => openSoftware(input))
    ipcMain.handle('software:listInstalledApps', async () => readLocalAppsCache())
    ipcMain.handle('software:scanInstalledApps', async () => {
      return refreshInstalledAppsCache()
    })
    ipcMain.handle('software:addLocalApp', async () => addCustomLocalApp(dialog))
        ipcMain.handle('software:launchApp', async (event, input = {}) => launchApp(input))
    ipcMain.handle('software:removeLocalApp', async (event, input = {}) => removeCustomLocalApp(input.path))
    ipcMain.handle('software:updateAppCategory', async (event, input = {}) => updateAppCategory(input.path, input.category))
  }
}

/**
 * 批量提取应用图标（PowerShell 单次调用，写入临时 PNG 文件）
 * 直接修改 apps 数组，为每个 app 添加 icon 字段（data URL）
 */
async function extractAppIconsLegacy(apps) {
  if (!apps || !apps.length) return

  // 创建临时目录
  const tmpDir = path.join(os.tmpdir(), 'lingxi-app-icons-' + Date.now())
  try { fs.mkdirSync(tmpDir, { recursive: true }) } catch (e) { return }

  // 构建路径列表（只处理有效路径）
  const validApps = apps.filter(a => a.path && fileExists(a.path))
  if (!validApps.length) {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }) } catch (e) { /* 清理临时目录，失败可忽略 */ }
    return
  }

  // 生成 PowerShell 脚本：批量提取图标
  const pathList = validApps.map((a, i) => {
    const escaped = a.path.replace(/'/g, "''")
    return `'${escaped}'|${i}`
  }).join('\n')

  const psScript = `
$ErrorActionPreference = 'SilentlyContinue'
Add-Type -AssemblyName System.Drawing
$tmpDir = '${tmpDir.replace(/'/g, "''")}'
$paths = @'
${pathList}
'@
foreach ($line in $paths -split "\`n") {
  $line = $line.Trim()
  if (-not $line) { continue }
  $parts = $line -split '\|', 2
  $filePath = $parts[0]
  $idx = $parts[1]
  $target = $filePath
  if ($filePath -match '\.lnk$') {
    $shell = New-Object -ComObject WScript.Shell
    $shortcut = $shell.CreateShortcut($filePath)
    $target = $shortcut.TargetPath
    [System.Runtime.Interopservices.Marshal]::ReleaseComObject($shell) | Out-Null
  }
  if (-not $target -or -not (Test-Path $target)) { continue }
  try {
    $icon = [System.Drawing.Icon]::ExtractAssociatedIcon($target)
    if ($icon -and $icon.Width -gt 0) {
      $bmp = $icon.ToBitmap()
      $outPath = Join-Path $tmpDir "$idx.png"
      $bmp.Save($outPath, [System.Drawing.Imaging.ImageFormat]::Png)
      $bmp.Dispose()
      $icon.Dispose()
    }
  } catch {}
}
`.trim()

  try {
    // 写入脚本文件避免命令行长度限制
    const scriptFile = path.join(tmpDir, '_extract.ps1')
    fs.writeFileSync(scriptFile, psScript, 'utf8')

    execFileSync('powershell.exe', [
      '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptFile
    ], { encoding: 'utf8', windowsHide: true, timeout: 30000 })

    // 读取生成的 PNG 文件，转为 data URL
    for (const app of validApps) {
      const idx = validApps.indexOf(app)
      const pngPath = path.join(tmpDir, `${idx}.png`)
      if (fileExists(pngPath)) {
        try {
          const buf = fs.readFileSync(pngPath)
          app.icon = 'data:image/png;base64,' + buf.toString('base64')
        } catch (e) { /* 读取图标 PNG 失败 */ }
      }
    }
  } catch (e) {
    // 提取失败不阻断，前端会用占位符显示
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }) } catch (e) { /* 清理临时目录，失败可忽略 */ }
  }
}
