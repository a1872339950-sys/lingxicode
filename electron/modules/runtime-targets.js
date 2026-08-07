const crypto = require('crypto')
const path = require('path')

const targets = new Map()
const runtimeIdByWebContentsId = new Map()
const observedWebContents = new WeakSet()
const observedWindows = new WeakSet()
let remoteDevelopmentTargetsSyncedAt = 0

function clean(value = '') {
  return String(value == null ? '' : value).trim()
}

function slug(value = '') {
  return clean(value)
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
}

function createRuntimeId(webContents, meta = {}) {
  const explicit = clean(meta.runtimeId || meta.runtime_id)
  if (explicit) return explicit
  const projectPart = slug(meta.projectId || meta.project_id || 'unscoped') || 'unscoped'
  const kindPart = slug(meta.kind || meta.type || 'window') || 'window'
  const wcPart = Number(webContents?.id) || crypto.randomBytes(3).toString('hex')
  return `runtime-${projectPart}-${kindPart}-${wcPart}`
}

function safeUrl(webContents, fallback = '') {
  try {
    return clean(webContents?.getURL?.() || fallback)
  } catch {
    return clean(fallback)
  }
}

function safeTitle(webContents, fallback = '') {
  try {
    return clean(webContents?.getTitle?.() || fallback)
  } catch {
    return clean(fallback)
  }
}

function currentBuildType() {
  try {
    return require('electron').app?.isPackaged ? 'installed' : 'development'
  } catch {
    return 'development'
  }
}

function shouldDiscoverRemoteDevelopmentTargets() {
  return currentBuildType() === 'installed' || process.env.LINGXI_DISCOVER_DEV_RUNTIME === '1'
}

function remoteWebContentsId(runtimeId) {
  const value = crypto.createHash('sha1').update(runtimeId).digest().readUInt32BE(0)
  return -(value || 1)
}

function syncRemoteDevelopmentTargets(force = false) {
  if (!shouldDiscoverRemoteDevelopmentTargets()) return
  const now = Date.now()
  if (!force && now - remoteDevelopmentTargetsSyncedAt < 1000) return
  remoteDevelopmentTargetsSyncedAt = now
  for (const [runtimeId, record] of targets) {
    if (record.remoteDevelopmentBridge) targets.delete(runtimeId)
  }
  try {
    const bridgeModule = require('./development-runtime-bridge')
    for (const bridge of bridgeModule.discoverDevelopmentBridges()) {
      for (const target of Array.isArray(bridge.targets) ? bridge.targets : []) {
        if (target.verification_eligible === false || target.observation_only === true) continue
        const runtimeId = `${bridge.bridge_id}:${target.runtime_id}`
        const webContentsId = remoteWebContentsId(runtimeId)
        const webContents = new bridgeModule.RemoteWebContents(bridge, target, webContentsId)
        targets.set(runtimeId, {
          runtimeId,
          projectId: clean(target.project_id),
          projectPath: clean(target.project_path || bridge.workspace_path),
          webContentsId,
          windowId: target.window_id || null,
          tabId: clean(target.tab_id),
          kind: clean(target.kind || 'remote-development-window'),
          source: 'development-runtime-bridge',
          title: clean(target.title),
          url: clean(target.url),
          adapter: clean(target.adapter || 'electron'),
          capabilities: { ...(target.capabilities || {}) },
          buildType: 'development',
          workspacePath: clean(bridge.workspace_path),
          executablePath: clean(bridge.executable_path),
          processId: Number(bridge.process_id) || null,
          observationOnly: false,
          active: target.active === true,
          createdAt: target.created_at || bridge.started_at || new Date(now).toISOString(),
          lastActiveAt: Number(target.last_active_at) || now,
          lastSeenAt: now,
          webContents,
          remoteDevelopmentBridge: true
        })
      }
    }
  } catch (error) {
    console.warn('[RuntimeTargets] development bridge discovery failed:', error.message)
  }
}

function isVerificationEligible(record) {
  return !!record && record.buildType !== 'installed' && record.observationOnly !== true
}

