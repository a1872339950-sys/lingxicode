function getToolTargetText(call = {}) {
  const args = call.args || {}
  const parts = [
    call.name,
    args.path,
    args.file,
    args.cwd,
    args.command,
    args.html_path,
    args.htmlPath,
    args.target
  ]
  return parts.filter(Boolean).join('\n').replace(/\\/g, '/').toLowerCase()
}

function hasTouchedPreviousChangeDomain(toolCalls = [], changedPaths = []) {
  const normalizedPaths = changedPaths
    .map(filePath => String(filePath || '').replace(/\\/g, '/').toLowerCase())
    .filter(Boolean)
  if (!normalizedPaths.length) return false

  return toolCalls.some(call => {
    if (!['read_file', 'file_read', 'edit_file', 'write_file', 'delete_file', 'file_manage', 'run_command', 'shell_run', 'runtime_verify'].includes(call.name)) {
      return false
    }
    const targetText = getToolTargetText(call)
    return normalizedPaths.some(filePath => {
      const fileName = filePath.split('/').pop()
      return targetText.includes(filePath) || (!!fileName && targetText.includes(fileName))
    })
  })
}

function buildPreviousChangeFollowupNudge(diagnosticContext, toolCalls = [], finalContent = '') {
  if (!diagnosticContext?.enabled) return ''
  if (!hasTouchedPreviousChangeDomain(toolCalls, diagnosticContext.changedPaths)) {
    return [
      '内部质量门禁：用户反馈的是上一轮交付后的错误，本轮还没有触达上一轮改动文件。',
      '下一步必须先围绕上一轮变更域反推：读取或比对上一轮改动文件、删改片段、删改符号、入口接线和初始化顺序；不要先全项目泛扫，也不要先截图确认现象。',
      '最终回复禁止提到内部质量门禁。'
    ].join('\n')
  }

  const text = String(finalContent || '')
  if (!/(上一轮|上次|刚才|之前|改动|删除|移除|新增|修改|导致|根因|原因|排除)/.test(text)) {
    return [
      '内部质量门禁：这是上一轮变更域反推任务，最终回复还没有说明上一轮哪个删改点导致问题，或为什么已排除上一轮改动。',
      '请基于已读的上一轮改动文件继续定位并短回复：发现什么问题、改了什么；验证失败或仍有风险时再补一句。',
      '最终回复禁止提到内部质量门禁。'
    ].join('\n')
  }

  return ''
}

/**
 * 生成工具结果摘要（用于历史保存，减少上下文膨胀）
 * @param {string} toolName 工具名称
 * @param {object} result 完整结果
 * @returns {object} 摘要结果
 */
function summarizePostEditDiagnostics(diagnostics) {
  if (!diagnostics || typeof diagnostics !== 'object') return undefined
  return {
    ok: diagnostics.ok,
    requires_fix: diagnostics.requires_fix,
    blocking: diagnostics.blocking,
    checked_count: diagnostics.checked_count,
    checked_files: Array.isArray(diagnostics.checked_files) ? diagnostics.checked_files.slice(0, 12) : [],
    passed_files: Array.isArray(diagnostics.passed_files) ? diagnostics.passed_files.slice(0, 12) : [],
    failed_files: Array.isArray(diagnostics.failed_files)
      ? diagnostics.failed_files.slice(0, 8).map(item => ({
        path: item.relative_path || item.path,
        language: item.language,
        errors: Array.isArray(item.errors) ? item.errors.slice(0, 4) : [],
        read_hint: item.read_hint || null,
        code_frame: item.code_frame || null
      }))
      : [],
    unknown_files: Array.isArray(diagnostics.unknown_files)
      ? diagnostics.unknown_files.slice(0, 6).map(item => ({
        path: item.relative_path || item.path,
        errors: Array.isArray(item.errors) ? item.errors.slice(0, 2) : []
      }))
      : [],
    diagnostic_warnings: Array.isArray(diagnostics.diagnostic_warnings)
      ? diagnostics.diagnostic_warnings.slice(0, 6).map(item => ({
        path: item.path || item.relative_path || '',
        message: item.message || ''
      }))
      : [],
    read_hints: Array.isArray(diagnostics.read_hints) ? diagnostics.read_hints.slice(0, 8) : [],
    code_frames: Array.isArray(diagnostics.code_frames) ? diagnostics.code_frames.slice(0, 8) : [],
    next_action: diagnostics.next_action,
    message: diagnostics.message
  }
}

module.exports = {
  getToolTargetText,
  hasTouchedPreviousChangeDomain,
  buildPreviousChangeFollowupNudge,
  summarizePostEditDiagnostics
}
