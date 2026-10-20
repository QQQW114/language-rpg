/**
 * 规划模型联网搜索工具（`web_search`）：DeepSeek 官方 Search API 的纯函数封装。
 *
 * 从 `engine.ts` 抽出来的原因与 `contextSearch.ts` 相同：请求构造、响应解析、截断与
 * 降级都属于"可独立验证的文本/网络处理"，混在回合执行里既难单测也难调参。
 * 本模块不 import engine，只依赖 `ChatTool` 的类型，因此可以被引擎与测试同时复用。
 *
 * 设计目标（对应 task-11）：
 * - 默认关闭；只有"工具开关 + 联网开关 + 官方 DeepSeek 地址 + 有 API Key"同时满足时
 *   引擎才会挂载本工具（判定见 `isOfficialDeepSeekEndpoint`）。
 * - 工具调用失败（429 / 5xx / 网络错误 / 超时 / 坏响应）**返回错误文本，绝不抛异常**：
 *   搜索只是规划的辅助证据，不能因此打掉整个回合。
 * - 返回给模型的内容必须带固定 `note`：外部结果可能过时、不可信，不得覆盖 worldFacts /
 *   正史 / 角色设定，引用时标出来源 URL；0 结果时给出可执行的 retry hint。
 * - 官方接口 2026-10-17 上线：`POST {apiBase}/tools/search`，与主 API 共用 Bearer；
 *   按成功请求计费（约 5 元/1000 次），账号级 QPS 限制，超限返回 429。
 *
 * 文档：https://api-docs.deepseek.com/guides/search/ 与 https://api-docs.deepseek.com/api/search
 */
import type { ChatTool } from '@/services/llmClient';

/** 单条检索结果（已归一化、已截断）。 */
export interface WebSearchResult {
  title: string;
  url: string;
  summary: string;
  snippet: string;
  /** 站点名；官方接口可能返回 null，这里归一化为空串。 */
  siteName: string;
  /** 发布时间（RFC 3339）；未知时为空串。 */
  date: string;
  /** 权威度分档：0..4，-1 表示未知。 */
  authority: number;
  /** 相关性评分 0..3；>= 1.5 视为高质量。 */
  rerankScore: number;
}

/** 注入 tool 消息的单条结果：只保留模型判断需要的紧凑字段。 */
export interface WebSearchToolItem {
  title: string;
  url: string;
  siteName: string;
  date: string;
  authority: number;
  summary: string;
}

/** `web_search` 工具返回给模型的结构（会被 JSON.stringify 成 tool 消息）。 */
export interface WebSearchToolResult {
  tool: 'web_search';
  ok: boolean;
  query: string;
  resultCount: number;
  results: WebSearchToolItem[];
  note: string;
  /** 失败原因（ok=false 时存在）。 */
  error?: string;
  /** 0 结果时的可执行下一步提示。 */
  retryHint?: string;
  /** 是否为低置信度回退结果（没有结果达到高质量门槛）。 */
  lowConfidence?: boolean;
}

/** 请求体（官方 Search API 的字段；`need_content` 固定 false，节省流量与费用）。 */
export interface WebSearchRequest {
  query: string;
  count: number;
  need_content: false;
  /** 可选：触发搜索的玩家原始问题，帮助官方搜索引擎理解查询（≤128 字）。 */
  ori_question?: string;
}

export interface WebSearchParseOptions {
  /** 低于该分数的结果直接丢弃，默认 1.5（官方建议的高质量门槛）。 */
  minScore?: number;
  /** 最多返回几条，默认 5，内部夹到 1..5。 */
  maxResults?: number;
  /** 单条 summary 最多保留多少字符，默认 500。 */
  summaryChars?: number;
}

export interface ParsedWebSearchResponse {
  results: WebSearchResult[];
  /** 被过滤/截掉的条数（低分、坏数据、超量）。 */
  dropped: number;
  note: string;
  /** 是否退到了低置信度回退档（没有任何结果达到高质量门槛）。 */
  lowConfidence: boolean;
}

/** 注入给 fetch 的最小 init 形状：便于测试注入假 fetch，不绑定具体运行时。 */
export interface WebSearchFetchInit {
  method: 'POST';
  headers: Record<string, string>;
  body: string;
  signal: AbortSignal;
}

