# 阶段化叙事（Stage Narrative）· 实施规范

> 本文是写给**实施工程师**的落地规范，落地后将使故事节奏从"按回合数硬绑定"改为"按阶段 + 玩家节奏自动推进"。
>
> 阅读对象：维护本项目主体代码的工程师 / 模型。
>
> 本特性归属：`docs/execution-plan.md` 的 **Phase 1.1**（覆盖原"主弧"设计，stages 不再绑回合）+ 新增 **Phase 1.0.5**（阶段判断模型）。
>
> 与既有特性的关系：
> - **设定守护者（docs/setting-guard.md）已实现并保留**——继续每回合做世界书护栏。
> - **本特性新增 stageJudge 模型最先跑**，把玩家意图与节奏判断作为**所有下游模型**（故事 / 设定守护 / 决策 / 导演 / 随机事件）的共同输入。

## 0. 起源与因果

### 0.1 痛点的真实例证

实测 13 回合的样本（`test-saves/旅人 · 错位青春——双重身份的校园恋爱-旅程包.json`）反复出现"故事模型一回合压缩多步"问题：

| 回合 | 玩家输入（短） | 模型在一回合内推完 |
|---|---|---|
| 5 | "玉帝天皇老子耶稣观音哪个都行让我摆脱这次危机" | 觉醒能力 → 完成转换 → 开门 → 帆布鞋女生看见女身 → 保洁阿姨被打发走 → 帆布鞋女生说"多喝热水"逃走（**6 步压一回合**） |
| 6 | "盘算舍友在不在，回想刚刚记忆" | 盘算 3 个舍友 → 回想能力规则（可逆 + 可对他人）→ 走回宿舍 → 反锁门 → 看穿衣镜 → 翻出备用女装（**6 步压一回合**） |
| 8 | "出去当当女生" | 戴渔夫帽 → 锁门 → 下楼遇人 → 出宿舍楼 → 走校道 → 路人男生瞥视 → 走向便利店（**5 步压一回合**） |

玩家明确反馈：**节奏被回合数定死了**。玩家偏慢，但模型在追"按回合追阶段"。

### 0.2 根因：9 处「阶段-回合硬绑定」

故事模型 prompt 里 9 处把"阶段"绑死在"回合数"上：

| # | 来源 | 表现 |
|---|---|---|
| 1 | `storySystem.ts` `buildActPlanBlock` | 按 totalRounds 等分 acts；"第 X 回合应服务于第 Y 阶段" |
| 2 | `strictCustom.ts` `detailedOutline` | "第 1-5 回合：女厕风波 + 觉醒前" |
| 3 | `narrativePlan.stageStartRound / stageTargetEndRound` | 阶段范围标回合区间 |
| 4 | `narrativePlan.nextFewRoundsPlan[].startRound/endRound` | 每段计划标回合区间 |
| 5 | `StoryArc.targetEndRound + stages[].startRound/endRound` | 事件弧每阶段标回合区间 |
| 6 | `RandomEvent.minRound / cooldown` | 触发窗口按回合 |
| 7 | storySystem prompt 里的 `nextRound / totalRounds / remainingAfter` | "已完成 X 回合，本回合结束后还剩 Y 回合" |
| 8 | 导演 `horizonRounds=6` | 一次规划未来 6 个回合 |
| 9 | 短/标准/长篇幅按字数硬给 | 模型为追"完整性"会塞更多内容 |

第 5 回合跳步的最直接原因：玩家的 `detailedOutline` 写"第 1-5 回合：女厕风波 + 觉醒前"，模型读到第 5 回合 + "觉醒前" + 玩家"哪个神都行"输入，就**强行**把"觉醒前 → 觉醒 → 脱困"全在第 5 回合塞完——不然第 5 回合结束时还违反 detailedOutline。

模型不是在瞎跳，它在**遵守 prompt 给的硬约束**。

### 0.3 解决方案

把所有"阶段-回合"硬绑定改为：
1. **阶段标识符 + 阶段完成条件**——不再有 startRound / endRound。
2. **每回合最先跑「阶段判断 / 玩家意图」模型**，输出 `playerIntent / playerPace / stageStatus / storyFocus`。
3. **故事模型 prompt 移除回合-阶段映射**，改读 currentStage + storyFocus + playerPace。
4. **主弧生成模型**在旅程创建时产出 NarrativeStage[]（不带回合）。
5. **不兼容老存档**——老旅程包导入时拒绝，避免老的硬绑定数据污染新链路。

## 1. 设计哲学

> 整个游戏由**一组阶段**驱动，每个阶段由"剧情条件"判断进入与完成，而非回合数。每回合先识别玩家意图与节奏，再让故事模型按节奏写一个微节拍。

四条铁律：

1. **不再有"第 X 回合应服务于第 Y 阶段"语句**。回合数仅作软参考（如"已完成 X 回合"），不再约束阶段映射。
2. **阶段判断模型最先跑**（每回合）。它的输出是所有下游模型的共同输入。
3. **玩家节奏感知（playerPace）是一等公民**。`immersive` 时故事每回合只推一个微节拍。
4. **不兼容老存档**——老旅程包导入时拒绝，提示用户重新创建。

## 2. 调度位置

