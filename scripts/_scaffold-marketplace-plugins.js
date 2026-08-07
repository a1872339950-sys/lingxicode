const fs = require('fs')
const path = require('path')

function write(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, content, 'utf8')
  console.log('write', filePath)
}

function copySkill(src, dest, { name, title }) {
  let md = fs.readFileSync(src, 'utf8')
  md = md.replace(/^name:\s*.+$/m, `name: ${name}`)
  if (title) md = md.replace(/^title:\s*.+$/m, `title: ${title}`)
  write(dest, md)
}

// ---------- 对话示意 ----------
const p1 = path.join('plugins', 'conversation-visual')
write(path.join(p1, '.codex-plugin', 'plugin.json'), JSON.stringify({
  name: 'conversation-visual',
  version: '1.0.0',
  description: '对话内嵌可交互示意：流程图、关系图、步骤模拟、可调参数对比。',
  author: { name: 'Lingxi' },
  license: 'Apache-2.0',
  keywords: ['visual', 'diagram', '示意', '流程图'],
  skills: './skills/',
  interface: {
    displayName: '对话示意',
    shortDescription: '在对话里用可交互图把道理讲清楚',
    longDescription: '当结构、流程、对比或模拟用图比长文更清楚时，在对话中静默生成可交互示意（支持折叠）。静态结构优先 Mermaid。安装后选用「对话示意」。需设置中开启「对话内可视化」。',
    developerName: '灵犀',
    category: 'Productivity',
    capabilities: ['Interactive', 'Read', 'Write'],
    defaultPrompt: [
      '用可交互步骤图解释二分查找怎么工作',
      '画一张模块调用关系示意',
      '对比两种方案的状态流转'
    ],
    logo: './assets/logo.svg',
    brandColor: '#8B5CF6',
    screenshots: []
  }
}, null, 2))

write(path.join(p1, 'package.json'), JSON.stringify({
  name: 'conversation-visual',
  version: '1.0.0',
  private: true,
  description: 'Lingxi conversation inline visual plugin',
  license: 'Apache-2.0'
}, null, 2))

write(path.join(p1, 'README.md'), `# 对话示意

在对话里用可交互图解释结构、流程、模拟。

## 使用

1. 插件商城安装「对话示意」
2. 输入框选用该插件
3. 设置 → 能力开关 → 「对话内可视化」保持开启

## 注意

- 对用户不显示工具卡
- 整站/落地页请用「网页交付」
`)

write(path.join(p1, 'assets', 'logo.svg'), `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none">
  <rect width="64" height="64" rx="14" fill="#8B5CF6"/>
  <circle cx="20" cy="32" r="6" fill="#fff" opacity=".95"/>
  <circle cx="44" cy="20" r="5" fill="#E9D5FF"/>
  <circle cx="44" cy="44" r="5" fill="#E9D5FF"/>
  <path d="M25 30l14-8M25 34l14 8" stroke="#fff" stroke-width="2.5" stroke-linecap="round"/>
</svg>
`)

copySkill(
  path.join('skills', 'inline-visual', 'SKILL.md'),
  path.join(p1, 'skills', 'index', 'SKILL.md'),
  { name: 'index', title: '对话示意' }
)

// ---------- 网页交付 ----------
const p2 = path.join('plugins', 'website-delivery')
write(path.join(p2, '.codex-plugin', 'plugin.json'), JSON.stringify({
  name: 'website-delivery',
  version: '1.0.0',
  description: '落地页/简单站点：骨架预览、设计三选一、实现与收尾。',
  author: { name: 'Lingxi' },
  license: 'Apache-2.0',
  keywords: ['website', 'landing', '站点', '落地页'],
  skills: './skills/',
  interface: {
    displayName: '网页交付',
    shortDescription: '先预览骨架，再选设计方向，最后定稿站点',
    longDescription: '面向落地页、官网首页、简单站点：脚手架与加载骨架，2～3 个设计方向弹窗选择，实现后预览并收尾。安装后选用「网页交付」。需设置中开启「网页交付」能力。',
    developerName: '灵犀',
    category: 'Productivity',
    capabilities: ['Interactive', 'Read', 'Write'],
    defaultPrompt: [
      '帮我做一个公司落地页，先出三种视觉方向',
      '从零搭一个产品官网首页并预览',
      '把当前站点骨架换成正式首页再收尾'
    ],
    logo: './assets/logo.svg',
    brandColor: '#10B981',
    screenshots: []
  }
}, null, 2))

