const COMPOSITE_TOOL_CONTRACTS = Object.freeze({
  file_read: contract('always', {
    one: route('read_file', 'read'),
    many: route('read_many_files', 'read')
  }),
  file_manage: contract('always', {
    create_directory: route('create_directory', 'mutation'),
    copy: route('copy_file', 'mutation'),
    move: route('move_file', 'mutation'),
    delete: route('delete_file', 'mutation')
  }, { recoveryWrite: true }),
  file_write_session: contract('always', {
    start: route('create_file_session', 'mutation'),
    append: route('append_file_chunk', 'mutation'),
    finish: route('finish_file_session', 'mutation')
  }, { recoveryWrite: true }),
  file_search: contract('always', {
    directory: route('list_files', 'read'),
    glob: route('glob_files', 'read')
  }),
  code_verify: contract('always', {
    file: route('check_syntax', 'read'),
    project: route('check_project_syntax', 'read'),
    changes: route('post_change_verify', 'read')
  }),
  code_inspect: contract('always', {
    // 内容字面搜索优先用 grep（rg），多线索定位用 locate，单文件再 find_in_file
    grep: route('grep_code', 'read'),
    locate: route('locate_code', 'read'),
    find_in_file: route('find_in_file', 'read'),
    navigate: route('code_navigate', 'read'),
    find_references: route('find_references', 'read'),
    trace_call_chain: route('trace_call_chain', 'read'),
    git_diff: route('git_diff', 'read')
  }),
  project_history: contract('always', {
    recall: route('recall_history'),
    ledger: route('read_task_ledger_entry'),
    latest_change: route('get_latest_change_session'),
    rollback_latest_change: route('rollback_latest_change_session'),
    search_memos: route('search_ai_operation_memos'),
    read_memo: route('read_ai_operation_memo')
  }),
  skill_manage: contract('skill', {
    draft: projectScopedRoute('create_skill_draft', 'mutation'),
    install: projectScopedRoute('install_skill_draft', 'mutation'),
    list: projectScopedRoute('list_skill_drafts', 'read')
  }),
  desktop_app: contract('software', {
    find: route('find_software'),
    open: route('open_software')
  }),
  image_analyze: contract('vision', {
    analyze: route('inspect_image', 'read')
  }, { defaultAction: 'analyze' }),
  mcp: contract('mcp', {
    diagnose: route('mcp_aidev_workflow'),
    list_tools: route('mcp_list_tools'),
    call: route('mcp_call_tool', 'dynamic')
  }),
  media_process: contract(['media', 'web'], {
    render_svg: route('render_svg_asset', 'mutation'),
    extract_frames: route('extract_video_frames', 'mutation'),
    upscale: route('upscale_media', 'mutation')
  })
})

function route(tool, statelessKind = 'none') {
  return Object.freeze({ tool, statelessKind })
}

function projectScopedRoute(tool, projectKind) {
  return route(tool, args => usesProjectSkillScope(args) ? projectKind : 'none')
}

function usesProjectSkillScope(args = {}) {
  return [
    args.scope,
    args.targetScope,
    args.target_scope,
    args.draft_scope,
    args.draftScope,
    args.sourceScope,
    args.source_scope
  ].some(value => String(value || '').trim().toLowerCase() === 'project')
}

function contract(capabilities, actions, options = {}) {
  return Object.freeze({
    capabilities: Object.freeze(Array.isArray(capabilities) ? capabilities : [capabilities]),
    actions: Object.freeze(actions),
    defaultAction: options.defaultAction || '',
    recoveryWrite: options.recoveryWrite === true
  })
}

function pathLooksLikeFile(pathValue = '') {
  const pathStr = String(pathValue || '').trim()
  if (!pathStr) return false
  if (/[\\/]$/.test(pathStr)) return false
  return /\.[A-Za-z0-9]{1,12}$/.test(pathStr)
}

function firstNonEmpty(...values) {
  for (const value of values) {
    if (value == null) continue
    if (typeof value === 'string' && !value.trim()) continue
    if (Array.isArray(value) && value.length === 0) continue
    return value
  }
  return undefined
}

/**
 * 规范化模型常见别名/漏写，再交给 action 推断。
 * 只做安全映射，不改变业务语义。
 */
