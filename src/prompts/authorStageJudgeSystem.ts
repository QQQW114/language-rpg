// 阶段判断 / 玩家意图分析模型：每回合最先跑，输出 playerIntent / playerPace / stageStatus / storyFocus
// 详见 docs/stage-narrative.md 第 5 节。

import type { StoryOutline, WorldBookEntry } from '@/types/content';
import type {
  AuthorStageJudgeConfig,
  MasterArcState,
  MemoryAnchor,
  Message,
  NarrativePlanState,
  NarrativeStage,
  Npc,
  SceneRef,
  StageJudgeState,
  StoryArc,
} from '@/types/game';
import { formatStoryArcForPrompt } from '@/lib/authorMode';

export const AUTHOR_STAGE_JUDGE_SYSTEM = `你是互动小说的"阶段判断 / 玩家意图分析师"。每回合在故事生成之前最先跑。你不写正文、不出选项、不规划长线，只回答四个问题：

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
    "secondary": ["可演绎的次要诉求，最多3条 ≤60字"],
    "implicit": "玩家没明说但意图里隐含的，≤80字（可省略）"
  },
  "playerPace": "immersive",
  "paceReasoning": "判断依据，≤140字",
  "stageStatus": {
    "currentStageId": "stage_xxx",
    "completion": 35,
    "newlyAchievedBeats": ["beat_xxx"],
    "shouldAdvance": false,
    "advanceReasoning": "本阶段还有 X 个关键 beat 未达成，且玩家仍在探索能力规则；建议保留至少 2-3 回合完成本阶段。"
  },
  "storyFocus": {
    "thisRound": "本回合让主角完成 XX 一件具体事；不要顺带把 YY、ZZ 的多步压在一起。",
    "avoid": ["不要立刻推进到下一阶段","不要让主角一回合内完成多个空间转移"]
  }
}

playerPace 判定标准：
- immersive：玩家在细描感受 / 反复琢磨内心 / 不主动推进 / 反思上一回合的细节。例："呸，说点大家不知道的，有点小激动啊" / "我先盘算一下..."
- exploratory：玩家在试探各种小动作 / 反复改主意 / 对环境元素反应过度。例："等等先看垃圾桶" / "啊？我脑子一片空白"
- progressing：玩家给出明确的"接下来去 X" / "我想做 Y" 的主动推进。例："找找共享电单车去鞋店" / "买完鞋去干什么呢"
- hurrying：玩家明确说"快进 / 直接 X / 跳到 Y" / 多个动作连起来要求一次完成。例："直接回宿舍换衣服出去逛街" / "省略路上"
- 信号矛盾时（玩家既在内心独白又有明确动作），按"动作"判定 progressing 或 exploratory，不要默认 immersive。

stageStatus 判定标准：
- shouldAdvance=true 仅当：currentStage 的 completionConditions **全部满足**，且 expectedBeats 至少 70% 已 achieved。
- 玩家如果明确表达"我想进入下一阶段 / 跳过这部分"，shouldAdvance=true，advanceReasoning 注明"玩家主动要求"。
- 否则 shouldAdvance=false，advanceReasoning 写"还差什么 beat / 还没满足哪个 completionCondition"。
- newlyAchievedBeats 仅包含本回合**新**达成的 beat id（必须严格匹配 currentStage.expectedBeats[].id）；之前已 achieved 的不要重复列出；不存在的 id 不要编造。
- completion（0-100）按 expectedBeats 的 achieved 比例 + completionConditions 满足度综合估算。
- 若没有 currentStage（主弧未初始化），currentStageId 省略，completion=0，shouldAdvance=false。

storyFocus.thisRound 写作要求：
- 必须**单一**——只写一件具体事。
- 必须呼应 playerIntent.primary，但要把它分解为**一个微节拍**而不是多步压缩。
- 例：玩家说"先变回去再回宿舍"——thisRound 应是"让主角找到一个隐蔽角落（如杂物间），开始尝试变回男生"，而**不是**"变回男生 + 回宿舍 + 藏好女装"。
- 例：玩家说"出去当当女生"——thisRound 应是"让主角推开宿舍楼大门走入校园，第一次以女生身份感受外部环境"，而**不是**"戴帽子 + 锁门 + 下楼 + 出宿舍楼 + 走校道 + 路人反应 + 走到便利店"。
- 必须根据 playerPace 调整粒度：immersive 写最微的感受性节拍；exploratory 写一个动作 + 即时反应；progressing 写一个明确剧情节拍；hurrying 允许压缩 2-3 步但仍要点出关键变化。
- ★ **大纲细节保留**：如果大纲（outline.acts）或上方"当前阶段 · 期望节拍"对当前节拍写了具体细节（例：「脑中随即浮现出有关性别转换异能的完整记忆」、「灌入完整能力知识」、「在心中默念某种咒语」），thisRound 必须保留这些具体性，不要抽象化为"觉醒能力 / 触发能力"。具体性是叙事质感的来源，被抽象化会让故事失味。
- ★ **世界书一致性**：如果上方【世界书 · 硬设定】对当前节拍涉及的机制有定义（例：能力是主动可控还是被动反向、是否有冷却、是否对他人有效），thisRound 描述时必须与之一致；不要把"主动施用"误判为"情绪驱动"。
- ★ **玩家承诺与未解事件**：如果上方【长期一致性记忆】或【玩家标记】里有未兑现的承诺、未回收的伏笔、待办事件，且本回合玩家输入与之相关，thisRound 应当呼应；如果完全不相关，仅在 secondary 里轻提即可。

storyFocus.avoid 写作要求：
- 必须列出**本回合应该被刻意延后**的多步压缩动作，给故事模型明确的负面边界。
- 用"不要 + 具体动作"句式，避免空泛禁令。
- 例：避免"不要写得太快"——应写"不要让主角一回合内完成换装 + 出门 + 与陌生人对话三件事"。

边界纪律：
- 不要替故事模型写正文片段。
- 不要替导演规划未来多个回合。
- 不要替守护者补充世界设定。
- 不要在 advanceReasoning 中泄露未发生的剧情。
- 玩家自定义提示词的额外要求需纳入考量，但不能违反上述协议。
- 没有信号时给最保守判断：playerPace='progressing'，shouldAdvance=false。`;

