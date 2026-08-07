---
name: index
title: 对话示意
description: 用可交互示意帮助理解结构、流程、对比、模拟或可调参数。当图比长文更清楚时使用；用户不必点名「可视化」。静态关系图优先 Mermaid。
---

# 对话内嵌可视化

## 何时使用

- 解释结构关系、调用链、状态机、数据流
- 步骤模拟、可调参数、前后对比
- 小型探索器（筛选/点选看细节）

## 何时不用

- 纯静态结构用 **Mermaid** 或列表即可说清
- 用户要的是**项目内网页/落地页** → 用 `website-delivery` / 普通写文件，不是本 skill
- 用户只要出图海报 → `generate_image`

## 工作方式（静默）

1. **默默**调用 `create_inline_visual` 写入 HTML 片段（用户看不到工具卡）
2. **最终回复才是**用户可见内容：简短说明「这张图帮你看清什么」+ 在应出现图的位置单独一行写：

```text
::lingxi-inline-vis{id="<工具返回的id>"}
```

3. 漏写指令时系统可能自动补在文末；你仍应尽量插在正文自然位置  
4. **禁止**对用户说：工具名、技能名、HTML/iframe/沙箱、指令语法、「正在生成可视化」

过程中不要用长段进度汇报；除非被卡住需要用户决策。

## Mermaid vs 内嵌 HTML

| 情况 | 选择 |
|------|------|
| 节点+边的静态结构 | Mermaid 代码块 |
| 需要拖动、滑条、动画、点选联动 | `create_inline_visual` |
| 地图/大量数据点 | HTML + 白名单 CDN（见下） |

## HTML 片段契约

- **只要片段**：不要 `doctype` / `html` / `head` / `body`
- 根节点带唯一 `id`，用 `document.getElementById` 取根
- 体积 < 2MB；大数据先聚合/抽样
- 可用内联 style/script；外链仅：`cdnjs.cloudflare.com`、`esm.sh`、`cdn.jsdelivr.net`、`unpkg.com`、字体 CDN
- **禁止** `fetch` / XHR / WebSocket / 任意 API
- 片段内不要写长说明段落；说明放最终回复 Markdown
- **必须**用主题变量，禁止写死黑/白当主文字色或主背景（否则深色/浅色一切就糊）：
  - 文字/边框：`--foreground` `--muted-foreground` `--border` `--card` `--background`
  - 强调与系列：`--primary` `--primary-foreground` `--viz-series-1`…`-6`
  - 色块上的标签：`--on-series` 或 `--primary-foreground`（不要写死 `fill="white"` / `#000`）
- 控件用宿主提供的 class：`.card` `.btn` `.btn-primary` `.viz-row` `.viz-grid` `.viz-controls` `.viz-stat` `.text-muted` `.text-small`
- 首屏就要有用；交互只服务理解，不堆搜索/重置/多余 KPI
- 宿主会按应用主题注入配色；片段内不要再强制 `color-scheme` 或整页深色背景

## 构图原则

- 一个主视觉 + 少量必要控件；默认不要 KPI 卡片墙
- 宽而浅优先于又高又挤
- 颜色编码要配合标签/形状，不单靠颜色
- 步进模拟：只更新当前画面，不要并排堆所有步骤

## 调用示例（参数）

```json
{
  "title": "binary-search",
  "html": "<div id=\"root\" class=\"card\">...</div><script>...</script>"
}
```

成功后用返回的 `id` / `directive` 嵌入最终回复。

## 自检

- [ ] 用户回复里**没有**工具/实现细节
- [ ] 图本身能独立看懂主要结论
- [ ] 无未定义 JS、主交互有效
- [ ] 静态图没用 HTML 硬刚（该 Mermaid 就 Mermaid）
