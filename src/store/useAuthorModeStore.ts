import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { StrictCustomConfig } from '@/types/custom';
import type { AuthorEventBeatConfig } from '@/types/game';
import { DEFAULT_STRICT_CUSTOM_CONFIG, normalizeStrictCustomConfig } from '@/lib/strictCustom';
import { DEFAULT_AUTHOR_EVENT_BEAT_CONFIG, normalizeAuthorEventBeatConfig } from '@/lib/authorMode';

export const DEFAULT_AUTHOR_MODE_CONFIG: StrictCustomConfig = {
  ...DEFAULT_STRICT_CUSTOM_CONFIG,
  enabled: true,
};

interface AuthorModeState {
  config: StrictCustomConfig;
  eventBeatConfig: AuthorEventBeatConfig;
  update: (patch: Partial<StrictCustomConfig>) => void;
  updateEventBeat: (patch: Partial<AuthorEventBeatConfig>) => void;
  reset: () => void;
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
      config: { ...DEFAULT_AUTHOR_MODE_CONFIG },
      eventBeatConfig: { ...DEFAULT_AUTHOR_EVENT_BEAT_CONFIG },
      update: (patch) =>
        set((s) => ({ config: normalizeAuthorConfig({ ...s.config, ...patch, enabled: true }) })),
      updateEventBeat: (patch) =>
        set((s) => ({ eventBeatConfig: normalizeAuthorEventBeatConfig({ ...s.eventBeatConfig, ...patch }) })),
      reset: () => set({
        config: { ...DEFAULT_AUTHOR_MODE_CONFIG },
        eventBeatConfig: { ...DEFAULT_AUTHOR_EVENT_BEAT_CONFIG },
      }),
    }),
    {
      name: 'lrpg.authorModeDraft',
      merge: (persistedState, currentState) => {
        const p = (persistedState as any) ?? {};
        return {
          ...currentState,
          config: normalizeAuthorConfig(p.config),
          eventBeatConfig: normalizeAuthorEventBeatConfig(p.eventBeatConfig),
        };
      },
    },
  ),
);
