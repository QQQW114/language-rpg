// OpenAI 兼容 SSE 解析
// 支持两种格式：
//  1) chat: data: {"choices":[{"delta":{"content":"..."}}]}
//  2) responses: 事件 response.output_text.delta → {"delta":"..."}

import { mergeLlmUsage, normalizeLlmUsage } from '@/lib/llmUsage';
import { extractJSONText } from '@/lib/utils';
import type { LlmUsage } from '@/types/llm';

export interface StreamOptions {
  onDelta: (text: string) => void;
  onThinkingDelta?: (text: string) => void;
  signal?: AbortSignal;
  format?: 'chat' | 'responses';
  /**
   * 'json'：兼容“自适应思考”模型。部分模型在不产生 <think> 块时，会把真正的
   * 正文（通常是 JSON）放进 reasoning/thinking 通道，而 content 为空。
   * 开启后，流结束时若正文为空、没有显式 <think> 块，且“思考”内容可解析为
   * JSON，则把该 JSON 回退为正文，不再视为思考。
   */
  thinkingFallback?: 'json';
}

export interface StreamResult {
  text: string;
  thinking?: string;
  reasoningContent?: string;
  finishReason?: string;
  usage?: LlmUsage;
  toolCalls?: StreamToolCall[];
}

type RawFrame = Record<string, unknown>;

export interface StreamToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

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

interface PartialToolCall {
  id?: string;
  type?: 'function';
  name?: string;
  arguments: string;
}

function extractChatToolCallDeltas(frame: RawFrame): Array<{
  index: number;
  id?: string;
  type?: 'function';
  name?: string;
  arguments?: string;
}> {
  const choices = (frame as any).choices;
  if (!Array.isArray(choices) || choices.length === 0) return [];
  const toolCalls = choices[0]?.delta?.tool_calls;
  if (!Array.isArray(toolCalls)) return [];
  return toolCalls.map((call: any, fallbackIndex: number) => ({
    index: Number.isFinite(call?.index) ? Number(call.index) : fallbackIndex,
    id: typeof call?.id === 'string' ? call.id : undefined,
    type: call?.type === 'function' ? 'function' : undefined,
    name: typeof call?.function?.name === 'string' ? call.function.name : undefined,
    arguments: typeof call?.function?.arguments === 'string' ? call.function.arguments : undefined,
  }));
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
  const partialToolCalls = new Map<number, PartialToolCall>();

  const extractor = opts.format === 'responses' ? extractResponsesDelta : extractChatDelta;
  const thinkingExtractor = opts.format === 'responses' ? extractResponsesThinkingDelta : extractChatThinkingDelta;
  const splitter = createThinkTagSplitter(opts.onDelta, (t) => opts.onThinkingDelta?.(t));
  const finish = (): StreamResult => {
    const result = splitter.finish();
    const tagThinking = result.thinking;
    let native = nativeThinking.trim();
    let text = result.text;

    // 兜底：原生思考通道承载了完整 JSON、正文通道始终为空，且没有显式 <think> 块。
    if (
      opts.thinkingFallback === 'json'
      && !text.trim()
      && !tagThinking
      && native
    ) {
      const recovered = extractJSONText(native);
      if (recovered) {
        text = recovered;
        // 已恢复为正文的部分不再重复算作思考；其余推理前缀仍保留。
        native = native.replace(recovered, '').trim();
        opts.onDelta?.(recovered);
      }
    }

    const thinking = [native, tagThinking]
      .map((x) => x?.trim())
      .filter(Boolean)
      .join('\n\n')
      || undefined;
    const toolCalls = Array.from(partialToolCalls.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([index, call]) => ({
        id: call.id || `tool_call_${index}`,
        type: 'function' as const,
        function: {
          name: call.name || '',
          arguments: call.arguments || '',
        },
      }))
      .filter((call) => call.function.name);
    return {
      ...result,
      text,
      thinking,
      reasoningContent: native || undefined,
      finishReason,
      usage,
      toolCalls: toolCalls.length ? toolCalls : undefined,
    };
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
        if (opts.format !== 'responses') {
          for (const delta of extractChatToolCallDeltas(frame)) {
            const existing = partialToolCalls.get(delta.index) ?? { arguments: '' };
            partialToolCalls.set(delta.index, {
              id: delta.id ?? existing.id,
              type: delta.type ?? existing.type ?? 'function',
              name: delta.name ?? existing.name,
              arguments: existing.arguments + (delta.arguments ?? ''),
            });
          }
        }
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
