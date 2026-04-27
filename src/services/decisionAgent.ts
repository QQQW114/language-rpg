// 决策 Agent：根据最新故事片段 + 最近上下文 + 背包 + NPC + 当前场景，请求选项 / grants / destroys / npcs / scenes

import type { AppSettings } from '@/types/settings';
import type { StrictCustomConfig } from '@/types/custom';
import type { Choice, Item, ItemType, Message, Npc, NpcUpdateRaw, SceneRef } from '@/types/game';
import { chatJSON } from './llmClient';
import { DECISION_TRACKING_SYSTEM, buildDecisionTrackingUser, buildDecisionUser } from '@/prompts/decisionSystem';
import { extractJSON, genId, clamp } from '@/lib/utils';
import { formatItemsForPrompt } from '@/lib/items';
import {
  buildStrictCustomDecisionBlock,
  getDecisionSystemTemplate,
  getDecisionUserTemplate,
  renderPromptTemplate,
} from '@/lib/strictCustom';
import type { RawGrant, RawDestroy, RawItemPatch } from '@/lib/items';

export interface DecisionRequest {
  settings: AppSettings;
  latestStory: string;
  backpack: Item[];
  npcs: Npc[];
  summary?: string;
  recent?: Message[];
  currentSceneName?: string;
  currentScene?: SceneRef;
  strictCustom?: StrictCustomConfig;
  includeChoices?: boolean;
  signal?: AbortSignal;
}

export interface DecisionResult {
  choices: Choice[];
  grants: RawGrant[];
  destroys: RawDestroy[];
  itemPatches: RawItemPatch[];
  npcs: NpcUpdateRaw[];
  currentScene?: SceneRef;
  availableScenes: SceneRef[];
}

const FALLBACK_CHOICES: Choice[] = [
  { id: 'a', label: '谨慎地观察四周，寻找更多线索', hint: '稳妥' },
  { id: 'b', label: '果断采取行动，夺取主动权', hint: '冒险' },
  { id: 'c', label: '试探性地与在场的人物交谈', hint: '社交' },
];

function cleanId(value: unknown, max = 80): string | undefined {
  const id = String(value ?? '').trim().slice(0, max);
  return id || undefined;
}

function sanitizeChoices(raw: unknown): Choice[] | null {
  if (!raw || typeof raw !== 'object') return null;
  const arr = (raw as { choices?: unknown }).choices;
  if (!Array.isArray(arr)) return null;
  const out: Choice[] = [];
  for (let i = 0; i < arr.length && out.length < 4; i++) {
    const item = arr[i];
    if (!item || typeof item !== 'object') continue;
    const label = String((item as { label?: unknown }).label ?? '').trim();
    if (!label) continue;
    const hint = (item as { hint?: unknown }).hint;
    out.push({
      id: String((item as { id?: unknown }).id || String.fromCharCode(97 + i)),
      label: label.slice(0, 60),
      hint: typeof hint === 'string' && hint ? hint.slice(0, 16) : undefined,
    });
  }
  return out.length >= 2 ? out : null;
}

function sanitizeGrants(raw: unknown): RawGrant[] {
  if (!raw || typeof raw !== 'object') return [];
  const arr = (raw as { grants?: unknown }).grants;
  if (!Array.isArray(arr)) return [];
  const out: RawGrant[] = [];
  for (const item of arr.slice(0, 6)) {
    if (!item || typeof item !== 'object') continue;
    const name = String((item as { name?: unknown }).name ?? '').trim();
    if (!name) continue;
    const description = String((item as { description?: unknown }).description ?? '').trim();
    const rawType = String((item as { type?: unknown }).type ?? '').trim().toLowerCase();
    const type: ItemType | undefined =
      rawType === 'consumable' ? 'consumable' : rawType === 'reusable' ? 'reusable' : undefined;
    out.push({ name: name.slice(0, 20), description: description.slice(0, 160), type });
  }
  return out;
}

