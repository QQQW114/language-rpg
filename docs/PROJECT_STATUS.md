# 项目当前状态（V2 现行）

> 本文档与当前代码同步。修改提示词、状态结构或前端展示前，请先阅读本文。

## 1. 架构总览

纯前端 Vite + React 18 + TypeScript + Zustand。当前主路由全部走 V2：

- `/`：`src/v2/HomePage.tsx`
- `/setup`：`src/v2/SetupPage.tsx`
- `/game`：`src/v2/GamePage.tsx`
- `/workshop`：`src/v2/WorkshopPage.tsx`
- `/settings`：`src/pages/SettingsPage.tsx`

每个常规回合链路：

```text
写前规划(planner_pre) → 故事正文(story) → 写后结算(planner_post) → 程序提交(patch.ts)
```

## 2. 核心文件

| 文件 | 作用 |
|---|---|
| `src/v2/engine.ts` | 三阶段提示词、工具、随机事件指令、Patch 组装、回合执行 |
| `src/v2/patch.ts` | 写后 Patch 校验、增量合并、状态提交 |
| `src/v2/types.ts` | V2 游戏状态与 Patch 类型 |
| `src/v2/store.ts` | 存档创建、回合提交、最近回合回退 |
| `src/v2/GamePage.tsx` | 游戏主界面、侧边栏、队列与活动面板 |
| `src/services/llmClient.ts` | Chat Completions / Responses 流式调用、工具循环、JSON 回退 |
| `src/lib/sse.ts` | SSE 解析、`<think>` 拆分、思考通道 JSON 回退 |
| `src/pages/SettingsPage.tsx` | 模型、上下文、注入、输入视角、展示详情设置 |
| `src/store/useSettingsStore.ts` | 设置持久化与 normalize |
| `src/lib/sse.ts` | SSE 解析、`<think>` 拆分、思考通道 JSON 回退 |
| `src/lib/contentLibrary.ts` | 故事 / 世界书 / 出身的校验与导入导出包 |
| `src/store/useContentStore.ts` | 自定义内容库（persist `lrpg.content`，version 3） |
| `src/v2/workshop/model.ts` | 命运工坊的校验、克隆、规范化 |

### 存储键

| 键 | 写入方 |
|---|---|
| `lrpg.v2` | `src/v2/store.ts`（存档与回合状态） |
| `lrpg.settings.v2` | `src/store/useSettingsStore.ts` |
| `lrpg.content` | `src/store/useContentStore.ts` |

## 3. 三模型协议

### 3.1 写前规划输出

```json
{
  "intent": "",
  "currentAct": "",
  "activeBeatIds": [],
  "destinyProgress": "",
  "pathChange": "",
  "reframingNeeded": [],
  "reconvergencePlan": "",
  "nextStoryFunction": "",
  "writingBrief": "",
  "hardConstraints": [],
  "creativeSpace": [],
  "forbiddenChanges": [],
  "stopBoundary": "",
  "randomEvent": { "planned": false, "summary": "" }
}
```

解析失败会直接报错，不会继续生成故事。

### 3.2 写后结算输出

```json
{
  "schemaVersion": 2,
  "commitId": "COMMIT_ID",
  "baseRevision": 0,
  "turn": 0,
  "roundSummary": "",
  "latestProgress": "",
  "characters": [],
  "relationships": [],
  "inventory": [],
  "threads": [],
  "facts": [],
  "scene": null,
  "actions": [],
  "destiny": {
    "completionEstimate": 0,
    "completionReason": "",
    "currentActId": "",
    "currentStage": "",
    "currentPath": "",
    "nextMilestone": "",
    "convergencePlan": "",
    "endingReached": false,
    "reason": "",
    "beatChanges": []
  },
  "randomEvent": { "handled": false, "note": "" }
}
```

解析失败会直接报错，不会静默提交空补丁。

## 4. 已移除的协议字段

- `uncertainties`：已从输出模板、类型、解析中移除。
- `canonCheck`：已从结算提示词、输出模板、类型、解析中移除。

## 5. 程序侧权威状态

`GameStateV2` 当前持久化字段：

- 基础：`revision / turn / phase / mode / narrativePace / history / summary / latestProgress / lastCommitId`
- 场景：`currentScene`
- 人物：`characters`（含 `aliases / status / knownFacts`）
- 关系：`relationships`
- 背包：`inventory`
- 线程：`storyThreads`
- 事实：`facts`
- 命运：`destiny`
- 随机事件：`randomEvent`
- 注入标记：`plannerInjectApplied`

## 6. 随机事件状态

`RandomEventStateV2`：

```ts
{
  enabled: boolean;
  nextTriggerTurn: number;
  pending: boolean;
  intensity: 'related' | 'progress' | 'destiny';
  lastTriggeredTurn?: number;
  triggerIntervalMin: number;
  triggerIntervalMax: number;
  lastPlan?: string;
  lastNote?: string;
}
```

