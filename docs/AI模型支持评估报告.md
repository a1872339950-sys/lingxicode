# 灵犀 LingXiCode AI模型支持评估报告

**审查日期**: 2026年1月
**项目路径**: `<项目目录>`
**审查范围**: AI对话和模型支持

---

## 一、整体架构评估

### 1.1 核心模块架构

| 模块文件 | 功能职责 | 代码行数 |
|---------|---------|---------|
| `ai-chat.js` | AI对话核心处理 | ~600行 |
| `ai-laboratory.js` | 多AI实验室讨论 | ~80行 |
| `config.js` | 全局配置管理 | ~80行 |
| `storage-config.js` | 存储路径配置 | ~200行 |
| `tools-schema.js` | 工具Schema定义 | ~150行 |
| `projects.js` | 项目实例管理 | ~500行 |

### 1.2 技术栈

- **后端**: Electron (Node.js)
- **前端**: 纯HTML/CSS/JS（无Vue/React）
- **API协议**: OpenAI Chat Completions API（兼容格式）

---

## 二、AI模型支持评估

### 2.1 支持的模型类型

#### ✅ 已支持的模型架构

| 类型 | 支持状态 | 说明 |
|-----|---------|-----|
| OpenAI GPT系列 | ✅ 完全支持 | 使用标准API格式 |
| Anthropic Claude | ⚠️ 需适配 | 需修改消息格式（Claude格式不同） |
| 国产大模型 | ✅ 兼容支持 | 通过配置兼容OpenAI API的服务 |

#### 国产模型兼容性详情

| 模型 | API兼容性 | 配置示例 |
|-----|---------|---------|
| **智谱AI GLM** | ✅ OpenAI兼容 | `apiUrl: https://open.bigmodel.cn/api/paas/v4` |
| **月之暗面 Kimi** | ✅ OpenAI兼容 | `apiUrl: https://api.moonshot.cn/v1` |
| **阿里云通义千问** | ✅ OpenAI兼容 | `apiUrl: https://dashscope.aliyuncs.com/compatible-mode/v1` |
| **百度文心一言** | ⚠️ 需适配 | 需使用兼容模式或修改请求格式 |
| **腾讯混元** | ✅ OpenAI兼容 | 使用腾讯云兼容API |
| **DeepSeek** | ✅ 完全支持 | 支持Reasoner思考模式 |
| **百川智能** | ✅ OpenAI兼容 | 标准API格式 |
| **MiniMax** | ✅ OpenAI兼容 | 海螺AI API |

### 2.2 模型配置机制

#### 前端配置存储 (localStorage)

```javascript
// 模型配置结构
{
  modelName: 'Kimi K2.6',    // 显示名称
  modelId: 'moonshot-v1-8k', // API调用ID
  apiUrl: 'https://api.moonshot.cn/v1',
  apiKey: 'sk-xxx...'
}

// 存储方式
savedModels = JSON.parse(localStorage.getItem('savedModels'))
currentModelIndex = parseInt(localStorage.getItem('currentModelIndex'))
```

#### 多模型管理能力

| 功能 | 支持状态 | 实现方式 |
|-----|---------|---------|
| 添加模型 | ✅ | 设置面板新增 |
| 编辑模型 | ✅ | 编辑后保存 |
| 删除模型 | ✅ | 确认后删除 |
| 模型排序 | ✅ | 拖拽排序 |
| 切换模型 | ✅ | 项目级切换 |
| 模型锁定 | ✅ | URL/Key锁定功能 |

---

## 三、对话流程分析

### 3.1 消息格式

遵循 **OpenAI Chat Completions API** 标准格式：

```javascript
const messages = [
  { role: 'system', content: systemPrompt },
  { role: 'user', content: '用户消息' },
  { role: 'assistant', content: 'AI回复', tool_calls: [...] },
  { role: 'tool', tool_call_id: 'xxx', content: '工具结果' }
]
```

### 3.2 流式输出机制

```javascript
// 流式请求配置
fetch(apiEndpoint, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${apiKey}`,
    'Accept': 'text/event-stream'
  },
  body: JSON.stringify({
    model: modelId,
    messages,
    tools: TOOLS_SCHEMA,
    stream: true  // 启用流式
  })
})

// 流式事件处理
- delta.content → 正文内容（实时显示）
- delta.reasoning_content → 思考内容（CoT模型）
- delta.tool_calls → 工具调用（累积）
```

### 3.3 工具调用循环

```
用户消息 → AI思考 → 返回工具调用 → 执行工具 → 工具结果返回 → AI继续 → 最终回复
                    ↑____________________循环最多20轮____________________↓
