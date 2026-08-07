---
name: index
title: 网页交付
description: 落地页/官网/简单站点：先骨架预览，再设计方向三选一，实现后预览与收尾。用户要可访问的页面而不是纯设计讨论时使用。
---

# 网页交付

## 何时使用

- 新建落地页、官网、简单站点、门户首页
- 用户希望「先看到样子再定稿」
- 空项目或明确要交付静态站点

## 何时不用

- 已有大型工程里改局部组件 → 直接改代码 + `runtime_verify`
- 纯设计灵感 moodboard → 产品设计相关 skill / 文案讨论
- 对话里解释概念用图 → `inline-visual`

## 对用户怎么说

- 谈：**站点、设计方向、预览、定稿**
- 不谈：工具名、命令、路径、脚手架实现细节（除非用户追问）

## 标准流程（按顺序）

### 1. init — 脚手架 + 骨架

```
website_delivery action=init
title=站点名
site_dir=site   # 可选，默认 site
```

- 立刻可 `open_preview`，让用户先看到骨架在加载
- 不要先长篇问需求再空白等到做完

### 2. save_option × 2~3 — 设计方向

每个方向一次：

```
website_delivery action=save_option
title=方向名
brief=气质/布局/字体/主色与交互要点
colors=#111,#6366f1,#f8fafc
html=可选的预览 HTML 小页
```

要求：
- **正好 2~3 个**可比较的方向，变量清晰（例如：深色极简 / 明亮清爽 / 编辑杂志风）
- 内容素材尽量同一套，方便比「风格」而不是比「文案谁更长」

### 3. present_choices — 用户点选

```
website_delivery action=present_choices
question=请选择一个视觉方向（之后仍可微调）
```

- 等弹窗结果；用返回的 `selected` / brief 作为实现约束
- 用户自定义文案 → 按文案当作方向说明继续

### 4. 实现

- 改 `site/index.html`、`styles.css`、`app.js`（或当前 site_dir）
- **换掉骨架**，做成完整第一版：真实文案、响应式、可点 CTA
- 一次做完主路径，避免无意义的「再抛光一轮」空转

### 5. open_preview → finalize

```
website_delivery action=open_preview
website_delivery action=finalize
```

- finalize 会清骨架标记；再预览确认
- 最终回复：给用户看结果与可改点，少贴内部路径

## 硬规则

- 有 `website_delivery` 时不要用 shell 手搓整套脚手架
- 能力开关关闭时：退回普通写文件，并简短说明可在设置里开启「网页交付」
- 设计选择未完成前，不要把三个方向直接写进仓库成品页混在一起
- 主会话自己读本 skill；不要派子代理「代读流程」

## 阶段检查

| 阶段 | 完成标志 |
|------|----------|
| 骨架 | init 成功且预览能开 |
| 选型 | 用户已选一个方向 |
| 实现 | 骨架已替换，首屏完整 |
| 收尾 | finalize + 预览确认 |

## 失败恢复

- 选项不足：补 `save_option` 再 `present_choices`
- 预览打不开：检查 index 是否存在，再试 open_preview；仍失败则给用户本地打开路径（仅当其需要）
- 用户改主意：再 present 或按新 brief 改一版后 preview
