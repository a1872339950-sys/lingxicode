const fs = require('fs')
const os = require('os')
const path = require('path')
const { execFileSync } = require('child_process')

module.exports = {
  id: 'git.empty-history',
  title: 'A repository without commits is a normal empty recovery history',
  tags: ['git', 'recovery-points', 'frontend-safety'],
  changedFilePatterns: [
    /^electron\/modules\/git\.js$/i,
    /^frontend\/scripts\/features\/git-panel\.js$/i
  ],

  async run(ctx) {
    const git = require(path.join(ctx.root, 'electron/modules/git'))
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'lingxi-empty-git-'))
    const plainProject = path.join(base, 'plain')
    const emptyRepo = path.join(base, 'empty-repo')
    fs.mkdirSync(plainProject, { recursive: true })
    fs.mkdirSync(emptyRepo, { recursive: true })

    try {
      const plain = await git.getGitLog(plainProject)
      ctx.assert.equal(plain.success, true, 'a project without .git must not break recovery history')
      ctx.assert.deepEqual(plain.commits, [])
      ctx.assert.equal(plain.reason, 'not-a-repository')

      execFileSync('git', ['init'], { cwd: emptyRepo, windowsHide: true, stdio: 'ignore' })
      const empty = await git.getGitLog(emptyRepo)
      ctx.assert.equal(empty.success, true, 'an initialized repository without HEAD must be a normal empty state')
      ctx.assert.deepEqual(empty.commits, [])
      ctx.assert.equal(empty.reason, 'no-commits')
      ctx.assert.equal(empty.repository, true)

      const remoteResult = await git.remoteBridgeHandlers['git-log'](emptyRepo)
      ctx.assert.equal(remoteResult.success, true, 'remote recovery history must use the same empty-history behavior')
      ctx.assert.deepEqual(remoteResult.commits, [])
    } finally {
      fs.rmSync(base, { recursive: true, force: true })
    }
  }
}
