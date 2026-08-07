---
name: tpl-strategy-memorandum
title: 战略备忘录
description: "用「战略备忘录」模板新建文档。输出决策备忘录。 用户点名该模板或同类用途时使用。"
---

# 战略备忘录

基于参考模板新建产物。保持参考版式，只替换内容。

## 元数据

- id: `strategy-memorandum`
- kind: `document`
- reference: `templates/strategy-memorandum.docx`（见 `template.json`）

## 步骤

1. 读 `../../references/workflow.md`。
2. 解析插件根目录，复制 `templates/strategy-memorandum.docx` 到项目输出路径（默认 `assets/office/strategy-memorandum-<slug>.docx`）。
3. 使用 python-docx 打开副本并填充内容；不要打成纯文本。
4. 用用户提供的真实信息填充；缺信息用清晰占位，不编造。
5. 验收并返回文件路径。

## 保真

参考文件控制版式；用户指令控制内容与明确要求的结构变化。
