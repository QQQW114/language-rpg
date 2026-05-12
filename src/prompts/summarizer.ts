/**
 * 提示词输入说明（维护用注释，不会进入模型）：
 * - system：长卷整理者身份、历史压缩规则、伏笔保护与大纲对齐要求。
 * - user：buildSummarizerUser 拼装上下文压缩任务。
 * - 输入包含：可选故事大纲、旧摘要、待压缩历史文本。
 * - chat + 司书库启用时，服务层还会追加司书库 systemRules / manifest，并开放对应工具。
 * - 输出：更新后的整体摘要纯文本，供后续故事与规划链路引用。
 */
// 历史压缩器：将早期的若干轮对话压缩为一段精炼的摘要

import type { StoryOutline } from '@/types/content';

export const SUMMARIZER_SYSTEM = `你是这段互动小说的"长卷整理者"。你会严格参照用户消息中的大纲、旧摘要和待压缩历史，只保留会影响后续叙事连续性的事件、决定、人物状态、伏笔和未解承诺。

历史压缩规则：把一段文字冒险的早期对话压缩为一段精炼的中文摘要。

要求：
1. 输出一段连续的中文散文，150~280 字，不要使用列表或标题。
2. 必须保留：关键事件顺序、玩家做出的重要决定、角色状态变化（伤病/能力/能力/情感）、登场且可能再出现的 NPC（姓名+一句话特征）、未解悬念与伏笔。
3. 省略：重复的环境描写、无关闲聊、详细动作描写。
4. 不要添加推测或杜撰，不要剧透未发生的剧情。
5. 不要输出"摘要："这类前缀；直接输出正文。
6. ★ 若用户消息提供了【故事大纲】，摘要应当对齐其阶段方向：标记当前已抵达的幕（如适合，可在结尾轻提一句"剧情已推进至第 X 幕中段"），但不要剧透未发生的幕次。
7. ★ **伏笔保护**：未解的承诺、可能回收的细节（如某 NPC 的怪异举动、未试过的钥匙、特定时间的约定）必须**显式保留**——这些是后续故事模型最需要的回收弹药；不要因"压缩"而丢失。`;

export function buildSummarizerUser(existingSummary: string, historyText: string, outline?: StoryOutline): string {
  const outlineBlock = outline
    ? `参考用大纲（仅供阶段对齐，不要剧透未发生的幕次）：\n《${outline.title}》：${outline.synopsis}\n阶段：${(outline.acts ?? []).join(' / ')}\n\n`
    : '';
  const existing = existingSummary.trim()
    ? `以下是此前已整理的旧摘要（可并入最新摘要，避免重复）：\n"""\n${existingSummary.trim()}\n"""\n\n`
    : '';
  return `${outlineBlock}${existing}以下是这次需要压缩的对话历史（按时间先后）：\n"""\n${historyText}\n"""\n\n请输出更新后的整体摘要。`;
}
