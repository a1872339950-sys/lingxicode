/**
 * 将 plugins/game-studio 做成对标「浏览器游戏工作室」全貌的能力包
 * （结构对齐公开插件 skill 分工，文案自写，不照搬竞品原文）
 */
const fs = require('fs')
const path = require('path')

function write(p, c) {
  fs.mkdirSync(path.dirname(p), { recursive: true })
  fs.writeFileSync(p, c, 'utf8')
  console.log('write', p)
}

const root = path.join('plugins', 'game-studio')

// ---------- manifest ----------
write(path.join(root, '.codex-plugin', 'plugin.json'), JSON.stringify({
  name: 'game-studio',
  version: '1.0.0',
  description: '浏览器游戏工作室：从玩法规划、架构、2D/3D 实现、精灵与 3D 资产、游戏 UI 到试玩验收。',
  author: { name: 'Lingxi' },
  license: 'Apache-2.0',
  keywords: ['game', 'studio', 'phaser', 'three', '2d', '3d', 'sprite', '游戏工作室'],
  skills: './skills/',
  interface: {
    displayName: '游戏工作室',
    shortDescription: '规划、实现并试玩浏览器游戏（2D/3D）',
    longDescription: '完整浏览器游戏能力包：总入口分流、架构边界、Phaser 2D、Three.js 3D、React Three Fiber、精灵管线、3D 资产、游戏 UI、试玩验收。默认 2D 走 Phaser；3D 按技术栈给可执行路径。可与「角色动画」插件配合产出 2D 角色帧。',
    developerName: '灵犀',
    category: 'Developer Tools',
    capabilities: ['Interactive', 'Read', 'Write'],
    defaultPrompt: [
      '帮我规划一个浏览器游戏的核心循环和技术路线',
      '用 Phaser 搭一个可玩的 2D 最小关卡',
      '给现有网页小游戏做一轮试玩验收'
    ],
    logo: './assets/logo.svg',
    brandColor: '#F59E0B',
    screenshots: []
  }
}, null, 2))

write(path.join(root, 'package.json'), JSON.stringify({
  name: 'game-studio',
  version: '1.0.0',
  private: true,
  description: 'Lingxi Game Studio plugin: browser games 2D/3D workflows',
  license: 'Apache-2.0',
  scripts: {
    'scaffold:phaser': 'node scripts/scaffold-phaser.mjs'
  }
}, null, 2))

write(path.join(root, 'README.md'), `# 游戏工作室

浏览器游戏全流程能力包（对标「从规划到试玩」的工作室形态，不是只做一个 demo）。

## 覆盖范围

| Skill | 用途 |
|-------|------|
| index | 总入口：2D / 3D / 资产 / UI / 试玩分流 |
| foundations | 架构：模拟与渲染、输入、资源、存档 |
| phaser-2d | Phaser 2D 主实现路径 |
| three-webgl | 原生 Three.js 3D |
| react-three-fiber | React 内 3D（R3F） |
| sprite-pipeline | 2D 精灵帧与预览 |
| web-3d-assets | glTF/GLB 等 3D 资产 |
| game-ui | HUD / 菜单 / 不挡玩法 |
| playtest | 试玩与验收 |

## 使用

1. 插件商城安装 **游戏工作室**
2. 输入框选用该插件
3. 说清类型幻想与平台（网页）后，从总入口分流

## 脚手架

\`\`\`bash
node plugins/game-studio/scripts/scaffold-phaser.mjs --dest ./my-game
\`\`\`

## 与角色动画

2D 角色帧可配合 **角色动画** 插件产出到 \`assets/characters/\`，再接入 Phaser 的 asset manifest。
`)

write(path.join(root, 'assets', 'logo.svg'), `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none">
  <rect width="64" height="64" rx="14" fill="#F59E0B"/>
  <rect x="14" y="18" width="36" height="26" rx="4" stroke="#fff" stroke-width="2.5"/>
  <path d="M22 44h20" stroke="#FEF3C7" stroke-width="2.5" stroke-linecap="round"/>
  <circle cx="26" cy="30" r="3" fill="#FEF3C7"/>
  <circle cx="38" cy="30" r="3" fill="#FEF3C7"/>
  <path d="M32 12v4M18 16l3 3M46 16l-3 3" stroke="#fff" stroke-width="2" stroke-linecap="round"/>
</svg>
`)

