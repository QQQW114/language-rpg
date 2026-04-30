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
} from '@/types/game';
import { formatStoryArcForPrompt } from '@/lib/authorMode';
import { formatItemsForPrompt } from '@/lib/items';

export const AUTHOR_SETTING_GUARD_SYSTEM = `你是互动小说的"设定守护者 / 前置督导"。你不写正文，不出选项，不规划长线，只在故事模型生成本回合之前，扫描世界书、长期记忆、玩家最新输入、最近剧情、人物档案与场景状态，回答四个问题：

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
- 不要在 settingPatches 中写"主角应该做 X"这种行动指令——你只描述"世界设定是 X"。
- 玩家自定义提示词中的额外要求（见用户消息末尾）需要纳入考量，但不能违反上述协议。`;

function truncateText(value: string | undefined, max: number): string {
  const text = (value ?? '').trim();
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function formatOutline(outline?: StoryOutline): string {
  if (!outline) return '（无）';
  return [
    `标题：${outline.title}`,
    `梗概：${outline.synopsis}`,
    outline.acts?.length ? `阶段：${outline.acts.join(' / ')}` : '',
    outline.tone ? `文风：${outline.tone}` : '',
  ].filter(Boolean).join('\n');
}

function formatWorldBook(entries: WorldBookEntry[]): string {
  if (!entries.length) return '（无）';
  const always = entries.filter((e) => e.alwaysActive);
  const triggered = entries.filter((e) => !e.alwaysActive);
  const lines: string[] = [];
  if (always.length) {
    lines.push('常驻：');
    for (const e of always.slice(0, 20)) {
      lines.push(`· ${e.name}：${truncateText(e.content, 200)}`);
    }
  }
  if (triggered.length) {
    lines.push('非常驻（关键词触发）：');
    for (const e of triggered.slice(0, 40)) {
      const keywords = e.keywords?.length ? `（关键词：${e.keywords.slice(0, 8).join('、')}）` : '';
      lines.push(`· ${e.name}：${truncateText(e.content, 200)}${keywords}`);
    }
  }
  return lines.join('\n') || '（无）';
}

function formatBackground(background?: Background, characterName?: string): string {
  if (!background) return '（无）';
  return [
    `姓名：${characterName || '（未命名）'}`,
    `出身：${background.name}`,
    `描述：${background.description}`,
    `特质：${background.traits.join('、') || '无'}`,
  ].join('\n');
}

function formatRecent(msgs: Message[]): string {
  if (!msgs.length) return '（无）';
  return msgs.map((m) => {
    const tag = m.role === 'assistant' ? `故事·第${m.round}回合` : `玩家·第${m.round}回合`;
    return `【${tag}】\n${m.content}`;
  }).join('\n\n');
}

function formatAnchors(anchors: MemoryAnchor[]): string {
  if (!anchors.length) return '（无）';
  return anchors.slice(-10).map((a) => {
    const note = a.note ? `【${a.note}】` : '';
    const content = a.content?.trim() || a.excerpt?.trim() || '';
    return `· 第 ${a.round} 回合${note}：${content}`;
  }).join('\n') || '（无）';
}

function formatNpcs(npcs: Npc[]): string {
  if (!npcs.length) return '（尚无已知 NPC）';
  return npcs.slice(0, 24).map((n) => {
    const aff = n.affinity > 0 ? `+${n.affinity}` : String(n.affinity);
    const details = n.details?.length ? `；细节：${n.details.slice(0, 10).join('、')}` : '';
    return `· ${n.name}${n.role ? `（${n.role}）` : ''}：好感 ${aff}${n.description ? `；${n.description}` : ''}${details}${n.recentNote ? `；最近：${n.recentNote}` : ''}`;
  }).join('\n');
}

function formatScene(scene?: SceneRef): string {
  if (!scene) return '（未知）';
  return [
    scene.name,
    scene.description ? `描述：${scene.description}` : '',
    scene.time ? `时间：${scene.time}` : '',
    scene.weather ? `天气：${scene.weather}` : '',
  ].filter(Boolean).join('\n');
}

function formatNarrativePlan(narrative?: AuthorNarrativeState): string {
  const plan = narrative?.plan;
  if (!plan) return '（无）';
  return [
    plan.currentAct ? `当前幕：${plan.currentAct}` : '',
    plan.currentStage ? `当前阶段：${plan.currentStage}` : '',
    plan.stageGoal ? `阶段目标：${plan.stageGoal}` : '',
    plan.nextRoundFocus ? `下一回合焦点：${plan.nextRoundFocus}` : '',
    plan.nextFewRoundsPlan?.length
      ? `未来计划：${plan.nextFewRoundsPlan.map((x) => `第${x.startRound}-${x.endRound}回合 ${x.goal}`).join('；')}`
      : '',
    plan.outlineAlignment ? `大纲贴合：${plan.outlineAlignment}` : '',
  ].filter(Boolean).join('\n') || '（无）';
}

function formatActiveArcs(p: {
  narrative?: AuthorNarrativeState;
  randomEventState?: AuthorRandomEventState;
  nextRound: number;
}): string {
  const arcs = [
    ...(p.randomEventState?.pendingEvent ? [p.randomEventState.pendingEvent] : []),
    ...(p.randomEventState?.activeEvents ?? []),
    ...(p.narrative?.activeArcs ?? []),
  ];
  if (!arcs.length) return '（无）';
  return arcs.slice(0, 10).map((arc) => formatStoryArcForPrompt(arc, p.nextRound)).join('\n');
}

export function buildSettingGuardUser(p: {
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
}): string {
  const isInfinite = !p.totalRounds || p.totalRounds <= 0;
  return [
    `【守护任务】请为即将开始的第 ${p.nextRound} 回合做事前设定守护。`,
    `已完成回合：${p.currentRound}`,
    `总回合：${isInfinite ? '无尽模式' : p.totalRounds}`,
    '',
    '【故事大纲】',
    formatOutline(p.outline),
    '',
    '【全部世界书条目】（不要重复已覆盖的设定，但要审视是否被本回合即将出现的剧情违反）',
    formatWorldBook(p.worldBookEntries),
    '',
    '【主角 / 出身】',
    formatBackground(p.background, p.characterName),
    '',
    '【历史摘要】',
    p.summary?.trim() || '（无）',
    '',
    '【长期一致性记忆】',
    p.longTermMemory?.trim() || '（无）',
    '',
    '【玩家标记的关键记忆】',
    formatAnchors(p.anchors),
    '',
    '【最近上下文】',
    formatRecent(p.recent),
    '',
    '【玩家本回合最新输入】',
    p.playerInput?.trim() || '（无）',
    '',
    '【已知 NPC / 关系】',
    formatNpcs(p.npcs),
    '',
    '【玩家背包】',
    p.backpack.length ? formatItemsForPrompt(p.backpack) : '（空）',
    '',
    '【当前场景】',
    formatScene(p.currentScene),
    '',
    '【当前导演计划】（参考用，不要替导演决策）',
    formatNarrativePlan(p.narrative),
    '',
    '【正在进行的事件弧 / 长线事件】',
    formatActiveArcs({
      narrative: p.narrative,
      randomEventState: p.randomEventState,
      nextRound: p.nextRound,
    }),
    '',
    '【玩家给守护者的额外要求】',
    p.config.prompt || '（无）',
    '',
    '请按系统协议输出 JSON。',
  ].filter(Boolean).join('\n');
}
