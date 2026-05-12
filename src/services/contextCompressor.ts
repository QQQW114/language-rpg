// 长历史压缩：从 history 中尚未被摘要的部分取前段进行压缩，只更新 summary 和 summarizedUntilIndex
// 不再从 state.history 中删除消息 —— history 保留全量以便玩家随时回看。

import type { GameSave, Message } from '@/types/game';
import type { StoryOutline } from '@/types/content';
import type { AppSettings } from '@/types/settings';
import { chatJSONDetailed } from './llmClient';
import { SUMMARIZER_SYSTEM, buildSummarizerUser } from '@/prompts/summarizer';
import type { LlmUsage } from '@/types/llm';
import type { AgentPromptTrace } from '@/types/ledger';
import { withPromptTrace } from '@/lib/agentTrace';
import { appendWorkspaceManifest, appendWorkspaceSystem, buildWorkspaceToolRuntime } from '@/services/workspaceTools';
import { resolveAuthorCallModel, resolveLegacySummaryModel } from '@/lib/agentModels';

export interface CompressResult {
  newSummary: string;
  newSummarizedUntilIndex: number;
  thinking?: string;
  rawOutput?: string;
  usage?: LlmUsage;
  trace?: AgentPromptTrace;
}

export interface CompressInput {
  save?: GameSave;
  settings: AppSettings;
  history: Message[];
  summary: string;
  summarizedUntilIndex: number;   // history 中已被摘要覆盖的前缀 index
  maxMessages: number;            // 未摘要消息超过该阈值触发压缩
  keepTail: number;               // 保留最近 N 条不压缩
  outline?: StoryOutline;
  onDelta?: (text: string) => void;
  onThinkingDelta?: (text: string) => void;
}

function historyToText(msgs: Message[]): string {
  return msgs
    .map((m) => {
      const tag = m.role === 'assistant' ? `第${m.round + 1}回合 · 故事` : `玩家`;
      return `【${tag}】\n${m.content}`;
    })
    .join('\n\n');
}

export async function maybeCompress(p: CompressInput): Promise<CompressResult | null> {
  const { settings, history, summary, summarizedUntilIndex, maxMessages, keepTail, outline } = p;
  const unsummarized = history.slice(summarizedUntilIndex);
  if (unsummarized.length <= maxMessages) return null;

  // 目标：压缩到"保留最近 keepTail 条为原文"
  const newSummarizedUntilIndex = history.length - keepTail;
  if (newSummarizedUntilIndex <= summarizedUntilIndex) return null;

  const toCompress = history.slice(summarizedUntilIndex, newSummarizedUntilIndex);
  if (toCompress.length < 4) return null;

  const text = historyToText(toCompress);
  const model = p.save?.content.mode === 'author'
    ? resolveAuthorCallModel(settings, 'summary')
    : resolveLegacySummaryModel(settings);
  const workspace = settings.apiFormat === 'chat' ? await buildWorkspaceToolRuntime(p.save, { agentKind: 'summary' }) : {};

  try {
    const result = await chatJSONDetailed(
      { baseUrl: settings.apiBaseUrl, apiKey: settings.apiKey, format: settings.apiFormat },
      {
        model,
        temperature: 0.3,
        messages: [
          { role: 'system', content: appendWorkspaceSystem(SUMMARIZER_SYSTEM, workspace.systemRules) },
          { role: 'user', content: appendWorkspaceManifest(buildSummarizerUser(summary, text, outline), workspace.userManifest) },
        ],
        tools: workspace.tools,
        onToolCall: workspace.onToolCall,
        maxToolRounds: 2,
        onDelta: p.onDelta,
        onThinkingDelta: p.onThinkingDelta,
      },
    );
    const newSummary = result.text.trim();
    if (!newSummary) return null;
    return withPromptTrace({ newSummary, newSummarizedUntilIndex, thinking: result.thinking, rawOutput: result.text, usage: result.usage }, result.trace);
  } catch (err) {
    console.warn('[contextCompressor] summarize failed', err);
    return null;
  }
}
