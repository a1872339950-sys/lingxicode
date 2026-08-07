# i18n 翻译表模块化结构

## 目录布局

```
frontend/i18n/
├── zh-CN.js              # 中文入口（5 行，re-export 合并结果）
├── en-US.js              # 英文入口（5 行，re-export 合并结果）
└── modules/
    ├── zh/               # 中文按业务模块拆分
    │   ├── common.js
    │   ├── menu.js
    │   ├── ...
    │   └── index.js      # 中文合并器
    └── en/               # 英文按业务模块拆分
        ├── common.js
        ├── menu.js
        ├── ...
        └── index.js      # 英文合并器
```

## 命名空间映射

| 文件 | key 前缀 | 说明 |
|------|-----------|------|
| `common.js` | `common.*` / `app.*` | 通用操作 + 应用标题 |
| `menu.js` | `menu.*` | 顶部菜单栏 |
| `tab.js` | `tab.*` | 多标签栏 |
| `sidebar.js` | `sidebar.*` | 侧栏导航 |
| `settings.js` | `settings.*` | 设置面板 |
| `chat.js` | `chat.*` | 对话界面与消息状态 |
| `project.js` | `project.*` | 项目管理 |
| `model.js` | `model.*` | 模型管理 |
| `tool.js` | `tool.*` | 工具调用块展示 |
| `terminal.js` | `terminal.*` | 终端面板 |
| `editor.js` | `editor.*` | 文件编辑器 |
| `status.js` | `status.*` | 状态栏 |
| `dialog.js` | `dialog.*` / `notify.*` / `auth.*` | 弹窗 / 通知 / 授权 |
| `plan.js` | `plan.*` | 计划弹窗 |
| `music.js` | `music.*` | 音乐工作台 |
| `particle.js` | `particle.*` | 粒子工作台 |
| `prompt.js` | `prompt.*` | 提示词弹窗 |
| `error.js` | `error.*` | 通用错误 |
| `time.js` | `time.*` | 相对时间 |

## 如何新增/修改 key

1. 找到要改的业务模块（按 `key 前缀` 对照上表）
2. 编辑 `modules/zh/<name>.js` 和 `modules/en/<name>.js` 各加一行
3. **不需要** 改 `index.js`（用 `Object.assign({}, ...modules)` 自动合并）
4. 也不需要 改 `zh-CN.js` / `en-US.js` 入口（它们只是 re-export）

## 如何新增语言

1. 在 `modules/<locale>/` 下复制 `en/` 的所有文件，翻译每条
2. 写一个 `modules/<locale>/index.js`，结构与 `en/index.js` 相同
3. 写一个入口文件 `frontend/i18n/<locale>.js`，内容：

   ```js
   import { translations } from './modules/<locale>/index.js';
   export { translations };
   export default translations;
   ```

4. 把 locale 加到 `frontend/scripts/core/i18n.js` 的 `SUPPORTED` 数组
5. 如有 UI 切换选项，在 `settings.language.<locale>` 也加一个条目

## 验证方式

- `node --check` 跑所有模块文件 + 入口文件
- 启动后调用 `i18n.t('chat.send')` 验证能取到字符串
- `i18n.setLocale('en-US')` 后 UI 关键文本应切换为英文
