# 二进制分析（可选模块 · 可整夹删除）

## 卸载

```text
删除整个目录：
  electron/modules/optional/binary-analysis/
```

重启灵犀后：

- 能力开关「二进制分析」消失  
- 工具 `inspect_binary` 不再注册  
- 主程序其它功能不受影响  

## 能力边界

- **仅静态分析**：格式、节区、导入导出、字符串、熵、入口十六进制预览  
- **用途**：授权样本、自有构建产物、隔离环境下的恶意研判、CTF  
- **不做**：自动破解授权、生成 exploit、免杀  

默认在设置里 **关闭**（`risk: high`）。

## 文件

| 文件 | 作用 |
|------|------|
| `index.js` | 模块出口（feature / schema / handlers） |
| `inspect.js` | PE/ELF 等静态解析 |
| `schema.js` | 工具 schema |
| `handlers.js` | 工具执行 |
| `SKILL.md` | 模型流程说明（可选） |
