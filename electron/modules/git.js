/**
 * Git 版本管理模块
 * 负责 Git 命令执行、状态获取、提交、分支管理等。
 */

const { execFile } = require('child_process')
const { promisify } = require('util')
const execFileAsync = promisify(execFile)
const fs = require('fs')
const path = require('path')
// ── Git 可用性检测（缓存结果，只检测一次）──
let _gitAvailable = null // null = 未检测, true/false = 已检测
function checkGitAvailable () {
  if (_gitAvailable !== null) return Promise.resolve(_gitAvailable)
  return new Promise(resolve => {
    execFile('git', ['--version'], { timeout: 5000, windowsHide: true }, (error) => {
      _gitAvailable = !error
      if (!_gitAvailable) {
        console.warn('[Git] 系统未安装 Git 或不在 PATH 中，版本管理功能不可用')
      }
      resolve(_gitAvailable)
    })
  })
}
function isGitAvailable () { return _gitAvailable === true }

const GIT_TIMEOUT_MS = 30000
const GIT_MAX_BUFFER = 10 * 1024 * 1024
const DEFAULT_GITIGNORE = [
  'node_modules/',
  'dist/',
  'build/',
  '.vite/',
  '.next/',
  '.nuxt/',
  'coverage/',
  '*.log',
  '.env',
  '.env.*',
  '!.env.example',
  'cache/',
  'temp/',
  'tmp/',
  '# -- 灵犀恢复点排除规则（非代码产物不备份）--',
  '*.zip',
  '*.7z',
  '*.rar',
  '*.tar',
  '*.gz',
  '*.bz2',
  '*.xz',
  '*.whl',
  '*.egg',
  '*.exe',
  '*.msi',
  '*.dmg',
  '*.pkg',
  '*.apk',
  '*.iso',
  '*.bin',
  '*.dat',
  '*.safetensors',
  '*.gguf',
  '*.onnx',
  '*.pb',
  '*.tflite',
  '*.mar',
  'installer/',
  'payload/',
  'generated-images/'
].join('\n') + '\n'

const LARGE_FILE_THRESHOLD_BYTES = 10 * 1024 * 1024 // 10 MB

function makeBackupRefName(prefix = 'reset') {
  const stamp = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)
  const random = Math.random().toString(36).slice(2, 6)
  return `lingxi-backup/${prefix}-${stamp}-${random}`
}

function normalizeError(error, stderr) {
  const message = stderr || error?.message || 'Git 命令执行失败'
  return String(message).trim()
}

function ensureProjectPath(projectPath) {
  if (!projectPath || !fs.existsSync(projectPath) || !fs.statSync(projectPath).isDirectory()) {
    throw new Error('项目路径不存在')
  }
}

function normalizeGitFileList(projectPath, files) {
  ensureProjectPath(projectPath)
  const root = path.resolve(projectPath)
  const normalized = Array.from(new Set((Array.isArray(files) ? files : [])
    .map(file => String(file || '').trim().replace(/\\/g, '/'))
    .filter(Boolean)))
  if (!normalized.length) throw new Error('请选择文件')
  normalized.forEach(file => {
    if (path.isAbsolute(file)) throw new Error(`不允许使用绝对路径：${file}`)
    const absolute = path.resolve(root, file)
    const relative = path.relative(root, absolute)
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new Error(`文件不在项目目录内：${file}`)
    }
  })
  return normalized
}

function getDirSize(dirPath) {
  try {
    if (!dirPath || !fs.existsSync(dirPath)) return 0
    const stat = fs.statSync(dirPath)
    if (!stat.isDirectory()) return stat.size || 0
    return fs.readdirSync(dirPath, { withFileTypes: true }).reduce((sum, entry) => {
      const childPath = path.join(dirPath, entry.name)
      if (entry.isDirectory()) return sum + getDirSize(childPath)
      if (entry.isFile()) return sum + (fs.statSync(childPath).size || 0)
      return sum
    }, 0)
  } catch {
    return 0
  }
}

const _gitDirSizeCache = new Map()
const _GIT_DIR_SIZE_TTL = 30000

async function getDirSizeAsync(dirPath) {
  if (!dirPath) return 0
  const cached = _gitDirSizeCache.get(dirPath)
  if (cached && Date.now() - cached.ts < _GIT_DIR_SIZE_TTL) return cached.size
  try {
    const stat = await fs.promises.stat(dirPath)
    if (!stat.isDirectory()) {
      _gitDirSizeCache.set(dirPath, { size: stat.size || 0, ts: Date.now() })
      return stat.size || 0
    }
    let total = 0
    const stack = [dirPath]
    while (stack.length > 0) {
      const current = stack.pop()
      const entries = await fs.promises.readdir(current, { withFileTypes: true })
      for (const entry of entries) {
        const childPath = path.join(current, entry.name)
        if (entry.isDirectory()) stack.push(childPath)
        else if (entry.isFile()) {
          const s = await fs.promises.stat(childPath)
          total += s.size || 0
        }
      }
    }
    _gitDirSizeCache.set(dirPath, { size: total, ts: Date.now() })
    return total
  } catch {
    return 0
  }
}