function formatRecent(msgs: Message[]): string {
  if (!msgs?.length) return '（无）';
  return msgs.map((m) => {
    const tag = m.role === 'assistant' ? `故事·第${m.round}回合` : `玩家·第${m.round}回合`;
    return `【${tag}】\n${m.content}`;
  }).join('\n\n');
}

function formatNpcs(npcs: Npc[]): string {
  if (!npcs?.length) return '（尚无已知 NPC）';
  return npcs.slice(0, 8).map((n) => {
    const aff = n.affinity > 0 ? `+${n.affinity}` : String(n.affinity);
    return `· ${n.name}${n.role ? `（${n.role}）` : ''}：好感 ${aff}${n.description ? `；${n.description}` : ''}`;
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

function formatStage(stage: NarrativeStage | undefined, label: '当前阶段' | '下一阶段'): string {
  if (!stage) return `${label}：（无）`;
  const lines = [
    `${label}：${stage.name}（id: ${stage.id}）`,
    `阶段目标：${stage.description}`,
  ];
  if (label === '当前阶段') {
    if (stage.enterConditions?.length) {
      lines.push(`进入条件：${stage.enterConditions.join('；')}`);
    }
    if (stage.completionConditions?.length) {
      lines.push('完成条件：');
      stage.completionConditions.forEach((c) => lines.push(`· ${c}`));
    }
    if (stage.expectedBeats?.length) {
      lines.push('期望节拍（含状态）：');
      stage.expectedBeats.forEach((b) => {
        const tag = b.status === 'achieved' ? '✓' : b.status === 'skipped' ? '⤳' : '○';
        lines.push(`· ${tag} ${b.id}：${b.description}`);
      });
    }
  } else {
    // 下一阶段只给概要参考
    lines.push(`（仅供参考，不要主动推进过去）`);
  }
  return lines.join('\n');
}

function formatNarrativePlan(plan?: NarrativePlanState): string {
  if (!plan) return '（无）';
  return [
    plan.currentAct ? `当前幕：${plan.currentAct}` : '',
    plan.currentStage ? `当前阶段：${plan.currentStage}` : '',
    plan.stageGoal ? `阶段目标：${plan.stageGoal}` : '',
    plan.nextRoundFocus ? `导演给的下一回合焦点：${plan.nextRoundFocus}` : '',
  ].filter(Boolean).join('\n') || '（无）';
}

function formatPreviousJudge(previous?: StageJudgeState): string {
  if (!previous) return '（无）';
  return [
    `上一判断回合：${previous.updatedAtRound}`,
    `上一玩家节奏：${previous.playerPace}`,
    `上一玩家意图：${previous.playerIntent.primary}`,
    `上一聚焦：${previous.storyFocus.thisRound}`,
    `上一阶段完成度：${previous.stageStatus.completion}%`,
    previous.stageStatus.advanceReasoning ? `上一推进判断：${previous.stageStatus.advanceReasoning}` : '',
  ].filter(Boolean).join('\n');
}

function formatAlwaysActiveWorldBook(entries: WorldBookEntry[] | undefined): string {
  const always = (entries ?? []).filter((e) => e.alwaysActive);
  if (!always.length) return '';
  const lines: string[] = ['【世界书 · 硬设定】（thisRound 描述涉及的机制时必须与之兼容）'];
  for (const e of always.slice(0, 8)) {
    const content = e.content.length > 200 ? `${e.content.slice(0, 200)}…` : e.content;
    lines.push(`· ${e.name}：${content}`);
  }
  return lines.join('\n');
}

function formatAnchors(anchors: MemoryAnchor[] | undefined): string {
  if (!anchors?.length) return '';
  const lines: string[] = ['【玩家标记的关键记忆】（玩家明确不可忘的内容；与本回合相关时 thisRound 必须呼应）'];
  for (const a of anchors.slice(-6)) {
    const note = a.note ? `【${a.note}】` : '';
    const content = (a.content?.trim() || a.excerpt?.trim() || '').trim();
    if (!content) continue;
    const trimmed = content.length > 160 ? `${content.slice(0, 160)}…` : content;
    lines.push(`· 第 ${a.round} 回合${note}：${trimmed}`);
  }
  return lines.length > 1 ? lines.join('\n') : '';
}

function formatActiveArcs(arcs: StoryArc[] | undefined, currentRound: number): string {
  if (!arcs?.length) return '';
  const lines: string[] = ['【进行中的事件弧】（若与本回合玩家输入相关，stageStatus 与 storyFocus 应与之协调）'];
  for (const arc of arcs.slice(0, 4)) {
    lines.push(formatStoryArcForPrompt(arc, currentRound));
  }
  return lines.join('\n');
}

export interface BuildStageJudgeUserParams {
  outline?: StoryOutline;
  characterName?: string;
  currentRound: number;
  nextRound: number;
  config: AuthorStageJudgeConfig;
  summary?: string;
  longTermMemory?: string;
  recent: Message[];
  playerInput?: string;
  npcs: Npc[];
  currentScene?: SceneRef;
  masterArc?: MasterArcState;
  narrativePlan?: NarrativePlanState;
  previous?: StageJudgeState;
  worldBookEntries?: WorldBookEntry[];
  anchors?: MemoryAnchor[];
  activeArcs?: StoryArc[];
}

export function buildStageJudgeUser(p: BuildStageJudgeUserParams): string {
  const currentStage = p.masterArc?.stages[p.masterArc.currentStageIndex];
  const nextStage = p.masterArc?.stages[p.masterArc.currentStageIndex + 1];
  const worldBookBlock = formatAlwaysActiveWorldBook(p.worldBookEntries);
  const anchorsBlock = formatAnchors(p.anchors);
  const arcsBlock = formatActiveArcs(p.activeArcs, p.currentRound);

  const lines: string[] = [
    `【阶段判断任务】请为即将开始的第 ${p.nextRound} 回合做事前阶段与意图判断。`,
    `已完成回合：${p.currentRound}`,
    '',
  ];

  if (p.outline) {
    lines.push(
      '【故事大纲】',
      `标题：${p.outline.title}`,
      `梗概：${p.outline.synopsis}`,
      p.outline.tone ? `文风：${p.outline.tone}` : '',
      '',
    );
  }

  if (worldBookBlock) {
    lines.push(worldBookBlock, '');
  }

  if (p.masterArc) {
    lines.push(
      '【主弧】',
      `标题：${p.masterArc.title}`,
      `走向：${p.masterArc.summary}`,
      '',
      formatStage(currentStage, '当前阶段'),
      '',
    );
    if (nextStage) {
      lines.push(formatStage(nextStage, '下一阶段'), '');
    }
  } else {
    lines.push(
      '【主弧】（未初始化，stageStatus 输出 currentStageId 省略 + completion=0 + shouldAdvance=false）',
      '',
    );
  }

  if (p.summary?.trim()) {
    lines.push('【历史摘要】', p.summary.trim(), '');
  }

  if (p.longTermMemory?.trim()) {
    lines.push(
      '【长期一致性记忆】（含主角承诺、未解线索、稳定关系；与本回合相关时 thisRound 必须呼应）',
      p.longTermMemory.trim(),
      '',
    );
  }

  if (anchorsBlock) {
    lines.push(anchorsBlock, '');
  }

  if (arcsBlock) {
    lines.push(arcsBlock, '');
  }

  lines.push(
    '【最近上下文（最近 6 条）】',
    formatRecent(p.recent),
    '',
    '【玩家本回合最新输入】',
    p.playerInput?.trim() || '（无 — 玩家可能选了一个 choice 而非自由输入）',
    '',
    '【已知 NPC（仅前 8 个，提供身份语境）】',
    formatNpcs(p.npcs),
    '',
    '【当前场景】',
    formatScene(p.currentScene),
    '',
    '【当前导演计划】（参考用，不要替导演决策）',
    formatNarrativePlan(p.narrativePlan),
    '',
    '【上一轮阶段判断】（只作连续性参考；本轮应重新判断，不要机械沿用）',
    formatPreviousJudge(p.previous),
    '',
    '【玩家给阶段判断的额外要求】',
    p.config.prompt?.trim() || '（无）',
    '',
    '请按系统协议输出 JSON。',
    '关键提醒：',
    '- newlyAchievedBeats 必须严格匹配上方【当前阶段】列出的 beat id；不存在的 id 不要编造。',
    '- storyFocus.thisRound 必须是单一微节拍；如果玩家输入提到多个动作，挑最自然的第一步。',
    '- 大纲细节（如"脑中浮现完整记忆"）若与本回合相关，thisRound 必须保留具体性，不要抽象化。',
    '- 与【世界书 · 硬设定】冲突的描述属于错误：例如世界书写"主动可控"则不能写"被动反向触发"。',
    '- playerPace 信号矛盾时按"动作"判定，不要默认 immersive。',
  );

  return lines.filter((line) => line !== '').join('\n').replace(/\n{3,}/g, '\n\n').trim();
}
