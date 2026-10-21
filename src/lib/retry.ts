/**
 * 真实 Web 场景的瞬时错误重试策略。
 *
 * 只重试"再试一次可能成功"的错误：网络中断、超时、429、5xx、上游返回空内容/非法 JSON、
 * 以及正文被截断（过短）。认证失败、用户主动取消、状态冲突等不重试。
 *
 * 这层只做判定与退避，不自己发请求：传输层（llmClient）用它重试单次请求，
 * 回合层（GamePage）用它决定是否自动重跑整回合。
 */

/** 可以安全重试的 HTTP 状态码。 */
export const RETRYABLE_HTTP_STATUSES: ReadonlySet<number> = new Set([408, 409, 425, 429, 500, 502, 503, 504]);

export function isRetryableHttpStatus(status: number): boolean {
  return RETRYABLE_HTTP_STATUSES.has(status);
}

/** 不可重试：认证/权限/用户取消。 */
const NON_RETRYABLE_PATTERN = /401|403|unauthorized|api[\s_-]?key|认证|无权|密钥无效|取消|cancelled|abort/i;

/** 可重试：传输/网关/上游输出异常。 */
const RETRYABLE_PATTERN = /429|rate limit|频率|额度|5\d\d|500|502|503|504|fetch|network|terminated|ECONNRESET|socket|timeout|超时|连接|中断|empty|空内容|不是有效 JSON|JSON|过短|截断|结算失败/i;

function isAbortError(error: unknown): boolean {
  return !!error
    && typeof error === 'object'
    && ((error as { name?: unknown }).name === 'AbortError' || (error as { name?: unknown }).name === 'TimeoutError');
}

export function isRetryableTurnError(error: unknown): boolean {
  if (isAbortError(error)) return false;
  const message = error instanceof Error ? error.message : String(error ?? '');
  if (!message.trim()) return false;
  if (NON_RETRYABLE_PATTERN.test(message)) return false;
  return RETRYABLE_PATTERN.test(message);
}

/** 指数退避（毫秒）；attempt 从 1 开始。 */
export function retryDelayMs(attempt: number): number {
  return attempt <= 1 ? 400 : 1200;
}

/** 可被 AbortSignal 打断的 sleep，避免取消后仍等待。 */
export function sleepWithAbort(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException('Aborted', 'AbortError'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}
