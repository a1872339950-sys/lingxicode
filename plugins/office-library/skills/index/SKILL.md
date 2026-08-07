---
name: office-library-index
title: 办公文档库
description: 路由项目/本地 Office 存量文件的发现、摘要与安全编辑。用户要改已有 Word/Excel/PPT、汇总文档库、维护共享规划文档时使用。新建模板起稿请用办公模板插件。
---

# 办公文档库 · 路由

## 何时使用

- 项目里已有 `.docx` / `.xlsx` / `.pptx` 要读或改
- 「docs 里有哪些材料」「更新跟踪表」「在原 PPT 加一页」
- 公式修复、跨文档同步状态

## 不要用

- 从零用模板新建 → **办公模板**
- 纯代码仓库重构

## 路由表

| 请求 | Skill |
|------|-------|
| 找文件 / 列目录 / 最近文档 | `discover` |
| Word 改写 / 保样式 | `word-docs` |
| Excel 数据与结构 | `spreadsheets` |
| Excel 公式本身 | `formula-builder` |
| PPT 改页 / 保风格 | `powerpoint` |
| 多文档对齐路线图/状态 | `shared-docs` |

先读 `../../references/project-library.md`。路径不明时先 `discover`。

## 总原则

1. 先定位精确文件路径  
2. 先摘要再写  
3. 整文件安全回写  
4. 内容校验 + 版式风险说明  
