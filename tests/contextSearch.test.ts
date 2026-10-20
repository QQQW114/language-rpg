import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  CONTEXT_EVIDENCE_MAX_CHARS,
  CONTEXT_SEARCH_EMPTY_NOTE,
  CONTEXT_SEARCH_EVIDENCE_NOTE,
  CONTEXT_SEARCH_MAX_LIMIT,
  CONTEXT_SEARCH_MAX_TERMS,
  CONTEXT_SEARCH_SOURCE_LIMIT,
  buildContextCandidates,
  buildSearchResponse,
  clipContextEvidence,
  parseSearchQuery,
  scoreContextCandidate,
  selectContextResults,
  type ContextSearchCandidate,
  type ContextSearchScope,
} from '@/v2/contextSearch';
import { makeState } from './helpers/fixtures';

// ---------------------------------------------------------------------------
// 夹具
// ---------------------------------------------------------------------------

function candidate(overrides: Partial<ContextSearchCandidate> = {}): ContextSearchCandidate {
  return {
    source: 'history',
    id: 'c-1',
    turn: 1,
    label: '故事正文',
    evidence: '',
    searchable: '',
    ...overrides,
  };
}

function historyMessage(id: string, content: string, turn = 1) {
  return { id, role: 'assistant' as const, content, turn, createdAt: turn };
}

describe('contextSearch.parseSearchQuery — 分词', () => {
  it('CJK 片段：整段 + 长度 2 的 bigram，短片段不重复', () => {
    assert.deepEqual(parseSearchQuery('旧书店').terms, ['旧书店', '旧书', '书店']);
    assert.deepEqual(parseSearchQuery('阿黎').terms, ['阿黎']);
    assert.equal(parseSearchQuery('旧书店').raw, '旧书店');
    assert.equal(parseSearchQuery('旧书店').normalized, '旧书店');
  });

  it('标点/空白切分多个 CJK 片段，并保持出现顺序', () => {
    const parsed = parseSearchQuery('阿黎，旧书店。');
    assert.deepEqual(parsed.terms, ['阿黎', '旧书店', '旧书', '书店']);
  });

  it('含停用字的 bigram 被丢弃，但整段词仍保留（「存在」这类词仍可查）', () => {
    assert.deepEqual(parseSearchQuery('存在').terms, ['存在']);
    const longRun = parseSearchQuery('旧书店的老板');
    assert.ok(longRun.terms.includes('旧书店的老板'), '整段词应保留');
    assert.ok(longRun.terms.includes('旧书'));
    assert.ok(longRun.terms.includes('书店'));
    assert.ok(longRun.terms.includes('老板'));
    assert.ok(!longRun.terms.includes('店的'), '含「的」的 bigram 不应保留');
    assert.ok(!longRun.terms.includes('的老'));
  });

  it('停用词被剔除：单字虚词与大写不再当关键词', () => {
    const parsed = parseSearchQuery('我 的 阿黎 然后 我们 可以');
    assert.ok(parsed.terms.includes('阿黎'));
    for (const stopword of ['我', '的', '然后', '我们', '可以']) {
      assert.ok(!parsed.terms.includes(stopword), `停用词 ${stopword} 不应保留：${parsed.terms.join('/')}`);
    }
  });

  it('中文单字保留（单字人名仍可查），但疑问词 bigram 不制造噪声', () => {
    const parsed = parseSearchQuery('晴 在哪里');
    assert.ok(parsed.terms.includes('晴'), '单字人名应保留');
    assert.ok(parsed.terms.includes('在哪里'));
    assert.ok(!parsed.terms.includes('哪里'), '「哪里」是停用词');
    assert.ok(!parsed.terms.includes('在哪'), '双停用字组成的 bigram 应丢弃');
  });

  it('拉丁词过滤长度 < 2，并统一小写', () => {
    assert.deepEqual(parseSearchQuery('a ab ABC').terms, ['ab', 'abc']);
    assert.deepEqual(parseSearchQuery('A a B').terms, []);
  });

  it('全角转半角：字母/数字/标点都归一化后再分词', () => {
    const parsed = parseSearchQuery('ＡＢＣ，１２３');
    assert.equal(parsed.normalized, 'abc,123');
    assert.deepEqual(parsed.terms, ['abc', '123']);
    assert.deepEqual(parseSearchQuery('ＡＲＩＡ').terms, ['aria']);
  });

  it('去重且最多 12 个词（超长 CJK 片段按出现顺序截断）', () => {
    const repeated = parseSearchQuery('阿黎 '.repeat(20));
    assert.deepEqual(repeated.terms, ['阿黎'], '重复词只保留一次');
    const many = parseSearchQuery('一二三四五六七八九十甲乙丙丁');
    assert.equal(many.terms.length, CONTEXT_SEARCH_MAX_TERMS);
    assert.equal(new Set(many.terms).size, many.terms.length);
  });

  it('坏输入不抛错：空串/空白/非字符串/超长串', () => {
    for (const bad of ['', '   ', null, undefined, 42, {}, [], true]) {
      const parsed = parseSearchQuery(bad as unknown);
      assert.equal(parsed.raw, '');
      assert.deepEqual(parsed.terms, []);
    }
    const huge = parseSearchQuery('阿'.repeat(50_000));
    assert.ok(huge.raw.length <= 200, `raw 应截断，实际 ${huge.raw.length}`);
    assert.ok(huge.terms.length <= CONTEXT_SEARCH_MAX_TERMS);
  });

  it('raw 去首尾空白，normalized 折叠空白', () => {
    const parsed = parseSearchQuery('  阿黎   旧书店  ');
    assert.equal(parsed.raw, '阿黎   旧书店');
    assert.equal(parsed.normalized, '阿黎 旧书店');
  });
});

