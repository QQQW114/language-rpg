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
cmd /c npm test           # 单元测试（esbuild 打包 + node:test，离线）
cmd /c npm run test:e2e   # 端到端 mock 链路（本地 OpenAI 兼容服务器驱动真实 engine/store）
cmd /c npm run test:storage # 存档体积与写入可靠性实测
cmd /c npm run test:story # 故事链路脚本测试（无 Key 时自动 dry-run）
cmd /c npm run test:patch # Patch/命运状态回归测试
cmd /c npm run test:real  # 真实链路冒烟（需 LRPG_API_BASE / LRPG_API_KEY / LRPG_MODEL）
```

- 只跑部分单元测试：`node scripts/run-unit-tests.mjs --filter=patch`；复用上次产物：`--no-build`。
- 单元测试位于 `tests/`，约定见 [`tests/README.md`](tests/README.md)，全部离线（模型调用 mock `fetch`）。
- `npm run test:e2e` 会在随机端口起一个 mock 供应商，跑完整回合并断言请求形状与落盘状态；产物见被忽略的 `test-runs/e2e-mock-report.json`。
- `npm run test:storage` 会跑 30 回合并测体积增长与配额行为；想要真实长局数据可传回合数（`node scripts/e2e-storage-growth.mjs 60`）。
- PowerShell 里直接敲 `npm` 可能被执行策略拦截（`npm.ps1`），优先用 `cmd /c npm ...`。
- Windows 上一键脚本：`start.cmd`（开发）、`build.cmd`（构建 + preview）。

## 代码结构（当前真实布局）

```text
src/
  main.tsx / App.tsx          入口与路由表
  v2/                         游戏主链路（唯一回合引擎）
    engine.ts                 三阶段提示词、工具、回合执行 runTurnV2；结算续跑 runTurnSettlementV2
    patch.ts                  写后 Patch 校验与状态提交 commitTurnPatchV2；程序权威幕状态机
    types.ts                  GameStateV2 / TurnPatchV2 / TurnPartialV2 / 活动流类型
    actWindow.ts              三幕窗口构建、世界书稳定/动态拆分、beatsThisTurn 裁剪（纯函数）
    randomEvents.ts           随机事件候选目标/绑定校验、滚动历史、智能强度、上下文与指令文本（纯函数）
    paceGuard.ts              程序侧节奏审计与下轮软纠偏文本（纯函数，只观察不改正文）
    store.ts                  V2 存档（persist -> lrpg.v2）、存档导入与可持久化裁剪
    saveTransfer.ts           存档备份信封（lrpg-save v1）导出/导入解析与版本守卫
    GamePage.tsx / SetupPage.tsx / HomePage.tsx / WorkshopPage.tsx
    ReadingNavigator.tsx      长文阅读导航：卷宗目录/书签/版式/跨幕题跋/回到最新
    ModelActivityPanel.tsx    「司辰仪」模型活动控制台：三阶段活动、思考链、usage、patchStats
    workshop/                 命运工坊编辑器与校验（model.ts）
  services/llmClient.ts       模型调用（Chat Completions、工具循环、JSON 回退）
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
| `lrpg.v2` | `src/v2/store.ts` | 存档 `SaveV2`、`GameStateV2`、最近回合回退点（`SAVE_STORAGE_VERSION` 2） |
| `lrpg.settings.v2` | `src/store/useSettingsStore.ts` | API、模型、上下文预算、注入、输入视角 |
| `lrpg.content` | `src/store/useContentStore.ts` | 自定义大纲 / 出身 / 世界书（persist version 3） |
| `lrpg.draft.<saveId>` | `src/v2/draft.ts` | 未发送的输入草稿（按存档隔离，不进入 `lrpg.v2`） |
| `lrpg.reader.prefs` | `src/v2/ReadingNavigator.tsx` | 阅读版式偏好（字号 / 行距 / 版心） |
| `lrpg.bookmarks.<saveId>` | `src/v2/ReadingNavigator.tsx` | 存档级回合书签（最多 100 条） |

## 核心回合链路

```text
写前规划 planner_pre → 故事正文 story → 写后结算 planner_post → 程序提交 patch.ts
```

- 入口是 `runTurnV2()`（`src/v2/engine.ts`），**不要在别处新增回合逻辑**。
- 解析失败直接抛错，不静默提交空补丁；`finish_reason` 为 `length`/`content_filter` 同样抛错。
- 权威状态在程序侧：模型只输出增量 Patch，由 `commitTurnPatchV2` 校验后合并。
- 提交有两道 CAS 守卫：`patch.baseRevision` 必须等于当前 `revision`；前端 `commitSuccessfulTurn` 再比对一次 revision/turn。
- 写后结算失败不是整轮作废：`runTurnV2` 抛 `TurnPostFailureV2`（携带 `TurnPartialV2`），`runTurnSettlementV2()` 只重跑 `planner_post`；游戏页据此提供「仅重试结算」与「重新生成本回合」。
- **三阶段提示词内嵌幕窗口 / 节拍 / 节奏纠偏**：`engine.ts` 在固定输出模板之后的可变区依次注入 `【STAGE_AND_ACT_WINDOW】`（`actWindow.buildStageAndActWindow`）、动态世界书 `【DYNAMIC_WORLD_FACTS】`、`【beatsThisTurn】`（`actWindow.normalizeBeatsThisTurn` 裁剪）与 `【PACE_CORRECTION_ALERT】`（`paceGuard.buildPaceCorrectionAlert`，仅上一轮 `pacing.needsCorrection` 时）；随机事件到期时预置 `【RANDOM_EVENT_CONTEXT】` + 三档指令（`randomEvents.ts`）。story 用户消息必须保持以 `【NARRATIVE_PACE】` 开头，否则前缀缓存回归断言与缓存命中会失效。

