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
| `src/v2/engine.ts` | 三阶段提示词、工具、回合执行；可变区注入三幕窗口 `【STAGE_AND_ACT_WINDOW】`、动态世界书、`beatsThisTurn`、随机事件上下文、`【PACE_CORRECTION_ALERT】` 与 `【STORY_AUTONOMY】`；planner JSON 解析失败时自动修复重试一次；story 按模型自动选择 compact/expressive 文风 profile，并做"长度+句尾标点+供应商错误文本"三重截断防护；结算失败抛 `TurnPostFailureV2`，`runTurnSettlementV2` 只重跑结算 |
| `src/v2/patch.ts` | 写后 Patch 校验、增量合并、程序权威幕状态机（自动推进 / 改道挂账 gate）、随机事件三态结算与调度、状态提交 |
| `src/v2/types.ts` | V2 游戏状态、Patch 类型、幕历史 / 节奏审计 / 随机事件绑定类型与续跑中间结果 `TurnPartialV2` |
| `src/v2/actWindow.ts` | 三幕聚焦窗口（≤900 字、6 级降级）、世界书稳定 / 动态拆分、`beatsThisTurn` 裁剪（纯函数） |
| `src/v2/randomEvents.ts` | 随机事件候选目标与绑定校验、滚动历史（≤8）、智能强度、上下文与三档指令文本（纯函数） |
| `src/v2/paceGuard.ts` | 程序侧节奏审计（篇幅 / 时间推进 / 收尾模式）与下轮软纠偏文本，只观察不回写正文（纯函数） |
| `src/v2/contextSearch.ts` | 规划上下文检索 `search_story_context` 的纯函数实现：分词、候选构建、证据切片（500 字）、评分（整串/覆盖率）与结果选择 |
| `src/v2/webSearch.ts` | 官方 DeepSeek 联网搜索 `web_search` 封装：请求构造（`ori_question`）、响应解析（低置信度回退）、失败降级、工具定义与纪律、官方端点判定 |
| `src/v2/store.ts` | 存档创建、回合提交、最近回合回退、存档导入（`importSave`）、hydrate 迁移（幕字段反查补齐、旧档随机事件归一化）与可持久化裁剪（`toPortableSaveV2`）；`SAVE_STORAGE_VERSION` 2 |
| `src/v2/saveTransfer.ts` | 存档备份信封（`lrpg-save` v1）的导出/导入解析、版本守卫、文件名安全化 |
| `src/v2/GamePage.tsx` | 游戏主界面、侧边栏（含幕 N/M 与挂账徽标、故事脉动三态历史）、队列；瞬时失败自动重试 1 次，结算失败先自动只重试结算；最终失败保留正文/输入并提供「仅重试结算」「重新生成本回合」「重试模型请求」入口 |
| `src/v2/ReadingNavigator.tsx` | 长文阅读导航：卷宗目录 / 回合跳转、存档级书签、字号 / 行距 / 版心、跨幕卷首题跋、回到最新 |
| `src/v2/ModelActivityPanel.tsx` | 「司辰仪」模型活动控制台：三阶段进度、思考链复制、工具与警告、usage / 缓存命中、`patchStats` 对账 |
| `src/services/llmClient.ts` | Chat Completions 流式调用、工具循环、JSON 回退、传输层重试（网络 / 429 / 5xx 最多 2 次退避；认证错误不重试） |
| `src/lib/sse.ts` | SSE 解析、`<think>` 拆分、思考通道 JSON 回退 |
| `src/pages/SettingsPage.tsx` | 模型、上下文、注入、输入视角、展示详情设置 |
| `src/store/useSettingsStore.ts` | 设置持久化与 normalize |
| `src/lib/contentLibrary.ts` | 故事 / 世界书 / 出身的校验与导入导出包；幕级可选字段的长度裁切 |
| `src/store/useContentStore.ts` | 自定义内容库（persist `lrpg.content`，version 3） |
| `src/v2/workshop/model.ts` | 命运工坊的校验、克隆、规范化（含幕级字段与强线性词警告） |