```
[runStory 开始]
  ↓
1. requestStageJudge（新增 · 每轮 · 最先）
   - 输出 playerIntent / playerPace / stageStatus / storyFocus
   - 写入 state.authorNarrative.stageJudge
   - 若 stageStatus.shouldAdvance：调用 advanceMasterArcStage 切阶段
  ↓
2. requestSettingGuard（既有 · 每轮）
   - 现在可以读到 stageJudge 的 playerPace / 当前阶段，输出更贴合
  ↓
3. requestStory（既有 · 每轮）
   - 读取所有上游输出（stageJudge + settingGuard + masterArc + 等等）
  ↓
4. requestChoices / decisionTracking（既有）
5. requestAuthorRandomEvent（既有，按概率）
6. requestAuthorDirectorPlan（既有，按 everyRounds）
7. requestAuthorLogicCheck（既有，按 everyRounds）
8. requestMemoryUpdate（既有，按 memoryEveryRounds，或 settingGuard.memoryUrgency=high）
```

**主弧生成模型** `requestMasterArc` 不在每回合跑——只在旅程创建时跑一次（`SetupPage` 跳 `GamePage` 前）。后续阶段可选地手动重跑（"重新规划主弧"按钮）。

## 3. 数据结构

### 3.1 主弧 NarrativeStage / MasterArcState

```ts
export interface NarrativeStageBeat {
  id: string;
  description: string;          // ≤80 字
  status: 'pending' | 'achieved' | 'skipped';
  achievedAtRound?: number;     // 仅记录，不约束
}

export interface NarrativeStage {
  id: string;
  name: string;                 // ≤16 字 "觉醒" / "摸索能力"
  description: string;          // ≤200 字 阶段长目标
  enterConditions: string[];    // 进入条件（剧情语义，最多 4 条）
  completionConditions: string[]; // 完成条件（剧情语义，最多 5 条）
  expectedBeats: NarrativeStageBeat[]; // 阶段内建议节拍，3-8 条，不绑回合
  status: 'pending' | 'active' | 'completed' | 'skipped';
  enteredAtRound?: number;
  exitedAtRound?: number;
}

export interface MasterArcState {
  title: string;                // 主弧标题（可与 outline.title 不同）
  summary: string;              // 整段游戏的核心走向（≤220 字）
  stages: NarrativeStage[];     // 通常 3-6 个
  currentStageIndex: number;    // 当前活跃阶段（默认 0）
  generatedAtRound: number;     // 通常为 0
  updatedAtRound: number;
  generationConfig?: AuthorMasterArcConfig;  // 玩家自定义提示词
}
```

### 3.2 阶段判断 StageJudgeState

```ts
export type PlayerPace = 'immersive' | 'exploratory' | 'progressing' | 'hurrying';

export interface PlayerIntent {
  primary: string;          // ≤80 字 玩家本回合最想做的一件具体事
  secondary?: string[];     // 顺便想要的，最多 3 条 ≤60 字
  implicit?: string;        // ≤80 字 玩家没明说但隐含的
}

export interface StageJudgeStatus {
  currentStageId?: string;
  completion: number;       // 0-100 当前阶段完成度
  newlyAchievedBeats: string[];  // 本回合新达成的 beat id
  shouldAdvance: boolean;
  advanceReasoning?: string;     // ≤120 字
}

export interface StageJudgeFocus {
  thisRound: string;        // ≤140 字 故事模型本回合应聚焦的一件事
  avoid?: string[];         // 最多 4 条 ≤80 字
}

export interface StageJudgeState {
  updatedAtRound: number;
  playerIntent: PlayerIntent;
  playerPace: PlayerPace;
  paceReasoning?: string;   // ≤140 字
  stageStatus: StageJudgeStatus;
  storyFocus: StageJudgeFocus;
  lastError?: string;
}
```

### 3.3 配置

```ts
export interface AuthorMasterArcConfig {
  enabled: boolean;          // 默认 true
  stageHint: string;         // 玩家给主弧生成模型的偏好（默认空）
  expectedStageCount?: number;  // 期望阶段数，默认从 outline.acts.length 推导
}

export interface AuthorStageJudgeConfig {
  enabled: boolean;          // 默认 true
  prompt: string;            // 玩家给阶段判断模型的偏好
  autoAdvance: boolean;      // 是否自动推进阶段（默认 true；false 时需玩家确认）
}
```

### 3.4 挂载到 AuthorNarrativeState

```ts
export interface AuthorNarrativeState {
  plan?: NarrativePlanState;
  logicReview?: AuthorLogicReviewState;
  settingGuard?: SettingGuardState;
  masterArc?: MasterArcState;          // 新增
  stageJudge?: StageJudgeState;        // 新增
  activeArcs: StoryArc[];
  completedArcs: StoryArc[];
  lastDirectorRound?: number;
  lastLogicCheckRound?: number;
  lastSettingGuardRound?: number;
  lastStageJudgeRound?: number;        // 新增
}
```

### 3.5 GameContent 扩展

```ts
export interface GameContent {
  // ...existing
  authorMasterArc?: AuthorMasterArcConfig;
  authorStageJudge?: AuthorStageJudgeConfig;
}
```

## 4. 主弧生成模型

### 4.1 触发

旅程创建后，`SetupPage` 跳 `GamePage` 之前调用一次。如果失败 fallback 为"按 outline.acts 自动转换"（直接把每个 act 字符串作为 stage.description，自动补 enterConditions / completionConditions 占位）。

