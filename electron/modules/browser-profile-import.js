/**
 * 从本机任意 Chromium 内核浏览器导入登录 Cookie + LocalStorage 到右侧 webview partition
 *
 * 实现路径：
 * 1. 通过注册表扫描本机 Chromium 类浏览器（Chrome/Edge/QQ/夸克/360/Brave/Vivaldi 等）
 * 2. Cookie 主路径：SQLite 直读（快速，不启动无头浏览器）
 * 3. Cookie 兜底 + LocalStorage：复制用户数据 + 无头启动 + CDP
 *    - CDP Network.getAllCookies 读取已解密 cookie
 *    - 扫描 LocalStorage LevelDB 提取 origin 列表
 *    - CDP DOMStorage.getDOMStorageItems 读取每个 origin 的 LocalStorage
 * 4. 写入 Electron session.fromPartition(persist:lingxi-external-webview)
 *    - Cookie：ses.cookies.set
 *    - LocalStorage：隐藏 BrowserWindow 加载 origin + executeJavaScript 注入
 *
 * 为什么需要 LocalStorage：
 *   X/Twitter、Facebook 等现代 SPA 站点依赖 LocalStorage 的 device_id 等保持登录，
 *   仅导入 Cookie 会导致登录态丢失（被识别为新设备）。
 */

const { app, session, BrowserWindow } = require('electron')
const fs = require('fs')
const path = require('path')
const os = require('os')
const http = require('http')
const { spawn, execSync } = require('child_process')
const externalWebviewSession = require('./external-webview-session')

const TARGET_PARTITION = externalWebviewSession.EXTERNAL_WEBVIEW_PARTITION

const GOOGLE_HOST_RE = /(^|\.)google\.com$|(^|\.)googleapis\.com$|(^|\.)gstatic\.com$|(^|\.)youtube\.com$|(^|\.)googleusercontent\.com$/i

/**
 * 浏览器识别表
 * - keywords: 用于匹配可执行文件名/路径关键词
 * - displayName: 前端展示名
 * - exeNames: 可能的可执行文件名
 * - userDataCandidates: 返回相对路径数组，会与 LOCALAPPDATA / APPDATA / exePath 推断组合
 */
const BROWSER_SIGNATURES = [
  {
    id: 'chrome',
    keywords: ['chrome'],
    displayName: 'Google Chrome',
    exeNames: ['chrome.exe'],
    userDataCandidates: [
      ['Google', 'Chrome', 'User Data']
    ]
  },
  {
    id: 'edge',
    keywords: ['msedge'],
    displayName: 'Microsoft Edge',
    exeNames: ['msedge.exe'],
    userDataCandidates: [
      ['Microsoft', 'Edge', 'User Data']
    ]
  },
  {
    id: 'qqbrowser',
    keywords: ['qqbrowser'],
    displayName: 'QQ浏览器',
    exeNames: ['QQBrowser.exe'],
    userDataCandidates: [
      ['Tencent', 'QQBrowser', 'User Data'],
      ['Tencent', 'QQBrowser', 'User Data']
    ],
    useRoaming: true // QQ 浏览器数据常在 Roaming
  },
  {
    id: 'quark',
    keywords: ['quark'],
    displayName: '夸克浏览器',
    exeNames: ['quark.exe', 'Quark.exe'],
    userDataCandidates: [
      ['Quark', 'User Data'],
      ['Quark', 'quark', 'User Data']
    ]
  },
  {
    id: '360chrome',
    keywords: ['360chrome', '360chrome.exe'],
    displayName: '360极速浏览器',
    exeNames: ['360Chrome.exe', '360ChromeX.exe'],
    userDataCandidates: [
      ['360Chrome', 'Chrome', 'User Data'],
      ['360ChromeX', 'Chrome', 'User Data']
    ]
  },
  {
    id: 'brave',
    keywords: ['brave'],
    displayName: 'Brave',
    exeNames: ['brave.exe'],
    userDataCandidates: [
      ['BraveSoftware', 'Brave-Browser', 'User Data']
    ]
  },
  {
    id: 'vivaldi',
    keywords: ['vivaldi'],
    displayName: 'Vivaldi',
    exeNames: ['Vivaldi.exe'],
    userDataCandidates: [
      ['Vivaldi', 'User Data']
    ]
  },
  {
    id: 'yandex',
    keywords: ['yandex'],
    displayName: 'Yandex Browser',
    exeNames: ['browser.exe'],
    userDataCandidates: [
      ['Yandex', 'YandexBrowser', 'User Data']
    ]
  },
  {
    id: 'sogou',
    keywords: ['sogouexplorer', 'sogou'],
    displayName: '搜狗高速浏览器',
    exeNames: ['SogouExplorer.exe'],
    userDataCandidates: [
      ['SogouExplorer', 'User Data']
    ]
  },
  {
    id: 'liebao',
    keywords: ['liebao'],
    displayName: '猎豹浏览器',
    exeNames: ['liebao.exe'],
    userDataCandidates: [
      ['Liebao', 'User Data']
    ]
  },
  {
    id: 'ucbrowser',
    keywords: ['ucbrowser'],
    displayName: 'UC浏览器',
    exeNames: ['UCBrowser.exe'],
    userDataCandidates: [
      ['UCBrowser', 'User Data']
    ]
  },
  {
    id: '2345',
    keywords: ['2345explorer', '2345chrome'],
    displayName: '2345浏览器',
    exeNames: ['2345Explorer.exe', '2345Chrome.exe'],
    userDataCandidates: [
      ['2345Explorer', 'User Data'],
      ['2345Soft', '2345Explorer', 'User Data']
    ]
  },
  {
    id: 'maxthon',
    keywords: ['maxthon'],
    displayName: '傲游浏览器',
    exeNames: ['Maxthon.exe'],
    userDataCandidates: [
      ['Maxthon3', 'User Data']
    ]
  }
]

