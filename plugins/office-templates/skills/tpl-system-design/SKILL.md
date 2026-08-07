---
name: tpl-system-design
title: 系统设计
description: "用「系统设计」模板新建文档。输出架构说明。 用户点名该模板或同类用途时使用。"
---

# 系统设计

基于参考模板新建产物。保持参考版式，只替换内容。

## 元数据

- id: `system-design`
- kind: `document`
- reference: `templates/system-design.docx`（见 `template.json`）

## 步骤

1. 读 `../../references/workflow.md`。
2. 解析插件根目录，复制 `templates/system-design.docx` 到项目输出路径（默认 `assets/office/system-design-<slug>.docx`）。
3. 使用 python-docx 打开副本并填充内容；不要打成纯文本。
4. 用用户提供的真实信息填充；缺信息用清晰占位，不编造。
5. 验收并返回文件路径。

## 保真

参考文件控制版式；用户指令控制内容与明确要求的结构变化。
