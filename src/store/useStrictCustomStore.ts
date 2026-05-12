import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { StrictCustomConfig } from '@/types/custom';
import { DEFAULT_STRICT_CUSTOM_CONFIG, normalizeStrictCustomConfig } from '@/lib/strictCustom';

interface StrictCustomState {
  config: StrictCustomConfig;
  update: (patch: Partial<StrictCustomConfig>) => void;
  reset: () => void;
}

export const useStrictCustomStore = create<StrictCustomState>()(
  persist(
    (set) => ({
      config: { ...DEFAULT_STRICT_CUSTOM_CONFIG },
      update: (patch) =>
        set((s) => ({ config: { ...s.config, ...patch } })),
      reset: () => set({ config: { ...DEFAULT_STRICT_CUSTOM_CONFIG } }),
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
