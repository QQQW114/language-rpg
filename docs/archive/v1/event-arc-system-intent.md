# 动态事件弧系统提示词与架构意图记录

> 记录时间：2026-05-11
> 用途：本文档是动态事件弧（含"司事"调度成员、多轮司辰、milestone 触发链）的权威意图记录，给后续精修提示词的模型 / 维护者读取。
> 当前状态：用户主改提示词；维护侧按本文档列出的代码改造清单干代码改造，不主动改写 prompt 主体。

## 总体方向

旧的"概率/冷却/独立小插曲"式 `randomEvent` 系统已标记弃用（见 `docs/orchestrator-prompt-intent.md` 与 `docs/author-mode-random-events-plan.md`）。

新方向："**动态事件弧**"——故事结构的承载层。事件不是被随机塞进剧情的插曲，而是从大纲、当前剧情、人物关系、场景资源、玩家行为之间的"叙事空白"生成出来的情节单元。事件作为故事进度的主要载体：

- 大纲是底色（题材吸引 + 红线避让），不是 checklist。
- 事件由"当前节奏 + 玩家决策 + 大纲信号"三方触发生成，受限于"上面正在跑的事件"和"序章 / 关键节点"这类不可越过的高优先级节奏。
- 事件可长可短，随时生成随时收束。
- 主线大事件（milestone）也是事件，只是带 `isMilestone: true` 标记与更严格的生命周期。
- 中小事件构成 stage 内部的肌理，自然累积推动 stage 完成度。

## 提示词协作约定

延续 `orchestrator-prompt-intent.md` 第 2 节"提示词协作约定"。维护模型不要擅自改写本文涉及到的 prompt 主体，只按用户明确指定的部分修改。新增成员（司事）的 prompt 由用户负责落地。

## 模型分类的调整

在原有调度图上加一项 calls 成员，并修正若干成员的职责口径。

### 新增成员：司事（`eventBeat`）

`authorEventBeat` / 司事是动态事件弧的"节奏判断 + 结算"模型。它是 calls 第 8 成员。

- 视角：**全知事件视角**（区别于 stageJudge 的玩家视角）。
- 运行时机：仅当 `narrative.activeArcs.length > 0`（存在已激活事件）时由司辰建议 run。无活跃事件时不跑。
- 职责：
  - 判断每个 active event 当前 lifecycle 是否仍准确（candidate / active / progressing / turning / completed / soft_failed / missed / delayed / reframed / archived）。
  - 判断 completionCriteria / failureCriteria 是否已触发。
  - 在事件 completed / soft_failed / missed 时执行**结算**：调用 NPC 好感工具、能力工具（仅限事件内的小能力）、状态备注工具落子。
  - 通过 `planConcern` 字段反馈"建议向司辰升级 milestone 时机"或"建议放缓事件节奏"。
- 不负责：
  - 生成新事件（这是 eventPlanner 的事）。
  - 替司辰决定调度顺序。
  - 写故事正文 / 选项 / 主线大能力授予。

### 现有成员的职责调整

- **`eventPlanner`**：仍是司辰直属 A 类工具（按需调）。新增定位：**接到司辰 hint 后按指令生成事件**——hint 说"出 milestone"就按 outline 的 `milestoneCandidates / exitMilestone` 生成主线事件并标 `isMilestone: true`；hint 说"出小事件"就按 `themeRange / themeAnchors` 灵活生成。允许 `planConcern` 字段反馈异议（异议不直接改本回合行为，进入下回合 planSignals 给司辰看）。
- **`outlineMapper`**：吃 outline 新结构（acts 升级为对象数组，含 themeRange / milestoneCandidates / exitMilestone）；输出 `candidateEvents` 时带题材范围；输出新的"stage 完成度 + milestone 时机"信号给司辰。
- **`stageJudge`**：维持现有职责（玩家视角：playerPace / playerIntent / storyFocus / shouldAdvance）。微调一句"事件节奏由司事负责，你不要替它管"。
- **`director`**：定位转向"把当前 active event 的下一节拍翻成 writingBrief"。`nextRoundFocus` 口径改成"本回合写当前 active event 的哪一节拍 / 写到哪里停"。`nextFewRoundsPlan` 字段可保留但权重降低（事件本身的 stages 已经是近期节奏）。
- **`story`**：吃 active event 的 `hiddenIntent / writingBoundary / doNotReveal`；本回合只写当前节拍，不擅自推进事件状态。

