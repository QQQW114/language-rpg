import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeDestinyPatch, runTurnV2 } from '@/v2/engine';
import type { AppSettings } from '@/types/settings';
import type { GameStateV2, ModelActivityV2, ModelPhaseV2, ModelPhaseStatusV2, TurnRequestV2 } from '@/v2/types';
import { makeBackground, makeOutline, makeSettings, makeState } from './helpers/fixtures';
import {
  DONE_FRAME,
  chatSSE,
  contentFrame,
  finishFrame,
  reasoningFrame,
  toolCallFrame,
  usageFrame,
  withFetchMock,
} from './helpers/streamFixtures';
import type { RecordedRequest } from './helpers/streamFixtures';

// ---------------------------------------------------------------------------
// 夹具：三阶段 mock 数据
// ---------------------------------------------------------------------------

const BRIEF = {
  intent: '试探',
  currentAct: '第一幕',
  activeBeatIds: ['beat-1-1'],
  destinyProgress: '40%',
  pathChange: '',
  reframingNeeded: [],
  reconvergencePlan: '',
  nextStoryFunction: '',
  writingBrief: '主角向阿黎打听消息',
  hardConstraints: ['不得让阿黎直接说出地点'],
  creativeSpace: ['可以加入雨声'],
  forbiddenChanges: ['不得改变阿黎的身份'],
  stopBoundary: '阿黎说出一个地名',
  randomEvent: { planned: false, summary: '' },
};

const STORY_TEXT = '雨夜的街口很安静。阿黎压低声音，说出了一个地名。';

const POST_PATCH = {
  schemaVersion: 2,
  commitId: 'model-provided-commit',
  baseRevision: 999,
  turn: 999,
  roundSummary: '本轮摘要',
  latestProgress: '雨夜街口，阿黎说出了地名。',
  characters: [{ op: 'update', id: 'char-a', addFacts: ['知道一个地名'], reason: '正文证据' }],
  relationships: [{ fromId: 'player', toId: 'char-a', affinityDelta: 3, reason: '交换了信息' }],
  inventory: [],
  threads: [],
  facts: [],
  scene: { name: '雨夜街口' },
  actions: [{ id: 'a1', label: '追问地名' }],
  destiny: {
    completionEstimate: 42,
    completionReason: '仍在第一幕',
    currentActId: 'act-1',
    currentStage: '第一幕',
    currentPath: '开局',
    endingReached: false,
    reason: '本轮推进了一点',
    beatChanges: [{ beatId: 'beat-1-1', status: 'active', evidenceQuote: '阿黎说出一个地名', reason: '开场功能正在实现' }],
  },
  randomEvent: { handled: false, note: '' },
};

function jsonStream(value: unknown): Response {
  const text = JSON.stringify(value);
  const middle = Math.max(1, Math.floor(text.length / 2));
  return chatSSE([contentFrame(text.slice(0, middle)), contentFrame(text.slice(middle)), DONE_FRAME]);
}

function storyStream(options: { thinking?: string; finishReason?: string; usage?: unknown; text?: string } = {}): Response {
  const text = options.text ?? STORY_TEXT;
  const middle = Math.max(1, Math.floor(text.length / 2));
  return chatSSE([
    ...(options.thinking ? [reasoningFrame(options.thinking)] : []),
    contentFrame(text.slice(0, middle)),
    contentFrame(text.slice(middle)),
    ...(options.usage ? [usageFrame(options.usage)] : []),
    ...(options.finishReason ? [finishFrame(options.finishReason)] : []),
    DONE_FRAME,
  ]);
}

function makeRequest(overrides: {
  state?: Record<string, unknown>;
  settings?: Partial<AppSettings>;
  input?: string;
  hooks?: Partial<TurnRequestV2>;
} = {}): TurnRequestV2 {
  return {
    state: makeState({
      revision: 4,
      turn: 2,
      phase: 'input',
      mode: 'author',
      summary: '此前发生过一些事。',
      latestProgress: '街口',
      history: [{ id: 'msg-1', role: 'user', content: '我先前的行动', turn: 1, createdAt: 1 }],
      lastCommitId: 'commit-previous',
      ...overrides.state,
    }),
    input: overrides.input ?? '我向阿黎打听消息',
    settings: makeSettings(overrides.settings),
    outline: makeOutline(),
    background: makeBackground(),
    worldFacts: [{ id: 'wf-1', name: '世界基调', keywords: [], content: '常年阴雨。' }],
    ...overrides.hooks,
  };
}

