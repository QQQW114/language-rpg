import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  cloneOutlineAsCustom,
  clonePresetProject,
  cloneWorldBookAsCustom,
  contentExportEnvelope,
  createBlankAct,
  createBlankBeat,
  createBlankOutline,
  createBlankWorldBook,
  createBlankWorldBookEntry,
  downloadJson,
  inspectOutline,
  inspectWorldBook,
  normalizeOutlineForSave,
  normalizeWorldBookForSave,
  safeFilename,
} from '@/v2/workshop/model';
import { CONTENT_EXPORT_KIND, CONTENT_EXPORT_VERSION } from '@/lib/contentLibrary';
import type { StoryOutline, WorldBook } from '@/types/content';
import { makeOutline, makeWorldBook } from './helpers/fixtures';

const levelsOf = (issues: Array<{ level: string }>) => issues.map((issue) => issue.level);

describe('workshop.model — 空白草稿', () => {
  it('createBlankOutline / createBlankAct / createBlankBeat 补齐默认值', () => {
    const outline = createBlankOutline();
    assert.ok(outline.id.startsWith('outline_'));
    assert.equal(outline.title, '未命名故事');
    assert.equal(outline.synopsis, '');
    assert.deepEqual(outline.worldBookIds, []);
    assert.equal(outline.acts.length, 1);
    assert.equal(outline.acts[0].title, '第一幕');
    assert.equal(outline.acts[0].beats.length, 1);
    assert.equal(outline.acts[0].beats[0].title, '未命名故事节');
    assert.equal(outline.acts[0].beats[0].purpose, '');

    assert.equal(createBlankAct(3).title, '第三幕');
    assert.equal(createBlankAct(11).title, '第11幕', '超出中文数字表时回退为数字');
    assert.ok(createBlankBeat().id.startsWith('beat_'));
  });

  it('createBlankWorldBook / createBlankWorldBookEntry 补齐默认值', () => {
    const book = createBlankWorldBook('我的世界书');
    assert.ok(book.id.startsWith('wb_'));
    assert.equal(book.name, '我的世界书');
    const entry = createBlankWorldBookEntry();
    assert.ok(entry.id.startsWith('wbe_'));
    assert.equal(entry.alwaysActive, true);
    assert.equal(entry.priority, 100);
    assert.deepEqual(entry.keywords, []);
    assert.equal(book.entries.length, 1);
  });

  it('多次创建的 id 互不相同', () => {
    const ids = new Set([createBlankOutline().id, createBlankOutline().id, createBlankWorldBook().id, createBlankWorldBook().id]);
    assert.equal(ids.size, 4);
  });
});

describe('workshop.model — inspectOutline', () => {
  it('结构与建议都满足时没有问题', () => {
    const issues = inspectOutline(makeOutline({ tone: '冷静', worldBookIds: ['wb-1'] }));
    assert.deepEqual(issues, []);
  });

  it('缺 title/synopsis/acts 为 error，缺 tone/worldBookIds 为 warning（不阻断）', () => {
    const structural = inspectOutline({ id: 'o', title: '', synopsis: '', worldBookIds: [], acts: [] } as unknown as StoryOutline);
    assert.deepEqual(structural.map((issue) => [issue.level, issue.path]), [
      ['error', '故事标题'],
      ['error', '故事简介'],
      ['error', '命运骨架'],
      ['warning', '叙事基调'],
      ['warning', '关联世界书'],
    ]);

    const advisory = inspectOutline(makeOutline({ tone: '   ', worldBookIds: [] }));
    assert.deepEqual(levelsOf(advisory), ['warning', 'warning']);
    assert.deepEqual(advisory.map((issue) => issue.path), ['叙事基调', '关联世界书']);
    assert.equal(advisory.filter((issue) => issue.level === 'error').length, 0, 'warning 不阻断保存');
  });

  it('逐幕逐故事节检查标题与目的', () => {
    const outline = makeOutline({
      tone: '冷静',
      worldBookIds: ['wb-1'],
      acts: [
        { id: 'act-1', title: '  ', purpose: '', beats: [{ id: 'beat-1', title: '', purpose: '  ' }] },
        { id: 'act-2', title: '第二幕', purpose: '推进', beats: [] },
      ],
    });
    const issues = inspectOutline(outline);
    assert.deepEqual(issues.map((issue) => [issue.level, issue.path]), [
      ['error', '第 1 幕'],
      ['error', '第 1 幕'],
      ['error', '第 1 幕 · 故事节 1'],
      ['error', '第 1 幕 · 故事节 1'],
      ['error', '第 2 幕'],
    ]);
  });
});

