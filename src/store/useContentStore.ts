import { create, type StoreApi } from 'zustand';
import { persist } from 'zustand/middleware';
import type {
  Background,
  ContentExportPackage,
  ContentImportResult,
  ContentMutationResult,
  ContentValidationIssue,
  ImportBundle,
  StoryOutline,
  WorldBook,
  WorldBookEntry,
} from '@/types/content';
import {
  buildContentExport,
  validateImportBundle,
  validateStoryOutline,
  validateWorldBook,
} from '@/lib/contentLibrary';
import { PRESET_OUTLINES } from '@/presets/outlines';
import { PRESET_BACKGROUNDS } from '@/presets/backgrounds';
import { PRESET_WORLDBOOKS } from '@/presets/worldbooks';

export interface ContentImportOptions {
  /** 仅允许覆盖同 id 的自定义内容；内置预设在任何情况下都不会被覆盖。 */
  replaceCustom?: boolean;
}

export interface ContentState {
  customOutlines: StoryOutline[];
  customBackgrounds: Background[];
  customWorldBooks: WorldBook[];

  importBundle: (bundle: unknown, options?: ContentImportOptions) => ContentImportResult;
  exportBundle: () => ContentExportPackage;
  addOutline: (outline: StoryOutline) => ContentMutationResult;
  addBackground: (background: Background) => ContentMutationResult;
  addWorldBook: (worldBook: WorldBook) => ContentMutationResult;
  updateOutline: (outline: StoryOutline) => ContentMutationResult;
  updateBackground: (background: Background) => ContentMutationResult;
  updateWorldBook: (worldBook: WorldBook) => ContentMutationResult;
  removeOutline: (id: string) => void;
  removeBackground: (id: string) => void;
  removeWorldBook: (id: string) => void;
  clearCustom: () => void;
}

const presetIds = {
  outlines: new Set(PRESET_OUTLINES.map((item) => item.id)),
  backgrounds: new Set(PRESET_BACKGROUNDS.map((item) => item.id)),
  worldBooks: new Set(PRESET_WORLDBOOKS.map((item) => item.id)),
};

type CustomArrayKey = keyof Pick<ContentState, 'customOutlines' | 'customBackgrounds' | 'customWorldBooks'>;

const mutationIssue = (
  kind: ContentValidationIssue['kind'],
  path: string,
  code: string,
  message: string,
): ContentMutationResult => ({ ok: false, issues: [{ kind, path, code, message }] });

function cloneBundleFromState(state: ContentState): ImportBundle {
  return structuredClone({
    outlines: state.customOutlines,
    backgrounds: state.customBackgrounds,
    worldBooks: state.customWorldBooks,
  });
}

export const useContentStore = create<ContentState>()(
  persist(
    (set, get) => ({
      customOutlines: [],
      customBackgrounds: [],
      customWorldBooks: [],

      importBundle: (input, options) => {
        const validation = validateImportBundle(input);
        const normalized = validation.value ?? {};
        const result: ContentImportResult = {
          added: 0,
          updated: 0,
          skipped: 0,
          issues: [...validation.issues],
        };
        set((state) => {
          const next = {
            customOutlines: [...state.customOutlines],
            customBackgrounds: [...state.customBackgrounds],
            customWorldBooks: [...state.customWorldBooks],
          };

          const merge = <T extends { id: string }>(
            values: T[] | undefined,
            key: CustomArrayKey,
            protectedIds: Set<string>,
            kind: ContentValidationIssue['kind'],
          ) => {
            if (!values) return;
            const target = next[key] as unknown as T[];
            values.forEach((value) => {
              if (protectedIds.has(value.id)) {
                result.skipped += 1;
                result.issues.push({
                  kind,
                  path: `${kind}.${value.id}`,
                  code: 'preset_id_conflict',
                  message: `“${value.id}”是内置预设，已跳过；请复制为新的自定义内容后再编辑。`,
                });
                return;
              }
              const index = target.findIndex((item) => item.id === value.id);
              if (index < 0) {
                target.push(value);
                result.added += 1;
              } else if (options?.replaceCustom) {
                target[index] = value;
                result.updated += 1;
              } else {
                result.skipped += 1;
                result.issues.push({
                  kind,
                  path: `${kind}.${value.id}`,
                  code: 'custom_id_conflict',
                  message: `已存在同 id 的自定义内容“${value.id}”，已跳过。`,
                });
              }
            });
          };

          merge(normalized.outlines, 'customOutlines', presetIds.outlines, 'outline');
          merge(normalized.backgrounds, 'customBackgrounds', presetIds.backgrounds, 'background');
          merge(normalized.worldBooks, 'customWorldBooks', presetIds.worldBooks, 'worldBook');
          return next;
        });
        return result;
      },

      exportBundle: () => buildContentExport(cloneBundleFromState(get())),

      addOutline: (outline) => addValidated(set, get, {
        value: outline,
        validate: validateStoryOutline,
        key: 'customOutlines',
        protectedIds: presetIds.outlines,
        kind: 'outline',
      }),
      addWorldBook: (worldBook) => addValidated(set, get, {
        value: worldBook,
        validate: validateWorldBook,
        key: 'customWorldBooks',
        protectedIds: presetIds.worldBooks,
        kind: 'worldBook',
      }),
      addBackground: (background) => addBundleResource(set, get, 'backgrounds', 'customBackgrounds', background, presetIds.backgrounds, 'background', false),

      updateOutline: (outline) => addValidated(set, get, {
        value: outline,
        validate: validateStoryOutline,
        key: 'customOutlines',
        protectedIds: presetIds.outlines,
        kind: 'outline',
        replace: true,
      }),
      updateWorldBook: (worldBook) => addValidated(set, get, {
        value: worldBook,
        validate: validateWorldBook,
        key: 'customWorldBooks',
        protectedIds: presetIds.worldBooks,
        kind: 'worldBook',
        replace: true,
      }),
      updateBackground: (background) => addBundleResource(set, get, 'backgrounds', 'customBackgrounds', background, presetIds.backgrounds, 'background', true),

      removeOutline: (id) => set((state) => ({ customOutlines: state.customOutlines.filter((item) => item.id !== id) })),
      removeBackground: (id) => set((state) => ({ customBackgrounds: state.customBackgrounds.filter((item) => item.id !== id) })),
      removeWorldBook: (id) => set((state) => ({ customWorldBooks: state.customWorldBooks.filter((item) => item.id !== id) })),
      clearCustom: () => set({
        customOutlines: [],
        customBackgrounds: [],
        customWorldBooks: [],
      }),
    }),
    {
      name: 'lrpg.content',
      // v3：移除已废弃的事件库与司书库模板集合。旧存档由 sanitize 静默丢弃多余字段。
      version: 3,
      partialize: (state) => ({
        customOutlines: state.customOutlines,
        customBackgrounds: state.customBackgrounds,
        customWorldBooks: state.customWorldBooks,
      }) as ContentState,
      migrate: (persisted) => sanitizePersistedContent(persisted),
      merge: (persisted, current) => ({ ...current, ...sanitizePersistedContent(persisted) }),
    },
  ),
);