### 司辰的多轮对话

司辰从单轮升级为双 Phase 双轮对话。

#### Phase 1：信息整理

- 输入：当前回合状态、上回合各模型输出、recent 上下文。
- 司辰可以调用任意工具（读司书库、读大纲、读最近回合、调 A 类分析等）。
- 输出 schema：**只输出 `informationRequests` 形态结果**——记录本轮收集到的信息、提出仍存在的疑问、列出三方信号（outlineMapper / stageJudge / activeArcs）的初步判断。
- **不输出 calls 决策**。Phase 1 严禁直接 dispatch。
- 早退：Phase 1 可以输出"无需进一步分析，建议 Phase 2 直接做 light 调度"。

#### Phase 2：调度决策

- 输入：Phase 1 上下文 + Phase 1 输出。
- 司辰可以继续调用工具（补刀）。
- 输出 schema：当前 `OrchestratorState` 形态——turnType / planningMode / directorMode / focusAreas / planSignals / callOrder / calls（含 8 项决策与 hint）。
- 此时调度图最终化，本回合不再回 Phase 1。

#### 为什么拆双轮

- 单轮司辰既要整理信息又要做决策，认知负担过重。
- 缓存命中：Phase 1 的 system 完全不变，Phase 2 接 Phase 1 的对话历史也几乎全在缓存里，输入成本可忽略。
- 工具调用本身已经是多轮，再加一轮 dispatch 决策不增加架构复杂度。
- 后续可优化：平稳回合 Phase 1 可早退、Phase 2 直接走 light 模式；但首版统一双 Phase 跑稳再说。

## milestone 触发链

主线大事件不是定时触发，也不是中小事件硬累积，而是三方信号汇总到司辰做时机判断：

| 信号源 | 输出 | 时机意味 |
|---|---|---|
| outlineMapper | "当前 stage 完成度 70%、下一个 exitMilestone 候选：X、缺桥接事件：Y" | 大纲层面允不允许出 milestone |
| stageJudge | "shouldAdvance=true / playerPace=progressing" | 玩家节奏允不允许 |
| activeArcs | "无活跃事件 / 活跃事件已接近收束" | 空间允不允许 |

三角同时绿灯 → 司辰 Phase 2 在 eventPlanner 的 hint 里写"出 milestone：候选 X"。eventPlanner 生成带 `isMilestone: true` 标记的事件弧，生命周期更严格：

- 不可 `missed / reframed`（玩家可以拖延，但不能让大事件"被忘"）。
- 写作边界更紧：核心剧情节点不可省略。
- 失败规则：完成 = stage 推进；失败 = stage 转向 alt 路径（如"主角搞砸表白 → 关系倒退"），由 eventPlanner 生成时在 `failureCriteria` 中明示后果方向。

中小事件天然不带这个标记，可 missed / delayed / reframed，给玩家日常感和节奏松弛。

## 事件与大纲的关系

事件靠向大纲但不严格按大纲。核心原则——

> 大纲是底色不是 checklist。事件生成时受大纲题材吸引（校园恋爱 → 校园题材 + 恋爱对象关系），但允许小幅偏离（最近情节带出的反差小事件 OK）。红线是"完全脱离大纲题材"（恋爱大纲 → 修仙事件 = 不允许）。

落到 prompt 里：

- eventPlanner 的事件生成不需要每事必查"是否符合大纲"——题材吸引在 outline 数据结构里通过 `themeAnchors / themeRange` 表达，eventPlanner 读到就自然受约束。
- 红线（不可生成的事件类型）由 outlineMapper 在 `driftRisks` 里显式标出，eventPlanner 必须避让。
- 进度锚点（如恋爱对象关系）通过 `progressAnchors` 字段直接让事件结算时挂到世界进度。

