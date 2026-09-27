import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  cacheHitRate,
  describeCacheHit,
  formatCacheHitRate,
  formatCacheTokenPair,
  hasCacheHit,
  mergeLlmUsage,
  normalizeLlmUsage,
} from '@/lib/llmUsage';

describe('llmUsage.normalizeLlmUsage', () => {
  it('DeepSeek：prompt_cache_hit/miss_tokens 归一化', () => {
    const usage = normalizeLlmUsage({
      prompt_tokens: 100,
      completion_tokens: 20,
      total_tokens: 120,
      prompt_cache_hit_tokens: 64,
      prompt_cache_miss_tokens: 36,
    });
    // 回归：此前会产出带显式 undefined 键的 cache 对象（cachedTokens: undefined），
    // 导致 mergeLlmUsage 的字段合并要额外绕开它。现在只写有值的字段。
    assert.deepEqual(usage, {
      promptTokens: 100,
      completionTokens: 20,
      totalTokens: 120,
      cache: { hitTokens: 64, missTokens: 36 },
    });
  });

  it('只有缓存字段、没有总量时不反推输入量（回归：曾把命中量当成总量，造出 100% 命中）', () => {
    // DeepSeek 官方文档：prompt_cache_hit_tokens / prompt_cache_miss_tokens 反映命中情况。
    // 但单看命中量不能断定它就是全部输入，因此不反推总量——宁可留空也不给假数字。
    const onlyHit = normalizeLlmUsage({ prompt_cache_hit_tokens: 900 });
    assert.equal(onlyHit?.promptTokens, undefined, '不能把命中量当成完整输入量');
    assert.equal(onlyHit?.cache?.missTokens, undefined, '没有总量时不能把未命中派生成 0');
    assert.equal(cacheHitRate(onlyHit), undefined, '数据不足时不显示命中率');

    // 供应商同时给了命中与未命中（DeepSeek 原生形态）：注入量照实保留，
    // 但总量缺失时仍不猜，命中率显示为"数据不足"。
    const both = normalizeLlmUsage({ prompt_cache_hit_tokens: 900, prompt_cache_miss_tokens: 100, completion_tokens: 50 });
    assert.equal(both?.promptTokens, undefined, '没有 prompt_tokens 时不臆测总量');
    assert.equal(both?.cache?.hitTokens, 900);
    assert.equal(both?.cache?.missTokens, 100);
    assert.equal(cacheHitRate(both), undefined, '分母不可信时不显示命中率');
    assert.equal(both?.totalTokens, 50, '输出量仍照实保留');
  });

  it('DeepSeek 同时给出 prompt_tokens 与原生缓存字段时完整可用', () => {
    const usage = normalizeLlmUsage({
      prompt_tokens: 1000,
      completion_tokens: 50,
      prompt_cache_hit_tokens: 900,
      prompt_cache_miss_tokens: 100,
    });
    assert.equal(usage?.promptTokens, 1000);
    assert.equal(usage?.totalTokens, 1050);
    assert.equal(cacheHitRate(usage), 0.9);
    assert.equal(formatCacheHitRate(usage), '90.0%');
  });

  it('OpenAI：prompt_tokens_details.cached_tokens 归一化', () => {
    const usage = normalizeLlmUsage({
      prompt_tokens: 100,
      completion_tokens: 20,
      total_tokens: 120,
      prompt_tokens_details: { cached_tokens: 32 },
    });
    assert.equal(usage?.promptTokens, 100, 'OpenAI 风格下 prompt_tokens 已是完整输入量');
    assert.equal(usage?.cache?.cachedTokens, 32);
    assert.equal(usage?.cache?.hitTokens, 32, '命中量统一走 hitTokens，便于统一计算命中率');
    assert.equal(usage?.cache?.missTokens, 68, '未命中量由"总量 − 命中"派生');
  });

  it('OpenAI 兼容代理用 input_tokens 时，cached_tokens 是子集不参与相加（回归）', () => {
    const usage = normalizeLlmUsage({ input_tokens: 10, output_tokens: 5, input_tokens_details: { cached_tokens: 4 } });
    assert.equal(usage?.promptTokens, 10, 'input_tokens_details 是 OpenAI 语义，完整量即 input_tokens');
    assert.equal(usage?.completionTokens, 5);
    assert.equal(usage?.cache?.cachedTokens, 4);
    assert.equal(usage?.cache?.missTokens, 6);
  });

  it('Anthropic 风格：input_tokens 是未命中部分，完整量需加上缓存读写（回归）', () => {
    const usage = normalizeLlmUsage({
      input_tokens: 120,
      output_tokens: 40,
      cache_read_input_tokens: 880,
      cache_creation_input_tokens: 20,
    });
    assert.equal(usage?.promptTokens, 1020, '120 未命中 + 880 命中读 + 20 写入');
    assert.equal(usage?.cache?.hitTokens, 880);
    assert.equal(usage?.cache?.writeTokens, 20);
    assert.equal(usage?.cache?.missTokens, 140, '未命中 = 120 未命中输入 + 20 写入');
  });

  it('已规范化的 camelCase 数据二次归一化不会丢缓存字段', () => {
    const usage = normalizeLlmUsage({ promptTokens: 10, completionTokens: 2, cache: { hitTokens: 4, missTokens: 6 } });
    assert.equal(usage?.promptTokens, 10);
    assert.equal(usage?.cache?.hitTokens, 4);
    assert.equal(usage?.cache?.missTokens, 6);
  });

  it('非对象 / 空对象 / 非数字返回 undefined', () => {
    assert.equal(normalizeLlmUsage(undefined), undefined);
    assert.equal(normalizeLlmUsage(null), undefined);
    assert.equal(normalizeLlmUsage('100'), undefined);
    assert.equal(normalizeLlmUsage(42), undefined);
    assert.equal(normalizeLlmUsage({}), undefined);
    assert.equal(normalizeLlmUsage({ prompt_tokens: 'abc', completion_tokens: null }), undefined);
  });

  it('数字字符串与 0 会被保留', () => {
    const usage = normalizeLlmUsage({ total_tokens: '0', prompt_tokens: '12' });
    assert.equal(usage?.totalTokens, 0);
    assert.equal(usage?.promptTokens, 12);
    // 空字符串视为未提供。
    assert.equal(normalizeLlmUsage({ prompt_tokens: '' }), undefined);
  });
});

