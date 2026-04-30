import type { AppSettings } from '@/types/settings';
import type { Background, StoryOutline, WorldBookEntry } from '@/types/content';
import type { Choice, Item, MemoryAnchor, Message, Npc, NpcUpdateRaw, SceneRef } from '@/types/game';
import type { RawDestroy, RawGrant, RawItemPatch } from '@/lib/items';
import { formatItemsForPrompt } from '@/lib/items';
import { chatJSON } from './llmClient';
import { MEMORY_SYSTEM, buildMemoryUser } from '@/prompts/memorySystem';

export interface MemoryDecisionSnapshot {
  choices?: Choice[];
  grants?: RawGrant[];
  destroys?: RawDestroy[];
  itemPatches?: RawItemPatch[];
  npcs?: NpcUpdateRaw[];
  currentScene?: SceneRef;
  availableScenes?: SceneRef[];
}

export interface MemoryUpdateRequest {
  settings: AppSettings;
  previousMemory?: string;
  recent: Message[];
  decision: MemoryDecisionSnapshot;
  npcs: Npc[];
  backpack: Item[];
  currentScene?: SceneRef;
  anchors?: MemoryAnchor[];
  outline?: StoryOutline;
  background?: Background;
  worldBookEntries?: WorldBookEntry[];
  maxChars: number;
  signal?: AbortSignal;
}

const MAX_RECENT_CHARS = 6000;

function clampMaxChars(n: number): number {
  if (!Number.isFinite(n)) return 4000;
  return Math.max(800, Math.min(12000, Math.floor(n)));
}

function clip(text: string, max: number): string {
  const trimmed = text.trim();
  return trimmed.length > max ? trimmed.slice(0, max).trim() : trimmed;
}

function formatRecent(msgs: Message[]): string {
  return clip(
    (msgs ?? [])
      .map((m) => {
        const tag = m.role === 'assistant' ? `故事 · 第 ${m.round} 回合` : `玩家 · 第 ${m.round} 回合`;
        return `【${tag}】\n${m.content}`;
      })
      .join('\n\n'),
    MAX_RECENT_CHARS,
  );
}

function formatNpcs(npcs: Npc[]): string {
  if (!npcs?.length) return '（无）';
  return npcs
    .slice(0, 30)
    .map((n) => {
      const details = n.details?.length ? `；细节：${n.details.join('、')}` : '';
      const role = n.role ? `｜${n.role}` : '';
      const desc = n.description ? `｜${n.description}` : '';
      const note = n.recentNote ? `｜最近：${n.recentNote}` : '';
      return `- ${n.name}${role}｜好感 ${n.affinity}${desc}${details}${note}`;
    })
    .join('\n');
}

function formatScene(scene?: SceneRef): string {
  if (!scene?.name) return '';
  return [
    `场景：${scene.name}`,
    scene.description ? `描述：${scene.description}` : '',
    scene.time ? `时间：${scene.time}` : '',
    scene.weather ? `天气：${scene.weather}` : '',
  ].filter(Boolean).join('\n');
}

function formatDecision(d: MemoryDecisionSnapshot): string {
  return JSON.stringify({
    choices: d.choices ?? [],
    grants: d.grants ?? [],
    destroys: d.destroys ?? [],
    itemPatches: d.itemPatches ?? [],
    npcs: d.npcs ?? [],
    currentScene: d.currentScene,
    availableScenes: d.availableScenes ?? [],
  }, null, 2);
}

function formatAnchors(anchors: MemoryAnchor[] | undefined): string {
  if (!anchors?.length) return '';
  const lines: string[] = [];
  for (const a of anchors.slice(-12)) {
    const note = a.note ? `【${a.note}】` : '';
    const content = (a.content?.trim() || a.excerpt?.trim() || '').trim();
    if (!content) continue;
    lines.push(`· 第 ${a.round} 回合${note}：${content}`);
  }
  return lines.join('\n');
}

function formatOutlineForMemory(outline: StoryOutline | undefined): string {
  if (!outline) return '';
  const lines = [`标题：${outline.title}`, `梗概：${outline.synopsis}`];
  if (outline.acts?.length) lines.push(`阶段：${outline.acts.map((a) => a.split(/[：:【】]/)[0]?.trim() || '').filter(Boolean).join(' / ')}`);
  return lines.join('\n');
}

function formatAlwaysActiveWorldBook(entries: WorldBookEntry[] | undefined): string {
  const always = (entries ?? []).filter((e) => e.alwaysActive);
  if (!always.length) return '';
  const lines: string[] = [];
  for (const e of always.slice(0, 6)) {
    const content = e.content.length > 200 ? `${e.content.slice(0, 200)}…` : e.content;
    lines.push(`· ${e.name}：${content}`);
  }
  return lines.join('\n');
}

export async function requestMemoryUpdate(p: MemoryUpdateRequest): Promise<string | null> {
  const maxChars = clampMaxChars(p.maxChars);
  const model = p.settings.memoryModel?.trim() || p.settings.summaryModel?.trim() || p.settings.storyModel;
  try {
    const text = await chatJSON(
      { baseUrl: p.settings.apiBaseUrl, apiKey: p.settings.apiKey, format: p.settings.apiFormat },
      {
        model,
        temperature: 0.25,
        messages: [
          { role: 'system', content: MEMORY_SYSTEM },
          {
            role: 'user',
            content: buildMemoryUser({
              previousMemory: clip(p.previousMemory ?? '', maxChars),
              recentText: formatRecent(p.recent),
              decisionText: formatDecision(p.decision),
              npcText: formatNpcs(p.npcs),
              backpackText: formatItemsForPrompt(p.backpack ?? []),
              currentSceneText: formatScene(p.currentScene),
              anchorsText: formatAnchors(p.anchors),
              outlineText: formatOutlineForMemory(p.outline),
              worldBookText: formatAlwaysActiveWorldBook(p.worldBookEntries),
              maxChars,
            }),
          },
        ],
        signal: p.signal,
      },
    );
    const out = text.trim();
    if (!out) return null;
    return clip(out, maxChars);
  } catch (err) {
    console.warn('[memoryAgent] update failed', err);
    return null;
  }
}