- 启程页设置开关与触发区间；
- 写前规划输出 `randomEvent.planned/summary`，程序转为 `lastPlan`；
- 写后结算输出 `randomEvent.handled/note`，程序把 `note` 存为 `lastNote`；
- 前端“故事脉动”卡片展示状态、安排与结果。

## 7. 设置项

`AppSettings` 当前包含：

- API：`apiBaseUrl / apiKey / apiFormat`
- 模型：`storyModel / plannerModel`
- 生成：`temperatureStory / storyMaxTokens`
- 规划上下文：`plannerContextPreset / plannerContextTokens`
- 工具：`plannerToolsEnabled / plannerToolMaxCalls`
- DeepSeek：`plannerJsonMode / thinkingMode / reasoningEffort`
- 高优先级注入：`roleInjects.planner / story / post`
- 输入视角：`inputPerspective`
- 展示与编辑：`stateEditingEnabled`

## 8. 前端展示

侧边栏四页：

- 人物：人物卡 + 关系一行式；开启 `stateEditingEnabled` 后，可编辑/清除人物介绍，编辑/删除关系好感；
- 世界：当前场景 + 最新进展 + 正史事实（折叠）；
- 背包：物品 + 消耗品标签；
- 故事：线程 + 本地化状态 + 进度条。

命运卡：

- 完成度、当前幕、当前路径；
- 当前完成度说明（折叠）；
- 故事节状态（展开；开启 `stateEditingEnabled` 时显示全部故事节与下一里程碑/收敛计划）。

## 9. 测试体系

三层，全部可离线运行：

```bash
cmd /c npm test                              # 单元测试（esbuild 打包 + node:test）
cmd /c npm run test:patch                    # Patch / 命运状态回归（scripts/test-destiny-patch.mjs）
cmd /c npm run test:story -- --dry-run       # 故事链路脚本（无 Key 自动 dry-run）
```

- 单元测试源码位于 `tests/`，由 `scripts/run-unit-tests.mjs` 用 esbuild 以 `@ -> src` 别名打包到被 gitignore 的 `test-runs/unit/` 后再运行，因此测试可以像产品代码一样使用 `@/` 导入。当前 242 条用例。
- 模型调用一律 mock `globalThis.fetch`，不产生真实网络请求。
- 覆盖范围：通用工具与 JSON 提取（含括号平衡扫描与病态输入性能）、SSE 帧解析与思考链拆分、`commitTurnPatchV2` 全部校验分支、`runTurnV2` 三阶段端到端与失败路径（含工具循环、视角、注入）、`useGameStoreV2` 存档与回合回退、内容库校验与 `useContentStore` 冲突处理、工坊校验与克隆。
- 未覆盖：React 组件与浏览器行为、`llmClient` 的非 2xx 与 `stream_options` 重试分支、真实供应商 SSE 分块边界——这些仍需配置 API 后人工冒烟。

## 10. 已移除的遗留部分

V1 多 Agent 版本的代码已在接手清理中删除（共 37 个文件：36 个被 git 跟踪的零引用文件 + 1 个从未纳入 git 的 `src/pages/GamePage.tsx.bak`），包括：

- 旧页面与组件：`pages/LibraryPage.tsx`、`pages/GamePage.tsx.bak`、`components/StoryView` / `ChoicePanel` / `NpcList` / `CharacterPanel` / `SceneMap` / `SidebarTabs` / `TopBar` / `ReviewPanel` 等 18 个组件；
- 旧数据层：`storage/ledgerRepository.ts`（IndexedDB 司书库）、`types/workspace.ts`、`types/custom.ts`、`lib/workspaceSeed.ts`、`lib/workspaceTemplates.ts`、`lib/journeyPackage.ts`、`lib/ledgerJourneyPackage.ts`、`lib/strictCustom.ts`、`lib/storage.ts`；
- 旧提示词与类型：`lib/deepseekV4Prompt.ts`、`lib/items.ts`（依赖已删除的 `types/game.ts`）、`lib/agentTrace.ts`、`lib/animations.ts`；
- 内容库中的随机事件条目与司书库模板：`RandomEvent` / `WorkspaceTemplate` 类型、`presets/events.ts`、`presets/workspaceTemplates.ts` 及 `contentLibrary` / `useContentStore` 中的对应分支。随机事件现在完全由 `engine.ts` 指令与 `patch.ts` 调度驱动，不再依赖事件库。

`/library` 路由保留为到 `/workshop` 的兼容重定向。

## 11. 已知边界

- V2 旧存档没有显式迁移层，靠运行时默认值兜底；
- `useContentStore` 持久化版本为 3：旧数据中的 `customEvents` / `customWorkspaceTemplates` 会被 `sanitizePersistedContent` 静默丢弃；
- 活动面板不展示规划/结算模型原始 JSON 输出；
- 主包仍为 500 kB 级单 chunk，`/workshop` 与 `react-markdown` 未做动态分包；
- 旧文档已归档至 `docs/archive/`；`.legacy-reference/` 为本地 V1 草稿，不参与构建。
