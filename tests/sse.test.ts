import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readSSE, readSSEDetailed } from '@/lib/sse';
import {
  DONE_FRAME,
  chatSSE,
  contentFrame,
  dataFrame,
  finishFrame,
  reasoningFrame,
  sseResponse,
  toolCallFrame,
  usageFrame,
} from './helpers/streamFixtures';

const noop = () => {};

describe('sse.readSSEDetailed — chat 格式', () => {
  it('多帧 delta 拼接并在 [DONE] 结束', async () => {
    const deltas: string[] = [];
    const result = await readSSEDetailed(
      chatSSE([contentFrame('你'), contentFrame('好'), DONE_FRAME]),
      { onDelta: (text) => deltas.push(text) },
    );
    assert.equal(result.text, '你好');
    assert.equal(deltas.join(''), '你好');
    assert.equal(result.thinking, undefined);
    assert.equal(result.finishReason, undefined);
    assert.equal(result.toolCalls, undefined);
  });

  it('单块内含多帧与 CRLF 换行也能解析', async () => {
    const payload = [
      'data: {"choices":[{"delta":{"content":"甲"}}]}\r\n\r\n',
      'data: {"choices":[{"delta":{"content":"乙"}}]}\r\n\r\n',
      'data: [DONE]\r\n\r\n',
    ].join('');
    const result = await readSSEDetailed(sseResponse([payload]), { onDelta: noop });
    assert.equal(result.text, '甲乙');
  });

  it('跳过 event 行、空 data 行与非法 JSON 帧，继续解析后续正文', async () => {
    const deltas: string[] = [];
    const result = await readSSEDetailed(
      chatSSE([
        'event: ping\n\n',
        '\n',
        'data:\n\n',
        ': keep-alive\n\n',
        'data: {"choices":[{"delta":{"content":"前"}}]}\n\n',
        'data: {这不是合法 JSON}\n\n',
        'data: 裸露文本\n\n',
        contentFrame('后'),
        DONE_FRAME,
      ]),
      { onDelta: (text) => deltas.push(text) },
    );
    assert.equal(result.text, '前后');
    assert.equal(deltas.join(''), '前后');
  });

  it('流自然结束（没有 [DONE]）也会返回结果', async () => {
    const result = await readSSEDetailed(chatSSE([contentFrame('半途')]), { onDelta: noop });
    assert.equal(result.text, '半途');
  });
});

describe('sse.readSSEDetailed — <think> 拆分', () => {
  it('跨帧切分的 </think> 归入思考，正文不含标签', async () => {
    const deltas: string[] = [];
    const thinkingDeltas: string[] = [];
    const result = await readSSEDetailed(
      chatSSE([
        contentFrame('开头<thi'),
        contentFrame('nk>思考内容</thi'),
        contentFrame('nk>结尾'),
        DONE_FRAME,
      ]),
      { onDelta: (text) => deltas.push(text), onThinkingDelta: (text) => thinkingDeltas.push(text) },
    );
    assert.equal(result.text, '开头结尾');
    assert.equal(result.thinking, '思考内容');
    assert.equal(result.reasoningContent, undefined);
    assert.equal(deltas.join(''), '开头结尾');
    assert.ok(!result.text.includes('think'), '正文不应包含 think 标签');
    assert.deepEqual(thinkingDeltas, ['思考内容']);
  });

  it('<think> 开标签跨帧时不会把半个标签当正文输出', async () => {
    const deltas: string[] = [];
    const result = await readSSEDetailed(
      chatSSE([contentFrame('正文<thi'), contentFrame('nk>内部'), contentFrame('</think>尾部'), DONE_FRAME]),
      { onDelta: (text) => deltas.push(text) },
    );
    assert.equal(result.text, '正文尾部');
    assert.equal(result.thinking, '内部');
    assert.equal(deltas.join(''), '正文尾部');
  });

  it('带空格或大小写变体的闭标签仍能被识别（回归：曾把正文全吞进思考）', async () => {
    for (const closeTag of ['</think >', '</ think>', '</THINK>', '</Think >']) {
      const result = await readSSEDetailed(
        chatSSE([contentFrame(`<think>思考${closeTag}正文`), DONE_FRAME]),
        { onDelta: () => {} },
      );
      assert.equal(result.text, '正文', `闭标签 ${JSON.stringify(closeTag)} 应被识别`);
      assert.equal(result.thinking, '思考', `闭标签 ${JSON.stringify(closeTag)} 应归入思考`);
    }
  });

  it('带空格的开标签变体不会被写进正文', async () => {
    for (const openTag of ['<think >', '< think>', '<THINK>', '< Think >']) {
      const result = await readSSEDetailed(
        chatSSE([contentFrame(`${openTag}思考</think>正文`), DONE_FRAME]),
        { onDelta: () => {} },
      );
      assert.equal(result.text, '正文', `开标签 ${JSON.stringify(openTag)} 不应污染正文`);
      assert.equal(result.thinking, '思考');
    }
  });

  it('闭标签始终缺失时，内容回退为正文而不是空正文（安全网）', async () => {
    const result = await readSSEDetailed(
      chatSSE([contentFrame('<think>模型忘了收尾的正文内容'), DONE_FRAME]),
      { onDelta: () => {} },
    );
    // 没有规范的 <think> 块可归入思考时，宁可按正文返回，也不能让回合以"空内容"失败。
    assert.equal(result.text, '模型忘了收尾的正文内容');
    assert.equal(result.thinking, undefined);
  });
});

