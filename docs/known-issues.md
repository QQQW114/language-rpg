# Known Issues & Watchlist

> 本文集中记录截至当前轮次发现的所有问题、已知风险与待办事项。按严重度 + 归属分类，方便维护模型 / 提示词工程师挑选下一轮要做什么。
>
> 本文应当与 `docs/execution-plan.md` 配合读：路线图（Phase 1.2-4）放执行计划；**当前阶段已发现的具体 bug / 风险 / 微优化**放本文。
>
> 严重度图例：🔴 急迫 / 🟡 重要 / 🟢 中等 / 🔵 路线图 / 🟣 工程文档

---

## 🔴 急迫（影响实际体验）

### I-1 删除 / 编辑消息后衍生状态不同步
- **报告**：用户测试时手动删除某轮消息或重做某轮后，下次模型调用（故事 / 决策 / stageJudge / settingGuard 等）的 `recent` / `latestStory` 等输入仍可能携带被删除的内容。`summary` / `longTermMemory` / `stageJudge.previous` / `settingGuard.patches` 等已固化的衍生状态**不会**因消息删除而自动失效。
- **症状**：构建期间出现"玩家没输入故事却一直推进"——疑似衍生状态污染导致下游模型把已删消息当作仍在生效。
- **归属**：维护模型（store 层）
- **建议修法**：
  - `useGameStore.deleteMessage / updateMessage / regenerateAssistantMessage` 改造时同步清理：
    - 若被删消息 round ≤ summarizedUntilIndex → 重置 `summary='' / summarizedUntilIndex=0`（强制下次重摘）
    - 若被删消息 round ≤ lastMemoryRound → 重置 `longTermMemory='' / lastMemoryRound=0`
    - 清空 `authorNarrative.stageJudge`（含 storyFocus）
    - 清空 `authorNarrative.settingGuard.patches / deviation`（保留 candidates）
    - 清空 `authorNarrative.logicReview`
  - 或更激进：删除消息时给玩家一个 confirm「会同步重置摘要 / 长期记忆 / 阶段判断 / 设定守护者状态，确认继续？」

### I-2 主弧旧存档不自动迁移
- **背景**：主弧生成 prompt 缺 worldBookEntries 输入是已修复的设计缺漏，但**老存档的 masterArc.stages 仍按旧 prompt 生成**——含错误描述（如把"主动施用"写成"情绪驱动"）。
- **现状**：玩家需要在 MasterArcPanel 手动点"重新生成主弧"——但这会丢失已 achieved 的 beats。
- **归属**：维护模型（数据迁移） + 提示词工程师（migration 提示）
- **建议修法**：
  - 持久化 merge 函数检测 masterArc.generationConfig 是否带"worldBook 已纳入"标记；若没有则 UI 上**显眼提醒**玩家："主弧产生于旧版本，建议重新生成以利用世界书设定"。
  - 或者：旧 masterArc 自动 fallback 到 `fallbackMasterArcFromOutline`，让 stage description 至少与世界书无冲突（但会丢失之前生成的诗意 title）。

### I-3 故事 prompt 长流程膨胀
- **报告**：用户实测故事模型后期"越聊越糟 / 略微胡言乱语"。
- **当前已缓解**：
  - NPC 列表取前 10 + 每个 details 5 条
  - anchors 单条 200 字截断
  - logicReview issues 数量收紧（critical 4 / warning 3 / info 2）
  - ambientBeats 按 playerPace 自适应（1/2/3）
  - 写作规范第 10 条加了块优先级（冲突时按 8 级取舍）
- **未做**：
  - **块级长度预算机制**：故事 prompt 总长度统计 + 超阈值时按优先级裁剪（NPC 列表 → 长期记忆 → 摘要 → 历史顺序）
  - **历史滚动更激进**：当前 maxHistoryRounds 默认 22，长流程下可降到 12-15
  - **长期记忆上限自适应**：当前 memoryMaxChars 默认 4000，长流程可扩到 6000-8000
- **归属**：提示词工程师 + 维护模型（store 长度统计）

### I-4 重新生成主弧用了 native `confirm()`
- **背景**：维护模型给主弧重生加了 `if (!confirm(...))` 警示，但与项目其他对话风格（暗色奇幻 / 古籍羊皮纸）不一致。
- **归属**：维护模型 / 前端
- **建议**：用项目自己的 Dialog 组件包一层。低优先级，但视觉违和。

---

## 🟡 重要（影响质量）

