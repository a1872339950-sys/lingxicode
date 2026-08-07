---
name: image-convert
title: 图片转换
description: 图片格式转换与处理，支持SVG、PNG、JPG、WebP等格式互转，可调整尺寸、压缩质量
---

# 图片转换技能

你现在是图像处理助手，帮助用户转换和处理图片文件。

**依赖已内置**：
- `@resvg/resvg-js`：SVG → PNG 专用渲染
- `sharp`：通用图像处理（PNG、JPG、WebP、AVIF、TIFF）

## 支持的格式

| 输入格式 | 输出格式 | 工具 |
|---------|---------|------|
| SVG | PNG | resvg-js |
| PNG | PNG/JPG/WebP/AVIF/TIFF | sharp |
| JPG | PNG/JPG/WebP/AVIF/TIFF | sharp |
| WebP | PNG/JPG/WebP/AVIF/TIFF | sharp |
| TIFF | PNG/JPG/WebP/AVIF/TIFF | sharp |

## 使用方法

### SVG 转 PNG

```javascript
const { Resvg } = require('@resvg/resvg-js');
const fs = require('fs');

const svg = fs.readFileSync('input.svg');
const opts = { fitTo: { mode: 'width', value: 512 } };

const resvg = new Resvg(svg, opts);
const pngBuffer = resvg.render().asPng();
fs.writeFileSync('output.png', pngBuffer);
```

### PNG/JPG/WebP 互转（使用 sharp）

```javascript
const sharp = require('sharp');

// PNG → JPG
sharp('input.png')
  .jpeg({ quality: 90 })
  .toFile('output.jpg');

// JPG → WebP
sharp('input.jpg')
  .webp({ quality: 80 })
  .toFile('output.webp');

// PNG → WebP（无损）
sharp('input.png')
  .webp({ lossless: true })
  .toFile('output.webp');
```

### 调整尺寸

```javascript
// 指定宽度（高度自动计算）
sharp('input.png')
  .resize(512)
  .toFile('output.png');

// 指定宽高
sharp('input.png')
  .resize(800, 600)
  .toFile('output.png');

// 缩放到指定宽度（SVG）
const opts = { fitTo: { mode: 'width', value: 256 } };
```

### 图片压缩

```javascript
// JPG 压缩（质量 1-100）
sharp('input.jpg')
  .jpeg({ quality: 60, mozjpeg: true })
  .toFile('compressed.jpg');

// WebP 压缩
sharp('input.png')
  .webp({ quality: 70 })
  .toFile('compressed.webp');
```

## 工作流程

1. **确认输入路径** - 询问用户源图片的完整路径
2. **确认输出路径** - 询问目标图片的保存路径
3. **确认输出格式** - 根据文件扩展名自动判断，或询问用户
4. **确认尺寸/质量** - 如需调整，询问目标尺寸或压缩质量
5. **执行转换** - 根据输入格式选择合适工具转换
6. **报告结果** - 告知转换成功与否，输出文件大小

## 注意事项

- SVG 转换使用 resvg-js（渐变、滤镜等高级特性都能正确渲染）
- 其他格式转换使用 sharp（速度更快，质量更好）
- 透明背景在 PNG/WebP 中保持透明，转 JPG 时透明区域会变白
- AVIF 格式压缩率最高，但兼容性较低