describe('workshop.model — inspectWorldBook', () => {
  it('结构完整、描述齐全、常驻条目时没有问题', () => {
    assert.deepEqual(inspectWorldBook(makeWorldBook() as unknown as WorldBook), []);
  });

  it('缺 name/entries 为 error，缺 description 为 warning', () => {
    const empty = inspectWorldBook({ id: 'wb', name: '', entries: [] } as unknown as WorldBook);
    assert.deepEqual(empty.map((issue) => [issue.level, issue.path]), [
      ['error', '世界书名称'],
      ['error', '世界书'],
      ['warning', '世界书'],
    ]);

    const noDescription = inspectWorldBook({ id: 'wb', name: 'W', entries: [{ id: 'e', name: 'E', content: 'C', keywords: ['k'], alwaysActive: true }] } as unknown as WorldBook);
    assert.deepEqual(noDescription.map((issue) => [issue.level, issue.path]), [['warning', 'W']]);
  });

  it('非常驻且无关键词的条目给 warning，缺名称/正文仍是 error', () => {
    const book = {
      id: 'wb',
      name: 'W',
      description: '说明',
      entries: [
        { id: 'e1', name: 'E1', content: 'C1', keywords: [], alwaysActive: false },
        { id: 'e2', name: '', content: '', keywords: ['k'] },
      ],
    } as unknown as WorldBook;
    const issues = inspectWorldBook(book);
    assert.deepEqual(issues.map((issue) => [issue.level, issue.path]), [
      ['warning', 'W · 条目 1'],
      ['error', 'W · 条目 2'],
      ['error', 'W · 条目 2'],
    ]);
  });
});

describe('workshop.model — 克隆', () => {
  it('cloneOutlineAsCustom 换新所有 id（含故事节）且不修改源对象', () => {
    const source = makeOutline({ worldBookIds: ['wb-1'] });
    const snapshot = structuredClone(source);
    const clone = cloneOutlineAsCustom(source);

    assert.notEqual(clone.id, source.id);
    assert.equal(clone.title, '测试故事 · 自定义');
    assert.deepEqual(clone.worldBookIds, [], '克隆出的故事不继承预设世界书引用');
    assert.deepEqual(clone.acts.map((act) => act.title), source.acts.map((act) => act.title));
    for (const [index, act] of clone.acts.entries()) {
      assert.notEqual(act.id, source.acts[index].id);
      for (const [beatIndex, beat] of act.beats.entries()) {
        assert.notEqual(beat.id, source.acts[index].beats[beatIndex].id);
        assert.equal(beat.purpose, source.acts[index].beats[beatIndex].purpose);
      }
    }
    assert.deepEqual(source, snapshot, '源对象不应被修改');
  });

  it('cloneWorldBookAsCustom 换新 id 与条目 id', () => {
    const source = makeWorldBook() as unknown as WorldBook;
    const snapshot = structuredClone(source);
    const clone = cloneWorldBookAsCustom(source);
    assert.notEqual(clone.id, source.id);
    assert.equal(clone.name, '测试世界书 · 自定义');
    assert.equal(clone.entries.length, source.entries.length);
    for (const [index, entry] of clone.entries.entries()) {
      assert.notEqual(entry.id, source.entries[index].id);
      assert.equal(entry.content, source.entries[index].content);
    }
    assert.deepEqual(source, snapshot);
  });

  it('clonePresetProject 只克隆被引用的世界书并把 worldBookIds 重映射到克隆后的 id', () => {
    const source = makeOutline({ worldBookIds: ['wb-1', 'wb-2', 'wb-missing'] }) as unknown as StoryOutline;
    const books = [
      makeWorldBook({ id: 'wb-1' }),
      makeWorldBook({ id: 'wb-2', entries: [{ id: 'wbe-9', name: 'E', content: 'C', keywords: [] }] }),
      makeWorldBook({ id: 'wb-3' }),
    ] as unknown as WorldBook[];

    const { outline, worldBooks } = clonePresetProject(source, books);
    assert.equal(worldBooks.length, 2, '只克隆被引用的世界书（缺失的引用被忽略）');
    assert.deepEqual(outline.worldBookIds, worldBooks.map((book) => book.id));
    assert.equal(outline.worldBookIds.includes('wb-1'), false);
    assert.equal(outline.worldBookIds.includes('wb-2'), false);
    assert.ok(worldBooks.every((book) => !['wb-1', 'wb-2', 'wb-3'].includes(book.id)));
    assert.ok(worldBooks[0].entries.every((entry) => entry.id !== 'wbe-9'));
  });
});

