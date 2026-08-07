---
name: remotion-core
title: Remotion 时间线基础
description: Remotion 组合、序列、插值与组件动画。写程序化视频时使用。
---

# Remotion 时间线基础

## 核心概念

- **Composition**：一条片子（宽高、fps、时长帧数）  
- **Sequence**：时间轴上的片段（from / durationInFrames）  
- **useCurrentFrame / useVideoConfig**：当前帧与配置  
- **interpolate / spring**：数值动画  

## 推荐目录

```text
src/
  Root.tsx           # 注册 Composition
  compositions/
    Main.tsx
  components/
  public/            # 静态资源
```

## 动画原则

1. 一切跟 **frame** 走，保证可重现  
2. 进出场用插值；弹性用 spring，别过度弹  
3. 长片拆 Sequence，避免单组件巨无霸  
4. 字体与颜色抽成常量/props  
5. 30fps 时：1 秒 = 30 帧；`frame=30` 约 1s 处  

## 最小示例思路

- 背景层全片  
- 标题 Sequence 0–45  
- 副文案 Sequence 20–90  
- CTA Sequence 70–end  

## 检查

- [ ] fps / 宽高 / 总帧数合理  
- [ ] 无未定义字体闪烁  
- [ ] Studio 能预览到目标 Composition  

详见 `references/remotion-basics.md`。  
