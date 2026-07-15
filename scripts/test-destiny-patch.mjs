import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

await mkdir('test-runs', { recursive: true });
const outfile = 'test-runs/destiny-patch-test.bundle.mjs';
await build({
  entryPoints: ['src/v2/engine.ts', 'src/v2/patch.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  outdir: 'test-runs/destiny-patch-test',
  entryNames: '[name]',
  alias: { '@': './src' },
  logLevel: 'silent',
});

const engine = await import(`${pathToFileURL('test-runs/destiny-patch-test/engine.js').href}?t=${Date.now()}`);
const patchModule = await import(`${pathToFileURL('test-runs/destiny-patch-test/patch.js').href}?t=${Date.now()}`);

const warnings = [];
const normalized = engine.normalizeDestinyPatch({
  completionEstimate: 52,
  completionReason: '转学改变了路径，但故事仍在靠近最终重逢。',
  beatChanges: [{ beatId: 'beat-reunion', status: 'available', evidenceSummary: '公开名单已经出现。' }],
}, warnings);
assert.ok(normalized.reason, '应补全 destiny.reason');
assert.ok(normalized.beatChanges[0].reason, '应补全 beatChanges[].reason');
assert.deepEqual(warnings.map((item) => item.code), ['destiny_reason_defaulted', 'beat_reason_defaulted']);

const state = {
  schemaVersion: 2,
  revision: 0,
  turn: 3,
  phase: 'generating',
  mode: 'author',
  narrativePace: 'standard',
  history: [],
  summary: '',
  characters: [],
  relationships: [],
  inventory: [],
  storyThreads: [],
  facts: [],
  availableActions: [],
  destiny: {
    completionEstimate: 40,
    completionReason: '旧估值',
    currentActId: 'act-2',
    currentStage: '第二幕',
    currentPath: '旧路径',
    beats: [{ beatId: 'beat-reunion', status: 'pending', evidenceTurns: [], updatedAtTurn: 0 }],
    endingReached: false,
    updatedAtTurn: 0,
  },
  randomEvent: { nextTriggerTurn: 99, pending: false, intensity: 'related' },
};

// 即使绕过engine规范化直接提交缺reason的供应商输出，也不能丢掉命运块。
const committed = patchModule.commitTurnPatchV2(state, {
  schemaVersion: 2,
  commitId: 'test-commit',
  baseRevision: 0,
  turn: 3,
  roundSummary: '测试',
  latestProgress: '测试',
  destiny: {
    completionEstimate: 52,
    completionReason: '新估值',
    currentPath: '新路径',
    beatChanges: [{ beatId: 'beat-reunion', status: 'available', evidenceSummary: '公开名单已经出现。' }],
  },
});
assert.equal(committed.destiny.completionEstimate, 52);
assert.equal(committed.destiny.currentPath, '新路径');
assert.equal(committed.destiny.beats[0].status, 'available');
assert.deepEqual(committed.destiny.beats[0].evidenceTurns, []);
assert.equal(committed.destiny.updatedAtTurn, 3);

console.log('destiny patch normalization and partial commit: ok');
