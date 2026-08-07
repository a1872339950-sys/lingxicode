/**
 * 商城插件：程序化短视频 / 动效（Remotion 路径 + 与 generate_video 边界）
 */
const fs = require('fs')
const path = require('path')

function write(p, c) {
  fs.mkdirSync(path.dirname(p), { recursive: true })
  fs.writeFileSync(p, c, 'utf8')
  console.log('write', p)
}

const root = path.join('plugins', 'motion-video')

write(path.join(root, '.codex-plugin', 'plugin.json'), JSON.stringify({
  name: 'motion-video',
  version: '1.0.0',
  description: '程序化短视频与动效：用 React 时间线做片头、字幕、数据动画、配音合成；也可对接文生视频能力。',
  author: { name: 'Lingxi' },
  license: 'Apache-2.0',
  keywords: ['video', 'motion', 'remotion', 'caption', '短视频', '动效', '字幕'],
  skills: './skills/',
  interface: {
    displayName: '程序化短视频',
    shortDescription: '用代码做片头、字幕、图表动画与可导出视频',
    longDescription: '程序化视频能力包：规划分镜与时长、Remotion（React）脚手架与时间线、字幕、音频节奏、数据动效、导出检查。适合频道包装、产品演示、教学短片。一次性 AI 出片用系统「视频生成」；要可改可版本管理用本包。',
    developerName: '灵犀',
    category: 'Creativity',
    capabilities: ['Interactive', 'Read', 'Write'],
    defaultPrompt: [
      '用程序化方式做一个 15 秒产品介绍片头',
      '给这段口播加字幕和简单动态背景',
      '做一组柱状图增长的数据短视频'
    ],
    logo: './assets/logo.svg',
    brandColor: '#0EA5E9',
    screenshots: []
  }
}, null, 2))

write(path.join(root, 'package.json'), JSON.stringify({
  name: 'motion-video',
  version: '1.0.0',
  private: true,
  description: 'Lingxi motion / programmatic video plugin',
  license: 'Apache-2.0',
  scripts: {
    'scaffold:remotion': 'node scripts/scaffold-remotion.cjs'
  }
}, null, 2))

write(path.join(root, 'README.md'), `# 程序化短视频

用 **React 时间线（Remotion）** 做可改、可版本管理的短视频 / 动效；和一次性「文生视频」互补。

## 什么时候用本包

| 需求 | 用什么 |
|------|--------|
| 要精确卡点、可改字号/数据/时长 | **本包 Remotion** |
| 只要一段 AI 生成的成片、不要求可编辑工程 | 系统 **generate_video**（能力开关：媒体生成） |
| 裁剪/转码/抽帧 | ffmpeg / 项目内媒体工具 |

## 子 Skill

| Skill | 用途 |
|-------|------|
| index | 总入口：选型与流程 |
| remotion-core | 时间线、序列、动画基础 |
| captions | 字幕与可读性 |
| audio | 配乐、音量、节奏 |
| charts | 数据条/饼/折线动效 |
| export | 预览与导出检查 |

## 脚手架

\`\`\`bash
node plugins/motion-video/scripts/scaffold-remotion.cjs --dest ./my-video
cd my-video
npm install
npm run dev
\`\`\`

浏览器打开 Remotion Studio 预览。导出可用官方 CLI（见 skill export）。

## 安装

插件商城 → **程序化短视频** → 输入框选用该插件。
`)

write(path.join(root, 'assets', 'logo.svg'), `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none">
  <rect width="64" height="64" rx="14" fill="#0EA5E9"/>
  <rect x="12" y="18" width="40" height="28" rx="4" stroke="#fff" stroke-width="2.5"/>
  <path d="M28 26l12 6-12 6V26z" fill="#E0F2FE"/>
  <path d="M16 50h32" stroke="#BAE6FD" stroke-width="2" stroke-linecap="round"/>
</svg>
`)

