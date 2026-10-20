# 幕系统改造：决议记录与实施计划

> 来源：用户提案（自定义幕数 / 上·当前·下幕注入 / 阶段自动推进 / 强化随机事件）+ 外部模型回馈（`docs/temp/gemini-4-回馈1.txt`）+ Lead 修正 + 用户拍板。
> 目标：提高长篇故事创作上限（结构感 + 意外性），同时不违反 `docs/destiny-driven-story-core.md`（固定命运功能、路径自由、程序不做剧情警察）。

---

## 一、已拍板的决议

| # | 决议 | 内容 |
|---|---|---|
| D1 | 程序权威幕状态机 | `currentActId` 不再盲信模型；程序按"幕的终态 + 挂账规则"推进；模型乱报（未知/跳幕/倒退）忽略并写活动流警告 |
| D2 | 双轨推进 | 常规轨：本幕原生故事节全部 `satisfied`/`superseded` → 自动进下一幕。改道轨：未全终态时，模型显式提议 + 程序 gate（≥1 终态且终态比 ≥50%；非终态节全为 `reframed`/`weakened` 且有 `currentPlan`；非终态 ≤2 个）→ 挂账进下一幕 |
| D3 | 挂账不改归属 | `beat.actId` 永远保持原属幕、不可变；用 `carriedFromActId` 标记挂账来源、`actHistory` 记录幕进出。挂账节**不视为完成**，结局门槛不变（全部 `satisfied`/`superseded`） |
| D4 | 稳定上下文不动 | `【STABLE_STORY_CONTEXT】` 保持全量大纲 + 出身 + **常驻世界书**，逐字节稳定；三幕窗口作为 `【STAGE_AND_ACT_WINDOW】` 放进**可变区**，用读写权限指令聚焦（上一幕只读因果、当前幕开放施工、下一幕只许埋伏笔、远期幕禁止兑现） |
| D5 | 世界书拆分 | 常驻（alwaysActive）条目进稳定块；关键词命中条目进可变区 `【DYNAMIC_WORLD_FACTS】`。修复当前"稳定块会随关键词命中变化"的缓存隐患 |
| D6 | 新阶段提示词 | 作者可选字段 `entryBrief`（≤200字）/`stageContract`（≤200字）/`exitCriteriaNote`（≤120字），程序在切幕后 1~2 回合原样注入；文学转化由 planner_pre 负责，程序不生成描写 |
| D7 | 随机事件强化 | `history[]`（上限 8，优先保留 `ongoing_hook`）+ `targetKind/targetId` 绑定（beat/thread/relationship/reconvergence）+ 三态 resolution（resolved/ongoing_hook/interrupted）+ 智能强度 + 切幕冷却联动；不引入事件库/事件 Agent |
| D8 | 篇幅与收尾 | `beatsThisTurn`（1~3 条；慢叙事只取第 1 条）+ 防幕级收尾红线；收尾检测**先走程序侧确定性检测**（升华模式/时间跳跃词/长度），只做"下轮软纠偏"，不回滚或重写正文；`planner_post` 暂不加 `paceAudit` 字段（它已占 57% 输出） |
| D9 | 极简协议 | 新增结算字段一律 ID/枚举/布尔，禁止要求 planner_post 写长篇分析；`actExitSummary` 仅 ≤150 字，缺省用当轮 `roundSummary` |
| D10 | 预设内容 | 内置《错位青春》按外部回馈的 **5 幕示例**改造（含幕级字段），并同步世界书中"第三幕"等幕序引用；旧存档不受影响（存档持有自己的 outline 副本） |

---

## 二、数据模型增量

```ts
// 内容层（src/types/content.ts）
interface StoryAct {
  // 现有：id/title/purpose/beats
  entryBrief?: string;      // ≤200，开幕引子
  stageContract?: string;   // ≤200，本幕写作契约/禁令
  exitCriteriaNote?: string;// ≤120，幕完成叙事标志
}

// 运行时（src/v2/types.ts）
interface StoryBeatRuntimeV2 {
  // 现有字段...
  actId: string;                  // 必填，hydrate 反查补齐；不可变
  carriedFromActId?: string;      // 因改道跨幕挂账时的原属幕
}
interface DestinyActHistoryEntryV2 {
  actId: string;
  enteredTurn: number;
  exitedTurn?: number;
  exitSummary?: string;           // ≤150，优先模型 actExitSummary，否则 roundSummary
  carriedBeatIds?: string[];
}
interface DestinyProgressV2 {
  // 现有字段...
  currentActIndex: number;
  actHistory: DestinyActHistoryEntryV2[];
  lastActTransitionTurn?: number;
}
interface TurnPatchV2['destiny'] {
  // 现有字段...
  actTransition?: { proposeNextAct?: boolean; actExitSummary?: string };
}
```

随机事件增量：

