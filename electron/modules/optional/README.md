# 可选能力模块（可随时删除）

本目录下的每个子文件夹都是**自包含可选能力**。

## 如何卸载某个能力

直接删除对应子目录即可，例如：

```text
electron/modules/optional/binary-analysis/
```

启动时 `loader.js` 会软加载：目录不存在或加载失败时**静默跳过**，不影响主程序。

## 约定

每个子模块的 `index.js` 导出：

| 字段 | 说明 |
|------|------|
| `id` | 能力 id（与 feature 开关 id 一致） |
| `feature` | feature-settings 目录项 |
| `toolsSchema` | 模型工具 schema 数组 |
| `handlers` | `{ toolName: async (args, ctx) => result }` |
| `display` | 可选：`{ toolName: { zh, en } }` |

## 注册点（勿在业务里硬编码 require 子模块）

- `optional/loader.js` → 唯一入口
- `feature-settings.js` 合并 feature
- `schemas/index.js` 合并 schema
- `tool-registry.js` 合并 handler
