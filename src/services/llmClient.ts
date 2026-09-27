// OpenAI 兼容的 LLM 客户端（只支持 Chat Completions 协议）

import { readSSEDetailed, type StreamResult } from '@/lib/sse';
import { joinThinking, splitThinkingFromText } from '@/lib/thinking';
import { normalizeLlmUsage } from '@/lib/llmUsage';
import type { LlmUsage } from '@/types/llm';
import type { AgentPromptTrace } from '@/types/ledger';

export interface ChatToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

export interface ChatTool {
  type: 'function';
  function: {
    name: string;
    description?: string;
    parameters?: Record<string, unknown>;
  };
}

export type ChatMessage =
  | {
    role: 'system' | 'user';
    content: string;
  }
  | {
    role: 'assistant';
    content?: string | null;
    tool_calls?: ChatToolCall[];
    reasoning_content?: string;
  }
  | {
    role: 'tool';
    content: string;
    tool_call_id: string;
    name?: string;
  };

export interface ChatToolInvocation {
  id: string;
  name: string;
  argumentsText: string;
  arguments: Record<string, unknown>;
}

export interface ChatToolActivity {
  phase: 'call' | 'result';
  call: ChatToolInvocation;
  resultText?: string;
}

export interface ChatClientConfig {
  baseUrl: string;
  apiKey: string;
}

export interface ChatParams {
  messages: ChatMessage[];
  model: string;
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
  tools?: ChatTool[];
  toolChoice?: 'auto' | 'none';
  maxToolRounds?: number;
  onToolCall?: (call: ChatToolInvocation) => Promise<unknown>;
  onToolActivity?: (activity: ChatToolActivity) => void;
  /** SSE 层因供应商异常帧丢弃内容时的可观察提示。 */
  onStreamWarning?: (warning: { code: string; message: string }) => void;
  responseFormat?: 'json_object';
  thinking?: 'enabled' | 'disabled';
  reasoningEffort?: 'high' | 'max';
  /**
   * 'json'：让 SSE 解析器兼容“自适应思考”模型——当模型不产生 <think> 块、
   * content 为空，却把 JSON 放进 reasoning/thinking 通道时，将 JSON 回退为正文。
   */
  thinkingFallback?: 'json';
}

export interface ChatResult {
  text: string;
  thinking?: string;
  finishReason?: string;
  usage?: LlmUsage;
  trace?: AgentPromptTrace;
  /** 完整可续接会话；仅供同一轮内的后续调用，不应长期持久化。 */
  conversation?: ChatMessage[];
}

export interface ChatStreamParams extends ChatParams {
  onDelta: (text: string) => void;
  onThinkingDelta?: (text: string) => void;
}

export interface ChatJSONParams extends ChatParams {
  /**
   * JSON 模型也走流式请求时的正文增量。
   * 注意：这里通常是半截 JSON，只适合前端预览，最终解析仍使用返回的 text。
   */
  onDelta?: (text: string) => void;
  onThinkingDelta?: (text: string) => void;
}

function joinUrl(base: string, path: string): string {
  const b = base.replace(/\/+$/, '');
  const p = path.replace(/^\/+/, '');
  return `${b}/${p}`;
}

async function readErrorBody(res: Response): Promise<string> {
  try {
    const text = await res.text();
    try {
      const obj = JSON.parse(text);
      return obj?.error?.message ?? obj?.message ?? obj?.detail ?? text;
    } catch {
      return text;
    }
  } catch {
    return `${res.status} ${res.statusText}`;
  }
}

// ---- 请求构造 ----

function buildChatBody(p: ChatParams, stream: boolean, includeUsage = false): Record<string, unknown> {
  return {
    model: p.model,
    messages: p.messages,
    temperature: p.temperature ?? 0.9,
    stream,
    ...(stream && includeUsage ? { stream_options: { include_usage: true } } : {}),
    ...(p.maxTokens ? { max_tokens: p.maxTokens } : {}),
    ...(p.responseFormat ? { response_format: { type: p.responseFormat } } : {}),
    ...(p.thinking ? { thinking: { type: p.thinking } } : {}),
    ...(p.reasoningEffort ? { reasoning_effort: p.reasoningEffort } : {}),
    ...(p.tools?.length && (p.toolChoice ?? 'auto') !== 'none' ? { tools: p.tools, tool_choice: p.toolChoice ?? 'auto' } : {}),
  };
}