/**
 * 用 reg query 扫描注册表 App Paths，列出本机浏览器
 * 同时支持 HKLM/HKCU/WOW6432Node
 */
function scanRegistryAppPaths() {
  const hives = [
    'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths',
    'HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\App Paths',
    'HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths'
  ]
  const results = []
  for (const hive of hives) {
    let stdout
    try {
      // 一次性列出该 hive 下所有子键
      stdout = execSync(`reg query "${hive}"`, { windowsHide: true, encoding: 'utf8', timeout: 5000 })
    } catch (_) {
      continue
    }
    // reg query 输出形如：
    //   HKEY_CURRENT_USER\SOFTWARE\...\App Paths\quark.exe
    //       (默认)    REG_SZ    C:\Program Files\ExampleBrowser\browser.exe
    //       Path    REG_SZ    C:\Program Files\ExampleBrowser
    const lines = String(stdout || '').split(/\r?\n/)
    let currentKey = null
    let currentDefault = ''
    let currentPath = ''
    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed) continue
      // 子键标题行
      const keyMatch = trimmed.match(/App Paths\\([^\\]+)$/i)
      if (keyMatch) {
        if (currentKey) {
          results.push({ exeName: currentKey, default: currentDefault, path: currentPath, hive })
        }
        currentKey = keyMatch[1]
        currentDefault = ''
        currentPath = ''
        continue
      }
      const defMatch = trimmed.match(/^\(Default\)\s+REG_(?:SZ|EXPAND_SZ)\s+(.+)$/i)
      if (defMatch) currentDefault = defMatch[1].trim()
      const pathMatch = trimmed.match(/^Path\s+REG_(?:SZ|EXPAND_SZ)\s+(.+)$/i)
      if (pathMatch) currentPath = pathMatch[1].trim()
    }
    if (currentKey) {
      results.push({ exeName: currentKey, default: currentDefault, path: currentPath, hive })
    }
  }
  return results
}

/**
 * 从可执行文件名/路径匹配浏览器身份
 */
function identifyBrowser(exePath, exeName) {
  const hay = `${exePath || ''}\\${exeName || ''}`.toLowerCase()
  for (const sig of BROWSER_SIGNATURES) {
    if (sig.keywords.some(k => hay.includes(k.toLowerCase()))) return sig
  }
  return null
}

/**
 * 直接从 SQLite 读取 Cookie（绕过 CDP，避免丢失）
 * Chromium 的 Cookie 值用 AES-256-GCM 加密，密钥存在 Local State 的 os_crypt.encrypted_key 中
 * 该密钥用 Windows DPAPI 保护
 */
function readCookiesFromSQLite(profilePath) {
  const cookiesPath = path.join(profilePath, 'Network', 'Cookies')
  if (!fs.existsSync(cookiesPath)) {
    // 有些浏览器直接放在 profile 根目录
    const altPath = path.join(profilePath, 'Cookies')
    if (!fs.existsSync(altPath)) return []
    return readCookiesFromSQLiteFile(altPath, profilePath)
  }
  return readCookiesFromSQLiteFile(cookiesPath, profilePath)
}

function readCookiesFromSQLiteFile(cookiesDbPath, profilePath) {
  try {
    const localStatePath = path.join(path.dirname(profilePath), 'Local State')
    const scriptPath = path.join(__dirname, '..', '..', 'installer', 'read_cookies.py')
    if (!fs.existsSync(scriptPath)) {
      console.warn('[BrowserProfileImport] read_cookies.py not found at:', scriptPath)
      return []
    }
    const result = execSync(`python "${scriptPath}" "${cookiesDbPath}" "${localStatePath}"`, {
      windowsHide: true,
      timeout: 15000,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe']
    }).trim()

    const parsed = JSON.parse(result)
    if (parsed.error) {
      console.warn('[BrowserProfileImport] SQLite read error:', parsed.error)
      return []
    }
    return parsed
  } catch (e) {
    console.warn('[BrowserProfileImport] SQLite fallback failed:', e.message)
    return []
  }
}
/**
 * 解析 App Paths 注册表项中的可执行文件完整路径
 */
function resolveExePath(entry) {
  // 1. default 字段可能是完整路径（可能带引号）
  if (entry.default) {
    const cleaned = entry.default.replace(/^["']|["']$/g, '')
    if (fs.existsSync(cleaned)) return cleaned
  }
  // 2. path 字段是父目录，拼接 exeName，并探测常见子目录
  if (entry.path && entry.exeName) {
    const candidates = [
      path.join(entry.path, entry.exeName),
      path.join(entry.path, 'Bin', entry.exeName),
      path.join(entry.path, 'Application', entry.exeName),
      path.join(entry.path, 'bin', entry.exeName),
      path.join(entry.path, 'app', entry.exeName)
    ]
    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) return candidate
    }
  }
  return null
}

/**
 * 为已知浏览器 sig 推断 User Data 目录
 * 候选顺序：
 *   - LOCALAPPDATA 下的标准路径
 *   - APPDATA 下的标准路径（useRoaming=true 时）
 *   - 从 exePath 推断：...\Application\xxx.exe → ...\User Data
 */
