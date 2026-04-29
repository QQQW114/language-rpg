import type { AppSettings, StoryStyleSettings } from '@/types/settings';
import type { Background, ImportBundle, RandomEvent, StoryOutline, WorldBook } from '@/types/content';
import type { GameSave, StoryArc } from '@/types/game';
import { genId } from '@/lib/utils';

export const JOURNEY_PACKAGE_KIND = 'language-rpg.journey-package';
export const JOURNEY_PACKAGE_VERSION = 1;

export interface JourneyPackage {
  kind: typeof JOURNEY_PACKAGE_KIND;
  schemaVersion: typeof JOURNEY_PACKAGE_VERSION;
  exportedAt: number;
  app: {
    name: 'language-rpg';
  };
  storyStyle: StoryStyleSettings;
  save: GameSave;
  resources: Required<Pick<ImportBundle, 'outlines' | 'backgrounds' | 'worldBooks' | 'events'>>;
}

export interface InstantiatedJourneyPackage {
  save: GameSave;
  resources: Required<Pick<ImportBundle, 'outlines' | 'backgrounds' | 'worldBooks' | 'events'>>;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function uniqueById<T extends { id: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of items) {
    if (!item?.id || seen.has(item.id)) continue;
    seen.add(item.id);
    out.push(item);
  }
  return out;
}

export function pickStoryStyle(save: GameSave, settings: AppSettings): StoryStyleSettings {
  return {
    storyLength: save.content.storyStyle?.storyLength ?? settings.storyLength,
    storyStyleAddendum: save.content.storyStyle?.storyStyleAddendum ?? settings.storyStyleAddendum,
  };
}

export function buildJourneyPackage(p: {
  save: GameSave;
  settings: AppSettings;
  outlines: StoryOutline[];
  backgrounds: Background[];
  worldBooks: WorldBook[];
  events: RandomEvent[];
}): JourneyPackage {
  const storyStyle = pickStoryStyle(p.save, p.settings);
  const save = clone({
    ...p.save,
    content: {
      ...p.save.content,
      storyStyle,
    },
  });

  const outline = p.outlines.find((item) => item.id === save.content.outlineId);
  const background = p.backgrounds.find((item) => item.id === save.content.backgroundId);
  const worldBookIds = new Set(save.content.worldBookIds ?? []);
  const eventIds = new Set(save.content.eventIds ?? []);

  return {
    kind: JOURNEY_PACKAGE_KIND,
    schemaVersion: JOURNEY_PACKAGE_VERSION,
    exportedAt: Date.now(),
    app: { name: 'language-rpg' },
    storyStyle,
    save,
    resources: {
      outlines: outline ? [clone(outline)] : [],
      backgrounds: background ? [clone(background)] : [],
      worldBooks: p.worldBooks.filter((item) => worldBookIds.has(item.id)).map(clone),
      events: p.events.filter((item) => eventIds.has(item.id)).map(clone),
    },
  };
}

export function parseJourneyPackage(text: string): JourneyPackage {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error('旅程包不是合法 JSON。');
  }

  const pkg = raw as Partial<JourneyPackage>;
  if (pkg.kind !== JOURNEY_PACKAGE_KIND) {
    throw new Error('文件类型不正确：不是言灵旅程包。');
  }
  if (pkg.schemaVersion !== JOURNEY_PACKAGE_VERSION) {
    throw new Error(`暂不支持的旅程包版本：${String(pkg.schemaVersion)}`);
  }
  if (!pkg.save || typeof pkg.save !== 'object') {
    throw new Error('旅程包缺少存档数据。');
  }

  return {
    kind: JOURNEY_PACKAGE_KIND,
    schemaVersion: JOURNEY_PACKAGE_VERSION,
    exportedAt: Number(pkg.exportedAt) || Date.now(),
    app: { name: 'language-rpg' },
    storyStyle: {
      storyLength: pkg.storyStyle?.storyLength ?? 'standard',
      storyStyleAddendum: pkg.storyStyle?.storyStyleAddendum ?? '',
    },
    save: pkg.save as GameSave,
    resources: {
      outlines: Array.isArray(pkg.resources?.outlines) ? pkg.resources.outlines : [],
      backgrounds: Array.isArray(pkg.resources?.backgrounds) ? pkg.resources.backgrounds : [],
      worldBooks: Array.isArray(pkg.resources?.worldBooks) ? pkg.resources.worldBooks : [],
      events: Array.isArray(pkg.resources?.events) ? pkg.resources.events : [],
    },
  };
}

