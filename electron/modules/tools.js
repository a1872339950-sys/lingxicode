/**
 * 工具系统模块
 */

const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { exec, spawn, execFile, spawnSync } = require('child_process')
const { promisify } = require('util')
const { BrowserWindow, webContents: electronWebContents, desktopCapturer } = require('electron')
const sharp = require('sharp')
const { Resvg } = require('@resvg/resvg-js')
const browserTool = require('../tools/browser-tool-secure')
const config = require('./config')
const storageConfig = require('./storage-config')
const projects = require('./projects')  // 新增：获取项目对应的 webContents
const changeSessions = require('./change-sessions')
const { analyzeImagesWithVisionModel } = require('./vision-relay')
const { hasCapability, normalizeModel } = require('./model-capabilities')
const { resolveApiKey, hasApiKey } = require('./api-key')
const terminalSessions = require('./terminal-sessions')
const blenderControl = require('./blender-control')
const softwareAccess = require('./software-access')
const taskLedger = require('./task-ledger')
const recoveryPoints = require('./recovery-points')
const pathPermissions = require('./path-permissions')
const smartAuthorization = require('./smart-authorization')
const agentCollaboration = require('./agent-collaboration')
const agentCollaborationReports = require('./agent-collaboration-reports')
const observability = require('./observability')
const syntaxChecker = require('./syntax-checker')
const changePlanner = require('./change-planner')
const toolGateway = require('./tool-gateway')
const assetLibrary = require('./asset-library')
const { sendThinkingEvent } = require('./thinking-event-sender')

const { summarizeToolArgsForLog } = require('./tool-handlers/file-ops')

const execFileAsync = promisify(execFile)
const pendingAskRequests = new Map()
let askIpcRegistered = false

function createAskRequestId(projectId, type) {
  return `${projectId || 'global'}:${type}:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 8)}`
}

function normalizeAskResponse(data = {}) {
  const value = String(data.value || '')
  const rejected = value === 'rejected' || value === 'not_now'
  const answer = data.answer || ''
  const selectedOption = data.selectedOption && typeof data.selectedOption === 'object'
    ? data.selectedOption
    : null
  return {
    success: !rejected,
    status: rejected ? 'user_rejected' : 'answered',
    answer,
    value,
    selectedOption,
    type: data.type || '',
    executionMode: data.executionMode || null,
    workflowChoice: value || answer,
    message: rejected
      ? `用户选择暂停或不执行：${answer || value}`
      : `用户已选择：${answer || value}`
  }
}

function getUserIntentToolPolicy(userMessage = '') {
  const text = String(userMessage || '')
  const saysNo = /(不要|别|无需|不需要|禁止|不要再|别再|不用|不许)/i
  const noBlenderPattern = /(不要|别|无需|不需要|禁止|不要再|别再|不用|不许).{0,10}(Blender|blender|布兰德|打开\s*Blender)|(Blender|blender|布兰德).{0,10}(不要用|别用|不用|不需要|禁止|不要打开|别打开)/i
  const explicitBlenderPattern = /(Blender|blender|布兰德)/i.test(text) &&
    !noBlenderPattern.test(text) &&
    /(用|使用|直接|通过|打开|运行|脚本|Python|python|构建|创建|制作|做)/i.test(text)
  return {
    noImageGeneration: saysNo.test(text) && /(生成图片|文生图|出图|生成参考图|多视角参考图|参考图|图片生成)/i.test(text),
    noBlender: noBlenderPattern.test(text)
  }
}

function checkToolBlockedByUserIntent(toolName, policy = {}) {
  const imageTools = new Set(['generate_image'])
  const blenderTools = new Set(['blender_status', 'blender_run_script', 'blender_create_demo_model', 'blender_modify_scene', 'blender_import_asset', 'blender_inspect_scene'])
  if (policy.noImageGeneration && imageTools.has(toolName)) {
    return {
      success: false,
      status: 'blocked_by_user_instruction',
      error: '用户本轮明确要求不要生成图片/参考图，已阻止图片生成工具。',
      message: '已按用户要求阻止图片生成。'
    }
  }
  if (policy.noBlender && blenderTools.has(toolName)) {
    return {
      success: false,
      status: 'blocked_by_user_instruction',
      error: '用户本轮明确要求不要使用 Blender，已阻止 Blender 工具。',
      message: '已按用户要求阻止 Blender 工具。'
    }
  }
  return null
}

function inferToolErrorType(result = {}, error = null) {
  if (result.error_type) return result.error_type
  if (result.code === 'invalid_tool_arguments' || result.category === 'tool_argument_format') return 'invalid_tool_arguments'
  if (result.status === 'blocked_by_user_instruction') return 'blocked_by_user_instruction'
  if (result.status === 'user_rejected' || result.value === 'rejected' || result.value === 'not_now') return 'user_rejected'
  if (result.aborted || error?.name === 'AbortError') return 'aborted'
  const message = String(result.error || result.message || error?.message || '').toLowerCase()
  if (/permission|权限|rejected|拒绝|不允许|denied/.test(message)) return 'permission_denied'
  if (/timeout|timed out|超时/.test(message)) return 'timeout'
  if (/not found|no such file|enoent|不存在|找不到/.test(message)) return 'not_found'
  if (/invalid|schema|参数|argument|required|必须|required/.test(message)) return 'invalid_arguments'
  if (/unknown tool|未知工具/.test(message)) return 'unknown_tool'
  return 'tool_execution_error'
}

