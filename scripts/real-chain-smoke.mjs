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
 * 可选：LRPG_TURNS=2（默认 2）、LRPG_MAX_TOKENS=2500、LRPG_RETRIES=5、
 *       LRPG_TOOLS=1（启用规划模型 search_story_context 工具，默认关闭）、
 *       LRPG_AUTONOMY=standard（推进权限 strict/standard/free，默认 standard）、
 *       LRPG_STORY_API_BASE / LRPG_STORY_API_KEY / LRPG_STORY_MODEL
 *       （混合端点：story 阶段独立连接与模型；留空分别继承全局，默认与旧行为一致）。
 * 产物：test-runs/real-chain-report.json（被 gitignore）。
 */
import { mkdir, writeFile, unlink } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
// 必须是第一个副作用 import：zustand persist 在模块求值期就要读 localStorage。
import './e2e-localstorage-stub.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// 每次运行使用独立打包目录：允许并行跑多个预设，避免多个进程同时重写同一 bundle。
const outDir = path.join(root, 'test-runs', 'real-chain-bundle', `${Date.now().toString(36)}-${process.pid}`);
await mkdir(outDir, { recursive: true });

const API_BASE = String(process.env.LRPG_API_BASE || '').replace(/\/+$/, '');
const API_KEY = String(process.env.LRPG_API_KEY || '');
if (!API_BASE || !API_KEY) {
  console.error('[real-chain] 缺少 LRPG_API_BASE / LRPG_API_KEY，退出。');
  process.exit(2);
}
const MODEL = String(process.env.LRPG_MODEL || 'minimax/minimax-m3.1-flash:free');
// 混合端点（T2）：story 阶段可独立配置 base / key / model；留空分别继承全局。
// 只记录 URL，apiKey 不会写进报告 / 检查点 / 日志。
const STORY_API_BASE = String(process.env.LRPG_STORY_API_BASE || '').replace(/\/+$/, '');
const STORY_API_KEY = String(process.env.LRPG_STORY_API_KEY || '');
const STORY_MODEL = String(process.env.LRPG_STORY_MODEL || MODEL);
const TURNS = Math.max(1, Math.min(40, Number(process.env.LRPG_TURNS || 2)));
// 0 = 不限制输出（与真实游玩默认一致）；正数则夹到 [512, 16000]。
const rawMaxTokens = Number(process.env.LRPG_MAX_TOKENS || 0);
const MAX_TOKENS = Number.isFinite(rawMaxTokens) && rawMaxTokens > 0
  ? Math.max(512, Math.min(16000, Math.floor(rawMaxTokens)))
  : 0;
const MAX_RETRIES = Math.max(1, Math.min(8, Number(process.env.LRPG_RETRIES || 5)));
// 报告路径：并行跑多个预设时可分开写，避免互相覆盖。
const REPORT_FILE = String(process.env.LRPG_REPORT_FILE || 'test-runs/real-chain-report.json');
// 断点续跑：每回合成功后写检查点；失败后可用 LRPG_RESUME 指向该文件继续，而不是从头重跑。
const CHECKPOINT_FILE = String(process.env.LRPG_CHECKPOINT_FILE || 'test-runs/real-chain-checkpoint.json');
const RESUME_FILE = String(process.env.LRPG_RESUME || '');
const KEEP_CHECKPOINT = process.env.LRPG_KEEP_CHECKPOINT === '1';
// 单回合看门狗：反代偶发请求挂死（无任何输出）时中止本回合并按瞬时错误重试。
const TURN_TIMEOUT_MS = Math.max(60000, Number(process.env.LRPG_TURN_TIMEOUT_MS || 480000));
// 默认关闭工具（真实游玩默认也不开）；LRPG_TOOLS=1 时启用规划模型上下文检索工具。
const TOOLS_ENABLED = process.env.LRPG_TOOLS === '1';
// 官方联网搜索开关（仅官方 DeepSeek Base 生效）；LRPG_WEB_SEARCH=1 时同时启用工具。
const WEB_SEARCH_ENABLED = process.env.LRPG_WEB_SEARCH === '1';
// 推进权限（storyAutonomy）：strict / standard / free，默认 standard；非法值回退 standard。
const VALID_AUTONOMY = ['strict', 'standard', 'free'];
const AUTONOMY = (() => {
  const raw = String(process.env.LRPG_AUTONOMY || 'standard').trim().toLowerCase();
  if (!VALID_AUTONOMY.includes(raw)) {
    console.warn(`[real-chain] LRPG_AUTONOMY=${raw} 不合法（可选 ${VALID_AUTONOMY.join('/')}），回退 standard。`);
    return 'standard';
  }
  return raw;
})();
const RUN_ID = `lau_rpg-smoke-${Date.now().toString(36)}`;
let requestSeq = 0;
console.log(`[real-chain] autonomy=${AUTONOMY}`);
if (STORY_API_BASE || STORY_MODEL !== MODEL) {
  console.log(`[real-chain] hybrid: storyApiBase=${STORY_API_BASE || '(inherit)'} storyModel=${STORY_MODEL}`);
}

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
const { useGameStoreV2, toPortableSaveV2 } = await imp('store');
const { PRESET_OUTLINES } = await imp('outlines');
const { PRESET_BACKGROUNDS } = await imp('backgrounds');
const { PRESET_WORLDBOOKS } = await imp('worldbooks');
const { DEFAULT_SETTINGS } = await imp('settings');

