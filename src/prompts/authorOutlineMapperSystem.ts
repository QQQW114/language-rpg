/**
 * 提示词输入说明（维护用注释，不会进入模型）：
 * - system：大纲映射员身份、大纲贴合/偏离/桥接 JSON 协议，含 milestone 时机评估与题材范围输出。
 * - user：buildAuthorOutlineMapperUser 拼装本回合的大纲映射任务。
 * - 输入包含：原始故事大纲（含 themeAnchors / progressAnchors / stages）、世界书、主弧/既有规划、进行中事件。
 * - 输入包含：玩家标记、历史摘要、长期记忆、当前场景、已知人物、玩家当前输入、最新故事片段、最近上下文。
 * - 输入包含：回合司辰调度判断块（含 hint）。
 * - chat + 司书库启用时，服务层还会追加司书库 systemRules / manifest，并开放对应工具。
 * - 输出：大纲映射 JSON，含 milestoneOpportunity / stageThemeRange，供阶段判断 / 司辰 / 事件规划员消费。
 */
import type { StoryOutline, WorldBookEntry } from '@/types/content';
import type { AuthorNarrativeState, AuthorRandomEventState, MemoryAnchor, Message, Npc, SceneRef } from '@/types/game';

export const AUTHOR_OUTLINE_MAPPER_SYSTEM = `你是这段互动小说的"大纲映射员"。

你的职责：把原始故事大纲、主弧阶段、已发生剧情与玩家当前输入映射到当前故事进度，指出大纲贴合状态、当前 stage 完成度、缺少的桥接事件、可自然生成的小事件方向、偏离风险（红线），并评估下一个 milestone 的时机是否成熟。你的 milestoneOpportunity 输出是后续 milestone 决策的核心依据。

你不写正文，不替玩家决定行动，不生成完整导演计划，不设计具体事件细节；你只做"大纲→当前故事→下一步桥接需求与 milestone 时机"的分析。

【可用工具】
本次请求可能提供读取类工具（如读司书库、读大纲、读开局、读最近回合 等）；真实能力以 tools 字段为准。
- 对判断有影响的事实拿不准时再用，按需少量，不要拉全量。
- 工具结果只用于判断，不要复述进 JSON 或写成正文。

【大纲的两种形态】
- 旧大纲：仅有 acts（字符串数组）。此时你只能给传统映射，milestone 时机评估给保守判断，stageThemeRange 留空数组。
- 新大纲：有 stages（含 themeRange / milestoneCandidates / exitMilestone）+ themeAnchors + progressAnchors。此时你应充分利用：
  - stages：定位当前剧情对应哪个 stage，输出该 stage 的 themeRange 让事件规划员知道题材边界。
  - themeAnchors / progressAnchors：作为整本大纲的"题材引力场"和"进度挂载点"，事件命中进度锚点时世界进度才会推进。
  - exitMilestone：当前 stage 的出场关键事件——它是 milestone 时机评估的目标。

【milestone 时机评估】
milestone 时机是否成熟需要看三件事：
1. 当前 stage 完成度（stageProgress）：低于 50% 时通常不成熟，60-80% 是观察窗口，80%+ 进入成熟区。
2. 关键 beat 是否已铺垫：exitMilestone 需要的人物关系 / 设定 / 玩家心态铺垫是否到位。
3. 现实约束：当前 active 事件是否压着空间（事件未收时不该立 milestone）；玩家最近输入是否暗示愿意承接 milestone（玩家正在冷处理时不该硬出）。

输出 milestoneOpportunity 时给：
- ready：三件都到位，建议本回合可生成 milestone。
- approaching：1-2 件到位，但还差一些铺垫；建议继续出小事件铺路。
- not_ready：完成度低或铺垫缺很多；建议继续按 themeRange 出常规小事件。
- blocked：现实约束压着（active 事件未收 / 玩家冷处理）；建议先收旧事件或调整节奏。

输出只能是合法 JSON：
{
  "alignment":"aligned|drifting|bridging|ready_to_advance|uncertain",
  "currentAct":"当前对应的原始大纲幕/章节名，≤100字",
  "currentActIndex":0,
  "currentStageGoal":"当前阶段最重要目标，≤220字",
  "stageProgress":35,
  "stageThemeRange":["当前 stage 允许的事件题材范围；若使用旧 acts 大纲则留空数组"],
  "missingBridgeEvents":["为了贴合大纲还缺少的桥接事件/小事件类型"],
  "candidateEvents":["可自然生成或推进的小事件方向"],
  "driftRisks":["若继续自由发挥可能产生的偏离风险——这是事件规划员的红线"],
  "nextMilestone":"下一个自然里程碑，≤180字。优先使用 outline.stages[].exitMilestone；旧大纲则按 acts 推断",
  "milestoneOpportunity":{
    "status":"ready|approaching|not_ready|blocked",
    "rationale":"判断理由，≤160字。明示当前完成度 / 铺垫情况 / 现实约束",
    "missingPrep":["若 status=approaching，列出还缺哪些铺垫；其他状态可留空数组"]
  },
  "progressAnchorImpact":["可选：本回合 / 近期剧情命中哪些 progressAnchor（按锚点 id 列出）；未命中留空数组"]
}

规则：
- 遇到回忆、补写、跳过开局、能力起因、身份秘密等请求时，优先依照大纲/开局资料锁定因果链。
- 无尽模式下也必须使用原始大纲和主弧，不得因为没有总回合就忽略大纲。
- 如果玩家偏离大纲，给出自然桥接方式，不要强行否定玩家；红线偏离（如恋爱大纲下玩家提修仙）才写进 driftRisks。
- driftRisks 是事件规划员避让的红线；不要把"细节没贴合"也塞进来，只放"如果继续可能完全脱离大纲题材"的硬性风险。
- stageProgress 估算要诚实，不要为了凑成熟感虚高，也不要因为玩家慢就压得太低。
- milestoneOpportunity.status=ready 是一个强信号，会驱动事件规划员生成主线大事件；不确定时优先用 approaching。
- 不输出 hint 内容，只输出信号。`;

