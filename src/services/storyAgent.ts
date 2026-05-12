// 故事 Agent：负责拼装 prompt 并流式请求故事模型

import type { AuthorNarrativeState, AuthorRandomEventState, Message, Item, Npc, MemoryAnchor, SceneRef, GameSave, ToolActivityRecord } from '@/types/game';
import type { StoryOutline, Background, WorldBookEntry, RandomEvent } from '@/types/content';
import type { AppSettings } from '@/types/settings';
import type { StrictCustomConfig } from '@/types/custom';
import { chatStreamDetailed, type ChatMessage, type ChatToolInvocation } from './llmClient';
import { buildStorySystemPrompt, buildStorySystem } from '@/prompts/storySystem';
import { getStoryUserTemplate, renderPromptTemplate } from '@/lib/strictCustom';
import { buildDeepSeekV4StoryMarker } from '@/lib/deepseekV4Prompt';
import { joinThinking } from '@/lib/thinking';
import { mergeLlmUsage } from '@/lib/llmUsage';
import type { LlmUsage } from '@/types/llm';
import type { AgentCallRecord, AgentPromptTrace } from '@/types/ledger';
import { appendWorkspaceManifest, appendWorkspaceSystem, buildWorkspaceToolRuntime } from '@/services/workspaceTools';
import { runDirectorReplyAgent } from '@/services/authorDirectorAgent';
import { getAgentCalls } from '@/storage/ledgerRepository';

export interface StoryRequest {
  save?: GameSave;
  settings: AppSettings;
  outline?: StoryOutline;
  background?: Background;
  characterName?: string;
  activeWorldBookEntries: WorldBookEntry[];
  summary?: string;
  longTermMemory?: string;
  history: Message[];
  currentRound: number;
  totalRounds: number;
  triggeredEvent?: RandomEvent;
  playerInput?: string;
  regenerationHint?: string;
  backpack?: Item[];
  usedItems?: Item[];
  npcs?: Npc[];
  anchors?: MemoryAnchor[];
  currentScene?: SceneRef;
  authorNarrative?: AuthorNarrativeState;
  authorRandomEventState?: AuthorRandomEventState;
  strictCustom?: StrictCustomConfig;
  summarizedUntilIndex?: number;
  finalizeRequested?: boolean;
  onDelta: (text: string) => void;
  onThinkingDelta?: (text: string) => void;
  onToolActivity?: (activity: ToolActivityRecord) => void;
  signal?: AbortSignal;
}

const MAX_CONTEXT_MESSAGES = 40;
const MAX_AUTO_CONTINUES = 2;

export interface StoryResponse {
  text: string;
  thinking?: string;
  usage?: LlmUsage;
  trace?: AgentPromptTrace;
  toolEvents?: ToolActivityRecord[];
}

