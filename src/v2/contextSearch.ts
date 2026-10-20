/**
 * 规划模型上下文检索工具（`search_story_context`）的纯函数实现。
 *
 * 从 `engine.ts` 抽出来的原因：检索的分词、候选构建、证据切片与排序都属于
 * "可独立验证的文本处理"，混在回合执行里既难单测也难调参。本模块不 import engine，
 * 只依赖 `GameStateV2` 的类型，因此可以被引擎与测试同时复用。
 *
 * 设计目标（对应 docs/known-issues.md L/M/N）：
 * - 分词：CJK 整段 + bigram 展开，剔除停用词；中文单字只在词本身就是单字时保留；
 *   拉丁词要求长度 ≥ 2；全角转半角、统一小写。最多 12 个词。
 * - 证据：默认 500 字（原 900 字偏长）。命中点落在截断点之后时以命中位置为中心切片，
 *   避免"查到了却看到一段无关开头"。
 * - 排序：整串命中 (+100) 优先，覆盖率 ×60，逐词权重随长度小幅增加；
 *   结构化来源只保留很小的加成（facts +3、其他非 history +1），不再压过更相关的正文。
 * - 结果：同一来源最多 2 条、按 (source,label,evidence) 去重、截到 limit，
 *   并回传 matchedTerms/score 供模型判断可信度。
 *
 * 工具名、参数与返回顶层字段（query/scope/resultCount/results/note）保持向后兼容。
 */
import type { GameStateV2 } from './types';

/** 检索范围；`all` 表示不限制。 */
export type ContextSearchScope = 'all' | 'history' | 'characters' | 'relationships' | 'facts' | 'threads';

export const CONTEXT_SEARCH_SCOPES: readonly ContextSearchScope[] = [
  'all',
  'history',
  'characters',
  'relationships',
  'facts',
  'threads',
];

/** 单次查询最多保留多少个检索词；超过后按出现顺序截断。 */
export const CONTEXT_SEARCH_MAX_TERMS = 12;
/** 查询原文最多保留多少字符（超出部分不参与分词，避免超长输入拖慢/污染提示）。 */
export const CONTEXT_SEARCH_MAX_QUERY_CHARS = 200;
/** 单条证据默认截取长度（原实现 900 字偏长，500 字已足够模型判断）。 */
export const CONTEXT_EVIDENCE_MAX_CHARS = 500;
/** 工具默认返回条数与上限（与工具参数 schema 的 1..8 保持一致）。 */
export const CONTEXT_SEARCH_DEFAULT_LIMIT = 5;
export const CONTEXT_SEARCH_MAX_LIMIT = 8;
/** 同一来源最多返回几条：避免 5 条结果全来自同一段长正文。 */
export const CONTEXT_SEARCH_SOURCE_LIMIT = 2;
/** 整串（normalized query）命中时的一次性加分。 */
export const CONTEXT_WHOLE_QUERY_BONUS = 100;
/** 命中覆盖率（命中词数 / 总词数）的满分权重。 */
export const CONTEXT_COVERAGE_WEIGHT = 60;
/**
 * 来源小加成：只作为"命中强度接近时"的次级倾向。
 * 早期实现给 facts +4、所有非 history +2，会让内容恰好等于查询词的正文排到 facts 之后
 * （docs/known-issues.md N），因此这里把权重压到"几乎不影响相关性排序"的量级。
 */
export const CONTEXT_SOURCE_BONUS: Readonly<Record<Exclude<ContextSearchScope, 'all'>, number>> = {
  history: 0,
  facts: 3,
  characters: 1,
  relationships: 1,
  threads: 1,
};

/** 常见虚词 / 口语词：不参与评分，避免 "我 的 他们" 这类查询把整篇正文都算作命中。 */
export const CONTEXT_SEARCH_STOPWORDS: readonly string[] = [
  '的', '了', '是', '在', '和', '与', '就', '都', '也',
  '我', '你', '他', '她', '它', '这', '那', '哪', '谁',
  '什么', '怎么', '怎样', '为什么', '为何', '哪里', '哪儿', '是否',
  '吗', '呢', '吧', '啊', '呀', '么',
  '然后', '因为', '所以', '但是', '如果', '还是', '只是', '不是', '没有', '一个',
  '可以', '我们', '你们', '他们', '她们', '它们', '自己',
  '现在', '刚才', '已经', '其实', '真的', '一直', '一下', '一些', '有点',
  '以及', '而且', '或者', '不过', '这个', '那个', '这里', '那里',
  '请问', '帮我', '帮忙',
];

/** 单字停用词：单字 CJK 片段只有"本身不是停用字"时才保留（单字人名/地名仍可查）。 */
const STOPWORD_CHARS = new Set(
  [...'的了是在和与就都也我你他她它这那哪谁吗呢吧啊呀么着过把被让给从又很太更再还去来说想要会能有没不个些什怎为如然后现已只可们自一'],
);

