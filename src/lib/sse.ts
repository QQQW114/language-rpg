// OpenAI 兼容 SSE 解析
// 支持两种格式：
//  1) chat: data: {"choices":[{"delta":{"content":"..."}}]}
//  2) responses: 事件 response.output_text.delta → {"delta":"..."}

import { mergeLlmUsage, normalizeLlmUsage } from '@/lib/llmUsage';
import type { LlmUsage } from '@/types/llm';

export interface StreamOptions {
  onDelta: (text: string) => void;
  onThinkingDelta?: (text: string) => void;
  signal?: AbortSignal;
  format?: 'chat' | 'responses';
}

export interface StreamResult {
  text: string;
  thinking?: string;
  finishReason?: string;
  usage?: LlmUsage;
}

type RawFrame = Record<string, unknown>;

function extractChatDelta(frame: RawFrame): string | undefined {
  const choices = (frame as any).choices;
  if (!Array.isArray(choices) || choices.length === 0) return undefined;
  const content = choices[0]?.delta?.content;
  return typeof content === 'string' ? content : undefined;
}

function extractChatThinkingDelta(frame: RawFrame): string | undefined {
  const choices = (frame as any).choices;
  if (!Array.isArray(choices) || choices.length === 0) return undefined;
  const delta = choices[0]?.delta;
  const content =
    delta?.reasoning_content ??
    delta?.reasoning ??
    delta?.thinking ??
    delta?.thoughts;
  return typeof content === 'string' ? content : undefined;
}

function extractResponsesDelta(frame: RawFrame): string | undefined {
  const type = (frame as any).type;
  // 只对正文 delta 感兴趣；跳过 reasoning / annotations / audio 等
  if (type === 'response.output_text.delta') {
    const delta = (frame as any).delta;
    return typeof delta === 'string' ? delta : undefined;
  }
  if (type === 'error' || type === 'response.failed') {
    const msg = (frame as any).error?.message ?? (frame as any).response?.error?.message ?? '模型返回错误';
    throw new Error(String(msg));
  }
  return undefined;
}

function extractResponsesThinkingDelta(frame: RawFrame): string | undefined {
  const anyFrame = frame as any;
  const type = anyFrame.type;
  if (
    type === 'response.reasoning_summary_text.delta'
    || type === 'response.reasoning_text.delta'
    || type === 'response.thinking.delta'
  ) {
    const delta = anyFrame.delta ?? anyFrame.text;
    return typeof delta === 'string' ? delta : undefined;
  }
  const content =
    anyFrame.reasoning_content ??
    anyFrame.reasoning ??
    anyFrame.thinking ??
    anyFrame.thoughts;
  return typeof content === 'string' ? content : undefined;
}

function trailingPrefixLength(text: string, tag: string): number {
  const lower = text.toLowerCase();
  for (let n = Math.min(tag.length - 1, lower.length); n > 0; n--) {
    if (lower.endsWith(tag.slice(0, n))) return n;
  }
  return 0;
}

function createThinkTagSplitter(onText: (text: string) => void, onThinking: (text: string) => void) {
  let inThink = false;
  let pending = '';
  let text = '';
  let thinking = '';
  const openTag = '<think>';
  const closeTag = '</think>';

  const emitText = (chunk: string) => {
    if (!chunk) return;
    text += chunk;
    onText(chunk);
  };
  const emitThinking = (chunk: string) => {
    if (!chunk) return;
    thinking += chunk;
    onThinking(chunk);
  };

  const feed = (chunk: string, flush = false) => {
    let rest = pending + chunk;
    pending = '';
    while (rest) {
      const lower = rest.toLowerCase();
      if (inThink) {
        const close = lower.indexOf(closeTag);
        if (close >= 0) {
          emitThinking(rest.slice(0, close));
          rest = rest.slice(close + closeTag.length);
          inThink = false;
          continue;
        }
        if (!flush) {
          const keep = trailingPrefixLength(rest, closeTag);
          if (keep > 0) {
            emitThinking(rest.slice(0, -keep));
            pending = rest.slice(-keep);
            return;
          }
        }
        emitThinking(rest);
        return;
      }

      const open = lower.indexOf(openTag);
      if (open >= 0) {
        emitText(rest.slice(0, open));
        rest = rest.slice(open + openTag.length);
        inThink = true;
        continue;
      }
      if (!flush) {
        const keep = trailingPrefixLength(rest, openTag);
        if (keep > 0) {
          emitText(rest.slice(0, -keep));
          pending = rest.slice(-keep);
          return;
        }
      }
      emitText(rest);
      return;
    }
  };

  const finish = () => {
    if (pending) feed('', true);
    return {
      text: text.trim(),
      thinking: thinking.trim() || undefined,
    };
  };

  return { feed, finish };
}