后续在 GamePage 设置区可"重新生成主弧"——但要警示玩家：会丢失已 achieved 的 beats。

### 4.2 模型选择

`settings.randomModel || settings.storyModel`（与现有创世模型一致）。

### 4.2.1 输入必含 worldBookEntries（重要）

> 实测发现：主弧生成只读 outline 不读世界书，会把世界书定义的能力规则擅自简化（例：将 wb_2「主角可随时主动施用能力」误读为 outline 中"心中祈求"措辞，写成"情绪驱动"机制，与世界书直接矛盾）。
>
> 因此 `requestMasterArc` 与 `buildMasterArcUser` 必须接收当前旅程激活的 `worldBookEntries`（含 alwaysActive 与关键词触发条目两类）。System prompt 中已加最高优先级约束：「stages 不得违反任何 alwaysActive 世界书条目；与大纲冲突时以世界书为准」。

### 4.2.2 输入必含 initialScene（重要）

主弧生成还必须接收创建旅程时的真实开局正文 `initialScene`：

- 玩家点过「随机开局」时，传随机生成后的开局文本。
- 玩家保持预设开局时，传出身自带 `background.startScene`。
- 手动重新生成主弧时，传当前存档第 0 轮 assistant 开局消息。

否则第一个 stage 只能根据出身简介与大纲泛化，容易忽略开场已经给出的地点、压力点、NPC 引子与即时危机。

调用方（`SetupPage` 与 `GamePage.regenerateMasterArc`）必须同时传入 `initialScene`，并用 `flattenWorldBookEntries(worldBooks, content.worldBookIds)` 取出世界书条目。


### 4.3 System Prompt（落地于 `src/prompts/authorMasterArcSystem.ts`）

当前实现采用新的提示词位置策略：

- system prompt：只放主弧 JSON 输出规则、阶段设计规则、世界书一致性规则。
- user prompt：放故事大纲、世界书、主角 / 出身、当前故事情节、玩家额外要求。
- user prompt 末尾：放“你是此互动小说的主弧设计师”的任务身份与工作对象。
- 主弧生成链路暂不追加 DeepSeek V4 `【思维模式要求】`，用于测试“任务身份压在 user 末尾”的效果。

```text
你是互动小说的"主弧设计师"。在玩家创建旅程后，你将根据故事大纲、出身、玩家偏好，输出整段游戏的"主弧"——一组按剧情递进的阶段，每个阶段定义：进入条件、完成条件、期望节拍。

你不绑定回合数。阶段的推进由"剧情完成条件"决定，不是"已完成多少回合"决定。这让玩家可以按自己节奏走完每个阶段，无论快慢。

输出协议：
1. 只能输出合法 JSON，禁止 Markdown 围栏、注释、解释。
2. 形状如下：
{
  "title": "主弧标题，≤24字（可不同于大纲标题，更具诗意）",
  "summary": "整段游戏的核心走向，≤220字。说明主线如何从开端走到结局，哪些是关键转折。",
  "stages": [
    {
      "name": "觉醒",
      "description": "主角因女厕风波意外获得性别转换能力并完成第一次自主转换。本阶段重点在初次接触能力、突破自我设限、完成首次脱困。",
      "enterConditions": ["游戏开始即活跃"],
      "completionConditions": [
        "主角已完成第一次自主性别转换",
        "脱离女厕直接危机",
        "对能力机制有初步直觉理解"
      ],
      "expectedBeats": [
        { "description": "误入女厕被发现并陷入危机" },
        { "description": "在压力下意外觉醒能力" },
        { "description": "成功转换并解除当前危机" },
        { "description": "脱离案发现场，回到安全空间" }
      ]
    },
    {
      "name": "摸索能力",
      "description": "主角在安全环境中测试能力的边界规则——是否可逆、是否对他人有效、是否有冷却。同时初步建立第二身份。",
      "enterConditions": [
        "主角已完成首次转换",
        "进入安全空间（如宿舍）"
      ],
      "completionConditions": [
        "主角理解能力的基础规则（可逆、对他人）",
        "主角已建立至少一套女生身份的初步资料（假名、装扮）"
      ],
      "expectedBeats": [
        { "description": "回到独处空间，对镜审视新身体" },
        { "description": "尝试主动变回原身验证可逆性" },
        { "description": "建立假名 / 准备女装等第二身份基础" },
        { "description": "首次以女生身份外出体验" }
      ]
    }
    // ... 后续阶段按 outline.acts 与玩家偏好生成
  ]
}

设计要求：
- stages 数量通常等于 outline.acts.length；如果 outline 给出的幕较粗，可拆细为 4-6 个 stage。
- enterConditions / completionConditions 用**剧情语义描述**，不写"第 X 回合"。
- expectedBeats 是阶段内**建议节拍**，3-8 条；用动词短语，不写时间。
- 第一个 stage 的 enterConditions 可写"游戏开始即活跃"。
- 最后一个 stage 的 completionConditions 应当与 outline 结局对齐。
- 不要泄露完整剧透——expectedBeats 给方向不给结局细节。
- 要兼容多种玩家走法：completionConditions 必须可由不同剧情路径达成。

边界纪律：
- 不输出回合数、不输出 startRound/endRound 字段（即使输入提到）。
- 不要替导演写每回合方向——你只定义阶段。
- 不要替守护者写设定细节——那是世界书的事。
```

