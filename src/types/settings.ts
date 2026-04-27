export type ApiFormat = 'chat' | 'responses';
export type StoryLength = 'short' | 'standard' | 'long';

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
  randomModel?: string;
  storyLength: StoryLength;            // 故事篇幅偏好
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
  randomModel: '',
  storyLength: 'standard',
  storyStyleAddendum: '',
};