function sanitizeDestroys(raw: unknown): RawDestroy[] {
  if (!raw || typeof raw !== 'object') return [];
  const arr = (raw as { destroys?: unknown }).destroys;
  if (!Array.isArray(arr)) return [];
  const out: RawDestroy[] = [];
  for (const item of arr.slice(0, 4)) {
    if (!item || typeof item !== 'object') continue;
    const id = cleanId((item as { id?: unknown }).id);
    const name = String((item as { name?: unknown }).name ?? '').trim();
    if (!name && !id) continue;
    const reason = String((item as { reason?: unknown }).reason ?? '').trim();
    out.push({ id, name: name.slice(0, 30), reason: reason.slice(0, 80) });
  }
  return out;
}

function sanitizeItemPatches(raw: unknown): RawItemPatch[] {
  if (!raw || typeof raw !== 'object') return [];
  const arr = (raw as { itemPatches?: unknown }).itemPatches;
  if (!Array.isArray(arr)) return [];
  const out: RawItemPatch[] = [];
  for (const item of arr.slice(0, 6)) {
    if (!item || typeof item !== 'object') continue;
    const obj = item as Record<string, unknown>;
    const rawAction = String(obj.action ?? '').trim().toLowerCase();
    const action: RawItemPatch['action'] =
      rawAction === 'delete' || rawAction === 'remove' || rawAction === 'destroy' ? 'delete' : 'update';
    const id = cleanId(obj.id);
    const name = String(obj.name ?? '').trim().slice(0, 30);
    if (!id && !name) continue;
    const description = String(obj.description ?? '').trim().slice(0, 160);
    const rawType = String(obj.type ?? '').trim().toLowerCase();
    const type: ItemType | undefined =
      rawType === 'consumable' ? 'consumable' : rawType === 'reusable' ? 'reusable' : undefined;
    const reason = String(obj.reason ?? '').trim().slice(0, 80);
    out.push({
      id,
      name: name || undefined,
      action,
      description: description || undefined,
      type,
      reason: reason || undefined,
    });
  }
  return out;
}

function sanitizeNpcs(raw: unknown): NpcUpdateRaw[] {
  if (!raw || typeof raw !== 'object') return [];
  const arr = (raw as { npcs?: unknown }).npcs;
  if (!Array.isArray(arr)) return [];
  const out: NpcUpdateRaw[] = [];
  for (const item of arr.slice(0, 8)) {
    if (!item || typeof item !== 'object') continue;
    const obj = item as Record<string, unknown>;
    const id = cleanId(obj.id);
    const name = String(obj.name ?? '').trim();
    if (!name && !id) continue;
    const rawAction = String(obj.action ?? '').trim().toLowerCase();
    const action: NpcUpdateRaw['action'] =
      rawAction === 'delete' || rawAction === 'remove'
        ? 'delete'
        : rawAction === 'update'
          ? 'update'
          : 'upsert';
    const role = String(obj.role ?? '').trim().slice(0, 30);
    const description = String(obj.description ?? '').trim().slice(0, 160);
    const affinityNum = Number(obj.affinity);
    const affinity = Number.isFinite(affinityNum) ? clamp(Math.round(affinityNum), -100, 100) : undefined;
    const deltaNum = Number(obj.affinityDelta ?? 0);
    const affinityDelta = Number.isFinite(deltaNum) ? clamp(Math.round(deltaNum), -30, 30) : 0;
    const note = String(obj.note ?? '').trim().slice(0, 80);
    out.push({
      id,
      name: name ? name.slice(0, 20) : undefined,
      action,
      role: role || undefined,
      description: description || undefined,
      affinity,
      affinityDelta,
      note: note || undefined,
    });
  }
  return out;
}

