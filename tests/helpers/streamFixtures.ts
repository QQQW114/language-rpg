/** SSE / fetch 测试辅助：构造 Response 流并拦截 globalThis.fetch（绝不真发请求）。 */

export function sseResponse(chunks: string[], init: ResponseInit = {}): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
    ...init,
  });
}

export function dataFrame(payload: unknown): string {
  return `data: ${typeof payload === 'string' ? payload : JSON.stringify(payload)}\n\n`;
}

export const DONE_FRAME = 'data: [DONE]\n\n';

export function chatSSE(frames: Array<unknown>): Response {
  return sseResponse(frames.map((frame) => (typeof frame === 'string' ? frame : dataFrame(frame))));
}

// ---- chat 格式分帧构造 ----

export function contentFrame(text: string): unknown {
  return { choices: [{ index: 0, delta: { content: text } }] };
}

export function reasoningFrame(text: string): unknown {
  return { choices: [{ index: 0, delta: { reasoning_content: text } }] };
}

export function finishFrame(reason: string): unknown {
  return { choices: [{ index: 0, delta: {}, finish_reason: reason }] };
}

export function usageFrame(usage: unknown, content?: string): unknown {
  return { choices: [{ index: 0, delta: content ? { content } : {} }], usage };
}

export function toolCallFrame(calls: unknown[]): unknown {
  return { choices: [{ index: 0, delta: { tool_calls: calls } }] };
}

// ---- fetch mock ----

export interface RecordedRequest {
  index: number;
  url: string;
  method: string;
  headers: Record<string, string>;
  /** 已 JSON.parse 的请求体；解析失败时是原始字符串。 */
  body: any;
  rawBody: string;
}

export type FetchHandler = (request: RecordedRequest) => Response | Promise<Response>;

export interface FetchMock {
  requests: RecordedRequest[];
  restore: () => void;
}

/** 安装 fetch mock；返回的记录数组在每次请求后追加。 */
export function installFetchMock(handler: FetchHandler): FetchMock {
  const original = globalThis.fetch;
  const requests: RecordedRequest[] = [];
  const mock = (async (input: any, init: any = {}) => {
    const url = typeof input === 'string' ? input : String(input?.url ?? input);
    const rawBody = typeof init?.body === 'string' ? init.body : '';
    let body: any = undefined;
    if (rawBody) {
      try {
        body = JSON.parse(rawBody);
      } catch {
        body = rawBody;
      }
    }
    const request: RecordedRequest = {
      index: requests.length,
      url,
      method: String(init?.method ?? 'GET'),
      headers: (init?.headers ?? {}) as Record<string, string>,
      body,
      rawBody,
    };
    requests.push(request);
    const response = await handler(request);
    if (!response) throw new Error(`fetch mock 没有为第 ${request.index} 个请求准备响应`);
    return response;
  }) as typeof fetch;

  globalThis.fetch = mock;
  return {
    requests,
    restore() {
      globalThis.fetch = original;
    },
  };
}

export async function withFetchMock<T>(
  handler: FetchHandler,
  run: (mock: FetchMock) => Promise<T>,
): Promise<T> {
  const mock = installFetchMock(handler);
  try {
    return await run(mock);
  } finally {
    mock.restore();
  }
}

/** 从请求体里取 system 消息文本（chat 格式）。 */
export function systemPromptOf(request: RecordedRequest): string {
  const messages = request.body?.messages;
  if (Array.isArray(messages)) {
    return messages.filter((m: any) => m?.role === 'system').map((m: any) => String(m.content ?? '')).join('\n');
  }
  return String(request.body?.instructions ?? '');
}

/** 从请求体里取最后一条 user 消息文本。 */
export function lastUserPromptOf(request: RecordedRequest): string {
  const messages = request.body?.messages;
  if (Array.isArray(messages)) {
    const users = messages.filter((m: any) => m?.role === 'user');
    return String(users[users.length - 1]?.content ?? '');
  }
  const input = request.body?.input;
  if (Array.isArray(input)) {
    const users = input.filter((m: any) => m?.role === 'user');
    return String(users[users.length - 1]?.content ?? '');
  }
  return '';
}
