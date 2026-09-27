import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  CONTENT_EXPORT_KIND,
  CONTENT_EXPORT_VERSION,
  buildContentExport,
  parseContentImport,
  serializeContentExport,
  validateImportBundle,
  validateStoryOutline,
  validateWorldBook,
} from '@/lib/contentLibrary';
import { makeBackground, makeOutline, makeWorldBook } from './helpers/fixtures';

const pathsOf = (issues: Array<{ path: string; code: string }>) => issues.map((issue) => `${issue.path}:${issue.code}`);

const validOutlineInput = {
  title: '  测试故事  ',
  synopsis: '  一个用于测试的简短故事。  ',
  tone: '冷静',
  worldBookIds: ['wb-a', 'wb-a', ' wb-b ', ''],
  acts: [
    {
      title: ' 第一幕 ',
      purpose: ' 建立日常 ',
      beats: [{ title: ' 开场 ', purpose: ' 建立主角的日常状态 ' }],
    },
  ],
};

describe('contentLibrary.validateStoryOutline', () => {
  it('缺 title/synopsis/acts 时报 required', () => {
    const result = validateStoryOutline({});
    assert.equal(result.ok, false);
    assert.equal(result.value, undefined);
    assert.deepEqual(pathsOf(result.issues), ['title:required', 'synopsis:required', 'acts:required']);
  });

  it('act 缺 beats、beat 缺 purpose 时报到具体路径', () => {
    const noBeats = validateStoryOutline({ title: 'T', synopsis: 'S', acts: [{ title: 'A', purpose: 'P' }] });
    assert.deepEqual(pathsOf(noBeats.issues), ['acts[0].beats:required']);

    const noPurpose = validateStoryOutline({
      title: 'T',
      synopsis: 'S',
      acts: [{ title: 'A', purpose: 'P', beats: [{ title: 'B' }] }],
    });
    assert.deepEqual(pathsOf(noPurpose.issues), ['acts[0].beats[0].purpose:required']);
  });

  it('非对象输入（含数组）报 invalid_type', () => {
    assert.deepEqual(pathsOf(validateStoryOutline('文本').issues), ['$:invalid_type']);
    assert.deepEqual(pathsOf(validateStoryOutline([]).issues), ['$:invalid_type']);
    assert.deepEqual(pathsOf(validateStoryOutline(null).issues), ['$:invalid_type']);
  });

  it('合法输入返回完整 value 并补齐 id', () => {
    const result = validateStoryOutline(validOutlineInput);
    assert.equal(result.ok, true);
    assert.deepEqual(result.issues, []);
    const value = result.value!;
    assert.equal(value.title, '测试故事');
    assert.equal(value.synopsis, '一个用于测试的简短故事。');
    assert.equal(value.tone, '冷静');
    assert.deepEqual(value.worldBookIds, ['wb-a', 'wb-b'], 'worldBookIds 去重且去空白');
    assert.equal(value.coverEmoji, undefined);
    assert.ok(value.id.startsWith('outline_'), `缺 id 时应生成：${value.id}`);
    assert.ok(value.acts[0].id.startsWith('act_'));
    assert.ok(value.acts[0].beats[0].id.startsWith('beat_'));
    assert.equal(value.acts[0].title, '第一幕');
    assert.equal(value.acts[0].beats[0].purpose, '建立主角的日常状态');
  });

  it('保留已有 id，但重复 id 会被换成新 id', () => {
    const result = validateStoryOutline({
      title: 'T',
      synopsis: 'S',
      acts: [
        { id: 'act-same', title: 'A1', purpose: 'P', beats: [{ id: 'beat-same', title: 'B1', purpose: 'Q' }] },
        { id: 'act-same', title: 'A2', purpose: 'P', beats: [{ id: 'beat-same', title: 'B2', purpose: 'Q' }] },
      ],
    });
    const value = result.value!;
    assert.equal(value.acts[0].id, 'act-same');
    assert.notEqual(value.acts[1].id, 'act-same');
    assert.equal(value.acts[0].beats[0].id, 'beat-same');
    assert.notEqual(value.acts[1].beats[0].id, 'beat-same');
  });

  it('非对象 act/beat 元素报 invalid_type 且整体不通过', () => {
    const result = validateStoryOutline({
      title: 'T',
      synopsis: 'S',
      acts: ['不是对象', { title: 'A', purpose: 'P', beats: ['也不是对象', { title: 'B', purpose: 'Q' }] }],
    });
    assert.equal(result.ok, false);
    assert.equal(result.value, undefined);
    assert.deepEqual(pathsOf(result.issues), ['acts[0]:invalid_type', 'acts[1].beats[0]:invalid_type']);
  });
});

