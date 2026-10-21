import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { chatStreamDetailed } from '@/services/llmClient';
import { DONE_FRAME, chatSSE, contentFrame, withFetchMock } from './helpers/streamFixtures';

const CFG = { baseUrl: 'https://api.test.invalid/v1', apiKey: 'test-key' };

function okReply(text: string): Response {
  return chatSSE([contentFrame(text), DONE_FRAME]);
}

describe('llmClient 传输层重试', () => {
  it('503 自动重试后成功（不把一次网关错误直接抛给玩家）', async () => {
    let calls = 0;
    await withFetchMock(() => {
      calls += 1;
      if (calls === 1) return new Response('upstream unavailable', { status: 503 });
      return okReply('重试成功');
    }, async (mock) => {
      const result = await chatStreamDetailed(CFG, {
        model: 'test-model',
        messages: [{ role: 'user', content: '继续' }],
        onDelta: () => {},
      });
      assert.equal(result.text, '重试成功');
      assert.equal(mock.requests.length, 2, '应在 503 后自动重试一次');
    });
  });

  it('401 认证失败不重试，避免无意义重复请求', async () => {
    let calls = 0;
    await withFetchMock(() => {
      calls += 1;
      return new Response('unauthorized', { status: 401 });
    }, async (mock) => {
      await assert.rejects(
        () => chatStreamDetailed(CFG, {
          model: 'test-model',
          messages: [{ role: 'user', content: '继续' }],
          onDelta: () => {},
        }),
        /401/,
      );
      assert.equal(calls, 1);
      assert.equal(mock.requests.length, 1);
    });
  });
});
