/**
 * 桌面操控服务：语义 UIA + 窗口相对坐标/键盘注入（SendInput）
 * 通过 windows-uia-runtime 适配器调用原生脚本，不暴露 shell 捷径。
 */

const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const storageConfig = require('../storage-config')
const softwareAccess = require('../software-access')

const windowsById = new Map()
const lastStateById = new Map()

function getUia() {
  return require('../windows-uia-runtime-adapter')
}

function unsupportedPlatform() {
  return {
    success: false,
    unsupported: true,
    error: '桌面操控目前仅支持 Windows'
  }
}

function normalizeWindowRecord(raw = {}) {
  const handle = raw.handle ?? raw.id
  if (handle === undefined || handle === null || handle === '') return null
  const id = String(handle)
  const executablePath = String(raw.executable_path || raw.executablePath || '').trim()
  const app = String(raw.app || path.basename(executablePath) || '').trim()
  const record = {
    id,
    handle: Number(handle) || handle,
    process_id: Number(raw.process_id || raw.processId || 0) || null,
    title: String(raw.title || ''),
    executable_path: executablePath,
    app
  }
  windowsById.set(id, record)
  return record
}

function rememberWindows(list = []) {
  const out = []
  for (const item of Array.isArray(list) ? list : []) {
    const record = normalizeWindowRecord(item)
    if (record) out.push(record)
  }
  return out
}

function resolveWindowRef(windowRef = {}) {
  if (windowRef == null || windowRef === '') {
    return { success: false, error: '需要 window 对象（来自 list_windows / list_apps 返回的 id）' }
  }
  if (typeof windowRef === 'number' || typeof windowRef === 'string') {
    const id = String(windowRef)
    const cached = windowsById.get(id)
    if (cached) return { success: true, window: cached }
    return { success: true, window: normalizeWindowRecord({ handle: windowRef, id: windowRef }) }
  }
  if (typeof windowRef === 'object') {
    const id = String(windowRef.id ?? windowRef.handle ?? '')
    if (!id) return { success: false, error: 'window.id 缺失；请使用列表返回的窗口对象' }
    const cached = windowsById.get(id)
    if (cached) {
      return {
        success: true,
        window: {
          ...cached,
          title: windowRef.title || cached.title,
          app: windowRef.app || cached.app
        }
      }
    }
    const created = normalizeWindowRecord(windowRef)
    if (!created) return { success: false, error: '无法解析 window 对象' }
    return { success: true, window: created }
  }
  return { success: false, error: 'window 参数格式无效' }
}

function getWindowExecutable(windowRef = {}) {
  const resolved = resolveWindowRef(windowRef)
  if (!resolved.success) return ''
  return String(resolved.window.executable_path || '').trim()
}

function ensureScreenshotDir() {
  let base = ''
  try {
    base = String(storageConfig.getCacheDir?.() || '').trim()
  } catch (_) {
    base = ''
  }
  if (!base) {
    base = path.join(require('os').tmpdir(), 'lingxi-desktop-control')
  }
  const dir = path.join(base, 'screenshots')
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  return dir
}

function savePngBase64(pngBase64 = '') {
  const buf = Buffer.from(String(pngBase64 || ''), 'base64')
  if (!buf.length) throw new Error('截图数据为空')
  const filePath = path.join(
    ensureScreenshotDir(),
    `desktop-${Date.now()}-${crypto.randomBytes(3).toString('hex')}.png`
  )
  fs.writeFileSync(filePath, buf)
  return {
    id: path.basename(filePath, '.png'),
    path: filePath,
    size: buf.length
  }
}

function filterWindows(windows = [], query = '', limit = 80) {
  const q = String(query || '').trim().toLowerCase()
  let list = windows
  if (q) {
    // support simple alternation: a|b|c
    const parts = q.split('|').map(s => s.trim()).filter(Boolean)
    list = list.filter(w => {
      const hay = `${w.title} ${w.app} ${w.executable_path}`.toLowerCase()
      return parts.some(p => hay.includes(p))
    })
  }
  const max = Math.min(Math.max(Number(limit) || 80, 1), 200)
  return list.slice(0, max)
}

function waitMs(ms) {
  const n = Math.min(Math.max(Number(ms) || 0, 0), 3000)
  if (!n) return Promise.resolve()
  return new Promise(resolve => setTimeout(resolve, n))
}