function normalizeCompositeArgs(toolName, rawArgs = {}) {
  const src = rawArgs && typeof rawArgs === 'object' && !Array.isArray(rawArgs) ? rawArgs : {}
  const args = { ...src }
  const notes = []

  // 通用路径/文件别名
  if (!args.path) {
    const pathAlias = firstNonEmpty(args.file, args.filepath, args.file_path, args.filePath, args.target, args.target_path, args.targetPath)
    if (pathAlias != null) {
      args.path = pathAlias
      notes.push('alias:path')
    }
  }
  if (!args.query) {
    const queryAlias = firstNonEmpty(args.q, args.keyword, args.keywords, args.search, args.search_query, args.text)
    if (typeof queryAlias === 'string') {
      args.query = queryAlias
      notes.push('alias:query')
    } else if (Array.isArray(queryAlias) && queryAlias.length) {
      args.query = queryAlias.join(' ')
      notes.push('alias:query_from_array')
    }
  }
  if (!args.pattern && !Array.isArray(args.patterns)) {
    const patternAlias = firstNonEmpty(args.regex, args.re, args.search_pattern, args.needle, args.term)
    if (typeof patternAlias === 'string') {
      args.pattern = patternAlias
      notes.push('alias:pattern')
    }
  }
  if (!args.symbol) {
    const symbolAlias = firstNonEmpty(args.name, args.identifier, args.fn, args.function_name, args.func)
    // desktop_app/skill_manage 的 name 另有用途，不在这里抢
    if (symbolAlias != null && (toolName === 'code_inspect' || toolName === 'code_verify')) {
      args.symbol = symbolAlias
      notes.push('alias:symbol')
    }
  }

  switch (toolName) {
    case 'file_read': {
      if (!Array.isArray(args.files) || !args.files.length) {
        if (Array.isArray(args.paths) && args.paths.length) {
          args.files = args.paths.map(p => (typeof p === 'string' ? { path: p } : p))
          notes.push('alias:files_from_paths')
        } else if (Array.isArray(args.path) && args.path.length) {
          args.files = args.path.map(p => (typeof p === 'string' ? { path: p } : p))
          delete args.path
          notes.push('alias:files_from_path_array')
        }
      }
      // action 同义词
      if (args.action) {
        const act = String(args.action).trim().toLowerCase()
        if (['read', 'single', 'file', 'get', 'open'].includes(act)) {
          args.action = 'one'
          notes.push('normalize:action=one')
        } else if (['batch', 'multi', 'multiple', 'many_files'].includes(act)) {
          args.action = 'many'
          notes.push('normalize:action=many')
        }
      }
      break
    }
    case 'file_search': {
      if (!args.pattern) {
        const globAlias = firstNonEmpty(args.glob, args.glob_pattern, args.globPattern, args.include)
        if (globAlias != null) {
          args.pattern = globAlias
          notes.push('alias:pattern_from_glob')
        }
      }
      if (!args.path) {
        const dirAlias = firstNonEmpty(args.directory, args.dir, args.root, args.cwd)
        if (dirAlias != null) {
          args.path = dirAlias
          notes.push('alias:path_from_directory')
        }
      }
      if (args.action) {
        const act = String(args.action).trim().toLowerCase()
        if (['list', 'ls', 'dir', 'listdir', 'list_dir'].includes(act)) {
          args.action = 'directory'
          notes.push('normalize:action=directory')
        } else if (['find', 'search', 'match', 'wildcard'].includes(act)) {
          args.action = 'glob'
          notes.push('normalize:action=glob')
        }
      }
      break
    }
    case 'file_manage': {
      if (!args.source) {
        const sourceAlias = firstNonEmpty(args.from, args.src, args.old_path, args.oldPath)
        if (sourceAlias != null) {
          args.source = sourceAlias
          notes.push('alias:source')
        }
      }
      if (!args.destination) {
        const destAlias = firstNonEmpty(args.to, args.dest, args.dst, args.new_path, args.newPath, args.target)
        if (destAlias != null) {
          args.destination = destAlias
          notes.push('alias:destination')
        }
      }
      if (args.action) {
        const act = String(args.action).trim().toLowerCase()
        if (['mkdir', 'md', 'create_dir', 'createdir', 'create-folder'].includes(act)) {
          args.action = 'create_directory'
          notes.push('normalize:action=create_directory')
        } else if (['rm', 'remove', 'unlink', 'del'].includes(act)) {
          args.action = 'delete'
          notes.push('normalize:action=delete')
        } else if (['cp', 'copy_file'].includes(act)) {
          args.action = 'copy'
          notes.push('normalize:action=copy')
        } else if (['mv', 'rename', 'move_file'].includes(act)) {
          args.action = 'move'
          notes.push('normalize:action=move')
        }
      } else if (args.operation) {
        args.action = String(args.operation).trim()
        notes.push('alias:action_from_operation')
      }
      break
    }
    case 'file_write_session': {
      if (!args.content_chunk && (args.chunk || args.content || args.data || args.text)) {
        args.content_chunk = firstNonEmpty(args.chunk, args.content, args.data, args.text)
        notes.push('alias:content_chunk')
      }
      if (!args.session_id) {
        const sid = firstNonEmpty(args.sessionId, args.id)
        if (sid != null) {
          args.session_id = sid
          notes.push('alias:session_id')
        }
      }
      break
    }
    case 'code_verify': {
      if (args.action) {
        const act = String(args.action).trim().toLowerCase()
        if (['syntax', 'check', 'single', 'one'].includes(act)) {
          args.action = 'file'
          notes.push('normalize:action=file')
        } else if (['all', 'scan', 'whole'].includes(act)) {
          args.action = 'project'
          notes.push('normalize:action=project')
        } else if (['diff', 'post', 'modified'].includes(act)) {
          args.action = 'changes'
          notes.push('normalize:action=changes')
        }
      }
      break
    }
    case 'code_inspect': {
      if (args.action) {
        const act = String(args.action).trim().toLowerCase()
        const map = {
          search: 'grep',
          rg: 'grep',
          ripgrep: 'grep',
          find: 'grep',
          find_in_files: 'grep',
          find_text: 'grep',
          content_search: 'grep',
          locate_code: 'locate',
          search_code: 'locate',
          refs: 'find_references',
          references: 'find_references',
          callers: 'trace_call_chain',
          callees: 'trace_call_chain',
          call_chain: 'trace_call_chain',
          outline: 'navigate',
          structure: 'navigate',
          symbols: 'navigate',
          diff: 'git_diff'
        }
        if (map[act]) {
          args.action = map[act]
          notes.push(`normalize:action=${map[act]}`)
        }
      }
      // 模型常把搜索词塞进 query，却写了 grep
      if (!args.pattern && !Array.isArray(args.patterns) && args.query && ['grep', 'find_in_file', 'search', 'rg'].includes(String(args.action || '').toLowerCase())) {
        args.pattern = args.query
        notes.push('alias:pattern_from_query')
      }
      break
    }
    case 'desktop_app': {
      if (args.action) {
        const act = String(args.action).trim().toLowerCase()
        if (['launch', 'start', 'run', 'open_app'].includes(act)) {
          args.action = 'open'
          notes.push('normalize:action=open')
        } else if (['search', 'lookup', 'which'].includes(act)) {
          args.action = 'find'
          notes.push('normalize:action=find')
        }
      }
      if (!args.name) {
        const nameAlias = firstNonEmpty(args.app, args.app_name, args.software, args.program)
        if (nameAlias != null) {
          args.name = nameAlias
          notes.push('alias:name')
        }
      }
      break
    }
    case 'project_history': {
      if (args.action) {
        const act = String(args.action).trim().toLowerCase()
        const map = {
          search: 'recall',
          history: 'recall',
          memo: 'search_memos',
          memos: 'search_memos',
          rollback: 'rollback_latest_change',
          undo: 'rollback_latest_change',
          latest: 'latest_change'
        }
        if (map[act]) {
          args.action = map[act]
          notes.push(`normalize:action=${map[act]}`)
        }
      }
      break
    }
    default:
      break
  }

  if (notes.length) args._normalized_notes = notes
  return args
}

