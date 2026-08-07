const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { execFile } = require('child_process')
const { promisify } = require('util')
const execFileAsync = promisify(execFile)

function slug(value = '') {
  return String(value || '')
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
}

async function runGit(projectPath, args) {
  const result = await execFileAsync('git', ['-C', projectPath, ...args], {
    windowsHide: true,
    maxBuffer: 8 * 1024 * 1024
  })
  return String(result.stdout || '').trim()
}

function resolveWorktreePath(projectPath, branchName) {
  const projectName = slug(path.basename(projectPath)) || 'project'
  const branchPart = slug(branchName) || crypto.randomBytes(4).toString('hex')
  return path.join(path.dirname(projectPath), '.lingxi-worktrees', projectName, branchPart)
}

async function createWorktree({ projectPath, branchName }) {
  const sourcePath = path.resolve(String(projectPath || ''))
  const branch = String(branchName || '').trim()
  if (!sourcePath || !branch) return { success: false, error: '项目路径和分支名称不能为空' }
  if (!fs.existsSync(sourcePath)) return { success: false, error: '项目目录不存在' }

  const gitRoot = await runGit(sourcePath, ['rev-parse', '--show-toplevel'])
  const worktreePath = resolveWorktreePath(gitRoot, branch)
  if (fs.existsSync(worktreePath)) return { success: false, error: `工作区目录已存在：${worktreePath}` }
  fs.mkdirSync(path.dirname(worktreePath), { recursive: true })

  const refs = await runGit(gitRoot, ['for-each-ref', '--format=%(refname:short)', 'refs/heads'])
  const branchExists = refs.split(/\r?\n/).some(name => name === branch)
  const args = branchExists
    ? ['worktree', 'add', worktreePath, branch]
    : ['worktree', 'add', '-b', branch, worktreePath, 'HEAD']
  await runGit(gitRoot, args)

  return {
    success: true,
    projectPath: gitRoot,
    worktreePath,
    branchName: branch,
    workspaceId: `workspace-${crypto.createHash('sha1').update(worktreePath).digest('hex').slice(0, 12)}`
  }
}

async function removeWorktree({ projectPath, worktreePath, force = false }) {
  const sourcePath = path.resolve(String(projectPath || ''))
  const targetPath = path.resolve(String(worktreePath || ''))
  if (!sourcePath || !targetPath) return { success: false, error: '缺少工作区路径' }
  await runGit(sourcePath, ['worktree', 'remove', ...(force ? ['--force'] : []), targetPath])
  return { success: true, worktreePath: targetPath }
}

async function mergeWorktree({ projectPath, branchName }) {
  const sourcePath = path.resolve(String(projectPath || ''))
  const branch = String(branchName || '').trim()
  if (!sourcePath || !branch) return { success: false, error: '缺少主工作区路径或分支名称' }

  const dirty = await runGit(sourcePath, ['status', '--porcelain'])
  if (dirty) return { success: false, error: '主工作区存在未提交改动，请先提交或清理后再合并' }

  const currentBranch = await runGit(sourcePath, ['rev-parse', '--abbrev-ref', 'HEAD'])
  const remoteHead = await runGit(sourcePath, ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'])
    .catch(() => '')
  const mainBranch = remoteHead.replace(/^origin\//, '') || (currentBranch === 'master' ? 'master' : 'main')
  if (currentBranch !== mainBranch) {
    return { success: false, error: `主工作区当前位于「${currentBranch}」，请先切回「${mainBranch}」再合并` }
  }

  await runGit(sourcePath, ['merge', '--no-ff', branch])
  return { success: true, branchName: branch, mainBranchName: mainBranch }
}

function registerIPC(ipcMain) {
  ipcMain.handle('project-worktree:create', async (_, payload = {}) => {
    try {
      return await createWorktree(payload)
    } catch (error) {
      return { success: false, error: error.stderr || error.message }
    }
  })
  ipcMain.handle('project-worktree:remove', async (_, payload = {}) => {
    try {
      return await removeWorktree(payload)
    } catch (error) {
      return { success: false, error: error.stderr || error.message }
    }
  })
  ipcMain.handle('project-worktree:merge', async (_, payload = {}) => {
    try {
      return await mergeWorktree(payload)
    } catch (error) {
      return { success: false, error: error.stderr || error.message }
    }
  })
}

module.exports = { registerIPC, createWorktree, removeWorktree, mergeWorktree }