async function listWindows(input = {}) {
  if (process.platform !== 'win32') return unsupportedPlatform()
  const uia = getUia()
  const payload = {}
  if (input.root_process_id || input.rootProcessId) {
    payload.root_process_id = Number(input.root_process_id || input.rootProcessId)
  }
  const result = await uia.runPowerShell('list', payload, Number(input.timeout) || 25000)
  if (!result.success) {
    return { success: false, error: result.error || '列出窗口失败', raw: result }
  }
  let windows = rememberWindows(result.windows)
  windows = filterWindows(windows, input.query || input.name || '', input.limit)
  return {
    success: true,
    method: 'list_windows',
    count: windows.length,
    windows,
    next_action: windows.length
      ? 'call_desktop_control_get_window_state_or_activate_window'
      : 'call_desktop_control_launch_app_or_refine_query'
  }
}

async function listApps(input = {}) {
  if (process.platform !== 'win32') return unsupportedPlatform()
  const open = await listWindows({ query: input.query || input.name || '', limit: input.limit || 120 })
  if (!open.success) return open

  const byApp = new Map()
  for (const win of open.windows) {
    const key = (win.executable_path || win.app || win.id).toLowerCase()
    if (!byApp.has(key)) {
      byApp.set(key, {
        id: win.executable_path || win.app || win.id,
        displayName: win.app || path.basename(win.executable_path || '') || win.title,
        isRunning: true,
        executable_path: win.executable_path,
        windows: []
      })
    }
    byApp.get(key).windows.push(win)
  }

  if (input.query || input.name || input.path) {
    try {
      const found = softwareAccess.findSoftware({
        name: input.query || input.name || '',
        path: input.path
      })
      if (found?.success && Array.isArray(found.candidates)) {
        for (const c of found.candidates.slice(0, 20)) {
          const exe = String(c.path || '')
          if (!exe) continue
          const key = exe.toLowerCase()
          if (byApp.has(key)) continue
          byApp.set(key, {
            id: exe,
            displayName: c.label || path.basename(exe),
            isRunning: false,
            executable_path: exe,
            windows: []
          })
        }
      }
    } catch (_) { /* ignore */ }
  }

  let apps = [...byApp.values()]
  const max = Math.min(Math.max(Number(input.limit) || 80, 1), 200)
  apps = apps.slice(0, max)
  return {
    success: true,
    method: 'list_apps',
    count: apps.length,
    apps,
    open_window_count: open.count,
    next_action: 'pick_one_app_then_get_window_state_or_launch_app'
  }
}

function launchApp(input = {}, options = {}) {
  if (process.platform !== 'win32') return unsupportedPlatform()
  const name = input.name || input.app || input.query || ''
  const explicitPath = input.path || input.executable || input.executable_path || input.app_path || ''
  const looksLikePath = /[\\/]|\.exe$/i.test(String(name))
  const result = softwareAccess.openSoftware({
    name: looksLikePath && !explicitPath ? '' : name,
    path: explicitPath || (looksLikePath ? name : ''),
    args: input.args,
    cwd: input.cwd,
    visible: options.visible !== false && input.visible !== false
  }, { visible: options.visible !== false && input.visible !== false })

  return {
    ...result,
    method: 'launch_app',
    next_action: result.success
      ? 'poll_list_windows_until_target_appears_then_activate_and_get_window_state'
      : 'refine_name_or_path_and_retry_launch_app'
  }
}

async function activateWindow(input = {}) {
  if (process.platform !== 'win32') return unsupportedPlatform()
  const resolved = resolveWindowRef(input.window || input)
  if (!resolved.success) return resolved
  const win = resolved.window
  const uia = getUia()
  const result = await uia.runPowerShell('activate', { handle: win.handle }, Number(input.timeout) || 15000)
  if (!result.success && result.activated === false) {
    return {
      success: false,
      method: 'activate_window',
      error: result.error || '无法前置窗口（可能句柄已失效）',
      window: win
    }
  }
  return {
    success: true,
    method: 'activate_window',
    activated: result.activated !== false,
    window: win,
    next_action: 'call_get_window_state_before_acting'
  }
}