describe('contextSearch.clipContextEvidence — 证据窗口', () => {
  it('短文本原样返回（只折叠空白）', () => {
    assert.equal(clipContextEvidence('  阿黎\n说  '), '阿黎 说');
    assert.equal(clipContextEvidence(undefined), '');
    assert.equal(clipContextEvidence(123), '123');
  });

  it('默认 500 字截断：无锚点时保留前缀并加省略号', () => {
    const text = '雨'.repeat(1000);
    const clipped = clipContextEvidence(text);
    assert.equal(clipped, `${'雨'.repeat(CONTEXT_EVIDENCE_MAX_CHARS)}…`);
    assert.equal(clipped.length, CONTEXT_EVIDENCE_MAX_CHARS + 1);
  });

  it('命中点在后段时以命中位置为中心切片，证据里必须包含查询词', () => {
    const text = `${'前'.repeat(900)}旧书店${'后'.repeat(900)}`;
    const clipped = clipContextEvidence(text, 500, ['旧书店']);
    assert.ok(clipped.includes('旧书店'), '证据必须包含命中词');
    assert.ok(clipped.startsWith('…') && clipped.endsWith('…'), '窗口两侧都应有省略标记');
    assert.ok(clipped.length <= 502, `证据不应超过 500+2 个省略号，实际 ${clipped.length}`);
  });

  it('max 参数可覆盖默认长度；非法 max 回退默认值', () => {
    const text = '雨'.repeat(1000);
    assert.equal(clipContextEvidence(text, 100).length, 101);
    assert.equal(clipContextEvidence(text, 0).length, CONTEXT_EVIDENCE_MAX_CHARS + 1);
    assert.equal(clipContextEvidence(text, Number.NaN).length, CONTEXT_EVIDENCE_MAX_CHARS + 1);
  });
});

