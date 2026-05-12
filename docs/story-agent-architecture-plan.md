# 故事 Agent 化重构计划

> 本文用于记录最近确定的方向：先不急于继续堆提示词，而是把执笔模式重构为“以大纲为最高约束、以事件为核心叙事单位、由回合司辰调度规划层、最后交给故事模型执行”的故事 Agent 系统。

## 1. 总目标

当前项目的核心目标逐步转为：

> 以大纲为最高约束，把主弧拆成阶段，把阶段拆成小事件；小事件根据玩家行为动态生成、推进、失败、延后或替换；调度层负责判断调用哪些规划模型，规划层负责补全逻辑，故事模型只负责把本回合叙事包写成正文。

也就是说，故事模型不再承担完整的“想剧情”职责，而是成为高质量执行者。

## 2. 项目定位

执笔模式优先定位为：

> 强大纲互动小说 / 故事 Agent。

特点：

- 大纲不是普通参考，而是故事总体方向。
- 玩家可以接受、拒绝、绕开或改写某个事件。
- 玩家行为不会轻易导致故事崩坏，而是影响事件结果、人物关系、世界进度和后续替代事件。
- 系统会尽量把玩家行为自然映射回大纲阶段，而不是强行否定玩家。

## 3. 叙事层级

暂定上下级关系：

```txt
世界书硬设定
 ↓
大纲
 ↓
主弧
 ↓
阶段目标
 ↓
阶段事件 / 当前小事件
 ↓
本回合叙事包
 ↓
故事正文
 ↓
决策记录 / 状态更新 / 记忆沉淀 / 司书库沉淀
```

优先级建议：

1. 世界书硬设定
2. 已发生正文
3. 玩家当前输入
4. 大纲
5. 主弧
6. 当前阶段目标
7. 当前事件规划
8. 风格偏好
9. 模型自由发挥

## 4. 调度层：回合司辰

回合司辰是轻量但核心的调度模型。它不细写剧情，也不直接做复杂人物分析，而是捕捉方向并决定是否调用下级模型。

### 4.1 回合司辰职责

回合司辰主要判断：

- 玩家当前行为是否仍在当前事件内？
- 是否处于当前事件的转折点？
- 是否需要结算当前事件？
- 是否可能触发新事件？
- 是否可能推进或偏离当前主弧阶段？
- 是否涉及人物、场景、伏笔、世界书、任务或大纲映射？
- 本回合需要调用哪些规划模型？

### 4.2 回合类型

回合司辰应输出一个清晰的回合类型：

```txt
continue_current_event       继续当前事件，小幅推进
event_turning_point          当前事件出现转折
event_completion_check       检查事件完成 / 失败 / 放弃
new_event_candidate          可能触发新事件
stage_transition_candidate   可能进入新主弧阶段
free_exploration             普通探索 / 过渡
```

### 4.3 轻量回合与关键回合

如果玩家正在沉浸于一个已经确定小目标的事件中，只做小动作、小回应、小探索，则应走轻量链路：

```txt
回合司辰
 ↓
故事模型
 ↓
决策记录员
```

如果玩家行为处于关键规划点，例如进入新地点、遇到重要人物、事件完成/失败、阶段可能推进，则走较完整链路：

```txt
回合司辰
 ↓
大纲映射 / 阶段判断
 ↓
人物分析
 ↓
场景分析
 ↓
事件规划
 ↓
叙事导演整合
 ↓
故事模型
 ↓
决策记录 / 记忆 / 司书库更新
```

### 4.4 工具调用策略

长期目标是让回合司辰可通过工具调用其他规划模型。

第一阶段建议先实现为：

```txt
回合司辰输出调用计划
 ↓
程序按计划调用对应模型
 ↓
叙事导演统一整合
```

等协议稳定后，再升级为回合司辰多轮工具调用。

### 4.5 当前落地状态（维护记录）

截至当前重构轮次，程序已具备第一版“司辰调度 → 独立规划层 → 导演整合 → 故事执行”链路：

```txt
回合司辰 authorOrchestrator
 ↓
大纲映射 outlineMapper
 ↓
阶段判断 stageJudge / 设定守护 settingGuard
 ↓
人物规划 characterPlanner
 ↓
场景规划 scenePlanner
 ↓
事件规划 eventPlanner
 ↓
叙事导演 director
 ↓
故事写手 story
```

其中 `callOrder` 仍由回合司辰一次性输出，程序按顺序调用；尚未实现“司辰在工具调用后动态二次决策”的多轮闭环。

## 5. 规划层模型

规划层负责补全故事逻辑，不直接写正文。

### 5.1 大纲映射模型

职责：

- 判断当前剧情对应大纲哪一段。
- 判断玩家行为能否映射到当前阶段目标。
- 判断当前阶段缺少什么桥接事件。
- 判断是否需要推进世界进度。
- 判断是否可能进入下一阶段。

它的核心价值是把“几幕式大纲”转成可执行的阶段需求和事件需求。

当前实现文件：

- `src/prompts/authorOutlineMapperSystem.ts`
- `src/services/authorOutlineMapperAgent.ts`
- 状态字段：`authorNarrative.outlineMapping`

### 5.2 阶段判断员

职责：

- 判断当前阶段完成度。
- 判断玩家意图和节奏。
- 判断当前是否该推进主弧阶段。
- 给出阶段完成或暂缓的理由。

阶段判断员不负责生成具体事件，但可以指出阶段需要什么类型的推进。

### 5.3 人物分析模型

职责：

- 判断当前行为牵动了哪些角色。
- 判断角色是否适合登场。
- 判断角色登场是否对当前事件、主弧或大纲有意义。
- 分析角色当前目的、表面态度、隐藏动机、情绪变化。
- 给出本回合可表现内容和不可泄露内容。

示例：玩家前往公园，而公园曾是小晴的重要出现地点；人物分析模型判断小晴是否应出现在公园、为何出现、她想得到什么、她是否会主动接近主角。

当前实现文件：

- `src/prompts/authorCharacterPlannerSystem.ts`
- `src/services/authorCharacterPlannerAgent.ts`
- 状态字段：`authorNarrative.characterPlan`

### 5.4 场景分析模型

职责：

- 分析当前场景的时间、天气、空间结构和氛围。
- 判断场景里有哪些叙事资源。
- 判断场景是否支持当前事件或角色登场。
- 生成可用于故事模型的场景细节。

