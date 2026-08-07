# i18n 英文编译 · 后续推进交接文档

> 最近一次更新: 2026-06-08 · 状态: 阶段性收尾, 等候继续推 D 阶段剩余工作

---

## 1. 背景

项目 `灵犀-05` 是 Electron 桌面应用, 主窗口 + 多个子窗口, 前端使用 vanilla JS, 没有任何前端框架. 原始代码全部中文 hardcoded, 不支持英文.

**目标**: 让 zh/en 切换真正工作, 用户能切到英文模式看到英文 UI.

**已完成 3 轮** (A → B → C → D):
- A: 翻译表按业务模块拆分 (44 个文件)
- B: 主窗口 UI 节点 i18n 化 (53 个 data-i18n 节点)
- C: 子窗口 + 弹窗 i18n 化 (~264 个 HTML 节点)
- **D (进行中)**: 业务 JS 文件里的中文字面量提取到 zh/en 翻译表

---

## 2. 当前 zh/en 切换行为 (实诚说)

| 区域 | zh 模式 | en 模式 |
|------|---------|---------|
| 顶栏 / 上下文 / 设置 / 输入区 / 历史 (53 个 HTML 节点) | ✅ 中文 | ✅ 英文 (B 那一轮) |
| 子窗口 / 弹窗 (~264 HTML 节点) | ✅ 中文 | ✅ 英文 (C 那一轮) |
| **业务 JS 里的硬编码中文** | | |
| - 35 个已 i18n 化文件 (B 翻译 715 key) | ✅ 中文 | ✅ 英文 (B) |
| - 35 个已 i18n 化文件 (D 改写 933 key) | ✅ 中文 | ⚠️ **中文 (en val 还没翻译)** |
| - 40 处 `${x}` 模板字符串 (D 没碰) | 中文 hardcoded | 中文 hardcoded |
| - 跨行字符串 (D 没碰) | 中文 hardcoded | 中文 hardcoded |

**用户实际感受**:
- 切到 en 模式, **大部分** UI 英文, **小部分** 仍然是中文
- 切换**不会**报错, 业务功能**正常**

---

## 3. D 阶段已完成 (这一轮)

| 改动 | 数量 | 位置 |
|------|------|------|
| 改写的 JS 文件 | 35 | `frontend/scripts/features/`, `app.js`, `message-copy.js` |
| 改写格式 | `((window.i18n?.t?.('key') ?? '中文原文'))` | 跟 B 那一轮模式完全一致 |
| 新 zh key | 933 | `frontend/i18n/modules/zh/<file>.js` |
| 新 en key | 933 | `frontend/i18n/modules/en/<file>.js` (val 用 zh val 占位) |
| 新建 zh/en 模块 | 13 | `ai_tool_renderer`, `ask_popup`, `attachments`, `chat_history`, `chat_renderer`, `execution_progress_ui`, `file_utils`, `i18n_settings`, `message_copy`, `models`, `project_list`, `projects`, `settings_panel_ui` |
| 新模块 import | 26 处 (13 × 2) | `frontend/i18n/modules/{zh,en}/index.js` |
| Smoke 验证 | ✅ 通过 | consoleErrors=[], pageErrors=[], 142 元素正常 |

### 改写 key 命名规范

```
auto.js_<basename>_<line>_<counter>
```

- `js_` 前缀
- `<basename>` = 文件名去掉 `.js` + 把 `-` 转 `_` (保持和 zh/en 模块文件名一致)
- `<line>` = 中文字符串在源代码里的行号
- `<counter>` = 同一行内第几个中文字符串 (从 1 开始)

示例: `auto.js_quick_model_settings_243_18` → `frontend/scripts/features/quick-model-settings.js` 第 243 行第 18 个中文字符串

### 改写用的核心算法 (保留作参考)

完整 v3 工具 248 行, 之前在 `frontend/scripts/tools/_i18n_rewrite.mjs`, 已按要求删除. 核心思路:

