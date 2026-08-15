# 执笔模式小说化目标与实现路线图

> 目标：把执笔模式从「强提示词编辑器」升级为「小说导演系统」。本文只写目标、架构、模型链路、触发时机与阶段计划，不直接实现代码。

## 最高目标

执笔模式要让故事像一部好的、有逻辑的小说：

- 有开端、发展、高潮、收束和结局。
- 有明确的长阶段目标与短阶段目标。
- 每个回合都知道自己服务于哪个阶段目标。
- 上文承接下文，不随意跳跃。
- 人物关系、场景、道具、设定保持统一。
- 伏笔能埋下，也能在合适时机回收。
- 支线 / 随机事件不是孤立插曲，而是能服务主线、人物关系和情绪推进。
- 模型写作自由，但被一个「导演层」约束方向、节奏和逻辑。

一句话：

> 故事模型负责写，导演系统负责知道为什么写、写到哪里、接下来往哪写。

## 核心概念

### 1. 叙事计划 Narrative Plan

记录当前故事的方向。

它不是历史摘要，而是「未来写作计划」：

- 当前处于哪一幕 / 哪个阶段。
- 当前阶段目标是什么。
- 当前阶段预计在哪些回合完成。
- 下一回合重点是什么。
- 未来 X 回合要完成哪些 beat。
- 哪些内容必须写。
- 哪些内容不能提前写。
- 当前大纲对齐情况如何。

### 2. 故事弧 Story Arc

一个持续多回合的事件 / 支线 / 关系推进单元。

例如：

- 小晴邀请主角逛街。
- 主角调查旧校舍。
- 误会从产生到爆发。
- 某个伏笔从出现到回收。

故事弧可以来自：

- 玩家手写。
- 书库导入。
- 动态随机事件模型生成。
- 大纲映射模型生成。
- 伏笔系统触发。
- 角色关系满足条件触发。

随机事件未来应视为 Story Arc 的一种来源，而不是独立孤立机制。

### 3. 角色关系状态 Relationship State

不只记录好感度，还记录关系推进逻辑：

- 关系阶段。
- 当前情绪。
- 表层态度。
- 隐含欲望 / 真实意图。
- 主角已知信息。
- 导演层已知但正文不能直接剧透的信息。
- 未解决矛盾。
- 下一步可能行动。

### 4. 场景连续性 Scene Continuity

场景不只是名字，还应有状态：

- 稳定事实。
- 临时变化。
- 可利用元素。
- 氛围。
- 时间与天气影响。
- 哪些物品 / 人物仍在场。

### 5. 伏笔与填坑 Foreshadowing

后续实现：

- 伏笔内容。
- 首次出现回合。
- 预计回收窗口。
- 当前状态。
- 回收条件。
- 是否已回收。
- 若长时间未回收，提醒导演模型安排回收。

## 推荐新增数据结构

### GameContent

创建旅程时固化执笔模式配置：

```ts
interface GameContent {
  mode?: 'adventure' | 'author';
  authorCustom?: StrictCustomConfig;
  authorDirectorConfig?: AuthorDirectorConfig;
  authorRandomEvent?: AuthorRandomEventConfig;
}
```

### AuthorDirectorConfig

```ts
interface AuthorDirectorConfig {
  enabled: boolean;
  planningEveryRounds: number;      // 每多少回合刷新叙事计划
  planningHorizonRounds: number;    // 一次规划未来多少回合
  directorPrompt: string;           // 导演模型额外提示
  outlineMappingPrompt: string;     // 大纲映射偏好
  relationshipPrompt: string;       // 角色关系分析偏好
  scenePrompt: string;              // 场景连续性分析偏好
}
```

### NarrativePlanState

```ts
interface NarrativePlanState {
  currentAct?: string;
  currentStage?: string;
  stageGoal?: string;
  stageStartRound?: number;
  stageTargetEndRound?: number;
  nextRoundFocus?: string;
  nextFewRoundsPlan: Array<{
    id: string;
    startRound: number;
    endRound: number;
    goal: string;
    requiredBeats: string[];
    avoidBeats?: string[];
    revealPolicy?: string;
  }>;
  outlineAlignment?: string;
  pacingAdvice?: string;
  riskNotes?: string[];
  updatedAtRound: number;
}
```

