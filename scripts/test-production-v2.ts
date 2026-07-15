import fs from 'node:fs/promises';
import { runTurnV2 } from '../src/v2/engine';
import { PRESET_OUTLINES } from '../src/presets/outlines';
import { PRESET_BACKGROUNDS } from '../src/presets/backgrounds';
import { PRESET_WORLDBOOKS } from '../src/presets/worldbooks';
import type { GameStateV2, ModelActivityV2, NarrativePaceV2 } from '../src/v2/types';
import type { AppSettings } from '../src/types/settings';

const key = process.env.LRPG_API_KEY || '';
if (!key) throw new Error('缺少LRPG_API_KEY');
const outline = PRESET_OUTLINES[0];
const background = PRESET_BACKGROUNDS[0];
const worldFacts = PRESET_WORLDBOOKS[0].entries;
const now = Date.now();
const state: GameStateV2 = {
  schemaVersion: 2, revision: 0, turn: 0, phase: 'input', mode: 'author', narrativePace: 'standard',
  history: [{ id: 'opening', role: 'assistant', content: background.startScene, turn: 0, createdAt: now }],
  summary: background.startScene, latestProgress: '', currentScene: { id: 'opening-scene', name: '教学楼女厕隔间', description: background.startScene.slice(0, 180) },
  characters: [], relationships: [], inventory: background.startItems.map((name, i) => ({ id: `item-${i}`, name, kind: 'item', description: '', quantity: 1, consumable: false, acquiredAtTurn: 0, updatedAtTurn: 0 })), storyThreads: [], facts: [], availableActions: [],
  destiny: { completionEstimate: 0, completionReason: '故事刚刚开始。', currentActId: outline.acts[0].id, currentStage: outline.acts[0].title, currentPath: '开局', nextMilestone: outline.acts[0].beats[0].title, beats: outline.acts.flatMap((act, ai) => act.beats.map((beat, bi) => ({ beatId: beat.id, status: ai === 0 && bi === 0 ? 'available' : 'pending', evidenceTurns: [], updatedAtTurn: 0 }))), endingReached: false, updatedAtTurn: 0 },
  randomEvent: { nextTriggerTurn: 3, pending: false, intensity: 'related' },
};
const settings: AppSettings = {
  apiBaseUrl: 'https://api.deepseek.com/v1', apiKey: key, apiFormat: 'chat', plannerModel: 'deepseek-v4-pro', storyModel: 'deepseek-v4-pro', temperatureStory: .9, storyMaxTokens: 16384,
  plannerContextPreset: 'custom', plannerContextTokens: 4096, plannerToolsEnabled: true, plannerToolMaxCalls: 2,
  plannerJsonMode: 'auto', thinkingMode: 'enabled', reasoningEffort: 'high',
};
const turns: Array<{ pace: NarrativePaceV2; input: string }> = [
  { pace: 'slow', input: '钥匙即将转动时，我明确想着如果我是女孩子就好了，触发能力并只处理走出隔间时眼前人的反应。' },
  { pace: 'standard', input: '离开女厕后我到无人楼梯间检查学生证、手机、教务系统和404宿舍登记。我还注意到旧手机备忘录里有一条原本就存在的提醒，原文是“银杏落尽前交算法作业”，把它作为我近期学业安排的证据。' },
  { pace: 'standard', input: '我恢复成曦宇回404，通过一次自然宿舍日常认识三个舍友的性格，不透露能力。' },
  { pace: 'standard', input: '第二天以曦雨身份参加原有计算机课程，和一位陌生女生合作解决程序问题，建立第一段新关系。' },
  { pace: 'standard', input: '我和新认识的同学参加社团活动，让一个严格相关且推进当前故事节的随机事件自然发生。' },
  { pace: 'fast', input: '概括接下来一周双身份生活的关键进展，保持学业和404生活，同时推进曦雨的新关系，不凭空变成多年好友。' },
  { pace: 'slow', input: '一周后我认真考虑转学去外省，到辅导员办公室咨询真实流程，只咨询和权衡，不提交申请。' },
  { pace: 'timeskip', input: '我最终提交转学申请，跨越数周写出申请、告别、维持旧关系和抵达新学校的关键节点，长期命运沿新路径继续。' },
  { pace: 'standard', input: '在新学校第一次安排作业时，我需要准确回忆最初女厕脱险后检查手机时，那条旧备忘录提醒的原文。请先核对历史证据，再据此决定本周学习优先级。' },
  { pace: 'standard', input: '我恢复新学校的正常课程和双身份探索，通过公开信息与自然事件推进一位和高中往事有关的关键人物重新进入我的命运，但不要直接完成重逢。' },
];

const report: any = { startedAt: new Date().toISOString(), settings: { ...settings, apiKey: '[redacted]' }, turns: [], errors: [] };
let current = state;
for (const [index, turn] of turns.entries()) {
  const activities: ModelActivityV2[] = [];
  const thinking: Record<string, string> = {};
  let streamed = '';
  try {
    const result = await runTurnV2({ state: { ...current, narrativePace: turn.pace }, input: turn.input, settings, outline, background, worldFacts, onStoryDelta: (text) => { streamed += text; }, onModelActivity: (activity) => activities.push(activity), onModelThinkingDelta: (phase, text) => { thinking[phase] = (thinking[phase] || '') + text; } });
    current = result.state;
    report.turns.push({ turn: index + 1, pace: turn.pace, input: turn.input, story: result.story, brief: result.brief, patch: result.patch, activities, thinking, usage: result.usage, state: current });
    await fs.mkdir('test-runs', { recursive: true });
    await fs.writeFile('test-runs/production-v2-10-live.json', JSON.stringify({ ...report, finalState: current }, null, 2));
    process.stdout.write(`[turn ${index + 1}] ok tools=${activities.filter((x) => x.type === 'tool' && x.status === 'call').length}\n`);
  } catch (error: any) {
    report.errors.push({ turn: index + 1, error: error?.message || String(error), activities, thinking, streamed });
    break;
  }
}
report.finishedAt = new Date().toISOString(); report.finalState = current;
await fs.mkdir('test-runs', { recursive: true });
await fs.writeFile('test-runs/production-v2-10-live.json', JSON.stringify(report, null, 2));
console.log(`done ${report.turns.length}/10 errors=${report.errors.length}`);
if (report.errors.length) process.exitCode = 1;
