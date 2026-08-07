/**
 * 面向模型的合并工具入口。执行端会把 action 展开到既有原子工具，
 * 因此不会绕过原有的授权、恢复点和结果校验。
 */

function tool(name, description, properties, required = ['action']) {
  return {
    type: 'function',
    function: {
      name,
      description,
      parameters: { type: 'object', properties, required }
    }
  }
}

const action = (values, description) => ({ type: 'string', enum: values, description })
const text = description => ({ type: 'string', description })
const flag = description => ({ type: 'boolean', description })
const number = description => ({ type: 'number', description })

module.exports = [
  tool('file_read', '读取一个或多个文件。优先写 action=one|many；若只传 path 会自动按 one，只传 files 会自动按 many。', {
    action: action(['one', 'many'], 'one 读取单个文件；many 批量读取文件。可省略：有 path 默认 one，有 files 默认 many。'),
    path: text('action=one 时的文件路径。'),
    files: { type: 'array', items: { type: 'object' }, description: 'action=many 时的文件条目。' },
    start_line: { type: 'integer', description: '可选起始行。' }, end_line: { type: 'integer', description: '可选结束行。' },
    max_chars: { type: 'integer', description: '可选最大返回字符数。' }
  }, []),
  tool('file_manage', '管理文件和目录。只用于创建目录、复制、移动或删除，不用于写入文件内容。', {
    action: action(['create_directory', 'copy', 'move', 'delete'], '要执行的文件管理操作。'),
    path: text('创建目录或删除目标时使用的路径。'), source: text('复制或移动时的源文件。'),
    destination: text('复制或移动时的目标文件。'), overwrite: flag('目标已存在时是否覆盖，默认 false。')
  }),
  tool('file_write_session', '大文件分片写入会话。必须依次 start、append、finish。', {
    action: action(['start', 'append', 'finish'], 'start 创建会话；append 追加内容；finish 校验并提交。'),
    path: text('action=start 时的目标文件路径。'), session_id: text('append 或 finish 时的会话 ID。'),
    content_chunk: text('action=append 时的文本分片。'), allow_full_rewrite: flag('确实需要完整重写已有大文件时为 true。'),
    expected_bytes: { type: 'integer', description: 'finish 时可选的完整字节数。' }, expected_sha256: text('finish 时可选的 SHA-256。')
  }),
  tool('file_search', '按路径查找文件。优先 action=glob（文件名/通配，如 **/*desktop*.js）；仅在需要浏览某目录时用 directory。定位代码内容请用 code_inspect action=grep，不要逐层 list 目录。', {
    action: action(['glob', 'directory'], 'glob 按文件名/通配匹配（首选）；directory 列目录。'), path: text('搜索目录，默认项目根。'),
    pattern: text('glob 时的文件名或通配模式，如 **/*.js、*welcome*。'), recursive: flag('directory 时是否递归。'), include_hidden: flag('glob 时是否包含隐藏路径。'),
    limit: { type: 'integer', description: '最大返回数量。' }
  }),
  tool('code_verify', '检查代码语法和改动后的静态契约。', {
    action: action(['file', 'project', 'changes'], 'file 检查一个文件；project 扫描项目；changes 验证本轮改动。'),
    path: text('action=file 时的文件路径。'), files: { type: 'array', items: { type: 'string' }, description: 'action=changes 时可选的文件列表。' },
    roots: { type: 'array', items: { type: 'string' }, description: 'action=project 时可选的扫描根目录。' },
    max_failures: { type: 'integer', description: 'project 时最大失败文件数。' }
  }),
  tool('code_inspect', '代码定位与检查（先搜后读）。首选 action=grep 做项目内内容字面搜索；多线索事实定位用 locate；已知文件内再 find_in_file；影响面用 find_references；调用链用 trace_call_chain；大文件结构用 navigate；差异用 git_diff。不要用 shell_run 跑 rg/grep 代替本工具。', {
    action: action(['grep', 'locate', 'find_in_file', 'navigate', 'find_references', 'trace_call_chain', 'git_diff'], 'grep=项目内容字面搜索（首选）；locate=多词事实定位；find_in_file=单文件内查找；navigate=大纲/符号切片；find_references=引用；trace_call_chain=调用链；git_diff=差异。'),
    query: text('locate 时的需求或错误描述。'), terms: { type: 'array', items: { type: 'string' }, description: 'locate 时提炼出的事实搜索词。' },
    path: text('强烈建议：grep/locate 时限定目录或文件以加速；find_in_file/navigate/git_diff 时为目标路径。'),
    pattern: text('grep 或 find_in_file 的单个搜索词。多个相关词请用 patterns。'),
    patterns: { type: 'array', items: { type: 'string' }, description: 'grep 时多个搜索词（最多 10），一次调用合并搜索。' },
    file_type: text('grep 时可选限定类型：js、ts、html、css、py 等。'),
    regex: flag('grep/find_in_file 是否按正则解释 pattern，默认 false（固定字符串更快）。'),
    case_sensitive: flag('是否区分大小写，默认 false。'),
    context_lines: { type: 'integer', description: '匹配行上下文行数，默认 0，最大 5。' },
    max_results: { type: 'integer', description: '最大命中数量。' },
    symbol: text('find_references / navigate / trace_call_chain 时的函数、类、变量、IPC 名或选择器。'),
    line: { type: 'integer', description: 'navigate 切片时的行号。' },
    navigate_action: { type: 'string', enum: ['outline_file', 'find_symbol', 'slice_by_symbol'], description: 'action=navigate 时的导航动作。' },
    include_definitions: flag('find_references 时是否包含定义处。'),
    limit: { type: 'integer', description: '定位或导航的结果上限。' }, min_lines: { type: 'integer', description: '大纲时最小块行数。' }, max_lines: { type: 'integer', description: '切片时最大行数。' },
    direction: { type: 'string', enum: ['callers', 'callees', 'both'], description: '调用链追踪方向。' }, depth: { type: 'integer', description: '调用链递归深度。' },
    staged: flag('git_diff 时是否查看暂存区。'), stat: flag('git_diff 时是否只返回统计。'), max_chars: { type: 'integer', description: 'Git 差异最大字符数。' }
  }),
  tool('project_history', '查询项目历史资料，或查看、回退最近一次 AI 文件修改。', {
    action: action(['recall', 'ledger', 'latest_change', 'rollback_latest_change', 'search_memos', 'read_memo'], '要执行的项目历史动作。'),
    query: text('recall 或 search_memos 时的关键词。'), max_results: { type: 'integer', description: 'recall 或 search_memos 的结果上限。' },
    entry_id: text('ledger 时的任务或讨论账本 ID。'), memo_id: text('read_memo 时的备忘录 ID。'), terms: { type: 'array', items: { type: 'string' }, description: 'search_memos 时的补充事实词。' },
    paths: { type: 'array', items: { type: 'string' }, description: 'rollback_latest_change 时可选的局部回退文件。' }, force: flag('兼容旧调用的保留字段；冲突内容始终不会被强制覆盖。')
  }),
  tool('skill_manage', '管理可复用技能草稿：创建、安装或列出。', {
    action: action(['draft', 'install', 'list'], 'draft 创建草稿；install 安装草稿；list 列出草稿。'),
    scope: { type: 'string', enum: ['global', 'project'], description: '技能作用域。' }, draft_scope: { type: 'string', enum: ['global', 'project'], description: '待安装草稿所在作用域。' },
    draft_id: text('安装时的草稿 ID。'), name: text('技能稳定名称。'), title: text('草稿标题。'), description: text('使用场景摘要。'),
    content: text('草稿完整 Markdown 内容。'), source_summary: text('草稿来源说明。'), tags: { type: 'array', items: { type: 'string' }, description: '标签。' },
    related_files: { type: 'array', items: { type: 'string' }, description: '相关项目文件。' }, path: text('可选草稿文件路径。')
  }),
  tool('desktop_app', '查找或打开本地软件。', {
    action: action(['find', 'open'], 'find 仅查找；open 查找并启动。'), name: text('软件名称。'), path: text('可选已知可执行文件或快捷方式路径。'),
    args: { type: 'array', items: { type: 'string' }, description: 'open 时传给软件的启动参数。' }, cwd: text('open 时的工作目录。'), visible: flag('open 时是否显示窗口。')
  }),
  tool('image_analyze', '分析本地图片、截图或设计稿。', {
    path: text('图片路径。'), question: text('希望重点分析的问题。')
  }, ['path']),
  tool('mcp', '调用外部开发 MCP：聚合诊断、列工具或调用原子工具。仅在用户明确 @MCP/@aidev 时使用。', {
    action: action(['diagnose', 'list_tools', 'call'], 'diagnose 聚合分析；list_tools 列工具；call 调用原子工具。'),
    server_id: text('可选 MCP 服务 ID。'), mode: text('diagnose 的模式。'), query: text('诊断关键词。'), file: text('重点文件。'),
    files: { type: 'array', items: { type: 'string' }, description: '相关文件。' }, limit: { type: 'integer', description: '结果上限。' },
    inspect_limit: { type: 'integer', description: '检查文件上限。' }, with_content: flag('是否返回文件内容。'), name: text('call 时的原子工具名。'),
    arguments: { type: 'object', description: 'call 时传给 MCP 工具的参数。' }, timeout_ms: { type: 'integer', description: '调用超时。' }
  }),
  tool('media_process', '处理本地媒体：渲染 SVG、提取视频帧或放大图片/视频。', {
    action: action(['render_svg', 'extract_frames', 'upscale'], '要执行的媒体处理操作。'), path: text('输入媒体或 SVG 路径。'), svg_path: text('SVG 文件路径。'), svg_content: text('SVG 源码。'), output_path: text('render_svg 的输出路径。'),
    format: text('输出格式。'), width: { type: 'integer', description: '输出宽度。' }, height: { type: 'integer', description: '输出高度。' }, quality: { type: 'integer', description: '输出质量。' },
    background: text('SVG 渲染背景。'), fit: text('SVG 缩放方式。'), scale: number('放大倍数。'), method: text('放大方法。'),
    timestamps: { type: 'array', items: { type: 'number' }, description: '提帧时间点。' }, interval_seconds: number('提帧间隔。'), max_frames: { type: 'integer', description: '最大帧数。' },
    timeout_ms: { type: 'integer', description: '处理超时。' }, crf: { type: 'integer', description: '视频编码 CRF。' }, preset: text('视频编码预设。')
  })
]