### StoryArc

```ts
interface StoryArc {
  id: string;
  type: 'main' | 'relationship' | 'randomEvent' | 'foreshadowing' | 'custom';
  title: string;
  summary: string;
  directive: string;
  hiddenIntent?: string;
  involvedNpcIds: string[];
  tags: string[];
  startRound: number;
  targetEndRound?: number;
  currentStageIndex: number;
  stages: Array<{
    id: string;
    startRound: number;
    endRound: number;
    title: string;
    goal: string;
    requiredBeats: string[];
    avoid?: string;
  }>;
  status: 'pending' | 'active' | 'completed' | 'cancelled';
  progressNote?: string;
  createdAt: number;
  updatedAtRound: number;
}
```

### RelationshipState

```ts
interface RelationshipState {
  npcId: string;
  relationStage: string;
  currentEmotion?: string;
  surfaceAttitude?: string;
  hiddenDesire?: string;
  knownToPlayer: string[];
  directorOnlyNotes?: string[];
  unresolvedTension?: string[];
  nextLikelyMove?: string;
  updatedAtRound: number;
}
```

### SceneContinuityState

```ts
interface SceneContinuityState {
  sceneName: string;
  stableFacts: string[];
  temporaryState: string[];
  availableHooks: string[];
  atmosphere?: string;
  updatedAtRound: number;
}
```

### AuthorNarrativeState

集中挂在 `GameState` 下：

```ts
interface AuthorNarrativeState {
  plan?: NarrativePlanState;
  activeArcs: StoryArc[];
  completedArcs: StoryArc[];
  relationships: RelationshipState[];
  scenes: SceneContinuityState[];
  lastDirectorRound?: number;
  lastLogicCheckRound?: number;
}
```

## 模型职责设计

### 1. 故事模型 Story Model

职责：

- 写正文。
- 不负责长期规划。
- 不负责判断阶段是否完成。
- 不负责整理状态。

输入应包含：

- 大纲。
- 世界书。
- 历史摘要。
- 长期记忆。
- 当前叙事计划。
- 正在进行的故事弧。
- 角色关系状态。
- 场景连续性状态。
- 玩家输入。
- 本回合特殊事件。

输出：

- 纯故事正文。

### 2. 决策 / 状态分析模型 Decision + State Model

当前已有 `decisionAgent`，后续在执笔模式中增强为「状态分析模型」。

职责：

- 继续维护：
  - 选项。
  - 道具。
  - NPC。
  - 场景。
  - 时间天气。
- 新增维护：
  - 当前故事弧进度。
  - 当前阶段目标是否推进。
  - 角色关系状态变化。
  - 场景连续性变化。
  - 是否发现大纲偏离风险。

触发时机：

- 每次故事模型完成后调用。
- 自由行动回合也必须调用。

输出：

```json
{
  "choices": [],
  "grants": [],
  "itemPatches": [],
  "npcs": [],
  "currentScene": {},
  "availableScenes": [],
  "arcProgress": [],
  "relationshipUpdates": [],
  "sceneContinuityUpdates": [],
  "stageProgress": {
    "advanced": true,
    "completedBeats": [],
    "riskNotes": []
  }
}
```

### 3. 叙事总控模型 Narrative Director Model

这是执笔模式核心新增模型。

职责：

- 分析当前故事与大纲的关系。
- 判断当前阶段。
- 制定未来 X 回合方向。
- 给下一回合明确 focus。
- 决定哪些伏笔 / 关系 / 事件应被推进。
- 给故事模型提供约束，而不是替故事模型写正文。

触发时机：

- 创建旅程后，可在第一回合前生成初始计划。
- 每隔 `planningEveryRounds` 回合触发。
- 当前阶段完成时触发。
- 新 Story Arc 触发 / 完成时触发。
- 玩家大幅偏离计划时触发。

输入：

- 原始大纲与 act plan。
- 当前历史摘要。
- 最近对话。
- 长期记忆。
- 当前 NPC / 关系状态。
- 当前场景状态。
- 当前 active arcs。
- completed arcs。
- 玩家执笔模式提示词。

