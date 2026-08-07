/**
 * Git 安全工具处理器
 * 包含：git_diff, post_change_verify 工具及相关辅助函数
 */

const path = require('path')
const changeSessions = require('../change-sessions')
const gitSafety = require('../git')

const gitSafetyBaselineLocks = new Map()

function summarizeRuntimeDiagnosticsSafe(options = {}) {
  try {
    const diagnostics = require('./diagnostics')
    if (typeof diagnostics.summarizeRuntimeDiagnosticsSafe === 'function') {
      return diagnostics.summarizeRuntimeDiagnosticsSafe(options)
    }
    const result = require('../runtime-diagnostics').summarize(options)
    return result && typeof result === 'object' ? result : {
      success: false,
      ok: false,
      unavailable: true,
      error_count: 0,
      events: [],
      error: 'runtime diagnostics returned an invalid result'
    }
  } catch (error) {
    return {
      success: false,
      ok: false,
      unavailable: true,
      error_count: 0,
      events: [],
      error: `runtime diagnostics unavailable: ${error.message}`,
      next_action: 'continue_without_runtime_diagnostics'
    }
  }
}

// clipToolText 的本地副本（避免与 file-ops.js 的循环依赖）
function clipToolText(text = '', maxChars = 12000) {
  const safeLimit = Math.max(1000, Math.min(50000, Number(maxChars) || 12000))
  const value = String(text || '')
  if (value.length <= safeLimit) return { text: value, truncated: false }
  return {
    text: `${value.slice(0, safeLimit)}\n...[truncated ${value.length - safeLimit} chars; use path or max_chars to narrow the diff]`,
    truncated: true
  }
}

async function ensureGitBaselineBeforeWrite(projectId, projectPath) {
  if (!projectId || !projectPath) return null
  const session = changeSessions.getActiveSession(projectId)
  if (!session) return null
  if (session.recoveryBaseline?.success) return session.recoveryBaseline

  const lockKey = `${projectId}:${session.id}`
  if (gitSafetyBaselineLocks.has(lockKey)) return gitSafetyBaselineLocks.get(lockKey)

  const promise = (async () => {
    try {
      const result = {
        success: true,
        skipped: true,
        kind: 'change-session-baseline',
        reason: 'captured-per-file-by-change-session',
        changeSessionId: session.id
      }
      session.recoveryBaseline = result
      return result
    } catch (error) {
      const result = { success: false, error: String(error?.message || error) }
      session.recoveryBaseline = result
      if (!session.warnings.includes('change-session-baseline-failed')) {
        session.warnings.push('change-session-baseline-failed')
      }
      console.error('[RecoveryPoints] change-session baseline failed:', error)
      return result
    } finally {
      gitSafetyBaselineLocks.delete(lockKey)
    }
  })()

  gitSafetyBaselineLocks.set(lockKey, promise)
  return promise
}

async function ensureSafetyBaselineBeforeWrite(projectId, projectPath, targetPaths = []) {
  return ensureGitBaselineBeforeWrite(projectId, projectPath)
}

const handlers = {
  git_diff: async (args, ctx) => {
    const { resolvePath, projectPath } = ctx
    try {
      const targetFile = String(args.path || '').trim()
      if (targetFile && (path.isAbsolute(targetFile) || targetFile.includes('\0'))) {
        return { success: false, error: '文件路径不合法，请传项目内相对路径' }
      }
      const gitArgs = ['diff']
      if (args.staged === true) gitArgs.push('--cached')
      if (args.stat === true) gitArgs.push('--stat')
      if (targetFile) gitArgs.push('--', targetFile)
      const diffOutput = await gitSafety.execGit(projectPath, gitArgs)
      const clipped = clipToolText(diffOutput || '', args.max_chars ?? args.maxChars)
      return {
        success: true,
        path: targetFile || '',
        staged: args.staged === true,
        stat: args.stat === true,
        diff: clipped.text || '暂无可显示的 diff。',
        truncated: clipped.truncated,
        length: diffOutput.length
      }
    } catch (e) {
      return { success: false, error_type: 'git_diff_error', error: String(e), path: args.path || '', project_root: projectPath }
    }
  },

  post_change_verify: async (args, ctx) => {
    const { resolvePath, projectPath, projectId } = ctx
    const changePlanner = require('../change-planner')
    try {
      let filesToVerify = []
      if (Array.isArray(args.files) && args.files.length > 0) {
        filesToVerify = args.files.map(f => resolvePath(f))
      } else {
        const activeSession = changeSessions.getActiveSession(projectId)
        if (activeSession?.files) {
          filesToVerify = Object.keys(activeSession.files)
            .map(f => path.isAbsolute(f) ? f : path.join(projectPath, f))
        }
      }
      if (!filesToVerify.length) {
        return { success: false, error: '没有可验证的文件。请指定文件列表或确保当前有活跃的修改会话。' }
      }
      const generateReport = typeof changePlanner.generateVerifyReportAsync === 'function'
        ? changePlanner.generateVerifyReportAsync
        : changePlanner.generateVerifyReport
      const report = await generateReport({
        projectId,
        projectPath,
        changedFiles: filesToVerify,
        deep: args.deep === true || args.full === true || args.scope === 'deep'
      })
      const runtimeDiagnostics = summarizeRuntimeDiagnosticsSafe({ since_ms: 10 * 60 * 1000, limit: 20 })
      let logicReview = null
      try {
        const diagnostics = require('./diagnostics')
        const review = diagnostics.reviewFixQualityAsync || diagnostics.reviewFixQuality
        if (typeof review === 'function') {
          logicReview = await review(filesToVerify, projectPath, {
            deep: args.deep === true || args.full === true || args.scope === 'deep'
          })
        }
      } catch (_) { /* diagnostics 模块不可用 */ }
      const requiresUiBehaviorVerification = !!logicReview?.requires_ui_behavior_verification
      const hasSyntaxUnknown = Number(report.syntaxCheck?.unknown || 0) > 0
      return {
        success: true,
        ...report,
        runtimeDiagnostics,
        logicReview,
        requires_runtime_review: Number(runtimeDiagnostics.error_count || 0) > 0,
        requires_ui_behavior_verification: requiresUiBehaviorVerification,
        next_action: Number(runtimeDiagnostics.error_count || 0) > 0
          ? 'run_runtime_verify_live_and_fix_visible_runtime_failures_before_final_reply'
          : (hasSyntaxUnknown
              ? 'rerun_check_syntax_for_unknown_files_before_treating_them_as_code_errors'
              : (requiresUiBehaviorVerification
              ? 'run_runtime_verify_interaction_for_open_close_repeat_and_console_errors_before_final_reply'
              : report.next_action)),
      }
    } catch (e) {
      return { success: false, error: e.message }
    }
  }
}

module.exports = {
  handlers,
  gitSafetyBaselineLocks,
  ensureGitBaselineBeforeWrite,
  ensureSafetyBaselineBeforeWrite
}