```

---

## 四、系统提示构建

### 4.1 getSystemPrompt() 函数分析

```javascript
function getSystemPrompt(executionMode, projectPath, agentMode) {
  return `
当前时间：2026年1月X日 星期X HH:MM
当前项目路径：${projectPath}

===== 重要：路径处理规则 =====
- 用户明确指定路径优先使用
- 相对路径基于项目路径解析

===== 智能执行模式系统 =====
1. Normal模式 - 直接回答
2. Plan模式 - 制定计划
3. Auto模式 - 自动执行

【用户设置的执行模式：自动执行】
直接执行所有步骤，无需询问

【Agent多任务模式】（可选启用）
- dispatch_sub_agent: 调度子Agent
- 必须提供 context 参数
  `
}
```

### 4.2 技能注入机制

```javascript
// 技能内容注入到系统提示
if (skillContent) {
  systemPrompt += `
===== 当前技能模式 =====
${skillContent}
  `
}
```

### 4.3 上下文管理

| 机制 | 实现状态 | 说明 |
|-----|---------|-----|
| 消息历史 | ✅ | messagesHistory数组 |
| 上下文压缩 | ✅ | 工具结果摘要化 |
| Token估算 | ✅ | estimateHistoryTokens() |
| 自动分割 | ✅ | checkAutoSplit() |
| 可见性边界 | ✅ | 滑动窗口机制 |

---

## 五、工具调用系统

### 5.1 已定义工具 (17个)

| 工具名 | 功能 | 类别 |
|-------|------|-----|
| `browser_search` | 搜索引擎搜索 | 浏览器 |
| `browser_fetch` | 获取网页内容 | 浏览器 |
| `browser_open` | 打开网页 | 浏览器 |
| `read_file` | 读取文件 | 文件操作 |
| `write_file` | 写入文件 | 文件操作 |
| `edit_file` | 编辑文件 | 文件操作 |
| `create_directory` | 创建目录 | 文件操作 |
| `delete_file` | 删除文件 | 文件操作 |
| `list_files` | 列出文件 | 文件操作 |
| `run_command` | 执行命令 | 命令执行 |
| `dispatch_sub_agent` | 调度子Agent | Agent系统 |
| `enter_plan_mode` | 进入计划模式 | 执行控制 |
| `ask_user_choice` | 询问用户选择 | 执行控制 |
| `confirm_plan` | 确认计划 | 执行控制 |
| `enter_auto_mode` | 进入自动执行 | 执行控制 |
| `ask_step_confirm` | 步骤确认 | 执行控制 |
| `complete_step` | 完成步骤 | 执行控制 |
| `recall_history` | 查询历史对话 | 记忆系统 |

### 5.2 工具执行流程

```javascript
// 并行执行所有工具调用
const toolPromises = toolCallsData.map(async (tc) => {
  const result = await executeToolForProject(
    toolName, toolArgs, projectPath, 
    resolvePath, contextManager, projectId, modelConfig
  )
  return { tc, toolName, toolArgs, result }
})

// 结果摘要化（减少上下文膨胀）
const summaryResult = summarizeToolResult(toolName, result)
```

---

## 六、多模型动态切换

### 6.1 项目级模型管理

```javascript
// 每个项目独立持有模型索引
project = {
  id: 'project-xxx',
  modelIndex: 0,      // 当前使用的模型索引
  history: [],        // 对话历史（跨模型共享）
  ...
}

// 切换模型时不清空历史
function useModel(index) {
  currentModelIndex = index
  project.modelIndex = index
  // 不清空历史，新模型可以看到之前的对话
}
```

### 6.2 AI实验室多模型讨论

```javascript
// AI实验室支持多个AI同时讨论
laboratoryState.participants = [
  { modelIndex: 0, name: '专家A', identity: '...' },
  { modelIndex: 1, name: '专家B', identity: '...' },
  { modelIndex: 2, name: '专家C', identity: '...' }
]

// 每个参与者使用不同模型配置
const modelConfig = savedModelsLab[participant.modelIndex]
```

---

## 七、API密钥管理

### 7.1 当前安全机制

| 机制 | 状态 | 说明 |
|-----|------|-----|
| 本地存储 | ✅ | localStorage持久化 |
| 密码隐藏 | ✅ | input type="password" |
| 显示/隐藏 | ✅ | keyToggle按钮 |
| 加密存储 | ❌ | **未实现** - 存在安全风险 |

### 7.2 安全改进建议

```javascript
// 建议实现：使用Electron安全存储
const safeStorage = require('electron').safeStorage

// 加密API Key
async function encryptApiKey(key) {
  if (safeStorage.isEncryptionAvailable()) {
    return safeStorage.encryptString(key)
  }
}

