# Frontend Script Layout

当前拆分采用兼容旧代码的普通 `<script>` 加载方式，暂不切换到 ES modules，避免影响 Electron 本地页面加载和现有全局函数调用。

## 当前结构

- `app.js`：主应用逻辑，仍包含聊天、项目、文件、webview、Git、设置等大部分功能。
- `core/monaco.js`：Monaco 初始化、编辑器实例表、语言识别。
- `core/file-utils.js`：浏览器文件读取、base64 读取、文件大小格式化。
- `agent-ui.js`：子 Agent 状态面板。
- `message-copy.js`：消息复制按钮。

## 后续建议拆分顺序

1. `features/models.js`：模型配置、模型下拉、API 配置持久化。
2. `features/projects.js`：项目列表、项目切换、项目持久化。
3. `features/chat.js`：消息发送、中断、历史恢复、消息渲染。
4. `features/files.js`：文件上传、文件标签、HTML 预览、保存。
5. `features/webview-panel.js`：右侧网页标签、分离窗口、webview 事件。
6. `features/execution-mode.js`：执行模式选择、询问弹窗、进度显示。
7. `features/git-panel.js`：Git 状态、提交、分支、历史、diff。
8. `features/context-panel.js`：上下文状态、token 面板、清空上下文。

每拆一个模块都应保持外部脚本加载顺序稳定，并运行 `node --check` 和 `npm.cmd run pack`。
