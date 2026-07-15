#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';

const args = Object.fromEntries(process.argv.slice(2).map((x) => {
  const [k, ...rest] = x.replace(/^--/, '').split('='); return [k, rest.length ? rest.join('=') : true];
}));
const baseUrl = String(process.env.LRPG_API_BASE || process.env.OPENAI_BASE_URL || '').replace(/\/+$/, '');
const apiKey = process.env.LRPG_API_KEY || process.env.OPENAI_API_KEY || '';
const plannerModel = String(args.planner || process.env.LRPG_PLANNER_MODEL || process.env.LRPG_TEST_MODEL || 'deepseek-chat');
const storyModel = String(args.story || process.env.LRPG_STORY_MODEL || process.env.LRPG_TEST_MODEL || plannerModel);
const mode = args.mode === 'adventure' ? 'adventure' : 'author';
const preset = String(args.preset || 'default');
const requestedMaxTokens = Number(args['max-tokens'] || process.env.LRPG_TEST_MAX_TOKENS || 0);
const maxTokens = Number.isFinite(requestedMaxTokens) && requestedMaxTokens > 0
  ? Math.max(256, Math.min(384000, Math.floor(requestedMaxTokens)))
  : undefined;
const dryRun = args['dry-run'] === true || !baseUrl || !apiKey;
const endpoint = `${baseUrl}/chat/completions`;
const callLogs = [];
const paceMap = {
  slow: '慢叙事：细致描写动作、感受与短时间对话，本轮只推进一个很小的故事节拍。',
  standard: '标准叙事：完整推进玩家的一次主要行动或一个主要场景。',
  fast: '快叙事：以事件发展为单位，可完成一组直接相关的行动，但保留关键互动和变化。',
  timeskip: '时间跨越叙事：允许跨越数天或更久，概述重复日常，重点写命运节点、关系变化与关键结果。',
};

const builtInInputs = preset === 'misplaced-youth'
  ? ['我在脑中拼命想着：如果我是女孩子就好了。', '门锁被保洁打开后，我低着头走出去，先观察门外女生和保洁的反应。', '离开女厕后，我找一处没人的楼梯间，检查学生证和手机里的学籍信息。', '确认能力规则后，我先恢复成曦宇，再返回404男生宿舍。']
  : mode === 'author'
  ? ['我先观察房间和在场的人，不急着行动。', '我走向窗边，试探着询问小晴昨晚究竟发生了什么。', '我决定暂时相信她，但要求她把钥匙交给我保管。']
  : ['谨慎观察四周', '与最值得信任的人交谈', '检查刚刚获得的物品'];

async function loadInputs() {
  if (!args.inputs) return builtInInputs;
  const text = await fs.readFile(path.resolve(String(args.inputs)), 'utf8');
  return text.split(/\r?\n/).map((x) => x.trim()).filter((x) => x && !x.startsWith('#'));
}

function parsePacedInput(raw) {
  const match = String(raw).match(/^\[(slow|standard|fast|timeskip)\]\s*(.+)$/s);
  return match ? { pace: match[1], input: match[2].trim() } : { pace: 'standard', input: String(raw) };
}

