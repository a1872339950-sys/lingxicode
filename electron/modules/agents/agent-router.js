/**
 * Deterministic task router for first-class agent roles.
 *
 * Keep routing rule-based and evidence-based. The model may choose details
 * inside a role, but role selection should not depend on model guessing.
 */

const { getAgentRole } = require('./agent-registry')

function includesAny(text, patterns) {
  return patterns.some(pattern => pattern.test(text))
}

function hasWorkbenchMention(text = '', kind = '') {
  const value = String(text || '')
  if (kind === 'blender') {
    return /@(?:Blender|blender|布兰德)(?=$|[\s，。,.、:：；;])/i.test(value)
  }
  return false
}

// 排除词：当文本里出现这些"模型/工作台"的非 3D 含义时，不应被 3D 路由捕获
// 覆盖：AI/LLM 模型、模型选择/切换/配置、模型 API/库、音乐/粒子/excel 等其它工作台、Mongoose/ORM data model 等
const NON_3D_MODEL_CONTEXT = /(AI\s*模型|大模型|语言模型|视觉模型|多模态|聊天模型|对话模型|思考模型|嵌入模型|embed模型|向量模型|代码模型|图片生成模型|音乐模型|视频模型|工具模型|tts\s*模型|asr\s*模型|模型选择|选择模型|切换模型|切模型|模型切换|模型配置|配置模型|模型回复|模型输出|模型返回|模型调用|调用模型|模型接口|模型\s*api|模型\s*sdk|模型库|模型列表|模型管理|模型供应商|模型厂商|模型路由|模型分发|模型能力|模型权限|模型计费|模型 token|模型上下文|模型标注|系统模型|默认模型|主模型|备用模型|模型 ID|model[_-]?id|模型名称|模型 key|数据模型|model class|orm.{0,4}模型|mongoose|sequelize|prisma|表模型|实体模型|领域模型|domain model|业务模型|权限模型|事件模型|状态模型|心智模型|商业模型|盈利模型|思维模型|定价模型|模型评测|模型对比|模型测试|模型微调|微调模型|训练模型|蒸馏模型|开源模型|本地模型|云端模型|私有模型|模型部署|部署模型|工作台(?!.{0,6}(3d|三维|3D|建模|Studio|studio|Blender|blender|模型|网格|mesh)))/i

// 强 3D 上下文词：当文本里出现这些词时，才允许 3D 路由命中
const STRONG_3D_CONTEXT = /(3d|3D|三维|建模|雕刻|拓扑|网格|mesh|UV|贴图|材质球|Blender|blender|布兰德|maya|c4d|cinema4d|zbrush|substance|glb|gltf|fbx|obj 文件|stl 文件|ply 文件|\.blend\b|\.glb\b|\.gltf\b|\.fbx\b|参考图.{0,20}(建模|模型|3d)|图.{0,10}转.{0,10}(3d|模型)|文生图.{0,20}(建模|3d))/i

// 开发/聊天软件上下文：出现这些词时，意味着用户大概率在聊代码/产品/界面而不是建模
const DEV_CONTEXT_HINT = /(代码|审查|审核|review|聊天|对话|消息|气泡|页面|界面|按钮|菜单|侧栏|工具栏|弹窗|表单|表格|列表|路由|接口|api|后端|前端|数据库|sql|配置文件|环境变量|.js\b|.ts\b|.json\b|.css\b|.html\b|.py\b|.vue\b|electron|nodejs|react|vue|安装|部署|打包|构建脚本|启动|登录|注册|权限|账号|订阅|更新检查|工程|项目|审查项目|扫描项目|为什么|原因|是不是|是否|看看|查找|找一下|定位|分析|分析一下|建议|对比|区别)/i

function isLikelyThreeDTask(combined) {
  // 先判断有没有任何 3D 苗头
  const hasAnyClue = /(3d|3D|三维|建模|glb|gltf|fbx|Blender|blender|布兰德|雕刻|拓扑|mesh|网格|材质球|参考图.{0,20}(建模|模型|3d)|图.{0,10}转.{0,10}(3d|模型)|文生图.{0,20}(建模|3d|模型))/i.test(combined)
  if (!hasAnyClue) return false
  // 有强 3D 上下文：直接放行
  if (STRONG_3D_CONTEXT.test(combined)) return true
  // 否则只剩"模型/工作台/blend"等弱词，必须排除非 3D 语义
  if (NON_3D_MODEL_CONTEXT.test(combined)) return false
  // 弱词 + 没有非 3D 语义但又出现开发上下文：判为非 3D
  if (DEV_CONTEXT_HINT.test(combined) && !/(雕刻|拓扑|建模|3d|三维|glb|gltf|fbx|blender)/i.test(combined)) return false
  return true
}

