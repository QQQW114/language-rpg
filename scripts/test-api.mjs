// 端到端测试：Responses 格式 · 流式 + JSON 输出
// 运行：node scripts/test-api.mjs [model]

const BASE = process.env.LRPG_API_BASE || process.env.OPENAI_BASE_URL || 'http://127.0.0.1:8317/v1';
const KEY = process.env.LRPG_API_KEY || process.env.OPENAI_API_KEY || '';
const MODEL = process.argv[2] || process.env.LRPG_TEST_MODEL || 'gpt-5.4-mini';

if (!KEY) {
  console.error('缺少 API Key：请设置 LRPG_API_KEY 或 OPENAI_API_KEY 后再运行 scripts/test-api.mjs');
  process.exit(1);
}

function buildBody(messages, model, temperature) {
  const systems = [];
  const input = [];
  for (const m of messages) {
    if (m.role === 'system') systems.push(m.content);
    else input.push({ role: m.role, content: m.content });
  }
  const body = { model, input, stream: true };
  if (systems.length) body.instructions = systems.join('\n\n');
  if (temperature !== undefined) body.temperature = temperature;
  return body;
}

async function streamAndCollect(messages, temperature, { quiet = false } = {}) {
  const body = buildBody(messages, MODEL, temperature);
  const res = await fetch(`${BASE}/responses`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${KEY}`,
      Accept: 'text/event-stream',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${await res.text()}`);

  const reader = res.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  let full = '';
  const t0 = Date.now();
  let firstAt = -1;

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, idx).replace(/\r$/, '');
      buffer = buffer.slice(idx + 1);
      if (!line.startsWith('data:')) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === '[DONE]') continue;
      try {
        const frame = JSON.parse(payload);
        if (frame.type === 'response.output_text.delta' && typeof frame.delta === 'string') {
          if (firstAt < 0) firstAt = Date.now() - t0;
          full += frame.delta;
          if (!quiet) process.stdout.write(frame.delta);
        } else if (frame.type === 'error' || frame.type === 'response.failed') {
          throw new Error(frame.error?.message ?? frame.response?.error?.message ?? 'response.failed');
        }
      } catch (e) {
        // partial JSON, skip
      }
    }
  }
  return { text: full, ttfb: firstAt, total: Date.now() - t0 };
}

function extractJSON(text) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const cand = fenced ? fenced[1] : text;
  const m = cand.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch { return null; }
}

