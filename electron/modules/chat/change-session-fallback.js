const path = require('path')

const FINAL_REPLY_TOOL_STATUS_PATTERNS = [
  /用户拒绝调用视觉模型/,
  /未读取图片视觉内容/,
  /已跳过视觉模型调用/,
  /用户选择暂停或不执行/,
  /无法显示视觉模型授权弹窗/
]

function isToolStatusOnlyFinalContent(content = '') {
  const text = String(content || '').trim()
  if (!text) return true
  return FINAL_REPLY_TOOL_STATUS_PATTERNS.some(pattern => pattern.test(text)) && text.length < 180
}

function isReviewOnlyFinalContent(content = '') {
  const text = String(content || '').trim()
  if (!text) return false
  if (!/^(补充|复查结论|验证结论|未发现额外问题|纯数值调整|JavaScript\s+变量赋值语法正确)/.test(text)) return false
  return !/(已修改|已修复|改成|调整了|新增|删除|移除|创建|写入)/.test(text)
}

function actionLabel(action) {
  if (action === 'create') return '新增'
  if (action === 'delete') return '删除'
  return '修改'
}

function fileBaseName(filePath = '') {
  return path.basename(String(filePath || '')) || String(filePath || '')
}

function buildChangeSessionFinalFallback(userMessage, changeSession, toolCalls = []) {
  const lines = []
  const files = Array.isArray(changeSession?.files) ? changeSession.files : []
  const changedFiles = files.filter(file => file?.path)
  const commandCount = changeSession?.commandCount || 0
  const mutatingCommandCount = Number(changeSession?.mutatingCommandCount || 0)
  const readOnlyCommandCount = Number(changeSession?.readOnlyCommandCount || Math.max(0, commandCount - mutatingCommandCount) || 0)
  const failedCalls = toolCalls.filter(call => {
    if (call?.result?.noMatches === true) return false
    return call?.result?.success === false || call?.result?.error
  })

  if (failedCalls.length > 0) {
    const failed = failedCalls.slice(-3).map(call => {
      const reason = call.result?.error || call.result?.message || '执行失败'
      const errorType = call.result?.error_type || ''
      // 根据错误类型给出针对性修复建议
      let fixHint = ''
      if (errorType === 'command_timeout') {
        fixHint = '（超时：改用 terminal_run 或缩小命令范围）'
      } else if (errorType === 'command_not_available') {
        fixHint = '（命令不存在：改用 code_inspect action=locate 或 shell_run）'
      } else if (errorType === 'wrong_verification_tool') {
        fixHint = '（验证工具错误：改用 check_syntax）'
      } else if (errorType === 'not_a_file' || errorType === 'not_found') {
        fixHint = '（路径无效：先用 code_inspect action=locate 或 file_search 定位正确路径）'
      } else if (/old_content|not\s+found|no\s+match|未找到|找不到/i.test(reason)) {
        fixHint = '（匹配失败：先 read_file 读取当前内容再编辑）'
      }
      return `${call.name}: ${reason}${fixHint}`
    })
    return [
      '本轮执行遇到工具错误，任务未完整完成。',
      '失败工具：',
      failed.join('\n'),
      '',
      '如需继续：请根据上述错误原因调整策略后重新发送请求；已成功的改动会保留。'
    ].join('\n')
  }

  if (changedFiles.length > 0) {
    const listed = changedFiles.slice(0, 4).map(file => `${actionLabel(file.action)} ${fileBaseName(file.path)}`)
    const extra = changedFiles.length > listed.length ? ` 等 ${changedFiles.length} 个文件` : ''
    lines.push(`已处理：${listed.join('、')}${extra}。`)
  } else if (toolCalls.some(call => ['write_file', 'edit_file', 'delete_file', 'create_directory'].includes(call.name))) {
    lines.push('检测到写入/编辑类工具调用，但未能确认文件改动；请查看上方工具结果。')
  }

  const ranVerification = toolCalls.some(call => {
    if (call.name !== 'run_command') return false
    const command = String(call.args?.command || '')
    return /(node\s+--check|tsc|npm|pnpm|yarn|test|build|lint|eslint|pytest|cargo\s+test|go\s+test)/i.test(command)
  })
  if (ranVerification && changedFiles.length > 0) {
    lines.push('已跑过相关检查，未发现新的语法错误。')
  } else if (mutatingCommandCount > 0 && changedFiles.length > 0) {
    lines.push('已执行必要命令辅助确认结果。')
  }

  const toolStatus = [...toolCalls].reverse()
    .find(call => call.result?.status === 'user_rejected' && call.result?.message)
  if (toolStatus) {
    lines.push(`${toolStatus.result.message} 后续处理已按非视觉信息继续。`)
  }

  if (lines.length === 0) {
    // Recognize retired read-only calls when summarizing an old persisted run.
    if (readOnlyCommandCount > 0 || toolCalls.some(call => ['read_file', 'list_files', 'query_code_map'].includes(call.name))) {
      lines.push('本轮只完成了查看和定位，但没有收到模型的有效最终结论。')
    } else {
      lines.push('未收到模型的有效最终回复。可能是模型中断、上游没有返回正文，或工具链提前结束；请查看上方工具状态后重新发送。')
    }
  }

  return lines.join('\n')
}

function ensureUsableFinalContent(content, { userMessage, changeSession, toolCalls }) {
  const text = String(content || '').trim()
  if (!isToolStatusOnlyFinalContent(text) && !isReviewOnlyFinalContent(text)) return text

  const fallback = buildChangeSessionFinalFallback(userMessage, changeSession, toolCalls)
  if (!text || isToolStatusOnlyFinalContent(text)) return fallback
  return `${fallback}\n\n${text}`
}

module.exports = {
  isToolStatusOnlyFinalContent,
  isReviewOnlyFinalContent,
  actionLabel,
  fileBaseName,
  buildChangeSessionFinalFallback,
  ensureUsableFinalContent
}
