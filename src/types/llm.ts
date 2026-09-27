export interface LlmCacheUsage {
  /** 命中缓存的输入 token（DeepSeek: `prompt_cache_hit_tokens`；Anthropic: `cache_read_input_tokens`） */
  hitTokens?: number;
  /** 未命中缓存的输入 token（DeepSeek: `prompt_cache_miss_tokens`；未提供时由总量派生） */
  missTokens?: number;
  /** 部分供应商（含 `*_tokens_details.cached_tokens`）的缓存命中统计，语义同 hitTokens */
  cachedTokens?: number;
  /** 写入缓存的新 token（Anthropic: `cache_creation_input_tokens`）；DeepSeek 不提供 */
  writeTokens?: number;
}

export interface LlmUsage {
  /**
   * 完整输入 token 数。
   *
   * 注意两种供应商口径：OpenAI 风格的 `prompt_tokens` 已包含缓存命中部分；
   * Anthropic / DeepSeek 风格的 `input_tokens` **只表示未命中部分**，这里会补上
   * 缓存读写，因此本字段始终是"本次请求的输入总量"。
   */
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  cache?: LlmCacheUsage;
}
