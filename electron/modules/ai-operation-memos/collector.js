const path = require('path')
const memoPaths = require('./paths')

function countLines(text = '') {
  if (!text) return 0
  return String(text).split(/\r\n|\r|\n/).length
}

function splitLines(text = '') {
  if (!text) return []
  return String(text).split(/\r\n|\r|\n/)
}

function getFileText(file = {}, phase = 'before') {
  const textKey = phase === 'before' ? 'beforeText' : 'afterText'
  const contentKey = phase === 'before' ? 'beforeContent' : 'afterContent'
  if (typeof file[textKey] === 'string') return file[textKey]
  if (typeof file[contentKey] === 'string') return file[contentKey]
  return ''
}

function countChangedLines(beforeText = '', afterText = '') {
  const beforeLines = splitLines(beforeText)
  const afterLines = splitLines(afterText)
  const totalCells = beforeLines.length * afterLines.length
  if (totalCells > 250000) {
    return countChangedLineWindow(beforeLines, afterLines)
  }

  const dp = Array.from({ length: beforeLines.length + 1 }, () => new Uint32Array(afterLines.length + 1))
  for (let i = beforeLines.length - 1; i >= 0; i -= 1) {
    for (let j = afterLines.length - 1; j >= 0; j -= 1) {
      dp[i][j] = beforeLines[i] === afterLines[j]
        ? dp[i + 1][j + 1] + 1
        : Math.max(dp[i + 1][j], dp[i][j + 1])
    }
  }

  const unchanged = dp[0][0]
  return {
    additions: Math.max(0, afterLines.length - unchanged),
    deletions: Math.max(0, beforeLines.length - unchanged)
  }
}

function countChangedLineWindow(beforeLines = [], afterLines = []) {
  let prefix = 0
  while (prefix < beforeLines.length && prefix < afterLines.length && beforeLines[prefix] === afterLines[prefix]) {
    prefix += 1
  }

  let suffix = 0
  while (
    suffix < beforeLines.length - prefix &&
    suffix < afterLines.length - prefix &&
    beforeLines[beforeLines.length - 1 - suffix] === afterLines[afterLines.length - 1 - suffix]
  ) {
    suffix += 1
  }

  return {
    additions: Math.max(0, afterLines.length - prefix - suffix),
    deletions: Math.max(0, beforeLines.length - prefix - suffix)
  }
}

function estimateLineStats(file = {}) {
  const beforeText = getFileText(file, 'before')
  const afterText = getFileText(file, 'after')
  const beforeLines = countLines(beforeText)
  const afterLines = countLines(afterText)
  if (file.action === 'create' || file.existedBefore === false) return { additions: afterLines, deletions: 0 }
  if (file.action === 'delete' || file.existsAfter === false) return { additions: 0, deletions: beforeLines }
  if (!beforeText && !afterText) return { additions: 0, deletions: 0 }
  return countChangedLines(beforeText, afterText)
}

function calculateDurationMs(startedAt = '', completedAt = '') {
  const started = Date.parse(startedAt || '')
  const completed = Date.parse(completedAt || '')
  if (!Number.isFinite(started) || !Number.isFinite(completed) || completed < started) return 0
  return completed - started
}

function normalizeFileAction(file = {}) {
  if (file.action === 'create' || file.existedBefore === false) return 'created'
  if (file.action === 'delete' || file.existsAfter === false) return 'deleted'
  return 'modified'
}

function hasEffectiveFileChange(file = {}) {
  if (file.existedBefore === file.existsAfter && file.beforeHash && file.afterHash) {
    return file.beforeHash !== file.afterHash
  }
  if (file.existedBefore !== file.existsAfter) return true
  const beforeText = getFileText(file, 'before')
  const afterText = getFileText(file, 'after')
  if (beforeText || afterText) return beforeText !== afterText
  if (Number(file.beforeSize || 0) !== Number(file.afterSize || 0)) return true
  return false
}

function summarizeStats(files = []) {
  return files.reduce((acc, file) => {
    if (file.status === 'created') acc.created += 1
    else if (file.status === 'deleted') acc.deleted += 1
    else acc.modified += 1
    acc.additions += Number(file.additions || 0)
    acc.deletions += Number(file.deletions || 0)
    return acc
  }, { modified: 0, created: 0, deleted: 0, additions: 0, deletions: 0, outsideProjectOps: 0 })
}

function normalizeRawFiles(changeSession = {}) {
  if (Array.isArray(changeSession?.files)) return changeSession.files
  if (changeSession?.files && typeof changeSession.files === 'object') return Object.values(changeSession.files)
  return []
}

function normalizeProjectFilePath(projectPath = '', rawPath = '') {
  const value = String(rawPath || '').trim()
  if (!value) return null
  const absolutePath = path.isAbsolute(value) ? path.resolve(value) : path.resolve(projectPath, value)
  if (!memoPaths.isProjectBusinessPath(projectPath, absolutePath)) return null
  return {
    absolutePath,
    relativePath: memoPaths.getRelativeProjectPath(projectPath, absolutePath)
  }
}

