import type { StoryPromptMode } from '@/types/settings';
import type { SettingGuardPreference } from '@/types/game';

export function appendDeepSeekV4PureAnalysisMarker(userPrompt: string): string {
  return `${userPrompt.trim()}\n\n${DEEPSEEK_V4_PURE_ANALYSIS_MARKER}`;
}

export const DEEPSEEK_V4_PURE_ANALYSIS_MARKER = [
  '【思维模式要求】在你的思考过程（<think>标签内）中，请遵守以下规则：',
  '1. 禁止使用圆括号包裹角色内心独白，例如"（心想：……）"或"(内心OS：……)"，所有分析内容直接陈述即可。',
  '2. 禁止以故事角色、玩家角色或 NPC 的第一人称描写内心活动，例如"我心想""我觉得""我暗自"等；不要把自己代入故事中的任何角色。',
  '3. 思考内容应聚焦于任务目标、上下文证据、输出协议和结果规划，不要在思考中进行角色扮演式的内心戏表演。',
  '4. 最终输出必须严格遵守本次任务的输出协议：要求 JSON 就只输出合法 JSON；要求纯文本就只输出纯文本；不要输出思考过程、模式说明或以上指令本身。',
].join('\n');

export function protagonistNameOf(characterName?: string): string {
  return characterName?.trim() || '主角';
}

function formatPreference(preference?: SettingGuardPreference): string {
  if (!preference || preference.confidence === 'low') return '';
  const lines = [`玩家选择偏好画像（置信度 ${preference.confidence}）：${preference.tendency || '（无明确倾向描述）'}`];
  if (preference.recentSignals?.length) {
    lines.push(`近期偏好信号：${preference.recentSignals.join('；')}`);
  }
  return lines.join('\n');
}

function numberedRules(rules: string[]): string[] {
  return rules.map((rule, index) => `${index + 1}. ${rule}`);
}

export function buildDeepSeekV4StoryMarker(
  mode: StoryPromptMode | undefined,
  characterName?: string,
  preference?: SettingGuardPreference,
): string {
  const protagonist = protagonistNameOf(characterName);
  const preferenceBlock = formatPreference(preference);
  if (mode === 'deepseek-v4-protagonist') {
    return [
      '【角色沉浸要求】在你的思考过程（<think>标签内）中，请遵守以下规则：',
      ...numberedRules([
        `请以角色"${protagonist}"的第一人称进行内心独白，用括号包裹内心活动，例如"（心想：……）"或"(内心OS：……)"。`,
        '用第一人称描写角色的内心感受，例如"我心想""我觉得""我暗自"等。',
        '思考内容应沉浸在角色中，通过内心独白分析剧情和规划回复。',
        ...(preferenceBlock
          ? [`角色"${protagonist}"的选择倾向和性格演绎可参考以下玩家偏好，不要写成与其长期选择相反的性格：\n${preferenceBlock}`]
          : []),
      ]),
    ].join('\n');
  }
  if (mode === 'deepseek-v4-instruction') {
    return [
      '【思维模式要求】在你的思考过程（<think>标签内）中，请遵守以下规则：',
      ...numberedRules([
        '禁止使用圆括号包裹内心独白，例如"（心想：……）"或"(内心OS：……)"，所有分析内容直接陈述即可。',
        '禁止以角色第一人称描写内心活动，例如"我心想""我觉得""我暗自"等，请用分析性语言替代。',
        `思考内容应聚焦于剧情走向分析和回复内容规划，不要在思考中进行角色扮演式的内心戏表演；你不是"${protagonist}"，不要把自己当成主角或玩家角色。`,
        ...(preferenceBlock
          ? [`描写"${protagonist}"时应参考以下玩家偏好，把它作为人物性格和选择倾向的补充：\n${preferenceBlock}`]
          : []),
      ]),
    ].join('\n');
  }
  return '';
}