describe('workshop.model — normalizeForSave', () => {
  it('normalizeOutlineForSave 去空白、空串降级为 undefined、worldBookIds 去重', () => {
    const normalized = normalizeOutlineForSave({
      id: 'outline-x',
      title: '  标题  ',
      synopsis: '  简介  ',
      tone: '   ',
      coverEmoji: '  ',
      worldBookIds: ['wb-a', 'wb-a', 'wb-b'],
      acts: [{ id: 'act-x', title: '  幕  ', purpose: '  目的  ', beats: [{ id: 'beat-x', title: '  节  ', purpose: '  作用  ' }] }],
    } as unknown as StoryOutline);

    assert.equal(normalized.title, '标题');
    assert.equal(normalized.synopsis, '简介');
    assert.equal(normalized.tone, undefined);
    assert.equal(normalized.coverEmoji, undefined);
    assert.deepEqual(normalized.worldBookIds, ['wb-a', 'wb-b']);
    assert.equal(normalized.acts[0].title, '幕');
    assert.equal(normalized.acts[0].purpose, '目的');
    assert.equal(normalized.acts[0].beats[0].title, '节');
    assert.equal(normalized.acts[0].beats[0].purpose, '作用');
  });

  it('normalizeWorldBookForSave 去空白、关键词去重、priority 夹到 [0,100]', () => {
    const normalized = normalizeWorldBookForSave({
      id: 'wb-x',
      name: '  世界书  ',
      description: '   ',
      entries: [
        { id: 'e1', name: ' E1 ', content: ' C1 ', keywords: [' k ', 'k', '', '  '], priority: 1e9 },
        { id: 'e2', name: 'E2', content: 'C2', keywords: [], priority: -5 },
        { id: 'e3', name: 'E3', content: 'C3', keywords: [], priority: 42.4 },
        { id: 'e4', name: 'E4', content: 'C4', keywords: [], priority: Number.NaN },
        { id: 'e5', name: 'E5', content: 'C5', keywords: [] },
      ],
    } as unknown as WorldBook);

    assert.equal(normalized.name, '世界书');
    assert.equal(normalized.description, undefined);
    assert.equal(normalized.entries[0].name, 'E1');
    assert.equal(normalized.entries[0].content, 'C1');
    assert.deepEqual(normalized.entries[0].keywords, ['k']);
    // discovered issue：内容库校验允许 priority ∈ [-10000, 10000]，
    // 但工坊保存路径只允许 [0, 100]，负数会被抬到 0。
    assert.deepEqual(normalized.entries.map((entry) => entry.priority), [100, 0, 42, undefined, undefined]);
  });
});

describe('workshop.model — safeFilename', () => {
  it('非法字符被替换为 -，空白压缩为 -', () => {
    assert.equal(safeFilename('a/b\\c:d*e?f"g<h>i|j'), 'a-b-c-d-e-f-g-h-i-j');
    assert.equal(safeFilename('  我的 故事  '), '我的-故事');
  });

  it('空串或纯空白有兜底文件名', () => {
    assert.equal(safeFilename(''), 'language-rpg-content');
    assert.equal(safeFilename('   '), 'language-rpg-content');
    assert.equal(safeFilename('///'), '-', '连续非法字符被合并成一个替换符');
  });
});

describe('workshop.model — 导出封装与下载', () => {
  it('contentExportEnvelope 生成标准包', () => {
    const content = { outlines: [makeOutline()] };
    const envelope = contentExportEnvelope(content);
    assert.equal(envelope.kind, CONTENT_EXPORT_KIND);
    assert.equal(envelope.version, CONTENT_EXPORT_VERSION);
    assert.equal(typeof envelope.exportedAt, 'number');
    assert.deepEqual(envelope.content, content);
  });

  it('downloadJson 构造 Blob 并触发 <a download> 点击', async () => {
    const globals = globalThis as any;
    const originalBlob = globals.Blob;
    const originalDocument = globals.document;
    const originalWindow = globals.window;
    const originalCreate = globals.URL.createObjectURL;
    const originalRevoke = globals.URL.revokeObjectURL;

    const captured: { parts?: unknown[]; type?: string; anchor?: { href: string; download: string; clicked: boolean } } = {};
    const revoked: string[] = [];
    try {
      globals.Blob = class {
        parts: unknown[];
        constructor(parts: unknown[], options?: { type?: string }) {
          captured.parts = parts;
          captured.type = options?.type;
          this.parts = parts;
        }
      };
      const anchor = { href: '', download: '', clicked: false, click() { this.clicked = true; } };
      captured.anchor = anchor;
      globals.document = { createElement: () => anchor };
      globals.window = { setTimeout: (fn: () => void) => { fn(); return 0; } };
      globals.URL.createObjectURL = () => 'blob:mock-url';
      globals.URL.revokeObjectURL = (url: string) => { revoked.push(url); };

      downloadJson('我的故事.json', { kind: 'test', value: 1 });

      assert.equal(anchor.download, '我的故事.json');
      assert.equal(anchor.href, 'blob:mock-url');
      assert.equal(anchor.clicked, true);
      assert.equal(captured.type, 'application/json;charset=utf-8');
      assert.equal(typeof captured.parts?.[0], 'string');
      assert.deepEqual(JSON.parse(String(captured.parts?.[0])), { kind: 'test', value: 1 });
      assert.deepEqual(revoked, ['blob:mock-url'], 'setTimeout 回调应立即回收 URL');
    } finally {
      globals.Blob = originalBlob;
      globals.document = originalDocument;
      globals.window = originalWindow;
      globals.URL.createObjectURL = originalCreate;
      globals.URL.revokeObjectURL = originalRevoke;
    }
  });
});
