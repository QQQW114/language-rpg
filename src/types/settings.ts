export type ApiFormat = 'chat' | 'responses';

export type PlannerContextPreset = 'compact' | 'standard' | 'rich' | 'custom';
export type ProviderFeatureMode = 'auto' | 'enabled' | 'disabled';
export type ReasoningEffort = 'high' | 'max';

export const PLANNER_CONTEXT_PRESET_TOKENS: Record<
  Exclude<PlannerContextPreset, 'custom'>,
  number
> = {
  compact: 16_000,
  standard: 32_000,
  rich: 64_000,
};

export interface AppSettings {
  apiBaseUrl: string;
  apiKey: string;
  apiFormat: ApiFormat;
  storyModel: string;
  plannerModel: string;
  temperatureStory: number;
  storyMaxTokens: number;
  plannerContextPreset: PlannerContextPreset;
  plannerContextTokens: number;
  plannerToolsEnabled: boolean;
  plannerToolMaxCalls: number;
  plannerJsonMode: ProviderFeatureMode;
  thinkingMode: ProviderFeatureMode;
  reasoningEffort: ReasoningEffort;
}

export const DEFAULT_SETTINGS: AppSettings = {
  apiBaseUrl: 'https://api.deepseek.com/v1',
  apiKey: '',
  apiFormat: 'chat',
  storyModel: 'deepseek-v4-pro',
  plannerModel: 'deepseek-v4-pro',
  temperatureStory: 0.9,
  storyMaxTokens: 0,
  plannerContextPreset: 'standard',
  plannerContextTokens: PLANNER_CONTEXT_PRESET_TOKENS.standard,
  plannerToolsEnabled: false,
  plannerToolMaxCalls: 2,
  plannerJsonMode: 'auto',
  thinkingMode: 'auto',
  reasoningEffort: 'high',
};
