import type { AppSettings } from '@/types/settings';
import type { StoryOutline, WorldBookEntry } from '@/types/content';
import type {
  AuthorNarrativeState,
  AuthorRandomEventState,
  GameSave,
  MemoryAnchor,
  Message,
  Npc,
  OutlineMappingState,
  SceneRef,
} from '@/types/game';
import { chatJSONDetailed } from '@/services/llmClient';
import { AUTHOR_OUTLINE_MAPPER_SYSTEM, buildAuthorOutlineMapperUser } from '@/prompts/authorOutlineMapperSystem';
import { extractJSON } from '@/lib/utils';
import { withPromptTrace } from '@/lib/agentTrace';
import { appendWorkspaceManifest, appendWorkspaceSystem, buildWorkspaceToolRuntime } from '@/services/workspaceTools';
import { sanitizePlanningOutlineMapping } from '@/services/authorPlanningUtils';
import { resolveAuthorCallModel } from '@/lib/agentModels';

export interface AuthorOutlineMapperRequest {
  save?: GameSave;
  settings: AppSettings;
  outline?: StoryOutline;
  currentRound: number;
  nextRound: number;
  totalRounds: number;
  playerInput?: string;
  latestStory?: string;
  recent: Message[];
  summary?: string;
  longTermMemory?: string;
  npcs?: Npc[];
  currentScene?: SceneRef;
  narrative?: AuthorNarrativeState;
  randomEventState?: AuthorRandomEventState;
  worldBookEntries?: WorldBookEntry[];
  anchors?: MemoryAnchor[];
  onDelta?: (text: string) => void;
  onThinkingDelta?: (text: string) => void;
  signal?: AbortSignal;
}

export async function requestAuthorOutlineMapping(p: AuthorOutlineMapperRequest): Promise<OutlineMappingState | undefined> {
  const model = resolveAuthorCallModel(p.settings, 'outlineMapper');
  const workspace = p.settings.apiFormat === 'chat' ? await buildWorkspaceToolRuntime(p.save, { agentKind: 'outlineMapper' }) : {};
  const user = appendWorkspaceManifest(buildAuthorOutlineMapperUser(p), workspace.userManifest);
  const system = appendWorkspaceSystem(AUTHOR_OUTLINE_MAPPER_SYSTEM, workspace.systemRules);

  const runOnce = async (temperature: number): Promise<OutlineMappingState | undefined> => {
    const result = await chatJSONDetailed(
      { baseUrl: p.settings.apiBaseUrl, apiKey: p.settings.apiKey, format: p.settings.apiFormat },
      {
        model,
        temperature,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        tools: workspace.tools,
        onToolCall: workspace.onToolCall,
        maxToolRounds: 3,
        onDelta: p.onDelta,
        onThinkingDelta: p.onThinkingDelta,
        signal: p.signal,
      },
    );
    const parsed = sanitizePlanningOutlineMapping(extractJSON(result.text), p.currentRound);
    return parsed
      ? withPromptTrace({ ...parsed, thinking: result.thinking, rawOutput: result.text, usage: result.usage }, result.trace)
      : undefined;
  };

  const first = await runOnce(0.25).catch((err) => {
    console.warn('[authorOutlineMapperAgent] first attempt failed', err);
    return undefined;
  });
  if (first) return first;

  return runOnce(0.1).catch((err) => {
    console.warn('[authorOutlineMapperAgent] retry failed', err);
    return undefined;
  });
}
