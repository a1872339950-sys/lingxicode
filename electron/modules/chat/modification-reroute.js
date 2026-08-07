const { isChangeIntent } = require('./intent-safety')
const { isInternalUiOnlyToolName } = require('../chat-helpers')
const { parseToolCallArgs: parseToolCallArgsSafely } = require('../tool-args-parser')

// These sets also classify tool calls restored from old persisted runs. Retired
// names here are compatibility markers, not executable or model-visible tools.
const NAVIGATION_FIRST_TOOLS = new Set(['locate_code', 'query_code_map', 'discover_code', 'search_project', 'grep_code', 'find_references'])
const MANUAL_LOCATION_TOOLS = new Set(['read_file', 'read_many_files', 'find_in_file', 'list_files', 'glob_files'])
const SEARCH_COMMAND_TOOLS = new Set(['shell_run'])
const WRITE_LIKE_TOOLS = new Set(['write_file', 'edit_file', 'text_edit', 'apply_patch', 'json_edit', 'delete_file', 'copy_file', 'move_file', 'create_directory', 'render_svg_asset'])
const PRECISE_MODIFICATION_TOOLS = new Set(['edit_file', 'text_edit', 'apply_patch', 'json_edit', 'delete_file', 'copy_file', 'move_file'])
const EDIT_GROUNDING_TOOLS = new Set(['read_file', 'read_many_files', 'find_in_file', 'locate_code', 'query_code_map', 'discover_code', 'search_project', 'grep_code', 'find_references', 'git_diff'])

function getToolCallName(call = {}) {
  return String(call?.function?.name || call?.name || '')
}

function parseToolCallArgs(call = {}) {
  return parseToolCallArgsSafely(call, { fallback: {} }).args
}