function sameWorkspace(left = '', right = '') {
  if (!left || !right) return false
  return path.normalize(path.resolve(left)).toLowerCase() === path.normalize(path.resolve(right)).toLowerCase()
}

function publicTarget(record) {
  if (!record) return null
  return {
    runtime_id: record.runtimeId,
    project_id: record.projectId || '',
    project_path: record.projectPath || '',
    web_contents_id: record.webContentsId,
    window_id: record.windowId || null,
    tab_id: record.tabId || '',
    kind: record.kind || 'window',
    source: record.source || '',
    title: record.title || '',
    url: record.url || '',
    adapter: record.adapter || 'electron',
    capabilities: { ...(record.capabilities || {}) },
    build_type: record.buildType || 'development',
    workspace_path: record.workspacePath || '',
    executable_path: record.executablePath || '',
    process_id: record.processId || null,
    observation_only: !!record.observationOnly,
    verification_eligible: isVerificationEligible(record),
    active: !!record.active,
    created_at: record.createdAt,
    last_active_at: record.lastActiveAt,
    last_seen_at: record.lastSeenAt
  }
}

function unregisterRuntimeTarget(runtimeIdOrWebContentsId) {
  const numericId = Number(runtimeIdOrWebContentsId)
  const runtimeId = Number.isFinite(numericId) && numericId > 0
    ? runtimeIdByWebContentsId.get(numericId)
    : clean(runtimeIdOrWebContentsId)
  if (!runtimeId) return false
  const record = targets.get(runtimeId)
  if (!record) return false
  targets.delete(runtimeId)
  if (record.webContentsId) {
    runtimeIdByWebContentsId.delete(record.webContentsId)
    try {
      require('./runtime-diagnostics').setWebContentsProject(record.webContentsId, '')
    } catch { /* Runtime diagnostics may be unavailable in isolated scenario tests. */ }
  }
  return true
}

function attachWebContentsObservers(webContents) {
  if (!webContents || observedWebContents.has(webContents)) return
  observedWebContents.add(webContents)
  const touch = () => touchRuntimeTarget(webContents.id)
  webContents.on?.('did-navigate', touch)
  webContents.on?.('did-navigate-in-page', touch)
  webContents.on?.('page-title-updated', touch)
  webContents.once?.('destroyed', () => unregisterRuntimeTarget(webContents.id))
}

function attachWindowObservers(win, runtimeId) {
  if (!win || observedWindows.has(win)) return
  observedWindows.add(win)
  win.on?.('focus', () => {
    for (const record of targets.values()) record.active = false
    const record = targets.get(runtimeId)
    if (record) {
      record.active = true
      record.lastActiveAt = Date.now()
      record.lastSeenAt = Date.now()
    }
  })
  win.once?.('closed', () => unregisterRuntimeTarget(runtimeId))
}