### 4.4 User Prompt 拼装

```text
【主弧设计任务】请根据以下大纲与出身设计整段游戏的主弧。

【故事大纲】
标题：{{outline.title}}
梗概：{{outline.synopsis}}
预设阶段（参考用，可拆细）：{{outline.acts | join(' / ')}}
文风：{{outline.tone}}

【主角 / 出身】
姓名：{{characterName}}
出身：{{background.name}}
描述：{{background.description}}
特质：{{background.traits | join('、')}}

【玩家给主弧设计师的额外要求】
{{config.stageHint || '（无）'}}

请按系统协议输出 JSON。stages 数量建议 {{expectedStageCount || outline.acts.length}} 个。
```

### 4.5 Service（落地于 `src/services/authorMasterArcAgent.ts`）

参考 `authorDirectorAgent.ts` 风格。sanitize 注意：
- title ≤24 字，summary ≤220 字
- stages 限 3-8 个；每个 stage：name ≤16 字、description ≤220 字、enterConditions ≤4 条 ≤60 字、completionConditions ≤5 条 ≤80 字、expectedBeats 3-8 个 ≤80 字
- 强制赋 id（`stage_<idx>` 或 genId）
- 第一个 stage 的 status 设为 `'active'`，其余 `'pending'`
- expectedBeats 全部初始化为 status='pending'

失败兜底：返回 undefined，调用方按"outline.acts 直接转换"做 fallback：

```ts
function fallbackMasterArcFromOutline(outline: StoryOutline): MasterArcState {
  return {
    title: outline.title,
    summary: outline.synopsis.slice(0, 220),
    stages: outline.acts.map((act, i) => ({
      id: genId(`stage_${i}`),
      name: act.split(/[：:【】]/)[0]?.slice(0, 16) || `第 ${i + 1} 阶段`,
      description: act.slice(0, 220),
      enterConditions: i === 0 ? ['游戏开始即活跃'] : ['上一阶段完成'],
      completionConditions: ['本阶段主要剧情节拍均已展开'],
      expectedBeats: [],
      status: i === 0 ? 'active' : 'pending',
    })),
    currentStageIndex: 0,
    generatedAtRound: 0,
    updatedAtRound: 0,
  };
}
```

## 5. 阶段判断模型

### 5.1 触发

每回合**最先**调用，在 `requestSettingGuard` 之前。失败时 fallback：保持上次 stageJudge 状态，故事 prompt 用上次的 storyFocus（若有）；同时 setSettingGuard 之前打 lastError 给 UI。

### 5.2 模型选择

`settings.randomModel || settings.decisionModel || settings.storyModel`。建议用 flash 级模型（快），它每回合都跑。

### 5.3 System Prompt（落地于 `src/prompts/authorStageJudgeSystem.ts`）

```text
你是互动小说的"阶段判断 / 玩家意图分析师"。每回合在故事生成之前最先跑。你不写正文，不出选项，不规划长线，只回答四个问题：

1. 玩家本回合最想做的一件具体事是什么？（playerIntent.primary）
2. 玩家最近的节奏是 immersive / exploratory / progressing / hurrying 哪一种？（playerPace）
3. 当前阶段完成度如何？是否应该推进到下一阶段？（stageStatus）
4. 故事模型本回合应该聚焦哪一件微节拍？（storyFocus.thisRound）

输出协议：
1. 只能输出合法 JSON，禁止 Markdown 围栏、注释、解释。
2. 形状如下：
{
  "playerIntent": {
    "primary": "玩家本回合想完成的一件具体事，≤80字",
    "secondary": ["可演绎的次要诉求，最多3条"],
    "implicit": "玩家没明说但意图里隐含的，≤80字（可省略）"
  },
  "playerPace": "immersive",
  "paceReasoning": "判断依据，≤140字",
  "stageStatus": {
    "currentStageId": "stage_xxx",
    "completion": 35,
    "newlyAchievedBeats": ["beat_xxx"],
    "shouldAdvance": false,
    "advanceReasoning": "本阶段还有X个关键beat未达成，且玩家仍在探索能力规则；建议保留至少2-3回合完成本阶段。"
  },
  "storyFocus": {
    "thisRound": "本回合让主角完成XX一件具体事；不要顺带把YY、ZZ的多步压在一起。",
    "avoid": ["不要立刻推进到下一阶段","不要让主角一回合内完成多个空间转移"]
  }
}

playerPace 判定标准：
- immersive：玩家在细描感受 / 反复琢磨内心 / 不主动推进 / 反思上一回合的细节。例："呸，说点大家不知道的，有点小激动啊" / "我先盘算一下..."
- exploratory：玩家在试探各种小动作 / 反复改主意 / 对环境元素反应过度。例："等等先看垃圾桶" / "啊？我脑子一片空白"
- progressing：玩家给出明确的"接下来去 X" / "我想做 Y" 的主动推进。例："找找共享电单车去鞋店" / "买完鞋去干什么呢"
- hurrying：玩家明确说"快进 / 直接 X / 跳到 Y" / 多个动作连起来要求一次完成。例："直接回宿舍换衣服出去逛街" / "省略路上"

stageStatus.shouldAdvance 判定标准：
- 仅当 currentStage 的 completionConditions 全部满足，且 expectedBeats 至少 70% achieved 时才输出 true。
- 玩家如果明确说"我想进入下一阶段 / 跳过这部分"，shouldAdvance=true，advanceReasoning 注明"玩家主动要求"。
- 否则 shouldAdvance=false。
- newlyAchievedBeats 仅包含本回合**新**达成的 beat id；之前已 achieved 的不要重复列出。

storyFocus.thisRound 写作要求：
- 必须**单一**——只写一件具体事。
- 必须呼应 playerIntent.primary，但要把它分解为**一个微节拍**而不是多步压缩。
- 例：玩家说"先变回去再回宿舍"——thisRound 应是"让主角找到一个隐蔽角落（如杂物间），开始尝试变回男生"，而不是"变回男生 + 回宿舍 + 藏好女装"。
- avoid 必须列出**本回合应该被刻意延后**的多步压缩动作，给故事模型明确的负面边界。

边界纪律：
- 不要替故事模型写正文片段。
- 不要替导演规划未来多个回合。
- 不要替守护者补充世界设定。
- 不要在 advanceReasoning 中泄露未发生的剧情。
- 玩家自定义提示词的额外要求需纳入考量，但不能违反上述协议。
```