/**
 * 从参数推断 action，兼容模型只传 path/files 等业务字段、漏写 action 的常见情况。
 * 没有足够线索时返回 ''，由上层报明确错误。
 */
function inferCompositeAction(toolName, args = {}) {
  const a = args && typeof args === 'object' ? args : {}
  switch (toolName) {
    case 'file_read':
      if (Array.isArray(a.files) && a.files.length) return 'many'
      if (a.path) return 'one'
      return ''
    case 'file_search':
      if (a.pattern || a.glob || a.glob_pattern) return 'glob'
      if (a.path || a.directory) return 'directory'
      return 'glob'
    case 'file_manage':
      if (a.source && a.destination) {
        return /move|rename/i.test(String(a.operation || a.action || '')) ? 'move' : 'copy'
      }
      if (a.path && (a.create_directory === true || a.is_directory === true)) return 'create_directory'
      if (a.path && (a.delete === true || a.rm === true)) return 'delete'
      return ''
    case 'file_write_session':
      if (a.content_chunk || a.chunk) return 'append'
      if (a.session_id && (a.expected_bytes != null || a.expected_sha256 || a.finish === true)) return 'finish'
      if (a.path && !a.session_id) return 'start'
      if (a.session_id) return 'append'
      return ''
    case 'code_verify':
      if (a.path) return 'file'
      if (Array.isArray(a.files) && a.files.length) return 'changes'
      if (Array.isArray(a.roots) && a.roots.length) return 'project'
      return 'changes'
    case 'code_inspect': {
      if (a.pattern || (Array.isArray(a.patterns) && a.patterns.length)) {
        // 有 pattern 时：目标像单文件则 find_in_file，否则按项目/目录 grep
        if (pathLooksLikeFile(a.path) && !a.file_type) return 'find_in_file'
        return 'grep'
      }
      if (a.query || (Array.isArray(a.terms) && a.terms.length)) return 'locate'
      if (a.symbol && (a.direction || a.depth != null)) return 'trace_call_chain'
      if (a.symbol) return 'find_references'
      if (a.staged != null || a.stat === true) return 'git_diff'
      if (a.navigate_action || a.line != null) return 'navigate'
      // 仅 path 且像文件时才 navigate；目录路径不要瞎推断
      if (pathLooksLikeFile(a.path)) return 'navigate'
      return ''
    }
    case 'project_history':
      if (a.memo_id) return 'read_memo'
      if (a.entry_id) return 'ledger'
      if (a.force === true || (Array.isArray(a.paths) && a.paths.length)) return 'rollback_latest_change'
      if (a.query && (Array.isArray(a.terms) || /memo/i.test(String(a.kind || '')))) return 'search_memos'
      if (a.query) return 'recall'
      return 'latest_change'
    case 'skill_manage':
      if (a.draft_id) return 'install'
      if (a.content || a.name || a.title) return 'draft'
      return 'list'
    case 'desktop_app':
      if (a.path || a.args || a.visible != null || a.cwd) return 'open'
      if (a.name) return 'find'
      return ''
    case 'mcp':
      if (a.name || a.arguments) return 'call'
      if (a.query || a.file || a.mode) return 'diagnose'
      return 'list_tools'
    case 'media_process':
      if (a.svg_content || a.svg_path || a.output_path) return 'render_svg'
      if (a.frames != null || a.extract_frames === true) return 'extract_frames'
      if (a.path) return 'upscale'
      return ''
    case 'image_analyze':
      return 'analyze'
    default:
      return ''
  }
}