export type WebSearchFetch = (url: string, init: WebSearchFetchInit) => Promise<Response>;

export interface WebSearchOptions {
  /** 与主 API 相同的 Base URL（例如 `https://api.deepseek.com/v1`）。 */
  apiBase: string;
  /** 与主 API 相同的 Bearer Key。 */
  apiKey: string;
  /** 可注入的 fetch（测试用）；默认使用全局 fetch。 */
  fetchImpl?: WebSearchFetch;
  /** 外部取消信号（回合取消时传入）。 */
  signal?: AbortSignal;
  /** 单次请求超时，默认 8 秒。 */
  timeoutMs?: number;
  /** 请求条数，默认 5（工具参数不暴露 count，由程序决定）。 */
  count?: number;
  /** 触发搜索的玩家原始问题（可选；用于官方的 ori_question 参数）。 */
  oriQuestion?: unknown;
  parseOptions?: WebSearchParseOptions;
}

export interface WebSearchSuccess {
  ok: true;
  query: string;
  results: WebSearchResult[];
  dropped: number;
  note: string;
  /** 已 JSON.stringify 的 tool 消息内容，可直接返回给工具循环。 */
  toolResult: string;
}

export interface WebSearchFailure {
  ok: false;
  query: string;
  error: string;
  note: string;
  /** 已 JSON.stringify 的 tool 消息内容（含错误说明与降级指引）。 */
  toolResult: string;
}

export type WebSearchOutcome = WebSearchSuccess | WebSearchFailure;

/** 官方 Search API 的 query 上限（请求与工具 schema 共用）。 */
export const WEB_SEARCH_MAX_QUERY_CHARS = 128;
/** 单次默认返回条数：够模型核对事实，又不会把上下文塞满。 */
export const WEB_SEARCH_DEFAULT_COUNT = 5;
export const WEB_SEARCH_MIN_COUNT = 1;
export const WEB_SEARCH_MAX_COUNT = 5;
/** 官方建议：rerank_score >= 1.5 才算高质量结果。 */
export const WEB_SEARCH_MIN_SCORE = 1.5;
/**
 * 低置信度回退门槛。
 *
 * 官方对长尾/长查询经常只给 0.7~0.8 的分数；若严格按 1.5 过滤，工具会返回 0 条，
 * 模型拿不到任何参考（实测「大学动漫社团招新…」长查询全部落在 0.72~0.80）。
 * 因此没有高质量结果时退到该门槛，并在 tool 结果里明确标记低置信度。
 */
export const WEB_SEARCH_FALLBACK_MIN_SCORE = 0.5;
/** 单次最多解析/返回几条（工具侧上限）。 */
export const WEB_SEARCH_MAX_RESULTS = 5;
/** summary 默认截取长度（官方原长约 600~800 字，500 字已足够判断相关性）。 */
export const WEB_SEARCH_DEFAULT_SUMMARY_CHARS = 500;
/** snippet / url / title 的截断上限：防止单条坏数据撑爆 tool 消息。 */
export const WEB_SEARCH_SNIPPET_MAX_CHARS = 200;
export const WEB_SEARCH_URL_MAX_CHARS = 512;
export const WEB_SEARCH_TITLE_MAX_CHARS = 120;
/** 单次响应最多检查多少条原始结果（超大数组直接截掉，不参与解析）。 */
export const WEB_SEARCH_RAW_RESULTS_LIMIT = 100;
/** 响应体字符数上限：正常 5 条结果只有几 KB，超过视为坏响应。 */
export const WEB_SEARCH_MAX_RESPONSE_CHARS = 200_000;
/** 默认超时：搜索是规划的辅助步骤，宁可降级也不要拖住整回合。 */
export const WEB_SEARCH_DEFAULT_TIMEOUT_MS = 8_000;
/** 每回合最多调用几次 web_search（程序强制，与玩家设置的工具总轮数无关）。 */
export const WEB_SEARCH_MAX_CALLS_PER_TURN = 1;
/** 成功返回给模型的固定提示（不可用外部结果覆盖既有设定）。 */
export const WEB_SEARCH_TOOL_NOTE =
  '外部网页检索结果，可能过时或不准确；不得用它覆盖 worldFacts/正史/角色设定；引用时标出来源 URL。';
