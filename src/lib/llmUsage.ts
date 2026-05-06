import type { LlmCacheUsage, LlmUsage } from '@/types/llm';

function asFiniteNumber(value: unknown): number | undefined {
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function hasNumber(value: number | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

export function normalizeLlmUsage(raw: unknown): LlmUsage | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const obj = raw as any;
  const promptTokens = asFiniteNumber(obj.prompt_tokens ?? obj.input_tokens);
  const completionTokens = asFiniteNumber(obj.completion_tokens ?? obj.output_tokens);
  const totalTokens = asFiniteNumber(obj.total_tokens);

  const cache: LlmCacheUsage = {
    hitTokens: asFiniteNumber(obj.prompt_cache_hit_tokens),
    missTokens: asFiniteNumber(obj.prompt_cache_miss_tokens),
    cachedTokens: asFiniteNumber(
      obj.prompt_tokens_details?.cached_tokens
        ?? obj.input_tokens_details?.cached_tokens
        ?? obj.cache_read_input_tokens
        ?? obj.cached_tokens,
    ),
  };

  const normalized: LlmUsage = {};
  if (hasNumber(promptTokens)) normalized.promptTokens = promptTokens;
  if (hasNumber(completionTokens)) normalized.completionTokens = completionTokens;
  if (hasNumber(totalTokens)) normalized.totalTokens = totalTokens;
  if (hasNumber(cache.hitTokens) || hasNumber(cache.missTokens) || hasNumber(cache.cachedTokens)) {
    normalized.cache = cache;
  }

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
  return {
    promptTokens: next.promptTokens ?? previous.promptTokens,
    completionTokens: next.completionTokens ?? previous.completionTokens,
    totalTokens: next.totalTokens ?? previous.totalTokens,
    cache: {
      ...previous.cache,
      ...next.cache,
    },
  };
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