function findUserDataRoot(sig, exePath) {
  const localAppData = process.env.LOCALAPPDATA || ''
  const roamingAppData = process.env.APPDATA || ''
  const candidates = []

  for (const sub of sig.userDataCandidates) {
    candidates.push(path.join(localAppData, ...sub))
    if (sig.useRoaming) candidates.push(path.join(roamingAppData, ...sub))
  }

  // 从 exePath 反推
  if (exePath) {
    const exeDir = path.dirname(exePath)
    const parentDir = path.dirname(exeDir)
    // ...\Application\xxx.exe → ...\User Data
    if (path.basename(exeDir).toLowerCase() === 'application') {
      candidates.push(path.join(parentDir, 'User Data'))
    }
    // ...\Bin\xxx.exe → ...\User Data
    if (path.basename(exeDir).toLowerCase() === 'bin') {
      candidates.push(path.join(parentDir, 'User Data'))
    }
    // 同级 User Data
    candidates.push(path.join(exeDir, 'User Data'))
    candidates.push(path.join(parentDir, 'User Data'))
  }

  // 验证：必须有 Local State 文件
  for (const candidate of candidates) {
    try {
      if (fs.existsSync(path.join(candidate, 'Local State'))) return candidate
    } catch (_) { /* ignore */ }
  }
  return null
}

/**
 * 列出某个 User Data 目录下所有可用 Profile（含 Default/Profile N）
 */
function listProfiles(userDataRoot) {
  if (!userDataRoot || !fs.existsSync(userDataRoot)) return []
  const profiles = []
  const entries = fs.readdirSync(userDataRoot, { withFileTypes: true })
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const name = entry.name
    if (name !== 'Default' && !/^Profile \d+$/i.test(name)) continue
    const profilePath = path.join(userDataRoot, name)
    const hasCookies =
      fs.existsSync(path.join(profilePath, 'Network', 'Cookies')) ||
      fs.existsSync(path.join(profilePath, 'Cookies'))
    if (!hasCookies) continue
    profiles.push({
      profileName: name,
      profilePath,
      label: name === 'Default' ? '默认配置' : name
    })
  }
  return profiles
}

/**
 * 全局扫描：列出本机所有可用的 Chromium 类浏览器 + 各自的 Profile
 * 返回结构：
 *   [
 *     {
 *       browserId: 'chrome',
 *       displayName: 'Google Chrome',
 *       exePath: 'C:\\...\\chrome.exe',
 *       userDataRoot: 'C:\\...\\User Data',
 *       profiles: [{ profileName, profilePath, label }, ...]
 *     }, ...
 *   ]
 */
function listAllBrowsers() {
  const registryEntries = scanRegistryAppPaths()
  const seen = new Set() // 去重键：exePath 小写
  const browsers = []

  for (const entry of registryEntries) {
    const exePath = resolveExePath(entry)
    if (!exePath) continue
    const key = exePath.toLowerCase()
    if (seen.has(key)) continue

    const sig = identifyBrowser(exePath, entry.exeName)
    if (!sig) continue

    const userDataRoot = findUserDataRoot(sig, exePath)
    if (!userDataRoot) continue

    const profiles = listProfiles(userDataRoot)
    if (!profiles.length) continue

    seen.add(key)
    browsers.push({
      browserId: sig.id,
      displayName: sig.displayName,
      exePath,
      userDataRoot,
      profiles
    })
  }

  // 兜底：用固定路径扫描未在注册表 App Paths 中注册的浏览器（如 QQ浏览器、夸克）
  const knownIds = new Set(browsers.map(b => b.browserId))
  {
    const localAppData = process.env.LOCALAPPDATA || ''
    const roamingAppData = process.env.APPDATA || ''
    const programFiles = process.env.PROGRAMFILES || ''
    const programFilesX86 = process.env['PROGRAMFILES(X86)'] || ''
    const drives = ['C:', 'D:', 'E:']
    for (const sig of BROWSER_SIGNATURES) {
      if (knownIds.has(sig.id)) continue
      for (const sub of sig.userDataCandidates) {
        const candidates = [path.join(localAppData, ...sub)]
        if (sig.useRoaming) candidates.push(path.join(roamingAppData, ...sub))
        for (const userDataRoot of candidates) {
          if (!fs.existsSync(path.join(userDataRoot, 'Local State'))) continue
          const profiles = listProfiles(userDataRoot)
          if (!profiles.length) continue
          // 找一个可执行文件
          let exePath = null
          for (const exeName of sig.exeNames) {
            const tryPaths = [
              path.join(path.dirname(userDataRoot), 'Application', exeName),
              path.join(path.dirname(path.dirname(userDataRoot)), 'Application', exeName),
              path.join(path.dirname(userDataRoot), 'Bin', exeName),
              path.join(path.dirname(userDataRoot), 'bin', exeName),
              path.join(path.dirname(userDataRoot), 'app', exeName),
              path.join(path.dirname(userDataRoot), exeName),
              // Program Files 常见安装路径
              path.join(programFiles, ...sub.slice(0, -1), 'Application', exeName),
              path.join(programFiles, ...sub.slice(0, -1), 'Bin', exeName),
              path.join(programFiles, ...sub.slice(0, -1), exeName),
              path.join(programFilesX86, ...sub.slice(0, -1), 'Application', exeName),
              path.join(programFilesX86, ...sub.slice(0, -1), 'Bin', exeName),
              path.join(programFilesX86, ...sub.slice(0, -1), exeName)
            ]
            for (const p of tryPaths) {
              if (fs.existsSync(p)) { exePath = p; break }
            }
            if (exePath) break
            // 版本化子目录扫描（如 QQ浏览器: Program Files\Tencent\QQBrowser\{ver}\QQBrowser.exe）
            const baseDirs = [
              path.join(programFiles, ...sub.slice(0, -1)),
              path.join(programFilesX86, ...sub.slice(0, -1)),
              path.join(path.dirname(userDataRoot))
            ]
            for (const baseDir of baseDirs) {
              try {
                if (!fs.existsSync(baseDir) || !fs.statSync(baseDir).isDirectory()) continue
                const entries = fs.readdirSync(baseDir, { withFileTypes: true })
                  .filter(e => e.isDirectory())
                  .map(e => e.name)
                  .sort().reverse() // 最新版本优先
                for (const ver of entries) {
                  const p = path.join(baseDir, ver, exeName)
                  if (fs.existsSync(p)) { exePath = p; break }
                }
              } catch (_) { /* ignore */ }
              if (exePath) break
            }
            if (exePath) break
          }
          // 找不到可执行文件则跳过，不塞入空 exe 的浏览器
          if (!exePath) {
            // 扩展搜索：其他盘符和常见非标准安装路径
            for (const exeName of sig.exeNames) {
              for (const drive of drives) {
                if (drive.toLowerCase() === 'c') continue // C盘已搜过
                const extraPaths = [
                  path.join(drive, sig.displayName, exeName),
                  path.join(drive, sig.displayName.replace(/\s+/g, ''), exeName),
                  path.join(drive, ...sub.slice(0, -1), exeName),
                  path.join(drive, ...sub.slice(0, -1), 'Application', exeName)
                ]
                for (const p of extraPaths) {
                  if (fs.existsSync(p)) { exePath = p; break }
                }
                if (exePath) break
              }
              if (exePath) break
            }
          }
          // 最后手段：从 User Data 目录反向搜索 exe
          if (!exePath) {
            for (const exeName of sig.exeNames) {
              const parentDir = path.dirname(userDataRoot)
              try {
                if (fs.existsSync(path.join(parentDir, exeName))) {
                  exePath = path.join(parentDir, exeName)
                }
              } catch (_) {}
              if (exePath) break
            }
          }
          // 扫描各盘根目录下匹配关键词的子目录
          if (!exePath) {
            for (const exeName of sig.exeNames) {
              for (const drive of drives) {
                try {
                  const entries = fs.readdirSync(drive + '\\', { withFileTypes: true })
                    .filter(e => e.isDirectory())
                  for (const entry of entries) {
                    const dirPath = path.join(drive + '\\', entry.name)
                    const p = path.join(dirPath, exeName)
                    if (fs.existsSync(p)) { exePath = p; break }
                    // 检查一层子目录（如 夸克网盘\Quark\quark.exe）
                    try {
                      const subEntries = fs.readdirSync(dirPath, { withFileTypes: true })
                        .filter(e => e.isDirectory())
                      for (const subEntry of subEntries) {
                        const sp = path.join(dirPath, subEntry.name, exeName)
                        if (fs.existsSync(sp)) { exePath = sp; break }
                      }
                    } catch (_) {}
                    if (exePath) break
                  }
                } catch (_) {}
                if (exePath) break
              }
              if (exePath) break
            }
          }
          if (!exePath) continue
          browsers.push({
            browserId: sig.id,
            displayName: sig.displayName,
            exePath,
            userDataRoot,
            profiles
          })
          break
        }
      }
    }
  }

  return browsers
}

