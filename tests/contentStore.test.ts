// 必须先安装 localStorage 内存桩：persist 在 store 模块求值时就会读取它。
import { clearPersisted, readPersisted, seedPersisted } from './helpers/localStorageStub';

import { beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  flattenWorldBookEntries,
  selectAllBackgrounds,
  selectAllOutlines,
  selectAllWorldBooks,
  useContentStore,
} from '@/store/useContentStore';
import { CONTENT_EXPORT_KIND, CONTENT_EXPORT_VERSION } from '@/lib/contentLibrary';
import { PRESET_OUTLINES } from '@/presets/outlines';
import { PRESET_WORLDBOOKS } from '@/presets/worldbooks';
import { PRESET_BACKGROUNDS } from '@/presets/backgrounds';
import { makeBackground, makeWorldBook } from './helpers/fixtures';

const state = () => useContentStore.getState();
const persistApi = () => (useContentStore as unknown as { persist: { rehydrate: () => Promise<void>; getOptions: () => { storage?: unknown } } }).persist;

/** 构造一个校验能通过的原始大纲对象。 */
function rawOutline(id: string, title = '自定义故事') {
  return {
    id,
    title,
    synopsis: '一个自定义故事。',
    tone: '冷静',
    worldBookIds: [],
    acts: [{ id: `${id}-act`, title: '第一幕', purpose: '建立日常', beats: [{ id: `${id}-beat`, title: '开场', purpose: '建立主角的日常状态' }] }],
  };
}

beforeEach(() => {
  useContentStore.setState({ customOutlines: [], customBackgrounds: [], customWorldBooks: [] });
  clearPersisted();
});

describe('useContentStore — 环境', () => {
  it('localStorage 桩在 store 建立时已可用', () => {
    assert.ok(persistApi().getOptions().storage, 'persist 未拿到 storage');
  });
});

describe('useContentStore — addOutline / updateOutline', () => {
  it('使用内置预设 id 时返回 preset_id_conflict 且不写入', () => {
    const result = state().addOutline(rawOutline('outline_misplaced_youth', '伪装成预设') as any);
    assert.equal(result.ok, false);
    assert.equal(result.issues[0].code, 'preset_id_conflict');
    assert.equal(result.issues[0].kind, 'outline');
    assert.deepEqual(state().customOutlines, []);
  });

  it('同 id 二次添加返回 custom_id_conflict，且不覆盖已有内容', () => {
    const first = state().addOutline(rawOutline('outline_custom_1') as any);
    assert.equal(first.ok, true);
    assert.deepEqual(first.issues, []);
    assert.equal(state().customOutlines.length, 1);

    const second = state().addOutline(rawOutline('outline_custom_1', '另一个标题') as any);
    assert.equal(second.ok, false);
    assert.equal(second.issues[0].code, 'custom_id_conflict');
    assert.equal(state().customOutlines.length, 1);
    assert.equal(state().customOutlines[0].title, '自定义故事');
  });

  it('校验失败时直接返回 issues（写入 0 条）', () => {
    const result = state().addOutline({ id: 'outline_bad', title: '', synopsis: '', acts: [] } as any);
    assert.equal(result.ok, false);
    assert.deepEqual(result.issues.map((issue) => issue.path), ['title', 'synopsis', 'acts']);
    assert.deepEqual(state().customOutlines, []);
  });

  it('updateOutline 覆盖自定义内容；同 id 不存在时等同于新增', () => {
    state().addOutline(rawOutline('outline_custom_2') as any);
    const updated = state().updateOutline(rawOutline('outline_custom_2', '改后的标题') as any);
    assert.equal(updated.ok, true);
    assert.equal(state().customOutlines.length, 1);
    assert.equal(state().customOutlines[0].title, '改后的标题');
    assert.equal(state().customOutlines[0].acts[0].beats[0].purpose, '建立主角的日常状态', '校验会保留故事节');

    const added = state().updateOutline(rawOutline('outline_custom_3') as any);
    assert.equal(added.ok, true);
    assert.equal(state().customOutlines.length, 2);
  });

  it('updateOutline 不能覆盖内置预设', () => {
    const result = state().updateOutline(rawOutline('outline_misplaced_youth') as any);
    assert.equal(result.ok, false);
    assert.equal(result.issues[0].code, 'preset_id_conflict');
  });

  it('removeOutline 只删除指定 id', () => {
    state().addOutline(rawOutline('outline_a') as any);
    state().addOutline(rawOutline('outline_b') as any);
    state().removeOutline('outline_a');
    assert.deepEqual(state().customOutlines.map((outline) => outline.id), ['outline_b']);
  });
});

