const fs = require('fs')
const { spawnSync } = require('child_process')
const { getRgPath } = require('./rg-path')
const { getCommandExecutionEnv } = require('./tool-handlers/command')

function checkStatus(ok, details = {}) {
  return {
    ok: !!ok,
    status: ok ? 'ok' : 'failed',
    ...details
  }
}

function buildRgCheckCandidates(rgPath = '') {
  const original = String(rgPath || '').trim()
  const unpacked = original.includes('app.asar') && !original.includes('app.asar.unpacked')
    ? original.replace('app.asar', 'app.asar.unpacked')
    : original
  return [...new Set([unpacked, original, 'rg'].filter(Boolean))]
}

function runRgCheck() {
  const rgPath = getRgPath()
  const attempts = []
  for (const candidate of buildRgCheckCandidates(rgPath)) {
    try {
      const result = spawnSync(candidate, ['--version'], {
        encoding: 'utf8',
        windowsHide: true,
        env: getCommandExecutionEnv(),
        timeout: 5000
      })
      attempts.push({ path: candidate, exitCode: result.status, error: result.error?.message || '' })
      if (result.status === 0) {
        return checkStatus(true, {
          name: 'ripgrep',
          rgPath: candidate,
          resolvedFrom: rgPath,
          exitCode: result.status,
          stdout: String(result.stdout || '').split(/\r?\n/).slice(0, 2).join('\n'),
          stderr: String(result.stderr || '').trim(),
          attempts,
          message: 'rg is available through bundled/PATH resolution.'
        })
      }
    } catch (error) {
      attempts.push({ path: candidate, exitCode: null, error: error.message })
    }
  }
  return checkStatus(false, {
    name: 'ripgrep',
    rgPath,
    attempts,
    message: 'rg is not executable from bundled or PATH candidates.'
  })
}

async function runDispatchSmoke(ctx = {}, args = {}) {
  if (args.deep !== true || typeof ctx.dispatch !== 'function') {
    return checkStatus(true, {
      name: 'dispatch_smoke',
      skipped: true,
      message: 'Pass deep=true to run read-only dispatch smoke checks.'
    })
  }

  const results = []
  const projectPath = ctx.projectPath || ''
  if (projectPath && fs.existsSync(projectPath)) {
    results.push({
      tool: 'list_files',
      result: await ctx.dispatch('list_files', { path: '.', recursive: false, limit: 5 }, { source: 'tool_self_check' })
    })
    results.push({
      tool: 'glob_files',
      result: await ctx.dispatch('glob_files', { path: '.', pattern: 'electron/modules/*.js', limit: 5, include_hidden: false }, { source: 'tool_self_check' })
    })
  }

  const failed = results.filter(item => item.result?.success === false || item.result?.error)
  return checkStatus(failed.length === 0, {
    name: 'dispatch_smoke',
    projectPath,
    checks: results.map(item => ({
      tool: item.tool,
      success: item.result?.success !== false && !item.result?.error,
      keys: item.result && typeof item.result === 'object' ? Object.keys(item.result).slice(0, 12) : []
    })),
    message: failed.length ? 'One or more read-only dispatch checks failed.' : 'Read-only dispatch checks passed.'
  })
}

async function runToolSelfCheck(args = {}, ctx = {}) {
  const registry = ctx.registry || require('./tool-registry')
  const validation = registry.validateToolRegistry()
  const projectPath = ctx.projectPath || ''
  const projectExists = projectPath ? fs.existsSync(projectPath) : false
  const projectIsDirectory = projectExists && fs.statSync(projectPath).isDirectory()

  const checks = [
    checkStatus(validation.success, {
      name: 'registry',
      counts: validation.counts,
      errors: validation.errors,
      warnings: validation.warnings.slice(0, 80),
      message: validation.success ? 'Tool registry is internally consistent for model-visible tools.' : 'Tool registry has blocking errors.'
    }),
    runRgCheck(),
    checkStatus(!projectPath || projectIsDirectory, {
      name: 'project_path',
      projectPath,
      exists: projectExists,
      isDirectory: projectIsDirectory,
      message: !projectPath ? 'No project path was provided.' : (projectIsDirectory ? 'Project path exists.' : 'Project path is missing or not a directory.')
    }),
    await runDispatchSmoke(ctx, args)
  ]

  const failed = checks.filter(item => !item.ok)
  return {
    success: failed.length === 0,
    tool: 'tool_self_check',
    checkedAt: new Date().toISOString(),
    summary: {
      failed: failed.length,
      passed: checks.length - failed.length,
      total: checks.length
    },
    checks,
    registry: args.include_registry === true || args.includeRegistry === true
      ? registry.getRegistrySnapshot()
      : {
          counts: validation.counts,
          errors: validation.errors,
          warningCount: validation.warnings.length
        },
    recommendations: failed.length
      ? [
          'Fix registry errors before relying on model-visible tools.',
          'If rg fails, verify @vscode/ripgrep is packaged or available through PATH.',
          'If dispatch smoke fails, inspect the named tool result and its path handling.'
        ]
      : [
          'Tool registry, rg resolution, and read-only dispatch path are usable.'
        ]
  }
}

module.exports = {
  buildRgCheckCandidates,
  runToolSelfCheck
}
