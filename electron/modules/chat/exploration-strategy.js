const modificationReroute = require('./modification-reroute')
const { safeJsonStringify } = require('./json-utils')

function normalizeToolPath(value = '') {
  return String(value || '').replace(/\\/g, '/').toLowerCase()
}

function getToolTargetPath(call = {}) {
  return call?.args?.path ||
    call?.args?.file_path ||
    call?.args?.filePath ||
    call?.result?.path ||
    call?.result?.resolved_path ||
    ''
}

function isCrossFileSearchCall(call = {}) {
  const name = String(call.name || '')
  // Old persisted runs can contain retired tool names; recognition here is
  // history compatibility only and does not expose or execute those tools.
  if (['locate_code', 'query_code_map', 'discover_code', 'search_project', 'grep_code', 'grep', 'glob', 'glob_files', 'find_references', 'code_inspect', 'file_search'].includes(name)) {
    if (name === 'code_inspect') {
      const action = String(call.args?.action || call.result?._tool_route?.action || '')
      return ['grep', 'locate', 'find_in_file', 'find_references'].includes(action) || !action
    }
    if (name === 'file_search') return true
    return true
  }
  if (!['run_command', 'shell_run'].includes(name)) return false
  const command = String(call.args?.command || call.args?.cmd || '')
  return /\b(rg|grep|findstr|select-string)\b|git\s+grep/i.test(command)
}

function isWriteLikeToolCall(call = {}) {
  return modificationReroute.WRITE_LIKE_TOOLS.has(String(call.name || modificationReroute.getToolCallName(call) || ''))
}

function isLargeEntryRead(call = {}) {
  if (call.name !== 'read_file') return false
  const targetPath = normalizeToolPath(getToolTargetPath(call))
  const lineCount = Number(call.result?.line_count || call.result?.total_lines || 0)
  return lineCount >= 1000 || /(^|\/)(app|index|main|server|router|routes|bootstrap|entry)\.(js|jsx|ts|tsx|mjs|cjs|html|css|py)$/i.test(targetPath)
}

function isEntryOrAssemblyPath(filePath = '') {
  const targetPath = normalizeToolPath(filePath)
  return /(^|\/)(app|index|main|server|router|routes|bootstrap|entry)\.(js|jsx|ts|tsx|mjs|cjs|html|css|py)$/i.test(targetPath)
}

function getReadContentSample(call = {}) {
  const result = call?.result || {}
  return [
    result.content,
    result.preview_head,
    result.preview_tail
  ].filter(Boolean).join('\n')
}