describe('contextSearch.buildContextCandidates — 候选构建', () => {
  it('从 state 构建 history/characters/relationships/facts/threads 五类候选', () => {
    const state = makeState({
      history: [historyMessage('msg-1', '晴把那封信折好，放进口袋。', 1)],
      facts: [{
        id: 'fact-1',
        subjectId: 'char-a',
        predicate: 'home',
        value: '城南',
        scope: 'location',
        stability: 'stable',
        confidence: 'explicit',
        keywords: ['家住'],
        evidenceTurn: 3,
        evidenceQuote: '住在城南',
        createdAtTurn: 3,
        updatedAtTurn: 3,
      }],
    });
    const candidates = buildContextCandidates(state);
    assert.deepEqual(
      [...new Set(candidates.map((item) => item.source))].sort(),
      ['characters', 'facts', 'history', 'relationships', 'threads'],
    );
  });

  it('history 证据用命中词做锚点窗口切片，长正文后段命中仍能看到查询词', () => {
    const content = `${'前'.repeat(900)}晴${'后'.repeat(500)}`;
    const state = makeState({ history: [historyMessage('msg-long', content, 2)] });
    const candidates = buildContextCandidates(state, ['晴']);
    const history = candidates.find((item) => item.source === 'history');
    assert.ok(history, '应构建出 history 候选');
    assert.ok(history.evidence.includes('晴'), '证据应包含命中词');
    assert.ok(history.evidence.startsWith('…'));
    assert.ok(history.evidence.length <= 502);
    assert.equal(history.searchable, content, 'searchable 保留全文用于命中判定');
    assert.equal(history.id, 'msg-long');
    assert.equal(history.turn, 2);
    assert.equal(history.label, '故事正文');
  });

  it('结构化候选证据同样受 500 字上限约束', () => {
    const state = makeState({
      characters: [{
        id: 'char-long',
        name: '长名',
        aliases: [],
        role: '测试',
        description: '长'.repeat(800),
        status: 'active',
        knownFacts: [],
        firstSeenTurn: 1,
        lastSeenTurn: 2,
      }],
    });
    const characters = buildContextCandidates(state).filter((item) => item.source === 'characters');
    assert.equal(characters.length, 1);
    assert.ok(characters[0].evidence.length <= CONTEXT_EVIDENCE_MAX_CHARS + 2);
  });
});

describe('contextSearch.scoreContextCandidate — 评分与排序权重', () => {
  const exact = candidate({ id: 'exact', searchable: '旧书店的老板把门锁上了。' });
  const partial = candidate({ id: 'partial', searchable: '旧书摊的棚布往下淌。' });
  const query = parseSearchQuery('旧书店');

  it('整串命中高于只命中散词', () => {
    const exactScore = scoreContextCandidate(exact, query);
    const partialScore = scoreContextCandidate(partial, query);
    assert.ok(exactScore.score > partialScore.score, `${exactScore.score} 应大于 ${partialScore.score}`);
    assert.equal(exactScore.coverage, 1);
    assert.ok(partialScore.coverage < 1);
    assert.ok(exactScore.matchedTerms.includes('旧书店'));
  });

  it('N 回归：更相关的正文不再被 facts 的大 magic 加成压过', () => {
    const historyHit = scoreContextCandidate(exact, query).score;
    const factsWeak = scoreContextCandidate(
      candidate({ id: 'fact-weak', source: 'facts', label: '正史事实：旧书', searchable: '旧书' }),
      query,
    ).score;
    assert.ok(historyHit > factsWeak, `正文全串命中 ${historyHit} 应压过 facts 弱命中 ${factsWeak}`);
  });

  it('来源加成收敛为小权重：facts +3、其他结构 +1、history 0', () => {
    const text = '旧书店的老板把门锁上了。';
    const historyScore = scoreContextCandidate(candidate({ source: 'history', searchable: text }), query).score;
    const factsScore = scoreContextCandidate(candidate({ source: 'facts', searchable: text }), query).score;
    const characterScore = scoreContextCandidate(candidate({ source: 'characters', searchable: text }), query).score;
    assert.equal(factsScore - historyScore, 3);
    assert.equal(characterScore - historyScore, 1);
  });

  it('覆盖率随命中词占比提高；无命中返回 0 分', () => {
    const multi = parseSearchQuery('阿黎 旧书店');
    const both = scoreContextCandidate(candidate({ searchable: '阿黎在旧书店打工。' }), multi);
    const one = scoreContextCandidate(candidate({ searchable: '阿黎在家。' }), multi);
    assert.equal(both.coverage, 1);
    assert.equal(one.coverage, 0.25);
    assert.ok(both.score > one.score);
    const miss = scoreContextCandidate(candidate({ searchable: '完全无关的句子。' }), multi);
    assert.equal(miss.score, 0);
    assert.deepEqual(miss.matchedTerms, []);
  });

  it('纯停用词查询没有有效词，不把整篇正文算作命中', () => {
    const stopwordsOnly = parseSearchQuery('的 了 我们 然后');
    assert.deepEqual(stopwordsOnly.terms, []);
    const scored = scoreContextCandidate(candidate({ searchable: '我们的然后的' }), stopwordsOnly);
    assert.equal(scored.score, 0);
  });
});