// ---------- skills ----------
write(path.join(root, 'skills', 'index', 'SKILL.md'), `---
name: index
title: 游戏工作室总入口
description: 浏览器游戏总路由。规划玩法与技术栈、再分到架构/2D/3D/资产/UI/试玩。用户要做游戏、小关卡、玩法原型时使用。
---

# 游戏工作室总入口

你在使用 **游戏工作室** 能力包：覆盖从玩法规划到试玩验收的浏览器游戏工作，**不是**只做一个空壳原型页。

## 何时使用

- 做浏览器游戏 / 可玩关卡 / 玩法原型
- 需要选型（2D Phaser / Three / R3F）
- 精灵或 3D 资产、游戏 UI、试玩验收

## 何时不用

- 普通落地页 / 官网 → **网页交付**
- 只讲概念用图 → **对话示意**
- 用户明确要 Unity / 原生主机引擎且不要网页

## 分流规则（先分类再动手）

1. **还在选方向**（「帮我做个游戏」）  
   - 澄清：类型幻想、主操作、单机/联网、2D 还是 3D  
   - **默认 2D + Phaser**，除非用户明确 3D / React 3D  
   - 需要架构边界 → \`foundations\`  

2. **明确 2D 实现** → \`phaser-2d\`  
   - 角色帧生成/整理 → 同时可走 \`sprite-pipeline\`，并提示 **角色动画** 插件  

3. **明确原生 3D（TS/Vite、要控循环）** → \`three-webgl\`  
   - 模型优化/导出 → \`web-3d-assets\`  

4. **3D 嵌在 React 产品里** → \`react-three-fiber\`  

5. **HUD/菜单/不挡画面** → \`game-ui\`  

6. **给人玩 / 找问题 / 验收** → \`playtest\`  

## 标准工作流

\`\`\`text
玩法与循环 → foundations（边界）
    → 2D: phaser-2d (+ sprite-pipeline)
    → 3D: three-webgl | react-three-fiber (+ web-3d-assets)
    → game-ui（需要时并行）
    → playtest
\`\`\`

## 对用户说话

- 谈：玩法、手感、怎么打开试玩、已知限制  
- 少谈：内部 skill 名、黑话堆砌（对方是程序可适度技术化）  

## 硬规则

- 先 **最小可玩循环**，再堆内容与美术  
- 玩法状态 ≠ 渲染对象；禁止全塞进一个 update  
- 主会话自己读对应子 skill，不派子代理「代读流程」  
- 3D 未选定栈时不要同时开 Three 和 R3F 两套脚手架  
`)

write(path.join(root, 'skills', 'foundations', 'SKILL.md'), `---
name: foundations
title: 游戏架构基础
description: 写代码前定清模拟与渲染边界、输入、资源、存档与性能策略。浏览器游戏架构阶段使用。
---

# 游戏架构基础

## 原则

1. **模拟与渲染分离**  
   - 模拟：实体、回合、碰撞、进度、可存档状态  
   - 渲染：场景图、动画、相机、粒子  

2. **输入映射集中**  
   - 动作层：\`move\` \`jump\` \`confirm\` \`pause\`…  
   - 物理输入只在 bindings 映射到动作  

3. **资源清单**  
   - 稳定 key（\`player.idle\`），路径集中在 manifest  
   - 分组：characters / environment / ui / fx / audio / data  

4. **UI 默认 DOM**  
   - 画布：玩法空间  
   - DOM：菜单、设置、密集文字 HUD  

5. **存档只存模拟状态**  

6. **调试与性能**  
   - 调试层可开关；3D 注意后处理与资产体积  

## 开工前清单

- [ ] 玩家幻想与主动词  
- [ ] 核心循环与失败/重置  
- [ ] 相机模型  
- [ ] 输入动作表  
- [ ] 模块边界（systems / scenes / ui）  
- [ ] 资产目录与 key  
- [ ] 2D 帧格式或 3D 默认 glTF/GLB  

## 反模式

- 渲染回调里堆全部规则  
- 全局可变对象在场景间乱传  
- 文件名当公共 API  
- 每次改类型就推倒架构  

详见 \`references/engine-selection.md\`、\`references/architecture.md\`。  
`)

