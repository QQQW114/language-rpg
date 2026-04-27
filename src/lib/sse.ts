// OpenAI 兼容 SSE 解析
// 支持两种格式：
//  1) chat: data: {"choices":[{"delta":{"content":"..."}}]}
//  2) responses: 事件 response.output_text.delta → {"delta":"..."}

export interface StreamOptions {
  onDelta: (text: string) => void;
  signal?: AbortSignal;
  format?: 'chat' | 'responses';
}

type RawFrame = Record<string, unknown>;

function extractChatDelta(frame: RawFrame): string | undefined {
  const choices = (frame as any).choices;
  if (!Array.isArray(choices) || choices.length === 0) return undefined;
  const content = choices[0]?.delta?.content;
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

export async function readSSE(
  response: Response,
  opts: StreamOptions,
): Promise<string> {
  if (!response.body) throw new Error('响应体为空');
  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  let full = '';

  const extractor = opts.format === 'responses' ? extractResponsesDelta : extractChatDelta;

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
        if (payload === '[DONE]') return full;

        let frame: RawFrame;
        try {
          frame = JSON.parse(payload);
        } catch {
          continue;
        }

        const delta = extractor(frame);
        if (delta) {
          full += delta;
          opts.onDelta(delta);
        }
      }
    }
  } finally {
    try { reader.releaseLock(); } catch { /* noop */ }
  }
  return full;
}
