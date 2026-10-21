import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  isRetryableHttpStatus,
  isRetryableTurnError,
  retryDelayMs,
  sleepWithAbort,
} from '@/lib/retry';

describe('瞬时错误重试策略', () => {
  it('网络/限流/5xx/非法 JSON/过短正文都视为可重试', () => {
    const retryable = [
      '模型请求失败（429）：rate limit',
      '模型请求失败（503）：upstream unavailable',
      'fetch failed',
      'network timeout',
      '连接中断：terminated',
      '规划模型正在分析本回合失败：模型返回的内容不是有效 JSON',
      '故事模型正在生成正文失败：模型输出过短（6 字，疑似流式截断）',
    ];
    for (const message of retryable) assert.equal(isRetryableTurnError(new Error(message)), true, message);
  });

  it('认证失败/用户取消/空消息不重试', () => {
    const nonRetryable = [
      '模型请求失败（401）：unauthorized',
      'API Key 无效或没有访问权限',
      '本次生成已取消。',
      '',
    ];
    for (const message of nonRetryable) assert.equal(isRetryableTurnError(new Error(message)), false, message);
    const abort = Object.assign(new Error('aborted'), { name: 'AbortError' });
    assert.equal(isRetryableTurnError(abort), false);
  });

  it('HTTP 状态只重试可恢复的网关/限流错误', () => {
    for (const status of [408, 409, 425, 429, 500, 502, 503, 504]) {
      assert.equal(isRetryableHttpStatus(status), true, String(status));
    }
    for (const status of [400, 401, 403, 404, 422, 501]) {
      assert.equal(isRetryableHttpStatus(status), false, String(status));
    }
  });

  it('退避延迟随尝试次数增加', () => {
    assert.ok(retryDelayMs(1) < retryDelayMs(2));
    assert.ok(retryDelayMs(2) >= 1000);
  });

  it('sleepWithAbort 在取消时立即拒绝', async () => {
    const controller = new AbortController();
    const pending = sleepWithAbort(10_000, controller.signal);
    controller.abort();
    await assert.rejects(pending, (error: unknown) => (error as Error).name === 'AbortError');
  });
});
