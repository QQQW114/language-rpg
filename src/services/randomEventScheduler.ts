// 随机事件调度器：每回合按概率从候选事件中选一个（至多一个）

import type { RandomEvent } from '@/types/content';
import type { TriggeredEventRecord } from '@/types/game';

export interface ScheduleInput {
  candidates: RandomEvent[];
  currentRound: number;
  triggered: TriggeredEventRecord[];
  rand?: () => number;  // 可注入以便测试
}

export function pickRandomEvent(p: ScheduleInput): RandomEvent | undefined {
  const { candidates, currentRound, triggered } = p;
  const rand = p.rand ?? Math.random;
  if (!candidates?.length) return undefined;

  const eligible = candidates.filter((ev) => {
    if (ev.minRound !== undefined && currentRound < ev.minRound) return false;
    const fired = triggered.filter((t) => t.id === ev.id);
    if (ev.once && fired.length > 0) return false;
    if (ev.cooldown !== undefined && fired.length > 0) {
      const lastRound = Math.max(...fired.map((t) => t.round));
      if (currentRound - lastRound < ev.cooldown) return false;
    }
    return true;
  });

  if (!eligible.length) return undefined;

  // 归一化概率（将每个事件的 probability 视作"本回合独立触发概率"，
  // 若多个同时触发，则在其中按概率加权随机挑一个；若都未触发则本回合无事件）
  const rolled = eligible.filter((ev) => rand() < ev.probability);
  if (!rolled.length) return undefined;

  const total = rolled.reduce((s, ev) => s + ev.probability, 0);
  let r = rand() * total;
  for (const ev of rolled) {
    r -= ev.probability;
    if (r <= 0) return ev;
  }
  return rolled[rolled.length - 1];
}
