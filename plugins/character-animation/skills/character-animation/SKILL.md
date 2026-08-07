---
name: character-animation
title: 角色动画
description: 在用户当前项目内制作 2D 角色动画帧与可选 spritesheet。适用于游戏角色、网页角色、演示动画、UI 小人等；输出到项目 assets，不是给灵犀产品装桌宠。支持定动作、生成帧、抽帧、拼 sheet、预览与 character.json 索引。
---

# 角色动画

## 完成即预览（硬规则 · 默认开启）

**角色动画任务完成时，必须默认打开桌面悬浮预览，让用户立刻看到动起来的效果。**

1. 当 `character.json` / `spritesheet.webp`（或 `frames/` 已齐）可播时，在同一轮工具调用里执行：

```text
character_animation_preview
  action: open
  path: <角色目录绝对路径或项目相对路径>
```

2. **禁止**只回复路径/文件列表就结束；没有 `open` 预览不算交付完成。  
3. 用户说「关掉 / 关闭预览 / 关了吧」→ `character_animation_preview` + `action: close`。  
4. 仅当用户明确说「不要预览 / 别弹窗」时才可跳过 open。  
5. 若写入产物时系统已自动弹窗，仍应用 status 确认已打开；未打开则补 open。

## 定位（硬边界）

本插件服务对象是**用户自己的工程资产**，不是把角色装进灵犀产品目录当系统桌宠。

| 要做 | 不要做 |
|------|--------|
| 在**当前项目**里产出 2D 动画帧 / sheet | 写入用户主目录下的第三方宠物目录 |
| 动作列表由用户/用途决定 | 默认套 9 态桌宠图集协议 |
| 路径写进项目内 `character.json` | 把产物当「装到灵犀本体」的宠物包 |
| 可选兼容固定格 atlas 工具 | 未经要求就用 8×9×192×208 桌宠规格 |

若用户说「做个宠物/桌宠」，先确认：  
A) 项目里的角色动画资产，还是 B) 真要兼容灵犀桌宠图集。默认按 **A**。

## 何时使用

- 「在这个项目里做角色走路/攻击帧」
- 「根据参考图生成 2D 动作序列并导出」
- 「抽帧、拼 spritesheet、做预览」
- 「修角色帧一致性 / 透明底 / 尺寸跳动」

## 开始前确认（简短）

用最少问题澄清后直接做：

1. **用途**：游戏 / 网页 / 演示 / 其它  
2. **动作列表**：用户指定，或按 `references/action-presets.md` 推荐后确认  
3. **帧规格**：单帧宽高、每动作大约帧数、是否透明底  
4. **输出目录**：默认 `<project>/assets/characters/<id>/`；若项目已有美术目录则跟随  

读 `references/project-output.md`。

## 默认工作流

### 1. 锁定项目输出根

```text
<project-root>/assets/characters/<character-id>/
```

在该目录下建 `source/`、`frames/`、`strips/`（可选）、`sheet/`（可选）、`previews/`、`run/`（临时）。

**禁止**默认输出到：

- 用户主目录下与项目无关的宠物/角色缓存目录
- 灵犀 `data/characters\...`（产品数据，不是用户项目；仅用户明确要做灵犀桌宠时才可写）
- 桌面 / Downloads（除非用户指定）

### 2. 定义动作表

写入草稿 `character.json`（见 `references/project-output.md`）。  
动作名用短英文 id（`idle`/`walk`/`jump`…），显示名可中文。

### 3. 生成视觉

- 有参考图：所有动作必须锁同一身份（脸、比例、配色、道具、风格）。
- 可用图像生成（项目已接的 image gen / 用户环境能力）；不要假定必须特定外部 CLI 环境。
- 每个动作可先出**横向动作条**（strip）或直接出逐帧；条带更利于批量抽帧。
- 背景优先纯色抠像底，避免棋盘格、复杂场景。

### 4. 抽帧与整理

- 条带 → `frames/<action>/000.png`…
- 同动作内帧尺寸一致；透明像素无脏色边
- 本插件 `scripts/` 可选用：
  - `extract_strip_frames.py` 抽条带
  - `inspect_frames.py` 检查
  - `compose_atlas.py` / `validate_atlas.py` **仅当**用户要固定 atlas
  - `make_contact_sheet.py` / `render_animation_previews.py` 预览

默认项目动画**不要**强制跑「8 列 9 行桌宠 atlas」。用户只要帧序列时，交付 `frames/` + `character.json` 即可。

### 5. 预览与 QA

- 出 contact sheet 和/或每动作预览
- 按 `references/qa-rubric.md` 检查
- 身份漂移、裁切、脏底、尺寸跳动 → 只重做失败动作

### 6. 交付到项目

最终至少包含：

1. `frames/**` 或用户指定的帧路径  
2. `character.json`（动作 → 帧列表 / fps / loop）  
3. 可选 `sheet/spritesheet.*` + atlas  
4. 可选 `previews/`  

在回复里写清**相对项目根**的路径，方便用户接入引擎或前端。

### 7. 桌面悬浮预览（完成即 open · 默认）

见文首「完成即预览」硬规则。摘要：

| 时机 | 动作 |
|------|------|
| 制作完成 / 可播资源就绪 | `character_animation_preview` → `open` |
| 用户说关掉 | `close` |
| 切换动作 | `set_action` + `action_id` |

- 置顶悬浮窗，**不是**网页，**不需要**本地 server。  
- 写入 `character.json` / `spritesheet.webp` 时系统也可能自动弹窗；模型仍须保证最终可见。  
- 清理 `run/` 临时文件（用户要求保留调试产物时除外）。

## 动作预设

见 `references/action-presets.md`。  
仅当用户明确要求「灵犀桌宠兼容 8×9 图集」时，才读 `references/legacy-atlas-optional.md` 并用该规格脚本。

## 脚本路径

```text
SKILL_DIR = <本插件 skills/character-animation 的绝对路径>
python "$SKILL_DIR/scripts/...."
```

在灵犀中：安装后的插件副本通常在用户数据 `plugins/character-animation/`，或仓库 `plugins/character-animation/`。先解析实际路径再调用。

## 规则摘要

1. **完成即 open 预览**（默认；用户明确拒绝除外）。  
2. **项目内资产优先**，路径相对工程。  
3. **动作与规格用户决定**，不默认桌宠 9 态。  
4. **一致性 > 炫技**（同一角色全动作可辨认）。  
5. **透明与干净边缘**，避免阴影地块、文字、网格进帧。  
6. **禁止**把产物默认塞进灵犀产品宠物目录或其它无关路径。  
7. 用户只要帧、不要 sheet 时，不要多余打包步骤。  
8. 用户说关预览 → 立刻 `close`。

## 验收

- [ ] 输出在项目约定目录  
- [ ] `character.json` 可索引全部动作与帧  
- [ ] 各动作肉眼可区分且身份一致  
- [ ] **默认已打开** `character_animation_preview` 悬浮窗（用户明确不要除外）  
- [ ] 用户要求关闭时已 `close`  
- [ ] 未写入灵犀产品宠物路径或无关目录（除非用户明确要求）
