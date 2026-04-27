// 道具（背包）相关工具：字符串启示物转 Item、类型启发式、展示文本等

import type { Item, ItemType } from '@/types/game';
import { genId } from './utils';

const CONSUMABLE_HINTS = [
  '药水', '药草', '药剂', '丹药', '膏药',
  '卷轴', '符咒', '符纸', '符', '祈祷书', '圣水',
  '食物', '干粮', '面包', '水袋', '粮', '花茶', '烈酒', '酒',
  '炸弹', '火药', '毒针', '解毒剂', '绷带',
];

export function heuristicItemType(name: string): ItemType {
  if (!name) return 'reusable';
  return CONSUMABLE_HINTS.some((k) => name.includes(k)) ? 'consumable' : 'reusable';
}

export interface RawGrant {
  name: string;
  description?: string;
  type?: ItemType;
}

export interface RawDestroy {
  name: string;
  reason?: string;
}

export function createItem(raw: RawGrant, round: number, pendingGrantKey?: string): Item {
  const name = (raw.name || '').trim().slice(0, 20);
  return {
    id: genId('itm'),
    name,
    description: (raw.description || '').trim().slice(0, 160) || '一件物品。',
    type: raw.type === 'consumable' || raw.type === 'reusable' ? raw.type : heuristicItemType(name),
    acquiredAtRound: round,
    pendingGrantKey,
  };
}

export function itemsFromStartStrings(strs: string[] | undefined, round = 0): Item[] {
  if (!strs?.length) return [];
  return strs.map((s) =>
    createItem({ name: s, description: '角色出身自带之物。' }, round),
  );
}

export function itemTypeLabel(t: ItemType): string {
  return t === 'consumable' ? '一次性' : '多次性';
}

export function formatItemsForPrompt(items: Item[]): string {
  if (!items.length) return '（空）';
  return items
    .map((it) => `- ${it.name}（${itemTypeLabel(it.type)}）：${it.description}`)
    .join('\n');
}
