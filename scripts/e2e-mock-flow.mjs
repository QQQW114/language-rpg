#!/usr/bin/env node
/**
 * 端到端实测：本地 OpenAI 兼容 mock 服务器 + 真实 engine/store。
 *
 * 目的：在没有 API Key、也没有浏览器的情况下，把真实链路整条跑通并观察它对外发的
 * 每一个请求与最终落盘的权威状态。它验证的内容和浏览器里跑一轮是一样的，只是没有 DOM。
 *
 * 覆盖场景：
 *   1. chat 格式三阶段完整回合（含工具调用轮）
 *   2. 真实 store 落盘：turn/revision/history/checkpoint/v3 存档结构
 *   3. 第二轮（多回合累积）与上下文注入（recent 历史、worldFacts）
 *   4. 失败路径：story 被 max_tokens 截断时必须整回合失败且不提交状态
 *   5. 非 2xx 错误透传（429）
 *   6. storyMaxTokens 传递与认证头字段
 *
 * 用法：node scripts/e2e-mock-flow.mjs [--verbose]
 * 产物：test-runs/e2e-mock-report.json（含全部请求/响应留档）
 */
import http from 'node:http';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
// 必须是第一个副作用 import：zustand persist 在模块求值期就要读 localStorage。
import { storageBacking } from './e2e-localstorage-stub.mjs';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const verbose = process.argv.includes('--verbose');
const outDir = path.join(root, 'test-runs');
await mkdir(outDir, { recursive: true });

// ---------- 打包真实源码（用与产品相同的 @ 别名） ----------
await build({
  entryPoints: [path.join(root, 'src/v2/engine.ts'), path.join(root, 'src/v2/store.ts')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  outdir: path.join(outDir, 'e2e-bundle'),
  entryNames: '[name]',
  alias: { '@': path.join(root, 'src') },
  logLevel: 'silent',
});

const engine = await import(pathToFileURL(path.join(outDir, 'e2e-bundle/engine.js')).href);
const store = await import(pathToFileURL(path.join(outDir, 'e2e-bundle/store.js')).href);
const { useGameStoreV2 } = store;
const { runTurnV2 } = engine;

// ---------- mock 服务器 ----------
const requests = [];
let script = [];
let cursor = 0;

function sseChat(contentChunks, extra = {}) {
  const frames = contentChunks.map((c) => `data: ${JSON.stringify({ choices: [{ delta: { content: c } }] })}\n\n`);
  frames.push(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: extra.finishReason ?? 'stop' }] })}\n\n`);
  if (extra.usage) frames.push(`data: ${JSON.stringify({ choices: [], usage: extra.usage })}\n\n`);
  frames.push('data: [DONE]\n\n');
  return frames.join('');
}

function sseChatToolCall(callId, name, argsText) {
  return [
    `data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, id: callId, type: 'function', function: { name, arguments: argsText } }] } }] })}\n\n`,
    `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'tool_calls' }] })}\n\n`,
    'data: [DONE]\n\n',
  ].join('');
}

function nextScripted() {
  const item = script[cursor];
  cursor += 1;
  return item ?? { kind: 'unexpected' };
}

const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', (chunk) => { body += chunk; });
  req.on('end', () => {
    let parsed;
    try { parsed = JSON.parse(body || '{}'); } catch { parsed = { __raw: body }; }
    const record = {
      method: req.method,
      url: req.url,
      authorization: req.headers.authorization,
      contentType: req.headers['content-type'],
      body: parsed,
    };
    requests.push(record);
    if (verbose) console.log(`[mock] ${req.method} ${req.url} model=${parsed.model} stream=${parsed.stream}`);

    const item = nextScripted();
    if (item.kind === 'unexpected') {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: `未预期的第 ${requests.length} 次请求（脚本已耗尽）` } }));
      return;
    }
    if (item.kind === 'httpError') {
      res.writeHead(item.status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: item.message } }));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    if (item.kind === 'toolCall') {
      res.end(sseChatToolCall(item.callId, item.name, item.argumentsText));
      return;
    }
    res.end(sseChat(item.chunks ?? [], item.extra ?? {}));
  });
});

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;
const baseUrl = `http://127.0.0.1:${port}/v1`;
console.log(`[e2e] mock 服务器已启动：${baseUrl}`);

