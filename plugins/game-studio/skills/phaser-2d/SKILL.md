---
name: phaser-2d
title: Phaser 2D
description: 用 Phaser 做 2D 浏览器游戏：薄场景、系统管玩法、DOM HUD。默认 2D 主路径。
---

# Phaser 2D

## 默认栈

Phaser 3 + TypeScript（或清晰 JS）+ Vite + DOM HUD

## 推荐目录

见 `references/phaser-architecture.md`。摘要：

- `src/systems/` 玩法规则  
- `src/game/scenes/` 薄场景  
- `src/input/` 动作映射  
- `src/assets/manifest.ts` 资源 key  
- `src/ui/` DOM  

## 实现要点

1. 场景读系统状态、回传输入动作；规则不活在单个 Sprite 闭包  
2. 相机逻辑与战斗/移动规则分离  
3. 动画状态由玩法状态推导  
4. 资源全程用 manifest key  

## 最小可玩（MVP）

- Boot / Preload / Play（+ 可选 Menu）  
- 完整：开始 → 主操作 → 反馈 → 失败或重置  
- `npm run dev` 可开  

## 脚手架

插件内：

```bash
node scripts/scaffold-phaser.cjs --dest <项目路径>
```

## 角色帧

需要走路/攻击等序列时：可走 `sprite-pipeline`，或安装 **角色动画** 插件产出后接入 manifest。  

## 反模式

- 全部逻辑塞一个 Scene.update  
- `window.gameState` 乱传  
- 长文 HUD 硬画在 canvas  