输出：

- `NarrativePlanState`

### 4. 大纲映射模型 Outline Mapping Model

初版可并入 Narrative Director Model。

后续若导演模型太重，再拆出。

职责：

- 判断当前故事实际推进到大纲哪一幕。
- 分析偏离是否合理。
- 为未来 X 回合分配大纲目标。

触发时机：

- 与 Narrative Director 同步。
- 或每个大阶段结束时触发。

### 5. 动态事件弧模型 Dynamic Arc / Random Event Model

对应之前的「动态随机事件」。

职责：

- 根据剧情判断是否应该触发一个新 Story Arc。
- 若触发，生成较长线事件计划。
- 事件可服务恋爱、误会、伏笔回收、主线纠偏等。

触发时机：

- 故事模型完成。
- 决策 / 状态分析完成。
- Narrative Director 更新后。
- 系统判断下一回合处于事件检查窗口时。

为什么放在 Director 之后：

- 动态事件应服务当前叙事计划。
- 如果 Director 认为未来三回合应收束主线，事件模型就不应生成无关支线。

输出：

- 不触发原因。
- 或一个 `StoryArc` / `DynamicRandomEventArc`。

### 6. 长期记忆模型 Memory Model

当前已有。

职责：

- 整理稳定事实。
- 不负责计划未来。

触发时机：

- 仍按设置每 X 回合触发。
- 建议放在状态分析之后。
- 可以在 Director 之后触发，但不要让 Memory 覆盖 Director 的计划职责。

### 7. 逻辑审校模型 Logic Check Model

后置实现。

职责：

- 检查矛盾。
- 检查是否忘记设定。
- 检查是否跳阶段。
- 检查是否提前揭示秘密。
- 检查人物动机是否崩坏。

触发时机：

- 每 X 回合。
- 阶段完成时。
- 用户手动点击「审校」。

输出：

- 风险列表。
- 修正建议。
- 是否需要重新规划。

## 推荐调用顺序

### 普通游历模式

保持现有简化链路：

```text
玩家输入 / 选择
→ storyAgent
→ decisionAgent
→ memoryAgent（按间隔）
→ contextCompressor（按阈值）
```

### 执笔模式 · 初版目标链路

```text
玩家输入
→ storyAgent（吃 Narrative Plan + active Story Arcs）
→ decisionAgent / stateAnalyzer（提取状态、关系、场景、事件进度）
→ arcProgressUpdater（可先并入 stateAnalyzer）
→ narrativeDirectorAgent（按条件刷新未来 X 回合方向）
→ dynamicArcAgent（按条件判断是否生成新事件弧）
→ memoryAgent（按间隔整理稳定事实）
→ contextCompressor（按阈值）
```

注意：

- Director 不一定每回合调用，避免成本过高。
- Dynamic Arc 应在 Director 之后，避免生成与计划冲突的事件。
- Memory 不要替代 Director。
- Logic Check 后置，不要第一版塞进主循环。

## 故事模型新增提示词块

执笔模式下，故事模型 system prompt 应额外注入：

```text
【叙事总控】
当前阶段：
阶段目标：
本回合重点：
未来几回合方向：
必须包含：
禁止事项：
揭示规则：

【正在进行的故事弧】
事件名：
当前阶段：
目标结束回合：
本阶段目标：
必须包含：
隐藏真实意图：
不要直接剧透：

【角色关系状态】
角色：
关系阶段：
当前情绪：
表层态度：
主角已知：
导演备注：

【场景连续性】
稳定事实：
临时状态：
可利用元素：
氛围：
```

这些块应比普通长期记忆更靠近本回合写作指令，优先级更高。

## 分阶段实现计划

### 阶段 0：修正当前模式边界

目标：

- 保持游历模式随机事件 UI。
- 执笔模式使用自己的配置区。
- 两种模式默认都不自动加载书库事件。
- 执笔模式默认每回合自由行动。
- 执笔模式显示名称仍叫「严格自定义模式」。

涉及：

- `SetupPage.tsx`
- `useAuthorModeStore.ts`
- `GamePage.tsx`
- `types/game.ts`