// ---------- 场景数据 ----------
const OUTLINE = {
  id: 'outline-e2e',
  title: '端到端测试故事',
  synopsis: '用于验证链路的故事。',
  tone: '平静',
  worldBookIds: [],
  acts: [{
    id: 'act-1',
    title: '第一幕',
    purpose: '建立局面',
    beats: [{ id: 'beat-1', title: '开端', purpose: '主角进入局面' }],
  }],
};
const BACKGROUND = {
  id: 'bg-e2e',
  name: '测试出身',
  description: '测试用',
  traits: ['谨慎'],
  startItems: ['旧钥匙'],
  startScene: '雨夜的街口，路灯把水洼照成碎金。',
};
const WORLD_FACTS = [{ id: 'wf-1', name: '世界基调', keywords: [], content: '常年阴雨。', alwaysActive: true }];

function settingsFor() {
  return {
    apiBaseUrl: baseUrl,
    apiKey: 'e2e-key',
    storyModel: 'e2e-story',
    plannerModel: 'e2e-planner',
    temperatureStory: 0.7,
    storyMaxTokens: 0,
    plannerContextPreset: 'standard',
    plannerContextTokens: 32_000,
    plannerToolsEnabled: false,
    plannerToolMaxCalls: 2,
    plannerJsonMode: 'disabled',
    thinkingMode: 'auto',
    reasoningEffort: 'high',
    roleInjects: { planner: { enabled: false, text: '' }, story: { enabled: false, text: '' }, post: { enabled: false, text: '' } },
    inputPerspective: 'player',
    stateEditingEnabled: true,
  };
}

const PRE_BRIEF = {
  intent: '主角在街口观察',
  currentAct: 'act-1',
  activeBeatIds: ['beat-1'],
  destinyProgress: '开端',
  pathChange: '',
  reframingNeeded: [],
  reconvergencePlan: '',
  nextStoryFunction: '让主角与环境建立接触',
  writingBrief: '写主角在雨夜街口停下脚步，注意到门廊下有人。',
  hardConstraints: ['不引入超自然元素'],
  creativeSpace: ['门廊下的人可以是陌生人'],
  forbiddenChanges: ['不得改写世界规则'],
  stopBoundary: '主角开口询问之前停下',
  randomEvent: { planned: false, summary: '' },
};

function postPatch(overrides = {}) {
  return {
    schemaVersion: 2,
    commitId: 'COMMIT_ID',
    baseRevision: 0,
    turn: 0,
    roundSummary: '主角在雨夜街口停下，发现门廊下有人。',
    latestProgress: '站在街口，门廊下的人尚未开口。',
    characters: [{ op: 'create', id: 'char-stranger', name: '陌生人', status: 'active', addFacts: ['在门廊下避雨'], reason: '正文明确出现' }],
    relationships: [{ fromId: 'player', toId: 'char-stranger', affinityDelta: 3, label: '初次照面', reason: '双方对视' }],
    inventory: [],
    threads: [{ op: 'create', id: 'thread-rain', title: '雨夜的相遇', kind: 'main', status: 'active', progress: 10, currentStep: '尚未交谈', involvedCharacterIds: ['char-stranger'], reason: '正文建立线索' }],
    facts: [{ op: 'create', subjectId: 'char-stranger', predicate: 'location', value: '门廊下', scope: 'location', stability: 'stable', confidence: 'explicit', keywords: ['门廊', '避雨'], evidenceQuote: '门廊下站着一个人', reason: '长期地点事实' }],
    scene: { id: 'scene-street', name: '雨夜街口', description: '路灯与水洼', time: '夜', weather: '雨' },
    actions: [],
    destiny: { completionEstimate: 8, completionReason: '刚刚开始', currentActId: 'act-1', currentStage: '第一幕', currentPath: '街口', reason: '本轮只建立接触', beatChanges: [{ beatId: 'beat-1', status: 'active', currentPlan: '建立接触', evidenceQuote: '门廊下站着一个人', reason: '开端已展开' }] },
    randomEvent: { handled: false, note: '' },
    ...overrides,
  };
}

