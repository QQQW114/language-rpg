import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { PRESET_OUTLINES, getOutlineById } from '@/presets/outlines';
import { PRESET_WORLDBOOKS, getWorldBookById } from '@/presets/worldbooks';
import { PRESET_BACKGROUNDS } from '@/presets/backgrounds';
import { validateStoryOutline, validateWorldBook } from '@/lib/contentLibrary';

describe('内置预设故事与世界书', () => {
  it('每个内置故事都能通过内容库校验', () => {
    for (const outline of PRESET_OUTLINES) {
      const result = validateStoryOutline(outline);
      assert.equal(result.ok, true, `${outline.id} 应通过校验：${JSON.stringify(result.issues)}`);
    }
  });

  it('每个内置世界书都能通过内容库校验', () => {
    for (const book of PRESET_WORLDBOOKS) {
      const result = validateWorldBook(book);
      assert.equal(result.ok, true, `${book.id} 应通过校验：${JSON.stringify(result.issues)}`);
    }
  });

  it('故事 / 世界书的 id 全局唯一，且能按 id 取回', () => {
    const outlineIds = PRESET_OUTLINES.map((outline) => outline.id);
    const bookIds = PRESET_WORLDBOOKS.map((book) => book.id);
    assert.equal(new Set(outlineIds).size, outlineIds.length, '故事 id 不应重复');
    assert.equal(new Set(bookIds).size, bookIds.length, '世界书 id 不应重复');
    for (const id of outlineIds) assert.ok(getOutlineById(id), `应能取回 ${id}`);
    for (const id of bookIds) assert.ok(getWorldBookById(id)?.book, `应能取回 ${id}`);
  });

  it('故事挂载的世界书都存在；每幕至少一节，故事节 id 唯一', () => {
    for (const outline of PRESET_OUTLINES) {
      for (const bookId of outline.worldBookIds ?? []) {
        assert.ok(getWorldBookById(bookId)?.book, `${outline.id} 引用了不存在的世界书 ${bookId}`);
      }
      const beatIds: string[] = [];
      for (const act of outline.acts) {
        assert.ok(act.beats.length >= 1, `${outline.id} / ${act.id} 至少需要一个故事节`);
        for (const beat of act.beats) beatIds.push(beat.id);
      }
      assert.equal(new Set(beatIds).size, beatIds.length, `${outline.id} 的故事节 id 不应重复`);
    }
  });

  it('已导入 Gemini 生成的两个预设（各 5 幕 15 节，挂载配套世界书）', () => {
    const imported = ['outline_borrowed_ember', 'outline_forged_provenance'].map((id) => {
      const outline = getOutlineById(id);
      assert.ok(outline, `应存在 ${id}`);
      return outline;
    });
    for (const outline of imported) {
      assert.equal(outline.acts.length, 5);
      assert.equal(outline.acts.reduce((total, act) => total + act.beats.length, 0), 15);
      assert.equal(outline.worldBookIds?.length, 1);
      assert.ok(getWorldBookById(outline.worldBookIds[0])?.book);
    }
  });

  it('故事推荐的出身都存在，且每个内置故事绑定自己的主角出身', () => {
    const backgroundIds = new Set(PRESET_BACKGROUNDS.map((background) => background.id));
    for (const outline of PRESET_OUTLINES) {
      for (const id of outline.backgroundIds ?? []) {
        assert.ok(backgroundIds.has(id), `${outline.id} 引用了不存在的出身 ${id}`);
      }
    }
    assert.deepEqual(getOutlineById('outline_misplaced_youth')?.backgroundIds, ['bg_freshman_xiyu']);
    assert.deepEqual(getOutlineById('outline_borrowed_ember')?.backgroundIds, ['bg_apprentice_linche']);
    assert.deepEqual(getOutlineById('outline_forged_provenance')?.backgroundIds, ['bg_restorer_suyan']);
  });

  it('Gemini 包里两个故事专属主角已作为内置出身导入', () => {
    const find = (id: string) => PRESET_BACKGROUNDS.find((background) => background.id === id);
    assert.ok(find('bg_apprentice_linche')?.name.includes('林澈'));
    assert.ok(find('bg_restorer_suyan')?.name.includes('苏砚'));
  });
});