function buildToolNextAction(errorType, result = {}) {
  if (result.next_action) return result.next_action
  if (result.aborted) return '本次工具调用已中断，不要原样重试；如果仍需继续，请先确认用户意图。'
  switch (errorType) {
    case 'blocked_by_user_instruction':
    case 'user_rejected':
    case 'permission_denied':
      return '尊重用户选择，不要继续调用同类工具；基于已有信息收尾或询问用户。'
    case 'timeout':
      return '缩小输入范围、降低任务规模，或改用更具体的检查命令后再试。'
    case 'not_found':
      return '先确认路径、文件名、软件入口或工具名称是否存在，再重新调用。'
    case 'invalid_arguments':
    case 'invalid_tool_arguments':
      return '修正工具参数，确保必填字段完整且类型正确后再调用。'
    case 'unknown_tool':
      return '换用当前可用工具，不要继续请求未知工具。'
    default:
      return '先根据错误信息分析原因，调整参数或换用替代工具，不要原样重试。'
  }
}

function normalizeToolErrorResult(toolName, result = {}, error = null) {
  const source = result && typeof result === 'object' ? result : {}
  const errorMessage = String(source.error || source.message || error?.message || error || '工具执行失败')
  const errorType = inferToolErrorType(source, error)
  return {
    ...source,
    success: false,
    error_type: errorType,
    error: errorMessage,
    message: source.message || `${toolName || '工具'} 执行失败：${errorMessage}`,
    recoverable: source.recoverable !== undefined ? Boolean(source.recoverable) : !['blocked_by_user_instruction', 'user_rejected', 'permission_denied', 'aborted'].includes(errorType),
    next_action: buildToolNextAction(errorType, source)
  }
}

function normalizeToolResult(toolName, result = {}) {
  if (result?.success === false || result?.error) return normalizeToolErrorResult(toolName, result)
  return result
}

function getResultLabel(result = {}) {
  return result.answer || result.value || result.workflowChoice || ''
}

// 单目标接口（旧调用点保留），实际读取所有路径请用 getPathPermissionTargets
function getPathPermissionTarget(toolName, args = {}, projectPath = '', resolvePath = input => input) {
  const targets = getPathPermissionTargets(toolName, args, projectPath, resolvePath)
  return targets.length ? targets[0] : null
}