### 阶段 1：建立 Story Arc 地基

目标：

- 新增 `StoryArc` 类型。
- 新增 `AuthorNarrativeState`。
- 游戏页右侧显示：
  - 正在进行的故事弧。
  - 已完成故事弧。
- 故事模型 prompt 能注入 active arcs。

暂时不加新模型，先允许手写 / 固定数据测试。

### 阶段 2：实现动态随机事件 / 动态故事弧

目标：

- 完成 `author-mode-random-events-plan.md` 中的动态事件机制。
- 动态事件生成 `StoryArc`。
- 支持长线事件多回合注入。
- 事件生成后保存到书库。
- 右侧面板可查看 active / completed events。

新增：

- `src/prompts/authorRandomEventSystem.ts`
- `src/services/authorRandomEventAgent.ts`

### 阶段 3：增强决策模型为状态分析模型

目标：

- 增加事件弧进度输出。
- 增加角色关系状态输出。
- 增加场景连续性状态输出。
- 增加阶段推进风险提示。

修改：

- `src/prompts/decisionSystem.ts`
- `src/services/decisionAgent.ts`
- `src/store/useGameStore.ts`

### 阶段 4：新增叙事总控模型

目标：

- 自动生成 / 刷新 `NarrativePlanState`。
- 把大纲映射到未来 X 回合目标。
- 给故事模型明确本回合重点。
- 与 active arcs 协调。

新增：

- `src/prompts/narrativeDirectorSystem.ts`
- `src/services/narrativeDirectorAgent.ts`

触发条件：

- 旅程创建后。
- 每 `planningEveryRounds` 回合。
- 阶段完成。
- 新事件弧触发或完成。
- 状态分析发现偏离风险。

### 阶段 5：角色关系 / 场景连续性强化

目标：

- 把 NPC 从「好感 + 描述」升级为关系状态。
- 场景从「名字 + 描述」升级为连续性状态。
- 在故事 prompt 中注入这些状态。

初版可由增强后的 decisionAgent 输出。

### 阶段 6：伏笔与填坑系统

目标：

- 新增伏笔列表。
- 记录首次出现、预计回收窗口、当前状态。
- Director 和 Dynamic Arc 可以基于伏笔安排事件。
- Logic Check 可以提醒长期未回收伏笔。

### 阶段 7：逻辑审校模型

目标：

- 每 X 回合检查一致性。
- 检查大纲偏离、角色动机崩坏、设定矛盾、提前揭示。
- 输出修正建议。
- 必要时触发 Narrative Director 重新规划。

## 关键设计原则

1. 不把所有内容塞进长期记忆。
   - 长期记忆记录稳定事实。
   - Narrative Plan 记录未来方向。
   - Story Arc 记录正在进行的事件。
   - Relationship State 记录关系逻辑。

2. 故事模型只写正文。
   - 不让故事模型同时承担规划、审校、状态整理。

3. 动态事件必须服务当前叙事计划。
   - 不生成无关热闹。
   - 不打断关键主线。

4. 提示词块必须分优先级。
   - 当前回合重点 > active arc 当前阶段 > narrative plan > long-term memory > summary。

5. 模型触发时机要克制。
   - 状态分析每回合。
   - Director 按条件。
   - Dynamic Arc 按窗口。
   - Memory 按间隔。
   - Logic Check 后置。

## 第一版建议实现顺序

推荐下一步不要直接做所有模型，而是按以下顺序：

1. 修正当前模式边界与随机事件默认行为。
2. 建立 `StoryArc` 数据结构和故事 prompt 注入。
3. 实现动态随机事件生成长线 `StoryArc`。
4. 游戏页右侧显示 active / completed arcs。
5. 决策模型输出 arc progress。
6. 新增 Narrative Director Model。
7. 再做角色关系 / 场景连续性。
8. 最后做伏笔和逻辑审校。

原因：

- Story Arc 是动态随机事件、伏笔、主线阶段的共同地基。
- 先把事件弧跑通，能最快验证「小说化」方向是否有效。
- Director 在 Story Arc 之后做，会更容易协调 active arcs 和大纲。