write(path.join(p2, 'package.json'), JSON.stringify({
  name: 'website-delivery',
  version: '1.0.0',
  private: true,
  description: 'Lingxi website delivery plugin',
  license: 'Apache-2.0'
}, null, 2))

write(path.join(p2, 'README.md'), `# 网页交付

落地页/简单站点：骨架 → 设计三选一 → 实现 → 预览 → 收尾。

## 使用

1. 插件商城安装「网页交付」
2. 输入框选用该插件
3. 设置 → 能力开关 → 「网页交付」保持开启
`)

write(path.join(p2, 'assets', 'logo.svg'), `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none">
  <rect width="64" height="64" rx="14" fill="#10B981"/>
  <rect x="14" y="18" width="36" height="28" rx="4" stroke="#fff" stroke-width="2.5"/>
  <path d="M14 28h36" stroke="#fff" stroke-width="2" opacity=".8"/>
  <circle cx="20" cy="23" r="1.8" fill="#D1FAE5"/>
  <circle cx="26" cy="23" r="1.8" fill="#D1FAE5"/>
</svg>
`)

copySkill(
  path.join('skills', 'website-delivery', 'SKILL.md'),
  path.join(p2, 'skills', 'index', 'SKILL.md'),
  { name: 'index', title: '网页交付' }
)

// ---------- 网页小游戏原型 ----------
const p3 = path.join('plugins', 'web-game-lab')
write(path.join(p3, '.codex-plugin', 'plugin.json'), JSON.stringify({
  name: 'web-game-lab',
  version: '1.0.0',
  description: '浏览器小游戏原型：默认 2D Phaser 路径，含架构、实现与试玩检查。',
  author: { name: 'Lingxi' },
  license: 'Apache-2.0',
  keywords: ['game', 'phaser', '2d', '小游戏', '原型'],
  skills: './skills/',
  interface: {
    displayName: '网页小游戏原型',
    shortDescription: '从想法到可试玩的 2D 网页小游戏',
    longDescription: '浏览器小游戏能力包：入口先判断 2D/3D 方向，v1 默认走 Phaser + 清晰架构（模拟与渲染分离、DOM HUD）。含基础架构、Phaser 实现要点与试玩检查清单。可与「角色动画」插件配合产出角色帧。',
    developerName: '灵犀',
    category: 'Developer Tools',
    capabilities: ['Interactive', 'Read', 'Write'],
    defaultPrompt: [
      '帮我设计一个可在浏览器玩的 2D 小游戏并搭原型',
      '用 Phaser 做一个可左右移动跳跃的最小可玩关卡',
      '给我一份小游戏核心循环和试玩检查清单'
    ],
    logo: './assets/logo.svg',
    brandColor: '#F59E0B',
    screenshots: []
  }
}, null, 2))

write(path.join(p3, 'package.json'), JSON.stringify({
  name: 'web-game-lab',
  version: '1.0.0',
  private: true,
  description: 'Lingxi web game lab plugin (Phaser-first)',
  license: 'Apache-2.0'
}, null, 2))

write(path.join(p3, 'README.md'), `# 网页小游戏原型

浏览器小游戏：默认 2D（Phaser），先定架构再实现，最后做试玩检查。

## 子流程

| Skill | 用途 |
|-------|------|
| index | 总入口，选 2D/3D 路线 |
| foundations | 架构边界：模拟/渲染/输入/资源 |
| phaser-2d | Phaser 2D 实现要点 |
| playtest | 试玩与验收清单 |

## 使用

1. 插件商城安装「网页小游戏原型」
2. 输入框选用该插件
3. 角色帧资产可配合「角色动画」插件
`)

write(path.join(p3, 'assets', 'logo.svg'), `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none">
  <rect width="64" height="64" rx="14" fill="#F59E0B"/>
  <rect x="16" y="20" width="32" height="22" rx="3" stroke="#fff" stroke-width="2.5"/>
  <circle cx="26" cy="31" r="3" fill="#FEF3C7"/>
  <circle cx="38" cy="31" r="3" fill="#FEF3C7"/>
  <path d="M24 42h16" stroke="#fff" stroke-width="2" stroke-linecap="round"/>
  <path d="M32 14v4M20 16l3 3M44 16l-3 3" stroke="#FEF3C7" stroke-width="2" stroke-linecap="round"/>
</svg>
`)

