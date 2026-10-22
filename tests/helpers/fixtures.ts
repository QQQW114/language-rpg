/** 测试夹具：大纲 / 出身 / 世界书 / GameStateV2 / TurnPatchV2 / AppSettings。 */

import { DEFAULT_SETTINGS, type AppSettings } from '@/types/settings';
import type { Background, StoryOutline, WorldBook } from '@/types/content';
import type { GameStateV2, TurnPatchV2 } from '@/v2/types';

export function makeOutline(overrides: Record<string, unknown> = {}): StoryOutline {
  return {
    id: 'outline-test-1',
    title: '测试故事',
    synopsis: '一个用于测试的简短故事。',
    tone: '冷静',
    worldBookIds: [],
    coverEmoji: '✦',
    acts: [
      {
        id: 'act-1',
        title: '第一幕',
        purpose: '建立日常',
        beats: [
          { id: 'beat-1-1', title: '开场', purpose: '建立主角的日常状态' },
          { id: 'beat-1-2', title: '异变', purpose: '打破日常' },
        ],
      },
      {
        id: 'act-2',
        title: '第二幕',
        purpose: '推进冲突',
        beats: [{ id: 'beat-2-1', title: '抉择', purpose: '主角做出选择' }],
      },
    ],
    ...overrides,
  } as StoryOutline;
}

export function makeBackground(overrides: Record<string, unknown> = {}): Background {
  return {
    id: 'bg-test-1',
    name: '测试出身',
    description: '出生于测试环境。',
    traits: ['谨慎'],
    startItems: ['旧钥匙', '干粮'],
    startScene: '雨夜里，你站在陌生的街口。',
    coverEmoji: '☂',
    ...overrides,
  } as Background;
}

export function makeWorldBook(overrides: Record<string, unknown> = {}): WorldBook {
  return {
    id: 'wb-test-1',
    name: '测试世界书',
    description: '约束测试世界的基本规律。',
    entries: [
      { id: 'wbe-1', name: '世界基调', keywords: ['雨', '城市'], content: '常年阴雨。', priority: 100, alwaysActive: true },
    ],
    ...overrides,
  } as WorldBook;
}

export function makeState(overrides: Record<string, unknown> = {}): GameStateV2 {
  const base = {
    schemaVersion: 2 as const,
    revision: 3,
    turn: 7,
    phase: 'generating' as const,
    mode: 'author' as const,
    narrativePace: 'standard' as const,
    storyAutonomy: 'standard' as const,
    history: [],
    summary: '旧摘要',
    latestProgress: '旧进展',
    // v0.7.0：sanitize 会把缺失的 soulProfile 归一化为空串；夹具显式给出空串，
    // 让"导出→导入"这类整体 deepEqual 的往返测试与真实 hydrate 结果一致。
    soulProfile: '',
    currentScene: { id: 'scene-1', name: '旧场景', description: '旧场景描述', time: '傍晚', weather: '雨' },
    characters: [
      {
        id: 'char-a',
        name: '阿黎',
        aliases: ['小黎'],
        role: '同学',
        description: '谨慎的同伴',
        status: 'active' as const,
        knownFacts: ['住在城南'],
        firstSeenTurn: 1,
        lastSeenTurn: 6,
      },
    ],
    relationships: [
      { id: 'rel-1', fromId: 'player', toId: 'char-a', affinity: 10, updatedAtTurn: 5 },
    ],
    inventory: [
      { id: 'item-1', name: '匕首', kind: 'item' as const, description: '旧匕首', quantity: 2, consumable: false, acquiredAtTurn: 1, updatedAtTurn: 2 },
    ],
    storyThreads: [
      { id: 'thread-1', title: '寻找兄长', kind: 'main' as const, status: 'active' as const, progress: 20, currentStep: '打听消息', involvedCharacterIds: ['char-a'], updatedAtTurn: 4 },
    ],
    facts: [],
    availableActions: [],
    destiny: {
      completionEstimate: 40,
      completionReason: '旧完成度说明',
      currentActId: 'act-1',
      currentActIndex: 0,
      currentStage: '第一幕',
      currentPath: '旧路径',
      nextMilestone: '旧里程碑',
      convergencePlan: '旧收敛计划',
      beats: [
        // actId 属于程序权威幕状态机（必填、不可变）；两个故事节都来自 makeOutline 的第一幕。
        { beatId: 'beat-1-1', actId: 'act-1', status: 'available' as const, evidenceTurns: [], updatedAtTurn: 0 },
        { beatId: 'beat-1-2', actId: 'act-1', status: 'pending' as const, evidenceTurns: [], updatedAtTurn: 0 },
      ],
      actHistory: [],
      endingReached: false,
      updatedAtTurn: 2,
    },
    randomEvent: {
      enabled: true,
      nextTriggerTurn: 99,
      pending: false,
      intensity: 'related' as const,
      triggerIntervalMin: 3,
      triggerIntervalMax: 5,
      // D7：滚动钩子历史默认空数组；导出/导入往返与 hydrate 都需要这一项保持一致。
      history: [],
    },
    ...overrides,
  };
  return base as unknown as GameStateV2;
}

export function makePatch(overrides: Record<string, unknown> = {}): TurnPatchV2 {
  return {
    schemaVersion: 2,
    commitId: 'commit-test-1',
    baseRevision: 3,
    turn: 7,
    roundSummary: '本轮摘要',
    latestProgress: '最新进展',
    characters: [],
    relationships: [],
    inventory: [],
    threads: [],
    facts: [],
    actions: [],
    ...overrides,
  } as unknown as TurnPatchV2;
}

export function makeSettings(overrides: Partial<AppSettings> = {}): AppSettings {
  return {
    ...DEFAULT_SETTINGS,
    apiBaseUrl: 'https://api.test.invalid/v1',
    apiKey: 'test-key',
    storyModel: 'test-story-model',
    plannerModel: 'test-planner-model',
    ...overrides,
  };
}
