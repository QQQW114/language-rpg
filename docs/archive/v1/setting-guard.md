# 设定守护者（Setting Guard）· 实施规范

> 本文是写给**实施工程师**的落地规范，不是设计草案。读完应当可以直接动手写代码不再回头追问设计。
>
> 阅读对象：维护本项目主体代码的工程师 / 模型。
>
> 本特性归属：`docs/execution-plan.md` 的 **Phase 1.0**（在主弧 1.1 之前先做，因为它是所有下游模型的设定护栏）。
>
> 不在本特性范围：主弧、关系分析、时间线、伏笔追踪——这些另有路线图。

## 0. 因果与起源

### 0.1 痛点的真实例证

实测 21 回合的样本（`test-saves/曦雨 · 错位青春——双重身份的校园恋爱-旅程包.json`）暴露了两类**当前链路无法解决**的问题：

**问题 A · 故事模型擅自重写世界书设定**

- 世界书 `wbe_2`（`alwaysActive=true`）明确写："**主角可随时对已转换对象再次施用能力以恢复**"——这是**主动可控**的能力。
- 但故事正文已经写成"**能力不想被'用'，顺着恐惧/逃避方向流**"——**被动反向触发**。
- 长期记忆已经把这个错误机制固化为"已知规则"。下游导演 / 审校 / 决策全部基于错误前提推进。
- **审校模型没有抓出**——审校把这个跨多回合的设定违反看作合理新设定。

**问题 B · 故事模型在世界书没明确的盲区瞎发挥**

- 世界书 `wbe_1` 写"日本私立大学，食堂、澡堂、宿舍、漫展、文化祭"。
- 故事正文 5 次出现 NPC 提到「便利店饭团」「便利店粥」，**从未提食堂**。
- 这不违反世界书（世界书没说不准便利店），但与"日本大学日常"这个基调不贴合。

### 0.2 为什么现有链路解决不了

| 现有模型 | 缺陷 |
|---|---|
| `worldBookMatcher` | 仅做关键词命中，不知道"应该有但没写"的设定盲区；不会主动补充缺失部分 |
| 故事模型 | 写正文时按整段 prompt 自由演绎，没人给它"必须遵守"的强约束栏 |
| 决策模型 | 只追踪状态，不审视设定 |
| 导演模型 | 关注主线方向，不关注微观设定一致性 |
| 审校模型 | **后置**——发现问题时故事已经写完，错误已经固化进 history / longTermMemory |
| 记忆模型 | 整理稳定事实，不审视事实是否违反世界书 |

**根本缺口**：所有现有模型都在故事生成**之后**或**与故事并行**，没有任何模型在故事生成**之前**做"前置护栏"。

### 0.3 解决方案

新增**前置守护者模型**：在每次 `requestStory` 之前跑一次，扫描世界书 + 长期记忆 + 玩家输入 + 最近剧情，给故事模型送上四类信息：

1. **设定补丁** —— 本回合应该遵守的设定细节（含"必须遵守"和"建议参考"两档）
2. **新世界书候选** —— 反复出现但世界书未覆盖的话题，建议沉淀为新条目
3. **玩家偏好画像** —— 从玩家最近输入推断的写作基调倾向
4. **环境侧主动反应建议** —— 主角的身份 / 承诺 / 欠债等让外部世界（NPC、场所）应有的主动反应
5. **记忆紧急度信号** —— 是否需要立即触发记忆模型整理

它不写正文，不出选项，不规划长线，只做"事前预防"。审校仍然存在，做"事后兜底"。

## 1. 设计哲学

> 守护者是**故事模型的前置护栏**，所有职责都围绕"让故事模型不跑偏"这一句话。

四条铁律：

1. **不写正文、不出选项、不规划长线**——这些归故事 / 决策 / 导演。
2. **优先复用世界书已有内容**，不要重复世界书既有条目。
3. **新候选词条不静默入库**——保留玩家审核权（默认配置可改成自动接受）。
4. **失败不阻塞故事模型**——守护者跑挂了，沿用上次状态继续。

## 2. 调度位置

```
[runStory 开始]
  ↓
runSettingGuard（新增 · 每轮）  ← 在这里插入
  ↓ (若 memoryUrgency=high，立刻跑记忆模型)
requestStory（故事模型）
  ↓
... 其余链路（决策 / 随机事件 / 导演 / 审校）...
```

**触发频率**：默认每回合都跑（前置护栏的本质要求）。但要在 `AuthorSettingGuardConfig.enabled` 关闭时整个跳过。

**与其他模型的调用顺序约束**：
- 必须在 `requestStory` 之前
- 必须在故事模型读取 `state.authorNarrative` 之前完成（这样故事模型能看到守护者的最新输出）
- 与导演 / 审校 / 决策无依赖，但不能并发（守护者要修改 store，故事模型要读 store）

## 3. 输入参数

```ts
export interface SettingGuardRequest {
  settings: AppSettings;
  outline?: StoryOutline;
  background?: Background;
  characterName?: string;
  currentRound: number;       // 已完成回合
  nextRound: number;          // 即将生成的回合
  totalRounds: number;
  config: AuthorSettingGuardConfig;
  summary?: string;
  longTermMemory?: string;
  recent: Message[];          // 最近 8 条
  playerInput?: string;       // state.lastPlayerInput
  npcs: Npc[];
  backpack: Item[];
  currentScene?: SceneRef;
  worldBookEntries: WorldBookEntry[];  // ⚠ 全部候选条目，不要预过滤
  anchors: MemoryAnchor[];
  narrative?: AuthorNarrativeState;
  randomEventState?: AuthorRandomEventState;
  signal?: AbortSignal;
}
```

