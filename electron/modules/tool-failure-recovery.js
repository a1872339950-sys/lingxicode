const { getCompositeRecoveryWriteTools } = require('./composite-tool-contracts')

const WRITE_TOOL_NAMES = new Set([
  'write_file',
  'edit_file',
  'text_edit',
  'apply_patch',
  'json_edit',
  'copy_file',
  'move_file',
  'delete_file',
  'create_file_session',
  'append_file_chunk',
  'finish_file_session',
  ...getCompositeRecoveryWriteTools()
])

const RECOVERY_GUIDANCE = {
  missing_path: '连续缺少必填路径。先用 code_inspect action=locate、file_search 或 file_read 确认具体文件路径，再继续；不要重复提交空 path。',
  not_a_file: '连续把目录当作文件。该路径不能用于文件读写；先用 file_search action=directory 或 glob 查看目录，再选择其中的具体文件。',
  invalid_arguments: '连续工具参数无效。请先整理为完整 JSON 对象，并确认所有必填字段；不要重复提交相同的残缺参数。'
}

function isToolFailure(result) {
  return !!result && result.success === false && !result.internal && !result.aborted
}

function getFailureKind(result = {}) {
  const errorType = String(result.error_type || result.code || '').toLowerCase()
  const error = String(result.error || result.message || '').toLowerCase()
  if (errorType === 'missing_path' || /(?:需要|missing|required).*path|path.*(?:未提供|empty|missing|required)/i.test(error)) return 'missing_path'
  if (errorType === 'not_a_file' || /resolved path is not a file|not a file/i.test(error)) return 'not_a_file'
  if (/invalid.*(?:argument|json)|参数.*(?:无效|不是合法|必须是)|tool_args_parse|json.*(?:parse|invalid)/i.test(`${errorType} ${error}`)) return 'invalid_arguments'
  return 'other_failure'
}

function createToolFailureRecoveryTracker() {
  let consecutiveFailures = 0
  const kindCounts = new Map()
  let writeRestricted = false
  let stopRequested = false

  function record(toolName, result) {
    if (result?.internal || result?.aborted) {
      return { kind: '', consecutiveFailures, kindCount: 0, writeRestricted, stopRequested, guidance: '' }
    }
    if (!isToolFailure(result)) {
      consecutiveFailures = 0
      kindCounts.clear()
      writeRestricted = false
      return { kind: '', consecutiveFailures, kindCount: 0, writeRestricted, stopRequested: false, guidance: '' }
    }

    const kind = getFailureKind(result)
    consecutiveFailures += 1
    for (const key of Array.from(kindCounts.keys())) {
      if (key !== kind) kindCounts.delete(key)
    }
    const kindCount = (kindCounts.get(kind) || 0) + 1
    kindCounts.set(kind, kindCount)

    if (kindCount >= 3 && (kind === 'missing_path' || kind === 'not_a_file' || kind === 'invalid_arguments')) {
      writeRestricted = true
    }
    if (consecutiveFailures >= 5) stopRequested = true

    return {
      kind,
      consecutiveFailures,
      kindCount,
      writeRestricted,
      stopRequested,
      guidance: kindCount >= 2 ? (RECOVERY_GUIDANCE[kind] || '') : ''
    }
  }

  function shouldBlock(toolName) {
    return writeRestricted && WRITE_TOOL_NAMES.has(String(toolName || ''))
  }

  function getBlockResult(toolName) {
    return {
      success: false,
      error_type: 'recovery_write_restricted',
      error: `连续工具参数错误后，${toolName} 暂时不可用。请先使用只读定位工具确认真实文件路径和参数。`,
      next_action: '先用 code_inspect action=locate、file_search 或 file_read 完成定位；成功读取后再继续编辑。'
    }
  }

  function getStopInstruction() {
    return '本轮已连续发生 5 次工具失败且没有成功工具结果。停止继续调用任何工具，基于已知错误简洁说明阻塞原因与需要用户补充的信息。'
  }

  function getStopBlockResult(toolName) {
    return {
      success: false,
      internal: true,
      error_type: 'recovery_tool_loop_stopped',
      error: `连续工具失败保护已生效，${toolName} 未被再次执行。`,
      next_action: '不要继续调用工具。请直接说明当前阻塞原因，以及继续处理所需的用户信息。'
    }
  }

  function isStopRequested() {
    return stopRequested
  }

  return { record, shouldBlock, getBlockResult, getStopBlockResult, getStopInstruction, isStopRequested }
}

module.exports = {
  createToolFailureRecoveryTracker,
  getFailureKind,
  isToolFailure
}