write(path.join(p3, 'skills', 'index', 'SKILL.md'), `---
name: index
title: 网页小游戏总入口
description: 浏览器小游戏路由：先判断 2D/3D 与核心循环，再进入架构或 Phaser 实现。默认 2D。
---

# 网页小游戏总入口

## 何时使用

- 用户要做可在浏览器玩的小游戏 / 原型
- 需要选技术栈、定核心循环、搭最小可玩版本
- 和角色帧、关卡、试玩检查相关

## 何时不用

- 纯落地页/官网 → 用「网页交付」
- 只要概念图解释 → 用「对话示意」
- 重度原生引擎（Unity 等）且用户明确不要网页方案

## 路由

1. **还没定方向**（「帮我做个游戏」）  
   - 先澄清：类型幻想、主要操作（移动/射击/合成…）、单机还是联网  
   - 默认建议 **2D + Phaser**，除非用户明确要 3D / Three / React Three Fiber  

2. **定架构 / 目录 / 输入与资源** → 读并遵循 \`foundations\`  

3. **明确 2D 实现** → 读并遵循 \`phaser-2d\`  

4. **要 3D**  
   - 说明 v1 插件以 2D 为主  
   - 给出精简建议：纯 TS/Vite 用 Three.js；React 应用用 R3F；资源默认 glTF/GLB  
   - 仍用 foundations 的边界原则（模拟与渲染分离）  

5. **准备给人试玩 / 收口** → \`playtest\`  

## 硬规则

- 先核心循环与最小可玩，再美术堆料  
- 玩法状态不要全塞在渲染回调里  
- 菜单/HUD 默认 DOM，画布负责场景与动作可读性  
- 对用户谈玩法与试玩，少堆引擎黑话（除非对方是开发者）  
- 需要角色帧序列时可提示配合「角色动画」插件  

## 交付最小集

- 能打开的本地预览方式（如 Vite dev）  
- 一套完整「开始 → 操作 → 胜负/重置」  
- 已知限制与下一步  
`)

write(path.join(p3, 'skills', 'foundations', 'SKILL.md'), `---
name: foundations
title: 小游戏架构基础
description: 写代码前定清模拟与渲染边界、输入、资源与存档。用于浏览器小游戏架构。
---

# 小游戏架构基础

## 原则

1. **模拟与渲染分离**  
   - 模拟：实体、回合、碰撞、进度、可存档状态  
   - 渲染：精灵/场景、相机、粒子、动画播放  

2. **输入映射集中**  
   - 先定义动作：\`move\` \`jump\` \`confirm\` \`pause\` 等  
   - 物理键鼠映射到动作，只在一处配置  

3. **资源有清单**  
   - 用稳定 key（如 \`player.idle\`），不要满项目硬编码路径  
   - 分组：characters / environment / ui / fx / audio / data  

4. **HUD 默认 DOM**  
   - 画布：场景与动作  
   - DOM：文字多的菜单、设置、无障碍相关控件  

5. **存档只存模拟状态**，不存渲染对象  

## 开工前检查清单

- [ ] 玩家幻想与主要动词  
- [ ] 核心循环与失败/重置  
- [ ] 相机模型（跟随/锁定/房间）  
- [ ] 输入动作表  
- [ ] 模拟模块 vs 渲染模块边界  
- [ ] 资源目录与 manifest  
- [ ] 调试/性能开关怎么关  

## 反模式

- 在 \`update\` 里堆全部规则且无法单测  
- 用可变全局在场景间乱传状态  
- 图集路径散落各处  
- 为方便把密集文字 UI 全画进 canvas  
`)

