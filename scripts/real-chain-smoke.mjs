/**
 * 真实链路冒烟：用真实 engine/store 打真实 OpenAI 兼容端点，跑完整回合并打印可观察结果。
 *
 * 与 `e2e-mock-flow.mjs` 的区别：不使用本地 mock 服务器，请求真的发到 LRPG_API_BASE。
 * 与 `test-story-flow.mjs` 的区别：直接驱动当前 `runTurnV2` / store / 幕状态机 / 随机事件，
 * 不维护一份会过期的旧协议状态。
 *
 * 针对本地 zen-gate 这类网关的可靠性问题，内置了请求级重试：
 * - FreeTierError / INVALID_CREDENTIAL（上游按出口 IP 门禁）→ 换 `user` 值（= 换 session/出口）后重试；
 * - 429 → 退避（默认 8~15s，jitter），最多 2 次；
 * - 5xx / 网络错误 → 短退避重试。
 * 不依赖供应商的自动 failover。
 *
 * 用法：
 *   LRPG_API_BASE=http://127.0.0.1:8787/v1 \
 *   LRPG_API_KEY=... \
 *   LRPG_MODEL=minimax/minimax-m3.1-flash:free \
 *   node scripts/real-chain-smoke.mjs
 *
 * 可选：LRPG_TURNS=2（默认 2）、LRPG_MAX_TOKENS=2500、LRPG_RETRIES=5。
 * 产物：test-runs/real-chain-report.json（被 gitignore）。
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
// 必须是第一个副作用 import：zustand persist 在模块求值期就要读 localStorage。
import './e2e-localstorage-stub.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'test-runs', 'real-chain-bundle');
await mkdir(outDir, { recursive: true });

const API_BASE = String(process.env.LRPG_API_BASE || '').replace(/\/+$/, '');
const API_KEY = String(process.env.LRPG_API_KEY || '');
if (!API_BASE || !API_KEY) {
  console.error('[real-chain] 缺少 LRPG_API_BASE / LRPG_API_KEY，退出。');
  process.exit(2);
}
const MODEL = String(process.env.LRPG_MODEL || 'minimax/minimax-m3.1-flash:free');
const TURNS = Math.max(1, Math.min(5, Number(process.env.LRPG_TURNS || 2)));
const MAX_TOKENS = Math.max(512, Math.min(16000, Number(process.env.LRPG_MAX_TOKENS || 2500)));
const MAX_RETRIES = Math.max(1, Math.min(8, Number(process.env.LRPG_RETRIES || 5)));
const RUN_ID = `lau_rpg-smoke-${Date.now().toString(36)}`;
let requestSeq = 0;

// ---------------------------------------------------------------------------
// 打包真实源码
// ---------------------------------------------------------------------------
await build({
  entryPoints: {
    engine: 'src/v2/engine.ts',
    store: 'src/v2/store.ts',
    outlines: 'src/presets/outlines.ts',
    backgrounds: 'src/presets/backgrounds.ts',
    worldbooks: 'src/presets/worldbooks.ts',
    settings: 'src/types/settings.ts',
  },
  absWorkingDir: root,
  bundle: true,
  platform: 'node',
  format: 'esm',
  outdir: outDir,
  alias: { '@': path.join(root, 'src') },
  logLevel: 'silent',
});
const imp = (name) => import(pathToFileURL(path.join(outDir, `${name}.js`)).href);
const { runTurnV2, runTurnSettlementV2, TurnPostFailureV2 } = await imp('engine');
const { useGameStoreV2 } = await imp('store');
const { PRESET_OUTLINES } = await imp('outlines');
const { PRESET_BACKGROUNDS } = await imp('backgrounds');
const { PRESET_WORLDBOOKS } = await imp('worldbooks');
const { DEFAULT_SETTINGS } = await imp('settings');

const settings = {
  ...DEFAULT_SETTINGS,
  apiBaseUrl: API_BASE,
  apiKey: API_KEY,
  plannerModel: MODEL,
  storyModel: MODEL,
  temperatureStory: 0.8,
  storyMaxTokens: MAX_TOKENS,
  plannerJsonMode: 'enabled',
  plannerToolsEnabled: false,
  thinkingMode: 'auto',
};

// ---------------------------------------------------------------------------
// fetch 包装：换 user 换 session、按错误类型退避重试（只影响本脚本进程）
// ---------------------------------------------------------------------------
const realFetch = globalThis.fetch;
const requestLog = [];
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const seedFor = (attempt) => `${RUN_ID}:${attempt}`;
const classifyPhase = (bodyText) => {
  if (!bodyText) return 'unknown';
  try {
    const body = JSON.parse(bodyText);
    if (body.stream) return 'story';
    const joined = JSON.stringify(body.messages ?? '');
    if (joined.includes('CURRENT_STORY')) return 'planner_post';
    if (joined.includes('【AUTHORITATIVE_STATE】')) return 'planner_pre';
    return 'chat';
  } catch {
    return 'unknown';
  }
};

globalThis.fetch = async (input, init = {}) => {
  const url = typeof input === 'string' ? input : String(input?.url ?? '');
  if (!url.startsWith(API_BASE)) return realFetch(input, init);
  const seq = ++requestSeq;
  const phase = classifyPhase(init.body);
  const startedAt = Date.now();

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt += 1) {
    let body = init.body;
    if (typeof body === 'string') {
      try {
        const parsed = JSON.parse(body);
        parsed.user = seedFor(attempt);
        body = JSON.stringify(parsed);
      } catch { /* 非 JSON 请求体原样发送 */ }
    }
    const headers = new Headers(init.headers ?? {});
    headers.set('X-Request-Id', `${RUN_ID}-${phase}-${seq}-a${attempt}`);
    let response;
    let networkError;
    try {
      response = await realFetch(input, { ...init, headers, body });
    } catch (error) {
      networkError = error;
    }
    const elapsed = Math.round(Date.now() - startedAt);
    if (response?.ok) {
      requestLog.push({ seq, phase, attempt, status: response.status, elapsed, seed: seedFor(attempt) });
      return response;
    }
    const status = response?.status ?? 0;
    let errorText = '';
    try { errorText = response ? await response.clone().text() : ''; } catch { /* ignore */ }
    const freeTier = status === 401 && /FreeTierError|INVALID_CREDENTIAL|invalid API key|abusive traffic/i.test(errorText);
    const rateLimited = status === 429;
    const serverError = status >= 500 || !!networkError;
    requestLog.push({
      seq, phase, attempt, status: status || 'NETWORK', elapsed, seed: seedFor(attempt),
      error: (errorText || String(networkError ?? '')).slice(0, 160),
    });
    if ((!freeTier && !rateLimited && !serverError) || attempt === MAX_RETRIES) return response ?? Promise.reject(networkError);
    const delay = freeTier
      ? 1500 + Math.floor(Math.random() * 2500)
      : rateLimited
        ? 8000 + Math.floor(Math.random() * 7000)
        : 1500 + Math.floor(Math.random() * 1500);
    console.log(`[real-chain] ${phase} 第 ${attempt} 次失败（${status || '网络'}${freeTier ? ' · 换 session' : ''}），${delay}ms 后重试`);
    await sleep(delay);
  }
  throw new Error('[real-chain] 重试耗尽');
};

