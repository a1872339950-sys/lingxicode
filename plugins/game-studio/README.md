# 游戏工作室

浏览器游戏全流程能力包：规划 → 架构 → 2D/3D 实现 → 资产 → UI → 试玩。  
**不是**「只做一个空壳 demo」。

## 覆盖范围

| Skill | 用途 |
|-------|------|
| index | 总入口：2D / 3D / 资产 / UI / 试玩分流 |
| foundations | 架构：模拟与渲染、输入、资源、存档 |
| phaser-2d | Phaser 2D 主实现路径 |
| three-webgl | 原生 Three.js 3D |
| react-three-fiber | React 内 3D（R3F） |
| sprite-pipeline | 2D 精灵帧与预览 |
| web-3d-assets | glTF/GLB 等 3D 资产 |
| game-ui | HUD / 菜单 / 不挡玩法 |
| playtest | 试玩与验收 |

## 使用

1. 插件商城安装 **游戏工作室**
2. 输入框选用该插件
3. 说清类型幻想与平台（网页）后，从总入口分流

## 脚手架

在仓库根或任意目录执行（`--dest` 指向新项目路径）：

```bash
# 2D Phaser（默认推荐）
node plugins/game-studio/scripts/scaffold-phaser.cjs --dest ./my-2d-game

# 原生 Three.js 3D
node plugins/game-studio/scripts/scaffold-three.cjs --dest ./my-3d-game

# React Three Fiber
node plugins/game-studio/scripts/scaffold-r3f.cjs --dest ./my-r3f-game
```

然后：

```bash
cd <项目>
npm install
npm run dev
```

目标非空需加 `--force` 覆盖。

## 精灵脚本

```bash
python plugins/game-studio/scripts/extract_strip_frames.py --input strip.png --out-dir frames/walk --frames 8
python plugins/game-studio/scripts/make_contact_sheet.py --input-dir frames/walk --output previews/walk.png
```

依赖：`python -m pip install pillow`

## 与角色动画

2D 角色帧可配合 **角色动画** 插件产出到 `assets/characters/`，再接入 Phaser / 游戏 manifest。
