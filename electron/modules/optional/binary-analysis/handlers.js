const path = require('path')
const fs = require('fs')
const { inspectFile, MAX_READ_BYTES } = require('./inspect')

function resolveTargetPath(args, ctx) {
  const raw = String(args.path || args.file_path || args.filePath || '').trim()
  if (!raw) return { error: 'missing path' }
  if (ctx?.resolvePath) {
    try {
      return { path: ctx.resolvePath(raw) }
    } catch (e) {
      return { error: e.message || 'resolve path failed' }
    }
  }
  const base = ctx?.projectPath || process.cwd()
  return { path: path.isAbsolute(raw) ? path.resolve(raw) : path.resolve(base, raw) }
}

async function inspect_binary(args = {}, ctx = {}) {
  const featureSettings = require('../../feature-settings')
  if (!featureSettings.isFeatureEnabled('binary_analysis')) {
    return {
      success: false,
      error_type: 'feature_disabled',
      error: '能力「二进制分析」未开启。请在设置 → 能力开关中打开后再试。'
    }
  }

  const resolved = resolveTargetPath(args, ctx)
  if (resolved.error) {
    return { success: false, error_type: 'missing_path', error: resolved.error }
  }
  const filePath = resolved.path
  if (!fs.existsSync(filePath)) {
    return { success: false, error_type: 'not_found', error: `文件不存在: ${filePath}`, path: filePath }
  }

  // 项目外路径走既有权限（若可用）
  try {
    const projectPath = ctx.projectPath || ''
    if (projectPath) {
      const pathPermissions = require('../../path-permissions')
      if (!pathPermissions.isInsideProject(projectPath, filePath)) {
        const ask = require('../../ask-permission')
        if (typeof ask.ensurePathPermission === 'function') {
          const perm = await ask.ensurePathPermission(
            'inspect_binary',
            { path: filePath },
            projectPath,
            ctx.resolvePath || (p => path.resolve(projectPath, p)),
            ctx.projectId,
            ctx.options || {}
          )
          if (perm && perm.success === false) return perm
        }
      }
    }
  } catch (_) { /* 权限模块不可用时不阻断项目内文件 */ }

  const stringLimit = Math.max(20, Math.min(500, Number(args.string_limit) || 200))
  const maxBytes = Math.max(64 * 1024, Math.min(MAX_READ_BYTES, Number(args.max_bytes) || MAX_READ_BYTES))

  try {
    const result = await inspectFile(filePath, { string_limit: stringLimit, max_bytes: maxBytes })
    if (!result.success) return result
    // 控制回传体积：节区细节保留，字符串样本已截断
    return {
      ...result,
      model_facing_hint: '根据 imports/sections/strings 解读行为线索；需要伪代码时请用户本机安装 Ghidra/r2，本工具不提供完整反编译。'
    }
  } catch (error) {
    return {
      success: false,
      error_type: 'inspect_failed',
      error: error.message || String(error),
      path: filePath
    }
  }
}

module.exports = {
  handlers: {
    inspect_binary
  }
}