function routeUserTask(userMessage = '', options = {}) {
  const text = String(userMessage || '')
  const selectedPlanValue = String(options.selectedPlanValue || '')
  const combined = `${text}\n${selectedPlanValue}`
  const mentionedBlender = hasWorkbenchMention(combined, 'blender')
  const directBlender = /(Blender|blender|布兰德)/i.test(combined) && /(用|使用|直接|通过|打开|运行|脚本|Python|python|构建|创建|制作|做)/i.test(combined) && !NON_3D_MODEL_CONTEXT.test(combined)
  const threeDTask = isLikelyThreeDTask(combined)

  if (mentionedBlender && directBlender && threeDTask) {
    return {
      primaryRole: 'blenderDirectOperator',
      reason: 'blender-direct-request',
      chain: ['blenderDirectOperator']
    }
  }

  if (includesAny(combined, [
    /审查|review|检查代码|代码检查|扫描项目|安全审查|漏洞|越权|风险/i
  ])) {
    return {
      primaryRole: 'projectReviewer',
      reason: 'project-review-request',
      chain: [
        'projectReviewer'
      ]
    }
  }

  // 沉浸式路由: 必须有"做沉浸式"意图,且不能在诊断/讨论语境
  // 修复:用户在讨论"沉浸式弹窗有问题"时被错误路由到 immersiveWebDesigner
  const immersiveIntentPattern = /((做|用|选|采用|请用|套用|改用|换用|换成).{0,4}沉浸式|沉浸式.{0,8}(网页|页面|落地页|网站|工作流|方案|设计|方向)|沉浸式场景导演工作流|场景导演思维|沉浸式网页工作流|immersive_web_workflow|webgl|three\.?js|gsap|粒子|滚动驱动|视频纹理|音频交互|场景状态机)/i
  const discussingImmersivePattern = /(沉浸式|粒子|three\.?js|gsap|webgl|场景状态机|视频纹理|音频交互).{0,30}(弹窗|问题|异常|不对|错|误判|讨论|吐槽|为什么|原因|哪里|修一下|怎么改|怎么修|请教|不该|不应该)|(弹窗|问题|异常|不对|错|误判|讨论|吐槽|为什么|原因|哪里|修一下|怎么改|怎么修|请教|不该|不应该).{0,30}(沉浸式|粒子|three\.?js|gsap|webgl|场景状态机|视频纹理|音频交互)|(不要|别|不用|不|改回|换成|改成|改为|换成普通|不要沉浸式|别用沉浸式|不用沉浸式).{0,8}(沉浸式|粒子|three\.?js|gsap|webgl|场景状态机|视频纹理|音频交互)/i
  if (immersiveIntentPattern.test(combined) && !discussingImmersivePattern.test(combined)) {
    return {
      primaryRole: 'immersiveWebDesigner',
      reason: 'immersive-web-ui-request',
      chain: ['immersiveWebDesigner']
    }
  }

  if (includesAny(combined, [
    /(网页|网站|官网|落地页|landing|homepage|个人主页|个人介绍页|作品集|portfolio|profile|about page|前端页面).{0,40}(设计|开发|实现|创建|美化|页面|ui)/i,
    /(设计|开发|实现|创建|美化).{0,40}(网页|网站|官网|落地页|个人介绍页|作品集|portfolio|前端页面)/i
  ])) {
    return {
      primaryRole: 'webDesigner',
      reason: 'web-ui-request',
      chain: ['webDesigner']
    }
  }

  if (includesAny(combined, [
    /(界面|弹窗|按钮|侧栏|列表|工具栏|软件端|electron|桌面应用).{0,40}(设计|美化|优化|改版|布局|ui)/i
  ])) {
    return {
      primaryRole: 'uiDesigner',
      reason: 'app-ui-request',
      chain: ['uiDesigner']
    }
  }

  if (includesAny(combined, [
    /bug|报错|错误|异常|修复|不生效|没反应|失败|崩溃|语法错误/i
  ])) {
    return {
      primaryRole: 'coder',
      reason: 'bugfix-request',
      chain: ['coder']
    }
  }

  if (includesAny(combined, [
    /增加|新增|添加|实现|开发|做一个|创建|新建|接入|支持|重构|模块化|优化结构/i
  ])) {
    return {
      primaryRole: 'coder',
      reason: 'code-change-request',
      chain: ['coder']
    }
  }

  return {
    primaryRole: 'product',
    reason: 'general-or-analysis',
    chain: ['product']
  }
}

function buildRouteSummary(route) {
  const primary = getAgentRole(route?.primaryRole)
  const chain = (route?.chain || [])
    .map(roleId => getAgentRole(roleId)?.title || roleId)
    .join(' -> ')

  return {
    primaryRole: route?.primaryRole || '',
    primaryTitle: primary?.title || '',
    reason: route?.reason || '',
    chain
  }
}

function buildPrimaryRolePrompt(userMessage = '', options = {}) {
  const route = routeUserTask(userMessage, options)
  const role = getAgentRole(route.primaryRole)
  if (!role) return ''

  const summary = buildRouteSummary(route)
  const lines = [
    '===== 本轮 Agent 角色路由 =====',
    `主导身份：${summary.primaryTitle}`,
    `处理角色：${summary.chain}`,
    `路由原因：${summary.reason}`,
    '',
    '本轮只采用主导身份的职责重点，不加载其他角色的人设。',
    role.content
  ]

  return lines.join('\n')
}

module.exports = {
  routeUserTask,
  buildRouteSummary,
  buildPrimaryRolePrompt
}