const STOPWORD_SET = new Set(CONTEXT_SEARCH_STOPWORDS);
const CJK_RUN = /[\u3400-\u9fff\uf900-\ufaff\u3040-\u30ff\uac00-\ud7af]/;
const QUERY_RUN_PATTERN = /[a-z0-9]+|[\u3400-\u9fff\uf900-\ufaff\u3040-\u30ff\uac00-\ud7af]+/g;

/** 工具返回的既有证据提示（保持旧文案，避免模型侧行为漂移）。 */
export const CONTEXT_SEARCH_EVIDENCE_NOTE = '返回内容是既有故事证据；请与当前权威状态、worldFacts和canonicalFacts共同判断。';
/** 0 结果提示：比旧文案更具体，给出可立即执行的下一步。 */
export const CONTEXT_SEARCH_EMPTY_NOTE =
  '没有找到匹配证据。不要据此编造历史；可尝试更短、更明确的人名、地点或事件关键词（中文单字人名也可以），或改用 scope=all / 换一个来源（history、characters、relationships、facts、threads）再查一次。';

export interface ParsedSearchQuery {
  /** 去首尾空白并按上限截断后的查询原文，原样回显给模型。 */
  raw: string;
  /** 全角转半角、小写、空白折叠后的查询串。 */
  normalized: string;
  /** 去重、去停用词后的检索词（最多 CONTEXT_SEARCH_MAX_TERMS 个）。 */
  terms: string[];
}

export interface ContextSearchCandidate {
  source: Exclude<ContextSearchScope, 'all'>;
  id: string;
  turn?: number;
  label: string;
  evidence: string;
  /** 参与评分用的完整文本（可以比 evidence 长；被窗口切掉的正文仍可命中）。 */
  searchable: string;
}

export interface ContextSearchScore {
  score: number;
  matchedTerms: string[];
  /** 命中词数 / 总词数，0..1（保留两位小数）。 */
  coverage: number;
}

export interface ContextSearchResult extends ContextSearchScore {
  source: ContextSearchCandidate['source'];
  id: string;
  turn?: number;
  label: string;
  evidence: string;
}

/** 工具返回里的单条结果：在旧字段之外增加 matchedTerms/score。 */
export interface ContextSearchResultPayload {
  source: ContextSearchCandidate['source'];
  id: string;
  turn?: number;
  label: string;
  evidence: string;
  matchedTerms: string[];
  score: number;
}

export interface ContextSearchResponse {
  query: string;
  scope: ContextSearchScope;
  resultCount: number;
  results: ContextSearchResultPayload[];
  note: string;
}

export interface ContextSearchOptions {
  scope?: unknown;
  limit?: unknown;
}

/** 全角 ASCII → 半角；全角空格 → 普通空格。对超长输入也只做一次线性扫描。 */
function toHalfWidth(text: string): string {
  let out = '';
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    if (code === 0x3000) out += ' ';
    else if (code >= 0xff01 && code <= 0xff5e) out += String.fromCodePoint(code - 0xfee0);
    else out += char;
  }
  return out;
}

function isStopwordTerm(term: string): boolean {
  if (STOPWORD_SET.has(term)) return true;
  return term.length === 1 && STOPWORD_CHARS.has(term);
}

/**
 * 解析检索词。
 *
 * - trim + 全角转半角 + 小写 + 空白折叠；
 * - 按"连续的 CJK 片段 / 连续的拉丁字母或数字"切分，标点与空白天然成为分隔符；
 * - CJK 片段：整段作为一个词，并生成长度 2 的 bigram（2 字以上）；单字片段只在
 *   该片段本身就是一个字时保留（这样"晴"这类单字人名仍然可查）；
 * - 拉丁词长度 ≥ 2；
 * - 去停用词、去重、最多 12 个词。
 *
 * 坏输入（undefined / null / 数字 / 空串 / 超长串）一律返回空结果或截断结果，不抛错。
 */
