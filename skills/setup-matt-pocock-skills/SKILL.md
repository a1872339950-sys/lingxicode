---
name: setup-matt-pocock-skills
title: 技能设置
description: 配置技能系统的基础设置，包括Issue跟踪器、分类标签、领域文档等。首次使用其他工程技能前运行。
disable-model-invocation: true
---

# 技能设置

为工程技能配置项目基础信息：
- **Issue跟踪器**：Issue在哪里管理（GitHub/GitLab/本地Markdown）
- **分类标签**：Issue状态标签词汇
- **领域文档**：CONTEXT.md和ADR文档位置

## 工作流程

1. **探索项目**：查看当前项目状态
   - git remote（判断是否GitHub/GitLab）
   - AGENTS.md/CLAUDE.md（是否已有配置）
   - CONTEXT.md、docs/adr/（领域文档）

2. **逐一确认**：一个一个问用户
   - Issue在哪里跟踪？
   - 分类标签用什么名称？
   - 领域文档是什么布局？

3. **写入配置**：生成配置文件
   - 更新AGENTS.md或CLAUDE.md
   - 创建docs/agents/目录下的配置文件