export type ApiFormat = 'chat' | 'responses';
export type StoryLength = 'short' | 'standard' | 'long';
export type StoryPromptMode = 'default' | 'deepseek-v4-protagonist' | 'deepseek-v4-instruction';

export type AuthorCoreModelKey = 'orchestrator' | 'masterArc' | 'directorReply';
export type AuthorCallModelKey =
  | 'outlineMapper'
  | 'stageJudge'
  | 'settingGuard'
  | 'eventBeat'
  | 'director'
  | 'logicCheck'
  | 'memory'
  | 'summary';

export interface AuthorModelRoutingSettings {
  /** 人物 / 场景 / 事件等 A 类工具模型统一使用；留空则使用 storyModel。 */
  toolModel: string;
  /** 调度层 / 主弧等非 calls 成员；各项留空则使用 storyModel。 */
  core: Record<AuthorCoreModelKey, string>;
  /** 司辰 calls 成员；各项留空则使用 storyModel。 */
  calls: Record<AuthorCallModelKey, string>;
}

export interface StoryStyleSettings {
  storyLength: StoryLength;
  storyStyleAddendum: string;
}

export interface AppSettings {
  apiBaseUrl: string;
  apiKey: string;
  apiFormat: ApiFormat;
  storyModel: string;
  decisionModel: string;
  temperatureStory: number;
  temperatureDecision: number;
  storyMaxTokens: number;              // 故事单次最大输出 token；0 表示不传，由服务端决定
  maxHistoryRounds: number;
  summaryModel?: string;
  memoryModel?: string;
  randomModel?: string;
  authorModelRouting: AuthorModelRoutingSettings;
  memoryEveryRounds: number;          // 每隔多少个已完成回合更新长期记忆；0 表示关闭
  memoryMaxChars: number;             // 长期记忆块最大字符数
  storyLength: StoryLength;            // 故事篇幅偏好
  storyPromptMode: StoryPromptMode;     // 故事模型提示词模式 / DeepSeek V4 特化
  storyStyleAddendum: string;          // 故事风格自由追加提示
}

export const DEFAULT_SETTINGS: AppSettings = {
  apiBaseUrl: 'https://api.deepseek.com/v1',
  apiKey: '',
  apiFormat: 'chat',
  storyModel: 'deepseek-chat',
  decisionModel: 'deepseek-chat',
  temperatureStory: 0.9,
  temperatureDecision: 0.5,
  storyMaxTokens: 4096,
  maxHistoryRounds: 22,
  summaryModel: '',
  memoryModel: '',
  randomModel: '',
  authorModelRouting: {
    toolModel: '',
    core: {
      orchestrator: '',
      masterArc: '',
      directorReply: '',
    },
    calls: {
      outlineMapper: '',
      stageJudge: '',
      settingGuard: '',
      eventBeat: '',
      director: '',
      logicCheck: '',
      memory: '',
      summary: '',
    },
  },
  memoryEveryRounds: 3,
  memoryMaxChars: 4000,
  storyLength: 'standard',
  storyPromptMode: 'default',
  storyStyleAddendum: '',
};