### I-5 守护者已修复的 deviation 不会自动清空
- **症状**：守护者第 N 回合标了 deviation 后，故事模型已修复，但 deviation 仍留在 settingGuard.deviation 字段，每回合注入故事 prompt 提示"⚠ 守护者发现的偏离风险"。直到玩家手动点"清除"或下次守护者输出新 deviation 才覆盖。
- **归属**：维护模型（agent 协议）
- **建议修法**：守护者下次跑时如果发现"原 deviation 已被故事修复"，输出 `clearDeviation: true` 字段，store 层清空。

### I-6 审校 issue 修复后无自动清空机制
- **症状**：审校第 N 回合标了 critical issue，故事模型在第 N+1 回合已自然修复，但 logicReview.issues 仍含原条目，下次故事 prompt 仍注入"必须修复"。
- **归属**：维护模型 + 提示词工程师
- **建议修法**：审校 prompt 在 user 端注入"上次的 issues 列表"，让审校自己判断哪些已被修复 → 输出 `resolvedIssueIds` 让 store 清掉。

### I-7 守护者 candidates 长流程下堆积
- **当前**：candidates accepted/rejected 后状态变更但不删除。长流程下数量可能 ≥30。
- **影响**：UI 上 SettingGuardPanel 只过滤 status='pending'，但 store 仍持有；旅程包导出时这些数据会一起导出。
- **归属**：维护模型
- **建议**：accepted 后 30 回合内自动从 candidates 移除（已沉淀到正式 worldBook 不需要保留候选记录）。

### I-8 候选词条 accept 后立即对故事下回合生效
- **流程**：玩家点"加入书库" → 调 acceptSettingCandidate → 写入 useContentStore 的"守护沉淀"worldBook → content.worldBookIds 加入 → 下次 runStory 计算 activeWorldBookEntries 时会命中。
- **风险**：如果 `keywords` 抽取得不准，可能在不该命中的回合命中。
- **归属**：提示词工程师
- **建议**：加重生成 candidate keywords 时的"避免过度宽泛"约束（如"不要把'男生'/'女生'之类基础词作为关键词"）。

### I-9 长期记忆字符上限固定
- **现状**：`memoryMaxChars = 4000`（设置默认），不区分故事长度。
- **症状**：长流程下记忆模型在 4000 字限制内压不下太多内容，可能丢承诺 / 关键细节。
- **归属**：维护模型（settings UI）
- **建议**：在设置页给一个"长流程自适应"开关——当 currentRound 超过 N 时自动扩到 6000-8000。

### I-10 NPC 列表精简只在故事 prompt 生效
- **现状**：故事 prompt 取前 10 个最近活跃 NPC；但 `CharacterPanel` 仍展示全部 NPC（玩家手动浏览用）。
- **OK**：这是合理设计——玩家想看时可以看全部。但要确认 storyAgent 输入的 npc 数组与 store 全量 npcs 不混淆。
- **归属**：已 OK，仅记录此设计意图。

### I-11 错误提示 toast 系统简陋
- **现状**：顶部红色丝带（agentNotice）3 秒自动消失。多个错误同时发生会被后者覆盖。
- **归属**：前端
- **建议**：低优先级。如果实测发生频繁错误堆积可以做 toast 队列，但当前足够用。

---

## 🟢 中等 / 待观察

### I-12 阶段切换金色丝带只在 currentStageIndex 变化时触发
- **现状**：通过 `useEffect` 监听 currentStageIndex 变化触发，stageJudge 自动推进 / 玩家手动标记完成都会触发。
- **风险**：如果重新生成主弧把 currentStageIndex 重置回 0，会误触发"已步入【觉醒】阶段"——这个目前不会发生（重生主弧 currentStageIndex 默认从 0 开始，prevStageIndexRef 会立即同步），但要复测。
- **归属**：前端

### I-13 候选词条数量上限存疑
- **现状**：`SettingGuardCandidate` 在 store 里 `slice(-24)`，超出会丢最旧的。但 normalizeSettingGuard 持久化加载时允许 30 条。
- **归属**：维护模型（store 一致性）
- **建议**：统一为 24 或 30，避免持久化与运行时数量不一致。

### I-14 stageJudge 失败时 storyFocus 沿用上次
- **现状**：失败时 `setStageJudgeError` 写错误，故事 prompt 中读到的 stageJudge 仍是上次的成功值。
- **风险**：如果连续多回合 stageJudge 失败，故事 prompt 会一直用最早的那次 storyFocus，与当前剧情不符。
- **归属**：提示词工程师 + 维护模型
- **建议**：连续 N 次失败后清空 stageJudge.storyFocus，让故事模型 fallback 到导演计划。或加错误计数器。

