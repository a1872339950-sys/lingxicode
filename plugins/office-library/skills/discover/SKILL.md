---
name: office-library-discover
title: 文档发现
description: 在项目或用户指定目录中发现 Word/Excel/PPT，输出路径、修改时间、一句话摘要。用于定位文件，而不是直接大改。
---

# 文档发现

## 步骤

1. 读 `../../references/project-library.md` 确定搜索根。
2. 用 `glob_files` / `list_dir` 找 `*.docx` `*.xlsx` `*.pptx`（排除 node_modules 等）。
3. 用户要「最近」时，按 mtime 排序取前 N 个。
4. 对命中文件做轻量摘要：
   - docx：python-docx 读标题/前几段
   - xlsx：openpyxl 读 sheet 名与表头
   - pptx：python-pptx 读每页标题
5. 输出表格：`路径 | 类型 | 修改时间 | 摘要`。
6. 若多文件重名，请用户确认后再编辑。

## 输出

- 不要默认开始写文件
- 给出下一步建议 skill（word-docs / spreadsheets / powerpoint）