### 5.4 User Prompt 拼装

```text
【阶段判断任务】请为即将开始的第 {{nextRound}} 回合做事前阶段与意图判断。
已完成回合：{{currentRound}}

【主弧 · 当前阶段】
当前阶段：{{currentStage.name}}（id: {{currentStage.id}}）
阶段目标：{{currentStage.description}}
完成条件：
- {{currentStage.completionConditions[0]}}
- ...
期望节拍：
- [{{beat.status}}] {{beat.id}}：{{beat.description}}
- ...

【主弧 · 后续阶段（仅供参考，不要替主角推进）】
- {{nextStage.name}}：{{nextStage.description.slice(0, 60)}}

【最近上下文（最近 6 条）】
{{recent}}

【玩家本回合最新输入】
{{playerInput}}

【已知 NPC（仅前 8 个）】
{{npcs}}

【当前场景】
{{currentScene}}

【当前导演计划（参考用）】
{{narrativePlan}}

【玩家给阶段判断的额外要求】
{{config.prompt || '（无）'}}

请按系统协议输出 JSON。
```

### 5.5 Service（落地于 `src/services/authorStageJudgeAgent.ts`）

参考 `authorSettingGuardAgent.ts` 风格。sanitize 关键：
- playerPace 仅四个枚举之一，未识别时默认 `'progressing'`
- stageStatus.completion clamp 0-100
- stageStatus.shouldAdvance 强制 boolean
- storyFocus.thisRound ≤140 字
- newlyAchievedBeats 必须是当前 stage 的 expectedBeats[].id 子集（store 层会再校验）

失败兜底：返回 undefined，GamePage 不阻塞故事生成；如果有上一回合的 stageJudge，把 storyFocus.thisRound 沿用。

## 6. 故事模型 prompt 改造

### 6.1 删掉的部分

- `storySystem.ts` 删除 `buildActPlanBlock` 整个函数及其调用。
- `storySystem.ts` 渲染时删除"已完成 X 回合，本回合结束后还剩 Y 回合"的细节描述（保留"当前即将开始第 X 回合"作为软参考）。
- `narrativePlanBlock` 删除 `阶段范围：第 X-Y 回合` / `接下来若干回合方向：第 X-Y 回合 ...` 等带回合数的渲染。改为按"阶段"和"节拍"渲染。

### 6.2 新增的块

注入位置（建议）：

```
{{roundInfo}}                       # 软回合信息
{{outlineBlock}}                    # 大纲（去掉 actPlanBlock）
{{masterArcBlock}}                  # 新增 · 主弧 + 当前阶段
{{stageJudgeBlock}}                 # 新增 · 玩家意图与节奏（最高优先级）
{{storyArcBlock}}                   # 长线事件（去掉回合区间）
{{backgroundBlock}}
{{worldBookAlwaysBlock}}
{{worldBookTriggeredBlock}}
{{summaryBlock}}
{{memoryBlock}}
{{narrativePlanBlock}}              # 改造 · 不带回合区间
{{settingGuardBlock}}               # 既有
{{logicReviewBlock}}                # 既有
{{npcsBlock}}
{{anchorsBlock}}
{{backpackBlock}}
{{currentSceneBlock}}
{{strictCustomBlock}}
{{usedItemsBlock}}
{{writingRulesBlock}}               # 改造 · 加 playerPace 适配规则
{{styleAddendumBlock}}
{{specialBlock}}
```

### 6.3 masterArcBlock 草稿

```ts
const masterArc = authorNarrative?.masterArc;
const masterArcBlock = (() => {
  if (!masterArc) return '';
  const current = masterArc.stages[masterArc.currentStageIndex];
  if (!current) return '';
  const lines = [
    '【执笔模式 · 主弧】',
    `主弧：${masterArc.title}`,
    `走向：${masterArc.summary}`,
    '',
    `当前阶段：${current.name}`,
    `阶段目标：${current.description}`,
  ];
  if (current.completionConditions?.length) {
    lines.push(`完成条件：`);
    current.completionConditions.forEach((c) => lines.push(`· ${c}`));
  }
  const pendingBeats = current.expectedBeats?.filter((b) => b.status === 'pending') ?? [];
  if (pendingBeats.length) {
    lines.push('', '本阶段待完成的节拍（**不要一回合压多个**）：');
    pendingBeats.slice(0, 8).forEach((b) => lines.push(`· ${b.description}`));
  }
  const next = masterArc.stages[masterArc.currentStageIndex + 1];
  if (next) {
    lines.push('', `下一阶段（仅供参考，不要主动推进过去）：${next.name} —— ${next.description.slice(0, 60)}`);
  }
  return lines.join('\n');
})();
```