describe('contentLibrary.validateWorldBook', () => {
  it('空 entries / 缺 name / 非对象输入报错', () => {
    assert.deepEqual(pathsOf(validateWorldBook({ name: 'W' }).issues), ['entries:required']);
    assert.deepEqual(pathsOf(validateWorldBook({ entries: [] }).issues), ['name:required', 'entries:required']);
    assert.deepEqual(pathsOf(validateWorldBook({ name: '   ', entries: [] }).issues), ['name:required', 'entries:required']);
    assert.deepEqual(pathsOf(validateWorldBook('x').issues), ['$:invalid_type']);
  });

  it('条目缺 content 或不是对象时报错', () => {
    assert.deepEqual(
      pathsOf(validateWorldBook({ name: 'W', entries: [{ name: 'E' }] }).issues),
      ['entries[0].content:required'],
    );
    assert.deepEqual(
      pathsOf(validateWorldBook({ name: 'W', entries: ['x'] }).issues),
      ['entries[0]:invalid_type'],
    );
  });

  it('priority 被夹到 [-10000, 10000] 并取整', () => {
    const result = validateWorldBook({
      name: 'W',
      entries: [
        { name: 'a', content: 'x', priority: -99999 },
        { name: 'b', content: 'x', priority: 99999 },
        { name: 'c', content: 'x', priority: '不能转数字' },
        { name: 'd', content: 'x', priority: 12.6 },
        { name: 'e', content: 'x' },
      ],
    });
    assert.equal(result.ok, true);
    assert.deepEqual(result.value!.entries.map((entry) => entry.priority), [-10000, 10000, 0, 13, 0]);
  });

  it('keywords 去重去空白，alwaysActive 仅在严格 true 时生效', () => {
    const result = validateWorldBook({
      name: ' W ',
      description: ' 说明 ',
      entries: [{ name: ' E ', content: ' 正文 ', keywords: ['雨', '雨', ' 城市 ', ''], alwaysActive: 'yes' }],
    });
    const entry = result.value!.entries[0];
    assert.equal(result.value!.name, 'W');
    assert.equal(result.value!.description, '说明');
    assert.equal(entry.name, 'E');
    assert.equal(entry.content, '正文');
    assert.deepEqual(entry.keywords, ['雨', '城市']);
    assert.equal(entry.alwaysActive, false);
    assert.ok(entry.id.startsWith('wbe_'));
    assert.ok(result.value!.id.startsWith('wb_'));
  });
});

describe('contentLibrary.validateImportBundle', () => {
  it('content-library 外壳被解包', () => {
    const outline = makeOutline();
    const result = validateImportBundle({
      kind: CONTENT_EXPORT_KIND,
      version: CONTENT_EXPORT_VERSION,
      exportedAt: Date.now(),
      content: { outlines: [outline] },
    });
    assert.equal(result.ok, true);
    assert.deepEqual(result.issues, []);
    assert.equal(result.value?.outlines?.length, 1);
    assert.equal(result.value?.outlines?.[0].id, outline.id);
    assert.deepEqual(result.value?.backgrounds, []);
    assert.deepEqual(result.value?.worldBooks, []);
  });

  it('版本号不符返回 unsupported_version', () => {
    const result = validateImportBundle({ kind: CONTENT_EXPORT_KIND, version: 2, content: { outlines: [makeOutline()] } });
    assert.equal(result.ok, false);
    assert.equal(result.value, undefined);
    assert.deepEqual(pathsOf(result.issues), ['version:unsupported_version']);
    assert.ok(result.issues[0].message.includes('2'));
  });

  it('content 不是对象时报 invalid_type', () => {
    const result = validateImportBundle({ kind: CONTENT_EXPORT_KIND, version: CONTENT_EXPORT_VERSION, content: 'x' });
    assert.equal(result.ok, false);
    assert.deepEqual(pathsOf(result.issues), ['content:invalid_type']);
  });

  it('非数组字段报 invalid_type，空内容报 empty', () => {
    const notArray = validateImportBundle({ outlines: 'x' });
    assert.equal(notArray.ok, false);
    assert.deepEqual(pathsOf(notArray.issues), ['outlines:invalid_type', '$:empty']);
    assert.deepEqual(notArray.value, { outlines: [], backgrounds: [], worldBooks: [] });

    const empty = validateImportBundle({});
    assert.equal(empty.ok, false);
    assert.deepEqual(pathsOf(empty.issues), ['$:empty']);
  });

  it('未包装的裸 bundle 也能导入', () => {
    const result = validateImportBundle({ outlines: [makeOutline()], worldBooks: [makeWorldBook()] });
    assert.equal(result.ok, true);
    assert.equal(result.value?.outlines?.length, 1);
    assert.equal(result.value?.worldBooks?.length, 1);
  });

  it('单项校验失败时 issues 带数组下标前缀，且合法项仍然保留', () => {
    const result = validateImportBundle({ outlines: [{ title: '' }, makeOutline()] });
    assert.equal(result.ok, false);
    assert.deepEqual(pathsOf(result.issues), [
      'outlines[0].title:required',
      'outlines[0].synopsis:required',
      'outlines[0].acts:required',
    ]);
    assert.equal(result.value?.outlines?.length, 1, '合法项应保留');
    assert.equal(result.value?.outlines?.[0].id, 'outline-test-1');
  });
});

