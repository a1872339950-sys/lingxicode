# 工程健康检查记录

## 当前处理范围

- 已清理 `electron/modules/projects.js` 中的乱码注释、日志和错误提示。
- 已新增 `npm.cmd run check:syntax` 对应的语法检查脚本，用于快速发现 JS 初始化失败、括号错误、导入语法错误等基础问题。
- 已从 `electron/modules/ai-chat.js` 拆出 `electron/modules/model-api-adapter.js`，集中管理模型 API 格式、推理参数、Anthropic/OpenAI 请求体和流式解析。
- 第 2 项“路径/存储策略统一”暂缓，不在本阶段修改。

## 暂缓项

以下内容属于第 2 项，未获得明确开始前不要改：

- `D:\lingxi-dispatches` 等 dispatch 工作目录策略。
- `storage-config` 的基础路径迁移策略。
- 项目资产、缓存、摘要、dispatch 数据的统一存储规则。
- 旧路径兼容、迁移、清理逻辑。

## 当前验证方式

```bash
npm.cmd run check:syntax
```

该命令会扫描：

- `electron/**/*.js`
- `frontend/scripts/**/*.js`

并跳过：

- `node_modules`
- `dist`
- `.git`
- `*.bak`

## 可观测性

已新增 `electron/modules/observability.js`。

当前记录：

- IPC 调用耗时、状态和慢 IPC。
- 工具调用耗时、状态和慢工具。
- AI 请求总耗时、完成/中断/错误/超时状态。
- 主进程内存快照。

前端/调试可调用：

```js
await window.api.getObservabilitySnapshot({ limit: 100 })
await window.api.clearObservability()
```

环境变量：

- `LINGXI_OBSERVABILITY=0`：关闭记录。
- `LINGXI_OBSERVABILITY_MAX_EVENTS=500`：内存事件上限。
- `LINGXI_SLOW_IPC_MS=1500`：慢 IPC 阈值。
- `LINGXI_SLOW_TOOL_MS=5000`：慢工具阈值。
- `LINGXI_SLOW_AI_MS=30000`：慢 AI 请求阈值。

## 后续拆分重点

当前仍然偏大的入口文件：

- `electron/modules/ai-chat.js`
- `electron/modules/tools.js`
- `electron/modules/tools-schema.js`
- `frontend/scripts/app.js`
- `frontend/styles/main.css`

建议后续按功能边界逐步拆分，优先拆：

- AI 对话请求生命周期、工具调用循环、视觉模型、上下文压缩状态。
- 工具 schema、工具执行、工具结果摘要。
- 右侧视图窗口、聊天输入、附件、模型选择、设置页。
- 样式按聊天区、右侧视图、集成市场、工作台、弹窗拆分。

拆分要求：

- 每次只拆一个边界。
- 先搬代码再改行为。
- 每次改完运行 `npm.cmd run check:syntax`。
- 不借拆分顺手改第 2 项路径策略。

## 已拆模块边界

### `electron/modules/model-api-adapter.js`

负责：

- OpenAI/Anthropic API 格式识别。
- 请求 endpoint、headers、body 构建。
- 推理强度参数透传。
- MiniMax M3 / Anthropic 原生思考内容兼容。
- OpenAI/Anthropic 流式事件解析。
- Ollama 本地模型自动停止。

要求：

- 新增模型兼容优先改这里。
- `ai-chat.js` 只保留对话生命周期、上下文、工具循环和 UI 状态推送。