describe('llmUsage.mergeLlmUsage', () => {
  it('单侧缺失时直接返回另一侧', () => {
    const usage = { promptTokens: 1 };
    assert.equal(mergeLlmUsage(undefined, usage), usage);
    assert.equal(mergeLlmUsage(usage, undefined), usage);
    assert.equal(mergeLlmUsage(undefined, undefined), undefined);
  });

  it('顶层字段是“后者覆盖前者”，不是累加（与任务清单描述的差异）', () => {
    const merged = mergeLlmUsage({ promptTokens: 1, completionTokens: 2, totalTokens: 3 }, { promptTokens: 5, totalTokens: 6 });
    assert.equal(merged?.promptTokens, 5);
    assert.equal(merged?.completionTokens, 2);
    assert.equal(merged?.totalTokens, 6);
    // 未做加法：如果累加，promptTokens 应为 6。
    assert.notEqual(merged?.promptTokens, 6);
  });

  it('手写 cache 对象按字段合并', () => {
    const merged = mergeLlmUsage({ cache: { hitTokens: 4, missTokens: 1 } }, { cache: { missTokens: 7 } });
    assert.deepEqual(merged?.cache, { hitTokens: 4, missTokens: 7 });
  });

  it('经 normalizeLlmUsage 规范化后的 cache 按字段保留，不丢上一帧命中（回归）', () => {
    const first = normalizeLlmUsage({ prompt_tokens: 10, prompt_cache_hit_tokens: 4 });
    const second = normalizeLlmUsage({ completion_tokens: 5, prompt_cache_miss_tokens: 3 });
    const merged = mergeLlmUsage(first, second);
    assert.equal(merged?.completionTokens, 5);
    assert.equal(merged?.promptTokens, 10);
    // 未命中量取自第一帧的派生值（10 − 4 = 6，是"这一帧已知总量里未命中多少"这个
    // 更完整的信息），而不是第二帧光秃秃的 3。
    assert.equal(merged?.cache?.missTokens, 6);
    // 回归：曾因 { ...previous.cache, ...next.cache } 里 next.cache 带显式
    // undefined 键，把上一帧已拿到的 hitTokens 覆盖成 undefined。
    assert.equal(merged?.cache?.hitTokens, 4);
  });

  it('缓存计数取两帧中的较大值，后到的残缺帧不会把已统计的量抹成 0（回归）', () => {
    // 一次流式响应里会先后到达多个 usage 帧，后者可能只重复其中一部分字段。
    const complete = normalizeLlmUsage({ prompt_tokens: 1000, prompt_cache_hit_tokens: 900, prompt_cache_miss_tokens: 100 });
    const partial = normalizeLlmUsage({ prompt_tokens: 1000, prompt_cache_hit_tokens: 900 });
    const merged = mergeLlmUsage(complete, partial);
    assert.equal(merged?.cache?.hitTokens, 900);
    assert.equal(merged?.cache?.missTokens, 100, '不能被后到的残缺帧抹成 0');
    assert.equal(merged?.promptTokens, 1000);
    // 反向顺序同样成立
    const reversed = mergeLlmUsage(partial, complete);
    assert.equal(reversed?.cache?.missTokens, 100);
  });

  it('cache 同字段由后者覆盖，三轮合并不丢任何已知值', () => {
    const merged = mergeLlmUsage(
      mergeLlmUsage(normalizeLlmUsage({ prompt_cache_hit_tokens: 4 }), normalizeLlmUsage({ prompt_cache_miss_tokens: 3 })),
      normalizeLlmUsage({ prompt_cache_hit_tokens: 9, prompt_tokens_details: { cached_tokens: 2 } }),
    );
    assert.equal(merged?.cache?.hitTokens, 9);
    assert.equal(merged?.cache?.missTokens, 3);
    assert.equal(merged?.cache?.cachedTokens, 2);
  });

  it('两侧都没有 cache 时不写入 cache 字段', () => {
    const merged = mergeLlmUsage({ promptTokens: 1 }, { completionTokens: 2 });
    assert.equal('cache' in (merged ?? {}), false);
  });
});