function chatEndpoint(base: string): string {
  return joinUrl(base, 'chat/completions');
}

function shouldRetryWithoutStreamOptions(message: string): boolean {
  const lower = message.toLowerCase();
  return lower.includes('stream_options')
    || lower.includes('stream options')
    || lower.includes('unrecognized request argument')
    || lower.includes('unknown parameter')
    || lower.includes('extra_forbidden');
}

function clipTraceText(text: string, max = 24000): string {
  const trimmed = String(text ?? '');
  return trimmed.length > max ? `${trimmed.slice(0, max)}\n\n……（输入过长，已截断）` : trimmed;
}

function messageContentForTrace(m: ChatMessage): string {
  if (m.role === 'tool') {
    return `[tool:${m.name ?? m.tool_call_id}]\n${m.content}`;
  }
  const content = typeof m.content === 'string' ? m.content : '';
  if (m.role === 'assistant' && m.tool_calls?.length) {
    return [
      content,
      '[tool_calls]',
      JSON.stringify(m.tool_calls.map((call) => ({
        id: call.id,
        name: call.function?.name,
        arguments: call.function?.arguments,
      })), null, 2),
    ].filter(Boolean).join('\n');
  }
  return content;
}

function assistantMessageFromApi(msg: any): ChatMessage {
  const assistant: ChatMessage = {
    role: 'assistant',
    content: typeof msg.content === 'string' ? msg.content : '',
    tool_calls: Array.isArray(msg.tool_calls) ? msg.tool_calls as ChatToolCall[] : undefined,
  };
  if (typeof msg.reasoning_content === 'string' && msg.reasoning_content.trim()) {
    assistant.reasoning_content = msg.reasoning_content;
  }
  return assistant;
}

function buildPromptTrace(messages: ChatMessage[]): AgentPromptTrace {
  const system = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n').trim();
  const users = messages.filter((m) => m.role === 'user');
  const lastUser = users[users.length - 1]?.content ?? '';
  return {
    system: system ? clipTraceText(system) : undefined,
    user: lastUser ? clipTraceText(lastUser, 32000) : undefined,
    messages: messages.map((m) => ({
      role: m.role,
      content: clipTraceText(messageContentForTrace(m), 32000),
    })),
    inputSummary: `${messages.length} 条消息；system ${system.length} 字；最后 user ${lastUser.length} 字`,
  };
}

function parseToolArguments(text: string | undefined): Record<string, unknown> {
  const raw = text?.trim();
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return { raw };
  }
}

function stringifyToolResult(value: unknown): string {
  try {
    const text = typeof value === 'string' ? value : JSON.stringify(value);
    return text.length > 12000 ? `${text.slice(0, 12000)}\n……（工具返回过长，已截断）` : text;
  } catch {
    return String(value ?? '');
  }
}

/**
 * 末轮回退到前一轮文本时，把这段文本补给最终一轮的 onDelta 消费者。
 * 前几轮的增量已经被缓存并整体透出过，这里只补发"最终结果"这一份，
 * 避免调用方（例如活动面板）只看到空输出。
 */
function safelyEmitRecoveredText(p: ChatStreamParams, roundDeltas: string[], recovered: string) {
  const alreadyEmitted = roundDeltas.join('');
  if (alreadyEmitted) return;
  try {
    p.onDelta(recovered);
  } catch {
    /* 展示层回调不能影响返回值。 */
  }
}

function addUsage(a: LlmUsage | undefined, b: LlmUsage | undefined): LlmUsage | undefined {
  if (!a) return b;
  if (!b) return a;
  return {
    promptTokens: (a.promptTokens ?? 0) + (b.promptTokens ?? 0) || undefined,
    completionTokens: (a.completionTokens ?? 0) + (b.completionTokens ?? 0) || undefined,
    totalTokens: (a.totalTokens ?? 0) + (b.totalTokens ?? 0) || undefined,
    cache: {
      hitTokens: (a.cache?.hitTokens ?? 0) + (b.cache?.hitTokens ?? 0) || undefined,
      missTokens: (a.cache?.missTokens ?? 0) + (b.cache?.missTokens ?? 0) || undefined,
      cachedTokens: (a.cache?.cachedTokens ?? 0) + (b.cache?.cachedTokens ?? 0) || undefined,
    },
  };
}