write(path.join(p3, 'skills', 'phaser-2d', 'SKILL.md'), `---
name: phaser-2d
title: Phaser 2D 实现
description: 用 Phaser 做 2D 浏览器小游戏：场景薄、系统管玩法、DOM 做 HUD。
---

# Phaser 2D 实现

## 默认栈

- Phaser 3  
- TypeScript（也可用 JS，保持结构清晰）  
- Vite  
- DOM 覆盖层做菜单/HUD  

## 结构建议

\`\`\`text
src/
  game/           # Phaser 启动与场景
    scenes/       # Boot / Preload / Menu / Play
  systems/        # 玩法规则（移动、碰撞判定、分数…）
  input/          # 动作映射
  assets/         # 资源与 manifest
  ui/             # DOM HUD
  main.ts
\`\`\`

## 实现要点

1. **场景要薄**：场景负责加载、把系统状态画出来、把输入送回系统  
2. **系统拥有规则**：分数、生命、胜负不要只活在某个 Sprite 闭包里  
3. **资源用 manifest key** 引用  
4. **动画状态由玩法状态推导**，避免一堆互斥 flag 失控  
5. **相机**：尽早定跟随/锁定；特效克制，不挡可读性  

## 最小可玩（MVP）

- Preload 必要资源  
- Play 场景：角色可按设计操作  
- 至少一种失败或重置路径  
- 简单分数或目标提示（DOM 即可）  

## 与脚手架

新项目可用 Vite 模板初始化后装 \`phaser\`。保持 package 脚本清晰：\`dev\` / \`build\`。  
不要为了演示安装一堆无关 UI 库。  

## 反模式

- 全部逻辑写在单个 Scene 的 update  
- 场景间靠 \`window.xxx\` 传状态  
- HUD 长文硬画在 canvas  
`)

write(path.join(p3, 'skills', 'playtest', 'SKILL.md'), `---
name: playtest
title: 试玩检查
description: 小游戏交付前的试玩与验收清单。用于可玩原型收口。
---

# 试玩检查

## 何时使用

- 准备给用户「能玩了」  
- 每次大改核心循环之后  

## 清单

1. **启动**：\`dev\` 能开，控制台无阻断报错  
2. **核心循环**：开始 → 操作 → 反馈 → 胜负/重置，完整走通  
3. **输入**：键位与提示一致；失焦/恢复不卡死  
4. **失败路径**：撞到边界、死亡、重来是否正常  
5. **可读性**：角色与障碍对比够；震动/闪白不过度  
6. **性能**：目标机型上不明显掉帧（MVP 可写已知限制）  
7. **资源**：缺图/缺音是否有兜底  

## 输出给用户

- 怎么打开试玩  
- 操作说明（3～6 条）  
- 已验证 / 未验证  
- 下一步可增强点（最多 3 条，别列愿望单）  
`)

write(path.join(p3, 'references', 'engine-selection.md'), `# 引擎怎么选（简表）

| 需求 | 建议 |
|------|------|
| 精灵、瓦片、2D 动作/俯视/横版 | **Phaser（默认）** |
| 明确 3D、要直接控场景循环 | Three.js + Vite |
| 3D 嵌在 React 产品里 | React Three Fiber |
| 用户点名 Babylon / 其他 | 尊重选择，说明维护成本 |

v1 插件实现深度：**Phaser 2D**。3D 给方向与边界，不强制脚手架。
`)

// ---------- marketplace ----------
const marketPath = path.join('plugins', 'marketplace.json')
const market = JSON.parse(fs.readFileSync(marketPath, 'utf8'))
const add = [
  {
    name: 'conversation-visual',
    source: { source: 'local', path: './conversation-visual' },
    policy: { installation: 'AVAILABLE', authentication: 'ON_USE' },
    category: 'Productivity'
  },
  {
    name: 'website-delivery',
    source: { source: 'local', path: './website-delivery' },
    policy: { installation: 'AVAILABLE', authentication: 'ON_USE' },
    category: 'Productivity'
  },
  {
    name: 'web-game-lab',
    source: { source: 'local', path: './web-game-lab' },
    policy: { installation: 'AVAILABLE', authentication: 'ON_USE' },
    category: 'Developer Tools'
  }
]
const existing = new Set(market.plugins.map(p => p.name))
for (const item of add) {
  if (!existing.has(item.name)) market.plugins.push(item)
}
write(marketPath, JSON.stringify(market, null, 2) + '\n')

console.log('DONE plugins:', market.plugins.map(p => p.name).join(', '))