/** 三个阶段的统一 mock：按 system 提示词区分阶段。 */
function phaseHandler(options: {
  brief?: () => Response;
  story?: () => Response;
  post?: () => Response;
} = {}) {
  const json = jsonStream;
  const story = () => storyStream();
  return (request: RecordedRequest): Response => {
    const system = systemPromptOf(request);
    if (system.includes('写前规划 Agent')) return (options.brief ?? (() => json(BRIEF)))();
    if (system.includes('写后审计')) return (options.post ?? (() => json(POST_PATCH)))();
    if (system.includes('只写中文小说正文')) return (options.story ?? story)();
    throw new Error(`mock 收到未知阶段的请求：${system.slice(0, 60)}`);
  };
}

function systemPromptOf(request: RecordedRequest): string {
  const messages = request.body?.messages;
  if (Array.isArray(messages)) {
    return messages.filter((m: any) => m?.role === 'system').map((m: any) => String(m.content ?? '')).join('\n');
  }
  return String(request.body?.instructions ?? '');
}

function lastUserPromptOf(request: RecordedRequest): string {
  if (Array.isArray(request.body?.messages)) {
    const users = request.body.messages.filter((m: any) => m?.role === 'user');
    return String(users[users.length - 1]?.content ?? '');
  }
  const input = request.body?.input;
  if (Array.isArray(input)) {
    const users = input.filter((m: any) => m?.role === 'user');
    return String(users[users.length - 1]?.content ?? '');
  }
  return '';
}

/** 把一条请求里的所有消息文本拼起来：STABLE_STORY_CONTEXT 在第一条 user 消息，
 *  而 lastUserPromptOf 只取最后一条，检查注入内容时不能只用它。 */
function allPromptTextOf(request: RecordedRequest): string {
  const messages = request.body?.messages;
  if (Array.isArray(messages)) return messages.map((m: any) => String(m?.content ?? '')).join('\n');
  const input = request.body?.input;
  if (Array.isArray(input)) return input.map((m: any) => String(m?.content ?? '')).join('\n');
  return '';
}

const phaseOf = (request: RecordedRequest): ModelPhaseV2 => {
  const system = systemPromptOf(request);
  if (system.includes('写前规划 Agent')) return 'planner_pre';
  if (system.includes('写后审计')) return 'planner_post';
  return 'story';
};

// ---------------------------------------------------------------------------
// D. normalizeDestinyPatch
// ---------------------------------------------------------------------------

describe('engine.normalizeDestinyPatch', () => {
  it('非对象输入返回 undefined', () => {
    for (const raw of [undefined, null, 'text', 42, [], true]) {
      assert.equal(normalizeDestinyPatch(raw, []), undefined, `输入 ${String(raw)} 应返回 undefined`);
    }
  });

  it('缺 reason 时补默认理由并产生 destiny_reason_defaulted 警告', () => {
    const warnings: any[] = [];
    const destiny = normalizeDestinyPatch(
      { completionEstimate: 52, completionReason: '转学改变了路径' },
      warnings,
    );
    assert.ok(destiny?.reason.includes('转学改变了路径'), `实际：${destiny?.reason}`);
    assert.equal(destiny?.reason.startsWith('程序根据完成度说明补全：'), true);
    assert.deepEqual(warnings.map((w) => [w.code, w.path]), [['destiny_reason_defaulted', 'destiny.reason']]);
    assert.equal(destiny?.completionEstimate, 52, '其余合法字段保持');
  });

  it('缺 reason 且缺 completionReason 时使用通用理由', () => {
    const warnings: any[] = [];
    const destiny = normalizeDestinyPatch({ completionEstimate: 10 }, warnings);
    assert.equal(destiny?.reason, '程序补全：规划模型提交了命运状态变化，但遗漏了总更新理由。');
    assert.equal(warnings.length, 1);
  });

  it('reason 只有空白视为缺失；已提供时不产生警告', () => {
    const blank = normalizeDestinyPatch({ reason: '   ', completionReason: '有说明' }, []);
    assert.equal(blank?.reason.startsWith('程序根据完成度说明补全：'), true);

    const warnings: any[] = [];
    const filled = normalizeDestinyPatch({ reason: '本轮正文推进了第一幕', completionReason: '有说明' }, warnings);
    assert.equal(filled?.reason, '本轮正文推进了第一幕');
    assert.deepEqual(warnings, []);
  });

  it('beatChanges[].reason 缺失时补全并产生 beat_reason_defaulted', () => {
    const warnings: any[] = [];
    const destiny = normalizeDestinyPatch({
      reason: '总理由',
      beatChanges: [{ beatId: 'beat-1-1', status: 'available', evidenceSummary: '公开名单已经出现。' }],
    }, warnings);
    assert.equal(destiny?.beatChanges?.[0].reason, '程序根据节拍说明补全：公开名单已经出现。');
    assert.deepEqual(warnings.map((w) => [w.code, w.path]), [['beat_reason_defaulted', 'destiny.beatChanges[0].reason']]);
    assert.ok(warnings[0].message.includes('beat-1-1'));
  });

  it('beatChanges[].reason 缺失且无说明时使用通用理由', () => {
    const destiny = normalizeDestinyPatch({ reason: '总理由', beatChanges: [{ beatId: 'b', status: 'pending' }] }, []);
    assert.equal(destiny?.beatChanges?.[0].reason, '程序补全：规划模型提交了故事节变化，但遗漏了变化理由。');
  });

  it('beatChanges 不是数组时结果为空数组', () => {
    assert.deepEqual(normalizeDestinyPatch({ reason: 'x', beatChanges: 'nope' }, [])?.beatChanges, []);
    assert.deepEqual(normalizeDestinyPatch({ reason: 'x' }, [])?.beatChanges, []);
    assert.deepEqual(normalizeDestinyPatch({ reason: 'x', beatChanges: {} }, [])?.beatChanges, []);
  });

  it('beatChanges 混入字符串/null/数组元素时被过滤且不抛错', () => {
    const warnings: any[] = [];
    const destiny = normalizeDestinyPatch({
      reason: 'x',
      beatChanges: ['string', null, 7, ['nested'], { beatId: 'beat-1-1', status: 'active', reason: '合法' }],
    }, warnings);
    assert.equal(destiny?.beatChanges?.length, 1);
    assert.equal(destiny?.beatChanges?.[0].reason, '合法');
    assert.deepEqual(warnings, []);
  });
});

