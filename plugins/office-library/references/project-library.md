# 项目文档库约定

## 默认搜索根（按顺序）

1. 用户点名的绝对/相对路径
2. `<project>/docs/`
3. `<project>/assets/office/`
4. `<project>/assets/`
5. 项目根（限制深度，避免扫 node_modules）

## 忽略

- `node_modules/`、`.git/`、`dist/`、`build/`、`.lingxi-temp-artifacts/`
- 超大二进制（>50MB）除非用户明确要求

## 文件类型

| 扩展名 | 技能 |
|--------|------|
| `.docx` | word-docs |
| `.xlsx` / `.xlsm` | spreadsheets / formula-builder |
| `.pptx` | powerpoint |
| `.pdf` / `.md` | 只读摘要（本插件非主路径） |

## 安全写回

1. 先读后写；写前说明改动点
2. 对 Office 包：**本地下载/打开 → 本地改 → 整文件保存回原路径**（或用户指定新路径）
3. 重要文件可先复制 `*.bak-时间戳` 再覆盖
4. 写后复查目标内容是否存在