当前实现文件：

- `src/prompts/authorScenePlannerSystem.ts`
- `src/services/authorScenePlannerAgent.ts`
- 状态字段：`authorNarrative.scenePlan`

### 5.5 事件规划模型

职责：

- 生成、推进、暂停、失败、完成小事件。
- 定义事件表面目标、隐藏目的、完成条件、失败条件、放弃条件。
- 定义事件对世界进度、阶段进度、人物关系的影响。
- 定义本回合写作边界。

事件规划模型是“强化随机事件系统”的自然升级：事件不再只是随机触发，而是由大纲、主弧、人物、场景和玩家行为共同产生。

当前实现文件：

- `src/prompts/authorEventPlannerSystem.ts`
- `src/services/authorEventPlannerAgent.ts`
- 状态字段：`authorNarrative.eventPlan`
- `eventUpdates` 会通过 store action 进入事件生命周期更新。

### 5.6 伏笔 / 承诺模型

职责：

- 维护玩家承诺。
- 维护角色承诺。
- 维护未解决问题。
- 维护伏笔和可回收时机。
- 判断当前玩家行为是否触发某个承诺或伏笔。

示例：玩家曾答应小晴明天见；当时间推进到第二天，回合司辰应能意识到需要检查承诺。

### 5.7 叙事导演

职责：

- 整合各规划模型输出。
- 生成“本回合叙事包”。
- 明确故事模型本回合写什么、不写什么、写到哪里停。
- 让故事模型知道全貌，但只执行局部。

## 6. 事件作为核心叙事单位

故事应由一串带生命周期的小事件组成，而不是一回合一回合随意续写。

### 6.1 事件生命周期

暂定状态：

```txt
candidate    可触发
active       进行中
progressing  推进中
turning      转折中
completed    完成
soft_failed  轻度失败，可补救
missed       错过
delayed      延后
reframed     被玩家行为改写
archived     归档
```

### 6.2 事件字段

建议事件至少包含：

- 事件名
- 所属主弧阶段
- 来源：大纲 / 主弧 / 玩家行为 / 人物 / 场景 / 随机
- 参与人物
- 表面目标
- 隐藏目的
- 触发条件
- 当前状态
- 当前事件阶段
- 完成条件
- 失败条件
- 放弃条件
- 预计提高的世界进度
- 预计影响的角色关系
- 当前事件进度
- 本回合写作边界

### 6.3 事件失败

事件失败不是游戏失败。

推荐规则：

- 玩家拒绝或绕开事件时，事件可进入 `soft_failed`、`delayed` 或 `reframed`。
- 失败可能轻微影响人物关系或世界进度。
- 系统可以后续生成替代事件继续推进阶段。
- 已错过的重要机会可以进入 `missed`，但不应轻易造成故事无法继续。

## 7. 进度系统

建议引入几类进度：

### 7.1 世界 / 阶段进度

表示当前大纲阶段完成情况。

```txt
当前阶段：小晴关系靠近
阶段进度：43/100
```

### 7.2 事件完成度

表示当前小事件走到哪里。

```txt
当前事件：雨后公园偶遇
事件进度：2/5
当前节点：刚见面
```

### 7.3 角色关系进度

建议半数值化：数值 + 文本状态共存。

```txt
小晴：
好感 62
信任 45
暧昧 38
疑虑 20
文本状态：在意主角，但不愿直接承认；对主角最近的变化感到疑惑。
```

### 7.4 节奏状态

用于控制故事推进速度。

```txt
当前节奏：沉浸推进
建议：本回合只推进一个微节拍，不进入表白。
```

## 8. 本回合叙事包

规划层最后应输出统一的本回合叙事包，供故事模型执行。

叙事包建议包含：

```txt
【本回合目标】
本回合要完成的最小叙事任务。

【必须遵守】
世界书硬设定、已发生事实、玩家输入、大纲阶段。

【当前事件】
事件名、事件状态、事件阶段、事件目标。

【出场角色】
角色是否出场、表面目的、真实目的、情绪、可表现内容、不可泄露内容。

【场景资源】
时间、天气、地点、氛围、可用细节。

【写作边界】
本回合写到哪里停止。

【成功标准】
本回合写成什么样算达成规划目标。

【失败 / 避免】
不得提前完成的事、不得泄露的事、不得违反的设定。
```

## 9. 故事模型定位

故事模型只负责执行叙事包：

- 根据叙事包写正文。
- 知道事件全貌，但只写到指定边界。
- 隐藏动机只能通过动作、语气、氛围暗示，不得直接旁白泄露。
- 不替玩家做重大决定。
- 不跳过事件生命周期。
- 不脱离大纲、主弧和事件规划自由发挥。

## 10. 分步推进建议

### Phase 1：协议先行

目标：先把链路稳定下来。

工作：

1. 定义回合司辰输出协议。
2. 定义事件结构和事件生命周期。
3. 定义本回合叙事包格式。
4. 修改故事模型提示词，使其明确只执行叙事包。

### Phase 2：事件系统升级

目标：让当前随机事件系统升级成“阶段事件 / 动态事件”。

工作：

1. 建立当前事件状态。
2. 支持事件完成、失败、延后、改写。
3. 让事件影响世界进度和人物关系。
4. 让回合司辰判断当前是否仍在事件内。

### Phase 3：大纲映射模型

目标：把大纲拆成可执行阶段需求。

工作：

1. 分析当前剧情对应大纲哪一段。
2. 输出当前阶段缺少的事件类型。
3. 给事件规划模型提供阶段需求。
4. 给阶段判断员提供更清晰的完成标准。

### Phase 4：人物与场景规划

目标：让人物和场景不再随机出现，而是服务于事件和大纲。

工作：

1. 人物分析模型判断角色是否出场和为何出场。
2. 场景分析模型补充场景资源。
3. 叙事导演整合人物、场景、事件到叙事包。

### Phase 5：工具调用升级

目标：让回合司辰或关键规划模型可以主动查资料、调用模型。

工作：

1. 先采用“回合司辰输出调用计划，程序执行”的方式。
2. 稳定后再升级为回合司辰多轮工具调用。
3. 限制每回合最大调用数和最大工具轮数，控制成本与延迟。

## 11. 当前共识