const settings = {
  ...DEFAULT_SETTINGS,
  apiBaseUrl: API_BASE,
  apiKey: API_KEY,
  plannerModel: MODEL,
  storyModel: STORY_MODEL,
  // 混合端点：仅显式提供时写入；空串 = 引擎侧按“分别继承全局”处理（与 UI 留空语义一致）。
  ...(STORY_API_BASE ? { storyApiBaseUrl: STORY_API_BASE } : {}),
  ...(STORY_API_KEY ? { storyApiKey: STORY_API_KEY } : {}),
  temperatureStory: 0.8,
  storyMaxTokens: MAX_TOKENS,
  plannerJsonMode: 'enabled',
  plannerToolsEnabled: TOOLS_ENABLED || WEB_SEARCH_ENABLED,
  plannerWebSearchEnabled: WEB_SEARCH_ENABLED,
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
  // 混合端点：planner_post/planner_pre 走全局 base，story 可走 LRPG_STORY_API_BASE。
  // 两个 base 相同时（未配置混合端点）行为与单一 base 完全一致。
  const endpoint = url.startsWith(API_BASE) ? 'planner' : (STORY_API_BASE && url.startsWith(STORY_API_BASE) ? 'story' : '');
  if (!endpoint) return realFetch(input, init);
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
    headers.set('X-Request-Id', `${RUN_ID}-${endpoint}-${phase}-${seq}-a${attempt}`);
    let response;
    let networkError;
    try {
      response = await realFetch(input, { ...init, headers, body });
    } catch (error) {
      networkError = error;
    }
    const elapsed = Math.round(Date.now() - startedAt);
    if (response?.ok) {
      requestLog.push({ seq, endpoint, phase, attempt, status: response.status, elapsed, seed: seedFor(attempt) });
      return response;
    }
    const status = response?.status ?? 0;
    let errorText = '';
    try { errorText = response ? await response.clone().text() : ''; } catch { /* ignore */ }
    const freeTier = status === 401 && /FreeTierError|INVALID_CREDENTIAL|invalid API key|abusive traffic/i.test(errorText);
    const rateLimited = status === 429;
    const serverError = status >= 500 || !!networkError;
    requestLog.push({
      seq, endpoint, phase, attempt, status: status || 'NETWORK', elapsed, seed: seedFor(attempt),
      error: (errorText || String(networkError ?? '')).slice(0, 160),
    });
    if ((!freeTier && !rateLimited && !serverError) || attempt === MAX_RETRIES) return response ?? Promise.reject(networkError);
    const delay = freeTier
      ? 1500 + Math.floor(Math.random() * 2500)
      : rateLimited
        ? 8000 + Math.floor(Math.random() * 7000)
        : 1500 + Math.floor(Math.random() * 1500);
    console.log(`[real-chain] ${endpoint}/${phase} 第 ${attempt} 次失败（${status || '网络'}${freeTier ? ' · 换 session' : ''}），${delay}ms 后重试`);
    await sleep(delay);
  }
  throw new Error('[real-chain] 重试耗尽');
};

// ---------------------------------------------------------------------------
// 建旅程 + 跑回合
// ---------------------------------------------------------------------------
// 可用 LRPG_OUTLINE_ID 指定内置故事（默认第一个）；出身与世界书按故事的推荐字段自动选择。
const OUTLINE_ID = String(process.env.LRPG_OUTLINE_ID || '');
let outline = (OUTLINE_ID ? PRESET_OUTLINES.find((item) => item.id === OUTLINE_ID) : undefined) ?? PRESET_OUTLINES[0];
let background = PRESET_BACKGROUNDS.find((item) => outline.backgroundIds?.includes(item.id)) ?? PRESET_BACKGROUNDS[0];
let worldBook = PRESET_WORLDBOOKS.find((book) => outline.worldBookIds?.includes(book.id)) ?? PRESET_WORLDBOOKS[0];
let worldFacts = worldBook?.entries ?? [];

