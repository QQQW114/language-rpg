import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { diffSidePanelChanges, toChangeMap } from '@/v2/sidePanelUpdates';
import { makeState } from './helpers/fixtures';
import type { GameStateV2 } from '@/v2/types';

const base = (overrides: Record<string, unknown> = {}): GameStateV2 => makeState(overrides);
const ids = (changes: ReturnType<typeof diffSidePanelChanges>) => changes.map((c) => c.id).sort();
const find = (changes: ReturnType<typeof diffSidePanelChanges>, id: string) => changes.find((c) => c.id === id);

describe('diffSidePanelChanges — 侧边栏更新检测', () => {
  it('缺少任一状态时返回空（首次进入不播特效）', () => {
    assert.deepEqual(diffSidePanelChanges(undefined, base()), []);
    assert.deepEqual(diffSidePanelChanges(base(), undefined), []);
  });

  it('状态完全相同时不报任何变化', () => {
    const state = base();
    assert.deepEqual(diffSidePanelChanges(state, state), []);
    // 内容相同但是新对象（每轮提交都会产生新对象）也不该报变化
    assert.deepEqual(diffSidePanelChanges(state, base()), []);
  });

  it('新增人物报 new，改动已有字段报 updated', () => {
    const before = base();
    const after = base({
      characters: [
        ...before.characters,
        { id: 'char-new', name: '新角色', aliases: [], knownFacts: [], firstSeenTurn: 2, lastSeenTurn: 2, status: 'active' },
      ],
    });
    assert.deepEqual(ids(diffSidePanelChanges(before, after)), ['character:char-new']);
    assert.equal(find(diffSidePanelChanges(before, after), 'character:char-new')?.kind, 'new');

    const changed = base({
      characters: before.characters.map((c) => c.id === 'char-a' ? { ...c, status: 'absent' } : c),
    });
    assert.equal(find(diffSidePanelChanges(before, changed), 'character:char-a')?.kind, 'updated');
  });

  it('固定的块报 updated：命运、场景、进展、摘要、随机事件', () => {
    const before = base();
    const after = base({
      destiny: { ...before.destiny, completionEstimate: 88, currentStage: '第二幕' },
      currentScene: { id: 'scene-2', name: '新场景', description: '换了地方' },
      latestProgress: '到了新地方',
      summary: '换了个摘要',
      randomEvent: { ...before.randomEvent, pending: true },
    });
    assert.deepEqual(ids(diffSidePanelChanges(before, after)), ['destiny', 'progress', 'randomEvent', 'scene', 'summary']);
    for (const id of ['destiny', 'progress', 'randomEvent', 'scene', 'summary']) {
      assert.equal(find(diffSidePanelChanges(before, after), id)?.kind, 'updated', `${id} 应为 updated`);
    }
  });

  it('背包、线程、事实、关系的内容变化都能被检出', () => {
    const before = base();
    const after = base({
      inventory: before.inventory.map((item) => ({ ...item, quantity: item.quantity + 1 })),
      storyThreads: before.storyThreads.map((thread) => ({ ...thread, progress: 80 })),
      facts: [{ id: 'fact-1', subjectId: 'char-a', predicate: 'job', value: '医生', scope: 'character', stability: 'stable', confidence: 'explicit', keywords: [], updatedAtTurn: 2 }],
      relationships: before.relationships.map((rel) => ({ ...rel, affinity: rel.affinity + 5 })),
    });
    const changes = diffSidePanelChanges(before, after);
    assert.ok(find(changes, 'item:item-1'), '数量变化应被检出');
    assert.ok(find(changes, 'thread:thread-1'), '线程进度变化应被检出');
    assert.ok(find(changes, 'fact:fact-1'), '新增事实应被检出');
    assert.ok(find(changes, 'relationship:rel-1'), '关系好感变化应被检出');
    assert.equal(find(changes, 'fact:fact-1')?.kind, 'new');
    assert.equal(find(changes, 'item:item-1')?.kind, 'updated');
  });

  it('条目被删除不产生特效（界面上已无该块可播）', () => {
    const before = base({
      inventory: [
        { id: 'item-1', name: '匕首', kind: 'item', description: '', quantity: 2, consumable: false, acquiredAtTurn: 0, updatedAtTurn: 0 },
        { id: 'item-2', name: '绳子', kind: 'item', description: '', quantity: 1, consumable: false, acquiredAtTurn: 0, updatedAtTurn: 0 },
      ],
    });
    const after = base({
      inventory: [before.inventory[0]],
    });
    assert.deepEqual(diffSidePanelChanges(before, after), []);
  });

  it('toChangeMap 折叠为 块id → 类型，且「新增」优先', () => {
    const map = toChangeMap([
      { id: 'character:a', kind: 'updated' },
      { id: 'character:a', kind: 'new' },
      { id: 'destiny', kind: 'updated' },
    ]);
    assert.equal(map.get('character:a'), 'new');
    assert.equal(map.get('destiny'), 'updated');
    assert.equal(map.size, 2);
  });
});
