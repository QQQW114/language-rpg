export interface LlmCacheUsage {
  /** DeepSeek: prompt_cache_hit_tokens */
  hitTokens?: number;
  /** DeepSeek: prompt_cache_miss_tokens */
  missTokens?: number;
  /** OpenAI/Responses: *_tokens_details.cached_tokens */
  cachedTokens?: number;
}

export interface LlmUsage {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  cache?: LlmCacheUsage;
}
