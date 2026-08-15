import {
  chatJSONDetailed,
  chatStreamDetailed,
  type ChatMessage,
  type ChatTool,
  type ChatToolActivity,
  type ChatToolInvocation,
} from '@/services/llmClient';
import { resolvePlannerModel, resolveStoryModel } from '@/lib/agentModels';
import { extractJSON, genId } from '@/lib/utils';
import type { LlmUsage } from '@/types/llm';
import type { RoleInjectConfig } from '@/types/settings';
import { commitTurnPatchV2 } from './patch';
import type { ModelActivityV2, ModelPhaseStatusV2, ModelPhaseV2, PatchWarningV2, TurnPatchV2, TurnRequestV2 } from './types';

const plannerPrePlayerAgency = `优先级：玩家明确行动 > worldFacts硬设定 > canonicalFacts旅程正史 > 当前程序状态 > 近期正文 > 合理补全。
玩家也是共同作者。不要把偏离当前路线的行动视为越权，不要机械拒绝；根据世界规律写出其合理结果，并允许玩家真正改变地点、身份、关系和抵达路径。`;

const plannerPreDirectorAgency = `玩家是导演，当前输入是不可撤销的故事指令，拥有最高优先级。必须100%信任玩家输入：不审查合理性、不让主角拒绝或打折扣，输入要求故事如何发展，故事就如何发展、发展到哪。若输入与既有世界规律冲突，以导演指令为准调整叙事与世界表现，使其自然成立。`;

function buildPlannerPreSystem(director: boolean): string {
  return `你是互动小说的写前规划 Agent，只做本回合写作约束，不扮演角色，不续写正文，只输出严格 JSON（json object）。
${director ? plannerPreDirectorAgency : plannerPrePlayerAgency}
长期大纲描述的是必须逐步抵达的命运、人物成长和设定结局，不是固定路线。玩家改变路线后，规划关键角色、矛盾和事件功能如何自然迁移到新环境，使自由路径最终重新汇合到预设命运。
偏离只影响抵达速度和路径，不取消长期命运。不要为了拉回大纲而立刻强塞关键角色；本轮只安排自然、可信的一步。
允许补全资料空白，但只补本回合必要内容。不得预先决定玩家下一步，不得把“考虑、可能、打算”写成已完成决定。
叙事速度约束的是单回合覆盖的故事时间、主要动作和场景数量，不是要求凑够篇幅。慢叙事与标准叙事应选择最早且有意义的玩家可介入节点，给后续回合保留反应、对话和后果；不得把一次输入扩展成自带开端、发展、结尾的完整短篇。
stopBoundary必须是本轮正文最后一个允许发生的动作；不得把边界后的动作、事后反应、下一地点或后续安排写入writingBrief。`;
}

const storyPlayerAgency = `玩家是共同作者，应真实承接其行动。世界书决定行动在这个世界里如何实现，而不是用来机械拒绝玩家。玩家改变路线时，可以迁移舞台与事件，但必须保持世界规律，并让长期命运通过新的合理路径继续发展。`;

const storyDirectorAgency = `玩家是导演，当前输入是必须执行的故事指令。必须100%信任并如实写出，不审查合理性、不让主角拒绝、不弱化或打折；输入要求故事如何发展，故事就如何发展、发展到哪。若输入与既有世界规律冲突，以导演指令为准调整叙事，使其自然成立。`;

function buildStorySystem(director: boolean): string {
  return `你是互动小说故事 Agent，只写中文小说正文。
严格执行权威状态、玩家输入、writingBrief、hardConstraints、forbiddenChanges和stopBoundary。worldFacts与canonicalFacts优先于常见套路和戏剧性补全。
${director ? storyDirectorAgency : storyPlayerAgency}
某一事实域变化时，只改变硬设定明确覆盖的范围；不得自动连带改写人物记忆、关系历史、物品数量、过去经历或其他事实域。
允许出现新的普通环境、角色和小插曲，但必须服务当前行动与长期方向，规模克制。
一回合是连续互动中的一个可回应片段，不是必须独立完整的章节。慢叙事与标准叙事不得为了“写完整”继续补写余波、转场、下一项安排或总结式收束；一旦玩家已有自然的观察、回应、选择或改变行动的机会，就应适时交还控制权。细致不等于堆叠重复感官、心理活动或同义描写。
到达stopBoundary后立即停止，不多写一步，不输出分析或JSON。`;
}

const plannerPostDirectorAgency = `玩家输入为导演指令，CURRENT_STORY按该指令实际发生；不得因其偏离世界规律或原路线而将其判定为冲突或需要修正。`;

