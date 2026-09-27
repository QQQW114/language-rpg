#!/usr/bin/env node
/**
 * 存档体积实测：多回合跑下来 lrpg.v2 会长到多大、什么时候会撞上 localStorage 配额。
 *
 * 背景：V2 把 history、turnRecords（每回合含三阶段完整提示词留档）与全部权威状态
 * 一起写进单个 localStorage 键。这里用真实 engine + store 在多回合中测量实际增长：
 *   - 每回合的字节增量
 *   - history / turnRecords / 结构化状态各占多少
 *   - 按当前增长率推算何时触及 5MB（浏览器常见上限）
 *
 * 用法：node scripts/e2e-storage-growth.mjs [回合数，默认 25]
 */
import http from 'node:http';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { storageBacking } from './e2e-localstorage-stub.mjs';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const turns = Number(process.argv[2] || 25);
const outDir = path.join(root, 'test-runs');
await mkdir(outDir, { recursive: true });

await build({
  entryPoints: [path.join(root, 'src/v2/engine.ts'), path.join(root, 'src/v2/store.ts')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  outdir: path.join(outDir, 'growth-bundle'),
  entryNames: '[name]',
  alias: { '@': path.join(root, 'src') },
  logLevel: 'silent',
});
const { runTurnV2 } = await import(pathToFileURL(path.join(outDir, 'growth-bundle/engine.js')).href);
const { useGameStoreV2 } = await import(pathToFileURL(path.join(outDir, 'growth-bundle/store.js')).href);

// ---- mock 服务器：正文与提示词留档都按"真实量级"生成 ----
const STORY_CHARS = 1200;          // 一轮正文约 1200 字（约 1200 token）
const callCount = { value: 0 };

function storyText(turn) {
  const base = `第${turn}回合。雨声持续，街灯在水洼里碎成几片。林越把外套领口拢紧，沿着骑楼慢慢走，注意到墙上的旧海报被人撕去一角。`;
  return base.repeat(Math.ceil(STORY_CHARS / base.length)).slice(0, STORY_CHARS);
}

function patchFor(turn, revision) {
  return {
    schemaVersion: 2,
    commitId: `commit_${turn}`,
    baseRevision: revision,
    turn,
    roundSummary: `第${turn}回合摘要：` + '主角继续沿街行走并与环境互动。'.repeat(4),
    latestProgress: `第${turn}回合结束时的位置。`,
    characters: [{ op: 'create', id: `char-${turn}`, name: `路人${turn}`, status: 'active', addFacts: [`第${turn}回合出现`], reason: '正文出现' }],
    relationships: [{ fromId: 'player', toId: `char-${turn}`, affinityDelta: 1, reason: '短暂交流' }],
    inventory: [{ op: 'grant', id: `item-${turn}`, name: `物件${turn}`, kind: 'item', quantity: 1, reason: '拾获' }],
    threads: [{ op: 'create', id: `thread-${turn}`, title: `线索${turn}`, kind: 'hook', status: 'candidate', involvedCharacterIds: [`char-${turn}`], reason: '新线索' }],
    facts: [{ op: 'create', subjectId: `char-${turn}`, predicate: 'location', value: `地点${turn}`, scope: 'location', stability: 'stable', confidence: 'explicit', keywords: [`地点${turn}`], evidenceQuote: `第${turn}回合正文原句`, reason: '长期事实' }],
    scene: { id: `scene-${turn}`, name: `场景${turn}`, description: `第${turn}回合场景描述`, time: '夜', weather: '雨' },
    actions: turn % 2 === 0 ? [{ id: 'a1', label: '继续前行', hint: '沿街走' }] : [],
    destiny: { completionEstimate: Math.min(100, turn * 3), completionReason: '推进中', currentActId: 'act-1', currentStage: '第一幕', currentPath: `路径${turn}`, reason: '推进', beatChanges: [] },
    randomEvent: { handled: false },
  };
}

const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    const parsed = JSON.parse(body || '{}');
    callCount.value += 1;
    const system = parsed.messages?.find((m) => m.role === 'system')?.content ?? '';
    // 让规划模型把真实 revision/turn 抄回去（模拟听话的模型）
    const turnMatch = /【TURN_ID】(\d+):/.exec(JSON.stringify(parsed.messages));
    const revMatch = /"revision":(\d+)/.exec(JSON.stringify(parsed.messages));
    const turn = Number(turnMatch?.[1] ?? 0);
    const revision = Number(revMatch?.[1] ?? 0);
    const sse = (t) => `data: ${JSON.stringify({ choices: [{ delta: { content: t } }] })}\n\ndata: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] })}\n\ndata: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 3000, completion_tokens: 1200, prompt_cache_hit_tokens: 2500 } })}\n\ndata: [DONE]\n\n`;
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    if (system.includes('写前规划')) {
      res.end(sse(JSON.stringify({ intent: '继续', currentAct: 'act-1', activeBeatIds: [], destinyProgress: '', pathChange: '', reframingNeeded: [], reconvergencePlan: '', nextStoryFunction: '', writingBrief: '继续沿街', hardConstraints: [], creativeSpace: [], forbiddenChanges: [], stopBoundary: '停下', randomEvent: { planned: false, summary: '' } })));
      return;
    }
    if (system.includes('只写中文小说正文')) { res.end(sse(storyText(turn))); return; }
    res.end(sse(JSON.stringify(patchFor(turn, revision))));
  });
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const baseUrl = `http://127.0.0.1:${server.address().port}/v1`;

