import type { LlmCacheUsage, LlmUsage } from '@/types/llm';

function asFiniteNumber(value: unknown): number | undefined {
  if (value === null || value === undefined || value === '') return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function hasNumber(value: number | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * 归一化供应商返回的 usage。
 *
 * **两种缓存口径必须区分**（这是本项目此前算错的地方）：
 *
 * 1. **OpenAI 风格**：`prompt_tokens` 已经是完整输入量，`prompt_tokens_details.cached_tokens`
 *    是其中的子集；此时输入总量直接用 `prompt_tokens`。
 * 2. **Anthropic / DeepSeek 风格**：`input_tokens`（DSH 内部叫 `uncachedInputTokens`）
 *    **只表示未命中缓存的部分**，完整输入量 = `input_tokens` + `cache_read_input_tokens`
 *    + `cache_creation_input_tokens`。参考 DeepSeek 官方文档：`usage` 里通过
 *    `prompt_cache_hit_tokens` / `prompt_cache_miss_tokens` 反映命中情况，两者之和
 *    才是本次请求的输入总量。
 *
 * 另外 DeepSeek **原生**字段是 `prompt_cache_hit_tokens` / `prompt_cache_miss_tokens`
 * （在 usage 顶层，不在 `prompt_tokens_details` 里），此前只认嵌套写法，导致
 * DeepSeek 的缓存命中永远显示为 0。
 */
export function normalizeLlmUsage(raw: unknown): LlmUsage | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const obj = raw as any;
  const cacheObj = obj.cache && typeof obj.cache === 'object' ? obj.cache as any : {};

  // 只有 `prompt_tokens` 才是"完整输入量"；`input_tokens` 的口径取决于供应商：
  //   - 与 `prompt_cache_miss_tokens` 同现（DeepSeek 原生）→ miss 是它的补集，需相加；
  //   - 与 `cache_read_input_tokens` / `cache_creation_input_tokens` 同现（Anthropic）
  //     → 它是未命中部分，需相加；
  //   - 与 `input_tokens_details.cached_tokens` 同现（OpenAI 兼容代理）
  //     → 完整量，cached 是它的子集，不能相加。
  const openAiStylePrompt = asFiniteNumber(obj.prompt_tokens ?? obj.promptTokens);
  const uncachedInput = asFiniteNumber(obj.input_tokens ?? obj.inputTokens);
  const completionTokens = asFiniteNumber(
    obj.completion_tokens
      ?? obj.output_tokens
      ?? obj.completionTokens
      ?? obj.outputTokens,
  );
  const totalTokens = asFiniteNumber(obj.total_tokens ?? obj.totalTokens);

  const hitTokens = asFiniteNumber(
    obj.prompt_cache_hit_tokens
      ?? obj.promptCacheHitTokens
      ?? cacheObj.hitTokens
      ?? cacheObj.prompt_cache_hit_tokens
      ?? cacheObj.promptCacheHitTokens,
  );
  const missTokens = asFiniteNumber(
    obj.prompt_cache_miss_tokens
      ?? obj.promptCacheMissTokens
      ?? cacheObj.missTokens
      ?? cacheObj.prompt_cache_miss_tokens
      ?? cacheObj.promptCacheMissTokens,
  );
  const detailCached = asFiniteNumber(
    obj.prompt_tokens_details?.cached_tokens
      ?? obj.input_tokens_details?.cached_tokens,
  );
  const nativeCacheRead = asFiniteNumber(obj.cache_read_input_tokens);
  const cachedTokens = asFiniteNumber(
    detailCached
      ?? nativeCacheRead
      ?? obj.cached_tokens
      ?? obj.cachedTokens
      ?? cacheObj.cachedTokens
      ?? cacheObj.cached_tokens
      ?? cacheObj.cache_read_input_tokens,
  );
  const cacheWriteTokens = asFiniteNumber(
    obj.cache_creation_input_tokens
      ?? obj.cacheCreationInputTokens
      ?? cacheObj.cacheWriteTokens
      ?? cacheObj.cache_creation_input_tokens,
  );

  const cacheRead = hitTokens ?? cachedTokens;
  // `input_tokens` 是否需要补上缓存量：只有"未命中部分"语义才需要。
  const inputExcludesCache = missTokens !== undefined
    || nativeCacheRead !== undefined
    || cacheWriteTokens !== undefined;
  // 完整输入量只从两个可信来源取：
  //   1. `prompt_tokens`（OpenAI 风格，已是完整量）；
  //   2. `input_tokens`（按上面的口径判断要不要补缓存量）。
  // **不从缓存字段反推总量**：命中量单独出现时它显然不是总量（反推会造出"100%
  // 命中"的假数据），而未命中量也可能只是部分统计。宁可留空、界面显示为"—"，
  // 也不要给出一个看起来精确的错数字。
  const promptTokens = openAiStylePrompt ?? (
    uncachedInput !== undefined
      ? uncachedInput + (inputExcludesCache ? (cacheRead ?? 0) + (cacheWriteTokens ?? 0) : 0)
      : undefined
  );
  // 未命中量：优先用供应商明说的 miss；否则用"完整输入量 − 命中量"派生。
  // promptTokens 缺失时不派生（否则会得到上面那种假的 0）。
  const derivedMiss = missTokens ?? (
    promptTokens !== undefined && cacheRead !== undefined
      ? Math.max(0, promptTokens - cacheRead)
      : undefined
  );

  const cache: LlmCacheUsage = {};
  if (hasNumber(cacheRead)) cache.hitTokens = cacheRead;
  if (hasNumber(derivedMiss)) cache.missTokens = derivedMiss;
  if (hasNumber(cachedTokens)) cache.cachedTokens = cachedTokens;
  if (hasNumber(cacheWriteTokens)) cache.writeTokens = cacheWriteTokens;

  const normalized: LlmUsage = {};
  if (hasNumber(promptTokens)) normalized.promptTokens = promptTokens;
  if (hasNumber(completionTokens)) normalized.completionTokens = completionTokens;
  // 供应商没给 total_tokens 时按"输入 + 输出"补，而不是留空让界面显示 0。
  const effectiveTotal = totalTokens ?? (
    promptTokens !== undefined || completionTokens !== undefined
      ? (promptTokens ?? 0) + (completionTokens ?? 0)
      : undefined
  );
  if (hasNumber(effectiveTotal)) normalized.totalTokens = effectiveTotal;
  if (Object.keys(cache).length) normalized.cache = cache;

  return normalized.promptTokens !== undefined
    || normalized.completionTokens !== undefined
    || normalized.totalTokens !== undefined
    || normalized.cache
    ? normalized
    : undefined;
}

export function mergeLlmUsage(previous: LlmUsage | undefined, next: LlmUsage | undefined): LlmUsage | undefined {
  if (!previous) return next;
  if (!next) return previous;
  // 逐字段保留已知值：normalizeLlmUsage 产出的 cache 只写有值的字段，
  // 直接用对象展开会把上一帧已经拿到的 hitTokens 覆盖成 undefined。
  //
  // 缓存计数用 `Math.max` 而不是"后者覆盖前者"：一次流式响应里会先后到达多个
  // usage 帧，后面的帧可能只带部分字段（例如只重复 hit 而没有 miss）。用覆盖
  // 会把先到的完整统计抹成 0，前提是这些计数在一次请求内单调不减——事实如此
  // （它们描述的是同一个请求的累计量）。
  const pickMax = (a: number | undefined, b: number | undefined) => {
    if (!hasNumber(a)) return hasNumber(b) ? b : undefined;
    if (!hasNumber(b)) return a;
    return Math.max(a, b);
  };
  const cache: LlmCacheUsage = {};
  const hitTokens = pickMax(previous.cache?.hitTokens, next.cache?.hitTokens);
  const missTokens = pickMax(previous.cache?.missTokens, next.cache?.missTokens);
  const cachedTokens = pickMax(previous.cache?.cachedTokens, next.cache?.cachedTokens);
  const writeTokens = pickMax(previous.cache?.writeTokens, next.cache?.writeTokens);
  if (hasNumber(hitTokens)) cache.hitTokens = hitTokens;
  if (hasNumber(missTokens)) cache.missTokens = missTokens;
  if (hasNumber(cachedTokens)) cache.cachedTokens = cachedTokens;
  if (hasNumber(writeTokens)) cache.writeTokens = writeTokens;
  return {
    promptTokens: pickMax(previous.promptTokens, next.promptTokens),
    completionTokens: next.completionTokens ?? previous.completionTokens,
    totalTokens: pickMax(previous.totalTokens, next.totalTokens),
    ...(Object.keys(cache).length ? { cache } : {}),
  };
}

/**
 * 缓存命中率（0~1）。
 *
 * 分母只认 `promptTokens`（归一化后它已经是完整输入量）：
 *   - 不用"命中 + 未命中"当分母，因为未命中量可能是供应商的部分统计，
 *     而命中量单独出现时更不是总量（用它当分母会得到恒等于 100% 的假数字）；
 *   - 不把输出算进分母：输出从不进 KV 缓存，混进来只会让命中率莫名偏低。
 * 数据不足以判断时返回 undefined，界面显示为"—"。
 */
export function cacheHitRate(usage: LlmUsage | undefined): number | undefined {
  const cache = usage?.cache;
  if (!cache) return undefined;
  const hit = cache.hitTokens ?? cache.cachedTokens;
  const total = usage?.promptTokens;
  if (hit === undefined || total === undefined || total <= 0) return undefined;
  return Math.max(0, Math.min(1, hit / total));
}

/** 命中率的显示串（例如 "97.3%"）；样本不足时返回 undefined。 */
export function formatCacheHitRate(usage: LlmUsage | undefined): string | undefined {
  const rate = cacheHitRate(usage);
  if (rate === undefined) return undefined;
  return `${(rate * 100).toFixed(1)}%`;
}

export function hasCacheHit(usage: LlmUsage | undefined, explicit?: boolean): boolean {
  if (explicit) return true;
  const cache = usage?.cache;
  return !!cache && (
    (cache.hitTokens ?? 0) > 0
    || (cache.cachedTokens ?? 0) > 0
  );
}

export function describeCacheHit(usage: LlmUsage | undefined): string {
  const cache = usage?.cache;
  if (!cache) return '缓存命中';
  const hit = cache.hitTokens ?? cache.cachedTokens ?? 0;
  const miss = cache.missTokens ?? 0;
  return `缓存命中 token / 缓存未命中 token：${hit} / ${miss}`;
}

function compactTokenCount(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '0';
  if (value >= 1000) {
    const k = value / 1000;
    return `${Number.isInteger(k) ? k.toFixed(0) : k.toFixed(k >= 10 ? 1 : 1).replace(/\.0$/, '')}k`;
  }
  return String(Math.round(value));
}

export function formatCacheTokenPair(usage: LlmUsage | undefined): string | undefined {
  const cache = usage?.cache;
  if (!cache) return undefined;
  const hit = cache.hitTokens ?? cache.cachedTokens ?? 0;
  const miss = cache.missTokens ?? 0;
  if (hit <= 0 && miss <= 0) return undefined;
  return `${compactTokenCount(hit)}/${compactTokenCount(miss)}`;
}
