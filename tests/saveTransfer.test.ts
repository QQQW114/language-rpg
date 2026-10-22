// 第一条 import：zustand persist 在 store 模块求值时就会读取 localStorage，而 saveTransfer
// 依赖 store 的规范化函数（sanitizeSaveV2），因此必须先安装内存桩。
import './helpers/localStorageStub';

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import packageJson from '../package.json';
import {
  IMPORT_SAVE_NAME_SUFFIX,
  SAVE_EXPORT_KIND,
  SAVE_EXPORT_META_BEATS_LIMIT,
  SAVE_EXPORT_VERSION,
  SUPPORTED_STATE_SCHEMA_VERSION,
  buildSaveExport,
  parseSaveImport,
  resolveImportedSaveName,
  safeSaveFilename,
  saveExportFilename,
  serializeSaveExport,
} from '@/v2/saveTransfer';
import { useGameStoreV2, type SaveV2 } from '@/v2/store';
import { makeBackground, makeOutline, makeSettings, makeState } from './helpers/fixtures';

const FIXED_DATE = new Date('2026-10-20T08:00:00.000Z');

/**
 * 一份"内容齐全"的存档。
 * 显式给 `turnRecords: []`，这样 hydrate 规范化补出的空数组与原始 state 一致，
 * 导出→导入可以整体 deepEqual 状态。
 */
function makeSave(overrides: Record<string, unknown> = {}): SaveV2 {
  return {
    id: 'save-original',
    name: '旧日旅程',
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_100_000,
    outline: makeOutline(),
    background: makeBackground(),
    worldFacts: [],
    state: makeState({ turnRecords: [] }),
    ...overrides,
  } as SaveV2;
}

function indexSaves(...saves: SaveV2[]): Record<string, SaveV2> {
  return Object.fromEntries(saves.map((save) => [save.id, save]));
}

/**
 * 25 个故事节、停在第二幕、带灵魂画像的存档：用于验证 meta.finalStateSummary 的摘要与截断。
 * 注意 destinity 的 currentActId 与 outline 一致，导入时 hydrate 不会纠正幕序。
 */
function makeRichSave(): SaveV2 {
  const outline = makeOutline({
    acts: [
      {
        id: 'act-1', title: '第一幕 · 雨夜', purpose: '建立日常',
        beats: [{ id: 'beat-a', title: '开场', purpose: '建立日常状态' }],
      },
      {
        id: 'act-2', title: '第二幕 · 群聊风暴', purpose: '推进冲突',
        beats: [{ id: 'beat-b', title: '抉择', purpose: '主角做出选择' }],
      },
      {
        id: 'act-3', title: '第三幕 · 收束', purpose: '收尾',
        beats: [{ id: 'beat-c', title: '结局', purpose: '走到预设终点' }],
      },
    ],
  });
  return makeSave({
    outline,
    state: makeState({
      turnRecords: [],
      soulProfile: '腹黑乐子人：笑着把麻烦推回去，但对旧信物心软',
      storyAutonomy: 'co_author',
      destiny: {
        completionEstimate: 62,
        completionReason: '第二幕推进中',
        currentActId: 'act-2',
        currentActIndex: 1,
        currentStage: '第二幕',
        currentPath: '改道',
        nextMilestone: '群聊误会澄清',
        convergencePlan: '顺势收束',
        beats: Array.from({ length: 25 }, (_, index) => ({
          beatId: `beat-${index + 1}`,
          actId: index < 3 ? 'act-2' : 'act-3',
          status: index % 2 === 0 ? 'pending' : 'satisfied',
          evidenceTurns: [],
          updatedAtTurn: 3,
        })),
        actHistory: [],
        endingReached: false,
        updatedAtTurn: 5,
      },
    }),
  });
}