### 6.4 stageJudgeBlock 草稿（最高优先级，紧贴 masterArc）

```ts
const stageJudge = authorNarrative?.stageJudge;
const stageJudgeBlock = (() => {
  if (!stageJudge) return '';
  const lines = [
    '【执笔模式 · 本回合玩家意图与节奏】（最高优先级，必须遵守）',
    `玩家想做：${stageJudge.playerIntent.primary}`,
  ];
  if (stageJudge.playerIntent.secondary?.length) {
    lines.push(`顺带诉求：${stageJudge.playerIntent.secondary.join('；')}`);
  }
  if (stageJudge.playerIntent.implicit) {
    lines.push(`隐含意图：${stageJudge.playerIntent.implicit}`);
  }
  lines.push(`节奏：${paceToHumanReadable(stageJudge.playerPace)}`);
  if (stageJudge.paceReasoning) {
    lines.push(`节奏依据：${stageJudge.paceReasoning}`);
  }
  lines.push(`本回合聚焦：${stageJudge.storyFocus.thisRound}`);
  if (stageJudge.storyFocus.avoid?.length) {
    lines.push('本回合刻意避免：');
    stageJudge.storyFocus.avoid.forEach((a) => lines.push(`· ${a}`));
  }
  return lines.join('\n');
})();

function paceToHumanReadable(pace: PlayerPace): string {
  switch (pace) {
    case 'immersive': return 'immersive — 玩家在细致体验，每回合只推进一个微节拍，多写感官与心境';
    case 'exploratory': return 'exploratory — 玩家在试探，每回合一个动作 + NPC 即时反应';
    case 'progressing': return 'progressing — 玩家在主动推进，正常推进一个剧情节拍';
    case 'hurrying': return 'hurrying — 玩家明确想跳过，可压缩多步但仍要点出关键变化';
  }
}
```

### 6.5 writingRulesBlock 改造

在原"写作规范"末尾追加：

```text
9. 节奏纪律（最高优先级）：本回合只完成上方【本回合聚焦】指明的一件事。绝不为了"追阶段进度"而把多步动作压在一回合（如：变身 + 走路 + 换装 + 对话 + 反思）。即使玩家输入提到多个动作，也要按 playerPace 对应的纪律拆分——如果玩家是 immersive 或 exploratory，挑最关键的第一步写完即可，停在自然的下一选择点。
10. 阶段纪律：当前阶段未完成时，不要主动让主角触发下一阶段标志性事件。完成条件由【本回合玩家意图与节奏】判断，不是由你判断。
```

### 6.6 narrativePlanBlock 改造

去掉所有回合区间，改为：

```text
【执笔模式 · 当前叙事导演计划】
当前幕：xxx
当前阶段：xxx
阶段目标：xxx
近期方向：
· 阶段目标 1
· 阶段目标 2
· ...
节奏建议：xxx
风险提醒：xxx；xxx
```

`narrativePlan.stageStartRound / stageTargetEndRound / nextFewRoundsPlan[].startRound/endRound` 字段在数据层**删除**，不再持久化。

## 7. 既有字段的删/改/保

| 字段 | 处理 |
|---|---|
| `outline.acts` | **保留**——作为主弧生成模型的输入 |
| `strictCustom.detailedOutline[].startRound/endRound` | **保留字段名但改语义**——UI 改写为"建议进入回合 / 建议完成回合"，prompt 注入时只写"建议在游戏前期 / 中期 / 后期出现"而非具体回合 |
| `narrativePlan.stageStartRound / stageTargetEndRound` | **删除字段** |
| `narrativePlan.nextFewRoundsPlan[].startRound/endRound` | **删除字段**——改为有序节拍列表 |
| `StoryArc.targetEndRound` | **删除**——改为 `targetCompletionSignal: string`（剧情语义描述） |
| `StoryArc.stages[].startRound/endRound` | **删除**——stages 改为带 `enterCondition` / `completionSignal` |
| `RandomEvent.minRound / cooldown` | **保留**——只控制"最早可触发"/ 冷却，不与阶段挂钩 |
| `RandomEvent.once` | **保留** |
| storySystem prompt 的 `nextRound / totalRounds / remainingAfter` | **保留**作为软参考；但 prompt 文案改成"软提示"而非"硬约束" |
| 导演 `horizonRounds` | **删除**——导演改为输出"未来 N 个节拍"而非"未来 N 个回合" |
| 导演 `everyRounds` | **保留**作为调度频率 |
| `lengthHint`（短/标准/长篇幅按字数） | **保留**，但故事 prompt 文案补充："如果 playerPace=immersive，可以靠近字数下限但更细腻；如果 hurrying 可以靠近上限但仍只写一个节拍" |