function copyDirLimited(src, dest, options = {}) {
  const maxFiles = options.maxFiles || 8000
  let count = 0
  const skipNames = new Set([
    'SingletonLock', 'SingletonCookie', 'SingletonSocket',
    'lockfile', 'RunningChromeVersion', 'DevToolsActivePort',
    'BrowserMetrics', 'Crashpad', 'GrShaderCache', 'ShaderCache',
    'GraphiteDawnCache', 'component_crx_cache', 'extensions_crx_cache'
  ])

  function walk(from, to) {
    if (count >= maxFiles) return
    fs.mkdirSync(to, { recursive: true })
    let entries
    try { entries = fs.readdirSync(from, { withFileTypes: true }) } catch { return }
    for (const entry of entries) {
      if (count >= maxFiles) return
      if (skipNames.has(entry.name)) continue
      if (/^(Cache|Code Cache|GPUCache|Service Worker|blob_storage)$/i.test(entry.name)) continue
      const fromPath = path.join(from, entry.name)
      const toPath = path.join(to, entry.name)
      try {
        if (entry.isDirectory()) {
          walk(fromPath, toPath)
        } else if (entry.isFile()) {
          fs.copyFileSync(fromPath, toPath)
          count += 1
        }
      } catch (_) { /* 文件被锁则跳过 */ }
    }
  }

  walk(src, dest)
  return count
}

function httpGetJson(url, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, (res) => {
      let raw = ''
      res.setEncoding('utf8')
      res.on('data', (chunk) => { raw += chunk })
      res.on('end', () => {
        try { resolve(JSON.parse(raw)) } catch (error) {
          reject(new Error(`invalid json from ${url}: ${error.message}`))
        }
      })
    })
    req.on('error', reject)
    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error(`timeout ${url}`))
    })
  })
}

function cdpCall(wsUrl, method, params = {}, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    let WebSocket
    try {
      WebSocket = require('ws')
    } catch (error) {
      reject(new Error('ws module unavailable: ' + error.message))
      return
    }

    const socket = new WebSocket(wsUrl)
    const id = 1
    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      try { socket.close() } catch (_) {}
      reject(new Error(`CDP timeout: ${method}`))
    }, timeoutMs)

    socket.on('open', () => {
      socket.send(JSON.stringify({ id, method, params }))
    })
    socket.on('message', (data) => {
      try {
        const msg = JSON.parse(String(data))
        if (msg.id !== id) return
        if (settled) return
        settled = true
        clearTimeout(timer)
        try { socket.close() } catch (_) {}
        if (msg.error) reject(new Error(msg.error.message || JSON.stringify(msg.error)))
        else resolve(msg.result)
      } catch (error) {
        if (!settled) {
          settled = true
          clearTimeout(timer)
          reject(error)
        }
      }
    })
    socket.on('error', (error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      reject(error)
    })
  })
}