const state = preset === 'misplaced-youth' ? {
  schemaVersion: 2, revision: 0, turn: 0, mode, narrativePace: 'standard',
  summary: '现代中国普通大学。曦宇因内急误入女厕，正躲在隔间；女生准备叫保洁开锁。除曦宇的“错位”能力外不存在其他超自然力量。', latestProgress: '',
  scene: { id: 'scene-toilet', name: '教学楼三楼女厕隔间', time: '白天', weather: '室内' },
  characters: [], relationships: [], facts: [],
  inventory: [{ id: 'student-card', name: '学生证', quantity: 1, kind: 'quest_item' }, { id: 'phone', name: '旧手机', quantity: 1, kind: 'item' }, { id: 'dorm-card', name: '宿舍门禁卡', quantity: 1, kind: 'quest_item' }],
  threads: [{ id: 'thread-awakening', title: '女厕危机与能力觉醒', kind: 'main', status: 'active', currentStep: '在保洁开锁前脱险', involvedCharacterIds: [], updatedAtTurn: 0 }], history: [], actions: [],
  background: '曦宇，男，大一新生，半个社恐宅男，长相普通、低存在感；喜欢计算机、女装和百合作品。当前是大一上学期。',
  outline: {
    title: '错位青春',
    longTermGoal: '通过双身份并行的校园生活，让曦宇从慌乱、好奇和被动应付，成长为能够驾驭两套社会关系的同一个自己；校园日常不少于75%，恋爱低于25%。',
    acts: [
      '第一幕觉醒：女厕危机中能力显形，脱险并试探边界。',
      '第二幕成长：双身份并行，女生社交从零搭起，逐渐学会斡旋两边关系。',
      '第三幕重逢：高中初恋夕晴转入同校，经历接近、误会、揭穿和坦白后进入互助恋爱日常。'
    ]
  },
  destiny: { completion: 0, currentStage: '第一幕·觉醒', currentPath: '女厕危机', nextMilestone: '完成能力觉醒并开始双身份生活', convergencePlan: '从危机脱身后逐步建立两套社会关系', updatedAtTurn: 0 },
  randomEvent: { nextTriggerTurn: 3, pending: false, intensity: 'related' },
  worldFacts: [
    '纯现实大学校园，除主角外没有其他超自然力量；基调轻松治愈、校园日常，不转悬疑惊悚。',
    '错位能力由明确念头触发，无咒语、无手势、无冷却、无副作用；翻转生理性别、顶流外貌、声音与身份信息，但不修改任何人的记忆印象。再次发动可无损还原。',
    '主角男生身份固定为曦宇，女生身份固定为曦雨；是同一个人，不是第二人格。',
    '觉醒核心节点必须是内急走错女厕、女生叫保洁、保洁开锁；主角在危机中获得完整能力使用记忆并变成女生。',
    '主角住404男生宿舍。'
    ,'身份信息翻转不创造女生人生经历，不产生旧课堂记忆、旧聊天记录、旧朋友关系或女生宿舍生活。'
    ,'目击曦宇进入女厕的人仍记得男生进入；看到曦雨从同一隔间出来时应当困惑。'
    ,'曦雨的宿舍登记仍指向原本404男生宿舍，不生成女生宿舍床位。学生证、门禁卡和手机身份显示原地翻转，不复制两套证件；恢复后同步恢复。'
    ,'主角是大一新生，半个社恐宅男、低存在感，喜欢计算机、女装和百合作品；双身份是同一个人在不同社交角色中的伸展。'
    ,'长期目标：双身份并行运行，曦宇保留原本学业和男生侧生活，曦雨的社交关系从零建立；主角逐步学会驾驭两套社会关系。'
    ,'404是四人男寝。三名舍友长期定位分别为：仗义且逐渐最铁；嘴碎爱八卦、人品偏自私且第三幕会成为揭穿者；话少、靠谱、知心。姓名与外貌可补全，但定位不可互换。'
    ,'夕晴是主角高中初恋，曾在低谷期帮助主角，后来出国失联；只在第三幕转入本校。前期不得无铺垫强行让她登场。'
  ]
} : {
  schemaVersion: 2, revision: 0, turn: 0, mode, summary: '主角在陌生房间醒来，小晴神色紧张，桌上放着一把旧钥匙。', latestProgress: '',
  scene: { id: 'scene-room', name: '陌生房间', time: '清晨', weather: '阴雨' },
  characters: [{ id: 'char-xiaoqing', name: '小晴', aliases: [], role: '熟人', status: 'active', knownFacts: ['昨晚曾与主角同行'], firstSeenTurn: 0, lastSeenTurn: 0 }],
  relationships: [{ id: 'rel-player-xiaoqing', fromId: 'player', toId: 'char-xiaoqing', affinity: 10, label: '尚可信任', updatedAtTurn: 0 }],
  inventory: [], facts: [], threads: [{ id: 'thread-last-night', title: '昨晚发生了什么', kind: 'main', status: 'active', currentStep: '向小晴查证', involvedCharacterIds: ['char-xiaoqing'], updatedAtTurn: 0 }], history: [], actions: [],
};

const plannerSystem = `你是命运驱动互动故事的规划 Agent，只输出严格JSON。玩家既是主角也是共同作者；不要机械拒绝偏离路线的行动。世界书决定行动如何在世界内实现，长期大纲决定核心人物成长与设定结局最终抵达。玩家改变地点或路线后，规划关键人物、矛盾和事件功能如何自然迁移并重新汇合，不要强塞角色，不要强拉回旧地点。写后只结算CURRENT_STORY实际发生的内容，不得引用其他回合冲突。所有状态数组均为增量Patch。facts必须是结构化对象，禁止字符串。`;
const storySystem = `你是命运驱动互动故事的故事 Agent，只写中文小说正文。玩家是共同作者，应真实承接其行动；世界书决定行动的合理结果，不负责机械拒绝。路径可以改变，但核心命运、人物成长和设定结局应通过新路径继续推进。严格遵守世界硬规则和已确认事实，不得把记录变化扩写成记忆、关系或人生经历变化。遵守本轮叙事速度和停止边界。`;

