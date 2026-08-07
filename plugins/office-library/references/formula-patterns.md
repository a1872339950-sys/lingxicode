# 公式形状速查

## 优先形态

| 场景 | 形态 |
|------|------|
| 每行算一遍 | 表列公式 / 向下填充 |
| 一块动态结果 | 溢出公式（FILTER/UNIQUE…） |
| 键值查找 | XLOOKUP 或 INDEX/MATCH；兼容旧表用 VLOOKUP(FALSE) |
| 条件汇总 | SUMIFS / COUNTIFS |
| 重复子表达式 | LET |

## 兼容性

- 目标环境不明时：偏向 IF / IFERROR / SUMIFS / INDEX-MATCH / VLOOKUP
- 明确 Microsoft 365：可用 XLOOKUP / FILTER / LET / LAMBDA

## 在灵犀中的现实

- 连接器不会在云端逐格编辑；本地 openpyxl 写入公式文本，值由 Excel 打开后计算
- 验收时区分：**公式文本正确** vs **计算值已刷新**