function registerWebContents(webContents, meta = {}) {
  if (!webContents || webContents.isDestroyed?.()) {
    return { success: false, error: 'runtime target registration failed: webContents is missing or destroyed' }
  }

  const webContentsId = Number(webContents.id)
  const previousRuntimeId = runtimeIdByWebContentsId.get(webContentsId)
  const runtimeId = createRuntimeId(webContents, meta)
  if (previousRuntimeId && previousRuntimeId !== runtimeId) {
    unregisterRuntimeTarget(previousRuntimeId)
  }

  const now = Date.now()
  const previous = targets.get(runtimeId)
  let win = null
  try {
    const { BrowserWindow } = require('electron')
    win = BrowserWindow?.fromWebContents?.(webContents) || null
  } catch { /* Electron can be mocked in scenario tests. */ }

  const record = {
    runtimeId,
    projectId: clean(meta.projectId || meta.project_id || previous?.projectId),
    projectPath: clean(meta.projectPath || meta.project_path || previous?.projectPath),
    webContentsId,
    windowId: Number(meta.windowId || meta.window_id || win?.id || previous?.windowId) || null,
    tabId: clean(meta.tabId || meta.tab_id || previous?.tabId),
    kind: clean(meta.kind || meta.type || previous?.kind || webContents.getType?.() || 'window'),
    source: clean(meta.source || previous?.source || 'runtime-registry'),
    title: clean(meta.title || safeTitle(webContents, previous?.title)),
    url: clean(meta.url || safeUrl(webContents, previous?.url)),
    adapter: clean(meta.adapter || previous?.adapter || 'electron').toLowerCase(),
    capabilities: { ...(meta.capabilities || previous?.capabilities || require('./runtime-adapter-registry').getRuntimeAdapter(meta.adapter || previous?.adapter || 'electron')?.capabilities || {}) },
    buildType: clean(meta.buildType || meta.build_type || previous?.buildType || currentBuildType()).toLowerCase(),
    workspacePath: clean(meta.workspacePath || meta.workspace_path || previous?.workspacePath),
    executablePath: clean(meta.executablePath || meta.executable_path || previous?.executablePath || process.execPath),
    processId: Number(meta.processId || meta.process_id || previous?.processId || process.pid) || null,
    observationOnly: meta.observationOnly === true || meta.observation_only === true || previous?.observationOnly === true,
    active: meta.active === true || win?.isFocused?.() === true || previous?.active === true,
    createdAt: previous?.createdAt || now,
    lastActiveAt: meta.active === true ? now : (previous?.lastActiveAt || now),
    lastSeenAt: now,
    webContents
  }
  if (record.buildType === 'installed') record.observationOnly = true
  targets.set(runtimeId, record)
  runtimeIdByWebContentsId.set(webContentsId, runtimeId)
  try {
    require('./runtime-diagnostics').setWebContentsProject(webContentsId, record.projectId)
  } catch { /* Runtime diagnostics may be unavailable in isolated scenario tests. */ }
  attachWebContentsObservers(webContents)
  attachWindowObservers(win, runtimeId)
  return { success: true, target: publicTarget(record) }
}

function registerBrowserWindow(win, meta = {}) {
  if (!win || win.isDestroyed?.()) {
    return { success: false, error: 'runtime target registration failed: BrowserWindow is missing or destroyed' }
  }
  return registerWebContents(win.webContents, {
    ...meta,
    windowId: win.id,
    title: meta.title || win.getTitle?.() || '',
    active: meta.active === true || win.isFocused?.() === true
  })
}

function registerRuntimeController(controller, meta = {}) {
  if (!controller || controller.isDestroyed?.()) {
    return { success: false, error: 'runtime controller is missing or destroyed' }
  }
  const runtimeId = clean(meta.runtimeId || meta.runtime_id) || createRuntimeId(controller, meta)
  const now = Date.now()
  const previous = targets.get(runtimeId)
  const adapter = clean(meta.adapter || previous?.adapter || 'screenshot-only').toLowerCase()
  const record = {
    runtimeId,
    projectId: clean(meta.projectId || meta.project_id || previous?.projectId),
    projectPath: clean(meta.projectPath || meta.project_path || previous?.projectPath),
    webContentsId: Number(controller.id) || remoteWebContentsId(runtimeId),
    windowId: Number(meta.windowId || meta.window_id || controller.windowId || previous?.windowId) || null,
    tabId: clean(meta.tabId || meta.tab_id || previous?.tabId),
    kind: clean(meta.kind || previous?.kind || 'native-window'),
    source: clean(meta.source || previous?.source || 'runtime-adapter'),
    title: clean(meta.title || controller.getTitle?.() || previous?.title),
    url: clean(meta.url || controller.getURL?.() || previous?.url),
    adapter,
    capabilities: { ...(meta.capabilities || previous?.capabilities || require('./runtime-adapter-registry').getRuntimeAdapter(adapter)?.capabilities || {}) },
    buildType: clean(meta.buildType || meta.build_type || previous?.buildType || 'development').toLowerCase(),
    workspacePath: clean(meta.workspacePath || meta.workspace_path || previous?.workspacePath),
    executablePath: clean(meta.executablePath || meta.executable_path || previous?.executablePath),
    processId: Number(meta.processId || meta.process_id || controller.processId || previous?.processId) || null,
    observationOnly: meta.observationOnly === true || meta.observation_only === true || previous?.observationOnly === true,
    active: meta.active === true || previous?.active === true,
    createdAt: previous?.createdAt || now,
    lastActiveAt: meta.active === true ? now : (previous?.lastActiveAt || now),
    lastSeenAt: now,
    webContents: controller,
    runtimeController: true
  }
  targets.set(runtimeId, record)
  return { success: true, target: publicTarget(record) }
}

