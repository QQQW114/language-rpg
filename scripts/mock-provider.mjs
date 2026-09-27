/**
 * 常驻的 OpenAI 兼容 mock 供应商，供**浏览器冒烟测试**使用。
 *
 * 与 `scripts/e2e-mock-flow.mjs` 的区别：那个是"跑完一次断言就退出"的测试驱动，
 * 这个是监听固定端口、按阶段返回可用内容的长驻服务，便于在真实界面里点按钮
 * 验证滚动、闪烁、草稿保留与侧边栏更新特效。
 *
 * 用法：node scripts/mock-provider.mjs [port]
 *   然后在设置页把 API Base 指向 http://127.0.0.1:<port>/v1，模型名随便填。
 *
 * 每个阶段返回的内容会让侧边栏**稳定地发生变化**：
 *   第 1 轮新增一个人物与一条线程；第 2 轮改人物状态并推进线程；第 3 轮新增物品与事实。
 * 这样四种特效（新块轮廓、斜线扫过、星星、内容更新）都能被观察到。
 */
import http from 'node:http';

const port = Number(process.argv[2] ?? 8791);

const now = () => new Date().toISOString().slice(11, 19);
let turn = 0;

const PLANNER_PRE = {
  intent: '承接玩家行动并推进一小步',
  currentAct: 'act-1',
  activeBeatIds: ['beat-1-1'],
  destinyProgress: '仍在第一幕，日常刚被打破。',
  pathChange: '',
  reframingNeeded: [],
  reconvergencePlan: '',
  nextStoryFunction: '让主角意识到自己的能力有代价',
  writingBrief: '主角在雨夜的街口与阿黎交谈，透露一点来意，但不要一次说完。',
  hardConstraints: ['不得让阿黎直接说出地点', '保持现实基调'],
  creativeSpace: ['可以加入雨声与霓虹'],
  forbiddenChanges: ['不得改变阿黎的身份'],
  stopBoundary: '阿黎说出一个地名后停笔',
  randomEvent: { planned: false, summary: '' },
};

/** 按轮次变化的人物，用来触发"新块"与"更新"两种特效。 */
function characters() {
  if (turn === 0) {
    return [{ op: 'create', id: 'char-ali', name: '阿黎', status: 'active', role: '旧识', description: '雨夜里出现的老熟人', addFacts: ['住在城南'], reason: '正文中阿黎登场' }];
  }
  if (turn === 1) {
    return [{ op: 'update', id: 'char-ali', status: 'absent', description: '雨夜里出现的老熟人，说完地名便离开', reason: '正文中阿黎离开' }];
  }
  return [{ op: 'create', id: 'char-shen', name: '沈砚', status: 'active', role: '陌生来客', description: '在巷口等着的陌生人', reason: '正文中沈砚登场' }];
}

function patch(commitId, baseRevision, turnNumber) {
  return {
    schemaVersion: 2,
    commitId,
    baseRevision,
    turn: turnNumber,
    roundSummary: `第 ${turnNumber + 1} 回合：主角与阿黎在雨夜街口交换了几句话，线索指向城北。`,
    latestProgress: '雨夜街口谈话结束，主角得到了一个地名。',
    characters: characters(),
    relationships: turn === 0 ? [{ fromId: 'player', toId: 'char-ali', affinityDelta: 3, label: '旧识', reason: '正文中双方重新搭上话' }] : [],
    inventory: turn === 2
      ? [{ op: 'grant', id: 'item-map', name: '半张旧地图', kind: 'quest_item', quantity: 1, description: '边角被雨浸软的地图，只画了城北一片', consumable: false, reason: '正文中沈砚递过来' }]
      : turn === 0 ? [{ op: 'grant', id: 'item-umbrella', name: '黑色折伞', kind: 'item', quantity: 1, description: '阿黎塞给主角的旧伞', consumable: false, reason: '正文中阿黎借伞' }] : [],
    threads: turn === 0
      ? [{ op: 'create', id: 'thread-north', title: '城北的地名', kind: 'quest', status: 'active', progress: 15, currentStep: '刚得到地名', involvedCharacterIds: ['char-ali'], reason: '正文中阿黎说出地名' }]
      : [{ op: 'update', id: 'thread-north', progress: turn === 1 ? 45 : 70, currentStep: turn === 1 ? '准备动身' : '已在地图边缘找到入口', reason: '正文推进线索' }],
    facts: turn === 2
      ? [{ op: 'create', subjectId: 'char-shen', predicate: 'knows', value: '城北入口的位置', scope: 'character', stability: 'stable', confidence: 'explicit', keywords: ['城北', '入口'], evidenceQuote: '沈砚用指节敲了敲地图上被雨泡软的那一角。', reason: '正文明确给出' }]
      : [],
    scene: { id: 'scene-street', name: turn === 2 ? '城北巷口' : '雨夜街口', description: '霓虹在水洼里碎成几片，风把雨吹成斜线。', time: '深夜', weather: '雨' },
    actions: turn === 0
      ? [{ id: 'act-1', label: '跟着阿黎走', hint: '她似乎知道更多' }, { id: 'act-2', label: '先回住处', hint: '把伞还回去再说' }]
      : [],
    destiny: {
      completionEstimate: 12 + turn * 9,
      completionReason: '已满足：日常被打破、线索出现。仍缺少：能力代价与真正的选择。',
      currentActId: 'act-1',
      currentStage: '第一幕 · 日常被打破',
      currentPath: '沿城北线索推进',
      nextMilestone: '让主角第一次为能力付出代价',
      convergencePlan: '',
      endingReached: false,
      reason: '本轮推进了线索线程',
      beatChanges: [{ beatId: 'beat-1-1', status: 'satisfied', currentPlan: '雨夜相遇已发生', evidenceSummary: '主角在街口与阿黎完成第一次交谈', evidenceQuote: '阿黎压低声音，说出了一个地名。', replacementBeatId: '', reason: '正文已实现该故事节' }],
    },
    randomEvent: { handled: false, note: '' },
  };
}

