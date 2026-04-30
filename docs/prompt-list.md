# language-rpg 提示词链路全图（v2）

> 用途：给后续维护 / 调优提示词的工程师快速定位所有 LLM 调用链路与输入输出。
>
> **本文是当前代码状态的真实快照，含执笔模式 Phase 1.0 + 1.0.5 的所有改动**。早期版本见 git 历史。
>
> 版本：截至「主弧生成补 worldBookEntries + stageJudge 补 longTermMemory/anchors/worldBook/activeArcs + memorySystem 补 outline/worldBook + summarizer 补 outline + storySystem 长度治理」之后的状态。

## 0. 一回合的完整调度顺序（执笔模式）

```
玩家提交输入 / 选了 choice
  ↓
[runStory 开始]
  ↓
1. 阶段判断模型（stageJudge）           ← 最先跑，输出 playerIntent / playerPace / stageStatus / storyFocus
   └ 若 shouldAdvance=true → 调 advanceMasterArcStage 切到下一阶段
  ↓
2. 设定守护者（settingGuard）           ← 读 stageJudge 输出后跑
   └ 若 memoryUrgency=high → 立即跑 runMemoryNow（绕过 everyRounds）
  ↓
3. 故事模型（storyAgent）               ← 流式正文
  ↓
[根据 phase 分支]
普通回合 → phase=choices → [runChoices]
  ├ 决策模型（带 choices）
  ├ 长期记忆（按 memoryEveryRounds）
  ├ 动态长线事件（按概率/必定区间）
  ├ 叙事导演（按 everyRounds）
  └ 逻辑审校（按 everyRounds）
手动输入回合 → phase=manual → 在 runStory 内串行：
  决策追踪（无 choices）→ 记忆 → 动态事件 → 导演 → 审校
异步：摘要（按 maxHistoryRounds）
```

**主弧 / 启程随机生成 / 结局评分** 不在每回合调度——主弧在旅程创建时调一次（SetupPage），结局评分在 phase=ended 时调一次。

---

## 1. 核心回合链路（每轮跑）

| 链路 | Prompt 文件 | Service 文件 | 使用模型设置 | 触发时机 | 输出形态 |
|---|---|---|---|---|---|
| 故事模型 | `prompts/storySystem.ts` + `lib/strictCustom.ts` | `services/storyAgent.ts` | `settings.storyModel` | runStory 内 stageJudge / settingGuard 之后 | 流式自然语言正文 |
| 决策模型（带选项） | `prompts/decisionSystem.ts` `DECISION_SYSTEM` + `lib/strictCustom.ts` | `services/decisionAgent.ts` | `settings.decisionModel` | runChoices；`phase=choices && !lastChoices` | JSON：choices/grants/destroys/itemPatches/npcs/currentScene/availableScenes |
| 决策追踪模型 | `prompts/decisionSystem.ts` `DECISION_TRACKING_SYSTEM` | `services/decisionAgent.ts` | `settings.decisionModel` | 自由行动回合故事完成后（无 choices 输出） | JSON，去掉 choices |

### 1.1 故事模型详细输入（`buildStorySystem`）

| 输入字段 | 来源 | 说明 |
|---|---|---|
| outline | content.outlineId → 大纲 | 含 acts / tone |
| background | content.backgroundId → 出身 | 含 traits / startItems |
| activeWorldBookEntries | matchWorldBook 命中 | 仅注入命中或常驻 |
| summary | state.summary | 历史压缩 |
| longTermMemory | state.longTermMemory | 周期性整理记忆 |
| history | state.history | 完整 message 列表 |
| triggeredEvent | randomEventScheduler 抽中 | 游历/事件池模式用 |
| backpack / usedItems | state.backpack + selectedItemIds | 当前道具 + 本轮使用 |
| npcs | state.npcs（按最近活跃排序，故事 prompt 仅注入前 10） | 含 details（每个 5 条） |
| anchors | state.anchors | 玩家手动标记，单条 200 字截断 |
| currentScene | state.currentScene | name/description/time/weather |
| **authorNarrative.masterArc** | state.authorNarrative.masterArc | **新**：主弧 + currentStage + expectedBeats |
| **authorNarrative.stageJudge** | state.authorNarrative.stageJudge | **新**：本回合 playerIntent/Pace/Focus |
| authorNarrative.plan | state.authorNarrative.plan | 导演计划 |
| authorNarrative.settingGuard | state.authorNarrative.settingGuard | 守护者补丁/偏离/环境侧/偏好 |
| authorNarrative.logicReview | state.authorNarrative.logicReview | 审校 issues 按 severity 分级注入 |
| authorRandomEventState | state.authorRandomEventState | active/pending arcs |
| strictCustom | content.strictCustom 或 authorCustom | 玩家自定义提示词 |
| finalizeRequested | state.finalizeRequested | 无尽模式收束信号 |
| lengthHint / styleAddendum | content.storyStyle | 篇幅 + 风格补充 |

