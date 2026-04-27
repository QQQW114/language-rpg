// 随机生成 · 服务：故事大纲 / 出身 / 开局场景

import type { AppSettings } from '@/types/settings';
import type { StoryOutline, Background, WorldBookEntry, RandomEvent, WorldBook } from '@/types/content';
import { chatJSON } from './llmClient';
import {
  RANDOM_OUTLINE_SYSTEM, buildRandomOutlineUser, type RandomOutlineHints,
  RANDOM_BACKGROUND_SYSTEM, buildRandomBackgroundUser,
  RANDOM_SCENE_SYSTEM, buildRandomSceneUser,
  RANDOM_EVENTS_SYSTEM, buildRandomEventsUser,
  RANDOM_WORLDBOOK_SYSTEM, buildRandomWorldBookUser,
  summarizeWorldEntries,
} from '@/prompts/randomizer';
import { extractJSON, genId, clamp } from '@/lib/utils';

function toStringArr(v: unknown, max = 5): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((x) => String(x ?? '').trim())
    .filter(Boolean)
    .slice(0, max);
}

function pickRandomModel(settings: AppSettings): string {
  return (
    settings.randomModel?.trim() ||
    settings.summaryModel?.trim() ||
    settings.storyModel
  );
}

// ---- 随机大纲 ----

function sanitizeOutline(obj: any): StoryOutline | null {
  if (!obj || typeof obj !== 'object') return null;
  const title = String(obj.title ?? '').trim().slice(0, 24);
  const synopsis = String(obj.synopsis ?? '').trim().slice(0, 400);
  const acts = toStringArr(obj.acts, 4).map((s) => s.slice(0, 120));
  const tone = String(obj.tone ?? '').trim().slice(0, 40) || undefined;
  const coverEmoji = String(obj.coverEmoji ?? '').trim().slice(0, 4) || '🎲';
  if (!title || !synopsis || acts.length < 2) return null;
  return {
    id: genId('gen_outline'),
    title,
    synopsis,
    acts,
    tone,
    coverEmoji,
  };
}

export async function requestRandomOutline(
  settings: AppSettings,
  hints: RandomOutlineHints = {},
  signal?: AbortSignal,
): Promise<StoryOutline> {
  const model = pickRandomModel(settings);
  const run = async (temperature: number) => {
    const text = await chatJSON(
      { baseUrl: settings.apiBaseUrl, apiKey: settings.apiKey, format: settings.apiFormat },
      {
        model,
        temperature,
        messages: [
          { role: 'system', content: RANDOM_OUTLINE_SYSTEM },
          { role: 'user', content: buildRandomOutlineUser(hints) },
        ],
        signal,
      },
    );
    return sanitizeOutline(extractJSON(text));
  };

  const first = await run(1.0);
  if (first) return first;
  const retry = await run(0.75);
  if (retry) return retry;
  throw new Error('随机大纲生成失败');
}

// ---- 随机出身 ----

function sanitizeBackground(obj: any): Background | null {
  if (!obj || typeof obj !== 'object') return null;
  const name = String(obj.name ?? '').trim().slice(0, 12);
  const description = String(obj.description ?? '').trim().slice(0, 220);
  const traits = toStringArr(obj.traits, 5);
  const startItems = toStringArr(obj.startItems, 6);
  const startScene = String(obj.startScene ?? '').trim().slice(0, 800);
  const coverEmoji = String(obj.coverEmoji ?? '').trim().slice(0, 4) || '🎲';
  if (!name || !description || !startScene) return null;
  return {
    id: genId('gen_bg'),
    name,
    description,
    traits,
    startItems,
    startScene,
    coverEmoji,
  };
}

export async function requestRandomBackground(
  settings: AppSettings,
  outline: StoryOutline,
  worldEntries?: WorldBookEntry[],
  hint?: string,
  signal?: AbortSignal,
): Promise<Background> {
  const model = pickRandomModel(settings);
  const worldSummary = summarizeWorldEntries(worldEntries ?? []);
  const run = async (temperature: number) => {
    const text = await chatJSON(
      { baseUrl: settings.apiBaseUrl, apiKey: settings.apiKey, format: settings.apiFormat },
      {
        model,
        temperature,
        messages: [
          { role: 'system', content: RANDOM_BACKGROUND_SYSTEM },
          { role: 'user', content: buildRandomBackgroundUser(outline, worldSummary, hint) },
        ],
        signal,
      },
    );
    return sanitizeBackground(extractJSON(text));
  };

  const first = await run(0.95);
  if (first) return first;
  const retry = await run(0.7);
  if (retry) return retry;
  throw new Error('随机出身生成失败');
}

// ---- 随机开局 ----

export async function requestRandomScene(
  settings: AppSettings,
  outline: StoryOutline,
  background: Background,
  hint?: string,
  signal?: AbortSignal,
): Promise<string> {
  const model = pickRandomModel(settings);
  const text = await chatJSON(
    { baseUrl: settings.apiBaseUrl, apiKey: settings.apiKey, format: settings.apiFormat },
    {
      model,
      temperature: 0.95,
      messages: [
        { role: 'system', content: RANDOM_SCENE_SYSTEM },
        { role: 'user', content: buildRandomSceneUser(outline, background, hint) },
      ],
      signal,
    },
  );
  const clean = (text || '').trim();
  if (!clean) throw new Error('随机开局生成失败');
  return clean;
}