// ---------------------------------------------------------------------------
// D. runTurnV2 端到端（mock fetch）
// ---------------------------------------------------------------------------

describe('engine.runTurnV2 — 端到端（mock fetch）', () => {
  it('三阶段顺利提交：turn/revision 递增、history、turnRecords、patch 合并', async () => {
    const activity: ModelActivityV2[] = [];
    const phases: Array<[ModelPhaseV2, ModelPhaseStatusV2]> = [];
    const storyDeltas: string[] = [];
    const request = makeRequest({
      hooks: {
        onModelActivity: (item) => activity.push(item),
        onPhaseChange: (phase, status) => phases.push([phase, status]),
        onStoryDelta: (text) => storyDeltas.push(text),
      },
    });

    const result = await withFetchMock(
      phaseHandler({
        story: () => storyStream({
          thinking: '先想想阿黎会怎么反应。',
          usage: { prompt_tokens: 30, completion_tokens: 12, prompt_cache_hit_tokens: 8 },
        }),
      }),
      async (mock) => {
        const output = await runTurnV2(request);
        assert.equal(mock.requests.length, 3, '应恰好调用三次模型');
        assert.deepEqual(mock.requests.map(phaseOf), ['planner_pre', 'story', 'planner_post']);
        for (const call of mock.requests) {
          assert.equal(call.url, 'https://api.test.invalid/v1/chat/completions');
          assert.equal((call.headers as any).Authorization, 'Bearer test-key');
          assert.equal(call.body.stream, true);
        }
        return output;
      },
    );

    // 权威状态
    assert.equal(result.state.turn, request.state.turn + 1);
    assert.equal(result.state.revision, request.state.revision + 1);
    assert.equal(result.state.phase, 'input');
    assert.equal(result.state.summary, '本轮摘要');
    assert.equal(result.state.latestProgress, '雨夜街口，阿黎说出了地名。');
    assert.equal(result.state.currentScene?.name, '雨夜街口');
    assert.equal(result.state.destiny.completionEstimate, 42);
    assert.equal(result.state.destiny.beats.find((b) => b.beatId === 'beat-1-1')?.status, 'active');
    assert.deepEqual(result.state.characters[0].knownFacts, ['住在城南', '知道一个地名']);
    assert.equal(result.state.relationships[0].affinity, 13, '好感 10 + 3');
    assert.deepEqual(result.state.availableActions, [], 'author 模式不保留 actions');
    assert.equal(result.state.lastCommitId, result.patch.commitId);
    assert.ok(result.patch.commitId.startsWith('commit_'));
    assert.equal(result.state.lastCommitId === request.state.lastCommitId, false);

    // 历史：原 1 条 + user + assistant
    assert.equal(result.state.history.length, 3);
    assert.equal(result.state.history[1].role, 'user');
    assert.equal(result.state.history[1].content, request.input);
    assert.equal(result.state.history[1].turn, 2);
    assert.equal(result.state.history[2].role, 'assistant');
    assert.equal(result.state.history[2].content, STORY_TEXT);
    assert.equal(result.state.history[2].thinking, '先想想阿黎会怎么反应。');
    assert.equal(result.story, STORY_TEXT);

    // turnRecords：3 个 call
    assert.equal(result.state.turnRecords?.length, 1);
    const record = result.state.turnRecords![0];
    assert.equal(record.turn, 2);
    assert.equal(record.input, request.input);
    assert.equal(record.story, STORY_TEXT);
    assert.deepEqual(record.calls.map((c) => c.phase), ['planner_pre', 'story', 'planner_post']);
    assert.equal(record.calls[1].usage?.promptTokens, 30);
    assert.equal(record.calls[1].usage?.cache?.hitTokens, 8);
    assert.equal(record.calls[1].thinking, '先想想阿黎会怎么反应。');
    assert.ok(record.calls[0].input?.system?.includes('写前规划 Agent'));

    // usage 透传
    assert.equal(result.usage.story?.completionTokens, 12);
    assert.equal(result.brief.intent, '试探');

    // 阶段回调
    assert.deepEqual(phases, [
      ['planner_pre', 'started'],
      ['planner_pre', 'completed'],
      ['story', 'started'],
      ['story', 'completed'],
      ['planner_post', 'started'],
      ['planner_post', 'completed'],
    ]);

    // 活动流
    const types = activity.map((item) => item.type);
    assert.ok(types.includes('phase'));
    assert.ok(types.includes('thinking_delta'));
    assert.ok(types.includes('output_delta'));
    assert.ok(types.includes('usage'));
    assert.ok(!types.includes('tool'), '未开启工具时不应有工具事件');
    const storyThinking = activity.find((item) => item.type === 'thinking_delta' && item.phase === 'story');
    assert.equal((storyThinking as any)?.text, '先想想阿黎会怎么反应。');
    assert.equal(storyDeltas.join(''), STORY_TEXT);
  });

  it('故事阶段的正文提示词带上写作简报、边界与最近历史窗口', async () => {
    const request = makeRequest();
    await withFetchMock(phaseHandler(), async (mock) => {
      await runTurnV2(request);
      const storyRequest = mock.requests[1];
      const user = lastUserPromptOf(storyRequest);
      assert.ok(user.includes('【writingBrief】主角向阿黎打听消息'));
      assert.ok(user.includes('【STOP_BOUNDARY】阿黎说出一个地名'));
      assert.ok(user.includes('【RANDOM_EVENT_PLAN】本回合无随机事件安排'));
      assert.ok(user.includes('【AUTHORITATIVE_STATE】'));
      assert.ok(user.includes('我先前的行动'), '应带上最近历史');
      const plannerRequest = mock.requests[0];
      assert.ok(lastUserPromptOf(plannerRequest).includes('【CURRENT_TURN_INPUT】我向阿黎打听消息'));
    });
  });

  it('planner_pre 返回非法 JSON 时抛错且不调用故事阶段', async () => {
    const request = makeRequest();
    await withFetchMock(
      phaseHandler({ brief: () => chatSSE([contentFrame('这不是 JSON'), DONE_FRAME]) }),
      async (mock) => {
        await assert.rejects(() => runTurnV2(request), /不是有效 JSON/);
        assert.equal(mock.requests.length, 1, '故事阶段不应被调用');
      },
    );
  });

  it('planner_pre 返回空内容或截断时抛错且不调用故事阶段', async () => {
    const empty = makeRequest();
    await withFetchMock(
      phaseHandler({ brief: () => chatSSE([DONE_FRAME]) }),
      async (mock) => {
        await assert.rejects(() => runTurnV2(empty), /返回了空内容/);
        assert.equal(mock.requests.length, 1);
      },
    );

    const truncated = makeRequest();
    await withFetchMock(
      phaseHandler({ brief: () => chatSSE([contentFrame('{"intent":"x"'), finishFrame('length'), DONE_FRAME]) }),
      async (mock) => {
        await assert.rejects(() => runTurnV2(truncated), /达到上限而被截断/);
        assert.equal(mock.requests.length, 1);
      },
    );
  });

  it('故事阶段 finish_reason=length 时抛错且不调用 planner_post', async () => {
    const request = makeRequest();
    await withFetchMock(
      phaseHandler({ story: () => storyStream({ finishReason: 'length' }) }),
      async (mock) => {
        await assert.rejects(() => runTurnV2(request), /模型输出达到上限而被截断/);
        assert.equal(mock.requests.length, 2, 'planner_post 不应被调用');
        assert.deepEqual(mock.requests.map(phaseOf), ['planner_pre', 'story']);
      },
    );
  });

  it('planner_post 返回非法 JSON 时抛错（此时故事已生成）', async () => {
    const request = makeRequest();
    await withFetchMock(
      phaseHandler({ post: () => chatSSE([contentFrame('null'), DONE_FRAME]) }),
      async (mock) => {
        await assert.rejects(() => runTurnV2(request), /不是有效 JSON/);
        assert.equal(mock.requests.length, 3);
      },
    );
  });

  it('planner_post 的输出模板占位被替换为真实 revision/turn（回归：曾静默失败）', async () => {
    // makeRequest 默认 revision=4、turn=2。template 里写的是 `"baseRevision": 0`（冒号后有空格），
    // 而替换曾用字符串字面量 '"baseRevision":0' 精确匹配 → 永远替换不上 → 模型看到
    // baseRevision:0 并抄回 patch，commitTurnPatchV2 的 baseRevision 守卫会拒绝整轮提交。
    // 用非零 revision/turn 才能区分"替换成功"与"没替换"。
    const request = makeRequest();
    await withFetchMock(phaseHandler(), async (mock) => {
      await runTurnV2(request);
      const post = lastUserPromptOf(mock.requests[2]);
      // 只看"输出模板"那一段：整条 user 消息里前面的 AUTHORITATIVE_STATE 也含
      // "turn":2 这类片段，直接在全文里 includes 会假通过（第一版断言就是这样漏掉的）。
      const at = post.indexOf('"schemaVersion"');
      assert.ok(at >= 0, '应包含输出模板');
      const template = post.slice(at);
      assert.ok(template.includes('"baseRevision":4'), `模板应含真实 revision：${template.slice(0, 120)}`);
      assert.ok(template.includes('"turn":2'), `模板应含真实 turn：${template.slice(0, 120)}`);
      assert.ok(!/"baseRevision"\s*:\s*0/.test(template), '不应残留 baseRevision 0 占位');
      assert.ok(!/"turn"\s*:\s*0/.test(template), '不应残留 turn 0 占位');
      const commitId = /【TURN_ID】2:([a-z0-9_]+)/.exec(post)?.[1];
      assert.ok(commitId, 'TURN_ID 应带 commitId');
      assert.ok(template.includes(`"commitId":"${commitId}"`), 'commitId 占位应被替换为 TURN_ID 中的同一个值');
    });
  });

  it('世界书条目按 alwaysActive + 关键词命中筛选，并按优先级排序（回归：关键词门控曾完全失效）', async () => {
    const worldFacts = [
      { id: 'wf-always', name: '世界基调', keywords: [], content: '常年阴雨。', alwaysActive: true, priority: 10 },
      { id: 'wf-hit', name: '门廊线索', keywords: ['门廊'], content: '门廊下有个修表铺。', alwaysActive: false, priority: 5 },
      { id: 'wf-miss', name: '尚未发生的伏笔', keywords: ['终局'], content: '第三幕才揭示的真相。', alwaysActive: false, priority: 99 },
    ];
    const request = makeRequest({ hooks: { worldFacts } });
    await withFetchMock(phaseHandler(), async (mock) => {
      await runTurnV2(request);
      // 注意：STABLE_STORY_CONTEXT 在 planner 的第一条 user 消息里，lastUserPromptOf 取的是最后一条。
      const planner = allPromptTextOf(mock.requests[0]);
      const story = allPromptTextOf(mock.requests[1]);
      assert.ok(planner.includes('常年阴雨'), 'alwaysActive 条目必须注入');
      for (const [label, prompt] of [['planner', planner], ['story', story]] as const) {
        assert.ok(!prompt.includes('第三幕才揭示的真相'), `${label}：未命中的关键词条目不应注入（否则等于提前摊开伏笔）`);
        assert.ok(!prompt.includes('门廊下有个修表铺'), `${label}：未命中的关键词条目不应注入`);
      }
    });
  });

  it('关键词命中当前输入时，该世界书条目会被注入', async () => {
    const worldFacts = [
      { id: 'wf-hit', name: '门廊线索', keywords: ['门廊'], content: '门廊下有个修表铺。', alwaysActive: false, priority: 5 },
    ];
    const request = makeRequest({ input: '我走到门廊下面躲雨，顺便看看有没有人。', hooks: { worldFacts } });
    await withFetchMock(phaseHandler(), async (mock) => {
      await runTurnV2(request);
      assert.ok(allPromptTextOf(mock.requests[0]).includes('门廊下有个修表铺'), '命中的关键词条目应注入 planner');
      assert.ok(allPromptTextOf(mock.requests[1]).includes('门廊下有个修表铺'), '命中的关键词条目应注入 story');
    });
  });

  it('世界书命中条目按 priority 降序排列；超过上限时只保留前 20 条', async () => {
    const worldFacts = Array.from({ length: 25 }, (_, index) => ({
      id: `wf-${index}`,
      name: `设定${index}`,
      keywords: [],
      content: `设定正文${index}`,
      alwaysActive: true,
      priority: index,
    }));
    const request = makeRequest({ hooks: { worldFacts } });
    await withFetchMock(phaseHandler(), async (mock) => {
      await runTurnV2(request);
      const planner = allPromptTextOf(mock.requests[0]);
      const start = planner.indexOf('【STABLE_STORY_CONTEXT】');
      const context = planner.slice(start, start + 6000);
      // priority 最大的 5 条（20..24）应进入，priority 最小的 5 条（0..4）应被截断
      assert.ok(context.includes('设定正文24'), '最高优先级条目应注入');
      assert.ok(!context.includes('设定正文0'), '最低优先级条目应被上限截断');
      const kept = context.match(/设定正文(\d+)/g) ?? [];
      assert.equal(new Set(kept).size, 20, `应恰好保留 20 条，实际 ${new Set(kept).size}`);
    });
  });

  it('author / adventure 模式的 planner_post 提示词不同', async () => {
    const authorRequest = makeRequest({ state: { mode: 'author' } });
    await withFetchMock(phaseHandler(), async (mock) => {
      await runTurnV2(authorRequest);
      const post = lastUserPromptOf(mock.requests[2]);
      assert.ok(post.includes('author模式：actions必须为空数组。'), '作者模式应要求空 actions');
      assert.ok(!post.includes('生成2到4个actions'));
      assert.ok(post.includes(`【TURN_ID】2:`), 'TURN_ID 应带回合号');
      assert.ok(post.includes('【CURRENT_STORY】' + STORY_TEXT));
    });

    const adventureRequest = makeRequest({ state: { mode: 'adventure' } });
    await withFetchMock(phaseHandler(), async (mock) => {
      const result = await runTurnV2(adventureRequest);
      const post = lastUserPromptOf(mock.requests[2]);
      assert.ok(post.includes('adventure模式：生成2到4个actions。'));
      assert.ok(!post.includes('actions必须为空数组'));
      assert.deepEqual(result.state.availableActions.map((a) => a.label), ['追问地名']);
    });
  });

  it('plannerToolsEnabled 时只有 planner_pre 带 tools，故事与结算阶段不带', async () => {
    const request = makeRequest({ settings: { plannerToolsEnabled: true, plannerToolMaxCalls: 3 } });
    await withFetchMock(phaseHandler(), async (mock) => {
      await runTurnV2(request);
      const pre = mock.requests[0];
      assert.equal(pre.url, 'https://api.test.invalid/v1/chat/completions');
      assert.equal(Array.isArray(pre.body.tools), true, '应带 tools');
      assert.equal(pre.body.tools[0].function.name, 'search_story_context');
      assert.equal(pre.body.tool_choice, 'auto');
      assert.ok(systemPromptOf(pre).includes('上下文查询工具纪律'));
      // 故事与结算阶段不应带工具
      assert.equal(mock.requests[1].body.tools, undefined);
      assert.equal(mock.requests[2].body.tools, undefined);
      assert.ok(!lastUserPromptOf(mock.requests[2]).includes('search_story_context'));
    });
  });

  it('director 视角只在 author 模式注入导演语，player 视角不注入', async () => {
    const director = makeRequest({ state: { mode: 'author' }, settings: { inputPerspective: 'director' } });
    await withFetchMock(phaseHandler(), async (mock) => {
      await runTurnV2(director);
      assert.ok(systemPromptOf(mock.requests[0]).includes('100%信任'), 'planner_pre 应含导演视角');
      assert.ok(systemPromptOf(mock.requests[1]).includes('100%信任'), 'story 应含导演视角');
      assert.ok(systemPromptOf(mock.requests[2]).includes('玩家输入为导演指令'));
    });

    const player = makeRequest({ state: { mode: 'author' }, settings: { inputPerspective: 'player' } });
    await withFetchMock(phaseHandler(), async (mock) => {
      await runTurnV2(player);
      for (const call of mock.requests) {
        assert.ok(!systemPromptOf(call).includes('100%信任'), '玩家视角不应含导演语');
      }
      assert.ok(systemPromptOf(mock.requests[0]).includes('玩家也是共同作者'));
    });

    const adventureDirector = makeRequest({
      state: { mode: 'adventure' },
      settings: { inputPerspective: 'director' },
    });
    await withFetchMock(phaseHandler(), async (mock) => {
      await runTurnV2(adventureDirector);
      assert.ok(!systemPromptOf(mock.requests[0]).includes('100%信任'), '游历模式不启用导演视角');
    });
  });

  it('planner 高优先级注入只在该存档第一次规划时生效一次', async () => {
    const settings: Partial<AppSettings> = {
      roleInjects: {
        planner: { enabled: true, text: '【注入】记住玩家的承诺。' },
        story: { enabled: false, text: '' },
        post: { enabled: false, text: '' },
      },
    };
    const first = makeRequest({ settings });
    await withFetchMock(phaseHandler(), async (mock) => {
      const result = await runTurnV2(first);
      assert.ok(systemPromptOf(mock.requests[0]).startsWith('【注入】记住玩家的承诺。'));
      assert.equal(result.state.plannerInjectApplied, true);
      assert.equal(systemPromptOf(mock.requests[1]).includes('【注入】'), false, '故事阶段不应收到规划注入');
    });

    const second = makeRequest({ settings, state: { plannerInjectApplied: true } });
    await withFetchMock(phaseHandler(), async (mock) => {
      await runTurnV2(second);
      assert.equal(systemPromptOf(mock.requests[0]).includes('【注入】'), false, '已注入过不应重复注入');
    });
  });

  it('brief.randomEvent.planned 为 true 时写入 lastPlan 并传给故事阶段', async () => {
    const planned = { ...BRIEF, randomEvent: { planned: true, summary: '暴雨迫使两人躲进旧书店' } };
    const request = makeRequest();
    await withFetchMock(
      phaseHandler({ brief: () => jsonStream(planned) }),
      async (mock) => {
        const result = await runTurnV2(request);
        assert.equal(result.state.randomEvent.lastPlan, '暴雨迫使两人躲进旧书店');
        assert.ok(lastUserPromptOf(mock.requests[1]).includes('【RANDOM_EVENT_PLAN】暴雨迫使两人躲进旧书店'));
      },
    );
  });

  it('randomEvent.planned 为 true 但没有摘要时使用兜底文案', async () => {
    const planned = { ...BRIEF, randomEvent: { planned: true, summary: '  ' } };
    const request = makeRequest();
    await withFetchMock(phaseHandler({ brief: () => jsonStream(planned) }), async () => {
      const result = await runTurnV2(request);
      assert.equal(result.state.randomEvent.lastPlan, '规划模型已安排一个随机事件，但未提供文字摘要。');
    });
  });

  it('思考通道承载 JSON 的规划模型也能完成回合（thinkingFallback）', async () => {
    const request = makeRequest();
    await withFetchMock(
      phaseHandler({
        brief: () => chatSSE([reasoningFrame(JSON.stringify(BRIEF)), DONE_FRAME]),
        post: () => chatSSE([reasoningFrame(JSON.stringify(POST_PATCH)), DONE_FRAME]),
      }),
      async () => {
        const result = await runTurnV2(request);
        assert.equal(result.state.turn, 3);
        // 被恢复为正文的 JSON 仍然作为“思考增量”进入本回合思维链（同一内容出现两次）。
        assert.ok(
          result.state.history[2].thinking?.includes('"intent":"试探"'),
          `实际：${result.state.history[2].thinking}`,
        );
      },
    );
  });

  it('缺少 API Key 时在第一次请求前就报错', async () => {
    const request = makeRequest({ settings: { apiKey: '' } });
    await withFetchMock(phaseHandler(), async (mock) => {
      await assert.rejects(() => runTurnV2(request), /未配置 API Key/);
      assert.equal(mock.requests.length, 0);
    });
  });
});