function buildPlannerPostSystem(director: boolean): string {
  return `你是互动小说的写后审计与状态提交 Agent。你不是作者，不续写故事，不规划下一幕，不扮演角色。只依据本次提供的CURRENT_TURN_INPUT与CURRENT_STORY结算本回合，只输出严格 JSON（json object）。
绝对禁止引用其他回合的玩家要求来填充本回合冲突。摘要、进度和Patch必须是CURRENT_STORY已经明确发生的内容；“准备、考虑、计划、可能”不能记为已完成行动。
玩家偏离原路线不是冲突。conflicts只记录CURRENT_STORY内部无法同时成立的硬事实，供后续模型修正；程序不会因为路线偏离而拒绝故事。
${director ? plannerPostDirectorAgency : ''}
每轮必须更新destiny，但只更新实际变化的故事节。故事完成度是当前全部事件与人物状态距离预设结尾的综合估值，可上升也可下降，不是累计积分。completionEstimate直接输出0到100的当前估值，并用completionReason说明已满足和仍缺少的核心结尾条件。
故事节状态含义：pending未到条件；available条件成熟；active正在发生；satisfied核心功能已由正文满足；weakened已满足结果被后续削弱；reframed因路线变化需换实现方式；superseded已由等价故事节承担。
satisfied不是“提到过标题”或“计划过”的标记，只有当CURRENT_STORY实际实现了该故事节的purpose（叙事功能），并能用正文原句证明时才可使用。只完成了铺垫、绕开、切断、改走其他路径时，不得标记satisfied，应使用active、weakened或reframed，并说明当前实现/缺口。已satisfied的故事节不得无理由回退为active、available或pending；若后续正文确实削弱已实现结果，只能使用weakened或reframed，并提供直接证据和原因。beatChanges只提交本轮发生变化的故事节，不重抄全部。
玩家改变路线时优先reframed并更新currentPlan，不删除命运功能。不要强行拉回旧地点。
若写前计划包含额外随机事件要求，只有正文已经实际发生了对应事件时randomEvent.handled才为true；计划留到下一回合时保持false。
characters、relationships、inventory、threads、facts全部是增量Patch，不得重抄完整状态。没有变化必须输出空数组。
必须复用权威状态中已有ID。新对象ID使用稳定、简短、语义化的小写ASCII ID；同一对象后续永远复用该ID。
relationships只能使用fromId/toId/affinityDelta/label/note/reason。affinityDelta每回合范围-20到20；只有正文出现实际关系变化才提交。
facts只保存正文新确认、且需要跨回合保持一致的长期硬事实（例如稳定身份、持续关系属性、固定地点/安排、能力边界或已确立的长期设定）。不保存氛围、临时动作、一次性场景细节、短期计划、想法、摘要、推测或已有worldFacts；这类内容即使出现在正文，也不要提交canonical fact。不要把stability写成temporary来绕过筛选，临时事实不进入持久状态。通常每轮只需0到3条，确有多个独立长期设定时才增加；没有新的长期硬事实必须输出空数组。每条必须使用结构化字段；禁止字符串facts，禁止kind/content格式，禁止推测事实。
fact create通用示例：{"op":"create","subjectId":"char-a","predicate":"occupation","value":"医生","scope":"character","stability":"stable","confidence":"explicit","keywords":["职业","工作"],"evidenceQuote":"正文中的直接证据"}。
若CURRENT_STORY越过stopBoundary，canonCheck.stopBoundaryViolated=true；否则为false。该字段仅供审计，不阻止故事提交。`;
}

/** 高优先级注入放在系统提示词最前方。 */
function withRoleInject(baseSystem: string, inject: RoleInjectConfig | undefined): string {
  const text = inject?.enabled ? String(inject.text ?? '').trim() : '';
  return text ? `${text}\n\n${baseSystem}` : baseSystem;
}

const plannerToolDiscipline = `
【上下文查询工具纪律】
当前权威状态足够时不得调用工具。只有需要核对较早的人物、承诺、事件、关系或事实，而当前输入中确实缺少证据时，才调用search_story_context。
查询应使用明确的人名、地点、物品、承诺或事件关键词；通常一次即可，不得为了“更保险”重复搜索。工具轮数上限由玩家设置并由程序强制执行。
工具返回的是历史证据，不是新的设定；worldFacts、canonicalFacts与当前权威状态仍有更高优先级。`;

const plannerContextTool: ChatTool = {
  type: 'function',
  function: {
    name: 'search_story_context',
    description: '仅在当前权威状态不足时，查询较早的故事正文、人物、关系、Canonical facts或故事线程。返回少量带来源的历史证据。',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: '明确的检索关键词，例如人物名、地点、物品、承诺或事件。',
        },
        limit: {
          type: 'integer',
          minimum: 1,
          maximum: 8,
          description: '最多返回多少条证据，默认5，最高8。',
        },
        scope: {
          type: 'string',
          enum: ['all', 'history', 'characters', 'relationships', 'facts', 'threads'],
          description: '限定检索范围，默认all。',
        },
      },
      required: ['query'],
      additionalProperties: false,
    },
  },
};