describe('useContentStore — 出身与世界书', () => {
  it('addBackground / addWorldBook 正常写入，预设 id 被拒绝', () => {
    assert.equal(state().addBackground(makeBackground({ id: 'bg_custom_1' }) as any).ok, true);
    assert.equal(state().customBackgrounds.length, 1);
    assert.equal(state().addBackground(makeBackground({ id: 'bg_freshman_xiyu' }) as any).issues[0].code, 'preset_id_conflict');

    assert.equal(state().addWorldBook(makeWorldBook({ id: 'wb_custom_1' }) as any).ok, true);
    assert.equal(state().customWorldBooks.length, 1);
    assert.equal(state().addWorldBook(makeWorldBook({ id: 'wb_misplaced_youth' }) as any).issues[0].code, 'preset_id_conflict');

    state().removeBackground('bg_custom_1');
    state().removeWorldBook('wb_custom_1');
    assert.deepEqual(state().customBackgrounds, []);
    assert.deepEqual(state().customWorldBooks, []);
  });

  it('clearCustom 清空全部自定义内容', () => {
    state().addOutline(rawOutline('outline_a') as any);
    state().addBackground(makeBackground({ id: 'bg_custom_1' }) as any);
    state().addWorldBook(makeWorldBook({ id: 'wb_custom_1' }) as any);
    state().clearCustom();
    assert.deepEqual(state().customOutlines, []);
    assert.deepEqual(state().customBackgrounds, []);
    assert.deepEqual(state().customWorldBooks, []);
    assert.deepEqual(readPersisted('lrpg.content'), {
      state: { customOutlines: [], customBackgrounds: [], customWorldBooks: [] },
      version: 3,
    });
  });
});

describe('useContentStore — import / export', () => {
  it('importBundle 跳过内置预设与同 id 冲突，replaceCustom 时覆盖', () => {
    state().addOutline(rawOutline('outline_dup', '已有版本') as any);

    const conflict = state().importBundle({ outlines: [rawOutline('outline_dup', '导入版本')] });
    assert.equal(conflict.added, 0);
    assert.equal(conflict.updated, 0);
    assert.equal(conflict.skipped, 1);
    assert.equal(conflict.issues[0].code, 'custom_id_conflict');
    assert.equal(state().customOutlines[0].title, '已有版本');

    const replaced = state().importBundle({ outlines: [rawOutline('outline_dup', '覆盖版本')] }, { replaceCustom: true });
    assert.equal(replaced.updated, 1);
    assert.equal(state().customOutlines.length, 1);
    assert.equal(state().customOutlines[0].title, '覆盖版本');

    const preset = state().importBundle({ outlines: [rawOutline('outline_misplaced_youth')] });
    assert.equal(preset.skipped, 1);
    assert.equal(preset.issues[0].code, 'preset_id_conflict');

    const fresh = state().importBundle({ outlines: [rawOutline('outline_new')] });
    assert.equal(fresh.added, 1);
    assert.equal(state().customOutlines.length, 2);
  });

  it('importBundle 汇总校验问题并保留可导入项', () => {
    const result = state().importBundle({ outlines: [{ title: '' }], worldBooks: [makeWorldBook({ id: 'wb_imported' })] });
    assert.equal(result.added, 1);
    assert.ok(result.issues.some((issue) => issue.code === 'required'));
    assert.deepEqual(state().customWorldBooks.map((book) => book.id), ['wb_imported']);
  });

  it('exportBundle 输出稳定外壳且内容是副本', () => {
    state().addOutline(rawOutline('outline_export') as any);
    const exported = state().exportBundle();
    assert.equal(exported.kind, CONTENT_EXPORT_KIND);
    assert.equal(exported.version, CONTENT_EXPORT_VERSION);
    assert.deepEqual(exported.content.outlines.map((outline) => outline.id), ['outline_export']);
    assert.notEqual(exported.content.outlines, state().customOutlines);
  });

  it('选择器合并预设与自定义，且自定义不会覆盖预设', () => {
    state().addOutline(rawOutline('outline_custom_sel') as any);
    const outlines = selectAllOutlines(state());
    assert.ok(outlines.length >= PRESET_OUTLINES.length + 1);
    assert.equal(outlines.filter((outline) => outline.id === 'outline_custom_sel').length, 1);
    assert.ok(outlines.some((outline) => outline.id === 'outline_misplaced_youth'));
    assert.equal(selectAllBackgrounds(state()).length, PRESET_BACKGROUNDS.length);
    assert.equal(selectAllWorldBooks(state()).length, PRESET_WORLDBOOKS.length);
  });

  it('flattenWorldBookEntries 只展开被选中的世界书', () => {
    const first = makeWorldBook();
    const second = makeWorldBook({ id: 'wb-2', entries: [{ id: 'wbe-2', name: '第二条', content: '正文', keywords: [] }] });
    assert.deepEqual(flattenWorldBookEntries([first, second], ['wb-2']).map((entry) => entry.id), ['wbe-2']);
    assert.deepEqual(flattenWorldBookEntries([first, second], []), []);
  });
});