- 推荐采用强大纲互动小说方向。
- 玩家可以改写事件路径，但系统仍努力完成大纲阶段。
- 事件失败采用轻惩罚或替代事件，不轻易阻断故事。
- 回合司辰先轻量化，负责调度，不承担细致分析。
- 事件是核心叙事单位。
- 故事模型是执行者，不再自由规划完整剧情。
- 先落协议和计划，再分步推进代码。

## 12. 当前落地状态（维护记录）

截至本轮维护，已先按“协议先行 → 事件系统 → 独立规划层 → 调度顺序 → 导演整合 → 故事执行”的顺序完成第一批代码落地：

- 回合司辰协议已包含 `turnType`、`planningMode`、`focusAreas`、`planSignals`、`callOrder` 与各模型 `calls`。
- 故事生成前的执笔模式链路已按 `callOrder` 过滤执行可前置模型：大纲映射、阶段判断、设定守护、人物规划、场景规划、事件规划、叙事导演。
- 事件弧 `StoryArc` 已支持生命周期、明面目标、完成/失败/放弃标准、世界进度影响、关系影响、完成度和写作边界。
- 动态随机事件模型已要求输出上述事件字段；程序会在待触发、激活、推进、完成时维护生命周期和进度。
- 叙事导演已可通过 `eventUpdates` 更新已有事件弧的生命周期与完成度，支持完成、错过、延后、改写和轻度失败的第一版状态流转。
- 独立大纲映射模型已输出 `outlineMapping`，用于把大纲、当前剧情和桥接小事件关联起来。
- 独立人物规划、场景规划、事件规划模型已分别写入 `authorNarrative.characterPlan / scenePlan / eventPlan`。
- 叙事导演已输出更结构化的 `writingBrief`，其中包含当前小事件、牵动角色和本回合场景规划。
- 故事模型提示词已注入“大纲映射 / 人物规划 / 场景规划 / 事件规划 / 本回合叙事包”，并要求只执行本回合边界，不提前完成事件或剧透隐藏动机。
- 决策记录模型已能读取大纲映射、规划层摘要和叙事包摘要，以便更新 NPC、场景、道具时保持同一叙事方向。

仍未完成 / 需要后续实测打磨的部分：

- 工具调用已接入主要模型的只读司书库，但尚未让回合司辰通过多轮工具直接驱动“调用其他模型”。
- 每个模型可调用哪些工具尚未细化；当前先使用同一套只读工具运行时，后续需要按模型职责收窄。
- 事件完成/失败/放弃已有 `eventPlanner / director eventUpdates` 入口，但仍未形成完整“事件结算闭环”，后续需要靠实测调校触发时机、状态写入和提示词。
- 新增规划层提示词只是可运行版本，仍需要人工重写和压缩。
- 各规划模型的触发阈值目前偏保守，实际成本、延迟与故事质量需要浏览器端冒烟测试。
- 司书库写入工具仍未开放；当前模型只能读取，不能直接维护角色/场景/伏笔文件。

## 13. 当前实际调用链（维护模型接手用）

本节记录当前代码里的实际链路，避免后续只看概念文档时误判。

### 13.1 新旅程进入流程

```txt
SetupPage 点击启程
 ↓
创建存档，写入开局文本 / fallback 主弧
 ↓
进入 GamePage，不在 SetupPage 等待模型
 ↓
GamePage 检测 author 模式 + 第 1 回合 + 无导演计划
 ↓
先调用主弧模型 requestMasterArc
 ↓
再调用叙事导演 requestAuthorDirectorPlan
 ↓
写入 authorNarrative.masterArc / authorNarrative.plan
 ↓
玩家输入框出现，正式开始
```

对应核心位置：

- `src/pages/SetupPage.tsx`
- `src/pages/GamePage.tsx`
- `src/services/authorMasterArcAgent.ts`
- `src/services/authorDirectorAgent.ts`

### 13.2 执笔模式故事回合主链路（当前代码）

当前故事生成前后的完整链路如下。实际是否调用由回合司辰 `calls + callOrder`、模型配置开关、固定频率和代码兜底共同决定。

```txt
advanceAuthorArcs
 ↓
回合司辰 requestAuthorOrchestrator
 ↓
按 callOrder 过滤执行故事前置模型
   1. outlineMapper      大纲映射
   2. stageJudge         阶段 / 玩家意图判断
   3. settingGuard       设定守护
   4. characterPlanner   人物规划
   5. scenePlanner       场景规划
   6. eventPlanner       事件规划
   7. director           叙事导演整合
 ↓
故事模型 requestStory
 ↓
写入 assistant 正文 + 工具阅读记录
 ↓
激活待触发事件 pendingEvent（如命中本回合）
 ↓
决策记录模型 requestChoices
   - includeChoices=false：自由行动回合，只记录 NPC / 道具 / 场景 / 状态
   - includeChoices=true：选择回合，额外生成选项
 ↓
按司辰与频率进行后处理
   - randomEvent：动态长线事件，为下一回合准备 pendingEvent
   - director：故事后刷新导演计划（若司辰要求或兜底触发）
   - logicCheck：连续性审校
   - memory：长期记忆整理
   - summary：上下文压缩
```

说明：

- `callOrder` 是司辰建议顺序，但程序只执行“允许故事前置”的模型；`randomEvent / logicCheck / summary` 多数是后处理。
- 默认前置模型集合为：`outlineMapper → stageJudge → settingGuard → characterPlanner → scenePlanner → eventPlanner → director`。
- 若回合司辰未运行或失败，会使用 fallback 调度；高风险回溯/补写请求会倾向触发完整链路。
- 记忆更新仍主要由固定频率、设定守护 urgency 或后处理触发；不是每回合必跑。
- 随机事件生成仍是“下一回合注入”的后处理；不会在当前正文已经开始时临时插入。

核心代码位置：

- `src/pages/GamePage.tsx`：`runStory`、`maybeRunAuthorOrchestrator`、`maybeRunOutlineMapper`、`maybeRunStageJudge`、`maybeRunSettingGuard`、`maybeRunCharacterPlanner`、`maybeRunScenePlanner`、`maybeRunEventPlanner`、`maybeUpdateAuthorDirectorPlan`
- `src/store/useGameStore.ts`：事件推进、事件更新、叙事状态归一化、规划状态写入

### 13.3 模型调用表 / 输入输出依赖