// 返回该工具本次调用会碰到的所有需要授权的路径。
// 覆盖模型入口与内部原子 handler，确保组合工具转发后仍沿用相同路径授权。
function getPathPermissionTargets(toolName, args = {}, projectPath = '', resolvePath = input => input) {
  if (!toolName) return []
  const out = []
  const push = (path, reason, operation = toolName) => {
    if (!path && path !== 0) return
    const str = String(path).trim()
    if (!str) return
    out.push({ operation, path: resolvePath(str), reason })
  }

  // 常规读写工具（args.path）
  if (['read_file', 'write_file', 'edit_file', 'delete_file', 'text_edit', 'json_edit',
       'check_syntax', 'find_in_file'].includes(toolName) && args.path) {
    push(args.path, 'file')
  }
  if (['create_directory', 'list_files'].includes(toolName)) {
    push(args.path || '', 'directory')
  }
  if (toolName === 'glob_files' && args.path) {
    push(args.path, 'directory')
  }
  if (toolName === 'read_many_files' && Array.isArray(args.files)) {
    args.files.forEach(item => {
      if (item && item.path) push(item.path, 'file')
    })
  }
  if (toolName === 'parallel_research' && Array.isArray(args.tasks)) {
    args.tasks.slice(0, 6).forEach(task => {
      const kind = String(task?.kind || '')
      const taskArgs = task?.args && typeof task.args === 'object' ? task.args : {}
      if (['read_file', 'find_in_file', 'rg_search'].includes(kind) && taskArgs.path) {
        push(taskArgs.path, kind === 'rg_search' ? 'search_directory' : 'file', kind)
      }
    })
  }

  // 复制/移动：source 和 destination 都要检查
  if (['copy_file', 'move_file'].includes(toolName)) {
    if (args.source) push(args.source, 'source')
    if (args.destination) push(args.destination, 'destination')
  }

  // 分片写入会话：目标路径在 path 上
  if (['create_file_session'].includes(toolName) && args.path) {
    push(args.path, 'file')
  }

  // apply_patch：解析补丁文本，提取所有 *** Update/Add/Delete/Move to 路径
  if (toolName === 'apply_patch' && typeof args.patch === 'string') {
    const patchText = args.patch
    const re = /^\*\*\* (?:Update|Add|Delete) File:\s*(.+?)\s*$/gm
    let m
    while ((m = re.exec(patchText)) !== null) push(m[1], 'patch_target')
    const reMove = /^\*\*\* Move to:\s*(.+?)\s*$/gm
    while ((m = reMove.exec(patchText)) !== null) push(m[1], 'patch_move_to')
  }

  // 视觉/媒体资产输出与输入
  if (toolName === 'render_svg_asset') {
    if (args.output_path) push(args.output_path, 'output')
    if (args.svg_path) push(args.svg_path, 'input')
  }

  // 网页/HTML 类：html_path 都要授权
  if (['runtime_verify', 'capture_screenshot', 'research_website_runtime', 'inspect_image',
       'view_image'].includes(toolName)) {
    if (args.html_path) push(args.html_path, 'html_path')
    if (args.path) push(args.path, 'file')
  }

  // 命令执行：cwd（命令内的绝对路径重定向仍需 shell 层继续加固）
  if (toolName === 'run_command') push(args.cwd || '', 'cwd')
  if (toolName === 'terminal_run') push(args.cwd || projectPath, 'cwd')
  if (toolName === 'shell_run') {
    if (args.cwd) push(args.cwd, 'cwd')
  }

  // Blender/软件启动：走可执行文件路径
  if (toolName === 'blender_status') {
    const status = blenderControl.getBlenderStatus()
    if (status?.executable) push(status.executable, 'executable', toolName)
  }
  if (['blender_run_script', 'blender_create_demo_model', 'blender_modify_scene',
       'blender_import_asset', 'blender_inspect_scene'].includes(toolName)) {
    const status = blenderControl.getBlenderStatus()
    if (status?.executable) push(status.executable, 'executable', 'blender_open')
  }
  if (toolName === 'open_software') {
    const status = softwareAccess.findSoftware(args)
    if (status?.executable) push(status.executable, 'executable', 'open_software')
  }
  if (toolName === 'desktop_control') {
    const method = String(args.method || args.action || '').toLowerCase()
    if (['launch_app', 'launch'].includes(method)) {
      const status = softwareAccess.findSoftware({
        name: args.name || args.app || args.query || '',
        path: args.path || args.executable || args.executable_path || ''
      })
      if (status?.executable) push(status.executable, 'executable', 'desktop_control')
    } else if (['act', 'set_value', 'activate_window', 'activate', 'get_window_state', 'action', 'click', 'drag', 'scroll', 'type_text', 'press_key', 'type', 'key'].includes(method)) {
      try {
        const desktopService = require('./desktop-control/service')
        const exe = desktopService.getWindowExecutable(args.window || args.window_id || args.id)
        if (exe) push(exe, 'executable', 'desktop_control')
      } catch (_) { /* service optional during early boot */ }
    }
  }

  return out
}

async function askPathPermission(projectId, toolName, target, projectPath, options = {}) {
  const webContents = projectId ? projects.getWebContentsForProject(projectId) : config.getMainWindow()?.webContents
  if (!webContents || !target?.path) {
    return { success: false, value: 'rejected', answer: '无可用确认窗口' }
  }

  const requestId = createAskRequestId(projectId, 'path_permission')
  webContents.send('show-ask-popup', {
    requestId,
    type: 'path_permission',
    projectId,
    toolName,
    operation: target.operation,
    reason: target.reason,
    path: target.path,
    projectPath,
    source: options.collaborationSessionId ? 'agent_collaboration' : 'main',
    collaborationSessionId: options.collaborationSessionId || '',
    collaborationAgentId: options.collaborationAgentId || '',
    collaborationAgentName: options.collaborationAgentName || '',
    question: 'AI 需要访问当前项目目录以外的位置，是否允许？',
    options: [
      { label: '允许本次操作', value: 'allow_once', desc: '只允许这一次，后续同类操作还会再次询问。' },
      { label: '后续都允许本次操作', value: 'allow_always', desc: '记住这个操作和路径，后续不再弹窗。' },
      { label: '不允许', value: 'rejected', desc: '拒绝本次项目外访问。' }
    ],
    recommended: 'allow_once'
  })
  return waitForAskResponse(projectId, requestId, undefined, {
    allowConcurrent: !!options.collaborationSessionId
  })
}

