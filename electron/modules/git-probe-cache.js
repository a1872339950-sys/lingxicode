/**
 * Git 探针同步缓存
 *
 * 原实现写入后 setImmediate 立即删除，等于没有缓存。
 * 改为以 .git/HEAD 文件修改时间为失效依据：文件没变就用缓存，
 * 文件变了（分支切换 / checkout）才重新执行 git 命令。
 * .git/HEAD 不可读时 fallback 到 5 秒 TTL，不会比原来更差。
 */

const fs = require('fs')
const path = require('path')

const cache = new Map()
const FALLBACK_TTL_MS = 5000

/**
 * 获取 .git/HEAD 文件的修改时间戳（ms）。
 * 对于标准仓库返回 .git/HEAD 的 mtimeMs；
 * 对于 worktree / submodule / bare 仓库可能拿不到，返回 0。
 */
function getGitHeadMtime(projectPath) {
  if (!projectPath) return 0
  try {
    const gitPath = path.join(projectPath, '.git')
    let stat
    // .git 是目录（标准仓库）
    try {
      stat = fs.statSync(gitPath)
    } catch {
      return 0
    }
    if (stat.isDirectory()) {
      const headPath = path.join(gitPath, 'HEAD')
      try {
        return fs.statSync(headPath).mtimeMs || 0
      } catch {
        // .git/HEAD 不存在（极少见），退而检查 .git 目录 mtime
        return stat.mtimeMs || 0
      }
    }
    // .git 是文件（worktree / submodule），内容是 gitdir: <path>
    // 用 .git 文件本身的 mtime 作为近似
    return stat.mtimeMs || 0
  } catch {
    return 0
  }
}

/**
 * 带过期判断的同步缓存。
 * @param {string} key  缓存键
 * @param {string} projectPath  项目路径（用于检测 .git/HEAD mtime）
 * @param {() => any} loader  缓存未命中时执行的加载函数
 */
function getSyncGitProbeCache(key, projectPath, loader) {
  const mtime = getGitHeadMtime(projectPath)
  const now = Date.now()
  const entry = cache.get(key)

  if (entry) {
    // 有 mtime 就靠 mtime 判断；没有就靠 TTL
    if (mtime > 0 && entry.mtime === mtime) {
      return entry.value
    }
    if (mtime === 0 && now - entry.timestamp < FALLBACK_TTL_MS) {
      return entry.value
    }
    // 过期，继续往下重新加载
  }

  const value = loader()
  cache.set(key, { value, mtime, timestamp: now })
  return value
}

/**
 * 清除指定项目路径相关的缓存（可选，供分支切换等场景主动调用）。
 */
function invalidateProjectCache(projectPath) {
  if (!projectPath) return
  const resolved = path.resolve(projectPath).toLowerCase()
  for (const key of cache.keys()) {
    if (key.toLowerCase().includes(resolved)) {
      cache.delete(key)
    }
  }
}

module.exports = { getSyncGitProbeCache, invalidateProjectCache }