```js
// 1. 逐行扫描, 跳过: 注释行 / log/throw / 含 ${} 的模板字符串 / 跨行字符串
// 2. 找到含中文的字面量, 替换成:
((window.i18n?.t?.('auto.js_xxx_LL_N') ?? '中文原文'))
// 3. 把 (key, val) 写入对应的 modules/zh/<basename>.js
// 4. 在 modules/en/<basename>.js 创建占位 (val = zh val, 让 en 模式 fallback)
// 5. 如果是新模块, 自动 import 到 modules/{zh,en}/index.js
```

**关键安全规则**:
- ❌ 绝不能改 `window.i18n.t('...')` 这种直接调用 (会报 `Cannot read properties of undefined`)
- ❌ 绝不能改含 `${x}` 的模板字符串 (会破坏 JS 语法)
- ❌ 绝不能改 log/throw/comment 里的中文 (调试信息, 不该国际化)
- ✅ 必须用 optional chaining + nullish coalescing (`?.t?.` + `??`)

---

## 4. D 阶段还没做的 (待继续)

### 4.1 40 处 `${x}` 模板字符串 (D 跳过, 等手工拆)

完整清单: `frontend/i18n/handoff/template_strings.txt`

**分布**:
- `app.js`: 15 处 (最大头)
- `core/file-utils.js`: 1 处
- `features/ai-message-ui.js`: 1 处
- `features/ai-tool-renderer.js`: 4 处
- `features/change-session-actions.js`: 3 处
- `features/chat-renderer.js`: 4 处
- `features/context-compression-status.js`: 1 处
- `features/context-visibility.js`: 2 处
- `features/git-panel.js`: 1 处
- `features/plans.js`: 1 处
- `features/quick-model-settings.js`: 2 处
- `features/storage-settings.js`: 3 处
- `message-copy.js`: 1 处
- (注: 之前估算的 178 处是因为 v3 工具 v1/v2 误改后又回退, 实际剩 40 处)

**手工改写模式** (必须用 i18n 的参数化翻译):

```js
// 改写前:
thinkingText.textContent = `正在执行工具 (${currentOpCount}个)...`

// 改写后:
thinkingText.textContent = ((window.i18n?.t?.('auto.js_app_1278_0', { count: currentOpCount }) ?? `正在执行工具 (${currentOpCount}个)...`))

// 在 modules/zh/app.js 加:
'auto.js_app_1278_0': '正在执行工具 ({count}个)...'

// 在 modules/en/app.js 加 (同步翻译):
'auto.js_app_1278_0': 'Running tools ({count})...'
```

**注意**:
- 占位符用 `{name}` 形式 (i18n.t 内部 replace `{name}` → `params[name]`)
- 同一个英文占位符 `{count}` 同时出现在 zh 和 en 表里
- `?? \`...\`` 的 fallback 用**反引号**保持原模板字符串能力

### 4.2 933 个 en key 待翻译

完整清单: `frontend/i18n/handoff/untranslated_keys.txt`

**现状**: zh 表已写入中文, en 表写入的是 zh val 占位 (en 模式 fallback 显示中文)

**怎么翻译**:
1. 直接编辑 `frontend/i18n/modules/en/<file>.js`
2. 把 `'auto.js_xxx_LL_N': '中文'` 改成 `'auto.js_xxx_LL_N': 'English translation'`
3. 模板字符串 key 的英文**保留** `{count}` 等占位符, 例: `'auto.js_app_1278_0': 'Running tools ({count})...'`