const INPUTS_FILE = String(process.env.LRPG_INPUTS_FILE || '');
const DEFAULT_INPUTS = [
  '我在脑中拼命想着：如果我是女孩子就好了。',
  '门外安静下来后，我试着低头观察自己的手和衣着，先弄清现在是什么状况。',
  '我恢复成原本的样子，装作刚下课，往宿舍方向走。',
];
const INPUTS = INPUTS_FILE
  ? readFileSync(path.resolve(INPUTS_FILE), 'utf8')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
  : DEFAULT_INPUTS;
if (!INPUTS.length) {
  console.error('[real-chain] 输入列表为空（检查 LRPG_INPUTS_FILE），退出。');
  process.exit(2);
}

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
    // 反代/网络偶发挂死：到时间直接 abort，由外层按可重试错误处理。
    signal: AbortSignal.timeout(TURN_TIMEOUT_MS),
  };
  const callbacks = {
    onStoryDelta: (delta) => { story += delta; },
    onModelActivity: (activity) => {
      if (activity.type === 'phase') activities.push(`[${activity.phase}] ${activity.status}${activity.error ? ` · ${activity.error}` : ''}`);
      else if (activity.type === 'warning') activities.push(`[warning:${activity.code}] ${activity.message}`);
      else if (activity.type === 'tool') {
        // 工具冒烟需要看到实际查询词与返回摘要，否则只能知道"调用过"。
        const detail = activity.status === 'call'
          ? String(activity.argumentsText ?? '').slice(0, 120)
          : String(activity.resultText ?? '').slice(0, 160);
        activities.push(`[tool] ${activity.toolName} ${activity.status}${detail ? ` · ${detail}` : ''}`);
      }
    },
  };

  let result;
  try {
    result = await runTurnV2({ ...request, ...callbacks });
  } catch (error) {
    if (error instanceof TurnPostFailureV2 && error.partial) {
      // 只重试结算：反代偶发返回非法 JSON 时，重跑整轮既慢又浪费；
      // planner_post 只依赖已完成的正文与写前规划，可以独立重试。
      let settlementError = error;
      for (let attempt = 1; attempt <= 2; attempt += 1) {
        console.log(`[real-chain] 结算失败，尝试只重试结算（${attempt}/2）：${settlementError.message}`);
        activities.push(`[planner_post] failed · 只重试结算 ${attempt}/2`);
        await sleep(1500 + Math.floor(Math.random() * 1500));
        try {
          result = await runTurnSettlementV2(request, error.partial);
          settlementError = null;
          break;
        } catch (retryError) {
          settlementError = retryError;
          if (!(retryError instanceof TurnPostFailureV2 && retryError.partial)) throw retryError;
        }
      }
      if (settlementError) throw settlementError;
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
    // 保留原始事件历史与幕历史，供长局评测聚合（describeState 里是展示用字符串）。
    randomEventHistory: next.randomEvent.history ?? [],
    actHistory: next.destiny.actHistory ?? [],
    story,
  };
}

const resolvePath = (file) => (path.isAbsolute(file) ? file : path.join(root, file));
const checkpointPath = resolvePath(CHECKPOINT_FILE);
const resumePath = RESUME_FILE ? resolvePath(RESUME_FILE) : '';
let saveId = '';
let startIndex = 0;
let report;

/**
 * 把推进权限写进存档 state。
 *
 * create() 的入参没有 state（它总是用 storyAutonomy:'standard' 新建），
 * 所以只能建好后用 setState 覆盖；测试环境用内存 localStorage，persist 副作用无妨。
 */
const applyAutonomy = (id, autonomy) => {
  useGameStoreV2.setState((state) => {
    const save = state.saves[id];
    if (!save) return {};
    return { saves: { ...state.saves, [id]: { ...save, state: { ...save.state, storyAutonomy: autonomy } } } };
  });
};

