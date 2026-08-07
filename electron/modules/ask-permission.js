/**
 * 工具权限与用户询问系统
 * 从 tools.js 提取，负责：
 *   - 路径权限询问（项目外访问授权）
 *   - 通用 ask 弹窗（ask_user_choice / confirm_plan / plan 模式）
 *   - 临时 Agent 下载拦截
 *   - 沉浸式 Web 工作流选项归一化
 *   - ask-popup IPC 注册
 *
 * 依赖：config / projects / path-permissions / agent-collaboration-reports /
 *      blender-control / software-access
 *
 * 注意：能力型权限（askVisionPermission / askImageGenerationPermission /
 *       inspectImageWithPermission）因强依赖图像/视觉模块，仍保留在 tools.js。
 */

const path = require('path')
const config = require('./config')
const projects = require('./projects')
const pathPermissions = require('./path-permissions')
const agentCollaborationReports = require('./agent-collaboration-reports')
const blenderControl = require('./blender-control')
const softwareAccess = require('./software-access')

// 模块级状态：挂起的 ask 请求表 + IPC 注册标记
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

function getPathPermissionTarget(toolName, args = {}, projectPath = '', resolvePath = input => input) {
  const list = getPathPermissionTargets(toolName, args, projectPath, resolvePath)
  return list.length ? list[0] : null
}

function getPathPermissionTargets(toolName, args = {}, projectPath = '', resolvePath = input => input) {
  if (!toolName) return []
  const out = []
  const push = (p, reason, operation = toolName) => {
    if (!p && p !== 0) return
    const str = String(p).trim()
    if (!str) return
    out.push({ operation, path: resolvePath(str), reason })
  }

  if (['read_file', 'write_file', 'edit_file', 'delete_file', 'text_edit', 'json_edit',
       'check_syntax', 'find_in_file'].includes(toolName) && args.path) {
    push(args.path, 'file')
  }
  if (['create_directory', 'list_files'].includes(toolName)) {
    push(args.path || '', 'directory')
  }
  if (toolName === 'glob_files' && args.path) push(args.path, 'directory')
  if (toolName === 'read_many_files' && Array.isArray(args.files)) {
    args.files.forEach(item => { if (item && item.path) push(item.path, 'file') })
  }
  if (['copy_file', 'move_file'].includes(toolName)) {
    if (args.source) push(args.source, 'source')
    if (args.destination) push(args.destination, 'destination')
  }
  if (toolName === 'create_file_session' && args.path) push(args.path, 'file')
  if (toolName === 'apply_patch' && typeof args.patch === 'string') {
    const re = /^\*\*\* (?:Update|Add|Delete) File:\s*(.+?)\s*$/gm
    let m
    while ((m = re.exec(args.patch)) !== null) push(m[1], 'patch_target')
    const reMove = /^\*\*\* Move to:\s*(.+?)\s*$/gm
    while ((m = reMove.exec(args.patch)) !== null) push(m[1], 'patch_move_to')
  }
  if (toolName === 'render_svg_asset') {
    if (args.output_path) push(args.output_path, 'output')
    if (args.svg_path) push(args.svg_path, 'input')
  }
  if (['runtime_verify', 'capture_screenshot', 'research_website_runtime', 'inspect_image',
       'view_image'].includes(toolName)) {
    if (args.html_path) push(args.html_path, 'html_path')
    if (args.path) push(args.path, 'file')
  }
  if (toolName === 'run_command') push(args.cwd || '', 'cwd')
  if (toolName === 'terminal_run') push(args.cwd || projectPath, 'cwd')
  if (toolName === 'shell_run' && args.cwd) push(args.cwd, 'cwd')
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
      } catch (_) { /* ignore */ }
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
  const target = getPathPermissionTarget(toolName, args, projectPath, resolvePath)
  if (!target?.path || !projectPath) return { success: true, skipped: true }
  if (options.collaborationReportFilePath && path.resolve(target.path) === path.resolve(options.collaborationReportFilePath)) {
    return { success: true, collaborationReport: true, target }
  }
  if (options.collaborationSessionId && agentCollaborationReports.isInsideReportsDir(target.path)) {
    return { success: true, collaborationReport: true, target }
  }
  if (pathPermissions.isInsideProject(projectPath, target.path)) return { success: true, insideProject: true }

  const existingRule = pathPermissions.findAllowedRule(projectId, target.operation, target.path)
  if (existingRule) return { success: true, remembered: true, rule: existingRule }

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
    return { success: true, remembered: true, rule, target }
  }

  return { success: true, once: true, target }
}

async function ensureExternalPathPermission(projectId, toolName, operation, targetPath, projectPath, reason = 'file', options = {}) {
  if (!targetPath || !projectPath) return { success: true, skipped: true }
  if (pathPermissions.isInsideProject(projectPath, targetPath)) return { success: true, insideProject: true }

  const existingRule = pathPermissions.findAllowedRule(projectId, operation, targetPath)
  if (existingRule) return { success: true, remembered: true, rule: existingRule }

  const target = { operation, path: targetPath, reason }
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

module.exports = {
  pendingAskRequests,
  createAskRequestId,
  normalizeAskResponse,
  getPathPermissionTarget,
  getPathPermissionTargets,
  askPathPermission,
  isTemporaryAgentDownloadCommand,
  getTemporaryAgentDownloadBlock,
  ensurePathPermission,
  ensureExternalPathPermission,
  normalizeChoiceOption,
  normalizeWebUiChoiceArgs,
  normalizeWebUiPlanArgs,
  waitForAskResponse,
  sendAskAck,
  registerToolAskIPC
}