const OUTLINE = { id: 'o', title: '体积测试', synopsis: 's', tone: 't', worldBookIds: [], acts: [{ id: 'act-1', title: '第一幕', purpose: 'p', beats: [{ id: 'beat-1', title: '节', purpose: 'pp' }] }] };
const BACKGROUND = { id: 'b', name: '出身', description: 'd', traits: [], startItems: ['钥匙'], startScene: '开局场景文本。' };
const settings = {
  apiBaseUrl: baseUrl, apiKey: 'k', apiFormat: 'chat', storyModel: 's', plannerModel: 'p',
  temperatureStory: 0.7, storyMaxTokens: 0, plannerContextPreset: 'standard', plannerContextTokens: 32_000,
  plannerToolsEnabled: false, plannerToolMaxCalls: 2, plannerJsonMode: 'disabled', thinkingMode: 'auto',
  reasoningEffort: 'high', roleInjects: { planner: { enabled: false, text: '' }, story: { enabled: false, text: '' }, post: { enabled: false, text: '' } },
  inputPerspective: 'player', stateEditingEnabled: true,
};

const saveId = useGameStoreV2.getState().create({ name: '体积', mode: 'adventure', outline: OUTLINE, background: BACKGROUND, worldFacts: [], randomEvent: { enabled: false } });

const samples = [];
const bytesOf = (s) => Buffer.byteLength(s, 'utf8');
const partsOf = (save) => {
  const json = (v) => bytesOf(JSON.stringify(v));
  return {
    history: json(save.state.history),
    turnRecords: json(save.state.turnRecords ?? []),
    facts: json(save.state.facts),
    characters: json(save.state.characters),
    threads: json(save.state.storyThreads),
    other: 0,
  };
};

for (let turn = 0; turn < turns; turn += 1) {
  const before = useGameStoreV2.getState().saves[saveId].state;
  const next = await runTurnV2({
    state: { ...before, phase: 'generating' },
    input: `第${turn + 1}回合：我沿街继续走，留意两侧的动静，并试着与遇到的人交谈。`,
    settings, outline: OUTLINE, background: BACKGROUND, worldFacts: [],
  });
  useGameStoreV2.getState().commitSuccessfulTurn(saveId, {
    stateBeforeTurn: before, input: `第${turn + 1}回合输入`, narrativePace: 'standard', nextState: next.state,
  });
  const raw = storageBacking.get('lrpg.v2') ?? '';
  const save = useGameStoreV2.getState().saves[saveId];
  const parts = partsOf(save);
  // 用同一序列化路径对比：临时清空 turnRecords，看整包缩到多少，再还原。
  const keptRecords = save.state.turnRecords;
  save.state.turnRecords = [];
  const persistedWithout = (() => {
    // 直接触发一次 persist 写出（persist 会把当前 store 序列化进 localStorage）。
    useGameStoreV2.setState((s) => ({ saves: { ...s.saves } }));
    return storageBacking.get('lrpg.v2') ?? '';
  })();
  save.state.turnRecords = keptRecords;
  useGameStoreV2.setState((s) => ({ saves: { ...s.saves } }));
  samples.push({
    turn: turn + 1,
    localStorageBytes: bytesOf(raw),
    withoutTurnRecordsBytes: bytesOf(persistedWithout),
    historyMessages: save.state.history.length,
    turnRecords: save.state.turnRecords?.length ?? 0,
    parts,
  });
}

