---
name: office-library-shared-docs
title: 共享文档维护
description: 跨多个 Office/Markdown 文档同步状态、里程碑、路线图。维护共享规划材料时使用。
---

# 共享文档维护

## 流程

1. `discover` 收集相关源：跟踪表、规划 PPT、备忘录、README。
2. 抽出「事实源」优先级（用户指定 > 最新更新的跟踪表 > 会议纪要）。
3. 列出将同步的字段：状态、日期、Owner、风险。
4. 分别调用 word-docs / spreadsheets / powerpoint 做最小更新。
5. 输出变更清单：文件 → 改了什么。

## 原则

- 一处事实源，多处引用更新
- 冲突时标出差异，不静默覆盖