function clip(text: unknown, max = 1200): string {
  const s = String(text ?? '').trim();
  return s.length > max ? `${s.slice(0, max)}…` : s || '（无）';
}

function formatRecent(msgs: Message[]): string {
  if (!msgs.length) return '（无）';
  return msgs.slice(-8).map((m) => `【${m.role === 'assistant' ? '故事' : '玩家'}｜第${m.round}回合】\n${clip(m.content, 800)}`).join('\n\n');
}

function formatNpcs(npcs?: Npc[]): string {
  if (!npcs?.length) return '（无）';
  return npcs.slice(0, 10).map((n) => `· ${n.name}${n.role ? `（${n.role}）` : ''}：好感${n.affinity}；${clip(n.description, 120)}${n.recentNote ? `；最近：${n.recentNote}` : ''}`).join('\n');
}

function formatWorldBook(entries?: WorldBookEntry[]): string {
  if (!entries?.length) return '（无）';
  return entries.slice(0, 12).map((e) => `· ${e.name}${e.alwaysActive ? '【常驻】' : ''}：${clip(e.content, 500)}`).join('\n');
}

function formatAnchors(anchors?: MemoryAnchor[]): string {
  if (!anchors?.length) return '（无）';
  return anchors.slice(-8).map((a) => `· 第${a.round}回合${a.note ? `【${a.note}】` : ''}：${clip(a.content || a.excerpt, 500)}`).join('\n');
}

function formatOutlineForMapper(outline?: StoryOutline): string {
  if (!outline) return '（无）';
  const lines = [
    `标题：${outline.title}`,
    `梗概：${outline.synopsis}`,
  ];
  if (outline.acts?.length) {
    lines.push('幕：');
    outline.acts.forEach((a, i) => lines.push(`  第${i + 1}幕：${a}`));
  }
  if (outline.tone) lines.push(`文风：${outline.tone}`);
  const o = outline as StoryOutline & {
    themeAnchors?: string[];
    progressAnchors?: Array<{ type: string; id: string; label?: string; weight?: number }>;
    stages?: Array<{ name: string; description?: string; themeRange?: string[]; milestoneCandidates?: string[]; exitMilestone?: string }>;
  };
  if (o.themeAnchors?.length) lines.push(`题材锚点（整本）：${o.themeAnchors.join('、')}`);
  if (o.progressAnchors?.length) {
    lines.push('进度锚点（事件命中时挂世界进度）：');
    o.progressAnchors.forEach((a) => {
      lines.push(`  · id=${a.id}｜type=${a.type}${a.label ? `｜${a.label}` : ''}${a.weight !== undefined ? `｜w=${a.weight}` : ''}`);
    });
  }
  if (o.stages?.length) {
    lines.push('阶段细则（新结构，优先使用）：');
    o.stages.forEach((s, i) => {
      lines.push(`  第${i + 1}阶段「${s.name}」${s.description ? `：${s.description}` : ''}`);
      if (s.themeRange?.length) lines.push(`    题材范围：${s.themeRange.join('、')}`);
      if (s.milestoneCandidates?.length) lines.push(`    milestone 候选：${s.milestoneCandidates.join('；')}`);
      if (s.exitMilestone) lines.push(`    exitMilestone：${s.exitMilestone}`);
    });
  }
  return lines.join('\n');
}

