---
name: export
title: 预览与导出
description: Remotion Studio 预览、单帧抽检与成片导出检查。
---

# 预览与导出

## 预览

```bash
npm run dev
# 或 npx remotion studio
```

在 Studio 中选中目标 Composition。

## 单帧抽检（可选）

布局/配色不确定时，渲染一帧快速看：

```bash
npx remotion still <composition-id> --frame=30 --scale=0.5
```

## 导出成片

按项目脚本或：

```bash
npx remotion render <composition-id> out/video.mp4
```

（以当前 Remotion 版本文档为准。）

## 交付前检查

- [ ] 正确 Composition / 时长  
- [ ] 字幕无溢出  
- [ ] 音频正常  
- [ ] 输出路径告知用户  
- [ ] 未把「Studio 预览」说成「已导出成片」  

详见 `references/export.md`。  
