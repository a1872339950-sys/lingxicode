---
name: office-library-powerpoint
title: PPT 编辑
description: 编辑项目内 .pptx，优先克隆现有页保风格。加页、改文案、统一版式时使用。
---

# PPT 编辑

## 流程

1. 定位精确 `.pptx`。
2. 检查页数、标题列表、是否有统一版式。
3. 改动策略优先级：
   1. 克隆相近页再改字
   2. `artifact_workflow(domain="ppt")` / `office_workflow(kind="ppt")` 脚本
   3. python-pptx 最小改动
4. 避免从空白页硬堆与母版无关的样式。
5. 保存后核对目标页标题与邻近页视觉是否协调。

## 验收

- 内容正确 ≠ 风格完成
- 无法做截图级视觉 QA 时，明确说明仅内容级验收
