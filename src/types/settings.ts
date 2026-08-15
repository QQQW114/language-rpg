export type ApiFormat = 'chat' | 'responses';

export type PlannerContextPreset = 'compact' | 'standard' | 'rich' | 'custom';
export type ProviderFeatureMode = 'auto' | 'enabled' | 'disabled';
export type ReasoningEffort = 'high' | 'max';
export type InputPerspective = 'player' | 'director';

export interface RoleInjectConfig {
  enabled: boolean;
  text: string;
}

export interface RoleInjectSettings {
  /** 规划：写前规划。每个存档仅最开始注入一次。 */
  planner: RoleInjectConfig;
  /** 故事：正文写作。每次调用都注入。 */
  story: RoleInjectConfig;
  /** 整理：写后结算。每次调用都注入。 */
  post: RoleInjectConfig;
}

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
  roleInjects: RoleInjectSettings;
  /** 执笔模式下，玩家输入作为“玩家行动”还是“导演指令”处理。 */
  inputPerspective: InputPerspective;
  /** 前端是否允许玩家查看并编辑故事推进状态（含人物介绍与关系好感）。 */
  stateEditingEnabled: boolean;
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
  roleInjects: {
    planner: { enabled: false, text: '' },
    story: { enabled: false, text: '' },
    post: { enabled: false, text: '' },
  },
  inputPerspective: 'player',
  stateEditingEnabled: true,
};
