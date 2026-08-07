# 第三方软件与资源说明

LingXiCode 使用的第三方依赖继续受各自许可证约束。完整版本和传递依赖以 `package-lock.json` 为准。

主要直接依赖包括：

| 组件 | 许可证 |
| --- | --- |
| Electron | MIT |
| electron-builder | MIT |
| Three.js | MIT |
| esbuild | MIT |
| sharp | Apache-2.0 |
| undici | MIT |
| ws | MIT |
| @resvg/resvg-js | MPL-2.0 |
| @vscode/ripgrep | MIT |
| @ffmpeg-installer/ffmpeg | LGPL-2.1 |

`frontend/assets/model-icons/lobe/` 中的模型图标来自 Lobe Icons 项目，使用 MIT 许可证；各模型名称和标志仍属于对应权利人。

## Skill 与插件来源

### Web Design

- 上游项目：[xiaopu-ai/web-design](https://github.com/xiaopu-ai/web-design)
- 原作者：KAOPU-XiaoPu
- 许可证：MIT
- 本仓库位置：`skills/web-design/`
- 说明：随附版本用于 LingXiCode 的 Web 视觉设计流程；上游版权与许可证原文保留在 `skills/web-design/LICENSE`。该上游项目自身对 vue-bits、react-bits 和 awesome-design-md 的致谢见 `skills/web-design/README.md`。

### Skills for Real Engineers

- 上游项目：[mattpocock/skills](https://github.com/mattpocock/skills)
- 原作者：Matt Pocock
- 许可证：MIT
- 本仓库位置：`skills/` 中的工程与生产力 Skills，以及 `plugins/engineering-workflow/` 中的整合版本。
- 说明：LingXiCode 对其中部分 Skills 进行了中文化、精简、重命名和工具接口适配。涉及的上游能力包括 `diagnose`、`grill-me`、`grill-with-docs`、`handoff`、`improve-codebase-architecture`、`prototype`、`setup-matt-pocock-skills`、`tdd`、`to-issues`、`to-prd`、`triage` 和 `zoom-out`。上游 MIT 许可证原文保存在 `skills/MATTPOCOCK_SKILLS_LICENSE.txt`。

### OpenAI Hatch Pet

- 上游项目：[openai/skills · hatch-pet](https://github.com/openai/skills/tree/main/skills/.curated/hatch-pet)
- 维护者：OpenAI
- 许可证：Apache-2.0
- 本仓库位置：`plugins/character-animation/skills/character-animation/`
- 说明：角色动画插件复用了 Hatch Pet 的图集处理、帧检查、预览和校验脚本，并将工作流改造成面向普通项目资源的角色动画流程。许可证原文保存在 `plugins/character-animation/skills/character-animation/LICENSE.txt`，修改与复用说明见 `plugins/character-animation/NOTICE.md`。

品牌名称、应用图标和第三方商标不会因 Apache-2.0 源码许可证自动获得商标授权。
