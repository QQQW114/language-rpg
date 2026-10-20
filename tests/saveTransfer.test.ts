// 第一条 import：zustand persist 在 store 模块求值时就会读取 localStorage，而 saveTransfer
// 依赖 store 的规范化函数（sanitizeSaveV2），因此必须先安装内存桩。
import './helpers/localStorageStub';

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  IMPORT_SAVE_NAME_SUFFIX,
  SAVE_EXPORT_KIND,
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
import { makeBackground, makeOutline, makeState } from './helpers/fixtures';

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

describe('saveTransfer — 导出信封', () => {
  it('信封字段齐全且顺序固定，exportedAt 为 ISO 字符串', () => {
    const envelope = buildSaveExport(makeSave(), FIXED_DATE);
    assert.deepEqual(Object.keys(envelope), ['kind', 'version', 'exportedAt', 'save']);
    assert.equal(envelope.kind, SAVE_EXPORT_KIND);
    assert.equal(envelope.kind, 'lrpg-save');
    assert.equal(envelope.version, SAVE_EXPORT_VERSION);
    assert.equal(envelope.version, 1);
    assert.equal(envelope.exportedAt, '2026-10-20T08:00:00.000Z');
    // 存档顶层字段也按固定顺序重建，便于 diff / 人工检查。
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
