// 每回合模型调用的提示词留档类型。
// 该留档随存档保存（GameStateV2.turnRecords[].calls[].input），用于“导出全部信息”。

export interface AgentPromptTraceMessage {
  role: string;
  content: string;
}

export interface AgentPromptTrace {
  system?: string;
  user?: string;
  messages?: AgentPromptTraceMessage[];
  inputSummary?: string;
}
