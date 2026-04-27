# 言灵 · Language RPG

由大语言模型驱动的中文文字 RPG / 角色扮演游戏。玩家在有限回合内，与"故事模型"与"决策模型"共同演绎一段属于自己的互动小说。

## 运行

### Windows
双击 `start.cmd` 即可（首次会自动 `npm install`）。

### macOS / Linux
```bash
./start.sh
```

启动后打开浏览器访问 http://127.0.0.1:5173 。

## 首次使用

1. 主页点「设置」
2. 选择请求格式：
   - **Chat Completions** — DeepSeek / Moonshot / 通义千问 / OpenAI 本家
   - **Responses** — 走 `/v1/responses` 的 OpenAI 新 API 或 Codex 代理
3. 填入 API Base URL、API Key、故事模型、决策模型
4. 保存后返回主页，点「启程」选一段预设故事开始

## 自定义内容

前往「书库」→「导入」，粘贴 JSON 可导入：故事大纲 / 出身 / 世界书 / 随机事件。Dialog 内有完整示例。

## 技术栈

Vite · React 18 · TypeScript · Tailwind · Zustand · React Router

## 开发

```bash
npm run dev       # 开发服务器
npm run build     # 生产构建
npm run preview   # 预览生产构建
```

## 本地 API 联调测试

```bash
node scripts/test-api.mjs [model]
```

默认用内置常量向 `http://127.0.0.1:8317/v1` 发起流式 + JSON 双重测试。