export function parseSearchQuery(query: unknown): ParsedSearchQuery {
  const text = typeof query === 'string' ? query : '';
  const raw = text.trim().slice(0, CONTEXT_SEARCH_MAX_QUERY_CHARS);
  const normalized = toHalfWidth(raw).toLowerCase().replace(/\s+/g, ' ').trim();
  const terms: string[] = [];
  // 先过滤停用词再去重/截断：否则前 12 个噪声词会挤掉后面真正的人名地名。
  const push = (term: string) => {
    if (!term || terms.length >= CONTEXT_SEARCH_MAX_TERMS) return;
    if (isStopwordTerm(term) || terms.includes(term)) return;
    terms.push(term);
  };
  for (const run of normalized.match(QUERY_RUN_PATTERN) ?? []) {
    if (CJK_RUN.test(run)) {
      if (run.length === 1) {
        push(run);
        continue;
      }
      push(run);
      for (let index = 0; index + 1 < run.length; index += 1) {
        const bigram = run.slice(index, index + 2);
        // 含虚词/口语停用字的 bigram（如 "在哪"、"的人"）不保留：
        // 整段本身仍作为词保留，所以「自由」「存在」这类词不会因为含停用字而查不到。
        if (STOPWORD_CHARS.has(bigram[0]) || STOPWORD_CHARS.has(bigram[1])) continue;
        push(bigram);
      }
      continue;
    }
    if (run.length >= 2) push(run);
  }
  return { raw, normalized, terms };
}

function normalizeEvidenceWidth(max: unknown): number {
  const numeric = Number(max);
  if (!Number.isFinite(numeric) || numeric <= 0) return CONTEXT_EVIDENCE_MAX_CHARS;
  return Math.max(20, Math.floor(numeric));
}

/**
 * 截取证据文本。
 *
 * `anchors` 是本次查询命中的检索词：命中点落在长文本后段时，只截前 N 字会让返回的
 * "证据"里根本没有查询词（模型只看到一段无关开头，然后误判为查不到）。因此当某个
 * 关键词出现在截断点之后时，改为以该命中位置为中心的窗口切片，并在两端标出省略。
 * 注意锚点必须是**单词**而不是整条 query：文本里通常不存在"晴 地名"这样的连串。
 */
export function clipContextEvidence(
  value: unknown,
  max: number = CONTEXT_EVIDENCE_MAX_CHARS,
  anchors: string[] = [],
): string {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  const width = normalizeEvidenceWidth(max);
  if (!text || text.length <= width) return text;
  const lower = text.toLowerCase();
  let hit = -1;
  let hitLength = 0;
  for (const anchor of Array.isArray(anchors) ? anchors : []) {
    const needle = String(anchor ?? '').trim().toLowerCase();
    if (!needle) continue;
    const at = lower.indexOf(needle);
    if (at < 0) continue;
    if (at + needle.length <= width) {
      // 起始部分已经包含这个命中词，保持原有的前段截取即可。
      return `${text.slice(0, width)}…`;
    }
    if (hit < 0 || at < hit) {
      hit = at;
      hitLength = needle.length;
    }
  }
  if (hit < 0) return `${text.slice(0, width)}…`;
  const context = Math.floor((width - Math.min(hitLength, width)) / 2);
  const start = Math.max(0, hit - context);
  const end = Math.min(text.length, start + width);
  return `${start > 0 ? '…' : ''}${text.slice(start, end)}${end < text.length ? '…' : ''}`;
}

/**
 * 构建检索候选（history / characters / relationships / facts / threads）。
 *
 * 证据生成规则与原实现保持一致；history 的证据继续用命中词做锚点窗口切片。
 * `anchors` 传 `parseSearchQuery(...).terms` 即可（这里不再自行分词，避免两套实现漂移）。
 */