describe('llmUsage 展示辅助', () => {
  it('hasCacheHit 判定命中', () => {
    assert.equal(hasCacheHit(undefined), false);
    assert.equal(hasCacheHit({ cache: { hitTokens: 0, cachedTokens: 0 } }), false);
    assert.equal(hasCacheHit({ cache: { hitTokens: 3 } }), true);
    assert.equal(hasCacheHit({ cache: { cachedTokens: 5 } }), true);
    assert.equal(hasCacheHit(undefined, true), true);
  });

  it('describeCacheHit 文案', () => {
    assert.equal(describeCacheHit(undefined), '缓存命中');
    assert.equal(describeCacheHit({ cache: { hitTokens: 4, missTokens: 3 } }), '缓存命中 token / 缓存未命中 token：4 / 3');
    assert.equal(describeCacheHit({ cache: { cachedTokens: 8 } }), '缓存命中 token / 缓存未命中 token：8 / 0');
  });

  it('formatCacheTokenPair 压缩大数字并在无命中时返回 undefined', () => {
    assert.equal(formatCacheTokenPair(undefined), undefined);
    assert.equal(formatCacheTokenPair({ cache: { hitTokens: 0, missTokens: 0 } }), undefined);
    assert.equal(formatCacheTokenPair({ cache: { hitTokens: 1500, missTokens: 200 } }), '1.5k/200');
    assert.equal(formatCacheTokenPair({ cache: { hitTokens: 2000, missTokens: 12000 } }), '2k/12k');
    assert.equal(formatCacheTokenPair({ cache: { cachedTokens: 32 } }), '32/0');
  });
});