async function getWindowState(input = {}) {
  if (process.platform !== 'win32') return unsupportedPlatform()
  const resolved = resolveWindowRef(input.window || input)
  if (!resolved.success) return resolved
  const win = resolved.window
  const includeScreenshot = input.include_screenshot !== false && input.includeScreenshot !== false
  const includeText = input.include_text === true || input.includeText === true || input.include_accessibility === true
  const maxNodes = Number(input.max_nodes || input.maxNodes || 400)
  const maxDepth = Number(input.max_depth || input.maxDepth || 8)
  const uia = getUia()

  // Codex-aligned: observation does not steal focus unless activate=true
  if (input.activate === true) {
    await uia.runPowerShell('activate', { handle: win.handle }, 10000).catch(() => {})
  }

  const state = {
    success: true,
    method: 'get_window_state',
    window: win,
    screenshots: [],
    accessibility: null,
    limitations: []
  }

  if (includeText) {
    const inspect = await uia.runPowerShell('inspect', {
      handle: win.handle,
      max_nodes: maxNodes,
      max_depth: maxDepth
    }, Number(input.timeout) || 25000)
    if (!inspect.success) {
      return { success: false, method: 'get_window_state', error: inspect.error || '读取可访问性树失败', window: win }
    }
    if (inspect.window_was_minimized) {
      state.window_was_minimized = true
      state.window_recovered_from_minimized = inspect.window_recovered_from_minimized === true
    }
    const nodes = flattenAccessibilityNodes(inspect.nodes)
    state.accessibility = {
      tree: formatTree(nodes) || inspect.tree || '',
      nodes: summarizeNodes(nodes, Number(input.node_preview || 80)),
      actionable_elements: summarizeActionableNodes(nodes, Number(input.actionable_preview || 120)),
      node_count: nodes.length,
      focused_element: inspect.focused_element || null,
      selected_text: inspect.selected_text || null,
      selected_elements: Array.isArray(inspect.selected_elements) ? inspect.selected_elements : [],
      document_text: inspect.document_text || null
    }
    lastStateById.set(win.id, {
      nodes,
      focused_element: inspect.focused_element || null,
      at: Date.now()
    })
  }

  if (includeScreenshot) {
    try {
      const capture = await uia.runPowerShell('capture', { handle: win.handle }, 20000)
      if (capture.window_was_minimized) {
        state.window_was_minimized = true
        state.window_recovered_from_minimized = capture.window_recovered_from_minimized === true
      }
      if (capture.success && capture.png) {
        const saved = savePngBase64(capture.png)
        state.screenshots.push({
          id: saved.id,
          path: saved.path,
          zIndex: 0,
          note: 'PrintWindow 优先，近似全黑时回退屏幕 CopyFromScreen'
        })
      } else {
        state.limitations.push(capture.error || '窗口截图失败')
      }
    } catch (error) {
      state.limitations.push(error.message || String(error))
    }
  }

  if (!includeText && !includeScreenshot) {
    state.limitations.push('include_text 与 include_screenshot 均为 false，仅返回窗口元数据')
  }

  state.next_action = includeText
    ? 'use_element_index_or_name_for_semantic_action; coordinates_require_image_verification'
    : 'call_get_window_state_with_include_text_true_before_acting'
  return state
}

function flattenAccessibilityNodes(value, output = []) {
  if (Array.isArray(value)) {
    for (const item of value) flattenAccessibilityNodes(item, output)
    return output
  }
  if (value && typeof value === 'object') {
    const hasNodeShape = value.index !== undefined || value.name !== undefined ||
      value.role !== undefined || value.automation_id !== undefined || value.rect !== undefined
    if (hasNodeShape) output.push(value)
  }
  return output
}

function formatTree(nodes = []) {
  return nodes.map(node => {
    const indent = '  '.repeat(Math.max(0, Number(node.depth) || 0))
    const label = node.name || '(unnamed)'
    const aid = node.automation_id ? ` id=${node.automation_id}` : ''
    return `${indent}[${node.index}] ${node.role}: ${label}${aid}`
  }).join('\n')
}

function summarizeNodes(nodes = [], limit = 80) {
  return nodes.slice(0, limit).map(n => ({
    index: n.index,
    name: n.name,
    role: n.role,
    automation_id: n.automation_id,
    enabled: n.enabled,
    offscreen: n.offscreen,
    focusable: n.focusable,
    depth: n.depth,
    rect: n.rect
  }))
}

const ACTIONABLE_ROLES = new Set([
  'button', 'edit', 'document', 'checkbox', 'radio', 'combobox', 'listitem',
  'menuitem', 'tabitem', 'treeitem', 'hyperlink', 'slider', 'spinner'
])