describe('saveTransfer — 导出信封', () => {
  it('信封字段齐全且顺序固定，exportedAt 为 ISO 字符串', () => {
    const envelope = buildSaveExport(makeSave(), FIXED_DATE);
    assert.deepEqual(Object.keys(envelope), ['kind', 'version', 'exportedAt', 'meta', 'save']);
    assert.equal(envelope.kind, SAVE_EXPORT_KIND);
    assert.equal(envelope.kind, 'lrpg-save');
    assert.equal(envelope.version, SAVE_EXPORT_VERSION);
    assert.equal(envelope.version, 1);
    assert.equal(envelope.exportedAt, '2026-10-20T08:00:00.000Z');
    // 存档顶层字段也按固定顺序重建，便于 diff / 人工检查（meta 不改变嵌套 save）。
    assert.deepEqual(Object.keys(envelope.save), [
      'id', 'name', 'createdAt', 'updatedAt', 'outline', 'background', 'worldFacts', 'state',
    ]);
  });

  it('没有大纲/出身时不写出 undefined 键（避免 JSON 里出现 null 噪音）', () => {
    const envelope = buildSaveExport(makeSave({ outline: undefined, background: undefined }), FIXED_DATE);
    assert.deepEqual(Object.keys(envelope.save), [
      'id', 'name', 'createdAt', 'updatedAt', 'worldFacts', 'state',
    ]);
  });

  it('剔除 lastTurnCheckpoint 与 turnRecords[].calls[].input（与 localStorage 持久化一致）', () => {
    const save = makeSave({
      lastTurnCheckpoint: {
        stateBeforeTurn: makeState(),
        input: '上一轮输入',
        narrativePace: 'standard',
        completedAt: 1,
        afterRevision: 3,
        afterTurn: 7,
      },
      state: makeState({
        turnRecords: [{
          turn: 1,
          input: '推进一回合',
          story: '故事正文',
          calls: [
            { phase: 'story', model: 'test-model', input: { system: 'S', user: 'U' }, output: '出参' },
          ],
        }],
      }),
    });
    const envelope = buildSaveExport(save, FIXED_DATE);
    assert.equal('lastTurnCheckpoint' in envelope.save, false, '回退点只服务当前页面会话，不进备份');
    const call = envelope.save.state.turnRecords?.[0].calls[0];
    assert.ok(call, 'turnRecords 应保留');
    assert.equal('input' in call, false, '提示词留档体积占 97%，不应进入备份');
    assert.equal(call.output, '出参', '出参仍然保留');
  });

  it('serializeSaveExport 输出可 JSON.parse 的 pretty JSON', () => {
    const json = serializeSaveExport(makeSave(), FIXED_DATE);
    assert.ok(json.includes('\n  "kind": "lrpg-save"'), '应为两空格缩进的 pretty JSON');
    const reparsed = JSON.parse(json) as { kind?: string; save?: { name?: string } };
    assert.equal(reparsed.kind, SAVE_EXPORT_KIND);
    assert.equal(reparsed.save?.name, '旧日旅程');
  });
});