describe('contextSearch.selectContextResults — 过滤/排序/配额/去重', () => {
  it('按 score 降序：整串命中排第一', () => {
    const results = selectContextResults([
      candidate({ id: 'partial', turn: 9, evidence: '旧书摊的棚布。', searchable: '旧书摊的棚布。' }),
      candidate({ id: 'exact', turn: 1, evidence: '旧书店的老板。', searchable: '旧书店的老板。' }),
    ], parseSearchQuery('旧书店'));
    assert.deepEqual(results.map((item) => item.id), ['exact', 'partial']);
  });

  it('同分时按 turn 降序（最近的证据优先）', () => {
    const results = selectContextResults([
      candidate({ id: 'old', turn: 2, evidence: '阿黎来了。', searchable: '阿黎来了。' }),
      candidate({ id: 'new', turn: 8, evidence: '阿黎走了。', searchable: '阿黎走了。' }),
    ], parseSearchQuery('阿黎'));
    assert.deepEqual(results.map((item) => item.id), ['new', 'old']);
  });

  it('同一来源最多 2 条', () => {
    const candidates = [1, 2, 3, 4, 5].map((index) => candidate({
      id: `h-${index}`,
      turn: index,
      evidence: `第 ${index} 段雨`,
      searchable: `第 ${index} 段雨`,
    }));
    const results = selectContextResults(candidates, parseSearchQuery('雨'), { limit: 8 });
    assert.equal(results.length, CONTEXT_SEARCH_SOURCE_LIMIT);
    assert.ok(results.every((item) => item.source === 'history'));
  });

  it('按 (source,label,evidence) 去重，且重复项不占用来源配额', () => {
    const duplicateText = '同一段雨';
    const results = selectContextResults([
      candidate({ id: 'a1', source: 'history', label: '故事正文', evidence: duplicateText, searchable: duplicateText }),
      candidate({ id: 'a2', source: 'history', label: '故事正文', evidence: duplicateText, searchable: duplicateText }),
      candidate({ id: 'b', source: 'history', label: '故事正文', evidence: '另一段雨', searchable: '另一段雨' }),
      candidate({ id: 'c', source: 'history', label: '故事正文', evidence: '第三段雨', searchable: '第三段雨' }),
    ], parseSearchQuery('雨'), { limit: 8 });
    assert.deepEqual(results.map((item) => item.id), ['a1', 'b']);
  });

  it('scope 过滤：只返回指定来源；all 返回全部', () => {
    const candidates = [
      candidate({ id: 'h-1', source: 'history', searchable: '阿黎来了。' }),
      candidate({ id: 'c-1', source: 'characters', label: '人物：阿黎', searchable: '阿黎（char-a）' }),
    ];
    const charactersOnly = selectContextResults(candidates, parseSearchQuery('阿黎'), { scope: 'characters' });
    assert.deepEqual(charactersOnly.map((item) => item.source), ['characters']);
    const all = selectContextResults(candidates, parseSearchQuery('阿黎'), { scope: 'all' });
    assert.deepEqual([...new Set(all.map((item) => item.source))].sort(), ['characters', 'history']);
  });

  it('非法 scope 回退 all（不抛错）', () => {
    const candidates = [candidate({ id: 'c-1', source: 'characters', label: '人物：阿黎', searchable: '阿黎来了。' })];
    const results = selectContextResults(candidates, parseSearchQuery('阿黎'), { scope: ' Characters ' });
    assert.equal(results.length, 1, '大小写/空白应被接受');
    const fallback = selectContextResults(candidates, parseSearchQuery('阿黎'), { scope: 'unknown' });
    assert.equal(fallback.length, 1, '未知 scope 回退 all');
  });

  it('limit 夹取到 [1, 8]；非法值回退默认 5', () => {
    const sources: Array<Exclude<ContextSearchScope, 'all'>> = ['history', 'characters', 'relationships', 'facts', 'threads'];
    const many = sources.flatMap((source) => [1, 2, 3].map((index) => candidate({
      id: `${source}-${index}`,
      source,
      label: `来源-${source}-${index}`,
      evidence: `雨${index}`,
      searchable: `雨${index}`,
    })));
    const limitOf = (limit: unknown) => selectContextResults(many, parseSearchQuery('雨'), { limit }).length;
    assert.equal(limitOf(0), 1);
    assert.equal(limitOf(99), CONTEXT_SEARCH_MAX_LIMIT);
    assert.equal(limitOf('3'), 3);
    assert.equal(limitOf('not-a-number'), 5);
    assert.equal(limitOf(undefined), 5);
  });

  it('score=0 的候选被过滤；空 query 直接返回空数组', () => {
    const results = selectContextResults([
      candidate({ id: 'miss', searchable: '完全无关。' }),
      candidate({ id: 'hit', searchable: '旧书店的老板。' }),
    ], parseSearchQuery('旧书店'));
    assert.deepEqual(results.map((item) => item.id), ['hit']);
    assert.deepEqual(selectContextResults([candidate({ searchable: '旧书店' })], parseSearchQuery('')), []);
  });
});

