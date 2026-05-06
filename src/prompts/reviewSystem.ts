// 旅程结算 · 评分提示词

import type { StoryOutline, Background } from '@/types/content';
import type { Message } from '@/types/game';

export const REVIEW_SYSTEM = `你是这段互动小说的"旅程评卷人"。你会严格参照用户消息中的故事大纲、主角出身、历史摘要、最近回合和最终结局，评价整段旅程的叙事质量、选择冲击、沉浸感和目标完成度，并给出专业而温润的总结。

旅程结算规则：对玩家完成的整段互动冒险进行客观、细致的总结与评分。

输出协议（严格 JSON，无围栏，无注释，无多余文字）：
{
  "title": "6~14 字中文标题，概括本次旅程的核心",
  "summary": "180~320 字的叙事体总结，回顾主线走向与主角命运",
  "scores": {
    "narrative": 0~100 整数,
    "choices": 0~100 整数,
    "immersion": 0~100 整数,
    "completion": 0~100 整数
  },
  "overall": 0~100 整数（建议为四项加权均值）,
  "grade": "S" 或 "A" 或 "B" 或 "C" 或 "D",
  "highlights": ["10~30 字的高光时刻 1","...","..."]（共 3~5 条）,
  "comment": "100~200 字综合点评，既肯定亮点也可指出遗憾，语气专业而温润"
}

评分维度说明：
- narrative   故事起承转合的流畅度与文学质量
- choices     玩家关键决策的冲击力、差异化、代价与代入感
- immersion   世界观一致性与角色沉浸度
- completion  相对于大纲/主线目标的达成度

评分区间参考：90+ S；80-89 A；70-79 B；60-69 C；<60 D。
禁止：在 JSON 外输出任何文字；禁止 Markdown 围栏；禁止把能力/数值/装备当作评分对象。`;

export interface BuildReviewUserParams {
  outline?: StoryOutline;
  background?: Background;
  characterName?: string;
  summary: string;
  recent: Message[];       // 最近若干条消息节录
  ending?: string;
  totalRounds: number;
}

export function buildReviewUser(p: BuildReviewUserParams): string {
  const lines: string[] = [];
  if (p.outline) {
    lines.push('【世界观 / 故事大纲】', `《${p.outline.title}》`, p.outline.synopsis);
    if (p.outline.acts?.length) lines.push(`阶段：${p.outline.acts.join(' / ')}`);
    if (p.outline.tone) lines.push(`文风：${p.outline.tone}`);
  }
  if (p.background) {
    lines.push('', '【角色】', `${p.characterName || '（未命名）'} · ${p.background.name}`, p.background.description);
  }
  lines.push('', '【当前上下文 / 旅程规模】', `总回合：${p.totalRounds}`);
  if (p.summary?.trim()) {
    lines.push('', '【历史摘要】', p.summary.trim());
  }
  if (p.recent?.length) {
    lines.push('', '【最近回合节录】');
    for (const m of p.recent) {
      const tag = m.role === 'assistant' ? `故事-第${m.round + 1}回合` : '玩家';
      lines.push(`【${tag}】\n${m.content}`);
    }
  }
  if (p.ending?.trim()) {
    lines.push('', '【最终结局】', p.ending.trim());
  }
  lines.push(
    '',
    '请严格按协议输出评分 JSON。',
  );
  return lines.join('\n');
}