// ---- 随机事件池 ----

function sanitizeEvents(obj: any): RandomEvent[] {
  if (!obj || typeof obj !== 'object') return [];
  const arr = (obj as { events?: unknown }).events;
  if (!Array.isArray(arr)) return [];
  const out: RandomEvent[] = [];
  for (const item of arr.slice(0, 10)) {
    if (!item || typeof item !== 'object') continue;
    const name = String((item as any).name ?? '').trim();
    const directive = String((item as any).directive ?? '').trim();
    if (!name || !directive) continue;
    const probRaw = Number((item as any).probability);
    const probability = Number.isFinite(probRaw) ? clamp(probRaw, 0.02, 0.3) : 0.1;
    const minRoundRaw = Number((item as any).minRound);
    const minRound = Number.isFinite(minRoundRaw) ? clamp(Math.floor(minRoundRaw), 1, 100) : undefined;
    const cooldownRaw = Number((item as any).cooldown);
    const cooldown = Number.isFinite(cooldownRaw) ? clamp(Math.floor(cooldownRaw), 0, 100) : undefined;
    const once = Boolean((item as any).once);
    out.push({
      id: genId('gen_ev'),
      name: name.slice(0, 20),
      directive: directive.slice(0, 260),
      probability,
      minRound,
      cooldown,
      once,
    });
  }
  return out;
}

export async function requestRandomEvents(
  settings: AppSettings,
  outline: StoryOutline,
  background?: Background,
  startScene?: string,
  hint?: string,
  count = 6,
  signal?: AbortSignal,
): Promise<RandomEvent[]> {
  const model = pickRandomModel(settings);
  const run = async (temperature: number) => {
    const text = await chatJSON(
      { baseUrl: settings.apiBaseUrl, apiKey: settings.apiKey, format: settings.apiFormat },
      {
        model,
        temperature,
        messages: [
          { role: 'system', content: RANDOM_EVENTS_SYSTEM },
          { role: 'user', content: buildRandomEventsUser({ outline, background, startScene, hint, count }) },
        ],
        signal,
      },
    );
    return sanitizeEvents(extractJSON(text));
  };

  const first = await run(0.95);
  if (first.length >= 3) return first;
  const retry = await run(0.7);
  if (retry.length >= 3) return retry;
  if (first.length) return first;
  if (retry.length) return retry;
  throw new Error('随机事件生成失败');
}

// ---- 随机世界书 ----

function sanitizeWorldBook(obj: any): WorldBook | null {
  if (!obj || typeof obj !== 'object') return null;
  const name = String(obj.name ?? '').trim().slice(0, 30);
  const description = String(obj.description ?? '').trim().slice(0, 120);
  if (!name) return null;
  const arr = Array.isArray(obj.entries) ? obj.entries : [];
  const entries: WorldBookEntry[] = [];
  for (const item of arr.slice(0, 12)) {
    if (!item || typeof item !== 'object') continue;
    const eName = String((item as any).name ?? '').trim().slice(0, 20);
    const content = String((item as any).content ?? '').trim().slice(0, 300);
    if (!eName || !content) continue;
    const keywords = Array.isArray((item as any).keywords)
      ? (item as any).keywords.map((k: unknown) => String(k ?? '').trim()).filter(Boolean).slice(0, 6)
      : [];
    const priorityRaw = Number((item as any).priority);
    const priority = Number.isFinite(priorityRaw) ? clamp(Math.round(priorityRaw), 0, 100) : undefined;
    const alwaysActive = Boolean((item as any).alwaysActive);
    entries.push({
      id: genId('gen_wbe'),
      name: eName,
      keywords,
      content,
      priority,
      alwaysActive,
    });
  }
  if (entries.length < 3) return null;
  return {
    id: genId('gen_wb'),
    name,
    description: description || undefined,
    entries,
  };
}

export async function requestRandomWorldBook(
  settings: AppSettings,
  outline?: StoryOutline,
  hint?: string,
  count = 7,
  signal?: AbortSignal,
): Promise<WorldBook> {
  const model = pickRandomModel(settings);
  const run = async (temperature: number) => {
    const text = await chatJSON(
      { baseUrl: settings.apiBaseUrl, apiKey: settings.apiKey, format: settings.apiFormat },
      {
        model,
        temperature,
        messages: [
          { role: 'system', content: RANDOM_WORLDBOOK_SYSTEM },
          { role: 'user', content: buildRandomWorldBookUser({ outline, hint, count }) },
        ],
        signal,
      },
    );
    return sanitizeWorldBook(extractJSON(text));
  };

  const first = await run(0.9);
  if (first) return first;
  const retry = await run(0.65);
  if (retry) return retry;
  throw new Error('随机世界书生成失败');
}
