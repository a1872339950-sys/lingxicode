---
name: index
title: 游戏工作室总入口
description: 浏览器游戏总路由。规划玩法与技术栈、再分到架构/2D/3D/资产/UI/试玩。用户要做游戏、小关卡、玩法原型时使用。
---

# 游戏工作室总入口

你在使用 **游戏工作室** 能力包：覆盖从玩法规划到试玩验收的浏览器游戏工作，**不是**只做一个空壳原型页。

## 何时使用

- 做浏览器游戏 / 可玩关卡 / 玩法原型
- 需要选型（2D Phaser / Three / R3F）
- 精灵或 3D 资产、游戏 UI、试玩验收

## 何时不用

- 普通落地页 / 官网 → **网页交付**
- 只讲概念用图 → **对话示意**
- 用户明确要 Unity / 原生主机引擎且不要网页

## 分流规则（先分类再动手）

1. **还在选方向**（「帮我做个游戏」）  
   - 澄清：类型幻想、主操作、单机/联网、2D 还是 3D  
   - **默认 2D + Phaser**，除非用户明确 3D / React 3D  
   - 需要架构边界 → `foundations`  

2. **明确 2D 实现** → `phaser-2d`  
   - 角色帧生成/整理 → 同时可走 `sprite-pipeline`，并提示 **角色动画** 插件  

3. **明确原生 3D（TS/Vite、要控循环）** → `three-webgl`  
   - 模型优化/导出 → `web-3d-assets`  

4. **3D 嵌在 React 产品里** → `react-three-fiber`  

5. **HUD/菜单/不挡画面** → `game-ui`  

6. **给人玩 / 找问题 / 验收** → `playtest`  

## 标准工作流

```text
玩法与循环 → foundations（边界）
    → 2D: phaser-2d (+ sprite-pipeline)
    → 3D: three-webgl | react-three-fiber (+ web-3d-assets)
    → game-ui（需要时并行）
    → playtest
```

## 对用户说话

- 谈：玩法、手感、怎么打开试玩、已知限制  
- 少谈：内部 skill 名、黑话堆砌（对方是程序可适度技术化）  

## 脚手架速查

| 路线 | 命令 |
|------|------|
| Phaser 2D | `node scripts/scaffold-phaser.cjs --dest <dir>` |
| Three.js | `node scripts/scaffold-three.cjs --dest <dir>` |
| R3F | `node scripts/scaffold-r3f.cjs --dest <dir>` |

路径以本插件安装目录下的 `scripts/` 为准。

## 硬规则

- 先 **最小可玩循环**，再堆内容与美术  
- 玩法状态 ≠ 渲染对象；禁止全塞进一个 update  
- 主会话自己读对应子 skill，不派子代理「代读流程」  
- 3D 未选定栈时不要同时开 Three 和 R3F 两套脚手架  
