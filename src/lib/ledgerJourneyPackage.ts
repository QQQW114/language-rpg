import { strToU8, unzipSync, zipSync } from 'fflate';
import type { Background, ImportBundle, RandomEvent, StoryOutline, WorldBook } from '@/types/content';
import type { GameSave } from '@/types/game';
import type { LedgerExportPackage } from '@/types/ledger';
import { LEDGER_SCHEMA_VERSION } from '@/types/ledger';
import { buildLedgerExportPackage, persistRuntimeSave } from '@/storage/ledgerRepository';

export const LEDGER_PACKAGE_KIND = 'language-rpg.ledger-zip';

export interface LedgerZipManifest {
  kind: typeof LEDGER_PACKAGE_KIND;
  schemaVersion: typeof LEDGER_SCHEMA_VERSION;
  exportedAt: number;
  app: { name: 'language-rpg' };
}

export interface LedgerZipResources {
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

function jsonFile(value: unknown): Uint8Array {
  return strToU8(JSON.stringify(value, null, 2));
}

function readJson<T>(files: Record<string, Uint8Array>, path: string): T {
  const data = files[path];
  if (!data) throw new Error(`旅程包缺少 ${path}`);
  return JSON.parse(new TextDecoder().decode(data)) as T;
}

function pickResources(p: {
  save: GameSave;
  outlines: StoryOutline[];
  backgrounds: Background[];
  worldBooks: WorldBook[];
  events: RandomEvent[];
}): LedgerZipResources {
  const outline = p.outlines.find((item) => item.id === p.save.content.outlineId);
  const background = p.backgrounds.find((item) => item.id === p.save.content.backgroundId);
  const worldBookIds = new Set(p.save.content.worldBookIds ?? []);
  const eventIds = new Set(p.save.content.eventIds ?? []);
  return {
    resources: {
      outlines: outline ? [clone(outline)] : [],
      backgrounds: background ? [clone(background)] : [],
      worldBooks: uniqueById(p.worldBooks.filter((item) => worldBookIds.has(item.id))).map(clone),
      events: uniqueById(p.events.filter((item) => eventIds.has(item.id))).map(clone),
    },
  };
}

export async function buildLedgerJourneyZip(p: {
  save: GameSave;
  outlines: StoryOutline[];
  backgrounds: Background[];
  worldBooks: WorldBook[];
  events: RandomEvent[];
}): Promise<Uint8Array> {
  const exportedAt = Date.now();
  await persistRuntimeSave(p.save);
  const ledger = await buildLedgerExportPackage(p.save);
  const resources = pickResources(p);
  const manifest: LedgerZipManifest = {
    kind: LEDGER_PACKAGE_KIND,
    schemaVersion: LEDGER_SCHEMA_VERSION,
    exportedAt,
    app: { name: 'language-rpg' },
  };

  const files: Record<string, Uint8Array> = {
    'manifest.json': jsonFile(manifest),
    'save.json': jsonFile(ledger.save),
    'resources.json': jsonFile(resources),
    'workspace.json': jsonFile({ workspaceDocs: ledger.workspaceDocs ?? [] }),
  };

  for (const round of ledger.rounds) {
    files[`rounds/${String(round.round).padStart(6, '0')}.json`] = jsonFile(round);
  }
  for (const call of ledger.agentCalls) {
    files[`calls/${String(call.round).padStart(6, '0')}_${call.kind}_${call.id}.json`] = jsonFile(call);
  }
  for (const snapshot of ledger.snapshots) {
    files[`snapshots/${String(snapshot.round).padStart(6, '0')}_${snapshot.label}_${snapshot.id}.json`] = jsonFile(snapshot);
  }

  return zipSync(files, { level: 6 });
}

export function parseLedgerJourneyZip(buffer: ArrayBuffer): LedgerExportPackage & LedgerZipResources {
  const files = unzipSync(new Uint8Array(buffer));
  const manifest = readJson<LedgerZipManifest>(files, 'manifest.json');
  if (manifest.kind !== LEDGER_PACKAGE_KIND || manifest.schemaVersion !== LEDGER_SCHEMA_VERSION) {
    throw new Error('不是受支持的言灵旅程卷宗包。');
  }

  const save = readJson<LedgerExportPackage['save']>(files, 'save.json');
  const resources = readJson<LedgerZipResources>(files, 'resources.json');
  const workspace = files['workspace.json']
    ? readJson<Pick<LedgerExportPackage, 'workspaceDocs'>>(files, 'workspace.json')
    : { workspaceDocs: [] };
  const rounds = Object.keys(files)
    .filter((path) => path.startsWith('rounds/') && path.endsWith('.json'))
    .sort()
    .map((path) => readJson<LedgerExportPackage['rounds'][number]>(files, path));
  const agentCalls = Object.keys(files)
    .filter((path) => path.startsWith('calls/') && path.endsWith('.json'))
    .sort()
    .map((path) => readJson<LedgerExportPackage['agentCalls'][number]>(files, path));
  const snapshots = Object.keys(files)
    .filter((path) => path.startsWith('snapshots/') && path.endsWith('.json'))
    .sort()
    .map((path) => readJson<LedgerExportPackage['snapshots'][number]>(files, path));

  return {
    kind: 'language-rpg.ledger-package',
    schemaVersion: LEDGER_SCHEMA_VERSION,
    exportedAt: manifest.exportedAt,
    save,
    rounds,
    agentCalls,
    snapshots,
    workspaceDocs: workspace.workspaceDocs ?? [],
    resources: resources.resources,
  };
}