### 存储键

| 键 | 写入方 |
|---|---|
| `lrpg.v2` | `src/v2/store.ts`（存档与回合状态，`SAVE_STORAGE_VERSION` 2） |
| `lrpg.settings.v2` | `src/store/useSettingsStore.ts` |
| `lrpg.content` | `src/store/useContentStore.ts` |
| `lrpg.draft.<saveId>` | `src/v2/draft.ts`（未发送的输入草稿，按存档隔离） |
| `lrpg.reader.prefs` | `src/v2/ReadingNavigator.tsx`（阅读版式偏好） |
| `lrpg.bookmarks.<saveId>` | `src/v2/ReadingNavigator.tsx`（存档级回合书签，最多 100 条） |

## 3. 三模型协议

### 3.1 写前规划输出

```json
{
  "intent": "",
  "currentAct": "",
  "activeBeatIds": [],
  "beatsThisTurn": [],
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
  "randomEvent": {
    "planned": false,
    "targetKind": "beat|thread|relationship|reconvergence",
    "targetId": "",
    "summary": ""
  }
}
```

- `beatsThisTurn`：本轮要推进的原子节拍，程序裁成 1~3 条（慢叙事只留第 1 条），story 阶段只见裁剪后的清单。
- `randomEvent`：只有 `planned === true` 才需要绑定；`targetId` 必须取自程序提供的候选目标，非法绑定只记录 `lastPlan` 并发活动流警告，不写入 `activeBinding`。
- 解析失败会先自动做一次 JSON 修复重试（只重发当前阶段，不重跑整轮）；仍失败才报错，不会继续生成故事。

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
    "actTransition": { "proposeNextAct": false, "actExitSummary": "" },
    "currentStage": "",
    "currentPath": "",
    "nextMilestone": "",
    "convergencePlan": "",
    "endingReached": false,
    "reason": "",
    "beatChanges": []
  },
  "randomEvent": { "handled": false, "resolution": "resolved|ongoing_hook|interrupted", "note": "" }
}
```

- `destiny.currentActId` 只做原样回显；模型自报值与程序权威不一致会被忽略并留警告。
- `destiny.actTransition` 只在改道确实需要跨幕兑现时提议；程序按终态比例、非终态节状态与数量三道 gate 决定是否挂账。
- `randomEvent.resolution` 三态决定历史写入与调度：`resolved` / `ongoing_hook` 记历史并清空绑定，`interrupted` 保留绑定并顺延一回合。

解析失败会先自动修复重试一次；仍失败才报错，不会静默提交空补丁。每回合提交后程序还会用 `paceGuard.analyzePace` 生成 `TurnRecordV2.pacing`（只留档、不改正文、不进模型上下文）。

### 3.3 规划工具与联网搜索

planner_pre 的工具由程序按设置决定是否挂载（故事 / 写后结算阶段恒无工具）：

| 工具 | 参数 | 返回 | 说明 |
|---|---|---|---|
| `search_story_context` | `query` / `scope`（all·history·characters·relationships·facts·threads）/ `limit`（1~8） | `query/scope/resultCount/results/note` + 每条 `matchedTerms/score` | 本地检索；证据默认 500 字、同来源最多 2 条、去重后截到 limit；实现见 `contextSearch.ts` |
| `web_search` | 仅 `query`（≤128 字） | `tool/ok/query/resultCount/results/note`（失败时 `error`；0 结果 `retryHint`；低置信度 `lowConfidence`） | 官方 DeepSeek `POST {apiBase}/tools/search`；`ori_question` 由程序带玩家原始输入；每次返回最多 5 条，`rerank_score` 排序，无 ≥1.5 高分时退到 ≥0.5 |

联网搜索行为矩阵（`webSearchAllowed` 的判定：`plannerToolsEnabled && plannerWebSearchEnabled && isOfficialDeepSeekEndpoint(apiBaseUrl) && apiKey`）：

| 条件 | planner_pre 工具 | 是否注入联网纪律 |
|---|---|---|
| 工具关闭（无论联网开关） | 无工具 | 否 |
| 工具开启 + 联网关闭 | 仅 `search_story_context` | 否 |
| 工具开启 + 联网开启 + 官方 DeepSeek 地址 + 有 Key | `search_story_context` + `web_search` | 是 |
| 工具开启 + 联网开启 + 非官方地址 或无 Key | 仅 `search_story_context` | 否 |
| story / planner_post 阶段 | 无工具 | — |

- 每回合 `web_search` 最多成功调用 **1 次**（与玩家设置的阶段工具总轮数无关）；重复调用直接返回工具错误文本。
- 失败降级：429（账号级 QPS，本回合不重试）/ 5xx / 网络错误 / 超时（默认 8s）/ 非法 JSON 都返回 `{ok:false,...}` 工具消息，**不抛异常、不打掉回合**。
- 低置信度回退：没有任何结果达到 `rerank_score ≥ 1.5` 时，退到 `≥ 0.5` 并在结果里标 `lowConfidence`，同时附「只能当弱参考」的提示（官方对长尾查询常给 0.7~0.8）。
- 查询内容与 `ori_question` 会发送给 DeepSeek；外部结果只作为参考证据，工具返回固定 `note` 要求不得覆盖 worldFacts / 正史 / 人物设定。

## 4. 已移除的协议字段

- `uncertainties`：已从输出模板、类型、解析中移除。
- `canonCheck`：已从结算提示词、输出模板、类型、解析中移除。

## 5. 程序侧权威状态

`GameStateV2` 当前持久化字段：

- 基础：`revision / turn / phase / mode / narrativePace / storyAutonomy / history / summary / latestProgress / lastCommitId`（`storyAutonomy = strict | standard | free`，缺省 standard，旧档 hydrate 自动补）
- 场景：`currentScene`
- 人物：`characters`（含 `aliases / status / knownFacts`）
- 关系：`relationships`
- 背包：`inventory`
- 线程：`storyThreads`
- 事实：`facts`
- 命运：`destiny`
  - 幕：`currentActId`（只由程序维护）、`currentActIndex`（0-based，UI 渲染「幕 N/M」）、`actHistory[]`、`lastActTransitionTurn?`；
  - `actHistory[]`：`actId / enteredTurn / exitedTurn? / exitSummary? / carriedBeatIds?`（旧档为空数组，不伪造历史）；
  - `beats[]`：`beatId / actId`（不可变）/ `carriedFromActId?`（改道挂账来源）/ `status / currentPlan? / evidenceSummary? / evidenceTurns / replacementBeatId?`。
- 随机事件：`randomEvent`
  - 调度：`enabled / nextTriggerTurn / pending / intensity / lastTriggeredTurn? / triggerIntervalMin / triggerIntervalMax`
  - 绑定与钩子：`activeBinding?`（`targetKind / targetId / summary / plannedAtTurn`）、`history?`（`id / turn / intensity / targetKind / targetId / summary / outcomeNote? / status`）
- 注入标记：`plannerInjectApplied`
- 回合留档：`turnRecords`（含 `patchStats` 与 `pacing`）
- 存储版本：`SAVE_STORAGE_VERSION = 2`；zustand persist 只在版本不等时调用 migrate，旧档在 hydrate 时按大纲补齐幕字段并归一化随机事件绑定/历史。

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
  activeBinding?: {
    targetKind: 'beat' | 'thread' | 'relationship' | 'reconvergence';
    targetId: string;
    summary: string;   // ≤80
    plannedAtTurn: number;
  };
  history?: RandomEventHistoryItemV2[]; // ≤8，裁剪时优先保留最近 3 条 ongoing_hook
}
```

