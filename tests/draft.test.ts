// localStorage 桩必须在被测模块读取 localStorage 之前安装。
import { memoryStorage } from './helpers/localStorageStub';

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { clearDraft, draftKey, readDraft, writeDraft } from '@/v2/draft';

beforeEach(() => memoryStorage.clear());

describe('draft — 未发送输入的草稿保留', () => {
  it('写入后能读回（打开设置页/返回对话后再进来仍在）', () => {
    writeDraft('save-1', '我推开门，走进雨里');
    assert.equal(readDraft('save-1'), '我推开门，走进雨里');
  });

  it('不同存档的草稿互不干扰', () => {
    writeDraft('save-1', '甲的输入');
    writeDraft('save-2', '乙的输入');
    assert.equal(readDraft('save-1'), '甲的输入');
    assert.equal(readDraft('save-2'), '乙的输入');
  });

  it('空字符串等于清除，不会留下空键', () => {
    writeDraft('save-1', '内容');
    writeDraft('save-1', '');
    assert.equal(readDraft('save-1'), '');
    assert.equal(memoryStorage.getItem(draftKey('save-1')), null);

    writeDraft('save-1', '内容');
    clearDraft('save-1');
    assert.equal(readDraft('save-1'), '');
    assert.equal(memoryStorage.getItem(draftKey('save-1')), null);
  });

  it('没有存档 id 时安全地什么都不做', () => {
    assert.equal(readDraft(undefined), '');
    writeDraft(undefined, '内容');
    assert.equal(readDraft(undefined), '');
  });

  it('草稿单独存放，不写进存档本体（lrpg.v2）', () => {
    writeDraft('save-1', '内容');
    assert.equal(memoryStorage.getItem('lrpg.v2'), null, '不应触碰存档键');
    assert.equal(memoryStorage.getItem(draftKey('save-1')), '内容');
  });

  it('超长草稿被截断，避免写爆配额', () => {
    writeDraft('save-1', 'x'.repeat(30_000));
    assert.equal(readDraft('save-1').length, 20_000);
  });

  it('localStorage 抛错时读取退化为空串、写入静默失败', () => {
    const original = memoryStorage.setItem;
    (memoryStorage as unknown as { setItem: unknown }).setItem = () => { throw new Error('QuotaExceededError'); };
    assert.doesNotThrow(() => writeDraft('save-1', '内容'));
    assert.equal(readDraft('save-1'), '');
    (memoryStorage as unknown as { setItem: unknown }).setItem = original;
  });
});