// skills
write(path.join(root, 'skills', 'index', 'SKILL.md'), `---
name: index
title: 程序化短视频总入口
description: 程序化视频/动效路由：片头、字幕、数据动画、配音合成。可编辑工程用 Remotion；一次性成片用系统视频生成。
---

# 程序化短视频总入口

## 何时使用

- 片头/片尾、订阅引导、产品演示短片  
- 需要 **精确帧对齐** 的字幕、图表动画、节奏剪辑  
- 用户要「用代码做视频」「可改可维护」  

## 何时不用 / 改道

| 用户要 | 去做 |
|--------|------|
| 一句话生成不可控成片 | \`generate_video\`（媒体生成能力） |
| 对话里解释概念用交互图 | 对话示意 / Mermaid |
| 落地页 | 网页交付 |
| 游戏 | 游戏工作室 |

## 分流

1. **新建工程** → 脚手架（见下）+ \`remotion-core\`  
2. **字幕/口播** → \`captions\` + 常配合 \`audio\`  
3. **数据动效** → \`charts\`  
4. **配乐/音效/音量曲线** → \`audio\`  
5. **导出/抽检帧** → \`export\`  

## 标准流程

\`\`\`text
定片长与画幅 → 分镜文案 → 搭 Composition
  → 画面序列（Sequence）→ 字幕/音频
  → Studio 预览 → 单帧抽检 → 导出
\`\`\`

## 对用户说话

- 谈：时长、画幅、文案、字幕样式、导出位置  
- 少谈：内部 skill 名；不要假装已经渲染完却没跑预览  

## 脚手架

\`\`\`bash
node scripts/scaffold-remotion.cjs --dest <目录>
\`\`\`

## 硬规则

- 动画用时间线 API（帧驱动），不要用随意 setInterval 假同步  
- 文案与数据尽量 props 注入，方便改  
- 预览通过再谈「成片」  
- 大素材放 public/，注意体积  
`)

write(path.join(root, 'skills', 'remotion-core', 'SKILL.md'), `---
name: remotion-core
title: Remotion 时间线基础
description: Remotion 组合、序列、插值与组件动画。写程序化视频时使用。
---

# Remotion 时间线基础

## 核心概念

- **Composition**：一条片子（宽高、fps、时长帧数）  
- **Sequence**：时间轴上的片段（from / durationInFrames）  
- **useCurrentFrame / useVideoConfig**：当前帧与配置  
- **interpolate / spring**：数值动画  

## 推荐目录

\`\`\`text
src/
  Root.tsx           # 注册 Composition
  compositions/
    Main.tsx
  components/
  public/            # 静态资源
\`\`\`

## 动画原则

1. 一切跟 **frame** 走，保证可重现  
2. 进出场用插值；弹性用 spring，别过度弹  
3. 长片拆 Sequence，避免单组件巨无霸  
4. 字体与颜色抽成常量/props  
5. 30fps 时：1 秒 = 30 帧；\`frame=30\` 约 1s 处  

## 最小示例思路

- 背景层全片  
- 标题 Sequence 0–45  
- 副文案 Sequence 20–90  
- CTA Sequence 70–end  

## 检查

- [ ] fps / 宽高 / 总帧数合理  
- [ ] 无未定义字体闪烁  
- [ ] Studio 能预览到目标 Composition  

详见 \`references/remotion-basics.md\`。  
`)

write(path.join(root, 'skills', 'captions', 'SKILL.md'), `---
name: captions
title: 字幕与标题
description: 口播/视频字幕：分段、可读性、安全边距、进出动画。
---

# 字幕与标题

## 原则

1. **可读优先**：对比度、字号、行长  
2. **安全边距**：避开底部 UI / 平台水印区  
3. **一句一行或两行**，勿堆满屏  
4. 与音频对齐：有口播则按句时间轴切 Sequence  
5. 中文避免半句断词难看；标点别单独一行  

## 实现提示

- 字幕数据：\`{ text, startFrame, endFrame }[]\`  
- 当前帧落在区间内再渲染  
- 进出：透明度 + 轻微位移即可  

## 检查

- [ ] 1.5 秒内能读完当前行  
- [ ] 快速切换不闪瞎  
- [ ] 导出分辨率下仍清晰  

详见 \`references/captions.md\`。  
`)

