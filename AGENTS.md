# 项目接手约定

本项目是 `language-rpg`：一个由大语言模型驱动的中文文字 RPG / 互动小说前端。

## 技术栈与运行

- Vite + React 18 + TypeScript + Tailwind CSS。
- 状态管理使用 Zustand，并通过 `persist` 写入浏览器 `localStorage`。
- 路由入口：`src/App.tsx`。
- 主入口：`src/main.tsx`。
- 常用命令：
  - `cmd /c npm run build`：类型检查 + 生产构建。
  - `cmd /c npm run dev`：本地开发服务器，默认 `http://127.0.0.1:5173`。
  - PowerShell 环境中直接执行 `npm` 可能被执行策略拦截，优先使用 `cmd /c npm ...`。

## 代码组织

- `src/pages/`：页面级流程。
  - `HomePage.tsx`：存档入口。
  - `SetupPage.tsx`：新旅程配置、随机生成大纲/出身/事件/世界书。
  - `GamePage.tsx`：核心回合循环。
  - `SettingsPage.tsx`：API 与模型设置。
  - `LibraryPage.tsx`：预设与自定义内容管理。
- `src/store/`：
  - `useGameStore.ts`：存档、回合状态、背包、NPC、场景、记忆锚点。
  - `useContentStore.ts`：预设 + 自定义内容合并。
  - `useSettingsStore.ts`：LLM 配置。
- `src/services/`：模型调用与游戏服务。
  - `llmClient.ts` 同时支持 Chat Completions 与 Responses。
  - `storyAgent.ts` 负责流式故事生成。
  - `decisionAgent.ts` 负责选项、道具、NPC、场景 JSON。
  - `contextCompressor.ts` 负责长历史摘要。
  - `randomizers.ts` 负责随机内容生成。
- `src/prompts/`：系统提示词与 prompt 拼装。
- `src/presets/`：内置故事大纲、出身、世界书、随机事件。

## 开发注意事项

- 不要提交 `.env`、`dist/`、`node_modules/` 或真实 API Key。
- `scripts/test-api.mjs` 是本地代理联调脚本；若要长期使用，建议改成从环境变量读取 API Base 和 Key。
- 修改核心回合逻辑时，优先跟踪 `GamePage.tsx` 中的 `runStory`、`runChoices`、`dispatch` 三段。
- 修改模型输出协议时，需要同步更新：
  - prompt：`src/prompts/*`
  - 清洗/兜底：`src/services/*`
  - 类型定义：`src/types/*`
  - UI 展示：`src/components/*`
- 构建通过不代表模型链路通过；模型链路需要配置 API 后做浏览器端手动冒烟测试。