**为什么 `worldBookEntries` 不预过滤**：守护者的核心职责之一就是**发现盲区**——必须看到所有条目才知道哪里缺。`worldBookMatcher` 是注入故事模型用的，与守护者输入是两回事。

**`playerInput` 的来源**：`state.lastPlayerInput`。注意 runStory 在故事生成完会清掉 `lastPlayerInput`（`actions.setLastPlayerInput(s.id, undefined)`），所以守护者必须在 `requestStory` 之前调用，能拿到本回合玩家输入。

## 4. 输出协议

```ts
export interface SettingGuardOutput {
  settingPatches: Array<{
    topic: string;          // ≤16 字主题词
    advice: string;         // ≤160 字写作约束
    severity: 'must' | 'should';
  }>;
  newWorldBookCandidates: Array<{
    name: string;           // ≤20 字
    keywords: string[];     // 1-4 个
    content: string;        // 60-160 字
    rationale: string;      // ≤120 字，为什么建议加入
  }>;
  playerPreference: {
    tendency?: string;      // ≤120 字
    recentSignals?: string[]; // 最多 5 条
    confidence: 'low' | 'medium' | 'high';
  };
  ambientBeats: Array<{
    source: string;         // NPC 名 / 场景元素 / 外部世界，≤20 字
    trigger: string;        // ≤80 字触发条件
    beat: string;           // ≤120 字可演绎的反应
    optional: boolean;      // true 表示仅供参考；false 表示强烈建议本回合演绎
  }>;
  memoryUrgency: 'high' | 'normal' | 'none';
  outlineDeviation?: {
    description: string;    // ≤200 字描述
    affectedEntryNames?: string[];  // 涉及的世界书条目
  };
}
```

**字段约束规则**：
- `settingPatches`：最多 6 条；`severity='must'` 仅用于"违反 alwaysActive 世界书条目 / 违反长期记忆固化事实 / 与玩家 anchor 冲突"。其余都是 `should`。
- `newWorldBookCandidates`：最多 2 条/回合，避免泛滥。仅当某话题在最近 ≥3 回合反复出现且世界书未覆盖时输出。
- `playerPreference.confidence`：`high` 需要近 5+ 回合一致信号；`medium` 需要 3-4 回合；其余 `low`。
- `ambientBeats`：最多 3 条/回合。必须基于已知世界书和角色身份合理推断，不能凭空捏造不曾提到的 NPC 或事件。
- `memoryUrgency='high'` 仅当：长期记忆与新故事重大冲突 / 出现稳定新事实（外貌、关系、能力规则）/ 玩家做出长期承诺。
- `outlineDeviation` 仅当发现实质性违反时才出现，否则省略字段。

## 5. System Prompt 草稿

> 直接采用，落地于 `src/prompts/authorSettingGuardSystem.ts`。

