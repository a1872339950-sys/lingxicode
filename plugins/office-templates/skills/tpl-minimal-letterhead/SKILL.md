---
name: tpl-minimal-letterhead
title: 商务信笺
description: "用「商务信笺」模板新建文档。写专业商务信件。 用户点名该模板或同类用途时使用。"
---

# 商务信笺

基于参考模板新建产物。保持参考版式，只替换内容。

## 元数据

- id: `minimal-letterhead`
- kind: `document`
- reference: `templates/minimal-letterhead.docx`（见 `template.json`）

## 步骤

1. 读 `../../references/workflow.md`。
2. 解析插件根目录，复制 `templates/minimal-letterhead.docx` 到项目输出路径（默认 `assets/office/minimal-letterhead-<slug>.docx`）。
3. 使用 python-docx 打开副本并填充内容；不要打成纯文本。
4. 用用户提供的真实信息填充；缺信息用清晰占位，不编造。
5. 验收并返回文件路径。

## 保真

参考文件控制版式；用户指令控制内容与明确要求的结构变化。
