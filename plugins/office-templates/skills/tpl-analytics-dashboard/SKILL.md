---
name: tpl-analytics-dashboard
title: 分析看板
description: "用「分析看板」模板新建表格。指标看板。 用户点名该模板或同类用途时使用。"
---

# 分析看板

基于参考模板新建产物。保持参考版式，只替换内容。

## 元数据

- id: `analytics-dashboard`
- kind: `spreadsheet`
- reference: `templates/analytics-dashboard.xlsx`（见 `template.json`）

## 步骤

1. 读 `../../references/workflow.md`。
2. 解析插件根目录，复制 `templates/analytics-dashboard.xlsx` 到项目输出路径（默认 `assets/office/analytics-dashboard-<slug>.xlsx`）。
3. 优先 office_workflow(kind="excel") / artifact_workflow(domain="excel")；或 openpyxl 在副本上改数据并保留公式。
4. 用用户提供的真实信息填充；缺信息用清晰占位，不编造。
5. 验收并返回文件路径。

## 保真

参考文件控制版式；用户指令控制内容与明确要求的结构变化。
