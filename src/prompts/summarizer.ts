// 历史压缩器：将早期的若干轮对话压缩为一段精炼的摘要

export const SUMMARIZER_SYSTEM = `你是一个严谨的故事编辑助手。你的任务是把一段文字冒险的早期对话压缩为一段精炼的中文摘要，供后续回合的主持人参考。

要求：
1. 输出一段连续的中文散文，150~280 字，不要使用列表或标题。
2. 必须保留：关键事件顺序、玩家做出的重要决定、角色状态变化（伤病/物品/能力/情感）、登场且可能再出现的 NPC（姓名+一句话特征）、未解悬念与伏笔。
3. 省略：重复的环境描写、无关闲聊、详细动作描写。
4. 不要添加推测或杜撰，不要剧透未发生的剧情。
5. 不要输出"摘要："这类前缀；直接输出正文。`;

export function buildSummarizerUser(existingSummary: string, historyText: string): string {
  const existing = existingSummary.trim()
    ? `以下是此前已整理的旧摘要（可并入最新摘要，避免重复）：\n"""\n${existingSummary.trim()}\n"""\n\n`
    : '';
  return `${existing}以下是这次需要压缩的对话历史（按时间先后）：\n"""\n${historyText}\n"""\n\n请输出更新后的整体摘要。`;
}
