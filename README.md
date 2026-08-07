# 灵犀 LingXiCode

灵犀是一个基于 Electron 的桌面 AI 工作空间，提供多模型配置、项目会话、工具调用、上下文管理、资源中心和本地开发辅助能力。

本仓库是面向公开协作整理的源码版本，不包含灵犀托管账号、内置云端模型额度、用户聊天记录、项目数据或私人配置。模型服务需要由使用者自行配置。

## 功能概览

- 多模型与多项目会话
- 本地文件、终端、浏览器和桌面工具
- Token 用量与上下文压缩状态
- Skill、MCP 和插件扩展
- 图片、音频、视频与可视化内容
- Windows 自研安装器源码

## 环境要求

- Windows 10 或 Windows 11
- Node.js 20 或更高版本
- npm 10 或更高版本
- Git

部分桌面控制、Office、Blender 或自研安装器能力需要对应的本机软件。未安装这些软件不会影响基础聊天界面启动。

## 本地运行

Windows 用户可以直接双击：

```text
一键启动开发版.bat
```

脚本会检查 Node.js 和 Electron。首次运行会自动执行 `npm ci`；如果启动失败，窗口不会立即消失，并会在项目根目录生成 `startup-error.log`。

也可以使用命令行：

```powershell
git clone <your-repository-url>
cd lingxi-lingxicode
npm ci
npm start
```

模型配置在应用设置中完成。不要把 API Key 写入源码或提交到 Git。

## 代码检查

```powershell
npm run check
npm run test:scenarios
```

场景测试可能创建临时目录；这些目录已通过 `.gitignore` 排除。

## 普通打包

```powershell
npm run pack
```

默认输出到项目根目录的 `dist/`。

## 自研安装器

```powershell
npm run dist:self
```

默认临时产物写入 `.installer-build/`。也可以指定外部目录，避免让项目目录膨胀：

```powershell
$env:LINGXI_INSTALLER_OUTPUT = 'E:\LingXiBuild'
npm run dist:self
```

安装器还需要 .NET Framework 编译器和 WebView2 程序集。如果 WebView2 不在脚本的默认检测位置，可设置：

```powershell
$env:LINGXI_WEBVIEW2_DIR = 'D:\path\to\WebView2\assemblies'
$env:LINGXI_WEBVIEW2_LOADER = 'D:\path\to\WebView2Loader.dll'
npm run dist:self
```

## 本地数据

运行后产生的数据默认属于用户本机数据，不应提交：

- `data/`：项目、会话、摘要、Token 用量和生成资源
- `.lingxi/`：运行时备忘录与可视化
- `change-sessions/`：改动会话
- `output/`：生成输出
- `config/*.json`：本机配置；示例配置除外

提交代码前建议执行：

```powershell
git status --short
git grep -n -E 'sk-[A-Za-z0-9_-]{20,}'
```

## 云端模型说明

公开版不提供灵犀账号、共享号池、免费额度或模型反向代理。用户需要使用自己有权使用的模型服务与密钥，并遵守对应服务商条款。

设置中的 Token 用量页面只统计当前设备产生的用量，不会上传或附带真实统计数据进入仓库。

## 插件与第三方内容

公开版没有附带许可不明确或限制再分发的组件。第三方依赖和素材的归属见 `THIRD_PARTY_NOTICES.md`。

新增插件或素材前，请确认许可证允许源码公开和二进制再分发。

## 安全

发现安全问题时，请不要在公开 Issue 中粘贴密钥、聊天记录或本机路径。处理方式见 `SECURITY.md`。

## 参与贡献

提交变更前请阅读 `CONTRIBUTING.md`。提交内容即表示你有权按照本项目许可证提供这些代码或资源。

## 许可证

项目源码使用 Apache License 2.0，详见 `LICENSE`。

商标、品牌名称和第三方资源不因源码许可证自动获得授权。