function collectFiles(projectPath = '', changeSession = {}) {
  const rawFiles = normalizeRawFiles(changeSession)
  const files = []
  let outsideProjectOps = 0

  rawFiles.forEach(file => {
    const normalized = normalizeProjectFilePath(projectPath, file.path)
    if (!normalized) {
      if (file.path && !memoPaths.isInsidePath(projectPath, path.resolve(String(file.path || '')))) outsideProjectOps += 1
      return
    }
    if (!hasEffectiveFileChange(file)) return
    const lineStats = estimateLineStats(file)
    files.push({
      path: normalized.relativePath,
      absolutePath: normalized.absolutePath,
      status: normalizeFileAction(file),
      action: file.action || '',
      additions: lineStats.additions,
      deletions: lineStats.deletions,
      beforeSize: file.beforeSize || 0,
      afterSize: file.afterSize || 0,
      unsupported: !!(file.beforeUnsupported || file.afterUnsupported)
    })
  })

  files.sort((a, b) => a.path.localeCompare(b.path, 'zh-CN'))
  return { files, outsideProjectOps }
}

function toCleanList(value, limit = 12) {
  return (Array.isArray(value) ? value : [])
    .map(item => String(item || '').trim())
    .filter(Boolean)
    .slice(0, limit)
}

function normalizeModelChanges(projectPath = '', changes = []) {
  return (Array.isArray(changes) ? changes : [])
    .map(change => {
      const normalized = normalizeProjectFilePath(projectPath, change.path || change.file)
      if (!normalized) return null
      return {
        path: normalized.relativePath,
        module: String(change.module || change.moduleName || '').trim(),
        purpose: String(change.purpose || change.feature || change.summary || '').trim(),
        functions: toCleanList(change.functions, 16),
        lineRanges: toCleanList(change.line_ranges || change.lineRanges, 16),
        callChain: toCleanList(change.call_chain || change.callChain, 16),
        impact: toCleanList(change.impact, 16),
        caution: String(change.caution || change.risk || '').trim()
      }
    })
    .filter(Boolean)
}

function collectCommands(changeSession = {}) {
  return (Array.isArray(changeSession?.commands) ? changeSession.commands : [])
    .map(command => ({
      command: String(command.command || '').trim(),
      cwd: String(command.cwd || '').trim(),
      success: command.success !== false,
      exitCode: command.exitCode ?? null,
      commandKind: command.commandKind || '',
      mutatesFiles: command.mutatesFiles !== false,
      recordedAt: command.recordedAt || ''
    }))
    .filter(command => command.command)
}

function collectMutatingCommands(changeSession = {}) {
  return collectCommands(changeSession).filter(command => command.mutatesFiles !== false)
}

function deriveTitle(userMessage = '', files = [], modelTitle = '') {
  const title = String(modelTitle || '').replace(/\s+/g, ' ').trim()
  if (title) return title.length > 48 ? title.slice(0, 48) : title
  const text = String(userMessage || '').replace(/\s+/g, ' ').trim()
  if (text) return text.length > 42 ? text.slice(0, 42) + '...' : text
  if (files.length === 1) return `修改 ${files[0].path}`
  return `AI 操作 ${files.length} 个项目文件`
}

function normalizeModelMemo(options = {}, projectPath = '') {
  const source = options.modelMemo || options
  return {
    summary: String(source.summary || '').trim(),
    intent: String(source.intent || '').trim(),
    changes: normalizeModelChanges(projectPath, source.changes || []),
    verification: toCleanList(source.verification, 16),
    followUps: toCleanList(source.followUps || source.follow_ups, 12),
    uncertainty: toCleanList(source.uncertainty, 12)
  }
}

function collectMemoFacts(options = {}) {
  const projectPath = String(options.projectPath || options.changeSession?.projectPath || '').trim()
  if (!projectPath) return { shouldCreate: false, reason: 'missing_project_path' }

  const changeSession = options.changeSession || {}
  const { files, outsideProjectOps } = collectFiles(projectPath, changeSession)
  const commands = collectCommands(changeSession)
  const mutatingCommands = commands.filter(command => command.mutatesFiles !== false)
  const modelMemo = normalizeModelMemo(options, projectPath)
  if (!files.length && !modelMemo.changes.length && !mutatingCommands.length) {
    return {
      shouldCreate: false,
      reason: outsideProjectOps > 0 ? 'only_outside_project_changes' : 'no_project_file_changes',
      outsideProjectOps
    }
  }

  const completedAt = options.completedAt || new Date().toISOString()
  const startedAt = options.startedAt || options.changeSession?.startedAt || ''
  const explicitDuration = Number(options.durationMs || 0)
  const durationMs = explicitDuration > 0 ? explicitDuration : calculateDurationMs(startedAt, completedAt)
  const stats = summarizeStats(files)
  stats.outsideProjectOps = outsideProjectOps

  return {
    shouldCreate: true,
    projectId: options.projectId || options.changeSession?.projectId || '',
    projectPath,
    title: deriveTitle(options.userMessage, files, options.title),
    userMessage: String(options.userMessage || '').trim(),
    finalSummary: String(options.finalSummary || '').trim(),
    modelMemo,
    modelName: String(options.modelName || '').trim(),
    requestId: String(options.requestId || '').trim(),
    changeSessionId: options.changeSession?.id || '',
    startedAt,
    completedAt,
    durationMs,
    files,
    stats,
    commands,
    warnings: Array.isArray(options.changeSession?.warnings) ? options.changeSession.warnings : [],
    snapshot: options.changeSession?.gitSafety || null
  }
}

module.exports = {
  collectMemoFacts,
  normalizeModelChanges,
  collectFiles,
  collectCommands,
  collectMutatingCommands,
  summarizeStats
}