修改模型输出协议时，必须**成组**同步这几处：

1. 提示词与输出模板：`src/v2/engine.ts`（`buildPlannerPreSystem` / `buildStorySystem` / `buildPlannerPostSystem` / `postShape`）
2. 窗口 / 事件 / 纠偏文本：`src/v2/actWindow.ts`（三幕窗口、世界书拆分、节拍裁剪）、`src/v2/randomEvents.ts`（绑定、历史、强度、指令）、`src/v2/paceGuard.ts`（审计与纠偏）
3. 类型：`src/v2/types.ts`（`TurnPatchV2`、`GameStateV2`）
4. 清洗与提交：`src/v2/patch.ts`（含程序权威幕状态机与随机事件调度）
5. UI 展示：`src/v2/GamePage.tsx`（含 `ReadingNavigator.tsx` / `ModelActivityPanel.tsx`）

## 开发注意事项

- **不要收窄 `tsconfig.json` 的 `include`**。历史上它只列了 4 个路径，导致被排除的文件在无类型保护的情况下腐坏（`src/types/game.ts` 被删除后仍被十余个文件 import 而无人察觉）。现在 include 是 `["src"]`。
- 删除模块前先做一次反向引用检查（全仓库搜索模块名），再跑 `npx tsc --noEmit` 确认没有悬空引用。
- `src/lib/sse.ts` 与 `llmClient.ts` 是供应商差异的集中点：新增兼容分支时优先放这里，不要污染 `engine.ts`。
- 提示词没有独立的 `src/prompts/` 目录，全部内嵌在 `engine.ts`；改提示词前先读 `docs/destiny-driven-story-core.md`（最高层产品约束），并检查 `docs/known-issues.md` 是否已有相关登记。
- 发现可疑但未确认是 bug 的行为，先登记到 `docs/known-issues.md` 再决定是否修改；确认是 bug 的（解析/合并丢数据一类）直接修复并补回归测试。
- V2 不兼容 0.3 以下旧存档；`useContentStore` 的持久化数据由 `sanitizePersistedContent` 兜底，旧字段会被静默丢弃。
- **存档体积**：`lrpg.v2` 的持久化会剔除 `turnRecords[].calls[].input`（三阶段完整提示词留档）。这些留档体积极大（实测每回合约 208 KB，30 回合 6 MB 级），写入 localStorage 会在第 26 回合左右撞上 5 MB 配额。出参、思维链与 usage 仍然持久化；提示词明细只在当次页面会话内可导出。改动持久化结构时务必用 `npm run test:storage` 复核增长曲线。
- **写入失败必须可见**：`src/v2/store.ts` 用自定义 `StateStorage` 捕获 `QuotaExceededError`，写入 `persistError` 供界面渲染，并**继续抛出**异常（不要在这里吞掉异常，否则会把"用户能看到的失败"变成静默丢档）。
- 世界书条目的 `alwaysActive` / `keywords` / `priority` 由 `src/v2/actWindow.ts` 的 `splitWorldFacts` 实现：常驻条目进逐字节稳定的 `【STABLE_STORY_CONTEXT】`，其余只有关键词命中当前输入或最近历史时才进可变区 `【DYNAMIC_WORLD_FACTS】`，再按优先级排序截断。改动注入逻辑时不要退回无条件的 `slice`，也不要把关键词命中结果塞回稳定块（会让前缀缓存整段失效）。
- 不要提交 `.env`、`dist/`、`node_modules/`、`test-runs/`、`test-saves/` 或真实 API Key。
- `.legacy-reference/` 是本地保留的 V1 提示词与架构草稿（已在 `.gitignore` 中），**不参与构建、不要引用**；确认不再需要后可直接删除。
- `scripts/test-story-flow.mjs` 通过环境变量读取配置：`LRPG_API_BASE` / `LRPG_API_KEY` / `LRPG_PLANNER_MODEL` / `LRPG_STORY_MODEL`。

## 验证习惯

构建通过不等于模型链路通过：

1. 每次改动至少跑 `cmd /c npm run build` 与 `cmd /c npm test`；
2. 改动 `engine.ts` / `patch.ts` 时跑 `cmd /c npm run test:patch`；
3. 涉及模型协议或 UI 流程的改动，配置真实 API 后做一次浏览器冒烟：设置 → 启程 → 生成一轮 → 生成选项 → 背包 / 场景 / 手动输入 / 完结评分；UI 改动还要确认阅读导航（卷宗目录 / 书签 / 版式）、司辰仪活动面板、侧边栏更新特效与结算失败恢复态；
4. 改动提示词结构或打包配置后跑 `cmd /c npm run test:e2e`（断言请求形状、缓存前缀结构与落盘状态）；
5. 有真实 API 时可用 `cmd /c npm run test:real` 跑 1–2 回合真实链路（`LRPG_API_BASE` / `LRPG_API_KEY` / `LRPG_MODEL`，可选 `LRPG_TURNS` / `LRPG_MAX_TOKENS` / `LRPG_RETRIES`；产物 `test-runs/real-chain-report.json`）。它检查链路与落盘，不评估写作质量。