const postShape = `{
  "schemaVersion":2,
  "commitId":"COMMIT_ID",
  "baseRevision":0,
  "turn":0,
  "roundSummary":"仅总结本轮正文",
  "latestProgress":"正文结束时的真实位置和状态",
  "characters":[{"op":"create|update","id":"stable-id","name":"仅create必填","aliases":[],"role":"","description":"","status":"active","addFacts":[],"reason":"正文证据"}],
  "relationships":[{"fromId":"player","toId":"stable-id","affinityDelta":0,"label":"","note":"","reason":"正文证据"}],
  "inventory":[{"op":"grant|consume|update|remove","id":"existing-or-stable-id","name":"create时使用","kind":"item","quantity":1,"description":"","consumable":false,"reason":"正文证据"}],
  "threads":[{"op":"create|update","id":"stable-id","title":"create时使用","kind":"main|relationship|quest|hook","status":"candidate|active|completed|failed|cancelled","progress":0,"currentStep":"","involvedCharacterIds":[],"note":"","reason":"正文证据"}],
  "facts":[{"op":"create|replace","subjectId":"stable-subject-id","predicate":"stable-predicate","value":"跨回合长期明确值","scope":"character|relationship|location|world|schedule|identity|custom","stability":"core|stable","confidence":"explicit","keywords":[],"evidenceQuote":"正文原句","reason":"replace时必填"}],
  "scene":null,
  "actions":[],
  "uncertainties":[],
  "destiny":{"completionEstimate":0,"completionReason":"当前事件与最终结尾的距离依据","currentActId":"","currentStage":"","currentPath":"","nextMilestone":"","convergencePlan":"","endingReached":false,"reason":"本轮正文如何影响预设命运","beatChanges":[{"beatId":"existing-beat-id","status":"pending|available|active|satisfied|weakened|reframed|superseded","currentPlan":"当前路径下的实现方式或尚缺条件","evidenceSummary":"正文如何实现故事节purpose，而非只提到标题","evidenceQuote":"状态变化的正文原句","replacementBeatId":"","reason":"状态变化理由"}]},
  "randomEvent":{"handled":false,"note":""},
  "canonCheck":{"respectedFacts":[],"newInferences":[],"conflicts":[],"stopBoundaryViolated":false}
}`;

function relevantFacts(p: TurnRequestV2) {
  const currentText = `${p.input}\n${p.state.history.slice(-6).map((x) => x.content).join('\n')}`.toLowerCase();
  return (p.state.facts ?? []).filter((f) => f.stability !== 'temporary' && (f.stability === 'core' || f.updatedAtTurn >= p.state.turn - 4 || f.keywords.some((k) => currentText.includes(k.toLowerCase())))).slice(0, 40);
}

type ContextSearchScope = 'all' | 'history' | 'characters' | 'relationships' | 'facts' | 'threads';

interface ContextSearchCandidate {
  source: Exclude<ContextSearchScope, 'all'>;
  id: string;
  turn?: number;
  label: string;
  evidence: string;
  searchable: string;
}