/**
 * 使用参数数组执行 Git，避免把用户输入拼进 shell 命令。
 */
function execGit(projectPath, args) {
  ensureProjectPath(projectPath)
  if (!Array.isArray(args) || args.length === 0) {
    return Promise.reject(new Error('Git 参数不能为空'))
  }
  if (_gitAvailable === false) {
    return Promise.reject(new Error('Git 未安装或不在系统 PATH 中，无法执行 git 命令'))
  }

  return new Promise((resolve, reject) => {
    execFile('git', args, {
      cwd: projectPath,
      encoding: 'utf8',
      timeout: GIT_TIMEOUT_MS,
      maxBuffer: GIT_MAX_BUFFER,
      windowsHide: true
    }, (error, stdout, stderr) => {
      if (error) {
        // 捕获 git 未安装的 ENOENT 错误，缓存结果避免后续重复尝试
        if (error.code === 'ENOENT') {
          _gitAvailable = false
          reject(new Error('Git 未安装或不在系统 PATH 中，无法执行 git 命令'))
          return
        }
        reject(normalizeError(error, stderr))
      } else {
        resolve(stdout || '')
      }
    })
  })
}

function isGitRepository(projectPath) {
  return fs.existsSync(path.join(projectPath, '.git'))
}
function getGitHiddenCommitsPath(projectPath) {
  return path.join(projectPath, '.lingxi', 'hidden-git-recovery-points.json')
}

function loadHiddenGitCommits(projectPath) {
  try {
    const filePath = getGitHiddenCommitsPath(projectPath)
    if (!fs.existsSync(filePath)) return []
    const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'))
    const hashes = Array.isArray(data?.hashes) ? data.hashes : (Array.isArray(data) ? data : [])
    return [...new Set(hashes.map(item => String(item || '').trim().toLowerCase()).filter(Boolean))]
  } catch {
    return []
  }
}

function saveHiddenGitCommits(projectPath, hashes = []) {
  const filePath = getGitHiddenCommitsPath(projectPath)
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  const unique = [...new Set((hashes || []).map(item => String(item || '').trim().toLowerCase()).filter(Boolean))]
  fs.writeFileSync(filePath, JSON.stringify({
    version: 1,
    updatedAt: new Date().toISOString(),
    hashes: unique
  }, null, 2), 'utf-8')
  return unique
}

function isHiddenGitCommit(hiddenHashes, hash) {
  const value = String(hash || '').trim().toLowerCase()
  if (!value) return false
  return (hiddenHashes || []).some(item => value === item || value.startsWith(item) || item.startsWith(value))
}

function hideGitRecoveryCommit(projectPath, hash) {
  ensureProjectPath(projectPath)
  if (!isGitRepository(projectPath)) {
    return { success: false, error: '当前项目还不是 Git 仓库' }
  }
  const target = validateHash(hash)
  const hidden = loadHiddenGitCommits(projectPath)
  if (!isHiddenGitCommit(hidden, target)) hidden.push(target.toLowerCase())
  const next = saveHiddenGitCommits(projectPath, hidden)
  return { success: true, hash: target, hiddenCount: next.length }
}

function filterVisibleCommits(projectPath, commits = []) {
  const hidden = loadHiddenGitCommits(projectPath)
  if (!hidden.length) return commits
  return (commits || []).filter(commit => !isHiddenGitCommit(hidden, commit?.hash))
}

const GIT_LOG_DATE_ARGS = ['--date=format:%Y-%m-%d %H:%M:%S', '--pretty=format:%h%x1f%s%x1f%an%x1f%ad%x1e']