## 8. 守护者 / 导演 / 审校 / 决策的适配

### 8.1 守护者（已实现，仅扩展输入）

`buildSettingGuardUser` 加入：
- `currentStage`（来自 masterArc）
- `playerPace + storyFocus`（来自上一回合 stageJudge，因为本回合 stageJudge 已先跑）

让守护者输出更贴合当前阶段。如果 playerPace 是 immersive，守护者应当**降低** ambientBeats 数量（避免外部反应打扰玩家沉浸）。

system prompt 加一条规则：
```
ambientBeats 数量限制按 playerPace 调整：
- immersive：最多 1 条且必须 optional=true
- exploratory：最多 2 条
- progressing / hurrying：最多 3 条
```

### 8.2 导演（既有，需改造）

- 输入加入 masterArc + stageJudge
- 输出去掉 stageStartRound/stageTargetEndRound 字段
- 改为输出 nextFewBeats（有序节拍列表，不绑回合）
- 当 stageJudge.shouldAdvance=true 时，导演应当为新阶段重新规划（不再贴合旧阶段）

### 8.3 审校（既有，需扩展）

- 输入加入 masterArc + stageJudge
- 新增检查项：故事是否违反 playerPace / 是否在 stageJudge.shouldAdvance=false 时强行推进阶段
- severity 标准追加：违反 playerPace（多步压一回合）= warning；强行推进阶段 = critical

### 8.4 决策（既有，需扩展）

- choices 应当贴合 stageJudge.storyFocus.thisRound
- 当 playerPace=immersive 时，choices 应该更"微"（小动作 / 内心抉择），不要给"立即推进剧情"的选项

system prompt 中追加规则：
```
choices 应贴合上方【本回合玩家意图与节奏】的 storyFocus.thisRound；如果 playerPace=immersive 或 exploratory，避免出现"立即推进到下一阶段"或"省略中间过程"的 choice 选项。
```

## 9. UI 改动

### 9.1 主弧面板（src/components/MasterArcPanel.tsx 新增）

挂在游戏页右侧，置顶（高于 AuthorArcPanel / SettingGuardPanel）：

```
主弧 · 错位青春
├─ 整体走向（折叠）
├─ 阶段进度条
│  ├─ ✓ 觉醒
│  ├─ ▶ 摸索能力（当前 · 进度 35%）
│  ├─ ○ 建立双重生活
│  ├─ ○ 转折
│  └─ ○ 收束
├─ 当前阶段详情（默认展开）
│  ├─ 目标：...
│  ├─ 完成条件（带 ✓ / ○）
│  └─ 期望节拍（带 ✓ / ○）
└─ [手动标记此阶段完成] 按钮（用户兜底）
```

### 9.2 阶段判断面板（合入主弧面板或独立）

显示：
- 玩家意图（primary / secondary / implicit）
- playerPace（带颜色标签）
- 阶段进度（与上方一致）
- 本回合聚焦（正高亮显示，醒目）
- 应避免（小字）

如果 stageJudge.lastError，UI 显示"判断失败，沿用上次"。

### 9.3 SetupPage 加配置

执笔模式区追加：
- "阶段判断"开关与提示词（默认开启）
- "主弧自动生成"开关与提示词（默认开启）
- 期望阶段数（数字输入，默认从 outline.acts.length 推导）

### 9.4 GamePage 加"重新生成主弧"

在主弧面板右上角加一个齿轮，点击弹出对话框警示"会丢失已 achieved 的 beats"，确认后调用 requestMasterArc 重新生成。

## 10. 旧存档不兼容策略

按用户决定：**旧旅程包不再支持**。

### 10.1 检测与拒绝

`importSave` 与 persist `merge` 在加载存档时检查：

```ts
function isLegacySave(save: GameSave): { legacy: boolean; reason?: string } {
  if (save.content.mode !== 'author') return { legacy: false };
  if (!save.state.authorNarrative?.masterArc) {
    return { legacy: true, reason: '此存档创建于阶段化叙事之前，不再支持继续游玩。请创建新旅程。' };
  }
  return { legacy: false };
}
```

加载时若 legacy=true：
- 仍然加入 saves，但 phase 强制设为 'ended'
- HomePage 列表显示这个存档时打"旧版（不可继续）"标签
- 点击进入弹窗解释，不允许进游戏页

### 10.2 SetupPage 不接受老旅程包

`importSave` 直接拒绝：

```ts
if (incoming.content.mode === 'author' && !incoming.state.authorNarrative?.masterArc) {
  throw new Error('此旅程包来自不兼容的旧版本（无主弧数据）。请使用新版重新创建旅程。');
}
```

### 10.3 现有"曦雨"和"旅人"两个测试包

会被识别为 legacy。这是预期行为。

## 11. 失败兜底

| 失败位 | 行为 |
|---|---|
| 主弧生成模型失败 | fallback 为 `fallbackMasterArcFromOutline`；不阻塞旅程创建 |
| stageJudge 失败 | 沿用上次 stageJudge 状态；故事 prompt 仍能用上次 storyFocus |
| stageJudge 持续失败 N 轮 | UI 显示"阶段判断失效，故事按导演计划继续"；不阻塞主流程 |
| advanceMasterArcStage 失败（如 stageId 不匹配） | console.warn；保持当前 stage 不变 |