function isKnownAction(toolName, action = '') {
  const definition = COMPOSITE_TOOL_CONTRACTS[toolName]
  if (!definition) return false
  return Object.prototype.hasOwnProperty.call(definition.actions, String(action || '').trim())
}

function getCompositeAction(toolName, args = {}) {
  const definition = COMPOSITE_TOOL_CONTRACTS[toolName]
  if (!definition) return ''
  const explicit = String(args.action || '').trim()
  if (explicit && isKnownAction(toolName, explicit)) return explicit
  // 无效/未知 action：忽略后走推断，避免 action=read 直接挂掉
  if (definition.defaultAction && isKnownAction(toolName, definition.defaultAction)) {
    const inferred = inferCompositeAction(toolName, args)
    if (inferred) return inferred
    return String(definition.defaultAction).trim()
  }
  return inferCompositeAction(toolName, args)
}

function getCompositeRoute(toolName, args = {}) {
  const definition = COMPOSITE_TOOL_CONTRACTS[toolName]
  if (!definition) return null
  const action = getCompositeAction(toolName, args)
  const selected = definition.actions[action]
  if (!selected) return null
  const statelessKind = typeof selected.statelessKind === 'function'
    ? selected.statelessKind(args)
    : selected.statelessKind
  return { requestedTool: toolName, action, tool: selected.tool, statelessKind }
}

function buildRoutedArgs(toolName, action, args = {}) {
  const next = { ...(args || {}) }
  delete next.action
  delete next._normalized_notes
  delete next._repair_notes
  if (toolName === 'code_inspect' && action === 'navigate') {
    next.action = next.navigate_action || 'outline_file'
    delete next.navigate_action
  }
  return next
}

function argsSignature(args = {}) {
  try {
    const copy = { ...(args || {}) }
    delete copy._normalized_notes
    delete copy._repair_notes
    return JSON.stringify(copy)
  } catch {
    return String(args)
  }
}

/**
 * 参数/路由/执行失败后，尝试生成一组不同的纠参结果（最多上层重试一次）。
 * 返回 null 表示无法安全纠参。
 */