### 1.2 决策模型详细输入（`buildDecisionUser` / 默认模板）

通过 `DEFAULT_DECISION_USER_TEMPLATE` 占位符渲染，含：
- summaryBlock / longTermMemoryBlock / recentTextBlock
- latestStory / backpackSummary / backpackJsonBlock
- npcBlock / npcJsonBlock / anchorsBlock
- currentSceneBlock / **narrativePlanBlock** / **activeArcsBlock**
- strictCustomDecisionBlock
- **stageJudge** 经由 storySystem 注入到故事 prompt，但决策 prompt 也接收 narrativePlan 作为参考

decisionSystem.ts 当前关键约束：
- choices 必须贴合 stageJudge.storyFocus.thisRound（immersive/exploratory 时不给"立刻跳阶段"选项）
- NPC.details 是 **PATCH 语义**（仅列新增/修订/替换，旧细节自动保留；replaceDetails=true 才整体替换）
- 上限 5 条，淘汰协议明确
- choices 服务于当前导演计划焦点

### 1.3 故事模型 prompt 块优先级（写作规范第 10 条）

冲突时按以下顺序取舍：
1. stageJudge（本回合做什么、做多少）
2. masterArc.currentStage 完成条件 + 待完成节拍
3. settingGuard "必须遵守" 补丁 + 偏离风险
4. alwaysActive 世界书条目（硬设定）
5. 玩家标记的关键记忆（anchors）
6. 长期一致性记忆 + 已登场人物 details
7. 进行中事件弧、导演计划、审校建议
8. 历史摘要、当前场景、背包

---

## 2. 阶段化叙事链路（Phase 1.0.5 新增）

| 链路 | Prompt 文件 | Service 文件 | 使用模型设置 | 触发时机 | 输出形态 |
|---|---|---|---|---|---|
| **主弧生成** | `prompts/authorMasterArcSystem.ts` | `services/authorMasterArcAgent.ts` | `settings.randomModel \|\| settings.storyModel` | 旅程创建时（SetupPage）+ 玩家手动重生 | JSON：`MasterArcState`（title/summary/stages[]） |
| **阶段判断** | `prompts/authorStageJudgeSystem.ts` | `services/authorStageJudgeAgent.ts` | `settings.randomModel \|\| settings.decisionModel \|\| settings.storyModel` | 每回合最先跑（runStory 入口） | JSON：`StageJudgeResult` |

### 2.1 主弧生成模型输入（必含 worldBook，否则会丢硬设定）

```
outline + background + characterName + config (AuthorMasterArcConfig)
+ worldBookEntries  ← 必须传，含 alwaysActive + 关键词触发条目
```

**System prompt 最高优先级约束**：「stages 不得违反任何 alwaysActive 世界书条目；与大纲冲突时以世界书为准；大纲细节（如『脑中浮现完整记忆』）必须保留进 expectedBeats」。

失败 fallback 为 `fallbackMasterArcFromOutline(outline, config)`：按 outline.acts 直接转换，每个 act 作为 stage.description。

### 2.2 阶段判断模型输入（综合度最高的辅助模型）

```
outline + characterName + currentRound / nextRound + config (AuthorStageJudgeConfig)
+ summary + longTermMemory          ← 玩家承诺/未解线索
+ recent (最近 6 条) + playerInput
+ npcs (前 8 个) + currentScene
+ masterArc + narrativePlan
+ previous (上一轮 stageJudge 状态)
+ worldBookEntries (仅 alwaysActive)  ← 硬设定一致性
+ anchors                            ← 玩家标记
+ activeArcs                         ← 进行中事件弧
```

输出：`{ playerIntent, playerPace, paceReasoning, stageStatus, storyFocus }`

playerPace 取值：`immersive | exploratory | progressing | hurrying`，故事模型 prompt 第 8 条节奏纪律按此分级取舍粒度。

shouldAdvance=true 时 GamePage 自动调 `advanceMasterArcStage`（除非 autoAdvance=false）。

---

## 3. 执笔模式辅助链路（按 everyRounds / 概率触发）