**核心原则**：阶段判断 / 主弧 **永远不阻塞故事生成**。

## 12. 实施顺序

| # | 任务 | 归属 | 工时估计 |
|---|---|---|---|
| 1 | types/game.ts 新增类型（NarrativeStage / MasterArcState / StageJudgeState 等） | 已由提示词工程师完成 | 0.5h |
| 2 | lib/authorMode.ts 新增默认配置 + normalize 函数 | 维护模型 | 0.5h |
| 3 | prompts/authorMasterArcSystem.ts | 已由提示词工程师完成 | - |
| 4 | prompts/authorStageJudgeSystem.ts | 已由提示词工程师完成 | - |
| 5 | services/authorMasterArcAgent.ts + sanitize + fallback | 维护模型 | 1.5h |
| 6 | services/authorStageJudgeAgent.ts + sanitize | 维护模型 | 1h |
| 7 | useGameStore 新增 actions（setMasterArc / advanceMasterArcStage / applyStageJudgeResult / markBeatAchieved 等） | 维护模型 | 2h |
| 8 | 旧存档检测与拒绝（importSave + merge + HomePage UI） | 维护模型 | 1h |
| 9 | SetupPage 主弧生成调用 + 阶段判断 / 主弧配置区 | 维护模型 | 2h |
| 10 | GamePage 调度调整（stageJudge 最先 + 推进 stage 调用） | 维护模型 | 1.5h |
| 11 | storySystem.ts 改造（删 buildActPlanBlock + 新增 masterArcBlock / stageJudgeBlock + writingRulesBlock 追加规则 + narrativePlanBlock 改造） | 提示词工程师 | 1.5h |
| 12 | strictCustom.ts DEFAULT_STORY_SYSTEM_TEMPLATE 加新占位符 | 提示词工程师 | 0.3h |
| 13 | 既有 prompts 适配（director / logicCheck / decision / settingGuard / randomEvent 加 stageJudge 输入） | 提示词工程师 | 2h |
| 14 | 既有 agent service 接口扩展 | 维护模型 | 1.5h |
| 15 | components/MasterArcPanel.tsx + 阶段判断显示 | 维护模型 | 2h |
| 16 | 自测 + 跑构建 + 用第 13 节验收清单跑 | 双方 | 1h |

预计总工时 17-20 小时（双方协作）。

## 13. 验收标准

| # | 场景 | 期望 |
|---|---|---|
| 1 | 创建新旅程"错位青春" | 主弧生成模型产出 4-6 个 stages（如：觉醒 / 摸索 / 双重生活 / 转折 / 收束）；stages 不带 startRound/endRound |
| 2 | 第 5 回合玩家说"哪个神都行让我摆脱这次危机" | stageJudge 输出 playerPace=exploratory 或 immersive；storyFocus.thisRound=单一节拍（如"觉醒第一次能力 / 看到陌生身体"）；故事正文**只写到觉醒成功**，不一回合写完"觉醒+脱困+路人离开" |
| 3 | 玩家持续 3 回合在沉浸描写 | playerPace=immersive；故事 prompt 注入"每回合只推进一个微节拍"；主弧不擅自推进 |
| 4 | 玩家说"快进，直接到下午回宿舍" | playerPace=hurrying；故事允许压缩多步但仍点出关键变化 |
| 5 | 当前阶段所有 expectedBeats achieved | stageJudge.shouldAdvance=true；调用 advanceMasterArcStage；下一回合 prompt 中 currentStage 变成下一个 |
| 6 | 玩家手动点"标记此阶段完成" | 立即推进到下一阶段；stageJudge 下次跑时认可 |
| 7 | 主弧生成失败 | fallback 为 outline.acts 转换；不阻塞旅程创建 |
| 8 | stageJudge 失败 | 故事仍能生成；prompt 用上次 stageJudge；UI 显示警告 |
| 9 | 导入"曦雨"或"旅人"旧旅程包 | 拒绝导入或加载后强制 ended；提示用户重建 |
| 10 | 跑长流程（30+ 回合） | 故事正文不再出现"一回合压多步"现象；阶段进度条平滑推进 |

## 14. 与既有计划文档的协调

`docs/execution-plan.md` 进度表更新：

- Phase 1.0 设定守护者：☑ 完成（已并入维护期）
- **Phase 1.0.5 阶段判断 + 主弧（覆盖原 1.1）**：本特性
- Phase 1.1 主弧：合并入本特性，不再单独存在
- Phase 1.2 关系分析：保留
- Phase 1.3 时间线：保留
- Phase 1.4 伏笔：保留（伏笔可挂到阶段下，作为某阶段的 expectedBeat）
- Phase 1.5 事件弧进度：本特性已经处理了"事件弧不绑回合"的部分；剩下的 arcProgress 仍按原计划

## 15. 不在本特性范围

- Phase 1.2 关系分析、1.3 时间线、1.4 伏笔追踪
- Phase 1.5 决策 arcProgress 协议（虽然事件弧已去掉回合绑定，但 arcProgress 字段单独再做）
- 主弧编辑器（Phase 2）：本特性只提供"重新生成"按钮 + 简单进度显示，完整阶段编辑（手动改名 / 改条件 / 加 beat）放 Phase 2

实施完成后请回到 `docs/execution-plan.md` 把进度跟踪表的 Phase 1.0.5 一行打勾。