## 数据结构改动清单（types 层）

由维护模型实现。

### `StoryOutline` 升级

```ts
// src/types/content.ts

export interface OutlineStage {
  name: string;                       // 阶段名称
  description?: string;               // 阶段说明
  themeRange?: string[];              // 该阶段可生成的事件题材范围
  milestoneCandidates?: string[];     // 该阶段允许的 milestone 事件候选
  exitMilestone?: string;             // 出本阶段的关键 milestone
}

export interface StoryOutline {
  id: string;
  title: string;
  synopsis: string;
  acts: string[];                     // 保留旧字符串数组以兼容旧存档
  stages?: OutlineStage[];            // 新结构，新存档优先用这个
  themeAnchors?: string[];            // 整本大纲的题材锚点（"校园" / "恋爱" / ...）
  progressAnchors?: Array<{
    type: 'npc_relation' | 'goal' | 'world_state';
    id: string;                        // NPC id / 目标 key
    label?: string;                    // 显示用
    weight?: number;                   // 0..1，事件结算时挂到世界进度的权重
  }>;
  tone?: string;
  worldBookIds?: string[];
  coverEmoji?: string;
}
```

旧存档：`acts` 仍可读；`stages` 为空时 outlineMapper 会按旧 acts 行为运作（不输出 milestone 信号，事件层退化为纯小事件模式）。

### `StoryArc` 微扩

```ts
// src/types/game.ts

export interface StoryArc {
  // ...现有字段...
  isMilestone?: boolean;              // 主线大事件标记
  milestoneOf?: string;               // 对应的 outline.stages[].exitMilestone
  alternateOutcomePath?: string;      // milestone 失败时 stage 转向的 alt 路径描述
}
```

### `OrchestratorCallKey` 与 `OrchestratorCallDecision`

```ts
export type OrchestratorCallKey =
  | 'outlineMapper'
  | 'stageJudge'
  | 'settingGuard'
  | 'director'
  | 'logicCheck'
  | 'memory'
  | 'summary'
  | 'eventBeat';                      // 新增

export interface OrchestratorCallDecision {
  run: boolean;
  reason: string;
  hint?: string;                      // ≤80 字，针对该成员的本回合关注点
}
```

### 多轮司辰中间状态

```ts
export interface OrchestratorPhase1Result {
  updatedAtRound: number;
  notes: string;                       // 信息整理总结
  outstandingQuestions?: string[];     // 仍未解决的疑问
  signalSnapshot?: {                   // 三方信号初判
    outline?: string;
    stage?: string;
    activeEvents?: string;
  };
  earlyExit?: boolean;                 // 早退建议 Phase 2 走 light
  thinking?: string;
  rawOutput?: string;
  usage?: LlmUsage;
}

export interface OrchestratorState {
  // ...现有字段...
  phase1?: OrchestratorPhase1Result;
}
```

### 司事专属配置与状态

```ts
export interface AuthorEventBeatConfig {
  enabled: boolean;
  prompt: string;                      // 玩家给司事的额外要求
}

export interface EventBeatVerdict {
  arcId: string;
  lifecycle: NarrativeEventLifecycle;
  progressPercent?: number;
  triggeredCompletion?: boolean;
  triggeredFailure?: boolean;
  outcomeNote?: string;
  appliedRelationshipDeltas?: Array<{ npcId?: string; npcName?: string; affinityDelta?: number; note?: string }>;
  appliedItemDeltas?: Array<{ name: string; action: 'grant' | 'note'; description?: string }>;
}

export interface EventBeatState {
  updatedAtRound: number;
  verdicts: EventBeatVerdict[];        // 本回合对每个 active event 的判定
  planConcern?: string;                // 给下回合 司辰 的反馈
  thinking?: string;
  rawOutput?: string;
  usage?: LlmUsage;
}

export interface AuthorNarrativeState {
  // ...现有字段...
  eventBeat?: EventBeatState;
  lastEventBeatRound?: number;
}
```

## 工具清单（司事专属）