write(path.join(root, 'skills', 'phaser-2d', 'SKILL.md'), `---
name: phaser-2d
title: Phaser 2D
description: 用 Phaser 做 2D 浏览器游戏：薄场景、系统管玩法、DOM HUD。默认 2D 主路径。
---

# Phaser 2D

## 默认栈

Phaser 3 + TypeScript（或清晰 JS）+ Vite + DOM HUD

## 推荐目录

见 \`references/phaser-architecture.md\`。摘要：

- \`src/systems/\` 玩法规则  
- \`src/game/scenes/\` 薄场景  
- \`src/input/\` 动作映射  
- \`src/assets/manifest.ts\` 资源 key  
- \`src/ui/\` DOM  

## 实现要点

1. 场景读系统状态、回传输入动作；规则不活在单个 Sprite 闭包  
2. 相机逻辑与战斗/移动规则分离  
3. 动画状态由玩法状态推导  
4. 资源全程用 manifest key  

## 最小可玩（MVP）

- Boot / Preload / Play（+ 可选 Menu）  
- 完整：开始 → 主操作 → 反馈 → 失败或重置  
- \`npm run dev\` 可开  

## 脚手架

插件内：

\`\`\`bash
node scripts/scaffold-phaser.mjs --dest <项目路径>
\`\`\`

## 角色帧

需要走路/攻击等序列时：可走 \`sprite-pipeline\`，或安装 **角色动画** 插件产出后接入 manifest。  

## 反模式

- 全部逻辑塞一个 Scene.update  
- \`window.gameState\` 乱传  
- 长文 HUD 硬画在 canvas  
`)

write(path.join(root, 'skills', 'three-webgl', 'SKILL.md'), `---
name: three-webgl
title: Three.js 3D
description: 用原生 Three.js（TS/Vite）做浏览器 3D 游戏运行时：场景、加载、循环、基础调试。
---

# Three.js 3D

## 何时使用

- 用户要 **3D**，且要直接控制 scene / camera / renderer / 循环  
- 非 React 宿主，或明确不要 R3F  

## 栈

Three.js + TypeScript + Vite；模型默认 **glTF/GLB**（见 \`web-3d-assets\`）。

## 结构建议

\`\`\`text
src/
  game/
    simulation/     # 可序列化状态与规则
    loop.ts         # 固定步或 rAF 调度
  three/
    app.ts          # renderer/scene/camera
    loaders/
    view/
  input/
  ui/               # DOM
  main.ts
\`\`\`

## 要点

1. 模拟 tick 与渲染帧解耦（可固定步模拟）  
2. 加载与进度 UI 明确；失败可恢复  
3. 单位、原点、碰撞代理约定先定  
4. 性能：阴影/后处理克制；大场景要 LOD/合批意识  
5. 调试：卡死/黑屏先查相机、灯光、尺度、上下文丢失  

## 与 R3F

React 应用里的声明式 3D → 改用 \`react-three-fiber\`，不要两套并行脚手架。  

详见 \`references/threejs-notes.md\`。  
`)

write(path.join(root, 'skills', 'react-three-fiber', 'SKILL.md'), `---
name: react-three-fiber
title: React Three Fiber 3D
description: 在 React 应用内用 R3F 做 3D 场景与游戏循环协作。适合声明式场景与 React 状态共享。
---

# React Three Fiber 3D

## 何时使用

- 3D 活在 **React 产品**里  
- 需要声明式场景、与 React 状态/路由共用  

## 栈

React + Vite + \`@react-three/fiber\` + \`@react-three/drei\`（按需）；资产 glTF/GLB。

## 要点

1. **玩法状态**尽量在 React/独立 store，Scene 组件负责呈现与输入上报  
2. \`Canvas\` 与 DOM UI 分层；菜单打开时处理好指针锁定/相机控制  
3. 避免在每帧 React setState 灌大数据  
4. 资源用 useLoader / 预加载，注意卸载与悬空引用  
5. 与纯 Three 互转时保持「模拟在外、视图在内」  

## 不要

- 把整站 HUD 全塞进 WebGL  
- 无边界地每帧创建/销毁重型对象  

详见 \`references/r3f-notes.md\`。  
`)