type SetContentState = StoreApi<ContentState>['setState'];
type GetContentState = StoreApi<ContentState>['getState'];

function addValidated<T extends { id: string }>(
  set: SetContentState,
  get: GetContentState,
  options: {
    value: unknown;
    validate: (value: unknown) => { value?: T; issues: ContentValidationIssue[] };
    key: CustomArrayKey;
    protectedIds: Set<string>;
    kind: ContentValidationIssue['kind'];
    replace?: boolean;
  },
): ContentMutationResult {
  const validated = options.validate(options.value);
  if (!validated.value) return { ok: false, issues: validated.issues };
  const value = validated.value;
  if (options.protectedIds.has(value.id)) {
    return mutationIssue(options.kind, 'id', 'preset_id_conflict', '内置预设不可覆盖，请先复制为新的自定义内容。');
  }
  const exists = (get()[options.key] as unknown as T[]).some((item) => item.id === value.id);
  if (exists && !options.replace) {
    return mutationIssue(options.kind, 'id', 'custom_id_conflict', '已存在同 id 的自定义内容。');
  }
  set((state) => {
    const values = state[options.key] as unknown as T[];
    return {
      [options.key]: exists
        ? values.map((item) => item.id === value.id ? value : item)
        : [...values, value],
    } as Partial<ContentState>;
  });
  return { ok: true, issues: validated.issues };
}

function addBundleResource<T extends { id: string }>(
  set: SetContentState,
  get: GetContentState,
  bundleKey: keyof ImportBundle,
  stateKey: CustomArrayKey,
  value: T,
  protectedIds: Set<string>,
  kind: ContentValidationIssue['kind'],
  replace: boolean,
): ContentMutationResult {
  const validated = validateImportBundle({ [bundleKey]: [value] });
  const normalized = (validated.value?.[bundleKey] as T[] | undefined)?.[0];
  if (!normalized) return { ok: false, issues: validated.issues };
  return addValidated(set, get, {
    value: normalized,
    validate: () => ({ value: normalized, issues: validated.issues }),
    key: stateKey,
    protectedIds,
    kind,
    replace,
  });
}

function sanitizePersistedContent(input: unknown): Pick<ContentState,
  'customOutlines' | 'customBackgrounds' | 'customWorldBooks'> {
  const record = typeof input === 'object' && input !== null ? input as Record<string, unknown> : {};
  const validation = validateImportBundle({
    outlines: record.customOutlines,
    backgrounds: record.customBackgrounds,
    worldBooks: record.customWorldBooks,
  });
  const value = validation.value ?? {};
  return {
    customOutlines: (value.outlines ?? []).filter((item) => !presetIds.outlines.has(item.id)),
    customBackgrounds: (value.backgrounds ?? []).filter((item) => !presetIds.backgrounds.has(item.id)),
    customWorldBooks: (value.worldBooks ?? []).filter((item) => !presetIds.worldBooks.has(item.id)),
  };
}

function mergePresetAndCustom<T extends { id: string }>(presets: T[], custom: T[]): T[] {
  const protectedIds = new Set(presets.map((item) => item.id));
  return [...presets, ...custom.filter((item) => !protectedIds.has(item.id))];
}

// 选择器：只读内置预设 + 浏览器本地自定义内容。自定义内容永不覆盖预设。
export function selectAllOutlines(state: ContentState): StoryOutline[] {
  return mergePresetAndCustom(PRESET_OUTLINES, state.customOutlines);
}
export function selectAllBackgrounds(state: ContentState): Background[] {
  return mergePresetAndCustom(PRESET_BACKGROUNDS, state.customBackgrounds);
}
export function selectAllWorldBooks(state: ContentState): WorldBook[] {
  return mergePresetAndCustom(PRESET_WORLDBOOKS, state.customWorldBooks);
}

export function flattenWorldBookEntries(books: WorldBook[], ids: string[]): WorldBookEntry[] {
  const selectedIds = new Set(ids);
  return books.filter((book) => selectedIds.has(book.id)).flatMap((book) => book.entries);
}
