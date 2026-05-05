# 执笔模式落地计划 v1

> 本文是「执笔模式小说化」当前阶段的统一执行计划，对标既有 `author-mode-novelization-roadmap.md` 与 `author-mode-random-events-plan.md`，但聚焦于**接下来要做什么、按什么顺序做、谁做哪部分**，不重复设计动机。
>
> 角色分工：
> - **提示词工程师**（review 现有 prompt + 调优 + 部分前端 UI）
> - **维护模型**（数据结构、agent service、store 改动、新调度逻辑、前端框架性改动）

## 1. 核心设计哲学

> **整个游戏就是一次大型 StoryArc。**所有模型协同维护一个母弧（开端 / 发展 / 高潮 / 结局），母弧之内嵌套子弧（关系弧、长线事件弧、伏笔弧）。

衡量准则：
1. 任何状态都能溯源到主弧的某个阶段。
2. 任何子弧都应**服务**或**刻意偏离**主弧节奏。
3. 任何细节（外观 / 服装 / 承诺 / 时间地点）跨回合保持一致。

## 2. 已对齐的产品决策

| 维度 | 决策 |
|---|---|
| 体验定位 | 互动小说；主为主角，次为作者；玩家做选择，故事模型给回应 |
| 伏笔识别 | 模型全自动识别 + 注入 |
| 调度策略 | 关键模型每轮跑 + 辅助模型隔轮跑 |
| 自动边界 | 重大变化（关系破裂 / NPC 死亡 / 主线阶段跳转 / 事件弧完成 / 伏笔废弃）需玩家确认；其余自动 |
| 主弧 | 明确做，实例化到存档 |
| 题材边界 | 不锁定单一题材，恋爱 / 解密 / 冒险都要兼容；具体调性靠玩家提示词 + 大纲 |

## 3. 模型调度蓝图

| 模型 | 频率 | 备注 |
|---|---|---|
| 故事模型 | 每轮 | 核心 |
| 决策 / 决策追踪 | 每轮 | 核心；新增 `arcProgress` 输出 |
| 主弧生成 / 调整 | 创建时 + 阶段切换时 | 触发式 |
| 叙事导演 | 默认每 3 轮 | 辅助 |
| 关系分析（新增） | 默认每 2 轮 | 辅助 |
| 时间线 / 场景连续性（新增） | 默认每 2 轮 | 辅助 |
| 伏笔追踪（新增） | 默认每 3 轮 | 辅助 |
| 逻辑审校 | 默认每 3 轮 | 辅助 |
| 长期记忆 | 现有 `memoryEveryRounds` | 辅助 |
| 摘要 | 历史超阈值 | 辅助 |
| 动态长线事件 | 概率 / 必定区间 | 触发式 |

辅助模型的频率必须在配置中暴露，玩家可改。

## 4. Phase 0 · 实测调优现有骨架

**执行人**：提示词工程师（独立线，不动架构）。

**目标**：在加任何新模型之前，确认现有 6 个执笔模型确实在执行用户原始愿景。

**任务**：
1. 通读现有 prompt + 拼装逻辑：
   - `src/prompts/storySystem.ts`
   - `src/prompts/decisionSystem.ts`
   - `src/prompts/memorySystem.ts`
   - `src/prompts/summarizer.ts`
   - `src/prompts/reviewSystem.ts`
   - `src/prompts/randomizer.ts`
   - `src/prompts/authorDirectorSystem.ts`
   - `src/prompts/authorRandomEventSystem.ts`
   - `src/prompts/authorLogicCheckSystem.ts`
   - `src/lib/strictCustom.ts` 与 `src/lib/authorMode.ts`（块装配）
   - `src/pages/GamePage.tsx` 中各 agent 的调用顺序与触发条件
2. 用户手测长流程（30+ 回合），重点核查：
   - 记忆模型是否抓住"美甲 / 服装 / 承诺 / 主角承诺"等细节
   - `decisionAgent` 输出的 `NPC.details` 是否稳定、是否进入记忆
   - 叙事导演计划是否真有引导力，还是被故事模型忽略
   - 逻辑审校是否能抓到具体不一致，还是只输出空泛建议
   - 6 个模型链路下记忆模型是否还在正确位置被调用
3. 出"现状缺陷清单 + prompt 调优建议"。
4. 实施 prompt + 触发时机调优；必要时小幅改 store / agent 代码。
5. 用户复测，迭代。

**产出**：调优过的 prompt 集合 + 现状报告，作为 Phase 1 维护模型工作的输入。

## 5. Phase 1 · 主弧 + 三支柱 + 事件弧进度