function pickFreePort() {
  return 9200 + Math.floor(Math.random() * 500)
}

async function waitForDevtools(port, timeoutMs = 20000) {
  const start = Date.now()
  let lastError = null
  while (Date.now() - start < timeoutMs) {
    try {
      const version = await httpGetJson(`http://127.0.0.1:${port}/json/version`, 2000)
      if (version?.webSocketDebuggerUrl) return version
      const list = await httpGetJson(`http://127.0.0.1:${port}/json/list`, 2000)
      if (Array.isArray(list) && list[0]?.webSocketDebuggerUrl) {
        return { webSocketDebuggerUrl: list[0].webSocketDebuggerUrl }
      }
    } catch (error) {
      lastError = error
    }
    await new Promise((r) => setTimeout(r, 300))
  }
  throw new Error(`浏览器 DevTools 未就绪: ${lastError?.message || 'timeout'}`)
}

function cookieMatchesGoogle(cookie) {
  const domain = String(cookie.domain || '').replace(/^\./, '')
  return GOOGLE_HOST_RE.test(domain) || /google|gstatic|youtube/i.test(domain)
}

/**
 * 扫描 Local Storage LevelDB 目录，提取所有出现过的 origin
 * Chromium 的 LocalStorage 存储在 leveldb 中，key 格式：
 *   新版: v2.<timestamp>.<scheme>://<host>\x00<key>
 *   旧版: <scheme>://<host>\x00<key>
 * 直接字节扫描 .log / .ldb 文件，正则提取 origin
 */
function scanLocalStorageOrigins(profilePath) {
  const candidates = [
    path.join(profilePath, 'Local Storage', 'leveldb'),
    path.join(profilePath, 'Local Storage')
  ]
  let leveldbDir = null
  for (const c of candidates) {
    try {
      if (fs.existsSync(c) && fs.statSync(c).isDirectory()) {
        leveldbDir = c
        break
      }
    } catch (_) { /* ignore */ }
  }
  if (!leveldbDir) return []

  const files = []
  try {
    for (const entry of fs.readdirSync(leveldbDir, { withFileTypes: true })) {
      if (!entry.isFile()) continue
      const lower = entry.name.toLowerCase()
      if (lower.endsWith('.log') || lower.endsWith('.ldb') || lower.endsWith('.sst')) {
        files.push(path.join(leveldbDir, entry.name))
      }
    }
  } catch (_) { /* ignore */ }

  const originSet = new Set()
  const originRe = /(https?:\/\/[\w.-]+(?::\d+)?)(?=\x00|\\u0000)/g
  const originReFallback = /(https?:\/\/[\w.-]+(?::\d+)?)/g

  for (const file of files) {
    try {
      const buf = fs.readFileSync(file)
      const text = buf.toString('latin1')
      let m
      originRe.lastIndex = 0
      while ((m = originRe.exec(text)) !== null) {
        const origin = m[1]
        // 过滤明显无效的
        if (origin.length < 8 || origin.length > 200) continue
        originSet.add(origin)
      }
      // 兜底：如果没有 \x00 分隔的，用纯 origin 正则
      if (originSet.size === 0) {
        originReFallback.lastIndex = 0
        while ((m = originReFallback.exec(text)) !== null) {
          const origin = m[1]
          if (origin.length < 8 || origin.length > 200) continue
          originSet.add(origin)
        }
      }
    } catch (_) { /* ignore */ }
  }

  // 过滤明显非站点 origin（如 chrome-extension://）
  return Array.from(originSet).filter(o => /^https?:\/\//.test(o) && !/chrome-extension|devtools/i.test(o))
}

/**
 * 通过 CDP DOMStorage 域读取指定 origin 的 LocalStorage
 * 不需要让浏览器导航到该 origin，直接操作底层存储
 *
 * 注意：必须使用持久 WebSocket 连接，因为 DOMStorage.enable 的状态只在当前连接有效，
 * cdpCall 每次创建新连接会导致 enable 状态丢失
 */
async function readLocalStorageViaCDP(wsUrl, origins, timeoutMs = 30000) {
  if (!origins.length) return []
  let WebSocket
  try {
    WebSocket = require('ws')
  } catch (error) {
    console.warn('[BrowserProfileImport] ws module unavailable, skip LocalStorage')
    return []
  }

  const results = []
  const startTime = Date.now()
  let socket = null
  let msgId = 0
  const pending = new Map() // id -> { resolve, reject }

  try {
    socket = new WebSocket(wsUrl)
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('ws connect timeout')), 5000)
      socket.once('open', () => { clearTimeout(timer); resolve() })
      socket.once('error', (err) => { clearTimeout(timer); reject(err) })
    })

    socket.on('message', (data) => {
      try {
        const msg = JSON.parse(String(data))
        if (msg.id && pending.has(msg.id)) {
          const { resolve, reject } = pending.get(msg.id)
          pending.delete(msg.id)
          if (msg.error) reject(new Error(msg.error.message || JSON.stringify(msg.error)))
          else resolve(msg.result)
        }
      } catch (_) { /* ignore */ }
    })

    const callOnSocket = (method, params = {}, timeoutMs = 5000) => new Promise((resolve, reject) => {
      const id = ++msgId
      const timer = setTimeout(() => {
        pending.delete(id)
        reject(new Error(`timeout: ${method}`))
      }, timeoutMs)
      pending.set(id, {
        resolve: (result) => { clearTimeout(timer); resolve(result) },
        reject: (err) => { clearTimeout(timer); reject(err) }
      })
      try {
        socket.send(JSON.stringify({ id, method, params }))
      } catch (e) {
        pending.delete(id)
        clearTimeout(timer)
        reject(e)
      }
    })

    // 启用 DOMStorage（在当前持久连接上）
    await callOnSocket('DOMStorage.enable', {}).catch(() => ({}))

    for (const origin of origins) {
      if (Date.now() - startTime > timeoutMs) break
      try {
        const storageId = { securityOrigin: origin, isLocalStorage: true }
        const result = await callOnSocket('DOMStorage.getDOMStorageItems', { storageId }, 5000).catch(() => null)
        if (result && Array.isArray(result.entries) && result.entries.length > 0) {
          results.push({ origin, items: result.entries })
        }
      } catch (_) { /* 某个 origin 读取失败不影响其他 */ }
    }
  } catch (e) {
    console.warn('[BrowserProfileImport] readLocalStorageViaCDP connection failed:', e.message)
  } finally {
    try { if (socket) socket.close() } catch (_) { /* ignore */ }
  }

  return results
}

