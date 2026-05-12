// OpenAI 兼容的 LLM 客户端：支持 Chat Completions 与 Responses 两种请求格式

import { readSSEDetailed, type StreamResult } from '@/lib/sse';
import type { ApiFormat } from '@/types/settings';
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
  format: ApiFormat;
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
}

export interface ChatResult {
  text: string;
  thinking?: string;
  finishReason?: string;
  usage?: LlmUsage;
  trace?: AgentPromptTrace;
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

// ---- Chat Completions 格式 ----

function buildChatBody(p: ChatParams, stream: boolean, includeUsage = false): Record<string, unknown> {
  return {
    model: p.model,
    messages: p.messages,
    temperature: p.temperature ?? 0.9,
    stream,
    ...(stream && includeUsage ? { stream_options: { include_usage: true } } : {}),
    ...(p.maxTokens ? { max_tokens: p.maxTokens } : {}),
    ...(p.tools?.length && (p.toolChoice ?? 'auto') !== 'none' ? { tools: p.tools, tool_choice: p.toolChoice ?? 'auto' } : {}),
  };
}

// ---- Responses 格式 ----
// 将 messages 拆分为 instructions（system 消息合并）+ input（user/assistant）

function buildResponsesBody(p: ChatParams, stream: boolean): Record<string, unknown> {
  const systems: string[] = [];
  const input: Array<{ role: string; content: string }> = [];
  for (const m of p.messages) {
    if (m.role === 'system') {
      systems.push(m.content);
    } else if (m.role === 'user' || m.role === 'assistant') {
      input.push({ role: m.role, content: typeof m.content === 'string' ? m.content : '' });
    }
  }
  const body: Record<string, unknown> = {
    model: p.model,
    input,
    stream,
  };
  if (systems.length) body.instructions = systems.join('\n\n');
  if (p.temperature !== undefined) body.temperature = p.temperature;
  if (p.maxTokens) body.max_output_tokens = p.maxTokens;
  return body;
}

function responsesEndpoint(base: string): string {
  return joinUrl(base, 'responses');
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
): Promise<StreamResult & { trace?: AgentPromptTrace }> {
  if (!cfg.apiKey) throw new Error('未配置 API Key，请先在设置中填写');
  if (!cfg.baseUrl) throw new Error('未配置 API Base URL');
  if (!p.model) throw new Error('未选择模型');

  const url = cfg.format === 'responses' ? responsesEndpoint(cfg.baseUrl) : chatEndpoint(cfg.baseUrl);

  const requestStreamOnce = async (
    params: ChatStreamParams,
    includeUsage: boolean,
  ): Promise<StreamResult> => {
    const buildBody = (useUsage: boolean) =>
      cfg.format === 'responses' ? buildResponsesBody(params, true) : buildChatBody(params, true, useUsage);
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
      if (cfg.format === 'chat' && includeUsage && shouldRetryWithoutStreamOptions(msg)) {
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
            format: cfg.format,
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
      format: cfg.format,
    });
  };

  if (
    cfg.format === 'chat'
    && p.tools?.length
    && p.onToolCall
    && (p.toolChoice ?? 'auto') !== 'none'
  ) {
    const messages = [...p.messages];
    const maxToolRounds = Math.max(0, Math.min(6, p.maxToolRounds ?? 3));
    let usage: LlmUsage | undefined;
    const thinkingParts: string[] = [];
    let hadToolRound = false;

    for (let round = 0; round <= maxToolRounds; round += 1) {
      const textDeltas: string[] = [];
      const thinkingDeltas: string[] = [];
      // 第一轮可能同时吐出解释文字和 tool_calls，先缓存，避免把中间说明当成最终 JSON/正文。
      // 已完成至少一轮工具后，下一轮大概率是在整理最终输出，实时透出可避免"思考完卡住"的观感。
      const emitTextLive = hadToolRound;
      const result = await requestStreamOnce(
        {
          ...p,
          messages,
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

      const toolCalls = result.toolCalls ?? [];
      if (toolCalls.length) {
        if (round >= maxToolRounds) {
          throw new Error(`模型连续请求工具超过上限（${maxToolRounds} 轮），已停止。`);
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
      return {
        text: result.text,
        thinking: joinThinking(...thinkingParts),
        reasoningContent: result.reasoningContent,
        finishReason: result.finishReason,
        usage,
        trace: buildPromptTrace(messages),
      };
    }
  }

  const result = await requestStreamOnce(p, true);
  return { ...result, trace: buildPromptTrace(p.messages) };
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
  });
  const split = splitThinkingFromText(result.text);
  return {
    text: split.text,
    thinking: joinThinking(
      result.thinking,
      result.reasoningContent,
      split.thinking,
    ),
    finishReason: result.finishReason,
    usage: result.usage,
    trace: result.trace,
  };
}
