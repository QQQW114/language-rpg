import { genId } from './utils';

/** 游历模式的"可选行动"条目（与 `src/v2/types.ts` 的 ChoiceV2 结构一致）。 */
export interface NormalizedChoice {
  id: string;
  label: string;
  hint?: string;
}

/** 单回合最多展示的选项数量。 */
export const MAX_CHOICES = 4;

/**
 * 规整模型给出的"可选行动"。
 *
 * 模型可能给出字符串、缺 label 的对象、超长文本或重复项。这里统一处理成
 * `{id, label, hint}`：丢掉没有文字的条目（否则界面会出现点不动的空按钮）、
 * 去重、限长、限数量。
 *
 * 必须由模型调用层（`engine`）**和**状态写入层（`patch`）共用同一份实现：
 * 只靠 engine 规整的话，任何绕过 engine 直接提交 Patch 的调用方
 * （脚本、测试工具、未来新增的入口）都能把空选项写进存档。
 */
export function normalizeChoices(raw: unknown): NormalizedChoice[] {
  if (!Array.isArray(raw)) return [];
  const choices: NormalizedChoice[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const row = item as Record<string, unknown>;
    const label = String(row.label ?? '').trim().slice(0, 80);
    if (!label || seen.has(label)) continue;
    seen.add(label);
    choices.push({
      id: String(row.id ?? '').trim().slice(0, 80) || genId('action'),
      label,
      hint: String(row.hint ?? '').trim().slice(0, 120) || undefined,
    });
    if (choices.length >= MAX_CHOICES) break;
  }
  return choices;
}
