# desktop_control API

单一工具 `desktop_control`，用 `method` 区分能力。

## Methods

| method | 作用 | 关键参数 |
|--------|------|----------|
| `list_windows` | 列出可见顶层窗口 | `query`, `limit` |
| `list_apps` | 运行中应用 + 可选已安装候选 | `query`, `path`, `limit` |
| `launch_app` | 启动应用 | `name`/`app`, `path`, `args`, `cwd` |
| `activate_window` | 恢复并前置窗口 | `window` 或 `window_id` |
| `get_window_state` | 截图 + 可选可访问性树 | `window`, `include_text`, `include_screenshot`, `activate`, `max_nodes`, `max_depth` |
| `act` | 语义动作 | `window`, `element_index` 或 name/role/automation_id, `operation` |
| `set_value` | 写入可编辑控件（UIA ValuePattern） | `window`, 定位, `value` |
| `click` | 点击 | 优先 `window` + `element_index`/name；纯 `x`+`y` 需截图确认并设 `coordinate_verified=true` |
| `drag` | 拖拽 | `window`, `from_x`, `from_y`, `to_x`, `to_y` |
| `scroll` | 滚轮 | `window`, `x`, `y`, `scrollX`, `scrollY` |
| `type_text` | 聚焦并输入文本 | `window`, `text`；指定输入框，或提供截图确认的 `x/y` + `coordinate_verified=true`；可选 `submit=true` |
| `press_key` | 按键/和弦 | `window`, `key`（如 `Return`、`Control_L+a`） |

## Window 对象

```json
{ "id": "123456", "title": "...", "app": "notepad.exe", "executable_path": "C:\\...\\notepad.exe" }
```

`id` 为窗口句柄字符串，必须来自最近一次 list 结果。

## get_window_state

- 默认 `include_screenshot=true`，`include_text=false`，**不**自动前置（`activate` 默认 false）。
- `include_text=true`：返回 `accessibility.tree`（`[index] role: name`）、`nodes` 摘要，以及 `focused_element` / `selected_text`（若可得）。
- 截图路径在 `screenshots[].path`（不回传整图 base64）。PrintWindow 优先，近似全黑时回退屏幕位图。

## 语义动作

```json
{ "method": "act", "window": { "id": "..." }, "element_index": 12, "operation": "invoke" }
```

```json
{ "method": "set_value", "window": { "id": "..." }, "element_index": 5, "value": "你好" }
```

`operation`：`invoke` | `set_value` | `toggle` | `select` | `expand` | `collapse` | `focus`。

## 坐标与键盘

坐标默认是 **窗口相对位置**（截图左上角为 0,0），不要加窗口的屏幕 x/y。若拿到的是屏幕绝对坐标，显式传 `coordinate_space: "screen"`，工具会换算。

```json
{ "method": "click", "window": { "id": "..." }, "name": "播放", "role": "button" }
```

```json
{ "method": "click", "window": { "id": "..." }, "element_index": 12 }
```

```json
{ "method": "drag", "window": { "id": "..." }, "from_x": 10, "from_y": 10, "to_x": 200, "to_y": 120 }
```

```json
{ "method": "scroll", "window": { "id": "..." }, "x": 200, "y": 200, "scrollX": 0, "scrollY": 600 }
```

- `scrollY` 正数向下，负数向上；`scrollX` 正数向右。

```json
{ "method": "type_text", "window": { "id": "..." }, "element_index": 5, "text": "hello" }
```

弱 a11y 应用的搜索框应先从本轮截图确认窗口相对坐标，再一次完成点击、输入、回车：

```json
{ "method": "type_text", "window": { "id": "..." }, "x": 423, "y": 40, "coordinate_verified": true, "text": "周杰伦", "submit": true }
```

```json
{ "method": "press_key", "window": { "id": "..." }, "key": "Control_L+a" }
```

- `press_key` 支持 X11 风格键名与别名：`Return`/`Enter`、`Tab`、`Escape`、`space`、方向键、`F1`–`F24`、`KP_0`…、`Control_L`/`Ctrl`、`Shift_L`、`Alt_L` 等。返回成功只代表按键已注入，不代表界面效果正确；后续必须重新观察。
- **禁止** `Meta` / `Win` / `Windows` / `Cmd` / `Super`。

## 能力说明

- 语义 UIA 动作 + 全桌面窗口列表 + 启动应用。
- 窗口相对坐标 click/drag/scroll（SendInput）。
- 键盘 type_text / press_key（SendInput；Unicode 文本）。
- 截图：PrintWindow + 黑屏回退 CopyFromScreen。