function touchRuntimeTarget(runtimeIdOrWebContentsId, patch = {}) {
  const numericId = Number(runtimeIdOrWebContentsId)
  const runtimeId = Number.isFinite(numericId) && numericId > 0
    ? runtimeIdByWebContentsId.get(numericId)
    : clean(runtimeIdOrWebContentsId)
  const record = targets.get(runtimeId)
  if (!record) return null
  if (patch.projectId || patch.project_id) record.projectId = clean(patch.projectId || patch.project_id)
  if (patch.projectPath || patch.project_path) record.projectPath = clean(patch.projectPath || patch.project_path)
  if (patch.title) record.title = clean(patch.title)
  if (patch.url) record.url = clean(patch.url)
  if (patch.tabId || patch.tab_id) record.tabId = clean(patch.tabId || patch.tab_id)
  if (patch.kind || patch.type) record.kind = clean(patch.kind || patch.type)
  record.title = safeTitle(record.webContents, record.title)
  record.url = safeUrl(record.webContents, record.url)
  record.lastSeenAt = Date.now()
  if (patch.active === true) {
    for (const item of targets.values()) item.active = false
    record.active = true
    record.lastActiveAt = Date.now()
  }
  return publicTarget(record)
}

function pruneTargets() {
  syncRemoteDevelopmentTargets()
  for (const [runtimeId, record] of targets) {
    if (!record.webContents || record.webContents.isDestroyed?.()) {
      unregisterRuntimeTarget(runtimeId)
      continue
    }
    touchRuntimeTarget(runtimeId)
  }
}

function listRuntimeTargets(options = {}) {
  pruneTargets()
  const projectId = clean(options.projectId || options.project_id)
  const includeUnscoped = options.includeUnscoped === true || options.include_unscoped === true
  const includeObservationOnly = options.includeObservationOnly === true || options.include_observation_only === true
  const workspacePath = clean(options.workspacePath || options.workspace_path || options.projectPath || options.project_path)
  return [...targets.values()]
    .filter(record => !projectId || record.projectId === projectId || (includeUnscoped && !record.projectId) || (record.remoteDevelopmentBridge && !record.projectId))
    .filter(record => includeObservationOnly || isVerificationEligible(record))
    .filter(record => !workspacePath || !(record.workspacePath || record.projectPath) || sameWorkspace(record.workspacePath || record.projectPath, workspacePath))
    .sort((a, b) => Number(b.active) - Number(a.active) || b.lastActiveAt - a.lastActiveAt || b.lastSeenAt - a.lastSeenAt)
    .map(publicTarget)
}

function scoreCandidate(record, args = {}, projectId = '') {
  let score = 0
  if (projectId && record.projectId === projectId) score += 100
  const title = clean(args.window_title || args.windowTitle || args.title_hint || args.titleHint).toLowerCase()
  const url = clean(args.runtime_url || args.runtimeUrl || args.url_hint || args.urlHint).toLowerCase()
  const tabId = clean(args.tab_id || args.tabId)
  if (title) {
    const actual = clean(record.title).toLowerCase()
    if (actual === title) score += 80
    else if (actual.includes(title)) score += 45
  }
  if (url) {
    const actual = clean(record.url).toLowerCase()
    if (actual === url) score += 90
    else if (actual.includes(url)) score += 55
  }
  if (tabId && record.tabId === tabId) score += 120
  if (record.active) score += 5
  return score
}