function toolArg(call: ChatToolInvocation, key: string): string | undefined {
  const value = call.arguments?.[key];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function describeStoryToolCall(call: ChatToolInvocation): ToolActivityRecord {
  const path = toolArg(call, 'path');
  const query = toolArg(call, 'query');
  const round = Number(call.arguments?.round);
  const n = Number(call.arguments?.n);
  const roundText = Number.isFinite(round) && round > 0 ? `第 ${Math.floor(round)} 回合` : undefined;
  const nText = Number.isFinite(n) && n > 0 ? `最近 ${Math.floor(n)} 条` : undefined;

  const label = (() => {
    switch (call.name) {
      case 'read_doc': return `阅读了 ${path || '司书库文件'}`;
      case 'search_docs': return `检索了「${query || '司书库'}」`;
      case 'list_docs': return `查看了 ${path || '司书库'} 目录`;
      case 'get_entity_doc': return `查阅了实体档案「${toolArg(call, 'name') || path || '未命名'}」`;
      case 'get_story_briefing': return `查阅了故事资料包${roundText ? `（${roundText}）` : ''}`;
      case 'get_story_outline': return '查阅了完整故事大纲';
      case 'get_initial_scene': return '查阅了开局文本';
      case 'get_background': return '查阅了主角出身';
      case 'get_world_books': return '查阅了世界书';
      case 'get_journey_content': return '查阅了旅程配置';
      case 'get_author_custom_config': return '查阅了自定义规则';
      case 'get_story_style': return '查阅了故事风格';
      case 'get_recent_rounds': return `查阅了${nText || '最近几回合'}卷宗`;
      case 'get_recent_history': return `查阅了${nText || '最近'}对话`;
      case 'get_round_record': return `查阅了${roundText || '指定回合'}卷宗`;
      case 'get_current_state': return '查看了当前旅程状态';
      case 'get_master_arc': return '查阅了主弧';
      case 'get_director_plan': return '查阅了导演计划';
      case 'get_active_events': return '查阅了进行中的事件';
      case 'get_latest_planning_bundle': return '查阅了最新规划包';
      case 'get_latest_character_plan': return '查阅了最新人物规划';
      case 'get_latest_scene_plan': return '查阅了最新场景规划';
      case 'get_latest_event_plan': return '查阅了最新事件规划';
      case 'get_latest_outline_mapping': return '查阅了最新大纲映射';
      case 'get_latest_stage_judge': return '查阅了最新阶段判断';
      case 'get_latest_director_plan': return '查阅了最新导演计划';
      case 'get_active_event_docs': return '查阅了活跃事件档案';
      case 'ask_director': return `向叙事导演询问：${toolArg(call, 'question') || '剧情缺口'}`;
      case 'get_current_round_agent_calls': return '查看了本回合模型记录';
      case 'get_recent_agent_calls': return `查看了${nText || '近期'}模型记录`;
      case 'get_agent_output': return '查阅了某次模型输出';
      case 'write_doc': return `写入了 ${path || '司书库文件'}`;
      case 'patch_doc': return `更新了 ${path || '司书库文件'}`;
      case 'append_doc': return `补充了 ${path || '司书库文件'}`;
      case 'archive_doc': return `归档了 ${path || '司书库文件'}`;
      case 'write_entity_doc': return `写入了${toolArg(call, 'entityType') || '实体'}档案「${toolArg(call, 'name') || path || '未命名'}」`;
      default: return `调用工具 ${call.name}`;
    }
  })();

  const isWrite = ['write_doc', 'patch_doc', 'append_doc', 'archive_doc', 'write_entity_doc'].includes(call.name);
  return {
    id: call.id,
    name: call.name,
    label,
    detail: call.argumentsText,
    actor: '故事写手',
    agentKind: 'story',
    phase: call.name === 'ask_director' ? 'call' : isWrite ? 'write' : 'read',
    createdAt: Date.now(),
  };
}

function stringifyStoryToolResult(result: unknown, max = 320): string {
  let text = '';
  if (typeof result === 'string') {
    text = result;
  } else {
    try {
      text = JSON.stringify(result);
    } catch {
      text = String(result ?? '');
    }
  }
  text = text.trim();
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function describeStoryToolResult(call: ChatToolInvocation, result: unknown): ToolActivityRecord {
  const callActivity = describeStoryToolCall(call);
  return {
    id: `${call.id}:result`,
    name: call.name,
    label: `完成：${callActivity.label}`,
    detail: stringifyStoryToolResult(result),
    actor: '故事写手',
    agentKind: 'story',
    phase: 'result',
    createdAt: Date.now(),
  };
}

function thoughtToAgentCallLike(
  thought: NonNullable<GameSave['state']['agentThoughts']>[number] | undefined,
): Pick<AgentCallRecord, 'input' | 'output' | 'createdAt'> | undefined {
  if (!thought) return undefined;
  return {
    input: thought.prompt,
    output: thought.output,
    createdAt: thought.createdAt,
  };
}

async function findFirstDirectorCallThisRound(
  save: GameSave | undefined,
  round: number,
): Promise<Pick<AgentCallRecord, 'input' | 'output' | 'createdAt'> | undefined> {
  if (!save) return undefined;
  const prevRound = Math.max(0, round - 1);
  const rank = (itemRound: number) => itemRound === round ? 0 : itemRound === prevRound ? 1 : 2;
  const isCandidateRound = (itemRound: number) => itemRound === round || itemRound === prevRound;
  const inMemory = (save.state.agentThoughts ?? [])
    .filter((item) => item.kind === 'director' && isCandidateRound(item.round))
    .sort((a, b) => rank(a.round) - rank(b.round) || a.createdAt - b.createdAt)[0];
  if (inMemory) return thoughtToAgentCallLike(inMemory);

  const calls = await getAgentCalls(save.id).catch((err) => {
    console.warn('[storyAgent] failed to load director calls', err);
    return [] as AgentCallRecord[];
  });
  return calls
    .filter((item) => item.kind === 'director' && isCandidateRound(item.round))
    .sort((a, b) => rank(a.round) - rank(b.round) || a.createdAt - b.createdAt)[0];
}

function emitStoryToolActivity(
  events: ToolActivityRecord[],
  emit: StoryRequest['onToolActivity'],
  activity: ToolActivityRecord,
): void {
  events.push(activity);
  emit?.(activity);
}

export async function requestStory(p: StoryRequest): Promise<StoryResponse> {
  const workspace = p.settings.apiFormat === 'chat' ? await buildWorkspaceToolRuntime(p.save, { agentKind: 'story' }) : {};
  const workspaceManifest = workspace.userManifest;
  const toolEvents: ToolActivityRecord[] = [];
  const storyContextPrompt = buildStorySystem({
    outline: p.outline,
    background: p.background,
    characterName: p.characterName,
    activeWorldBookEntries: p.activeWorldBookEntries,
    summary: p.summary,
    longTermMemory: p.longTermMemory,
    currentRound: p.currentRound,
    totalRounds: p.totalRounds,
    triggeredEvent: p.triggeredEvent,
    backpack: p.backpack,
    usedItems: p.usedItems,
    npcs: p.npcs,
    anchors: p.anchors,
    currentScene: p.currentScene,
    authorNarrative: p.authorNarrative,
    authorRandomEventState: p.authorRandomEventState,
    strictCustom: p.strictCustom,
    finalizeRequested: p.finalizeRequested,
    lengthHint: p.settings.storyLength,
    storyPromptMode: p.settings.storyPromptMode,
    styleAddendum: p.settings.storyStyleAddendum,
  });
  // 以 summarizedUntilIndex 为起点，从 history 中切出未被摘要的部分（再做一层 MAX_CONTEXT_MESSAGES 兜底）
  const startIdx = Math.max(
    p.summarizedUntilIndex ?? 0,
    p.history.length - MAX_CONTEXT_MESSAGES,
  );
  const trimmed = p.history.slice(startIdx);

  const storySystemPrompt = [
    buildStorySystemPrompt(p.settings.storyPromptMode, p.characterName),
    workspaceManifest?.trim()
      ? '【司书库规则】用户消息中包含司书库文件结构 manifest。它代表当前旅程的实时资料库摘要；你可以在写作前按需调用工具阅读相关文件或资料包。工具调用只用于查资料，最终正文不要提到“工具/文件/manifest”。若 manifest 与最近正文冲突，以最近正文和玩家明确输入为准。'
      : '',
  ].filter(Boolean).join('\n\n');
  const storySystemWithWorkspace = appendWorkspaceSystem(storySystemPrompt, workspace.systemRules);

  const messages: ChatMessage[] = [
    { role: 'system', content: storySystemWithWorkspace },
    ...trimmed.map((m) => ({ role: m.role, content: m.content }) as ChatMessage),
  ];

  let defaultUserMessage = p.playerInput?.trim() || '';
  let usedItemsBlock = '';
  if (p.usedItems && p.usedItems.length) {
    const list = p.usedItems.map((it) => `「${it.name}」`).join('、');
    usedItemsBlock = `（本回合使用能力：${list}）`;
    defaultUserMessage = defaultUserMessage
      ? `${defaultUserMessage}\n${usedItemsBlock}`
      : `（本回合使用能力：${list}；请继续推进剧情。）`;
  }

  let regenerationHintBlock = '';
  const regenerationHint = p.regenerationHint?.trim();
  if (regenerationHint) {
    regenerationHintBlock =
      `\n\n【本次重新生成的重要参考】\n${regenerationHint}\n` +
      '请把以上内容作为本回合重写时的优先参考；不要机械复述提示词本身，仍需保持原有文风与连续性。';
    defaultUserMessage = defaultUserMessage
      ? `${defaultUserMessage}${regenerationHintBlock}`
      : `（请重新生成本回合。）${regenerationHintBlock}`;
  }

  if (!defaultUserMessage) {
    defaultUserMessage = p.currentRound === 0
      ? '（故事开始。请开启第一回合。）'
      : '（请推进剧情。）';
  }

  const nextRound = p.currentRound + 1;
  const renderedUserMessage = renderPromptTemplate(getStoryUserTemplate(p.strictCustom), {
    round: nextRound,
    completedRounds: p.currentRound,
    nextRound,
    input: p.playerInput ?? '',
    playerInput: p.playerInput ?? '',
    defaultUserMessage,
    usedItemsBlock,
    regenerationHintBlock: regenerationHintBlock.trim(),
  }) || defaultUserMessage;
  const storyPromptModeMarker = buildDeepSeekV4StoryMarker(
    p.settings.storyPromptMode,
    p.characterName,
    p.authorNarrative?.settingGuard?.preference,
  );
  const userMessage = [
    '【世界观 / 旅程资料 / 压缩上下文】',
    storyContextPrompt,
    '',
    '【当前上下文 / 玩家本回合输入】',
    renderedUserMessage,
    storyPromptModeMarker ? `\n${storyPromptModeMarker}` : '',
  ].filter((part) => part.trim()).join('\n');
  messages.push({ role: 'user', content: appendWorkspaceManifest(userMessage, workspaceManifest, !!workspace.tools?.length) });

  const maxTokens =
    Number.isFinite(p.settings.storyMaxTokens) && p.settings.storyMaxTokens > 0
      ? Math.floor(p.settings.storyMaxTokens)
      : undefined;

  let full = '';
  const thinkingParts: string[] = [];
  let usage: LlmUsage | undefined;
  let trace: AgentPromptTrace | undefined;
  let requestMessages = messages;
  let continueCount = 0;
  let askDirectorCount = 0;

  while (true) {
    const onToolCall = workspace.onToolCall
      ? async (call: ChatToolInvocation) => {
        const activity = describeStoryToolCall(call);
        emitStoryToolActivity(toolEvents, p.onToolActivity, activity);
        if (call.name === 'ask_director') {
          if (askDirectorCount >= 1) {
            return '你已使用此工具，无法第二次使用此工具。请基于现有信息和导演的回复继续创作。';
          }
          askDirectorCount += 1;
          if (!p.save) {
            return '当前没有可用旅程存档，无法触发叙事导演回应。请基于现有 brief 继续创作。';
          }
          const firstDirectorCall = await findFirstDirectorCallThisRound(p.save, p.currentRound);
          if (!firstDirectorCall) {
            return '未找到本回合第一次叙事导演调用记录，无法触发二次回应。请基于当前 brief、最近上下文和已知设定继续创作。';
          }
          const question = toolArg(call, 'question') || String(call.arguments?.question ?? '').trim();
          const missingInfo = toolArg(call, 'missingInfo');
          emitStoryToolActivity(toolEvents, p.onToolActivity, {
            id: `${call.id}:directorReply:start`,
            name: 'directorReply',
            label: '回应故事写手询问',
            detail: question,
            actor: '叙事导演',
            agentKind: 'directorReply',
            phase: 'status',
            createdAt: Date.now(),
          });
          const reply = await runDirectorReplyAgent({
            save: p.save,
            settings: p.settings,
            question,
            missingInfo,
            firstDirectorTrace: firstDirectorCall.input,
            firstDirectorOutput: firstDirectorCall.output,
            signal: p.signal,
            onToolActivity: (event) => emitStoryToolActivity(toolEvents, p.onToolActivity, event),
          });
          emitStoryToolActivity(toolEvents, p.onToolActivity, {
            id: `${call.id}:directorReply:done`,
            name: 'directorReply',
            label: '叙事导演已回应',
            detail: reply.answer.slice(0, 240),
            actor: '叙事导演',
            agentKind: 'directorReply',
            phase: 'result',
            createdAt: Date.now(),
          });
          return `${reply.answer}\n\n（系统提示：导演已完成回复，请参照内容开始创作新一轮故事。）`;
        }
        const toolResult = await workspace.onToolCall?.(call);
        emitStoryToolActivity(toolEvents, p.onToolActivity, describeStoryToolResult(call, toolResult));
        return toolResult;
      }
      : undefined;
    const result = await chatStreamDetailed(
      { baseUrl: p.settings.apiBaseUrl, apiKey: p.settings.apiKey, format: p.settings.apiFormat },
      {
        messages: requestMessages,
        model: p.settings.storyModel,
        temperature: p.settings.temperatureStory,
        maxTokens,
        tools: workspace.tools,
        onToolCall,
        maxToolRounds: 3,
        onDelta: p.onDelta,
        onThinkingDelta: p.onThinkingDelta,
        signal: p.signal,
      },
    );
    full += result.text;
    if (result.thinking?.trim()) thinkingParts.push(result.thinking.trim());
    usage = mergeLlmUsage(usage, result.usage);
    trace = trace ?? result.trace;

    if (result.finishReason !== 'length' || continueCount >= MAX_AUTO_CONTINUES) break;

    continueCount++;
    requestMessages = [
      ...messages,
      { role: 'assistant', content: full },
      {
        role: 'user',
        content: [
          '【当前上下文 / 续写要求】',
          '上一段因输出长度限制被截断。请从中断处无缝续写本回合，只补足未完成的叙事；不要重述开头，不要重新列选项。',
          storyPromptModeMarker ? `\n${storyPromptModeMarker}` : '',
        ].filter((part) => part.trim()).join('\n'),
      },
    ];
  }

  return {
    text: full.trim(),
    thinking: joinThinking(...thinkingParts),
    usage,
    trace,
    toolEvents,
  };
}