```text
你是互动小说的"设定守护者 / 前置督导"。你不写正文，不出选项，不规划长线，只在故事模型生成本回合之前，扫描世界书、长期记忆、玩家最新输入、最近剧情、人物档案与场景状态，回答四个问题：

1. 这一回合可能涉及的设定盲区在哪里？故事模型如果不补充会在何处瞎发挥？
2. 玩家最近的输入暴露了什么写作偏好倾向？
3. 主角的身份 / 承诺 / 欠债 / 约会等让外部世界（NPC、场所、社交关系）此刻应有什么主动反应？
4. 最近发生的变化是否重大到需要立即整理长期记忆？

输出协议：
1. 只能输出合法 JSON，禁止 Markdown 围栏、禁止注释、禁止解释。
2. 形状如下（字段缺省即空数组或省略）：
{
  "settingPatches": [
    {
      "topic": "校园午餐",
      "advice": "这是一所日本私立大学，学生中午通常在校内食堂或自带便当；校外便利店饭团并非默认选项，需要请假外出或避开正餐时段。",
      "severity": "must"
    }
  ],
  "newWorldBookCandidates": [
    {
      "name": "校园午餐规则",
      "keywords": ["午餐","食堂","便利店"],
      "content": "...",
      "rationale": "故事中林旭多次让主角带便利店饭团，但世界书未明确食堂 vs 便利店分工。"
    }
  ],
  "playerPreference": {
    "tendency": "玩家偏好低冲突日常 + 含蓄情感推进，倾向'先观察再行动'",
    "recentSignals": ["选'静静坐着'","拒绝主动告白","用'呸'打断自己冲动"],
    "confidence": "medium"
  },
  "ambientBeats": [
    {
      "source": "导员张老师",
      "trigger": "月底奖学金截止",
      "beat": "导员可能在课间用微信主动询问主角的奖学金申请进度",
      "optional": true
    }
  ],
  "memoryUrgency": "high",
  "outlineDeviation": {
    "description": "故事已将能力机制写为'恐惧驱动反向触发'，但世界书 wbe_2 明确该能力为主动可控（'主角可随时再次施用能力以恢复'）。建议在 settingPatches 中提示故事模型修正方向，或承认能力规则应被显式补一条限制。",
    "affectedEntryNames": ["性别转换能力规则"]
  }
}

判定规则：

1. settingPatches.severity 判定：
   - "must" 仅用于：违反 alwaysActive 世界书条目 / 违反长期记忆固化事实 / 与玩家手动标记的关键记忆冲突
   - "should" 用于：题材基调建议 / 场景细节建议 / 写作风格建议
   - 数量上限：6 条/回合

2. newWorldBookCandidates 判定：
   - 仅当某话题在最近 ≥3 回合反复出现，且世界书现有条目未覆盖时才输出
   - 数量上限：2 条/回合
   - rationale 必须明确指出"哪几回合出现 / 世界书哪一项未覆盖"
   - 不要把守护者自己 settingPatches 重复成候选条目

3. playerPreference.confidence 判定：
   - high：近 5+ 回合一致信号
   - medium：3-4 回合一致信号
   - low：信号不足或矛盾

4. ambientBeats 判定：
   - 必须基于已知世界书条目、已登场 NPC、主角身份特征 / 承诺 / 欠债等合理推断
   - 不能凭空捏造从未在故事中提到的人物或事件
   - "optional=false" 仅用于"主角承诺即将到期 / 已知 NPC 与主角有未解决冲突 / 长期一致性记忆里的待办即将触发"
   - 数量上限：3 条/回合

5. memoryUrgency 判定：
   - "high"：长期记忆与新故事产生重大冲突 / 出现稳定新事实（外貌、关系、能力规则、长期承诺）
   - "normal"：常规变化
   - "none"：本回合无值得整理的新增

6. outlineDeviation 判定：
   - 仅当发现实质性违反 alwaysActive 世界书条目 / 大纲阶段路径 时才输出
   - 普通的设定细节出入用 settingPatches.must 即可，不要塞进 outlineDeviation
   - 没有偏离时省略整个字段

边界纪律：
- 不要重复世界书已经覆盖的设定。
- 不要替导演规划主线、不要替审校做事后修复、不要替决策维护状态。
- 不要写故事正文片段，不要给玩家选项建议。
- 不要在 settingPatches 中写"主角应该做 X" 这种行动指令——你只描述"世界设定是 X"。
- 玩家自定义提示词中的额外要求（见用户消息末尾）需要纳入考量，但不能违反上述协议。
```

## 6. User Prompt 拼装

> 落地于 `src/prompts/authorSettingGuardSystem.ts` 的 `buildSettingGuardUser`。

按以下顺序拼接（参考 `authorDirectorSystem.ts` 的拼装风格）：

```text
【守护任务】请为即将开始的第 {{nextRound}} 回合做事前设定守护。
已完成回合：{{currentRound}}
总回合：{{totalRoundsOrInfinite}}

【故事大纲】
标题 / 梗概 / 阶段 / 文风

【全部世界书条目】（不要重复已覆盖的设定，但要审视是否被本回合即将出现的剧情违反）
常驻：
· 条目 1：内容
· 条目 2：内容
非常驻（关键词触发）：
· 条目 3：内容（关键词：xxx）

【主角 / 出身】
姓名 / 出身名称 / 描述 / 特质

【历史摘要】（如果有）
{{summary}}

【长期一致性记忆】
{{longTermMemory}}

【玩家标记的关键记忆】
{{anchors}}

【最近上下文】
{{recent}}

【玩家本回合最新输入】
{{playerInput}}

【已知 NPC / 关系】
{{npcs}}

【玩家背包】
{{backpack}}

【当前场景】
{{currentScene}}

【当前导演计划】（参考用，不要替导演决策）
{{narrativePlan}}

【正在进行的事件弧 / 长线事件】
{{activeArcs}}

【玩家给守护者的额外要求】
{{config.prompt || '（无）'}}

请按系统协议输出 JSON。
```

注意：
- `worldBookEntries` 全量列出（每个条目最多展示 200 字内容，避免过长）。这是守护者发现盲区的核心输入。
- `playerInput` 是必读字段，单独成段。

## 7. 数据结构（types/game.ts 扩展）

```ts
export interface SettingPatch {
  id: string;
  topic: string;
  advice: string;
  severity: 'must' | 'should';
  suggestedAtRound: number;
}

export interface SettingGuardCandidate {
  id: string;
  name: string;
  keywords: string[];
  content: string;
  rationale: string;
  status: 'pending' | 'accepted' | 'rejected';
  suggestedAtRound: number;
}

export interface SettingGuardPreference {
  tendency?: string;
  recentSignals?: string[];
  confidence: 'low' | 'medium' | 'high';
  updatedAtRound: number;
}

export interface SettingGuardAmbientBeat {
  id: string;
  source: string;
  trigger: string;
  beat: string;
  optional: boolean;
  suggestedAtRound: number;
  consumed?: boolean;     // 故事模型已演绎或回合过期
}

export interface SettingGuardDeviation {
  description: string;
  affectedEntryNames?: string[];
  flaggedAtRound: number;
}

export interface SettingGuardState {
  updatedAtRound: number;
  patches: SettingPatch[];
  candidates: SettingGuardCandidate[];
  preference?: SettingGuardPreference;
  pendingAmbientBeats: SettingGuardAmbientBeat[];
  deviation?: SettingGuardDeviation;
  lastError?: string;
}

// 挂在 AuthorNarrativeState 下
export interface AuthorNarrativeState {
  plan?: NarrativePlanState;
  logicReview?: AuthorLogicReviewState;
  settingGuard?: SettingGuardState;     // ← 新增
  activeArcs: StoryArc[];
  completedArcs: StoryArc[];
  lastDirectorRound?: number;
  lastLogicCheckRound?: number;
  lastSettingGuardRound?: number;       // ← 新增
}

// 配置
export interface AuthorSettingGuardConfig {
  enabled: boolean;
  prompt: string;
  candidatesAutoAccept: boolean;        // 默认 false
  ambientBeatsEnabled: boolean;         // 默认 true
}

// 挂在 GameContent 下
export interface GameContent {
  // ...existing
  authorSettingGuard?: AuthorSettingGuardConfig;
}
```