server.close();

const first = samples[0];
const last = samples[samples.length - 1];
const growthPerTurn = (last.localStorageBytes - first.localStorageBytes) / (samples.length - 1);
const growthWithoutTraces = (last.withoutTurnRecordsBytes - first.withoutTurnRecordsBytes) / (samples.length - 1);
const quota = 5 * 1024 * 1024;
const projected = Math.round((quota - last.localStorageBytes) / growthPerTurn);
const projectedWithoutTraces = Math.round((quota - last.withoutTurnRecordsBytes) / growthWithoutTraces);

// ---- 写入失败时的真实行为：强制 setItem 抛 QuotaExceededError，检查失败是否可见 ----
const originalSetItem = globalThis.localStorage.setItem;
let rejected = 0;
globalThis.localStorage.setItem = () => {
  rejected += 1;
  const error = new Error('quota exceeded');
  error.name = 'QuotaExceededError';
  throw error;
};
let persistThrew = false;
try {
  useGameStoreV2.getState().update(saveId, (s) => ({ ...s, name: '写入失败后的修改' }));
} catch {
  persistThrew = true;
}
const persistError = useGameStoreV2.getState().persistError;
const persistedName = (() => {
  try { return JSON.parse(storageBacking.get('lrpg.v2')).state.saves[saveId].name; } catch { return '(无法解析)'; }
})();
globalThis.localStorage.setItem = originalSetItem;
// 恢复一次正常写入，避免后续断言受污染
useGameStoreV2.getState().update(saveId, (s) => ({ ...s, name: '体积' }));
const recoveryCleared = useGameStoreV2.getState().persistError === undefined;

console.log(`[growth] 回合数 ${turns} · 调用 ${callCount.value} 次`);
console.log(`[growth] 首回合 ${(first.localStorageBytes / 1024).toFixed(1)} KB → 末回合 ${(last.localStorageBytes / 1024).toFixed(1)} KB`);
console.log(`[growth] 每回合增长：整包 ${(growthPerTurn / 1024).toFixed(1)} KB（其中留档 ${((growthPerTurn - growthWithoutTraces) / 1024).toFixed(1)} KB、正文与状态 ${(growthWithoutTraces / 1024).toFixed(1)} KB）`);
console.log(`[growth] 末回合构成：history ${(last.parts.history / 1024).toFixed(1)} KB · turnRecords ${(last.parts.turnRecords / 1024).toFixed(1)} KB · facts ${(last.parts.facts / 1024).toFixed(1)} KB · characters ${(last.parts.characters / 1024).toFixed(1)} KB · threads ${(last.parts.threads / 1024).toFixed(1)} KB`);
console.log(`[growth] 整包口径：距 5MB 约 ${projected} 回合；只算正文+状态口径：距 5MB 约 ${projectedWithoutTraces} 回合`);
console.log(`[growth] 写入失败实测：被拒 ${rejected} 次 · 异常向上抛出=${persistThrew} · persistError=${persistError ? `「${persistError.message.slice(0, 40)}…」(quota=${persistError.quotaExceeded})` : '未设置'} · 落盘 name=「${persistedName}」`);
console.log(`[growth]     → ${persistThrew && persistError?.quotaExceeded ? '失败可见（既有异常也有可渲染标志位）' : '失败不可见，需要修'}；恢复写入后标志位清空=${recoveryCleared}`);

await writeFile(path.join(outDir, 'storage-growth.json'), JSON.stringify({
  turns,
  quotaBytes: quota,
  growthPerTurnBytes: Math.round(growthPerTurn),
  projectedTurnsToQuota: projected,
  growthPerTurnWithoutTracesBytes: Math.round(growthWithoutTraces),
  projectedTurnsToQuotaWithoutTraces: projectedWithoutTraces,
  quotaExhaustion: { rejectedWrites: rejected, persistThrew, persistError: persistError?.message, quotaExceeded: persistError?.quotaExceeded, persistedName, recoveryCleared },
  samples,
}, null, 2));
console.log('[growth] 报告：test-runs/storage-growth.json');
