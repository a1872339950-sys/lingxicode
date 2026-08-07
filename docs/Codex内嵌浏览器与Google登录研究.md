# Codex 桌面端内嵌浏览器与 Google 登录 —— 深度对照研究

> 日期：2026-07-21  
> 对照对象：本机 `OpenAI.Codex 26.715.7063`（Owl 壳，Chromium 150.0.7871.124）  
> 灵犀当前：Electron 43.1.1（Chromium 150.0.7871.114）

## 1. Codex 是什么运行时

| 项 | 结论 |
|----|------|
| 外壳 | 自研 **Owl** Electron 分支（`owl-electron-app.json` / `owl-app.ini`） |
| 引擎 | Chromium **150.0.7871.124**（与现版 Electron 43 同代） |
| 入口 | `package.json` → `.vite/build/early-bootstrap.js` |
| 依赖声明 | `electron: 42.3.0`（打包物为 Owl 运行时，不是 npm 原版 electron） |

## 2. 二进制层：UA 模板差异（根因级）

对 `chrome.dll` / `electron.exe` 字符串扫描：

### stock Electron 43（灵犀）

```
Chrome/150.0.7871.114 Electron/43.1.1
%s/%s Chrome/%s Electron/43.1.1
```

默认 UA **硬编码带 Electron 产品段**。

### Codex Owl chrome.dll

```
Mozilla/5.0 (%s) AppleWebKit/537.36 (KHTML, like Gecko) %s Safari/537.36
Chrome/150.0.7871.124
```

**没有** `Electron/%s` 的 UA 格式串。  
Owl 在 C++ 层就按「普通 Chromium/Chrome」拼 UA，所以页面与请求默认就不带 Electron。

这就是「Codex 不用导入也能登录」的底座：  
**不是前端魔法，是定制壳默认身份已是 Chrome。**

## 3. JS 层：Codex 内嵌浏览器实际做了什么

### 3.1 webview 挂载（`will-attach-webview` / OL / kL）

- `partition = persist:codex-browser-app`（`kx('app')`）
- `sandbox=true`，`contextIsolation=true`，`nodeIntegration=false`
- **删除 preload**（业务 API 不进访客页）
- `allowpopups=""`，`disablePopups: false`（允许真实弹窗）
- **没有** `setUserAgent` / `userAgentFallback` 调用（引擎已干净）

### 3.2 权限（BrowserSession.configure）

```js
setPermissionRequestHandler((_, perm, cb) => {
  cb(perm === 'clipboard-sanitized-write') // 其它全部拒绝
})
```

效果：Google 申请 `publickey-credentials-*` 会被拒 → **不会弹 Windows「未验证 electron.exe + USB 安全密钥」**。

### 3.3 window.open

- 浏览器侧：对 tab 类 disposition 使用 Owl 独有 API  
  `webContents._createWebViewAdoptionLease` **收养真实子 WebContents** 进标签  
  （stock Electron **没有**此 API）
- stock 侧等价实现：`action: 'allow'` + 同 `partition` 的 `BrowserWindow` 弹窗，保证 OAuth cookie 共享

### 3.4 配置导入（增强能力，非唯一路径）

- 原生 binding：`process._linkedBinding('electron_browser_owl_profile_importer')`
- 可从本机 Chrome/Edge 导入 cookies/passwords  
- **用户未点导入也能登录** → 依赖的是 §2 引擎身份 + §3.1–3.3，而不是导入

### 3.5 CDP Emulation

Codex 仅用于：

- 颜色方案 `Emulation.setEmulatedMedia`
- 侧栏尺寸 `Emulation.setDeviceMetricsOverride`

**不做** `setUserAgentOverride` 登录伪装。

## 4. 本机实测（stock Electron 43）

探针脚本：

- `_probe_ua_simple.js`
- `_probe_webview_vs_window.js`

结论：

| 场景 | 结果 |
|------|------|
| BrowserWindow + 去掉 `Electron/x` 的 UA + sec-ch-ua | Google 登录页 **正常**（`blocked:false`） |
| `<webview>` guest + 同上策略 | Google 登录页 **同样正常** |
| 带 CDP debugger 的复杂注入 | 增加不确定性，**非必要** |

成功最小策略：

1. `app.userAgentFallback` / `session.setUserAgent` / `contents.setUserAgent`：剥除 `Electron/*` 与应用名  
2. `webRequest.onBeforeSendHeaders`：强制 `User-Agent` + `sec-ch-ua`（含 `Google Chrome`）  
3. 权限只放行 `clipboard-sanitized-write`  
4. `allowpopups` + 真实 `window.open`（同 partition）  
5. **不要** attach `webContents.debugger` 做登录伪装  

## 5. 灵犀侧应对（已落地方向）

1. Electron 升到 **43**（Chromium 150，与 Codex 同代）  
2. `external-webview-session.js` 改为 **最小可用策略**（对齐探针，去掉 CDP）  
3. webview attach 对齐 Codex：无业务 preload、allowpopups、session 先配置  
4. 权限策略对齐 Codex  
5. `window.open` 允许真实弹窗并共享 `persist:lingxi-external-webview`  
6. （可选）「导入登录」作为增强，不是主路径  

## 6. 与 Codex 仍无法 100% 等价之处

| 能力 | Codex | stock Electron |
|------|-------|----------------|
| 默认 UA 无 Electron | Owl C++ 补丁 | 只能运行时剥离 |
| WebContents 收养进标签 | `_createWebViewAdoptionLease` | 无，用 BrowserWindow 近似 |
| 代码签名 / 系统身份 | MSIX 微软商店签名 | 开发态为 `electron.exe` |
| 配置导入原生解密 | owlProfileImporter | 可用无头 Chrome + CDP 近似 |

开发态若仍偶发系统级 WebAuthn 提示，属于 **进程名为 electron.exe 且未签名**；正式签名安装包会改善，权限拒绝 passkey 可规避大部分场景。

## 7. 验证清单

1. 完全退出灵犀后重启  
2. 新开右侧标签 → 打开 `https://accounts.google.com`  
3. 日志应类似：  
   `[ExternalWebview] ready (minimal Codex-compatible policy)`  
   `[GoogleLoginDiag] { blocked: false, hasElectron: false, title: "登录 - Google 账号" }`  
4. 应出现邮箱/密码框，而不是「此浏览器或应用可能不安全」  
