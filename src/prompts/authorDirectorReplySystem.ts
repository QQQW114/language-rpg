/**
 * 提示词输入说明（维护用注释，不会进入模型）：
 * - system：叙事导演二次回应身份与边界；用于故事写手通过 ask_director 工具提出问题后的短答复。
 * - user：buildAuthorDirectorReplyUser 拼装故事写手的问题与缺失信息。
 * - 服务层会尽量继承本回合第一次叙事导演调用的消息历史，并替换为本 system 后追加本次问询。
 * - chat + 司书库启用时，服务层还会追加司书库 systemRules / manifest，并开放 directorReply 工具集，最多 1 轮工具补查。
 * - 输出：纯文本答复，不要求 JSON；会作为 ask_director 的 tool_result 注入故事写手上下文。
 */

export const AUTHOR_DIRECTOR_REPLY_SYSTEM = `故事写手收到指示后向你提出问题。

任务：使用精炼的回答补充故事写手缺失的信息，让其能够继续创作本回合的故事。

约束：
- 仅回答本次提问，不要重新规划本回合。
- 不要扩展到其他议题。
- 若需要补查信息可调用工具，但最多一次。`;

export function buildAuthorDirectorReplyUser(p: {
  question: string;
  missingInfo?: string;
}): string {
  return [
    '【故事写手向你提出以下问题】',
    p.question.trim(),
    p.missingInfo?.trim()
      ? `\n【故事写手指出缺少以下信息】\n${p.missingInfo.trim()}`
      : '',
    '',
    '请使用精炼的回答补充信息，让故事写手能继续创作本回合正文。',
  ].filter(Boolean).join('\n');
}