// ---------------------------------------------------------------------------
// 建旅程 + 跑回合
// ---------------------------------------------------------------------------
const outline = PRESET_OUTLINES[0];
const background = PRESET_BACKGROUNDS[0];
const worldFacts = PRESET_WORLDBOOKS[0]?.entries ?? [];
const saveId = useGameStoreV2.getState().create({
  name: `真实链路冒烟 · ${new Date().toLocaleString('zh-CN')}`,
  mode: 'author',
  outline,
  background,
  worldFacts,
  randomEvent: { enabled: true, triggerIntervalMin: 1, triggerIntervalMax: 1 },
});

const INPUTS = [
  '我在脑中拼命想着：如果我是女孩子就好了。',
  '门外安静下来后，我试着低头观察自己的手和衣着，先弄清现在是什么状况。',
  '我恢复成原本的样子，装作刚下课，往宿舍方向走。',
];

function sumUsage(usage) {
  if (!usage) return { prompt: 0, completion: 0, cacheHit: 0 };
  const parts = [usage.pre, usage.story, usage.post].filter(Boolean);
  return parts.reduce((acc, u) => ({
    prompt: acc.prompt + (Number(u.promptTokens) || 0),
    completion: acc.completion + (Number(u.completionTokens) || 0),
    cacheHit: acc.cacheHit + (Number(u.cacheReadTokens) || Number(u.cache?.hitTokens) || 0),
  }), { prompt: 0, completion: 0, cacheHit: 0 });
}