write(path.join(root, 'skills', 'audio', 'SKILL.md'), `---
name: audio
title: 音频与节奏
description: 程序化视频中的配乐、音效、音量与节奏对齐。
---

# 音频与节奏

## 原则

1. 音乐服务画面，不盖过口播  
2. 音量用曲线（淡入淡出），避免咔哒  
3. 卡点：鼓点/重音对齐关键字幕或图表峰值帧  
4. 音效短而稀疏  

## 工程注意

- 资源放 \`public/\`，路径稳定  
- 先确认时长，再定 Composition 总帧  
- 需要裁剪/转码可用系统 ffmpeg（灵犀项目常内嵌 ffmpeg 安装器）  

## 检查

- [ ] 预览有声且不破音  
- [ ] 片头片尾淡出干净  
- [ ] 无音频时片长仍完整  

详见 \`references/audio.md\`。  
`)

write(path.join(root, 'skills', 'charts', 'SKILL.md'), `---
name: charts
title: 数据动效
description: 柱状/折线/饼图等数据可视化短视频动画。
---

# 数据动效

## 原则

1. **数据为 props**，方便改数重导  
2. 动画表达「变化」：生长、对比、高亮当前系列  
3. 坐标轴与标签在运动中仍可读  
4. 颜色系列固定，不每帧换色  

## 推荐模式

- 柱：高度从 0 插值到目标  
- 折线：路径长度或点逐个显现  
- 饼：角度扫出  
- 数字：整数插值到目标值  

## 检查

- [ ] 最终帧数值正确  
- [ ] 图例/单位齐全  
- [ ] 总时长匹配叙事（常见 8–20 秒）  

详见 \`references/charts.md\`。  
`)

write(path.join(root, 'skills', 'export', 'SKILL.md'), `---
name: export
title: 预览与导出
description: Remotion Studio 预览、单帧抽检与成片导出检查。
---

# 预览与导出

## 预览

\`\`\`bash
npm run dev
# 或 npx remotion studio
\`\`\`

在 Studio 中选中目标 Composition。

## 单帧抽检（可选）

布局/配色不确定时，渲染一帧快速看：

\`\`\`bash
npx remotion still <composition-id> --frame=30 --scale=0.5
\`\`\`

## 导出成片

按项目脚本或：

\`\`\`bash
npx remotion render <composition-id> out/video.mp4
\`\`\`

（以当前 Remotion 版本文档为准。）

## 交付前检查

- [ ] 正确 Composition / 时长  
- [ ] 字幕无溢出  
- [ ] 音频正常  
- [ ] 输出路径告知用户  
- [ ] 未把「Studio 预览」说成「已导出成片」  

详见 \`references/export.md\`。  
`)

// references
write(path.join(root, 'references', 'remotion-basics.md'), `# Remotion 基础备忘

- fps 常用 30；时长秒 × fps = durationInFrames  
- interpolate(frame, [in,out], [from,to], { extrapolateLeft, extrapolateRight })  
- Sequence 的 from 是绝对时间轴起点  
- 组件保持纯：同样 frame 渲染同样画面  
`)

write(path.join(root, 'references', 'captions.md'), `# 字幕备忘

- 底部约 10% 高度作字幕带  
- 深色半透明底 + 浅色字，或白字描边  
- 单行 ≤ 16 个汉字更稳  
`)

write(path.join(root, 'references', 'audio.md'), `# 音频备忘

- 口播优先，BGM 压低  
- 淡入 6–12 帧，淡出 12–24 帧（30fps 时）  
`)

write(path.join(root, 'references', 'charts.md'), `# 图表动效备忘

- 生长动画 20–45 帧  
- 高亮当前柱可再停 15 帧  
- 避免 3D 饼图堆特效  
`)