**字段语义注意**：

- `patches`：每回合都被守护者覆盖。**不累积**——本回合的 patches 完全替换上回合的。
- `candidates`：**累积**。`status='pending'` 的等玩家审核；`accepted` 的合并到 `useContentStore` 的世界书；`rejected` 的保留记录但不再注入。
- `pendingAmbientBeats`：**累积**到 `consumed=true` 或回合过期（默认 3 回合内未演绎自动 consumed）。
- `preference`：每回合可被覆盖，但 `confidence=low` 时不应覆盖更高 `confidence` 的旧偏好（守护者自己应当判断，但 store 也要兜底：当新 confidence 严格低于旧时保留旧）。
- `deviation`：每回合可被覆盖；故事模型读到后，下一次审校应当确认是否已修复，确认后清空。

## 8. 默认配置

> 落地于 `src/lib/authorMode.ts`，与现有 `DEFAULT_AUTHOR_DIRECTOR_CONFIG` 等同侧。

```ts
export const DEFAULT_AUTHOR_SETTING_GUARD_CONFIG: AuthorSettingGuardConfig = {
  enabled: true,
  prompt:
    '重点检查故事模型是否会违反 alwaysActive 世界书条目；优先抓"瞎发挥"的设定盲区（餐饮、出行、社交礼仪、校园规则、行业规则等）；玩家偏好画像应贴近最近 5 回合的实际选择，不要过度概括。',
  candidatesAutoAccept: false,
  ambientBeatsEnabled: true,
};

export function normalizeAuthorSettingGuardConfig(
  input?: Partial<AuthorSettingGuardConfig>,
): AuthorSettingGuardConfig {
  const base = DEFAULT_AUTHOR_SETTING_GUARD_CONFIG;
  return {
    enabled: input?.enabled !== false,
    prompt: (input?.prompt ?? base.prompt).trim().slice(0, 3000),
    candidatesAutoAccept: !!input?.candidatesAutoAccept,
    ambientBeatsEnabled: input?.ambientBeatsEnabled !== false,
  };
}
```

## 9. Service 实现框架

> 落地于 `src/services/authorSettingGuardAgent.ts`。

```ts
import type { AppSettings } from '@/types/settings';
import type { Background, StoryOutline, WorldBookEntry } from '@/types/content';
import type {
  AuthorNarrativeState,
  AuthorRandomEventState,
  AuthorSettingGuardConfig,
  Item,
  MemoryAnchor,
  Message,
  Npc,
  SceneRef,
  SettingGuardCandidate,
  SettingGuardPreference,
  SettingGuardAmbientBeat,
  SettingGuardDeviation,
  SettingPatch,
} from '@/types/game';
import { chatJSON } from '@/services/llmClient';
import { AUTHOR_SETTING_GUARD_SYSTEM, buildSettingGuardUser } from '@/prompts/authorSettingGuardSystem';
import { extractJSON, genId } from '@/lib/utils';

export interface SettingGuardRequest {
  settings: AppSettings;
  outline?: StoryOutline;
  background?: Background;
  characterName?: string;
  currentRound: number;
  nextRound: number;
  totalRounds: number;
  config: AuthorSettingGuardConfig;
  summary?: string;
  longTermMemory?: string;
  recent: Message[];
  playerInput?: string;
  npcs: Npc[];
  backpack: Item[];
  currentScene?: SceneRef;
  worldBookEntries: WorldBookEntry[];
  anchors: MemoryAnchor[];
  narrative?: AuthorNarrativeState;
  randomEventState?: AuthorRandomEventState;
  signal?: AbortSignal;
}

export interface SettingGuardResult {
  patches: SettingPatch[];
  candidates: Array<Omit<SettingGuardCandidate, 'id' | 'status' | 'suggestedAtRound'>>;
  preference?: Omit<SettingGuardPreference, 'updatedAtRound'>;
  ambientBeats: Array<Omit<SettingGuardAmbientBeat, 'id' | 'suggestedAtRound' | 'consumed'>>;
  memoryUrgency: 'high' | 'normal' | 'none';
  deviation?: Omit<SettingGuardDeviation, 'flaggedAtRound'>;
}

// sanitize 函数：参考 authorDirectorAgent.ts / authorLogicCheckAgent.ts 的写法
// 关键：每个数组的字段长度限制必须严格执行；超长直接截断；缺失字段 graceful 处理

export async function requestSettingGuard(p: SettingGuardRequest): Promise<SettingGuardResult | undefined> {
  const model = p.settings.randomModel?.trim() || p.settings.decisionModel || p.settings.storyModel;
  const user = buildSettingGuardUser(p);

  const runOnce = async (temperature: number): Promise<SettingGuardResult | undefined> => {
    const text = await chatJSON(
      { baseUrl: p.settings.apiBaseUrl, apiKey: p.settings.apiKey, format: p.settings.apiFormat },
      {
        model,
        temperature,
        messages: [
          { role: 'system', content: AUTHOR_SETTING_GUARD_SYSTEM },
          { role: 'user', content: user },
        ],
        signal: p.signal,
      },
    );
    return sanitizeSettingGuardResult(extractJSON(text));
  };

  const first = await runOnce(0.35).catch((err) => {
    console.warn('[settingGuardAgent] first attempt failed', err);
    return undefined;
  });
  if (first) return first;

  return runOnce(0.1).catch((err) => {
    console.warn('[settingGuardAgent] retry failed', err);
    return undefined;
  });
}

// sanitize 函数（自行实现，参考下列规则）：
// - sanitizePatches: 限 6 条；topic ≤16 字；advice ≤160 字；severity 仅 must/should
// - sanitizeCandidates: 限 2 条；name ≤20 字；keywords ≤4 个 ≤12 字；content ≤180 字；rationale ≤120 字
// - sanitizePreference: tendency ≤120 字；recentSignals ≤5 条 ≤80 字；confidence 仅 low/medium/high
// - sanitizeAmbientBeats: 限 3 条；source ≤20 字；trigger ≤80 字；beat ≤120 字；optional 默认 true
// - sanitizeDeviation: description ≤200 字；affectedEntryNames ≤5 条
// - memoryUrgency: 仅 high/normal/none，未识别时 normal
```