// 解密API Key
async function decryptApiKey(encrypted) {
  if (safeStorage.isEncryptionAvailable()) {
    return safeStorage.decryptString(encrypted)
  }
}
```

---

## 八、国产模型适配建议

### 8.1 完全兼容的国产模型（推荐）

| 优先级 | 模型 | API端点 | 模型ID示例 |
|-------|-----|---------|----------|
| 🥇 | DeepSeek | api.deepseek.com | deepseek-chat, deepseek-reasoner |
| 🥇 | 智谱GLM | open.bigmodel.cn | glm-4, glm-4-flash |
| 🥇 | Kimi | api.moonshot.cn | moonshot-v1-8k |
| 🥈 | 通义千问 | dashscope.aliyuncs.com | qwen-turbo, qwen-plus |
| 🥈 | 百川 | api.baichuan-ai.com | Baichuan2-Turbo |

### 8.2 需适配的国产模型

| 模型 | 适配方案 | 工作量 |
|-----|---------|-------|
| 百度文心 | 使用兼容模式或修改请求格式 | 中等 |
| 腾讯混元 | 使用腾讯云OpenAI兼容API | 低 |

### 8.3 模型能力对比

| 能力 | DeepSeek | GLM-4 | Kimi | GPT-4 |
|-----|---------|-------|------|-------|
| 工具调用 | ✅ | ✅ | ✅ | ✅ |
| 流式输出 | ✅ | ✅ | ✅ | ✅ |
| 思考链(CoT) | ✅ Reasoner | ⚠️ 部分 | ❌ | ✅ o1 |
| 长上下文 | 64K | 128K | 200K | 128K |
| 价格 | 💰低 | 💰低 | 💰中 | 💰高 |

---

## 九、问题与改进建议

### 9.1 发现的问题

| 问题 | 严重程度 | 影响 |
|-----|---------|-----|
| API Key未加密存储 | ⚠️ 高 | 安全风险 |
| 无模型预设配置 | ⚠️ 中 | 用户配置负担 |
| Claude格式不兼容 | ⚠️ 低 | 限制模型选择 |
| 无模型能力检测 | ⚠️ 低 | 可能调用失败 |

### 9.2 改进建议

#### 优先级排序

| 优先级 | 建议 | 实现方案 |
|-------|-----|---------|
| P0 | API Key加密存储 | 使用Electron safeStorage |
| P1 | 预置国产模型配置 | 提供快速配置模板 |
| P2 | 模型能力检测 | 调用前检测工具调用支持 |
| P3 | Claude适配 | 消息格式转换层 |

#### 预置模型配置示例

```javascript
// 建议添加：国产模型快速配置模板
const PRESET_MODELS = [
  {
    name: 'DeepSeek Chat',
    modelId: 'deepseek-chat',
    apiUrl: 'https://api.deepseek.com',
    description: '性价比高，支持工具调用'
  },
  {
    name: '智谱GLM-4',
    modelId: 'glm-4',
    apiUrl: 'https://open.bigmodel.cn/api/paas/v4',
    description: '国产领先，128K上下文'
  },
  {
    name: 'Kimi K2.6',
    modelId: 'moonshot-v1-128k',
    apiUrl: 'https://api.moonshot.cn/v1',
    description: '超长上下文200K'
  }
]
```

---

## 十、总结

### 10.1 整体评价

| 维度 | 评分 | 说明 |
|-----|------|-----|
| 模型兼容性 | ⭐⭐⭐⭐ | OpenAI兼容模型全面支持 |
| 国产模型支持 | ⭐⭐⭐ | 需用户手动配置，无预置 |
| 对话流程 | ⭐⭐⭐⭐⭐ | 流式输出完善，工具循环稳定 |
| 系统提示 | ⭐⭐⭐⭐ | 动态构建，支持技能注入 |
| 工具调用 | ⭐⭐⭐⭐⭐ | 17个工具，完整Schema |
| 安全性 | ⭐⭐ | API Key明文存储，需改进 |

### 10.2 核心优势

1. **完善的流式输出**: 支持正文流式 + 思考流式 + 工具调用流式
2. **强大的工具系统**: 17个工具覆盖文件、命令、浏览器、Agent调度
3. **智能执行系统**: Plan/Auto/Ask三种模式，灵活控制
4. **多项目隔离**: 每个项目独立上下文和模型配置
5. **AI实验室**: 支持多AI同时讨论，适合决策分析

### 10.3 主要短板

1. **安全存储缺失**: API Key使用localStorage明文存储
2. **国产模型预置缺失**: 用户需手动配置国产模型
3. **Claude不兼容**: Anthropic模型需适配层

### 10.4 推荐国产模型配置

**最佳选择**: DeepSeek + 智谱GLM-4 + Kimi 组合
- DeepSeek: 日常开发（价格低，工具调用完善）
- GLM-4: 长文档分析（128K上下文）
- Kimi: 超长对话（200K上下文）

---

**报告完成**
