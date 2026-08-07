---
name: office-templates-index
title: 办公模板
description: 路由「用模板新建文档/演示/表格」请求。当用户提到信笺、备忘录、Kickoff、复盘、预算表、看板、三表预测或明确点名办公模板时使用。不要用于改企业云盘存量文件（那是办公文档库插件）。
---

# 办公模板 · 路由

## 何时使用

- 新建 Word / PPT / Excel 且希望有现成结构
- 用户说「用某某模板」「起一封信」「做启动会 PPT」「做预算表」

## 不要用

- 只改项目里已有 Office 文件 → 用 **办公文档库** 插件
- 纯代码工程任务

## 推荐执行路径（优先工具）

1. `office_from_template(action="list")` 查看可用模板  
2. `office_from_template(action="apply", template_id=..., title=..., placeholders?/replacements?)` 生成文件到 `assets/office/`  
3. 需要继续深加工：
   - 文档 → `office_workflow(kind="docx", ...)` 或 `artifact_workflow(domain="docx", ...)`
   - 演示 → `office_workflow(kind="ppt")` / `artifact_workflow(domain="ppt")`
   - 表格 → `office_workflow(kind="excel")` / `artifact_workflow(domain="excel")`

## 路由

读 `../../references/catalog.md` 选模板，再读对应 skill（见下表）并执行 `../../references/workflow.md`。

| 用户说法 | 模板 skill 目录 |
|----------|-----------------|
| 信笺 / 邀请函 / 正式信 | `tpl-minimal-letterhead` |
| 战略备忘录 / 决策建议 | `tpl-strategy-memorandum` |
| 系统设计 / 架构说明 | `tpl-system-design` |
| 设计报告 | `tpl-design-report` |
| 团队对齐 / 季度规划会 | `tpl-team-alignment` |
| 项目启动 / Kickoff | `tpl-project-kickoff` |
| 业务复盘 | `tpl-business-review` |
| 简约演示 / 通用 PPT | `tpl-simple-light` |
| 分析看板 / 指标表 | `tpl-analytics-dashboard` |
| 财务预算 | `tpl-financial-budget` |
| 项目跟踪表 | `tpl-project-tracker` |
| 三表预测 / 损益表 | `tpl-three-statement-forecast` |

若用户只说「做个 PPT/表格/文档」未点名模板：

1. 问一句用途（或根据上下文推断）
2. 推荐 1 个默认模板并说明
3. 直接开工，不要长篇菜单

默认推荐：

- 文档 → `minimal-letterhead` 或 `strategy-memorandum`
- 演示 → `team-alignment` 或 `simple-light`
- 表格 → `project-tracker` 或 `analytics-dashboard`
