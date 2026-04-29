import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { StrictCustomConfig, StrictRoundDirective } from '@/types/custom';
import { DEFAULT_STRICT_CUSTOM_CONFIG, normalizeStrictCustomConfig } from '@/lib/strictCustom';
import { genId } from '@/lib/utils';

export const DEFAULT_AUTHOR_MODE_CONFIG: StrictCustomConfig = {
  ...DEFAULT_STRICT_CUSTOM_CONFIG,
  enabled: true,
};

interface AuthorModeState {
  config: StrictCustomConfig;
  update: (patch: Partial<StrictCustomConfig>) => void;
  reset: () => void;
  addDirective: () => void;
  updateDirective: (id: string, patch: Partial<StrictRoundDirective>) => void;
  removeDirective: (id: string) => void;
}

function normalizeAuthorConfig(input?: Partial<StrictCustomConfig>): StrictCustomConfig {
  return {
    ...normalizeStrictCustomConfig({ ...DEFAULT_AUTHOR_MODE_CONFIG, ...input }),
    enabled: true,
  };
}

export const useAuthorModeStore = create<AuthorModeState>()(
  persist(
    (set) => ({
      config: { ...DEFAULT_AUTHOR_MODE_CONFIG, detailedOutline: [] },
      update: (patch) =>
        set((s) => ({ config: normalizeAuthorConfig({ ...s.config, ...patch, enabled: true }) })),
      reset: () => set({ config: { ...DEFAULT_AUTHOR_MODE_CONFIG, detailedOutline: [] } }),
      addDirective: () =>
        set((s) => ({
          config: {
            ...s.config,
            enabled: true,
            detailedOutline: [
              ...s.config.detailedOutline,
              {
                id: genId('author'),
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
            enabled: true,
            detailedOutline: s.config.detailedOutline.map((item) =>
              item.id === id ? { ...item, ...patch } : item,
            ),
          },
        })),
      removeDirective: (id) =>
        set((s) => ({
          config: {
            ...s.config,
            enabled: true,
            detailedOutline: s.config.detailedOutline.filter((item) => item.id !== id),
          },
        })),
    }),
    {
      name: 'lrpg.authorModeDraft',
      merge: (persistedState, currentState) => {
        const p = (persistedState as any) ?? {};
        return {
          ...currentState,
          config: normalizeAuthorConfig(p.config),
        };
      },
    },
  ),
);
