/**
 * 文件操作工具处理器
 * 包含：read_file, read_many_files, find_in_file, write_file, edit_file,
 *       create_directory, delete_file, copy_file, move_file, list_files 工具
 */

const fs = require('fs')
const path = require('path')
const os = require('os')
const crypto = require('crypto')
const sharp = require('sharp')
const changeSessions = require('../change-sessions')
const { toProjectRelative } = require('../path-utils')
const {
  countLines, applyTextEditList,
  isLikelyTextBuffer, normalizeLineRange, clipTextByChars,
  shouldBlockFullSourceRewrite,
  TEXT_FILE_EXTENSIONS, IMAGE_FILE_EXTENSIONS
} = require('../text-edit-utils')
const { ensureSafetyBaselineBeforeWrite } = require('./git-safety')
const { attachPostEditDiagnostics, capturePostEditRuntimeBaseline } = require('./diagnostics')
const { buildPathFailureResult, findPatternInFile } = require('./search')

const WRITE_FILE_MAX_BYTES = 128 * 1024
const CHUNK_SESSION_TTL_MS = 30 * 60 * 1000
const writeFileChunkSessions = new Map()

// 按 projectId 隔离的文件读取记录
// key: projectId
// value: Set<string> 文件绝对路径集合
const readFilesInSession = new Map()

/**
 * 记录文件已被读取（用于 write_file 的 "先读后写" 检查）
 * @param {string} projectId
 * @param {string} absolutePath
 */
function recordFileRead(projectId, absolutePath) {
  if (!projectId || !absolutePath) return
  if (!readFilesInSession.has(projectId)) {
    readFilesInSession.set(projectId, new Set())
  }
  readFilesInSession.get(projectId).add(absolutePath)
}

/**
 * 检查文件是否已被读取
 * @param {string} projectId
 * @param {string} absolutePath
 * @returns {boolean}
 */
function hasFileBeenRead(projectId, absolutePath) {
  if (!projectId || !absolutePath) return false
  const set = readFilesInSession.get(projectId)
  return set ? set.has(absolutePath) : false
}

/**
 * 清除项目的读取记录（项目切换时调用）
 * @param {string} projectId
 */
function clearProjectReadRecords(projectId) {
  if (projectId) readFilesInSession.delete(projectId)
}

function byteLengthUtf8(value = '') {
  return Buffer.byteLength(String(value ?? ''), 'utf-8')
}

function sha256Buffer(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex')
}

function sha256Text(value = '') {
  return sha256Buffer(Buffer.from(String(value ?? ''), 'utf-8'))
}

function previewText(value = '', limit = 240) {
  const text = String(value ?? '')
  return text.length <= limit ? text : text.slice(0, limit)
}

function createTempPathForTarget(filePath) {
  const dir = path.dirname(filePath)
  const base = path.basename(filePath).replace(/[^a-zA-Z0-9._-]/g, '_') || 'write-file'
  return path.join(dir, `.${base}.${process.pid}.${Date.now()}.${crypto.randomBytes(6).toString('hex')}.tmp`)
}

async function pathExists(filePath) {
  try {
    await fs.promises.access(filePath)
    return true
  } catch {
    return false
  }
}

async function buildWriteVerifyResult(filePath, content) {
  const expectedBuffer = Buffer.from(String(content ?? ''), 'utf-8')
  const actualBuffer = await fs.promises.readFile(filePath)
  const actualText = actualBuffer.toString('utf-8')
  return {
    expected_bytes: expectedBuffer.length,
    expectedBytes: expectedBuffer.length,
    bytes_written: actualBuffer.length,
    bytesWritten: actualBuffer.length,
    expected_sha256: sha256Buffer(expectedBuffer),
    expectedSha256: sha256Buffer(expectedBuffer),
    sha256: sha256Buffer(actualBuffer),
    line_count: countLines(actualText),
    lineCount: countLines(actualText),
    preview_start: previewText(actualText.slice(0, 240)),
    previewStart: previewText(actualText.slice(0, 240)),
    preview_end: previewText(actualText.slice(Math.max(0, actualText.length - 240))),
    previewEnd: previewText(actualText.slice(Math.max(0, actualText.length - 240)))
  }
}

async function verifyWrittenFile(filePath, content) {
  const verify = await buildWriteVerifyResult(filePath, content)
  if (String(content ?? '').length > 0 && verify.bytes_written === 0) {
    return { success: false, error_type: 'ZERO_BYTE_WRITE', verify }
  }
  if (verify.bytes_written !== verify.expected_bytes) {
    return { success: false, error_type: 'BYTES_MISMATCH', verify }
  }
  if (verify.sha256 !== verify.expected_sha256) {
    return { success: false, error_type: 'HASH_MISMATCH', verify }
  }
  return { success: true, verify }
}

async function atomicWriteVerified(filePath, content) {
  const dir = path.dirname(filePath)
  await fs.promises.mkdir(dir, { recursive: true })
  const tempPath = createTempPathForTarget(filePath)
  try {
    await fs.promises.writeFile(tempPath, String(content ?? ''), 'utf-8')
    const tempVerify = await verifyWrittenFile(tempPath, content)
    if (!tempVerify.success) {
      return tempVerify
    }
    await fs.promises.rename(tempPath, filePath)
    const finalVerify = await verifyWrittenFile(filePath, content)
    if (!finalVerify.success) {
      return finalVerify
    }
    return { success: true, verify: finalVerify.verify }
  } finally {
    try {
      if (await pathExists(tempPath)) await fs.promises.unlink(tempPath)
    } catch { /* 清理临时文件，失败可忽略 */ }
  }
}