/**
 * 通过 CDP 读取 Cookie（兜底方案，需要复制用户数据 + 启动无头浏览器）
 * 同时读取 LocalStorage（X/Twitter 等现代 SPA 站点依赖 LocalStorage 的 device_id 等保持登录）
 */
async function readCookiesViaCDP(browser, profile) {
  const tempRoot = path.join(os.tmpdir(), `lingxi-browser-import-${Date.now()}`)
  const tempUserData = path.join(tempRoot, 'User Data')
  const tempProfile = path.join(tempUserData, 'Default')
  let child = null

  try {
    fs.mkdirSync(tempProfile, { recursive: true })
    try {
      fs.copyFileSync(path.join(browser.userDataRoot, 'Local State'), path.join(tempUserData, 'Local State'))
    } catch (error) {
      throw new Error(`无法复制 Local State: ${error.message}`)
    }
    const copied = copyDirLimited(profile.profilePath, tempProfile, { maxFiles: 12000 })
    if (copied < 5) {
      throw new Error('复制浏览器配置失败（文件过少，可能被占用）')
    }

    const port = pickFreePort()
    const args = [
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${tempUserData}`,
      '--profile-directory=Default',
      '--headless',
      '--disable-gpu',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-extensions',
      '--disable-background-networking',
      'about:blank'
    ]

    child = spawn(browser.exePath, args, {
      stdio: 'ignore',
      windowsHide: true
    })

    const version = await waitForDevtools(port)
    const wsUrl = version.webSocketDebuggerUrl
    if (!wsUrl) throw new Error('无 webSocketDebuggerUrl')

    await cdpCall(wsUrl, 'Network.enable').catch(() => ({}))
    let result = null
    const methods = ['Network.getAllCookies', 'Network.getCookies', 'Storage.getCookies']
    for (const method of methods) {
      try {
        result = await cdpCall(wsUrl, method)
        break
      } catch (e) {
        const msg = String(e?.message || e)
        if (msg.includes("wasn't found") || msg.includes('not found') || msg.includes('Not supported')) {
          continue
        }
        throw e
      }
    }
    if (!result) throw new Error('当前浏览器不支持通过 CDP 读取 Cookie')
    const cookies = Array.isArray(result?.cookies) ? result.cookies : []

    // 同时读取 LocalStorage：先扫描原始 profile 的 LevelDB 提取 origin 列表，
    // 再通过 CDP DOMStorage 读取（此时无头浏览器已加载复制的用户数据）
    let localStorageData = []
    try {
      const origins = scanLocalStorageOrigins(profile.profilePath)
      if (origins.length > 0) {
        localStorageData = await readLocalStorageViaCDP(wsUrl, origins, 30000)
        console.log(`[BrowserProfileImport] CDP read ${localStorageData.length} origins' LocalStorage (scanned ${origins.length} origins)`)
      }
    } catch (e) {
      console.warn('[BrowserProfileImport] read LocalStorage via CDP failed:', e.message)
    }

    return { cookies, localStorage: localStorageData }
  } finally {
    try {
      if (child && !child.killed) {
        child.kill()
        try {
          spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true })
        } catch (_) { /* ignore */ }
      }
    } catch (_) { /* ignore */ }
    try {
      fs.rmSync(tempRoot, { recursive: true, force: true })
    } catch (_) { /* ignore */ }
  }
}

/**
 * 将 LocalStorage 写入 Electron partition
 *
 * Electron 没有直接设置 LocalStorage 的 API，需要创建隐藏 BrowserWindow 加载对应 origin，
 * 然后通过 executeJavaScript 写入。
 *
 * 优化：加载 origin 的 /favicon.ico 路径，请求量小且 origin 匹配，即使 404 也能写入 LocalStorage
 *
 * @param {Array<{origin: string, items: Array<[string, string]>}>} localStorageData
 * @param {string} partition - Electron session partition
 * @returns {Promise<{written: number, failed: number, origins: number}>}
 */