describe('saveTransfer — 导出 meta（复盘用，无密钥）', () => {
  /** 用于断言"绝不泄露"的设置：两把不同的 Key + 两个不同的 Base URL。 */
  const settingsWithSecrets = () => makeSettings({
    apiKey: 'sk-global-secret-key',
    storyApiKey: 'sk-story-secret-key',
    apiBaseUrl: 'https://planner-relay.invalid/v1',
    storyApiBaseUrl: 'https://story-relay.invalid/v1',
    inputPerspective: 'director',
    plannerToolsEnabled: true,
    plannerWebSearchEnabled: true,
    storyModel: 'gemini-3.8-flash-high',
    storyMaxTokens: 4096,
  });

  it('meta 结构齐全且顺序固定：版本/设置/大纲出身 id/末态摘要', () => {
    const envelope = buildSaveExport(makeRichSave(), FIXED_DATE, { settings: settingsWithSecrets() });
    assert.ok(envelope.meta);
    assert.deepEqual(Object.keys(envelope.meta), [
      'version', 'settings', 'outlineId', 'backgroundId', 'finalStateSummary',
    ]);
    // 版本读 package.json，发版 bump 后自动同步（不硬编码，避免与真实版本漂移）。
    assert.equal(envelope.meta.version, packageJson.version);
    assert.equal(envelope.meta.outlineId, 'outline-test-1');
    assert.equal(envelope.meta.backgroundId, 'bg-test-1');

    const summary = envelope.meta.finalStateSummary;
    assert.deepEqual(Object.keys(summary), ['act', 'actIndex', 'completion', 'soulProfile', 'beats']);
    assert.equal(summary.act, '第二幕 · 群聊风暴');
    assert.equal(summary.actIndex, 1);
    assert.equal(summary.completion, 62);
    assert.equal(summary.soulProfile, '腹黑乐子人：笑着把麻烦推回去，但对旧信物心软');
    assert.equal(summary.beats.length, SAVE_EXPORT_META_BEATS_LIMIT, 'beats 截断到上限');
    assert.deepEqual(summary.beats[0], { id: 'beat-1', status: 'pending' });
    assert.deepEqual(summary.beats[1], { id: 'beat-2', status: 'satisfied' });
  });

  it('settings 快照含行为参数但不含 API Key / Base URL，只记录是否使用独立 story 连接', () => {
    const json = serializeSaveExport(makeRichSave(), FIXED_DATE, { settings: settingsWithSecrets() });
    // 两把 Key、全局/独立 Base URL 都不得出现在导出文件中。
    for (const secret of [
      'sk-global-secret-key',
      'sk-story-secret-key',
      'planner-relay.invalid',
      'story-relay.invalid',
      'api.test.invalid', // makeSettings 的默认全局 base
    ]) {
      assert.equal(json.includes(secret), false, `导出文件不应包含 ${secret}`);
    }
    const meta = (JSON.parse(json) as { meta: { settings: Record<string, unknown> } }).meta;
    assert.equal('apiKey' in meta.settings, false);
    assert.equal('storyApiKey' in meta.settings, false);
    assert.equal('apiBaseUrl' in meta.settings, false);
    assert.equal('storyApiBaseUrl' in meta.settings, false);
    assert.equal(meta.settings.inputPerspective, 'director');
    assert.equal(meta.settings.storyModel, 'gemini-3.8-flash-high');
    assert.equal(meta.settings.storyProfile, 'expressive');
    assert.equal(meta.settings.storyAutonomy, 'co_author');
    assert.equal(meta.settings.narrativePace, 'standard');
    assert.equal(meta.settings.storyMaxTokens, 4096);
    assert.equal(meta.settings.plannerToolsEnabled, true);
    assert.equal(meta.settings.plannerWebSearchEnabled, true);
    assert.equal(meta.settings.storyApiBaseOverridden, true);
    assert.equal(meta.settings.storyApiKeyOverridden, true);
  });

  it('默认设置：独立连接标记为 false，未知模型推导 compact 文风', () => {
    const meta = buildSaveExport(makeSave(), FIXED_DATE, { settings: makeSettings() }).meta;
    assert.ok(meta?.settings);
    assert.equal(meta.settings.storyApiBaseOverridden, false);
    assert.equal(meta.settings.storyApiKeyOverridden, false);
    assert.equal(meta.settings.storyProfile, 'compact', 'test-story-model 不匹配 expressive 白名单');
    assert.equal(meta.settings.mode, 'author');
    assert.equal(meta.settings.storyAutonomy, 'standard');
  });

  it('meta 不存在时不报错（未提供设置时省略 settings），其余摘要仍在', () => {
    const envelope = buildSaveExport(makeSave(), FIXED_DATE);
    assert.ok(envelope.meta);
    assert.equal('settings' in envelope.meta, false);
    assert.equal(envelope.meta.version, packageJson.version);
    assert.equal(envelope.meta.finalStateSummary.act, '第一幕');
    assert.equal(envelope.meta.finalStateSummary.actIndex, 0);
    assert.equal(envelope.meta.finalStateSummary.beats.length, 2);
  });

  it('导出 → JSON 往返保留 meta；导入仍只读取嵌套 save（meta 不影响存档本体）', () => {
    const settings = settingsWithSecrets();
    const save = makeRichSave();
    const built = buildSaveExport(save, FIXED_DATE, { settings });
    const reparsed = JSON.parse(serializeSaveExport(save, FIXED_DATE, { settings })) as {
      meta: unknown;
      save: unknown;
    };
    assert.deepEqual(reparsed.meta, built.meta);
    assert.deepEqual(reparsed.save, JSON.parse(JSON.stringify(built.save)));

    const imported = parseSaveImport(serializeSaveExport(save, FIXED_DATE, { settings }));
    assert.equal(imported.ok, true);
    assert.deepEqual(imported.save?.state, save.state, '导入后状态与导出时一致');
    // meta 只在信封顶层：导入结果（SaveV2）里不可能带出设置或 Key。
    assert.equal(JSON.stringify(imported.save).includes('sk-story-secret-key'), false);
  });

  it('旧信封没有 meta 仍可导入；meta 体积 < 2KB', () => {
    // 兼容性：meta 是导出侧新增的可选字段，旧备份文件（无 meta）必须照常导入。
    const legacyEnvelope = {
      kind: SAVE_EXPORT_KIND,
      version: SAVE_EXPORT_VERSION,
      exportedAt: FIXED_DATE.toISOString(),
      save: makeSave(),
    };
    const imported = parseSaveImport(legacyEnvelope);
    assert.equal(imported.ok, true);
    assert.deepEqual(imported.save?.state, makeSave().state);

    // 体积目标：完整设置快照 + 20 条故事节摘要也要 <2KB（不含嵌套 save）。
    const meta = buildSaveExport(makeRichSave(), FIXED_DATE, { settings: settingsWithSecrets() }).meta;
    assert.ok(JSON.stringify(meta).length < 2048, `meta 体积 ${JSON.stringify(meta).length} 字节`);
  });

  it('meta 不改变嵌套 save 与文件名逻辑', () => {
    const settings = settingsWithSecrets();
    const save = makeSave();
    const withMeta = buildSaveExport(save, FIXED_DATE, { settings });
    const withoutMetaSettings = buildSaveExport(save, FIXED_DATE);
    assert.deepEqual(withMeta.save, withoutMetaSettings.save, 'meta 只加在信封顶层');
    assert.equal(saveExportFilename(save, FIXED_DATE), '旧日旅程-存档-2026-10-20.json');
  });
});