| 顺序 | 模型 / 代码入口 | 触发时机 | 主要吃什么输入 | 主要输出 / 写入 | 下游谁吃它 |
|---:|---|---|---|---|---|
| 0 | 主弧规划员 `requestMasterArc` | 新旅程进入 GamePage 后，若执笔模式缺少主弧 | 原始大纲、出身、角色名、严格自定义详细大纲、世界书、开局文本 | `authorNarrative.masterArc` | `outlineMapper`、`stageJudge`、`director`、`story`、`decision` |
| 1 | 回合司辰 `requestAuthorOrchestrator` | 每个故事回合开始前；受 `minIntervalRounds` 控制 | 当前回合、玩家输入、最新故事、最近上下文、摘要、长期记忆、NPC、背包、场景、主弧、导演计划、事件状态、最近调用时间 | `authorNarrative.orchestrator`：`turnType / planningMode / focusAreas / planSignals / calls / callOrder` | `GamePage.runStory` 用它决定本回合调用哪些模型；后处理也读 `calls.randomEvent / logicCheck / memory / summary` |
| 2 | 大纲映射员 `requestAuthorOutlineMapping` | 司辰 `outlineMapper.run=true`；fallback/高风险回溯时常触发 | 原始大纲、世界书、主弧、上次导演计划、上次映射、最近上下文、最新故事、玩家输入、摘要、长期记忆、NPC、场景、事件弧、玩家标记、司书库工具 | `authorNarrative.outlineMapping`：当前对应大纲、贴合状态、阶段目标、阶段进度、缺少桥接、候选事件、偏离风险、下一里程碑 | `characterPlanner`、`scenePlanner`、`eventPlanner`、`director`、`story`、`decision`、司辰下轮判断 |
| 3 | 阶段判断员 `requestStageJudge` | 司辰 `stageJudge.run=true`；阶段可能变化/玩家意图需重判时 | 主弧当前阶段、玩家输入、最近上下文、摘要、长期记忆、NPC、当前场景、已有事件弧、世界书、玩家标记、上次阶段判断、司书库工具 | `authorNarrative.stageJudge`：玩家意图、节奏、阶段完成度、是否推进阶段、storyFocus；必要时推进 `masterArc.currentStageIndex` | `settingGuard`、各规划模型、`director`、`story`、`decision`；决定故事本回合做什么、做多少 |
| 4 | 设定守护者 `requestSettingGuard` | 司辰 `settingGuard.run=true`；设定冲突/世界书扩展/偏好变化时 | 大纲、出身、世界书全集、玩家输入、最近上下文、摘要、长期记忆、NPC、背包、场景、玩家标记、主弧/导演/事件状态、司书库工具 | `authorNarrative.settingGuard`：设定补丁、候选世界书、环境侧建议、玩家偏好、偏离风险、记忆 urgency | `director`、`story`、`decision`；若 `memoryUrgency=high`，故事前可能立即触发 `memoryNow` |
| 5 | 人物规划员 `requestAuthorCharacterPlan` | 司辰 `characterPlanner.run=true`；涉及关键 NPC、关系、登场判断时 | 大纲、世界书、`outlineMapping`、`stageJudge`、上次人物规划、导演计划、事件弧、NPC 状态、背包、场景、最近上下文、最新故事、玩家输入、摘要/长期记忆、玩家标记、司书库工具 | `authorNarrative.characterPlan`：本回合牵动角色、角色表面目的、隐藏动机、可表现行为、不可泄露内容、关系信号、不应登场角色、人物风险 | `scenePlanner`、`eventPlanner`、`director`、`story`、`decision` |
| 6 | 场景规划员 `requestAuthorScenePlan` | 司辰 `scenePlanner.run=true`；地点/时间/天气/空间逻辑重要时 | 大纲、世界书、`outlineMapping`、`stageJudge`、`characterPlan`、当前场景、可达场景、事件弧、NPC、背包、最近上下文、最新故事、玩家输入、摘要/长期记忆、玩家标记、司书库工具 | `authorNarrative.scenePlan`：地点、时间、天气、氛围、场景资源、限制、场景连续性逻辑、机会、风险 | `eventPlanner`、`director`、`story`、`decision` |
| 7 | 事件规划员 `requestAuthorEventPlan` | 司辰 `eventPlanner.run=true`；事件转折/完成/失败/延后/新事件候选时 | 大纲、世界书、`outlineMapping`、`stageJudge`、`characterPlan`、`scenePlan`、现有事件弧、随机事件状态、NPC、背包、场景、最近上下文、最新故事、玩家输入、摘要/长期记忆、玩家标记、司书库工具 | `authorNarrative.eventPlan`：当前事件、事件生命周期、候选事件、写作边界、成功标准、避免事项、`eventUpdates` | `director`、`story`、`decision`；`eventUpdates` 会进入 `applyAuthorEventUpdates` 更新事件弧 |
| 8 | 叙事导演 `requestAuthorDirectorPlan` | 司辰 `director.run=true`；计划缺失/过期/未覆盖下一回合/强制刷新时 | 大纲、出身、世界书、严格自定义详细大纲、摘要、长期记忆、最近上下文、最新故事、NPC、背包、当前场景、主弧、司辰判断、`outlineMapping / characterPlan / scenePlan / eventPlan`、设定守护、阶段判断、事件弧、司书库工具 | `authorNarrative.plan`：短期计划、`writingBrief`、导演内 `outlineMapping` 兼容字段、`eventUpdates`、节奏建议、风险提示 | `story` 最优先执行 `writingBrief`；`decision` 参考计划；`randomEvent / logicCheck / memory` 也可参考 |
| 9 | 故事写手 `requestStory` | 前置链完成后生成本回合正文 | 大纲、主弧、阶段判断、独立规划层、导演计划/叙事包、设定守护、逻辑审校、事件弧、世界书、长期记忆、玩家标记、NPC、背包、当前场景、最近历史、玩家输入、严格自定义/故事风格、司书库工具 | assistant 正文、`thinking`、工具阅读活动；写入 `history` | `decision`、`memory`、`randomEvent`、`director` 后刷新、`logicCheck`、`summary`、回合卷宗 |
| 10 | 决策记录员 `requestChoices` | 故事正文后；选择回合或自由行动回合都会调用 | 最新故事、最近上下文、大纲、出身、世界书、背包 JSON、NPC JSON、长期记忆、玩家标记、当前场景、主弧/阶段判断/规划层/导演计划/事件弧、司书库工具 | `choices`、物品增删改、NPC 增删改/好感、当前场景、可达场景；写入 store 和快照 | `memory`、下轮 `orchestrator`、下轮所有规划层、UI 选项/状态面板 |
| 11 | 机缘导演 `requestAuthorRandomEvent` | 故事后处理；动态随机事件配置启用且概率/必定区间命中、当前无不适合插入的活跃事件 | 大纲、出身、世界书、参考随机事件、动态配置、调度原因、最新故事、最近上下文、摘要、长期记忆、NPC、背包、当前场景、主弧/导演/事件状态、玩家标记、司书库工具 | `authorRandomEventState.pendingEvent`，并可把生成事件写入书库预设；下一回合注入故事 | 下轮 `story`、下轮规划层、事件面板 |
| 12 | 逻辑审校员 `requestAuthorLogicCheck` | 故事后处理；司辰要求或间隔到期 | 最新故事、最近上下文、摘要、长期记忆、NPC、背包、当前/可达场景、主弧/导演/规划层/事件状态、世界书、玩家标记、司书库工具 | `authorNarrative.logicReview`：连续性问题、修复指令、下回合警告 | 下轮 `story`、`director`、维护人员调试 |
| 13 | 记忆书吏 `requestMemoryUpdate` | 固定频率、设定守护 urgency、司辰 `memory.run=true` 或手动立即记忆 | 旧长期记忆、最近历史、决策输出、NPC、背包、当前场景、玩家标记、大纲、出身、世界书 | `state.longTermMemory`、`lastMemoryRound` | 下轮所有模型，尤其 `story`、规划层、设定守护 |
| 14 | 摘要书吏 `maybeCompress` / `contextCompressor` | 历史超过阈值，或司辰 `summary.run=true` 时降低阈值 | 历史消息、旧摘要、大纲 | `state.summary`、`summarizedUntilIndex` | 下轮所有模型 |
| 15 | 旅程评卷人 `requestReview` | 结局后或用户触发评分 | 完整旅程、设置、内容资源 | `review` | UI 展示，不参与主链路 |

