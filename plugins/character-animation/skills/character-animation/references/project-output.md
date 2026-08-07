# 项目内输出约定

## 默认根目录

优先写在**当前用户项目（cwd / 打开的工程）**内，不要写到灵犀 `data/`，不要写到与项目无关的用户主目录缓存。

推荐：

```text
<project-root>/assets/characters/<character-id>/
```

若项目已有美术目录（如 `art/`、`public/sprites/`、`src/assets/`），跟随项目约定，并在 `character.json` 里写清相对路径。

## 目录建议

```text
assets/characters/<character-id>/
  character.json          # 索引：动作、帧尺寸、路径
  source/                 # 参考图、布局引导
  strips/<action>.png     # 横向动作条（可选）
  frames/<action>/000.png # 单帧
  sheet/
    spritesheet.webp      # 可选整表
    atlas.json            # 可选帧矩形索引
  previews/
    contact-sheet.png
    <action>.gif
  run/                    # 临时工作区（可删）
```

## character.json（项目索引，不是桌宠清单）

```json
{
  "id": "hero",
  "displayName": "主角",
  "description": "横版平台角色",
  "cellWidth": 128,
  "cellHeight": 128,
  "actions": [
    {
      "id": "idle",
      "frames": ["frames/idle/000.png", "frames/idle/001.png"],
      "fps": 8,
      "loop": true
    },
    {
      "id": "walk",
      "frames": ["frames/walk/000.png", "frames/walk/001.png", "frames/walk/002.png"],
      "fps": 12,
      "loop": true
    }
  ],
  "sheet": {
    "path": "sheet/spritesheet.webp",
    "atlas": "sheet/atlas.json"
  }
}
```

路径一律相对 `character.json` 所在目录或项目根，二选一并写进字段注释/约定。

## 禁止的默认路径

- 用户主目录下与当前工程无关的角色/宠物缓存目录
- 灵犀安装目录 / 灵犀 `data/characters/**`（除非用户明确要求「给灵犀桌宠用」）
- 用户桌面或 Downloads（除非用户指定）