const STORY_TEXT = '雨点敲在伞面上，声音细密。林越在街口停下脚步，把伞沿压低了半分——对面门廊下站着一个人，正望着积水的路面。路灯把他的影子拖得很长，风从巷口卷过来，带着潮湿的纸箱气味。林越没急着开口，先把手插进外套口袋，摸到了那枚冰凉的钥匙。';

/** 把 postPatch 的占位符替换成程序会注入的值，得到模型应返回的文本。 */
function postPatchText(overrides = {}, commitId = 'commit-e2e-1', turn = 0) {
  return JSON.stringify(postPatch(overrides))
    .replace('"COMMIT_ID"', `"${commitId}"`)
    .replace('"turn":0', `"turn":${turn}`);
}

// ---------- 报告 ----------
const report = { baseUrl, scenarios: [], requests: [], stateSnapshots: [] };
const checks = [];
function check(name, ok, detail) {
  checks.push({ name, ok, detail });
  console.log(`  ${ok ? '✓' : '✗'} ${name}${ok ? '' : ` — ${detail}`}`);
}

// =====================================================================
// 场景 1：chat 格式完整回合（含一次工具调用轮）
// =====================================================================
console.log('\n[场景 1] chat 格式三阶段完整回合 + 工具调用轮');
script = [
  // planner_pre：先请求工具，再给出 JSON
  { kind: 'toolCall', callId: 'call-1', name: 'search_story_context', argumentsText: JSON.stringify({ query: '门廊', limit: 3 }) },
  { kind: 'text', chunks: [JSON.stringify(PRE_BRIEF)] },
  // story：流式正文
  { kind: 'text', chunks: [STORY_TEXT.slice(0, 10), STORY_TEXT.slice(10)], extra: { usage: { prompt_tokens: 1200, completion_tokens: 80, prompt_cache_hit_tokens: 900 } } },
  // planner_post：结算 JSON（把模板占位符替换成真实值以验证程序注入）
  { kind: 'text', chunks: [postPatchText()], extra: { usage: { prompt_tokens: 1500, completion_tokens: 300 } } },
];
cursor = 0;
const settingsChat = { ...settingsFor(), plannerToolsEnabled: true };
const saveId = useGameStoreV2.getState().create({
  name: 'E2E 旅程', mode: 'adventure', outline: OUTLINE, background: BACKGROUND, worldFacts: WORLD_FACTS,
  randomEvent: { enabled: false },
});
const before = useGameStoreV2.getState().saves[saveId].state;
// 用非零 turn/revision 驱动本轮：否则"替换成功"与"没替换"的文本完全一样，断言无法区分。
const TURN_IN = 5;
const REVISION_IN = 3;
const beforeNonZero = { ...before, turn: TURN_IN, revision: REVISION_IN };
const activities = [];
const phaseChanges = [];
const streamed = [];
const result1 = await runTurnV2({
  state: { ...beforeNonZero, phase: 'generating' },
  input: '我在街口停下，观察门廊下的人。',
  settings: settingsChat,
  outline: OUTLINE,
  background: BACKGROUND,
  worldFacts: WORLD_FACTS,
  onModelActivity: (a) => activities.push(a),
  onPhaseChange: (phase, status) => phaseChanges.push(`${phase}:${status}`),
  onStoryDelta: (t) => streamed.push(t),
});