```ts
type RandomEventTargetKindV2 = 'beat' | 'thread' | 'relationship' | 'reconvergence';
interface RandomEventHistoryItemV2 {
  id: string; turn: number;
  intensity: 'related' | 'progress' | 'destiny';
  targetKind: RandomEventTargetKindV2; targetId: string;
  summary: string;        // 写前，≤80
  outcomeNote?: string;   // 写后，≤100
  status: 'resolved' | 'ongoing_hook' | 'interrupted';
}
interface RandomEventStateV2 {
  // 现有字段...
  activeBinding?: { targetKind: RandomEventTargetKindV2; targetId: string; summary: string; plannedAtTurn: number };
  history: RandomEventHistoryItemV2[]; // ≤8，优先保留 ongoing_hook
}
```

---

## 三、实施步骤与依赖

| 步骤 | 内容 | 依赖 | 状态 |
|---|---|---|---|
| **P1** | 幕状态机底座：types/patch/store 迁移与推进逻辑、测试 | 无 | 队友实施中（task-4） |
| **P2** | 工坊幕级字段：类型/内容库校验/工坊编辑器/测试 | 无 | 队友实施中（task-5） |
| **P2.5** | 《错位青春》5 幕改造 + 世界书幕序同步 | P2 | Lead 实施（等类型落地） |
| **P3** | 窗口注入与提示词：`【STAGE_AND_ACT_WINDOW】`、`beatsThisTurn`、防收尾红线、世界书稳定/动态拆分、snapshot 暴露幕状态 | P1/P2 | 待开始 |
| **P4** | 随机事件强化：history/绑定/三态/智能强度/切幕冷却 | P3 | 待开始 |
| **P5** | 观测与纠偏：程序侧收尾检测、下轮软纠偏、命运卡"幕 N/M + 挂账节"、活动流警告 | P3/P4 | 待开始 |
| **P6** | 文档与验收：CHANGELOG/PROJECT_STATUS/本文件同步、全量测试、真实长局（需用户 Key） | P5 | 待开始 |

每次改动遵循 `AGENTS.md`：`cmd /c npm run build` + `npm test` + 相关 `test:*`；协议改动四处同步（engine/types/patch/UI）。

---

## 四、验收口径

### 离线（必须）

- P1：新增 patch/store 用例覆盖自动切幕、挂账 gate 全部分支、非法 currentActId 拦截、旧档迁移、挂账不放宽 ending。
- P3：断言同一幕内 `system` 与 `【STABLE_STORY_CONTEXT】` 字节不变（含常驻世界书）；断言切幕回合窗口切换且含 `entryBrief`；断言 `beatsThisTurn` 按叙事速度裁剪。
- P4：断言 history 上限与 `ongoing_hook` 保留、未兑现顺延不丢绑定、切幕冷却调整。
- 全量：338 条现有测试不得回归；`test:patch`、`test:e2e`（含缓存前缀结构断言）全绿。

### 真实长局（需用户 API Key，20+ 回合 A/B）

| 指标 | 基线 | 目标 |
|---|---|---|
| 升华式收尾比例（尾 220 字模式检测） | 6,000 字以上档位 14% | ≤3% |
| >6,000 字回合占比 | 24% | <10% |
| >2,500 字回合占比 | 79.3% | 观察下降趋势 |
| 单轮时间跨度（≥3 个时间推进词的回合） | 有 | 明显减少 |
| 幕切换稳定性 | 无概念 | 20 回合内 currentActId 零跳变/零乱码 |
| 随机事件回收率 | 事件失忆 | 10 回合内至少 1 次 ongoing_hook 被后续回收 |
| 缓存命中率 | 56.9%（最小存档口径） | 不下降（目标：稳定块真正逐字节不变） |
| 成本 | 输出占 82% | 不出现无解释上涨 |

---

## 五、风险与回滚

- **缓存**：稳定块不动（D4）+ 世界书拆分（D5）；若前缀测试失败，回滚 D5（把动态世界书放回稳定块）。
- **幕卡死**：挂账出口 + 兜底（玩家极端路线导致连挂账都不满足时，保持当前幕并只发警告，不自动跳；后续可评估"幕内超时提示"）。
- **程式化**：提示词三道红线（不得为凑节拍瞬移 NPC/强凑冲突；幕切状态不切镜头；随机事件只给契机不替玩家决定）+ UI 非阻断警告（强线性词）。
- **planner_post 膨胀**：D9 极简协议；如输出仍涨，回退 `actTransition.actExitSummary`（用 roundSummary 即可）。
- **兼容**：旧存档 hydrate 自动补 actId/纠正 currentActId；旧故事无幕级字段退化为现有行为；旧存档 outline 副本不变，不受预设 5 幕改造影响。

---

## 六、开放问题（后续用真实数据决定）

1. 幕内超时提示（玩家长期停留一幕是否提示，而非强制推进）？
2. `paceAudit` 模型自审是否值得加（看程序侧检测的漏报率）？
3. `patchStats` 是否应增加"幕推进被拒"计数（目前只发警告）？
4. 是否需要"幕级改道合并"（两个节合并为一个）——涉及结局门槛，暂不做。