function hasExplicitSingleFileTarget(message = '') {
  const text = String(message || '')
  if (/[a-zA-Z]:[\\/][^"'`\r\n<>|]+\.[a-zA-Z0-9]{1,10}/.test(text)) return true
  if (/(?:^|[\s"'`(（])(?:\.{0,2}[\\/])?(?:[\w.@()-]+[\\/])+[\w.@() -]+\.[a-zA-Z0-9]{1,10}(?:\b|$)/.test(text)) return true
  if (/(?:打开|读取|查看|修改|编辑|删除|新建|创建).{0,16}\b[\w.@()-]+\.(?:js|ts|tsx|jsx|css|html|json|md|py|cs|java|go|rs|vue|svelte)\b/i.test(text)) return true
  return false
}

function hasWriteToolCall(toolCalls = []) {
  // 延迟 require 以避免与 exploration-strategy.js 形成循环依赖
  const { isWriteLikeToolCall } = require('./exploration-strategy')
  return toolCalls.some(isWriteLikeToolCall)
}

function shouldRerouteManualLocationFirst(toolCalls = [], toolCallsRecord = [], userMessage = '') {
  return false
  const { isWriteLikeToolCall } = require('./exploration-strategy')
  const realCalls = (Array.isArray(toolCalls) ? toolCalls : [])
    .map(getToolCallName)
    .filter(name => name && !isInternalUiOnlyToolName(name))
  if (!realCalls.length) return false
  if (realCalls.some(name => NAVIGATION_FIRST_TOOLS.has(name))) return false
  if ((Array.isArray(toolCalls) ? toolCalls : []).some(call => isSearchCommandCall(call))) return false
  if (toolCallsRecord.some(call => NAVIGATION_FIRST_TOOLS.has(String(call?.name || '')) || isPriorSearchCommandRecord(call))) return false
  if (hasExplicitSingleFileTarget(userMessage) && realCalls.every(name => ['read_file', 'find_in_file', 'git_diff'].includes(name))) return false
  return (Array.isArray(toolCalls) ? toolCalls : []).some(call => isManualLocationOrSearchCall(call))
}

function isSearchCommandCall(call = {}) {
  const name = getToolCallName(call)
  if (!SEARCH_COMMAND_TOOLS.has(name)) return false
  const args = parseToolCallArgs(call)
  const command = String(args.command || args.cmd || '')
  return /\b(rg|grep|findstr|select-string|ls|dir|Get-ChildItem)\b|git\s+grep/i.test(command)
}

function isPriorSearchCommandRecord(call = {}) {
  const name = String(call?.name || call?.function?.name || '')
  if (!SEARCH_COMMAND_TOOLS.has(name)) return false
  const command = String(call?.args?.command || call?.args?.cmd || call?.command || '')
  return /\b(rg|grep|findstr|select-string|ls|dir|Get-ChildItem)\b|git\s+grep/i.test(command)
}

function isManualLocationOrSearchCall(call = {}) {
  const name = getToolCallName(call)
  if (MANUAL_LOCATION_TOOLS.has(name)) return true
  if (['locate_code', 'discover_code', 'search_project', 'grep_code', 'find_references'].includes(name)) return true
  return isSearchCommandCall(call)
}

function buildNavigationFirstRerouteInstruction(toolCalls = [], userMessage = '') {
  return [
    '内部导航提醒：工具只提供事实证据，不提供候选判断。',
    '由模型把用户需求转换成具体 UI 文案、DOM id、函数名、错误文本、文件名或路径片段后再做并行搜索。',
    '命中多个路径时，优先读取少量关键片段并核对真实加载入口；不要沿第一条搜索结果盲改。'
  ].join('\n')
}

function isSourceLikePath(value = '') {
  const text = String(value || '')
  return /\.(js|jsx|ts|tsx|mjs|cjs|css|scss|sass|less|html|htm|vue|svelte|json|jsonc|py|java|cs|go|rs|php|rb|swift|kt|kts|sh|ps1|bat|cmd|yml|yaml|toml)$/i.test(text)
}

function collectToolArgPaths(value, output = [], depth = 0) {
  if (output.length >= 40 || depth > 4 || value == null) return output
  if (typeof value === 'string') {
    const matches = value.match(/[a-zA-Z]:[\\/][^"'`\r\n<>|]+|(?:[\w.@()-]+[\\/])+[\w.@() -]+\.[a-zA-Z0-9]{1,10}|[\w.@()-]+\.[a-zA-Z0-9]{1,10}/g) || []
    for (const match of matches) {
      if (isSourceLikePath(match)) output.push(match.replace(/\\/g, '/').replace(/^\.\/+/, ''))
      if (output.length >= 40) break
    }
    return output
  }
  if (Array.isArray(value)) {
    for (const item of value) collectToolArgPaths(item, output, depth + 1)
    return output
  }
  if (typeof value === 'object') {
    for (const item of Object.values(value)) collectToolArgPaths(item, output, depth + 1)
  }
  return output
}

function getModificationTargetPaths(toolCalls = []) {
  const paths = []
  for (const call of Array.isArray(toolCalls) ? toolCalls : []) {
    const name = getToolCallName(call)
    if (!WRITE_LIKE_TOOLS.has(name)) continue
    const args = parseToolCallArgs(call)
    collectToolArgPaths(args, paths)
    if (name === 'apply_patch') {
      const patch = String(args.patch || '')
      const patchPaths = patch.match(/^\*\*\* (?:Add|Update|Delete) File:\s+(.+)$/gm) || []
      for (const line of patchPaths) {
        const target = line.replace(/^\*\*\* (?:Add|Update|Delete) File:\s+/, '').trim()
        if (isSourceLikePath(target)) paths.push(target.replace(/\\/g, '/'))
      }
    }
  }
  return [...new Set(paths)].slice(0, 20)
}

function hasPriorEditGrounding(toolCallsRecord = []) {
  return (Array.isArray(toolCallsRecord) ? toolCallsRecord : []).some(call => {
    const name = String(call?.name || '')
    if (EDIT_GROUNDING_TOOLS.has(name)) return true
    if (name === 'shell_run') {
      const command = String(call?.args?.command || call?.args?.cmd || '')
      return /\b(rg|grep|findstr|select-string)\b|git\s+grep|\bnode\s+--check\b|\bnpm\s+run\b/i.test(command)
    }
    return false
  })
}

function hasDirectUserProvidedEdit(message = '', toolCalls = []) {
  if (!hasExplicitSingleFileTarget(message)) return false
  const text = String(message || '')
  const hasConcreteReplacement = /(把|将).{1,120}(改成|替换成|换成)|old_content|new_content|```[\s\S]{20,}```/i.test(text)
  if (!hasConcreteReplacement) return false
  return (Array.isArray(toolCalls) ? toolCalls : []).some(call => {
    const name = getToolCallName(call)
    if (!['edit_file', 'text_edit', 'json_edit'].includes(name)) return false
    const args = parseToolCallArgs(call)
    return !!(args.path || args.file_path || args.filePath)
  })
}

function shouldReroutePrematureModification(toolCalls = [], toolCallsRecord = [], userMessage = '') {
  return false
  const realCalls = (Array.isArray(toolCalls) ? toolCalls : [])
    .filter(call => {
      const name = getToolCallName(call)
      return name && !isInternalUiOnlyToolName(name)
    })
  if (!realCalls.length) return false
  if (!realCalls.some(call => PRECISE_MODIFICATION_TOOLS.has(getToolCallName(call)))) return false
  if (hasPriorEditGrounding(toolCallsRecord)) return false
  if (realCalls.some(call => NAVIGATION_FIRST_TOOLS.has(getToolCallName(call)))) return false
  if (hasDirectUserProvidedEdit(userMessage, realCalls)) return false

  const targetPaths = getModificationTargetPaths(realCalls)
  if (!isChangeIntent(userMessage) && !targetPaths.some(isSourceLikePath)) return false
  return true
}

function buildPrematureModificationRerouteInstruction(toolCalls = [], userMessage = '') {
  return [
    '内部修改预检：写入前需要当前源码和影响面证据。',
    '不要调用自然语言候选定位；由模型自行提炼具体关键词、DOM id、函数名、错误文本、文件名或路径片段并行搜索。',
    '证据足够后读取少量关键片段，再做最小修改。'
  ].join('\n')
}

function getVisibleRealToolCalls(toolCalls = []) {
  return (Array.isArray(toolCalls) ? toolCalls : []).filter(call => {
    const name = getToolCallName(call)
    return name && !isInternalUiOnlyToolName(name)
  })
}

function shouldSplitLargeToolBatch(toolCalls = []) {
  return false
}

function shouldSplitToolSectionBatch(toolCalls = [], currentSectionToolCount = 0) {
  return false
}

function normalizeTargetToken(value = '') {
  return String(value || '')
    .replace(/\\/g, '/')
    .replace(/^\.\/+/, '')
    .toLowerCase()
    .trim()
}

function collectStatusTargetPaths(status = '') {
  const paths = []
  collectToolArgPaths(String(status || ''), paths)
  return [...new Set(paths.map(normalizeTargetToken).filter(Boolean))]
}

function collectToolTargetPaths(toolCalls = []) {
  const paths = []
  for (const call of getVisibleRealToolCalls(toolCalls)) {
    const args = parseToolCallArgs(call)
    collectToolArgPaths(args, paths)
  }
  return [...new Set(paths.map(normalizeTargetToken).filter(Boolean))]
}

function targetsOverlap(statusTargets = [], toolTargets = []) {
  if (!statusTargets.length || !toolTargets.length) return true
  return statusTargets.some(statusTarget => toolTargets.some(toolTarget => {
    return statusTarget === toolTarget ||
      statusTarget.endsWith(`/${toolTarget}`) ||
      toolTarget.endsWith(`/${statusTarget}`) ||
      pathBasename(statusTarget) === pathBasename(toolTarget)
  }))
}

function pathBasename(value = '') {
  const parts = normalizeTargetToken(value).split('/')
  return parts[parts.length - 1] || ''
}

function isFinalReplyLikeStatus(status = '') {
  return /(最终|总结|回复|答复|交付|收尾|完成回复|准备回复|final\s*reply|final\s*answer)/i.test(String(status || ''))
}

function shouldRerouteToolStatusMismatch(toolCalls = [], progressStatus = '') {
  const realCalls = getVisibleRealToolCalls(toolCalls)
  if (!realCalls.length || !progressStatus) return false
  if (isFinalReplyLikeStatus(progressStatus)) return true

  const statusTargets = collectStatusTargetPaths(progressStatus)
  if (!statusTargets.length) return false
  const toolTargets = collectToolTargetPaths(realCalls)
  if (!toolTargets.length) return false
  return !targetsOverlap(statusTargets, toolTargets)
}

function buildToolStatusMismatchInstruction(toolCalls = [], progressStatus = '') {
  const statusTargets = collectStatusTargetPaths(progressStatus)
  const toolTargets = collectToolTargetPaths(toolCalls)
  return [
    '内部一致性提醒：刚才的公开短状态和随后真实工具调用明显不一致。',
    progressStatus ? `短状态是：${String(progressStatus).slice(0, 180)}` : '',
    statusTargets.length ? `短状态提到的目标：${statusTargets.slice(0, 8).join('、')}。` : '',
    toolTargets.length ? `工具实际目标：${toolTargets.slice(0, 8).join('、')}。` : '',
    '请重新输出一句准确的公开短状态，并重新调用与这句状态一致的真实工具；如果你其实准备最终回复，就不要再调用真实工具。不要在最终回复里提到这条内部提醒。'
  ].filter(Boolean).join('\n')
}

module.exports = {
  NAVIGATION_FIRST_TOOLS,
  MANUAL_LOCATION_TOOLS,
  SEARCH_COMMAND_TOOLS,
  WRITE_LIKE_TOOLS,
  PRECISE_MODIFICATION_TOOLS,
  EDIT_GROUNDING_TOOLS,
  hasWriteToolCall,
  getToolCallName,
  parseToolCallArgs,
  hasExplicitSingleFileTarget,
  shouldRerouteManualLocationFirst,
  buildNavigationFirstRerouteInstruction,
  isSearchCommandCall,
  isManualLocationOrSearchCall,
  isSourceLikePath,
  collectToolArgPaths,
  getModificationTargetPaths,
  hasPriorEditGrounding,
  hasDirectUserProvidedEdit,
  shouldReroutePrematureModification,
  buildPrematureModificationRerouteInstruction,
  getVisibleRealToolCalls,
  shouldSplitLargeToolBatch,
  shouldSplitToolSectionBatch,
  collectStatusTargetPaths,
  collectToolTargetPaths,
  shouldRerouteToolStatusMismatch,
  buildToolStatusMismatchInstruction
}