function isEmptyGitHistoryError(error) {
  const message = String(error?.message || error || '')
  return /does not have any commits|needed a single revision|unknown revision|bad revision|ambiguous argument ['"]?HEAD|not a valid object name/i.test(message)
}

async function getGitLog(projectPath, limit = 20) {
  ensureProjectPath(projectPath)
  if (!isGitRepository(projectPath)) {
    return { success: true, commits: [], empty: true, repository: false, reason: 'not-a-repository' }
  }

  try {
    await execGit(projectPath, ['rev-parse', '--verify', 'HEAD'])
  } catch (error) {
    if (isEmptyGitHistoryError(error)) {
      return { success: true, commits: [], empty: true, repository: true, reason: 'no-commits' }
    }
    throw error
  }

  const count = Math.max(1, Math.min(100, Number(limit) || 20))
  const logOutput = await execGit(projectPath, [
    'log', `-${count}`, ...GIT_LOG_DATE_ARGS
  ])
  const commits = filterVisibleCommits(projectPath, parseLogRecords(logOutput))
  return { success: true, commits, empty: commits.length === 0, repository: true }
}


function ensureBasicGitignore(projectPath) {
  const ignorePath = path.join(projectPath, '.gitignore')
  const marker = '# -- 灵犀恢复点排除规则（非代码产物不备份）--'
  if (fs.existsSync(ignorePath)) {
    const existing = fs.readFileSync(ignorePath, 'utf-8')
    if (existing.includes(marker)) {
      return { created: false, merged: false, path: ignorePath }
    }
    const separator = existing.endsWith('\n') ? '' : '\n'
    fs.appendFileSync(ignorePath, separator + DEFAULT_GITIGNORE, 'utf-8')
    return { created: false, merged: true, path: ignorePath }
  }
  fs.writeFileSync(ignorePath, DEFAULT_GITIGNORE, 'utf-8')
  return { created: true, path: ignorePath }
}

async function ensureGitIdentity(projectPath) {
  try {
    await execGit(projectPath, ['config', 'user.name'])
  } catch (e) {
    await execGit(projectPath, ['config', 'user.name', 'Lingxi AI'])
    await execGit(projectPath, ['config', 'user.email', 'lingxi-ai@local'])
  }
}

async function ensureRepository(projectPath) {
  ensureProjectPath(projectPath)
  const gitignore = ensureBasicGitignore(projectPath)
  let initialized = false
  try {
    if (!isGitRepository(projectPath)) {
      await execGit(projectPath, ['init'])
      initialized = true
    }
    await ensureGitIdentity(projectPath)
  } catch (e) {
    // Git 未安装或不可用时优雅降级：项目照常创建，只是没有版本历史
    if (e.code === 'ENOENT' || /Git 未安装/.test(e.message)) {
      console.warn('[Git] ensureRepository 降级：Git 不可用，跳过仓库初始化')
      return { initialized: false, gitignore, gitUnavailable: true }
    }
    throw e
  }
  return { initialized, gitignore }
}

async function hasHeadCommit(projectPath) {
  try {
    await execGit(projectPath, ['rev-parse', '--verify', 'HEAD'])
    return true
  } catch {
    return false
  }
}

async function getShortHead(projectPath) {
  try {
    return (await execGit(projectPath, ['rev-parse', '--short', 'HEAD'])).trim()
  } catch {
    return ''
  }
}

async function commitAll(projectPath, message) {
  const repoResult = await ensureRepository(projectPath)
  if (repoResult.gitUnavailable) {
    return { success: false, skipped: true, reason: 'git-unavailable', error: 'Git 未安装' }
  }
  const statusOutput = await execGit(projectPath, ['status', '--porcelain=v1'])
  if (!statusOutput.trim()) {
    return { success: true, skipped: true, reason: 'clean' }
  }
  await execGit(projectPath, ['add', '-A'])
  // ── 大文件过滤：从暂存区排除超过阈值（10 MB）的非代码产物 ──
  const largeFilterResult = await filterLargeFilesFromStage(projectPath)
  if (largeFilterResult.filteredCount > 0) {
    const remaining = await execGit(projectPath, ['diff', '--cached', '--name-only'])
    if (!remaining.trim()) {
      return { success: true, skipped: true, reason: 'all-large-filtered', filtered: largeFilterResult.filteredFiles }
    }
  }
  await execGit(projectPath, ['commit', '-m', String(message || '').trim() || 'AI safety snapshot'])
  const hash = await getShortHead(projectPath)
  return { success: true, skipped: false, hash, largeFilter: largeFilterResult }
}

// 扫描暂存区，把超过阈值的文件撤出索引（不影响工作区副本）
async function filterLargeFilesFromStage(projectPath) {
  const stagedOutput = await execGit(projectPath, ['diff', '--cached', '--name-only'])
  const stagedFiles = String(stagedOutput || '').trim().split('\n').filter(Boolean)
  if (stagedFiles.length === 0) {
    return { filteredCount: 0, filteredFiles: [] }
  }
  const largeFiles = []
  for (const file of stagedFiles) {
    const absPath = path.resolve(projectPath, file)
    let fileSize = 0
    try {
      fileSize = fs.statSync(absPath).size
    } catch (e) {
      continue
    }
    if (fileSize > LARGE_FILE_THRESHOLD_BYTES) {
      largeFiles.push(file)
    }
  }
  if (largeFiles.length > 0) {
    const hasHead = await hasHeadCommit(projectPath)
    const args = hasHead ? ['reset', 'HEAD', '--', ...largeFiles] : ['rm', '--cached', '--ignore-unmatch', '--', ...largeFiles]
    try {
      await execGit(projectPath, args)
    } catch (err) {
      console.warn('[commitAll] 大文件 check 失败（不影响提交）:', err.message)
    }
  }
  return { filteredCount: largeFiles.length, filteredFiles: largeFiles }
}

async function createAiSafetySnapshot(projectPath, options = {}) {
  return {
    success: false,
    skipped: true,
    deprecated: true,
    reason: 'ai-git-snapshots-disabled',
    message: 'AI recovery points are stored in the content object store; Git history is unchanged.'
  }
}

async function getCurrentBranch(projectPath) {
  try {
    const branch = (await execGit(projectPath, ['rev-parse', '--abbrev-ref', 'HEAD'])).trim()
    if (branch && branch !== 'HEAD') return branch
    const hash = (await execGit(projectPath, ['rev-parse', '--short', 'HEAD'])).trim()
    return hash ? `detached:${hash}` : 'master'
  } catch (e) {
    return 'master'
  }
}

async function getMainBranchName(projectPath) {
  try {
    const remoteHead = (await execGit(projectPath, ['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD'])).trim()
    const remoteBranch = remoteHead.replace(/^origin\//, '').trim()
    if (remoteBranch) return remoteBranch
  } catch { /* 远程 origin/HEAD 未设置 */ }

  for (const name of ['main', 'master']) {
    try {
      await execGit(projectPath, ['show-ref', '--verify', '--quiet', `refs/heads/${name}`])
      return name
    } catch { /* 该默认分支不存在 */ }
  }

  return ''
}

function isMainlineBranchName(branchName, mainBranchName = '') {
  const value = String(branchName || '').trim()
  return !!value && (value === mainBranchName || /^(main|master)$/i.test(value))
}

async function getRemote(projectPath) {
  try {
    return (await execGit(projectPath, ['remote', 'get-url', 'origin'])).trim()
  } catch (e) {
    return ''
  }
}

async function getUpstream(projectPath) {
  try {
    return (await execGit(projectPath, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}'])).trim()
  } catch (e) {
    return ''
  }
}

async function getAheadBehind(projectPath) {
  const upstream = await getUpstream(projectPath)
  if (!upstream) return { upstream: '', ahead: 0, behind: 0 }

  try {
    const output = await execGit(projectPath, ['rev-list', '--left-right', '--count', `${upstream}...HEAD`])
    const [behindText, aheadText] = output.trim().split(/\s+/)
    return {
      upstream,
      ahead: Number.parseInt(aheadText, 10) || 0,
      behind: Number.parseInt(behindText, 10) || 0
    }
  } catch (e) {
    return { upstream, ahead: 0, behind: 0 }
  }
}

function parseStatusLine(line) {
  if (!line || line.length < 4) return null
  const rawStatus = line.slice(0, 2)
  const x = rawStatus[0]
  const y = rawStatus[1]
  let name = line.slice(3).trim()
  let oldName = ''

  if ((x === 'R' || x === 'C') && name.includes(' -> ')) {
    const parts = name.split(' -> ')
    oldName = parts[0]
    name = parts.slice(1).join(' -> ')
  }

  let status = 'modified'
  if (rawStatus === '??') status = 'untracked'
  else if (x === 'A' || y === 'A') status = 'added'
  else if (x === 'D' || y === 'D') status = 'deleted'
  else if (x === 'R') status = 'renamed'
  else if (x === 'C') status = 'copied'
  else if (x === 'U' || y === 'U' || rawStatus.includes('U')) status = 'conflicted'

  return {
    name,
    oldName,
    status,
    rawStatus,
    staged: x !== ' ' && x !== '?',
    unstaged: y !== ' ' && y !== '?',
    untracked: rawStatus === '??'
  }
}

function summarizeFiles(files) {
  return files.reduce((acc, file) => {
    acc[file.status] = (acc[file.status] || 0) + 1
    if (file.staged) acc.staged += 1
    if (file.unstaged) acc.unstaged += 1
    if (file.untracked) acc.untracked += 1
    if (file.status === 'conflicted') acc.conflicted += 1
    return acc
  }, {
    modified: 0,
    added: 0,
    deleted: 0,
    renamed: 0,
    copied: 0,
    untracked: 0,
    conflicted: 0,
    staged: 0,
    unstaged: 0
  })
}

async function getStatus(projectPath) {
  ensureProjectPath(projectPath)
  if (!isGitRepository(projectPath)) {
    return { success: false, error: '该项目未初始化 Git' }
  }

  const branch = await getCurrentBranch(projectPath)
  const remote = await getRemote(projectPath)
  const aheadBehind = await getAheadBehind(projectPath)
  const statusOutput = await execGit(projectPath, ['status', '--porcelain=v1'])
  const files = statusOutput
    .split('\n')
    .map(parseStatusLine)
    .filter(Boolean)
    .map(file => {
      const absolute = path.resolve(projectPath, file.name)
      let modifiedAt = 0
      try {
        const relative = path.relative(path.resolve(projectPath), absolute)
        if (relative && !relative.startsWith('..') && !path.isAbsolute(relative)) modifiedAt = fs.statSync(absolute).mtimeMs
      } catch (_) { /* deleted files do not have a working-tree timestamp */ }
      return { ...file, modifiedAt }
    })
  const counts = summarizeFiles(files)

  return {
    success: true,
    status: {
      branch,
      files,
      counts,
      modified: files.length,
      clean: files.length === 0,
      remote,
      upstream: aheadBehind.upstream,
      ahead: aheadBehind.ahead,
      behind: aheadBehind.behind,
      hasConflicts: counts.conflicted > 0
    }
  }
}

function validateHash(hash) {
  const value = String(hash || '').trim()
  if (!/^[0-9a-f]{4,40}$/i.test(value)) {
    throw new Error('版本号不合法')
  }
  return value
}

function validateBranchName(branchName) {
  const value = String(branchName || '').trim()
  if (!value) throw new Error('分支名称不能为空')
  if (/[\r\n]/.test(value)) throw new Error('分支名称不合法')
  return value
}

function parseLogRecords(output) {
  return String(output || '')
    .split('\x1e')
    .map(record => record.trim())
    .filter(Boolean)
    .map(record => {
      const parts = record.split('\x1f')
      return {
        hash: parts[0] || '',
        message: parts[1] || '',
        author: parts[2] || '',
        date: parts[3] || ''
      }
    })
}

function parseNameStatus(output) {
  return String(output || '')
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => {
      const parts = line.split('\t')
      const raw = parts[0] || ''
      const code = raw[0] || 'M'
      const oldName = (code === 'R' || code === 'C') ? (parts[1] || '') : ''
      const name = (code === 'R' || code === 'C') ? (parts[2] || oldName) : (parts[1] || '')
      const statusMap = {
        A: 'added',
        M: 'modified',
        D: 'deleted',
        R: 'renamed',
        C: 'copied'
      }
      return {
        name,
        oldName,
        rawStatus: raw,
        status: statusMap[code] || 'modified'
      }
    })
    .filter(file => !!file.name)
}

function summarizeBranchFiles(files) {
  return files.reduce((acc, file) => {
    acc.total += 1
    acc[file.status] = (acc[file.status] || 0) + 1
    return acc
  }, {
    total: 0,
    added: 0,
    modified: 0,
    deleted: 0,
    renamed: 0,
    copied: 0
  })
}

async function getCommitSummary(projectPath, hash) {
  const value = hash === 'HEAD' ? 'HEAD' : validateHash(hash)
  return (await execGit(projectPath, ['show', '--no-patch', '--pretty=format:%h %s', value])).trim()
}

async function prepareHardResetBackup(projectPath) {
  const backupRef = makeBackupRefName('reset')
  await execGit(projectPath, ['branch', backupRef, 'HEAD'])

  const statusOutput = await execGit(projectPath, ['status', '--porcelain=v1'])
  let stashCreated = false
  if (statusOutput.trim()) {
    await execGit(projectPath, ['stash', 'push', '--include-untracked', '-m', `Lingxi backup before reset ${backupRef}`])
    stashCreated = true
  }

  return { backupRef, stashCreated }
}

function buildCommitSuggestion(files, counts) {
  if (!files.length) return '暂无改动，无需提交'

  const topFiles = files.slice(0, 3).map(file => file.name).join(', ')
  if (counts.conflicted > 0) return `处理冲突: ${topFiles}${files.length > 3 ? ' 等' : ''}`
  if (counts.added + counts.untracked > 0 && counts.modified === 0 && counts.deleted === 0) {
    return `添加文件: ${topFiles}${files.length > 3 ? ' 等' : ''}`
  }
  if (counts.deleted > 0 && counts.modified === 0 && counts.added + counts.untracked === 0) {
    return `删除文件: ${topFiles}${files.length > 3 ? ' 等' : ''}`
  }
  return `更新文件: ${topFiles}${files.length > 3 ? ' 等' : ''}`
}

/**
 * 注册 Git 管理 IPC handlers
 */
function registerGitIPC(ipcMain) {
  // 启动时预检 Git 是否可用
  checkGitAvailable()

  ipcMain.handle('git-status', async (event, projectPath) => {
    try {
      return await getStatus(projectPath)
    } catch (e) {
      return { success: false, error: String(e) }
    }
  })

  ipcMain.handle('git-init', async (event, projectPath) => {
    try {
      await ensureRepository(projectPath)
      return { success: true }
    } catch (e) {
      return { success: false, error: String(e) }
    }
  })

  ipcMain.handle('git-log', async (event, projectPath) => {
    try {
      return await getGitLog(projectPath, 20)
    } catch (e) {
      return { success: false, error: String(e) }
    }
  })

  ipcMain.handle('git-stage-files', async (event, projectPath, files) => {
    try {
      await ensureRepository(projectPath)
      const targets = normalizeGitFileList(projectPath, files)
      await execGit(projectPath, ['add', '-A', '--', ...targets])
      return { success: true, count: targets.length }
    } catch (e) {
      return { success: false, error: String(e) }
    }
  })

  ipcMain.handle('git-ignore-files', async (event, projectPath, files) => {
    try {
      await ensureRepository(projectPath)
      const targets = normalizeGitFileList(projectPath, files)
      const ignorePath = path.join(projectPath, '.gitignore')
      const existing = fs.existsSync(ignorePath) ? fs.readFileSync(ignorePath, 'utf-8') : ''
      const existingLines = new Set(existing.split(/\r?\n/).map(line => line.trim()))
      const additions = targets
        .map(file => `/${file.replace(/^\/+/, '')}`)
        .filter(rule => !existingLines.has(rule))
      if (additions.length) {
        const separator = !existing || existing.endsWith('\n') ? '' : '\n'
        fs.appendFileSync(ignorePath, `${separator}# -- Lingxi ignored snapshot files --\n${additions.join('\n')}\n`, 'utf-8')
      }
      try {
        await execGit(projectPath, ['rm', '--cached', '-r', '-f', '--ignore-unmatch', '--', ...targets])
      } catch (_) { /* untracked files only need the ignore rule */ }
      return { success: true, count: targets.length, addedRules: additions.length }
    } catch (e) {
      return { success: false, error: String(e) }
    }
  })

  ipcMain.handle('git-hide-recovery-commit', async (event, projectPath, hash) => {
    try {
      return hideGitRecoveryCommit(projectPath, hash)
    } catch (e) {
      return { success: false, error: String(e) }
    }
  })

  ipcMain.handle('git-recovery-summary', async (event, projectPath) => {
    try {
      ensureProjectPath(projectPath)
      if (!isGitRepository(projectPath)) {
        return { success: true, count: 0, latestAt: '', totalBytes: 0 }
      }

      let count = 0
      let latestAt = ''
      try {
        count = Number.parseInt((await execGit(projectPath, ['rev-list', '--count', 'HEAD'])).trim(), 10) || 0
      } catch {
        count = 0
      }
      if (count > 0) {
        try {
          latestAt = (await execGit(projectPath, ['log', '-1', '--format=%cI'])).trim()
        } catch {
          latestAt = ''
        }
      }

      return {
        success: true,
        count,
        latestAt,
        totalBytes: await getDirSizeAsync(path.join(projectPath, '.git'))
      }
    } catch (e) {
      return { success: false, error: String(e) }
    }
  })

  ipcMain.handle('git-branches', async (event, projectPath) => {
    try {
      const currentBranch = await getCurrentBranch(projectPath)
      const mainBranchName = await getMainBranchName(projectPath)
      const branchOutput = await execGit(projectPath, ['branch', '--format=%(refname:short)|%(HEAD)|%(upstream:short)'])
      const branches = branchOutput
        .split('\n')
        .map(line => line.trim())
        .filter(Boolean)
        .map(line => {
          const [name, head, upstream] = line.split('|')
          const branchName = String(name || '').trim()
          return {
            name: branchName,
            current: head === '*',
            upstream: upstream || '',
            isMainline: isMainlineBranchName(branchName, mainBranchName)
          }
        })
        .filter(branch => !!branch.name)
      if (!branches.some(branch => branch.current) && currentBranch) {
        const current = branches.find(branch => branch.name === currentBranch)
        if (current) current.current = true
      }
      return { success: true, branches, mainBranchName }
    } catch (e) {
      return { success: false, error: String(e) }
    }
  })

  ipcMain.handle('git-branch-detail', async (event, projectPath, branch) => {
    try {
      const branchName = validateBranchName(branch)
      const currentBranch = await getCurrentBranch(projectPath)
      const mainBranchName = await getMainBranchName(projectPath)
      await execGit(projectPath, ['show-ref', '--verify', '--quiet', `refs/heads/${branchName}`])

      const isMainline = isMainlineBranchName(branchName, mainBranchName)
      const baseBranch = mainBranchName && !isMainline ? mainBranchName : ''
      const files = []
      let commits = []
      let compareLabel = ''

      if (baseBranch) {
        compareLabel = `${baseBranch}...${branchName}`
        try {
          const diffOutput = await execGit(projectPath, ['diff', '--name-status', '--find-renames', `${baseBranch}...${branchName}`])
          files.push(...parseNameStatus(diffOutput))
        } catch {
          const diffOutput = await execGit(projectPath, ['diff', '--name-status', '--find-renames', `${baseBranch}..${branchName}`])
          files.push(...parseNameStatus(diffOutput))
          compareLabel = `${baseBranch}..${branchName}`
        }
        const logOutput = await execGit(projectPath, [
          'log',
          `${baseBranch}..${branchName}`,
          ...GIT_LOG_DATE_ARGS
        ])
        commits = filterVisibleCommits(projectPath, parseLogRecords(logOutput))
      } else {
        compareLabel = branchName
        const logOutput = await execGit(projectPath, [
          'log',
          branchName,
          '-10',
          ...GIT_LOG_DATE_ARGS
        ])
        commits = filterVisibleCommits(projectPath, parseLogRecords(logOutput))
      }

      return {
        success: true,
        branch: {
          name: branchName,
          current: branchName === currentBranch,
          isMainline,
          mainBranchName,
          currentBranch,
          compareLabel,
          files,
          counts: summarizeBranchFiles(files),
          commits
        }
      }
    } catch (e) {
      return { success: false, error: String(e) }
    }
  })

  ipcMain.handle('git-commit', async (event, projectPath, message) => {
    try {
      const commitMessage = String(message || '').trim()
      if (!commitMessage) return { success: false, error: '提交说明不能为空' }

      return await commitAll(projectPath, commitMessage)
    } catch (e) {
      return { success: false, error: String(e) }
    }
  })

  ipcMain.handle('git-push', async (event, projectPath) => {
    try {
      const remote = await getRemote(projectPath)
      if (!remote) {
        return { success: false, error: '当前仓库没有配置远程仓库 (origin)，请先添加远程仓库地址', noRemote: true }
      }
      const branch = await getCurrentBranch(projectPath)
      const upstream = await getUpstream(projectPath)
      if (!upstream && branch && !branch.startsWith('detached:')) {
        await execGit(projectPath, ['push', '-u', 'origin', branch])
      } else {
        await execGit(projectPath, ['push'])
      }
      return { success: true }
    } catch (e) {
      return { success: false, error: String(e) }
    }
  })

  ipcMain.handle('git-pull', async (event, projectPath) => {
    try {
      const remote = await getRemote(projectPath)
      if (!remote) {
        return { success: false, error: '当前仓库没有配置远程仓库 (origin)，请先添加远程仓库地址', noRemote: true }
      }
      const branch = await getCurrentBranch(projectPath)
      const upstream = await getUpstream(projectPath)
      if (!upstream && branch && !branch.startsWith('detached:')) {
        // 没有上游跟踪，先设置再拉取
        await execGit(projectPath, ['branch', '--set-upstream-to=origin/' + branch, branch])
      }
      await execGit(projectPath, ['pull', '--ff-only'])
      return { success: true }
    } catch (e) {
      return { success: false, error: String(e) }
    }
  })

  ipcMain.handle('git-checkout', async (event, projectPath, branch) => {
    try {
      await execGit(projectPath, ['checkout', validateBranchName(branch)])
      return { success: true }
    } catch (e) {
      return { success: false, error: String(e) }
    }
  })

  ipcMain.handle('git-merge', async (event, projectPath, branch) => {
    try {
      await execGit(projectPath, ['merge', validateBranchName(branch)])
      return { success: true }
    } catch (e) {
      return { success: false, error: String(e) }
    }
  })

  ipcMain.handle('git-create-branch', async (event, projectPath, branchName) => {
    try {
      const safeName = validateBranchName(branchName)
      // 创建前保存当前所在分支（HEAD），之后切回去
      let previousBranch = ''
      try {
        const { stdout } = await execFileAsync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
          cwd: projectPath, encoding: 'utf8', timeout: 3000, windowsHide: true
        })
        previousBranch = String(stdout || '').trim()
      } catch {}
      if (!previousBranch || previousBranch === 'HEAD') previousBranch = ''

      // 优先用 git branch 原地创建，避免 checkout 改变 HEAD 与磁盘状态
      try {
        await execGit(projectPath, ['branch', safeName])
      } catch (branchErr) {
        // 退化到 checkout -b，保证仍能创建
        await execGit(projectPath, ['checkout', '-b', safeName])
        return { success: true, branchName: safeName, previousBranch: '' }
      }
      return { success: true, branchName: safeName, previousBranch: previousBranch || '' }
    } catch (e) {
      return { success: false, error: String(e) }
    }
  })

  ipcMain.handle('git-delete-branch', async (event, payload = {}) => {
    try {
      const targetProjectPath = String(payload?.projectPath || '').trim()
      const projectId = String(payload?.projectId || '').trim()
      const branchName = validateBranchName(payload?.branchName)
      const currentBranch = await getCurrentBranch(targetProjectPath)
      const mainBranchName = await getMainBranchName(targetProjectPath)

      if (isMainlineBranchName(branchName, mainBranchName)) {
        return { success: false, error: '主线分支不能删除' }
      }
      if (branchName === currentBranch) {
        return { success: false, error: '当前正在使用的分支不能删除，请先切换到主线或其他分支' }
      }

      await execGit(targetProjectPath, ['branch', '-D', '--', branchName])

      const cleanup = { branchSession: null }
      try {
        const projects = require('./projects')
        cleanup.branchSession = await projects.cleanupProjectBranchData?.(projectId, branchName) || null
      } catch (cleanupError) {
        cleanup.branchSession = { success: false, error: cleanupError?.message || String(cleanupError) }
      }

      return { success: true, branchName, currentBranch, mainBranchName, cleanup }    } catch (e) {
      return { success: false, error: String(e) }
    }
  })

  ipcMain.handle('git-generate-commit', async (event, projectPath) => {
    try {
      const result = await getStatus(projectPath)
      if (!result.success) return result
      return {
        success: true,
        suggestion: buildCommitSuggestion(result.status.files, result.status.counts)
      }
    } catch (e) {
      return { success: false, error: String(e) }
    }
  })

  ipcMain.handle('git-reset', async (event, projectPath, hash) => {
    try {
      const target = validateHash(hash)
      const before = await getCommitSummary(projectPath, 'HEAD')
      const targetSummary = await getCommitSummary(projectPath, target)
      const backup = await prepareHardResetBackup(projectPath)
      await execGit(projectPath, ['reset', '--hard', target])
      return { success: true, before, target: targetSummary, backupRef: backup.backupRef, stashCreated: backup.stashCreated }
    } catch (e) {
      return { success: false, error: String(e) }
    }
  })

  ipcMain.handle('git-diff-commit', async (event, projectPath, hash) => {
    try {
      const target = validateHash(hash)
      const diff = await execGit(projectPath, [
        'show',
        '--stat',
        '--patch',
        '--pretty=format:%s%n%b',
        target
      ])
      return { success: true, diff }
    } catch (e) {
      return { success: false, error: String(e) }
    }
  })

  ipcMain.handle('git-file-diff', async (event, projectPath, filePath) => {
    try {
      const targetFile = String(filePath || '').trim()
      if (!targetFile || path.isAbsolute(targetFile) || targetFile.includes('\0')) {
        return { success: false, error: '文件路径不合法' }
      }
      const diff = await execGit(projectPath, ['diff', '--', targetFile])
      if (diff.trim()) return { success: true, diff }
      const stagedDiff = await execGit(projectPath, ['diff', '--cached', '--', targetFile])
      return { success: true, diff: stagedDiff || '该文件暂无可显示的 diff，可能是新文件或二进制文件。' }
    } catch (e) {
      return { success: false, error: String(e) }
    }
  })

  ipcMain.handle('git-add-remote', async (event, projectPath, remoteUrl) => {
    try {
      const url = String(remoteUrl || '').trim()
      if (!url) return { success: false, error: '请输入远程仓库地址' }
      // 基本 URL 校验，防止命令注入
      if (!/^https?:\/\/.+/i.test(url) && !/^git@.+:.+/.test(url) && !/^ssh:\/\/.+/.test(url)) {
        return { success: false, error: '远程仓库地址格式不正确，请使用 HTTPS 或 SSH 地址' }
      }
      // 检查是否已有 origin
      const existing = await getRemote(projectPath)
      if (existing) {
        // 已有 origin，替换它
        await execGit(projectPath, ['remote', 'set-url', 'origin', url])
      } else {
        await execGit(projectPath, ['remote', 'add', 'origin', url])
      }
      return { success: true, remote: url }
    } catch (e) {
      return { success: false, error: String(e) }
    }
  })

  ipcMain.handle('git-remove-remote', async (event, projectPath) => {
    try {
      await execGit(projectPath, ['remote', 'remove', 'origin'])
      return { success: true }
    } catch (e) {
      return { success: false, error: String(e) }
    }
  })
}