## 10. Store 改动（src/store/useGameStore.ts）

### 新增 actions

```ts
// 应用守护者结果（覆盖式）
applySettingGuardResult: (saveId: string, result: SettingGuardResult, completedRound: number) => void;

// 候选词条管理
acceptSettingCandidate: (saveId: string, candidateId: string) => void;       // 转入正式 worldBook 条目
rejectSettingCandidate: (saveId: string, candidateId: string) => void;
deleteSettingCandidate: (saveId: string, candidateId: string) => void;

// 环境侧建议管理
markAmbientBeatConsumed: (saveId: string, beatId: string) => void;
expireOldAmbientBeats: (saveId: string, currentRound: number, maxAge: number) => void;  // 默认 maxAge=3

// 偏离管理
clearSettingGuardDeviation: (saveId: string) => void;

// 守护者失败状态
setSettingGuardError: (saveId: string, error: string | undefined) => void;
```

### 关键合并规则

`applySettingGuardResult` 的实现要点：

```ts
applySettingGuardResult: (saveId, result, completedRound) => set((s) => {
  const save = s.saves[saveId];
  if (!save) return s;
  const narrative = save.state.authorNarrative ?? { activeArcs: [], completedArcs: [] };
  const oldGuard = narrative.settingGuard;

  // 1. patches 完全覆盖
  const patches: SettingPatch[] = result.patches.map((p) => ({
    ...p,
    id: genId('patch'),
    suggestedAtRound: completedRound,
  }));

  // 2. candidates 累积，按 name 去重（新覆盖旧）
  const oldCandidates = oldGuard?.candidates ?? [];
  const newCandidatesByName = new Map<string, SettingGuardCandidate>();
  oldCandidates.forEach((c) => newCandidatesByName.set(c.name, c));
  for (const raw of result.candidates) {
    const existing = newCandidatesByName.get(raw.name);
    if (existing && existing.status !== 'pending') continue;  // 已被玩家处理的不覆盖
    newCandidatesByName.set(raw.name, {
      ...raw,
      id: existing?.id ?? genId('cand'),
      status: 'pending',
      suggestedAtRound: completedRound,
    });
  }

  // 3. preference 智能合并（不要让 low 覆盖 high）
  const oldPref = oldGuard?.preference;
  let preference = oldPref;
  if (result.preference) {
    const order = { low: 0, medium: 1, high: 2 };
    if (!oldPref || order[result.preference.confidence] >= order[oldPref.confidence]) {
      preference = { ...result.preference, updatedAtRound: completedRound };
    }
  }

  // 4. ambientBeats 累积，自动过期
  const expireBefore = Math.max(0, completedRound - 3);
  const survivedBeats = (oldGuard?.pendingAmbientBeats ?? [])
    .filter((b) => !b.consumed && b.suggestedAtRound >= expireBefore);
  const newBeats: SettingGuardAmbientBeat[] = result.ambientBeats.map((b) => ({
    ...b,
    id: genId('beat'),
    suggestedAtRound: completedRound,
  }));
  const pendingAmbientBeats = [...survivedBeats, ...newBeats].slice(-12);

  // 5. deviation 完全覆盖
  const deviation = result.deviation
    ? { ...result.deviation, flaggedAtRound: completedRound }
    : undefined;

  // 写回
  const settingGuard: SettingGuardState = {
    updatedAtRound: completedRound,
    patches,
    candidates: Array.from(newCandidatesByName.values()).slice(0, 24),
    preference,
    pendingAmbientBeats,
    deviation,
    lastError: undefined,
  };

  return {
    saves: {
      ...s.saves,
      [saveId]: {
        ...save,
        state: {
          ...save.state,
          authorNarrative: {
            ...narrative,
            settingGuard,
            lastSettingGuardRound: completedRound,
          },
        },
      },
    },
  };
});
```