write(path.join(root, 'skills', 'sprite-pipeline', 'SKILL.md'), `---
name: sprite-pipeline
title: 精灵管线
description: 2D 精灵帧生成、条带整理、尺寸锚点一致与预览。用于角色/特效序列帧接入游戏。
---

# 精灵管线

## 何时使用

- 需要 idle/walk/attack 等 **帧动画**  
- 统一锚点、帧尺寸、透明底  
- 出 contact sheet / 预览条  

## 推荐流程

1. 锁定角色身份（比例、配色、剪影）  
2. 按动作产出帧或横向 strip  
3. 抽帧到 \`frames/<action>/000.png…\`  
4. 检查：同动作尺寸一致、无脏边、锚点稳定  
5. 写入 manifest key，供 Phaser 等加载  
6. 需要完整角色工程时：优先配合 **角色动画** 插件（含悬浮预览）  

## 目录示例

\`\`\`text
assets/characters/<id>/
  frames/<action>/
  sheet/            # 可选
  previews/
  character.json    # 可选索引
\`\`\`

## 规则

- 一致性 > 单帧炫技  
- 默认透明底；避免棋盘格/复杂背景进帧  
- 不要未经要求就套固定桌宠图集规格  

详见 \`references/sprite-pipeline.md\`。  
`)

write(path.join(root, 'skills', 'web-3d-assets', 'SKILL.md'), `---
name: web-3d-assets
title: 3D 资产管线
description: 浏览器 3D 资产：glTF/GLB 导出、清理、压缩、LOD 与运行时校验。
---

# 3D 资产管线

## 默认格式

**glTF 2.0 / GLB** 作为运行时交付格式。

## 流程

1. DCC（如 Blender）清理：尺度、原点、应用变换、无用节点  
2. 导出 GLB；贴图尺寸与通道合理  
3. 需要时压缩（网格/纹理）；大场景考虑 LOD  
4. 碰撞用简化代理，不与渲染网格强绑  
5. 运行时加载校验：是否缺材质、动画名、尺寸是否离谱  

## 交付检查

- [ ] 单位与游戏世界一致  
- [ ] 首包体积可接受  
- [ ] 动画/蒙皮若需要则抽查  
- [ ] 失败加载有用户可读错误  

详见 \`references/web-3d-assets.md\`。  
`)

write(path.join(root, 'skills', 'game-ui', 'SKILL.md'), `---
name: game-ui
title: 游戏 UI
description: 浏览器游戏的 HUD、菜单、遮罩：保护玩法区可读性，默认 DOM 叠层。
---

# 游戏 UI

## 原则

1. **玩法区优先**：HUD 不挡关键操作与受击可读性  
2. **DOM 叠层默认**：菜单、设置、叙事文本  
3. **一种状态一种主控件**；少造永久工具条  
4. **暂停/菜单**时处理输入焦点与指针锁定  
5. 移动端考虑安全区与触控目标尺寸  

## 常见面

- HUD：血量、分数、弹药——短、贴边、可半透明  
- 菜单：开始 / 设置 / 暂停  
- 反馈：飘字、简短 toast，不盖全屏除非死亡结算  

## 反模式

- 仪表盘式信息墙压住场景  
- 把复杂表单画进 canvas  
- 动画过炫导致看不清角色  

详见 \`references/game-ui.md\`。  
`)

write(path.join(root, 'skills', 'playtest', 'SKILL.md'), `---
name: playtest
title: 试玩验收
description: 浏览器游戏试玩与问题记录。冒烟、手感、HUD、性能与复现步骤。
---

# 试玩验收

## 流程

1. 启动到第一可操作画面  
2. 走主操作与核心循环  
3. 胜负/重置/暂停  
4. HUD 与菜单是否挡玩法  
5. 必要时截图或录屏作证据  
6. 按严重度列问题  

## 2D 检查

- 精灵对齐与受击可读  
- 平台/障碍对比度  
- HUD 遮挡  
- 输入反馈  

## 3D 检查

- 首屏是否「像能玩」而不是后台仪表盘  
- 相机与重置  
- 菜单时指针/相机  
- 深度可读、材质灯光回归  
- 掉帧与加载卡顿  

## 报告格式

每条：现象 → 复现 → 为何重要 → 可能归属（玩法/渲染/UI/资产）  

完整清单见 \`references/playtest-checklist.md\`。  
`)

