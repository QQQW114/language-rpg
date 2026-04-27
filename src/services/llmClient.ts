// OpenAI 兼容的 LLM 客户端：支持 Chat Completions 与 Responses 两种请求格式

import { readSSEDetailed, type StreamResult } from '@/lib/sse';
import type { ApiFormat } from '@/types/settings';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
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
}

export interface ChatStreamParams extends ChatParams {
  onDelta: (text: string) => void;
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

function buildChatBody(p: ChatParams, stream: boolean): Record<string, unknown> {
  return {
    model: p.model,
    messages: p.messages,
    temperature: p.temperature ?? 0.9,
    stream,
    ...(p.maxTokens ? { max_tokens: p.maxTokens } : {}),
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
    } else {
      input.push({ role: m.role, content: m.content });
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
): Promise<StreamResult> {
  if (!cfg.apiKey) throw new Error('未配置 API Key，请先在设置中填写');
  if (!cfg.baseUrl) throw new Error('未配置 API Base URL');
  if (!p.model) throw new Error('未选择模型');

  const url = cfg.format === 'responses' ? responsesEndpoint(cfg.baseUrl) : chatEndpoint(cfg.baseUrl);
  const body = cfg.format === 'responses' ? buildResponsesBody(p, true) : buildChatBody(p, true);

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${cfg.apiKey}`,
      Accept: 'text/event-stream',
    },
    body: JSON.stringify(body),
    signal: p.signal,
  });

  if (!res.ok) {
    const msg = await readErrorBody(res);
    throw new Error(`模型请求失败（${res.status}）：${msg}`);
  }

  return readSSEDetailed(res, { onDelta: p.onDelta, signal: p.signal, format: cfg.format });
}

export async function chatJSON(
  cfg: ChatClientConfig,
  p: ChatParams,
): Promise<string> {
  if (!cfg.apiKey) throw new Error('未配置 API Key，请先在设置中填写');
  if (!cfg.baseUrl) throw new Error('未配置 API Base URL');
  if (!p.model) throw new Error('未选择模型');

  // Responses 格式：部分 Codex 代理的非流式响应会返回空 output；统一走流式再聚合。
  if (cfg.format === 'responses') {
    let full = '';
    await chatStream(cfg, { ...p, onDelta: (t) => { full += t; } });
    return full;
  }

  const url = chatEndpoint(cfg.baseUrl);
  const body = buildChatBody(p, false);

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${cfg.apiKey}`,
    },
    body: JSON.stringify(body),
    signal: p.signal,
  });

  if (!res.ok) {
    const msg = await readErrorBody(res);
    throw new Error(`模型请求失败（${res.status}）：${msg}`);
  }
  const json = await res.json();
  const content: string = json?.choices?.[0]?.message?.content ?? '';
  return content;
}