async function writeLocalStorageToPartition(localStorageData, partition) {
  if (!localStorageData || !localStorageData.length) {
    return { written: 0, failed: 0, origins: 0 }
  }

  let written = 0
  let failed = 0
  let originsOk = 0
  let win = null

  try {
    win = new BrowserWindow({
      width: 400,
      height: 300,
      show: false,
      webPreferences: {
        partition,
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        webSecurity: true
      }
    })

    for (const { origin, items } of localStorageData) {
      if (!origin || !Array.isArray(items) || !items.length) continue
      try {
        // 加载 origin 的 favicon，请求小且 origin 匹配
        const targetUrl = origin.replace(/\/$/, '') + '/favicon.ico'
        let domReady = false
        const domReadyPromise = new Promise((resolve) => {
          const onReady = () => {
            domReady = true
            win.webContents.removeListener('dom-ready', onReady)
            resolve()
          }
          win.webContents.once('dom-ready', onReady)
          // 超时兜底：8 秒后无论如何都尝试写入
          setTimeout(() => {
            if (!domReady) {
              win.webContents.removeListener('dom-ready', onReady)
              resolve()
            }
          }, 8000)
        })

        try {
          await win.loadURL(targetUrl, { timeout: 10000 })
        } catch (_) {
          // loadURL 可能因 404/超时失败，但 dom-ready 可能已触发，继续等待
        }
        await domReadyPromise

        // 写入 LocalStorage
        // items 是 [[key, value], ...] 二维数组
        const entries = items.filter(([k]) => k != null).map(([k, v]) => [String(k), String(v ?? '')])
        if (!entries.length) continue

        const script = `
          (function() {
            const entries = ${JSON.stringify(entries)};
            let ok = 0;
            for (const [k, v] of entries) {
              try { localStorage.setItem(k, v); ok++; } catch (_) {}
            }
            return ok;
          })()
        `
        const okCount = await win.webContents.executeJavaScript(script, true)
        written += okCount || 0
        if (okCount > 0) originsOk += 1
      } catch (e) {
        failed += items.length
        console.warn(`[BrowserProfileImport] write LocalStorage for ${origin} failed:`, e.message)
      }
    }
  } finally {
    try {
      if (win && !win.isDestroyed()) {
        win.destroy()
      }
    } catch (_) { /* ignore */ }
  }

  console.log(`[BrowserProfileImport] LocalStorage written: ${written} items from ${originsOk}/${localStorageData.length} origins (failed: ${failed})`)
  return { written, failed, origins: originsOk }
}

/**
 * 通用导入：从指定浏览器 + Profile 导入所有登录 Cookie 和 LocalStorage
 * @param {{ browserId?: string, profileName?: string }} options
 *   - browserId: 选中的浏览器 ID（如 'chrome' / 'qqbrowser'）。省略则用第一个可用浏览器。
 *   - profileName: 选中的 Profile 名（如 'Default'）。省略则用 'Default'。
 */