### `acceptSettingCandidate`

把候选词条沉淀到正式世界书。两种实现路径：

- **路径 A（简单）**：把 candidate 复制为一个新 `WorldBookEntry`，加入 `useContentStore` 的某个用户专属 worldBook（如果不存在就创建一个名为"AI 候选 · {存档名}"的 worldBook）。同时把 candidate.status 改为 'accepted'。

- **路径 B（更精细）**：让玩家选择加入哪个现有 worldBook，弹一个选择对话框。

**初版实现路径 A**，UI 路径 B 留给 Phase 2.x。

## 11. GamePage 接入

> 落地于 `src/pages/GamePage.tsx` 的 `runStory` 内，`requestStory` 之前。

新增 `maybeRunSettingGuard` 函数（参考 `maybeUpdateAuthorDirectorPlan` 的形态）：

```ts
const maybeRunSettingGuard = useCallback(async (
  saveId: string,
  signal?: AbortSignal,
): Promise<{ memoryUrgent: boolean }> => {
  const actions = useGameStore.getState();
  const current = actions.saves[saveId];
  if (!current || current.content.mode !== 'author') return { memoryUrgent: false };

  const config = current.content.authorSettingGuard;
  if (!config?.enabled) return { memoryUrgent: false };

  const completedRound = current.state.currentRound;
  const nextRound = completedRound + 1;
  const allEntries = flattenWorldBookEntries(worldBooks, current.content.worldBookIds);

  try {
    const result = await requestSettingGuard({
      settings,
      outline,
      background,
      characterName: current.content.characterName,
      currentRound: completedRound,
      nextRound,
      totalRounds: current.config.totalRounds,
      config,
      summary: current.state.summary,
      longTermMemory: current.state.longTermMemory,
      recent: current.state.history.slice(-8),
      playerInput: current.state.lastPlayerInput,
      npcs: current.state.npcs ?? [],
      backpack: current.state.backpack ?? [],
      currentScene: current.state.currentScene,
      worldBookEntries: allEntries,
      anchors: current.state.anchors ?? [],
      narrative: current.state.authorNarrative,
      randomEventState: current.state.authorRandomEventState,
      signal,
    });

    if (!result) {
      actions.setSettingGuardError(saveId, '守护者未返回结果');
      return { memoryUrgent: false };
    }

    actions.applySettingGuardResult(saveId, result, completedRound);

    // 自动接受候选（如果配置开启）
    if (config.candidatesAutoAccept) {
      const fresh = useGameStore.getState().saves[saveId];
      const pending = fresh?.state.authorNarrative?.settingGuard?.candidates
        .filter((c) => c.status === 'pending') ?? [];
      pending.forEach((c) => actions.acceptSettingCandidate(saveId, c.id));
    }

    return { memoryUrgent: result.memoryUrgency === 'high' };
  } catch (err: any) {
    if (err?.name === 'AbortError') throw err;
    console.warn('[settingGuard] failed', err);
    actions.setSettingGuardError(saveId, err?.message ?? String(err));
    return { memoryUrgent: false };
  }
}, [settings, outline, background, worldBooks]);
```

### 在 `runStory` 内的接入点

```ts
const runStory = useCallback(async () => {
  // ...existing prelude...

  // 1️⃣ 先跑设定守护者（执笔模式）
  if (initial.content.mode === 'author') {
    try {
      const guard = await maybeRunSettingGuard(initial.id, abort.signal);
      if (guard.memoryUrgent) {
        // 高紧急度时立即跑记忆模型
        // 注意：此时 lastPlayerInput 还在，故事模型还没生成
        // 直接调用 applyDecisionForStory 不合适（它会跑决策模型）
        // 应该单独跑记忆。需要新增一个 runMemoryNow(saveId, abort.signal) 函数
        await runMemoryNow(initial.id, abort.signal);
      }
    } catch (err: any) {
      if (err?.name === 'AbortError') throw err;
      // 守护者失败不阻塞故事生成
    }
  }

  // 2️⃣ 然后才 requestStory
  // 故事模型会从 state.authorNarrative.settingGuard 读到守护者的输出
  // ... 其余 runStory 逻辑不变 ...
}, [/* deps + maybeRunSettingGuard + runMemoryNow */]);
```

`runMemoryNow` 是新拆出的便捷函数，仅跑记忆模型，不带决策——具体实现参考 `applyDecisionForStory` 中的 memory 段。提取出来时注意 `lastMemoryRound` 的更新。

### `requestStory` 的输入扩展

`storyAgent.ts` 的 `requestStory` 会从 `BuildStorySystemParams.authorNarrative` 读到 `settingGuard`，因此**调用层无需改动**——只要 `state.authorNarrative.settingGuard` 写好，故事模型就能读到。

但 `storySystem.ts` 的 `buildStorySystem` 需要新增 `settingGuardBlock` 渲染——见下一节。

## 12. storySystem.ts 改动

在 `buildStorySystem` 中新增 `settingGuardBlock` 计算与注入。