function isUsableNode(node = {}) {
  const rect = node.rect || {}
  return node.enabled !== false &&
    node.offscreen !== true &&
    Number(rect.width) > 0 &&
    Number(rect.height) > 0
}

function isActionableNode(node = {}) {
  return isUsableNode(node) && (
    ACTIONABLE_ROLES.has(String(node.role || '').toLowerCase()) ||
    node.focusable === true
  )
}

function summarizeActionableNodes(nodes = [], limit = 120) {
  return nodes
    .filter(isActionableNode)
    .slice(0, Math.max(1, limit))
    .map(n => ({
      index: n.index,
      name: n.name,
      role: n.role,
      automation_id: n.automation_id,
      enabled: n.enabled,
      focusable: n.focusable,
      rect: n.rect
    }))
}

function normalizeTargetText(value = '') {
  return String(value || '').trim().toLocaleLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '')
}

function observedTargetSummary(node = {}) {
  return {
    element_index: node.index,
    name: node.name || '',
    role: node.role || '',
    automation_id: node.automation_id || '',
    rect: node.rect || null
  }
}

function resolveObservedTarget(win, input = {}) {
  const observed = lastStateById.get(win.id)
  if (!observed || !Array.isArray(observed.nodes)) {
    return {
      success: false,
      observation_required: true,
      error: '没有可用于精准定位的控件树，请重新调用 get_window_state(include_text=true)。'
    }
  }

  const requestedIndex = input.element_index ?? input.elementIndex
  const requestedName = String(input.name || input.target_name || input.targetName || '').trim()
  const requestedRole = String(input.role || '').trim().toLowerCase()
  const requestedAutomationId = String(input.automation_id || input.automationId || '').trim()
  const expectedName = normalizeTargetText(requestedName)

  let candidates = observed.nodes.filter(isUsableNode)
  if (requestedAutomationId) {
    candidates = candidates.filter(node => String(node.automation_id || '') === requestedAutomationId)
  }
  if (requestedRole) {
    candidates = candidates.filter(node => String(node.role || '').toLowerCase() === requestedRole)
  }
  if (requestedName) {
    const exact = candidates.filter(node => normalizeTargetText(node.name) === expectedName)
    candidates = exact.length
      ? exact
      : candidates.filter(node => {
          const actual = normalizeTargetText(node.name)
          return actual && (actual.includes(expectedName) || expectedName.includes(actual))
        })
  }

  if (requestedIndex !== undefined && requestedIndex !== null && requestedIndex !== '') {
    const indexed = observed.nodes.find(node => Number(node.index) === Number(requestedIndex))
    if (!indexed) {
      return { success: false, target_mismatch: true, error: `观察结果中不存在控件 #${requestedIndex}，请重新观察。` }
    }
    if (!isUsableNode(indexed)) {
      return { success: false, target_mismatch: true, error: `控件 #${requestedIndex} 当前不可用或不可见，请重新观察。` }
    }
    if ((requestedName || requestedRole || requestedAutomationId) && !candidates.includes(indexed)) {
      return {
        success: false,
        target_mismatch: true,
        error: `控件 #${requestedIndex} 与目标名称/角色不一致，已拒绝操作。`,
        observed_target: observedTargetSummary(indexed)
      }
    }
    return { success: true, target: indexed }
  }

  if (!requestedName && !requestedRole && !requestedAutomationId) {
    return { success: false, target_required: true, error: '需要 element_index，或目标 name/role/automation_id。' }
  }
  if (candidates.length === 0) {
    return {
      success: false,
      target_not_found: true,
      error: '最新观察结果中找不到匹配控件，请重新观察，不要猜坐标。'
    }
  }
  if (candidates.length > 1) {
    return {
      success: false,
      target_ambiguous: true,
      error: `找到 ${candidates.length} 个同名或同角色控件，请使用明确的 element_index。`,
      candidates: candidates.slice(0, 8).map(observedTargetSummary)
    }
  }
  return { success: true, target: candidates[0] }
}

function locatorFromObservedTarget(target = {}) {
  const locator = {
    element_index: target.index,
    name: target.name || '',
    role: target.role || '',
    automation_id: target.automation_id || ''
  }
  if (!locator.name && !locator.automation_id && target.rect) locator.expected_rect = target.rect
  return locator
}

