import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { chatStreamDetailed } from '@/services/llmClient';
import {
  DONE_FRAME,
  chatSSE,
  contentFrame,
  finishFrame,
  toolCallFrame,
  withFetchMock,
} from './helpers/streamFixtures';

const CFG = { baseUrl: 'https://api.test.invalid/v1', apiKey: 'test-key' };

/**
 * 这些用例专门覆盖工具循环里"模型一次给出多种输出"的真实行为，
 * 以及提前把最终 JSON 写在第 0 轮、末轮却只回空内容的常见形态。
 */
describe('llmClient 工具循环', () => {
  it('末轮为空时回退到前一轮已写好的文本（回归：曾丢掉整段 JSON）', async () => {
    const brief = JSON.stringify({ intent: '观察', writingBrief: '写主角观察四周' });
    const handler = (request: { index: number }) => {
      if (request.index === 0) {
        // 第 0 轮：同一轮里既有完整 JSON，又发起一次工具调用。
        return chatSSE([
          contentFrame(brief),
          toolCallFrame([{ index: 0, id: 'call-1', type: 'function', function: { name: 'search_story_context', arguments: '{"query":"门廊"}' } }]),
          finishFrame('tool_calls'),
          DONE_FRAME,
        ]);
      }
      // 第 1 轮：只回一个空的 stop。
      return chatSSE([finishFrame('stop'), DONE_FRAME]);
    };

    await withFetchMock(handler, async (mock) => {
      const result = await chatStreamDetailed(CFG, {
        model: 'test-model',
        messages: [{ role: 'user', content: '看看四周' }],
        tools: [{ type: 'function', function: { name: 'search_story_context', description: 'query', parameters: { type: 'object' } } }],
        toolChoice: 'auto',
        maxToolRounds: 2,
        onToolCall: async () => ({ resultCount: 0, results: [] }),
        onDelta: () => {},
      });
      assert.equal(mock.requests.length, 2, '应该只发两次请求');
      assert.equal(result.text, brief, '末轮为空时必须回退到第 0 轮已经写好的 JSON，而不是返回空串');
      assert.equal(result.finishReason, 'stop');
    });
  });

  it('最后一轮不再向模型声明工具，且模型仍请求工具时不再抛错（回归：曾直接打掉整回合）', async () => {
    const brief = JSON.stringify({ intent: '继续' });
    let lastBody: any;
    const handler = (request: { index: number; body: any }) => {
      lastBody = request.body;
      // 每一轮都请求工具，模拟"用满轮次还想再查一次"的模型。
      return chatSSE([
        ...(request.index === 0 ? [contentFrame(brief)] : []),
        toolCallFrame([{ index: 0, id: `call-${request.index}`, type: 'function', function: { name: 'search_story_context', arguments: '{"query":"甲"}' } }]),
        finishFrame('tool_calls'),
        DONE_FRAME,
      ]);
    };

    await withFetchMock(handler, async (mock) => {
      const result = await chatStreamDetailed(CFG, {
        model: 'test-model',
        messages: [{ role: 'user', content: '继续' }],
        tools: [{ type: 'function', function: { name: 'search_story_context', description: 'query', parameters: { type: 'object' } } }],
        toolChoice: 'auto',
        maxToolRounds: 2,
        onToolCall: async () => ({ ok: true }),
        onDelta: () => {},
      });
      // 末轮（第 2 轮，index 2）必须去掉 tools 声明
      assert.equal(lastBody.tools, undefined, '最后一轮不应再声明工具');
      assert.equal(lastBody.tool_choice, undefined, '最后一轮不应再带 tool_choice');
      // 前两轮仍然带工具
      assert.equal(Array.isArray(mock.requests[0].body.tools), true);
      assert.equal(Array.isArray(mock.requests[1].body.tools), true);
      assert.equal(result.text, brief, '模型仍请求工具时应保留已生成的内容而不是抛错');
    });
  });

  it('工具轮次耗尽且从未产出可用文本时仍然抛错（保留失败可见性）', async () => {
    const handler = () => chatSSE([
      toolCallFrame([{ index: 0, id: 'call-x', type: 'function', function: { name: 'search_story_context', arguments: '{"query":"甲"}' } }]),
      finishFrame('tool_calls'),
      DONE_FRAME,
    ]);

    await withFetchMock(handler, async () => {
      await assert.rejects(
        () => chatStreamDetailed(CFG, {
          model: 'test-model',
          messages: [{ role: 'user', content: '继续' }],
          tools: [{ type: 'function', function: { name: 'search_story_context', description: 'query', parameters: { type: 'object' } } }],
          toolChoice: 'auto',
          maxToolRounds: 1,
          onToolCall: async () => ({ ok: true }),
          onDelta: () => {},
        }),
        /超过上限/,
      );
    });
  });
});