/** 没有高分结果、退到低分回退时的附加提示。 */
export const WEB_SEARCH_LOW_CONFIDENCE_NOTE =
  '注意：本次结果相关性评分偏低（未达高质量门槛），只能当作弱参考；若与权威状态或既有设定冲突，一律以既有设定为准。';
/** 0 结果时的可执行提示。 */
export const WEB_SEARCH_EMPTY_HINT =
  '没有找到高质量结果：换用更短、更具体的关键词（真实地名、机构、专有名词或年份）再查一次；不要重复同一查询。';
/** 搜索失败时的降级提示：失败不应打断规划。 */
export const WEB_SEARCH_TOOL_ERROR_NOTE =
  '联网搜索失败已降级：请直接基于当前权威状态与既有证据完成规划，不要重复重试；需要时可在后续回合再查。';

/** 规划模型的联网搜索纪律：与 `plannerToolDiscipline` 风格一致，仅在开启时注入 system。 */
export const plannerWebSearchDiscipline = `
【联网搜索工具纪律】
只在规划确实需要现实世界事实（现实制度与法律、真实地理与机构、专业知识、当代生活细节）时才调用web_search；虚构设定、世界书（worldFacts）、canonicalFacts、正史与当前权威状态始终优先，不得用外部结果覆盖或改写它们。
外部网页可能过时、不准确或互相矛盾：只能当作参考证据，不能当作既定事实；与既有设定冲突时一律以既有设定为准。若正文引用外部信息，注明来源URL。
一次只发一条简短的检索查询（2~6 个关键词、不超过 40 字），不要把多个问题或多个条件拼在一起；每回合最多调用一次，不得为同一个问题反复搜索。
查询示例：「大学社团招新 材料」「漫展 志愿者 要求」；不要写整句或长串并列关键词。
搜索失败或没有结果时直接基于现有证据继续规划，不要重复重试，也不要把“查不到”当作放弃本回合的理由。`;

/** `web_search` 工具定义：只暴露 query（count 由程序固定，避免模型放大开销）。 */
export const plannerWebSearchTool: ChatTool = {
  type: 'function',
  function: {
    name: 'web_search',
    description: `当规划需要现实世界事实（现实制度与法律、真实地理与机构、专业知识、当代生活细节）且当前上下文没有时，联网检索一次。
只查现实世界事实，不查虚构设定、世界书或角色设定；一次一条查询，每回合最多调用一次。
结果可能过时或不准确：不得用它覆盖 worldFacts、canonicalFacts、正史与人物设定；引用时标注来源URL。
`,
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: '一条简短的现实世界检索查询：2~6 个关键词、不超过 40 字；不要写整句，也不要把多个问题或条件拼在一起。可用 site: 等官方运算符。',
          minLength: 1,
          maxLength: WEB_SEARCH_MAX_QUERY_CHARS,
        },
      },
      required: ['query'],
      additionalProperties: false,
    },
  },
};