// ---------- references ----------
write(path.join(root, 'references', 'engine-selection.md'), `# 引擎选型

| 需求 | 建议 |
|------|------|
| 精灵、瓦片、2D 动作/俯视/横版/轻策略 | **Phaser（默认）** |
| 要直接控 3D 场景与循环 | **Three.js + Vite** |
| 3D 嵌在 React 产品 | **React Three Fiber** |
| 点名 Babylon 等 | 尊重选择，说明生态与成本 |

实现深度默认：**Phaser 2D 最深**；3D 给完整路径与文档。
`)

write(path.join(root, 'references', 'architecture.md'), `# 架构边界

## 推荐分层

- simulation：唯一玩法真源  
- content：关卡/数值数据  
- input：动作与键位  
- assets：manifest  
- renderer/scenes：薄适配  
- ui：DOM  

## 桥接

场景通过明确 API 读状态、派发意图；禁止场景直接改一堆隐式全局。
`)

write(path.join(root, 'references', 'phaser-architecture.md'), `# Phaser 目录建议

\`\`\`text
src/
  systems/           # 玩法
  game/
    main.ts          # Phaser.Game 配置
    scenes/
      BootScene.ts
      PreloadScene.ts
      MenuScene.ts
      PlayScene.ts
  input/
    actions.ts
    bindings.ts
  assets/
    manifest.ts
  ui/
    hud.ts
\`\`\`

场景职责：编排与呈现。系统职责：规则与状态。
`)

write(path.join(root, 'references', 'threejs-notes.md'), `# Three.js 要点

- 固定步模拟 + rAF 渲染更稳  
- GLB 加载用官方 GLTFLoader；路径与 CORS  
- 先确认尺度：1 unit 的含义  
- 黑屏三件套：相机位置、灯光、物体是否在视锥  
- 移动端注意像素比与阴影开销  
`)

write(path.join(root, 'references', 'r3f-notes.md'), `# R3F 要点

- Canvas 与 React 树边界清晰  
- 玩法 store 与 useFrame 内只读/写必要字段  
- drei 助手按需，避免无意义包装  
- 菜单打开时停游戏输入  
`)

write(path.join(root, 'references', 'sprite-pipeline.md'), `# 精灵管线备忘

- 同动作帧尺寸一致  
- 锚点（脚底中心等）全动作统一  
- 透明边缘干净  
- fps / loop 写进索引  
- 与角色动画插件输出目录对齐更省事  
`)

write(path.join(root, 'references', 'web-3d-assets.md'), `# 3D 资产备忘

- 交付 GLB  
- 应用变换、合理原点  
- 贴图功率尺寸；合并材质时谨慎  
- 碰撞网格简化  
- 运行时校验动画名与缺失贴图  
`)

write(path.join(root, 'references', 'game-ui.md'), `# 游戏 UI 备忘

- 安全边距  
- 主操作区不被常驻面板侵占  
- 暂停层级高于 HUD  
- 字体可读对比  
`)

write(path.join(root, 'references', 'playtest-checklist.md'), `# 试玩清单

## 冒烟

- [ ] dev 启动无阻断错误  
- [ ] 进入可玩状态  
- [ ] 主操作有效  
- [ ] 重置/再来一次  

## 体验

- [ ] 目标清晰  
- [ ] 失败可理解  
- [ ] HUD 不挡关键信息  

## 技术

- [ ] 失焦/回前台  
- [ ] 缩放窗口  
- [ ] 低端机可玩或写明限制  
`)