function cleanupExpiredChunkSessions() {
  const now = Date.now()
  for (const [sessionId, session] of writeFileChunkSessions.entries()) {
    if (!session || now - session.createdAt <= CHUNK_SESSION_TTL_MS) continue
    try {
      if (session.tempDir) fs.promises.rm(session.tempDir, { recursive: true, force: true }).catch(() => {})
      else if (session.tempPath) fs.promises.unlink(session.tempPath).catch(() => {})
    } catch { /* 清理过期临时文件，失败可忽略 */ }
    writeFileChunkSessions.delete(sessionId)
  }
}

function getChunkSessionKey(args = {}) {
  return String(args.session_id || args.sessionId || args.file_session_id || args.fileSessionId || '').trim()
}

function resolveChunkSession(args = {}, ctx = {}) {
  const requestedSessionId = getChunkSessionKey(args)
  const projectPath = ctx.projectPath || ''
  const projectId = ctx.projectId || ''
  const matches = [...writeFileChunkSessions.values()].filter(session => {
    if (!session) return false
    if (projectId && session.projectId && session.projectId !== projectId) return false
    if (projectPath && session.projectPath && path.resolve(session.projectPath) !== path.resolve(projectPath)) return false
    return true
  })

  if (requestedSessionId) {
    const exactSession = writeFileChunkSessions.get(requestedSessionId) || null
    if (exactSession) {
      return {
        sessionId: requestedSessionId,
        session: exactSession,
        fallback: false,
        reason: ''
      }
    }
    if (matches.length === 1) {
      return {
        sessionId: matches[0].sessionId,
        session: matches[0],
        fallback: true,
        reason: 'single_active_session_after_bad_id',
        requestedSessionId
      }
    }
  }

  if (matches.length === 1) {
    return {
      sessionId: matches[0].sessionId,
      session: matches[0],
      fallback: true,
      reason: 'single_active_session'
    }
  }

  return {
    sessionId: requestedSessionId,
    session: null,
    fallback: false,
    reason: matches.length > 1 ? 'ambiguous_active_sessions' : 'no_active_session',
    activeSessions: matches.map(session => ({
      session_id: session.sessionId,
      path: session.filePath,
      bytes_received: session.bytesReceived,
      chunks: session.chunks
    }))
  }
}

function normalizeRelativePathForTool(filePath = '', rootPath = '') {
  try {
    const relative = path.relative(rootPath, filePath)
    if (relative && !relative.startsWith('..') && !path.isAbsolute(relative)) {
      return relative.replace(/\\/g, '/')
    }
  } catch { /* 路径计算失败 */ }
  return String(filePath || '').replace(/\\/g, '/')
}

function clipToolText(text = '', maxChars = 12000) {
  const safeLimit = Math.max(1000, Math.min(50000, Number(maxChars) || 12000))
  const value = String(text || '')
  if (value.length <= safeLimit) return { text: value, truncated: false }
  return {
    text: `${value.slice(0, safeLimit)}\n...[truncated ${value.length - safeLimit} chars; use path or max_chars to narrow the diff]`,
    truncated: true
  }
}

function safelyRecordChange(fn) {
  try {
    const result = fn()
    if (result && typeof result.then === 'function') {
      return result.catch(error => {
        console.error('[ChangeSession] 记录本轮修改失败:', error.message)
        return null
      })
    }
    return result
  } catch (error) {
    console.error('[ChangeSession] 记录本轮修改失败:', error.message)
    return null
  }
}

function summarizeToolArgsForLog(args = {}) {
  const summary = {}
  for (const [key, value] of Object.entries(args || {})) {
    if (typeof value === 'string') {
      if (['content', 'old_content', 'new_content', 'old_string', 'new_string', 'replacement', 'patch'].includes(key)) {
        summary[key] = { chars: value.length, lines: value ? value.split(/\r\n|\r|\n/).length : 0 }
      } else {
        summary[key] = value.length > 240 ? `${value.slice(0, 240)}...(${value.length} chars)` : value
      }
    } else if (Array.isArray(value)) {
      summary[key] = { type: 'array', length: value.length }
    } else if (value && typeof value === 'object') {
      summary[key] = { type: 'object', keys: Object.keys(value).slice(0, 20) }
    } else {
      summary[key] = value
    }
  }
  return summary
}

function filePatternToRegExp(pattern = '') {
  const normalized = String(pattern || '').replace(/\\/g, '/').replace(/^\.\/+/, '')
  let source = ''
  for (let i = 0; i < normalized.length; i += 1) {
    const char = normalized[i]
    const next = normalized[i + 1]
    if (char === '*') {
      if (next === '*') {
        const after = normalized[i + 2]
        if (after === '/') {
          source += '(?:.*\\/)?'
          i += 2
        } else {
          source += '.*'
          i += 1
        }
      } else {
        source += '[^/]*'
      }
    } else if (char === '?') {
      source += '[^/]'
    } else {
      source += char.replace(/[|\\{}()[\]^$+?.]/g, '\\$&')
    }
  }
  return new RegExp(`^${source}$`, 'i')
}