### 13.4 规划层之间的依赖方向

```txt
masterArc
  ↓
outlineMapping
  ↓
stageJudge ─ settingGuard
  ↓             ↓
characterPlan  ↓
  ↓             ↓
scenePlan      ↓
  ↓             ↓
eventPlan ─────┘
  ↓
director.plan / writingBrief
  ↓
story
  ↓
decision / memory / randomEvent / logicCheck / summary
  ↓
下轮 orchestrator 与规划层
```

更细的依赖说明：

| 上游输出 | 直接写入位置 | 直接下游 | 备注 |
|---|---|---|---|
| `masterArc` | `authorNarrative.masterArc` | `outlineMapper`、`stageJudge`、`director`、`story`、`decision` | 当前阶段、完成条件和待完成节拍的核心来源。 |
| `orchestrator.calls/callOrder` | `authorNarrative.orchestrator` | `GamePage.runStory` | 不是叙事素材，而是程序调度指令。 |
| `outlineMapping` | `authorNarrative.outlineMapping` | 人物/场景/事件规划、导演、故事、决策 | 负责把大纲变成当前阶段桥接需求。 |
| `stageJudge` | `authorNarrative.stageJudge` | 设定守护、规划层、导演、故事、决策 | 最高优先级之一：决定玩家意图、节奏和本回合做多少。 |
| `settingGuard` | `authorNarrative.settingGuard` | 导演、故事、决策、记忆 | 设定补丁优先级高，`memoryUrgency` 可插入立即记忆。 |
| `characterPlan` | `authorNarrative.characterPlan` | 场景规划、事件规划、导演、故事、决策 | 提供角色是否出现、动机和关系信号。 |
| `scenePlan` | `authorNarrative.scenePlan` | 事件规划、导演、故事、决策 | 提供地点、时间、天气、资源和限制。 |
| `eventPlan` | `authorNarrative.eventPlan` | 导演、故事、决策、事件状态更新 | 事件规划输出的 `eventUpdates` 会直接应用到事件弧。 |
| `director.plan` | `authorNarrative.plan` | 故事、决策、随机事件、逻辑审校 | 导演是规划整合层，`writingBrief` 是故事模型最具体执行包。 |
| `story` 正文 | `state.history` | 决策、记忆、随机事件、逻辑审校、摘要、下轮全部模型 | 这是正史。后续模型必须以已写正文为准。 |
| `decision` 输出 | 背包、NPC、场景、选项 | 记忆、下轮司辰/规划层/故事 | 当前对话状态的结构化落地。 |
| `logicReview` | `authorNarrative.logicReview` | 下轮故事、导演、维护调试 | 只给修复建议，不自动改正文。 |
| `longTermMemory / summary` | `state.longTermMemory / state.summary` | 所有后续模型 | 控制长上下文成本与连续性。 |

### 13.5 只读工具调用现状

当前 `buildWorkspaceToolRuntime(save)` 已接入主要 agent。原则上这些模型都能看到司书库 manifest，并按需调用只读工具；后续需要按职责细化每个模型可用工具。

