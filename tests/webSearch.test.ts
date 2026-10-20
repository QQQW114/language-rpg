import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  WEB_SEARCH_DEFAULT_COUNT,
  WEB_SEARCH_EMPTY_HINT,
  WEB_SEARCH_MAX_COUNT,
  WEB_SEARCH_MAX_QUERY_CHARS,
  WEB_SEARCH_MAX_RESULTS,
  WEB_SEARCH_MIN_SCORE,
  WEB_SEARCH_RAW_RESULTS_LIMIT,
  WEB_SEARCH_TOOL_NOTE,
  buildWebSearchRequest,
  formatWebSearchFailure,
  formatWebSearchToolResult,
  isOfficialDeepSeekEndpoint,
  parseWebSearchResponse,
  plannerWebSearchDiscipline,
  plannerWebSearchTool,
  searchWeb,
  type WebSearchFetch,
} from '@/v2/webSearch';

// ---------------------------------------------------------------------------
// 夹具：官方 Search API 响应形状
// ---------------------------------------------------------------------------

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function rawItem(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    rerank_score: 2.4,
    title: '示例资料',
    url: 'https://example.com/fact',
    snippet: '与查询相关的短摘要',
    summary: '与查询相关的长摘要，用来给模型阅读。',
    content: '',
    site_name: '示例站',
    site_icon: null,
    date: '2026-06-01T00:00:00+00:00',
    authority: 3,
    ...overrides,
  };
}

const RAW_RESULTS = {
  results: [
    rawItem(),
    rawItem({ rerank_score: 0.8, title: '低分结果', url: 'https://example.com/low' }),
    rawItem({ rerank_score: 1.9, title: '中高分结果', url: 'https://example.com/mid', summary: '短摘要' }),
  ],
};

/** 记录注入 fetch 收到的请求，便于断言 URL / 头 / 体。 */
function recordingFetch(response: () => Response | Promise<Response>) {
  const calls: Array<{ url: string; init: any }> = [];
  const fetchImpl: WebSearchFetch = async (url, init) => {
    calls.push({ url, init });
    return response();
  };
  return { calls, fetchImpl };
}

// ---------------------------------------------------------------------------
// 1. buildWebSearchRequest
// ---------------------------------------------------------------------------

describe('webSearch.buildWebSearchRequest — 请求构造', () => {
  it('trim query，固定 need_content=false，默认 count=5', () => {
    assert.deepEqual(buildWebSearchRequest('  量子纠缠  '), {
      query: '量子纠缠',
      count: WEB_SEARCH_DEFAULT_COUNT,
      need_content: false,
    });
  });

  it('query 超过 128 字时截断到 128 字（官方上限）', () => {
    const request = buildWebSearchRequest('长'.repeat(400));
    assert.equal(request?.query.length, WEB_SEARCH_MAX_QUERY_CHARS);
    assert.ok(request!.query.startsWith('长长'));
  });

  it('count 夹到 1..5，非法值回落默认值', () => {
    assert.equal(buildWebSearchRequest('q', 0)?.count, 1);
    assert.equal(buildWebSearchRequest('q', -3)?.count, 1);
    assert.equal(buildWebSearchRequest('q', 99)?.count, WEB_SEARCH_MAX_COUNT);
    assert.equal(buildWebSearchRequest('q', 2.9)?.count, 2);
    assert.equal(buildWebSearchRequest('q', Number.NaN)?.count, WEB_SEARCH_DEFAULT_COUNT);
  });

  it('空 / 纯空白 / 非字符串 query 返回 null（不抛异常）', () => {
    for (const value of ['', '   ', '\n\t', undefined, null, 42, {}, []]) {
      assert.equal(buildWebSearchRequest(value), null, `输入 ${String(value)} 应返回 null`);
    }
  });

  it('ori_question：传入玩家原话时带上并截断到 128 字，空值不出现', () => {
    const withQuestion = buildWebSearchRequest('大学社团 招新', 5, `玩家原话${'很'.repeat(200)}`);
    assert.ok(withQuestion?.ori_question);
    assert.equal(withQuestion?.ori_question?.length, 128);
    const withoutQuestion = buildWebSearchRequest('大学社团 招新', 5, '   ');
    assert.equal(withoutQuestion?.ori_question, undefined);
  });
});

// ---------------------------------------------------------------------------
// 2. parseWebSearchResponse
// ---------------------------------------------------------------------------