| 链路 | Prompt 文件 | Service 文件 | 触发时机 | 输出形态 |
|---|---|---|---|---|
| 设定守护者 | `prompts/authorSettingGuardSystem.ts` | `services/authorSettingGuardAgent.ts` | 每回合 settingGuard.enabled 时（stageJudge 之后） | JSON：`SettingGuardResult`（patches/candidates/preference/ambientBeats/memoryUrgency/deviation） |
| 动态长线随机事件 | `prompts/authorRandomEventSystem.ts` | `services/authorRandomEventAgent.ts` | runChoices 内 / 手动输入回合的 runStory 尾段；按概率/必定区间 | JSON：`{trigger, arc?}` |
| 叙事导演 / 大纲映射 | `prompts/authorDirectorSystem.ts` | `services/authorDirectorAgent.ts` | 按 `authorDirector.everyRounds`（默认 2）+ 计划过期 | JSON：`NarrativePlanState` |
| 逻辑审校 / 连续性修复 | `prompts/authorLogicCheckSystem.ts` | `services/authorLogicCheckAgent.ts` | 按 `authorLogicCheck.everyRounds`（默认 3） | JSON：`AuthorLogicReviewState` |

### 3.1 守护者输入（含玩家偏好分析）

```
outline + background + characterName + currentRound / nextRound + totalRounds
+ summary + longTermMemory
+ recent (最近 8 条) + playerInput
+ npcs + backpack + currentScene
+ worldBookEntries (全集，含 alwaysActive + 触发；守护者负责扫盲区)
+ anchors
+ narrative (含 stageJudge 输出，让守护者按 playerPace 调 ambientBeats 数量)
+ randomEventState
```

输出 `SettingGuardResult` 含：
- `settingPatches`：本回合设定补丁，severity=must/should
- `newWorldBookCandidates`：建议沉淀的世界书条目（玩家审核后入库）
- `playerPreference`：玩家偏好画像（confidence=high/medium/low）
- `ambientBeats`：环境侧主动反应建议
- `memoryUrgency`：是否需要立即整理记忆（high/normal/none）
- `outlineDeviation`：故事偏离 alwaysActive 世界书的预警

按 playerPace 调节 ambientBeats 数量：immersive=1 / exploratory=2 / progressing/hurrying=3。

### 3.2 导演 / 审校 / 随机事件输入

四模型都已接通：
- masterArc + stageJudge（必读）
- worldBookEntries
- anchors / longTermMemory（关键的 RAG 类输入）
- backpack + narrative + randomEventState

各 prompt 中都补了 `playerPace` 纪律：
- 导演：immersive/exploratory 时计划更细
- 审校：违反 playerPace=warning，shouldAdvance=false 时强行推进=critical
- 随机事件：服务于当前阶段，不与活跃 arc 冲突
- 决策：choices 贴合 storyFocus.thisRound

---

## 4. 周期性辅助模型

| 链路 | Prompt 文件 | Service 文件 | 触发时机 | 输入（**新加字段加粗**） | 输出 |
|---|---|---|---|---|---|
| 长期一致性记忆 | `prompts/memorySystem.ts` | `services/memoryAgent.ts` | 每完成 `settings.memoryEveryRounds` 回合 | 旧记忆 + recent + 决策结果 + npcs + backpack + scene + anchors + **outline** + **alwaysActive worldBook** | 纯文本记忆块 |
| 长历史摘要 | `prompts/summarizer.ts` | `services/contextCompressor.ts` | 未摘要历史超过 `settings.maxHistoryRounds` | 旧摘要 + 待压缩历史 + **outline** | 纯文本摘要 |
| 结局评分 | `prompts/reviewSystem.ts` | `services/reviewAgent.ts` | `phase=ended && !review` | 大纲、出身、摘要、最近消息、结局、总回合 | JSON：`AdventureReview` |

记忆模型 system prompt 第 6/7 条新增：
- 世界书一致性：记忆描述涉及机制时必须与 alwaysActive 兼容
- 大纲对齐：可在条目末尾轻标"呼应第 X 幕"

摘要器 system prompt 第 6/7 条新增：
- 大纲幕次对齐
- 伏笔保护：未解承诺/可能回收的细节必须显式保留

---

## 5. 启程页随机生成（不在每回合调度）

文件：`prompts/randomizer.ts` / Service：`services/randomizers.ts` / 模型：`settings.randomModel || settings.summaryModel || settings.storyModel`

| 功能 | System 常量 | 输出 |
|---|---|---|
| 随机故事大纲 | `RANDOM_OUTLINE_SYSTEM` | JSON：`StoryOutline` |
| 随机出身 | `RANDOM_BACKGROUND_SYSTEM` | JSON：`Background` |
| 随机开局场景 | `RANDOM_SCENE_SYSTEM` | 纯文本开局正文 |
| 随机事件池 | `RANDOM_EVENTS_SYSTEM` | JSON：`events[]` |
| 随机世界书 | `RANDOM_WORLDBOOK_SYSTEM` | JSON：`WorldBook` |

---

## 6. 玩家可配置提示词