check('恰好发出 4 次请求（工具轮 + 规划重发 + 故事 + 结算）', requests.length === 4, `实际 ${requests.length}`);
// 第 2 次请求才是"带上工具结果后的规划重发"（第 1 次是原始规划请求）。
const roles1 = requests[0].body.messages.map((m) => m.role);
const roles2 = requests[1].body.messages.map((m) => m.role);
check('第 1 次规划请求无 tool 角色', !roles1.includes('tool'), roles1.join('>'));
check('工具结果以 tool 角色回灌给规划模型', roles2.includes('assistant') && roles2.includes('tool'), roles2.join('>'));
check('tool 消息带 tool_call_id 与 name', (() => {
  const toolMsg = requests[1].body.messages.find((m) => m.role === 'tool');
  return !!toolMsg?.tool_call_id && toolMsg?.name === 'search_story_context';
})(), JSON.stringify(requests[1].body.messages.find((m) => m.role === 'tool')));
check('工具结果包含检索命中（query=门廊）', JSON.stringify(requests[1].body.messages).includes('门廊'), '工具返回未注入');
check('story 请求为流式且带 max_tokens 缺省时不发送', requests[2].body.stream === true && !('max_tokens' in requests[2].body), JSON.stringify({ stream: requests[2].body.stream, max_tokens: requests[2].body.max_tokens }));
check('story 请求带温度设置', Math.abs(requests[2].body.temperature - 0.7) < 1e-9, `实际 ${requests[2].body.temperature}`);
check('请求带 Authorization Bearer', requests[0].authorization === 'Bearer e2e-key', String(requests[0].authorization));
check('planner_post 请求体含 CURRENT_STORY（正文已注入结算）', JSON.stringify(requests[3].body.messages).includes(STORY_TEXT.slice(0, 12)), '未注入正文');
check('planner_post 请求体含真实 TURN_ID（turn:commitId，commitId 由程序生成）', new RegExp(`【TURN_ID】${TURN_IN}:commit_[a-z0-9]+`).test(JSON.stringify(requests[3].body.messages)), 'TURN_ID 未注入');
// 直接固化模板片段用于核对占位替换（曾出现正则匹配不上的假失败）。
// 取到模板结尾为止，而不是固定 260 字符：每回合必变的 baseRevision / turn 现在
// 排在字段说明之后（为了让前面 ~2KB 的字段说明能整段命中前缀缓存），
// 截断前 260 字符会看不到它们。
const postShapeSnippet = (() => {
  const msg = requests[3].body.messages.find((m) => typeof m.content === 'string' && m.content.includes('schemaVersion'));
  const text = msg?.content ?? '';
  const at = text.indexOf('"schemaVersion"');
  const end = text.indexOf('【TURN_ID】');
  return at >= 0 ? text.slice(at, end > at ? end : at + 2600) : '(未找到模板)';
})();
report.postShapeSnippet = postShapeSnippet;
check('planner_post 可变区给出真实 baseRevision', JSON.stringify(requests[3].body.messages).includes(`【baseRevision】${REVISION_IN}`), '未注入 baseRevision');
check('planner_post 可变区给出真实 turn', JSON.stringify(requests[3].body.messages).includes(`【turn】${TURN_IN}`), '未注入 turn');
// 模板必须整段逐字节稳定，否则前缀缓存从变化处失效：里面不得出现任何每回合递增/随机的值。
check('planner_post 模板不含任何每回合变化的值', !/"baseRevision"/.test(postShapeSnippet) && !/"turn"/.test(postShapeSnippet) && !/"commitId"/.test(postShapeSnippet), postShapeSnippet.slice(0, 120));
// 前缀缓存结构：整段模板必须逐字节稳定。
check('planner_post 固定模板里不含每回合变化的 commitId', !/"commitId"/.test(postShapeSnippet) && !postShapeSnippet.includes('COMMIT_ID'), postShapeSnippet.slice(0, 80));
check('planner_post 整段模板体量足够（可复用前缀的主要来源）', postShapeSnippet.length > 1500, `实际 ${postShapeSnippet.length} 字符`);
check('返回状态 turn 递增、revision 递增、phase 回落 input', result1.state.turn === TURN_IN + 1 && result1.state.revision === REVISION_IN + 1 && result1.state.phase === 'input', JSON.stringify({ turn: result1.state.turn, revision: result1.state.revision, phase: result1.state.phase }));
check('history 追加 user + assistant 两条', result1.state.history.length === before.history.length + 2, `实际 ${result1.state.history.length}`);
check('assistant 消息带本轮思维链字段', 'thinking' in result1.state.history[result1.state.history.length - 1], '缺少 thinking');
check('turnRecords 记录 3 个阶段调用', (result1.state.turnRecords?.[0]?.calls ?? []).length === 3, JSON.stringify((result1.state.turnRecords?.[0]?.calls ?? []).map((c) => c.phase)));
// 提交对账统计：让"程序丢了多少条模型输出"变成可长期观察的数字（决定是否要做 id 回显）。
{
  const stats = result1.state.turnRecords?.[0]?.patchStats;
  const totalInput = stats ? Object.values(stats).reduce((sum, v) => sum + (typeof v === 'object' && v ? v.input : 0), 0) : -1;
  const totalApplied = stats ? Object.values(stats).reduce((sum, v) => sum + (typeof v === 'object' && v ? v.applied : 0), 0) : -1;
  check('turnRecord 带提交对账统计，且干净补丁零丢弃', !!stats && totalInput > 0 && totalApplied === totalInput && (stats.characters.blocked + stats.relationships.blocked + stats.inventory.blocked + stats.threads.blocked + stats.facts.blocked) === 0 && stats.coercedEnums === 0, JSON.stringify({ stats, totalInput, totalApplied }));
}
check('patchStats 随存档持久化（不被 partialize 剔除）', !!result1.state.turnRecords?.[0]?.patchStats, JSON.stringify(Object.keys(result1.state.turnRecords?.[0] ?? {})));
check('patch 落盘：人物/关系/线程/事实/场景/命运均提交', result1.state.characters.length === 1 && result1.state.relationships.length === 1 && result1.state.storyThreads.length === 1 && result1.state.facts.length === 1 && result1.state.currentScene?.name === '雨夜街口' && result1.state.destiny.beats[0].status === 'active', JSON.stringify({ c: result1.state.characters.length, r: result1.state.relationships.length, t: result1.state.storyThreads.length, f: result1.state.facts.length, scene: result1.state.currentScene?.name, beat: result1.state.destiny.beats[0].status }));
check('phase 回调按 planner_pre→story→planner_post 各 started/completed', phaseChanges.join(',') === 'planner_pre:started,planner_pre:completed,story:started,story:completed,planner_post:started,planner_post:completed', phaseChanges.join(','));
check('流式增量拼接等于完整正文', streamed.join('') === STORY_TEXT, JSON.stringify(streamed.join('').slice(0, 40)));
check('活动流包含 tool call 与 tool result 事件', activities.filter((a) => a.type === 'tool').length === 2, `实际 ${activities.filter((a) => a.type === 'tool').length}`);
check('活动流包含 usage 事件（供应商给了 usage 的阶段才发射）', activities.filter((a) => a.type === 'usage').length === 2, `实际 ${activities.filter((a) => a.type === 'usage').length}`);