describe('useContentStore — 持久化兼容', () => {
  it('v3 数据可以正常 hydrate', async () => {
    seedPersisted('lrpg.content', {
      customOutlines: [rawOutline('outline_v3')],
      customBackgrounds: [makeBackground({ id: 'bg_v3' })],
      customWorldBooks: [makeWorldBook({ id: 'wb_v3' })],
    }, 3);
    await persistApi().rehydrate();
    assert.deepEqual(state().customOutlines.map((outline) => outline.id), ['outline_v3']);
    assert.deepEqual(state().customBackgrounds.map((background) => background.id), ['bg_v3']);
    assert.deepEqual(state().customWorldBooks.map((book) => book.id), ['wb_v3']);
  });

  it('旧版本数据（含已废弃 customEvents / customWorkspaceTemplates）静默丢弃且不报错', async () => {
    seedPersisted('lrpg.content', {
      customOutlines: [rawOutline('outline_keep'), rawOutline('outline_misplaced_youth')],
      customBackgrounds: [],
      customWorldBooks: [],
      customEvents: [{ id: 'evt-1', title: '已废弃的事件库条目' }],
      customWorkspaceTemplates: [{ id: 'tpl-1', name: '已废弃的司书库模板' }],
    }, 2);

    await persistApi().rehydrate();

    const current = state();
    assert.deepEqual(current.customOutlines.map((outline) => outline.id), ['outline_keep'], '预设 id 会被过滤');
    assert.deepEqual(current.customBackgrounds, []);
    assert.deepEqual(current.customWorldBooks, []);
    assert.equal('customEvents' in current, false, '旧字段应被丢弃');
    assert.equal('customWorkspaceTemplates' in current, false, '旧字段应被丢弃');
    // 迁移后 store 仍然可用
    assert.equal(current.addOutline(rawOutline('outline_after_migrate') as any).ok, true);
    assert.equal(state().customOutlines.length, 2);
  });

  it('损坏的持久化数据被兜底为空数组，不抛错', async () => {
    seedPersisted('lrpg.content', { customOutlines: 'not-an-array', customWorldBooks: [{ id: 'broken' }] }, 2);
    await persistApi().rehydrate();
    assert.deepEqual(state().customOutlines, []);
    assert.deepEqual(state().customWorldBooks, [], '缺字段的世界书会被校验丢弃');
  });
});