// ---- 统一对外 API ----

export async function chatStream(
  cfg: ChatClientConfig,
  p: ChatStreamParams,
): Promise<string> {
  const result = await chatStreamDetailed(cfg, p);
  return result.text;
}

export async function chatStreamDetailed(
  cfg: ChatClientConfig,
  p: ChatStreamParams,
): Promise<StreamResult & { trace?: AgentPromptTrace; conversation?: ChatMessage[] }> {
  if (!cfg.apiKey) throw new Error('未配置 API Key，请先在设置中填写');
  if (!cfg.baseUrl) throw new Error('未配置 API Base URL');
  if (!p.model) throw new Error('未选择模型');

  const url = chatEndpoint(cfg.baseUrl);

  const requestStreamOnce = async (
    params: ChatStreamParams,
    includeUsage: boolean,
  ): Promise<StreamResult> => {
    const buildBody = (useUsage: boolean) => buildChatBody(params, true, useUsage);
    let body = buildBody(includeUsage);

    let res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${cfg.apiKey}`,
        Accept: 'text/event-stream',
      },
      body: JSON.stringify(body),
      signal: params.signal,
    });

    if (!res.ok) {
      const msg = await readErrorBody(res);
      if (includeUsage && shouldRetryWithoutStreamOptions(msg)) {
        body = buildBody(false);
        res = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${cfg.apiKey}`,
            Accept: 'text/event-stream',
          },
          body: JSON.stringify(body),
          signal: params.signal,
        });
        if (res.ok) {
          return readSSEDetailed(res, {
            onDelta: params.onDelta,
            onThinkingDelta: params.onThinkingDelta,
            signal: params.signal,
            thinkingFallback: params.thinkingFallback,
            onWarning: params.onStreamWarning,
          });
        }
        const retryMsg = await readErrorBody(res);
        throw new Error(`模型请求失败（${res.status}）：${retryMsg}`);
      }
      throw new Error(`模型请求失败（${res.status}）：${msg}`);
    }

    return readSSEDetailed(res, {
      onDelta: params.onDelta,
      onThinkingDelta: params.onThinkingDelta,
      signal: params.signal,
      thinkingFallback: params.thinkingFallback,
      onWarning: params.onStreamWarning,
    });
  };

  if (
    p.tools?.length
    && p.onToolCall
    && (p.toolChoice ?? 'auto') !== 'none'
  ) {
    const messages = [...p.messages];
    const maxToolRounds = Math.max(0, Math.min(6, p.maxToolRounds ?? 3));
    let usage: LlmUsage | undefined;
    const thinkingParts: string[] = [];
    let hadToolRound = false;
    // 模型经常在"发工具调用的同一轮"里已经把最终 JSON 写完，末轮却只回一个空的 stop。
    // 只认最后一轮的文本会把这轮已经生成好的结果整段丢掉，进而让整回合以"空内容"失败。
    let lastNonEmptyText = '';
    let lastNonEmptyFinish: string | undefined;

    for (let round = 0; round <= maxToolRounds; round += 1) {
      const textDeltas: string[] = [];
      const thinkingDeltas: string[] = [];
      // 第一轮可能同时吐出解释文字和 tool_calls，先缓存，避免把中间说明当成最终 JSON/正文。
      // 已完成至少一轮工具后，下一轮大概率是在整理最终输出，实时透出可避免"思考完卡住"的观感。
      const emitTextLive = hadToolRound;
      // 最后一轮不再声明工具：模型物理上无法继续请求工具，从而把机会用在输出最终结果上。
      // 这比事后抛"超过上限"更符合意图——工具用量上限是软约束，不该打掉整个回合。
      const isFinalRound = round >= maxToolRounds;
      const result = await requestStreamOnce(
        {
          ...p,
          messages,
          ...(isFinalRound ? { toolChoice: 'none' as const } : {}),
          onDelta: (t) => {
            textDeltas.push(t);
            if (emitTextLive) p.onDelta(t);
          },
          onThinkingDelta: (t) => {
            thinkingDeltas.push(t);
            // 工具调用轮次也实时透出思考。
            p.onThinkingDelta?.(t);
          },
        },
        true,
      );
      usage = addUsage(usage, result.usage);
      if (result.thinking?.trim()) thinkingParts.push(result.thinking.trim());
      if (result.text.trim()) {
        lastNonEmptyText = result.text;
        lastNonEmptyFinish = result.finishReason;
      }

      const toolCalls = result.toolCalls ?? [];
      if (toolCalls.length) {
        // 末轮已用 toolChoice:'none' 明确不给工具；模型仍然请求工具时不再抛错打掉整回合，
        // 也绝不再发起新请求（否则 round 会越过上限、把模型调用变成无界循环）。
        // 直接用已经拿到的文本收尾：工具预算是软约束，而这一轮可能已经写出可用内容。
        if (isFinalRound) {
          const finalText = result.text.trim() ? result.text : lastNonEmptyText;
          if (!finalText.trim()) {
            throw new Error(`模型连续请求工具超过上限（${maxToolRounds} 轮），且未给出可用内容，已停止。`);
          }
          if (!result.text.trim()) safelyEmitRecoveredText(p, textDeltas, finalText);
          return {
            text: finalText,
            thinking: joinThinking(...thinkingParts),
            reasoningContent: result.reasoningContent,
            finishReason: result.finishReason ?? lastNonEmptyFinish,
            usage,
            trace: buildPromptTrace(messages),
            conversation: [...messages, { role: 'assistant', content: finalText }],
          };
        }
        messages.push({
          role: 'assistant',
          content: result.text || '',
          tool_calls: toolCalls as ChatToolCall[],
          reasoning_content: result.reasoningContent,
        });

        for (const call of toolCalls) {
          const name = call.function?.name || '';
          const argumentsText = call.function?.arguments || '{}';
          const args = parseToolArguments(argumentsText);
          const invocation: ChatToolInvocation = {
            id: call.id,
            name,
            argumentsText,
            arguments: args,
          };
          p.onToolActivity?.({ phase: 'call', call: invocation });
          let toolResult: unknown;
          try {
            toolResult = await p.onToolCall(invocation);
          } catch (err: any) {
            toolResult = { error: err?.message ?? String(err) };
          }
          const resultText = stringifyToolResult(toolResult);
          p.onToolActivity?.({ phase: 'result', call: invocation, resultText });
          messages.push({
            role: 'tool',
            tool_call_id: call.id,
            name,
            content: resultText,
          });
        }
        hadToolRound = true;
        continue;
      }

      if (!emitTextLive) {
        for (const t of textDeltas) p.onDelta(t);
      }
      // 末轮为空时回退到之前某一轮已经写好的完整文本（常见于"发工具调用的同一轮里
      // 就把最终 JSON 写完"的模型行为），避免把它丢掉导致整回合以空内容失败。
      const finalText = result.text.trim() ? result.text : lastNonEmptyText;
      if (!result.text.trim() && finalText) {
        safelyEmitRecoveredText(p, textDeltas, finalText);
      }
      return {
        text: finalText,
        thinking: joinThinking(...thinkingParts),
        reasoningContent: result.reasoningContent,
        finishReason: result.finishReason ?? lastNonEmptyFinish,
        usage,
        trace: buildPromptTrace(messages),
        conversation: [...messages, { role: 'assistant', content: finalText }],
      };
    }
  }

  const result = await requestStreamOnce(p, true);
  return {
    ...result,
    trace: buildPromptTrace(p.messages),
    conversation: [...p.messages, { role: 'assistant', content: result.text || '' }],
  };
}

export async function chatJSON(
  cfg: ChatClientConfig,
  p: ChatParams,
): Promise<string> {
  const result = await chatJSONDetailed(cfg, p);
  return result.text;
}

export async function chatJSONDetailed(
  cfg: ChatClientConfig,
  p: ChatJSONParams,
): Promise<ChatResult> {
  if (!cfg.apiKey) throw new Error('未配置 API Key，请先在设置中填写');
  if (!cfg.baseUrl) throw new Error('未配置 API Base URL');
  if (!p.model) throw new Error('未选择模型');

  const result = await chatStreamDetailed(cfg, {
    ...p,
    onDelta: p.onDelta ?? (() => {}),
    onThinkingDelta: p.onThinkingDelta,
    thinkingFallback: 'json',
  });
  const split = splitThinkingFromText(result.text);
  return {
    text: split.text,
    thinking: joinThinking(
      result.thinking,
      split.thinking,
    ),
    finishReason: result.finishReason,
    usage: result.usage,
    trace: result.trace,
    conversation: result.conversation,
  };
}
