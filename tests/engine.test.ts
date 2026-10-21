import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeDestinyPatch, runTurnSettlementV2, runTurnV2, TurnPostFailureV2 } from '@/v2/engine';
import { PACE_LENGTH_LIMIT } from '@/v2/paceGuard';
import type { AppSettings } from '@/types/settings';
import type { GameStateV2, ModelActivityV2, ModelPhaseV2, ModelPhaseStatusV2, TurnPartialV2, TurnRequestV2 } from '@/v2/types';
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

const STORY_TEXT = '雨夜的街口很安静。阿黎压低声音，说出了一个地名。路灯在积水里碎成几片摇晃的光，远处有卷帘门落下的响动。她把伞往我这边偏了偏，又补了一句：今晚别走正街，巷口的修车铺亮着灯，那地方最近不太平。我记下那个地名，跟她约好天亮前在旧码头碰面。她收拢伞骨，先往巷口那盏忽明忽暗的路灯下走。';

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

/** 取【STABLE_STORY_CONTEXT】那条 user 消息：缓存保证要求它逐字节稳定。 */
function stableContextOf(request: RecordedRequest): string {
  const messages = request.body?.messages;
  if (!Array.isArray(messages)) return '';
  const found = messages.find((m: any) => m?.role === 'user' && String(m?.content ?? '').includes('【STABLE_STORY_CONTEXT】'));
  return String(found?.content ?? '');
}

