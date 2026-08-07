---
name: office-library-formula-builder
title: Excel 公式构建
description: 在项目内工作簿上设计、修复、铺开公式。加计算列、查找、条件汇总、溢出公式时使用。
---

# Excel 公式构建

读 `../../references/formula-patterns.md`。

## 流程

1. 锁定文件、sheet、目标列/单元格、输入列。
2. 读几行样例数据（含空值）。
3. 选择形态：行公式 / 表公式 / 溢出 / 查找 / 汇总。
4. 先在辅助列或本地验证公式文本。
5. 写入目标区域，保留邻近格式与表结构。
6. 说明：计算值可能需 Excel 打开后刷新；你已验证的是公式文本与依赖范围。

## 兼容

环境不明 → 保守函数；明确新 Excel → 可用 XLOOKUP/FILTER/LET。
