(function () {
  const TYPE_KEYS = {
    search: 'toolDisplay.type.search',
    read: 'toolDisplay.type.read',
    write: 'toolDisplay.type.write',
    edit: 'toolDisplay.type.edit',
    folder: 'toolDisplay.type.folder',
    step: 'toolDisplay.type.step',
    auto: 'toolDisplay.type.auto',
    bash: 'toolDisplay.type.bash',
    grep: 'toolDisplay.type.grep',
    glob: 'toolDisplay.type.glob',
    browser: 'toolDisplay.type.browser',
    recall_history: 'toolDisplay.type.recall_history',
    image: 'toolDisplay.type.image',
    vision: 'toolDisplay.type.vision',
    excel: 'toolDisplay.type.excel',
    ppt: 'toolDisplay.type.ppt',
    blender: 'toolDisplay.type.blender',
    software: 'toolDisplay.type.software',
    verify: 'toolDisplay.type.verify',
    list: 'toolDisplay.type.list',
    music: 'toolDisplay.type.music',
    video: 'toolDisplay.type.video',
    unknown: 'toolDisplay.type.unknown'
  }

  const TOOL_KEYS = {
    lxweb: 'tool.lxweb',
    research_website_runtime: 'tool.research_website_runtime',
    runtime_verify: 'tool.runtime_verify',
    ui_interaction_check: 'toolDisplay.tool.ui_interaction_check',
    report_progress: 'toolDisplay.tool.report_progress',
    start_final_reply: 'toolDisplay.tool.start_final_reply',
    show_thinking_note: 'toolDisplay.tool.show_thinking_note',
    get_agent_collaboration_status: 'toolDisplay.tool.get_agent_collaboration_status',
    apply_patch: 'toolDisplay.tool.apply_patch',
    text_edit: 'toolDisplay.tool.text_edit',
    json_edit: 'toolDisplay.tool.json_edit',
    move_file: 'toolDisplay.tool.move_file',
    copy_file: 'toolDisplay.tool.copy_file',
    create_directory: 'tool.create_directory',
    delete_file: 'tool.delete_file',
    get_latest_change_session: 'tool.get_latest_change_session',
    get_change_session: 'toolDisplay.tool.get_change_session',
    rollback_latest_change_session: 'tool.rollback_latest_change_session',
    rollback_change_session: 'toolDisplay.tool.rollback_change_session',
    shell_run: 'toolDisplay.tool.shell_run',
    verify_runtime_smoke: 'tool.verify_runtime_smoke',
    find_software: 'tool.find_software',
    open_software: 'tool.open_software',
    enter_plan_mode: 'toolDisplay.tool.enter_plan_mode',
    ask_user_choice: 'toolDisplay.tool.ask_user_choice',
    confirm_plan: 'toolDisplay.tool.confirm_plan',
    complete_step: 'toolDisplay.tool.complete_step',
    read_task_ledger_entry: 'toolDisplay.tool.read_task_ledger_entry',
    find_references: 'toolDisplay.tool.find_references',
    check_syntax: 'toolDisplay.tool.check_syntax',
    post_change_verify: 'toolDisplay.tool.post_change_verify',
    read_many_files: 'toolDisplay.tool.read_many_files',
    create_file_session: 'toolDisplay.tool.create_file_session',
    append_file_chunk: 'toolDisplay.tool.append_file_chunk',
    finish_file_session: 'toolDisplay.tool.finish_file_session',
    file_read: 'toolDisplay.tool.file_read',
    file_manage: 'toolDisplay.tool.file_manage',
    file_write_session: 'toolDisplay.tool.file_write_session',
    file_search: 'toolDisplay.tool.file_search',
    code_verify: 'toolDisplay.tool.code_verify',
    code_inspect: 'toolDisplay.tool.code_inspect',
    project_history: 'toolDisplay.tool.project_history',
    skill_manage: 'toolDisplay.tool.skill_manage',
    desktop_app: 'toolDisplay.tool.desktop_app',
    image_analyze: 'toolDisplay.tool.image_analyze',
    mcp: 'toolDisplay.tool.mcp',
    media_process: 'toolDisplay.tool.media_process',
    git_diff: 'toolDisplay.tool.git_diff',
    find_in_file: 'toolDisplay.tool.find_in_file',
    grep_code: 'toolDisplay.tool.grep_code',
    glob_files: 'toolDisplay.tool.glob_files',
    locate_code: 'toolDisplay.tool.locate_code',
    search_project: 'toolDisplay.tool.search_project',
    discover_code: 'toolDisplay.tool.discover_code',
    dev_workflow: 'toolDisplay.tool.dev_workflow',
    parallel_research: 'tool.parallel_research',
    inspect_binary: 'tool.inspect_binary',
    code_navigate: 'toolDisplay.tool.code_navigate',
    record_ai_operation_memo: 'toolDisplay.tool.record_ai_operation_memo',
    search_ai_operation_memos: 'toolDisplay.tool.search_ai_operation_memos',
    read_ai_operation_memo: 'toolDisplay.tool.read_ai_operation_memo',
    generate_image: 'tool.generate_image',
    generate_music: 'tool.generate_music',
    generate_video: 'tool.generate_video',
    extract_video_frames: 'tool.extract_video_frames',
    upscale_media: 'tool.upscale_media',
    capture_screenshot: 'tool.capture_screenshot',
    desktop_control: 'tool.desktop_control',
    create_inline_visual: 'tool.create_inline_visual',
    website_delivery: 'tool.website_delivery',
    list_runtime_targets: 'tool.list_runtime_targets',
    ui_smoke_check: 'toolDisplay.tool.ui_smoke_check',
    inspect_image: 'tool.inspect_image',
    view_image: 'toolDisplay.tool.view_image',
    request_agent_collaboration: 'toolDisplay.tool.request_agent_collaboration',
    music_open: 'toolDisplay.tool.music_open',
    music_list_instruments: 'toolDisplay.tool.music_list_instruments',
    music_compose: 'tool.music_compose',
    music_import_score: 'toolDisplay.tool.music_import_score',
    music_set_options: 'tool.music_set_options',
    music_set_global: 'toolDisplay.tool.music_set_global',
    music_set_track: 'toolDisplay.tool.music_set_track',
    music_set_step: 'toolDisplay.tool.music_set_step',
    music_vary: 'toolDisplay.tool.music_vary',
    music_randomize_rhythm: 'toolDisplay.tool.music_randomize_rhythm',
    music_apply_preset: 'toolDisplay.tool.music_apply_preset',
    music_set_melody: 'toolDisplay.tool.music_set_melody',
    music_set_chords: 'toolDisplay.tool.music_set_chords',
    music_add_fill: 'toolDisplay.tool.music_add_fill',
    music_set_effects: 'toolDisplay.tool.music_set_effects',
    music_clear: 'toolDisplay.tool.music_clear',
    music_play: 'toolDisplay.tool.music_play',
    music_stop: 'toolDisplay.tool.music_stop',
    music_export_wav: 'toolDisplay.tool.music_export_wav',
    music_inspect: 'toolDisplay.tool.music_inspect'
  }

  const PENDING_KEYS = {
    create_file_session: 'toolDisplay.pending.create_file_session',
    append_file_chunk: 'toolDisplay.pending.append_file_chunk',
    finish_file_session: 'toolDisplay.pending.finish_file_session',
    file_read: 'toolDisplay.pending.file_read',
    file_manage: 'toolDisplay.pending.file_manage',
    file_write_session: 'toolDisplay.pending.file_write_session',
    file_search: 'toolDisplay.pending.file_search',
    code_verify: 'toolDisplay.pending.code_verify',
    code_inspect: 'toolDisplay.pending.code_inspect',
    project_history: 'toolDisplay.pending.project_history',
    skill_manage: 'toolDisplay.pending.skill_manage',
    desktop_app: 'toolDisplay.pending.desktop_app',
    image_analyze: 'toolDisplay.pending.image_analyze',
    mcp: 'toolDisplay.pending.mcp',
    media_process: 'toolDisplay.pending.media_process',
    parallel_research: 'toolDisplay.pending.parallel_research',
    music_open: 'toolDisplay.pending.music_open',
    music_list_instruments: 'toolDisplay.pending.music_list_instruments',
    music_compose: 'toolDisplay.pending.music_compose',
    music_import_score: 'toolDisplay.pending.music_import_score',
    music_set_options: 'toolDisplay.pending.music_set_options',
    music_set_global: 'toolDisplay.pending.music_set_global',
    music_set_track: 'toolDisplay.pending.music_set_track',
    music_set_step: 'toolDisplay.pending.music_set_step',
    music_vary: 'toolDisplay.pending.music_vary',
    music_randomize_rhythm: 'toolDisplay.pending.music_randomize_rhythm',
    music_apply_preset: 'toolDisplay.pending.music_apply_preset',
    music_set_melody: 'toolDisplay.pending.music_set_melody',
    music_set_chords: 'toolDisplay.pending.music_set_chords',
    music_add_fill: 'toolDisplay.pending.music_add_fill',
    music_set_effects: 'toolDisplay.pending.music_set_effects',
    music_clear: 'toolDisplay.pending.music_clear',
    music_play: 'toolDisplay.pending.music_play',
    music_stop: 'toolDisplay.pending.music_stop',
    music_export_wav: 'toolDisplay.pending.music_export_wav',
    music_inspect: 'toolDisplay.pending.music_inspect',
  }

  function humanize(value = '') {
    return String(value || '')
      .replace(/[_-]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
  }

  function t(key, params = null, fallback = '') {
    if (!key) return fallback || ''
    const value = window.i18n?.t?.(key, params || undefined)
    if (value && value !== key) return value
    return fallback || key
  }

  /** 仅在 i18n 真正命中（非回退成 key 本身）时视为有翻译 */
  function hasTranslation(key) {
    if (!key) return false
    try {
      const value = window.i18n?.t?.(key)
      return !!(value && value !== key)
    } catch {
      return false
    }
  }

  function getToolLabel(name, type = '') {
    const key = TOOL_KEYS[name] || (name ? `tool.${name}` : '')
    if (hasTranslation(key)) return t(key)
    // 兼容 toolDisplay.tool.* 与 tool.* 两套键
    const altKey = name && !String(TOOL_KEYS[name] || '').startsWith('toolDisplay.')
      ? `toolDisplay.tool.${name}`
      : (name ? `tool.${name}` : '')
    if (altKey && altKey !== key && hasTranslation(altKey)) return t(altKey)
    const typeKey = TYPE_KEYS[type] || TYPE_KEYS.unknown
    if (type && hasTranslation(typeKey)) return t(typeKey)
    return humanize(name || type)
  }

  function getTypeLabel(type = '') {
    const key = TYPE_KEYS[type] || TYPE_KEYS.unknown
    return t(key, null, humanize(type))
  }

  function getOperationVerb(type = '', pending = false) {
    const phase = pending ? 'pending' : 'done'
    const specificKey = `toolDisplay.verb.${phase}.${type}`
    if (hasTranslation(specificKey)) return t(specificKey)
    return t(`toolDisplay.verb.${phase}.default`, null, humanize(type))
  }

  function getAggregateSummary(type = '') {
    const key = `toolDisplay.aggregate.${type || 'default'}`
    return t(key, null, t('toolDisplay.aggregate.default', null, '已完成多项操作'))
  }

  function getPendingText(name = '', type = '') {
    const key = PENDING_KEYS[name] || `toolDisplay.pending.${type || 'default'}`
    if (hasTranslation(key)) return t(key)
    return t('toolDisplay.pending.default')
  }

  window.ToolDisplayMetadata = {
    getOperationVerb,
    getAggregateSummary,
    getPendingText,
    getToolLabel,
    getTypeLabel,
    humanize,
    t
  }
})()