function isTemporaryAgentDownloadCommand(command = '') {
  const text = String(command || '')
    .replace(/[`"'，。；]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
  if (!text) return false

  const packageInstallPatterns = [
    /\b(npm|pnpm|yarn|bun)\s+(install|add|i|ci|update|upgrade|create)\b/,
    /\b(npx|pnpx|yarn\s+dlx|bunx)\b/,
    /\b(pip|pip3|python\s+-m\s+pip|py\s+-m\s+pip)\s+(install|download)\b/,
    /\b(poetry|uv|pdm)\s+(install|add|sync|update)\b/,
    /\b(composer|gem)\s+(install|update)\b/,
    /\bdotnet\s+(restore|add\s+package)\b/,
    /\b(go)\s+(get|install)\b/,
    /\bcargo\s+install\b/,
    /\b(mvn|gradle)\b.*\b(dependency:get|install)\b/
  ]
  if (packageInstallPatterns.some(pattern => pattern.test(text))) return true

  const downloadPatterns = [
    /\b(curl|wget)\b/,
    /\b(iwr|irm|invoke-webrequest|invoke-restmethod|start-bitstransfer)\b/,
    /\bgit\s+clone\b/,
    /\bsvn\s+checkout\b/,
    /\bhg\s+clone\b/,
    /\b(winget|choco|scoop)\b.*\b(install|upgrade|update)\b/
  ]
  if (downloadPatterns.some(pattern => pattern.test(text))) return true

  return false
}

function getTemporaryAgentDownloadBlock(name, args, projectId) {
  if (!projectId || !['run_command', 'terminal_run', 'shell_run'].includes(name)) return null
  if (name === 'shell_run' && String(args?.action || 'run') !== 'run') return null
  const instance = projects.getProjectInstance(projectId)
  if (!instance?.isTemporaryAgentChat) return null
  const command = String(args?.command || '')
  if (!isTemporaryAgentDownloadCommand(command)) return null
  return {
    success: false,
    blocked: true,
    blocked_by: 'temporary_agent_download_policy',
    temporaryAgentRestricted: true,
    command,
    error: '临时 AI 可以运行本地检查命令，但不能下载、安装依赖或拉取外部代码。请把需要下载/安装的原因写入临时汇报，由主窗口 AI/用户决定。',
    message: '已阻止临时 AI 的下载/安装类命令。'
  }
}

async function ensurePathPermission(toolName, args, projectPath, resolvePath, projectId, options = {}) {
  const targets = getPathPermissionTargets(toolName, args, projectPath, resolvePath)
  if (!targets.length || !projectPath) return { success: true, skipped: true }

  const seen = new Set()
  const decisions = []
  for (const target of targets) {
    if (!target?.path) continue
    let resolved
    try {
      resolved = path.resolve(target.path)
    } catch {
      resolved = String(target.path)
    }
    if (seen.has(resolved)) continue
    seen.add(resolved)

    if (options.collaborationReportFilePath && resolved === path.resolve(options.collaborationReportFilePath)) {
      decisions.push({ target, collaborationReport: true })
      continue
    }
    if (options.collaborationSessionId && agentCollaborationReports.isInsideReportsDir(target.path)) {
      decisions.push({ target, collaborationReport: true })
      continue
    }
    if (pathPermissions.isInsideProject(projectPath, target.path)) {
      decisions.push({ target, insideProject: true })
      continue
    }

    const existingRule = pathPermissions.findAllowedRule(projectId, target.operation, target.path)
    if (existingRule) {
      decisions.push({ target, remembered: true, rule: existingRule })
      continue
    }

    const settings = pathPermissions.getSettings()
    if (settings.mode === 'smart') {
      const decision = await smartAuthorization.decideAuthorization({ toolName, target, taskContext: options.userMessage })
      if (decision.shouldAsk === false) {
        decisions.push({ target, smartAuthorized: true, decision })
        continue
      }
    }
    const response = await askPathPermission(projectId, toolName, target, projectPath, options)
    const value = String(response.value || response.answer || '')
    if (!response.success || value === 'rejected') {
      return {
        success: false,
        rejected: true,
        error: `用户未允许访问项目外路径: ${target.path}`,
        target
      }
    }
    if (value === 'allow_always') {
      const rememberedOperation = target.reason === 'executable' ? target.operation : '*'
      const rule = pathPermissions.rememberAllowed(projectId, rememberedOperation, target.path, {
        scope: target.reason === 'executable' ? 'path' : 'directory',
        label: toolName,
        kind: target.reason === 'executable' ? 'application' : 'path'
      })
      decisions.push({ target, remembered: true, rule })
      continue
    }
    decisions.push({ target, once: true })
  }

  return { success: true, targets, decisions }
}

async function ensureExternalPathPermission(projectId, toolName, operation, targetPath, projectPath, reason = 'file', options = {}) {
  if (!targetPath || !projectPath) return { success: true, skipped: true }
  if (pathPermissions.isInsideProject(projectPath, targetPath)) return { success: true, insideProject: true }

  const existingRule = pathPermissions.findAllowedRule(projectId, operation, targetPath)
  if (existingRule) return { success: true, remembered: true, rule: existingRule }

  const target = { operation, path: targetPath, reason }
  const settings = pathPermissions.getSettings()
  if (settings.mode === 'smart') {
    const decision = await smartAuthorization.decideAuthorization({ toolName, target, taskContext: options.userMessage })
    if (decision.shouldAsk === false) return { success: true, smartAuthorized: true, decision }
  }
  const response = await askPathPermission(projectId, toolName, target, projectPath, options)
  const value = String(response.value || response.answer || '')
  if (!response.success || value === 'rejected') {
    return {
      success: false,
      rejected: true,
      error: `用户未允许访问项目外路径: ${targetPath}`,
      target
    }
  }

  if (value === 'allow_always') {
    const rule = pathPermissions.rememberAllowed(projectId, '*', targetPath, {
      scope: 'directory',
      label: toolName,
      kind: 'path'
    })
    return { success: true, remembered: true, rule, target }
  }

  return { success: true, once: true, target }
}

function normalizeChoiceOption(option, index) {
  if (!option || typeof option !== 'object' || Array.isArray(option)) return null
  const label = String(option.label ?? '').trim()
  const value = String(option.value ?? '').trim()
  const desc = String(option.desc ?? option.description ?? '').trim()
  const isGeneric = value => /^(?:选项|方案)\s*[#：:]?\s*\d+$|^choice[_-]?\d+$/i.test(String(value || '').trim())
  if (!label || isGeneric(label) || !value || desc.length < 6) return null
  return {
    ...option,
    label,
    value,
    desc
  }
}

/** 只透传模型明确给出的完整选项，不从 value 猜标题或说明。 */
function normalizeWebUiChoiceArgs(args = {}) {
  if (!args || typeof args !== 'object') return args
  if (!Array.isArray(args.options)) {
    return { ...args, options: [], _choiceValidation: { valid: false, reason: 'options 必须是数组' } }
  }
  const normalized = args.options.map(normalizeChoiceOption)
  const invalidIndexes = normalized.map((item, index) => item ? -1 : index).filter(index => index >= 0)
  const options = normalized.filter(Boolean)
  const valid = args._choiceValidation?.valid !== false && invalidIndexes.length === 0 && options.length >= 2 && options.length <= 3
  return {
    ...args,
    options,
    _choiceValidation: {
      valid,
      invalidIndexes,
      reason: valid ? '' : '每个选项都必须由模型提供非占位 label、value，以及至少 6 个字的 desc（做什么、影响或取舍理由）；选项总数必须为 2 到 3 个。'
    }
  }
}

function normalizeWebUiPlanArgs(args = {}) {
  return args
}

function waitForAskResponse(projectId, requestId, timeoutMs = 30 * 60 * 1000, options = {}) {
  return new Promise((resolve, reject) => {
    let settled = false
    const controller = projectId ? config.getAbortController(projectId) : null
    const signal = controller?.signal

    const cleanup = () => {
      clearTimeout(timer)
      pendingAskRequests.delete(requestId)
      if (signal && onAbort) signal.removeEventListener('abort', onAbort)
    }

    const finish = (data) => {
      if (settled) return
      settled = true
      cleanup()
      resolve(normalizeAskResponse(data))
    }

    const fail = (error) => {
      if (settled) return
      settled = true
      cleanup()
      reject(error)
    }

    const timer = setTimeout(() => {
      fail(new Error('等待用户选择超时'))
    }, timeoutMs)

    const onAbort = () => {
      const error = new Error('用户已中断等待')
      error.name = 'AbortError'
      fail(error)
    }

    if (signal) {
      if (signal.aborted) {
        onAbort()
        return
      }
      signal.addEventListener('abort', onAbort, { once: true })
    }

    // 修复：同一项目若已有挂起的 ask，先把旧的当 superseded 结算掉，
    // 避免旧 requestId 仍占着 Map，导致前端新弹窗点选时 IPC 找不到对应请求。
    if (projectId && !options.allowConcurrent) {
      for (const [existingId, existing] of pendingAskRequests.entries()) {
        if (existingId === requestId) continue
        if (existing && existing.projectId === projectId && !existing.allowConcurrent) {
          console.warn("[Tools] 检测到同项目已有挂起的 ask 请求，先清理旧的:", existingId)
          try {
            existing.finish({ requestId: existingId, projectId, type: "superseded", value: "superseded", answer: "已切换到新的询问" })
          } catch (err) {
            console.warn("[Tools] 清理旧 ask 请求失败:", err && err.message)
          }
        }
      }
    }

    pendingAskRequests.set(requestId, { projectId, finish, allowConcurrent: !!options.allowConcurrent })
  })
}

function sendAskAck(sender, payload) {
  // 修复：用户长时间未点选后，旧的 requestId 已被清理或被新请求覆盖。
  // 之前直接 return 让用户以为选完了但 AI 还在等待。
  // 现在回送 ack 事件，前端收到 ok=false 时可以明确告知用户该选择已过期，请重新选择或输入。
  if (!sender || (typeof sender.isDestroyed === "function" && sender.isDestroyed())) return
  try {
    sender.send("ask-popup-response-ack", payload)
  } catch (err) {
    console.warn("[Tools] 发送 ask-popup-response-ack 失败:", err && err.message)
  }
}

function registerToolAskIPC(ipcMain) {
  if (askIpcRegistered) return
  askIpcRegistered = true

  ipcMain.on("ask-popup-response", (event, data = {}) => {
    const requestId = data.requestId
    const pending = pendingAskRequests.get(requestId)
    if (!pending) {
      console.warn("[Tools] ask-popup-response 收到未知或已过期的 requestId:", requestId, "pendingAskRequests size:", pendingAskRequests.size)
      sendAskAck(event.sender, { requestId, ok: false, reason: "no-pending-request" })
      return
    }
    if (pending.projectId && data.projectId && pending.projectId !== data.projectId) {
      console.warn("[Tools] ask-popup-response projectId 不匹配:", pending.projectId, "vs", data.projectId)
      sendAskAck(event.sender, { requestId, ok: false, reason: "project-mismatch" })
      return
    }
    pending.finish(data)
    sendAskAck(event.sender, { requestId, ok: true })
  })
}

/**
 * 工具执行函数（多项目支持）
 */
async function executeToolForProject(name, args, projectPath, resolvePath, contextManager, projectId = null, modelConfig = null, options = {}) {
  const toolStartedAt = Date.now()
  const toolTraceId = String(options.toolTraceId || crypto.randomUUID())
  options = { ...options, toolTraceId }
  console.log('[Tool] 执行:', name, summarizeToolArgsForLog(args), '项目:', projectPath)
  const finishToolObservation = observability.startOperation('tool', name, {
    projectId,
    projectPath,
    argKeys: Object.keys(args || {}),
    traceId: toolTraceId,
    parentTraceId: options.parentToolTraceId || '',
    parentToolName: options.parentToolName || '',
    requestedTool: options.requestedTool || name,
    requestedAction: options.requestedAction || ''
  })
  const mainWindow = config.getMainWindow()
  const signal = options.signal
  if (signal?.aborted) {
    const abortedResult = { success: false, aborted: true, error: 'tool aborted before start' }
    finishToolObservation({ status: 'aborted', error: abortedResult.error, projectId })
    return abortedResult
  }
  const blockedByIntent = checkToolBlockedByUserIntent(name, getUserIntentToolPolicy(options.userMessage || ''))
  if (blockedByIntent) {
    finishToolObservation({ status: 'blocked', error: blockedByIntent.error || blockedByIntent.message, projectId })
    return blockedByIntent
  }
  const blockedTemporaryDownload = getTemporaryAgentDownloadBlock(name, args || {}, projectId)
  if (blockedTemporaryDownload) {
    finishToolObservation({ status: 'blocked', error: blockedTemporaryDownload.error, projectId })
    return blockedTemporaryDownload
  }

  const workspaceContext = await projects.prepareStatelessToolContext(projectId, name, args || {}, options)
  if (!workspaceContext.success) {
    const workspaceError = normalizeToolErrorResult(name, workspaceContext)
    finishToolObservation({ status: 'blocked', error: workspaceError.error, projectId })
    return workspaceError
  }
  if (workspaceContext.projectPath) {
    projectPath = workspaceContext.projectPath
    const activeInstance = projects.getProjectInstance(projectId)
    contextManager = activeInstance?.contextManager || contextManager
    resolvePath = inputPath => {
      if (!inputPath) return projectPath
      const normalizedPath = String(inputPath).replace(/\//g, '\\')
      return path.isAbsolute(normalizedPath) ? normalizedPath : path.join(projectPath, normalizedPath)
    }
  }

  let result
  try {
    const permission = await ensurePathPermission(name, args || {}, projectPath, resolvePath, projectId, options)
    if (!permission.success) {
      finishToolObservation({ status: 'blocked', error: permission.error || permission.message, projectId })
      return permission
    }
  } catch (error) {
    const errorResult = normalizeToolErrorResult(name, {}, error)
    finishToolObservation({ status: 'error', error: errorResult.error, projectId })
    return errorResult
  }
  try {
  const gatewayResult = await toolGateway.dispatchTool({
    name,
    args,
    projectPath,
    resolvePath,
    projectId,
    modelConfig,
    options,
    contextManager,
    signal,
    executeToolForProject
  })
  if (gatewayResult.handled) {
    result = gatewayResult.result
  } else {
  switch (name) {
    case 'report_progress':
    case 'show_thinking_note':
      result = {
        success: true,
        internal: true,
        thinkingNote: name === 'show_thinking_note',
        progressStatus: String(args?.status || args?.message || args?.content || args?.progress || args?.note || '').trim(),
        message: name === 'show_thinking_note' ? 'Thinking note accepted.' : 'Progress status accepted.'
      }
      break
    case 'lxweb':
      result = await browserTool.lxweb(args || {}, {
        projectId,
        webContents: projectId ? projects.getWebContentsForProject(projectId) : config.getMainWindow()?.webContents
      })
      break
    case 'browser_search':
      result = (args.queries || args.query_list || args.queryList || args.keywords || args.keywordList)
        ? await browserTool.searchMany(args.queries || args.query_list || args.queryList || args.keywords || args.keywordList, args.engine || 'auto')
        : await browserTool.search(args.query, args.engine || 'auto')
      break
    case 'browser_fetch':
      result = await browserTool.fetch(args.url)
      break
    case 'browser_open':
      result = await browserTool.open(args.url)
      break
    case 'recall_history':
      if (contextManager) {
        // 传整个 args 对象，支持 query/order/turn/time_range/max_results
        result = contextManager.recallHistory(args, args.max_results || 5)
      } else {
        result = { error: '派送任务不支持历史召回' }
      }
      break

    case 'read_task_ledger_entry':
      try {
        const entryId = args.entry_id || args.entryId || args.id
        const instance = projectId ? projects.getProjectInstance(projectId) : null
        if (!instance) {
          result = { success: false, error: 'project instance not found' }
        } else {
          result = taskLedger.getEntry(instance, entryId)
        }
      } catch (e) {
        result = { success: false, error: e.message }
      }
      break

    case 'get_latest_change_session':
      try {
        result = changeSessions.getLatestChangeSessionForTool(projectId)
      } catch (e) {
        result = { success: false, error: e.message }
      }
      break

    case 'rollback_latest_change_session':
      try {
        const latest = changeSessions.getLatestChangeSessionForTool(projectId)
        if (!latest.success || !latest.session?.id) {
          result = latest
        } else {
          result = await changeSessions.rollbackChangeSession(projectId, latest.session.id, {
            force: !!args.force,
            paths: args.paths || args.file_paths || args.filePaths || []
          })
        }
      } catch (e) {
        result = { success: false, error: e.message }
      }
      break

    case 'find_software':
      try {
        result = softwareAccess.findSoftware(args)
      } catch (e) {
        result = { success: false, error: e.message }
      }
      break

    case 'open_software':
      try {
        result = softwareAccess.openSoftware(args, { visible: args.visible !== false })
      } catch (e) {
        result = { success: false, error: e.message }
      }
      break

    case 'blender_status':
      try {
        result = blenderControl.getBlenderStatus()
      } catch (e) {
        result = { success: false, error: e.message }
      }
      break

    case 'blender_run_script':
      try {
        result = await blenderControl.runBlenderScript(args, projectPath)
      } catch (e) {
        result = { success: false, error: e.message }
      }
      break

    case 'blender_create_demo_model':
      try {
        result = await blenderControl.createDemoModel(args, projectPath)
      } catch (e) {
        result = { success: false, error: e.message }
      }
      break

    case 'blender_modify_scene':
      try {
        result = await blenderControl.modifyBlenderScene(args, projectPath)
      } catch (e) {
        result = { success: false, error: e.message }
      }
      break

    case 'blender_import_asset':
      try {
        const rawSourcePath = args.path || args.source_path || args.sourcePath
        if (rawSourcePath) {
          const sourcePath = resolvePath(rawSourcePath)
          const permission = await ensureExternalPathPermission(projectId, name, 'blender_import_asset', sourcePath, projectPath, 'file', options)
          if (!permission.success) {
            result = permission
            break
          }
          result = await blenderControl.importBlenderAsset({ ...args, path: sourcePath }, projectPath)
        } else {
          result = { success: false, error: 'path is required' }
        }
      } catch (e) {
        result = { success: false, error: e.message }
      }
      break

    case 'blender_inspect_scene':
      try {
        result = await blenderControl.inspectBlenderScene(args, projectPath)
      } catch (e) {
        result = { success: false, error: e.message }
      }
      break

    // ===== Agent 协作控制台 =====
    case 'request_agent_collaboration':
      if (projects.getProjectInstance(projectId)?.isTemporaryAgentChat) {
        result = {
          success: false,
          disabled: true,
          error: '临时 AI 执行实例不能继续启动新的临时多 AI。'
        }
      } else {
        result = await agentCollaboration.requestCollaboration(projectId, {
          ...args,
          fallbackModelConfig: modelConfig || null,
          executionKind: 'temporary_chat',
          userMessage: options.userMessage || ''
        })
      }
      break
    case 'get_agent_collaboration_status':
      result = agentCollaboration.getStatus(projectId, args.session_id || args.sessionId || null)
      break

    // ===== 智能执行系统工具 =====
    case 'enter_plan_mode':
      result = { success: true, mode: 'plan', reason: args.reason, plan: args.initial_plan || [] }
      // 发送到项目对应的 webContents
      const planWebContents = projectId ? projects.getWebContentsForProject(projectId) : mainWindow?.webContents
      planWebContents?.send('mode-change', { phase: 'plan', plan: args.initial_plan || [], projectId })
      break
    case 'ask_user_choice': {
      args = normalizeWebUiChoiceArgs(args)
      if (args._choiceValidation?.valid !== true) {
        result = {
          success: false,
          error: '询问选项不完整，弹窗未显示。请重新调用 ask_user_choice：每项必须明确提供给用户看的 label、实际返回值 value，以及说明“做什么、影响和取舍理由”的 desc；不要把 build/dev 等内部值直接当标题。',
          invalid_options: true,
          validation: args._choiceValidation
        }
        break
      }
      const askWebContents = projectId ? projects.getWebContentsForProject(projectId) : mainWindow?.webContents
      const choiceRequestId = createAskRequestId(projectId, 'choice')
      askWebContents?.send('show-ask-popup', { requestId: choiceRequestId, type: 'plan', projectId, question: args.question, options: args.options, recommended: args.recommended })
      try { require('./desktop-pet').notifyAiStatus('waiting') } catch (_) { /* ignore */ }
      sendThinkingEvent(askWebContents, projectId, {
        kind: 'progress',
        content: '等待你选择处理方向。'
      })
      result = await waitForAskResponse(projectId, choiceRequestId)
      try { require('./desktop-pet').notifyAiStatus('running') } catch (_) { /* ignore */ }
      break
    }
    case 'confirm_plan': {
      args = normalizeWebUiPlanArgs(args)
      const confirmWebContents = projectId ? projects.getWebContentsForProject(projectId) : mainWindow?.webContents
      const confirmRequestId = createAskRequestId(projectId, 'confirm')
      const confirmPlanSteps = Array.isArray(args.plan) ? args.plan : []
      confirmWebContents?.send('plan-confirm', { requestId: confirmRequestId, projectId, plan: confirmPlanSteps, summary: args.summary })
      try { require('./desktop-pet').notifyAiStatus('waiting') } catch (_) { /* ignore */ }
      result = await waitForAskResponse(projectId, confirmRequestId)
      try { require('./desktop-pet').notifyAiStatus('running') } catch (_) { /* ignore */ }
      // 用户确认执行后，立即推送输入框上方待办面板初始状态
      if (result && result.success !== false && result.status !== 'user_rejected' && confirmPlanSteps.length > 0) {
        confirmWebContents?.send('mode-change', {
          phase: 'auto-exec',
          steps: confirmPlanSteps,
          plan: confirmPlanSteps,
          projectId
        })
        confirmWebContents?.send('step-complete', {
          projectId,
          steps: confirmPlanSteps,
          index: -1,
          currentStepIndex: 0,
          status: 'running',
          phase: args.summary || '执行中...',
          totalSteps: confirmPlanSteps.length
        })
      }
      break
    }
    case 'enter_auto_mode':
      result = {
        success: true,
        ignored: true,
        mode: 'manual-tool-progress',
        message: '自动步骤进度已停用。请直接继续执行真实工具调用。'
      }
      break
    case 'ask_step_confirm':
      result = {
        success: true,
        ignored: true,
        message: '每步询问工具已停用。需要用户确认时请使用 confirm_plan 或普通回复说明需要确认的操作。'
      }
      break
    case 'complete_step': {
      const steps = Array.isArray(args.steps) ? args.steps : []
      const stepIndex = Number(args.step_index)
      const status = String(args.status || 'completed')
      const totalSteps = Number(args.total_steps) || steps.length || 0
      const phase = args.phase || '执行中...'
      let currentStepIndex = Number.isFinite(stepIndex) ? stepIndex : 0
      // completed：该步已完成，高亮下一步；running/failed：高亮当前步
      if (status === 'completed' && Number.isFinite(stepIndex)) {
        currentStepIndex = stepIndex + 1
      } else if ((status === 'running' || status === 'failed') && Number.isFinite(stepIndex)) {
        currentStepIndex = stepIndex
      }
      if (totalSteps > 0) {
        currentStepIndex = Math.max(0, Math.min(currentStepIndex, totalSteps))
      }
      const payload = {
        projectId,
        steps,
        index: Number.isFinite(stepIndex) ? stepIndex : 0,
        currentStepIndex,
        status,
        phase,
        totalSteps,
        stepIndex: Number.isFinite(stepIndex) ? stepIndex : 0
      }
      const stepWebContents = projectId ? projects.getWebContentsForProject(projectId) : mainWindow?.webContents
      stepWebContents?.send('step-complete', payload)
      result = {
        success: true,
        stepIndex: payload.stepIndex,
        totalSteps: payload.totalSteps,
        steps: payload.steps,
        status: payload.status,
        phase: payload.phase,
        currentStepIndex: payload.currentStepIndex
      }
      break
    }

    default:
      result = { success: false, error: `未知工具: ${name}` }
  }
  } // end of gateway legacy switch

  result = normalizeToolResult(name, result)
  const status = result?.aborted ? 'aborted' : (result?.success === false || result?.error ? 'error' : 'ok')
  const durationMs = Date.now() - toolStartedAt
  if (durationMs >= 1200) {
    console.warn('[ToolSlow]', {
      name,
      projectId,
      durationMs,
      status,
      argKeys: Object.keys(args || {})
    })
  }
  finishToolObservation({
    status,
    error: result?.error,
    projectId,
    meta: {
      success: result?.success,
      aborted: result?.aborted,
      resultKeys: result && typeof result === 'object' ? Object.keys(result).slice(0, 20) : []
    }
  })
  safelyRegisterAssetLibraryEvent({
    projectId,
    projectPath,
    toolName: name,
    args,
    result
  })
  return result
  } catch (error) {
    const errorResult = normalizeToolErrorResult(name, {}, error)
    const durationMs = Date.now() - toolStartedAt
    if (durationMs >= 1200) {
      console.warn('[ToolSlow]', {
        name,
        projectId,
        durationMs,
        status: 'error',
        error: errorResult.error,
        argKeys: Object.keys(args || {})
      })
    }
    finishToolObservation({ status: 'error', error: errorResult.error, projectId })
    return errorResult
  }
}

function safelyRegisterAssetLibraryEvent(event) {
  if (event.result?._tool_route?.routed_tool) return
  setImmediate(() => {
    try {
      assetLibrary.registerToolResult(event.toolName, event.args, event.result, {
        projectId: event.projectId,
        projectPath: event.projectPath
      })
    } catch (error) {
      console.warn('[AssetLibrary] register failed:', error.message)
    }
  })
}

module.exports = {
  executeToolForProject,
  registerToolAskIPC,
  waitForAskResponse,
  createAskRequestId,
  normalizeAskResponse
}
