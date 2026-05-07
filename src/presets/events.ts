import type { RandomEvent } from '@/types/content';

// 随机事件已被执笔模式的"动态长线事件导演"取代，预设事件保持为空。
// 仍保留导出，避免历史代码（如 LibraryPage / SetupPage 的 PRESET_EVENTS.some(...) 判断）报错。
export const PRESET_EVENTS: RandomEvent[] = [];
