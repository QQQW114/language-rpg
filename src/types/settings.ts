export type PlannerContextPreset = 'compact' | 'standard' | 'rich' | 'custom';
export type ProviderFeatureMode = 'auto' | 'enabled' | 'disabled';
export type ReasoningEffort = 'low' | 'high' | 'max';
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
  /**
   * 思考强度。DeepSeek 官方映射表（OpenAI 格式的 `reasoning_effort`）：
   *   minimal → low，low → low，medium → high，high → high，xhigh → high，max → max
   * 也就是说 `high` 已经是**仅次于 max 的高档**，没有"中等"档；供应商只提供这三档，
   * 不存在数字型的思考预算。
   */
  reasoningEffort: ReasoningEffort;
  /**
   * 逐阶段的思考强度覆盖。留空表示继续按模型 / 全局解析。
   *
   * 保留原因：三个阶段的思考价值不同（写后结算的产出结构由模板完全固定，
   * 属机械性任务）。这是"按阶段"的细粒度覆盖，日常调参请优先用
   * `reasoningEffortByModel`——思考强度本质上是**模型特性**，跟着模型走才不会
   * 在换模型时失效。
   */
  reasoningEffortByPhase?: Partial<Record<'planner_pre' | 'story' | 'planner_post', ReasoningEffort>>;
  /**
   * 按模型覆盖思考强度（键为模型名，例如 `deepseek-flash`）。
   *
   * 这是首选方式：思考行为的差异来自模型本身，按模型配置后，换用哪个模型就自动
   * 带着它自己的档位，不必因为改了阶段或改了链路而重新调。解析优先级：
   * 逐阶段覆盖 → 按模型覆盖 → 全局 `reasoningEffort`。
   * 未列出的模型使用全局档位。
   */
  reasoningEffortByModel?: Record<string, ReasoningEffort>;
  roleInjects: RoleInjectSettings;
  /** 执笔模式下，玩家输入作为“玩家行动”还是“导演指令”处理。 */
  inputPerspective: InputPerspective;
  /** 前端是否允许玩家查看并编辑故事推进状态（含人物介绍与关系好感）。 */
  stateEditingEnabled: boolean;
}

export const DEFAULT_SETTINGS: AppSettings = {
  apiBaseUrl: 'https://api.deepseek.com/v1',
  apiKey: '',
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
  // 默认没有按模型/按阶段的覆盖：一律使用全局档位。玩家可以在设置页按模型指定
  // 思考强度（例如给便宜模型用 low、给规划模型用 max）。
  reasoningEffortByModel: {},
  reasoningEffortByPhase: {},
  roleInjects: {
    planner: { enabled: false, text: '' },
    story: { enabled: false, text: '' },
    post: { enabled: false, text: '' },
  },
  inputPerspective: 'player',
  stateEditingEnabled: true,
};