function findObservedNodeAtCoordinates(win, x, y) {
  const observed = lastStateById.get(win.id)
  if (!observed || !Array.isArray(observed.nodes) || !observed.nodes.length) return null
  const root = observed.nodes.find(node => Number(node.index) === 0) || observed.nodes[0]
  const rootRect = root?.rect || {}
  const screenX = Number(rootRect.x) + Number(x)
  const screenY = Number(rootRect.y) + Number(y)
  if (!Number.isFinite(screenX) || !Number.isFinite(screenY)) return null
  const hits = observed.nodes.filter(node => {
    if (!isActionableNode(node)) return false
    const rect = node.rect || {}
    return screenX >= Number(rect.x) && screenX < Number(rect.x) + Number(rect.width) &&
      screenY >= Number(rect.y) && screenY < Number(rect.y) + Number(rect.height)
  })
  hits.sort((a, b) => {
    const areaA = Number(a.rect?.width) * Number(a.rect?.height)
    const areaB = Number(b.rect?.width) * Number(b.rect?.height)
    return areaA - areaB || Number(b.depth || 0) - Number(a.depth || 0)
  })
  return hits[0] || null
}

async function act(input = {}) {
  if (process.platform !== 'win32') return unsupportedPlatform()
  const resolved = resolveWindowRef(input.window || input)
  if (!resolved.success) return resolved
  const win = resolved.window
  const uia = getUia()

  const locator = {
    name: input.name || input.locator?.name || input.text || '',
    role: input.role || input.locator?.role || '',
    automation_id: input.automation_id || input.automationId || input.locator?.automation_id || input.locator?.automationId || '',
    element_index: input.element_index ?? input.elementIndex ?? input.locator?.element_index ?? input.locator?.elementIndex
  }

  const hasLocator = (locator.element_index !== undefined && locator.element_index !== null && locator.element_index !== '')
    || locator.name || locator.role || locator.automation_id
  if (!hasLocator) {
    return {
      success: false,
      method: 'act',
      error: 'act 需要 element_index，或 name/role/automation_id 定位器。先 get_window_state(include_text=true)。'
    }
  }

  const targetResolution = resolveObservedTarget(win, locator)
  if (!targetResolution.success) {
    return { success: false, method: 'act', window: win, ...targetResolution }
  }
  Object.assign(locator, locatorFromObservedTarget(targetResolution.target))

  const payload = {
    handle: win.handle,
    locator,
    element_index: locator.element_index,
    operation: input.operation || input.action || 'invoke',
    value: input.value ?? '',
    wait_after_ms: input.wait_after_ms ?? input.waitAfterMs ?? 300,
    max_depth: input.max_depth || input.maxDepth || 8
  }

  const result = await uia.runPowerShell('action', payload, Number(input.timeout) || 25000)
  if (!result.success) {
    return {
      success: false,
      method: 'act',
      found: result.found === true,
      error: result.error || '桌面动作失败',
      window: win,
      locator
    }
  }
  return {
    success: true,
    method: 'act',
    found: true,
    performed: result.performed,
    element: result.element,
    window: win,
    next_action: 'call_get_window_state_to_verify'
  }
}

function requireFinite(name, value) {
  const n = Number(value)
  if (!Number.isFinite(n)) throw new Error(`${name} must be a finite number`)
  return Math.round(n)
}