// ---------- scaffold phaser ----------
const starter = path.join(root, 'templates', 'phaser-starter')
const files = {
  'package.json': JSON.stringify({
    name: 'lingxi-phaser-game',
    private: true,
    version: '0.1.0',
    type: 'module',
    scripts: {
      dev: 'vite',
      build: 'vite build',
      preview: 'vite preview'
    },
    dependencies: {
      phaser: '^3.80.1'
    },
    devDependencies: {
      typescript: '^5.6.3',
      vite: '^5.4.10'
    }
  }, null, 2),
  'tsconfig.json': JSON.stringify({
    compilerOptions: {
      target: 'ES2022',
      module: 'ESNext',
      moduleResolution: 'Bundler',
      strict: true,
      skipLibCheck: true,
      noEmit: true,
      lib: ['ES2022', 'DOM']
    },
    include: ['src']
  }, null, 2),
  'vite.config.ts': `import { defineConfig } from 'vite'

export default defineConfig({
  server: { port: 5173, open: true },
  build: { target: 'es2022' }
})
`,
  'index.html': `<!DOCTYPE html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Lingxi Phaser Game</title>
    <style>
      html, body, #app { margin: 0; height: 100%; background: #0b0c10; color: #e5e7eb; font-family: system-ui, sans-serif; }
      #app { display: grid; place-items: center; }
      #hud {
        position: fixed; left: 12px; top: 12px; z-index: 10;
        background: rgba(0,0,0,.45); border: 1px solid rgba(255,255,255,.12);
        border-radius: 10px; padding: 8px 12px; font-size: 13px;
      }
      #game-parent canvas { display: block; border-radius: 8px; }
    </style>
  </head>
  <body>
    <div id="hud">方向键/AD 移动 · 空格跳 · R 重置</div>
    <div id="app"><div id="game-parent"></div></div>
    <script type="module" src="/src/main.ts"></script>
  </body>
</html>
`,
  'src/main.ts': `import Phaser from 'phaser'
import { PlayScene } from './game/scenes/PlayScene'
import { gameConfig } from './game/config'

const config: Phaser.Types.Core.GameConfig = {
  ...gameConfig,
  scene: [PlayScene],
  parent: 'game-parent'
}

// eslint-disable-next-line no-new
new Phaser.Game(config)
`,
  'src/game/config.ts': `import Phaser from 'phaser'

export const gameConfig: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  width: 800,
  height: 450,
  backgroundColor: '#1a1b26',
  physics: {
    default: 'arcade',
    arcade: { gravity: { x: 0, y: 900 }, debug: false }
  },
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH
  }
}
`,
  'src/systems/playerMotion.ts': `/** 纯玩法：根据输入与是否着地计算速度意图（示例级） */
export type MotionInput = { left: boolean; right: boolean; jump: boolean }
export type MotionState = { onGround: boolean; vx: number; vy: number }

export function stepMotion(state: MotionState, input: MotionInput, dt = 1): MotionState {
  const speed = 220
  let vx = 0
  if (input.left) vx -= speed
  if (input.right) vx += speed
  let vy = state.vy
  if (input.jump && state.onGround) vy = -420
  return { ...state, vx, vy }
}
`,
  'src/game/scenes/PlayScene.ts': `import Phaser from 'phaser'
import { stepMotion } from '../../systems/playerMotion'

/**
 * 薄场景：呈现 + 输入；规则片段放 systems/
 */
export class PlayScene extends Phaser.Scene {
  private player!: Phaser.Types.Physics.Arcade.SpriteWithDynamicBody
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys
  private keyA!: Phaser.Input.Keyboard.Key
  private keyD!: Phaser.Input.Keyboard.Key
  private keyR!: Phaser.Input.Keyboard.Key
  private platforms!: Phaser.Physics.Arcade.StaticGroup
  private spawn = { x: 120, y: 300 }

  constructor() {
    super('play')
  }

  create() {
    this.platforms = this.physics.add.staticGroup()
    const ground = this.add.rectangle(400, 420, 720, 40, 0x3b4252)
    this.physics.add.existing(ground, true)
    this.platforms.add(ground)

    const ledge = this.add.rectangle(520, 300, 180, 24, 0x4c566a)
    this.physics.add.existing(ledge, true)
    this.platforms.add(ledge)

    const body = this.add.rectangle(this.spawn.x, this.spawn.y, 28, 36, 0x88c0d0)
    this.physics.add.existing(body)
    this.player = body as unknown as Phaser.Types.Physics.Arcade.SpriteWithDynamicBody
    this.player.body.setCollideWorldBounds(true)
    this.physics.add.collider(this.player, this.platforms)

    if (!this.input.keyboard) throw new Error('keyboard missing')
    this.cursors = this.input.keyboard.createCursorKeys()
    this.keyA = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.A)
    this.keyD = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.D)
    this.keyR = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.R)

    this.add.text(16, 16, '最小可玩：走到平台 · 掉落可 R 重置', {
      fontSize: '14px',
      color: '#eceff4'
    }).setScrollFactor(0)
  }

  update() {
    if (Phaser.Input.Keyboard.JustDown(this.keyR)) {
      this.player.setPosition(this.spawn.x, this.spawn.y)
      this.player.setVelocity(0, 0)
      return
    }

    const onGround = this.player.body.blocked.down || this.player.body.touching.down
    const input = {
      left: !!(this.cursors.left?.isDown || this.keyA.isDown),
      right: !!(this.cursors.right?.isDown || this.keyD.isDown),
      jump: !!(this.cursors.up?.isDown || this.cursors.space?.isDown)
    }
    const next = stepMotion(
      { onGround, vx: this.player.body.velocity.x, vy: this.player.body.velocity.y },
      input
    )
    this.player.setVelocityX(next.vx)
    if (input.jump && onGround) this.player.setVelocityY(next.vy)

    if (this.player.y > 500) {
      this.player.setPosition(this.spawn.x, this.spawn.y)
      this.player.setVelocity(0, 0)
    }
  }
}
`
}

