@echo off
chcp 65001 >nul
setlocal

cd /d "%~dp0"

if not exist "node_modules" (
  echo [言灵] 首次构建，正在安装依赖...
  call npm install
  if errorlevel 1 (
    echo [言灵] npm install 失败。
    pause
    exit /b 1
  )
)

echo.
echo [言灵] 正在构建生产版本...
call npm run build
if errorlevel 1 (
  echo [言灵] 构建失败。
  pause
  exit /b 1
)

echo.
echo [言灵] 构建完成。产物位于 dist/。启动预览：
call npm run preview