function detectFinishReason(frame: RawFrame): string | undefined {
  const anyFrame = frame as any;

  // Chat Completions：最终 chunk 通常携带 choices[0].finish_reason。
  const choices = anyFrame.choices;
  if (Array.isArray(choices) && choices.length > 0) {
    const reason = choices[0]?.finish_reason;
    if (typeof reason === 'string' && reason) return reason;
  }

  // Responses API / 常见代理：达到 max_output_tokens 会以 incomplete 结束。
  const response = anyFrame.response;
  const incompleteReason =
    anyFrame.incomplete_details?.reason ??
    anyFrame.incomplete_details?.code ??
    response?.incomplete_details?.reason ??
    response?.incomplete_details?.code;
  if (typeof incompleteReason === 'string' && incompleteReason) {
    return incompleteReason === 'max_output_tokens' ? 'length' : incompleteReason;
  }

  if (anyFrame.type === 'response.incomplete' || response?.status === 'incomplete') {
    return 'length';
  }

  const directReason = anyFrame.finish_reason ?? anyFrame.finishReason;
  if (typeof directReason === 'string' && directReason) return directReason;

  return undefined;
}

function extractUsage(frame: RawFrame): LlmUsage | undefined {
  const anyFrame = frame as any;
  return normalizeLlmUsage(anyFrame.usage ?? anyFrame.response?.usage);
}

export async function readSSEDetailed(
  response: Response,
  opts: StreamOptions,
): Promise<StreamResult> {
  if (!response.body) throw new Error('响应体为空');
  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  let finishReason: string | undefined;
  let nativeThinking = '';
  let usage: LlmUsage | undefined;

  const extractor = opts.format === 'responses' ? extractResponsesDelta : extractChatDelta;
  const thinkingExtractor = opts.format === 'responses' ? extractResponsesThinkingDelta : extractChatThinkingDelta;
  const splitter = createThinkTagSplitter(opts.onDelta, (t) => opts.onThinkingDelta?.(t));
  const finish = (): StreamResult => {
    const result = splitter.finish();
    const thinking = [nativeThinking.trim(), result.thinking]
      .map((x) => x?.trim())
      .filter(Boolean)
      .join('\n\n')
      || undefined;
    return { ...result, thinking, finishReason, usage };
  };

  try {
    while (true) {
      if (opts.signal?.aborted) throw new DOMException('aborted', 'AbortError');
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let idx: number;
      while ((idx = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, idx).replace(/\r$/, '');
        buffer = buffer.slice(idx + 1);
        if (!line) continue;
        // 忽略 "event: xxx" 行，只看 data 行
        if (!line.startsWith('data:')) continue;

        const payload = line.slice(5).trim();
        if (!payload) continue;
        if (payload === '[DONE]') {
          return finish();
        }

        let frame: RawFrame;
        try {
          frame = JSON.parse(payload);
        } catch {
          continue;
        }

        finishReason = detectFinishReason(frame) ?? finishReason;
        usage = mergeLlmUsage(usage, extractUsage(frame));
        const thinkingDelta = thinkingExtractor(frame);
        if (thinkingDelta) {
          nativeThinking += thinkingDelta;
          opts.onThinkingDelta?.(thinkingDelta);
        }

        const delta = extractor(frame);
        if (delta) {
          splitter.feed(delta);
        }
      }
    }
  } finally {
    try { reader.releaseLock(); } catch { /* noop */ }
  }
  return finish();
}

export async function readSSE(
  response: Response,
  opts: StreamOptions,
): Promise<string> {
  const result = await readSSEDetailed(response, opts);
  return result.text;
}