| 配置 | 字段位置 | 默认用途 |
|---|---|---|
| 严格自定义全局/推进/揭示/选项 | `strictCustom.{globalPrompt, pacingPrompt, revealPrompt, choicePrompt}` | 跨模式通用约束 |
| 严格自定义详细大纲（仍保留 startRound/endRound 字段，但语义已软化为"建议范围"） | `strictCustom.detailedOutline[]` | 玩家明确想要的回合区间硬约束 |
| 故事 system / user 模板 | `strictCustom.storySystemPrompt / storyUserPrompt` | 极限自定义故事模型 |
| 决策 system / user 模板 | `strictCustom.decisionSystemPrompt / decisionUserPrompt` | 极限自定义决策模型 |
| 动态事件生成器 / 偏好提示词 | `authorRandomEvent.dynamic.{generatorPrompt, preferencePrompt}` | 动态事件方向 |
| 叙事导演提示词 | `authorDirector.prompt` | 阶段目标/节奏控制 |
| 逻辑审校提示词 | `authorLogicCheck.prompt` | 审校关注点 |
| 设定守护者提示词 | `authorSettingGuard.prompt` | 守护者关注点 |
| **主弧生成提示词** | `authorMasterArc.stageHint` | 玩家给主弧设计师的偏好（默认空） |
| **阶段判断提示词** | `authorStageJudge.prompt` | 玩家对节奏判断的偏好 |

---

## 7. 非模型但会影响 prompt 的拼装逻辑

| 文件 | 作用 |
|---|---|
| `services/worldBookMatcher.ts` | 根据最近文本和玩家输入命中世界书条目 → 故事 prompt 的 worldBookAlwaysBlock / worldBookTriggeredBlock |
| `services/randomEventScheduler.ts` | 游历/事件池模式按概率挑选事件 → 故事 prompt 的 specialBlock |
| `lib/items.ts` `formatItemsForPrompt` | 背包 / 使用道具的统一格式化 |
| `lib/authorMode.ts` `formatStoryArcForPrompt` | 事件弧统一格式化（被多处复用） |
| `store/useGameStore.ts` `normalize*` 函数 | 持久化加载时把存档里的 narrative / settingGuard / masterArc 等做兼容性 normalize |
| `store/useGameStore.ts` `mergeNpcDetails` | NPC.details 的 PATCH 合并（5 条上限 + 新优先 + 旧补足） |

---

## 8. 当前 prompt 输出协议概览

| Prompt | JSON | 备注 |
|---|---|---|
| 故事模型 | 否 | 流式正文 |
| 决策模型 | 是 | choices/grants/destroys/itemPatches/npcs/currentScene/availableScenes |
| 决策追踪模型 | 是 | 无 choices |
| **主弧生成** | 是 | `MasterArcState`（title/summary/stages[]，stages 不带 startRound/endRound） |
| **阶段判断** | 是 | `StageJudgeResult`（playerIntent/Pace/Focus + stageStatus） |
| 设定守护者 | 是 | `SettingGuardResult`（patches/candidates/preference/ambientBeats/memoryUrgency/deviation） |
| 动态长线事件 | 是 | `{trigger, arc?}` |
| 叙事导演 | 是 | `NarrativePlanState`（去掉了 nextFewRoundsPlan[].startRound/endRound——见已知问题） |
| 逻辑审校 | 是 | `AuthorLogicReviewState`（含 severity 标准） |
| 长期记忆 | 否 | 纯文本记忆块 |
| 摘要 | 否 | 纯文本散文 |
| 启程随机生成 | 是 | 各类型 JSON（开局场景除外） |
| 结局评分 | 是 | `AdventureReview` |

---

## 9. 调优时可能需要回头改的位置（按影响面排序）

1. **故事模型 prompt 长度** —— 当前最大瓶颈。`storySystem.ts` 已做：NPC 取前 10、anchors 单条 200 字截断、logicReview 收紧、ambientBeats 按 playerPace 调节。下一步要做"块级长度预算 + 超预算时按优先级裁剪"。
2. **决策模型 details PATCH 协议** —— `decisionSystem.ts` 已强化（含 2 个例子）。如果跑长流程仍出现 details 重复输出导致 store 层频繁去重，需进一步加强例子或改 store 合并策略。
3. **stageJudge 节奏判定** —— 文档中 4 档 pace 标准已具体（含具体玩家输入例子）。如果实测 immersive/exploratory 误判率高，再补具体反例。
4. **导演 horizonRounds 默认 6 + everyRounds 默认 2** —— 阶段化后回合数语义弱化，但导演 prompt 仍按"未来 6 回合"规划。需要把 horizonRounds 改为"未来 N 个节拍"或并入主弧 expectedBeats 推进。
5. **主弧生成的 stages 数量稳定性** —— sanitizeMasterArc 当前 stages.length < 2 才返回 undefined → fallback。如果模型经常给 1 个 stage，应该让它重试一次再 fallback。

---

## 10. 已知质量风险与 watchlist

详见 `docs/known-issues.md`。
