import type { AppSettings } from '@/types/settings';
import type { StoryOutline, WorldBookEntry } from '@/types/content';
import type {
  AuthorNarrativeState,
  AuthorRandomEventState,
  AuthorScenePlanState,
  GameSave,
  Item,
  MemoryAnchor,
  Message,
  Npc,
  PlannerAnalysisRequest,
  SceneRef,
} from '@/types/game';
import { chatJSONDetailed } from '@/services/llmClient';
import { AUTHOR_SCENE_PLANNER_SYSTEM, buildAuthorScenePlannerUser } from '@/prompts/authorScenePlannerSystem';
import { extractJSON } from '@/lib/utils';
import { withPromptTrace } from '@/lib/agentTrace';
import { appendWorkspaceManifest, appendWorkspaceSystem, buildWorkspaceToolRuntime } from '@/services/workspaceTools';
import { sanitizeScenePlanState } from '@/services/authorPlanningUtils';
import { resolveAuthorToolModel } from '@/lib/agentModels';

export interface AuthorScenePlannerRequest {
  save?: GameSave;
  settings: AppSettings;
  outline?: StoryOutline;
  currentRound: number;
  nextRound: number;
  playerInput?: string;
  latestStory?: string;
  recent: Message[];
  summary?: string;
  longTermMemory?: string;
  npcs?: Npc[];
  backpack?: Item[];
  currentScene?: SceneRef;
  availableScenes?: SceneRef[];
  narrative?: AuthorNarrativeState;
  randomEventState?: AuthorRandomEventState;
  worldBookEntries?: WorldBookEntry[];
  anchors?: MemoryAnchor[];
  analysisRequest?: PlannerAnalysisRequest;
  onDelta?: (text: string) => void;
  onThinkingDelta?: (text: string) => void;
  signal?: AbortSignal;
}

export async function requestAuthorScenePlan(p: AuthorScenePlannerRequest): Promise<AuthorScenePlanState | undefined> {
  const model = resolveAuthorToolModel(p.settings);
  const workspace = p.settings.apiFormat === 'chat' ? await buildWorkspaceToolRuntime(p.save, { agentKind: 'scenePlanner' }) : {};
  const user = appendWorkspaceManifest(buildAuthorScenePlannerUser(p), workspace.userManifest);
  const system = appendWorkspaceSystem(AUTHOR_SCENE_PLANNER_SYSTEM, workspace.systemRules);

  const runOnce = async (temperature: number): Promise<AuthorScenePlanState | undefined> => {
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
    const parsed = sanitizeScenePlanState(extractJSON(result.text), p.currentRound);
    return parsed
      ? withPromptTrace({ ...parsed, thinking: result.thinking, rawOutput: result.text, usage: result.usage }, result.trace)
      : undefined;
  };

  const first = await runOnce(0.3).catch((err) => {
    console.warn('[authorScenePlannerAgent] first attempt failed', err);
    return undefined;
  });
  if (first) return first;

  return runOnce(0.1).catch((err) => {
    console.warn('[authorScenePlannerAgent] retry failed', err);
    return undefined;
  });
}
