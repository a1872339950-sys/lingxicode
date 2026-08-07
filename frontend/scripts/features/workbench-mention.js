// 输入框 @ 提及模块：工作台指令 + 外部 MCP 工具指令。
(function () {
  const baseMentions = [
    { label: '计划', token: '@计划', desc: '让 AI 先生成待办，再按计划推进任务', kind: 'plan-directive' },
    { label: '多agent协作', token: '@多agent协作', desc: '让主窗口 AI 发起临时多 AI 协作', kind: 'temporary-agent' },
    { label: '\u7ecf\u9a8c\u6c89\u6dc0', token: '@\u6c89\u6dc0\u7ecf\u9a8c', desc: '\u628a\u672c\u6b21\u53ef\u590d\u7528\u7ecf\u9a8c\u4fdd\u5b58\u4e3a\u5168\u5c40\u5171\u4eab\u7684\u53ef\u5ba1\u67e5\u6280\u80fd\u8349\u7a3f', kind: 'skill-learning' },
    { label: 'Blender', token: '@Blender', desc: '启用 Blender 直接操作工具', kind: 'workbench' },
    { label: 'PPT制作', token: '@PPT制作', desc: '启用演示文稿结构、视觉设计和 PowerPoint 生成工作流', kind: 'ppt-workflow' },
    { label: 'UI美化', token: '@UI美化', desc: '启用高质感前端 UI 设计与美化工作流', kind: 'ui-design' },
    { label: '浏览器预览', token: '@浏览器预览', desc: '启用真实浏览器预览、截图和交互检查', kind: 'ui-preview' },
    { label: '图片生成', token: '@图片生成', desc: '启用页面图片、背景、插画和视觉素材生成', kind: 'ui-asset' },
    { label: 'UI验收', token: '@UI验收', desc: '启用多视口布局、文本溢出和视觉回归验收', kind: 'ui-qa' },
    { label: '游戏制作', token: '@游戏制作', desc: '启用可玩游戏设计、实现、资产和手感验收工作流', kind: 'game-dev' },
    { label: '画布工作流', token: '@画布工作流', desc: '根据用户需求自动生成画布工作流并保存', kind: 'canvas-workflow' },
    { label: '全面诊断 (MCP)', token: '@aidev', desc: '本轮启用 aidev MCP 全面诊断工具，仅在 @ 后对模型可见', kind: 'mcp-gate' },
  ]

  const uiMentionDirectives = [
    {
      token: '@PPT制作',
      prompt: `【用户显式 @ 指令：@PPT制作】
- 本轮用户要求启用 PPT 制作工作流。交付重点是可演示、可保存、结构清晰且视觉统一的 PowerPoint 文件，不是只给大纲或普通文字建议。
- 先判断受众、场景、页数、叙事线、章节结构、每页信息密度、视觉风格、图表/图片/视频/音频素材需求和是否需要演讲备注；缺省时先采用 8-12 页的完整商务/汇报型结构。
- 必须优先使用 artifact_workflow(domain="ppt") 作为统一入口；不要直接调用零散 ppt_* 底层工具。复杂 PPT 应生成完整 Python 脚本交给工作流一次性执行，避免逐页碎调用造成版式漂移。
- 设计时要像真正的演示文稿制作者：控制标题层级、留白、对齐、色彩、字体大小、页间节奏、封面/目录/过渡页/总结页、图表可读性和讲述顺序。
- 如果用户提供文档、表格、图片或旧 PPT，先读取/理解素材，再提炼结构；不要把原文整段塞进幻灯片。长文本要拆成页标题、核心结论、证据和备注。
- 若需要图片、图标、视频或音频素材，可结合项目已有素材或生成类工具，但最终应接入 PPT 并保存为 .pptx。
- 完成后必须说明保存路径、页数、主要版式/内容结构；如果本机 PowerPoint、Python 桥或依赖不可用，要明确报出阻塞原因和下一步。`
    },
    {
      token: '@UI美化',
      prompt: `【用户显式 @ 指令：@UI美化】
- 本轮用户要求启用高质感前端 UI 美化工作流。处理前端页面、应用界面、组件、样式、布局或交互时，把视觉质量作为核心交付物，而不是只做功能可用。
- 优先遵循现有设计系统和项目风格；如果现有界面杂乱，做克制、统一、可维护的改进，包括层级、间距、对齐、色彩、字体、状态、响应式和动效。
- 根据产品类型选择合适气质：工具/工作台界面应安静、高密度、可扫描；展示页/官网/作品集可以更具沉浸感和视觉叙事。
- 避免默认 AI 味的单色渐变、大圆角堆卡片、装饰性光球、无意义 hero 和过度说明文案。实际体验应直接出现在首屏。
- 修改后必须检查文字是否溢出、按钮/卡片是否挤压、移动端是否可用、交互状态是否完整，并在最终回复说明视觉改进点和验证方式。`
    },
    {
      token: '@浏览器预览',
      prompt: `【用户显式 @ 指令：@浏览器预览】
- 本轮用户要求启用真实浏览器预览能力。涉及前端 UI、页面效果、交互、布局、Canvas/WebGL 或响应式时，不要只凭源码判断。
- 如果项目需要 dev server 才能正常渲染，启动或复用本地服务并给出可访问地址；如果 HTML 可直接打开，使用本地文件预览即可。
- 使用浏览器预览、截图或运行时检查确认页面真实渲染状态，包括首屏、关键交互、滚动区域、弹窗/菜单、窄屏和桌面视口。
- 遇到空白画面、资源 404、脚本错误、样式未加载、遮挡或点击无效时，回到源码修复后再次验证。
- 最终回复必须说明预览目标、检查过的视口或关键状态，以及仍未覆盖的风险。`
    },
    {
      token: '@图片生成',
      prompt: `【用户显式 @ 指令：@图片生成】
- 本轮用户要求启用视觉素材生成能力。页面、卡片、背景、品牌区、插画、纹理、产品展示或角色素材需要图片承载时，优先使用真实/生成的位图资产，而不是用纯 CSS 或抽象 SVG 勉强替代。
- 生成图片前要把用途、主体、风格、构图、色彩、尺寸比例、透明背景需求和禁止事项写清楚；生成后把资产接入项目并验证实际渲染。
- 不要把图片当成装饰噪音。素材必须服务于产品、场景、对象或用户任务，并在移动端和桌面端都有合理裁切。
- 如果当前任务不需要新增图片，明确保持现有资产，仅用布局/样式优化。`
    },
    {
      token: '@UI验收',
      prompt: `【用户显式 @ 指令：@UI验收】
- 本轮用户要求启用前端 UI 验收。完成修改后必须做可复现的界面验证，优先覆盖桌面和移动端视口。
- 验收重点：页面非空、资源加载成功、主要交互可点击、文本不溢出、不互相遮挡、固定格式控件不跳动、Canvas/WebGL 非空且正确取景、滚动/弹窗/菜单状态可用。
- 可使用浏览器自动化、截图、像素/DOM 检查、控制台错误检查和项目已有测试脚本。发现问题就继续修复并复验。
- 最终回复列出已验证的视口、命令或截图检查结果；如果某项无法验证，要说清楚原因。`
    },
    {
      token: '@游戏制作',
      prompt: `【用户显式 @ 指令：@游戏制作】
- 本轮用户要求启用游戏制作工作流。交付重点是实际可玩的游戏体验，不是介绍页、说明页或静态 Demo。
- 先判断游戏类型、核心循环、胜负/得分/关卡/重开机制、输入方式、难度节奏、反馈音画和移动端适配；缺省时用最小但完整的玩法闭环实现。
- 对已有规则、物理、寻路、碰撞、棋类/牌类/AI 等成熟领域，优先使用项目已有依赖或稳定库；只有简单原型或用户明确要求时才手写核心逻辑。
- Web 游戏应优先使用 Canvas、SVG、DOM 或 Three.js 中最适合的一种；3D 游戏用 Three.js，并保证主场景非空、取景正确、可交互或有运动反馈。
- 必须包含目标玩家自然会期待的控制、状态、暂停/继续或重开、失败/胜利反馈、分数/进度、键盘与触摸/鼠标输入提示中的必要部分。
- 必须使用视觉资产或程序化游戏素材，避免只有文字按钮的空壳。可以用项目现有素材、生成位图资产、Canvas 绘制、精简 SVG 或 Three.js 几何体。
- 完成后必须运行或预览验证：确认无控制台错误、游戏能开始、输入有效、状态会变化、胜负/重开链路可用，Canvas/WebGL 不是空白。`
    }
  ]

  let mentionMenu = null
  let mentionItems = []
  let mentionActive = 0
  let mentionSearchQuery = ''
  let mentionSearchTouched = false
  let mentionRangeKey = ''
  let mentionHighlight = null
  let inputBoxEl = null
  let inputWrapperEl = null
  let getTextInputUI = null
  let updateSendBtnStateFn = null
  let getActiveProjectIdFn = null
  let mcpMentions = []
  let mcpLoadedAt = 0
  let mcpLoadingPromise = null

  function escapeMentionText(value = '') {
    return String(value || '').replace(/[&<>"']/g, char => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    })[char])
  }

  function escapeRegExp(value = '') {
    return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  }

  function tokenBoundaryPattern(token) {
    return `${escapeRegExp(token)}(?=$|\\s|[，。,.、:：；;])`
  }

  function hasMentionToken(value = '', token = '') {
    if (!token) return false
    return new RegExp(tokenBoundaryPattern(token), 'i').test(String(value || ''))
  }

  function parseMcpMentionTokens(value = '') {
    const tokens = []
    const pattern = /@MCP:([a-zA-Z0-9_.-]+):([a-zA-Z0-9_.-]+)(?=$|\s|[，。,.、:：；;])/g
    let match
    while ((match = pattern.exec(String(value || ''))) !== null) {
      tokens.push({
        token: match[0],
        serverId: match[1],
        toolName: match[2],
        start: match.index,
        end: match.index + match[0].length
      })
    }
    return tokens
  }

  function buildMentionDirectivePrompt(value = '') {
    const parts = []
  if (hasMentionToken(value, '@计划')) {
    const userTask = String(value || '').replace(/@计划(?=$|\s|[，。,.、:：；;])/ig, '').trim()
    parts.push(`【用户显式 @ 指令：@计划】
- 用户本轮显式要求你以计划方式推进，但这不是发送后立刻弹窗的硬限制。
- 你可以先理解需求、必要时做少量只读定位或澄清；在准备进入实际执行、修改文件、运行高成本操作或需要用户确认方向之前，再调用 confirm_plan 工具把待办计划以步骤列表形式呈现给用户确认。
- confirm_plan 的 plan 参数中每个元素为一步，只写重点短标题，建议 3-6 步；每步尽量控制在 8-18 个字，使用“定位问题 / 修改实现 / 验证结果”这类动宾短句；summary 参数写需求概况。
- 用户确认后，按计划逐步执行。**每执行完一个步骤，调用 complete_step 报告进度**，参数传：step_index（当前完成步骤索引，从0开始）、steps（全部步骤标题数组）、total_steps（总步数）、status（'completed'）和phase（当前阶段描述）。该工具只更新内部计划进度状态，不会在聊天区显示为工具卡片。
- 待办应包含可验证的关键步骤，不要写长段说明、背景解释或泛泛计划。
- 如果任务涉及修改代码、排查问题、创建文件、运行验证或需要跨模块处理，必须在计划中体现。
- 原始用户需求：${userTask || String(value || '').trim()}`)
    }
    if (hasMentionToken(value, '@多agent协作')) {
      const userTask = String(value || '').replace(/@多agent协作(?=$|\s|[，。,.、:：；;])/ig, '').trim()
      parts.push(`【用户显式 @ 指令：@多agent协作】
- 用户本轮显式要求启用临时多 AI 协作。
- 你必须优先遵循这个显式指令，调用 request_agent_collaboration，在协作画布中启动一次性多 AI 任务；不要只用普通正文回复代替。
- 请基于用户原始需求拆分临时 AI。任务简单时用 2 个；需要并行排查、实现、验证时用 3-4 个；大型审查或多模块任务最多可用 10 个，但不要机械调满上限。
- 需要给每个临时 AI 写清 task、role/name、必要时写 focusPaths；默认推荐 parallel，存在明显前后依赖时用 serial。
- 原始用户需求：${userTask || String(value || '').trim()}`)
    }

    if (hasMentionToken(value, '@画布工作流')) {
      const userTask = String(value || '').replace(/@画布工作流(?=$|\s|[，。,.、:：；;])/ig, '').trim()
      parts.push(`【用户显式 @ 指令：@画布工作流】
- 用户本轮要求根据需求自动创建画布工作流并保存到项目。
- 你必须分析用户的原始需求，拆解出合理的工作流节点和依赖关系，然后调用 create_canvas_workflow 工具一次性提交完整的工作流 JSON。

**工作流数据结构：**
  - name: 工作流名称（简洁有语义）
  - description: 工作流目标简述
  - nodes: 节点数组，必须包含恰好 1 个 input 节点、1-N 个 work 节点、1 个 output 节点
  - edges: 连接关系数组，形成从 input 到 work 到 output 的有向无环图

- 节点字段：
  · id: 唯一标识，如 "input-xxx"、"work-1"、"output-xxx"
  · type: "input" | "work" | "output"
  · name: 节点显示名称，如"数据采集""接口实现""测试验证"
  · task: 具体任务描述（work 节点必须非空且具体可执行）
  · outputRule: 输出要求/格式说明
  · modelKey/modelName: 留空，用户在画布中手动选择
  · x/y: 画布坐标，input 约 x:90, work 从 x:360 起每隔 290, output 约 x:1090; y 按 150 + (index%4)*184

**操作步骤：**
1. 分析用户需求，设计工作流结构（节点数量、任务分配、依赖关系）
2. 构建 name、description、nodes、edges 参数
3. 调用 create_canvas_workflow 工具一次性提交
4. 工具会自动保存到后端并通知前端切换到画布视图
5. 在聊天中简要说明：工作流名称、各节点任务摘要、依赖关系，并告知用户可以在画布中查看和编辑

**设计原则：**
- 每个 work 节点应承担一个清晰、独立的子任务，不要把所有工作塞进一个节点
- 有先后依赖的节点串行连接，可并行的节点从同一上游分叉
- output 节点的 outputRule 应描述如何汇总上游交付
- 节点 name 要简洁有语义，task 描述要具体可执行
- 如果用户需求过于简单（比如只改一个文案），不需要创建多节点工作流，直接说明即可

- 原始用户需求：${userTask || String(value || '').trim()}`)
    }

    if (hasMentionToken(value, '@\u6c89\u6dc0\u7ecf\u9a8c')) {
      const userTask = String(value || '').split('@\u6c89\u6dc0\u7ecf\u9a8c').join('').trim()
      parts.push(`[User @ directive: shared skill learning]
- The user wants reusable experience from this task to become an auditable skill draft.
- Default to a global/shared draft so the skill can be reused across projects. Use scope="project" only when the lesson is strictly tied to this project.
- Do not memorize everything. Only capture reusable conventions, pitfalls, workflows, validation methods, or proven fixes.
- After the main task is handled, call create_skill_draft if there is useful reusable knowledge. Prefer scope="global"; include scope="project" only for current-project-only knowledge.
- The SKILL.md content must include: when to use it, trigger conditions, steps, validation, pitfalls, and related files or context.
- create_skill_draft only creates a candidate draft. Do not call install_skill_draft unless the user explicitly asks to install/save that draft.
- If there is no useful reusable lesson this turn, say no draft was created.
- Original user request: ${userTask || String(value || '').trim()}`)
    }

    uiMentionDirectives.forEach(item => {
      if (hasMentionToken(value, item.token)) {
        parts.push(`${item.prompt}
- 原始用户需求：${String(value || '').trim()}`)
      }
    })

    // @aidev / @MCP：本轮显式启用 aidev-prototype MCP 全面诊断，补一段 directive。
    if (/@(?:aidev|AIDev|AiDev|aidev[-_]prototype|MCP|mcp)\b/i.test(String(value || ''))) {
      parts.push(`【用户显式 @ 指令：@aidev / @MCP】
- 用户本轮显式启用外部 aidev-prototype MCP，该 MCP 提供全面诊断、项目概览、自然语言定位、候选扫描、文件感知、语法/静态检查和影响面分析。
- 本轮可以调用 mcp_aidev_workflow、mcp_list_tools、mcp_call_tool；默认在不 @ 的轮次这三个入口不可见也不可调用。
- mcp_aidev_workflow 默认走 auto/diagnose，耗时较长。如果仅需定位文件位置，优先传 mode=locate；仅补口 ok/生成明确报告时才用 verify/diagnose。
- 实际修改文件仍走灵犀原生编辑工具和改后验证，MCP 只负责材料和定位。
- 原始用户需求：${String(value || '').trim()}`)
    }

    const mcpTokens = parseMcpMentionTokens(value)
    if (mcpTokens.length) {
      const lines = mcpTokens.map(item => `- server_id=${item.serverId}, tool=${item.toolName}`).join('\n')
      parts.push(`【用户显式 @ 指令：外部 MCP 聚合工具】
用户在输入框中明确选择了以下外部 MCP 工作流，本轮必须优先围绕它们工作：
${lines}
- tool=workflow 表示必须优先使用 mcp_aidev_workflow，并传入对应 server_id；不要拆成多个零碎 MCP 小工具调用。
- 只有聚合工作流结果仍不足时，才允许用 mcp_call_tool 做高级补充调用。
- 如果用户没有写参数，请根据当前任务推断 arguments；不要把 @MCP 令牌当普通文本忽略。
- 外部 MCP 用来提供项目感知、定位、检查、影响面或日志材料；真正写文件仍遵循灵犀原生编辑与验证链路。`)
    }

    return parts.length ? `\n\n${parts.join('\n\n')}` : ''
  }

  function stripMentionDirectives(value = '') {
    const text = String(value || '')
    const ranges = getMentionTokenRanges(text)
    if (!ranges.length) return text.trim()
    let output = ''
    let cursor = 0
    ranges.forEach(range => {
      output += text.slice(cursor, range.start)
      cursor = range.end
    })
    output += text.slice(cursor)
    return output
      .replace(/[ \t]{2,}/g, ' ')
      .replace(/\n[ \t]+/g, '\n')
      .trim()
  }

  function getMentionDirectiveBadges(value = '') {
    const text = String(value || '')
    const ranges = getMentionTokenRanges(text)
    if (!ranges.length) return []
    const seen = new Set()
    return ranges.map(range => {
      const token = text.slice(range.start, range.end)
      const known = allMentionItems().find(item => item.token.toLowerCase() === token.toLowerCase())
      const mcp = /^@MCP:([a-zA-Z0-9_.-]+):([a-zA-Z0-9_.-]+)$/i.exec(token)
      const label = known?.label || (mcp ? `MCP ${mcp[2]}` : token)
      const desc = known?.desc || (mcp ? `server: ${mcp[1]}` : '')
      return {
        token,
        label,
        desc,
        kind: known?.kind || (mcp ? 'mcp-workflow' : 'workbench')
      }
    }).filter(item => {
      const key = item.token.toLowerCase()
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
  }

  async function refreshMcpMentions(force = false) {
    const now = Date.now()
    if (!force && mcpMentions.length && now - mcpLoadedAt < 30000) return mcpMentions
    if (mcpLoadingPromise) return mcpLoadingPromise
    mcpLoadingPromise = (async () => {
      try {
        if (!window.api?.listMcpServers || !window.api?.listMcpTools) return mcpMentions
        const projectId = getActiveProjectIdFn?.() || ''
        const serverResult = await window.api.listMcpServers({ projectId })
        const servers = (Array.isArray(serverResult?.servers) ? serverResult.servers : [])
          .filter(server => server?.available && server?.id !== 'lingxi-project')
        const groups = await Promise.all(servers.map(async server => {
          try {
            const toolsResult = await window.api.listMcpTools({ projectId, serverId: server.id })
            return { server, tools: Array.isArray(toolsResult?.tools) ? toolsResult.tools : [] }
          } catch {
            return { server, tools: [] }
          }
        }))
        mcpMentions = groups.map(group => ({
          label: 'MCP 聚合工作流',
          token: `@MCP:${group.server.id}:workflow`,
          desc: `${group.server.name || group.server.id}，内部 ${group.tools.length} 个能力`,
          kind: 'mcp-workflow',
          serverId: group.server.id,
          toolName: 'workflow'
        }))
        mcpLoadedAt = Date.now()
        return mcpMentions
      } finally {
        mcpLoadingPromise = null
      }
    })()
    return mcpLoadingPromise
  }

  function allMentionItems() {
    return [...baseMentions, ...mcpMentions]
  }

  function getMentionTokenRanges(value = '') {
    if (String(value || '').length > 2000) return []
    const staticTokens = allMentionItems()
      .map(item => item.token)
      .sort((a, b) => b.length - a.length)
    const ranges = []
    if (staticTokens.length) {
      const pattern = new RegExp(`(${staticTokens.map(escapeRegExp).join('|')})(?=$|\\s|[，。,.、:：；;])`, 'g')
      let match
      while ((match = pattern.exec(value)) !== null) {
        ranges.push({ start: match.index, end: match.index + match[0].length })
      }
    }
    parseMcpMentionTokens(value).forEach(item => {
      if (!ranges.some(range => range.start === item.start && range.end === item.end)) {
        ranges.push({ start: item.start, end: item.end })
      }
    })
    return ranges.sort((a, b) => a.start - b.start)
  }

  function ensureMentionHighlight() {
    if (mentionHighlight) return mentionHighlight
    mentionHighlight = document.createElement('div')
    mentionHighlight.className = 'chat-input-highlight'
    inputBoxEl?.parentElement?.insertBefore(mentionHighlight, inputBoxEl)
    return mentionHighlight
  }

  function updateWorkbenchMentionHighlight() {
    if (!inputBoxEl) return
    const value = inputBoxEl.value || ''
    const ranges = getMentionTokenRanges(value)
    inputWrapperEl?.classList.toggle('has-workbench-mention', ranges.length > 0)
    const layer = ensureMentionHighlight()
    if (!ranges.length) {
      layer.innerHTML = ''
      layer.style.transform = ''
      return
    }
    let cursor = 0
    const html = []
    ranges.forEach(range => {
      html.push(escapeMentionText(value.slice(cursor, range.start)))
      html.push(`<span class="chat-input-highlight-token">${escapeMentionText(value.slice(range.start, range.end))}</span>`)
      cursor = range.end
    })
    html.push(escapeMentionText(value.slice(cursor)) || '<br>')
    layer.innerHTML = html.join('')
    layer.style.transform = `translateY(${-inputBoxEl.scrollTop}px)`
  }

  function deleteWorkbenchMentionToken(event) {
    if (!inputBoxEl) return false
    const value = inputBoxEl.value || ''
    const start = inputBoxEl.selectionStart ?? 0
    const end = inputBoxEl.selectionEnd ?? start
    if (start !== end) return false
    const ranges = getMentionTokenRanges(value)
    let target = null
    if (event.key === 'Backspace') {
      target = ranges.find(range => start > range.start && start <= range.end + (value[range.end] === ' ' ? 1 : 0))
    } else if (event.key === 'Delete') {
      target = ranges.find(range => start >= range.start && start < range.end)
    }
    if (!target) return false
    event.preventDefault()
    const removeEnd = event.key === 'Backspace' && value[target.end] === ' ' ? target.end + 1 : target.end
    inputBoxEl.value = value.slice(0, target.start) + value.slice(removeEnd)
    inputBoxEl.setSelectionRange(target.start, target.start)
    getTextInputUI?.()?.autoResize?.()
    hideWorkbenchMentionMenu()
    updateWorkbenchMentionHighlight()
    updateSendBtnStateFn?.()
    return true
  }

  function ensureMentionMenu() {
    if (mentionMenu) return mentionMenu
    mentionMenu = document.createElement('div')
    mentionMenu.className = 'workbench-mention-menu'
    mentionMenu.hidden = true
    inputWrapperEl?.appendChild(mentionMenu)
    return mentionMenu
  }

  function getMentionQuery() {
    if (!inputBoxEl) return null
    const value = inputBoxEl.value || ''
    if (value.length > 2000) return null
    const caret = inputBoxEl.selectionStart ?? value.length
    const before = value.slice(0, caret)
    const match = before.match(/(^|\s)@([\u4e00-\u9fa5A-Za-z0-9_:/.-]*)$/)
    if (!match) return null
    const start = before.length - match[0].trimStart().length
    return { query: match[2] || '', start, end: caret }
  }

  function hideWorkbenchMentionMenu(options = {}) {
    if (!mentionMenu) return
    if (!options.force && mentionMenu.contains(document.activeElement)) return
    mentionMenu.hidden = true
    mentionMenu.innerHTML = ''
    mentionItems = []
    mentionActive = 0
    mentionSearchQuery = ''
    mentionSearchTouched = false
    mentionRangeKey = ''
  }

  function insertWorkbenchMention(item) {
    if (!inputBoxEl) return
    const range = getMentionQuery()
    if (!range || !item) return
    const value = inputBoxEl.value || ''
    inputBoxEl.value = `${value.slice(0, range.start)}${item.token} ${value.slice(range.end)}`
    const nextCaret = range.start + item.token.length + 1
    inputBoxEl.setSelectionRange(nextCaret, nextCaret)
    hideWorkbenchMentionMenu({ force: true })
    inputBoxEl.focus()
    getTextInputUI?.()?.autoResize?.()
    updateWorkbenchMentionHighlight()
    updateSendBtnStateFn?.()
  }

  function renderWorkbenchMentionMenu() {
    const range = getMentionQuery()
    if (!range) {
      hideWorkbenchMentionMenu({ force: true })
      return
    }
    const rangeKey = `${range.start}:${range.end}:${range.query}`
    if (rangeKey !== mentionRangeKey) {
      if (!mentionMenu?.contains(document.activeElement)) {
        mentionSearchQuery = ''
        mentionSearchTouched = false
      }
      mentionRangeKey = rangeKey
    }
    const searchValue = mentionSearchTouched ? mentionSearchQuery : range.query
    const query = searchValue.trim().toLowerCase()
    if ((!mcpMentions.length || query.startsWith('mcp')) && !mcpLoadingPromise) {
      refreshMcpMentions().then(() => {
        if (getMentionQuery()) renderWorkbenchMentionMenu()
      })
    }
    mentionItems = allMentionItems().filter(item => {
      const haystack = `${item.label} ${item.token} ${item.desc}`.toLowerCase()
      return !query || haystack.includes(query)
    })
    mentionActive = mentionItems.length
      ? Math.min(mentionActive, mentionItems.length - 1)
      : 0
    const menu = ensureMentionMenu()
    const itemsHtml = mentionItems.length
      ? mentionItems.map((item, index) => `
        <button class="workbench-mention-item ${index === mentionActive ? 'active' : ''}" type="button" data-index="${index}">
          <span class="workbench-mention-token">${escapeMentionText(item.token)}</span>
          <span class="workbench-mention-desc">${escapeMentionText(item.desc)}</span>
        </button>
      `).join('')
      : '<div class="workbench-mention-empty">没有匹配的指令</div>'
    menu.innerHTML = `
      <input class="workbench-mention-search" type="search" value="${escapeMentionText(searchValue)}" placeholder="搜索 @ 指令" autocomplete="off" spellcheck="false">
      <div class="workbench-mention-list">${itemsHtml}</div>
    `
    menu.hidden = false
    const searchInput = menu.querySelector('.workbench-mention-search')
    searchInput?.addEventListener('mousedown', event => {
      event.stopPropagation()
    })
    searchInput?.addEventListener('blur', () => {
      setTimeout(hideWorkbenchMentionMenu, 120)
    })
    searchInput?.addEventListener('input', event => {
      mentionSearchTouched = true
      mentionSearchQuery = event.target.value || ''
      mentionActive = 0
      renderWorkbenchMentionMenu()
      const nextInput = mentionMenu?.querySelector('.workbench-mention-search')
      nextInput?.focus()
      if (nextInput) {
        const nextCaret = nextInput.value.length
        nextInput.setSelectionRange(nextCaret, nextCaret)
      }
    })
    searchInput?.addEventListener('keydown', event => {
      if (!handleMentionKeyDown(event)) return
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        const nextInput = mentionMenu?.querySelector('.workbench-mention-search')
        nextInput?.focus()
        if (nextInput) {
          const nextCaret = nextInput.value.length
          nextInput.setSelectionRange(nextCaret, nextCaret)
        }
      } else if (event.key === 'Escape') {
        inputBoxEl?.focus()
      }
    })
    menu.querySelectorAll('[data-index]').forEach(btn => {
      btn.addEventListener('mousedown', event => {
        event.preventDefault()
        insertWorkbenchMention(mentionItems[Number(btn.dataset.index || 0)])
      })
    })
    requestAnimationFrame(() => {
      menu.querySelector('.workbench-mention-item.active')?.scrollIntoView({ block: 'nearest' })
    })
  }

  function handleMentionKeyDown(e) {
    if (!mentionMenu || mentionMenu.hidden) return false
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      if (!mentionItems.length) return true
      const delta = e.key === 'ArrowDown' ? 1 : -1
      mentionActive = (mentionActive + delta + mentionItems.length) % mentionItems.length
      renderWorkbenchMentionMenu()
      return true
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      if (!mentionItems[mentionActive]) return true
      insertWorkbenchMention(mentionItems[mentionActive])
      return true
    }
    if (e.key === 'Escape') {
      e.preventDefault()
      hideWorkbenchMentionMenu({ force: true })
      return true
    }
    return false
  }

  function bind(deps = {}) {
    inputBoxEl = deps.inputBox || null
    inputWrapperEl = deps.inputWrapper || null
    if (typeof deps.getTextInputUI === 'function') getTextInputUI = deps.getTextInputUI
    if (typeof deps.updateSendBtnState === 'function') updateSendBtnStateFn = deps.updateSendBtnState
    if (typeof deps.getActiveProjectId === 'function') getActiveProjectIdFn = deps.getActiveProjectId
    refreshMcpMentions()
  }

  window.WorkbenchMention = {
    bind,
    escapeMentionText,
    hasMentionToken,
    buildMentionDirectivePrompt,
    stripMentionDirectives,
    getMentionDirectiveBadges,
    getWorkbenchTokenRanges: getMentionTokenRanges,
    updateWorkbenchMentionHighlight,
    deleteWorkbenchMentionToken,
    hideWorkbenchMentionMenu,
    insertWorkbenchMention,
    renderWorkbenchMentionMenu,
    handleMentionKeyDown,
    refreshMcpMentions,
    get isMenuVisible() { return !!mentionMenu && !mentionMenu.hidden }
  }
})()