/** 解析可变区里的动态世界书行（`【DYNAMIC_WORLD_FACTS】[...]`）。 */
function dynamicWorldFactsOf(request: RecordedRequest): Array<{ id: string }> {
  const match = /【DYNAMIC_WORLD_FACTS】([^\n]*)/.exec(allPromptTextOf(request));
  if (!match) return [];
  try {
    const parsed = JSON.parse(match[1]);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** 截取【STAGE_AND_ACT_WINDOW】块（到动态世界书行为止）。 */
function windowTextOf(request: RecordedRequest): string {
  const prompt = lastUserPromptOf(request);
  const start = prompt.indexOf('【STAGE_AND_ACT_WINDOW】');
  if (start < 0) return '';
  const end = prompt.indexOf('【DYNAMIC_WORLD_FACTS】', start);
  return end > start ? prompt.slice(start, end) : prompt.slice(start);
}

const phaseOf = (request: RecordedRequest): ModelPhaseV2 => {
  const system = systemPromptOf(request);
  if (system.includes('写前规划 Agent')) return 'planner_pre';
  if (system.includes('写后审计')) return 'planner_post';
  return 'story';
};

/** 逐字节公共前缀长度：供应商的前缀缓存只认"从头开始完全相同"的部分。 */
function commonPrefixLength(a: string, b: string): number {
  const n = Math.min(a.length, b.length);
  let i = 0;
  while (i < n && a[i] === b[i]) i += 1;
  return i;
}

/** 把一条请求的消息按顺序拼成候选前缀（system 在前，与发送顺序一致）。 */
function messagePrefixOf(request: RecordedRequest): string {
  const messages = request.body?.messages;
  if (!Array.isArray(messages)) return '';
  return messages.map((m: any) => `${m?.role}\u0000${String(m?.content ?? '')}`).join('\u0001');
}

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

  it('planner_pre 返回非法 JSON 时自动修复重试一次；两次都失败才抛错且不调用故事阶段', async () => {
    const request = makeRequest();
    await withFetchMock(
      phaseHandler({ brief: () => chatSSE([contentFrame('这不是 JSON'), DONE_FRAME]) }),
      async (mock) => {
        await assert.rejects(() => runTurnV2(request), /不是有效 JSON/);
        assert.equal(mock.requests.length, 2, '应重试一次规划，且故事阶段不应被调用');
        assert.deepEqual(mock.requests.map(phaseOf), ['planner_pre', 'planner_pre']);
      },
    );
  });

  it('planner_pre 首次非法 JSON、修复重试返回合法 JSON 时正常继续', async () => {
    let preCount = 0;
    await withFetchMock(
      phaseHandler({
        brief: () => (++preCount === 1
          ? chatSSE([contentFrame('这不是 JSON'), DONE_FRAME])
          : jsonStream(BRIEF)),
      }),
      async (mock) => {
        const result = await runTurnV2(makeRequest());
        assert.equal(result.state.turn, 3);
        assert.deepEqual(mock.requests.map(phaseOf), ['planner_pre', 'planner_pre', 'story', 'planner_post']);
        assert.ok(lastUserPromptOf(mock.requests[1]).includes('不是合法 JSON'), '修复重试应附带修复指令');
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

  it('planner_post 返回非法 JSON 时自动修复重试一次；两次都失败才抛错', async () => {
    const request = makeRequest();
    await withFetchMock(
      phaseHandler({ post: () => chatSSE([contentFrame('null'), DONE_FRAME]) }),
      async (mock) => {
        await assert.rejects(() => runTurnV2(request), /不是有效 JSON/);
        assert.equal(mock.requests.length, 4, '应为 3 阶段 + 1 次结算修复重试');
        assert.deepEqual(mock.requests.map(phaseOf), ['planner_pre', 'story', 'planner_post', 'planner_post']);
      },
    );
  });

  it('planner_post 首次非法 JSON、修复重试返回合法 JSON 时成功提交', async () => {
    let postCount = 0;
    await withFetchMock(
      phaseHandler({
        post: () => (++postCount === 1
          ? chatSSE([contentFrame('null'), DONE_FRAME])
          : jsonStream(POST_PATCH)),
      }),
      async (mock) => {
        const result = await runTurnV2(makeRequest());
        assert.equal(result.state.turn, 3);
        assert.deepEqual(mock.requests.map(phaseOf), ['planner_pre', 'story', 'planner_post', 'planner_post']);
        assert.ok(lastUserPromptOf(mock.requests[3]).includes('不是合法 JSON'), '修复重试应附带修复指令');
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
      const template = post.slice(at, post.indexOf('【TURN_ID】'));
      // 回归：commitId / baseRevision / turn 都曾内嵌在模板里，而它们每回合都不同，
      // 导致整段（约 2KB）模板永远无法逐字节复用、前缀缓存失效。现在模板里不得出现
      // 它们；具体值只出现在可变区的 TURN_ID/baseRevision/turn 行，
      // 提交时 asPatch 用程序自己的值覆盖模型回显。
      assert.ok(!template.includes('"commitId"'), '固定模板里不应出现每回合变化的 commitId');
      assert.ok(!template.includes('"baseRevision"'), '固定模板里不应出现每回合递增的 baseRevision');
      assert.ok(!template.includes('"turn"'), '固定模板里不应出现每回合递增的 turn');
      assert.ok(!template.includes('COMMIT_ID'), '模板不应残留 COMMIT_ID 占位符');
      // 但可变区必须把真实值给模型，否则它只能猜。
      assert.ok(post.includes('【baseRevision】4'), '可变区应给出真实 baseRevision');
      assert.ok(post.includes('【turn】2'), '可变区应给出真实 turn');
      const commitId = /【TURN_ID】2:([a-z0-9_]+)/.exec(post)?.[1];
      assert.ok(commitId, 'TURN_ID 应带 commitId');
    });
  });

  it('世界书按稳定/动态拆分：常驻进稳定块，命中进动态块，未命中不注入（回归：关键词门控曾完全失效）', async () => {
    const worldFacts = [
      { id: 'wf-always', name: '世界基调', keywords: [], content: '常年阴雨。', alwaysActive: true, priority: 10 },
      { id: 'wf-hit', name: '门廊线索', keywords: ['门廊'], content: '门廊下有个修表铺。', alwaysActive: false, priority: 5 },
      { id: 'wf-miss', name: '尚未发生的伏笔', keywords: ['终局'], content: '第三幕才揭示的真相。', alwaysActive: false, priority: 99 },
    ];
    const request = makeRequest({ hooks: { worldFacts } });
    await withFetchMock(phaseHandler(), async (mock) => {
      await runTurnV2(request);
      for (const [label, call] of [['planner_pre', mock.requests[0]], ['story', mock.requests[1]]] as const) {
        const stable = stableContextOf(call);
        assert.ok(stable.includes('常年阴雨'), `${label}：常驻条目必须进稳定块`);
        assert.ok(!stable.includes('门廊下有个修表铺'), `${label}：未命中的关键词条目不得进稳定块`);
        assert.ok(dynamicWorldFactsOf(call).length === 0, `${label}：本回合没有命中时动态块应为空数组`);
        assert.ok(!allPromptTextOf(call).includes('第三幕才揭示的真相'), `${label}：未命中的伏笔不应注入（否则等于提前摊开）`);
        assert.ok(!allPromptTextOf(call).includes('门廊下有个修表铺'), `${label}：未命中的关键词条目不应注入`);
      }
    });
  });

  it('关键词命中当前输入时只进可变区动态块，稳定块保持逐字节不变', async () => {
    const worldFacts = [
      { id: 'wf-always', name: '世界基调', keywords: ['雨'], content: '常年阴雨。', alwaysActive: true, priority: 10 },
      { id: 'wf-hit', name: '门廊线索', keywords: ['门廊'], content: '门廊下有个修表铺。', alwaysActive: false, priority: 5 },
    ];
    const request = makeRequest({ input: '我走到门廊下面躲雨，顺便看看有没有人。', hooks: { worldFacts } });
    await withFetchMock(phaseHandler(), async (mock) => {
      await runTurnV2(request);
      for (const [label, call] of [['planner_pre', mock.requests[0]], ['story', mock.requests[1]]] as const) {
        const stable = stableContextOf(call);
        assert.ok(stable.includes('常年阴雨'), `${label}：常驻条目在稳定块`);
        assert.ok(!stable.includes('门廊下有个修表铺'), `${label}：命中的动态条目不得进稳定块（否则稳定块随输入变化，前缀缓存失效）`);
        assert.deepEqual(dynamicWorldFactsOf(call).map((fact) => fact.id), ['wf-hit'], `${label}：命中条目必须进动态块`);
        assert.ok(allPromptTextOf(call).includes('门廊下有个修表铺'), `${label}：命中条目应注入`);
      }
    });
  });

  it('常驻世界书超过上限时只保留优先级最高的 20 条，并发出分别说明常驻/动态数量的警告', async () => {
    const worldFacts = Array.from({ length: 25 }, (_, index) => ({
      id: `wf-${index}`,
      name: `设定${index}`,
      keywords: [],
      content: `设定正文${index}`,
      alwaysActive: true,
      priority: index,
    }));
    const activity: ModelActivityV2[] = [];
    const request = makeRequest({ hooks: { worldFacts, onModelActivity: (item) => activity.push(item) } });
    await withFetchMock(phaseHandler(), async (mock) => {
      await runTurnV2(request);
      const context = stableContextOf(mock.requests[0]);
      // priority 最大的 20 条（5..24）应进入，priority 最小的 5 条（0..4）应被截断
      assert.ok(context.includes('设定正文24'), '最高优先级条目应注入');
      assert.ok(!context.includes('设定正文0'), '最低优先级条目应被上限截断');
      const kept = context.match(/设定正文(\d+)/g) ?? [];
      assert.equal(new Set(kept).size, 20, `应恰好保留 20 条，实际 ${new Set(kept).size}`);
      assert.ok(!context.includes('【STAGE_AND_ACT_WINDOW】'), '窗口属于可变区，不得进稳定块');
      assert.deepEqual(dynamicWorldFactsOf(mock.requests[0]), [], '常驻条目不得重复进动态块');
      const warning = activity.find((item) => item.type === 'warning' && (item as any).code === 'world_facts_truncated');
      assert.ok(warning, '截断时必须发出可观察警告');
      const message = (warning as Extract<ModelActivityV2, { type: 'warning' }>).message;
      assert.ok(message.includes('常驻已注入 20 条') && message.includes('上限 20'), `警告应说明常驻数量与上限：${message}`);
      assert.ok(message.includes('上限 10'), `警告应同时说明动态数量与上限：${message}`);
      assert.ok(message.includes('共 25 条'), `警告应给出总数：${message}`);
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

  it('中文单字关键词不会被丢弃（回归：曾因长度<2 而检索不到）', async () => {
    const request = makeRequest({
      settings: { plannerToolsEnabled: true, plannerToolMaxCalls: 1 },
      hooks: {
        // 单字人名出现在较早的正文里；用 makeState 保留其余夹具字段，只换 history。
        state: makeState({
          history: [{ id: 'msg-old', role: 'assistant', content: '晴把那封信折好，放进口袋。', turn: 1, createdAt: 1 }],
        }),
      },
    });

    await withFetchMock((recorded) => {
      const system = systemPromptOf(recorded);
      if (system.includes('写前规划 Agent')) {
        if ((recorded.body.messages ?? []).some((m: any) => m.role === 'tool')) {
          return jsonStream({ intent: 'done' });
        }
        return toolCallResponse([
          { index: 0, id: 'call_cjk', type: 'function', function: { name: 'search_story_context', arguments: '{"query":"晴 在哪里"}' } },
        ]);
      }
      if (system.includes('只写中文小说正文')) return storyStream();
      return jsonStream(POST_PATCH);
    }, async (mock) => {
      await runTurnV2(request);
      const toolMessages = (mock.requests[1].body.messages ?? []).filter((m: any) => m.role === 'tool');
      assert.equal(toolMessages.length, 1);
      const payload = JSON.parse(String(toolMessages[0].content));
      assert.ok(payload.resultCount > 0, `「晴 在哪里」应能检索到单字人名的证据，实际 ${payload.resultCount} 条`);
    });
  });

  it('长正文的证据按命中位置切片，返回内容必须包含查询词（回归：曾只截前 900 字）', async () => {
    // 关键词位于 1200 字之后：只截前 900 字时返回的证据不含查询词，模型会误判为查不到。
    const filler = '雨声持续，街灯在水洼里碎成几片。'.repeat(110);
    const longText = `${filler}晴终于说出了那个地名。`;
    const request = makeRequest({
      settings: { plannerToolsEnabled: true, plannerToolMaxCalls: 1 },
      hooks: {
        state: makeState({
          history: [{ id: 'msg-long', role: 'assistant', content: longText, turn: 1, createdAt: 1 }],
        }),
      },
    });

    await withFetchMock((recorded) => {
      const system = systemPromptOf(recorded);
      if (system.includes('写前规划 Agent')) {
        if ((recorded.body.messages ?? []).some((m: any) => m.role === 'tool')) return jsonStream({ intent: 'done' });
        return toolCallResponse([
          { index: 0, id: 'call_long', type: 'function', function: { name: 'search_story_context', arguments: '{"query":"晴 地名"}' } },
        ]);
      }
      if (system.includes('只写中文小说正文')) return storyStream();
      return jsonStream(POST_PATCH);
    }, async (mock) => {
      await runTurnV2(request);
      const toolMessages = (mock.requests[1].body.messages ?? []).filter((m: any) => m.role === 'tool');
      const payload = JSON.parse(String(toolMessages[0].content));
      assert.ok(payload.resultCount > 0, '应检索到该条正文');
      const evidence = payload.results.map((r: any) => r.evidence).join('\n');
      assert.ok(evidence.includes('晴'), `返回证据应包含查询词，实际片段：${evidence.slice(0, 80)}`);
      assert.ok(evidence.includes('地名'), '返回证据应包含查询词的另一部分');
    });
  });

  it('工具返回保持兼容字段，并新增 matchedTerms/score（整串命中优先于散词）', async () => {
    const request = makeRequest({
      settings: { plannerToolsEnabled: true, plannerToolMaxCalls: 1 },
      hooks: {
        state: makeState({
          history: [
            { id: 'msg-book', role: 'assistant', content: '旧书店的老板把门锁上了。', turn: 2, createdAt: 2 },
            { id: 'msg-stall', role: 'assistant', content: '旧书摊的棚布往下淌。', turn: 3, createdAt: 3 },
          ],
        }),
      },
    });

    await withFetchMock((recorded) => {
      const system = systemPromptOf(recorded);
      if (system.includes('写前规划 Agent')) {
        if ((recorded.body.messages ?? []).some((m: any) => m.role === 'tool')) return jsonStream({ intent: 'done' });
        return toolCallResponse([
          { index: 0, id: 'call_rank', type: 'function', function: { name: 'search_story_context', arguments: '{"query":"旧书店","scope":"history","limit":5}' } },
        ]);
      }
      if (system.includes('只写中文小说正文')) return storyStream();
      return jsonStream(POST_PATCH);
    }, async (mock) => {
      await runTurnV2(request);
      const toolMessage = (mock.requests[1].body.messages ?? []).find((m: any) => m.role === 'tool');
      const payload = JSON.parse(String(toolMessage.content));
      // 顶层字段向后兼容
      assert.equal(payload.query, '旧书店');
      assert.equal(payload.scope, 'history');
      assert.equal(payload.resultCount, 2);
      assert.ok(payload.note.includes('既有故事证据'));
      // 单条结果保留旧字段，并新增命中词/评分
      assert.equal(payload.results[0].source, 'history');
      assert.equal(payload.results[0].id, 'msg-book', '整串命中的正文应排第一');
      assert.equal(typeof payload.results[0].label, 'string');
      assert.equal(typeof payload.results[0].evidence, 'string');
      assert.ok(payload.results[0].matchedTerms.includes('旧书店'), `实际命中词：${JSON.stringify(payload.results[0].matchedTerms)}`);
      assert.equal(typeof payload.results[0].score, 'number');
      assert.ok(payload.results[0].score > payload.results[1].score, '整串命中分数应更高');
    });
  });

  it('检索结果同来源最多 2 条（避免全部来自同一段长文）', async () => {
    const request = makeRequest({
      settings: { plannerToolsEnabled: true, plannerToolMaxCalls: 1 },
      hooks: {
        state: makeState({
          history: [1, 2, 3, 4].map((index) => ({
            id: `msg-rain-${index}`,
            role: 'assistant',
            content: `第${index}次写到雨。`,
            turn: index,
            createdAt: index,
          })),
        }),
      },
    });

    await withFetchMock((recorded) => {
      const system = systemPromptOf(recorded);
      if (system.includes('写前规划 Agent')) {
        if ((recorded.body.messages ?? []).some((m: any) => m.role === 'tool')) return jsonStream({ intent: 'done' });
        return toolCallResponse([
          { index: 0, id: 'call_cap', type: 'function', function: { name: 'search_story_context', arguments: '{"query":"雨","limit":8}' } },
        ]);
      }
      if (system.includes('只写中文小说正文')) return storyStream();
      return jsonStream(POST_PATCH);
    }, async (mock) => {
      await runTurnV2(request);
      const toolMessage = (mock.requests[1].body.messages ?? []).find((m: any) => m.role === 'tool');
      const payload = JSON.parse(String(toolMessage.content));
      assert.equal(payload.resultCount, 2, '四条 history 命中应被同来源上限压到 2 条');
      assert.ok(payload.results.every((item: any) => item.source === 'history'));
      assert.notEqual(payload.results[0].id, payload.results[1].id, '返回结果不应重复');
    });
  });

  it('查不到证据时返回可操作的 0 结果提示（而不是空响应）', async () => {
    const request = makeRequest({ settings: { plannerToolsEnabled: true, plannerToolMaxCalls: 1 } });
    await withFetchMock((recorded) => {
      const system = systemPromptOf(recorded);
      if (system.includes('写前规划 Agent')) {
        if ((recorded.body.messages ?? []).some((m: any) => m.role === 'tool')) return jsonStream({ intent: 'done' });
        return toolCallResponse([
          { index: 0, id: 'call_empty', type: 'function', function: { name: 'search_story_context', arguments: '{"query":"不存在的人"}' } },
        ]);
      }
      if (system.includes('只写中文小说正文')) return storyStream();
      return jsonStream(POST_PATCH);
    }, async (mock) => {
      await runTurnV2(request);
      const toolMessage = (mock.requests[1].body.messages ?? []).find((m: any) => m.role === 'tool');
      const payload = JSON.parse(String(toolMessage.content));
      assert.equal(payload.resultCount, 0);
      assert.deepEqual(payload.results, []);
      assert.ok(payload.note.includes('更短'), '0 结果提示应建议更短的关键词');
      assert.ok(payload.note.includes('scope'), '0 结果提示应建议改用 scope');
      assert.ok(payload.note.includes('不要据此编造历史'));
    });
  });
});

// ---------------------------------------------------------------------------
// E. 前缀缓存结构：固定指令与模板必须占据最长的可复用前缀
// ---------------------------------------------------------------------------

describe('engine.runTurnV2 — 思考强度与思考成本', () => {
  // 思考参数只对官方 DeepSeek 端点发送（第三方兼容端点常不认识这些字段）。
  const official = { apiBaseUrl: 'https://api.deepseek.com/v1' };

  it('按模型解析思考强度：每个模型带自己的档位（回归：原先只有全局一档）', async () => {
    const requests: RecordedRequest[] = [];
    await withFetchMock(phaseHandler(), async (mock) => {
      await runTurnV2(makeRequest({
        settings: {
          ...official,
          thinkingMode: 'enabled',
          reasoningEffort: 'high',
          storyModel: 'story-model-x',
          plannerModel: 'planner-model-y',
          reasoningEffortByModel: { 'story-model-x': 'low', 'planner-model-y': 'max' },
        },
      }));
      requests.push(...mock.requests);
    });
    const effortOf = (phase: ModelPhaseV2) => (requests.find((r) => phaseOf(r) === phase)?.body as { reasoning_effort?: string })?.reasoning_effort;
    assert.equal(effortOf('story'), 'low', '故事模型应带自己的 low 档');
    assert.equal(effortOf('planner_pre'), 'max', '规划模型应带自己的 max 档');
    assert.equal(effortOf('planner_post'), 'max', '结算与写前共用规划模型，档位一致');
  });

  it('未列出的模型走全局档位', async () => {
    const requests: RecordedRequest[] = [];
    await withFetchMock(phaseHandler(), async (mock) => {
      await runTurnV2(makeRequest({ settings: { ...official, thinkingMode: 'enabled', reasoningEffort: 'low', reasoningEffortByModel: { 'some-other-model': 'max' } } }));
      requests.push(...mock.requests);
    });
    for (const request of requests) {
      assert.equal((request.body as { reasoning_effort?: string })?.reasoning_effort, 'low');
    }
  });

  it('逐阶段覆盖优先于按模型覆盖', async () => {
    const requests: RecordedRequest[] = [];
    await withFetchMock(phaseHandler(), async (mock) => {
      await runTurnV2(makeRequest({
        settings: {
          ...official,
          thinkingMode: 'enabled',
          reasoningEffort: 'high',
          plannerModel: 'planner-model-y',
          reasoningEffortByModel: { 'planner-model-y': 'max' },
          reasoningEffortByPhase: { planner_post: 'low' },
        },
      }));
      requests.push(...mock.requests);
    });
    const effortOf = (phase: ModelPhaseV2) => (requests.find((r) => phaseOf(r) === phase)?.body as { reasoning_effort?: string })?.reasoning_effort;
    assert.equal(effortOf('planner_post'), 'low', '逐阶段覆盖优先');
    assert.equal(effortOf('planner_pre'), 'max', '未覆盖的阶段仍按模型解析');
  });

  it('thinkingMode 为 disabled 时显式关闭思考，且不发送思考强度', async () => {
    const requests: RecordedRequest[] = [];
    await withFetchMock(phaseHandler(), async (mock) => {
      await runTurnV2(makeRequest({ settings: { ...official, thinkingMode: 'disabled' } }));
      requests.push(...mock.requests);
    });
    for (const request of requests) {
      const body = request.body as { thinking?: { type?: string }; reasoning_effort?: string };
      // 官方文档：思考模式默认开启，因此关闭必须显式发送 disabled，
      // "什么都不发"会退回默认开启。
      assert.equal(body.thinking?.type, 'disabled', '应显式发送 thinking.type=disabled');
      assert.equal(body.reasoning_effort, undefined, '关闭思考后不应发送 reasoning_effort');
    }
  });

  it('非官方端点不发送思考参数（兼容端点可能不认识这些字段）', async () => {
    const requests: RecordedRequest[] = [];
    await withFetchMock(phaseHandler(), async (mock) => {
      await runTurnV2(makeRequest({ settings: { thinkingMode: 'enabled', reasoningEffort: 'max' } }));
      requests.push(...mock.requests);
    });
    for (const request of requests) {
      assert.equal('reasoning_effort' in (request.body as object), false);
    }
  });
});
describe('engine.runTurnV2 — 前缀缓存结构', () => {
  /** 跑两回合，返回两次请求（按阶段分组）。第二回合复用第一回合的真实落盘状态。 */
  async function runTwoTurns() {
    const first: RecordedRequest[] = [];
    const second: RecordedRequest[] = [];
    const state = makeState({
      turn: 2,
      revision: 4,
      history: [
        { id: 'msg-1', role: 'user', content: '我推开门。', turn: 1, createdAt: 1 },
        { id: 'msg-2', role: 'assistant', content: '门轴发出干涩的响声。', turn: 1, createdAt: 1 },
      ],
    });
    await withFetchMock(phaseHandler(), async (mock) => {
      await runTurnV2(makeRequest({ state }));
      first.push(...mock.requests);
    });
    await withFetchMock(phaseHandler(), async (mock) => {
      await runTurnV2(makeRequest({ state, input: '我走进屋里。' }));
      second.push(...mock.requests);
    });
    return { first, second };
  }

  const byPhase = (requests: RecordedRequest[]) => {
    const map = new Map<ModelPhaseV2, RecordedRequest>();
    for (const request of requests) map.set(phaseOf(request), request);
    return map;
  };

  it('三个阶段的消息都以固定内容开头：system 与稳定上下文逐字节相同', async () => {
    const { first, second } = await runTwoTurns();
    const a = byPhase(first);
    const b = byPhase(second);
    for (const phase of ['planner_pre', 'story', 'planner_post'] as ModelPhaseV2[]) {
      const pa = a.get(phase);
      const pb = b.get(phase);
      assert.ok(pa && pb, `${phase} 两回合都应发出请求`);
      const ma = (pa.body.messages ?? []) as any[];
      const mb = (pb.body.messages ?? []) as any[];
      // system 提示词必须逐字节相同，否则整条请求从头就无法命中缓存
      assert.equal(ma[0].content, mb[0].content, `${phase} 的 system 提示词在相邻回合必须完全一致`);
      // 稳定上下文（若有）也必须一致
      if (String(ma[1]?.content ?? '').includes('【STABLE_STORY_CONTEXT】')) {
        assert.equal(ma[1].content, mb[1].content, `${phase} 的稳定上下文在相邻回合必须完全一致`);
      }
    }
  });

  it('固定输出模板位于可变材料之前（回归：模板曾被放在正文之后，永远无法命中）', async () => {
    const { first, second } = await runTwoTurns();
    const a = byPhase(first);
    const b = byPhase(second);

    // planner_pre：输出模板在 user 消息最前，权威状态与输入在其后
    const preA = String(a.get('planner_pre')!.body.messages.at(-1).content);
    assert.ok(preA.startsWith('只输出 '), 'planner_pre 的 user 消息应以固定输出模板开头');
    assert.ok(preA.indexOf('只输出 ') < preA.indexOf('【AUTHORITATIVE_STATE】'), '模板必须排在可变状态之前');

    // planner_post：模板 + 指令在最前，正文压到最后
    const postA = String(a.get('planner_post')!.body.messages.at(-1).content);
    const postB = String(b.get('planner_post')!.body.messages.at(-1).content);
    assert.ok(postA.startsWith('严格按下列结构输出'), 'planner_post 的 user 消息应以固定指令开头');
    assert.ok(postA.indexOf('"schemaVersion"') < postA.indexOf('【CURRENT_STORY】'), '模板必须排在正文之前');

    // story：写作要求在前，权威状态与玩家输入在最后
    const storyA = String(a.get('story')!.body.messages.at(-1).content);
    assert.ok(storyA.startsWith('【NARRATIVE_PACE】'), 'story 的 user 消息应以固定写作要求开头');
    assert.ok(storyA.indexOf('【STOP_BOUNDARY】') < storyA.indexOf('【AUTHORITATIVE_STATE】'));
    assert.ok(storyA.indexOf('【AUTHORITATIVE_STATE】') < storyA.indexOf('【CURRENT_TURN_INPUT】'));

    // 最关键的一条：结算请求的整段输出模板必须能逐字节复用。
    // 模板边界就是【TURN_ID】——它之后才是本回合的可变材料。
    const stableTemplate = (text: string) => text.slice(0, text.indexOf('【TURN_ID】'));
    const templateA = stableTemplate(postA);
    const templateB = stableTemplate(postB);
    assert.ok(templateA.length > 1500, `可复用的固定模板段应有实际体量，实际 ${templateA.length} 字符`);
    assert.equal(templateA, templateB, '整段固定模板在相邻回合必须逐字节相同');
    // 模板里不得出现任何每回合递增或随机的值，否则它整段失效。
    for (const marker of ['"turn"', '"baseRevision"', '"commitId"']) {
      assert.ok(!templateA.includes(marker), `固定模板里不应出现 ${marker}`);
    }
  });

  it('可变材料确实改变了前缀，但只发生在固定模板之后', async () => {
    const { first, second } = await runTwoTurns();
    const a = byPhase(first);
    const b = byPhase(second);
    for (const phase of ['planner_pre', 'story', 'planner_post'] as ModelPhaseV2[]) {
      const prefixA = messagePrefixOf(a.get(phase)!);
      const prefixB = messagePrefixOf(b.get(phase)!);
      const shared = commonPrefixLength(prefixA, prefixB);
      const total = Math.min(prefixA.length, prefixB.length);
      assert.ok(shared > 0, `${phase} 两回合应有公共前缀`);
      // 相邻回合之间至少 system 提示词要能整段复用
      assert.ok(
        shared >= String((a.get(phase)!.body.messages ?? [])[0]?.content ?? '').length,
        `${phase} 的公共前缀应至少覆盖 system 提示词（实际 ${shared} 字符）`,
      );
      // 且不应整段相同——否则说明这轮根本没变化，测试失去意义
      assert.notEqual(prefixA, prefixB, `${phase} 两回合的提示词应存在差异`);
      assert.ok(total > shared, `${phase} 应存在差异部分`);
    }
  });
});

// ---------------------------------------------------------------------------
// F. 回合续跑：planner_post 失败后仅重试结算
// ---------------------------------------------------------------------------

describe('engine.runTurnV2 / runTurnSettlementV2 — 结算失败续跑', () => {
  /** 结算阶段的 HTTP 500：模拟网络/限流类失败。 */
  const httpFailure = (status = 500) => new Response(
    JSON.stringify({ error: { message: '结算服务暂时不可用' } }),
    { status, headers: { 'content-type': 'application/json' } },
  );
  const invalidJson = () => chatSSE([contentFrame('这不是 JSON'), DONE_FRAME]);
  const storyWithThinking = () => storyStream({
    thinking: '先想想阿黎会怎么反应。',
    usage: { prompt_tokens: 30, completion_tokens: 12, prompt_cache_hit_tokens: 8 },
  });

  /** 跑一次完整回合并捕获结算失败错误；requests 用于确认请求次数与阶段。 */
  async function capturePostFailure(
    request: TurnRequestV2,
    post: () => Response,
    story: () => Response = storyStream,
  ): Promise<{ failure: TurnPostFailureV2; requests: RecordedRequest[] }> {
    const requests: RecordedRequest[] = [];
    let failure: unknown;
    await withFetchMock(phaseHandler({ post, story }), async (mock) => {
      await assert.rejects(
        () => runTurnV2(request),
        (error: unknown) => { failure = error; return true; },
      );
      requests.push(...mock.requests);
    });
    assert.ok(
      failure instanceof TurnPostFailureV2,
      `结算失败应抛出 TurnPostFailureV2，实际：${failure instanceof Error ? `${failure.name}: ${failure.message}` : String(failure)}`,
    );
    return { failure: failure as TurnPostFailureV2, requests };
  }

  it('planner_post HTTP 失败时抛出 TurnPostFailureV2，partial 保留正文/简报/commitId 与已完成的两条调用', async () => {
    const request = makeRequest();
    const { failure, requests } = await capturePostFailure(request, httpFailure);

    // HTTP 500 现在会先做传输层重试（2 次，共 3 次结算请求），失败语义不变。
    assert.deepEqual(requests.map(phaseOf), ['planner_pre', 'story', 'planner_post', 'planner_post', 'planner_post']);
    assert.match(failure.message, /模型请求失败（500）/);
    const partial: TurnPartialV2 = failure.partial;
    assert.equal(partial.story, STORY_TEXT);
    assert.equal(partial.brief.intent, '试探');
    assert.equal(partial.brief.writingBrief, '主角向阿黎打听消息');
    assert.ok(partial.commitId.startsWith('commit_'), `commitId 应已生成：${partial.commitId}`);
    assert.equal(partial.input, request.input);
    assert.equal(partial.state.revision, request.state.revision);
    assert.equal(partial.state.turn, request.state.turn);
    // 只有结算失败：已完成的调用恰好是前两阶段，没有半途的 planner_post 记录。
    assert.deepEqual(partial.turnCalls.map((call) => call.phase), ['planner_pre', 'story']);
    assert.ok(partial.turnCalls[0].input?.system?.includes('写前规划 Agent'));
    assert.equal(partial.turnCalls[1].output, STORY_TEXT);
  });

  it('planner_post 返回非法 JSON 同样转成 TurnPostFailureV2（而不是整轮作废的普通错误）', async () => {
    const { failure } = await capturePostFailure(makeRequest(), invalidJson);
    assert.match(failure.message, /不是有效 JSON/);
    assert.equal(failure.partial.story, STORY_TEXT);
    assert.deepEqual(failure.partial.turnCalls.map((call) => call.phase), ['planner_pre', 'story']);
  });

  it('planner_post 被截断 / 内容过滤时同样抛出可续跑的 TurnPostFailureV2', async () => {
    const cases: Array<[string, RegExp]> = [
      ['length', /达到上限而被截断/],
      ['content_filter', /内容过滤/],
    ];
    for (const [reason, pattern] of cases) {
      const { failure } = await capturePostFailure(
        makeRequest(),
        () => chatSSE([contentFrame('{"schemaVersion":2'), finishFrame(reason), DONE_FRAME]),
      );
      assert.match(failure.message, pattern);
      assert.equal(failure.partial.story, STORY_TEXT, `finish_reason=${reason} 时正文必须保留`);
    }
  });

  it('pre/story 阶段失败仍是普通 Error；只有结算阶段提供续跑 partial', async () => {
    await withFetchMock(
      phaseHandler({ story: () => storyStream({ finishReason: 'length' }) }),
      async () => {
        await assert.rejects(() => runTurnV2(makeRequest()), (error: unknown) => {
          assert.equal(error instanceof TurnPostFailureV2, false, '故事阶段失败不应包装成结算失败');
          assert.match((error as Error).message, /达到上限而被截断/);
          return true;
        });
      },
    );
  });

  it('runTurnSettlementV2 只重跑结算：仅 1 次请求，最终状态与正常三阶段回合等价', async () => {
    const request = makeRequest();
    const { failure } = await capturePostFailure(request, invalidJson, storyWithThinking);
    // 参照组：同一条请求完整跑完三阶段。
    const normal = await withFetchMock(
      phaseHandler({ story: storyWithThinking }),
      () => runTurnV2(makeRequest()),
    );

    const resumed = await withFetchMock(
      phaseHandler({ story: storyWithThinking }),
      async (mock) => {
        const output = await runTurnSettlementV2(makeRequest(), failure.partial);
        assert.equal(mock.requests.length, 1, '续跑不应重新调用 planner_pre / story');
        assert.equal(phaseOf(mock.requests[0]), 'planner_post');
        const post = lastUserPromptOf(mock.requests[0]);
        // 续跑必须复用同一 commitId / turn，否则提交时 Patch 的 baseRevision/turn 对不上。
        assert.ok(post.includes(`【TURN_ID】${failure.partial.state.turn}:${failure.partial.commitId}`));
        assert.ok(post.includes(`【baseRevision】${failure.partial.state.revision}`));
        assert.ok(post.includes(`【turn】${failure.partial.state.turn}`));
        assert.ok(post.includes(`【CURRENT_STORY】${STORY_TEXT}`));
        assert.ok(post.includes(`【CURRENT_TURN_INPUT】${request.input}`));
        assert.ok(post.includes('【CURRENT_WRITE_PLAN】'));
        return output;
      },
    );

    // 与正常三阶段回合逐项等价（commitId 与随机 msg id 每次生成、不参与比较）。
    assert.equal(resumed.story, STORY_TEXT);
    assert.equal(resumed.brief.intent, normal.brief.intent);
    assert.equal(resumed.state.turn, normal.state.turn);
    assert.equal(resumed.state.turn, request.state.turn + 1);
    assert.equal(resumed.state.revision, normal.state.revision);
    assert.equal(resumed.state.phase, 'input');
    assert.equal(resumed.state.summary, normal.state.summary);
    assert.equal(resumed.state.latestProgress, normal.state.latestProgress);
    assert.deepEqual(resumed.state.destiny, normal.state.destiny);
    assert.deepEqual(resumed.state.characters, normal.state.characters);
    assert.deepEqual(resumed.state.relationships, normal.state.relationships);
    assert.deepEqual(resumed.state.currentScene, normal.state.currentScene);
    assert.deepEqual(resumed.state.randomEvent, normal.state.randomEvent);
    // 历史与思维链等价
    assert.deepEqual(
      resumed.state.history.map((message) => ({ role: message.role, content: message.content, turn: message.turn })),
      normal.state.history.map((message) => ({ role: message.role, content: message.content, turn: message.turn })),
    );
    assert.equal(resumed.state.history[2].thinking, normal.state.history[2].thinking);
    // 回合留档：calls 含完整三阶段、patchStats 存在。
    const record = resumed.state.turnRecords?.[0];
    assert.ok(record, '续跑成功也必须写入 turnRecord');
    assert.equal(record.turn, request.state.turn);
    assert.deepEqual(record.calls.map((call) => call.phase), ['planner_pre', 'story', 'planner_post']);
    assert.equal(record.calls[1].output, STORY_TEXT);
    assert.ok(record.patchStats, '续跑成功也必须带 Patch 对账统计');
    assert.deepEqual(record.patchStats, normal.state.turnRecords?.[0].patchStats);
    // usage 透传：pre/story 从已完成调用的留档还原，post 来自本次续跑。
    assert.equal(resumed.usage.story?.completionTokens, 12);
    assert.equal(resumed.usage.story?.cache?.hitTokens, 8);
    assert.equal(resumed.usage.pre?.promptTokens, normal.usage.pre?.promptTokens);
    assert.equal(resumed.patch.commitId, resumed.state.lastCommitId);
    assert.ok(resumed.patch.commitId.startsWith('commit_'));
  });

  it('续跑再次失败仍抛 TurnPostFailureV2，partial 可继续重试并最终提交', async () => {
    const request = makeRequest();
    const { failure: first } = await capturePostFailure(request, invalidJson);

    let secondFailure: unknown;
    await withFetchMock(phaseHandler({ post: httpFailure }), async (mock) => {
      await assert.rejects(
        () => runTurnSettlementV2(makeRequest(), first.partial),
        (error: unknown) => { secondFailure = error; return true; },
      );
      assert.equal(mock.requests.length, 3, '传输层会重试 2 次（共 3 次结算请求）');
      assert.deepEqual(mock.requests.map(phaseOf), ['planner_post', 'planner_post', 'planner_post']);
    });
    assert.ok(secondFailure instanceof TurnPostFailureV2, `再次失败仍应是 TurnPostFailureV2，实际：${String(secondFailure)}`);
    const second = secondFailure as TurnPostFailureV2;
    assert.match(second.message, /模型请求失败（500）/);
    // 失败的重试不产生 planner_post 调用记录，也不改变 partial 的正文与 commitId。
    assert.deepEqual(second.partial.turnCalls.map((call) => call.phase), ['planner_pre', 'story']);
    assert.equal(second.partial.story, STORY_TEXT);
    assert.equal(second.partial.commitId, first.partial.commitId);
    assert.notEqual(second.partial, first.partial, '每次失败都应给出独立的 partial 快照');

    const final = await withFetchMock(phaseHandler(), async (mock) => {
      const output = await runTurnSettlementV2(makeRequest(), second.partial);
      assert.equal(mock.requests.length, 1, '第二次续跑仍只发一次结算请求');
      return output;
    });
    assert.equal(final.state.turn, request.state.turn + 1);
    assert.deepEqual(final.state.turnRecords?.[0].calls.map((call) => call.phase), ['planner_pre', 'story', 'planner_post']);
  });

  it('partial 与当前存档的 revision/turn 不一致时拒绝续跑（不发请求、不包装成可续跑错误）', async () => {
    const { failure } = await capturePostFailure(makeRequest(), invalidJson);
    const mismatches: Array<Record<string, unknown>> = [
      { revision: failure.partial.state.revision + 1 },
      { turn: failure.partial.state.turn + 1 },
    ];
    for (const mismatch of mismatches) {
      const request = makeRequest({ state: mismatch });
      await withFetchMock(phaseHandler(), async (mock) => {
        await assert.rejects(
          () => runTurnSettlementV2(request, failure.partial),
          (error: unknown) => {
            assert.equal(error instanceof TurnPostFailureV2, false, 'CAS 冲突不是结算失败，不能提供续跑入口');
            assert.match((error as Error).message, /无法仅重试结算/);
            assert.match((error as Error).message, /重新生成本回合/);
            return true;
          },
        );
        assert.equal(mock.requests.length, 0, '拒绝续跑时不应发出任何模型请求');
      });
    }
  });
});

// ---------------------------------------------------------------------------
// G. 三幕聚焦窗口注入、beatsThisTurn 与幕状态机协议（D4 / D8）
// ---------------------------------------------------------------------------

/** 五幕大纲：包含幕级高级字段（entryBrief / stageContract / exitCriteriaNote）与远端幕。 */
const FIVE_ACT_OUTLINE = makeOutline({
  acts: [
    {
      id: 'act-1', title: '第一幕·雨夜', purpose: '建立日常',
      beats: [{ id: 'beat-1-1', title: '开场', purpose: '建立主角的日常状态' }],
    },
    {
      id: 'act-2', title: '第二幕·逃离', purpose: '推进冲突',
      entryBrief: '离开熟悉的街区', stageContract: '只写逃离的第一夜', exitCriteriaNote: '抵达外省',
      beats: [{ id: 'beat-2-1', title: '决断', purpose: '主角决定离开' }],
    },
    {
      id: 'act-3', title: '第三幕·扎根', purpose: '在新城市立足',
      entryBrief: '外省旧城在雨季显得陌生',
      stageContract: '允许展开新生活，禁止提前写穿身世真相',
      exitCriteriaNote: '第一次主动争取',
      beats: [
        { id: 'beat-3-1', title: '落脚', purpose: '找到能待下去的地方' },
        { id: 'beat-3-2', title: '试探', purpose: '试探新环境的态度' },
      ],
    },
    {
      id: 'act-4', title: '第四幕·回望', purpose: '必须回头面对旧关系',
      beats: [{ id: 'beat-4-1', title: '回望', purpose: '旧人重新出现' }],
    },
    {
      id: 'act-5', title: '第五幕·道别', purpose: '在旧车站完成最终告别',
      beats: [{ id: 'beat-5-1', title: '道别', purpose: '完成最终告别' }],
    },
  ],
});

/** 处于第三幕第 1 回合的权威状态：前两幕有 exitSummary，一个节从第二幕挂账进来。 */
function fiveActState(overrides: Record<string, unknown> = {}) {
  return makeState({
    turn: 9,
    revision: 12,
    summary: '此前发生过一些事。',
    latestProgress: '外省旧城的出租屋',
    history: [{ id: 'msg-1', role: 'user', content: '我搬进了出租屋', turn: 1, createdAt: 1 }],
    destiny: {
      completionEstimate: 46,
      completionReason: '仍在第三幕',
      currentActId: 'act-3',
      currentActIndex: 2,
      currentStage: '第三幕',
      currentPath: '改道离城',
      nextMilestone: '在旧车站与阿黎道别',
      convergencePlan: '让旧关系在车站自然汇合',
      beats: [
        { beatId: 'beat-1-1', actId: 'act-1', status: 'satisfied', evidenceTurns: [2], updatedAtTurn: 2 },
        {
          beatId: 'beat-2-1', actId: 'act-2', status: 'reframed', currentPlan: '改道离开城市',
          carriedFromActId: 'act-2', evidenceTurns: [8], updatedAtTurn: 8,
        },
        { beatId: 'beat-3-1', actId: 'act-3', status: 'available', evidenceTurns: [], updatedAtTurn: 8 },
        { beatId: 'beat-3-2', actId: 'act-3', status: 'active', currentPlan: '先从房东试探', evidenceTurns: [9], updatedAtTurn: 9 },
      ],
      actHistory: [
        { actId: 'act-1', enteredTurn: 0, exitedTurn: 5, exitSummary: '第一幕在雨夜争执里收束' },
        { actId: 'act-2', enteredTurn: 5, exitedTurn: 8, exitSummary: '第二幕改道离城' },
      ],
      lastActTransitionTurn: 8,
      endingReached: false,
      updatedAtTurn: 9,
    },
    ...overrides,
  });
}

describe('engine.runTurnV2 — 三幕窗口与 beatsThisTurn', () => {
  it('planner_pre 与 story 都注入三幕窗口；切幕后含上一幕 exitSummary 与当前幕 entryBrief/stageContract', async () => {
    const request = makeRequest({ state: fiveActState(), hooks: { outline: FIVE_ACT_OUTLINE } });
    let thirdActWindow = '';
    await withFetchMock(phaseHandler(), async (mock) => {
      await runTurnV2(request);
      for (const [phase, call] of [['planner_pre', mock.requests[0]], ['story', mock.requests[1]]] as const) {
        const window = windowTextOf(call);
        assert.ok(window.startsWith('【STAGE_AND_ACT_WINDOW】'), `${phase} 应注入三幕窗口`);
        assert.ok(window.length <= 900, `${phase} 窗口应 ≤ 900 字符，实际 ${window.length}`);
        assert.ok(window.includes('- 命运进度：第 3 / 5 幕《第三幕·扎根》'), window.slice(0, 200));
        assert.ok(window.includes('新幕开启（进入本幕第 1 回合）'), '切幕后第一回合应标记新幕开启');
        assert.ok(window.includes('《第二幕·逃离》（已收束）：第二幕改道离城'), '上一幕只读因果基线');
        assert.ok(window.includes('允许展开新生活，禁止提前写穿身世真相'), '当前幕施工契约');
        assert.ok(window.includes('外省旧城在雨季显得陌生'), '当前幕开幕引子');
        assert.ok(window.includes('  * [active] beat-3-2（试探）'), '本幕待推进节拍');
        assert.ok(window.includes('原属《第二幕·逃离》'), '跨幕挂账节应标出原属幕');
        assert.ok(window.includes('- 下一幕《第四幕·回望》：必须回头面对旧关系'), '下一幕远景');
        assert.ok(window.includes('- 后续未展开阶段：第5幕《第五幕·道别》'), '更远幕只列标题');
        assert.ok(window.includes('- 在旧车站与阿黎道别'), '最终命运锚');
        assert.ok(window.includes('[阶段红线]'));
        assert.ok(window.includes('5. 【下一幕】核心事件不得提前兑现'), '红线必须完整保留');
        assert.ok(!stableContextOf(call).includes('【STAGE_AND_ACT_WINDOW】'), `${phase}：窗口只进可变区`);
      }
      // 两阶段看到同一份窗口：窗口只由权威状态决定，与阶段无关。
      assert.equal(windowTextOf(mock.requests[0]), windowTextOf(mock.requests[1]));
      thirdActWindow = windowTextOf(mock.requests[0]);
    });

    // 切幕前（第二幕）的窗口必须不同：上一幕变成只读复盘、当前幕契约换成第二幕。
    const secondActState = fiveActState({
      destiny: {
        ...fiveActState().destiny,
        currentActId: 'act-2',
        currentActIndex: 1,
        lastActTransitionTurn: 5,
        actHistory: [{ actId: 'act-1', enteredTurn: 0, exitedTurn: 5, exitSummary: '第一幕在雨夜争执里收束' }],
        beats: [
          { beatId: 'beat-1-1', actId: 'act-1', status: 'satisfied', evidenceTurns: [2], updatedAtTurn: 2 },
          { beatId: 'beat-2-1', actId: 'act-2', status: 'active', evidenceTurns: [], updatedAtTurn: 5 },
        ],
      },
    });
    const secondActRequests: RecordedRequest[] = [];
    await withFetchMock(phaseHandler(), async (mock) => {
      await runTurnV2(makeRequest({ state: secondActState, hooks: { outline: FIVE_ACT_OUTLINE } }));
      secondActRequests.push(...mock.requests);
    });
    const secondActWindow = windowTextOf(secondActRequests[0]);
    assert.ok(secondActWindow.includes('- 命运进度：第 2 / 5 幕《第二幕·逃离》'), secondActWindow.slice(0, 160));
    assert.ok(secondActWindow.includes('《第一幕·雨夜》（已收束）：第一幕在雨夜争执里收束'));
    assert.ok(!secondActWindow.includes('允许展开新生活'), '尚未进入的幕只给远景标题，不得提前给出施工契约');
    assert.notEqual(secondActWindow, thirdActWindow, '切幕后的窗口内容必须变化');
  });

  it('同幕两回合（换输入关键词）：system 与稳定上下文逐字节相同，只有动态世界书变化', async () => {
    const worldFacts = [
      { id: 'wf-static', name: '世界基调', keywords: [], content: '常年阴雨。', alwaysActive: true, priority: 10 },
      { id: 'wf-a', name: '门廊线索', keywords: ['门廊'], content: '门廊下有个修表铺。', priority: 5 },
      { id: 'wf-b', name: '钟楼线索', keywords: ['钟楼'], content: '钟楼整点报时。', priority: 4 },
    ];
    const state = makeState({ turn: 2, revision: 4, history: [] });
    const first: RecordedRequest[] = [];
    const second: RecordedRequest[] = [];
    await withFetchMock(phaseHandler(), async (mock) => {
      await runTurnV2(makeRequest({ state, input: '我走到门廊下躲雨。', hooks: { worldFacts } }));
      first.push(...mock.requests);
    });
    await withFetchMock(phaseHandler(), async (mock) => {
      await runTurnV2(makeRequest({ state, input: '我听见钟楼报时。', hooks: { worldFacts } }));
      second.push(...mock.requests);
    });
    for (const [phase, index] of [['planner_pre', 0], ['story', 1], ['planner_post', 2]] as const) {
      assert.equal(systemPromptOf(first[index]), systemPromptOf(second[index]), `${phase}：system 必须逐字节相同`);
      if (stableContextOf(first[index])) {
        assert.equal(stableContextOf(first[index]), stableContextOf(second[index]), `${phase}：稳定上下文必须逐字节相同`);
      }
    }
    // 稳定块只含常驻条目；两个关键词命中的差异只出现在动态块里。
    assert.ok(stableContextOf(first[0]).includes('常年阴雨'));
    assert.ok(!stableContextOf(first[0]).includes('修表铺'));
    assert.ok(!stableContextOf(first[0]).includes('钟楼整点报时'));
    assert.deepEqual(dynamicWorldFactsOf(first[0]).map((fact) => fact.id), ['wf-a']);
    assert.deepEqual(dynamicWorldFactsOf(second[0]).map((fact) => fact.id), ['wf-b']);
    // 同幕同回合：窗口本身逐字节相同（玩家输入不改变窗口）。
    assert.equal(windowTextOf(first[0]), windowTextOf(second[0]));
  });

  it('story 注入经裁剪的 beatsThisTurn：数量由推进权限决定（standard 2 / strict 1 / free 3）', async () => {
    const brief = { ...BRIEF, beatsThisTurn: ['敲响门', '门内有人回应', '对方开门', '第 4 条应被裁掉'] };
    await withFetchMock(phaseHandler({ brief: () => jsonStream(brief) }), async (mock) => {
      await runTurnV2(makeRequest());
      const storyPrompt = lastUserPromptOf(mock.requests[1]);
      assert.ok(storyPrompt.includes('【beatsThisTurn】["敲响门","门内有人回应"]'), storyPrompt.slice(0, 160));
      assert.ok(!storyPrompt.includes('对方开门'));
      assert.ok(!lastUserPromptOf(mock.requests[0]).includes('【beatsThisTurn】['), 'planner_pre 只输出该字段，不注入清单（窗口红线里只有标签引用）');
    });

    await withFetchMock(phaseHandler({ brief: () => jsonStream(brief) }), async (mock) => {
      await runTurnV2(makeRequest({ state: { storyAutonomy: 'strict' } }));
      const storyPrompt = lastUserPromptOf(mock.requests[1]);
      assert.ok(storyPrompt.includes('【beatsThisTurn】["敲响门"]'), '严格遵循只保留第 1 条');
      assert.ok(!storyPrompt.includes('门内有人回应'));
    });

    await withFetchMock(phaseHandler({ brief: () => jsonStream(brief) }), async (mock) => {
      await runTurnV2(makeRequest({ state: { storyAutonomy: 'free' } }));
      assert.ok(lastUserPromptOf(mock.requests[1]).includes('【beatsThisTurn】["敲响门","门内有人回应","对方开门"]'), '自由发散保留 3 条');
    });

    // 坏输入（不是数组）退回空清单，不影响回合。
    await withFetchMock(phaseHandler({ brief: () => jsonStream({ ...BRIEF, beatsThisTurn: '一整段剧情' }) }), async (mock) => {
      await runTurnV2(makeRequest());
      assert.ok(lastUserPromptOf(mock.requests[1]).includes('【beatsThisTurn】[]'));
    });
  });

  it('planner_pre 模板新增 beatsThisTurn；planner_post 模板新增 actTransition，权威状态暴露幕状态机', async () => {
    const request = makeRequest({ state: fiveActState(), hooks: { outline: FIVE_ACT_OUTLINE } });
    await withFetchMock(phaseHandler(), async (mock) => {
      await runTurnV2(request);
      const pre = lastUserPromptOf(mock.requests[0]);
      assert.ok(pre.startsWith('只输出 '), 'planner_pre 可变消息仍以固定输出模板开头');
      assert.ok(pre.includes('"beatsThisTurn":[]'), 'planner_pre 输出模板应包含 beatsThisTurn');
      assert.ok(pre.indexOf('"activeBeatIds":[]') < pre.indexOf('"beatsThisTurn":[]'), 'beatsThisTurn 紧跟 activeBeatIds');
      assert.ok(pre.indexOf('"beatsThisTurn":[]') < pre.indexOf('【AUTHORITATIVE_STATE】'), '模板必须排在可变材料之前');
      assert.ok(systemPromptOf(mock.requests[0]).includes('原子节拍'), 'planner_pre 系统提示应说明原子节拍');
      assert.ok(systemPromptOf(mock.requests[1]).includes('【beatsThisTurn】是本轮唯一的节拍目标'), 'story 系统提示应说明节拍目标');
      // Prompt Pack v2：story 的 user 消息不再携带工程元字段，并在末尾追加近因锚点。
      const storyUser = lastUserPromptOf(mock.requests[1]);
      assert.ok(storyUser.startsWith('【NARRATIVE_PACE】'), 'story user 仍必须以叙事节奏开头（缓存断言）');
      assert.ok(storyUser.includes('【writingBrief】') && storyUser.includes('【STOP_BOUNDARY】'), 'story 保留核心写作指令');
      for (const metaField of ['【currentAct】', '【activeBeatIds】', '【destinyProgress】', '【pathChange】', '【reframingNeeded】', '【reconvergencePlan】', '【nextStoryFunction】']) {
        assert.ok(!storyUser.includes(metaField), `story 不应再注入工程元字段 ${metaField}`);
      }
      assert.ok(storyUser.includes('【WRITING_EXECUTION_ANCHOR】'), 'story 末尾应有近因锚点');
      assert.ok(storyUser.indexOf('【CURRENT_TURN_INPUT】') < storyUser.indexOf('【WRITING_EXECUTION_ANCHOR】'), '近因锚点必须在当前输入之后');
      assert.ok(storyUser.indexOf('【STOP_BOUNDARY】') < storyUser.indexOf('【AUTHORITATIVE_STATE】'), '停笔边界仍在权威状态之前');

      const post = lastUserPromptOf(mock.requests[2]);
      assert.ok(post.includes('"actTransition":{"proposeNextAct":false,"actExitSummary":""}'), 'postShape 应包含 actTransition');
      assert.ok(systemPromptOf(mock.requests[2]).includes('原样回显'), 'planner_post 应要求回显权威当前幕');
      assert.ok(systemPromptOf(mock.requests[2]).includes('不超过2句话'), 'actExitSummary 应限 2 句');
      const authority = post.slice(post.indexOf('【AUTHORITATIVE_STATE_BEFORE_TURN】'), post.indexOf('【CURRENT_TURN_INPUT】'));
      assert.ok(authority.includes('"currentActIndex":2'), '权威状态应暴露 currentActIndex');
      assert.ok(authority.includes('"actHistory":[{"actId":"act-1"'), '权威状态应暴露最近幕历史');
      assert.ok(authority.includes('"lastActTransitionTurn":8'), '权威状态应暴露最近切幕回合');
      assert.ok(authority.includes('"carriedFromActId":"act-2"'), 'beats 应暴露挂账来源');
    });
  });
});

// ---------------------------------------------------------------------------
// H. 随机事件：目的绑定、滚动钩子与三态闭环（D7）
// ---------------------------------------------------------------------------

describe('engine.runTurnV2 — 随机事件绑定与三态闭环', () => {
  /** 到期状态：turn=2，nextTriggerTurn=1，区间 min=max 让重排结果确定。 */
  const DUE_RANDOM_EVENT = {
    enabled: true,
    nextTriggerTurn: 1,
    pending: false,
    intensity: 'related' as const,
    triggerIntervalMin: 2,
    triggerIntervalMax: 2,
  };

  const PLANNED_BINDING = { planned: true, targetKind: 'beat', targetId: 'beat-1-1', summary: '让阿黎在雨夜交出旧信' };

  function dueRequest(hooks: Parameters<typeof makeRequest>[0] = {}) {
    return makeRequest({ ...hooks, state: { randomEvent: DUE_RANDOM_EVENT, ...(hooks.state ?? {}) } });
  }

  it('到期时 planner_pre 与 story 都注入【RANDOM_EVENT_CONTEXT】和新指令；planner_post 暴露三态协议', async () => {
    await withFetchMock(phaseHandler(), async (mock) => {
      await runTurnV2(dueRequest());
      const pre = lastUserPromptOf(mock.requests[0]);
      const story = lastUserPromptOf(mock.requests[1]);
      for (const [phase, prompt] of [['planner_pre', pre], ['story', story]] as const) {
        assert.ok(prompt.includes('【RANDOM_EVENT_CONTEXT】'), `${phase} 应注入随机事件上下文`);
        assert.ok(prompt.includes('【绑定要求】'), `${phase} 应包含绑定要求`);
        assert.ok(prompt.includes('targetKind') && prompt.includes('targetId') && prompt.includes('summary'));
        assert.ok(prompt.includes('reconvergence：destiny_main'), `${phase} 候选目标应含命运锚`);
      }
      // planner_pre 输出模板新增绑定字段。
      assert.ok(pre.includes('"randomEvent":{"planned":false,"targetKind":"beat|thread|relationship|reconvergence","targetId":"","summary":""'));
      // story 仍保留写前安排。
      assert.ok(story.includes('【RANDOM_EVENT_PLAN】'));
      // planner_post 输出模板与系统提示加入三态。
      const post = lastUserPromptOf(mock.requests[2]);
      assert.ok(post.includes('"resolution":"resolved|ongoing_hook|interrupted"'), 'postShape 应包含 resolution');
      const postSystem = systemPromptOf(mock.requests[2]);
      assert.ok(postSystem.includes('randomEvent三态'), 'planner_post 系统提示应说明三态');
      assert.ok(postSystem.includes('interrupted'), 'planner_post 应说明被打断语义');
      assert.ok(postSystem.includes('handled与resolution必须自洽'));
    });

    // 未到期回合不注入随机事件上下文（保持旧行为，避免每回合都提醒模型插事件）。
    await withFetchMock(phaseHandler(), async (mock) => {
      await runTurnV2(makeRequest());
      assert.ok(!lastUserPromptOf(mock.requests[0]).includes('【RANDOM_EVENT_CONTEXT】'));
      assert.ok(!lastUserPromptOf(mock.requests[1]).includes('【RANDOM_EVENT_CONTEXT】'));
    });
  });

  it('planner_pre 合法绑定：提交后写入 activeBinding 与 lastPlan，pending 回合保留绑定', async () => {
    const activity: ModelActivityV2[] = [];
    const brief = { ...BRIEF, randomEvent: PLANNED_BINDING };
    const request = dueRequest({ hooks: { onModelActivity: (item) => activity.push(item) } });
    const result = await withFetchMock(
      phaseHandler({ brief: () => jsonStream(brief), post: () => jsonStream({ ...POST_PATCH, randomEvent: { handled: false, note: '' } }) }),
      () => runTurnV2(request),
    );
    assert.deepEqual(result.state.randomEvent.activeBinding, {
      targetKind: 'beat',
      targetId: 'beat-1-1',
      summary: '让阿黎在雨夜交出旧信',
      plannedAtTurn: 2,
    });
    assert.equal(result.state.randomEvent.lastPlan, '让阿黎在雨夜交出旧信');
    assert.equal(result.state.randomEvent.pending, true, '本回合没发生 → 顺延');
    assert.equal(result.state.randomEvent.nextTriggerTurn, 3);
    assert.ok(!activity.some((item) => item.type === 'warning' && (item as any).code === 'random_event_binding_invalid'), '合法绑定不应产生警告');
  });

  it('planner_pre 非法绑定：发 random_event_binding_invalid 警告、只写 lastPlan 不写 activeBinding', async () => {
    const activity: ModelActivityV2[] = [];
    const brief = {
      ...BRIEF,
      randomEvent: { planned: true, targetKind: 'character', targetId: 'char-a', summary: '无绑定路人事件' },
    };
    const request = dueRequest({ hooks: { onModelActivity: (item) => activity.push(item) } });
    const result = await withFetchMock(
      phaseHandler({ brief: () => jsonStream(brief) }),
      () => runTurnV2(request),
    );
    const warning = activity.find((item) => item.type === 'warning' && (item as any).code === 'random_event_binding_invalid');
    assert.ok(warning, '应发出 random_event_binding_invalid 警告');
    assert.ok((warning as any).message.includes('targetKind'));
    assert.equal(result.state.randomEvent.activeBinding, undefined, '非法绑定不得写入权威状态');
    assert.equal(result.state.randomEvent.lastPlan, '无绑定路人事件', 'lastPlan 仍记录模型文字');
  });

  it('过期绑定目标（id 不存在）同样被拒', async () => {
    const brief = { ...BRIEF, randomEvent: { planned: true, targetKind: 'beat', targetId: 'beat-404', summary: '旧目标' } };
    const result = await withFetchMock(
      phaseHandler({ brief: () => jsonStream(brief) }),
      () => runTurnV2(dueRequest()),
    );
    assert.equal(result.state.randomEvent.activeBinding, undefined);
    assert.equal(result.state.randomEvent.lastPlan, '旧目标');
  });

  it('handled + resolution：同一回合闭环，history 出现并按三态落库；planner_post 能看到 seed 的绑定', async () => {
    const brief = { ...BRIEF, randomEvent: PLANNED_BINDING };
    const result = await withFetchMock(
      phaseHandler({
        brief: () => jsonStream(brief),
        post: () => jsonStream({ ...POST_PATCH, randomEvent: { handled: true, resolution: 'ongoing_hook', note: '只让阿黎提到旧信' } }),
      }),
      async (mock) => {
        const output = await runTurnV2(dueRequest());
        // planner_post 的权威状态应包含本回合刚校验通过的绑定（否则结算模型不知道要兑现哪个目标）。
        const post = lastUserPromptOf(mock.requests[2]);
        assert.ok(post.includes('"activeBinding":{"targetKind":"beat","targetId":"beat-1-1"'), '结算快照应 seed 本回合绑定');
        return output;
      },
    );
    const randomEvent = result.state.randomEvent;
    assert.equal(randomEvent.history?.length, 1);
    const item = randomEvent.history![0];
    assert.equal(item.status, 'ongoing_hook');
    assert.equal(item.targetKind, 'beat');
    assert.equal(item.targetId, 'beat-1-1');
    assert.equal(item.summary, '让阿黎在雨夜交出旧信');
    assert.equal(item.outcomeNote, '只让阿黎提到旧信');
    assert.equal(item.turn, 2, '历史记录发生回合（提交前 turn）');
    assert.equal(randomEvent.activeBinding, undefined, '已兑现（含留钩子）后清空绑定');
    assert.equal(randomEvent.pending, false);
    assert.equal(randomEvent.lastTriggeredTurn, 2);
    assert.equal(randomEvent.nextTriggerTurn, 4, 'turn 2 + interval 2');
    assert.equal(randomEvent.lastPlan, '让阿黎在雨夜交出旧信');
    assert.equal(result.state.turn, 3, '历史记录写入后回合号才前进');
  });

  it('interrupted：写 interrupted 历史、保留绑定、pending 顺延', async () => {
    const brief = { ...BRIEF, randomEvent: PLANNED_BINDING };
    const result = await withFetchMock(
      phaseHandler({
        brief: () => jsonStream(brief),
        post: () => jsonStream({ ...POST_PATCH, randomEvent: { handled: false, resolution: 'interrupted', note: '玩家转身离开' } }),
      }),
      () => runTurnV2(dueRequest()),
    );
    assert.equal(result.state.randomEvent.history?.[0].status, 'interrupted');
    assert.deepEqual(result.state.randomEvent.activeBinding, {
      targetKind: 'beat', targetId: 'beat-1-1', summary: '让阿黎在雨夜交出旧信', plannedAtTurn: 2,
    });
    assert.equal(result.state.randomEvent.pending, true);
    assert.equal(result.state.randomEvent.nextTriggerTurn, 3);
  });

  it('snapshot 暴露 activeBinding 与最近 history（≤8 条，供模型回收旧钩子）', async () => {
    const history = Array.from({ length: 10 }, (_, index) => ({
      id: `rev-${index}`,
      turn: index,
      intensity: 'related' as const,
      targetKind: 'beat' as const,
      targetId: 'beat-1-1',
      summary: `旧事件${index}`,
      status: 'ongoing_hook' as const,
    }));
    const request = dueRequest({
      state: {
        randomEvent: {
          ...DUE_RANDOM_EVENT,
          activeBinding: { targetKind: 'beat', targetId: 'beat-1-1', summary: '等待兑现的绑定', plannedAtTurn: 1 },
          history,
        },
      },
    });
    await withFetchMock(phaseHandler(), async (mock) => {
      await runTurnV2(request);
      const pre = lastUserPromptOf(mock.requests[0]);
      assert.ok(pre.includes('"activeBinding":{"targetKind":"beat","targetId":"beat-1-1","summary":"等待兑现的绑定"'));
      assert.ok(pre.includes('"history":[{"id":"rev-2"'), '历史应只暴露最近 8 条（rev-2 ~ rev-9）');
      assert.ok(!pre.includes('"id":"rev-1"'), '更早的历史被裁掉');
      assert.ok(pre.includes('可回收旧钩子'), '上下文块应提示可回收的旧钩子');
    });
  });

  it('仅重试结算：从 partial.brief 重新校验绑定，提交结果与首发等价（history + 清空绑定）', async () => {
    const brief = { ...BRIEF, randomEvent: PLANNED_BINDING };
    const request = dueRequest();
    let failure: TurnPostFailureV2 | undefined;
    // 首次执行：planner_post 返回非法 JSON → 可续跑的 TurnPostFailureV2。
    await withFetchMock(
      phaseHandler({
        brief: () => jsonStream(brief),
        post: () => chatSSE([contentFrame('null'), DONE_FRAME]),
      }),
      async () => {
        try {
          await runTurnV2(request);
        } catch (error) {
          failure = error as TurnPostFailureV2;
        }
      },
    );
    assert.ok(failure instanceof TurnPostFailureV2, `应抛出 TurnPostFailureV2，实际：${String(failure)}`);
    assert.deepEqual(failure!.partial.brief.randomEvent, brief.randomEvent, 'partial 保留写前绑定');

    const resumed = await withFetchMock(
      phaseHandler({
        post: () => jsonStream({ ...POST_PATCH, randomEvent: { handled: true, resolution: 'resolved', note: '旧信被找到' } }),
      }),
      async (mock) => {
        const output = await runTurnSettlementV2(dueRequest(), failure!.partial);
        assert.equal(mock.requests.length, 1, '续跑只发一次结算请求');
        return output;
      },
    );
    assert.equal(resumed.state.randomEvent.history?.length, 1);
    assert.equal(resumed.state.randomEvent.history![0].status, 'resolved');
    assert.equal(resumed.state.randomEvent.history![0].targetId, 'beat-1-1');
    assert.equal(resumed.state.randomEvent.activeBinding, undefined);
    assert.equal(resumed.state.randomEvent.lastTriggeredTurn, 2);
  });
});

// ---------------------------------------------------------------------------
// I. 程序侧收尾检测与下轮软纠偏（D8）
// ---------------------------------------------------------------------------

describe('engine.runTurnV2 — 节奏审计与下轮软纠偏', () => {
  const PACE_ALERT = '【PACE_CORRECTION_ALERT】';

  /** 以完整存档作为下一回合的输入（makeRequest 的 state 是 Record<string, unknown>）。 */
  const asState = (state: unknown) => state as Record<string, unknown>;

  /** 指定正文的 story 阶段响应。 */
  const storyWithText = (text: string) => () => storyStream({ text });

  it('干净回合：turnRecord.pacing 存在且 needsCorrection=false；下一回合不注入纠偏块', async () => {
    const firstRequests: RecordedRequest[] = [];
    const first = await withFetchMock(phaseHandler(), async (mock) => {
      const output = await runTurnV2(makeRequest());
      firstRequests.push(...mock.requests);
      return output;
    });
    // 首回合存档里还没有 turnRecords：没有上一轮的审计可读，提示词不应出现纠偏块。
    for (const request of firstRequests) {
      assert.ok(!allPromptTextOf(request).includes(PACE_ALERT), `${phaseOf(request)}：无历史 pacing 时不应注入纠偏块`);
    }
    const record = first.state.turnRecords?.[0];
    assert.ok(record?.pacing, '提交回合必须写入 pacing 审计');
    assert.deepEqual(record!.pacing, {
      length: STORY_TEXT.length,
      timeJumpCount: 0,
      closureDetected: false,
      overBudget: false,
      needsCorrection: false,
    });

    const secondRequests: RecordedRequest[] = [];
    await withFetchMock(phaseHandler(), async (mock) => {
      await runTurnV2(makeRequest({ state: asState(first.state) }));
      secondRequests.push(...mock.requests);
    });
    for (const request of secondRequests) {
      assert.ok(!allPromptTextOf(request).includes(PACE_ALERT), `${phaseOf(request)}：干净回合不应注入纠偏块（needsCorrection=false）`);
    }
  });

  it('上一轮篇幅越界：下一轮 planner_pre 与 story 都注入纠偏块（窗口之后、权威状态之前），planner_post 不注入', async () => {
    const longStory = `${'雨'.repeat(PACE_LENGTH_LIMIT)}。`;
    const first = await withFetchMock(
      phaseHandler({ story: storyWithText(longStory) }),
      () => runTurnV2(makeRequest()),
    );
    const pacing = first.state.turnRecords?.[0]?.pacing;
    assert.equal(pacing?.length, longStory.length);
    assert.equal(pacing?.overBudget, true);
    assert.equal(pacing?.needsCorrection, true);

    const requests: RecordedRequest[] = [];
    await withFetchMock(phaseHandler(), async (mock) => {
      await runTurnV2(makeRequest({ state: asState(first.state) }));
      requests.push(...mock.requests);
    });
    const pre = lastUserPromptOf(requests[0]);
    const storyPrompt = lastUserPromptOf(requests[1]);
    const post = lastUserPromptOf(requests[2]);
    for (const [phase, prompt] of [['planner_pre', pre], ['story', storyPrompt]] as const) {
      assert.ok(prompt.includes(PACE_ALERT), `${phase} 应注入纠偏块`);
      assert.ok(prompt.includes('只推进 1 个节拍'), `${phase} 纠偏要求本轮只推进 1 个节拍`);
      assert.ok(prompt.indexOf('【DYNAMIC_WORLD_FACTS】') < prompt.indexOf(PACE_ALERT), `${phase}：纠偏块在动态世界书之后`);
      assert.ok(prompt.indexOf(PACE_ALERT) < prompt.indexOf('【AUTHORITATIVE_STATE】'), `${phase}：纠偏块在权威状态之前`);
    }
    assert.ok(pre.indexOf('【STAGE_AND_ACT_WINDOW】') < pre.indexOf(PACE_ALERT), 'planner_pre：纠偏块在三幕窗口之后');
    assert.ok(storyPrompt.indexOf('【beatsThisTurn】') < storyPrompt.indexOf(PACE_ALERT), 'story：纠偏块在节拍清单之后');
    assert.ok(pre.includes(`正文 ${longStory.length} 字`), '纠偏块应说明上轮篇幅');
    assert.ok(!post.includes(PACE_ALERT), 'planner_post 不注入纠偏块（D8 只做下一轮软纠偏）');
    assert.ok(!post.includes('"pacing"'), 'snapshot 不暴露 pacing，避免扩大模型输入');
  });

  it('上一轮升华式收尾：下一轮注入纠偏块并说明收尾越界类型', async () => {
    const closureStory = `${STORY_TEXT}多年以后，他还会想起这个雨夜。`;
    const first = await withFetchMock(
      phaseHandler({ story: storyWithText(closureStory) }),
      () => runTurnV2(makeRequest()),
    );
    assert.equal(first.state.turnRecords?.[0]?.pacing?.closureDetected, true);
    assert.equal(first.state.turnRecords?.[0]?.pacing?.needsCorrection, true);

    await withFetchMock(phaseHandler(), async (mock) => {
      await runTurnV2(makeRequest({ state: asState(first.state) }));
      for (const index of [0, 1]) {
        const prompt = lastUserPromptOf(mock.requests[index]);
        assert.ok(prompt.includes(PACE_ALERT), `${phaseOf(mock.requests[index])} 应注入纠偏块`);
        assert.ok(prompt.includes('升华/收束'), '纠偏块应说明上轮越界类型是收尾/升华');
      }
    });
  });
});

// ---------------------------------------------------------------------------
// J. 规划模型官方联网搜索（web_search，默认关闭）
// ---------------------------------------------------------------------------

describe('engine.runTurnV2 — 规划模型官方联网搜索', () => {
  const OFFICIAL_BASE = 'https://api.deepseek.com/v1';
  const WEB_SEARCH_RESPONSE = {
    results: [
      {
        rerank_score: 2.4,
        title: '现实资料',
        url: 'https://example.com/fact',
        snippet: '与查询相关的短摘要',
        summary: '一段关于现实世界制度的资料摘要。',
        content: '',
        site_name: '示例站',
        site_icon: null,
        date: '2026-06-01T00:00:00+00:00',
        authority: 3,
      },
    ],
  };
  const webToolCall = (id: string) => chatSSE([toolCallFrame([{
    index: 0,
    id,
    type: 'function',
    function: { name: 'web_search', arguments: '{"query":"现实世界的制度"}' },
  }]), DONE_FRAME]);
  const toolNamesOf = (request: RecordedRequest): string[] => (
    Array.isArray(request.body?.tools)
      ? request.body.tools.map((tool: any) => String(tool?.function?.name ?? ''))
      : []
  );
  const toolMessagesOf = (request: RecordedRequest): any[] => (
    (request.body?.messages ?? []).filter((message: any) => message.role === 'tool')
  );
  const plannerRequestsOf = (requests: RecordedRequest[]): RecordedRequest[] => (
    requests.filter((request) => systemPromptOf(request).includes('写前规划 Agent'))
  );
  /** 规划 JSON 请求：官方 base 下 plannerJsonMode 为 auto 时会带 response_format，mock 忽略即可。 */
  const plannerJson = () => jsonStream(BRIEF);
  const isSearchRequest = (request: RecordedRequest): boolean => request.url.endsWith('/tools/search');

  it('默认设置（联网搜索关闭）下不提供 web_search；仅开工具时也只有 search_story_context', async () => {
    await withFetchMock(phaseHandler(), async (mock) => {
      await runTurnV2(makeRequest());
      for (const request of mock.requests) {
        assert.equal(request.body?.tools, undefined, `${phaseOf(request)} 默认不应带工具`);
      }
    });

    await withFetchMock(phaseHandler(), async (mock) => {
      await runTurnV2(makeRequest({ settings: { plannerToolsEnabled: true } }));
      assert.deepEqual(toolNamesOf(mock.requests[0]), ['search_story_context']);
      assert.ok(!systemPromptOf(mock.requests[0]).includes('联网搜索工具纪律'), '未开启联网搜索时不应注入纪律');
    });
  });

  it('开启 + 官方地址 + 有 Key：planner_pre 挂载 web_search 并注入纪律，故事/结算不挂载', async () => {
    const request = makeRequest({
      settings: {
        plannerToolsEnabled: true,
        plannerToolMaxCalls: 2,
        plannerWebSearchEnabled: true,
        apiBaseUrl: OFFICIAL_BASE,
      },
    });
    await withFetchMock(phaseHandler(), async (mock) => {
      await runTurnV2(request);
      assert.deepEqual(toolNamesOf(mock.requests[0]), ['search_story_context', 'web_search']);
      const system = systemPromptOf(mock.requests[0]);
      assert.ok(system.includes('联网搜索工具纪律'));
      assert.ok(system.includes('web_search'));
      assert.equal(mock.requests[1].body?.tools, undefined, '故事阶段不挂载工具');
      assert.equal(mock.requests[2].body?.tools, undefined, '结算阶段不挂载工具');
      assert.ok(!allPromptTextOf(mock.requests[2]).includes('web_search'));
    });
  });

  it('开启但 API Base 不是官方 DeepSeek：不提供 web_search，也不注入纪律', async () => {
    const request = makeRequest({
      settings: {
        plannerToolsEnabled: true,
        plannerWebSearchEnabled: true,
        apiBaseUrl: 'https://api.test.invalid/v1',
      },
    });
    await withFetchMock(phaseHandler(), async (mock) => {
      await runTurnV2(request);
      assert.deepEqual(toolNamesOf(mock.requests[0]), ['search_story_context']);
      assert.ok(!systemPromptOf(mock.requests[0]).includes('联网搜索工具纪律'));
    });
  });

  it('模型请求 web_search：官方结果注入下一轮，回合照常提交', async () => {
    const activity: ModelActivityV2[] = [];
    const request = makeRequest({
      settings: {
        plannerToolsEnabled: true,
        plannerToolMaxCalls: 2,
        plannerWebSearchEnabled: true,
        apiBaseUrl: OFFICIAL_BASE,
      },
      hooks: { onModelActivity: (item) => activity.push(item) },
    });
    const searchRequests: RecordedRequest[] = [];
    const result = await withFetchMock((recorded) => {
      if (isSearchRequest(recorded)) {
        searchRequests.push(recorded);
        return new Response(JSON.stringify(WEB_SEARCH_RESPONSE), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      const system = systemPromptOf(recorded);
      if (system.includes('写前规划 Agent')) {
        return toolMessagesOf(recorded).length ? plannerJson() : webToolCall('call_web_1');
      }
      if (system.includes('写后审计')) return jsonStream(POST_PATCH);
      return storyStream();
    }, async (mock) => {
      const output = await runTurnV2(request);
      // 校验请求形状（tools/search 请求没有 messages，必须用 URL 区分）
      assert.equal(searchRequests.length, 1, '应只发起一次官方搜索请求');
      assert.equal(searchRequests[0].url, 'https://api.deepseek.com/v1/tools/search');
      assert.equal(searchRequests[0].headers.Authorization, 'Bearer test-key');
      assert.deepEqual(JSON.parse(searchRequests[0].rawBody), {
        query: '现实世界的制度',
        count: 5,
        need_content: false,
        ori_question: '我向阿黎打听消息',
      });
      // 第二轮 planner_pre 应带 tool 结果消息
      const planners = plannerRequestsOf(mock.requests);
      assert.equal(planners.length, 2, '第一轮规划 + 带工具结果的第二轮规划');
      const toolMessages = toolMessagesOf(planners[1]);
      assert.equal(toolMessages.length, 1);
      assert.equal(toolMessages[0].name, 'web_search');
      assert.equal(toolMessages[0].tool_call_id, 'call_web_1');
      const payload = JSON.parse(String(toolMessages[0].content));
      assert.equal(payload.ok, true);
      assert.equal(payload.resultCount, 1);
      assert.equal(payload.results[0].title, '现实资料');
      assert.equal(payload.results[0].url, 'https://example.com/fact');
      assert.ok(String(payload.note).includes('不得用它覆盖'));
      assert.ok(String(payload.note).includes('URL'));
      return output;
    });

    assert.equal(result.state.turn, request.state.turn + 1);
    assert.deepEqual(result.state.turnRecords?.[0].calls.map((call) => call.phase), ['planner_pre', 'story', 'planner_post']);
    const toolEvents = activity.filter((item) => item.type === 'tool') as Array<Extract<ModelActivityV2, { type: 'tool' }>>;
    assert.deepEqual(toolEvents.map((item) => item.toolName), ['web_search', 'web_search']);
    assert.deepEqual(toolEvents.map((item) => item.status), ['call', 'result']);
    assert.ok((toolEvents[1].resultText ?? '').includes('example.com'), '工具结果应进入活动流');
  });

  it('同一回合第二次 web_search 被拒：返回错误文本、不再发请求、回合照常提交', async () => {
    const request = makeRequest({
      settings: {
        plannerToolsEnabled: true,
        plannerToolMaxCalls: 2,
        plannerWebSearchEnabled: true,
        apiBaseUrl: OFFICIAL_BASE,
      },
    });
    const searchRequests: RecordedRequest[] = [];
    const result = await withFetchMock((recorded) => {
      if (isSearchRequest(recorded)) {
        searchRequests.push(recorded);
        return new Response(JSON.stringify(WEB_SEARCH_RESPONSE), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      const system = systemPromptOf(recorded);
      if (system.includes('写前规划 Agent')) {
        const toolCount = toolMessagesOf(recorded).length;
        if (toolCount === 0) return webToolCall('call_web_1');
        if (toolCount === 1) return webToolCall('call_web_2');
        return plannerJson();
      }
      if (system.includes('写后审计')) return jsonStream(POST_PATCH);
      return storyStream();
    }, async (mock) => {
      const output = await runTurnV2(request);
      assert.equal(searchRequests.length, 1, '第二次调用必须被程序拒绝，不产生网络请求');
      const planners = plannerRequestsOf(mock.requests);
      assert.equal(planners.length, 3, '初始规划 + 第一次工具结果 + 第二次工具结果');
      const rejected = JSON.parse(String(toolMessagesOf(planners[2])[1]?.content ?? '{}'));
      assert.equal(rejected.ok, false);
      assert.equal(rejected.tool, 'web_search');
      assert.ok(String(rejected.error).includes('每回合'), `实际错误：${rejected.error}`);
      return output;
    });
    assert.equal(result.state.turn, request.state.turn + 1);
  });

  it('搜索失败（HTTP 500）只返回工具错误文本，回合照常提交', async () => {
    const request = makeRequest({
      settings: {
        plannerToolsEnabled: true,
        plannerToolMaxCalls: 2,
        plannerWebSearchEnabled: true,
        apiBaseUrl: OFFICIAL_BASE,
      },
    });
    const result = await withFetchMock((recorded) => {
      if (isSearchRequest(recorded)) {
        return new Response(JSON.stringify({ error: { message: 'internal error' } }), {
          status: 500,
          headers: { 'content-type': 'application/json' },
        });
      }
      const system = systemPromptOf(recorded);
      if (system.includes('写前规划 Agent')) {
        return toolMessagesOf(recorded).length ? plannerJson() : webToolCall('call_web_500');
      }
      if (system.includes('写后审计')) return jsonStream(POST_PATCH);
      return storyStream();
    }, async (mock) => {
      const output = await runTurnV2(request);
      const planners = plannerRequestsOf(mock.requests);
      const payload = JSON.parse(String(toolMessagesOf(planners[1])[0]?.content ?? '{}'));
      assert.equal(payload.ok, false);
      assert.ok(String(payload.error).includes('500'), `实际错误：${payload.error}`);
      assert.ok(String(payload.note).includes('联网搜索失败已降级'));
      return output;
    });
    assert.equal(result.state.turn, request.state.turn + 1, '搜索失败不应导致回合失败');
  });
});

describe('engine.runTurnV2 — 故事推进权限（与叙事速度解耦的骨架）', () => {
  it('strict / free 两档都注入 planner_pre 与 story；缺省为 standard', async () => {
    const cases = [
      ['strict', '严格遵循（玩家绝对主导）：'],
      ['free', '自由发散（模型主动编排）：'],
    ] as const;
    for (const [autonomy, marker] of cases) {
      await withFetchMock(phaseHandler(), async (mock) => {
        await runTurnV2(makeRequest({ state: { storyAutonomy: autonomy } }));
        const plannerUser = lastUserPromptOf(mock.requests[0]);
        const storyUser = lastUserPromptOf(mock.requests[1]);
        assert.ok(plannerUser.includes('【STORY_AUTONOMY】'), `planner_pre 应注入推进权限（${autonomy}）`);
        assert.ok(plannerUser.includes(marker), `planner_pre 应包含 ${marker}`);
        assert.ok(storyUser.includes('【STORY_AUTONOMY】'), `story 应注入推进权限（${autonomy}）`);
        assert.ok(storyUser.includes(marker), `story 应包含 ${marker}`);
      });
    }
    await withFetchMock(phaseHandler(), async (mock) => {
      await runTurnV2(makeRequest());
      assert.ok(lastUserPromptOf(mock.requests[0]).includes('标准推进（主线协同）：'), '缺省应为标准推进');
      assert.ok(lastUserPromptOf(mock.requests[1]).includes('标准推进（主线协同）：'), '缺省应为标准推进');
    });
  });

  it('story 的叙事节奏仍排在推进权限之前，且 user#2 仍以【NARRATIVE_PACE】开头', async () => {
    await withFetchMock(phaseHandler(), async (mock) => {
      await runTurnV2(makeRequest({ state: { storyAutonomy: 'free' } }));
      const storyUser = lastUserPromptOf(mock.requests[1]);
      assert.ok(storyUser.startsWith('【NARRATIVE_PACE】'), '缓存前缀断言：story user#2 必须以叙事节奏开头');
      assert.ok(storyUser.indexOf('【NARRATIVE_PACE】') < storyUser.indexOf('【STORY_AUTONOMY】'), '推进权限排在叙事节奏之后');
    });
  });
});

describe('engine.runTurnV2 — 异常短正文防护', () => {
  it('正文低于最小长度时判失败、不提交（流式截断防护）', async () => {
    await withFetchMock(phaseHandler({
      story: () => storyStream({ text: '下了课借口去' }),
    }), async () => {
      await assert.rejects(() => runTurnV2(makeRequest()), /过短/);
    });
  });

  it('长度足够但句尾缺少终结标点（半句断流）同样判失败', async () => {
    const halfSentence = STORY_TEXT.slice(0, -1);
    await withFetchMock(phaseHandler({
      story: () => storyStream({ text: halfSentence }),
    }), async () => {
      await assert.rejects(() => runTurnV2(makeRequest()), /未写完|截断/);
    });
  });

  it('反代把供应商错误文本当正文返回时判失败、不提交', async () => {
    const providerError = 'The prompt could not be submitted. The prompt contains sensitive words that violate the content policy. Please send feedback.';
    await withFetchMock(phaseHandler({
      story: () => storyStream({ text: providerError }),
    }), async () => {
      await assert.rejects(() => runTurnV2(makeRequest()), /供应商错误|内容审核/);
    });
  });
});

describe('engine.runTurnV2 — 文风 profile 与结算 JSON 约束', () => {
  it('文风 profile 只控制微示范与锚点长短；篇幅带唯一来源是 STORY_AUTONOMY（v2.2.1 回归）', async () => {
    const systemLengths: number[] = [];
    await withFetchMock(phaseHandler(), async (mock) => {
      await runTurnV2(makeRequest({ settings: { storyModel: 'gemini-3.8-flash-high' } }));
      const plannerSystem = systemPromptOf(mock.requests[0]);
      const system = systemPromptOf(mock.requests[1]);
      const user = lastUserPromptOf(mock.requests[1]);
      systemLengths.push(system.length);
      assert.ok(!system.includes('文风正反微示范'), 'expressive 不应带文风微示范');
      assert.ok(system.includes('目标篇幅以【STORY_AUTONOMY】为准'), 'expressive 的篇幅指引应指向 STORY_AUTONOMY');
      assert.ok(
        system.includes('若其他块（profile/锚点/节奏）与【STORY_AUTONOMY】的篇幅目标冲突，以【STORY_AUTONOMY】为准。'),
        'story system 应声明 STORY_AUTONOMY 为篇幅单一来源',
      );
      assert.ok(!/\d+~\d+字/.test(system), `story system 不得再写死数值篇幅带（发现 ${/\d+~\d+字/.exec(system)?.[0] ?? '无'}）`);
      assert.ok(user.includes('忌用过度渲染副词与段末总结旁白'), 'expressive 应使用短锚点');
      assert.ok(user.includes('【STORY_AUTONOMY】') && /\d+~\d+字/.test(user), '数值篇幅带只应出现在 STORY_AUTONOMY（story user）里');
      // planner_pre 也不得有第二套篇幅目标：stopBoundary 只指向 STORY_AUTONOMY。
      assert.ok(!/\d+~\d+字/.test(plannerSystem), 'planner_pre system 不得写死数值篇幅带');
      assert.ok(
        plannerSystem.includes('单回合的交锋轮数与篇幅以【STORY_AUTONOMY】为准'),
        'planner stopBoundary 应把篇幅与轮数指向 STORY_AUTONOMY',
      );
    });

    await withFetchMock(phaseHandler(), async (mock) => {
      await runTurnV2(makeRequest({ settings: { storyModel: 'deepseek-flash' } }));
      const system = systemPromptOf(mock.requests[1]);
      const user = lastUserPromptOf(mock.requests[1]);
      systemLengths.push(system.length);
      assert.ok(system.includes('文风正反微示范'), 'compact 必须保留文风微示范');
      assert.ok(system.includes('目标篇幅以【STORY_AUTONOMY】为准'), 'compact 的篇幅指引应指向 STORY_AUTONOMY');
      assert.ok(!/\d+~\d+字/.test(system), 'compact 的 story system 不得再写死数值篇幅带');
      assert.ok(user.includes('日常旧流程一笔带过'), 'compact 应使用完整锚点');
      assert.ok(user.includes('【STORY_AUTONOMY】') && /\d+~\d+字/.test(user), '数值篇幅带只应出现在 STORY_AUTONOMY（story user）里');
      // 近因锚点也不得写死展开轮数（否则 strict 档会与"充分展开"互相打架）。
      assert.ok(!user.includes('2~3轮'), '近因锚点不得写死展开轮数');
      assert.ok(user.includes('展开幅度与篇幅均以【STORY_AUTONOMY】为准'), 'compact 锚点应把展开幅度指向 STORY_AUTONOMY');
    });

    // profile 差异仍然保留：compact 带微示范（system 更长），expressive 省掉。
    assert.ok(systemLengths[1] > systemLengths[0], 'compact 的 system 应因微示范而长于 expressive');
  });

  it('planner_post system 明确要求字符串内引号改用中文引号（防 JSON 崩溃）', async () => {
    await withFetchMock(phaseHandler(), async (mock) => {
      await runTurnV2(makeRequest());
      const postSystem = systemPromptOf(mock.requests[2]);
      assert.ok(postSystem.includes('未转义的英文双引号'), '应包含引号转义约束');
      assert.ok(postSystem.includes('「」'), '应给出中文引号替代方案');
    });
  });

  it('叙事速度与推进权限使用 v2.2 正式文案（风格 / 权限正交）', async () => {
    await withFetchMock(phaseHandler(), async (mock) => {
      await runTurnV2(makeRequest({ state: { narrativePace: 'slow', storyAutonomy: 'strict' } }));
      const user = lastUserPromptOf(mock.requests[1]);
      assert.ok(user.includes('近景特写镜头'), '慢叙事应只描述镜头焦距');
      assert.ok(user.includes('严格遵循（玩家绝对主导）'), '严格遵循应描述推进权限');
      assert.ok(!user.includes('本轮只展开一个微小而连续的故事节拍'), '叙事速度不应再承担推进职责');
    });
  });
});

// ---------------------------------------------------------------------------
// K. 混合端点：故事阶段独立连接（planner 仍用全局）
// ---------------------------------------------------------------------------

describe('engine.runTurnV2 — 故事阶段独立连接（混合端点）', () => {
  const PLANNER_BASE = 'https://planner.invalid/v1';
  const STORY_BASE = 'https://story.invalid/v1';

  /** 混合端点请求：默认全局 planner 连接 + story 覆盖，可再叠加其它设置。 */
  const hybridRequest = (
    settings: Partial<AppSettings> = {},
    overrides: Parameters<typeof makeRequest>[0] = {},
  ) => makeRequest({
    ...overrides,
    settings: {
      apiBaseUrl: PLANNER_BASE,
      apiKey: 'planner-key',
      storyApiBaseUrl: STORY_BASE,
      storyApiKey: 'story-key',
      ...settings,
    },
  });

  const urlsOf = (requests: RecordedRequest[]) => requests.map((request) => request.url);
  const authOf = (requests: RecordedRequest[]) => requests.map((request) => request.headers.Authorization);
  const modelsOf = (requests: RecordedRequest[]) => requests.map((request) => String(request.body?.model ?? ''));
  const effortOf = (request: RecordedRequest) => (request.body as { reasoning_effort?: string } | undefined)?.reasoning_effort;
  const toolNamesOf = (request: RecordedRequest): string[] => (
    Array.isArray(request.body?.tools)
      ? request.body.tools.map((tool: any) => String(tool?.function?.name ?? ''))
      : []
  );

  it('story 用独立 base/key，planner_pre 与 planner_post 仍走全局 base/key；密钥不进结果/活动流', async () => {
    const activity: ModelActivityV2[] = [];
    const request = hybridRequest({}, { hooks: { onModelActivity: (item) => activity.push(item) } });

    const result = await withFetchMock(phaseHandler(), async (mock) => {
      const output = await runTurnV2(request);
      assert.equal(mock.requests.length, 3);
      assert.deepEqual(mock.requests.map(phaseOf), ['planner_pre', 'story', 'planner_post']);
      assert.deepEqual(urlsOf(mock.requests), [
        `${PLANNER_BASE}/chat/completions`,
        `${STORY_BASE}/chat/completions`,
        `${PLANNER_BASE}/chat/completions`,
      ]);
      assert.deepEqual(authOf(mock.requests), ['Bearer planner-key', 'Bearer story-key', 'Bearer planner-key']);
      assert.deepEqual(modelsOf(mock.requests), ['test-planner-model', 'test-story-model', 'test-planner-model']);
      return output;
    });

    assert.equal(result.state.turn, request.state.turn + 1, '混合端点回合照常提交');
    // secrets 回归：两把 key 都不得出现在返回结果、活动流或回合记录（含三阶段 trace）中。
    const serialized = JSON.stringify({ result, activity });
    assert.ok(!serialized.includes('planner-key'), '结果/活动流不得包含全局 API Key');
    assert.ok(!serialized.includes('story-key'), '结果/活动流不得包含故事独立 API Key');
    assert.ok(!JSON.stringify(result.state.turnRecords ?? []).includes('story-key'));
  });

  it('留空继承：默认三阶段全走全局；base/key 可分别独立继承', async () => {
    // A) 完全不填 story 连接（DEFAULT_SETTINGS 里是空串）→ 与旧行为完全一致
    const globalOnly = makeRequest({ settings: { apiBaseUrl: PLANNER_BASE, apiKey: 'global-key' } });
    await withFetchMock(phaseHandler(), async (mock) => {
      await runTurnV2(globalOnly);
      assert.equal(mock.requests.length, 3);
      for (const recorded of mock.requests) {
        assert.equal(recorded.url, `${PLANNER_BASE}/chat/completions`);
        assert.equal(recorded.headers.Authorization, 'Bearer global-key');
      }
    });

    // B) 只覆盖 story base：URL 用覆盖值，Key 仍继承全局
    const baseOnly = makeRequest({
      settings: { apiBaseUrl: PLANNER_BASE, apiKey: 'global-key', storyApiBaseUrl: STORY_BASE },
    });
    await withFetchMock(phaseHandler(), async (mock) => {
      await runTurnV2(baseOnly);
      assert.equal(mock.requests[1].url, `${STORY_BASE}/chat/completions`);
      assert.equal(mock.requests[1].headers.Authorization, 'Bearer global-key', '未填 story key 时继承全局 key');
      assert.equal(mock.requests[0].url, `${PLANNER_BASE}/chat/completions`);
      assert.equal(mock.requests[2].url, `${PLANNER_BASE}/chat/completions`);
    });

    // C) 只覆盖 story key：URL 仍继承全局，Key 用独立值（planner 不受影响）
    const keyOnly = makeRequest({
      settings: { apiBaseUrl: PLANNER_BASE, apiKey: 'global-key', storyApiKey: 'story-only-key' },
    });
    await withFetchMock(phaseHandler(), async (mock) => {
      await runTurnV2(keyOnly);
      assert.equal(mock.requests[1].url, `${PLANNER_BASE}/chat/completions`);
      assert.equal(mock.requests[1].headers.Authorization, 'Bearer story-only-key');
      assert.equal(mock.requests[0].headers.Authorization, 'Bearer global-key');
      assert.equal(mock.requests[2].headers.Authorization, 'Bearer global-key');
    });
  });

  it('web_search 官方判定只看全局 base，不受 story 覆盖影响', async () => {
    // 全局官方 + story 反代：planner_pre 仍挂 web_search，story 请求发往反代
    const globalOfficial = hybridRequest({
      apiBaseUrl: 'https://api.deepseek.com/v1',
      apiKey: 'ds-key',
      storyApiBaseUrl: 'https://story.example/v1',
      plannerToolsEnabled: true,
      plannerWebSearchEnabled: true,
    });
    await withFetchMock(phaseHandler(), async (mock) => {
      await runTurnV2(globalOfficial);
      assert.deepEqual(toolNamesOf(mock.requests[0]), ['search_story_context', 'web_search']);
      assert.equal(mock.requests[1].url, 'https://story.example/v1/chat/completions');
    });

    // 全局非官方 + story 覆盖官方 deepseek：仍不挂 web_search（判定不看 story 覆盖）
    const storyOfficial = hybridRequest({
      storyApiBaseUrl: 'https://api.deepseek.com/v1',
      storyApiKey: 'ds-key',
      plannerToolsEnabled: true,
      plannerWebSearchEnabled: true,
    });
    await withFetchMock(phaseHandler(), async (mock) => {
      await runTurnV2(storyOfficial);
      assert.deepEqual(toolNamesOf(mock.requests[0]), ['search_story_context']);
      assert.equal(mock.requests[1].url, 'https://api.deepseek.com/v1/chat/completions');
    });
  });

  it('reasoning_effort 按阶段端点判定：pre/post 看全局，story 看覆盖端点', async () => {
    // A) 全局官方 + story 反代：story 不得收到它不认识的 reasoning_effort
    const officialPlanner = hybridRequest({
      apiBaseUrl: 'https://api.deepseek.com/v1',
      apiKey: 'ds-key',
      storyApiBaseUrl: 'https://story.example/v1',
      thinkingMode: 'enabled',
      reasoningEffort: 'high',
    });
    await withFetchMock(phaseHandler(), async (mock) => {
      await runTurnV2(officialPlanner);
      assert.equal(effortOf(mock.requests[0]), 'high', 'planner_pre 用全局官方端点，应发 high');
      assert.equal(effortOf(mock.requests[1]), undefined, 'story 反代不得收到 reasoning_effort');
      assert.equal(effortOf(mock.requests[2]), 'high', 'planner_post 与 planner_pre 一致');
    });

    // B) 全局非官方 + story 覆盖官方：只有 story 发
    const officialStory = hybridRequest({
      storyApiBaseUrl: 'https://api.deepseek.com/v1',
      storyApiKey: 'ds-key',
      thinkingMode: 'enabled',
      reasoningEffort: 'max',
    });
    await withFetchMock(phaseHandler(), async (mock) => {
      await runTurnV2(officialStory);
      assert.equal(effortOf(mock.requests[0]), undefined, '全局非官方：planner 不发 reasoning_effort');
      assert.equal(effortOf(mock.requests[1]), 'max', 'story 覆盖官方端点：应发 max');
      assert.equal(effortOf(mock.requests[2]), undefined);
    });

    // C) zero-change：story 留空时三阶段与旧实现一致（全局官方 → 都发）
    await withFetchMock(phaseHandler(), async (mock) => {
      await runTurnV2(makeRequest({
        settings: {
          apiBaseUrl: 'https://api.deepseek.com/v1',
          apiKey: 'ds-key',
          thinkingMode: 'enabled',
          reasoningEffort: 'low',
        },
      }));
      for (const recorded of mock.requests) {
        assert.equal(effortOf(recorded), 'low');
      }
    });
  });

  it('结算续跑只走全局连接：planner_post 不会使用 story 独立 base/key', async () => {
    const request = hybridRequest();
    let failure: TurnPostFailureV2 | undefined;
    await withFetchMock(
      phaseHandler({
        // 用 400（不可重试）触发结算失败：语义与 500 相同，但不触发传输层重试，测试更快。
        post: () => new Response(JSON.stringify({ error: { message: 'internal error' } }), {
          status: 400,
          headers: { 'content-type': 'application/json' },
        }),
      }),
      async () => {
        try {
          await runTurnV2(request);
        } catch (error) {
          failure = error as TurnPostFailureV2;
        }
      },
    );
    assert.ok(failure instanceof TurnPostFailureV2, 'planner_post 失败应可续跑');

    await withFetchMock(phaseHandler(), async (mock) => {
      const output = await runTurnSettlementV2(request, failure!.partial);
      assert.equal(mock.requests.length, 1, '续跑只重跑一次结算');
      assert.equal(mock.requests[0].url, `${PLANNER_BASE}/chat/completions`);
      assert.equal(mock.requests[0].headers.Authorization, 'Bearer planner-key');
      assert.equal(output.state.turn, request.state.turn + 1);
    });
  });
});