describe('contentLibrary.parseContentImport', () => {
  it('非法 JSON 文本返回 invalid_json 而不抛错', () => {
    const result = parseContentImport('{不是合法 JSON');
    assert.equal(result.ok, false);
    assert.equal(result.issues[0].code, 'invalid_json');
    assert.equal(result.issues[0].kind, 'bundle');
    assert.ok(result.issues[0].message.startsWith('JSON 解析失败：'));
  });

  it('合法 JSON 文本正常解包', () => {
    const text = JSON.stringify({ kind: CONTENT_EXPORT_KIND, version: CONTENT_EXPORT_VERSION, content: { outlines: [makeOutline()] } });
    const result = parseContentImport(text);
    assert.equal(result.ok, true);
    assert.equal(result.value?.outlines?.[0].title, '测试故事');
  });

  it('非字符串输入直接用 validateImportBundle 处理', () => {
    assert.equal(parseContentImport({ outlines: [makeOutline()] }).ok, true);
    assert.equal(parseContentImport(42).ok, false);
    assert.deepEqual(pathsOf(parseContentImport(42).issues), ['$:invalid_type']);
  });
});

describe('contentLibrary 导出/导入往返', () => {
  it('buildContentExport 生成带 kind/version/exportedAt 的稳定包', () => {
    const bundle = { outlines: [makeOutline()], backgrounds: [makeBackground()], worldBooks: [makeWorldBook()] };
    const exported = buildContentExport(bundle);
    assert.equal(exported.kind, CONTENT_EXPORT_KIND);
    assert.equal(exported.version, CONTENT_EXPORT_VERSION);
    assert.equal(typeof exported.exportedAt, 'number');
    assert.deepEqual(exported.content, bundle);
    assert.notEqual(exported.content, bundle, '内容应为副本');
    assert.notEqual(exported.content.outlines, bundle.outlines);
  });

  it('serializeContentExport → parseContentImport 往返一致', () => {
    const outlines = [validateStoryOutline(validOutlineInput).value!];
    const backgrounds = [makeBackground()];
    const worldBooks = [validateWorldBook(makeWorldBook() as unknown).value!];
    const bundle = { outlines, backgrounds, worldBooks };

    const text = serializeContentExport(bundle);
    assert.ok(text.includes('\n  '), '默认应格式化输出');
    const parsed = JSON.parse(text);
    assert.equal(parsed.kind, CONTENT_EXPORT_KIND);
    assert.equal(parsed.version, CONTENT_EXPORT_VERSION);

    const roundTrip = parseContentImport(text);
    assert.equal(roundTrip.ok, true);
    assert.deepEqual(roundTrip.value?.outlines, outlines);
    assert.deepEqual(roundTrip.value?.backgrounds, backgrounds);
    assert.deepEqual(roundTrip.value?.worldBooks, worldBooks);
  });

  it('pretty=false 时输出单行 JSON', () => {
    const text = serializeContentExport({ outlines: [makeOutline()] }, false);
    assert.equal(text.includes('\n'), false);
    assert.equal(parseContentImport(text).ok, true);
  });
});