describe('webSearch.parseWebSearchResponse — 响应解析', () => {
  it('过滤低分结果、按 rerank_score 降序、统计 dropped', () => {
    const parsed = parseWebSearchResponse(RAW_RESULTS);
    assert.equal(parsed.results.length, 2);
    assert.deepEqual(parsed.results.map((item) => item.title), ['示例资料', '中高分结果']);
    assert.equal(parsed.results[0].rerankScore, 2.4);
    assert.equal(parsed.dropped, 1);
    assert.ok(parsed.note.includes('2 条'));
    assert.ok(parsed.note.includes('1 条'));
  });

  it('summary / snippet / url 按上限截断', () => {
    const parsed = parseWebSearchResponse({
      results: [rawItem({
        summary: '摘'.repeat(900),
        snippet: '短'.repeat(500),
        url: `https://example.com/${'p'.repeat(1000)}`,
      })],
    });
    assert.equal(parsed.results.length, 1);
    assert.equal(parsed.results[0].summary.length, 500);
    assert.ok(parsed.results[0].summary.endsWith('…'));
    assert.equal(parsed.results[0].snippet.length, 200);
    assert.equal(parsed.results[0].url.length, 512);
  });

  it('坏数据（非对象 / results 非数组 / 缺字段 / 超大数组）不抛错', () => {
    for (const raw of [null, undefined, 'text', 42, [], { results: 'not-array' }, { results: {} }]) {
      const parsed = parseWebSearchResponse(raw);
      assert.deepEqual(parsed.results, [], `输入 ${String(raw)} 应返回空结果`);
    }
    const mixed = parseWebSearchResponse({
      results: [null, 42, {}, { rerank_score: 2, title: '', url: 'https://x' }, { rerank_score: 'bad', title: 't', url: 'https://x' }],
    });
    assert.deepEqual(mixed.results, []);
    assert.equal(mixed.dropped, 5);

    const huge = parseWebSearchResponse({
      results: Array.from({ length: WEB_SEARCH_RAW_RESULTS_LIMIT + 200 }, () => rawItem()),
    });
    assert.equal(huge.results.length, WEB_SEARCH_MAX_RESULTS);
    // 200 条超出检查上限 + 95 条超出返回上限
    assert.equal(huge.dropped, 295);
  });

  it('支持自定义 minScore / maxResults / summaryChars', () => {
    const raw = {
      results: [
        rawItem({ rerank_score: 2.6, summary: 'A'.repeat(200) }),
        rawItem({ rerank_score: 2.0, title: '第二条', summary: 'B'.repeat(200) }),
        rawItem({ rerank_score: 1.8, title: '第三条' }),
      ],
    };
    const parsed = parseWebSearchResponse(raw, { minScore: 2, maxResults: 2, summaryChars: 60 });
    assert.deepEqual(parsed.results.map((item) => item.title), ['示例资料', '第二条']);
    assert.equal(parsed.results[0].summary.length, 60);
    assert.equal(parsed.dropped, 1);
  });

  it('归一化空站点 / 未知日期 / 越界权威度', () => {
    const parsed = parseWebSearchResponse({
      results: [rawItem({ site_name: null, date: null, authority: 9 })],
    });
    assert.equal(parsed.results[0].siteName, '');
    assert.equal(parsed.results[0].date, '');
    assert.equal(parsed.results[0].authority, -1);
  });

  it('最小评分常量与官方建议一致（>=1.5 才算高质量）', () => {
    assert.equal(WEB_SEARCH_MIN_SCORE, 1.5);
    const boundary = parseWebSearchResponse({
      results: [rawItem({ rerank_score: 1.5 }), rawItem({ rerank_score: 1.49, title: '差一点' })],
    });
    assert.deepEqual(boundary.results.map((item) => item.title), ['示例资料']);
    assert.equal(boundary.dropped, 1);
  });

  it('没有高质量结果时退到低置信度回退，而不是返回 0 条', () => {
    // 实测：官方对长尾/长查询常只给 0.7~0.8。
    const parsed = parseWebSearchResponse({
      results: [
        rawItem({ rerank_score: 0.8, title: '低分一' }),
        rawItem({ rerank_score: 0.72, title: '低分二' }),
        rawItem({ rerank_score: 0.3, title: '太低' }),
      ],
    });
    assert.deepEqual(parsed.results.map((item) => item.title), ['低分一', '低分二']);
    assert.equal(parsed.lowConfidence, true);
    assert.equal(parsed.dropped, 1);
    assert.ok(parsed.note.includes('相关性评分偏低'));
  });

  it('全部分数低于回退门槛时仍返回空结果', () => {
    const parsed = parseWebSearchResponse({
      results: [rawItem({ rerank_score: 0.2 }), rawItem({ rerank_score: 0.1 })],
    });
    assert.deepEqual(parsed.results, []);
    assert.equal(parsed.note, '没有可用的外部结果。');
  });
});