describe('contextSearch.buildSearchResponse — 工具返回结构', () => {
  it('保持 query/scope/resultCount/results/note 兼容，results 增加 matchedTerms/score', () => {
    const candidates = [
      candidate({ id: 'h-1', turn: 3, evidence: '旧书店的老板把门锁上了。', searchable: '旧书店的老板把门锁上了。' }),
      candidate({ id: 'h-2', turn: 5, evidence: '旧书摊的棚布往下淌。', searchable: '旧书摊的棚布往下淌。' }),
    ];
    const response = buildSearchResponse(candidates, parseSearchQuery('旧书店'));
    assert.equal(response.query, '旧书店');
    assert.equal(response.scope, 'all');
    assert.equal(response.resultCount, 2);
    assert.equal(response.note, CONTEXT_SEARCH_EVIDENCE_NOTE);
    const first = response.results[0];
    assert.equal(first.source, 'history');
    assert.equal(first.id, 'h-1');
    assert.equal(first.turn, 3);
    assert.equal(typeof first.label, 'string');
    assert.equal(typeof first.evidence, 'string');
    assert.ok(Array.isArray(first.matchedTerms) && first.matchedTerms.includes('旧书店'));
    assert.equal(typeof first.score, 'number');
  });

  it('0 结果时给出可操作 hint（更短关键词 / scope）', () => {
    const response = buildSearchResponse(
      [candidate({ id: 'h-1', searchable: '完全无关。' })],
      parseSearchQuery('不存在的人'),
    );
    assert.equal(response.resultCount, 0);
    assert.deepEqual(response.results, []);
    assert.equal(response.note, CONTEXT_SEARCH_EMPTY_NOTE);
    assert.ok(response.note.includes('更短'));
    assert.ok(response.note.includes('scope'));
    assert.ok(response.note.includes('不要据此编造历史'));
  });

  it('scope/limit 参数规范化后写进响应；空 query/坏候选不抛错', () => {
    const candidates = [
      candidate({ id: 'h-1', searchable: '阿黎来了。' }),
      candidate({ id: 'c-1', source: 'characters', label: '人物：阿黎', searchable: '阿黎（char-a）' }),
    ];
    const scoped = buildSearchResponse(candidates, parseSearchQuery('阿黎'), { scope: 'characters', limit: '1' });
    assert.equal(scoped.scope, 'characters');
    assert.equal(scoped.resultCount, 1);
    assert.equal(buildSearchResponse(candidates, parseSearchQuery('阿黎'), { scope: 'nope' }).scope, 'all');
    const empty = buildSearchResponse(candidates, parseSearchQuery(''));
    assert.equal(empty.resultCount, 0);
    assert.equal(empty.note, CONTEXT_SEARCH_EMPTY_NOTE);
    const badCandidates = buildSearchResponse(undefined as unknown as ContextSearchCandidate[], parseSearchQuery('阿黎'));
    assert.equal(badCandidates.resultCount, 0);
  });
});