**翻译建议顺序**:
- 优先级 1: 聊天 / 输入区 (用户最常看到的): `chat_renderer.js`, `ai_message_ui.js`, `message_copy.js`, `app.js`
- 优先级 2: 设置面板: `settings_panel_ui.js`, `settings_main.js`, `quick_model_settings.js`, `storage_settings.js`, `i18n_settings.js`, `theme_settings.js`
- 优先级 3: 侧栏 / 项目: `models.js`, `project_list.js`, `projects.js`, `skills_main.js`, `plans.js`
- 优先级 4: 工具 / 状态: `git_panel.js`, `change_session_actions.js`, `context_compression_status.js`, `context_visibility.js`, `execution_progress_ui.js`
- 优先级 5: 其他

**翻译后验证**:
1. 启动应用
2. 切到 en 模式 (设置 → 主题设置 或 顶栏语言切换)
3. 重点看 4.1 提到的 13 个高优先级文件
4. 应该看到英文, 不是中文

### 4.3 跨行字符串 (数量小, 没单独统计)

特征: 字面量跨多行, 没法用单行扫描. 例:
```js
const msg = "第一行内容"
          + "第二行内容"
          + "第三行内容";
```

**改写方式**: 每一行单独 i18n 化, 然后用 `+` 拼接. 或用模板字符串整体保留.

---

## 5. 怎么继续推进 (步骤)

### 步骤 1: 补 `${x}` 模板字符串 (40 处)

1. 打开 `frontend/i18n/handoff/template_strings.txt`
2. 按文件顺序处理 (建议从 `app.js` 开始, 15 处)
3. 每处按 4.1 的"手工改写模式"做 3 件事:
   - 改 JS 文件 (用 `((window.i18n?.t?.('...', {params}) ?? \`...\`))`)
   - 在 `modules/zh/<file>.js` 加 key+val (用 `{name}` 占位符)
   - 在 `modules/en/<file>.js` 加 key+英文 val (同步翻译)
4. 每改 5-10 处跑一次 smoke 验证 (别一次全改完)
5. 全部改完后 smoke 验证: `verify_runtime_smoke` 工具 + 在 en 模式实际打开应用

### 步骤 2: 翻译 933 个 en key

1. 打开 `frontend/i18n/handoff/untranslated_keys.txt`
2. 按 4.2 的优先级顺序处理
3. 在 `frontend/i18n/modules/en/<file>.js` 里把 `'auto.js_xxx_LL_N': '中文'` → `'auto.js_xxx_LL_N': 'English translation'`
4. 模板字符串 key 的英文**保留** `{name}` 占位符
5. 每翻译完一个文件跑一次 smoke 验证

### 步骤 3: 全量验证

1. 启动应用, 切到 en 模式
2. 走完所有功能流程 (新建项目 / 发消息 / 设置切换 / 工具调用)
3. 找遗漏的中文
4. 用 i18n 未绑定扫描工具 (4.4 描述) 查剩余中文

### 步骤 4: 处理跨行字符串

如果有跨行中文 hardcoded, 单独处理.

### 步骤 5: 清理

i18n 工程完成后:
- 删除 `frontend/i18n/handoff/` 下的清单文件 (临时资产)
- 删除 `frontend/i18n/HANDOFF.md` (本文档)
- 保留 `frontend/i18n/modules/{zh,en}/*` (核心翻译表)
- 保留 `frontend/i18n/zh-CN.js` (zh 兜底)
- 保留 `frontend/i18n/en-US.js` (en 入口)
- 保留 `frontend/i18n/i18n.js` (i18n 框架)

---

## 6. 文件结构

```
frontend/i18n/
├── HANDOFF.md                    ← 本文档 (完成后删除)
├── handoff/                      ← 临时清单 (完成后删除)
│   ├── template_strings.txt      ← 40 处 ${x} 模板字符串
│   ├── rewritten_files.txt       ← 35 个改写过的文件
│   ├── en_modules_stats.txt      ← 61 个 en 模块 + key 数
│   └── untranslated_keys.txt     ← 933 个未翻译 en key
├── zh-CN.js                      ← zh 兜底 (FALLBACK 常量指向这个)
├── en-US.js                      ← en 主表
├── i18n.js                       ← i18n 框架 (locales, t, applyI18n)
├── index.js                      ← 主入口
└── modules/
    ├── zh/                       ← 64 个 zh 模块 (61 原有 + 13 新建 - 10 重名)
    │   ├── common.js / menu.js / ...  (61 个老模块, B 那一轮建)
    │   └── <13 新模块>.js         (D 这一轮新建)
    └── en/                       ← 64 个 en 模块 (结构跟 zh 对称)
```