async function chat(model, messages, temperature = 0.3, phase = 'unknown') {
  if (dryRun) return model === storyModel ? '【dry-run】雨声敲着窗。小晴没有立刻回答，只把视线落向桌上的旧钥匙。' : '{}';
  if (args.debug) console.error('\n[debug request]\n', JSON.stringify({ model, temperature, maxTokens: maxTokens ?? null, messages }, null, 2));
  let res;
  let lastError;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      res = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` }, body: JSON.stringify({ model, messages, temperature, ...(maxTokens ? { max_tokens: maxTokens } : {}), stream: false }) });
      break;
    } catch (error) {
      lastError = error;
      if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 1500 * (attempt + 1)));
    }
  }
  if (!res) throw lastError || new Error('模型请求未返回响应');
  const body = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${body.slice(0, 1000)}`);
  const json = JSON.parse(body); const message = json.choices?.[0]?.message || {};
  callLogs.push({ phase, model, messages, reasoning: message.reasoning_content || '', content: message.content || '', finishReason: json.choices?.[0]?.finish_reason, usage: json.usage });
  if (args.debug) console.error('\n[debug message]\n', JSON.stringify({ content: message.content, reasoning_content: message.reasoning_content, finish_reason: json.choices?.[0]?.finish_reason }, null, 2));
  const content = message.content || message.reasoning_content || '';
  if (!content) throw new Error(`模型返回空内容：${JSON.stringify(json).slice(0, 1200)}`);
  return content;
}

function extractJSON(text) {
  const clean = String(text).replace(/```(?:json)?/gi, '').replace(/```/g, '').trim();
  try { return JSON.parse(clean); } catch {}
  const start = clean.indexOf('{'), end = clean.lastIndexOf('}');
  if (start >= 0 && end > start) return JSON.parse(clean.slice(start, end + 1));
  throw new Error(`无法解析 JSON：${clean.slice(0, 500)}`);
}

async function parseOrRepair(model, raw, phase) {
  try { return extractJSON(raw); } catch (firstError) {
    const repaired = await chat(model, [
      { role: 'system', content: '你是JSON修复器。只输出修复后的严格JSON，不解释，不添加原文不存在的事实。' },
      { role: 'user', content: `阶段：${phase}\n以下JSON存在语法错误，请仅修复括号、逗号、引号和截断结构：\n${raw}` },
    ], 0, `${phase}-json-repair`);
    try { return extractJSON(repaired); } catch (secondError) {
      throw new Error(`${phase} JSON首次解析失败：${firstError.message}；修复后仍失败：${secondError.message}`);
    }
  }
}

function applyPatch(patch) {
  for (const row of patch.relationships || []) {
    const rel = state.relationships.find((x) => x.fromId === row.fromId && x.toId === row.toId); if (rel) rel.affinity = Math.max(-100, Math.min(100, rel.affinity + Math.max(-20, Math.min(20, Number(row.affinityDelta) || 0))));
  }
  for (const row of patch.inventory || []) {
    if (row.op === 'grant' && row.name) state.inventory.push({ id: row.id || `item-${Date.now()}`, name: row.name, quantity: Math.max(1, Number(row.quantity) || 1), kind: row.kind || 'item' });
  }
  if (patch.scene?.name) state.scene = { ...state.scene, ...patch.scene };
  for (const row of patch.facts || []) {
    if (!row.subjectId || !row.predicate || !row.value || row.confidence === 'inferred') continue;
    const old = state.facts.find((x) => x.subjectId === row.subjectId && x.predicate === row.predicate);
    if (!old) state.facts.push({ id: row.id || `fact-${Date.now()}-${state.facts.length}`, ...row, confidence: 'explicit', evidenceTurn: state.turn });
    else if (old.value !== row.value && row.op === 'replace' && row.reason && row.evidenceQuote) Object.assign(old, row, { evidenceTurn: state.turn });
  }
  state.summary = String(patch.roundSummary || state.summary).slice(0, 5000);
  state.latestProgress = String(patch.latestProgress || '').slice(0, 500);
  if (patch.destiny && patch.destiny.reason) {
    state.destiny.completion = Math.max(0, Math.min(100, state.destiny.completion + Math.max(0, Number(patch.destiny.completionDelta) || 0)));
    for (const key of ['currentStage','currentPath','nextMilestone','convergencePlan']) if (patch.destiny[key]) state.destiny[key] = String(patch.destiny[key]);
    state.destiny.updatedAtTurn = state.turn;
  }
  state.actions = mode === 'adventure' && Array.isArray(patch.actions) ? patch.actions.slice(0, 4) : [];
  state.revision++; state.turn++;
}