export function buildContextCandidates(state: GameStateV2, anchors: string[] = []): ContextSearchCandidate[] {
  const characterNames = new Map(state.characters.map((character) => [
    character.id,
    character.name || character.id,
  ]));
  return [
    ...state.history.map((message) => ({
      source: 'history' as const,
      id: message.id,
      turn: message.turn,
      label: message.role === 'user' ? '玩家输入' : '故事正文',
      evidence: clipContextEvidence(message.content, CONTEXT_EVIDENCE_MAX_CHARS, anchors),
      searchable: message.content,
    })),
    ...state.characters.map((character) => {
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
    ...state.relationships.map((relationship) => {
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
    ...state.facts.filter((fact) => fact.stability !== 'temporary').map((fact) => {
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
    ...state.storyThreads.map((thread) => {
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

/** 词权重随长度小幅增加，但上限低（8），避免长词直接压过覆盖率。 */
function termWeight(term: string): number {
  return Math.min(8, 2 + term.length);
}

function toParsedQuery(query: ParsedSearchQuery | string): ParsedSearchQuery {
  return typeof query === 'string' ? parseSearchQuery(query) : query;
}

function round(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

/**
 * 给单条候选打分。
 *
 * - 整串命中（normalized 完整出现在 label + searchable 里）+100；
 * - 每个命中词按长度给少量权重；再按覆盖率 ×60 加成；
 * - 结构化来源只给小加成（facts +3、其他非 history +1），不参与相关性主排序。
 *
 * 查询完全由停用词组成（terms 为空）时返回 0 分：没有有效检索词时不应把整篇正文都算命中。
 */
export function scoreContextCandidate(
  candidate: ContextSearchCandidate,
  query: ParsedSearchQuery | string,
): ContextSearchScore {
  const parsed = toParsedQuery(query);
  if (!parsed.terms.length) return { score: 0, matchedTerms: [], coverage: 0 };
  const haystack = `${candidate.label}\n${candidate.searchable}`.toLowerCase();
  const matchedTerms = parsed.terms.filter((term) => haystack.includes(term));
  if (!matchedTerms.length) return { score: 0, matchedTerms: [], coverage: 0 };
  const wholeBonus = parsed.normalized && haystack.includes(parsed.normalized) ? CONTEXT_WHOLE_QUERY_BONUS : 0;
  const termScore = matchedTerms.reduce((sum, term) => sum + termWeight(term), 0);
  const coverage = matchedTerms.length / parsed.terms.length;
  const sourceBonus = CONTEXT_SOURCE_BONUS[candidate.source] ?? 0;
  return {
    score: round(wholeBonus + termScore + coverage * CONTEXT_COVERAGE_WEIGHT + sourceBonus),
    matchedTerms,
    coverage: round(coverage),
  };
}

function normalizeScope(value: unknown): ContextSearchScope {
  if (typeof value !== 'string') return 'all';
  const scope = value.trim().toLowerCase() as ContextSearchScope;
  return CONTEXT_SEARCH_SCOPES.includes(scope) ? scope : 'all';
}

function normalizeLimit(value: unknown): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return CONTEXT_SEARCH_DEFAULT_LIMIT;
  return Math.max(1, Math.min(CONTEXT_SEARCH_MAX_LIMIT, Math.floor(numeric)));
}

/**
 * 选择最终返回的结果：
 * scope 过滤 → 打分并丢弃 score=0 → 排序（score desc → coverage desc → turn desc）
 * → 去重（同一 source/label/evidence 只留一条，且不占用来源配额）→ 同来源最多 2 条 → 截到 limit。
 */
export function selectContextResults(
  candidates: readonly ContextSearchCandidate[],
  query: ParsedSearchQuery | string,
  options: ContextSearchOptions = {},
): ContextSearchResult[] {
  const parsed = toParsedQuery(query);
  if (!parsed.terms.length) return [];
  const scope = normalizeScope(options.scope);
  const limit = normalizeLimit(options.limit);
  const scored = (Array.isArray(candidates) ? candidates : [])
    .filter((candidate) => scope === 'all' || candidate.source === scope)
    .map((candidate) => ({ candidate, ...scoreContextCandidate(candidate, parsed) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => (
      b.score - a.score
      || b.coverage - a.coverage
      || (b.candidate.turn ?? -1) - (a.candidate.turn ?? -1)
    ));
  const seen = new Set<string>();
  const perSource = new Map<string, number>();
  const selected: ContextSearchResult[] = [];
  for (const item of scored) {
    if (selected.length >= limit) break;
    const { candidate } = item;
    const dedupeKey = `${candidate.source}\u0000${candidate.label}\u0000${candidate.evidence}`;
    if (seen.has(dedupeKey)) continue;
    const used = perSource.get(candidate.source) ?? 0;
    if (used >= CONTEXT_SEARCH_SOURCE_LIMIT) continue;
    seen.add(dedupeKey);
    perSource.set(candidate.source, used + 1);
    selected.push({
      source: candidate.source,
      ...(candidate.turn !== undefined ? { turn: candidate.turn } : {}),
      id: candidate.id,
      label: candidate.label,
      evidence: candidate.evidence,
      matchedTerms: item.matchedTerms,
      score: item.score,
      coverage: item.coverage,
    });
  }
  return selected;
}

/**
 * 组装工具返回 JSON：保持顶层字段 `query/scope/resultCount/results/note` 不变，
 * `results` 在旧字段之外增加 `matchedTerms/score`，0 结果时给出可操作的下一步提示。
 */
export function buildSearchResponse(
  candidates: readonly ContextSearchCandidate[],
  query: ParsedSearchQuery | string,
  options: ContextSearchOptions = {},
): ContextSearchResponse {
  const parsed = toParsedQuery(query);
  const scope = normalizeScope(options.scope);
  const limit = normalizeLimit(options.limit);
  const results = selectContextResults(candidates, parsed, { scope, limit });
  return {
    query: parsed.raw,
    scope,
    resultCount: results.length,
    results: results.map((item) => ({
      source: item.source,
      ...(item.turn !== undefined ? { turn: item.turn } : {}),
      id: item.id,
      label: item.label,
      evidence: item.evidence,
      matchedTerms: item.matchedTerms,
      score: item.score,
    })),
    note: results.length ? CONTEXT_SEARCH_EVIDENCE_NOTE : CONTEXT_SEARCH_EMPTY_NOTE,
  };
}