- 启程页设置开关与触发区间；
- 写前规划输出 `randomEvent.planned/summary/targetKind/targetId`，程序校验候选目标后写入 `activeBinding`（非法绑定只写 `lastPlan` 并发警告）；
- 写后结算输出 `randomEvent.handled/resolution/note`：`resolved` / `ongoing_hook` 写入 `history` 并清空绑定，`interrupted` 保留绑定、把 `pending` 顺延到下一回合；`note` 始终记入 `lastNote`；
- 强度由 `pickRandomEventIntensity` 智能选择（改道/挂账 → destiny、刚切幕或故事节停滞 → progress、否则 related）；切幕回合若下次事件排在两回合之后，会被拉近并升为推进/命运档；
- 前端「故事脉动」卡片展示档位、待兑现绑定、最近 3 条三态历史、最近安排与结果。

## 7. 设置项

`AppSettings` 当前包含：

- API：`apiBaseUrl / apiKey`（仅支持 Chat Completions 协议）
- 模型：`storyModel / plannerModel`
- 生成：`temperatureStory / storyMaxTokens`
- 规划上下文：`plannerContextPreset / plannerContextTokens`
- 工具：`plannerToolsEnabled / plannerToolMaxCalls / plannerWebSearchEnabled`（联网搜索默认关，仅官方 DeepSeek 地址 + API Key 生效，按成功请求计费）
- DeepSeek：`plannerJsonMode / thinkingMode / reasoningEffort`
- 高优先级注入：`roleInjects.planner / story / post`
- 输入视角：`inputPerspective`
- 展示与编辑：`stateEditingEnabled`