const describeState = (state) => {
  const destiny = state.destiny;
  const statusCount = {};
  for (const beat of destiny.beats ?? []) statusCount[beat.status] = (statusCount[beat.status] ?? 0) + 1;
  const event = state.randomEvent;
  return {
    turn: state.turn,
    revision: state.revision,
    history: state.history.length,
    act: `${(destiny.currentActIndex ?? 0) + 1}/${outline.acts.length} 《${outline.acts[destiny.currentActIndex ?? 0]?.title ?? '?'}》`,
    currentStage: destiny.currentStage,
    completion: destiny.completionEstimate,
    beats: statusCount,
    actHistory: (destiny.actHistory ?? []).map((item) => `${item.actId}@${item.enteredTurn}→${item.exitedTurn ?? '…'}`),
    randomEvent: {
      enabled: event.enabled,
      intensity: event.intensity,
      pending: event.pending,
      activeBinding: event.activeBinding
        ? `${event.activeBinding.targetKind}:${event.activeBinding.targetId}（${event.activeBinding.summary}）`
        : undefined,
      history: (event.history ?? []).map((item) => `T${item.turn + 1} ${item.status} ${item.intensity}→${item.targetKind}:${item.targetId}`),
    },
  };
};

async function runOneTurn(input, turnIndex) {
  const save = useGameStoreV2.getState().saves[saveId];
  if (!save) throw new Error('存档不存在');
  const stateBefore = save.state;
  const activities = [];
  let story = '';
  const startedAt = Date.now();
  const request = {
    state: { ...stateBefore, phase: 'generating' },
    input,
    settings,
    outline: save.outline,
    background: save.background,
    worldFacts: save.worldFacts,
  };
  const callbacks = {
    onStoryDelta: (delta) => { story += delta; },
    onModelActivity: (activity) => {
      if (activity.type === 'phase') activities.push(`[${activity.phase}] ${activity.status}${activity.error ? ` · ${activity.error}` : ''}`);
      else if (activity.type === 'warning') activities.push(`[warning:${activity.code}] ${activity.message}`);
      else if (activity.type === 'tool') activities.push(`[tool] ${activity.toolName} ${activity.status}`);
    },
  };

  let result;
  try {
    result = await runTurnV2({ ...request, ...callbacks });
  } catch (error) {
    if (error instanceof TurnPostFailureV2 && error.partial) {
      console.log(`[real-chain] 结算失败，尝试只重试结算：${error.message}`);
      activities.push(`[planner_post] failed · 只重试结算`);
      result = await runTurnSettlementV2(request, error.partial);
    } else {
      throw error;
    }
  }

  const committed = useGameStoreV2.getState().commitSuccessfulTurn(saveId, {
    stateBeforeTurn: stateBefore,
    input,
    narrativePace: stateBefore.narrativePace,
    nextState: result.state,
  });
  if (!committed) throw new Error('commitSuccessfulTurn 拒绝提交（revision/turn 不一致）');

  const next = useGameStoreV2.getState().saves[saveId].state;
  const turnRecord = next.turnRecords[next.turnRecords.length - 1];
  // 分阶段缓存统计：DeepSeek 官方 usage 给出 prompt_cache_hit_tokens，
  // llmUsage 归一化后落在 usage.cache.hitTokens；promptTokens 是完整输入量。
  const perPhase = (turnRecord?.calls ?? []).map((call) => {
    const usage = call.usage ?? {};
    const prompt = Number(usage.promptTokens) || 0;
    const cacheHit = Number(usage.cache?.hitTokens) || 0;
    const completion = Number(usage.completionTokens) || 0;
    return {
      phase: call.phase,
      model: call.model,
      prompt,
      completion,
      cacheHit,
      cacheMiss: Math.max(0, prompt - cacheHit),
      hitRate: prompt ? Math.round((cacheHit / prompt) * 1000) / 10 : null,
    };
  });
  return {
    turnIndex,
    elapsedMs: Date.now() - startedAt,
    storyLength: result.story.length,
    storyHead: result.story.slice(0, 80),
    storyTail: result.story.slice(-80),
    usage: sumUsage(result.usage),
    perPhase,
    patchStats: turnRecord?.patchStats,
    pacing: turnRecord?.pacing,
    calls: turnRecord?.calls?.map((call) => `${call.phase}:${call.model}`) ?? [],
    activities,
    state: describeState(next),
    story,
  };
}