async function importGoogleCookies(options = {}) {
  const browsers = listAllBrowsers()
  if (!browsers.length) {
    return { success: false, error: '未找到本机 Chromium 类浏览器（Chrome/Edge/QQ/夸克等）' }
  }

  const browser = options.browserId
    ? browsers.find(b => b.browserId === options.browserId)
    : browsers[0]
  if (!browser) {
    return { success: false, error: `未找到浏览器：${options.browserId}` }
  }
  if (!browser.exePath) {
    return { success: false, error: `${browser.displayName} 的可执行文件缺失，无法启动调试模式` }
  }

  const preferredName = options.profileName || 'Default'
  const profile = browser.profiles.find(p => p.profileName === preferredName) || browser.profiles[0]
  const importMode = options.importMode || 'append' // 'append' 或 'overwrite'

  // ── 主路径：SQLite 直读 Cookie（快速，不启动无头浏览器）──
  let allCookies = readCookiesFromSQLite(profile.profilePath)
  let localStorageData = []
  let source = 'sqlite'

  if (!allCookies.length) {
    // ── 兜底：CDP（需要复制用户数据 + 启动无头浏览器，同时读 Cookie + LocalStorage）──
    console.log('[BrowserProfileImport] SQLite returned 0 cookies, falling back to CDP')
    source = 'cdp'
    try {
      const cdpResult = await readCookiesViaCDP(browser, profile)
      allCookies = cdpResult.cookies || []
      localStorageData = cdpResult.localStorage || []
    } catch (e) {
      return { success: false, error: `CDP 读取失败: ${e.message || e}` }
    }
  } else {
    // SQLite 读到 Cookie，但 LocalStorage 必须通过 CDP 读取（无法从 SQLite 直读）
    // 启动一次 CDP 专门读 LocalStorage
    try {
      console.log('[BrowserProfileImport] SQLite got cookies, starting CDP for LocalStorage...')
      const cdpResult = await readCookiesViaCDP(browser, profile)
      localStorageData = cdpResult.localStorage || []
      // Cookie 仍用 SQLite 的（更完整），不覆盖
    } catch (e) {
      console.warn('[BrowserProfileImport] read LocalStorage via CDP failed:', e.message)
    }
  }

  // 诊断：按域名分组统计
  const domainCounts = {}
  for (const c of allCookies) {
    const d = String(c.domain || '(empty)').toLowerCase()
    domainCounts[d] = (domainCounts[d] || 0) + 1
  }
  const topDomains = Object.entries(domainCounts).sort((a, b) => b[1] - a[1]).slice(0, 15)
  console.log('[BrowserProfileImport] read', allCookies.length, 'cookies via', source, ', top domains:', topDomains)

  if (!allCookies.length) {
    return {
      success: false,
      error: `${browser.displayName}（${profile.label}）中未找到任何 Cookie`,
      profile: profile.label,
      totalCookies: 0,
      browserId: browser.browserId,
      displayName: browser.displayName
    }
  }

  const ses = session.fromPartition(TARGET_PARTITION)

  // 如果是覆盖模式，先清除现有的导入 Cookie 和 LocalStorage
  if (importMode === 'overwrite') {
    try {
      await ses.clearStorageData({
        storages: ['cookies', 'localstorage']
      })
      console.log('[BrowserProfileImport] overwrite mode: cleared existing cookies & localstorage')
    } catch (e) {
      console.warn('[BrowserProfileImport] clear storage failed:', e.message)
    }
  }

  // 获取现有 Cookie（用于追加模式的去重）
  let existingCookies = []
  if (importMode === 'append') {
    try {
      existingCookies = await ses.cookies.get({})
    } catch (e) {
      console.warn('[BrowserProfileImport] read existing cookies failed:', e.message)
    }
  }

  const existingKeys = new Set(existingCookies.map(c => `${c.domain}|${c.name}|${c.path}`))

  let imported = 0
  let failed = 0
  let skipped = 0
  for (const cookie of allCookies) {
    try {
      const domain = String(cookie.domain || '')
      const urlHost = domain.replace(/^\./, '')
      const sameSite = cookie.sameSite === 'None' || cookie.sameSite === 'no_restriction'
        ? 'no_restriction'
        : cookie.sameSite === 'Lax' || cookie.sameSite === 'lax'
          ? 'lax'
          : cookie.sameSite === 'Strict' || cookie.sameSite === 'strict'
            ? 'strict'
            : 'unspecified'
      const secure = sameSite === 'no_restriction' ? true : !!cookie.secure
      const url = `${secure ? 'https' : 'http'}://${urlHost}${cookie.path || '/'}`

      // 追加模式下跳过已存在的 Cookie
      const cookieKey = `${cookie.domain}|${cookie.name}|${cookie.path || '/'}`
      if (importMode === 'append' && existingKeys.has(cookieKey)) {
        skipped++
        continue
      }

      const payload = {
        url,
        name: cookie.name,
        value: cookie.value,
        domain: cookie.domain,
        path: cookie.path || '/',
        secure,
        httpOnly: !!cookie.httpOnly,
        expirationDate: cookie.expires > 0 ? cookie.expires : undefined,
        sameSite
      }
      await ses.cookies.set(payload)
      imported += 1
    } catch (e) {
      failed += 1
      if (failed <= 5) console.warn('[BrowserProfileImport] cookie set failed:', cookie.domain, cookie.name, e.message)
    }
  }

  try { await ses.cookies.flushStore?.() } catch (_) { /* ignore */ }

  // ── 写入 LocalStorage（X/Twitter 等现代 SPA 站点依赖 LocalStorage 的 device_id 等保持登录）──
  let lsWritten = 0
  let lsOrigins = 0
  let lsFailed = 0
  if (localStorageData.length > 0) {
    try {
      const lsResult = await writeLocalStorageToPartition(localStorageData, TARGET_PARTITION)
      lsWritten = lsResult.written
      lsOrigins = lsResult.origins
      lsFailed = lsResult.failed
    } catch (e) {
      console.warn('[BrowserProfileImport] writeLocalStorageToPartition failed:', e.message)
    }
  }

  // 验证：从 session 读回 cookies，确认写入生效
  let verifiedCount = 0
  try {
    const readBack = await ses.cookies.get({})
    verifiedCount = readBack.length
    console.log('[BrowserProfileImport] session verification:', verifiedCount, 'cookies readable from partition')
  } catch (e) {
    console.warn('[BrowserProfileImport] session verification failed:', e.message)
  }

  const modeText = importMode === 'append' ? '追加' : '覆盖'
  const lsText = lsWritten > 0 ? `，LocalStorage ${lsWritten} 项（${lsOrigins} 个站点）` : ''
  return {
    success: imported > 0 || skipped > 0 || lsWritten > 0,
    imported,
    failed,
    skipped,
    verified: verifiedCount,
    totalCookies: allCookies.length,
    importMode,
    profile: profile.label,
    browserId: browser.browserId,
    displayName: browser.displayName,
    partition: TARGET_PARTITION,
    source,
    localStorage: {
      written: lsWritten,
      origins: lsOrigins,
      failed: lsFailed,
      totalOrigins: localStorageData.length
    },
    message: (imported > 0 || lsWritten > 0)
      ? `已${modeText}导入 ${imported} 条 Cookie${skipped > 0 ? `（跳过 ${skipped} 条已存在）` : ''}${lsText}`
      : skipped > 0
        ? `所有 ${skipped} 条 Cookie 已存在，无需重复导入${lsText}`
        : 'Cookie 写入失败'
  }
}

function listImportableBrowserProfiles() {
  const browsers = listAllBrowsers()
  return {
    success: true,
    browsers,
    // 兼容旧前端字段
    chromeExecutable: browsers[0]?.exePath || null,
    userDataRoot: browsers[0]?.userDataRoot || null,
    profiles: browsers[0]?.profiles || []
  }
}

/** 兼容旧调用名 */
async function importGoogleCookiesFromChrome(options = {}) {
  return importGoogleCookies(options)
}

function registerBrowserProfileImportIPC(ipcMain) {
  ipcMain.handle('browser-profile:list', async () => listImportableBrowserProfiles())
  ipcMain.handle('browser-profile:import-google-cookies', async (_event, options = {}) => {
    return importGoogleCookies(options || {})
  })
  ipcMain.handle('browser-profile:clear-storage', async () => {
    const externalWebviewSession = require('./external-webview-session')
    return externalWebviewSession.clearPartitionStorage(externalWebviewSession.EXTERNAL_WEBVIEW_PARTITION)
  })
}

module.exports = {
  listAllBrowsers,
  listImportableBrowserProfiles,
  importGoogleCookies,
  importGoogleCookiesFromChrome,
  registerBrowserProfileImportIPC
}
