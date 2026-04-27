export interface StrictRoundDirective {
  id: string;
  startRound: number;
  endRound: number;
  prompt: string;
}

export interface StrictCustomConfig {
  enabled: boolean;
  globalPrompt: string;          // 全局严格叙事规则
  pacingPrompt: string;          // 推进粒度 / 节奏控制
  revealPrompt: string;          // 隐藏设定揭示规则
  choicePrompt: string;          // 决策/选项生成偏好
  storySystemPrompt: string;     // 注入故事模型 system 链路的追加提示
  storyUserPrompt: string;       // 注入故事模型 user 链路的追加提示
  decisionSystemPrompt: string;  // 注入决策模型 system 链路的追加提示
  decisionUserPrompt: string;    // 注入决策模型 user 链路的追加提示
  detailedOutline: StrictRoundDirective[];
}
