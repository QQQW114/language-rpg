# language-rpg 提示词列表

> 用途：给后续专门优化提示词的模型/开发者快速定位所有 LLM 调用链路。  
> 当前版本：截至 `282e31e feat: add author logic consistency review` 后整理。

## 1. 核心回合链路

| 链路 | Prompt 文件 | Service 文件 | 使用模型设置 | 触发时机 | 输出形态 | 主要输入 |
|---|---|---|---|---|---|---|
| 故事模型 | `src/prompts/storySystem.ts` + `src/lib/strictCustom.ts` | `src/services/storyAgent.ts` | `settings.storyModel` | `GamePage.runStory`，每次进入 `story` phase | 流式自然语言正文 | 大纲、出身、世界书、摘要、长期记忆、历史、玩家输入、背包、NPC、场景、叙事弧、导演计划、逻辑审校、随机事件 |
| 决策模型（带选项） | `src/prompts/decisionSystem.ts` + `src/lib/strictCustom.ts` | `src/services/decisionAgent.ts` | `settings.decisionModel` | `choices` phase 且没有 `lastChoices` 时 | JSON | 最新故事、摘要、最近上下文、背包 JSON、NPC JSON、当前场景 |
| 决策模型（仅追踪） | `src/prompts/decisionSystem.ts` 的 `DECISION_TRACKING_SYSTEM` | `src/services/decisionAgent.ts` | `settings.decisionModel` | 自由行动回合故事完成后 | JSON，不生成 choices | 同上，但只维护道具/NPC/场景 |

### 故事模型可替换模板

来源：`src/lib/strictCustom.ts`

| 模板/块 | 字段 | 说明 |
|---|---|---|
| 默认 system 模板 | `DEFAULT_STORY_SYSTEM_TEMPLATE` | 主故事模型 system prompt，可被严格自定义/执笔模式覆盖 |
| 默认 user 模板 | `DEFAULT_STORY_USER_TEMPLATE` | 故事模型 user prompt，默认只放 `{{defaultUserMessage}}` |
| 严格自定义故事块 | `buildStrictCustomStoryBlock` | 注入全局叙事约束、推进粒度、隐藏设定揭示、详细大纲 |
| 模板变量 | `roundInfo` / `outlineBlock` / `storyArcBlock` / `backgroundBlock` / `worldBookAlwaysBlock` / `worldBookTriggeredBlock` / `summaryBlock` / `memoryBlock` / `narrativePlanBlock` / `logicReviewBlock` / `npcsBlock` / `anchorsBlock` / `backpackBlock` / `currentSceneBlock` / `strictCustomBlock` / `usedItemsBlock` / `writingRulesBlock` / `styleAddendumBlock` / `specialBlock` | 这些变量会渲染进故事 system prompt；旧自定义模板漏掉 `memoryBlock`、`storyArcBlock`、`narrativePlanBlock`、`logicReviewBlock` 时会 fallback 追加 |

### 决策模型可替换模板

来源：`src/lib/strictCustom.ts`、`src/prompts/decisionSystem.ts`

| 模板/块 | 字段 | 说明 |
|---|---|---|
| 默认 system | `DECISION_SYSTEM` | 生成选项、道具、NPC、场景 JSON |
| 追踪 system | `DECISION_TRACKING_SYSTEM` | 自由行动回合只更新状态，不生成选项 |
| 默认 user | `DEFAULT_DECISION_USER_TEMPLATE` / `buildDecisionUser` | 组装最新故事、背包、NPC、场景等 |
| 严格自定义决策块 | `buildStrictCustomDecisionBlock` | 注入选项规则 |
| 模板变量 | `summaryBlock` / `recentTextBlock` / `latestStory` / `backpackSummary` / `backpackJsonBlock` / `npcBlock` / `npcJsonBlock` / `currentSceneBlock` / `strictCustomDecisionBlock` / `defaultDecisionUserPrompt` | 可用于玩家自定义决策 user prompt |

## 2. 执笔模式新增模型

| 链路 | Prompt 文件 | Service 文件 | 使用模型设置 | 触发时机 | 输出形态 | 主要输入 |
|---|---|---|---|---|---|---|
| 动态长线随机事件模型 | `src/prompts/authorRandomEventSystem.ts` | `src/services/authorRandomEventAgent.ts` | `settings.randomModel || settings.decisionModel || settings.storyModel` | 一轮故事 + 决策/追踪完成后，检查下一回合是否触发 | JSON：`trigger` + `arc` | 大纲、出身、摘要、长期记忆、最近上下文、最新故事、NPC、场景、随机事件配置、参考事件 |
| 叙事导演 / 大纲映射模型 | `src/prompts/authorDirectorSystem.ts` | `src/services/authorDirectorAgent.ts` | `settings.randomModel || settings.decisionModel || settings.storyModel` | 按 `authorDirector.everyRounds` 或计划过期刷新 | JSON：`NarrativePlanState` | 大纲、严格详细大纲、出身、摘要、长期记忆、最近上下文、最新故事、NPC、场景、事件弧、玩家导演提示词 |
| 逻辑审校 / 连续性修复模型 | `src/prompts/authorLogicCheckSystem.ts` | `src/services/authorLogicCheckAgent.ts` | `settings.randomModel || settings.decisionModel || settings.storyModel` | 按 `authorLogicCheck.everyRounds` 审校 | JSON：`AuthorLogicReviewState` | 大纲、出身、摘要、长期记忆、最近上下文、最新故事、NPC、背包、场景、导演计划、事件弧、玩家审校提示词 |

### 执笔模式玩家可配置提示词

来源：`src/lib/authorMode.ts`、`src/pages/SetupPage.tsx`

