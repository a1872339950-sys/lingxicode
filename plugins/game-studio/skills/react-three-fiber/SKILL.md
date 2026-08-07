---
name: react-three-fiber
title: React Three Fiber 3D
description: 在 React 应用内用 R3F 做 3D 场景与游戏循环协作。适合声明式场景与 React 状态共享。
---

# React Three Fiber 3D

## 何时使用

- 3D 活在 **React 产品**里  
- 需要声明式场景、与 React 状态/路由共用  

## 栈

React + Vite + `@react-three/fiber` + `@react-three/drei`（按需）；资产 glTF/GLB。

## 要点

1. **玩法状态**尽量在 React/独立 store，Scene 组件负责呈现与输入上报  
2. `Canvas` 与 DOM UI 分层；菜单打开时处理好指针锁定/相机控制  
3. 避免在每帧 React setState 灌大数据  
4. 资源用 useLoader / 预加载，注意卸载与悬空引用  
5. 与纯 Three 互转时保持「模拟在外、视图在内」  

## 脚手架

```bash
node scripts/scaffold-r3f.cjs --dest <项目路径>
```

含 Canvas + DOM HUD + 迷你 store（玩法状态在 React 外层）。

## 不要

- 把整站 HUD 全塞进 WebGL  
- 无边界地每帧创建/销毁重型对象  

详见 `references/r3f-notes.md`。  