const inputs = await loadInputs();
const report = { startedAt: new Date().toISOString(), dryRun, mode, plannerModel, storyModel, turns: [], errors: [] };
for (const rawInput of inputs) {
  const paced = parsePacedInput(rawInput);
  const input = paced.input;
  state.narrativePace = paced.pace;
  const callLogStart = callLogs.length;
  const snapshot = JSON.stringify({ ...state, history: state.history.slice(-6) });
  const hardRules = JSON.stringify(state.worldFacts ?? []);
  try {
    const preRaw = await chat(plannerModel, [{ role: 'system', content: plannerSystem }, { role: 'user', content: `【HARD_RULES】${hardRules}\n【权威状态】${snapshot}\n【玩家输入】${input}\n【叙事速度】${paceMap[paced.pace]}\n只输出 {"intent":"","destinyProgress":"","pathChange":"","reconvergencePlan":"","writingBrief":"","hardConstraints":[],"creativeSpace":[],"forbiddenChanges":[],"stopBoundary":""}` }], 0.3, 'planner-pre');
    const pre = dryRun ? { intent: input, writingBrief: `围绕“${input}”写一个克制的微节拍`, mustRespect: [], stopBoundary: '停在玩家需要回应的位置' } : await parseOrRepair(plannerModel, preRaw, '写前规划');
    const story = await chat(storyModel, [{ role: 'system', content: storySystem }, { role: 'user', content: `【HARD_RULES】${hardRules}\n【权威状态】${snapshot}\n【玩家输入】${input}\n【叙事速度】${paceMap[paced.pace]}\n【命运进展】${pre.destinyProgress || ''}\n【路径变化】${pre.pathChange || ''}\n【汇合规划】${pre.reconvergencePlan || ''}\n【writingBrief】${pre.writingBrief}\n【hardConstraints】${JSON.stringify(pre.hardConstraints || [])}\n【forbiddenChanges】${JSON.stringify(pre.forbiddenChanges || [])}\n【停止边界】${pre.stopBoundary}` }], 0.85, 'story');
    const postRaw = await chat(plannerModel, [{ role: 'system', content: plannerSystem }, { role: 'user', content: `【TURN_ID】${state.turn}\n【HARD_RULES】${hardRules}\n【结算前权威状态】${JSON.stringify(state)}\n【CURRENT_TURN_INPUT】${input}\n【写前计划】${JSON.stringify(pre)}\n【CURRENT_STORY】${story}\n只记录本轮正文实际发生的变化。偏离路线不是冲突。facts禁止字符串，必须使用op/subjectId/predicate/value/scope/stability/confidence/keywords/evidenceQuote。严格输出 {"roundSummary":"","latestProgress":"","characters":[],"relationships":[],"inventory":[],"threads":[],"facts":[],"scene":null,"actions":[],"uncertainties":[],"destiny":{"completionDelta":0,"currentStage":"","currentPath":"","nextMilestone":"","convergencePlan":"","reason":""},"randomEvent":{"handled":false,"note":""},"canonCheck":{"respectedFacts":[],"newInferences":[],"conflicts":[],"stopBoundaryViolated":false}}。` }], 0.2, 'planner-post');
    const post = dryRun
      ? { roundSummary: story, latestProgress: '完成一次测试回合', relationships: [], inventory: [], actions: mode === 'adventure' ? [{ id: 'a', label: '继续观察' }, { id: 'b', label: '主动询问' }] : [] }
      : await parseOrRepair(plannerModel, postRaw, '写后结算');
    applyPatch(post); state.history.push({ role: 'user', content: input, turn: state.turn - 1 }, { role: 'assistant', content: story, turn: state.turn - 1 });
    const turnCalls = callLogs.slice(callLogStart);
    const pick = (phase) => turnCalls.find((x) => x.phase === phase) || {};
    report.turns.push({ turn: state.turn, input, pre, story, post, state: structuredClone(state), trace: { hardRules, snapshot, calls: turnCalls }, review: {
      playerAction: input,
      plannerPreReasoning: pick('planner-pre').reasoning || '',
      plannerPreOutput: pick('planner-pre').content || preRaw,
      storyReasoning: pick('story').reasoning || '',
      storyOutput: pick('story').content || story,
      plannerPostReasoning: pick('planner-post').reasoning || '',
      plannerPostOutput: pick('planner-post').content || postRaw,
    } });
    process.stdout.write(`\n[turn ${state.turn}] ${input}\n${story}\n`);
  } catch (error) { report.errors.push({ turn: state.turn, input, error: error.message }); console.error(`\n[失败] ${error.message}`); break; }
}
report.finishedAt = new Date().toISOString(); report.finalState = state;
await fs.mkdir('test-runs', { recursive: true });
const output = path.resolve(String(args.output || `test-runs/story-flow-${Date.now()}.json`));
await fs.writeFile(output, JSON.stringify(report, null, 2));
console.log(`\n报告：${output}`); console.log(`结果：${report.errors.length ? '失败' : '通过'}，完成 ${report.turns.length}/${inputs.length} 回合${dryRun ? '（dry-run；未发现 API 配置）' : ''}`);
if (report.errors.length) process.exitCode = 1;