| 配置 | 字段 | 默认用途 |
|---|---|---|
| 动态随机事件生成提示词 | `authorRandomEvent.dynamic.generatorPrompt` | 告诉动态事件模型优先参照上文人物、关系、承诺、地点等 |
| 动态随机事件偏好提示词 | `authorRandomEvent.dynamic.preferencePrompt` | 告诉动态事件模型事件类型偏好、阶段性、收束方式 |
| 叙事导演提示词 | `authorDirector.prompt` | 控制阶段目标、大纲贴合、节奏、短期计划 |
| 逻辑审校提示词 | `authorLogicCheck.prompt` | 控制审校关注点，如人物、时间天气、伏笔、道具、大纲偏离 |

## 3. 周期性辅助模型

| 链路 | Prompt 文件 | Service 文件 | 使用模型设置 | 触发时机 | 输出形态 | 主要输入 |
|---|---|---|---|---|---|---|
| 长历史摘要 | `src/prompts/summarizer.ts` | `src/services/contextCompressor.ts` | `settings.summaryModel || settings.storyModel` | 未摘要历史超过 `settings.maxHistoryRounds` 后 | 纯文本摘要 | 旧摘要 + 待压缩历史 |
| 长期一致性记忆 | `src/prompts/memorySystem.ts` | `src/services/memoryAgent.ts` | `settings.memoryModel || settings.summaryModel || settings.storyModel` | 每完成 `settings.memoryEveryRounds` 回合 | 纯文本记忆块 | 旧记忆、最近对话、决策结果、NPC、背包、当前场景 |
| 结局评分 | `src/prompts/reviewSystem.ts` | `src/services/reviewAgent.ts` | `settings.summaryModel || settings.storyModel` | `ended` phase 且没有 review 时 | JSON：`AdventureReview` | 大纲、出身、角色名、摘要、最近消息、结局、总回合 |

## 4. 启程页随机生成模型

文件：`src/prompts/randomizer.ts`  
Service：`src/services/randomizers.ts`  
模型设置：`settings.randomModel || settings.summaryModel || settings.storyModel`

| 功能 | System 常量 | User 构造函数 | 触发入口 | 输出 |
|---|---|---|---|---|
| 随机故事大纲 | `RANDOM_OUTLINE_SYSTEM` | `buildRandomOutlineUser` | 启程页“随机生成新故事” | JSON：`StoryOutline` |
| 随机出身 | `RANDOM_BACKGROUND_SYSTEM` | `buildRandomBackgroundUser` | 启程页“随机出身” | JSON：`Background` |
| 随机开局场景 | `RANDOM_SCENE_SYSTEM` | `buildRandomSceneUser` | 启程页侧栏“随机开局” | 纯文本开局正文 |
| 随机事件池 | `RANDOM_EVENTS_SYSTEM` | `buildRandomEventsUser` | 游历/执笔事件池生成、动态事件参考生成 | JSON：`events[]` |
| 随机世界书 | `RANDOM_WORLDBOOK_SYSTEM` | `buildRandomWorldBookUser` | 启程页“随机世界书” | JSON：`WorldBook` |

## 5. 非模型但会影响 prompt 的拼装逻辑

| 文件 | 作用 |
|---|---|
| `src/services/worldBookMatcher.ts` | 根据最近文本和玩家输入命中世界书条目，传入故事 prompt |
| `src/services/randomEventScheduler.ts` | 游历/事件池模式中按概率挑选随机事件，传入故事 prompt 的 `specialBlock` |
| `src/lib/items.ts` | `formatItemsForPrompt` 格式化背包/使用道具 |
| `src/lib/authorMode.ts` | 默认执笔模式配置、事件弧 prompt 格式化 |
| `src/store/useGameStore.ts` | 保存/标准化 NPC、道具、场景、叙事弧、导演计划、审校结果 |

## 6. 后续重写提示词建议顺序

1. `storySystem.ts` + `strictCustom.ts`：主故事模型最关键，决定最终体验。
2. `decisionSystem.ts`：维护 NPC/道具/场景一致性的基础。
3. `authorDirectorSystem.ts`：决定“小说感”的阶段目标和大纲映射。
4. `authorLogicCheckSystem.ts`：决定连续性修复是否有效。
5. `authorRandomEventSystem.ts`：决定动态长线事件是否自然。
6. `memorySystem.ts`：决定长期记忆块质量。
7. `summarizer.ts`：决定长历史压缩质量。
8. `randomizer.ts`：影响启程页生成质量，但不直接影响运行中故事链路。
9. `reviewSystem.ts`：只影响结束评分，可最后处理。

## 7. 当前 prompt 输出协议概览

| Prompt | 是否 JSON | 备注 |
|---|---|---|
| 故事模型 | 否 | 流式正文，不应输出标题/解释/选项 |
| 决策模型 | 是 | choices/grants/destroys/itemPatches/npcs/currentScene/availableScenes |
| 决策追踪模型 | 是 | 无 choices，仅状态追踪 |
| 动态事件模型 | 是 | `trigger=false` 或 `trigger=true + arc` |
| 叙事导演模型 | 是 | 当前幕、阶段目标、下一回合焦点、未来计划、节奏建议、风险 |
| 逻辑审校模型 | 是 | 总评、issues、repairDirectives、nextRoundWarnings |
| 记忆模型 | 否 | 纯文本长期记忆块 |
| 摘要模型 | 否 | 纯文本摘要 |
| 随机生成大纲/出身/事件/世界书 | 是 | 随机开局场景除外 |
| 随机开局场景 | 否 | 纯文本开局 |
| 结局评分 | 是 | `AdventureReview` |