if (resumePath) {
  const checkpoint = JSON.parse(readFileSync(resumePath, 'utf8'));
  const saved = checkpoint.save;
  if (!saved?.id || !saved?.state) throw new Error(`[real-chain] 检查点缺少存档快照：${resumePath}`);
  if (checkpoint.model && checkpoint.model !== MODEL) {
    console.warn(`[real-chain] 检查点模型=${checkpoint.model}，当前 LRPG_MODEL=${MODEL}；按当前配置续跑。`);
  }
  const savedAutonomy = saved.state.storyAutonomy ?? 'standard';
  if (savedAutonomy !== AUTONOMY) {
    console.warn(`[real-chain] 检查点 autonomy=${savedAutonomy}，当前 LRPG_AUTONOMY=${AUTONOMY}；按当前配置续跑。`);
  }
  saveId = saved.id;
  outline = saved.outline ?? outline;
  background = saved.background ?? background;
  worldFacts = saved.worldFacts ?? worldFacts;
  worldBook = PRESET_WORLDBOOKS.find((book) => outline.worldBookIds?.includes(book.id)) ?? worldBook;
  useGameStoreV2.setState((state) => ({ saves: { ...state.saves, [saveId]: saved }, activeId: saveId }));
  applyAutonomy(saveId, AUTONOMY);
  startIndex = Number(checkpoint.nextIndex) || checkpoint.report?.turns?.length || 0;
  report = {
    ...(checkpoint.report ?? {}),
    runId: checkpoint.runId ?? RUN_ID,
    apiBase: API_BASE,
    model: MODEL,
    preset: {
      ...(checkpoint.preset ?? checkpoint.report?.preset ?? {}),
      autonomy: AUTONOMY,
      plannerModel: MODEL,
      storyModel: STORY_MODEL,
      // 只记录 URL（不记录 key）；未配置混合端点时标为 inherit。
      storyApiBase: STORY_API_BASE || '(inherit)',
    },
    settings: { storyMaxTokens: MAX_TOKENS, plannerToolsEnabled: TOOLS_ENABLED },
    turns: checkpoint.report?.turns ?? [],
    requests: requestLog,
  };
  delete report.error;
  console.log(`[real-chain] ===== 从检查点续跑：已完成 ${report.turns.length} 回合，从第 ${startIndex + 1}/${TURNS} 回合继续 =====`);
} else {
  saveId = useGameStoreV2.getState().create({
    name: `真实链路冒烟 · ${outline.title} · ${new Date().toLocaleString('zh-CN')}`,
    mode: 'author',
    outline,
    background,
    worldFacts,
    randomEvent: { enabled: true, triggerIntervalMin: 1, triggerIntervalMax: 1 },
  });
  applyAutonomy(saveId, AUTONOMY);
  report = {
    runId: RUN_ID,
    apiBase: API_BASE,
    model: MODEL,
    preset: {
      outlineId: outline.id,
      outlineTitle: outline.title,
      backgroundId: background?.id,
      worldBookId: worldBook?.id,
      autonomy: AUTONOMY,
      plannerModel: MODEL,
      storyModel: STORY_MODEL,
      // 只记录 URL（不记录 key）；未配置混合端点时标为 inherit。
      storyApiBase: STORY_API_BASE || '(inherit)',
    },
    settings: { storyMaxTokens: MAX_TOKENS, plannerToolsEnabled: TOOLS_ENABLED },
    turns: [],
    requests: requestLog,
  };
}

/** 每回合成功后落一次完整存档快照；失败时可用 LRPG_RESUME 续跑。 */
const writeCheckpoint = async (nextIndex) => {
  try {
    const save = useGameStoreV2.getState().saves[saveId];
    if (!save) return;
    const checkpoint = {
      runId: report.runId,
      model: MODEL,
      preset: report.preset,
      settings: report.settings,
      save: toPortableSaveV2(save),
      report: { ...report, requests: [], error: undefined, turns: report.turns },
      nextIndex,
      turns: TURNS,
      inputsFile: INPUTS_FILE,
      updatedAt: Date.now(),
    };
    await writeFile(checkpointPath, JSON.stringify(checkpoint), 'utf8');
  } catch (error) {
    console.warn(`[real-chain] 检查点写入失败（不影响本回合）：${error?.message ?? error}`);
  }
};

