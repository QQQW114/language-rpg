export interface LlmCacheUsage {
  /** DeepSeek: prompt_cache_hit_tokens */
  hitTokens?: number;
  /** DeepSeek: prompt_cache_miss_tokens */
  missTokens?: number;
  /** 部分供应商（含 *_tokens_details.cached_tokens 形式）的缓存命中统计 */
  cachedTokens?: number;
}

export interface LlmUsage {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  cache?: LlmCacheUsage;
}