| 模型 | 当前工具状态 | 典型应读内容 | 后续需要细化的权限方向 |
|---|---|---|---|
| 回合司辰 | 可用只读工具 | `get_story_briefing`、最近调用、当前状态、活跃事件 | 应限制为短摘要类工具，避免调度器读太多全文。 |
| 大纲映射员 | 可用只读工具 | 完整大纲、详细大纲、开局文本、主弧、世界书 | 可允许读大纲/开局/详细大纲/主弧，少读 NPC 全量。 |
| 阶段判断员 | 可用只读工具 | 主弧、最近回合、玩家输入、事件弧 | 可允许读阶段/事件/最近历史。 |
| 设定守护者 | 可用只读工具 | 世界书、开局、长期记忆、最近回合 | 应允许读世界书正文，但避免无关全库扫描。 |
| 人物规划员 | 可用只读工具 | 角色文件、最近回合、NPC 状态、关系线 | 后续可重点开放 `characters/`、近期回合和相关 agent 输出。 |
| 场景规划员 | 可用只读工具 | 场景文件、当前状态、世界书环境条目 | 后续可重点开放 `scenes/`、当前状态、世界书。 |
| 事件规划员 | 可用只读工具 | 活跃事件、导演计划、大纲映射、近期回合 | 后续可重点开放事件/伏笔/主弧资料。 |
| 叙事导演 | 可用只读工具 | 下级规划、主弧、事件弧、最近回合、世界书 | 作为整合层，可读范围略宽，但要控制工具轮数。 |
| 故事写手 | 可用只读工具，前端显示“查阅/阅读” | 大纲、开局、详细大纲、世界书、司书库相关文件 | 只读；工具活动不混入正文。 |
| 决策记录员 | 可用只读工具 | 当前状态、背包/NPC/场景、导演计划 | 每回合必跑，后续可能要收窄以控制延迟。 |
| 逻辑审校员 | 可用只读工具 | 最近回合、NPC/道具/场景、旧模型输出、世界书 | 可读范围可较宽，用于查证一致性。 |
| 记忆/摘要 | 部分服务已接工具运行时或固定输入 | 最近历史、决策输出、长期记忆 | 后续看成本决定是否继续工具化。 |

### 13.6 本轮后仍未完成的链路问题

| 未完成项 | 当前状态 | 为什么还没算完成 | 建议下一步 |
|---|---|---|---|
| 司辰多轮工具调度 | 司辰一次性输出 `calls + callOrder`，程序执行 | 还不能“读资料 → 再决定调用哪些模型 → 再调用模型” | 等当前链路稳定后，实现司辰工具读取后的二次调度。 |
| 每模型工具权限 | 所有主要模型先接同一套只读工具 | 容易读太多、成本高，也不符合职责边界 | 由用户走一遍提示词和工具权限后，按模型传入工具白名单。 |
| 事件结算闭环 | `eventPlanner / director` 可输出 `eventUpdates` | 事件完成/失败/延后触发时机仍需实测，且无独立“结算后审计” | 用实际存档测试事件生命周期，再决定是否拆独立结算模型。 |
| 提示词最终版 | 当前为可运行版本 | 用户计划后续重写；现在更多是结构占位 | 测试后按失败案例重写各模型职责和输出协议。 |
| 成本与延迟控制 | 司辰可减少调用，但新规划层可能增多调用 | 需要实际测试 light/focused/full 是否足够准 | 记录每回合调用表与缓存命中，调 `minIntervalRounds` 和司辰规则。 |
| 司书库写入工具 | 当前只读 | 写入会影响回溯、冲突检测和状态一致性 | 先稳定回合卷宗，再设计写入 action 和冲突检查。 |
| 开局规划链 | 开局目前主弧 → 叙事导演 | 尚未在开局阶段跑完整 outline/character/scene/event 规划层 | 若实测开局第一轮仍弱，可让开局准备也跑 outlineMapper/eventPlanner。 |

## 14. 当前核心数据协议

### 14.1 回合司辰：`OrchestratorState`

位置：`src/types/game.ts`

核心字段：

| 字段 | 作用 |
|---|---|
| `turnType` | 判断本回合是继续事件、转折、结算、新事件候选、阶段切换候选还是自由探索 |
| `planningMode` | `light / focused / full`，用于控制调用成本 |
| `focusAreas` | 本回合关注方向，如 `outline / stage / character / scene / event / setting` |
| `planSignals` | 对某个方向需要更细分析的理由 |
| `callOrder` | 建议调用顺序，只列 `run=true` 的模型 |
| `calls` | 各辅助模型是否运行及原因 |

当前原则：

- 司辰只做轻量调度，不做详细人物/事件规划。
- 重要回溯、补写开局、能力起因、身份机制等高风险输入应触发更完整链路。
- 低风险沉浸推进应尽量保持轻量，避免每回合堆模型。

### 14.2 事件弧：`StoryArc`

位置：`src/types/game.ts`

已扩展字段：

| 字段 | 作用 |
|---|---|
| `lifecycle` | 事件生命周期：候选、进行、转折、完成、轻度失败、错过、延后、改写、归档 |
| `surfaceGoal` | 玩家可感知的明面目标 |
| `hiddenIntent` | 幕后目的，只供规划，不直接剧透 |
| `completionCriteria` | 完成标准 |
| `failureCriteria` | 失败/补救标准 |
| `abandonCriteria` | 放弃或绕开标准 |
| `worldProgressDelta` | 对世界/阶段进度的预期影响 |
| `relationshipDeltas` | 对角色关系的预期影响 |
| `progressPercent` | 事件完成度软数值 |
| `writingBoundary` | 当前回合写作边界 |

状态维护位置：

- `setPendingAuthorEvent`
- `activatePendingAuthorEvent`
- `advanceAuthorArcs`
- `completeAuthorArc`
- `applyAuthorEventUpdates`

### 14.3 大纲映射：`OutlineMappingState`

位置：`src/types/game.ts`

主要由独立大纲映射员输出，叙事导演仍保留兼容字段。作用是把“原始大纲 → 当前故事 → 下一批可执行小事件”连起来。

核心字段：

| 字段 | 作用 |
|---|---|
| `alignment` | 当前是否贴合大纲：`aligned / drifting / bridging / ready_to_advance / uncertain` |
| `currentAct` | 对应原始大纲哪一幕 |
| `currentActIndex` | 对应幕序号，0-based |
| `currentStageGoal` | 当前阶段最重要目标 |
| `stageProgress` | 阶段软进度 |
| `missingBridgeEvents` | 为了贴合大纲还缺少的桥接事件 |
| `candidateEvents` | 可自然生成/推进的小事件方向 |
| `driftRisks` | 偏离风险 |
| `nextMilestone` | 下一自然里程碑 |

注入位置：

- 故事模型：`【执笔模式 · 大纲映射】`
- 决策记录模型：`【当前叙事导演计划】` 内摘要显示
- 动态随机事件模型：用于生成更贴合大纲的小事件

### 14.4 独立规划层状态

位置：`src/types/game.ts`