(async () => {
  console.log(`model=${MODEL}\n`);

  console.log('--- 测试 1：故事流式（主流程）---');
  const r1 = await streamAndCollect([
    { role: 'system', content: '你是一位古风奇幻 TRPG 主持人。用第二人称推进剧情，文笔凝练。' },
    { role: 'user', content: '我独自走进废塔。请在 120 字内写下第一幕，不要问我接下来做什么。' },
  ], 0.9);
  console.log(`\n[TTFB=${r1.ttfb}ms 总耗时=${r1.total}ms 字数=${r1.text.length}]`);
  if (!r1.text.trim()) throw new Error('FAIL: 故事流式无文本');
  console.log('OK ✓\n');

  console.log('--- 测试 2：决策 JSON 输出（含 grants + destroys + npcs + scenes）---');
  const DECISION_SYSTEM = `严格 JSON：{"choices":[{"id":"a","label":"...","hint":"..."}], "grants":[...], "destroys":[...], "npcs":[...], "currentScene":{"name":"...","description":"..."}, "availableScenes":[{"name":"...","description":"..."}]}
currentScene 是玩家当前所在场景；availableScenes 2~4 个可直接前往的相邻场景（不含 currentScene 本身）。其余字段按既有规则。禁止 JSON 外的任何文字。`;
  const r2 = await streamAndCollect([
    { role: 'system', content: DECISION_SYSTEM },
    { role: 'user', content: '故事片段：周六清晨，你在自己的卧室里醒来。阳光已经漫过窗帘缝，楼下传来厨房里锅铲声和妈妈的轻咳。推门而出可以去客厅看电视，或者沿着走廊到厨房。窗外还能望见小院里那棵桂花树。\n上一回合所在场景：卧室\n请按协议输出 JSON。' },
  ], 0.5, { quiet: true });
  console.log(r2.text);
  const obj = extractJSON(r2.text);
  if (!obj || !Array.isArray(obj.choices) || obj.choices.length < 2) {
    throw new Error('FAIL: 决策 JSON 解析失败或选项不足');
  }
  const scenes = obj.availableScenes || [];
  const cur = obj.currentScene;
  if (!cur || !cur.name) throw new Error('FAIL: currentScene 缺失');
  if (!Array.isArray(scenes) || scenes.length < 1) throw new Error('FAIL: availableScenes 不足');
  console.log(`\n[当前场景: ${cur.name} · 可前往: ${scenes.map((s) => s.name).join('、')}]`);
  console.log('OK ✓\n');

  console.log('\n--- 测试 3：随机大纲（JSON）---');
  const RANDOM_OUTLINE_SYSTEM = `你是一位题材全能的 TRPG 故事总设计师。原创一段故事大纲。严格 JSON：{"title":"...","synopsis":"...","acts":["第一幕：...","第二幕：...","第三幕：..."],"tone":"...","coverEmoji":"🎲"}。不要围栏，不要多余文字。`;
  const r3 = await streamAndCollect([
    { role: 'system', content: RANDOM_OUTLINE_SYSTEM },
    { role: 'user', content: '请设计一段全新故事大纲。按协议输出 JSON。' },
  ], 0.95, { quiet: true });
  const o3 = extractJSON(r3.text);
  if (!o3 || !o3.title || !o3.synopsis || !Array.isArray(o3.acts)) {
    console.error('返回：', r3.text);
    throw new Error('FAIL: 随机大纲 JSON 不合规');
  }
  console.log(`OK ✓ 《${o3.title}》${o3.coverEmoji || ''} · ${o3.acts.length} 幕 · tone="${o3.tone || ''}"`);

  console.log('\n--- 测试 4：旅程评分（JSON）---');
  const REVIEW_SYSTEM = `你是 TRPG 裁判。对冒险打分。严格 JSON：{"title":"...","summary":"...","scores":{"narrative":85,"choices":80,"immersion":85,"completion":90},"overall":85,"grade":"A","highlights":["..."],"comment":"..."}。不要围栏。`;
  const r4 = await streamAndCollect([
    { role: 'system', content: REVIEW_SYSTEM },
    { role: 'user', content: '总回合 5。角色：流亡贵族。玩家经历：夜袭逃亡、林中迷路、遇见猎人、得到地图、最终抵达边境。请打分。' },
  ], 0.4, { quiet: true });
  const o4 = extractJSON(r4.text);
  if (!o4 || !o4.scores || typeof o4.overall !== 'number') {
    console.error('返回：', r4.text);
    throw new Error('FAIL: 评分 JSON 不合规');
  }
  console.log(`OK ✓ 综合 ${o4.overall} (${o4.grade}) · 4 维 ${JSON.stringify(o4.scores)}`);

  console.log('\n--- 测试 5：随机事件池 ---');
  const RANDOM_EVENTS_SYSTEM = `严格 JSON：{"events":[{"name":"...","directive":"...","probability":0.1,"minRound":3,"cooldown":15,"once":false}]}。5~8 条契合题材的事件。directive 60~140 字描述要发生什么。禁止围栏。`;
  const r5 = await streamAndCollect([
    { role: 'system', content: RANDOM_EVENTS_SYSTEM },
    { role: 'user', content: '故事：《第七次夏日》·青春恋爱治愈·高二暑假海边小镇。玩家出身：高中生，带着玻璃风铃。请为此设计 6 条随机事件。' },
  ], 0.9, { quiet: true });
  const o5 = extractJSON(r5.text);
  if (!o5 || !Array.isArray(o5.events) || o5.events.length < 3) {
    console.error('返回：', r5.text);
    throw new Error('FAIL: 随机事件 JSON 不合规');
  }
  console.log(`OK ✓ ${o5.events.length} 条事件：${o5.events.map((e) => e.name).join('、')}`);

  console.log('\n--- 测试 6：随机世界书 ---');
  const RANDOM_WORLDBOOK_SYSTEM = `严格 JSON：{"name":"...","description":"...","entries":[{"name":"...","keywords":["..."],"content":"...","priority":90,"alwaysActive":true}]}。首条目必须 alwaysActive:true + keywords 空数组，其余 alwaysActive:false 关键词触发。共 5~8 条。禁止围栏。`;
  const r6 = await streamAndCollect([
    { role: 'system', content: RANDOM_WORLDBOOK_SYSTEM },
    { role: 'user', content: '请设计一份"低魔武侠"题材的世界书，7 条条目。按协议输出 JSON。' },
  ], 0.85, { quiet: true });
  const o6 = extractJSON(r6.text);
  if (!o6 || !o6.name || !Array.isArray(o6.entries) || o6.entries.length < 3) {
    console.error('返回：', r6.text);
    throw new Error('FAIL: 世界书 JSON 不合规');
  }
  console.log(`OK ✓ 《${o6.name}》· ${o6.entries.length} 条：${o6.entries.map((e) => e.name).join('、')}`);

  console.log('\n全部测试通过 ✓✓');
})().catch((e) => { console.error('\n[FAIL]', e.message); process.exit(1); });