describe('saveTransfer — 导入解析与版本守卫', () => {
  it('信封序列化 → 解析往返：状态/大纲/出身一致，id 重新生成，名称与创建时间保留', () => {
    const save = makeSave();
    const parsed = parseSaveImport(serializeSaveExport(save, FIXED_DATE));
    assert.equal(parsed.ok, true);
    assert.equal(parsed.issues.length, 0);
    assert.ok(parsed.save);
    assert.notEqual(parsed.save.id, save.id, '导入必须换新 id');
    assert.match(parsed.save.id, /^save_/);
    assert.equal(parsed.save.name, save.name);
    assert.equal(parsed.save.createdAt, save.createdAt);
    assert.equal(parsed.save.updatedAt, save.updatedAt);
    assert.deepEqual(parsed.save.state, save.state);
    assert.deepEqual(parsed.save.outline, save.outline);
    assert.deepEqual(parsed.save.background, save.background);
    assert.equal(parsed.save.lastTurnCheckpoint, undefined);
  });

  // 回归：sanitizeGameStateV2 的 randomEvent 分支补 spread 后，导入/导出不得再丢「故事脉动」
  // 的审计字段（与 tests/store.test.ts 的 hydrate 回归对应）。
  it('导入 → 导出往返保留 randomEvent 的审计字段（lastPlan / lastNote / lastTriggeredTurn）', () => {
    const source = makeSave({
      state: makeState({
        turnRecords: [],
        randomEvent: {
          enabled: true,
          nextTriggerTurn: 9,
          pending: true,
          intensity: 'destiny',
          lastTriggeredTurn: 6,
          triggerIntervalMin: 2,
          triggerIntervalMax: 8,
          lastPlan: '安排一场雨夜偶遇',
          lastNote: '事件已发生：旧信被找到',
        },
      }),
    });
    const parsed = parseSaveImport(serializeSaveExport(source, FIXED_DATE));
    assert.equal(parsed.ok, true);
    assert.ok(parsed.save);
    const randomEvent = parsed.save.state.randomEvent;
    assert.equal(randomEvent.lastPlan, '安排一场雨夜偶遇');
    assert.equal(randomEvent.lastNote, '事件已发生：旧信被找到');
    assert.equal(randomEvent.lastTriggeredTurn, 6);

    // 再导出再导入一次：审计字段不会在往返中流失。
    const again = parseSaveImport(serializeSaveExport(parsed.save, FIXED_DATE));
    assert.equal(again.ok, true);
    assert.deepEqual(again.save?.state.randomEvent, randomEvent);
  });

  it('接受裸 SaveV2（无信封），并且不修改传入对象', () => {
    const original = makeSave();
    const parsed = parseSaveImport(original);
    assert.equal(parsed.ok, true);
    assert.ok(parsed.save);
    assert.notEqual(parsed.save.id, original.id);
    assert.equal(original.id, 'save-original');
    assert.equal(original.state.mode, 'author', '输入对象保持原样');
  });

  it('信封 version 高于当前时拒绝，并给出可读原因', () => {
    const parsed = parseSaveImport({
      kind: SAVE_EXPORT_KIND,
      version: SAVE_EXPORT_VERSION + 1,
      exportedAt: FIXED_DATE.toISOString(),
      save: makeSave(),
    });
    assert.equal(parsed.ok, false);
    assert.equal(parsed.save, undefined);
    assert.ok(parsed.issues.some((item) => item.path === 'version'));
    assert.ok(parsed.issues.some((item) => /高于当前支持的版本/.test(item.message)));
    assert.ok(parsed.issues.some((item) => item.message.includes(String(SAVE_EXPORT_VERSION + 1))));
  });

  it('信封版本号缺失/无法识别时拒绝', () => {
    const parsed = parseSaveImport({
      kind: SAVE_EXPORT_KIND,
      version: undefined,
      exportedAt: FIXED_DATE.toISOString(),
      save: makeSave(),
    });
    assert.equal(parsed.ok, false);
    assert.ok(parsed.issues.some((item) => item.code === 'invalid_version'));
  });

  it('save.state.schemaVersion 高于当前支持版本时拒绝', () => {
    const parsed = parseSaveImport(makeSave({
      state: makeState({ schemaVersion: SUPPORTED_STATE_SCHEMA_VERSION + 1, turnRecords: [] }),
    }));
    assert.equal(parsed.ok, false);
    assert.equal(parsed.save, undefined);
    assert.ok(parsed.issues.some((item) => item.path === 'state.schemaVersion'));
    assert.ok(parsed.issues.some((item) => /状态版本/.test(item.message)));
  });

  it('畸形 JSON 返回 issues 而不是抛异常', () => {
    const parsed = parseSaveImport('{"kind":"lrpg-save","version":1,');
    assert.equal(parsed.ok, false);
    assert.ok(parsed.issues.some((item) => item.code === 'invalid_json'));
    assert.ok(parsed.issues.some((item) => /JSON 解析失败/.test(item.message)));
  });

  it('缺 state 的输入返回可读 issues（裸存档 / 信封分别带路径前缀）', () => {
    const bare = parseSaveImport({ id: 'save-x', name: '没有状态' });
    assert.equal(bare.ok, false);
    assert.ok(bare.issues.some((item) => item.path === 'state' && item.code === 'missing_state'));

    const enveloped = parseSaveImport({
      kind: SAVE_EXPORT_KIND,
      version: SAVE_EXPORT_VERSION,
      exportedAt: FIXED_DATE.toISOString(),
      save: { id: 'save-x', name: '没有状态' },
    });
    assert.equal(enveloped.ok, false);
    assert.ok(enveloped.issues.some((item) => item.path === 'save.state'));
  });

  it('不是存档文件（非对象 / 其他 kind）给出可读原因', () => {
    const arrayInput = parseSaveImport('[]');
    assert.equal(arrayInput.ok, false);
    assert.ok(arrayInput.issues.some((item) => item.code === 'invalid_type'));

    const contentPackage = parseSaveImport({
      kind: 'language-rpg.content-library',
      version: 1,
      exportedAt: Date.now(),
      content: { outlines: [] },
    });
    assert.equal(contentPackage.ok, false);
    assert.ok(contentPackage.issues.some((item) => item.code === 'unknown_kind'));
    assert.ok(contentPackage.issues.some((item) => /不是言灵存档文件/.test(item.message)));
  });

  it('缺字段的旧档能规范化而不抛错（数组补空、枚举补默认值）', () => {
    const legacy = {
      id: 'save-legacy',
      name: '旧档',
      createdAt: 1,
      updatedAt: 2,
      state: {
        schemaVersion: 2,
        revision: 2,
        turn: 4,
        phase: 'input',
        mode: 'author',
        history: [{ id: 'm1', role: 'assistant', content: '开场' }],
        summary: '旧摘要',
        facts: [{ id: 'fact-1', subjectId: 'char-a', predicate: 'occupation', value: '医生' }],
      },
    };
    const parsed = parseSaveImport(legacy);
    assert.equal(parsed.ok, true);
    assert.ok(parsed.save);
    const state = parsed.save.state;
    assert.deepEqual(state.storyThreads, []);
    assert.deepEqual(state.inventory, []);
    assert.deepEqual(state.relationships, []);
    assert.deepEqual(state.turnRecords, []);
    assert.deepEqual(state.facts[0].keywords, [], 'facts[].keywords 是已知崩溃点，必须补成数组');
    assert.equal(state.history[0].turn, 0);
    assert.equal(state.history[0].createdAt, 0);
    assert.equal(state.destiny.completionEstimate, 0);
    assert.equal(state.randomEvent.enabled, true);
    assert.equal(state.randomEvent.triggerIntervalMin, 3);
  });
});

