// 长历史压缩：从 history 中尚未被摘要的部分取前段进行压缩，只更新 summary 和 summarizedUntilIndex
// 不再从 state.history 中删除消息 —— history 保留全量以便玩家随时回看。

import type { Message } from '@/types/game';
import type { StoryOutline } from '@/types/content';
import type { AppSettings } from '@/types/settings';
import { chatJSONDetailed } from './llmClient';
import { SUMMARIZER_SYSTEM, buildSummarizerUser } from '@/prompts/summarizer';
import type { LlmUsage } from '@/types/llm';

export interface CompressResult {
  newSummary: string;
  newSummarizedUntilIndex: number;
  thinking?: string;
  rawOutput?: string;
  usage?: LlmUsage;
}

export interface CompressInput {
  settings: AppSettings;
  history: Message[];
  summary: string;
  summarizedUntilIndex: number;   // history 中已被摘要覆盖的前缀 index
  maxMessages: number;            // 未摘要消息超过该阈值触发压缩
  keepTail: number;               // 保留最近 N 条不压缩
  outline?: StoryOutline;
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
  const model = settings.summaryModel?.trim() || settings.storyModel;

  try {
    const result = await chatJSONDetailed(
      { baseUrl: settings.apiBaseUrl, apiKey: settings.apiKey, format: settings.apiFormat },
      {
        model,
        temperature: 0.3,
        messages: [
          { role: 'system', content: SUMMARIZER_SYSTEM },
          { role: 'user', content: buildSummarizerUser(summary, text, outline) },
        ],
      },
    );
    const newSummary = result.text.trim();
    if (!newSummary) return null;
    return { newSummary, newSummarizedUntilIndex, thinking: result.thinking, rawOutput: result.text, usage: result.usage };
  } catch (err) {
    console.warn('[contextCompressor] summarize failed', err);
    return null;
  }
}
