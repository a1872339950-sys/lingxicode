---
name: sprite-pipeline
title: 精灵管线
description: 2D 精灵帧生成、条带整理、尺寸锚点一致与预览。用于角色/特效序列帧接入游戏。
---

# 精灵管线

## 何时使用

- 需要 idle/walk/attack 等 **帧动画**  
- 统一锚点、帧尺寸、透明底  
- 出 contact sheet / 预览条  

## 推荐流程

1. 锁定角色身份（比例、配色、剪影）  
2. 按动作产出帧或横向 strip  
3. 抽帧到 `frames/<action>/000.png…`  
4. 检查：同动作尺寸一致、无脏边、锚点稳定  
5. 写入 manifest key，供 Phaser 等加载  
6. 需要完整角色工程时：优先配合 **角色动画** 插件（含悬浮预览）  

## 目录示例

```text
assets/characters/<id>/
  frames/<action>/
  sheet/            # 可选
  previews/
  character.json    # 可选索引
```

## 插件脚本（可选）

需 Pillow：`python -m pip install pillow`

```bash
# 横向 strip → 逐帧
python scripts/extract_strip_frames.py --input walk_strip.png --out-dir frames/walk --frames 8

# 帧目录 → contact sheet 预览
python scripts/make_contact_sheet.py --input-dir frames/walk --output previews/walk_sheet.png
```

完整角色工程优先用 **角色动画** 插件（含悬浮预览）。

## 规则

- 一致性 > 单帧炫技  
- 默认透明底；避免棋盘格/复杂背景进帧  
- 不要未经要求就套固定桌宠图集规格  

详见 `references/sprite-pipeline.md`。  