async function listDirectoryEntriesAsync(dirPath, options = {}) {
  const rootPath = options.rootPath || dirPath
  const pattern = String(options.pattern || '').trim()
  const recursive = options.recursive === true || pattern.includes('**') || /[\\/]/.test(pattern)
  const matcher = pattern ? filePatternToRegExp(pattern) : null
  const basenameOnly = pattern && !pattern.replace(/\\/g, '/').includes('/')
  const limit = Math.max(1, Math.min(1000, Number(options.limit) || 500))
  const results = []
  const stack = [dirPath]

  while (stack.length && results.length < limit) {
    const current = stack.pop()
    const entries = await fs.promises.readdir(current, { withFileTypes: true }).catch(() => [])
    entries.sort((a, b) => a.name.localeCompare(b.name))
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name)
      let isDir = entry.isDirectory()
      let isFile = entry.isFile()
      if (entry.isSymbolicLink()) {
        const stat = await fs.promises.stat(fullPath).catch(() => null)
        isDir = !!stat?.isDirectory()
        isFile = !!stat?.isFile()
      }
      if (!isDir && !isFile) continue
      const relativeToBase = normalizeRelativePathForTool(fullPath, dirPath)
      const relativeToRoot = normalizeRelativePathForTool(fullPath, rootPath)
      const matched = !matcher ||
        matcher.test(relativeToBase) ||
        matcher.test(relativeToRoot) ||
        (basenameOnly && matcher.test(entry.name))
      if (matched) {
        results.push({ name: entry.name, type: isDir ? 'directory' : 'file', path: fullPath })
        if (results.length >= limit) break
      }
      if (recursive && isDir) stack.push(fullPath)
    }
  }
  return results
}

async function readFileSafely(filePath, options = {}) {
  const stat = await fs.promises.stat(filePath)
  if (!stat.isFile()) {
    return {
      success: false,
      error_type: 'not_a_file',
      error: `Resolved path is not a file: ${filePath}`,
      path: filePath,
      resolved_path: filePath,
      file_type: 'directory'
    }
  }

  const ext = path.extname(filePath).toLowerCase()
  const buffer = await fs.promises.readFile(filePath)
  const textByExtension = TEXT_FILE_EXTENSIONS.has(ext) || !ext
  const imageByExtension = IMAGE_FILE_EXTENSIONS.has(ext)
  const isText = textByExtension && isLikelyTextBuffer(buffer)

  if (isText) {
    const content = buffer.toString('utf-8')
    const lines = content.split(/\r\n|\r|\n/)
    const range = normalizeLineRange(options, lines.length)
    const selectedContent = range.hasRange
      ? lines.slice(range.startLine - 1, range.endLine).join('\n')
      : content
    const clipped = clipTextByChars(selectedContent, options.max_chars ?? options.maxChars)
    return {
      success: true,
      path: filePath,
      content: clipped.text,
      length: clipped.text.length,
      full_length: content.length,
      byte_length: buffer.length,
      line_count: lines.length,
      file_type: 'text',
      start_line: range.hasRange ? range.startLine : 1,
      end_line: range.hasRange ? range.endLine : lines.length,
      range_read: range.hasRange,
      truncated: clipped.truncated,
      coverage: clipped.truncated || range.hasRange ? 'partial' : 'full'
    }
  }

  const result = {
    success: true,
    path: filePath,
    content: '',
    length: 0,
    byte_length: buffer.length,
    file_type: imageByExtension ? 'image' : 'binary',
    binary: true,
    extension: ext.replace('.', ''),
    message: imageByExtension
      ? '这是图片文件，read_file 只返回安全元数据；请在前端/Canvas/Three.js 中直接引用该路径，或用图像处理工具读取尺寸和生成派生资源。'
      : '这是二进制文件，read_file 不返回原始内容，避免二进制数据污染模型上下文。'
  }

  if (imageByExtension) {
    try {
      const metadata = await sharp(filePath).metadata()
      result.width = metadata.width || null
      result.height = metadata.height || null
      result.format = metadata.format || ext.replace('.', '')
      result.has_alpha = !!metadata.hasAlpha
    } catch (error) {
      result.metadata_error = error.message
    }
  }

  return result
}

