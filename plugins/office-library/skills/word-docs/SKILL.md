---
name: office-library-word-docs
title: Word 文档编辑
description: 编辑项目内 .docx，保留结构与样式。用户要更新已有 Word 而不是纯文本重写时使用。
---

# Word 文档编辑

## 流程

1. 确认精确路径（必要时先 `discover`）。
2. 用 python-docx 读取结构：标题层级、关键段落。
3. 说明将改哪些节。
4. 在**同一 .docx 包**上编辑（样式、标题、列表尽量复用现有 style）。
5. 重要文件可先备份 `*.bak-时间戳`。
6. 保存后重新打开核对目标段落。

## 禁止

- 把文档导出成纯文本再另存为 .docx 顶替（除非用户接受版式丢失）
- 无路径猜测乱改

## 工具

- `office_workflow(kind="docx", action="open"|"save"|"get_outline"|"replace_text"|...)`
- `artifact_workflow(domain="docx", script=...)` / `docx_run_script`
- 本地：`python-docx`
- 新建起稿：`office_from_template`（办公模板插件）