module.exports = {
  execGit,
  getStatus,
  getGitLog,
  createAiSafetySnapshot,
  registerGitIPC,
  checkGitAvailable,
  isGitAvailable,
  // ── 远程桥接直调接口 ──
  remoteBridgeHandlers: {
    'git-status': async (projectPath) => {
      try {
        const status = await getStatus(projectPath)
        return { success: true, ...status }
      } catch (e) {
        return { success: false, error: String(e) }
      }
    },
    'git-log': async (projectPath) => {
      try {
        return await getGitLog(projectPath, 20)
      } catch (e) {
        return { success: false, error: String(e) }
      }
    },
    'git-hide-recovery-commit': async (projectPath, hash) => {
      try {
        return hideGitRecoveryCommit(projectPath, hash)
      } catch (e) {
        return { success: false, error: String(e) }
      }
    },
    'git-commit': async (projectPath, message) => {
      try {
        return await commitAll(projectPath, message)
      } catch (e) {
        return { success: false, error: String(e) }
      }
    },
    'git-push': async (projectPath) => {
      try {
        const remote = await getRemote(projectPath)
        if (!remote) {
          return { success: false, error: '当前仓库没有配置远程仓库 (origin)，请先添加远程仓库地址', noRemote: true }
        }
        const branch = await getCurrentBranch(projectPath)
        const upstream = await getUpstream(projectPath)
        if (!upstream && branch && !branch.startsWith('detached:')) {
          await execGit(projectPath, ['push', '-u', 'origin', branch])
        } else {
          await execGit(projectPath, ['push'])
        }
        return { success: true }
      } catch (e) {
        return { success: false, error: String(e) }
      }
    },
    'git-pull': async (projectPath) => {
      try {
        const remote = await getRemote(projectPath)
        if (!remote) {
          return { success: false, error: '当前仓库没有配置远程仓库 (origin)，请先添加远程仓库地址', noRemote: true }
        }
        const branch = await getCurrentBranch(projectPath)
        const upstream = await getUpstream(projectPath)
        if (!upstream && branch && !branch.startsWith('detached:')) {
          await execGit(projectPath, ['branch', '--set-upstream-to=origin/' + branch, branch])
        }
        await execGit(projectPath, ['pull', '--ff-only'])
        return { success: true }
      } catch (e) {
        return { success: false, error: String(e) }
      }
    },
    'git-branches': async (projectPath) => {
      try {
        const currentBranch = await getCurrentBranch(projectPath)
        const mainBranchName = await getMainBranchName(projectPath)
        const branchOutput = await execGit(projectPath, ['branch', '--format=%(refname:short)|%(HEAD)|%(upstream:short)'])
        const branches = branchOutput
          .split('\n')
          .map(line => line.trim())
          .filter(Boolean)
          .map(line => {
            const [name, head, upstream] = line.split('|')
            const branchName = String(name || '').trim()
            return {
              name: branchName,
              current: head === '*',
              upstream: upstream || '',
              isMainline: isMainlineBranchName(branchName, mainBranchName)
            }
          })
          .filter(branch => !!branch.name)
        if (!branches.some(branch => branch.current) && currentBranch) {
          const current = branches.find(branch => branch.name === currentBranch)
          if (current) current.current = true
        }
        return { success: true, branches, mainBranchName }
      } catch (e) {
        return { success: false, error: String(e) }
      }
    },
  }
}