const handlers = {
  read_file: async (args, ctx) => {
    const { resolvePath, projectPath } = ctx
    try {
      const filePath = resolvePath(args.path)
      console.log('[Tool] read_file 原始路径:', args.path, '解析后:', filePath)
      const exists = await pathExists(filePath)
      console.log('[Tool] 文件是否存在:', exists)
      if (!exists) {
        return buildPathFailureResult({
          requestedPath: args.path,
          resolvedPath: filePath,
          projectPath,
          kind: 'file'
        })
      }
      const result = await readFileSafely(filePath, args)
      if (result?.success === false && result.error_type === 'not_a_file') {
        return {
          ...buildPathFailureResult({
            requestedPath: args.path,
            resolvedPath: filePath,
            projectPath,
            kind: 'file',
            errorType: 'not_a_file'
          }),
          path: filePath
        }
      }
      // 记录文件已被读取（用于 write_file 的先读后写检查）
      if (result?.success && ctx.projectId) {
        recordFileRead(ctx.projectId, filePath)
      }
      return result
    } catch (e) {
      return { success: false, error_type: 'read_error', error: e.message, requested_path: args.path || '', project_root: projectPath }
    }
  },

  read_many_files: async (args, ctx) => {
    const { resolvePath, projectPath } = ctx
    try {
      const rawFiles = Array.isArray(args.files) ? args.files.slice(0, 20) : []
      if (!rawFiles.length) {
        return { success: false, error: 'files 不能为空' }
      }
      const maxCharsPerFile = args.max_chars_per_file ?? args.maxCharsPerFile
      const files = await Promise.all(rawFiles.map(async item => {
        const entry = typeof item === 'string' ? { path: item } : (item || {})
        const requestedPath = entry.path || ''
        const filePath = resolvePath(requestedPath)
        if (!requestedPath || !await pathExists(filePath)) {
          return {
            success: false,
            requested_path: requestedPath,
            ...buildPathFailureResult({
              requestedPath,
              resolvedPath: filePath,
              projectPath,
              kind: 'file'
            })
          }
        }
        const readOptions = {
          ...entry,
          max_chars: entry.max_chars ?? entry.maxChars ?? maxCharsPerFile
        }
        const fileResult = await readFileSafely(filePath, readOptions)
        // 记录文件已被读取（用于 write_file 的先读后写检查）
        if (fileResult?.success && ctx.projectId) {
          recordFileRead(ctx.projectId, filePath)
        }
        return {
          ...fileResult,
          requested_path: requestedPath,
          relative_path: toProjectRelative(projectPath, filePath)
        }
      }))
      const okCount = files.filter(item => item.success).length
      return {
        success: okCount > 0,
        files,
        count: files.length,
        ok_count: okCount,
        failed_count: files.length - okCount
      }
    } catch (e) {
      return { success: false, error_type: 'read_many_error', error: e.message, project_root: projectPath }
    }
  },

  find_in_file: async (args, ctx) => {
    const { resolvePath, projectPath } = ctx
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
      const result = await findPatternInFile(filePath, args)
      if (result?.success) result.relative_path = toProjectRelative(projectPath, filePath)
      return result
    } catch (e) {
      return { success: false, error_type: 'find_in_file_error', error: e.message, requested_path: args.path || '', pattern: args.pattern || '', project_root: projectPath }
    }
  },

  write_file: async (args, ctx) => {
    const { resolvePath, projectPath, projectId, options = {} } = ctx
    try {
      // 校验 path 参数
      if (!args.path || typeof args.path !== 'string' || args.path.trim() === '') {
        return {
          success: false,
          error_type: 'missing_path',
          error: 'write_file 需要 path 参数，但未提供或为空',
          hint: '请检查工具调用参数，确保 path 字段不为空。示例: { path: "src/index.js", content: "..." }',
          received_args: Object.keys(args || {})
        }
      }
      const filePath = resolvePath(args.path)
      const content = String(args.content ?? '')
      const expectedBytes = byteLengthUtf8(content)
      if (expectedBytes > WRITE_FILE_MAX_BYTES) {
        return {
          success: false,
          error_type: 'CONTENT_TOO_LARGE_USE_CHUNKED_WRITE',
          recoverable: true,
          path: filePath,
          relative_path: toProjectRelative(projectPath, filePath),
          expected_bytes: expectedBytes,
          max_bytes: WRITE_FILE_MAX_BYTES,
          message: `write_file 内容 ${expectedBytes} bytes 超过 ${WRITE_FILE_MAX_BYTES} bytes 上限，请改用 create_file_session / append_file_chunk / finish_file_session 分片写入。`,
          next_action: '改用分片写入工具：先 create_file_session，再多次 append_file_chunk，最后 finish_file_session 并传 expected_bytes 或 expected_sha256 校验。'
        }
      }
      const isCollaborationReportWrite = options.collaborationReportFilePath &&
        path.resolve(filePath) === path.resolve(options.collaborationReportFilePath)
      if (!isCollaborationReportWrite) {
        await ensureSafetyBaselineBeforeWrite(projectId, projectPath, [filePath])
      }
      const existedBefore = await pathExists(filePath)
      if (existedBefore && !isCollaborationReportWrite) {
        // 先读后写检查：已存在的文件必须先用 Read 读取后才能 Write
        if (!hasFileBeenRead(projectId, filePath)) {
          return {
            success: false,
            error_type: 'must_read_before_write',
            path: filePath,
            relative_path: toProjectRelative(projectPath, filePath),
            message: 'write_file 拦截：已存在的文件必须先用 read_file 读取后才能覆盖写入。请先调用 read_file 读取该文件，确认原内容后再 write_file。',
            next_action: '请先调用 read_file 读取该文件路径，确认原内容后再调用 write_file 写入。'
          }
        }
        // 大源文件整文件覆盖拦截：与 finish_file_session 一致，需显式 allow_full_rewrite
        try {
          const oldContent = await fs.promises.readFile(filePath, 'utf-8')
          if (shouldBlockFullSourceRewrite(filePath, oldContent, content, args)) {
            return {
              success: false,
              error_type: 'full_source_rewrite_blocked',
              path: filePath,
              relative_path: toProjectRelative(projectPath, filePath),
              message: 'write_file blocked a full overwrite of an existing source file. Pass allow_full_rewrite only when a full regeneration is intentional. Prefer text_edit / apply_patch for partial changes.',
              old_line_count: countLines(oldContent),
              new_line_count: countLines(content),
              next_action: '对已有源码用 text_edit 或 apply_patch 做局部修改；若确需整文件重写，传 allow_full_rewrite: true。'
            }
          }
        } catch (_) {
          // 读旧内容失败时不阻断后续写入校验路径
        }
      }
      if (projectId && !isCollaborationReportWrite) {
        await safelyRecordChange(() => changeSessions.recordFileBeforeAsync(projectId, filePath, existedBefore ? 'modify' : 'create'))
      }
      const runtimeCursor = capturePostEditRuntimeBaseline(projectId, projectPath)
      const writeResult = await atomicWriteVerified(filePath, content)
      if (!writeResult.success) {
        return {
          success: false,
          error_type: writeResult.error_type || 'WRITE_VERIFY_FAILED',
          recoverable: true,
          path: filePath,
          relative_path: toProjectRelative(projectPath, filePath),
          message: 'write_file 写入后校验失败，目标文件未被当作成功写入。',
          ...writeResult.verify,
          next_action: '不要直接最终回复；请重新读取目标文件确认状态，必要时改用分片写入或更小范围补丁。'
        }
      }
      if (projectId && !isCollaborationReportWrite) {
        await safelyRecordChange(() => changeSessions.recordFileAfterAsync(projectId, filePath, existedBefore ? 'modify' : 'create'))
      }
      const result = {
        success: true,
        path: filePath,
        relative_path: toProjectRelative(projectPath, filePath),
        message: `文件已写入并校验通过: ${filePath}`,
        ...writeResult.verify
      }
      await attachPostEditDiagnostics(result, [filePath], projectPath, runtimeCursor)
      try {
        require('../character-animation-preview').maybeAutoOpenFromWrittenFile(filePath, projectPath)
      } catch (_) { /* ignore */ }
      return result
    } catch (e) {
      return { success: false, error: e.message }
    }
  },

  create_file_session: async (args, ctx) => {
    const { resolvePath, projectPath, projectId, options = {} } = ctx
    try {
      cleanupExpiredChunkSessions()
      if (!args.path || typeof args.path !== 'string' || args.path.trim() === '') {
        return {
          success: false,
          error_type: 'missing_path',
          error: 'create_file_session 需要 path 参数，但未提供或为空',
          received_args: Object.keys(args || {})
        }
      }
      const filePath = resolvePath(args.path)
      const isCollaborationReportWrite = options.collaborationReportFilePath &&
        path.resolve(filePath) === path.resolve(options.collaborationReportFilePath)
      if (!isCollaborationReportWrite) {
        await ensureSafetyBaselineBeforeWrite(projectId, projectPath, [filePath])
      }
      const existedBefore = await pathExists(filePath)
      const dir = path.dirname(filePath)
      await fs.promises.mkdir(dir, { recursive: true })
      const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'lingxi-write-file-'))
      const tempPath = path.join(tempDir, 'content.tmp')
      await fs.promises.writeFile(tempPath, '', 'utf-8')
      const sessionId = `write:${Date.now().toString(36)}:${crypto.randomBytes(8).toString('hex')}`
      writeFileChunkSessions.set(sessionId, {
        sessionId,
        filePath,
        tempPath,
        tempDir,
        projectPath,
        projectId,
        existedBefore,
        isCollaborationReportWrite,
        allowFullRewrite: Boolean(args.allow_full_rewrite),
        createdAt: Date.now(),
        bytesReceived: 0,
        chunks: 0
      })
      return {
        success: true,
        session_id: sessionId,
        path: filePath,
        relative_path: toProjectRelative(projectPath, filePath),
        temp_bytes: 0,
        message: '分片写入会话已创建，请继续调用 append_file_chunk，完成后调用 finish_file_session。'
      }
    } catch (e) {
      return { success: false, error_type: 'create_file_session_error', error: e.message, requested_path: args.path || '', project_root: projectPath }
    }
  },

  append_file_chunk: async (args, ctx = {}) => {
    try {
      cleanupExpiredChunkSessions()
      const resolved = resolveChunkSession(args, ctx)
      const { sessionId, session } = resolved
      if (!session) {
        return {
          success: false,
          error_type: 'file_session_not_found',
          error: resolved.reason === 'ambiguous_active_sessions'
            ? '存在多个分片写入会话，请传入明确的 session_id。'
            : '分片写入会话不存在或已过期，请重新 create_file_session。',
          session_id: sessionId,
          active_sessions: resolved.activeSessions || [],
          next_action: resolved.reason === 'ambiguous_active_sessions'
            ? '从 active_sessions 中选择正确的 session_id 后重试 append_file_chunk。'
            : '重新调用 create_file_session 创建分片写入会话，然后继续 append_file_chunk。'
        }
      }
      const chunk = String(args.content_chunk ?? args.contentChunk ?? args.chunk ?? args.content ?? '')
      await fs.promises.appendFile(session.tempPath, chunk, 'utf-8')
      session.bytesReceived += byteLengthUtf8(chunk)
      session.chunks += 1
      session.updatedAt = Date.now()
      return {
        success: true,
        session_id: sessionId,
        recovered_session: Boolean(resolved.fallback),
        chunks: session.chunks,
        bytes_received: session.bytesReceived,
        bytesReceived: session.bytesReceived,
        message: `已追加分片 ${session.chunks}，累计 ${session.bytesReceived} bytes。`
      }
    } catch (e) {
      return { success: false, error_type: 'append_file_chunk_error', error: e.message, session_id: getChunkSessionKey(args) }
    }
  },

  finish_file_session: async (args, ctx) => {
    const { projectPath } = ctx
    let session = null
    try {
      cleanupExpiredChunkSessions()
      const resolved = resolveChunkSession(args, ctx)
      const { sessionId } = resolved
      session = resolved.session
      if (!session) {
        return {
          success: false,
          error_type: 'file_session_not_found',
          error: resolved.reason === 'ambiguous_active_sessions'
            ? '存在多个分片写入会话，请传入明确的 session_id。'
            : '分片写入会话不存在或已过期，请重新 create_file_session。',
          session_id: sessionId,
          active_sessions: resolved.activeSessions || [],
          next_action: resolved.reason === 'ambiguous_active_sessions'
            ? '从 active_sessions 中选择正确的 session_id 后重试 finish_file_session。'
            : '重新调用 create_file_session 创建分片写入会话。'
        }
      }
      const buffer = await fs.promises.readFile(session.tempPath)
      const content = buffer.toString('utf-8')
      if (session.existedBefore && !session.isCollaborationReportWrite) {
        const oldContent = await fs.promises.readFile(session.filePath, 'utf-8')
        if (shouldBlockFullSourceRewrite(session.filePath, oldContent, content, { allow_full_rewrite: session.allowFullRewrite })) {
          return {
            success: false,
            error_type: 'full_source_rewrite_blocked',
            session_id: sessionId,
            path: session.filePath,
            relative_path: toProjectRelative(session.projectPath, session.filePath),
            message: 'finish_file_session blocked a full overwrite of an existing source file. Pass allow_full_rewrite only when a full regeneration is intentional.',
            old_line_count: countLines(oldContent),
            new_line_count: countLines(content)
          }
        }
      }
      const expectedBytes = args.expected_bytes ?? args.expectedBytes
      const expectedSha256 = args.expected_sha256 || args.expectedSha256 || ''
      const actualSha256 = sha256Buffer(buffer)
      if (expectedBytes !== undefined && Number(expectedBytes) !== buffer.length) {
        return {
          success: false,
          error_type: 'BYTES_MISMATCH',
          recoverable: true,
          session_id: sessionId,
          path: session.filePath,
          expected_bytes: Number(expectedBytes),
          bytes_written: buffer.length,
          sha256: actualSha256,
          message: 'finish_file_session 字节数校验失败，目标文件未被替换。'
        }
      }
      if (expectedSha256 && expectedSha256 !== actualSha256) {
        return {
          success: false,
          error_type: 'HASH_MISMATCH',
          recoverable: true,
          session_id: sessionId,
          path: session.filePath,
          expected_sha256: expectedSha256,
          sha256: actualSha256,
          bytes_written: buffer.length,
          message: 'finish_file_session hash 校验失败，目标文件未被替换。'
        }
      }
      if (session.projectId && !session.isCollaborationReportWrite) {
        await safelyRecordChange(() => changeSessions.recordFileBeforeAsync(session.projectId, session.filePath, session.existedBefore ? 'modify' : 'create'))
      }
      const runtimeCursor = capturePostEditRuntimeBaseline(session.projectId, session.projectPath || projectPath)
      const writeResult = await atomicWriteVerified(session.filePath, content)
      if (!writeResult.success) {
        return {
          success: false,
          error_type: writeResult.error_type || 'WRITE_VERIFY_FAILED',
          recoverable: true,
          session_id: sessionId,
          path: session.filePath,
          relative_path: toProjectRelative(session.projectPath, session.filePath),
          message: 'finish_file_session 写入后校验失败，目标文件未被当作成功写入。',
          ...writeResult.verify
        }
      }
      if (session.projectId && !session.isCollaborationReportWrite) {
        await safelyRecordChange(() => changeSessions.recordFileAfterAsync(session.projectId, session.filePath, session.existedBefore ? 'modify' : 'create'))
      }
      writeFileChunkSessions.delete(sessionId)
      await fs.promises.rm(session.tempDir, { recursive: true, force: true }).catch(() => {})
      const result = {
        success: true,
        session_id: sessionId,
        recovered_session: Boolean(resolved.fallback),
        path: session.filePath,
        relative_path: toProjectRelative(session.projectPath, session.filePath),
        message: `分片文件已写入并校验通过: ${session.filePath}`,
        chunks: session.chunks,
        ...writeResult.verify
      }
      await attachPostEditDiagnostics(result, [session.filePath], session.projectPath || projectPath, runtimeCursor)
      return result
    } catch (e) {
      return { success: false, error_type: 'finish_file_session_error', error: e.message, session_id: args.session_id || '' }
    }
  },

  edit_file: async (args, ctx) => {
    const { resolvePath, projectPath, projectId } = ctx
    try {
      // 校验 path 参数
      if (!args.path || typeof args.path !== 'string' || args.path.trim() === '') {
        return {
          success: false,
          error_type: 'missing_path',
          error: 'edit_file 需要 path 参数，但未提供或为空',
          hint: '请检查工具调用参数，确保 path 字段不为空。示例: { path: "src/index.js", old_content: "旧文本", new_content: "新文本" }',
          received_args: Object.keys(args || {})
        }
      }
      const filePath = resolvePath(args.path)
      if (!await pathExists(filePath)) {
        return buildPathFailureResult({
          requestedPath: args.path,
          resolvedPath: filePath,
          projectPath,
          kind: 'file'
        })
      }
      await ensureSafetyBaselineBeforeWrite(projectId, projectPath, [filePath])
      if (projectId) {
        await safelyRecordChange(() => changeSessions.recordFileBeforeAsync(projectId, filePath, 'modify'))
      }
      const content = await fs.promises.readFile(filePath, 'utf-8')
      if (!content.includes(args.old_content)) {
        return { success: false, error: '未找到要替换的内容', hint: '请确保old_content精确匹配文件中的内容' }
      }
      const newContent = content.replace(args.old_content, args.new_content)
      const runtimeCursor = capturePostEditRuntimeBaseline(projectId, projectPath)
      await fs.promises.writeFile(filePath, newContent, 'utf-8')
      const lineCount = countLines(newContent)
      if (projectId) {
        await safelyRecordChange(() => changeSessions.recordFileAfterAsync(projectId, filePath, 'modify'))
      }
      const result = { success: true, path: filePath, relative_path: toProjectRelative(projectPath, filePath), message: '文件已编辑', line_count: lineCount }
      await attachPostEditDiagnostics(result, [filePath], projectPath, runtimeCursor)
      return result
    } catch (e) {
      return { success: false, error_type: 'edit_error', error: e.message, requested_path: args.path || '', project_root: projectPath }
    }
  },

  create_directory: async (args, ctx) => {
    const { resolvePath, projectId, projectPath } = ctx
    try {
      // 校验 path 参数
      if (!args.path || typeof args.path !== 'string' || args.path.trim() === '') {
        return {
          success: false,
          error_type: 'missing_path',
          error: 'create_directory 需要 path 参数，但未提供或为空',
          hint: '请检查工具调用参数，确保 path 字段不为空。示例: { path: "src/utils" }',
          received_args: Object.keys(args || {})
        }
      }
      const dirPath = resolvePath(args.path)
      if (!await pathExists(dirPath)) {
        await ensureSafetyBaselineBeforeWrite(projectId, projectPath, [dirPath])
        await fs.promises.mkdir(dirPath, { recursive: true })
        return { success: true, path: dirPath, message: `目录已创建: ${dirPath}` }
      }
      return { success: true, path: dirPath, message: '目录已存在' }
    } catch (e) {
      return { success: false, error: e.message }
    }
  },

  delete_file: async (args, ctx) => {
    const { resolvePath, projectPath, projectId } = ctx
    try {
      // 校验 path 参数
      if (!args.path || typeof args.path !== 'string' || args.path.trim() === '') {
        return {
          success: false,
          error_type: 'missing_path',
          error: 'delete_file 需要 path 参数，但未提供或为空',
          hint: '请检查工具调用参数，确保 path 字段不为空。示例: { path: "temp/old-file.js" }',
          received_args: Object.keys(args || {})
        }
      }
      const filePath = resolvePath(args.path)
      if (!await pathExists(filePath)) {
        return buildPathFailureResult({
          requestedPath: args.path,
          resolvedPath: filePath,
          projectPath,
          kind: 'file'
        })
      }
      await ensureSafetyBaselineBeforeWrite(projectId, projectPath, [filePath])
      if (projectId) {
        await safelyRecordChange(() => changeSessions.recordFileBeforeAsync(projectId, filePath, 'delete'))
      }
      const deletedContent = await fs.promises.readFile(filePath, 'utf-8')
      await fs.promises.unlink(filePath)
      if (projectId) {
        await safelyRecordChange(() => changeSessions.recordFileAfterAsync(projectId, filePath, 'delete'))
      }
      return { success: true, path: filePath, content: deletedContent, message: `文件已删除: ${filePath}` }
    } catch (e) {
      return { success: false, error_type: 'delete_error', error: e.message, requested_path: args.path || '', project_root: projectPath }
    }
  },

  copy_file: async (args, ctx) => {
    const { resolvePath, projectPath, projectId } = ctx
    try {
      // 校验 source 和 destination 参数
      const sourceRaw = args.source || args.from || ''
      const destinationRaw = args.destination || args.to || ''
      if (!sourceRaw || typeof sourceRaw !== 'string' || sourceRaw.trim() === '') {
        return {
          success: false,
          error_type: 'missing_source',
          error: 'copy_file 需要 source 参数，但未提供或为空',
          hint: '请检查工具调用参数，确保 source 字段不为空。示例: { source: "src/old.js", destination: "src/new.js" }',
          received_args: Object.keys(args || {})
        }
      }
      if (!destinationRaw || typeof destinationRaw !== 'string' || destinationRaw.trim() === '') {
        return {
          success: false,
          error_type: 'missing_destination',
          error: 'copy_file 需要 destination 参数，但未提供或为空',
          hint: '请检查工具调用参数，确保 destination 字段不为空。示例: { source: "src/old.js", destination: "src/new.js" }',
          received_args: Object.keys(args || {})
        }
      }
      const sourcePath = resolvePath(sourceRaw)
      const destinationPath = resolvePath(destinationRaw)
      if (!await pathExists(sourcePath)) {
        return buildPathFailureResult({
          requestedPath: args.source || args.from || '',
          resolvedPath: sourcePath,
          projectPath,
          kind: 'file'
        })
      }
      if (!(await fs.promises.stat(sourcePath)).isFile()) {
        return { success: false, error: 'copy_file 只支持复制单个文件', source: sourcePath }
      }
      if (await pathExists(destinationPath) && args.overwrite !== true) {
        return { success: false, error: '目标文件已存在；如需覆盖请设置 overwrite=true', destination: destinationPath }
      }
      await ensureSafetyBaselineBeforeWrite(projectId, projectPath, [destinationPath])
      const existedBefore = await pathExists(destinationPath)
      if (projectId) {
        await safelyRecordChange(() => changeSessions.recordFileBeforeAsync(projectId, destinationPath, existedBefore ? 'modify' : 'create'))
      }
      await fs.promises.mkdir(path.dirname(destinationPath), { recursive: true })
      await fs.promises.copyFile(sourcePath, destinationPath)
      if (projectId) {
        await safelyRecordChange(() => changeSessions.recordFileAfterAsync(projectId, destinationPath, existedBefore ? 'modify' : 'create'))
      }
      try {
        require('../character-animation-preview').maybeAutoOpenFromWrittenFile(destinationPath, projectPath)
      } catch (_) { /* ignore */ }
      return {
        success: true,
        source: sourcePath,
        destination: destinationPath,
        relative_source: toProjectRelative(projectPath, sourcePath),
        relative_destination: toProjectRelative(projectPath, destinationPath),
        overwritten: existedBefore,
        message: `文件已复制: ${destinationPath}`
      }
    } catch (e) {
      return { success: false, error_type: 'copy_error', error: e.message, source: args.source || '', destination: args.destination || '', project_root: projectPath }
    }
  },

  move_file: async (args, ctx) => {
    const { resolvePath, projectPath, projectId } = ctx
    try {
      // 校验 source 和 destination 参数
      const sourceRaw = args.source || args.from || ''
      const destinationRaw = args.destination || args.to || ''
      if (!sourceRaw || typeof sourceRaw !== 'string' || sourceRaw.trim() === '') {
        return {
          success: false,
          error_type: 'missing_source',
          error: 'move_file 需要 source 参数，但未提供或为空',
          hint: '请检查工具调用参数，确保 source 字段不为空。示例: { source: "src/old.js", destination: "src/new.js" }',
          received_args: Object.keys(args || {})
        }
      }
      if (!destinationRaw || typeof destinationRaw !== 'string' || destinationRaw.trim() === '') {
        return {
          success: false,
          error_type: 'missing_destination',
          error: 'move_file 需要 destination 参数，但未提供或为空',
          hint: '请检查工具调用参数，确保 destination 字段不为空。示例: { source: "src/old.js", destination: "src/new.js" }',
          received_args: Object.keys(args || {})
        }
      }
      const sourcePath = resolvePath(sourceRaw)
      const destinationPath = resolvePath(destinationRaw)
      if (!await pathExists(sourcePath)) {
        return buildPathFailureResult({
          requestedPath: args.source || args.from || '',
          resolvedPath: sourcePath,
          projectPath,
          kind: 'file'
        })
      }
      if (!(await fs.promises.stat(sourcePath)).isFile()) {
        return { success: false, error: 'move_file 只支持移动单个文件', source: sourcePath }
      }
      if (await pathExists(destinationPath) && args.overwrite !== true) {
        return { success: false, error: '目标文件已存在；如需覆盖请设置 overwrite=true', destination: destinationPath }
      }
      const targetExists = await pathExists(destinationPath)
      await ensureSafetyBaselineBeforeWrite(projectId, projectPath, [sourcePath, destinationPath])
      if (projectId) {
        await safelyRecordChange(() => changeSessions.recordFileBeforeAsync(projectId, sourcePath, 'delete'))
        await safelyRecordChange(() => changeSessions.recordFileBeforeAsync(projectId, destinationPath, targetExists ? 'modify' : 'create'))
      }
      await fs.promises.mkdir(path.dirname(destinationPath), { recursive: true })
      if (targetExists) await fs.promises.unlink(destinationPath)
      await fs.promises.rename(sourcePath, destinationPath)
      if (projectId) {
        await safelyRecordChange(() => changeSessions.recordFileAfterAsync(projectId, sourcePath, 'delete'))
        await safelyRecordChange(() => changeSessions.recordFileAfterAsync(projectId, destinationPath, targetExists ? 'modify' : 'create'))
      }
      return {
        success: true,
        source: sourcePath,
        destination: destinationPath,
        relative_source: toProjectRelative(projectPath, sourcePath),
        relative_destination: toProjectRelative(projectPath, destinationPath),
        overwritten: targetExists,
        message: `文件已移动: ${destinationPath}`
      }
    } catch (e) {
      return { success: false, error_type: 'move_error', error: e.message, source: args.source || '', destination: args.destination || '', project_root: projectPath }
    }
  },

  list_files: async (args, ctx) => {
    const { resolvePath, projectPath } = ctx
    try {
      const dirPath = resolvePath(args.path || '')
      if (!await pathExists(dirPath)) {
        return buildPathFailureResult({
          requestedPath: args.path || '',
          resolvedPath: dirPath,
          projectPath,
          kind: 'directory'
        })
      }
      if (!(await fs.promises.stat(dirPath)).isDirectory()) {
        return buildPathFailureResult({
          requestedPath: args.path || '',
          resolvedPath: dirPath,
          projectPath,
          kind: 'directory',
          errorType: 'not_a_directory'
        })
      }
      const fileList = await listDirectoryEntriesAsync(dirPath, {
        rootPath: projectPath || dirPath,
        pattern: args.pattern || '',
        recursive: args.recursive === true,
        limit: args.limit
      })
      return {
        success: true,
        path: dirPath,
        pattern: args.pattern || '',
        recursive: args.recursive === true || String(args.pattern || '').includes('**') || /[\\/]/.test(String(args.pattern || '')),
        files: fileList,
        count: fileList.length
      }
    } catch (e) {
      return { success: false, error: e.message }
    }
  }
}

module.exports = {
  handlers,
  normalizeRelativePathForTool,
  clipToolText,
  safelyRecordChange,
  summarizeToolArgsForLog,
  readFileSafely,
  recordFileRead,
  hasFileBeenRead,
  clearProjectReadRecords
}
