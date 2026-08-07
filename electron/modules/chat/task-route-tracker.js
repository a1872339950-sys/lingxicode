const path = require('path')
const taskLedger = require('../task-ledger')

function uniqueRouteList(items = [], limit = 40) {
  return [...new Set(items.filter(Boolean).map(item => String(item).trim()).filter(Boolean))].slice(0, limit)
}

function normalizeRoutePathValue(value = '', projectPath = '') {
  let filePath = String(value || '').trim()
  if (!filePath || /^(https?|data|file):/i.test(filePath)) return ''
  filePath = filePath.replace(/^["'`]+|["'`]+$/g, '').replace(/\\/g, '/')
  const normalizedProjectPath = String(projectPath || '').replace(/\\/g, '/').replace(/\/+$/, '')
  if (/^[a-z]:\//i.test(filePath) && normalizedProjectPath) {
    try {
      const relative = path.relative(normalizedProjectPath, filePath).replace(/\\/g, '/')
      if (relative && !relative.startsWith('..') && !path.isAbsolute(relative)) filePath = relative
    } catch { /* 路径计算失败 */ }
  }
  return filePath.replace(/^\.\/+/, '').replace(/\/{2,}/g, '/')
}

function collectRoutePaths(value, projectPath = '', output = [], depth = 0) {
  if (output.length >= 80 || depth > 4 || value == null) return output
  if (typeof value === 'string') {
    const text = value.length > 4000 ? value.slice(0, 4000) : value
    const matches = text.match(/[a-zA-Z]:[\\/][^"'`\r\n<>|]+|(?:[\w.@()-]+[\\/])+[\w.@() -]+\.[a-zA-Z0-9]{1,10}/g) || []
    for (const match of matches) {
      const normalized = normalizeRoutePathValue(match, projectPath)
      if (normalized && !/^(node_modules|\.git|dist|build|out)\//i.test(normalized)) output.push(normalized)
      if (output.length >= 80) break
    }
    return output
  }
  if (Array.isArray(value)) {
    for (const item of value.slice(0, 60)) collectRoutePaths(item, projectPath, output, depth + 1)
    return output
  }
  if (typeof value === 'object') {
    for (const [key, child] of Object.entries(value).slice(0, 80)) {
      if (/^(path|file|filePath|file_path|resolved_path|relativePath|target|targetPath|cwd)$/i.test(key) && typeof child === 'string') {
        const normalized = normalizeRoutePathValue(child, projectPath)
        if (normalized && !/^(node_modules|\.git|dist|build|out)\//i.test(normalized)) output.push(normalized)
      } else if (/^(files|paths|changedFiles|created|modified|deleted|rolledBack|results)$/i.test(key)) {
        collectRoutePaths(child, projectPath, output, depth + 1)
      }
      if (output.length >= 80) break
    }
  }
  return output
}

function getChangeSessionFiles(changeSession = {}, projectPath = '') {
  const files = changeSession?.files
  if (!files) return []
  const raw = Array.isArray(files)
    ? files
    : (typeof files === 'object' ? Object.values(files) : [])
  return uniqueRouteList(raw.map(item => normalizeRoutePathValue(item?.path || item?.filePath || item, projectPath)), 50)
}

function isSearchCommandText(command = '') {
  return /\b(rg|grep|findstr|select-string)\b|git\s+grep|Get-ChildItem/i.test(String(command || ''))
}

function isVerificationCommandText(command = '') {
  return /\b(node\s+--check|npm\s+run|npm\s+test|pnpm\s+test|yarn\s+test|pytest|vitest|jest|playwright|tsc|eslint|go\s+test|cargo\s+test|verify:changed)\b/i.test(String(command || ''))
}

function buildTaskRouteRecord({ userMessage = '', finalSummary = '', toolCallsRecord = [], changeSession = null, projectPath = '' } = {}) {
  const routeFiles = []
  const routeTools = []
  const searchQueries = []
  const verification = []

  for (const call of Array.isArray(toolCallsRecord) ? toolCallsRecord : []) {
    const name = String(call?.name || '')
    if (name) routeTools.push(name)
    routeFiles.push(...collectRoutePaths(call?.args, projectPath))
    routeFiles.push(...collectRoutePaths(call?.result, projectPath))
    if (name === 'locate_code' || name === 'discover_code' || name === 'search_project' || name === 'grep_code') {
      const query = call?.args?.query || call?.args?.pattern || call?.result?.query || call?.result?.expandedQuery
      if (query) searchQueries.push(String(query))
    }
    if (name === 'run_command' || name === 'shell_run') {
      const command = String(call?.args?.command || call?.args?.cmd || '')
      if (isSearchCommandText(command)) searchQueries.push(command)
      if (isVerificationCommandText(command)) {
        const status = call?.result?.success === false ? 'failed' : 'passed'
        const exitCode = call?.result?.exitCode ?? call?.result?.exit_code
        verification.push(`${status}${exitCode == null ? '' : ` exit:${exitCode}`} | ${command}`)
      }
    }
  }

  const changedFiles = getChangeSessionFiles(changeSession || {}, projectPath)
  const summaryParts = []
  if (searchQueries.length) summaryParts.push(`搜索路线：${uniqueRouteList(searchQueries, 3).join(' | ')}`)
  const priorityFiles = uniqueRouteList([...changedFiles, ...routeFiles], 12)
  if (priorityFiles.length) summaryParts.push(`相关文件：${priorityFiles.join(', ')}`)
  if (verification.length) summaryParts.push(`验证：${uniqueRouteList(verification, 3).join(' | ')}`)
  if (!summaryParts.length && finalSummary) summaryParts.push(String(finalSummary).replace(/\s+/g, ' ').slice(0, 260))

  return {
    userRequest: userMessage,
    routeSummary: summaryParts.join('\n').slice(0, 900),
    routeKeywords: taskLedger.extractRouteKeywords([
      userMessage,
      finalSummary,
      ...routeFiles,
      ...changedFiles,
      ...searchQueries
    ].join('\n'), 100),
    routeFiles: uniqueRouteList(routeFiles, 50),
    changedFiles,
    routeTools: uniqueRouteList(routeTools, 30),
    searchQueries: uniqueRouteList(searchQueries, 12),
    verification: uniqueRouteList(verification, 12)
  }
}

function canAcceptNoWriteResult(content = '') {
  return /(不需要修改|无需修改|没有可修改|无法修改|不能修改|缺少|找不到|不存在|权限|用户选择暂停|已暂停|需要你确认|等待确认)/i.test(String(content || ''))
}

module.exports = {
  uniqueRouteList,
  normalizeRoutePathValue,
  collectRoutePaths,
  getChangeSessionFiles,
  isSearchCommandText,
  isVerificationCommandText,
  buildTaskRouteRecord,
  canAcceptNoWriteResult
}