function sanitizeScenes(raw: unknown): { currentScene?: SceneRef; availableScenes: SceneRef[] } {
  const obj = (raw ?? {}) as any;
  let currentScene: SceneRef | undefined;
  const cur = obj.currentScene;
  if (cur && typeof cur === 'object') {
    const name = String(cur.name ?? '').trim().slice(0, 20);
    if (name) {
      const description = String(cur.description ?? '').trim().slice(0, 60);
      const time = String(cur.time ?? cur.timeOfDay ?? obj.time ?? '').trim().slice(0, 20);
      const weather = String(cur.weather ?? obj.weather ?? '').trim().slice(0, 30);
      currentScene = {
        name,
        description: description || undefined,
        time: time || undefined,
        weather: weather || undefined,
      };
    }
  }
  const arr = Array.isArray(obj.availableScenes) ? obj.availableScenes : [];
  const availableScenes: SceneRef[] = [];
  for (const item of arr.slice(0, 6)) {
    if (!item || typeof item !== 'object') continue;
    const name = String(item.name ?? '').trim().slice(0, 20);
    if (!name) continue;
    if (currentScene && name === currentScene.name) continue;
    const description = String(item.description ?? '').trim().slice(0, 60);
    availableScenes.push({ name, description: description || undefined });
  }
  return { currentScene, availableScenes };
}

function formatSceneContext(scene?: SceneRef, fallbackName?: string): string {
  const name = scene?.name?.trim() || fallbackName?.trim();
  if (!name) return '';
  const lines = [`场景：${name}`];
  if (scene?.description?.trim()) lines.push(`描述：${scene.description.trim()}`);
  if (scene?.time?.trim()) lines.push(`时间：${scene.time.trim()}`);
  if (scene?.weather?.trim()) lines.push(`天气：${scene.weather.trim()}`);
  return lines.join('\n');
}

function formatRecent(msgs: Message[]): string {
  if (!msgs?.length) return '';
  return msgs
    .map((m) => {
      const tag = m.role === 'assistant' ? `故事-第${m.round + 1}回合` : '玩家';
      return `【${tag}】\n${m.content}`;
    })
    .join('\n\n');
}

function formatNpcs(npcs: Npc[]): string {
  if (!npcs?.length) return '（尚无已知 NPC）';
  return npcs
    .slice(0, 12)
    .map((n) => {
      const aff = n.affinity > 0 ? `+${n.affinity}` : String(n.affinity);
      const roleTag = n.role ? `（${n.role}）` : '';
      return `- ${n.name}${roleTag}  好感 ${aff}  id:${n.id}`;
    })
    .join('\n');
}

function formatBackpackJson(items: Item[]): string {
  const rows = (items ?? []).slice(0, 30).map((it) => ({
    id: it.id,
    name: it.name,
    description: it.description,
    type: it.type,
    pendingGrant: !!it.pendingGrantKey,
    pendingDestroy: !!it.pendingDestroy,
    destroyReason: it.destroyReason,
  }));
  return JSON.stringify(rows, null, 2);
}

function formatNpcJson(npcs: Npc[]): string {
  const rows = (npcs ?? []).slice(0, 30).map((n) => ({
    id: n.id,
    name: n.name,
    role: n.role,
    description: n.description,
    affinity: n.affinity,
    firstRound: n.firstRound,
    lastRound: n.lastRound,
    appearances: n.appearances,
    recentNote: n.recentNote,
  }));
  return JSON.stringify(rows, null, 2);
}

function appendMachineStateIfMissing(
  text: string,
  backpackJsonBlock: string,
  npcJsonBlock: string,
): string {
  const additions: string[] = [];
  if (backpackJsonBlock && !text.includes('【当前背包 JSON】')) additions.push(backpackJsonBlock);
  if (npcJsonBlock && !text.includes('【当前已知 NPC JSON】')) additions.push(npcJsonBlock);
  if (!additions.length) return text;
  return [text, ...additions].filter((x) => x.trim()).join('\n\n');
}

const RECENT_MESSAGES = 6;

