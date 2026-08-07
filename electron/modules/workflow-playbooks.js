/**
 * Session and turn-level work playbooks.
 * Routes multi-step work into phase sequences without inventing new tools.
 */

const PLAYBOOKS = Object.freeze({
  feature: {
    id: 'feature',
    title: '功能开发',
    phases: [
      { id: 'clarify', label: '澄清目标与边界', actions: '确认要交付的用户可见结果、约束、不做什么' },
      { id: 'locate', label: '定位入口与影响面', actions: '用具体关键词/路径收敛真实入口、调用链与相邻模式' },
      { id: 'plan', label: '短计划', actions: '多步骤时用 confirm_plan/update 进度；小改可跳过弹窗但仍心里有序' },
      { id: 'implement', label: '最小正确实现', actions: '优先 apply_patch/text_edit；贴合现有风格；不做无关重构' },
      { id: 'verify', label: '分层验证', actions: '语法/相关检查 → 必要的运行或 runtime_verify → 再交付' },
      { id: 'deliver', label: '交付', actions: '说明改了什么、如何验证、剩余风险；有代码改动则写 AI 操作备忘录' }
    ]
  },
  bugfix: {
    id: 'bugfix',
    title: '缺陷修复',
    phases: [
      { id: 'reproduce', label: '复现/抓入口', actions: '用户操作、命令、日志、堆栈或失败断言；先证据后猜测' },
      { id: 'root-cause', label: '根因与契约', actions: '追到数据流/状态/导出导入/IPC 契约，不修表象' },
      { id: 'minimal-fix', label: '最小修复', actions: '只改相关文件；避免平行实现与大范围重写' },
      { id: 'verify', label: '验证', actions: '复现路径再走一遍；语法/测试/运行态能跑则跑' },
      { id: 'deliver', label: '交付', actions: '根因 + 改动 + 验证结果；必要时备忘录' }
    ]
  },
  diagnose: {
    id: 'diagnose',
    title: '排查诊断',
    phases: [
      { id: 'scope', label: '划定范围', actions: '现象、期望、触发条件、是否全项目宽泛排查' },
      { id: 'evidence', label: '取证', actions: '并行事实搜索与读片段；宽泛问题覆盖多类失败面' },
      { id: 'hypothesis', label: '假设与排除', actions: '用证据排除；产品选择先问用户' },
      { id: 'report-or-fix', label: '报告或修复', actions: '用户只要原因则只读报告；要求修则转最小修复并验证' }
    ]
  },
  artifact: {
    id: 'artifact',
    title: '产物相关协助',
    phases: [
      { id: 'brief', label: '明确交付物', actions: '用户要的是代码/资源文件/使用说明，还是自己在工作台里做' },
      { id: 'route', label: '分流', actions: '工作台类制作引导用户在界面操作；工程侧用读写文件、生成素材、改项目代码协助' },
      { id: 'build', label: '可交付协助', actions: '生成资源、写页面/脚本、整理素材路径；不操作产品右侧工作台' },
      { id: 'deliver', label: '交付', actions: '说明文件位置、如何预览；工作台步骤用自然语言指引用户' }
    ]
  },
  creative_web: {
    id: 'creative_web',
    title: '网页/前端交付',
    phases: [
      { id: 'direction', label: '方向', actions: '按用户需求给可选方向；不强制沉浸式' },
      { id: 'scaffold', label: '骨架', actions: '入口、样式、主视觉/内容结构、资源引用' },
      { id: 'implement', label: '实现', actions: '交互/动效/响应式；优先项目已有依赖' },
      { id: 'playtest', label: '预览验证', actions: 'runtime_verify 或本地预览；白屏/点击/资源加载' },
      { id: 'deliver', label: '交付', actions: '如何打开、是否需本地服务、已知限制' }
    ]
  },
  collab: {
    id: 'collab',
    title: '多 AI 协作',
    phases: [
      { id: 'split', label: '拆任务', actions: '按可并行边界拆分，控制数量' },
      { id: 'launch', label: '启动', actions: 'request_agent_collaboration；不阻塞死等' },
      { id: 'collect', label: '汇总', actions: '用户决定是否送回主会话；读临时汇报文件' },
      { id: 'integrate', label: '整合验证', actions: '主会话合并结论并做最终验证' }
    ]
  }
})

function hasAny(text, patterns) {
  return patterns.some(re => re.test(text))
}

