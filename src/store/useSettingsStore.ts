import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { AppSettings } from '@/types/settings';
import { DEFAULT_SETTINGS } from '@/types/settings';

interface SettingsState {
  settings: AppSettings;
  update: (patch: Partial<AppSettings>) => void;
  reset: () => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      settings: { ...DEFAULT_SETTINGS },
      update: (patch) =>
        set((s) => ({ settings: { ...s.settings, ...patch } })),
      reset: () => set({ settings: { ...DEFAULT_SETTINGS } }),
    }),
    {
      name: 'lrpg.settings',
      merge: (persistedState, currentState) => {
        const p = (persistedState as any) ?? {};
        const persistedSettings = (p.settings as Partial<AppSettings>) ?? {};
        const persistedRouting = persistedSettings.authorModelRouting ?? {};
        return {
          ...currentState,
          settings: {
            ...DEFAULT_SETTINGS,
            ...persistedSettings,
            authorModelRouting: {
              ...DEFAULT_SETTINGS.authorModelRouting,
              ...persistedRouting,
              core: {
                ...DEFAULT_SETTINGS.authorModelRouting.core,
                ...(persistedRouting as any).core,
              },
              calls: {
                ...DEFAULT_SETTINGS.authorModelRouting.calls,
                ...(persistedRouting as any).calls,
              },
            },
          },
        };
      },
    },
  ),
);