## 8. 前端展示

侧边栏四页（更新时由 `sidePanelUpdates.ts` 差量检测、`UpdateGlow` 五层金线特效提示）：

- 人物：人物卡 + 关系一行式；开启 `stateEditingEnabled` 后，可编辑/清除人物介绍，编辑/删除关系好感；
- 世界：当前场景 + 最新进展 + 正史事实（折叠）；
- 背包：物品 + 消耗品标签；
- 故事：线程 + 本地化状态 + 进度条。

命运卡：

- 完成度、当前幕（`幕 N/M · 《幕标题》`，来自 `currentActIndex` + 大纲）、当前路径；
- 当前完成度说明（折叠）；
- 故事节状态（展开；开启 `stateEditingEnabled` 时显示全部故事节与下一里程碑/收敛计划）；跨幕挂账的节显示「挂账自第 N 幕」徽标。

故事脉动（随机事件）：

- 档位与到期状态、待兑现绑定（`targetKind:targetId · summary`）；
- 最近 3 条三态历史（`resolved` / `ongoing_hook` / `interrupted`，含回合号与绑定目标）；
- 最近安排 `lastPlan` 与最近结果 `lastNote`。

长文阅读导航（`ReadingNavigator.tsx`）：

- 顶栏阅读导航条 + 卷宗目录抽屉（回合纪要、幕归属、正文摘录与跳转）；
- 存档级回合书签（`lrpg.bookmarks.<saveId>`，最多 100 条），正文回合标题与目录内均可标记；
- 字号 / 行距 / 版心偏好（`lrpg.reader.prefs`，独立于 `lrpg.v2`）；
- 跨幕时的「卷首题跋」与「前卷回响 · 幕间纪要」（读 `actHistory.exitSummary`）；
- 右下角「回到最新」罗盘与阅读进度。

模型活动（司辰仪，`ModelActivityPanel.tsx`）：

- 三阶段进度、思考链（可复制）、工具调用与警告、token / 缓存命中；
- 写后结算阶段展示 `patchStats` 对账结果。

路由切换时顶部有延伸金线过渡（`App.tsx`）。

主页「继续旅程」：

- 每个存档可「导出存档」为 JSON 备份（与 localStorage 持久化共用裁剪规则）；
- 无存档时也可「导入存档」；导入作为新旅程加入，成功后提示是否进入。