// 诊断：打印每个请求的消息角色序列与关键片段，便于区分"测试脚本问题"与"真 bug"。
if (process.argv.includes('--dump')) {
  requests.forEach((r, index) => {
    const roles = (r.body.messages ?? []).map((m) => m.role).join(' > ');
    console.log(`  [dump] #${index + 1} ${r.url} roles=[${roles}]`);
    for (const m of r.body.messages ?? []) {
      if (typeof m.content === 'string' && m.content.includes('CURRENT_STORY')) {
        const turnId = /【TURN_ID】[^\n]*/.exec(m.content);
        console.log(`  [dump]     TURN_ID = ${turnId ? turnId[0] : '(未找到)'}`);
        console.log(`  [dump]     baseRevision 出现次数 = ${(m.content.match(/"baseRevision"/g) ?? []).length}`);
      }
    }
  });
  console.log(`  [dump] activities = ${JSON.stringify(activities.map((a) => a.type === 'usage' ? `usage:${a.phase}` : a.type === 'tool' ? `tool:${a.status}` : a.type))}`);
}

// ---------- 真实 store 落盘 ----------
const committed = useGameStoreV2.getState().commitSuccessfulTurn(saveId, {
  stateBeforeTurn: before, input: '我在街口停下，观察门廊下的人。', narrativePace: 'standard', nextState: result1.state,
});
const saved = useGameStoreV2.getState().saves[saveId];
check('commitSuccessfulTurn 接受提交', committed === true, String(committed));
check('存档写入 checkpoint（回合前状态）', saved.lastTurnCheckpoint?.stateBeforeTurn.turn === before.turn, JSON.stringify(saved.lastTurnCheckpoint?.stateBeforeTurn.turn));
check('localStorage 中 lrpg.v2 已持久化且不含 checkpoint', (() => {
  const raw = storageBacking.get('lrpg.v2');
  if (!raw) return false;
  const parsed = JSON.parse(raw);
  return !!parsed.state.saves[saveId] && parsed.state.saves[saveId].lastTurnCheckpoint === undefined;
})(), '持久化内容不符合预期');