由维护模型在 `workspaceTools` 注册。司事开放以下工具——

### 查询类（读权限）

- `get_npc_list`：列出所有已知 NPC 与好感/标签简要。
- `get_npc_detail`：按 id 或 name 查 NPC 完整档案。
- `get_active_arcs`：列出当前 activeArcs。
- `get_recent_rounds`：读最近 N 回合正文。

### 修改类（写权限，sanitize 在工具层做）

- `set_npc_affinity`：调整 NPC 好感度。
  - 参数：`npcId` / `delta` / `reason`（必填）
  - 限制：单次 |delta| ≤ 30；reason 必须填写并落盘到 NPC.recentNote。
- `add_npc_note`：给 NPC 加 recentNote / details。
  - 参数：`npcId` / `note` / `appendToDetails?`（可选）
- `grant_minor_item`：授予事件内小能力 / 小道具。
  - 参数：`name` / `description` / `category`（仅允许 `'minor_ability' | 'memento' | 'note'`，**不允许 `'main_ability'`**）
  - 限制：description 必须明示"事件得来"。
- `update_item_note`：给已有能力 / 物品加备注（不改 description 主体）。

### 红线

司事禁止：
- 创建新 NPC（NPC 必须先由故事/decision 写入存在，司事只调整状态）。
- 授予主线大能力（`grant_minor_item` 的 category 限定）。
- 修改大纲 / stage / world progress（这些是 director / outlineMapper / stageJudge / decision 的领域）。
- 写故事正文。

## 各 prompt 改动清单

| 文件 | 改动 |
|---|---|
| **新建** `src/prompts/authorEventBeatSystem.ts` | 司事 system + `buildAuthorEventBeatUser`。characterPlanner 范式（身份→职责→详例→完整 JSON 输出→schema→末尾规则）。详例覆盖：正常推进、转折、收束结算、误判反例、司辰带 hint 例。 |
| `src/prompts/authorOrchestratorSystem.ts` | 拆 Phase 1 / Phase 2 双 system；user template 双套；CALL_KEYS 加 `eventBeat`；司辰说明事件节奏判断委托司事，本身不再每回合扫事件状态。 |
| `src/prompts/authorEventPlannerSystem.ts` | 改写口径："大纲是底色 / 时机由司辰决定 / 按 hint 出 milestone 还是小事件 / 异议时输出 planConcern"。事件生成时输出 `isMilestone / lifecycle / completionCriteria / failureCriteria / writingBoundary / alternateOutcomePath`。 |
| `src/prompts/authorOutlineMapperSystem.ts` | 吃 outline.stages（含 milestoneCandidates / themeRange / exitMilestone）；输出 candidateEvents 时带题材范围；产出"stage 完成度 + milestone 时机"专门字段。 |
| `src/prompts/authorDirectorSystem.ts` | 定位转向"把 active event 节拍翻成 writingBrief"；nextRoundFocus 口径改成"写哪一节拍"；nextFewRoundsPlan 保留但权重降低。 |
| `src/prompts/authorStageJudgeSystem.ts` | 微调一句"事件节奏由司事负责"，其余维持。 |
| `src/prompts/storySystem.ts` | 显式吃 active event 的 hiddenIntent / writingBoundary / doNotReveal；本回合只写当前节拍，不擅自推进事件状态。 |

## 代码改造清单（给维护模型）

按依赖顺序：

1. **types 扩展**（见上）
   - `src/types/content.ts`：StoryOutline 加 stages / themeAnchors / progressAnchors；新增 OutlineStage。
   - `src/types/game.ts`：StoryArc 加 isMilestone / milestoneOf / alternateOutcomePath；OrchestratorCallKey 加 eventBeat；OrchestratorCallDecision 加 hint；新增 OrchestratorPhase1Result；OrchestratorState 加 phase1；新增 AuthorEventBeatConfig / EventBeatVerdict / EventBeatState；AuthorNarrativeState 加 eventBeat / lastEventBeatRound。

2. **store 扩展**
   - `src/store/useAuthorModeStore.ts`：加 `eventBeatConfig` 字段及 setter，默认 `{ enabled: true, prompt: '' }`。

