@echo off
setlocal EnableExtensions
chcp 65001 >nul
title 灵犀 LingXiCode 开发版

cd /d "%~dp0"
set "STARTUP_LOG=%CD%\startup-error.log"
if exist "%STARTUP_LOG%" del /q "%STARTUP_LOG%" >nul 2>nul

echo.
echo  ========================================
echo       灵犀 LingXiCode 开发版一键启动
echo  ========================================
echo.

if not exist "package.json" goto missing_project

where node >nul 2>nul
if errorlevel 1 goto missing_node

where npm >nul 2>nul
if errorlevel 1 goto missing_npm

for /f "delims=" %%v in ('node --version 2^>nul') do set "NODE_VERSION=%%v"
echo  [环境] Node.js %NODE_VERSION%

if not exist "node_modules\.bin\electron.cmd" goto install_dependencies
if not exist "node_modules\electron\dist\electron.exe" goto install_dependencies
goto launch_app

:install_dependencies
echo  [首次运行] 正在安装依赖，请保持网络连接……
echo  [首次运行] 正在安装依赖。> "%STARTUP_LOG%"
call npm ci
if errorlevel 1 goto install_failed
if not exist "node_modules\.bin\electron.cmd" goto electron_missing
if not exist "node_modules\electron\dist\electron.exe" goto electron_missing

:launch_app
echo  [启动] 正在打开灵犀开发版……
echo  [提示] 可按 Ctrl+Shift+I 打开开发者工具。
echo.
set "ELECTRON_RUN_AS_NODE="
call "node_modules\.bin\electron.cmd" . --devtools
set "APP_EXIT_CODE=%ERRORLEVEL%"
if not "%APP_EXIT_CODE%"=="0" goto app_failed
exit /b 0

:missing_project
echo  [错误] 当前目录不是完整的灵犀源码，缺少 package.json。
echo  缺少 package.json。> "%STARTUP_LOG%"
goto failed

:missing_node
echo  [错误] 没有检测到 Node.js。
echo  请先安装 Node.js 20 或更高版本，再重新双击本文件。
echo  没有检测到 Node.js 20+。> "%STARTUP_LOG%"
goto failed

:missing_npm
echo  [错误] 找到了 Node.js，但没有检测到 npm。
echo  没有检测到 npm。> "%STARTUP_LOG%"
goto failed

:install_failed
echo  [错误] 依赖安装失败，请检查网络、磁盘空间或安全软件限制。
echo  依赖安装失败，请在本目录运行 npm ci 查看详细错误。> "%STARTUP_LOG%"
goto failed

:electron_missing
echo  [错误] 依赖安装完成，但 Electron 主程序不存在。
echo  可能被安全软件删除，或 Electron 下载被网络阻断。
echo  Electron 主程序缺失，检查安全软件和网络。> "%STARTUP_LOG%"
goto failed

:app_failed
echo  [错误] 灵犀启动失败，退出码：%APP_EXIT_CODE%
echo  灵犀启动失败，退出码：%APP_EXIT_CODE%。> "%STARTUP_LOG%"
goto failed

:failed
echo.
echo  错误摘要已写入：%STARTUP_LOG%
echo  按任意键关闭……
pause >nul
exit /b 1