async function click(input = {}) {
  if (process.platform !== 'win32') return unsupportedPlatform()
  const resolved = resolveWindowRef(input.window || input)
  if (!resolved.success) return resolved
  const win = resolved.window
  const hasIndex = input.element_index !== undefined && input.element_index !== null && input.element_index !== ''
  const hasNamedTarget = !!String(
    input.name || input.target_name || input.targetName || input.role || input.automation_id || input.automationId || ''
  ).trim()
  const hasCoord = input.x !== undefined && input.x !== null && input.y !== undefined && input.y !== null
  if (!hasIndex && !hasNamedTarget && !hasCoord) {
    return {
      success: false,
      method: 'click',
      error: 'click 需要 element_index、目标 name/role/automation_id，或经截图验证的窗口相对坐标 x+y'
    }
  }

  const payload = {
    handle: win.handle,
    mouse_button: input.mouse_button || input.button || 'left',
    click_count: input.click_count || input.clickCount || 1,
    wait_after_ms: input.wait_after_ms ?? input.waitAfterMs ?? 200,
    max_depth: input.max_depth || input.maxDepth || 8
  }
  let preciseTarget = null
  let coordinateConversion = null
  const uia = getUia()
  if (hasIndex || hasNamedTarget) {
    const targetResolution = resolveObservedTarget(win, input)
    if (!targetResolution.success) {
      return { success: false, method: 'click', window: win, ...targetResolution }
    }
    preciseTarget = targetResolution.target
    const locator = locatorFromObservedTarget(preciseTarget)
    payload.element_index = Number(locator.element_index)
    payload.locator = locator
  } else if (hasCoord) {
    const rawX = requireFinite('x', input.x)
    const rawY = requireFinite('y', input.y)
    let x = rawX
    let y = rawY
    const coordinateSpace = String(input.coordinate_space || input.coordinateSpace || 'window').trim().toLowerCase()
    const bounds = await uia.runPowerShell('bounds', { handle: win.handle }, 10000).catch(() => null)
    if (bounds?.success) {
      const width = Number(bounds.width)
      const height = Number(bounds.height)
      const left = Number(bounds.left)
      const top = Number(bounds.top)
      const insideRelative = x >= 0 && y >= 0 && x < width && y < height
      const insideScreen = x >= left && y >= top && x < left + width && y < top + height
      if (coordinateSpace === 'screen' || (!insideRelative && insideScreen)) {
        x -= left
        y -= top
        coordinateConversion = {
          from: 'screen',
          to: 'window',
          original: { x: rawX, y: rawY },
          converted: { x, y },
          window_bounds: { x: left, y: top, width, height }
        }
      }
      if (x < 0 || y < 0 || x >= width || y >= height) {
        return {
          success: false,
          method: 'click',
          coordinate_outside_window: true,
          error: '坐标不在目标窗口内部。desktop_control 默认使用窗口相对坐标，不能把 window.rect 的 x/y 加进去。',
          requested_coordinates: { x: rawX, y: rawY },
          window_bounds: { x: left, y: top, width, height },
          next_action: 'retry_with_window_relative_coordinates_or_coordinate_space_screen'
        }
      }
    }
    const coordinateCandidate = findObservedNodeAtCoordinates(win, x, y)
    const coordinateVerified = input.coordinate_verified === true || input.coordinateVerified === true
    if (!coordinateVerified) {
      return {
        success: false,
        method: 'click',
        coordinate_confirmation_required: true,
        error: coordinateCandidate
          ? '坐标点击尚未执行：该位置命中了下列控件。请改用返回的 element_index/name 精准点击。'
          : '坐标点击尚未执行：请先用窗口截图确认坐标，并设置 coordinate_verified=true。',
        candidate: coordinateCandidate ? observedTargetSummary(coordinateCandidate) : null,
        requested_coordinates: { x, y },
        next_action: coordinateCandidate
          ? 'call_click_with_candidate_element_index_and_name'
          : 'analyze_screenshot_then_retry_with_coordinate_verified'
      }
    }
    payload.x = x
    payload.y = y
  }

  const result = await uia.runPowerShell('click', payload, Number(input.timeout) || 20000)
  if (!result.success) {
    return {
      success: false,
      method: 'click',
      error: result.error || 'click 失败',
      target: preciseTarget ? observedTargetSummary(preciseTarget) : null,
      window: win
    }
  }
  return {
    success: true,
    method: 'click',
    performed: result.performed || 'click',
    mode: result.mode,
    target: preciseTarget ? observedTargetSummary(preciseTarget) : null,
    x: result.x,
    y: result.y,
    mouse_button: result.mouse_button || payload.mouse_button,
    click_count: result.click_count || payload.click_count,
    coordinate_conversion: coordinateConversion,
    window: win,
    next_action: 'call_get_window_state_to_verify'
  }
}