**执行人**：维护模型主力实现数据结构 / agent / store / GamePage 调度；提示词工程师配合写 prompt 与 UI。

按以下顺序实施。每完成一个子项可以单独发布，不必同步。

### 5.1 主弧 Master Arc

**目标**：旅程创建时生成一个 `StoryArc{type:'main'}` 实例，覆盖整段游戏的开端 / 发展 / 高潮 / 结局，作为所有其他模型的母锚。

**改动**：
- **prompt**：新增 `src/prompts/authorMasterArcSystem.ts`
- **service**：新增 `src/services/authorMasterArcAgent.ts`
- **types**：复用 `StoryArc`；可选地为 `'main'` 类型补充 `mainArcMeta`（隐藏主题、整体氛围、终局倾向等）
- **store**：`useGameStore` 加入 `setMainArc()`、`updateMainArcStage()`；存档迁移补默认值
- **触发**：
  - 旅程创建后、`SetupPage` 跳 `GamePage` 前调用一次
  - `authorDirectorAgent` 检测到主弧阶段切换时调用一次"主弧调整"
- **注入**：
  - 故事模型 prompt 顶部新增【主弧】块（高于导演计划）
  - 导演模型读取主弧 `currentStageIndex` 作为 `stageGoal` 来源
- **UI**：`AuthorArcPanel.tsx` 升级，主弧固定置顶展示，含阶段进度条

### 5.2 关系分析模型

**目标**：独立分析每个 NPC 的关系阶段、当前情绪、表层态度、隐藏欲望、主角已知信息、下一步可能行动。