function resolveRuntimeTarget(args = {}, projectId = '', options = {}) {
  pruneTargets()
  const requestedWorkspacePath = clean(args.workspace_path || args.workspacePath || args.project_path || args.projectPath)
  const runtimeId = clean(args.runtime_id || args.runtimeId)
  if (runtimeId) {
    const record = targets.get(runtimeId)
    if (!record) {
      return { success: false, error: `runtime target not found: ${runtimeId}`, candidates: listRuntimeTargets({ projectId }) }
    }
    if (!isVerificationEligible(record)) {
      return {
        success: false,
        observation_only: true,
        error: `runtime target is observation-only (${record.buildType}); start and bind the development instance for source verification`,
        candidates: listRuntimeTargets({ projectId }),
        observation_only_targets: [publicTarget(record)]
      }
    }
    if (projectId && record.projectId && record.projectId !== projectId) {
      return {
        success: false,
        error: 'runtime target belongs to a different project',
        requested_project_id: projectId,
        target: publicTarget(record),
        candidates: listRuntimeTargets({ projectId, workspacePath: requestedWorkspacePath }),
        next_action: 'choose_runtime_bound_to_current_project'
      }
    }
    const recordWorkspacePath = record.workspacePath || record.projectPath
    const boundToProject = !!(projectId && record.projectId === projectId)
    const boundToWorkspace = !!(requestedWorkspacePath && recordWorkspacePath && sameWorkspace(recordWorkspacePath, requestedWorkspacePath))
    if ((projectId || requestedWorkspacePath) && !boundToProject && !boundToWorkspace) {
      return {
        success: false,
        error: 'runtime target is not bound to the current project or development workspace',
        requested_project_id: projectId,
        requested_workspace_path: requestedWorkspacePath,
        target: publicTarget(record),
        candidates: listRuntimeTargets({ projectId, workspacePath: requestedWorkspacePath }),
        next_action: 'start_and_bind_development_runtime'
      }
    }
    if (requestedWorkspacePath && recordWorkspacePath && !sameWorkspace(recordWorkspacePath, requestedWorkspacePath)) {
      return {
        success: false,
        error: 'runtime target belongs to a different development workspace',
        requested_workspace_path: requestedWorkspacePath,
        target: publicTarget(record),
        candidates: listRuntimeTargets({ projectId, workspacePath: requestedWorkspacePath }),
        next_action: 'start_and_bind_development_runtime'
      }
    }
    return { success: true, webContents: record.webContents, target: publicTarget(record), candidates: [publicTarget(record)] }
  }

  const explicitWebContentsId = Number(args.webContentsId || args.web_contents_id || args.target_web_contents_id)
  if (Number.isFinite(explicitWebContentsId) && explicitWebContentsId > 0) {
    const mappedRuntimeId = runtimeIdByWebContentsId.get(explicitWebContentsId)
    const record = mappedRuntimeId ? targets.get(mappedRuntimeId) : null
    if (record) {
      if (!isVerificationEligible(record)) {
        return {
          success: false,
          observation_only: true,
          error: `webContents target is observation-only (${record.buildType}); start and bind the development instance for source verification`,
          candidates: listRuntimeTargets({ projectId }),
          observation_only_targets: [publicTarget(record)]
        }
      }
      if (projectId && record.projectId && record.projectId !== projectId) {
        return {
          success: false,
          error: 'webContents target belongs to a different project',
          requested_project_id: projectId,
          target: publicTarget(record),
          candidates: listRuntimeTargets({ projectId, workspacePath: requestedWorkspacePath }),
          next_action: 'choose_runtime_bound_to_current_project'
        }
      }
      if (requestedWorkspacePath && (record.workspacePath || record.projectPath) && !sameWorkspace(record.workspacePath || record.projectPath, requestedWorkspacePath)) {
        return {
          success: false,
          error: 'webContents target belongs to a different development workspace',
          requested_workspace_path: requestedWorkspacePath,
          target: publicTarget(record),
          candidates: listRuntimeTargets({ projectId, workspacePath: requestedWorkspacePath }),
          next_action: 'start_and_bind_development_runtime'
        }
      }
      return { success: true, webContents: record.webContents, target: publicTarget(record), candidates: [publicTarget(record)] }
    }
    try {
      const { webContents } = require('electron')
      const explicit = webContents?.fromId?.(explicitWebContentsId)
      if (explicit && !explicit.isDestroyed?.()) {
        const registered = registerWebContents(explicit, { projectId, source: 'explicit-web-contents' })
        const target = registered.target
        return { success: true, webContents: explicit, target, candidates: [target] }
      }
    } catch { /* handled below */ }
    return { success: false, error: `webContents target not found: ${explicitWebContentsId}`, candidates: listRuntimeTargets({ projectId }) }
  }

  const targetName = clean(args.target || args.window).toLowerCase()
  if (['main_window', 'main', 'lingxi', 'app'].includes(targetName) && options.mainWebContents && !options.mainWebContents.isDestroyed?.()) {
    const registered = registerWebContents(options.mainWebContents, { runtimeId: 'runtime-lingxi-main', kind: 'lingxi-main', source: 'main-window' })
    if (registered.target?.verification_eligible !== true) {
      return {
        success: false,
        observation_only: true,
        error: 'the installed Lingxi window is observation-only; bind the workspace development instance instead',
        candidates: listRuntimeTargets({ projectId }),
        observation_only_targets: [registered.target]
      }
    }
    return { success: true, webContents: options.mainWebContents, target: registered.target, candidates: [registered.target] }
  }

  const observationOnlyTargets = [...targets.values()].filter(record => !isVerificationEligible(record))
  let candidates = [...targets.values()].filter(isVerificationEligible)
  if (projectId) candidates = candidates.filter(record => record.projectId === projectId || (record.remoteDevelopmentBridge && !record.projectId))
  if (requestedWorkspacePath) {
    candidates = candidates.filter(record => {
      const recordWorkspacePath = record.workspacePath || record.projectPath
      if (recordWorkspacePath) return sameWorkspace(recordWorkspacePath, requestedWorkspacePath)
      return !!(projectId && record.projectId === projectId)
    })
  }
  const hasHints = !!clean(args.window_title || args.windowTitle || args.title_hint || args.titleHint || args.runtime_url || args.runtimeUrl || args.url_hint || args.urlHint || args.tab_id || args.tabId)
  if (hasHints) {
    const scored = candidates
      .map(record => ({ record, score: scoreCandidate(record, args, projectId) }))
      .filter(item => item.score > (projectId ? 100 : 0))
      .sort((a, b) => b.score - a.score || b.record.lastActiveAt - a.record.lastActiveAt)
    if (scored.length === 1 || (scored[0] && scored[0].score > (scored[1]?.score || -1))) {
      const selected = scored[0]?.record
      if (selected) return { success: true, webContents: selected.webContents, target: publicTarget(selected), candidates: scored.map(item => publicTarget(item.record)) }
    }
    candidates = scored.map(item => item.record)
  }

  if (candidates.length === 1) {
    const selected = candidates[0]
    return { success: true, webContents: selected.webContents, target: publicTarget(selected), candidates: [publicTarget(selected)] }
  }
  if (!candidates.length && options.mainFallback === true && options.mainWebContents && !options.mainWebContents.isDestroyed?.()) {
    const registered = registerWebContents(options.mainWebContents, { runtimeId: 'runtime-lingxi-main', kind: 'lingxi-main', source: 'main-fallback' })
    if (registered.target?.verification_eligible === true) {
      return { success: true, webContents: options.mainWebContents, target: registered.target, candidates: [registered.target], fallback: true }
    }
  }

  const publicCandidates = candidates.map(publicTarget)
  return {
    success: false,
    ambiguous: publicCandidates.length > 1,
    error: publicCandidates.length > 1
      ? `runtime target is ambiguous: ${publicCandidates.length} instances match; pass runtime_id`
      : observationOnlyTargets.length
        ? 'no development runtime target is bound; installed targets are observation-only and cannot verify source changes'
        : 'development runtime target not found; start the workspace development instance and bind its runtime_id',
    candidates: publicCandidates,
    observation_only_targets: observationOnlyTargets.map(publicTarget),
    next_action: 'start_and_bind_development_runtime'
  }
}

function resetForTests() {
  targets.clear()
  runtimeIdByWebContentsId.clear()
  remoteDevelopmentTargetsSyncedAt = 0
}

module.exports = {
  registerWebContents,
  registerBrowserWindow,
  registerRuntimeController,
  unregisterRuntimeTarget,
  touchRuntimeTarget,
  listRuntimeTargets,
  resolveRuntimeTarget,
  resetForTests
}