describe('engine.runTurnV2 — 规划上下文工具循环', () => {
  const toolCallResponse = (calls: unknown[]) => chatSSE([toolCallFrame(calls), DONE_FRAME]);

  it('模型请求 search_story_context 后：工具结果注入下一轮、回合照常提交', async () => {
    const activity: ModelActivityV2[] = [];
    const request = makeRequest({
      settings: { plannerToolsEnabled: true, plannerToolMaxCalls: 2 },
      hooks: { onModelActivity: (item) => activity.push(item) },
    });

    const result = await withFetchMock((recorded) => {
      const system = systemPromptOf(recorded);
      if (system.includes('写前规划 Agent')) {
        const hasToolResult = (recorded.body.messages ?? []).some((m: any) => m.role === 'tool');
        return hasToolResult
          ? jsonStream(BRIEF)
          : toolCallResponse([{
            index: 0,
            id: 'call_1',
            type: 'function',
            function: { name: 'search_story_context', arguments: JSON.stringify({ query: '阿黎', scope: 'characters', limit: 3 }) },
          }]);
      }
      if (system.includes('写后审计')) return jsonStream(POST_PATCH);
      return storyStream();
    }, async (mock) => {
      const output = await runTurnV2(request);
      assert.deepEqual(mock.requests.map(phaseOf), ['planner_pre', 'planner_pre', 'story', 'planner_post']);
      const second = mock.requests[1];
      const toolMessage = (second.body.messages ?? []).find((m: any) => m.role === 'tool');
      assert.ok(toolMessage, '第二轮规划请求应带 tool 结果消息');
      assert.equal(toolMessage.tool_call_id, 'call_1');
      assert.equal(toolMessage.name, 'search_story_context');
      const evidence = JSON.parse(toolMessage.content);
      assert.equal(evidence.query, '阿黎');
      assert.equal(evidence.scope, 'characters');
      assert.equal(evidence.resultCount, 1);
      assert.equal(evidence.results[0].source, 'characters');
      assert.equal(evidence.results[0].id, 'char-a');
      assert.equal(evidence.results[0].label, '人物：阿黎');
      assert.ok(evidence.results[0].evidence.includes('住在城南'));
      assert.ok(evidence.note.includes('既有故事证据'));
      return output;
    });

    assert.equal(result.state.turn, request.state.turn + 1);
    assert.deepEqual(result.state.turnRecords?.[0].calls.map((call) => call.phase), ['planner_pre', 'story', 'planner_post']);

    const toolEvents = activity.filter((item) => item.type === 'tool') as Array<Extract<ModelActivityV2, { type: 'tool' }>>;
    assert.deepEqual(toolEvents.map((item) => item.status), ['call', 'result']);
    assert.equal(toolEvents[0].toolName, 'search_story_context');
    assert.equal(toolEvents[0].argumentsText, '{"query":"阿黎","scope":"characters","limit":3}');
    assert.ok((toolEvents[1].resultText ?? '').includes('人物：阿黎'));
    assert.equal((toolEvents[0] as any).phase, 'planner_pre');
  });

  it('工具名为未知工具、超出调用上限、连续请求工具都会产生可观察结果', async () => {
    const activity: ModelActivityV2[] = [];
    const request = makeRequest({
      settings: { plannerToolsEnabled: true, plannerToolMaxCalls: 2 },
      hooks: { onModelActivity: (item) => activity.push(item) },
    });

    await withFetchMock((recorded) => {
      const system = systemPromptOf(recorded);
      if (system.includes('写前规划 Agent')) {
        return toolCallResponse([
          { index: 0, id: 'call_a', type: 'function', function: { name: 'search_story_context', arguments: '{"query":"阿黎"}' } },
          { index: 1, id: 'call_b', type: 'function', function: { name: 'unknown_tool', arguments: '{}' } },
        ]);
      }
      throw new Error('故事阶段不应被调用');
    }, async (mock) => {
      await assert.rejects(() => runTurnV2(request), /连续请求工具超过上限（2 轮）/);
      assert.ok(mock.requests.length >= 3);
      assert.ok(mock.requests.every((call) => phaseOf(call) === 'planner_pre'), '不应进入故事阶段');
      // 第二轮请求里应包含两条 tool 结果
      const toolMessages = (mock.requests[1].body.messages ?? []).filter((m: any) => m.role === 'tool');
      assert.equal(toolMessages.length, 2);
      assert.equal(toolMessages[0].tool_call_id, 'call_a');
      assert.equal(toolMessages[1].tool_call_id, 'call_b');
    });

    const results = (activity.filter((item) => item.type === 'tool' && item.status === 'result') as Array<Extract<ModelActivityV2, { type: 'tool' }>>)
      .map((item) => item.resultText ?? '');
    assert.ok(results.some((text) => text.includes('人物：阿黎')), '第一次检索应返回证据');
    assert.ok(results.some((text) => text.includes('未知工具：unknown_tool')), '未知工具应返回错误而不是抛错');
    assert.ok(results.some((text) => text.includes('已达到玩家设置的上限')), '超出调用上限应返回提示');
  });
});
