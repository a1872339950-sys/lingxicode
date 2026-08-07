# 第三方来源说明

本插件的角色动画工作流基于 OpenAI `hatch-pet` Skill 进行改造：

- 上游项目：https://github.com/openai/skills/tree/main/skills/.curated/hatch-pet
- 许可证：Apache License 2.0
- 上游用途：生成、检查、拼接和验证 Codex Pet 动画图集
- 本地修改：将说明、输出结构和使用场景调整为普通项目中的 2D 角色动画；保留可选的固定图集兼容流程

`skills/character-animation/scripts/` 下的图集处理、帧检查、预览和校验脚本来自上游 Hatch Pet。许可证全文见 `skills/character-animation/LICENSE.txt`。

OpenAI、Codex 及相关名称和商标属于其各自权利人。本说明不表示 OpenAI 对 LingXiCode 提供背书或支持。