| 状态 | 来源模型 | 主要字段 | 下游注入 |
|---|---|---|---|
| `AuthorCharacterPlanState` | 人物规划员 | `summary`、`characters`、`relationshipSignals`、`absentCharacters`、`risks` | 导演、故事、决策；也供场景/事件规划参考 |
| `AuthorScenePlanState` | 场景规划员 | `scene`、`sceneResources`、`sceneLogic`、`constraints`、`opportunities`、`risks` | 导演、故事、决策；也供事件规划参考 |
| `AuthorEventPlanState` | 事件规划员 | `summary`、`currentEvent`、`eventUpdates`、`candidateEvents`、`writingBoundary`、`successCriteria`、`avoid` | 导演、故事、决策；`eventUpdates` 直接更新事件弧 |

这些状态是“规划素材”，不是最终正文指令。最终故事写作仍以 `stageJudge` 的玩家意图/节奏与 `director.writingBrief` 的本回合叙事包为最高执行依据。

### 14.5 本回合叙事包：`NarrativeBriefState`

位置：`src/types/game.ts`

由叙事导演输出，是故事模型最具体的执行包。

核心字段：

| 字段 | 作用 |
|---|---|
| `objective` | 本回合最小叙事任务 |
| `mustFollow` | 必须遵守的硬事实/设定/大纲点 |
| `currentEvent` | 当前小事件状态、目标、进度和停止点 |
| `characters` | 本回合牵动角色、表面目的、隐藏动机、可表现行为、不可直说内容 |
| `scene` | 地点、时间、天气、氛围、资源、限制 |
| `sceneResources` | 简短场景资源列表 |
| `writingBoundary` | 故事正文写到哪里停止 |
| `successCriteria` | 本回合写成什么样算达成 |
| `avoid` | 本回合必须避免的越界、提前推进或违设定行为 |
| `hiddenKnowledge` | 可用于暗示但不得旁白剧透的信息 |

### 14.6 事件更新：`NarrativeEventUpdate`

位置：`src/types/game.ts`

由叙事导演输出，通过 `applyAuthorEventUpdates` 应用到当前事件弧。

支持：

- 更新生命周期；
- 更新完成度；
- 更新当前事件阶段；
- 写入进度记录；
- 把终态事件移动到 completed 列表。

目前这是“事件结算模型”的过渡形态，还不是最终独立模型。

## 15. 文件清单

### 15.1 类型与归一化

- `src/types/game.ts`
  - `OrchestratorState`
  - `StoryArc`
  - `NarrativeBriefState`
  - `OutlineMappingState`
  - `AuthorCharacterPlanState`
  - `AuthorScenePlanState`
  - `AuthorEventPlanState`
  - `NarrativeEventUpdate`
- `src/store/useGameStore.ts`
  - 叙事状态归一化
  - 事件生命周期推进
  - 事件更新应用
  - 司辰状态写入
  - 独立规划层状态写入：`setAuthorOutlineMapping / setAuthorCharacterPlan / setAuthorScenePlan / setAuthorEventPlan`

### 15.2 模型服务

- `src/services/authorOrchestratorAgent.ts`
  - 回合司辰 JSON 调度
  - fallback 调度
  - 工具运行时接入
- `src/services/authorOutlineMapperAgent.ts`
  - 独立大纲映射
  - 输出 `authorNarrative.outlineMapping`
- `src/services/authorCharacterPlannerAgent.ts`
  - 独立人物规划
  - 输出 `authorNarrative.characterPlan`
- `src/services/authorScenePlannerAgent.ts`
  - 独立场景规划
  - 输出 `authorNarrative.scenePlan`
- `src/services/authorEventPlannerAgent.ts`
  - 独立事件规划
  - 输出 `authorNarrative.eventPlan` 与 `eventUpdates`
- `src/services/authorDirectorAgent.ts`
  - 叙事导演计划
  - 整合 `outlineMapping / characterPlan / scenePlan / eventPlan`
  - `writingBrief`
  - `eventUpdates`
- `src/services/authorRandomEventAgent.ts`
  - 动态长线事件生成
  - 事件字段清洗
- `src/services/storyAgent.ts`
  - 故事模型正文生成
  - 司书库工具调用显示事件
- `src/services/decisionAgent.ts`
  - 决策记录 / 选项 / NPC / 道具 / 场景状态更新
  - 已接收导演计划、大纲映射、规划层摘要和叙事包摘要

### 15.3 提示词文件

> 提示词后续仍可能由人工重新整理；本节只记录当前拼装入口，避免找错文件。

- `src/prompts/authorOrchestratorSystem.ts`
- `src/prompts/authorOutlineMapperSystem.ts`
- `src/prompts/authorCharacterPlannerSystem.ts`
- `src/prompts/authorScenePlannerSystem.ts`
- `src/prompts/authorEventPlannerSystem.ts`
- `src/prompts/authorDirectorSystem.ts`
- `src/prompts/authorRandomEventSystem.ts`
- `src/prompts/storySystem.ts`
- `src/prompts/decisionSystem.ts`
- `src/lib/strictCustom.ts`

### 15.4 工具与司书库

- `src/services/workspaceTools.ts`
  - 只读工具定义与执行
  - `get_story_briefing`
  - `get_story_outline`
  - `get_detailed_outline`
  - `get_initial_scene`
  - `get_world_books`
  - `get_master_arc`
  - `get_director_plan`
  - `get_active_events`
- `src/lib/workspaceSeed.ts`
  - 旅程创建/运行时把大纲、开局、世界书、主弧等镜像到司书库

## 16. 当前提示词结构备注

当前提示词还不是最终形态，但总体结构已向以下方向靠拢：

```txt
system：
  你是谁 / 职责 / 输出规则 / 禁止事项 / 工具规则

user：
  世界观 / 大纲 / 出身 / 世界书 / 记忆 / 最近上下文
  当前状态 / NPC / 背包 / 场景 / 主弧 / 导演计划 / 事件弧
  当前玩家输入 / 当前任务
```

对故事模型，关键注入块包括：

- `【故事大纲】`
- `【执笔模式 · 主弧】`
- `【执笔模式 · 本回合玩家意图与节奏】`
- `【执笔模式 · 大纲映射】`
- `【执笔模式 · 人物规划】`
- `【执笔模式 · 场景规划】`
- `【执笔模式 · 事件规划】`
- `【执笔模式 · 当前叙事导演计划】`
- `【执笔模式 · 本回合叙事包】`
- `【执笔模式 · 叙事弧 / 长线事件】`
- `【世界设定 · 常驻】`
- `【长期一致性记忆】`
- `【已登场人物】`
- `【当前所在场景】`
- `【写作规范】`

