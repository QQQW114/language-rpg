@echo off
chcp 65001 >nul
setlocal

cd /d "%~dp0"

if not exist "node_modules" (
  echo [言灵] 首次启动，正在安装依赖...
  call npm install
  if errorlevel 1 (
    echo.
    echo [言灵] npm install 失败，请检查网络或 Node.js 版本（需 ^>=18）。
    pause
    exit /b 1
  )
)

echo.
echo [言灵] 正在启动开发服务器...
echo [言灵] 启动后在浏览器打开 http://127.0.0.1:5173
echo [言灵] 首次使用请先在「设置」中填写 API Base URL 与 API Key。
echo.
call npm run dev
