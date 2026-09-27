import type { GameStateV2 } from '@/v2/types';

/**
 * 侧边栏"信息更新"检测。
 *
 * 侧边栏由若干独立的块组成（命运、人物、关系、场景、进展、正史事实、背包、故事线索、
 * 故事脉动）。每轮提交后需要知道**哪些块变了**，以及是**更新已有内容**还是**新出现的块**，
 * 才能只对变化的那几块播更新特效，而不是整栏一起闪。
 *
 * 这里刻意做成纯函数：输入前后两个状态，输出块的增删改。这样它可以被单元测试覆盖，
 * 而特效组件只负责"把结果画出来"。
 */

/** 侧边栏的块标识：固定块用名字，集合块用 `前缀:条目id`。 */
export type SidePanelBlockId = string;

export type SidePanelChangeKind = 'new' | 'updated';

export interface SidePanelChange {
  id: SidePanelBlockId;
  kind: SidePanelChangeKind;
}

export const SIDE_PANEL_FIXED_BLOCKS = [
  'destiny',
  'scene',
  'progress',
  'summary',
  'randomEvent',
] as const;

const stableSignature = (value: unknown): string => {
  try {
    return JSON.stringify(value) ?? '';
  } catch {
    // 出现循环引用等异常时退化为"永远视为变化"，宁可多播一次特效也不能漏。
    return `unstable-${Math.random()}`;
  }
};

const itemMap = <T extends { id: string }>(list: T[] | undefined): Map<string, string> => {
  const map = new Map<string, string>();
  for (const item of list ?? []) {
    if (!item || typeof item.id !== 'string') continue;
    map.set(item.id, stableSignature(item));
  }
  return map;
};

function collectCollectionChanges(
  prefix: string,
  before: Map<string, string>,
  after: Map<string, string>,
  out: SidePanelChange[],
): void {
  for (const [id, signature] of after) {
    const previous = before.get(id);
    if (previous === undefined) out.push({ id: `${prefix}:${id}`, kind: 'new' });
    else if (previous !== signature) out.push({ id: `${prefix}:${id}`, kind: 'updated' });
  }
  // 被删除的条目不做特效：已经不在界面上，没有可播放的块。
}

/**
 * 比较前后两个权威状态，列出侧边栏需要播特效的块。
 *
 * 首次进入（`before` 为空）时返回空数组——刚打开存档就把整个侧边栏扫一遍没有意义，
 * 而且会让玩家误以为"刚发生了变化"。
 */
export function diffSidePanelChanges(
  before: GameStateV2 | undefined,
  after: GameStateV2 | undefined,
): SidePanelChange[] {
  if (!before || !after) return [];
  const changes: SidePanelChange[] = [];

  const fixedBefore: Record<string, unknown> = {
    destiny: {
      completionEstimate: before.destiny?.completionEstimate,
      completionReason: before.destiny?.completionReason,
      currentStage: before.destiny?.currentStage,
      currentPath: before.destiny?.currentPath,
      nextMilestone: before.destiny?.nextMilestone,
      convergencePlan: before.destiny?.convergencePlan,
      endingReached: before.destiny?.endingReached,
      beats: before.destiny?.beats,
    },
    scene: before.currentScene,
    progress: before.latestProgress,
    summary: before.summary,
    randomEvent: before.randomEvent,
  };
  const fixedAfter: Record<string, unknown> = {
    destiny: {
      completionEstimate: after.destiny?.completionEstimate,
      completionReason: after.destiny?.completionReason,
      currentStage: after.destiny?.currentStage,
      currentPath: after.destiny?.currentPath,
      nextMilestone: after.destiny?.nextMilestone,
      convergencePlan: after.destiny?.convergencePlan,
      endingReached: after.destiny?.endingReached,
      beats: after.destiny?.beats,
    },
    scene: after.currentScene,
    progress: after.latestProgress,
    summary: after.summary,
    randomEvent: after.randomEvent,
  };
  for (const key of SIDE_PANEL_FIXED_BLOCKS) {
    const previous = stableSignature(fixedBefore[key]);
    const next = stableSignature(fixedAfter[key]);
    // 固定块一定是"更新"：它们在界面上始终占位（没有内容时显示占位文案），
    // 所以不存在"新出现的块"。
    if (previous !== next) changes.push({ id: key, kind: 'updated' });
  }

  collectCollectionChanges('character', itemMap(before.characters), itemMap(after.characters), changes);
  collectCollectionChanges('relationship', itemMap(before.relationships), itemMap(after.relationships), changes);
  collectCollectionChanges('item', itemMap(before.inventory), itemMap(after.inventory), changes);
  collectCollectionChanges('thread', itemMap(before.storyThreads), itemMap(after.storyThreads), changes);
  collectCollectionChanges('fact', itemMap(before.facts), itemMap(after.facts), changes);

  return changes;
}

/** 把变更列表折叠成 `块 id → 变化类型`；同一个块同时出现时以「新增」优先。 */
export function toChangeMap(changes: SidePanelChange[]): Map<SidePanelBlockId, SidePanelChangeKind> {
  const map = new Map<SidePanelBlockId, SidePanelChangeKind>();
  for (const change of changes) {
    if (map.get(change.id) === 'new') continue;
    map.set(change.id, change.kind);
  }
  return map;
}