describe('saveTransfer — id 与重名策略', () => {
  it('导入一律生成新 id：文件 id 与现有存档相同也不会覆盖', () => {
    const existing = indexSaves(makeSave({ id: 'save-collision', name: '现有旅程' }));
    const parsed = parseSaveImport(makeSave({ id: 'save-collision' }), { existingSaves: existing });
    assert.equal(parsed.ok, true);
    assert.ok(parsed.save);
    assert.notEqual(parsed.save.id, 'save-collision');
    assert.equal(parsed.save.id in existing, false);
    assert.equal(existing['save-collision'].name, '现有旅程', '现有存档不被改写');
  });

  it('同一份文件连续导入两次得到两个不同 id', () => {
    const first = parseSaveImport(makeSave());
    const second = parseSaveImport(makeSave());
    assert.ok(first.save && second.save);
    assert.notEqual(first.save.id, second.save.id);
  });

  it('名称冲突时加「（导入）」后缀，再次冲突递增为「（导入 2）」', () => {
    const existing = indexSaves(makeSave({ id: 'save-a', name: '旧日旅程' }));
    const first = parseSaveImport(makeSave(), { existingSaves: existing });
    assert.equal(first.save?.name, `旧日旅程${IMPORT_SAVE_NAME_SUFFIX}`);

    const existingAgain = indexSaves(
      makeSave({ id: 'save-a', name: '旧日旅程' }),
      makeSave({ id: 'save-b', name: `旧日旅程${IMPORT_SAVE_NAME_SUFFIX}` }),
    );
    const second = parseSaveImport(makeSave(), { existingSaves: existingAgain });
    assert.equal(second.save?.name, '旧日旅程（导入 2）');
  });

  it('resolveImportedSaveName 直接测：无冲突保留原名，空名回退默认名', () => {
    assert.equal(resolveImportedSaveName('新旅程', {}), '新旅程');
    assert.equal(resolveImportedSaveName('   ', {}), '未命名旅程');
  });
});

