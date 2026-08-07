---
name: three-webgl
title: Three.js 3D
description: 用原生 Three.js（TS/Vite）做浏览器 3D 游戏运行时：场景、加载、循环、基础调试。
---

# Three.js 3D

## 何时使用

- 用户要 **3D**，且要直接控制 scene / camera / renderer / 循环  
- 非 React 宿主，或明确不要 R3F  

## 栈

Three.js + TypeScript + Vite；模型默认 **glTF/GLB**（见 `web-3d-assets`）。

## 结构建议

```text
src/
  game/
    simulation/     # 可序列化状态与规则
    loop.ts         # 固定步或 rAF 调度
  three/
    app.ts          # renderer/scene/camera
    loaders/
    view/
  input/
  ui/               # DOM
  main.ts
```

## 要点

1. 模拟 tick 与渲染帧解耦（可固定步模拟）  
2. 加载与进度 UI 明确；失败可恢复  
3. 单位、原点、碰撞代理约定先定  
4. 性能：阴影/后处理克制；大场景要 LOD/合批意识  
5. 调试：卡死/黑屏先查相机、灯光、尺度、上下文丢失  

## 脚手架

```bash
node scripts/scaffold-three.cjs --dest <项目路径>
```

最小可玩：固定步模拟 + 立方体、拖拽轨道相机、空格重置。

## 与 R3F

React 应用里的声明式 3D → 改用 `react-three-fiber`，不要两套并行脚手架。  

详见 `references/threejs-notes.md`。  