for (const [rel, content] of Object.entries(files)) {
  write(path.join(starter, rel), content)
}

write(path.join(root, 'scripts', 'scaffold-phaser.mjs'), `#!/usr/bin/env node
/**
 * 复制 Phaser 最小可玩模板到目标目录
 * 用法: node scripts/scaffold-phaser.mjs --dest ./my-game
 */
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  statSync,
  readFileSync,
  writeFileSync
} from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const templateRoot = path.resolve(__dirname, '../templates/phaser-starter')

function parseArgs(argv) {
  const out = {}
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (!a.startsWith('--')) continue
    const key = a.slice(2)
    const next = argv[i + 1]
    if (next && !next.startsWith('--')) {
      out[key] = next
      i++
    } else out[key] = true
  }
  return out
}

function isEmptyDir(dir) {
  if (!existsSync(dir)) return true
  if (!statSync(dir).isDirectory()) return false
  return readdirSync(dir).length === 0
}

const args = parseArgs(process.argv.slice(2))
const dest = path.resolve(process.cwd(), String(args.dest || args.d || ''))
if (!dest || dest === process.cwd()) {
  console.error('请指定 --dest <目录>，例如: --dest ./my-game')
  process.exit(1)
}
if (!existsSync(templateRoot)) {
  console.error('找不到模板:', templateRoot)
  process.exit(1)
}
if (existsSync(dest) && !isEmptyDir(dest) && !args.force) {
  console.error('目标非空，若确认覆盖请加 --force:', dest)
  process.exit(1)
}

mkdirSync(dest, { recursive: true })
cpSync(templateRoot, dest, { recursive: true, force: !!args.force })

const pkgPath = path.join(dest, 'package.json')
if (existsSync(pkgPath) && args.name) {
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
  pkg.name = String(args.name)
  writeFileSync(pkgPath, JSON.stringify(pkg, null, 2))
}

console.log('已创建 Phaser 最小可玩项目:', dest)
console.log('下一步: cd', path.relative(process.cwd(), dest) || '.', '&& npm install && npm run dev')
`)

// marketplace: add game-studio, remove web-game-lab if present
const marketPath = path.join('plugins', 'marketplace.json')
const market = JSON.parse(fs.readFileSync(marketPath, 'utf8'))
market.plugins = market.plugins.filter(p => p.name !== 'web-game-lab')
if (!market.plugins.some(p => p.name === 'game-studio')) {
  market.plugins.push({
    name: 'game-studio',
    source: { source: 'local', path: './game-studio' },
    policy: { installation: 'AVAILABLE', authentication: 'ON_USE' },
    category: 'Developer Tools'
  })
}
write(marketPath, JSON.stringify(market, null, 2) + '\n')

// remove old thin plugin to avoid confusion
const old = path.join('plugins', 'web-game-lab')
if (fs.existsSync(old)) {
  fs.rmSync(old, { recursive: true, force: true })
  console.log('removed', old)
}

console.log('game-studio skills:', fs.readdirSync(path.join(root, 'skills')).join(', '))
console.log('marketplace:', market.plugins.map(p => p.name).join(', '))