游戏页失败恢复：

- 瞬时失败（网络 / 429 / 5xx / 非法 JSON / 异常短正文）自动重试 1 次；结算失败先自动只重试结算一次（不重跑 planner_pre / story）；
- 「正文已生成 · 结算未完成」卡片保留完整正文，结算失败不再让整轮作废；
- 「仅重试结算」只调用 `planner_post`；「重新生成本回合」丢弃正文重新跑三阶段；最终仍失败时「重试模型请求」保留队列；
- 最终失败会把未提交的输入写回草稿（`lrpg.draft.<saveId>`），刷新页面也能恢复这一条输入。
- 启程页会按 `StoryOutline.backgroundIds` 过滤推荐出身（未声明的故事展示全部）；切换故事时自动选中其第一个推荐出身。

## 9. 测试体系

- 单元测试：离线（esbuild 打包 + `node:test`，模型调用 mock `fetch`），当前 **580 条用例 / 22 个测试文件**；
- 脚本测试：Patch/命运状态回归、引擎端到端 mock 链路（e2e 44 条断言）、存档体积与写入可靠性、故事链路脚本（无 Key 自动 dry-run）；
- 真实链路冒烟：`npm run test:real`（需外部 API，支持 1–40 回合长局与分阶段缓存统计，见下）。

```bash
cmd /c npm test                              # 单元测试（esbuild 打包 + node:test）
cmd /c npm run test:patch                    # Patch / 命运状态回归（scripts/test-destiny-patch.mjs）
cmd /c npm run test:e2e                      # 端到端 mock 链路（scripts/e2e-mock-flow.mjs）
cmd /c npm run test:storage                  # 存档体积与 QuotaExceededError 行为
cmd /c npm run test:story -- --dry-run       # 故事链路脚本（无 Key 自动 dry-run）
cmd /c npm run test:real                     # 真实链路冒烟（需 LRPG_API_BASE / LRPG_API_KEY / LRPG_MODEL）
```

- `test:real` 可选环境变量：`LRPG_TURNS`（1–40，默认 2）、`LRPG_MAX_TOKENS`（0 = 不限输出）、`LRPG_RETRIES`、`LRPG_TOOLS=1`（上下文检索工具）、`LRPG_WEB_SEARCH=1`（官方联网搜索）、`LRPG_INPUTS_FILE`（每行一条玩家输入）、`LRPG_CHECKPOINT_FILE` / `LRPG_RESUME` / `LRPG_KEEP_CHECKPOINT=1`（断点续跑）、`LRPG_TURN_TIMEOUT_MS`（单回合看门狗）；报告 `test-runs/real-chain-report.json` 含 `cacheSummary`（预热回合分阶段命中率）与 `evaluation`（篇幅 p50/p90、升华收尾/时间跳跃/超预算/纠偏次数、随机事件三态、幕切换、token 合计）。
- 单元测试源码位于 `tests/`，由 `scripts/run-unit-tests.mjs` 用 esbuild 以 `@ -> src` 别名打包到被 gitignore 的 `test-runs/unit/<scope>/` 后再运行，因此测试可以像产品代码一样使用 `@/` 导入。`--filter` 按 scope 隔离产物与报告目录，支持并行跑不同过滤条件。
- 模型调用一律 mock `globalThis.fetch`，不产生真实网络请求。
- 覆盖范围：通用工具与 JSON 提取（含括号平衡扫描与病态输入性能）、SSE 帧解析与思考链拆分、`commitTurnPatchV2` 全部校验分支（含幕状态机自动推进/三条挂账 gate/非法 `currentActId`/切幕后 `currentStage` 兜底）、`runTurnV2` 三阶段端到端与失败路径（含工具循环、视角、注入、幕窗口/动态世界书/节拍/纠偏注入、联网搜索挂载矩阵与失败降级）、planner JSON 自动修复重试与异常短正文防护、结算失败续跑与 `runTurnSettlementV2`、传输层 429/5xx/认证错误重试策略、随机事件绑定校验/历史裁剪/三态闭环/智能强度/切幕平滑、`actWindow` 窗口降级与稳定块字节不变、`paceGuard` 节奏审计与纠偏文本、`contextSearch` 分词/覆盖排序/证据切片/结果选择（33 条）、`webSearch` 请求与响应解析/低置信度回退/各类失败降级/官方端点判定（30 条）、`useGameStoreV2` 存档与回合回退/存档导入/hydrate 加固（含旧档幕字段迁移）、存档备份信封导出与导入解析、内容库校验与 `useContentStore` 冲突处理、工坊校验与克隆（含幕级字段）。
- 未覆盖：React 组件与浏览器行为（含阅读导航、司辰仪面板、金线特效）、`llmClient` 的 `stream_options` 兼容分支、真实供应商 SSE 分块边界、真实模型输出质量——这些仍需配置 API 后人工冒烟（`test:real` 可跑长局链路与缓存统计，但不评估写作质量）。

