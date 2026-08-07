# 桌面操控运行指引

## 首次任务

1. `list_windows` 或 `list_apps`，打印匹配结果，不要猜窗口。
2. 恰好一个目标窗口时再 `get_window_state`。
3. 多个匹配时收紧 `query` 或按 title 过滤，禁止随机挑一个。

## 启动应用

- 优先 `launch_app` 的 `name` 或完整 `.exe` 路径。
- **不要** 通过开始菜单 UI 搜索来启动。
- 启动后轮询 `list_windows`（约 1s 间隔，最多约 10 次）直到出现目标窗口。

## 状态与动作

- 驱动语义动作时用 `include_text=true` 拿树；树很大时先筛 `nodes`/`tree`。
- 画布、游戏、弱 a11y 应用：截图 + 稳定窗口相对坐标；截图坐标不要叠加窗口屏幕偏移。
- 相关动作可连续执行，再 **统一** `get_window_state` 验证一次。
- 句柄失效：重新 `list_windows`，不要复用旧 id。
- `get_window_state` 默认不抢焦点；需要前置时 `activate_window` 或 `activate:true`。输入类 method 会自动前置。

## 键盘

- 文本用 `type_text`；先用可访问性输入框或本轮截图确认的坐标锁定真实输入框，再把点击、输入、提交合并为一次调用。不要猜 Ctrl+K/Ctrl+F/Ctrl+L 的应用语义；单独 `press_key` 后必须重新观察验证，不能直接继续输入。
- Office 丝带优先 Alt 序列而非脆弱的 ribbon element_index。
- 禁止 Win/Meta 键。

## 开关、授权与中断

- 设置关闭 `enabled` 时工具不可用：提示用户到 **设置 → 个性化 → 桌面操控** 开启，禁止 shell 绕过。
- 首次操作某应用可能弹授权：尊重用户选择；`rejected` 则停止该应用相关动作。
- 屏幕状态条出现表示正在操控；返回 `interrupted: true`（用户 Esc）后，本轮禁止再调 `desktop_control`。

## 失败恢复

1. 元素找不到：提高 `max_nodes`/`max_depth`，或改用坐标 click。
2. 截图发黑：通道会尝试屏幕回退；仍失败则依赖 a11y 树，不要改用危险的 SendKeys 脚本兜底。
3. 控件无语义 pattern：分析本轮截图，使用确认过的窗口相对坐标执行 `click` 或 `type_text`。不要用猜测快捷键兜底。
4. 窗口被快捷键意外最小化：工具会自动恢复并判本次动作失败；重新观察真实控件后再操作。

## 与其它工具分工

| 场景 | 工具 |
|------|------|
| 项目网页/开发预览验证 | `runtime_verify` |
| Office 文件内容 | `office_workflow` / `artifact_workflow` |
| 浏览器页面 | 浏览器工具优先 |
| 打开软件不操作 UI | `desktop_control method=launch_app` 或 `desktop_app action=open` |
| 任意桌面 UI | `desktop_control` |
