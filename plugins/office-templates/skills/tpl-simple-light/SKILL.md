---
name: tpl-simple-light
title: 简约演示
description: "用「简约演示」模板新建演示。通用轻演示。 用户点名该模板或同类用途时使用。"
---

# 简约演示

基于参考模板新建产物。保持参考版式，只替换内容。

## 元数据

- id: `simple-light`
- kind: `presentation`
- reference: `templates/simple-light.pptx`（见 `template.json`）

## 步骤

1. 读 `../../references/workflow.md`。
2. 解析插件根目录，复制 `templates/simple-light.pptx` 到项目输出路径（默认 `assets/office/simple-light-<slug>.pptx`）。
3. 优先 artifact_workflow(domain="ppt") 或 office_workflow(kind="ppt")；也可 python-pptx 在副本上改占位文字。
4. 用用户提供的真实信息填充；缺信息用清晰占位，不编造。
5. 验收并返回文件路径。

## 保真

参考文件控制版式；用户指令控制内容与明确要求的结构变化。
