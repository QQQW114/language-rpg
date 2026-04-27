// 世界书关键词匹配：根据最近的故事文本 + 玩家输入，激活命中的条目

import type { WorldBookEntry } from '@/types/content';

export interface MatchInput {
  entries: WorldBookEntry[];
  recentText: string;        // 最近若干轮合并后的文本
  currentInput?: string;     // 玩家本回合输入
  maxActive?: number;        // 最多激活多少条（避免 prompt 膨胀），默认 8
}

export function matchWorldBook(p: MatchInput): WorldBookEntry[] {
  const { entries, recentText, currentInput, maxActive = 8 } = p;
  if (!entries?.length) return [];

  const haystack = `${recentText}\n${currentInput ?? ''}`;
  const always: WorldBookEntry[] = [];
  const triggered: WorldBookEntry[] = [];

  for (const e of entries) {
    if (e.alwaysActive) {
      always.push(e);
      continue;
    }
    if (!e.keywords?.length) continue;
    const hit = e.keywords.some((kw) => kw && haystack.includes(kw));
    if (hit) triggered.push(e);
  }

  triggered.sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
  const limited = triggered.slice(0, Math.max(0, maxActive - always.length));
  return [...always, ...limited];
}
