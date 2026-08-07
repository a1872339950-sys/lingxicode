/**
 * 内部指令泄漏过滤
 * 从 ai-chat.js 提取，负责检测和清除模型输出中泄漏的内部工作流指令。
 *
 * 被 progress-narration.js 和 ai-chat.js 共同依赖。
 */

const INTERNAL_INSTRUCTION_LEAK_PATTERNS = [
  /内部(?:软提醒|质量门禁|工作流指令|指令|机制|提醒)/,
  /系统内部提醒/,
  /系统(?:内部)?(?:提醒|指令)/,
  /系统提示(?:词|规则|注入|消息|内容)/,
  /这是系统给你的执行控制指令/,
  /不是用户发言/,
  /最终回复(?:里)?禁止提到/,
  /最终回复不要提到这条内部提醒/,
  /最终质检未通过/,
  /统一工程工作流/,
  /工程证据账本/,
  /根据[^。\n]{0,80}(?:工作流|系统提醒|系统提示|代码地图|codemap|code\s*map)/i,
  /系统已用[^。\n]{0,80}代码地图/i,
  /代码地图(?:命中|候选|查询|路标|使用策略|规则)/i,
  /\bquery_code_map\b/i,
  /\bmap[a-z0-9_-]{6,}\b/i,
  /用户要求的是开发\/修改任务，但目前只完成了查看或分析/,
  /目前只完成了查看或分析，还没有实际修改文件/,
  /如果确实不应修改，必须基于文件证据说明原因/,
  /\binternal_next_instruction\b/i,
  /\bstart_final_reply\b/i,
  /\bshow_thinking_note\b/i,
  /最终回复标记/,
  /最终正文开始信号/
]

function hasInternalInstructionLeak(raw) {
  const text = String(raw || '').trim()
  return !!text && INTERNAL_INSTRUCTION_LEAK_PATTERNS.some(pattern => pattern.test(text))
}

function stripInternalInstructionLeaks(raw, options = {}) {
  let text = String(raw || '')
  if (!text) return ''

  text = text
    .replace(/【内部工作流指令】[\s\S]*?(?=\n{2,}|$)/g, ' ')
    .replace(/internal_next_instruction\s*:\s*[\s\S]*?(?=\n{2,}|$)/gi, ' ')

  if (options.preserveFormatting) {
    return text
      .split(/\r?\n/)
      .map(line => {
        if (!line.trim() || hasInternalInstructionLeak(line)) return ''
        return line
          .split(/(?<=[。！？!?])\s*/)
          .filter(sentence => sentence && !hasInternalInstructionLeak(sentence))
          .join(' ')
          .trimEnd()
      })
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
  }

  const cleanLines = text
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line && !hasInternalInstructionLeak(line))

  if (cleanLines.length === 0) return ''

  const cleanSentences = cleanLines
    .join('\n')
    .split(/(?<=[。！？!?])\s*/)
    .map(sentence => sentence.trim())
    .filter(sentence => sentence && !hasInternalInstructionLeak(sentence))

  return cleanSentences.join(' ').replace(/\s+/g, ' ').trim()
}

module.exports = {
  INTERNAL_INSTRUCTION_LEAK_PATTERNS,
  hasInternalInstructionLeak,
  stripInternalInstructionLeaks
}