export function instantiateJourneyPackage(pkg: JourneyPackage): InstantiatedJourneyPackage {
  const idMap = new Map<string, string>();
  const mapId = (oldId: string | undefined, prefix: string): string | undefined => {
    if (!oldId) return undefined;
    const existing = idMap.get(oldId);
    if (existing) return existing;
    const next = genId(prefix);
    idMap.set(oldId, next);
    return next;
  };

  for (const item of pkg.resources.outlines) mapId(item.id, 'imp_outline');
  for (const item of pkg.resources.backgrounds) mapId(item.id, 'imp_bg');
  for (const item of pkg.resources.worldBooks) mapId(item.id, 'imp_wb');
  for (const item of pkg.resources.events) mapId(item.id, 'imp_ev');

  const worldBooks = uniqueById(pkg.resources.worldBooks).map((book) => ({
    ...clone(book),
    id: mapId(book.id, 'imp_wb')!,
    entries: (book.entries ?? []).map((entry) => ({
      ...entry,
      id: genId('imp_wbe'),
      keywords: [...(entry.keywords ?? [])],
    })),
  }));

  const outlines = uniqueById(pkg.resources.outlines).map((outline) => ({
    ...clone(outline),
    id: mapId(outline.id, 'imp_outline')!,
    acts: [...(outline.acts ?? [])],
    worldBookIds: (outline.worldBookIds ?? []).map((id) => idMap.get(id) ?? id),
  }));

  const backgrounds = uniqueById(pkg.resources.backgrounds).map((background) => ({
    ...clone(background),
    id: mapId(background.id, 'imp_bg')!,
    traits: [...(background.traits ?? [])],
    startItems: [...(background.startItems ?? [])],
  }));

  const events = uniqueById(pkg.resources.events).map((event) => ({
    ...clone(event),
    id: mapId(event.id, 'imp_ev')!,
    arc: event.arc
      ? {
        ...clone(event.arc),
        id: mapId(event.arc.id, 'imp_ev') ?? event.arc.id,
      }
      : undefined,
  }));

  const save = clone(pkg.save);
  const now = Date.now();
  const originalName = save.name || '旅程';
  const remapArc = (arc: StoryArc): StoryArc => ({
    ...arc,
    id: idMap.get(arc.id) ?? arc.id,
  });
  const remapArcList = (arcs: StoryArc[] | undefined): StoryArc[] =>
    (arcs ?? []).map(remapArc);
  save.id = genId('save');
  save.name = originalName.endsWith('（导入）') ? originalName : `${originalName}（导入）`;
  save.createdAt = save.createdAt || now;
  save.updatedAt = now;
  save.content = {
    ...save.content,
    outlineId: idMap.get(save.content.outlineId ?? '') ?? save.content.outlineId,
    backgroundId: idMap.get(save.content.backgroundId ?? '') ?? save.content.backgroundId,
    worldBookIds: (save.content.worldBookIds ?? []).map((id) => idMap.get(id) ?? id),
    eventIds: (save.content.eventIds ?? []).map((id) => idMap.get(id) ?? id),
    authorRandomEvent: save.content.authorRandomEvent
      ? {
        ...save.content.authorRandomEvent,
        poolEventIds: (save.content.authorRandomEvent.poolEventIds ?? []).map((id) => idMap.get(id) ?? id),
        dynamic: {
          ...save.content.authorRandomEvent.dynamic,
          referenceEventIds: (save.content.authorRandomEvent.dynamic?.referenceEventIds ?? []).map((id) => idMap.get(id) ?? id),
        },
      }
      : undefined,
    storyStyle: save.content.storyStyle ?? pkg.storyStyle,
  };
  save.state = {
    ...save.state,
    triggeredEvents: (save.state.triggeredEvents ?? []).map((item) => ({
      ...item,
      id: idMap.get(item.id) ?? item.id,
    })),
    authorNarrative: save.state.authorNarrative
      ? {
        ...save.state.authorNarrative,
        activeArcs: remapArcList(save.state.authorNarrative.activeArcs),
        completedArcs: remapArcList(save.state.authorNarrative.completedArcs),
      }
      : save.state.authorNarrative,
    authorRandomEventState: save.state.authorRandomEventState
      ? {
        ...save.state.authorRandomEventState,
        pendingEvent: save.state.authorRandomEventState.pendingEvent
          ? remapArc(save.state.authorRandomEventState.pendingEvent)
          : undefined,
        activeEvents: remapArcList(save.state.authorRandomEventState.activeEvents),
        completedEvents: remapArcList(save.state.authorRandomEventState.completedEvents),
      }
      : save.state.authorRandomEventState,
  };

  return {
    save,
    resources: {
      outlines,
      backgrounds,
      worldBooks,
      events,
    },
  };
}