const STORY = [
  '雨把街灯的轮廓泡得发胀。曦宇把外套领子竖起来，站在屋檐下，看阿黎从对面走过来，伞沿压得很低。\n\n“你还在查那件事？”她没抬头，声音被雨声削掉一半。\n\n“嗯。”\n\n阿黎沉默了两秒，忽然把伞往他那边倾了倾：“城北。你去过城北的老粮库吗？”\n\n她说完就把伞塞进他手里，转身走进雨里，脚步很快，像是怕自己反悔。',
  '第二天他没有去上课。\n\n伞还立在门后，伞骨上凝着一层水汽。曦宇在纸上把“城北”“老粮库”两个词圈起来，又划掉，最后只留下一个箭头，指向地图的边缘。\n\n他意识到自己其实并不怕那个地名。他怕的是——自己已经开始为一件还没发生的事做准备。\n\n出门前，他把伞带上了。',
  '城北的巷口比想象中安静。路灯坏了一盏，另一盏在风里晃。\n\n有人靠墙站着，手里捏着一张纸。见曦宇走近，那人把纸递过来——半张地图，边角被雨浸软，只画了城北一片。\n\n“你要找的地方在这儿。”沈砚用指节敲了敲被雨泡软的那一角，“不过进去之前，你最好先想清楚，你为什么要进去。”',
];

function usage(promptTokens, completionTokens, hit) {
  return {
    prompt_tokens: promptTokens,
    completion_tokens: completionTokens,
    total_tokens: promptTokens + completionTokens,
    prompt_cache_hit_tokens: hit,
    prompt_cache_miss_tokens: Math.max(0, promptTokens - hit),
  };
}

function sse(res, { content, reasoning, usage: usagePayload }) {
  res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache', connection: 'keep-alive' });
  const push = (payload) => res.write(`data: ${JSON.stringify(payload)}\n\n`);
  if (reasoning) push({ choices: [{ index: 0, delta: { reasoning_content: reasoning } }] });
  const chunks = String(content).match(/[\s\S]{1,24}/g) ?? [''];
  for (const chunk of chunks) push({ choices: [{ index: 0, delta: { content: chunk } }] });
  if (usagePayload) push({ choices: [{ index: 0, delta: {} }], usage: usagePayload });
  push({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] });
  res.write('data: [DONE]\n\n');
  res.end();
}

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers': '*',
  'access-control-max-age': '600',
};

const server = http.createServer((req, res) => {
  // 浏览器从 dev server（另一个端口）发请求，属跨源；没有这几个头就会被
  // 浏览器直接拦掉，表现成 `Failed to fetch`。
  for (const [key, value] of Object.entries(CORS)) res.setHeader(key, value);
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }
  if (req.method === 'GET') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ object: 'list', data: [{ id: 'mock-model', object: 'model' }] }));
    return;
  }
  let body = '';
  req.on('data', (chunk) => { body += chunk; });
  req.on('end', () => {
    let parsed;
    try { parsed = JSON.parse(body); } catch { parsed = {}; }
    const messages = parsed.messages ?? [];
    const system = String(messages.find((m) => m.role === 'system')?.content ?? '');
    const phase = system.includes('写前规划') ? 'planner_pre' : system.includes('写后审计') ? 'planner_post' : 'story';
    const promptTokens = 6000 + turn * 900;
    const hit = turn === 0 ? 0 : 4200;
    console.log(`[${now()}] turn=${turn} phase=${phase} model=${parsed.model} stream=${!!parsed.stream}`);

    if (phase === 'planner_post') {
      const commitId = /【TURN_ID】\d+:([a-z0-9_]+)/.exec(String(messages.at(-1)?.content ?? ''))?.[1] ?? 'commit_mock';
      const text = JSON.stringify(patch(commitId, 2 + turn, turn + 1));
      sse(res, { content: text, reasoning: '先确认本轮正文实际发生了什么，再逐字段给出增量。', usage: usage(promptTokens, 1800 + turn * 200, hit) });
      return;
    }
    if (phase === 'story') {
      sse(res, { content: STORY[turn % STORY.length], reasoning: '按写作要求写这一段，停在边界处。', usage: usage(promptTokens, 1500, hit) });
      return;
    }
    sse(res, { content: JSON.stringify(PLANNER_PRE), reasoning: '读一下当前状态与玩家意图，给出本回合的写作约束。', usage: usage(promptTokens, 900, hit) });
    turn += 1;
  });
});

server.listen(port, '127.0.0.1', () => {
  console.log(`[mock-provider] listening on http://127.0.0.1:${port}/v1`);
  console.log('[mock-provider] 在设置页把 API Base 指向该地址即可（模型名任意）。');
});