async function drag(input = {}) {
  if (process.platform !== 'win32') return unsupportedPlatform()
  const resolved = resolveWindowRef(input.window || input)
  if (!resolved.success) return resolved
  const win = resolved.window
  try {
    const payload = {
      handle: win.handle,
      from_x: requireFinite('from_x', input.from_x ?? input.fromX),
      from_y: requireFinite('from_y', input.from_y ?? input.fromY),
      to_x: requireFinite('to_x', input.to_x ?? input.toX),
      to_y: requireFinite('to_y', input.to_y ?? input.toY),
      wait_after_ms: input.wait_after_ms ?? input.waitAfterMs ?? 200
    }
    const uia = getUia()
    const result = await uia.runPowerShell('drag', payload, Number(input.timeout) || 25000)
    if (!result.success) {
      return { success: false, method: 'drag', error: result.error || 'drag 失败', window: win }
    }
    return {
      success: true,
      method: 'drag',
      performed: 'drag',
      from_x: payload.from_x,
      from_y: payload.from_y,
      to_x: payload.to_x,
      to_y: payload.to_y,
      window: win,
      next_action: 'call_get_window_state_to_verify'
    }
  } catch (error) {
    return { success: false, method: 'drag', error: error.message || String(error), window: win }
  }
}

async function scroll(input = {}) {
  if (process.platform !== 'win32') return unsupportedPlatform()
  const resolved = resolveWindowRef(input.window || input)
  if (!resolved.success) return resolved
  const win = resolved.window
  try {
    const payload = {
      handle: win.handle,
      x: requireFinite('x', input.x),
      y: requireFinite('y', input.y),
      scrollX: Number(input.scrollX ?? input.scroll_x ?? 0) || 0,
      scrollY: Number(input.scrollY ?? input.scroll_y ?? 0) || 0,
      wait_after_ms: input.wait_after_ms ?? input.waitAfterMs ?? 200
    }
    const uia = getUia()
    const result = await uia.runPowerShell('scroll', payload, Number(input.timeout) || 20000)
    if (!result.success) {
      return { success: false, method: 'scroll', error: result.error || 'scroll 失败', window: win }
    }
    return {
      success: true,
      method: 'scroll',
      performed: 'scroll',
      x: payload.x,
      y: payload.y,
      scrollX: payload.scrollX,
      scrollY: payload.scrollY,
      window: win,
      next_action: 'call_get_window_state_to_verify'
    }
  } catch (error) {
    return { success: false, method: 'scroll', error: error.message || String(error), window: win }
  }
}

async function typeText(input = {}) {
  if (process.platform !== 'win32') return unsupportedPlatform()
  const resolved = resolveWindowRef(input.window || input)
  if (!resolved.success) return resolved
  const win = resolved.window
  const text = input.text != null ? String(input.text) : ''
  if (!text) {
    return { success: false, method: 'type_text', error: 'type_text 需要非空 text' }
  }
  const hasPreciseTarget = (input.element_index !== undefined && input.element_index !== null && input.element_index !== '')
    || input.name || input.target_name || input.targetName || input.role || input.automation_id || input.automationId
  let targetingMethod = ''
  if (hasPreciseTarget) {
    const focused = await act({
      window: win,
      element_index: input.element_index,
      name: input.name || input.target_name || input.targetName,
      role: input.role,
      automation_id: input.automation_id || input.automationId,
      operation: 'focus',
      wait_after_ms: 100
    })
    if (!focused.success) {
      return {
        success: false,
        method: 'type_text',
        focus_failed: true,
        error: focused.error || '无法精准聚焦目标输入框，已取消输入。',
        target: focused.observed_target || null,
        candidates: focused.candidates || [],
        window: win
      }
    }
    targetingMethod = 'accessibility_target'
  } else if (input.x != null && input.y != null) {
    const focused = await click({
      window: win,
      x: input.x,
      y: input.y,
      coordinate_verified: input.coordinate_verified === true || input.coordinateVerified === true,
      coordinate_space: input.coordinate_space || input.coordinateSpace,
      wait_after_ms: 100
    })
    if (!focused.success) {
      return {
        ...focused,
        method: 'type_text',
        focus_failed: true,
        error: focused.error || '无法确认坐标对应的输入框，已取消输入。'
      }
    }
    targetingMethod = 'verified_coordinate'
  } else {
    return {
      success: false,
      method: 'type_text',
      target_required: true,
      error: 'type_text 必须指定可访问性输入框，或提供经本轮截图确认的 x/y 与 coordinate_verified=true。不能用猜测的快捷键冒充输入框聚焦。',
      window: win,
      next_action: 'observe_and_target_input_by_element_or_verified_coordinates'
    }
  }

  const uia = getUia()
  const result = await uia.runPowerShell('type_text', {
    handle: win.handle,
    text,
    wait_after_ms: input.wait_after_ms ?? input.waitAfterMs ?? 150
  }, Number(input.timeout) || 30000)
  if (!result.success) {
    return { success: false, method: 'type_text', error: result.error || 'type_text 失败', window: win }
  }
  let submitted = false
  if (input.submit === true) {
    const submitResult = await pressKey({ window: win, key: 'Return', wait_after_ms: input.submit_wait_after_ms ?? 250 })
    if (!submitResult.success) {
      return {
        success: false,
        method: 'type_text',
        partial_success: true,
        typed: true,
        error: submitResult.error || '文字已输入，但按回车提交失败',
        window: win
      }
    }
    submitted = true
  }
  return {
    success: true,
    method: 'type_text',
    performed: submitted ? 'focus_type_and_submit' : 'type_text',
    targeting_method: targetingMethod,
    submitted,
    length: text.length,
    window: win,
    next_action: 'call_get_window_state_to_verify_final_result'
  }
}

