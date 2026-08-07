# 通用新建流程

1. **锁定模板**：从 `catalog.md` 选中 template id 与参考文件。
2. **解析插件根**：本 skill 所在插件的 `templates/` 目录（安装后可能在用户数据 `plugins/office-templates/`）。
3. **复制参考**：把参考文件复制到输出路径（不要改坏 templates 源文件）。
4. **填内容**（按类型）：
   - **document**：`python-docx` 打开副本，改标题/段落；保留样式与章节结构。
   - **presentation**：优先 `artifact_workflow(domain="ppt")` 或 `office_workflow(kind="ppt")`；也可 `python-pptx` 在副本上改占位符文字。版式敏感时先克隆参考页再改字。
   - **spreadsheet**：优先 `office_workflow(kind="excel")` / `artifact_workflow(domain="excel")`；或 `openpyxl` 在副本上改数据、保留公式与图表。
5. **不编造事实**：模板槽位缺信息时写占位或向用户确认，不要填假数据当结论。
6. **验收**：打开/读取产物，确认关键标题与结构存在；表格核对公式单元格仍在。
7. **回报路径**：给出相对项目根的路径。

## 工具选择

| 类型 | 推荐 |
|------|------|
| 任意类型起稿 | **`office_from_template`**（list / apply） |
| pptx 复杂排版 | `artifact_workflow(domain="ppt", script=...)` |
| xlsx 数据/公式 | `office_workflow(kind="excel", ...)` 或 openpyxl 脚本 |
| docx | `office_workflow(kind="docx")` / `artifact_workflow(domain="docx")` 或 python-docx |

## 保真原则

- 参考文件控制版式；用户指令控制内容。
- 不要把 `.docx` 打成纯文本再另存。
- 不要把带公式的 `.xlsx` 摊平成 CSV 后覆盖。
- 不要整本重建 PPT 母版；优先在参考副本上改。
