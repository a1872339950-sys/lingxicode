---
name: desktop-control
title: 桌面应用操控
description: 用语义 UI Automation 与窗口相对坐标/键盘注入操控 Windows 桌面应用。在需要操作记事本、设置、安装器、第三方客户端等、且没有专用工具时使用。
---

# 桌面应用操控

用 `desktop_control` 工具操作 Windows 应用界面。真正执行靠工具，本技能说明流程、边界与确认规则。

## 何时使用

- 用户要求操作某个桌面软件的界面（点击、填写、拖拽、快捷键、开关选项）。
- 没有更合适的专用工具：文件读写、项目搜索、Office 工作流、浏览器工具、本项目 `runtime_verify`。

## 何时不要使用

- 改项目代码、搜源码 → 文件/搜索工具。
- 验证自己拉起的网页/项目运行实例 → `runtime_verify`。
- Word/Excel/PPT 结构化编辑 → `office_workflow` / `artifact_workflow` / `office_from_template`。
- 浏览器页面自动化 → 浏览器专用工具优先。
- 只是打开软件、不操作界面 → `desktop_app action=open` / `desktop_control(method=launch_app)` 即可。

## 标准流程

1. `list_windows` 或 `list_apps` 找到目标（可带 `query`）。
2. 若无窗口：`launch_app`，再轮询 `list_windows`。
3. `activate_window`（可选；输入类动作会自动前置；`get_window_state` 默认不抢焦点）。
4. `get_window_state`：需要控件索引时 **`include_text=true`**；默认带截图。
5. 动作：
   - 按钮/开关/播放：优先 `click` / `act`，使用 `element_index` 或唯一的 name+role。
   - 输入框：优先 `set_value` 或指定输入框的 `type_text`。弱 a11y 应用应从本轮截图确认输入框坐标，再用 `type_text(x=..., y=..., coordinate_verified=true, text=..., submit=true)` 一次完成点击、输入、回车。
   - 纯坐标 click：第一次只做命中确认；仅当控件树无法定位且已分析本轮截图后，才设 `coordinate_verified=true`。`image_analyze` 不会让该观察失效，分析后直接点击，不要再截图。
   - 拖拽/滚动：窗口相对坐标；按键：`press_key`（禁止 Win/Meta）。
   - 会改变布局的点击后重新观察；同一搜索输入链不要逐步截图，聚焦、输入、回车合并后统一验证。
6. 再 `get_window_state` 统一验证。

## 硬性约束

- 只使用列表返回的 `window.id`，禁止编造句柄。
- 坐标默认 **窗口相对**，截图左上角就是 `(0,0)`，绝对不要再加 `window.rect.x/y`；确有屏幕坐标时显式设 `coordinate_space=screen`。未核对截图不得设置 `coordinate_verified=true`。
- 控件编号必须来自本轮最新观察；名称、角色或 AutomationId 对不上时停止并重新观察。
- 不得向未知焦点直接输入。禁止猜 Ctrl+K/Ctrl+F/Ctrl+L 能聚焦搜索框；`press_key` 成功只说明按键已注入，必须重新观察界面后才能继续。若按键导致窗口最小化，工具会恢复窗口并返回失败。
- 禁止 `shell_run`/SendKeys/自写 PowerShell 模拟键鼠替代本工具。
- 禁止 Windows/Meta 键与开始菜单启动路径。
- 用户可在 **设置 → 个性化 → 桌面操控** 关闭总开关；关闭后本工具不可用，不得绕过。
- 首次操控某应用会询问授权（仅本次 / 本会话 / 始终）；拒绝后停止。
- 操控时屏幕有状态条；用户按 **Esc** 会中断本轮（工具返回 `interrupted`），须立刻停止并说明。
- 删除/安装/支付/对外发送等会二次确认。
- 用户可见进度用自然语言，不要暴露内部脚本/适配器实现细节。

## 延伸阅读（按需）

- `docs/guidance.md`：选窗、恢复、失败处理。
- `docs/api.md`：method 参数说明。
- `docs/confirmations.md`：高风险确认表。
