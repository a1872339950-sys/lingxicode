---
name: tpl-financial-budget
title: 财务预算
description: "用「财务预算」模板新建表格。季度预算表。 用户点名该模板或同类用途时使用。"
---

# 财务预算

基于参考模板新建产物。保持参考版式，只替换内容。

## 元数据

- id: `financial-budget`
- kind: `spreadsheet`
- reference: `templates/financial-budget.xlsx`（见 `template.json`）

## 步骤

1. 读 `../../references/workflow.md`。
2. 解析插件根目录，复制 `templates/financial-budget.xlsx` 到项目输出路径（默认 `assets/office/financial-budget-<slug>.xlsx`）。
3. 优先 office_workflow(kind="excel") / artifact_workflow(domain="excel")；或 openpyxl 在副本上改数据并保留公式。
4. 用用户提供的真实信息填充；缺信息用清晰占位，不编造。
5. 验收并返回文件路径。

## 保真

参考文件控制版式；用户指令控制内容与明确要求的结构变化。