describe('saveTransfer — 与 store.importSave 的集成', () => {
  it('导出 → 解析 → 落库：得到可继续游玩的新存档，不覆盖已有存档、不切换 activeId', () => {
    const store = () => useGameStoreV2.getState();
    useGameStoreV2.setState({ saves: {}, activeId: undefined });
    const existingId = store().create({ name: '旧日旅程', mode: 'author' });
    // 文件里的 id 与名称都故意和现有存档冲突。
    const source = makeSave({ id: existingId, name: '旧日旅程' });
    const parsed = parseSaveImport(serializeSaveExport(source, FIXED_DATE), {
      existingSaves: store().saves,
    });
    assert.ok(parsed.save);
    assert.equal(parsed.save.name, `旧日旅程${IMPORT_SAVE_NAME_SUFFIX}`, '重名加后缀');

    const id = store().importSave(parsed.save);
    const saved = store().saves[id];
    assert.ok(saved);
    assert.notEqual(id, existingId, '不覆盖已有存档');
    assert.equal(saved.name, `旧日旅程${IMPORT_SAVE_NAME_SUFFIX}`);
    assert.equal(saved.state.turn, source.state.turn);
    assert.equal(store().activeId, existingId, '导入不切换 activeId');
    // 清场，避免影响同一文件内的其它用例。
    store().remove(id);
    store().remove(existingId);
  });
});

describe('saveTransfer — 文件名', () => {
  it('safeSaveFilename 去掉路径非法字符并压平空白，空名回退默认值', () => {
    assert.equal(safeSaveFilename('旧日/旅程: 第一章'), '旧日-旅程-第一章');
    assert.equal(safeSaveFilename('  a\\b*c?d"e<f>g|h  '), 'a-b-c-d-e-f-g-h');
    assert.equal(safeSaveFilename('   '), 'language-rpg-save');
    assert.equal(safeSaveFilename('...'), 'language-rpg-save');
  });

  it('saveExportFilename 带安全的日期后缀', () => {
    assert.equal(saveExportFilename(makeSave(), FIXED_DATE), '旧日旅程-存档-2026-10-20.json');
    assert.equal(
      saveExportFilename(makeSave({ name: 'A/B' }), FIXED_DATE),
      'A-B-存档-2026-10-20.json',
    );
  });
});
