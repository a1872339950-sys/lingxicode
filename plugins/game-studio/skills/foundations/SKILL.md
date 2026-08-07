---
name: foundations
title: 游戏架构基础
description: 写代码前定清模拟与渲染边界、输入、资源、存档与性能策略。浏览器游戏架构阶段使用。
---

# 游戏架构基础

## 原则

1. **模拟与渲染分离**  
   - 模拟：实体、回合、碰撞、进度、可存档状态  
   - 渲染：场景图、动画、相机、粒子  

2. **输入映射集中**  
   - 动作层：`move` `jump` `confirm` `pause`…  
   - 物理输入只在 bindings 映射到动作  

3. **资源清单**  
   - 稳定 key（`player.idle`），路径集中在 manifest  
   - 分组：characters / environment / ui / fx / audio / data  

4. **UI 默认 DOM**  
   - 画布：玩法空间  
   - DOM：菜单、设置、密集文字 HUD  

5. **存档只存模拟状态**  

6. **调试与性能**  
   - 调试层可开关；3D 注意后处理与资产体积  

## 开工前清单

- [ ] 玩家幻想与主动词  
- [ ] 核心循环与失败/重置  
- [ ] 相机模型  
- [ ] 输入动作表  
- [ ] 模块边界（systems / scenes / ui）  
- [ ] 资产目录与 key  
- [ ] 2D 帧格式或 3D 默认 glTF/GLB  

## 反模式

- 渲染回调里堆全部规则  
- 全局可变对象在场景间乱传  
- 文件名当公共 API  
- 每次改类型就推倒架构  

详见 `references/engine-selection.md`、`references/architecture.md`。  
