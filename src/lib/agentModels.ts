import { DEFAULT_SETTINGS, type AppSettings, type AuthorCallModelKey, type AuthorCoreModelKey } from '@/types/settings';

function cleanModelName(value: unknown): string | undefined {
  const text = String(value ?? '').trim();
  return text || undefined;
}

export function resolveStoryModel(settings: AppSettings): string {
  return cleanModelName(settings.storyModel) || DEFAULT_SETTINGS.storyModel;
}

export function resolveAuthorToolModel(settings: AppSettings): string {
  return cleanModelName(settings.authorModelRouting?.toolModel) || resolveStoryModel(settings);
}

export function resolveAuthorCoreModel(settings: AppSettings, key: AuthorCoreModelKey): string {
  return cleanModelName(settings.authorModelRouting?.core?.[key]) || resolveStoryModel(settings);
}

export function resolveAuthorCallModel(settings: AppSettings, key: AuthorCallModelKey): string {
  return cleanModelName(settings.authorModelRouting?.calls?.[key]) || resolveStoryModel(settings);
}

export function resolveLegacySummaryModel(settings: AppSettings): string {
  return cleanModelName(settings.summaryModel) || resolveStoryModel(settings);
}

export function resolveLegacyMemoryModel(settings: AppSettings): string {
  return cleanModelName(settings.memoryModel) || cleanModelName(settings.summaryModel) || resolveStoryModel(settings);
}

export function resolveLegacyRandomModel(settings: AppSettings): string {
  return cleanModelName(settings.randomModel) || cleanModelName(settings.summaryModel) || resolveStoryModel(settings);
}
