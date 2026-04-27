// 故事 Agent：负责拼装 prompt 并流式请求故事模型

import type { Message, Item, Npc, MemoryAnchor, SceneRef } from '@/types/game';
import type { StoryOutline, Background, WorldBookEntry, RandomEvent } from '@/types/content';
import type { AppSettings } from '@/types/settings';
import { chatStreamDetailed, type ChatMessage } from './llmClient';
import { buildStorySystem } from '@/prompts/storySystem';

export interface StoryRequest {
  settings: AppSettings;
  outline?: StoryOutline;
  background?: Background;
  characterName?: string;
  activeWorldBookEntries: WorldBookEntry[];
  summary?: string;
  history: Message[];
  currentRound: number;
  totalRounds: number;
  triggeredEvent?: RandomEvent;
  playerInput?: string;
  backpack?: Item[];
  usedItems?: Item[];
  npcs?: Npc[];
  anchors?: MemoryAnchor[];
  currentScene?: SceneRef;
  summarizedUntilIndex?: number;
  finalizeRequested?: boolean;
  onDelta: (text: string) => void;
  signal?: AbortSignal;
}

const MAX_CONTEXT_MESSAGES = 40;
const MAX_AUTO_CONTINUES = 2;

export async function requestStory(p: StoryRequest): Promise<string> {
  const systemPrompt = buildStorySystem({
    outline: p.outline,
    background: p.background,
    characterName: p.characterName,
    activeWorldBookEntries: p.activeWorldBookEntries,
    summary: p.summary,
    currentRound: p.currentRound,
    totalRounds: p.totalRounds,
    triggeredEvent: p.triggeredEvent,
    backpack: p.backpack,
    usedItems: p.usedItems,
    npcs: p.npcs,
    anchors: p.anchors,
    currentScene: p.currentScene,
    finalizeRequested: p.finalizeRequested,
    lengthHint: p.settings.storyLength,
    styleAddendum: p.settings.storyStyleAddendum,
  });

  // 以 summarizedUntilIndex 为起点，从 history 中切出未被摘要的部分（再做一层 MAX_CONTEXT_MESSAGES 兜底）
  const startIdx = Math.max(
    p.summarizedUntilIndex ?? 0,
    p.history.length - MAX_CONTEXT_MESSAGES,
  );
  const trimmed = p.history.slice(startIdx);

  const messages: ChatMessage[] = [
    { role: 'system', content: systemPrompt },
    ...trimmed.map((m) => ({ role: m.role, content: m.content }) as ChatMessage),
  ];

  let userMessage = p.playerInput?.trim() || '';
  if (p.usedItems && p.usedItems.length) {
    const list = p.usedItems.map((it) => `「${it.name}」`).join('、');
    userMessage = userMessage
      ? `${userMessage}\n（本回合使用道具：${list}）`
      : `（本回合使用道具：${list}；请继续推进剧情。）`;
  }

  if (userMessage) {
    messages.push({ role: 'user', content: userMessage });
  } else if (p.currentRound === 0) {
    messages.push({ role: 'user', content: '（故事开始。请开启第一回合。）' });
  } else {
    messages.push({ role: 'user', content: '（请推进剧情。）' });
  }

  const maxTokens =
    Number.isFinite(p.settings.storyMaxTokens) && p.settings.storyMaxTokens > 0
      ? Math.floor(p.settings.storyMaxTokens)
      : undefined;

  let full = '';
  let requestMessages = messages;
  let continueCount = 0;

  while (true) {
    const result = await chatStreamDetailed(
      { baseUrl: p.settings.apiBaseUrl, apiKey: p.settings.apiKey, format: p.settings.apiFormat },
      {
        messages: requestMessages,
        model: p.settings.storyModel,
        temperature: p.settings.temperatureStory,
        maxTokens,
        onDelta: p.onDelta,
        signal: p.signal,
      },
    );
    full += result.text;

    if (result.finishReason !== 'length' || continueCount >= MAX_AUTO_CONTINUES) break;

    continueCount++;
    requestMessages = [
      ...messages,
      { role: 'assistant', content: full },
      {
        role: 'user',
        content: '（上一段因输出长度限制被截断。请从中断处无缝续写本回合，只补足未完成的叙事；不要重述开头，不要重新列选项。）',
      },
    ];
  }

  return full.trim();
}