function repairCompositeArgs(toolName, args = {}, context = {}) {
  const current = args && typeof args === 'object' ? { ...args } : {}
  const action = String(context.action || current.action || getCompositeAction(toolName, current) || '').trim()
  const reason = String(context.reason || '')
  const errorText = String(context.error || context.result?.error || context.result?.message || '')
  const errorType = String(context.result?.error_type || context.error_type || '')
  const notes = []

  // 1) 未知/空 action：强制去掉 action 再推断
  if (reason === 'no_route' || reason === 'validation' || /不支持 action|action=\(empty\)|invalid_tool_args/i.test(errorText)) {
    if (current.action) {
      delete current.action
      notes.push('drop_invalid_action')
    }
    const inferred = inferCompositeAction(toolName, current)
    if (inferred && inferred !== action) {
      current.action = inferred
      notes.push(`infer:${inferred}`)
      current._repair_notes = notes
      return current
    }
  }

  // 2) 校验缺字段时，尝试别名补全（二次 normalize）
  if (reason === 'validation') {
    const renorm = normalizeCompositeArgs(toolName, current)
    if (argsSignature(renorm) !== argsSignature(args)) {
      const inferred = inferCompositeAction(toolName, renorm)
      if (inferred) renorm.action = inferred
      renorm._repair_notes = [...(renorm._normalized_notes || []), 're_normalize']
      return renorm
    }
  }

  // 3) 执行期：把目录当文件
  if (
    toolName === 'code_inspect' &&
    (errorType === 'not_a_file' || /not a file|Resolved path is not a file/i.test(errorText))
  ) {
    if (current.pattern || (Array.isArray(current.patterns) && current.patterns.length)) {
      current.action = 'grep'
      notes.push('not_a_file->grep')
      current._repair_notes = notes
      return current
    }
    if (current.query || (Array.isArray(current.terms) && current.terms.length)) {
      current.action = 'locate'
      notes.push('not_a_file->locate')
      current._repair_notes = notes
      return current
    }
    // 仅有目录 path：改为 git_diff 不合适；改为 locate 用目录名当 query 太弱
    // 若 action 是 navigate/find_in_file，改为 grep 需要 pattern——无法安全编造
  }

  // 4) code_inspect：find_in_file 缺 path 但有 pattern → 升为 grep
  if (toolName === 'code_inspect' && action === 'find_in_file' && !current.path && (current.pattern || current.patterns)) {
    current.action = 'grep'
    notes.push('find_in_file_without_path->grep')
    current._repair_notes = notes
    return current
  }

  // 5) code_inspect：grep 写成了 locate 但只有 pattern
  if (toolName === 'code_inspect' && action === 'locate' && !current.query && (current.pattern || current.patterns)) {
    current.action = 'grep'
    notes.push('locate_without_query->grep')
    current._repair_notes = notes
    return current
  }

  // 6) file_read many 写成 one，但给了 files
  if (toolName === 'file_read' && action === 'one' && Array.isArray(current.files) && current.files.length) {
    current.action = 'many'
    notes.push('one_with_files->many')
    current._repair_notes = notes
    return current
  }
  if (toolName === 'file_read' && action === 'many' && current.path && (!Array.isArray(current.files) || !current.files.length)) {
    current.action = 'one'
    notes.push('many_with_path->one')
    current._repair_notes = notes
    return current
  }

  // 7) desktop_app：find/open 互换
  if (toolName === 'desktop_app' && action === 'find' && (current.path || current.args)) {
    current.action = 'open'
    notes.push('find_with_launch_args->open')
    current._repair_notes = notes
    return current
  }

  return null
}

function getCompositeToolsForCapability(capability) {
  return Object.entries(COMPOSITE_TOOL_CONTRACTS)
    .filter(([, definition]) => definition.capabilities.includes(capability))
    .map(([name]) => name)
}

function getCompositeRecoveryWriteTools() {
  return Object.entries(COMPOSITE_TOOL_CONTRACTS)
    .filter(([, definition]) => definition.recoveryWrite)
    .map(([name]) => name)
}

function getCompositeActionMap() {
  return Object.fromEntries(Object.entries(COMPOSITE_TOOL_CONTRACTS).map(([name, definition]) => [
    name,
    Object.fromEntries(Object.entries(definition.actions).map(([action, selected]) => [action, selected.tool]))
  ]))
}

module.exports = {
  COMPOSITE_TOOL_CONTRACTS,
  normalizeCompositeArgs,
  inferCompositeAction,
  repairCompositeArgs,
  getCompositeAction,
  getCompositeRoute,
  buildRoutedArgs,
  argsSignature,
  getCompositeToolsForCapability,
  getCompositeRecoveryWriteTools,
  getCompositeActionMap
}