// 回退验证
const restored = useGameStoreV2.getState().restoreLastTurn(saveId);
check('restoreLastTurn 能回到回合前状态', restored?.stateBeforeTurn.turn === before.turn, JSON.stringify(restored?.stateBeforeTurn.turn));
// 回退后重新提交，保持后续场景有干净起点
useGameStoreV2.getState().commitSuccessfulTurn(saveId, { stateBeforeTurn: before, input: '我在街口停下，观察门廊下的人。', narrativePace: 'standard', nextState: result1.state });

report.scenarios.push({ name: 'chat 完整回合 + 工具轮', requests: requests.length, phaseChanges, activities: activities.length });

// =====================================================================
// 场景 2：第二轮（多回合累积 + 上下文注入）
// =====================================================================
console.log('\n[场景 2] 第二轮：上下文累积与 recent 注入');
requests.length = 0;
script = [
  { kind: 'text', chunks: [JSON.stringify({ ...PRE_BRIEF, intent: '继续对话' })] },
  { kind: 'text', chunks: ['“我在等人。”对方答道，声音被雨声压得很低。林越往前半步，伞面上的水顺着边缘滴下来，在两人之间的地面上敲出一小片深色。门廊里没有灯，只有远处店铺的招牌在雨雾里泛着模糊的红光。'] },
  { kind: 'text', chunks: [postPatchText({ roundSummary: '双方开始交谈。', latestProgress: '已与对方搭上话。', characters: [], relationships: [], threads: [], facts: [], scene: null, destiny: { ...postPatch().destiny, completionEstimate: 12, reason: '继续推进' } }, 'commit-e2e-2', 1)] },
];
cursor = 0;
const stateForTurn2 = useGameStoreV2.getState().saves[saveId].state;
const result2 = await runTurnV2({
  state: { ...stateForTurn2, phase: 'generating' }, input: '我问他在等谁。', settings: settingsChat,
  outline: OUTLINE, background: BACKGROUND, worldFacts: WORLD_FACTS,
});
const plannerBody2 = JSON.stringify(requests[0].body.messages);
const storyBody2 = JSON.stringify(requests[1].body.messages);
check('第二轮规划请求携带 recent 历史（含上一轮正文）', plannerBody2.includes(STORY_TEXT.slice(0, 12)), 'recent 未注入');
check('第二轮规划请求携带权威状态（人物/线程/事实）', plannerBody2.includes('char-stranger') && plannerBody2.includes('thread-rain') && plannerBody2.includes('门廊下'), '结构化状态未注入');
check('第二轮规划请求携带 worldFacts', plannerBody2.includes('常年阴雨'), 'worldFacts 未注入');
check('第二轮故事请求携带 STOP_BOUNDARY 与 writingBrief', storyBody2.includes('STOP_BOUNDARY') && storyBody2.includes('停下脚步'), '写作约束未注入');
check('第二轮 turn 递增、revision 递增', result2.state.turn === result1.state.turn + 1 && result2.state.revision === result1.state.revision + 1, JSON.stringify({ turn: result2.state.turn, revision: result2.state.revision }));
check('随机事件关闭时提示词不含 ---额外---', !plannerBody2.includes('---额外---'), '关闭了随机事件却仍注入指令');
report.scenarios.push({ name: '第二轮累积', requests: requests.length });

// =====================================================================
// 场景 3：失败路径 —— story 被截断必须整回合失败且不提交
// =====================================================================
console.log('\n[场景 3] 失败路径：story 被 max_tokens 截断');
requests.length = 0;
script = [
  { kind: 'text', chunks: [JSON.stringify(PRE_BRIEF)] },
  { kind: 'text', chunks: ['半截正文……'], extra: { finishReason: 'length' } },
];
cursor = 0;
let turnError;
try {
  await runTurnV2({ state: { ...stateForTurn2, phase: 'generating' }, input: '继续。', settings: settingsChat, outline: OUTLINE, background: BACKGROUND, worldFacts: WORLD_FACTS });
} catch (error) { turnError = error; }
check('story 截断时抛错', !!turnError, '未抛错');
check('截断错误信息可读（含"上限/截断"字样）', /上限|截断/.test(String(turnError?.message)), String(turnError?.message));
check('截断时未调用 planner_post（仅 2 次请求）', requests.length === 2, `实际 ${requests.length}`);
report.scenarios.push({ name: 'story 截断', requests: requests.length, error: String(turnError?.message) });