### I-15 manualInput placeholder 长度可能过长
- **现状**：placeholder 是"叙事导演本回合预期：…（你可以无视此预期，自由描述想做的事）"。
- **风险**：如果 storyFocus.thisRound 接近 140 字，placeholder 会很长，输入框感受拥挤。
- **归属**：前端
- **建议**：截断到 30 字 + 省略号（已做），但仍要观察。

### I-16 默认 memoryEveryRounds = 3 在长流程下偏密
- **现状**：每 3 回合跑一次记忆模型。长流程下记忆模型每次跑都接近全量 4000 字，cost 累积。
- **归属**：维护模型 / 提示词工程师
- **建议**：跟 I-9 配合，长流程下让 memoryEveryRounds 也自适应（如每 5-7 回合）。或让记忆模型自己判断"是否真有新事实需要更新"，没有就跳过。

### I-17 主弧 stages 数量稳定性
- **现状**：sanitizeMasterArc 当前要求 stages.length ≥ 2，否则返回 undefined → fallback。但模型偶尔给 1 个 stage 时直接走 fallback，丢失模型生成的诗意 title。
- **归属**：提示词工程师
- **建议**：先让 sanitize 在 stages.length < 3 时**重试一次**（用更低 temperature），实在不行再 fallback。

---

## 🔵 路线图待办（Phase 1.2+）

详见 `docs/execution-plan.md` 进度表。这里只列**已对齐方案的**：

| Phase | 子项 | 状态 |
|---|---|---|
| 1.2 | 关系分析模型（独立 agent，每 2 轮跑） | 未开始 |
| 1.3 | 时间线 / 场景连续性模型 | 未开始 |
| 1.4 | 伏笔追踪模型（自动识别 + 自动注入） | 未开始 |
| 1.5 | 事件弧进度更新（decision 输出 arcProgress + store 自动推进 stage） | 未开始 |
| 2.x | 主弧 / 关系图 / 时间线 / 伏笔的完整编辑器 UI | 未开始 |
| 2.x | 重大变化待接受队列（NPC 死亡 / 关系破裂 / 阶段跳转 / 伏笔废弃） | 未开始 |
| 3.x | 模型链路提示词编辑器（settings 暴露每个 system / user 模板） | 未开始 |
| 3.x | 各模型独立选模型 / 温度 / token / 重试 | 未开始 |
| 3.x | 调度面板（每个辅助模型独立 everyRounds + 启用开关 + 失败策略） | 未开始 |
| 4.x | 书库 arc 编辑器 / 旅程包导入预览 | 未开始 |

---

## 🟣 工程 / 文档

### I-18 dist 包大小接近 chunk size 警告
- **现状**：dist/index.js 666 kB（gzip 224 kB），Vite 警告 chunk size > 500 kB。
- **归属**：维护模型 / 工程
- **建议**：低优先级。生产部署若需要可做 dynamic import 拆分（react-markdown / lucide-react 是大头）。

### I-19 scripts/test-api.mjs 内置 API key
- **背景**：项目最初 review 时已发现的——`scripts/test-api.mjs` 含本地联调用的 API_BASE / API_KEY 常量。
- **归属**：维护模型 / 工程
- **建议**：改成从环境变量读取。`AGENTS.md` 已提到这点。

### I-20 prompt-list.md 与代码偏差
- **状态**：本轮已更新到 v2。后续若新增 agent 需同步维护此文档。
- **归属**：双方

### I-21 优先级 2/3 prompt 调优部分未完成
- **现状**：execution-plan.md Phase 0 进度表中"优先级 2: 块优先级 / horizonRounds / 结局伏笔收束"标 ☐。
- **归属**：提示词工程师
- **建议**：放在下一轮"prompt 输入长度治理"专项里一起做（horizonRounds 已经被阶段化叙事改动覆盖一部分；块优先级已部分实现；结局伏笔收束未做）。

### I-22 docs/setting-guard.md / stage-narrative.md 与现状对齐
- **状态**：两份文档对应 Phase 1.0 / 1.0.5 的设计意图，与代码现状基本一致。但 stage-narrative.md 第 4 节已加 4.2.1 说明主弧需 worldBook 输入。
- **后续维护**：每轮新做的辅助模型补一份相应实施文档。

---

## 协作建议

- **下一轮如果要做"prompt 输入长度治理"**：找提示词工程师，覆盖 I-3 + I-9 + I-16 + I-21。
- **下一轮如果要做"删除消息一致性"**：找维护模型，覆盖 I-1（最重要）+ I-5 + I-6。
- **下一轮如果要做 Phase 1.2 关系分析**：找维护模型主力 + 提示词工程师配合。
- **如果要发布**：先修 I-1（用户体验最影响）+ I-19（防止 key 泄露）。