const report = { runId: RUN_ID, apiBase: API_BASE, model: MODEL, settings: { storyMaxTokens: MAX_TOKENS }, turns: [], requests: requestLog };
const TURN_ATTEMPTS = 2;
let failed = false;
for (let index = 0; index < TURNS; index += 1) {
  const input = INPUTS[index % INPUTS.length];
  console.log(`\n[real-chain] ===== 第 ${index + 1} 回合 =====`);
  console.log(`[real-chain] 输入：${input}`);
  let lastError;
  let turn;
  for (let attempt = 1; attempt <= TURN_ATTEMPTS; attempt += 1) {
    try {
      turn = await runOneTurn(input, index);
      break;
    } catch (error) {
      lastError = error;
      const transient = /空内容|empty|JSON|timeout|超时|aborted|network|fetch/i.test(String(error?.message ?? error));
      console.error(`[real-chain] 第 ${index + 1} 回合第 ${attempt} 次失败${transient ? '（可重试）' : ''}：${error?.message ?? error}`);
      if (!transient || attempt === TURN_ATTEMPTS) break;
      console.log('[real-chain] 换一个 session seed 重跑本回合…');
      await sleep(1500 + Math.floor(Math.random() * 1500));
    }
  }
  if (!turn) {
    failed = true;
    report.error = String(lastError?.stack ?? lastError);
    break;
  }
  report.turns.push(turn);
  console.log(`[real-chain] 完成：${(turn.elapsedMs / 1000).toFixed(1)}s · 正文 ${turn.storyLength} 字 · 调用 ${turn.calls.join(' / ')}`);
  console.log(`[real-chain] 正文头：${turn.storyHead.replace(/\n/g, ' ')}…`);
  console.log(`[real-chain] 正文尾：…${turn.storyTail.replace(/\n/g, ' ')}`);
  console.log(`[real-chain] usage：输入 ${turn.usage.prompt} / 输出 ${turn.usage.completion} / 缓存命中 ${turn.usage.cacheHit}`);
  if (turn.perPhase?.length) {
    const cacheLine = turn.perPhase.map((item) => `${item.phase} ${item.cacheHit}/${item.prompt}${item.hitRate === null ? '' : `（${item.hitRate}%）`}`).join(' · ');
    console.log(`[real-chain] 分阶段缓存：${cacheLine}`);
  }
  console.log(`[real-chain] pacing：${JSON.stringify(turn.pacing)}`);
  console.log(`[real-chain] 状态：${JSON.stringify(turn.state)}`);
  console.log(`[real-chain] 活动：${turn.activities.slice(-12).join(' | ')}`);
}

// 缓存汇总：第一回合是冷启动（前缀尚未建立），单独列出；之后按阶段聚合命中率。
const warmTurns = report.turns.slice(1);
if (warmTurns.length) {
  const byPhase = {};
  for (const turnItem of warmTurns) {
    for (const item of turnItem.perPhase ?? []) {
      const agg = byPhase[item.phase] ?? { prompt: 0, hit: 0 };
      agg.prompt += item.prompt;
      agg.hit += item.cacheHit;
      byPhase[item.phase] = agg;
    }
  }
  const parts = Object.entries(byPhase).map(([phase, agg]) => (
    `${phase} ${agg.hit}/${agg.prompt}${agg.prompt ? `（${Math.round((agg.hit / agg.prompt) * 1000) / 10}%）` : ''}`
  ));
  console.log(`[real-chain] 缓存汇总（不含首回合冷启动）：${parts.join(' · ')}`);
  report.cacheSummary = { warmTurns: warmTurns.length, byPhase };
}

report.requests = requestLog;
await writeFile(path.join(root, 'test-runs', 'real-chain-report.json'), JSON.stringify(report, null, 2), 'utf8');
const okTurns = report.turns.length;
console.log(`\n[real-chain] 汇总：完成 ${okTurns}/${TURNS} 回合 · 请求 ${requestLog.length} 次（重试 ${requestLog.filter((item) => item.attempt > 1).length} 次）`);
console.log(`[real-chain] 报告：test-runs/real-chain-report.json`);
process.exit(failed || okTurns === 0 ? 1 : 0);