function formatNarrative(narrative?: AuthorNarrativeState): string {
  const lines: string[] = [];
  const master = narrative?.masterArc;
  const stage = master?.stages[master.currentStageIndex];
  if (master) {
    lines.push(`主弧：${master.title}`);
    lines.push(`主弧摘要：${master.summary}`);
    if (stage) {
      lines.push(`当前阶段：${stage.name}`);
      lines.push(`阶段目标：${stage.description}`);
      if (stage.expectedBeats?.length) {
        lines.push(`待/已节拍：${stage.expectedBeats.map((b) => `${b.status}:${b.description}`).join(' / ')}`);
      }
    }
  }
  if (narrative?.outlineMapping) {
    lines.push(`上次大纲映射：${narrative.outlineMapping.alignment}｜${narrative.outlineMapping.currentStageGoal ?? ''}`);
    if (narrative.outlineMapping.stageProgress !== undefined) lines.push(`上次 stage 完成度：${narrative.outlineMapping.stageProgress}%`);
  }
  if (narrative?.plan?.outlineAlignment) lines.push(`导演大纲判断：${narrative.plan.outlineAlignment}`);
  if (narrative?.stageJudge) lines.push(`阶段判断：${narrative.stageJudge.storyFocus.thisRound}｜玩家节奏：${narrative.stageJudge.playerPace}`);
  if (narrative?.eventBeat) {
    lines.push(`司事最近判定：${narrative.eventBeat.verdicts?.length ?? 0} 个事件`);
    if (narrative.eventBeat.planConcern) lines.push(`司事反馈：${narrative.eventBeat.planConcern}`);
  }
  return lines.join('\n') || '（无）';
}

function formatEvents(narrative?: AuthorNarrativeState, randomEventState?: AuthorRandomEventState): string {
  const arcs = [
    ...(randomEventState?.pendingEvent ? [randomEventState.pendingEvent] : []),
    ...(randomEventState?.activeEvents ?? []),
    ...(narrative?.activeArcs ?? []),
  ];
  if (!arcs.length) return '（无 active 事件）';
  return arcs.slice(0, 8).map((a) => {
    const milestone = a.isMilestone ? '[milestone]' : '';
    return `· ${milestone}${a.title}｜${a.lifecycle ?? a.status}｜${a.progressPercent ?? 0}%｜${clip(a.summary || a.surfaceGoal || a.directive, 260)}`;
  }).join('\n');
}

function formatOrchestrator(narrative?: AuthorNarrativeState): string {
  const o = narrative?.orchestrator;
  if (!o) return '（无）';
  const lines: string[] = [];
  if (o.turnType) lines.push(`回合类型：${o.turnType}`);
  if (o.planningMode) lines.push(`规划强度：${o.planningMode}`);
  if (o.focusAreas?.length) lines.push(`关注方向：${o.focusAreas.join('、')}`);
  const relevantSignals = (o.planSignals ?? []).filter((s) => s.area === 'outline' || s.suggestedModel === 'outlineMapper');
  if (relevantSignals.length) {
    lines.push('相关信号：');
    relevantSignals.slice(0, 4).forEach((s) => {
      lines.push(`· ${s.area}/${s.priority}：${s.reason}`);
    });
  }
  const callsRaw = o.calls as unknown as Record<string, { hint?: string } | undefined> | undefined;
  const hint = callsRaw?.outlineMapper?.hint?.trim();
  if (hint) lines.push(`本回合提示：${hint}`);
  return lines.length ? lines.join('\n') : '（无）';
}

export function buildAuthorOutlineMapperUser(p: {
  outline?: StoryOutline;
  currentRound: number;
  nextRound: number;
  totalRounds: number;
  playerInput?: string;
  latestStory?: string;
  recent: Message[];
  summary?: string;
  longTermMemory?: string;
  npcs?: Npc[];
  currentScene?: SceneRef;
  narrative?: AuthorNarrativeState;
  randomEventState?: AuthorRandomEventState;
  worldBookEntries?: WorldBookEntry[];
  anchors?: MemoryAnchor[];
}): string {
  return [
    '【任务】',
    `为第 ${p.nextRound} 回合做大纲映射，含 milestone 时机评估。只输出 JSON。`,
    `已完成回合：${p.currentRound}；总回合：${p.totalRounds || '无尽'}`,
    '',
    '【原始故事大纲】',
    formatOutlineForMapper(p.outline),
    '',
    '【世界书】',
    formatWorldBook(p.worldBookEntries),
    '',
    '【主弧 / 既有规划】',
    formatNarrative(p.narrative),
    '',
    '【回合司辰调度判断】',
    formatOrchestrator(p.narrative),
    '',
    '【进行中事件】（评估 milestoneOpportunity 时考虑现实约束）',
    formatEvents(p.narrative, p.randomEventState),
    '',
    '【玩家标记】',
    formatAnchors(p.anchors),
    '',
    '【摘要 / 长期记忆】',
    `摘要：${clip(p.summary, 1200)}`,
    `长期记忆：${clip(p.longTermMemory, 1200)}`,
    '',
    '【当前场景 / 人物】',
    `场景：${p.currentScene ? `${p.currentScene.name}；${p.currentScene.description ?? ''}；${p.currentScene.time ?? ''}；${p.currentScene.weather ?? ''}` : '（未知）'}`,
    `人物：\n${formatNpcs(p.npcs)}`,
    '',
    '【玩家当前输入】',
    p.playerInput || '（无，可能是自动推进）',
    '',
    '【最新故事片段】',
    clip(p.latestStory, 1600),
    '',
    '【最近上下文】',
    formatRecent(p.recent),
  ].join('\n');
}
