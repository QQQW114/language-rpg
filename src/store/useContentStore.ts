import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type {
  Background, RandomEvent, StoryOutline, WorldBook, WorldBookEntry, ImportBundle, WorkspaceTemplate,
} from '@/types/content';
import { PRESET_OUTLINES } from '@/presets/outlines';
import { PRESET_BACKGROUNDS } from '@/presets/backgrounds';
import { PRESET_WORLDBOOKS } from '@/presets/worldbooks';
import { PRESET_EVENTS } from '@/presets/events';
import { PRESET_WORKSPACE_TEMPLATES } from '@/presets/workspaceTemplates';

interface ContentState {
  customOutlines: StoryOutline[];
  customBackgrounds: Background[];
  customWorldBooks: WorldBook[];
  customEvents: RandomEvent[];
  customWorkspaceTemplates: WorkspaceTemplate[];

  importBundle: (b: ImportBundle) => { added: number };
  addOutline: (o: StoryOutline) => void;
  addBackground: (b: Background) => void;
  addWorldBook: (w: WorldBook) => void;
  addEvent: (e: RandomEvent) => void;
  addWorkspaceTemplate: (t: WorkspaceTemplate) => void;
  updateOutline: (o: StoryOutline) => void;
  updateBackground: (b: Background) => void;
  updateWorldBook: (w: WorldBook) => void;
  updateEvent: (e: RandomEvent) => void;
  updateWorkspaceTemplate: (t: WorkspaceTemplate) => void;
  removeOutline: (id: string) => void;
  removeBackground: (id: string) => void;
  removeWorldBook: (id: string) => void;
  removeEvent: (id: string) => void;
  removeWorkspaceTemplate: (id: string) => void;
  clearCustom: () => void;
}

export const useContentStore = create<ContentState>()(
  persist(
    (set) => ({
      customOutlines: [],
      customBackgrounds: [],
      customWorldBooks: [],
      customEvents: [],
      customWorkspaceTemplates: [],

      importBundle: (b) => {
        let added = 0;
        set((s) => {
          const outlines = [...s.customOutlines];
          const backgrounds = [...s.customBackgrounds];
          const worldBooks = [...s.customWorldBooks];
          const events = [...s.customEvents];
          const workspaceTemplates = [...s.customWorkspaceTemplates];
          const push = <T extends { id: string }>(arr: T[], item: T) => {
            if (!arr.some((x) => x.id === item.id)) {
              arr.push(item);
              added++;
            }
          };
          b.outlines?.forEach((o) => push(outlines, o));
          b.backgrounds?.forEach((x) => push(backgrounds, x));
          b.worldBooks?.forEach((w) => push(worldBooks, w));
          b.events?.forEach((e) => push(events, e));
          b.workspaceTemplates?.forEach((t) => push(workspaceTemplates, t));
          return {
            customOutlines: outlines,
            customBackgrounds: backgrounds,
            customWorldBooks: worldBooks,
            customEvents: events,
            customWorkspaceTemplates: workspaceTemplates,
          };
        });
        return { added };
      },

      addOutline: (o) =>
        set((s) => ({
          customOutlines: s.customOutlines.some((x) => x.id === o.id)
            ? s.customOutlines
            : [...s.customOutlines, o],
        })),
      addBackground: (b) =>
        set((s) => ({
          customBackgrounds: s.customBackgrounds.some((x) => x.id === b.id)
            ? s.customBackgrounds
            : [...s.customBackgrounds, b],
        })),
      addWorldBook: (w) =>
        set((s) => ({
          customWorldBooks: s.customWorldBooks.some((x) => x.id === w.id)
            ? s.customWorldBooks
            : [...s.customWorldBooks, w],
        })),
      addEvent: (e) =>
        set((s) => ({
          customEvents: s.customEvents.some((x) => x.id === e.id)
            ? s.customEvents
            : [...s.customEvents, e],
        })),
      addWorkspaceTemplate: (t) =>
        set((s) => ({
          customWorkspaceTemplates: s.customWorkspaceTemplates.some((x) => x.id === t.id)
            ? s.customWorkspaceTemplates
            : [...s.customWorkspaceTemplates, t],
        })),

      updateOutline: (o) =>
        set((s) => ({ customOutlines: upsertById(s.customOutlines, o) })),
      updateBackground: (b) =>
        set((s) => ({ customBackgrounds: upsertById(s.customBackgrounds, b) })),
      updateWorldBook: (w) =>
        set((s) => ({ customWorldBooks: upsertById(s.customWorldBooks, w) })),
      updateEvent: (e) =>
        set((s) => ({ customEvents: upsertById(s.customEvents, e) })),
      updateWorkspaceTemplate: (t) =>
        set((s) => ({ customWorkspaceTemplates: upsertById(s.customWorkspaceTemplates, t) })),

      removeOutline: (id) =>
        set((s) => ({ customOutlines: s.customOutlines.filter((x) => x.id !== id) })),
      removeBackground: (id) =>
        set((s) => ({ customBackgrounds: s.customBackgrounds.filter((x) => x.id !== id) })),
      removeWorldBook: (id) =>
        set((s) => ({ customWorldBooks: s.customWorldBooks.filter((x) => x.id !== id) })),
      removeEvent: (id) =>
        set((s) => ({ customEvents: s.customEvents.filter((x) => x.id !== id) })),
      removeWorkspaceTemplate: (id) =>
        set((s) => ({ customWorkspaceTemplates: s.customWorkspaceTemplates.filter((x) => x.id !== id) })),

      clearCustom: () =>
        set({
          customOutlines: [],
          customBackgrounds: [],
          customWorldBooks: [],
          customEvents: [],
          customWorkspaceTemplates: [],
        }),
    }),
    { name: 'lrpg.content' },
  ),
);

function upsertById<T extends { id: string }>(arr: T[], item: T): T[] {
  return arr.some((x) => x.id === item.id)
    ? arr.map((x) => (x.id === item.id ? item : x))
    : [...arr, item];
}

function mergePresetAndCustom<T extends { id: string }>(presets: T[], custom: T[]): T[] {
  const customById = new Map(custom.map((item) => [item.id, item]));
  const presetIds = new Set(presets.map((item) => item.id));
  return [
    ...presets.map((item) => customById.get(item.id) ?? item),
    ...custom.filter((item) => !presetIds.has(item.id)),
  ];
}

// 选择器：预设 + 自定义合并
export function selectAllOutlines(s: ContentState): StoryOutline[] {
  return mergePresetAndCustom(PRESET_OUTLINES, s.customOutlines);
}
export function selectAllBackgrounds(s: ContentState): Background[] {
  return mergePresetAndCustom(PRESET_BACKGROUNDS, s.customBackgrounds);
}
export function selectAllWorldBooks(s: ContentState): WorldBook[] {
  return mergePresetAndCustom(PRESET_WORLDBOOKS, s.customWorldBooks);
}
export function selectAllEvents(s: ContentState): RandomEvent[] {
  return mergePresetAndCustom(PRESET_EVENTS, s.customEvents);
}

export function selectAllWorkspaceTemplates(s: ContentState): WorkspaceTemplate[] {
  return mergePresetAndCustom(PRESET_WORKSPACE_TEMPLATES, s.customWorkspaceTemplates);
}

export function flattenWorldBookEntries(books: WorldBook[], ids: string[]): WorldBookEntry[] {
  const set = new Set(ids);
  return books.filter((b) => set.has(b.id)).flatMap((b) => b.entries);
}