write(path.join(root, 'references', 'export.md'), `# 导出备忘

- 先 Studio 再 render  
- 分辨率与 Composition 一致  
- 大项目注意磁盘与内存  
`)

write(path.join(root, 'references', 'when-to-use-ai-video.md'), `# 程序化 vs 文生视频

| | 程序化（本包） | generate_video |
|--|----------------|----------------|
| 可控文案/数据 | 强 | 弱 |
| 版本 diff | 可以 | 难 |
| 一次性镜头感 | 一般 | 强 |
| 改一个数字重导 | 容易 | 常需重生 |

可组合：AI 生成 B-roll 片段 → 程序化时间线拼接字幕与图表。
`)

// scaffold script + minimal remotion-like template (simplified, not full remotion monorepo)
// Use a minimal custom timeline player for offline-friendly scaffold that teaches concepts,
// OR use remotion packages in package.json.

// Better: real remotion deps for authenticity
const tmpl = path.join(root, 'templates', 'remotion-starter')

write(path.join(tmpl, 'package.json'), JSON.stringify({
  name: 'lingxi-motion-video',
  private: true,
  version: '0.1.0',
  scripts: {
    dev: 'remotion studio',
    build: 'remotion bundle',
    upgrade: 'remotion upgrade'
  },
  dependencies: {
    '@remotion/cli': '4.0.227',
    '@remotion/player': '4.0.227',
    react: '18.3.1',
    'react-dom': '18.3.1',
    remotion: '4.0.227'
  },
  devDependencies: {
    '@types/react': '18.3.12',
    '@types/react-dom': '18.3.1',
    typescript: '5.6.3'
  }
}, null, 2))

write(path.join(tmpl, 'tsconfig.json'), JSON.stringify({
  compilerOptions: {
    target: 'ES2022',
    module: 'ES2022',
    moduleResolution: 'node',
    jsx: 'react-jsx',
    strict: true,
    skipLibCheck: true,
    esModuleInterop: true,
    noEmit: true
  },
  include: ['src']
}, null, 2))

write(path.join(tmpl, 'remotion.config.ts'), `import { Config } from '@remotion/cli/config'

Config.setVideoImageFormat('jpeg')
Config.setOverwriteOutput(true)
`)

write(path.join(tmpl, 'src', 'index.ts'), `import { registerRoot } from 'remotion'
import { RemotionRoot } from './Root'

registerRoot(RemotionRoot)
`)

write(path.join(tmpl, 'src', 'Root.tsx'), `import React from 'react'
import { Composition } from 'remotion'
import { Main } from './compositions/Main'

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="Main"
        component={Main}
        durationInFrames={150}
        fps={30}
        width={1280}
        height={720}
        defaultProps={{
          title: '灵犀 · 程序化短视频',
          subtitle: '15 秒示例片头'
        }}
      />
    </>
  )
}
`)

