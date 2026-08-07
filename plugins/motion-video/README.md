# 程序化短视频

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

```bash
node plugins/motion-video/scripts/scaffold-remotion.cjs --dest ./my-video
cd my-video
npm install
npm run dev
```

浏览器打开 Remotion Studio 预览。导出可用官方 CLI（见 skill export）。

## 安装

插件商城 → **程序化短视频** → 输入框选用该插件。
