# 角色动画

灵犀插件：帮助用户在**自己的项目里**制作 **2D 角色动画帧**。

## 定位（重要）

| 是 | 否 |
|----|----|
| 项目内美术资产流水线 | 默认给灵犀装系统桌宠 |
| 输出到工程 `assets/` 等目录 | 写入与项目无关的宠物缓存目录 |
| 用户定义动作与帧规格 | 强制 9 态桌宠协议 |

## 典型产出

```text
<项目>/
  assets/characters/<角色名>/
    source/           # 参考、布局引导
    strips/           # 每动作一条横向帧带（可选）
    frames/<action>/  # 单帧 PNG
    sheet/            # 可选 spritesheet + meta
    previews/         # contact sheet / GIF
    character.json    # 动作表、帧尺寸、路径索引
```

## 使用

安装插件后，在输入框选用 **角色动画**，例如：

- 在当前项目做一套 idle + walk + jump 的 2D 角色帧
- 参考图在 `design/hero.png`，导出到 `assets/characters/hero`
- 把已有动作条抽帧并拼 sheet

## 脚本

`skills/character-animation/scripts/` 提供可选的抽帧、拼 atlas、contact sheet、预览工具。  
默认**不要**按 8×9 桌宠硬规格输出，除非用户明确要求兼容灵犀桌宠图集。