const TURN_ATTEMPTS = Math.max(1, Math.min(6, Number(process.env.LRPG_TURN_ATTEMPTS || 3)));
let failed = false;
for (let index = startIndex; index < TURNS; index += 1) {
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
      const transient = /空内容|empty|JSON|timeout|超时|aborted|network|fetch|过短|截断|terminated|ECONNRESET|socket|供应商错误|sensitive words|content policy|api key|rate limit/i.test(String(error?.message ?? error));
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
  await writeCheckpoint(index + 1);
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

// 长局评测聚合：篇幅分布、收尾/时间跳跃/超预算、纠偏触发、随机事件三态、幕推进、token。
const evaluation = (() => {
  const turns = report.turns;
  if (!turns.length) return undefined;
  const lengths = turns.map((turnItem) => turnItem.storyLength).sort((a, b) => a - b);
  const percentile = (ratio) => lengths[Math.min(lengths.length - 1, Math.floor(lengths.length * ratio))] ?? 0;
  const eventsById = new Map();
  for (const turnItem of turns) {
    for (const event of turnItem.randomEventHistory ?? []) eventsById.set(event.id, event);
  }
  const eventStatus = { resolved: 0, ongoing_hook: 0, interrupted: 0 };
  for (const event of eventsById.values()) eventStatus[event.status] = (eventStatus[event.status] ?? 0) + 1;
  const tokens = turns.reduce((acc, turnItem) => ({
    prompt: acc.prompt + turnItem.usage.prompt,
    completion: acc.completion + turnItem.usage.completion,
    cacheHit: acc.cacheHit + turnItem.usage.cacheHit,
  }), { prompt: 0, completion: 0, cacheHit: 0 });
  const lastTurn = turns[turns.length - 1];
  return {
    turns: turns.length,
    length: { min: lengths[0], p50: percentile(0.5), p90: percentile(0.9), max: lengths[lengths.length - 1] },
    pacing: {
      closureDetected: turns.filter((turnItem) => turnItem.pacing?.closureDetected).length,
      timeJumpAtLeast3: turns.filter((turnItem) => (turnItem.pacing?.timeJumpCount ?? 0) >= 3).length,
      overBudget: turns.filter((turnItem) => turnItem.pacing?.overBudget).length,
      needsCorrection: turns.filter((turnItem) => turnItem.pacing?.needsCorrection).length,
    },
    randomEvents: { unique: eventsById.size, ...eventStatus },
    actTransitions: Math.max(0, ...turns.map((turnItem) => (turnItem.actHistory ?? []).length)),
    finalState: lastTurn?.state,
    tokens,
    elapsedMsTotal: turns.reduce((sum, turnItem) => sum + turnItem.elapsedMs, 0),
  };
})();
if (evaluation) {
  report.evaluation = evaluation;
  console.log(`[real-chain] 篇幅：min ${evaluation.length.min} / p50 ${evaluation.length.p50} / p90 ${evaluation.length.p90} / max ${evaluation.length.max} 字`);
  console.log(`[real-chain] 节奏：升华收尾 ${evaluation.pacing.closureDetected} 次 · 时间跳跃≥3 ${evaluation.pacing.timeJumpAtLeast3} 次 · 超 5000 字 ${evaluation.pacing.overBudget} 次 · 触发纠偏 ${evaluation.pacing.needsCorrection} 次`);
  console.log(`[real-chain] 随机事件：${JSON.stringify(evaluation.randomEvents)}`);
  console.log(`[real-chain] 幕：当前 ${evaluation.finalState?.act} · 幕切换 ${evaluation.actTransitions} 次 · beats ${JSON.stringify(evaluation.finalState?.beats)}`);
  console.log(`[real-chain] tokens：输入 ${evaluation.tokens.prompt}（命中 ${evaluation.tokens.cacheHit}）· 输出 ${evaluation.tokens.completion} · 总耗时 ${(evaluation.elapsedMsTotal / 60000).toFixed(1)} 分钟`);
}

report.requests = requestLog;
await writeFile(path.isAbsolute(REPORT_FILE) ? REPORT_FILE : path.join(root, REPORT_FILE), JSON.stringify(report, null, 2), 'utf8');
const okTurns = report.turns.length;
if (okTurns === TURNS && !failed && !KEEP_CHECKPOINT) {
  await unlink(checkpointPath).catch(() => {});
} else {
  console.log(`[real-chain] 检查点：${CHECKPOINT_FILE}（可用 LRPG_RESUME 指向它继续）`);
}
console.log(`\n[real-chain] 汇总：完成 ${okTurns}/${TURNS} 回合 · 请求 ${requestLog.length} 次（重试 ${requestLog.filter((item) => item.attempt > 1).length} 次）`);
console.log(`[real-chain] 报告：${REPORT_FILE}`);
process.exit(failed || okTurns === 0 ? 1 : 0);