async function pressKey(input = {}) {
  if (process.platform !== 'win32') return unsupportedPlatform()
  const resolved = resolveWindowRef(input.window || input)
  if (!resolved.success) return resolved
  const win = resolved.window
  const key = String(input.key || '').trim()
  if (!key) {
    return { success: false, method: 'press_key', error: 'press_key 需要 key（如 Return、Tab、Control_L+a）' }
  }
  if (/(^|\+)(meta|super|win|windows|cmd|command|os)(\+|$)/i.test(key)) {
    return {
      success: false,
      method: 'press_key',
      error: '禁止注入 Windows/Meta 键（安全策略）',
      key
    }
  }

  const uia = getUia()
  const result = await uia.runPowerShell('press_key', {
    handle: win.handle,
    key,
    wait_after_ms: input.wait_after_ms ?? input.waitAfterMs ?? 150
  }, Number(input.timeout) || 15000)
  if (!result.success) {
    return { success: false, method: 'press_key', error: result.error || 'press_key 失败', window: win, key }
  }
  if (result.unexpected_window_state_change === true) {
    return {
      success: false,
      method: 'press_key',
      performed: 'press_key',
      key,
      key_injected: true,
      effect_verified: false,
      unexpected_window_state_change: true,
      window_minimized: result.after_minimized === true,
      window_recovered: result.recovered === true,
      error: result.recovered === true
        ? '按键已发送，但目标窗口随即被最小化，说明该快捷键没有产生预期聚焦效果。窗口已恢复，已阻止后续盲目输入。'
        : '按键已发送，但目标窗口随即被最小化，且自动恢复失败。已阻止后续输入。',
      window: win,
      next_action: 'call_get_window_state_then_target_the_real_control'
    }
  }
  return {
    success: true,
    method: 'press_key',
    performed: 'press_key',
    key,
    key_injected: result.key_injected !== false,
    effect_verified: false,
    warning: '按键已发送，但发送成功不等于界面效果正确。后续动作前必须重新观察确认。',
    window: win,
    next_action: 'call_get_window_state_to_verify_key_effect_before_followup_input'
  }
}

function getCachedWindow(id) {
  return windowsById.get(String(id || '')) || null
}

function getObservationStatus(windowRef = {}, maxAgeMs = 30000) {
  const resolved = resolveWindowRef(windowRef)
  if (!resolved.success) {
    return { success: false, observed: false, error: resolved.error || '找不到目标窗口' }
  }
  const state = lastStateById.get(resolved.window.id)
  const ageMs = state?.at ? Math.max(0, Date.now() - Number(state.at)) : null
  const observed = !!state && ageMs <= Math.max(1000, Number(maxAgeMs) || 120000)
  return {
    success: true,
    observed,
    age_ms: ageMs,
    window: resolved.window,
    next_action: observed ? 'use_observed_target' : 'call_get_window_state_before_acting'
  }
}

function invalidateObservation(windowRef = {}) {
  const resolved = resolveWindowRef(windowRef)
  if (!resolved.success) return false
  return lastStateById.delete(resolved.window.id)
}

function resetForTests() {
  windowsById.clear()
  lastStateById.clear()
}

module.exports = {
  listWindows,
  listApps,
  launchApp,
  activateWindow,
  getWindowState,
  act,
  click,
  drag,
  scroll,
  typeText,
  pressKey,
  resolveWindowRef,
  getWindowExecutable,
  getCachedWindow,
  getObservationStatus,
  invalidateObservation,
  rememberWindows,
  resetForTests,
  waitMs
}
