import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import {
  DEFAULT_SETTINGS,
  type AppSettings,
  type PlannerContextPreset,
  type ReasoningEffort,
  type RoleInjectConfig,
} from '@/types/settings';

interface State {
  settings: AppSettings;
  update: (patch: Partial<AppSettings>) => void;
  reset: () => void;
}

const contextPresets: PlannerContextPreset[] = ['compact', 'standard', 'rich', 'custom'];
const featureModes = ['auto', 'enabled', 'disabled'] as const;

function normalizeRoleInject(value: unknown, fallback: RoleInjectConfig): RoleInjectConfig {
  const record = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  return {
    enabled: record.enabled === true,
    text: typeof record.text === 'string' ? record.text : fallback.text,
  };
}

export function normalizeSettings(value?: Partial<AppSettings>): AppSettings {
  const preset = contextPresets.includes(value?.plannerContextPreset as PlannerContextPreset)
    ? (value?.plannerContextPreset as PlannerContextPreset)
    : DEFAULT_SETTINGS.plannerContextPreset;
  const tokenValue = Number(value?.plannerContextTokens);
  const plannerContextTokens = Number.isFinite(tokenValue) && tokenValue > 0
    ? Math.round(tokenValue)
    : DEFAULT_SETTINGS.plannerContextTokens;
  const defaultInjects = DEFAULT_SETTINGS.roleInjects;
  const persistedInjects = value?.roleInjects && typeof value.roleInjects === 'object'
    ? value.roleInjects as Partial<Record<keyof typeof defaultInjects, unknown>>
    : {};

  const reasoningEfforts = ['low', 'high', 'max'] as const;
  const normalizeEffort = (value: unknown): ReasoningEffort | undefined => (
    reasoningEfforts.includes(value as ReasoningEffort) ? value as ReasoningEffort : undefined
  );
  const normalizeEffortMap = (value: unknown): Record<string, ReasoningEffort> => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    const out: Record<string, ReasoningEffort> = {};
    for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
      const model = String(key).trim().slice(0, 120);
      const effort = normalizeEffort(raw);
      if (model && effort) out[model] = effort;
    }
    return out;
  };
  const persistedByModel = normalizeEffortMap(value?.reasoningEffortByModel);
  const persistedByPhase = (() => {
    const raw = value?.reasoningEffortByPhase;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {} as Partial<Record<'planner_pre' | 'story' | 'planner_post', ReasoningEffort>>;
    const source = raw as Record<string, unknown>;
    const out: Partial<Record<'planner_pre' | 'story' | 'planner_post', ReasoningEffort>> = {};
    for (const phase of ['planner_pre', 'story', 'planner_post'] as const) {
      const effort = normalizeEffort(source[phase]);
      if (effort) out[phase] = effort;
    }
    return out;
  })();
  // 旧设置里只有"按阶段"的覆盖，没有"按模型"。把阶段覆盖折进它对应的模型，
  // 让升级后的存档保持原来的行为（否则那些设置会被静默丢弃）。
  const migratedByModel: Record<string, ReasoningEffort> = { ...persistedByModel };
  const phaseModelFallback: Array<['story' | 'planner_post' | 'planner_pre', string]> = [
    ['story', String(value?.storyModel ?? DEFAULT_SETTINGS.storyModel)],
    ['planner_post', String(value?.plannerModel ?? DEFAULT_SETTINGS.plannerModel)],
    ['planner_pre', String(value?.plannerModel ?? DEFAULT_SETTINGS.plannerModel)],
  ];
  for (const [phase, model] of phaseModelFallback) {
    const effort = persistedByPhase[phase];
    const name = model.trim();
    if (effort && name) migratedByModel[name] = effort;
  }

  return {
    ...DEFAULT_SETTINGS,
    ...value,
    plannerContextPreset: preset,
    plannerContextTokens,
    plannerToolsEnabled: value?.plannerToolsEnabled === true,
    plannerToolMaxCalls: Math.max(1, Math.min(6, Math.round(Number(value?.plannerToolMaxCalls) || DEFAULT_SETTINGS.plannerToolMaxCalls))),
    // 旧设置没有这个字段：只有严格 true 才启用，缺字段/坏值一律按关闭处理（默认关）。
    plannerWebSearchEnabled: value?.plannerWebSearchEnabled === true,
    plannerJsonMode: featureModes.includes(value?.plannerJsonMode as any) ? value!.plannerJsonMode! : DEFAULT_SETTINGS.plannerJsonMode,
    thinkingMode: featureModes.includes(value?.thinkingMode as any) ? value!.thinkingMode! : DEFAULT_SETTINGS.thinkingMode,
    // 回归：这里曾写成 `value?.reasoningEffort === 'max' ? 'max' : 'high'`，
    // 于是 low 档会被静默改回 high（设置看起来生效、实际没生效）。
    reasoningEffort: normalizeEffort(value?.reasoningEffort) ?? DEFAULT_SETTINGS.reasoningEffort,
    reasoningEffortByModel: migratedByModel,
    reasoningEffortByPhase: persistedByPhase,
    roleInjects: {
      planner: normalizeRoleInject(persistedInjects.planner, defaultInjects.planner),
      story: normalizeRoleInject(persistedInjects.story, defaultInjects.story),
      post: normalizeRoleInject(persistedInjects.post, defaultInjects.post),
    },
    inputPerspective: value?.inputPerspective === 'director' ? 'director' : 'player',
    stateEditingEnabled: value?.stateEditingEnabled !== false,
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