## 10. 已移除的遗留部分

V1 多 Agent 版本的代码已在接手清理中删除（共 37 个文件：36 个被 git 跟踪的零引用文件 + 1 个从未纳入 git 的 `src/pages/GamePage.tsx.bak`），包括：

- 旧页面与组件：`pages/LibraryPage.tsx`、`pages/GamePage.tsx.bak`、`components/StoryView` / `ChoicePanel` / `NpcList` / `CharacterPanel` / `SceneMap` / `SidebarTabs` / `TopBar` / `ReviewPanel` 等 18 个组件；
- 旧数据层：`storage/ledgerRepository.ts`（IndexedDB 司书库）、`types/workspace.ts`、`types/custom.ts`、`lib/workspaceSeed.ts`、`lib/workspaceTemplates.ts`、`lib/journeyPackage.ts`、`lib/ledgerJourneyPackage.ts`、`lib/strictCustom.ts`、`lib/storage.ts`；
- 旧提示词与类型：`lib/deepseekV4Prompt.ts`、`lib/items.ts`（依赖已删除的 `types/game.ts`）、`lib/agentTrace.ts`、`lib/animations.ts`；
- 内容库中的随机事件条目与司书库模板：`RandomEvent` / `WorkspaceTemplate` 类型、`presets/events.ts`、`presets/workspaceTemplates.ts` 及 `contentLibrary` / `useContentStore` 中的对应分支。随机事件现在完全由 `engine.ts` 指令与 `patch.ts` 调度驱动，不再依赖事件库。

`/library` 路由保留为到 `/workshop` 的兼容重定向。

## 11. 已知边界