// ---------------------------------------------------------------------------
// 3. formatWebSearchToolResult / formatWebSearchFailure
// ---------------------------------------------------------------------------

describe('webSearch.formatWebSearchToolResult — 注入模型的 tool JSON', () => {
  it('带固定 note、紧凑字段、回显 query', () => {
    const payload = JSON.parse(formatWebSearchToolResult(RAW_RESULTS, '现实世界的制度'));
    assert.equal(payload.tool, 'web_search');
    assert.equal(payload.ok, true);
    assert.equal(payload.query, '现实世界的制度');
    assert.equal(payload.resultCount, 2);
    assert.equal(payload.note, WEB_SEARCH_TOOL_NOTE);
    assert.ok(payload.note.includes('可能过时'));
    assert.ok(payload.note.includes('worldFacts'));
    assert.ok(payload.note.includes('正史'));
    assert.ok(payload.note.includes('来源 URL'));
    assert.deepEqual(Object.keys(payload.results[0]).sort(), ['authority', 'date', 'siteName', 'summary', 'title', 'url']);
    assert.equal(payload.results[0].siteName, '示例站');
    assert.equal(payload.retryHint, undefined);
    assert.equal(payload.lowConfidence, undefined);
  });

  it('低置信度回退时在 note 与 lowConfidence 字段里明确标记', () => {
    const payload = JSON.parse(formatWebSearchToolResult({
      results: [rawItem({ rerank_score: 0.8, title: '低分' })],
    }, '现实世界制度'));
    assert.equal(payload.resultCount, 1);
    assert.equal(payload.lowConfidence, true);
    assert.ok(payload.note.includes('弱参考'));
  });

  it('0 结果时给出可执行的 retryHint，并且不抛错', () => {
    const payload = JSON.parse(formatWebSearchToolResult({ results: [] }, '不存在的东西'));
    assert.equal(payload.resultCount, 0);
    assert.deepEqual(payload.results, []);
    assert.equal(payload.retryHint, WEB_SEARCH_EMPTY_HINT);
    assert.ok(payload.retryHint.includes('换用更短'));

    // 坏响应同样降级为 0 结果 + retryHint
    const broken = JSON.parse(formatWebSearchToolResult('not-a-response', 'q'));
    assert.equal(broken.resultCount, 0);
    assert.equal(broken.retryHint, WEB_SEARCH_EMPTY_HINT);
  });

  it('失败结果保留统一降级 note 与错误文本', () => {
    const payload = JSON.parse(formatWebSearchFailure('查询', '搜索请求失败（HTTP 429）'));
    assert.equal(payload.ok, false);
    assert.equal(payload.tool, 'web_search');
    assert.equal(payload.query, '查询');
    assert.equal(payload.resultCount, 0);
    assert.ok(payload.error.includes('429'));
    assert.ok(payload.note.includes('不要重复重试'));
  });
});

// ---------------------------------------------------------------------------
// 4. searchWeb
// ---------------------------------------------------------------------------

