/**
 * 文本编辑工具处理器
 * 包含：text_edit, apply_patch, json_edit 工具及相关辅助函数
 */

const fs = require('fs')
const path = require('path')
const changeSessions = require('../change-sessions')
const { toProjectRelative } = require('../path-utils')
const {
  countLines, findFlexibleTextRange, buildTextEditDiagnostics, applyTextEditList
} = require('../text-edit-utils')
const { ensureSafetyBaselineBeforeWrite } = require('./git-safety')
const { safelyRecordChange } = require('./file-ops')
const { attachPostEditDiagnostics, capturePostEditRuntimeBaseline } = require('./diagnostics')
const { buildPathFailureResult } = require('./search')

async function pathExists(filePath) {
  try {
    await fs.promises.access(filePath)
    return true
  } catch {
    return false
  }
}

function parseApplyPatch(patchText = '') {
  const raw = String(patchText || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  const lines = raw.split('\n')
  const firstMeaningful = lines.findIndex(line => line.trim())
  if (firstMeaningful < 0 || lines[firstMeaningful].trim() !== '*** Begin Patch') {
    throw new Error('apply_patch 缺少 *** Begin Patch')
  }

  const operations = []
  let i = firstMeaningful + 1
  while (i < lines.length) {
    const line = lines[i]
    if (line.trim() === '*** End Patch') break

    if (line.startsWith('*** Add File: ')) {
      const filePath = line.slice('*** Add File: '.length).trim()
      if (!filePath) throw new Error('Add File 缺少路径')
      i += 1
      const contentLines = []
      while (i < lines.length && !lines[i].startsWith('*** ')) {
        if (!lines[i].startsWith('+')) throw new Error(`Add File ${filePath} 中的内容行必须以 + 开头`)
        contentLines.push(lines[i].slice(1))
        i += 1
      }
      operations.push({ type: 'add', path: filePath, content: contentLines.join('\n') })
      continue
    }

    if (line.startsWith('*** Delete File: ')) {
      const filePath = line.slice('*** Delete File: '.length).trim()
      if (!filePath) throw new Error('Delete File 缺少路径')
      operations.push({ type: 'delete', path: filePath })
      i += 1
      continue
    }

    if (line.startsWith('*** Update File: ')) {
      const filePath = line.slice('*** Update File: '.length).trim()
      if (!filePath) throw new Error('Update File 缺少路径')
      i += 1
      let moveTo = ''
      const hunks = []
      let oldLines = []
      let newLines = []
      const flushHunk = () => {
        if (!oldLines.length && !newLines.length) return
        hunks.push({ oldText: oldLines.join('\n'), newText: newLines.join('\n') })
        oldLines = []
        newLines = []
      }
      while (i < lines.length && !lines[i].startsWith('*** Update File: ') && !lines[i].startsWith('*** Add File: ') && !lines[i].startsWith('*** Delete File: ') && lines[i].trim() !== '*** End Patch') {
        const hunkLine = lines[i]
        if (hunkLine.startsWith('*** Move to: ')) {
          moveTo = hunkLine.slice('*** Move to: '.length).trim()
        } else if (hunkLine.startsWith('@@')) {
          flushHunk()
        } else if (hunkLine === '*** End of File') {
          // Marker accepted for Codex-style patch compatibility.
        } else if (hunkLine.startsWith(' ')) {
          oldLines.push(hunkLine.slice(1))
          newLines.push(hunkLine.slice(1))
        } else if (hunkLine.startsWith('-')) {
          oldLines.push(hunkLine.slice(1))
        } else if (hunkLine.startsWith('+')) {
          newLines.push(hunkLine.slice(1))
        } else if (!hunkLine.trim()) {
          oldLines.push('')
          newLines.push('')
        } else {
          throw new Error(`Update File ${filePath} 中存在无法识别的补丁行: ${hunkLine.slice(0, 80)}`)
        }
        i += 1
      }
      flushHunk()
      operations.push({ type: 'update', path: filePath, moveTo, hunks })
      continue
    }

    if (!line.trim()) {
      i += 1
      continue
    }
    throw new Error(`无法识别的补丁段: ${line.slice(0, 80)}`)
  }

  if (!lines.some(line => line.trim() === '*** End Patch')) {
    throw new Error('apply_patch 缺少 *** End Patch')
  }
  if (!operations.length) throw new Error('apply_patch 没有任何文件操作')
  return operations
}

function ensureTextPatchTarget(filePath) {
  const ext = path.extname(filePath).toLowerCase()
  const blocked = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.ico', '.bmp', '.mp3', '.wav', '.mp4', '.mov', '.zip', '.7z', '.rar', '.pdf', '.docx', '.pptx', '.xlsx'])
  if (blocked.has(ext)) {
    throw new Error(`apply_patch 不处理二进制文件: ${filePath}`)
  }
}

async function applyTextPatchOperations(operations, resolvePath, projectId, projectPath) {
  const touched = []
  const recordBefore = async (filePath, action) => {
    if (projectId) await safelyRecordChange(() => changeSessions.recordFileBeforeAsync(projectId, filePath, action))
  }
  const recordAfter = async (filePath, action) => {
    if (projectId) await safelyRecordChange(() => changeSessions.recordFileAfterAsync(projectId, filePath, action))
  }

  const affectedPaths = []
  for (const op of operations) {
    affectedPaths.push(resolvePath(op.path))
    if (op.moveTo) affectedPaths.push(resolvePath(op.moveTo))
  }
  await ensureSafetyBaselineBeforeWrite(projectId, projectPath, affectedPaths)

  for (const op of operations) {
    const filePath = resolvePath(op.path)
    ensureTextPatchTarget(filePath)

    if (op.type === 'add') {
      if (await pathExists(filePath)) throw new Error(`文件已存在，无法 Add File: ${op.path}`)
      await recordBefore(filePath, 'create')
      await fs.promises.mkdir(path.dirname(filePath), { recursive: true })
      await fs.promises.writeFile(filePath, op.content, 'utf-8')
      await recordAfter(filePath, 'create')
      touched.push({ action: 'add', path: filePath, line_count: countLines(op.content) })
      continue
    }

    if (op.type === 'delete') {
      if (!await pathExists(filePath)) throw new Error(`文件不存在，无法 Delete File: ${op.path}`)
      ensureTextPatchTarget(filePath)
      await recordBefore(filePath, 'delete')
      await fs.promises.unlink(filePath)
      await recordAfter(filePath, 'delete')
      touched.push({ action: 'delete', path: filePath })
      continue
    }

    if (op.type === 'update') {
      if (!await pathExists(filePath)) throw new Error(`文件不存在，无法 Update File: ${op.path}`)
      const content = await fs.promises.readFile(filePath, 'utf-8')
      const hunks = Array.isArray(op.hunks) ? op.hunks : []
      if (!hunks.length && !op.moveTo) throw new Error(`Update File ${op.path} 缺少可匹配的上下文`)
      let nextContent = content
      for (const hunk of hunks) {
        if (!hunk.oldText) continue
        const range = findFlexibleTextRange(nextContent, hunk.oldText)
        if (!range) {
          const error = new Error(`Update File ${op.path} context not found`)
          error.diagnostics = {
            path: op.path,
            ...buildTextEditDiagnostics(nextContent, hunk.oldText),
            hint: 'Patch context did not match. Use returned candidate lines with text_edit replace_lines/regex instead of rewriting the whole file.'
          }
          throw error
        }
        nextContent = nextContent.slice(0, range.start) + hunk.newText + nextContent.slice(range.end)
      }
      await recordBefore(filePath, 'modify')
      await fs.promises.writeFile(filePath, nextContent, 'utf-8')
      await recordAfter(filePath, 'modify')
      let finalPath = filePath
      if (op.moveTo) {
        const targetPath = resolvePath(op.moveTo)
        ensureTextPatchTarget(targetPath)
        if (await pathExists(targetPath)) throw new Error(`目标文件已存在，无法 Move to: ${op.moveTo}`)
        await recordBefore(targetPath, 'create')
        await fs.promises.mkdir(path.dirname(targetPath), { recursive: true })
        await fs.promises.rename(filePath, targetPath)
        await recordAfter(targetPath, 'create')
        finalPath = targetPath
      }
      touched.push({ action: op.moveTo ? 'move_update' : 'update', path: finalPath, line_count: countLines(nextContent) })
    }
  }

  return touched
}

function parseJsonPath(jsonPath = '') {
  return String(jsonPath || '')
    .split('.')
    .map(part => part.trim())
    .filter(Boolean)
}

function getJsonContainer(rootValue, pathParts, createMissing = false) {
  let current = rootValue
  for (let index = 0; index < pathParts.length - 1; index += 1) {
    const key = pathParts[index]
    const nextKey = pathParts[index + 1]
    const nextShouldBeArray = /^\d+$/.test(nextKey)
    if (Array.isArray(current)) {
      const arrayIndex = Number(key)
      if (!Number.isInteger(arrayIndex) || arrayIndex < 0) throw new Error(`JSON 路径数组下标不合法: ${key}`)
      if (current[arrayIndex] === undefined) {
        if (!createMissing) return null
        current[arrayIndex] = nextShouldBeArray ? [] : {}
      }
      current = current[arrayIndex]
    } else if (current && typeof current === 'object') {
      if (current[key] === undefined) {
        if (!createMissing) return null
        current[key] = nextShouldBeArray ? [] : {}
      }
      current = current[key]
    } else {
      throw new Error(`JSON 路径无法进入非对象节点: ${key}`)
    }
  }
  return { container: current, key: pathParts[pathParts.length - 1] }
}

function applyJsonEditOperations(data, operations = []) {
  const applied = []
  for (const operation of operations) {
    const op = String(operation.op || '').toLowerCase()
    const parts = parseJsonPath(operation.json_path || operation.path || '')
    if (!parts.length) throw new Error('json_path 不能为空')
    const target = getJsonContainer(data, parts, op === 'set' || op === 'append')
    if (!target) {
      applied.push({ op, json_path: parts.join('.'), skipped: true, reason: 'path-not-found' })
      continue
    }
    const { container, key } = target
    if (Array.isArray(container)) {
      const index = key === '-' ? container.length : Number(key)
      if (op === 'set') {
        if (!Number.isInteger(index) || index < 0) throw new Error(`数组下标不合法: ${key}`)
        container[index] = operation.value
      } else if (op === 'delete') {
        if (Number.isInteger(index) && index >= 0 && index < container.length) container.splice(index, 1)
      } else if (op === 'append') {
        if (key === '-' || key === String(container.length)) container.push(operation.value)
        else {
          if (!Array.isArray(container[index])) throw new Error(`append 目标不是数组: ${parts.join('.')}`)
          container[index].push(operation.value)
        }
      } else {
        throw new Error(`不支持的 json_edit op: ${op}`)
      }
    } else if (container && typeof container === 'object') {
      if (op === 'set') container[key] = operation.value
      else if (op === 'delete') delete container[key]
      else if (op === 'append') {
        if (!Array.isArray(container[key])) {
          if (container[key] === undefined) container[key] = []
          else throw new Error(`append 目标不是数组: ${parts.join('.')}`)
        }
        container[key].push(operation.value)
      } else {
        throw new Error(`不支持的 json_edit op: ${op}`)
      }
    } else {
      throw new Error(`JSON 路径目标不是对象或数组: ${parts.join('.')}`)
    }
    applied.push({ op, json_path: parts.join('.') })
  }
  return applied
}

const handlers = {
  text_edit: async (args, ctx) => {
    const { resolvePath, projectPath, projectId } = ctx
    try {
      const filePath = resolvePath(args.path)
      if (!await pathExists(filePath)) {
        return buildPathFailureResult({
          requestedPath: args.path,
          resolvedPath: filePath,
          projectPath,
          kind: 'file'
        })
      }
      if (!(await fs.promises.stat(filePath)).isFile()) {
        return buildPathFailureResult({
          requestedPath: args.path,
          resolvedPath: filePath,
          projectPath,
          kind: 'file',
          errorType: 'not_a_file'
        })
      }
      ensureTextPatchTarget(filePath)
      await ensureSafetyBaselineBeforeWrite(projectId, projectPath, [filePath])
      if (projectId) {
        await safelyRecordChange(() => changeSessions.recordFileBeforeAsync(projectId, filePath, 'modify'))
      }
      const content = await fs.promises.readFile(filePath, 'utf-8')
      const editResult = applyTextEditList(content, args.edits)
      if (editResult.content === content) {
        return {
          success: true,
          path: filePath,
          relative_path: toProjectRelative(projectPath, filePath),
          unchanged: true,
          applied: editResult.applied,
          message: 'text_edit made no content changes'
        }
      }
      const runtimeCursor = capturePostEditRuntimeBaseline(projectId, projectPath)
      await fs.promises.writeFile(filePath, editResult.content, 'utf-8')
      if (projectId) {
        await safelyRecordChange(() => changeSessions.recordFileAfterAsync(projectId, filePath, 'modify'))
      }
      const result = {
        success: true,
        path: filePath,
        relative_path: toProjectRelative(projectPath, filePath),
        applied: editResult.applied,
        operation_count: editResult.applied.length,
        added_lines: editResult.applied.reduce((sum, item) => sum + (item.added_lines || 0), 0),
        removed_lines: editResult.applied.reduce((sum, item) => sum + (item.removed_lines || 0), 0),
        line_count: countLines(editResult.content),
        message: `Text edited: ${toProjectRelative(projectPath, filePath) || filePath}`
      }
      await attachPostEditDiagnostics(result, [filePath], projectPath, runtimeCursor)
      return result
    } catch (e) {
      return {
        success: false,
        error_type: 'text_edit_error',
        error: e.message,
        diagnostics: e.diagnostics || null,
        requested_path: args.path || '',
        project_root: projectPath
      }
    }
  },

  apply_patch: async (args, ctx) => {
      const { resolvePath, projectPath, projectId } = ctx
    try {
      const operations = parseApplyPatch(args.patch || '')
      const runtimeCursor = capturePostEditRuntimeBaseline(projectId, projectPath)
      const touched = await applyTextPatchOperations(operations, resolvePath, projectId, projectPath)
      const result = {
        success: true,
        message: `补丁已应用，共 ${touched.length} 个文件操作`,
        files: touched
      }
      await attachPostEditDiagnostics(result, touched.filter(item => item.action !== 'delete').map(item => item.path), projectPath, runtimeCursor)
      result.syntaxWarnings = result.postEditDiagnostics.results.map(item => ({
        path: item.path,
        valid: item.valid,
        language: item.language,
        errors: item.errors || []
      }))
      return result
    } catch (e) {
      return { success: false, error_type: 'patch_error', error: e.message, diagnostics: e.diagnostics || null }
    }
  },

  json_edit: async (args, ctx) => {
    const { resolvePath, projectPath, projectId } = ctx
    try {
      const filePath = resolvePath(args.path)
      const operations = Array.isArray(args.operations) ? args.operations : []
      const indent = Math.max(0, Math.min(Number(args.indent ?? 2) || 2, 8))
      if (!await pathExists(filePath)) {
        return buildPathFailureResult({
          requestedPath: args.path,
          resolvedPath: filePath,
          projectPath,
          kind: 'file'
        })
      }
      if (!(await fs.promises.stat(filePath)).isFile()) {
        return { success: false, error: 'json_edit only supports files', path: filePath }
      }
      if (!operations.length) {
        return { success: false, error: 'json_edit requires at least one operation', path: filePath }
      }
      await ensureSafetyBaselineBeforeWrite(projectId, projectPath, [filePath])
      if (projectId) {
        await safelyRecordChange(() => changeSessions.recordFileBeforeAsync(projectId, filePath, 'modify'))
      }
      const originalContent = await fs.promises.readFile(filePath, 'utf-8')
      let data
      try {
        data = JSON.parse(originalContent)
      } catch (parseError) {
        return {
          success: false,
          error_type: 'json_parse_error',
          error: parseError.message,
          path: filePath
        }
      }
      const applied = applyJsonEditOperations(data, operations)
      const nextContent = `${JSON.stringify(data, null, indent)}\n`
      const runtimeCursor = capturePostEditRuntimeBaseline(projectId, projectPath)
      await fs.promises.writeFile(filePath, nextContent, 'utf-8')
      if (projectId) {
        await safelyRecordChange(() => changeSessions.recordFileAfterAsync(projectId, filePath, 'modify'))
      }
      const result = {
        success: true,
        path: filePath,
        relative_path: toProjectRelative(projectPath, filePath),
        operations: applied,
        operation_count: applied.length,
        line_count: countLines(nextContent),
        message: `JSON updated: ${toProjectRelative(projectPath, filePath) || filePath}`
      }
      await attachPostEditDiagnostics(result, [filePath], projectPath, runtimeCursor)
      return result
    } catch (e) {
      return { success: false, error_type: 'json_edit_error', error: e.message, requested_path: args.path || '', project_root: projectPath }
    }
  }
}

module.exports = {
  handlers,
  parseApplyPatch,
  ensureTextPatchTarget,
  applyTextPatchOperations,
  parseJsonPath,
  getJsonContainer,
  applyJsonEditOperations
}