write(path.join(tmpl, 'src', 'compositions', 'Main.tsx'), `import React from 'react'
import {
  AbsoluteFill,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
  Sequence
} from 'remotion'

export type MainProps = {
  title: string
  subtitle: string
}

export const Main: React.FC<MainProps> = ({ title, subtitle }) => {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()

  const titleIn = spring({ frame, fps, config: { damping: 200 } })
  const titleY = interpolate(titleIn, [0, 1], [24, 0])
  const titleOp = interpolate(titleIn, [0, 1], [0, 1])

  return (
    <AbsoluteFill
      style={{
        background:
          'radial-gradient(circle at 20% 20%, #1e3a5f 0%, #0b0c10 55%, #000 100%)',
        color: 'white',
        fontFamily: 'system-ui, sans-serif'
      }}
    >
      <AbsoluteFill
        style={{
          justifyContent: 'center',
          alignItems: 'center',
          padding: 48
        }}
      >
        <div
          style={{
            transform: \`translateY(\${titleY}px)\`,
            opacity: titleOp,
            textAlign: 'center'
          }}
        >
          <div style={{ fontSize: 56, fontWeight: 700, letterSpacing: -0.5 }}>
            {title}
          </div>
          <Sequence from={18} layout="none">
            <div
              style={{
                marginTop: 16,
                fontSize: 28,
                opacity: 0.85,
                fontWeight: 500
              }}
            >
              {subtitle}
            </div>
          </Sequence>
        </div>
      </AbsoluteFill>

      <Sequence from={70}>
        <AbsoluteFill
          style={{
            justifyContent: 'flex-end',
            alignItems: 'center',
            paddingBottom: 64
          }}
        >
          <div
            style={{
              padding: '12px 28px',
              borderRadius: 999,
              background: '#0EA5E9',
              fontSize: 22,
              fontWeight: 600,
              opacity: interpolate(frame, [70, 90], [0, 1], {
                extrapolateLeft: 'clamp',
                extrapolateRight: 'clamp'
              })
            }}
          >
            开始创作
          </div>
        </AbsoluteFill>
      </Sequence>
    </AbsoluteFill>
  )
}
`)

// copy-dir based scaffold
write(path.join(root, 'scripts', 'copy-dir.cjs'), `const fs = require('fs')
const path = require('path')

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true })
  for (const name of fs.readdirSync(src)) {
    const from = path.join(src, name)
    const to = path.join(dest, name)
    if (fs.statSync(from).isDirectory()) copyDir(from, to)
    else fs.copyFileSync(from, to)
  }
}

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
  if (!fs.existsSync(dir)) return true
  if (!fs.statSync(dir).isDirectory()) return false
  return fs.readdirSync(dir).length === 0
}

function scaffold(templateName, destArg, { force, name, label }) {
  const templateRoot = path.join(__dirname, '..', 'templates', templateName)
  if (!destArg) {
    console.error('请指定 --dest <目录>')
    process.exit(1)
  }
  const dest = path.resolve(process.cwd(), String(destArg))
  if (dest === process.cwd()) {
    console.error('目标不能是当前仓库根目录')
    process.exit(1)
  }
  if (!fs.existsSync(templateRoot)) {
    console.error('找不到模板', templateRoot)
    process.exit(1)
  }
  if (fs.existsSync(dest) && !isEmptyDir(dest) && !force) {
    console.error('目标非空，加 --force 覆盖:', dest)
    process.exit(1)
  }
  if (fs.existsSync(dest) && force) fs.rmSync(dest, { recursive: true, force: true })
  copyDir(templateRoot, dest)
  const pkgPath = path.join(dest, 'package.json')
  if (fs.existsSync(pkgPath) && name) {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'))
    pkg.name = String(name)
    fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2))
  }
  console.log('已创建', label + ':', dest)
  console.log('下一步: cd', path.relative(process.cwd(), dest) || '.', '&& npm install && npm run dev')
}

module.exports = { scaffold, parseArgs }
`)

write(path.join(root, 'scripts', 'scaffold-remotion.cjs'), `#!/usr/bin/env node
const { scaffold, parseArgs } = require('./copy-dir.cjs')
const args = parseArgs(process.argv.slice(2))
scaffold('remotion-starter', args.dest || args.d, {
  force: !!args.force,
  name: args.name,
  label: '程序化短视频（Remotion）项目'
})
`)

// marketplace
const marketPath = path.join('plugins', 'marketplace.json')
const market = JSON.parse(fs.readFileSync(marketPath, 'utf8'))
if (!market.plugins.some((p) => p.name === 'motion-video')) {
  market.plugins.push({
    name: 'motion-video',
    source: { source: 'local', path: './motion-video' },
    policy: { installation: 'AVAILABLE', authentication: 'ON_USE' },
    category: 'Creativity'
  })
}
write(marketPath, JSON.stringify(market, null, 2) + '\n')

console.log('skills', fs.readdirSync(path.join(root, 'skills')).join(', '))
console.log('DONE')