**改动**：
- **types**：
  ```ts
  interface RelationshipState {
    npcId: string;
    relationStage: string;          // 陌生/熟悉/暧昧/依赖/冲突/决裂...
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
  挂在 `AuthorNarrativeState.relationships: RelationshipState[]`
- **prompt**：新增 `src/prompts/authorRelationshipSystem.ts`
- **service**：新增 `src/services/authorRelationshipAgent.ts`
- **触发**：每 N 轮（默认 2），在故事 + 决策完成后
- **注入**：故事模型 prompt 加【角色关系状态】块；导演模型也读取以判断关系推进时机
- **UI**：`CharacterPanel.tsx` 升级——节点为 NPC，边为关系阶段；点击 NPC 弹出关系详情
- **重大变化确认**：关系阶段从"暧昧/依赖"跳到"决裂"或反向，需玩家在顶部贴标确认

### 5.3 时间线 / 场景连续性模型

**目标**：维护时间一致性（当前日期、时间段、已过天数、关键事件时序）和场景连续性（稳定事实、临时状态、可利用元素、氛围）。

**改动**：
- **types**：
  ```ts
  interface TimelineState {
    currentDate?: string;
    timeOfDay?: string;
    daysSinceStart?: number;
    keyEvents: Array<{ round: number; event: string; sceneName?: string }>;
    contradictions?: string[];
    updatedAtRound: number;
  }
  interface SceneContinuityState {
    sceneName: string;
    stableFacts: string[];
    temporaryState: string[];
    availableHooks: string[];
    atmosphere?: string;
    updatedAtRound: number;
  }
  ```
  挂在 `AuthorNarrativeState.timeline` 与 `AuthorNarrativeState.scenes[]`
- **prompt**：新增 `src/prompts/authorTimelineSystem.ts`
- **service**：新增 `src/services/authorTimelineAgent.ts`（一个 agent 同时输出 timeline + sceneContinuity，省一次调用）
- **触发**：每 N 轮（默认 2）
- **注入**：故事模型 prompt 加【时间线】+【场景连续性】块；逻辑审校读取以检测矛盾
- **UI**：右侧新增 `TimelinePanel.tsx`（关键事件按时间轴排列，矛盾红色高亮）

### 5.4 伏笔追踪模型

**目标**：自动识别伏笔、维护状态、在合适时机告诉故事模型"现在可以铺垫 / 适合回收 / 禁止遗忘"。

**改动**：
- **types**：
  ```ts
  type ForeshadowingStatus =
    | 'unplanted' | 'planted' | 'recoverable' | 'recovered' | 'abandoned';
  interface Foreshadowing {
    id: string;
    name: string;
    summary: string;
    sourceRound: number;
    involvedNpcIds?: string[];
    involvedItemIds?: string[];
    involvedSceneNames?: string[];
    expectedRecoveryRange?: { start: number; end: number };
    status: ForeshadowingStatus;
    recoveryConditions?: string[];
    recoveredRound?: number;
    abandonedReason?: string;
    createdAt: number;
    updatedAtRound: number;
  }
  ```
  挂在 `AuthorNarrativeState.foreshadowings: Foreshadowing[]`
- **prompt**：新增 `src/prompts/authorForeshadowingSystem.ts`
- **service**：新增 `src/services/authorForeshadowingAgent.ts`
- **触发**：每 N 轮（默认 3），扫描最近回合识别新伏笔 + 更新现有伏笔状态
- **注入**：故事模型 prompt 加【伏笔状态】块，分三类：
  - 当前可继续铺垫
  - 当前适合回收
  - 禁止遗忘的重要伏笔
- **UI**：右侧新增 `ForeshadowingPanel.tsx`，分组显示，玩家事后可改 status / 编辑名称
- **重大变化确认**：伏笔标记为 `abandoned` 需玩家确认

### 5.5 事件弧进度更新

**目标**：让事件弧不只靠回合数推进，而是根据故事内容判断真实进展。

**改动**：
- **prompt**：扩展 `decisionSystem.ts`，输出新增字段：
  ```json
  {
    "arcProgress": [
      {
        "arcId": "...",
        "stageAdvanced": true,
        "completedBeats": ["..."],
        "shouldExtend": false,
        "shouldFinishEarly": false,
        "deviationNote": "..."
      }
    ]
  }
  ```
- **service**：`decisionAgent.ts` 解析 `arcProgress` 并 sanitize
- **store**：`useGameStore.applyArcProgress()` 应用变更：推进 stageIndex、追加 completedBeats、调整 targetEndRound、按需标记 completed/cancelled
- **触发**：并入决策模型每轮调用，零额外延迟
- **UI**：`AuthorArcPanel` 显示阶段进度（当前 stage / 已完成 beats），完整编辑放 Phase 2

## 6. Phase 2 · 可调试 UI

**执行人**：维护模型 + 提示词工程师配合。

| 改动 | 文件 |
|---|---|
| 主弧编辑器 | 新增 `AuthorMasterArcEditor.tsx` |
| 关系图编辑（拖动 / 改阶段 / 添加 NPC） | `CharacterPanel.tsx` 升级 |
| 时间线面板 + 编辑 | `TimelinePanel.tsx` 升级 |
| 伏笔面板编辑（新增 / 改 status / 删除） | `ForeshadowingPanel.tsx` 升级 |
| 导演计划完整查看 + 编辑（#8） | 新增 `DirectorPlanEditor.tsx` |
| 审校结果完整管理（#9） | 新增 `LogicReviewManager.tsx` |
| 事件弧完整编辑（#10） | `AuthorArcPanel.tsx` 升级 + 事件弧编辑模态 |
| "重大变化"待接受队列 | `GamePage.tsx` 顶部贴标 + `useGameStore` 队列状态 |

## 7. Phase 3 · 可定制与性能

| 改动 | 说明 |
|---|---|
| #5 模型链路提示词编辑器 | 已先在严格自定义 / 执笔模式编辑页加入 story/decision system/user 模板草稿与 `promptOverrideEnabled` 覆盖开关；完整 Settings 级全模型编辑器仍待做 |
| #6 各模型独立选模型 | `SettingsStore` 扩展：每个 agent 独立 `model / temperature / topP / maxTokens / retryEnabled` |
| #7 调度面板 | 新增「执笔调度」设置区：每个辅助 agent 独立 `everyRounds` + 启用开关 + 失败策略；预估每轮总耗时 |

## 8. Phase 4 · 边缘

| 改动 | 说明 |
|---|---|
| #11 书库 arc 编辑器 | 在 `LibraryPage` 增加 arc 专用编辑（stages / hiddenIntent / targetEndRound / 涉及人物 / 标签） |
| #12 旅程包导入预览 | 导入前预览内容、冲突处理、schema 版本提示、部分导入（仅书库 / 仅存档 / 仅提示词） |

## 9. 风险与配套设计

1. **prompt 长度爆炸**
   - Phase 1 完成后，故事模型 prompt 包含：主弧 + 导演计划 + 关系 + 时间线 + 场景连续性 + 伏笔 + 事件弧 + 审校建议 + 长期记忆 + 摘要 + 历史
   - 必须在 Phase 1 同步设计【块优先级 + 长度预算】机制，超预算时按优先级裁剪
   - 优先级建议：**当前回合焦点 > 主弧当前阶段 > 导演计划下一回合焦点 > 进行中事件弧当前阶段 > 关系状态（仅与本回合相关 NPC）> 时间线（最近 5 个 keyEvent）> 场景连续性（仅当前场景）> 伏笔状态（仅"可铺垫 / 适合回收"两类）> 审校 nextRoundWarnings > 长期记忆 > 摘要 > 历史**

2. **辅助模型失败兜底**
   - 辅助模型（关系 / 时间线 / 伏笔）失败时不阻塞故事模型
   - 沿用现有 logicCheck 的"失败保留旧状态 + 设置 lastError"策略
   - UI 在失败时显示一个不打扰的小提示，可手动重试

3. **重大变化确认 UX**
   - `GamePage` 顶部加"待接受变化"贴标，不打断阅读
   - 列表项含：变更类型、原值、新值、模型给的理由
   - 玩家可一次性"全部接受"或逐项处理

4. **上下文窗口压力**
   - Phase 0 实测时同步记录 prompt 长度趋势，作为 Phase 1 块优先级机制的依据
   - 长流程下需要更激进的摘要 + 历史滚动

## 10. 协作约定

| 工作类型 | 归属 |
|---|---|
| Phase 0 全部 | 提示词工程师 |
| Phase 1 中所有新 prompt | 提示词工程师 |
| Phase 1 中数据结构 / agent / store / GamePage 调度 | 维护模型 |
| Phase 1 中 UI 框架（新建组件文件、布局接入） | 维护模型 |
| Phase 1 中 UI 文案 / 交互细节打磨 | 提示词工程师 |
| Phase 2 UI | 双方配合 |
| Phase 3 提示词编辑器 UI | 提示词工程师为主 |
| Phase 3 模型 / 调度配置后端 | 维护模型 |
| Phase 4 | 维护模型为主 |

每个子项实施前由提示词工程师与玩家对齐 prompt 草稿；维护模型动手前确认接口（数据结构 + agent 输入输出协议）。

## 11. 进度跟踪

每完成一个子项，在表格里打勾；同步更新 `MEMORY.md` 与本文档。

| Phase | 子项 | 状态 |
|---|---|---|
| 0 | 通读现有 prompt + GamePage | ☑ 完成 |
| 0 | 现状缺陷清单 + 调优建议 | ☑ 完成（A/B/C/D 分类，见下文） |
| 0 | prompt 调优实施(优先级 1) | ☑ 完成（13 文件，构建通过，待用户手测） |
| 0 | 用户手测长流程（21 回合样本） | ☑ 完成（暴露设定违反 + details 爆表 + 审校 severity 偏低） |
| 0 | NPC.details 上限 + 淘汰（store 层） | ☑ 完成 |
| 0 | 审校 severity 判定标准 + 例子 | ☑ 完成 |
| 0 | prompt 调优实施(优先级 2) | ☐ 块优先级 / horizonRounds / 结局伏笔收束 |
| 0 | **prompt 输入长度治理 / 长流程稳定性** | ☐ 用户反馈：故事模型后期"越聊越糟"。需要：块优先级 + 长度预算、NPC 列表按"最近活跃"精简、记忆上限按长流程动态扩、已修复审校 issue 自动清空、历史滚动更激进 |
| 0 | **删除/编辑消息后模型仍携带被删记录（bug）** | ☑ 基础缓解完成：编辑 / 删除 / 重做消息时会失效 summary、longTermMemory、stageJudge、导演计划、设定守护补丁、逻辑审校等派生状态。完整回滚背包 / NPC / 场景 / 事件弧仍需未来 snapshot 机制 |
| 0 | 主弧生成模型补世界书输入 | ☑ 完成（用户测试发现主弧 stages 把"念头即变 / 灌入知识"擅自简化为"情绪驱动"——根因是主弧生成 prompt 未读 worldBook；已修） |
| 0 | prompt 调优实施(优先级 3) | 合并入 Phase 1.5 |
| **1.0** | **设定守护者**（已实现，规范见 `docs/setting-guard.md`） | ☑ 完成 |
| **1.0.5** | **阶段化叙事 + 玩家节奏感知**（覆盖原 1.1，规范见 `docs/stage-narrative.md`） | **☑ 基础闭环完成**（主弧生成 + stageJudge 调度 + 故事/守护/决策/导演/审校/随机事件注入；剩余"事件弧数据层彻底去回合化 / 主弧编辑器"放后续迭代） |
| 1.1 | 主弧（合并入 1.0.5，不再单独存在） | — |
| 1.2 | 关系分析 | ☐ |
| 1.3 | 时间线 / 场景连续性 | ☐ |
| 1.4 | 伏笔追踪 | ☐ |
| 1.5 | 事件弧进度更新（含 decision arcProgress） | ☐ |
| 2 | 可调试 UI | ☐ |
| 3 | 可定制与性能 | ☐ |
| 4 | 边缘 | ☐ |