function clipContextEvidence(value: unknown, max = 900) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function contextSearchTerms(query: string) {
  const normalized = query.toLowerCase().trim();
  const pieces = normalized
    .split(/[\s,，。；;、:：!?！？"“”'‘’()（）[\]【】]+/)
    .map((part) => part.trim())
    .filter((part) => part.length >= 2);
  return { normalized, terms: [...new Set(pieces)].slice(0, 10) };
}

function contextSearchCandidates(p: TurnRequestV2): ContextSearchCandidate[] {
  const characterNames = new Map(p.state.characters.map((character) => [
    character.id,
    character.name || character.id,
  ]));
  return [
    ...p.state.history.map((message) => ({
      source: 'history' as const,
      id: message.id,
      turn: message.turn,
      label: message.role === 'user' ? '玩家输入' : '故事正文',
      evidence: clipContextEvidence(message.content),
      searchable: message.content,
    })),
    ...p.state.characters.map((character) => {
      const evidence = [
        `${character.name}（${character.id}）`,
        character.aliases.length ? `别名：${character.aliases.join('、')}` : '',
        character.role ? `角色：${character.role}` : '',
        character.description ?? '',
        character.knownFacts.length ? `已知事实：${character.knownFacts.join('；')}` : '',
        `状态：${character.status}`,
      ].filter(Boolean).join('；');
      return {
        source: 'characters' as const,
        id: character.id,
        turn: character.lastSeenTurn,
        label: `人物：${character.name}`,
        evidence: clipContextEvidence(evidence),
        searchable: evidence,
      };
    }),
    ...p.state.relationships.map((relationship) => {
      const fromName = characterNames.get(relationship.fromId) ?? relationship.fromId;
      const toName = characterNames.get(relationship.toId) ?? relationship.toId;
      const evidence = `${fromName} → ${toName}；好感：${relationship.affinity}；关系：${relationship.label ?? '未标注'}；备注：${relationship.note ?? '无'}`;
      return {
        source: 'relationships' as const,
        id: relationship.id,
        turn: relationship.updatedAtTurn,
        label: `关系：${fromName} / ${toName}`,
        evidence: clipContextEvidence(evidence),
        searchable: `${evidence} ${relationship.fromId} ${relationship.toId}`,
      };
    }),
    ...p.state.facts.filter((fact) => fact.stability !== 'temporary').map((fact) => {
      const evidence = `${fact.subjectId}.${fact.predicate} = ${fact.value}；范围：${fact.scope}；稳定性：${fact.stability}；证据：${fact.evidenceQuote ?? '无原句'}`;
      return {
        source: 'facts' as const,
        id: fact.id,
        turn: fact.evidenceTurn,
        label: `正史事实：${fact.subjectId}.${fact.predicate}`,
        evidence: clipContextEvidence(evidence),
        searchable: `${evidence} ${fact.keywords.join(' ')}`,
      };
    }),
    ...p.state.storyThreads.map((thread) => {
      const involvedNames = thread.involvedCharacterIds.map((id) => characterNames.get(id) ?? id);
      const evidence = `${thread.title}；类型：${thread.kind}；状态：${thread.status}；进度：${thread.progress ?? '未估算'}；当前步骤：${thread.currentStep ?? '无'}；涉及人物：${involvedNames.join('、') || '无'}；备注：${thread.note ?? '无'}`;
      return {
        source: 'threads' as const,
        id: thread.id,
        turn: thread.updatedAtTurn,
        label: `故事线程：${thread.title}`,
        evidence: clipContextEvidence(evidence),
        searchable: `${evidence} ${thread.involvedCharacterIds.join(' ')}`,
      };
    }),
  ];
}

function searchStoryContext(p: TurnRequestV2, args: Record<string, unknown>) {
  const query = String(args.query ?? '').trim().slice(0, 200);
  if (!query) return { error: 'query不能为空。' };
  const requestedScope = String(args.scope ?? 'all') as ContextSearchScope;
  const allowedScopes: ContextSearchScope[] = ['all', 'history', 'characters', 'relationships', 'facts', 'threads'];
  const scope = allowedScopes.includes(requestedScope) ? requestedScope : 'all';
  const numericLimit = Number(args.limit);
  const limit = Number.isFinite(numericLimit) ? Math.max(1, Math.min(8, Math.floor(numericLimit))) : 5;
  const { normalized, terms } = contextSearchTerms(query);

  const results = contextSearchCandidates(p)
    .filter((candidate) => scope === 'all' || candidate.source === scope)
    .map((candidate) => {
      const haystack = `${candidate.label}\n${candidate.searchable}`.toLowerCase();
      let score = haystack.includes(normalized) ? 100 : 0;
      for (const term of terms) {
        if (haystack.includes(term)) score += Math.min(20, 4 + term.length * 2);
      }
      // 在同等文本命中下优先返回结构化硬状态，再用最近回合作为次级排序。
      if (score > 0 && candidate.source === 'facts') score += 4;
      if (score > 0 && candidate.source !== 'history') score += 2;
      return { candidate, score };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || (b.candidate.turn ?? -1) - (a.candidate.turn ?? -1))
    .slice(0, limit)
    .map(({ candidate }) => ({
      source: candidate.source,
      id: candidate.id,
      ...(candidate.turn !== undefined ? { turn: candidate.turn } : {}),
      label: candidate.label,
      evidence: candidate.evidence,
    }));

  return {
    query,
    scope,
    resultCount: results.length,
    results,
    note: results.length
      ? '返回内容是既有故事证据；请与当前权威状态、worldFacts和canonicalFacts共同判断。'
      : '没有找到匹配证据。不要据此编造历史；可改用更短、更明确的人名或事件关键词再查询一次。',
  };
}

const DEFAULT_PLANNER_CONTEXT_TOKENS = 16_000;
const STORY_RECENT_MESSAGE_COUNT = 8;

/**
 * 只用于近期正文的软预算，不试图精确复刻任一供应商的 tokenizer。
 * 中文、日文、韩文大致按一字符一 token，其他文本按约四字符一 token，
 * 再为消息角色和 JSON 包装预留少量开销。
 */
function estimateMessageTokens(message: TurnRequestV2['state']['history'][number]) {
  const text = String(message.content ?? '');
  const cjkCount = (text.match(/[\u3400-\u9fff\uf900-\ufaff\u3040-\u30ff\uac00-\ud7af]/g) ?? []).length;
  const otherCount = Math.max(0, text.length - cjkCount);
  return Math.max(1, cjkCount + Math.ceil(otherCount / 4) + 16);
}

function plannerContextTokenBudget(p: TurnRequestV2) {
  // 兼容设置字段尚不存在的存档；非法值回到标准档，而不是裁空上下文。
  const configured = Number((p.settings as typeof p.settings & { plannerContextTokens?: number }).plannerContextTokens);
  return Number.isFinite(configured) && configured > 0
    ? Math.max(1_000, Math.floor(configured))
    : DEFAULT_PLANNER_CONTEXT_TOKENS;
}

function recentHistoryWithinBudget(p: TurnRequestV2, tokenBudget: number) {
  const selected: TurnRequestV2['state']['history'] = [];
  let used = 0;
  for (let index = p.state.history.length - 1; index >= 0; index -= 1) {
    const message = p.state.history[index];
    const cost = estimateMessageTokens(message);
    // 软预算始终保留最新一条完整消息，避免一个较长的最近回合反而完全消失。
    if (selected.length > 0 && used + cost > tokenBudget) break;
    selected.push(message);
    used += cost;
  }
  return selected.reverse();
}

function snapshot(p: TurnRequestV2, recent: TurnRequestV2['state']['history']) {
  return JSON.stringify({
    mode: p.state.mode,
    narrativePace: p.state.narrativePace,
    turn: p.state.turn,
    revision: p.state.revision,
    summary: p.state.summary,
    progress: p.state.latestProgress,
    scene: p.state.currentScene,
    characters: p.state.characters,
    relationships: p.state.relationships,
    inventory: p.state.inventory,
    threads: p.state.storyThreads,
    destiny: p.state.destiny,
    randomEvent: p.state.randomEvent,
    canonicalFacts: relevantFacts(p),
    recent,
  });
}

function stableStoryContext(p: TurnRequestV2) {
  return JSON.stringify({ outline: p.outline, background: p.background, worldFacts: (p.worldFacts ?? []).slice(0, 20) });
}

function paceInstruction(p: TurnRequestV2) {
  const instructions = {
    slow: '慢叙事：本轮只展开一个微小而连续的故事节拍，例如一次关键动作、短暂观察或一小段对话。细致呈现真正发生的变化，但不要用重复心理、感官或环境描写人为拉长。停在最早的自然回应点，把动作结果、他人反应或下一步选择留给玩家继续参与。节奏不是硬字数限制。',
    standard: '标准叙事：本轮聚焦玩家的一次主要行动或一个连续场景，只推进到该行动产生明确反馈、玩家可以再次回应的位置。不要把反馈之后的余波、转场、下一场互动和后续决定一并写完；即使它们顺理成章，也应留给下一回合。不要写成包含完整事件链的独立短篇，节奏不是硬字数限制。',
    fast: '快叙事：本轮以事件发展为单位，可以推进一组直接相关的行动，概括次要过程并展开关键互动。速度指事件数量与故事时间跨度，不限制必要描写篇幅。',
    timeskip: '时间跨越叙事：本轮允许跨越数天或更久，概述重复日常，重点展开命运节点、关系变化与关键结果。字数由需要保留的关键节点决定。',
  } as const;
  return instructions[p.state.narrativePace] ?? instructions.standard;
}

function randomEventInstruction(p: TurnRequestV2) {
  const due = p.state.randomEvent.pending || p.state.turn >= p.state.randomEvent.nextTriggerTurn;
  if (!due) return '';
  const instructions = {
    related: '---额外---：在本回合或下回合自然插入一个与当前故事严格相关的随机事件。事件必须联系当前角色、环境、关系或active/available故事节，不能是无关装饰。',
    progress: '---额外---：在本回合或下回合自然插入一个与当前故事严格相关的随机事件。该事件必须推进active故事节，或为available故事节创造自然条件，不能只是一次性插曲。',
    destiny: '---额外---：在本回合或下回合自然插入一个与当前故事严格相关的随机事件。该事件必须推进核心故事节、为reframed故事节找到新实现形式，或推进最终结尾条件。',
  } as const;
  return `${instructions[p.state.randomEvent.intensity]} 随机事件同样服从当前叙事速度：慢叙事或标准叙事可以只让事件自然出现或推进一小步，不必在本回合解决完整事件。`;
}

export function normalizeDestinyPatch(raw: unknown, warnings: PatchWarningV2[]): TurnPatchV2['destiny'] {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const source = raw as Record<string, unknown>;
  const destiny = { ...source } as NonNullable<TurnPatchV2['destiny']>;
  const completionReason = String(source.completionReason ?? '').trim();
  if (!String(source.reason ?? '').trim()) {
    destiny.reason = completionReason
      ? `程序根据完成度说明补全：${completionReason.slice(0, 180)}`
      : '程序补全：规划模型提交了命运状态变化，但遗漏了总更新理由。';
    warnings.push({
      code: 'destiny_reason_defaulted',
      path: 'destiny.reason',
      message: '规划模型遗漏 destiny.reason；程序已生成通用理由，其余合法命运字段仍会提交。',
    });
  }

  destiny.beatChanges = (Array.isArray(source.beatChanges) ? source.beatChanges : [])
    .filter((change): change is Record<string, unknown> => !!change && typeof change === 'object' && !Array.isArray(change))
    .map((change, index) => {
      const normalized = { ...change } as NonNullable<NonNullable<TurnPatchV2['destiny']>['beatChanges']>[number];
      if (!String(change.reason ?? '').trim()) {
        const evidence = String(change.evidenceSummary ?? change.currentPlan ?? '').trim();
        normalized.reason = evidence
          ? `程序根据节拍说明补全：${evidence.slice(0, 180)}`
          : '程序补全：规划模型提交了故事节变化，但遗漏了变化理由。';
        warnings.push({
          code: 'beat_reason_defaulted',
          path: `destiny.beatChanges[${index}].reason`,
          message: `故事节 ${String(change.beatId ?? 'unknown')} 遗漏 reason；程序已生成通用理由，该条其余合法字段仍会提交。`,
        });
      }
      return normalized;
    });
  return destiny;
}

function asPatch(raw: unknown, p: TurnRequestV2, commitId: string, story: string): TurnPatchV2 {
  const data = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
  const warnings: PatchWarningV2[] = [];
  const list = (key: string) => Array.isArray(data[key]) ? data[key] : [];
  const canon = data.canonCheck && typeof data.canonCheck === 'object' && !Array.isArray(data.canonCheck)
    ? data.canonCheck as Record<string, unknown> : {};
  const patch: TurnPatchV2 = {
    ...data,
    schemaVersion: 2,
    commitId,
    baseRevision: p.state.revision,
    turn: p.state.turn,
    roundSummary: String(data.roundSummary ?? story.slice(0, 240)),
    latestProgress: String(data.latestProgress ?? data.roundSummary ?? ''),
    characters: list('characters') as TurnPatchV2['characters'],
    relationships: list('relationships') as TurnPatchV2['relationships'],
    inventory: list('inventory') as TurnPatchV2['inventory'],
    threads: list('threads') as TurnPatchV2['threads'],
    facts: list('facts') as TurnPatchV2['facts'],
    actions: list('actions') as TurnPatchV2['actions'],
    uncertainties: list('uncertainties') as string[],
    warnings,
    canonCheck: {
      respectedFacts: Array.isArray(canon.respectedFacts) ? canon.respectedFacts.map(String) : [],
      newInferences: Array.isArray(canon.newInferences) ? canon.newInferences.map(String) : [],
      conflicts: Array.isArray(canon.conflicts) ? canon.conflicts.map(String) : [],
      stopBoundaryViolated: canon.stopBoundaryViolated === true,
    },
    destiny: normalizeDestinyPatch(data.destiny, warnings),
    randomEvent: data.randomEvent && typeof data.randomEvent === 'object' && !Array.isArray(data.randomEvent) ? data.randomEvent as TurnPatchV2['randomEvent'] : undefined,
  };
  return patch;
}

const phaseLabels: Record<ModelPhaseV2, string> = {
  planner_pre: '规划模型正在分析本回合',
  story: '故事模型正在生成正文',
  planner_post: '规划模型正在结算故事状态',
};

function safelyNotify(fn: (() => void) | undefined) {
  if (!fn) return;
  try { fn(); } catch { /* 展示层回调不能中断模型生成。 */ }
}

function emitActivity(p: TurnRequestV2, activity: ModelActivityV2) {
  safelyNotify(() => p.onModelActivity?.(activity));
}

function emitPhase(
  p: TurnRequestV2,
  phase: ModelPhaseV2,
  model: string,
  status: ModelPhaseStatusV2,
  error?: unknown,
  toolsEnabled = false,
) {
  safelyNotify(() => p.onPhaseChange?.(phase, status));
  emitActivity(p, {
    type: 'phase',
    phase,
    status,
    model,
    label: phaseLabels[phase],
    toolsEnabled,
    ...(error ? { error: error instanceof Error ? error.message : String(error) } : {}),
  });
}

function emitToolActivity(
  p: TurnRequestV2,
  phase: Extract<ModelPhaseV2, 'planner_pre' | 'planner_post'>,
  model: string,
  activity: ChatToolActivity,
) {
  emitActivity(p, {
    type: 'tool',
    phase,
    model,
    status: activity.phase,
    callId: activity.call.id,
    toolName: activity.call.name,
    ...(activity.phase === 'call' ? { argumentsText: activity.call.argumentsText } : {}),
    ...(activity.phase === 'result' ? { resultText: activity.resultText ?? '' } : {}),
  });
}

function plannerToolHandler(p: TurnRequestV2, maxCalls: number) {
  let calls = 0;
  return async (call: ChatToolInvocation) => {
    calls += 1;
    if (calls > maxCalls) return { error: `本阶段工具调用已达到玩家设置的上限（${maxCalls}次），请直接基于现有证据完成任务。` };
    if (call.name !== 'search_story_context') {
      return { error: `未知工具：${call.name}` };
    }
    return searchStoryContext(p, call.arguments);
  };
}

function emitThinking(p: TurnRequestV2, phase: ModelPhaseV2, model: string, text: string) {
  if (!text) return;
  safelyNotify(() => p.onModelThinkingDelta?.(phase, text));
  emitActivity(p, { type: 'thinking_delta', phase, model, text });
}

function emitOutput(p: TurnRequestV2, phase: ModelPhaseV2, model: string, text: string) {
  if (!text) return;
  emitActivity(p, { type: 'output_delta', phase, model, text });
}

function emitPatchWarnings(p: TurnRequestV2, model: string, warnings: PatchWarningV2[] | undefined) {
  for (const warning of warnings ?? []) {
    // 警告同时进入活动流和开发者控制台：玩家可观察，测试报告也能从返回Patch读取。
    console.warn(`[V2 patch] ${warning.path}: ${warning.message}`);
    emitActivity(p, { type: 'warning', phase: 'planner_post', model, ...warning });
  }
}

function emitUsage(p: TurnRequestV2, phase: ModelPhaseV2, model: string, usage: LlmUsage | undefined) {
  if (!usage) return;
  emitActivity(p, { type: 'usage', phase, model, usage });
}

function ensureModelResult(phase: ModelPhaseV2, result: { text?: string; finishReason?: string }) {
  const label = phaseLabels[phase];
  if (!String(result.text ?? '').trim()) throw new Error(`${label}失败：模型返回了空内容，请重试本回合。`);
  if (result.finishReason === 'length' || result.finishReason === 'max_tokens') {
    throw new Error(`${label}失败：模型输出达到上限而被截断，未提交本回合状态。`);
  }
  if (result.finishReason === 'content_filter') throw new Error(`${label}失败：模型内容过滤中止了输出。`);
}

export async function runTurnV2(p: TurnRequestV2) {
  const cfg = { baseUrl: p.settings.apiBaseUrl, apiKey: p.settings.apiKey, format: p.settings.apiFormat };
  const plannerModel = resolvePlannerModel(p.settings);
  const storyModel = resolveStoryModel(p.settings);
  // 当前工具循环由 Chat Completions 消息协议承载；Responses 模式保持无工具，
  // 避免设置开启后向不支持该链路的格式发送虚假工具声明。
  const plannerToolsEnabled = p.settings.plannerToolsEnabled === true && p.settings.apiFormat === 'chat';
  const plannerToolMaxCalls = Math.max(1, Math.min(6, Math.round(Number(p.settings.plannerToolMaxCalls) || 2)));
  let isOfficialDeepSeek = /api\.deepseek\.com/i.test(p.settings.apiBaseUrl);
  try { isOfficialDeepSeek ||= /(^|\.)deepseek\.com$/i.test(new URL(p.settings.apiBaseUrl).hostname); } catch { /* 由LLM客户端负责报告无效URL */ }
  const plannerJsonEnabled = p.settings.apiFormat === 'chat' && (p.settings.plannerJsonMode === 'enabled' || (p.settings.plannerJsonMode === 'auto' && isOfficialDeepSeek));
  const thinking = p.settings.thinkingMode === 'enabled' ? 'enabled' as const : p.settings.thinkingMode === 'disabled' ? 'disabled' as const : undefined;
  const reasoningEffort = isOfficialDeepSeek && p.settings.thinkingMode !== 'disabled' ? p.settings.reasoningEffort : undefined;
  const roleInjects = p.settings.roleInjects;
  // 导演视角只在执笔模式下生效；游历模式仍按玩家行动处理。
  const directorPerspective = p.state.mode === 'author' && p.settings.inputPerspective === 'director';
  // 规划角色有长期上下文，高优先级注入只在存档第一次规划调用时生效一次。
  const shouldInjectPlanner = !!roleInjects?.planner?.enabled
    && !!String(roleInjects.planner.text ?? '').trim()
    && !p.state.plannerInjectApplied;
  const plannerPrePrompt = withRoleInject(
    `${buildPlannerPreSystem(directorPerspective)}${plannerToolsEnabled ? plannerToolDiscipline : ''}`,
    shouldInjectPlanner ? roleInjects.planner : undefined,
  );
  const storyPrompt = withRoleInject(buildStorySystem(directorPerspective), roleInjects?.story);
  const plannerPostPrompt = withRoleInject(
    `${buildPlannerPostSystem(directorPerspective)}${plannerToolsEnabled ? plannerToolDiscipline : ''}`,
    roleInjects?.post,
  );
  // 规划模型的近期原文由设置中的软 token 预算控制；摘要、世界书、
  // 结构化状态和大纲不在该预算内，始终完整注入。
  const plannerAuthority = snapshot(p, recentHistoryWithinBudget(p, plannerContextTokenBudget(p)));
  // 故事模型保持原有、稳定的最近四回合窗口，不跟随规划上下文设置缩放。
  const storyAuthority = snapshot(p, p.state.history.slice(-STORY_RECENT_MESSAGE_COUNT));
  const stableContext = stableStoryContext(p);
  const preMessages: ChatMessage[] = [
    { role: 'system', content: plannerPrePrompt },
    { role: 'user', content: `【STABLE_STORY_CONTEXT】${stableContext}` },
    { role: 'user', content: `【AUTHORITATIVE_STATE】${plannerAuthority}\n【CURRENT_TURN_INPUT】${p.input}\n【NARRATIVE_PACE】${paceInstruction(p)}\n${randomEventInstruction(p)}\n只输出 {"intent":"","currentAct":"","activeBeatIds":[],"destinyProgress":"","pathChange":"","reframingNeeded":[],"reconvergencePlan":"","nextStoryFunction":"","writingBrief":"","hardConstraints":[],"creativeSpace":[],"forbiddenChanges":[],"stopBoundary":""}` },
  ];
  emitPhase(p, 'planner_pre', plannerModel, 'started', undefined, plannerToolsEnabled);
  let pre;
  try {
    pre = await chatJSONDetailed(cfg, {
      model: plannerModel,
      temperature: .25,
      messages: preMessages,
      signal: p.signal,
      ...(plannerJsonEnabled ? { responseFormat: 'json_object' as const } : {}),
      ...(thinking ? { thinking } : {}),
      ...(reasoningEffort ? { reasoningEffort } : {}),
      ...(plannerToolsEnabled ? {
        tools: [plannerContextTool],
        toolChoice: 'auto' as const,
        maxToolRounds: plannerToolMaxCalls,
        onToolCall: plannerToolHandler(p, plannerToolMaxCalls),
        onToolActivity: (activity: ChatToolActivity) => emitToolActivity(p, 'planner_pre', plannerModel, activity),
      } : {}),
      onThinkingDelta: (text) => emitThinking(p, 'planner_pre', plannerModel, text),
      onDelta: (text) => emitOutput(p, 'planner_pre', plannerModel, text),
    });
    ensureModelResult('planner_pre', pre);
    emitUsage(p, 'planner_pre', plannerModel, pre.usage);
    emitPhase(p, 'planner_pre', plannerModel, 'completed', undefined, plannerToolsEnabled);
  } catch (error) {
    emitPhase(p, 'planner_pre', plannerModel, 'failed', error, plannerToolsEnabled);
    throw error;
  }
  const brief = extractJSON(pre.text) as any;

  emitPhase(p, 'story', storyModel, 'started');
  let story;
  try {
    story = await chatStreamDetailed(cfg, {
      model: storyModel,
      temperature: p.settings.temperatureStory,
      maxTokens: p.settings.storyMaxTokens || undefined,
      signal: p.signal,
      ...(thinking ? { thinking } : {}),
      ...(reasoningEffort ? { reasoningEffort } : {}),
      messages: [
        { role: 'system', content: storyPrompt },
        { role: 'user', content: `【STABLE_STORY_CONTEXT】${stableContext}` },
        { role: 'user', content: `【AUTHORITATIVE_STATE】${storyAuthority}\n【CURRENT_TURN_INPUT】${p.input}\n【NARRATIVE_PACE】${paceInstruction(p)}\n${randomEventInstruction(p)}\n【currentAct】${brief.currentAct || ''}\n【activeBeatIds】${JSON.stringify(brief.activeBeatIds ?? [])}\n【destinyProgress】${brief.destinyProgress || ''}\n【pathChange】${brief.pathChange || ''}\n【reframingNeeded】${JSON.stringify(brief.reframingNeeded ?? [])}\n【reconvergencePlan】${brief.reconvergencePlan || ''}\n【nextStoryFunction】${brief.nextStoryFunction || ''}\n【writingBrief】${brief.writingBrief || brief.intent}\n【hardConstraints】${JSON.stringify(brief.hardConstraints ?? [])}\n【creativeSpace】${JSON.stringify(brief.creativeSpace ?? [])}\n【forbiddenChanges】${JSON.stringify(brief.forbiddenChanges ?? [])}\n【STOP_BOUNDARY】${brief.stopBoundary || '停在需要玩家继续决定的位置'}` },
      ],
      onThinkingDelta: (text) => emitThinking(p, 'story', storyModel, text),
      onDelta: (text) => {
        safelyNotify(() => p.onStoryDelta?.(text));
        emitOutput(p, 'story', storyModel, text);
      },
    });
    ensureModelResult('story', story);
    emitUsage(p, 'story', storyModel, story.usage);
    emitPhase(p, 'story', storyModel, 'completed');
  } catch (error) {
    emitPhase(p, 'story', storyModel, 'failed', error);
    throw error;
  }

  const commitId = genId('commit');
  const postMessages: ChatMessage[] = [
    { role: 'system', content: plannerPostPrompt },
    { role: 'user', content: `【STABLE_STORY_CONTEXT】${stableContext}` },
    { role: 'user', content: `【TURN_ID】${p.state.turn}:${commitId}\n【AUTHORITATIVE_STATE_BEFORE_TURN】${plannerAuthority}\n【CURRENT_TURN_INPUT】${p.input}\n【CURRENT_WRITE_PLAN】${JSON.stringify(brief)}\n【CURRENT_STOP_BOUNDARY】${brief.stopBoundary || ''}\n【CURRENT_STORY】${story.text}\n${p.state.mode === 'author' ? 'author模式：actions必须为空数组。' : 'adventure模式：生成2到4个actions。'}\n严格按下列结构输出；所有数组元素必须是对象，不得用字符串代替Patch：\n${postShape.replace('COMMIT_ID', commitId).replace('"baseRevision":0', `"baseRevision":${p.state.revision}`).replace('"turn":0', `"turn":${p.state.turn}`)}` },
  ];
  emitPhase(p, 'planner_post', plannerModel, 'started', undefined, plannerToolsEnabled);
  let post;
  try {
    post = await chatJSONDetailed(cfg, {
      model: plannerModel,
      temperature: .1,
      messages: postMessages,
      signal: p.signal,
      ...(plannerJsonEnabled ? { responseFormat: 'json_object' as const } : {}),
      ...(thinking ? { thinking } : {}),
      ...(reasoningEffort ? { reasoningEffort } : {}),
      ...(plannerToolsEnabled ? {
        tools: [plannerContextTool],
        toolChoice: 'auto' as const,
        maxToolRounds: plannerToolMaxCalls,
        onToolCall: plannerToolHandler(p, plannerToolMaxCalls),
        onToolActivity: (activity: ChatToolActivity) => emitToolActivity(p, 'planner_post', plannerModel, activity),
      } : {}),
      onThinkingDelta: (text) => emitThinking(p, 'planner_post', plannerModel, text),
      onDelta: (text) => emitOutput(p, 'planner_post', plannerModel, text),
    });
    ensureModelResult('planner_post', post);
    emitUsage(p, 'planner_post', plannerModel, post.usage);
    emitPhase(p, 'planner_post', plannerModel, 'completed', undefined, plannerToolsEnabled);
  } catch (error) {
    emitPhase(p, 'planner_post', plannerModel, 'failed', error, plannerToolsEnabled);
    throw error;
  }
  const patch = asPatch(extractJSON(post.text), p, commitId, story.text);
  emitPatchWarnings(p, plannerModel, patch.warnings);
  const next = commitTurnPatchV2(p.state, patch);
  const now = Date.now();
  next.history = [...p.state.history,
    { id: genId('msg'), role: 'user', content: p.input, turn: p.state.turn, createdAt: now },
    { id: genId('msg'), role: 'assistant', content: story.text, turn: p.state.turn, createdAt: now },
  ];
  next.turn = p.state.turn + 1;
  next.phase = 'input';
  if (shouldInjectPlanner) next.plannerInjectApplied = true;
  return { state: next, story: story.text, brief, patch, usage: { pre: pre.usage, story: story.usage, post: post.usage } };
}
