// 决策 Agent：根据最新故事片段 + 最近上下文 + 背包 + NPC + 当前场景，请求选项 / grants / destroys / npcs / scenes

import type { AppSettings } from '@/types/settings';
import type { StrictCustomConfig } from '@/types/custom';
import type { Choice, Item, ItemType, Message, Npc, NpcUpdateRaw, SceneRef } from '@/types/game';
import { chatJSON } from './llmClient';
import { buildDecisionUser } from '@/prompts/decisionSystem';
import { extractJSON, genId, clamp } from '@/lib/utils';
import { formatItemsForPrompt } from '@/lib/items';
import {
  buildStrictCustomDecisionBlock,
  getDecisionSystemTemplate,
  getDecisionUserTemplate,
  renderPromptTemplate,
} from '@/lib/strictCustom';
import type { RawGrant, RawDestroy } from '@/lib/items';

export interface DecisionRequest {
  settings: AppSettings;
  latestStory: string;
  backpack: Item[];
  npcs: Npc[];
  summary?: string;
  recent?: Message[];
  currentSceneName?: string;
  strictCustom?: StrictCustomConfig;
  signal?: AbortSignal;
}

export interface DecisionResult {
  choices: Choice[];
  grants: RawGrant[];
  destroys: RawDestroy[];
  npcs: NpcUpdateRaw[];
  currentScene?: SceneRef;
  availableScenes: SceneRef[];
}

const FALLBACK_CHOICES: Choice[] = [
  { id: 'a', label: '谨慎地观察四周，寻找更多线索', hint: '稳妥' },
  { id: 'b', label: '果断采取行动，夺取主动权', hint: '冒险' },
  { id: 'c', label: '试探性地与在场的人物交谈', hint: '社交' },
];

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
    const name = String((item as { name?: unknown }).name ?? '').trim();
    if (!name) continue;
    const reason = String((item as { reason?: unknown }).reason ?? '').trim();
    out.push({ name: name.slice(0, 30), reason: reason.slice(0, 80) });
  }
  return out;
}

function sanitizeNpcs(raw: unknown): NpcUpdateRaw[] {
  if (!raw || typeof raw !== 'object') return [];
  const arr = (raw as { npcs?: unknown }).npcs;
  if (!Array.isArray(arr)) return [];
  const out: NpcUpdateRaw[] = [];
  for (const item of arr.slice(0, 6)) {
    if (!item || typeof item !== 'object') continue;
    const name = String((item as any).name ?? '').trim();
    if (!name) continue;
    const role = String((item as any).role ?? '').trim().slice(0, 30);
    const description = String((item as any).description ?? '').trim().slice(0, 120);
    const deltaNum = Number((item as any).affinityDelta ?? 0);
    const affinityDelta = Number.isFinite(deltaNum) ? clamp(Math.round(deltaNum), -30, 30) : 0;
    const note = String((item as any).note ?? '').trim().slice(0, 60);
    out.push({
      name: name.slice(0, 16),
      role: role || undefined,
      description: description || undefined,
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
      currentScene = { name, description: description || undefined };
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
      return `- ${n.name}${roleTag}  好感 ${aff}`;
    })
    .join('\n');
}

const RECENT_MESSAGES = 6;

export async function requestChoices(p: DecisionRequest): Promise<DecisionResult> {
  const { settings, latestStory, backpack, npcs, summary, recent, currentSceneName, signal } = p;
  const backpackSummary = formatItemsForPrompt(backpack);
  const npcSummary = formatNpcs(npcs);
  const strictCustomDecisionBlock = buildStrictCustomDecisionBlock(p.strictCustom);
  const decisionSystemPrompt = renderPromptTemplate(getDecisionSystemTemplate(p.strictCustom), {});

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
  const currentSceneBlock = currentSceneName
    ? `【上一回合所在场景】${currentSceneName}`
    : '';
  const defaultDecisionUserPrompt = buildDecisionUser({
    latestStory,
    backpackSummary,
    summary,
    recentText,
    npcSummary,
    currentSceneName,
    strictCustomDecisionBlock,
  });
  const decisionUserPrompt = renderPromptTemplate(getDecisionUserTemplate(p.strictCustom), {
    latestStory,
    backpackSummary,
    summaryBlock,
    recentTextBlock,
    npcBlock,
    currentSceneBlock,
    strictCustomDecisionBlock,
    defaultDecisionUserPrompt,
  }) || defaultDecisionUserPrompt;

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
    const choices = sanitizeChoices(obj);
    if (!choices) return null;
    const scenes = sanitizeScenes(obj);
    return {
      choices,
      grants: sanitizeGrants(obj),
      destroys: sanitizeDestroys(obj),
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
    choices: FALLBACK_CHOICES.map((c) => ({ ...c, id: genId('c').slice(-3) })),
    grants: [],
    destroys: [],
    npcs: [],
    availableScenes: [],
  };
}