/** 全角/半角都按字符数截断；超长补省略号，保证 tool 消息体积可控。 */
function truncate(text: string, max: number): string {
  if (!Number.isFinite(max) || max <= 0 || text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 1))}…`;
}

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeCount(value: unknown): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return WEB_SEARCH_DEFAULT_COUNT;
  return Math.max(WEB_SEARCH_MIN_COUNT, Math.min(WEB_SEARCH_MAX_COUNT, Math.floor(numeric)));
}

function normalizeMinScore(value: unknown): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric >= 0 ? numeric : WEB_SEARCH_MIN_SCORE;
}

function normalizeMaxResults(value: unknown): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return WEB_SEARCH_MAX_RESULTS;
  return Math.max(1, Math.min(WEB_SEARCH_MAX_RESULTS, Math.floor(numeric)));
}

function normalizeSummaryChars(value: unknown): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return WEB_SEARCH_DEFAULT_SUMMARY_CHARS;
  return Math.max(50, Math.min(2_000, Math.floor(numeric)));
}

function normalizeTimeout(value: unknown): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return WEB_SEARCH_DEFAULT_TIMEOUT_MS;
  return Math.max(100, Math.min(60_000, Math.floor(numeric)));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error ?? '未知错误');
}

/**
 * 构造官方 Search API 的请求体。
 *
 * - query 先 trim，再按 128 字截断（官方上限）；
 * - count 夹到 1..5（工具不暴露 count，程序侧固定小值，费用按请求计与条数无关）；
 * - `need_content` 固定 false：summary 已经足够规划使用，正文会显著放大响应体。
 * - 空 query（含纯空白、非字符串）返回 null，由调用方转成可读错误，不抛异常。
 */
export function buildWebSearchRequest(
  query: unknown,
  count: number = WEB_SEARCH_DEFAULT_COUNT,
  oriQuestion?: unknown,
): WebSearchRequest | null {
  const text = asText(query);
  if (!text) return null;
  const question = asText(oriQuestion).slice(0, WEB_SEARCH_MAX_QUERY_CHARS);
  return {
    query: text.slice(0, WEB_SEARCH_MAX_QUERY_CHARS),
    count: normalizeCount(count),
    need_content: false,
    ...(question ? { ori_question: question } : {}),
  };
}

/**
 * 解析官方 Search API 的响应体。
 *
 * 规则：
 * - `results` 不是数组、响应不是对象 → 返回空结果（不抛错）；
 * - 单条不是对象、缺 title/url、rerank_score 非数字或 < minScore → 丢弃并计入 dropped；
 * - 按 rerank_score 降序（稳定排序，同分保持原始顺序）；
 * - summary/snippet/url/title 截断；authority 非 -1..4 的整数时归一化为 -1；
 * - 超过 WEB_SEARCH_RAW_RESULTS_LIMIT 的原始结果不参与解析，计入 dropped。
 */
export function parseWebSearchResponse(
  raw: unknown,
  options: WebSearchParseOptions = {},
): ParsedWebSearchResponse {
  const record = raw && typeof raw === 'object' && !Array.isArray(raw)
    ? raw as Record<string, unknown>
    : {};
  const rawResults: unknown[] = Array.isArray(record.results) ? record.results as unknown[] : [];
  const minScore = normalizeMinScore(options.minScore);
  const maxResults = normalizeMaxResults(options.maxResults);
  const summaryChars = normalizeSummaryChars(options.summaryChars);
  let dropped = 0;
  const inspected = Math.min(rawResults.length, WEB_SEARCH_RAW_RESULTS_LIMIT);
  if (rawResults.length > WEB_SEARCH_RAW_RESULTS_LIMIT) {
    dropped += rawResults.length - WEB_SEARCH_RAW_RESULTS_LIMIT;
  }
  const scored: Array<{ index: number; result: WebSearchResult }> = [];
  for (let index = 0; index < inspected; index += 1) {
    const item = rawResults[index];
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      dropped += 1;
      continue;
    }
    const row = item as Record<string, unknown>;
    const title = truncate(asText(row.title), WEB_SEARCH_TITLE_MAX_CHARS);
    const url = truncate(asText(row.url), WEB_SEARCH_URL_MAX_CHARS);
    const score = Number(row.rerank_score);
    // 先只校验结构；评分门槛在排序后统一处理（允许"没有高分时低置信度回退"）。
    if (!title || !url || !Number.isFinite(score) || score < 0) {
      dropped += 1;
      continue;
    }
    const authorityRaw = Number(row.authority);
    const authority = Number.isInteger(authorityRaw) && authorityRaw >= -1 && authorityRaw <= 4
      ? authorityRaw
      : -1;
    scored.push({
      index,
      result: {
        title,
        url,
        summary: truncate(asText(row.summary), summaryChars),
        snippet: truncate(asText(row.snippet), WEB_SEARCH_SNIPPET_MAX_CHARS),
        siteName: truncate(asText(row.site_name), WEB_SEARCH_TITLE_MAX_CHARS),
        date: truncate(asText(row.date), 40),
        authority,
        // 保留两位小数：模型只需要相对排序，不需要完整浮点噪声。
        rerankScore: Math.round(score * 100) / 100,
      },
    });
  }
  scored.sort((a, b) => b.result.rerankScore - a.result.rerankScore || a.index - b.index);
  // 优先高质量结果；一个都没有时退到低置信度回退档，避免"全部过滤成 0 条"。
  const highQuality = scored.filter((item) => item.result.rerankScore >= minScore);
  const lowConfidence = highQuality.length === 0 && scored.length > 0;
  const selected = highQuality.length
    ? highQuality
    : scored.filter((item) => item.result.rerankScore >= WEB_SEARCH_FALLBACK_MIN_SCORE);
  const results = selected.slice(0, maxResults).map((item) => item.result);
  dropped += Math.max(0, scored.length - results.length);
  const note = results.length
    ? (lowConfidence
      ? `${WEB_SEARCH_LOW_CONFIDENCE_NOTE}（已过滤 ${dropped} 条无效、更低分或超量结果）`
      : `共返回 ${results.length} 条外部结果（按相关性降序）；已过滤 ${dropped} 条低相关、无效或超量结果。`)
    : '没有可用的外部结果。';
  return { results, dropped, note, lowConfidence };
}

/** 内部工具返回组装：把已解析结果压成紧凑 tool JSON 对象。 */
function buildToolResult(parsed: ParsedWebSearchResponse, query: string): WebSearchToolResult {
  const results: WebSearchToolItem[] = parsed.results.map((result) => ({
    title: result.title,
    url: result.url,
    siteName: result.siteName || '未知站点',
    date: result.date,
    authority: result.authority,
    summary: result.summary,
  }));
  return {
    tool: 'web_search',
    ok: true,
    query: truncate(asText(query), WEB_SEARCH_MAX_QUERY_CHARS),
    resultCount: results.length,
    results,
    note: parsed.lowConfidence ? `${WEB_SEARCH_TOOL_NOTE} ${WEB_SEARCH_LOW_CONFIDENCE_NOTE}` : WEB_SEARCH_TOOL_NOTE,
    ...(parsed.lowConfidence ? { lowConfidence: true } : {}),
    ...(results.length ? {} : { retryHint: WEB_SEARCH_EMPTY_HINT }),
  };
}

/**
 * 把官方响应体格式化成工具返回 JSON 字符串（直接作为 tool 消息内容）。
 * 坏响应不会抛错：解析失败时结果为空并给出 retryHint。
 */
export function formatWebSearchToolResult(raw: unknown, query: unknown): string {
  return JSON.stringify(buildToolResult(parseWebSearchResponse(raw), asText(query)));
}

/** 格式化一次"搜索失败"的工具返回：保留统一 note，并给出降级指引。 */
export function formatWebSearchFailure(query: unknown, error: unknown): string {
  const result: WebSearchToolResult = {
    tool: 'web_search',
    ok: false,
    query: truncate(asText(query), WEB_SEARCH_MAX_QUERY_CHARS),
    resultCount: 0,
    results: [],
    error: asText(error) || '联网搜索失败。',
    note: WEB_SEARCH_TOOL_ERROR_NOTE,
  };
  return JSON.stringify(result);
}

/** 尽量从错误响应体里取出可读说明；任何异常都降级为空串。 */
async function readErrorDetail(response: Response): Promise<string> {
  try {
    const text = String(await response.text()).trim();
    if (!text) return '';
    let message = text;
    try {
      const parsed = JSON.parse(text) as { error?: { message?: unknown }; message?: unknown };
      const nested = parsed?.error?.message;
      if (typeof nested === 'string' && nested.trim()) message = nested;
      else if (typeof parsed?.message === 'string' && parsed.message.trim()) message = parsed.message;
    } catch { /* 非 JSON 错误体保留原文 */ }
    return message.replace(/\s+/g, ' ').slice(0, 300);
  } catch {
    return '';
  }
}

function failure(query: string, error: string): WebSearchFailure {
  return {
    ok: false,
    query,
    error,
    note: WEB_SEARCH_TOOL_ERROR_NOTE,
    toolResult: formatWebSearchFailure(query, error),
  };
}

/**
 * 调用官方 Search API。
 *
 * **永不抛异常**：429 / 5xx / 其他非 2xx / 网络错误 / 超时 / 坏响应都会返回
 * `{ok:false, error}`，由调用方包装成 tool 错误文本——工具失败不能让整回合失败。
 * 成功时返回已解析结果、统计与可直接注入的 `toolResult` JSON 字符串。
 */
export async function searchWeb(query: unknown, options: WebSearchOptions): Promise<WebSearchOutcome> {
  const request = buildWebSearchRequest(query, options?.count, options?.oriQuestion);
  const queryText = request?.query ?? truncate(asText(query), WEB_SEARCH_MAX_QUERY_CHARS);
  if (!request) return failure(queryText, 'query不能为空：请提供一条 1~128 字的现实世界检索查询。');
  const apiBase = asText(options?.apiBase);
  const apiKey = asText(options?.apiKey);
  if (!apiBase) return failure(queryText, '未配置 API Base URL，无法联网搜索。');
  if (!apiKey) return failure(queryText, '未配置 API Key，无法联网搜索。');
  // 外部已取消时直接降级，不发请求（已 abort 的 signal 不会触发后续 abort 事件）。
  if (options?.signal?.aborted) return failure(queryText, '联网搜索已取消。');

  const timeoutMs = normalizeTimeout(options?.timeoutMs);
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const external = options?.signal;
  const onExternalAbort = () => controller.abort();
  external?.addEventListener('abort', onExternalAbort, { once: true });
  try {
    const fetchImpl: WebSearchFetch = options?.fetchImpl
      ?? ((url, init) => globalThis.fetch(url, init));
    const response = await fetchImpl(`${apiBase.replace(/\/+$/, '')}/tools/search`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(request),
      signal: controller.signal,
    });
    if (!response.ok) {
      const detail = await readErrorDetail(response);
      const hint = response.status === 429 ? '（账号级 QPS 限流，本回合内不要重试）' : '';
      return failure(queryText, `搜索请求失败（HTTP ${response.status}）${hint}${detail ? `：${detail}` : ''}`);
    }
    const text = await response.text();
    if (text.length > WEB_SEARCH_MAX_RESPONSE_CHARS) {
      return failure(queryText, `搜索响应过大（${text.length} 字符），已忽略。`);
    }
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      return failure(queryText, '搜索响应不是有效 JSON，已忽略。');
    }
    const parsed = parseWebSearchResponse(raw, options?.parseOptions);
    return {
      ok: true,
      query: queryText,
      results: parsed.results,
      dropped: parsed.dropped,
      note: parsed.note,
      toolResult: JSON.stringify(buildToolResult(parsed, queryText)),
    };
  } catch (error) {
    if (timedOut) return failure(queryText, `联网搜索超时（${timeoutMs}ms），已跳过本次搜索。`);
    if (external?.aborted) return failure(queryText, '联网搜索已取消。');
    return failure(queryText, `联网搜索失败：${errorMessage(error)}`);
  } finally {
    clearTimeout(timer);
    external?.removeEventListener('abort', onExternalAbort);
  }
}

/**
 * 判断 API Base URL 是否指向官方 DeepSeek 端点。
 *
 * 抽到这里的目的是让设置页与 engine 共用同一份判定，避免两处漂移：
 * - 主判定：URL 的 hostname 必须是 `deepseek.com` 或其子域（`api.deepseek.com` 等）；
 * - 回退：URL 无法解析（例如用户只填了 `api.deepseek.com/v1` 这类缺少 scheme 的旧写法）时，
 *   退回字符串包含判定，保持与原 engine 行为一致。
 * 空值 / 无效输入返回 false，不抛错。
 */
export function isOfficialDeepSeekEndpoint(apiBase: unknown): boolean {
  const base = asText(apiBase);
  if (!base) return false;
  try {
    // 主判定：只看 hostname，避免 "https://proxy.example/api.deepseek.com" 这类路径被误判为官方。
    return /(^|\.)deepseek\.com$/i.test(new URL(base).hostname);
  } catch {
    // 非法 URL（例如用户只填了主机名）退回字符串判定，与原 engine 行为保持一致。
    return /api\.deepseek\.com/i.test(base);
  }
}