// =====================================================================
// 场景 4：planner_pre 返回非法 JSON
// =====================================================================
console.log('\n[场景 4] 失败路径：planner_pre 返回非法 JSON');
requests.length = 0;
script = [{ kind: 'text', chunks: ['我不打算输出 JSON，这里是散文。'] }];
cursor = 0;
let jsonError;
try {
  await runTurnV2({ state: { ...stateForTurn2, phase: 'generating' }, input: '继续。', settings: settingsChat, outline: OUTLINE, background: BACKGROUND, worldFacts: WORLD_FACTS });
} catch (error) { jsonError = error; }
check('非法 JSON 时抛错', !!jsonError, '未抛错');
check('非法 JSON 时未进入故事阶段（仅 1 次请求）', requests.length === 1, `实际 ${requests.length}`);
report.scenarios.push({ name: 'planner_pre 非法 JSON', requests: requests.length, error: String(jsonError?.message) });

// =====================================================================
// 场景 5：非 2xx 错误透传
// =====================================================================
console.log('\n[场景 6] 供应商返回 429');
requests.length = 0;
script = [{ kind: 'httpError', status: 429, message: 'Rate limit reached' }];
cursor = 0;
let httpError;
try {
  await runTurnV2({ state: { ...stateForTurn2, phase: 'generating' }, input: '继续。', settings: settingsChat, outline: OUTLINE, background: BACKGROUND, worldFacts: WORLD_FACTS });
} catch (error) { httpError = error; }
check('HTTP 429 抛错且错误信息含状态码与供应商原文', /429/.test(String(httpError?.message)) && /Rate limit/.test(String(httpError?.message)), String(httpError?.message));
report.scenarios.push({ name: 'HTTP 429', requests: requests.length, error: String(httpError?.message) });

// =====================================================================
// 场景 6：storyMaxTokens 是否真的生效
// =====================================================================
console.log('\n[场景 6] storyMaxTokens 传递');
requests.length = 0;
script = [
  { kind: 'text', chunks: [JSON.stringify(PRE_BRIEF)] },
  { kind: 'text', chunks: ['正文'] },
  { kind: 'text', chunks: [postPatchText({}, 'commit-tok', 1)] },
];
cursor = 0;
try {
  await runTurnV2({
    state: { ...stateForTurn2, phase: 'generating' }, input: '预算测试。',
    settings: { ...settingsFor(), storyMaxTokens: 4096 },
    outline: OUTLINE, background: BACKGROUND, worldFacts: WORLD_FACTS,
  });
} catch { /* 本场景只看请求字段 */ }
const storyReq = requests[1];
check('storyMaxTokens=4096 被发送为 max_tokens', 'max_tokens' in storyReq.body && storyReq.body.max_tokens === 4096, `story 请求体字段：${Object.keys(storyReq.body).join(', ')}`);
report.scenarios.push({ name: 'storyMaxTokens', body: storyReq.body });

// ---------- 写报告 ----------
report.requests = requests;
report.checks = checks;
report.summary = { total: checks.length, pass: checks.filter((c) => c.ok).length, fail: checks.filter((c) => !c.ok).length };
await writeFile(path.join(outDir, 'e2e-mock-report.json'), JSON.stringify(report, null, 2));
server.close();

console.log(`\n[e2e] 断言 ${report.summary.pass}/${report.summary.total} 通过`);
if (report.summary.fail) {
  console.log('[e2e] 失败项：');
  for (const c of checks.filter((x) => !x.ok)) console.log(`  ✗ ${c.name} — ${c.detail}`);
}
console.log(`[e2e] 报告：test-runs/e2e-mock-report.json`);
process.exit(report.summary.fail ? 1 : 0);