---

## 7. 关键技术细节

### 7.1 i18n 框架入口

`frontend/scripts/core/i18n.js` 是 `<script type="module">`, 异步加载. 业务 JS 是普通 `<script>`, 同步执行. **所以** 业务 JS 跑的时候 `window.i18n` 还没初始化. 必须用 `((window.i18n?.t?.('...') ?? '...'))` 模式, 让 fallback 在 i18n 加载前/加载失败时显示原文.

### 7.2 FALLBACK 机制

`i18n.js` 里 `FALLBACK = 'zh-CN'`. 调用 `t(key)` 时:
1. 先查 `this.translations[this.locale][key]`
2. 没有 → 查 `this.translations[FALLBACK][key]` (= zh 表)
3. 还没有 → 返回 key 本身

**利用这个机制**: D 这一轮把 en 表 val 写成 zh val, en 模式找不到 key 时**自动** fallback 到 zh 表, 也能显示中文. 不会显示 `auto.js_xxx_LL_N` 这种 key 字面.

### 7.3 参数化翻译

`i18n.t(key, params)`:
- val 里写 `{name}` 占位符
- 调用时传 `{ name: value }`
- 内部 replace `{name}` → value

例: `t('auto.js_app_1278_0', { count: 5 })` + val `'正在执行工具 ({count}个)...'` → `'正在执行工具 (5个)...'`

### 7.4 数据流

```
用户操作 → 业务 JS 调用 window.i18n.t('key') →
  i18n 加载完 → 查 en/zh 表 → 替换占位符 → 返回翻译文本 → UI 渲染
  i18n 没加载 → 走 ?? 后面的 fallback (原中文) → UI 渲染
```

---

## 8. 注意事项

1. **不要**用 `window.i18n.t('...')` 直接调用, **必须**用 `((window.i18n?.t?.('...') ?? '...'))` 形式
2. **不要**翻译 log/throw/comment 里的中文 (调试信息)
3. **不要**翻译数据库字段 / API 路径 / 协议字段名 (技术字符串)
4. **不要**翻译 HTML 里 `<option value="...">` 的音源名 (钢琴/小提琴 这些是乐器的真名, 中文英文不是翻译关系, 是两种不同语言的两个名字)
5. **保留**所有 `${x}` 模板字符串里的 `${x}` 部分, 只把静态中文字面量提取
6. **保留** zh 表里 `{name}` 占位符的命名, 跟 JS 调用时传的 `params.name` 一致
7. **不要** 删 zh 表的 key, 否则 en 模式 fallback 不到中文, 会显示 `auto.js_xxx_LL_N` 这种 key 字面

---

## 9. 完成判定

D 阶段完整完成的标志:
- [ ] 40 处 `${x}` 模板字符串全部 i18n 化
- [ ] 933 个 en key 全部翻译
- [ ] 跨行字符串全部 i18n 化
- [ ] en 模式下走完所有功能流程, 无中文残留
- [ ] smoke 验证通过
- [ ] 清理临时文件 (handoff/ + HANDOFF.md)

---

## 10. 联系人 / 工具

- 之前的 v3 改写工具代码 (已删): 思路见 §3
- Smoke 验证: `verify_runtime_smoke` 工具, 传 `html_path=frontend/index.html`
- 截图: `capture_screenshot` 工具, 传 `html_path` 或 `url`

**有任何不确定, 优先回查 git log 看历史改动, 不要靠印象猜.**