describe('webSearch.searchWeb — 官方 Search API 调用与降级', () => {
  const BASE = 'https://api.deepseek.com/v1//';
  const KEY = 'sk-test';

  it('成功：拼 /tools/search、Bearer 鉴权、请求体正确、返回解析结果', async () => {
    const { calls, fetchImpl } = recordingFetch(() => jsonResponse(RAW_RESULTS));
    const outcome = await searchWeb('  现实世界的制度  ', { apiBase: BASE, apiKey: KEY, fetchImpl });
    assert.equal(outcome.ok, true);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'https://api.deepseek.com/v1/tools/search');
    assert.equal(calls[0].init.method, 'POST');
    assert.equal(calls[0].init.headers.Authorization, `Bearer ${KEY}`);
    assert.equal(calls[0].init.headers['Content-Type'], 'application/json');
    assert.deepEqual(JSON.parse(calls[0].init.body), {
      query: '现实世界的制度',
      count: WEB_SEARCH_DEFAULT_COUNT,
      need_content: false,
    });
    if (!outcome.ok) return assert.fail('应成功');
    assert.deepEqual(outcome.results.map((item) => item.title), ['示例资料', '中高分结果']);
    assert.equal(outcome.dropped, 1);
    const payload = JSON.parse(outcome.toolResult);
    assert.equal(payload.ok, true);
    assert.equal(payload.note, WEB_SEARCH_TOOL_NOTE);
    assert.equal(payload.resultCount, 2);
  });

  it('成功但 0 结果：仍是 ok:true，toolResult 带 retryHint', async () => {
    const { fetchImpl } = recordingFetch(() => jsonResponse({ results: [] }));
    const outcome = await searchWeb('没人知道的冷门事', { apiBase: BASE, apiKey: KEY, fetchImpl });
    assert.equal(outcome.ok, true);
    if (!outcome.ok) return;
    assert.deepEqual(outcome.results, []);
    const payload = JSON.parse(outcome.toolResult);
    assert.equal(payload.resultCount, 0);
    assert.equal(payload.retryHint, WEB_SEARCH_EMPTY_HINT);
  });

  it('HTTP 429：返回 ok:false（含限流提示），不抛异常', async () => {
    const { fetchImpl } = recordingFetch(() => jsonResponse({ error: { message: 'rate limit exceeded' } }, 429));
    const outcome = await searchWeb('q', { apiBase: BASE, apiKey: KEY, fetchImpl });
    assert.equal(outcome.ok, false);
    if (outcome.ok) return;
    assert.ok(outcome.error.includes('429'));
    assert.ok(outcome.error.includes('rate limit exceeded'));
    const payload = JSON.parse(outcome.toolResult);
    assert.equal(payload.ok, false);
    assert.ok(payload.note.includes('联网搜索失败已降级'));
  });

  it('HTTP 500：返回 ok:false，不抛异常', async () => {
    const { fetchImpl } = recordingFetch(() => jsonResponse({ error: { message: 'internal error' } }, 500));
    const outcome = await searchWeb('q', { apiBase: BASE, apiKey: KEY, fetchImpl });
    assert.equal(outcome.ok, false);
    if (outcome.ok) return;
    assert.ok(outcome.error.includes('500'));
    assert.ok(outcome.error.includes('internal error'));
  });

  it('网络错误：返回 ok:false（含原因），不抛异常', async () => {
    const fetchImpl: WebSearchFetch = async () => {
      throw new TypeError('fetch failed');
    };
    const outcome = await searchWeb('q', { apiBase: BASE, apiKey: KEY, fetchImpl });
    assert.equal(outcome.ok, false);
    if (outcome.ok) return;
    assert.ok(outcome.error.includes('fetch failed'));
  });

  it('超时：中止请求并返回 ok:false（含超时说明）', async () => {
    const fetchImpl: WebSearchFetch = (_url, init) => new Promise((_resolve, reject) => {
      init.signal.addEventListener('abort', () => {
        reject(new DOMException('aborted', 'AbortError'));
      }, { once: true });
    });
    const outcome = await searchWeb('q', { apiBase: BASE, apiKey: KEY, fetchImpl, timeoutMs: 20 });
    assert.equal(outcome.ok, false);
    if (outcome.ok) return;
    assert.ok(outcome.error.includes('超时'), `实际：${outcome.error}`);
  });

  it('外部 signal 已取消：直接降级，不发起请求', async () => {
    const controller = new AbortController();
    controller.abort();
    let called = 0;
    const fetchImpl: WebSearchFetch = async () => {
      called += 1;
      return jsonResponse(RAW_RESULTS);
    };
    const outcome = await searchWeb('q', {
      apiBase: BASE,
      apiKey: KEY,
      fetchImpl,
      signal: controller.signal,
    });
    assert.equal(outcome.ok, false);
    assert.equal(called, 0);
    if (outcome.ok) return;
    assert.ok(outcome.error.includes('已取消'));
  });

  it('空 query / 缺 Key / 缺 Base：不发起请求，返回 ok:false', async () => {
    let called = 0;
    const fetchImpl: WebSearchFetch = async () => {
      called += 1;
      return jsonResponse(RAW_RESULTS);
    };
    const empty = await searchWeb('   ', { apiBase: BASE, apiKey: KEY, fetchImpl });
    assert.equal(empty.ok, false);
    if (!empty.ok) assert.ok(empty.error.includes('query不能为空'));
    const noKey = await searchWeb('q', { apiBase: BASE, apiKey: '', fetchImpl });
    assert.equal(noKey.ok, false);
    if (!noKey.ok) assert.ok(noKey.error.includes('API Key'));
    const noBase = await searchWeb('q', { apiBase: '', apiKey: KEY, fetchImpl });
    assert.equal(noBase.ok, false);
    if (!noBase.ok) assert.ok(noBase.error.includes('API Base URL'));
    assert.equal(called, 0);
  });

  it('坏响应（非 JSON / 超大响应体）：返回 ok:false，不抛异常', async () => {
    const notJson: WebSearchFetch = async () => new Response('not-json', { status: 200 });
    const broken = await searchWeb('q', { apiBase: BASE, apiKey: KEY, fetchImpl: notJson });
    assert.equal(broken.ok, false);
    if (!broken.ok) assert.ok(broken.error.includes('不是有效 JSON'));

    const huge: WebSearchFetch = async () => new Response('x'.repeat(200_001), { status: 200 });
    const oversized = await searchWeb('q', { apiBase: BASE, apiKey: KEY, fetchImpl: huge });
    assert.equal(oversized.ok, false);
    if (!oversized.ok) assert.ok(oversized.error.includes('响应过大'));
  });
});