后续人工整理提示词时建议保留这些“块名”或提供兼容替代，否则严格自定义模板、fallback 注入和调试记录会更难对齐。

## 17. 测试清单

### 17.1 开局准备

- 创建执笔模式旅程后，SetupPage 不应长时间等待模型。
- 进入 GamePage 后，应先跑主弧，再跑叙事导演。
- 输入框出现前不应自动生成正文。
- 记录页应能看到主弧 / 叙事导演调用。
  - 若第一轮故事质量仍弱，可考虑把开局准备扩展为主弧 → 大纲映射 → 事件规划 → 叙事导演。

### 17.2 回溯补写关键事件

推荐测试输入：

```txt
我回想起刚才在女厕被发现、能力觉醒的那一刻，具体到底发生了什么？
```

期望：

- 回合司辰识别为高风险回溯 / 补写关键事件。
- 司辰应倾向调用 `outlineMapper / stageJudge / settingGuard / characterPlanner / scenePlanner / eventPlanner / director`，故事后倾向 `logicCheck`。
- 故事模型应参考大纲、开局文本、世界书和司书库工具，不应凭空改写能力起因。

### 17.3 事件生命周期

测试方向：

- 生成一个动态长线事件；
- 玩家接受事件；
- 玩家中途拒绝或绕开事件；
- 玩家完成事件目标；
- 玩家错过关键机会。

观察：

- `lifecycle` 是否从 `candidate → active/progressing → completed/soft_failed/delayed/reframed/missed` 合理变化。
- `progressPercent` 是否推进。
- 完成或错过后是否进入 completed 列表。
- 故事模型是否只写当前回合边界，不一口气写完整事件。

### 17.4 大纲映射

测试方向：

- 玩家按大纲推进；
- 玩家偏离当前阶段；
- 玩家进入新地点；
- 玩家回到与大纲关键事件相关的人物/地点。

观察：

- `outlineMapping.alignment` 是否合理。
- `missingBridgeEvents` 是否提出可执行桥接小事件。
- `candidateEvents` 是否不是空泛口号。
- 故事正文是否更贴合大纲，但不强行否定玩家。

### 17.5 人物与场景规划

测试方向：

- 玩家去某个曾经发生重要事件的地点；
- 玩家与关键 NPC 互动；
- 玩家在无明确输入时观察场景。

观察：

- `writingBrief.characters` 是否判断角色是否牵动、表面目的和隐藏动机。
- `writingBrief.scene` 是否包含时间、天气、氛围、场景资源和限制。
- `characterPlan / scenePlan / eventPlan` 是否先产生合理下级规划，再由导演整合进 `writingBrief`。
- 故事正文是否表现这些信息，而不是直接旁白剧透。

## 18. 后续优先级建议

### P0：先实测当前“独立规划层”

当前大纲映射、人物规划、场景规划、事件规划已经拆成独立模型，并由叙事导演整合。

优先测试：

- 司辰是否能准确区分 `light / focused / full`，避免每回合都拉满规划链。
- 高风险回溯/补写场景是否能触发完整规划链。
- 故事模型是否真正执行 `writingBrief`，而不是无视规划自由发挥。
- `characterPlan / scenePlan / eventPlan` 是否能显著改善人物、场景和事件逻辑。
- 每回合调用成本、缓存命中、延迟是否可接受。

### P1：根据测试调司辰触发规则

若实测发现调用过多或过少，优先改：

1. `authorOrchestratorSystem.ts`：司辰判断规则、各模型调用边界。
2. `fallbackOrchestratorDecision`：接口失败时的保底链路。
3. `GamePage` 中各 `maybeRun*Planner` 的间隔和 `force` 策略。
4. 设置项：后续可考虑给执笔模式加“规划强度/成本优先/质量优先”。

### P2：整理提示词最终版

当前提示词是结构可运行版本，不是最终写作质量版本。

建议按以下顺序重写：

1. 回合司辰：最重要，决定成本和链路是否正确。
2. 大纲映射员：决定故事是否贴合大纲。
3. 事件规划员：决定事件生命周期与写作边界。
4. 叙事导演：决定如何整合下级规划。
5. 故事写手：决定最终文本表现。
6. 人物/场景规划员：根据实际失败案例补充规则。

### P3：回合司辰多轮工具调用

当前是“司辰输出调用计划，程序执行”。

未来可升级为：

```txt
回合司辰
 ↓
主动调用 get_story_briefing / get_active_events / get_recent_agent_calls
 ↓
再输出更可靠的 calls + callOrder
 ↓
程序执行模型链
```

风险：

- 成本增加；
- 延迟增加；
- 工具结果需要继续压缩；
- reasoning 模型 tool calls 的历史消息格式要继续保持兼容；
- 需要防止司辰变成“什么都想查、什么都想调”的重模型。

### P4：按模型细化工具权限

当前主要模型先共用只读司书库工具。后续建议按职责拆工具白名单：

- 司辰：只读摘要、活跃事件、最近调用，不读全量角色/世界书。
- 大纲映射：读大纲、详细大纲、开局、主弧。
- 设定守护：读世界书、开局、长期记忆。
- 人物规划：读角色文件、NPC 状态、相关回合。
- 场景规划：读场景文件、当前状态、世界书环境条目。
- 事件规划：读活跃事件、主弧、导演计划、近期回合。
- 故事写手：允许按需读大纲/世界书/司书库相关文件，但只输出正文。
- 决策记录员：谨慎使用工具，避免每回合延迟过高。

### P5：司书库写入工具

目前工具是只读。后续如果开放写入，需要满足：

- 所有写入必须经 store action；
- 写入必须进入回合卷宗；
- 回溯时必须能撤销；
- 每个模型只能写自己强关联的文件；
- 写入前最好由维护书库模型或程序规则做冲突检测。

### P6：事件结算闭环

当前 `eventPlanner / director` 都可以输出 `eventUpdates`，但事件结算还不是完全独立闭环。

未来可以考虑：

```txt
故事正文完成
 ↓
决策记录落状态
 ↓
事件结算模型检查 activeEvents
 ↓
写入 completed / delayed / reframed / soft_failed / missed
 ↓
必要时触发记忆、逻辑审校、下一事件候选
```

这一步建议等当前链路实测后再做，否则容易增加调用成本且难以判断收益。