- V2 存档有持久化版本（`SAVE_STORAGE_VERSION`，当前为 2）与迁移入口：读旧档时补齐缺失字段（含 `beats[].actId` 反查、自由文本 `currentActId` 纠正、空 `actHistory`）、丢弃无法修复的条目；由更高版本写入的存档进入只读提示，不重新解读后写回；
- `useContentStore` 持久化版本为 3：旧数据中的 `customEvents` / `customWorkspaceTemplates` 会被 `sanitizePersistedContent` 静默丢弃；
- 活动面板不展示规划/结算模型原始 JSON 输出；
- 路由级动态分包 + vendor 拆分后，主入口约 43 kB（gzip 16 kB），最大页面 chunk 为 GamePage（约 108 kB）；`/workshop` 与 `react-markdown` 均按需加载；
- 结算续跑的中间结果只存在当前页面会话：刷新后未提交正文与「仅重试结算」入口会丢失（见 `known-issues.md` O）；普通回合失败已把输入写回草稿，刷新后可从输入框恢复（正文草稿仍会丢失）；story 正文低于 120 字、句尾缺少终结标点、或疑似供应商错误文本（内容审核/密钥/限额等）会被判为失败、不提交；
- 存档导入复用 hydrate 规范化；高版本只读存档若被导出，会按当前结构裁剪、不保留未来版本的未知字段；
- **节奏检测是保守启发式**：只覆盖固定收束句式与时间词表（尾 220 字叙述部分），意象式升华、换一种说法点题等写法会漏报；宁可漏报也不做"剧情警察"，检测结果只影响下一轮提示词，不回滚正文。0.5.0 起统计时间推进词前会先剔除成对引号内的台词，并忽略「今天/明天/昨天/上周… + 时段词」这类日期指向组合，避免把角色台词与计划性回忆误判为叙事跨日；
- **真实链路依赖外部供应商**：`npm run test:real` 需要可用的 `LRPG_API_BASE` / `LRPG_API_KEY` / `LRPG_MODEL`，脚本内置请求级重试与退避（网关按出口 IP 门禁、429、5xx），可跑 1–40 回合长局并输出分阶段缓存统计（`cacheSummary`）与长局评测（`evaluation`）；供应商额度或网络不可用时无法离线复现；
- **联网搜索默认关闭且仅官方端点可用**：需要「工具开启 + `plannerWebSearchEnabled` + 官方 DeepSeek 地址 + 有 API Key」同时满足（非官方服务没有 `/tools/search` 接口）；查询与 `ori_question` 会发送给 DeepSeek，按成功请求计费（约 `$0.75/1000`）；外部网页可能过时或不准确，工具返回强制要求不得覆盖 worldFacts / 正史 / 人物设定；
- **上下文检索的证据长度是有意取舍**：单条证据默认 500 字（原 900）、同一来源最多 2 条——优先保证相关性与来源多样性；被截断或挤掉的内容仍可用更小 `scope` 或更短关键词再查，不会真正丢失；
- **前端新增两组件仍属 GamePage 生态**：`ReadingNavigator.tsx` 与 `ModelActivityPanel.tsx` 未拆独立路由，React 组件行为不在单测覆盖内，需配置真实 API 后浏览器冒烟；
- 阅读版式与回合书签独立存 `lrpg.reader.prefs` / `lrpg.bookmarks.<saveId>`，不进入 `lrpg.v2` 存档，也不随存档导出备份；
- 旧文档已归档至 `docs/archive/`；`.legacy-reference/` 为本地 V1 草稿，不参与构建。

## 12. Prompt Pack v2.1（0.5.0 生产基线）

- 结构：规划只定「本轮必须落地的客观结果 + 节拍兑现后的戏剧悬置切面」；故事模型独占场景、台词与详略调度；写后结算按叙事功能实质兑现判定 `satisfied`。
- story 用户消息不含 `currentAct/activeBeatIds/destinyProgress/pathChange/reframingNeeded/reconvergencePlan/nextStoryFunction` 7 个工程元字段，末尾固定 `【WRITING_EXECUTION_ANCHOR】` 近因锚点（v2.1 压缩为一句 68 字）。
- 反 AI 味规则：状态分类标签不得当人名、临时外貌指代在正式互动/签名时换成真名、已确立日常 1 句话带过、禁止慢镜头/心理说明书/盯视计时器；泛化声线按角色功能（主角/同辈/事务型前辈/敏锐观察者）而非姓名。
- 真实 A/B（同一批 20 条输入、deepseek-flash）：标签泄漏 48→0、`【stopBoundary】` 泄漏 1→0、慢镜头词 14→1、盯视计时器 4→0；v2.1 中位 1,193 字（v2 724、<650 字回合 6→0），T11 进第三幕，T15 `satisfied=8`；输出 token 与 v2 持平而正文多 58%。
- 模型分级：日常三阶段用 flash；高优品质档只把 story 阶段切到 `deepseek-v4-pro`，planner_pre / planner_post 继续 flash。
- 节奏审计（0.5.0）统计时间词前剔除引号内台词与「日期指向 + 时段」组合，消除 T4/T7/T12/T13 类误报；真正的跨日词仍计数。