function detectPlaybookId(userMessage = '', options = {}) {
  const text = String(userMessage || '')
  if (!text.trim()) return 'feature'

  // External software / absolute path tasks should not pull in-repo feature playbooks.
  try {
    if (require('./prompt-disclosure').detectExternalTargetIntent(text)) return null
  } catch (_) { /* optional */ }

  if (options.skillHint === 'tdd' || /(?:^|\s)\$?tdd\b|测试驱动|先写测试/i.test(text)) {
    return 'feature'
  }

  if (hasAny(text, [
    /@(?:PPT|ppt|Blender|blender|粒子|音乐|演示文稿)/i,
    /做\s*(?:个|一个)?\s*(?:PPT|演示文稿|幻灯片)|生成\s*PPT/i,
    /工作台|粒子效果|配乐|BGM|音乐工作台|3D\s*模型|三维模型/i
  ])) return 'artifact'

  if (hasAny(text, [
    /多\s*AI|多AI|协作画布|并行排查|派几个|临时\s*AI|request_agent_collaboration/i
  ])) return 'collab'

  if (hasAny(text, [
    /网页|网站|落地页|作品集|个人站|前端页面|landing|portfolio|官网|沉浸式|WebGL|Three\.js|GSAP/i
  ]) && hasAny(text, [
    /做|建|开发|实现|改|优化|美化|重构|页面/i
  ])) return 'creative_web'

  // Read-only investigation before fix intent.
  if (hasAny(text, [
    /为什么|原因|根因|排查|定位|诊断|全面检查|全面排查|分析问题|哪里有问题|看看.*问题|先别改|不要改|只分析|只要原因|先看/i
  ]) && !hasAny(text, [/实现|新增|开发|做一个|加一个功能|直接修|帮我修|修复一下|修掉/i])) {
    return 'diagnose'
  }

  if (hasAny(text, [
    /bug|报错|错误|异常|失败|崩溃|卡死|不生效|没反应|修复|修一下|还是不行|依旧|回归|syntax|typeerror/i
  ])) return 'bugfix'

  if (hasAny(text, [
    /实现|开发|新增|添加|做一个|加一个|接入|支持|重构|优化功能|feature/i
  ])) return 'feature'

  return null
}

function formatPlaybook(playbook, { compact = false } = {}) {
  if (!playbook) return ''
  if (compact) {
    const chain = playbook.phases.map(p => p.label).join(' → ')
    return `当前推荐工作流【${playbook.title}】：${chain}。按阶段推进，跳过不适用步骤时心里要有依据；未验证不要宣称完成。`
  }
  const lines = playbook.phases.map((p, i) =>
    `${i + 1}. ${p.label}：${p.actions}`
  )
  return [
    `===== 本轮工作流：${playbook.title} =====`,
    `- 按阶段推进；可并行只读取证，但不要跳过「验证」就交付。`,
    `- 小任务可压缩阶段，但「证据 → 改动 → 验证」顺序尽量保留。`,
    `- Plan 未确认前不写仓库；update/complete_step 只表示进度，不代替确认。`,
    ...lines
  ].join('\n')
}

function buildSessionWorkflowPrompt(lang = 'zh-CN') {
  // Codex-style: only a short rhythm + pointer to progressive catalog.
  if (lang === 'en-US') {
    return `===== Multi-step work rhythm =====
- Non-trivial work: clarify → evidence → change → verify → deliver.
- Until the user confirms a plan, prefer read-only exploration; do not mutate the repo.
- complete_step updates UI only; it is not permission to skip verification.
- Domain playbooks are progressive: the system injects only the matched short chain this turn (see playbook catalog).
- Before claiming done: run the best available checks; if you could not verify, say so explicitly.`
  }
  return `===== 多步任务工作流节奏 =====
- 非琐碎任务：澄清目标 → 取证定位 → 改动实现 → 验证 → 交付。
- Plan 未确认前以只读取证为主，不要改仓库。
- complete_step 只更新进度面板，不代替验证或授权。
- 领域剧本渐进展开：本轮只注入匹配到的短链（见流程剧本目录），不常驻全文。
- 宣称完成前：能跑的检查要跑；跑不了写明原因。技能命中后先读完整 SKILL.md。`
}

function buildTurnWorkflowPrompt(userMessage = '', options = {}) {
  const id = detectPlaybookId(userMessage, options)
  if (!id) return ''
  const playbook = PLAYBOOKS[id]
  if (!playbook) return ''
  // Default compact: phase labels only. Full phase actions only when options.compact === false.
  const compact = options.compact !== false
  return formatPlaybook(playbook, { compact })
}

function listPlaybooks() {
  return Object.values(PLAYBOOKS).map(p => ({
    id: p.id,
    title: p.title,
    phases: p.phases.map(ph => ph.id)
  }))
}

module.exports = {
  PLAYBOOKS,
  detectPlaybookId,
  formatPlaybook,
  buildSessionWorkflowPrompt,
  buildTurnWorkflowPrompt,
  listPlaybooks
}
