---
name: office-library-spreadsheets
title: Excel 表格编辑
description: 编辑项目内 .xlsx，保留工作表结构、格式与公式。数据更新、加列加行、图表维护时使用；公式设计优先 formula-builder。
---

# Excel 表格编辑

## 流程

1. 定位精确路径。
2. 优先 `office_workflow(kind="excel")` 打开/读写；或 openpyxl 加载工作簿。
3. 先看 sheet 名、表头、used range、既有公式。
4. 在副本或原文件上做最小改动；避免覆盖整表无关区域。
5. 保存后抽查目标单元格与邻近公式是否仍在。

## 工具

- `office_workflow(kind="excel", action=..., args=...)`
- `artifact_workflow(domain="excel", ...)`
- openpyxl 脚本（复杂格式/多步）

## 禁止

- 摊平成 CSV 再盖回 xlsx
- 未确认路径就写系统盘随意位置

## 公式任务

若核心是公式设计/修复，转 `formula-builder`。
