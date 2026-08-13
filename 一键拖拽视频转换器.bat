@echo off
chcp 65001 > nul
setlocal enabledelayedexpansion

title 透明视频转换器 (拖拽专用)

if "%~1" == "" (
    echo ===================================================
    echo             透明视频转换器 (拖拽专用)
    echo ===================================================
    echo.
    echo ❌ 错误：未检测到输入视频！
    echo.
    echo 👉 使用方法：
    echo    直接将录制好的 WebM 视频（如 .webm 文件）
    echo    拖拽移动到这个【一键拖拽视频转换器.bat】图标上释放即可。
    echo.
    echo ===================================================
    pause
    exit /b
)

echo ⏳ 正在检测环境依赖，请稍候...

:: 检查 node 是否安装
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo ❌ 错误：本机未检测到 Node.js 环境，请先安装 Node.js！
    echo 官网下载地址: https://nodejs.org/
    pause
    exit /b
)

:: 检查 node_modules 是否安装，没有则自动安装
if not exist "%~dp0node_modules" (
    echo ⚠️ 首次运行检测到依赖未安装，正在自动执行 npm install，请稍等（约需半分钟）...
    cd /d "%~dp0"
    call npm install
)

echo 🚀 正在转换视频: %~nx1
echo 📂 视频路径: %~1
echo.

cd /d "%~dp0"
node convert.mjs "%~1"

echo.
echo ===================================================
echo  ✅ 转换结束！
echo  📂 输出的视频文件已保存在源视频同级目录下。
echo ===================================================
echo.
pause