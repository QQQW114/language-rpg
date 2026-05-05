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
  promptOverrideEnabled: boolean; // 是否启用下方 system/user 模板覆盖；关闭时只注入上方规则块
  storySystemPrompt: string;     // 故事模型 system 提示词覆盖模板
  storyUserPrompt: string;       // 故事模型 user 提示词覆盖模板
  decisionSystemPrompt: string;  // 决策模型 system 提示词覆盖模板
  decisionUserPrompt: string;    // 决策模型 user 提示词覆盖模板
  detailedOutline: StrictRoundDirective[];
}
