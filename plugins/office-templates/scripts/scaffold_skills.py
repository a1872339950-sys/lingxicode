#!/usr/bin/env python3
from pathlib import Path
import json

root = Path(__file__).resolve().parents[1] / "skills"
templates = [
    ("tpl-minimal-letterhead", "minimal-letterhead", "document", "minimal-letterhead.docx", "商务信笺", "写专业商务信件。"),
    ("tpl-strategy-memorandum", "strategy-memorandum", "document", "strategy-memorandum.docx", "战略备忘录", "输出决策备忘录。"),
    ("tpl-system-design", "system-design", "document", "system-design.docx", "系统设计", "输出架构说明。"),
    ("tpl-design-report", "design-report", "document", "design-report.docx", "设计报告", "输出设计方案报告。"),
    ("tpl-team-alignment", "team-alignment", "presentation", "team-alignment.pptx", "团队对齐", "对齐会演示。"),
    ("tpl-project-kickoff", "project-kickoff", "presentation", "project-kickoff.pptx", "项目启动", "Kickoff 演示。"),
    ("tpl-business-review", "business-review", "presentation", "business-review.pptx", "业务复盘", "复盘汇报演示。"),
    ("tpl-simple-light", "simple-light", "presentation", "simple-light.pptx", "简约演示", "通用轻演示。"),
    ("tpl-analytics-dashboard", "analytics-dashboard", "spreadsheet", "analytics-dashboard.xlsx", "分析看板", "指标看板。"),
    ("tpl-financial-budget", "financial-budget", "spreadsheet", "financial-budget.xlsx", "财务预算", "季度预算表。"),
    ("tpl-project-tracker", "project-tracker", "spreadsheet", "project-tracker.xlsx", "项目跟踪", "任务跟踪表。"),
    ("tpl-three-statement-forecast", "three-statement-forecast", "spreadsheet", "three-statement-forecast.xlsx", "三表预测", "三表财务预测。"),
]

kind_label = {"document": "文档", "presentation": "演示", "spreadsheet": "表格"}
kind_tool = {
    "document": "使用 python-docx 打开副本并填充内容；不要打成纯文本。",
    "presentation": "优先 artifact_workflow(domain=\"ppt\") 或 office_workflow(kind=\"ppt\")；也可 python-pptx 在副本上改占位文字。",
    "spreadsheet": "优先 office_workflow(kind=\"excel\") / artifact_workflow(domain=\"excel\")；或 openpyxl 在副本上改数据并保留公式。",
}

for dir_name, tid, kind, ref, title, desc in templates:
    d = root / dir_name
    d.mkdir(parents=True, exist_ok=True)
    ext = ref.split(".")[-1]
    (d / "template.json").write_text(
        json.dumps(
            {
                "schemaVersion": 1,
                "id": tid,
                "kind": kind,
                "title": title,
                "reference": f"../../templates/{ref}",
                "defaultOutput": f"assets/office/{tid}",
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )
    skill = f"""---
name: {dir_name}
title: {title}
description: "用「{title}」模板新建{kind_label[kind]}。{desc} 用户点名该模板或同类用途时使用。"
---

# {title}

基于参考模板新建产物。保持参考版式，只替换内容。

## 元数据

- id: `{tid}`
- kind: `{kind}`
- reference: `templates/{ref}`（见 `template.json`）

## 步骤

1. 读 `../../references/workflow.md`。
2. 解析插件根目录，复制 `templates/{ref}` 到项目输出路径（默认 `assets/office/{tid}-<slug>.{ext}`）。
3. {kind_tool[kind]}
4. 用用户提供的真实信息填充；缺信息用清晰占位，不编造。
5. 验收并返回文件路径。

## 保真

参考文件控制版式；用户指令控制内容与明确要求的结构变化。
"""
    (d / "SKILL.md").write_text(skill, encoding="utf-8")

print("skills", len(templates))
