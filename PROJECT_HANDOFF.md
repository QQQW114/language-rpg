# Language RPG 项目接手记录

接手日期：2026-04-27

## 当前状态

- 已初始化 Git 仓库，并创建原始项目快照提交：`23740db chore: initial project snapshot`。
- 已补充接手约定文件：`AGENTS.md`。
- 已补充跨平台换行规则：`.gitattributes`。
- 已执行生产构建验证：`cmd /c npm run build` 通过。

## 项目概览

这是一个纯前端中文文字 RPG。玩家创建旅程后，由两个模型协作推进：

1. 故事模型：按当前设定、历史、背包、NPC、场景、随机事件生成剧情。
2. 决策模型：读取最新剧情，返回下一步选项、道具增减、NPC 关系与可前往场景。

应用数据主要保存在浏览器 `localStorage` 中：

- `lrpg.settings`：API Base、API Key、模型名、温度、历史压缩参数等。
- `lrpg.games`：存档与完整游戏状态。
- `lrpg.content`：用户导入/生成的自定义大纲、出身、世界书、随机事件。

## 核心运行流

入口链路：

- `index.html`
- `src/main.tsx`
- `src/App.tsx`

主要路由：

- `/`：`HomePage`，列出/进入/删除存档。
- `/setup`：`SetupPage`，配置新旅程。
- `/game`：`GamePage`，执行回合循环。
- `/settings`：`SettingsPage`，配置模型 API。
- `/library`：`LibraryPage`，管理内容库。

`GamePage.tsx` 的关键流程：

1. `dispatch()` 根据当前 `phase` 分派任务。
2. `runStory()` 调用 `requestStory()` 流式生成故事，写入 assistant 消息并推进回合。
3. `runChoices()` 调用 `requestChoices()` 生成选择、道具、NPC、场景。
4. 回合结束后可能触发：
   - 随机事件记录。
   - 手动输入阶段。
   - 刷新选项次数发放。
   - 长历史压缩。
   - 终局评分。

## 重要模块

- `src/services/llmClient.ts`
  - `chatStream()`：流式调用。
  - `chatJSON()`：非流式 JSON 调用；Responses 格式下会用流式聚合兜底。
- `src/lib/sse.ts`
  - 解析 Chat Completions 与 Responses 两类 SSE delta。
- `src/services/decisionAgent.ts`
  - 对模型返回 JSON 做选择、道具、NPC、场景清洗。
  - 失败时返回兜底选项。
- `src/store/useGameStore.ts`
  - 游戏状态的唯一主要写入点。
  - 兼容老存档字段补齐。
- `src/services/worldBookMatcher.ts`
  - 用最近上下文和玩家输入进行关键词匹配。
- `src/services/randomEventScheduler.ts`
  - 每回合按概率抽取最多一个随机事件。

## 验证记录

已运行：

```bash
cmd /c npm run build
```

结果：

- TypeScript 检查通过。
- Vite 生产构建通过。
- 输出产物位于 `dist/`，已被 `.gitignore` 排除。

注意：

- 在 PowerShell 里直接运行 `npm run build` 可能因 `npm.ps1` 执行策略失败；使用 `cmd /c npm run build` 正常。
- 在受限沙箱中，Vite/esbuild 子进程可能出现 `spawn EPERM`；需要在允许子进程的环境中构建。

## 已发现的后续关注点

- `scripts/test-api.mjs` 内有本地联调用的内置 API Base 与 Key 常量；建议后续改成环境变量，例如 `LRPG_API_BASE` / `LRPG_API_KEY`。
- 当前没有自动化单元测试；关键纯函数适合补测：
  - `extractJSON`
  - `readSSE` 的 frame 解析
  - `pickRandomEvent`
  - `matchWorldBook`
  - `useGameStore` 的道具 pending/commit 流程
- 模型协议变更风险集中在 prompt 与 sanitizer 不一致；改动时必须成组验证。
- 生产构建通过，但仍需配置真实/本地模型 API 后做浏览器冒烟测试：
  1. 保存设置。
  2. 创建旅程。
  3. 生成一轮故事。
  4. 生成选项。
  5. 测试背包、场景跳转、手动输入和完结评分。

