import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  describeCacheHit,
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
    assert.deepEqual(usage, {
      promptTokens: 100,
      completionTokens: 20,
      totalTokens: 120,
      cache: { hitTokens: 64, missTokens: 36, cachedTokens: undefined },
    });
  });

  it('OpenAI：prompt_tokens_details.cached_tokens 归一化', () => {
    const usage = normalizeLlmUsage({
      prompt_tokens: 100,
      completion_tokens: 20,
      total_tokens: 120,
      prompt_tokens_details: { cached_tokens: 32 },
    });
    assert.equal(usage?.promptTokens, 100);
    assert.equal(usage?.cache?.cachedTokens, 32);
    assert.equal(usage?.cache?.hitTokens, undefined);
    assert.equal(usage?.cache?.missTokens, undefined);
  });

  it('部分供应商使用 input_tokens/output_tokens 命名时的归一化', () => {
    const usage = normalizeLlmUsage({ input_tokens: 10, output_tokens: 5, input_tokens_details: { cached_tokens: 4 } });
    assert.equal(usage?.promptTokens, 10);
    assert.equal(usage?.completionTokens, 5);
    assert.equal(usage?.cache?.cachedTokens, 4);
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
    assert.equal(merged?.cache?.missTokens, 3);
    // 回归：曾因 { ...previous.cache, ...next.cache } 里 next.cache 带显式
    // undefined 键，把上一帧已拿到的 hitTokens 覆盖成 undefined。
    assert.equal(merged?.cache?.hitTokens, 4);
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