**注入位置**：在 `narrativePlanBlock` 之后、`logicReviewBlock` 之前——守护者的 patches 优先级应当高于审校建议（事前预防 > 事后修复）。

```ts
const settingGuard = authorNarrative?.settingGuard;
const settingGuardBlock = (() => {
  if (!settingGuard) return '';
  const lines: string[] = [];
  const must = settingGuard.patches.filter((p) => p.severity === 'must');
  const should = settingGuard.patches.filter((p) => p.severity === 'should');

  if (must.length || should.length) {
    lines.push('【执笔模式 · 本回合设定守护】');
    if (must.length) {
      lines.push('必须遵守（违反即为严重设定问题）：');
      must.slice(0, 6).forEach((p) => lines.push(`· ${p.topic}：${p.advice}`));
    }
    if (should.length) {
      lines.push('建议参考：');
      should.slice(0, 6).forEach((p) => lines.push(`· ${p.topic}：${p.advice}`));
    }
  }

  if (settingGuard.deviation) {
    lines.push('', '⚠ 守护者发现的偏离风险：');
    lines.push(settingGuard.deviation.description);
    if (settingGuard.deviation.affectedEntryNames?.length) {
      lines.push(`涉及世界书：${settingGuard.deviation.affectedEntryNames.join('、')}`);
    }
    lines.push('请在本回合或下一回合通过自然剧情修正方向。');
  }

  const beats = (settingGuard.pendingAmbientBeats ?? [])
    .filter((b) => !b.consumed && b.suggestedAtRound >= currentRound - 3);
  if (beats.length) {
    lines.push('', '【环境侧主动反应建议】（可选演绎，不强制全部纳入）：');
    beats.slice(0, 4).forEach((b) => {
      const tag = b.optional ? '' : '【强烈建议】';
      lines.push(`· ${tag}${b.source} · ${b.trigger}：${b.beat}`);
    });
  }

  if (settingGuard.preference?.tendency) {
    const conf = settingGuard.preference.confidence;
    if (conf !== 'low') {
      lines.push('', `【玩家偏好画像 · 置信度 ${conf}】`);
      lines.push(settingGuard.preference.tendency);
    }
  }

  return lines.length ? lines.join('\n') : '';
})();
```

**fallback 兜底**：和现有 `storyArcBlock` / `narrativePlanBlock` / `logicReviewBlock` 类似，如果模板渲染结果不包含本块的 header（玩家自定义模板可能漏掉），需要追加。

参考现有 `fallbackBlocks` 逻辑增加：

```ts
if (settingGuardBlock && !rendered.includes('【执笔模式 · 本回合设定守护】') && !rendered.includes('【环境侧主动反应建议】')) {
  fallbackBlocks.push(settingGuardBlock);
}
```

`renderPromptTemplate` 的 vars 中加入 `settingGuardBlock`。

## 13. 其他模型联动

### 13.1 让导演 / 审校 / 决策 / 随机事件读到 `settingGuard.preference`

这四个模型的 user prompt 都应当注入"玩家偏好画像"块（如果 `confidence != 'low'`），让它们的输出贴合玩家口味。

具体改法：
- 在 `authorDirectorSystem.ts` / `authorLogicCheckSystem.ts` / `authorRandomEventSystem.ts` 的 user 拼装里加 `formatPreferenceBlock(narrative)`
- 在 `decisionSystem.ts` 的 user 拼装里加同样的块（可考虑只在 `confidence='high'` 时才加，避免低置信度信号干扰）

这是**轻改动**，可以与守护者主体一起做，也可以放在守护者 v2 迭代。

### 13.2 让审校读到 `settingGuard.deviation`

审校在下次跑时，`buildAuthorLogicCheckUser` 应该读 `narrative.settingGuard.deviation`，把它作为"已知偏离风险"传给审校模型，让审校确认是否已修复。修复后通过 `clearSettingGuardDeviation` 清掉。

### 13.3 候选词条沉淀机制

`acceptSettingCandidate` 的实现需要决定：
- 沉淀到哪个 worldBook？建议：本旅程创建时如果没有专属"AI 守护沉淀"worldBook，自动创建一个名为 `守护沉淀 · {save.name}` 的 worldBook，所有 accepted 的 candidate 都进这个 book，并 push 到 `save.content.worldBookIds`。

## 14. UI 改动（src/components）

### 14.1 新增组件 `SettingGuardPanel.tsx`

挂在游戏页右侧，与 `AuthorArcPanel` 同侧。结构：

```
设定守护者
├─ 当前补丁（patches）
│  ├─ 必须遵守（must）—— 红色边框
│  └─ 建议参考（should）—— 灰色边框
├─ 偏离警告（deviation）—— 红色高亮
├─ 候选词条（candidates · pending）—— 卡片，每条带 [加入书库] [忽略] 按钮
├─ 环境侧建议（pendingAmbientBeats · 未 consumed）—— 折叠
└─ 玩家偏好（preference · confidence != low）—— 折叠
```

UI 风格沿用项目暗色奇幻 / 古籍羊皮纸感。组件内部使用 `useGameStore` 的相关 actions。

### 14.2 SetupPage 添加守护者配置区

在执笔模式的设置区（已经有 director / logicCheck / randomEvent）后追加"设定守护者"折叠区：
- 启用 / 禁用开关
- 提示词文本框
- 自动接受候选条目开关
- 启用环境侧建议开关