describe('sse.readSSEDetailed — thinkingFallback', () => {
  it('思考通道承载 JSON、正文为空时把 JSON 还原为正文', async () => {
    const deltas: string[] = [];
    const result = await readSSEDetailed(
      chatSSE([reasoningFrame('{"a":1}'), DONE_FRAME]),
      { onDelta: (text) => deltas.push(text), thinkingFallback: 'json' },
    );
    assert.equal(result.text, '{"a":1}');
    assert.equal(result.thinking, undefined);
    assert.equal(result.reasoningContent, undefined);
    assert.deepEqual(deltas, ['{"a":1}']);
  });

  it('保留 JSON 之前的推理前缀作为思考内容', async () => {
    const result = await readSSEDetailed(
      chatSSE([reasoningFrame('先想想。{"ok":true}'), DONE_FRAME]),
      { onDelta: noop, thinkingFallback: 'json' },
    );
    assert.equal(result.text, '{"ok":true}');
    assert.equal(result.thinking, '先想想。');
  });

  it('未开启 thinkingFallback 时 JSON 仍算思考', async () => {
    const result = await readSSEDetailed(
      chatSSE([reasoningFrame('{"a":1}'), DONE_FRAME]),
      { onDelta: noop },
    );
    assert.equal(result.text, '');
    assert.equal(result.thinking, '{"a":1}');
    assert.equal(result.reasoningContent, '{"a":1}');
  });

  it('正文非空时不触发 fallback', async () => {
    const result = await readSSEDetailed(
      chatSSE([reasoningFrame('{"a":1}'), contentFrame('真正的正文'), DONE_FRAME]),
      { onDelta: noop, thinkingFallback: 'json' },
    );
    assert.equal(result.text, '真正的正文');
    assert.equal(result.thinking, '{"a":1}');
  });

  it('思考内容不是 JSON 时不触发 fallback', async () => {
    const result = await readSSEDetailed(
      chatSSE([reasoningFrame('只是一段推理，没有 JSON。'), DONE_FRAME]),
      { onDelta: noop, thinkingFallback: 'json' },
    );
    assert.equal(result.text, '');
    assert.equal(result.thinking, '只是一段推理，没有 JSON。');
  });
});