function hasAssemblyLayerSignals(call = {}) {
  if (call.name !== 'read_file') return false
  const targetPath = getToolTargetPath(call)
  if (!isEntryOrAssemblyPath(targetPath)) return false
  const sample = getReadContentSample(call)
  return /<script\b[^>]*\bsrc=|<link\b[^>]*\bhref=|\bimport\s+.+\s+from\s+['"]|\brequire\s*\(['"]|data-[\w-]+=|id=['"][\w-]+['"]|class=['"][^'"]+['"]/i.test(sample)
}

function getRecentEntryAssemblyDrift(toolCalls = []) {
  const recent = toolCalls.slice(-6)
  const reads = recent
    .filter(call => call?.name === 'read_file')
    .map(call => ({
      call,
      path: normalizeToolPath(getToolTargetPath(call)),
      assembly: hasAssemblyLayerSignals(call),
      largeEntry: isLargeEntryRead(call)
    }))
    .filter(item => item.path && (item.assembly || item.largeEntry))

  if (reads.length < 2) return null
  const paths = [...new Set(reads.map(item => item.path))]
  const assemblyCount = reads.filter(item => item.assembly).length
  if (assemblyCount === 0 && paths.length < 2) return null
  return { paths, assemblyCount, reads }
}

function getRecentRepeatedReadTarget(toolCalls = []) {
  const recent = toolCalls.slice(-6)
  const reads = recent
    .filter(call => call?.name === 'read_file')
    .map(call => ({
      call,
      path: normalizeToolPath(getToolTargetPath(call))
    }))
    .filter(item => item.path)

  const counts = new Map()
  for (const item of reads) {
    const current = counts.get(item.path) || { count: 0, call: item.call }
    current.count += 1
    current.call = item.call
    counts.set(item.path, current)
  }

  for (const [targetPath, info] of counts.entries()) {
    if (info.count >= 3 && isLargeEntryRead(info.call)) {
      return { path: targetPath, count: info.count, call: info.call }
    }
  }

  return null
}

function isFailedPreciseEdit(call = {}) {
  if (!['edit_file', 'delete_file'].includes(String(call.name || ''))) return false
  const result = call.result || {}
  if (result.success !== false && !result.error) return false
  const text = `${result.error || ''} ${result.error_type || ''} ${safeJsonStringify(result).slice(0, 1000)}`
  return /(old_content|not\s+found|no\s+match|does\s+not\s+contain|精准|匹配|未找到|找不到|不存在|没有找到)/i.test(text)
}

function getRecentPreciseEditFailure(toolCalls = []) {
  const recent = toolCalls.slice(-8)
  const failed = recent.filter(isFailedPreciseEdit)
  if (failed.length < 2) return null
  const paths = [...new Set(failed.map(call => normalizeToolPath(getToolTargetPath(call))).filter(Boolean))]
  return { count: failed.length, paths, last: failed[failed.length - 1] }
}

function extractSearchLiteral(command = '') {
  const text = String(command || '')
  const quoted = text.match(/["']([^"'|]{2,80})["']/)
  if (quoted) return quoted[1].trim()
  const rg = text.match(/\brg\b[^\n]*?\s([A-Za-z0-9_$.\-\u4e00-\u9fa5]{2,80})(?:\s|$)/i)
  if (rg) return rg[1].trim()
  return ''
}

function getRecentFragmentedSearch(toolCalls = []) {
  const searches = toolCalls.slice(-8)
    .filter(call => call?.name === 'run_command' || call?.name === 'shell_run' || call?.name === 'grep_code' || call?.name === 'search_project')
    .map(call => ({
      command: String(call.args?.command || call.args?.cmd || call.args?.pattern || call.args?.query || ''),
      result: call.result || {}
    }))
    .filter(item => item.command && (/\b(rg|grep|findstr|select-string)\b|git\s+grep/i.test(item.command) || item.command.length >= 2))

  if (searches.length < 2) return null
  const simpleSearches = searches.filter(item => {
    const literal = extractSearchLiteral(item.command)
    return literal && !/[|()]/.test(literal) && !/\b(rg|grep|findstr|select-string)\b/i.test(literal)
  })
  const literals = [...new Set(simpleSearches.map(item => extractSearchLiteral(item.command)).filter(Boolean))]
  const noHitCount = searches.filter(item => item.result?.success === false || item.result?.noMatches || item.result?.count === 0).length
  if (simpleSearches.length >= 2 && (literals.length >= 2 || noHitCount >= 2)) {
    return { count: searches.length, literals: literals.slice(0, 8), noHitCount }
  }
  return null
}

function buildExplorationStrategyNudge({ userMessage = '', toolCallsRecord = [], emittedKeys = new Set() } = {}) {
  if (!Array.isArray(toolCallsRecord) || toolCallsRecord.length < 2) return null

  const editFailure = getRecentPreciseEditFailure(toolCallsRecord)
  if (editFailure) {
    const key = `precise-edit-failed:${editFailure.paths.join('|') || editFailure.count}`
    if (!emittedKeys.has(key)) {
      return {
        key,
        content: [
          `内部提醒：最近多次精确编辑失败（${editFailure.paths.join('、') || editFailure.count}次）。`,
          '下一步：先用 read_file 读取目标文件命中点附近行段，或用 rg 搜 old_content 里的关键函数名，拿到最新内容再做小范围 edit_file。'
        ].filter(Boolean).join('\n')
      }
    }
  }

  if (toolCallsRecord.some(isWriteLikeToolCall)) return null

  const recent = toolCallsRecord.slice(-6)
  const fragmentedSearch = getRecentFragmentedSearch(toolCallsRecord)
  if (fragmentedSearch) {
    const key = `fragmented-search:${fragmentedSearch.literals.join('|') || fragmentedSearch.count}`
    if (!emittedKeys.has(key)) {
      const hardStopLine = fragmentedSearch.noHitCount >= 2
        ? '至少两次搜索无命中，不要再重复相同词；由模型重新提炼更具体的 UI 文案、DOM id、函数名、错误文本、文件名或路径片段，然后做一次事实搜索。'
        : '下一步做一次组合事实搜索，不要继续逐个词试探。'
      return {
        key,
        strategy_gate: hardStopLine,
        content: [
          `内部提醒：最近搜索较碎（已搜：${fragmentedSearch.literals.join('、') || fragmentedSearch.count}次）。`,
          hardStopLine,
          '命中后只读取相关小片段验证。'
        ].filter(Boolean).join('\n')
      }
    }
  }

  if (recent.some(isCrossFileSearchCall)) return null

  const userTerms = String(userMessage || '')
    .match(/[A-Za-z_$][\w$-]{2,}|[\u4e00-\u9fa5]{2,8}/g)
    ?.filter(Boolean)
    .slice(0, 10) || []
  const termHint = userTerms.length
    ? `可尝试的事实搜索词：${userTerms.join('、')}。`
    : '请从用户原话、DOM id、函数名、IPC/API 名、日志关键词里抽取 3-6 个搜索词。'

  const drift = getRecentEntryAssemblyDrift(toolCallsRecord)
  if (drift) {
    const key = `entry-assembly:${drift.paths.join('|')}`
    if (emittedKeys.has(key)) return null
    return {
      key,
      content: [
        `内部提醒：正在读入口/装配文件（${drift.paths.join('、')}），这些通常不是真实实现。`,
        '下一步：沿 import/require 引用读 features/components/modules 文件，或用具体符号、DOM id、文件名、路径片段做跨文件事实搜索。'
      ].join('\n')
    }
  }

  const repeated = getRecentRepeatedReadTarget(toolCallsRecord)
  if (!repeated) return null

  const key = `repeat-read:${repeated.path}`
  if (emittedKeys.has(key)) return null

  return {
    key,
    content: [
      `内部提醒：正在反复读取 ${repeated.path}，但最近几步没有新的跨文件定位证据。`,
      `下一步：优先换成更具体的事实关键词、DOM id、函数名、文件名或路径模式并行搜索；不要切回旧的自然语言候选入口。${termHint}`
    ].join('\n')
  }
}

module.exports = {
  normalizeToolPath,
  getToolTargetPath,
  isCrossFileSearchCall,
  isWriteLikeToolCall,
  isLargeEntryRead,
  isEntryOrAssemblyPath,
  getReadContentSample,
  hasAssemblyLayerSignals,
  getRecentEntryAssemblyDrift,
  getRecentRepeatedReadTarget,
  isFailedPreciseEdit,
  getRecentPreciseEditFailure,
  extractSearchLiteral,
  getRecentFragmentedSearch,
  buildExplorationStrategyNudge
}