参考现有 `authorDirector` 配置区的写法。

### 14.3 SettingsPage 不需要改

守护者用 `randomModel || decisionModel || storyModel`，与其他辅助模型一致。

## 15. 旅程包导入导出

`src/lib/journeyPackage.ts` 已经会导出 `state.authorNarrative` 整体，因此 `settingGuard` 自动包含。

但需要确认：
- 导入时 `authorNarrative.settingGuard` 字段缺省时正常工作（旧存档兼容）
- `content.authorSettingGuard` 配置缺省时使用 `DEFAULT_AUTHOR_SETTING_GUARD_CONFIG`

参考现有 `authorDirector` / `authorLogicCheck` 的兼容逻辑，添加同样的 normalize 调用。

## 16. 失败兜底

| 失败位 | 行为 |
|---|---|
| 守护者 chatJSON 抛错 | console.warn；setSettingGuardError；保留上次 settingGuard 状态；故事模型继续跑 |
| 守护者返回非 JSON | 同上 |
| 守护者返回缺字段 | sanitize 函数 graceful 处理，缺失字段给空数组 / undefined |
| `acceptSettingCandidate` 失败 | 不影响游戏循环；候选保持 pending |
| 自动接受时世界书写入失败 | console.warn；候选状态退回 pending |

**重要原则**：守护者**永远不阻塞故事生成**。它是护栏，不是瓶颈。

## 17. 验收标准

实施完成后请用以下场景验证（建议复用 `test-saves/曦雨...` 这个旅程包的题材重跑）：

| # | 场景 | 期望守护者输出 |
|---|---|---|
| 1 | 故事写"林旭让带便利店饭团" | settingPatches 含「校园午餐」topic（advice 提到食堂或自带便当）；newWorldBookCandidates 可能包含「校园午餐规则」 |
| 2 | 故事把主动能力写成被动反向触发 | outlineDeviation 描述包含 wbe_2 与"恐惧驱动"冲突；settingPatches 含 must 级修正 |
| 3 | 玩家连续 5 回合选"观察"类选项 | playerPreference.tendency 反映"偏被动观察"；confidence=medium 或 high |
| 4 | 主角承诺"明晚去图书馆"后第 2 回合 | ambientBeats 包含图书馆相关或室友提醒类建议 |
| 5 | 玩家未给世界书条目，问任意校园细节 | newWorldBookCandidates 可能输出，rationale 必须明确指出"反复出现"的回合数 |
| 6 | 关闭守护者（config.enabled=false） | 整个守护者链路跳过，旅程不报错 |
| 7 | 守护者 API 返回非 JSON | 故事模型仍能跑出本回合正文；UI 不显示守护者新内容；`lastError` 写入 |
| 8 | 旧存档（无 authorSettingGuard）继续游玩 | 自动应用默认配置；不报错；首次跑时正常初始化 settingGuard 状态 |
| 9 | 玩家点"加入书库"接受候选 | 该 candidate.status=accepted；新条目出现在 useContentStore；下一回合 storySystem 的 worldBookAlwaysBlock/worldBookTriggeredBlock 能注入 |

## 18. 实施顺序建议

1. types/game.ts 数据结构扩展 + lib/authorMode.ts 默认配置 + normalize（半小时）
2. prompts/authorSettingGuardSystem.ts（直接复制本文档第 5、6 节）（半小时）
3. services/authorSettingGuardAgent.ts + sanitize（一小时）
4. store/useGameStore.ts 新增 actions + 合并规则（两小时）
5. pages/GamePage.tsx 接入 maybeRunSettingGuard + runStory 时序 + memoryUrgent 立即跑（一小时）
6. prompts/storySystem.ts 新增 settingGuardBlock 渲染 + fallback（半小时）
7. lib/journeyPackage.ts 导入导出兼容（半小时）
8. components/SettingGuardPanel.tsx + SetupPage 配置区（两小时）
9. （可选）authorDirectorSystem.ts / authorLogicCheckSystem.ts 注入 preference 块（半小时）
10. 自测 + 跑构建 + 用第 17 节验收清单跑

预计总工时 8-10 小时。

## 19. 与已有计划文档的协调

- `docs/execution-plan.md` 第 4 节"Phase 0 · 实测调优"中已发现的"瞎发挥"问题，本特性是直接解药。
- `docs/execution-plan.md` Phase 1.0 应当**新增**为"设定守护者"——本特性。Phase 1.1 主弧推迟一位。
- `docs/execution-plan.md` 第 9.1 节"prompt 长度爆炸"风险：守护者会让故事 prompt 进一步增长。建议在守护者实施时同步监测故事 prompt 总长度，超过阈值时优先压缩 `summaryBlock` 与 `npcsBlock`。

## 20. 不在本特性范围

- 主弧 Master Arc（Phase 1.1）
- 关系分析模型（Phase 1.2）
- 时间线分析模型（Phase 1.3）
- 伏笔追踪模型（Phase 1.4）
- 事件弧进度更新（Phase 1.5）
- 候选词条的精细化沉淀路径（选 worldBook、批量接受等 → Phase 2.x）
- 守护者输出供模型链路自定义编辑器消费（Phase 3.x #5 覆盖）

实施完成后请回到 `docs/execution-plan.md` 把进度跟踪表的 Phase 1.0 一行打勾。