// ---------------------------------------------------------------------------
// 5. isOfficialDeepSeekEndpoint
// ---------------------------------------------------------------------------

describe('webSearch.isOfficialDeepSeekEndpoint — 官方地址判定', () => {
  it('官方地址（含子域 / 带路径）判定为 true', () => {
    for (const base of [
      'https://api.deepseek.com',
      'https://api.deepseek.com/v1',
      'https://api.deepseek.com/v1/',
      'https://foo.deepseek.com/v1',
      'api.deepseek.com/v1',
    ]) {
      assert.equal(isOfficialDeepSeekEndpoint(base), true, `${base} 应判为官方`);
    }
  });

  it('非官方 / 空值 / 无效 URL 判定为 false', () => {
    for (const base of [
      'https://api.test.invalid/v1',
      'https://api.openai.com/v1',
      'https://notdeepseek.com/v1',
      'https://deepseek.com.evil.com/v1',
      'https://example.com/api.deepseek.com/v1',
      '',
      '   ',
      null,
      undefined,
      42,
      'not a url',
    ]) {
      assert.equal(isOfficialDeepSeekEndpoint(base), false, `${String(base)} 不应判为官方`);
    }
  });
});

// ---------------------------------------------------------------------------
// 6. 工具定义与纪律
// ---------------------------------------------------------------------------

describe('webSearch.plannerWebSearchTool / plannerWebSearchDiscipline', () => {
  it('工具名 web_search，只暴露 query（必填，1~128 字），不暴露 count', () => {
    assert.equal(plannerWebSearchTool.type, 'function');
    assert.equal(plannerWebSearchTool.function.name, 'web_search');
    const parameters = plannerWebSearchTool.function.parameters as any;
    assert.deepEqual(Object.keys(parameters.properties), ['query']);
    assert.equal(parameters.properties.query.type, 'string');
    assert.equal(parameters.properties.query.maxLength, WEB_SEARCH_MAX_QUERY_CHARS);
    assert.deepEqual(parameters.required, ['query']);
    assert.equal(parameters.additionalProperties, false);
    assert.equal(parameters.properties.count, undefined);
    assert.equal(parameters.properties.limit, undefined);
    const description = String(plannerWebSearchTool.function.description ?? '');
    assert.ok(description.includes('现实世界'));
    assert.ok(description.includes('不查虚构设定'));
    assert.ok(description.includes('一次一条'));
  });

  it('纪律文本覆盖优先级、不可信、每回合一次、失败继续', () => {
    assert.ok(plannerWebSearchDiscipline.startsWith('\n【联网搜索工具纪律】'));
    assert.ok(plannerWebSearchDiscipline.includes('worldFacts'));
    assert.ok(plannerWebSearchDiscipline.includes('canonicalFacts'));
    assert.ok(plannerWebSearchDiscipline.includes('正史'));
    assert.ok(plannerWebSearchDiscipline.includes('不得用外部结果覆盖'));
    assert.ok(plannerWebSearchDiscipline.includes('每回合最多调用一次'));
    assert.ok(plannerWebSearchDiscipline.includes('不要重复重试'));
  });
});
