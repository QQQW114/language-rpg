# 项目接手约定

`language-rpg`（言灵 · Language RPG）：纯前端、双模型驱动的中文文字 RPG / 互动小说。
**当前主线是 V2 命运驱动链路。** 旧多 Agent 版本（V1）的代码已在清理中移除，本文件只描述当前真实结构。

## 技术栈与运行

- Vite 5 + React 18 + TypeScript 5 + Tailwind CSS 3，状态管理 Zustand 4。
- 无后端、无数据库：所有状态在浏览器本地存储（见下）。
- 常用命令：

```bash
cmd /c npm run build      # tsc --noEmit + vite build（生产构建，必须通过）
cmd /c npm run dev        # 开发服务器，默认 http://127.0.0.1:5173
cmd /c npm test           # 单元测试（esbuild 打包 + node:test）
cmd /c npm run test:story # 故事链路脚本测试（无 Key 时自动 dry-run）
cmd /c npm run test:patch # Patch/命运状态回归测试
```

- 只跑部分单元测试：`node scripts/run-unit-tests.mjs --filter=patch`；复用上次产物：`--no-build`。
- 单元测试位于 `tests/`，约定见 [`tests/README.md`](tests/README.md)，全部离线（模型调用 mock `fetch`）。
- PowerShell 里直接敲 `npm` 可能被执行策略拦截（`npm.ps1`），优先用 `cmd /c npm ...`。
- Windows 上一键脚本：`start.cmd`（开发）、`build.cmd`（构建 + preview）。

## 代码结构（当前真实布局）

```text
src/
  main.tsx / App.tsx          入口与路由表
  v2/                         游戏主链路（唯一回合引擎）
    engine.ts                 三阶段提示词、工具、回合执行 runTurnV2
    patch.ts                  写后 Patch 校验与状态提交 commitTurnPatchV2
    types.ts                  GameStateV2 / TurnPatchV2 / 活动流类型
    store.ts                  V2 存档（persist -> lrpg.v2）
    GamePage.tsx / SetupPage.tsx / HomePage.tsx / WorkshopPage.tsx
    workshop/                 命运工坊编辑器与校验（model.ts）
  services/llmClient.ts       模型调用（Chat Completions / Responses、工具循环、JSON 回退）
  lib/                        sse 解析、思考链处理、内容库校验、token 用量、通用工具
  store/                      useContentStore（自定义内容）、useSettingsStore（模型设置）
  types/                      content / settings / llm / ledger 类型
  presets/                    内置大纲、出身、世界书
  pages/SettingsPage.tsx      设置页（V1 目录下唯一存活的页面）
  components/                 UI 基础件：ui/*、TextStarfield、RoundProgress
```

## 路由

| 路由 | 文件 | 说明 |
|---|---|---|
| `/` | `src/v2/HomePage.tsx` | 主页与存档列表 |
| `/setup` | `src/v2/SetupPage.tsx` | 启程：故事 → 出身 → 设定 |
| `/game` | `src/v2/GamePage.tsx` | 核心回合界面 |
| `/workshop` | `src/v2/WorkshopPage.tsx` | 命运工坊（故事与世界书） |
| `/settings` | `src/pages/SettingsPage.tsx` | 模型与连接设置 |
| `/library` | 重定向到 `/workshop` | 旧书库入口，仅为兼容旧书签保留 |

## 浏览器存储键

| 键 | 写入方 | 内容 |
|---|---|---|
| `lrpg.v2` | `src/v2/store.ts` | 存档 `SaveV2`、`GameStateV2`、最近回合回退点 |
| `lrpg.settings.v2` | `src/store/useSettingsStore.ts` | API、模型、上下文预算、注入、输入视角 |
| `lrpg.content` | `src/store/useContentStore.ts` | 自定义大纲 / 出身 / 世界书（persist version 3） |

## 核心回合链路

```text
写前规划 planner_pre → 故事正文 story → 写后结算 planner_post → 程序提交 patch.ts
```

- 入口是 `runTurnV2()`（`src/v2/engine.ts`），**不要在别处新增回合逻辑**。
- 解析失败直接抛错，不静默提交空补丁；`finish_reason` 为 `length`/`content_filter` 同样抛错。
- 权威状态在程序侧：模型只输出增量 Patch，由 `commitTurnPatchV2` 校验后合并。
- 提交有两道 CAS 守卫：`patch.baseRevision` 必须等于当前 `revision`；前端 `commitSuccessfulTurn` 再比对一次 revision/turn。

修改模型输出协议时，必须**成组**同步这四处：

1. 提示词与输出模板：`src/v2/engine.ts`（`buildPlannerPreSystem` / `buildStorySystem` / `buildPlannerPostSystem` / `postShape`）
2. 类型：`src/v2/types.ts`（`TurnPatchV2`、`GameStateV2`）
3. 清洗与提交：`src/v2/patch.ts`
4. UI 展示：`src/v2/GamePage.tsx`

## 开发注意事项

- **不要收窄 `tsconfig.json` 的 `include`**。历史上它只列了 4 个路径，导致被排除的文件在无类型保护的情况下腐坏（`src/types/game.ts` 被删除后仍被十余个文件 import 而无人察觉）。现在 include 是 `["src"]`。
- 删除模块前先做一次反向引用检查（全仓库搜索模块名），再跑 `npx tsc --noEmit` 确认没有悬空引用。
- `src/lib/sse.ts` 与 `llmClient.ts` 是供应商差异的集中点：新增兼容分支时优先放这里，不要污染 `engine.ts`。
- 提示词没有独立的 `src/prompts/` 目录，全部内嵌在 `engine.ts`；改提示词前先读 `docs/destiny-driven-story-core.md`（最高层产品约束），并检查 `docs/known-issues.md` 是否已有相关登记。
- 发现可疑但未确认是 bug 的行为，先登记到 `docs/known-issues.md` 再决定是否修改；确认是 bug 的（解析/合并丢数据一类）直接修复并补回归测试。
- V2 不兼容 0.3 以下旧存档；`useContentStore` 的持久化数据由 `sanitizePersistedContent` 兜底，旧字段会被静默丢弃。
- 不要提交 `.env`、`dist/`、`node_modules/`、`test-runs/`、`test-saves/` 或真实 API Key。
- `.legacy-reference/` 是本地保留的 V1 提示词与架构草稿（已在 `.gitignore` 中），**不参与构建、不要引用**；确认不再需要后可直接删除。
- `scripts/test-story-flow.mjs` 通过环境变量读取配置：`LRPG_API_BASE` / `LRPG_API_KEY` / `LRPG_PLANNER_MODEL` / `LRPG_STORY_MODEL`。

## 验证习惯

构建通过不等于模型链路通过：

1. 每次改动至少跑 `cmd /c npm run build` 与 `cmd /c npm test`；
2. 改动 `engine.ts` / `patch.ts` 时跑 `cmd /c npm run test:patch`；
3. 涉及模型协议或 UI 流程的改动，配置真实 API 后做一次浏览器冒烟：设置 → 启程 → 生成一轮 → 生成选项 → 背包 / 场景 / 手动输入 / 完结评分。
