/**
 * 进度叙事处理
 * 从 ai-chat.js 提取，负责：
 *   - 进度状态解析（[[状态: ...]] 标记）
 *   - 进度叙事文本规范化、去重
 *   - 公开进度句筛选与评分
 *   - 工具参数流/进度叙事追踪器（兼容接口）
 *
 * 依赖：internal-instruction-filter
 */

const { hasInternalInstructionLeak, stripInternalInstructionLeaks } = require('./internal-instruction-filter')

function getVisibleProgressLength(value = '') {
  return String(value || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/[#>*_`|~\s,，:：;；.!！?？。、"'“”‘’()[\]{}<>《》]+/g, '')
    .trim()
    .length
}

function isUserRequestRestatement(raw) {
  const text = String(raw || '').replace(/\s+/g, ' ').trim()
  if (!text) return false
  const normalized = text
    .replace(/^["'“”‘’]+|["'“”‘’]+$/g, '')
    .replace(/^[的了嘛呢吧呀,，。；：\s]+/, '')
    .trim()
  return /^(用户|对方|他|她|ta|TA)(?:这次|当前|现在|主要)?(?:想|想要|想了解|希望|需要|问|问的是|询问|要求|让|提到|说的是|关注的是)/.test(normalized)
}

function isNonProgressNarration(raw) {
  const text = String(raw || '').replace(/\s+/g, ' ').trim()
  if (!text) return true
  const normalized = text
    .replace(/^["'“”‘’]+|["'“”‘’]+$/g, '')
    .replace(/^[的了嘛呢吧呀,，。；：\s)）]+/, '')
    .trim()
  if (!normalized) return true
  if (isUserRequestRestatement(normalized)) return true
  if (/^(?:遵守情况|执行情况|检查清单|完成清单|自检|约束确认|注意事项)/.test(normalized)) return true
  if (/^(?:我没|我没有|未创建|未修改|未写入|没有创建|没有写入)/.test(normalized)) return true
  if (/[✓✔✅✗✘❌]/.test(normalized)) return true
  if (/^(?:现在)?我(?:已经|已|大致|基本)?(?:了解|知道|明白|看出|看到|确认了?|记住)(?:了)?/.test(normalized)) return true
  if (/^(?:现在)?我(?:可以|能|会|打算|准备)?(?:尝试|试试)?(?:换一个?思路|换个思路|另一个思路)/.test(normalized)) return true
  if (/^(?:我可以|可以)(?:使用|直接|创建|通过|尝试|改为|选择)/.test(normalized)) return true
  if (/(?:我不知道|无法|不能|不行|没法).{0,80}(?:用户|你|手动|自己|自行)/.test(normalized)) return true
  if (/(?:告诉|提醒|让).{0,20}(?:用户|你).{0,20}(?:手动|自己|自行)/.test(normalized)) return true
  return false
}

const PUBLIC_PROGRESS_ACTION_RE = /(检查|创建|执行|验证|读取|读|查看|分析|调用|打开|运行|审查|修复|编辑|写入|搜索|定位|确认|设计|实现|排查|核对|对齐|收窄|清理|恢复|保留|补|改|测|跑|看|找|查|修)/
const PUBLIC_PROGRESS_FINDING_RE = /(关键点|定位方向|问题|根因|原因|边界|结论|发现|看起来|已经定位|定位到|确认到|判断|修法|补丁|风险|回归|验证结果|状态残留|生命周期|运行态|完成态|持久化|复活|误判)/
const PUBLIC_PROGRESS_TECH_RE = /\b(?:DOM|CSS|HTML|JS|API|Git|IPC|runtime|snapshot|history|reload|switch|ensure|cache|state|status|done|final|stream|reasoning|tool|branch|project)\b/i
const PRIVATE_THOUGHT_ONLY_RE = /^(?:我)?(?:在想|觉得|感觉|猜测|纠结|犹豫|可能|也许|大概|应该是?可以|可以考虑|理论上|原则上)/
const PUBLIC_PROGRESS_MAX_LENGTH = Number.POSITIVE_INFINITY

function isPublicProgressSentence(raw) {
  const text = String(raw || '').replace(/\s+/g, ' ').trim()
  if (!text) return false
  if (/[✓✔✅✗✘❌]/.test(text)) return false
  if (hasInternalInstructionLeak(text)) return false
  if (isNonProgressNarration(text)) return false
  if (isUserRequestRestatement(text)) return false
  if (PRIVATE_THOUGHT_ONLY_RE.test(text) && !PUBLIC_PROGRESS_FINDING_RE.test(text)) return false
  if (getVisibleProgressLength(text) <= 10) return false
  return PUBLIC_PROGRESS_FINDING_RE.test(text) ||
    PUBLIC_PROGRESS_ACTION_RE.test(text) ||
    (PUBLIC_PROGRESS_TECH_RE.test(text) && /(确认|定位|修复|清理|恢复|切换|完成|运行|状态|边界|误判|验证|测试)/.test(text))
}

function getPublicProgressScore(raw) {
  const text = String(raw || '')
  let score = 0
  if (PUBLIC_PROGRESS_FINDING_RE.test(text)) score += 5
  if (PUBLIC_PROGRESS_ACTION_RE.test(text)) score += 3
  if (PUBLIC_PROGRESS_TECH_RE.test(text)) score += 2
  if (/^(?:我先|先|现在|接下来|关键点|定位方向|这里|这次)/.test(text)) score += 1
  if (text.length > 220) score -= 1
  return score
}

function selectPublicProgressSummary(sentences = []) {
  const candidates = sentences
    .filter(isPublicProgressSentence)
    .map((text, index) => ({ text, index, score: getPublicProgressScore(text) }))

  if (!candidates.length) return ''

  const best = candidates.reduce((winner, item) => {
    if (!winner) return item
    if (item.score !== winner.score) return item.score > winner.score ? item : winner
    return item.index < winner.index ? item : winner
  }, null)

  return best.text
}

function isProgressInlineToken(value = '') {
  const text = String(value || '').trim()
  if (!text || text.length > 96) return false
  if (/[\\/]/.test(text) && /\.[a-z0-9]{1,8}\b/i.test(text)) return true
  if (/^[a-zA-Z_$][\w$]*(?:\.[a-zA-Z_$][\w$]*|\([^)]*\))$/.test(text)) return true
  if (/^[a-zA-Z_$][\w$]*[A-Z][\w$]*$/.test(text)) return true
  if (/^[a-zA-Z_$][\w$]*(?:_[a-zA-Z0-9]+)+$/.test(text)) return true
  return false
}

function isToolLogLikeProgress(raw = '') {
  const text = normalizeProgressPunctuation(String(raw || '')).replace(/\s+/g, ' ').trim()
  if (!text) return false
  const toolNames = /\b(?:code_inspect|file_read|file_search|code_verify|runtime_verify|shell_run|apply_patch|text_edit|edit_file|write_file|json_edit|git_diff|lxweb)\b/i
  if (toolNames.test(text)) return true
  if (/\b[\w.@$-]+\.(?:js|jsx|ts|tsx|css|html|json|vue|svelte|mjs|cjs|py|cs|java|go|rs|php|md)\s*[:：]\s*\d+\b/i.test(text)) return true
  if (/\b\d+(?:\s*[-~至到]\s*\d+)?(?:\s*[、,，]\s*\d+(?:\s*[-~至到]\s*\d+)?)+\s*行\b/.test(text)) return true
  if (/\b\d+\s*[-~至到]\s*\d+\s*行\b/.test(text)) return true
  if (/(?:整文件读|整文件读取|全文读|全文读取|按行号|行段|关键段|精确读取|读取关键|读关键|按行读取)/.test(text)) return true
  if (/(?:调用签名|函数签名|方法签名|参数签名|方法列表|实际导出|导出的方法名|只暴露\s*\d+\s*个方法|暴露了?\s*\d+\s*个方法)/.test(text)) return true
  if (/(?:正则|regex|RegExp|文件内查找|查找代码).{0,80}(?:\\[bBdDsSwW]|[|^$*+?]{2,})/i.test(text)) return true
  if (/\b(?:const|let|var|function|class|return|import|export)\s+[A-Za-z_$][\w$]*(?:\s*[=(:]|\b)/.test(text)) return true
  if (/[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)+\s*\([^)]*\)/.test(text)) return true
  if (/[A-Za-z_$][\w$]*\s*\([^)]*,[^)]*\)/.test(text)) return true
  if (/(?:0\s*行有异常|0\s*(?:行|个)?(?:命中|结果)|多次\s*0\s*命中)/.test(text)) return true
  if (/^(?:读|读取|查看)\s+[`"']?[\w.@()/-]+\.[a-z0-9]{1,8}/i.test(text)) return true
  if (/^(?:执行|运行|调用|使用)\s*(?:命令|工具|grep|rg|findstr|find_in_file|shell_run)\b/i.test(text)) return true
  if (/^(?:查找代码|文件内查找|搜索)\s*[-:：]\s*/i.test(text)) return true
  if (/(?:多次|反复)?\s*0\s*(?:命中|结果)\b/.test(text) && /\b(?:find_in_file|grep|搜索|查找|读取)\b/i.test(text)) return true
  if (/\b(?:grep|rg|findstr)\s+[-"'`\\/\w.*|()]+/i.test(text)) return true
  return false
}

function stripProgressNaturalLanguageQuotes(text = '') {
  return String(text || '').replace(/["“”]([^"“”\n]{2,96})["“”]/g, (match, inner) => {
    const token = String(inner || '').trim()
    return isProgressInlineToken(token) ? match : token
  })
}

function softenProgressPunctuation(raw = '') {
  let text = stripProgressNaturalLanguageQuotes(raw)
    .replace(/[✓✔✅✗✘❌]/g, ' ')
    .replace(/(^|[。！？!?]\s*)[-*•]\s+/g, '$1')
    .replace(/\s*(?:->|=>|→|⇒)\s*/g, '，')
    .replace(/\s*(?:——+|--+)\s*/g, '，')
    .replace(/（([^（）]{1,48})）/g, (match, inner) => {
      const token = String(inner || '').trim()
      if (!token || isProgressInlineToken(token)) return match
      return `，${token}，`
    })
    .replace(/\(([^()]{1,48})\)/g, (match, inner) => {
      const token = String(inner || '').trim()
      if (!token || isProgressInlineToken(token)) return match
      if (/[\u4e00-\u9fa5]/.test(token)) return `，${token}，`
      return match
    })
    .replace(/[!！]{2,}/g, '！')
    .replace(/[?？]{2,}/g, '？')
    .replace(/[。]{2,}/g, '。')
    .replace(/[，,]{2,}/g, '，')
    .replace(/\s*([，。！？；：,.!?;:])\s*/g, '$1')
    .replace(/，([。！？；])/g, '$1')
    .replace(/([：:])([。！？；，,])/g, '$2')
    .replace(/([，。！？；：,.!?;:])\1+/g, '$1')
    .replace(/，\s*，/g, '，')
    .trim()

  return text
    .replace(/^[，,；;：:\s]+/, '')
    .replace(/[：:]\s*$/, '')
    .replace(/[，,；;]\s*$/, '')
    .trim()
}

function normalizeProgressPunctuation(raw) {
  return softenProgressPunctuation(raw)
    .replace(/\s+([，。！？；：,.!?;:])/g, '$1')
    .replace(/([（【《])\s+/g, '$1')
    .replace(/\s+([）】》])/g, '$1')
    .replace(/([\u4e00-\u9fa5])\s+([\u4e00-\u9fa5])/g, '$1$2')
    .replace(/[：:]\s*$/, '')
    .replace(/[，,；;]\s*$/, '')
    .trim()
}

function normalizeProgressStatus(raw) {
  let text = String(raw || '').replace(/\s+/g, ' ').trim()
  if (!text) return ''
  if (hasInternalInstructionLeak(text)) return ''
  if (isToolLogLikeProgress(text)) return ''
  text = text.replace(/^["'“”]+|["'“”]+$/g, '').trim()
  text = stripInternalInstructionLeaks(text)
  if (!text) return ''
  text = summarizeProgressText(text)
  if (isToolLogLikeProgress(text)) return ''
  if (isNonProgressNarration(text)) return ''
  if (isUserRequestRestatement(text)) return ''
  if (getVisibleProgressLength(text) <= 10) return ''
  return normalizeProgressPunctuation(text)
}

function normalizeProgressNarration(raw, options = {}) {
  let text = String(raw || '').replace(/\r\n/g, '\n').replace(/[ \t]+/g, ' ').trim()
  if (!text) return ''
  if (hasInternalInstructionLeak(text)) {
    text = stripInternalInstructionLeaks(text)
    if (!text) return ''
  }
  text = text.replace(/\[\[\s*(?:状态|status)\s*[:：]\s*([\s\S]*?)\]\]/gi, '$1')
  text = text.replace(/\n{3,}/g, '\n\n').trim()
  text = text
    .split('\n')
    .map(line => line.replace(/^[\s,，:：;；.!！?？。、·*•\-—\d"'“”‘’()[\]{}<>《》)）]+/, '').trim())
    .map(line => line.replace(/[✓✔✅✗✘❌]/g, ' ').replace(/\s+/g, ' ').trim())
    .filter(line => !hasInternalInstructionLeak(line))
    .filter(line => /[\p{L}\p{N}\u4e00-\u9fa5]/u.test(line))
    .filter(Boolean)
    .join('\n')
  text = stripInternalInstructionLeaks(text)
  if (!text) return ''
  text = summarizeProgressText(text, options)
  if (isToolLogLikeProgress(text)) return ''
  if (isNonProgressNarration(text)) return ''
  if (isUserRequestRestatement(text)) return ''
  if (getVisibleProgressLength(text) <= 10) return ''
  return normalizeProgressPunctuation(text)
}

function clipProgressSentence(text, maxLength = PUBLIC_PROGRESS_MAX_LENGTH) {
  const value = String(text || '').trim()
  if (!Number.isFinite(Number(maxLength))) return value
  if (!value || value.length <= maxLength) return value

  const limited = value.slice(0, maxLength)
  const sentenceEnd = Math.max(
    limited.lastIndexOf('。'),
    limited.lastIndexOf('！'),
    limited.lastIndexOf('？'),
    limited.lastIndexOf('!'),
    limited.lastIndexOf('?')
  )
  if (sentenceEnd >= Math.floor(maxLength * 0.45)) {
    return limited.slice(0, sentenceEnd + 1).trim()
  }

  const clauseEnd = Math.max(
    limited.lastIndexOf('，'),
    limited.lastIndexOf('；'),
    limited.lastIndexOf(';'),
    limited.lastIndexOf(',')
  )
  if (clauseEnd >= Math.floor(maxLength * 0.55)) {
    return `${limited.slice(0, clauseEnd).trim()}。`
  }

  return `${limited.trimEnd()}。`
}

function compactPublicProgressText(text, maxLength = PUBLIC_PROGRESS_MAX_LENGTH) {
  const value = normalizeProgressPunctuation(text)
  if (!Number.isFinite(Number(maxLength))) return value
  if (!value || getVisibleProgressLength(value) <= maxLength) return value

  const limited = value.slice(0, maxLength)
  const sentenceEnd = Math.max(
    limited.lastIndexOf('。'),
    limited.lastIndexOf('！'),
    limited.lastIndexOf('？'),
    limited.lastIndexOf('!'),
    limited.lastIndexOf('?')
  )
  if (sentenceEnd >= Math.floor(maxLength * 0.35)) {
    return normalizeProgressPunctuation(limited.slice(0, sentenceEnd + 1))
  }

  const clauseEnd = Math.max(
    limited.lastIndexOf('，'),
    limited.lastIndexOf('；'),
    limited.lastIndexOf(';'),
    limited.lastIndexOf(',')
  )
  if (clauseEnd >= Math.floor(maxLength * 0.45)) {
    return `${normalizeProgressPunctuation(limited.slice(0, clauseEnd))}。`
  }

  return `${normalizeProgressPunctuation(limited)}。`
}

function summarizeProgressText(raw, options = {}) {
  let text = String(raw || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/[#*`|~]+/g, ' ')
    .replace(/[┌┐└┘│─├┤┬┴┼]+/g, ' ')
    .replace(/[✓✔✅✗✘❌]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[\s,，:：;；.!！?？。、"'“”‘’()[\]{}<>《》]+/, '')
    .trim()

  if (!text) return ''
  text = stripInternalInstructionLeaks(text)
  if (!text) return ''
  if (!/[\p{L}\p{N}\u4e00-\u9fa5]/u.test(text)) return ''

  const sentences = text
    .split(/(?<=[。！？!?])\s*/)
    .map(item => item.replace(/^[\s,，:：;；.!！?？。、"'“”‘’()[\]{}<>《》]+/, '').trim())
    .filter(item => !hasInternalInstructionLeak(item))
    .filter(item => /[\p{L}\p{N}\u4e00-\u9fa5]/u.test(item))
    .filter(Boolean)

  const publicSummary = selectPublicProgressSummary(sentences)
  if (!publicSummary) return ''

  let summary = publicSummary
  if (isNonProgressNarration(summary)) return ''
  if (isUserRequestRestatement(summary)) return ''
  summary = summary
    .replace(/\s+/g, ' ')
    .replace(/^[\s,，:：;；.!！?？。、"'“”‘’()[\]{}<>《》]+/, '')
    .trim()
  if (!/[\p{L}\p{N}\u4e00-\u9fa5]/u.test(summary)) return ''
  summary = compactPublicProgressText(clipProgressSentence(summary, PUBLIC_PROGRESS_MAX_LENGTH))
  if (getVisibleProgressLength(summary) <= 10) return ''
  return summary
}

function getProgressSimilarityKey(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\u4e00-\u9fa5]+/gu, '')
    .replace(/^(现在|接下来|继续|准备|开始|先|再|然后|正在)+/g, '')
    .replace(/(一下|文件|结构|基础|内容|代码|逻辑|部分|进行|开始|创建|构建|写入|编写|实现|处理|检查|查看|读取|验证|执行|工具|调用|相关|当前|这个|那个)/g, '')
    .slice(0, 36)
}

function areProgressStatusesSimilar(a, b) {
  if (!a || !b) return false
  const aKey = getProgressSimilarityKey(a)
  const bKey = getProgressSimilarityKey(b)
  if (!aKey || !bKey) return false
  if (aKey === bKey) return true
  if (aKey.length >= 8 && bKey.length >= 8 && (aKey.includes(bKey) || bKey.includes(aKey))) return true
  const prefixLen = Math.min(aKey.length, bKey.length, 12)
  return prefixLen >= 8 && aKey.slice(0, prefixLen) === bKey.slice(0, prefixLen)
}

function readPartialJsonStringField(rawValue, fieldNames = []) {
  const raw = String(rawValue || '')
  for (const fieldName of fieldNames) {
    const pattern = new RegExp(`"${String(fieldName).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"\\s*:\\s*"`, 'g')
    const match = pattern.exec(raw)
    if (!match) continue
    let value = ''
    let escaped = false
    for (let index = match.index + match[0].length; index < raw.length; index++) {
      const char = raw[index]
      if (!escaped) {
        if (char === '"') return { value, complete: true }
        if (char === '\\') {
          escaped = true
          continue
        }
        value += char
        continue
      }
      escaped = false
      if (char === 'n') value += '\n'
      else if (char === 'r') value += '\r'
      else if (char === 't') value += '\t'
      else if (char === 'b') value += '\b'
      else if (char === 'f') value += '\f'
      else if (char === 'u') {
        const code = raw.slice(index + 1, index + 5)
        if (/^[0-9a-fA-F]{4}$/.test(code)) {
          value += String.fromCharCode(parseInt(code, 16))
          index += 4
        }
      } else {
        value += char
      }
    }
    return { value, complete: false }
  }
  return { value: '', complete: false }
}

function countStreamTextLines(value = '') {
  const text = String(value || '')
  if (!text) return 0
  return text.split(/\r\n|\r|\n/).length
}

function getStreamingPatchStats(patch = '') {
  const lines = String(patch || '').split(/\r\n|\r|\n/)
  let path = ''
  let addedLines = 0
  let removedLines = 0
  for (const line of lines) {
    const pathMatch = line.match(/^\*\*\*\s+(?:Add|Update|Delete)\s+File:\s*(.+?)\s*$/i)
    if (!path && pathMatch) path = pathMatch[1].trim()
    if (line.startsWith('+') && !line.startsWith('+++')) addedLines++
    else if (line.startsWith('-') && !line.startsWith('---')) removedLines++
  }
  return { path, addedLines, removedLines }
}

function getStreamingToolArgumentProgress(toolCall = {}) {
  const name = String(toolCall?.function?.name || '')
  const raw = String(toolCall?.function?.arguments || '')
  const id = String(toolCall?.id || '')
  if (!name || !id || !raw) return null

  const pathField = readPartialJsonStringField(raw, ['path', 'file_path', 'target_path'])
  if (name === 'apply_patch') {
    const patchField = readPartialJsonStringField(raw, ['patch'])
    const stats = getStreamingPatchStats(patchField.value)
    return {
      toolCallId: id,
      name,
      path: stats.path || pathField.value,
      addedLines: stats.addedLines,
      removedLines: stats.removedLines,
      receivedChars: patchField.value.length
    }
  }

  if (['write_file', 'create_file_session', 'append_file_chunk', 'finish_file_session', 'file_write_session'].includes(name)) {
    const contentField = readPartialJsonStringField(raw, ['content', 'chunk', 'text'])
    return {
      toolCallId: id,
      name,
      path: pathField.value,
      addedLines: countStreamTextLines(contentField.value),
      removedLines: 0,
      receivedChars: contentField.value.length
    }
  }
  return null
}

function createToolArgumentProgressTracker(webContents, projectId, options = {}) {
  // 工具参数在模型端生成时就驱动同一张工具卡；这些事件只属于运行态 UI，
  // 不写入消息历史，也不回传给模型。
  const states = new Map()
  const minEmitGapMs = 90

  function emit(toolCall, force = false) {
    const progress = getStreamingToolArgumentProgress(toolCall)
    if (!progress) return
    const key = progress.toolCallId
    const previous = states.get(key) || {
      emitted: false,
      at: 0,
      path: '',
      addedLines: -1,
      removedLines: -1,
      receivedChars: -1,
      complete: false
    }
    const now = Date.now()
    const changed = previous.path !== progress.path ||
      previous.addedLines !== progress.addedLines ||
      previous.removedLines !== progress.removedLines ||
      previous.receivedChars !== progress.receivedChars ||
      (force && !previous.complete)
    if (!changed) return
    if (!force && previous.emitted && now - previous.at < minEmitGapMs &&
      Math.abs(progress.addedLines - previous.addedLines) < 4 &&
      progress.receivedChars - previous.receivedChars < 512) {
      return
    }
    states.set(key, {
      emitted: true,
      at: now,
      path: progress.path,
      addedLines: progress.addedLines,
      removedLines: progress.removedLines,
      receivedChars: progress.receivedChars,
      complete: !!force
    })
    webContents?.send('tool-argument-progress', {
      projectId,
      chatSessionId: options.chatSessionId || '',
      ...progress,
      complete: !!force
    })
  }

  return {
    update(toolCall) {
      emit(toolCall, false)
    },
    complete(toolCall) {
      emit(toolCall, true)
    }
  }
}

function createProgressNarrationTracker(webContents, projectId, options = {}) {
  // 保留接口以兼容旧流程，但不再从普通正文猜测/生成思考块。
  // 思考块由模型输出的 [[状态: ...]] 公开过程正文通过 createProgressStatusParser 驱动。
  return {
    append() {},
    flush() {},
    markFromText() {},
    hasProgress() { return false },
    getLastNarration() { return '' }
  }
}

function isProcessOnlyContinuationText(raw) {
  const text = String(raw || '').replace(/\s+/g, ' ').trim()
  if (!text) return false
  if (text.length > 800) return false

  const intentionPatterns = [
    /(让我|我先|接下来|下一步|现在我|同时我|然后我|继续|再).{0,40}(收集|等待|查看|检查|读取|打开|运行|执行|调用|派发|启动|审查|查询)/,
    /(先|继续|再).{0,20}(收集|等待|查看|检查|读取|查询)/,
    /还有.{0,30}(未完成|没完成|在运行|等待|其他).{0,30}(Agent|子\s*Agent|任务)/i,
    /(收集|等待|检查|查询).{0,30}(Agent|子\s*Agent|状态|结果)/i,
    /(还缺|缺少|没有|未).{0,20}(证据|验证|质检|检查|复查|确认|上下文|结果)/,
    /(继续|需要|必须).{0,30}(补齐|补查|验证|检查|复查|确认|读取|查看|执行|运行|总结)/,
    /(补齐|补查|验证|检查|复查|确认).{0,30}(再|后).{0,10}(总结|回复|结束)/,
    /(不能|不要|不应|不该).{0,20}(结束|总结|直接总结|停止)/,
    /(还没|尚未|未完成|没完成).{0,30}(完成|结束|验证|检查|复查|确认|总结)/
  ]

  const finalPatterns = [
    /^(结论|总结|审查结果|修复结果|完成情况)[:：]/,
    /(已经|已)(完成|修复|检查完|审查完)/,
    /(没有发现|发现以下|问题如下|风险如下|验证通过)/
  ]

  if (finalPatterns.some(pattern => pattern.test(text)) && !/让我|我先|继续|等待|收集/.test(text)) {
    return false
  }

  return intentionPatterns.some(pattern => pattern.test(text))
}

function findPendingProgressMarkerStart(text) {
  const index = text.lastIndexOf('[[')
  if (index < 0) return -1
  const tail = text.slice(index).toLowerCase()
  if (tail.includes(']]')) return -1
  const prefixes = ['[[', '[[ ', '[[状', '[[状态', '[[状态:', '[[状态：', '[[s', '[[st', '[[sta', '[[stat', '[[statu', '[[status', '[[status:']
  return prefixes.some(prefix => tail.startsWith(prefix)) ? index : -1
}

function createProgressStatusParser(onStatus) {
  let buffer = ''
  let lastStatus = ''
  let hasStatus = false
  const recentStatuses = []
  const markerPattern = /\[\[\s*(?:状态|status)\s*[:：]\s*([\s\S]*?)\]\]/i

  function emitStatus(raw) {
    const status = normalizeProgressStatus(raw)
    if (!status || status === lastStatus || areProgressStatusesSimilar(status, lastStatus)) return
    if (hasInternalInstructionLeak(status)) return
    if (recentStatuses.some(item => areProgressStatusesSimilar(status, item))) return
    recentStatuses.push(status)
    if (recentStatuses.length > 8) recentStatuses.shift()
    lastStatus = status
    hasStatus = true
    onStatus(status)
  }

  function process(chunk) {
    buffer += String(chunk || '')
    let content = ''

    while (buffer) {
      const match = buffer.match(markerPattern)
      if (match) {
        content += buffer.slice(0, match.index)
        emitStatus(match[1])
        buffer = buffer.slice(match.index + match[0].length)
        continue
      }

      const pendingStart = findPendingProgressMarkerStart(buffer)
      if (pendingStart >= 0) {
        content += buffer.slice(0, pendingStart)
        buffer = buffer.slice(pendingStart)
      } else {
        content += buffer
        buffer = ''
      }
      break
    }

    return content
  }

  function flush() {
    const content = buffer
    buffer = ''
    return content
  }

  function hasEmittedStatus() {
    return hasStatus
  }

  function getLastStatus() {
    return lastStatus
  }

  function resetLastStatus() {
    lastStatus = ''
  }

  return { process, flush, hasEmittedStatus, getLastStatus, resetLastStatus, emitStatus }
}

module.exports = {
  getVisibleProgressLength,
  isUserRequestRestatement,
  isNonProgressNarration,
  isPublicProgressSentence,
  getPublicProgressScore,
  selectPublicProgressSummary,
  isProgressInlineToken,
  isToolLogLikeProgress,
  stripProgressNaturalLanguageQuotes,
  softenProgressPunctuation,
  normalizeProgressPunctuation,
  normalizeProgressStatus,
  normalizeProgressNarration,
  clipProgressSentence,
  compactPublicProgressText,
  summarizeProgressText,
  getProgressSimilarityKey,
  areProgressStatusesSimilar,
  createToolArgumentProgressTracker,
  createProgressNarrationTracker,
  isProcessOnlyContinuationText,
  findPendingProgressMarkerStart,
  createProgressStatusParser
}
