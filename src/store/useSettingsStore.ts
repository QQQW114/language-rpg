import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import {
  DEFAULT_SETTINGS,
  type AppSettings,
  type PlannerContextPreset,
} from '@/types/settings';

interface State {
  settings: AppSettings;
  update: (patch: Partial<AppSettings>) => void;
  reset: () => void;
}

const contextPresets: PlannerContextPreset[] = ['compact', 'standard', 'rich', 'custom'];
const featureModes = ['auto', 'enabled', 'disabled'] as const;

function normalizeSettings(value?: Partial<AppSettings>): AppSettings {
  const preset = contextPresets.includes(value?.plannerContextPreset as PlannerContextPreset)
    ? (value?.plannerContextPreset as PlannerContextPreset)
    : DEFAULT_SETTINGS.plannerContextPreset;
  const tokenValue = Number(value?.plannerContextTokens);
  const plannerContextTokens = Number.isFinite(tokenValue) && tokenValue > 0
    ? Math.round(tokenValue)
    : DEFAULT_SETTINGS.plannerContextTokens;

  return {
    ...DEFAULT_SETTINGS,
    ...value,
    plannerContextPreset: preset,
    plannerContextTokens,
    plannerToolsEnabled: value?.plannerToolsEnabled === true,
    plannerToolMaxCalls: Math.max(1, Math.min(6, Math.round(Number(value?.plannerToolMaxCalls) || DEFAULT_SETTINGS.plannerToolMaxCalls))),
    plannerJsonMode: featureModes.includes(value?.plannerJsonMode as any) ? value!.plannerJsonMode! : DEFAULT_SETTINGS.plannerJsonMode,
    thinkingMode: featureModes.includes(value?.thinkingMode as any) ? value!.thinkingMode! : DEFAULT_SETTINGS.thinkingMode,
    reasoningEffort: value?.reasoningEffort === 'max' ? 'max' : 'high',
  };
}

export const useSettingsStore = create<State>()(
  persist(
    (set) => ({
      settings: { ...DEFAULT_SETTINGS },
      update: (patch) => set((state) => ({
        settings: normalizeSettings({ ...state.settings, ...patch }),
      })),
      reset: () => set({ settings: { ...DEFAULT_SETTINGS } }),
    }),
    {
      name: 'lrpg.settings.v2',
      merge: (persisted, current) => {
        const persistedState = persisted as Partial<State> | undefined;
        return {
          ...current,
          ...persistedState,
          settings: normalizeSettings(persistedState?.settings),
        };
      },
    },
  ),
);