export async function requestChoices(p: DecisionRequest): Promise<DecisionResult> {
  const { settings, latestStory, backpack, npcs, summary, recent, currentSceneName, currentScene, signal } = p;
  const includeChoices = p.includeChoices ?? true;
  const backpackSummary = formatItemsForPrompt(backpack);
  const npcSummary = formatNpcs(npcs);
  const backpackJsonBlock = ['【当前背包 JSON】', formatBackpackJson(backpack)].join('\n');
  const npcJsonBlock = ['【当前已知 NPC JSON】', formatNpcJson(npcs)].join('\n');
  const currentSceneContextText = formatSceneContext(currentScene, currentSceneName);
  const strictCustomDecisionBlock = includeChoices ? buildStrictCustomDecisionBlock(p.strictCustom) : '';
  const decisionSystemPrompt = includeChoices
    ? renderPromptTemplate(getDecisionSystemTemplate(p.strictCustom), {})
    : renderPromptTemplate(DECISION_TRACKING_SYSTEM, {});

  const msgs = recent ?? [];
  const lastA = [...msgs].reverse().find((m) => m.role === 'assistant');
  const trimmed = lastA?.content === latestStory
    ? msgs.slice(0, msgs.length - 1).slice(-RECENT_MESSAGES)
    : msgs.slice(-RECENT_MESSAGES);
  const recentText = formatRecent(trimmed);
  const summaryBlock = summary?.trim()
    ? ['【历史摘要】', summary.trim()].join('\n')
    : '';
  const recentTextBlock = recentText.trim()
    ? ['【最近若干回合】', recentText.trim()].join('\n')
    : '';
  const npcBlock = npcSummary.trim()
    ? ['【当前已知 NPC】', npcSummary.trim()].join('\n')
    : '';
  const currentSceneBlock = currentSceneContextText
    ? ['【上一回合所在场景】', currentSceneContextText].join('\n')
    : '';
  const defaultDecisionUserPrompt = includeChoices ? buildDecisionUser({
    latestStory,
    backpackSummary,
    backpackJsonBlock,
    summary,
    recentText,
    npcSummary,
    npcJsonBlock,
    currentSceneName,
    currentSceneContext: currentSceneContextText,
    strictCustomDecisionBlock,
  }) : buildDecisionTrackingUser({
    latestStory,
    backpackSummary,
    backpackJsonBlock,
    summary,
    recentText,
    npcSummary,
    npcJsonBlock,
    currentSceneName,
    currentSceneContext: currentSceneContextText,
  });
  const renderedDecisionUserPrompt = includeChoices
    ? renderPromptTemplate(getDecisionUserTemplate(p.strictCustom), {
      latestStory,
      backpackSummary,
      backpackJsonBlock,
      summaryBlock,
      recentTextBlock,
      npcBlock,
      npcJsonBlock,
      currentSceneBlock,
      strictCustomDecisionBlock,
      defaultDecisionUserPrompt,
    }) || defaultDecisionUserPrompt
    : defaultDecisionUserPrompt;
  const decisionUserPrompt = appendMachineStateIfMissing(
    renderedDecisionUserPrompt,
    backpackJsonBlock,
    npcJsonBlock,
  );

  const runOnce = async (temperature: number): Promise<DecisionResult | null> => {
    const text = await chatJSON(
      { baseUrl: settings.apiBaseUrl, apiKey: settings.apiKey, format: settings.apiFormat },
      {
        model: settings.decisionModel,
        temperature,
        messages: [
          { role: 'system', content: decisionSystemPrompt },
          { role: 'user', content: decisionUserPrompt },
        ],
        signal,
      },
    );
    const obj = extractJSON(text);
    if (!obj) return null;
    const choices = includeChoices ? sanitizeChoices(obj) : [];
    if (includeChoices && !choices) return null;
    const scenes = sanitizeScenes(obj);
    return {
      choices: choices ?? [],
      grants: sanitizeGrants(obj),
      destroys: sanitizeDestroys(obj),
      itemPatches: sanitizeItemPatches(obj),
      npcs: sanitizeNpcs(obj),
      currentScene: scenes.currentScene,
      availableScenes: scenes.availableScenes,
    };
  };

  try {
    const first = await runOnce(settings.temperatureDecision);
    if (first) return first;
  } catch (err) {
    console.warn('[decisionAgent] first attempt failed', err);
  }

  try {
    const retry = await runOnce(Math.max(0, (settings.temperatureDecision ?? 0.5) - 0.3));
    if (retry) return retry;
  } catch (err) {
    console.warn('[decisionAgent] retry failed', err);
  }

  return {
    choices: includeChoices
      ? FALLBACK_CHOICES.map((c) => ({ ...c, id: genId('c').slice(-3) }))
      : [],
    grants: [],
    destroys: [],
    itemPatches: [],
    npcs: [],
    availableScenes: [],
  };
}
