import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { StrictCustomConfig, StrictRoundDirective } from '@/types/custom';
import { DEFAULT_STRICT_CUSTOM_CONFIG, normalizeStrictCustomConfig } from '@/lib/strictCustom';
import { genId } from '@/lib/utils';

interface StrictCustomState {
  config: StrictCustomConfig;
  update: (patch: Partial<StrictCustomConfig>) => void;
  reset: () => void;
  addDirective: () => void;
  updateDirective: (id: string, patch: Partial<StrictRoundDirective>) => void;
  removeDirective: (id: string) => void;
}

export const useStrictCustomStore = create<StrictCustomState>()(
  persist(
    (set) => ({
      config: { ...DEFAULT_STRICT_CUSTOM_CONFIG },
      update: (patch) =>
        set((s) => ({ config: { ...s.config, ...patch } })),
      reset: () => set({ config: { ...DEFAULT_STRICT_CUSTOM_CONFIG, detailedOutline: [] } }),
      addDirective: () =>
        set((s) => ({
          config: {
            ...s.config,
            enabled: true,
            detailedOutline: [
              ...s.config.detailedOutline,
              {
                id: genId('strict'),
                startRound: 1,
                endRound: 10,
                prompt: '主角：；事件：；风格：；限制：本段只铺垫，不提前揭示关键能力。',
              },
            ],
          },
        })),
      updateDirective: (id, patch) =>
        set((s) => ({
          config: {
            ...s.config,
            detailedOutline: s.config.detailedOutline.map((item) =>
              item.id === id ? { ...item, ...patch } : item,
            ),
          },
        })),
      removeDirective: (id) =>
        set((s) => ({
          config: {
            ...s.config,
            detailedOutline: s.config.detailedOutline.filter((item) => item.id !== id),
          },
        })),
    }),
    {
      name: 'lrpg.strictCustomDraft',
      merge: (persistedState, currentState) => {
        const p = (persistedState as any) ?? {};
        return {
          ...currentState,
          config: normalizeStrictCustomConfig(p.config),
        };
      },
    },
  ),
);