describe('sse.readSSEDetailed — tool_calls 聚合', () => {
  it('多帧拼接 arguments，按 index 合并，id/name 只出现一次', async () => {
    const result = await readSSEDetailed(
      chatSSE([
        toolCallFrame([{ index: 0, id: 'call_1', type: 'function', function: { name: 'search_story_context', arguments: '{"qu' } }]),
        toolCallFrame([{ index: 0, function: { arguments: 'ery":"阿黎"}' } }]),
        toolCallFrame([{ index: 0, function: { arguments: '' } }]),
        DONE_FRAME,
      ]),
      { onDelta: noop },
    );
    assert.equal(result.toolCalls?.length, 1);
    assert.deepEqual(result.toolCalls?.[0], {
      id: 'call_1',
      type: 'function',
      function: { name: 'search_story_context', arguments: '{"query":"阿黎"}' },
    });
  });

  it('多个 index 按序号排序，缺 id 时回退为 tool_call_<index>，缺 name 的调用被丢弃', async () => {
    const result = await readSSEDetailed(
      chatSSE([
        toolCallFrame([{ index: 2, function: { name: 'third', arguments: '{}' } }]),
        toolCallFrame([{ index: 0, id: 'call_0', type: 'function', function: { name: 'first', arguments: '{"a":1}' } }]),
        toolCallFrame([{ index: 1, function: { arguments: '{"only":"args"}' } }]),
        toolCallFrame([{ index: 3, id: 'call_3', type: 'function', function: { arguments: '{}' } }]),
        DONE_FRAME,
      ]),
      { onDelta: noop },
    );
    const calls = result.toolCalls ?? [];
    assert.equal(calls.length, 2, '没有 name 的调用应被过滤');
    assert.deepEqual(calls.map((call) => call.id), ['call_0', 'tool_call_2']);
    assert.deepEqual(calls.map((call) => call.function.name), ['first', 'third']);
    assert.equal(calls[1].function.arguments, '{}');
    assert.equal(calls[1].type, 'function');
  });

  it('缺少 function.name 的工具调用被忽略，并产生可观察警告（回归：曾完全静默）', async () => {
    const warnings: Array<{ code: string; message: string }> = [];
    const result = await readSSEDetailed(
      chatSSE([
        toolCallFrame([{ index: 0, id: 'call_1', type: 'function', function: { arguments: '{"query":"甲"}' } }]),
        toolCallFrame([{ index: 1, id: 'call_2', type: 'function', function: { name: 'search_story_context', arguments: '{}' } }]),
        DONE_FRAME,
      ]),
      { onDelta: noop, onWarning: (warning) => warnings.push(warning) },
    );
    assert.equal(result.toolCalls?.length, 1, '无名调用被忽略');
    assert.equal(result.toolCalls?.[0].function.name, 'search_story_context');
    assert.equal(warnings.length, 1);
    assert.equal(warnings[0].code, 'tool_call_without_name');
  });
});

describe('sse.readSSEDetailed — usage 与 finish_reason', () => {
  it('合并多帧 usage 与缓存字段，并识别 finish_reason=length', async () => {
    const result = await readSSEDetailed(
      chatSSE([
        usageFrame({ prompt_tokens: 10, prompt_cache_hit_tokens: 4 }, '甲'),
        contentFrame('乙'),
        usageFrame({ completion_tokens: 5, total_tokens: 15 }),
        finishFrame('length'),
        DONE_FRAME,
      ]),
      { onDelta: noop },
    );
    assert.equal(result.text, '甲乙');
    assert.equal(result.finishReason, 'length');
    assert.equal(result.usage?.promptTokens, 10);
    assert.equal(result.usage?.completionTokens, 5);
    assert.equal(result.usage?.totalTokens, 15);
    assert.equal(result.usage?.cache?.hitTokens, 4);
  });

  it('供应商缓存字段缺失时 usage 里不出现 cache', async () => {
    const result = await readSSEDetailed(
      chatSSE([usageFrame({ prompt_tokens: 3, completion_tokens: 1 }), DONE_FRAME]),
      { onDelta: noop },
    );
    assert.equal(result.usage?.promptTokens, 3);
    assert.equal(result.usage?.completionTokens, 1);
    assert.equal(result.usage?.totalTokens, undefined);
    assert.equal(result.usage?.cache, undefined);
  });
});

describe('sse.readSSEDetailed — 边界', () => {
  it('响应体为空时抛错', async () => {
    await assert.rejects(
      () => readSSEDetailed(new Response(null), { onDelta: noop }),
      /响应体为空/,
    );
  });

  it('已中止的 signal 抛出 AbortError', async () => {
    await assert.rejects(
      () => readSSEDetailed(chatSSE([contentFrame('x')]), { onDelta: noop, signal: AbortSignal.abort() }),
      (error: any) => error?.name === 'AbortError',
    );
  });

  it('readSSE 直接返回正文文本', async () => {
    const text = await readSSE(chatSSE([contentFrame('简'), contentFrame('写'), DONE_FRAME]), { onDelta: noop });
    assert.equal(text, '简写');
  });

  it('data 帧里没有 choices 时不影响后续解析', async () => {
    const result = await readSSEDetailed(
      chatSSE([dataFrame({ id: 'chunk', object: 'chat.completion.chunk' }), contentFrame('正文'), DONE_FRAME]),
      { onDelta: noop },
    );
    assert.equal(result.text, '正文');
  });
});
