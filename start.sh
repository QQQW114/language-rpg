#!/usr/bin/env bash
set -e

cd "$(dirname "$0")"

if [ ! -d "node_modules" ]; then
  echo "[言灵] 首次启动，正在安装依赖..."
  npm install
fi

echo ""
echo "[言灵] 正在启动开发服务器..."
echo "[言灵] 启动后在浏览器打开 http://127.0.0.1:5173"
echo "[言灵] 首次使用请先在「设置」中填写 API Base URL 与 API Key。"
echo ""
npm run dev