3. **agent service 新增**
   - `src/services/authorEventBeatAgent.ts`：调用 LLM、消费工具调用、sanitize 输出为 EventBeatState、应用 verdicts 到 narrative.activeArcs / NPC / 物品状态。

4. **司辰服务双 Phase 化**
   - `src/services/authorOrchestratorAgent.ts`：拆 `runOrchestratorPhase1` / `runOrchestratorPhase2`。Phase 2 调用时把 Phase 1 输出作为 `assistant` 消息追加到对话历史，复用 system 与早期 user。
   - sanitize 增加 phase1Result 与 calls.eventBeat 处理。
   - calls.hint 接入 sanitize（≤80 字裁剪）。

5. **主循环接入**
   - 主调度循环：先跑 Phase 1，再跑 Phase 2，再按 callOrder 调度。
   - eventBeat 安排在 director 之后、logicCheck 之前（事件节奏判定基于 director 已经给出的 writingBrief 也合理；或者放在 director 之前，让 director 知道节奏判定 → 由用户最终拍）。**初版建议放在 director 之前**，让节奏判定作为 director 的输入。
   - 无 activeArcs 时即便司辰 calls.eventBeat.run=true 也应跳过（service 层兜底，避免空跑）。

6. **工具注册**
   - `src/services/workspaceTools.ts`（或对应工具注册位置）：注册司事专属 6 个工具（4 查 + 4 改，详见"工具清单"）。
   - 工具描述（`tools[].function.description`）由维护模型按本文档语义编写。
   - 工具的 sanitize 与权限校验：`set_npc_affinity` 限制 |delta| ≤ 30；`grant_minor_item` 限制 category；其余按本文档红线。

7. **stageJudge 透传 narrative**
   - `src/services/authorStageJudgeAgent.ts`：调用 `buildStageJudgeUser` 时透传 `narrative`（已在 prompt 那边新增的可选参数）。

8. **司书库 planning artifact**
   - eventBeat 输出落盘到 `planning/latest/event-beat.json` 与 `planning/rounds/{N}/event-beat.json`。
   - Phase 1 输出落盘到 `planning/rounds/{N}/orchestrator-phase1.json`（可选，便于调试）。

9. **前端可视化**
   - 司辰 Phase 1 在回合记录里显示为"信息整理"步骤，可折叠。
   - 司事运行显示为 calls 链路里的一环。
   - 事件弧侧边栏：显示 isMilestone 标记、lifecycle、progressPercent、最近一次 verdict。

10. **outline 生成 prompt（次要）**
    - `src/prompts/randomizer.ts` 或 outline 生成入口：让生成模型一并输出 stages / themeAnchors / progressAnchors。这一项可以延后到事件弧系统跑稳后再做，旧 outline 数据先靠默认值兼容。

## 待用户拍板的并行事项

以下事项不阻塞本期开工，但用户需要在事件弧系统跑稳前后决定：

- 旧 `randomEvent` / `AuthorRandomEventState` 代码层是否可以拆除（目前 prompt 层已基本不引用）。
- `masterArc.stages` 与 `outline.stages` 的关系：是否合并为同一数据源，或保持双层（masterArc 是开局生成的"主弧骨架"，outline.stages 是大纲层的"剧情阶段"）。
- 事件弧的"小说化导出"：completed milestone 是否自动写入 timeline / 章节式存档。
- UI 显示文案：司事中文是否对外可见，还是仅内部记录名。

## 本文档版本约定

本文档与 `orchestrator-prompt-intent.md` 互补：

- `orchestrator-prompt-intent.md` 是调度层（司辰本体 + 三类模型分类 + planningMode）的权威记录。
- 本文档是事件弧系统（司事 + 多轮司辰 + milestone 触发 + outline 升级）的权威记录。
- 当两份文档在事件相关内容上存在差异时，以本文档为准。`orchestrator-prompt-intent.md` 中"随机事件系统状态"一节中关于"事件能力后续应并入主链路"的描述，由本文档具体化。
