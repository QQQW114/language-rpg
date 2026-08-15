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
- 展示：`showDestinyDetails`

## 8. 前端展示

侧边栏四页：

- 人物：人物卡 + 关系一行式；
- 世界：当前场景 + 最新进展 + 正史事实（折叠）；
- 背包：物品 + 消耗品标签；
- 故事：线程 + 本地化状态 + 进度条。

命运卡：

- 完成度、当前幕、当前路径；
- 当前完成度说明（折叠）；
- 故事节状态（展开；开启详情时显示全部故事节与下一里程碑/收敛计划）。

## 9. 已知边界

- V2 旧存档没有显式迁移层，靠运行时默认值兜底；
- 活动面板不展示规划/结算模型原始 JSON 输出；
- 旧文档已归档至 `docs/archive/`。
